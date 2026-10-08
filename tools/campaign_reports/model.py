"""Contrato agregado dos painéis. Não exporta nomes, telefones ou IDs de contatos."""
from collections import Counter, defaultdict
from datetime import datetime, date, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import json
TZ=ZoneInfo('America/Sao_Paulo')
SOURCE=Path.home()/'.local/share/fancore/campaign-reports'

def day(value):
 if not value:return None
 try:
  dt=datetime.fromisoformat(value.replace('Z','+00:00'))
  return dt.replace(tzinfo=TZ).date().isoformat() if dt.tzinfo is None else dt.astimezone(TZ).date().isoformat()
 except ValueError:return None

def load(name):
 p=SOURCE/(name+'.json')
 return json.loads(p.read_text()) if p.exists() else None

def metrics(r,known=True):
 actions={x['action_type']:float(x['value']) for x in r.get('actions',[])}
 return {'spend':float(r.get('spend',0)), 'impressions':int(r.get('impressions',0)), 'clicks':int(r.get('clicks',0)),
         'linkClicks':int(r.get('inline_link_clicks',0)), 'leads':actions.get('lead',0) if known else None,
         'custom':{k:v for k,v in actions.items() if k.startswith('offsite_conversion.custom.')}}

def creative(ad):
 c=ad.get('creative') or {};story=c.get('object_story_spec') or {};asset=c.get('asset_feed_spec') or {}
 video=story.get('video_data') or {};link=story.get('link_data') or {};photo=story.get('photo_data') or {}
 bodies=list(dict.fromkeys([x for x in [video.get('message'),link.get('message'),photo.get('caption'),c.get('body')] if x]+[x['text'] for x in asset.get('bodies',[]) if x.get('text')]))
 titles=list(dict.fromkeys([x for x in [c.get('title'),link.get('name'),video.get('title')] if x]+[x['text'] for x in asset.get('titles',[]) if x.get('text')]))
 if link.get('child_attachments'):fmt='Carrossel'
 elif len(asset.get('videos',[]))+len(asset.get('images',[]))>1:fmt='Dinâmico / múltiplos assets'
 elif video or c.get('video_id') or asset.get('videos'):fmt='Vídeo'
 elif photo or link or c.get('image_url') or asset.get('images'):fmt='Imagem'
 else:fmt='Não informado'
 preview=c.get('preview_url') or c.get('image_url') or video.get('image_url') or link.get('picture') or c.get('thumbnail_url')
 return {'format':fmt,'preview':preview,'bodies':bodies,'titles':titles,'postId':c.get('effective_object_story_id'),'status':ad.get('status'),'available':not ad.get('unavailable',False)}

def media(raw):
 if not raw:return {'available':False,'issue':'Conexão Meta sem coleta válida.','rows':[],'accounts':[],'ads':{},'adsets':{},'placements':[],'demographics':[]}
 known={x['id']:x['leadComplete'] for x in raw['accounts']}
 rows=[];ads={}
 for r in raw['rows']:
  rows.append({'date':r['date_start'],'account':r['account'],'ad':r['ad_id'],'adset':r['adset_id'],'campaign':r['campaign_id'],**metrics(r,known[r['account']])})
  ads[r['ad_id']]={'id':r['ad_id'],'name':r['ad_name'],'adset':r['adset_id'],'adsetName':r['adset_name'],'campaignName':r['campaign_name'],'account':r['account'],**creative(raw['ads'].get(r['ad_id'],{'unavailable':True}))}
 placements=[{'date':r['date_start'],'ad':r['ad_id'],'account':r['account'],'platform':r.get('publisher_platform'),'position':r.get('platform_position'),**metrics(r,known[r['account']])} for r in raw['placements']]
 demographics=[{'date':r['date_start'],'account':r['account'],'age':r.get('age'),'gender':r.get('gender'),**metrics(r,known[r['account']])} for r in raw['demographics']]
 return {'available':True,'from':raw['from'],'to':raw['to'],'fetchedAt':raw['fetchedAt'],'accounts':raw['accounts'],'rows':rows,'ads':ads,'adsets':raw['adsets'],'placements':placements,'demographics':demographics,'issues':raw['issues']}

