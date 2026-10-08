"""Estabelecimentos CNPJ de duas fotografias anuais, sem extrair dados pessoais de sócios."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET
import requests
import zipfile
from coleta_util import ROOT, download, now, save_json

HOST = "https://arquivos.receitafederal.gov.br"
# Identificador público de compartilhamento disponibilizado pela Receita, não credencial privada.
SHARE = "YggdBLfdninEJX9"
NS = {"d": "DAV:"}


def listing(session, path):
    response = session.request("PROPFIND", HOST + path, headers={"Depth": "1"}, timeout=60)
    response.raise_for_status()
    result = []
    for item in ET.fromstring(response.content).findall("d:response", NS):
        href = item.findtext("d:href", default="", namespaces=NS)
        size = item.findtext(".//d:getcontentlength", default="0", namespaces=NS)
        result.append({"href": href, "bytes": int(size or 0),
                       "last_modified": item.findtext(".//d:getlastmodified", default="", namespaces=NS)})
    return result


def main(period):
    folder = ROOT / "cnpj"
    manifest_path = folder / f"manifesto-{period}.json"
    manifest = {"family": "cnpj", "reference": period, "collected_at": now(),
                "source_url": HOST + "/index.php/s/" + SHARE,
                "scope": "Todos os 10 arquivos Estabelecimentos e tabelas auxiliares; preservados compactados",
                "files": [], "errors": [],
                "limitations": ["Situação ativa é cadastral, não comprova funcionamento.", "Datas de início/situação não são painel completo de entradas e saídas.", "Endereços ainda exigem normalização e geocodificação; município RFB não é código IBGE.", "Comparação anual registra mudanças entre fotografias, sem reconstituir toda a trajetória."]}
    session = requests.Session()
    session.auth = (SHARE, "")
    entries = listing(session, f"/public.php/webdav/{period}/")
    save_json(folder / "raw" / period / "catalogo.json", entries)
    selected = [entry for entry in entries if Path(unquote(entry["href"])).name.startswith("Estabelecimentos") or Path(unquote(entry["href"])).name in {"Cnaes.zip", "Municipios.zip", "Motivos.zip", "Naturezas.zip", "Paises.zip"}]
    selected.sort(key=lambda item: (Path(item["href"]).name.startswith("Estabelecimentos"), item["href"]))
    def collect(entry):
        name = Path(unquote(entry["href"])).name
        try:
            path = folder / "raw" / period / name
            connection = requests.Session()
            connection.auth = (SHARE, "")
            meta = download(HOST + entry["href"], path, session=connection, expected_bytes=entry["bytes"])
            with zipfile.ZipFile(path) as archive:
                meta["entries"] = [{"name": x.filename, "uncompressed_bytes": x.file_size, "crc32": f"{x.CRC:08x}"} for x in archive.infolist()]
                bad = archive.testzip()
                if bad:
                    raise ValueError(f"CRC inválido: {bad}")
                meta["zip_crc_verified"] = True
            meta["reference"] = period
            print("CNPJ", period, name, meta["bytes"], flush=True)
            return meta, None
        except Exception as error:
            return None, {"file": name, "error": str(error)}
    # Dois arquivos simultâneos por fotografia, sem extrair os grandes CSVs.
    with ThreadPoolExecutor(max_workers=2) as pool:
        for future in as_completed([pool.submit(collect, entry) for entry in selected]):
            meta, error = future.result()
            if meta:
                manifest["files"].append(meta)
            if error:
                manifest["errors"].append(error)
            save_json(manifest_path, manifest)
    count = sum(Path(item["raw_path"]).name.startswith("Estabelecimentos") for item in manifest["files"])
    manifest["establishment_parts"] = count
    manifest["status"] = "complete" if not manifest["errors"] and count == 10 else "partial"
    save_json(manifest_path, manifest)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("period", choices=["2026-09", "2025-09"])
    main(parser.parse_args().period)
