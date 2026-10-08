"""Consolida os manifestos de aquisição e verifica arquivos por hash e tamanho."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from coleta_util import ROOT, digest, now, save_json


def records(manifest):
    for key in ("files", "fontes", "sources"):
        value = manifest.get(key, [])
        if isinstance(value, list):
            # Tentativas de API que falharam continuam no manifesto da frente.
            # Este catálogo enumera somente transferências com evidência de bytes/hash.
            yield from (row for row in value if isinstance(row, dict) and row.get("raw_path")
                        and row.get("sha256") and isinstance(row.get("bytes"), int))


def main(verify_hashes):
    sources, errors, manifests = [], [], []
    seen = set()
    for manifest_path in sorted(ROOT.glob("*/manifesto*.json")):
        document = json.loads(manifest_path.read_text())
        manifests.append({"path": str(manifest_path.relative_to(ROOT)),
                          "status": document.get("status", "consultar manifesto da frente"),
                          "sha256": digest(manifest_path)})
        for record in records(document):
            raw_path = Path(record["raw_path"])
            candidates = [ROOT / raw_path, manifest_path.parent / raw_path]
            path = next((p for p in candidates if p.is_file()), candidates[-1])
            relative = str(path.relative_to(ROOT))
            if relative in seen:
                continue
            seen.add(relative)
            check = {"exists": path.is_file()}
            if path.is_file():
                check["bytes_match"] = path.stat().st_size == record.get("bytes")
                if verify_hashes:
                    check["sha256_match"] = digest(path) == record.get("sha256")
            if not all(check.values()):
                errors.append({"path": relative, "checks": check})
            sources.append({"family": manifest_path.parent.name, "path": relative,
                            "source_record_status": record.get("status", "downloaded"),
                            "source_url": record.get("url"), "reference": record.get("reference", record.get("referencia", record.get("reference_year", record.get("reference_month")))),
                            "fetched_at": record.get("fetched_at", record.get("data_acesso", record.get("accessed_at"))),
                            "bytes": record.get("bytes"), "sha256": record.get("sha256"), "checks": check,
                            "manifest": str(manifest_path.relative_to(ROOT))})
    partials = [str(p.relative_to(ROOT)) for p in ROOT.rglob("*.part")]
    total = sum(row.get("bytes") or 0 for row in sources)
    families = {}
    for row in sources:
        family = families.setdefault(row["family"], {"files_count": 0, "bytes": 0})
        family["files_count"] += 1
        family["bytes"] += row["bytes"]
    inventory = {"created_at": now(), "scope": "Aquisição de fontes públicas para refinamento Agrobar; sem mudança de índice ou produção",
                 "files_count": len(sources), "bytes_catalogued": total, "GB_decimal": round(total / 1e9, 3),
                 "hashes_recomputed": verify_hashes, "families": families, "manifests": manifests, "files": sources,
                 "integrity_errors": errors, "partial_downloads": partials,
                 "catalogued_files_verified": verify_hashes and not errors,
                 "superseded_files_preserved": sum(row["source_record_status"] == "superseded" for row in sources),
                 "all_acquisitions_complete": False,
                 "known_gap": "Google Trends retornou HTTP 429. Eventos possuem cobertura colaborativa parcial. Consultar também as limitações por fonte."}
    save_json(ROOT / "catalogo.json", inventory)
    lines = ["# Arquivos efetivamente baixados", "", f"Catálogo gerado em {inventory['created_at']}.", "",
             f"{len(sources)} arquivos catalogados, incluindo dados, documentação e metadados, total de {inventory['GB_decimal']} GB.", "",
             "`superseded` identifica uma consulta substituída, preservada como histórico e fora da derivação vigente.", "",
             "| Família | Arquivo | Referência | Bytes | Estado na origem local | Fonte |", "|---|---|---|---:|---|---|"]
    for row in sources:
        ref = str(row["reference"] or "Consultar manifesto").replace("|", "/")
        lines.append(f"| {row['family']} | [{Path(row['path']).name}]({row['path']}) | {ref} | {row['bytes']} | {row['source_record_status']} | [Origem]({row['source_url']}) |")
    (ROOT / "ARQUIVOS.md").write_text("\n".join(lines) + "\n")
    print(json.dumps({"files": len(sources), "GB": inventory["GB_decimal"], "integrity_errors": len(errors), "partials": len(partials)}, ensure_ascii=False))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-hashes", action="store_true")
    main(parser.parse_args().verify_hashes)
