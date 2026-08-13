#!/usr/bin/env python3
"""Prospective Q010 subchunk governance verifier; never reads research or outcomes."""

from __future__ import annotations

import argparse
import ast
import copy
from datetime import datetime
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research/early-detection-v4/q010-subchunk-governance-contract-v1.json"
EVENTS_PATH = ROOT / "state/early-detection-q010-subchunk-events-v1.jsonl"
STATE_PATH = ROOT / "state/early-detection-q010-subchunk-state-v1.json"
TEST_PATH = ROOT / "tests/early-detection-q010-subchunk-v1.test.js"
CONTROLLER_PATH = Path(__file__).resolve()
EXPECTED_CONTRACT_RAW_SHA256 = "88505d8160ebce8c27fdcc3e1e88042753ddb420d9b065bde16adbfc8b219b86"
EXPECTED_CONTROLLER_NORMALIZED_SHA256 = "9094dcdf861b85616c37c7f8b452bed93665775e6431ff5ac9ff264c0763d33a"
EXPECTED_EVENTS_RAW_SHA256 = "e5889ff53ca3a1b47d3d1de65cec1620309bb473efad6888f040cbbdb3e2ef1d"
EXPECTED_STATE_RAW_SHA256 = "c49057457b5f685e61fddf6bb334caebe38d31a14cd1a2c8369850c5f78d8f7e"
EXPECTED_TEST_RAW_SHA256 = "48b5c2ece08e1cb643e3e4e6b2a453216ef1e43ec9aa594461ad7b6c04776bd8"


