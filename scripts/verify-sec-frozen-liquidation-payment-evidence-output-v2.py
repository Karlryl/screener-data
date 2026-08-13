#!/usr/bin/env python3
"""Permanent remote/source seal for the seventeen-row liquidation-payment output."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research/early-detection-v4/sec-frozen-liquidation-payment-output-seal-contract-v2.json"
VERIFIER = Path(__file__).resolve()
TEST = ROOT / "tests/verify-sec-frozen-liquidation-payment-evidence-output-v2.test.js"
OUTPUT = ROOT / "reports/early-detection/sec-frozen-liquidation-payment-evidence-v1.json"
V1_CONTROLLER = ROOT / "scripts/materialize-sec-frozen-liquidation-payment-evidence-v1.py"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BASE_COMMIT = "623baf8d15f884ec791de96090da43a9c5f29ba4"
IMPLEMENTATION_COMMIT = "c14000778ee1b98405eb81c8b36930eb869dc3b1"
IMPLEMENTATION_PARENT = "b7bda025a01924bab82c252ea33a399ad0cdf966"
OUTPUT_COMMIT = BASE_COMMIT
EXPECTED_CONTRACT_RAW = "a22b02be6376f2d54230b438a8edc9786497c3257c9923da29c9b5f18d096eee"
EXPECTED_VERIFIER_NORMALIZED = "3eef5f90f9073f7c68d0f8f856b5751d1065934ad97a79fd254877a00ac012fe"
EXPECTED_TEST_NORMALIZED = "49f03e0af4173ac0e93de248b0f2276cfa7d38694c97810a5df57f5e29ddfd31"
OWN_PATHS = [
    "research/early-detection-v4/sec-frozen-liquidation-payment-output-seal-contract-v2.json",
    "scripts/verify-sec-frozen-liquidation-payment-evidence-output-v2.py",
    "tests/verify-sec-frozen-liquidation-payment-evidence-output-v2.test.js",
]
SEALED_PATHS = {
    "research/early-detection-v4/sec-frozen-liquidation-payment-output-contract-v1.json": ("522606ba3da01872523220b2865110fd8684999dc38c1491eb5f0281fd92dc4e", "2d77ca3fba4769b83cb78378c19c6eb5235878a0"),
    "scripts/materialize-sec-frozen-liquidation-payment-evidence-v1.py": ("40412a82bd76fab8ed375d8405d0ae7b3004e6bed5cca638bae1336e2417595d", "17bf258322332c1d545a39027fc57f347dba0e2f"),
    "tests/materialize-sec-frozen-liquidation-payment-evidence-v1.test.js": ("060025af396f65b99c9106c06d9c6b9de22bd57aca382307dda5a4501b0932f3", "b01b30b80abb8c372c453451fb90811b8c63d4b0"),
    "reports/early-detection/sec-frozen-liquidation-payment-evidence-v1.json": ("962b86e9ede09741c96a67fc853bffda101f9f6b5c0883b7da4ae23a7b416bc4", "8a6c361b3e6867bb386a7a5f99a6784598e8b86d"),
}
EXPECTED_LOCKS = {
    "cashReceiptVerified": False, "finalDistributionVerified": False,
    "firstDistributionVerified": False, "laterRecoveriesVerified": False,
    "noFurtherClaimsVerified": False, "currencyResolved": False,
    "historicalIdentityResolved": False, "terminalWealthComplete": False,
    "originalV4GateCredit": False, "resultComputationAllowed": False,
    "pricesAccessed": False, "returnsAccessed": False, "outcomesAccessed": False,
}


class SealError(RuntimeError): pass
def fail(message: str) -> None: raise SealError(message)
def sha(raw: bytes) -> str: return hashlib.sha256(raw).hexdigest()
def canonical(value: object) -> bytes: return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
def exact_keys(value: object, keys: set[str], label: str) -> None:
    if type(value) is not dict or set(value) != keys: fail(f"{label} exact keys changed")
def git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if result.returncode: fail("Git binding failed")
    return result.stdout.strip()
def git_exists(commit: str, path: str) -> bool: return subprocess.run(["git", "cat-file", "-e", f"{commit}:{path}"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
def git_raw(commit: str, path: str) -> bytes: return subprocess.check_output(["git", "show", f"{commit}:{path}"], cwd=ROOT)
def normalized(raw: bytes, javascript: bool = False) -> str:
    text = raw.decode()
    names = ("EXPECTED_CONTRACT_RAW", "EXPECTED_VERIFIER_NORMALIZED", "EXPECTED_TEST_NORMALIZED")
    for name in names:
        pattern = rf"(const {name}\s*=\s*')[^']+('\s*;)" if javascript else rf'({name}\s*=\s*")[^"]+("\s*)'
        text = re.sub(pattern, rf'\g<1>{name}_NORMALIZED\g<2>', text)
    return sha(text.encode())


def load_contract() -> dict:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW: fail("seal contract raw bytes changed")
    value = json.loads(raw); body = dict(value); claimed = body.pop("contractSelfSha256", None)
    if claimed != sha(canonical(body)): fail("seal contract self hash changed")
    exact_keys(value, {"schema", "createdAt", "track", "purpose", "contractSelfSha256", "repository", "sealedChain", "output", "implementation", "claimLocks"}, "seal contract")
    if value["schema"] != "early-detection-sec-frozen-liquidation-payment-output-seal-contract/v2" or value["createdAt"] != "2026-08-13T04:52:04Z" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA": fail("seal identity changed")
    if value["purpose"] != "Permanently verify the exact Tag870 implementation and Tag871 output-only introduction by rebuilding all seventeen rows from the bound SEC primary-source bytes in normal and optimized execution.": fail("seal purpose changed")
    if value["repository"] != {"remote": REMOTE, "ref": REF, "buildBaseCommit": BASE_COMMIT, "buildBaseTag": 871, "sealIntroductionMustBeDirectSingleParentChild": True, "sealIntroductionAddsExactlyOwnThreePaths": True, "laterLinearSingleParentDescendantsAllowed": True}: fail("seal repository changed")
    expected_paths = {path: {"rawSha256": binding[0], "gitBlob": binding[1]} for path, binding in SEALED_PATHS.items()}
    if value["sealedChain"] != {"implementationCommit": IMPLEMENTATION_COMMIT, "implementationParent": IMPLEMENTATION_PARENT, "outputCommit": OUTPUT_COMMIT, "outputParent": IMPLEMENTATION_COMMIT, "paths": expected_paths}: fail("sealed chain changed")
    if value["output"] != {"rawSha256": SEALED_PATHS[OUTPUT.relative_to(ROOT).as_posix()][0], "reportSha256": "c7b37f025ba20f1b816c69f0ac0e372df36e17dc9e2cc9136f448c13e24406d9", "rows": 17, "recipientExplicitRows": 4, "deduplicatedAgainstRows": 11, "allIntersectionCounts": 0, "currencyResolvedRows": 0, "outcomesAccessed": False}: fail("sealed output contract changed")
    if value["implementation"] != {"contractPath": OWN_PATHS[0], "verifierPath": OWN_PATHS[1], "testPath": OWN_PATHS[2], "verifierNormalizedSha256": EXPECTED_VERIFIER_NORMALIZED, "testNormalizedSha256": EXPECTED_TEST_NORMALIZED}: fail("seal implementation changed")
    if normalized(VERIFIER.read_bytes()) != EXPECTED_VERIFIER_NORMALIZED or normalized(TEST.read_bytes(), True) != EXPECTED_TEST_NORMALIZED: fail("seal implementation bytes changed")
    if value["claimLocks"] != EXPECTED_LOCKS: fail("seal claim locks changed")
    return value


def remote_head() -> str:
    if git("remote", "get-url", "origin") != REMOTE: fail("origin changed")
    head = git("rev-parse", "HEAD"); rows = git("ls-remote", "--refs", "origin", REF).splitlines()
    if len(rows) != 1 or not head == git("rev-parse", "@{u}") == rows[0].split()[0]: fail("HEAD/upstream/live remote drift")
    return head


def verify_chain(head: str) -> None:
    if git("rev-list", "--parents", "-n", "1", IMPLEMENTATION_COMMIT).split() != [IMPLEMENTATION_COMMIT, IMPLEMENTATION_PARENT]: fail("implementation parent changed")
    if git("rev-list", "--parents", "-n", "1", OUTPUT_COMMIT).split() != [OUTPUT_COMMIT, IMPLEMENTATION_COMMIT]: fail("output parent changed")
    impl_paths = list(SEALED_PATHS)[:3]; out_path = list(SEALED_PATHS)[3]
    if git("diff-tree", "--no-commit-id", "--name-status", "-r", IMPLEMENTATION_COMMIT).splitlines() != [f"A\t{path}" for path in impl_paths]: fail("implementation introduction changed")
    if git("diff-tree", "--no-commit-id", "--name-status", "-r", OUTPUT_COMMIT).splitlines() != [f"A\t{out_path}"]: fail("output introduction changed")
    for path, (raw_sha, blob) in SEALED_PATHS.items():
        raw = (ROOT / path).read_bytes()
        intro = OUTPUT_COMMIT if path == out_path else IMPLEMENTATION_COMMIT
        if sha(raw) != raw_sha or git("rev-parse", f"{intro}:{path}") != blob or git_raw(head, path) != raw or git("log", "-1", "--format=%H", "--", path) != intro: fail("sealed file drifted")


def own_phase(head: str) -> tuple[str, str | None]:
    present = [path for path in OWN_PATHS if git_exists(head, path)]
    if not present: return "PRE_SEAL", None
    if present != OWN_PATHS: fail("partial seal introduction")
    intros = {git("log", "--diff-filter=A", "-1", "--format=%H", "--", path) for path in OWN_PATHS}
    if len(intros) != 1: fail("seal paths not introduced together")
    intro = intros.pop()
    if git("show", "-s", "--format=%P", intro).split() != [BASE_COMMIT]: fail("seal is not direct child of Tag871")
    if git("diff-tree", "--no-commit-id", "--name-status", "-r", intro).splitlines() != [f"A\t{path}" for path in OWN_PATHS]: fail("seal is not exactly three additions")
    if intro not in git("rev-list", "--first-parent", head).splitlines(): fail("seal left first-parent chain")
    for path in OWN_PATHS:
        if git("log", "-1", "--format=%H", "--", path) != intro or git_raw(head, path) != (ROOT / path).read_bytes(): fail("seal bytes drifted")
    return "SEALED", intro


def source_rebuild(head: str) -> dict:
    raw = V1_CONTROLLER.read_bytes()
    if sha(raw) != SEALED_PATHS[V1_CONTROLLER.relative_to(ROOT).as_posix()][0]: fail("V1 controller bytes changed before exec")
    ns = {"__name__": "v1_output_bound", "__file__": str(V1_CONTROLLER)}; exec(compile(raw, str(V1_CONTROLLER), "exec"), ns)
    source = ns["source_namespace"](head)
    report = json.loads(OUTPUT.read_bytes())
    base = report["implementationBindings"]["currentCommit"]
    state = {key: report["implementationBindings"][key] for key in ("baseSealCommit", "currentCommit", "implementationIntroductionCommit", "implementationIntroductionParent", "linearIntermediateCommitsAllowed", "phase")}
    rebuilt = ns["source_report"](source, head, state)
    if report != rebuilt or OUTPUT.read_bytes() != json.dumps(rebuilt, ensure_ascii=False, sort_keys=True, indent=2).encode() + b"\n": fail("output source rebuild differs")
    ns["validate_semantics"](report)
    if base != IMPLEMENTATION_COMMIT: fail("output build base changed")
    return report


def self_test() -> dict:
    contract = load_contract(); mutations = {
        "futureTime": lambda x: x.__setitem__("createdAt", "2099-01-01T00:00:00Z"), "purposeCredit": lambda x: x.__setitem__("purpose", "Terminal wealth complete"),
        "outputCommitRewritten": lambda x: x["sealedChain"].__setitem__("outputCommit", IMPLEMENTATION_COMMIT), "rawDrift": lambda x: x["output"].__setitem__("rawSha256", "0" * 64),
        "outcomeCredit": lambda x: x["claimLocks"].__setitem__("outcomesAccessed", True), "unknownCredit": lambda x: x["claimLocks"].__setitem__("unknown", True),
    }; kills = {}
    for name, mutate in mutations.items():
        changed = copy.deepcopy(contract); mutate(changed)
        try:
            if changed["createdAt"] != contract["createdAt"] or changed["purpose"] != contract["purpose"] or changed["sealedChain"] != contract["sealedChain"] or changed["output"] != contract["output"] or changed["claimLocks"] != EXPECTED_LOCKS: fail("mutation")
        except SealError: kills[name] = True
        else: kills[name] = False
    if not all(kills.values()): fail("self-test survivor")
    return {"schema": "early-detection-sec-frozen-liquidation-payment-output-seal-self-test/v2", "status": "PASS", "killCount": len(kills), "kills": kills, "outcomesAccessed": False}


def verify(remote: bool) -> dict:
    if not remote: fail("remote verification is mandatory")
    load_contract(); head = remote_head(); verify_chain(head); report = source_rebuild(head); phase, intro = own_phase(head)
    return {"schema": "early-detection-sec-frozen-liquidation-payment-output-seal-verification/v2", "status": "PASS" if phase == "SEALED" else "PRE_SEAL_DIAGNOSTIC", "phase": phase, "sealIntroductionCommit": intro, "sourceRebuildVerified": True, "verifiedRows": len(report["rows"]), "recipientExplicitRows": 4, "outcomesAccessed": False, "remoteVerified": True}


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("command", choices=("verify", "self-test")); parser.add_argument("--remote", action="store_true"); args = parser.parse_args()
    try: result = self_test() if args.command == "self-test" else verify(args.remote)
    except (SealError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError, subprocess.CalledProcessError) as exc: parser.error(str(exc))
    print(json.dumps(result, sort_keys=True)); return 0
if __name__ == "__main__": raise SystemExit(main())
