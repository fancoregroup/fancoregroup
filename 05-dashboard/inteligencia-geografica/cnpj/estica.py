#!/usr/bin/env python3
"""Concorrência potencial Estica: CNAEs e evidência nominal de Pilates.

Contagens públicas. Identificadores e nomes de auditoria permanecem em work/.
"""
import argparse
import concurrent.futures
import csv
import json
import re
import sqlite3
import time
import unicodedata
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from importar import ROOT, SCHEMA, classify, digest, write_json, zip_rows

PUBLIC=ROOT.parents[1]/'demo/site/inteligencia-geografica/dados'
CNAES={'9313100':1,'8650004':2}
PILATES=4  # Independent name evidence, not a third CNAE category.

def has_pilates(value):
    text=unicodedata.normalize('NFKD',value).encode('ascii','ignore').decode().upper()
    return bool(re.search(r'\bPILATES\b',text))

def companies(filename):
    p=Path(filename);names={};n=0;anomalies=[]
    for row in zip_rows(p,anomalies):
        n+=1
        if len(row)!=7:raise ValueError(f'{p.name} linha {n}: layout inválido')
        if '\ufffd' in row[0] or '\ufffd' in row[1]:raise ValueError('NUL em identificador ou nome empresarial')
        if has_pilates(row[1]):
            if row[0] in names and names[row[0]]!=row[1]:raise ValueError('Razão social conflitante')
            names[row[0]]=row[1]
    print(f'{p.name}: {n:,} empresas, {len(names):,} nomes Pilates',flush=True)
    return names,dict(file=p.name,rows=n,matchedNames=len(names),sha256=digest(p),crcValidated=True,nulAnomalies=anomalies)

def establishments(args):
    filename,workdir,names=args;p=Path(filename);out=Path(workdir)/(p.stem+'.sqlite')
    if out.exists():out.unlink()
    db=sqlite3.connect(out);db.execute('PRAGMA journal_mode=OFF');db.execute(SCHEMA)
    n=active=eligible=duplicate=0;anomalies=[];named=[];start=time.monotonic()
    for row in zip_rows(p,anomalies):
        n+=1
        if len(row)!=30:raise ValueError(f'{p.name} linha {n}: layout inválido')
        if any('\ufffd' in row[i] for i in [0,1,2,4,5,11,12,19,20]):raise ValueError('NUL em campo usado')
        if row[5]!='02':continue
        active+=1;pm,am=classify(row,CNAES)
        if not am:continue
        if [len(x) for x in row[:3]]!=[8,4,2]:raise ValueError('CNPJ inválido')
        cnpj=''.join(row[:3]);fantasy=has_pilates(row[4]);company=row[0] in names
        if fantasy or company:
            am|=PILATES
            if pm:pm|=PILATES
            named.append([cnpj,row[19],row[20],row[4],names.get(row[0],''),'fantasia e razão' if fantasy and company else 'fantasia' if fantasy else 'razão social'])
        record=(cnpj,row[19],row[20],row[11],pm,am)
        try:db.execute('INSERT INTO selected VALUES(?,?,?,?,?,?)',record)
        except sqlite3.IntegrityError:
            if db.execute('SELECT * FROM selected WHERE cnpj=?',(cnpj,)).fetchone()!=record:raise ValueError('CNPJ conflitante')
            duplicate+=1
        eligible+=1
    db.commit();db.close()
    with out.with_suffix('.nomes.csv').open('w',encoding='utf-8',newline='') as f:csv.writer(f,delimiter=';',lineterminator='\n').writerows(named)
    report=dict(file=p.name,rows=n,active=active,eligible=eligible,duplicates=duplicate,named=len(named),sha256=digest(p),crcValidated=True,nulAnomalies=anomalies,seconds=round(time.monotonic()-start,1))
    print(f'{p.name}: {n:,} registros, {eligible:,} selecionados',flush=True)
    return report

