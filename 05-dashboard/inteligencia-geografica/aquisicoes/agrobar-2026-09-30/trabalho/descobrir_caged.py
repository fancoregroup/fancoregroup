#!/usr/bin/env python3
"""Enumera somente a pasta pública de tabelas vinculada pelo MTE em agosto/2026."""
import concurrent.futures
import json
import re
from coletar import ROOT, SESSION, now

REFERENCE = 'https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/acoes-e-programas/programas-projetos-acoes-obras-e-atividades/estatisticas-trabalho/novo-caged/2026/agosto/pagina-inicial'
FOLDER = '1F89h6odTPGIGMb9eDiJKCute9W89QmqN'


def listing(folder):
    url = 'https://drive.google.com/drive/folders/' + folder
    r = SESSION.get(url, timeout=(20, 45))
    r.raise_for_status()
    match = re.search(r"window\['_DRIVE_ivd'\] = '([^']+)';", r.text)
    if not match:
        raise ValueError('Listagem pública ausente: ' + url)
    body = re.sub(r'\\x([a-fA-F0-9]{2})', lambda m: chr(int(m[1], 16)), match[1]).replace('\\/', '/')
    return [{'id': x[0], 'name': x[2], 'mime': x[3], 'size': x[13]} for x in json.loads(body)[0]]


def discover():
    months = []
    for year in listing(FOLDER):
        if year['name'] in ('2024', '2025', '2026'):
            months += [x for x in listing(year['id']) if '202409' <= x['name'] <= '202608']
    def month_files(month):
        return month, listing(month['id'])
    sources = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        for month, files in executor.map(month_files, months):
            for file in files:
                if file['name'].lower().endswith('.xlsx'):
                    sources.append({'id': 'caged-' + month['name'], 'url': 'https://drive.usercontent.google.com/download?id=' + file['id'] + '&export=download',
                                    'reference_url': REFERENCE, 'folder_url': 'https://drive.google.com/drive/folders/' + month['id'],
                                    'original_filename': file['name'], 'raw_path': 'raw/caged-' + month['name'] + '.xlsx',
                                    'reference_month': month['name'][:4] + '-' + month['name'][4:], 'listed_bytes': file['size'],
                                    'discovered_at': now(), 'coverage': 'Tabelas oficiais agregadas; período e cobertura verificados após leitura'})
    sources.sort(key=lambda x: x['reference_month'])
    (ROOT / 'fontes-caged.json').write_text(json.dumps(sources, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps([{'id': x['id'], 'bytes': x['listed_bytes'], 'filename': x['original_filename']} for x in sources], ensure_ascii=False, indent=2))
    return sources


if __name__ == '__main__':
    discover()
