#!/usr/bin/env python3
"""Build a source-derived proof for exactly eleven frozen SEC sentences."""

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
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-same-sentence-effective-fixed-cash-contract-v5.json"
INPUT = ROOT / "reports" / "early-detection" / "sec-terminal-primary-document-extraction-v1.json"
V4_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-same-sentence-effective-fixed-cash-contract-v4.json"
V4_OUTPUT = ROOT / "reports" / "early-detection" / "sec-same-sentence-effective-fixed-cash-v4.json"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-same-sentence-effective-fixed-cash-v5.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-same-sentence-effective-fixed-cash-v5.test.js"
SOURCE_REBUILD_BUILDER = ROOT / "scripts" / "build-sec-same-sentence-effective-fixed-cash-v2.py"
V4_BUILDER = ROOT / "scripts" / "build-sec-same-sentence-effective-fixed-cash-v4.py"
AUTHORIZED_REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
PRE_IMPLEMENTATION_PARENT = "6085ce3d5b12fa2fb777054b5f7ff3348082d9aa"
EXPECTED_CONTRACT_RAW = "7908ac392ace079b8a28fc3dafb72cd588721dfa016e03891c469edef1010e6b"
EXPECTED_SOURCE_REBUILD_BUILDER_RAW = "3edea67db65e2923adb1d816c81c2201a80fa87dd246b6af2418ef5c32d38095"
EXPECTED_V4_CONTRACT_RAW = "3e391d70c08c62b66fd48383af05efcb99bbbc6bec088686d514e67341a43747"
EXPECTED_V4_BUILDER_RAW = "cb57eeb9555c9feec24db5a7e0034a5df6a24ec80efb5034451afd52fa40f123"
EXPECTED_INPUT_RAW = "987560ca38931cfa818f6c9fb315be7875ec98fd872518ef51d45f5af3589464"
EXPECTED_INPUT_REPORT = "9fd402508ff75ab0d3265cc15c7f77a6e6fa2f659749a43f5719db207d094000"
EXPECTED_V4_RAW = "cf633409e00c865cb35c01734a906f8b6fcf8d8a98e9a8cf25182cf9a19a238e"
EXPECTED_V4_REPORT = "6d354aed8f1dff883d5ae9cc73900e47198bd9c4eefc1cf4a0fd1c86749eef7a"
EXPECTED_INPUT_ROWS = 656


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


def load_source_rebuild_module() -> types.ModuleType:
    raw = SOURCE_REBUILD_BUILDER.read_bytes()
    if sha(raw) != EXPECTED_SOURCE_REBUILD_BUILDER_RAW:
        fail("source-rebuild implementation bytes changed")
    module = types.ModuleType("fixed_cash_v2_source_rebuild_bound")
    module.__file__ = str(SOURCE_REBUILD_BUILDER)
    exec(compile(raw, str(SOURCE_REBUILD_BUILDER), "exec"), module.__dict__)
    return module


