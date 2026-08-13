#!/usr/bin/env python3
"""Read-only fail-closed seal for the five-row frozen terminal-evidence output."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import subprocess
import types
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-frozen-terminal-distribution-receipt-evidence-output-seal-contract-v3.json"
VERIFIER = Path(__file__).resolve()
TEST = ROOT / "tests" / "verify-sec-frozen-terminal-distribution-receipt-evidence-output-v3.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-frozen-terminal-distribution-receipt-evidence-v2.json"
V2_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-frozen-terminal-distribution-receipt-evidence-contract-v2.json"
V2_BUILDER = ROOT / "scripts" / "build-sec-frozen-terminal-distribution-receipt-evidence-v2.py"
V2_TEST = ROOT / "tests" / "build-sec-frozen-terminal-distribution-receipt-evidence-v2.test.js"

CONTRACT_RAW = "bd70e619527de52a7569a858a6f0610e8689fc27a9845ac8b83b364990283843"
CONTRACT_SELF = "451338df79abdb766e3950a26aee5e4421a960bea7b62671b57ddc5b41f0b3f2"
TAG848 = "3dafd784e3fcfe6da053c710d0b5a5d4b002939b"
TAG849 = "3460af91b083b6e4a142479a7dcb376ef37c2df6"
TAG850 = "ee21b932abbb31c24c97fab093d8b98b62f7c3e9"
PRE_SEAL_PARENT = "2a5ea8234c424c8b7398c54fde8e985d73039a37"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
EXPECTED_OUTPUT_RAW = "bfd0b4e4582e1267a311e5d79a63a19339e3a9967980f542148c9173c97d13dc"
EXPECTED_REPORT_SELF = "7967bd2ed2634568a785a5ec4e76d209db7ae10dc9ec9b1d72681144f5200104"
EXPECTED_OUTPUT_BYTES = 17_153
EXPECTED_SCOPE = "EXACT_FIVE_FROZEN_PRIMARY_SEC_SENTENCES_ONLY_NO_GENERAL_SELECTOR"
OWNED = (CONTRACT, VERIFIER, TEST)


class SealError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise SealError(message)


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


def exists_at(commit: str, path: Path) -> bool:
    return subprocess.run(
        ["git", "cat-file", "-e", f"{commit}:{path.relative_to(ROOT).as_posix()}"],
        cwd=ROOT, check=False, capture_output=True,
    ).returncode == 0


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("V3 output-seal contract raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claimed = body.pop("contractSha256", None)
    if claimed != CONTRACT_SELF or sha(canonical(body)) != CONTRACT_SELF:
        fail("V3 output-seal contract self hash changed")
    exact_keys(value, {
        "claimLocks", "contractSha256", "createdAt", "expectedCases", "outputBinding",
        "policy", "preIntroduction", "purpose", "schema", "taskId", "track",
        "v2ImplementationBinding",
    }, "V3 output-seal contract")
    if value["schema"] != "early-detection-sec-frozen-terminal-distribution-receipt-evidence-output-seal-contract/v3":
        fail("V3 output-seal schema changed")
    if value["taskId"] != "Q003-SEC-FROZEN-TERMINAL-DISTRIBUTION-RECEIPT-EVIDENCE-OUTPUT-SEAL-V3" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("V3 output-seal boundary changed")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("V3 claim lock changed")
    if value["preIntroduction"] != {
        "authorizedPaths": [path.relative_to(ROOT).as_posix() for path in OWNED],
        "currentRemoteCommit": PRE_SEAL_PARENT,
        "futureIntroductionAddsExactlyAuthorizedPaths": True,
        "futureIntroductionDirectSingleParentChildRequired": True,
        "remoteRef": REMOTE_REF,
        "remoteUrl": REMOTE_URL,
    }:
        fail("V3 pre-introduction binding changed")
    if value["outputBinding"] != {
        "bytes": EXPECTED_OUTPUT_BYTES,
        "gitBlob": "0089c0791bca790995c6b708a4b9ad2a3ff4f501",
        "introductionCommit": TAG850,
        "introductionParent": TAG849,
        "introducedAsOnlyPath": True,
        "path": OUTPUT.relative_to(ROOT).as_posix(),
        "rawSha256": EXPECTED_OUTPUT_RAW,
        "reportSha256": EXPECTED_REPORT_SELF,
    }:
        fail("V3 output binding changed")
    policy = value["policy"]
    if policy != {
        "expectedEvidenceKindCounts": {
            "ACTUAL_DEFAULT_MIXED_CONSIDERATION_RECEIVED_STATED": 1,
            "ACTUAL_FIRST_LIQUIDATING_DISTRIBUTION_BY_CHECKS_STATED": 1,
            "DATED_FINAL_DISTRIBUTION_TO_HOLDERS_STATED": 3,
        },
        "expectedRows": 5,
        "normalPythonSourceRebuildRequired": True,
        "optimizedPythonSourceRebuildRequired": True,
        "outputMustMatchV2SourceRebuildByteExactly": True,
        "scopeLimit": EXPECTED_SCOPE,
        "semanticCeiling": "THREE_DATED_FINAL_DISTRIBUTION_STATEMENTS_ONE_EFFECTED_FIRST_LIQUIDATING_DISTRIBUTION_BY_CHECKS_STATEMENT_AND_ONE_ACTUAL_DEFAULT_MIXED_CONSIDERATION_RECEIPT_STATEMENT",
    }:
        fail("V3 source-rebuild or semantic policy changed")
    if [row["accession"] for row in value["expectedCases"]] != sorted(row["accession"] for row in value["expectedCases"]) or len(value["expectedCases"]) != 5:
        fail("V3 expected cases changed")
    return value


def validate_topology_model(v2_parent: str, output_parent: str, output_changes: list[str], seal_parent: str | None, seal_changes: list[str] | None) -> None:
    if v2_parent != TAG848:
        fail("Tag849 is not the direct child of Tag848")
    if output_parent != TAG849 or output_changes != [f"A\t{OUTPUT.relative_to(ROOT).as_posix()}"]:
        fail("Tag850 is not the exact one-output direct child of Tag849")
    if seal_parent is not None:
        expected = sorted(f"A\t{path.relative_to(ROOT).as_posix()}" for path in OWNED)
        if seal_parent != PRE_SEAL_PARENT or sorted(seal_changes or []) != expected:
            fail("seal introduction is not the exact three-path direct child of Tag851")


def seal_state(remote_required: bool) -> dict[str, str]:
    head = git("rev-parse", "HEAD")
    if git("remote", "get-url", "origin") != REMOTE_URL:
        fail("origin URL changed")
    if remote_required:
        remote = git("ls-remote", "--refs", "origin", REMOTE_REF).splitlines()
        if len(remote) != 1 or remote[0].split()[0] != head or git("rev-parse", "@{upstream}") != head:
            fail("HEAD, upstream and live remote differ")
    v2_parents = git("rev-list", "--parents", "-n", "1", TAG849).split()
    output_parents = git("rev-list", "--parents", "-n", "1", TAG850).split()
    if len(v2_parents) != 2 or len(output_parents) != 2:
        fail("V2/output history is not single-parent")
    v2_changes = git("diff-tree", "--no-commit-id", "--name-status", "-r", TAG849).splitlines()
    expected_v2 = sorted(
        f"A\t{path}" for path in (
            V2_CONTRACT.relative_to(ROOT).as_posix(),
            V2_BUILDER.relative_to(ROOT).as_posix(),
            V2_TEST.relative_to(ROOT).as_posix(),
        )
    )
    if sorted(v2_changes) != expected_v2:
        fail("Tag849 did not add exactly the V2 implementation paths")
    output_changes = git("diff-tree", "--no-commit-id", "--name-status", "-r", TAG850).splitlines()
    contract_committed = exists_at(head, CONTRACT)
    if not contract_committed:
        validate_topology_model(v2_parents[1], output_parents[1], output_changes, None, None)
        if head != PRE_SEAL_PARENT:
            fail("pre-introduction verification requires exact Tag851")
        for path in OWNED:
            if exists_at(head, path):
                fail("seal path existed at Tag850")
        return {"phase": "PRE_INTRODUCTION", "currentHead": head, "sealIntroduction": ""}
    seal_parents = git("rev-list", "--parents", "-n", "1", head).split()
    if len(seal_parents) != 2:
        fail("seal introduction is not single-parent")
    seal_changes = git("diff-tree", "--no-commit-id", "--name-status", "-r", head).splitlines()
    validate_topology_model(v2_parents[1], output_parents[1], output_changes, seal_parents[1], seal_changes)
    for path in OWNED:
        if git_raw(head, path) != path.read_bytes():
            fail("seal Git bytes differ from worktree")
    return {"phase": "SEALED", "currentHead": head, "sealIntroduction": head}


def bind_v2(contract: dict[str, Any]) -> None:
    binding = contract["v2ImplementationBinding"]
    if binding["introductionCommit"] != TAG849 or binding["introductionParent"] != TAG848:
        fail("V2 contract topology binding changed")
    for section, path in (("contract", V2_CONTRACT), ("builder", V2_BUILDER), ("test", V2_TEST)):
        item = binding[section]
        committed = git_raw(TAG849, path)
        if sha(committed) != item["rawSha256"] or git("rev-parse", f"{TAG849}:{path.relative_to(ROOT).as_posix()}") != item["gitBlob"]:
            fail("V2 artifact Git binding changed")
        if committed != path.read_bytes():
            fail("V2 artifact worktree bytes changed")


def import_v2(contract: dict[str, Any]) -> types.ModuleType:
    raw = V2_BUILDER.read_bytes()
    if sha(raw) != contract["v2ImplementationBinding"]["builder"]["rawSha256"]:
        fail("V2 source builder changed")
    module = types.ModuleType("bound_frozen_terminal_v2_for_output_seal")
    module.__file__ = str(V2_BUILDER)
    exec(compile(raw, str(V2_BUILDER), "exec"), module.__dict__)
    return module


def source_rebuild(contract: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
    v2 = import_v2(contract)
    v2_contract = v2.load_contract()
    v2.validate_inputs(v2_contract)
    v1_contract, reconciliation, inventory = v2.validate_v1(v2_contract)
    implementation = {
        "baseCommit": TAG849,
        "phase": "IMPLEMENTED_NO_OUTPUT",
        "remote": REMOTE_URL,
        "ref": REMOTE_REF,
        "contractRawSha256": contract["v2ImplementationBinding"]["contract"]["rawSha256"],
        "builderRawSha256": contract["v2ImplementationBinding"]["builder"]["rawSha256"],
        "testRawSha256": contract["v2ImplementationBinding"]["test"]["rawSha256"],
    }
    rebuilt = v2.build_report(v2_contract, v1_contract, reconciliation, inventory, implementation)
    raw = json.dumps(rebuilt, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
    return rebuilt, raw


def load_output(contract: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
    raw = OUTPUT.read_bytes()
    if len(raw) != EXPECTED_OUTPUT_BYTES or sha(raw) != EXPECTED_OUTPUT_RAW:
        fail("V2 output raw bytes changed")
    if git_raw(TAG850, OUTPUT) != raw or git("rev-parse", f"{TAG850}:{OUTPUT.relative_to(ROOT).as_posix()}") != contract["outputBinding"]["gitBlob"]:
        fail("V2 output Git binding changed")
    value = json.loads(raw)
    body = dict(value)
    claimed = body.pop("reportSha256", None)
    if claimed != EXPECTED_REPORT_SELF or sha(canonical(body)) != EXPECTED_REPORT_SELF:
        fail("V2 output self hash changed")
    if value.get("claimLocks") != contract["claimLocks"] or value.get("outcomesAccessed") is not False:
        fail("V2 output claim boundary changed")
    actual_cases = [
        {
            "accession": row["accession"],
            "evidenceKind": row["evidenceKind"],
            "rowCanonicalSha256": sha(canonical(row)),
        }
        for row in value.get("rows", [])
    ]
    if actual_cases != contract["expectedCases"]:
        fail("V2 exact five case bindings changed")
    return value, raw


def validate_payload(value: dict[str, Any], expected: dict[str, Any]) -> None:
    if value != expected:
        fail("V2 output differs from exact source rebuild")
    body = dict(value)
    claimed = body.pop("reportSha256", None)
    if claimed != sha(canonical(body)):
        fail("V2 output self hash invalid")
    if any(item is not False for item in value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("V2 output claim raised")


def verify(remote: bool) -> dict[str, Any]:
    contract = load_contract()
    state = seal_state(remote)
    bind_v2(contract)
    output, raw = load_output(contract)
    rebuilt, rebuilt_raw = source_rebuild(contract)
    if rebuilt_raw != raw:
        fail("V2 source-derived rebuild bytes differ from Tag850 output")
    validate_payload(output, rebuilt)
    return {
        "schema": "early-detection-sec-frozen-terminal-distribution-receipt-evidence-output-verification/v3",
        "status": "PASS", **state,
        "v2ImplementationIntroduction": TAG849, "outputIntroduction": TAG850,
        "outputRawSha256": sha(raw), "reportSha256": output["reportSha256"],
        "sourceRebuildByteExact": True, "verifiedRows": len(output["rows"]),
        "claimLocksFalse": len(contract["claimLocks"]), "outcomesAccessed": False,
    }


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (SealError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def rehash(value: dict[str, Any]) -> None:
    value["reportSha256"] = sha(canonical({key: item for key, item in value.items() if key != "reportSha256"}))


def self_test() -> dict[str, Any]:
    contract = load_contract()
    bind_v2(contract)
    output, _ = load_output(contract)
    rebuilt, _ = source_rebuild(contract)
    validate_payload(output, rebuilt)
    kills: dict[str, bool] = {}
    for label, mutate, update_hash in (
        ("rowLoss", lambda item: item["rows"].pop(), True),
        ("rowReorder", lambda item: item["rows"].reverse(), True),
        ("sourceHash", lambda item: item["rows"][0]["sourceRef"].__setitem__("blobSha256", "0" * 64), True),
        ("reportHash", lambda item: item.__setitem__("reportSha256", "0" * 64), False),
        ("claimRaised", lambda item: item["claimLocks"].__setitem__("terminalWealthComplete", True), True),
        ("outcomeRaised", lambda item: item.__setitem__("outcomesAccessed", True), True),
    ):
        changed = copy.deepcopy(output)
        mutate(changed)
        if update_hash:
            rehash(changed)
        kills[label] = rejected(lambda changed=changed: validate_payload(changed, rebuilt))
    kills["topologyV2Parent"] = rejected(lambda: validate_topology_model("0" * 40, TAG849, [f"A\t{OUTPUT.relative_to(ROOT).as_posix()}"], None, None))
    kills["topologyOutputParent"] = rejected(lambda: validate_topology_model(TAG848, "0" * 40, [f"A\t{OUTPUT.relative_to(ROOT).as_posix()}"], None, None))
    kills["topologyOutputExtraPath"] = rejected(lambda: validate_topology_model(TAG848, TAG849, [f"A\t{OUTPUT.relative_to(ROOT).as_posix()}", "A\textra"], None, None))
    kills["topologySealParent"] = rejected(lambda: validate_topology_model(TAG848, TAG849, [f"A\t{OUTPUT.relative_to(ROOT).as_posix()}"], "0" * 40, [f"A\t{path.relative_to(ROOT).as_posix()}" for path in OWNED]))
    if set(kills.values()) != {True}:
        fail("V3 output-seal mutation kill failed")
    return {
        "schema": "early-detection-sec-frozen-terminal-distribution-receipt-evidence-output-self-test/v3",
        "status": "PASS", "mutationKills": kills, "verifiedRows": 5,
        "claimLocksFalse": len(contract["claimLocks"]), "filesWritten": 0,
        "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        result = self_test() if args.command == "self-test" else verify(args.remote)
    except (SealError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
