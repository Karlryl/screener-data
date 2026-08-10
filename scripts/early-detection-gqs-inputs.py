#!/usr/bin/env python3
"""Materialize point-in-time SEC-only input snapshots for a GQS shadow replay.

The output can exercise the unchanged GQS engine, but it is not a production
reconstruction: historical Yahoo industry labels, prices, market caps and
analyst revisions are unavailable.  Ambiguous SIC routes fail closed.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sqlite3
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


SCHEMA = "early-detection-sec-gqs-input-bundle/v1"
CONCEPT_MAP_PATH = Path(__file__).resolve().parents[1] / "research" / "early-detection-v4" / "sec-concept-map-1.0.0.json"


class GqsInputError(RuntimeError):
    """The SEC-only GQS input contract could not be satisfied."""


def load_concept_map() -> dict[str, Any]:
    try:
        value = json.loads(CONCEPT_MAP_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GqsInputError(f"cannot load frozen concept map: {CONCEPT_MAP_PATH}") from exc
    if value.get("schema") != "early-detection-sec-concept-map/v1" or value.get("version") != "FEM-SEC-CONCEPT-MAP@1.0.0":
        raise GqsInputError("frozen concept map identity changed")
    return value


CONCEPT_MAP = load_concept_map()
ROLE_CONCEPTS: dict[str, list[str]] = {
    role: contract["conceptPriority"] for role, contract in CONCEPT_MAP["roles"].items()
}


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def verify_bundle_file(input_path: Path) -> dict[str, Any]:
    """Verify the producer-owned canonical hash without crossing JSON runtimes.

    Python deliberately owns this contract because JSON numbers such as 1.0 are
    serialized differently by Python and JavaScript.  Consumers also record the
    exact file-byte hash, so a verified bundle remains tied to one immutable
    artifact without weakening the embedded semantic hash.
    """
    resolved = input_path.expanduser().resolve()
    raw = resolved.read_bytes()
    try:
        bundle = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise GqsInputError(f"input is not valid UTF-8 JSON: {resolved}") from exc
    if bundle.get("schema") != SCHEMA or bundle.get("protocol") != "GQS-00@1.0.0":
        raise GqsInputError("input is not a SEC GQS input bundle v1")
    claimed = bundle.get("bundleSha256")
    if not isinstance(claimed, str):
        raise GqsInputError("input bundle has no semantic hash")
    unsigned = dict(bundle)
    del unsigned["bundleSha256"]
    actual = canonical_sha256(unsigned)
    if claimed != actual:
        raise GqsInputError(f"input bundle hash mismatch: claimed={claimed} actual={actual}")
    return {
        "status": "PASS",
        "schema": bundle["schema"],
        "protocol": bundle["protocol"],
        "bundleSha256": actual,
        "fileSha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "snapshots": len(bundle.get("snapshots", [])),
        "input": str(resolved),
    }


def load_sic_module() -> ModuleType:
    path = Path(__file__).resolve().with_name("early-detection-sic-routing.py")
    spec = importlib.util.spec_from_file_location("early_detection_sic_routing", path)
    if spec is None or spec.loader is None:
        raise GqsInputError(f"cannot load SIC bridge: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def evaluation_epoch(value: str) -> tuple[int, str]:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise GqsInputError("--as-of must be an ISO timestamp or date") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    parsed = parsed.astimezone(timezone.utc)
    return int(parsed.timestamp()), parsed.isoformat(timespec="seconds").replace("+00:00", "Z")


def finite_number(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def iso_date(value: int) -> str:
    raw = str(value)
    return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"


def date_distance(left: int, right: int) -> int:
    a = datetime.strptime(str(left), "%Y%m%d")
    b = datetime.strptime(str(right), "%Y%m%d")
    return abs((a - b).days)


def selected_payloads(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT payload_id,payload_sha256,quarter,observed_at,source_url
          FROM source_payloads p
         WHERE observed_at_epoch=(
           SELECT MIN(p2.observed_at_epoch) FROM source_payloads p2 WHERE p2.quarter=p.quarter
         )
         ORDER BY quarter,payload_sha256
        """
    ).fetchall()
    # Two different payloads may share a capture second; fail closed rather than silently choose.
    by_quarter: dict[str, list[tuple[Any, ...]]] = defaultdict(list)
    for row in rows:
        by_quarter[row[2]].append(row)
    ambiguous = [quarter for quarter, values in by_quarter.items() if len(values) != 1]
    if ambiguous:
        raise GqsInputError(f"earliest payload selection is ambiguous for: {ambiguous}")
    return [
        {"payloadId": row[0], "payloadSha256": row[1], "quarter": row[2], "observedAt": row[3], "sourceUrl": row[4]}
        for row in rows
    ]


