#!/usr/bin/env python3
"""Build a narrow, outcome-blind fixed-cash evidence family from SEC sentences."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-same-sentence-effective-fixed-cash-contract-v1.json"
INPUT = ROOT / "reports" / "early-detection" / "sec-terminal-primary-document-extraction-v1.json"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-same-sentence-effective-fixed-cash-v1.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-same-sentence-effective-fixed-cash-v1.test.js"
AUTHORIZED_REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
EXPECTED_CONTRACT_RAW = "d229c3b6ca14fc9863cba1b6da7f6cb2dd7a4c309fe9aedd80ccbb01085f14a3"
EXPECTED_INPUT_RAW = "987560ca38931cfa818f6c9fb315be7875ec98fd872518ef51d45f5af3589464"
EXPECTED_INPUT_REPORT = "9fd402508ff75ab0d3265cc15c7f77a6e6fa2f659749a43f5719db207d094000"
EXPECTED_INPUT_ROWS = 656
MONTHS = "january february march april may june july august september october november december".split()
DATE_RE = re.compile(r"\b(?:" + "|".join(MONTHS) + r")\s+\d{1,2},\s+\d{4}\b", re.I)
CONVERSION_RE = re.compile(r"\b(?:was|were)\s+converted\s+into\b", re.I)
EXCLUSION_RE = re.compile(
    r"\b(?:additional|contingent|subject\s+to|plus|either|election|prorated|"
    r"liquidation\s+preference|accrued|unpaid|will\s+be\s+converted)\b",
    re.I,
)
SOURCE_REF_KEYS = {
    "blobSha256", "relativePath", "documentIndex", "documentType", "documentSequence",
    "documentFilename", "rawDocumentSha256", "rawTextSha256", "locatorKind", "locator",
    "normalizationMode", "evidenceSha256",
}


class EvidenceError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise EvidenceError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def git(*args: str) -> str:
    run = subprocess.run(["git", *args], cwd=ROOT, check=False, capture_output=True, text=True, encoding="utf-8")
    if run.returncode:
        fail("git binding failed")
    return run.stdout.strip()


def implementation_bindings(base_commit: str | None = None, remote_required: bool = False) -> dict[str, Any]:
    head = git("rev-parse", "HEAD")
    if base_commit is None:
        base_commit = head
    if not re.fullmatch(r"[0-9a-f]{40}", base_commit):
        fail("invalid implementation base commit")
    bindings = {
        "buildBaseCommit": base_commit,
        "remoteUrl": AUTHORIZED_REMOTE_URL,
        "remoteRef": AUTHORIZED_REF,
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "builderRawSha256": sha(BUILDER.read_bytes()),
        "testRawSha256": sha(TEST.read_bytes()),
    }
    if remote_required:
        if git("remote", "get-url", "origin") != AUTHORIZED_REMOTE_URL:
            fail("remote URL changed")
        remote_rows = git("ls-remote", "--refs", "origin", AUTHORIZED_REF).splitlines()
        if len(remote_rows) != 1:
            fail("remote ref cardinality changed")
        remote_head = remote_rows[0].split()[0]
        if remote_head != head or git("rev-parse", "@{upstream}") != head:
            fail("local, upstream and remote head differ")
        if git("merge-base", "--is-ancestor", base_commit, head) != "":
            fail("implementation base is not an ancestor")
        for path, claim in ((CONTRACT, bindings["contractRawSha256"]), (BUILDER, bindings["builderRawSha256"]), (TEST, bindings["testRawSha256"])):
            relative = path.relative_to(ROOT).as_posix()
            raw = subprocess.run(["git", "show", f"{base_commit}:{relative}"], cwd=ROOT, check=False, capture_output=True).stdout
            if not raw or sha(raw) != claim or raw != path.read_bytes():
                fail("implementation Git blob changed")
    return bindings


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def parse_date(value: str) -> str:
    try:
        parsed = datetime.strptime(value, "%B %d, %Y")
    except ValueError as exc:
        raise EvidenceError("invalid calendar date") from exc
    return parsed.strftime("%Y-%m-%d")


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "evidenceContract", "output", "claimLocks"}, "contract")
    if value["schema"] != "early-detection-sec-same-sentence-effective-fixed-cash-contract/v1" or value["taskId"] != "Q003-SEC-SAME-SENTENCE-EFFECTIVE-FIXED-CASH" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    expected_input = {
        "documentExtraction": {
            "builderRawSha256": "cce6177c17b3b6fa1ac5258b2432a6f263ef788182dc077514beb212b3baa903",
            "contractRawSha256": "cc18c2d7ac4d984b5511830eae714a0131096e384c77d63817c4b59afa2cf797",
            "path": "reports/early-detection/sec-terminal-primary-document-extraction-v1.json",
            "rawSha256": EXPECTED_INPUT_RAW,
            "reportSha256": EXPECTED_INPUT_REPORT,
            "testRawSha256": "7e8023fe544a4c824c5032b92a9522b01b88c035446a78c8945c03a5d8716e14",
        }
    }
    if value["inputs"] != expected_input:
        fail("input binding changed")
    policy = value["evidenceContract"]
    exact_keys(policy, {"actualCashReceiptNotInferred", "expectedAccessions", "expectedAmountsByAccession", "expectedEffectiveDatesByAccession", "expectedRows", "oneConsiderationAmountRequired", "sameSentenceEffectiveDateCashConversionRequired", "semanticCeiling", "securityRatioForbidden", "sourceSentenceHashRequired"}, "evidence contract")
    accessions = policy["expectedAccessions"]
    if not isinstance(accessions, list) or accessions != sorted(accessions) or len(accessions) != 11 or len(set(accessions)) != 11:
        fail("expected accessions changed")
    if set(policy["expectedAmountsByAccession"]) != set(accessions) or set(policy["expectedEffectiveDatesByAccession"]) != set(accessions):
        fail("expected evidence maps changed")
    if policy["expectedRows"] != 11 or policy["actualCashReceiptNotInferred"] is not True or policy["oneConsiderationAmountRequired"] is not True or policy["sameSentenceEffectiveDateCashConversionRequired"] is not True or policy["securityRatioForbidden"] is not True or policy["sourceSentenceHashRequired"] is not True:
        fail("evidence requirements changed")
    if policy["semanticCeiling"] != "PRIMARY_SEC_SENTENCE_STATES_EFFECTIVE_TRANSACTION_DATE_AND_FIXED_CASH_CONVERSION":
        fail("semantic ceiling changed")
    if value["output"] != {"path": "reports/early-detection/sec-same-sentence-effective-fixed-cash-v1.json", "writeNewAtomic": True} or any(item is not False for item in value["claimLocks"].values()):
        fail("output or claim boundary changed")
    return value


def load_input() -> dict[str, Any]:
    raw = INPUT.read_bytes()
    if sha(raw) != EXPECTED_INPUT_RAW:
        fail("input raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != EXPECTED_INPUT_REPORT or sha(canonical(body)) != EXPECTED_INPUT_REPORT:
        fail("input self binding changed")
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "contractSha256", "inputRawSha256", "inputReportSha256", "population", "rows", "claimLocks", "reportSha256"}, "input")
    if value["schema"] != "early-detection-sec-terminal-primary-document-extraction/v1" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA" or value["claimLocks"].get("candidateStatusOnly") is not True or any(item is not False for key, item in value["claimLocks"].items() if key != "candidateStatusOnly"):
        fail("input claim boundary changed")
    if not isinstance(value["rows"], list) or len(value["rows"]) != EXPECTED_INPUT_ROWS:
        fail("input denominator changed")
    return value


def selected_source_rows(source: dict[str, Any]) -> list[dict[str, Any]]:
    selected = []
    for row in source["rows"]:
        text = row.get("text")
        if not isinstance(text, str):
            fail("source text changed")
        amounts = [item for item in row.get("amountCandidates", []) if item.get("contextClass") == "CONSIDERATION_CONTEXT"]
        ratios = [item for item in row.get("ratioCandidates", []) if item.get("contextClass") == "CONSIDERATION_CONTEXT"]
        dates = DATE_RE.findall(text)
        if (
            len(amounts) == 1
            and not ratios
            and len(dates) == 1
            and "became effective" in text.casefold()
            and CONVERSION_RE.search(text)
            and "cash" in text.casefold()
            and not EXCLUSION_RE.search(text)
        ):
            selected.append(row)
    return selected


def validate_source_ref(ref: Any, text: str) -> None:
    exact_keys(ref, SOURCE_REF_KEYS, "source reference")
    if ref["locatorKind"] != "NORMALIZED_TEXT_SENTENCE" or not re.fullmatch(r"sentence\[[1-9][0-9]*\]/considerationPaymentCandidate", ref["locator"]):
        fail("source locator changed")
    if ref["evidenceSha256"] != sha(text.encode("utf-8")):
        fail("source sentence hash changed")
    for key in ("blobSha256", "rawDocumentSha256", "rawTextSha256", "evidenceSha256"):
        if not isinstance(ref[key], str) or not re.fullmatch(r"[0-9a-f]{64}", ref[key]):
            fail("source hash changed")
    if ref["relativePath"] != f"{ref['blobSha256'][:2]}/{ref['blobSha256']}.txt":
        fail("source path changed")


def build_rows(source: dict[str, Any], contract: dict[str, Any]) -> list[dict[str, Any]]:
    rows = selected_source_rows(source)
    policy = contract["evidenceContract"]
    if len(rows) != policy["expectedRows"] or sorted(row["accession"] for row in rows) != policy["expectedAccessions"]:
        fail("selected source population changed")
    output = []
    for source_row in rows:
        accession = source_row["accession"]
        text = source_row["text"]
        validate_source_ref(source_row["sourceRef"], text)
        date_matches = DATE_RE.findall(text)
        amount_rows = [item for item in source_row["amountCandidates"] if item["contextClass"] == "CONSIDERATION_CONTEXT"]
        if len(date_matches) != 1 or len(amount_rows) != 1:
            fail("evidence cardinality changed")
        effective_date = parse_date(date_matches[0])
        amount = amount_rows[0]["normalizedDecimal"]
        if effective_date != policy["expectedEffectiveDatesByAccession"][accession] or amount != policy["expectedAmountsByAccession"][accession]:
            fail("expected date or amount changed")
        if source_row["candidateOnly"] is not True or source_row["manualPrimaryDocumentReviewRequired"] is not True or source_row["paymentVerified"] is not False or source_row["terminalWealthComplete"] is not False or source_row["outcomesAccessed"] is not False:
            fail("source evidence was promoted")
        row = {
            "accession": accession,
            "form": source_row["form"],
            "sourceExtractionRowId": source_row["extractionRowId"],
            "statementText": text,
            "statementTextSha256": sha(text.encode("utf-8")),
            "sourceRef": copy.deepcopy(source_row["sourceRef"]),
            "transactionEffectiveDate": effective_date,
            "fixedCashAmount": amount,
            "currency": "USD",
            "evidenceStatus": "SAME_PRIMARY_SEC_SENTENCE_EFFECTIVE_DATE_AND_FIXED_CASH_CONVERSION_VERIFIED",
            "actualCashReceiptVerified": False,
            "terminalSessionComplete": False,
            "terminalWealthComplete": False,
            "outcomesAccessed": False,
        }
        row["evidenceRowId"] = sha(canonical(row))
        output.append(row)
    return sorted(output, key=lambda item: item["accession"])


def build_report(contract: dict[str, Any], source: dict[str, Any], implementation: dict[str, Any]) -> dict[str, Any]:
    rows = build_rows(source, contract)
    value = {
        "schema": "early-detection-sec-same-sentence-effective-fixed-cash/v1",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "inputRawSha256": EXPECTED_INPUT_RAW,
        "inputReportSha256": EXPECTED_INPUT_REPORT,
        "semanticCeiling": contract["evidenceContract"]["semanticCeiling"],
        "implementationBindings": implementation,
        "population": {
            "inputExtractionRows": EXPECTED_INPUT_ROWS,
            "sameSentenceVerifiedRows": len(rows),
            "uniqueAccessions": len({row["accession"] for row in rows}),
            "actualCashReceiptVerifiedRows": 0,
            "terminalWealthCompleteRows": 0,
        },
        "rows": rows,
        "claimLocks": contract["claimLocks"],
        "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], contract: dict[str, Any], source: dict[str, Any], implementation: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "inputRawSha256", "inputReportSha256", "semanticCeiling", "implementationBindings", "population", "rows", "claimLocks", "outcomesAccessed", "reportSha256"}, "report")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value != build_report(contract, source, implementation):
        fail("report does not match source rebuild")
    if any(item is not False for item in value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("report claim boundary changed")


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


def self_test(contract: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    implementation = implementation_bindings()
    report = build_report(contract, source, implementation)
    validate_report(report, contract, source, implementation)
    kills = {}
    mutations = {
        "rowRemoved": lambda item: item["rows"].pop(),
        "rowReordered": lambda item: item["rows"].reverse(),
        "effectiveDateChanged": lambda item: item["rows"][0].__setitem__("transactionEffectiveDate", "2000-01-01"),
        "fixedCashAmountChanged": lambda item: item["rows"][0].__setitem__("fixedCashAmount", "999"),
        "sentenceChanged": lambda item: item["rows"][0].__setitem__("statementText", item["rows"][0]["statementText"] + " changed"),
        "sourceHashChanged": lambda item: item["rows"][0]["sourceRef"].__setitem__("evidenceSha256", "0" * 64),
        "sourceLocatorChanged": lambda item: item["rows"][0]["sourceRef"].__setitem__("locator", "sentence[999]/considerationPaymentCandidate"),
        "actualReceiptClaimed": lambda item: item["rows"][0].__setitem__("actualCashReceiptVerified", True),
        "terminalWealthClaimed": lambda item: item["claimLocks"].__setitem__("terminalWealthComplete", True),
        "outcomesClaimed": lambda item: item.__setitem__("outcomesAccessed", True),
    }
    for name, mutate in mutations.items():
        item = copy.deepcopy(report)
        mutate(item)
        item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
        kills[name] = rejected(lambda item=item: validate_report(item, contract, source, implementation))
    target_index = next(index for index, row in enumerate(source["rows"]) if row["accession"] == contract["evidenceContract"]["expectedAccessions"][0])
    source_mutations = {
        "secondConsiderationAmount": lambda item: item["rows"][target_index]["amountCandidates"].append(copy.deepcopy(item["rows"][target_index]["amountCandidates"][0])),
        "securityRatioAdded": lambda item: item["rows"][target_index]["ratioCandidates"].append({"contextClass": "CONSIDERATION_CONTEXT"}),
        "additiveConsiderationAdded": lambda item: item["rows"][target_index].__setitem__("text", item["rows"][target_index]["text"] + " plus additional consideration"),
        "invalidCalendarDate": lambda item: item["rows"][target_index].__setitem__("text", DATE_RE.sub("February 31, 2009", item["rows"][target_index]["text"])),
    }
    for name, mutate in source_mutations.items():
        item = copy.deepcopy(source)
        mutate(item)
        kills[name] = rejected(lambda item=item: build_report(contract, item, implementation))
    if set(kills.values()) != {True}:
        fail("mutation kill failed")
    return {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-self-test/v1", "status": "PASS", "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract = validate_contract()
        source = load_input()
        if args.command == "verify-contract":
            result = {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-contract-verification/v1", "status": "PASS", "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract, source)
        elif args.command == "build":
            implementation = implementation_bindings(remote_required=True)
            report = build_report(contract, source, implementation)
            validate_report(report, contract, source, implementation)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-build/v1", "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "verifiedRows": 11, "outcomesAccessed": False}
        else:
            raw = OUTPUT.read_bytes()
            report = json.loads(raw)
            implementation = implementation_bindings(report.get("implementationBindings", {}).get("buildBaseCommit"), remote_required=True)
            validate_report(report, contract, source, implementation)
            result = {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-verification/v1", "status": "PASS", "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "verifiedRows": 11, "outcomesAccessed": False}
    except (EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
