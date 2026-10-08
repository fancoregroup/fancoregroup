#!/usr/bin/env python3
"""Coleta reproduzível IBGE. Cache bruto, fonte, período e ausências preservados."""
import argparse
import concurrent.futures
import csv
import datetime as dt
import gzip
import hashlib
import json
import math
import pathlib
import sqlite3
import time
import threading
from collections import defaultdict
import urllib.request
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent
RAW = ROOT / 'fontes'
OUT = ROOT / 'exportacoes'
SITE = ROOT.parent / 'demo/site/inteligencia-geografica'
API = 'https://servicodados.ibge.gov.br/api/v3/agregados'
STAMP = dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).isoformat(timespec='seconds')
MANIFEST = {}
REFRESH = False
FETCH_LOCKS = defaultdict(threading.Lock)

def fetch(name, url):
    with FETCH_LOCKS[name]:
        return fetch_locked(name, url)

def fetch_locked(name, url):
    path = RAW / (name + '.json')
    meta_path = RAW / (name + '.origem.json')
    if name in MANIFEST and path.exists():
        return json.loads(path.read_bytes())
    if path.exists() and not REFRESH and meta_path.exists():
        body = path.read_bytes()
        MANIFEST[name] = json.loads(meta_path.read_text())
        return json.loads(body)
    for attempt in range(3):
        try:
            request = urllib.request.Request(urllib.parse.quote(url, safe=':/?=&%'), headers={'User-Agent': 'FancoreGeo/1.0 (municipal research)', 'Accept': 'application/json'})
            with urllib.request.urlopen(request, timeout=90) as response:
                body = response.read()
            if body[:2] == b'\x1f\x8b':
                body = gzip.decompress(body)
            data = json.loads(body)
            if isinstance(data, dict) and 'error' in data:
                raise ValueError(str(data))
            temporary = path.with_suffix('.tmp')
            temporary.write_bytes(body)
            temporary.replace(path)
            meta = {'url': url, 'coletado_em': STAMP, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
            meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2))
            MANIFEST[name] = meta
            print('Coletado', name, len(body), flush=True)
            return data
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)

def numeric(value):
    # SIDRA '-' é zero absoluto; '..', '...', X e vazio são ausência/sigilo.
    if value == '-':
        return 0
    if value in (None, '', '..', '...', 'X'):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (ValueError, TypeError):
        return None

