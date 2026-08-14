#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import copy
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\worktrees\form25-v2-promotion-20260812")
CONTRACT_REL = "research/early-detection-v4/q010-sc005-pre2021-multitheme-tel-corpus-decision-governance-contract-v1.json"
CONTROLLER_REL = "scripts/early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-v1.py"
EVENT_REL = "state/early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-events-v1.jsonl"
STATE_REL = "state/early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-state-v1.json"
TEST_REL = "tests/early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-v1.test.js"
OWNED_PATHS = [CONTRACT_REL, CONTROLLER_REL, EVENT_REL, STATE_REL, TEST_REL]
FROZEN_STATIC_POLICY = {'repository': {'worktree': 'C:\\Users\\Anwender\\Documents\\GrowthScreenerResearchData\\worktrees\\form25-v2-promotion-20260812', 'gitCommonDir': 'C:\\Users\\Anwender\\OneDrive\\Dokumente\\GitHub\\screener-data\\.git', 'gitExecutable': 'C:\\Program Files\\Git\\cmd\\git.exe', 'branch': 'codex/form25-v2-promotion-20260812', 'upstreamName': 'origin/codex/early-detection-v4-gates-20260810', 'remoteUrl': 'https://github.com/Karlryl/screener-data.git', 'remoteRef': 'refs/heads/codex/early-detection-v4-gates-20260810', 'baseCommit': 'c40c879070ac05b1aac11ab7c8f52b1dcc8cc375', 'expectedIntroductionSubject': 'Tag 923: Q010-SC005 Pre-2021-Multithemen-TEL-Korpus vorab entscheiden', 'expectedCommitMessageUtf8': 'Tag 923: Q010-SC005 Pre-2021-Multithemen-TEL-Korpus vorab entscheiden\n', 'expectedIntroductionPaths': ['research/early-detection-v4/q010-sc005-pre2021-multitheme-tel-corpus-decision-governance-contract-v1.json', 'scripts/early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-v1.py', 'state/early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-events-v1.jsonl', 'state/early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-state-v1.json', 'tests/early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-v1.test.js'], 'introductionMustBeExactFiveAdditionsDirectChildOfBase': True, 'gitEnvironmentPolicy': 'REMOVE_ALL_INHERITED_GIT_STAR_CASE_INSENSITIVE_THEN_SET_CONTROLLED_NOSYSTEM_AND_EMPTY_GLOBAL', 'gitReplaceObjectsPolicy': 'ALL_GIT_CALLS_USE_NO_REPLACE_OBJECTS_AND_REFS_REPLACE_MUST_BE_EMPTY', 'gitConfigPolicy': 'EFFECTIVE_SHOW_ORIGIN_SHOW_SCOPE_SYSTEM_GLOBAL_DISABLED_LOCAL_AND_WORKTREE_EXACT_ALLOWLIST_COMMAND_OVERRIDES_EXACT_NO_PROCESS_TLS_URL_OR_HELPER_SURFACE', 'foreignUntrackedPathsIgnoredButNeverIntroduced': True, 'gitWorktreeDir': 'C:\\Users\\Anwender\\OneDrive\\Dokumente\\GitHub\\screener-data\\.git\\worktrees\\form25-v2-promotion-20260812', 'gitLocalConfigFile': 'C:\\Users\\Anwender\\OneDrive\\Dokumente\\GitHub\\screener-data\\.git\\config', 'gitWorktreeConfigFile': 'C:\\Users\\Anwender\\OneDrive\\Dokumente\\GitHub\\screener-data\\.git\\worktrees\\form25-v2-promotion-20260812\\config.worktree'}, 'parentTag922Binding': {'commit': 'c40c879070ac05b1aac11ab7c8f52b1dcc8cc375', 'parentCommit': 'd1768fe86422287b39fdf7b13531a8336cfe5f9b', 'subject': 'Tag 922: Q010-SC004 AI-Methodenpfad pausieren', 'committedAtUtc': '2026-08-14T11:23:07Z', 'introducedBlobBindings': [{'path': 'research/early-detection-v4/q010-sc004-methods-path-deferred-governance-contract-v1.json', 'gitBlobSha1': '32d274435e2d4df096ea007844bb9fe934b93a02', 'rawSha256': '99104f1615ba2d5e4f4adfc1a8353ab6cbd01c981be8eeece36dd1c9ad5bbe56', 'rawBytes': 10251}, {'path': 'scripts/early-detection-q010-sc004-methods-path-deferred-v1.py', 'gitBlobSha1': '820f0ded36452fa99df1418e251c482518b7f639', 'rawSha256': '19795c63e0db1fd2ec785aaf3f3fa0975f4ef0017861b2c19c1a6713ac3fac03', 'rawBytes': 45688}, {'path': 'state/early-detection-q010-sc004-methods-path-deferred-events-v1.jsonl', 'gitBlobSha1': '46dbc4307583419fcbb28eb4d66ead12b6edd080', 'rawSha256': 'a8152fab07f21908e15f90de435ae3eb99c30c1b0965e5bc36d159c10d782371', 'rawBytes': 2141}, {'path': 'state/early-detection-q010-sc004-methods-path-deferred-state-v1.json', 'gitBlobSha1': 'aeaf28f713d2e3343962cc95159be45d000a7d93', 'rawSha256': '893628622b5cd010918e4b6e8668f892b5d3c63f8854a63b6b80b3fe0a2ddb56', 'rawBytes': 2930}, {'path': 'tests/early-detection-q010-sc004-methods-path-deferred-v1.test.js', 'gitBlobSha1': '013cce78cea710a9e5bd0f4282627f68b0fa1c66', 'rawSha256': 'be056767376e4feb912fd78c883e17eca52e264c7831b3f8d543d86fc495ed15', 'rawBytes': 9377}]}, 'tag911PriorGovernanceBinding': {'commit': 'ba90828892932147c93afe2040498116982bd416', 'parentCommit': 'd6567c86e5ccba9f0a4d904113b2e2a9d06ef2ff', 'subject': 'Tag 911: Früherkennungskern operativ priorisieren', 'committedAtUtc': '2026-08-13T20:37:18Z', 'path': 'state/early-detection-free-source-state-v23.json', 'gitBlobSha1': '167566f732f4e2519909f72905cc8cfe36b453ce', 'rawSha256': '29d40b8d2a34c8d2377b086ea92154ddbc41a72670bff79bd9b41922a1cb5297', 'rawBytes': 52300, 'sourceJsonPointer': 'operationalProjection.originalV4', 'originalV4Protocol': 'FEM-SEC-US@1.2.0', 'originalV4GreenOfficialGates': 2, 'originalV4OfficialGateCount': 13, 'originalV4Complete': False, 'originalV4ResultComputationAllowed': False, 'originalV4OutcomesAccessed': False}, 'tag914CarriedFrameBinding': {'binding': {'commit': '2d744159e4a001bfe1e2ff5b9d31113cbc347487', 'parentCommit': '504018d8bfd0fe5589c37be42e8c8b8c464fec9b', 'subject': 'Tag 914: Q010-DMV-Korpus point-in-time einfrieren', 'committedAtUtc': '2026-08-13T22:12:39Z', 'introducedBlobBindings': [{'path': 'reports/early-detection/q010-sc001-ca-dmv-av-2015-tel-v1.json', 'gitBlobSha1': '2139337fc9a061e1aa0c9e85f4e4ff938d9815ef', 'rawSha256': 'fecbcf29d38176e6218fe4e1cd7de33690889feedd6930f2a7ec4501fd1aee3d', 'rawBytes': 14382}, {'path': 'research/early-detection-v4/q010-sc001-ca-dmv-av-2015-corpus-contract-v1.json', 'gitBlobSha1': '747795d620f5a5d8e10b008550f0df424ca0fc34', 'rawSha256': '2cedda656f45d00f20d3b47b738a21ece418be44f9cbaefb1c7cf8f56fa62305', 'rawBytes': 30753}, {'path': 'scripts/early-detection-q010-sc001-corpus-v1.py', 'gitBlobSha1': '037c91773d19b9e137f2a2aa3be6ba1241b71dda', 'rawSha256': 'ba927192e6eb651c4df4b650f0163af1001e256503ffc1a85358aae2a1ed75d3', 'rawBytes': 37222}, {'path': 'state/early-detection-q010-sc001-source-events-v1.jsonl', 'gitBlobSha1': '36c18e1e3b543b667eb0357982c39d9e32b5f056', 'rawSha256': '4bc5010eb446f53c8efd3a8114f462f5ec87b768dffc83348ce437070aeeffa2', 'rawBytes': 995}, {'path': 'tests/early-detection-q010-sc001-corpus-v1.test.js', 'gitBlobSha1': '74b3a1f7f7b4dadcb48e5f51e4ab64e743cce875', 'rawSha256': 'a89a02544837347200d9d41b8574eb5a1518d105b8628f0e8a7dd7ae4cd262cc', 'rawBytes': 2812}], 'contractSelfSha256': 'a1830247bb4aee1088312f2172da0c2f273e6fab9466f1f6e40ba797765d7e5b', 'reportSelfSha256': '21ad19897f0cffc54606ceb02ebfcd824c14c681b0ba6a2b1b9d75d7cbbe5651', 'sourceManifest12CanonicalSha256': '27667a68c102d7cb3918465e1c0e519e583603000c9c656db66b65841e9730cf', 'dmvSourceManifest8CanonicalSha256': '5aff46f698d8510f764e0a3517d518d3c6dd8fff945bddc02d92709b02279e85', 'frozenTreatmentPopulationCanonicalSha256': '4717b3847f11a5e3e05e9290890c6ceab493d3197b2ef5b9dfd75cb0ee0ceffd', 'frozenPopulationId': 'POP-CA-DMV-AV-PERMIT-HOLDERS-2015-FULL-CENSUS', 'frozenPopulationCount': 7}, 'sourceRows': [{'dimensionsAttempted': ['T', 'E', 'L'], 'entityId': None, 'identityHoldReason': 'EXACT_PIT_LISTED_PARENT_OR_PRIMARY_LISTING_UNRESOLVED', 'identityStatus': 'REJECTED_HOLD', 'listingId': None, 'populationRowId': 'DMV2015-BOSCH', 'reportSourceId': 'SRC-CA-DMV-BOSCH-2015', 'reportedLegalName': 'Bosch, LLC', 'signalEligible': False}, {'dimensionsAttempted': ['T', 'E', 'L'], 'entityId': None, 'identityHoldReason': 'EXACT_PIT_LISTED_PARENT_OR_PRIMARY_LISTING_UNRESOLVED', 'identityStatus': 'REJECTED_HOLD', 'listingId': None, 'populationRowId': 'DMV2015-DELPHI', 'reportSourceId': 'SRC-CA-DMV-DELPHI-2015', 'reportedLegalName': 'Delphi Automotive Systems, LLC', 'signalEligible': False}, {'dimensionsAttempted': ['T', 'E', 'L'], 'entityId': None, 'identityHoldReason': 'EXACT_PIT_LISTED_PARENT_OR_PRIMARY_LISTING_UNRESOLVED', 'identityStatus': 'REJECTED_HOLD', 'listingId': None, 'populationRowId': 'DMV2015-GOOGLE', 'reportSourceId': 'SRC-CA-DMV-GOOGLE-2015', 'reportedLegalName': 'Google Auto, LLC', 'signalEligible': False}, {'dimensionsAttempted': ['T', 'E', 'L'], 'entityId': None, 'identityHoldReason': 'EXACT_PIT_LISTED_PARENT_OR_PRIMARY_LISTING_UNRESOLVED', 'identityStatus': 'REJECTED_HOLD', 'listingId': None, 'populationRowId': 'DMV2015-NISSAN', 'reportSourceId': 'SRC-CA-DMV-NISSAN-2015', 'reportedLegalName': 'Nissan North America, Inc', 'signalEligible': False}, {'dimensionsAttempted': ['T', 'E', 'L'], 'entityId': None, 'identityHoldReason': 'EXACT_PIT_LISTED_PARENT_OR_PRIMARY_LISTING_UNRESOLVED', 'identityStatus': 'REJECTED_HOLD', 'listingId': None, 'populationRowId': 'DMV2015-MERCEDES', 'reportSourceId': 'SRC-CA-DMV-MERCEDES-2015', 'reportedLegalName': 'Mercedes-Benz Research & Development North America, Inc', 'signalEligible': False}, {'cik': '0001318605', 'dimensionsAttempted': ['T', 'E', 'L'], 'effectiveFrom': '2010-06-29T00:00:00Z', 'effectiveTicker': 'TSLA', 'effectiveTo': None, 'entityId': 'CIK0001318605', 'exchangeMic': 'XNAS', 'identityEvidenceSourceIds': ['SRC-SEC-TESLA-2014-10K-INDEX', 'SRC-SEC-TESLA-2014-10K'], 'identityKnownAtUtc': '2015-03-23T03:47:35Z', 'identityStatus': 'PIT_EXACT_SINGLE_LISTING_RESOLVED', 'listingId': 'CIK0001318605-XNAS-TSLA-2015', 'populationRowId': 'DMV2015-TESLA', 'reportSourceId': 'SRC-CA-DMV-TESLA-2015', 'reportedLegalName': 'Tesla Motors, Inc.', 'securityId': 'CIK0001318605-COMMON', 'signalEligible': True}, {'dimensionsAttempted': ['T', 'E', 'L'], 'entityId': None, 'identityHoldReason': 'EXACT_PIT_LISTED_PARENT_OR_PRIMARY_LISTING_UNRESOLVED', 'identityStatus': 'REJECTED_HOLD', 'listingId': None, 'populationRowId': 'DMV2015-VOLKSWAGEN', 'reportSourceId': 'SRC-CA-DMV-VOLKSWAGEN-2015', 'reportedLegalName': 'Volkswagen Group of America, Inc.', 'signalEligible': False}], 'sourceRowsCanonicalBytes': 2592, 'sourceRowsCanonicalSha256': '86cbf51e9181c92c91dbca66f06eb86f11bccd49dfb041f556c2b67510759b2e', 'rowOrderExact': ['DMV2015-BOSCH', 'DMV2015-DELPHI', 'DMV2015-GOOGLE', 'DMV2015-NISSAN', 'DMV2015-MERCEDES', 'DMV2015-TESLA', 'DMV2015-VOLKSWAGEN'], 'carriedThemeOrdinal': 13, 'carriedThemeLabel': 'autonomous driving', 'carriedDisposition': 'COMPLETE_OFFICIAL_REGISTER_MANIFEST', 'populationCount': 7, 'eligibleRowCountN': 1, 'eligiblePopulationRowId': 'DMV2015-TESLA', 'eligibleIdentityStatus': 'PIT_EXACT_SINGLE_LISTING_RESOLVED', 'identityHoldRowCount': 6, 'identityHoldStatus': 'REJECTED_HOLD', 'identityHoldReason': 'EXACT_PIT_LISTED_PARENT_OR_PRIMARY_LISTING_UNRESOLVED', 'newDiscoveryRequestCount': 0, 'newSourceRequestCount': 0, 'adapterRule': 'ORDERED_DEEP_COPY_OF_TAG914_FROZEN_TREATMENT_POPULATION_ROWS_NO_RENAME_NO_LOOKUP', 'historicalDiscoveryBudgetComparableToNewFrames': False, 'carriedTag914FrameReopenForbidden': True}, 'protocolBinding': {'preregistrationPath': 'protocol/early-detection/1.2.0/preregistration.json', 'preregistrationGitBlobSha1': '807a4044e4f3797dd5f1ce10829cee2a58b3b897', 'preregistrationRawSha256': '894caf1c5ba0a65a17d1f252c62514dcf169168de14d78834e38811712d1e18f', 'preregistrationRawBytes': 46985, 'readmePath': 'protocol/early-detection/1.2.0/README.md', 'readmeGitBlobSha1': 'ed0d9fcb5d9780a31ad5bed393b80887ae3afd69', 'readmeRawSha256': '4f829f6cc854d86f9cc49b6779ba85707d2a910a9c5507376a05cd9bb7c07de1', 'readmeRawBytes': 4812, 'v23Path': 'state/early-detection-free-source-state-v23.json', 'v23GitBlobSha1': '167566f732f4e2519909f72905cc8cfe36b453ce', 'v23RawSha256': '29d40b8d2a34c8d2377b086ea92154ddbc41a72670bff79bd9b41922a1cb5297', 'v23RawBytes': 52300}, 'decision': {'subchunkId': 'Q010-SC005-PRE2021-MULTITHEME-TEL-CORPUS-DECISION', 'decisionStatus': 'DECISION_RECORDED_NO_START', 'workDisposition': 'DEFERRED_TO_SEPARATE_PROSPECTIVE_DECISIONS', 'finalPolicyMaterializedAtUtc': '2026-08-14T18:50:48.5979245Z', 'decisionEffectiveOnlyAfterRemoteIntroduction': True, 'scope': 'BOUNDED_ALL_15_PREREGISTERED_THEME_DISCOVERY_FRAME_NOT_WORLD_OR_THEME_CENSUS', 'nextDecisionId': 'Q010-SC005-FREE-OFFICIAL-ROUTE-DISCOVERY-DECISION', 'nextTag': 924, 'nextDecisionConstructionScope': 'CONSTRUCT_SEPARATE_SYMMETRIC_FREE_OFFICIAL_ROUTE_DISCOVERY_DECISION_ONLY', 'nextDecisionConstructionAuthorizedPreIntroduction': False, 'nextDecisionConstructionAuthorizedPostIntroduction': True, 'startAuthorized': False, 'workStarted': False, 'sourceAccessAuthorized': False, 'routeDiscoveryAuthorized': False, 'censusDiscoveryAuthorized': False, 'censusManifestFreezeAuthorized': False, 'captureAuthorized': False, 'codingAuthorized': False, 'aggregationAuthorized': False, 'packetAccessAuthorized': False, 'aiRunAuthorized': False, 'sourceRequests': 0, 'routeDiscoveryRequests': 0, 'censusRequests': 0, 'captureRequests': 0, 'aiRuns': 0, 'assessedAiRunPathSlotCount': 56, 'humanAgreementGate': 'OPEN', 'currentKnowledgeContaminationEliminated': False, 'outcomeBlindClaimed': False, 'outcomeInputPolicy': 'NO_NEW_OUTCOME_ARTIFACTS_OPENED_EXISTING_PREREG_OUTCOME_CATEGORIES_AUDIT_ONLY_NOT_OPERATIONAL', 'preexistingPreregisteredOutcomeCategoryLabelsPresent': True, 'operationalUseOfPreregisteredOutcomeCategories': False, 'epistemicStatus': 'PSEUDO_PROSPECTIVE_HISTORICAL_RECONSTRUCTION_NEVER_FULLY_BLIND', 'prospectivePitVerified': False, 'newPriceReturnGqsOrOutcomeArtifactsAccessed': False, 'currentIdentifiersAccessed': False, 'candidateState': None, 'signalState': None, 'telFinalState': None, 'timeCapsuleState': None, 'levelsAssigned': False, 'sourceRecordCount': 0, 'systemEstablished': False, 'scientificCredit': 'NONE', 'originalV4Protocol': 'FEM-SEC-US@1.2.0', 'originalV4GreenOfficialGates': 2, 'originalV4OfficialGateCount': 13, 'originalV4Complete': False, 'originalV4ResultComputationAllowed': False, 'originalV4OutcomesAccessed': False}, 'framePolicy': {'availableOfficialRegisterCorpusTargetDefined': True, 'availableOfficialRegisterCorpusMaterialized': False, 'frameClaim': 'BOUNDED_AVAILABLE_OFFICIAL_REGISTER_CORPUS_TARGET_ONLY', 'worldCensusClaimed': False, 'themeCensusClaimed': False, 'availabilityBiasAcknowledged': True, 'generalizabilityClaimed': False, 'themeCount': 15, 'roster': [{'ordinal': 1, 'themeLabel': 'cloud computing', 'preregCategoryAuditOnly': 'successAndMixed'}, {'ordinal': 2, 'themeLabel': 'smartphones and mobile ecosystems', 'preregCategoryAuditOnly': 'successAndMixed'}, {'ordinal': 3, 'themeLabel': 'semiconductors and AI infrastructure', 'preregCategoryAuditOnly': 'successAndMixed'}, {'ordinal': 4, 'themeLabel': 'solar and batteries', 'preregCategoryAuditOnly': 'successAndMixed'}, {'ordinal': 5, 'themeLabel': 'shale gas and LNG', 'preregCategoryAuditOnly': 'successAndMixed'}, {'ordinal': 6, 'themeLabel': 'cybersecurity', 'preregCategoryAuditOnly': 'successAndMixed'}, {'ordinal': 7, 'themeLabel': 'GLP-1', 'preregCategoryAuditOnly': 'successAndMixed'}, {'ordinal': 8, 'themeLabel': 'industrial automation', 'preregCategoryAuditOnly': 'successAndMixed'}, {'ordinal': 9, 'themeLabel': '3D printing', 'preregCategoryAuditOnly': 'failuresOrLongDelays'}, {'ordinal': 10, 'themeLabel': 'metaverse', 'preregCategoryAuditOnly': 'failuresOrLongDelays'}, {'ordinal': 11, 'themeLabel': 'hydrogen mobility', 'preregCategoryAuditOnly': 'failuresOrLongDelays'}, {'ordinal': 12, 'themeLabel': 'cannabis', 'preregCategoryAuditOnly': 'failuresOrLongDelays'}, {'ordinal': 13, 'themeLabel': 'autonomous driving', 'preregCategoryAuditOnly': 'failuresOrLongDelays'}, {'ordinal': 14, 'themeLabel': 'earlier cleantech waves', 'preregCategoryAuditOnly': 'failuresOrLongDelays'}, {'ordinal': 15, 'themeLabel': 'selected genomics and biotechnology hype', 'preregCategoryAuditOnly': 'failuresOrLongDelays'}], 'rosterCanonicalBytes': 1437, 'rosterCanonicalSha256': '5acb2252c2a35787ae6902b01a8fe8e7c10a52a60c6f7c5609487f1e153f96b5', 'preregCategoryCountsAuditOnly': {'successAndMixed': 8, 'failuresOrLongDelays': 7}, 'preregCategoriesAuditOnly': True, 'preregCategoriesOperationallyIgnored': True, 'carriedTag914ThemeOrdinal': 13, 'unresolvedThemeOrdinals': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15], 'unresolvedThemeCount': 14, 'unresolvedThemeAuthorityStatus': 'UNASSIGNED_PENDING_FUTURE_DECISION', 'commonEraStartUtc': '2009-01-01T00:00:00Z', 'commonEraEndUtc': '2020-12-31T23:59:59Z', 'knownAtPolicy': 'EXACT_SOURCE_CLASS_REQUIRED_AVAILABILITY_KNOWN_AT_WITH_TIMEZONE_AND_NOT_AFTER_CUTOFF', 'retrievedAtAndCapturedAtSeparateFromKnownAt': True, 'missingTimezoneDisposition': 'HOLD_EXACT_PUBLICATION_TIME_UNPROVEN', 'knownAtAfterCutoffDisposition': 'HOLD_KNOWN_AT_AFTER_CUTOFF', 'routeDiscoveryCaps': 'SAME_POSITIVE_NUMERIC_CAP_FOR_EACH_UNRESOLVED_THEME_NO_TRANSFER_NO_RETRY_NO_EARLY_STOP', 'carriedFrameNewDiscoveryRequests': 0, 'unresolved14DiscoveryAsymmetryForbidden': True, 'carriedHistoricalDiscoveryAsymmetryAcknowledgedAndExemptOnlyFromDiscoveryBudgetComparison': True, 'allCompleteFrameCaptureAsymmetryForbidden': True, 'directOfficialTransportOnly': True, 'officialFreePrimaryPayloadRequiredForAcceptedCaptureOrFutureSourceRecordEligibility': True, 'archiveCdxSecondaryUse': 'LOCATOR_ONLY_NO_ACCEPTANCE_NO_TEL_NO_CREDIT', 'all15TerminalBeforeCaptureDecision': True, 'minimumEligibleCompleteThemesK': 3, 'eligibleCompleteThemeRule': 'COMPLETE_OFFICIAL_REGISTER_MANIFEST_AND_ELIGIBLE_ROW_COUNT_N_AT_LEAST_1', 'allCompleteFramesIncludedWithoutSelectionOrReplacement': True, 'zeroRowCompleteFramesRemainVisibleAndContribute_ONE_SHARED_T_ONLY_BUT_NOT_K': True, 'unitTopology': 'FOR_EACH_COMPLETE_THEME_ONE_SHARED_T_PLUS_ONE_E_AND_ONE_L_PER_ELIGIBLE_CENSUS_ROW', 'unitCountFormula': 'U=SUM_OVER_ALL_COMPLETE_THEMES(1+2*N_i)', 'captureScheduledSlotCapFormula': '3*U', 'captureNetworkRequestCapFormula': 'NETWORK_REQUESTS<=3*U', 'captureAcceptedPayloadCapFormula': 'ACCEPTED_PAYLOAD_CAP=2*U', 'perUnitBudget': 'THREE_FIXED_ORDERED_REQUEST_SLOTS_ACCEPT_FIRST_TWO_VALID_PRIMARY_PAYLOADS_THIRD_VALID_IS_CAP_EXHAUSTED_NO_RETRY_TRANSFER_OR_EARLY_STOP', 'tPseudoreplicationForbidden': True, 'controlsStatus': 'HOLD_CONTROL_FRAME_NOT_FROZEN', 'controlsRemainVisibleNonHealing': True, 'controlsBlockCandidateSignalTelTimeCapsuleScienceAndFinalSymmetricStudyCorpus': True, 'controlsDoNotBlockOperationalAvailableManifestStage': True, 'operationalManifestStageTarget': 'K_ELIGIBLE_COMPLETE_THEME_COUNT_GTE3', 'operationalManifestStageStatusIfMet': 'ALL_15_DISCOVERY_TERMINAL_AVAILABLE_OFFICIAL_REGISTER_MANIFEST_STAGE_COMPLETE_UNCODED_NO_CREDIT_WITH_TYPED_HOLDS_VISIBLE'}, 'terminalHoldCodes': ['HOLD_NO_PREAUTHORIZED_OFFICIAL_ROUTE', 'HOLD_NO_COMPLETE_OFFICIAL_FRAME', 'HOLD_FRAME_SCOPE_AMBIGUOUS', 'HOLD_OFFICIAL_FRAME_CONFLICT', 'HOLD_EXACT_PUBLICATION_TIME_UNPROVEN', 'HOLD_KNOWN_AT_AFTER_CUTOFF', 'HOLD_SOURCE_CLASS_OR_AUTHORITY_MISMATCH', 'HOLD_IDENTITY_UNRESOLVED', 'HOLD_BUDGET_EXHAUSTED', 'HOLD_CONTROL_FRAME_NOT_FROZEN', 'HOLD_FORBIDDEN_TERM_OR_CURRENT_IDENTIFIER_EXPOSURE', 'HOLD_NOT_REQUESTED_GLOBAL_SAFETY_STOP', 'HOLD_FEWER_THAN_THREE_COMPLETE_OFFICIAL_FRAMES', 'HOLD_NO_ACCEPTED_PRIMARY_T', 'HOLD_NO_ACCEPTED_PRIMARY_E', 'HOLD_NO_ACCEPTED_PRIMARY_L'], 'futureGovernance': {'tag923AuthorizesOnly': 'CONSTRUCTION_OF_TAG924_ROUTE_DISCOVERY_DECISION_AFTER_TAG923_REMOTE_POST', 'tag923AuthorizesNoSourcePacketCensusCaptureCodingAggregationOrAiRun': True, 'tag923FirstLinkBootstrap': {'prospectivePriorRemoteReceiptAvailable': False, 'priorRemoteReceiptArtifact': None, 'bootstrapAuthority': 'EXACT_TAG922_COMMIT_PARENT_SUBJECT_TIME_AND_FIVE_GIT_BLOB_BINDINGS', 'inventedRetroactiveTag922RemoteReceiptForbidden': True}, 'rolePhaseCount': 10, 'rolePhases': [{'ordinal': 1, 'role': 'ROUTE_DISCOVERY_DECISION', 'priorRemoteRole': 'TAG923_REMOTE', 'mayAuthorize': [], 'mustBeRemoteBeforeNext': True, 'scienceAndAccessLocks': 'ALL_FALSE_ZERO_NULL_NONE'}, {'ordinal': 2, 'role': 'ROUTE_DISCOVERY_START', 'priorRemoteRole': 'ROUTE_DISCOVERY_DECISION_REMOTE', 'mayAuthorize': ['FREE_OFFICIAL_ROUTE_DISCOVERY_FOR_UNRESOLVED_14_ONLY'], 'mustBeRemoteBeforeNext': True, 'scienceAndAccessLocks': 'ONLY_ROUTE_SOURCE_ACCESS_MAY_TRANSITION_TRUE'}, {'ordinal': 3, 'role': 'ROUTE_DISCOVERY_TERMINAL', 'priorRemoteRole': 'ROUTE_DISCOVERY_START_REMOTE', 'mayAuthorize': [], 'mustBeRemoteBeforeNext': True, 'scienceAndAccessLocks': 'NO_TEL_NO_CANDIDATE_NO_CREDIT'}, {'ordinal': 4, 'role': 'CENSUS_DISCOVERY_DECISION', 'priorRemoteRole': 'ROUTE_DISCOVERY_TERMINAL_REMOTE', 'mayAuthorize': [], 'mustBeRemoteBeforeNext': True, 'scienceAndAccessLocks': 'ALL_FALSE_ZERO_NULL_NONE'}, {'ordinal': 5, 'role': 'CENSUS_DISCOVERY_START', 'priorRemoteRole': 'CENSUS_DISCOVERY_DECISION_REMOTE', 'mayAuthorize': ['OFFICIAL_FRAME_CENSUS_ONLY'], 'mustBeRemoteBeforeNext': True, 'scienceAndAccessLocks': 'ONLY_CENSUS_SOURCE_ACCESS_MAY_TRANSITION_TRUE'}, {'ordinal': 6, 'role': 'CENSUS_DISCOVERY_TERMINAL', 'priorRemoteRole': 'CENSUS_DISCOVERY_START_REMOTE', 'mayAuthorize': [], 'mustBeRemoteBeforeNext': True, 'scienceAndAccessLocks': 'NO_TEL_NO_CANDIDATE_NO_CREDIT'}, {'ordinal': 7, 'role': 'CONTEMPORANEOUS_TERM_FREEZE', 'priorRemoteRole': 'CENSUS_DISCOVERY_TERMINAL_REMOTE', 'mayAuthorize': [], 'mustBeRemoteBeforeNext': True, 'scienceAndAccessLocks': 'NO_NEW_SOURCE_NO_TEL_NO_CANDIDATE_NO_CREDIT'}, {'ordinal': 8, 'role': 'CAPTURE_DECISION', 'priorRemoteRole': 'CONTEMPORANEOUS_TERM_FREEZE_REMOTE', 'mayAuthorize': [], 'mustBeRemoteBeforeNext': True, 'scienceAndAccessLocks': 'ALL_FALSE_ZERO_NULL_NONE'}, {'ordinal': 9, 'role': 'CAPTURE_START', 'priorRemoteRole': 'CAPTURE_DECISION_REMOTE', 'mayAuthorize': ['EQUAL_BUDGET_CAPTURE_ONLY'], 'mustBeRemoteBeforeNext': True, 'scienceAndAccessLocks': 'ONLY_CAPTURE_SOURCE_ACCESS_MAY_TRANSITION_TRUE'}, {'ordinal': 10, 'role': 'CAPTURE_TERMINAL', 'priorRemoteRole': 'CAPTURE_START_REMOTE', 'mayAuthorize': [], 'mustBeRemoteBeforeNext': False, 'scienceAndAccessLocks': 'NO_CODING_NO_TEL_NO_CANDIDATE_NO_CREDIT'}], 'decisionToStartImmutableBytesRule': 'START_MUST_EMBED_BYTE_IDENTICAL_FULL_CANONICAL_DECISION_AND_REMOTE_RECEIPT_ARTIFACT_WITH_NO_DECISION_FIELD_MUTATION_AUTHORIZATION_EXISTS_ONLY_IN_SEPARATE_START_ENVELOPE', 'runtimeSchemaCountInTag923': 0, 'runtimeMechanicsClaimedImplementedByTag923': False, 'crossPhaseObligationCount': 9, 'crossPhaseObligationsExact': ['EXACT_ROLE_PHASE_APPEND_ONLY_REMOTE_TOPOLOGY_WITH_PHASE_SPECIFIC_TERMINAL_BRANCHES', 'EACH_DECISION_REMOTE_BEFORE_SEPARATE_START_REMOTE_BEFORE_ANY_AUTHORIZED_ACCESS', 'EACH_START_EMBEDS_BYTE_IDENTICAL_CANONICAL_DECISION_AND_PRIOR_REMOTE_RECEIPT_WITH_AUTHORIZATION_ONLY_IN_SEPARATE_START_ENVELOPE', 'EXACT_PUBLIC_CONTENT_ADDRESSED_PRIOR_REMOTE_RECEIPT_ARTIFACTS_FROM_TAG923_FORWARD_AND_ACYCLIC_NO_NEXT_RECEIPT_SEAL_RULE', 'EXACT_FIVE_PATH_DIRECT_CHILD_GIT_INTRODUCTIONS_WITH_FULL_PARENT_BLOB_EQUALITY_RAW_COMMIT_TIME_AND_SUBJECT_PLUS_LF_ONLY', 'STRICT_DUPLICATE_KEY_FREE_EXACT_KEY_VALUE_SCHEMAS_WITH_ALIAS_FREE_GENERATION_AND_REACHABILITY_GATES', 'PUBLIC_GOVERNANCE_STATE_DERIVED_ONLY_BY_EXACT_EVENT_PREFIX_REPLAY_WITH_ALL_NO_CREDIT_LOCKS', 'CONTENT_ADDRESSED_IMPLEMENTATION_ARTIFACTS_BIND_ACTIVE_CALLABLE_BYTES_NO_DYNAMIC_IMPORT_EVAL_OR_DECLARED_HASH_ONLY', 'CANDIDATE_SIGNAL_TEL_TIMECAPSULE_PIT_SYSTEM_AND_SCIENTIFIC_CREDIT_REMAIN_FALSE_NULL_OR_NONE_AT_EVERY_DISCOVERY_AND_CAPTURE_PHASE'], 'tag924RouteOnlyObligationCount': 10, 'tag924RouteOnlyObligationsExact': ['UNRESOLVED_14_EXACT_ORDINAL_LABEL_ROSTER_WITH_CATEGORIES_AUDIT_ONLY', 'SAME_POSITIVE_ROUTE_DISCOVERY_SLOT_CAP_NO_TRANSFER_RETRY_SUBSTITUTION_OR_EARLY_STOP', 'COMPLETE_ROUTE_DISCOVERY_SLOT_PLAN_WITH_EXACT_METHOD_HEADERS_REQUEST_BYTES_TRANSPORT_AND_ANONYMOUS_OFFICIAL_FREE_RULES', 'ROUTE_ONLY_REQUEST_RESPONSE_RAW_PROJECTION_JOIN_MATERIAL_MANIFEST_AND_CATALOG_AGGREGATION_SCHEMAS', 'ROUTE_ONLY_DURABILITY_ADMISSION_MUTEX_CRASH_RESUME_TRUSTED_UNTRUSTED_INCIDENT_AND_TERMINAL_SCHEMAS', 'ROUTE_DISCOVERY_EXACT_EQUAL_CAP_PLANS_MATERIAL_JOINS_CATALOG_AGGREGATION_AND_CONFLICT_PRECEDENCE', 'ROUTE_IMPLEMENTATION_ARTIFACTS_AND_EXECUTABLE_HASHES_FROZEN_AND_MUTATION_TESTED', 'EXACT_TAG925_ROUTE_START_INTRODUCTION_AND_REMOTE_RECEIPT_POLICY', 'NO_SOURCE_ACCESS_BEFORE_TAG925_ROUTE_START_REMOTE', 'SOURCE_FREE_MATERIALIZATION_FAILURE_REQUIRES_HOLD_NO_START_NO_SOURCE_ACCESS'], 'censusDecisionAfterRouteTerminalObligationCount': 5, 'censusDecisionAfterRouteTerminalObligationsExact': ['MAY_BE_FROZEN_ONLY_AFTER_ROUTE_DISCOVERY_TERMINAL_REMOTE_AND_BEFORE_SEPARATE_CENSUS_START_REMOTE', 'CENSUS_EXACT_REQUEST_PLAN_CONTINUATION_TEMPLATE_MATERIALIZER_PROJECTION_ROWS_DEDUP_CONFLICT_EXHAUSTION_AND_MANIFEST_JOINS', 'CENSUS_RUNTIME_DURABILITY_ADMISSION_INCIDENT_TERMINAL_AND_IMPLEMENTATION_ARTIFACTS_FROZEN_IN_CENSUS_DECISION_NOT_TAG924', 'ALL_15_TERMINAL_LEDGER_WITH_CARRIED_TAG914_AND_COMPLETE_OR_TYPED_HOLD_FOR_EVERY_THEME', 'NO_CENSUS_SOURCE_ACCESS_BEFORE_CENSUS_START_REMOTE'], 'captureDecisionAfterCensusTerminalAndTermFreezeObligationCount': 8, 'captureDecisionAfterCensusTerminalAndTermFreezeObligationsExact': ['MAY_BE_FROZEN_ONLY_AFTER_CENSUS_TERMINAL_REMOTE_AND_CONTEMPORANEOUS_TERM_FREEZE_REMOTE', 'TERM_DERIVATION_ONLY_FROM_CUTOFF_ELIGIBLE_OFFICIAL_FRAME_METADATA_NO_MANUAL_LLM_CURRENT_OR_OUTCOME_ADDITION', 'CAPTURE_EXACT_ALL_COMPLETE_FRAME_UNIT_AND_THREE_SLOT_BIJECTION_RAW_EVIDENCE_FIRST_TWO_VALID_ACCEPTANCE_AND_TERMINAL_EQUATIONS', 'PIT_TIME_FIELDS_SEPARATE_PUBLICATION_AVAILABILITY_EFFECTIVE_RETRIEVAL_WITH_KNOWN_AT_MAX_VERIFIED_PUBLIC_AVAILABILITY', 'ANONYMOUS_OFFICIAL_FREE_TRANSPORT_SAFE_HEADER_URI_HOST_SCHEME_PORT_PATH_AND_NO_CREDENTIAL_SURFACE', 'SOURCE_AGNOSTIC_PREACCESS_SELECTION_REDACTION_IDENTITY_DENYLIST_HIDING_COMMITMENTS_AND_NO_SMALL_SPACE_PUBLIC_ORACLE', 'CAPTURE_RUNTIME_DURABILITY_ADMISSION_INCIDENT_TERMINAL_AND_IMPLEMENTATION_ARTIFACTS_FROZEN_IN_CAPTURE_DECISION_NOT_TAG924', 'CAPTURE_DECISION_CAPTURE_START_AND_CAPTURE_TERMINAL_ARE_THREE_SEPARATE_REMOTE_ROLES'], 'tag924MustNotFreezeCensusOrCaptureRuntimeSchemas': True, 'allTag924RouteObligationsMustBeMaterializedAndMutationTestedBeforeTag925StartRemote': True, 'failureToMaterializeAnyCurrentPhaseObligationDisposition': 'HOLD_NO_START_NO_SOURCE_ACCESS', 'runtimeSchemasMayBeFrozenOnlyProspectivelyBeforeTheirPhase': True}, 'incumbentLocks': {'sc001Tag914Commit': '2d744159e4a001bfe1e2ff5b9d31113cbc347487', 'sc001HoldEffective': True, 'sc002Tag917Commit': 'f606124109b71d20f3ecd555f501afb84d95446c', 'sc002HoldEffective': True, 'sc003Tag920Commit': '8cca973274361b14dc0749f34b852d5c4423785a', 'sc003Tag921Commit': 'd1768fe86422287b39fdf7b13531a8336cfe5f9b', 'sc003TypedGlobalHoldCompletedEffective': True, 'sc004Tag922Commit': 'c40c879070ac05b1aac11ab7c8f52b1dcc8cc375', 'sc004DecisionDeferredNoStartEffective': True, 'humanAgreementGate': 'OPEN', 'ai56RunAuthorized': False, 'ai56Runs': 0, 'q003State': 'PAUSED_NONELIGIBLE', 'q004State': 'PAUSED_NONELIGIBLE', 'q005State': 'PAUSED_NONELIGIBLE'}}
FROZEN_STATIC_POLICY = copy.deepcopy(FROZEN_STATIC_POLICY)
FROZEN_STATIC_POLICY["decision"]["finalPolicyMaterializedAtUtc"] = "2026-08-14T19:10:12.3291443Z"
FROZEN_STATIC_POLICY["framePolicy"]["terminalHoldRuleForInsufficientEligibleCompleteThemes"] = "HOLD_FEWER_THAN_THREE_ELIGIBLE_COMPLETE_OFFICIAL_FRAMES_IFF_COUNT(THEME_DISPOSITION_EQ_COMPLETE_OFFICIAL_REGISTER_MANIFEST_AND_ELIGIBLE_ROW_COUNT_N_GTE_1)_LT_3"
FROZEN_STATIC_POLICY["terminalHoldCodes"] = ["HOLD_FEWER_THAN_THREE_ELIGIBLE_COMPLETE_OFFICIAL_FRAMES" if code == "HOLD_FEWER_THAN_THREE_COMPLETE_OFFICIAL_FRAMES" else code for code in FROZEN_STATIC_POLICY["terminalHoldCodes"]]
EXPECTED_STATIC_POLICY_SHA256 = "707aec4f285534cd5510d9114f901c7b1bac980f1c3eb911ca106d0e9f750654"
EVENT_TIME = "2026-08-14T19:10:12.3291443Z"
EXPECTED_HASH_POLICY = {"canonicalJson":"UTF8_SORT_KEYS_NO_WHITESPACE_SEPARATORS_COMMA_COLON_ENSURE_ASCII_FALSE","contractCoreNormalization":"SET_CORE_SELF_NULL_AND_EVENT_STATE_CONTENT_HASH_FIELDS_NULL","selfHashNormalization":"SET_OWN_SELF_FIELD_NULL","duplicateJsonKeysForbidden":True,"nonFiniteJsonNumbersForbidden":True,"eventLineRule":"ONE_CANONICAL_JSON_OBJECT_PLUS_LF"}
EXPECTED_IMPLEMENTATION_PATHS = {"controllerPath":CONTROLLER_REL,"eventsPath":EVENT_REL,"statePath":STATE_REL,"testPath":TEST_REL}
HEX40 = re.compile(r"[0-9a-f]{40}")
HEX64 = re.compile(r"[0-9a-f]{64}")
TOP_KEYS = ["schema","finalPolicyMaterializedAtUtc","purpose","frozenStaticPolicySha256","contractCoreSha256","contractSelfSha256","staticPolicy","eventContract","stateContract","hashPolicy","implementation"]
EVENT_KEYS = ["schema","sequence","eventId","eventType","createdAtUtc","previousEventSha256","contractCoreSha256","frozenStaticPolicySha256","decisionStatus","decisionEffectiveOnlyAfterRemoteIntroduction","nextDecisionId","nextDecisionConstructionAuthorized","allAccessAndWorkRemainForbidden","science","eventSha256"]
STATE_KEYS = ["schema","materializedAtUtc","authority","contractCoreSha256","frozenStaticPolicySha256","eventCount","eventHeadSha256","decisionStatus","decisionEffectiveOnlyAfterRemoteIntroduction","nextDecisionId","nextDecisionConstructionAuthorized","sourceAccessAuthorized","routeDiscoveryAuthorized","censusDiscoveryAuthorized","captureAuthorized","codingAuthorized","aggregationAuthorized","packetAccessAuthorized","aiRunAuthorized","sourceRequests","routeDiscoveryRequests","censusRequests","captureRequests","aiRuns","sourceRecordCount","levelsAssigned","candidateState","signalState","telFinalState","timeCapsuleState","prospectivePitVerified","newPriceReturnGqsOrOutcomeArtifactsAccessed","currentIdentifiersAccessed","humanAgreementGate","scientificCredit","systemEstablished","originalV4Protocol","originalV4GreenOfficialGates","originalV4OfficialGateCount","originalV4Complete","originalV4ResultComputationAllowed","originalV4OutcomesAccessed","stateSelfSha256"]


