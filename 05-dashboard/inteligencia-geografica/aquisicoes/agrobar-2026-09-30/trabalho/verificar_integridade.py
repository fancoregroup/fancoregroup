#!/usr/bin/env python3
"""Confere SHA256, bytes e CRC dos originais, sem extrair TXT no disco.

Reutiliza provas CRC da agregação RAIS apenas se o SHA256 do original confere.
O teste py7zr.testzip() descomprime para um destino nulo, em memória limitada.
"""
import json
from pathlib import Path
import shutil
import zipfile

import py7zr
from coletar import ROOT, now, sha

MANIFESTS = ['manifesto.json', 'manifesto-caged-microdados.json', 'manifesto-notas.json']


def main():
    sources = {}
    for name in MANIFESTS:
        for source in json.loads((ROOT / name).read_text()).get('sources', []):
            sources[source['id']] = source
    proof_path = ROOT / 'integridade.json'
    old = json.loads(proof_path.read_text()) if proof_path.exists() else {}
    cache = {x['id']: x for x in old.get('files', [])}
    report = {'verified_at': now(), 'files': [], 'complete': False, 'minimum_free_bytes': 10*1024**3,
              'method': 'SHA256 e tamanho de todos os arquivos. CRC integral de arquivos ZIP/XLSX/7z; descompressão para destino nulo ou prova de agregação streaming.'}
    for identifier, source in sorted(sources.items()):
        path = ROOT / source['raw_path']
        result = {'id': identifier, 'path': source['raw_path'], 'checked_at': now()}
        try:
            assert path.is_file(), 'Arquivo ausente'
            assert shutil.disk_usage(ROOT).free >= report['minimum_free_bytes'], 'Piso de espaço livre atingido'
            digest = sha(path)
            size = path.stat().st_size
            assert digest == source['sha256'], 'SHA256 diferente do manifesto'
            assert size == source['bytes'], 'Tamanho diferente do manifesto'
            if source.get('expected_bytes'):
                assert size == source['expected_bytes'], 'Tamanho diferente do FTP'
            if source.get('listed_bytes'):
                assert size == source['listed_bytes'], 'Tamanho diferente da listagem oficial'
            result.update(bytes=size, sha256=digest, status='verified')
            previous = cache.get(identifier)
            if previous and previous.get('sha256') == digest and previous.get('crc_verified'):
                result.update(crc_verified=True, method='CRC integral reaproveitado com SHA256 idêntico', original_crc_checked_at=previous['checked_at'])
            elif path.suffix == '.7z':
                aggregate_proof = ROOT / 'derived' / (path.stem.lower() + '-municipio-setor.json')
                proof = json.loads(aggregate_proof.read_text()) if aggregate_proof.exists() else {}
                if proof.get('source_sha256') == digest and proof.get('crc_verified'):
                    result.update(crc_verified=True, method='CRC integral da agregação streaming', proof=str(aggregate_proof.relative_to(ROOT)))
                else:
                    with py7zr.SevenZipFile(path) as archive:
                        bad = archive.testzip()
                        assert bad is None, 'CRC incorreto: ' + str(bad)
                    result.update(crc_verified=True, method='py7zr.testzip(), descompressão integral para destino nulo')
            elif path.suffix in ('.zip', '.xlsx'):
                with zipfile.ZipFile(path) as archive:
                    bad = archive.testzip()
                    assert bad is None, 'CRC incorreto: ' + str(bad)
                result.update(crc_verified=True, method='zipfile.testzip()')
            else:
                result['method'] = 'SHA256 e tamanho'
        except Exception as error:
            result.update(status='failed', error=str(error))
        report['files'].append(result)
        report['bytes_verified'] = sum(x.get('bytes', 0) for x in report['files'] if x['status'] == 'verified')
        report['disk_free_bytes'] = shutil.disk_usage(ROOT).free
        proof_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(identifier, result['status'], flush=True)
    report['complete'] = all(x['status'] == 'verified' for x in report['files']) and len(report['files']) == len(sources)
    report['files_verified'] = sum(x['status'] == 'verified' for x in report['files'])
    proof_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    if not report['complete']:
        raise SystemExit('Há falhas de integridade; conferir integridade.json')


if __name__ == '__main__':
    main()
