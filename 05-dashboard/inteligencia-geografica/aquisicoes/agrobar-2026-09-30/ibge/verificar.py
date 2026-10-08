#!/usr/bin/env python3
"""Valida hashes/ZIP/SQLite, cobertura e conciliações; execute após coletar.py.

Não altera os dados oficiais. Acrescenta cobertura setorial ao manifesto e grava
verificacao.json e cópias CSV setoriais UTF-8 gzip em derived/.
"""
from __future__ import annotations
import collections, csv, gzip, io, json, sqlite3, zipfile
from pathlib import Path
import coletar as c

ROOT = Path(__file__).resolve().parent

def api_values(manifest, table, variable):
    out = collections.defaultdict(dict)
    dimension = str(manifest['tables'][table]['varied_classification'])
    for entry in manifest['files']:
        if entry.get('table') != table or entry['kind'] != 'api-data' or entry['status'] != 'downloaded': continue
        for block in c.read_json(ROOT / entry['raw_path']):
            if block['id'] != variable: continue
            for result in block['resultados']:
                category = next(iter(next(x['categoria'] for x in result['classificacoes'] if x['id'] == dimension)))
                for series in result['series']:
                    raw = series['serie']['2022']
                    assert category not in out[series['localidade']['id']], (table, category, series['localidade']['id'])
                    out[series['localidade']['id']][category] = c.classify_value(raw)[0]
    return out

