#!/usr/bin/env python3
"""Append-only V2 rebuild for exactly five frozen SEC terminal-evidence rows."""

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
from collections import Counter
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-frozen-terminal-distribution-receipt-evidence-contract-v2.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-frozen-terminal-distribution-receipt-evidence-v2.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-frozen-terminal-distribution-receipt-evidence-v2.json"
V1_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-frozen-terminal-distribution-receipt-evidence-contract-v1.json"
V1_BUILDER = ROOT / "scripts" / "build-sec-frozen-terminal-distribution-receipt-evidence-v1.py"
V1_TEST = ROOT / "tests" / "build-sec-frozen-terminal-distribution-receipt-evidence-v1.test.js"
RECONCILIATION = ROOT / "reports" / "early-detection" / "sec-terminal-candidate-reconciliation-v1.json"
RECONCILIATION_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-candidate-reconciliation-contract-v1.json"
RECONCILIATION_BUILDER = ROOT / "scripts" / "build-sec-terminal-candidate-reconciliation-v1.py"
RECONCILIATION_TEST = ROOT / "tests" / "build-sec-terminal-candidate-reconciliation-v1.test.js"
QUEUE = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-queue-v5.json"
QUEUE_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-wealth-queue-contract-v5.json"
QUEUE_BUILDER = ROOT / "scripts" / "build-sec-terminal-wealth-queue-v5.py"
QUEUE_TEST = ROOT / "tests" / "build-sec-terminal-wealth-queue-v5.test.js"
INVENTORY = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-original-inventory-v4.json"
INVENTORY_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-wealth-original-inventory-contract-v4.json"
INVENTORY_BUILDER = ROOT / "scripts" / "build-sec-terminal-wealth-original-inventory-v4.py"
INVENTORY_TEST = ROOT / "tests" / "build-sec-terminal-wealth-original-inventory-v4.test.js"
SOURCE_BUILDER = ROOT / "scripts" / "build-sec-same-sentence-effective-fixed-cash-v2.py"

CONTRACT_RAW = "2e0027632ccc934a1a6ce997dd8fea4355a89aba71b971d856916ce86f25747c"
CONTRACT_SELF = "90b5a9ee9914bfb4c7badf88336267af13a532422666e022023e5136d33fb15e"
PRE_PARENT = "3dafd784e3fcfe6da053c710d0b5a5d4b002939b"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
EXPECTED_SCOPE = "EXACT_FIVE_FROZEN_PRIMARY_SEC_SENTENCES_ONLY_NO_GENERAL_SELECTOR"
EXPECTED_CEILING = "THREE_DATED_FINAL_DISTRIBUTION_STATEMENTS_ONE_EFFECTED_FIRST_LIQUIDATING_DISTRIBUTION_BY_CHECKS_STATEMENT_AND_ONE_ACTUAL_DEFAULT_MIXED_CONSIDERATION_RECEIPT_STATEMENT"
EXPECTED_KINDS = {
    "ACTUAL_DEFAULT_MIXED_CONSIDERATION_RECEIVED_STATED": 1,
    "ACTUAL_FIRST_LIQUIDATING_DISTRIBUTION_BY_CHECKS_STATED": 1,
    "DATED_FINAL_DISTRIBUTION_TO_HOLDERS_STATED": 3,
}
OWN_PATHS = (CONTRACT, BUILDER, TEST)


class EvidenceError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise EvidenceError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def git(*args: str) -> str:
    run = subprocess.run(["git", *args], cwd=ROOT, check=False, capture_output=True, text=True, encoding="utf-8")
    if run.returncode:
        fail("Git binding failed")
    return run.stdout.strip()


def git_raw(commit: str, path: Path) -> bytes:
    run = subprocess.run(
        ["git", "show", f"{commit}:{path.relative_to(ROOT).as_posix()}"],
        cwd=ROOT, check=False, capture_output=True,
    )
    if run.returncode:
        fail(f"Git blob missing: {path.name}")
    return run.stdout


