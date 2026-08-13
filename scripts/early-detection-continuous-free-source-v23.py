#!/usr/bin/env python3
"""Replay-only, remote-gated controller restoring the FEM research core in V23."""
from __future__ import annotations

import argparse
import ast
import copy
import datetime
import hashlib
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / 'research' / 'early-detection-v4' / 'continuous-free-source-operational-state-contract-v23.json'
EVENTS = ROOT / 'state' / 'early-detection-free-source-events-v23.jsonl'
STATE = ROOT / 'state' / 'early-detection-free-source-state-v23.json'
TEST = ROOT / 'tests' / 'early-detection-continuous-free-source-v23.test.js'
V22_EVENTS = ROOT / 'state' / 'early-detection-free-source-events-v22.jsonl'
V22_STATE = ROOT / 'state' / 'early-detection-free-source-state-v22.json'
HYPOTHESIS_VERIFIER = ROOT / 'scripts' / 'verify-hypothesis-register-v3.py'

REMOTE = 'https://github.com/Karlryl/screener-data.git'
REF = 'refs/heads/codex/early-detection-v4-gates-20260810'
BASE = 'd6567c86e5ccba9f0a4d904113b2e2a9d06ef2ff'
CREATED_AT = '2026-08-13T20:24:26Z'
RESEARCH_QUESTION = 'Can a strictly point-in-time early-detection matrix identify durable growth companies at least two published quarters before first GQS qualification and, in a meaningful share of cases, before the primary price breakout?'
PURPOSE = 'Restore the preregistered early-detection core as the highest-priority autonomous work while retaining every supporting SEC, identity, point-in-time, delisting and terminal-value workstream whenever it removes a named bias or unblocks a named core test.'
INTRODUCTION_SUBJECT = 'Tag 911: Früherkennungskern operativ priorisieren'

EXPECTED_CONTRACT_RAW = '91268dc731fc83e412b984ca36aae18218dd999c47f45d2e66e59f44a1e24424'
EXPECTED_CONTROLLER_NORMALIZED = 'd83fe1436df385d5bf42cb553bc5cd54c2de8bbb0d41782add078ee3dc9c2499'
EXPECTED_TEST_RAW = '5f48a6e91066d3bd1bcbd297a9ef6438c3ddb54bac9594381569906f055f2a0d'
EXPECTED_EVENTS_RAW = '8aaf40ed59d6c0dbc56aa6438c662b8cdfcf5ca0e903a0c11690685f29621c1e'
EXPECTED_STATE_RAW = '29d40b8d2a34c8d2377b086ea92154ddbc41a72670bff79bd9b41922a1cb5297'
EXPECTED_STATE_SELF = 'cf42f4d20c2661e8280d586cfbc66dbb3e0acc536114c7b174fbf5029202260b'
EXPECTED_PROJECTION_SHA = '40def6b5983646add71e28edb02d125a0561346933d3151cd5ff0caa483337fc'
SUPERSEDED_DRAFT_EVENTS_RAW = 'c96a6d7cd6b5778586657189ab5979e14a9a6d178398d895fe0b0b65dc5c2226'
SUPERSEDED_DRAFT_STATE_RAW = '0d4ca762feb696947becd8afe5e177f7cd0425e57f17e9f839932a2c40e58278'
CONTROLLER_CHILD_EXECUTIONS = 0

