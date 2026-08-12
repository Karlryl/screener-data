#!/usr/bin/env python3
"""Build a private-source-derived, public candidate-only FINRA/SEC crosswalk."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import tempfile
from datetime import date
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "finra-sec-point-candidate-crosswalk-contract-v1.json"
QUEUE = ROOT / "reports" / "early-detection" / "sec-terminal-identity-evidence-gap-queue-v1.json"
MANIFEST = ROOT / "reports" / "early-detection" / "finra-q004-historical-crawl-manifest-v3.json"
PRIVATE = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\private-evidence\finra-q004\historical")
CHECKPOINT = PRIVATE / "checkpoint-v2.json"
OUTPUT = ROOT / "reports" / "early-detection" / "finra-sec-point-candidate-crosswalk-v1.json"
EXPECTED_CONTRACT_RAW = "d8e2ae6adf01c4327acb9af44f14d5dd864c1a4c22cd41e00711a22857d05c1c"
QUEUE_RAW = "4c5bff255368bb0d9f498a8f367c65964c0de80d577cca70c695afe50ce0c650"
QUEUE_REPORT = "cb0b6272b1c07a8091354336bd9e5e1195ba43f766d393fe46fbebf04874e954"
MANIFEST_RAW = "2f266d063d5c05df53d635afcb922d0775d0345005869955b41fece3b9502580"
MANIFEST_REPORT = "caff5b9863516992222f9b58690cfad31df700441eeaf2fe3c41b356e641a09f"
CHECKPOINT_RAW = "7dd6a000e72b5219d00f25d98540fca3c6ab4f0a0b9527498656d4d2e9a2cc9c"
CHECKPOINT_SELF = "37b68644f955d046bc97885d6dde4014acbcc04fa8acc3945712b204ee58e5ad"
ROW_SEQUENCE = "2e2aa926ce60a632942fe87e53fada22e0373108e04d2e5e5591727dad383c4a"
FIELDS_SEQUENCE = "16f599619d5666efa0be18ca4e3e209d5646cc1e4e114dc042eb39156ef4d6d1"
EXPECTED_FIELDS = {
    "OTCDailyListID", "calendarDay", "dailyListEventCode", "dailyListReasonDescription",
    "oldSymbolCode", "newSymbolCode", "oldSecurityDescription", "newSecurityDescription",
    "securityDeleteFlag", "cashAmountText",
}


class CrosswalkError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise CrosswalkError(message)


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


def load_report(path: Path, raw_claim: str, report_claim: str, label: str) -> dict[str, Any]:
    raw = path.read_bytes()
    if sha(raw) != raw_claim:
        fail(f"{label} raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != report_claim or sha(canonical(body)) != report_claim or value.get("outcomesAccessed") is not False:
        fail(f"{label} self binding changed")
    return value


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "finraPrivateInput", "matchContract", "output", "claimLocks"}, "contract")
    if value["schema"] != "early-detection-finra-sec-point-candidate-crosswalk-contract/v1" or value["taskId"] != "Q004-FINRA-SEC-POINT-CANDIDATE-CROSSWALK" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    if value["inputs"] != {
        "gapQueue": {"path": "reports/early-detection/sec-terminal-identity-evidence-gap-queue-v1.json", "rawSha256": QUEUE_RAW, "reportSha256": QUEUE_REPORT, "rows": 656},
        "historicalManifest": {"path": "reports/early-detection/finra-q004-historical-crawl-manifest-v3.json", "rawSha256": MANIFEST_RAW, "reportSha256": MANIFEST_REPORT},
    }:
        fail("input binding changed")
    if value["finraPrivateInput"] != {"checkpointPath": CHECKPOINT.as_posix(), "checkpointRawSha256": CHECKPOINT_RAW, "checkpointSha256": CHECKPOINT_SELF, "partitionCount": 1522, "recordCount": 145103, "rowSequenceSha256": ROW_SEQUENCE, "rawResponseBytes": 257639538, "rawRowsRemainPrivate": True}:
        fail("private input binding changed")
    match = value["matchContract"]
    if match != {
        "candidateOnly": True,
        "dateWindowDaysInclusive": 120,
        "expectedCandidateEventCount": 3,
        "expectedCandidatePairCount": 3,
        "expectedMatchedTargetRows": 2,
        "inputPointTickerRows": 185,
        "matchFields": ["SEC_POINT_TICKER", "FINRA_OLD_OR_NEW_SYMBOL", "ABSOLUTE_CALENDAR_DAY_TO_FILING_DAY_LE_120"],
        "multipleEventsRemainMultiple": True,
        "noDescriptionFuzzyMatch": True,
        "noTickerOnlyResolution": True,
        "outputFields": ["OTCDailyListID", "calendarDay", "dailyListEventCode", "dailyListReasonDescription", "oldSymbolCode", "newSymbolCode", "oldSecurityDescription", "newSecurityDescription", "securityDeleteFlag", "cashAmountText"],
    }:
        fail("match contract changed")
    if value["output"] != {"path": "reports/early-detection/finra-sec-point-candidate-crosswalk-v1.json", "writeNewAtomic": True} or any(item is not False for item in value["claimLocks"].values()):
        fail("output or claim boundary changed")
    return value


def validate_checkpoint(checkpoint: dict[str, Any]) -> list[dict[str, Any]]:
    body = dict(checkpoint)
    claim = body.pop("checkpointSha256", None)
    if claim != CHECKPOINT_SELF or sha(canonical(body)) != CHECKPOINT_SELF or checkpoint.get("schema") != "finra-q004-historical-checkpoint/v2" or checkpoint.get("outcomesAccessed") is not False:
        fail("checkpoint self binding changed")
    completed = checkpoint.get("completed")
    if not isinstance(completed, list) or len(completed) != 1522 or checkpoint.get("totalRows") != 145103 or checkpoint.get("totalResponseBytes") != 257639538 or checkpoint.get("fieldsSha256") != FIELDS_SEQUENCE:
        fail("checkpoint denominator changed")
    return completed


def targets(queue: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    rows = queue.get("rows")
    if not isinstance(rows, list) or len(rows) != 656 or queue.get("population", {}).get("rows") != 656:
        fail("queue denominator changed")
    point_rows = 0
    for row in rows:
        candidates = row.get("pointEvidence", {}).get("tickerCandidates")
        if not isinstance(candidates, list):
            fail("point candidates changed")
        if candidates:
            point_rows += 1
        for candidate in candidates:
            ticker = candidate.get("ticker")
            if not isinstance(ticker, str) or not ticker.strip():
                fail("point ticker changed")
            result.setdefault(ticker.upper(), []).append({"work": row, "point": candidate})
    if point_rows != 185:
        fail("point ticker denominator changed")
    return result


def rebuild_private(completed: list[dict[str, Any]], by_symbol: dict[str, list[dict[str, Any]]]) -> tuple[list[dict[str, Any]], str]:
    output = []
    sequence = hashlib.sha256()
    global_ids: set[int] = set()
    total_rows = 0
    total_bytes = 0
    for item in completed:
        day = item.get("calendarDay")
        if not isinstance(day, str):
            fail("partition day changed")
        expected_offset = 0
        for page in item.get("pages", []):
            if page.get("offset") != expected_offset:
                fail("page order changed")
            raw_claim = page.get("rawSha256")
            if not isinstance(raw_claim, str) or len(raw_claim) != 64:
                fail("page hash changed")
            path = PRIVATE / "blobs" / "sha256" / raw_claim[:2] / raw_claim
            raw = path.read_bytes()
            if sha(raw) != raw_claim or len(raw) != page.get("bytes"):
                fail("private blob changed")
            rows = json.loads(raw)
            if not isinstance(rows, list) or len(rows) != page.get("rowCount"):
                fail("page row count changed")
            for source in rows:
                if not isinstance(source, dict) or source.get("calendarDay") != day:
                    fail("source row changed")
                identifier = source.get("OTCDailyListID")
                if not isinstance(identifier, int) or identifier in global_ids:
                    fail("source identifier changed")
                global_ids.add(identifier)
                sequence.update(canonical(source))
                sequence.update(b"\n")
                symbols = sorted({value.upper() for value in (source.get("oldSymbolCode"), source.get("newSymbolCode")) if isinstance(value, str) and value.strip()})
                event_day = date.fromisoformat(day[:10])
                for symbol in symbols:
                    for target in by_symbol.get(symbol, []):
                        work = target["work"]
                        delta = abs((event_day - date.fromisoformat(work["filedDate"])).days)
                        if delta <= 120:
                            event = {key: source.get(key) for key in ("OTCDailyListID", "calendarDay", "dailyListEventCode", "dailyListReasonDescription", "oldSymbolCode", "newSymbolCode", "oldSecurityDescription", "newSecurityDescription", "securityDeleteFlag", "cashAmountText")}
                            output.append({
                                "workItemId": work["workItemId"],
                                "accession": work["accession"],
                                "issuerCik": work["issuerCik"],
                                "filedDate": work["filedDate"],
                                "secPointTicker": symbol,
                                "secPointTitle": target["point"].get("title"),
                                "absoluteDayDifference": delta,
                                "finraEvent": event,
                            })
            expected_offset += len(rows)
            total_rows += len(rows)
            total_bytes += len(raw)
        if expected_offset != item.get("recordTotal"):
            fail("partition total changed")
    if total_rows != 145103 or total_bytes != 257639538 or len(global_ids) != 145103 or sequence.hexdigest() != ROW_SEQUENCE:
        fail("private rebuild changed")
    output.sort(key=lambda item: (item["workItemId"], item["finraEvent"]["calendarDay"], item["finraEvent"]["OTCDailyListID"], item["secPointTicker"]))
    return output, sequence.hexdigest()


def build_report(contract: dict[str, Any], queue: dict[str, Any], checkpoint: dict[str, Any]) -> dict[str, Any]:
    rows, sequence = rebuild_private(validate_checkpoint(checkpoint), targets(queue))
    work_ids = {row["workItemId"] for row in rows}
    event_ids = {row["finraEvent"]["OTCDailyListID"] for row in rows}
    if len(rows) != 3 or len(work_ids) != 2 or len(event_ids) != 3:
        fail("candidate denominator changed")
    value = {
        "schema": "early-detection-finra-sec-point-candidate-crosswalk/v1",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "gapQueueRawSha256": QUEUE_RAW,
        "gapQueueReportSha256": QUEUE_REPORT,
        "finraManifestRawSha256": MANIFEST_RAW,
        "finraManifestReportSha256": MANIFEST_REPORT,
        "finraCheckpointRawSha256": CHECKPOINT_RAW,
        "finraCheckpointSha256": CHECKPOINT_SELF,
        "finraRowSequenceSha256": sequence,
        "population": {"inputQueueRows": 656, "inputPointTickerRows": 185, "candidatePairs": len(rows), "matchedTargetRows": len(work_ids), "candidateEvents": len(event_ids), "resolvedRows": 0},
        "rows": rows,
        "claimLocks": contract["claimLocks"],
        "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], contract: dict[str, Any], queue: dict[str, Any], checkpoint: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "gapQueueRawSha256", "gapQueueReportSha256", "finraManifestRawSha256", "finraManifestReportSha256", "finraCheckpointRawSha256", "finraCheckpointSha256", "finraRowSequenceSha256", "population", "rows", "claimLocks", "outcomesAccessed", "reportSha256"}, "report")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value["schema"] != "early-detection-finra-sec-point-candidate-crosswalk/v1":
        fail("report self hash changed")
    expected = build_report(contract, queue, checkpoint)
    if value != expected:
        fail("report does not match private rebuild")
    if value["claimLocks"] != contract["claimLocks"] or any(item is not False for item in value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("claim boundary changed")
    for row in value["rows"]:
        exact_keys(row, {"workItemId", "accession", "issuerCik", "filedDate", "secPointTicker", "secPointTitle", "absoluteDayDifference", "finraEvent"}, "candidate row")
        exact_keys(row["finraEvent"], EXPECTED_FIELDS, "FINRA event")


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


def self_test(contract: dict[str, Any], queue: dict[str, Any], checkpoint: dict[str, Any]) -> dict[str, Any]:
    report = build_report(contract, queue, checkpoint)
    validate_report(report, contract, queue, checkpoint)
    kills = {}
    for name, mutate in {
        "candidatePromoted": lambda x: x["claimLocks"].__setitem__("securityIdentityResolved", True),
        "tickerJoinGrantsResolution": lambda x: x["claimLocks"].__setitem__("tickerJoinGrantsResolution", True),
        "eventLost": lambda x: x["rows"].pop(),
        "eventChanged": lambda x: x["rows"][0]["finraEvent"].__setitem__("oldSymbolCode", "TAMPER"),
        "cashAmountVerified": lambda x: x["claimLocks"].__setitem__("cashAmountVerified", True),
        "outcomesAccessed": lambda x: x.__setitem__("outcomesAccessed", True),
    }.items():
        item = copy.deepcopy(report)
        mutate(item)
        item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
        kills[name] = rejected(lambda item=item: validate_report(item, contract, queue, checkpoint))
    return {"schema": "early-detection-finra-sec-point-candidate-crosswalk-self-test/v1", "status": "PASS", "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract = validate_contract()
        queue = load_report(QUEUE, QUEUE_RAW, QUEUE_REPORT, "gap queue")
        load_report(MANIFEST, MANIFEST_RAW, MANIFEST_REPORT, "FINRA manifest")
        if file_sha(CHECKPOINT) != CHECKPOINT_RAW:
            fail("checkpoint raw bytes changed")
        checkpoint = json.loads(CHECKPOINT.read_bytes())
        if args.command == "verify-contract":
            result = {"schema": "early-detection-finra-sec-point-candidate-crosswalk-contract-verification/v1", "status": "PASS", "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract, queue, checkpoint)
        elif args.command == "build":
            report = build_report(contract, queue, checkpoint)
            validate_report(report, contract, queue, checkpoint)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "early-detection-finra-sec-point-candidate-crosswalk-build/v1", "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "candidatePairs": 3, "outcomesAccessed": False}
        else:
            raw = OUTPUT.read_bytes()
            report = json.loads(raw)
            validate_report(report, contract, queue, checkpoint)
            result = {"schema": "early-detection-finra-sec-point-candidate-crosswalk-verification/v1", "status": "PASS", "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "privateSourceRebuildVerified": True, "candidatePairs": 3, "outcomesAccessed": False}
    except (CrosswalkError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
