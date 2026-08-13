#!/usr/bin/env python3
"""Replay-only, remote-gated controller for the append-only V16 state."""

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
CONTRACT = ROOT / "research/early-detection-v4/continuous-free-source-operational-state-contract-v16.json"
EVENTS = ROOT / "state/early-detection-free-source-events-v16.jsonl"
STATE = ROOT / "state/early-detection-free-source-state-v16.json"
V14_STATE = ROOT / "state/early-detection-free-source-state-v14.json"
V14_EVENTS = ROOT / "state/early-detection-free-source-events-v14.jsonl"
V15_CONTROLLER = ROOT / "scripts/early-detection-continuous-free-source-v15.py"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BASE_COMMIT = "c57a00e29c5bfbcd7be8496bd5bee64bdf1b676f"
EXPECTED_CONTRACT_RAW = "5814a37795ac02095dc68f7ac75f0a6d43e14c6b15851f6360224980f1b07a7c"
EXPECTED_CONTROLLER_NORMALIZED = "672eacd25459f73e5a5edf25570c3404df6aa5c21651b5d7c1a0ab8c7dd27b2c"
EXPECTED_TEST_NORMALIZED = "02021a6d8999c72d0a8725997b1e8bbbd64910edc90139a61d738313d7876354"
EXPECTED_EVENTS_RAW = "6a8913a5b3477291cfe7eaa71b7f868f2c96faf956b07378b12ef861cd141aae"
EXPECTED_STATE_RAW = "fbd2129a2e2c4aa5eb479412cb493529942d0552d5b310fccc243ffe357725f2"
EXPECTED_STATE_SELF = "1c8c080ea5b1ec16742d195a8be464e8f47efc44f5aee52c3d7d99c316d7d326"
EXPECTED_PROJECTION_SHA = "4616098cded1347f856de4c62f49f7e37adcc87b587e546e8e0c1a2e94ca0fb1"

