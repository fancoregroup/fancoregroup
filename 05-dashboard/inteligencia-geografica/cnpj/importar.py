#!/usr/bin/env python3
"""Leitura nacional em fluxo. Arquivos originais e CNPJs individuais ficam locais.

python3 importar.py --source /Users/lucasmarcato/Downloads/2026-09 --workers 4
Reexecução reutiliza partes com o mesmo hash e taxonomia; agregação é independente.
"""
import argparse
import collections
import concurrent.futures
import csv
import hashlib
import io
import json
import re
import sqlite3
import time
import unicodedata
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCHEMA = 'CREATE TABLE selected(cnpj TEXT PRIMARY KEY, uf TEXT, municipio TEXT, primary_cnae TEXT, primary_mask INTEGER, any_mask INTEGER) WITHOUT ROWID'

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(8*1024*1024), b''): h.update(block)
    return h.hexdigest()

def zip_rows(path, anomalies=None):
    with zipfile.ZipFile(path) as z:
        if len(z.namelist()) != 1: raise ValueError('Esperado um CSV: '+str(path))
        with z.open(z.namelist()[0]) as f:
            def lines():
                for n, line in enumerate(io.TextIOWrapper(f, encoding='latin1', newline=''),1):
                    if '\x00' in line:
                        if anomalies is not None: anomalies.append(dict(physicalLine=n,nulBytes=line.count('\x00')))
                        # Preserve the corrupt character as a sentinel, never join identifiers.
                        line=line.replace('\x00','\ufffd')
                    yield line
            yield from csv.reader(lines(), delimiter=';')

def classify(row, cnaes):
    primary = cnaes.get(row[11].strip(), 0)
    mask = primary
    for cnae in row[12].split(','): mask |= cnaes.get(cnae.strip(), 0)
    return primary, mask

def scan(args):
    filename, workdir, cnaes = args
    path, work = Path(filename), Path(workdir)
    key = hashlib.sha256(('parser-v2'+json.dumps(cnaes, sort_keys=True)).encode()).hexdigest()
    sha = digest(path)
    out = work/(path.stem+'.sqlite')
    meta = out.with_suffix('.json')
    if meta.exists() and out.exists():
        prior = json.loads(meta.read_text())
        if prior.get('sha256') == sha and prior.get('taxonomyHash') == key:
            print(path.name+': cache validado', flush=True)
            return prior
    if out.exists(): out.unlink()
    db = sqlite3.connect(out)
    db.execute('PRAGMA journal_mode=OFF'); db.execute('PRAGMA synchronous=OFF')
    db.execute(SCHEMA)
    rows = active = eligible = duplicates = 0
    batch = []; places = collections.Counter(); statuses = collections.Counter(); anomalies=[]; corrupt_fields=collections.Counter()
    start = time.monotonic()
    def flush():
        nonlocal duplicates
        for record in batch:
            try: db.execute('INSERT INTO selected VALUES (?,?,?,?,?,?)', record)
            except sqlite3.IntegrityError:
                previous = db.execute('SELECT * FROM selected WHERE cnpj=?',(record[0],)).fetchone()
                if previous != record: raise ValueError('CNPJ duplicado conflitante em '+path.name)
                duplicates += 1
        db.commit(); batch.clear()
    for row in zip_rows(path, anomalies):
        rows += 1
        if len(row) != 30: raise ValueError(f'{path.name}: linha {rows} tem {len(row)} campos')
        for i,field in enumerate(row):
            if '\ufffd' in field:
                corrupt_fields[i]+=1
                if i in [0,1,2,5,11,12,19,20]: raise ValueError(f'Caractere NUL em campo usado: {path.name}, linha {rows}, coluna {i}')
        statuses[row[5]] += 1
        if row[5] != '02': continue
        active += 1
        primary, mask = classify(row, cnaes)
        if not mask: continue
        if [len(v) for v in row[:3]] != [8,4,2]: raise ValueError('Identificador fora do layout')
        eligible += 1; places[(row[19], row[20])] += 1
        batch.append((''.join(row[:3]), row[19], row[20], row[11], primary, mask))
        if len(batch) >= 5000: flush()
        if eligible % 100000 == 0: print(f'{path.name}: {rows:,} linhas, {eligible:,} selecionados', flush=True)
    flush(); db.close()
    result = dict(file=path.name, sha256=sha, taxonomyHash=key, rows=rows, active=active,
                  eligible=eligible, duplicates=duplicates, statuses=dict(statuses), crcValidated=True,
                  municipalities=[dict(uf=k[0],code=k[1],count=v) for k,v in sorted(places.items())],
                  seconds=round(time.monotonic()-start,1),nulAnomalies=anomalies,nulFieldCounts=dict(corrupt_fields))
    write_json(meta, result)
    print(f'{path.name}: concluído, {rows:,} linhas em {result["seconds"]}s', flush=True)
    return result

