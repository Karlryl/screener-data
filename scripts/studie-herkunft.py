#!/usr/bin/env python3
"""Herkunfts-Schliessung (R13) und Daten-Vertrag (R12b) der Studien-Verfassung 2.0.0.

Der SEC-Komponentenspeicher ist ein ABGELEITETES Artefakt: 41 GB SQLite, gebaut aus
127 versiegelten Roh-Payloads. Ohne Bau-Nachweis waere er nach der Stilllegung des
Altapparats eine Blackbox mit 308 Millionen Zahlen — verifizierbar, aber nicht mehr
nachbaubar. Dieses Skript schliesst die Herkunftskette:

  closure  - schreibt provenance-closure.json (Payload-Hashes MIT Abruf-URL, Hashes der
             Bau-Skripte) und data-contract.json (Zeilenzahlen + Neubau-Rezept).
  probe    - baut EIN Quartal aus seinem Roh-Payload neu und vergleicht Zeilenzahlen und
             Zeilen-Digests gegen den versiegelten Integritaetsbericht. Mit --corrupt
             laeuft derselbe Probelauf gegen eine absichtlich veraenderte Kopie des
             Payloads: er MUSS dann rot werden, sonst prueft er nichts.
  verify   - prueft Schliessung und Vertrag gegen Repo und (falls vorhanden) Speicher.
  self-test- hermetisch, ohne Speicher: baut einen Miniatur-Bestand, verifiziert ihn und
             bricht ihn danach vierfach absichtlich. Jeder Bruch MUSS auffliegen.

Speicherort kommt aus der Umgebung (R12a): EARLY_DETECTION_DATA_ROOT oder --data-root.
Werkzeuge: Python-Standardbibliothek + sqlite3 (R14c).
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any

CLOSURE_SCHEMA = "early-detection-provenance-closure/v1"
CONTRACT_SCHEMA = "early-detection-data-contract/v1"
PROBE_SCHEMA = "early-detection-rebuild-probe/v1"
DATA_ROOT_ENV = "EARLY_DETECTION_DATA_ROOT"
SCRIPTS = Path(__file__).resolve().parent
REPO = SCRIPTS.parent

# Die Kette, die aus einer Wayback-Kapsel die 41-GB-Datenbank macht. Genau diese
# Dateien muessen mit-versiegelt werden, sonst ist das Rezept ohne Koch.
BUILD_SCRIPTS = (
    "scripts/early-detection-sec-wayback.py",
    "scripts/early-detection-pit-compact.py",
    "scripts/early-detection-pit-integrity.py",
)


class ClosureError(RuntimeError):
    """Die Herkunftskette ist nicht geschlossen."""


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return sha256_bytes(raw.encode("utf-8"))


def load_module(relative: str):
    path = REPO / relative
    spec = importlib.util.spec_from_file_location(path.stem.replace("-", "_"), path)
    if spec is None or spec.loader is None:
        raise ClosureError(f"Bau-Skript nicht ladbar: {relative}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def resolve_data_root(value: Path | None) -> Path:
    raw = value or os.environ.get(DATA_ROOT_ENV)
    if not raw:
        raise ClosureError(
            f"Speicherort unbekannt: weder --data-root noch ${DATA_ROOT_ENV} gesetzt"
        )
    return Path(raw).expanduser().resolve()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_script_digests(repo: Path) -> list[dict[str, Any]]:
    result = []
    for relative in BUILD_SCRIPTS:
        path = repo / relative
        if not path.is_file():
            raise ClosureError(f"Bau-Skript fehlt: {relative}")
        result.append({"path": relative, "sha256": sha256_file(path), "bytes": path.stat().st_size})
    return result


def payload_records(report: dict[str, Any], data_root: Path, hash_blobs: bool) -> list[dict[str, Any]]:
    """Ein Herkunftssatz je Roh-Payload: Inhalts-Hash, Fundort, Abruf-URL, Reifegrad."""
    records = []
    for payload in report["payloads"]:
        observation_path = data_root / payload["observationPath"]
        if not observation_path.is_file():
            raise ClosureError(f"Beobachtung fehlt: {payload['observationPath']}")
        observation = read_json(observation_path)
        blob = data_root / observation["payloadPath"]
        if not blob.is_file():
            raise ClosureError(f"Roh-Payload fehlt: {observation['payloadPath']}")
        actual_bytes = blob.stat().st_size
        if actual_bytes != int(payload["payloadBytes"]):
            raise ClosureError(f"Roh-Payload hat andere Laenge: {payload['payloadSha256']}")
        blob_state = "size_only"
        if hash_blobs:
            if sha256_file(blob) != payload["payloadSha256"]:
                raise ClosureError(f"Roh-Payload-Hash weicht ab: {payload['payloadSha256']}")
            blob_state = "sha256_verified"
        records.append({
            "quarter": payload["quarter"],
            "vintage": observation["datasetVariant"],
            "observedAt": observation["observedAt"],
            "payloadSha256": payload["payloadSha256"],
            "payloadBytes": int(payload["payloadBytes"]),
            "observationSha256": sha256_file(observation_path),
            "sourceUrl": observation["sourceUrl"],
            "originalSourceUrl": observation["originalSourceUrl"],
            "blobState": blob_state,
            "counts": payload["counts"],
        })
    records.sort(key=lambda item: (item["quarter"], item["observedAt"], item["payloadSha256"]))
    return records


def superset_observations(data_root: Path, sealed: set[str]) -> list[dict[str, str]]:
    """Akzeptierte Beobachtungen im Speicher, die NICHT in der versiegelten Datenbank stehen.

    Der Speicher wuchs nach dem Bau weiter (Zwischen-Captures des Archivs). Wer heute
    ohne Payload-Filter neu baut, bekommt deshalb eine groessere Datenbank als die
    versiegelte. Das wird hier benannt, damit das Neubau-Rezept nicht mehr verspricht,
    als es einloest.
    """
    base = data_root / "observations" / "sec-fsd"
    extra = []
    for observation_path in sorted(base.rglob("*.json")):
        observation = read_json(observation_path)
        digest = str(observation.get("payloadSha256", ""))
        if digest and digest not in sealed:
            extra.append({
                "quarter": str(observation.get("quarter")),
                "vintage": str(observation.get("datasetVariant")),
                "observedAt": str(observation.get("observedAt")),
                "payloadSha256": digest,
            })
    return extra


def build_closure(
    data_root: Path, integrity_report: Path, repo: Path, probe: dict[str, Any] | None, hash_blobs: bool
) -> dict[str, Any]:
    report = read_json(integrity_report)
    if report.get("status") != "PASS_FULL_INTEGRITY":
        raise ClosureError(f"Integritaetsbericht ist nicht PASS_FULL_INTEGRITY: {report.get('status')}")
    records = payload_records(report, data_root, hash_blobs)
    extra_observations = superset_observations(data_root, {item["payloadSha256"] for item in records})
    closure = {
        "schema": CLOSURE_SCHEMA,
        "protocol": "FEM-SEC-US@2.0.0",
        "purpose": "R13 Herkunfts-Schliessung: der 41-GB-Speicher bleibt nachbaubar, nicht nur pruefbar.",
        "integrityReport": {
            "path": str(integrity_report.resolve().relative_to(repo)).replace("\\", "/"),
            "fileSha256": sha256_file(integrity_report),
            "reportSha256": report["reportSha256"],
            "logicalEvidenceSha256": report["logicalEvidenceSha256"],
        },
        "storeTotals": {
            **{key: int(value) for key, value in report["tableCounts"].items()},
            "databaseBytes": int(report["databaseBytes"]),
        },
        "orphanRowsDisclosed": int(report["tableCounts"]["orphan_rows"]),
        "orphanRowsNote": "Der Bericht sagt PASS und fuehrt trotzdem Waisen-Zeilen. Sie werden im Datenbasis-Report benannt, nicht verschwiegen.",
        "buildScripts": build_script_digests(repo),
        "payloadCount": len(records),
        "payloads": records,
        "payloadSetSha256": canonical_sha256(records),
        "supersetObservationCount": len(extra_observations),
        "supersetObservations": extra_observations,
        "supersetNote": "Diese akzeptierten Beobachtungen liegen im Speicher, aber NICHT in der versiegelten Datenbank. Ein byte-gleicher Neubau braucht deshalb einen Payload-Filter auf die oben gelisteten payloadSha256 — ohne ihn entsteht eine echte Obermenge.",
        "rebuildProbe": probe,
    }
    closure["closureSha256"] = canonical_sha256({k: v for k, v in closure.items() if k != "closureSha256"})
    return closure


def build_contract(closure: dict[str, Any]) -> dict[str, Any]:
    """R12b: kleiner Vertrag (<5 KB) statt 41-GB-Kopie — reproduzierbar statt transportierbar."""
    contract = {
        "schema": CONTRACT_SCHEMA,
        "protocol": "FEM-SEC-US@2.0.0",
        "purpose": "R12b Daten-Vertrag: Pruefsumme, Zeilenzahlen und Neubau-Rezept des SEC-Komponentenspeichers.",
        "dataRootEnv": DATA_ROOT_ENV,
        "payloadCount": closure["payloadCount"],
        "payloadSetSha256": closure["payloadSetSha256"],
        "logicalEvidenceSha256": closure["integrityReport"]["logicalEvidenceSha256"],
        "rowCounts": closure["storeTotals"],
        "buildScripts": closure["buildScripts"],
        "rebuildRecipe": [
            "1. Speicherort setzen: EARLY_DETECTION_DATA_ROOT=<Wurzel mit observations/ und blobs/>",
            "2. Neubau: python scripts/early-detection-pit-compact.py import-fsd-store --data-root $EARLY_DETECTION_DATA_ROOT --database <ziel.sqlite>",
            "3. Nachweis: python scripts/early-detection-pit-integrity.py audit --data-root $EARLY_DETECTION_DATA_ROOT --database <ziel.sqlite> --output <bericht.json>",
            "4. Abgleich: logicalEvidenceSha256 des neuen Berichts muss dem Wert in diesem Vertrag entsprechen.",
            "Haeppchen-Bauweise (R15c): --from-quarter/--to-quarter je Quartal, jedes Haeppchen ist wiederaufnehmbar.",
        ],
        "rebuildProbe": {
            "quarter": (closure.get("rebuildProbe") or {}).get("quarter"),
            "status": (closure.get("rebuildProbe") or {}).get("status"),
            "brokenProbeStatus": (closure.get("rebuildProbe") or {}).get("brokenProbeStatus"),
        },
        "supersetObservationCount": closure["supersetObservationCount"],
        "rebuildCaveat": "Ohne Payload-Filter erzeugt Schritt 2 eine Obermenge (der Speicher enthaelt inzwischen mehr akzeptierte Beobachtungen als die versiegelte Datenbank). Die Liste der zusaetzlichen payloadSha256 steht in der Herkunfts-Schliessung; der Filter selbst ist eine benannte E1-Aufgabe.",
        "notCopied": "Die 41-GB-Datenbank wird nie kopiert. Wer sie braucht, baut sie aus den gepinnten Roh-Payloads neu.",
    }
    contract["contractSha256"] = canonical_sha256({k: v for k, v in contract.items() if k != "contractSha256"})
    return contract


def shadow_root_with_broken_payload(data_root: Path, quarter: str, target: Path) -> None:
    """Kopiert Beobachtungen und Payloads eines Quartals und veraendert EINEN Datensatz."""
    source_observations = data_root / "observations" / "sec-fsd" / quarter
    shutil.copytree(source_observations, target / "observations" / "sec-fsd" / quarter)
    marker = data_root / "STORE.json"
    if not marker.is_file():
        raise ClosureError("Speicher-Marker STORE.json fehlt — Wurzel ist kein Roh-Speicher")
    shutil.copy2(marker, target / "STORE.json")
    broken = 0
    for observation_path in sorted((target / "observations" / "sec-fsd" / quarter).glob("*.json")):
        observation = read_json(observation_path)
        blob_relative = Path(observation["payloadPath"])
        destination = target / blob_relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        source_blob = data_root / blob_relative
        if broken == 0:
            with zipfile.ZipFile(source_blob) as archive, zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as out:
                for member in archive.infolist():
                    raw = archive.read(member.filename)
                    if member.filename == "num.txt":
                        lines = raw.split(b"\n")
                        # Eine einzige Zahl in einer einzigen Datenzeile umbiegen.
                        for index in range(1, len(lines)):
                            if lines[index].count(b"\t") >= 7:
                                fields = lines[index].split(b"\t")
                                fields[-1] = b"999999999" if fields[-1] != b"999999999" else b"1"
                                lines[index] = b"\t".join(fields)
                                break
                        raw = b"\n".join(lines)
                    out.writestr(member.filename, raw)
            broken = 1
        else:
            shutil.copy2(source_blob, destination)
    if broken == 0:
        raise ClosureError(f"Kein Payload fuer Quartal {quarter} gefunden — Probelauf kann nichts brechen")


def run_probe(data_root: Path, integrity_report: Path, quarter: str, corrupt: str | None) -> dict[str, Any]:
    """Baut EIN Quartal neu und vergleicht gegen die versiegelten Zeilen-Digests.

    corrupt=None        - echter Probelauf.
    corrupt='payload'   - Roh-Payload absichtlich veraendert: die Inhalts-Adressierung
                          des Speichers muss das beim Einlesen bemerken.
    corrupt='erwartung' - Payload sauber, aber EIN versiegelter Zeilen-Digest verbogen:
                          der Vergleicher selbst muss rot werden, sonst ist er tot.
    """
    report = read_json(integrity_report)
    if corrupt == "erwartung":
        for payload in report["payloads"]:
            if payload["quarter"] == quarter and payload.get("rowDigests"):
                payload["rowDigests"]["facts"] = "0" * 64
                break
    sealed = {
        payload["payloadSha256"]: payload
        for payload in report["payloads"]
        if payload["quarter"] == quarter
    }
    if not sealed:
        raise ClosureError(f"Quartal {quarter} steht nicht im Integritaetsbericht")

    compact = load_module("scripts/early-detection-pit-compact.py")
    integrity = load_module("scripts/early-detection-pit-integrity.py")

    with tempfile.TemporaryDirectory(prefix="studie-herkunft-") as workspace:
        work = Path(workspace)
        root = data_root
        if corrupt == "payload":
            root = work / "shadow"
            shadow_root_with_broken_payload(data_root, quarter, root)
        database = work / "rebuild.sqlite"
        # Ein Neubau, der schon beim Einlesen scheitert, ist ein ROTES Ergebnis des
        # Probelaufs — nicht ein Absturz des Pruefers. Der Grund wird woertlich notiert.
        try:
            build = compact.import_store(root, database, quarter, quarter)
            build_error = None
        except (RuntimeError, OSError, ValueError, zipfile.BadZipFile) as exc:
            build, build_error = {"status": "IMPORT_ERROR"}, f"{type(exc).__name__}: {exc}"
        if build.get("status") != "PASS":
            return {
                "schema": PROBE_SCHEMA,
                "quarter": quarter,
                "corrupted": corrupt,
                "status": "FAIL",
                "differences": [build_error or f"Neubau meldete Status {build.get('status')}"],
            }
        audit = integrity.audit(root, database, True)

        differences: list[str] = []
        rebuilt = {payload["payloadSha256"]: payload for payload in audit["payloads"]}
        # Der Speicher enthaelt mehr akzeptierte Beobachtungen, als in die versiegelte
        # Datenbank gewandert sind (Zwischen-Captures des Archivs). Ein Neubau ohne
        # Payload-Filter zieht sie mit. Das ist KEIN stiller Toleranzfall: die Ueberzahl
        # wird namentlich ausgewiesen, und fehlende versiegelte Payloads bleiben rot.
        superset = sorted(set(rebuilt) - set(sealed))
        for digest in sorted(set(sealed) - set(rebuilt)):
            differences.append(f"Versiegelter Payload fehlt im Neubau: {digest}")
        for digest, original in sealed.items():
            fresh = rebuilt.get(digest)
            if fresh is None:
                differences.append(f"Payload {digest[:12]} fehlt im Neubau")
                continue
            if fresh["counts"] != original["counts"]:
                differences.append(f"Zeilenzahlen weichen ab ({digest[:12]}): {fresh['counts']} != {original['counts']}")
            for table, expected in (original.get("rowDigests") or {}).items():
                actual = (fresh.get("rowDigests") or {}).get(table)
                if actual != expected:
                    differences.append(f"Zeilen-Digest {table} weicht ab ({digest[:12]})")
        return {
            "schema": PROBE_SCHEMA,
            "quarter": quarter,
            "corrupted": corrupt,
            "payloadsRebuilt": len(rebuilt),
            "sealedPayloads": len(sealed),
            "supersetPayloads": superset,
            "status": "FAIL" if differences else "PASS",
            "differences": differences,
        }


def verify(closure_path: Path, contract_path: Path, repo: Path) -> dict[str, Any]:
    closure = read_json(closure_path)
    contract = read_json(contract_path)
    issues: list[str] = []

    if closure.get("schema") != CLOSURE_SCHEMA:
        issues.append("closure_schema")
    if contract.get("schema") != CONTRACT_SCHEMA:
        issues.append("contract_schema")

    expected_closure = canonical_sha256({k: v for k, v in closure.items() if k != "closureSha256"})
    if expected_closure != closure.get("closureSha256"):
        issues.append("closure_self_digest")
    expected_contract = canonical_sha256({k: v for k, v in contract.items() if k != "contractSha256"})
    if expected_contract != contract.get("contractSha256"):
        issues.append("contract_self_digest")

    if canonical_sha256(closure.get("payloads", [])) != closure.get("payloadSetSha256"):
        issues.append("payload_set_digest")
    if closure.get("payloadCount") != len(closure.get("payloads", [])):
        issues.append("payload_count")
    if contract.get("payloadSetSha256") != closure.get("payloadSetSha256"):
        issues.append("contract_payload_set_mismatch")
    if contract.get("rowCounts") != closure.get("storeTotals"):
        issues.append("contract_row_counts_mismatch")

    # Jeder Payload braucht Inhalts-Hash UND Abruf-URL — ein Hash ohne Fundort waere
    # kein Herkunftsnachweis, eine URL ohne Hash kein Beweis.
    for record in closure.get("payloads", []):
        if len(record.get("payloadSha256", "")) != 64:
            issues.append(f"payload_hash:{record.get('quarter')}")
        if not str(record.get("originalSourceUrl", "")).startswith("https://www.sec.gov/"):
            issues.append(f"payload_origin:{record.get('quarter')}")
        if not str(record.get("sourceUrl", "")).startswith("https://"):
            issues.append(f"payload_source:{record.get('quarter')}")

    # Die Bau-Skripte muessen noch genau die sein, mit denen gebaut wurde.
    for entry in closure.get("buildScripts", []):
        path = repo / entry["path"]
        if not path.is_file():
            issues.append(f"build_script_missing:{entry['path']}")
        elif sha256_file(path) != entry["sha256"]:
            issues.append(f"build_script_changed:{entry['path']}")

    if "supersetObservations" not in closure:
        issues.append("superset_not_disclosed")
    if closure.get("supersetObservationCount") != len(closure.get("supersetObservations", [])):
        issues.append("superset_count")
    if contract.get("supersetObservationCount") != closure.get("supersetObservationCount"):
        issues.append("contract_superset_mismatch")

    probe = closure.get("rebuildProbe") or {}
    if probe.get("status") != "PASS":
        issues.append("rebuild_probe_not_pass")
    if probe.get("brokenProbeStatus") != "FAIL":
        issues.append("broken_probe_never_shown_red")

    # Speicherseitige Tiefenpruefung laeuft bewusst ueber `probe` (Neubau), nicht hier:
    # `verify` muss auch auf einem Rechner ohne die 41 GB voll aussagekraeftig sein.
    return {"status": "FAIL" if issues else "PASS", "issues": issues, "payloadCount": closure.get("payloadCount")}


def self_test() -> dict[str, Any]:
    """Hermetisch: Miniatur-Schliessung bauen, verifizieren, danach vierfach brechen."""
    with tempfile.TemporaryDirectory(prefix="studie-herkunft-selftest-") as workspace:
        work = Path(workspace)
        repo = work / "repo"
        (repo / "scripts").mkdir(parents=True)
        for relative in BUILD_SCRIPTS:
            (repo / relative).write_text(f"# stub {relative}\n", encoding="utf-8")

        payloads = [{
            "quarter": "2009q1",
            "vintage": "legacy_earliest_archived",
            "observedAt": "2018-03-28T07:41:26.000Z",
            "payloadSha256": "a" * 64,
            "payloadBytes": 13655,
            "observationSha256": "b" * 64,
            "sourceUrl": "https://web.archive.org/web/20180328074126id_/https://www.sec.gov/x.zip",
            "originalSourceUrl": "https://www.sec.gov/files/dera/data/financial-statement-data-sets/2009q1.zip",
            "blobState": "sha256_verified",
            "counts": {"submissions": 3, "facts": 7, "presentations": 5, "tags": 2, "orphans": 0},
        }]
        closure = {
            "schema": CLOSURE_SCHEMA,
            "protocol": "FEM-SEC-US@2.0.0",
            "purpose": "self-test",
            "integrityReport": {"path": "x.json", "fileSha256": "c" * 64, "reportSha256": "d" * 64, "logicalEvidenceSha256": "e" * 64},
            "storeTotals": {"source_payloads": 1, "submissions": 3, "facts": 7, "presentations": 5, "payload_tags": 2, "orphan_rows": 0, "databaseBytes": 4096},
            "orphanRowsDisclosed": 0,
            "orphanRowsNote": "self-test",
            "buildScripts": build_script_digests(repo),
            "payloadCount": 1,
            "payloads": payloads,
            "payloadSetSha256": canonical_sha256(payloads),
            "supersetObservationCount": 0,
            "supersetObservations": [],
            "supersetNote": "self-test",
            "rebuildProbe": {"schema": PROBE_SCHEMA, "quarter": "2009q1", "status": "PASS", "brokenProbeStatus": "FAIL", "differences": []},
        }
        closure["closureSha256"] = canonical_sha256({k: v for k, v in closure.items() if k != "closureSha256"})
        contract = build_contract(closure)

        closure_path = work / "closure.json"
        contract_path = work / "contract.json"
        write_json(closure_path, closure)
        write_json(contract_path, contract)

        healthy = verify(closure_path, contract_path, repo)
        if healthy["status"] != "PASS":
            raise ClosureError(f"self-test: gesunde Schliessung wurde faelschlich abgelehnt: {healthy['issues']}")

        # Vier Brueche, vier Rot-Erwartungen. Ein Pruefer, der hier gruen bleibt,
        # prueft nichts — genau das war die Fehlklasse der toten Wachtests.
        broken: dict[str, list[str]] = {}
        mutations = {
            "payload_still_gestrichen": lambda value: value.__setitem__("payloads", []),
            "bau_skript_veraendert": lambda value: (repo / BUILD_SCRIPTS[1]).write_text("# manipuliert\n", encoding="utf-8"),
            "probelauf_nie_rot_gezeigt": lambda value: value["rebuildProbe"].__setitem__("brokenProbeStatus", "PASS"),
            "abruf_url_entfernt": lambda value: value["payloads"][0].__setitem__("originalSourceUrl", ""),
            "obermenge_verschwiegen": lambda value: value.pop("supersetObservations"),
        }
        for label, mutate in mutations.items():
            variant = json.loads(json.dumps(closure))
            mutate(variant)
            write_json(closure_path, variant)
            result = verify(closure_path, contract_path, repo)
            if result["status"] != "FAIL":
                raise ClosureError(f"self-test: Bruch '{label}' blieb unentdeckt")
            broken[label] = result["issues"]
            for relative in BUILD_SCRIPTS:
                (repo / relative).write_text(f"# stub {relative}\n", encoding="utf-8")

        return {"status": "PASS", "deterministic": True, "brokenVariantsDetected": sorted(broken)}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    closure = sub.add_parser("closure")
    closure.add_argument("--data-root", type=Path)
    closure.add_argument("--integrity-report", type=Path, required=True)
    closure.add_argument("--output", type=Path, required=True)
    closure.add_argument("--contract-output", type=Path, required=True)
    closure.add_argument("--probe", type=Path, help="Ergebnis eines vorherigen `probe`-Laufs")
    closure.add_argument("--broken-probe", type=Path, help="Ergebnis des absichtlich gebrochenen Probelaufs")
    closure.add_argument("--skip-blob-hash", action="store_true", help="nur Laenge statt Hash der 7,5 GB Payloads")

    probe = sub.add_parser("probe")
    probe.add_argument("--data-root", type=Path)
    probe.add_argument("--integrity-report", type=Path, required=True)
    probe.add_argument("--quarter", default="2009q1")
    probe.add_argument("--corrupt", choices=("payload", "erwartung"), default=None)
    probe.add_argument("--output", type=Path)

    check = sub.add_parser("verify")
    check.add_argument("--closure", type=Path, required=True)
    check.add_argument("--contract", type=Path, required=True)

    sub.add_parser("self-test")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "self-test":
            result = self_test()
        elif args.command == "probe":
            result = run_probe(resolve_data_root(args.data_root), args.integrity_report, args.quarter, args.corrupt)
            if args.output:
                write_json(args.output, result)
        elif args.command == "verify":
            result = verify(args.closure, args.contract, REPO)
        else:
            probe = read_json(args.probe) if args.probe else None
            if probe is not None and args.broken_probe:
                probe = {**probe, "brokenProbeStatus": read_json(args.broken_probe)["status"]}
            closure = build_closure(
                resolve_data_root(args.data_root), args.integrity_report, REPO, probe, not args.skip_blob_hash
            )
            write_json(args.output, closure)
            write_json(args.contract_output, build_contract(closure))
            result = {
                "status": "PASS",
                "payloadCount": closure["payloadCount"],
                "payloadSetSha256": closure["payloadSetSha256"],
            }
    except (RuntimeError, OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"[studie-herkunft] {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if result.get("status") == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
