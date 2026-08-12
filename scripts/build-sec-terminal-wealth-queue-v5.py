#!/usr/bin/env python3
"""Build the outcome-blind SEC terminal-wealth retrieval queue, fail closed."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-wealth-queue-contract-v5.json"
SCRIPT = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-terminal-wealth-queue-v5.test.js"
CONTRACT_RAW_SHA256 = "ea9f1c09a5e2e1536513e53677c941ca8ce737b9d867f330b3052e26515e8124"
AUTHORIZED_REMOTE = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_BRANCH = "refs/heads/codex/early-detection-v4-gates-20260810"
REPORT_PATH = "reports/early-detection/sec-corporate-action-candidates-2009-2024.json"
REPORT_RAW_SHA256 = "dd59affea6d5aa3772222ca44317b20aed3b34865984a123044072feac24461c"
REPORT_CANONICAL_SHA256 = "472c8e938dfc8ffae930bb6efcb27e9042d90b11e7090bab427eeefd30bf3c63"
DATABASE_BYTES = 19906560
DATABASE_RAW_SHA256 = "f6662cf6429a26e55d589712543525840b687dd86ebd973425a8fe5836425ed5"
EVENT_SEQUENCE_SHA256 = "e656ab3af95383380c83a9de561b1f39d30b58731cfe824a8f19b72c8b03f40c"
EXPECTED_EVENTS = 44352
EXPECTED_FORM25 = 27285
EXPECTED_FORM15 = 17067
REQUIRED_RESOLUTION_FIELDS = [
    "stableSecurityId", "lastTradingSession", "otcContinuation", "cashConsideration",
    "stockConsideration", "liquidationDistributions", "laterRecoveries", "sourceRefs",
]
PRIORITY_SORT = [
    "HAS_ACCESSION_DESC", "BRIDGE_LINK_COUNT_DESC", "EVENT_CLASS_ASC", "FILED_DATE_ASC",
    "CIK_ASC", "ACCESSION_ASC", "EVENT_ID_ASC",
]
DOCUMENT_CLASSES = {
    "DELISTING_FORM25_CANDIDATE": [
        "FORM_25", "FORM_25_NSE", "FORM_8_K", "DEFM14A", "S_4", "SC_TO",
        "PLAN_OF_LIQUIDATION", "BANKRUPTCY_OR_COURT_PRIMARY",
    ],
    "DEREGISTRATION_FORM15_CANDIDATE": [
        "FORM_15", "FORM_15_12B", "FORM_15_12G", "FORM_15_15D", "FORM_8_K",
        "DEFM14A", "S_4", "SC_TO", "PLAN_OF_LIQUIDATION", "BANKRUPTCY_OR_COURT_PRIMARY",
    ],
}


def fail(message: str) -> None:
    raise ValueError(message)


def exact_keys(value: dict, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} key set changed")


def canonical(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def read_raw(path: Path) -> bytes:
    value = path.read_bytes()
    if value.startswith(b"\xef\xbb\xbf"):
        fail("BOM forbidden")
    return value


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_state(path: Path) -> tuple[int, int]:
    status = path.stat()
    return status.st_size, status.st_mtime_ns


def git_text(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True).stdout.strip()


def git_bytes(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE).stdout


def validate_contract(contract: dict, contract_raw: bytes) -> None:
    if hashlib.sha256(contract_raw).hexdigest() != CONTRACT_RAW_SHA256:
        fail("contract raw SHA differs from authorized builder binding")
    exact_keys(contract, {
        "schema", "createdAt", "taskId", "track", "input", "queueUnit", "documentClasses",
        "priorityInputs", "prioritySort", "authorizedImplementation", "forbiddenPriorityInputs",
        "requiredResolutionFields", "missingPolicy", "claimLocks",
    }, "contract")
    exact_keys(contract["input"], {
        "reportPath", "reportRawSha256", "reportCanonicalSha256", "expectedEvents",
        "expectedForm25Family", "expectedForm15Family", "databaseBytes", "databaseRawSha256",
        "eventSequenceSha256", "databaseSidecarPolicy", "databaseSnapshotPolicy", "databaseOpenMode",
    }, "contract.input")
    exact_keys(contract["authorizedImplementation"], {"builderPath", "testPath"}, "implementation")
    exact_keys(contract["claimLocks"], {
        "terminalWealthComplete", "identityResolved", "originalV4GateCredit",
        "resultComputationAllowed", "outcomesAccessed",
    }, "claimLocks")
    expected_input = {
        "reportPath": REPORT_PATH, "reportRawSha256": REPORT_RAW_SHA256,
        "reportCanonicalSha256": REPORT_CANONICAL_SHA256, "expectedEvents": EXPECTED_EVENTS,
        "expectedForm25Family": EXPECTED_FORM25, "expectedForm15Family": EXPECTED_FORM15,
        "databaseBytes": DATABASE_BYTES, "databaseRawSha256": DATABASE_RAW_SHA256,
        "eventSequenceSha256": EVENT_SEQUENCE_SHA256,
        "databaseSidecarPolicy": "ABSENT_BEFORE_AND_AFTER_COPY",
        "databaseSnapshotPolicy": "PRIVATE_FULLY_HASHED_COPY",
        "databaseOpenMode": "READ_ONLY_IMMUTABLE_PRIVATE_COPY",
    }
    if contract["schema"] != "early-detection-sec-terminal-wealth-queue-contract/v5":
        fail("contract schema changed")
    if contract["taskId"] != "Q003-SEC-TERMINAL-WEALTH-QUEUE" or contract["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("task or track changed")
    if contract["input"] != expected_input:
        fail("authorized input contract changed")
    if contract["queueUnit"] != ["cik", "accession", "eventClass", "filedDate"]:
        fail("queue unit changed")
    if contract["documentClasses"] != DOCUMENT_CLASSES:
        fail("document classes changed")
    if contract["priorityInputs"] != ["eventClass", "filedDate", "hasAccession", "bridgeLinkCount"]:
        fail("priority inputs changed")
    if contract["prioritySort"] != PRIORITY_SORT:
        fail("priority sort changed")
    if contract["authorizedImplementation"] != {
        "builderPath": SCRIPT.relative_to(ROOT).as_posix(), "testPath": TEST.relative_to(ROOT).as_posix(),
    }:
        fail("authorized implementation changed")
    if set(contract["forbiddenPriorityInputs"]) != {"return", "price", "endpointValue", "result", "pValue", "eligibility"}:
        fail("forbidden priority inputs changed")
    if contract["requiredResolutionFields"] != REQUIRED_RESOLUTION_FIELDS:
        fail("required resolution fields changed")
    if contract["missingPolicy"] != "UNRESOLVED_NEVER_ZERO" or any(contract["claimLocks"].values()):
        fail("missingness or claim locks changed")


def require_remote_contract(contract_raw: bytes) -> str:
    if git_text("remote", "get-url", "origin") != AUTHORIZED_REMOTE:
        fail("authorized remote changed")
    rows = git_text("ls-remote", "--refs", AUTHORIZED_REMOTE, AUTHORIZED_BRANCH).splitlines()
    if len(rows) != 1:
        fail("authorized branch did not resolve exactly once")
    remote_head, remote_ref = rows[0].split()
    if remote_ref != AUTHORIZED_BRANCH or git_text("rev-parse", "HEAD") != remote_head:
        fail("local and authorized remote HEAD differ")
    for path, raw in ((CONTRACT, contract_raw), (SCRIPT, read_raw(SCRIPT)), (TEST, read_raw(TEST))):
        if git_bytes("show", f"{remote_head}:{path.relative_to(ROOT).as_posix()}") != raw:
            fail(f"authorized remote blob differs: {path.name}")
    return remote_head


def sidecars(database: Path) -> list[Path]:
    return [Path(str(database) + suffix) for suffix in ("-wal", "-shm", "-journal")]


def require_no_sidecars(database: Path) -> None:
    present = [str(path) for path in sidecars(database) if path.exists()]
    if present:
        fail(f"SQLite sidecar forbidden: {present}")


def database_snapshot(database: Path, expected_bytes: int = DATABASE_BYTES,
                      expected_sha256: str = DATABASE_RAW_SHA256) -> tuple[int, int]:
    require_no_sidecars(database)
    state = file_state(database)
    if state[0] != expected_bytes or file_sha256(database) != expected_sha256:
        fail("database byte binding changed")
    if file_state(database) != state:
        fail("database changed during hash")
    require_no_sidecars(database)
    return state


def sequence_digest(connection: sqlite3.Connection) -> str:
    digest = hashlib.sha256()
    rows = connection.execute("""
      SELECT e.event_id,COALESCE(e.source_observed_at,''),e.source_payload_sha256,e.source_row_number,
             e.event_class,e.cik,e.company_name,e.form,e.filed_date,COALESCE(e.accession,''),e.filing_path,
             CASE WHEN b.ticker IS NULL THEN 0 ELSE 1 END,COALESCE(b.ticker,''),COALESCE(b.first_snapshot,''),COALESCE(b.last_snapshot,''),COALESCE(b.snapshot_count,0)
      FROM events e LEFT JOIN bridge_links b USING(event_id)
      ORDER BY e.filed_date,e.cik,e.form,e.source_payload_sha256,e.source_row_number,e.event_id,
               CASE WHEN b.ticker IS NULL THEN 0 ELSE 1 END,b.ticker
    """)
    for row in rows:
        digest.update(canonical(list(row)) + b"\n")
    return digest.hexdigest()


def extract(database: Path) -> list[tuple]:
    before = database_snapshot(database)
    with tempfile.TemporaryDirectory(prefix="sec-tw-db-snapshot-") as directory:
        snapshot = Path(directory) / "bound.sqlite"
        with database.open("rb") as source, snapshot.open("xb") as target:
            shutil.copyfileobj(source, target, length=8 * 1024 * 1024)
            target.flush()
            os.fsync(target.fileno())
        require_no_sidecars(database)
        if file_state(database) != before or file_sha256(database) != DATABASE_RAW_SHA256 or file_state(database) != before:
            fail("database changed while private snapshot was copied")
        require_no_sidecars(database)
        if snapshot.stat().st_size != DATABASE_BYTES or file_sha256(snapshot) != DATABASE_RAW_SHA256:
            fail("private database snapshot differs from bound bytes")
        connection = sqlite3.connect(f"file:{snapshot.as_posix()}?mode=ro&immutable=1", uri=True)
        try:
            if connection.execute("PRAGMA quick_check").fetchone() != ("ok",):
                fail("database quick_check failed")
            if connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone() != (
                "early-detection-sec-corporate-action-candidates/v1",
            ):
                fail("database schema marker changed")
            if sequence_digest(connection) != EVENT_SEQUENCE_SHA256:
                fail("event sequence binding changed")
            rows = connection.execute("""
              SELECT e.event_id,e.event_class,e.cik,e.company_name,e.form,e.filed_date,e.accession,e.filing_path,
                     e.source_payload_sha256,e.source_observed_at,e.source_row_number,COUNT(b.ticker) AS bridge_link_count
              FROM events e LEFT JOIN bridge_links b ON b.event_id=e.event_id GROUP BY e.event_id
            """).fetchall()
        finally:
            connection.close()
        if file_sha256(snapshot) != DATABASE_RAW_SHA256:
            fail("private database snapshot changed during query")
        return rows


def build_payload(contract: dict, rows: list[tuple], contract_raw: bytes) -> dict:
    if len(rows) != EXPECTED_EVENTS:
        fail("event denominator changed")
    queue = []
    for row in rows:
        event_id,event_class,cik,name,form,filed,accession,filing_path,payload_sha,observed_at,row_number,links = row
        if event_class not in DOCUMENT_CLASSES:
            fail("unexpected event class")
        if not re.fullmatch(r"[0-9a-f]{64}", payload_sha) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", filed):
            fail("event source/date malformed")
        if accession is not None and not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession):
            fail("accession malformed")
        queue.append({
            "rowId": f"SEC-TW-{event_id:08d}", "eventClass": event_class, "cik": f"{cik:010d}",
            "companyName": name, "form": form, "filedDate": filed, "accession": accession,
            "filingPath": filing_path, "sourcePayloadSha256": payload_sha, "sourceObservedAt": observed_at,
            "sourceRowNumber": row_number, "bridgeLinkCount": links,
            "documentClasses": DOCUMENT_CLASSES[event_class], "resolutionState": "UNRESOLVED",
            "outcomesAccessed": False,
        })
    queue.sort(key=lambda item: (
        item["accession"] is None, -item["bridgeLinkCount"], item["eventClass"], item["filedDate"],
        item["cik"], item["accession"] or "", item["rowId"],
    ))
    units = [(x["cik"], x["accession"], x["eventClass"], x["filedDate"]) for x in queue]
    if len(units) != len(set(units)):
        fail("queue unit is not unique")
    for rank, item in enumerate(queue, 1):
        item["priorityRank"] = rank
    form25 = sum(x["eventClass"] == "DELISTING_FORM25_CANDIDATE" for x in queue)
    form15 = sum(x["eventClass"] == "DEREGISTRATION_FORM15_CANDIDATE" for x in queue)
    if (form25, form15) != (EXPECTED_FORM25, EXPECTED_FORM15):
        fail("event-class denominators changed")
    payload = {
        "schema": "early-detection-sec-terminal-wealth-queue/v5",
        "contractRawSha256": hashlib.sha256(contract_raw).hexdigest(),
        "builderRawSha256": file_sha256(SCRIPT), "testRawSha256": file_sha256(TEST),
        "inputReportRawSha256": REPORT_RAW_SHA256, "inputDatabaseRawSha256": DATABASE_RAW_SHA256,
        "inputEventSequenceSha256": EVENT_SEQUENCE_SHA256,
        "counts": {"rows": len(queue), "form25Family": form25, "form15Family": form15,
                   "unresolved": len(queue), "resolved": 0},
        "prioritySort": PRIORITY_SORT, "claimLocks": contract["claimLocks"], "rows": queue,
    }
    payload["reportSha256"] = hashlib.sha256(canonical(payload)).hexdigest()
    return payload


def atomic_write_new(output: Path, encoded: bytes) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=output.parent, prefix=output.name + ".",
                                         suffix=".tmp", delete=False) as handle:
            temp_path = Path(handle.name)
            handle.write(encoded); handle.flush(); os.fsync(handle.fileno())
        os.link(temp_path, output)
    except FileExistsError as exc:
        fail("output already exists")
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()
    if output.read_bytes() != encoded:
        fail("output readback mismatch")


def self_test() -> dict:
    contract_raw = read_raw(CONTRACT)
    contract = json.loads(contract_raw)
    validate_contract(contract, contract_raw)
    changed = json.loads(json.dumps(contract)); changed["input"]["expectedEvents"] = 7
    changed_rejected = False
    try:
        validate_contract(changed, canonical(changed))
    except ValueError:
        changed_rejected = True
    with tempfile.TemporaryDirectory(prefix="sec-tw-v4-self-") as directory:
        probe = Path(directory) / "probe.sqlite"
        probe.write_bytes(b"0123456789")
        expected_sha = file_sha256(probe)
        database_snapshot(probe, 10, expected_sha)
        probe.write_bytes(b"0123456788")
        same_path_mutation_rejected = False
        try:
            database_snapshot(probe, 10, expected_sha)
        except ValueError:
            same_path_mutation_rejected = True
        probe.write_bytes(b"0123456789")
        Path(str(probe) + "-wal").write_bytes(b"sidecar")
        sidecar_rejected = False
        try:
            database_snapshot(probe, 10, expected_sha)
        except ValueError:
            sidecar_rejected = True
    return {"status": "PASS", "contractRawBound": changed_rejected,
            "samePathSameSizeMutationRejected": same_path_mutation_rejected,
            "sidecarsFailClosed": sidecar_rejected, "immutableReadOnlyRequired": True,
            "privateFullyHashedSnapshotRequired": True, "nullAndEmptyTickerDistinct": True,
            "eventIdAndObservedAtSequenceBound": True, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database")
    parser.add_argument("--output")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        print(json.dumps(self_test(), sort_keys=True)); return 0
    if not args.database or not args.output:
        parser.error("--database and --output are required")
    contract_raw = read_raw(CONTRACT); contract = json.loads(contract_raw)
    validate_contract(contract, contract_raw)
    remote_head = require_remote_contract(contract_raw)
    report_path = ROOT / REPORT_PATH; report_raw = read_raw(report_path); report = json.loads(report_raw)
    if hashlib.sha256(report_raw).hexdigest() != REPORT_RAW_SHA256 or report.get("reportSha256") != REPORT_CANONICAL_SHA256:
        fail("input report binding changed")
    database = Path(args.database).resolve()
    if database != Path(report["database"]).resolve():
        fail("database path differs from bound report")
    payload = build_payload(contract, extract(database), contract_raw)
    if git_text("rev-parse", "HEAD") != remote_head or require_remote_contract(contract_raw) != remote_head:
        fail("remote contract snapshot changed during build")
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2).encode() + b"\n"
    atomic_write_new(Path(args.output), encoded)
    print(json.dumps({"status": "PASS", "rows": len(payload["rows"]),
                      "reportSha256": payload["reportSha256"], "outcomesAccessed": False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
