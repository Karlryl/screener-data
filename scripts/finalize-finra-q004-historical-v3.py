#!/usr/bin/env python3
"""Finalize the completed private FINRA V2 crawl into an aggregate-only V3 manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "finra-q004-historical-finalization-contract-v3.json"
V2_CONTRACT = ROOT / "research" / "early-detection-v4" / "finra-q004-historical-crawl-contract-v2.json"
V2_RUNNER = ROOT / "scripts" / "run-finra-q004-historical-crawl-v2.py"
V2_TEST = ROOT / "tests" / "run-finra-q004-historical-crawl-v2.test.js"
TEST = ROOT / "tests" / "finalize-finra-q004-historical-v3.test.js"
PARTITIONS = ROOT / "reports" / "early-detection" / "finra-q004-partitions-2009-2024-v1.json"
METADATA = ROOT / "reports" / "early-detection" / "finra-q004-otc-daily-list-metadata-v1.json"
CHECKPOINT = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\private-evidence\finra-q004\historical\checkpoint-v2.json")
PRIVATE = CHECKPOINT.parent
OUTPUT = ROOT / "reports" / "early-detection" / "finra-q004-historical-crawl-manifest-v3.json"
REMOTE = "origin"
BRANCH = "codex/early-detection-v4-gates-20260810"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
EXPECTED_CONTRACT_RAW_SHA256 = "99fc6b21ab671f898823756392c7736c6b8a8117e851921d854b3f1d769fea69"
EXPECTED_CONTRACT_SHA256 = "d9496f6a949a91a9a889c85f79160542ca5966b3f54ee717240ad3d2d2b87bb3"
EXPECTED_ACQUISITION = "d51f05feb03460c2c8e7660570815084d576d976"
HEX64 = set("0123456789abcdef")


class StudyError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise StudyError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1_048_576), b""):
            digest.update(block)
    return digest.hexdigest()


def load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_bytes())
    except Exception as exc:
        raise StudyError(f"invalid JSON {path}") from exc
    if not isinstance(value, dict):
        fail("object required")
    return value


def git(*args: str, binary: bool = False) -> bytes | str:
    run = subprocess.run(["git", *args], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if run.returncode:
        fail("git command failed")
    return run.stdout if binary else run.stdout.decode().strip()


def exact_hex(value: Any, length: int) -> bool:
    return isinstance(value, str) and len(value) == length and set(value) <= HEX64


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW_SHA256:
        fail("finalization contract raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("contractSha256", None)
    if claim != EXPECTED_CONTRACT_SHA256 or sha(canonical(body)) != EXPECTED_CONTRACT_SHA256:
        fail("finalization contract self hash changed")
    expected_keys = {
        "schema", "createdAt", "taskId", "sourceId", "track", "purpose", "v2Bindings",
        "checkpointContract", "remoteContract", "outputContract", "claimLocks", "contractSha256",
    }
    if set(value) != expected_keys or value["schema"] != "finra-q004-historical-finalization-contract/v3":
        fail("contract schema changed")
    if value["taskId"] != "Q004-FINRA-OTC-CATALOG" or value["sourceId"] != "FINRA_OTC_PRIMARY" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    v2 = value["v2Bindings"]
    if v2 != {
        "acquisitionCommit": EXPECTED_ACQUISITION,
        "parentCommit": "102bb345568721e950fa9ee3420ef7bbce7414a6",
        "contractPath": "research/early-detection-v4/finra-q004-historical-crawl-contract-v2.json",
        "contractRawSha256": "0bfba1438672513c02402047fd3e9801b254c3cfd7494ee10e9e10cccc4e93ab",
        "runnerPath": "scripts/run-finra-q004-historical-crawl-v2.py",
        "runnerRawSha256": "582ac6d5dd4b432d90ce231c4eb21b32bc9e6f7dfb36f241a99e2f3f248bed4b",
        "testPath": "tests/run-finra-q004-historical-crawl-v2.test.js",
        "testRawSha256": "d84f83ecbc10664c7805435fb7dfc810cdd40669160a4b27fe79d20e668aadbb",
    }:
        fail("V2 binding changed")
    checkpoint = value["checkpointContract"]
    if checkpoint != {
        "privatePath": CHECKPOINT.as_posix(),
        "requiredPartitionCount": 1522,
        "requiredAvailableMinimumDate": "2016-01-18",
        "requiredAvailableMaximumDate": "2024-12-31",
        "requiredDatesSha256": "4b6b991889079d3fbcf92de1a4853988d3eb78ad650ddee50cdbeba8f9381b37",
        "requiredFieldsSha256": "16f599619d5666efa0be18ca4e3e209d5646cc1e4e114dc042eb39156ef4d6d1",
        "requiredImplementationRemoteHead": EXPECTED_ACQUISITION,
        "allRawPagesRemainPrivate": True,
        "fullBlobRebuildsRequired": 2,
    }:
        fail("checkpoint contract changed")
    remote = value["remoteContract"]
    if remote != {
        "remoteName": REMOTE,
        "remoteUrl": REMOTE_URL,
        "remoteBranch": BRANCH,
        "acquisitionCommitMustRemainAncestor": True,
        "v2ImplementationBlobsMustRemainExactAtAcquisitionCommit": True,
        "finalizerImplementationMustBeRemoteBoundBeforeUse": True,
        "outputIntroducedInLaterDirectCommit": True,
    }:
        fail("remote contract changed")
    output = value["outputContract"]
    if output != {
        "outputPath": "reports/early-detection/finra-q004-historical-crawl-manifest-v3.json",
        "rawRowsIncluded": False,
        "requestOrResponseBodiesIncluded": False,
        "identifiersIncluded": False,
        "aggregateCountsOnly": True,
        "pre2016CoverageStatus": "UNRESOLVED_NOT_EXPOSED_BY_PARTITIONS_ENDPOINT",
        "writeNewAtomic": True,
        "twoIndependentFullPrivateRebuildsRequired": True,
    }:
        fail("output contract changed")
    if any(value["claimLocks"].values()):
        fail("claim lock opened")
    return value


def current_remote_snapshot(contract: dict[str, Any]) -> dict[str, Any]:
    head = str(git("rev-parse", "HEAD"))
    upstream = str(git("rev-parse", "@{upstream}"))
    refs = str(git("ls-remote", REMOTE, f"refs/heads/{BRANCH}")).split()
    remote_head = refs[0] if refs else ""
    if head != upstream or head != remote_head or str(git("remote", "get-url", REMOTE)) != REMOTE_URL:
        fail("remote snapshot drift")
    if subprocess.run(["git", "merge-base", "--is-ancestor", EXPECTED_ACQUISITION, head], cwd=ROOT).returncode:
        fail("acquisition commit not ancestor")
    v2 = contract["v2Bindings"]
    for path_key, sha_key, local_path in (
        ("contractPath", "contractRawSha256", V2_CONTRACT),
        ("runnerPath", "runnerRawSha256", V2_RUNNER),
        ("testPath", "testRawSha256", V2_TEST),
    ):
        expected = v2[sha_key]
        raw = local_path.read_bytes()
        if sha(raw) != expected or git("show", f"{EXPECTED_ACQUISITION}:{v2[path_key]}", binary=True) != raw:
            fail("V2 implementation binding changed")
    files = []
    for path in (CONTRACT, Path(__file__).resolve(), TEST):
        relative = path.relative_to(ROOT).as_posix()
        raw = path.read_bytes()
        if git("show", f"{head}:{relative}", binary=True) != raw:
            fail("finalizer implementation not remote bound")
        files.append({"path": relative, "rawSha256": sha(raw), "gitCommit": head})
    return {"remoteName": REMOTE, "remoteBranch": BRANCH, "remoteHead": head, "files": files}


def input_semantics() -> tuple[list[str], list[str]]:
    dates = load(PARTITIONS)["queue"]["dates"]
    fields = [row["name"] for row in load(METADATA)["dataset"]["fields"]]
    if len(dates) != 1522 or sha(canonical(dates)) != "4b6b991889079d3fbcf92de1a4853988d3eb78ad650ddee50cdbeba8f9381b37":
        fail("partition dates changed")
    if len(fields) != 60 or len(set(fields)) != 60 or sha(canonical(fields)) != "16f599619d5666efa0be18ca4e3e209d5646cc1e4e114dc042eb39156ef4d6d1":
        fail("metadata fields changed")
    return dates, fields


def validate_checkpoint_and_rebuild(checkpoint: dict[str, Any], dates: list[str], fields: list[str]) -> dict[str, Any]:
    body = dict(checkpoint)
    claim = body.pop("checkpointSha256", None)
    if claim != sha(canonical(body)) or checkpoint.get("schema") != "finra-q004-historical-checkpoint/v2":
        fail("checkpoint self hash changed")
    if checkpoint.get("datesSha256") != sha(canonical(dates)) or checkpoint.get("fieldsSha256") != sha(canonical(fields)):
        fail("checkpoint input binding changed")
    if checkpoint.get("outcomesAccessed") is not False:
        fail("checkpoint outcome flag changed")
    binding = checkpoint.get("implementationBindings")
    if not isinstance(binding, dict) or binding.get("remoteHead") != EXPECTED_ACQUISITION or binding.get("remoteName") != REMOTE or binding.get("remoteBranch") != BRANCH:
        fail("checkpoint implementation binding changed")
    completed = checkpoint.get("completed")
    if not isinstance(completed, list) or len(completed) != len(dates):
        fail("checkpoint incomplete")
    if [row.get("calendarDay") for row in completed] != dates:
        fail("checkpoint partition order changed")
    total_rows = 0
    total_bytes = 0
    page_count = 0
    global_ids: set[int] = set()
    sequence = hashlib.sha256()
    expected_fields = set(fields)
    for item in completed:
        day = item["calendarDay"]
        expected_offset = 0
        partition_ids: set[int] = set()
        for page in item["pages"]:
            if page["offset"] != expected_offset or not exact_hex(page["rawSha256"], 64):
                fail("page sequence changed")
            path = PRIVATE / "blobs" / "sha256" / page["rawSha256"][:2] / page["rawSha256"]
            raw = path.read_bytes()
            if sha(raw) != page["rawSha256"] or len(raw) != page["bytes"]:
                fail("private blob mismatch")
            rows = json.loads(raw)
            if not isinstance(rows, list) or len(rows) != page["rowCount"]:
                fail("page row count mismatch")
            for row in rows:
                if not isinstance(row, dict) or set(row) != expected_fields or row["calendarDay"] != day:
                    fail("row schema or partition mismatch")
                identifier = row["OTCDailyListID"]
                if not isinstance(identifier, int) or identifier in partition_ids or identifier in global_ids:
                    fail("identifier duplicate")
                partition_ids.add(identifier)
                sequence.update(canonical(row))
                sequence.update(b"\n")
            expected_offset += len(rows)
            total_rows += len(rows)
            total_bytes += len(raw)
            page_count += 1
        if expected_offset != item["recordTotal"] or len(partition_ids) != item["recordTotal"]:
            fail("partition total mismatch")
        global_ids.update(partition_ids)
    if total_rows != checkpoint["totalRows"] or total_bytes != checkpoint["totalResponseBytes"] or len(global_ids) != total_rows:
        fail("checkpoint aggregate mismatch")
    return {
        "pageCount": page_count,
        "recordCount": total_rows,
        "rawResponseBytes": total_bytes,
        "rowSequenceSha256": sequence.hexdigest(),
        "uniqueIdentifierCount": len(global_ids),
        "checkpointSha256": claim,
    }


def build_manifest(contract: dict[str, Any], snapshot: dict[str, Any], capture: dict[str, Any]) -> dict[str, Any]:
    value = {
        "schema": "finra-q004-historical-crawl-manifest/v3",
        "completedAt": datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "track": contract["track"],
        "taskId": contract["taskId"],
        "sourceId": contract["sourceId"],
        "finalizationContractRawSha256": sha_file(CONTRACT),
        "finalizationContractSha256": contract["contractSha256"],
        "v2AcquisitionCommit": EXPECTED_ACQUISITION,
        "finalizerImplementationBindings": snapshot,
        "coverage": {
            "requestedMinimumDate": "2009-01-01",
            "requestedMaximumDate": "2024-12-31",
            "availableMinimumDate": "2016-01-18",
            "availableMaximumDate": "2024-12-31",
            "partitionCount": 1522,
            "pre2016CoverageStatus": "UNRESOLVED_NOT_EXPOSED_BY_PARTITIONS_ENDPOINT",
        },
        "capture": {**capture, "allRowsPrivate": True, "rawRowsIncluded": False, "identifiersIncluded": False},
        "privateRebuilds": [
            {"runId": "REBUILD_ONE", "status": "PASS", "rowSequenceSha256": capture["rowSequenceSha256"]},
            {"runId": "REBUILD_TWO", "status": "PASS", "rowSequenceSha256": capture["rowSequenceSha256"]},
        ],
        "outcomesAccessed": False,
        "claimLocks": contract["claimLocks"],
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_manifest(value: dict[str, Any], contract: dict[str, Any]) -> None:
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value.get("schema") != "finra-q004-historical-crawl-manifest/v3":
        fail("manifest self hash changed")
    if value.get("finalizationContractRawSha256") != sha_file(CONTRACT) or value.get("finalizationContractSha256") != contract["contractSha256"]:
        fail("manifest contract binding changed")
    if value.get("v2AcquisitionCommit") != EXPECTED_ACQUISITION:
        fail("manifest V2 binding changed")
    capture = value.get("capture", {})
    if capture.get("allRowsPrivate") is not True or capture.get("rawRowsIncluded") is not False or capture.get("identifiersIncluded") is not False:
        fail("private-data boundary changed")
    if value.get("outcomesAccessed") is not False or value.get("claimLocks") != contract["claimLocks"] or any(value["claimLocks"].values()):
        fail("manifest claim lock changed")
    rebuilds = value.get("privateRebuilds")
    if not isinstance(rebuilds, list) or len(rebuilds) != 2 or any(row.get("status") != "PASS" for row in rebuilds):
        fail("private rebuild evidence missing")
    if rebuilds[0]["rowSequenceSha256"] != rebuilds[1]["rowSequenceSha256"] or rebuilds[0]["rowSequenceSha256"] != capture.get("rowSequenceSha256"):
        fail("private rebuild mismatch")


def write_new(path: Path, raw: bytes) -> None:
    if path.exists():
        fail("output exists")
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    if path.read_bytes() != raw:
        fail("output readback mismatch")


def self_test(contract: dict[str, Any]) -> dict[str, Any]:
    sample_capture = {
        "pageCount": 1, "recordCount": 1, "rawResponseBytes": 10,
        "rowSequenceSha256": "a" * 64, "uniqueIdentifierCount": 1, "checkpointSha256": "b" * 64,
    }
    sample_snapshot = {"remoteName": REMOTE, "remoteBranch": BRANCH, "remoteHead": "c" * 40, "files": []}
    source = build_manifest(contract, sample_snapshot, sample_capture)
    kills: dict[str, bool] = {}
    mutations = {
        "rawRowsIncluded": lambda value: value["capture"].__setitem__("rawRowsIncluded", True),
        "identifiersIncluded": lambda value: value["capture"].__setitem__("identifiersIncluded", True),
        "outcome": lambda value: value.__setitem__("outcomesAccessed", True),
        "terminalComplete": lambda value: value["claimLocks"].__setitem__("terminalWealthComplete", True),
        "rebuildMismatch": lambda value: value["privateRebuilds"][1].__setitem__("rowSequenceSha256", "d" * 64),
        "acquisitionDrift": lambda value: value.__setitem__("v2AcquisitionCommit", "e" * 40),
    }
    for name, mutation in mutations.items():
        changed = json.loads(json.dumps(source))
        mutation(changed)
        changed.pop("reportSha256")
        changed["reportSha256"] = sha(canonical(changed))
        try:
            validate_manifest(changed, contract)
            kills[name] = False
        except StudyError:
            kills[name] = True
    if not all(kills.values()):
        fail("self-test fixture failed")
    return {"schema": "finra-q004-historical-finalization-self-test/v3", "status": "PASS", "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "finalize", "verify-output"))
    parser.add_argument("--output")
    args = parser.parse_args()
    try:
        contract = validate_contract()
        if args.command == "verify-contract":
            result = {"status": "PASS", "contractSha256": contract["contractSha256"], "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract)
        elif args.command == "finalize":
            if args.output is None or Path(args.output).resolve() != OUTPUT.resolve():
                fail("output path changed")
            snapshot_before = current_remote_snapshot(contract)
            dates, fields = input_semantics()
            checkpoint = load(CHECKPOINT)
            first = validate_checkpoint_and_rebuild(checkpoint, dates, fields)
            second = validate_checkpoint_and_rebuild(load(CHECKPOINT), dates, fields)
            if first != second:
                fail("two private rebuilds differ")
            if current_remote_snapshot(contract) != snapshot_before:
                fail("remote snapshot changed during rebuild")
            manifest = build_manifest(contract, snapshot_before, first)
            validate_manifest(manifest, contract)
            raw = canonical(manifest) + b"\n"
            write_new(OUTPUT, raw)
            result = {"status": "PASS", "output": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": manifest["reportSha256"], "recordCount": first["recordCount"], "outcomesAccessed": False}
        else:
            if args.output is None or Path(args.output).resolve() != OUTPUT.resolve():
                fail("output path changed")
            manifest = load(OUTPUT)
            validate_manifest(manifest, contract)
            dates, fields = input_semantics()
            capture = validate_checkpoint_and_rebuild(load(CHECKPOINT), dates, fields)
            for key in ("pageCount", "recordCount", "rawResponseBytes", "rowSequenceSha256", "uniqueIdentifierCount", "checkpointSha256"):
                if manifest["capture"][key] != capture[key]:
                    fail("output private rebuild mismatch")
            result = {"status": "PASS", "rawSha256": sha(OUTPUT.read_bytes()), "reportSha256": manifest["reportSha256"], "privateCasVerified": True, "recordCount": capture["recordCount"], "outcomesAccessed": False}
    except (StudyError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
