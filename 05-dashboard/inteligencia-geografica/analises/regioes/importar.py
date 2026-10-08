#!/usr/bin/env python3
"""Extrai o ano 2023 do XLSX IBGE sem alterar a planilha (somente stdlib)."""
import argparse
import csv
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from collections import Counter
from decimal import Decimal
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
OUT = ROOT / '05-dashboard/demo/site/inteligencia-geografica/dados'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
SOURCE = 'https://ftp.ibge.gov.br/Pib_Municipios/2022_2023/base/base_de_dados_2010_2023_xlsx.zip'

def read_rows(path):
    with ZipFile(path) as z:
        strings = [''.join(t.text or '' for t in s.findall('.//m:t', NS))
                   for s in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)]
        with z.open('xl/worksheets/sheet1.xml') as f:
            for _, el in ET.iterparse(f, events=['end']):
                if el.tag != '{'+NS['m']+'}row':
                    continue
                row = {}
                for c in el:
                    v = c.find('m:v', NS)
                    value = None if v is None else strings[int(v.text)] if c.get('t') == 's' else v.text
                    row[re.sub(r'\d', '', c.get('r'))] = value
                yield row
                el.clear()

def main(path):
    geo = json.loads((OUT/'municipios.json').read_text())
    cities = {c['id']: c for c in geo['cities']}
    records, years, header, diffs = [], Counter(), None, []
    seen = set()
    for r in read_rows(path):
        if header is None:
            header = r
            assert r['A'] == 'Ano' and r['G'] == 'Código do Município'
            assert 'per capita' in r['AN'] and '(R$ 1,00)' in r['AN']
            assert 'Produto Interno Bruto,' in r['AM'] and '(R$ 1.000)' in r['AM']
            continue
        if not r.get('A', '').isdigit():
            continue
        years[r['A']] += 1
        if r['A'] != '2023':
            continue
        code = r['G']
        assert code in cities and code not in seen, code
        seen.add(code)
        number = lambda k, scale=1: float(Decimal(r[k])*scale) if r.get(k) not in [None, '', '-', '...'] else None
        gdp = round(number('AM', 1000), 2)
        old = cities[code]['metrics'].get('gdp', {}).get('value')
        if old is not None and abs(old-gdp) > 500.01:
            diffs.append(dict(id=code, existing=old, workbook=gdp))
        records.append(dict(id=code, name=r['H'], uf=r['E'], macroId=r['B'], macro=r['C'],
            intermediateId=r['Q'], intermediate=r['R'], intermediateRole=r['S'],
            immediateId=r['N'], immediate=r['O'], immediateRole=r['P'],
            hierarchy=r['Y'], gdp=gdp, gdpPerCapita=number('AN')))
    assert len(records) == 5570
    assert all(r['gdp'] is not None and r['gdpPerCapita'] is not None for r in records)
    assert not diffs, f'PIB diverge do SIDRA: {diffs[:3]}'
    records.sort(key=lambda r:r['id'])
    payload = dict(version='regioes-pib-2023-v1', year=2023,
        source=dict(url=SOURCE, file=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                    columns={k:header[k] for k in ['A','G','N','O','P','Q','R','S','Y','AM','AN']}), cities=records)
    (OUT/'regioes-pib.json').write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n')
    with (OUT/'regioes-pib.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.writer(f,delimiter=';',lineterminator='\n')
        writer.writerow(['IBGE','Município','UF','Grande região','Código intermediária','Região intermediária','Papel intermediária','Código imediata','Região imediata','Papel imediata','Hierarquia da planilha','PIB R$ 2023','PIB per capita R$ 2023'])
        for r in records:writer.writerow([r[k] for k in ['id','name','uf','macro','intermediateId','intermediate','intermediateRole','immediateId','immediate','immediateRole','hierarchy','gdp','gdpPerCapita']])
    audit=dict(source=payload['source'], rowsByYear=dict(years), imported=5570,
        regions={k:len({r[k+'Id'] for r in records}) for k in ['macro','intermediate','immediate']},
        roles={k:dict(Counter(r[k+'Role'] for r in records)) for k in ['intermediate','immediate']},
        missing=[dict(id=c['id'],name=c['name']) for c in cities.values() if c['id'] not in seen],
        gdpTotal=sum(r['gdp'] for r in records), gdpDivergences=diffs, gdpReconciliationToleranceBRL=500.01,
        note='PIB em mil reais convertido para reais; per capita oficial preservado. Sem população 2026 no denominador. Regionalização e hierarquia conforme planilha, sem inferir fluxos comerciais.')
    (HERE/'auditoria.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in audit.items() if k!='source'},ensure_ascii=False,indent=2))

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('xlsx',type=Path)
    main(parser.parse_args().xlsx)