BASE = load_source_rebuild_module()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "evidenceContract", "implementationContract", "output", "claimLocks"}, "contract")
    if value["schema"] != "early-detection-sec-same-sentence-effective-fixed-cash-contract/v5" or value["taskId"] != "Q003-SEC-SAME-SENTENCE-EFFECTIVE-FIXED-CASH-V5" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    expected_implementation = {
        "builderPath": "scripts/build-sec-same-sentence-effective-fixed-cash-v5.py",
        "outputAbsentAtBuildBase": True,
        "outputIntroductionDirectChildOfBuildBase": True,
        "preImplementationParentCommit": PRE_IMPLEMENTATION_PARENT,
        "remoteRef": AUTHORIZED_REF,
        "remoteUrl": AUTHORIZED_REMOTE_URL,
        "singleParentBuildBase": True,
        "testPath": "tests/build-sec-same-sentence-effective-fixed-cash-v5.test.js",
    }
    if value["implementationContract"] != expected_implementation:
        fail("implementation contract changed")
    expected_inputs = {
        "documentExtraction": {"path": "reports/early-detection/sec-terminal-primary-document-extraction-v1.json", "rawSha256": EXPECTED_INPUT_RAW, "reportSha256": EXPECTED_INPUT_REPORT},
        "sourceRebuildImplementation": {"builderPath": "scripts/build-sec-same-sentence-effective-fixed-cash-v2.py", "builderRawSha256": EXPECTED_SOURCE_REBUILD_BUILDER_RAW},
        "supersededV4": {"builderRawSha256": EXPECTED_V4_BUILDER_RAW, "contractRawSha256": EXPECTED_V4_CONTRACT_RAW, "outputRawSha256": EXPECTED_V4_RAW, "outputReportSha256": EXPECTED_V4_REPORT, "status": "SUPERSEDED_P1_GENERAL_SELECTOR_SCOPE"},
    }
    if value["inputs"] != expected_inputs:
        fail("input binding changed")
    policy = value["evidenceContract"]
    exact_keys(policy, {"actualCashReceiptNotInferred", "currencyDisposition", "exactFrozenSentenceSetRequired", "expectedAccessions", "expectedAmountsByAccession", "expectedEffectiveDatesByAccession", "expectedRows", "expectedStatementSha256ByAccession", "futureRowsRequireNewProtocol", "oneConsiderationAmountRequired", "primarySecBlobRebuildRequired", "scopeLimit", "semanticCeiling", "sourceAmountOffsetAndTextRequired", "sourceSentenceHashRequired"}, "evidence contract")
    accessions = policy["expectedAccessions"]
    maps = (policy["expectedAmountsByAccession"], policy["expectedEffectiveDatesByAccession"], policy["expectedStatementSha256ByAccession"])
    if not isinstance(accessions, list) or accessions != sorted(accessions) or len(accessions) != 11 or len(set(accessions)) != 11 or any(set(item) != set(accessions) for item in maps):
        fail("frozen evidence population changed")
    if any(not isinstance(item, str) or re.fullmatch(r"[0-9a-f]{64}", item) is None for item in policy["expectedStatementSha256ByAccession"].values()):
        fail("frozen sentence hashes changed")
    required_true = ("actualCashReceiptNotInferred", "exactFrozenSentenceSetRequired", "futureRowsRequireNewProtocol", "oneConsiderationAmountRequired", "primarySecBlobRebuildRequired", "sourceAmountOffsetAndTextRequired", "sourceSentenceHashRequired")
    if policy["expectedRows"] != 11 or any(policy[key] is not True for key in required_true):
        fail("evidence requirements changed")
    if policy["currencyDisposition"] != "DOLLAR_MARKER_PRESENT_CURRENCY_UNRESOLVED" or policy["scopeLimit"] != "NO_GENERAL_PARSER_OR_UNSEEN_SENTENCE_CLAIM" or policy["semanticCeiling"] != "EXACT_ELEVEN_FROZEN_PRIMARY_SEC_SENTENCES_STATE_EFFECTIVE_TRANSACTION_DATE_AND_FIXED_CASH_CONVERSION":
        fail("claim scope changed")
    if value["output"] != {"path": "reports/early-detection/sec-same-sentence-effective-fixed-cash-v5.json", "writeNewAtomic": True} or any(item is not False for item in value["claimLocks"].values()):
        fail("output or claim boundary changed")
    v4_raw = V4_OUTPUT.read_bytes()
    v4 = json.loads(v4_raw)
    body = dict(v4)
    claim = body.pop("reportSha256", None)
    if sha(V4_CONTRACT.read_bytes()) != EXPECTED_V4_CONTRACT_RAW or sha(V4_BUILDER.read_bytes()) != EXPECTED_V4_BUILDER_RAW or sha(v4_raw) != EXPECTED_V4_RAW or claim != EXPECTED_V4_REPORT or sha(canonical(body)) != EXPECTED_V4_REPORT:
        fail("superseded V4 binding changed")
    return value


def exact_source_rows(source: dict[str, Any], contract: dict[str, Any]) -> list[dict[str, Any]]:
    policy = contract["evidenceContract"]
    expected = set(policy["expectedAccessions"])
    selected = [row for row in source["rows"] if row.get("accession") in expected]
    if len(selected) != len(expected) or {row["accession"] for row in selected} != expected:
        fail("frozen source population changed")
    for row in selected:
        accession = row["accession"]
        text = row.get("text")
        if not isinstance(text, str) or sha(text.encode("utf-8")) != policy["expectedStatementSha256ByAccession"][accession]:
            fail("frozen source sentence changed")
        if row.get("ratioCandidates") != []:
            fail("frozen ratio evidence changed")
        amounts = [item for item in row.get("amountCandidates", []) if item.get("contextClass") == "CONSIDERATION_CONTEXT"]
        if len(amounts) != 1:
            fail("frozen amount cardinality changed")
        amount = amounts[0]
        exact_keys(amount, {"contextClass", "currencyMarker", "end", "normalizedDecimal", "rawText", "start"}, "amount evidence")
        start, end = amount["start"], amount["end"]
        if not isinstance(start, int) or not isinstance(end, int) or start < 0 or end <= start or end > len(text) or text[start:end] != amount["rawText"]:
            fail("amount offset or raw text changed")
        if amount["currencyMarker"] != "$" or not amount["rawText"].startswith("$") or amount["normalizedDecimal"] != policy["expectedAmountsByAccession"][accession]:
            fail("amount evidence changed")
        dates = BASE.DATE_RE.findall(text)
        if len(dates) != 1 or BASE.parse_date(dates[0]) != policy["expectedEffectiveDatesByAccession"][accession]:
            fail("date evidence changed")
        BASE.validate_source_ref(row["sourceRef"], text)
        if BASE.rebuild_source_sentence(accession, row["sourceRef"]) != text:
            fail("source sentence does not match SEC SGML rebuild")
    return sorted(selected, key=lambda item: item["accession"])


