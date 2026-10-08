#!/usr/bin/env python3
"""Publica somente agregados municipais preparados, sem reextrair microdados.

Executar com pandas e pyarrow. Não altera municipios.json nem calcula notas.
Ausência de chave é ausência de observação, equivalente a value:null no consumidor.
Zeros publicados são preservados. Prova de origem e validação fica fora do site.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

BASE = Path(__file__).resolve().parent
REPO = BASE.parents[3]
SITE = REPO / "05-dashboard/demo/site/inteligencia-geografica/dados"
OUTPUT = SITE / "expansion-data.json"
PROOF = BASE / "integracao-plataforma-validacao.json"
MTE = "https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/acoes-e-programas/programas-projetos-acoes-obras-e-atividades/estatisticas-trabalho/"
INEP = "https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/censo-da-educacao-superior"
EVENTS = "https://www.turismo.gov.br/agenda-eventos/views/calendario.php"
RAIS = MTE + "rais/rais-2025"
CAGED = MTE + "novo-caged/2026/agosto/pagina-inicial"


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


class Integration:
    def __init__(self):
        base = json.loads((SITE / "municipios.json").read_text())
        self.ids = {str(c["id"]) for c in base["cities"]}
        self.cities = {key: {} for key in sorted(self.ids)}
        self.indicators, self.sources, self.inputs, self.checks = {}, [], {}, []
        self.excluded = {}

    def path(self, name):
        path = BASE / name
        if name not in self.inputs:
            self.inputs[name] = {"bytes": path.stat().st_size, "sha256": digest(path)}
        return path

    def csv(self, name, **kwargs):
        return pd.read_csv(self.path(name), dtype=str, **kwargs)

    def parquet(self, name):
        return pd.read_parquet(self.path(name))

    def check(self, label, valid, detail=None):
        self.checks.append({"check": label, "ok": bool(valid), "detail": detail})
        if not valid:
            raise AssertionError(label + ": " + str(detail))

    def metric(self, key, label, unit, years, source, note, dimension, aggregation="sum", **extra):
        assert key.startswith("exp_") and key not in self.indicators
        self.indicators[key] = dict(label=label, unit=unit, years=years, source=source,
                                    note=note, dimension=dimension, aggregation=aggregation, **extra)

    def put(self, key, values, year):
        for code, value in values.items():
            code = str(code)
            if code not in self.ids:
                self.excluded.setdefault(key, set()).add(code)
                continue
            n = None if pd.isna(value) else float(value)
            if n is not None:
                if not math.isfinite(n):
                    n = None
                else:
                    n = round(n, 2)
                    if n == int(n):
                        n = int(n)
            assert key not in self.cities[code], (code, key)
            self.cities[code][key] = {"value": n, "year": year}

    def source(self, id, label, reference, url, note, status="integrated", coverage=None):
        self.sources.append(dict(id=id, label=label, reference=reference, status=status,
                                 note=note, url=url, coverage=coverage))

    def sidra(self, table, variables, years, category=None):
        """Read only compact derived rows; PAM is streamed and filtered in chunks."""
        result = []
        for chunk in self.csv(f"ibge/derived/{table}-municipios.csv.gz", chunksize=100_000):
            chunk = chunk[chunk.variavel_id.isin(variables) & chunk.periodo.isin(years)].copy()
            if chunk.empty:
                continue
            chunk["category"] = chunk.categorias_json.map(
                lambda text: next(iter(json.loads(text)[category])) if category else "total")
            chunk["valor"] = pd.to_numeric(chunk.valor, errors="coerce")
            result.append(chunk[["municipio_id", "periodo", "variavel_id", "category", "valor"]])
        return pd.concat(result, ignore_index=True)

    def evolution(self, key, data, first, last, id="municipio_id", year="periodo", value="valor"):
        pivot = data.pivot(index=id, columns=year, values=value)
        valid = pivot[first].notna() & pivot[last].notna() & (pivot[first] > 0)
        change = ((pivot[last] / pivot[first] - 1) * 100).where(valid)
        self.put(key, change, f"{first} a {last}")

    def census(self):
        src = "https://sidra.ibge.gov.br/tabela/10296"
        note = ("Censo 2022, amostra preliminar. Moradores de domicílios particulares permanentes ocupados, "
                "excluídos pensionistas, empregados domésticos e seus parentes. Salário mínimo de R$ 1.212. "
                "Classes têm arredondamentos independentes; não usar população total como denominador.")
        d = self.sidra("10296", ["13604"], ["2022"], "386")
        meta = json.load(gzip.open(self.path("ibge/raw/api/10296/metadata.json.gz"), "rt"))
        cats = next(c["categorias"] for c in meta["classificacoes"] if c["id"] == 386)
        for index, c in enumerate(cats):
            key = f"exp_r{index}"
            label = "Universo da distribuição de renda" if index == 0 else "Renda: " + c["nome"].lower()
            self.metric(key, label, "pessoas", [2022], src, note, "Renda e consumo")
            rows = d[d.category == str(c["id"])]
            self.put(key, rows.set_index("municipio_id").valor, 2022)
        self.source("income", "IBGE: distribuição de renda", "2022", src, note, coverage="5.570 municípios; 11 classes e universo próprio.")
        d = self.sidra("9923", ["93"], ["2022"], "1")
        pop = d[d.category == "6795"].set_index("municipio_id").valor
        for cat, key, label in [("1", "exp_urb", "População urbana"), ("2", "exp_rur", "População rural")]:
            self.metric(key, label, "pessoas", [2022], "https://sidra.ibge.gov.br/tabela/9923",
                        "Situação do domicílio no Censo 2022. Não cruzar com renda e idade como se a distribuição conjunta fosse conhecida.", "População e território")
            self.put(key, d[d.category == cat].set_index("municipio_id").valor, 2022)
        urban = d[d.category == "1"].set_index("municipio_id").valor
        rural = d[d.category == "2"].set_index("municipio_id").valor
        self.check("Urbana + rural igual à população censitária", (urban + rural).equals(pop))
        ages = self.sidra("9514", ["93"], ["2022"], "287")
        age_rows = ages[ages.category != "100362"]
        adult = age_rows.groupby("municipio_id").valor.agg(lambda v: v.sum(min_count=83))
        self.check("83 idades simples para o recorte 18+", age_rows.groupby("municipio_id").size().eq(83).all())
        self.check("Adultos não excedem população", adult.le(pop).all())
        self.metric("exp_ad18", "Adultos com 18 anos ou mais", "pessoas", [2022], "https://sidra.ibge.gov.br/tabela/9514",
                    "Soma das idades simples de 18 a 99 e 100+. Valor municipal exato; setores censitários não separam 18 e 19 anos.", "População e território")
        self.put("exp_ad18", adult, 2022)
        self.source("population", "IBGE: urbano/rural e adultos", "2022", "https://sidra.ibge.gov.br/tabela/9923",
                    "População residente. Adultos calculados pela tabela 9514, com 83 categorias sem sobreposição.", coverage="5.570 municípios do Censo 2022.")
        self.source("income-age", "IBGE: renda por grupos de idade", "2022", "https://sidra.ibge.gov.br/tabela/10295",
                    "Contagens, médias e medianas adquiridas. Grupos sobrepostos não podem ser somados. Detalhamento permanece local nesta versão compacta.", "prepared_local", "5.570 municípios.")

    def education(self):
        note = ("INEP, graduação no município do local de oferta. Matrículas são vínculos, não pessoas únicas; "
                "não adicionar à população. EaD separado de presencial. Ausência de linha não virou zero.")
        d = self.csv("educacao-turismo/derived/inep/2024-municipio-modalidade.csv")
        d = d[d.TP_NIVEL_ACADEMICO == "1"]
        for key, mod, col, label in [
            ("exp_pres", "1", "matriculas", "Matrículas na graduação presencial"),
            ("exp_ead", "2", "matriculas", "Matrículas na graduação EaD"),
            ("exp_not", "1", "matriculas_noturno_observadas", "Matrículas presenciais no período noturno"),
        ]:
            self.metric(key, label, "matrículas", [2024], INEP, note, "Universidades e público")
            self.put(key, pd.to_numeric(d[d.TP_MODALIDADE_ENSINO == mod].set_index("CO_MUNICIPIO")[col], errors="coerce"), 2024)
        agro = self.csv("educacao-turismo/derived/inep/2024-municipio-area-cine08.csv")
        agro = agro[(agro.TP_NIVEL_ACADEMICO == "1") & (agro.TP_MODALIDADE_ENSINO == "1")]
        for key, col, unit, label in [
            ("exp_agmat", "matriculas", "matrículas", "Matrículas presenciais em agricultura e veterinária"),
            ("exp_agc", "cursos_presenciais", "cursos", "Cursos presenciais em agricultura e veterinária"),
        ]:
            self.metric(key, label, unit, [2024], INEP, note + " Área oficial CINE 08: Agricultura, silvicultura, pesca e veterinária. Cursos não são campi; não define afinidade cultural.", "Universidades e público")
            self.put(key, pd.to_numeric(agro.set_index("CO_MUNICIPIO")[col], errors="coerce"), 2024)
        series = self.csv("educacao-turismo/derived/inep/evolucao-municipio-modalidade-2022-2024.csv")
        series = series[(series.TP_NIVEL_ACADEMICO == "1") & (series.TP_MODALIDADE_ENSINO == "1")].copy()
        series["matriculas"] = pd.to_numeric(series.matriculas, errors="coerce")
        self.metric("exp_eduvar", "Evolução das matrículas presenciais", "%", ["2022 a 2024"], INEP,
                    note + " Variação percentual de 2022 a 2024; exige as duas observações e base 2022 positiva. Agregado territorial é média das variações municipais.", "Universidades e público", "mean")
        self.evolution("exp_eduvar", series, "2022", "2024", "CO_MUNICIPIO", "NU_ANO_CENSO", "matriculas")
        self.source("inep", "INEP: Censo da Educação Superior", "2022 a 2024", INEP, note,
                    coverage="2024: 1.121 municípios com linhas presenciais; 1.116 com matrículas positivas. EaD positivo em 3.387 municípios.41 matrículas sem município válido não distribuídas.")

    def tourism(self):
        for family, key, label in [("meios-de-hospedagem", "exp_hosp", "Hospedagens cadastradas em operação"),
                                    ("restaurantes-cafeterias-e-bares", "exp_bares", "Bares e restaurantes no Cadastur em operação"),
                                    ("organizador-de-eventos", "exp_org", "Organizadoras de eventos cadastradas em operação")]:
            url = "https://dados.turismo.gov.br/dataset/" + family
            d = self.csv(f"educacao-turismo/derived/cadastur/{family}-municipios.csv")
            rows = d[(d["Situação Cadastral"] == "Regular") & (d["Situação da Atividade"] == "Operação")].copy()
            note = ("Cadastur, 2º trimestre de 2026. Somente cadastro Regular e atividade Operação; implantação excluída. "
                    "Cobertura cadastral parcial; cidade sem registro é sem observação, não zero estabelecimentos. Categorias não são empresas únicas entre si.")
            self.metric(key, label, "estabelecimentos", ["2026-T2"], url, note, "Turismo e eventos")
            counts = pd.to_numeric(rows.estabelecimentos_cadastrados).groupby(rows.codigo_ibge).sum(min_count=1)
            self.put(key, counts, "2026-T2")
            if family == "meios-de-hospedagem":
                beds = pd.to_numeric(rows.leitos_observados).groupby(rows.codigo_ibge).sum(min_count=1)
                missing = pd.to_numeric(rows.leitos_ausentes).groupby(rows.codigo_ibge).sum()
                beds = beds.where(missing.eq(0))
                self.metric("exp_leitos", "Leitos cadastrados em hospedagens em operação", "leitos", ["2026-T2"], url,
                            note + " Capacidade cadastrada, não ocupação ou visitantes. Cidades com campos de leitos ausentes ficam sem valor integral.", "Turismo e eventos")
                self.put("exp_leitos", beds, "2026-T2")
            self.source("cadastur-" + family, "Cadastur: " + family.replace("-", " "), "2º trimestre de 2026", url, note,
                        coverage=f"{len(counts)} municípios com registros regulares em operação conciliados. Não conciliados permanecem locais.")
        d = self.csv("educacao-turismo/derived/eventos/candidatos-agro-sertanejo.csv", usecols=["id_evento", "codigo_ibge", "data_requer_revisao"])
        self.check("Candidatos a eventos sem IDs duplicados", not d.id_evento.duplicated().any())
        self.metric("exp_event", "Eventos candidatos agro/sertanejo no calendário", "registros", [2026], EVENTS,
                    "Triagem textual de títulos na consulta anual de 2026 do calendário colaborativo. Contexto em revisão, não eventos confirmados nem público. Datas podem ser inconsistentes. Não há zeros inferidos; ausência é sem informação.",
                    "Turismo e eventos", publicationStatus="review")
        self.put("exp_event", d.groupby("codigo_ibge").id_evento.nunique(), 2026)
        self.source("events", "MTur: candidatos agro/sertanejo", "Consulta anual de 2026 em 30/09/2026", EVENTS,
                    "Termos agro, pecu, rodeio, sertanej, cavalgada, rural, boiadeir, country. Triagem não validada, cobertura colaborativa parcial. Inclui candidatos com datas a revisar; não demonstra realização.",
                    "review", f"{len(d)} candidatos publicados; somente códigos conciliados entram nos agregados.")

    def agriculture(self):
        pam = self.sidra("5457", ["215", "216"], ["2021", "2025"], "782")
        src = "https://sidra.ibge.gov.br/tabela/5457"
        note = "PAM 2025. Valor nominal de produção não é VAB, renda domiciliar nem poder de compra. Total oficial, sem somar categorias hierárquicas."
        for key, var, factor, unit, label in [("exp_pam", "215", 1000, "R$", "Valor da produção agrícola"), ("exp_pamha", "216", 1, "ha", "Área colhida das lavouras")]:
            self.metric(key, label, unit, [2025], src, note + " Área colhida não equivale à área territorial única por poder haver cultivos sucessivos.", "Agropecuária")
            rows = pam[(pam.category == "0") & (pam.periodo == "2025") & (pam.variavel_id == var)]
            self.put(key, rows.set_index("municipio_id").valor * factor, 2025)
        self.metric("exp_sojavar", "Evolução do valor da produção de soja", "%", ["2021 a 2025"], src,
                    "Variação nominal do mesmo produto (soja em grão)2021 a 2025, não desconta inflação. Base positiva e dois anos observados; não usa total afetado por ampliação de produtos. Agregado territorial é média das variações municipais.", "Agropecuária", "mean")
        self.evolution("exp_sojavar", pam[(pam.category == "40124") & (pam.variavel_id == "215")], "2021", "2025")
        self.source("pam", "IBGE: Produção Agrícola Municipal", "2021 a 2025", src, note + " Produtos, quantidades e rendimentos completos permanecem locais; quantidades têm unidades específicas.", coverage="Municípios publicados pela fonte; células suprimidas ou não aplicáveis preservadas.")
        ppm = self.sidra("3939", ["105"], ["2020", "2024"], "79")
        cattle = ppm[ppm.category == "2670"]
        src = "https://sidra.ibge.gov.br/tabela/3939"
        self.metric("exp_bov", "Efetivo de bovinos", "cabeças", [2024], src, "PPM 2024. Estoque de animais, não produção anual ou renda. Outras espécies e subgrupos disponíveis localmente.", "Agropecuária")
        self.put("exp_bov", cattle[cattle.periodo == "2024"].set_index("municipio_id").valor, 2024)
        self.metric("exp_bovvar", "Evolução do rebanho bovino", "%", ["2020 a 2024"], src, "Variação do mesmo rebanho2020 a 2024; base positiva e ambas as observações. Agregado territorial é média das variações municipais.", "Agropecuária", "mean")
        self.evolution("exp_bovvar", cattle, "2020", "2024")
        product = self.sidra("74", ["215"], ["2024"], "80")
        self.metric("exp_ppm", "Valor da produção de origem animal", "R$", [2024], "https://sidra.ibge.gov.br/tabela/74",
                    "PPM 2024: total oficial de leite, ovos, mel, casulos e lã. Mil reais convertidos em reais nominais. Não é valor do rebanho, VAB nem receita de abate.", "Agropecuária")
        self.put("exp_ppm", product[product.category == "0"].set_index("municipio_id").valor * 1000, 2024)
        self.source("ppm", "IBGE: Pesquisa da Pecuária Municipal", "2020 a 2024", src, "Rebanhos e produtos de origem animal. Estoques separados de valor de produção; não somar matrizes/galinhas aos totais das espécies.", coverage="Séries municipais nacionais, observações válidas conforme cobertura de cada variável.")

    def employment(self):
        tab = self.parquet("trabalho/derived/rais-vinculos-municipio-setor-2023-2025.parquet")
        note = ("RAIS, estoque formal em 31/12/2025 na tabela municipal oficial. Vínculos não são pessoas únicas; município do estabelecimento. "
                "A soma municipal publicada difere 99.312 do total nacional dos microdados tratados, em BH/Rio/SP/Brasília; preservar universo.")
        for sector, key, label in [("Total", "exp_rais", "Vínculos formais RAIS"), ("Agropecuária", "exp_ra", "Vínculos formais na agropecuária"),
                                   ("Indústria", "exp_ri", "Vínculos formais na indústria"), ("Construção", "exp_rc", "Vínculos formais na construção"),
                                   ("Comércio", "exp_rt", "Vínculos formais no comércio"), ("Serviços", "exp_rs", "Vínculos formais nos serviços")]:
            self.metric(key, label, "vínculos", [2025], RAIS, note, "Trabalho e renda formal")
            rows = tab[(tab.ano == 2025) & (tab.setor == sector)]
            self.put(key, rows.set_index("municipio_ibge").vinculos_31_dezembro, 2025)
        self.metric("exp_rv", "Evolução do emprego formal RAIS", "%", ["2023 a 2025"], RAIS,
                    note + " Variação2023 a 2025 na mesma edição da tabela municipal; base positiva. Agregado territorial é média das variações municipais.", "Trabalho e renda formal", "mean")
        totals = tab[(tab.setor == "Total") & tab.municipio_ibge.notna()]
        self.evolution("exp_rv", totals, 2023, 2025, "municipio_ibge", "ano", "vinculos_31_dezembro")
        micro_path = "trabalho/derived/rais-2025-remuneracao-municipio-setor.parquet"
        validation = json.loads(self.path("trabalho/derived/validacao-rais-microdados.json").read_text())
        self.check("RAIS método corrigido e sete partes completas", validation["method_version"] == 4 and validation["complete_brazil"] and validation["parts_processed"] == 7)
        self.check("RAIS derivado corresponde à prova v4", validation["sha256"] == digest(self.path(micro_path)))
        micro = self.parquet(micro_path)
        micro = micro[(micro.setor == "total") & micro.municipio_ibge.notna()].set_index("municipio_ibge")
        review = ("Em revisão. Microdados RAIS 2025: ativos em 31/12 e não abandonados, nota técnica seção 16, p. 9. Município do estabelecimento; "
                  "dezembro nominal, sem multiplicar por 12. Divergência residual municipal: BH −21.351, Rio +44.345, SP +33.968, Brasília +42.350 vínculos. "
                  "Limite distinto: 493 entes sem remuneração (353 municipais), 116.622 vínculos públicos afetados; remuneração militar também ausente. "
                  "Soma observada e média dos campos informados não são renda domiciliar nem massa salarial integral.")
        for key, col, label, unit, agg in [
            ("exp_rm", "remuneracao_dezembro_soma_nominal", "Remuneração formal observada em dezembro", "R$", "sum"),
            ("exp_rw", "remuneracao_dezembro_media_informados", "Remuneração média dos vínculos informados", "R$/mês", "mean"),
            ("exp_rn", "remuneracao_dezembro_informada_n", "Vínculos com remuneração informada", "vínculos", "sum"),
            ("exp_rmiss", "remuneracao_dezembro_ausente_n", "Vínculos sem remuneração informada", "vínculos", "sum"),
        ]:
            self.metric(key, label, unit, [2025], RAIS, review, "Trabalho e renda formal", agg, publicationStatus="review")
            self.put(key, micro[col], 2025)
        self.source("rais", "MTE: RAIS estoque e setores", "2023 a 2025", RAIS, note, coverage="5.571 municípios; código não identificado 999999 excluído da interface.")
        self.source("rais-payroll", "MTE: RAIS remuneração observada", "Dezembro de 2025", RAIS, review, "review",
                    "7 partes nacionais conciliadas: 59.970.945 vínculos ativos não abandonados, incluindo não identificado; 51.474.414 remunerações informadas, 8.496.531 ausentes. Valores não identificados excluídos do mapa.")
        caged = self.parquet("trabalho/derived/caged-municipio-2020-2026-com-ajustes.parquet")
        caged = caged[caged.municipio_ibge.notna()]
        note = ("NovoCaged com ajustes na edição de agosto de 2026. Emprego celetista; não é o mesmo universo da RAIS. "
                "Estoque negativo municipal é apresentado como zero pela fonte e pode impedir conciliação histórica nacional. Não inclui salário municipal, ainda não agregado.")
        self.metric("exp_cs", "Estoque de empregos no NovoCaged", "vínculos", ["2026-08"], CAGED, note, "Trabalho e renda formal")
        self.put("exp_cs", caged[caged.competencia == "2026-08"].set_index("municipio_ibge").estoque, "2026-08")
        for n, start in [(12, "2025-09"), (24, "2024-09")]:
            part = caged[caged.competencia.between(start, "2026-08")]
            count = part.groupby("municipio_ibge").competencia.nunique()
            self.check(f"Caged{n} meses distintos por município", count.eq(n).all())
            sums = part.groupby("municipio_ibge").saldo.agg(lambda s: s.sum(min_count=n))
            key = f"exp_c{n}"
            self.metric(key, f"Saldo do emprego formal em {n} meses", "vínculos", [f"{start} a 2026-08"], CAGED,
                        note + f" Soma dos saldos mensais de {start} a 2026-08; admissões menos desligamentos, não variação percentual do estoque.", "Trabalho e renda formal")
            self.put(key, sums, f"{start} a 2026-08")
        self.source("caged", "MTE: NovoCaged com ajustes", "Jan/2020 a ago/2026; indicadores recentes", CAGED, note,
                    coverage="5.571 municípios. Histórico consolidado de 80 meses local; saldos de 12/24 meses publicados nesta camada.")
        self.source("caged-salary", "NovoCaged: salários de admissão municipais", "Set/2024 a ago/2026", MTE + "microdados-rais-e-caged",
                    "72 arquivos MOV/FOR/EXC íntegros. Salários municipais ainda não agregados; a série salarial pronta é somente Brasil e não foi atribuída a municípios.", "processing_pending", "24 competências de microdados; sem indicador municipal calculado.")

    def catalog(self):
        for family, filename, label, note in [
            ("pof", "consumo/manifesto.json", "IBGE: despesas e consumo das famílias",
             "MicrodadosPOF 2017/2018 adquiridos; nenhum gasto municipal em bares calculado. Domínios da pesquisa não equivalem a cada município."),
            ("osm", "osm/manifesto.json", "OpenStreetMap: vias e pontos de interesse",
             "Extrato nacional íntegro, 29/09/2026. Isócronas, acessibilidade e agregados de pontos de interesse não calculados. © OpenStreetMap contributors, ODbL; cobertura variável."),
            ("cnpj-history", "cnpj/manifesto-2026-09.json", "Receita Federal: CNPJ histórico e endereços",
             "Fotografias nacionais de set/2025 e set/2026 adquiridas. CNAEs/endereço/crosswalk municipal ainda não tratados nesta frente; não substituem os dados CNPJ já existentes no aplicativo. Fotografias não reconstituem todos os eventos entre datas."),
        ]:
            d = json.loads(self.path(filename).read_text())
            self.source(family, label, d.get("reference", "Set2025 e set2026"), d.get("source_url", "https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/"), note, "processing_pending", "Arquivos originais adquiridos; sem novas métricas municipais desta frente.")
        self.source("census-sectors", "IBGE: setores censitários", "Censo 2022",
                    "https://www.ibge.gov.br/estatisticas/downloads-estatisticas.html",
                    "Básico, demografia, dicionário e malha definitiva adquiridos. Nenhum indicador intramunicipal integrado; demografia contém supressões. Geometria multiparte não pode duplicar população;18/19 anos não separáveis por setor.",
                    "processing_pending", "468.099 setores básicos e 458.772 demográficos; 5.570 municípios.")
        self.source("regic", "IBGE: influência regional e eixos de consumo", "2018",
                    "https://www.ibge.gov.br/geociencias/organizacao-do-territorio/redes-e-fluxos-geograficos/15798-regioes-de-influencia-das-cidades.html",
                    "Eixos de compras/cultura/esporte preparados na camada regional própria. Cidades REGIC e municípios são unidades distintas; IA de arranjo não repetido como indicador municipal. Não são viagens, consumidores ou gasto observados.",
                    "prepared_regional", "4.899 Cidades REGIC; 5.570 municípios e ligações municipais complementares.")
        self.source("trends", "Google Trends: interesse por termos", "Tentativa em 30/09/2026", "https://trends.google.com/trends/",
                    "Consulta pública bloqueada por HTTP 429. Nenhuma série adquirida e nenhum zero atribuído a cidade.", "unavailable", "Sem observações utilizáveis.")

    def validate_samples(self):
        """Conferência de três portes, usando colunas derivadas diretamente."""
        samples = ["3550308", "4113700", "5200050"]
        table = self.parquet("trabalho/derived/rais-vinculos-municipio-setor-2023-2025.parquet")
        payroll = self.parquet("trabalho/derived/rais-2025-remuneracao-municipio-setor.parquet")
        caged = self.parquet("trabalho/derived/caged-municipio-2020-2026-com-ajustes.parquet")
        for code in samples:
            cells = self.cities[code]
            total = table[(table.municipio_ibge == code) & (table.ano == 2025) & (table.setor == "Total")].iloc[0]
            self.check("Amostra RAIS estoque:" + code, cells["exp_rais"]["value"] == int(total.vinculos_31_dezembro))
            wage = payroll[(payroll.municipio_ibge == code) & (payroll.setor == "total")].iloc[0]
            # Denominador é a observação salarial, não o total tabelado de vínculos.
            mean = wage.remuneracao_dezembro_soma_nominal / wage.remuneracao_dezembro_informada_n
            self.check("Amostra remuneração e denominador:" + code, cells["exp_rw"]["value"] == round(mean, 2))
            period = caged[(caged.municipio_ibge == code) & caged.competencia.between("2025-09", "2026-08")]
            independent = int(period.admissoes.sum() - period.desligamentos.sum())
            self.check("Amostra saldo Caged por admissões menos desligamentos:" + code, cells["exp_c12"]["value"] == independent)
        for key in ["exp_r0", "exp_urb", "exp_rur", "exp_ad18", "exp_event"]:
            self.check("Contagens inteiras:" + key, all(c[key]["value"] is None or isinstance(c[key]["value"], int) for c in self.cities.values() if key in c))

    def finish(self):
        coverage = {}
        for key, meta in self.indicators.items():
            cells = [c[key] for c in self.cities.values() if key in c]
            values = [c["value"] for c in cells if c["value"] is not None]
            coverage[key] = dict(label=meta["label"], observed=len(values), missing=len(self.ids)-len(values),
                                 zero=sum(v == 0 for v in values), min=min(values) if values else None,
                                 max=max(values) if values else None)
            self.check("Cobertura válida:" + key, len(cells) <= len(self.ids) and len(values) > 0)
            self.check("Anos preservados:" + key, all(c["year"] in meta["years"] for c in cells))
        self.check("Prefixos e ausência de colisões", all(k.startswith("exp_") for k in self.indicators))
        self.check("Sem eventos zero inferidos", coverage["exp_event"]["zero"] == 0 and coverage["exp_event"]["missing"] > 0)
        self.check("RAIS remuneração sinalizada", all(self.indicators[k]["publicationStatus"] == "review" for k in ["exp_rm", "exp_rw", "exp_rn", "exp_rmiss"]))
        generated = datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat(timespec="seconds")
        output = dict(version=1, generatedAt=generated, indicators=self.indicators, cities=self.cities, sources=self.sources)
        payload = json.dumps(output, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
        # A camada é pública: somente chaves IBGE, números, anos e catálogo de fontes.
        self.check("Somente números/anos em cidades", all(set(cell) == {"value", "year"} and (cell["value"] is None or isinstance(cell["value"], (int, float))) for c in self.cities.values() for cell in c.values()))
        self.check("Payload menor que 8 MiB", len(payload) < 8 * 1024 * 1024, len(payload))
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_bytes(payload)
        proof = dict(generatedAt=generated, output=str(OUTPUT.relative_to(REPO)), bytes=len(payload),
                     gzipBytes=len(gzip.compress(payload, mtime=0)), sha256=digest(OUTPUT),
                     indicators=len(self.indicators), municipalities=len(self.ids), sources=len(self.sources),
                     status="passed", inputs=self.inputs, coverage=coverage, checks=self.checks,
                     excludedCodes={k: sorted(v) for k, v in self.excluded.items()},
                     absence="Célula com ausência explicitada:value=null; ausência de entrada significa não observado e deve ser consumida como null, nunca zero.",
                     aggregation="sum:soma territorial; mean:média aritmética dos municípios com observação; ratio:razão das somas de componentes válidos no mesmo ano (não usado nesta versão). Comparação Brasil/rede segue média municipal, sem alterar pesos/nota.",
                     precision="Moeda e percentuais arredondados a 2 casas somente na serialização; contagens inteiras preservadas.",
                     limitations=["Expansão exploratória em Revisão, sem nova fórmula ou peso.", "Séries completas e detalhe por produto permanecem locais para conter o payload.", "Sem dados individuais, contatos ou endereços."])
        PROOF.write_text(json.dumps(proof, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({k: proof[k] for k in ["bytes", "gzipBytes", "indicators", "municipalities", "sources", "status"]}, ensure_ascii=False))


def main():
    integration = Integration()
    for step in ["census", "education", "tourism", "agriculture", "employment", "catalog", "validate_samples", "finish"]:
        print("Integrando:", step, flush=True)
        getattr(integration, step)()


if __name__ == "__main__":
    main()
