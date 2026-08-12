#!/usr/bin/env python3
"""Fail-closed append-only V6 controller for the continuous no-cost source queue.

Earlier controllers remain immutable. V4 closes outcome-token normalization,
remote-CAS and self-attested account/evidence promotion gaps. Account activation
and evidence promotion remain deliberately blocked until externally bound proof
and criterion-specific reparsers are installed in a successor controller.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import types
from datetime import timedelta
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BASE_PATH = ROOT / "scripts" / "early-detection-continuous-free-source.py"
TEST_PATH = ROOT / "tests" / "early-detection-continuous-free-source-v6.test.js"
AUTHORIZED_REMOTE = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_BRANCH = "refs/heads/codex/early-detection-v4-gates-20260810"
MIGRATION_PARENT_COMMIT = "face92a858d6e38ccb1616765961413834ed0732"
BASE_CONTROLLER_SHA256 = "4f53b205aeaa0ae0f22bd5c99955c251a5e6fe7d99424ccd3b2398b6401e9d80"
USER_READY_REASON = "FREE-ACCESS-ATTESTED"
USER_READY_NOTE = "NO_PAYMENT_DETAILS;NO_TRIAL;FREE_CREDENTIAL_LOCAL_ONLY;NO_SECRET_IN_EVENT"
FINAL_LICENSES = {"PUBLIC_DOMAIN", "FREE_INTERNAL_USE_ALLOWED"}
RAW_INPUT_STATUS = "CAPTURED_VERIFIED"
FORBIDDEN_EVIDENCE_TOKENS = {
    "ORIGINAL_V4", "ORIGINAL_V4_RESULT", "ORIGINAL_V4_GATE_PASS", "H_LATE", "H_FEM",
    "ENDPOINT", "ENDPOINT_VALUE", "P_VALUE", "RETURN", "RETURN_VALUE", "FAVORABLE_RESULT",
}
FORBIDDEN_HYPOTHESIS_TOKENS = FORBIDDEN_EVIDENCE_TOKENS | {
    "SEC_CIK", "SEC_CIK_RESULT", "SEC_CIK_ENDPOINT", "SEC_CIK_GROWTH_PERSISTENCE",
    "COMPLETED_SEC_CIK", "COMPLETED_STUDY_RESULT", "ANALYSIS_LEDGER",
    "THRESHOLD_TUNING", "THRESHOLD_OPTIMIZATION", "POST_OUTCOME_OPTIMIZATION",
    "CHOOSE_BEST_CUTOFF",
}

base_source = BASE_PATH.read_bytes()
if hashlib.sha256(base_source).hexdigest() != BASE_CONTROLLER_SHA256:
    raise RuntimeError("immutable base controller bytes changed before import")
base = types.ModuleType("free_source_v2")
base.__file__ = str(BASE_PATH)
exec(compile(base_source, str(BASE_PATH), "exec"), base.__dict__)

base.SCRIPT_PATH = Path(__file__).resolve()
base.TEST_PATH = TEST_PATH
base.DEFAULT_EVENTS_PATH = ROOT / "state" / "early-detection-free-source-events-v6.jsonl"
base.DEFAULT_STATE_PATH = ROOT / "state" / "early-detection-free-source-state-v6.json"
base.LOCK_PATH = ROOT / "state" / ".early-detection-free-source-controller-v6.lock"
BASE_VALIDATE_CONTRACTS = base.validate_contracts


def fail(message: str) -> None:
    raise base.ControllerError(message)


def text_has_token(value: Any, tokens: set[str]) -> bool:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", text).upper()
    text = re.sub(r"[^A-Z0-9]+", "_", text).strip("_")
    text = text.replace("NON_RETURN", "NONRETURN")
    normalized = {re.sub(r"[^A-Z0-9]+", "_", token.upper()).strip("_") for token in tokens}
    if any(re.search(rf"(?<![A-Z0-9]){re.escape(token)}(?![A-Z0-9])", text) for token in normalized):
        return True
    compact_text = text.replace("NONRETURN", "SAFE_NONRET").replace("_", "")
    compact_tokens = {token.replace("_", "") for token in normalized if len(token.replace("_", "")) >= 9}
    return any(token in compact_text for token in compact_tokens)


def validate_state_paths_v6(events_path: Path, state_path: Path) -> tuple[Path, Path]:
    events, state = base.validate_state_paths(events_path, state_path)
    if events != base.DEFAULT_EVENTS_PATH.resolve() or state != base.DEFAULT_STATE_PATH.resolve():
        fail("V6 accepts only the single frozen event/state path pair")
    return events, state


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
        if not isinstance(row.get("requiredData"), list) or not all(isinstance(item, str) for item in row["requiredData"]):
            fail(f"hypothesis[{index}] requiredData must be a string list")
        inspected = {
            key: row.get(key) for key in (
                "mechanism", "primaryClaim", "requiredData", "falsificationCriterion",
                "developmentPeriod", "validationPeriod", "expectedSign",
            )
        }
        if text_has_token(inspected, FORBIDDEN_HYPOTHESIS_TOKENS):
            fail(f"hypothesis[{index}] uses a forbidden outcome/study input")
        if text_has_token(row.get("requiredData"), {"RESULT", "ANALYSIS", "LEDGER", "ENDPOINT", "BEST_CUTOFF"}):
            fail(f"hypothesis[{index}] requires a result-derived input")


def validate_contracts() -> dict[str, Any]:
    contracts = BASE_VALIDATE_CONTRACTS()
    if base.git_text("remote", "get-url", "origin") != AUTHORIZED_REMOTE:
        fail("authorized repository remote changed")
    git_commit_authorized(MIGRATION_PARENT_COMMIT)
    if base.file_sha256(BASE_PATH) != BASE_CONTROLLER_SHA256:
        fail("immutable base controller bytes changed")
    validate_hypothesis_blindness(contracts["hypotheses"])
    contracts["rawBindings"]["controller"] = base.file_sha256(Path(__file__).resolve())
    contracts["rawBindings"]["controllerTest"] = base.file_sha256(TEST_PATH)
    contracts["rawBindings"]["baseController"] = BASE_CONTROLLER_SHA256
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
    # A queue event is not authentication. V4 intentionally keeps every account
    # lane blocked until a successor version can bind an externally confirmed
    # account/terms envelope without letting an autonomous agent self-attest.
    return False


def validate_promotion(events: list[dict[str, Any]], task: dict[str, Any]) -> None:
    fail("V4 resolution is disabled until criterion-specific deterministic reparsers are installed")


def validate_v4_events(events: list[dict[str, Any]], state: dict[str, Any]) -> None:
    genesis = events[0]
    if genesis["payload"]["repositoryRemote"] != AUTHORIZED_REMOTE:
        fail("genesis remote is not the frozen authorized remote")
    genesis_commit = git_commit_authorized(genesis["payload"]["baseCommit"])
    if base.git_bytes("show", f"{genesis_commit}:{Path(__file__).resolve().relative_to(ROOT).as_posix()}") != Path(__file__).read_bytes():
        fail("genesis commit does not bind the exact V6 controller")
    if base.git_bytes("show", f"{genesis_commit}:{TEST_PATH.relative_to(ROOT).as_posix()}") != TEST_PATH.read_bytes():
        fail("genesis commit does not bind the exact V6 test")
    if base.git_bytes("show", f"{genesis_commit}:{BASE_PATH.relative_to(ROOT).as_posix()}") != BASE_PATH.read_bytes():
        fail("genesis commit does not bind the immutable base controller")
    for event in events:
        if event["eventType"] == "TASK_TRANSITIONED":
            if text_has_token({"reasonCode": event["payload"]["reasonCode"], "note": event["payload"]["note"]}, FORBIDDEN_EVIDENCE_TOKENS):
                fail("transition contains outcome-sensitive text")
            if event["payload"]["fromState"] == "USER_ACTION_REQUIRED" and event["payload"]["toState"] == "READY":
                fail("V4 rejects autonomous account readiness; externally bound user proof is required")
            if event["payload"]["toState"] == "RESOLVED":
                task = next(row for row in state["tasks"] if row["taskId"] == event["taskId"])
                validate_promotion(events[:event["sequence"]], task)


def verify_current(events_path: Path, state_path: Path, *, heal: bool = False, synthetic_fixture: bool = False):
    events_path, state_path = validate_state_paths_v6(events_path, state_path)
    contracts, events, state = base.verify_current(events_path, state_path, heal=heal, synthetic_fixture=synthetic_fixture)
    validate_v4_events(events, state)
    return contracts, events, state


def command_init(args: argparse.Namespace) -> dict[str, Any]:
    contracts = validate_contracts()
    events_path, state_path = validate_state_paths_v6(Path(args.events), Path(args.state))
    with base.exclusive_lock():
        if events_path.exists() or state_path.exists():
            fail("V6 init refuses existing event/state files")
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
        validate_v4_events([event], state)
        base.atomic_write_new_or_replace(events_path, raw, require_new=True)
        base.atomic_write_new_or_replace(state_path, base.pretty_json_bytes(state), require_new=True)
    return {"status": "PASS", "eventCount": 1, "lastEventSha256": event["eventSha256"],
            "stateSha256": state["stateSha256"], "tasks": len(state["tasks"]),
            "ready": state["taskCounts"]["READY"], "userActionRequired": state["taskCounts"]["USER_ACTION_REQUIRED"],
            "originalV4GreenGates": state["originalV4"]["greenOfficialGates"], "outcomesAccessed": False}


def append_checked(events_path: Path, state_path: Path, contracts: dict[str, Any], events: list[dict[str, Any]], event: dict[str, Any], expected_head: str, remote_snapshot: str):
    if events[-1]["eventSha256"] != expected_head:
        fail("queue head changed; compare-and-swap rejected")
    base.validate_event(event, events[-1], contracts["inputBundleSha256"])
    raw = events_path.read_bytes() + base.canonical_bytes(event) + b"\n"
    state = base.materialize_state(contracts, events + [event], raw)
    validate_v4_events(events + [event], state)
    if authorized_remote_head() != remote_snapshot or base.git_text("rev-parse", "HEAD") != remote_snapshot:
        fail("remote or local HEAD changed before queue write")
    require_remote_queue_snapshot(events_path, state_path)
    base.atomic_write_new_or_replace(events_path, raw, require_new=False)
    base.atomic_write_new_or_replace(state_path, base.pretty_json_bytes(state), require_new=False)
    return state


def command_claim(args: argparse.Namespace) -> dict[str, Any]:
    events_path, state_path = validate_state_paths_v6(Path(args.events), Path(args.state))
    with base.exclusive_lock():
        contracts, events, state = verify_current(events_path, state_path)
        remote_snapshot = require_remote_queue_snapshot(events_path, state_path)
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
        new_state = append_checked(events_path, state_path, contracts, events, event, args.expected_head, remote_snapshot)
    return {"status":"PENDING_REMOTE_PROMOTION", "lastEventSha256":event["eventSha256"],
            "task":next(row for row in new_state["tasks"] if row["taskId"]==args.task_id), "outcomesAccessed":False}


def command_transition(args: argparse.Namespace) -> dict[str, Any]:
    events_path, state_path = validate_state_paths_v6(Path(args.events), Path(args.state))
    with base.exclusive_lock():
        contracts, events, state = verify_current(events_path, state_path)
        remote_snapshot = require_remote_queue_snapshot(events_path, state_path)
        task = next((row for row in state["tasks"] if row["taskId"] == args.task_id), None)
        if task is None:
            fail("unknown task")
        if task["state"] == "USER_ACTION_REQUIRED" and args.to_state == "READY":
            fail("account readiness cannot be self-attested by a queue transition")
        if args.to_state == "RESOLVED":
            fail("V4 resolution is disabled until criterion-specific deterministic reparsers are installed")
        event = base.make_event(
            sequence=len(events)+1, previous_sha=events[-1]["eventSha256"], created_at=base.utc_now(),
            agent_id=args.agent_id, run_id=args.run_id, task_id=args.task_id, event_type="TASK_TRANSITIONED",
            fencing_token=args.fencing_token, input_bundle_sha=contracts["inputBundleSha256"], payload={
                "fromState":task["state"], "toState":args.to_state,
                "reasonCode":base.require_id(args.reason_code,"reasonCode"), "note":args.note,
            },
        )
        new_state = append_checked(events_path, state_path, contracts, events, event, args.expected_head, remote_snapshot)
    return {"status":"PENDING_REMOTE_PROMOTION", "lastEventSha256":event["eventSha256"],
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
    fail("V4 capture is disabled until transactional CAS and criterion-specific reparsers are installed")


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
    fake_events = [{"taskId":"Q001-QUANTCONNECT-TERMS-ACCOUNT", "eventType":"TASK_TRANSITIONED", "payload":{
        "fromState":"USER_ACTION_REQUIRED", "toState":"READY", "reasonCode":USER_READY_REASON, "note":USER_READY_NOTE,
    }}]
    account_self_attestation_rejected = not user_access_attested(fake_events, "Q001-QUANTCONNECT-TERMS-ACCOUNT")
    normalization_rejected = all(text_has_token({"x": value}, FORBIDDEN_EVIDENCE_TOKENS) for value in (
        "originalV4Result", "ORIGINAL V4 RESULT", "originalv4result", "return", "endpointValue",
    ))
    nested = json.loads(json.dumps(contracts["hypotheses"]))
    nested["hypotheses"][0]["requiredData"] = ["SEC-CIK-GROWTH-PERSISTENCE@1.0.0 analysis-ledger choose best cutoff"]
    nested_study_rejected = False
    try:
        validate_hypothesis_blindness(nested)
    except base.ControllerError:
        nested_study_rejected = True
    pending_license_rejected = "LICENSE_REVIEW_PENDING" not in FINAL_LICENSES and "QUARANTINE_ONLY" not in FINAL_LICENSES
    remote_anchored = base.git_text("remote","get-url","origin") == AUTHORIZED_REMOTE and git_commit_authorized(MIGRATION_PARENT_COMMIT) == MIGRATION_PARENT_COMMIT
    return {
        "status":"PASS", "syntheticFixtureOnly":True, "inputBundleBound":bool(contracts["inputBundleSha256"]),
        "nestedHypothesisOutcomeRejected":hypothesis_rejected,
        "outcomeArtifactContentRejected":bad_content_rejected,
        "autonomousAccountSelfAttestationRejected":account_self_attestation_rejected,
        "casefoldCamelSpaceOutcomeTokensRejected":normalization_rejected,
        "nestedCompletedStudyInputRejected":nested_study_rejected,
        "baseControllerPreImportBytesBound":hashlib.sha256(base_source).hexdigest() == BASE_CONTROLLER_SHA256,
        "singleFrozenStatePathPairRequired":True,
        "pendingAndQuarantineLicensesCannotPromote":pending_license_rejected,
        "remoteTrustAnchorFrozen":remote_anchored,
        "resolutionFailClosedUntilDeterministicReparser":True,
        "captureFailClosedUntilTransactionalCas":True,
        "eachMutationRequiresStableRemoteQueueSnapshot":True,
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
            require_remote_queue_snapshot(Path(args.events), Path(args.state))
            result = {"status":"PASS", "inputBundleSha256":contracts["inputBundleSha256"],
                      "eventCount":len(events), "lastEventSha256":events[-1]["eventSha256"],
                      "stateSha256":state["stateSha256"], "tasks":len(state["tasks"]),
                      "taskCounts":state["taskCounts"], "originalV4GreenGates":state["originalV4"]["greenOfficialGates"],
                      "originalV4Complete":state["originalV4"]["complete"], "outcomesAccessed":False}
        elif args.command == "next":
            _, events, state = verify_current(Path(args.events), Path(args.state))
            require_remote_queue_snapshot(Path(args.events), Path(args.state))
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
            fail("unsupported V6 command")
    except (base.ControllerError, subprocess.CalledProcessError, KeyError, ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
