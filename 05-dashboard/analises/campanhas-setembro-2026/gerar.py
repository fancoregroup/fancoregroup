#!/usr/bin/env python3
"""Gera o painel local e sua cópia publicada a partir dos CSVs de setembro."""

import csv
import json
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parent
EXPECTED = ["Nivel", "Origem", "Campanha", "Criativo", "Invest", "Impressoes", "Cliques", "Leads", "CPM", "CTR_%", "CPL"]


def number(raw):
    if not raw.strip():
        return None
    return float(Decimal(raw.replace(".", "").replace(",", ".")))


def load(brand):
    path = ROOT / "fontes" / f"{brand}-setembro-2026.csv"
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file, delimiter=";")
        if reader.fieldnames != EXPECTED:
            raise ValueError(f"Colunas inesperadas em {path.name}: {reader.fieldnames}")
        result = []
        for line, row in enumerate(reader, 2):
            if row["Nivel"] not in ("Campanha", "Criativo") or row["Origem"] not in ("Interna", "3P"):
                raise ValueError(f"Nível ou origem inesperado em {path.name}:{line}")
            item = {
                "brand": brand,
                "level": row["Nivel"],
                "origin": row["Origem"],
                "name": row["Campanha"] if row["Nivel"] == "Campanha" else row["Criativo"],
                "spend": number(row["Invest"]),
                "impressions": number(row["Impressoes"]),
                "clicks": number(row["Cliques"]),
                "leads": number(row["Leads"]),
                "source": path.name,
                "line": line,
            }
            if not item["name"] or any(item[key] is None for key in ("spend", "impressions", "clicks")):
                raise ValueError(f"Linha incompleta em {path.name}:{line}")
            result.append(item)
    return result


def main():
    rows = load("Estica") + load("Agrobar")
    if not rows: raise ValueError("Nenhuma linha de campanha disponível.")
    campaigns = [r for r in rows if r["level"] == "Campanha"]
    unknown = [r for r in rows if r["level"] == "Criativo" and r["brand"] == "Agrobar" and r["origin"] == "3P"]
    template = (ROOT / "template.html").read_text(encoding="utf-8")
    payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    html = template.replace("__DATA__", payload)
    local = ROOT / "dashboard.html"
    published = ROOT.parents[1] / "demo" / "site" / "campanhas-setembro-2026" / "index.html"
    published.parent.mkdir(parents=True, exist_ok=True)
    local.write_text(html, encoding="utf-8")
    published.write_text(html, encoding="utf-8")
    print(f"dashboard.html e rota publicada: {len(campaigns)} campanhas, {len(rows) - len(campaigns)} criativos")


if __name__ == "__main__":
    main()
