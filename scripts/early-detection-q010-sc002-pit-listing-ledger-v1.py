#!/usr/bin/env python3
"""Prospective SC002 PIT identity/listing governance; never reads research sources or outcomes."""

from __future__ import annotations

import argparse
import ast
import copy
from datetime import datetime, timezone
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research/early-detection-v4/q010-sc002-pit-listing-ledger-governance-contract-v1.json"
EVENTS_PATH = ROOT / "state/early-detection-q010-sc002-pit-listing-ledger-events-v1.jsonl"
STATE_PATH = ROOT / "state/early-detection-q010-sc002-pit-listing-ledger-state-v1.json"
TEST_PATH = ROOT / "tests/early-detection-q010-sc002-pit-listing-ledger-v1.test.js"
CONTROLLER_PATH = Path(__file__).resolve()
EXPECTED_CONTRACT_RAW_SHA256 = "69cce63da4965a8c90c1ef6d21ae87e16159f53d7cca1b6e7be15c9950a2c211"
EXPECTED_CONTROLLER_NORMALIZED_SHA256 = "3b7542b1b6277513fd6d176ce9052eb161b381c3d67a12f9aa0bbaf3b50e3a45"
EXPECTED_EVENTS_RAW_SHA256 = "3550c5bbb1d386b74cd5a158c452cc82d529f6692b3161eeee6b70431ed16da9"
EXPECTED_STATE_RAW_SHA256 = "3c0827673da0519e970561f5364782d438afd4d863ffce202ad388417606956e"
EXPECTED_TEST_RAW_SHA256 = "f60f95897c3e67caeb9de25eb0d8bf007344d0442a563912f05e701079649fff"
EXPECTED_GOVERNANCE_PROJECTION_SHA256 = "d03956dfbe63f2ed9a59858aa1b83253f4edc41980cb02d2ccb8df3091243def"

GOVERNANCE_SECTION_KEYS = (
    "decision",
    "authorityPolicy",
    "targetPopulationPolicy",
    "identitySecurityListingSemantics",
    "sourcePolicy",
    "retrievalBudgetPolicy",
    "holdConflictPolicy",
    "controlPopulationPolicy",
    "prohibitedAccessPolicy",
    "stopAndOutputPolicy",
    "startEventContract",
    "phasePolicy",
    "sc001CarryForwardPolicy",
)