AUTHORIZED = [
    'research/early-detection-v4/continuous-free-source-operational-state-contract-v23.json',
    'scripts/early-detection-continuous-free-source-v23.py',
    'state/early-detection-free-source-events-v23.jsonl',
    'state/early-detection-free-source-state-v23.json',
    'tests/early-detection-continuous-free-source-v23.test.js',
]
INPUT_PATHS = {
    'v22Contract': 'research/early-detection-v4/continuous-free-source-operational-state-contract-v22.json',
    'v22Controller': 'scripts/early-detection-continuous-free-source-v22.py',
    'v22Test': 'tests/early-detection-continuous-free-source-v22.test.js',
    'v22EventLog': 'state/early-detection-free-source-events-v22.jsonl',
    'v22State': 'state/early-detection-free-source-state-v22.json',
    'preregistration': 'protocol/early-detection/1.2.0/preregistration.json',
    'hypothesisContract': 'research/early-detection-v4/hypothesis-register-contract-v3.json',
    'hypothesisVerifier': 'scripts/verify-hypothesis-register-v3.py',
    'hypothesisTest': 'tests/verify-hypothesis-register-v3.test.js',
}
EXPECTED_INPUT_RAW = {
    'v22Contract': '49a1f176971ec0e587de946b7c12fb43343bb4e14ad7e17ccc22f10069a87294',
    'v22Controller': '30f2b98e3ac5968be548ee8f155250bac50fd5cb08d23319f2ab5da7039dd0b2',
    'v22Test': '15e470bded0a8afca5720d430bad995e5ce2d8890dbb5569a804ad7c8818baf0',
    'v22EventLog': '3b78c6604578417e629b121a7829073dbd4c870e2fc111521e6eaa561c8b5ecc',
    'v22State': '9439271eec9c95eb52ae270264b6607e65037a779f58bdcf95eece52c48ab298',
    'preregistration': '894caf1c5ba0a65a17d1f252c62514dcf169168de14d78834e38811712d1e18f',
    'hypothesisContract': '253cd6b42d40da895d09d36bf6448a7051a12bb6bea27f77248addb793a83a9d',
    'hypothesisVerifier': '79575ba1a56b97df9690109537631b3d5ff9838012dd85337956523543dbdc7d',
    'hypothesisTest': '3d80874a0da1e6ae033865840ca4837af365af859776f69596e2892fc9aab8e7',
}
MILESTONES = [
    {'tag': 908, 'commit': 'c3187d1b1c3d376fd0906192bfac7c5a07910148', 'parent': 'b39a0b269a0562ec746a286a95df2f59a9f18588', 'subject': 'Tag 908: Spaete SEC-Periodik operativ fortschreiben', 'workstream': 'CONTROLLER_LINEAGE_V22', 'artifactCount': 5, 'deltaSha256': '82e4bc3b7de981e7ae5ff248e3d3b288eb80a7644e7d1f0d31fdda4fdbc7221b', 'status': 'OPERATIONAL_MILESTONE_NO_CREDIT'},
    {'tag': 909, 'commit': 'ccc15de0666e605e7a3a211dead6c9f8e8b05ea9', 'parent': 'c3187d1b1c3d376fd0906192bfac7c5a07910148', 'subject': 'Tag 909: Strukturierte SEC-Folgefilings vorab versiegeln', 'workstream': 'Q003_NPORT_DISCOVERY', 'artifactCount': 3, 'deltaSha256': 'e59c33c2639a9546838b679e13dee50638996c0019866baa6aedc082cddf8c20', 'status': 'SUPPORTING_DATA_FOUNDATION_NO_CREDIT'},
    {'tag': 910, 'commit': BASE, 'parent': 'ccc15de0666e605e7a3a211dead6c9f8e8b05ea9', 'subject': 'Tag 910: Strukturierte SEC-Folgefilings privat erfassen', 'workstream': 'Q003_NPORT_PRIVATE_CAPTURE_INFRASTRUCTURE', 'artifactCount': 3, 'deltaSha256': '58c78fe1ef4eb3d549282240e85c6ce2e6b56668b2d01d3acfc3819ae7ea2094', 'status': 'SUPPORTING_DATA_FOUNDATION_NO_CREDIT'},
]
EXPECTED_TASK_IDS = [
    'Q001-QUANTCONNECT-TERMS-ACCOUNT', 'Q002-QUANTCONNECT-50-CASE-CONTRACT',
    'Q003-SEC-TERMINAL-WEALTH-QUEUE', 'Q004-FINRA-OTC-CATALOG',
    'Q005-US-EXCHANGE-PUBLIC-CATALOGS', 'Q006-TIINGO-FREE-ENTITLEMENT',
    'Q007-OPENFIGI-ANONYMOUS-HANDSHAKE', 'Q008-BUSINESS-QUANT-FREE-HANDSHAKE',
    'Q009-ALPHA-VANTAGE-NEGATIVE-CONTROL', 'Q010-RESEARCH-ARCHIVE-DISCOVERY',
]
TASK_WORK_CLASS = {task_id: ('CORE' if task_id == 'Q010-RESEARCH-ARCHIVE-DISCOVERY' else 'SUPPORTING') for task_id in EXPECTED_TASK_IDS}
PAUSED_SUPPORTING_TASKS = {
    'Q003-SEC-TERMINAL-WEALTH-QUEUE': 'PAUSE_SUPPORTING_SEC_EXPANSION_UNTIL_TASK_BOUND_NAMED_GATE_OR_BIAS_REQUIRES_RESUMPTION',
    'Q004-FINRA-OTC-CATALOG': 'PAUSE_SUPPORTING_FINRA_RECONCILIATION_UNTIL_TASK_BOUND_NAMED_GATE_OR_BIAS_REQUIRES_RESUMPTION',
    'Q005-US-EXCHANGE-PUBLIC-CATALOGS': 'PAUSE_SUPPORTING_EXCHANGE_RECONCILIATION_UNTIL_TASK_BOUND_NAMED_GATE_OR_BIAS_REQUIRES_RESUMPTION',
}
EVIDENCE_POLICIES = {
    'V23-SCHEDULER-COURSE-CORRECTION': {
        'requiredBindings': ['PREREGISTERED_RESEARCH_QUESTION', 'FIVE_CLOCK_ARCHITECTURE', 'TASK_WORK_CLASS', 'TASK_BOUND_NEXT_DECISION', 'NO_IMPLICIT_SUPPORTING_FALLBACK'],
        'schedulerMustSelectOnlyTaskBoundAuthorizedDecision': True,
        'supportingTasksRequireSeparateAdmissionRecord': True,
        'scientificCredit': 'NONE',
    },
    'V23-CONSTANT-TIME-TRUST-ANCHOR': {
        'requiredBindings': ['BASE_COMMIT', 'LIVE_REMOTE', 'V22_RAW_BYTES', 'V22_EVENT_STATE_REPLAY', 'V22_INTRODUCTION_TOPOLOGY', 'V22_FULL_HISTORY_RECEIPT'],
        'recursivePredecessorControllerExecutionForbidden': True,
        'scientificCredit': 'NONE',
    },
    'Q010-PRE2021-PIT-TEL-CORPUS': {
        'requiredSourceRecordFields': [
            'sourceId', 'sourceClass', 'sourceAuthority', 'sourceAuthorityTier', 'sourceUri', 'sourceTimestamp', 'observationTimestamp',
            'knownAt', 'retrievedAt', 'capturedAt', 'payloadSha256', 'archivedRawPayloadId', 'cutoff', 'acquisitionCost', 'accessRights',
            'acquisitionProvenance', 'contemporaneousTerminology', 'rawExcerptMapping',
        ],
        'requiredSignalEvidenceFields': [
            'evidenceId', 'entityId', 'themeId', 'dimension', 'level', 'referencedSourceIds',
            'dimensionKnownAt', 'contemporaneousRationale', 'rawExcerptMapping',
        ],
        'signalDimensions': ['T', 'E', 'L'],
        'signalLevelDomain': [0, 1, 2, 3],
        'dimensionLevelDefinitions': {
            'T': {
                '0': 'speculation',
                '1': 'technical feasibility or scientific breakthrough',
                '2': 'observable investment, orders, regulation or commercial introduction',
                '3': 'accelerating real adoption with measurable bottlenecks or demand',
            },
            'E': {
                '0': 'narrative mention only',
                '1': 'indirect or replaceable participation',
                '2': 'documented product, customer, order or necessary infrastructure',
                '3': 'material exposure, bottleneck, pricing power or hard-to-replace value capture',
            },
            'L': {
                '0': 'no reliable signal',
                '1': 'one weak signal',
                '2': 'at least two independent signals',
                '3': 'repeated filing evidence or filing evidence plus independent external evidence',
            },
        },
        'managementStatementsAloneMaximumL': 1,
        'dimensionKnownAtMustEqualMaximumReferencedSourceKnownAt': True,
        'crossEntityCrossThemeOrMissingSourceAssemblyRejected': True,
        'timeCapsuleRequiresSameEntityIdAndThemeId': True,
        'negativeControlsMustBeTypedSeparately': True,
        'negativeControlsCannotSetCandidateState': True,
        'requiredTimeCapsuleFields': [
            'capsuleId', 'entityId', 'themeId', 'identityRecordId', 'identityKnownAt', 'identityEvidenceSourceIds',
            'listingId', 'securityId', 'cik', 'effectiveTicker', 'exchange', 'identityEffectiveFrom',
            'identityEffectiveTo', 'evaluationAt', 'referencedTELEvidenceIds',
            'signalKnownAt', 'growthVisibleAsOfEvaluationAt', 'growthVisibilityKnownAt',
            'growthVisibilityEvidenceIds', 'growthVisibilityCanonicalInputFingerprint', 'state',
        ],
        'timeCapsuleStateRules': {
            'RESEARCH_WATCH': 'T>=2 and E>=2 and L>=1',
            'PRE_GROWTH_CANDIDATE': 'T>=2 and E>=2 and L>=2 and growthVisible=false at evaluationAt; no future outcome timestamp may enter classification',
        },
        'signalKnownAtMustBeComputedAsMaximumAcceptedTELDimensionKnownAt': True,
        'callerSuppliedSignalKnownAtCannotMoveClassification': True,
        'evaluationAtMustBeExactTimezoneQualifiedAndNotBeforeSignalKnownAt': True,
        'evaluationAtMustNotExceedMaximumSignalKnownAtCutoff': True,
        'growthVisibilityRuleVersion': 'FEM_VISIBLE_GROWTH_V1',
        'growthVisibilityInputMustBeRawAsFiledQuarterRows': True,
        'growthVisibilityScansEveryEntityQuarterWithExactConsecutiveQMinus8ThroughQ': True,
        'growthVisibilityCallsSealedGrowthVisibilityAtInternally': True,
        'callerSuppliedGrowthVisibilityOrHashIgnored': True,
        'growthVisibilityKnownAtMustEqualMaximumRequiredSECAndPercentileAvailability': True,
        'growthVisibilityKnownAtMustNotExceedEvaluationAt': True,
        'pendingMissingNonpositiveDenominatorMissingTimestampOrNoCompleteWindowIsNotComputable': True,
        'notComputableCannotCreatePreGrowthCandidate': True,
        'visibleGrowthIsStickyTrueAcrossLaterPrimaryVintages': True,
        'growthVisibilityCanonicalInputFingerprintRequired': True,
        'preGrowthRequiresGrowthVisibleFalseAsOfEvaluationAt': True,
        'futureFundamentalOrOutcomeEvidenceForbidden': True,
        'timeCapsuleTELMustShareEntityIdAndThemeId': True,
        'pointInTimeIdentityListingRecordRequired': True,
        'identityKnownAtMustBeExactTimezoneQualifiedAndNotExceedEvaluationAt': True,
        'identityEvidenceSourceIdsMustResolveToAcceptedSourceRecords': True,
        'danglingSourceEvidenceOrIdentityReferencesAreRejectedHold': True,
        'exactlyOneEffectiveIdentityListingAtEvaluationAtRequired': True,
        'currentTickerJoinForbidden': True,
        'identityOverlapOrUnresolvedIsRejectedHold': True,
        'thenIdentifiableListedBeneficiaryRequired': True,
        'frozenThemeEraPopulationRequiredBeforeCompanySelection': True,
        'frozenPopulationMustIncludeWinnersFailuresAndMatchedControls': True,
        'individualCompanySelectionAfterOutcomeViewingForbidden': True,
        'epistemicStatus': 'PSEUDO_PROSPECTIVE_HISTORICAL_RECONSTRUCTION_NEVER_FULLY_BLIND',
        'earliestClaimLimitedToEarliestEvidenceFoundInFrozenCorpusNeverEarliestEvidenceThatExisted': True,
        'qualitativeCodingRequiredFields': ['as_of', 'source_id', 'exact_locator', 'published_at', 'retrieved_at', 'evidence_class', 'counterevidence', 'coder_id', 'version'],
        'qualitativeCodingBlinding': 'CODERS_SEE_ONLY_SOURCES_AVAILABLE_BY_CUTOFF_AND_NEVER_LATER_SOURCES_PRICES_GQS_DATES_OR_OUTCOME_LABELS',
        'doubleCodingRequired': True,
        'weightedCohenKappaMinimumPerDimension': 0.70,
        'exactAgreementMinimum': 0.80,
        'agreementFailureAction': 'REVISE_RULES_IN_DEVELOPMENT_WINDOW_ONLY_DO_NOT_OPEN_LOCKED_OUTCOMES',
        'equalResearchBudgetRequiredAcrossWinnersFailuresAndMatchedControls': True,
        'llmLabelsNeverCountAsBlindedIndependentCoding': True,
        'sourceClassMustBeMapped': True,
        'sourceClassAvailabilityContractMustPassFailClosed': True,
        'dayLevelSourceRegistryIsBibliographicOnlyAndNotSignalEligible': True,
        'sourceTimestampMustBeExactTimezoneQualified': True,
        'observationTimestampMustBeExactTimezoneQualified': True,
        'knownAtMustBeExactTimezoneQualifiedMaximumOfRequiredTimestamps': True,
        'retrievedAtAndCapturedAtMustBeExactTimezoneQualified': True,
        'retrievalOrCaptureMayOccurAfterHistoricalCutoff': True,
        'retrievalOrCaptureTimestampCannotSubstituteForHistoricalAvailabilityKnownAt': True,
        'payloadSha256Required': True,
        'payloadSha256MustMatchExactArchivedRawBytes': True,
        'rawPayloadMustBeContentAddressedAndImmutable': True,
        'sourceRecordMustBindExactArchivedRawPayload': True,
        'frozenCutoffRequired': True,
        'maximumObservedDate': '2020-12-31',
        'maximumSignalKnownAt': '2020-12-31T23:59:59Z',
        'maximumSignalKnownAtSemantics': 'INCLUSIVE_END_OF_DAY_UTC_AFTER_NORMALIZING_EVERY_TIMEZONE_QUALIFIED_TIMESTAMP_TO_UTC',
        'sourceObservationKnownAtAfterCutoffForbidden': True,
        'signalEligibleSourceAuthorityTier': 'PRIMARY',
        'signalEligibleAcquisitionCost': 'ZERO',
        'lawfulReproducibleAccessAndProvenanceRequired': True,
        'secondarySourcesAreLocatorOrContextOnlyAndCannotSetTEL': True,
        'contemporaneousTerminologyOrRawExcerptMappingRequired': True,
        'modernTermBackprojectionForbidden': True,
        'postCutoffSourceUseForbidden': True,
        'priceReturnOutcomeAccessForbiddenForHypothesisGeneration': True,
        'scientificCredit': 'NONE',
    },
}
WORK_POLICY = {
    'primaryStudyObjective': 'DETECT_FUTURE_THEMES_AND_DURABLE_GROWTH_COMPANIES_BEFORE_VISIBLE_GROWTH_GQS_AND_WHERE_POSSIBLE_PRICE_BREAKOUT',
    'fiveClockArchitecture': ['THEME', 'BENEFICIARY', 'OPERATIONS', 'MARKET', 'FUNDAMENTALS'],
    'independentCoreClocks': ['THEME', 'BENEFICIARY', 'OPERATIONS'],
    'confirmationClocks': ['MARKET', 'FUNDAMENTALS'],
    'pricesReturnsOutcomesForbiddenForHypothesisGeneration': True,
    'coreWorkAdmissionCriterion': 'DIRECT_PREREGISTERED_CORE',
    'supportingWorkAllowed': True,
    'supportingWorkAdmissionCriteria': ['PREVENT_NAMED_BIAS', 'SECURE_POINT_IN_TIME_SEMANTICS', 'RESOLVE_IDENTITY_OR_TERMINAL_OUTCOME', 'UNBLOCK_NAMED_CORE_TEST'],
    'supportingWorkContinuationRule': 'CONTINUE_WHILE_MARGINAL_EVIDENCE_OR_CORE_TEST_ENABLEMENT_EXCEEDS_OPEN_HIGHER_PRIORITY_CORE_WORK',
    'supportingWorkMustNotClaimScientificCredit': True,
    'unboundedSupportingExpansionForbidden': True,
    'supportingTaskResumeRequiresNewAppendOnlyDecisionEvent': True,
    'evidencePolicies': copy.deepcopy(EVIDENCE_POLICIES),
    'preChunkDecisionRecordRequiredForAllNewWork': True,
    'currentV23RetrospectiveMigrationException': 'CURRENT_CHUNK_ONLY_NO_CREDIT_TIMING_NOT_VERIFIED',
    'preChunkDecisionRecordMustBeMachineValidated': True,
    'requiredWorkChunkDecisionFields': [
        'chunkId', 'targetQueueTaskId', 'workClass', 'evidencePolicyId', 'coreObjectiveContribution', 'namedGateOrBias', 'admissionCriterion',
        'continuationCriterion', 'pauseOrStopCriterion', 'scientificCredit', 'decisionRecordedAt',
        'decisionTimingStatus', 'preChunkTimingVerified', 'workStarted', 'workStartedAt',
        'workMayStartAfter', 'decisionSourceEventId', 'decisionSourceEventSequence',
    ],
}
CURRENT_CORE_CHUNK = {
    'chunkId': 'V23-COURSE-CORRECTION-TO-PREREGISTERED-CORE',
    'targetQueueTaskId': 'Q010-RESEARCH-ARCHIVE-DISCOVERY',
    'workClass': 'CORE',
    'evidencePolicyId': 'V23-SCHEDULER-COURSE-CORRECTION',
    'coreObjectiveContribution': 'Restore Q010 as the task-bound highest-priority path to the outcome-blind T/E/L corpus.',
    'namedGateOrBias': ['SCHEDULER_OBJECTIVE_DRIFT'],
    'admissionCriterion': 'DIRECT_PREREGISTERED_CORE',
    'continuationCriterion': 'CONTINUE_THROUGH_EXACT_DIRECT_SINGLE_PARENT_TAG911_INTRODUCTION_AND_ALL_POST_INTRODUCTION_NORMAL_OPTIMIZED_NODE_VERIFY_AND_NEXT_GATES',
    'pauseOrStopCriterion': 'STOP_ONLY_AFTER_ALL_POST_INTRODUCTION_GATES_PASS; DO_NOT_EXPAND_OR_REWRITE_EARLIER_CONTROLLER_GENERATIONS',
    'scientificCredit': 'NONE',
    'decisionRecordedAt': CREATED_AT,
    'decisionTimingStatus': 'RETROSPECTIVE_MIGRATION_NO_CREDIT',
    'preChunkTimingVerified': False,
    'workStarted': True,
    'workStartedAt': None,
    'workMayStartAfter': 'WORK_ALREADY_IN_PROGRESS_BEFORE_MACHINE_RECORD_EXISTED',
    'decisionSourceEventId': 'EVT-00000011',
    'decisionSourceEventSequence': 11,
}
CURRENT_SUPPORTING_CHUNK = {
    'chunkId': 'V23-CONSTANT-TIME-V22-TRUST-ANCHOR',
    'targetQueueTaskId': 'Q010-RESEARCH-ARCHIVE-DISCOVERY',
    'workClass': 'SUPPORTING',
    'evidencePolicyId': 'V23-CONSTANT-TIME-TRUST-ANCHOR',
    'coreObjectiveContribution': 'Remove recursive predecessor verification as an operational blocker to the outcome-blind T/E/L corpus without weakening byte, Git, event, state or remote trust.',
    'namedGateOrBias': ['RECURSIVE_VERIFICATION_COST_BLOCKS_Q010_CORE_WORK'],
    'admissionCriterion': 'UNBLOCK_NAMED_CORE_TEST',
    'continuationCriterion': 'CONTINUE_ONLY_THROUGH_DIRECT_ANCHOR_AND_ALL_NORMAL_OPTIMIZED_NODE_REPLAY_REMOTE_AND_ADVERSARIAL_GATES',
    'pauseOrStopCriterion': 'STOP_AFTER_ALL_POST_INTRODUCTION_GATES_PASS; DO_NOT_REWRITE_OR_REEXECUTE_PREDECESSOR_HISTORY',
    'scientificCredit': 'NONE',
    'decisionRecordedAt': CREATED_AT,
    'decisionTimingStatus': 'RETROSPECTIVE_MIGRATION_NO_CREDIT',
    'preChunkTimingVerified': False,
    'workStarted': True,
    'workStartedAt': None,
    'workMayStartAfter': 'WORK_ALREADY_IN_PROGRESS_BEFORE_MACHINE_RECORD_EXISTED',
    'decisionSourceEventId': 'EVT-00000011',
    'decisionSourceEventSequence': 11,
}
CURRENT_WORK_CHUNKS = [CURRENT_CORE_CHUNK, CURRENT_SUPPORTING_CHUNK]
NEXT_WORK_CHUNK = {
    'chunkId': 'Q010-PRE2021-OUTCOME-BLIND-THEME-BENEFICIARY-OPERATIONS-CORPUS',
    'targetQueueTaskId': 'Q010-RESEARCH-ARCHIVE-DISCOVERY',
    'workClass': 'CORE',
    'evidencePolicyId': 'Q010-PRE2021-PIT-TEL-CORPUS',
    'coreObjectiveContribution': 'Create historically time-bounded primary-source T/E/L evidence needed to form RESEARCH_WATCH and PRE_GROWTH_CANDIDATE time capsules before visible growth.',
    'namedGateOrBias': ['RESEARCH_CORPUS_GATE', 'HINDSIGHT_AND_MODERN-TERM_BACKPROJECTION_BIAS'],
    'admissionCriterion': 'DIRECT_PREREGISTERED_CORE',
    'continuationCriterion': 'CONTINUE_ONLY_WHILE_EACH_PREAUTHORIZED_SUBCHUNK_CLOSES_A_NAMED_T_E_OR_L_COVERAGE_GATE_AND_ADVANCES_AN_ENTITY_THEME_COHERENT_TIME_CAPSULE_OR_TYPED_NEGATIVE_CONTROL',
    'pauseOrStopCriterion': 'PAUSE_ONE_DIMENSION_EXPANSION_IF_IT_DOES_NOT_CLOSE_A_NAMED_T_E_OR_L_COVERAGE_GATE_OR_ADVANCE_THE_NEXT_ENTITY_THEME_COHERENT_TIME_CAPSULE',
    'scientificCredit': 'NONE',
    'decisionRecordedAt': CREATED_AT,
    'decisionTimingStatus': 'PENDING_REMOTE_INTRODUCTION',
    'preChunkTimingVerified': False,
    'workStarted': False,
    'workStartedAt': None,
    'workMayStartAfter': 'EXACT_DIRECT_CHILD_INTRODUCTION_AND_ALL_POST_INTRODUCTION_GATES_PASS',
    'decisionSourceEventId': 'EVT-00000011',
    'decisionSourceEventSequence': 11,
}
Q010_SUBCHUNK_POLICY = {
    'eachSubchunkRequiresNewAppendOnlyPreChunkDecision': True,
    'requiredSubchunkDecisionFields': [
        'subchunkId', 'targetEntityOrFrozenPopulationId', 'targetThemeOrThemeEraId',
        'targetDimensions', 'namedCoverageGate', 'coherentTELAssemblyContribution',
        'continuationCriterion', 'pauseOrStopCriterion', 'scientificCredit',
        'decisionRecordedAt', 'preChunkTimingVerified', 'workStarted', 'workStartedAt',
        'workMayStartAfter', 'decisionSourceEventId', 'decisionSourceEventSequence',
    ],
    'targetDimensionsDomain': ['T', 'E', 'L'],
    'targetDimensionsMustBeNonemptyAndUnique': True,
    'targetEntityMustBelongToFrozenPopulation': True,
    'newSubchunkDecisionRequiresPreChunkTimingVerifiedTrueAndWorkStartedFalse': True,
    'subchunkWorkStartedAtMustBeNullUntilSubsequentAppendOnlyStartEvent': True,
    'subchunkStartEventMustBeAtOrAfterDecisionRecordedAt': True,
    'singleDimensionExpansionRequiresNamedCoverageGate': True,
    'singleDimensionExpansionMustAdvanceNextCoherentTimeCapsule': True,
    'unboundedBestInstrumentedDimensionExpansionForbidden': True,
    'scientificCredit': 'NONE',
}
EVIDENCE_POLICIES['Q010-PRE2021-PIT-TEL-CORPUS']['subchunkPolicy'] = copy.deepcopy(Q010_SUBCHUNK_POLICY)
WORK_POLICY['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['subchunkPolicy'] = copy.deepcopy(Q010_SUBCHUNK_POLICY)
SCHEDULER_POLICY = {
    'schema': 'early-detection-task-bound-scheduler-policy/v1',
    'taskWorkClassByTaskId': copy.deepcopy(TASK_WORK_CLASS),
    'eligibleTaskMustMatchNextDecisionTarget': True,
    'eligibleTaskWorkClassMustMatchNextDecision': True,
    'supportingEligibilityRequiresNamedTaskBoundAdmission': True,
    'supportingResumeRequiresNewAppendOnlyDecisionEvent': True,
    'implicitFallbackForbidden': True,
    'pausedSupportingTaskIds': list(PAUSED_SUPPORTING_TASKS),
    'pauseReasonByTaskId': copy.deepcopy(PAUSED_SUPPORTING_TASKS),
}
V22_RESULT = {
    'consumerArtifactsRemoteVerified': 1,
    'controllerResumeAllowed': True,
    'eligibleTasks': 4,
    'eventCount': 10,
    'introductionCommit': 'c3187d1b1c3d376fd0906192bfac7c5a07910148',
    'milestoneGitDeltasVerified': 8,
    'newMilestones': 8,
    'nextTaskId': 'Q003-SEC-TERMINAL-WEALTH-QUEUE',
    'operationalMilestones': 45,
    'originalV4GreenOfficialGates': 2,
    'originalV4OfficialGateCount': 13,
    'outcomesAccessed': False,
    'phase': 'POST_INTRODUCTION',
    'q002AutoNext': False,
    'remoteVerified': True,
    'resolvedTasks': 0,
    'schema': 'early-detection-free-source-operational-state-verification/v22',
    'status': 'PASS',
    'tasksConserved': 10,
    'v21PrefixVerified': True,
    'v21RemoteVerified': True,
}
V22_RESULT_SHA = 'b93a5028bfb75a4d39c92a79e3111e16240a7c6902f208436abb7a9443ff2634'
PREDECESSOR_TRUST_ANCHOR = {
    'schema': 'early-detection-predecessor-trust-anchor/v1',
    'recordedAt': '2026-08-13T19:37:10Z',
    'predecessorVersion': 22,
    'verifiedHead': BASE,
    'verifiedUpstream': BASE,
    'verifiedLiveRemote': BASE,
    'remote': REMOTE,
    'ref': REF,
    'introductionCommit': 'c3187d1b1c3d376fd0906192bfac7c5a07910148',
    'introductionParent': 'b39a0b269a0562ec746a286a95df2f59a9f18588',
    'introductionSubject': 'Tag 908: Spaete SEC-Periodik operativ fortschreiben',
    'anchorReceiptContainsExactlyOneFullHistoryRunPerMode': True,
    'verificationModes': [
        {
            'mode': 'NORMAL',
            'command': 'python -B scripts/early-detection-continuous-free-source-v22.py verify --remote',
            'exitCode': 0,
            'elapsedMilliseconds': 290461,
            'resultCanonicalSha256': V22_RESULT_SHA,
        },
        {
            'mode': 'OPTIMIZED',
            'command': 'python -O -B scripts/early-detection-continuous-free-source-v22.py verify --remote',
            'exitCode': 0,
            'elapsedMilliseconds': 288285,
            'resultCanonicalSha256': V22_RESULT_SHA,
        },
    ],
    'result': copy.deepcopy(V22_RESULT),
    'postVerificationMatchingProcessCount': 0,
    'futureVerificationMode': 'DIRECT_BYTE_GIT_EVENT_STATE_REPLAY_AND_INTRODUCTION_TOPOLOGY',
}
SELF_NAMES = (
    'EXPECTED_CONTRACT_RAW', 'EXPECTED_CONTROLLER_NORMALIZED', 'EXPECTED_TEST_RAW',
    'EXPECTED_EVENTS_RAW', 'EXPECTED_STATE_RAW', 'EXPECTED_STATE_SELF',
    'EXPECTED_PROJECTION_SHA',
)


class EvidenceError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise EvidenceError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def exact(value: Any, keys: set[str], label: str) -> None:
    if type(value) is not dict or set(value) != keys:
        fail(label + ' keys changed')


def normalized_python(raw: bytes) -> str:
    text = raw.decode().replace('\r\n', '\n')
    for name in SELF_NAMES:
        text = re.sub(rf"({name}\s*=\s*)'[^']+'", rf"\g<1>'{name}_NORMALIZED'", text)
    return sha(text.encode())


def is_controller_child(args: list[str]) -> bool:
    argv = [str(value).replace('\\', '/') for value in args]
    executable = Path(argv[0]).name.lower() if argv else ''
    python_launch = executable in {'python', 'python.exe', 'python3', 'python3.exe', 'py', 'py.exe'}
    direct_controller_launch = bool(argv and re.search(r'(?:^|/)early-detection-continuous-free-source-v\d+\.py$', argv[0]))
    return direct_controller_launch or (
        python_launch
        and any(re.search(r'(?:^|/)early-detection-continuous-free-source-v\d+\.py$', value) for value in argv[1:])
    )


def run_process(args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[Any]:
    global CONTROLLER_CHILD_EXECUTIONS
    if is_controller_child(args):
        CONTROLLER_CHILD_EXECUTIONS += 1
        fail('controller child execution forbidden')
    kwargs.setdefault('timeout', 60)
    try:
        return subprocess.run(args, **kwargs)
    except subprocess.TimeoutExpired:
        fail('child process timeout')


def validate_process_execution_surface(source_text: str | None = None) -> None:
    tree = ast.parse(source_text if source_text is not None else Path(__file__).read_text(encoding='utf-8'))
    subprocess_attributes = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Name)
        and node.value.id == 'subprocess'
    ]
    direct_subprocess_calls = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == 'subprocess'
    ]
    allowed_attributes = sorted(node.attr for node in subprocess_attributes)
    subprocess_names = [node for node in ast.walk(tree) if isinstance(node, ast.Name) and node.id == 'subprocess']
    if len(direct_subprocess_calls) != 1 or direct_subprocess_calls[0].func.attr != 'run':
        fail('subprocess execution surface changed')
    if allowed_attributes != ['CompletedProcess', 'DEVNULL', 'DEVNULL', 'TimeoutExpired', 'run'] or len(subprocess_names) != 5:
        fail('subprocess attribute surface changed')
    forbidden_imports = [
        node for node in ast.walk(tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
        and (
            (isinstance(node, ast.ImportFrom) and node.module in {'subprocess', 'os'})
            or any(alias.name in {'os', 'subprocess'} and alias.asname is not None for alias in getattr(node, 'names', []))
        )
    ]
    if forbidden_imports:
        fail('process execution alias surface changed')
    forbidden_calls = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and (
            (isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == 'os' and node.func.attr in {'system', 'popen', 'spawnl', 'spawnv'})
            or (isinstance(node.func, ast.Name) and node.func.id in {'Popen', 'call', 'check_call', 'check_output', 'system', 'popen', 'spawnl', 'spawnv'})
        )
    ]
    if forbidden_calls:
        fail('alternate process execution surface changed')


