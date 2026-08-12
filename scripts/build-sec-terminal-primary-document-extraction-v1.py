#!/usr/bin/env python3
"""Extract conservative, outcome-blind candidate values from SEC terminal-event snippets."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import tempfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-primary-document-extraction-contract-v1.json"
INPUT = ROOT / "reports" / "early-detection" / "sec-terminal-candidate-triage-v1.json"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-terminal-primary-document-extraction-v1.json"
EXPECTED_CONTRACT_RAW = "cc18c2d7ac4d984b5511830eae714a0131096e384c77d63817c4b59afa2cf797"
EXPECTED_CONTRACT_SELF = "3cb72db47482e354a5a75b5ead54dccf7c4922a055a944aad965a1866659393d"
EXPECTED_INPUT_RAW = "ca879151eebd487609be39a4aa76faf83a1294c86736e00865a2759b5c7a860b"
EXPECTED_INPUT_REPORT = "82d40ebc9238ec2c41c07ee92b8ab9ddd96edae87c08624d3763ce36e2716618"
EXPECTED_ROWS = 656
ELIGIBLE = {"EXPLICIT_CASH_OR_MIXED_CONSIDERATION_CANDIDATE", "LIQUIDATION_OR_DISTRIBUTION_CANDIDATE"}
AMOUNT = re.compile(r"(?<![A-Za-z0-9])(?:(?P<currency>US\$|USD|\$)\s*)?(?P<number>[0-9]{1,9}(?:,[0-9]{3})*(?:\.\d{1,8})?)(?P<suffix>\s+(?:in\s+cash|cash\s+per\s+(?:share|ADS|security)|net\s+per\s+(?:share|ADS|security)|per\s+(?:share|ADS|American\s+Depositary\s+Share|security)|offer\s+price|net\s+distribution|liquidating\s+distribution))?", re.I)
RATIO = re.compile(r"(?<![A-Za-z0-9$])(?P<number>[0-9]{1,6}(?:\.\d{1,8})?)\s+(?P<unit>shares?|stock|ADS|securities?)\b", re.I)
CONTEXT = 72


class ExtractionError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ExtractionError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def decimal_text(raw: str) -> str:
    try:
        value = Decimal(raw.replace(",", ""))
    except InvalidOperation as exc:
        raise ExtractionError("invalid decimal") from exc
    if not value.is_finite() or value < 0:
        fail("invalid candidate value")
    rendered = format(value, "f")
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    return rendered or "0"


def load_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_bytes())
    except Exception as exc:
        raise ExtractionError(f"invalid JSON: {path}") from exc
    if not isinstance(value, dict):
        fail("object required")
    return value


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
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "input", "extractionPolicy", "output", "claimLocks", "contractSha256"}, "contract")
    if value["schema"] != "early-detection-sec-terminal-primary-document-extraction-contract/v1" or value["taskId"] != "Q003-SEC-TERMINAL-PRIMARY-DOCUMENT-EXTRACTION" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    if value["input"] != {
        "path": "reports/early-detection/sec-terminal-candidate-triage-v1.json",
        "rawSha256": EXPECTED_INPUT_RAW,
        "reportSha256": EXPECTED_INPUT_REPORT,
        "introductionCommit": "93525c4a53c236264772ef7b1fb2c3c0059dfd65",
        "totalRows": 1101,
        "eligibleClassifications": ["EXPLICIT_CASH_OR_MIXED_CONSIDERATION_CANDIDATE", "LIQUIDATION_OR_DISTRIBUTION_CANDIDATE"],
        "eligibleRows": EXPECTED_ROWS,
        "eligibleUniqueAccessions": 652,
    }:
        fail("input contract changed")
    policy = value["extractionPolicy"]
    exact_keys(policy, {"sourceTextPreservedExactly", "sourceRefPreservedExactly", "oneOutputRowPerEligibleInputRow", "tickerJoinAllowed", "currencyMarkers", "candidateAmountPatterns", "candidateRatioPattern", "lexicalExclusionContexts", "multipleCandidateValuesRemainAmbiguous", "allValuesRemainCandidateOnly", "manualPrimaryDocumentReviewRequired"}, "extraction policy")
    expected_bools = {
        "sourceTextPreservedExactly": True,
        "sourceRefPreservedExactly": True,
        "oneOutputRowPerEligibleInputRow": True,
        "tickerJoinAllowed": False,
        "multipleCandidateValuesRemainAmbiguous": True,
        "allValuesRemainCandidateOnly": True,
        "manualPrimaryDocumentReviewRequired": True,
    }
    if any(policy[key] is not expected for key, expected in expected_bools.items()):
        fail("extraction boundary changed")
    if policy["currencyMarkers"] != ["$", "US$", "USD"] or policy["candidateAmountPatterns"] != ["EXPLICIT_CURRENCY_PREFIX", "NUMBER_WITH_CASH_OR_PER_SECURITY_SUFFIX"] or policy["candidateRatioPattern"] != "NUMBER_FOLLOWED_BY_SHARE_STOCK_ADS_OR_SECURITY_UNIT" or policy["lexicalExclusionContexts"] != ["PAR_VALUE", "EXERCISE_PRICE", "DEPOSITARY_FEE", "WITHHOLDING_TAX"]:
        fail("extraction vocabulary changed")
    if value["output"] != {"path": "reports/early-detection/sec-terminal-primary-document-extraction-v1.json", "writeNewAtomic": True, "expectedRows": EXPECTED_ROWS, "outcomesAccessed": False}:
        fail("output contract changed")
    if value["claimLocks"].get("candidateStatusOnly") is not True or any(item is not False for key, item in value["claimLocks"].items() if key != "candidateStatusOnly"):
        fail("claim lock changed")
    return value


def validate_input() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    raw = INPUT.read_bytes()
    if sha(raw) != EXPECTED_INPUT_RAW:
        fail("input raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != EXPECTED_INPUT_REPORT or sha(canonical(body)) != EXPECTED_INPUT_REPORT:
        fail("input self hash changed")
    if value.get("track") != "SHARED_OUTCOME_BLIND_INFRA" or value.get("claimLocks", {}).get("candidateStatusOnly") is not True or value.get("outcomesAccessed", value.get("claimLocks", {}).get("outcomesAccessed")) not in (None, False):
        fail("input boundary changed")
    rows = value.get("rows")
    if not isinstance(rows, list) or len(rows) != 1101:
        fail("input row count changed")
    eligible = [row for row in rows if row.get("classification") in ELIGIBLE]
    if len(eligible) != EXPECTED_ROWS or len({row.get("accession") for row in eligible}) != 652:
        fail("eligible population changed")
    if len({row.get("triageRowId") for row in eligible}) != EXPECTED_ROWS:
        fail("eligible row identity changed")
    return value, eligible


def context_label(text: str, start: int, end: int) -> str:
    window = text[max(0, start - CONTEXT):min(len(text), end + CONTEXT)].casefold()
    if "par value" in window:
        return "PAR_VALUE_CONTEXT"
    if "exercise price" in window or "exercisable" in window:
        return "EXERCISE_PRICE_CONTEXT"
    if "depositary fee" in window or "distribution fee" in window:
        return "DEPOSITARY_FEE_CONTEXT"
    if "withholding tax" in window:
        return "WITHHOLDING_TAX_CONTEXT"
    if any(token in window for token in ("in cash", "cash per", "net per", "right to receive", "offer price", "net distribution", "liquidating distribution", "converted into", "exchanged for")):
        return "CONSIDERATION_CONTEXT"
    return "UNRESOLVED_CONTEXT"


def amount_candidates(text: str) -> list[dict[str, Any]]:
    output = []
    seen = set()
    for match in AMOUNT.finditer(text):
        if not match.group("currency") and not match.group("suffix"):
            continue
        normalized = decimal_text(match.group("number"))
        context = context_label(text, match.start(), match.end())
        candidate = {
            "rawText": match.group(0),
            "normalizedDecimal": normalized,
            "currencyMarker": (match.group("currency") or "UNSPECIFIED").upper(),
            "contextClass": context,
            "start": match.start(),
            "end": match.end(),
        }
        key = (candidate["start"], candidate["end"], candidate["normalizedDecimal"], candidate["contextClass"])
        if key not in seen:
            seen.add(key)
            output.append(candidate)
    return output


def ratio_candidates(text: str) -> list[dict[str, Any]]:
    output = []
    for match in RATIO.finditer(text):
        output.append({
            "rawText": match.group(0),
            "normalizedDecimal": decimal_text(match.group("number")),
            "unit": match.group("unit").upper(),
            "contextClass": context_label(text, match.start(), match.end()),
            "start": match.start(),
            "end": match.end(),
        })
    return output


def extraction_status(amounts: list[dict[str, Any]], ratios: list[dict[str, Any]]) -> str:
    consideration_amounts = [row for row in amounts if row["contextClass"] == "CONSIDERATION_CONTEXT"]
    consideration_ratios = [row for row in ratios if row["contextClass"] == "CONSIDERATION_CONTEXT"]
    if len(consideration_amounts) == 1 and not consideration_ratios:
        return "ONE_CASH_AMOUNT_CANDIDATE_MANUAL_REVIEW_REQUIRED"
    if not consideration_amounts and len(consideration_ratios) == 1:
        return "ONE_SECURITY_RATIO_CANDIDATE_MANUAL_REVIEW_REQUIRED"
    if len(consideration_amounts) == 1 and len(consideration_ratios) == 1:
        return "ONE_MIXED_CASH_AND_SECURITY_CANDIDATE_MANUAL_REVIEW_REQUIRED"
    if not consideration_amounts and not consideration_ratios:
        return "NO_CONSIDERATION_VALUE_EXTRACTED_MANUAL_REVIEW_REQUIRED"
    return "MULTIPLE_CONSIDERATION_VALUES_AMBIGUOUS_MANUAL_REVIEW_REQUIRED"


def build_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output = []
    for rank, row in enumerate(rows, 1):
        text = row["text"]
        amounts = amount_candidates(text)
        ratios = ratio_candidates(text)
        item = {
            "extractionRank": rank,
            "extractionRowId": sha(canonical({"triageRowId": row["triageRowId"], "rank": rank})),
            "sourceTriageRowId": row["triageRowId"],
            "sourceCandidateId": row["sourceCandidateId"],
            "sourceRowId": row["sourceRowId"],
            "sourceOccurrenceId": row["sourceOccurrenceId"],
            "sourceReconciliationRank": row["sourceReconciliationRank"],
            "accession": row["accession"],
            "form": row["form"],
            "sourceDataset": row["sourceDataset"],
            "classification": row["classification"],
            "priorityTier": row["priorityTier"],
            "sourceRef": row["sourceRef"],
            "text": text,
            "amountCandidates": amounts,
            "ratioCandidates": ratios,
            "extractionStatus": extraction_status(amounts, ratios),
            "candidateOnly": True,
            "manualPrimaryDocumentReviewRequired": True,
            "paymentVerified": False,
            "terminalWealthComplete": False,
            "outcomesAccessed": False,
        }
        output.append(item)
    return output


def build_report(contract: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["extractionStatus"]] = counts.get(row["extractionStatus"], 0) + 1
    value = {
        "schema": "early-detection-sec-terminal-primary-document-extraction/v1",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "contractSha256": contract["contractSha256"],
        "inputRawSha256": EXPECTED_INPUT_RAW,
        "inputReportSha256": EXPECTED_INPUT_REPORT,
        "population": {"inputRows": 1101, "eligibleRows": EXPECTED_ROWS, "eligibleUniqueAccessions": 652, "byExtractionStatus": dict(sorted(counts.items()))},
        "rows": rows,
        "claimLocks": contract["claimLocks"],
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], contract: dict[str, Any], source_rows: list[dict[str, Any]]) -> None:
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "contractSha256", "inputRawSha256", "inputReportSha256", "population", "rows", "claimLocks", "reportSha256"}, "report")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value["schema"] != "early-detection-sec-terminal-primary-document-extraction/v1":
        fail("report self hash changed")
    if value["contractRawSha256"] != sha(CONTRACT.read_bytes()) or value["contractSha256"] != contract["contractSha256"] or value["inputRawSha256"] != EXPECTED_INPUT_RAW or value["inputReportSha256"] != EXPECTED_INPUT_REPORT:
        fail("report binding changed")
    rows = value["rows"]
    if not isinstance(rows, list) or len(rows) != EXPECTED_ROWS or len({row.get("extractionRowId") for row in rows}) != EXPECTED_ROWS:
        fail("report population changed")
    expected = build_rows(source_rows)
    if rows != expected:
        fail("report rows do not match deterministic rebuild")
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["extractionStatus"]] = counts.get(row["extractionStatus"], 0) + 1
        if row["candidateOnly"] is not True or row["manualPrimaryDocumentReviewRequired"] is not True or row["paymentVerified"] is not False or row["terminalWealthComplete"] is not False or row["outcomesAccessed"] is not False:
            fail("row claim boundary changed")
    if value["population"] != {"inputRows": 1101, "eligibleRows": EXPECTED_ROWS, "eligibleUniqueAccessions": 652, "byExtractionStatus": dict(sorted(counts.items()))}:
        fail("population counts changed")
    if value["claimLocks"] != contract["claimLocks"]:
        fail("claim locks changed")


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
    except (ExtractionError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any]) -> dict[str, Any]:
    fixtures = {
        "cash": "each share was converted into $52.25 in cash per share.",
        "mixed": "each share was converted into $21.00 and 0.8 shares of Class A Common Stock.",
        "par": "Common Stock, $0.01 par value per share.",
        "exercise": "warrant exercisable at an exercise price of $11.50 per share.",
        "ambiguous": "holder may receive $10.00 in cash per share or $12.00 in cash per share.",
    }
    checks = {
        "cashCandidateOnly": extraction_status(amount_candidates(fixtures["cash"]), ratio_candidates(fixtures["cash"])) == "ONE_CASH_AMOUNT_CANDIDATE_MANUAL_REVIEW_REQUIRED",
        "mixedCandidateOnly": extraction_status(amount_candidates(fixtures["mixed"]), ratio_candidates(fixtures["mixed"])) == "ONE_MIXED_CASH_AND_SECURITY_CANDIDATE_MANUAL_REVIEW_REQUIRED",
        "parExcluded": all(row["contextClass"] != "CONSIDERATION_CONTEXT" for row in amount_candidates(fixtures["par"])),
        "exerciseExcluded": all(row["contextClass"] != "CONSIDERATION_CONTEXT" for row in amount_candidates(fixtures["exercise"])),
        "multipleAmbiguous": extraction_status(amount_candidates(fixtures["ambiguous"]), ratio_candidates(fixtures["ambiguous"])) == "MULTIPLE_CONSIDERATION_VALUES_AMBIGUOUS_MANUAL_REVIEW_REQUIRED",
    }
    if not all(checks.values()):
        fail("self-test fixture failed")
    _, source = validate_input()
    report = build_report(contract, build_rows(source))
    validate_report(report, contract, source)
    item = copy.deepcopy(report)
    item["rows"][0]["paymentVerified"] = True
    item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
    checks["paymentPromotionRejected"] = rejected(lambda: validate_report(item, contract, source))
    item = copy.deepcopy(report)
    item["rows"][0]["amountCandidates"] = []
    item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
    checks["candidateTamperRejected"] = rejected(lambda: validate_report(item, contract, source))
    if not all(checks.values()):
        fail("self-test mutation failed")
    return {"schema": "early-detection-sec-terminal-primary-document-extraction-self-test/v1", "status": "PASS", "checks": checks, "filesWritten": 0, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract = validate_contract()
        _, source = validate_input()
        if args.command == "verify-contract":
            result = {"schema": "early-detection-sec-terminal-primary-document-extraction-contract-verification/v1", "status": "PASS", "contractSha256": contract["contractSha256"], "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract)
        elif args.command == "build":
            first = build_rows(source)
            second = build_rows(source)
            if first != second:
                fail("deterministic rebuild mismatch")
            report = build_report(contract, first)
            validate_report(report, contract, source)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "early-detection-sec-terminal-primary-document-extraction-build/v1", "status": "PASS", "output": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "rows": EXPECTED_ROWS, "outcomesAccessed": False}
        else:
            report = load_object(OUTPUT)
            validate_report(report, contract, source)
            result = {"schema": "early-detection-sec-terminal-primary-document-extraction-verification/v1", "status": "PASS", "rawSha256": sha(OUTPUT.read_bytes()), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "rows": EXPECTED_ROWS, "outcomesAccessed": False}
    except (ExtractionError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
