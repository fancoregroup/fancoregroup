#!/usr/bin/env python3
"""Gera somente agregados públicos REGIC para a aplicação, sem dados da holding."""
import csv, gzip, hashlib, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = ROOT.parents[3] / 'demo/site/inteligencia-geografica/dados/consumption-axes.json'
THEMES = ['Q1', 'Q2', 'Q6', 'Q7']

def read(name):
    with gzip.open(ROOT / 'derived' / name, 'rt', encoding='utf-8') as stream:
        yield from csv.DictReader(stream)

def main():
    report = json.loads((ROOT / 'eixos-verificacao.json').read_text())
    for name in ['eixos-cidades', 'eixos-ligacoes-cidades', 'eixos-ligacoes-municipais', 'eixos-municipios']:
        item = report['outputs'][name]; path = ROOT / item['path']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], name
    nodes = []
    for row in read('eixos-cidades.csv.gz'):
        ia = json.loads(row['atracao'])
        nodes.append([row['codigo'], row['nome'], row['uf_nucleo'], int(row['tipo'] == 'Arranjo Populacional'),
                      json.loads(row['municipios']), [ia[q] for q in THEMES]])
    index = {node[0]: i for i, node in enumerate(nodes)}
    edges = {}
    for row in read('eixos-ligacoes-cidades.csv.gz'):
        rank = int(row['ordem_oficial']) if row['ordem_oficial'] else 0
        if not rank: continue
        key = (index[row['origem']], index[row['destino']])
        edges.setdefault(key, [*key, 0, 0, 0, 0])[THEMES.index('Q' + row['campo_oficial'].split('_')[1]) + 2] = rank
    questionnaire = set(); special = {}
    for row in read('eixos-ligacoes-municipais.csv.gz'):
        questionnaire.add(row['origem'])
        if row['destino'] != '0': continue
        value = float(row['percentual_estimado_oficial']) if row['percentual_estimado_oficial'] else None
        special.setdefault(row['origem'], [0, 0, 0, 0])[THEMES.index(row['quesito'])] = value
    municipal = [[row['codigo'], row['nome'], row['uf'], int(row['codigo'] in questionnaire), special.get(row['codigo'])]
                 for row in read('eixos-municipios.csv.gz')]
    source = dict(version='regic-consumption-2018-v1', reference=2018,
        sourceUrl='https://www.ibge.gov.br/geociencias/organizacao-do-territorio/redes-e-fluxos-geograficos/15798-regioes-de-influencia-das-cidades.html',
        themes=[dict(id=q, label=report['themes'][q]['name']) for q in THEMES],
        schema=dict(nodes=['id', 'name', 'uf', 'isArrangement', 'municipalityIds', 'officialIAByTheme'],
                    edges=['originNodeIndex', 'destinationNodeIndex', 'Q1Order', 'Q2Order', 'Q6Order', 'Q7Order'],
                    municipalities=['id', 'name', 'uf', 'questionnaireApplied', 'specialDestinationPctByTheme']),
        nodes=nodes, edges=list(edges.values()), municipalities=municipal,
        coverage=dict(cities=len(nodes), municipalities=len(municipal), questionnaireOrigins=len(questionnaire),
            linksByTheme={q: sum(edge[i+2] > 0 for edge in edges.values()) for i, q in enumerate(THEMES)}),
        provenance=dict(sources=report['sources'], duplicateSourcePairs=report['city_coverage']['pares_repetidos_na_fonte'],
            duplicateRule=report['city_coverage']['tratamento_duplicidades'],
            specialDestination=dict(code='0', label='Destino não identificado/especial', officialLabel='Outros / Não circula jornal')),
        notes=['Referência 2018. Indicações do REGIC não são viagens observadas, receita ou participação de mercado.',
               'Cidade REGIC pode reunir municípios em um arranjo populacional. IA pertence à Cidade, sem repetição por integrante.',
               'Ordens 1, 2 e 3 são as prioridades de indicação publicadas; não são intensidade ou volume do fluxo.',
               'Cultura e esporte não identificam consumo em bares ou vida noturna.',
               'Destino especial existe apenas no complemento municipal. Não é localizado nem incluído como polo.'])
    assert len(index) == 4899 and len(municipal) == 5570 and len(questionnaire) == 5503
    assert source['coverage']['linksByTheme'] == report['city_coverage']['ligacoes_por_tema']
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(source, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps(dict(path=str(TARGET), bytes=TARGET.stat().st_size, coverage=source['coverage']), ensure_ascii=False))

if __name__ == '__main__': main()