SPECS = [
    ('populacao', '6579', '-1', '9324', '', 'População estimada', 'pessoas', 'Estimativa anual. Não é contagem censitária.'),
    ('censo', '4714', '2022', '93|6318|614', '', 'Censo e território', '', 'População, área e densidade do mesmo recorte de 2022.'),
    ('renda', '10295', '2022', '13431|13534', '2[6794]|86[95251]|58[95253]', 'Renda domiciliar', 'R$/mês por pessoa', 'Média e mediana nominal da amostra do Censo 2022. Não corrigidas pela inflação.'),
    ('pib', '5938', '-1', '37', '', 'PIB municipal', 'R$', 'Produção econômica anual, não renda domiciliar. Origem em mil reais convertida para reais.'),
    ('agro', '5938', '2021', '513|516', '', 'Agropecuária', '', 'Composição setorial de 2021 nesta versão. Participação no VAB, não no PIB. Não representa consumo ou afinidade cultural.'),
    ('empresas', '9509', '-1', '706|367|707|708|10143', '', 'Empresas e emprego', '', 'CEMPRE. Unidades locais e pessoal ocupado do universo da pesquisa, não um censo de todos os CNPJs.'),
    ('alimentacao', '9510', '-1', '706|707', '12762[117549]', 'Atividade de alimentação', '', 'CNAE divisão 56. Publicação restrita a municípios com 50 mil habitantes ou mais. Não representa apenas bares.'),
    ('idades', '9514', '2022', '93', '2[6794]|286[113635]|287[100362,93087,93088,93089,93090,93095,93096,93097,93098,49108,49109,60040,60041,6653]', 'Perfil etário', 'pessoas', '20 a 39 anos e 60 anos ou mais. Soma de faixas quinquenais sem sobreposição.'),
]
FIELDS = {
    ('populacao', '9324'): ('population', 'População estimada', 'pessoas', 1),
    ('censo', '93'): ('censusPopulation', 'População Censo', 'pessoas', 1),
    ('censo', '6318'): ('area', 'Área territorial', 'km²', 1),
    ('censo', '614'): ('density', 'Densidade demográfica', 'hab/km²', 1),
    ('renda', '13431'): ('income', 'Renda domiciliar média per capita', 'R$/mês', 1),
    ('renda', '13534'): ('medianIncome', 'Renda domiciliar mediana per capita', 'R$/mês', 1),
    ('pib', '37'): ('gdp', 'PIB municipal', 'R$', 1000),
    ('agro', '513'): ('agroGva', 'VAB agropecuário', 'R$', 1000),
    ('agro', '516'): ('agroShare', 'Agropecuária no VAB', '%', 1),
    ('empresas', '706'): ('establishments', 'Unidades locais CEMPRE', 'unidades', 1),
    ('empresas', '367'): ('companies', 'Empresas atuantes CEMPRE', 'empresas', 1),
    ('empresas', '707'): ('employment', 'Pessoal ocupado CEMPRE', 'pessoas', 1),
    ('empresas', '708'): ('salaried', 'Pessoal assalariado CEMPRE', 'pessoas', 1),
    ('empresas', '10143'): ('salary', 'Salário médio CEMPRE', 'R$/mês', 1),
    ('alimentacao', '706'): ('foodEstablishments', 'Unidades locais de alimentação', 'unidades', 1),
    ('alimentacao', '707'): ('foodEmployment', 'Pessoal ocupado em alimentação', 'pessoas', 1),
}

