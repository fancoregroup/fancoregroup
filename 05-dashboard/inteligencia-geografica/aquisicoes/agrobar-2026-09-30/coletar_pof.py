"""POF 2017–2018: arquivos oficiais, documentação e programas de leitura."""
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin
import zipfile
from coleta_util import ROOT, download, now, save_json

URL = "https://ftp.ibge.gov.br/Orcamentos_Familiares/Pesquisa_de_Orcamentos_Familiares_2017_2018/Microdados/"


def main():
    folder = ROOT / "consumo"
    manifest = {"family": "pof", "reference": "2017-2018", "collected_at": now(), "source_url": URL,
                "files": [], "errors": [], "limitations": ["Amostra domiciliar: respeitar pesos e desenho amostral.", "Não representa gasto observado por município; aplicação municipal é uma estimativa modelada."]}
    response = requests.get(URL, timeout=45)
    response.raise_for_status()
    for a in BeautifulSoup(response.text, "html.parser").select("a[href]"):
        name = a["href"]
        if not name.endswith((".zip", ".pdf")):
            continue
        try:
            path = folder / "raw" / name
            meta = download(urljoin(URL, name), path)
            if name.endswith(".zip"):
                with zipfile.ZipFile(path) as z:
                    bad = z.testzip()
                    if bad:
                        raise ValueError(f"CRC inválido: {bad}")
                    meta["zip_crc_verified"] = True
                    meta["entries"] = z.namelist()
            manifest["files"].append(meta)
            print("POF", name, meta["bytes"], flush=True)
        except Exception as error:
            manifest["errors"].append({"file": name, "error": str(error)})
        save_json(folder / "manifesto.json", manifest)
    manifest["status"] = "complete" if not manifest["errors"] and manifest["files"] else "partial"
    save_json(folder / "manifesto.json", manifest)


if __name__ == "__main__":
    main()
