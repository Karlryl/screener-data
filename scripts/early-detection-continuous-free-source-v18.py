#!/usr/bin/env python3
"""Replay-only, remote-gated controller for the append-only V18 state."""

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
CONTRACT = ROOT / "research/early-detection-v4/continuous-free-source-operational-state-contract-v18.json"
EVENTS = ROOT / "state/early-detection-free-source-events-v18.jsonl"
STATE = ROOT / "state/early-detection-free-source-state-v18.json"
V17_STATE = ROOT / "state/early-detection-free-source-state-v17.json"
V17_EVENTS = ROOT / "state/early-detection-free-source-events-v17.jsonl"
V17_CONTROLLER = ROOT / "scripts/early-detection-continuous-free-source-v17.py"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BASE_COMMIT = "2162514ba1235c233515ff651831e0beb5fc1883"
EXPECTED_CONTRACT_RAW = "37bf21c8a80c9904c1dc93a8729af8e757a934f9f6b87922389ac4a206f92492"
EXPECTED_CONTROLLER_NORMALIZED = "d23be82907248490576b8ec357c3f8c0a3fe71e5e2d39b573c026ab7f1a56b55"
EXPECTED_TEST_NORMALIZED = "fcb59960459ebcd2156e9375d5cc6fd7d2ba0ffca10e7c1b1e004d869eaf7058"
EXPECTED_EVENTS_RAW = "715514032dd5cfd7fa570dc3e47a96d2be46ead4a8a969e14cb5c05521d6c01f"
EXPECTED_STATE_RAW = "0d2b92c5b6ced877593878dba5cdd40d4690b4081ed83bb5d12f000ac2304f43"
EXPECTED_STATE_SELF = "b2bde4af82e9012dcc807787bb72ae587ea434445428947f880df57da71d25e0"
EXPECTED_PROJECTION_SHA = "dde9fb903ea61408c7b6840699cffc02a645a6195c0837842c0b4507a761b970"

