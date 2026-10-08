import csv
import io
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path
from estica import ROOT, PUBLIC, has_pilates, companies, establishments


class EsticaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)

    def zip(self, name, rows):
        buf = io.StringIO()
        csv.writer(buf, delimiter=';', quoting=csv.QUOTE_ALL).writerows(rows)
        path = self.path / name
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('sample.csv', buf.getvalue().encode('latin1'))
        return str(path)

    def row(self, basic='00000001', branch='0001', name='', main='9313100', secondary='', status='02'):
        row = [''] * 30
        row[:3] = [basic, branch, '00']
        row[4], row[5], row[11], row[12] = name, status, main, secondary
        row[19], row[20] = 'PR', '7667'
        return row

    def scan(self, rows, names=None):
        result = establishments((self.zip('Estabelecimentos0.zip', rows), str(self.path), names or {}))
        with sqlite3.connect(self.path / 'Estabelecimentos0.sqlite') as db:
            selected = db.execute('SELECT * FROM selected ORDER BY cnpj').fetchall()
        return result, selected

    def test_name_evidence_whole_word(self):
        for value in ['Studio Pilates', 'PILATES & CIA', 'Pílates-Clínica']:
            self.assertTrue(has_pilates(value), value)
        for value in ['Pilatescore', 'Apilates', 'Condicionamento físico']:
            self.assertFalse(has_pilates(value), value)

    def test_company_name_branch_join(self):
        names, report = companies(self.zip('Empresas0.zip', [
            ['00000001', 'MOVIMENTO PILATES LTDA', '', '', '', '', ''],
            ['00000002', 'ACADEMIA CENTRAL', '', '', '', '', '']]))
        self.assertEqual(list(names), ['00000001'])
        self.assertTrue(report['crcValidated'])
        result, selected = self.scan([self.row(), self.row(branch='0002'), self.row(basic='00000002')], names)
        self.assertEqual(result['named'], 2)
        self.assertEqual([row[-2:] for row in selected], [(5, 5), (5, 5), (1, 1)])

    def test_activity_and_active_required(self):
        result, selected = self.scan([
            self.row(name='Pilates'),
            self.row(basic='00000002', name='Pilates', status='08'),
            self.row(basic='00000003', name='Pilates', main='9999999'),
            self.row(basic='00000004', name='Pilates', main='9999999', secondary='8650004')])
        self.assertEqual(result['rows'], 4)
        self.assertEqual(result['active'], 3)
        self.assertEqual([row[-2:] for row in selected], [(5, 5), (0, 6)])

    def test_overlap_does_not_duplicate_cnpj(self):
        result, selected = self.scan([self.row(name='Pilates', secondary='8650004,9313100,8650004')] * 2)
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0][-2:], (5, 7))
        self.assertEqual(result['duplicates'], 1)

    def test_corrupt_used_name_fails(self):
        with self.assertRaisesRegex(ValueError, 'NUL em campo usado'):
            self.scan([self.row(name='Pi\x00lates')])

    def test_national_reconciliation(self):
        audit = json.loads((ROOT / 'estica-auditoria.json').read_text())
        result = json.loads((PUBLIC / 'estica.json').read_text())
        self.assertEqual(result['totals'], audit['totals'])
        self.assertEqual(len(audit['companyFiles']) + len(audit['establishmentFiles']), 20)
        self.assertTrue(all(r['crcValidated'] for r in audit['companyFiles'] + audit['establishmentFiles']))
        self.assertEqual(sum(r['duplicates'] for r in audit['establishmentFiles']), 0)
        self.assertEqual(audit['coverage']['unmapped'], audit['coverage']['foreign'])
        self.assertEqual(audit['coverage']['coveredCities'], 5571)
        self.assertEqual(len(result['cities']), len({r['id'] for r in result['cities']}))
        # Independent primary counts use the original CNAE, without classification masks.
        with sqlite3.connect(ROOT / 'work/estica/selecionados.sqlite') as db:
            counts = [db.execute("SELECT count(*) FROM selected WHERE uf!='EX' AND primary_cnae=?", (cnae,)).fetchone()[0] for cnae in ['9313100', '8650004']]
            unique = db.execute("SELECT count(*) FROM selected WHERE uf!='EX'").fetchone()[0]
        self.assertEqual(counts, result['totals']['primary'])
        self.assertEqual(unique, result['totals']['totalAny'])
        for city in result['cities']:
            self.assertEqual(sum(city['primary']), city['totalPrimary'])
            self.assertLessEqual(city['pilatesPrimary'], city['totalPrimary'])
            self.assertLessEqual(city['pilatesAny'], city['totalAny'])
            self.assertLessEqual(city['totalAny'], sum(city['any']))
        for key in ['totalPrimary', 'totalAny', 'pilatesPrimary', 'pilatesAny']:
            self.assertEqual(sum(c[key] for c in result['cities']), result['totals'][key])


if __name__ == '__main__':
    unittest.main()