class GateError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise GateError(message)


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_path(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def controller_normalized_sha256() -> str:
    text = CONTROLLER_PATH.read_text(encoding="utf-8")
    for name in (
        "EXPECTED_CONTRACT_RAW_SHA256",
        "EXPECTED_CONTROLLER_NORMALIZED_SHA256",
        "EXPECTED_EVENTS_RAW_SHA256",
        "EXPECTED_STATE_RAW_SHA256",
        "EXPECTED_TEST_RAW_SHA256",
    ):
        text = re.sub(rf'{name} = "[^"]+"', f'{name} = "' + ("0" * 64) + '"', text)
    return sha256_bytes(text.encode("utf-8"))


def contract_self_sha256(contract: dict) -> str:
    obj = copy.deepcopy(contract)
    obj["contractSelfSha256"] = None
    return sha256_bytes(canonical(obj))


def event_self_sha256(event: dict) -> str:
    obj = copy.deepcopy(event)
    obj.pop("eventSha256", None)
    return sha256_bytes(canonical(obj))


def state_self_sha256(state: dict) -> str:
    obj = copy.deepcopy(state)
    obj["stateSelfSha256"] = None
    return sha256_bytes(canonical(obj))


def read_contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def read_events() -> list[dict]:
    lines = [line for line in EVENTS_PATH.read_text(encoding="utf-8").splitlines() if line]
    return [json.loads(line) for line in lines]


def read_state() -> dict:
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def expected_projection(contract: dict, event: dict) -> dict:
    d = contract["decision"]
    return {
        "schema": "early-detection-q010-subchunk-projection/v1",
        "subchunkId": d["subchunkId"],
        "targetEntityOrFrozenPopulationId": d["targetEntityOrFrozenPopulationId"],
        "targetThemeOrThemeEraId": d["targetThemeOrThemeEraId"],
        "targetDimensions": d["targetDimensions"],
        "decisionRecorded": True,
        "decisionEventId": event["eventId"],
        "decisionEventSequence": event["sequence"],
        "preChunkTimingClaimRecorded": True,
        "preChunkTimingVerified": False,
        "prospectiveRemoteIntroductionVerified": False,
        "workStarted": False,
        "workStartedAt": None,
        "startAuthorized": False,
        "separateAppendOnlyStartEventRequired": True,
        "researchSourceAccessAuthorized": False,
        "pricesReturnsOutcomesAccessed": False,
        "candidateStateComputationAllowed": False,
        "scientificCredit": "NONE",
        "parentV23Commit": contract["repository"]["baseCommit"],
        "parentV23DecisionEventId": contract["parentV23Binding"]["decisionSourceEventId"],
        "v23TaskLevelAuthorizationCannotAuthorizeConcreteSubchunkStart": True,
    }


def expected_state(contract: dict, event: dict) -> dict:
    state = {
        "schema": "early-detection-q010-subchunk-state/v1",
        "materializedAt": event["createdAt"],
        "contractSelfSha256": contract["contractSelfSha256"],
        "eventCount": 1,
        "eventHeadSha256": event["eventSha256"],
        "projection": expected_projection(contract, event),
        "stateSelfSha256": None,
    }
    state["stateSelfSha256"] = state_self_sha256(state)
    return state


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def validate_decision(contract: dict) -> None:
    d = contract["decision"]
    expected = {
        "subchunkId": "Q010-SC-001-CA-DMV-AV-2015-CENSUS-TEL",
        "targetEntityOrFrozenPopulationId": "POP-CA-DMV-AV-PERMIT-HOLDERS-2015-FULL-CENSUS",
        "targetThemeOrThemeEraId": "THEME-CA-AUTONOMOUS-VEHICLE-PUBLIC-ROAD-TESTING-2014-2016",
        "targetDimensions": ["T", "E", "L"],
        "namedCoverageGate": "FIRST_FULL_PRIMARY_SOURCE_TO_TEL_EVIDENCE_PIPELINE_WITH_FROZEN_CENSUS",
        "scientificCredit": "NONE",
        "decisionRecordedAt": "2026-08-13T20:53:30Z",
        "preChunkTimingVerified": True,
        "workStarted": False,
        "workStartedAt": None,
        "workMayStartAfter": "REMOTE_INTRODUCTION_OF_DECISION_AND_SEPARATE_APPEND_ONLY_START_EVENT",
        "decisionSourceEventId": "Q010-EVT-00000001",
        "decisionSourceEventSequence": 1,
        "parentDecisionSourceEventId": "EVT-00000011",
        "equalResearchBudgetRequired": True,
        "secondarySourcesMayLocateButCannotSetTEL": True,
        "sourceCutoffInclusiveUtc": "2020-12-31T23:59:59Z",
        "developmentPilotOnly": True,
        "frozenControlPopulationId": "POP-SEC-DOMESTIC-LISTED-SIC-3711-3674-7372-NON-DMV-2015-CONTROLS",
        "researchBudgetPolicyId": "Q010-SC-001-EQUAL-BUDGET-V1",
    }
    for key, value in expected.items():
        require(d.get(key) == value, f"decision drift: {key}")
    require(d["coherentTELAssemblyContribution"] == "Build the first full official-census source-to-PIT-identity-to-T/E/L pipeline with equal source budget across the frozen population, advancing one coherent entity-theme capsule or typed HOLD without company cherry-picking.", "coherent contribution drift")
    require(d["continuationCriterion"] == "CONTINUE_ONLY_UNTIL_THE_OFFICIAL_DMV_PERMIT_HOLDER_AND_2015_DISENGAGEMENT_PRIMARY_PAYLOAD_CENSUS_IS_FROZEN_AND_HASH_BOUND_SOURCE_AVAILABILITY_IS_MAPPED_EQUAL_BUDGET_PIT_IDENTITY_IS_ATTEMPTED_FOR_EVERY_THEN_LISTED_DOMESTIC_ISSUER_AND_THE_FIRST_ACCEPTED_T_E_L_BUNDLE_OR_TYPED_HOLD_EXISTS_WITHOUT_CANDIDATE_STATE_OR_SCIENTIFIC_CLAIM", "continuation drift")
    require(d["pauseOrStopCriterion"] == "PAUSE_IF_EXACT_CONSERVATIVE_AVAILABILITY_CANNOT_BE_MAPPED_PRIMARY_PAYLOADS_ARE_UNAVAILABLE_CENSUS_SCOPE_IS_AMBIGUOUS_ANY_PRICE_RETURN_OR_OUTCOME_ACCESS_IS_NEEDED_ANY_SINGLE_DIMENSION_OUTGROWS_THE_OTHERS_AFTER_EQUAL_BUDGET_OR_CONTROL_BALANCE_REQUIRES_OUTCOME_KNOWLEDGE_STOP_AFTER_ONE_VERIFIED_BUNDLE_OR_TYPED_HOLD", "pause/stop drift")
    require(d["populationSelectionRule"] == "Use the complete official California DMV permit-holder census and complete 2015 disengagement-report submission census; never select an individual company from later fame, price, GQS, survival or outcome knowledge.", "population census drift")
    require(len(d["targetDimensions"]) == len(set(d["targetDimensions"])) == 3, "dimensions not unique/full")


def validate_repository(contract: dict) -> None:
    repo = contract["repository"]
    require(repo == {
        "worktree": r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\worktrees\form25-v2-promotion-20260812",
        "branch": "codex/form25-v2-promotion-20260812",
        "remoteUrl": "https://github.com/Karlryl/screener-data.git",
        "remoteRef": "refs/heads/codex/early-detection-v4-gates-20260810",
        "baseCommit": "ba90828892932147c93afe2040498116982bd416",
        "baseCommitCommittedAt": "2026-08-13T20:37:18Z",
        "expectedIntroductionSubject": "Tag 912: Q010-Subchunk vor Arbeitsbeginn versiegeln",
        "expectedIntroductionPaths": [
            "research/early-detection-v4/q010-subchunk-governance-contract-v1.json",
            "scripts/early-detection-q010-subchunk-v1.py",
            "state/early-detection-q010-subchunk-events-v1.jsonl",
            "state/early-detection-q010-subchunk-state-v1.json",
            "tests/early-detection-q010-subchunk-v1.test.js",
        ],
        "introductionMustBeExactDirectChild": True,
        "expectedStartSubject": "Tag 913: Q010-Subchunk prospektiv starten",
        "expectedStartPaths": [
            "research/early-detection-v4/q010-subchunk-governance-contract-v1.json",
            "scripts/early-detection-q010-subchunk-v1.py",
            "state/early-detection-q010-subchunk-events-v1.jsonl",
            "state/early-detection-q010-subchunk-state-v1.json",
            "tests/early-detection-q010-subchunk-v1.test.js",
        ],
        "startIntroductionMustBeExactDirectChildOfDecisionIntroduction": True,
    }, "repository binding drift")
    require(datetime.fromisoformat(contract["decision"]["decisionRecordedAt"].replace("Z", "+00:00")) > datetime.fromisoformat(repo["baseCommitCommittedAt"].replace("Z", "+00:00")), "decision not after Tag911")


def validate_process_surface() -> None:
    tree = ast.parse(CONTROLLER_PATH.read_text(encoding="utf-8"))
    subprocess_attrs = [node for node in ast.walk(tree) if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "subprocess"]
    require(len(subprocess_attrs) == 2, "subprocess surface count drift")
    require(sorted(node.attr for node in subprocess_attrs) == ["TimeoutExpired", "run"], "non-git subprocess surface introduced")
    require(not any(isinstance(node, ast.ImportFrom) and node.module == "subprocess" for node in ast.walk(tree)), "subprocess alias import forbidden")


def validate_parent_v23(contract: dict, check_files: bool = True) -> None:
    p = contract["parentV23Binding"]
    require(p["introductionCommit"] == contract["repository"]["baseCommit"], "parent commit drift")
    require(p["decisionSourceEventId"] == "EVT-00000011", "parent event drift")
    if check_files:
        for name in ("contract", "controller", "events", "state", "test"):
            path = ROOT / p[f"{name}Path"]
            require(sha256_path(path) == p[f"{name}RawSha256"], f"V23 {name} byte drift")
        v23_state = json.loads((ROOT / p["statePath"]).read_text(encoding="utf-8"))
        projection = v23_state["operationalProjection"]
        require(projection["scheduler"]["nextTaskId"] == p["requiredNextTaskId"], "V23 next task drift")
        require(projection["scientificLocks"]["earlyDetectionSystemBuilt"] is p["requiredEarlyDetectionSystemBuilt"], "V23 build lock drift")
        require(projection["scientificLocks"]["outcomesAccessed"] is p["requiredOutcomesAccessed"], "V23 outcome lock drift")
        broad = projection["workChunkDecisions"]["next"]
        require(broad["targetQueueTaskId"] == p["requiredNextTaskId"], "V23 broad authority task drift")
        require(broad["chunkId"] == "Q010-PRE2021-OUTCOME-BLIND-THEME-BENEFICIARY-OPERATIONS-CORPUS", "V23 broad authority identity drift")
        require("researchSourceAccessAuthorized" not in broad and "subchunkId" not in broad, "V23 broad authority illegally authorizes concrete source work")


def validate_future_start_contract(contract: dict) -> None:
    authority = contract["authorityPolicy"]
    require(authority == {
        "singleConcreteSubchunkAuthority": "scripts/early-detection-q010-subchunk-v1.py",
        "v23TaskLevelAuthorizationCannotAuthorizeConcreteSubchunkStart": True,
        "v23NextMayAuthorizeGovernanceSetupOnly": True,
        "concreteSourceWorkRequiresPostIntroductionStartEvent": "Q010-EVT-00000002",
        "everyNextOrStartSurfaceMustReturnFalseBeforeStartEventRemoteIntroduction": True,
    }, "concrete start authority drift")
    require(contract["startEventContract"] == {
        "schema": "early-detection-q010-subchunk-start-event-contract/v1",
        "eventId": "Q010-EVT-00000002",
        "sequence": 2,
        "eventType": "SUBCHUNK_WORK_STARTED",
        "previousEventSha256Rule": "MUST_EQUAL_COMPUTED_EVENT_1_SHA256",
        "createdAtRule": "EXACT_TIMEZONE_QUALIFIED_AND_STRICTLY_AFTER_DECISION_RECORDED_AT",
        "workStartedAtRule": "MUST_EQUAL_EVENT_CREATED_AT",
        "requiredPayload": {
            "subchunkId": "Q010-SC-001-CA-DMV-AV-2015-CENSUS-TEL",
            "decisionEventId": "Q010-EVT-00000001",
            "decisionEventSequence": 1,
            "targetEntityOrFrozenPopulationId": "POP-CA-DMV-AV-PERMIT-HOLDERS-2015-FULL-CENSUS",
            "targetThemeOrThemeEraId": "THEME-CA-AUTONOMOUS-VEHICLE-PUBLIC-ROAD-TESTING-2014-2016",
            "targetDimensions": ["T", "E", "L"],
            "workStarted": True,
            "startAuthorized": True,
            "researchSourceAccessAuthorized": True,
            "pricesAccessed": False,
            "returnsAccessed": False,
            "outcomesAccessed": False,
            "candidateStateComputationAllowed": False,
            "scientificCredit": "NONE",
        },
        "remoteIntroduction": {
            "requiredParent": "TAG912_DECISION_INTRODUCTION_COMMIT",
            "requiredSubject": "Tag 913: Q010-Subchunk prospektiv starten",
            "requiredPathStatuses": "EXACTLY_FIVE_M_PATHS_MATCHING_REPOSITORY_EXPECTED_START_PATHS",
            "localBytesMustEqualIntroducedGitBlobs": True,
            "headUpstreamAndLiveRemoteMustMatch": True,
        },
    }, "future start event contract drift")


def validate_population_budget(contract: dict) -> None:
    policy = contract["populationAndBudgetPolicy"]
    require(policy["schema"] == "early-detection-q010-frozen-population-equal-budget/v1", "population policy schema drift")
    require(policy["treatmentPopulationId"] == contract["decision"]["targetEntityOrFrozenPopulationId"], "treatment population drift")
    require(policy["controlPopulationId"] == contract["decision"]["frozenControlPopulationId"], "control population drift")
    require(policy["treatmentSelectionRule"] == "Every entity in the complete official California DMV permit-holder census or complete 2015 disengagement submission census; no entity may be omitted based on later knowledge.", "treatment census rule drift")
    require(policy["controlSelectionRule"] == "Every domestic operating issuer with exactly one effective NYSE Nasdaq or NYSE-American common-equity listing at 2015-12-31T23:59:59Z, contemporaneous SEC SIC 3711 3674 or 7372, and no match in the frozen DMV census; unresolved identity or listing is REJECTED_HOLD.", "control census rule drift")
    require(policy["controlMatchInputsAllowed"] == ["CONTEMPORANEOUS_SEC_SIC", "AS_FILED_TOTAL_ASSETS", "AS_FILED_REVENUE"], "control inputs drift")
    require(policy["controlMatchInputsForbidden"] == ["PRICE", "RETURN", "FUTURE_GQS", "SURVIVAL", "DELISTING", "OUTCOME_LABEL"], "forbidden control inputs drift")
    require(policy["retainLaterDeadAcquiredBankruptOrDelistedEntitiesWithoutViewingLabels"] is True, "failure retention drift")
    require(policy["winnerFailureBalanceStatus"] == "PENDING_SEALED_OUTCOME_STAGE_NOT_ASSERTED_OR_VIEWED_IN_Q010", "outcome balance truth drift")
    require(policy["candidateOrScientificCreditBlockedUntilBalanceAndHumanCodingGates"] is True, "credit gate drift")
    require(policy["budgetUnit"] == "POPULATION_ROW_BY_DIMENSION", "budget unit drift")
    require(policy["maxPrimaryLocatorQueriesPerPopulationRowPerDimension"] == 3, "query budget drift")
    require(policy["maxAcceptedPrimaryPayloadsPerPopulationRowPerDimension"] == 2, "payload budget drift")
    require(policy["maxResearchMinutesPerPopulationRowPerDimension"] == 20, "time budget drift")
    require(policy["sharedThemeTPayloadLimit"] == 3, "theme budget drift")
    require(policy["everyPopulationRowMustAttemptDimensions"] == ["T", "E", "L"], "T/E/L attempt drift")
    require(policy["sameBudgetForTreatmentAndControls"] is True and policy["sameSourceClassPriorityForTreatmentAndControls"] is True, "arm budget drift")
    require(policy["acceptedPrimaryPayloadCountDifferenceBetweenEAndLMaximum"] == 1, "E/L balance drift")
    require(policy["singleDimensionExpansionBeyondBudgetForbidden"] is True, "dimension expansion drift")
    require(policy["secondaryLocatorQueriesDoNotCreateTELCredit"] is True and policy["scientificCredit"] == "NONE", "secondary/credit drift")


def validate_bundle(contract: dict, events: list[dict], state: dict, check_files: bool = True) -> None:
    require(contract["schema"] == "early-detection-q010-subchunk-governance-contract/v1", "contract schema drift")
    require(contract_self_sha256(contract) == contract["contractSelfSha256"], "contract self hash drift")
    require(contract["createdAt"] == contract["decision"]["decisionRecordedAt"], "contract/decision time drift")
    validate_repository(contract)
    validate_decision(contract)
    validate_parent_v23(contract, check_files=check_files)
    validate_future_start_contract(contract)
    validate_population_budget(contract)
    policy = contract["phasePolicy"]
    require(policy == {
        "preIntroductionVerifyIsDiagnosticOnly": True,
        "postIntroductionDecisionRecorded": True,
        "postIntroductionStartAuthorized": False,
        "separateAppendOnlyStartEventRequired": True,
        "researchSourceAccessBeforeStartEventForbidden": True,
        "pricesReturnsOutcomesForbidden": True,
        "candidateStateComputationForbidden": True,
        "scientificCredit": "NONE",
    }, "phase policy drift")
    require(len(events) == 1, "exactly one pre-start event required")
    event = events[0]
    require(event["sequence"] == 1 and event["eventId"] == "Q010-EVT-00000001", "event identity drift")
    require(event["eventType"] == "SUBCHUNK_DECISION_RECORDED", "event type drift")
    require(event["previousEventSha256"] is None, "first event predecessor must be null")
    require(event["createdAt"] == contract["decision"]["decisionRecordedAt"], "decision timestamp drift")
    require(event["contractSelfSha256"] == contract["contractSelfSha256"], "event contract binding drift")
    require(event_self_sha256(event) == event["eventSha256"], "event self hash drift")
    require(event["payload"] == {
        "decisionSourceEventSequence": 1,
        "preChunkTimingVerified": True,
        "scientificCredit": "NONE",
        "subchunkId": contract["decision"]["subchunkId"],
        "workStarted": False,
        "workStartedAt": None,
    }, "event payload drift")
    require(state == expected_state(contract, event), "event to state replay drift")
    if check_files:
        validate_process_surface()
        require(sha256_path(CONTRACT_PATH) == EXPECTED_CONTRACT_RAW_SHA256, "contract raw hash drift")
        require(controller_normalized_sha256() == EXPECTED_CONTROLLER_NORMALIZED_SHA256, "controller normalized hash drift")
        require(sha256_path(EVENTS_PATH) == EXPECTED_EVENTS_RAW_SHA256, "events raw hash drift")
        require(sha256_path(STATE_PATH) == EXPECTED_STATE_RAW_SHA256, "state raw hash drift")
        require(sha256_path(TEST_PATH) == EXPECTED_TEST_RAW_SHA256, "test raw hash drift")
        require(contract["implementation"]["controllerNormalizedSha256"] == EXPECTED_CONTROLLER_NORMALIZED_SHA256, "contract controller binding drift")
        require(contract["implementation"]["testRawSha256"] == EXPECTED_TEST_RAW_SHA256, "test byte binding drift")
        require(contract["implementation"]["controllerChildExecutionsRequired"] == 0, "controller execution lock drift")
        require(contract["implementation"]["onlyEncapsulatedGitProcessSurfaceAllowed"] is True, "process surface lock drift")
        require(contract["implementation"]["eventsRawSha256PinnedByController"] is True, "events raw pin drift")
        require(contract["implementation"]["stateRawSha256PinnedByController"] is True, "state raw pin drift")


def run_git(args: list[str]) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True, timeout=60)
    if result.returncode != 0:
        fail("git failed: " + " ".join(args) + ": " + result.stderr.strip())
    return result.stdout.strip()


