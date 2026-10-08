#!/usr/bin/env python3
"""Confere artefatos, conservação de totais e reexecução dos derivados adquiridos."""
import argparse
import json
from pathlib import Path

import pandas as pd

from coletar import ROOT, MANIFEST, digest, now, save_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save-baseline", action="store_true")
    parser.add_argument("--compare-baseline", action="store_true")
    args = parser.parse_args()
    m = json.loads(MANIFEST.read_text())
    checks = []
    def check(name, result, detail=None):
        checks.append({"teste": name, "ok": bool(result), "detalhe": detail})
    files = []
    for e in m["fontes"]:
        files.append(e)
        files.extend(e.get("dicionarios_documentacao", []))
    files.extend({**e, "raw_path": e["path"]} for e in m["derivados"])
    for e in files:
        p = ROOT / e["raw_path"]
        check("integridade:" + e["raw_path"], p.is_file() and p.stat().st_size == e["bytes"] and digest(p) == e["sha256"])
    for year in [2022, 2023, 2024]:
        base = ROOT / "derived/inep"
        municipal = pd.read_csv(base / f"{year}-municipio-modalidade.csv")
        national = pd.read_csv(base / f"{year}-validacao-dimensoes.csv")
        unresolved = pd.read_csv(base / f"{year}-cursos-sem-municipio-valido.csv")
        agro = pd.read_csv(base / f"{year}-municipio-area-cine08.csv")
        check(f"{year}:total Brasil = municípios + sem código", int(national.loc[national.TP_DIMENSAO.isin([1, 2]), "matriculas_observadas"].sum()) == int(municipal.matriculas_observadas.sum() + unresolved.QT_MAT.sum()))
        check(f"{year}:EaD sem contagem inventada de cursos", municipal.loc[municipal.TP_MODALIDADE_ENSINO.eq(2), "cursos_presenciais"].isna().all())
        check(f"{year}:matrículas não negativas", municipal.matriculas.dropna().ge(0).all())
        keys = ["CO_MUNICIPIO", "TP_MODALIDADE_ENSINO", "TP_NIVEL_ACADEMICO"]
        totals = municipal.set_index(keys).matriculas
        subset = agro.set_index(keys).matriculas
        check(f"{year}:CINE08 contida no total", subset.le(totals.reindex(subset.index)).all())
    for e in m["fontes"]:
        if e.get("familia") != "cadastur":
            continue
        d = pd.read_csv(ROOT / f"derived/cadastur/{e['categoria']}-municipios.csv")
        check(e["categoria"] + ":reconciliação total", int(d.estabelecimentos_cadastrados.sum()) == e["cobertura"]["registros"])
        check(e["categoria"] + ":reconciliação ausências de código", int(d.loc[d.codigo_ibge.isna(), "estabelecimentos_cadastrados"].sum()) == e["cobertura"]["registros_sem_codigo_ibge"])
        check(e["categoria"] + ":sem contatos pessoais nos agregados", not any(any(x in c.lower() for x in ["cpf", "telefone", "e-mail", "responsável"]) for c in d.columns))
    agenda = pd.read_csv(ROOT / "derived/eventos/calendario-2026.csv")
    candidates = pd.read_csv(ROOT / "derived/eventos/candidatos-agro-sertanejo.csv")
    check("agenda:IDs únicos", agenda.id_evento.is_unique)
    check("agenda:candidatos preservados com e sem detalhe", set(candidates.id_evento) == set(agenda.loc[agenda.candidato_lexical_agro_sertanejo, "id_evento"]))
    check("agenda:datas ausentes sinalizadas", agenda.loc[agenda.data_inicio.isna() | agenda.data_fim.isna(), "data_requer_revisao"].all())
    baseline = ROOT / ".cache/baseline-derivados.json"
    hashes = {e["path"]: e["sha256"] for e in m["derivados"]}
    if args.save_baseline:
        save_json(baseline, hashes)
    rerun = None
    if args.compare_baseline:
        previous = json.loads(baseline.read_text())
        changed = sorted(k for k in set(previous) | set(hashes) if previous.get(k) != hashes.get(k))
        check("reexecução:derivados idênticos byte a byte", not changed, changed)
        rerun = {"comparados": len(hashes), "divergentes": changed}
    report = {"gerado_em": now(), "status": "passou" if all(c["ok"] for c in checks) else "falhou",
              "checks": checks, "total_checks": len(checks), "integridade_arquivos_verificados": len(files),
              "reexecucao": rerun, "cobertura": [{"fonte": e["raw_path"], "referencia": e["referencia"], "cobertura": e["cobertura"], "validacao": e["validacao"]} for e in m["fontes"] if e.get("familia") or e["raw_path"].endswith("calendario-2026.html")],
              "pendencias": m.get("pendencias", []), "falhas_de_aquisicao": m["falhas"]}
    save_json(ROOT / "validacao.json", report)
    print(json.dumps({"status": report["status"], "checks": len(checks), "arquivos": len(files), "reexecucao": rerun}, ensure_ascii=False))
    if report["status"] != "passou":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