def choose_role(
    entity_facts: dict[str, dict[int, dict[int, dict[str, Any]]]],
    concepts: list[str],
    qtrs: int,
) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for priority, tag in enumerate(concepts):
        for date, row in entity_facts.get(tag, {}).get(qtrs, {}).items():
            current = out.get(date)
            if current is None or priority < current["priority"]:
                out[date] = {**row, "priority": priority}
    return out


def direct_quarters(entity_facts: dict[str, dict[int, dict[int, dict[str, Any]]]], concepts: list[str]) -> dict[int, dict[str, Any]]:
    return choose_role(entity_facts, concepts, 1)


def derived_fourth_quarters(
    entity_facts: dict[str, dict[int, dict[int, dict[str, Any]]]], concepts: list[str]
) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for priority, tag in enumerate(concepts):
        annual = entity_facts.get(tag, {}).get(4, {})
        nine_month = entity_facts.get(tag, {}).get(3, {})
        for annual_date, annual_row in annual.items():
            candidates = [
                (date, row) for date, row in nine_month.items()
                if date < annual_date and 45 <= date_distance(annual_date, date) <= 150
            ]
            if not candidates:
                continue
            prior_date, prior = max(candidates, key=lambda item: item[0])
            value = annual_row["value"] - prior["value"]
            current = out.get(annual_date)
            if current is None or priority < current["priority"]:
                out[annual_date] = {
                    "value": value,
                    "tag": tag,
                    "priority": priority,
                    "acceptedAtEpoch": max(annual_row["acceptedAtEpoch"], prior["acceptedAtEpoch"]),
                    "derivedFrom": [annual_row["adsh"], prior["adsh"]],
                    "derivation": "qtrs4_minus_qtrs3_same_concept",
                }
    return out


def income_statement_quarters(
    entity_facts: dict[str, dict[int, dict[int, dict[str, Any]]]], concepts: list[str]
) -> dict[int, dict[str, Any]]:
    out = direct_quarters(entity_facts, concepts)
    for date, row in derived_fourth_quarters(entity_facts, concepts).items():
        out.setdefault(date, row)
    return out


def cash_flow_quarters(
    entity_facts: dict[str, dict[int, dict[int, dict[str, Any]]]], concepts: list[str]
) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for priority, tag in enumerate(concepts):
        by_qtrs = entity_facts.get(tag, {})
        for qtrs in (1, 2, 3, 4):
            for current_date, current in by_qtrs.get(qtrs, {}).items():
                if qtrs == 1:
                    candidate = {**current, "priority": priority, "derivation": "direct_qtrs1"}
                else:
                    previous = [
                        (date, row) for date, row in by_qtrs.get(qtrs - 1, {}).items()
                        if date < current_date and 45 <= date_distance(current_date, date) <= 150
                    ]
                    if not previous:
                        continue
                    previous_date, prior = max(previous, key=lambda item: item[0])
                    candidate = {
                        "value": current["value"] - prior["value"],
                        "tag": tag,
                        "priority": priority,
                        "acceptedAtEpoch": max(current["acceptedAtEpoch"], prior["acceptedAtEpoch"]),
                        "derivedFrom": [current["adsh"], prior["adsh"]],
                        "derivation": f"qtrs{qtrs}_minus_qtrs{qtrs - 1}_same_concept",
                    }
                existing = out.get(current_date)
                if existing is None or priority < existing["priority"]:
                    out[current_date] = candidate
    return out


def aligned_difference(
    left: dict[int, dict[str, Any]], right: dict[int, dict[str, Any]], absolute_right: bool = True
) -> dict[int, dict[str, Any]]:
    out = {}
    for date in sorted(set(left) & set(right)):
        deduction = abs(right[date]["value"]) if absolute_right else right[date]["value"]
        out[date] = {
            "value": left[date]["value"] - deduction,
            "acceptedAtEpoch": max(left[date]["acceptedAtEpoch"], right[date]["acceptedAtEpoch"]),
            "derivation": "operating_cash_flow_minus_absolute_capex",
        }
    return out


def value_objects(rows: dict[int, dict[str, Any]], limit: int) -> tuple[list[dict[str, Any]], list[str]]:
    dates = sorted(rows, reverse=True)[:limit]
    return ([{"value": rows[date]["value"]} for date in dates], [iso_date(date) for date in dates])


