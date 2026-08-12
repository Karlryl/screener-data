#!/usr/bin/env python3
"""Build Form-25 metadata V2 against the sealed SEC-original inventory V4."""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-form25-structured-metadata-contract-v2.json"
CONTRACT_RAW_SHA256 = "93c1cb7bf933fa17a3fd50c1659da83517f6ac10771096b19f46aef99ce14e4b"
QUEUE_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-queue-v5.json"
INVENTORY_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-original-inventory-v4.json"
OUTPUT_PATH = ROOT / "reports" / "early-detection" / "sec-form25-structured-metadata-v2.json"
SCRIPT_PATH = Path(__file__).resolve()
TEST_PATH = ROOT / "tests" / "build-sec-form25-structured-metadata-v2.test.js"
BASE_BUILDER_PATH = ROOT / "scripts" / "build-sec-form25-structured-metadata-v1.py"
INVENTORY_CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-terminal-wealth-original-inventory-contract-v4.json"
INVENTORY_BUILDER_PATH = ROOT / "scripts" / "build-sec-terminal-wealth-original-inventory-v4.py"

BASE_BUILDER_RAW_SHA256 = "52f78812a7547df4025dd8a48351f2364beb7285cc903bcb1a0df5fbe56d0025"
INVENTORY_RAW_SHA256 = "7a2947b66b9cdc26e829d19a4342b7effbbcea1c8296ca0bc46d4e05217c9711"
INVENTORY_REPORT_SHA256 = "b52b25d27e826872c83d920c3976a6aa9185c337ac48620e85ffbf323d550ab2"
INVENTORY_CONTRACT_RAW_SHA256 = "a59a7fc9d1f2c6e1e19b9469d32fc7852f4d899374672480b8cbc690cfdf0d76"
INVENTORY_BUILDER_RAW_SHA256 = "369bb7b808aaf2cfb00cb7ffa8b3a4254a74d7938f2f8aac5839b15186bcb2e2"
INVENTORY_OUTPUT_COMMIT = "a0218f4344ffa853f83a7123f886fb289cfda2e4"
BASE_FIX_COMMIT = "9bd88bb08ce7e3b35d91bec9491f9614d61b3175"
OUTPUT_SCHEMA = "early-detection-sec-form25-structured-metadata/v2"
BASE_OUTPUT_SCHEMA = "early-detection-sec-form25-structured-metadata/v1"


def _load_base_module():
    spec = importlib.util.spec_from_file_location("sec_form25_structured_metadata_v1", BASE_BUILDER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load bound V1 metadata builder")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


core = _load_base_module()
MetadataError = core.MetadataError
fail = core.fail
sha256 = core.sha256
canonical_bytes = core.canonical_bytes
exact_keys = core.exact_keys

# The V1 parser contains the Tag-722 malformed-HTML fallback and GRAPHIC/binary
# exclusion. V2 reuses that parser only after binding its exact bytes below.
core.CONTRACT_PATH = CONTRACT_PATH
core.CONTRACT_RAW_SHA256 = CONTRACT_RAW_SHA256
core.QUEUE_PATH = QUEUE_PATH
core.INVENTORY_PATH = INVENTORY_PATH
core.OUTPUT_PATH = OUTPUT_PATH
core.SCRIPT_PATH = SCRIPT_PATH
core.TEST_PATH = TEST_PATH

_base_bind_implementation = core.bind_implementation
_base_build = core.build


def load_contract() -> tuple[dict, bytes]:
    raw = CONTRACT_PATH.read_bytes()
    if sha256(raw) != CONTRACT_RAW_SHA256:
        fail("V2 contract raw binding changed")
    value = json.loads(raw)
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "queueInput", "inventoryInput",
        "inventoryImplementation", "blobInput", "population", "parserPolicy", "fieldStatuses",
        "baseImplementation", "authorizedImplementation", "claimLocks",
    }, "V2 contract")
    if value["schema"] != "early-detection-sec-form25-structured-metadata-contract/v2":
        fail("V2 contract schema changed")
    if value["inventoryInput"] != {
        "path": "reports/early-detection/sec-terminal-wealth-original-inventory-v4.json",
        "rawSha256": INVENTORY_RAW_SHA256,
        "reportSha256": INVENTORY_REPORT_SHA256,
        "blobTreeSequenceSha256": "47b24e7e3fefe343656eaee8b256cf0a4978c3b9e39d3d1932a4265ad976ed4f",
        "localPrimaryPresentForm25Rows": 27263,
        "ambiguousMultipleLocalBlobsForm25Rows": 22,
        "fetchRequiredForm25Rows": 0,
    }:
        fail("V2 inventory input binding changed")
    if value["inventoryImplementation"] != {
        "contractPath": "research/early-detection-v4/sec-terminal-wealth-original-inventory-contract-v4.json",
        "contractRawSha256": INVENTORY_CONTRACT_RAW_SHA256,
        "builderPath": "scripts/build-sec-terminal-wealth-original-inventory-v4.py",
        "builderRawSha256": INVENTORY_BUILDER_RAW_SHA256,
        "outputCommit": INVENTORY_OUTPUT_COMMIT,
    }:
        fail("V2 inventory implementation binding changed")
    if value["baseImplementation"] != {
        "builderPath": "scripts/build-sec-form25-structured-metadata-v1.py",
        "builderRawSha256": BASE_BUILDER_RAW_SHA256,
        "fixCommit": BASE_FIX_COMMIT,
    }:
        fail("V2 base implementation binding changed")
    if value["authorizedImplementation"] != {
        "builderPath": "scripts/build-sec-form25-structured-metadata-v2.py",
        "testPath": "tests/build-sec-form25-structured-metadata-v2.test.js",
        "outputPath": "reports/early-detection/sec-form25-structured-metadata-v2.json",
    }:
        fail("V2 authorized implementation paths changed")
    if value["population"] != {
        "joinKey": "EXACT_ROW_ID_THEN_EXACT_ACCESSION",
        "tickerJoinAllowed": False,
        "oneOutputRowPerForm25QueueRow": True,
        "ambiguousInventoryBlobSelectionAllowed": False,
    }:
        fail("V2 population policy changed")
    expected_locks = {
        "originalV4GateCredit": False,
        "terminalWealthComplete": False,
        "lastTradingSessionProven": False,
        "terminalPaymentVerified": False,
        "identityResolved": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
    }
    core.validate_claim_locks(value["claimLocks"], expected_locks)
    if set(value["fieldStatuses"]) != core.FIELD_STATUSES:
        fail("V2 field status vocabulary changed")
    return value, raw


