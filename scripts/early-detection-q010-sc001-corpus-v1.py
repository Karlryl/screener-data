#!/usr/bin/env python3
"""Fail-closed verifier for Q010-SC-001 primary-source corpus v1."""

from __future__ import annotations

import argparse
import ast
import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research/early-detection-v4/q010-sc001-ca-dmv-av-2015-corpus-contract-v1.json"
EVENTS = ROOT / "state/early-detection-q010-sc001-source-events-v1.jsonl"
REPORT = ROOT / "reports/early-detection/q010-sc001-ca-dmv-av-2015-tel-v1.json"
TEST = ROOT / "tests/early-detection-q010-sc001-corpus-v1.test.js"
PREREG = ROOT / "protocol/early-detection/1.2.0/preregistration.json"
README = ROOT / "protocol/early-detection/1.2.0/README.md"

BASE_COMMIT = "504018d8bfd0fe5589c37be42e8c8b8c464fec9b"
DECISION_COMMIT = "3e909de17375d836b65462a60ded9aa744f9be5e"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
INTRODUCTION_SUBJECT = "Tag 914: Q010-DMV-Korpus point-in-time einfrieren"
CONTRACT_RAW_SHA256 = "2cedda656f45d00f20d3b47b738a21ece418be44f9cbaefb1c7cf8f56fa62305"
EVENTS_RAW_SHA256 = "4bc5010eb446f53c8efd3a8114f462f5ec87b768dffc83348ce437070aeeffa2"
REPORT_RAW_SHA256 = "fecbcf29d38176e6218fe4e1cd7de33690889feedd6930f2a7ec4501fd1aee3d"
TEST_RAW_SHA256 = "a89a02544837347200d9d41b8574eb5a1518d105b8628f0e8a7dd7ae4cd262cc"
CONTROLLER_NORMALIZED_SHA256 = "f62befa5f27b2ba6d81a062f3c1e929cd415f2549e9a3ba00988648befbfcce8"
ZERO_SHA = "0" * 64

OWNED_PATHS = [
    "research/early-detection-v4/q010-sc001-ca-dmv-av-2015-corpus-contract-v1.json",
    "scripts/early-detection-q010-sc001-corpus-v1.py",
    "state/early-detection-q010-sc001-source-events-v1.jsonl",
    "reports/early-detection/q010-sc001-ca-dmv-av-2015-tel-v1.json",
    "tests/early-detection-q010-sc001-corpus-v1.test.js",
]
FOREIGN_UNTRACKED = {
    ".tmp-form15-final/",
    ".tmp-form15-tag736/",
    "reports/early-detection/sec-form15-structured-metadata-v1.json",
    "reports/early-detection/sec-form15-structured-metadata-v1.json.gz",
    "reports/early-detection/sec-form345-issuer-symbol-point-v3.json",
    "scripts/__pycache__/",
}
BASE_PATH_HASHES = {
    "research/early-detection-v4/q010-subchunk-governance-contract-v1.json": "bb408559fd812af02eab8dba7851e7d18ca1b16aa87795f9200801e4e6df8bc2",
    "scripts/early-detection-q010-subchunk-v1.py": "bdf38bc67dfe91837f0cd05d9f8a69ed6d7a50c338b8812dd5aff80585d2102a",
    "state/early-detection-q010-subchunk-events-v1.jsonl": "7964cc2421d56760834b4cc9b5032d5e484f17c5b8e7ec6ee25270cb7a565078",
    "state/early-detection-q010-subchunk-state-v1.json": "5475e6e851fa7bf351e1d5c2c6ae5cf0edbb2921e7a5dc6e6353ba2c0ca81fb3",
    "tests/early-detection-q010-subchunk-v1.test.js": "04c0a2088ad5711948defc2e920a4a0b5ff1a77a072a0e2b81f68e486da685e3",
}
BASE_PATH_STATUSES = {
    "M\tresearch/early-detection-v4/q010-subchunk-governance-contract-v1.json",
    "M\tscripts/early-detection-q010-subchunk-v1.py",
    "M\tstate/early-detection-q010-subchunk-events-v1.jsonl",
    "M\tstate/early-detection-q010-subchunk-state-v1.json",
    "M\ttests/early-detection-q010-subchunk-v1.test.js",
}
EXPECTED_SOURCE_IDS = {
    "SRC-CA-DMV-2015-DISENGAGEMENT-INDEX",
    "SRC-CA-DMV-BOSCH-2015",
    "SRC-CA-DMV-DELPHI-2015",
    "SRC-CA-DMV-GOOGLE-2015",
    "SRC-CA-DMV-NISSAN-2015",
    "SRC-CA-DMV-MERCEDES-2015",
    "SRC-CA-DMV-TESLA-2015",
    "SRC-CA-DMV-VOLKSWAGEN-2015",
    "SRC-SEC-TESLA-2015Q3-INDEX",
    "SRC-SEC-TESLA-2015Q3-10Q",
    "SRC-SEC-TESLA-2014-10K-INDEX",
    "SRC-SEC-TESLA-2014-10K",
}
EXPECTED_NAMES = [
    "Bosch, LLC",
    "Delphi Automotive Systems, LLC",
    "Google Auto, LLC",
    "Nissan North America, Inc",
    "Mercedes-Benz Research & Development North America, Inc",
    "Tesla Motors, Inc.",
    "Volkswagen Group of America, Inc.",
]


