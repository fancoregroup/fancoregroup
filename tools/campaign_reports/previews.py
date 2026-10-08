"""Recupera miniaturas em 800 px. Não altera anúncios nem gera novas imagens."""
from collect import OUT,env,get,save,ReadError
import json
from concurrent.futures import ThreadPoolExecutor
for brand in ['estica','agrobar']:
 path=OUT/('meta-'+brand+'.json')
 if not path.exists():continue
 data=json.loads(path.read_text());key=env(f'meta-ads-{brand}-2026-10-03.env')[f'META_{brand.upper()}_ACCESS_TOKEN']
 creative_ids=sorted({a['creative']['id'] for a in data['ads'].values() if a.get('creative')})
 def fetch(id):
  try:return id,get('https://graph.facebook.com/v24.0',id,{'fields':'thumbnail_url','thumbnail_width':800,'thumbnail_height':800},key).get('thumbnail_url')
  except ReadError:return id,None
 with ThreadPoolExecutor(max_workers=3) as pool:previews=dict(pool.map(fetch,creative_ids))
 for ad in data['ads'].values():
  c=ad.get('creative',{})
  if previews.get(c.get('id')):c['preview_url']=previews[c['id']]
 save('meta-'+brand,data);print(brand,'previews ampliados',sum(bool(v) for v in previews.values()),'/',len(creative_ids),flush=True)
