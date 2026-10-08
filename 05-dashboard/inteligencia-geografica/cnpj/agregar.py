#!/usr/bin/env python3
"""Agrega o SQLite local, cruza TOM/IBGE oficial e publica apenas totais municipais."""
import collections
import csv
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from importar import ROOT, digest, normalize, write_json, zip_rows

PUBLIC = ROOT.parents[1]/'demo/site/inteligencia-geografica/dados'
SOURCE_URL = 'https://www.gov.br/receitafederal/dados/municipios.csv'

def main():
    base=json.loads((PUBLIC/'municipios.json').read_text()); cities={c['id']:c for c in base['cities']}
    taxonomy=json.loads((ROOT/'taxonomia.json').read_text()); size=len(taxonomy)
    source=json.loads((ROOT/'inventario.json').read_text())['source']
    towns=dict(zip_rows(Path(source)/'Municipios.zip'))
    aliases={}; covered=set(); official=[]
    with (ROOT/'municipios-tom-ibge.csv').open(encoding='latin1',newline='') as f:
        rows=csv.reader(f,delimiter=';'); next(rows)
        for r in rows:
            code,ibge,uf=r[0].zfill(4),r[1],r[4]
            if uf=='EX' and ibge=='0': continue
            if ibge not in cities or cities[ibge]['uf'] != uf: raise ValueError('Correspondência oficial incompatível: '+str(r))
            if (uf,code) in aliases: raise ValueError('TOM duplicado')
            aliases[(uf,code)]=ibge; covered.add(ibge); official.append([uf,code,ibge,'TOM oficial'])
    name_index={}
    for c in cities.values():
        k=(c['uf'],normalize(c['name']))
        if k in name_index: raise ValueError('Nome ambíguo na mesma UF')
        name_index[k]=c['id']
    db=sqlite3.connect(ROOT/'work/estabelecimentos-selecionados.sqlite')
    groups=db.execute('SELECT uf,municipio,primary_mask,any_mask,count(*) FROM selected GROUP BY uf,municipio,primary_mask,any_mask')
    data={id:dict(id=id,primary=[0]*size,any=[0]*size,totalPrimary=0,totalAny=0,barsPrimary=0,barsAny=0) for id in cities}
    unmapped=collections.Counter(); foreign=0; bars_mask=sum(1<<i for i,c in enumerate(taxonomy) if c['id'].startswith('bares_'))
    for uf,code,pm,am,count in groups:
        ibge=aliases.get((uf,code))
        if not ibge:
            ibge=name_index.get((uf,normalize(towns.get(code,''))))
            if ibge:
                aliases[(uf,code)]=ibge; covered.add(ibge); official.append([uf,code,ibge,'UF + nome normalizado exato'])
        if not ibge:
            unmapped[(uf,code,towns.get(code,''))]+=count
            if uf=='EX': foreign+=count
            continue
        r=data[ibge]; r['totalAny']+=count; r['totalPrimary']+=count if pm else 0
        r['barsPrimary']+=count if pm&bars_mask else 0; r['barsAny']+=count if am&bars_mask else 0
        for i in range(size):
            if pm&(1<<i): r['primary'][i]+=count
            if am&(1<<i): r['any'][i]+=count
    for id,r in data.items():
        r['covered']=id in covered
        if not r['covered']:
            for k in ['primary','any','totalPrimary','totalAny','barsPrimary','barsAny']: r[k]=None
    totals={k:sum(r[k] or 0 for r in data.values()) for k in ['totalPrimary','totalAny','barsPrimary','barsAny']}
    totals['primary']=[sum(r['primary'][i] for r in data.values() if r['covered']) for i in range(size)]
    totals['any']=[sum(r['any'][i] for r in data.values() if r['covered']) for i in range(size)]
    consolidation=json.loads((ROOT/'consolidacao.json').read_text()); reading=json.loads((ROOT/'leitura.json').read_text())
    assert totals['totalAny']+sum(unmapped.values())==consolidation['uniqueSelected']
    assert sum(totals['primary'])==totals['totalPrimary']
    assert all(r['totalAny']>=r['totalPrimary'] for r in data.values() if r['covered'])
    audit=dict(**consolidation,mapped=totals['totalAny'],unmapped=sum(unmapped.values()),foreign=foreign,coveredCities=len(covered),totalCities=len(cities),
               missingCities=[dict(id=c['id'],name=c['name'],uf=c['uf']) for c in cities.values() if c['id'] not in covered],
               unmatched=[dict(uf=k[0],code=k[1],name=k[2],count=v) for k,v in sorted(unmapped.items())],
               crosswalk=dict(url=SOURCE_URL,sha256=digest(ROOT/'municipios-tom-ibge.csv')),totals=totals)
    write_json(ROOT/'auditoria.json',audit)
    with (ROOT/'correspondencia-municipios.csv').open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.writer(f,delimiter=';');w.writerow(['uf','codigo_receita','codigo_ibge','metodo']);w.writerows(sorted(official))
    result=dict(reference='2026-09',generatedAt=datetime.now(ZoneInfo('America/Sao_Paulo')).isoformat(),
                method='cnpj-lazer-v1',source='https://arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9',
                coverage={k:audit[k] for k in ['rows','activeRows','uniqueSelected','mapped','unmapped','foreign','coveredCities','totalCities','missingCities']},
                taxonomy=taxonomy,totals=totals,cities=list(data.values()))
    (PUBLIC/'cnpj.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
    header=['codigo_ibge','cidade','uf','cobertura','referencia','total_principal','total_principal_ou_secundaria','bares_principal','bares_principal_ou_secundaria']
    for cat in taxonomy: header += [cat['id']+'_principal',cat['id']+'_principal_ou_secundaria']
    with (PUBLIC/'cnpj-municipios.csv').open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.writer(f,delimiter=';');w.writerow(header)
        for c in sorted(cities.values(),key=lambda c:(c['uf'],c['name'])):
            r=data[c['id']]; row=[c['id'],c['name'],c['uf'],'Mapeado' if r['covered'] else 'Sem correspondência','2026-09',r['totalPrimary'],r['totalAny'],r['barsPrimary'],r['barsAny']]
            for i in range(size): row += [r['primary'][i] if r['covered'] else None,r['any'][i] if r['covered'] else None]
            w.writerow(row)
    write_json(PUBLIC/'cnpj-auditoria.json',audit)
    print(json.dumps({k:v for k,v in audit.items() if k not in ['totals']},ensure_ascii=False,indent=2))

if __name__=='__main__': main()
