"""Testes dos limites de atribuição, isolamento e contagem."""
import unittest
from model import day,metrics,creative,one,rd
class ModelTests(unittest.TestCase):
 def test_timezone_brasilia(self):
  self.assertEqual(day('2026-09-07T01:00:00Z'),'2026-09-06')
 def test_unknown_lead_is_not_zero(self):
  r={'spend':'120','actions':[{'action_type':'lead','value':'3'},{'action_type':'offsite_conversion.custom.1','value':'7'}]}
  self.assertIsNone(metrics(r,False)['leads']);self.assertEqual(metrics(r,True)['leads'],3)
  self.assertEqual(metrics(r,True)['custom'],{'offsite_conversion.custom.1':7})
 def test_missing_action_is_zero_when_source_known(self):
  self.assertEqual(metrics({'spend':'5'},True)['leads'],0)
 def test_dynamic_copies(self):
  r=creative({'creative':{'asset_feed_spec':{'bodies':[{'text':'A'},{'text':'B'}],'images':[{},{}]}}})
  self.assertEqual(r['bodies'],['A','B']);self.assertEqual(r['format'],'Dinâmico / múltiplos assets')
 def test_crm_shared_brand_excluded_and_contact_not_double_counted(self):
  stage='428c529d-6b41-4621-8e43-0d8df6a86c27'
  contact=lambda id:{'id':id,'createdAt':'2026-09-02T12:00:00Z','isFromPaidTraffic':True,'customerStages':[{'stage':{'id':'sdr'}},{'stage':{'id':stage}}]}
  event=lambda cid,stamp:{'customer':{'id':cid},'enteredAt':stamp,'stage':{'id':stage}}
  raw={'membership':{'a':['agrobar'],'b':['agrobar','folks']},'contacts':[contact('a'),contact('b')],'history':[event('a','2026-09-10T12:00:00Z'),event('a','2026-09-10T13:00:00Z'),event('b','2026-09-10T12:00:00Z')],
   'funnels':[{'name':'Funil SDR','stages':[{'id':'sdr','name':'Novo'}]},{'name':'Funil Closer','stages':[{'id':stage,'name':'Reunião Feita'}]}],
   'coverage':{'contacts':{'complete':True},'channels':{'a':{'complete':True}},'history':{'complete':True}},'fetchedAt':'2026-10-03T12:00:00-03:00'}
  report=one(raw);self.assertEqual(sum(r['count'] for r in report['entries']),1);self.assertEqual(report['entries'][0]['stage'],'Reunião Feita');self.assertEqual(report['entries'][0]['heldAt'],'2026-09-10');self.assertEqual(sum(r['count'] for r in report['meetingEvents']),1)
  raw['coverage']['history']['complete']=False;self.assertFalse(one(raw)['meetingsAvailable']);self.assertIsNone(one(raw)['entries'][0]['heldAt'])
 def test_rd_current_stage_is_not_meeting_event(self):
  raw={'deals':[{'created_at':'2026-09-01','deal_stage':{'id':'a'},'win':True}], 'pipelines':[{'name':'Closer','deal_stages':[{'id':'a','name':'Reunião realizada'}]}],'coverage':{'complete':True},'fetchedAt':'2026-10-03','meetingIssue':'Evento não conciliado'}
  report=rd(raw);self.assertFalse(report['meetingsAvailable']);self.assertEqual(report['entries'][0]['status'],'Ganha');self.assertIsNone(report['entries'][0]['heldAt'])
if __name__=='__main__':unittest.main()