def scalar_values(rows: dict[int, dict[str, Any]], limit: int) -> list[float]:
    return [rows[date]["value"] for date in sorted(rows, reverse=True)[:limit]]


def build_snapshot(entity: dict[str, Any], facts: dict[str, Any], as_of: str, sic_module: ModuleType) -> dict[str, Any]:
    routing = sic_module.route_sic(entity.get("sic"))
    annual_rev = choose_role(facts, ROLE_CONCEPTS["revenue"], 4)
    annual_gp = choose_role(facts, ROLE_CONCEPTS["grossProfit"], 4)
    annual_op = choose_role(facts, ROLE_CONCEPTS["operatingIncome"], 4)
    annual_ni = choose_role(facts, ROLE_CONCEPTS["netIncome"], 4)
    annual_assets = choose_role(facts, ROLE_CONCEPTS["assets"], 0)
    annual_cl = choose_role(facts, ROLE_CONCEPTS["currentLiabilities"], 0)
    annual_sbc = choose_role(facts, ROLE_CONCEPTS["shareBasedCompensation"], 4)
    annual_ocf = choose_role(facts, ROLE_CONCEPTS["operatingCashFlow"], 4)
    annual_capex = choose_role(facts, ROLE_CONCEPTS["capitalExpenditure"], 4)
    annual_fcf = aligned_difference(annual_ocf, annual_capex)

    revenue_q = income_statement_quarters(facts, ROLE_CONCEPTS["revenue"])
    op_q = income_statement_quarters(facts, ROLE_CONCEPTS["operatingIncome"])
    ocf_q = cash_flow_quarters(facts, ROLE_CONCEPTS["operatingCashFlow"])
    capex_q = cash_flow_quarters(facts, ROLE_CONCEPTS["capitalExpenditure"])
    fcf_q = aligned_difference(ocf_q, capex_q)

    annual_rev_values, _ = value_objects(annual_rev, 12)
    annual_gp_values, _ = value_objects(annual_gp, 12)
    annual_op_values, _ = value_objects(annual_op, 12)
    annual_ni_values, _ = value_objects(annual_ni, 12)
    annual_ocf_values, _ = value_objects(annual_ocf, 12)
    annual_fcf_values, _ = value_objects(annual_fcf, 12)
    revenue_q_values, revenue_q_ends = value_objects(revenue_q, 16)
    op_q_values, op_q_ends = value_objects(op_q, 16)

    balance_dates = sorted(set(annual_assets) | set(annual_cl), reverse=True)[:12]
    annual_balance = [
        {
            "totalAssets": annual_assets[date]["value"] if date in annual_assets else None,
            "currentLiabilities": annual_cl[date]["value"] if date in annual_cl else None,
        }
        for date in balance_dates
    ]

    fcf_margin = None
    recent_fcf_dates = sorted(fcf_q, reverse=True)[:4]
    if len(recent_fcf_dates) == 4 and all(date in revenue_q for date in recent_fcf_dates):
        revenue_sum = sum(revenue_q[date]["value"] for date in recent_fcf_dates)
        if revenue_sum > 0:
            fcf_margin = 100 * sum(fcf_q[date]["value"] for date in recent_fcf_dates) / revenue_sum
    gross_margin = None
    aligned_gp_dates = sorted(set(annual_gp) & set(annual_rev), reverse=True)
    if aligned_gp_dates and annual_rev[aligned_gp_dates[0]]["value"] > 0:
        gross_margin = 100 * annual_gp[aligned_gp_dates[0]]["value"] / annual_rev[aligned_gp_dates[0]]["value"]

    sec_dates = sorted(set(annual_op) | set(annual_assets) | set(annual_cl), reverse=True)[:16]
    sec_annual = {
        "annualOpInc": [{"value": annual_op[date]["value"] if date in annual_op else None} for date in sec_dates],
        "annualAssets": [{"value": annual_assets[date]["value"] if date in annual_assets else None} for date in sec_dates],
        "annualCurrentLiabilities": [{"value": annual_cl[date]["value"] if date in annual_cl else None} for date in sec_dates],
    }
    return {
        "meta": {
            "ticker": f"CIK-{entity['cik']}",
            "name": entity["name"],
            "country": "United States",
            "region": "US",
            "asOf": as_of,
            "fetchedAt": as_of,
            "filingDate": as_of,
            "sic": entity.get("sic"),
            "sicRoutingStatus": routing["status"],
            "sicFormulaId": routing["formulaId"],
            "sicRoutingRule": routing["rule"],
            "sicRoutingAmbiguity": routing["ambiguity"],
        },
        "annual": {
            "annualRev": annual_rev_values,
            "annualGP": annual_gp_values,
            "annualOpInc": annual_op_values,
            "annualNetIncome": annual_ni_values,
            "annualFCF": annual_fcf_values,
            "annualOCF": annual_ocf_values,
            "annualSBC": scalar_values(annual_sbc, 12),
            "annualCapex": [-abs(value) for value in scalar_values(annual_capex, 12)],
            "annualBalance": annual_balance,
        },
        "timeseries": {
            "revenueQ": revenue_q_values,
            "revenueQEnds": revenue_q_ends,
            "opIncQ": op_q_values,
            "opIncQEnds": op_q_ends,
        },
        "metrics": {
            "fcfMarginTTM": {"value": fcf_margin},
            "grossMargin": {"value": gross_margin},
        },
        "secAnnual": sec_annual,
        "researchProvenance": {
            "latestAcceptedAtEpoch": entity["latestAcceptedAtEpoch"],
            "source": "SEC_FSD_earliest_archived_quarter_payload",
            "productionEquivalent": False,
        },
    }


