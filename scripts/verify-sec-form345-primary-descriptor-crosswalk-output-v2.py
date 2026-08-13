#!/usr/bin/env python3
"""Append-only output seal for the 656-row SEC point-identity crosswalk."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form345-primary-descriptor-crosswalk-output-seal-contract-v2.json"
VERIFIER = Path(__file__).resolve()
TEST = ROOT / "tests" / "verify-sec-form345-primary-descriptor-crosswalk-output-v2.test.js"
SOURCE_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form345-primary-descriptor-crosswalk-contract-v1.json"
SOURCE_BUILDER = ROOT / "scripts" / "build-sec-form345-primary-descriptor-crosswalk-v1.py"
SOURCE_TEST = ROOT / "tests" / "build-sec-form345-primary-descriptor-crosswalk-v1.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-form345-primary-descriptor-crosswalk-v1.json"

REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
MINIMUM = "5622b794b0a435c5389707a6777161a33f8a79f7"
IMPLEMENTATION = "cd2cb2ec8c43df97c9803a6549eaef813b10a82b"
IMPLEMENTATION_PARENT = "912ed611aae9081c528cb8e39f8017a290fd4258"
OUTPUT_INTRODUCTION = "5622b794b0a435c5389707a6777161a33f8a79f7"
CONTRACT_RAW = "c6d02d12c07eaeeac95bb4518691773fb724deb6b73f29afa721a5ff938e8449"
CONTRACT_SELF = "8efedf9455bca90c5716ab56c44b1db6b9b5d005b98b27703f323435f90af520"
OWN_PATHS = (CONTRACT, VERIFIER, TEST)


class SealError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise SealError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def git_text(*args: str) -> str:
    run = subprocess.run(
        ["git", *args], cwd=ROOT, check=False, capture_output=True,
        text=True, encoding="utf-8",
    )
    if run.returncode:
        fail("Git binding failed")
    return run.stdout.strip()


def git_raw(commit: str, path: Path) -> bytes:
    relative = path.relative_to(ROOT).as_posix()
    run = subprocess.run(
        ["git", "show", f"{commit}:{relative}"], cwd=ROOT,
        check=False, capture_output=True,
    )
    if run.returncode:
        fail(f"Git blob missing: {relative}")
    return run.stdout


def tree_path_exists(commit: str, path: Path) -> bool:
    relative = path.relative_to(ROOT).as_posix()
    return subprocess.run(
        ["git", "cat-file", "-e", f"{commit}:{relative}"], cwd=ROOT,
        check=False, capture_output=True,
    ).returncode == 0


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("seal contract raw bytes changed")
    value = json.loads(raw)
    body = copy.deepcopy(value)
    claimed = body.pop("contractSha256", None)
    if claimed != CONTRACT_SELF or sha(canonical(body)) != CONTRACT_SELF:
        fail("seal contract self binding changed")
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "sourceBase",
        "lineage", "implementation", "expectedPopulation", "requiredClaims",
        "claimLocks", "contractSha256",
    }, "seal contract")
    if value["schema"] != "early-detection-sec-form345-primary-descriptor-crosswalk-output-seal-contract/v2":
        fail("seal contract schema changed")
    if value["taskId"] != "Q005-SEC-FORM345-PRIMARY-DESCRIPTOR-CROSSWALK-OUTPUT-SEAL-V2" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("seal contract boundary changed")
    base = value["sourceBase"]
    if base["remote"] != REMOTE or base["ref"] != REF or base["minimumAncestor"] != MINIMUM or base["minimumAncestorTag"] != 861:
        fail("seal source base changed")
    if base["futureSealIntroductionDirectChildOfMinimumAncestorRequired"] is not False:
        fail("seal makes an untrue direct-child claim")
    if any(base[key] is not True for key in (
        "futureSealIntroductionMayFollowUnrelatedLinearCommits",
        "historyFromMinimumAncestorThroughCurrentHeadMustBeLinearSingleParent",
        "futureSealIntroductionAddsExactlyAuthorizedPaths",
    )):
        fail("seal topology weakened")
    if base["authorizedPaths"] != [path.relative_to(ROOT).as_posix() for path in OWN_PATHS]:
        fail("seal authorized path set changed")
    lineage = value["lineage"]
    if lineage["implementation"]["commit"] != IMPLEMENTATION or lineage["implementation"]["parent"] != IMPLEMENTATION_PARENT or lineage["implementation"]["tag"] != 860:
        fail("implementation lineage changed")
    if lineage["output"]["commit"] != OUTPUT_INTRODUCTION or lineage["output"]["parent"] != IMPLEMENTATION or lineage["output"]["tag"] != 861:
        fail("output lineage changed")
    required = value["requiredClaims"]
    if any(required[key] is not True for key in (
        "sourceDerivedFullRebuild", "sourceRebuildNormal", "sourceRebuildOptimized",
        "sourceRebuildByteExact", "rowSelfHashesVerified",
        "rawLiteralsRemainUnsplitAndUnnormalized", "futurePointsRemainCountOnly",
        "historicalPublicKnownAtRemainsNull", "remoteBytesVerified",
    )) or required["resolutionCredit"] is not False:
        fail("seal required claims changed")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("seal claim lock changed")
    return value


def validate_frozen_lineage(contract: dict[str, Any]) -> None:
    implementation_paths = {
        contract["implementation"][key]["path"] for key in ("contract", "builder", "test")
    }
    output_path = contract["implementation"]["output"]["path"]
    if git_text("show", "-s", "--format=%P", IMPLEMENTATION).split() != [IMPLEMENTATION_PARENT]:
        fail("Tag860 is not the exact single-parent implementation commit")
    implementation_changes = git_text(
        "diff-tree", "--no-commit-id", "--name-status", "-r", IMPLEMENTATION,
    ).splitlines()
    if len(implementation_changes) != 3 or any(not row.startswith("A\t") for row in implementation_changes):
        fail("Tag860 did not add exactly three implementation paths")
    if {row.split("\t", 1)[1] for row in implementation_changes} != implementation_paths:
        fail("Tag860 implementation path set changed")
    if git_text("show", "-s", "--format=%P", OUTPUT_INTRODUCTION).split() != [IMPLEMENTATION]:
        fail("Tag861 is not the exact single-parent output commit")
    output_changes = git_text(
        "diff-tree", "--no-commit-id", "--name-status", "-r", OUTPUT_INTRODUCTION,
    ).splitlines()
    if output_changes != [f"A\t{output_path}"]:
        fail("Tag861 did not add exactly the output path")


def validate_source_git_bindings(contract: dict[str, Any], head: str) -> None:
    for key in ("contract", "builder", "test", "output"):
        binding = contract["implementation"][key]
        path = ROOT / binding["path"]
        raw = path.read_bytes()
        if len(raw) != binding["bytes"] or sha(raw) != binding["rawSha256"]:
            fail(f"{key} local bytes changed")
        if git_text("rev-parse", f"{binding['introductionCommit']}:{binding['path']}") != binding["gitBlob"]:
            fail(f"{key} introduction Git blob changed")
        if git_text("rev-parse", f"{head}:{binding['path']}") != binding["gitBlob"]:
            fail(f"{key} current Git blob changed")
        if git_raw(binding["introductionCommit"], path) != raw or git_raw(head, path) != raw:
            fail(f"{key} Git bytes changed")
        if git_text("log", "--diff-filter=A", "-1", "--format=%H", "--", binding["path"]) != binding["introductionCommit"]:
            fail(f"{key} introduction changed")
    source_contract = json.loads(SOURCE_CONTRACT.read_bytes())
    body = dict(source_contract)
    claimed = body.pop("contractSha256", None)
    binding = contract["implementation"]["contract"]
    if claimed != binding["selfSha256"] or sha(canonical(body)) != claimed:
        fail("source contract self binding changed")


def seal_topology(contract: dict[str, Any]) -> dict[str, Any]:
    head = git_text("rev-parse", "HEAD")
    if git_text("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    if git_text("rev-parse", "@{upstream}") != head:
        fail("HEAD and upstream differ")
    listing = git_text("ls-remote", "--refs", "origin", REF).splitlines()
    if len(listing) != 1 or listing[0].split()[0] != head:
        fail("live remote and current HEAD differ")
    if subprocess.run(["git", "merge-base", "--is-ancestor", MINIMUM, head], cwd=ROOT).returncode:
        fail("Tag861 is not an ancestor of current HEAD")
    commits = git_text("rev-list", "--ancestry-path", "--reverse", f"{MINIMUM}..{head}").splitlines()
    previous = MINIMUM
    for commit in commits:
        if git_text("show", "-s", "--format=%P", commit).split() != [previous]:
            fail("post-Tag861 history is not a linear single-parent chain")
        previous = commit
    own_rel = {path.relative_to(ROOT).as_posix() for path in OWN_PATHS}
    if not tree_path_exists(head, CONTRACT):
        for path in OWN_PATHS:
            if tree_path_exists(head, path) or not path.is_file():
                fail("pre-introduction seal path state changed")
        return {"phase": "PRE_INTRODUCTION", "head": head, "sealIntroduction": None}
    introductions = {
        git_text("log", "--diff-filter=A", "-1", "--format=%H", "--", path.relative_to(ROOT).as_posix())
        for path in OWN_PATHS
    }
    if len(introductions) != 1 or "" in introductions:
        fail("seal paths do not share one introduction")
    introduction = next(iter(introductions))
    if introduction not in commits:
        fail("seal introduction is not after Tag861")
    changes = git_text("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines()
    if len(changes) != 3 or any(not row.startswith("A\t") for row in changes):
        fail("seal introduction did not add exactly three paths")
    if {row.split("\t", 1)[1] for row in changes} != own_rel:
        fail("seal introduction path set changed")
    intro_index = commits.index(introduction)
    for commit in commits[:intro_index]:
        touched = set(git_text("diff-tree", "--no-commit-id", "--name-only", "-r", commit).splitlines())
        if touched & own_rel:
            fail("pre-introduction commit touched a seal path")
    for commit in commits[intro_index + 1:]:
        touched = set(git_text("diff-tree", "--no-commit-id", "--name-only", "-r", commit).splitlines())
        if touched & own_rel:
            fail("post-introduction commit changed a seal path")
    for path in OWN_PATHS:
        raw = path.read_bytes()
        if git_raw(introduction, path) != raw or git_raw(head, path) != raw:
            fail("seal introduction, HEAD and worktree bytes differ")
    return {"phase": "POST_INTRODUCTION", "head": head, "sealIntroduction": introduction}


def validate_output_value(value: dict[str, Any], contract: dict[str, Any]) -> None:
    if value.get("schema") != "early-detection-sec-form345-primary-descriptor-crosswalk/v1":
        fail("output schema changed")
    body = copy.deepcopy(value)
    claimed = body.pop("reportSha256", None)
    output_binding = contract["implementation"]["output"]
    if claimed != output_binding["selfSha256"] or sha(canonical(body)) != claimed:
        fail("output self binding changed")
    if value.get("population") != contract["expectedPopulation"]:
        fail("output population changed")
    if value.get("claimLocks") != contract["claimLocks"] or value.get("outcomesAccessed") is not False:
        fail("output claim locks changed")
    implementation = value.get("implementationBindings")
    expected_implementation = {
        "sealedBaseCommit": "996fd2eeb7f2193cfc6352ca15ab544d3f09ae4c",
        "currentHead": IMPLEMENTATION,
        "phase": "IMPLEMENTED_NO_OUTPUT",
        "implementationIntroduction": IMPLEMENTATION,
        "remote": REMOTE,
        "ref": REF,
        "contractRawSha256": contract["implementation"]["contract"]["rawSha256"],
        "builderRawSha256": contract["implementation"]["builder"]["rawSha256"],
        "testRawSha256": contract["implementation"]["test"]["rawSha256"],
    }
    if implementation != expected_implementation:
        fail("output implementation binding changed")
    rows = value.get("rows")
    if not isinstance(rows, list) or len(rows) != 656:
        fail("output row denominator changed")
    if len({row.get("workItemId") for row in rows}) != 656:
        fail("output work-item identity changed")
    if len({row.get("eventAccession") for row in rows}) != 652 or len({row.get("issuerCik") for row in rows}) != 607:
        fail("output accession or CIK denominator changed")
    statuses = Counter()
    comparisons = Counter()
    for row in rows:
        row_body = copy.deepcopy(row)
        row_claim = row_body.pop("rowSha256", None)
        if row_claim != sha(canonical(row_body)):
            fail("output row self hash changed")
        for key in (
            "resolutionCreditGranted", "historicalIdentityResolved", "securityIdentityResolved",
            "listingIdentityResolved", "tickerReuseResolved", "terminalWealthComplete",
            "originalV4GateCredit", "outcomesAccessed",
        ):
            if row.get(key) is not False:
                fail("output row resolution or outcome lock changed")
        point = row.get("form345PointEvidence")
        if not isinstance(point, dict) or "futureRawLiterals" in point:
            fail("future raw literal entered output")
        status = point.get("pointStatus")
        literals = point.get("latestRawLiterals")
        latest = point.get("latestEvidence")
        if not isinstance(literals, list) or not isinstance(latest, list):
            fail("output raw literal evidence changed")
        evidence_literals = sorted({item.get("issuerTradingSymbol") for item in latest})
        if literals != evidence_literals:
            fail("output raw literals were split, normalized or chosen")
        if status == "NO_PRIOR_POINT" and literals:
            fail("no-prior row contains selected literals")
        if status == "ONE_LATEST_LITERAL" and len(literals) != 1:
            fail("single-literal status changed")
        if status == "CONFLICTING_LATEST_LITERALS" and len(literals) <= 1:
            fail("same-date conflict was chosen")
        if status not in {"NO_PRIOR_POINT", "ONE_LATEST_LITERAL", "CONFLICTING_LATEST_LITERALS"}:
            fail("unknown point status")
        comparison = point.get("archiveComparison")
        archive_tickers = [item.get("ticker") for item in comparison.get("archiveCandidates", [])]
        matched = [literal for literal in literals if literal in archive_tickers]
        if comparison.get("matchedRawLiterals") != matched or comparison.get("comparisonNormalizationApplied") is not False:
            fail("archive comparison is not byte-exact")
        expected_status = "NO_COMPARABLE_CANDIDATE"
        if literals and archive_tickers:
            expected_status = "EXACT_LITERAL_MATCH" if matched else "EXACT_LITERAL_MISMATCH"
        if comparison.get("status") != expected_status:
            fail("archive comparison status changed")
        known_at = point.get("knownAt")
        if known_at.get("historicalPublicKnownAtUtc") is not None or known_at.get("historicalStudyFeatureAuthorized") is not False:
            fail("historical public knownAt or study authorization invented")
        statuses[status] += 1
        comparisons[comparison["status"]] += 1
    if dict(statuses) != contract["expectedPopulation"]["pointStatusCounts"]:
        fail("row-derived point status counts changed")
    if dict(comparisons) != contract["expectedPopulation"]["archiveComparisonCounts"]:
        fail("row-derived comparison counts changed")


def load_output(contract: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
    binding = contract["implementation"]["output"]
    raw = OUTPUT.read_bytes()
    if len(raw) != binding["bytes"] or sha(raw) != binding["rawSha256"]:
        fail("output raw bytes changed")
    value = json.loads(raw)
    validate_output_value(value, contract)
    return raw, value


def load_source_builder(contract: dict[str, Any]) -> Any:
    binding = contract["implementation"]["builder"]
    raw = SOURCE_BUILDER.read_bytes()
    if len(raw) != binding["bytes"] or sha(raw) != binding["rawSha256"]:
        fail("source builder bytes changed before import")
    module = type(sys)("bound_form345_primary_descriptor_builder_v1")
    module.__file__ = str(SOURCE_BUILDER)
    exec(compile(raw, str(SOURCE_BUILDER), "exec"), module.__dict__)
    return module


def source_rebuild(contract: dict[str, Any], expected_raw: bytes) -> str:
    builder = load_source_builder(contract)
    source_contract = builder.validate_contract()
    inputs = builder.load_inputs(source_contract)
    frozen_state = {
        "phase": "IMPLEMENTED_NO_OUTPUT",
        "currentHead": IMPLEMENTATION,
        "implementationIntroduction": IMPLEMENTATION,
    }
    report = builder.build_report(source_contract, inputs, frozen_state)
    builder.validate_report(report, report)
    rebuilt = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
    if rebuilt != expected_raw:
        fail("source-derived rebuilt bytes differ from sealed output")
    return sha(rebuilt)


def legacy_cli_rejection_observed() -> bool:
    run = subprocess.run(
        [sys.executable, "-B", str(SOURCE_BUILDER), "verify-output"],
        cwd=ROOT, check=False, capture_output=True, text=True, encoding="utf-8",
    )
    combined = f"{run.stdout}\n{run.stderr}"
    return run.returncode != 0 and "future output entered implementation Git history" in combined


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (SealError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any], output: dict[str, Any]) -> dict[str, Any]:
    contract_kills: dict[str, bool] = {}
    for name, mutate in {
        "directChildLie": lambda value: value["sourceBase"].__setitem__("futureSealIntroductionDirectChildOfMinimumAncestorRequired", True),
        "implementationParent": lambda value: value["lineage"]["implementation"].__setitem__("parent", "0" * 40),
        "outputParent": lambda value: value["lineage"]["output"].__setitem__("parent", "0" * 40),
        "rowCount": lambda value: value["expectedPopulation"].__setitem__("rows", 655),
        "resolutionCredit": lambda value: value["requiredClaims"].__setitem__("resolutionCredit", True),
        "identityLock": lambda value: value["claimLocks"].__setitem__("historicalIdentityResolved", True),
        "terminalLock": lambda value: value["claimLocks"].__setitem__("terminalWealthComplete", True),
        "outcomeLock": lambda value: value["claimLocks"].__setitem__("outcomesAccessed", True),
    }.items():
        candidate = copy.deepcopy(contract)
        mutate(candidate)
        body = copy.deepcopy(candidate)
        body.pop("contractSha256", None)
        candidate["contractSha256"] = sha(canonical(body))
        contract_kills[name] = rejected(lambda candidate=candidate: validate_contract_value_for_test(candidate))

    output_kills: dict[str, bool] = {}
    for name, mutate in {
        "rowLost": lambda value: value["rows"].pop(),
        "literalSplit": lambda value: value["rows"][0]["form345PointEvidence"]["latestRawLiterals"].append("SPLIT"),
        "futureLiteral": lambda value: value["rows"][0]["form345PointEvidence"].__setitem__("futureRawLiterals", ["LEAK"]),
        "normalization": lambda value: value["rows"][0]["form345PointEvidence"]["archiveComparison"].__setitem__("comparisonNormalizationApplied", True),
        "historicalKnownAt": lambda value: value["rows"][0]["form345PointEvidence"]["knownAt"].__setitem__("historicalPublicKnownAtUtc", "2010-01-01T00:00:00Z"),
        "resolution": lambda value: value["rows"][0].__setitem__("resolutionCreditGranted", True),
        "security": lambda value: value["rows"][0].__setitem__("securityIdentityResolved", True),
        "listing": lambda value: value["rows"][0].__setitem__("listingIdentityResolved", True),
        "terminal": lambda value: value["rows"][0].__setitem__("terminalWealthComplete", True),
        "outcomes": lambda value: value.__setitem__("outcomesAccessed", True),
    }.items():
        candidate = copy.deepcopy(output)
        mutate(candidate)
        for row in candidate.get("rows", []):
            row_body = {key: item for key, item in row.items() if key != "rowSha256"}
            row["rowSha256"] = sha(canonical(row_body))
        candidate["reportSha256"] = sha(canonical({key: item for key, item in candidate.items() if key != "reportSha256"}))
        output_kills[name] = rejected(lambda candidate=candidate: validate_output_against_frozen(candidate, contract, output))
    if not all(contract_kills.values()) or not all(output_kills.values()):
        fail("seal adversarial mutation survived")
    return {"contractKills": contract_kills, "outputKills": output_kills}


def validate_contract_value_for_test(value: dict[str, Any]) -> None:
    if value != validate_contract():
        fail("mutated contract differs from sealed contract")


def validate_output_against_frozen(value: dict[str, Any], contract: dict[str, Any], frozen: dict[str, Any]) -> None:
    validate_output_value(value, contract)
    if value != frozen:
        fail("mutated output differs from sealed output")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    args = parser.parse_args()
    try:
        contract = validate_contract()
        raw, output = load_output(contract)
        if args.command == "self-test":
            kills = self_test(contract, output)
            result = {
                "schema": "early-detection-sec-form345-primary-descriptor-crosswalk-output-seal-self-test/v2",
                "status": "PASS", "verifiedRows": 656, **kills,
                "outcomesAccessed": False,
            }
        else:
            validate_frozen_lineage(contract)
            state = seal_topology(contract)
            validate_source_git_bindings(contract, state["head"])
            if not legacy_cli_rejection_observed():
                fail("legacy V1 post-output CLI rejection was not observed")
            rebuilt_hash = source_rebuild(contract, raw)
            result = {
                "schema": "early-detection-sec-form345-primary-descriptor-crosswalk-output-seal-verification/v2",
                "status": "PASS", "phase": state["phase"], "head": state["head"],
                "sealIntroduction": state["sealIntroduction"], "verifiedRows": 656,
                "outputRawSha256": sha(raw), "outputReportSha256": output["reportSha256"],
                "rebuiltRawSha256": rebuilt_hash, "sourceDerivedFullRebuild": True,
                "sourceRebuildByteExact": True, "rowSelfHashesVerified": True,
                "rawLiteralsRemainUnsplitAndUnnormalized": True,
                "futurePointsRemainCountOnly": True,
                "historicalPublicKnownAtRemainsNull": True,
                "legacyCliPostOutputRejectionObserved": True,
                "remoteVerified": True, "resolutionCreditGranted": False,
                "outcomesAccessed": False,
            }
    except (SealError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({
            "schema": "early-detection-sec-form345-primary-descriptor-crosswalk-output-seal-error/v2",
            "status": "FAIL", "error": str(exc), "outcomesAccessed": False,
        }, sort_keys=True), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
