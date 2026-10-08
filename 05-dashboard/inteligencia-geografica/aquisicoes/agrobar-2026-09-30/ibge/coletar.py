#!/usr/bin/env python3
"""Coleta pública IBGE, retomável e sem alterar a plataforma ou seu índice.

python3 coletar.py                    # APIs municipais e pacotes setoriais escolhidos
python3 coletar.py --only api         # somente agregados municipais
python3 coletar.py --only setores     # somente pacotes nacionais e documentação
python3 coletar.py --only derive      # refaz CSVs a partir dos JSONs locais

JSONs da API são conservados em gzip; ZIPs oficiais não são extraídos no disco.
Ausências ficam vazias no campo value, com símbolo original e status separados.
"""
from __future__ import annotations
import argparse, concurrent.futures, csv, datetime as dt, gzip, hashlib, io, json
import math, os, re, shutil, threading, time, urllib.parse, urllib.request, zipfile
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = 'https://servicodados.ibge.gov.br/api/v3/agregados'
SECTORS = 'https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/'
MESH = 'https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/'
MANIFEST = HERE / 'manifesto.json'
MAX_BYTES = 4 * 1024**3
MIN_FREE = 8 * 1024**3
LOCK = threading.RLock()
DATA = {}
UNIT_NOTES = {
    'PAM': {
        'url': 'https://sidra.ibge.gov.br/pesquisa/pam/tabelas/',
        'section': 'Observação 6 da série histórica das culturas temporárias e permanentes',
        'checked_at': '2026-09-30',
        'access': 'Página oficial verificada pela busca web; tentativa de download HTTP direto retornou 403.',
        'rule': 'Abacaxi e coco-da-baía: quantidade em mil frutos e rendimento em frutos/ha. Nenhuma conversão numérica aplicada.',
    },
    'PPM': {
        'url': API + '/74/metadados',
        'rule': 'Variável 106 usa a unidade específica da categoria da classificação 80; total permanece sem unidade.',
    },
    'derived_columns': 'unidade contém a resolução documentada; unidade_api conserva o texto literal; origem_unidade identifica a regra.',
}

def now():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).isoformat(timespec='seconds')

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024**2), b''): h.update(chunk)
    return h.hexdigest()

def save_manifest():
    with LOCK:
        DATA['updated_at'] = now()
        DATA['stored_bytes'] = sum(p.stat().st_size for p in HERE.rglob('*') if p.is_file())
        tmp = MANIFEST.with_suffix('.tmp')
        tmp.write_text(json.dumps(DATA, ensure_ascii=False, indent=2) + '\n')
        tmp.replace(MANIFEST)

def ensure_space(extra=0):
    used = sum(p.stat().st_size for p in HERE.rglob('*') if p.is_file())
    if used + extra > MAX_BYTES:
        raise RuntimeError(f'Limite local de 4 GiB: {used} + {extra} bytes')
    if shutil.disk_usage(HERE).free - extra < MIN_FREE:
        raise RuntimeError('Reserva global mínima de 8 GiB seria atingida')

def request(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={
        'User-Agent': 'FancoreGeo-public-data-acquisition/1.0', 'Accept-Encoding': 'identity'
    }), timeout=180)

def decode_http(body):
    return gzip.decompress(body) if body[:2] == b'\x1f\x8b' else body

def read_json(path):
    with gzip.open(path, 'rt', encoding='utf-8') as f: return json.load(f)

