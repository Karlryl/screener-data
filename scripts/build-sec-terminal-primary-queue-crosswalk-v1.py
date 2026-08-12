#!/usr/bin/env python3
"""Build a fail-closed exact-accession crosswalk from SEC candidates to the terminal queue."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-primary-queue-crosswalk-contract-v1.json"
QUEUE = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-queue-v5.json"
EXTRACTION = ROOT / "reports" / "early-detection" / "sec-terminal-primary-document-extraction-v1.json"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-terminal-primary-queue-crosswalk-v1.json"
EXPECTED_CONTRACT_RAW = "86bbc4697efc560843cb5feb9651d61e563b6c2f58a222df556ecd121a183c4a"
EXPECTED_CONTRACT_SELF = "95fd9ddecc0bea77729555243523204cc55cdfb951030384da2030fea0e1f6cf"
QUEUE_RAW = "cfc6b1c98e159e0d086bdad72a495ebe1c34b208975f145a8f96f903ada8798e"
QUEUE_REPORT = "a840de2297de3a04afc1f1bcb76139fb36297369b6765f73683db9bc2a92e825"
EXTRACTION_RAW = "987560ca38931cfa818f6c9fb315be7875ec98fd872518ef51d45f5af3589464"
EXTRACTION_REPORT = "9fd402508ff75ab0d3265cc15c7f77a6e6fa2f659749a43f5719db207d094000"
EXPECTED_ROWS = 656
EXPECTED_UNIQUE_ACCESSIONS = 652
EXPECTED_SINGLE = 65
EXPECTED_MULTIPLE = 591
EXPECTED_QUEUE_REFS = 1247
EXPECTED_UNIQUE_QUEUE_REFS = 1239


class CrosswalkError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise CrosswalkError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def load_self_hashed(path: Path, raw_sha: str, report_sha: str, label: str) -> dict[str, Any]:
    raw = path.read_bytes()
    if sha(raw) != raw_sha:
        fail(f"{label} raw bytes changed")
    value = json.loads(raw)
    if not isinstance(value, dict):
        fail(f"{label} object required")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != report_sha or sha(canonical(body)) != report_sha:
        fail(f"{label} self hash changed")
    return value


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("contractSha256", None)
    if claim != EXPECTED_CONTRACT_SELF or sha(canonical(body)) != EXPECTED_CONTRACT_SELF:
        fail("contract self hash changed")
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "crosswalkContract", "output", "claimLocks", "contractSha256"}, "contract")
    if value["schema"] != "early-detection-sec-terminal-primary-queue-crosswalk-contract/v1" or value["taskId"] != "Q003-SEC-TERMINAL-PRIMARY-QUEUE-CROSSWALK" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    if value["inputs"] != {
        "queue": {"path": "reports/early-detection/sec-terminal-wealth-queue-v5.json", "rawSha256": QUEUE_RAW, "reportSha256": QUEUE_REPORT, "introductionCommit": "0148a3e14d7aa3cdfd493de2ca399fa876357a1e", "rows": 44352},
        "extraction": {"path": "reports/early-detection/sec-terminal-primary-document-extraction-v1.json", "rawSha256": EXTRACTION_RAW, "reportSha256": EXTRACTION_REPORT, "introductionCommit": "96731659935f032e6f40cd5713794f48d740da25", "rows": EXPECTED_ROWS, "uniqueAccessions": EXPECTED_UNIQUE_ACCESSIONS},
    }:
        fail("input contract changed")
    if value["crosswalkContract"] != {
        "joinKey": ["accession"],
        "tickerJoinAllowed": False,
        "companyNameJoinAllowed": False,
        "cikInferenceAllowed": False,
        "oneOutputRowPerExtractionRow": True,
        "allExactAccessionQueueRowsPreserved": True,
        "queueMultiplicityCollapsed": False,
        "expectedOutputRows": EXPECTED_ROWS,
        "expectedUniqueAccessions": EXPECTED_UNIQUE_ACCESSIONS,
        "expectedSingleQueueRowMatches": EXPECTED_SINGLE,
        "expectedMultipleQueueRowMatches": EXPECTED_MULTIPLE,
        "expectedQueueRowReferences": EXPECTED_QUEUE_REFS,
        "expectedUniqueQueueRowsReferenced": EXPECTED_UNIQUE_QUEUE_REFS,
        "missingMatchAllowed": False,
        "candidateOnly": True,
        "outcomesAccessed": False,
    }:
        fail("crosswalk contract changed")
    if value["output"] != {"path": "reports/early-detection/sec-terminal-primary-queue-crosswalk-v1.json", "writeNewAtomic": True}:
        fail("output contract changed")
    if any(value["claimLocks"].values()):
        fail("claim lock opened")
    return value


def validate_inputs() -> tuple[dict[str, Any], dict[str, Any]]:
    queue = load_self_hashed(QUEUE, QUEUE_RAW, QUEUE_REPORT, "queue")
    extraction = load_self_hashed(EXTRACTION, EXTRACTION_RAW, EXTRACTION_REPORT, "extraction")
    queue_rows = queue.get("rows")
    extraction_rows = extraction.get("rows")
    if not isinstance(queue_rows, list) or len(queue_rows) != 44352 or queue.get("counts", {}).get("unresolved") != 44352 or any(queue.get("claimLocks", {}).values()):
        fail("queue boundary changed")
    if not isinstance(extraction_rows, list) or len(extraction_rows) != EXPECTED_ROWS or len({row.get("accession") for row in extraction_rows}) != EXPECTED_UNIQUE_ACCESSIONS:
        fail("extraction population changed")
    if extraction.get("claimLocks", {}).get("candidateStatusOnly") is not True or any(item is not False for key, item in extraction.get("claimLocks", {}).items() if key != "candidateStatusOnly"):
        fail("extraction boundary changed")
    return queue, extraction


def queue_ref(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "rowId": row["rowId"],
        "priorityRank": row["priorityRank"],
        "cik": row["cik"],
        "companyName": row["companyName"],
        "filedDate": row["filedDate"],
        "form": row["form"],
        "eventClass": row["eventClass"],
        "filingPath": row["filingPath"],
        "bridgeLinkCount": row["bridgeLinkCount"],
        "sourcePayloadSha256": row["sourcePayloadSha256"],
        "sourceRowNumber": row["sourceRowNumber"],
        "sourceObservedAt": row["sourceObservedAt"],
        "resolutionState": row["resolutionState"],
        "outcomesAccessed": row["outcomesAccessed"],
    }


def build_rows(queue: dict[str, Any], extraction: dict[str, Any]) -> list[dict[str, Any]]:
    by_accession: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in queue["rows"]:
        by_accession[row["accession"]].append(row)
    rows = []
    for rank, source in enumerate(extraction["rows"], 1):
        matches = sorted(by_accession.get(source["accession"], []), key=lambda row: (row["priorityRank"], row["rowId"]))
        if not matches:
            fail("extraction accession missing from queue")
        state = "ONE_EXACT_ACCESSION_QUEUE_ROW_CANDIDATE_ONLY" if len(matches) == 1 else "MULTIPLE_EXACT_ACCESSION_QUEUE_ROWS_UNRESOLVED"
        rows.append({
            "crosswalkRank": rank,
            "crosswalkRowId": sha(canonical({"extractionRowId": source["extractionRowId"], "accession": source["accession"], "queueRowIds": [row["rowId"] for row in matches]})),
            "accession": source["accession"],
            "sourceExtractionRowId": source["extractionRowId"],
            "sourceTriageRowId": source["sourceTriageRowId"],
            "sourceCandidateId": source["sourceCandidateId"],
            "sourceOccurrenceId": source["sourceOccurrenceId"],
            "sourceDataset": source["sourceDataset"],
            "extractionStatus": source["extractionStatus"],
            "queueMatchState": state,
            "queueMatchCount": len(matches),
            "queueRows": [queue_ref(row) for row in matches],
            "joinKey": "EXACT_ACCESSION_ONLY",
            "candidateOnly": True,
            "issuerIdentityResolved": False,
            "securityIdentityResolved": False,
            "paymentVerified": False,
            "terminalWealthComplete": False,
            "manualPrimaryDocumentReviewRequired": True,
            "outcomesAccessed": False,
        })
    return rows


def population(rows: list[dict[str, Any]]) -> dict[str, Any]:
    matches = Counter(row["queueMatchState"] for row in rows)
    queue_ids = [item["rowId"] for row in rows for item in row["queueRows"]]
    return {
        "extractionRows": len(rows),
        "uniqueAccessions": len({row["accession"] for row in rows}),
        "oneQueueRowMatches": matches["ONE_EXACT_ACCESSION_QUEUE_ROW_CANDIDATE_ONLY"],
        "multipleQueueRowMatches": matches["MULTIPLE_EXACT_ACCESSION_QUEUE_ROWS_UNRESOLVED"],
        "queueRowReferences": len(queue_ids),
        "uniqueQueueRowsReferenced": len(set(queue_ids)),
        "missingQueueMatches": 0,
        "issuerResolvedRows": 0,
        "securityResolvedRows": 0,
        "paymentVerifiedRows": 0,
        "terminalWealthCompleteRows": 0,
    }


def build_report(contract: dict[str, Any], queue: dict[str, Any], extraction: dict[str, Any]) -> dict[str, Any]:
    rows = build_rows(queue, extraction)
    value = {
        "schema": "early-detection-sec-terminal-primary-queue-crosswalk/v1",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "contractSha256": contract["contractSha256"],
        "queueRawSha256": QUEUE_RAW,
        "queueReportSha256": QUEUE_REPORT,
        "extractionRawSha256": EXTRACTION_RAW,
        "extractionReportSha256": EXTRACTION_REPORT,
        "joinContract": {"joinKey": ["accession"], "tickerJoinAllowed": False, "companyNameJoinAllowed": False, "cikInferenceAllowed": False, "queueMultiplicityCollapsed": False},
        "population": population(rows),
        "rows": rows,
        "claimLocks": contract["claimLocks"],
        "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_queue_ref(value: dict[str, Any]) -> None:
    exact_keys(value, {"rowId", "priorityRank", "cik", "companyName", "filedDate", "form", "eventClass", "filingPath", "bridgeLinkCount", "sourcePayloadSha256", "sourceRowNumber", "sourceObservedAt", "resolutionState", "outcomesAccessed"}, "queue reference")
    if value["resolutionState"] != "UNRESOLVED" or value["outcomesAccessed"] is not False:
        fail("queue reference promoted")


def validate_report(value: dict[str, Any], contract: dict[str, Any], queue: dict[str, Any], extraction: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "contractSha256", "queueRawSha256", "queueReportSha256", "extractionRawSha256", "extractionReportSha256", "joinContract", "population", "rows", "claimLocks", "outcomesAccessed", "reportSha256"}, "report")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value["schema"] != "early-detection-sec-terminal-primary-queue-crosswalk/v1":
        fail("report self hash changed")
    if value["contractRawSha256"] != sha(CONTRACT.read_bytes()) or value["contractSha256"] != contract["contractSha256"] or value["queueRawSha256"] != QUEUE_RAW or value["queueReportSha256"] != QUEUE_REPORT or value["extractionRawSha256"] != EXTRACTION_RAW or value["extractionReportSha256"] != EXTRACTION_REPORT:
        fail("report binding changed")
    if value["joinContract"] != {"joinKey": ["accession"], "tickerJoinAllowed": False, "companyNameJoinAllowed": False, "cikInferenceAllowed": False, "queueMultiplicityCollapsed": False}:
        fail("join contract changed")
    expected = build_rows(queue, extraction)
    if value["rows"] != expected:
        fail("report rows do not match exact-accession rebuild")
    if value["population"] != population(expected) or value["population"] != {
        "extractionRows": EXPECTED_ROWS,
        "uniqueAccessions": EXPECTED_UNIQUE_ACCESSIONS,
        "oneQueueRowMatches": EXPECTED_SINGLE,
        "multipleQueueRowMatches": EXPECTED_MULTIPLE,
        "queueRowReferences": EXPECTED_QUEUE_REFS,
        "uniqueQueueRowsReferenced": EXPECTED_UNIQUE_QUEUE_REFS,
        "missingQueueMatches": 0,
        "issuerResolvedRows": 0,
        "securityResolvedRows": 0,
        "paymentVerifiedRows": 0,
        "terminalWealthCompleteRows": 0,
    }:
        fail("population changed")
    if value["claimLocks"] != contract["claimLocks"] or any(value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("claim boundary changed")
    if [row["crosswalkRank"] for row in value["rows"]] != list(range(1, EXPECTED_ROWS + 1)) or len({row["crosswalkRowId"] for row in value["rows"]}) != EXPECTED_ROWS:
        fail("crosswalk row identity changed")
    for row in value["rows"]:
        exact_keys(row, {"crosswalkRank", "crosswalkRowId", "accession", "sourceExtractionRowId", "sourceTriageRowId", "sourceCandidateId", "sourceOccurrenceId", "sourceDataset", "extractionStatus", "queueMatchState", "queueMatchCount", "queueRows", "joinKey", "candidateOnly", "issuerIdentityResolved", "securityIdentityResolved", "paymentVerified", "terminalWealthComplete", "manualPrimaryDocumentReviewRequired", "outcomesAccessed"}, "crosswalk row")
        if row["joinKey"] != "EXACT_ACCESSION_ONLY" or row["candidateOnly"] is not True or row["manualPrimaryDocumentReviewRequired"] is not True or any(row[key] is not False for key in ("issuerIdentityResolved", "securityIdentityResolved", "paymentVerified", "terminalWealthComplete", "outcomesAccessed")):
            fail("crosswalk row promoted")
        if row["queueMatchCount"] != len(row["queueRows"]):
            fail("queue reference count changed")
        for item in row["queueRows"]:
            validate_queue_ref(item)


def write_new(path: Path, raw: bytes) -> None:
    if path.exists():
        fail("output exists")
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (CrosswalkError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any], queue: dict[str, Any], extraction: dict[str, Any]) -> dict[str, Any]:
    report = build_report(contract, queue, extraction)
    validate_report(report, contract, queue, extraction)
    kills: dict[str, bool] = {}
    for name, mutate in {
        "queueReferenceDropped": lambda x: x["rows"][0]["queueRows"].pop(),
        "multipleQueueRowsCollapsed": lambda x: x["rows"][next(i for i, row in enumerate(x["rows"]) if row["queueMatchCount"] > 1)]["queueRows"].pop(),
        "issuerPromoted": lambda x: x["rows"][0].__setitem__("issuerIdentityResolved", True),
        "tickerJoinClaimed": lambda x: x["joinContract"].__setitem__("tickerJoinAllowed", True),
        "accessionChanged": lambda x: x["rows"][0].__setitem__("accession", "0000000000-00-000000"),
        "originalV4Credit": lambda x: x["claimLocks"].__setitem__("originalV4GateCredit", True),
    }.items():
        item = copy.deepcopy(report)
        mutate(item)
        item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
        kills[name] = rejected(lambda item=item: validate_report(item, contract, queue, extraction))
    return {"schema": "early-detection-sec-terminal-primary-queue-crosswalk-self-test/v1", "status": "PASS", "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract = validate_contract()
        queue, extraction = validate_inputs()
        if args.command == "verify-contract":
            result = {"schema": "early-detection-sec-terminal-primary-queue-crosswalk-contract-verification/v1", "status": "PASS", "contractSha256": contract["contractSha256"], "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract, queue, extraction)
        elif args.command == "build":
            report = build_report(contract, queue, extraction)
            validate_report(report, contract, queue, extraction)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "early-detection-sec-terminal-primary-queue-crosswalk-build/v1", "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "rows": EXPECTED_ROWS, "outcomesAccessed": False}
        else:
            report = json.loads(OUTPUT.read_bytes())
            validate_report(report, contract, queue, extraction)
            result = {"schema": "early-detection-sec-terminal-primary-queue-crosswalk-verification/v1", "status": "PASS", "rawSha256": sha(OUTPUT.read_bytes()), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "rows": EXPECTED_ROWS, "outcomesAccessed": False}
    except (CrosswalkError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