def materialize(database: Path, as_of_raw: str) -> dict[str, Any]:
    cutoff_epoch, as_of = evaluation_epoch(as_of_raw)
    resolved = database.expanduser().resolve()
    connection = sqlite3.connect(f"file:{resolved.as_posix()}?mode=ro", uri=True)
    schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
    if schema is None or schema[0] != "early-detection-pit-compact-sqlite/v1":
        raise GqsInputError("database is not a compact PIT v1 ledger")
    payloads = selected_payloads(connection)
    payload_ids = [row["payloadId"] for row in payloads]
    if not payload_ids:
        raise GqsInputError("database contains no selectable source payload")
    all_tags = sorted({tag for tags in ROLE_CONCEPTS.values() for tag in tags})
    payload_marks = ",".join("?" for _ in payload_ids)
    tag_marks = ",".join("?" for _ in all_tags)
    rows = connection.execute(
        f"""
        SELECT s.cik,s.sic,s.name,s.adsh,s.accepted_at_epoch,c.tag,f.ddate,f.qtrs,
               u.uom,f.value_text,f.row_number,f.payload_id
          FROM facts f
          JOIN submissions s ON s.submission_id=f.submission_id
          JOIN concepts c ON c.concept_id=f.concept_id
          JOIN units u ON u.unit_id=f.unit_id
         WHERE f.payload_id IN ({payload_marks})
           AND c.tag IN ({tag_marks})
           AND f.qtrs IN (0,1,2,3,4)
           AND f.coreg IS NULL
           AND u.uom='USD'
           AND f.value_text IS NOT NULL
           AND s.form IN ('10-K','10-K/A','10-Q','10-Q/A')
           AND s.accepted_at_epoch<=?
         ORDER BY s.cik,c.tag,f.qtrs,f.ddate,s.accepted_at_epoch,s.adsh,f.row_number
        """,
        [*payload_ids, *all_tags, cutoff_epoch],
    )

    entities: dict[int, dict[str, Any]] = {}
    facts: dict[int, dict[str, dict[int, dict[int, dict[str, Any]]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(dict))
    )
    relevant_rows = 0
    for cik, sic, name, adsh, accepted_at, tag, date, qtrs, unit, raw_value, row_number, payload_id in rows:
        value = finite_number(raw_value)
        if value is None:
            continue
        relevant_rows += 1
        entity = entities.get(cik)
        if entity is None or accepted_at >= entity["latestAcceptedAtEpoch"]:
            entities[cik] = {
                "cik": str(cik).zfill(10), "sic": sic, "name": name,
                "latestAcceptedAtEpoch": accepted_at,
            }
        current = facts[cik][tag][qtrs].get(date)
        candidate = {
            "value": value, "acceptedAtEpoch": accepted_at, "adsh": adsh,
            "rowNumber": row_number, "payloadId": payload_id, "unit": unit,
        }
        if current is None or (accepted_at, adsh, row_number) >= (
            current["acceptedAtEpoch"], current["adsh"], current["rowNumber"]
        ):
            facts[cik][tag][qtrs][date] = candidate
    connection.close()

    sic_module = load_sic_module()
    snapshots = [build_snapshot(entities[cik], facts[cik], as_of, sic_module) for cik in sorted(entities)]
    routing_counts: dict[str, int] = defaultdict(int)
    for snapshot in snapshots:
        routing_counts[snapshot["meta"]["sicRoutingStatus"]] += 1
    bundle: dict[str, Any] = {
        "schema": SCHEMA,
        "evaluationAt": as_of,
        "protocol": "GQS-00@1.0.0",
        "mode": "SEC_ONLY_SHADOW_NOT_PRODUCTION_RECONSTRUCTION",
        "conceptMap": {
            "version": CONCEPT_MAP["version"],
            "fileSha256": hashlib.sha256(CONCEPT_MAP_PATH.read_bytes()).hexdigest(),
            "status": CONCEPT_MAP["status"],
        },
        "source": {
            "database": str(resolved),
            "databaseBytes": resolved.stat().st_size,
            "selectedPayloadPolicy": "earliest archived payload per SEC FSD quarter",
            "payloadManifest": payloads,
            "payloadManifestSha256": canonical_sha256(payloads),
            "relevantPhysicalRows": relevant_rows,
        },
        "routingCounts": dict(sorted(routing_counts.items())),
        "snapshots": snapshots,
        "limitations": [
            "Historical Yahoo sector and industry labels are replaced only where the SIC bridge is unambiguous.",
            "Historical prices, market caps and analyst revisions are absent.",
            "The archived quarterly FSD payload is extraction evidence; original filing cross-checks remain a separate gate.",
            "Ambiguous SIC routes are retained in the bundle but must fail closed in shadow scoring.",
        ],
    }
    bundle["bundleSha256"] = canonical_sha256(bundle)
    return bundle


def self_test() -> dict[str, Any]:
    facts: dict[str, Any] = defaultdict(lambda: defaultdict(dict))
    def put(tag: str, qtrs: int, date: int, value: float, accession: str) -> None:
        facts[tag][qtrs][date] = {"value": value, "acceptedAtEpoch": date, "adsh": accession, "rowNumber": 1, "payloadId": 1, "unit": "USD"}
    tag = ROLE_CONCEPTS["revenue"][0]
    put(tag, 1, 20200331, 10, "q1")
    put(tag, 1, 20200630, 20, "q2")
    put(tag, 1, 20200930, 30, "q3")
    put(tag, 3, 20200930, 60, "ytd")
    put(tag, 4, 20201231, 100, "fy")
    quarters = income_statement_quarters(facts, ROLE_CONCEPTS["revenue"])
    if quarters[20201231]["value"] != 40:
        raise GqsInputError("Q4 derivation failed")
    ocf = ROLE_CONCEPTS["operatingCashFlow"][0]
    put(ocf, 1, 20200331, 10, "c1")
    put(ocf, 2, 20200630, 25, "c2")
    put(ocf, 3, 20200930, 45, "c3")
    put(ocf, 4, 20201231, 70, "c4")
    cash = cash_flow_quarters(facts, ROLE_CONCEPTS["operatingCashFlow"])
    if [cash[d]["value"] for d in sorted(cash)] != [10, 15, 20, 25]:
        raise GqsInputError("cash-flow quarter derivation failed")
    sample = {
        "schema": SCHEMA,
        "protocol": "GQS-00@1.0.0",
        "snapshots": [{"floatPreservationProbe": 1.0}],
    }
    sample["bundleSha256"] = canonical_sha256(sample)
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "bundle.json"
        path.write_text(json.dumps(sample, separators=(",", ":")) + "\n", encoding="utf-8")
        verification = verify_bundle_file(path)
    return {
        "status": "PASS",
        "q4Revenue": 40,
        "cashFlowQuarters": [10, 15, 20, 25],
        "floatHashVerification": verification["status"],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build")
    build.add_argument("--database", required=True, type=Path)
    build.add_argument("--as-of", required=True)
    build.add_argument("--output", required=True, type=Path)
    verify = sub.add_parser("verify")
    verify.add_argument("--input", required=True, type=Path)
    sub.add_parser("self-test")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "self-test":
        print(json.dumps(self_test(), indent=2))
        return 0
    if args.command == "verify":
        print(json.dumps(verify_bundle_file(args.input), indent=2))
        return 0
    bundle = materialize(args.database, args.as_of)
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({
        "evaluationAt": bundle["evaluationAt"], "snapshots": len(bundle["snapshots"]),
        "routingCounts": bundle["routingCounts"], "bundleSha256": bundle["bundleSha256"],
        "output": str(output),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