def remote_phase(contract: dict) -> tuple[str, str | None]:
    repo = contract["repository"]
    require(run_git(["rev-parse", "--show-toplevel"]).replace("\\", "/") == str(ROOT).replace("\\", "/"), "wrong worktree")
    require(run_git(["branch", "--show-current"]) == repo["branch"], "wrong branch")
    require(run_git(["remote", "get-url", "origin"]) == repo["remoteUrl"], "origin URL drift")
    head = run_git(["rev-parse", "HEAD"])
    upstream = run_git(["rev-parse", "@{u}"])
    remote_line = run_git(["ls-remote", "origin", repo["remoteRef"]])
    remote = remote_line.split()[0] if remote_line else ""
    require(remote, "live remote ref missing")
    require(upstream == remote, "upstream/live remote mismatch")
    base_time = run_git(["show", "-s", "--format=%cI", repo["baseCommit"]])
    require(datetime.fromisoformat(base_time).astimezone().timestamp() == datetime.fromisoformat(repo["baseCommitCommittedAt"].replace("Z", "+00:00")).timestamp(), "base commit time drift")
    paths = repo["expectedIntroductionPaths"]
    if head == repo["baseCommit"] and remote == repo["baseCommit"]:
        status = run_git(["status", "--porcelain", "--", *paths]).splitlines()
        require(len(status) == len(paths), "pre-introduction owned path count drift")
        require(all(line.startswith("?? ") for line in status), "pre-introduction paths must be untracked")
        return "PRE_INTRODUCTION", None
    require(head == remote, "HEAD/live remote mismatch")
    require(run_git(["show", "-s", "--format=%P", "HEAD"]) == repo["baseCommit"], "introduction parent drift")
    require(run_git(["show", "-s", "--format=%s", "HEAD"]) == repo["expectedIntroductionSubject"], "introduction subject drift")
    delta = run_git(["diff-tree", "--no-commit-id", "--name-status", "-r", "HEAD"]).splitlines()
    actual = sorted(tuple(line.split("\t", 1)) for line in delta if line)
    expected = sorted(("A", path) for path in paths)
    require(actual == expected, "introduction path topology drift")
    require(not run_git(["status", "--porcelain", "--", *paths]), "post-introduction owned paths are dirty")
    for path in paths:
        local_oid = run_git(["hash-object", "--no-filters", path])
        introduced_oid = run_git(["rev-parse", f"HEAD:{path}"])
        require(local_oid == introduced_oid, f"introduced blob differs from local validated bytes: {path}")
    return "POST_INTRODUCTION", head


