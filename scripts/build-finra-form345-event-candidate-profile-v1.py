#!/usr/bin/env python3
"""Build an aggregate-only FINRA/Form-345 event-candidate profile."""
from __future__ import annotations

import argparse
import bisect
import copy
import hashlib
import importlib.util
import json
import os
import subprocess
import tempfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "finra-form345-event-candidate-profile-contract-v1.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-finra-form345-event-candidate-profile-v1.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "finra-form345-event-candidate-profile-v1.json"
FORM_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form345-issuer-symbol-point-contract-v2.json"
FORM_BUILDER = ROOT / "scripts" / "build-sec-form345-issuer-symbol-point-v2.py"
FORM_TEST = ROOT / "tests" / "build-sec-form345-issuer-symbol-point-v2.test.js"
QUEUE = ROOT / "reports" / "early-detection" / "sec-terminal-identity-evidence-gap-queue-v1.json"
FINRA_MANIFEST = ROOT / "reports" / "early-detection" / "finra-q004-historical-crawl-manifest-v3.json"
FINRA_METADATA = ROOT / "reports" / "early-detection" / "finra-q004-otc-daily-list-metadata-v1.json"
FINRA_PRIVATE = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\private-evidence\finra-q004\historical")
FINRA_CHECKPOINT = FINRA_PRIVATE / "checkpoint-v2.json"

CONTRACT_RAW = "5ce36408ab6faae88d9b0f23804f1ff51d3ae499f638a379e577b435f3d09a15"
CONTRACT_SELF = "f7bdc087e5bf7570910f128ddeed913473d102576114f322e5825e188619f320"
SOURCE_BASE = "6d69e42eb377b6345f7392e57e693d924b366cc3"
SOURCE_PARENT = "c172b73a36e7b3001797520514c790925f258784"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_TRACKING_REF = "origin/codex/early-detection-v4-gates-20260810"

FORM_MANIFEST_RAW = "0f0b52999baa558b48e83696fcbcf7e8ab8613af34d88f55a9a529d2e88586e1"
FORM_MANIFEST_SELF = "deb91244154b3093acda0235b0cb6ad443374c21b691cf0bf178c8a641465152"
QUEUE_RAW = "4c5bff255368bb0d9f498a8f367c65964c0de80d577cca70c695afe50ce0c650"
QUEUE_SELF = "cb0b6272b1c07a8091354336bd9e5e1195ba43f766d393fe46fbebf04874e954"
FINRA_MANIFEST_RAW = "2f266d063d5c05df53d635afcb922d0775d0345005869955b41fece3b9502580"
FINRA_MANIFEST_SELF = "caff5b9863516992222f9b58690cfad31df700441eeaf2fe3c41b356e641a09f"
FINRA_METADATA_RAW = "dc1ce543a2c2dbc80187d7757874245e504bb3c04b1faa8ccbdaa91a8ad23955"
FINRA_METADATA_SELF = "a53fe52d0a02d78bd12ed0f2e465785503a2a75a42a787f61f971659c58ddcc7"
FINRA_CHECKPOINT_RAW = "7dd6a000e72b5219d00f25d98540fca3c6ab4f0a0b9527498656d4d2e9a2cc9c"
FINRA_CHECKPOINT_SELF = "37b68644f955d046bc97885d6dde4014acbcc04fa8acc3945712b204ee58e5ad"
FINRA_ROW_SEQUENCE = "2e2aa926ce60a632942fe87e53fada22e0373108e04d2e5e5591727dad383c4a"
FINRA_FIELDS_SEQUENCE = "16f599619d5666efa0be18ca4e3e209d5646cc1e4e114dc042eb39156ef4d6d1"
FINRA_DATES_SEQUENCE = "4b6b991889079d3fbcf92de1a4853988d3eb78ad650ddee50cdbeba8f9381b37"