def _require_git_blob(commit: str, path: Path, expected_sha: str, label: str) -> None:
    raw = path.read_bytes()
    if sha256(raw) != expected_sha:
        fail(f"{label} raw binding changed")
    relative = path.relative_to(ROOT).as_posix()
    if core.git_bytes("show", f"{commit}:{relative}") != raw:
        fail(f"{label} is not bound by {commit}")


def bind_implementation(base_commit: str) -> dict:
    result = _base_bind_implementation(base_commit)
    _require_git_blob(base_commit, BASE_BUILDER_PATH, BASE_BUILDER_RAW_SHA256, "V1 base builder")
    if core.git_text("rev-parse", f"{BASE_FIX_COMMIT}^{{commit}}") != BASE_FIX_COMMIT:
        fail("V1 parser fix commit binding changed")
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", BASE_FIX_COMMIT, base_commit],
        cwd=ROOT, check=False, capture_output=True,
    ).returncode != 0:
        fail("V1 parser fix commit is not an ancestor of the build commit")
    if core.git_text("rev-parse", f"{INVENTORY_OUTPUT_COMMIT}^{{commit}}") != INVENTORY_OUTPUT_COMMIT:
        fail("inventory V4 output commit binding changed")
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", INVENTORY_OUTPUT_COMMIT, base_commit],
        cwd=ROOT, check=False, capture_output=True,
    ).returncode != 0:
        fail("inventory V4 output commit is not an ancestor of the build commit")
    _require_git_blob(
        INVENTORY_OUTPUT_COMMIT, INVENTORY_CONTRACT_PATH,
        INVENTORY_CONTRACT_RAW_SHA256, "inventory V4 contract",
    )
    _require_git_blob(
        INVENTORY_OUTPUT_COMMIT, INVENTORY_BUILDER_PATH,
        INVENTORY_BUILDER_RAW_SHA256, "inventory V4 builder",
    )
    _require_git_blob(INVENTORY_OUTPUT_COMMIT, INVENTORY_PATH, INVENTORY_RAW_SHA256, "inventory V4 output")
    result.update({
        "baseBuilderV1RawSha256": BASE_BUILDER_RAW_SHA256,
        "baseFixCommit": BASE_FIX_COMMIT,
        "inventoryContractV4RawSha256": INVENTORY_CONTRACT_RAW_SHA256,
        "inventoryBuilderV4RawSha256": INVENTORY_BUILDER_RAW_SHA256,
        "inventoryOutputCommit": INVENTORY_OUTPUT_COMMIT,
    })
    return result


core.load_contract = load_contract
core.bind_implementation = bind_implementation


