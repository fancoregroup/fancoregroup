#!/usr/bin/env python3
"""Aquisição oficial INEP/Cadastur/agenda. Reexecutável; bruto e derivados ignorados no Git.

Python 3.10+, pandas, openpyxl, beautifulsoup4; curl com TLS verificado pelo sistema.
Uso: python coletar.py [--stage download|derive|all] [--refresh]
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import fcntl
import hashlib
import io
import json
import re
import shutil
import subprocess
import unicodedata
import zipfile
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
DERIVED = ROOT / "derived"
MANIFEST = ROOT / "manifesto.json"
MAX_BYTES = 4_000_000_000
INEP_PAGE = "https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/censo-da-educacao-superior"
CKAN = "https://dados.turismo.gov.br/api/3/action/"
SLUGS = ["meios-de-hospedagem", "restaurantes-cafeterias-e-bares", "organizador-de-eventos"]
AGENDA = "https://www.turismo.gov.br/agenda-eventos/views/calendario.php"


def now():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).isoformat(timespec="seconds")


def normal(value):
    return "".join(c for c in unicodedata.normalize("NFKD", str(value)).lower() if not unicodedata.combining(c))


def save_json(path, value):
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def usage():
    return sum(p.stat().st_size for p in ROOT.rglob("*") if p.is_file())


def fetch(url, relative, reference, source=None, refresh=False, kind="dados", form=None):
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = path.with_name(path.name + ".http.json")
    transport = json.loads(meta.read_text()) if meta.exists() else {}
    checksum = digest(path) if path.exists() else None
    if not refresh and transport.get("sha256") and checksum != transport["sha256"]:
        raise ValueError(f"Bruto alterado desde o download: {relative}. Use --refresh para readquirir.")
    if refresh or not path.exists():
        if usage() > MAX_BYTES - 600_000_000:
            raise RuntimeError("Margem de disco da frente inferior a 600 MB; download interrompido")
        part = path.with_name(path.name + ".part")
        # curl/macOS usa trust store do sistema; nenhuma desativação da validação TLS.
        timeout = "1800" if path.suffix == ".zip" else "60"
        cmd = ["curl", "--fail", "--location", "--silent", "--show-error", "--retry", "2", "--retry-max-time", timeout,
               "--connect-timeout", "20", "--max-time", timeout, "--max-filesize", "650000000",
               "--output", str(part), "--write-out", "%{json}"]
        if form:
            for key, value in form.items():
                cmd.extend(["--data-urlencode", f"{key}={value}"])
        cmd.append(url)
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        transport = json.loads(result.stdout)
        if not part.stat().st_size:
            raise RuntimeError(f"Arquivo vazio: {url}")
        part.replace(path)
        transport["accessed_at"] = now()
        checksum = digest(path)
        transport["sha256"] = checksum
        save_json(meta, transport)
        print(f"Baixado {relative}: {path.stat().st_size:,} bytes", flush=True)
    if not transport.get("sha256") and checksum:
        transport["sha256"] = checksum
        save_json(meta, transport)
    return {"id": path.stem, "tipo": kind, "url": url, "fonte_url": source or url,
            "data_acesso": transport.get("accessed_at"), "referencia": reference,
            "raw_path": str(path.relative_to(ROOT)), "bytes": path.stat().st_size,
            "sha256": checksum, "url_final": transport.get("url_effective"),
            "validacao": {"http": transport.get("http_code"), "tls_verificado": True},
            "cobertura": None, "limites": [], "consulta_formulario": form}


def quarter(resource):
    n = normal(resource.get("name", ""))
    years = re.findall(r"20\d{2}", n)
    q = next((i for i, w in enumerate(["primeiro", "segundo", "terceiro", "quarto"], 1) if w in n), 0)
    return (int(years[-1]) if years else 0, q)


def collect_inep(year, refresh):
    url = f"https://download.inep.gov.br/microdados/microdados_censo_da_educacao_superior_{year}.zip"
    entry = fetch(url, f"raw/inep/censo_superior_{year}.zip", year, INEP_PAGE, refresh)
    entry["familia"] = "inep"
    with zipfile.ZipFile(ROOT / entry["raw_path"]) as z:
        bad = z.testzip()
        if bad:
            raise RuntimeError(f"CRC inválido: {bad}")
        entry["validacao"]["zip_crc"] = "ok"
        entry["validacao"]["membros"] = len(z.infolist())
        entry["inventario_zip"] = [{"nome": m.filename, "bytes": m.file_size} for m in z.infolist() if not m.is_dir()]
        hashes = z.read(next(n for n in z.namelist() if "md5_" in n)).decode()
        entry["validacao"]["md5_oficial"] = []
        for category in ["CURSOS", "IES"]:
            expected = next(line.split()[0] for line in hashes.splitlines() if f"_{category}_" in line)
            member = next(n for n in z.namelist() if n.upper().endswith(f"_{category}_{year}.CSV"))
            h = hashlib.md5()
            with z.open(member) as f:
                for b in iter(lambda: f.read(1024 * 1024), b""):
                    h.update(b)
            if expected != h.hexdigest():
                raise ValueError(f"MD5 oficial divergente: {member}")
            entry["validacao"]["md5_oficial"].append({"tipo": category, "md5": expected, "confere": True})
        docs = []
        for m in z.infolist():
            name = normal(m.filename)
            if not m.is_dir() and not Path(m.filename).name.startswith("~$") and not name.endswith("thumbs.db") and any(t in name for t in ["dicion", "leia", "filtro"]):
                p = RAW / "inep" / str(year) / "documentacao" / Path(m.filename).name
                p.parent.mkdir(parents=True, exist_ok=True)
                if not p.exists():
                    with z.open(m) as src, p.open("wb") as dst:
                        shutil.copyfileobj(src, dst)
                docs.append({"raw_path": str(p.relative_to(ROOT)), "bytes": p.stat().st_size, "sha256": digest(p), "membro_zip": m.filename})
        entry["dicionarios_documentacao"] = docs
    entry["limites"] = ["Matrículas não são pessoas únicas nem novos moradores.",
                         "Modalidade e município do curso/local de oferta devem permanecer distintos do município da sede da IES.",
                         "EaD não é público presencial; código ausente não será imputado como município ou zero."]
    return [entry]


def collect_cadastur(slug, refresh):
    meta = fetch(CKAN + "package_show?id=" + slug, f"raw/cadastur/{slug}-metadata.json", "metadados consultados", refresh=refresh, kind="metadados")
    package = json.loads((ROOT / meta["raw_path"]).read_text())["result"]
    resources = [r for r in package["resources"] if quarter(r)[0]]
    latest = max(resources, key=quarter)
    ext = Path(latest["url"].split("?")[0]).suffix
    entry = fetch(latest["url"], f"raw/cadastur/{slug}-{quarter(latest)[0]}-T{quarter(latest)[1]}{ext}", latest["name"],
                  "https://dados.turismo.gov.br/dataset/" + slug, refresh)
    entry.update({"familia": "cadastur", "categoria": slug, "resource_id": latest["id"],
                  "metadados_raw_path": meta["raw_path"], "catalogo_modificado": package.get("metadata_modified"),
                  "documentacao_oficial": package.get("notes"),
                  "dicionario_oficial": "Não há recurso de dicionário anexado a este conjunto CKAN; conferir também abas do arquivo."})
    entry["limites"] = ["Cadastro turístico não é censo de todos os estabelecimentos.", "Restaurantes/bares têm cadastro facultativo; ausência não é zero de oferta.",
                         "Organizadora cadastrada não comprova evento, público ou demanda.", "Capacidade cadastrada de hospedagem não é ocupação nem fluxo de turistas."]
    return [meta, entry]


def download(refresh=False):
    entries = [fetch(INEP_PAGE, "raw/inep/pagina-microdados.html", "consulta 2026-09-30", refresh=refresh, kind="documentacao")]
    tasks = [(collect_inep, y) for y in [2024, 2023, 2022]] + [(collect_cadastur, s) for s in SLUGS]
    errors = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(fn, arg, refresh): str(arg) for fn, arg in tasks}
        for fut in concurrent.futures.as_completed(futures):
            try:
                entries.extend(fut.result())
            except Exception as e:
                errors.append({"tarefa": futures[fut], "erro": str(e), "data": now()})
                print(f"Falha {futures[fut]}: {e}", flush=True)
    for url, rel, kind in [
        (AGENDA, "raw/eventos/calendario.html", "agenda_parcial"),
        ("https://www.turismo.gov.br/agenda-eventos/views/index.php", "raw/eventos/busca.html", "documentacao"),
        ("https://www.gov.br/empresas-e-negocios/pt-br/empreendedor/quero-ser-mei/cadastro-de-atividade-turistica-cadastur/perguntas-frequentes-sobre-o-cadastur", "raw/cadastur/definicoes-oficiais.html", "documentacao"),
        ("https://servicodados.ibge.gov.br/api/v1/localidades/municipios", "raw/referencia/municipios-ibge.json", "referencia_territorial"),
    ]:
        try:
            entries.append(fetch(url, rel, "retrato de 2026-09-30", refresh=refresh, kind=kind))
        except Exception as e:
            errors.append({"url": url, "erro": str(e), "data": now()})
    try:
        entries.append(fetch(AGENDA, "raw/eventos/calendario-2026.html", "consulta 01/01/2026 a 31/12/2026", refresh=refresh,
                             kind="agenda_parcial", form={"pesquisou": "1", "dataInicio": "01/01/2026", "dataFim": "31/12/2026"}))
    except Exception as e:
        errors.append({"url": AGENDA, "erro": str(e), "data": now()})
    result = {"schema_version": 1, "gerado_em": now(), "destino": "data-lake", "notion_id": "3e704662-7e83-8136-803f-c8938c4c1d5b",
              "status": "adquirido_com_pendencias" if errors else "adquirido", "limite_bytes_frente": MAX_BYTES,
              "fontes": entries, "falhas": errors, "derivados": []}
    save_json(MANIFEST, result)
    return result


def save_frame(frame, relative, manifest, sources, description):
    path = DERIVED / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    kwargs = {"compression": {"method": "gzip", "mtime": 0}} if relative.endswith(".gz") else {}
    frame.to_csv(path, index=False, encoding="utf-8", **kwargs)
    manifest["derivados"].append({"path": str(path.relative_to(ROOT)), "bytes": path.stat().st_size,
                                   "sha256": digest(path), "linhas": len(frame), "fontes": sources,
                                   "descricao": description, "ausente": "célula vazia; não equivale a zero"})


def derive_inep(entry, manifest):
    import pandas as pd
    year = entry["referencia"]
    cols = ["NU_ANO_CENSO", "CO_MUNICIPIO", "NO_MUNICIPIO", "SG_UF", "TP_DIMENSAO", "TP_MODALIDADE_ENSINO",
            "TP_NIVEL_ACADEMICO", "CO_IES", "CO_CURSO", "NO_CURSO", "CO_CINE_ROTULO", "NO_CINE_ROTULO",
            "CO_CINE_AREA_GERAL", "NO_CINE_AREA_GERAL", "QT_CURSO", "QT_MAT", "QT_ING", "QT_CONC", "QT_MAT_NOTURNO",
            "QT_MAT_18_24", "QT_MAT_25_29", "QT_MAT_30_34", "QT_MAT_35_39"]
    identifiers = [c for c in cols if c.startswith(("CO_", "NO_", "SG_"))]
    with zipfile.ZipFile(ROOT / entry["raw_path"]) as z:
        member = next(n for n in z.namelist() if f"CADASTRO_CURSOS_{year}.CSV" in n.upper())
        d = pd.read_csv(z.open(member), sep=";", encoding="latin1", usecols=cols, na_values=["."],
                        dtype={c: "string" for c in identifiers}, low_memory=False)
    for c in [v for v in cols if v.startswith(("QT_", "TP_", "NU_"))]:
        d[c] = pd.to_numeric(d[c], errors="raise").astype("Int64")
    assert d["NU_ANO_CENSO"].eq(year).all()
    assert d["TP_DIMENSAO"].isin([1, 2, 3, 4]).all()
    assert d.loc[d.TP_DIMENSAO.eq(1), "TP_MODALIDADE_ENSINO"].eq(1).all()
    assert d.loc[d.TP_DIMENSAO.isin([2, 3, 4]), "TP_MODALIDADE_ENSINO"].eq(2).all()
    assert d.QT_MAT.dropna().ge(0).all()
    source = [entry["raw_path"]]
    municipal = d[d.TP_DIMENSAO.isin([1, 2]) & d.CO_MUNICIPIO.str.fullmatch(r"\d{7}", na=False)].copy()
    outside = d[~d.index.isin(municipal.index)]
    unresolved = outside[outside.TP_DIMENSAO.isin([1, 2])]
    national = d.groupby(["NU_ANO_CENSO", "TP_DIMENSAO", "TP_MODALIDADE_ENSINO", "TP_NIVEL_ACADEMICO"], dropna=False).agg(
        registros=("QT_MAT", "size"), matriculas_observadas=("QT_MAT", lambda s: s.sum(min_count=1)),
        registros_matriculas_ausentes=("QT_MAT", lambda s: s.isna().sum())).reset_index()
    save_frame(national, f"inep/{year}-validacao-dimensoes.csv", manifest, source, "Totais por dimensão; dimensão 3 não é somada às linhas municipais.")
    save_frame(d, f"inep/{year}-curso-local-oferta.csv.gz", manifest, source, "Recorte de colunas da base oficial de cursos. Localidade não é campus e matrícula não é pessoa única.")
    save_frame(unresolved, f"inep/{year}-cursos-sem-municipio-valido.csv", manifest, source,
               "Cursos no Brasil cuja fonte não informa código municipal válido; matrículas preservadas, sem redistribuição ou zero artificial.")
    keys = ["NU_ANO_CENSO", "CO_MUNICIPIO", "NO_MUNICIPIO", "SG_UF", "TP_MODALIDADE_ENSINO", "TP_NIVEL_ACADEMICO"]

    def aggregate(frame):
        g = frame.groupby(keys, dropna=False)
        out = g.agg(registros_curso_localidade=("QT_MAT", "size"), ies_com_registro=("CO_IES", "nunique"),
                    matriculas_observadas=("QT_MAT", lambda s: s.sum(min_count=1)),
                    registros_matriculas_ausentes=("QT_MAT", lambda s: s.isna().sum()),
                    matriculas_noturno_observadas=("QT_MAT_NOTURNO", lambda s: s.sum(min_count=1)),
                    matriculas_18_24_observadas=("QT_MAT_18_24", lambda s: s.sum(min_count=1))).reset_index()
        out["matriculas"] = out.matriculas_observadas.mask(out.registros_matriculas_ausentes.gt(0))
        # O dicionário veda quantificar cursos EaD por município; não usar contagem de códigos como cursos oficiais.
        course = g.QT_CURSO.sum(min_count=1).reset_index(name="cursos_presenciais")
        out = out.merge(course, on=keys, validate="one_to_one")
        out["cursos_presenciais"] = out.cursos_presenciais.mask(out.TP_MODALIDADE_ENSINO.ne(1))
        return out

    agg = aggregate(municipal)
    assert int(agg.matriculas_observadas.sum()) == int(municipal.QT_MAT.sum())
    save_frame(agg, f"inep/{year}-municipio-modalidade.csv", manifest, source, "Matrículas do local de oferta, modalidades e níveis separados; sem inferir moradia/frequência presencial de EaD.")
    agro = municipal[pd.to_numeric(municipal.CO_CINE_AREA_GERAL, errors="coerce").eq(8)]
    agro_agg = aggregate(agro)
    save_frame(agro_agg, f"inep/{year}-municipio-area-cine08.csv", manifest, source, "Somente área CINE 08: Agricultura, silvicultura, pesca e veterinária; classificação oficial, não afinidade cultural Agrobar.")
    entry["cobertura"] = {"linhas_cursos": len(d), "municipios_presencial": int(municipal.loc[municipal.TP_MODALIDADE_ENSINO.eq(1), "CO_MUNICIPIO"].nunique()),
                          "municipios_ead": int(municipal.loc[municipal.TP_MODALIDADE_ENSINO.eq(2), "CO_MUNICIPIO"].nunique()),
                          "municipios_matriculas_presenciais_positivas": int(municipal.loc[municipal.TP_MODALIDADE_ENSINO.eq(1) & municipal.QT_MAT.gt(0), "CO_MUNICIPIO"].nunique()),
                          "municipios_matriculas_ead_positivas": int(municipal.loc[municipal.TP_MODALIDADE_ENSINO.eq(2) & municipal.QT_MAT.gt(0), "CO_MUNICIPIO"].nunique()),
                          "municipios_cine08": int(agro.CO_MUNICIPIO.nunique()), "linhas_fora_agregacao_municipal": len(outside)}
    entry["validacao"].update({"matriculas_municipais_somadas": int(agg.matriculas_observadas.sum()),
                              "matriculas_municipais_ausentes": int(municipal.QT_MAT.isna().sum()),
                              "dimensoes_excluidas": [3, 4], "municipios_codigo_invalido_dimensao_1_2": int((d.TP_DIMENSAO.isin([1, 2]) & ~d.index.isin(municipal.index)).sum()),
                              "matriculas_sem_municipio_valido_dimensao_1_2": int(unresolved.QT_MAT.sum()),
                              "curso_municipio_nivel_modalidade_duplicados": int(municipal.duplicated(["CO_CURSO", "CO_MUNICIPIO", "TP_NIVEL_ACADEMICO", "TP_MODALIDADE_ENSINO"]).sum())})
    entry["limites"].append("CINE 08 inclui veterinária e outras áreas; não é perfil cultural nem validação de ICP. Curso/localidade não identifica campus ou presença física de cada estudante.")
    print(f"INEP {year}: {len(d):,} linhas, {entry['cobertura']['municipios_presencial']} municípios presenciais", flush=True)
    return agg


def territorial_index():
    items = json.loads((RAW / "referencia/municipios-ibge.json").read_text())
    result = {}
    for m in items:
        micro = m.get("microrregiao")
        uf = micro["mesorregiao"]["UF"]["sigla"] if micro else m["regiao-imediata"]["regiao-intermediaria"]["UF"]["sigla"]
        key = uf, re.sub(r"[^a-z0-9]", "", normal(m["nome"]))
        if key in result:
            raise ValueError("Colisão no nome normalizado de município/UF")
        result[key] = str(m["id"])
    return result


def municipal_code(name, uf, index):
    return index.get((str(uf), re.sub(r"[^a-z0-9]", "", normal(name))))


def derive_cadastur(entry, manifest, index):
    import pandas as pd
    path = ROOT / entry["raw_path"]
    xls = pd.ExcelFile(path)
    d = pd.read_excel(xls, dtype="string")
    schema = {"origem": entry["raw_path"], "tipo": "Dicionário estrutural derivado; não é dicionário oficial do MTur",
              "dicionario_oficial": "Não localizado nos recursos CKAN nem nas abas da planilha; definições oficiais preservadas em raw/cadastur/definicoes-oficiais.html.",
              "abas": xls.sheet_names, "campos": [{"nome_original": c, "tipo_leitura": "texto", "preenchidos": int(d[c].notna().sum()), "ausentes": int(d[c].isna().sum())} for c in d.columns]}
    schema_path = DERIVED / f"cadastur/{entry['categoria']}-dicionario-estrutural.json"
    schema_path.parent.mkdir(parents=True, exist_ok=True)
    schema_path.write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n")
    manifest["derivados"].append({"path": str(schema_path.relative_to(ROOT)), "bytes": schema_path.stat().st_size, "sha256": digest(schema_path), "fontes": [entry["raw_path"]], "descricao": schema["tipo"]})
    # Derivados municipais não contêm CPF, nomes de responsáveis, e-mails ou telefones presentes no bruto oficial.
    d["codigo_ibge"] = [municipal_code(n, u, index) for n, u in zip(d["Município"], d.UF)]
    cnpj = "Número de Inscrição do CNPJ"
    duplicates = int(d[cnpj].duplicated().sum())
    if duplicates:
        raise ValueError(f"CNPJ duplicado exige revisão, sem deduplicação arbitrária: {entry['categoria']}")
    keys = ["codigo_ibge", "UF", "Município", "Situação Cadastral", "Situação da Atividade"]
    agg = d.groupby(keys, dropna=False).size().reset_index(name="estabelecimentos_cadastrados")
    if "Leitos" in d:
        for original, renamed in [("Leitos", "leitos"), ("Unidade Habitacionais", "unidades_habitacionais")]:
            values = pd.to_numeric(d[original].str.replace(",", ".", regex=False), errors="coerce")
            d[renamed] = values
            g = d.groupby(keys, dropna=False)[renamed]
            a = g.agg(**{renamed + "_observados": lambda s: s.sum(min_count=1), renamed + "_ausentes": lambda s: s.isna().sum()}).reset_index()
            agg = agg.merge(a, on=keys, validate="one_to_one")
    agg.insert(0, "referencia", entry["referencia"])
    agg.insert(1, "categoria", entry["categoria"])
    assert int(agg.estabelecimentos_cadastrados.sum()) == len(d)
    save_frame(agg, f"cadastur/{entry['categoria']}-municipios.csv", manifest, [entry["raw_path"], "raw/referencia/municipios-ibge.json"],
               "Quantidade cadastrada por município e situação; campos UF/Município da fonte, sem geocodificar endereço comercial.")
    unresolved = agg[agg.codigo_ibge.isna()]
    save_frame(unresolved, f"cadastur/{entry['categoria']}-municipios-nao-conciliados.csv", manifest, [entry["raw_path"]], "Nomes não conciliados automaticamente. Preservar, não inventar código ou zero.")
    entry["cobertura"] = {"registros": len(d), "ufs": int(d.UF.nunique()), "municipios_nome_uf": int(d[["UF", "Município"]].drop_duplicates().shape[0]),
                          "municipios_ibge_conciliados": int(d.codigo_ibge.nunique()), "registros_sem_codigo_ibge": int(d.codigo_ibge.isna().sum())}
    entry["validacao"].update({"cnpj_duplicado": duplicates, "abas": xls.sheet_names, "soma_agregados": int(agg.estabelecimentos_cadastrados.sum()),
                              "status_separados": True, "contatos_excluidos_derivados": True})
    entry["dicionario_oficial"] = schema["dicionario_oficial"]
    entry["limites"].append("UF/Município cadastral pode divergir do endereço comercial; nenhuma localização foi corrigida por inferência.")


def derive_events(manifest, index):
    import pandas as pd
    from bs4 import BeautifulSoup
    entry = next(e for e in manifest["fontes"] if e["raw_path"] == "raw/eventos/calendario-2026.html")
    raw = (ROOT / entry["raw_path"]).read_bytes()
    decoded = raw.decode("utf-8", errors="replace")
    soup = BeautifulSoup(decoded, "html.parser")
    rows = []
    months = {v: i for i, v in enumerate(["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"], 1)}
    terms = ["agro", "pecu", "rodeio", "sertanej", "cavalgada", "rural", "boiadeir", "country"]
    def parse_date(day, month, year):
        try:
            return dt.date(int(year), months[normal(month)], int(day)).isoformat()
        except (ValueError, KeyError, TypeError):
            return None
    for card in soup.select("[data-href]"):
        title = card.select_one(".nome")
        if not title:
            continue
        event_id = card["data-href"]
        text = title.get_text(" ", strip=True)
        location = card.select_one(".localizacao").get_text(" ", strip=True)
        city, _, uf = location.rpartition("/")
        heading = card.find_previous("h3")
        year = heading.get_text(strip=True) if heading else None
        start = parse_date(card.select_one(".dia").get_text(strip=True), card.select_one(".mes").get_text(strip=True), year)
        ending = card.select_one(".final").get_text(" ", strip=True)
        parts = ending.split()
        # A página usa ano com dois dígitos; códigos fora de 2025–2027 são ambíguos nesta consulta de 2026.
        end = parse_date(parts[0], parts[1], "20" + parts[2]) if len(parts) == 3 and parts[2] in ["25", "26", "27"] else None
        hits = [t for t in terms if t in normal(text)]
        rows.append({"id_evento": event_id, "nome_publicado": text, "municipio": city, "uf": uf,
                     "codigo_ibge": municipal_code(city, uf, index), "data_inicio": start, "data_fim": end,
                     "ano_cabecalho": year, "fim_texto_original": ending, "status_publicado": card.select_one(".status").get_text(" ", strip=True),
                     "data_requer_revisao": not start or not end or end < start or (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days > 370,
                     "candidato_lexical_agro_sertanejo": bool(hits), "termos_encontrados": "|".join(hits),
                     "url_detalhe": urljoin(AGENDA, "detalhe.php?id=" + event_id)})
    d = pd.DataFrame(rows)
    found = re.search(r"Foram encontrados\s+(\d+)\s+eventos", soup.get_text(" ", strip=True))
    assert found and int(found.group(1)) == len(d), "Quantidade extraída difere do total publicado"
    assert not d.id_evento.duplicated().any(), "IDs duplicados precisam de revisão"
    save_frame(d, "eventos/calendario-2026.csv", manifest, [entry["raw_path"]], "Retrato colaborativo da consulta anual oficial; datas inconsistentes sinalizadas sem correção inferida.")
    candidates = d[d.candidato_lexical_agro_sertanejo].copy()
    details = []
    def get_detail(row):
        return row, fetch(row["url_detalhe"], f"raw/eventos/detalhes/{row['id_evento']}.html", "evento candidato por termo no título", kind="detalhe_evento_parcial")
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(get_detail, row): row for row in candidates.to_dict("records")}
        for fut in concurrent.futures.as_completed(futures):
            try:
                row, detail = fut.result()
                manifest["fontes"].append(detail)
                s = BeautifulSoup((ROOT / detail["raw_path"]).read_bytes().decode("utf-8", errors="replace"), "html.parser")
                labels = [p.get_text(" ", strip=True) for p in s.find_all("p")]
                row["descricao_publicada"] = next((t for t in labels if ":" not in t[:35] and len(t) > 60), None)
                for label, col in [("Tipo:", "tipo_publicado"), ("Forma de Realização:", "forma_realizacao"), ("Tipo de Acesso:", "tipo_acesso")]:
                    row[col] = next((t[len(label):].strip() for t in labels if t.startswith(label)), None)
                row["raw_detalhe"] = detail["raw_path"]
                details.append(row)
            except Exception as e:
                manifest["falhas"].append({"tarefa": "detalhe_evento", "id_evento": futures[fut]["id_evento"], "url": futures[fut]["url_detalhe"], "erro": str(e), "data": now()})
    by_id = {row["id_evento"]: row for row in details}
    combined = [by_id.get(row["id_evento"], row) for row in candidates.to_dict("records")]
    save_frame(pd.DataFrame(combined).sort_values("id_evento"), "eventos/candidatos-agro-sertanejo.csv", manifest,
               [entry["raw_path"]], "Filtro lexical explícito de títulos; não comprova gênero musical, realização, público, calendário completo ou pertinência comercial.")
    entry["cobertura"] = {"eventos_retornados": len(d), "candidatos_lexicais": len(candidates), "detalhes_baixados": len(details),
                          "municipios_conciliados": int(d.codigo_ibge.nunique()), "eventos_com_datas_a_revisar": int(d.data_requer_revisao.sum())}
    entry["validacao"].update({"total_publicado": int(found.group(1)), "ids_unicos": True, "caracteres_substituidos_utf8": decoded.count("\ufffd")})
    entry["limites"] = ["Cadastro nacional colaborativo, cobertura parcial e desigual; ausência não é inexistência de evento.",
                         "Filtro anual por sobreposição pode incluir eventos iniciados em outros anos e datas incorretas informadas pelo cadastro.",
                         "Ano final de dois dígitos só é normalizado quando 25/26/27; outros códigos ficam ausentes com texto original preservado. Datas inconsistentes são sinalizadas sem confirmar realização.",
                         "Descrições e estimativas de público são declarações da fonte.",
                         "Filtro lexical não identifica todos os eventos agro/sertanejos nem prova pertinência temática."]
    for detail in manifest["fontes"]:
        if detail["tipo"] == "detalhe_evento_parcial":
            detail["cobertura"] = {"eventos": 1, "id_evento": Path(detail["raw_path"]).stem}
            detail["limites"] = ["Descrição declarada ao cadastro colaborativo. Não confirma realização nem público; classificação lexical é apenas triagem."]


def derive(manifest):
    import pandas as pd
    manifest["derivados"] = []
    # Mantém os mesmos registros em uma reexecução, sem duplicar detalhes no manifesto.
    manifest["fontes"] = [e for e in manifest["fontes"] if e["tipo"] != "detalhe_evento_parcial"]
    annual = []
    for entry in manifest["fontes"]:
        if entry.get("familia") == "inep":
            annual.append(derive_inep(entry, manifest))
    if annual:
        all_years = pd.concat(annual, ignore_index=True).sort_values(
            ["NU_ANO_CENSO", "CO_MUNICIPIO", "TP_MODALIDADE_ENSINO", "TP_NIVEL_ACADEMICO"])
        save_frame(all_years, "inep/evolucao-municipio-modalidade-2022-2024.csv", manifest,
                   [e["raw_path"] for e in manifest["fontes"] if e.get("familia") == "inep"],
                   "Série longa de observações municipais, sem completar anos ausentes com zero ou calcular crescimento sobre ausência.")
    index = territorial_index()
    for entry in manifest["fontes"]:
        if entry.get("familia") == "cadastur":
            derive_cadastur(entry, manifest, index)
    derive_events(manifest, index)
    manifest["status"] = "validado_com_limites" if not manifest["falhas"] else "parcial_com_falhas"
    manifest["pendencias"] = ["Dicionário oficial específico das três planilhas Cadastur não localizado; metadados, cabeçalhos e definições oficiais preservados; dicionário estrutural derivado identificado como tal.",
                              "Dados adquiridos para pesquisa, sem alteração de UI, fórmula, pesos ou score Agrobar."]
    for entry in manifest["fontes"]:
        if entry["cobertura"] is None:
            entry["cobertura"] = {"tipo": entry["tipo"], "descricao": "Documento auxiliar ou retrato da fonte, sem alegação de cobertura populacional."}
        if not entry["limites"]:
            entry["limites"] = ["Material documental da fonte, sem inferência de mercado ou aprovação de uso no índice."]
    return manifest


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--stage", choices=["download", "derive", "all"], default="all")
    p.add_argument("--refresh", action="store_true", help="Baixar novamente as fontes; sem esta opção, reutiliza brutos íntegros")
    args = p.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    DERIVED.mkdir(parents=True, exist_ok=True)
    manifest = download(args.refresh) if args.stage in ["download", "all"] else json.loads(MANIFEST.read_text())
    if args.stage in ["derive", "all"]:
        manifest = derive(manifest)
        manifest["gerado_em"] = now()
        manifest["bytes_frente"] = usage()
        save_json(MANIFEST, manifest)
    print(json.dumps({"fontes": len(manifest["fontes"]), "falhas": len(manifest["falhas"]), "bytes_frente": usage()}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    (ROOT / ".cache").mkdir(exist_ok=True)
    with (ROOT / ".cache/coleta.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        main()
