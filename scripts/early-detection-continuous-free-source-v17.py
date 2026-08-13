#!/usr/bin/env python3
"""Replay-only, remote-gated controller for the append-only V17 state."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research/early-detection-v4/continuous-free-source-operational-state-contract-v17.json"
EVENTS = ROOT / "state/early-detection-free-source-events-v17.jsonl"
STATE = ROOT / "state/early-detection-free-source-state-v17.json"
V16_STATE = ROOT / "state/early-detection-free-source-state-v16.json"
V16_EVENTS = ROOT / "state/early-detection-free-source-events-v16.jsonl"
V16_CONTROLLER = ROOT / "scripts/early-detection-continuous-free-source-v16.py"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BASE_COMMIT = "33838ac85b2c931fd6fb7cfb98ac27602e06c209"
EXPECTED_CONTRACT_RAW = "4b0b9e4e5ecd3d6c24ff7e3777ed9c1c688e8c2982b1881dab0ca1f1a856ed59"
EXPECTED_CONTROLLER_NORMALIZED = "f8960a5c9f8fc85f4d07855f34c03de1e996af65ef667f2016882a78cc53d069"
EXPECTED_TEST_NORMALIZED = "409213b1cdeff3db2155c32e335c0c3c81874399009246458843035449d8ac38"
EXPECTED_EVENTS_RAW = "8652d2964a8c474c1951cf6e519a6783d410262fc3c2ef47f743f2074d6b7773"
EXPECTED_STATE_RAW = "b6bed7c9b176666039339c28cd3e842d38612e60781a81bfa4139e1a8bb1fde9"
EXPECTED_STATE_SELF = "fe4855dbfbc7090bf45d94cd714926cb22f681215790f5580e40a908f5247ebe"
EXPECTED_PROJECTION_SHA = "35462c0b427c0ee1f23939eac68a65b44db7c62737f0819a3a12b2259a3302fc"

AUTHORIZED = [
    "research/early-detection-v4/continuous-free-source-operational-state-contract-v17.json",
    "scripts/early-detection-continuous-free-source-v17.py",
    "state/early-detection-free-source-events-v17.jsonl",
    "state/early-detection-free-source-state-v17.json",
    "tests/early-detection-continuous-free-source-v17.test.js",
]
INPUT_PATHS = {
    "policy": "research/early-detection-v4/continuous-free-source-policy-v1.md",
    "queueSeed": "research/early-detection-v4/continuous-free-source-queue-seed-v1.json",
    "registry": "research/early-detection-v4/continuous-free-source-registry-v1.json",
    "v16Contract": "research/early-detection-v4/continuous-free-source-operational-state-contract-v16.json",
    "v16Controller": "scripts/early-detection-continuous-free-source-v16.py",
    "v16ControllerTest": "tests/early-detection-continuous-free-source-v16.test.js",
    "v16EventLog": "state/early-detection-free-source-events-v16.jsonl",
    "v16State": "state/early-detection-free-source-state-v16.json",
    "closureProducerContract": "research/early-detection-v4/sec-terminal-closure-exhaustion-contract-v1.json",
    "closureProducerBuilder": "scripts/build-sec-terminal-closure-exhaustion-v1.py",
    "closureProducerTest": "tests/build-sec-terminal-closure-exhaustion-v1.test.js",
    "closureSealContract": "research/early-detection-v4/sec-terminal-closure-exhaustion-output-seal-contract-v1.json",
    "closureVerifier": "scripts/verify-sec-terminal-closure-exhaustion-output-v1.py",
    "closureSealTest": "tests/verify-sec-terminal-closure-exhaustion-output-v1.test.js",
    "closureOutput": "reports/early-detection/sec-terminal-closure-exhaustion-v1.json",
}
EXPECTED_TASK_IDS = [
    "Q001-QUANTCONNECT-TERMS-ACCOUNT", "Q002-QUANTCONNECT-50-CASE-CONTRACT",
    "Q003-SEC-TERMINAL-WEALTH-QUEUE", "Q004-FINRA-OTC-CATALOG",
    "Q005-US-EXCHANGE-PUBLIC-CATALOGS", "Q006-TIINGO-FREE-ENTITLEMENT",
    "Q007-OPENFIGI-ANONYMOUS-HANDSHAKE", "Q008-BUSINESS-QUANT-FREE-HANDSHAKE",
    "Q009-ALPHA-VANTAGE-NEGATIVE-CONTROL", "Q010-RESEARCH-ARCHIVE-DISCOVERY",
]


class StateError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise StateError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def exact_keys(value: object, expected: set[str], label: str) -> None:
    if type(value) is not dict or set(value) != expected:
        fail(f"{label} exact keys changed")


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        fail("Git binding failed")
    return result.stdout.strip()


def git_raw(commit: str, path: str) -> bytes:
    return subprocess.check_output(["git", "show", f"{commit}:{path}"], cwd=ROOT)


def git_exists(commit: str, path: str) -> bool:
    return subprocess.run(["git", "cat-file", "-e", f"{commit}:{path}"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


SELF_NAMES = (
    "EXPECTED_CONTRACT_RAW", "EXPECTED_CONTROLLER_NORMALIZED", "EXPECTED_TEST_NORMALIZED",
    "EXPECTED_EVENTS_RAW", "EXPECTED_STATE_RAW", "EXPECTED_STATE_SELF", "EXPECTED_PROJECTION_SHA",
)

MILESTONE_BINDINGS = [
    {"tag":879,"commit":"1adc2ecae56e56cc979ee3c7007ca6a04075600a","parent":"cb75c5c6efdae34533c8cf004aca93f3c5387810","subject":"Tag 879: SEC-Endwertluecken vollstaendig vorsortieren","workstream":"Q003_TERMINAL_CLOSURE_EXHAUSTION_CONTRACT","artifactCount":3,"deltaSha256":"bbbee4cdddc7b76ddf3a75d23b7205287799ebf8207c9af13f1230718c22b176","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
    {"tag":880,"commit":"f1c582f67b37300d629b8453ceb2d7b3ececf091","parent":"1adc2ecae56e56cc979ee3c7007ca6a04075600a","subject":"Tag 880: SEC-Endhandelsbericht getrennt versiegeln","workstream":"Q003_TERMINAL_CLOSURE_EXHAUSTION_OUTPUT_SEAL","artifactCount":3,"deltaSha256":"804b4d9708fa37bb4a6d0dc1c0d6cc14cb1974b28d982c0caece314baaa8ba2f","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
    {"tag":881,"commit":"33838ac85b2c931fd6fb7cfb98ac27602e06c209","parent":"f1c582f67b37300d629b8453ceb2d7b3ececf091","subject":"Tag 881: SEC-Endhandelsbericht materialisieren","workstream":"Q003_TERMINAL_CLOSURE_EXHAUSTION_OUTPUT","artifactCount":1,"deltaSha256":"d2dee0e1f2326ee9e2ab7b726cd34148a44ba3bf27398e7add7a2db0c895883d","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
]


def normalized_python(raw: bytes) -> str:
    text = raw.decode()
    for name in SELF_NAMES:
        text = re.sub(rf'({name}\s*=\s*")[^"]+"', rf'\g<1>{name}_NORMALIZED"', text)
    return sha(text.encode())


def normalized_test(raw: bytes) -> str:
    text = raw.decode()
    for name in SELF_NAMES:
        text = re.sub(rf'(const {name}\s*=\s*\')[^\']+(\'\s*;)', rf'\g<1>{name}_NORMALIZED\g<2>', text)
    return sha(text.encode())


def load_contract(exact_artifact: bool = True) -> dict:
    raw = CONTRACT.read_bytes()
    if exact_artifact and sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("V17 contract raw bytes changed")
    value = json.loads(raw)
    body = copy.deepcopy(value)
    claim = body.get("contractSelfSha256")
    body["contractSelfSha256"] = None
    if claim != sha(canonical(body)):
        fail("V17 contract self hash changed")
    exact_keys(value, {"schema","createdAt","track","purpose","contractSelfSha256","repository","inputs","milestoneBindings","implementation","outputs","replayContract","scientificLocks"}, "contract")
    if value["schema"] != "early-detection-continuous-free-source-operational-state-contract/v17" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    if value["createdAt"] != "2026-08-13T08:20:47Z" or datetime.fromisoformat(value["createdAt"].replace("Z", "+00:00")) > datetime.now(timezone.utc):
        fail("contract timeline changed")
    if value["purpose"] != "Append Tags879-881 as exact no-credit terminal-closure milestones, preserve the byte-exact V16 event history and release Q003 scheduling only after deterministic replay and exact remote introduction.":
        fail("contract purpose changed")
    repository = value["repository"]
    if repository != {"remote":REMOTE,"ref":REF,"buildBaseCommit":BASE_COMMIT,"buildBaseTag":881,"introductionMustBeDirectSingleParentChild":True,"introductionAddsExactlyAuthorizedPaths":True,"authorizedPaths":AUTHORIZED}:
        fail("repository contract changed")
    exact_keys(value["inputs"], {"rawSha256","inputBundleSha256","inputBundleRecomputedFromBaseRawHashesAndMilestoneDeltas","v16EventLogMustBeByteExactPrefix","v16ControllerMustVerifyRemoteBeforeImportCredit","closureOutputSealMustVerifyRemoteBeforeImportCredit"}, "inputs")
    if value["inputs"]["closureOutputSealMustVerifyRemoteBeforeImportCredit"] is not True:
        fail("closure output seal gate changed")
    if value["inputs"]["rawSha256"] != {key: sha((ROOT / path).read_bytes()) for key, path in INPUT_PATHS.items()}:
        fail("input raw bindings changed")
    expected_milestones = value["milestoneBindings"]
    if expected_milestones != MILESTONE_BINDINGS:
        fail("milestone population changed")
    milestone_keys = {"tag","commit","parent","subject","workstream","artifactCount","deltaSha256","status"}
    allowed_status = {"OPERATIONAL_MILESTONE_NO_CREDIT","SUPERSEDED_OPERATIONAL_ATTEMPT_NO_CREDIT"}
    for row in expected_milestones:
        exact_keys(row, milestone_keys, "milestone binding")
        if row["status"] not in allowed_status or not re.fullmatch(r"[0-9a-f]{64}", row["deltaSha256"]):
            fail("milestone credit or hash changed")
    if exact_artifact:
        if value["implementation"] != {"controllerNormalizedSha256":EXPECTED_CONTROLLER_NORMALIZED,"testNormalizedSha256":EXPECTED_TEST_NORMALIZED,"selfBindingsNormalizedBeforeHash":True}:
            fail("implementation binding changed")
        if normalized_python(Path(__file__).read_bytes()) != EXPECTED_CONTROLLER_NORMALIZED or normalized_test((ROOT / AUTHORIZED[-1]).read_bytes()) != EXPECTED_TEST_NORMALIZED:
            fail("implementation bytes changed")
        outputs = value["outputs"]
        if outputs != {"eventLogPath":AUTHORIZED[2],"eventLogRawSha256":EXPECTED_EVENTS_RAW,"eventCount":5,"lastEventSha256":parse_events(EVENTS.read_bytes())[-1]["eventSha256"],"statePath":AUTHORIZED[3],"stateRawSha256":EXPECTED_STATE_RAW,"stateSelfSha256":EXPECTED_STATE_SELF,"operationalProjectionSha256":EXPECTED_PROJECTION_SHA}:
            fail("output binding changed")
    expected_replay = {"lastEventCarriesCompleteOperationalProjection":True,"stateMustBeDeterministicallyMaterializedFromEvents":True,"v16EventLogMustBeByteExactPrefix":True,"taskCountsMustBeRecomputedFromTasks":True,"eligibleQueueMustBeRecomputedFromTasks":True,"nextTaskMustBeHighestPriorityEligibleTask":True,"milestoneDeltasMustBeRecomputedFromGitObjects":True,"nextRequiresRemotePostIntroduction":True,"verifyWithoutRemoteMustFail":True,"preIntroductionVerifyIsDiagnosticOnly":True}
    if value["replayContract"] != expected_replay or value["scientificLocks"] != expected_scientific_contract_locks():
        fail("replay or scientific locks changed")
    return value


def expected_scientific_contract_locks() -> dict:
    return {"originalV4GreenOfficialGates":2,"originalV4OfficialGateCount":13,"originalV4Complete":False,"originalV4GateCredit":False,"identityResolved":False,"terminalWealthComplete":False,"fiveRequiredDataSemanticsComplete":False,"resultComputationAllowed":False,"pricesAccessed":False,"returnsAccessed":False,"outcomesAccessed":False}


def parse_events(raw: bytes) -> list[dict]:
    rows = [json.loads(line) for line in raw.decode().splitlines() if line]
    if len(rows) != 5:
        fail("event count changed")
    for index, row in enumerate(rows):
        claim = row.get("eventSha256")
        body = copy.deepcopy(row)
        body.pop("eventSha256", None)
        if claim != sha(canonical(body)) or row.get("sequence") != index + 1:
            fail("event self hash or sequence changed")
        if row.get("previousEventSha256") != (None if index == 0 else rows[index - 1]["eventSha256"]):
            fail("event hash chain changed")
    if rows[-1].get("eventType") != "OPERATIONAL_MILESTONES_TAG879_TAG881_RECONCILED":
        fail("V17 replay event changed")
    return rows


def milestone_delta(commit: str) -> tuple[list[dict], str]:
    rows = git("diff-tree", "--no-commit-id", "--name-status", "-r", commit).splitlines()
    artifacts = []
    for row in rows:
        status, path = row.split("\t", 1)
        artifacts.append({"status":status,"path":path,"sha256":sha(git_raw(commit, path))})
    return artifacts, sha(canonical(artifacts))


def verify_inputs_and_milestones(contract: dict) -> tuple[dict, str]:
    actual = {key: sha((ROOT / path).read_bytes()) for key, path in INPUT_PATHS.items()}
    if actual != contract["inputs"]["rawSha256"]:
        fail("input raw bytes changed")
    for key, path in INPUT_PATHS.items():
        if git_raw(BASE_COMMIT, path) != (ROOT / path).read_bytes():
            fail(f"input Git bytes changed: {key}")
    milestone_deltas = []
    previous = "cb75c5c6efdae34533c8cf004aca93f3c5387810"
    for row in contract["milestoneBindings"]:
        if row["parent"] != previous or git("show", "-s", "--format=%P", row["commit"]).split() != [previous]:
            fail("milestone single-parent chain changed")
        if git("show", "-s", "--format=%s", row["commit"]) != row["subject"]:
            fail("milestone subject changed")
        artifacts, digest = milestone_delta(row["commit"])
        if len(artifacts) != row["artifactCount"] or digest != row["deltaSha256"]:
            fail("milestone artifact delta changed")
        for artifact in artifacts:
            if git_raw(BASE_COMMIT, artifact["path"]) != git_raw(row["commit"], artifact["path"]):
                fail("milestone artifact drifted by Tag881")
        milestone_deltas.append(row["deltaSha256"])
        previous = row["commit"]
    if previous != BASE_COMMIT:
        fail("milestone range does not end at build base")
    bundle = sha(canonical({"baseCommit":BASE_COMMIT,"inputRawSha256":actual,"milestoneDeltaSha256":milestone_deltas}))
    if bundle != contract["inputs"]["inputBundleSha256"]:
        fail("input bundle changed")
    return actual, bundle


def expected_projection(contract: dict) -> dict:
    previous = json.loads(V16_STATE.read_bytes())["operationalProjection"]
    result = copy.deepcopy(previous)
    by_id = {task["taskId"]: task for task in result["tasks"]}
    by_id["Q003-SEC-TERMINAL-WEALTH-QUEUE"]["milestoneRefs"] += [879,880,881]
    result["operationalMilestones"] += [{key: row[key] for key in ("tag","commit","parent","subject","workstream","artifactCount","status")} for row in contract["milestoneBindings"]]
    return result


def validate_projection(projection: dict, contract: dict) -> dict:
    expected = expected_projection(contract)
    if projection != expected or sha(canonical(projection)) != EXPECTED_PROJECTION_SHA:
        fail("operational projection changed")
    if set(projection) != {"taskCounts","tasks","q005Sublanes","scheduler","operationalMilestones","milestoneClaimLocks","lockedStudies","originalV4","scientificLocks"}:
        fail("projection schema changed")
    tasks = projection["tasks"]
    if [task.get("taskId") for task in tasks] != EXPECTED_TASK_IDS:
        fail("Q001-Q010 conservation changed")
    task_keys = {"taskId","sourceId","legacyV12State","operationalState","schedulerEligible","priority","milestoneRefs","nextAction"}
    for task in tasks:
        exact_keys(task, task_keys, "task")
    counts = dict(Counter(task["operationalState"] for task in tasks))
    counts["RESOLVED"] = sum(task["operationalState"] == "RESOLVED" for task in tasks)
    if counts != projection["taskCounts"] or counts["RESOLVED"] != 0:
        fail("task counts or resolution credit changed")
    eligible = sorted((task for task in tasks if task["schedulerEligible"] is True and task["operationalState"] == "AUTONOMOUS_OPEN"), key=lambda task:(-task["priority"],task["taskId"]))
    eligible_ids = [task["taskId"] for task in eligible]
    blocked_ids = [task["taskId"] for task in tasks if task["taskId"] not in set(eligible_ids)]
    scheduler = projection["scheduler"]
    if scheduler != {"strategy":"HIGHEST_PRIORITY_AUTONOMOUS_OPEN_ONLY","eligibleTaskIds":eligible_ids,"blockedTaskIds":blocked_ids,"nextTaskId":eligible_ids[0],"q002AutoNextForbidden":True} or eligible_ids[0] != "Q003-SEC-TERMINAL-WEALTH-QUEUE":
        fail("scheduler changed")
    if tasks[0]["operationalState"] != "RIGHTS_BLOCKED_EXPORT" or tasks[1]["operationalState"] != "RIGHTS_BLOCKED_EXPORT" or tasks[1]["schedulerEligible"] is not False:
        fail("QuantConnect rights block changed")
    if tasks[6]["operationalState"] != "MILESTONE_COMPLETE_NO_INTERVAL_CREDIT" or tasks[8]["operationalState"] != "EXTERNAL_DEFERRED":
        fail("point-only or external deferral changed")
    if [lane["laneId"] for lane in projection["q005Sublanes"]] != ["NASDAQ","NYSE","NYSE_AMERICAN","CBOE"] or any(lane["schedulerEligible"] is not True for lane in projection["q005Sublanes"]):
        fail("Q005 sublanes changed")
    if len(projection["operationalMilestones"]) != 23:
        fail("milestone conservation changed")
    if any(row["status"] not in {"OPERATIONAL_MILESTONE_NO_CREDIT","SUPERSEDED_OPERATIONAL_ATTEMPT_NO_CREDIT"} for row in projection["operationalMilestones"]):
        fail("milestone credit changed")
    if any(value is not False for value in projection["milestoneClaimLocks"].values()):
        fail("milestone claim lock changed")
    if projection["originalV4"] != {"protocol":"FEM-SEC-US@1.2.0","greenOfficialGates":2,"officialGateCount":13,"complete":False,"resultComputationAllowed":False,"outcomesAccessed":False}:
        fail("Original V4 changed")
    locks = projection["scientificLocks"]
    if locks.get("studyCredit") != "NONE" or any(value is not False for key, value in locks.items() if key != "studyCredit"):
        fail("scientific lock changed")
    forbidden_values = {"SCIENTIFIC_CREDIT_GRANTED","RESULT_READY","OUTCOME_READY","TERMINAL_WEALTH_COMPLETE"}
    allowed_credit_keys = set(projection["milestoneClaimLocks"]) | set(projection["scientificLocks"]) | set(projection["taskCounts"]) | {"originalV4GateCredit","outcomesAccessed","resultComputationAllowed","complete"}
    def scan(value: object) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                upper = key.upper()
                if any(token in upper for token in ("CREDIT","OUTCOME","RESULT","RESOLVED","IDENTITY","TERMINAL")) and key not in allowed_credit_keys:
                    fail("unknown credit key")
                scan(item)
        elif isinstance(value, list):
            for item in value: scan(item)
        elif isinstance(value, str) and value in forbidden_values:
            fail("forbidden credit value")
    scan(projection)
    return {"eligibleTaskIds":eligible_ids,"nextTaskId":eligible_ids[0]}


def materialize_state(contract: dict, event_raw: bytes, events: list[dict], input_raw: dict, bundle: str) -> dict:
    last = events[-1]
    payload = last["payload"]
    exact_keys(payload, {"baseCommit","milestoneRange","repositoryRemote","sourceEventLogRawSha256","sourceStateRawSha256","sourceStateSelfSha256","sourceLastEventSha256","replacementStatePath","supersessionReasonCode","v17EventCarriesCompleteOperationalProjection","noScientificCredit","outcomesAccessed","operationalProjectionSha256","operationalProjection"}, "event payload")
    if payload["milestoneRange"] != {"firstTag":879,"lastTag":881,"count":3,"allNoCredit":True} or payload["replacementStatePath"] != AUTHORIZED[3] or payload["supersessionReasonCode"] != "V16_POINTER_PREDATES_TAG879_TAG881_OPERATIONAL_MILESTONES" or payload["v17EventCarriesCompleteOperationalProjection"] is not True:
        fail("event milestone range or supersession changed")
    v16 = json.loads(V16_STATE.read_bytes())
    if last["inputBundleSha256"] != bundle or payload["baseCommit"] != BASE_COMMIT or payload["repositoryRemote"] != REMOTE:
        fail("event input or repository changed")
    if payload["sourceEventLogRawSha256"] != input_raw["v16EventLog"] or payload["sourceStateRawSha256"] != input_raw["v16State"] or payload["sourceStateSelfSha256"] != v16["stateSha256"]:
        fail("event predecessor binding changed")
    if payload["sourceLastEventSha256"] != events[-2]["eventSha256"] or payload["noScientificCredit"] is not True or payload["outcomesAccessed"] is not False:
        fail("event chain or scientific boundary changed")
    projection = payload["operationalProjection"]
    if payload["operationalProjectionSha256"] != sha(canonical(projection)):
        fail("event projection hash changed")
    validate_projection(projection, contract)
    state = {
        "schema":"early-detection-free-source-operational-state/v17",
        "materializedAt":last["createdAt"],
        "track":"SHARED_OUTCOME_BLIND_INFRA",
        "purpose":"Deterministically replay Tags879-881 as outcome-blind no-credit terminal-closure milestones while preserving Q001-Q010 and remote-gated Q003 scheduling.",
        "repository":{"remote":REMOTE,"ref":REF,"buildBaseCommit":BASE_COMMIT,"buildBaseTag":881},
        "inputBundleSha256":bundle,
        "inputRawSha256":input_raw,
        "predecessor":{"version":16,"contractPath":INPUT_PATHS["v16Contract"],"contractRawSha256":input_raw["v16Contract"],"controllerPath":INPUT_PATHS["v16Controller"],"controllerRawSha256":input_raw["v16Controller"],"testPath":INPUT_PATHS["v16ControllerTest"],"testRawSha256":input_raw["v16ControllerTest"],"eventLogPath":INPUT_PATHS["v16EventLog"],"eventLogRawSha256":input_raw["v16EventLog"],"statePath":INPUT_PATHS["v16State"],"stateRawSha256":input_raw["v16State"],"stateSelfSha256":v16["stateSha256"],"lastEventSha256":events[-2]["eventSha256"],"appendOnly":True,"remoteVerificationRequired":True,"semanticStatus":"SUPERSEDED_BY_TAG879_TAG881_RECONCILED_V17"},
        "eventLog":{"path":AUTHORIZED[2],"eventCount":5,"rawSha256":sha(event_raw),"lastEventSha256":last["eventSha256"],"v16ByteExactPrefix":True,"hashChainVerified":True,"fullProjectionCarriedByLastEvent":True},
        "operationalProjection":projection,
    }
    state["stateSha256"] = sha(canonical(state))
    return state


def verify_v16_remote() -> None:
    raw = V16_CONTROLLER.read_bytes()
    if sha(raw) != load_contract()["inputs"]["rawSha256"]["v16Controller"]:
        fail("V16 controller changed before import")
    namespace = {"__name__":"v16_bound","__file__":str(V16_CONTROLLER)}
    exec(compile(raw, str(V16_CONTROLLER), "exec"), namespace)
    result = namespace["verify"](True)
    if result.get("status") != "PASS" or result.get("nextTaskId") != "Q003-SEC-TERMINAL-WEALTH-QUEUE" or result.get("outcomesAccessed") is not False:
        fail("V16 remote predecessor verification failed")


def verify_closure_remote() -> None:
    verifier = ROOT / INPUT_PATHS["closureVerifier"]
    if sha(verifier.read_bytes()) != load_contract()["inputs"]["rawSha256"]["closureVerifier"]:
        fail("closure verifier changed before execution")
    result = subprocess.run(["python", "-B", str(verifier), "verify", "--remote"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        fail("closure remote verification failed")
    report = json.loads(result.stdout)
    if report.get("status") != "PASS" or report.get("phase") != "OUTPUT_INTRODUCED" or report.get("rows") != 23 or report.get("sourceDerivedFullRebuild") is not True or report.get("outcomesAccessed") is not False:
        fail("closure output was not fully source rebuilt")


def introduction_phase(head: str) -> tuple[str, str | None]:
    present = [path for path in AUTHORIZED if git_exists(head, path)]
    if not present:
        return "PRE_INTRODUCTION", None
    if present != AUTHORIZED:
        fail("partial V17 introduction")
    introductions = {git("log", "--diff-filter=A", "-1", "--format=%H", "--", path) for path in AUTHORIZED}
    if len(introductions) != 1:
        fail("V17 paths were not introduced together")
    introduction = introductions.pop()
    if git("show", "-s", "--format=%P", introduction).split() != [BASE_COMMIT]:
        fail("V17 introduction is not direct single-parent child of Tag881")
    if git("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines() != [f"A\t{path}" for path in AUTHORIZED]:
        fail("V17 introduction is not exactly five additions")
    chain = git("rev-list", "--first-parent", head).splitlines()
    if introduction not in chain:
        fail("V17 introduction missing from first-parent history")
    for commit in chain[:chain.index(introduction)]:
        if len(git("show", "-s", "--format=%P", commit).split()) != 1:
            fail("non-linear descendant after V17 introduction")
    for path in AUTHORIZED:
        if git("log", "-1", "--format=%H", "--", path) != introduction or git_raw(head, path) != (ROOT / path).read_bytes():
            fail("V17 Git/worktree bytes drifted")
    return "POST_INTRODUCTION", introduction


def verify(remote: bool) -> dict:
    if not remote:
        fail("remote verification is mandatory")
    contract = load_contract()
    input_raw, bundle = verify_inputs_and_milestones(contract)
    event_raw = EVENTS.read_bytes()
    state_raw = STATE.read_bytes()
    if sha(event_raw) != EXPECTED_EVENTS_RAW or sha(state_raw) != EXPECTED_STATE_RAW or not event_raw.startswith(V16_EVENTS.read_bytes()):
        fail("V17 output bytes or V16 prefix changed")
    events = parse_events(event_raw)
    expected_state = materialize_state(contract, event_raw, events, input_raw, bundle)
    actual_state = json.loads(state_raw)
    if actual_state != expected_state or actual_state["stateSha256"] != EXPECTED_STATE_SELF:
        fail("state is not deterministic replay")
    if git("remote", "get-url", "origin") != REMOTE:
        fail("origin changed")
    head = git("rev-parse", "HEAD")
    rows = git("ls-remote", "--refs", "origin", REF).splitlines()
    if len(rows) != 1 or not head == git("rev-parse", "@{u}") == rows[0].split()[0]:
        fail("HEAD/upstream/live remote drift")
    verify_v16_remote()
    verify_closure_remote()
    phase, introduction = introduction_phase(head)
    schedule = validate_projection(actual_state["operationalProjection"], contract)
    return {"schema":"early-detection-free-source-operational-state-verification/v17","status":"PASS" if phase == "POST_INTRODUCTION" else "PRE_INTRODUCTION_DIAGNOSTIC","phase":phase,"introductionCommit":introduction,"controllerResumeAllowed":phase == "POST_INTRODUCTION","eventCount":5,"operationalMilestones":23,"newMilestones":3,"tasksConserved":10,"resolvedTasks":0,"eligibleTasks":len(schedule["eligibleTaskIds"]),"nextTaskId":schedule["nextTaskId"],"q002AutoNext":False,"originalV4GreenOfficialGates":2,"originalV4OfficialGateCount":13,"v16PrefixVerified":True,"milestoneGitDeltasVerified":3,"v16RemoteVerified":True,"remoteVerified":True,"outcomesAccessed":False}


def self_test() -> dict:
    contract = load_contract()
    input_raw, bundle = verify_inputs_and_milestones(contract)
    event_raw = EVENTS.read_bytes()
    projection = materialize_state(contract, event_raw, parse_events(event_raw), input_raw, bundle)["operationalProjection"]
    mutations = {
        "dropTask":lambda x:x["tasks"].pop(),
        "resolvedCounter":lambda x:(x["tasks"][5].__setitem__("operationalState","RESOLVED"),x["taskCounts"].__setitem__("ACCOUNT_DEFERRED",1),x["taskCounts"].__setitem__("RESOLVED",1)),
        "renameTask":lambda x:(x["tasks"][5].__setitem__("taskId","Q006-FAKE"),x["scheduler"]["blockedTaskIds"].__setitem__(3,"Q006-FAKE")),
        "q002Eligible":lambda x:x["tasks"][1].__setitem__("schedulerEligible",True),
        "cboeClosed":lambda x:(x["q005Sublanes"][3].__setitem__("state","CLOSED"),x["q005Sublanes"][3].__setitem__("schedulerEligible",False)),
        "forgedNext":lambda x:x["scheduler"].__setitem__("nextTaskId","Q010-RESEARCH-ARCHIVE-DISCOVERY"),
        "milestoneCredit":lambda x:x["operationalMilestones"][20].__setitem__("status","SCIENTIFIC_CREDIT_GRANTED"),
        "taskCredit":lambda x:x["tasks"][2].__setitem__("originalV4GateCredit",True),
        "laneCredit":lambda x:x["q005Sublanes"][0].__setitem__("identityResolved",True),
        "studyOutcome":lambda x:x["lockedStudies"][0].__setitem__("outcomesAccessed",True),
        "unknownCredit":lambda x:x["scientificLocks"].__setitem__("unknownCredit",True),
        "originalV4":lambda x:x["originalV4"].__setitem__("greenOfficialGates",3),
    }
    kills = {}
    for name, mutate in mutations.items():
        changed = copy.deepcopy(projection)
        mutate(changed)
        try: validate_projection(changed, contract)
        except (StateError, KeyError, TypeError, ValueError): kills[name] = True
        else: kills[name] = False
    changed_contract = copy.deepcopy(contract)
    changed_contract["milestoneBindings"][-1]["status"] = "SCIENTIFIC_CREDIT_GRANTED"
    try: load_contract_semantics(changed_contract)
    except StateError: kills["contractMilestoneCredit"] = True
    else: kills["contractMilestoneCredit"] = False
    if not all(kills.values()):
        fail("self-test mutation survived")
    return {"schema":"early-detection-free-source-operational-state-self-test/v17","status":"PASS","killCount":len(kills),"kills":kills,"outcomesAccessed":False}


def load_contract_semantics(value: dict) -> None:
    if value["purpose"] != "Append Tags879-881 as exact no-credit terminal-closure milestones, preserve the byte-exact V16 event history and release Q003 scheduling only after deterministic replay and exact remote introduction.":
        fail("purpose changed")
    if any(row.get("status") not in {"OPERATIONAL_MILESTONE_NO_CREDIT","SUPERSEDED_OPERATIONAL_ATTEMPT_NO_CREDIT"} for row in value["milestoneBindings"]):
        fail("milestone credit changed")
    if value["scientificLocks"] != expected_scientific_contract_locks():
        fail("scientific locks changed")


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("verify","next"):
        child = sub.add_parser(command)
        child.add_argument("--remote", action="store_true")
    sub.add_parser("self-test")
    args = parser.parse_args()
    try:
        if args.command == "self-test": result = self_test()
        else:
            result = verify(args.remote)
            if args.command == "next":
                if result["phase"] != "POST_INTRODUCTION" or result["controllerResumeAllowed"] is not True:
                    fail("next is forbidden before remote V17 introduction")
                result = {"schema":"early-detection-free-source-next/v17","status":"PASS","nextTaskId":result["nextTaskId"],"remoteVerified":True,"postIntroductionVerified":True,"q002AutoNext":False,"outcomesAccessed":False}
    except (StateError,OSError,KeyError,TypeError,ValueError,json.JSONDecodeError,subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