def build_rows(source: dict[str, Any], contract: dict[str, Any]) -> list[dict[str, Any]]:
    frozen = exact_source_rows(source, contract)
    original_selector = BASE.selected_source_rows
    try:
        BASE.selected_source_rows = lambda _source: frozen
        rows = BASE.build_rows(source, contract)
    finally:
        BASE.selected_source_rows = original_selector
    expected_hashes = contract["evidenceContract"]["expectedStatementSha256ByAccession"]
    if {row["accession"]: row["statementTextSha256"] for row in rows} != expected_hashes:
        fail("built frozen sentence set changed")
    return rows


def implementation_bindings(base_commit: str | None = None, remote_required: bool = False) -> dict[str, Any]:
    head = git("rev-parse", "HEAD")
    base = head if base_commit is None else base_commit
    if not isinstance(base, str) or re.fullmatch(r"[0-9a-f]{40}", base) is None:
        fail("invalid implementation base")
    builder_raw = git_bytes(base, BUILDER) if remote_required else BUILDER.read_bytes()
    test_raw = git_bytes(base, TEST) if remote_required else TEST.read_bytes()
    bindings = {"buildBaseCommit": base, "remoteUrl": AUTHORIZED_REMOTE_URL, "remoteRef": AUTHORIZED_REF, "contractRawSha256": sha(CONTRACT.read_bytes()), "builderRawSha256": sha(builder_raw), "testRawSha256": sha(test_raw), "sourceRebuildBuilderRawSha256": EXPECTED_SOURCE_REBUILD_BUILDER_RAW, "v4BuilderRawSha256": EXPECTED_V4_BUILDER_RAW}
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
        for path, claim in ((CONTRACT, bindings["contractRawSha256"]), (BUILDER, bindings["builderRawSha256"]), (TEST, bindings["testRawSha256"]), (SOURCE_REBUILD_BUILDER, EXPECTED_SOURCE_REBUILD_BUILDER_RAW), (V4_CONTRACT, EXPECTED_V4_CONTRACT_RAW), (V4_BUILDER, EXPECTED_V4_BUILDER_RAW), (V4_OUTPUT, EXPECTED_V4_RAW)):
            raw = git_bytes(base, path)
            if sha(raw) != claim or raw != path.read_bytes():
                fail("implementation or input Git blob changed")
    return bindings