def main():
    manifest = json.loads(c.MANIFEST.read_text())
    report = dict(verified_at=c.now(), files_verified=0, checks=[], sectors={})
    assert not [e for e in manifest['files'] if e['status'] in ['failed', 'pending']], 'Há arquivos sem conclusão'
    for entry in manifest['files']:
        if entry['status'] != 'downloaded': continue
        file = ROOT / entry['raw_path']
        assert file.stat().st_size == entry['bytes'] and c.sha(file) == entry['sha256'], file
        report['files_verified'] += 1
    report['checks'].append('Todos os arquivos baixados correspondem ao tamanho e SHA-256 registrados.')
    for table, definition in manifest['tables'].items():
        derived = definition['derived']; file = ROOT / derived['path']
        assert file.stat().st_size == derived['bytes'] and c.sha(file) == derived['sha256'], file
        with gzip.open(file, 'rt', encoding='utf-8') as stream:
            assert next(csv.reader(stream))[-2:] == ['unidade_api', 'origem_unidade']
    assert c.classify_value('-') == (0, 'zero_absoluto')
    assert c.classify_value('0') == (0, 'numerico')
    assert all(c.classify_value(raw)[0] is None for raw in ['X', 'x', '..', '...', '', None, 'NaN'])
    for product in ['40092', '40145']:
        assert c.observation_unit('5457', {'id': '214', 'unidade': 'Toneladas'}, {'782': {product: ''}}, {}) == ('Mil frutos', 'nota_6_pam_sidra')
        assert c.observation_unit('5457', {'id': '112', 'unidade': 'Quilogramas por Hectare'}, {'782': {product: ''}}, {}) == ('Frutos por Hectare', 'nota_6_pam_sidra')
    assert c.observation_unit('74', {'id': '106', 'unidade': ''}, {'80': {'2682': 'Leite'}}, manifest['tables']['74']) == ('Mil litros', 'metadado_categoria_80')
    report['checks'].append('Sete derivados conferidos por tamanho/hash; zero, ausências e exceções oficiais de unidades são tratados separadamente.')

    urban = api_values(manifest, '9923', '93')
    age = api_values(manifest, '9514', '93')
    income = api_values(manifest, '10296', '13604')
    income_age = api_values(manifest, '10295', '13604')
    assert len(urban) == len(age) == len(income) == len(income_age) == 5570
    assert set(urban) == set(age) == set(income) == set(income_age)
    report['agricultural_coverage'] = {}
    for table in ['5457', '3939', '74']:
        entry = next(e for e in manifest['files'] if e.get('table') == table and e['kind'] == 'api-data' and e['status'] == 'downloaded')
        series = c.read_json(ROOT / entry['raw_path'])[0]['resultados'][0]['series']
        cities = {row['localidade']['id']: row['localidade']['nome'] for row in series}
        report['agricultural_coverage'][table] = dict(
            coverage=manifest['tables'][table]['coverage'],
            first_batch_period=entry['reference'],
            first_batch_ids_absent_from_census={id: cities[id] for id in sorted(cities.keys() - urban.keys())},
            census_ids_not_in_first_batch=sorted(urban.keys() - cities.keys()),
            note='Diferença territorial não recebe preenchimento com zero; séries ausentes e sigilo preservados.')
    assert all(v['6795'] == v['1'] + v['2'] for v in urban.values())
    assert all(age[id]['100362'] == urban[id]['6795'] for id in urban)
    adult_total = sum(sum(v for k, v in groups.items() if k != '100362') for groups in age.values())
    assert all(0 <= sum(v for k, v in groups.items() if k != '100362') <= groups['100362'] for groups in age.values())
    report['census'] = dict(municipalities=5570, census_population=sum(v['6795'] for v in urban.values()),
                            adult_population_18_plus=adult_total, age_categories=len(next(iter(age.values()))))
    report['checks'].append('5.570 municípios com os mesmos IDs nos quatro temas censitários; urbano+rural=total e total 9514=9923 em todos.')
    residuals = [sum(v for key, v in row.items() if key != '9680') - row['9680'] for row in income.values()]
    report['census']['income_distribution_rounding_residual'] = dict(min=min(residuals), max=max(residuals), nonzero=sum(v != 0 for v in residuals),
        note='Contagens expandidas da amostra, arredondadas independentemente; nenhuma correção ou redistribuição aplicada.')
    assert max(abs(v) for v in residuals) <= 6, 'Resíduo incompatível com arredondamento de 11 classes'

    geometry_ids = set()
    for entry in manifest['files']:
        if entry['kind'] != 'sector-geometry' or entry['status'] != 'downloaded': continue
        file = ROOT / entry['raw_path']
        with sqlite3.connect(f'file:{file}?mode=ro', uri=True) as db:
            assert db.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
            geometry = db.execute('SELECT table_name,column_name,geometry_type_name,srs_id FROM gpkg_geometry_columns').fetchall()
            tables = []
            for table, column, geom_type, srs in geometry:
                safe = '"' + table.replace('"', '""') + '"'
                columns = [r[1] for r in db.execute(f'PRAGMA table_info({safe})')]
                code = next(x for x in columns if x.upper() == 'CD_SETOR')
                count = db.execute(f'SELECT count(*) FROM {safe}').fetchone()[0]
                code_counts = collections.Counter(r[0] for r in db.execute(f'SELECT "{code}" FROM {safe}'))
                assert None not in code_counts and '' not in code_counts
                inconsistent = db.execute(f'SELECT count(*) FROM (SELECT "{code}" FROM {safe} GROUP BY "{code}" HAVING count(distinct CD_MUN)>1 OR count(distinct CD_SIT)>1)').fetchone()[0]
                assert inconsistent == 0
                geometry_ids.update(code_counts)
                tables.append(dict(table=table, features=count, distinct_sectors=len(code_counts),
                                   sector_codes_with_multiple_features=sum(n > 1 for n in code_counts.values()),
                                   additional_polygon_rows=count - len(code_counts), geometry=geom_type, srs_id=srs))
            entry['coverage'] = dict(sectors=len(geometry_ids), tables=tables, sqlite_quick_check='ok')
            report['sectors']['geometry'] = entry['coverage']

    for entry in manifest['files']:
        if entry['kind'] != 'sector-data' or entry['status'] != 'downloaded': continue
        file = ROOT / entry['raw_path']
        with zipfile.ZipFile(file) as archive:
            assert archive.testzip() is None, f'CRC inválido em {file}'
            for member in archive.namelist():
                if not member.lower().endswith('.csv'): continue
                with archive.open(member) as binary:
                    sample = binary.read(65536)
                try: sample.decode('utf-8-sig'); encoding = 'utf-8-sig'
                except UnicodeDecodeError: encoding = 'cp1252'
                target = ROOT / 'derived' / (Path(member).stem + '.csv.gz')
                sectors, municipalities, symbols = set(), set(), collections.Counter()
                territorial_exceptions = set()
                count = duplicate = 0
                with archive.open(member) as binary, gzip.open(target, 'wt', encoding='utf-8', newline='') as output:
                    reader = csv.reader(io.TextIOWrapper(binary, encoding=encoding), delimiter=';')
                    writer = csv.writer(output, delimiter=';')
                    header = next(reader); writer.writerow(header)
                    idx = next(i for i, name in enumerate(header) if name.upper() == 'CD_SETOR')
                    variables = [i for i, name in enumerate(header) if name.upper().startswith('V0')]
                    for row in reader:
                        writer.writerow(row); count += 1
                        code = row[idx]
                        duplicate += code in sectors
                        sectors.add(code)
                        if code[:7] in urban: municipalities.add(code[:7])
                        else: territorial_exceptions.add(code[:7])
                        for i in variables:
                            if row[i] in {'X', 'x', '-', '..', '...', ''}: symbols[row[i]] += 1
                assert duplicate == 0 and sectors <= geometry_ids
                entry['coverage'] = dict(rows=count, distinct_sectors=len(sectors), municipalities=len(municipalities),
                                         source_encoding=encoding, columns=header, special_symbols=dict(symbols), sectors_without_geometry=0)
                entry['coverage']['sector_prefixes_without_census_municipality'] = sorted(territorial_exceptions)
                entry['derived'] = dict(path=str(target.relative_to(ROOT)), bytes=target.stat().st_size, sha256=c.sha(target),
                                        note='Transcodificação para UTF-8 gzip; números, símbolos e vírgulas decimais preservados.')
                report['sectors'][member] = {k: v for k, v in entry['coverage'].items() if k != 'columns'}
    report['checks'].append('Malha nacional passou SQLite quick_check; ZIPs passaram CRC; setores tabulares não se repetem e existem na malha.')
    limitations = [
        'Demografia setorial usa grupos 15–19, 20–24, 25–29, 30–39 etc.; não permite separar 18–19. Recorte 18+ exato só no município via 9514.',
        'As classes de renda 10296 têm resíduos pequenos de arredondamento das estimativas da amostra; dados oficiais não foram ajustados.',
        'Os CSVs setoriais têm codificação cp1252 e vírgula decimal. Derivados UTF-8 preservam esses valores textuais.',
        'Malha GeoPackage contém múltiplos polígonos para alguns CD_SETOR. Unir por código sem multiplicar contagens; não somar estatísticas repetidas por polígono.',
        'Agregado básico contém dois setores especiais com prefixos 4300001 e 4300002, CD_MUN ponto e população zero. Preservados, mas não contados como municípios.',
        '10295 e 10296 cobrem moradores em domicílios particulares permanentes ocupados, excluindo pensionistas, empregados domésticos e parentes destes; não usar população total do Censo como denominador das classes.',
    ]
    for note in limitations:
        if note not in manifest['limitations']: manifest['limitations'].append(note)
    manifest['verification'] = dict(path='verificacao.json', checked_at=report['verified_at'], checks=report['checks'])
    manifest['status'] = 'concluido_e_verificado'
    manifest['completion'] = dict(verified_at=report['verified_at'], official_files=report['files_verified'],
                                  municipal_observations=sum(t['derived']['rows'] for t in manifest['tables'].values()),
                                  current_failures=0, production_integrated=False)
    manifest['updated_at'] = c.now()
    manifest['stored_bytes'] = sum(p.stat().st_size for p in ROOT.rglob('*') if p.is_file())
    (ROOT / 'verificacao.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    c.MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))

if __name__ == '__main__': main()