class GateError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GateError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def raw_sha(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), f"{path.name} must contain an object")
    return value


def parse_ts(value: str) -> dt.datetime:
    require(isinstance(value, str) and (value.endswith("Z") or re.search(r"[+-]\d\d:\d\d$", value) is not None), f"timestamp is not timezone-qualified: {value!r}")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(parsed.tzinfo is not None, f"timestamp lacks timezone: {value}")
    return parsed.astimezone(dt.timezone.utc)


def run_process(args: list[str], *, binary: bool = False) -> str | bytes:
    if not args or args[0].lower() != "git":
        raise GateError("only git child execution is allowed")
    try:
        result = subprocess.run(
            args,
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=not binary,
            timeout=60,
        )
    except subprocess.TimeoutExpired as exc:
        raise GateError(f"process timeout: {args[0]}") from exc
    if result.returncode != 0:
        stderr = result.stderr if not binary else result.stderr.decode("utf-8", errors="replace")
        raise GateError(f"process failed: {' '.join(args)}: {stderr.strip()}")
    return result.stdout


def git_text(*args: str) -> str:
    output = run_process(["git", *args])
    require(isinstance(output, str), "git text result type")
    return output.strip()


def git_blob(commit: str, path: str) -> bytes:
    output = run_process(["git", "cat-file", "blob", f"{commit}:{path}"], binary=True)
    require(isinstance(output, bytes), "git blob result type")
    return output