def validate_v2_output(payload: dict, contract: dict) -> None:
    if payload.get("schema") != OUTPUT_SCHEMA:
        fail("V2 output schema changed")
    expected_sha = sha256(canonical_bytes({key: value for key, value in payload.items() if key != "reportSha256"}))
    if payload.get("reportSha256") != expected_sha:
        fail("V2 output self hash changed")
    if payload.get("claimLocks") != contract["claimLocks"]:
        fail("V2 output claim locks changed")
    if payload.get("inputBindings", {}).get("inventoryRawSha256") != INVENTORY_RAW_SHA256:
        fail("V2 output inventory raw binding changed")
    if payload.get("inputBindings", {}).get("inventoryReportSha256") != INVENTORY_REPORT_SHA256:
        fail("V2 output inventory self binding changed")
    implementation = payload.get("implementationBindings", {})
    expected_extra = {
        "baseBuilderV1RawSha256": BASE_BUILDER_RAW_SHA256,
        "baseFixCommit": BASE_FIX_COMMIT,
        "inventoryContractV4RawSha256": INVENTORY_CONTRACT_RAW_SHA256,
        "inventoryBuilderV4RawSha256": INVENTORY_BUILDER_RAW_SHA256,
        "inventoryOutputCommit": INVENTORY_OUTPUT_COMMIT,
    }
    if any(implementation.get(key) != value for key, value in expected_extra.items()):
        fail("V2 output provenance binding changed")
    for row in payload.get("rows", []):
        core.validate_row_shape(row)


def build(blob_root: Path) -> dict:
    payload = _base_build(blob_root)
    if payload.get("schema") != BASE_OUTPUT_SCHEMA:
        fail("V1 base builder output schema changed")
    payload["schema"] = OUTPUT_SCHEMA
    payload["reportSha256"] = sha256(
        canonical_bytes({key: value for key, value in payload.items() if key != "reportSha256"})
    )
    contract, _ = load_contract()
    validate_v2_output(payload, contract)
    return payload


def self_test() -> dict:
    contract, _ = load_contract()
    result = core.self_test()
    checks = {
        "v2ContractSchemaBound": contract["schema"] == "early-detection-sec-form25-structured-metadata-contract/v2",
        "baseBuilderV1RawBound": sha256(BASE_BUILDER_PATH.read_bytes()) == BASE_BUILDER_RAW_SHA256,
        "inventoryV4RawBound": sha256(INVENTORY_PATH.read_bytes()) == INVENTORY_RAW_SHA256,
        "inventoryV4SelfBound": json.loads(INVENTORY_PATH.read_bytes()).get("reportSha256") == INVENTORY_REPORT_SHA256,
        "inventoryV4ContractRawBound": sha256(INVENTORY_CONTRACT_PATH.read_bytes()) == INVENTORY_CONTRACT_RAW_SHA256,
        "inventoryV4BuilderRawBound": sha256(INVENTORY_BUILDER_PATH.read_bytes()) == INVENTORY_BUILDER_RAW_SHA256,
        "malformedHtmlFixInherited": result.get("malformedTextFallbackDeterministic") is True,
        "binaryGraphicFixInherited": result.get("binaryGraphicEvidenceRejected") is True,
    }
    if result.get("status") != "PASS" or not all(checks.values()):
        fail("V2 self-test failed")
    return {
        "status": "PASS",
        **checks,
        "validExactExtractionAccepted": result["validExactExtractionAccepted"],
        "malformedXmlRejected": result["malformedXmlRejected"],
        "multipleXmlDocumentsRejected": result["multipleXmlDocumentsRejected"],
        "duplicateXmlFieldRejected": result["duplicateXmlFieldRejected"],
        "conflictingXmlFieldRejected": result["conflictingXmlFieldRejected"],
        "dateAmbiguityRejected": result["dateAmbiguityRejected"],
        "paymentLanguageWithoutAmountRejected": result["paymentLanguageWithoutAmountRejected"],
        "tickerOnlyJoinMutationRejected": result["tickerOnlyJoinMutationRejected"],
        "missingSourceHashMutationRejected": result["missingSourceHashMutationRejected"],
        "candidatePromotionMutationRejected": result["candidatePromotionMutationRejected"],
        "falseClaimMutationRejected": result["falseClaimMutationRejected"],
        "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--blob-root")
    parser.add_argument("--output", default=str(OUTPUT_PATH))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        if args.self_test:
            result = self_test()
        else:
            if not args.blob_root:
                parser.error("--blob-root is required")
            payload = build(Path(args.blob_root))
            encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            core.atomic_write_new(Path(args.output), encoded)
            result = {
                "status": "PASS",
                "rows": payload["population"]["rows"],
                "uniqueAccessions": payload["population"]["uniqueAccessions"],
                "candidateSnippetCount": payload["candidateSnippetCount"],
                "reportSha256": payload["reportSha256"],
                "outcomesAccessed": False,
            }
    except (MetadataError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
