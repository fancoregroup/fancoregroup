#!/usr/bin/env python3
"""Enumera MOV, FOR e EXC oficiais de setembro/2024 a agosto/2026."""
import ftplib
import json
from urllib.parse import quote
from coletar import ROOT, now


def discover():
    sources = []
    with ftplib.FTP('ftp.mtps.gov.br', timeout=30, encoding='latin1') as f:
        f.login()
        for year in (2024, 2025, 2026):
            root = '/pdet/microdados/NOVO CAGED/' + str(year)
            for folder in sorted(f.nlst(root)):
                period = folder.rsplit('/', 1)[-1]
                if not ('202409' <= period <= '202608'):
                    continue
                files = f.nlst(folder)
                f.voidcmd('TYPE I')
                for path in files:
                    name = path.rsplit('/', 1)[-1]
                    if name.endswith('.7z') and name.startswith(('CAGEDMOV', 'CAGEDFOR', 'CAGEDEXC')):
                        sources.append({'id': name[:-3].lower(), 'url': 'ftp://ftp.mtps.gov.br' + quote(path),
                                        'reference_url': 'https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/acoes-e-programas/programas-projetos-acoes-obras-e-atividades/estatisticas-trabalho/microdados-rais-e-caged',
                                        'raw_path': 'raw/caged-microdados/' + name, 'listed_bytes': f.size(path),
                                        'reference_month': period[:4] + '-' + period[4:], 'file_role': name[5:8],
                                        'discovered_at': now(), 'coverage': 'Microdados públicos não identificados de movimentação (MOV), fora do prazo (FOR) ou exclusão (EXC). Agregação salarial municipal pendente.'})
    sources.sort(key=lambda x: (x['reference_month'], x['file_role']))
    assert len(sources) == 72, f'Esperados72 arquivos, encontrados{len(sources)}'
    (ROOT / 'fontes-caged-microdados.json').write_text(json.dumps(sources, ensure_ascii=False, indent=2) + '\n')
    print('Caged', len(sources), 'arquivos', sum(x['listed_bytes'] for x in sources), 'bytes', flush=True)


if __name__ == '__main__':
    discover()
