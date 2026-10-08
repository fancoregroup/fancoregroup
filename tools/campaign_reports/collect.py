"""Coleta de leitura para os painéis por marca. Segredos e fontes ficam fora do Git."""
import concurrent.futures as futures
import json, os, time
from datetime import datetime
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.parse import urlencode
from urllib.error import HTTPError
from zoneinfo import ZoneInfo

TZ=ZoneInfo('America/Sao_Paulo')
ROOT=Path.home()/'.secrets/fancore'
OUT=Path.home()/'.local/share/fancore/campaign-reports'
START='2026-09-01'
END=datetime.now(TZ).date().isoformat()
class ReadError(Exception): pass
class NoRedirect(HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs): return None

def env(name):
 p=ROOT/name
 if p.stat().st_mode & 0o077: raise ReadError('Credencial deve ter permissão 600.')
 return {k:v.strip().strip('"').strip("'").replace('\\n','\n') for k,v in (l.split('=',1) for l in p.read_text().splitlines() if '=' in l and not l.startswith('#'))}

def save(name,value):
 OUT.mkdir(parents=True,exist_ok=True,mode=0o700)
 p=OUT/(name+'.json');tmp=p.with_suffix('.tmp')
 with open(tmp,'w') as f:
  os.chmod(tmp,0o600); json.dump(value,f,ensure_ascii=False,allow_nan=False)
 tmp.replace(p)

def get(base,path,params=None,key=None):
 if base not in ['https://graph.facebook.com/v24.0','https://crm.rdstation.com/api/v1','https://app.axivia.com.br/api/v1']: raise ReadError('Host inesperado')
 url=base+'/'+path+('?' + urlencode(params) if params else '')
 headers={'Accept':'application/json'}
 if key: headers['Authorization']='Bearer '+key
 for n in range(4):
  try:
   with build_opener(NoRedirect).open(Request(url,headers=headers),timeout=45) as r: return json.load(r)
  except HTTPError as e:
   if (e.code==429 or e.code>=500) and n<3: time.sleep(2**n);continue
   # Só código e mensagem controlada; URLs autenticadas nunca são impressas.
   raise ReadError('HTTP '+str(e.code)+' em '+path.split('/')[0]) from None
  except (TimeoutError,OSError,ValueError):
   if n<3: time.sleep(2**n);continue
   raise ReadError('Falha de rede ou resposta inválida') from None

def meta_list(path,params,key):
 rows=[];params=dict(params)
 for _ in range(150):
  d=get('https://graph.facebook.com/v24.0',path,params,key)
  if not isinstance(d.get('data'),list): raise ReadError('Lista Meta inválida')
  rows.extend(d['data'])
  if not d.get('paging',{}).get('next'): return rows
  after=d['paging'].get('cursors',{}).get('after')
  if not after or after==params.get('after'): raise ReadError('Cursor Meta inválido')
  params['after']=after
 raise ReadError('Paginação Meta incompleta')

def meta(brand):
 e=env(f'meta-ads-{brand}-2026-10-03.env');key=e[f'META_{brand.upper()}_ACCESS_TOKEN']
 ids=list(dict.fromkeys(e.get('META_ESTICA_AD_ACCOUNT_IDS',e.get('META_ESTICA_AD_ACCOUNT_ID','')).split(','))) if brand=='estica' else e['META_AGROBAR_AD_ACCOUNT_IDS'].split(',')
 result={'brand':brand,'from':START,'to':END,'accounts':[],'ads':{},'adsets':{},'rows':[],'placements':[],'demographics':[],'issues':[]}
 for account in ids:
  account=account.strip().removeprefix('act_');path='act_'+account
  try:
   info=get('https://graph.facebook.com/v24.0',path,{'fields':'id,name,currency,timezone_name'},key)
  except ReadError as err:
   result['issues'].append({'scope':'account','account':account,'message':str(err)+'. Conta não coletada; o investimento e os resultados exibidos cobrem somente as contas acessíveis.'})
   continue
  if info['id']!=path or info['currency']!='BRL' or info['timezone_name']!='America/Sao_Paulo': raise ReadError('Conta ou fuso inesperado')
  info['id']=account; info['leadComplete']=account!='2007225646666120';result['accounts'].append(info)
  params={'level':'ad','fields':'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,actions','time_increment':1,'time_range':json.dumps({'since':START,'until':END}),'limit':500,'action_report_time':'impression','use_unified_attribution_setting':'true'}
  rows=meta_list(path+'/insights',params,key)
  for r in rows: r['account']=account
  result['rows'].extend(rows)
  print(brand,account,'insights',len(rows),flush=True)
  for name,breakdown,level in [('placements','publisher_platform,platform_position','ad'),('demographics','age,gender','account')]:
   try:
    p={**params,'level':level,'breakdowns':breakdown}
    if level=='account': p['fields']='spend,impressions,clicks,inline_link_clicks,actions'
    data=meta_list(path+'/insights',p,key)
    for r in data:r['account']=account
    result[name].extend(data)
   except ReadError as err: result['issues'].append({'scope':name,'account':account,'message':str(err)})
  ad_ids={r['ad_id'] for r in rows};set_ids={r['adset_id'] for r in rows}
  def detail(item):
   typ,id=item
   fields=('id,name,status,creative{id,name,title,body,thumbnail_url,image_url,object_story_spec,asset_feed_spec,effective_object_story_id,object_type,video_id}' if typ=='ads' else 'id,name,targeting,optimization_goal,attribution_spec')
   try:return typ,id,get('https://graph.facebook.com/v24.0',id,{'fields':fields},key)
   except ReadError:return typ,id,{'id':id,'unavailable':True}
  with futures.ThreadPoolExecutor(max_workers=3) as pool:
   for typ,id,data in pool.map(detail,[('ads',id) for id in sorted(ad_ids)]+[('adsets',id) for id in sorted(set_ids)]):result[typ][id]=data
  print(brand,'detalhes',len(ad_ids),'públicos',len(set_ids),flush=True)
 if not result['accounts']: raise ReadError('Nenhuma conta acessível; fotografia anterior preservada.')
 result['fetchedAt']=datetime.now(TZ).isoformat();save('meta-'+brand,result)
 return {'source':'meta-'+brand,'rows':len(result['rows']),'issues':len(result['issues'])}