AUTHORIZED = [
    "research/early-detection-v4/continuous-free-source-operational-state-contract-v18.json",
    "scripts/early-detection-continuous-free-source-v18.py",
    "state/early-detection-free-source-events-v18.jsonl",
    "state/early-detection-free-source-state-v18.json",
    "tests/early-detection-continuous-free-source-v18.test.js",
]
INPUT_PATHS = {
    "policy": "research/early-detection-v4/continuous-free-source-policy-v1.md",
    "queueSeed": "research/early-detection-v4/continuous-free-source-queue-seed-v1.json",
    "registry": "research/early-detection-v4/continuous-free-source-registry-v1.json",
    "v17Contract": "research/early-detection-v4/continuous-free-source-operational-state-contract-v17.json",
    "v17Controller": "scripts/early-detection-continuous-free-source-v17.py",
    "v17ControllerTest": "tests/early-detection-continuous-free-source-v17.test.js",
    "v17EventLog": "state/early-detection-free-source-events-v17.jsonl",
    "v17State": "state/early-detection-free-source-state-v17.json",
    "coverageContract": "research/early-detection-v4/sec-terminal-wealth-evidence-coverage-ledger-contract-v1.json",
    "coverageBuilder": "scripts/build-sec-terminal-wealth-evidence-coverage-ledger-v1.py",
    "coverageTest": "tests/build-sec-terminal-wealth-evidence-coverage-ledger-v1.test.js",
    "coverageOutput": "reports/early-detection/sec-terminal-wealth-evidence-coverage-ledger-v1.json",
    "sourceDecisionContract": "research/early-detection-v4/consolidated-adjusted-ohlcv-zero-cost-source-decision-contract-v1.json",
    "sourceDecisionVerifier": "scripts/verify-consolidated-adjusted-ohlcv-zero-cost-source-decision-v1.py",
    "sourceDecisionTest": "tests/verify-consolidated-adjusted-ohlcv-zero-cost-source-decision-v1.test.js",
    "tiingoPilotContract": "research/early-detection-v4/tiingo-starter-eod-three-case-private-pilot-contract-v2.json",
    "tiingoPilotRunner": "scripts/run-tiingo-starter-eod-three-case-private-pilot-v2.py",
    "tiingoPilotTest": "tests/run-tiingo-starter-eod-three-case-private-pilot-v2.test.js",
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
    {"tag":883,"commit":"7ed38d08b706ec2ff8e55db82412ff4bf4807946","parent":"096793e785ff093773bb124df8c204d9043ab469","subject":"Tag 883: Q003-Evidenzluecken vollstaendig projizieren","workstream":"Q003_EVIDENCE_COVERAGE_LEDGER_CONTRACT","artifactCount":3,"deltaSha256":"aff407858350333866e26f3b9070049ec886cf4cb4aa35506f172dd58335a8dc","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
    {"tag":884,"commit":"020c54d4e02f8a754e4b5a79b845ae2a4244e7f8","parent":"7ed38d08b706ec2ff8e55db82412ff4bf4807946","subject":"Tag 884: Q003-Evidenzmatrix materialisieren","workstream":"Q003_EVIDENCE_COVERAGE_LEDGER_OUTPUT","artifactCount":1,"deltaSha256":"d9d405e7fefda413b056b6b18f5cbafb1f319a23f07fb3b9f0f5ea4672e58cff","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
    {"tag":885,"commit":"1b812c7e81d01895d6a0a696a9aba303bfdd79f7","parent":"020c54d4e02f8a754e4b5a79b845ae2a4244e7f8","subject":"Tag 885: Gratis-OHLCV-Quellenentscheid versiegeln","workstream":"Q003_Q006_ZERO_COST_OHLCV_SOURCE_DECISION","artifactCount":3,"deltaSha256":"419297b8566ddde47d5a574959a383a80901654d50417cb718cdf9dd0655ad8a","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
    {"tag":886,"commit":"034b279eb39ec2ac9e5b85dddf237677d0769767","parent":"1b812c7e81d01895d6a0a696a9aba303bfdd79f7","subject":"Tag 886: Privaten Tiingo-Dreifallpilot vorbereiten","workstream":"Q006_TIINGO_PRIVATE_PILOT_V1_TRUNCATED","artifactCount":3,"deltaSha256":"042d66e805f2fe23718e9126e93dafe80ca8c0cfe0c99719442a58f2349b7f82","status":"SUPERSEDED_OPERATIONAL_ATTEMPT_NO_CREDIT"},
    {"tag":887,"commit":"2162514ba1235c233515ff651831e0beb5fc1883","parent":"034b279eb39ec2ac9e5b85dddf237677d0769767","subject":"Tag 887: Tiingo-Pilotrunner append-only reparieren","workstream":"Q006_TIINGO_PRIVATE_PILOT_V2_REPAIR","artifactCount":3,"deltaSha256":"f5ae99d93313bcb99d5f97ef4de2b8ab21e745d7c57e23e13812eb5eef165150","status":"OPERATIONAL_MILESTONE_NO_CREDIT"},
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
        fail("V18 contract raw bytes changed")
    value = json.loads(raw)
    body = copy.deepcopy(value)
    claim = body.get("contractSelfSha256")
    body["contractSelfSha256"] = None
    if claim != sha(canonical(body)):
        fail("V18 contract self hash changed")
    exact_keys(value, {"schema","createdAt","track","purpose","contractSelfSha256","repository","inputs","milestoneBindings","implementation","outputs","replayContract","scientificLocks"}, "contract")
    if value["schema"] != "early-detection-continuous-free-source-operational-state-contract/v18" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    if value["createdAt"] != "2026-08-13T10:27:22Z" or datetime.fromisoformat(value["createdAt"].replace("Z", "+00:00")) > datetime.now(timezone.utc):
        fail("contract timeline changed")
    if value["purpose"] != "Append Tags883-887 as exact no-credit evidence-coverage, zero-cost OHLCV disposition and private Tiingo pilot milestones, preserve byte-exact V17 history, and keep Q003 open until all five semantics are actually resolved.":
        fail("contract purpose changed")
    repository = value["repository"]
    if repository != {"remote":REMOTE,"ref":REF,"buildBaseCommit":BASE_COMMIT,"buildBaseTag":887,"introductionMustBeDirectSingleParentChild":True,"introductionAddsExactlyAuthorizedPaths":True,"authorizedPaths":AUTHORIZED}:
        fail("repository contract changed")
    exact_keys(value["inputs"], {"rawSha256","inputBundleSha256","inputBundleRecomputedFromBaseRawHashesAndMilestoneDeltas","v17EventLogMustBeByteExactPrefix","v17ControllerMustVerifyRemoteBeforeImportCredit","consumerArtifactsMustVerifyRemoteBeforeImportCredit"}, "inputs")
    if value["inputs"]["consumerArtifactsMustVerifyRemoteBeforeImportCredit"] is not True:
        fail("consumer verification gate changed")
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
        if outputs != {"eventLogPath":AUTHORIZED[2],"eventLogRawSha256":EXPECTED_EVENTS_RAW,"eventCount":6,"lastEventSha256":parse_events(EVENTS.read_bytes())[-1]["eventSha256"],"statePath":AUTHORIZED[3],"stateRawSha256":EXPECTED_STATE_RAW,"stateSelfSha256":EXPECTED_STATE_SELF,"operationalProjectionSha256":EXPECTED_PROJECTION_SHA}:
            fail("output binding changed")
    expected_replay = {"lastEventCarriesCompleteOperationalProjection":True,"stateMustBeDeterministicallyMaterializedFromEvents":True,"v17EventLogMustBeByteExactPrefix":True,"taskCountsMustBeRecomputedFromTasks":True,"eligibleQueueMustBeRecomputedFromTasks":True,"nextTaskMustBeHighestPriorityEligibleTask":True,"milestoneDeltasMustBeRecomputedFromGitObjects":True,"nextRequiresRemotePostIntroduction":True,"verifyWithoutRemoteMustFail":True,"preIntroductionVerifyIsDiagnosticOnly":True}
    if value["replayContract"] != expected_replay or value["scientificLocks"] != expected_scientific_contract_locks():
        fail("replay or scientific locks changed")
    return value


def expected_scientific_contract_locks() -> dict:
    return {"originalV4GreenOfficialGates":2,"originalV4OfficialGateCount":13,"originalV4Complete":False,"originalV4GateCredit":False,"identityResolved":False,"terminalWealthComplete":False,"fiveRequiredDataSemanticsComplete":False,"resultComputationAllowed":False,"pricesAccessed":False,"returnsAccessed":False,"outcomesAccessed":False}


def parse_events(raw: bytes) -> list[dict]:
    rows = [json.loads(line) for line in raw.decode().splitlines() if line]
    if len(rows) != 6:
        fail("event count changed")
    for index, row in enumerate(rows):
        claim = row.get("eventSha256")
        body = copy.deepcopy(row)
        body.pop("eventSha256", None)
        if claim != sha(canonical(body)) or row.get("sequence") != index + 1:
            fail("event self hash or sequence changed")
        if row.get("previousEventSha256") != (None if index == 0 else rows[index - 1]["eventSha256"]):
            fail("event hash chain changed")
    if rows[-1].get("eventType") != "OPERATIONAL_MILESTONES_TAG883_TAG887_RECONCILED":
        fail("V18 replay event changed")
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
    previous = "096793e785ff093773bb124df8c204d9043ab469"
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
                fail("milestone artifact drifted by Tag887")
        milestone_deltas.append(row["deltaSha256"])
        previous = row["commit"]
    if previous != BASE_COMMIT:
        fail("milestone range does not end at build base")
    bundle = sha(canonical({"baseCommit":BASE_COMMIT,"inputRawSha256":actual,"milestoneDeltaSha256":milestone_deltas}))
    if bundle != contract["inputs"]["inputBundleSha256"]:
        fail("input bundle changed")
    return actual, bundle


def expected_projection(contract: dict) -> dict:
    previous = json.loads(V17_STATE.read_bytes())["operationalProjection"]
    result = copy.deepcopy(previous)
    by_id = {task["taskId"]: task for task in result["tasks"]}
    by_id["Q003-SEC-TERMINAL-WEALTH-QUEUE"]["milestoneRefs"] += [883,884,885]
    by_id["Q003-SEC-TERMINAL-WEALTH-QUEUE"]["nextAction"] = "CONTINUE_PRIMARY_DOCUMENT_IDENTITY_CORPORATE_ACTION_AND_TERMINAL_RECONCILIATION_WITH_ZERO_RESOLVED_SEMANTICS_AND_CONFIRMED_OHLCV_EXTERNAL_BLOCKER"
    by_id["Q006-TIINGO-FREE-ENTITLEMENT"]["milestoneRefs"] += [886,887]
    by_id["Q006-TIINGO-FREE-ENTITLEMENT"]["nextAction"] = "WAIT_FOR_FREE_TIINGO_STARTER_ACCOUNT_AND_WINDOWS_CREDENTIAL_BINDING_THEN_RUN_EXACT_PRIVATE_THREE_CASE_PILOT"
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
    if len(projection["operationalMilestones"]) != 28:
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
    exact_keys(payload, {"baseCommit","milestoneRange","repositoryRemote","sourceEventLogRawSha256","sourceStateRawSha256","sourceStateSelfSha256","sourceLastEventSha256","replacementStatePath","supersessionReasonCode","v18EventCarriesCompleteOperationalProjection","consumerVerification","noScientificCredit","outcomesAccessed","operationalProjectionSha256","operationalProjection"}, "event payload")
    if payload["milestoneRange"] != {"firstTag":883,"lastTag":887,"count":5,"allNoCredit":True} or payload["replacementStatePath"] != AUTHORIZED[3] or payload["supersessionReasonCode"] != "V17_POINTER_PREDATES_TAG883_TAG887_OPERATIONAL_MILESTONES" or payload["v18EventCarriesCompleteOperationalProjection"] is not True:
        fail("event milestone range or supersession changed")
    v17 = json.loads(V17_STATE.read_bytes())
    if last["inputBundleSha256"] != bundle or payload["baseCommit"] != BASE_COMMIT or payload["repositoryRemote"] != REMOTE:
        fail("event input or repository changed")
    if payload["sourceEventLogRawSha256"] != input_raw["v17EventLog"] or payload["sourceStateRawSha256"] != input_raw["v17State"] or payload["sourceStateSelfSha256"] != v17["stateSha256"]:
        fail("event predecessor binding changed")
    if payload["sourceLastEventSha256"] != events[-2]["eventSha256"] or payload["noScientificCredit"] is not True or payload["outcomesAccessed"] is not False:
        fail("event chain or scientific boundary changed")
    expected_consumer = {"coverage":{"queueRows":44352,"targetSemanticCells":221760,"resolvedSemanticCells":0,"partialEvidenceSemanticCells":12875,"consolidatedAdjustedOhlcvPartialEvidenceRows":0},"sourceDecision":{"independentBlockerChecks":3,"fullUniverseAcquisitionAuthorized":False,"consolidatedAdjustedOhlcvResolved":False},"tiingoPilot":{"version":2,"productionRequestsExecuted":False,"studyCredit":"NONE","accountGatePending":True}}
    if payload["consumerVerification"] != expected_consumer:
        fail("consumer verification evidence changed")
    projection = payload["operationalProjection"]
    if payload["operationalProjectionSha256"] != sha(canonical(projection)):
        fail("event projection hash changed")
    validate_projection(projection, contract)
    state = {
        "schema":"early-detection-free-source-operational-state/v18",
        "materializedAt":last["createdAt"],
        "track":"SHARED_OUTCOME_BLIND_INFRA",
        "purpose":"Deterministically replay Tags883-887 as outcome-blind no-credit evidence-coverage, OHLCV-source-decision and private-pilot milestones while keeping Q003 unresolved and Q006 account-deferred.",
        "repository":{"remote":REMOTE,"ref":REF,"buildBaseCommit":BASE_COMMIT,"buildBaseTag":887},
        "inputBundleSha256":bundle,
        "inputRawSha256":input_raw,
        "predecessor":{"version":17,"contractPath":INPUT_PATHS["v17Contract"],"contractRawSha256":input_raw["v17Contract"],"controllerPath":INPUT_PATHS["v17Controller"],"controllerRawSha256":input_raw["v17Controller"],"testPath":INPUT_PATHS["v17ControllerTest"],"testRawSha256":input_raw["v17ControllerTest"],"eventLogPath":INPUT_PATHS["v17EventLog"],"eventLogRawSha256":input_raw["v17EventLog"],"statePath":INPUT_PATHS["v17State"],"stateRawSha256":input_raw["v17State"],"stateSelfSha256":v17["stateSha256"],"lastEventSha256":events[-2]["eventSha256"],"appendOnly":True,"remoteVerificationRequired":True,"semanticStatus":"SUPERSEDED_BY_TAG883_TAG887_RECONCILED_V18"},
        "eventLog":{"path":AUTHORIZED[2],"eventCount":6,"rawSha256":sha(event_raw),"lastEventSha256":last["eventSha256"],"v17ByteExactPrefix":True,"hashChainVerified":True,"fullProjectionCarriedByLastEvent":True},
        "operationalProjection":projection,
    }
    state["stateSha256"] = sha(canonical(state))
    return state


def verify_v17_remote() -> None:
    raw = V17_CONTROLLER.read_bytes()
    if sha(raw) != load_contract()["inputs"]["rawSha256"]["v17Controller"]:
        fail("V17 controller changed before import")
    namespace = {"__name__":"v17_bound","__file__":str(V17_CONTROLLER)}
    exec(compile(raw, str(V17_CONTROLLER), "exec"), namespace)
    result = namespace["verify"](True)
    if result.get("status") != "PASS" or result.get("nextTaskId") != "Q003-SEC-TERMINAL-WEALTH-QUEUE" or result.get("outcomesAccessed") is not False:
        fail("V17 remote predecessor verification failed")


def run_consumer(path_key: str, command: str) -> dict:
    path = ROOT / INPUT_PATHS[path_key]
    if sha(path.read_bytes()) != load_contract()["inputs"]["rawSha256"][path_key]:
        fail(f"{path_key} changed before execution")
    result = subprocess.run(["python", "-B", str(path), command, "--remote"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        fail(f"{path_key} remote verification failed")
    return json.loads(result.stdout)


def verify_consumers_remote() -> None:
    coverage = run_consumer("coverageBuilder", "verify-output")
    stats = coverage.get("coverage", {})
    if coverage.get("status") != "PASS" or stats.get("queueRows") != 44352 or stats.get("targetSemanticCells") != 221760 or stats.get("resolvedSemanticCells") != 0 or stats.get("partialEvidenceSemanticCells") != 12875 or stats.get("semanticCoverage",{}).get("CONSOLIDATED_ADJUSTED_OHLCV",{}).get("partialEvidenceRows") != 0 or coverage.get("outcomesAccessed") is not False:
        fail("coverage ledger verification changed")
    decision = run_consumer("sourceDecisionVerifier", "verify")
    if decision.get("status") != "PASS" or decision.get("independentBlockerChecks") != 3 or decision.get("fullUniverseAcquisitionAuthorized") is not False or decision.get("consolidatedAdjustedOhlcvResolved") is not False or decision.get("outcomesAccessed") is not False:
        fail("OHLCV source decision changed")
    pilot = run_consumer("tiingoPilotRunner", "verify")
    if pilot.get("status") != "PASS" or pilot.get("pilotMayRunAfterAccountGate") is not True or pilot.get("productionRequestsExecuted") is not False or pilot.get("outcomesAccessed") is not False:
        fail("Tiingo pilot disposition changed")


def introduction_phase(head: str) -> tuple[str, str | None]:
    present = [path for path in AUTHORIZED if git_exists(head, path)]
    if not present:
        return "PRE_INTRODUCTION", None
    if present != AUTHORIZED:
        fail("partial V18 introduction")
    introductions = {git("log", "--diff-filter=A", "-1", "--format=%H", "--", path) for path in AUTHORIZED}
    if len(introductions) != 1:
        fail("V18 paths were not introduced together")
    introduction = introductions.pop()
    if git("show", "-s", "--format=%P", introduction).split() != [BASE_COMMIT]:
        fail("V18 introduction is not direct single-parent child of Tag887")
    if git("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines() != [f"A\t{path}" for path in AUTHORIZED]:
        fail("V18 introduction is not exactly five additions")
    chain = git("rev-list", "--first-parent", head).splitlines()
    if introduction not in chain:
        fail("V18 introduction missing from first-parent history")
    for commit in chain[:chain.index(introduction)]:
        if len(git("show", "-s", "--format=%P", commit).split()) != 1:
            fail("non-linear descendant after V18 introduction")
    for path in AUTHORIZED:
        if git("log", "-1", "--format=%H", "--", path) != introduction or git_raw(head, path) != (ROOT / path).read_bytes():
            fail("V18 Git/worktree bytes drifted")
    return "POST_INTRODUCTION", introduction


def verify(remote: bool) -> dict:
    if not remote:
        fail("remote verification is mandatory")
    contract = load_contract()
    input_raw, bundle = verify_inputs_and_milestones(contract)
    event_raw = EVENTS.read_bytes()
    state_raw = STATE.read_bytes()
    if sha(event_raw) != EXPECTED_EVENTS_RAW or sha(state_raw) != EXPECTED_STATE_RAW or not event_raw.startswith(V17_EVENTS.read_bytes()):
        fail("V18 output bytes or V17 prefix changed")
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
    verify_v17_remote()
    verify_consumers_remote()
    phase, introduction = introduction_phase(head)
    schedule = validate_projection(actual_state["operationalProjection"], contract)
    return {"schema":"early-detection-free-source-operational-state-verification/v18","status":"PASS" if phase == "POST_INTRODUCTION" else "PRE_INTRODUCTION_DIAGNOSTIC","phase":phase,"introductionCommit":introduction,"controllerResumeAllowed":phase == "POST_INTRODUCTION","eventCount":6,"operationalMilestones":28,"newMilestones":5,"tasksConserved":10,"resolvedTasks":0,"eligibleTasks":len(schedule["eligibleTaskIds"]),"nextTaskId":schedule["nextTaskId"],"q002AutoNext":False,"originalV4GreenOfficialGates":2,"originalV4OfficialGateCount":13,"v17PrefixVerified":True,"milestoneGitDeltasVerified":5,"v17RemoteVerified":True,"consumerArtifactsRemoteVerified":3,"remoteVerified":True,"outcomesAccessed":False}


def materialize_pre_introduction() -> dict:
    if git("rev-parse", "HEAD") != BASE_COMMIT or git("rev-parse", "@{u}") != BASE_COMMIT:
        fail("materialization requires exact Tag887 base")
    if EVENTS.read_bytes() != V17_EVENTS.read_bytes() or STATE.read_bytes() != V17_STATE.read_bytes():
        fail("materialization targets are not untouched V17 copies")
    input_raw = {key: sha((ROOT / path).read_bytes()) for key, path in INPUT_PATHS.items()}
    bundle = sha(canonical({"baseCommit":BASE_COMMIT,"inputRawSha256":input_raw,"milestoneDeltaSha256":[row["deltaSha256"] for row in MILESTONE_BINDINGS]}))
    projection = expected_projection({"milestoneBindings":MILESTONE_BINDINGS})
    event = {
        "sequence":6,"eventId":"EVT-00000006","eventType":"OPERATIONAL_MILESTONES_TAG883_TAG887_RECONCILED",
        "createdAt":"2026-08-13T10:27:22Z","agentId":"ROOT-CONTROLLER","fencingToken":0,
        "previousEventSha256":parse_events_v17(V17_EVENTS.read_bytes())[-1]["eventSha256"],"inputBundleSha256":bundle,
        "payload":{
            "baseCommit":BASE_COMMIT,"milestoneRange":{"firstTag":883,"lastTag":887,"count":5,"allNoCredit":True},"repositoryRemote":REMOTE,
            "sourceEventLogRawSha256":input_raw["v17EventLog"],"sourceStateRawSha256":input_raw["v17State"],"sourceStateSelfSha256":json.loads(V17_STATE.read_bytes())["stateSha256"],
            "sourceLastEventSha256":parse_events_v17(V17_EVENTS.read_bytes())[-1]["eventSha256"],"replacementStatePath":AUTHORIZED[3],
            "supersessionReasonCode":"V17_POINTER_PREDATES_TAG883_TAG887_OPERATIONAL_MILESTONES","v18EventCarriesCompleteOperationalProjection":True,
            "consumerVerification":{"coverage":{"queueRows":44352,"targetSemanticCells":221760,"resolvedSemanticCells":0,"partialEvidenceSemanticCells":12875,"consolidatedAdjustedOhlcvPartialEvidenceRows":0},"sourceDecision":{"independentBlockerChecks":3,"fullUniverseAcquisitionAuthorized":False,"consolidatedAdjustedOhlcvResolved":False},"tiingoPilot":{"version":2,"productionRequestsExecuted":False,"studyCredit":"NONE","accountGatePending":True}},
            "noScientificCredit":True,"outcomesAccessed":False,"operationalProjectionSha256":sha(canonical(projection)),"operationalProjection":projection,
        },
    }
    event["eventSha256"] = sha(canonical(event))
    event_raw = V17_EVENTS.read_bytes() + canonical(event) + b"\n"
    events = parse_events(event_raw)
    state = materialize_state({"milestoneBindings":MILESTONE_BINDINGS}, event_raw, events, input_raw, bundle)
    EVENTS.write_bytes(event_raw)
    STATE.write_bytes(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True).encode() + b"\n")
    return {"schema":"early-detection-free-source-operational-state-materialization/v18","status":"PASS","eventRawSha256":sha(event_raw),"stateRawSha256":sha(STATE.read_bytes()),"stateSelfSha256":state["stateSha256"],"projectionSha256":sha(canonical(projection)),"outcomesAccessed":False}


def parse_events_v17(raw: bytes) -> list[dict]:
    rows = [json.loads(line) for line in raw.decode().splitlines() if line]
    if len(rows) != 5:
        fail("V17 predecessor event count changed")
    for index, row in enumerate(rows):
        body = copy.deepcopy(row); claim = body.pop("eventSha256", None)
        if claim != sha(canonical(body)) or row.get("sequence") != index + 1 or row.get("previousEventSha256") != (None if index == 0 else rows[index - 1]["eventSha256"]):
            fail("V17 predecessor event chain changed")
    return rows


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
    return {"schema":"early-detection-free-source-operational-state-self-test/v18","status":"PASS","killCount":len(kills),"kills":kills,"outcomesAccessed":False}


def load_contract_semantics(value: dict) -> None:
    if value["purpose"] != "Append Tags883-887 as exact no-credit evidence-coverage, zero-cost OHLCV disposition and private Tiingo pilot milestones, preserve byte-exact V17 history, and keep Q003 open until all five semantics are actually resolved.":
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
    sub.add_parser("materialize-pre-introduction")
    args = parser.parse_args()
    try:
        if args.command == "self-test": result = self_test()
        elif args.command == "materialize-pre-introduction": result = materialize_pre_introduction()
        else:
            result = verify(args.remote)
            if args.command == "next":
                if result["phase"] != "POST_INTRODUCTION" or result["controllerResumeAllowed"] is not True:
                    fail("next is forbidden before remote V18 introduction")
                result = {"schema":"early-detection-free-source-next/v18","status":"PASS","nextTaskId":result["nextTaskId"],"remoteVerified":True,"postIntroductionVerified":True,"q002AutoNext":False,"outcomesAccessed":False}
    except (StateError,OSError,KeyError,TypeError,ValueError,json.JSONDecodeError,subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
