"""Downloads públicos reexecutáveis, com retomada, proveniência e reserva de disco."""
from __future__ import annotations

import hashlib
import fcntl
import json
import os
from pathlib import Path
import shutil
import time
from datetime import datetime
from zoneinfo import ZoneInfo
import requests

ROOT = Path(__file__).resolve().parent
RESERVE_BYTES = 10 * 1024**3
USER_AGENT = "FancoreGeo/1.0 (public datasets; research; sequential downloads)"


def now():
    return datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat()


def digest(path, algorithm="sha256"):
    h = hashlib.new(algorithm)
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(4 * 1024**2), b""):
            h.update(block)
    return h.hexdigest()


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    os.replace(temp, path)


def download(url, target, session=None, expected_bytes=None, expected_md5=None):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Duas execuções não podem escrever no mesmo .part simultaneamente.
    with target.with_suffix(target.suffix + ".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _download(url, target, session, expected_bytes, expected_md5)


def _download(url, target, session=None, expected_bytes=None, expected_md5=None):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    session = session or requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    metadata_path = target.with_suffix(target.suffix + ".download.json")
    if target.exists() and metadata_path.exists():
        meta = json.loads(metadata_path.read_text())
        if meta.get("url") == url and meta.get("bytes") == target.stat().st_size and meta.get("sha256") == digest(target):
            if expected_bytes is not None and expected_bytes != target.stat().st_size:
                raise ValueError("Arquivo existente tem tamanho diferente da fonte")
            if expected_md5 is not None and digest(target, "md5").lower() != expected_md5.lower():
                raise ValueError("Arquivo existente tem MD5 diferente da fonte")
            return meta
    partial = target.with_suffix(target.suffix + ".part")
    partial_meta_path = partial.with_suffix(partial.suffix + ".http.json")

    def discard_partial():
        partial.unlink(missing_ok=True)
        partial_meta_path.unlink(missing_ok=True)

    last_error = None
    for attempt in range(4):
        try:
            offset = partial.stat().st_size if partial.exists() else 0
            headers = {"Accept-Encoding": "identity"}
            partial_meta = {}
            if offset:
                try:
                    partial_meta = json.loads(partial_meta_path.read_text())
                except (OSError, ValueError):
                    pass
                etag = partial_meta.get("etag") or ""
                validator = etag if etag and not etag.startswith("W/") else partial_meta.get("last_modified")
                # Sem identidade da resposta anterior, não misturar versões da URL.
                if partial_meta.get("url") != url or not validator:
                    discard_partial()
                    offset = 0
            if offset:
                headers["Range"] = f"bytes={offset}-"
                headers["If-Range"] = validator
            with session.get(url, headers=headers, stream=True, timeout=(30, 120)) as response:
                if response.status_code == 416 and offset:
                    # Pode ter ocorrido interrupção depois do último byte e antes do rename.
                    discard_partial()
                    raise IOError("Parcial fora da faixa; próxima tentativa começa do início")
                response.raise_for_status()
                append = offset > 0 and response.status_code == 206
                if append and not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
                    discard_partial()
                    raise ValueError("Content-Range incompatível com a retomada")
                if append:
                    header_name = "ETag" if validator == partial_meta.get("etag") else "Last-Modified"
                    if response.headers.get(header_name) != validator:
                        discard_partial()
                        raise ValueError("Fonte mudou ou não confirmou o validador; reiniciar transferência")
                if not append:
                    offset = 0
                size_header = response.headers.get("Content-Length")
                remaining = int(size_header) if size_header else None
                if remaining and shutil.disk_usage(target.parent).free - remaining < RESERVE_BYTES:
                    raise OSError("Download excederia a reserva de 10 GiB de disco")
                content_type = response.headers.get("Content-Type", "")
                if target.suffix.lower() in (".zip", ".xlsx", ".pbf", ".gz", ".7z") and "text/html" in content_type:
                    raise ValueError("Servidor retornou HTML em lugar de arquivo de dados")
                total = offset
                last_print = time.monotonic()
                with partial.open("ab" if append else "wb") as output:
                    save_json(partial_meta_path, {"url": url, "etag": response.headers.get("ETag"),
                                                 "last_modified": response.headers.get("Last-Modified")})
                    for chunk in response.iter_content(2 * 1024**2):
                        if not chunk:
                            continue
                        output.write(chunk)
                        total += len(chunk)
                        if time.monotonic() - last_print > 25:
                            if shutil.disk_usage(target.parent).free < RESERVE_BYTES:
                                raise OSError("Reserva de disco atingida durante transferência")
                            print(json.dumps({"arquivo": target.name, "MiB": round(total / 1024**2)}, ensure_ascii=False), flush=True)
                            last_print = time.monotonic()
                if remaining is not None and total != offset + remaining:
                    raise IOError("Resposta HTTP incompleta")
                if expected_bytes is not None and total != expected_bytes:
                    discard_partial()
                    raise IOError(f"Tamanho {total} difere do catálogo {expected_bytes}")
                if not total:
                    raise IOError("Arquivo vazio")
                if expected_md5 and digest(partial, "md5").lower() != expected_md5.lower():
                    discard_partial()
                    raise IOError("MD5 não confere")
                os.replace(partial, target)
                partial_meta_path.unlink(missing_ok=True)
                meta = {"url": url, "resolved_url": response.url, "fetched_at": now(),
                        "raw_path": str(target.relative_to(ROOT)), "bytes": total,
                        "sha256": digest(target), "content_type": content_type,
                        "last_modified": response.headers.get("Last-Modified"),
                        "etag": response.headers.get("ETag"), "status": "downloaded"}
                if expected_md5:
                    meta["md5_verified"] = expected_md5
                save_json(metadata_path, meta)
                return meta
        except Exception as error:
            last_error = error
            if isinstance(error, OSError) and "disco" in str(error):
                break
            if attempt < 3:
                time.sleep([2, 5, 12][attempt])
    raise RuntimeError(f"Falha em {url}: {last_error}")
