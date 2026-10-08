#!/usr/bin/env python3
"""Integra as 21 faixas do Censo 2022 e o recorte de idade presumida recebido."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SITE = ROOT / "05-dashboard/demo/site/inteligencia-geografica/dados"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
AGE_BANDS = [
    ("93070", "0 a 4 anos"), ("93084", "5 a 9 anos"), ("93085", "10 a 14 anos"),
    ("93086", "15 a 19 anos"), ("93087", "20 a 24 anos"), ("93088", "25 a 29 anos"),
    ("93089", "30 a 34 anos"), ("93090", "35 a 39 anos"), ("93091", "40 a 44 anos"),
    ("93092", "45 a 49 anos"), ("93093", "50 a 54 anos"), ("93094", "55 a 59 anos"),
    ("93095", "60 a 64 anos"), ("93096", "65 a 69 anos"), ("93097", "70 a 74 anos"),
    ("93098", "75 a 79 anos"), ("49108", "80 a 84 anos"), ("49109", "85 a 89 anos"),
    ("60040", "90 a 94 anos"), ("60041", "95 a 99 anos"), ("6653", "100 anos ou mais"),
]
GROUPS = [AGE_BANDS[i:i + 4] for i in range(0, len(AGE_BANDS), 4)]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def xlsx_rows(archive: zipfile.ZipFile, sheet: int, shared: list[str]):
    with archive.open(f"xl/worksheets/sheet{sheet}.xml") as stream:
        for _, element in ET.iterparse(stream, events=("end",)):
            if element.tag != NS + "row":
                continue
            row = {}
            for cell in element:
                match = re.match(r"[A-Z]+", cell.get("r", ""))
                if not match:
                    continue
                raw = cell.find(NS + "v")
                inline = cell.find(NS + "is")
                value = raw.text if raw is not None and raw.text is not None else ""
                if inline is not None:
                    value = "".join(inline.itertext())
                elif cell.get("t") == "s" and value:
                    value = shared[int(value)]
                row[match.group()] = value
            yield int(element.get("r", "0")), row
            element.clear()


def count(value: str) -> int | None:
    if value == "-":
        return 0
    if value in ("", "..", "...", "X"):
        return None
    return int(value)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--planilha", type=Path, default=ROOT / ".orca/drops/tabela9514-2.xlsx")
    parser.add_argument("--api-dir", type=Path, default=HERE / "fontes/idades-9514-total-2022")
    args = parser.parse_args()

    geo = json.loads((SITE / "municipios.json").read_text(encoding="utf-8"))
    geo_by_id = {city["id"]: city for city in geo["cities"]}
    assert len(geo_by_id) == 5571

    full = {}
    api_sources = []
    for group_number, group in enumerate(GROUPS):
        path = args.api_dir / f"fancore-idades-{group_number}.json.gz"
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            payload = json.load(stream)
        assert len(payload) == 1 and payload[0]["id"] == "93"
        category_ids = [next(iter(next(item for item in result["classificacoes"] if item["id"] == "287")["categoria"])) for result in payload[0]["resultados"]]
        expected = [code for code, _ in group] if group_number < 5 else ["6653", "100362"]
        assert category_ids == expected, (group_number, category_ids)
        for result in payload[0]["resultados"]:
            categories = {item["id"]: next(iter(item["categoria"])) for item in result["classificacoes"]}
            assert categories["2"] == "6794" and categories["286"] == "113635"
            code = categories["287"]
            assert len(result["series"]) == 5570
            full[code] = {item["localidade"]["id"]: count(item["serie"]["2022"]) for item in result["series"]}
        url = ("https://servicodados.ibge.gov.br/api/v3/agregados/9514/periodos/2022/variaveis/93"
               f"?localidades=N6[all]&classificacao=2[6794]|286[113635]|287[{','.join(expected)}]")
        api_sources.append({"url": url, "sha256": sha256(path), "bytes": path.stat().st_size})

    workbook_values = {}
    with zipfile.ZipFile(args.planilha) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ["".join(item.itertext()) for item in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        for sheet_number in range(1, 23):
            expected_label = "Idade - " + ("Total" if sheet_number == 1 else AGE_BANDS[sheet_number - 2][1])
            values = {}
            for row_number, row in xlsx_rows(archive, sheet_number, shared):
                if row_number == 2:
                    assert row.get("A") == expected_label, (sheet_number, row)
                elif row_number >= 7 and row.get("B") == "MU":
                    code = row["C"]
                    assert code not in values
                    raw_percent = row.get("F", "")
                    values[code] = [count(row.get("E", "")), None if raw_percent in ("", "-", "..", "...", "X") else float(raw_percent)]
            assert len(values) == 5570, (sheet_number, len(values))
            workbook_values["100362" if sheet_number == 1 else AGE_BANDS[sheet_number - 2][0]] = values

    codes = set(full["100362"])
    assert len(codes) == 5570 and all(set(values) == codes for values in full.values())
    assert all(set(values) == codes for values in workbook_values.values())
    assert codes <= set(geo_by_id)

    rows = []
    export = {"source": {"table": "9514", "year": 2022, "sex": "Total", "fullAgeDeclaration": "Total", "workbookAgeDeclaration": "Idade presumida", "url": "https://sidra.ibge.gov.br/tabela/9514"},
              "bands": [{"id": code, "label": label} for code, label in AGE_BANDS], "cities": {}}
    cumulative_rounding_issues = 0
    for code in sorted(codes):
        city = geo_by_id[code]
        population = full["100362"][code]
        assert population == city["metrics"]["censusPopulation"]["value"], code
        totals = [full[band][code] for band, _ in AGE_BANDS]
        presumed = [workbook_values[band][code][0] for band, _ in AGE_BANDS]
        presumed_pct = [workbook_values[band][code][1] for band, _ in AGE_BANDS]
        assert all(value is not None for value in totals + presumed), code
        assert sum(totals) == population, (code, sum(totals), population)
        presumed_population, presumed_total_pct = workbook_values["100362"][code]
        assert sum(presumed) == presumed_population, (code, sum(presumed), presumed_population)
        assert sum(totals[4:8]) == city["metrics"]["youngAdults"]["value"], code
        assert sum(totals[12:]) == city["metrics"]["seniors"]["value"], code
        for value, pct in zip(presumed, presumed_pct):
            if pct is None:
                assert value == 0
            elif abs(pct - 100 * value / population) > 0.011:
                cumulative_rounding_issues += 1
        export["cities"][code] = {"population": population, "presumedPopulation": presumed_population,
                                  "presumedPopulationPct": presumed_total_pct, "total": totals,
                                  "presumed": presumed, "presumedPct": presumed_pct}
        row = {"codigo_ibge": code, "municipio": city["name"], "uf": city["uf"],
               "populacao_censo_2022": population, "idade_presumida_total": presumed_population,
               "idade_presumida_pct": presumed_total_pct}
        for (band, label), total, presumed_count, pct in zip(AGE_BANDS, totals, presumed, presumed_pct):
            key = band
            row[f"idade_{key}_pessoas"] = total
            row[f"idade_{key}_pct_populacao"] = round(100 * total / population, 4)
            row[f"idade_{key}_presumida_pessoas"] = presumed_count
            row[f"idade_{key}_presumida_pct_populacao"] = pct
        rows.append(row)
    assert cumulative_rounding_issues == 0, cumulative_rounding_issues

    SITE.mkdir(parents=True, exist_ok=True)
    json_path = SITE / "idades-municipios.json"
    json_path.write_text(json.dumps(export, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    csv_path = SITE / "idades-municipios.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]), delimiter=";", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    audit = {"sourceWorkbook": str(args.planilha), "sourceWorkbookSha256": sha256(args.planilha),
             "workbookFilter": "Forma de declaração da idade: Idade presumida; sexo: Total; ano: 2022",
             "officialTotalSources": api_sources, "municipalities": len(codes),
             "notInCensus": [{"id": code, "name": city["name"], "uf": city["uf"]} for code, city in geo_by_id.items() if code not in codes],
             "ageBands": len(AGE_BANDS), "populationReconciled": True, "youngAdultsReconciled": True,
             "seniorsReconciled": True, "presumedBandsReconciled": True, "roundedPercentsWithinTolerance": True,
             "siteJsonSha256": sha256(json_path), "siteCsvSha256": sha256(csv_path)}
    (HERE / "idades-auditoria.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: audit[key] for key in ("municipalities", "notInCensus", "ageBands", "populationReconciled", "youngAdultsReconciled", "seniorsReconciled")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