def validate_constant_time_predecessor_boundary() -> None:
    validate_process_execution_surface()
    if CONTROLLER_CHILD_EXECUTIONS != 0:
        fail('controller child execution forbidden')


def git(*args: str) -> str:
    result = run_process(['git', *args], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    if result.returncode:
        fail(result.stderr.strip() or 'Git failed')
    return result.stdout.strip()


def git_raw(commit: str, path: str) -> bytes:
    result = run_process(['git', 'show', f'{commit}:{path}'], cwd=ROOT, capture_output=True)
    if result.returncode:
        fail('Git blob missing ' + path)
    return result.stdout


def git_exists(commit: str, path: str) -> bool:
    return run_process(['git', 'cat-file', '-e', f'{commit}:{path}'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def parse_events(raw: bytes, expected_count: int) -> list[dict[str, Any]]:
    rows = [json.loads(line) for line in raw.decode().splitlines() if line]
    if len(rows) != expected_count:
        fail('event count changed')
    for index, row in enumerate(rows):
        body = copy.deepcopy(row)
        claim = body.pop('eventSha256', None)
        previous = None if index == 0 else rows[index - 1]['eventSha256']
        if claim != sha(canonical(body)) or row.get('sequence') != index + 1 or row.get('previousEventSha256') != previous:
            fail('event chain changed')
    return rows


def delta(commit: str) -> tuple[list[dict[str, str]], str]:
    artifacts = []
    for line in git('diff-tree', '--no-commit-id', '--name-status', '-r', commit).splitlines():
        status, path = line.split('\t', 1)
        artifacts.append({'status': status, 'path': path, 'sha256': sha(git_raw(commit, path))})
    return artifacts, sha(canonical(artifacts))


def expected_projection() -> dict[str, Any]:
    projection = copy.deepcopy(json.loads(V22_STATE.read_bytes())['operationalProjection'])
    tasks = {task['taskId']: task for task in projection['tasks']}
    q003 = tasks['Q003-SEC-TERMINAL-WEALTH-QUEUE']
    q003['milestoneRefs'].extend([909, 910])
    q003['nextAction'] = PAUSED_SUPPORTING_TASKS[q003['taskId']]
    q010 = tasks['Q010-RESEARCH-ARCHIVE-DISCOVERY']
    q010['priority'] = 101
    q010['nextAction'] = 'BUILD_OUTCOME_BLIND_POINT_IN_TIME_THEME_BENEFICIARY_AND_OPERATIONAL_SIGNAL_CORPUS_FROM_PRE2021_FREE_PRIMARY_SOURCES'
    for task in projection['tasks']:
        task['workClass'] = TASK_WORK_CLASS[task['taskId']]
        if task['taskId'] in PAUSED_SUPPORTING_TASKS:
            task['schedulerEligible'] = False
            task['nextAction'] = PAUSED_SUPPORTING_TASKS[task['taskId']]
    for sublane in projection['q005Sublanes']:
        sublane['schedulerEligible'] = False
    projection['scientificLocks'].update({
        'telCorpusBuilt': False,
        'historicalTimeCapsulesBuilt': False,
        'researchWatchCandidatesBuilt': False,
        'preGrowthCandidatesBuilt': False,
        'earlyDetectionSystemBuilt': False,
    })
    projection['operationalMilestones'].extend([
        {key: item[key] for key in ('tag', 'commit', 'parent', 'subject', 'workstream', 'artifactCount', 'status')}
        for item in MILESTONES
    ])
    eligible = scheduler_eligible_tasks(projection['tasks'], NEXT_WORK_CHUNK)
    ids = [task['taskId'] for task in eligible]
    projection['scheduler'] = {
        'strategy': 'TASK_BOUND_NEXT_DECISION_ONLY_THEN_PRIORITY',
        'eligibleTaskIds': ids,
        'blockedTaskIds': [task['taskId'] for task in projection['tasks'] if task['taskId'] not in set(ids)],
        'nextTaskId': ids[0],
        'q002AutoNextForbidden': True,
    }
    projection['workPolicy'] = copy.deepcopy(WORK_POLICY)
    projection['workChunkDecisions'] = {
        'currentComponents': copy.deepcopy(CURRENT_WORK_CHUNKS),
        'next': copy.deepcopy(NEXT_WORK_CHUNK),
    }
    projection['schedulerPolicy'] = copy.deepcopy(SCHEDULER_POLICY)
    return projection


def scheduler_eligible_tasks(tasks: list[dict[str, Any]], decision: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(
        (
            task for task in tasks
            if task['schedulerEligible'] is True
            and task['operationalState'] == 'AUTONOMOUS_OPEN'
            and task['taskId'] == decision['targetQueueTaskId']
            and task['workClass'] == decision['workClass']
        ),
        key=lambda task: (-task['priority'], task['taskId']),
    )


def validate_work_chunk_decision(value: dict[str, Any], expected: dict[str, Any], label: str) -> None:
    required = set(WORK_POLICY['requiredWorkChunkDecisionFields'])
    exact(value, required, label)
    if value != expected:
        fail(label + ' changed')
    if not value['namedGateOrBias'] or value['workClass'] not in {'CORE', 'SUPPORTING'}:
        fail(label + ' lacks named gate or work class')
    if value['workClass'] == 'CORE' and value['admissionCriterion'] != WORK_POLICY['coreWorkAdmissionCriterion']:
        fail(label + ' core admission changed')
    if value['workClass'] == 'SUPPORTING' and value['admissionCriterion'] not in WORK_POLICY['supportingWorkAdmissionCriteria']:
        fail(label + ' supporting admission changed')
    if value['evidencePolicyId'] not in EVIDENCE_POLICIES:
        fail(label + ' evidence policy changed')
    if value['scientificCredit'] != 'NONE' or not value['continuationCriterion'] or not value['pauseOrStopCriterion']:
        fail(label + ' credit or stop rule changed')
    recorded_at = datetime.datetime.strptime(value['decisionRecordedAt'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
    finalized_at = datetime.datetime.strptime(CREATED_AT, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
    if recorded_at > finalized_at or value['decisionSourceEventId'] != 'EVT-00000011' or value['decisionSourceEventSequence'] != 11:
        fail(label + ' timing or source binding changed')
    if value['decisionTimingStatus'] == 'RETROSPECTIVE_MIGRATION_NO_CREDIT':
        if value['preChunkTimingVerified'] is not False or value['workStarted'] is not True or value['workStartedAt'] is not None:
            fail(label + ' retrospective timing truth changed')
    elif value['decisionTimingStatus'] == 'PENDING_REMOTE_INTRODUCTION':
        if value['preChunkTimingVerified'] is not False or value['workStarted'] is not False or value['workStartedAt'] is not None:
            fail(label + ' pending preauthorization timing changed')
    else:
        fail(label + ' decision timing status changed')


def validate_projection(projection: dict[str, Any]) -> list[str]:
    expected = expected_projection()
    if projection != expected or sha(canonical(projection)) != EXPECTED_PROJECTION_SHA:
        fail('projection changed')
    exact(projection, {'taskCounts', 'tasks', 'q005Sublanes', 'scheduler', 'operationalMilestones', 'milestoneClaimLocks', 'lockedStudies', 'originalV4', 'scientificLocks', 'workPolicy', 'workChunkDecisions', 'schedulerPolicy'}, 'projection')
    if [task.get('taskId') for task in projection['tasks']] != EXPECTED_TASK_IDS:
        fail('tasks changed')
    counts = dict(Counter(task['operationalState'] for task in projection['tasks']))
    counts['RESOLVED'] = sum(task['operationalState'] == 'RESOLVED' for task in projection['tasks'])
    if counts != projection['taskCounts'] or counts['RESOLVED'] != 0:
        fail('task counts changed')
    tasks = {task['taskId']: task for task in projection['tasks']}
    if any(task.get('workClass') != TASK_WORK_CLASS[task['taskId']] for task in projection['tasks']):
        fail('task work class changed')
    if any(tasks[task_id]['schedulerEligible'] is not False for task_id in PAUSED_SUPPORTING_TASKS):
        fail('supporting task pause changed')
    if any(sublane.get('schedulerEligible') is not False for sublane in projection['q005Sublanes']):
        fail('Q005 sublane pause changed')
    if projection['schedulerPolicy'] != SCHEDULER_POLICY:
        fail('scheduler policy changed')
    next_decision = projection['workChunkDecisions']['next']
    eligible = scheduler_eligible_tasks(projection['tasks'], next_decision)
    ids = [task['taskId'] for task in eligible]
    blocked = [task['taskId'] for task in projection['tasks'] if task['taskId'] not in set(ids)]
    expected_scheduler = {'strategy': 'TASK_BOUND_NEXT_DECISION_ONLY_THEN_PRIORITY', 'eligibleTaskIds': ids, 'blockedTaskIds': blocked, 'nextTaskId': ids[0], 'q002AutoNextForbidden': True}
    if projection['scheduler'] != expected_scheduler or ids != ['Q010-RESEARCH-ARCHIVE-DISCOVERY']:
        fail('scheduler changed')
    if projection['workPolicy'] != WORK_POLICY:
        fail('work policy changed')
    exact(projection['workChunkDecisions'], {'currentComponents', 'next'}, 'work chunk decisions')
    if projection['workChunkDecisions']['currentComponents'] != CURRENT_WORK_CHUNKS:
        fail('current work chunk components changed')
    for index, expected_chunk in enumerate(CURRENT_WORK_CHUNKS):
        validate_work_chunk_decision(projection['workChunkDecisions']['currentComponents'][index], expected_chunk, f'current work chunk component {index}')
    validate_work_chunk_decision(projection['workChunkDecisions']['next'], NEXT_WORK_CHUNK, 'next work chunk decision')
    if projection['workChunkDecisions']['next']['targetQueueTaskId'] != ids[0]:
        fail('next work chunk is not bound to scheduler next')
    if len(projection['operationalMilestones']) != 48 or [row['tag'] for row in projection['operationalMilestones'][-3:]] != [908, 909, 910]:
        fail('milestones changed')
    allowed_status = {'OPERATIONAL_MILESTONE_NO_CREDIT', 'SUPERSEDED_OPERATIONAL_ATTEMPT_NO_CREDIT', 'SUPPORTING_DATA_FOUNDATION_NO_CREDIT'}
    if any(row['status'] not in allowed_status for row in projection['operationalMilestones']):
        fail('milestone credit changed')
    if any(value is not False for value in projection['milestoneClaimLocks'].values()):
        fail('milestone lock changed')
    if projection['originalV4'] != {'protocol': 'FEM-SEC-US@1.2.0', 'greenOfficialGates': 2, 'officialGateCount': 13, 'complete': False, 'resultComputationAllowed': False, 'outcomesAccessed': False}:
        fail('original V4 changed')
    if projection['scientificLocks'].get('studyCredit') != 'NONE' or any(value is not False for key, value in projection['scientificLocks'].items() if key != 'studyCredit'):
        fail('scientific locks changed')
    return ids


def input_raw() -> dict[str, str]:
    actual = {key: sha((ROOT / path).read_bytes()) for key, path in INPUT_PATHS.items()}
    if actual != EXPECTED_INPUT_RAW:
        fail('input bytes changed')
    for key, path in INPUT_PATHS.items():
        if git_raw(BASE, path) != (ROOT / path).read_bytes():
            fail('input Git bytes changed ' + key)
    return actual


def input_bundle(actual: dict[str, str]) -> str:
    deltas = []
    for milestone in MILESTONES:
        artifacts, digest = delta(milestone['commit'])
        if len(artifacts) != milestone['artifactCount'] or digest != milestone['deltaSha256']:
            fail('milestone delta changed')
        if git('show', '-s', '--format=%P', milestone['commit']).split() != [milestone['parent']]:
            fail('milestone parent changed')
        if git('show', '-s', '--format=%s', milestone['commit']) != milestone['subject']:
            fail('milestone subject changed')
        deltas.append(digest)
    return sha(canonical({'baseCommit': BASE, 'inputRawSha256': actual, 'milestoneDeltaSha256': deltas}))


def research_binding() -> dict[str, Any]:
    return {
        'protocol': 'FEM-SEC-US@1.2.0',
        'researchQuestion': RESEARCH_QUESTION,
        'fiveClocks': ['theme', 'beneficiary', 'operations', 'market', 'fundamental'],
        'independentCoreClocks': ['theme', 'beneficiary', 'operations'],
        'confirmationClocks': ['market', 'fundamental'],
        'firstCoreCandidateState': 'RESEARCH_WATCH',
        'candidateStateRules': {
            'RESEARCH_WATCH': 'T>=2 and E>=2 and L>=1',
            'PRE_GROWTH_CANDIDATE': 'T>=2 and E>=2 and L>=2 and growthVisible=false at evaluationAt; no future outcome timestamp may enter classification',
        },
        'registeredHypotheses': 1,
        'executableHypotheses': 0,
        'currentRegisterScope': 'SEC_CONCEPT_MAP_MISSINGNESS_ONLY',
        'courseCorrectionRequiredAtBuildBase': True,
        'operationalPriorityCorrectedByEvent11': True,
        'earlyDetectionSystemBuilt': False,
    }


def verify_research_sources() -> None:
    prereg = json.loads((ROOT / INPUT_PATHS['preregistration']).read_bytes())
    if prereg.get('researchQuestion') != RESEARCH_QUESTION:
        fail('research question changed')
    if list(prereg.get('fiveClocks', {}).keys()) != ['theme', 'beneficiary', 'operations', 'market', 'fundamental']:
        fail('five clocks changed')
    states = prereg.get('matrix', {}).get('states', {})
    if states.get('RESEARCH_WATCH') != research_binding()['candidateStateRules']['RESEARCH_WATCH'] or states.get('PRE_GROWTH_CANDIDATE') != research_binding()['candidateStateRules']['PRE_GROWTH_CANDIDATE']:
        fail('candidate states changed')
    q010_policy = EVIDENCE_POLICIES['Q010-PRE2021-PIT-TEL-CORPUS']
    dimensions = prereg.get('matrix', {}).get('dimensions', {})
    if {key: dimensions.get(key, {}).get('levels') for key in ('T', 'E', 'L')} != q010_policy['dimensionLevelDefinitions']:
        fail('T/E/L level definitions changed')
    if dimensions.get('L', {}).get('managementStatementsAloneMaximum') != q010_policy['managementStatementsAloneMaximumL']:
        fail('L management statement cap changed')
    if q010_policy['timeCapsuleStateRules'] != research_binding()['candidateStateRules']:
        fail('time capsule state rules changed')
    qualitative = prereg.get('qualitativeCoding', {})
    agreement = qualitative.get('agreementGate', {})
    if qualitative.get('requiredFields') != q010_policy['qualitativeCodingRequiredFields']:
        fail('qualitative coding fields changed')
    if qualitative.get('doubleCoding') is not True or agreement.get('weightedCohenKappaMinimumPerDimension') != q010_policy['weightedCohenKappaMinimumPerDimension'] or agreement.get('exactAgreementMinimum') != q010_policy['exactAgreementMinimum']:
        fail('qualitative coding agreement gate changed')
    python_args = ['python', *(['-O'] if sys.flags.optimize else []), '-B', str(HYPOTHESIS_VERIFIER), 'verify', '--remote']
    result = run_process(python_args, cwd=ROOT, capture_output=True, text=True, timeout=60)
    if result.returncode:
        fail('hypothesis register verification failed')
    output = json.loads(result.stdout)
    if (
        output.get('status') != 'PASS'
        or output.get('phase') != 'POST_INTRODUCTION'
        or output.get('maximumObservedDate') != '2020-12-31'
        or output.get('proposals') != 1
        or output.get('proposalExecutionAuthorized') is not False
        or output.get('studyCredit') != 'NONE'
        or output.get('outcomesAccessed') is not False
    ):
        fail('hypothesis register semantics changed')


def build_event(actual: dict[str, str], bundle: str) -> dict[str, Any]:
    previous = parse_events(V22_EVENTS.read_bytes(), 10)[-1]
    projection = expected_projection()
    event = {
        'sequence': 11,
        'eventId': 'EVT-00000011',
        'eventType': 'OPERATIONAL_COURSE_CORRECTION_TO_PREREGISTERED_EARLY_DETECTION_CORE_TAG908_TO_TAG910',
        'createdAt': CREATED_AT,
        'agentId': 'ROOT-CONTROLLER',
        'fencingToken': 0,
        'previousEventSha256': previous['eventSha256'],
        'inputBundleSha256': bundle,
        'payload': {
            'baseCommit': BASE,
            'milestones': copy.deepcopy(MILESTONES),
            'repositoryRemote': REMOTE,
            'sourceEventLogRawSha256': actual['v22EventLog'],
            'sourceStateRawSha256': actual['v22State'],
            'sourceStateSelfSha256': json.loads(V22_STATE.read_bytes())['stateSha256'],
            'sourceLastEventSha256': previous['eventSha256'],
            'replacementStatePath': AUTHORIZED[3],
            'supersessionReasonCode': 'V22_SCHEDULER_PRIORITIZED_SUPPORTING_Q003_ABOVE_PREREGISTERED_EARLY_DETECTION_CORE',
            'v23EventCarriesCompleteOperationalProjection': True,
            'researchObjectiveBinding': research_binding(),
            'workPolicy': copy.deepcopy(WORK_POLICY),
            'predecessorTrustAnchor': copy.deepcopy(PREDECESSOR_TRUST_ANCHOR),
            'supportingWorkRetained': True,
            'noScientificCredit': True,
            'outcomesAccessed': False,
            'operationalProjectionSha256': sha(canonical(projection)),
            'operationalProjection': projection,
        },
    }
    event['eventSha256'] = sha(canonical(event))
    return event


def materialize_state(event_raw: bytes, events: list[dict[str, Any]], actual: dict[str, str], bundle: str) -> dict[str, Any]:
    last = events[-1]
    if last != build_event(actual, bundle):
        fail('last event changed')
    projection = last['payload']['operationalProjection']
    validate_projection(projection)
    v22 = json.loads(V22_STATE.read_bytes())
    state = {
        'schema': 'early-detection-free-source-operational-state/v23',
        'materializedAt': last['createdAt'],
        'track': 'SHARED_OUTCOME_BLIND_INFRA',
        'purpose': 'Prioritize the preregistered theme-beneficiary-operations research core while retaining bounded supporting data work that removes a named bias or unblocks a named core test.',
        'repository': {'remote': REMOTE, 'ref': REF, 'buildBaseCommit': BASE, 'buildBaseTag': 910},
        'inputBundleSha256': bundle,
        'inputRawSha256': actual,
        'predecessor': {
            'version': 22,
            'contractPath': INPUT_PATHS['v22Contract'],
            'contractRawSha256': actual['v22Contract'],
            'controllerPath': INPUT_PATHS['v22Controller'],
            'controllerRawSha256': actual['v22Controller'],
            'testPath': INPUT_PATHS['v22Test'],
            'testRawSha256': actual['v22Test'],
            'eventLogPath': INPUT_PATHS['v22EventLog'],
            'eventLogRawSha256': actual['v22EventLog'],
            'statePath': INPUT_PATHS['v22State'],
            'stateRawSha256': actual['v22State'],
            'stateSelfSha256': v22['stateSha256'],
            'lastEventSha256': events[-2]['eventSha256'],
            'appendOnly': True,
            'remoteVerificationRequired': True,
            'trustAnchor': copy.deepcopy(PREDECESSOR_TRUST_ANCHOR),
            'semanticStatus': 'SUPERSEDED_BY_EARLY_DETECTION_CORE_PRIORITY_V23',
        },
        'eventLog': {
            'path': AUTHORIZED[2],
            'eventCount': 11,
            'rawSha256': sha(event_raw),
            'lastEventSha256': last['eventSha256'],
            'v22ByteExactPrefix': True,
            'hashChainVerified': True,
            'fullProjectionCarriedByLastEvent': True,
        },
        'researchObjectiveBinding': research_binding(),
        'operationalProjection': projection,
    }
    state['stateSha256'] = sha(canonical(state))
    return state


def scientific_locks() -> dict[str, Any]:
    return {
        'originalV4GreenOfficialGates': 2, 'originalV4OfficialGateCount': 13,
        'originalV4Complete': False, 'originalV4GateCredit': False,
        'identityResolved': False, 'terminalWealthComplete': False,
        'fiveRequiredDataSemanticsComplete': False, 'resultComputationAllowed': False,
        'telCorpusBuilt': False, 'historicalTimeCapsulesBuilt': False,
        'researchWatchCandidatesBuilt': False, 'preGrowthCandidatesBuilt': False,
        'earlyDetectionSystemBuilt': False,
        'pricesAccessed': False, 'returnsAccessed': False, 'outcomesAccessed': False,
    }


def expected_repository() -> dict[str, Any]:
    return {'remote': REMOTE, 'ref': REF, 'buildBaseCommit': BASE, 'buildBaseTag': 910, 'introductionMustBeDirectSingleParentChild': True, 'introductionAddsExactlyAuthorizedPaths': True, 'introductionSubject': INTRODUCTION_SUBJECT, 'authorizedPaths': AUTHORIZED}


def expected_inputs() -> dict[str, Any]:
    return {'rawSha256': EXPECTED_INPUT_RAW, 'inputBundleSha256': input_bundle(EXPECTED_INPUT_RAW), 'inputBundleRecomputedFromRawHashesAndThreeMilestoneDeltas': True, 'v22EventLogMustBeByteExactPrefix': True, 'v22ControllerMustVerifyRemoteBeforeImportCredit': True, 'v22FullHistoryVerificationReceiptRequired': True, 'v22RuntimeVerificationUsesDirectAnchor': True, 'hypothesisRegisterMustVerifyRemoteBeforeCourseCorrection': True}


def expected_replay() -> dict[str, bool]:
    return {'lastEventCarriesCompleteOperationalProjection': True, 'stateMustBeDeterministicallyMaterializedFromEvents': True, 'v22EventLogMustBeByteExactPrefix': True, 'taskCountsMustBeRecomputedFromTasks': True, 'eligibleQueueMustBeRecomputedFromTaskBoundNextDecision': True, 'implicitSupportingFallbackForbidden': True, 'nextTaskMustMatchTaskBoundDecisionBeforePriorityTieBreak': True, 'milestoneDeltasMustBeRecomputedFromGitObjects': True, 'predecessorAnchorReceiptContainsExactlyOneFullHistoryRunPerMode': True, 'futurePredecessorVerificationUsesDirectAnchor': True, 'nextRequiresRemotePostIntroduction': True, 'verifyWithoutRemoteMustFail': True, 'preIntroductionVerifyIsDiagnosticOnly': True}


def validate_contract(value: dict[str, Any], exact_artifact: bool = True) -> None:
    exact(value, {'schema', 'createdAt', 'track', 'purpose', 'contractSelfSha256', 'repository', 'inputs', 'milestoneBindings', 'researchObjectiveBinding', 'workPolicy', 'workChunkDecisions', 'schedulerPolicy', 'predecessorTrustAnchor', 'implementation', 'outputs', 'replayContract', 'scientificLocks'}, 'contract')
    body = copy.deepcopy(value)
    claim = body.get('contractSelfSha256')
    body['contractSelfSha256'] = None
    if claim != sha(canonical(body)):
        fail('contract self hash changed')
    timestamp = datetime.datetime.strptime(CREATED_AT, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
    if value['schema'] != 'early-detection-continuous-free-source-operational-state-contract/v23' or value['createdAt'] != CREATED_AT or timestamp > datetime.datetime.now(datetime.timezone.utc):
        fail('contract identity changed')
    if value['track'] != 'SHARED_OUTCOME_BLIND_INFRA' or value['purpose'] != PURPOSE:
        fail('contract purpose changed')
    if value['repository'] != expected_repository() or value['inputs'] != expected_inputs() or value['milestoneBindings'] != MILESTONES:
        fail('repository or input binding changed')
    if value['researchObjectiveBinding'] != research_binding() or value['workPolicy'] != WORK_POLICY:
        fail('research objective or work policy changed')
    if value['workChunkDecisions'] != {'currentComponents': CURRENT_WORK_CHUNKS, 'next': NEXT_WORK_CHUNK}:
        fail('work chunk decisions changed')
    for index, expected_chunk in enumerate(CURRENT_WORK_CHUNKS):
        validate_work_chunk_decision(value['workChunkDecisions']['currentComponents'][index], expected_chunk, f'contract current work chunk component {index}')
    validate_work_chunk_decision(value['workChunkDecisions']['next'], NEXT_WORK_CHUNK, 'contract next work chunk decision')
    if value['schedulerPolicy'] != SCHEDULER_POLICY:
        fail('contract scheduler policy changed')
    if value['predecessorTrustAnchor'] != PREDECESSOR_TRUST_ANCHOR:
        fail('predecessor trust anchor changed')
    anchor_timestamp = datetime.datetime.strptime(PREDECESSOR_TRUST_ANCHOR['recordedAt'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
    if anchor_timestamp > timestamp or anchor_timestamp > datetime.datetime.now(datetime.timezone.utc):
        fail('predecessor trust anchor timestamp changed')
    if value['replayContract'] != expected_replay() or value['scientificLocks'] != scientific_locks():
        fail('replay or scientific locks changed')
    if exact_artifact:
        if value['implementation'] != {'controllerNormalizedSha256': EXPECTED_CONTROLLER_NORMALIZED, 'testRawSha256': EXPECTED_TEST_RAW, 'selfBindingsNormalizedBeforeHash': True}:
            fail('implementation binding changed')
        if normalized_python(Path(__file__).read_bytes()) != EXPECTED_CONTROLLER_NORMALIZED or sha(TEST.read_bytes()) != EXPECTED_TEST_RAW:
            fail('implementation bytes changed')
        events = parse_events(EVENTS.read_bytes(), 11)
        expected_outputs = {'eventLogPath': AUTHORIZED[2], 'eventLogRawSha256': EXPECTED_EVENTS_RAW, 'eventCount': 11, 'lastEventSha256': events[-1]['eventSha256'], 'statePath': AUTHORIZED[3], 'stateRawSha256': EXPECTED_STATE_RAW, 'stateSelfSha256': EXPECTED_STATE_SELF, 'operationalProjectionSha256': EXPECTED_PROJECTION_SHA}
        if value['outputs'] != expected_outputs:
            fail('outputs changed')


def load_contract(exact_artifact: bool = True) -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if exact_artifact and sha(raw) != EXPECTED_CONTRACT_RAW:
        fail('contract raw changed')
    value = json.loads(raw)
    validate_contract(value, exact_artifact)
    return value


def introduction_phase(head: str) -> tuple[str, str | None]:
    present = [path for path in AUTHORIZED if git_exists(head, path)]
    if not present:
        if head != BASE:
            fail('pre-introduction head moved')
        return 'PRE_INTRODUCTION', None
    if present != AUTHORIZED:
        fail('partial introduction')
    introductions = {git('log', '--diff-filter=A', '-1', '--format=%H', '--', path) for path in AUTHORIZED}
    if len(introductions) != 1:
        fail('split introduction')
    introduction = introductions.pop()
    if git('show', '-s', '--format=%P', introduction).split() != [BASE]:
        fail('introduction parent changed')
    if git('show', '-s', '--format=%s', introduction) != INTRODUCTION_SUBJECT:
        fail('introduction subject changed')
    if git('diff-tree', '--no-commit-id', '--name-status', '-r', introduction).splitlines() != [f'A\t{path}' for path in AUTHORIZED]:
        fail('introduction paths changed')
    chain = git('rev-list', '--first-parent', head).splitlines()
    if introduction not in chain:
        fail('introduction absent')
    for commit in chain[:chain.index(introduction)]:
        if len(git('show', '-s', '--format=%P', commit).split()) != 1:
            fail('nonlinear descendant')
    for path in AUTHORIZED:
        if git('log', '-1', '--format=%H', '--', path) != introduction or git_raw(head, path) != (ROOT / path).read_bytes():
            fail('owned path drift')
    return 'POST_INTRODUCTION', introduction


def verify_v22_trust_anchor(head: str) -> None:
    if sha(canonical(V22_RESULT)) != V22_RESULT_SHA:
        fail('V22 receipt result changed')
    if PREDECESSOR_TRUST_ANCHOR['result'] != V22_RESULT:
        fail('V22 receipt payload changed')
    if PREDECESSOR_TRUST_ANCHOR.get('anchorReceiptContainsExactlyOneFullHistoryRunPerMode') is not True:
        fail('V22 receipt traversal claim changed')
    if [row['mode'] for row in PREDECESSOR_TRUST_ANCHOR['verificationModes']] != ['NORMAL', 'OPTIMIZED']:
        fail('V22 receipt modes changed')
    if any(row['exitCode'] != 0 or row['resultCanonicalSha256'] != V22_RESULT_SHA for row in PREDECESSOR_TRUST_ANCHOR['verificationModes']):
        fail('V22 receipt result binding changed')

    contract_raw = (ROOT / INPUT_PATHS['v22Contract']).read_bytes()
    contract = json.loads(contract_raw)
    contract_body = copy.deepcopy(contract)
    contract_claim = contract_body.get('contractSelfSha256')
    contract_body['contractSelfSha256'] = None
    if contract_claim != sha(canonical(contract_body)):
        fail('V22 contract self hash changed')
    if contract.get('schema') != 'early-detection-continuous-free-source-operational-state-contract/v22':
        fail('V22 contract schema changed')

    outputs = contract.get('outputs', {})
    if outputs != {
        'eventLogPath': INPUT_PATHS['v22EventLog'],
        'eventLogRawSha256': EXPECTED_INPUT_RAW['v22EventLog'],
        'eventCount': 10,
        'lastEventSha256': '8b23415609ed50c1619683fb775b84d3c5f1ccb14849279ffb0efe9f3cfeed19',
        'statePath': INPUT_PATHS['v22State'],
        'stateRawSha256': EXPECTED_INPUT_RAW['v22State'],
        'stateSelfSha256': 'f41b3981fb2fabddb75a50d4ab105f1172a96aa0c880bdbc5bb9e978816cb4c4',
        'operationalProjectionSha256': 'b986114a4a4994103cbd9bf30d3b976c59295c31278710d616557fd4bba6b5ef',
    }:
        fail('V22 output contract changed')

    event_raw = V22_EVENTS.read_bytes()
    events = parse_events(event_raw, 10)
    state_raw = V22_STATE.read_bytes()
    state = json.loads(state_raw)
    state_body = copy.deepcopy(state)
    state_claim = state_body.pop('stateSha256', None)
    if state_claim != sha(canonical(state_body)) or state_claim != outputs['stateSelfSha256']:
        fail('V22 state self hash changed')
    projection = state.get('operationalProjection')
    if type(projection) is not dict or sha(canonical(projection)) != outputs['operationalProjectionSha256']:
        fail('V22 projection binding changed')
    if events[-1].get('eventSha256') != outputs['lastEventSha256'] or events[-1].get('payload', {}).get('operationalProjection') != projection:
        fail('V22 event-state replay changed')
    if state.get('eventLog') != {
        'eventCount': 10,
        'fullProjectionCarriedByLastEvent': True,
        'hashChainVerified': True,
        'lastEventSha256': outputs['lastEventSha256'],
        'path': INPUT_PATHS['v22EventLog'],
        'rawSha256': outputs['eventLogRawSha256'],
        'v21ByteExactPrefix': True,
    }:
        fail('V22 state event binding changed')
    if len(projection.get('operationalMilestones', [])) != V22_RESULT['operationalMilestones']:
        fail('V22 milestone count changed')
    if [task.get('taskId') for task in projection.get('tasks', [])] != EXPECTED_TASK_IDS:
        fail('V22 tasks changed')
    resolved = sum(task.get('operationalState') == 'RESOLVED' for task in projection['tasks'])
    eligible = [task for task in projection['tasks'] if task.get('schedulerEligible') is True and task.get('operationalState') == 'AUTONOMOUS_OPEN']
    if resolved != 0 or len(eligible) != V22_RESULT['eligibleTasks'] or projection.get('scheduler', {}).get('nextTaskId') != V22_RESULT['nextTaskId']:
        fail('V22 scheduler semantics changed')
    if projection.get('originalV4', {}).get('resultComputationAllowed') is not False or projection.get('originalV4', {}).get('outcomesAccessed') is not False:
        fail('V22 scientific locks changed')

    repository = contract.get('repository', {})
    authorized = repository.get('authorizedPaths')
    introduction = PREDECESSOR_TRUST_ANCHOR['introductionCommit']
    if repository.get('buildBaseCommit') != PREDECESSOR_TRUST_ANCHOR['introductionParent'] or authorized != [INPUT_PATHS[key] for key in ('v22Contract', 'v22Controller', 'v22EventLog', 'v22State', 'v22Test')]:
        fail('V22 introduction contract changed')
    if git('show', '-s', '--format=%P', introduction).split() != [PREDECESSOR_TRUST_ANCHOR['introductionParent']]:
        fail('V22 introduction parent changed')
    if git('show', '-s', '--format=%s', introduction) != PREDECESSOR_TRUST_ANCHOR['introductionSubject']:
        fail('V22 introduction subject changed')
    if git('diff-tree', '--no-commit-id', '--name-status', '-r', introduction).splitlines() != [f'A\t{path}' for path in authorized]:
        fail('V22 introduction paths changed')
    chain = git('rev-list', '--first-parent', head).splitlines()
    if PREDECESSOR_TRUST_ANCHOR['verifiedHead'] not in chain or introduction not in chain:
        fail('V22 trust anchor absent from current history')
    for path in authorized:
        if git('log', '-1', '--format=%H', '--', path) != introduction:
            fail('V22 owned path drift')
        if git_raw(introduction, path) != (ROOT / path).read_bytes() or git_raw(head, path) != (ROOT / path).read_bytes():
            fail('V22 anchored Git bytes changed ' + path)


def verify(remote: bool) -> dict[str, Any]:
    if not remote:
        fail('remote verification mandatory')
    validate_constant_time_predecessor_boundary()
    contract = load_contract()
    actual = input_raw()
    bundle = input_bundle(actual)
    if contract['inputs']['inputBundleSha256'] != bundle:
        fail('input bundle changed')
    event_raw = EVENTS.read_bytes()
    state_raw = STATE.read_bytes()
    if sha(event_raw) != EXPECTED_EVENTS_RAW or sha(state_raw) != EXPECTED_STATE_RAW or not event_raw.startswith(V22_EVENTS.read_bytes()):
        fail('output bytes changed')
    events = parse_events(event_raw, 11)
    state = materialize_state(event_raw, events, actual, bundle)
    if json.loads(state_raw) != state or state['stateSha256'] != EXPECTED_STATE_SELF:
        fail('state replay changed')
    if git('remote', 'get-url', 'origin') != REMOTE:
        fail('origin changed')
    head = git('rev-parse', 'HEAD')
    live = git('ls-remote', '--refs', 'origin', REF).split()
    if len(live) != 2 or live[1] != REF or not head == git('rev-parse', '@{u}') == live[0]:
        fail('remote drift')
    verify_v22_trust_anchor(head)
    verify_research_sources()
    phase, introduction = introduction_phase(head)
    ids = validate_projection(state['operationalProjection'])
    validate_constant_time_predecessor_boundary()
    return {
        'schema': 'early-detection-free-source-operational-state-verification/v23',
        'status': 'PASS' if phase == 'POST_INTRODUCTION' else 'PRE_INTRODUCTION_DIAGNOSTIC',
        'phase': phase, 'introductionCommit': introduction,
        'controllerResumeAllowed': phase == 'POST_INTRODUCTION',
        'eventCount': 11, 'operationalMilestones': 48, 'newMilestones': 3,
        'tasksConserved': 10, 'resolvedTasks': 0, 'eligibleTasks': len(ids),
        'nextTaskId': ids[0], 'coreOperationalPriorityProjected': True,
        'coreOperationalPriorityRestored': phase == 'POST_INTRODUCTION',
        'supportingWorkAllowed': True, 'q003StillOpen': True,
        'pausedSupportingTaskIds': list(PAUSED_SUPPORTING_TASKS),
        'implicitSupportingFallbackForbidden': True,
        'earlyDetectionSystemBuilt': False,
        'workChunkDecisionsVerified': True,
        'currentWorkChunkIds': [chunk['chunkId'] for chunk in CURRENT_WORK_CHUNKS],
        'nextWorkChunkId': NEXT_WORK_CHUNK['chunkId'],
        'nextDecisionRecordedInEvent11': True,
        'nextDecisionAuthorizedToStart': phase == 'POST_INTRODUCTION',
        'q002AutoNext': False, 'originalV4GreenOfficialGates': 2,
        'originalV4OfficialGateCount': 13, 'v22PrefixVerified': True,
        'milestoneGitDeltasVerified': 3, 'v22RemoteVerified': True,
        'v22TrustAnchorVerified': True, 'v22AnchorCaptureReceiptVerified': True,
        'hypothesisRegisterRemoteVerified': True,
        'remoteTopologyVerified': True,
        'introducedArtifactsRemoteVerified': phase == 'POST_INTRODUCTION',
        'remoteVerified': True,
        'controllerChildExecutions': CONTROLLER_CHILD_EXECUTIONS,
        'outcomesAccessed': False,
    }


def materialize(replace_existing_draft: bool = False) -> dict[str, Any]:
    if git('rev-parse', 'HEAD') != BASE or git('rev-parse', '@{u}') != BASE:
        fail('materialize base changed')
    if EVENTS.exists() or STATE.exists():
        if not replace_existing_draft or not EVENTS.exists() or not STATE.exists():
            fail('materialize paths changed')
        if sha(EVENTS.read_bytes()) != SUPERSEDED_DRAFT_EVENTS_RAW or sha(STATE.read_bytes()) != SUPERSEDED_DRAFT_STATE_RAW:
            fail('replaceable draft bytes changed')
        status = git('status', '--short', '--', AUTHORIZED[2], AUTHORIZED[3]).splitlines()
        if status != [f'?? {AUTHORIZED[2]}', f'?? {AUTHORIZED[3]}']:
            fail('replaceable draft paths are not untracked')
    load_contract(False)
    actual = input_raw()
    bundle = input_bundle(actual)
    event = build_event(actual, bundle)
    event_raw = V22_EVENTS.read_bytes() + canonical(event) + b'\n'
    events = parse_events(event_raw, 11)
    state = materialize_state(event_raw, events, actual, bundle)
    EVENTS.write_bytes(event_raw)
    STATE.write_bytes((json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + '\n').encode('utf-8'))
    return {'status': 'PASS', 'eventRawSha256': sha(event_raw), 'stateRawSha256': sha(STATE.read_bytes()), 'stateSelfSha256': state['stateSha256'], 'projectionSha256': sha(canonical(state['operationalProjection'])), 'outcomesAccessed': False}


def rejected(callback: Callable[[], Any]) -> bool:
    try:
        callback()
    except (EvidenceError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return True
    return False


def self_test() -> dict[str, Any]:
    global CONTROLLER_CHILD_EXECUTIONS
    projection = expected_projection()
    projection_mutations = {
        'dropTask': lambda value: value['tasks'].pop(),
        'resolveTask': lambda value: (value['tasks'][2].__setitem__('operationalState', 'RESOLVED'), value['taskCounts'].__setitem__('AUTONOMOUS_OPEN', 3), value['taskCounts'].__setitem__('RESOLVED', 1)),
        'renameTask': lambda value: value['tasks'][2].__setitem__('taskId', 'Q003-FAKE'),
        'restoreOldPriority': lambda value: value['tasks'][9].__setitem__('priority', 50),
        'restoreOldNext': lambda value: value['scheduler'].__setitem__('nextTaskId', 'Q003-SEC-TERMINAL-WEALTH-QUEUE'),
        'forbidSupportingWork': lambda value: value['workPolicy'].__setitem__('supportingWorkAllowed', False),
        'allowUnboundedSupportingWork': lambda value: value['workPolicy'].__setitem__('unboundedSupportingExpansionForbidden', False),
        'removeAdmissionCriterion': lambda value: value['workPolicy']['supportingWorkAdmissionCriteria'].pop(),
        'disablePreChunkRecord': lambda value: value['workPolicy'].__setitem__('preChunkDecisionRecordRequiredForAllNewWork', False),
        'grantCurrentChunkCredit': lambda value: value['workChunkDecisions']['currentComponents'][0].__setitem__('scientificCredit', 'SCIENTIFIC_CREDIT'),
        'misclassifyTrustAnchorAsCore': lambda value: value['workChunkDecisions']['currentComponents'][1].__setitem__('workClass', 'CORE'),
        'bypassTrustAnchorAdmission': lambda value: value['workChunkDecisions']['currentComponents'][1].__setitem__('admissionCriterion', 'DIRECT_PREREGISTERED_CORE'),
        'eraseNextChunkGate': lambda value: value['workChunkDecisions']['next']['namedGateOrBias'].clear(),
        'retargetNextChunk': lambda value: value['workChunkDecisions']['next'].__setitem__('targetQueueTaskId', 'Q003-SEC-TERMINAL-WEALTH-QUEUE'),
        'changeNextEvidencePolicy': lambda value: value['workChunkDecisions']['next'].__setitem__('evidencePolicyId', 'V23-CONSTANT-TIME-TRUST-ANCHOR'),
        'misclassifyQ010': lambda value: value['tasks'][9].__setitem__('workClass', 'SUPPORTING'),
        'reEnablePausedQ003': lambda value: value['tasks'][2].__setitem__('schedulerEligible', True),
        'reEnablePausedQ004': lambda value: value['tasks'][3].__setitem__('schedulerEligible', True),
        'reEnablePausedQ005': lambda value: value['tasks'][4].__setitem__('schedulerEligible', True),
        'reEnableQ005Sublane': lambda value: value['q005Sublanes'][0].__setitem__('schedulerEligible', True),
        'implicitSupportingFallback': lambda value: (value['tasks'][9].__setitem__('schedulerEligible', False), value['scheduler'].__setitem__('eligibleTaskIds', ['Q003-SEC-TERMINAL-WEALTH-QUEUE']), value['scheduler'].__setitem__('nextTaskId', 'Q003-SEC-TERMINAL-WEALTH-QUEUE')),
        'blurCoreAndConfirmationClocks': lambda value: value['workPolicy'].__setitem__('independentCoreClocks', ['THEME', 'BENEFICIARY', 'OPERATIONS', 'MARKET']),
        'blurConfirmationClocks': lambda value: value['workPolicy'].__setitem__('confirmationClocks', ['FUNDAMENTALS']),
        'allowOutcomesForHypothesisGeneration': lambda value: value['workPolicy'].__setitem__('pricesReturnsOutcomesForbiddenForHypothesisGeneration', False),
        'removeQ010RequiredTimestamp': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['requiredSourceRecordFields'].remove('observationTimestamp'),
        'removeQ010RetrievedAt': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['requiredSourceRecordFields'].remove('retrievedAt'),
        'removeQ010SourceId': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['requiredSourceRecordFields'].remove('sourceId'),
        'removeSignalEntityId': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['requiredSignalEvidenceFields'].remove('entityId'),
        'removeSignalThemeId': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['requiredSignalEvidenceFields'].remove('themeId'),
        'removeSignalDimension': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['requiredSignalEvidenceFields'].remove('dimension'),
        'removeSignalLevel': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['requiredSignalEvidenceFields'].remove('level'),
        'removeSignalSourceRefs': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['requiredSignalEvidenceFields'].remove('referencedSourceIds'),
        'allowSourceAvailabilityFailOpen': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('sourceClassAvailabilityContractMustPassFailClosed', False),
        'makeDayRegistrySignalEligible': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('dayLevelSourceRegistryIsBibliographicOnlyAndNotSignalEligible', False),
        'moveQ010CutoffIntoFuture': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('maximumSignalKnownAt', '2026-12-31T23:59:59Z'),
        'unboundPayloadHash': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('payloadSha256MustMatchExactArchivedRawBytes', False),
        'allowSecondaryTEL': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('secondarySourcesAreLocatorOrContextOnlyAndCannotSetTEL', False),
        'inflateManagementOnlyL': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('managementStatementsAloneMaximumL', 2),
        'inventBeneficiaryLevel': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['dimensionLevelDefinitions']['E'].__setitem__('3', 'narrative mention'),
        'removeCapsuleEntityId': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['requiredTimeCapsuleFields'].remove('entityId'),
        'removeCapsuleThemeId': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['requiredTimeCapsuleFields'].remove('themeId'),
        'allowCallerSignalKnownAt': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('callerSuppliedSignalKnownAtCannotMoveClassification', False),
        'allowFutureFundamentals': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('futureFundamentalOrOutcomeEvidenceForbidden', False),
        'allowEvaluationAfterCutoff': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('evaluationAtMustNotExceedMaximumSignalKnownAtCutoff', False),
        'acceptCallerGrowthVisibility': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('callerSuppliedGrowthVisibilityOrHashIgnored', False),
        'allowNotComputablePreGrowth': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('notComputableCannotCreatePreGrowthCandidate', False),
        'disableDoubleCoding': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('doubleCodingRequired', False),
        'countLLMAsIndependentCoder': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('llmLabelsNeverCountAsBlindedIndependentCoding', False),
        'allowCurrentTickerJoin': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('currentTickerJoinForbidden', False),
        'allowOutcomeSelectedCompany': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('individualCompanySelectionAfterOutcomeViewingForbidden', False),
        'allowDanglingIdentityRef': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('danglingSourceEvidenceOrIdentityReferencesAreRejectedHold', False),
        'allowOneDimensionDrift': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['subchunkPolicy'].__setitem__('unboundedBestInstrumentedDimensionExpansionForbidden', False),
        'allowRetrospectiveQ010Subchunk': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['subchunkPolicy'].__setitem__('newSubchunkDecisionRequiresPreChunkTimingVerifiedTrueAndWorkStartedFalse', False),
        'allowEntityOutsideFrozenPopulation': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS']['subchunkPolicy'].__setitem__('targetEntityMustBelongToFrozenPopulation', False),
        'allowModernTermBackprojection': lambda value: value['workPolicy']['evidencePolicies']['Q010-PRE2021-PIT-TEL-CORPUS'].__setitem__('modernTermBackprojectionForbidden', False),
        'milestoneCredit': lambda value: value['operationalMilestones'][-1].__setitem__('status', 'SCIENTIFIC_CREDIT_GRANTED'),
        'unknownCredit': lambda value: value['scientificLocks'].__setitem__('unknownCredit', True),
        'outcomeAccess': lambda value: value['lockedStudies'][0].__setitem__('outcomesAccessed', True),
        'claimProjectionTELCorpusBuilt': lambda value: value['scientificLocks'].__setitem__('telCorpusBuilt', True),
    }
    kills = {}
    for name, mutation in projection_mutations.items():
        value = copy.deepcopy(projection)
        mutation(value)
        kills[name] = rejected(lambda value=value: validate_projection(value))
    contract = load_contract(False)
    contract_mutations = {
        'backdate': lambda value: value.__setitem__('createdAt', '1970-01-01T00:00:00Z'),
        'purpose': lambda value: value.__setitem__('purpose', 'support work is the study'),
        'remote': lambda value: value['repository'].__setitem__('remote', 'https://example.invalid'),
        'introductionSubject': lambda value: value['repository'].__setitem__('introductionSubject', 'Tag 911: wrong'),
        'path': lambda value: value['repository']['authorizedPaths'].__setitem__(3, 'reports/x.json'),
        'preregistration': lambda value: value['inputs']['rawSha256'].__setitem__('preregistration', '0' * 64),
        'objective': lambda value: value['researchObjectiveBinding'].__setitem__('researchQuestion', 'Does SEC parsing work?'),
        'supportRule': lambda value: value['workPolicy'].__setitem__('supportingWorkContinuationRule', 'ALWAYS_CONTINUE'),
        'anchorResult': lambda value: value['predecessorTrustAnchor']['result'].__setitem__('status', 'UNVERIFIED'),
        'anchorAfterV23': lambda value: value['predecessorTrustAnchor'].__setitem__('recordedAt', '2099-01-01T00:00:00Z'),
        'lock': lambda value: value['scientificLocks'].__setitem__('terminalWealthComplete', True),
        'claimTELCorpusBuilt': lambda value: value['scientificLocks'].__setitem__('telCorpusBuilt', True),
        'claimTimeCapsulesBuilt': lambda value: value['scientificLocks'].__setitem__('historicalTimeCapsulesBuilt', True),
        'claimResearchWatchBuilt': lambda value: value['scientificLocks'].__setitem__('researchWatchCandidatesBuilt', True),
        'claimPreGrowthBuilt': lambda value: value['scientificLocks'].__setitem__('preGrowthCandidatesBuilt', True),
        'claimEarlyDetectionBuilt': lambda value: value['scientificLocks'].__setitem__('earlyDetectionSystemBuilt', True),
        'extra': lambda value: value.__setitem__('studyCredit', True),
    }
    for name, mutation in contract_mutations.items():
        value = copy.deepcopy(contract)
        mutation(value)
        value['contractSelfSha256'] = None
        value['contractSelfSha256'] = sha(canonical(value))
        kills[name] = rejected(lambda value=value: validate_contract(value, False))
    source = Path(__file__).read_text(encoding='utf-8')
    kills['directSubprocessBypass'] = rejected(lambda: validate_process_execution_surface(source + "\nsubprocess.run(['python', 'early-detection-continuous-free-source-v22.py'])\n"))
    kills['aliasedSubprocessBypass'] = rejected(lambda: validate_process_execution_surface(source + "\nfrom subprocess import run as execute\nexecute(['python', 'early-detection-continuous-free-source-v22.py'])\n"))
    kills['popenBypass'] = rejected(lambda: validate_process_execution_surface(source + "\nsubprocess.Popen(['python', 'early-detection-continuous-free-source-v22.py'])\n"))
    kills['subprocessAttributeAliasBypass'] = rejected(lambda: validate_process_execution_surface(source + "\nrunner = subprocess.run\nrunner(['python', 'early-detection-continuous-free-source-v22.py'])\n"))
    kills['subprocessGetattrBypass'] = rejected(lambda: validate_process_execution_surface(source + "\ngetattr(subprocess, 'run')(['python', 'early-detection-continuous-free-source-v22.py'])\n"))
    CONTROLLER_CHILD_EXECUTIONS = 1
    kills['predecessorControllerExecution'] = rejected(validate_constant_time_predecessor_boundary)
    CONTROLLER_CHILD_EXECUTIONS = 0
    run_process(['python', '-c', 'pass'], cwd=ROOT, capture_output=True, text=True)
    kills['ordinaryChildDoesNotTripControllerBoundary'] = CONTROLLER_CHILD_EXECUTIONS == 0
    kills['v21ControllerChildBlockedBeforeSpawn'] = rejected(lambda: run_process(['python', 'early-detection-continuous-free-source-v21.py'], cwd=ROOT, capture_output=True, text=True)) and CONTROLLER_CHILD_EXECUTIONS == 1
    CONTROLLER_CHILD_EXECUTIONS = 0
    kills['v23ControllerChildBlockedBeforeSpawn'] = rejected(lambda: run_process(['python', str(Path(__file__))], cwd=ROOT, capture_output=True, text=True)) and CONTROLLER_CHILD_EXECUTIONS == 1
    CONTROLLER_CHILD_EXECUTIONS = 0
    validate_constant_time_predecessor_boundary()
    if not all(kills.values()):
        fail('kill survived')
    return {'schema': 'early-detection-free-source-operational-state-self-test/v23', 'status': 'PASS', 'killCount': len(kills), 'kills': kills, 'outcomesAccessed': False}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('verify', 'next'):
        child = sub.add_parser(command)
        child.add_argument('--remote', action='store_true')
    sub.add_parser('self-test')
    materialize_parser = sub.add_parser('materialize-pre-introduction')
    materialize_parser.add_argument('--replace-existing-draft', action='store_true')
    args = parser.parse_args()
    try:
        if args.command == 'self-test':
            output = self_test()
        elif args.command == 'materialize-pre-introduction':
            output = materialize(args.replace_existing_draft)
        else:
            output = verify(args.remote)
            if args.command == 'next':
                if output['phase'] != 'POST_INTRODUCTION' or output['controllerResumeAllowed'] is not True:
                    fail('next forbidden before introduction')
                if output['nextDecisionAuthorizedToStart'] is not True:
                    fail('next decision is not authorized to start')
                output = {'schema': 'early-detection-free-source-next/v23', 'status': 'PASS', 'nextTaskId': output['nextTaskId'], 'decisionAuthorizedToStart': True, 'decisionSourceEventId': 'EVT-00000011', 'remoteVerified': True, 'postIntroductionVerified': True, 'q002AutoNext': False, 'outcomesAccessed': False}
    except (EvidenceError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    print(json.dumps(output, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