AUTHORIZED = [
    "research/early-detection-v4/continuous-free-source-operational-state-contract-v16.json",
    "scripts/early-detection-continuous-free-source-v16.py",
    "state/early-detection-free-source-events-v16.jsonl",
    "state/early-detection-free-source-state-v16.json",
    "tests/early-detection-continuous-free-source-v16.test.js",
]
INPUT_PATHS = {
    "policy": "research/early-detection-v4/continuous-free-source-policy-v1.md",
    "queueSeed": "research/early-detection-v4/continuous-free-source-queue-seed-v1.json",
    "registry": "research/early-detection-v4/continuous-free-source-registry-v1.json",
    "v14Contract": "research/early-detection-v4/continuous-free-source-operational-state-contract-v14.json",
    "v14Controller": "scripts/early-detection-continuous-free-source-v14.py",
    "v14ControllerTest": "tests/early-detection-continuous-free-source-v14.test.js",
    "v14EventLog": "state/early-detection-free-source-events-v14.jsonl",
    "v14State": "state/early-detection-free-source-state-v14.json",
    "v15Contract": "research/early-detection-v4/continuous-free-source-operational-controller-contract-v15.json",
    "v15Controller": "scripts/early-detection-continuous-free-source-v15.py",
    "v15ControllerTest": "tests/early-detection-continuous-free-source-v15.test.js",
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
    {"tag":868,"commit":"394b3b6bd43a20306286cf766fa6f3aaf69cc6ca","parent":"eca62f4260e940eff70ab8f17ada26c1fd57ab48","subject":"Tag 868: Liquidationszahlungen eng versiegeln","workstream":"Q003_LIQUIDATION_PAYMENT_EVIDENCE_CONTRACT","artifactCount":3,"deltaSha256":"ca3c2ee1ed38155f8b7d66fc3f2ad6b7c5098cbddb19f5ba851f8ae285e89d9c","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
    {"tag":869,"commit":"b7bda025a01924bab82c252ea33a399ad0cdf966","parent":"394b3b6bd43a20306286cf766fa6f3aaf69cc6ca","subject":"Tag 869: Controller-Lineage ueber Folgetags erhalten","workstream":"CONTROLLER_LINEAGE_V15","artifactCount":3,"deltaSha256":"662f5daceec8accf3d4167588357a2be49066cc40cb5479a23a8348b6dfdddd8","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
    {"tag":870,"commit":"c14000778ee1b98405eb81c8b36930eb869dc3b1","parent":"b7bda025a01924bab82c252ea33a399ad0cdf966","subject":"Tag 870: Liquidationsbericht write-new absichern","workstream":"Q003_LIQUIDATION_PAYMENT_OUTPUT_CONTRACT","artifactCount":3,"deltaSha256":"1f356b22219b7cae75b0705fbd17a94eb8019e560817a36dd530cd8ed3450997","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
    {"tag":871,"commit":"623baf8d15f884ec791de96090da43a9c5f29ba4","parent":"c14000778ee1b98405eb81c8b36930eb869dc3b1","subject":"Tag 871: Liquidationszahlungsbelege materialisieren","workstream":"Q003_LIQUIDATION_PAYMENT_OUTPUT","artifactCount":1,"deltaSha256":"b8fbde546bb8f0347022a92c40ed28e1467cdd8e4a436ec04fa1eb47cf6221b3","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
    {"tag":872,"commit":"de137118554621bbfb2556c69e226ef14ec110a8","parent":"623baf8d15f884ec791de96090da43a9c5f29ba4","subject":"Tag 872: Liquidationsbericht dauerhaft verifizieren","workstream":"Q003_LIQUIDATION_PAYMENT_OUTPUT_SEAL","artifactCount":3,"deltaSha256":"1c36a6b11be70ab6a9971a61788e30ff0209f2dabf2219c9fec1df8fcc3a727f","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
    {"tag":873,"commit":"cb95704a6d989e6595908056c1b4e5d686cc519d","parent":"de137118554621bbfb2556c69e226ef14ec110a8","subject":"Tag 873: Form-25-Suspendierungsgrenzen versiegeln","workstream":"Q003_Q005_SUSPENSION_BOUNDARY_V1_SUPERSEDED","artifactCount":3,"deltaSha256":"d753c6547bef8a6eaa9b426c316dd780092d4113e950406ecabbb86614c36432","status":"SUPERSEDED_OPERATIONAL_ATTEMPT_NO_CREDIT"},
    {"tag":874,"commit":"a9c1e4b6732e693cecb1bb811e39177ee9707c46","parent":"cb95704a6d989e6595908056c1b4e5d686cc519d","subject":"Tag 874: Form-25-Aussetzungsgrenze V2 versiegeln","workstream":"Q003_Q005_SUSPENSION_BOUNDARY_V2_CONTRACT","artifactCount":3,"deltaSha256":"c04589b5ef556455d610a7b749d692fa3db522ae36332a49d3c53f74c3f4e6b9","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
    {"tag":875,"commit":"609f37df9e9c277323c5c8e24d6accfa3d1f3ea7","parent":"a9c1e4b6732e693cecb1bb811e39177ee9707c46","subject":"Tag 875: Form-25-Aussetzungsgrenzen materialisieren","workstream":"Q003_Q005_SUSPENSION_BOUNDARY_V2_OUTPUT","artifactCount":1,"deltaSha256":"f214aae16aea4fbadc44d58e856a6eff5b908ea22ae42cbc1f5c04b7c61b45fe","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
    {"tag":876,"commit":"cc99700b90290c3fd56f7a5b92cf767d281bf585","parent":"609f37df9e9c277323c5c8e24d6accfa3d1f3ea7","subject":"Tag 876: SEC-FINRA-Symbolbruecke als Nullbefund versiegeln","workstream":"Q003_Q005_SEC_FINRA_EXACT_SYMBOL_BRIDGE_NULL","artifactCount":3,"deltaSha256":"06e5ba33287e545a7f7840c4d3ad4003402091a4088798b2145aa752787e0d47","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
    {"tag":877,"commit":"c57a00e29c5bfbcd7be8496bd5bee64bdf1b676f","parent":"cc99700b90290c3fd56f7a5b92cf767d281bf585","subject":"Tag 877: SEC-Liquidationszahlungen mit Aussetzungsgrenzen abgleichen","workstream":"Q003_LIQUIDATION_PAYMENT_BOUNDARY_RECONCILIATION","artifactCount":3,"deltaSha256":"4d71d980aff2edc31f609a3f4b13388bfdfb1dc03871a8de395ce4526af20a06","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
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
        fail("V16 contract raw bytes changed")
    value = json.loads(raw)
    body = copy.deepcopy(value)
    claim = body.get("contractSelfSha256")
    body["contractSelfSha256"] = None
    if claim != sha(canonical(body)):
        fail("V16 contract self hash changed")
    exact_keys(value, {"schema","createdAt","track","purpose","contractSelfSha256","repository","inputs","milestoneBindings","implementation","outputs","replayContract","scientificLocks"}, "contract")
    if value["schema"] != "early-detection-continuous-free-source-operational-state-contract/v16" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    if value["createdAt"] != "2026-08-13T07:07:34Z" or datetime.fromisoformat(value["createdAt"].replace("Z", "+00:00")) > datetime.now(timezone.utc):
        fail("contract timeline changed")
    if value["purpose"] != "Append Tags868-877 as exact no-credit operational milestones, preserve the byte-exact V14 event history and release Q003 scheduling only after deterministic replay and exact remote introduction.":
        fail("contract purpose changed")
    repository = value["repository"]
    if repository != {"remote":REMOTE,"ref":REF,"buildBaseCommit":BASE_COMMIT,"buildBaseTag":877,"introductionMustBeDirectSingleParentChild":True,"introductionAddsExactlyAuthorizedPaths":True,"authorizedPaths":AUTHORIZED}:
        fail("repository contract changed")
    exact_keys(value["inputs"], {"rawSha256","inputBundleSha256","inputBundleRecomputedFromBaseRawHashesAndMilestoneDeltas","v14EventLogMustBeByteExactPrefix","v15ControllerMustVerifyRemoteBeforeImportCredit"}, "inputs")
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
        if outputs != {"eventLogPath":AUTHORIZED[2],"eventLogRawSha256":EXPECTED_EVENTS_RAW,"eventCount":4,"lastEventSha256":parse_events(EVENTS.read_bytes())[-1]["eventSha256"],"statePath":AUTHORIZED[3],"stateRawSha256":EXPECTED_STATE_RAW,"stateSelfSha256":EXPECTED_STATE_SELF,"operationalProjectionSha256":EXPECTED_PROJECTION_SHA}:
            fail("output binding changed")
    expected_replay = {"lastEventCarriesCompleteOperationalProjection":True,"stateMustBeDeterministicallyMaterializedFromEvents":True,"v14EventLogMustBeByteExactPrefix":True,"taskCountsMustBeRecomputedFromTasks":True,"eligibleQueueMustBeRecomputedFromTasks":True,"nextTaskMustBeHighestPriorityEligibleTask":True,"milestoneDeltasMustBeRecomputedFromGitObjects":True,"nextRequiresRemotePostIntroduction":True,"verifyWithoutRemoteMustFail":True,"preIntroductionVerifyIsDiagnosticOnly":True}
    if value["replayContract"] != expected_replay or value["scientificLocks"] != expected_scientific_contract_locks():
        fail("replay or scientific locks changed")
    return value


def expected_scientific_contract_locks() -> dict:
    return {"originalV4GreenOfficialGates":2,"originalV4OfficialGateCount":13,"originalV4Complete":False,"originalV4GateCredit":False,"identityResolved":False,"terminalWealthComplete":False,"fiveRequiredDataSemanticsComplete":False,"resultComputationAllowed":False,"pricesAccessed":False,"returnsAccessed":False,"outcomesAccessed":False}


def parse_events(raw: bytes) -> list[dict]:
    rows = [json.loads(line) for line in raw.decode().splitlines() if line]
    if len(rows) != 4:
        fail("event count changed")
    for index, row in enumerate(rows):
        claim = row.get("eventSha256")
        body = copy.deepcopy(row)
        body.pop("eventSha256", None)
        if claim != sha(canonical(body)) or row.get("sequence") != index + 1:
            fail("event self hash or sequence changed")
        if row.get("previousEventSha256") != (None if index == 0 else rows[index - 1]["eventSha256"]):
            fail("event hash chain changed")
    if rows[-1].get("eventType") != "OPERATIONAL_MILESTONES_TAG868_TAG877_RECONCILED":
        fail("V16 replay event changed")
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
    previous = "eca62f4260e940eff70ab8f17ada26c1fd57ab48"
    for row in contract["milestoneBindings"]:
        if row["parent"] != previous or git("show", "-s", "--format=%P", row["commit"]).split() != [previous]:
            fail("milestone single-parent chain changed")
        if row["tag"] != 876 and git("show", "-s", "--format=%s", row["commit"]) != row["subject"]:
            fail("milestone subject changed")
        if row["tag"] == 876 and not git("show", "-s", "--format=%s", row["commit"]).startswith("Tag 876: SEC-FINRA-Symbolbr"):
            fail("milestone subject changed")
        artifacts, digest = milestone_delta(row["commit"])
        if len(artifacts) != row["artifactCount"] or digest != row["deltaSha256"]:
            fail("milestone artifact delta changed")
        for artifact in artifacts:
            if git_raw(BASE_COMMIT, artifact["path"]) != git_raw(row["commit"], artifact["path"]):
                fail("milestone artifact drifted by Tag877")
        milestone_deltas.append(row["deltaSha256"])
        previous = row["commit"]
    if previous != BASE_COMMIT:
        fail("milestone range does not end at build base")
    bundle = sha(canonical({"baseCommit":BASE_COMMIT,"inputRawSha256":actual,"milestoneDeltaSha256":milestone_deltas}))
    if bundle != contract["inputs"]["inputBundleSha256"]:
        fail("input bundle changed")
    return actual, bundle


def expected_projection(contract: dict) -> dict:
    previous = json.loads(V14_STATE.read_bytes())["operationalProjection"]
    result = copy.deepcopy(previous)
    by_id = {task["taskId"]: task for task in result["tasks"]}
    by_id["Q003-SEC-TERMINAL-WEALTH-QUEUE"]["milestoneRefs"] += [868,870,871,872,874,875,876,877]
    by_id["Q005-US-EXCHANGE-PUBLIC-CATALOGS"]["milestoneRefs"] += [874,875,876]
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
    if len(projection["operationalMilestones"]) != 20:
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
    v14 = json.loads(V14_STATE.read_bytes())
    if last["inputBundleSha256"] != bundle or payload["baseCommit"] != BASE_COMMIT or payload["repositoryRemote"] != REMOTE:
        fail("event input or repository changed")
    if payload["sourceEventLogRawSha256"] != input_raw["v14EventLog"] or payload["sourceStateRawSha256"] != input_raw["v14State"] or payload["sourceStateSelfSha256"] != v14["stateSha256"]:
        fail("event predecessor binding changed")
    if payload["sourceLastEventSha256"] != events[-2]["eventSha256"] or payload["noScientificCredit"] is not True or payload["outcomesAccessed"] is not False:
        fail("event chain or scientific boundary changed")
    projection = payload["operationalProjection"]
    if payload["operationalProjectionSha256"] != sha(canonical(projection)):
        fail("event projection hash changed")
    validate_projection(projection, contract)
    state = {
        "schema":"early-detection-free-source-operational-state/v16",
        "materializedAt":last["createdAt"],
        "track":"SHARED_OUTCOME_BLIND_INFRA",
        "purpose":"Deterministically replay Tags868-877 as outcome-blind no-credit milestones while preserving Q001-Q010 and remote-gated Q003 scheduling.",
        "repository":{"remote":REMOTE,"ref":REF,"buildBaseCommit":BASE_COMMIT,"buildBaseTag":877},
        "inputBundleSha256":bundle,
        "inputRawSha256":input_raw,
        "predecessor":{"version":14,"contractPath":INPUT_PATHS["v14Contract"],"contractRawSha256":input_raw["v14Contract"],"controllerPath":INPUT_PATHS["v14Controller"],"controllerRawSha256":input_raw["v14Controller"],"eventLogPath":INPUT_PATHS["v14EventLog"],"eventLogRawSha256":input_raw["v14EventLog"],"statePath":INPUT_PATHS["v14State"],"stateRawSha256":input_raw["v14State"],"stateSelfSha256":v14["stateSha256"],"lastEventSha256":events[-2]["eventSha256"],"appendOnly":True,"semanticStatus":"SUPERSEDED_BY_TAG868_TAG877_RECONCILED_V16"},
        "controllerPredecessor":{"version":15,"contractPath":INPUT_PATHS["v15Contract"],"contractRawSha256":input_raw["v15Contract"],"controllerPath":INPUT_PATHS["v15Controller"],"controllerRawSha256":input_raw["v15Controller"],"testPath":INPUT_PATHS["v15ControllerTest"],"testRawSha256":input_raw["v15ControllerTest"],"remoteVerificationRequired":True},
        "eventLog":{"path":AUTHORIZED[2],"eventCount":4,"rawSha256":sha(event_raw),"lastEventSha256":last["eventSha256"],"v14ByteExactPrefix":True,"hashChainVerified":True,"fullProjectionCarriedByLastEvent":True},
        "operationalProjection":projection,
    }
    state["stateSha256"] = sha(canonical(state))
    return state


def verify_v15_remote() -> None:
    raw = V15_CONTROLLER.read_bytes()
    if sha(raw) != load_contract()["inputs"]["rawSha256"]["v15Controller"]:
        fail("V15 controller changed before import")
    namespace = {"__name__":"v15_bound","__file__":str(V15_CONTROLLER)}
    exec(compile(raw, str(V15_CONTROLLER), "exec"), namespace)
    result = namespace["verify"](True)
    if result.get("status") != "PASS" or result.get("nextTaskId") != "Q003-SEC-TERMINAL-WEALTH-QUEUE" or result.get("outcomesAccessed") is not False:
        fail("V15 remote predecessor verification failed")


def introduction_phase(head: str) -> tuple[str, str | None]:
    present = [path for path in AUTHORIZED if git_exists(head, path)]
    if not present:
        return "PRE_INTRODUCTION", None
    if present != AUTHORIZED:
        fail("partial V16 introduction")
    introductions = {git("log", "--diff-filter=A", "-1", "--format=%H", "--", path) for path in AUTHORIZED}
    if len(introductions) != 1:
        fail("V16 paths were not introduced together")
    introduction = introductions.pop()
    if git("show", "-s", "--format=%P", introduction).split() != [BASE_COMMIT]:
        fail("V16 introduction is not direct single-parent child of Tag877")
    if git("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines() != [f"A\t{path}" for path in AUTHORIZED]:
        fail("V16 introduction is not exactly five additions")
    chain = git("rev-list", "--first-parent", head).splitlines()
    if introduction not in chain:
        fail("V16 introduction missing from first-parent history")
    for commit in chain[:chain.index(introduction)]:
        if len(git("show", "-s", "--format=%P", commit).split()) != 1:
            fail("non-linear descendant after V16 introduction")
    for path in AUTHORIZED:
        if git("log", "-1", "--format=%H", "--", path) != introduction or git_raw(head, path) != (ROOT / path).read_bytes():
            fail("V16 Git/worktree bytes drifted")
    return "POST_INTRODUCTION", introduction


def verify(remote: bool) -> dict:
    if not remote:
        fail("remote verification is mandatory")
    contract = load_contract()
    input_raw, bundle = verify_inputs_and_milestones(contract)
    event_raw = EVENTS.read_bytes()
    state_raw = STATE.read_bytes()
    if sha(event_raw) != EXPECTED_EVENTS_RAW or sha(state_raw) != EXPECTED_STATE_RAW or not event_raw.startswith(V14_EVENTS.read_bytes()):
        fail("V16 output bytes or V14 prefix changed")
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
    verify_v15_remote()
    phase, introduction = introduction_phase(head)
    schedule = validate_projection(actual_state["operationalProjection"], contract)
    return {"schema":"early-detection-free-source-operational-state-verification/v16","status":"PASS" if phase == "POST_INTRODUCTION" else "PRE_INTRODUCTION_DIAGNOSTIC","phase":phase,"introductionCommit":introduction,"controllerResumeAllowed":phase == "POST_INTRODUCTION","eventCount":4,"operationalMilestones":20,"newMilestones":10,"tasksConserved":10,"resolvedTasks":0,"eligibleTasks":len(schedule["eligibleTaskIds"]),"nextTaskId":schedule["nextTaskId"],"q002AutoNext":False,"originalV4GreenOfficialGates":2,"originalV4OfficialGateCount":13,"v14PrefixVerified":True,"milestoneGitDeltasVerified":10,"v15RemoteVerified":True,"remoteVerified":True,"outcomesAccessed":False}


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
        "milestoneCredit":lambda x:x["operationalMilestones"][10].__setitem__("status","SCIENTIFIC_CREDIT_GRANTED"),
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
    return {"schema":"early-detection-free-source-operational-state-self-test/v16","status":"PASS","killCount":len(kills),"kills":kills,"outcomesAccessed":False}


def load_contract_semantics(value: dict) -> None:
    if value["purpose"] != "Append Tags868-877 as exact no-credit operational milestones, preserve the byte-exact V14 event history and release Q003 scheduling only after deterministic replay and exact remote introduction.":
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
                    fail("next is forbidden before remote V16 introduction")
                result = {"schema":"early-detection-free-source-next/v16","status":"PASS","nextTaskId":result["nextTaskId"],"remoteVerified":True,"postIntroductionVerified":True,"q002AutoNext":False,"outcomesAccessed":False}
    except (StateError,OSError,KeyError,TypeError,ValueError,json.JSONDecodeError,subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
