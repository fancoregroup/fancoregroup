#!/usr/bin/env python3
"""Publica insumos públicos e componentes versionados, sem dados da rede."""
import bisect
import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SITE = ROOT / '05-dashboard/demo/site/inteligencia-geografica/dados'
HERE = Path(__file__).resolve().parent
AGRO = HERE.parent / 'indice-agrobar/indice-agrobar-v0.csv'

def percentile(v, values):
    if v is None or not values:
        return None
    return 50 if len(values) == 1 else 100 * (bisect.bisect_left(values, v) + bisect.bisect_right(values, v) - 1) / (2 * (len(values) - 1))

def generate():
    geo = json.loads((SITE / 'municipios.json').read_text())
    regional = {r['id']:r for r in json.loads((SITE/'regioes-pib.json').read_text())['cities']}
    estica = json.loads((SITE / 'estica.json').read_text())
    est = {r['id']: r for r in estica['cities']}
    with AGRO.open(encoding='utf-8-sig') as f:
        agro = {r['codigo_ibge']: r for r in csv.DictReader(f, delimiter=';')}
    def val(r, k):
        return float(r[k]) if r[k] else None
    rows = []
    for c in geo['cities']:
        a, e = agro[c['id']], est[c['id']]
        m = lambda k: c['metrics'].get(k, {}).get('value')
        pop = m('population')
        rows.append(dict(id=c['id'], group=a['grupo_comparacao'], band=a['faixa_populacao'], region=c['region'],
            population=pop, income=m('medianIncome'), density=m('density'), gdp=m('gdp'), agroShare=m('agroShare'), agroGva=m('agroGva'),
            pickups=val(a,'caminhonetes_pct_veiculos_leves'), bars=val(a,'bares_cnpj_principal_set2026'),
            nightlife=val(a,'bares_com_entretenimento_cnpj_principal_set2026')+val(a,'casas_noturnas_cnpj_principal_set2026'),
            barRate=val(a,'bares_por_10mil_hab'), nightlifeRate=val(a,'entretenimento_por_10mil_hab'),
            gyms=e['primary'][0] if e['covered'] else None, pilates=e['pilatesPrimary'] if e['covered'] else None,
            gymRate=e['primary'][0]*10000/pop if e['covered'] and pop else None,
            pilatesRate=e['pilatesPrimary']*10000/pop if e['covered'] and pop else None,
            agrobar=dict(competition=val(a,'score_concorrencia_0a100'),fit=val(a,'score_cultura_proxy_0a100'),market=val(a,'score_escala_renda_0a100'),baseline=val(a,'indice_agrobar_v0_0a100'))))
    for r in rows:
        source = regional.get(r['id'], {})
        for key in ['gdpPerCapita','intermediateId','intermediate','immediateId','immediate','intermediateRole','immediateRole','hierarchy']:
            r[key] = source.get(key)
    groups = defaultdict(list)
    for r in rows:
        groups[r['band']].append(r)
        groups[r['region']+' / '+r['band']].append(r)
    distributions = {k: sorted(r[k] for r in rows if r[k] is not None) for k in ['population','income','density','gdp']}
    for r in rows:
        peers = groups[r['band']] if r['group'].startswith('Brasil / ') else groups[r['group']]
        r['peerCount'] = len(peers)
        comps = []
        for k in ['gymRate','pilatesRate']:
            p = percentile(r[k], sorted(x[k] for x in peers if x[k] is not None))
            comps.append(None if p is None else 100-p)
        p = {k: percentile(r[k],v) for k,v in distributions.items()}
        competition = None if None in comps else round(.7*comps[0]+.3*comps[1],2)
        market = None if p['income'] is None else round(.4*p['population']+.6*p['income'],2)
        fit = None if p['density'] is None else round(p['density'],2)
        r['estica'] = dict(competition=competition, market=market, fit=fit, baseline=None if None in [competition,market,fit] else round(.5*competition+.3*market+.2*fit,2))
        for b in ['agrobar','estica']:
            r[b]['economy'] = None if p['gdp'] is None else round(p['gdp'],2)
    result = dict(version='competitividade-v1',reference='2026-09-27', status='Revisão', cities=rows,
        defaults=dict(agrobar=dict(competition=60,fit=25,market=15,economy=0),estica=dict(competition=50,fit=20,market=30,economy=0)),
        sources=[dict(file=str(f.relative_to(ROOT)),sha256=hashlib.sha256(f.read_bytes()).hexdigest()) for f in [AGRO,SITE/'municipios.json',SITE/'estica.json',SITE/'regioes-pib.json']],
        years=dict(population=2026,income=2022,density=2022,gdp=2023,gdpPerCapita=2023,agroShare=2021,agroGva=2021,pickups='2026-07',cnpj='2026-09'))
    (SITE/'competitividade.json').write_text(json.dumps(result, ensure_ascii=False,separators=(',',':'))+'\n')
    audit = dict(version=result['version'],rows=len(rows),coverage={b:sum(r[b]['baseline'] is not None for r in rows) for b in ['agrobar','estica']},sources=result['sources'])
    (HERE/'auditoria.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(audit,ensure_ascii=False))

if __name__=='__main__':
    generate()