def verify(remote: bool) -> dict:
    require(remote, "--remote is mandatory")
    contract, events, state = read_contract(), read_events(), read_state()
    validate_bundle(contract, events, state, check_files=True)
    phase, commit = remote_phase(contract)
    return {
        "schema": "early-detection-q010-subchunk-verification/v1",
        "status": "PRE_INTRODUCTION_DIAGNOSTIC" if phase == "PRE_INTRODUCTION" else "PASS",
        "phase": phase,
        "introductionCommit": commit,
        "subchunkId": contract["decision"]["subchunkId"],
        "decisionRecorded": True,
        "preChunkTimingClaimRecorded": True,
        "preChunkTimingVerified": phase == "POST_INTRODUCTION",
        "prospectiveRemoteIntroductionVerified": phase == "POST_INTRODUCTION",
        "workStarted": False,
        "startAuthorized": False,
        "researchSourceAccessAuthorized": False,
        "scientificCredit": "NONE",
        "pricesReturnsOutcomesAccessed": False,
        "controllerChildExecutions": 0,
        "v23TaskLevelAuthorizationCannotAuthorizeConcreteSubchunkStart": True,
    }


def bootstrap(write: bool) -> dict:
    contract = read_contract()
    contract["implementation"]["controllerNormalizedSha256"] = controller_normalized_sha256()
    contract["implementation"]["testRawSha256"] = sha256_path(TEST_PATH)
    contract["contractSelfSha256"] = contract_self_sha256(contract)
    events = read_events()
    event = events[0]
    event["contractSelfSha256"] = contract["contractSelfSha256"]
    event["eventSha256"] = event_self_sha256(event)
    state = expected_state(contract, event)
    contract_raw = json.dumps(contract, ensure_ascii=False, indent=2) + "\n"
    event_raw = json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    state_raw = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    result = {
        "controllerNormalizedSha256": controller_normalized_sha256(),
        "contractRawSha256": sha256_bytes(contract_raw.encode("utf-8")),
        "contractSelfSha256": contract["contractSelfSha256"],
        "eventSha256": event["eventSha256"],
        "eventsRawSha256": sha256_bytes(event_raw.encode("utf-8")),
        "stateRawSha256": sha256_bytes(state_raw.encode("utf-8")),
        "stateSelfSha256": state["stateSelfSha256"],
        "projectionSha256": sha256_bytes(canonical(state["projection"])),
        "testRawSha256": contract["implementation"]["testRawSha256"],
    }
    if write:
        CONTRACT_PATH.write_text(contract_raw, encoding="utf-8", newline="\n")
        EVENTS_PATH.write_text(event_raw, encoding="utf-8", newline="\n")
        STATE_PATH.write_text(state_raw, encoding="utf-8", newline="\n")
    return result


