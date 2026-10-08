#!/usr/bin/env python3
"""Snapshots pontuais OSM: a aplicação consulta arquivos, nunca o servidor público Overpass."""
import argparse
import csv
import datetime as dt
import gzip
import hashlib
import json
import math
import pathlib
import time
import urllib.request
import urllib.error

ROOT=pathlib.Path(__file__).resolve().parent
SITE=ROOT.parent/'demo/site/inteligencia-geografica'
RAW=ROOT/'fontes/osm'
OUT=SITE/'dados/entorno'
ENDPOINT='https://overpass-api.de/api/interpreter'
RADIUS=5000
TYPES={'bar':'Bar','pub':'Pub','nightclub':'Casa noturna','restaurant':'Restaurante','cafe':'Café','fitness_centre':'Academia'}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--municipios', help='Códigos IBGE separados por vírgula. Padrão: cidades brasileiras da planilha Agrobar.')
    parser.add_argument('--refresh',action='store_true')
    args=parser.parse_args()
    RAW.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
    cities={c['id']:c for c in json.loads((SITE/'dados/municipios.json').read_text())['cities']}
    network=json.loads((ROOT.parent/'mapa-agrobar/dados.json').read_text())['cities']
    ids=args.municipios.split(',') if args.municipios else sorted(c['id'] for c in network if c['country']=='BR')
    errors=[]
    for code in ids:
        city=cities[code]
        target=OUT/(code+'.json')
        if target.exists() and not args.refresh:continue
        lat,lng=city['lat'],city['lng']
        query=f'[out:json][timeout:35];(nwr(around:{RADIUS},{lat},{lng})[amenity~"^(bar|pub|nightclub|restaurant|cafe)$"];nwr(around:{RADIUS},{lat},{lng})[leisure=fitness_centre];);out center tags;'
        try:
            req=urllib.request.Request(ENDPOINT,data=query.encode(),headers={'Content-Type':'text/plain','User-Agent':'FancoreGeo/1.0 local research snapshot'})
            with urllib.request.urlopen(req,timeout=60) as response:body=response.read()
            if body[:2]==b'\x1f\x8b':body=gzip.decompress(body)
            raw=json.loads(body)
            if raw.get('remark'):raise ValueError(raw['remark'])
            (RAW/(code+'.json')).write_bytes(body)
            pois=[];seen=set()
            for element in raw['elements']:
                tags=element.get('tags',{});point=element.get('center',element)
                if 'lat' not in point or 'lon' not in point:continue
                category=tags.get('amenity') or tags.get('leisure')
                name=tags.get('name','Sem nome no OpenStreetMap')
                # Remove representações repetidas com mesmo nome e coordenadas arredondadas.
                key=(name,round(point['lat'],4),round(point['lon'],4),category)
                if key in seen:continue
                seen.add(key)
                pois.append({'id':str(element['id']),'type':element['type'],'name':name,'category':category,'label':TYPES.get(category,category),'lat':point['lat'],'lng':point['lon'],'street':tags.get('addr:street',''),'number':tags.get('addr:housenumber',''),'source':f"https://www.openstreetmap.org/{element['type']}/{element['id']}"})
            data={'cityId':code,'city':city['name'],'center':{'lat':lat,'lng':lng},'radiusMeters':RADIUS,'collectedAt':dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).isoformat(timespec='seconds'),'osmBaseTime':raw.get('osm3s',{}).get('timestamp_osm_base'),'source':ENDPOINT,'query':query,'license':'OpenStreetMap contributors, ODbL 1.0','rawSha256':hashlib.sha256(body).hexdigest(),'note':'Estabelecimentos mapeados no OSM em até 5 km do ponto municipal aproximado. Cobertura colaborativa, não exaustiva; não confirma funcionamento nem concorrência direta. Ways/relations usam centro da geometria.','pois':pois}
            target.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
            print(city['name'],len(pois),flush=True)
        except Exception as error:
            errors.append({'cityId':code,'city':city['name'],'error':str(error)})
            print('Falha',city['name'],str(error),flush=True)
            if isinstance(error, urllib.error.HTTPError) and error.code == 429:
                retry = error.headers.get('Retry-After', '30')
                time.sleep(min(60, max(30, int(retry) if retry.isdigit() else 30)))
            else:
                time.sleep(15)
        time.sleep(5)
    # Inclui todos os snapshots existentes, inclusive cidades adicionais coletadas antes.
    entries=[];rows=[]
    for path in sorted(OUT.glob('*.json')):
        if path.name=='index.json':continue
        data=json.loads(path.read_text())
        def within(p):
            a,b=data['center'],p
            dlat=math.radians(b['lat']-a['lat']);dlon=math.radians(b['lng']-a['lng'])
            h=math.sin(dlat/2)**2+math.cos(math.radians(a['lat']))*math.cos(math.radians(b['lat']))*math.sin(dlon/2)**2
            return 6371000*2*math.atan2(math.sqrt(h),math.sqrt(max(0,1-h)))<=data['radiusMeters']
        data['pois']=[p for p in data['pois'] if within(p)]
        data['note']='Coordenadas representativas em até 5 km do ponto municipal aproximado. Cobertura colaborativa, não exaustiva; não confirma funcionamento nem concorrência direta. Ways/relations usam centro da geometria.'
        path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
        entries.append({k:data[k] for k in ['cityId','city','collectedAt','radiusMeters'] }|{'count':len(data['pois'])})
        rows.extend({'codigo_ibge':data['cityId'],'municipio':data['city'],'coletado_em':data['collectedAt'],**p} for p in data['pois'])
    (OUT/'index.json').write_text(json.dumps({'snapshots':entries,'uniquePois':len({(p['type'],p['id']) for p in rows}),'errors':errors,'license':'https://www.openstreetmap.org/copyright'},ensure_ascii=False,indent=2))
    if rows:
        with (ROOT/'exportacoes/estabelecimentos-osm.csv').open('w',encoding='utf-8-sig',newline='') as file:
            writer=csv.DictWriter(file,fieldnames=list(rows[0]),delimiter=';',lineterminator='\n');writer.writeheader();writer.writerows(rows)
    print(json.dumps({'cidades':len(entries),'registros':len(rows),'falhas':errors},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