BASE_FILES = {
    FORM_CONTRACT: ("b3d7a6ab30999cac316e7e92b159a2ecf1b6339531c6c8a11dbe93a2003e26c4", "322621a4aa338606581bdbef56bad542645988ba"),
    FORM_BUILDER: ("ebe692a2532a1aab62bffd4a5b17631bf99c9467828c18585899dfbe551521e7", "fe707a931b9d0cb2ed6c0922d113346835bebc4c"),
    FORM_TEST: ("72881db9ebe7da649a5a9c489739855a0fe2d4f06895d7663d1073abbf5e9ab1", "25bf1c44e394c684c540ef6c18b70c9130e2505f"),
    QUEUE: (QUEUE_RAW, "bd2c308bc758543cd21976ad82f2a7808f520123"),
    FINRA_MANIFEST: (FINRA_MANIFEST_RAW, "7e010da4b626e01774f43a37a9a3db949c4dc4cd"),
    FINRA_METADATA: (FINRA_METADATA_RAW, "35a29d73faa3119640e538014f23eab32681efe9"),
}
OWNED = (CONTRACT, BUILDER, TEST)
PLACEHOLDERS = {"-", "N/A", "NA", "NONE", "NOT APPLICABLE", "NO SYMBOL", "NULL"}
RELEVANT_CODES = {"SA", "SC", "SD"}
RELEVANT_FLAGS = (
    "changeSymbolFlag", "changeSecurityDescriptionFlag", "changeSecurityAttributeFlag",
    "securityAddFlag", "securityDeleteFlag", "bankruptcyFlag", "changeFinancialStatusFlag",
)
EXPECTED_TOTALS = {
    "form345SourceRows": 3_352_003,
    "form345TargetObservations": 164_675,
    "form345PointCells": 57_456,
    "placeholderObservationRows": 120,
    "placeholderPointCells": 46,
    "usablePointCells": 57_410,
    "usablePointCiks": 548,
    "gapRowsWithUsablePoints": 595,
    "usableSymbols": 701,
    "symbolsWithOneCik": 686,
    "symbolsWithTwoCiks": 15,
    "finraRows": 145_103,
    "identityRelevantFinraEvents": 65_515,
    "candidateEvents": 8,
    "candidateCiks": 5,
    "ambiguousMultiCikEvents": 0,
    "oldOnlyCandidateEvents": 8,
    "newOnlyCandidateEvents": 0,
    "dualSideCandidateEvents": 0,
    "matchedGapRows": 0,
    "candidateEventGapPairs": 0,
    "candidateEventCodeCounts": {"<NULL>": 1, "SA": 4, "SC": 1, "SD": 2},
    "nearestSameCikGapDayDistance": {"minimum": 369, "upperMedian": 1155, "maximum": 2587},
}
EXPECTED_COVERAGE = {
    "availableMinimumDate": "2016-01-18",
    "availableMaximumDate": "2024-12-31",
    "partitionDatesByYear": {"2016": 1, "2017": 0, "2018": 10, "2019": 252, "2020": 253, "2021": 252, "2022": 252, "2023": 250, "2024": 252},
    "maximumPartitionGapDays": 1011,
    "periodCompleteAbsenceClaimAllowed": False,
    "pre2016Status": "UNRESOLVED_NOT_EXPOSED_BY_PARTITIONS_ENDPOINT",
}


class ProfileError(RuntimeError):
    """Fail-closed contract, private-source, privacy, or claim-boundary error."""


def fail(message: str) -> None:
    raise ProfileError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def self_hash(value: dict[str, Any], field: str) -> str:
    return sha(canonical({key: item for key, item in value.items() if key != field}))


def git_text(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()


def git_bytes(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def is_ancestor(ancestor: str, descendant: str) -> bool:
    return subprocess.run(["git", "merge-base", "--is-ancestor", ancestor, descendant], cwd=ROOT).returncode == 0


def load_json_bound(path: Path, raw_claim: str, self_field: str, self_claim: str, label: str) -> dict[str, Any]:
    raw = path.read_bytes()
    if sha(raw) != raw_claim:
        fail(f"{label} raw bytes changed")
    value = json.loads(raw)
    if value.get(self_field) != self_claim or self_hash(value, self_field) != self_claim:
        fail(f"{label} self binding changed")
    if value.get("outcomesAccessed") is not False:
        fail(f"{label} outcome lock changed")
    return value


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "sourceBase",
        "authorizedImplementation", "boundInputs", "selectionContract", "expectedPopulation",
        "coverageDisclosure", "privacyContract", "futureOutput", "claimLocks",
        "abortCriteria", "contractSha256",
    }, "contract")
    if value.get("contractSha256") != CONTRACT_SELF or self_hash(value, "contractSha256") != CONTRACT_SELF:
        fail("contract self binding changed")
    if value["schema"] != "finra-form345-event-candidate-profile-contract/v1" or value["taskId"] != "Q004-FINRA-FORM345-EVENT-CANDIDATE-PROFILE" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    if value["sourceBase"] != {
        "remote": REMOTE_URL, "ref": "refs/heads/codex/early-detection-v4-gates-20260810",
        "commit": SOURCE_BASE, "tag": 838, "parent": SOURCE_PARENT,
        "exactGitBytesRequired": True, "preOutputVerificationAllowedOnDescendants": True,
        "productionImplementationMustContainUnchangedSourceBase": True,
        "futureOutputMustBeIntroducedAfterImplementationCommit": True,
    }:
        fail("source-base policy changed")
    if value["expectedPopulation"] != EXPECTED_TOTALS or value["coverageDisclosure"] != EXPECTED_COVERAGE:
        fail("frozen denominator changed")
    selection = value["selectionContract"]
    if selection != {
        "unit": "FINRA_EVENT_WITH_EXACT_CIK_BOUNDED_SEC_POINT_SUPPORT",
        "canonicalCik": "EXACT_ZERO_PADDED_10_ASCII_DIGITS",
        "symbolNormalization": "TRIM_THEN_ASCII_UPPER_ONLY",
        "placeholderSymbols": ["-", "N/A", "NA", "NONE", "NOT APPLICABLE", "NO SYMBOL", "NULL"],
        "placeholderDisposition": "QUARANTINE_NEVER_MATCH",
        "identityRelevantEventRule": {"eventCodes": ["SA", "SC", "SD"], "orExactYFlags": list(RELEVANT_FLAGS)},
        "oldSide": "EXACT_SYMBOL_AND_0_LE_FINRA_DAY_MINUS_SEC_POINT_DAY_LE_120",
        "newSide": "EXACT_SYMBOL_AND_0_LE_SEC_POINT_DAY_MINUS_FINRA_DAY_LE_120",
        "candidateRule": "UNION_OF_OLD_AND_NEW_SIDE_EXACT_CIKS_HAS_SIZE_ONE",
        "multipleCikDisposition": "AMBIGUOUS_MULTI_CIK_NEVER_CANDIDATE",
        "gapRelevanceRule": "SAME_EXACT_CIK_AND_ABSOLUTE_FINRA_DAY_MINUS_GAP_FILING_DAY_LE_120",
        "tickerOnlyResolutionAllowed": False, "nameOrDescriptionJoinAllowed": False,
        "punctuationRewriteOrFuzzyJoinAllowed": False, "dateWindowDaysInclusive": 120,
    }:
        fail("selection policy changed")
    expected_privacy = {
        "publicAggregateOnly": True, "privateRowLevelLedgersEmitted": False,
        "identifiersSymbolsNamesDescriptionsAccessionsAndRawRowsIncluded": False,
        "candidateRowHashesIncluded": False, "inputAndAggregateHashesAllowed": True,
        "errorsMayExposePrivateValues": False, "networkAccessAllowed": False,
        "privateSourcesReadOnly": True,
    }
    if value["privacyContract"] != expected_privacy:
        fail("privacy policy changed")
    if value["futureOutput"] != {
        "schema": "finra-form345-event-candidate-profile/v1",
        "path": "reports/early-detection/finra-form345-event-candidate-profile-v1.json",
        "writeNewAtomic": True, "twoIndependentFullRebuildsRequired": True,
        "aggregateOnly": True, "resolvedRows": 0,
    }:
        fail("future-output policy changed")
    if set(value["claimLocks"]) != {
        "historicalIdentityResolved", "permanentSecurityIdentityResolved", "listingIdentityResolved",
        "securityIdentityResolved", "tickerReuseResolved", "historicalIdentityIntervalsComplete",
        "corporateActionsComplete", "terminalSessionProven", "terminalPaymentVerified",
        "terminalWealthComplete", "pricesAccessed", "returnsAccessed", "outcomesAccessed",
        "originalV4GateCredit", "humanAttestation",
    } or any(item is not False for item in value["claimLocks"].values()):
        fail("claim locks changed")
    return value


