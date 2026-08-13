#!/usr/bin/env python3
"""Verify the append-only V2 operational resume over remote outcome-blind evidence."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "continuous-free-source-operational-resume-contract-v2.json"
SCRIPT = ROOT / "scripts" / "verify-continuous-free-source-operational-resume-v2.py"
TEST = ROOT / "tests" / "verify-continuous-free-source-operational-resume-v2.test.js"
EXPECTED_RAW = "084bbfc27e10bbb444c369bb488ddf60d6ed4c1547a2a5c807f700862a70eb5d"
EXPECTED_SELF = "9a24cea57cbc5340e88836399fee297ad186de5fd00c058a3ea206626d8eaa1b"
EXPECTED_SCRIPT_NORMALIZED = "1afcdb9ab3f9dd0809108e55abbba80298722ff340aa1c383d3854b40b69fea9"
EXPECTED_TEST_NORMALIZED = "c31fa49c1a3139a0302ab9696bc856c4a2bbdbb67e2bb164015def46bf8e464a"
V1_RAW = "95edf2734e8d850bfb4bb77ae5c283865819409f243fbd30c1220f24ac9e09f7"
V1_SELF = "2eb939eb3dee6e5318bc0fe6344e84fba1cfbc565d4ea2a7f0e88bb0b255132e"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE = "origin"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BRANCH = "codex/early-detection-v4-gates-20260810"
BUILD_BASE = "f530362a17a693e744e31d9eb4cdb6b61564f41a"
BUILD_BASE_PARENT = "2a5ea8234c424c8b7398c54fde8e985d73039a37"
AUTHORIZED_PATHS = [
    "research/early-detection-v4/continuous-free-source-operational-resume-contract-v2.json",
    "scripts/verify-continuous-free-source-operational-resume-v2.py",
    "tests/verify-continuous-free-source-operational-resume-v2.test.js",
]
MILESTONE_KEYS = {
    "milestoneId", "sourceId", "taskId", "path", "rawSha256", "selfSha256",
    "introductionCommit", "operationalState", "nextActionClass",
    "verificationArtifacts", "dataFacts",
}
ARTIFACT_KEYS = {"role", "path", "bytes", "rawSha256", "selfField", "selfSha256", "bindingCommit"}

NEW_CORE = {
    "FINRA-FORM345-EXHAUSTION": {
        "sourceId": "FINRA_OTC_PRIMARY_PLUS_SEC_FORM345_PRIMARY",
        "taskId": "Q004-FINRA-FORM345-EVENT-CANDIDATE-PROFILE",
        "path": "reports/early-detection/finra-form345-event-candidate-profile-v1.json",
        "rawSha256": "c4466abbd54fb0dc017b36c697ed979dbd0d8a5c1a48c26691fae1fee94ceca8",
        "selfSha256": "cf9ee1d3f78ea4af90bd4af00c85f76cd9ca676cba4f6010fef488ba1e79e444",
        "introductionCommit": "bcf14905b8002249099357a0ec66f122de84808b",
        "operationalState": "EXHAUSTED_WITH_ZERO_RESOLUTION_CREDIT",
        "nextActionClass": "CONTINUE_OTHER_PRIMARY_RECONCILIATION_LANES",
    },
    "SEC-FORM345-V3-GZIP-FULL-REBUILD-SEAL": {
        "sourceId": "SEC_FORM345_PRIMARY",
        "taskId": "Q005-SEC-FORM345-V3-GZIP-HARNESS-SEAL-V2",
        "path": "reports/early-detection/sec-form345-issuer-symbol-point-v3-gzip-manifest.json",
        "rawSha256": "c353dc63865cd7a0f7ca4b35f5dceb99683424ad55c72f2e57b42f5830e1910b",
        "selfSha256": "afa872b29cda54493cca8d5a0b69272a42942f3b5aa4b91bc50ceec517cc59ce",
        "introductionCommit": "036ba9e53623f47fe8ab0f3b926c5033b629dc2c",
        "operationalState": "POINT_EVIDENCE_GZIP_AND_DUAL_FULL_REBUILD_SEALED",
        "nextActionClass": "USE_AS_CIK_BOUNDED_POINT_EVIDENCE_NOT_IDENTITY_INTERVALS",
    },
    "SEC-FIVE-FROZEN-TERMINAL-ROWS-V2": {
        "sourceId": "SEC_EDGAR_PRIMARY",
        "taskId": "Q003-SEC-FROZEN-TERMINAL-DISTRIBUTION-RECEIPT-EVIDENCE-V2",
        "path": "reports/early-detection/sec-frozen-terminal-distribution-receipt-evidence-v2.json",
        "rawSha256": "bfd0b4e4582e1267a311e5d79a63a19339e3a9967980f542148c9173c97d13dc",
        "selfSha256": "7967bd2ed2634568a785a5ec4e76d209db7ae10dc9ec9b1d72681144f5200104",
        "introductionCommit": "ee21b932abbb31c24c97fab093d8b98b62f7c3e9",
        "operationalState": "EXACT_FIVE_PRIMARY_SENTENCES_OUTPUT_AND_REBUILD_SEALED",
        "nextActionClass": "CONTINUE_PRIMARY_RECONCILIATION_WITHOUT_TERMINAL_WEALTH_CREDIT",
    },
}

NEW_ARTIFACTS = {
    "FINRA-FORM345-EXHAUSTION": [
        {
            "role": "TAG843_TWO_PHASE_HARNESS",
            "path": "tests/build-finra-form345-event-candidate-profile-v1.test.js",
            "bytes": 7647,
            "rawSha256": "d207c0c1f5b0c09dcbd17fc84b308a624ccfdf32a1e5a10b21b6612a974b09de",
            "selfField": None,
            "selfSha256": None,
            "bindingCommit": "9695c0f7fdc04d145c52afba8a242baed3fdb7b3",
        }
    ],
    "SEC-FORM345-V3-GZIP-FULL-REBUILD-SEAL": [
        {
            "role": "TAG845_GZIP_PAYLOAD",
            "path": "reports/early-detection/sec-form345-issuer-symbol-point-v3.json.gz",
            "bytes": 10805035,
            "rawSha256": "fe75233db21467dbec453cd8f20e5b25a8a4d4db16317d6b2fc78eaa7c97f484",
            "selfField": None,
            "selfSha256": None,
            "bindingCommit": "036ba9e53623f47fe8ab0f3b926c5033b629dc2c",
        },
        {
            "role": "TAG851_DUAL_FULL_REBUILD_SEAL",
            "path": "research/early-detection-v4/sec-form345-issuer-symbol-point-v3-gzip-harness-seal-contract-v2.json",
            "bytes": 9718,
            "rawSha256": "68a528b933698305caff19b23ab6c5e93f1d59315dc97b2b6e16a5c7e7e53e52",
            "selfField": "contractSha256",
            "selfSha256": "7d8f5b21b749be317b817dac1f0ab76218252e97e81aca1a94ae5817265934bd",
            "bindingCommit": "2a5ea8234c424c8b7398c54fde8e985d73039a37",
        },
    ],
    "SEC-FIVE-FROZEN-TERMINAL-ROWS-V2": [
        {
            "role": "TAG852_OUTPUT_SEAL",
            "path": "research/early-detection-v4/sec-frozen-terminal-distribution-receipt-evidence-output-seal-contract-v3.json",
            "bytes": 5265,
            "rawSha256": "bd70e619527de52a7569a858a6f0610e8689fc27a9845ac8b83b364990283843",
            "selfField": "contractSha256",
            "selfSha256": "451338df79abdb766e3950a26aee5e4421a960bea7b62671b57ddc5b41f0b3f2",
            "bindingCommit": "f530362a17a693e744e31d9eb4cdb6b61564f41a",
        }
    ],
}

NEW_FACTS = {
    "FINRA-FORM345-EXHAUSTION": {
        "candidateEvents": 8, "candidateCiks": 5, "oldOnlyCandidateEvents": 8,
        "newOnlyCandidateEvents": 0, "dualSideCandidateEvents": 0, "matchedGapRows": 0,
        "candidateEventGapPairs": 0, "resolvedRows": 0,
        "periodCompleteAbsenceClaimAllowed": False,
        "pre2016Status": "UNRESOLVED_NOT_EXPOSED_BY_PARTITIONS_ENDPOINT",
    },
    "SEC-FORM345-V3-GZIP-FULL-REBUILD-SEAL": {
        "rows": 656, "sourceAllRows": 3352003, "sourceTargetPoints": 164675,
        "issuerNameMissingAllRows": 1188, "issuerNameMissingTargetPoints": 23,
        "issuerNamePresentAllRows": 3350815, "issuerNamePresentTargetPoints": 164652,
        "decompressedBytes": 138658140,
        "decompressedRawSha256": "81e748f609cbf8e73de2f5ea91166ce178c71c1df4fa0398ab9821f30459e0f4",
        "decompressedReportSha256": "b27c9a9197088cbf29d0532a0d73c15a35e41c5300bacb12a7fb7f81076c7ef3",
        "sourceRebuildNormalReceiptBound": True, "sourceRebuildOptimizedReceiptBound": True,
        "sourceDerivedFullRebuild": True, "historicalIdentityIntervalsComplete": False,
    },
    "SEC-FIVE-FROZEN-TERMINAL-ROWS-V2": {
        "frozenEvidenceRows": 5, "uniqueAccessions": 5,
        "datedFinalDistributionStatementRows": 3,
        "actualFirstLiquidatingDistributionByChecksStatementRows": 1,
        "actualDefaultMixedConsiderationReceiptStatementRows": 1,
        "finalLiquidatingDistributionVerifiedRows": 0,
        "noFurtherDistributionsVerifiedRows": 0,
        "postClosingRecoveryVerifiedRows": 0, "terminalWealthCompleteRows": 0,
        "scopeLimit": "EXACT_FIVE_FROZEN_PRIMARY_SEC_SENTENCES_ONLY_NO_GENERAL_SELECTOR",
    },
}

EXPECTED_QUEUE = [
    {"rank": 1, "workId": "SEC-TERMINAL-PRIMARY-RECONCILIATION", "entryCriterion": "EXISTING_SEC_CANDIDATES_AND_FIVE_FROZEN_SENTENCES_BOUND", "workClass": "AUTONOMOUS_OUTCOME_BLIND"},
    {"rank": 2, "workId": "SEC-IDENTITY-CORPORATE-ACTION-PRIMARY-RECONCILIATION", "entryCriterion": "FORM345_POINT_EVIDENCE_AND_SEC_PRIMARY_DOCUMENTS_BOUND", "workClass": "AUTONOMOUS_OUTCOME_BLIND"},
    {"rank": 3, "workId": "OUTCOME-BLIND-HYPOTHESIS-REGISTER-PRE2021", "entryCriterion": "LITERATURE_THEORY_AND_SOURCE_FEATURES_ONLY_2021_2024_RESERVED", "workClass": "AUTONOMOUS_OUTCOME_BLIND"},
    {"rank": 4, "workId": "NASDAQ-SPARSE-COVERAGE-GAP-MATRIX", "entryCriterion": "NASDAQ_ARCHIVE_REMOTE_BOUND", "workClass": "AUTONOMOUS_OUTCOME_BLIND"},
    {"rank": 5, "workId": "QUANTCONNECT-FREE-CLOUD-RIGHTS", "entryCriterion": "WRITTEN_DATASET_INFORMATION_EXPORT_RIGHTS_REQUIRED", "workClass": "BLOCKED_BY_EXPORT_RIGHTS"},
    {"rank": 6, "workId": "TIINGO-FREE-ENTITLEMENT", "entryCriterion": "USER_CREATES_FREE_ACCOUNT_WITHOUT_CARD_OR_TRIAL", "workClass": "USER_ACTION_REQUIRED"},
    {"rank": 7, "workId": "BUSINESS-QUANT-FREE-HANDSHAKE", "entryCriterion": "USER_CREATES_FREE_ACCOUNT_WITHOUT_CARD_OR_TRIAL", "workClass": "USER_ACTION_REQUIRED"},
    {"rank": 8, "workId": "COURTLISTENER-RECAP-FREE-ACCOUNT", "entryCriterion": "USER_CREATES_FREE_ACCOUNT_WITHOUT_CARD_OR_PAID_PACER_PURCHASE", "workClass": "USER_ACTION_REQUIRED"},
]

EXPECTED_LOCKS = {
    "originalV4GreenOfficialGates": 2,
    "originalV4OfficialGateCount": 13,
    "originalV4Complete": False,
    "originalV4ResultComputationAllowed": False,
    "publicAiAppendOnly": True,
    "secCikStudyAppendOnly": True,
    "outcomesAccessed": False,
    "humanAttestation": False,
    "addonMilestonesGrantOriginalV4GateCredit": False,
    "fiveRequiredDataSemanticsComplete": False,
    "fullDataAiProtocolSealAllowed": False,
    "reserved2021To2024OpenedForHypothesisGeneration": False,
}


class ResumeError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ResumeError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def git(*args: str, binary: bool = False) -> bytes | str:
    run = subprocess.run(["git", *args], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if run.returncode:
        fail("git command failed")
    return run.stdout if binary else run.stdout.decode().strip()


def is_ancestor(older: str, newer: str) -> bool:
    return subprocess.run(
        ["git", "merge-base", "--is-ancestor", older, newer], cwd=ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
    ).returncode == 0


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def normalized_own(path: Path) -> str:
    raw = path.read_bytes()
    for token in (EXPECTED_SCRIPT_NORMALIZED, EXPECTED_TEST_NORMALIZED):
        raw = raw.replace(token.encode(), b"0" * 64)
    return sha(raw)


def artifact_self(decoded: Any) -> tuple[str, str] | None:
    if not isinstance(decoded, dict):
        return None
    for key in ("reportSha256", "contractSha256", "manifestSha256", "resumeSha256", "payloadSha256"):
        if key in decoded:
            return key, str(decoded[key])
    return None


def verify_file_binding(path_text: str, raw_sha: str, self_sha: str | None, commit: str, *, check_bytes: bool) -> None:
    path = ROOT / path_text
    raw = path.read_bytes()
    if check_bytes and sha(raw) != raw_sha:
        fail("artifact local bytes changed")
    if check_bytes and git("show", f"{commit}:{path_text}", binary=True) != raw:
        fail("artifact binding commit bytes changed")
    if not is_ancestor(commit, "HEAD"):
        fail("artifact binding commit not ancestor")
    if self_sha is not None:
        decoded = json.loads(raw)
        present = artifact_self(decoded)
        if present is None or present[1] != self_sha:
            fail("artifact self binding changed")
        body = dict(decoded)
        body.pop(present[0])
        if sha(canonical(body)) != self_sha:
            fail("artifact canonical self hash changed")


def validate(value: dict[str, Any], *, check_bytes: bool = True) -> None:
    exact_keys(value, {"schema", "createdAt", "track", "purpose", "sourceBase", "previousResume", "milestones", "nextQueue", "scientificLocks", "resumeSha256"}, "resume")
    if value["schema"] != "early-detection-continuous-free-source-operational-resume-contract/v2" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("resume boundary changed")
    body = dict(value)
    claim = body.pop("resumeSha256", None)
    if claim != EXPECTED_SELF or sha(canonical(body)) != EXPECTED_SELF:
        fail("resume self hash changed")

    base = value["sourceBase"]
    exact_keys(base, {"remote", "ref", "buildBase", "buildBaseTag", "buildBaseParent", "exactRemoteAtContractBuild", "futureIntroductionDirectSingleParentChildRequired", "futureIntroductionAddsExactlyAuthorizedPaths", "authorizedPaths"}, "source base")
    if base != {
        "remote": REMOTE_URL, "ref": REF, "buildBase": BUILD_BASE, "buildBaseTag": 852,
        "buildBaseParent": BUILD_BASE_PARENT, "exactRemoteAtContractBuild": True,
        "futureIntroductionDirectSingleParentChildRequired": True,
        "futureIntroductionAddsExactlyAuthorizedPaths": True,
        "authorizedPaths": AUTHORIZED_PATHS,
    }:
        fail("source base changed")

    previous = value["previousResume"]
    exact_keys(previous, {"path", "bytes", "rawSha256", "selfField", "selfSha256", "introductionCommit", "appendOnly", "allSixMilestonesInherited"}, "previous resume")
    if previous != {
        "path": "research/early-detection-v4/continuous-free-source-operational-resume-contract-v1.json",
        "bytes": 5983, "rawSha256": V1_RAW, "selfField": "resumeSha256", "selfSha256": V1_SELF,
        "introductionCommit": "6436810ef3f876ccf02502e11af521f833e618c6",
        "appendOnly": True, "allSixMilestonesInherited": True,
    }:
        fail("previous resume binding changed")
    verify_file_binding(previous["path"], V1_RAW, V1_SELF, previous["introductionCommit"], check_bytes=check_bytes)
    v1 = json.loads((ROOT / previous["path"]).read_bytes())

    milestones = value["milestones"]
    expected_order = [row["milestoneId"] for row in v1["milestones"]] + list(NEW_CORE)
    if not isinstance(milestones, list) or [row.get("milestoneId") for row in milestones] != expected_order or len(set(expected_order)) != 9:
        fail("milestone order or set changed")
    for row in milestones:
        exact_keys(row, MILESTONE_KEYS, "milestone")
    legacy_projection = [
        {key: row[key] for key in ("milestoneId", "sourceId", "taskId", "path", "rawSha256", "selfSha256", "introductionCommit", "operationalState", "nextActionClass")}
        for row in milestones[:6]
    ]
    if legacy_projection != v1["milestones"] or any(row["verificationArtifacts"] or row["dataFacts"] for row in milestones[:6]):
        fail("V1 milestone inheritance changed")

    for row in milestones[:6]:
        verify_file_binding(row["path"], row["rawSha256"], row["selfSha256"], row["introductionCommit"], check_bytes=check_bytes)
    for row in milestones[6:]:
        milestone_id = row["milestoneId"]
        core = {key: row[key] for key in NEW_CORE[milestone_id]}
        if core != NEW_CORE[milestone_id] or row["verificationArtifacts"] != NEW_ARTIFACTS[milestone_id] or row["dataFacts"] != NEW_FACTS[milestone_id]:
            fail("new milestone contract changed")
        verify_file_binding(row["path"], row["rawSha256"], row["selfSha256"], row["introductionCommit"], check_bytes=check_bytes)
        for artifact in row["verificationArtifacts"]:
            exact_keys(artifact, ARTIFACT_KEYS, "verification artifact")
            if check_bytes and (ROOT / artifact["path"]).stat().st_size != artifact["bytes"]:
                fail("verification artifact bytes changed")
            verify_file_binding(artifact["path"], artifact["rawSha256"], artifact["selfSha256"], artifact["bindingCommit"], check_bytes=check_bytes)

    queue = value["nextQueue"]
    if queue != EXPECTED_QUEUE:
        fail("next queue order or contract changed")
    for row in queue:
        exact_keys(row, {"rank", "workId", "entryCriterion", "workClass"}, "queue row")
    if value["scientificLocks"] != EXPECTED_LOCKS:
        fail("scientific lock changed")


def load() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_RAW:
        fail("resume raw bytes changed")
    if normalized_own(SCRIPT) != EXPECTED_SCRIPT_NORMALIZED:
        fail("verifier normalized bytes changed")
    if TEST.exists() and normalized_own(TEST) != EXPECTED_TEST_NORMALIZED:
        fail("test normalized bytes changed")
    value = json.loads(raw)
    validate(value)
    return value


def introduction_phase(head: str) -> str:
    if not is_ancestor(BUILD_BASE, head):
        fail("build base is not ancestor")
    if head == BUILD_BASE:
        tracked = set(str(git("ls-tree", "-r", "--name-only", head)).splitlines())
        if any(path in tracked for path in AUTHORIZED_PATHS):
            fail("owned path unexpectedly tracked before introduction")
        return "PRE_INTRODUCTION"
    chain = str(git("rev-list", "--reverse", "--ancestry-path", f"{BUILD_BASE}..{head}")).splitlines()
    if not chain:
        fail("introduction chain missing")
    introduction = chain[0]
    parents = str(git("show", "-s", "--format=%P", introduction)).split()
    if parents != [BUILD_BASE]:
        fail("introduction is not direct single-parent child")
    changed = str(git("diff-tree", "--root", "--no-commit-id", "--name-only", "-r", introduction)).splitlines()
    if sorted(changed) != sorted(AUTHORIZED_PATHS):
        fail("introduction path set changed")
    for path in AUTHORIZED_PATHS:
        if git("show", f"{introduction}:{path}", binary=True) != (ROOT / path).read_bytes():
            fail("owned artifact changed after introduction")
    return "POST_INTRODUCTION"


def remote_check() -> str:
    if str(git("remote", "get-url", REMOTE)) != REMOTE_URL:
        fail("remote URL changed")
    head = str(git("rev-parse", "HEAD"))
    upstream = str(git("rev-parse", "@{upstream}"))
    refs = str(git("ls-remote", REMOTE, REF)).split()
    remote_head = refs[0] if refs else ""
    if head != upstream or head != remote_head:
        fail("remote snapshot changed")
    if str(git("show", "-s", "--format=%P", BUILD_BASE)) != BUILD_BASE_PARENT:
        fail("build base topology changed")
    phase = introduction_phase(head)
    for row in load()["milestones"]:
        if not is_ancestor(row["introductionCommit"], remote_head):
            fail("milestone not in live remote ancestry")
        for artifact in row["verificationArtifacts"]:
            if not is_ancestor(artifact["bindingCommit"], remote_head):
                fail("verification artifact not in live remote ancestry")
    return phase


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (ResumeError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def reseal(item: dict[str, Any]) -> None:
    item["resumeSha256"] = sha(canonical({key: val for key, val in item.items() if key != "resumeSha256"}))


def self_test() -> dict[str, Any]:
    source = load()
    mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "milestoneRemoval": lambda x: x["milestones"].pop(),
        "milestoneHashDrift": lambda x: x["milestones"][6].__setitem__("rawSha256", "0" * 64),
        "outcomeAccess": lambda x: x["scientificLocks"].__setitem__("outcomesAccessed", True),
        "originalV4GateCredit": lambda x: x["scientificLocks"].__setitem__("addonMilestonesGrantOriginalV4GateCredit", True),
        "queueOrder": lambda x: x["nextQueue"].reverse(),
        "remoteBinding": lambda x: x["sourceBase"].__setitem__("ref", "refs/heads/main"),
        "quantConnectReactivation": lambda x: x["nextQueue"][4].__setitem__("workClass", "AUTONOMOUS_OUTCOME_BLIND"),
        "falseCapabilityCompletion": lambda x: x["scientificLocks"].__setitem__("fiveRequiredDataSemanticsComplete", True),
        "userActionBypass": lambda x: x["nextQueue"][5].__setitem__("workClass", "AUTONOMOUS_OUTCOME_BLIND"),
        "v1MilestoneDrift": lambda x: x["milestones"][0].__setitem__("operationalState", "READY"),
        "form345IntervalOverclaim": lambda x: x["milestones"][7]["dataFacts"].__setitem__("historicalIdentityIntervalsComplete", True),
        "terminalWealthOverclaim": lambda x: x["milestones"][8]["dataFacts"].__setitem__("terminalWealthCompleteRows", 5),
    }
    kills: dict[str, bool] = {}
    for name, mutate in mutations.items():
        item = copy.deepcopy(source)
        mutate(item)
        reseal(item)
        kills[name] = rejected(lambda item=item: validate(item, check_bytes=False))
    if set(kills.values()) != {True}:
        fail("adversarial self-test did not fail closed")
    return {
        "schema": "early-detection-continuous-free-source-operational-resume-self-test/v2",
        "status": "PASS", "kills": kills, "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        value = load()
        phase = remote_check() if args.remote else introduction_phase(str(git("rev-parse", "HEAD")))
        if args.command == "self-test":
            result = self_test()
            result["phase"] = phase
        else:
            result = {
                "schema": "early-detection-continuous-free-source-operational-resume-verification/v2",
                "status": "PASS", "phase": phase, "milestones": len(value["milestones"]),
                "inheritedV1Milestones": 6, "newMilestones": 3,
                "autonomousNextActions": sum(row["workClass"] == "AUTONOMOUS_OUTCOME_BLIND" for row in value["nextQueue"]),
                "blockedByRights": 1, "userActionRequired": 3,
                "originalV4GreenOfficialGates": 2, "originalV4OfficialGateCount": 13,
                "outcomesAccessed": False,
            }
    except (ResumeError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
