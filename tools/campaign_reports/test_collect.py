"""A falta de acesso a uma conta deve ficar explícita e não apagar fontes válidas."""
import unittest
from unittest.mock import patch
import collect

class MetaCoverageTests(unittest.TestCase):
 def test_same_token_multiple_accounts_and_explicit_missing_coverage(self):
  def get(base,path,params,key):
   self.assertEqual(key,'fixture-token')
   if path=='act_2':raise collect.ReadError('HTTP 403 em act_2')
   return {'id':path,'currency':'BRL','timezone_name':'America/Sao_Paulo'}
  config={'META_ESTICA_ACCESS_TOKEN':'fixture-token','META_ESTICA_AD_ACCOUNT_IDS':'1,2,1'}
  with patch.object(collect,'env',return_value=config),patch.object(collect,'get',side_effect=get),patch.object(collect,'meta_list',return_value=[]),patch.object(collect,'save') as save:
   collect.meta('estica')
   result=save.call_args.args[1]
   self.assertEqual([a['id'] for a in result['accounts']],['1'])
   self.assertEqual(result['issues'][0]['account'],'2')
   self.assertEqual(result['issues'][0]['scope'],'account')
 def test_no_account_access_preserves_previous_snapshot(self):
  config={'META_ESTICA_ACCESS_TOKEN':'fixture-token','META_ESTICA_AD_ACCOUNT_ID':'1'}
  with patch.object(collect,'env',return_value=config),patch.object(collect,'get',side_effect=collect.ReadError('HTTP 403')),patch.object(collect,'save') as save:
   with self.assertRaises(collect.ReadError):collect.meta('estica')
   save.assert_not_called()

if __name__=='__main__':unittest.main()
