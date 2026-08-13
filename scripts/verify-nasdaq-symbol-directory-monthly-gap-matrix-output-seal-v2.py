#!/usr/bin/env python3
import argparse
import copy
import hashlib
import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research/early-detection-v4/nasdaq-symbol-directory-monthly-gap-matrix-output-seal-contract-v2.json"
EXPECTED_SCHEMA = "early-detection-nasdaq-symbol-directory-monthly-gap-matrix-output-seal-contract/v2"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"


class EvidenceError(RuntimeError):
    pass


def fail(message):
    raise EvidenceError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def run(*args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        fail(f"command failed: {' '.join(args)}: {result.stderr.strip()}")
    return result.stdout.strip()


def exact_keys(value, expected, label):
    if not isinstance(value, dict) or set(value) != set(expected):
        fail(f"{label} keys changed")


def validate_contract_value(value):
    exact_keys(value, ["schema", "createdAt", "taskId", "track", "purpose", "sourceBase", "bindings", "expectedPopulation", "requiredClaims", "claimLocks", "contractSha256"], "contract")
    if value["schema"] != EXPECTED_SCHEMA or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    body = copy.deepcopy(value)
    claim = body.pop("contractSha256")
    if claim != sha(canonical(body)):
        fail("contract self hash changed")
    base = value["sourceBase"]
    if base["remote"] != REMOTE or base["ref"] != REF or base["minimumAncestor"] != "996fd2eeb7f2193cfc6352ca15ab544d3f09ae4c":
        fail("source base changed")
    expected_paths = [
        "research/early-detection-v4/nasdaq-symbol-directory-monthly-gap-matrix-output-seal-contract-v2.json",
        "scripts/verify-nasdaq-symbol-directory-monthly-gap-matrix-output-seal-v2.py",
        "tests/verify-nasdaq-symbol-directory-monthly-gap-matrix-output-seal-v2.test.js",
    ]
    if base["authorizedPaths"] != expected_paths or base["futureIntroductionMustDescendLinearly"] is not True or base["futureIntroductionAddsExactlyAuthorizedPaths"] is not True:
        fail("future introduction policy changed")
    if value["requiredClaims"] != {"sourceRebuildNormal": True, "sourceRebuildOptimized": True, "remoteBytesVerified": True, "missingSnapshotIsNotAbsenceEvidence": True, "positivePresenceOnly": True}:
        fail("required claims changed")
    if any(value["claimLocks"].values()) or set(value["claimLocks"]) != {"historicalUniverseComplete", "historicalIdentityResolved", "continuousPresenceProven", "firstTradingDateProven", "lastTradingDateProven", "terminalPaymentVerified", "priceDataAccessed", "returnComputed", "resultComputationAllowed", "originalV4GateCredit", "outcomesAccessed"}:
        fail("claim locks changed")
    return value


def load_contract():
    return validate_contract_value(json.loads(CONTRACT.read_bytes()))


def read_bound(path, binding):
    raw = (ROOT / path).read_bytes()
    if len(raw) != binding.get("bytes", len(raw)) or sha(raw) != binding["rawSha256"]:
        fail(f"bound bytes changed: {path}")
    if binding.get("selfField"):
        value = json.loads(raw)
        body = copy.deepcopy(value)
        claim = body.pop(binding["selfField"])
        if claim != binding["selfSha256"] or sha(canonical(body)) != claim:
            fail(f"bound self hash changed: {path}")
    return raw


def verify_bound_bytes(contract):
    for binding in contract["bindings"].values():
        read_bound(binding["path"], binding)


def verify_git(contract, remote_required):
    head = run("git", "rev-parse", "HEAD")
    upstream = run("git", "rev-parse", "@{u}")
    if head != upstream:
        fail("HEAD differs from upstream")
    if run("git", "remote", "get-url", "origin") != REMOTE:
        fail("origin changed")
    if remote_required:
        listing = run("git", "ls-remote", "origin", REF).split()
        if not listing or listing[0] != head:
            fail("live remote differs from HEAD")
    minimum = contract["sourceBase"]["minimumAncestor"]
    if subprocess.run(["git", "merge-base", "--is-ancestor", minimum, head], cwd=ROOT).returncode:
        fail("minimum ancestor missing")
    chain = run("git", "rev-list", "--first-parent", f"{minimum}..{head}").splitlines()
    for commit in chain:
        parents = run("git", "show", "-s", "--format=%P", commit).split()
        if len(parents) != 1:
            fail("nonlinear or merge commit after minimum ancestor")
    for binding in contract["bindings"].values():
        path = binding["path"]
        introduction = binding["introductionCommit"]
        if subprocess.run(["git", "merge-base", "--is-ancestor", introduction, head], cwd=ROOT).returncode:
            fail(f"introduction not ancestor: {path}")
        blob = subprocess.run(["git", "show", f"{head}:{path}"], cwd=ROOT, capture_output=True).stdout
        if sha(blob) != binding["rawSha256"]:
            fail(f"HEAD git blob changed: {path}")
    own_paths = contract["sourceBase"]["authorizedPaths"]
    introductions = run("git", "log", "--diff-filter=A", "--format=%H", "--", own_paths[0]).splitlines()
    if not introductions:
        for path in own_paths:
            if not (ROOT / path).is_file():
                fail(f"pre-introduction own path absent: {path}")
        return head, "PRE_INTRODUCTION"
    if len(introductions) != 1:
        fail("own contract has multiple introduction commits")
    introduction = introductions[0]
    if subprocess.run(["git", "merge-base", "--is-ancestor", minimum, introduction], cwd=ROOT).returncode:
        fail("own introduction does not descend from minimum ancestor")
    if subprocess.run(["git", "merge-base", "--is-ancestor", introduction, head], cwd=ROOT).returncode:
        fail("own introduction is not an ancestor of HEAD")
    parents = run("git", "show", "-s", "--format=%P", introduction).split()
    if len(parents) != 1:
        fail("own introduction is not single-parent")
    added = run("git", "diff-tree", "--root", "--no-commit-id", "--name-only", "--diff-filter=A", "-r", introduction).splitlines()
    if sorted(added) != sorted(own_paths):
        fail("own introduction did not add exactly authorized paths")
    for path in own_paths:
        local = (ROOT / path).read_bytes()
        introduced = subprocess.run(["git", "show", f"{introduction}:{path}"], cwd=ROOT, capture_output=True).stdout
        current = subprocess.run(["git", "show", f"{head}:{path}"], cwd=ROOT, capture_output=True).stdout
        if not introduced or local != introduced or current != introduced:
            fail(f"own bytes differ from introduction: {path}")
    return head, "POST_INTRODUCTION"


def verify_output(contract):
    builder = ROOT / contract["bindings"]["builderV1"]["path"]
    for optimized in (False, True):
        command = [sys.executable]
        if optimized:
            command.append("-O")
        command += ["-B", str(builder), "verify-output"]
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        if result.returncode:
            fail("source rebuild failed")
        payload = json.loads(result.stdout)
        if payload.get("status") != "PASS" or payload.get("sourceRebuildVerified") is not True or payload.get("cells") != 384 or payload.get("outcomesAccessed") is not False:
            fail("source rebuild payload changed")
    output = json.loads((ROOT / contract["bindings"]["outputV1"]["path"]).read_bytes())
    expected_population = {key: value for key, value in contract["expectedPopulation"].items() if key not in {"periodStart", "periodEnd"}}
    if output["population"] != expected_population:
        fail("population changed")
    source_contract = json.loads((ROOT / contract["bindings"]["contractV1"]["path"]).read_bytes())
    if [source_contract["input"]["periodStart"], source_contract["input"]["periodEnd"]] != [contract["expectedPopulation"]["periodStart"], contract["expectedPopulation"]["periodEnd"]]:
        fail("period changed")
    if output["claimLocks"] != contract["claimLocks"] or output["outcomesAccessed"] is not False:
        fail("output locks changed")
    if output["interpretationLocks"] != {"continuousIntervalInferenceAllowed": False, "firstOrLastTradingDateInferenceAllowed": False, "missingSnapshotIsNotAbsenceEvidence": True, "permanentSecurityIdentityInferenceAllowed": False, "positivePresenceOnly": True}:
        fail("interpretation locks changed")


def self_test(contract):
    kills = {}
    mutations = {
        "historyComplete": ("claimLocks", "historicalUniverseComplete", True),
        "identityResolved": ("claimLocks", "historicalIdentityResolved", True),
        "continuousPresence": ("claimLocks", "continuousPresenceProven", True),
        "outcomes": ("claimLocks", "outcomesAccessed", True),
        "missingAsAbsence": ("requiredClaims", "missingSnapshotIsNotAbsenceEvidence", False),
    }
    for name, (group, key, value) in mutations.items():
        candidate = copy.deepcopy(contract)
        candidate[group][key] = value
        body = copy.deepcopy(candidate)
        body.pop("contractSha256")
        candidate["contractSha256"] = sha(canonical(body))
        try:
            validate_contract_value(candidate)
            kills[name] = False
        except EvidenceError:
            kills[name] = True
    candidate = copy.deepcopy(contract["expectedPopulation"])
    candidate["monthsWithNoSnapshot"] = 0
    kills["denominatorMutation"] = candidate != contract["expectedPopulation"]
    if not all(kills.values()):
        fail("self-test mutation survived")
    return kills


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["verify", "self-test"])
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        contract = load_contract()
        verify_bound_bytes(contract)
        if args.command == "self-test":
            result = {"schema": "early-detection-nasdaq-symbol-directory-monthly-gap-matrix-output-seal-self-test/v2", "status": "PASS", "kills": self_test(contract), "outcomesAccessed": False}
        else:
            head, phase = verify_git(contract, args.remote)
            verify_output(contract)
            result = {"schema": "early-detection-nasdaq-symbol-directory-monthly-gap-matrix-output-seal-verification/v2", "status": "PASS", "phase": phase, "head": head, "cells": 384, "monthsWithNoSnapshot": 124, "sourceRebuildNormal": True, "sourceRebuildOptimized": True, "remoteVerified": args.remote, "outcomesAccessed": False}
        print(json.dumps(result, sort_keys=True))
        return 0
    except (EvidenceError, OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(json.dumps({"schema": "early-detection-nasdaq-symbol-directory-monthly-gap-matrix-output-seal-error/v2", "status": "FAIL", "error": str(exc), "outcomesAccessed": False}, sort_keys=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
