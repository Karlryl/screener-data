#!/usr/bin/env python3
"""Build the V3 narrow fixed-cash family with exact source and Git bindings."""

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
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-same-sentence-effective-fixed-cash-contract-v3.json"
INPUT = ROOT / "reports" / "early-detection" / "sec-terminal-primary-document-extraction-v1.json"
V2_OUTPUT = ROOT / "reports" / "early-detection" / "sec-same-sentence-effective-fixed-cash-v2.json"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-same-sentence-effective-fixed-cash-v3.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-same-sentence-effective-fixed-cash-v3.test.js"
V2_BUILDER = ROOT / "scripts" / "build-sec-same-sentence-effective-fixed-cash-v2.py"
AUTHORIZED_REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
PRE_IMPLEMENTATION_PARENT = "cb4674715c4d1d8c0e39f0c3caf12682184921d7"
EXPECTED_CONTRACT_RAW = "3d69cdd6d8b188790a16835d45e30a49b723e84201f32590f82a089b6a50868a"
EXPECTED_V2_BUILDER_RAW = "3edea67db65e2923adb1d816c81c2201a80fa87dd246b6af2418ef5c32d38095"
EXPECTED_INPUT_RAW = "987560ca38931cfa818f6c9fb315be7875ec98fd872518ef51d45f5af3589464"
EXPECTED_INPUT_REPORT = "9fd402508ff75ab0d3265cc15c7f77a6e6fa2f659749a43f5719db207d094000"
EXPECTED_V2_RAW = "7f81f89f80f5d96b01687a51cf6ce95eac356308af92635e0cdfe5c480754622"
EXPECTED_V2_REPORT = "19273be01cb9517f802326ae4afd9c40ff2ab1a0db0cad86acb5f5243a625814"
SECURITY_CONSIDERATION_RE = re.compile(
    r"(?:"
    r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)\s+"
    r"(?:of\s+)?(?:an?\s+|the\s+)?(?:new\s+|parent\s+|class\s+[a-z]\s+)*"
    r"(?:common\s+|ordinary\s+|preferred\s+)?(?:share|unit)s?\b"
    r"|\b(?:and|plus)\s+(?:shares?\s+of\s+)?(?:new\s+|parent\s+)*"
    r"(?:common|ordinary|preferred)\s+(?:shares?|stock|units?)\b"
    r"|\b(?:new\s+|parent\s+)*(?:common|ordinary|preferred)\s+(?:shares?|stock|units?)\b"
    r".{0,120}\band\b.{0,120}\bcash\b"
    r")",
    re.I,
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


def load_v2_module() -> types.ModuleType:
    raw = V2_BUILDER.read_bytes()
    if sha(raw) != EXPECTED_V2_BUILDER_RAW:
        fail("V2 implementation bytes changed")
    module = types.ModuleType("fixed_cash_v2_bound")
    module.__file__ = str(V2_BUILDER)
    exec(compile(raw, str(V2_BUILDER), "exec"), module.__dict__)
    return module


BASE = load_v2_module()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def security_consideration_absent(text: str) -> bool:
    return SECURITY_CONSIDERATION_RE.search(text) is None


def selected_source_rows(source: dict[str, Any]) -> list[dict[str, Any]]:
    selected = []
    for row in source["rows"]:
        text = row.get("text")
        if not isinstance(text, str):
            fail("source text changed")
        amounts = [item for item in row.get("amountCandidates", []) if item.get("contextClass") == "CONSIDERATION_CONTEXT"]
        ratios = [item for item in row.get("ratioCandidates", []) if item.get("contextClass") == "CONSIDERATION_CONTEXT"]
        dates = BASE.DATE_RE.findall(text)
        if (
            len(amounts) == 1
            and not ratios
            and len(dates) == 1
            and "became effective" in text.casefold()
            and BASE.CONVERSION_RE.search(text)
            and "cash" in text.casefold()
            and not BASE.EXCLUSION_RE.search(text)
            and security_consideration_absent(text)
        ):
            selected.append(row)
    return selected