def rd():
 e=env('rdstation-crm-estica-2026-10-03.env');token=e['RDSTATION_CRM_ESTICA_TOKEN'];base='https://crm.rdstation.com/api/v1'
 read=lambda p,q=None:get(base,p,{**(q or {}),'token':token})
 if read('token/check').get('organization')!='Estica':raise ReadError('Conta RD inesperada')
 pipelines=read('deal_pipelines');rows={};total=None
 for page in range(1,101):
  d=read('deals',{'limit':200,'page':page,'order':'created_at','direction':'desc'})
  if page==1:total=d.get('total')
  for r in d['deals']:rows[r['id']]=r
  if not d.get('has_more'):break
 if total!=len(rows):raise ReadError('Cobertura RD incompleta')
 # Reunião concluída requer evento semântico validado. Etapa atual não é prova de evento.
 data={'deals':list(rows.values()),'pipelines':pipelines,'coverage':{'complete':True,'total':total},'fetchedAt':datetime.now(TZ).isoformat(),'meetingIssue':'Reuniões realizadas indisponíveis: a API RD está conectada, mas o evento de realização e sua data ainda não foram conciliados. Etapa atual não comprova comparecimento.'}
 save('rd-estica',data);return {'source':'rd-estica','deals':len(rows)}

def one():
 key=env('onecrm-agrobar-2026-10-03.env')['ONECRM_AGROBAR_API_KEY']
 class Client:
  def get(self,path,params=None):return get('https://app.axivia.com.br/api/v1',path,params,key)
 c=Client();organization=c.get('me')['data']['organization']
 if organization.get('id')!='2b79f8c1-8afa-40cf-9967-c773012c3621' or organization.get('status')!='active':raise ReadError('Organização ONECRM inesperada')
 channels=c.get('channels')['data']
 if not any(x['id']=='32da131f-856f-410b-9cb5-cc822b1abdec' and x['name']=='Agrobar' for x in channels):raise ReadError('Canal Agrobar inesperado')
 identity={'funnels':c.get('funnels')['data']}
 # Leitura paginada com cobertura registrada; nenhum nome segue ao painel.
 def listing(path,params=None):
  params=params or {};first=c.get(path,{**params,'page':1,'limit':100});pag=first['pagination'];batches=[first['data']]
  if pag['totalPages']>500:raise ReadError('Volume acima do limite da coleta')
  def page(n):
   d=c.get(path,{**params,'page':n,'limit':100})
   if d['pagination']['page']!=n:raise ReadError('Página inesperada')
   return d['data']
  with futures.ThreadPoolExecutor(max_workers=3) as pool:
   for batch in pool.map(page,range(2,pag['totalPages']+1)):batches.append(batch)
  rows={r['id']:r for batch in batches for r in batch}
  return list(rows.values()),{'complete':len(rows)==pag['total'],'collected':len(rows),'total':pag['total']}
 membership={};coverage={}
 for ch in c.get('channels')['data']:
  chats,cov=listing('chats',{'channelId':ch['id'],'orderBy':'createdAt','order':'desc'})
  coverage[ch['id']]=cov
  for r in chats:
   if r.get('channel',{}).get('id')!=ch['id']:raise ReadError('Canal inesperado')
   cid=r.get('customer',{}).get('id')
   if cid:membership.setdefault(cid,set()).add(ch['name'].lower())
  print('onecrm','canal',ch['name'],len(chats),flush=True)
 contacts,contacts_cov=listing('contacts')
 history,history_cov=listing('stage-history')
 data={'contacts':contacts,'membership':{k:sorted(v) for k,v in membership.items()},'history':history,'funnels':identity['funnels'],'coverage':{'contacts':contacts_cov,'channels':coverage,'history':history_cov},'fetchedAt':datetime.now(TZ).isoformat()}
 save('onecrm',data);return {'source':'onecrm','contacts':len(contacts),'history':len(history),'coverage':data['coverage']}

def main():
 import argparse
 p=argparse.ArgumentParser();p.add_argument('sources',nargs='*',default=['meta-estica','meta-agrobar','rd-estica','onecrm']);a=p.parse_args()
 funcs={'meta-estica':lambda:meta('estica'),'meta-agrobar':lambda:meta('agrobar'),'rd-estica':rd,'onecrm':one}
 with futures.ThreadPoolExecutor(max_workers=3) as pool:
  jobs={pool.submit(funcs[s]):s for s in a.sources}
  for job in futures.as_completed(jobs):
   try: print(json.dumps(job.result(),ensure_ascii=False),flush=True)
   except Exception as err:print(json.dumps({'source':jobs[job],'error':str(err) if isinstance(err,ReadError) or type(err).__name__=='IntegrationError' else type(err).__name__}),flush=True)
if __name__=='__main__':main()
