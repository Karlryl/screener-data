#!/usr/bin/env python3
"""Verify the outcome-blind zero-cost adjusted-OHLCV source decision."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "consolidated-adjusted-ohlcv-zero-cost-source-decision-contract-v1.json"
VERIFIER = Path(__file__).resolve()
TEST = ROOT / "tests" / "verify-consolidated-adjusted-ohlcv-zero-cost-source-decision-v1.test.js"
OWNED = (CONTRACT, VERIFIER, TEST)

CONTRACT_RAW = "dbcbd44a5acbd5b30334f2a3047ed37515a02eb15de5a19fc3aec98629f40d1b"
CONTRACT_SELF = "82729a5441926ab8fcc51c7bddb38070adce35230e7f9e4f5e4388ced1c983f5"
VERIFIER_NORMALIZED = "c5c71520078e30ebad46106f1b2eff0e9ab883a9eab0a628932c24dd98df05e8"
TEST_NORMALIZED = "5eb8a964b5d3c887775582c05513562d6929da018639d79615fc831d087b2ad0"
BASE = "020c54d4e02f8a754e4b5a79b845ae2a4244e7f8"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
CREATED_AT = "2026-08-13T09:38:03Z"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")

INPUTS = {
    "coverageLedger": ("reports/early-detection/sec-terminal-wealth-evidence-coverage-ledger-v1.json", "bd90edb31182f3f45c3ff10f9f800e4b1e0adf137880ddcf1838537c1f01d9bb"),
    "continuousSourceRegistry": ("research/early-detection-v4/continuous-free-source-registry-v1.json", "d07ba18a969aced361fb638d52226f373ec64052dba30ddf36789a2a130a8927"),
    "quantConnectRightsDisposition": ("research/early-detection-v4/quantconnect-free-cloud-rights-disposition-contract-v1.json", "0676fa88d4ad76f8a4a5eb951d2a3d529e25840acf11a7cdb484adc309d39c8e"),
    "tiingoPrerequisite": ("research/early-detection-v4/tiingo-free-eod-prerequisite-contract-v1.json", "6ef3bbcce169fd840432c941ef83b31c6c30ee73194e955c1899d2c6530b888d"),
    "alpacaPrerequisite": ("research/early-detection-v4/alpaca-basic-corporate-actions-prerequisite-contract-v1.json", "cd2bbeabae5fd95aee61ee938fc5746e5ad55305c7ce847aacaef58436cc3c6a"),
    "massivePrerequisite": ("research/early-detection-v4/massive-stocks-basic-prerequisite-contract-v1.json", "95f84d1a97756186d2528f04bb7a4166234f00c55dfd569978c1cf232379e0a9"),
    "simfinPrerequisite": ("research/early-detection-v4/simfin-free-prerequisite-contract-v1.json", "680e23d40679e11b5405639b24b8e8d01fd9419cc609e74854535762b47a9c77"),
    "eodhdPrerequisite": ("research/early-detection-v4/eodhd-free-prerequisite-contract-v1.json", "16fdc6d6ce6df996c4d5340b0b65830464a5f412c264caf2d7d92c7d73e692d3"),
    "marketstackPrerequisite": ("research/early-detection-v4/marketstack-free-prerequisite-contract-v1.json", "83ec8d2ed2a051c782f4130bce912f791663a8856858b9546b6752649eb69ca7"),
    "twelveDataPrerequisite": ("research/early-detection-v4/twelve-data-basic-prerequisite-contract-v1.json", "769efda94a83a112ee8945871209da7315341908a2673c3595b804fd6fd05890"),
    "legacyFreeSourceAudit": ("reports/early-detection/free-ohlcv-source-audit-2026-08-08.json", "d9ee9b263fe83350bea2bb5a8ce813bdc32f504e7fc55065cc2ceb550a24a1a5"),
}

INPUT_KEYSETS = {
    "coverageLedger": {"path", "rawSha256", "reportSha256"},
    "continuousSourceRegistry": {"path", "rawSha256"},
    "quantConnectRightsDisposition": {"path", "rawSha256", "contractSha256"},
    "tiingoPrerequisite": {"path", "rawSha256", "contractSha256"},
    "alpacaPrerequisite": {"path", "rawSha256"},
    "massivePrerequisite": {"path", "rawSha256"},
    "simfinPrerequisite": {"path", "rawSha256"},
    "eodhdPrerequisite": {"path", "rawSha256"},
    "marketstackPrerequisite": {"path", "rawSha256"},
    "twelveDataPrerequisite": {"path", "rawSha256"},
    "legacyFreeSourceAudit": {"path", "rawSha256"},
}

INPUT_EXTRAS = {
    "coverageLedger": {"reportSha256": "b089e12f1a11a45a87388df334efb6ee644460bf2f9b4f54527d39ea8adc8dd2"},
    "continuousSourceRegistry": {},
    "quantConnectRightsDisposition": {"contractSha256": "10c35d442ed9249fd94680a03566b5a1ce9f13a4f30b346cb4abc0db697c8283"},
    "tiingoPrerequisite": {"contractSha256": "b65918c52c3effe3be3cd84fe586c2f896aed4fa502400e7fbc3f46fcb7dc0cf"},
    "alpacaPrerequisite": {},
    "massivePrerequisite": {},
    "simfinPrerequisite": {},
    "eodhdPrerequisite": {},
    "marketstackPrerequisite": {},
    "twelveDataPrerequisite": {},
    "legacyFreeSourceAudit": {},
}

OFFICIAL_RECHECKS = [
    {
        "sourceId": "QUANTCONNECT_FREE_CLOUD",
        "url": "https://www.quantconnect.com/docs/v2/writing-algorithms/logging",
        "observedAt": "2026-08-13T09:30:00Z",
        "verifiedFact": "QuantConnect states that logging dataset information is not permitted.",
    },
    {
        "sourceId": "QUANTCONNECT_FREE_CLOUD",
        "url": "https://www.quantconnect.com/docs/v2/cloud-platform/datasets/licensing",
        "observedAt": "2026-08-13T09:30:00Z",
        "verifiedFact": "Cloud access does not grant row export; local download is separately licensed, restricted to internal LEAN use and may not be redistributed or converted.",
    },
    {
        "sourceId": "TIINGO_FREE",
        "url": "https://www.tiingo.com/about/pricing",
        "observedAt": "2026-08-13T09:30:00Z",
        "verifiedFact": "The zero-dollar Starter tier permits 500 unique symbols per month, 50 requests per hour, 1000 requests per day and 1 GB per month under an internal-use-only license.",
    },
    {
        "sourceId": "TIINGO_FREE",
        "url": "https://www.tiingo.com/documentation/end-of-day",
        "observedAt": "2026-08-13T09:30:00Z",
        "verifiedFact": "The authenticated EOD API documents raw and adjusted OHLCV, cash dividends and split factors, but its public ticker metadata supplies ticker and exchange fields rather than a baseline permanent-security identifier.",
    },
    {
        "sourceId": "ALPHA_VANTAGE_FREE",
        "url": "https://www.alphavantage.co/documentation/",
        "observedAt": "2026-08-13T09:30:00Z",
        "verifiedFact": "The full daily adjusted endpoint is marked Premium; the raw daily endpoint is not a substitute for adjusted consolidated OHLCV with complete actions.",
    },
]

SOURCE_GROUPS = [
    "QUANTCONNECT_FREE_CLOUD",
    "TIINGO_FREE",
    "ALPHA_VANTAGE_FREE",
    "ALPACA_AND_MASSIVE_FREE",
    "SIMFIN_EODHD_MARKETSTACK_TWELVEDATA_FREE",
    "SEC_EXCHANGE_AND_REGULATORY_PRIMARY",
    "RESEARCH_ARCHIVES_AND_STOOQ",
]
SOURCE_DISPOSITIONS = [
    {"sourceGroup": "QUANTCONNECT_FREE_CLOUD", "disposition": "REJECT_FULL_UNIVERSE_EXPORT_RIGHTS", "canMaterializePublicEvidenceRows": False, "canRunBoundedPrivatePilot": False, "fullUniverseConfirmatoryEligible": False},
    {"sourceGroup": "TIINGO_FREE", "disposition": "ALLOW_THREE_CASE_PRIVATE_ENTITLEMENT_PILOT_AFTER_ACCOUNT_GATE", "canMaterializePublicEvidenceRows": False, "canRunBoundedPrivatePilot": True, "fullUniverseConfirmatoryEligible": False},
    {"sourceGroup": "ALPHA_VANTAGE_FREE", "disposition": "REJECT_ADJUSTED_HISTORY_PREMIUM", "canMaterializePublicEvidenceRows": False, "canRunBoundedPrivatePilot": False, "fullUniverseConfirmatoryEligible": False},
    {"sourceGroup": "ALPACA_AND_MASSIVE_FREE", "disposition": "RECENT_SIP_OR_IEX_SENSITIVITY_ONLY", "canMaterializePublicEvidenceRows": False, "canRunBoundedPrivatePilot": True, "fullUniverseConfirmatoryEligible": False},
    {"sourceGroup": "SIMFIN_EODHD_MARKETSTACK_TWELVEDATA_FREE", "disposition": "SHORT_HISTORY_OR_EPHEMERAL_SENSITIVITY_ONLY", "canMaterializePublicEvidenceRows": False, "canRunBoundedPrivatePilot": True, "fullUniverseConfirmatoryEligible": False},
    {"sourceGroup": "SEC_EXCHANGE_AND_REGULATORY_PRIMARY", "disposition": "EVENT_AND_MARKET_ACTIVITY_EVIDENCE_NOT_OHLCV", "canMaterializePublicEvidenceRows": False, "canRunBoundedPrivatePilot": False, "fullUniverseConfirmatoryEligible": False},
    {"sourceGroup": "RESEARCH_ARCHIVES_AND_STOOQ", "disposition": "CONTINUE_DISCOVERY_QUARANTINE_UNTIL_LICENSE_PROVENANCE_AND_ACTION_RECONCILIATION_PASS", "canMaterializePublicEvidenceRows": False, "canRunBoundedPrivatePilot": False, "fullUniverseConfirmatoryEligible": False},
]
CHECK_IDS = ["RIGHTS_AND_REPRODUCIBILITY", "WINDOW_COVERAGE_AND_CAPACITY", "IDENTITY_ACTION_AND_TERMINAL_LINKAGE"]
BLOCKER_CHECKS = [
    {"checkId": "RIGHTS_AND_REPRODUCIBILITY", "status": "BLOCKED", "mechanism": "QuantConnect forbids dataset-information logging and separately licenses downloads; Tiingo permits internal use but not public provider-row redistribution.", "whatWouldClear": "A zero-cost license must permit private durable storage plus independently verifiable manifests without exporting prohibited provider rows."},
    {"checkId": "WINDOW_COVERAGE_AND_CAPACITY", "status": "BLOCKED", "mechanism": "Tiingo Starter is capped at 500 unique symbols per month, adjusted Alpha Vantage history is premium, and the remaining free vendors are recent, short-history, venue-limited or ephemeral.", "whatWouldClear": "A zero-cost acquisition plan must cover the then-listed 2009-2024 population within a sealed, outcome-blind schedule and retain all required adjusted fields."},
    {"checkId": "IDENTITY_ACTION_AND_TERMINAL_LINKAGE", "status": "BLOCKED", "mechanism": "The Q003 queue lacks resolved entity/security/listing keys; Tiingo baseline public metadata has no permanent identifier, while current free archives do not prove complete actions, final sessions and delisted treatment.", "whatWouldClear": "Every price series must be joined through a verified permanent security or listing key and reconciled to complete action and terminal evidence."},
]
DECISION = {
    "status": "THREE_INDEPENDENT_BLOCKER_CHECKS_CONFIRMED_NO_CURRENTLY_QUALIFIED_FULL_UNIVERSE_ZERO_COST_SOURCE",
    "consolidatedAdjustedOhlcvResolved": False,
    "fullUniverseAcquisitionAuthorized": False,
    "tiingoThreeCasePilotEligibleAfterAccountGate": True,
    "tiingoFullUniverseEligible": False,
    "researchArchiveDiscoveryMayContinue": True,
    "recentOrVenueSpecificSensitivityMayContinue": True,
    "paidFallbackAuthorized": False,
    "nextAutonomousAction": "Continue provenance-and-license discovery in research archives and prepare, without executing, an exact three-case Tiingo entitlement pilot that cannot promote ticker-only identity, terminal payment or full-universe coverage.",
}
LOCK_KEYS = {
    "canonicalEvidenceCellsMaterialized", "consolidatedAdjustedOhlcvResolved",
    "fullUniverseCoverageClaimed", "survivorshipSafeCoverageClaimed",
    "permanentIdentityResolved", "completeCorporateActionsResolved",
    "terminalSessionResolved", "terminalWealthComplete", "providerRowsPublished",
    "productionRequestsAuthorized", "paidFallbackAuthorized", "originalV4GateCredit",
    "resultComputationAllowed", "pricesAccessed", "returnsAccessed", "outcomesAccessed",
}


class DecisionError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise DecisionError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if type(value) is not dict or set(value) != expected:
        fail(f"{label} exact keys changed")


def normalized_verifier(raw: bytes) -> bytes:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    for name in ("CONTRACT_RAW", "CONTRACT_SELF", "VERIFIER_NORMALIZED", "TEST_NORMALIZED"):
        pattern = re.compile(rf'^{name} = "[0-9a-fA-Z_]+"$', re.MULTILINE)
        if len(pattern.findall(text)) != 1:
            fail(f"{name} normalization structure changed")
        text = pattern.sub(f'{name} = "{"0" * 64}"', text)
    return text.encode("utf-8")


def normalized_test(raw: bytes) -> bytes:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    for name in ("EXPECTED_CONTRACT_RAW", "EXPECTED_VERIFIER_NORMALIZED", "EXPECTED_TEST_NORMALIZED"):
        pattern = re.compile(rf"^const {name} = '[0-9a-fA-Z_]+';$", re.MULTILINE)
        if len(pattern.findall(text)) != 1:
            fail(f"{name} normalization structure changed")
        text = pattern.sub(f"const {name} = '{'0' * 64}';", text)
    return text.encode("utf-8")


def parse_time(value: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        fail("timestamp must be exact Zulu time")
    return datetime.fromisoformat(value.removesuffix("Z") + "+00:00")


def git(*args: str, check: bool = True) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False)
    if check and result.returncode:
        fail(result.stderr.strip() or "git command failed")
    return result.stdout.strip()


def git_raw(commit: str, path: Path) -> bytes:
    relative = path.relative_to(ROOT).as_posix()
    result = subprocess.run(["git", "show", f"{commit}:{relative}"], cwd=ROOT, capture_output=True, check=False)
    if result.returncode:
        fail(f"Git blob unavailable for {relative}")
    return result.stdout


def changed_paths(commit: str) -> list[tuple[str, str]]:
    output = git("diff-tree", "--no-commit-id", "--name-status", "-r", commit)
    return [tuple(line.split("\t", 1)) for line in output.splitlines() if line]


def introduction_for(path: Path) -> list[str]:
    relative = path.relative_to(ROOT).as_posix()
    output = git("log", "--reverse", "--format=%H", "--diff-filter=A", f"{BASE}..HEAD", "--", relative)
    return [line for line in output.splitlines() if line]


def validate_contract(contract: dict[str, Any], *, dependencies: bool = True) -> None:
    exact_keys(contract, {
        "schema", "createdAt", "taskId", "track", "purpose", "consumerRequirement",
        "authoritativeInputs", "officialRechecks", "sourceDispositions",
        "independentBlockerChecks", "decision", "claimLocks", "implementationContract",
        "contractSha256",
    }, "contract")
    if contract["schema"] != "consolidated-adjusted-ohlcv-zero-cost-source-decision-contract/v1":
        fail("schema changed")
    if contract["createdAt"] != CREATED_AT or parse_time(contract["createdAt"]) > datetime.now(timezone.utc):
        fail("createdAt changed or is in the future")
    if contract["taskId"] != "Q003-CONSOLIDATED-ADJUSTED-OHLCV-ZERO-COST-SOURCE-DECISION" or contract["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("task or track changed")
    if contract["purpose"] != "Freeze the current zero-cost source decision for the completely empty consolidated-adjusted-OHLCV semantic across the sealed 44,352-row Q003 queue, distinguish a bounded private entitlement pilot from a full-universe acquisition route, and prevent venue-only, short-history, export-restricted or identity-incomplete data from being relabeled as confirmatory evidence.":
        fail("purpose changed")
    if contract["contractSha256"] != CONTRACT_SELF or sha(canonical({k: v for k, v in contract.items() if k != "contractSha256"})) != CONTRACT_SELF:
        fail("contract self hash changed")

    requirement = contract["consumerRequirement"]
    exact_keys(requirement, {
        "queueRows", "studyWindowStart", "studyWindowEnd", "semantic", "requiredFields",
        "requiresPermanentSecurityOrListingKey", "requiresThenListedPopulationCoverage",
        "requiresTerminalAndDelistedTreatment", "providerRowsMayRemainPrivate",
        "publicRedistributionNotRequired", "currentPartialEvidenceRows", "currentResolvedRows",
    }, "consumerRequirement")
    if requirement["queueRows"] != 44352 or requirement["studyWindowStart"] != "2009-01-01" or requirement["studyWindowEnd"] != "2024-12-31":
        fail("population or study window changed")
    if requirement["semantic"] != "CONSOLIDATED_ADJUSTED_OHLCV" or requirement["currentPartialEvidenceRows"] != 0 or requirement["currentResolvedRows"] != 0:
        fail("OHLCV semantic or empty baseline changed")
    if any(requirement[key] is not True for key in (
        "requiresPermanentSecurityOrListingKey", "requiresThenListedPopulationCoverage",
        "requiresTerminalAndDelistedTreatment", "providerRowsMayRemainPrivate", "publicRedistributionNotRequired",
    )):
        fail("consumer requirement weakened")
    if requirement["requiredFields"] != [
        "date", "open", "high", "low", "close", "volume", "adjustedOpen", "adjustedHigh",
        "adjustedLow", "adjustedClose", "adjustedVolume", "dividend", "splitFactor",
    ]:
        fail("required OHLCV fields changed")

    inputs = contract["authoritativeInputs"]
    if set(inputs) != set(INPUTS):
        fail("authoritative input set changed")
    for name, (path, digest) in INPUTS.items():
        row = inputs[name]
        exact_keys(row, INPUT_KEYSETS[name], f"authoritativeInputs.{name}")
        if row != {"path": path, "rawSha256": digest, **INPUT_EXTRAS[name]}:
            fail(f"{name} binding changed")
        if dependencies and sha((ROOT / path).read_bytes()) != digest:
            fail(f"{name} raw bytes changed")
    ledger = json.loads((ROOT / INPUTS["coverageLedger"][0]).read_bytes()) if dependencies else None
    if ledger is not None:
        semantic = ledger["coverage"]["semanticCoverage"]["CONSOLIDATED_ADJUSTED_OHLCV"]
        if semantic["partialEvidenceRows"] != 0 or semantic["resolvedRows"] != 0 or semantic["unresolvedRows"] != 44352:
            fail("coverage ledger no longer establishes empty OHLCV semantic")

    rechecks = contract["officialRechecks"]
    if rechecks != OFFICIAL_RECHECKS:
        fail("official recheck evidence changed")
    for row in rechecks:
        exact_keys(row, {"sourceId", "url", "observedAt", "verifiedFact"}, "officialRecheck")
        if not row["url"].startswith("https://") or parse_time(row["observedAt"]) > datetime.now(timezone.utc) or not row["verifiedFact"]:
            fail("official recheck malformed")

    dispositions = contract["sourceDispositions"]
    if dispositions != SOURCE_DISPOSITIONS:
        fail("source dispositions changed")
    for row in dispositions:
        exact_keys(row, {"sourceGroup", "disposition", "canMaterializePublicEvidenceRows", "canRunBoundedPrivatePilot", "fullUniverseConfirmatoryEligible"}, "sourceDisposition")
        if row["canMaterializePublicEvidenceRows"] is not False or row["fullUniverseConfirmatoryEligible"] is not False:
            fail("unqualified source promoted")
    if dispositions[1]["canRunBoundedPrivatePilot"] is not True or dispositions[1]["disposition"] != "ALLOW_THREE_CASE_PRIVATE_ENTITLEMENT_PILOT_AFTER_ACCOUNT_GATE":
        fail("Tiingo bounded pilot boundary changed")

    checks = contract["independentBlockerChecks"]
    if checks != BLOCKER_CHECKS:
        fail("three independent blocker checks changed")
    for row in checks:
        exact_keys(row, {"checkId", "status", "mechanism", "whatWouldClear"}, "blockerCheck")
        if row["status"] != "BLOCKED" or not row["mechanism"] or not row["whatWouldClear"]:
            fail("blocker check weakened")

    decision = contract["decision"]
    exact_keys(decision, {
        "status", "consolidatedAdjustedOhlcvResolved", "fullUniverseAcquisitionAuthorized",
        "tiingoThreeCasePilotEligibleAfterAccountGate", "tiingoFullUniverseEligible",
        "researchArchiveDiscoveryMayContinue", "recentOrVenueSpecificSensitivityMayContinue",
        "paidFallbackAuthorized", "nextAutonomousAction",
    }, "decision")
    if decision != DECISION:
        fail("decision changed")
    if decision["tiingoThreeCasePilotEligibleAfterAccountGate"] is not True or decision["researchArchiveDiscoveryMayContinue"] is not True or decision["recentOrVenueSpecificSensitivityMayContinue"] is not True:
        fail("allowed bounded continuation changed")
    for key in ("consolidatedAdjustedOhlcvResolved", "fullUniverseAcquisitionAuthorized", "tiingoFullUniverseEligible", "paidFallbackAuthorized"):
        if decision[key] is not False:
            fail(f"{key} falsely opened")

    exact_keys(contract["claimLocks"], LOCK_KEYS, "claimLocks")
    if any(value is not False for value in contract["claimLocks"].values()):
        fail("claim lock opened")

    implementation = contract["implementationContract"]
    exact_keys(implementation, {
        "baseCommit", "remote", "ref", "contractPath", "verifierPath", "testPath",
        "verifierNormalizedSha256", "testNormalizedSha256",
        "introductionMustBeDirectSingleParentChildOfBase", "introductionAddsExactlyThreeOwnedPaths",
        "laterLinearSingleParentDescendantsAllowed", "remoteVerificationRequired", "noRemoteVerificationMustFail",
    }, "implementationContract")
    expected_paths = [path.relative_to(ROOT).as_posix() for path in OWNED]
    if implementation["baseCommit"] != BASE or implementation["remote"] != REMOTE or implementation["ref"] != REMOTE_REF:
        fail("Git base, remote or ref changed")
    if [implementation["contractPath"], implementation["verifierPath"], implementation["testPath"]] != expected_paths:
        fail("owned paths changed")
    if implementation["verifierNormalizedSha256"] != VERIFIER_NORMALIZED or implementation["testNormalizedSha256"] != TEST_NORMALIZED:
        fail("implementation normalized hashes changed")
    for key in ("introductionMustBeDirectSingleParentChildOfBase", "introductionAddsExactlyThreeOwnedPaths", "laterLinearSingleParentDescendantsAllowed", "remoteVerificationRequired", "noRemoteVerificationMustFail"):
        if implementation[key] is not True:
            fail(f"{key} weakened")


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    validate_contract(value)
    if sha(normalized_verifier(VERIFIER.read_bytes())) != VERIFIER_NORMALIZED:
        fail("verifier normalized bytes changed")
    if sha(normalized_test(TEST.read_bytes())) != TEST_NORMALIZED:
        fail("test normalized bytes changed")
    return value


def verify_git_remote() -> dict[str, Any]:
    if git("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    head = git("rev-parse", "HEAD")
    upstream = git("rev-parse", "@{u}")
    remote_lines = git("ls-remote", "origin", REMOTE_REF).splitlines()
    if len(remote_lines) != 1:
        fail("live remote ref missing or ambiguous")
    live = remote_lines[0].split()[0]
    if head != upstream or head != live:
        fail("HEAD, upstream and live remote differ")
    if subprocess.run(["git", "merge-base", "--is-ancestor", BASE, head], cwd=ROOT).returncode:
        fail("base is not an ancestor of HEAD")
    introductions = [introduction_for(path) for path in OWNED]
    if introductions == [[], [], []]:
        if head != BASE:
            fail("pre-introduction phase moved beyond sealed base")
        return {"phase": "PRE_INTRODUCTION", "introductionCommit": None, "head": head}
    if any(len(items) != 1 for items in introductions) or len({items[0] for items in introductions}) != 1:
        fail("owned files do not share one introduction commit")
    intro = introductions[0][0]
    parents = git("show", "-s", "--format=%P", intro).split()
    if parents != [BASE]:
        fail("introduction is not the direct single-parent child of base")
    expected_changes = [("A", path.relative_to(ROOT).as_posix()) for path in OWNED]
    if changed_paths(intro) != expected_changes:
        fail("introduction does not add exactly the three owned paths")
    first_parent = git("rev-list", "--first-parent", f"{intro}..{head}").splitlines()
    for commit in first_parent:
        if len(git("show", "-s", "--format=%P", commit).split()) != 1:
            fail("later history is not linear single-parent")
    for path in OWNED:
        if git_raw(head, path) != path.read_bytes():
            fail(f"working tree differs from HEAD for {path.name}")
        if git_raw(intro, path) != path.read_bytes():
            fail(f"owned bytes drifted after introduction for {path.name}")
    return {"phase": "POST_INTRODUCTION", "introductionCommit": intro, "head": head}


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (DecisionError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test() -> dict[str, Any]:
    source = load_contract()
    mutations: dict[str, dict[str, Any]] = {}
    cases = [
        ("purposeOverclaim", ("purpose",), "FULL MARKET TERMINAL RETURNS COMPLETE"),
        ("queueShrunk", ("consumerRequirement", "queueRows"), 500),
        ("windowShortened", ("consumerRequirement", "studyWindowStart"), "2016-01-01"),
        ("identityRequirementRemoved", ("consumerRequirement", "requiresPermanentSecurityOrListingKey"), False),
        ("ohlcvPartialInvented", ("consumerRequirement", "currentPartialEvidenceRows"), 1),
        ("quantConnectPromoted", ("sourceDispositions", 0, "fullUniverseConfirmatoryEligible"), True),
        ("quantConnectRelabeled", ("sourceDispositions", 0, "disposition"), "ALLOW_FULL_MARKET"),
        ("tiingoPublicRows", ("sourceDispositions", 1, "canMaterializePublicEvidenceRows"), True),
        ("tiingoFullUniverse", ("decision", "tiingoFullUniverseEligible"), True),
        ("alphaPilot", ("sourceDispositions", 2, "canRunBoundedPrivatePilot"), True),
        ("archivePromoted", ("sourceDispositions", 6, "fullUniverseConfirmatoryEligible"), True),
        ("blockerRemoved", ("independentBlockerChecks",), source["independentBlockerChecks"][:2]),
        ("blockerCleared", ("independentBlockerChecks", 0, "status"), "PASS"),
        ("blockerMechanismWeakened", ("independentBlockerChecks", 1, "mechanism"), "No material limitation."),
        ("resolved", ("decision", "consolidatedAdjustedOhlcvResolved"), True),
        ("acquisitionAuthorized", ("decision", "fullUniverseAcquisitionAuthorized"), True),
        ("paidAuthorized", ("decision", "paidFallbackAuthorized"), True),
        ("pricesOpened", ("claimLocks", "pricesAccessed"), True),
        ("outcomesOpened", ("claimLocks", "outcomesAccessed"), True),
        ("v4Credit", ("claimLocks", "originalV4GateCredit"), True),
        ("inputPathRedirect", ("authoritativeInputs", "coverageLedger", "path"), "reports/other.json"),
        ("nestedInputCredit", ("authoritativeInputs", "coverageLedger", "originalV4GateCredit"), True),
        ("nestedInputSelfDrift", ("authoritativeInputs", "coverageLedger", "reportSha256"), "0" * 64),
        ("officialFactOverclaim", ("officialRechecks", 2, "verifiedFact"), "Tiingo covers the full population with permanent identity."),
        ("remoteRedirect", ("implementationContract", "remote"), "https://example.invalid/repo.git"),
        ("topologyWeakened", ("implementationContract", "introductionAddsExactlyThreeOwnedPaths"), False),
        ("createdAtBackdated", ("createdAt",), "1970-01-01T00:00:00Z"),
        ("createdAtNonZulu", ("createdAt",), "2026-08-13T09:38:03+00:00"),
        ("unknownCredit", ("claimLocks", "unknownScientificCredit"), True),
    ]
    for name, path, value in cases:
        item = copy.deepcopy(source)
        target: Any = item
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value
        mutations[name] = item
    kills = {name: rejected(lambda item=item: validate_contract(item, dependencies=False)) for name, item in mutations.items()}
    if not all(kills.values()):
        fail("one or more mutation kills failed")
    return {
        "status": "PASS",
        "mutationKills": kills,
        "mutationKillCount": len(kills),
        "independentBlockerChecks": 3,
        "pricesAccessed": False,
        "returnsAccessed": False,
        "outcomesAccessed": False,
        "networkRequests": 0,
        "filesWritten": 0,
    }


def verify(remote: bool) -> dict[str, Any]:
    if not remote:
        fail("verify requires --remote")
    contract = load_contract()
    topology = verify_git_remote()
    return {
        "status": "PASS",
        **topology,
        "remoteVerified": True,
        "sourceGroupsReviewed": len(contract["sourceDispositions"]),
        "independentBlockerChecks": len(contract["independentBlockerChecks"]),
        "decision": contract["decision"]["status"],
        "tiingoThreeCasePilotEligibleAfterAccountGate": True,
        "fullUniverseAcquisitionAuthorized": False,
        "consolidatedAdjustedOhlcvResolved": False,
        "pricesAccessed": False,
        "returnsAccessed": False,
        "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        result = self_test() if args.command == "self-test" else verify(args.remote)
    except (DecisionError, OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