def build_report(contract: dict[str, Any], source: dict[str, Any], implementation: dict[str, Any]) -> dict[str, Any]:
    rows = build_rows(source, contract)
    value = {
        "schema": "early-detection-sec-same-sentence-effective-fixed-cash/v5",
        "taskId": contract["taskId"], "track": contract["track"], "contractRawSha256": sha(CONTRACT.read_bytes()),
        "inputRawSha256": EXPECTED_INPUT_RAW, "inputReportSha256": EXPECTED_INPUT_REPORT,
        "scopeLimit": contract["evidenceContract"]["scopeLimit"], "semanticCeiling": contract["evidenceContract"]["semanticCeiling"],
        "supersededV4RawSha256": EXPECTED_V4_RAW, "implementationBindings": implementation,
        "population": {"inputExtractionRows": EXPECTED_INPUT_ROWS, "frozenSentenceVerifiedRows": len(rows), "uniqueAccessions": len({row["accession"] for row in rows}), "actualCashReceiptVerifiedRows": 0, "terminalWealthCompleteRows": 0},
        "rows": rows, "claimLocks": contract["claimLocks"], "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], contract: dict[str, Any], source: dict[str, Any], implementation: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "inputRawSha256", "inputReportSha256", "scopeLimit", "semanticCeiling", "supersededV4RawSha256", "implementationBindings", "population", "rows", "claimLocks", "outcomesAccessed", "reportSha256"}, "report")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value != build_report(contract, source, implementation):
        fail("report does not match exact source rebuild")
    if any(item is not False for item in value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("claim boundary changed")


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (EvidenceError, BASE.EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def rehash_report(value: dict[str, Any]) -> None:
    value["reportSha256"] = sha(canonical({key: item for key, item in value.items() if key != "reportSha256"}))


def self_test(contract: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    implementation = implementation_bindings()
    report = build_report(contract, source, implementation)
    validate_report(report, contract, source, implementation)
    kills: dict[str, bool] = {}
    for label, mutate in {
        "rowRemoved": lambda item: item["rows"].pop(),
        "currencyCodeClaimed": lambda item: item["rows"][0].__setitem__("currencyCode", "USD"),
        "receiptClaimed": lambda item: item["rows"][0].__setitem__("actualCashReceiptVerified", True),
        "terminalWealthClaimed": lambda item: item["claimLocks"].__setitem__("terminalWealthComplete", True),
        "scopeExpanded": lambda item: item.__setitem__("scopeLimit", "GENERAL_PARSER"),
        "sourceHashChanged": lambda item: item["rows"][0]["sourceRef"].__setitem__("evidenceSha256", "0" * 64),
    }.items():
        item = copy.deepcopy(report)
        mutate(item)
        rehash_report(item)
        kills[label] = rejected(lambda item=item: validate_report(item, contract, source, implementation))
    target = next(index for index, row in enumerate(source["rows"]) if row.get("accession") == contract["evidenceContract"]["expectedAccessions"][0])
    for label, mutate in {
        "sentenceChangedAndRehashed": lambda row: (row.__setitem__("text", row["text"] + " extra"), row["sourceRef"].__setitem__("evidenceSha256", sha((row["text"] + " extra").encode("utf-8")))),
        "amountNormalizedChanged": lambda row: row["amountCandidates"][0].__setitem__("normalizedDecimal", "99"),
        "amountRawTextChanged": lambda row: row["amountCandidates"][0].__setitem__("rawText", "$99.00 in cash"),
        "amountStartChanged": lambda row: row["amountCandidates"][0].__setitem__("start", row["amountCandidates"][0]["start"] + 1),
        "amountEndChanged": lambda row: row["amountCandidates"][0].__setitem__("end", row["amountCandidates"][0]["end"] - 1),
        "ratioAdded": lambda row: row["ratioCandidates"].append({"contextClass": "CONSIDERATION_CONTEXT"}),
    }.items():
        item = copy.deepcopy(source)
        mutate(item["rows"][target])
        kills[label] = rejected(lambda item=item: build_rows(item, contract))
    duplicate = copy.deepcopy(source)
    duplicate["rows"].append(copy.deepcopy(duplicate["rows"][target]))
    kills["duplicateFrozenAccession"] = rejected(lambda: build_rows(duplicate, contract))
    if set(kills.values()) != {True}:
        fail("mutation kill failed")
    return {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-self-test/v5", "status": "PASS", "kills": kills, "scopeLimit": "NO_GENERAL_PARSER_OR_UNSEEN_SENTENCE_CLAIM", "outcomesAccessed": False}


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
        source = BASE.load_input()
        if args.command == "verify-contract":
            result = {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-contract-verification/v5", "status": "PASS", "scopeLimit": contract["evidenceContract"]["scopeLimit"], "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract, source)
        elif args.command == "build":
            implementation = implementation_bindings(remote_required=True)
            report = build_report(contract, source, implementation)
            validate_report(report, contract, source, implementation)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-build/v5", "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "verifiedRows": 11, "scopeLimit": report["scopeLimit"], "outcomesAccessed": False}
        else:
            raw = OUTPUT.read_bytes()
            report = json.loads(raw)
            base = report.get("implementationBindings", {}).get("buildBaseCommit")
            implementation = implementation_bindings(base, remote_required=True)
            output_introduction(base)
            validate_report(report, contract, source, implementation)
            if git_bytes(git("rev-parse", "HEAD"), OUTPUT) != raw:
                fail("output Git blob changed")
            result = {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-verification/v5", "status": "PASS", "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "verifiedRows": 11, "scopeLimit": report["scopeLimit"], "outcomesAccessed": False}
    except (EvidenceError, BASE.EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