def normalize(value):
    return re.sub('[^A-Z0-9]', '', unicodedata.normalize('NFKD',value.upper()).encode('ascii','ignore').decode())

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--source',type=Path,required=True); parser.add_argument('--workers',type=int,default=4)
    args=parser.parse_args(); work=ROOT/'work'; work.mkdir(exist_ok=True)
    taxonomy=json.loads((ROOT/'taxonomia.json').read_text())
    cnaes={code:1<<i for i,cat in enumerate(taxonomy) for code in cat['cnaes']}
    names=dict(zip_rows(args.source/'Cnaes.zip')); towns=dict(zip_rows(args.source/'Municipios.zip'))
    for code in cnaes:
        if code not in names: raise ValueError('CNAE ausente: '+code)
    write_json(ROOT/'cnaes-utilizados.json',{code:names[code] for code in cnaes})
    inventory=[]
    for path in sorted(args.source.glob('*.zip')):
        with zipfile.ZipFile(path) as z:
            inventory.append(dict(file=path.name,bytes=path.stat().st_size,members=[dict(name=i.filename,bytes=i.file_size,crc=f'{i.CRC:08x}',date=list(i.date_time)) for i in z.infolist()]))
    write_json(ROOT/'inventario.json',dict(source=str(args.source),reference='2026-09',files=inventory))
    tasks=[]
    for n in range(10):
        path=args.source/f'Estabelecimentos{n}.zip'
        if not path.exists(): raise FileNotFoundError(path)
        tasks.append((str(path),str(work),cnaes))
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        reports=list(pool.map(scan,tasks))
    write_json(ROOT/'leitura.json',dict(reference='2026-09',parts=reports,helpers=[dict(file=f,sha256=digest(args.source/f),crcValidated=True) for f in ['Cnaes.zip','Municipios.zip']]))
    final=work/'estabelecimentos-selecionados.sqlite'
    if final.exists(): final.unlink()
    db=sqlite3.connect(final); db.execute('PRAGMA journal_mode=OFF'); db.execute(SCHEMA)
    duplicates=0
    for task in tasks:
        db.execute('ATTACH DATABASE ? AS part',(str(work/(Path(task[0]).stem+'.sqlite')),))
        conflicts=db.execute('SELECT count(*) FROM selected a JOIN part.selected b USING(cnpj) WHERE a.uf!=b.uf OR a.municipio!=b.municipio OR a.primary_cnae!=b.primary_cnae OR a.primary_mask!=b.primary_mask OR a.any_mask!=b.any_mask').fetchone()[0]
        if conflicts: raise ValueError('CNPJs conflitantes entre partes')
        duplicates+=db.execute('SELECT count(*) FROM selected JOIN part.selected USING(cnpj)').fetchone()[0]
        db.execute('INSERT OR IGNORE INTO selected SELECT * FROM part.selected'); db.commit(); db.execute('DETACH DATABASE part')
    total=db.execute('SELECT count(*) FROM selected').fetchone()[0]; db.close()
    write_json(ROOT/'consolidacao.json',dict(uniqueSelected=total,crossPartDuplicates=duplicates,withinPartDuplicates=sum(r['duplicates'] for r in reports),rows=sum(r['rows'] for r in reports),activeRows=sum(r['active'] for r in reports)))
    print(f'Consolidado: {total:,} CNPJs selecionados. Execute agregar.py.',flush=True)

if __name__ == '__main__': main()
