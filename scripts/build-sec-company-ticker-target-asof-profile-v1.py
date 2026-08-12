#!/usr/bin/env python3
"""Build a point-in-time, outcome-blind SEC company-ticker target profile."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import sqlite3
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-company-ticker-target-asof-profile-contract-v1.json"
RESOLUTION = ROOT / "reports" / "early-detection" / "sec-terminal-primary-issuer-cik-resolution-v1.json"
DATABASE = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\sec-company-ticker-archive-v1\sec-company-tickers-2017-2024-v2.sqlite")
OUTPUT = ROOT / "reports" / "early-detection" / "sec-company-ticker-target-asof-profile-v1.json"
EXPECTED_CONTRACT_RAW = "261deeaf212e306c1382edd8a382a4d825405b84334efae5d0017e6dbe52ccda"
EXPECTED_CONTRACT_SELF = "d73ad651146771aae34931583489cd76d3f398e29cc269a73a7a632069653580"
RESOLUTION_RAW = "f89767daf43c2d06ca87c0b57919b450749620026724b700ff94572117da7cfb"
RESOLUTION_REPORT = "3b450bef0120eee49fc4ab0f188578097ffd2fb53d781675b33c6db84809ead6"
DB_RAW = "0ed47251122fdd83d1910ff37e0e18d623492a0de253c0dda77976c4fb9f4aae"
DB_BYTES = 584245248
SNAPSHOT_SEQUENCE = "0d63bcb39a96ac3d8e2fba9828ffd3c02fb3d5348aef1aa56ff0dbf1139d156d"
IDENTITY_SEQUENCE = "acf3ca718914c9199ea57a7b0b38b098b28e27eda5eea7f9620d94d378be781b"
EXPECTED_STATES = {
    "NO_ARCHIVE_SNAPSHOT_AT_OR_BEFORE_FILING": 452,
    "PRIOR_SNAPSHOT_ISSUER_ABSENT": 19,
    "PRIOR_SNAPSHOT_MULTIPLE_TICKERS_CANDIDATE_ONLY": 42,
    "PRIOR_SNAPSHOT_ONE_TICKER_CANDIDATE_ONLY": 143,
}


class ProfileError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ProfileError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("contractSha256", None)
    if claim != EXPECTED_CONTRACT_SELF or sha(canonical(body)) != EXPECTED_CONTRACT_SELF:
        fail("contract self hash changed")
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "profileContract", "output", "claimLocks", "contractSha256"}, "contract")
    if value["schema"] != "early-detection-sec-company-ticker-target-asof-profile-contract/v1" or value["taskId"] != "Q003-SEC-COMPANY-TICKER-TARGET-ASOF-PROFILE" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    if value["inputs"] != {
        "issuerResolution": {"path": "reports/early-detection/sec-terminal-primary-issuer-cik-resolution-v1.json", "rawSha256": RESOLUTION_RAW, "reportSha256": RESOLUTION_REPORT, "introductionCommit": "167592d0e7bae4a03d3589844d8430c1ded83e67", "rows": 656, "uniqueIssuerCiks": 607},
        "secCompanyTickerArchive": {"path": "C:/Users/Anwender/Documents/GrowthScreenerResearchData/early-detection-v4/sec-company-ticker-archive-v1/sec-company-tickers-2017-2024-v2.sqlite", "rawSha256": DB_RAW, "bytes": DB_BYTES, "schema": "early-detection-sec-company-ticker-archive/v2", "snapshots": 544, "uniqueSnapshotTimestamps": 544, "states": 385, "identityRows": 4258096, "uniqueCiks": 18546, "uniqueTickers": 29181, "minimumTimestamp": "20170828201525", "maximumTimestamp": "20241207105854", "snapshotStateSequenceSha256": SNAPSHOT_SEQUENCE, "identitySequenceSha256": IDENTITY_SEQUENCE},
    }:
        fail("input contract changed")
    if value["profileContract"] != {
        "oneOutputRowPerIssuerResolutionRow": True,
        "asOfCutoff": "LATEST_ARCHIVE_SNAPSHOT_TIMESTAMP_NOT_AFTER_QUEUE_FILED_DATE_END_OF_DAY",
        "joinKey": ["sourceDerivedIssuerCik"],
        "tickerJoinAllowed": False,
        "companyNameJoinAllowed": False,
        "securityIdentityInferenceAllowed": False,
        "continuousIntervalInferenceAllowed": False,
        "latestFutureSnapshotFallbackAllowed": False,
        "expectedRows": 656,
        "expectedNoPriorSnapshotRows": 452,
        "expectedPriorSnapshotNoIssuerRows": 19,
        "expectedOnePointTickerRows": 143,
        "expectedMultiplePointTickerRows": 42,
        "expectedByPointState": EXPECTED_STATES,
        "rawProviderRowsRemainPrivate": True,
        "outcomesAccessed": False,
    }:
        fail("profile contract changed")
    if value["output"] != {"path": "reports/early-detection/sec-company-ticker-target-asof-profile-v1.json", "writeNewAtomic": True}:
        fail("output contract changed")
    if value["claimLocks"].get("pointInTimeTickerCandidateAvailable") is not True or any(item is not False for key, item in value["claimLocks"].items() if key != "pointInTimeTickerCandidateAvailable"):
        fail("claim boundary changed")
    return value


def load_resolution() -> dict[str, Any]:
    raw = RESOLUTION.read_bytes()
    if sha(raw) != RESOLUTION_RAW:
        fail("resolution raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != RESOLUTION_REPORT or sha(canonical(body)) != RESOLUTION_REPORT or len(value.get("rows", [])) != 656:
        fail("resolution binding changed")
    if value.get("claimLocks", {}).get("issuerQueueRowResolved") is not True or any(item is not False for key, item in value.get("claimLocks", {}).items() if key != "issuerQueueRowResolved"):
        fail("resolution boundary changed")
    return value


def database_snapshot() -> tuple[int, int]:
    stat = DATABASE.stat()
    if stat.st_size != DB_BYTES:
        fail("database byte count changed")
    for suffix in ("-wal", "-shm", "-journal"):
        if Path(str(DATABASE) + suffix).exists():
            fail("database sidecar present")
    return stat.st_size, stat.st_mtime_ns


def verify_database() -> tuple[int, int]:
    before = database_snapshot()
    if file_sha(DATABASE) != DB_RAW:
        fail("database raw bytes changed")
    after = database_snapshot()
    if before != after:
        fail("database changed during hash")
    return after


def open_database() -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{DATABASE.as_posix()}?mode=ro&immutable=1", uri=True)
    if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
        fail("database quick check failed")
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if tables != {"identities", "meta", "snapshots", "states"} or connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()[0] != "early-detection-sec-company-ticker-archive/v2":
        fail("database schema changed")
    counts = connection.execute("SELECT (SELECT COUNT(*) FROM snapshots),(SELECT COUNT(*) FROM states),(SELECT COUNT(*) FROM identities),(SELECT COUNT(DISTINCT requested_timestamp) FROM snapshots),(SELECT COUNT(DISTINCT cik) FROM identities),(SELECT COUNT(DISTINCT ticker) FROM identities)").fetchone()
    if counts != (544, 385, 4258096, 544, 18546, 29181):
        fail("database counts changed")
    return connection


def sequence_checks(connection: sqlite3.Connection) -> None:
    digest = hashlib.sha256()
    for row in connection.execute("SELECT s.snapshot_id,s.requested_timestamp,s.original_url,s.cdx_digest,s.cdx_mimetype,s.cdx_length,s.state_id,s.transport_evidence,s.source_v1_snapshot_id,st.payload_sha256,st.payload_bytes,st.logical_rows,st.unique_ciks,st.unique_tickers,st.unique_cik_ticker_pairs,st.duplicate_cik_ticker_rows FROM snapshots s JOIN states st ON st.state_id=s.state_id ORDER BY s.requested_timestamp,s.snapshot_id"):
        digest.update(canonical(row)); digest.update(b"\n")
    if digest.hexdigest() != SNAPSHOT_SEQUENCE:
        fail("snapshot sequence changed")
    digest = hashlib.sha256()
    for row in connection.execute("SELECT state_id,source_row,source_key,cik,ticker,title,COALESCE(security_type,'') FROM identities ORDER BY state_id,source_row"):
        digest.update(canonical(row)); digest.update(b"\n")
    if digest.hexdigest() != IDENTITY_SEQUENCE:
        fail("identity sequence changed")


def build_rows(resolution: dict[str, Any], connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = []
    for rank, source in enumerate(resolution["rows"], 1):
        filing_date = source["selectedIssuerQueueRow"]["filedDate"]
        cutoff = filing_date.replace("-", "") + "235959"
        found = connection.execute("SELECT snapshot_id,requested_timestamp,state_id,cdx_digest,transport_evidence FROM snapshots WHERE requested_timestamp<=? ORDER BY requested_timestamp DESC,snapshot_id DESC LIMIT 1", (cutoff,)).fetchone()
        candidates: list[dict[str, Any]] = []
        if found is None:
            point_state = "NO_ARCHIVE_SNAPSHOT_AT_OR_BEFORE_FILING"
            snapshot = None
        else:
            snapshot = {"snapshotId": found[0], "requestedTimestamp": found[1], "stateId": found[2], "cdxDigest": found[3], "transportEvidence": found[4]}
            for identity in connection.execute("SELECT source_row,source_key,ticker,title,COALESCE(security_type,'') FROM identities WHERE state_id=? AND cik=? ORDER BY ticker,title,source_row", (found[2], source["sourceDerivedIssuerCik"])):
                candidates.append({"sourceRow": identity[0], "sourceKey": identity[1], "ticker": identity[2], "title": identity[3], "securityType": identity[4] or None})
            unique_tickers = len({item["ticker"] for item in candidates})
            if not candidates:
                point_state = "PRIOR_SNAPSHOT_ISSUER_ABSENT"
            elif len(candidates) == 1 and unique_tickers == 1:
                point_state = "PRIOR_SNAPSHOT_ONE_TICKER_CANDIDATE_ONLY"
            else:
                point_state = "PRIOR_SNAPSHOT_MULTIPLE_TICKERS_CANDIDATE_ONLY"
        rows.append({
            "profileRank": rank,
            "profileRowId": sha(canonical({"sourceResolutionRowId": source["resolutionRowId"], "filingDate": filing_date, "pointState": point_state, "snapshot": snapshot, "candidates": candidates})),
            "sourceResolutionRowId": source["resolutionRowId"],
            "accession": source["accession"],
            "sourceDerivedIssuerCik": source["sourceDerivedIssuerCik"],
            "queueFiledDate": filing_date,
            "pointState": point_state,
            "snapshot": snapshot,
            "pointTickerCandidates": candidates,
            "pointTickerCandidateAvailable": bool(candidates),
            "historicalIdentityResolved": False,
            "continuousValidityIntervalProven": False,
            "tickerReuseResolved": False,
            "securityIdentityResolved": False,
            "outcomesAccessed": False,
        })
    return rows


def population(rows: list[dict[str, Any]]) -> dict[str, Any]:
    counts = Counter(row["pointState"] for row in rows)
    return {"rows": len(rows), "uniqueAccessions": len({row["accession"] for row in rows}), "uniqueIssuerCiks": len({row["sourceDerivedIssuerCik"] for row in rows}), "byPointState": dict(sorted(counts.items())), "pointTickerCandidateRows": sum(bool(row["pointTickerCandidates"]) for row in rows), "historicalIdentityResolvedRows": 0, "securityIdentityResolvedRows": 0}


def build_report(contract: dict[str, Any], resolution: dict[str, Any], connection: sqlite3.Connection) -> dict[str, Any]:
    rows = build_rows(resolution, connection)
    value = {
        "schema": "early-detection-sec-company-ticker-target-asof-profile/v1",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "contractSha256": contract["contractSha256"],
        "resolutionRawSha256": RESOLUTION_RAW,
        "resolutionReportSha256": RESOLUTION_REPORT,
        "databaseRawSha256": DB_RAW,
        "databaseBytes": DB_BYTES,
        "snapshotStateSequenceSha256": SNAPSHOT_SEQUENCE,
        "identitySequenceSha256": IDENTITY_SEQUENCE,
        "asOfContract": {"cutoff": "LATEST_ARCHIVE_SNAPSHOT_TIMESTAMP_NOT_AFTER_QUEUE_FILED_DATE_END_OF_DAY", "joinKey": ["sourceDerivedIssuerCik"], "tickerJoinAllowed": False, "futureSnapshotFallbackAllowed": False},
        "population": population(rows),
        "rows": rows,
        "claimLocks": contract["claimLocks"],
        "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], contract: dict[str, Any], resolution: dict[str, Any], connection: sqlite3.Connection) -> None:
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "contractSha256", "resolutionRawSha256", "resolutionReportSha256", "databaseRawSha256", "databaseBytes", "snapshotStateSequenceSha256", "identitySequenceSha256", "asOfContract", "population", "rows", "claimLocks", "outcomesAccessed", "reportSha256"}, "report")
    body = dict(value); claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value["schema"] != "early-detection-sec-company-ticker-target-asof-profile/v1":
        fail("report self hash changed")
    if value["contractRawSha256"] != sha(CONTRACT.read_bytes()) or value["contractSha256"] != contract["contractSha256"] or value["resolutionRawSha256"] != RESOLUTION_RAW or value["resolutionReportSha256"] != RESOLUTION_REPORT or value["databaseRawSha256"] != DB_RAW or value["databaseBytes"] != DB_BYTES or value["snapshotStateSequenceSha256"] != SNAPSHOT_SEQUENCE or value["identitySequenceSha256"] != IDENTITY_SEQUENCE:
        fail("report binding changed")
    if value["asOfContract"] != {"cutoff": "LATEST_ARCHIVE_SNAPSHOT_TIMESTAMP_NOT_AFTER_QUEUE_FILED_DATE_END_OF_DAY", "joinKey": ["sourceDerivedIssuerCik"], "tickerJoinAllowed": False, "futureSnapshotFallbackAllowed": False}:
        fail("as-of contract changed")
    expected = build_rows(resolution, connection)
    if value["rows"] != expected:
        fail("rows do not match database rebuild")
    if value["population"] != population(expected) or value["population"] != {"rows": 656, "uniqueAccessions": 652, "uniqueIssuerCiks": 607, "byPointState": dict(sorted(EXPECTED_STATES.items())), "pointTickerCandidateRows": 185, "historicalIdentityResolvedRows": 0, "securityIdentityResolvedRows": 0}:
        fail("population changed")
    if value["claimLocks"] != contract["claimLocks"] or value["claimLocks"].get("pointInTimeTickerCandidateAvailable") is not True or any(item is not False for key, item in value["claimLocks"].items() if key != "pointInTimeTickerCandidateAvailable") or value["outcomesAccessed"] is not False:
        fail("claim boundary changed")
    if [row["profileRank"] for row in value["rows"]] != list(range(1, 657)) or len({row["profileRowId"] for row in value["rows"]}) != 656:
        fail("row identity changed")
    for row in value["rows"]:
        exact_keys(row, {"profileRank", "profileRowId", "sourceResolutionRowId", "accession", "sourceDerivedIssuerCik", "queueFiledDate", "pointState", "snapshot", "pointTickerCandidates", "pointTickerCandidateAvailable", "historicalIdentityResolved", "continuousValidityIntervalProven", "tickerReuseResolved", "securityIdentityResolved", "outcomesAccessed"}, "profile row")
        if any(row[key] is not False for key in ("historicalIdentityResolved", "continuousValidityIntervalProven", "tickerReuseResolved", "securityIdentityResolved", "outcomesAccessed")):
            fail("row promoted")
        if row["snapshot"] is not None and row["snapshot"]["requestedTimestamp"][:8] > row["queueFiledDate"].replace("-", ""):
            fail("future snapshot used")


def write_new(path: Path, raw: bytes) -> None:
    if path.exists():
        fail("output exists")
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw); handle.flush(); os.fsync(handle.fileno())
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (ProfileError, KeyError, TypeError, ValueError, OSError, sqlite3.Error, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any], resolution: dict[str, Any], connection: sqlite3.Connection) -> dict[str, Any]:
    report = build_report(contract, resolution, connection); validate_report(report, contract, resolution, connection)
    kills = {}
    for name, mutate in {
        "futureSnapshotInjected": lambda x: x["rows"][0].__setitem__("snapshot", {"snapshotId": 999, "requestedTimestamp": "20250101000000", "stateId": 999, "cdxDigest": "X", "transportEvidence": "X"}),
        "oneTickerPromotedToIdentity": lambda x: x["rows"][next(i for i, row in enumerate(x["rows"]) if row["pointState"] == "PRIOR_SNAPSHOT_ONE_TICKER_CANDIDATE_ONLY")].__setitem__("securityIdentityResolved", True),
        "tickerCandidateChanged": lambda x: x["rows"][next(i for i, row in enumerate(x["rows"]) if row["pointTickerCandidates"])]["pointTickerCandidates"][0].__setitem__("ticker", "TAMPER"),
        "tickerJoinClaimed": lambda x: x["asOfContract"].__setitem__("tickerJoinAllowed", True),
        "missingSnapshotAsAbsence": lambda x: x["rows"][0].__setitem__("historicalIdentityResolved", True),
        "originalV4Credit": lambda x: x["claimLocks"].__setitem__("originalV4GateCredit", True),
    }.items():
        item = copy.deepcopy(report); mutate(item); item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
        kills[name] = rejected(lambda item=item: validate_report(item, contract, resolution, connection))
    return {"schema": "early-detection-sec-company-ticker-target-asof-profile-self-test/v1", "status": "PASS", "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("command", choices=("verify-contract", "self-test", "build", "verify-output")); args = parser.parse_args()
    connection = None
    try:
        contract = validate_contract(); resolution = load_resolution(); verified_state = verify_database(); connection = open_database(); sequence_checks(connection)
        if database_snapshot() != verified_state:
            fail("database changed before query")
        if args.command == "verify-contract":
            result = {"schema": "early-detection-sec-company-ticker-target-asof-profile-contract-verification/v1", "status": "PASS", "contractSha256": contract["contractSha256"], "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract, resolution, connection)
        elif args.command == "build":
            report = build_report(contract, resolution, connection); validate_report(report, contract, resolution, connection)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"; write_new(OUTPUT, raw)
            result = {"schema": "early-detection-sec-company-ticker-target-asof-profile-build/v1", "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "rows": 656, "outcomesAccessed": False}
        else:
            report = json.loads(OUTPUT.read_bytes()); validate_report(report, contract, resolution, connection)
            result = {"schema": "early-detection-sec-company-ticker-target-asof-profile-verification/v1", "status": "PASS", "rawSha256": sha(OUTPUT.read_bytes()), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "rows": 656, "outcomesAccessed": False}
        connection.close(); connection = None
        if database_snapshot() != verified_state or file_sha(DATABASE) != DB_RAW or database_snapshot() != verified_state:
            fail("database changed during query")
    except (ProfileError, KeyError, TypeError, ValueError, OSError, sqlite3.Error, json.JSONDecodeError) as exc:
        if connection is not None:
            connection.close()
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True)); return 0


if __name__ == "__main__":
    raise SystemExit(main())