BASE.selected_source_rows = selected_source_rows


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "evidenceContract", "implementationContract", "output", "claimLocks"}, "contract")
    if value["schema"] != "early-detection-sec-same-sentence-effective-fixed-cash-contract/v3" or value["taskId"] != "Q003-SEC-SAME-SENTENCE-EFFECTIVE-FIXED-CASH-V3" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    if value["implementationContract"] != {
        "builderPath": "scripts/build-sec-same-sentence-effective-fixed-cash-v3.py",
        "outputAbsentAtBuildBase": True,
        "outputIntroductionDirectChildOfBuildBase": True,
        "preImplementationParentCommit": PRE_IMPLEMENTATION_PARENT,
        "remoteRef": AUTHORIZED_REF,
        "remoteUrl": AUTHORIZED_REMOTE_URL,
        "singleParentBuildBase": True,
        "testPath": "tests/build-sec-same-sentence-effective-fixed-cash-v3.test.js",
    }:
        fail("implementation contract changed")
    expected_inputs = {
        "documentExtraction": {"path": "reports/early-detection/sec-terminal-primary-document-extraction-v1.json", "rawSha256": EXPECTED_INPUT_RAW, "reportSha256": EXPECTED_INPUT_REPORT},
        "supersededV2": {
            "builderRawSha256": EXPECTED_V2_BUILDER_RAW,
            "contractRawSha256": "4fdfd79ffe4f50eebb6634852c26ff5051f734d2e09b86773963afe3b9c32e42",
            "outputRawSha256": EXPECTED_V2_RAW,
            "outputReportSha256": EXPECTED_V2_REPORT,
            "status": "SUPERSEDED_P1_LINEAGE_AND_MIXED_SECURITY_HARNESS",
        },
    }
    if value["inputs"] != expected_inputs:
        fail("input binding changed")
    policy = value["evidenceContract"]
    exact_keys(policy, {"actualCashReceiptNotInferred", "currencyDisposition", "expectedAccessions", "expectedAmountsByAccession", "expectedEffectiveDatesByAccession", "expectedRows", "mixedSecurityConsiderationForbidden", "oneConsiderationAmountRequired", "primarySecBlobRebuildRequired", "sameSentenceEffectiveDateCashConversionRequired", "semanticCeiling", "sourceSentenceHashRequired"}, "evidence contract")
    accessions = policy["expectedAccessions"]
    if not isinstance(accessions, list) or accessions != sorted(accessions) or len(accessions) != 11 or len(set(accessions)) != 11:
        fail("expected accessions changed")
    if set(policy["expectedAmountsByAccession"]) != set(accessions) or set(policy["expectedEffectiveDatesByAccession"]) != set(accessions):
        fail("expected evidence maps changed")
    required_true = ("actualCashReceiptNotInferred", "mixedSecurityConsiderationForbidden", "oneConsiderationAmountRequired", "primarySecBlobRebuildRequired", "sameSentenceEffectiveDateCashConversionRequired", "sourceSentenceHashRequired")
    if policy["expectedRows"] != 11 or any(policy[key] is not True for key in required_true) or policy["currencyDisposition"] != "DOLLAR_MARKER_PRESENT_CURRENCY_UNRESOLVED" or policy["semanticCeiling"] != "PRIMARY_SEC_SENTENCE_STATES_EFFECTIVE_TRANSACTION_DATE_AND_FIXED_CASH_CONVERSION":
        fail("evidence requirements changed")
    if value["output"] != {"path": "reports/early-detection/sec-same-sentence-effective-fixed-cash-v3.json", "writeNewAtomic": True} or any(item is not False for item in value["claimLocks"].values()):
        fail("output or claim boundary changed")
    v2_raw = V2_OUTPUT.read_bytes()
    v2 = json.loads(v2_raw)
    body = dict(v2)
    claim = body.pop("reportSha256", None)
    if sha(v2_raw) != EXPECTED_V2_RAW or claim != EXPECTED_V2_REPORT or sha(canonical(body)) != EXPECTED_V2_REPORT:
        fail("superseded V2 binding changed")
    return value