class GateError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise GateError(message)


def duplicate_guard(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise GateError(f"duplicate JSON key: {key}")
        out[key] = value
    return out


def strict_json_loads(text, label="JSON"):
    def reject_constant(value):
        raise GateError(f"{label}: non-finite number {value}")
    try:
        return json.loads(text, object_pairs_hook=duplicate_guard, parse_constant=reject_constant)
    except GateError:
        raise
    except Exception as exc:
        raise GateError(f"{label}: invalid JSON: {exc}") from exc


def canonical_bytes(value):
    def scan(item):
        if isinstance(item, float): require(math.isfinite(item), "non-finite JSON number")
        if isinstance(item, dict):
            for nested in item.values(): scan(nested)
        elif isinstance(item, list):
            for nested in item: scan(nested)
    scan(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def sha256_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical_sha(value):
    return sha256_bytes(canonical_bytes(value))


def exact_keys(value, keys, label):
    require(isinstance(value, dict), f"{label}: object required")
    require(list(value.keys()) == keys, f"{label}: exact key/order drift")


def self_hash(value, field):
    work = copy.deepcopy(value)
    work[field] = None
    return canonical_sha(work)


def contract_core(contract):
    work = copy.deepcopy(contract)
    work["contractCoreSha256"] = None
    work["contractSelfSha256"] = None
    work["eventContract"] = {"path": work["eventContract"]["path"], "eventCount": 1, "eventId": "Q010-SC005-EVT-00000001", "eventType": "PRE2021_ALL15_DECISION_RECORDED", "eventRawSha256": None, "eventRawBytes": None, "eventSha256": None}
    work["stateContract"] = {"path": work["stateContract"]["path"], "stateRawSha256": None, "stateRawBytes": None, "stateSelfSha256": None}
    work["implementation"]["eventsRawSha256"] = None
    work["implementation"]["stateRawSha256"] = None
    return canonical_sha(work)


def expected_event(core_sha):
    event = {
        "schema": "q010-sc005-pre2021-all15-decision-event/v1",
        "sequence": 1,
        "eventId": "Q010-SC005-EVT-00000001",
        "eventType": "PRE2021_ALL15_DECISION_RECORDED",
        "createdAtUtc": EVENT_TIME,
        "previousEventSha256": None,
        "contractCoreSha256": core_sha,
        "frozenStaticPolicySha256": EXPECTED_STATIC_POLICY_SHA256,
        "decisionStatus": "DECISION_RECORDED_NO_START",
        "decisionEffectiveOnlyAfterRemoteIntroduction": True,
        "nextDecisionId": "Q010-SC005-FREE-OFFICIAL-ROUTE-DISCOVERY-DECISION",
        "nextDecisionConstructionAuthorized": False,
        "allAccessAndWorkRemainForbidden": True,
        "science": {"candidate": None, "signal": None, "telFinal": None, "timeCapsule": None, "prospectivePitVerified": False, "systemEstablished": False, "scientificCredit": "NONE"},
        "eventSha256": None,
    }
    event["eventSha256"] = self_hash(event, "eventSha256")
    return event


def expected_state(core_sha, event_sha):
    decision = FROZEN_STATIC_POLICY["decision"]
    state = {
        "schema": "q010-sc005-pre2021-all15-decision-state/v1",
        "materializedAtUtc": EVENT_TIME,
        "authority": "STRICT_PUBLIC_EVENT_REPLAY_ONLY",
        "contractCoreSha256": core_sha,
        "frozenStaticPolicySha256": EXPECTED_STATIC_POLICY_SHA256,
        "eventCount": 1,
        "eventHeadSha256": event_sha,
        "decisionStatus": decision["decisionStatus"],
        "decisionEffectiveOnlyAfterRemoteIntroduction": True,
        "nextDecisionId": decision["nextDecisionId"],
        "nextDecisionConstructionAuthorized": False,
        "sourceAccessAuthorized": False,
        "routeDiscoveryAuthorized": False,
        "censusDiscoveryAuthorized": False,
        "captureAuthorized": False,
        "codingAuthorized": False,
        "aggregationAuthorized": False,
        "packetAccessAuthorized": False,
        "aiRunAuthorized": False,
        "sourceRequests": 0,
        "routeDiscoveryRequests": 0,
        "censusRequests": 0,
        "captureRequests": 0,
        "aiRuns": 0,
        "sourceRecordCount": 0,
        "levelsAssigned": False,
        "candidateState": None,
        "signalState": None,
        "telFinalState": None,
        "timeCapsuleState": None,
        "prospectivePitVerified": False,
        "newPriceReturnGqsOrOutcomeArtifactsAccessed": False,
        "currentIdentifiersAccessed": False,
        "humanAgreementGate": "OPEN",
        "scientificCredit": "NONE",
        "systemEstablished": False,
        "originalV4Protocol": "FEM-SEC-US@1.2.0",
        "originalV4GreenOfficialGates": 2,
        "originalV4OfficialGateCount": 13,
        "originalV4Complete": False,
        "originalV4ResultComputationAllowed": False,
        "originalV4OutcomesAccessed": False,
        "stateSelfSha256": None,
    }
    state["stateSelfSha256"] = self_hash(state, "stateSelfSha256")
    return state


def validate_contract(contract, check_artifacts=False, expected_static_policy_sha256=None):
    exact_keys(contract, TOP_KEYS, "contract")
    require(contract["schema"] == "q010-sc005-pre2021-all15-decision-governance-contract/v1", "contract schema drift")
    require(contract["finalPolicyMaterializedAtUtc"] == EVENT_TIME, "final materialization time drift")
    require(contract["purpose"] == "DECISION_ONLY_ALL15_PRE2021_OFFICIAL_REGISTER_FRAME_NO_START_NO_ACCESS_NO_CREDIT", "purpose drift")
    require(FROZEN_STATIC_POLICY["decision"]["finalPolicyMaterializedAtUtc"] == EVENT_TIME, "static time drift")
    require(contract["staticPolicy"] == FROZEN_STATIC_POLICY, "frozen static policy object drift")
    require(canonical_sha(FROZEN_STATIC_POLICY) == EXPECTED_STATIC_POLICY_SHA256 == contract["frozenStaticPolicySha256"], "frozen static policy hash drift")
    if expected_static_policy_sha256 is not None:
        require(expected_static_policy_sha256 == EXPECTED_STATIC_POLICY_SHA256, "caller expected static policy drift")
    exact_keys(contract["eventContract"], ["path","eventCount","eventId","eventType","eventRawSha256","eventRawBytes","eventSha256"], "event contract")
    exact_keys(contract["stateContract"], ["path","stateRawSha256","stateRawBytes","stateSelfSha256"], "state contract")
    exact_keys(contract["hashPolicy"], ["canonicalJson","contractCoreNormalization","selfHashNormalization","duplicateJsonKeysForbidden","nonFiniteJsonNumbersForbidden","eventLineRule"], "hash policy")
    require(contract["hashPolicy"] == EXPECTED_HASH_POLICY, "hash policy truth drift")
    exact_keys(contract["implementation"], ["controllerPath","controllerRawSha256","eventsPath","eventsRawSha256","statePath","stateRawSha256","testPath","testRawSha256","controllerExecutesPredecessorControllers","sourceRequestsDuringBootstrapVerifySelfTest","routeDiscoveryRequestsDuringBootstrapVerifySelfTest","censusRequestsDuringBootstrapVerifySelfTest","captureRequestsDuringBootstrapVerifySelfTest","aiRunsDuringBootstrapVerifySelfTest"], "implementation")
    implementation = contract["implementation"]
    require({key:implementation[key] for key in EXPECTED_IMPLEMENTATION_PATHS} == EXPECTED_IMPLEMENTATION_PATHS, "implementation path drift")
    require(implementation["controllerExecutesPredecessorControllers"] is False, "predecessor controller execution drift")
    for key in ["sourceRequestsDuringBootstrapVerifySelfTest","routeDiscoveryRequestsDuringBootstrapVerifySelfTest","censusRequestsDuringBootstrapVerifySelfTest","captureRequestsDuringBootstrapVerifySelfTest","aiRunsDuringBootstrapVerifySelfTest"]:
        require(implementation[key] == 0, f"{key} drift")
    frame = contract["staticPolicy"]["framePolicy"]
    require(frame["eligibleCompleteThemeRule"] == "COMPLETE_OFFICIAL_REGISTER_MANIFEST_AND_ELIGIBLE_ROW_COUNT_N_AT_LEAST_1", "eligible complete theme rule drift")
    require(frame["minimumEligibleCompleteThemesK"] == 3, "minimum eligible complete theme K drift")
    require(frame["terminalHoldRuleForInsufficientEligibleCompleteThemes"] == "HOLD_FEWER_THAN_THREE_ELIGIBLE_COMPLETE_OFFICIAL_FRAMES_IFF_COUNT(THEME_DISPOSITION_EQ_COMPLETE_OFFICIAL_REGISTER_MANIFEST_AND_ELIGIBLE_ROW_COUNT_N_GTE_1)_LT_3", "eligible complete theme terminal HOLD rule drift")
    hold_codes = contract["staticPolicy"]["terminalHoldCodes"]
    require(hold_codes.count("HOLD_FEWER_THAN_THREE_ELIGIBLE_COMPLETE_OFFICIAL_FRAMES") == 1 and "HOLD_FEWER_THAN_THREE_COMPLETE_OFFICIAL_FRAMES" not in hold_codes, "eligible complete theme terminal HOLD code drift")
    core = contract_core(contract)
    require(contract["contractCoreSha256"] == core, "contract core hash drift")
    require(contract["contractSelfSha256"] == self_hash(contract, "contractSelfSha256"), "contract self hash drift")
    event = expected_event(core)
    state = expected_state(core, event["eventSha256"])
    require(contract["eventContract"] == {"path":EVENT_REL,"eventCount":1,"eventId":event["eventId"],"eventType":event["eventType"],"eventRawSha256":sha256_bytes(canonical_bytes(event)+b"\n"),"eventRawBytes":len(canonical_bytes(event)+b"\n"),"eventSha256":event["eventSha256"]}, "event contract drift")
    state_raw = json.dumps(state, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8") + b"\n"
    require(contract["stateContract"] == {"path":STATE_REL,"stateRawSha256":sha256_bytes(state_raw),"stateRawBytes":len(state_raw),"stateSelfSha256":state["stateSelfSha256"]}, "state contract drift")
    if check_artifacts:
        for path_key, sha_key in [("controllerPath","controllerRawSha256"),("eventsPath","eventsRawSha256"),("statePath","stateRawSha256"),("testPath","testRawSha256")]:
            raw = (ROOT / implementation[path_key]).read_bytes()
            require(sha256_bytes(raw) == implementation[sha_key], f"artifact drift: {path_key}")
        event_raw = (ROOT / EVENT_REL).read_bytes()
        require(event_raw == canonical_bytes(event) + b"\n", "event raw replay drift")
        parsed_state = strict_json_loads((ROOT / STATE_REL).read_text(encoding="utf-8"), "state")
        exact_keys(parsed_state, STATE_KEYS, "state")
        require(parsed_state == state, "state replay drift")
    return True


def clean_git_env(extra=None):
    env = {key:value for key,value in os.environ.items() if not key.upper().startswith("GIT_")}
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = "NUL"
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_NO_REPLACE_OBJECTS"] = "1"
    if extra: env.update(extra)
    return env


def git_argv(args):
    return [FROZEN_STATIC_POLICY["repository"]["gitExecutable"], "--no-replace-objects", "-c", "core.fsmonitor=false", "-c", "credential.helper=", "-c", "core.hooksPath=NUL", "-c", "diff.external=", "-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=never", *args]


def run_git_bytes(args, cwd=ROOT, env_extra=None):
    proc = subprocess.run(git_argv(args), cwd=str(cwd), env=clean_git_env(env_extra), stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    require(proc.returncode == 0, f"git {' '.join(args)} failed: {proc.stderr.decode('utf-8',errors='replace').strip()}")
    return proc.stdout


def run_git(args, cwd=ROOT, env_extra=None):
    return run_git_bytes(args, cwd, env_extra).decode("utf-8", errors="strict").strip()


def validate_effective_git_config(raw):
    repo = FROZEN_STATIC_POLICY["repository"]
    parts = raw.split(b"\0")
    if parts and parts[-1] == b"": parts.pop()
    require(len(parts) % 3 == 0, "effective git config triplet framing drift")
    exact_local = {
        "core.repositoryformatversion":"0", "core.filemode":"false", "core.bare":"false", "core.logallrefupdates":"true",
        "core.autocrlf":"input", "core.ignorecase":"true", "core.symlinks":"false", "extensions.worktreeconfig":"true",
        "remote.origin.url":repo["remoteUrl"], "remote.origin.fetch":"+refs/heads/*:refs/remotes/origin/*",
    }
    exact_worktree = {"core.sparsecheckout":"false", "core.sparsecheckoutcone":"false", "index.sparse":"false"}
    exact_command = {"core.fsmonitor":"false", "credential.helper":"", "core.hookspath":"NUL", "diff.external":"", "protocol.ext.allow":"never", "protocol.file.allow":"never"}
    expected_local_origin = "file:" + Path(repo["gitLocalConfigFile"]).as_posix()
    expected_worktree_origin = "file:" + Path(repo["gitWorktreeConfigFile"]).as_posix()
    seen_command = {}
    seen_worktree = {}
    for index in range(0, len(parts), 3):
        scope = parts[index].decode("ascii", errors="strict")
        origin = parts[index+1].decode("utf-8", errors="strict")
        key_value = parts[index+2].decode("utf-8", errors="strict")
        require("\n" in key_value, "effective git config key/value framing drift")
        key, value = key_value.split("\n", 1)
        if scope == "local":
            require(origin == expected_local_origin, f"unexpected local config origin: {origin}")
            if key in exact_local:
                require(value == exact_local[key], f"unsafe local git config value: {key}")
            elif re.fullmatch(r"branch\.[A-Za-z0-9._/-]+\.remote", key):
                require(value == "origin", f"unsafe branch remote: {key}")
            elif re.fullmatch(r"branch\.[A-Za-z0-9._/-]+\.merge", key):
                require(value.startswith("refs/heads/") and ".." not in value, f"unsafe branch merge: {key}")
            elif key in {"user.name", "user.email"}:
                require("\x00" not in value and "\n" not in value and "\r" not in value, f"unsafe user config: {key}")
            else:
                raise GateError(f"unsafe local git config key: {key}")
        elif scope == "worktree":
            require(origin == expected_worktree_origin and key in exact_worktree and value == exact_worktree[key], f"unsafe worktree git config: {key}")
            require(key not in seen_worktree, f"duplicate worktree git config: {key}")
            seen_worktree[key] = value
        elif scope == "command":
            require(origin == "command line:" and key in exact_command and value == exact_command[key], f"unsafe command git config: {key}")
            require(key not in seen_command, f"duplicate command git config: {key}")
            seen_command[key] = value
        else:
            raise GateError(f"forbidden effective git config scope: {scope}")
    require(seen_worktree == exact_worktree, "worktree config exact set drift")
    require(seen_command == exact_command, "command config hardening set drift")


def validate_git_authority():
    repo = FROZEN_STATIC_POLICY["repository"]
    require(Path(shutil.which("git") or "").resolve() == Path(repo["gitExecutable"]).resolve(), "git executable drift")
    require(Path(run_git(["rev-parse","--show-toplevel"])).resolve() == ROOT.resolve(), "git top-level drift")
    require(Path(run_git(["rev-parse","--git-common-dir"])).resolve() == Path(repo["gitCommonDir"]).resolve(), "git common-dir drift")
    require(Path(run_git(["rev-parse","--absolute-git-dir"])).resolve() == Path(repo["gitWorktreeDir"]).resolve(), "git worktree-dir drift")
    require(run_git(["for-each-ref","--format=%(refname)","refs/replace"]) == "", "git replace refs forbidden")
    validate_effective_git_config(run_git_bytes(["config","--show-origin","--show-scope","--null","--list"]))
    require(run_git(["branch","--show-current"]) == repo["branch"], "branch drift")
    require(run_git(["rev-parse","@{upstream}"]) == run_git(["rev-parse","HEAD"]), "upstream/head drift")
    require(run_git(["remote","get-url","origin"]) == repo["remoteUrl"], "origin URL drift")


def raw_commit_metadata(commit):
    raw = run_git_bytes(["cat-file","commit",commit])
    split = raw.find(b"\n\n")
    require(split >= 0, "raw commit missing message delimiter")
    header = raw[:split].decode("utf-8", errors="strict").splitlines()
    message = raw[split+2:]
    parents = [line[7:] for line in header if line.startswith("parent ")]
    committer = [line for line in header if line.startswith("committer ")]
    require(len(parents) == 1 and len(committer) == 1, "commit parent/committer cardinality drift")
    match = re.search(r" ([0-9]+) ([+-][0-9]{4})$", committer[0])
    require(match is not None, "commit time malformed")
    stamp = dt.datetime.fromtimestamp(int(match.group(1)), tz=dt.timezone.utc).isoformat().replace("+00:00","Z")
    return parents[0], message, stamp


def verify_blob_set(commit, bindings, expected_paths, label):
    delta_raw = run_git_bytes(["diff-tree","--root","--no-commit-id","--name-status","-r","-z",commit])
    parts = [x for x in delta_raw.split(b"\0") if x]
    require(len(parts) == 2*len(expected_paths), f"{label} introduced set cardinality drift")
    delta=[]
    for i in range(0,len(parts),2):
        delta.append((parts[i].decode("ascii"),parts[i+1].decode("utf-8",errors="strict").replace("\\","/")))
    require(delta == [("A",x) for x in expected_paths], f"{label} introduced set drift")
    require([x["path"] for x in bindings] == expected_paths, f"{label} binding order drift")
    for item in bindings:
        spec=f"{commit}:{item['path']}"
        require(run_git(["rev-parse",spec]) == item["gitBlobSha1"], f"{label} git blob drift")
        raw=run_git_bytes(["cat-file","blob",spec])
        require(len(raw)==item["rawBytes"] and sha256_bytes(raw)==item["rawSha256"], f"{label} raw blob drift")


def verify_committed_inputs(contract):
    validate_git_authority()
    static=contract["staticPolicy"]
    for key in ["parentTag922Binding","tag911PriorGovernanceBinding","tag914CarriedFrameBinding","protocolBinding","framePolicy","decision","futureGovernance","incumbentLocks"]:
        require(static[key] == FROZEN_STATIC_POLICY[key], f"{key} drift")
    tag922=static["parentTag922Binding"]
    parent,msg,stamp=raw_commit_metadata(tag922["commit"])
    require(parent==tag922["parentCommit"] and msg==tag922["subject"].encode("utf-8")+b"\n" and stamp==tag922["committedAtUtc"], "Tag922 raw commit drift")
    tag922_time=dt.datetime.fromisoformat(tag922["committedAtUtc"].replace("Z","+00:00"))
    event_time=dt.datetime.fromisoformat(EVENT_TIME.replace("Z","+00:00"))
    require(tag922_time <= event_time, "Tag923 final policy time precedes Tag922 commit")
    verify_blob_set(tag922["commit"],tag922["introducedBlobBindings"],[x["path"] for x in tag922["introducedBlobBindings"]],"Tag922")
    tag911=static["tag911PriorGovernanceBinding"]
    parent,msg,stamp=raw_commit_metadata(tag911["commit"])
    require(parent==tag911["parentCommit"] and msg==tag911["subject"].encode("utf-8")+b"\n" and stamp==tag911["committedAtUtc"], "Tag911 raw commit drift")
    tag911_spec=f"{tag911['commit']}:{tag911['path']}"
    require(run_git(["rev-parse",tag911_spec])==tag911["gitBlobSha1"], "Tag911 state blob OID drift")
    tag911_raw=run_git_bytes(["cat-file","blob",tag911_spec])
    require(len(tag911_raw)==tag911["rawBytes"] and sha256_bytes(tag911_raw)==tag911["rawSha256"], "Tag911 state raw blob drift")
    run_git_bytes(["merge-base","--is-ancestor",tag911["commit"],tag922["commit"]])
    tag914=static["tag914CarriedFrameBinding"]
    binding=tag914["binding"]
    run_git_bytes(["merge-base","--is-ancestor",tag911["commit"],binding["commit"]])
    parent,msg,stamp=raw_commit_metadata(binding["commit"])
    require(parent==binding["parentCommit"] and msg==binding["subject"].encode("utf-8")+b"\n" and stamp==binding["committedAtUtc"], "Tag914 raw commit drift")
    run_git_bytes(["merge-base","--is-ancestor",binding["commit"],tag922["commit"]])
    verify_blob_set(binding["commit"],binding["introducedBlobBindings"],[x["path"] for x in binding["introducedBlobBindings"]],"Tag914")
    protocol=static["protocolBinding"]
    for prefix in ["preregistration","readme","v23"]:
        path=protocol[f"{prefix}Path"]
        spec=f"{tag922['commit']}:{path}"
        require(run_git(["rev-parse",spec])==protocol[f"{prefix}GitBlobSha1"], f"{prefix} blob drift")
        raw=run_git_bytes(["cat-file","blob",spec])
        require(len(raw)==protocol[f"{prefix}RawBytes"] and sha256_bytes(raw)==protocol[f"{prefix}RawSha256"], f"{prefix} raw drift")
    v23=strict_json_loads(run_git_bytes(["cat-file","blob",f"{tag922['commit']}:{protocol['v23Path']}"]).decode("utf-8"),"V23")
    original=v23["operationalProjection"]["originalV4"]
    require(original=={"protocol":"FEM-SEC-US@1.2.0","greenOfficialGates":2,"officialGateCount":13,"complete":False,"resultComputationAllowed":False,"outcomesAccessed":False}, "Original-V4 six-field truth drift")
    prereg=strict_json_loads(run_git_bytes(["cat-file","blob",f"{tag922['commit']}:{protocol['preregistrationPath']}"]).decode("utf-8"),"prereg")
    records=[]
    historical=prereg["historicalTimeCapsules"]
    for category in ["successAndMixed","failuresOrLongDelays"]:
        for label in historical[category]: records.append({"ordinal":len(records)+1,"themeLabel":label,"preregCategoryAuditOnly":category})
    require(records==static["framePolicy"]["roster"], "exact prereg roster/category/order drift")
    corpus_path="research/early-detection-v4/q010-sc001-ca-dmv-av-2015-corpus-contract-v1.json"
    corpus=strict_json_loads(run_git_bytes(["cat-file","blob",f"{binding['commit']}:{corpus_path}"]).decode("utf-8"),"Tag914 corpus")
    population=corpus["frozenTreatmentPopulation"]
    require(canonical_sha(corpus["sourceManifest"])==binding["sourceManifest12CanonicalSha256"] and canonical_sha(corpus["sourceManifest"][:8])==binding["dmvSourceManifest8CanonicalSha256"], "Tag914 source manifest projection drift")
    require(canonical_sha(population)==binding["frozenTreatmentPopulationCanonicalSha256"], "Tag914 population hash drift")
    require(population["rows"]==tag914["sourceRows"] and canonical_sha(population["rows"])==tag914["sourceRowsCanonicalSha256"] and len(canonical_bytes(population["rows"]))==tag914["sourceRowsCanonicalBytes"], "Tag914 ordered rows drift")
    eligible=[x for x in population["rows"] if x["signalEligible"]]
    holds=[x for x in population["rows"] if not x["signalEligible"]]
    require(len(eligible)==1 and eligible[0]["populationRowId"]=="DMV2015-TESLA" and eligible[0]["identityStatus"]=="PIT_EXACT_SINGLE_LISTING_RESOLVED", "Tag914 eligible row drift")
    require(len(holds)==6 and all(x["identityStatus"]=="REJECTED_HOLD" and x["identityHoldReason"]=="EXACT_PIT_LISTED_PARENT_OR_PRIMARY_LISTING_UNRESOLVED" for x in holds), "Tag914 HOLD rows drift")


def owned_statuses():
    raw=run_git_bytes(["status","--porcelain=v1","-z","--untracked-files=all"])
    out={}; parts=raw.split(b"\0"); i=0
    while i<len(parts):
        item=parts[i]
        if not item: i+=1; continue
        require(len(item)>=4,"status record malformed")
        status=item[:2].decode("ascii"); path=item[3:].decode("utf-8",errors="strict").replace("\\","/")
        if status[0] in "RC": i+=1
        if path in OWNED_PATHS: out[path]=status
        i+=1
    return out


def remote_head():
    repo=FROZEN_STATIC_POLICY["repository"]
    outside=Path(tempfile.gettempdir()).resolve()
    require(outside != ROOT.resolve() and ROOT.resolve() not in outside.parents, "remote probe cwd must be outside repository")
    raw=run_git_bytes(["ls-remote","--",repo["remoteUrl"],repo["remoteRef"]],cwd=outside).decode("ascii",errors="strict")
    require(raw.endswith("\n") and raw.count("\n")==1, "remote line cardinality drift")
    fields=raw.rstrip("\n").split("\t")
    require(len(fields)==2 and HEX40.fullmatch(fields[0]) and fields[1]==repo["remoteRef"], "remote line drift")
    return fields[0]


def classify_phase():
    repo=FROZEN_STATIC_POLICY["repository"]
    head=run_git(["rev-parse","HEAD"]); upstream=run_git(["rev-parse","@{upstream}"]); live=remote_head(); statuses=owned_statuses()
    if head==upstream==live==repo["baseCommit"] and statuses=={path:"??" for path in OWNED_PATHS}: return "PRE", head, live
    if head==upstream==live and head!=repo["baseCommit"] and statuses=={}:
        parent,msg,commit_time=raw_commit_metadata(head)
        require(parent==repo["baseCommit"],"POST parent drift")
        require(msg==repo["expectedCommitMessageUtf8"].encode("ascii"),"POST exact commit message/body drift")
        delta_raw=run_git_bytes(["diff-tree","--no-commit-id","--name-status","-r","-z",head])
        parts=[x for x in delta_raw.split(b"\0") if x]
        delta=[(parts[i].decode("ascii"),parts[i+1].decode("utf-8").replace("\\","/")) for i in range(0,len(parts),2)]
        require(delta==[("A",x) for x in OWNED_PATHS],"POST exact five drift")
        decision_time=dt.datetime.fromisoformat(EVENT_TIME.replace("Z","+00:00"))
        commit_dt=dt.datetime.fromisoformat(commit_time.replace("Z","+00:00"))
        require(decision_time<=commit_dt,"POST commit backdated before final policy materialization")
        return "POST", head, live
    raise GateError("neither exact PRE nor exact POST topology")


def load_contract():
    return strict_json_loads((ROOT/CONTRACT_REL).read_text(encoding="utf-8"),"contract")


def verify():
    contract=load_contract(); validate_contract(contract,check_artifacts=True,expected_static_policy_sha256=EXPECTED_STATIC_POLICY_SHA256); verify_committed_inputs(contract)
    phase,head,live=classify_phase()
    decision=FROZEN_STATIC_POLICY["decision"]
    return {"status":"PASS" if phase=="POST" else "SC005_DECISION_PRE_INTRODUCTION_DIAGNOSTIC","phase":phase,"head":head,"remoteHead":live,"nextDecisionId":decision["nextDecisionId"],"nextDecisionConstructionAuthorized":phase=="POST","startAuthorized":False,"sourceAccessAuthorized":False,"routeDiscoveryAuthorized":False,"censusDiscoveryAuthorized":False,"captureAuthorized":False,"codingAuthorized":False,"aggregationAuthorized":False,"aiRunAuthorized":False,"sourceRequests":0,"routeDiscoveryRequests":0,"censusRequests":0,"captureRequests":0,"aiRuns":0,"scientificCredit":"NONE","runtimeSchemaCount":0,"rolePhaseCount":10}


def self_test():
    contract=load_contract(); validate_contract(contract,check_artifacts=True,expected_static_policy_sha256=EXPECTED_STATIC_POLICY_SHA256); verify_committed_inputs(contract)
    mutations=[
        ("purpose",lambda c:c.__setitem__("purpose","SOURCE_WORK")),
        ("static extra",lambda c:c["staticPolicy"].__setitem__("startAuthorized",True)),
        ("decision start",lambda c:c["staticPolicy"]["decision"].__setitem__("startAuthorized",True)),
        ("decision source",lambda c:c["staticPolicy"]["decision"].__setitem__("sourceAccessAuthorized",True)),
        ("decision work",lambda c:c["staticPolicy"]["decision"].__setitem__("workStarted",True)),
        ("candidate",lambda c:c["staticPolicy"]["decision"].__setitem__("candidateState",{"id":"X"})),
        ("credit",lambda c:c["staticPolicy"]["decision"].__setitem__("scientificCredit","FULL")),
        ("outcome blind",lambda c:c["staticPolicy"]["decision"].__setitem__("outcomeBlindClaimed",True)),
        ("category use",lambda c:c["staticPolicy"]["decision"].__setitem__("operationalUseOfPreregisteredOutcomeCategories",True)),
        ("Original V4 2",lambda c:c["staticPolicy"]["decision"].__setitem__("originalV4GreenOfficialGates",3)),
        ("Original V4 13",lambda c:c["staticPolicy"]["decision"].__setitem__("originalV4OfficialGateCount",12)),
        ("Original V4 result",lambda c:c["staticPolicy"]["decision"].__setitem__("originalV4ResultComputationAllowed",True)),
        ("roster drop",lambda c:c["staticPolicy"]["framePolicy"]["roster"].pop()),
        ("roster category swap",lambda c:(c["staticPolicy"]["framePolicy"]["roster"][0].__setitem__("preregCategoryAuditOnly","failuresOrLongDelays"),c["staticPolicy"]["framePolicy"]["roster"][8].__setitem__("preregCategoryAuditOnly","successAndMixed"))),
        ("invent authority",lambda c:c["staticPolicy"]["framePolicy"].__setitem__("unresolvedThemeAuthorityStatus","FDA")),
        ("random selection",lambda c:c["staticPolicy"]["framePolicy"].__setitem__("selectionSeed","x")),
        ("K",lambda c:c["staticPolicy"]["framePolicy"].__setitem__("minimumEligibleCompleteThemesK",2)),
        ("eligible K rule",lambda c:c["staticPolicy"]["framePolicy"].__setitem__("eligibleCompleteThemeRule","COMPLETE_INCLUDING_N_ZERO")),
        ("operational K target",lambda c:c["staticPolicy"]["framePolicy"].__setitem__("operationalManifestStageTarget","AT_LEAST_TWO")),
        ("eligible K terminal HOLD rule",lambda c:c["staticPolicy"]["framePolicy"].__setitem__("terminalHoldRuleForInsufficientEligibleCompleteThemes","CALLER_CHOOSES")),
        ("eligible K terminal HOLD code",lambda c:c["staticPolicy"]["terminalHoldCodes"].__setitem__(12,"HOLD_FEWER_THAN_THREE_COMPLETE_OFFICIAL_FRAMES")),
        ("N zero counts K",lambda c:c["staticPolicy"]["framePolicy"].__setitem__("zeroRowCompleteFramesRemainVisibleAndContribute_ONE_SHARED_T_ONLY_BUT_NOT_K",False)),
        ("omit frame",lambda c:c["staticPolicy"]["framePolicy"].__setitem__("allCompleteFramesIncludedWithoutSelectionOrReplacement",False)),
        ("budget",lambda c:c["staticPolicy"]["framePolicy"].__setitem__("captureScheduledSlotCapFormula","2*U")),
        ("DMV N",lambda c:c["staticPolicy"]["tag914CarriedFrameBinding"].__setitem__("eligibleRowCountN",7)),
        ("DMV row order",lambda c:c["staticPolicy"]["tag914CarriedFrameBinding"]["sourceRows"].reverse()),
        ("DMV requests",lambda c:c["staticPolicy"]["tag914CarriedFrameBinding"].__setitem__("newSourceRequestCount",1)),
        ("future schema claim",lambda c:c["staticPolicy"]["futureGovernance"].__setitem__("runtimeSchemaCountInTag923",83)),
        ("route obligation drop",lambda c:c["staticPolicy"]["futureGovernance"]["tag924RouteOnlyObligationsExact"].pop()),
        ("census obligation drop",lambda c:c["staticPolicy"]["futureGovernance"]["censusDecisionAfterRouteTerminalObligationsExact"].pop()),
        ("capture obligation drop",lambda c:c["staticPolicy"]["futureGovernance"]["captureDecisionAfterCensusTerminalAndTermFreezeObligationsExact"].pop()),
        ("route overbind census",lambda c:c["staticPolicy"]["futureGovernance"]["tag924RouteOnlyObligationsExact"].append("CENSUS_CONTINUATION_SCHEMA")),
        ("decision start bytes",lambda c:c["staticPolicy"]["futureGovernance"].__setitem__("decisionToStartImmutableBytesRule","START_MAY_EDIT_DECISION")),
        ("role mayAuthorize",lambda c:c["staticPolicy"]["futureGovernance"]["rolePhases"][1].__setitem__("mayAuthorize",["CENSUS"])),
        ("role remote edge",lambda c:c["staticPolicy"]["futureGovernance"]["rolePhases"][0].__setitem__("mustBeRemoteBeforeNext",False)),
        ("capture terminal merged",lambda c:c["staticPolicy"]["futureGovernance"]["rolePhases"].pop()),
        ("phase reorder",lambda c:c["staticPolicy"]["futureGovernance"]["rolePhases"].reverse()),
        ("retro receipt",lambda c:c["staticPolicy"]["futureGovernance"]["tag923FirstLinkBootstrap"].__setitem__("prospectivePriorRemoteReceiptAvailable",True)),
        ("Q003 eligible",lambda c:c["staticPolicy"]["incumbentLocks"].__setitem__("q003State","ELIGIBLE")),
        ("AI run",lambda c:c["staticPolicy"]["incumbentLocks"].__setitem__("ai56Runs",1)),
        ("repo path",lambda c:c["staticPolicy"]["repository"].__setitem__("worktree",r"C:\tmp")),
        ("subject body",lambda c:c["staticPolicy"]["repository"].__setitem__("expectedCommitMessageUtf8",c["staticPolicy"]["repository"]["expectedCommitMessageUtf8"]+"body\n")),
        ("controller path",lambda c:c["implementation"].__setitem__("controllerPath",TEST_REL)),
        ("predecessor controller",lambda c:c["implementation"].__setitem__("controllerExecutesPredecessorControllers",True)),
        ("bootstrap source count",lambda c:c["implementation"].__setitem__("sourceRequestsDuringBootstrapVerifySelfTest",1)),
        ("hash policy lie",lambda c:c["hashPolicy"].__setitem__("canonicalJson","CALLER_CHOOSES")),
    ]
    killed=[]
    for label,mutate in mutations:
        candidate=copy.deepcopy(contract); mutate(candidate)
        candidate["frozenStaticPolicySha256"]=canonical_sha(candidate["staticPolicy"])
        candidate["contractCoreSha256"]=contract_core(candidate)
        candidate["contractSelfSha256"]=self_hash(candidate,"contractSelfSha256")
        try: validate_contract(candidate,expected_static_policy_sha256=candidate["frozenStaticPolicySha256"])
        except GateError: killed.append(label)
        else: raise GateError(f"coherent mutation survived: {label}")
    duplicate='{"schema":"x","schema":"y"}'
    try: strict_json_loads(duplicate,"duplicate fixture")
    except GateError: pass
    else: raise GateError("duplicate JSON fixture survived")
    config_raw=run_git_bytes(["config","--show-origin","--show-scope","--null","--list"])
    worktree_origin=("file:"+Path(FROZEN_STATIC_POLICY["repository"]["gitWorktreeConfigFile"]).as_posix()).encode("utf-8")
    for key_value in [b"http.sslverify\nfalse",b"url.https://evil.example/.insteadof\nhttps://github.com/"]:
        try: validate_effective_git_config(config_raw+b"worktree\0"+worktree_origin+b"\0"+key_value+b"\0")
        except GateError: pass
        else: raise GateError("unsafe worktree config fixture survived")
    require(len(killed)==len(mutations),"mutation kill count drift")
    return {"status":"PASS","runtimeSchemaCount":0,"rolePhaseCount":10,"semanticMutationRejections":len(killed),"gitConfigAttackRejections":2,"fullFiveCascadeMutationClaimed":False,"sourceRequests":0,"routeDiscoveryRequests":0,"censusRequests":0,"captureRequests":0,"aiRuns":0}


def main():
    parser=argparse.ArgumentParser(); parser.add_argument("command",choices=["verify","status","self-test","bootstrap","next","start","source","census","census-discovery","capture","run","packet","open","aggregate","coding","ai-run"]); args=parser.parse_args()
    try:
        if args.command in {"start","source","census","census-discovery","capture","run","packet","open","aggregate","coding","ai-run"}: raise GateError(f"{args.command} is fail-closed by Tag923 decision-only policy")
        if args.command=="self-test": result=self_test()
        elif args.command=="bootstrap":
            contract=load_contract(); validate_contract(contract,check_artifacts=True,expected_static_policy_sha256=EXPECTED_STATIC_POLICY_SHA256); verify_committed_inputs(contract); result={"status":"PASS","mode":"READ_ONLY_NO_SOURCE_NO_RUN","runtimeSchemaCount":0,"sourceRequests":0,"routeDiscoveryRequests":0,"censusRequests":0,"captureRequests":0,"aiRuns":0}
        else:
            result=verify()
            if args.command=="next": require(result["phase"]=="POST" and result["nextDecisionConstructionAuthorized"] is True,"next decision construction is not authorized before Tag923 remote POST")
        print(json.dumps(result,ensure_ascii=False,sort_keys=True))
    except GateError as exc:
        print(json.dumps({"status":"FAIL_CLOSED","error":str(exc),"sourceRequests":0,"routeDiscoveryRequests":0,"censusRequests":0,"captureRequests":0,"aiRuns":0},ensure_ascii=False,sort_keys=True))
        raise SystemExit(1)


if __name__=="__main__":
    main()