def verify_source_base() -> dict[str, str]:
    if git_text("remote", "get-url", "origin") != REMOTE_URL:
        fail("origin URL changed")
    if git_text("rev-parse", f"{SOURCE_BASE}^") != SOURCE_PARENT:
        fail("Tag838 parent changed")
    head = git_text("rev-parse", "HEAD")
    remote = git_text("rev-parse", REMOTE_TRACKING_REF)
    if not is_ancestor(SOURCE_BASE, head) or not is_ancestor(SOURCE_BASE, remote):
        fail("Tag838 is not contained in local and remote-tracking lineage")
    for path, (raw_claim, blob_claim) in BASE_FILES.items():
        relative = path.relative_to(ROOT).as_posix()
        if sha(path.read_bytes()) != raw_claim:
            fail(f"bound input worktree bytes changed: {relative}")
        if git_text("rev-parse", f"{SOURCE_BASE}:{relative}") != blob_claim:
            fail(f"bound input Git blob changed: {relative}")
        if git_bytes("show", f"{SOURCE_BASE}:{relative}") != path.read_bytes():
            fail(f"bound input differs from Tag838: {relative}")
    return {"head": head, "remoteTrackingHead": remote, "sourceBase": SOURCE_BASE}


def verify_implementation_topology(for_output: bool) -> dict[str, str]:
    base = verify_source_base()
    head = base["head"]
    remote = base["remoteTrackingHead"]
    if head != remote:
        fail("production requires local HEAD at remote-tracking HEAD")
    implementation_commit = git_text("rev-parse", "HEAD^") if for_output else head
    if not is_ancestor(SOURCE_BASE, implementation_commit):
        fail("implementation does not contain Tag838 source base")
    for path in OWNED:
        relative = path.relative_to(ROOT).as_posix()
        if git_bytes("show", f"{implementation_commit}:{relative}") != path.read_bytes():
            fail("implementation bytes are not committed at production implementation commit")
    relative_output = OUTPUT.relative_to(ROOT).as_posix()
    if for_output:
        if subprocess.run(["git", "cat-file", "-e", f"{implementation_commit}:{relative_output}"], cwd=ROOT, capture_output=True).returncode == 0:
            fail("output existed before its direct introduction commit")
        if git_bytes("show", f"{head}:{relative_output}") != OUTPUT.read_bytes():
            fail("output bytes are not committed at direct introduction commit")
    elif OUTPUT.exists():
        fail("output already exists before build")
    return {"head": head, "implementationCommit": implementation_commit}


