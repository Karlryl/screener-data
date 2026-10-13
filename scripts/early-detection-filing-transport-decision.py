#!/usr/bin/env python3
"""Combine free SEC filing transports without overstating source coverage.

The report reconstructs exact population locator coverage from signed daily
Feed and Oldloads reports, then measures incremental individual Wayback and
Common Crawl coverage on their shared deterministic sample.  Locator presence
never becomes filing-content proof.  Locked outcomes and returns are not read.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sqlite3
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA = "early-detection-filing-transport-decision/v1"
ACCESSION_RE = re.compile(r"^\d{10}-\d{2}-\d{6}$")


class TransportDecisionError(RuntimeError):
    """The combined transport evidence was incomplete or inconsistent."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def load_signed_report(path: Path, expected_schema: str) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    try:
        report = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TransportDecisionError(f"invalid report: {resolved}") from exc
    if report.get("schema") != expected_schema:
        raise TransportDecisionError(
            f"report schema mismatch: {resolved}: {report.get('schema')}"
        )
    unsigned = {key: value for key, value in report.items() if key != "reportSha256"}
    actual = sha256_bytes(canonical_bytes(unsigned))
    if actual != report.get("reportSha256"):
        raise TransportDecisionError(f"report signature failed: {resolved}")
    return report


def load_events(database: Path, from_year: int, to_year: int) -> list[dict[str, Any]]:
    resolved = database.expanduser().resolve()
    connection = sqlite3.connect(f"file:{resolved.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
        if schema is None or schema[0] != "early-detection-sec-corporate-action-candidates/v1":
            raise TransportDecisionError("corporate-action database identity failed")
        rows = connection.execute(
            """SELECT event_id,event_class,form,filed_date,accession
                 FROM events
                WHERE CAST(substr(filed_date,1,4) AS INTEGER) BETWEEN ? AND ?
                ORDER BY event_id""",
            (from_year, to_year),
        ).fetchall()
    finally:
        connection.close()
    events: list[dict[str, Any]] = []
    for row in rows:
        accession = str(row["accession"] or "")
        filed_date = str(row["filed_date"])
        if not ACCESSION_RE.fullmatch(accession):
            raise TransportDecisionError(f"invalid accession at event {row['event_id']}")
        try:
            parsed = datetime.strptime(filed_date, "%Y-%m-%d")
        except ValueError as exc:
            raise TransportDecisionError(f"invalid filed date: {filed_date}") from exc
        events.append({
            "eventId": int(row["event_id"]),
            "eventClass": str(row["event_class"]),
            "form": str(row["form"]),
            "filedDate": filed_date,
            "dateKey": parsed.strftime("%Y%m%d"),
            "year": parsed.year,
            "accession": accession,
        })
    return events


def missing_dates(report: dict[str, Any], from_year: int, to_year: int) -> dict[int, set[str]]:
    annual = report.get("annual")
    if not isinstance(annual, list):
        raise TransportDecisionError("coverage report annual rows are missing")
    rows = {int(item.get("year")): item for item in annual if isinstance(item, dict)}
    expected = set(range(from_year, to_year + 1))
    if set(rows) != expected:
        raise TransportDecisionError("coverage report annual year set changed")
    result: dict[int, set[str]] = {}
    for year in sorted(rows):
        values = rows[year].get("missingEventDays")
        if not isinstance(values, list):
            raise TransportDecisionError(f"missingEventDays absent for {year}")
        dates = {str(value) for value in values}
        if any(not re.fullmatch(rf"{year}\d{{4}}", value) for value in dates):
            raise TransportDecisionError(f"invalid missing date in {year}")
        result[year] = dates
    return result


def locator_state(event: dict[str, Any], missing: dict[int, set[str]]) -> bool:
    return str(event["dateKey"]) not in missing[int(event["year"])]


def wilson_interval(successes: int, trials: int, z: float = 1.959963984540054) -> dict[str, Any]:
    if trials < 0 or successes < 0 or successes > trials:
        raise TransportDecisionError("invalid binomial counts")
    if trials == 0:
        return {"successes": successes, "trials": trials, "rate": None, "low95": None, "high95": None}
    rate = successes / trials
    denominator = 1.0 + (z * z / trials)
    centre = (rate + (z * z / (2.0 * trials))) / denominator
    spread = (
        z * math.sqrt((rate * (1.0 - rate) / trials) + (z * z / (4.0 * trials * trials)))
        / denominator
    )
    return {
        "successes": successes,
        "trials": trials,
        "rate": rate,
        "low95": max(0.0, centre - spread),
        "high95": min(1.0, centre + spread),
        "method": "WILSON_SCORE_95_PERCENT",
    }


def signed_input(path: Path, report: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": str(path.expanduser().resolve()),
        "schema": str(report["schema"]),
        "reportSha256": str(report["reportSha256"]),
    }


def verify_population_claims(
    report: dict[str, Any], events: list[dict[str, Any]], covered: list[bool]
) -> None:
    accessions = {str(event["accession"]) for event in events}
    covered_accessions = {
        str(event["accession"]) for event, state in zip(events, covered) if state
    }
    expected = {
        "events": len(events),
        "uniqueAccessions": len(accessions),
        "coveredEventsByFiledDateLocator": sum(covered),
        "coveredUniqueAccessionsByFiledDateLocator": len(covered_accessions),
    }
    for key, value in expected.items():
        if int(report.get(key, -1)) != value:
            raise TransportDecisionError(
                f"signed source claim could not be reconstructed: {key}: "
                f"report={report.get(key)} reconstructed={value}"
            )


def verify_content_proof(
    path: Path,
    schema: str,
    accepted_status: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    report = load_signed_report(path, schema)
    if report.get("status") != accepted_status:
        raise TransportDecisionError(f"content proof is not accepted: {path}")
    payload = report.get("payload")
    verified = report.get("verified")
    if not isinstance(payload, dict) and isinstance(verified, dict):
        payload = {
            "path": verified.get("payloadPath"),
            "sha256": verified.get("payloadSha256"),
            "bytes": verified.get("payloadBytes"),
        }
    if not isinstance(payload, dict):
        raise TransportDecisionError(f"content proof payload is missing: {path}")
    payload_path = Path(str(payload.get("path", ""))).expanduser().resolve()
    if not payload_path.is_file():
        raise TransportDecisionError(f"content proof raw payload is missing: {payload_path}")
    actual = sha256_bytes(payload_path.read_bytes())
    if actual != payload.get("sha256"):
        raise TransportDecisionError(f"content proof raw payload changed: {payload_path}")
    inspection = report.get("inspection")
    if inspection is None and isinstance(verified, dict):
        inspection = verified.get("inspection")
    if inspection is not None:
        if not isinstance(inspection, dict):
            raise TransportDecisionError(f"content proof inspection malformed: {path}")
        if "statusCounts" in inspection:
            targets = int(inspection.get("targets", report.get("uniqueAccessions", 0)))
            counts = inspection.get("statusCounts", {})
            if int(counts.get("MATCHED_ACCESSION_AND_FORM", 0)) != targets:
                raise TransportDecisionError(f"content proof did not match every target: {path}")
        elif inspection.get("status") != "MATCHED_ACCESSION_AND_FORM":
            raise TransportDecisionError(f"content proof did not match its target: {path}")
    summary = {
        "path": str(path.expanduser().resolve()),
        "schema": schema,
        "status": accepted_status,
        "reportSha256": str(report["reportSha256"]),
        "payloadSha256": str(payload["sha256"]),
        "payloadBytes": int(payload.get("bytes", payload_path.stat().st_size)),
        "targets": (
            int(inspection.get("targets", 1)) if isinstance(inspection, dict) else 1
        ),
    }
    return report, summary


def build_decision(
    events_database: Path,
    feed_report_path: Path,
    oldloads_report_path: Path,
    individual_report_path: Path,
    commoncrawl_report_path: Path,
    feed_proof_path: Path,
    oldloads_proof_path: Path,
    individual_proof_path: Path,
    report_path: Path,
) -> dict[str, Any]:
    feed = load_signed_report(
        feed_report_path, "early-detection-sec-filing-archive-coverage/v1"
    )
    oldloads = load_signed_report(
        oldloads_report_path, "early-detection-sec-oldloads-coverage/v1"
    )
    individual = load_signed_report(
        individual_report_path, "early-detection-sec-filing-individual-coverage/v1"
    )
    commoncrawl = load_signed_report(
        commoncrawl_report_path, "early-detection-commoncrawl-static-sec-filing-coverage/v1"
    )
    from_year = int(feed.get("fromYear", 0))
    to_year = int(feed.get("toYear", 0))
    if (from_year, to_year) != (
        int(oldloads.get("fromYear", -1)), int(oldloads.get("toYear", -1))
    ):
        raise TransportDecisionError("bulk source year ranges differ")
    events = load_events(events_database, from_year, to_year)
    feed_missing = missing_dates(feed, from_year, to_year)
    oldloads_missing = missing_dates(oldloads, from_year, to_year)
    feed_states = [locator_state(event, feed_missing) for event in events]
    oldloads_states = [locator_state(event, oldloads_missing) for event in events]
    verify_population_claims(feed, events, feed_states)
    verify_population_claims(oldloads, events, oldloads_states)

    accession_states: dict[str, list[bool]] = defaultdict(lambda: [False, False])
    by_year: dict[int, dict[str, Any]] = {}
    by_class: dict[str, dict[str, Any]] = {}
    event_counter: Counter[str] = Counter()
    for event, feed_state, oldload_state in zip(events, feed_states, oldloads_states):
        accession = str(event["accession"])
        accession_states[accession][0] |= feed_state
        accession_states[accession][1] |= oldload_state
        key = (
            "BOTH" if feed_state and oldload_state else
            "FEED_ONLY" if feed_state else
            "OLDLOADS_ONLY" if oldload_state else
            "NEITHER"
        )
        event_counter[key] += 1
        for container, group_key in (
            (by_year, int(event["year"])),
            (by_class, str(event["eventClass"])),
        ):
            row = container.setdefault(group_key, {
                "events": 0,
                "feedEvents": 0,
                "oldloadsEvents": 0,
                "unionEvents": 0,
                "accessions": set(),
                "feedAccessions": set(),
                "oldloadsAccessions": set(),
                "unionAccessions": set(),
            })
            row["events"] += 1
            row["feedEvents"] += int(feed_state)
            row["oldloadsEvents"] += int(oldload_state)
            row["unionEvents"] += int(feed_state or oldload_state)
            row["accessions"].add(accession)
            if feed_state:
                row["feedAccessions"].add(accession)
            if oldload_state:
                row["oldloadsAccessions"].add(accession)
            if feed_state or oldload_state:
                row["unionAccessions"].add(accession)

    accession_counter: Counter[str] = Counter()
    for feed_state, oldload_state in accession_states.values():
        key = (
            "BOTH" if feed_state and oldload_state else
            "FEED_ONLY" if feed_state else
            "OLDLOADS_ONLY" if oldload_state else
            "NEITHER"
        )
        accession_counter[key] += 1

    def serialize_groups(groups: dict[Any, dict[str, Any]], key_name: str) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for key in sorted(groups):
            row = groups[key]
            accessions = len(row["accessions"])
            union_accessions = len(row["unionAccessions"])
            result.append({
                key_name: key,
                "events": row["events"],
                "feedEvents": row["feedEvents"],
                "oldloadsEvents": row["oldloadsEvents"],
                "unionEvents": row["unionEvents"],
                "unionEventRate": row["unionEvents"] / row["events"] if row["events"] else None,
                "uniqueAccessions": accessions,
                "feedUniqueAccessions": len(row["feedAccessions"]),
                "oldloadsUniqueAccessions": len(row["oldloadsAccessions"]),
                "unionUniqueAccessions": union_accessions,
                "unionAccessionRate": union_accessions / accessions if accessions else None,
            })
        return result

    individual_rows = individual.get("accessions")
    commoncrawl_rows = commoncrawl.get("accessions")
    if not isinstance(individual_rows, list) or not isinstance(commoncrawl_rows, list):
        raise TransportDecisionError("sample accession rows are missing")
    individual_by_accession = {str(row.get("accession")): row for row in individual_rows}
    commoncrawl_by_accession = {str(row.get("accession")): row for row in commoncrawl_rows}
    if set(individual_by_accession) != set(commoncrawl_by_accession):
        raise TransportDecisionError("Wayback and Common Crawl samples are not aligned")
    events_by_accession: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        events_by_accession[str(event["accession"])].append(event)
    sample_rows: list[dict[str, Any]] = []
    sample_counter: Counter[str] = Counter()
    for accession in sorted(individual_by_accession):
        related = events_by_accession.get(accession)
        if not related:
            raise TransportDecisionError(f"sample accession absent from population: {accession}")
        feed_state = any(locator_state(event, feed_missing) for event in related)
        oldload_state = any(locator_state(event, oldloads_missing) for event in related)
        wayback_status = str(individual_by_accession[accession].get("status"))
        commoncrawl_status = str(commoncrawl_by_accession[accession].get("status"))
        if wayback_status == "QUERY_INCOMPLETE" or commoncrawl_status == "QUERY_INCOMPLETE":
            raise TransportDecisionError("sample contains incomplete archive queries")
        wayback_state = wayback_status == "CAPTURE_FOUND"
        commoncrawl_state = commoncrawl_status == "CAPTURE_FOUND"
        bulk_union = feed_state or oldload_state
        all_union = bulk_union or wayback_state or commoncrawl_state
        sample_counter["BULK_UNION"] += int(bulk_union)
        sample_counter["WAYBACK"] += int(wayback_state)
        sample_counter["WAYBACK_INCREMENTAL"] += int(wayback_state and not bulk_union)
        sample_counter["COMMONCRAWL"] += int(commoncrawl_state)
        sample_counter["COMMONCRAWL_INCREMENTAL"] += int(commoncrawl_state and not (bulk_union or wayback_state))
        sample_counter["ALL_UNION"] += int(all_union)
        sample_rows.append({
            "accession": accession,
            "year": int(individual_by_accession[accession].get("year")),
            "eventClass": str(individual_by_accession[accession].get("eventClass")),
            "feedLocator": feed_state,
            "oldloadsLocator": oldload_state,
            "individualWaybackCapture": wayback_state,
            "commonCrawlCapture": commoncrawl_state,
            "combinedLocatorOrCapture": all_union,
        })
    sample_size = len(sample_rows)

    _, feed_proof = verify_content_proof(
        feed_proof_path,
        "early-detection-sec-filing-archive-sample/v2",
        "SAMPLE_CONTENT_AND_FORMS_VERIFIED",
    )
    _, oldloads_proof = verify_content_proof(
        oldloads_proof_path,
        "early-detection-sec-oldloads-sample/v2",
        "SAMPLE_CONTENT_AND_FORMS_VERIFIED",
    )
    individual_proof_report, individual_proof = verify_content_proof(
        individual_proof_path,
        "early-detection-sec-individual-filing-sample/v2",
        "INDIVIDUAL_FILING_SAMPLE_VERIFIED",
    )
    individual_proof["targets"] = 1
    individual_proof["accession"] = str(individual_proof_report.get("verified", {}).get("accession", ""))

    event_union = event_counter["BOTH"] + event_counter["FEED_ONLY"] + event_counter["OLDLOADS_ONLY"]
    accession_union = accession_counter["BOTH"] + accession_counter["FEED_ONLY"] + accession_counter["OLDLOADS_ONLY"]
    unsigned = {
        "schema": SCHEMA,
        "generatedAt": utc_now(),
        "status": "PARTIAL_FREE_TRANSPORT_WITH_POPULATION_LOCATOR_UNION",
        "decision": "USABLE_FOR_EVIDENCE_ACQUISITION_NOT_POPULATION_CONTENT_COMPLETE",
        "eventsDatabase": str(events_database.expanduser().resolve()),
        "fromYear": from_year,
        "toYear": to_year,
        "inputEvidence": [
            signed_input(feed_report_path, feed),
            signed_input(oldloads_report_path, oldloads),
            signed_input(individual_report_path, individual),
            signed_input(commoncrawl_report_path, commoncrawl),
        ],
        "population": {
            "events": len(events),
            "uniqueAccessions": len(accession_states),
            "eventLocatorStates": {
                "both": event_counter["BOTH"],
                "feedOnly": event_counter["FEED_ONLY"],
                "oldloadsOnly": event_counter["OLDLOADS_ONLY"],
                "neither": event_counter["NEITHER"],
                "union": event_union,
                "unionRate": event_union / len(events) if events else None,
            },
            "accessionLocatorStates": {
                "both": accession_counter["BOTH"],
                "feedOnly": accession_counter["FEED_ONLY"],
                "oldloadsOnly": accession_counter["OLDLOADS_ONLY"],
                "neither": accession_counter["NEITHER"],
                "union": accession_union,
                "unionRate": accession_union / len(accession_states) if accession_states else None,
            },
            "byYear": serialize_groups(by_year, "year"),
            "byEventClass": serialize_groups(by_class, "eventClass"),
        },
        "sharedDeterministicSample": {
            "sampledAccessions": sample_size,
            "bulkLocatorUnion": wilson_interval(sample_counter["BULK_UNION"], sample_size),
            "individualWaybackCapture": wilson_interval(sample_counter["WAYBACK"], sample_size),
            "individualWaybackIncrementalOverBulk": wilson_interval(
                sample_counter["WAYBACK_INCREMENTAL"], sample_size
            ),
            "commonCrawlCapture": wilson_interval(sample_counter["COMMONCRAWL"], sample_size),
            "commonCrawlIncremental": wilson_interval(
                sample_counter["COMMONCRAWL_INCREMENTAL"], sample_size
            ),
            "allLocatorOrCaptureUnion": wilson_interval(sample_counter["ALL_UNION"], sample_size),
            "accessions": sample_rows,
        },
        "byteLevelContentProofs": [feed_proof, oldloads_proof, individual_proof],
        "resourcePlanning": {
            "feedSelectedCaptureWarcRecordBytes": int(feed["selectedCaptureWarcRecordBytes"]),
            "oldloadsSelectedCaptureWarcRecordBytes": int(oldloads["selectedCaptureWarcRecordBytes"]),
            "naiveBothSourcesWarcRecordBytes": (
                int(feed["selectedCaptureWarcRecordBytes"])
                + int(oldloads["selectedCaptureWarcRecordBytes"])
            ),
            "warning": (
                "CDX WARC record sizes are not replay-payload guarantees and overlapping dates "
                "must not be downloaded twice in a minimal acquisition plan."
            ),
        },
        "remainingGap": {
            "eventRowsWithoutBulkLocator": event_counter["NEITHER"],
            "uniqueAccessionsWithoutBulkLocator": accession_counter["NEITHER"],
            "populationIndividualWaybackCoverageKnown": False,
            "directOfficialSecArchiveRuntimeStatus": "HTTP_403_IN_CURRENT_RUNTIME_PROBE",
            "directOfficialSecArchiveCanonicalAndFree": True,
            "fallback": [
                "Use direct official SEC accession URLs when fair-access blocking clears.",
                "Use deterministic per-accession Wayback retrieval for high-priority unresolved cases.",
                "Retain master-index events as candidates but never impute missing filing content or effective dates.",
            ],
        },
        "interpretation": [
            "Feed and Oldloads complement each other materially; neither alone is population-complete.",
            "The exact bulk locator union is population evidence, but locator presence is not content proof.",
            "The shared sample estimates archive discovery only and is not used to inflate population counts.",
            "Three byte-level samples prove transports and parsers, not all filings.",
            "The unresolved population remains excluded from content-dependent labels until acquired.",
            "No locked outcome, return or confirmatory statistic was accessed.",
        ],
        "confirmatoryEligible": False,
        "productiveGqsModified": False,
    }
    report = {**unsigned, "reportSha256": sha256_bytes(canonical_bytes(unsigned))}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report


def self_test() -> dict[str, Any]:
    def signed(value: dict[str, Any]) -> dict[str, Any]:
        return {**value, "reportSha256": sha256_bytes(canonical_bytes(value))}

    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        database = root / "events.sqlite"
        connection = sqlite3.connect(database)
        connection.executescript("""
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            INSERT INTO meta VALUES('schema','early-detection-sec-corporate-action-candidates/v1');
            CREATE TABLE events(event_id INTEGER PRIMARY KEY,event_class TEXT,form TEXT,filed_date TEXT,accession TEXT);
            INSERT INTO events VALUES(1,'A','25','2020-01-02','0000000000-20-000001');
            INSERT INTO events VALUES(2,'B','15','2020-01-03','0000000000-20-000002');
            INSERT INTO events VALUES(3,'B','15','2020-01-04','0000000000-20-000003');
        """)
        connection.commit()
        connection.close()
        feed_unsigned = {
            "schema": "early-detection-sec-filing-archive-coverage/v1",
            "fromYear": 2020, "toYear": 2020, "events": 3, "uniqueAccessions": 3,
            "coveredEventsByFiledDateLocator": 1, "coveredUniqueAccessionsByFiledDateLocator": 1,
            "selectedCaptureWarcRecordBytes": 100,
            "annual": [{"year": 2020, "missingEventDays": ["20200103", "20200104"]}],
        }
        old_unsigned = {
            "schema": "early-detection-sec-oldloads-coverage/v1",
            "fromYear": 2020, "toYear": 2020, "events": 3, "uniqueAccessions": 3,
            "coveredEventsByFiledDateLocator": 1, "coveredUniqueAccessionsByFiledDateLocator": 1,
            "selectedCaptureWarcRecordBytes": 90,
            "annual": [{"year": 2020, "missingEventDays": ["20200102", "20200104"]}],
        }
        sample_rows = [
            {"accession": "0000000000-20-000001", "year": 2020, "eventClass": "A", "status": "NO_CAPTURE"},
            {"accession": "0000000000-20-000002", "year": 2020, "eventClass": "B", "status": "NO_CAPTURE"},
            {"accession": "0000000000-20-000003", "year": 2020, "eventClass": "B", "status": "CAPTURE_FOUND"},
        ]
        individual_unsigned = {
            "schema": "early-detection-sec-filing-individual-coverage/v1",
            "accessions": sample_rows,
        }
        commoncrawl_unsigned = {
            "schema": "early-detection-commoncrawl-static-sec-filing-coverage/v1",
            "accessions": [{**row, "status": "NO_CAPTURE"} for row in sample_rows],
        }
        paths: dict[str, Path] = {}
        for name, value in (
            ("feed", signed(feed_unsigned)),
            ("old", signed(old_unsigned)),
            ("individual", signed(individual_unsigned)),
            ("cc", signed(commoncrawl_unsigned)),
        ):
            path = root / f"{name}.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            paths[name] = path
        payload = root / "payload.bin"
        payload.write_bytes(b"verified")
        payload_data = {"sha256": sha256_bytes(b"verified"), "bytes": 8, "path": str(payload)}
        proofs = [
            (
                "feed-proof", "early-detection-sec-filing-archive-sample/v2",
                "SAMPLE_CONTENT_AND_FORMS_VERIFIED", 1,
            ),
            (
                "old-proof", "early-detection-sec-oldloads-sample/v2",
                "SAMPLE_CONTENT_AND_FORMS_VERIFIED", 1,
            ),
            (
                "individual-proof", "early-detection-sec-individual-filing-sample/v2",
                "INDIVIDUAL_FILING_SAMPLE_VERIFIED", None,
            ),
        ]
        proof_paths: list[Path] = []
        for name, schema, status, targets in proofs:
            value: dict[str, Any] = {
                "schema": schema, "status": status, "payload": payload_data,
            }
            if targets is not None:
                value["inspection"] = {
                    "targets": targets,
                    "statusCounts": {"MATCHED_ACCESSION_AND_FORM": targets},
                }
            else:
                value.pop("payload")
                value["verified"] = {
                    "accession": "0000000000-20-000003",
                    "payloadPath": str(payload),
                    "payloadSha256": sha256_bytes(b"verified"),
                    "payloadBytes": 8,
                    "inspection": {"status": "MATCHED_ACCESSION_AND_FORM"},
                }
            path = root / f"{name}.json"
            path.write_text(json.dumps(signed(value)), encoding="utf-8")
            proof_paths.append(path)
        result = build_decision(
            database, paths["feed"], paths["old"], paths["individual"], paths["cc"],
            proof_paths[0], proof_paths[1], proof_paths[2], root / "decision.json",
        )
        if result["population"]["eventLocatorStates"] != {
            "both": 0, "feedOnly": 1, "oldloadsOnly": 1, "neither": 1,
            "union": 2, "unionRate": 2 / 3,
        }:
            raise TransportDecisionError("self-test population union failed")
        if result["sharedDeterministicSample"]["allLocatorOrCaptureUnion"]["successes"] != 3:
            raise TransportDecisionError("self-test sample incremental union failed")
        tampered = json.loads(paths["feed"].read_text(encoding="utf-8"))
        tampered["events"] = 9
        paths["feed"].write_text(json.dumps(tampered), encoding="utf-8")
        signature_rejected = False
        try:
            load_signed_report(paths["feed"], "early-detection-sec-filing-archive-coverage/v1")
        except TransportDecisionError:
            signature_rejected = True
        if not signature_rejected:
            raise TransportDecisionError("self-test tampered signature was accepted")
    interval = wilson_interval(5, 32)
    if not (0 < interval["low95"] < interval["rate"] < interval["high95"] < 1):
        raise TransportDecisionError("self-test Wilson interval failed")
    return {
        "status": "PASS",
        "signedInputsVerified": True,
        "populationUnionVerified": True,
        "incrementalSampleVerified": True,
        "contentPayloadHashesVerified": True,
        "wilsonIntervalVerified": True,
        "tamperedInputRejected": True,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    sub = value.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build")
    build.add_argument("--events-database", type=Path, required=True)
    build.add_argument("--feed-report", type=Path, required=True)
    build.add_argument("--oldloads-report", type=Path, required=True)
    build.add_argument("--individual-report", type=Path, required=True)
    build.add_argument("--commoncrawl-report", type=Path, required=True)
    build.add_argument("--feed-proof", type=Path, required=True)
    build.add_argument("--oldloads-proof", type=Path, required=True)
    build.add_argument("--individual-proof", type=Path, required=True)
    build.add_argument("--report", type=Path, required=True)
    sub.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "build":
            result = build_decision(
                args.events_database, args.feed_report, args.oldloads_report,
                args.individual_report, args.commoncrawl_report,
                args.feed_proof, args.oldloads_proof, args.individual_proof,
                args.report,
            )
        else:
            result = self_test()
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (TransportDecisionError, OSError, ValueError, sqlite3.Error) as exc:
        print(json.dumps({
            "status": "FAIL", "error": f"{type(exc).__name__}: {exc}"
        }, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