class GateError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise GateError(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_path(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical_sha(value: object) -> str:
    return sha256_bytes(canonical(value))


def frozen_governance_projection(contract: dict) -> dict:
    return {key: copy.deepcopy(contract[key]) for key in GOVERNANCE_SECTION_KEYS}


def frozen_governance_projection_sha256(contract: dict) -> str:
    return canonical_sha(frozen_governance_projection(contract))


def controller_normalized_sha256() -> str:
    text = CONTROLLER_PATH.read_text(encoding="utf-8")
    for name in (
        "EXPECTED_CONTRACT_RAW_SHA256",
        "EXPECTED_CONTROLLER_NORMALIZED_SHA256",
        "EXPECTED_EVENTS_RAW_SHA256",
        "EXPECTED_STATE_RAW_SHA256",
        "EXPECTED_TEST_RAW_SHA256",
        "EXPECTED_GOVERNANCE_PROJECTION_SHA256",
    ):
        text = re.sub(rf'{name} = "[^"]+"', f'{name} = "' + ("0" * 64) + '"', text)
    return sha256_bytes(text.encode("utf-8"))


def contract_self_sha256(contract: dict) -> str:
    obj = copy.deepcopy(contract)
    obj["contractSelfSha256"] = None
    return canonical_sha(obj)


def event_self_sha256(event: dict) -> str:
    obj = copy.deepcopy(event)
    obj.pop("eventSha256", None)
    return canonical_sha(obj)


def state_self_sha256(state: dict) -> str:
    obj = copy.deepcopy(state)
    obj["stateSelfSha256"] = None
    return canonical_sha(obj)


def read_contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def read_events() -> list[dict]:
    return [json.loads(line) for line in EVENTS_PATH.read_text(encoding="utf-8").splitlines() if line]


def read_state() -> dict:
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def decision_payload(contract: dict) -> dict:
    d = contract["decision"]
    return {
        "candidateStateComputationAllowed": False,
        "controlMatchingAllowed": False,
        "decisionSourceEventSequence": 3,
        "gqsAccessed": False,
        "outcomesAccessed": False,
        "preChunkTimingClaimRecorded": True,
        "pricesAccessed": False,
        "researchSourceAccessAuthorized": False,
        "returnsAccessed": False,
        "scientificCredit": "NONE",
        "frozenGovernanceProjectionSha256": contract["frozenGovernanceProjectionSha256"],
        "sc001ChunkStatus": "TYPED_HOLD_COMPLETED",
        "sc001IncidentId": "Q010-SC001-INCIDENT-0001",
        "sc001CandidateState": None,
        "sc001ScientificCredit": "NONE",
        "sc001BlindingRemediationStillRequired": True,
        "subchunkId": d["subchunkId"],
        "targetEntityOrFrozenPopulationId": d["targetEntityOrFrozenPopulationId"],
        "telCodingAllowed": False,
        "workStarted": False,
        "workStartedAt": None,
    }


def start_payload(contract: dict) -> dict:
    payload = copy.deepcopy(contract["startEventContract"]["requiredPayload"])
    binding = contract["decisionIntroductionBinding"]
    final = contract["startFinalization"]
    payload.update({
        "tag915Commit": binding["tag915Commit"],
        "tag915RemoteObservedAtUtc": binding["tag915RemoteObservedAtUtc"],
        "workStartedAt": final["workStartedAtUtc"],
        "prospectiveDecisionRemoteIntroductionVerified": True,
        "prospectiveStartRemoteIntroductionVerified": False,
        "firstResearchSourceRetrievedAtUtc": None,
        "frozenGovernanceProjectionSha256": contract["frozenGovernanceProjectionSha256"],
    })
    return payload


def expected_projection(contract: dict, events: list[dict]) -> dict:
    d = contract["decision"]
    decision_event = events[2]
    start_recorded = len(events) == 4
    start_event = events[3] if start_recorded else None
    return {
        "schema": "early-detection-q010-sc002-pit-listing-ledger-projection/v1",
        "subchunkId": d["subchunkId"],
        "targetEntityOrFrozenPopulationId": d["targetEntityOrFrozenPopulationId"],
        "targetThemeOrThemeEraId": d["targetThemeOrThemeEraId"],
        "targetDimensions": d["targetDimensions"],
        "treatmentPopulationId": d["targetTreatmentPopulationId"],
        "controlFrameId": d["targetControlFrameId"],
        "controlPopulationId": d["targetControlPopulationId"],
        "evaluationAtUtc": d["evaluationAtUtc"],
        "decisionRecorded": True,
        "decisionEventId": decision_event["eventId"],
        "decisionEventSequence": decision_event["sequence"],
        "preChunkTimingClaimRecorded": True,
        "preChunkTimingVerified": start_recorded,
        "prospectiveDecisionRemoteIntroductionVerified": start_recorded,
        "startEventRecorded": start_recorded,
        "startEventId": start_event["eventId"] if start_recorded else None,
        "startEventSequence": start_event["sequence"] if start_recorded else None,
        "sourceAccessAuthorizationClaimRecorded": start_recorded,
        "prospectiveStartRemoteIntroductionVerified": False,
        "workStarted": False,
        "workStartedAt": None,
        "startAuthorized": False,
        "researchSourceAccessAuthorized": False,
        "separateAppendOnlyStartEventRequired": True,
        "controlMatchingAllowed": False,
        "telCodingAllowed": False,
        "candidateStateComputationAllowed": False,
        "pricesAccessed": False,
        "returnsAccessed": False,
        "gqsAccessed": False,
        "outcomesAccessed": False,
        "scientificCredit": "NONE",
        "tag914Commit": contract["repository"]["baseCommit"],
        "tag915Commit": contract.get("decisionIntroductionBinding", {}).get("tag915Commit"),
        "tag914NextQ010SubchunkAuthorized": False,
        "q003SchedulerEligible": False,
        "sc001BlindingIncidentRemainsEffective": True,
        "sc001ChunkStatus": "TYPED_HOLD_COMPLETED",
        "sc001IncidentId": "Q010-SC001-INCIDENT-0001",
        "sc001CandidateState": None,
        "sc001ScientificCredit": "NONE",
        "sc001BlindingRemediationStillRequired": True,
        "earlyDetectionSystemBuilt": False,
        "frozenGovernanceProjectionSha256": contract["frozenGovernanceProjectionSha256"],
        "noRetroactiveAuthorization": True,
    }


def expected_state(contract: dict, events: list[dict]) -> dict:
    event = events[-1]
    state = {
        "schema": "early-detection-q010-sc002-pit-listing-ledger-state/v1",
        "materializedAt": event["createdAt"],
        "contractSelfSha256": contract["contractSelfSha256"],
        "eventCount": len(events),
        "eventHeadSha256": event["eventSha256"],
        "projection": expected_projection(contract, events),
        "stateSelfSha256": None,
    }
    state["stateSelfSha256"] = state_self_sha256(state)
    return state


def validate_repository(contract: dict) -> None:
    repo = contract["repository"]
    expected_paths = [
        "research/early-detection-v4/q010-sc002-pit-listing-ledger-governance-contract-v1.json",
        "scripts/early-detection-q010-sc002-pit-listing-ledger-v1.py",
        "state/early-detection-q010-sc002-pit-listing-ledger-events-v1.jsonl",
        "state/early-detection-q010-sc002-pit-listing-ledger-state-v1.json",
        "tests/early-detection-q010-sc002-pit-listing-ledger-v1.test.js",
    ]
    require(repo == {
        "worktree": r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\worktrees\form25-v2-promotion-20260812",
        "branch": "codex/form25-v2-promotion-20260812",
        "remoteUrl": "https://github.com/Karlryl/screener-data.git",
        "remoteRef": "refs/heads/codex/early-detection-v4-gates-20260810",
        "baseCommit": "2d744159e4a001bfe1e2ff5b9d31113cbc347487",
        "baseCommitCommittedAt": "2026-08-13T22:12:39Z",
        "expectedDecisionSubject": "Tag 915: Q010-SC002 PIT-Ledger vor Arbeitsbeginn versiegeln",
        "expectedDecisionPaths": expected_paths,
        "decisionIntroductionMustBeExactDirectChild": True,
        "expectedStartSubject": "Tag 916: Q010-SC002 PIT-Ledger prospektiv starten",
        "expectedStartPaths": expected_paths,
        "startIntroductionMustBeExactDirectChildOfDecisionIntroduction": True,
    }, "repository binding drift")
    require(datetime.fromisoformat(contract["decision"]["decisionRecordedAt"].replace("Z", "+00:00")) > datetime.fromisoformat(repo["baseCommitCommittedAt"].replace("Z", "+00:00")), "decision not after Tag914")


def validate_decision(contract: dict) -> None:
    d = contract["decision"]
    expected = {
        "subchunkId": "Q010-SC-002-PIT-LISTING-ENTITY-LEDGER-2015",
        "targetEntityOrFrozenPopulationId": "POP-Q010-SC002-DMV7-PLUS-SEC-SIC-CONTROLS-2015-V1",
        "targetThemeOrThemeEraId": "THEME-CA-AUTONOMOUS-VEHICLE-PUBLIC-ROAD-TESTING-2014-2016",
        "targetDimensions": ["T", "E", "L"],
        "workClass": "SUPPORTING_POINT_IN_TIME_IDENTITY_INFRASTRUCTURE",
        "supportingAdmissionCriterion": "SECURE_POINT_IN_TIME_DATA_AND_IDENTITY_SEMANTICS_FOR_NAMED_CORE_CONTROL_GATE",
        "namedCoreGate": "PIT_EFFECTIVE_DATED_LISTING_AND_ENTITY_LEDGER_WITHOUT_OUTCOME_ACCESS",
        "scientificCredit": "NONE",
        "decisionRecordedAt": "2026-08-13T22:30:44Z",
        "decisionTimingStatusAtDraft": "PENDING_REMOTE_INTRODUCTION",
        "preChunkTimingClaimRecorded": True,
        "preChunkTimingVerifiedAtDraft": False,
        "workStarted": False,
        "workStartedAt": None,
        "sourceAccessAuthorized": False,
        "workMayStartAfter": "REMOTE_INTRODUCTION_OF_THIS_DECISION_AND_SEPARATE_APPEND_ONLY_START_EVENT_REMOTE_INTRODUCTION",
        "decisionSourceEventId": "Q010-EVT-00000003",
        "decisionSourceEventSequence": 3,
        "parentCorpusEventId": "Q010-SC001-EVT-00000001",
        "targetTreatmentPopulationId": "POP-CA-DMV-AV-PERMIT-HOLDERS-2015-FULL-CENSUS",
        "targetControlFrameId": "FRAME-OFFICIAL-XNAS-XNYS-XASE-ALL-LISTED-SECURITIES-ASOF-2015-12-31-WITH-PIT-CLASSIFICATION",
        "targetControlPopulationId": "POP-SEC-DOMESTIC-LISTED-SIC-3711-3674-7372-NON-DMV-2015-CONTROLS",
        "evaluationAtUtc": "2015-12-31T23:59:59Z",
        "sourcePublicationCutoffInclusiveUtc": "2020-12-31T23:59:59Z",
        "retrievalBudgetPolicyId": "Q010-SC002-EQUAL-IDENTITY-RETRIEVAL-BUDGET-V1",
        "developmentPilotOnly": True,
        "noRetroactiveAuthorization": True,
    }
    for key, value in expected.items():
        require(d.get(key) == value, f"decision drift: {key}")
    require(d["namedBiasesPrevented"] == [
        "PRESENT_DAY_IDENTIFIER_LEAKAGE",
        "FAMOUS_WINNER_PARENT_HINDSIGHT",
        "SURVIVORSHIP_FROM_PARTIAL_CONTROL_ENUMERATION",
        "SECURITY_CLASS_AND_MULTIPLE_LISTING_COLLAPSE",
        "RETROACTIVE_EFFECTIVE_DATE_KNOWLEDGE",
        "UNEQUAL_RESEARCH_BUDGET",
    ], "named bias set drift")
    require(d["coreContribution"].startswith("Resolve or type-HOLD the exact seven Tag-914 treatment rows"), "core contribution drift")
    require(d["continuationCriterion"] == "CONTINUE_ONLY_UNTIL_THE_EXACT_SEVEN_TAG914_TREATMENT_ROWS_AND_COMPLETE_OFFICIAL_XNAS_XNYS_XASE_ALL_LISTED_SECURITY_UNIVERSE_AT_2015_12_31_ARE_HASH_BOUND_BEFORE_SECURITY_TYPE_OR_OTHER_ELIGIBILITY_FILTERING_EVERY_UNIVERSE_ROW_HAS_THE_FIXED_EQUAL_RETRIEVAL_RECIPE_AND_A_RESOLVED_INELIGIBLE_OR_TYPED_HOLD_BITEMPORAL_ENTITY_SECURITY_LISTING_STATUS_AND_THE_TAG912_CONTROL_FRAME_IS_EITHER_READY_UNDER_THE_PREDECLARED_RULES_OR_GLOBALLY_TYPED_HOLD", "continuation drift")
    require(d["pauseOrStopCriterion"] == "STOP_AFTER_ONE_COMPLETE_LEDGER_AND_CONTROL_FRAME_DECISION_OR_IMMEDIATELY_ON_REMOTE_DRIFT_INCOMPLETE_FRAME_FORBIDDEN_SOURCE_OR_FIELD_PRICE_RETURN_GQS_OUTCOME_OR_CANDIDATE_ACCESS_BUDGET_ASYMMETRY_UNRESOLVED_SOURCE_AVAILABILITY_HASH_OR_REPLAY_FAILURE_AND_EMIT_TYPED_HOLD_WITH_NO_PARTIAL_POPULATION_USE", "stop drift")


def validate_tag914(contract: dict, check_files: bool = True) -> None:
    p = contract["parentTag914Binding"]
    require(p["commit"] == contract["repository"]["baseCommit"], "Tag914 commit drift")
    require(p["parentCommit"] == "504018d8bfd0fe5589c37be42e8c8b8c464fec9b", "Tag914 parent drift")
    require(p["subject"] == "Tag 914: Q010-DMV-Korpus point-in-time einfrieren", "Tag914 subject drift")
    require(p["requiredChunkStatus"] == "TYPED_HOLD_COMPLETED" and p["requiredScientificCredit"] == "NONE", "Tag914 hold/credit drift")
    require(p["requiredTreatmentPopulationCount"] == 7, "Tag914 census count drift")
    require(p["requiredNextQ010SubchunkAuthorized"] is False and p["requiredQ003SchedulerEligible"] is False, "Tag914 authorization drift")
    require(p["requiredCandidateState"] is None and p["requiredEarlyDetectionSystemBuilt"] is False, "Tag914 candidate/build drift")
    require(p["requiredOutcomeFilesOpened"] is False and p["requiredReturnsAccessed"] is False and p["requiredGqsAccessed"] is False, "Tag914 access drift")
    require(p["requiredBlindingIncidentOccurred"] is True and p["requiredBlindingIncidentType"] == "OPERATOR_BLINDING_BREACH", "Tag914 incident drift")
    if not check_files:
        return
    for key in ("contract", "controller", "events", "report", "test"):
        require(sha256_path(ROOT / p[f"{key}Path"]) == p[f"{key}RawSha256"], f"Tag914 {key} raw drift")
    report = json.loads((ROOT / p["reportPath"]).read_text(encoding="utf-8"))
    require(report["reportSelfSha256"] == p["reportSelfSha256"], "Tag914 report self field drift")
    require(report["projectionSha256"] == p["reportProjectionSha256"], "Tag914 projection field drift")
    require(report["sourceManifestSha256"] == p["sourceManifestSha256"], "Tag914 source manifest drift")
    require(canonical_sha(report["frozenTreatmentPopulation"]) == p["frozenTreatmentPopulationSha256"], "Tag914 treatment population drift")
    require(canonical_sha(report["controlPopulation"]) == p["controlPopulationSha256"], "Tag914 control population drift")
    require(canonical_sha(report["completionDecision"]) == p["completionDecisionSha256"], "Tag914 completion drift")
    require(report["subchunkId"] == p["requiredSubchunkId"] and report["chunkStatus"] == p["requiredChunkStatus"], "Tag914 report identity/status drift")
    require(report["frozenTreatmentPopulation"]["populationCount"] == 7, "Tag914 report census drift")
    require(report["completionDecision"]["nextQ010SubchunkAuthorized"] is False, "Tag914 report next authorization drift")
    require(report["completionDecision"]["q003SchedulerEligible"] is False, "Tag914 report q003 drift")
    require(report["completionDecision"]["scientificCredit"] == "NONE", "Tag914 report credit drift")
    require(report["completionDecision"]["earlyDetectionSystemBuilt"] is False, "Tag914 report build drift")
    require(report["blindingIncident"]["occurred"] is True and report["blindingIncident"]["type"] == "OPERATOR_BLINDING_BREACH", "Tag914 report incident drift")
    require([{"populationRowId": row["populationRowId"], "reportedLegalName": row["reportedLegalName"]} for row in report["frozenTreatmentPopulation"]["rows"]] == contract["targetPopulationPolicy"]["treatmentRows"], "Tag914 treatment rows differ from SC002 target")


def validate_parent_prefix(contract: dict, events: list[dict], check_files: bool = True) -> None:
    prefix = contract["parentGovernanceV1PrefixBinding"]
    require(prefix == {
        "eventsPath": "state/early-detection-q010-subchunk-events-v1.jsonl",
        "eventsRawSha256": "7964cc2421d56760834b4cc9b5032d5e484f17c5b8e7ec6ee25270cb7a565078",
        "eventCount": 2,
        "eventOneSha256": "ad35dff9726d27c42d755afdfac426f9900382bd8b61bacfab3e5f16e2bfbcf7",
        "eventTwoSha256": "fc26dd6267ad49900211263b4c2570903e77093ea3e16b6c91ca7d011b40c50a",
        "newEventLogMustRetainExactBytePrefix": True,
        "sc002DecisionSequence": 3,
        "sc002StartSequence": 4,
    }, "parent governance prefix binding drift")
    require(len(events) == 4, "SC002 start log must contain exact V1 prefix plus decision and start events")
    require(events[0]["eventSha256"] == prefix["eventOneSha256"], "prefix event one drift")
    require(events[1]["eventSha256"] == prefix["eventTwoSha256"], "prefix event two drift")
    if check_files:
        parent_raw = (ROOT / prefix["eventsPath"]).read_bytes()
        require(sha256_bytes(parent_raw) == prefix["eventsRawSha256"], "parent governance raw drift")
        require(EVENTS_PATH.read_bytes().startswith(parent_raw), "SC002 event log is not exact byte-prefix append")


def _retired_validate_authority_and_policies(contract: dict) -> None:
    fail("retired legacy validator must never be called; validate_sc002_governance_v2 is authoritative")
    require(contract["authorityPolicy"] == {
        "singleConcreteSubchunkAuthority": "scripts/early-detection-q010-sc002-pit-listing-ledger-v1.py",
        "v23OrTag914CannotAuthorizeConcreteSc002Work": True,
        "decisionCommitCannotAuthorizeSourceAccess": True,
        "concreteSourceWorkRequiresPostIntroductionStartEvent": "Q010-EVT-00000004",
        "allStartAndSourceAccessSurfacesFalseBeforeStartRemoteIntroduction": True,
        "decisionAndStartMustBeSeparateRemoteCommits": True,
        "localCommitIsNotRemoteAuthorization": True,
        "firstRetrievalMustBindStartCommitAndRemoteObservedAt": True,
    }, "authority policy drift")
    t = contract["targetPopulationPolicy"]
    require(t["schema"] == "early-detection-q010-sc002-target-populations/v1", "target population schema drift")
    require(t["treatmentPopulationCount"] == 7 and len(t["treatmentRows"]) == 7, "treatment census size drift")
    require(t["treatmentRows"] == [
        {"populationRowId": "DMV2015-BOSCH", "reportedLegalName": "Bosch, LLC"},
        {"populationRowId": "DMV2015-DELPHI", "reportedLegalName": "Delphi Automotive Systems, LLC"},
        {"populationRowId": "DMV2015-GOOGLE", "reportedLegalName": "Google Auto, LLC"},
        {"populationRowId": "DMV2015-NISSAN", "reportedLegalName": "Nissan North America, Inc"},
        {"populationRowId": "DMV2015-MERCEDES", "reportedLegalName": "Mercedes-Benz Research & Development North America, Inc"},
        {"populationRowId": "DMV2015-TESLA", "reportedLegalName": "Tesla Motors, Inc."},
        {"populationRowId": "DMV2015-VOLKSWAGEN", "reportedLegalName": "Volkswagen Group of America, Inc."},
    ], "treatment census rows drift")
    require(t["controlFrameEnumerationStartInclusiveUtc"] == "2014-01-01T00:00:00Z" and t["controlFrameEnumerationEndInclusiveUtc"] == "2015-12-31T23:59:59Z", "control enumeration window drift")
    require(t["controlSicCodes"] == ["3711", "3674", "7372"], "control SIC drift")
    require(t["allowedExchangeMics"] == ["XNAS", "XNYS", "XASE"], "control MIC drift")
    require(t["completeFrameRequiredBeforeAnyControlRowIsUsable"] is True and t["partialFrameUseForbidden"] is True, "partial control frame enabled")
    require(t["laterDeadAcquiredBankruptOrDelistedRowsRetainedWithoutViewingLabels"] is True, "survivorship retention drift")
    sem = contract["identitySecurityListingSemantics"]
    require(sem["effectiveIntervalConvention"] == "[effectiveFrom,effectiveToExclusive)", "interval convention drift")
    require(sem["knowledgeIntervalSeparateFromFactInterval"] is True, "bitemporal separation drift")
    require(sem["availabilityKnownAtNeverDerivedFromEffectiveDate"] is True and sem["retrievedAtNeverUsedAsHistoricalKnownAt"] is True, "knownAt drift")
    require(sem["claimKnownAtMustNotExceedEvaluationAtUtc"] is True, "evaluation knownAt drift")
    require(sem["dateOnlyEvidencePolicy"] == "HOLD_UNLESS_THE_OFFICIAL_SOURCE_EXPLICITLY_DEFINES_THE_EFFECTIVE_CALENDAR_DATE_AND_BOUNDARY_SEMANTICS", "date-only drift")
    require(sem["timezoneMissingPolicy"] == "HOLD_NO_ASSUMED_MIDNIGHT", "timezone drift")
    require(sem["exactlyOneActiveAllowedCommonListingAtEvaluationRequired"] is True, "single listing drift")
    require(sem["multipleActiveListingsOrClassesPolicy"] == "REJECTED_HOLD_MULTIPLE_OR_PRIMARY_UNRESOLVED", "multiple listing drift")
    require(sem["absenceFromDirectoryNeverProvesDelistingOrInactivity"] is True, "absence inference drift")
    require(sem["cikContinuityNeverImpliesSecurityContinuity"] is True and sem["tickerContinuityNeverImpliesEntityOrSecurityContinuity"] is True and sem["nameSimilarityNeverResolvesEntity"] is True, "identity shortcut drift")
    require(sem["parentOrSuccessorMaxHops"] == 2 and sem["eachParentOrSuccessorHopRequiresExplicitEffectiveOwnershipOrLegalSuccessionEdge"] is True, "parent-hop drift")
    require(sem["currentParentNearestListedParentAndRetrospectiveSuccessorForbidden"] is True, "current parent drift")
    source = contract["sourcePolicy"]
    require(source["sourceAccessBeforeStartRemoteIntroductionForbidden"] is True, "source-before-start drift")
    require(source["primaryEvidenceClasses"] == ["SEC_EDGAR_ASFILED_MASTER_OR_FORM_INDEX", "SEC_EDGAR_ASFILED_FILING_WHITELISTED_LISTING_PROJECTION", "OFFICIAL_EXCHANGE_HISTORICAL_DIRECTORY_OR_LISTING_NOTICE", "OFFICIAL_REGULATOR_OR_SRO_CORPORATE_ACTION_NOTICE", "FINRA_DAILY_LIST_OR_OFFICIAL_OTC_IDENTITY_BOUNDARY"], "source class allowlist drift")
    require(source["primaryPublishers"] == ["SEC", "NASDAQ", "NYSE", "NYSE_AMERICAN", "FINRA"], "publisher allowlist drift")
    require(source["allowedSecForms"] == ["8-A", "8-A12B", "8-K", "10-K", "10-Q", "25-NSE"], "SEC form allowlist drift")
    require(source["currentSecCompanyTickersProfilesOrCurrentExchangeMapsForbidden"] is True, "current identifier source drift")
    require(source["secondarySources"] == "DISCOVERY_LOCATOR_ONLY_NEVER_LEDGER_OR_SIGNAL_CREDIT", "secondary source drift")
    require(source["waybackUse"] == "TRANSPORT_ONLY_FOR_EXACT_OFFICIAL_PAYLOAD_WITH_ARCHIVE_CAPTURE_PROVENANCE_NEVER_PUBLISHER_OR_CLAIM_CREDIT", "archive carrier drift")
    require(source["rawPayloadPolicy"] == "CONTENT_ADDRESSED_PRIVATE_CAPTURE_MAY_NOT_BE_RENDERED_TO_OPERATOR_OR_LLM", "raw payload rendering drift")
    require(source["operatorAndLlmMaySeeOnlyFieldAllowlistedNonPriceProjection"] is True, "projection whitelist drift")
    require(source["sourcePublicationCutoffInclusiveUtc"] == "2020-12-31T23:59:59Z" and source["acquisitionCost"] == "ZERO", "source cutoff/cost drift")
    require(not any("http:" in str(value).lower() or "https:" in str(value).lower() for value in source.values()), "research source URL embedded before authorization")
    budget = contract["retrievalBudgetPolicy"]
    require(budget["policyId"] == contract["decision"]["retrievalBudgetPolicyId"], "budget policy identity drift")
    require(budget["fixedRetrievalOrder"] == ["SEC_ASFILED_INDEX_AND_SIC", "SEC_ASFILED_LISTING_AND_SECURITY_FORMS", "OFFICIAL_EXCHANGE_DIRECTORY_OR_NOTICE", "OFFICIAL_SRO_CORPORATE_ACTION_BOUNDARY", "PIT_PARENT_OR_SUCCESSOR_EDGE_IF_REQUIRED"], "retrieval order drift")
    require(budget["maxLocatorQueriesPerRowByStep"] == {"SEC_ASFILED_INDEX_AND_SIC": 4, "SEC_ASFILED_LISTING_AND_SECURITY_FORMS": 8, "OFFICIAL_EXCHANGE_DIRECTORY_OR_NOTICE": 4, "OFFICIAL_SRO_CORPORATE_ACTION_BOUNDARY": 3, "PIT_PARENT_OR_SUCCESSOR_EDGE_IF_REQUIRED": 4}, "query budget drift")
    require(budget["maxAcceptedPrimaryPayloadsPerRowByStep"] == {"SEC_ASFILED_INDEX_AND_SIC": 4, "SEC_ASFILED_LISTING_AND_SECURITY_FORMS": 6, "OFFICIAL_EXCHANGE_DIRECTORY_OR_NOTICE": 3, "OFFICIAL_SRO_CORPORATE_ACTION_BOUNDARY": 3, "PIT_PARENT_OR_SUCCESSOR_EDGE_IF_REQUIRED": 4}, "payload budget drift")
    require(budget["sameBudgetForTreatmentAndControlRows"] is True and budget["sameSourceClassOrderForTreatmentAndControlRows"] is True, "arm budget asymmetry")
    require(budget["failedQueriesAndNullResultsConsumeBudget"] is True and budget["unusedBudgetCannotBeTransferredBetweenRows"] is True, "budget accounting drift")
    require(budget["budgetExhaustedBeforeCompleteFramePolicy"] == "GLOBAL_TYPED_HOLD_NO_PARTIAL_USE", "budget exhaustion drift")
    holds = contract["holdConflictPolicy"]
    require(len(holds["typedHoldStates"]) == 14 and len(set(holds["typedHoldStates"])) == 14, "typed HOLD set drift")
    require(holds["conflictingPrimarySourcesNeverAutoResolvedByRankOrMajority"] is True and holds["fuzzyNameTickerOrCurrentParentResolutionForbidden"] is True, "conflict shortcut drift")
    require(holds["everyFrozenRowMustEndResolvedOrTypedHold"] is True and holds["silentDropUnknownOrNullStatusForbidden"] is True, "silent row drop drift")
    control = contract["controlPopulationPolicy"]
    require(control["controlMatchingInThisSubchunkForbidden"] is True and control["telCodingInThisSubchunkForbidden"] is True and control["candidateStateComputationForbidden"] is True, "scope expansion drift")
    require(control["controlPopulationUsableRequiresZeroUnresolvedOrConflictHolds"] is True and control["partialResolvedSubsetUseForbidden"] is True, "partial control usability drift")
    require(control["minimumResolvedEligibleControlsPerRepresentedTreatmentSic"] == 5, "minimum control coverage drift")
    prohibited = contract["prohibitedAccessPolicy"]
    for key in ("pricesAccessed", "returnsAccessed", "gqsAccessed", "outcomesAccessed", "candidateFilesAccessed", "currentIdentifierFilesAccessed", "productiveScoringModified"):
        require(prohibited[key] is False, f"prohibited access drift: {key}")
    require(prohibited["sc001BlindingIncidentRemainsEffective"] is True and prohibited["successfulLedgerCannotCureSc001BlindingIncident"] is True, "SC001 incident cure drift")
    stop = contract["stopAndOutputPolicy"]
    require(stop["fullPrivateHashAndSizeVerificationRequiredBeforeResultPass"] is True, "private result gate drift")
    require(stop["publicVerificationWithoutPrivateStoreMaximumStatus"] == "DIAGNOSTIC", "public result pass drift")
    require(stop["stopIfNamedCoreBiasNotMateriallyReduced"] is True and stop["noUnboundedIdentityExpansionBeyondFrozenFrames"] is True, "side-project stop drift")
    require(stop["stopAfterOneCompleteLedgerOrTypedGlobalHold"] is True and stop["noAutomaticNextSubchunk"] is True, "completion/next drift")
    require(stop["scientificCredit"] == "NONE", "stop credit drift")


def _retired_validate_future_start(contract: dict) -> None:
    fail("retired legacy validator must never be called; validate_future_start_v2 is authoritative")
    start = contract["startEventContract"]
    require(start["eventId"] == "Q010-EVT-00000004" and start["sequence"] == 4 and start["eventType"] == "SUBCHUNK_WORK_STARTED", "future start identity drift")
    require(start["previousEventSha256Rule"] == "MUST_EQUAL_COMPUTED_DECISION_EVENT_SHA256", "future start predecessor drift")
    require(start["createdAtRule"] == "EXACT_TIMEZONE_QUALIFIED_AND_STRICTLY_AFTER_DECISION_REMOTE_COMMIT_TIME", "future start timing drift")
    payload = start["requiredPayload"]
    require(payload == {
        "subchunkId": "Q010-SC-002-PIT-LISTING-ENTITY-LEDGER-2015",
        "decisionEventId": "Q010-EVT-00000003",
        "decisionEventSequence": 3,
        "workStarted": True,
        "startAuthorized": True,
        "researchSourceAccessAuthorized": True,
        "pricesAccessed": False,
        "returnsAccessed": False,
        "gqsAccessed": False,
        "outcomesAccessed": False,
        "candidateFilesAccessed": False,
        "candidateStateComputationAllowed": False,
        "controlMatchingAllowed": False,
        "telCodingAllowed": False,
        "scientificCredit": "NONE",
    }, "future start payload drift")
    require(start["remoteIntroduction"] == {
        "requiredParent": "TAG915_DECISION_INTRODUCTION_COMMIT",
        "requiredSubject": "Tag 916: Q010-SC002 PIT-Ledger prospektiv starten",
        "requiredPathStatuses": "EXACTLY_FIVE_M_PATHS_MATCHING_REPOSITORY_EXPECTED_START_PATHS",
        "localBytesMustEqualIntroducedGitBlobs": True,
        "headUpstreamAndLiveRemoteMustMatch": True,
    }, "future start remote contract drift")
    require(start["firstRetrievalAuditContract"] == {
        "startCommitRequired": True,
        "remoteObservedAtUtcRequired": True,
        "retrievedAtUtcMustBeStrictlyAfterRemoteObservedAtUtc": True,
        "firstRetrievalEventMustBeAppendOnly": True,
        "retrievalBeforeRemoteObservationRequiresGlobalTypedHold": True,
    }, "first retrieval audit drift")
    require(contract["phasePolicy"] == {
        "preDecisionIntroductionVerifyIsDiagnosticOnly": True,
        "postDecisionIntroductionDecisionRecorded": True,
        "postDecisionIntroductionStartAuthorized": False,
        "separateAppendOnlyStartEventRequired": True,
        "researchSourceAccessBeforeStartRemoteIntroductionForbidden": True,
        "pricesReturnsGqsOutcomesCandidatesForbidden": True,
        "controlMatchingForbidden": True,
        "telCodingForbidden": True,
        "candidateStateComputationForbidden": True,
        "scientificCredit": "NONE",
    }, "phase policy drift")


def validate_sc002_governance_v2(contract: dict) -> None:
    require(contract["frozenGovernanceProjectionSha256"] == EXPECTED_GOVERNANCE_PROJECTION_SHA256, "frozen governance expected hash drift")
    require(frozen_governance_projection_sha256(contract) == EXPECTED_GOVERNANCE_PROJECTION_SHA256, "frozen governance projection drift")
    require(contract["implementation"]["frozenGovernanceProjectionSha256"] == EXPECTED_GOVERNANCE_PROJECTION_SHA256, "implementation governance hash drift")
    t = contract["targetPopulationPolicy"]
    require(t["tag912ControlSelectionRuleExact"] == "Every domestic operating issuer with exactly one effective NYSE Nasdaq or NYSE-American common-equity listing at 2015-12-31T23:59:59Z, contemporaneous SEC SIC 3711 3674 or 7372, and no match in the frozen DMV census; unresolved identity or listing is REJECTED_HOLD.", "Tag912 population rule drift")
    require(t["controlFrameId"] == "FRAME-OFFICIAL-XNAS-XNYS-XASE-ALL-LISTED-SECURITIES-ASOF-2015-12-31-WITH-PIT-CLASSIFICATION", "control frame id drift")
    require(t["controlFrameEnumerationRule"].startswith("First enumerate every listed-security row of every security type in the complete official XNAS XNYS and XASE listing-universe snapshots"), "control frame enumeration drift")
    require(t["securityTypeFilteringBeforeCompleteUniverseFreezeForbidden"] is True, "security-type prefilter enabled")
    require(t["completeOfficialSnapshotAndChangeStreamRequiredForEveryAllowedMic"] is True, "complete exchange universe disabled")
    require(t["missingOrUnprovenCompleteOfficialUniversePolicy"] == "GLOBAL_TYPED_HOLD_NO_PARTIAL_FRAME", "missing universe fail-open")
    require(t["filingActivityWindowCannotRestrictControlMembership"] is True and t["tag912PopulationRuleMayNotBeNarrowedOrExpanded"] is True, "control population narrowing enabled")
    require(t["unresolvedPotentialEligibilityRemainsInCandidateSupersetAsTypedHold"] is True, "unresolved controls may disappear")
    require("INELIGIBLE_RESOLVED_SECURITY_TYPE" in t["enumerationAuditStatusDomain"], "resolved non-common security status missing")
    require("INELIGIBLE_RESOLVED_DMV_TREATMENT_MATCH" in t["enumerationAuditStatusDomain"], "resolved DMV treatment match status missing")
    require(t["resolvedDmvTreatmentMatchAuditRule"] == "AN_EXACT_PIT_BITEMPORAL_ENTITY_GRAPH_MATCH_TO_ONE_OF_THE_SEVEN_FROZEN_DMV_TREATMENT_ROWS_MUST_REMAIN_IN_THE_ENUMERATION_AUDIT_AS_INELIGIBLE_RESOLVED_DMV_TREATMENT_MATCH_AND_MUST_BE_DETERMINISTICALLY_EXCLUDED_FROM_THE_CONTROL_POPULATION", "resolved DMV treatment row conservation drift")
    require(t["controlFrameEvaluationAtUtc"] == "2015-12-31T23:59:59Z", "control evaluation drift")
    require(t["controlSicCodes"] == ["3711", "3674", "7372"] and t["allowedExchangeMics"] == ["XNAS", "XNYS", "XASE"], "control domain drift")
    require("HOLD_DOMESTIC_STATUS_UNRESOLVED" in t["domesticIssuerStatusRule"] and "HOLD_OPERATING_ISSUER_STATUS_UNRESOLVED" in t["operatingIssuerStatusRule"], "domestic/operating HOLD rule drift")
    require("HOLD_SIC_UNRESOLVED" in t["sicStatusRule"], "SIC HOLD rule drift")
    sem = contract["identitySecurityListingSemantics"]
    for field in ("identityRecordId", "recordVersion", "supersedesIdentityRecordId", "recordKnownAtUtc", "recordSupersededAtUtc"):
        require(field in sem["requiredEntityFields"], "entity record schema drift: " + field)
    for field in ("securityRecordId", "recordVersion", "supersedesSecurityRecordId", "recordKnownAtUtc", "recordSupersededAtUtc"):
        require(field in sem["requiredSecurityFields"], "security record schema drift: " + field)
    for field in ("listingRecordId", "recordVersion", "supersedesListingRecordId", "recordKnownAtUtc", "recordSupersededAtUtc"):
        require(field in sem["requiredListingFields"], "listing record schema drift: " + field)
    require(sem["requiredRelationshipFields"] == ["relationshipRecordId", "recordVersion", "supersedesRelationshipRecordId", "childEntityId", "parentOrSuccessorEntityId", "relationshipType", "relationshipEffectiveFrom", "relationshipEffectiveToExclusive", "relationshipKnownAtUtc", "recordKnownAtUtc", "recordSupersededAtUtc", "sourceIds"], "relationship record schema drift")
    require(sem["recordsAreAppendOnlyAndMayNotBeCorrectedInPlace"] is True and sem["supersededRecordRemainsImmutable"] is True and sem["laterReconciliationMustAppendNewVersionWithoutRewritingHistoricalKnowledgeState"] is True, "bitemporal versioning drift")
    require(sem["effectiveToNullMeaning"].startswith("AS_OF_THE_EVALUATION_INSTANT"), "open interval meaning drift")
    require(sem["allLedgerSourceIdsMustBeNonEmptyUniqueAndResolveToAcceptedSourceRecords"] is True, "ledger source references fail-open")
    require(sem["entitySecurityListingAndRelationshipKnownAtMustEqualMaximumAcceptedReferencedSourceKnownAt"] is True, "ledger claim knownAt max rule drift")
    require(sem["recordKnownAtUtcMustEqualMaximumAcceptedReferencedSourceKnownAt"] is True and sem["callerSuppliedEarlierKnownAtForbidden"] is True, "record knownAt backdating enabled")
    require(sem["danglingRejectedOrLateSourceReferencePolicy"] == "TYPED_HOLD_NO_LEDGER_RESOLUTION", "dangling/late source reference fail-open")
    source = contract["sourcePolicy"]
    require(source["primaryEvidenceClasses"] == ["SEC_EDGAR_ASFILED_MASTER_INDEX", "SEC_EDGAR_ASFILED_FORM_INDEX", "SEC_EDGAR_ASFILED_FILING_WHITELISTED_LISTING_PROJECTION", "OFFICIAL_EXCHANGE_HISTORICAL_DIRECTORY_OR_LISTING_NOTICE", "OFFICIAL_REGULATOR_OR_SRO_CORPORATE_ACTION_NOTICE", "FINRA_DAILY_LIST_OR_OFFICIAL_OTC_IDENTITY_BOUNDARY"], "source class allowlist drift")
    require("PRICE" in source["forbiddenEvidenceFields"] and "RETURN" in source["forbiddenEvidenceFields"] and "GQS" in source["forbiddenEvidenceFields"], "forbidden evidence field removed")
    require(source["lawfulReproducibleAccessRequired"] is True and source["secondarySources"] == "DISCOVERY_LOCATOR_ONLY_NEVER_LEDGER_OR_SIGNAL_CREDIT", "source provenance/secondary policy drift")
    require(set(source["availabilityKnownAtDerivationByEvidenceClass"]) == set(source["primaryEvidenceClasses"]) | {"ARCHIVE_TRANSPORT"}, "source-class knownAt map incomplete")
    require(source["availabilityKnownAtCannotComeFromEffectiveDateDocumentContentOrRetrievalTime"] is True and source["unprovenAvailabilityPolicy"] == "TYPED_HOLD_NO_PIT_CREDIT", "knownAt derivation fail-open")
    require(source["requiredSourceRecordFields"] == ["sourceId", "sourceClass", "sourceAuthority", "sourceAuthorityTier", "sourceUri", "sourceTimestamp", "observationTimestamp", "knownAt", "retrievedAt", "capturedAt", "payloadSha256", "archivedRawPayloadId", "cutoff", "acquisitionCost", "accessRights", "acquisitionProvenance", "contemporaneousTerminology", "rawExcerptMapping"], "source record schema drift")
    require(source["acceptedSourceRecordDefinition"] == "ALL_REQUIRED_FIELDS_PRESENT_SOURCE_CLASS_ALLOWLISTED_AUTHORITY_PRIMARY_TIER_PRIMARY_COST_ZERO_LAWFUL_REPRODUCIBLE_PAYLOAD_HASH_MATCHES_EXACT_ARCHIVED_RAW_BYTES_AND_KNOWNAT_EQUALS_CLASS_SPECIFIC_PUBLIC_AVAILABILITY", "accepted source definition drift")
    require(source["sourceRecordKnownAtMustEqualDerivedClassSpecificAvailabilityKnownAt"] is True and source["sourceRecordKnownAtCannotBeCallerSuppliedOrBackdated"] is True, "source record knownAt backdating enabled")
    require(source["sourceRecordIdsMustBeNonEmptyAndUnique"] is True and source["rejectedDanglingOrPostEvaluationSourceReferencePolicy"] == "TYPED_HOLD_NO_LEDGER_RESOLUTION", "source identity/reference policy drift")
    budget = contract["retrievalBudgetPolicy"]
    require(budget["scientificCredit"] == "NONE" and budget["sameBudgetForTreatmentAndControlRows"] is True, "budget credit/asymmetry drift")
    require(budget["fixedRetrievalOrder"] == ["OFFICIAL_EXCHANGE_UNIVERSE_SNAPSHOT_AND_CHANGE_STREAM", "SEC_ASFILED_INDEX_AND_SIC", "SEC_ASFILED_LISTING_AND_SECURITY_FORMS", "OFFICIAL_SRO_CORPORATE_ACTION_BOUNDARY", "PIT_PARENT_OR_SUCCESSOR_EDGE_IF_REQUIRED"], "exchange-universe-first retrieval order drift")
    require(set(budget["sharedOfficialBulkBudgetByEvidenceClass"]) == set(source["primaryEvidenceClasses"]) - {"SEC_EDGAR_ASFILED_FILING_WHITELISTED_LISTING_PROJECTION"}, "shared source class budget incomplete")
    for cap in budget["sharedOfficialBulkBudgetByEvidenceClass"].values():
        require(set(cap) == {"maxLocatorQueries", "maxAcceptedPrimaryPayloads", "maxTotalBytes"} and all(isinstance(v, int) and v > 0 for v in cap.values()), "shared budget cap drift")
    require(budget["sharedBulkBudgetIsHardCapAndCannotTransferAcrossClassesOrRows"] is True and "ONLY_WHEN" in budget["ifRequiredStepPredicate"], "shared/conditional budget fail-open")
    holds = contract["holdConflictPolicy"]
    for hold in ("HOLD_OFFICIAL_LISTING_UNIVERSE_INCOMPLETE", "HOLD_SIC_UNRESOLVED_OR_CONFLICT", "HOLD_DOMESTIC_STATUS_UNRESOLVED", "HOLD_OPERATING_ISSUER_STATUS_UNRESOLVED", "HOLD_SECURITY_TYPE_UNRESOLVED", "HOLD_EXCHANGE_MIC_UNRESOLVED"):
        require(hold in holds["typedHoldStates"], "required HOLD missing: " + hold)
    control = contract["controlPopulationPolicy"]
    require(control["outcomeBalanceClaimForbidden"] is True and control["tag912EveryDomesticOperatingIssuerRuleMustRemainExact"] is True, "control claim/rule drift")
    require(control["completeOfficialListingUniverseMustBeFrozenBeforeEligibilityFiltering"] is True and control["everyUniverseRowMustBeRetainedInEnumerationAudit"] is True and control["unresolvedSicDomesticOperatingOrIdentityCannotBeDroppedBeforeHold"] is True, "control row retention drift")
    require(control["dmvTreatmentExclusionOnlyAfterPitEntityGraphResolution"] is True and control["resolvedDmvTreatmentMatchMustRemainAuditedAndBeDeterministicallyExcluded"] is True and control["possibleDmvCollisionCausesHoldNotExclusion"] is True, "DMV exclusion/audit drift")
    for section in ("retrievalBudgetPolicy", "controlPopulationPolicy", "prohibitedAccessPolicy", "stopAndOutputPolicy", "phasePolicy", "sc001CarryForwardPolicy"):
        require(contract[section]["scientificCredit"] == "NONE" if "scientificCredit" in contract[section] else contract[section]["sc001ScientificCredit"] == "NONE", "scientific credit drift: " + section)
    carry = contract["sc001CarryForwardPolicy"]
    require(carry == {"sc001ChunkStatus": "TYPED_HOLD_COMPLETED", "sc001IncidentId": "Q010-SC001-INCIDENT-0001", "sc001CandidateState": None, "sc001ScientificCredit": "NONE", "sc001BlindingRemediationStillRequired": True, "successfulSc002MayOnlyReduceNamedPitControlBias": True, "earlyDetectionSystemBuilt": False, "q003SchedulerEligible": False}, "SC001 carry-forward drift")


def validate_future_start_v2(contract: dict) -> None:
    start = contract["startEventContract"]
    require(start["eventId"] == "Q010-EVT-00000004" and start["sequence"] == 4 and start["eventType"] == "SUBCHUNK_WORK_STARTED", "future start identity drift")
    require(start["previousEventSha256Rule"] == "MUST_EQUAL_EXACT_EVENT_3_SHA256_READ_FROM_TAG915_PARENT_EVENT_LOG", "future start predecessor drift")
    require(start["tag916EventLogMustRetainExactTag915ThreeEventBytePrefix"] is True and start["tag916MustVerifyAllFiveTag915ParentBlobsAndTag915ContractSelfHashStateReplayAndEvent3Hash"] is True, "Tag916 parent trust drift")
    require(start["tag916FrozenGovernanceProjectionMustEqualTag915"] is True, "Tag916 policy rewrite enabled")
    require(start["tag916AllowedContractMutationPaths"] == ["decisionIntroductionBinding", "startFinalization", "implementation", "contractSelfSha256"], "Tag916 mutation allowlist drift")
    require(start["createdAtRule"] == "EXACT_TIMEZONE_QUALIFIED_AND_STRICTLY_AFTER_TAG915_REMOTE_OBSERVED_AT_AND_NOT_AFTER_TAG916_COMMIT_TIME", "start causal time drift")
    remote = start["remoteIntroduction"]
    require(remote["requiredParent"] == "TAG915_DECISION_INTRODUCTION_COMMIT" and remote["requiredSubject"] == "Tag 916: Q010-SC002 PIT-Ledger prospektiv starten", "start parent/subject drift")
    require(remote["requiredPathStatuses"] == "EXACTLY_FIVE_M_PATHS_MATCHING_REPOSITORY_EXPECTED_START_PATHS" and remote["tag916CommitTimeMustNotPrecedeEvent4CreatedAt"] is True and remote["tag915ParentBlobSetMustBeVerifiedBeforeStart"] is True, "start topology/time drift")
    audit = start["firstRetrievalAuditContract"]
    require(audit["exactCausalOrder"] == "TAG915_COMMIT_TIME_LTE_TAG915_REMOTE_OBSERVED_AT_LT_EVENT4_CREATED_AT_LTE_TAG916_COMMIT_TIME_LTE_TAG916_REMOTE_OBSERVED_AT_LT_FIRST_RETRIEVED_AT", "retrieval causal order drift")
    require(audit["startCommitOidAndRemoteRefRequired"] is True and audit["tag915RemoteObservedAtUtcRequired"] is True and audit["remoteObservedAtMustNotPrecedeEvent4CreatedAtOrTag916CommitTime"] is True and audit["firstRetrievalEventMustBeAppendOnly"] is True, "first retrieval audit drift")
    payload = start["requiredPayload"]
    require(payload["researchSourceAccessAuthorized"] is True and payload["workStarted"] is True and payload["startAuthorized"] is True, "future start not explicit")
    for key in ("pricesAccessed", "returnsAccessed", "gqsAccessed", "outcomesAccessed", "candidateFilesAccessed", "candidateStateComputationAllowed", "controlMatchingAllowed", "telCodingAllowed"):
        require(payload[key] is False, "future start prohibited flag drift: " + key)
    require(payload["scientificCredit"] == "NONE", "future start credit drift")


def validate_tag915_binding_and_start_finalization(contract: dict, check_files: bool = True) -> None:
    binding = contract["decisionIntroductionBinding"]
    require(binding["schema"] == "early-detection-q010-sc002-tag915-decision-introduction-binding/v1", "Tag915 binding schema drift")
    require(binding["tag915Commit"] == "1ed213b0c04c0a4eefddfec9b999bb4184286ff9", "Tag915 commit drift")
    require(binding["tag915Parent"] == contract["repository"]["baseCommit"], "Tag915 parent drift")
    require(binding["tag915Subject"] == contract["repository"]["expectedDecisionSubject"], "Tag915 subject drift")
    require(binding["tag915CommitTimeUtc"] == "2026-08-13T23:24:40Z", "Tag915 commit time drift")
    require(binding["remoteRef"] == contract["repository"]["remoteRef"], "Tag915 remote ref drift")
    require(binding["tag915RemoteObservedAtUtc"] == "2026-08-13T23:26:21.6093382Z", "Tag915 remote observation drift")
    require(binding["prospectiveDecisionRemoteIntroductionVerified"] is True and binding["exactFivePathStatuses"] == "EXACTLY_FIVE_A_PATHS", "Tag915 introduction proof drift")
    require(binding["exactThreeEventPrefixBytes"] == 2722 and binding["exactThreeEventPrefixRawSha256"] == "c0aff65145fa7370f2e735603cbb088b3443c141224fc844de300eeb097bc272", "Tag915 event-prefix binding drift")
    require(binding["tag915ContractSelfSha256"] == "1a73e72dedcc6adff5dbc0a10c50cf85ad56c5e4470eaeb0adeaf5d3acba8ee8", "Tag915 contract self drift")
    require(binding["tag915EventThreeSha256"] == "20022d50704039475411a98890d2b394cdacb6c31acb385df6d66ab67188bb8a", "Tag915 event3 drift")
    require(binding["tag915StateSelfSha256"] == "4c4a42b7e5e23fe9627d21829545a6da87d278d5cbc8fa4aec4e0ff18333a9f9", "Tag915 state self drift")
    require(binding["tag915ProjectionSha256"] == "c00be4eeaa5524a3bafad55dab0883c8468537bb1f20041e7033849cad032221", "Tag915 projection drift")
    require(binding["frozenGovernanceProjectionSha256"] == EXPECTED_GOVERNANCE_PROJECTION_SHA256, "Tag915 governance drift")
    expected_blobs = [
        {"path": "research/early-detection-v4/q010-sc002-pit-listing-ledger-governance-contract-v1.json", "gitBlobSha1": "e1c726a6b73fc99c79ac7915e497bdcb0207f285", "rawSha256": "2a39622954b60cdc913b01b2f964178278f93085378f4d28ddd39f857fbea666"},
        {"path": "scripts/early-detection-q010-sc002-pit-listing-ledger-v1.py", "gitBlobSha1": "3caa632218e3323ca0092de643dd0c69aa828020", "rawSha256": "c5d4c5f3eb606bf027dc5533e6a27b4434d595c7218ef9dd29fdead3ebc24dbe"},
        {"path": "state/early-detection-q010-sc002-pit-listing-ledger-events-v1.jsonl", "gitBlobSha1": "2e776d848d5f0acec4ff2e791d0bb0a56c0de2a6", "rawSha256": "c0aff65145fa7370f2e735603cbb088b3443c141224fc844de300eeb097bc272"},
        {"path": "state/early-detection-q010-sc002-pit-listing-ledger-state-v1.json", "gitBlobSha1": "4a2fc3576769f142e947a250c515701ac9eb2d29", "rawSha256": "38f72df2d3881634c0044529ffaf38d00d6cb8d7e07616b62c13723bfad7ed0f"},
        {"path": "tests/early-detection-q010-sc002-pit-listing-ledger-v1.test.js", "gitBlobSha1": "cf21d85e4b42e7199de61de83aa96cd5018ab928", "rawSha256": "c8fdb05b4272e647a51d7a8afc3bbfdbddbf7f1f7136779dea721d80392ae116"},
    ]
    require(binding["parentBlobs"] == expected_blobs, "Tag915 parent blob set drift")
    final = contract["startFinalization"]
    require(final == {
        "schema": "early-detection-q010-sc002-start-finalization/v1",
        "startEventId": "Q010-EVT-00000004",
        "startEventSequence": 4,
        "eventCreatedAtUtc": "2026-08-13T23:26:22.7404680Z",
        "workStartedAtUtc": "2026-08-13T23:26:22.7404680Z",
        "sourceAccessAuthorizationClaimRecorded": True,
        "sourceAccessAuthorizationEffectiveOnlyAfterTag916RemoteIntroduction": True,
        "tag916ExpectedSubject": "Tag 916: Q010-SC002 PIT-Ledger prospektiv starten",
        "firstResearchSourceRetrievedAtUtc": None,
        "firstRetrievalEventRecorded": False,
        "pricesAccessed": False,
        "returnsAccessed": False,
        "gqsAccessed": False,
        "outcomesAccessed": False,
        "candidateFilesAccessed": False,
        "controlMatchingAllowed": False,
        "telCodingAllowed": False,
        "candidateStateComputationAllowed": False,
        "scientificCredit": "NONE",
    }, "start finalization drift")
    tag915_commit_time = datetime.fromisoformat(binding["tag915CommitTimeUtc"].replace("Z", "+00:00"))
    tag915_observed = datetime.fromisoformat(binding["tag915RemoteObservedAtUtc"].replace("Z", "+00:00"))
    event_created = datetime.fromisoformat(final["eventCreatedAtUtc"].replace("Z", "+00:00"))
    require(tag915_commit_time <= tag915_observed < event_created, "Tag915/start causal order drift")
    if not check_files:
        return
    tag915 = binding["tag915Commit"]
    require(run_git(["show", "-s", "--format=%P", tag915]) == binding["tag915Parent"], "Tag915 Git parent drift")
    require(run_git(["show", "-s", "--format=%s", tag915]) == binding["tag915Subject"], "Tag915 Git subject drift")
    for blob in expected_blobs:
        require(run_git(["rev-parse", f'{tag915}:{blob["path"]}']) == blob["gitBlobSha1"], "Tag915 Git blob id drift: " + blob["path"])
        require(sha256_bytes(run_git_bytes(["show", f'{tag915}:{blob["path"]}'])) == blob["rawSha256"], "Tag915 raw blob drift: " + blob["path"])
    prefix_raw = run_git_bytes(["show", f'{tag915}:{contract["outputs"]["eventsPath"]}'])
    require(len(prefix_raw) == binding["exactThreeEventPrefixBytes"] and sha256_bytes(prefix_raw) == binding["exactThreeEventPrefixRawSha256"], "Tag915 prefix bytes drift")
    require(EVENTS_PATH.read_bytes().startswith(prefix_raw), "Tag916 event log does not retain exact Tag915 prefix")
    tag915_contract = json.loads(run_git_bytes(["show", f'{tag915}:{contract["repository"]["expectedDecisionPaths"][0]}']).decode("utf-8"))
    for key, value in tag915_contract.items():
        if key not in {"implementation", "contractSelfSha256"}:
            require(contract[key] == value, "Tag916 rewrote Tag915 contract section: " + key)
    require(set(contract) - set(tag915_contract) == {"decisionIntroductionBinding", "startFinalization"}, "Tag916 added unauthorized contract section")


def validate_process_surface() -> None:
    tree = ast.parse(CONTROLLER_PATH.read_text(encoding="utf-8"))
    attrs = [node for node in ast.walk(tree) if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "subprocess"]
    require(len(attrs) == 3, "subprocess surface count drift")
    require(sorted(node.attr for node in attrs) == ["TimeoutExpired", "run", "run"], "non-git subprocess surface introduced")
    require(not any(isinstance(node, ast.ImportFrom) and node.module == "subprocess" for node in ast.walk(tree)), "subprocess alias import forbidden")


def validate_bundle(contract: dict, events: list[dict], state: dict, check_files: bool = True) -> None:
    require(contract["schema"] == "early-detection-q010-sc002-pit-listing-ledger-governance-contract/v1", "contract schema drift")
    require(contract["createdAt"] == contract["decision"]["decisionRecordedAt"], "contract/decision time drift")
    require(contract_self_sha256(contract) == contract["contractSelfSha256"], "contract self hash drift")
    validate_repository(contract)
    validate_decision(contract)
    validate_tag914(contract, check_files=check_files)
    validate_parent_prefix(contract, events, check_files=check_files)
    validate_sc002_governance_v2(contract)
    validate_future_start_v2(contract)
    validate_tag915_binding_and_start_finalization(contract, check_files=check_files)
    decision_event = events[2]
    require(decision_event["schema"] == "early-detection-q010-sc002-governance-event/v1", "decision event schema drift")
    require(decision_event["eventId"] == "Q010-EVT-00000003" and decision_event["sequence"] == 3, "decision event identity drift")
    require(decision_event["eventType"] == "SUBCHUNK_DECISION_RECORDED", "decision event type drift")
    require(decision_event["previousEventSha256"] == contract["parentGovernanceV1PrefixBinding"]["eventTwoSha256"], "decision event predecessor drift")
    require(decision_event["createdAt"] == contract["decision"]["decisionRecordedAt"], "decision event time drift")
    require(decision_event["contractSelfSha256"] == contract["decisionIntroductionBinding"]["tag915ContractSelfSha256"], "historical decision event contract drift")
    require(decision_event["payload"] == decision_payload(contract), "decision event payload drift")
    require(event_self_sha256(decision_event) == decision_event["eventSha256"] == contract["decisionIntroductionBinding"]["tag915EventThreeSha256"], "decision event self hash drift")
    start_event = events[3]
    require(start_event["schema"] == "early-detection-q010-sc002-governance-event/v1", "start event schema drift")
    require(start_event["eventId"] == "Q010-EVT-00000004" and start_event["sequence"] == 4 and start_event["eventType"] == "SUBCHUNK_WORK_STARTED", "start event identity drift")
    require(start_event["previousEventSha256"] == decision_event["eventSha256"], "start event predecessor drift")
    require(start_event["createdAt"] == contract["startFinalization"]["eventCreatedAtUtc"], "start event time drift")
    require(start_event["contractSelfSha256"] == contract["contractSelfSha256"], "start event contract drift")
    require(start_event["payload"] == start_payload(contract), "start event payload drift")
    require(event_self_sha256(start_event) == start_event["eventSha256"], "start event self hash drift")
    require(state == expected_state(contract, events), "event-to-state replay drift")
    if check_files:
        validate_process_surface()
        require(sha256_path(CONTRACT_PATH) == EXPECTED_CONTRACT_RAW_SHA256, "contract raw hash drift")
        require(controller_normalized_sha256() == EXPECTED_CONTROLLER_NORMALIZED_SHA256, "controller normalized hash drift")
        require(sha256_path(EVENTS_PATH) == EXPECTED_EVENTS_RAW_SHA256, "events raw hash drift")
        require(sha256_path(STATE_PATH) == EXPECTED_STATE_RAW_SHA256, "state raw hash drift")
        require(sha256_path(TEST_PATH) == EXPECTED_TEST_RAW_SHA256, "test raw hash drift")
        impl = contract["implementation"]
        require(impl["controllerPath"] == "scripts/early-detection-q010-sc002-pit-listing-ledger-v1.py", "controller path drift")
        require(impl["controllerNormalizedSha256"] == EXPECTED_CONTROLLER_NORMALIZED_SHA256, "controller contract hash drift")
        require(impl["testPath"] == "tests/early-detection-q010-sc002-pit-listing-ledger-v1.test.js", "test path drift")
        require(impl["testRawSha256"] == EXPECTED_TEST_RAW_SHA256, "test contract hash drift")
        require(impl["controllerChildExecutionsRequired"] == 0 and impl["onlyEncapsulatedGitProcessSurfaceAllowed"] is True, "process lock drift")
        require(impl["eventsRawSha256PinnedByController"] is True and impl["stateRawSha256PinnedByController"] is True, "event/state raw pin drift")
        require(impl["tag914ArtifactsPinnedDirectlyWithoutControllerRecursion"] is True, "Tag914 direct pin drift")
        require(impl["frozenGovernanceProjectionSha256"] == EXPECTED_GOVERNANCE_PROJECTION_SHA256, "implementation governance hash drift")


def run_git(args: list[str]) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True, timeout=60)
    if result.returncode != 0:
        fail("git failed: " + " ".join(args) + ": " + result.stderr.strip())
    return result.stdout.strip()


def run_git_bytes(args: list[str]) -> bytes:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, timeout=60)
    if result.returncode != 0:
        fail("git bytes failed: " + " ".join(args) + ": " + result.stderr.decode("utf-8", errors="replace").strip())
    return result.stdout


