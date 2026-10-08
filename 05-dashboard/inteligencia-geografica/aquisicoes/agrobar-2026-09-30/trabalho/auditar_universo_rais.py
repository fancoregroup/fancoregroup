#!/usr/bin/env python3
"""Diagnóstico descritivo de universo, sem alterar o agregado nem escolher filtros."""
from collections import Counter
import io
import json
import pandas as pd
import py7zr
from agregar_rais_2025 import Aggregator
from coletar import ROOT, now, sha

FIELDS = ['Ind Vínculo Ativo 31/12 - Código', 'Ind Vínculo Abandonado - Código',
          'Ind Trabalho Intermitente - Código', 'Tipo Vínculo - Código', 'Categoria Trabalhador - Código']


class Audit(Aggregator):
    def __init__(self):
        super().__init__()
        self.cells = Counter()

    def process(self, data):
        if not data.strip():
            return
        frame = pd.read_csv(io.BytesIO(self.header + data), encoding='latin1', dtype=str, usecols=FIELDS).fillna('AUSENTE')
        self.rows += len(frame)
        self.cells.update(frame.groupby(FIELDS).size().to_dict())


class Factory(py7zr.io.WriterFactory):
    def __init__(self):
        self.members = {}

    def create(self, filename):
        item = Audit()
        self.members[filename] = item
        return item


def main():
    total = Counter()
    sources = []
    for path in sorted((ROOT / 'raw').glob('RAIS_VINC_PUB_*.7z')):
        digest = sha(path)
        proof = ROOT / 'derived' / (path.stem.lower() + '-universo.json')
        old = json.loads(proof.read_text()) if proof.exists() else None
        if old and old['source_sha256'] == digest:
            rows = old['cells']
        else:
            f = Factory()
            with py7zr.SevenZipFile(path) as archive:
                archive.extractall(factory=f)
            counts = Counter()
            for item in f.members.values():
                item.close()
                counts.update(item.cells)
            rows = [{'codes': list(k), 'count': int(v)} for k, v in counts.items()]
            proof.write_text(json.dumps({'source_sha256': digest, 'cells': rows}, ensure_ascii=False, indent=2) + '\n')
        for row in rows:
            total[tuple(row['codes'])] += row['count']
        sources.append({'source': str(path.relative_to(ROOT)), 'sha256': digest, 'proof': str(proof.relative_to(ROOT))})
        print('auditado', path.name, flush=True)
    summary = {}
    for index, field in enumerate(FIELDS):
        counts = Counter()
        for codes, count in total.items():
            if codes[0] == '1':
                counts[codes[index]] += count
        summary[field] = dict(counts)
    result = {'generated_at': now(), 'sources': sources, 'fields': FIELDS,
              'cells': [{'codes': list(k), 'count': v} for k, v in total.items()],
              'active_31_12_distributions': summary,
              'status': 'Diagnóstico descritivo. Nenhum filtro adicional aplicado aos agregados municipais.'}
    (ROOT / 'derived/auditoria-universo-rais-2025.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
