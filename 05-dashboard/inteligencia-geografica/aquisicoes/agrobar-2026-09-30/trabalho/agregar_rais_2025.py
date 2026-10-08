#!/usr/bin/env python3
"""Agrega vínculos públicos RAIS 2025 em streaming, sem TXT individual no disco.

python agregar_rais_2025.py [--archive raw/RAIS_VINC_PUB_NORTE.7z]

Cada arquivo concluído gera agregados e prova CRC. Rodar novamente reaproveita
os arquivos concluídos por SHA256. Só sete partes constituem cobertura Brasil.
Não confundir soma de remunerações de dezembro com massa salarial anual.
"""
import argparse
from collections import defaultdict
import io
import json
from pathlib import Path

import pandas as pd
import py7zr
from coletar import ROOT, now, sha

FIELDS = {'Município - Código': 'municipio_mte', 'Ind Vínculo Ativo 31/12 - Código': 'ativo',
          'CNAE 2.0 Classe - Código': 'cnae_classe', 'Vl Rem Dezembro Nom': 'remuneracao_dezembro',
          'Ind Vínculo Abandonado - Código': 'abandonado'}
SECTORS = {'agropecuaria': range(1, 4), 'industria': range(5, 40), 'construcao': range(41, 44),
           'comercio': range(45, 48), 'servicos': range(49, 100)}
VALUES = ['vinculos_ativos', 'remuneracao_dezembro_soma_nominal', 'remuneracao_dezembro_positiva_soma_nominal',
          'remuneracao_dezembro_informada_n', 'remuneracao_dezembro_positiva_n', 'remuneracao_dezembro_zero_n',
          'remuneracao_dezembro_negativa_n', 'remuneracao_dezembro_ausente_n']
METHOD_VERSION = 4


class Aggregator(py7zr.io.Py7zIO):
    def __init__(self):
        self.pending = bytearray()
        self.header = None
        self.count = 0
        self.rows = 0
        self.active_before_abandoned = 0
        self.abandoned_active = 0
        self.groups = defaultdict(lambda: [0.0] * len(VALUES))
        self.closed = False

    def write(self, data):
        self.count += len(data)
        self.pending.extend(data)
        if self.header is None and b'\n' in self.pending:
            end = self.pending.index(b'\n') + 1
            self.header = bytes(self.pending[:end])
            del self.pending[:end]
            head = pd.read_csv(io.BytesIO(self.header), encoding='latin1').columns
            if not set(FIELDS).issubset(head):
                raise ValueError('Layout RAIS inesperado, faltam colunas: ' + str(set(FIELDS) - set(head)))
        if len(self.pending) >= 8 * 1024 * 1024:
            end = self.pending.rfind(b'\n') + 1
            if end:
                self.process(bytes(self.pending[:end]))
                del self.pending[:end]
        return len(data)

    def process(self, data):
        if not data.strip():
            return
        frame = pd.read_csv(io.BytesIO(self.header + data), encoding='latin1', dtype=str, usecols=list(FIELDS)).rename(columns=FIELDS)
        self.rows += len(frame)
        frame = frame[frame.ativo.eq('1')].copy()
        self.active_before_abandoned += len(frame)
        assert set(frame.abandonado.dropna().str.strip().unique()).issubset({'0', '1'}), 'Indicador de abandono inesperado'
        assert not frame.abandonado.isna().any(), 'Indicador de abandono ausente'
        self.abandoned_active += int(frame.abandonado.str.strip().eq('1').sum())
        # Nota técnica RAIS2025, seção16, p9: vínculos abandonados são
        # segregados do estoque principal. Não é filtro escolhido por ajuste.
        frame = frame[frame.abandonado.str.strip().eq('0')].copy()
        if frame.empty:
            return
        frame['municipio_mte'] = frame.municipio_mte.fillna('AUSENTE')
        class_code = frame.cnae_classe.str.strip().str.zfill(5)
        division = pd.to_numeric(class_code.str[:2], errors='coerce').where(class_code.ne('99999'))
        frame['setor'] = 'nao_classificado'
        for name, values in SECTORS.items():
            frame.loc[division.isin(values), 'setor'] = name
        wages = pd.to_numeric(frame.remuneracao_dezembro, errors='coerce')
        frame['vinculos_ativos'] = 1
        frame['remuneracao_dezembro_soma_nominal'] = wages.fillna(0)
        frame['remuneracao_dezembro_positiva_soma_nominal'] = wages.where(wages.gt(0), 0)
        frame['remuneracao_dezembro_informada_n'] = wages.notna().astype(int)
        frame['remuneracao_dezembro_positiva_n'] = wages.gt(0).astype(int)
        frame['remuneracao_dezembro_zero_n'] = wages.eq(0).astype(int)
        frame['remuneracao_dezembro_negativa_n'] = wages.lt(0).astype(int)
        frame['remuneracao_dezembro_ausente_n'] = wages.isna().astype(int)
        sums = frame.groupby(['municipio_mte', 'setor'])[VALUES].sum()
        for key, row in sums.iterrows():
            group = self.groups[key]
            for i, value in enumerate(row):
                group[i] += value

    def read(self, size=None):
        raise io.UnsupportedOperation('Agregador de escrita sequencial')

    def seek(self, offset, whence=0):
        if offset == 0 and whence == 0:
            return 0
        raise io.UnsupportedOperation('Agregador de escrita sequencial')

    def flush(self):
        pass

    def size(self):
        return self.count

    def close(self):
        if not self.closed:
            self.process(bytes(self.pending))
            self.pending.clear()
            self.closed = True


