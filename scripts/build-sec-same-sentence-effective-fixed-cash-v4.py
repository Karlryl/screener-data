#!/usr/bin/env python3
"""Build V4 by requiring an allowlisted pure-cash conversion-tail grammar."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import subprocess
import tempfile
import types
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-same-sentence-effective-fixed-cash-contract-v4.json"
INPUT = ROOT / "reports" / "early-detection" / "sec-terminal-primary-document-extraction-v1.json"
V3_OUTPUT = ROOT / "reports" / "early-detection" / "sec-same-sentence-effective-fixed-cash-v3.json"
V3_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-same-sentence-effective-fixed-cash-contract-v3.json"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-same-sentence-effective-fixed-cash-v4.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-same-sentence-effective-fixed-cash-v4.test.js"
V3_BUILDER = ROOT / "scripts" / "build-sec-same-sentence-effective-fixed-cash-v3.py"
AUTHORIZED_REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
PRE_IMPLEMENTATION_PARENT = "0fdaff2626962f06d0f9d4bdc1118bba27c80d5c"
EXPECTED_CONTRACT_RAW = "3e391d70c08c62b66fd48383af05efcb99bbbc6bec088686d514e67341a43747"
EXPECTED_V3_BUILDER_RAW = "4d4a1f2b1dca8cca5b1cadf7fd69af795f730cb9318a15b19aa269fc48e2d2cb"
EXPECTED_INPUT_RAW = "987560ca38931cfa818f6c9fb315be7875ec98fd872518ef51d45f5af3589464"
EXPECTED_INPUT_REPORT = "9fd402508ff75ab0d3265cc15c7f77a6e6fa2f659749a43f5719db207d094000"
EXPECTED_V3_RAW = "0055d7f477db0f2fd7109879d811f5f694bc0d2ab8a32eb819075ec97d91984e"
EXPECTED_V3_REPORT = "5cc45b6641dc879d17783ae09af38aaf65f2c9776d94a9e5ef9112a307950b6a"
PURE_CASH_TAILS = (
    re.compile(r"^\s*\$\d+(?:\.\d+)?\s+in\s+cash\s+per\s+share\.\s*$", re.I),
    re.compile(r"^\s*\$\d+(?:\.\d+)?\s+per\s+share\s+in\s+cash\.\s*$", re.I),
    re.compile(r"^\s*\$\d+(?:\.\d+)?\s+per\s+share,\s+net\s+to\s+the\s+seller\s+in\s+cash,\s+without\s+interest,\s+less\s+any\s+applicable\s+withholding\s+taxes\.\s*$", re.I),
    re.compile(r"^\s*\$\d+(?:\.\d+)?\s+in\s+cash\.\s*$", re.I),
    re.compile(r"^\s*\$\d+(?:\.\d+)?\s+per\s+Share,\s+net\s+to\s+the\s+holders,\s+in\s+cash,\s+without\s+interest\s+and\s+less\s+any\s+applicable\s+tax\s+withholding\.\s*$", re.I),
    re.compile(r"^\s*\$\d+(?:\.\d+)?\s+cash\s+per\s+share\.\s*$", re.I),
    re.compile(r"^\s*the\s+right\s+to\s+receive\s+an\s+amount,\s+net\s+in\s+cash,\s+equal\s+to\s+the\s+Offer\s+Price\s+\(\$\d+(?:\.\d+)?\)\.\s*$", re.I),
)


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


def git_bytes(commit: str, path: Path) -> bytes:
    run = subprocess.run(["git", "show", f"{commit}:{path.relative_to(ROOT).as_posix()}"], cwd=ROOT, check=False, capture_output=True)
    if run.returncode:
        fail("Git blob missing")
    return run.stdout


def load_v3_module() -> types.ModuleType:
    raw = V3_BUILDER.read_bytes()
    if sha(raw) != EXPECTED_V3_BUILDER_RAW:
        fail("V3 implementation bytes changed")
    module = types.ModuleType("fixed_cash_v3_bound")
    module.__file__ = str(V3_BUILDER)
    exec(compile(raw, str(V3_BUILDER), "exec"), module.__dict__)
    return module


BASE = load_v3_module()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def pure_cash_tail(text: str) -> bool:
    conversion = list(BASE.BASE.CONVERSION_RE.finditer(text))
    if len(conversion) != 1:
        return False
    subject = text[:conversion[0].start()]
    subject_matches = list(re.finditer(r"\b(?:each|every)\b.{0,180}\b(?:share|unit|stock)\b", subject, re.I | re.S))
    if not subject_matches or re.search(r"\b(?:share|unit|stock|security|equity\s+interest)\b", subject[:subject_matches[-1].start()], re.I):
        return False
    tail = text[conversion[0].end():]
    return sum(pattern.fullmatch(tail) is not None for pattern in PURE_CASH_TAILS) == 1


def selected_source_rows(source: dict[str, Any]) -> list[dict[str, Any]]:
    selected = []
    for row in source["rows"]:
        text = row.get("text")
        if not isinstance(text, str):
            fail("source text changed")
        amounts = [item for item in row.get("amountCandidates", []) if item.get("contextClass") == "CONSIDERATION_CONTEXT"]
        ratios = [item for item in row.get("ratioCandidates", []) if item.get("contextClass") == "CONSIDERATION_CONTEXT"]
        dates = BASE.BASE.DATE_RE.findall(text)
        if len(amounts) == 1 and not ratios and len(dates) == 1 and "became effective" in text.casefold() and "cash" in text.casefold() and not BASE.BASE.EXCLUSION_RE.search(text) and pure_cash_tail(text):
            selected.append(row)
    return selected


BASE.BASE.selected_source_rows = selected_source_rows


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "evidenceContract", "implementationContract", "output", "claimLocks"}, "contract")
    if value["schema"] != "early-detection-sec-same-sentence-effective-fixed-cash-contract/v4" or value["taskId"] != "Q003-SEC-SAME-SENTENCE-EFFECTIVE-FIXED-CASH-V4" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    if value["implementationContract"] != {"builderPath": "scripts/build-sec-same-sentence-effective-fixed-cash-v4.py", "outputAbsentAtBuildBase": True, "outputIntroductionDirectChildOfBuildBase": True, "preImplementationParentCommit": PRE_IMPLEMENTATION_PARENT, "remoteRef": AUTHORIZED_REF, "remoteUrl": AUTHORIZED_REMOTE_URL, "singleParentBuildBase": True, "testPath": "tests/build-sec-same-sentence-effective-fixed-cash-v4.test.js"}:
        fail("implementation contract changed")
    expected_inputs = {
        "documentExtraction": {"path": "reports/early-detection/sec-terminal-primary-document-extraction-v1.json", "rawSha256": EXPECTED_INPUT_RAW, "reportSha256": EXPECTED_INPUT_REPORT},
        "supersededV3": {"builderRawSha256": EXPECTED_V3_BUILDER_RAW, "contractRawSha256": "3d69cdd6d8b188790a16835d45e30a49b723e84201f32590f82a089b6a50868a", "outputRawSha256": EXPECTED_V3_RAW, "outputReportSha256": EXPECTED_V3_REPORT, "status": "SUPERSEDED_P1_MIXED_SECURITY_GRAMMAR"},
    }
    if value["inputs"] != expected_inputs:
        fail("input binding changed")
    policy = value["evidenceContract"]
    exact_keys(policy, {"actualCashReceiptNotInferred", "currencyDisposition", "expectedAccessions", "expectedAmountsByAccession", "expectedEffectiveDatesByAccession", "expectedRows", "pureCashTailGrammarRequired", "oneConsiderationAmountRequired", "primarySecBlobRebuildRequired", "sameSentenceEffectiveDateCashConversionRequired", "semanticCeiling", "sourceSentenceHashRequired"}, "evidence contract")
    accessions = policy["expectedAccessions"]
    if not isinstance(accessions, list) or accessions != sorted(accessions) or len(accessions) != 11 or len(set(accessions)) != 11 or set(policy["expectedAmountsByAccession"]) != set(accessions) or set(policy["expectedEffectiveDatesByAccession"]) != set(accessions):
        fail("expected evidence population changed")
    required_true = ("actualCashReceiptNotInferred", "pureCashTailGrammarRequired", "oneConsiderationAmountRequired", "primarySecBlobRebuildRequired", "sameSentenceEffectiveDateCashConversionRequired", "sourceSentenceHashRequired")
    if policy["expectedRows"] != 11 or any(policy[key] is not True for key in required_true) or policy["currencyDisposition"] != "DOLLAR_MARKER_PRESENT_CURRENCY_UNRESOLVED" or policy["semanticCeiling"] != "PRIMARY_SEC_SENTENCE_STATES_EFFECTIVE_TRANSACTION_DATE_AND_FIXED_CASH_CONVERSION":
        fail("evidence requirements changed")
    if value["output"] != {"path": "reports/early-detection/sec-same-sentence-effective-fixed-cash-v4.json", "writeNewAtomic": True} or any(item is not False for item in value["claimLocks"].values()):
        fail("output or claim boundary changed")
    v3_raw = V3_OUTPUT.read_bytes()
    if sha(V3_CONTRACT.read_bytes()) != "3d69cdd6d8b188790a16835d45e30a49b723e84201f32590f82a089b6a50868a":
        fail("superseded V3 contract binding changed")
    v3 = json.loads(v3_raw)
    body = dict(v3)
    claim = body.pop("reportSha256", None)
    if sha(v3_raw) != EXPECTED_V3_RAW or claim != EXPECTED_V3_REPORT or sha(canonical(body)) != EXPECTED_V3_REPORT:
        fail("superseded V3 binding changed")
    return value


def implementation_bindings(base_commit: str | None = None, remote_required: bool = False) -> dict[str, Any]:
    head = git("rev-parse", "HEAD")
    base = head if base_commit is None else base_commit
    if not re.fullmatch(r"[0-9a-f]{40}", base):
        fail("invalid implementation base")
    builder_raw = git_bytes(base, BUILDER) if remote_required else BUILDER.read_bytes()
    test_raw = git_bytes(base, TEST) if remote_required else TEST.read_bytes()
    bindings = {"buildBaseCommit": base, "remoteUrl": AUTHORIZED_REMOTE_URL, "remoteRef": AUTHORIZED_REF, "contractRawSha256": sha(CONTRACT.read_bytes()), "builderRawSha256": sha(builder_raw), "testRawSha256": sha(test_raw), "v3BuilderRawSha256": EXPECTED_V3_BUILDER_RAW}
    if remote_required:
        if git("remote", "get-url", "origin") != AUTHORIZED_REMOTE_URL:
            fail("remote URL changed")
        rows = git("ls-remote", "--refs", "origin", AUTHORIZED_REF).splitlines()
        if len(rows) != 1 or rows[0].split()[0] != head or git("rev-parse", "@{upstream}") != head:
            fail("local, upstream and remote head differ")
        if git("rev-list", "--parents", "-n", "1", base).split() != [base, PRE_IMPLEMENTATION_PARENT]:
            fail("build base is not the sealed direct child")
        if subprocess.run(["git", "cat-file", "-e", f"{base}:{OUTPUT.relative_to(ROOT).as_posix()}"], cwd=ROOT, check=False, capture_output=True).returncode == 0:
            fail("output existed at build base")
        for path, claim in ((CONTRACT, bindings["contractRawSha256"]), (BUILDER, bindings["builderRawSha256"]), (TEST, bindings["testRawSha256"]), (V3_BUILDER, EXPECTED_V3_BUILDER_RAW), (V3_CONTRACT, "3d69cdd6d8b188790a16835d45e30a49b723e84201f32590f82a089b6a50868a")):
            raw = git_bytes(base, path)
            if sha(raw) != claim or raw != path.read_bytes():
                fail("implementation Git blob changed")
    return bindings


def build_report(contract: dict[str, Any], source: dict[str, Any], implementation: dict[str, Any]) -> dict[str, Any]:
    rows = BASE.BASE.build_rows(source, contract)
    value = {
        "schema": "early-detection-sec-same-sentence-effective-fixed-cash/v4",
        "taskId": contract["taskId"], "track": contract["track"], "contractRawSha256": sha(CONTRACT.read_bytes()),
        "inputRawSha256": EXPECTED_INPUT_RAW, "inputReportSha256": EXPECTED_INPUT_REPORT,
        "semanticCeiling": contract["evidenceContract"]["semanticCeiling"], "supersededV3RawSha256": EXPECTED_V3_RAW,
        "implementationBindings": implementation,
        "population": {"inputExtractionRows": 656, "sameSentenceVerifiedRows": len(rows), "uniqueAccessions": len({row["accession"] for row in rows}), "actualCashReceiptVerifiedRows": 0, "terminalWealthCompleteRows": 0},
        "rows": rows, "claimLocks": contract["claimLocks"], "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], contract: dict[str, Any], source: dict[str, Any], implementation: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "inputRawSha256", "inputReportSha256", "semanticCeiling", "supersededV3RawSha256", "implementationBindings", "population", "rows", "claimLocks", "outcomesAccessed", "reportSha256"}, "report")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value != build_report(contract, source, implementation):
        fail("report does not match exact source rebuild")
    if any(item is not False for item in value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("claim boundary changed")


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (EvidenceError, BASE.EvidenceError, BASE.BASE.EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    implementation = implementation_bindings()
    report = build_report(contract, source, implementation)
    validate_report(report, contract, source, implementation)
    kills: dict[str, bool] = {}
    for label, mutate in {
        "rowRemoved": lambda item: item["rows"].pop(),
        "currencyCodeClaimed": lambda item: item["rows"][0].__setitem__("currencyCode", "USD"),
        "actualReceiptClaimed": lambda item: item["rows"][0].__setitem__("actualCashReceiptVerified", True),
        "terminalWealthClaimed": lambda item: item["claimLocks"].__setitem__("terminalWealthComplete", True),
        "sourceHashChanged": lambda item: item["rows"][0]["sourceRef"].__setitem__("evidenceSha256", "0" * 64),
    }.items():
        item = copy.deepcopy(report)
        mutate(item)
        item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
        kills[label] = rejected(lambda item=item: validate_report(item, contract, source, implementation))
    target = next(index for index, row in enumerate(source["rows"]) if row["accession"] == contract["evidenceContract"]["expectedAccessions"][0])
    base_text = source["rows"][target]["text"]
    fixtures = {
        "preferredStock": base_text + " and one Parent preferred stock",
        "classAStock": base_text + " and one Class A common stock",
        "numericClassAStock": base_text + " and 1 Class A common stock",
        "depositaryShare": base_text + " and one American Depositary Share",
        "equityInterest": base_text + " and one equity interest in Parent",
        "fractionalOrdinaryShare": base_text + " and 0.3683 of an Ordinary Share",
        "securityBeforeCash": "one Parent common share and " + base_text,
        "conditionalEffective": "If the merger became effective, " + base_text,
        "unrecognizedAdditionalTail": base_text + " and any other consideration",
    }
    for label, text in fixtures.items():
        item = copy.deepcopy(source)
        item["rows"][target]["text"] = text
        kills[label] = item["rows"][target] not in selected_source_rows(item)
    if set(kills.values()) != {True}:
        fail("mutation kill failed")
    return {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-self-test/v4", "status": "PASS", "kills": kills, "outcomesAccessed": False}


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


def output_introduction(base: str) -> str:
    rows = subprocess.run(["git", "log", "--diff-filter=A", "--format=%H", "--", OUTPUT.relative_to(ROOT).as_posix()], cwd=ROOT, check=False, capture_output=True, text=True, encoding="utf-8").stdout.strip().splitlines()
    if len(rows) != 1 or git("rev-list", "--parents", "-n", "1", rows[0]).split() != [rows[0], base]:
        fail("output introduction is not the direct child of build base")
    return rows[0]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract = validate_contract()
        source = BASE.BASE.load_input()
        if args.command == "verify-contract":
            result = {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-contract-verification/v4", "status": "PASS", "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract, source)
        elif args.command == "build":
            implementation = implementation_bindings(remote_required=True)
            report = build_report(contract, source, implementation)
            validate_report(report, contract, source, implementation)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-build/v4", "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "verifiedRows": 11, "outcomesAccessed": False}
        else:
            raw = OUTPUT.read_bytes(); report = json.loads(raw); base = report.get("implementationBindings", {}).get("buildBaseCommit")
            implementation = implementation_bindings(base, remote_required=True); output_introduction(base); validate_report(report, contract, source, implementation)
            if git_bytes(git("rev-parse", "HEAD"), OUTPUT) != raw:
                fail("output Git blob changed")
            result = {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-verification/v4", "status": "PASS", "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "verifiedRows": 11, "outcomesAccessed": False}
    except (EvidenceError, BASE.EvidenceError, BASE.BASE.EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True)); return 0


if __name__ == "__main__":
    raise SystemExit(main())