def remote_phase(contract: dict) -> tuple[str, str | None, str | None]:
    repo = contract["repository"]
    require(run_git(["rev-parse", "--show-toplevel"]).replace("\\", "/") == str(ROOT).replace("\\", "/"), "wrong worktree")
    require(run_git(["branch", "--show-current"]) == repo["branch"], "wrong branch")
    require(run_git(["remote", "get-url", "origin"]) == repo["remoteUrl"], "origin URL drift")
    head = run_git(["rev-parse", "HEAD"])
    upstream = run_git(["rev-parse", "@{u}"])
    remote_line = run_git(["ls-remote", "origin", repo["remoteRef"]])
    remote_observed_at = datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")
    remote = remote_line.split()[0] if remote_line else ""
    require(remote and upstream == remote, "upstream/live remote mismatch")
    require(run_git(["show", "-s", "--format=%P", repo["baseCommit"]]) == contract["parentTag914Binding"]["parentCommit"], "Tag914 Git parent drift")
    require(run_git(["show", "-s", "--format=%s", repo["baseCommit"]]) == contract["parentTag914Binding"]["subject"], "Tag914 Git subject drift")
    base_time = run_git(["show", "-s", "--format=%cI", repo["baseCommit"]])
    require(datetime.fromisoformat(base_time).timestamp() == datetime.fromisoformat(repo["baseCommitCommittedAt"].replace("Z", "+00:00")).timestamp(), "Tag914 commit time drift")
    base_delta = run_git(["diff-tree", "--no-commit-id", "--name-status", "-r", repo["baseCommit"]]).splitlines()
    expected_base = sorted(("A", path) for path in (
        contract["parentTag914Binding"]["reportPath"],
        contract["parentTag914Binding"]["contractPath"],
        contract["parentTag914Binding"]["controllerPath"],
        contract["parentTag914Binding"]["eventsPath"],
        contract["parentTag914Binding"]["testPath"],
    ))
    require(sorted(tuple(line.split("\t", 1)) for line in base_delta if line) == expected_base, "Tag914 five-add topology drift")
    for key in ("contract", "controller", "events", "report", "test"):
        p = contract["parentTag914Binding"]
        require(sha256_bytes(run_git_bytes(["show", f'{repo["baseCommit"]}:{p[f"{key}Path"]}'])) == p[f"{key}RawSha256"], f"Tag914 Git blob drift: {key}")
    binding = contract["decisionIntroductionBinding"]
    tag915 = binding["tag915Commit"]
    decision_delta = run_git(["diff-tree", "--no-commit-id", "--name-status", "-r", tag915]).splitlines()
    require(sorted(tuple(line.split("\t", 1)) for line in decision_delta if line) == sorted(("A", path) for path in repo["expectedDecisionPaths"]), "Tag915 decision topology drift")
    require(run_git(["show", "-s", "--format=%P", tag915]) == repo["baseCommit"], "Tag915 decision parent drift")
    require(run_git(["show", "-s", "--format=%s", tag915]) == repo["expectedDecisionSubject"], "Tag915 decision subject drift")
    paths = repo["expectedStartPaths"]
    if head == tag915 and remote == tag915:
        status = run_git(["status", "--porcelain", "--", *paths]).splitlines()
        require(len(status) == len(paths), "start pre-introduction path count drift")
        require(all(line.lstrip().startswith("M ") for line in status), "start paths must be exactly five modifications before introduction")
        require(not run_git(["diff", "--cached", "--name-only", "--", *paths]), "start paths must remain unstaged during PRE diagnostic")
        require(sorted(run_git(["diff", "--name-only", "--", *paths]).splitlines()) == sorted(paths), "start unstaged path set drift")
        return "START_PRE_INTRODUCTION", None, None
    require(head == remote, "HEAD/live remote mismatch")
    require(run_git(["show", "-s", "--format=%P", "HEAD"]) == tag915, "start introduction parent drift")
    require(run_git(["show", "-s", "--format=%s", "HEAD"]) == repo["expectedStartSubject"], "start introduction subject drift")
    commit_time = run_git(["show", "-s", "--format=%cI", "HEAD"])
    event_time = contract["startFinalization"]["eventCreatedAtUtc"]
    require(datetime.fromisoformat(commit_time).timestamp() >= datetime.fromisoformat(event_time.replace("Z", "+00:00")).timestamp(), "start introduction predates event4")
    require(datetime.fromisoformat(remote_observed_at.replace("Z", "+00:00")).timestamp() >= datetime.fromisoformat(commit_time).timestamp(), "remote observation predates start commit")
    delta = run_git(["diff-tree", "--no-commit-id", "--name-status", "-r", "HEAD"]).splitlines()
    require(sorted(tuple(line.split("\t", 1)) for line in delta if line) == sorted(("M", path) for path in paths), "start introduction topology drift")
    require(not run_git(["status", "--porcelain", "--", *paths]), "post-start owned paths are dirty")
    for path in paths:
        require(run_git(["hash-object", "--no-filters", path]) == run_git(["rev-parse", f"HEAD:{path}"]), f"introduced start blob differs from local bytes: {path}")
    return "START_POST_INTRODUCTION", head, remote_observed_at


