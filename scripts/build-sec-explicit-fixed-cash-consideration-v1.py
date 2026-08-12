#!/usr/bin/env python3
"""Verify a deliberately narrow set of fixed cash consideration statements."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-explicit-fixed-cash-consideration-contract-v1.json"
EXTRACTION = ROOT / "reports" / "early-detection" / "sec-terminal-primary-document-extraction-v1.json"
RESOLUTION = ROOT / "reports" / "early-detection" / "sec-terminal-primary-issuer-cik-resolution-v1.json"
SOURCE_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-primary-document-extraction-contract-v1.json"
SOURCE_BUILDER = ROOT / "scripts" / "build-sec-terminal-primary-document-extraction-v1.py"
SOURCE_TEST = ROOT / "tests" / "build-sec-terminal-primary-document-extraction-v1.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-explicit-fixed-cash-consideration-v1.json"
EXPECTED_CONTRACT_RAW = "a603de6fbb2a5f850cdafd232a7eeaccadc8116ff25ae7b84d4978ab78f2b928"
EXTRACTION_RAW = "987560ca38931cfa818f6c9fb315be7875ec98fd872518ef51d45f5af3589464"
EXTRACTION_REPORT = "9fd402508ff75ab0d3265cc15c7f77a6e6fa2f659749a43f5719db207d094000"
RESOLUTION_RAW = "f89767daf43c2d06ca87c0b57919b450749620026724b700ff94572117da7cfb"
RESOLUTION_REPORT = "3b450bef0120eee49fc4ab0f188578097ffd2fb53d781675b33c6db84809ead6"
SOURCE_SHAS = {
    SOURCE_CONTRACT: "cc18c2d7ac4d984b5511830eae714a0131096e384c77d63817c4b59afa2cf797",
    SOURCE_BUILDER: "cce6177c17b3b6fa1ac5258b2432a6f263ef788182dc077514beb212b3baa903",
    SOURCE_TEST: "7e8023fe544a4c824c5032b92a9522b01b88c035446a78c8945c03a5d8716e14",
}
EXPECTED = {
    "0000876661-12-000192": "11.5",
    "0000876661-13-000902": "23.75",
    "0000876661-21-001108": "37",
    "0001104659-19-049572": "51.35",
}
EXCLUDED = ("additional", "contingent", "subject to", "plus accrued", "election", "either")


class EvidenceError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise EvidenceError(message)


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
    if claim != report_claim or sha(canonical(body)) != report_claim or value.get("claimLocks", {}).get("outcomesAccessed") is not False:
        fail(f"{label} self binding changed")
    return value


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "evidenceContract", "output", "claimLocks"}, "contract")
    if value["schema"] != "early-detection-sec-explicit-fixed-cash-consideration-contract/v1" or value["taskId"] != "Q003-SEC-EXPLICIT-FIXED-CASH-CONSIDERATION" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    if value["inputs"] != {
        "documentExtraction": {"builderRawSha256": SOURCE_SHAS[SOURCE_BUILDER], "contractRawSha256": SOURCE_SHAS[SOURCE_CONTRACT], "path": "reports/early-detection/sec-terminal-primary-document-extraction-v1.json", "rawSha256": EXTRACTION_RAW, "reportSha256": EXTRACTION_REPORT, "testRawSha256": SOURCE_SHAS[SOURCE_TEST]},
        "issuerResolution": {"path": "reports/early-detection/sec-terminal-primary-issuer-cik-resolution-v1.json", "rawSha256": RESOLUTION_RAW, "reportSha256": RESOLUTION_REPORT},
    }:
        fail("input binding changed")
    evidence = value["evidenceContract"]
    if evidence != {
        "amountCandidateContext": "CONSIDERATION_CONTEXT",
        "candidateAmountMustBeUnique": True,
        "candidateOnly": False,
        "cashLanguageRequired": True,
        "considerationPerSourceShareVerified": True,
        "convertedIntoRightToReceiveRequired": True,
        "expectedAccessions": sorted(EXPECTED),
        "expectedAmountsByAccession": EXPECTED,
        "expectedRows": 4,
        "excludedLanguage": ["ADDITIONAL", "CONTINGENT", "SUBJECT TO", "PLUS ACCRUED", "ELECTION", "EITHER"],
        "noOtherCashOrRatioCandidate": True,
        "semanticCeiling": "FIXED_CASH_CONSIDERATION_PER_SOURCE_SHARE_STATED_IN_PRIMARY_SEC_DOCUMENT",
        "sourceDocumentBindingRequired": True,
    }:
        fail("evidence contract changed")
    if value["output"] != {"path": "reports/early-detection/sec-explicit-fixed-cash-consideration-v1.json", "writeNewAtomic": True} or any(item is not False for item in value["claimLocks"].values()):
        fail("output or claim boundary changed")
    for path, claim in SOURCE_SHAS.items():
        if file_sha(path) != claim:
            fail("source implementation changed")
    return value


def select_rows(extraction: dict[str, Any], resolution: dict[str, Any]) -> list[dict[str, Any]]:
    by_extraction = {row["sourceExtractionRowId"]: row for row in resolution["rows"]}
    selected = []
    for source in extraction["rows"]:
        if source["accession"] not in EXPECTED:
            continue
        if source["extractionStatus"] != "ONE_CASH_AMOUNT_CANDIDATE_MANUAL_REVIEW_REQUIRED" or source["candidateOnly"] is not True or source["paymentVerified"] is not False or source["terminalWealthComplete"] is not False or source["outcomesAccessed"] is not False:
            fail("source extraction boundary changed")
        amounts = source["amountCandidates"]
        consideration = [item for item in amounts if item["contextClass"] == "CONSIDERATION_CONTEXT"]
        other_amounts = [item for item in amounts if item["contextClass"] != "CONSIDERATION_CONTEXT" and item["contextClass"] != "PAR_VALUE_CONTEXT"]
        if len(consideration) != 1 or consideration[0]["normalizedDecimal"] != EXPECTED[source["accession"]] or other_amounts or source["ratioCandidates"]:
            fail("consideration candidate changed")
        text = source["text"]
        normalized = " ".join(text.lower().split())
        if "converted" not in normalized or "right to receive" not in normalized or "cash" not in normalized or "per share" not in normalized or any(term in normalized for term in EXCLUDED):
            fail("primary statement semantics changed")
        if not re.search(r"converted.{0,140}right to receive", normalized):
            fail("conversion relationship changed")
        linked = by_extraction.get(source["extractionRowId"])
        if linked is None or linked["accession"] != source["accession"] or linked["issuerQueueRowResolved"] is not True or linked["sourceDerivedIssuerCik"] != linked["selectedIssuerQueueRow"]["cik"]:
            fail("issuer binding changed")
        amount = consideration[0]
        row = {
            "evidenceRank": 0,
            "evidenceRowId": "",
            "accession": source["accession"],
            "issuerCik": linked["sourceDerivedIssuerCik"],
            "companyName": linked["selectedIssuerQueueRow"]["companyName"],
            "filedDate": linked["selectedIssuerQueueRow"]["filedDate"],
            "form": source["form"],
            "sourceExtractionRowId": source["extractionRowId"],
            "sourceResolutionRowId": linked["resolutionRowId"],
            "sourceRef": source["sourceRef"],
            "statementText": text,
            "statementTextSha256": sha(text.encode("utf-8")),
            "cashConsiderationPerSourceShare": amount["normalizedDecimal"],
            "currency": "USD",
            "evidenceStatus": "FIXED_CASH_CONSIDERATION_PER_SOURCE_SHARE_VERIFIED_FROM_PRIMARY_SEC_STATEMENT",
            "paymentCompletionVerified": False,
            "terminalWealthComplete": False,
            "outcomesAccessed": False,
        }
        selected.append(row)
    selected.sort(key=lambda item: item["accession"])
    if [row["accession"] for row in selected] != sorted(EXPECTED):
        fail("selected accessions changed")
    for rank, row in enumerate(selected, 1):
        row["evidenceRank"] = rank
        row["evidenceRowId"] = sha(canonical({key: value for key, value in row.items() if key != "evidenceRowId"}))
    return selected


def build_report(contract: dict[str, Any], extraction: dict[str, Any], resolution: dict[str, Any]) -> dict[str, Any]:
    rows = select_rows(extraction, resolution)
    value = {
        "schema": "early-detection-sec-explicit-fixed-cash-consideration/v1",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "extractionRawSha256": EXTRACTION_RAW,
        "extractionReportSha256": EXTRACTION_REPORT,
        "resolutionRawSha256": RESOLUTION_RAW,
        "resolutionReportSha256": RESOLUTION_REPORT,
        "semanticCeiling": contract["evidenceContract"]["semanticCeiling"],
        "population": {"sourceExtractionRows": 656, "verifiedFixedCashRows": 4, "uniqueAccessions": 4, "paymentCompletionVerifiedRows": 0, "terminalWealthCompleteRows": 0},
        "rows": rows,
        "claimLocks": contract["claimLocks"],
        "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], contract: dict[str, Any], extraction: dict[str, Any], resolution: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "extractionRawSha256", "extractionReportSha256", "resolutionRawSha256", "resolutionReportSha256", "semanticCeiling", "population", "rows", "claimLocks", "outcomesAccessed", "reportSha256"}, "report")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value["schema"] != "early-detection-sec-explicit-fixed-cash-consideration/v1":
        fail("report self hash changed")
    if value["contractRawSha256"] != sha(CONTRACT.read_bytes()) or value["extractionRawSha256"] != EXTRACTION_RAW or value["extractionReportSha256"] != EXTRACTION_REPORT or value["resolutionRawSha256"] != RESOLUTION_RAW or value["resolutionReportSha256"] != RESOLUTION_REPORT:
        fail("report binding changed")
    expected = build_report(contract, extraction, resolution)
    if value != expected:
        fail("report does not match source rebuild")
    if any(item is not False for item in value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("claim boundary changed")
    row_keys = {"evidenceRank", "evidenceRowId", "accession", "issuerCik", "companyName", "filedDate", "form", "sourceExtractionRowId", "sourceResolutionRowId", "sourceRef", "statementText", "statementTextSha256", "cashConsiderationPerSourceShare", "currency", "evidenceStatus", "paymentCompletionVerified", "terminalWealthComplete", "outcomesAccessed"}
    for row in value["rows"]:
        exact_keys(row, row_keys, "evidence row")
        if row["paymentCompletionVerified"] is not False or row["terminalWealthComplete"] is not False or row["outcomesAccessed"] is not False:
            fail("row overclaimed")


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
    except (EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any], extraction: dict[str, Any], resolution: dict[str, Any]) -> dict[str, Any]:
    report = build_report(contract, extraction, resolution)
    validate_report(report, contract, extraction, resolution)
    kills = {}
    for name, mutate in {
        "amountChanged": lambda x: x["rows"][0].__setitem__("cashConsiderationPerSourceShare", "999"),
        "statementChanged": lambda x: x["rows"][0].__setitem__("statementText", "converted into cash"),
        "sourceRefChanged": lambda x: x["rows"][0]["sourceRef"].__setitem__("evidenceSha256", "0" * 64),
        "paymentCompletionClaimed": lambda x: x["rows"][0].__setitem__("paymentCompletionVerified", True),
        "terminalWealthClaimed": lambda x: x["claimLocks"].__setitem__("terminalWealthComplete", True),
        "outcomesAccessed": lambda x: x.__setitem__("outcomesAccessed", True),
    }.items():
        item = copy.deepcopy(report)
        mutate(item)
        item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
        kills[name] = rejected(lambda item=item: validate_report(item, contract, extraction, resolution))
    return {"schema": "early-detection-sec-explicit-fixed-cash-consideration-self-test/v1", "status": "PASS", "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract = validate_contract()
        extraction = load_report(EXTRACTION, EXTRACTION_RAW, EXTRACTION_REPORT, "extraction")
        resolution = load_report(RESOLUTION, RESOLUTION_RAW, RESOLUTION_REPORT, "resolution")
        if args.command == "verify-contract":
            result = {"schema": "early-detection-sec-explicit-fixed-cash-consideration-contract-verification/v1", "status": "PASS", "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract, extraction, resolution)
        elif args.command == "build":
            report = build_report(contract, extraction, resolution)
            validate_report(report, contract, extraction, resolution)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "early-detection-sec-explicit-fixed-cash-consideration-build/v1", "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "verifiedRows": 4, "outcomesAccessed": False}
        else:
            raw = OUTPUT.read_bytes()
            report = json.loads(raw)
            validate_report(report, contract, extraction, resolution)
            result = {"schema": "early-detection-sec-explicit-fixed-cash-consideration-verification/v1", "status": "PASS", "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "verifiedRows": 4, "outcomesAccessed": False}
    except (EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