def validate_execution_surface() -> None:
    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    parents: dict[ast.AST, ast.AST] = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node
    subprocess_calls = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if isinstance(node.func.value, ast.Name) and node.func.value.id == "subprocess":
                subprocess_calls.append(node)
                require(node.func.attr == "run", "only subprocess.run is allowed")
                cursor: ast.AST | None = node
                owner = None
                while cursor in parents:
                    cursor = parents[cursor]
                    if isinstance(cursor, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        owner = cursor.name
                        break
                require(owner == "run_process", "subprocess.run must be encapsulated")
    require(len(subprocess_calls) == 1, "exactly one subprocess surface required")


def normalized_controller_sha() -> str:
    data = Path(__file__).read_bytes()
    pattern = rb'(CONTROLLER_NORMALIZED_SHA256 = ")[0-9a-f]{64}("\r?\n)'
    normalized, count = re.subn(pattern, rb'\g<1>' + (b"0" * 64) + rb'\g<2>', data)
    require(count == 1, "controller normalized binding marker count")
    return sha256_bytes(normalized)


def contract_self_sha(contract: dict[str, Any]) -> str:
    value = copy.deepcopy(contract)
    value["contractSelfSha256"] = ZERO_SHA
    return sha256_bytes(canonical(value))


def event_sha(event: dict[str, Any]) -> str:
    value = copy.deepcopy(event)
    value.pop("eventSha256", None)
    return sha256_bytes(canonical(value))


def source_manifest_digest(contract: dict[str, Any]) -> str:
    compact = [
        {
            "sourceId": s["sourceId"],
            "payloadSha256": s["payloadSha256"],
            "payloadBytes": s["payloadBytes"],
            "availabilityKnownAtUtc": s["availabilityKnownAtUtc"],
        }
        for s in contract["sourceManifest"]
    ]
    return sha256_bytes(canonical(compact))


def report_projection(contract: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": "early-detection-q010-sc001-tel-report/v1",
        "materializedAt": event["createdAt"],
        "sourceEventId": event["eventId"],
        "sourceEventSha256": event["eventSha256"],
        "contractSelfSha256": contract["contractSelfSha256"],
        "subchunkId": contract["governanceStartBinding"]["subchunkId"],
        "chunkStatus": contract["completionDecision"]["chunkStatus"],
        "sourceManifestSha256": source_manifest_digest(contract),
        "sourceCount": len(contract["sourceManifest"]),
        "sourceManifest": [
            {
                "sourceId": s["sourceId"],
                "primaryPublisher": s["primaryPublisher"],
                "availabilityKnownAtUtc": s["availabilityKnownAtUtc"],
                "payloadSha256": s["payloadSha256"],
                "payloadBytes": s["payloadBytes"],
                "signalUse": s["signalUse"],
            }
            for s in contract["sourceManifest"]
        ],
        "frozenTreatmentPopulation": contract["frozenTreatmentPopulation"],
        "researchBudgetExecution": contract["researchBudgetExecution"],
        "provisionalEvidenceAssembly": contract["provisionalEvidenceAssembly"],
        "controlPopulation": contract["controlPopulation"],
        "blindingIncident": contract["blindingIncident"],
        "completionDecision": contract["completionDecision"],
        "locks": {
            "candidateStateComputationAllowed": False,
            "growthVisibilityComputationAllowed": False,
            "outcomeFilesOpened": False,
            "returnsAccessed": False,
            "gqsAccessed": False,
            "scientificCredit": "NONE",
            "nextQ010SubchunkAuthorized": False,
            "q003SchedulerEligible": False,
        },
    }


def materialize_report(contract: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    projection = report_projection(contract, event)
    projection_sha = sha256_bytes(canonical(projection))
    report = copy.deepcopy(projection)
    report["projectionSha256"] = projection_sha
    report["reportSelfSha256"] = ZERO_SHA
    report["reportSelfSha256"] = sha256_bytes(canonical(report))
    return report


def load_events() -> list[dict[str, Any]]:
    lines = EVENTS.read_text(encoding="utf-8").splitlines()
    require(lines and all(line.strip() for line in lines), "event log empty or contains blank line")
    values = [json.loads(line) for line in lines]
    require(all(isinstance(v, dict) for v in values), "event must be object")
    return values


def validate_protocol(contract: dict[str, Any]) -> None:
    binding = contract["protocolBinding"]
    require(raw_sha(PREREG) == binding["preregistrationRawSha256"], "preregistration raw drift")
    require(raw_sha(README) == binding["readmeRawSha256"], "protocol README raw drift")
    prereg = load_json(PREREG)
    require(prereg["researchQuestion"] == binding["researchQuestion"], "research question drift")
    matrix = prereg["matrix"]
    require(matrix["dimensions"]["T"]["levels"]["2"] == "observable investment, orders, regulation or commercial introduction", "T2 drift")
    require(matrix["dimensions"]["E"]["levels"]["2"] == "documented product, customer, order or necessary infrastructure", "E2 drift")
    require(matrix["dimensions"]["L"]["levels"]["1"] == "one weak signal", "L1 drift")
    require(matrix["dimensions"]["L"]["managementStatementsAloneMaximum"] == 1, "management ceiling drift")
    require(matrix["states"]["RESEARCH_WATCH"] == "T>=2 and E>=2 and L>=1", "watch threshold drift")


def validate_contract(contract: dict[str, Any]) -> None:
    require(contract["schema"] == "early-detection-q010-sc001-corpus-contract/v1", "contract schema")
    require(contract_self_sha(contract) == contract["contractSelfSha256"], "contract self hash")
    require(contract["repository"]["baseCommit"] == BASE_COMMIT, "base commit drift")
    require(contract["repository"]["expectedIntroductionSubject"] == INTRODUCTION_SUBJECT, "introduction subject drift")
    require(contract["repository"]["expectedIntroductionPaths"] == OWNED_PATHS, "owned paths drift")
    require(contract["governanceStartBinding"]["startCommit"] == BASE_COMMIT, "start binding drift")
    require(contract["governanceStartBinding"]["decisionCommit"] == DECISION_COMMIT, "decision binding drift")
    require(contract["governanceStartBinding"]["sourceAccessWasForbiddenBeforeRemoteStart"] is True, "pre-start access lock")
    require(contract["governanceStartBinding"]["sourceAccessBeganAfterRemoteStart"] is True, "post-start access claim")
    policy = contract["sourcePolicy"]
    cutoff = parse_ts(policy["sourceCutoffInclusiveUtc"])
    require(policy["primaryAuthorityRequiredForTEL"] is True, "primary authority policy")
    require(policy["secondaryCarrierMayTransportButCannotSetTEL"] is True, "carrier policy")
    require(policy["payloadSha256MustMatchExactArchivedRawBytes"] is True, "raw payload binding policy")
    require(policy["privatePayloadsPublished"] is False, "private payload publication lock")
    require(policy["modernTermBackprojectionForbidden"] is True, "modern term lock")

    sources = contract["sourceManifest"]
    require(len(sources) == 12, "source count")
    ids = [s["sourceId"] for s in sources]
    require(len(ids) == len(set(ids)) and set(ids) == EXPECTED_SOURCE_IDS, "source IDs")
    seen_blobs: set[str] = set()
    start_committed = parse_ts(contract["governanceStartBinding"]["startCommitCommittedAt"])
    for source in sources:
        require(source["sourceAuthorityTier"] == "PRIMARY", f"non-primary source: {source['sourceId']}")
        require(source["primaryPublisher"] in {"CALIFORNIA_DMV", "US_SEC"}, "publisher")
        require(source["carrier"] == "INTERNET_ARCHIVE_WAYBACK_MACHINE", "carrier")
        require(source["carrierRole"] == "TRANSPORT_ONLY_NO_TEL_CREDIT", "carrier role")
        require(source["sourceClassAvailabilityContractPassed"] is True, "source availability contract")
        require(source["sourceBeforeCutoff"] is True, "source before cutoff claim")
        require(source["lawfulReproducibleAccess"] is True, "access provenance")
        require(re.fullmatch(r"[0-9a-f]{64}", source["payloadSha256"]) is not None, "payload hash format")
        require(source["payloadBytes"] > 0, "payload size")
        require(source["privateBlobName"].startswith(source["payloadSha256"] + "."), "content-addressed blob name")
        require(source["privateBlobName"] not in seen_blobs, "duplicate private blob")
        seen_blobs.add(source["privateBlobName"])
        require(parse_ts(source["sourceTimestampUtc"]) <= cutoff, "source timestamp after cutoff")
        require(parse_ts(source["observationTimestampUtc"]) <= cutoff, "observation after cutoff")
        require(parse_ts(source["availabilityKnownAtUtc"]) <= cutoff, "knownAt after cutoff")
        require(parse_ts(source["retrievedAtUtc"]) >= start_committed, "retrieval before start commit")
        require(source["originalUri"].startswith("http"), "original URI")
        require(source["carrierUri"].startswith("https://web.archive.org/web/"), "carrier URI")

    population = contract["frozenTreatmentPopulation"]
    rows = population["rows"]
    require(population["populationFrozen"] is True and population["populationCount"] == 7, "population freeze")
    require([r["reportedLegalName"] for r in rows] == EXPECTED_NAMES, "census names or order")
    require(population["selectionUsedLaterOutcomeKnowledge"] is False, "selection hindsight lock")
    report_ids = {s["sourceId"] for s in sources if s["primaryPublisher"] == "CALIFORNIA_DMV"}
    for row in rows:
        require(row["reportSourceId"] in report_ids, "population dangling report source")
        require(row["dimensionsAttempted"] == ["T", "E", "L"], "unbalanced dimension attempt")
    resolved = [r for r in rows if r["identityStatus"] == "PIT_EXACT_SINGLE_LISTING_RESOLVED"]
    require(len(resolved) == 1 and resolved[0]["reportedLegalName"] == "Tesla Motors, Inc.", "resolved identity set")
    tesla = resolved[0]
    require(tesla["entityId"] == "CIK0001318605" and tesla["cik"] == "0001318605", "Tesla entity identity")
    require(tesla["listingId"] == "CIK0001318605-XNAS-TSLA-2015", "Tesla listing identity")
    require(tesla["effectiveTicker"] == "TSLA" and tesla["exchangeMic"] == "XNAS", "Tesla listing fields")
    identity_refs = tesla["identityEvidenceSourceIds"]
    require(identity_refs == ["SRC-SEC-TESLA-2014-10K-INDEX", "SRC-SEC-TESLA-2014-10K"], "Tesla identity source set")
    source_by_id = {s["sourceId"]: s for s in sources}
    require(parse_ts(tesla["identityKnownAtUtc"]) == max(parse_ts(source_by_id[ref]["availabilityKnownAtUtc"]) for ref in identity_refs), "identity knownAt mismatch")
    require(tesla["signalEligible"] is True, "Tesla eligibility")
    for row in rows:
        if row is not tesla:
            require(row["identityStatus"] == "REJECTED_HOLD", "unresolved row status")
            require(row["signalEligible"] is False and row["entityId"] is None and row["listingId"] is None, "unresolved identity fail closed")

    budget = contract["researchBudgetExecution"]
    require(budget["sameDimensionSetAppliedToEveryTreatmentRow"] is True, "dimension budget")
    require(budget["samePrimarySourceClassPriorityApplied"] is True, "source budget")
    require(budget["singleDimensionExpansionBeyondBudget"] is False, "single dimension expansion")
    require(budget["secondaryCarrierSignalCredit"] is False, "secondary source credit")
    require(budget["scientificCredit"] == "NONE", "budget science credit")

    evidence = contract["provisionalEvidenceAssembly"]
    require(evidence["status"] == "TYPED_HOLD", "assembly must remain hold")
    require(evidence["codingStatus"] == "NONBLINDED_LLM_METHODS_PILOT_NOT_INDEPENDENT_CODING", "coding status")
    require(evidence["entityId"] == tesla["entityId"] and evidence["listingId"] == tesla["listingId"], "assembly identity coherence")
    require(evidence["candidateState"] is None and evidence["candidateStateComputationAllowed"] is False, "candidate lock")
    dimensions = evidence["dimensions"]
    require(list(dimensions) == ["T", "E", "L"], "dimension order")
    require(dimensions["T"]["proposedLevel"] == 2, "T level")
    require(dimensions["E"]["proposedLevel"] == 2, "E level")
    require(dimensions["L"]["proposedLevel"] == 1, "L level")
    require(dimensions["L"]["managementStatementsAloneMaximum"] == 1, "L management ceiling")
    dimension_times = []
    for dimension in ["T", "E", "L"]:
        refs = dimensions[dimension]["sourceIds"]
        require(refs and len(refs) == len(set(refs)), "dimension source refs")
        require(all(ref in source_by_id for ref in refs), "dangling dimension source")
        computed = max(parse_ts(source_by_id[ref]["availabilityKnownAtUtc"]) for ref in refs)
        require(parse_ts(dimensions[dimension]["knownAtUtc"]) == computed, "dimension knownAt mismatch")
        dimension_times.append(computed)
    require(parse_ts(evidence["signalKnownAtUtc"]) == max(dimension_times), "signal knownAt mismatch")
    require(parse_ts(evidence["evaluationAtUtc"]) == parse_ts(evidence["signalKnownAtUtc"]), "evaluationAt mismatch")
    require(evidence["growthVisibilityStatus"] == "NOT_COMPUTED", "growth visibility lock")
    require(evidence["gqsStatus"] == "NOT_ACCESSED" and evidence["marketStatus"] == "NOT_ACCESSED", "confirmation clock lock")
    require(evidence["scientificCredit"] == "NONE", "evidence science credit")

    controls = contract["controlPopulation"]
    require(controls["status"] == "REJECTED_HOLD" and controls["populationFrozen"] is False and controls["rows"] == [], "control hold")
    require(controls["controlOrBalanceClaimAllowed"] is False and controls["scientificCredit"] == "NONE", "control claims")

    incident = contract["blindingIncident"]
    require(incident["occurred"] is True and incident["type"] == "OPERATOR_BLINDING_BREACH", "incident must remain recorded")
    require(incident["priceValuesPersistedInCorpus"] is False, "price values must not persist")
    require(incident["priceValuesUsedForPopulationSelection"] is False and incident["priceValuesUsedForTELCoding"] is False, "price use lock")
    require(incident["returnsAccessed"] is False and incident["outcomeSeriesAccessed"] is False and incident["gqsAccessed"] is False, "outcome access lock")
    require(incident["candidateOrScientificClaimBlocked"] is True, "incident hold")

    completion = contract["completionDecision"]
    require(completion["chunkStatus"] == "TYPED_HOLD_COMPLETED", "chunk status")
    require(completion["nextQ010SubchunkAuthorized"] is False and completion["newAppendOnlyPreChunkDecisionRequired"] is True, "next subchunk lock")
    require(completion["supportingSideProjectAutomaticallyAuthorized"] is False, "side project lock")
    require(completion["q003SchedulerEligible"] is False, "Q003 scheduler lock")
    for field in ["earlyDetectionSystemBuilt", "historicalTimeCapsuleBuilt", "researchWatchCandidateBuilt", "preGrowthCandidateBuilt", "outcomeFilesOpened"]:
        require(completion[field] is False, f"completion lock {field}")
    require(completion["scientificCredit"] == "NONE", "completion science credit")


def validate_events(contract: dict[str, Any], events: list[dict[str, Any]]) -> dict[str, Any]:
    require(len(events) == 1, "exactly one corpus event required")
    event = events[0]
    require(event["schema"] == "early-detection-q010-sc001-source-event/v1", "event schema")
    require(event["eventId"] == "Q010-SC001-EVT-00000001" and event["sequence"] == 1, "event identity")
    require(event["eventType"] == "CORPUS_FROZEN_TYPED_HOLD", "event type")
    require(event["previousEventSha256"] is None, "first event predecessor")
    require(event_sha(event) == event["eventSha256"], "event self hash")
    require(parse_ts(event["createdAt"]) >= max(parse_ts(s["retrievedAtUtc"]) for s in contract["sourceManifest"]), "event predates source retrieval")
    payload = event["payload"]
    require(payload["subchunkId"] == contract["governanceStartBinding"]["subchunkId"], "event subchunk")
    require(payload["contractSelfSha256"] == contract["contractSelfSha256"], "event contract binding")
    require(payload["chunkStatus"] == "TYPED_HOLD_COMPLETED", "event status")
    require(payload["sourceManifestSha256"] == source_manifest_digest(contract), "event manifest binding")
    require(payload["sourceCount"] == 12 and payload["treatmentPopulationCount"] == 7, "event counts")
    require(payload["candidateState"] is None and payload["candidateStateComputationAllowed"] is False, "event candidate lock")
    require(payload["blindingIncidentId"] == contract["blindingIncident"]["incidentId"], "event incident binding")
    require(payload["controlPopulationStatus"] == "REJECTED_HOLD", "event control hold")
    require(payload["scientificCredit"] == "NONE", "event science credit")
    require(payload["nextQ010SubchunkAuthorized"] is False and payload["q003SchedulerEligible"] is False, "event scheduler lock")
    require(payload["outcomeFilesOpened"] is False and payload["returnsAccessed"] is False and payload["gqsAccessed"] is False, "event access locks")
    return event


def validate_report(contract: dict[str, Any], event: dict[str, Any], report: dict[str, Any]) -> None:
    expected = materialize_report(contract, event)
    require(report == expected, "report is not exact event/contract materialization")
    require(report["reportSelfSha256"] == sha256_bytes(canonical({**report, "reportSelfSha256": ZERO_SHA})), "report self hash")


def validate_raw_bindings() -> None:
    require(raw_sha(CONTRACT) == CONTRACT_RAW_SHA256, "contract raw binding")
    require(raw_sha(EVENTS) == EVENTS_RAW_SHA256, "events raw binding")
    require(raw_sha(REPORT) == REPORT_RAW_SHA256, "report raw binding")
    require(raw_sha(TEST) == TEST_RAW_SHA256, "test raw binding")
    require(normalized_controller_sha() == CONTROLLER_NORMALIZED_SHA256, "controller normalized binding")


def validate_base_commit(contract: dict[str, Any]) -> None:
    require(git_text("show", "-s", "--format=%s", BASE_COMMIT) == "Tag 913: Q010-Subchunk prospektiv starten", "base subject")
    require(git_text("rev-parse", f"{BASE_COMMIT}^") == DECISION_COMMIT, "base parent")
    statuses = set(git_text("diff-tree", "--no-commit-id", "--name-status", "-r", BASE_COMMIT).splitlines())
    require(statuses == BASE_PATH_STATUSES, "base exact five modified paths")
    for path, expected_hash in BASE_PATH_HASHES.items():
        require(sha256_bytes(git_blob(BASE_COMMIT, path)) == expected_hash, f"base blob drift: {path}")
    require(parse_ts(git_text("show", "-s", "--format=%cI", BASE_COMMIT)) >= parse_ts(contract["governanceStartBinding"]["startEventCreatedAt"]), "base commit predates start event")


def status_entries() -> list[tuple[str, str]]:
    output = git_text("status", "--porcelain=v1", "--untracked-files=normal")
    if not output:
        return []
    entries = []
    for line in output.splitlines():
        require(len(line) >= 4, "malformed git status line")
        entries.append((line[:2], line[3:]))
    return entries


def validate_worktree(phase: str) -> None:
    entries = status_entries()
    owned = {path: code for code, path in entries if path in OWNED_PATHS}
    foreign = {(code, path) for code, path in entries if path not in OWNED_PATHS}
    require(all(code == "??" and path in FOREIGN_UNTRACKED for code, path in foreign), f"unexpected foreign worktree entry: {sorted(foreign)}")
    if phase == "PRE_INTRODUCTION":
        require(owned == {path: "??" for path in OWNED_PATHS}, "pre-introduction owned paths must be exactly five untracked files")
    else:
        require(not owned, "post-introduction owned paths must be clean")


def validate_phase(contract: dict[str, Any]) -> str:
    require(git_text("rev-parse", "--show-toplevel").replace("\\", "/") == str(ROOT).replace("\\", "/"), "authoritative worktree")
    require(git_text("branch", "--show-current") == contract["repository"]["branch"], "branch")
    require(git_text("remote", "get-url", "origin") == REMOTE_URL, "remote URL")
    head = git_text("rev-parse", "HEAD")
    upstream = git_text("rev-parse", "@{u}")
    live_line = git_text("ls-remote", "origin", REMOTE_REF)
    require(live_line, "live remote ref missing")
    live = live_line.split()[0]
    require(head == upstream == live, "HEAD/upstream/live mismatch")
    if head == BASE_COMMIT:
        phase = "PRE_INTRODUCTION"
    else:
        require(git_text("rev-parse", f"{head}^") == BASE_COMMIT, "introduction is not direct child")
        require(git_text("show", "-s", "--format=%s", head) == INTRODUCTION_SUBJECT, "introduction subject")
        statuses = git_text("diff-tree", "--no-commit-id", "--name-status", "-r", head).splitlines()
        require(len(statuses) == 5 and set(statuses) == {f"A\t{path}" for path in OWNED_PATHS}, "introduction exact five added paths")
        event = load_events()[0]
        require(parse_ts(git_text("show", "-s", "--format=%cI", head)) >= parse_ts(event["createdAt"]), "introduction commit predates corpus event")
        for path in OWNED_PATHS:
            require(git_blob(head, path) == (ROOT / path).read_bytes(), f"working bytes differ from introduced blob: {path}")
        phase = "POST_INTRODUCTION"
    validate_worktree(phase)
    return phase


def validate_private_store(contract: dict[str, Any], store: Path) -> None:
    require(store.is_dir(), "private store missing")
    expected = {s["privateBlobName"]: s for s in contract["sourceManifest"]}
    actual = {p.name: p for p in store.iterdir() if p.is_file()}
    require(set(actual) == set(expected), "private store file set differs from manifest")
    for name, source in expected.items():
        path = actual[name]
        require(path.stat().st_size == source["payloadBytes"], f"private payload size: {name}")
        require(raw_sha(path) == source["payloadSha256"], f"private payload hash: {name}")


def verify(remote: bool, private_store: str | None) -> dict[str, Any]:
    require(remote, "--remote is mandatory")
    validate_execution_surface()
    validate_raw_bindings()
    contract = load_json(CONTRACT)
    events = load_events()
    report = load_json(REPORT)
    validate_contract(contract)
    validate_protocol(contract)
    event = validate_events(contract, events)
    validate_report(contract, event, report)
    validate_base_commit(contract)
    phase = validate_phase(contract)
    private_verified = False
    if private_store is not None:
        validate_private_store(contract, Path(private_store))
        private_verified = True
    return {
        "status": "PASS" if phase == "POST_INTRODUCTION" else "PRE_INTRODUCTION_DIAGNOSTIC",
        "phase": phase,
        "subchunkId": contract["governanceStartBinding"]["subchunkId"],
        "chunkStatus": contract["completionDecision"]["chunkStatus"],
        "sourceCount": len(contract["sourceManifest"]),
        "treatmentPopulationCount": contract["frozenTreatmentPopulation"]["populationCount"],
        "resolvedListedTreatmentEntities": 1,
        "typedIdentityHolds": 6,
        "controlPopulationStatus": contract["controlPopulation"]["status"],
        "provisionalTEL": {"T": 2, "E": 2, "L": 1},
        "candidateState": None,
        "candidateStateComputationAllowed": False,
        "blindingIncidentRecorded": True,
        "privatePayloadsPublished": False,
        "privatePayloadsVerified": private_verified,
        "outcomeFilesOpened": False,
        "returnsAccessed": False,
        "gqsAccessed": False,
        "scientificCredit": "NONE",
        "nextQ010SubchunkAuthorized": False,
        "q003SchedulerEligible": False,
        "controllerChildExecutions": 0,
    }


def rejected(action: Any) -> bool:
    try:
        action()
    except (GateError, KeyError, TypeError, ValueError, IndexError):
        return True
    return False


def self_test() -> dict[str, Any]:
    validate_execution_surface()
    contract = load_json(CONTRACT)
    events = load_events()
    report = load_json(REPORT)
    validate_contract(contract)
    validate_protocol(contract)
    event = validate_events(contract, events)
    validate_report(contract, event, report)
    kills: list[str] = []

    def mutate_contract(name: str, mutator: Any) -> None:
        value = copy.deepcopy(contract)
        mutator(value)
        value["contractSelfSha256"] = contract_self_sha(value)
        if rejected(lambda: validate_contract(value)):
            kills.append(name)

    mutate_contract("delete-source", lambda x: x["sourceManifest"].pop())
    mutate_contract("source-hash", lambda x: x["sourceManifest"][0].__setitem__("payloadSha256", "f" * 64))
    mutate_contract("post-cutoff-known-at", lambda x: x["sourceManifest"][0].__setitem__("availabilityKnownAtUtc", "2021-01-01T00:00:00Z"))
    mutate_contract("carrier-credit", lambda x: x["sourceManifest"][0].__setitem__("carrierRole", "SIGNAL"))
    mutate_contract("secondary-source", lambda x: x["sourceManifest"][0].__setitem__("sourceAuthorityTier", "SECONDARY"))
    mutate_contract("availability-fail", lambda x: x["sourceManifest"][0].__setitem__("sourceClassAvailabilityContractPassed", False))
    mutate_contract("retrieval-before-start", lambda x: x["sourceManifest"][0].__setitem__("retrievedAtUtc", "2026-08-13T21:00:00Z"))
    mutate_contract("omit-census-row", lambda x: x["frozenTreatmentPopulation"]["rows"].pop())
    mutate_contract("census-name", lambda x: x["frozenTreatmentPopulation"]["rows"][0].__setitem__("reportedLegalName", "Changed"))
    mutate_contract("unresolved-made-eligible", lambda x: x["frozenTreatmentPopulation"]["rows"][0].__setitem__("signalEligible", True))
    mutate_contract("tesla-ticker", lambda x: x["frozenTreatmentPopulation"]["rows"][5].__setitem__("effectiveTicker", "OTHER"))
    mutate_contract("identity-known-at", lambda x: x["frozenTreatmentPopulation"]["rows"][5].__setitem__("identityKnownAtUtc", "2015-11-16T05:20:44Z"))
    mutate_contract("dimension-omitted", lambda x: x["frozenTreatmentPopulation"]["rows"][0].__setitem__("dimensionsAttempted", ["T", "E"]))
    mutate_contract("single-dimension-expansion", lambda x: x["researchBudgetExecution"].__setitem__("singleDimensionExpansionBeyondBudget", True))
    mutate_contract("T-level", lambda x: x["provisionalEvidenceAssembly"]["dimensions"]["T"].__setitem__("proposedLevel", 3))
    mutate_contract("E-level", lambda x: x["provisionalEvidenceAssembly"]["dimensions"]["E"].__setitem__("proposedLevel", 3))
    mutate_contract("L-level", lambda x: x["provisionalEvidenceAssembly"]["dimensions"]["L"].__setitem__("proposedLevel", 2))
    mutate_contract("candidate-state", lambda x: x["provisionalEvidenceAssembly"].__setitem__("candidateState", "RESEARCH_WATCH"))
    mutate_contract("growth-computed", lambda x: x["provisionalEvidenceAssembly"].__setitem__("growthVisibilityStatus", "FALSE"))
    mutate_contract("control-frozen", lambda x: x["controlPopulation"].__setitem__("populationFrozen", True))
    mutate_contract("incident-erased", lambda x: x["blindingIncident"].__setitem__("occurred", False))
    mutate_contract("price-persisted", lambda x: x["blindingIncident"].__setitem__("priceValuesPersistedInCorpus", True))
    mutate_contract("return-access", lambda x: x["blindingIncident"].__setitem__("returnsAccessed", True))
    mutate_contract("outcome-access", lambda x: x["blindingIncident"].__setitem__("outcomeSeriesAccessed", True))
    mutate_contract("science-credit", lambda x: x["completionDecision"].__setitem__("scientificCredit", "CONFIRMATORY"))
    mutate_contract("next-authorized", lambda x: x["completionDecision"].__setitem__("nextQ010SubchunkAuthorized", True))
    mutate_contract("q003-eligible", lambda x: x["completionDecision"].__setitem__("q003SchedulerEligible", True))
    mutate_contract("system-built", lambda x: x["completionDecision"].__setitem__("earlyDetectionSystemBuilt", True))
    mutate_contract("dangling-source", lambda x: x["provisionalEvidenceAssembly"]["dimensions"]["E"].__setitem__("sourceIds", ["MISSING"]))

    event_mut = copy.deepcopy(event)
    event_mut["payload"]["scientificCredit"] = "CONFIRMATORY"
    event_mut["eventSha256"] = event_sha(event_mut)
    if rejected(lambda: validate_events(contract, [event_mut])):
        kills.append("event-science-credit")
    event_mut = copy.deepcopy(event)
    event_mut["createdAt"] = "2026-08-13T21:00:00Z"
    event_mut["eventSha256"] = event_sha(event_mut)
    if rejected(lambda: validate_events(contract, [event_mut])):
        kills.append("event-before-retrieval")
    event_mut = copy.deepcopy(event)
    event_mut["payload"]["contractSelfSha256"] = "f" * 64
    event_mut["eventSha256"] = event_sha(event_mut)
    if rejected(lambda: validate_events(contract, [event_mut])):
        kills.append("event-contract-drift")
    report_mut = copy.deepcopy(report)
    report_mut["sourceCount"] = 11
    report_mut["reportSelfSha256"] = ZERO_SHA
    report_mut["reportSelfSha256"] = sha256_bytes(canonical(report_mut))
    if rejected(lambda: validate_report(contract, event, report_mut)):
        kills.append("report-drift")

    expected_kills = 33
    require(len(kills) == expected_kills, f"self-test kills {len(kills)}/{expected_kills}: {kills}")
    return {"status": "PASS", "kills": kills, "killCount": len(kills)}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--remote", action="store_true")
    verify_parser.add_argument("--private-store")
    status_parser = sub.add_parser("status")
    status_parser.add_argument("--remote", action="store_true")
    status_parser.add_argument("--private-store")
    sub.add_parser("self-test")
    sub.add_parser("render-report")
    args = parser.parse_args()
    try:
        if args.command == "self-test":
            result = self_test()
        elif args.command == "render-report":
            contract = load_json(CONTRACT)
            validate_contract(contract)
            events = load_events()
            event = validate_events(contract, events)
            print(json.dumps(materialize_report(contract, event), ensure_ascii=False, indent=2))
            return 0
        else:
            result = verify(args.remote, args.private_store)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except (GateError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, ensure_ascii=False, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
