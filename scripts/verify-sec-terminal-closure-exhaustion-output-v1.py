#!/usr/bin/env python3
"""Verify the separately sealed 23-row SEC terminal-closure output."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
import types
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-closure-exhaustion-output-seal-contract-v1.json"
VERIFIER = Path(__file__).resolve()
TEST = ROOT / "tests" / "verify-sec-terminal-closure-exhaustion-output-v1.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-terminal-closure-exhaustion-v1.json"
SOURCE_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-closure-exhaustion-contract-v1.json"
SOURCE_BUILDER = ROOT / "scripts" / "build-sec-terminal-closure-exhaustion-v1.py"
SOURCE_TEST = ROOT / "tests" / "build-sec-terminal-closure-exhaustion-v1.test.js"
PRE_SEAL = "1adc2ecae56e56cc979ee3c7007ca6a04075600a"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
EXPECTED_CREATED_AT = "2026-08-13T07:49:00Z"
EXPECTED_PURPOSE = "Seal the exact 23-row terminal-closure output separately from its Tag-879 producer and require a full source-derived SEC corpus rebuild before accepting it."
EXPECTED_CONTRACT_RAW = "d306cb9000947b24c94807054fce86cdd66a8377d31e2c9f2cc8a7743d961e9f"
EXPECTED_CONTRACT_SELF = "a2d1dee502ec5d4c5a55a542b37bd5d87d6e1e35308ac3f07c33b64c63c7bd79"
EXPECTED_VERIFIER_NORMALIZED = "645b53fb5c01251a3c07b99f54212658b2ff1cd6ae181a387746017e0c0113b8"
EXPECTED_TEST_NORMALIZED = "a35100fac7d75b86e75af7f9a676d89c5eea621d0023585f9c9d27fee794260d"


class SealError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise SealError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} keys changed")


def normalized(raw: bytes) -> bytes:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    for name in ("EXPECTED_CONTRACT_RAW", "EXPECTED_CONTRACT_SELF", "EXPECTED_VERIFIER_NORMALIZED", "EXPECTED_TEST_NORMALIZED"):
        text = re.sub(rf'(?m)^(?:const )?{name}\s*=\s*["\'][0-9A-Za-z_<>]+["\'];?$', f'{name} = "<SELF>"', text)
    return text.encode("utf-8")


def contract_self(value: dict[str, Any]) -> str:
    clone = copy.deepcopy(value)
    clone["contractSha256"] = None
    return sha(canonical(clone))


def git(*args: str, binary: bool = False, check: bool = True) -> Any:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, check=check, text=not binary)
    return result.stdout if binary else result.stdout.strip()


def git_raw(commit: str, path: Path) -> bytes:
    return git("show", f"{commit}:{path.relative_to(ROOT).as_posix()}", binary=True)


def exists(commit: str, path: Path) -> bool:
    return subprocess.run(["git", "cat-file", "-e", f"{commit}:{path.relative_to(ROOT).as_posix()}"], cwd=ROOT, capture_output=True).returncode == 0


def validate_contract(value: dict[str, Any], raw: bytes | None = None, own_bytes: bool = True) -> None:
    exact_keys(value, {"schema", "createdAt", "purpose", "taskId", "track", "source", "output", "topology", "authorizedImplementation", "expectedScanSummary", "claimLocks", "contractSha256"}, "contract")
    if value["schema"] != "early-detection-sec-terminal-closure-exhaustion-output-seal-contract/v1" or value["createdAt"] != EXPECTED_CREATED_AT or value["purpose"] != EXPECTED_PURPOSE:
        fail("contract identity changed")
    if datetime.fromisoformat(value["createdAt"].replace("Z", "+00:00")) > datetime.now(timezone.utc):
        fail("contract time is future")
    if value["taskId"] != "Q003-SEC-TERMINAL-CLOSURE-EXHAUSTION-OUTPUT-SEAL" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("task or track changed")
    expected_source = {"buildIntroductionCommit": PRE_SEAL, "contractPath": SOURCE_CONTRACT.relative_to(ROOT).as_posix(), "contractRawSha256": "533ba2bd165e6e10898be900da4da437bf6fd361c9b3335d2028e57660d9ab8c", "contractSelfSha256": "c797c86818e7a8e5e6f47000da1e5a2ae50404268030db6d39f6c2a671aab76b", "builderPath": SOURCE_BUILDER.relative_to(ROOT).as_posix(), "builderRawSha256": "2acd2560e60cec6e7cd4ed37d473658ae78f480b0eecf7b4fb2ad5a3f75398df", "testPath": SOURCE_TEST.relative_to(ROOT).as_posix(), "testRawSha256": "b8fa48084d01fbcd08bf2023c774adaceb68476eae215f71ac758a3a1b6b4dce"}
    if value["source"] != expected_source:
        fail("source binding changed")
    expected_output = {"path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": "68d1002e6aa0836a39fc29d982bd1a91001ab626976f0472a74c69bf133d12ed", "reportSha256": "9d0f7377952821796c5c709dc9baf9bd62aab74058277c7a98780b14f23daf7a", "bytes": 30771, "rows": 23, "sourceDerivedFullRebuildRequired": True}
    if value["output"] != expected_output:
        fail("output binding changed")
    expected_topology = {"preSealParent": PRE_SEAL, "sealIntroductionAddsExactlyThreeAuthorizedPaths": True, "outputIntroductionDirectChildOfSeal": True, "outputIntroductionAddsOnlyOutput": True, "futureHistoryLinearSingleParent": True, "remote": REMOTE_URL, "ref": REMOTE_REF}
    if value["topology"] != expected_topology:
        fail("topology contract changed")
    expected_impl = {"contractPath": CONTRACT.relative_to(ROOT).as_posix(), "verifierPath": VERIFIER.relative_to(ROOT).as_posix(), "testPath": TEST.relative_to(ROOT).as_posix(), "verifierNormalizedSha256": EXPECTED_VERIFIER_NORMALIZED, "testNormalizedSha256": EXPECTED_TEST_NORMALIZED}
    if value["authorizedImplementation"] != expected_impl:
        fail("implementation binding changed")
    expected_summary = {"blobCount": 27438, "blobBytes": 326221948, "documentsScanned": 40818, "sentencesScanned": 1022061, "parseErrors": 0, "broadTradingEndMatches": 840, "broadFinalOrNoFurtherMatches": 5, "broadRecoveryMatches": 95, "qualifiedLastTradingRows": 23, "qualifiedNoFurtherDistributionRows": 0, "qualifiedActualPostClosingRecoveryRowsFilterA": 0, "qualifiedActualPostClosingRecoveryRowsFilterB": 0, "existingFinalDistributionRows": 3}
    if value["expectedScanSummary"] != expected_summary:
        fail("scan summary changed")
    expected_locks = {"lastNamedExchangeTradingDayVerified": True, "lastConsolidatedSessionVerified": False, "laterOtcTradingExcluded": False, "finalLiquidatingDistributionVerified": False, "noFurtherDistributionsVerified": False, "postClosingRecoveryVerified": False, "noLaterRecoveryVerified": False, "terminalWealthComplete": False, "historicalIdentityResolved": False, "originalV4GateCredit": False, "resultComputationAllowed": False, "pricesAccessed": False, "returnsAccessed": False, "outcomesAccessed": False}
    if value["claimLocks"] != expected_locks:
        fail("claim locks changed")
    if value["contractSha256"] != contract_self(value) or value["contractSha256"] != EXPECTED_CONTRACT_SELF:
        fail("contract self hash changed")
    if own_bytes:
        if raw is None or sha(raw) != EXPECTED_CONTRACT_RAW:
            fail("contract raw bytes changed")
        if sha(normalized(VERIFIER.read_bytes())) != EXPECTED_VERIFIER_NORMALIZED or sha(normalized(TEST.read_bytes())) != EXPECTED_TEST_NORMALIZED:
            fail("seal implementation bytes changed")


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    value = json.loads(raw)
    validate_contract(value, raw)
    return value


def verify_source(contract: dict[str, Any]) -> None:
    for path, key in ((SOURCE_CONTRACT, "contractRawSha256"), (SOURCE_BUILDER, "builderRawSha256"), (SOURCE_TEST, "testRawSha256")):
        raw = path.read_bytes()
        if sha(raw) != contract["source"][key] or git_raw(PRE_SEAL, path) != raw:
            fail("source implementation bytes changed")
    source_contract = json.loads(SOURCE_CONTRACT.read_bytes())
    if source_contract.get("contractSha256") != contract["source"]["contractSelfSha256"]:
        fail("source contract self hash changed")


def import_source_builder(contract: dict[str, Any]) -> types.ModuleType:
    raw = SOURCE_BUILDER.read_bytes()
    if sha(raw) != contract["source"]["builderRawSha256"]:
        fail("source builder changed before import")
    module = types.ModuleType("terminal_closure_source_builder")
    module.__file__ = str(SOURCE_BUILDER)
    exec(compile(raw, str(SOURCE_BUILDER), "exec"), module.__dict__)
    return module


def verify_output(contract: dict[str, Any]) -> dict[str, Any]:
    if not OUTPUT.is_file():
        fail("output missing")
    raw = OUTPUT.read_bytes()
    if len(raw) != contract["output"]["bytes"] or sha(raw) != contract["output"]["rawSha256"]:
        fail("output raw bytes changed")
    actual = json.loads(raw)
    if actual.get("reportSha256") != contract["output"]["reportSha256"] or len(actual.get("rows", [])) != contract["output"]["rows"]:
        fail("output self hash or row count changed")
    if actual.get("scanSummary") != contract["expectedScanSummary"] or actual.get("claimLocks") != contract["claimLocks"]:
        fail("output summary or locks changed")
    source = import_source_builder(contract)
    source_contract = source.load_contract()
    inventory = source.load_json(source.INVENTORY, source_contract["inputs"]["inventory"])
    existing = source.load_json(source.EXISTING, source_contract["inputs"]["existingTerminalEvidence"])
    rebuilt = source.build_report(source_contract, inventory, existing, {"introductionCommit": PRE_SEAL})
    source.validate_report(actual, rebuilt)
    return actual


def introduction(path: Path) -> str | None:
    commits = git("log", "--diff-filter=A", "--format=%H", "--", path.relative_to(ROOT).as_posix()).splitlines()
    return commits[-1] if commits else None


def changed(commit: str) -> list[list[str]]:
    return sorted([line.split("\t", 1) for line in git("diff-tree", "--no-commit-id", "--name-status", "-r", commit).splitlines()])


def topology(remote_required: bool) -> dict[str, Any]:
    head = git("rev-parse", "HEAD")
    if git("config", "--get", "remote.origin.url") != REMOTE_URL or git("rev-parse", "@{u}") != head:
        fail("local Git binding changed")
    remote = git("ls-remote", "origin", REMOTE_REF).split()[0] if remote_required else None
    if remote_required and remote != head:
        fail("live remote changed")
    seal_paths = [CONTRACT, VERIFIER, TEST]
    seal_commits = {introduction(path) for path in seal_paths}
    seal = next(iter(seal_commits)) if len(seal_commits) == 1 else None
    output_intro = introduction(OUTPUT)
    if seal is None:
        if head != PRE_SEAL or output_intro is not None:
            fail("invalid pre-seal state")
        phase = "PRE_SEAL"
    else:
        if git("rev-parse", f"{seal}^") != PRE_SEAL or changed(seal) != [["A", path.relative_to(ROOT).as_posix()] for path in sorted(seal_paths, key=lambda p: p.relative_to(ROOT).as_posix())]:
            fail("seal introduction topology changed")
        for path in seal_paths:
            if git_raw(seal, path) != path.read_bytes() or git_raw(head, path) != path.read_bytes():
                fail("seal bytes changed")
        if output_intro is None:
            if head != seal:
                fail("output absent after unrelated follow-up")
            phase = "SEALED_NO_OUTPUT"
        else:
            if git("rev-parse", f"{output_intro}^") != seal or changed(output_intro) != [["A", OUTPUT.relative_to(ROOT).as_posix()]]:
                fail("output introduction topology changed")
            chain = git("rev-list", "--first-parent", f"{output_intro}..{head}").splitlines()
            for commit in chain:
                if len(git("rev-list", "--parents", "-n", "1", commit).split()) != 2:
                    fail("future history is not linear single-parent")
            if git_raw(output_intro, OUTPUT) != OUTPUT.read_bytes() or git_raw(head, OUTPUT) != OUTPUT.read_bytes():
                fail("committed output bytes changed")
            phase = "OUTPUT_INTRODUCED"
    return {"phase": phase, "head": head, "sealIntroductionCommit": seal, "outputIntroductionCommit": output_intro, "remoteVerified": bool(remote_required)}


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except Exception:
        return True
    return False


def self_test(contract: dict[str, Any]) -> dict[str, Any]:
    attacks = {}
    for name, mutate in {
        "purpose": lambda x: x.__setitem__("purpose", "terminal complete"),
        "output": lambda x: x["output"].__setitem__("rows", 22),
        "source": lambda x: x["source"].__setitem__("builderPath", "other.py"),
        "summary": lambda x: x["expectedScanSummary"].__setitem__("qualifiedActualPostClosingRecoveryRowsFilterA", 1),
        "credit": lambda x: x["claimLocks"].__setitem__("originalV4GateCredit", True),
        "outcome": lambda x: x["claimLocks"].__setitem__("outcomesAccessed", True),
        "topology": lambda x: x["topology"].__setitem__("outputIntroductionDirectChildOfSeal", False),
        "path": lambda x: x["authorizedImplementation"].__setitem__("verifierPath", "other.py"),
    }.items():
        altered = copy.deepcopy(contract)
        mutate(altered)
        altered["contractSha256"] = contract_self(altered)
        attacks[name] = rejected(lambda altered=altered: validate_contract(altered, own_bytes=False))
    if not all(attacks.values()):
        fail("contract mutation survived")
    return {"status": "PASS", "contractMutationsKilled": attacks, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    if not args.remote:
        fail("live remote verification required")
    contract = load_contract()
    verify_source(contract)
    state = topology(True)
    if args.command == "self-test":
        print(json.dumps({**self_test(contract), **state}, sort_keys=True))
        return 0
    actual = verify_output(contract)
    print(json.dumps({"status": "PASS", **state, "sourceDerivedFullRebuild": True, "rows": len(actual["rows"]), "rawSha256": sha(OUTPUT.read_bytes()), "reportSha256": actual["reportSha256"], "outcomesAccessed": False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (SealError, subprocess.CalledProcessError, json.JSONDecodeError, OSError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}))
        raise SystemExit(2)
