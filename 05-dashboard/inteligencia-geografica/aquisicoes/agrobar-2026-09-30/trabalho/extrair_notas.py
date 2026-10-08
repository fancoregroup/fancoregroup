#!/usr/bin/env python3
"""Extrai PDFs originais do ZIP oficial e texto para consulta, sem editar o PDF."""
import io
import json
from pathlib import Path
import zipfile
from pypdf import PdfReader
from coletar import ROOT, now, sha


def main():
    source = ROOT / 'raw/notas/nota-tecnica-rais-2025.zip'
    folder = ROOT / 'derived/notas'
    folder.mkdir(exist_ok=True)
    output = []
    with zipfile.ZipFile(source) as archive:
        for name in archive.namelist():
            if not name.lower().endswith('.pdf'):
                continue
            data = archive.read(name)
            path = folder / Path(name).name
            path.write_bytes(data)
            reader = PdfReader(io.BytesIO(data))
            text = '\n'.join(f'PÁGINA {index+1}\n' + (page.extract_text() or '') for index, page in enumerate(reader.pages))
            path.with_suffix('.txt').write_text(text)
            output.append({'archive_member': name, 'pdf_path': str(path.relative_to(ROOT)), 'sha256': sha(path),
                           'text_path': str(path.with_suffix('.txt').relative_to(ROOT)), 'pages': len(reader.pages)})
    (folder / 'indice.json').write_text(json.dumps({'extracted_at': now(), 'source_sha256': sha(source), 'documents': output}, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
