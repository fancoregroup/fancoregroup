#!/usr/bin/env python3
"""Triagem municipal da Agrobar. Lê fontes locais, sem alterar o site."""

from __future__ import annotations

import argparse
import bisect
import csv
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# Nomes antigos, grafias e abreviações da Senatran. Chave por código IBGE,
# pois normalização por texto sozinha não resolve renomeações municipais.
FLEET_ALIASES = {
    "2800100": "AMPARO DE SAO FRANCISCO", "3102506": "AMPARO DA SERRA",
    "2401206": "ARES", "4212809": "BALNEARIO DE PICARRAS",
    "3105509": "BARAO D0 MONTE ALTO", "4102752": "BELA VISTA DO CAROBA",
    "2601607": "BELEM DE SAO FRANCISCO", "5203500": "BOM JESUS",
    "1706001": "COUTO DE MAGALHAES", "1502954": "ELDORADO DOS CARAJAS",
    "2606903": "IGUARACI", "2405306": "BOA SAUDE",
    "2513653": "SANTAREM", "2608503": "LAGOA DO ITAENGA",
    "4209458": "LAGEADO GRANDE", "2919058": "LAGEDO DO TABOCAL",
    "4116307": "MUNHOZ DE MELLO", "3303807": "PARATI",
    "4119251": "PINHAL DO SAO BENTO", "4213906": "PRESIDENTE CASTELO BRANCO",
    "3153806": "QUELUZITA", "4123303": "SANTA CRUZ DO MONTE CASTELO",
    "1506500": "SANTA ISABEL DO PARA", "2928505": "SANTA TERESINHA",
    "5107800": "SANTO ANTONIO DO LEVERGER", "2513968": "SAO DOMINGOS DE POMBAL",
    "2209658": "SAO FRANCISCO DE ASSIS DO PIAU", "4216909": "SAO LOURENCO D'OESTE",
    "1400605": "SAO LUIZ", "4217204": "SAO MIGUEL D'OESTE",
    "1720499": "SAO VALERIO DA NATIVIDADE", "1708254": "FORTALEZA DO TABOCAO",
    "3305901": "TRAJANO DE MORAIS", "5105507": "VILA BELA DA SANTISSIMA TRINDA",
}


def normalized_name(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def number(value: str | None) -> float | None:
    if value is None or value.strip() in {"", "-", "...", "..", "X"}:
        return None
    return float(value)


def csv_records(path: Path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle, delimiter=";"))


def xlsx_records(path: Path, sheet_number: int):
    """Lê valores de uma aba XLSX com a biblioteca padrão, sem recalcular fórmulas."""
    with zipfile.ZipFile(path) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(item.itertext()) for item in root]
        worksheet = f"xl/worksheets/sheet{sheet_number}.xml"
        with archive.open(worksheet) as handle:
            for _, element in ET.iterparse(handle, events=("end",)):
                if element.tag != NS + "row":
                    continue
                values = {}
                for cell in element:
                    address = cell.get("r", "")
                    column = re.match(r"[A-Z]+", address)
                    if not column:
                        continue
                    raw = cell.find(NS + "v")
                    inline = cell.find(NS + "is")
                    value = raw.text if raw is not None and raw.text is not None else ""
                    if inline is not None:
                        value = "".join(inline.itertext())
                    elif cell.get("t") == "s" and value:
                        value = shared[int(value)]
                    values[column.group()] = value
                yield int(element.get("r", "0")), values
                element.clear()


def percentile(value: float, values: list[float]) -> float:
    ordered = sorted(values)
    if len(ordered) < 2:
        return 50.0
    first = bisect.bisect_left(ordered, value)
    last = bisect.bisect_right(ordered, value) - 1
    return 100 * ((first + last) / 2) / (len(ordered) - 1)


