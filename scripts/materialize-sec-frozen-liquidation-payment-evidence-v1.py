#!/usr/bin/env python3
"""Materialize and verify the exact Tag868 seventeen-row SEC evidence report."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research/early-detection-v4/sec-frozen-liquidation-payment-output-contract-v1.json"
CONTROLLER = Path(__file__).resolve()
TEST = ROOT / "tests/materialize-sec-frozen-liquidation-payment-evidence-v1.test.js"
OUTPUT = ROOT / "reports/early-detection/sec-frozen-liquidation-payment-evidence-v1.json"
SOURCE_CONTRACT = ROOT / "research/early-detection-v4/sec-frozen-liquidation-payment-evidence-contract-v1.json"
SOURCE_BUILDER = ROOT / "scripts/build-sec-frozen-liquidation-payment-evidence-v1.py"
SOURCE_TEST = ROOT / "tests/build-sec-frozen-liquidation-payment-evidence-v1.test.js"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BASE_COMMIT = "b7bda025a01924bab82c252ea33a399ad0cdf966"
SOURCE_INTRODUCTION = "394b3b6bd43a20306286cf766fa6f3aaf69cc6ca"
EXPECTED_CONTRACT_RAW = "522606ba3da01872523220b2865110fd8684999dc38c1491eb5f0281fd92dc4e"
EXPECTED_CONTROLLER_NORMALIZED = "42817685eaae9883ae8f82eb16ad8f6bed379de437ba47277850b20143c60334"
EXPECTED_TEST_NORMALIZED = "1480f2ed40d8241465edcf5a1463546be5dd3c46f7b20a3dcca72777632467a7"
OWN_PATHS = [
    "research/early-detection-v4/sec-frozen-liquidation-payment-output-contract-v1.json",
    "scripts/materialize-sec-frozen-liquidation-payment-evidence-v1.py",
    "tests/materialize-sec-frozen-liquidation-payment-evidence-v1.test.js",
]
SOURCE_PATHS = [SOURCE_CONTRACT, SOURCE_BUILDER, SOURCE_TEST]
SOURCE_RAWS = [
    "a282583efe18ae14dfcc2b17db0822c92be75fade962aa53b53d28b05e99ff10",
    "d47786e533d1350562e93e301d1b81266e619a4272aaf6f0d7364be5e4abb57e",
    "eba763b5f980e8b8224c9720193b6230897a73d93ae3ddca0a0e55263bc5416d",
]
SOURCE_BLOBS = [
    "6a6d0685bd732b68ca2a1e1e87b3ea0d6e6244b2",
    "6a5278f6bf1f3bb6c73eacc4a9b0b1ec4fca1566",
    "b7385aa291661ff4b1a6e2de013b2505736f5772",
]
EXPECTED_LOCKS = {
    "cashReceiptVerified": False, "finalDistributionVerified": False,
    "firstDistributionVerified": False, "laterRecoveriesVerified": False,
    "noFurtherClaimsVerified": False, "currencyResolved": False,
    "historicalIdentityResolved": False, "terminalWealthComplete": False,
    "originalV4GateCredit": False, "resultComputationAllowed": False,
    "pricesAccessed": False, "returnsAccessed": False, "outcomesAccessed": False,
}


class OutputError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise OutputError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def exact_keys(value: object, expected: set[str], label: str) -> None:
    if type(value) is not dict or set(value) != expected:
        fail(f"{label} exact keys changed")


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        fail("Git binding failed")
    return result.stdout.strip()


def git_exists(commit: str, path: str) -> bool:
    return subprocess.run(["git", "cat-file", "-e", f"{commit}:{path}"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def git_raw(commit: str, path: str) -> bytes:
    return subprocess.check_output(["git", "show", f"{commit}:{path}"], cwd=ROOT)


def normalized_python(raw: bytes) -> str:
    text = raw.decode()
    for name in ("EXPECTED_CONTRACT_RAW", "EXPECTED_CONTROLLER_NORMALIZED", "EXPECTED_TEST_NORMALIZED"):
        text = re.sub(rf'({name}\s*=\s*")[^"]+("\s*)', rf'\g<1>{name}_NORMALIZED\g<2>', text)
    return sha(text.encode())


def normalized_test(raw: bytes) -> str:
    text = raw.decode()
    for name in ("EXPECTED_CONTRACT_RAW", "EXPECTED_CONTROLLER_NORMALIZED", "EXPECTED_TEST_NORMALIZED"):
        text = re.sub(rf'(const {name}\s*=\s*\')[^\']+(\'\s*;)', rf'\g<1>{name}_NORMALIZED\g<2>', text)
    return sha(text.encode())


def load_contract() -> dict:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("output contract raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claimed = body.pop("contractSelfSha256", None)
    if claimed != sha(canonical(body)):
        fail("output contract self hash changed")
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "contractSelfSha256", "repository", "sourceBuilder", "output", "implementation", "claimLocks"}, "contract")
    if value["schema"] != "early-detection-sec-frozen-liquidation-payment-output-contract/v1" or value["createdAt"] != "2026-08-13T04:45:00Z" or value["taskId"] != "Q003-SEC-FROZEN-LIQUIDATION-PAYMENT-OUTPUT-V1" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("output contract identity changed")
    if value["purpose"] != "Materialize only the exact seventeen-row report defined by the byte-bound Tag868 source builder, then require an output-only direct-child commit and an exact primary-source rebuild.":
        fail("output purpose changed")
    if value["repository"] != {
        "remote": REMOTE, "ref": REF, "buildBaseCommit": BASE_COMMIT, "buildBaseTag": 869,
        "implementationIntroductionMustBeDirectSingleParentChild": True,
        "implementationIntroductionAddsExactlyOwnThreePaths": True,
        "outputIntroductionMustBeDirectSingleParentChildOfImplementation": True,
        "outputIntroductionAddsOnlyOutput": True,
    }:
        fail("output repository contract changed")
    source = value["sourceBuilder"]
    expected_source = {
        "introductionCommit": SOURCE_INTRODUCTION,
        "contractPath": SOURCE_PATHS[0].relative_to(ROOT).as_posix(), "contractRawSha256": SOURCE_RAWS[0], "contractGitBlob": SOURCE_BLOBS[0],
        "builderPath": SOURCE_PATHS[1].relative_to(ROOT).as_posix(), "builderRawSha256": SOURCE_RAWS[1], "builderGitBlob": SOURCE_BLOBS[1],
        "testPath": SOURCE_PATHS[2].relative_to(ROOT).as_posix(), "testRawSha256": SOURCE_RAWS[2], "testGitBlob": SOURCE_BLOBS[2],
    }
    if source != expected_source:
        fail("source builder binding changed")
    if value["output"] != {
        "path": OUTPUT.relative_to(ROOT).as_posix(), "schema": "early-detection-sec-frozen-liquidation-payment-evidence/v1",
        "expectedRows": 17, "expectedRecipientExplicitRows": 4, "expectedDeduplicationRows": 11,
        "expectedAllIntersectionCounts": 0, "currencyCodeMustRemainNull": True, "outcomesAccessedMustRemainFalse": True,
    }:
        fail("output schema contract changed")
    implementation = value["implementation"]
    if implementation != {
        "contractPath": OWN_PATHS[0], "controllerPath": OWN_PATHS[1], "testPath": OWN_PATHS[2],
        "controllerNormalizedSha256": EXPECTED_CONTROLLER_NORMALIZED,
        "testNormalizedSha256": EXPECTED_TEST_NORMALIZED, "selfBindingsNormalizedBeforeHash": True,
    }:
        fail("output implementation contract changed")
    if normalized_python(CONTROLLER.read_bytes()) != EXPECTED_CONTROLLER_NORMALIZED or normalized_test(TEST.read_bytes()) != EXPECTED_TEST_NORMALIZED:
        fail("output implementation bytes changed")
    if value["claimLocks"] != EXPECTED_LOCKS:
        fail("output claim locks changed")
    return value


def source_namespace(head: str) -> dict:
    for path, raw_sha, blob in zip(SOURCE_PATHS, SOURCE_RAWS, SOURCE_BLOBS):
        relative = path.relative_to(ROOT).as_posix()
        raw = path.read_bytes()
        if sha(raw) != raw_sha or git("rev-parse", f"{SOURCE_INTRODUCTION}:{relative}") != blob or git_raw(head, relative) != raw:
            fail("source implementation bytes changed")
        if git("log", "-1", "--format=%H", "--", relative) != SOURCE_INTRODUCTION:
            fail("source implementation history changed")
    raw = SOURCE_BUILDER.read_bytes()
    namespace = {"__name__": "source_builder_bound", "__file__": str(SOURCE_BUILDER)}
    exec(compile(raw, str(SOURCE_BUILDER), "exec"), namespace)
    return namespace


def remote_head() -> str:
    if git("remote", "get-url", "origin") != REMOTE:
        fail("origin changed")
    head = git("rev-parse", "HEAD")
    rows = git("ls-remote", "--refs", "origin", REF).splitlines()
    if len(rows) != 1 or not head == git("rev-parse", "@{u}") == rows[0].split()[0]:
        fail("HEAD/upstream/live remote drift")
    if BASE_COMMIT not in git("rev-list", "--first-parent", head).splitlines():
        fail("Tag869 is not on first-parent chain")
    return head


def implementation_phase(head: str) -> tuple[str, str | None]:
    present = [path for path in OWN_PATHS if git_exists(head, path)]
    if not present:
        return "PRE_IMPLEMENTATION", None
    if present != OWN_PATHS:
        fail("partial output-controller introduction")
    introductions = {git("log", "--diff-filter=A", "-1", "--format=%H", "--", path) for path in OWN_PATHS}
    if len(introductions) != 1:
        fail("output-controller paths were not introduced together")
    introduction = introductions.pop()
    if git("show", "-s", "--format=%P", introduction).split() != [BASE_COMMIT]:
        fail("output-controller introduction is not direct child of Tag869")
    if git("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines() != [f"A\t{path}" for path in OWN_PATHS]:
        fail("output-controller introduction is not exactly three additions")
    for path in OWN_PATHS:
        if git("log", "-1", "--format=%H", "--", path) != introduction or git_raw(head, path) != (ROOT / path).read_bytes():
            fail("output-controller bytes drifted")
    return "IMPLEMENTED", introduction


def source_report(source: dict, head: str, state: dict | None = None) -> dict:
    contract = source["load_contract"]()
    frozen, noncash = source["load_inputs"](contract, head)
    if state is None:
        state = source["topology"](remote_required=True)
    report = source["build_report"](contract, frozen, noncash, state)
    source["validate_report"](report, source["build_report"](contract, frozen, noncash, state))
    return report


def validate_semantics(report: dict) -> None:
    if report.get("outcomesAccessed") is not False or len(report.get("rows", [])) != 17:
        fail("output population or outcome boundary changed")
    if sum(row.get("recipientExplicit") is True for row in report["rows"]) != 4 or any(row.get("currencyCode") is not None for row in report["rows"]):
        fail("output recipient or currency boundary changed")
    if report.get("deduplication", {}).get("existingRows") != 11 or set(report["deduplication"]["intersectionCountByDimension"].values()) != {0}:
        fail("output deduplication boundary changed")
    if any(value is not False for value in report.get("claimLocks", {}).values()):
        fail("output source claim lock changed")


def write_new(raw: bytes) -> None:
    if OUTPUT.exists():
        fail("output already exists")
    descriptor, name = tempfile.mkstemp(prefix=f".{OUTPUT.name}.", suffix=".tmp", dir=OUTPUT.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, OUTPUT)
    finally:
        temporary.unlink(missing_ok=True)


def output_intro(base: str, head: str) -> str:
    path = OUTPUT.relative_to(ROOT).as_posix()
    introductions = git("log", "--diff-filter=A", "--format=%H", "--", path).splitlines()
    if len(introductions) != 1:
        fail("output introduction cardinality changed")
    introduction = introductions[0]
    if git("show", "-s", "--format=%P", introduction).split() != [base] or git("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines() != [f"A\t{path}"]:
        fail("output introduction is not output-only direct child")
    if git("log", "-1", "--format=%H", "--", path) != introduction or git_raw(head, path) != OUTPUT.read_bytes():
        fail("output Git/worktree bytes drifted")
    return introduction


def self_test() -> dict:
    contract = load_contract()
    mutations = {
        "purposeCredit": lambda x: x.__setitem__("purpose", "Terminal wealth complete"),
        "baseForward": lambda x: x["repository"].__setitem__("buildBaseCommit", SOURCE_INTRODUCTION),
        "outputSidepath": lambda x: x["output"].__setitem__("path", "reports/other.json"),
        "currencyClaim": lambda x: x["output"].__setitem__("currencyCodeMustRemainNull", False),
        "outcomeClaim": lambda x: x["claimLocks"].__setitem__("outcomesAccessed", True),
        "unknownCredit": lambda x: x["claimLocks"].__setitem__("unknownCredit", True),
        "builderDrift": lambda x: x["sourceBuilder"].__setitem__("builderRawSha256", "0" * 64),
        "allowNonDirectOutput": lambda x: x["repository"].__setitem__("outputIntroductionMustBeDirectSingleParentChildOfImplementation", False),
    }
    kills = {}
    for name, mutate in mutations.items():
        changed = copy.deepcopy(contract)
        mutate(changed)
        body = dict(changed); body.pop("contractSelfSha256", None)
        changed["contractSelfSha256"] = sha(canonical(body))
        try:
            if changed["purpose"] != contract["purpose"] or changed["repository"] != contract["repository"] or changed["sourceBuilder"] != contract["sourceBuilder"] or changed["output"] != contract["output"] or changed["claimLocks"] != EXPECTED_LOCKS:
                fail("contract mutation")
        except OutputError:
            kills[name] = True
        else:
            kills[name] = False
    if not all(kills.values()):
        fail("self-test mutation survived")
    return {"schema": "early-detection-sec-frozen-liquidation-payment-output-self-test/v1", "status": "PASS", "killCount": len(kills), "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "build", "verify-generated", "verify-output"))
    args = parser.parse_args()
    try:
        contract = load_contract()
        if args.command == "self-test":
            result = self_test()
        else:
            head = remote_head()
            phase, introduction = implementation_phase(head)
            source = source_namespace(head)
            if args.command == "verify-contract":
                report = source_report(source, head, None if phase == "IMPLEMENTED" else source["topology"](remote_required=True))
                validate_semantics(report)
                result = {"schema": "early-detection-sec-frozen-liquidation-payment-output-contract-verification/v1", "status": "PASS", "phase": phase, "implementationIntroductionCommit": introduction, "verifiedRows": 17, "outcomesAccessed": False}
            elif args.command == "build":
                if phase != "IMPLEMENTED" or head != introduction:
                    fail("build requires exact remote implementation introduction HEAD")
                report = source_report(source, head)
                validate_semantics(report)
                raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode() + b"\n"
                write_new(raw)
                result = {"schema": "early-detection-sec-frozen-liquidation-payment-output-build/v1", "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "verifiedRows": 17, "outcomesAccessed": False}
            else:
                raw = OUTPUT.read_bytes()
                report = json.loads(raw)
                base = report.get("implementationBindings", {}).get("currentCommit")
                if base != introduction:
                    fail("output build base differs from controller introduction")
                state_keys = {key: report["implementationBindings"][key] for key in ("baseSealCommit", "currentCommit", "implementationIntroductionCommit", "implementationIntroductionParent", "linearIntermediateCommitsAllowed", "phase")}
                expected = source_report(source, head, state_keys)
                if report != expected or raw != json.dumps(expected, ensure_ascii=False, sort_keys=True, indent=2).encode() + b"\n":
                    fail("output differs from exact source rebuild")
                validate_semantics(report)
                if args.command == "verify-generated":
                    if head != introduction or git_exists(head, OUTPUT.relative_to(ROOT).as_posix()):
                        fail("generated verification requires uncommitted output at implementation HEAD")
                    output_commit = None
                else:
                    output_commit = output_intro(base, head)
                result = {"schema": "early-detection-sec-frozen-liquidation-payment-output-verification/v1", "status": "PASS", "mode": args.command, "outputIntroductionCommit": output_commit, "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "verifiedRows": 17, "outcomesAccessed": False}
    except (OutputError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
