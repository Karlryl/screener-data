#!/usr/bin/env python3
"""Audit whether the compact SEC FSD ledger carries the inputs needed by GQS-00.

This is a coverage audit, not a semantic freeze.  It deliberately keeps the
existing production concept priority from probe-smallcap-coverage.js separate
from the historical evidence found in the point-in-time ledger.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any


SCHEMA = "early-detection-concept-audit/v2"
CONCEPT_MAP_PATH = Path(__file__).resolve().parents[1] / "research" / "early-detection-v4" / "sec-concept-map-1.0.0.json"


class ConceptAuditError(RuntimeError):
    """The concept audit contract could not be satisfied."""


def load_concept_map() -> dict[str, Any]:
    try:
        value = json.loads(CONCEPT_MAP_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConceptAuditError(f"cannot load frozen concept map: {CONCEPT_MAP_PATH}") from exc
    if value.get("schema") != "early-detection-sec-concept-map/v1" or value.get("version") != "FEM-SEC-CONCEPT-MAP@1.0.0":
        raise ConceptAuditError("frozen concept map identity changed")
    if not isinstance(value.get("roles"), dict) or not value["roles"]:
        raise ConceptAuditError("frozen concept map contains no roles")
    return value


CONCEPT_MAP = load_concept_map()
CONCEPT_ROLES: dict[str, dict[str, Any]] = CONCEPT_MAP["roles"]


def canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def period_kind(qtrs: int) -> str:
    if qtrs == 0:
        return "instant"
    if qtrs == 1:
        return "quarterly"
    if qtrs == 4:
        return "annual"
    return f"cumulative_duration_qtrs_{qtrs}"


def connect_readonly(database: Path) -> sqlite3.Connection:
    resolved = database.expanduser().resolve()
    if not resolved.is_file():
        raise ConceptAuditError(f"database does not exist: {resolved}")
    connection = sqlite3.connect(f"file:{resolved.as_posix()}?mode=ro", uri=True)
    schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
    if schema is None or schema[0] != "early-detection-pit-compact-sqlite/v1":
        raise ConceptAuditError("database is not a compact PIT v1 ledger")
    return connection


def audit(database: Path) -> dict[str, Any]:
    connection = connect_readonly(database)
    all_tags = sorted({tag for role in CONCEPT_ROLES.values() for tag in role["conceptPriority"]})
    placeholders = ",".join("?" for _ in all_tags)
    rows = connection.execute(
        f"""
        SELECT c.tag,c.version,f.qtrs,
               COUNT(*) AS physical_rows,
               COUNT(DISTINCT s.adsh) AS accessions,
               COUNT(DISTINCT s.cik) AS entities,
               COUNT(DISTINCT f.payload_id) AS payloads,
               MIN(s.accepted_at_epoch),MAX(s.accepted_at_epoch)
          FROM facts f
          JOIN concepts c ON c.concept_id=f.concept_id
          JOIN submissions s ON s.submission_id=f.submission_id
         WHERE c.tag IN ({placeholders})
           AND s.form IN ('10-K','10-K/A','10-Q','10-Q/A')
           AND f.value_text IS NOT NULL
         GROUP BY c.tag,c.version,f.qtrs
         ORDER BY c.tag,c.version,f.qtrs
        """,
        all_tags,
    ).fetchall()
    payload_rows = connection.execute(
        "SELECT payload_sha256,quarter,observed_at FROM source_payloads ORDER BY quarter,observed_at,payload_sha256"
    ).fetchall()
    connection.close()

    evidence: dict[str, list[dict[str, Any]]] = defaultdict(list)
    excluded_durations: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"physicalRows": 0, "qtrsValues": set(), "maxQtrs": None}
    )
    for tag, version, qtrs, physical, accessions, entities, payloads, first_at, last_at in rows:
        if qtrs not in (0, 1, 2, 3, 4):
            excluded_durations[tag]["physicalRows"] += physical
            excluded_durations[tag]["qtrsValues"].add(qtrs)
            current_max = excluded_durations[tag]["maxQtrs"]
            excluded_durations[tag]["maxQtrs"] = qtrs if current_max is None else max(current_max, qtrs)
            continue
        evidence[tag].append(
            {
                "taxonomyVersion": version,
                "qtrs": qtrs,
                "periodKind": period_kind(qtrs),
                "physicalRowsAcrossPayloadVersions": physical,
                "distinctAccessions": accessions,
                "distinctEntities": entities,
                "sourcePayloads": payloads,
                "firstAcceptedEpoch": first_at,
                "lastAcceptedEpoch": last_at,
            }
        )

    roles: dict[str, Any] = {}
    unresolved: list[dict[str, Any]] = []
    for role_name, contract in CONCEPT_ROLES.items():
        candidates = []
        supported_kinds: set[str] = set()
        for priority, tag in enumerate(contract["conceptPriority"]):
            tag_rows = evidence.get(tag, [])
            supported_kinds.update(row["periodKind"] for row in tag_rows)
            candidates.append(
                {
                    "priority": priority,
                    "tag": tag,
                    "observed": bool(tag_rows),
                    "coverage": tag_rows,
                }
            )
        observed_qtrs = sorted({row["qtrs"] for tag in contract["conceptPriority"] for row in evidence.get(tag, [])})
        missing_qtrs = [qtrs for qtrs in contract["requiredQtrs"] if qtrs not in observed_qtrs]
        status = "COVERED_UNDER_FROZEN_MAP" if not missing_qtrs else "GAP"
        roles[role_name] = {
            "status": status,
            "requiredQtrs": contract["requiredQtrs"],
            "observedQtrs": observed_qtrs,
            "observedPeriodKinds": sorted(supported_kinds),
            "destinationFields": contract["destinationFields"],
            "derivations": contract["derivations"],
            "candidates": candidates,
            "contractSource": "research/early-detection-v4/sec-concept-map-1.0.0.json",
        }
        if missing_qtrs:
            unresolved.append({"role": role_name, "missingQtrs": missing_qtrs})

    payload_manifest = [
        {"payloadSha256": sha, "quarter": quarter, "observedAt": observed_at}
        for sha, quarter, observed_at in payload_rows
    ]
    report: dict[str, Any] = {
        "schema": SCHEMA,
        "verdict": "COVERAGE_PASS_MAP_FROZEN_PERIOD_EXTENSION_PENDING" if not unresolved else "COVERAGE_GAPS_UNDER_FROZEN_MAP",
        "scope": {
            "database": str(database.expanduser().resolve()),
            "databaseBytes": database.expanduser().resolve().stat().st_size,
            "payloads": len(payload_rows),
            "quarters": sorted({row[1] for row in payload_rows}),
            "payloadManifestSha256": canonical_sha256(payload_manifest),
        },
        "roles": roles,
        "unresolvedCoverage": unresolved,
        "conceptMap": {
            "version": CONCEPT_MAP["version"],
            "status": CONCEPT_MAP["status"],
            "path": str(CONCEPT_MAP_PATH),
            "fileSha256": hashlib.sha256(CONCEPT_MAP_PATH.read_bytes()).hexdigest(),
        },
        "excludedNonTargetDurations": {
            tag: {
                "physicalRows": summary["physicalRows"],
                "distinctQtrsValues": len(summary["qtrsValues"]),
                "maxQtrs": summary["maxQtrs"],
                "reason": "GQS input contract uses instant, one-quarter and four-quarter facts only",
            }
            for tag, summary in sorted(excluded_durations.items())
        },
        "limitations": [
            "Coverage proves only that every frozen role/qtrs candidate exists somewhere; entity-level completeness is measured separately.",
            "Repeated physical rows across archived source versions are retained; accession and entity counts are de-duplicated.",
            "The map is frozen before growth-outcome materialization; full 2009-2024 coverage and an independent semantic audit remain gates.",
            "Historical GQS routing is a separate gate because SEC FSD carries SIC, not the production Yahoo sector/industry labels.",
        ],
        "conceptContractSha256": canonical_sha256(CONCEPT_ROLES),
    }
    report["reportSha256"] = canonical_sha256(report)
    return report


def write_json(path: Path, value: Any) -> None:
    resolved = path.expanduser().resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    resolved.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as folder:
        database = Path(folder) / "fixture.sqlite"
        connection = sqlite3.connect(database)
        connection.executescript(
            """
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            INSERT INTO meta VALUES('schema','early-detection-pit-compact-sqlite/v1');
            CREATE TABLE source_payloads(payload_id INTEGER PRIMARY KEY,payload_sha256 TEXT,quarter TEXT,observed_at TEXT);
            CREATE TABLE concepts(concept_id INTEGER PRIMARY KEY,tag TEXT,version TEXT);
            CREATE TABLE submissions(submission_id INTEGER PRIMARY KEY,adsh TEXT,cik INTEGER,form TEXT,accepted_at_epoch INTEGER);
            CREATE TABLE facts(payload_id INTEGER,row_number INTEGER,submission_id INTEGER,concept_id INTEGER,qtrs INTEGER,value_text TEXT);
            INSERT INTO source_payloads VALUES(1,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2020q1','2020-05-01T00:00:00Z');
            """
        )
        concept_id = 0
        for tag in sorted({tag for role in CONCEPT_ROLES.values() for tag in role["conceptPriority"]}):
            concept_id += 1
            connection.execute("INSERT INTO concepts VALUES(?,?,?)", (concept_id, tag, "us-gaap/2020"))
        connection.execute("INSERT INTO submissions VALUES(1,'0001-20-000001',1,'10-K',1588291200)")
        row_number = 0
        tag_to_id = {row[1]: row[0] for row in connection.execute("SELECT concept_id,tag FROM concepts")}
        for role in CONCEPT_ROLES.values():
            tag = role["conceptPriority"][0]
            for qtrs in role["requiredQtrs"]:
                row_number += 1
                connection.execute("INSERT INTO facts VALUES(?,?,?,?,?,?)", (1, row_number, 1, tag_to_id[tag], qtrs, "1"))
        connection.commit()
        connection.close()
        result = audit(database)
        repeated = audit(database)
        if result["verdict"] != "COVERAGE_PASS_MAP_FROZEN_PERIOD_EXTENSION_PENDING":
            raise ConceptAuditError("self-test fixture did not cover every role")
        if result["reportSha256"] != repeated["reportSha256"]:
            raise ConceptAuditError("self-test report hash is not deterministic")
        return {"status": "PASS", "roles": len(result["roles"]), "reportSha256": result["reportSha256"], "deterministic": True}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    audit_parser = subparsers.add_parser("audit")
    audit_parser.add_argument("--database", required=True, type=Path)
    audit_parser.add_argument("--output", required=True, type=Path)
    subparsers.add_parser("self-test")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "self-test":
        print(json.dumps(self_test(), ensure_ascii=False, indent=2))
        return 0
    result = audit(args.database)
    write_json(args.output, result)
    print(json.dumps({"verdict": result["verdict"], "output": str(args.output.resolve()), "reportSha256": result["reportSha256"]}, indent=2))
    return 0 if result["verdict"] == "COVERAGE_PASS_MAP_FROZEN_PERIOD_EXTENSION_PENDING" else 2


if __name__ == "__main__":
    raise SystemExit(main())