def load_form_module() -> Any:
    spec = importlib.util.spec_from_file_location("sec_form345_v2_bound_for_finra", FORM_BUILDER)
    if spec is None or spec.loader is None:
        fail("bound Form345 parser cannot be imported")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def normalize_symbol(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        fail("symbol value type changed")
    text = value.strip()
    if not text:
        return None
    if not text.isascii():
        fail("symbol contains non-ASCII text")
    return text.upper()


def canonical_cik(value: Any) -> str:
    text = str(value).strip()
    if not text.isascii() or not text.isdigit() or not 1 <= len(text) <= 10:
        fail("CIK format changed")
    return text.zfill(10)


def load_queue() -> dict[str, Any]:
    value = load_json_bound(QUEUE, QUEUE_RAW, "reportSha256", QUEUE_SELF, "gap queue")
    rows = value.get("rows")
    if not isinstance(rows, list) or len(rows) != 656 or value.get("population", {}).get("rows") != 656:
        fail("gap queue denominator changed")
    if len({canonical_cik(row["issuerCik"]) for row in rows}) != 607:
        fail("gap queue CIK denominator changed")
    return value


def load_finra_inputs() -> tuple[dict[str, Any], list[str], list[dict[str, Any]]]:
    manifest = load_json_bound(FINRA_MANIFEST, FINRA_MANIFEST_RAW, "reportSha256", FINRA_MANIFEST_SELF, "FINRA manifest")
    metadata = load_json_bound(FINRA_METADATA, FINRA_METADATA_RAW, "reportSha256", FINRA_METADATA_SELF, "FINRA metadata")
    if manifest.get("capture") != {
        "allRowsPrivate": True, "checkpointSha256": FINRA_CHECKPOINT_SELF,
        "identifiersIncluded": False, "pageCount": 1556, "rawResponseBytes": 257_639_538,
        "rawRowsIncluded": False, "recordCount": 145_103,
        "rowSequenceSha256": FINRA_ROW_SEQUENCE, "uniqueIdentifierCount": 145_103,
    }:
        fail("FINRA manifest capture binding changed")
    fields = [item.get("name") for item in metadata.get("dataset", {}).get("fields", [])]
    if len(fields) != 60 or len(set(fields)) != 60 or sha(canonical(fields)) != FINRA_FIELDS_SEQUENCE:
        fail("FINRA metadata fields changed")
    raw = FINRA_CHECKPOINT.read_bytes()
    if sha(raw) != FINRA_CHECKPOINT_RAW:
        fail("FINRA checkpoint raw bytes changed")
    checkpoint = json.loads(raw)
    exact_keys(checkpoint, {
        "schema", "contractRawSha256", "contractSha256", "createdAt", "datesSha256",
        "fieldsSha256", "implementationBindings", "completed", "totalRows",
        "totalResponseBytes", "outcomesAccessed", "checkpointSha256",
    }, "FINRA checkpoint")
    if checkpoint.get("checkpointSha256") != FINRA_CHECKPOINT_SELF or self_hash(checkpoint, "checkpointSha256") != FINRA_CHECKPOINT_SELF:
        fail("FINRA checkpoint self binding changed")
    if checkpoint.get("schema") != "finra-q004-historical-checkpoint/v2" or checkpoint.get("outcomesAccessed") is not False:
        fail("FINRA checkpoint boundary changed")
    if checkpoint.get("datesSha256") != FINRA_DATES_SEQUENCE or checkpoint.get("fieldsSha256") != FINRA_FIELDS_SEQUENCE:
        fail("FINRA checkpoint input binding changed")
    completed = checkpoint.get("completed")
    if not isinstance(completed, list) or len(completed) != 1522 or checkpoint.get("totalRows") != 145_103 or checkpoint.get("totalResponseBytes") != 257_639_538:
        fail("FINRA checkpoint denominator changed")
    return checkpoint, fields, completed


def point_ciks(index: dict[str, list[tuple[int, str]]], symbol: str | None, low: int, high: int) -> set[str]:
    if symbol is None or symbol in PLACEHOLDERS:
        return set()
    values = index.get(symbol, [])
    left = bisect.bisect_left(values, (low, ""))
    right = bisect.bisect_right(values, (high, "\U0010ffff"))
    return {cik for _ordinal, cik in values[left:right]}


def classify_event(index: dict[str, list[tuple[int, str]]], old_symbol: Any, new_symbol: Any, event_day: date) -> tuple[str, set[str], set[str]]:
    old = normalize_symbol(old_symbol)
    new = normalize_symbol(new_symbol)
    ordinal = event_day.toordinal()
    old_ciks = point_ciks(index, old, ordinal - 120, ordinal)
    new_ciks = point_ciks(index, new, ordinal, ordinal + 120)
    union = old_ciks | new_ciks
    if len(union) > 1:
        return "AMBIGUOUS_MULTI_CIK", old_ciks, new_ciks
    if not union:
        return "UNMATCHED", old_ciks, new_ciks
    selected = next(iter(union))
    if selected in old_ciks and selected in new_ciks:
        return "DUAL_SIDE_CANDIDATE", old_ciks, new_ciks
    if selected in old_ciks:
        return "OLD_ONLY_CANDIDATE", old_ciks, new_ciks
    return "NEW_ONLY_CANDIDATE", old_ciks, new_ciks


def build_form_index(contract: dict[str, Any], queue: dict[str, Any]) -> tuple[dict[str, list[tuple[int, str]]], dict[str, list[tuple[int, str]]], dict[str, int]]:
    module = load_form_module()
    form_contract, _ = module.load_contract()
    v1 = module.validate_v1_bindings(form_contract)
    private_root = module.default_private_root()
    manifest, _manifest_raw, v1_contract = module.load_capture_manifest(private_root, form_contract, v1, deep=True)
    private_root = v1.validate_private_root(private_root)
    target_ciks = {canonical_cik(row["issuerCik"]) for row in queue["rows"]}
    cells: set[tuple[str, str, int]] = set()
    placeholder_observations = 0
    total_rows = 0
    target_observations = 0
    receipts = {item["quarter"]: item for item in manifest["receipts"]}
    for source in v1.expected_quarters():
        quarter, url = source["quarter"], source["url"]
        receipt, _receipt_raw = v1.load_receipt(v1.receipt_path(private_root, quarter), v1_contract, private_root, quarter, url)
        if receipts[quarter]["zipRawSha256"] != receipt["rawSha256"]:
            fail("Form345 receipt-to-manifest binding changed")
        zip_raw = v1.blob_path(private_root, receipt["rawSha256"]).read_bytes()
        _member, submission_raw = v1.read_submission_member(zip_raw)
        observations, stats = module.parse_submission_rows(submission_raw, target_ciks, v1)
        total_rows += stats["allRows"]
        target_observations += stats["targetRows"]
        for observation in observations:
            symbol = normalize_symbol(observation["issuerTradingSymbol"])
            if symbol is None:
                fail("Form345 core symbol unexpectedly blank")
            cik = canonical_cik(observation["issuerCik"])
            ordinal = date.fromisoformat(observation["filingDate"]).toordinal()
            if symbol in PLACEHOLDERS:
                placeholder_observations += 1
            cells.add((cik, symbol, ordinal))
    if total_rows != 3_352_003 or target_observations != 164_675:
        fail("Form345 source denominator changed")
    placeholder_cells = {item for item in cells if item[1] in PLACEHOLDERS}
    usable = cells - placeholder_cells
    index: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for cik, symbol, ordinal in usable:
        index[symbol].append((ordinal, cik))
    for values in index.values():
        values.sort()
    symbol_cik_counts = Counter(len({cik for _ordinal, cik in values}) for values in index.values())
    if set(symbol_cik_counts) - {1, 2}:
        fail("Form345 symbol-to-CIK multiplicity changed")
    usable_ciks = {cik for cik, _symbol, _ordinal in usable}
    gap_dates: dict[str, list[tuple[int, str]]] = defaultdict(list)
    gap_work_ids: set[str] = set()
    gap_rows_with_points = 0
    for row in queue["rows"]:
        cik = canonical_cik(row["issuerCik"])
        work_id = row.get("workItemId")
        if not isinstance(work_id, str) or not work_id or work_id in gap_work_ids:
            fail("gap queue work-item identity changed")
        gap_work_ids.add(work_id)
        gap_dates[cik].append((date.fromisoformat(row["filedDate"]).toordinal(), work_id))
        if cik in usable_ciks:
            gap_rows_with_points += 1
    for values in gap_dates.values():
        values.sort()
    aggregate = {
        "form345SourceRows": total_rows,
        "form345TargetObservations": target_observations,
        "form345PointCells": len(cells),
        "placeholderObservationRows": placeholder_observations,
        "placeholderPointCells": len(placeholder_cells),
        "usablePointCells": len(usable),
        "usablePointCiks": len(usable_ciks),
        "gapRowsWithUsablePoints": gap_rows_with_points,
        "usableSymbols": len(index),
        "symbolsWithOneCik": symbol_cik_counts[1],
        "symbolsWithTwoCiks": symbol_cik_counts[2],
    }
    return dict(index), dict(gap_dates), aggregate


def rebuild_once(contract: dict[str, Any]) -> dict[str, Any]:
    queue = load_queue()
    index, gap_dates, aggregate = build_form_index(contract, queue)
    _checkpoint, fields, completed = load_finra_inputs()
    expected_fields = set(fields)
    sequence = hashlib.sha256()
    identifiers: set[int] = set()
    total_rows = 0
    total_bytes = 0
    page_count = 0
    relevant_events = 0
    candidate_events = 0
    candidate_ciks: set[str] = set()
    ambiguous_events = 0
    side_counts: Counter[str] = Counter()
    code_counts: Counter[str] = Counter()
    matched_gap_rows: set[str] = set()
    event_gap_pairs = 0
    nearest_distances: list[int] = []
    partition_dates: list[date] = []
    for partition in completed:
        exact_keys(partition, {"calendarDay", "completedAt", "pages", "recordTotal"}, "FINRA partition")
        day_text = partition.get("calendarDay")
        if not isinstance(day_text, str):
            fail("FINRA partition date changed")
        event_day = date.fromisoformat(day_text[:10])
        partition_dates.append(event_day)
        expected_offset = 0
        partition_ids: set[int] = set()
        pages = partition.get("pages")
        if not isinstance(pages, list):
            fail("FINRA page list changed")
        for page in pages:
            exact_keys(page, {"bytes", "headersSha256", "offset", "rawSha256", "requestSha256", "rowCount"}, "FINRA page")
            if page.get("offset") != expected_offset:
                fail("FINRA page offset changed")
            raw_claim = page.get("rawSha256")
            if not isinstance(raw_claim, str) or len(raw_claim) != 64 or any(ch not in "0123456789abcdef" for ch in raw_claim):
                fail("FINRA page hash changed")
            path = FINRA_PRIVATE / "blobs" / "sha256" / raw_claim[:2] / raw_claim
            raw = path.read_bytes()
            if sha(raw) != raw_claim or len(raw) != page.get("bytes"):
                fail("FINRA private blob changed")
            rows = json.loads(raw)
            if not isinstance(rows, list) or len(rows) != page.get("rowCount"):
                fail("FINRA private page row count changed")
            for source in rows:
                if not isinstance(source, dict) or set(source) != expected_fields or source.get("calendarDay") != day_text:
                    fail("FINRA private row schema changed")
                identifier = source.get("OTCDailyListID")
                if not isinstance(identifier, int) or identifier in partition_ids or identifier in identifiers:
                    fail("FINRA private identifier uniqueness changed")
                partition_ids.add(identifier)
                identifiers.add(identifier)
                sequence.update(canonical(source))
                sequence.update(b"\n")
                event_code_value = source.get("dailyListEventCode")
                if event_code_value is not None and not isinstance(event_code_value, str):
                    fail("FINRA event-code type changed")
                event_code = event_code_value.strip() if isinstance(event_code_value, str) else ""
                relevant = event_code in RELEVANT_CODES or any(source.get(flag) == "Y" for flag in RELEVANT_FLAGS)
                if not relevant:
                    continue
                relevant_events += 1
                state, old_ciks, new_ciks = classify_event(index, source.get("oldSymbolCode"), source.get("newSymbolCode"), event_day)
                if state == "AMBIGUOUS_MULTI_CIK":
                    ambiguous_events += 1
                    continue
                if not state.endswith("_CANDIDATE"):
                    continue
                union = old_ciks | new_ciks
                if len(union) != 1:
                    fail("candidate CIK cardinality changed")
                cik = next(iter(union))
                candidate_events += 1
                candidate_ciks.add(cik)
                side_counts[state] += 1
                code_counts[event_code or "<NULL>"] += 1
                distances = [abs(event_day.toordinal() - gap_day) for gap_day, _work_id in gap_dates.get(cik, [])]
                if not distances:
                    fail("candidate lacks exact-CIK gap denominator")
                nearest_distances.append(min(distances))
                for gap_day, work_id in gap_dates[cik]:
                    if abs(event_day.toordinal() - gap_day) <= 120:
                        event_gap_pairs += 1
                        matched_gap_rows.add(work_id)
            expected_offset += len(rows)
            total_rows += len(rows)
            total_bytes += len(raw)
            page_count += 1
        if expected_offset != partition.get("recordTotal") or len(partition_ids) != partition.get("recordTotal"):
            fail("FINRA partition total changed")
    if total_rows != 145_103 or total_bytes != 257_639_538 or page_count != 1556 or len(identifiers) != 145_103 or sequence.hexdigest() != FINRA_ROW_SEQUENCE:
        fail("FINRA full private rebuild changed")
    if partition_dates != sorted(set(partition_dates)) or len(partition_dates) != 1522:
        fail("FINRA partition date order changed")
    year_counts = {str(year): sum(item.year == year for item in partition_dates) for year in range(2016, 2025)}
    max_gap = max((right - left).days for left, right in zip(partition_dates, partition_dates[1:]))
    coverage = {
        "availableMinimumDate": partition_dates[0].isoformat(),
        "availableMaximumDate": partition_dates[-1].isoformat(),
        "partitionDatesByYear": year_counts,
        "maximumPartitionGapDays": max_gap,
        "periodCompleteAbsenceClaimAllowed": False,
        "pre2016Status": "UNRESOLVED_NOT_EXPOSED_BY_PARTITIONS_ENDPOINT",
    }
    nearest_distances.sort()
    if not nearest_distances:
        fail("candidate distance denominator disappeared")
    aggregate.update({
        "finraRows": total_rows,
        "identityRelevantFinraEvents": relevant_events,
        "candidateEvents": candidate_events,
        "candidateCiks": len(candidate_ciks),
        "ambiguousMultiCikEvents": ambiguous_events,
        "oldOnlyCandidateEvents": side_counts["OLD_ONLY_CANDIDATE"],
        "newOnlyCandidateEvents": side_counts["NEW_ONLY_CANDIDATE"],
        "dualSideCandidateEvents": side_counts["DUAL_SIDE_CANDIDATE"],
        "matchedGapRows": len(matched_gap_rows),
        "candidateEventGapPairs": event_gap_pairs,
        "candidateEventCodeCounts": dict(sorted(code_counts.items())),
        "nearestSameCikGapDayDistance": {
            "minimum": nearest_distances[0],
            "upperMedian": nearest_distances[len(nearest_distances) // 2],
            "maximum": nearest_distances[-1],
        },
    })
    if aggregate != EXPECTED_TOTALS:
        fail("frozen aggregate denominator changed")
    if coverage != EXPECTED_COVERAGE:
        fail("FINRA coverage disclosure changed")
    return {"aggregate": aggregate, "coverage": coverage, "aggregateSha256": sha(canonical({"aggregate": aggregate, "coverage": coverage}))}


def build_report(contract: dict[str, Any], rebuild: dict[str, Any], implementation_commit: str) -> dict[str, Any]:
    value = {
        "schema": "finra-form345-event-candidate-profile/v1",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "sourceBaseCommit": SOURCE_BASE,
        "implementationCommit": implementation_commit,
        "bindings": {
            "contractRawSha256": CONTRACT_RAW,
            "contractSha256": CONTRACT_SELF,
            "form345CaptureManifestRawSha256": FORM_MANIFEST_RAW,
            "form345CaptureManifestSha256": FORM_MANIFEST_SELF,
            "gapQueueRawSha256": QUEUE_RAW,
            "gapQueueSha256": QUEUE_SELF,
            "finraManifestRawSha256": FINRA_MANIFEST_RAW,
            "finraManifestSha256": FINRA_MANIFEST_SELF,
            "finraMetadataRawSha256": FINRA_METADATA_RAW,
            "finraMetadataSha256": FINRA_METADATA_SELF,
            "finraCheckpointRawSha256": FINRA_CHECKPOINT_RAW,
            "finraCheckpointSha256": FINRA_CHECKPOINT_SELF,
            "finraRowSequenceSha256": FINRA_ROW_SEQUENCE,
        },
        "rebuilds": [
            {"runId": "REBUILD_ONE", "status": "PASS", "aggregateSha256": rebuild["aggregateSha256"]},
            {"runId": "REBUILD_TWO", "status": "PASS", "aggregateSha256": rebuild["aggregateSha256"]},
        ],
        "aggregate": rebuild["aggregate"],
        "coverageDisclosure": rebuild["coverage"],
        "privacy": {
            "aggregateOnly": True, "privateRowsIncluded": False, "identifiersIncluded": False,
            "symbolsIncluded": False, "namesOrDescriptionsIncluded": False,
            "accessionsIncluded": False, "candidateRowHashesIncluded": False,
        },
        "interpretation": {
            "status": "CIK_BOUNDED_EVENT_CANDIDATES_ONLY",
            "matchedGapRows": 0,
            "resolvedRows": 0,
            "mayInferIdentityListingIntervalOrTickerReuse": False,
            "mayInferTerminalSessionPaymentWealthOrReturn": False,
            "originalV4GateCredit": False,
        },
        "claimLocks": contract["claimLocks"],
        "outcomesAccessed": False,
        "reportSha256": "",
    }
    value["reportSha256"] = self_hash(value, "reportSha256")
    return value


def validate_report_shape(value: dict[str, Any], contract: dict[str, Any], rebuild: dict[str, Any], implementation_commit: str) -> None:
    exact_keys(value, {
        "schema", "taskId", "track", "sourceBaseCommit", "implementationCommit", "bindings",
        "rebuilds", "aggregate", "coverageDisclosure", "privacy", "interpretation",
        "claimLocks", "outcomesAccessed", "reportSha256",
    }, "public report")
    if value.get("reportSha256") != self_hash(value, "reportSha256"):
        fail("public report self binding changed")
    expected = build_report(contract, rebuild, implementation_commit)
    if value != expected:
        fail("public report differs from exact aggregate rebuild")
    if value["claimLocks"] != contract["claimLocks"] or any(item is not False for item in value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("public report claim lock changed")
    if value["privacy"] != {
        "aggregateOnly": True, "privateRowsIncluded": False, "identifiersIncluded": False,
        "symbolsIncluded": False, "namesOrDescriptionsIncluded": False,
        "accessionsIncluded": False, "candidateRowHashesIncluded": False,
    }:
        fail("public report privacy boundary changed")


def write_new(path: Path, raw: bytes) -> None:
    if path.exists():
        fail("output exists")
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (ProfileError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def synthetic_rebuild() -> dict[str, Any]:
    return {"aggregate": copy.deepcopy(EXPECTED_TOTALS), "coverage": copy.deepcopy(EXPECTED_COVERAGE), "aggregateSha256": sha(canonical({"aggregate": EXPECTED_TOTALS, "coverage": EXPECTED_COVERAGE}))}


def self_test(contract: dict[str, Any]) -> dict[str, Any]:
    ordinal = date(2020, 6, 1).toordinal()
    index = {
        "OLD": [(ordinal - 120, "0000000001")],
        "FUTUREOLD": [(ordinal + 1, "0000000001")],
        "NEW": [(ordinal + 120, "0000000001")],
        "PASTNEW": [(ordinal - 1, "0000000001")],
        "SHARED": [(ordinal, "0000000001"), (ordinal, "0000000002")],
        "ABC.A": [(ordinal, "0000000001")],
    }
    event_day = date.fromordinal(ordinal)
    selection_kills = {
        "placeholderQuarantined": classify_event(index, "N/A", None, event_day)[0] == "UNMATCHED",
        "multipleCikAmbiguous": classify_event(index, "SHARED", None, event_day)[0] == "AMBIGUOUS_MULTI_CIK",
        "oldDirectionAccepted": classify_event(index, "OLD", None, event_day)[0] == "OLD_ONLY_CANDIDATE",
        "oldWrongDirectionRejected": classify_event(index, "FUTUREOLD", None, event_day)[0] == "UNMATCHED",
        "newDirectionAccepted": classify_event(index, None, "NEW", event_day)[0] == "NEW_ONLY_CANDIDATE",
        "newWrongDirectionRejected": classify_event(index, None, "PASTNEW", event_day)[0] == "UNMATCHED",
        "punctuationRewriteRejected": classify_event(index, "ABCA", None, event_day)[0] == "UNMATCHED",
        "exact120Inclusive": classify_event(index, "OLD", "NEW", event_day)[0] == "DUAL_SIDE_CANDIDATE",
        "gapOutsideWindowRejected": abs(ordinal - (ordinal + 121)) > 120,
    }
    if not all(selection_kills.values()):
        fail("synthetic selection kill failed")
    rebuild = synthetic_rebuild()
    report = build_report(contract, rebuild, "a" * 40)
    validate_report_shape(report, contract, rebuild, "a" * 40)
    report_kills: dict[str, bool] = {}
    mutations = {
        "rowLevelField": lambda item: item.__setitem__("rows", []),
        "candidateCount": lambda item: item["aggregate"].__setitem__("candidateEvents", 9),
        "matchedGapPromotion": lambda item: item["aggregate"].__setitem__("matchedGapRows", 1),
        "identityPromotion": lambda item: item["claimLocks"].__setitem__("securityIdentityResolved", True),
        "tickerReusePromotion": lambda item: item["claimLocks"].__setitem__("tickerReuseResolved", True),
        "terminalPromotion": lambda item: item["claimLocks"].__setitem__("terminalWealthComplete", True),
        "gateCredit": lambda item: item["claimLocks"].__setitem__("originalV4GateCredit", True),
        "outcomeAccess": lambda item: item.__setitem__("outcomesAccessed", True),
        "privateSymbolFlag": lambda item: item["privacy"].__setitem__("symbolsIncluded", True),
        "rebuildMismatch": lambda item: item["rebuilds"][1].__setitem__("aggregateSha256", "b" * 64),
    }
    for name, mutate in mutations.items():
        item = copy.deepcopy(report)
        mutate(item)
        item["reportSha256"] = self_hash(item, "reportSha256")
        report_kills[name] = rejected(lambda item=item: validate_report_shape(item, contract, rebuild, "a" * 40))
    if not all(report_kills.values()):
        fail("synthetic report kill failed")
    return {
        "schema": "finra-form345-event-candidate-profile-self-test/v1", "status": "PASS",
        "selectionKills": selection_kills, "reportKills": report_kills,
        "outcomesAccessed": False,
    }


def verify_contract() -> dict[str, Any]:
    contract = load_contract()
    topology = verify_source_base()
    module = load_form_module()
    form_contract, _ = module.load_contract()
    v1 = module.validate_v1_bindings(form_contract)
    module.load_capture_manifest(module.default_private_root(), form_contract, v1, deep=False)
    load_queue()
    load_finra_inputs()
    if OUTPUT.exists():
        fail("future output exists during pre-output verification")
    return {
        "schema": "finra-form345-event-candidate-profile-contract-verification/v1",
        "status": "PASS", "sourceBaseCommit": topology["sourceBase"],
        "currentHead": topology["head"], "outcomesAccessed": False,
    }


def rebuild_twice(contract: dict[str, Any]) -> dict[str, Any]:
    first = rebuild_once(contract)
    second = rebuild_once(contract)
    if first != second:
        fail("two full private rebuilds differ")
    return first


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "rebuild-digest", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract = load_contract()
        if args.command == "verify-contract":
            result = verify_contract()
        elif args.command == "self-test":
            verify_source_base()
            result = self_test(contract)
        elif args.command == "rebuild-digest":
            verify_contract()
            rebuilt = rebuild_twice(contract)
            result = {
                "schema": "finra-form345-event-candidate-profile-rebuild/v1", "status": "PASS",
                "aggregateSha256": rebuilt["aggregateSha256"],
                "candidateEvents": rebuilt["aggregate"]["candidateEvents"],
                "candidateCiks": rebuilt["aggregate"]["candidateCiks"],
                "matchedGapRows": rebuilt["aggregate"]["matchedGapRows"],
                "twoIndependentFullRebuilds": True, "outcomesAccessed": False,
            }
        elif args.command == "build":
            topology = verify_implementation_topology(False)
            rebuilt = rebuild_twice(contract)
            report = build_report(contract, rebuilt, topology["implementationCommit"])
            validate_report_shape(report, contract, rebuilt, topology["implementationCommit"])
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {
                "schema": "finra-form345-event-candidate-profile-build/v1", "status": "PASS",
                "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw),
                "reportSha256": report["reportSha256"], "candidateEvents": 8,
                "candidateCiks": 5, "matchedGapRows": 0, "outcomesAccessed": False,
            }
        else:
            topology = verify_implementation_topology(True)
            rebuilt = rebuild_twice(contract)
            raw = OUTPUT.read_bytes()
            report = json.loads(raw)
            validate_report_shape(report, contract, rebuilt, topology["implementationCommit"])
            result = {
                "schema": "finra-form345-event-candidate-profile-verification/v1", "status": "PASS",
                "rawSha256": sha(raw), "reportSha256": report["reportSha256"],
                "privateSourceRebuildVerified": True, "candidateEvents": 8,
                "candidateCiks": 5, "matchedGapRows": 0, "outcomesAccessed": False,
            }
    except (ProfileError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