def population_band(population: float) -> str:
    if population < 25_000:
        return "ate_25_mil"
    if population < 50_000:
        return "25_a_50_mil"
    if population < 100_000:
        return "50_a_100_mil"
    if population < 250_000:
        return "100_a_250_mil"
    if population < 500_000:
        return "250_a_500_mil"
    return "acima_500_mil"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--frota", type=Path, default=ROOT / ".orca/drops/Frota_por_municipio_e_tipo_Julho_2026.xlsx")
    parser.add_argument("--populacao", type=Path, default=ROOT / ".orca/drops/tabela6579.xlsx")
    parser.add_argument("--densidade", type=Path, default=ROOT / ".orca/drops/tabela4714-2.xlsx")
    parser.add_argument("--saida", type=Path, default=HERE)
    args = parser.parse_args()

    geo_path = ROOT / "05-dashboard/inteligencia-geografica/exportacoes/municipios-brasil.csv"
    cnpj_path = ROOT / "05-dashboard/demo/site/inteligencia-geografica/dados/cnpj-municipios.csv"
    geo = {row["id"]: row for row in csv_records(geo_path)}
    cnpj = {row["codigo_ibge"]: row for row in csv_records(cnpj_path)}
    assert len(geo) == 5571 and len(cnpj) == 5571

    estimated_population = {}
    for row_number, row in xlsx_records(args.populacao, 1):
        if row_number >= 5 and row.get("A") == "MU":
            code = row["B"]
            assert code not in estimated_population
            estimated_population[code] = int(float(row["D"]))

    census_density = {}
    for row_number, row in xlsx_records(args.densidade, 3):
        if row_number >= 5 and row.get("A") == "MU":
            code = row["B"]
            assert code not in census_density
            census_density[code] = number(row.get("D"))

    fleet = {}
    fleet_duplicates = []
    for row_number, row in xlsx_records(args.frota, 1):
        if row_number < 5 or len(row.get("A", "")) != 2 or not row.get("B"):
            continue
        key = (row["A"], normalized_name(row["B"]))
        if key in fleet:
            fleet_duplicates.append({"uf": key[0], "municipio": row["B"], "linhas": [fleet[key]["linha"], row_number]})
            continue
        fleet[key] = {
            "linha": row_number,
            "municipio": row["B"],
            "total": int(float(row["C"])),
            "automovel": int(float(row["D"])),
            "caminhonete": int(float(row["H"])),
            "camioneta": int(float(row["I"])),
            "utilitario": int(float(row["X"])),
        }

    records = []
    missing_fleet = []
    population_disagreements = []
    for code, place in geo.items():
        assert code in cnpj and code in estimated_population
        source = cnpj[code]
        assert place["uf"] == source["uf"]
        population = estimated_population[code]
        if number(place["population"]) != population:
            population_disagreements.append(code)
        fleet_key = (place["uf"], normalized_name(FLEET_ALIASES.get(code, place["name"])))
        vehicles = fleet.get(fleet_key)
        if vehicles is None:
            missing_fleet.append({"codigo_ibge": code, "municipio": place["name"], "uf": place["uf"]})
        bars = int(source["bares_principal"])
        entertainment = int(source["bares_com_principal"]) + int(source["noturnas_principal"])
        assert entertainment >= 0 and bars >= int(source["bares_com_principal"])
        light = None if vehicles is None else sum(vehicles[key] for key in ("automovel", "caminhonete", "camioneta", "utilitario"))
        record = {
            "codigo_ibge": code,
            "municipio": place["name"],
            "uf": place["uf"],
            "regiao": place["region"],
            "faixa_populacao": population_band(population),
            "populacao_2026": population,
            "densidade_hab_km2_2022": census_density.get(code),
            "renda_mediana_pc_2022": number(place.get("medianIncome")),
            "agro_no_vab_pct_2021": number(place.get("agroShare")),
            "bares_cnpj_principal_set2026": bars,
            "bares_com_entretenimento_cnpj_principal_set2026": int(source["bares_com_principal"]),
            "casas_noturnas_cnpj_principal_set2026": int(source["noturnas_principal"]),
            "restaurantes_cnpj_principal_set2026": int(source["restaurantes_principal"]),
            "bares_por_10mil_hab": bars * 10_000 / population if population else None,
            "entretenimento_por_10mil_hab": entertainment * 10_000 / population if population else None,
            "caminhonetes_jul2026": vehicles["caminhonete"] if vehicles else None,
            "veiculos_leves_jul2026": light,
            "caminhonetes_pct_veiculos_leves": 100 * vehicles["caminhonete"] / light if vehicles and light else None,
        }
        records.append(record)

    by_band = defaultdict(list)
    by_region_band = defaultdict(list)
    for record in records:
        by_band[record["faixa_populacao"]].append(record)
        by_region_band[(record["regiao"], record["faixa_populacao"])].append(record)

    positive_population = [row["populacao_2026"] for row in records if row["populacao_2026"]]
    known_income = [row["renda_mediana_pc_2022"] for row in records if row["renda_mediana_pc_2022"] is not None]
    known_agro = [row["agro_no_vab_pct_2021"] for row in records if row["agro_no_vab_pct_2021"] is not None]
    known_pickups = [row["caminhonetes_pct_veiculos_leves"] for row in records if row["caminhonetes_pct_veiculos_leves"] is not None]

    for record in records:
        group = by_region_band[(record["regiao"], record["faixa_populacao"])]
        if len(group) < 30:
            group = by_band[record["faixa_populacao"]]
            record["grupo_comparacao"] = "Brasil / " + record["faixa_populacao"]
        else:
            record["grupo_comparacao"] = record["regiao"] + " / " + record["faixa_populacao"]
        bars_values = [item["bares_por_10mil_hab"] for item in group if item["bares_por_10mil_hab"] is not None]
        entertainment_values = [item["entretenimento_por_10mil_hab"] for item in group if item["entretenimento_por_10mil_hab"] is not None]
        record["score_concorrencia_0a100"] = round(
            0.7 * (100 - percentile(record["bares_por_10mil_hab"], bars_values))
            + 0.3 * (100 - percentile(record["entretenimento_por_10mil_hab"], entertainment_values)), 2
        )
        agro = record["agro_no_vab_pct_2021"]
        pickup = record["caminhonetes_pct_veiculos_leves"]
        income = record["renda_mediana_pc_2022"]
        if agro is not None and pickup is not None:
            record["score_cultura_proxy_0a100"] = round(0.6 * percentile(agro, known_agro) + 0.4 * percentile(pickup, known_pickups), 2)
        else:
            record["score_cultura_proxy_0a100"] = None
        if income is not None:
            record["score_escala_renda_0a100"] = round(0.7 * percentile(record["populacao_2026"], positive_population) + 0.3 * percentile(income, known_income), 2)
        else:
            record["score_escala_renda_0a100"] = None
        if all(record[key] is not None for key in ("score_cultura_proxy_0a100", "score_escala_renda_0a100")):
            record["indice_agrobar_v0_0a100"] = round(
                0.6 * record["score_concorrencia_0a100"]
                + 0.25 * record["score_cultura_proxy_0a100"]
                + 0.15 * record["score_escala_renda_0a100"], 2
            )
        else:
            record["indice_agrobar_v0_0a100"] = None

    records.sort(key=lambda row: (row["indice_agrobar_v0_0a100"] is None, -(row["indice_agrobar_v0_0a100"] or 0), row["municipio"], row["uf"]))
    for position, record in enumerate(records, 1):
        record["posicao_exploratoria"] = position if record["indice_agrobar_v0_0a100"] is not None else None

    args.saida.mkdir(parents=True, exist_ok=True)
    output = args.saida / "indice-agrobar-v0.csv"
    fields = ["posicao_exploratoria"] + [field for field in records[0] if field != "posicao_exploratoria"]
    with output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, delimiter=";")
        writer.writeheader()
        writer.writerows(records)

    matched_keys = {(row["uf"], normalized_name(FLEET_ALIASES.get(row["codigo_ibge"], row["municipio"]))) for row in records}
    assert not missing_fleet, missing_fleet
    assert set(FLEET_ALIASES) <= set(geo)
    audit = {
        "versao": "indice-agrobar-v0",
        "municipios_geo": len(geo),
        "municipios_cnpj": len(cnpj),
        "municipios_populacao_2026": len(estimated_population),
        "municipios_densidade_2022": len(census_density),
        "linhas_frota_municipais": len(fleet),
        "duplicatas_nome_uf_frota": fleet_duplicates,
        "sem_correspondencia_frota": missing_fleet,
        "frota_sem_correspondencia_geo": [{"uf": key[0], "municipio": value["municipio"]} for key, value in fleet.items() if key not in matched_keys],
        "divergencias_populacao_entre_planilha_e_geo": population_disagreements,
        "indices_calculados": sum(row["indice_agrobar_v0_0a100"] is not None for row in records),
        "faltantes": dict(Counter("agro" if row["agro_no_vab_pct_2021"] is None else "caminhonete" if row["caminhonetes_pct_veiculos_leves"] is None else "renda" for row in records if row["indice_agrobar_v0_0a100"] is None)),
        "top_20": [{key: row[key] for key in ("posicao_exploratoria", "municipio", "uf", "indice_agrobar_v0_0a100", "populacao_2026", "bares_por_10mil_hab", "agro_no_vab_pct_2021", "caminhonetes_pct_veiculos_leves")} for row in records[:20]],
    }
    (args.saida / "auditoria.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: audit[key] for key in ("municipios_geo", "municipios_populacao_2026", "municipios_densidade_2022", "linhas_frota_municipais", "indices_calculados", "faltantes", "sem_correspondencia_frota", "frota_sem_correspondencia_geo", "divergencias_populacao_entre_planilha_e_geo")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
