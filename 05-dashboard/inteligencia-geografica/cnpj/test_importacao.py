import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path
from importar import classify, scan, ROOT

class ImportTests(unittest.TestCase):
    def setUp(self):
        self.mapping={'5611201':1,'5611204':2,'5611205':4}
    def row(self,cnpj='00000001000100',main='5611201',secondary='',status='02'):
        r=['']*30;r[:3]=[cnpj[:8],cnpj[8:12],cnpj[12:]]
        r[5]=status;r[11]=main;r[12]=secondary;r[19]='PR';r[20]='7667'
        return r
    def test_multiple_cnaes(self):
        self.assertEqual(classify(self.row(secondary='5611201,5611204,5611204'),self.mapping),(1,3))
        self.assertEqual(classify(self.row(main='9999999',secondary='5611205'),self.mapping),(0,4))
    def fixture(self,rows):
        import csv,io
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);p=Path(temp.name)
        buf=io.StringIO();csv.writer(buf,delimiter=';',quoting=csv.QUOTE_ALL).writerows(rows)
        with zipfile.ZipFile(p/'Estabelecimentos0.zip','w') as z:z.writestr('sample.csv',buf.getvalue().encode('latin1'))
        return p
    def test_active_branches_and_duplicates(self):
        rows=[self.row(),self.row(),self.row(cnpj='00000001000282'),self.row(cnpj='00000002000100',status='08'),self.row(cnpj='00000003000100',main='9999999')]
        p=self.fixture(rows);result=scan((str(p/'Estabelecimentos0.zip'),str(p),self.mapping))
        db=sqlite3.connect(p/'Estabelecimentos0.sqlite')
        self.assertEqual(result['rows'],5);self.assertEqual(result['duplicates'],1)
        self.assertEqual(db.execute('select count(*) from selected').fetchone()[0],2);db.close()
    def test_conflicting_duplicate_fails(self):
        p=self.fixture([self.row(),self.row(main='5611204')])
        with self.assertRaisesRegex(ValueError,'conflitante'):scan((str(p/'Estabelecimentos0.zip'),str(p),self.mapping))
    def test_nul_unused_field_preserved_as_anomaly(self):
        row=self.row();row[14]='RUA\x00NOME';p=self.fixture([row])
        result=scan((str(p/'Estabelecimentos0.zip'),str(p),self.mapping))
        self.assertEqual(result['nulFieldCounts'],{14:1});self.assertTrue(result['crcValidated'])
    def test_nul_used_field_fails(self):
        row=self.row();row[12]='561120\x00';p=self.fixture([row])
        with self.assertRaisesRegex(ValueError,'campo usado'):scan((str(p/'Estabelecimentos0.zip'),str(p),self.mapping))
    def test_real_reconciliation(self):
        a=json.loads((ROOT/'auditoria.json').read_text());read=json.loads((ROOT/'leitura.json').read_text())
        self.assertEqual(len(read['parts']),10);self.assertTrue(all(p['crcValidated'] for p in read['parts']))
        self.assertEqual(a['mapped']+a['foreign'],a['uniqueSelected']);self.assertEqual(a['unmapped'],a['foreign'])
        self.assertEqual(a['coveredCities'],5571);self.assertEqual(a['crossPartDuplicates']+a['withinPartDuplicates'],0)
        db=sqlite3.connect(ROOT/'work/estabelecimentos-selecionados.sqlite')
        # Independent reconciliation by original primary CNAE, without classification bit masks.
        bars=db.execute("select count(*) from selected where uf!='EX' and primary_cnae in ('5611202','5611204','5611205')").fetchone()[0]
        restaurants=db.execute("select count(*) from selected where uf!='EX' and primary_cnae='5611201'").fetchone()[0]
        self.assertEqual(bars,a['totals']['barsPrimary']);self.assertEqual(restaurants,a['totals']['primary'][0]);db.close()
        self.assertEqual(sum(a['totals']['primary']),a['totals']['totalPrimary'])

if __name__=='__main__':unittest.main()