def rd(raw):
 if not raw:return {'available':False,'issue':'RD Station: coleta completa indisponível. Leads, status e reuniões por cohort aguardam dados do CRM.'}
 stages={s['id']:(p['name'],s['name']) for p in (raw['pipelines'] if isinstance(raw['pipelines'],list) else raw['pipelines'].get('deal_pipelines',[])) for s in p.get('deal_stages',[])}
 groups=Counter()
 for d in raw['deals']:
  created=day(d.get('created_at'))
  if not created:continue
  sid=(d.get('deal_stage') or {}).get('id');funnel,stage=stages.get(sid,('Sem funil','Sem etapa'))
  status='Ganha' if d.get('win') is True else 'Perdida' if d.get('win') is False else 'Aberta'
  # Sem mapeamento validado dos campos de origem do RD, não inferir mídia pelo nome.
  groups[(created,'unknown',funnel,stage,status,None)]+=1
 return {'available':True,'source':'RD Station CRM','unit':'negociações','fetchedAt':raw['fetchedAt'],'complete':raw['coverage']['complete'],
  'entries':[{'date':k[0],'origin':k[1],'funnel':k[2],'stage':k[3],'status':k[4],'heldAt':k[5],'count':n} for k,n in groups.items()],
  'meetingsAvailable':False,'meetingIssue':raw['meetingIssue'],'meetingEvents':[],
  'notes':['Cohort por criação da negociação no RD. Uma pessoa pode ter mais de uma negociação.','Origem paga ainda não conciliada no RD. A coluna de leads Meta não é contagem de pessoas no CRM.','Status e etapa atuais, observados na coleta; não são a posição histórica no fim de setembro.']}

def one(raw):
 if not raw:return {'available':False,'issue':'ONECRM Agrobar: coleta completa indisponível. Leads, status e reuniões por cohort aguardam dados do CRM.'}
 exclusive={k for k,v in raw['membership'].items() if v==['agrobar']}
 shared={k for k,v in raw['membership'].items() if 'agrobar' in v and len(v)>1}
 stages={s['id']:(p['name'],s['name'].strip()) for p in raw['funnels'] for s in p['stages']}
 held_stage='428c529d-6b41-4621-8e43-0d8df6a86c27'
 hist=raw['coverage']['history']['complete']
 complete=raw['coverage']['contacts']['complete'] and all(c['complete'] for c in raw['coverage']['channels'].values())
 first={};events={}
 for h in raw['history']:
  cid=(h.get('customer') or {}).get('id');date_=day(h.get('enteredAt'))
  if cid in exclusive and (h.get('stage') or {}).get('id')==held_stage and date_:
   first[cid]=min(date_,first.get(cid,date_));events[(cid,date_)]=1
 groups=Counter()
 for c in raw['contacts']:
  if c['id'] not in exclusive:continue
  created=day(c.get('createdAt'))
  if not created:continue
  current=[stages.get((x.get('stage') or {}).get('id'),('Sem funil','Sem etapa')) for x in c.get('customerStages',[])]
  # Uma linha por contato: Closer tem precedência quando há dois funis atuais.
  current.sort(key=lambda x:(0 if 'closer' in x[0].lower() else 1,x[0],x[1]))
  funnel,stage=current[0] if current else ('Sem funil','Sem etapa')
  origin='paid' if c.get('isFromPaidTraffic') is True else 'other' if c.get('isFromPaidTraffic') is False else 'unknown'
  status='Arquivado' if c.get('isArchived') else 'Ativo'
  groups[(created,origin,funnel,stage,status,first.get(c['id']) if hist else None)]+=1
 return {'available':True,'source':'ONECRM Agrobar','unit':'contatos','fetchedAt':raw['fetchedAt'],'complete':complete,
  'entries':[{'date':k[0],'origin':k[1],'funnel':k[2],'stage':k[3],'status':k[4],'heldAt':k[5],'count':n} for k,n in groups.items()],
  'meetingsAvailable':hist and complete,'meetingIssue':'Realização indicada pela entrada na etapa Reunião Feita. Conta contatos por dia; retornos no mesmo dia não duplicam. Não é auditoria de comparecimento.',
  'meetingEvents':[{'date':d,'count':n} for d,n in Counter(d for cid,d in events).items()],
  'notes':[f'{len(shared)} contatos associados também a outra marca foram excluídos. A cobertura considera somente contatos com conversa exclusiva no canal Agrobar.',
           'Data de captação = criação do contato no CRM; migrações podem diferir da primeira origem na Meta.',
           'Status e etapa atuais na coleta. Um contato conta uma vez; o funil Closer tem precedência sobre SDR.',
           'Pago ou não pago conforme o campo isFromPaidTraffic do CRM; não confirma conciliação individual com a Meta.',
           'Histórico de reuniões consultado desde 01/09/2026. O cohort acompanha a primeira entrada em Reunião Feita até a coleta.']}

def build():
 brands={b:{'name':name,'media':media(load('meta-'+b)),'crm':rd(load('rd-estica')) if b=='estica' else one(load('onecrm'))} for b,name in [('estica','Estica'),('agrobar','Agrobar')]}
 fetched=[b[key].get('fetchedAt') for b in brands.values() for key in ('media','crm')]
 return {'schemaVersion':'brand-campaigns-v1','generatedAt':max([v for v in fetched if v],default=datetime.now(TZ).isoformat()),'timezone':'America/Sao_Paulo','brands':brands}
if __name__=='__main__':
 from collect import save
 d=build();save('dashboard',d)
 print(json.dumps({b:{'ads':len(v['media']['ads']),'rows':len(v['media']['rows']),'crm':v['crm'].get('available'),'crmGroups':len(v['crm'].get('entries',[]))} for b,v in d['brands'].items()}))