def verify(remote: bool) -> dict:
    require(remote, "--remote is mandatory")
    contract, events, state = read_contract(), read_events(), read_state()
    validate_bundle(contract, events, state, check_files=True)
    phase, commit, remote_observed_at = remote_phase(contract)
    post = phase == "START_POST_INTRODUCTION"
    return {
        "schema": "early-detection-q010-sc002-pit-listing-ledger-verification/v1",
        "status": "PASS" if post else "START_PRE_INTRODUCTION_DIAGNOSTIC",
        "phase": phase,
        "introductionCommit": commit,
        "subchunkId": contract["decision"]["subchunkId"],
        "decisionRecorded": True,
        "preChunkTimingClaimRecorded": True,
        "preChunkTimingVerified": True,
        "prospectiveDecisionRemoteIntroductionVerified": True,
        "startEventRecorded": True,
        "prospectiveStartRemoteIntroductionVerified": post,
        "startRemoteObservedAtUtc": remote_observed_at,
        "workStarted": post,
        "workStartedAt": contract["startFinalization"]["workStartedAtUtc"] if post else None,
        "startAuthorized": post,
        "researchSourceAccessAuthorized": post,
        "firstResearchSourceRetrievedAtUtc": None,
        "controlMatchingAllowed": False,
        "telCodingAllowed": False,
        "candidateStateComputationAllowed": False,
        "pricesAccessed": False,
        "returnsAccessed": False,
        "gqsAccessed": False,
        "outcomesAccessed": False,
        "scientificCredit": "NONE",
        "q003SchedulerEligible": False,
        "earlyDetectionSystemBuilt": False,
        "sc001BlindingIncidentRemainsEffective": True,
        "sc001ChunkStatus": "TYPED_HOLD_COMPLETED",
        "sc001IncidentId": "Q010-SC001-INCIDENT-0001",
        "sc001CandidateState": None,
        "sc001ScientificCredit": "NONE",
        "sc001BlindingRemediationStillRequired": True,
        "frozenGovernanceProjectionSha256": contract["frozenGovernanceProjectionSha256"],
        "controllerChildExecutions": 0,
    }