class Factory(py7zr.io.WriterFactory):
    def __init__(self):
        self.members = {}

    def create(self, filename):
        item = Aggregator()
        self.members[filename] = item
        return item


def aggregate(archive):
    target = ROOT / 'derived' / (archive.stem.lower() + '-municipio-setor.parquet')
    proof_path = target.with_suffix('.json')
    digest = sha(archive)
    if target.exists() and proof_path.exists():
        proof = json.loads(proof_path.read_text())
        if proof.get('method_version') == METHOD_VERSION and proof.get('source_sha256') == digest and proof.get('sha256') == sha(target):
            print('cache agregado', archive.name, flush=True)
            return proof
    factory = Factory()
    with py7zr.SevenZipFile(archive) as z:
        expected = {i.filename: i.uncompressed for i in z.list()}
        z.extractall(factory=factory)
    groups = defaultdict(lambda: [0.0] * len(VALUES))
    for name, item in factory.members.items():
        item.close()
        assert item.count == expected[name], 'Tamanho descomprimido incompleto'
        for key, values in item.groups.items():
            for i, value in enumerate(values):
                groups[key][i] += value
    rows = [{'municipio_mte': key[0], 'setor': key[1], **dict(zip(VALUES, values))} for key, values in groups.items()]
    df = pd.DataFrame(rows)
    for key in VALUES:
        if not key.endswith('nominal'):
            df[key] = df[key].astype('int64')
    df.to_parquet(target, index=False)
    proof = {'source_path': str(archive.relative_to(ROOT)), 'source_sha256': digest, 'generated_at': now(),
             'method_version': METHOD_VERSION, 'implementation_sha256': sha(Path(__file__)),
             'path': str(target.relative_to(ROOT)), 'sha256': sha(target), 'bytes': target.stat().st_size,
             'raw_rows': sum(x.rows for x in factory.members.values()), 'active_rows': int(df.vinculos_ativos.sum()),
             'active_before_excluding_abandoned': sum(x.active_before_abandoned for x in factory.members.values()),
             'abandoned_active_excluded': sum(x.abandoned_active for x in factory.members.values()),
             'geographic_codes': int(df.municipio_mte.nunique()), 'crc_verified': True,
             'integrity': 'Extração integral py7zr, CRC de cada membro e tamanho descomprimido conferidos; nenhum TXT individual gravado.',
             'members': expected}
    proof_path.write_text(json.dumps(proof, ensure_ascii=False, indent=2) + '\n')
    print('agregado', archive.name, proof['raw_rows'], proof['active_rows'], flush=True)
    return proof


