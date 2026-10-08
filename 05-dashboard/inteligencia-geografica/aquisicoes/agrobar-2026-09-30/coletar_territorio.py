"""REGIC completo em XLSX e extrato OSM nacional, preservando as fontes."""
import argparse
from pathlib import Path
import zipfile
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup
from coleta_util import ROOT, download, now, save_json

REGIC = "https://geoftp.ibge.gov.br/organizacao_do_territorio/divisao_regional/regioes_de_influencia_das_cidades/Regioes_de_influencia_das_cidades_2018_Resultados_definitivos/base_tabular/"


def regic():
    folder = ROOT / "territorio"
    manifest = {"family": "regic", "reference": "2018", "collected_at": now(), "source_url": REGIC,
                "scope": "Todos os arquivos XLSX e ZIP de XLSX da base tabular oficial", "files": [], "errors": [],
                "limitations": ["Ligações e atração não são quantidade de viagens ou consumidores.", "Unidades Cidade, município e arranjo populacional precisam de conciliação."]}
    response = requests.get(REGIC, timeout=45)
    response.raise_for_status()
    for anchor in BeautifulSoup(response.text, "html.parser").select("a[href]"):
        name = anchor["href"]
        if not (name.endswith(".xlsx") or name.endswith("_xlsx.zip")):
            continue
        try:
            path = folder / "raw" / name
            meta = download(urljoin(REGIC, name), path)
            with zipfile.ZipFile(path) as z:
                corrupt = z.testzip()
                if corrupt:
                    raise ValueError(f"ZIP corrompido: {corrupt}")
                meta["zip_entries"] = len(z.infolist())
                meta["zip_crc_verified"] = True
                if name.endswith("_xlsx.zip"):
                    meta["workbooks"] = [x for x in z.namelist() if x.endswith(".xlsx")]
            manifest["files"].append(meta)
            print("REGIC", name, meta["bytes"], flush=True)
        except Exception as error:
            manifest["errors"].append({"file": name, "error": str(error)})
        save_json(folder / "manifesto.json", manifest)
    manifest["status"] = "complete" if not manifest["errors"] and manifest["files"] else "partial"
    save_json(folder / "manifesto.json", manifest)


def osm():
    folder = ROOT / "osm"
    # Extrato datado: não usar "latest" para permitir reprodução do mesmo retrato.
    url = "https://download.geofabrik.de/south-america/brazil-260929.osm.pbf"
    manifest = {"family": "osm", "reference": "2026-09-29", "collected_at": now(),
                "source_url": "https://download.geofabrik.de/south-america/brazil.html",
                "license": "ODbL; © OpenStreetMap contributors", "files": [], "errors": [],
                "limitations": ["Cobertura colaborativa variável; ausência não demonstra inexistência.", "Rede viária não contém trânsito observado nem isócronas prontas."]}
    try:
        checksum_path = folder / "raw" / "brazil-260929.osm.pbf.md5"
        check = download(url + ".md5", checksum_path)
        expected = checksum_path.read_text().split()[0]
        meta = download(url, folder / "raw" / "brazil-260929.osm.pbf", expected_md5=expected)
        import osmium
        with osmium.io.Reader(str(folder / "raw" / "brazil-260929.osm.pbf")) as reader:
            header = reader.header()
            meta["osm_data_timestamp"] = header.get("osmosis_replication_timestamp")
            meta["generator"] = header.get("generator")
        manifest["files"] = [check, meta]
    except Exception as error:
        manifest["errors"].append(str(error))
    manifest["status"] = "complete" if not manifest["errors"] and manifest["files"] else "partial"
    save_json(folder / "manifesto.json", manifest)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("family", choices=["regic", "osm"])
    args = parser.parse_args()
    globals()[args.family]()
