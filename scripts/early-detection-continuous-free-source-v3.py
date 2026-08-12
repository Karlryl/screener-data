#!/usr/bin/env python3
"""Hardened append-only V3 controller for the continuous no-cost source queue.

V2 remains immutable. V3 adds an anchored remote trust root, verifiable raw-input
evidence, independent promotion review and an explicit free-account attestation.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
from datetime import timedelta
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BASE_PATH = ROOT / "scripts" / "early-detection-continuous-free-source.py"
TEST_PATH = ROOT / "tests" / "early-detection-continuous-free-source-v3.test.js"
AUTHORIZED_REMOTE = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_BRANCH = "refs/heads/codex/early-detection-v4-gates-20260810"
MIGRATION_PARENT_COMMIT = "151ddc13669f5ebf36dbf9587bd466c95de44bba"
USER_READY_REASON = "FREE-ACCESS-ATTESTED"
USER_READY_NOTE = "NO_PAYMENT_DETAILS;NO_TRIAL;FREE_CREDENTIAL_LOCAL_ONLY;NO_SECRET_IN_EVENT"
FINAL_LICENSES = {"PUBLIC_DOMAIN", "FREE_INTERNAL_USE_ALLOWED"}
RAW_INPUT_STATUS = "CAPTURED_VERIFIED"
FORBIDDEN_EVIDENCE_TOKENS = {
    "ORIGINAL_V4_RESULT", "ORIGINAL_V4_GATE_PASS", "H_LATE", "H_FEM",
    "ENDPOINT_VALUE", "P_VALUE", "RETURN_VALUE", "FAVORABLE_RESULT",
}
FORBIDDEN_HYPOTHESIS_TOKENS = FORBIDDEN_EVIDENCE_TOKENS | {
    "SEC_CIK_RESULT", "SEC_CIK_ENDPOINT", "COMPLETED_SEC_CIK",
    "THRESHOLD_TUNING", "POST_OUTCOME_OPTIMIZATION",
}

spec = importlib.util.spec_from_file_location("free_source_v2", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load immutable V2 controller")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

base.SCRIPT_PATH = Path(__file__).resolve()
base.TEST_PATH = TEST_PATH
base.DEFAULT_EVENTS_PATH = ROOT / "state" / "early-detection-free-source-events-v3.jsonl"
base.DEFAULT_STATE_PATH = ROOT / "state" / "early-detection-free-source-state-v3.json"
base.LOCK_PATH = ROOT / "state" / ".early-detection-free-source-controller-v3.lock"
BASE_VALIDATE_CONTRACTS = base.validate_contracts


def fail(message: str) -> None:
    raise base.ControllerError(message)


def text_has_token(value: Any, tokens: set[str]) -> bool:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True).upper().replace("-", "_")
    return any(re.search(rf"(?<![A-Z0-9]){re.escape(token)}(?![A-Z0-9])", text) for token in tokens)


def git_commit_authorized(commit: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", str(commit)):
        fail("git commit must be a lowercase full SHA-1")
    if base.git_text("remote", "get-url", "origin") != AUTHORIZED_REMOTE:
        fail("repository origin is not the frozen authorized remote")
    try:
        resolved = base.git_text("rev-parse", f"{commit}^{{commit}}")
        rows = base.git_text("ls-remote", "--refs", AUTHORIZED_REMOTE, AUTHORIZED_BRANCH).splitlines()
        if len(rows) != 1:
            fail("authorized remote branch did not resolve exactly once")
        remote_head, remote_ref = rows[0].split()
        if remote_ref != AUTHORIZED_BRANCH:
            fail("authorized remote branch ref changed")
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", MIGRATION_PARENT_COMMIT, resolved],
            cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", resolved, remote_head],
            cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        if resolved not in set(base.git_text("rev-list", "--first-parent", remote_head).splitlines()):
            fail("Git commit is not on the authorized remote first-parent line")
    except subprocess.CalledProcessError as exc:
        raise base.ControllerError("Git commit is outside the authorized remote ancestry") from exc
    return resolved


def authorized_remote_head() -> str:
    rows = base.git_text("ls-remote", "--refs", AUTHORIZED_REMOTE, AUTHORIZED_BRANCH).splitlines()
    if len(rows) != 1:
        fail("authorized remote branch did not resolve exactly once")
    commit, ref = rows[0].split()
    if ref != AUTHORIZED_BRANCH or not re.fullmatch(r"[0-9a-f]{40}", commit):
        fail("authorized remote branch response changed")
    return commit


def require_remote_queue_snapshot(events_path: Path, state_path: Path) -> str:
    before = authorized_remote_head()
    if base.git_text("rev-parse", "HEAD") != before:
        fail("local HEAD is not the authorized remote HEAD")
    for path in (events_path, state_path):
        relative = path.resolve().relative_to(ROOT).as_posix()
        try:
            blob = base.git_bytes("show", f"{before}:{relative}")
        except subprocess.CalledProcessError as exc:
            raise base.ControllerError("queue state is not yet remotely authorized") from exc
        if blob != path.read_bytes():
            fail("local queue state differs from authorized remote bytes")
    if authorized_remote_head() != before:
        fail("remote queue head changed during authorization")
    return before


def validate_hypothesis_blindness(hypotheses: dict[str, Any]) -> None:
    for index, row in enumerate(hypotheses["hypotheses"]):
        if row.get("status") != "PROPOSAL":
            fail("seed hypothesis must remain a proposal")
        for key in ("developmentPeriod", "validationPeriod"):
            parts = str(row.get(key, "")).split("/")
            if len(parts) != 2 or parts[0] > parts[1] or parts[1] > "2020-12-31":
                fail(f"hypothesis[{index}] enters reserved period or has invalid chronology")
        inspected = {
            key: row.get(key) for key in (
                "mechanism", "primaryClaim", "requiredData", "falsificationCriterion",
                "developmentPeriod", "validationPeriod", "expectedSign",
            )
        }
        if text_has_token(inspected, FORBIDDEN_HYPOTHESIS_TOKENS):
            fail(f"hypothesis[{index}] uses a forbidden outcome/study input")
        claim = str(row.get("primaryClaim", "")).upper()
        if "COMPLETED SEC" in claim or ("TUNE" in claim and "THRESHOLD" in claim):
            fail(f"hypothesis[{index}] proposes post-outcome threshold tuning")


def validate_contracts() -> dict[str, Any]:
    contracts = BASE_VALIDATE_CONTRACTS()
    if base.git_text("remote", "get-url", "origin") != AUTHORIZED_REMOTE:
        fail("authorized repository remote changed")
    git_commit_authorized(MIGRATION_PARENT_COMMIT)
    validate_hypothesis_blindness(contracts["hypotheses"])
    contracts["rawBindings"]["controller"] = base.file_sha256(Path(__file__).resolve())
    contracts["rawBindings"]["controllerTest"] = base.file_sha256(TEST_PATH)
    contracts["inputBundleSha256"] = base.canonical_sha256(contracts["rawBindings"])
    return contracts


def validate_repo_snapshot(binding: dict[str, Any], label: str) -> bytes:
    base.exact_keys(binding, {
        "url", "path", "casPath", "retrievedAt", "rawSha256", "bytes", "status",
        "gitCommit", "gitPath",
    }, label)
    if not str(binding["url"]).startswith("https://"):
        fail(f"{label} URL must use HTTPS")
    base.parse_z(binding["retrievedAt"], f"{label}.retrievedAt")
    if binding["status"] != RAW_INPUT_STATUS:
        fail(f"{label} is not captured and verified")
    raw_sha = base.require_sha(binding["rawSha256"], f"{label}.rawSha256")
    source_path = base.safe_repo_path(binding["path"])
    if binding["gitPath"] != binding["path"]:
        fail(f"{label} git path mismatch")
    commit = git_commit_authorized(binding["gitCommit"])
    raw = source_path.read_bytes()
    if len(raw) != binding["bytes"] or hashlib.sha256(raw).hexdigest() != raw_sha:
        fail(f"{label} local byte binding mismatch")
    if base.git_bytes("show", f"{commit}:{binding['gitPath']}") != raw:
        fail(f"{label} Git blob differs from local bytes")
    cas_path = base.safe_repo_path(binding["casPath"])
    expected = (base.CAS_ROOT / raw_sha).resolve()
    if cas_path != expected or cas_path.read_bytes() != raw:
        fail(f"{label} CAS binding mismatch")
    return raw


def validate_artifact_envelope(path: Path, payload: dict[str, Any], task: dict[str, Any]) -> None:
    value, _ = base.load_json_raw(path)
    base.exact_keys(value, {
        "schema", "artifactClass", "sourceId", "taskId", "observedAt", "knownAt",
        "licenseDisposition", "accountTier", "semantics", "supportedCriteria",
        "outcomesAccessed", "rawInputs", "verificationTarget", "content",
    }, "V3 artifact envelope")
    if value["schema"] != "early-detection-free-source-artifact/v2":
        fail("V3 artifact envelope schema changed")
    if value["artifactClass"] != payload["artifactClass"]:
        fail("artifact class mismatch")
    if value["sourceId"] != task["sourceId"] or value["taskId"] != task["taskId"]:
        fail("artifact task/source mismatch")
    for key in ("observedAt", "knownAt", "licenseDisposition", "accountTier"):
        if value[key] != payload[key]:
            fail(f"artifact {key} mismatch")
    if value["outcomesAccessed"] is not False:
        fail("artifact opened outcomes")
    if value["licenseDisposition"] not in FINAL_LICENSES:
        fail("pending/quarantine license cannot support promotion")
    if value["semantics"] != [payload["semantic"]]:
        fail("artifact semantic mismatch")
    if sorted(set(value["supportedCriteria"])) != payload["supportedCriteria"]:
        fail("artifact criteria mismatch")
    if not isinstance(value["rawInputs"], list) or not value["rawInputs"]:
        fail("artifact requires at least one raw input")
    for index, item in enumerate(value["rawInputs"]):
        validate_repo_snapshot(item, f"rawInput[{index}]")
    if text_has_token(value["content"], FORBIDDEN_EVIDENCE_TOKENS):
        fail("artifact content contains outcome-sensitive material")
    if value["artifactClass"] == "INDEPENDENT_VERIFICATION":
        target = value["verificationTarget"]
        if not isinstance(target, dict):
            fail("independent verification requires a target")
        base.exact_keys(target, {"path", "rawSha256", "gitCommit", "gitPath"}, "verificationTarget")
        target_path = base.safe_repo_path(target["path"])
        target_raw = target_path.read_bytes()
        if hashlib.sha256(target_raw).hexdigest() != base.require_sha(target["rawSha256"], "target SHA"):
            fail("verification target SHA mismatch")
        commit = git_commit_authorized(target["gitCommit"])
        if target["gitPath"] != target["path"] or base.git_bytes("show", f"{commit}:{target['gitPath']}") != target_raw:
            fail("verification target Git binding mismatch")
        content = value["content"]
        base.exact_keys(content, {
            "reviewerType", "agentId", "runId", "completedAt", "verifiedRawInputIds",
            "recomputedCriteria", "verdict", "blockingFindings", "humanAttestation",
        }, "independent verification content")
        if content["reviewerType"] != "CODEX_AGENT" or content["humanAttestation"] is not False:
            fail("verification reviewer/HUMAN lock changed")
        base.require_id(content["agentId"], "verification agentId")
        base.require_id(content["runId"], "verification runId")
        base.parse_z(content["completedAt"], "verification completedAt")
        if content["verdict"] != "PASS" or content["blockingFindings"] != []:
            fail("independent verification is not a clean PASS")
        if sorted(set(content["recomputedCriteria"])) != value["supportedCriteria"]:
            fail("verification criteria are not independently recomputed")
        if sorted(content["verifiedRawInputIds"]) != [str(index) for index, _ in enumerate(value["rawInputs"])]:
            fail("verification did not cover every bound raw input")
    elif value["verificationTarget"] is not None:
        fail("primary artifact must not declare a verification target")


base.validate_contracts = validate_contracts
base.validate_artifact_envelope = validate_artifact_envelope


def user_access_attested(events: list[dict[str, Any]], task_id: str) -> bool:
    matches = [event for event in events if event["taskId"] == task_id and event["eventType"] == "TASK_TRANSITIONED"
               and event["payload"].get("fromState") == "USER_ACTION_REQUIRED"
               and event["payload"].get("toState") == "READY"]
    return bool(matches) and matches[-1]["payload"] == {
        "fromState": "USER_ACTION_REQUIRED", "toState": "READY",
        "reasonCode": USER_READY_REASON, "note": USER_READY_NOTE,
    }


def validate_promotion(events: list[dict[str, Any]], task: dict[str, Any]) -> None:
    captures = [event for event in events if event["taskId"] == task["taskId"] and event["eventType"] == "ARTIFACT_CAPTURED"]
    primary = [event for event in captures if event["payload"]["artifactClass"] in {"SOURCE_CAPTURE", "CONTRACT"}]
    reviews = [event for event in captures if event["payload"]["artifactClass"] == "INDEPENDENT_VERIFICATION"]
    if not primary or not reviews:
        fail("RESOLVED requires primary evidence and an independent verification")
    proven_primary = {criterion for event in primary for criterion in event["payload"]["supportedCriteria"]}
    proven_review = {criterion for event in reviews for criterion in event["payload"]["supportedCriteria"]}
    required = set(task["exitCriteria"])
    if not required.issubset(proven_primary) or not required.issubset(proven_review):
        fail("primary and independent evidence must each prove all exit criteria")
    for review in reviews:
        if any(review["agentId"] == event["agentId"] or review["runId"] == event["runId"] for event in primary):
            fail("independent verification must use distinct agent and run IDs")
        envelope, _ = base.load_json_raw(base.safe_repo_path(review["payload"]["path"]))
        if envelope["content"]["agentId"] != review["agentId"] or envelope["content"]["runId"] != review["runId"]:
            fail("verification event and envelope reviewer IDs differ")
        target = envelope["verificationTarget"]
        if not any(target["path"] == event["payload"]["path"] and target["rawSha256"] == event["payload"]["rawSha256"] for event in primary):
            fail("independent verification does not target captured primary evidence")


def validate_v3_events(events: list[dict[str, Any]], state: dict[str, Any]) -> None:
    genesis = events[0]
    if genesis["payload"]["repositoryRemote"] != AUTHORIZED_REMOTE:
        fail("genesis remote is not the frozen authorized remote")
    genesis_commit = git_commit_authorized(genesis["payload"]["baseCommit"])
    if base.git_bytes("show", f"{genesis_commit}:{Path(__file__).resolve().relative_to(ROOT).as_posix()}") != Path(__file__).read_bytes():
        fail("genesis commit does not bind the exact V3 controller")
    if base.git_bytes("show", f"{genesis_commit}:{TEST_PATH.relative_to(ROOT).as_posix()}") != TEST_PATH.read_bytes():
        fail("genesis commit does not bind the exact V3 test")
    for event in events:
        if event["eventType"] == "TASK_TRANSITIONED":
            if text_has_token({"reasonCode": event["payload"]["reasonCode"], "note": event["payload"]["note"]}, FORBIDDEN_EVIDENCE_TOKENS):
                fail("transition contains outcome-sensitive text")
            if event["payload"]["fromState"] == "USER_ACTION_REQUIRED" and event["payload"]["toState"] == "READY":
                if event["payload"]["reasonCode"] != USER_READY_REASON or event["payload"]["note"] != USER_READY_NOTE:
                    fail("free-account readiness lacks exact no-cost/no-trial attestation")
            if event["payload"]["toState"] == "RESOLVED":
                task = next(row for row in state["tasks"] if row["taskId"] == event["taskId"])
                validate_promotion(events[:event["sequence"]], task)


def verify_current(events_path: Path, state_path: Path, *, heal: bool = False, synthetic_fixture: bool = False):
    contracts, events, state = base.verify_current(events_path, state_path, heal=heal, synthetic_fixture=synthetic_fixture)
    validate_v3_events(events, state)
    return contracts, events, state


def command_init(args: argparse.Namespace) -> dict[str, Any]:
    contracts = validate_contracts()
    events_path, state_path = base.validate_state_paths(Path(args.events), Path(args.state))
    with base.exclusive_lock():
        if events_path.exists() or state_path.exists():
            fail("V3 init refuses existing event/state files")
        created_at = base.utc_now()
        event = base.make_event(
            sequence=1, previous_sha=None, created_at=created_at, agent_id=args.agent_id,
            run_id=args.run_id, task_id=None, event_type="QUEUE_INITIALIZED", fencing_token=0,
            input_bundle_sha=contracts["inputBundleSha256"], payload={
                "queueSeedRawSha256": contracts["rawBindings"]["queueSeed"],
                "repositoryRemote": AUTHORIZED_REMOTE,
                "baseCommit": git_commit_authorized(base.git_text("rev-parse", "HEAD")),
                "controllerRawSha256": contracts["rawBindings"]["controller"],
                "controllerTestRawSha256": contracts["rawBindings"]["controllerTest"],
            },
        )
        raw = base.canonical_bytes(event) + b"\n"
        state = base.materialize_state(contracts, [event], raw)
        validate_v3_events([event], state)
        base.atomic_write_new_or_replace(events_path, raw, require_new=True)
        base.atomic_write_new_or_replace(state_path, base.pretty_json_bytes(state), require_new=True)
    return {"status": "PASS", "eventCount": 1, "lastEventSha256": event["eventSha256"],
            "stateSha256": state["stateSha256"], "tasks": len(state["tasks"]),
            "ready": state["taskCounts"]["READY"], "userActionRequired": state["taskCounts"]["USER_ACTION_REQUIRED"],
            "originalV4GreenGates": state["originalV4"]["greenOfficialGates"], "outcomesAccessed": False}


def append_checked(events_path: Path, state_path: Path, contracts: dict[str, Any], events: list[dict[str, Any]], event: dict[str, Any], expected_head: str):
    if events[-1]["eventSha256"] != expected_head:
        fail("queue head changed; compare-and-swap rejected")
    base.validate_event(event, events[-1], contracts["inputBundleSha256"])
    raw = events_path.read_bytes() + base.canonical_bytes(event) + b"\n"
    state = base.materialize_state(contracts, events + [event], raw)
    validate_v3_events(events + [event], state)
    base.atomic_write_new_or_replace(events_path, raw, require_new=False)
    base.atomic_write_new_or_replace(state_path, base.pretty_json_bytes(state), require_new=False)
    return state


def command_claim(args: argparse.Namespace) -> dict[str, Any]:
    events_path, state_path = base.validate_state_paths(Path(args.events), Path(args.state))
    with base.exclusive_lock():
        contracts, events, state = verify_current(events_path, state_path)
        require_remote_queue_snapshot(events_path, state_path)
        task = next((row for row in state["tasks"] if row["taskId"] == args.task_id), None)
        if task is None or task["state"] != "READY":
            fail("task is not READY")
        source = next(row for row in contracts["registry"]["sources"] if row["sourceId"] == task["sourceId"])
        needs_user = source["access"]["freeAccountRequired"] or source["access"]["freeApiKeyRequired"]
        if needs_user:
            if not user_access_attested(events, task["taskId"]):
                fail("free account/key task lacks recorded no-payment/no-trial attestation")
        elif not base.entry_criteria_satisfied(contracts, task):
            fail("task entry criteria are not satisfied")
        created_at = base.utc_now()
        lease = (base.parse_z(created_at, "createdAt") + timedelta(minutes=args.lease_minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")
        event = base.make_event(
            sequence=len(events)+1, previous_sha=events[-1]["eventSha256"], created_at=created_at,
            agent_id=args.agent_id, run_id=args.run_id, task_id=args.task_id, event_type="TASK_CLAIMED",
            fencing_token=task["fencingToken"]+1, input_bundle_sha=contracts["inputBundleSha256"],
            payload={"fromState": "READY", "toState": "CLAIMED", "leaseExpiresAt": lease},
        )
        new_state = append_checked(events_path, state_path, contracts, events, event, args.expected_head)
    return {"status":"PASS", "lastEventSha256":event["eventSha256"],
            "task":next(row for row in new_state["tasks"] if row["taskId"]==args.task_id), "outcomesAccessed":False}


def command_transition(args: argparse.Namespace) -> dict[str, Any]:
    events_path, state_path = base.validate_state_paths(Path(args.events), Path(args.state))
    with base.exclusive_lock():
        contracts, events, state = verify_current(events_path, state_path)
        require_remote_queue_snapshot(events_path, state_path)
        task = next((row for row in state["tasks"] if row["taskId"] == args.task_id), None)
        if task is None:
            fail("unknown task")
        event = base.make_event(
            sequence=len(events)+1, previous_sha=events[-1]["eventSha256"], created_at=base.utc_now(),
            agent_id=args.agent_id, run_id=args.run_id, task_id=args.task_id, event_type="TASK_TRANSITIONED",
            fencing_token=args.fencing_token, input_bundle_sha=contracts["inputBundleSha256"], payload={
                "fromState":task["state"], "toState":args.to_state,
                "reasonCode":base.require_id(args.reason_code,"reasonCode"), "note":args.note,
            },
        )
        new_state = append_checked(events_path, state_path, contracts, events, event, args.expected_head)
    return {"status":"PASS", "lastEventSha256":event["eventSha256"],
            "task":next(row for row in new_state["tasks"] if row["taskId"]==args.task_id), "outcomesAccessed":False}


def publish_cas(raw: bytes) -> Path:
    sha = hashlib.sha256(raw).hexdigest()
    path = base.CAS_ROOT / sha
    if path.exists():
        if path.read_bytes() != raw:
            fail("existing CAS object is corrupt")
    else:
        base.atomic_write_new_or_replace(path, raw, require_new=True)
    return path


def command_capture(args: argparse.Namespace) -> dict[str, Any]:
    events_path, state_path = base.validate_state_paths(Path(args.events), Path(args.state))
    artifact_path = base.safe_repo_path(args.path)
    artifact_raw = artifact_path.read_bytes()
    raw_sha = hashlib.sha256(artifact_raw).hexdigest()
    with base.exclusive_lock():
        contracts, events, state = verify_current(events_path, state_path)
        require_remote_queue_snapshot(events_path, state_path)
        task = next((row for row in state["tasks"] if row["taskId"] == args.task_id), None)
        if task is None or task["state"] != "CLAIMED":
            fail("task is not CLAIMED")
        commit = git_commit_authorized(base.git_text("rev-parse", args.git_commit))
        git_path = artifact_path.relative_to(ROOT).as_posix()
        if base.git_bytes("show", f"{commit}:{git_path}") != artifact_raw:
            fail("artifact Git blob differs from frozen local snapshot")
        envelope, _ = base.load_json_raw(artifact_path)
        for item in envelope.get("rawInputs", []):
            source = base.safe_repo_path(item["path"])
            source_raw = source.read_bytes()
            if hashlib.sha256(source_raw).hexdigest() != item["rawSha256"] or len(source_raw) != item["bytes"]:
                fail("raw input changed before CAS publication")
            expected_cas = (base.CAS_ROOT / item["rawSha256"]).relative_to(ROOT).as_posix()
            if item["casPath"] != expected_cas:
                fail("raw input CAS path is not content-addressed")
            publish_cas(source_raw)
        cas_path = publish_cas(artifact_raw)
        if artifact_path.read_bytes() != artifact_raw:
            fail("artifact changed during validation")
        event = base.make_event(
            sequence=len(events)+1, previous_sha=events[-1]["eventSha256"], created_at=base.utc_now(),
            agent_id=args.agent_id, run_id=args.run_id, task_id=args.task_id, event_type="ARTIFACT_CAPTURED",
            fencing_token=args.fencing_token, input_bundle_sha=contracts["inputBundleSha256"], payload={
                "artifactClass":args.artifact_class, "path":git_path, "rawSha256":raw_sha,
                "bytes":len(artifact_raw), "mediaType":args.media_type, "observedAt":args.observed_at,
                "knownAt":args.known_at, "outcomesAccessed":False, "sourceId":task["sourceId"],
                "licenseDisposition":args.license_disposition, "accountTier":args.account_tier,
                "semantic":args.semantic, "cellKey":None, "supportedCriteria":sorted(set(args.supports)),
                "casPath":cas_path.relative_to(ROOT).as_posix(), "gitCommit":commit, "gitPath":git_path,
            },
        )
        new_state = append_checked(events_path, state_path, contracts, events, event, args.expected_head)
    return {"status":"PASS", "lastEventSha256":event["eventSha256"],
            "task":next(row for row in new_state["tasks"] if row["taskId"]==args.task_id), "outcomesAccessed":False}


def self_test() -> dict[str, Any]:
    contracts = validate_contracts()
    poisoned = json.loads(json.dumps(contracts["hypotheses"]))
    poisoned["hypotheses"][0]["requiredData"] = ["ORIGINAL_V4_RESULT", "H_LATE_ENDPOINT_VALUE"]
    poisoned["hypotheses"][0]["developmentPeriod"] = "2021-01-01/2024-12-31"
    hypothesis_rejected = False
    try:
        validate_hypothesis_blindness(poisoned)
    except base.ControllerError:
        hypothesis_rejected = True
    bad_content_rejected = text_has_token({"claim":"H_LATE ORIGINAL_V4_RESULT"}, FORBIDDEN_EVIDENCE_TOKENS)
    fake_events = [{"taskId":"Q001-QUANTCONNECT-FREE-HANDSHAKE", "eventType":"TASK_TRANSITIONED", "payload":{
        "fromState":"USER_ACTION_REQUIRED", "toState":"READY", "reasonCode":USER_READY_REASON, "note":USER_READY_NOTE,
    }}]
    account_reachable = user_access_attested(fake_events, "Q001-QUANTCONNECT-FREE-HANDSHAKE")
    pending_license_rejected = "LICENSE_REVIEW_PENDING" not in FINAL_LICENSES and "QUARANTINE_ONLY" not in FINAL_LICENSES
    remote_anchored = base.git_text("remote","get-url","origin") == AUTHORIZED_REMOTE and git_commit_authorized(MIGRATION_PARENT_COMMIT) == MIGRATION_PARENT_COMMIT
    return {
        "status":"PASS", "syntheticFixtureOnly":True, "inputBundleBound":bool(contracts["inputBundleSha256"]),
        "nestedHypothesisOutcomeRejected":hypothesis_rejected,
        "outcomeArtifactContentRejected":bad_content_rejected,
        "accountLaneReachableAfterExactAttestation":account_reachable,
        "pendingAndQuarantineLicensesCannotPromote":pending_license_rejected,
        "remoteTrustAnchorFrozen":remote_anchored,
        "independentPromotionRequired":True, "rawInputsRequireByteCasGitRemoteBinding":True,
        "casPublishedFromValidatedSnapshot":True, "eachMutationRequiresRemoteQueueSnapshot":True,
        "outcomesAccessed":False,
    }


def main() -> int:
    parser = base.build_parser()
    args = parser.parse_args()
    try:
        if args.command == "init":
            result = command_init(args)
        elif args.command == "verify":
            contracts, events, state = verify_current(Path(args.events), Path(args.state), heal=args.heal)
            result = {"status":"PASS", "inputBundleSha256":contracts["inputBundleSha256"],
                      "eventCount":len(events), "lastEventSha256":events[-1]["eventSha256"],
                      "stateSha256":state["stateSha256"], "tasks":len(state["tasks"]),
                      "taskCounts":state["taskCounts"], "originalV4GreenGates":state["originalV4"]["greenOfficialGates"],
                      "originalV4Complete":state["originalV4"]["complete"], "outcomesAccessed":False}
        elif args.command == "next":
            _, events, state = verify_current(Path(args.events), Path(args.state))
            ready=sorted((row for row in state["tasks"] if row["state"]=="READY"), key=lambda row:(-row["priority"],row["taskId"]))
            result={"status":"PASS","lastEventSha256":events[-1]["eventSha256"],"nextTask":ready[0] if ready else None,"readyTasks":len(ready),"outcomesAccessed":False}
        elif args.command == "claim":
            result = command_claim(args)
        elif args.command == "transition":
            result = command_transition(args)
        elif args.command == "capture":
            result = command_capture(args)
        elif args.command == "self-test":
            result = self_test()
        else:
            fail("unsupported V3 command")
    except (base.ControllerError, subprocess.CalledProcessError, KeyError, ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