def bootstrap(write: bool) -> dict:
    contract = read_contract()
    projection_hash = frozen_governance_projection_sha256(contract)
    contract["frozenGovernanceProjectionSha256"] = projection_hash
    contract["implementation"]["frozenGovernanceProjectionSha256"] = projection_hash
    contract["implementation"]["controllerNormalizedSha256"] = controller_normalized_sha256()
    contract["implementation"]["testRawSha256"] = sha256_path(TEST_PATH)
    contract["contractSelfSha256"] = contract_self_sha256(contract)
    events = read_events()
    require(len(events) in (3, 4), "bootstrap requires exact Tag915 prefix with optional SC002 start skeleton")
    decision_event = events[2]
    require(decision_event["eventId"] == "Q010-EVT-00000003" and decision_event["sequence"] == 3, "bootstrap decision identity drift")
    require(decision_event["eventSha256"] == contract["decisionIntroductionBinding"]["tag915EventThreeSha256"], "bootstrap Tag915 decision prefix drift")
    if len(events) == 3:
        events.append({})
    event = events[3]
    event.clear()
    event.update({
        "schema": "early-detection-q010-sc002-governance-event/v1",
        "eventId": "Q010-EVT-00000004",
        "sequence": 4,
        "eventType": "SUBCHUNK_WORK_STARTED",
        "previousEventSha256": decision_event["eventSha256"],
        "createdAt": contract["startFinalization"]["eventCreatedAtUtc"],
        "contractSelfSha256": contract["contractSelfSha256"],
        "payload": start_payload(contract),
        "eventSha256": None,
    })
    event["eventSha256"] = event_self_sha256(event)
    state = expected_state(contract, events)
    contract_raw = json.dumps(contract, ensure_ascii=False, indent=2) + "\n"
    event_raw = "".join(json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for item in events)
    state_raw = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    result = {
        "controllerNormalizedSha256": controller_normalized_sha256(),
        "contractRawSha256": sha256_bytes(contract_raw.encode("utf-8")),
        "contractSelfSha256": contract["contractSelfSha256"],
        "decisionEventSha256": decision_event["eventSha256"],
        "startEventSha256": event["eventSha256"],
        "eventsRawSha256": sha256_bytes(event_raw.encode("utf-8")),
        "stateRawSha256": sha256_bytes(state_raw.encode("utf-8")),
        "stateSelfSha256": state["stateSelfSha256"],
        "projectionSha256": canonical_sha(state["projection"]),
        "frozenGovernanceProjectionSha256": projection_hash,
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
    attacks: list[str] = []

    def rebind(c: dict, e: list[dict]) -> dict:
        c["contractSelfSha256"] = contract_self_sha256(c)
        e[3]["contractSelfSha256"] = c["contractSelfSha256"]
        e[3]["createdAt"] = c["startFinalization"]["eventCreatedAtUtc"]
        e[3]["payload"] = start_payload(c)
        e[3]["eventSha256"] = event_self_sha256(e[3])
        return expected_state(c, e)

    def rejected(name: str, mutate) -> None:
        c, e = copy.deepcopy(contract), copy.deepcopy(events)
        mutate(c, e)
        s = rebind(c, e)
        try:
            validate_bundle(c, e, s, check_files=False)
        except GateError:
            attacks.append(name)
            return
        fail("mutation survived: " + name)

    rejected("subchunk-id", lambda c, e: c["decision"].__setitem__("subchunkId", "Q010-SC-999"))
    rejected("target-population", lambda c, e: c["decision"].__setitem__("targetEntityOrFrozenPopulationId", "WINNERS_ONLY"))
    rejected("target-theme", lambda c, e: c["decision"].__setitem__("targetThemeOrThemeEraId", "MODERN_THEME"))
    rejected("dimension-drop", lambda c, e: c["decision"].__setitem__("targetDimensions", ["T", "E"]))
    rejected("work-class", lambda c, e: c["decision"].__setitem__("workClass", "CORE"))
    rejected("admission", lambda c, e: c["decision"].__setitem__("supportingAdmissionCriterion", "COLLECT_MORE_DATA"))
    rejected("named-gate", lambda c, e: c["decision"].__setitem__("namedCoreGate", "NONE"))
    rejected("bias-drop", lambda c, e: c["decision"]["namedBiasesPrevented"].pop())
    rejected("continue-forever", lambda c, e: c["decision"].__setitem__("continuationCriterion", "CONTINUE_FOREVER"))
    rejected("never-stop", lambda c, e: c["decision"].__setitem__("pauseOrStopCriterion", "NEVER_STOP"))
    rejected("credit", lambda c, e: c["decision"].__setitem__("scientificCredit", "FULL"))
    rejected("timing-claim", lambda c, e: c["decision"].__setitem__("preChunkTimingClaimRecorded", False))
    rejected("timing-falsified", lambda c, e: c["decision"].__setitem__("preChunkTimingVerifiedAtDraft", True))
    rejected("backdate", lambda c, e: c["decision"].__setitem__("decisionRecordedAt", "2026-08-13T20:00:00Z"))
    rejected("work-started", lambda c, e: c["decision"].__setitem__("workStarted", True))
    rejected("source-authorized", lambda c, e: c["decision"].__setitem__("sourceAccessAuthorized", True))
    rejected("retroactive", lambda c, e: c["decision"].__setitem__("noRetroactiveAuthorization", False))
    rejected("tag914-commit", lambda c, e: c["parentTag914Binding"].__setitem__("commit", "0" * 40))
    rejected("tag914-hold", lambda c, e: c["parentTag914Binding"].__setitem__("requiredChunkStatus", "PASS"))
    rejected("tag914-next", lambda c, e: c["parentTag914Binding"].__setitem__("requiredNextQ010SubchunkAuthorized", True))
    rejected("tag914-incident", lambda c, e: c["parentTag914Binding"].__setitem__("requiredBlindingIncidentOccurred", False))
    rejected("event-prefix", lambda c, e: c["parentGovernanceV1PrefixBinding"].__setitem__("eventTwoSha256", "0" * 64))
    rejected("decision-sequence", lambda c, e: c["parentGovernanceV1PrefixBinding"].__setitem__("sc002DecisionSequence", 2))
    rejected("census-row-drop", lambda c, e: c["targetPopulationPolicy"]["treatmentRows"].pop())
    rejected("census-row-rename", lambda c, e: c["targetPopulationPolicy"]["treatmentRows"][0].__setitem__("reportedLegalName", "Famous Winner"))
    rejected("control-famous-winners", lambda c, e: c["targetPopulationPolicy"].__setitem__("controlFrameEnumerationRule", "HAND_PICK_ONLY_FAMOUS_WINNERS"))
    rejected("tag912-control-rule", lambda c, e: c["targetPopulationPolicy"].__setitem__("tag912PopulationRuleMayNotBeNarrowedOrExpanded", False))
    rejected("filing-window-membership", lambda c, e: c["targetPopulationPolicy"].__setitem__("filingActivityWindowCannotRestrictControlMembership", False))
    rejected("incomplete-exchange-frame", lambda c, e: c["targetPopulationPolicy"].__setitem__("missingOrUnprovenCompleteOfficialUniversePolicy", "USE_SEC_FILERS_ONLY"))
    rejected("unresolved-control-drop", lambda c, e: c["targetPopulationPolicy"].__setitem__("unresolvedPotentialEligibilityRemainsInCandidateSupersetAsTypedHold", False))
    rejected("security-type-prefilter", lambda c, e: c["targetPopulationPolicy"].__setitem__("securityTypeFilteringBeforeCompleteUniverseFreezeForbidden", False))
    rejected("security-type-status-drop", lambda c, e: c["targetPopulationPolicy"]["enumerationAuditStatusDomain"].remove("INELIGIBLE_RESOLVED_SECURITY_TYPE"))
    rejected("dmv-treatment-match-status-drop", lambda c, e: c["targetPopulationPolicy"]["enumerationAuditStatusDomain"].remove("INELIGIBLE_RESOLVED_DMV_TREATMENT_MATCH"))
    rejected("control-sic", lambda c, e: c["targetPopulationPolicy"]["controlSicCodes"].pop())
    rejected("control-mic", lambda c, e: c["targetPopulationPolicy"]["allowedExchangeMics"].append("OTCM"))
    rejected("partial-frame", lambda c, e: c["targetPopulationPolicy"].__setitem__("partialFrameUseForbidden", False))
    rejected("survivorship", lambda c, e: c["targetPopulationPolicy"].__setitem__("laterDeadAcquiredBankruptOrDelistedRowsRetainedWithoutViewingLabels", False))
    rejected("knownat-from-effective", lambda c, e: c["identitySecurityListingSemantics"].__setitem__("availabilityKnownAtNeverDerivedFromEffectiveDate", False))
    rejected("entity-fields-empty", lambda c, e: c["identitySecurityListingSemantics"].__setitem__("requiredEntityFields", []))
    rejected("relationship-fields-empty", lambda c, e: c["identitySecurityListingSemantics"].__setitem__("requiredRelationshipFields", []))
    rejected("ledger-source-reference-empty", lambda c, e: c["identitySecurityListingSemantics"].__setitem__("allLedgerSourceIdsMustBeNonEmptyUniqueAndResolveToAcceptedSourceRecords", False))
    rejected("ledger-knownat-not-source-max", lambda c, e: c["identitySecurityListingSemantics"].__setitem__("entitySecurityListingAndRelationshipKnownAtMustEqualMaximumAcceptedReferencedSourceKnownAt", False))
    rejected("record-knownat-not-source-max", lambda c, e: c["identitySecurityListingSemantics"].__setitem__("recordKnownAtUtcMustEqualMaximumAcceptedReferencedSourceKnownAt", False))
    rejected("rewrite-superseded", lambda c, e: c["identitySecurityListingSemantics"].__setitem__("supersededRecordRemainsImmutable", False))
    rejected("open-interval-current", lambda c, e: c["identitySecurityListingSemantics"].__setitem__("effectiveToNullMeaning", "STILL_CURRENT_IN_2026"))
    rejected("retrieval-as-knownat", lambda c, e: c["identitySecurityListingSemantics"].__setitem__("retrievedAtNeverUsedAsHistoricalKnownAt", False))
    rejected("assumed-midnight", lambda c, e: c["identitySecurityListingSemantics"].__setitem__("timezoneMissingPolicy", "ASSUME_UTC"))
    rejected("multiple-listing-resolve", lambda c, e: c["identitySecurityListingSemantics"].__setitem__("multipleActiveListingsOrClassesPolicy", "PICK_PRIMARY"))
    rejected("current-parent", lambda c, e: c["identitySecurityListingSemantics"].__setitem__("currentParentNearestListedParentAndRetrospectiveSuccessorForbidden", False))
    rejected("parent-hops", lambda c, e: c["identitySecurityListingSemantics"].__setitem__("parentOrSuccessorMaxHops", 9))
    rejected("source-before-start", lambda c, e: c["sourcePolicy"].__setitem__("sourceAccessBeforeStartRemoteIntroductionForbidden", False))
    rejected("price-field-unforbidden", lambda c, e: c["sourcePolicy"]["forbiddenEvidenceFields"].remove("PRICE"))
    rejected("lawful-access", lambda c, e: c["sourcePolicy"].__setitem__("lawfulReproducibleAccessRequired", False))
    rejected("knownat-map", lambda c, e: c["sourcePolicy"]["availabilityKnownAtDerivationByEvidenceClass"].__setitem__("SEC_EDGAR_ASFILED_MASTER_INDEX", "EFFECTIVE_DATE"))
    rejected("source-record-field-drop", lambda c, e: c["sourcePolicy"]["requiredSourceRecordFields"].remove("sourceId"))
    rejected("source-knownat-caller-supplied", lambda c, e: c["sourcePolicy"].__setitem__("sourceRecordKnownAtCannotBeCallerSuppliedOrBackdated", False))
    rejected("current-identifier-source", lambda c, e: c["sourcePolicy"].__setitem__("currentSecCompanyTickersProfilesOrCurrentExchangeMapsForbidden", False))
    rejected("secondary-credit", lambda c, e: c["sourcePolicy"].__setitem__("secondarySources", "LEDGER_CREDIT"))
    rejected("raw-render", lambda c, e: c["sourcePolicy"].__setitem__("operatorAndLlmMaySeeOnlyFieldAllowlistedNonPriceProjection", False))
    rejected("paid-source", lambda c, e: c["sourcePolicy"].__setitem__("acquisitionCost", "PAID"))
    rejected("budget-order", lambda c, e: c["retrievalBudgetPolicy"]["fixedRetrievalOrder"].reverse())
    rejected("budget-asymmetry", lambda c, e: c["retrievalBudgetPolicy"].__setitem__("sameBudgetForTreatmentAndControlRows", False))
    rejected("budget-transfer", lambda c, e: c["retrievalBudgetPolicy"].__setitem__("unusedBudgetCannotBeTransferredBetweenRows", False))
    rejected("budget-credit", lambda c, e: c["retrievalBudgetPolicy"].__setitem__("scientificCredit", "FULL"))
    rejected("shared-budget-delete", lambda c, e: c["retrievalBudgetPolicy"]["sharedOfficialBulkBudgetByEvidenceClass"].pop("FINRA_DAILY_LIST_OR_OFFICIAL_OTC_IDENTITY_BOUNDARY"))
    rejected("shared-budget-transfer", lambda c, e: c["retrievalBudgetPolicy"].__setitem__("sharedBulkBudgetIsHardCapAndCannotTransferAcrossClassesOrRows", False))
    rejected("partial-budget-result", lambda c, e: c["retrievalBudgetPolicy"].__setitem__("budgetExhaustedBeforeCompleteFramePolicy", "USE_PARTIAL"))
    rejected("hold-set", lambda c, e: c["holdConflictPolicy"]["typedHoldStates"].pop())
    rejected("silent-drop", lambda c, e: c["holdConflictPolicy"].__setitem__("silentDropUnknownOrNullStatusForbidden", False))
    rejected("control-matching", lambda c, e: c["controlPopulationPolicy"].__setitem__("controlMatchingInThisSubchunkForbidden", False))
    rejected("outcome-balance", lambda c, e: c["controlPopulationPolicy"].__setitem__("outcomeBalanceClaimForbidden", False))
    rejected("filter-before-freeze", lambda c, e: c["controlPopulationPolicy"].__setitem__("completeOfficialListingUniverseMustBeFrozenBeforeEligibilityFiltering", False))
    rejected("tel-coding", lambda c, e: c["controlPopulationPolicy"].__setitem__("telCodingInThisSubchunkForbidden", False))
    rejected("partial-controls", lambda c, e: c["controlPopulationPolicy"].__setitem__("partialResolvedSubsetUseForbidden", False))
    rejected("price-access", lambda c, e: c["prohibitedAccessPolicy"].__setitem__("pricesAccessed", True))
    rejected("return-access", lambda c, e: c["prohibitedAccessPolicy"].__setitem__("returnsAccessed", True))
    rejected("gqs-access", lambda c, e: c["prohibitedAccessPolicy"].__setitem__("gqsAccessed", True))
    rejected("outcome-access", lambda c, e: c["prohibitedAccessPolicy"].__setitem__("outcomesAccessed", True))
    rejected("cure-incident", lambda c, e: c["prohibitedAccessPolicy"].__setitem__("successfulLedgerCannotCureSc001BlindingIncident", False))
    rejected("public-pass", lambda c, e: c["stopAndOutputPolicy"].__setitem__("publicVerificationWithoutPrivateStoreMaximumStatus", "PASS"))
    rejected("unbounded-expansion", lambda c, e: c["stopAndOutputPolicy"].__setitem__("noUnboundedIdentityExpansionBeyondFrozenFrames", False))
    rejected("automatic-next", lambda c, e: c["stopAndOutputPolicy"].__setitem__("noAutomaticNextSubchunk", False))
    rejected("future-start-id", lambda c, e: c["startEventContract"].__setitem__("eventId", "Q010-EVT-00000003"))
    rejected("future-start-prefix", lambda c, e: c["startEventContract"].__setitem__("tag916EventLogMustRetainExactTag915ThreeEventBytePrefix", False))
    rejected("future-start-parent-blobs", lambda c, e: c["startEventContract"].__setitem__("tag916MustVerifyAllFiveTag915ParentBlobsAndTag915ContractSelfHashStateReplayAndEvent3Hash", False))
    rejected("future-start-policy-rewrite", lambda c, e: c["startEventContract"].__setitem__("tag916FrozenGovernanceProjectionMustEqualTag915", False))
    rejected("future-start-causal-order", lambda c, e: c["startEventContract"]["firstRetrievalAuditContract"].__setitem__("exactCausalOrder", "EVENT4_AFTER_RETRIEVAL_ALLOWED"))
    rejected("future-start-price", lambda c, e: c["startEventContract"]["requiredPayload"].__setitem__("pricesAccessed", True))
    rejected("future-start-same-commit", lambda c, e: c["startEventContract"]["remoteIntroduction"].__setitem__("requiredParent", "TAG914"))
    rejected("retrieval-audit", lambda c, e: c["startEventContract"]["firstRetrievalAuditContract"].__setitem__("remoteObservedAtUtcRequired", False))
    rejected("tag915-binding-commit", lambda c, e: c["decisionIntroductionBinding"].__setitem__("tag915Commit", "0" * 40))
    rejected("tag915-binding-blob", lambda c, e: c["decisionIntroductionBinding"]["parentBlobs"][0].__setitem__("rawSha256", "0" * 64))
    rejected("tag915-binding-prefix", lambda c, e: c["decisionIntroductionBinding"].__setitem__("exactThreeEventPrefixBytes", 1))
    rejected("tag915-observed-before-commit", lambda c, e: c["decisionIntroductionBinding"].__setitem__("tag915RemoteObservedAtUtc", "2026-08-13T23:00:00Z"))
    rejected("start-event-before-tag915-observation", lambda c, e: c["startFinalization"].__setitem__("eventCreatedAtUtc", "2026-08-13T23:25:00Z"))
    rejected("start-authorization-effective-local", lambda c, e: c["startFinalization"].__setitem__("sourceAccessAuthorizationEffectiveOnlyAfterTag916RemoteIntroduction", False))
    rejected("event4-predecessor", lambda c, e: e[3].__setitem__("previousEventSha256", "0" * 64))
    rejected("premature-first-retrieval", lambda c, e: c["startFinalization"].__setitem__("firstResearchSourceRetrievedAtUtc", "2026-08-13T23:26:23Z"))
    rejected("event-type", lambda c, e: e[2].__setitem__("eventType", "SUBCHUNK_WORK_STARTED"))
    rejected("event-predecessor", lambda c, e: e[2].__setitem__("previousEventSha256", "0" * 64))
    rejected("event-source-access", lambda c, e: e[2]["payload"].__setitem__("researchSourceAccessAuthorized", True))
    rejected("sc001-status", lambda c, e: c["sc001CarryForwardPolicy"].__setitem__("sc001ChunkStatus", "PASS"))
    rejected("sc001-incident", lambda c, e: c["sc001CarryForwardPolicy"].__setitem__("sc001IncidentId", None))
    rejected("sc001-credit", lambda c, e: c["sc001CarryForwardPolicy"].__setitem__("sc001ScientificCredit", "FULL"))
    rejected("system-built", lambda c, e: c["sc001CarryForwardPolicy"].__setitem__("earlyDetectionSystemBuilt", True))
    require(len(attacks) == 105, "self-test kill count drift")
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
        if args.command == "start" and not result["researchSourceAccessAuthorized"]:
            fail("SC002 source access is not authorized until the separate start event is remotely introduced")
        print(json.dumps(result, sort_keys=True))
        return 0
    except (GateError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