def downloaded(url, relative, kind, reference, **extra):
    """Retorna caminho, conservando evidência e retomando só arquivos de hash íntegro."""
    path = HERE / relative
    with LOCK:
        previous = next((e for e in DATA['files'] if e['url'] == url and e['raw_path'] == relative), None)
        if previous and previous.get('status') == 'downloaded' and path.exists() and sha(path) == previous.get('sha256'):
            return path
        entry = previous or dict(url=url, raw_path=relative, kind=kind, reference=reference)
        entry.update(extra, status='pending')
        if not previous: DATA['files'].append(entry)
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(4):
        try:
            ensure_space(32 * 1024**2 if kind.startswith('api') else 0)
            with request(url) as response:
                headers = dict(response.headers)
                length = int(response.headers.get('Content-Length', 0))
                ensure_space(length)
                if kind.startswith('api'):
                    body = decode_http(response.read())
                    parsed = json.loads(body)
                    if kind == 'api-data' and (not isinstance(parsed, list) or not parsed or 'resultados' not in parsed[0]):
                        raise ValueError('Resposta não é série de observações: ' + str(parsed)[:300])
                    packed = gzip.compress(body, mtime=0)
                    path.with_suffix(path.suffix + '.part').write_bytes(packed)
                    entry['decoded_sha256'] = hashlib.sha256(body).hexdigest()
                    entry['decoded_bytes'] = len(body)
                    entry['storage_encoding'] = 'gzip of HTTP-decoded original JSON bytes'
                else:
                    count = 0
                    with path.with_suffix(path.suffix + '.part').open('wb') as f:
                        while chunk := response.read(1024**2):
                            f.write(chunk); count += len(chunk)
                            if count % (64 * 1024**2) < 1024**2: ensure_space()
                    if length and count != length: raise ValueError(f'Conteúdo incompleto: {count}/{length}')
                path.with_suffix(path.suffix + '.part').replace(path)
            with LOCK:
                entry.update(status='downloaded', fetched_at=now(), bytes=path.stat().st_size, sha256=sha(path),
                             last_modified=headers.get('Last-Modified'), content_type=headers.get('Content-Type'))
                entry.pop('error', None)
                save_manifest()
            print(f'OK {relative} {path.stat().st_size:,} bytes', flush=True)
            return path
        except Exception as error:
            with LOCK:
                entry.update(status='failed', error=str(error), last_attempt_at=now(), attempts=attempt + 1)
                save_manifest()
            if attempt < 3: time.sleep(min(2**attempt * 2, 12))
    print(f'FALHA {url}: {entry["error"]}', flush=True)
    return None

def categories(meta, class_id):
    return next(c['categorias'] for c in meta['classificacoes'] if c['id'] == class_id)

