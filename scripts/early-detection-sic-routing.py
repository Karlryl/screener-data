#!/usr/bin/env python3
"""Build and audit a provisional SEC-SIC to GQS research-routing bridge.

The production router consumes Yahoo sector and industry labels.  SEC FSD only
contains SIC.  This bridge therefore never claims production equivalence: it
routes unambiguous SICs, excludes structurally unsupported groups, and marks
codes that require filing-level subtype evidence as ambiguous.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


SCHEMA = "early-detection-sic-routing-audit/v1"


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def result(status: str, formula_id: str | None, rule: str, ambiguity: str | None = None) -> dict[str, Any]:
    return {"status": status, "formulaId": formula_id, "rule": rule, "ambiguity": ambiguity}


def route_sic(sic: int | None) -> dict[str, Any]:
    if sic is None:
        return result("UNRESOLVED", None, "missing_sic", "SEC submission has no SIC")

    # Structural exclusions in the production router or the historical universe contract.
    if sic == 6770:
        return result("EXCLUDE", None, "blank_check_company")
    if 6720 <= sic <= 6739:
        return result("EXCLUDE", None, "investment_company_or_trust")
    if 6010 <= sic <= 6099:
        return result("EXCLUDE", None, "balance_sheet_bank")
    if sic in {6141, 6153, 6159, 6162, 6163}:
        return result("EXCLUDE", None, "lending_business")
    if 6310 <= sic <= 6399:
        return result("EXCLUDE", None, "insurer")
    if sic in {4812, 4813, 4822}:
        return result("EXCLUDE", None, "telecom")
    if sic in {9995, 8888, 9721}:
        return result("EXCLUDE", None, "non_operating_or_government")

    # Exact technology and health-care carve-outs precede broad manufacturing ranges.
    if sic == 3674:
        return result("ROUTE", "semiconductors", "sic_semiconductors")
    if sic in {3570, 3571, 3572, 3575, 3576, 3577, 3578, 3651, 3661, 3663, 3669, 3670, 3672, 3677, 3678, 3679}:
        return result("ROUTE", "tech-hardware", "sic_technology_hardware")
    if sic in {7373, 7374, 7376, 7377, 7378}:
        return result("ROUTE", "it-services", "sic_it_services")
    if sic in {7370, 7371, 7372, 7375, 7379}:
        return result("ROUTE", "software-comm-services", "sic_software")
    if 2833 <= sic <= 2836 or 3841 <= sic <= 3845 or sic in {3851, 5047, 8071, 8082, 8090, 8093}:
        return result("ROUTE", "health-care", "sic_health_care")

    # Financial and real-estate groups need explicit handling because their SIC division overlaps.
    if 6500 <= sic <= 6553:
        return result("ROUTE", "real-estate", "sic_real_estate")
    if sic == 6798:
        return result(
            "AMBIGUOUS_ROUTE", "real-estate", "sic_reit",
            "SIC does not separate equity REITs from mortgage REITs, which production excludes",
        )
    if sic in {6794, 6799}:
        return result(
            "AMBIGUOUS_ROUTE", "financials", "sic_investors_nec",
            "filing evidence is required to separate operating managers from non-operating vehicles",
        )
    if 6100 <= sic <= 6299 or sic == 6411:
        return result("ROUTE", "financials", "sic_nonbank_financial")

    # Utilities versus environmental/transport services.
    if sic in {4950, 4953, 4955}:
        return result("ROUTE", "industrials", "sic_environmental_services")
    if 4900 <= sic <= 4991:
        return result("ROUTE", "utilities", "sic_utilities")

    # Energy and raw-material value chains.
    if 1200 <= sic <= 1399 or sic in {2911, 2950, 2990, 3533}:
        return result("ROUTE", "energy", "sic_energy")
    if (
        1000 <= sic <= 1199
        or 1400 <= sic <= 1499
        or 2400 <= sic <= 2499
        or 2600 <= sic <= 2699
        or 2800 <= sic <= 2899
        or 3050 <= sic <= 3099
        or 3200 <= sic <= 3399
    ):
        return result("ROUTE", "materials", "sic_materials")

    # Consumer staples: food, beverage, tobacco, household/personal products and grocery trade.
    if (
        100 <= sic <= 999
        or 2000 <= sic <= 2199
        or sic in {2840, 2842, 2844, 5141, 5149, 5150, 5411, 5421, 5431, 5441, 5451, 5461, 5499}
    ):
        return result("ROUTE", "consumer-staples", "sic_consumer_staples")

    # Communication/media belongs to the existing combined software/communication cohort.
    if sic in {2711, 2721, 2731, 2741, 4832, 4833, 4841, 4899, 7310, 7311, 7812, 7822, 7830, 7841}:
        return result("ROUTE", "software-comm-services", "sic_media_communication")

    # Consumer discretionary goods, retail, education, lodging, restaurants and leisure.
    if (
        2200 <= sic <= 2399
        or 2500 <= sic <= 2599
        or sic in {3011, 3021, 3140, 3630, 3634, 3711, 3714, 3751, 3931, 3942, 3944, 3949, 5010, 5013, 5020, 5094}
        or 5200 <= sic <= 5999
        or sic in {7011, 7200, 7800, 7900, 7990, 8200, 8351}
    ):
        return result("ROUTE", "consumer-discretionary", "sic_consumer_discretionary")

    # Broad operating industries and business services.
    if (
        1500 <= sic <= 1799
        or 3400 <= sic <= 3999
        or 4000 <= sic <= 4799
        or 5000 <= sic <= 5199
        or 7000 <= sic <= 8999
    ):
        ambiguity = None
        status = "ROUTE"
        if sic in {7389, 8731, 8742, 8900}:
            status = "AMBIGUOUS_ROUTE"
            ambiguity = "broad SIC may span more than one production Yahoo industry route"
        return result(status, "industrials", "sic_industrials_and_services", ambiguity)

    return result("UNRESOLVED", None, "unmapped_sic", "no defensible GQS bridge rule")


def audit(database: Path) -> dict[str, Any]:
    resolved = database.expanduser().resolve()
    connection = sqlite3.connect(f"file:{resolved.as_posix()}?mode=ro", uri=True)
    schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
    if schema is None or schema[0] != "early-detection-pit-compact-sqlite/v1":
        raise RuntimeError("database is not a compact PIT v1 ledger")
    rows = connection.execute(
        """
        WITH latest AS (
          SELECT cik,MAX(accepted_at_epoch) AS accepted_at_epoch
            FROM submissions GROUP BY cik
        )
        SELECT s.cik,s.sic,s.name,s.accepted_at_epoch
          FROM submissions s JOIN latest l
            ON l.cik=s.cik AND l.accepted_at_epoch=s.accepted_at_epoch
         GROUP BY s.cik,s.sic,s.name,s.accepted_at_epoch
        """
    ).fetchall()
    payload_manifest = connection.execute(
        "SELECT payload_sha256,quarter,observed_at FROM source_payloads ORDER BY quarter,observed_at,payload_sha256"
    ).fetchall()
    connection.close()

    by_status: Counter[str] = Counter()
    by_formula: Counter[str] = Counter()
    by_sic: dict[tuple[int | None, str, str | None, str], dict[str, Any]] = {}
    for cik, sic, name, accepted_at in rows:
        routed = route_sic(sic)
        by_status[routed["status"]] += 1
        if routed["formulaId"]:
            by_formula[routed["formulaId"]] += 1
        key = (sic, routed["status"], routed["formulaId"], routed["rule"])
        entry = by_sic.setdefault(
            key,
            {
                "sic": sic,
                "status": routed["status"],
                "formulaId": routed["formulaId"],
                "rule": routed["rule"],
                "ambiguity": routed["ambiguity"],
                "entities": 0,
                "examples": [],
            },
        )
        entry["entities"] += 1
        if len(entry["examples"]) < 3:
            entry["examples"].append({"cik": str(cik).zfill(10), "name": name, "acceptedAtEpoch": accepted_at})

    total = len(rows)
    exact = by_status["ROUTE"] + by_status["EXCLUDE"]
    report: dict[str, Any] = {
        "schema": SCHEMA,
        "verdict": "CANDIDATE_BRIDGE_NOT_PRODUCTION_EQUIVALENT",
        "scope": {
            "database": str(resolved),
            "databaseBytes": resolved.stat().st_size,
            "entities": total,
            "payloadManifestSha256": canonical_sha256(payload_manifest),
        },
        "coverage": {
            "byStatus": dict(sorted(by_status.items())),
            "byFormula": dict(sorted(by_formula.items())),
            "exactRouteOrExcludeRate": exact / total if total else 0,
            "ambiguousOrUnresolvedRate": (by_status["AMBIGUOUS_ROUTE"] + by_status["UNRESOLVED"]) / total if total else 0,
        },
        "sicBreakdown": sorted(by_sic.values(), key=lambda row: (-row["entities"], row["sic"] or -1)),
        "limitations": [
            "SEC SIC is not Yahoo sector/industry and cannot reproduce the production router by itself.",
            "AMBIGUOUS_ROUTE observations require filing-level business-model evidence before confirmatory use.",
            "Validation against current production snapshots and a later full-period SEC ledger remains mandatory.",
            "This bridge changes no production scoring or routing file.",
        ],
        "routingContractSha256": canonical_sha256({str(code): route_sic(code) for code in range(10000)}),
    }
    report["reportSha256"] = canonical_sha256(report)
    return report


def self_test() -> dict[str, Any]:
    expected = {
        3674: ("ROUTE", "semiconductors"),
        7372: ("ROUTE", "software-comm-services"),
        7373: ("ROUTE", "it-services"),
        2834: ("ROUTE", "health-care"),
        6022: ("EXCLUDE", None),
        6221: ("ROUTE", "financials"),
        6798: ("AMBIGUOUS_ROUTE", "real-estate"),
        6770: ("EXCLUDE", None),
        1311: ("ROUTE", "energy"),
        4911: ("ROUTE", "utilities"),
        5812: ("ROUTE", "consumer-discretionary"),
        2080: ("ROUTE", "consumer-staples"),
        8200: ("ROUTE", "consumer-discretionary"),
    }
    for sic, pair in expected.items():
        actual = route_sic(sic)
        if (actual["status"], actual["formulaId"]) != pair:
            raise RuntimeError(f"SIC self-test failed for {sic}: {actual}")
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "fixture.sqlite"
        connection = sqlite3.connect(path)
        connection.executescript(
            """
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
            INSERT INTO meta VALUES('schema','early-detection-pit-compact-sqlite/v1');
            CREATE TABLE submissions(cik INTEGER,sic INTEGER,name TEXT,accepted_at_epoch INTEGER);
            CREATE TABLE source_payloads(payload_sha256 TEXT,quarter TEXT,observed_at TEXT);
            INSERT INTO source_payloads VALUES('a','2020q1','2020-05-01T00:00:00Z');
            INSERT INTO submissions VALUES(1,3674,'Semi',1),(2,6022,'Bank',2),(3,6798,'REIT',3);
            """
        )
        connection.commit()
        connection.close()
        report = audit(path)
        repeated = audit(path)
        if report["scope"]["entities"] != 3:
            raise RuntimeError("fixture entity count mismatch")
        if report["reportSha256"] != repeated["reportSha256"]:
            raise RuntimeError("fixture report hash is not deterministic")
    return {"status": "PASS", "representativeCodes": len(expected), "contractSha256": report["routingContractSha256"], "deterministic": True}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    audit_parser = sub.add_parser("audit")
    audit_parser.add_argument("--database", required=True, type=Path)
    audit_parser.add_argument("--output", required=True, type=Path)
    sub.add_parser("self-test")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "self-test":
        print(json.dumps(self_test(), indent=2))
        return 0
    report = audit(args.database)
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"verdict": report["verdict"], "coverage": report["coverage"], "reportSha256": report["reportSha256"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
