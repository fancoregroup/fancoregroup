"""Consulta pública exploratória ao Google Trends, sem contornar bloqueios."""
import json
import requests
from coleta_util import ROOT, now, save_json, digest


def parse_json(text):
    # API pública usa prefixo contra inclusão de JSON em scripts.
    pos = text.find("{")
    if pos < 0:
        raise ValueError("Resposta sem objeto JSON")
    return json.loads(text[pos:])


def main():
    folder = ROOT / "interesse"
    raw = folder / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    request = {"comparisonItem": [{"keyword": keyword, "geo": "BR", "time": "today 5-y"}
                                  for keyword in ["sertanejo", "rodeio", "bar sertanejo", "Agrobar"]],
               "category": 0, "property": ""}
    endpoint = "https://trends.google.com/trends/api/explore"
    manifest = {"family": "google_trends", "collected_at": now(), "source_url": endpoint,
                "reference": "Janela móvel de cinco anos, Brasil", "query": request, "files": [],
                "limitations": ["Acesso público não equivale a base nacional aberta de consumidores.",
                                 "Resultados normalizados e amostrais; ausência de interesse publicado não é zero consumidores.",
                                 "Dados por cidade podem não existir para termos de baixo volume."], "errors": []}
    try:
        response = requests.get(endpoint, params={"hl": "pt-BR", "tz": "180", "req": json.dumps(request, separators=(",", ":"))},
                                headers={"User-Agent": "Mozilla/5.0"}, timeout=45)
        manifest["http_status"] = response.status_code
        if response.status_code != 200:
            manifest["status"] = "unavailable"
            manifest["errors"].append(f"Google Trends retornou HTTP {response.status_code}; nenhum dado coletado, sem retentativas automáticas de bloqueio.")
        else:
            result = parse_json(response.text)
            path = raw / "explore.json"
            save_json(path, result)
            manifest["files"].append({"raw_path": str(path.relative_to(ROOT)), "bytes": path.stat().st_size, "sha256": digest(path)})
            manifest["status"] = "metadata_only"
            manifest["errors"].append("Somente metadados de consulta; não considerar série de interesse coletada.")
    except Exception as error:
        manifest["status"] = "unavailable"
        manifest["errors"].append(str(error))
    save_json(folder / "manifesto.json", manifest)
    print(json.dumps({"status": manifest["status"], "errors": manifest["errors"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
