#!/usr/bin/env python3
"""Aquisição reproduzível MTE. Use Python com requests, openpyxl e pandas.

python coletar.py --download fontes.json
python coletar.py --inspect

Somente fontes públicas agregadas. Downloads atômicos, SHA256 e validação ZIP.
O manifesto distingue período declarado pela página do período dentro do arquivo.
"""
import argparse
import concurrent.futures
import datetime as dt
import ftplib
import hashlib
import json
from pathlib import Path
import shutil
import threading
import zipfile
from zoneinfo import ZoneInfo
from urllib.parse import urlparse, unquote

import requests

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / 'manifesto.json'
MAX_BYTES = 8 * 1024 ** 3
MIN_FREE = 10 * 1024 ** 3
SESSION = requests.Session()
SESSION.headers.update({'User-Agent': 'FancoreGeo-PublicDataAcquisition/1.0', 'Accept-Encoding': 'identity'})
MANIFEST_LOCK = threading.RLock()


def now():
    return dt.datetime.now(ZoneInfo('America/Sao_Paulo')).isoformat()


def load_manifest():
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {'version': 1, 'created_at': now(), 'scope': 'Emprego formal: RAIS e Novo Caged, fontes oficiais agregadas',
            'budget_bytes': MAX_BYTES, 'minimum_free_bytes': MIN_FREE, 'sources': [], 'derived': [], 'attempts': [],
            'limitations': ['Dados administrativos de vínculos formais não representam toda a população ocupada.',
                            'Não integrado ao Geo nem à fórmula Agrobar nesta aquisição.']}


def save(m):
    with MANIFEST_LOCK:
        m['updated_at'] = now()
        m['budget_bytes'] = MAX_BYTES
        m['minimum_free_bytes'] = MIN_FREE
        m['disk_free_bytes'] = shutil.disk_usage(ROOT).free
        p = MANIFEST.with_suffix('.json.tmp')
        p.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
        p.replace(MANIFEST)


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def validate(path):
    kind = path.name.replace('.part', '').rsplit('.', 1)[-1].lower()
    if kind in ('xlsx', 'zip'):
        with zipfile.ZipFile(path) as z:
            bad = z.testzip()
            if bad:
                raise ValueError('CRC inválido: ' + bad)
            if kind == 'xlsx' and 'xl/workbook.xml' not in z.namelist():
                raise ValueError('ZIP não contém workbook XLSX')
        return 'ZIP CRC e estrutura verificados'
    if kind == 'pdf' and path.open('rb').read(5) != b'%PDF-':
        raise ValueError('Resposta não é PDF')
    if kind == '7z':
        import py7zr
        with py7zr.SevenZipFile(path) as z:
            names = z.getnames()
            if not names:
                raise ValueError('7z sem membros')
        return 'Tamanho FTP, assinatura e cabeçalho 7z verificados; CRC dos membros pendente de extração'
    return 'Arquivo recebido integralmente'