def get_aggregate(spec):
    key, table, period, variables, classes, *_ = spec
    fetch('metadata-' + table, f'{API}/{table}/metadados')
    if key == 'idades':
        # Pequenos lotes evitam limites de volume na API do SIDRA.
        categories = classes.split('287[')[1].rstrip(']').split(',')
        results = []
        for index in range(0, len(categories), 4):
            subset = ','.join(categories[index:index+4])
            url = f'{API}/{table}/periodos/{period}/variaveis/93?localidades=N6[all]&classificacao=2[6794]|286[113635]|287[{subset}]'
            batch = fetch('idades-' + str(index // 4), url)
            results.extend(batch[0]['resultados'])
        MANIFEST['idades'] = {'url': f'{API}/{table}/periodos/{period}/variaveis/93?localidades=N6[all]&classificacao={classes}', 'coletado_em': MANIFEST['idades-0']['coletado_em'], 'tipo': 'consulta_em_lotes', 'lotes': [{'arquivo': f'idades-{i}.json', **MANIFEST[f'idades-{i}']} for i in range(4)]}
        return key, [{'id': '93', 'resultados': results}]
    url = f'{API}/{table}/periodos/{period}/variaveis/{variables}?localidades=N6[all]'
    if classes:
        url += '&classificacao=' + classes
    return key, fetch(key, url)

def latest(series):
    for year, raw in sorted(series.items(), reverse=True):
        value = numeric(raw)
        if value is not None:
            return value, year, raw
    return None, next(iter(sorted(series, reverse=True)), None), next(iter(series.values()), None)

def dump_csv(path, rows, headers):
    with path.open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=headers, delimiter=';', lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)

def main():
    global REFRESH
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true', help='Consultar novamente as fontes, preservando o último site válido até concluir.')
    parser.add_argument('--malhas', action='store_true', help='Baixar os limites de todos os municípios por UF.')
    args = parser.parse_args()
    REFRESH = args.refresh
    for p in (RAW, OUT, SITE / 'dados', SITE / 'malhas'):
        p.mkdir(parents=True, exist_ok=True)
    localities = fetch('municipios', 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome')
    coordinates = {r['codigo_ibge']: r for r in csv.DictReader((ROOT.parent / 'mapa-agrobar/fontes/municipios.csv').open())}
    cities = {}
    for loc in localities:
        uf = loc['regiao-imediata']['regiao-intermediaria']['UF']
        code = str(loc['id'])
        point = coordinates.get(code, {})
        cities[code] = {'id': code, 'name': loc['nome'], 'uf': uf['sigla'], 'ufId': str(uf['id']), 'state': uf['nome'], 'region': uf['regiao']['nome'], 'immediateRegion': loc['regiao-imediata']['nome'], 'lat': float(point['latitude']) if point else None, 'lng': float(point['longitude']) if point else None, 'coordinateSource': 'Municípios Brasileiros (MIT)' if point else None, 'metrics': {}}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        aggregates = dict(pool.map(get_aggregate, SPECS))
    indicators = {}
    observations = []
    for spec in SPECS:
        source_key, table = spec[:2]
        for variable in aggregates[source_key]:
            if source_key == 'idades':
                continue
            field, label, unit, factor = FIELDS[(source_key, variable['id'])]
            indicators[field] = {'label': label, 'unit': unit, 'table': table, 'variable': variable['id'], 'source': f'https://sidra.ibge.gov.br/tabela/{table}', 'api': MANIFEST[source_key]['url'], 'note': spec[-1], 'collectedAt': MANIFEST[source_key]['coletado_em']}
            for result in variable['resultados']:
                for item in result['series']:
                    code = item['localidade']['id']
                    if code not in cities:
                        continue
                    value, year, raw = latest(item['serie'])
                    scaled = round(value * factor, 4) if value is not None else None
                    cities[code]['metrics'][field] = {'value': scaled, 'year': year, 'raw': raw}
                    observations.append({'codigo_ibge': code, 'indicador': field, 'valor': scaled, 'ano': year, 'unidade': unit, 'valor_original': raw, 'fonte': indicators[field]['source']})
    age_values = {}
    age_totals = {}
    for result in aggregates['idades'][0]['resultados']:
        category = next(iter(next(c for c in result['classificacoes'] if c['id'] == '287')['categoria']))
        for item in result['series']:
            code = item['localidade']['id']
            value, year, raw = latest(item['serie'])
            if category == '100362':
                age_totals[code] = value
            else:
                bucket = 'youngAdults' if category in ['93087', '93088', '93089', '93090'] else 'seniors'
                age_values.setdefault((code, bucket), []).append(value)
    for key, label, count in [('youngAdults', 'População de 20 a 39 anos', 4), ('seniors', 'População de 60 anos ou mais', 9)]:
        indicators[key] = {'label': label, 'unit': 'pessoas', 'table': '9514', 'variable': '93', 'source': 'https://sidra.ibge.gov.br/tabela/9514', 'api': MANIFEST['idades']['url'], 'note': SPECS[-1][-1], 'collectedAt': MANIFEST['idades']['coletado_em']}
        indicators[key + 'Share'] = dict(indicators[key], label=label + ' (%)', unit='%', note='Percentual da população total da tabela 9514. Mesma base e ano do numerador.')
        for code, city in cities.items():
            vals = age_values.get((code, key), [])
            value = sum(vals) if len(vals) == count and all(v is not None for v in vals) else None
            denom = age_totals.get(code)
            for field, val in [(key, value), (key + 'Share', round(value / denom * 100, 4) if value is not None and denom else None)]:
                city['metrics'][field] = {'value': val, 'year': '2022', 'raw': None}
                observations.append({'codigo_ibge': code, 'indicador': field, 'valor': val, 'ano': '2022', 'unidade': indicators[field]['unit'], 'valor_original': '', 'fonte': indicators[field]['source']})
    # Novos municípios podem não existir na base de coordenadas anterior.
    for city in cities.values():
        if city['lat'] is None:
            geo = fetch('malha-' + city['id'], f"https://servicodados.ibge.gov.br/api/v3/malhas/municipios/{city['id']}?formato=application/vnd.geo%2Bjson&qualidade=minima")
            points = []
            def walk(obj):
                if isinstance(obj, list) and len(obj) >= 2 and isinstance(obj[0], (float, int)):
                    points.append(obj[:2])
                elif isinstance(obj, list):
                    for child in obj: walk(child)
            for feature in geo['features']: walk(feature['geometry']['coordinates'])
            if points:
                city['lng'] = sum(p[0] for p in points) / len(points)
                city['lat'] = sum(p[1] for p in points) / len(points)
                city['coordinateSource'] = 'Centro aproximado da geometria IBGE, não sede municipal'
    if args.malhas:
        states = sorted({c['ufId'] for c in cities.values()})
        def geometry(uf):
            data = fetch('malhas-uf-' + uf, f'https://servicodados.ibge.gov.br/api/v3/malhas/estados/{uf}?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio')
            (SITE / 'malhas' / (uf + '.json')).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
            return uf, len(data['features'])
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            print('Malhas', list(pool.map(geometry, states)), flush=True)
    for key, meta in indicators.items():
        available = [c['metrics'].get(key, {}) for c in cities.values() if c['metrics'].get(key, {}).get('value') is not None]
        meta.update(coverage=len(available), years=sorted({v['year'] for v in available}))
    result = {'generatedAt': STAMP, 'count': len(cities), 'indicators': indicators, 'sources': MANIFEST, 'cities': list(cities.values())}
    assert len(cities) > 5500 and len(cities) == len({c['id'] for c in cities.values()})
    assert indicators['population']['coverage'] >= 5500
    target = SITE / 'dados/municipios.json'
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
    temp.replace(target)
    (ROOT / 'manifesto.json').write_text(json.dumps({'generatedAt': STAMP, 'sources': MANIFEST, 'indicators': indicators, 'municipalities': len(cities)}, ensure_ascii=False, indent=2))
    dump_csv(OUT / 'indicadores-municipais.csv', observations, ['codigo_ibge', 'indicador', 'valor', 'ano', 'unidade', 'valor_original', 'fonte'])
    rows = []
    for c in cities.values():
        row = {k: c[k] for k in ['id', 'name', 'uf', 'state', 'region', 'immediateRegion', 'lat', 'lng', 'coordinateSource']}
        for key in indicators:
            metric = c['metrics'].get(key, {})
            row[key] = metric.get('value')
            row[key + '_ano'] = metric.get('year')
        rows.append(row)
    dump_csv(OUT / 'municipios-brasil.csv', rows, list(rows[0]))
    dump_csv(OUT / 'dicionario-indicadores.csv', [{'campo': k, **{f: v.get(f) for f in ['label', 'unit', 'table', 'variable', 'source', 'note', 'coverage']}, 'anos': ', '.join(v['years'])} for k, v in indicators.items()], ['campo', 'label', 'unit', 'table', 'variable', 'source', 'note', 'coverage', 'anos'])
    # SQLite para integração local: transação substitui só o snapshot após validação.
    db = sqlite3.connect(OUT / 'fancore-geo.sqlite')
    with db:
        db.executescript('CREATE TABLE IF NOT EXISTS municipios (codigo_ibge TEXT PRIMARY KEY, nome TEXT, uf TEXT, regiao TEXT, latitude REAL, longitude REAL); CREATE TABLE IF NOT EXISTS indicadores (codigo_ibge TEXT, indicador TEXT, valor REAL, ano TEXT, unidade TEXT, valor_original TEXT, fonte TEXT, PRIMARY KEY(codigo_ibge, indicador)); DELETE FROM municipios; DELETE FROM indicadores;')
        db.executemany('INSERT INTO municipios VALUES(?,?,?,?,?,?)', [(c['id'], c['name'], c['uf'], c['region'], c['lat'], c['lng']) for c in cities.values()])
        db.executemany('INSERT INTO indicadores VALUES(?,?,?,?,?,?,?)', [tuple(o[k] for k in ['codigo_ibge', 'indicador', 'valor', 'ano', 'unidade', 'valor_original', 'fonte']) for o in observations])
    db.close()
    print(json.dumps({'municipios': len(cities), 'indicadores': len(indicators), 'observacoes': len(observations), 'cobertura': {k: [v['coverage'], v['years']] for k, v in indicators.items()}}, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