def consolidate():
    paths = [path for path in sorted((ROOT / 'derived').glob('rais_vinc_pub_*-municipio-setor.parquet'))
             if path.with_suffix('.json').exists() and json.loads(path.with_suffix('.json').read_text()).get('method_version') == METHOD_VERSION]
    if not paths:
        return
    df = pd.concat([pd.read_parquet(x) for x in paths]).groupby(['municipio_mte', 'setor'])[VALUES].sum().reset_index()
    # Recalcula a linha total só a partir de setores mutuamente exclusivos.
    total = df.groupby('municipio_mte')[VALUES].sum().reset_index()
    total['setor'] = 'total'
    df = pd.concat([df, total], ignore_index=True)
    cities = ROOT.parents[4] / '05-dashboard/demo/site/inteligencia-geografica/dados/municipios.json'
    crosswalk = {str(x['id'])[:6]: str(x['id']) for x in json.loads(cities.read_text())['cities']}
    df['municipio_ibge'] = df.municipio_mte.map(crosswalk)
    df['ano'] = 2025
    # Ausência de remuneração não vira zero no agregado final.
    df.loc[df.remuneracao_dezembro_informada_n.eq(0), 'remuneracao_dezembro_soma_nominal'] = float('nan')
    df['remuneracao_dezembro_media_positivos'] = df.remuneracao_dezembro_positiva_soma_nominal / df.remuneracao_dezembro_positiva_n.replace(0, float('nan'))
    df['remuneracao_dezembro_media_informados'] = df.remuneracao_dezembro_soma_nominal / df.remuneracao_dezembro_informada_n.replace(0, float('nan'))
    target = ROOT / 'derived/rais-2025-remuneracao-municipio-setor.parquet'
    df.to_parquet(target, index=False)
    proof = {'generated_at': now(), 'path': str(target.relative_to(ROOT)), 'bytes': target.stat().st_size, 'sha256': sha(target),
             'method_version': METHOD_VERSION, 'implementation_sha256': sha(Path(__file__)),
             'parts_processed': len(paths), 'parts_expected': 7, 'complete_brazil': len(paths) == 7,
             'municipalities': int(df.municipio_ibge.nunique()), 'geographic_codes': int(df.municipio_mte.nunique()),
             'unmatched_codes': sorted(df.loc[df.municipio_ibge.isna(), 'municipio_mte'].unique().tolist()),
             'source_parts': [str(x.relative_to(ROOT)) for x in paths],
             'definition': 'Vínculos ativos31/12=1 e abandonado=0, conforme Nota técnica RAIS2025 seção16 p9; município do estabelecimento; CNAE com strip antes da divisão e sentinela99999 em nao_classificado.',
             'universe_source': 'raw/notas/nota-tecnica-rais-2025.zip -> Nota técnica 2025.pdf, seção 16, página 9',
             'units': 'Vínculos e reais nominais de dezembro/2025. Soma observada das remunerações de dezembro, sem multiplicar por12.',
             'limitations': ['Não é massa salarial anual.', 'Vínculos não equivalem a pessoas distintas.',
                             'Média de informados inclui zero; média de positivos exclui zero e negativos. Denominadores publicados. Não assumir paridade com tratamento estatístico do MTE.',
                             'Municípios sem linha de vínculos ativos não são preenchidos com zero neste derivado. Consultar agregado oficial de estoque.',
                             'Campos individuais não são exportados, apenas agregados municipais/setoriais.']}
    stock = ROOT / 'derived/rais-vinculos-municipio-setor-2023-2025.parquet'
    if len(paths) == 7 and stock.exists():
        assert set(SECTORS).issubset(set(df.setor)), 'Os cinco setores devem existir no agregado Brasil'
        sector_expected = {'agropecuaria': 1812263, 'industria': 9016940, 'construcao': 2956623,
                           'comercio': 10486872, 'servicos': 35694977, 'nao_classificado': 3270}
        sector_observed = {key: int(value) for key, value in df[~df.setor.eq('total')].groupby('setor').vinculos_ativos.sum().items()}
        proof['sector_reconciliation'] = {'observed': sector_observed, 'published': sector_expected,
                                           'source': 'RAIS2025 XLSX Tabela2 e Nota técnica2025, grupamentos CNAE; residual não classificado em separado',
                                           'passed': sector_observed == sector_expected}
        assert proof['sector_reconciliation']['passed'], 'Setores não conciliados com divulgação RAIS2025'
        official = pd.read_parquet(stock)
        official = official[official.ano.eq(2025) & official.setor.eq('Total')].set_index('municipio_mte').vinculos_31_dezembro
        computed = df[df.setor.eq('total')].set_index('municipio_mte').vinculos_ativos
        delta = computed.subtract(official, fill_value=0)
        proof['active_stock_reconciliation'] = {'equal_codes': int(delta.eq(0).sum()), 'different_codes': int(delta.ne(0).sum()),
                                                 'microdata_total': int(computed.sum()), 'published_total': int(official.sum()),
                                                 'differences': [{'municipio_mte': k, 'difference': int(v)} for k, v in delta[delta.ne(0)].items()]}
        proof['national_universe_reconciliation'] = {'microdata_total': int(computed.sum()), 'published_table_1_total': 59970945,
                                                     'published_technical_note_abandoned': 720825,
                                                     'passed': int(computed.sum()) == 59970945,
                                                     'municipal_table_4_sum': int(official.sum()),
                                                     'municipal_table_difference': int(computed.sum() - official.sum())}
        assert proof['national_universe_reconciliation']['passed'], 'Universo não conciliado com Tabela1 e nota técnica'
        proof['review_status'] = 'Universo nacional conciliado. Diferença da Tabela4 municipal preservada para revisão; remuneração não liberada para índice.'
    (ROOT / 'derived/validacao-rais-microdados.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2) + '\n')
    print('consolidado', len(paths), 'de7 partes', proof['municipalities'], 'municipios', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path)
    args = parser.parse_args()
    archives = [args.archive] if args.archive else sorted((ROOT / 'raw').glob('RAIS_VINC_PUB_*.7z'))
    for archive in archives:
        aggregate(archive.resolve())
        consolidate()
