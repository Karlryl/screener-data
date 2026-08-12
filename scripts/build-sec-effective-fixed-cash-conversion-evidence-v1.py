#!/usr/bin/env python3
"""Verify four effective fixed-cash conversion statements from primary SEC bytes."""

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
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-effective-fixed-cash-conversion-evidence-contract-v1.json"
FIXED = ROOT / "reports" / "early-detection" / "sec-explicit-fixed-cash-consideration-v1.json"
FIXED_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-explicit-fixed-cash-consideration-contract-v1.json"
FIXED_BUILDER = ROOT / "scripts" / "build-sec-explicit-fixed-cash-consideration-v1.py"
FIXED_TEST = ROOT / "tests" / "build-sec-explicit-fixed-cash-consideration-v1.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-effective-fixed-cash-conversion-evidence-v1.json"
CORPUS_ROOT = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\corporate-action-originals\blobs\sha256")
EXPECTED_CONTRACT_RAW = "091cecc6331b1b74b6bb5243313f73eaa331ad3a30fd37e9af0d589fbbe09bcd"
FIXED_RAW = "ea1b3cc4fce4c86bf7f0b3c6d255613e9faa71ac363bba67ac26ff0a404a48ef"
FIXED_REPORT = "3f5980450f849ec0a566e29b80ca389c314ec8650fe78095bf5dca0278c729bc"
FIXED_SHAS = {
    FIXED_CONTRACT: "a603de6fbb2a5f850cdafd232a7eeaccadc8116ff25ae7b84d4978ab78f2b928",
    FIXED_BUILDER: "14626867e2157d75b1baea37ef90cb3f02f7904d64f14bd54b5fbe032ce001f8",
    FIXED_TEST: "e4d81639c3305be14b022935484e1e58d4aa22b396652b69d51a2062033eec19",
}
EXPECTED_DATES = {
    "0000876661-12-000192": "2012-04-30",
    "0000876661-13-000902": "2013-12-19",
    "0000876661-21-001108": "2021-07-23",
    "0001104659-19-049572": "2019-08-30",
}
DATE_TEXT = {
    "0000876661-12-000192": r"became effective on april 30, 2012",
    "0000876661-13-000902": r"became effective on december 19, 2013",
    "0000876661-21-001108": r"became effective before market open on july 23, 2021",
    "0001104659-19-049572": r"effective as of august\s*30, 2019",
}


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


def normalized_text(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace")
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ").replace("&#147;", '"').replace("&#148;", '"')
    return " ".join(text.lower().split())


def load_fixed() -> dict[str, Any]:
    raw = FIXED.read_bytes()
    if sha(raw) != FIXED_RAW:
        fail("fixed cash evidence raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != FIXED_REPORT or sha(canonical(body)) != FIXED_REPORT or value.get("outcomesAccessed") is not False:
        fail("fixed cash evidence self binding changed")
    return value


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "evidenceContract", "output", "claimLocks"}, "contract")
    if value["schema"] != "early-detection-sec-effective-fixed-cash-conversion-evidence-contract/v1" or value["taskId"] != "Q003-SEC-EFFECTIVE-FIXED-CASH-CONVERSION-EVIDENCE" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    if value["inputs"] != {"fixedCashEvidence": {"builderRawSha256": FIXED_SHAS[FIXED_BUILDER], "contractRawSha256": FIXED_SHAS[FIXED_CONTRACT], "path": "reports/early-detection/sec-explicit-fixed-cash-consideration-v1.json", "rawSha256": FIXED_RAW, "reportSha256": FIXED_REPORT, "testRawSha256": FIXED_SHAS[FIXED_TEST]}}:
        fail("input binding changed")
    expected_evidence = {
        "actualCashReceiptNotInferred": True,
        "effectiveDateRequired": True,
        "effectiveLanguageRequired": True,
        "expectedAccessions": sorted(EXPECTED_DATES),
        "expectedEffectiveDatesByAccession": EXPECTED_DATES,
        "expectedRows": 4,
        "fixedCashEvidenceInputRequired": True,
        "semanticCeiling": "PRIMARY_SEC_STATEMENT_SAYS_TRANSACTION_BECAME_EFFECTIVE_AND_SOURCE_SHARE_WAS_CONVERTED_INTO_FIXED_CASH_RIGHT",
        "sourceShareConversionRequired": True,
        "transactionEffectivenessStated": True,
    }
    if value["evidenceContract"] != expected_evidence:
        fail("evidence contract changed")
    if value["output"] != {"path": "reports/early-detection/sec-effective-fixed-cash-conversion-evidence-v1.json", "writeNewAtomic": True} or any(item is not False for item in value["claimLocks"].values()):
        fail("output or claim boundary changed")
    for path, claim in FIXED_SHAS.items():
        if file_sha(path) != claim:
            fail("fixed evidence implementation changed")
    return value


