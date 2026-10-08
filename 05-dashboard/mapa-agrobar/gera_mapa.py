"""Converte a transcrição conferida da imagem em dados privados do mapa."""
import csv
import gzip
import json
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = ROOT.parent / 'demo/site'

def norm(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if not unicodedata.combining(c))

states = list(csv.DictReader((ROOT / 'fontes/estados.csv').open(encoding='utf-8-sig')))
uf = {s['codigo_uf']: s['uf'] for s in states}
municipios = {(norm(c['nome']), uf[c['codigo_uf']]): c for c in csv.DictReader((ROOT / 'fontes/municipios.csv').open())}
rows = list(csv.DictReader((ROOT / 'fontes/transcricao.tsv').open(), delimiter='\t'))
cities = {}
for row in rows:
    key = (norm(row['cidade']), row['uf'])
    if key in cities:
        assert cities[key]['status'] == row['status'], 'Status conflitantes na mesma cidade'
        cities[key]['sourceRows'].append(int(row['linha']))
        continue
    if row['uf'] == 'PY':
        lat, lon, code = -25.50359956, -54.65066969, 'PY-CDE'
    else:
        c = municipios[key]
        lat, lon, code = float(c['latitude']), float(c['longitude']), c['codigo_ibge']
    cities[key] = {'id': str(code), 'city': row['cidade'], 'uf': row['uf'], 'country': 'PY' if row['uf'] == 'PY' else 'BR', 'lat': lat, 'lng': lon, 'status': row['status'], 'sourceRows': [int(row['linha'])], 'note': row['observacao']}
data = {'demo': True, 'reference': '2026-10-08', 'source': 'Unidades fictícias para demonstração', 'sourceRowCount': len(rows), 'cities': sorted(cities.values(), key=lambda c: norm(c['city'])), 'states': [{'uf': s['uf'], 'name': s['nome'], 'lat': float(s['latitude']), 'lng': float(s['longitude'])} for s in states]}
holding = json.loads((ROOT.parent / 'inteligencia-geografica/redes-holding.json').read_text())
for brand in holding['brands']:
    seen = set()
    for row in brand['cities']:
        c = municipios[(norm(row['city']), row['uf'])]
        assert c['codigo_ibge'] not in seen, 'Cidade repetida na mesma marca'
        seen.add(c['codigo_ibge'])
        row.update(id=c['codigo_ibge'], country='BR', lat=float(c['latitude']), lng=float(c['longitude']), reference=holding['reference'], source=holding['source'])
data['holdingNetworks'] = holding['brands']
(ROOT / 'dados.json').write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
template = (ROOT / 'api-template.cjs').read_text()
(SITE / 'mapa-agrobar/demo.json').write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
(SITE / 'api/mapa-agrobar.js').write_text(template.replace('const dataset = /* DATASET */;', "const fs = require('node:fs');\nconst dataset = process.env.FANCORE_GEO_DATA_PATH ? JSON.parse(fs.readFileSync(process.env.FANCORE_GEO_DATA_PATH, 'utf8')) : require('../mapa-agrobar/demo.json');"))
br = SITE / 'mapa-agrobar/assets/brasil.geojson'
if br.read_bytes()[:2] == b'\x1f\x8b':
    br.write_bytes(gzip.decompress(br.read_bytes()))
geo = json.loads(br.read_text())
assert len(geo['features']) == 27
world = json.loads((ROOT / 'fontes/paises.geojson').read_text())
features = [{'type': 'Feature', 'properties': {'name': f['properties']['NAME']}, 'geometry': f['geometry']} for f in world['features'] if f['properties']['CONTINENT'] == 'South America' and f['properties']['ADM0_A3'] != 'BRA']
(SITE / 'mapa-agrobar/assets/vizinhos.geojson').write_text(json.dumps({'type':'FeatureCollection', 'features':features}, separators=(',', ':')))
print(json.dumps({'linhas': len(rows), 'cidades':len(cities), 'status':{s:sum(c['status']==s for c in cities.values()) for s in ['operando','fechou','implantacao','voltou']}, 'repetidas':[c['city'] for c in cities.values() if len(c['sourceRows'])>1]},ensure_ascii=False))
