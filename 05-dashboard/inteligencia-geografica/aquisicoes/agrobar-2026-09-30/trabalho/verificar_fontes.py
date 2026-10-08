#!/usr/bin/env python3
"""Registra tentativas oficiais alternativas e metadados de acesso, sem credenciais."""
import concurrent.futures
import ftplib
import json
import requests
from bs4 import BeautifulSoup
from coletar import ROOT, now

BASE = 'https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/acoes-e-programas/programas-projetos-acoes-obras-e-atividades/estatisticas-trabalho/'
URLS = [BASE + 'rais/rais-2025', BASE + 'rais/rais-2024', BASE + 'novo-caged/2026/agosto/pagina-inicial',
        BASE + 'isper-dados-por-municipio', BASE + 'microdados-rais-e-caged',
        BASE + 'comunicados/comunicado-estoque-de-referencia-de-2026',
        'https://bi.mte.gov.br/bgcaged/caged_isper/index.php',
        'http://bi.mte.gov.br/bgcaged/caged_isper/index.php',
        'https://bi.mte.gov.br/bgcaged/caged_anuario_rais/anuario.htm',
        'https://ftp.mtps.gov.br/pdet/', 'http://ftp.mtps.gov.br/pdet/']


def probe(url):
    result = {'url': url, 'accessed_at': now()}
    try:
        r = requests.get(url, timeout=(15, 25))
        result.update(http_status=r.status_code, final_url=r.url, bytes=len(r.content))
        r.raise_for_status()
        soup = BeautifulSoup(r.text, 'html.parser')
        main = soup.select_one('#content-core') or soup.select_one('main')
        result['title'] = soup.title.get_text(' ', strip=True) if soup.title else None
        if main:
            result['content_excerpt'] = main.get_text(' ', strip=True)[:7000]
            result['links'] = [{'label': a.get_text(' ', strip=True), 'url': a.get('href')} for a in main.select('a[href]')]
        result['status'] = 'success'
    except Exception as e:
        result.update(status='failed', error=str(e))
    return result


def main():
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(probe, URLS))
    for path in ['/pdet/rais', '/pdet/microdados/RAIS/2024', '/pdet/microdados/RAIS/2025', '/pdet/microdados/RAIS/Layouts']:
        result = {'url': 'ftp://ftp.mtps.gov.br' + path, 'accessed_at': now()}
        try:
            with ftplib.FTP('ftp.mtps.gov.br', timeout=25, encoding='latin1') as f:
                f.login()
                lines = []
                f.retrlines('LIST ' + path, lines.append)
                result.update(status='success', directory_listing=lines)
        except Exception as e:
            result.update(status='failed', error=str(e))
        results.append(result)
    (ROOT / 'derived/tentativas-fontes.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
    print([(x['url'], x['status']) for x in results])


if __name__ == '__main__':
    main()