def api_jobs():
    jobs = []
    for table in ['10296', '10295', '9923', '9514', '5457', '3939', '74']:
        metadata_path = downloaded(f'{API}/{table}/metadados', f'raw/api/{table}/metadata.json.gz', 'api-metadata', None, table=table)
        periods_path = downloaded(f'{API}/{table}/periodos', f'raw/api/{table}/periods.json.gz', 'api-periods', None, table=table)
        if not metadata_path or not periods_path: continue
        meta, available = read_json(metadata_path), read_json(periods_path)
        periods = ['2022'] if table in ['10296', '10295', '9923', '9514'] else [p['id'] for p in available[-5:]]
        assert set(periods) <= {p['id'] for p in available}
        if table == '10296':
            variables, varied, fixed = ['13604', '1013604'], 386, {2: [6794], 86: [95251]}
            cats = categories(meta, varied)
        elif table == '10295':
            variables, varied, fixed = ['13604', '13431', '13534'], 58, {2: [6794], 86: [95251]}
            cats = [c for c in categories(meta, varied) if c['nome'] not in ['0 a 17 anos', '0 a 9 anos', '10 a 13 anos', '14 a 17 anos']]
        elif table == '9923':
            variables, varied, fixed = ['93'], 1, {}
            cats = categories(meta, varied)
        elif table == '9514':
            variables, varied, fixed = ['93'], 287, {2: [6794], 286: [113635]}
            cats = [c for c in categories(meta, varied) if c['nome'] in ['Total', '100 anos ou mais'] or (re.fullmatch(r'\d+ anos?', c['nome']) and int(c['nome'].split()[0]) >= 18)]
        elif table == '5457':
            variables, varied, fixed = ['8331', '216', '214', '112', '215'], 782, {}
            cats = categories(meta, varied)
        elif table == '3939':
            variables, varied, fixed = ['105'], 79, {}
            cats = categories(meta, varied)
        else:
            variables, varied, fixed = ['106', '215'], 80, {}
            cats = categories(meta, varied)
        # 5.571 is an upper bound for municipality count, not an assertion of coverage.
        # The official API returned HTTP 500 for batches around 67-85k cells.
        # Confirmed successful with 22-33k cells; keep a conservative 35k ceiling.
        per_batch = max(1, 35000 // (5571 * len(variables)))
        DATA['tables'][table] = dict(name=meta['nome'], reference=periods, variables=variables,
                                    varied_classification=varied, categories=cats, fixed_classifications=fixed,
                                    territorial_level='N6', expected_scope='Todos os municípios presentes na tabela/ano oficial')
        for period in periods:
            for start in range(0, len(cats), per_batch):
                selected = [c['id'] for c in cats[start:start + per_batch]]
                dimensions = dict(fixed, **{str(varied): selected})
                classification = '|'.join(f'{key}[{",".join(map(str, value))}]' for key, value in dimensions.items())
                query = urllib.parse.urlencode({'localidades': 'N6[all]', 'classificacao': classification})
                url = f'{API}/{table}/periodos/{period}/variaveis/{"|".join(variables)}?{query}'
                signature = hashlib.sha256(url.encode()).hexdigest()[:10]
                relative = f'raw/api/{table}/{period}-batch-{start // per_batch + 1:03d}-{signature}.json.gz'
                jobs.append((url, relative, 'api-data', [period], dict(table=table, categories=selected, variables=variables)))
    current = {(job[0], job[1]) for job in jobs}
    for entry in DATA['files']:
        if entry['kind'] == 'api-data' and (entry['url'], entry['raw_path']) not in current:
            entry['status'] = 'superseded'
            entry['superseded_reason'] = 'Lotes menores para contornar HTTP 500; falha original preservada no registro.'
    save_manifest()
    return jobs

def run_api(workers, include_sectors=False):
    jobs = api_jobs()
    print(f'{len(jobs)} lotes municipais planejados', flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers + int(include_sectors)) as executor:
        futures = [executor.submit(collect_sectors)] if include_sectors else []
        futures += [executor.submit(downloaded, *job[:4], **job[4]) for job in jobs]
        for future in concurrent.futures.as_completed(futures): future.result()

def classify_value(raw):
    if raw == '-': return 0, 'zero_absoluto'
    if raw in {'X', 'x'}: return None, 'sigilo'
    if raw == '..': return None, 'nao_se_aplica'
    if raw == '...': return None, 'indisponivel'
    if raw in {'', None}: return None, 'ausente'
    try:
        value = float(raw)
        return (int(value) if value.is_integer() else value, 'numerico') if math.isfinite(value) else (None, 'nao_finito')
    except (TypeError, ValueError): return None, 'simbolo_nao_reconhecido'

def observation_unit(table, variable, dimensions, definition):
    """Resolve exceções oficiais, mantendo a unidade literal da API em outro campo."""
    unit = variable.get('unidade', '')
    source = 'resposta_api'
    if table == '74' and variable['id'] == '106':
        category = next(iter(dimensions['80']))
        unit = next(cat.get('unidade') or '' for cat in definition['categories'] if str(cat['id']) == category)
        source = 'metadado_categoria_80'
    if table == '5457' and variable['id'] in ['214', '112'] and next(iter(dimensions['782'])) in ['40092', '40145']:
        unit = 'Mil frutos' if variable['id'] == '214' else 'Frutos por Hectare'
        source = 'nota_6_pam_sidra'
    return unit, source

def derive():
    (HERE / 'derived').mkdir(exist_ok=True)
    for table, definition in DATA['tables'].items():
        entries = [e for e in DATA['files'] if e.get('table') == table and e['kind'] == 'api-data' and e['status'] == 'downloaded']
        if not entries: continue
        target = HERE / f'derived/{table}-municipios.csv.gz'
        counts, years, variables, statuses = Counter(), defaultdict(set), defaultdict(set), Counter()
        with gzip.open(target, 'wt', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['municipio_id', 'municipio', 'periodo', 'variavel_id', 'variavel', 'unidade', 'categorias_json', 'valor_original', 'valor', 'status', 'unidade_api', 'origem_unidade'])
            for entry in sorted(entries, key=lambda e: e['raw_path']):
                n = 0; cities = set(); present = Counter()
                for variable in read_json(HERE / entry['raw_path']):
                    for result in variable['resultados']:
                        dimensions = {c['id']: c['categoria'] for c in result['classificacoes']}
                        categories_json = json.dumps(dimensions, ensure_ascii=False, separators=(',', ':'))
                        unit, unit_source = observation_unit(table, variable, dimensions, definition)
                        for series in result['series']:
                            local = series['localidade']
                            for period, raw in series['serie'].items():
                                value, status = classify_value(raw)
                                writer.writerow([local['id'], local['nome'], period, variable['id'], variable['variavel'], unit, categories_json, raw, '' if value is None else value, status, variable.get('unidade', ''), unit_source])
                                n += 1; cities.add(local['id']); present[status] += 1; statuses[status] += 1
                                years[period].add(local['id']); variables[variable['id']].add(local['id']); counts[period] += 1
                entry['coverage'] = dict(municipalities=len(cities), observations=n, statuses=dict(present))
        definition['coverage'] = dict(municipalities_by_year={k: len(v) for k, v in years.items()}, observations_by_year=dict(counts), statuses=dict(statuses))
        definition['derived'] = dict(path=str(target.relative_to(HERE)), bytes=target.stat().st_size, sha256=sha(target), rows=sum(counts.values()))
        save_manifest()
        print(f'DERIVED {table}: {sum(counts.values()):,} observações; {definition["coverage"]["municipalities_by_year"]}', flush=True)

def directory(url, name):
    path = downloaded(url, f'raw/setores/indices/{name}.html', 'directory-index', 'Censo 2022')
    if not path: return []
    body = decode_http(path.read_bytes()).decode('utf-8', errors='replace')
    links = re.findall(r'href="([^"]+)"', body)
    return [urllib.parse.urljoin(url, item) for item in links if not item.startswith(('?', '/', 'http', '#'))]

def collect_sectors():
    """Índices oficiais orientam a seleção; nunca usa a malha preliminar."""
    roots = directory(SECTORS, 'agregados-raiz')
    packages = directory(SECTORS + 'Agregados_por_Setor_csv/', 'agregados-csv')
    selected = [u for u in packages if re.search(r'(basico|demografia)', u, re.I)]
    documents = [u for u in roots if 'dicionario' in u.lower()]
    mesh_root = directory(MESH, 'malha-raiz')
    documents += [u for u in mesh_root if u.lower().endswith('.pdf')]
    for url in documents + selected:
        downloaded(url, 'raw/setores/' + urllib.parse.unquote(url.rsplit('/', 1)[1]), 'sector-document' if url in documents else 'sector-data', '2022')
    # This endpoint contains the definitive, not preliminary, census geometries.
    mesh_folders = directory(MESH + 'setores/', 'malha-setores')
    with LOCK: DATA['sector_geometry_candidates'] = mesh_folders
    national = directory(MESH + 'setores/gpkg/BR/', 'malha-gpkg-br')
    for url in national:
        if url.lower().endswith(('.zip', '.gpkg')):
            downloaded(url, 'raw/setores/' + urllib.parse.unquote(url.rsplit('/', 1)[1]), 'sector-geometry', '2022',
                       limitations=['Malha definitiva 2022; vincular por CD_SETOR, respeitando setores sem estatísticas ou com supressão.'])
    with LOCK: DATA['sector_selected_packages'] = selected
    save_manifest()

def main():
    global DATA
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', choices=['all', 'api', 'setores', 'derive'], default='all')
    parser.add_argument('--workers', type=int, default=3)
    args = parser.parse_args()
    HERE.mkdir(parents=True, exist_ok=True)
    DATA = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else dict(
        schema_version=1, created_at=now(), source='IBGE oficial', purpose='Aquisição para revisão do modelo Agrobar; não integrado à produção',
        max_local_bytes=MAX_BYTES, minimum_free_volume_bytes=MIN_FREE, files=[], tables={},
        limitations=[
            'Censo 2022 não é estimativa populacional de 2026; território e cobertura seguem cada tabela oficial.',
            'Renda: resultados preliminares da amostra, reais e salário mínimo de 2022; total de sexo e cor/raça.',
            '10295 inclui total e grupos adultos que podem se sobrepor; não somar categorias hierárquicas.',
            '9514: idades simples de 18 a 99, grupo aberto 100+ e total; sexo e forma de declaração totais.',
            'SIDRA: - é zero absoluto; 0 é valor zero publicado; X é sigilo; .. não se aplica; ... indisponível. Símbolos originais preservados.',
            'PAM: valor bruto da produção não é VAB/renda; novas culturas em 2025 e totais/subtipos de café não podem ser somados indiscriminadamente.',
            'PAM: quantidade e rendimento de culturas diferentes têm unidades/exceções; conservar unidades da resposta e notas dos metadados.',
            'PPM: estoque de rebanho não equivale à produção anual; subclasses de suínos/galinhas se sobrepõem aos totais.',
            'Setores censitários definitivos: estatísticas podem excluir setores sem moradores e conter supressão; geometria pode conter setores adicionais.',
        ])
    DATA['unit_resolution'] = UNIT_NOTES
    ensure_space(); save_manifest()
    if args.only in ['all', 'api']: run_api(max(1, min(args.workers, 4)), include_sectors=args.only == 'all')
    if args.only in ['all', 'api', 'derive']: derive()
    if args.only == 'setores': collect_sectors()
    save_manifest()
    failures = [e for e in DATA['files'] if e['status'] == 'failed']
    print(json.dumps({'downloaded': sum(e['status'] == 'downloaded' for e in DATA['files']), 'failed': len(failures), 'stored_bytes': DATA['stored_bytes']}, ensure_ascii=False), flush=True)
    if failures: raise SystemExit(1)

if __name__ == '__main__': main()