def build_rows(fixed: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    source_rows = fixed.get("rows")
    if not isinstance(source_rows, list) or len(source_rows) != 4:
        fail("fixed cash denominator changed")
    for source in source_rows:
        accession = source.get("accession")
        if accession not in EXPECTED_DATES or source.get("paymentCompletionVerified") is not False or source.get("terminalWealthComplete") is not False or source.get("outcomesAccessed") is not False:
            fail("fixed cash source boundary changed")
        source_ref = source.get("sourceRef")
        if not isinstance(source_ref, dict):
            fail("source ref changed")
        blob_sha = source_ref.get("blobSha256")
        relative = source_ref.get("relativePath")
        if not isinstance(blob_sha, str) or not isinstance(relative, str) or relative != f"{blob_sha[:2]}/{blob_sha}.txt":
            fail("source blob reference changed")
        blob_path = CORPUS_ROOT / Path(relative)
        raw = blob_path.read_bytes()
        if sha(raw) != blob_sha:
            fail("source blob bytes changed")
        text = normalized_text(raw)
        if re.search(DATE_TEXT[accession], text) is None:
            fail("effective date statement changed")
        if "converted into the right to receive" not in text or "cash" not in text:
            fail("effective cash conversion statement changed")
        row = {
            "evidenceRank": 0,
            "evidenceRowId": "",
            "accession": accession,
            "issuerCik": source["issuerCik"],
            "companyName": source["companyName"],
            "filedDate": source["filedDate"],
            "sourceFixedEvidenceRowId": source["evidenceRowId"],
            "sourceRef": source_ref,
            "cashConsiderationPerSourceShare": source["cashConsiderationPerSourceShare"],
            "currency": source["currency"],
            "transactionEffectiveDate": EXPECTED_DATES[accession],
            "evidenceStatus": "EFFECTIVE_TRANSACTION_AND_FIXED_CASH_CONVERSION_RIGHT_VERIFIED_FROM_PRIMARY_SEC_STATEMENT",
            "actualCashReceiptVerified": False,
            "terminalWealthComplete": False,
            "outcomesAccessed": False,
        }
        result.append(row)
    result.sort(key=lambda item: item["accession"])
    if [row["accession"] for row in result] != sorted(EXPECTED_DATES):
        fail("accession set changed")
    for rank, row in enumerate(result, 1):
        row["evidenceRank"] = rank
        row["evidenceRowId"] = sha(canonical({key: value for key, value in row.items() if key != "evidenceRowId"}))
    return result


def build_report(contract: dict[str, Any], fixed: dict[str, Any]) -> dict[str, Any]:
    rows = build_rows(fixed)
    value = {
        "schema": "early-detection-sec-effective-fixed-cash-conversion-evidence/v1",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "fixedCashEvidenceRawSha256": FIXED_RAW,
        "fixedCashEvidenceReportSha256": FIXED_REPORT,
        "semanticCeiling": contract["evidenceContract"]["semanticCeiling"],
        "population": {"inputFixedCashRows": 4, "effectiveConversionRows": 4, "uniqueAccessions": 4, "actualCashReceiptVerifiedRows": 0, "terminalWealthCompleteRows": 0},
        "rows": rows,
        "claimLocks": contract["claimLocks"],
        "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], contract: dict[str, Any], fixed: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "fixedCashEvidenceRawSha256", "fixedCashEvidenceReportSha256", "semanticCeiling", "population", "rows", "claimLocks", "outcomesAccessed", "reportSha256"}, "report")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value["schema"] != "early-detection-sec-effective-fixed-cash-conversion-evidence/v1":
        fail("report self hash changed")
    if value != build_report(contract, fixed):
        fail("report does not match source rebuild")
    if any(item is not False for item in value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("claim boundary changed")
    row_keys = {"evidenceRank", "evidenceRowId", "accession", "issuerCik", "companyName", "filedDate", "sourceFixedEvidenceRowId", "sourceRef", "cashConsiderationPerSourceShare", "currency", "transactionEffectiveDate", "evidenceStatus", "actualCashReceiptVerified", "terminalWealthComplete", "outcomesAccessed"}
    for row in value["rows"]:
        exact_keys(row, row_keys, "evidence row")
        if row["actualCashReceiptVerified"] is not False or row["terminalWealthComplete"] is not False or row["outcomesAccessed"] is not False:
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


def self_test(contract: dict[str, Any], fixed: dict[str, Any]) -> dict[str, Any]:
    report = build_report(contract, fixed)
    validate_report(report, contract, fixed)
    kills = {}
    for name, mutate in {
        "effectiveDateChanged": lambda x: x["rows"][0].__setitem__("transactionEffectiveDate", "2099-01-01"),
        "amountChanged": lambda x: x["rows"][0].__setitem__("cashConsiderationPerSourceShare", "999"),
        "sourceRefChanged": lambda x: x["rows"][0]["sourceRef"].__setitem__("blobSha256", "0" * 64),
        "actualReceiptClaimed": lambda x: x["rows"][0].__setitem__("actualCashReceiptVerified", True),
        "terminalWealthClaimed": lambda x: x["claimLocks"].__setitem__("terminalWealthComplete", True),
        "outcomesAccessed": lambda x: x.__setitem__("outcomesAccessed", True),
    }.items():
        item = copy.deepcopy(report)
        mutate(item)
        item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
        kills[name] = rejected(lambda item=item: validate_report(item, contract, fixed))
    if set(kills.values()) != {True}:
        fail("mutation kill failed")
    return {"schema": "early-detection-sec-effective-fixed-cash-conversion-evidence-self-test/v1", "status": "PASS", "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract = validate_contract()
        fixed = load_fixed()
        if args.command == "verify-contract":
            result = {"schema": "early-detection-sec-effective-fixed-cash-conversion-evidence-contract-verification/v1", "status": "PASS", "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract, fixed)
        elif args.command == "build":
            report = build_report(contract, fixed)
            validate_report(report, contract, fixed)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "early-detection-sec-effective-fixed-cash-conversion-evidence-build/v1", "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "verifiedRows": 4, "outcomesAccessed": False}
        else:
            raw = OUTPUT.read_bytes()
            report = json.loads(raw)
            validate_report(report, contract, fixed)
            result = {"schema": "early-detection-sec-effective-fixed-cash-conversion-evidence-verification/v1", "status": "PASS", "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "verifiedRows": 4, "outcomesAccessed": False}
    except (EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