def aggregate(db,reports,company_reports):
    cities=json.loads((PUBLIC/'municipios.json').read_text())['cities'];alias={}
    with (ROOT/'correspondencia-municipios.csv').open(encoding='utf-8-sig') as f:
        for r in csv.DictReader(f,delimiter=';'):alias[(r['uf'],r['codigo_receita'])]=r['codigo_ibge']
    data={c['id']:dict(id=c['id'],covered=c['id'] in alias.values(),primary=[0,0],any=[0,0],totalPrimary=0,totalAny=0,pilatesPrimary=0,pilatesAny=0) for c in cities}
    excluded={}
    for uf,code,pm,am,n in db.execute('SELECT uf,municipio,primary_mask,any_mask,count(*) FROM selected GROUP BY uf,municipio,primary_mask,any_mask'):
        id=alias.get((uf,code))
        if not id:excluded[(uf,code)]=excluded.get((uf,code),0)+n;continue
        r=data[id];r['totalAny']+=n;r['totalPrimary']+=n if pm&3 else 0
        r['pilatesAny']+=n if am&PILATES else 0;r['pilatesPrimary']+=n if pm&PILATES else 0
        for i in range(2):
            if pm&(1<<i):r['primary'][i]+=n
            if am&(1<<i):r['any'][i]+=n
    unique=db.execute('SELECT count(*) FROM selected').fetchone()[0]
    totals={k:sum(r[k] for r in data.values()) for k in ['totalPrimary','totalAny','pilatesPrimary','pilatesAny']}
    totals['primary']=[sum(r['primary'][i] for r in data.values()) for i in range(2)];totals['any']=[sum(r['any'][i] for r in data.values()) for i in range(2)]
    assert sum(totals['primary'])==totals['totalPrimary']
    assert totals['totalAny']+sum(excluded.values())==unique
    coverage=dict(rows=sum(r['rows'] for r in reports),activeRows=sum(r['active'] for r in reports),uniqueSelected=unique,mapped=totals['totalAny'],unmapped=sum(excluded.values()),foreign=sum(n for (uf,code),n in excluded.items() if uf=='EX'),coveredCities=sum(r['covered'] for r in data.values()),totalCities=len(cities),missingCities=[])
    result=dict(reference='2026-09',sector='estica',generatedAt=datetime.now(ZoneInfo('America/Sao_Paulo')).isoformat(),method='cnpj-estica-v1',source='https://arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9',coverage=coverage,
        taxonomy=[dict(id='academias',label='Academias e condicionamento físico',cnaes=['9313100']),dict(id='fisioterapia',label='Fisioterapia (atividade relacionada)',cnaes=['8650004'])],totals=totals,cities=list(data.values()))
    (PUBLIC/'estica.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
    with (PUBLIC/'estica-municipios.csv').open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.writer(f,delimiter=';',lineterminator='\n');w.writerow(['codigo_ibge','cidade','uf','referencia','total_principal','total_principal_ou_secundaria','academias_principal','academias_principal_ou_secundaria','fisioterapia_principal','fisioterapia_principal_ou_secundaria','pilates_nome_principal','pilates_nome_principal_ou_secundaria'])
        for c in cities:
            r=data[c['id']];w.writerow([c['id'],c['name'],c['uf'],'2026-09',r['totalPrimary'],r['totalAny'],r['primary'][0],r['any'][0],r['primary'][1],r['any'][1],r['pilatesPrimary'],r['pilatesAny']])
    audit=dict(coverage=coverage,totals=totals,companyFiles=company_reports,establishmentFiles=reports,excluded=[dict(uf=k[0],municipio=k[1],count=n) for k,n in excluded.items()],nameRule='Palavra inteira PILATES, sem acentos e sem distinção de caixa, em nome fantasia ou razão social. Exige CNAE 9313100 ou 8650004 ativo. Não confirma oferta ou funcionamento.',crosswalkSha256=digest(ROOT/'correspondencia-municipios.csv'))
    write_json(ROOT/'estica-auditoria.json',audit);write_json(PUBLIC/'estica-auditoria.json',audit)
    print(json.dumps(dict(coverage=coverage,totals=totals),ensure_ascii=False),flush=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--workers',type=int,default=4);args=p.parse_args()
    work=ROOT/'work/estica';work.mkdir(parents=True,exist_ok=True)
    names={};company_reports=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for found,report in pool.map(companies,[str(args.source/f'Empresas{i}.zip') for i in range(10)]):
            if names.keys()&found.keys():raise ValueError('Bases repetidas entre arquivos Empresas')
            names.update(found);company_reports.append(report)
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        reports=list(pool.map(establishments,[(str(args.source/f'Estabelecimentos{i}.zip'),str(work),names) for i in range(10)]))
    final=work/'selecionados.sqlite'
    if final.exists():final.unlink()
    db=sqlite3.connect(final);db.execute(SCHEMA)
    for i in range(10):
        db.execute('ATTACH DATABASE ? AS part',(str(work/f'Estabelecimentos{i}.sqlite'),));db.execute('INSERT INTO selected SELECT * FROM part.selected');db.commit();db.execute('DETACH DATABASE part')
    aggregate(db,reports,company_reports);db.close()

if __name__=='__main__':main()