def implementation_bindings(base_commit: str | None = None, remote_required: bool = False) -> dict[str, Any]:
    head = git("rev-parse", "HEAD")
    base = head if base_commit is None else base_commit
    if not re.fullmatch(r"[0-9a-f]{40}", base):
        fail("invalid implementation base")
    builder_raw = git_bytes(base, BUILDER) if remote_required else BUILDER.read_bytes()
    test_raw = git_bytes(base, TEST) if remote_required else TEST.read_bytes()
    bindings = {
        "buildBaseCommit": base,
        "remoteUrl": AUTHORIZED_REMOTE_URL,
        "remoteRef": AUTHORIZED_REF,
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "builderRawSha256": sha(builder_raw),
        "testRawSha256": sha(test_raw),
        "v2BuilderRawSha256": EXPECTED_V2_BUILDER_RAW,
    }
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
        for path, claim in ((CONTRACT, bindings["contractRawSha256"]), (BUILDER, bindings["builderRawSha256"]), (TEST, bindings["testRawSha256"]), (V2_BUILDER, EXPECTED_V2_BUILDER_RAW)):
            raw = git_bytes(base, path)
            if sha(raw) != claim or raw != path.read_bytes():
                fail("implementation Git blob changed")
    return bindings


def build_report(contract: dict[str, Any], source: dict[str, Any], implementation: dict[str, Any]) -> dict[str, Any]:
    rows = BASE.build_rows(source, contract)
    value = {
        "schema": "early-detection-sec-same-sentence-effective-fixed-cash/v3",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "inputRawSha256": EXPECTED_INPUT_RAW,
        "inputReportSha256": EXPECTED_INPUT_REPORT,
        "semanticCeiling": contract["evidenceContract"]["semanticCeiling"],
        "supersededV2RawSha256": EXPECTED_V2_RAW,
        "implementationBindings": implementation,
        "population": {
            "inputExtractionRows": 656,
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
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "inputRawSha256", "inputReportSha256", "semanticCeiling", "supersededV2RawSha256", "implementationBindings", "population", "rows", "claimLocks", "outcomesAccessed", "reportSha256"}, "report")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value != build_report(contract, source, implementation):
        fail("report does not match exact source rebuild")
    if any(item is not False for item in value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("claim boundary changed")


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
    except (EvidenceError, BASE.EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
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
        "buildBaseMoved": lambda item: item["implementationBindings"].__setitem__("buildBaseCommit", "f" * 40),
    }.items():
        item = copy.deepcopy(report)
        mutate(item)
        item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
        kills[label] = rejected(lambda item=item: validate_report(item, contract, source, implementation))
    target = next(index for index, row in enumerate(source["rows"]) if row["accession"] == contract["evidenceContract"]["expectedAccessions"][0])
    base_text = source["rows"][target]["text"]
    selector_fixtures = {
        "spelledSecurityAlternativeSelector": base_text + " and one Parent common share",
        "securityBeforeCashSelector": "one Parent common share and " + base_text,
        "numericSecurityAlternativeSelector": base_text + " and 1 common share",
        "fractionalSecurityAlternativeSelector": base_text + " and 0.3683 of an Ordinary Share",
        "stockAfterCashSelector": base_text + " and Parent common stock",
        "stockBeforeCashSelector": "Parent common stock and $31 in cash; " + base_text,
        "conditionalEffectiveSelector": "If the merger became effective, " + base_text,
    }
    for label, text in selector_fixtures.items():
        item = copy.deepcopy(source)
        item["rows"][target]["text"] = text
        kills[label] = item["rows"][target] not in selected_source_rows(item)
    if set(kills.values()) != {True}:
        fail("mutation kill failed")
    return {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-self-test/v3", "status": "PASS", "kills": kills, "outcomesAccessed": False}


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
            result = {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-contract-verification/v3", "status": "PASS", "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract, source)
        elif args.command == "build":
            implementation = implementation_bindings(remote_required=True)
            report = build_report(contract, source, implementation)
            validate_report(report, contract, source, implementation)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-build/v3", "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "verifiedRows": 11, "outcomesAccessed": False}
        else:
            raw = OUTPUT.read_bytes()
            report = json.loads(raw)
            base = report.get("implementationBindings", {}).get("buildBaseCommit")
            implementation = implementation_bindings(base, remote_required=True)
            output_introduction(base)
            validate_report(report, contract, source, implementation)
            if git_bytes(git("rev-parse", "HEAD"), OUTPUT) != raw:
                fail("output Git blob changed")
            result = {"schema": "early-detection-sec-same-sentence-effective-fixed-cash-verification/v3", "status": "PASS", "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "verifiedRows": 11, "outcomesAccessed": False}
    except (EvidenceError, BASE.EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