def cat_file_exists(commit: str, path: Path) -> bool:
    return subprocess.run(
        ["git", "cat-file", "-e", f"{commit}:{path.relative_to(ROOT).as_posix()}"],
        cwd=ROOT, check=False, capture_output=True,
    ).returncode == 0


def import_v1() -> types.ModuleType:
    raw = V1_BUILDER.read_bytes()
    if sha(raw) != "ebf99fb25e3f3972e23b8d59c3676f8d44cf00cdbad61719372f458fa80e9176":
        fail("V1 builder local bytes changed")
    module = types.ModuleType("bound_frozen_terminal_v1")
    module.__file__ = str(V1_BUILDER)
    exec(compile(raw, str(V1_BUILDER), "exec"), module.__dict__)
    return module


V1 = import_v1()


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("V2 contract raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claimed = body.pop("contractSha256", None)
    if claimed != CONTRACT_SELF or sha(canonical(body)) != CONTRACT_SELF:
        fail("V2 contract self hash changed")
    exact_keys(value, {
        "claimLocks", "contractSha256", "createdAt", "frozenCaseBindings",
        "implementationContract", "immutableV1Base", "inputs", "policy",
        "purpose", "schema", "taskId", "track",
    }, "V2 contract")
    if value["schema"] != "early-detection-sec-frozen-terminal-distribution-receipt-evidence-contract/v2":
        fail("V2 schema changed")
    if value["taskId"] != "Q003-SEC-FROZEN-TERMINAL-DISTRIBUTION-RECEIPT-EVIDENCE-V2" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("V2 study boundary changed")
    implementation = value["implementationContract"]
    if implementation != {
        "builderPath": BUILDER.relative_to(ROOT).as_posix(),
        "implementationCommitAddsExactlyOwnThreePaths": True,
        "implementationCommitDirectChildOfPreImplementationParent": True,
        "outputAbsentAtPreImplementationParentAndImplementationBase": True,
        "outputIntroductionDirectChildOfImplementationBase": True,
        "outputPath": OUTPUT.relative_to(ROOT).as_posix(),
        "preImplementationCommands": ["verify-contract", "self-test", "dry-run"],
        "preImplementationParentCommit": PRE_PARENT,
        "preImplementationParentTag": 848,
        "remoteRef": REMOTE_REF,
        "remoteUrl": REMOTE_URL,
        "testPath": TEST.relative_to(ROOT).as_posix(),
    }:
        fail("V2 implementation contract changed")
    policy = value["policy"]
    if policy["expectedRows"] != 5 or policy["expectedEvidenceKindCounts"] != EXPECTED_KINDS:
        fail("V2 frozen population changed")
    if policy["scopeLimit"] != EXPECTED_SCOPE or policy["semanticCeiling"] != EXPECTED_CEILING:
        fail("V2 semantic scope changed")
    if policy["exactFrozenSentenceSetRequired"] is not True or policy["futureRowsRequireNewProtocol"] is not True:
        fail("V2 frozen population policy weakened")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("V2 claim lock changed")
    return value


def bind_git_artifact(base: str, path: Path, raw_hash: str, blob: str, normalize_crlf: bool = False) -> None:
    committed = git_raw(base, path)
    if sha(committed) != raw_hash or git("rev-parse", f"{base}:{path.relative_to(ROOT).as_posix()}") != blob:
        fail(f"Git binding changed: {path.name}")
    local = path.read_bytes()
    if normalize_crlf:
        if b"\r" in local.replace(b"\r\n", b"") or local.replace(b"\r\n", b"\n") != committed:
            fail(f"CRLF-normalized worktree binding changed: {path.name}")
    elif local != committed:
        fail(f"worktree differs from Git bytes: {path.name}")


def validate_v1(contract: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    base = contract["immutableV1Base"]
    if git("rev-list", "--parents", "-n", "1", base["introductionCommit"]).split() != [base["introductionCommit"], base["introductionParent"]]:
        fail("V1 introduction topology changed")
    changes = git("diff-tree", "--no-commit-id", "--name-status", "-r", base["introductionCommit"]).splitlines()
    expected_paths = {path.relative_to(ROOT).as_posix() for path in (V1_CONTRACT, V1_BUILDER, V1_TEST)}
    if len(changes) != 3 or any(not row.startswith("A\t") for row in changes) or {row.split("\t", 1)[1] for row in changes} != expected_paths:
        fail("V1 introduction did not add exactly its own three paths")
    for section, path in (("contract", V1_CONTRACT), ("builder", V1_BUILDER), ("test", V1_TEST)):
        binding = base[section]
        bind_git_artifact(PRE_PARENT, path, binding["gitRawSha256"], binding["gitBlob"])
        if git("log", "--diff-filter=A", "-1", "--format=%H", "--", path.relative_to(ROOT).as_posix()) != base["introductionCommit"]:
            fail("V1 introduction path binding changed")
    raw = V1_CONTRACT.read_bytes()
    value = json.loads(raw)
    V1.validate_contract_value(value)
    if sha(canonical(value)) != base["contract"]["canonicalSha256"]:
        fail("V1 contract canonical binding changed")
    if sha(canonical(value["evidenceContract"])) != base["contract"]["evidenceContractCanonicalSha256"]:
        fail("V1 evidence contract changed")
    if value["claimLocks"] != contract["claimLocks"]:
        fail("V1 claim locks not inherited exactly")
    policy = contract["policy"]
    if any(value["evidenceContract"][key] != policy[key] for key in ("expectedRows", "expectedEvidenceKindCounts", "scopeLimit", "semanticCeiling", "noGoClaims", "exactFrozenSentenceSetRequired", "futureRowsRequireNewProtocol")):
        fail("V1 semantic boundary not inherited exactly")
    rows = value["evidenceContract"]["frozenRows"]
    expected = contract["frozenCaseBindings"]
    if len(rows) != 5 or len(expected) != 5:
        fail("V1 frozen row count changed")
    for row, binding in zip(rows, expected):
        ref = row["sourceRef"]
        witness = row["reconciliationWitness"]
        actual = {
            "accession": row["accession"], "blobSha256": ref["blobSha256"],
            "evidenceKind": row["evidenceKind"], "evidenceSentenceSha256": ref["evidenceSentenceSha256"],
            "occurrenceId": witness["occurrenceId"], "sourceRowId": witness["sourceRowId"],
            "titleClassSentenceSha256": ref["titleClassSentenceSha256"],
            "v1FrozenRowCanonicalSha256": sha(canonical(row)),
        }
        if actual != binding:
            fail("V1 frozen case binding changed")
    reconciliation = V1.load_reconciliation()
    inventory = V1.load_inventory()
    return value, reconciliation, inventory


def validate_inputs(contract: dict[str, Any]) -> None:
    inputs = contract["inputs"]
    groups = [
        (inputs["candidateReconciliation"], (
            (RECONCILIATION, "rawSha256", "outputGitBlob", False),
            (RECONCILIATION_CONTRACT, "contractGitRawSha256", "contractGitBlob", False),
            (RECONCILIATION_BUILDER, "builderGitRawSha256", "builderGitBlob", False),
            (RECONCILIATION_TEST, "testGitRawSha256", "testGitBlob", False),
        )),
        (inputs["terminalWealthQueueV5"], (
            (QUEUE, "rawSha256", "outputGitBlob", False),
            (QUEUE_CONTRACT, "contractGitRawSha256", "contractGitBlob", False),
            (QUEUE_BUILDER, "builderGitRawSha256", "builderGitBlob", False),
            (QUEUE_TEST, "testGitRawSha256", "testGitBlob", False),
        )),
        (inputs["originalInventoryV4"], (
            (INVENTORY, "rawSha256", "outputGitBlob", False),
            (INVENTORY_CONTRACT, "contractGitRawSha256", "contractGitBlob", False),
            (INVENTORY_BUILDER, "builderGitRawSha256", "builderGitBlob", True),
            (INVENTORY_TEST, "testGitRawSha256", "testGitBlob", True),
        )),
        (inputs["sourceRebuildImplementation"], (
            (SOURCE_BUILDER, "gitRawSha256", "gitBlob", False),
        )),
    ]
    for binding, rows in groups:
        for path, raw_key, blob_key, normalize in rows:
            bind_git_artifact(PRE_PARENT, path, binding[raw_key], binding[blob_key], normalize)
    introductions = (
        (RECONCILIATION_CONTRACT, inputs["candidateReconciliation"]["implementationIntroductionCommit"]),
        (RECONCILIATION_BUILDER, inputs["candidateReconciliation"]["implementationIntroductionCommit"]),
        (RECONCILIATION_TEST, inputs["candidateReconciliation"]["implementationIntroductionCommit"]),
        (QUEUE_CONTRACT, inputs["terminalWealthQueueV5"]["implementationIntroductionCommit"]),
        (QUEUE_BUILDER, inputs["terminalWealthQueueV5"]["implementationIntroductionCommit"]),
        (QUEUE_TEST, inputs["terminalWealthQueueV5"]["implementationIntroductionCommit"]),
        (INVENTORY_CONTRACT, inputs["originalInventoryV4"]["implementationIntroductionCommit"]),
        (INVENTORY_BUILDER, inputs["originalInventoryV4"]["implementationIntroductionCommit"]),
        (INVENTORY_TEST, inputs["originalInventoryV4"]["implementationIntroductionCommit"]),
        (SOURCE_BUILDER, inputs["sourceRebuildImplementation"]["introductionCommit"]),
    )
    for path, introduction in introductions:
        if git("log", "--diff-filter=A", "-1", "--format=%H", "--", path.relative_to(ROOT).as_posix()) != introduction:
            fail(f"input implementation introduction changed: {path.name}")
        if subprocess.run(["git", "merge-base", "--is-ancestor", introduction, PRE_PARENT], cwd=ROOT, check=False, capture_output=True).returncode != 0:
            fail(f"input implementation is not an ancestor of Tag848: {path.name}")
    if git("log", "--diff-filter=A", "-1", "--format=%H", "--", QUEUE.relative_to(ROOT).as_posix()) != inputs["terminalWealthQueueV5"]["outputIntroductionCommit"]:
        fail("queue output introduction changed")
    if git("log", "--diff-filter=A", "-1", "--format=%H", "--", RECONCILIATION.relative_to(ROOT).as_posix()) != inputs["candidateReconciliation"]["outputIntroductionCommit"]:
        fail("reconciliation output introduction changed")
    if git("log", "--diff-filter=A", "-1", "--format=%H", "--", INVENTORY.relative_to(ROOT).as_posix()) != inputs["originalInventoryV4"]["outputIntroductionCommit"]:
        fail("inventory output introduction changed")
    queue_raw = QUEUE.read_bytes()
    queue = json.loads(queue_raw)
    body = dict(queue)
    claimed = body.pop("reportSha256", None)
    if claimed != inputs["terminalWealthQueueV5"]["reportSha256"] or sha(canonical(body)) != claimed:
        fail("queue self binding changed")
    if queue.get("schema") != "early-detection-sec-terminal-wealth-queue/v5" or len(queue.get("rows", [])) != 44352:
        fail("queue schema or row count changed")
    if queue.get("claimLocks") != {
        "identityResolved": False, "originalV4GateCredit": False, "outcomesAccessed": False,
        "resultComputationAllowed": False, "terminalWealthComplete": False,
    } or any(row.get("outcomesAccessed") is not False for row in queue["rows"]):
        fail("queue claim boundary changed")


def topology(contract: dict[str, Any], remote_required: bool = False) -> dict[str, Any]:
    head = git("rev-parse", "HEAD")
    if git("remote", "get-url", "origin") != REMOTE_URL:
        fail("origin URL changed")
    if remote_required:
        rows = git("ls-remote", "--refs", "origin", REMOTE_REF).splitlines()
        if len(rows) != 1 or rows[0].split()[0] != head or git("rev-parse", "@{upstream}") != head:
            fail("local, upstream and live remote differ")
    own_rel = {path.relative_to(ROOT).as_posix() for path in OWN_PATHS}
    contract_committed = cat_file_exists(head, CONTRACT)
    if not contract_committed:
        if head != PRE_PARENT:
            fail("pre-implementation verification requires exact Tag848")
        for path in (*OWN_PATHS, OUTPUT):
            if cat_file_exists(head, path):
                fail("V2 path existed at pre-implementation parent")
        return {"phase": "PRE_IMPLEMENTATION", "baseCommit": head}
    parents = git("rev-list", "--parents", "-n", "1", head).split()
    if parents != [head, PRE_PARENT]:
        fail("implementation base is not the direct single-parent child of Tag848")
    changes = git("diff-tree", "--no-commit-id", "--name-status", "-r", head).splitlines()
    if len(changes) != 3 or any(not row.startswith("A\t") for row in changes) or {row.split("\t", 1)[1] for row in changes} != own_rel:
        fail("implementation base must add exactly its own three paths")
    if cat_file_exists(head, OUTPUT):
        fail("future V2 output existed at implementation base")
    for path in OWN_PATHS:
        if git_raw(head, path) != path.read_bytes():
            fail("implementation Git bytes differ from worktree")
    return {"phase": "IMPLEMENTED_NO_OUTPUT", "baseCommit": head}


def implementation_bindings(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "baseCommit": state["baseCommit"], "phase": state["phase"],
        "remote": REMOTE_URL, "ref": REMOTE_REF,
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "builderRawSha256": sha(BUILDER.read_bytes()),
        "testRawSha256": sha(TEST.read_bytes()),
    }


def build_report(contract: dict[str, Any], v1_contract: dict[str, Any], reconciliation: dict[str, Any], inventory: dict[str, Any], implementation: dict[str, Any]) -> dict[str, Any]:
    rows = V1.build_rows(v1_contract, reconciliation, inventory)
    counts = Counter(row["evidenceKind"] for row in rows)
    value = {
        "schema": "early-detection-sec-frozen-terminal-distribution-receipt-evidence/v2",
        "taskId": contract["taskId"], "track": contract["track"],
        "contractRawSha256": CONTRACT_RAW,
        "immutableV1ContractRawSha256": contract["immutableV1Base"]["contract"]["gitRawSha256"],
        "inputBindings": copy.deepcopy(contract["inputs"]),
        "implementationBindings": implementation,
        "scopeLimit": EXPECTED_SCOPE, "semanticCeiling": EXPECTED_CEILING,
        "noGoClaims": copy.deepcopy(contract["policy"]["noGoClaims"]),
        "population": {
            "frozenEvidenceRows": len(rows), "uniqueAccessions": len({row["accession"] for row in rows}),
            "datedFinalDistributionStatementRows": counts["DATED_FINAL_DISTRIBUTION_TO_HOLDERS_STATED"],
            "actualFirstLiquidatingDistributionByChecksStatementRows": counts["ACTUAL_FIRST_LIQUIDATING_DISTRIBUTION_BY_CHECKS_STATED"],
            "actualDefaultMixedConsiderationReceiptStatementRows": counts["ACTUAL_DEFAULT_MIXED_CONSIDERATION_RECEIVED_STATED"],
            "finalLiquidatingDistributionVerifiedRows": 0, "noFurtherDistributionsVerifiedRows": 0,
            "postClosingRecoveryVerifiedRows": 0, "terminalWealthCompleteRows": 0,
        },
        "rows": rows, "claimLocks": copy.deepcopy(contract["claimLocks"]), "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], expected: dict[str, Any]) -> None:
    if value != expected:
        fail("V2 report differs from exact source rebuild")
    body = dict(value)
    claimed = body.pop("reportSha256", None)
    if claimed != sha(canonical(body)):
        fail("V2 report self hash changed")
    if any(item is not False for item in value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("V2 report claim boundary changed")


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (EvidenceError, V1.EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any], v1_contract: dict[str, Any], reconciliation: dict[str, Any], inventory: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    implementation = implementation_bindings(state)
    report = build_report(contract, v1_contract, reconciliation, inventory, implementation)
    validate_report(report, build_report(contract, v1_contract, reconciliation, inventory, implementation))
    v1_result = V1.self_test(v1_contract, reconciliation, inventory)
    if v1_result.get("status") != "PASS" or set(v1_result.get("kills", {}).values()) != {True}:
        fail("inherited V1 adversarial suite failed")
    kills: dict[str, bool] = {}
    for label, mutate in {
        "rowRemoved": lambda item: item["rows"].pop(),
        "rowAdded": lambda item: item["rows"].append(copy.deepcopy(item["rows"][0])),
        "v1BindingChanged": lambda item: item.__setitem__("immutableV1ContractRawSha256", "0" * 64),
        "inventoryLfHashChanged": lambda item: item["inputBindings"]["originalInventoryV4"].__setitem__("builderGitRawSha256", "0" * 64),
        "claimRaised": lambda item: item["claimLocks"].__setitem__("terminalWealthComplete", True),
        "outcomeRaised": lambda item: item.__setitem__("outcomesAccessed", True),
        "scopeRaised": lambda item: item.__setitem__("scopeLimit", "ALL_TERMINAL_CASES"),
    }.items():
        changed = copy.deepcopy(report)
        mutate(changed)
        changed["reportSha256"] = sha(canonical({key: item for key, item in changed.items() if key != "reportSha256"}))
        kills[label] = rejected(lambda changed=changed: validate_report(changed, report))
    if set(kills.values()) != {True}:
        fail("V2 mutation kill failed")
    return {
        "schema": "early-detection-sec-frozen-terminal-distribution-receipt-evidence-self-test/v2",
        "status": "PASS", "v1MutationKills": len(v1_result["kills"]), "v2MutationKills": kills,
        "inventoryBuilderGitRawSha256": contract["inputs"]["originalInventoryV4"]["builderGitRawSha256"],
        "inventoryTestGitRawSha256": contract["inputs"]["originalInventoryV4"]["testGitRawSha256"],
        "verifiedRows": 5, "outcomesAccessed": False,
    }


def write_new(raw: bytes) -> None:
    if OUTPUT.exists():
        fail("V2 output already exists")
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "dry-run", "build"))
    args = parser.parse_args()
    try:
        contract = load_contract()
        validate_inputs(contract)
        v1_contract, reconciliation, inventory = validate_v1(contract)
        state = topology(contract, remote_required=True)
        if args.command == "verify-contract":
            V1.build_rows(v1_contract, reconciliation, inventory)
            result = {
                "schema": "early-detection-sec-frozen-terminal-distribution-receipt-evidence-contract-verification/v2",
                "status": "PASS", **state, "verifiedRows": 5,
                "inventoryBuilderGitRawSha256": contract["inputs"]["originalInventoryV4"]["builderGitRawSha256"],
                "inventoryTestGitRawSha256": contract["inputs"]["originalInventoryV4"]["testGitRawSha256"],
                "scopeLimit": EXPECTED_SCOPE, "outcomesAccessed": False,
            }
        elif args.command == "self-test":
            result = self_test(contract, v1_contract, reconciliation, inventory, state)
        else:
            implementation = implementation_bindings(state)
            report = build_report(contract, v1_contract, reconciliation, inventory, implementation)
            validate_report(report, build_report(contract, v1_contract, reconciliation, inventory, implementation))
            if args.command == "build":
                if state["phase"] != "IMPLEMENTED_NO_OUTPUT":
                    fail("build requires committed direct-child implementation base")
                raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
                write_new(raw)
                result = {"schema": "early-detection-sec-frozen-terminal-distribution-receipt-evidence-build/v2", "status": "PASS", "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "verifiedRows": 5, "outcomesAccessed": False}
            else:
                result = {
                    "schema": "early-detection-sec-frozen-terminal-distribution-receipt-evidence-dry-run/v2",
                    "status": "PASS", **state, "reportSha256": report["reportSha256"],
                    "population": report["population"], "verifiedRows": 5,
                    "scopeLimit": EXPECTED_SCOPE, "outcomesAccessed": False,
                }
    except (EvidenceError, V1.EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