def download(source, manifest):
    path = ROOT / source['raw_path']
    if ROOT not in path.resolve().parents:
        raise ValueError('Caminho fora do escopo')
    previous = next((x for x in manifest['sources'] if x['id'] == source['id']), None)
    if path.exists() and previous and previous.get('sha256') == sha(path):
        print('cache', source['id'], path.stat().st_size, flush=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    attempt = {'id': source['id'], 'url': source['url'], 'accessed_at': now()}
    partial = path.with_name(path.name + '.part')
    try:
        if source['url'].startswith('ftp://'):
            return download_ftp(source, manifest, path, partial, attempt)
        with SESSION.get(source['url'], stream=True, timeout=(25, 90)) as r:
            attempt.update(http_status=r.status_code, resolved_url=r.url)
            r.raise_for_status()
            size = int(r.headers.get('Content-Length', 0))
            total = sum(x.stat().st_size for x in (ROOT / 'raw').rglob('*') if x.is_file())
            if total + size > MAX_BYTES or shutil.disk_usage(ROOT).free - size < MIN_FREE:
                raise RuntimeError('Download excederia orçamento ou piso de espaço livre')
            count = 0
            with partial.open('wb') as f:
                for block in r.iter_content(1024 * 1024):
                    count += len(block)
                    if total + count > MAX_BYTES or shutil.disk_usage(ROOT).free < MIN_FREE:
                        raise RuntimeError('Limite de armazenamento atingido')
                    f.write(block)
            if size and count != size and not r.headers.get('Content-Encoding'):
                raise ValueError(f'Tamanho incompleto: {count} de {size}')
            verification = validate(partial)
            partial.replace(path)
            result = {**source, **attempt, 'bytes': count, 'sha256': sha(path),
                      'content_type': r.headers.get('Content-Type'), 'content_length': size or None,
                      'last_modified': r.headers.get('Last-Modified'), 'integrity': verification, 'status': 'downloaded'}
            manifest['sources'] = [x for x in manifest['sources'] if x['id'] != source['id']] + [result]
            print('downloaded', source['id'], count, flush=True)
            attempt['status'] = 'success'
    except Exception as e:
        attempt.update(status='failed', error=str(e))
        print('failed', source['id'], str(e), flush=True)
        if partial.exists():
            partial.unlink()
    manifest['attempts'].append(attempt)
    save(manifest)


def download_ftp(source, manifest, path, partial, attempt):
    parsed = urlparse(source['url'])
    ftp_path = unquote(parsed.path)
    try:
        with ftplib.FTP(parsed.hostname, timeout=90, encoding='latin1') as f:
            f.login()
            f.voidcmd('TYPE I')
            expected = f.size(ftp_path)
            current = sum(x.stat().st_size for x in (ROOT / 'raw').rglob('*') if x.is_file())
            offset = partial.stat().st_size if partial.exists() else 0
            if offset > expected:
                raise ValueError('Arquivo parcial maior que fonte FTP')
            if current + expected - offset > MAX_BYTES or shutil.disk_usage(ROOT).free - expected + offset < MIN_FREE:
                raise RuntimeError('Download excederia orçamento ou piso de espaço livre')
            count = offset
            with partial.open('ab' if offset else 'wb') as out:
                def write(block):
                    nonlocal count
                    count += len(block)
                    if current + count - offset > MAX_BYTES or shutil.disk_usage(ROOT).free < MIN_FREE:
                        raise RuntimeError('Limite de armazenamento atingido')
                    out.write(block)
                f.retrbinary('RETR ' + ftp_path, write, blocksize=1024*1024, rest=offset or None)
            if count != expected or partial.stat().st_size != expected:
                raise ValueError(f'Tamanho incompleto: {count} de {expected}')
        verification = validate(partial)
        partial.replace(path)
        result = {**source, **attempt, 'bytes': count, 'expected_bytes': expected, 'sha256': sha(path),
                  'integrity': verification, 'status': 'downloaded'}
        with MANIFEST_LOCK:
            manifest['sources'] = [x for x in manifest['sources'] if x['id'] != source['id']] + [result]
        print('downloaded', source['id'], count, flush=True)
        attempt['status'] = 'success'
    except Exception as e:
        attempt.update(status='failed', error=str(e))
        print('failed', source['id'], str(e), flush=True)
        attempt['partial_bytes'] = partial.stat().st_size if partial.exists() else 0
        attempt['resume_supported'] = True
    manifest['attempts'].append(attempt)
    save(manifest)


def inspect(manifest):
    import openpyxl
    for source in manifest['sources']:
        path = ROOT / source['raw_path']
        if path.suffix != '.xlsx':
            continue
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        info = []
        for sheet in wb:
            heads = [[str(x) if x is not None else None for x in row] for row in sheet.iter_rows(min_row=1, max_row=8, max_col=18, values_only=True)]
            info.append({'sheet': sheet.title, 'rows': sheet.max_row, 'columns': sheet.max_column, 'headers': heads})
        out = ROOT / 'derived' / (path.stem + '-abas.json')
        out.parent.mkdir(exist_ok=True)
        out.write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n')
        source['sheet_inventory_path'] = str(out.relative_to(ROOT))
        source['sheet_names'] = wb.sheetnames
        wb.close()
        print(source['id'], [(x['sheet'], x['rows'], x['columns']) for x in info], flush=True)
        save(manifest)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--download', type=Path)
    p.add_argument('--inspect', action='store_true')
    p.add_argument('--workers', type=int, default=1, choices=[1, 2, 3])
    p.add_argument('--manifest', type=Path, help='Manifesto separado para aquisição paralela; consolidar após os processos terminarem.')
    args = p.parse_args()
    if args.manifest:
        MANIFEST = args.manifest.resolve()
        if ROOT not in MANIFEST.parents:
            raise ValueError('Manifesto fora do escopo da aquisição')
    m = load_manifest()
    if args.download:
        sources = json.loads(args.download.read_text())
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
            list(executor.map(lambda source: download(source, m), sources))
    if args.inspect:
        inspect(m)
    save(m)
