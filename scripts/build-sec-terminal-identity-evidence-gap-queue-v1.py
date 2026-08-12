#!/usr/bin/env python3
"""Build the outcome-blind source-work queue for unresolved SEC identities."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-identity-evidence-gap-queue-contract-v1.json"
PROFILE = ROOT / "reports" / "early-detection" / "sec-company-ticker-target-asof-profile-v1.json"
RESOLUTION = ROOT / "reports" / "early-detection" / "sec-terminal-primary-issuer-cik-resolution-v1.json"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-terminal-identity-evidence-gap-queue-v1.json"
EXPECTED_CONTRACT_RAW = "afd71fca111888081723398603905bd296ee270b236e52e005721f7c83274954"
PROFILE_RAW = "8a1ac3af58b7536c8951a6a0ffae85433623159f0da03d388a180635fd747688"
PROFILE_REPORT = "faae36bcf6e907caa0c2c149f0a1ec4c51d30f92e502b6e099969a7908db137a"
RESOLUTION_RAW = "f89767daf43c2d06ca87c0b57919b450749620026724b700ff94572117da7cfb"
RESOLUTION_REPORT = "3b450bef0120eee49fc4ab0f188578097ffd2fb53d781675b33c6db84809ead6"
POINT_TO_GAP = {
    "NO_ARCHIVE_SNAPSHOT_AT_OR_BEFORE_FILING": "GAP_NO_ARCHIVE_SNAPSHOT",
    "PRIOR_SNAPSHOT_ISSUER_ABSENT": "GAP_PRIOR_SNAPSHOT_ISSUER_ABSENT",
    "PRIOR_SNAPSHOT_MULTIPLE_TICKERS_CANDIDATE_ONLY": "GAP_PRIOR_SNAPSHOT_MULTIPLE_TICKERS",
    "PRIOR_SNAPSHOT_ONE_TICKER_CANDIDATE_ONLY": "GAP_SINGLE_POINT_TICKER_NEEDS_INTERVAL_AND_CORROBORATION",
}
EXPECTED_GAPS = {
    "GAP_NO_ARCHIVE_SNAPSHOT": 452,
    "GAP_PRIOR_SNAPSHOT_ISSUER_ABSENT": 19,
    "GAP_PRIOR_SNAPSHOT_MULTIPLE_TICKERS": 42,
    "GAP_SINGLE_POINT_TICKER_NEEDS_INTERVAL_AND_CORROBORATION": 143,
}
GAP_PRIORITY = {
    "GAP_NO_ARCHIVE_SNAPSHOT": 1,
    "GAP_PRIOR_SNAPSHOT_ISSUER_ABSENT": 2,
    "GAP_PRIOR_SNAPSHOT_MULTIPLE_TICKERS": 3,
    "GAP_SINGLE_POINT_TICKER_NEEDS_INTERVAL_AND_CORROBORATION": 4,
}


class QueueError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise QueueError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def load_self_hashed(path: Path, raw_claim: str, report_claim: str, rows: int, label: str) -> dict[str, Any]:
    raw = path.read_bytes()
    if sha(raw) != raw_claim:
        fail(f"{label} raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != report_claim or sha(canonical(body)) != report_claim or len(value.get("rows", [])) != rows:
        fail(f"{label} self binding changed")
    if value.get("outcomesAccessed") is not False:
        fail(f"{label} outcome boundary changed")
    return value


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "queueContract", "output", "claimLocks"}, "contract")
    if value["schema"] != "early-detection-sec-terminal-identity-evidence-gap-queue-contract/v1" or value["taskId"] != "Q003-SEC-TERMINAL-IDENTITY-EVIDENCE-GAP-QUEUE" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    if value["inputs"] != {
        "issuerResolution": {"path": "reports/early-detection/sec-terminal-primary-issuer-cik-resolution-v1.json", "rawSha256": RESOLUTION_RAW, "reportSha256": RESOLUTION_REPORT, "rows": 656},
        "tickerPointProfile": {"path": "reports/early-detection/sec-company-ticker-target-asof-profile-v1.json", "rawSha256": PROFILE_RAW, "reportSha256": PROFILE_REPORT, "rows": 656},
    }:
        fail("input binding changed")
    queue = value["queueContract"]
    exact_keys(queue, {"completionRequiresAuthoritativeEvidence", "expectedByGapClass", "expectedRows", "oneWorkItemPerTickerProfileRow", "priorityInputs", "priorityProhibitedInputs", "resolutionCreditFromPointTickerAlone", "sourceRequirementsByGapClass", "workItemState"}, "queue contract")
    if queue["expectedRows"] != 656 or queue["expectedByGapClass"] != EXPECTED_GAPS or queue["oneWorkItemPerTickerProfileRow"] is not True or queue["resolutionCreditFromPointTickerAlone"] is not False or queue["completionRequiresAuthoritativeEvidence"] is not True:
        fail("queue denominator changed")
    if queue["priorityInputs"] != ["gapClass", "queuePriorityRank", "profileRank"] or queue["priorityProhibitedInputs"] != ["price", "return", "endpoint", "pValue", "eligibility", "favorableResult"] or queue["workItemState"] != "UNRESOLVED_IDENTITY_EVIDENCE_REQUIRED":
        fail("queue priority boundary changed")
    if set(queue["sourceRequirementsByGapClass"]) != set(EXPECTED_GAPS) or any(not isinstance(items, list) or not items for items in queue["sourceRequirementsByGapClass"].values()):
        fail("source requirements changed")
    if value["output"] != {"path": "reports/early-detection/sec-terminal-identity-evidence-gap-queue-v1.json", "writeNewAtomic": True}:
        fail("output contract changed")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock changed")
    return value


def build_rows(contract: dict[str, Any], profile: dict[str, Any], resolution: dict[str, Any]) -> list[dict[str, Any]]:
    resolution_by_id = {row["resolutionRowId"]: row for row in resolution["rows"]}
    if len(resolution_by_id) != 656:
        fail("resolution row identity changed")
    provisional = []
    for point in profile["rows"]:
        source = resolution_by_id.get(point["sourceResolutionRowId"])
        if source is None or source["accession"] != point["accession"] or source["sourceDerivedIssuerCik"] != point["sourceDerivedIssuerCik"]:
            fail("profile to resolution binding changed")
        gap = POINT_TO_GAP.get(point["pointState"])
        if gap is None:
            fail("unknown point state")
        provisional.append((GAP_PRIORITY[gap], source["selectedIssuerQueueRow"]["priorityRank"], point["profileRank"], gap, point, source))
    provisional.sort(key=lambda item: item[:3])
    rows = []
    for rank, (_, queue_priority, _, gap, point, source) in enumerate(provisional, 1):
        row = {
            "workRank": rank,
            "workItemId": "",
            "workItemState": "UNRESOLVED_IDENTITY_EVIDENCE_REQUIRED",
            "gapClass": gap,
            "gapPriority": GAP_PRIORITY[gap],
            "queuePriorityRank": queue_priority,
            "sourceProfileRank": point["profileRank"],
            "sourceProfileRowId": point["profileRowId"],
            "sourceResolutionRowId": source["resolutionRowId"],
            "sourceExtractionRowId": source["sourceExtractionRowId"],
            "sourceOccurrenceId": source["sourceOccurrenceId"],
            "accession": point["accession"],
            "issuerCik": point["sourceDerivedIssuerCik"],
            "filedDate": point["queueFiledDate"],
            "pointEvidence": {"pointState": point["pointState"], "snapshot": point["snapshot"], "tickerCandidates": point["pointTickerCandidates"]},
            "requiredEvidence": contract["queueContract"]["sourceRequirementsByGapClass"][gap],
            "resolutionCreditGranted": False,
            "historicalIdentityResolved": False,
            "securityIdentityResolved": False,
            "listingIdentityResolved": False,
            "tickerReuseResolved": False,
            "outcomesAccessed": False,
        }
        row["workItemId"] = sha(canonical({key: val for key, val in row.items() if key != "workItemId"}))
        rows.append(row)
    return rows


def population(rows: list[dict[str, Any]]) -> dict[str, Any]:
    gaps = Counter(row["gapClass"] for row in rows)
    return {
        "rows": len(rows),
        "uniqueAccessions": len({row["accession"] for row in rows}),
        "uniqueIssuerCiks": len({row["issuerCik"] for row in rows}),
        "byGapClass": dict(sorted(gaps.items())),
        "resolvedRows": sum(row["resolutionCreditGranted"] for row in rows),
        "unresolvedRows": sum(not row["resolutionCreditGranted"] for row in rows),
    }


def build_report(contract: dict[str, Any], profile: dict[str, Any], resolution: dict[str, Any]) -> dict[str, Any]:
    rows = build_rows(contract, profile, resolution)
    value = {
        "schema": "early-detection-sec-terminal-identity-evidence-gap-queue/v1",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "profileRawSha256": PROFILE_RAW,
        "profileReportSha256": PROFILE_REPORT,
        "resolutionRawSha256": RESOLUTION_RAW,
        "resolutionReportSha256": RESOLUTION_REPORT,
        "population": population(rows),
        "rows": rows,
        "claimLocks": contract["claimLocks"],
        "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], contract: dict[str, Any], profile: dict[str, Any], resolution: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "profileRawSha256", "profileReportSha256", "resolutionRawSha256", "resolutionReportSha256", "population", "rows", "claimLocks", "outcomesAccessed", "reportSha256"}, "report")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value["schema"] != "early-detection-sec-terminal-identity-evidence-gap-queue/v1":
        fail("report self hash changed")
    if value["contractRawSha256"] != sha(CONTRACT.read_bytes()) or value["profileRawSha256"] != PROFILE_RAW or value["profileReportSha256"] != PROFILE_REPORT or value["resolutionRawSha256"] != RESOLUTION_RAW or value["resolutionReportSha256"] != RESOLUTION_REPORT:
        fail("report binding changed")
    expected = build_rows(contract, profile, resolution)
    if value["rows"] != expected:
        fail("rows do not match source rebuild")
    expected_population = {"rows": 656, "uniqueAccessions": 652, "uniqueIssuerCiks": 607, "byGapClass": dict(sorted(EXPECTED_GAPS.items())), "resolvedRows": 0, "unresolvedRows": 656}
    if value["population"] != population(expected) or value["population"] != expected_population:
        fail("population changed")
    if value["claimLocks"] != contract["claimLocks"] or any(item is not False for item in value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("claim boundary changed")
    if [row["workRank"] for row in value["rows"]] != list(range(1, 657)) or len({row["workItemId"] for row in value["rows"]}) != 656:
        fail("work identity changed")
    expected_keys = {"workRank", "workItemId", "workItemState", "gapClass", "gapPriority", "queuePriorityRank", "sourceProfileRank", "sourceProfileRowId", "sourceResolutionRowId", "sourceExtractionRowId", "sourceOccurrenceId", "accession", "issuerCik", "filedDate", "pointEvidence", "requiredEvidence", "resolutionCreditGranted", "historicalIdentityResolved", "securityIdentityResolved", "listingIdentityResolved", "tickerReuseResolved", "outcomesAccessed"}
    for row in value["rows"]:
        exact_keys(row, expected_keys, "work item")
        if row["workItemState"] != "UNRESOLVED_IDENTITY_EVIDENCE_REQUIRED" or any(row[key] is not False for key in ("resolutionCreditGranted", "historicalIdentityResolved", "securityIdentityResolved", "listingIdentityResolved", "tickerReuseResolved", "outcomesAccessed")):
            fail("work item promoted")


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
    except (QueueError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any], profile: dict[str, Any], resolution: dict[str, Any]) -> dict[str, Any]:
    report = build_report(contract, profile, resolution)
    validate_report(report, contract, profile, resolution)
    kills = {}
    for name, mutate in {
        "rowLoss": lambda x: x["rows"].pop(),
        "rowReorder": lambda x: x["rows"].reverse(),
        "pointTickerGrantsResolution": lambda x: x["rows"][next(i for i, row in enumerate(x["rows"]) if row["gapClass"] == "GAP_SINGLE_POINT_TICKER_NEEDS_INTERVAL_AND_CORROBORATION")].__setitem__("resolutionCreditGranted", True),
        "tickerJoinClaimed": lambda x: x["claimLocks"].__setitem__("tickerJoinAllowed", True),
        "gapPriorityChanged": lambda x: x["rows"][0].__setitem__("gapPriority", 999),
        "outcomeAccessed": lambda x: x.__setitem__("outcomesAccessed", True),
    }.items():
        item = copy.deepcopy(report)
        mutate(item)
        item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
        kills[name] = rejected(lambda item=item: validate_report(item, contract, profile, resolution))
    return {"schema": "early-detection-sec-terminal-identity-evidence-gap-queue-self-test/v1", "status": "PASS", "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract = validate_contract()
        profile = load_self_hashed(PROFILE, PROFILE_RAW, PROFILE_REPORT, 656, "profile")
        resolution = load_self_hashed(RESOLUTION, RESOLUTION_RAW, RESOLUTION_REPORT, 656, "resolution")
        if args.command == "verify-contract":
            result = {"schema": "early-detection-sec-terminal-identity-evidence-gap-queue-contract-verification/v1", "status": "PASS", "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract, profile, resolution)
        elif args.command == "build":
            report = build_report(contract, profile, resolution)
            validate_report(report, contract, profile, resolution)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "early-detection-sec-terminal-identity-evidence-gap-queue-build/v1", "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "rows": 656, "outcomesAccessed": False}
        else:
            raw = OUTPUT.read_bytes()
            report = json.loads(raw)
            validate_report(report, contract, profile, resolution)
            result = {"schema": "early-detection-sec-terminal-identity-evidence-gap-queue-verification/v1", "status": "PASS", "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "rows": 656, "outcomesAccessed": False}
    except (QueueError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