def self_test() -> dict:
    contract, events, state = read_contract(), read_events(), read_state()
    validate_bundle(contract, events, state, check_files=True)
    attacks = []

    def rejected(name: str, mutate) -> None:
        c, e, s = copy.deepcopy(contract), copy.deepcopy(events), copy.deepcopy(state)
        mutate(c, e, s)
        try:
            validate_bundle(c, e, s, check_files=False)
        except GateError:
            attacks.append(name)
            return
        fail("mutation survived: " + name)

    rejected("target-population", lambda c, e, s: c["decision"].__setitem__("targetEntityOrFrozenPopulationId", "WINNERS_ONLY"))
    rejected("target-theme", lambda c, e, s: c["decision"].__setitem__("targetThemeOrThemeEraId", "MODERN_THEME"))
    rejected("dimension-drop", lambda c, e, s: c["decision"].__setitem__("targetDimensions", ["T", "E"]))
    rejected("dimension-duplicate", lambda c, e, s: c["decision"].__setitem__("targetDimensions", ["T", "E", "E"]))
    rejected("timing-false", lambda c, e, s: c["decision"].__setitem__("preChunkTimingVerified", False))
    rejected("work-started", lambda c, e, s: c["decision"].__setitem__("workStarted", True))
    rejected("work-start-time", lambda c, e, s: c["decision"].__setitem__("workStartedAt", c["createdAt"]))
    rejected("backdate", lambda c, e, s: c["decision"].__setitem__("decisionRecordedAt", "2026-08-12T00:00:00Z"))
    rejected("credit", lambda c, e, s: c["decision"].__setitem__("scientificCredit", "FULL"))
    rejected("continuation", lambda c, e, s: c["decision"].__setitem__("continuationCriterion", "CONTINUE_FOREVER"))
    rejected("stop", lambda c, e, s: c["decision"].__setitem__("pauseOrStopCriterion", "NEVER_STOP"))
    rejected("population-rule", lambda c, e, s: c["decision"].__setitem__("populationSelectionRule", "pick famous company"))
    rejected("coherent-contribution", lambda c, e, s: c["decision"].__setitem__("coherentTELAssemblyContribution", "collect documents"))
    rejected("source-before-start", lambda c, e, s: c["phasePolicy"].__setitem__("researchSourceAccessBeforeStartEventForbidden", False))
    rejected("start-authorized", lambda c, e, s: c["phasePolicy"].__setitem__("postIntroductionStartAuthorized", True))
    rejected("outcome-access", lambda c, e, s: c["phasePolicy"].__setitem__("pricesReturnsOutcomesForbidden", False))
    rejected("candidate-compute", lambda c, e, s: c["phasePolicy"].__setitem__("candidateStateComputationForbidden", False))
    rejected("parent-event", lambda c, e, s: c["parentV23Binding"].__setitem__("decisionSourceEventId", "EVT-00000010"))
    rejected("parent-hash", lambda c, e, s: c["parentV23Binding"].__setitem__("stateRawSha256", "0" * 64))
    rejected("repository-ref", lambda c, e, s: c["repository"].__setitem__("remoteRef", "refs/heads/main"))
    rejected("repository-path", lambda c, e, s: c["repository"]["expectedIntroductionPaths"].pop())
    rejected("base-time", lambda c, e, s: c["repository"].__setitem__("baseCommitCommittedAt", "2026-08-14T00:00:00Z"))
    rejected("broad-v23-authority", lambda c, e, s: c["authorityPolicy"].__setitem__("v23TaskLevelAuthorizationCannotAuthorizeConcreteSubchunkStart", False))
    rejected("future-start-event", lambda c, e, s: c["startEventContract"].__setitem__("eventId", "Q010-EVT-00000099"))
    rejected("future-start-outcome", lambda c, e, s: c["startEventContract"]["requiredPayload"].__setitem__("outcomesAccessed", True))
    rejected("control-population", lambda c, e, s: c["populationAndBudgetPolicy"].__setitem__("controlPopulationId", "HAND_PICKED"))
    rejected("budget-asymmetry", lambda c, e, s: c["populationAndBudgetPolicy"].__setitem__("sameBudgetForTreatmentAndControls", False))
    rejected("dimension-budget", lambda c, e, s: c["populationAndBudgetPolicy"].__setitem__("everyPopulationRowMustAttemptDimensions", ["T"]))
    rejected("event-type", lambda c, e, s: e[0].__setitem__("eventType", "WORK_STARTED"))
    rejected("event-sequence", lambda c, e, s: e[0].__setitem__("sequence", 2))
    rejected("event-hash", lambda c, e, s: e[0].__setitem__("eventSha256", "0" * 64))
    rejected("state-start", lambda c, e, s: s["projection"].__setitem__("startAuthorized", True))
    rejected("state-source", lambda c, e, s: s["projection"].__setitem__("researchSourceAccessAuthorized", True))
    rejected("state-replay", lambda c, e, s: s.__setitem__("eventCount", 2))
    require(len(attacks) == 34, "self-test kill count drift")
    return {"status": "PASS", "kills": len(attacks), "controllerChildExecutions": 0}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["bootstrap", "self-test", "verify", "start"])
    parser.add_argument("--remote", action="store_true")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "bootstrap":
            print(json.dumps(bootstrap(args.write), sort_keys=True))
            return 0
        if args.command == "self-test":
            print(json.dumps(self_test(), sort_keys=True))
            return 0
        result = verify(args.remote)
        if args.command == "start":
            fail("research start is not authorized; a separate remotely introduced append-only start event is required")
        print(json.dumps(result, sort_keys=True))
        return 0
    except (GateError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
