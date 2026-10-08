"""Confronta cada componente Estica com fontes originais, sem usar gerar.py."""
import csv
import json
from pathlib import Path
from collections import defaultdict

ROOT=Path(__file__).resolve().parents[4]
DATA=ROOT/'05-dashboard/demo/site/inteligencia-geografica/dados'
d=json.loads((DATA/'competitividade.json').read_text())
g={r['id']:r for r in json.loads((DATA/'municipios.json').read_text())['cities']}
e={r['id']:r for r in json.loads((DATA/'estica.json').read_text())['cities']}
with (Path(__file__).parent.parent/'indice-agrobar/indice-agrobar-v0.csv').open(encoding='utf-8-sig') as f:
    agro={r['codigo_ibge']:r for r in csv.DictReader(f,delimiter=';')}
assert len(d['cities'])==len(g)==len(e)==5571

def percentile(value,values):
    if value is None:return None
    values=[v for v in values if v is not None]
    if len(values)==1:return 50
    below=sum(v<value for v in values)
    equal=sum(v==value for v in values)
    return 100*(below+(equal-1)/2)/(len(values)-1)

def band(p):return sum(p>=cut for cut in [25000,50000,100000,250000,500000])

bands=defaultdict(list)
regions=defaultdict(list)
for code,c in g.items():
    b=band(c['metrics']['population']['value']);bands[b].append(code);regions[(c['region'],b)].append(code)
values={k:[c['metrics'].get(k,{}).get('value') for c in g.values()] for k in ['population','medianIncome','density','gdp']}
for r in d['cities']:
    c=g[r['id']];m=lambda k:c['metrics'].get(k,{}).get('value')
    expected=float(agro[r['id']]['indice_agrobar_v0_0a100']) if agro[r['id']]['indice_agrobar_v0_0a100'] else None
    assert r['agrobar']['baseline']==expected
    assert r['population']==m('population') and r['income']==m('medianIncome')
    assert r['gdp']==m('gdp') and r['agroGva']==m('agroGva')
    b=band(m('population'));peers=regions[(c['region'],b)]
    if len(peers)<30:peers=bands[b]
    assert len(peers)==r['peerCount']
    rates=[]
    for k in ['primary','pilatesPrimary']:
        def rate(code):
            record=e[code]
            if not record['covered']:return None
            count=record[k][0] if k=='primary' else record[k]
            return count*10000/g[code]['metrics']['population']['value']
        rates.append(100-percentile(rate(r['id']),[rate(code) for code in peers]))
    competition=round(.7*rates[0]+.3*rates[1],2)
    income=percentile(m('medianIncome'),values['medianIncome'])
    market=None if income is None else round(.4*percentile(m('population'),values['population'])+.6*income,2)
    density=percentile(m('density'),values['density']);fit=None if density is None else round(density,2)
    assert r['estica']['competition']==competition,(r['id'],'competition')
    assert r['estica']['market']==market,(r['id'],'market')
    assert r['estica']['fit']==fit,(r['id'],'fit')
    expected=None if None in [competition,market,fit] else round(.5*competition+.3*market+.2*fit,2)
    assert r['estica']['baseline']==expected
print('5.571 municípios: Agrobar reconciliado com CSV; Estica recalculada independentemente; grupos, denominadores e economia conferidos.')
