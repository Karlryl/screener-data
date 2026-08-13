#!/usr/bin/env python3
"""Build the bounded SEC Form-345/primary-descriptor identity crosswalk."""

from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import os
import subprocess
import tempfile
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form345-primary-descriptor-crosswalk-contract-v1.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-form345-primary-descriptor-crosswalk-v1.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-form345-primary-descriptor-crosswalk-v1.json"

QUEUE = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-queue-v5.json"
PRIMARY_CROSSWALK = ROOT / "reports" / "early-detection" / "sec-terminal-primary-queue-crosswalk-v1.json"
RESOLUTION = ROOT / "reports" / "early-detection" / "sec-terminal-primary-issuer-cik-resolution-v1.json"
GAP_QUEUE = ROOT / "reports" / "early-detection" / "sec-terminal-identity-evidence-gap-queue-v1.json"
POINT_PROFILE = ROOT / "reports" / "early-detection" / "sec-company-ticker-target-asof-profile-v1.json"
DESCRIPTOR = ROOT / "reports" / "early-detection" / "sec-primary-security-descriptor-v1.json"
FORM345_MANIFEST = ROOT / "reports" / "early-detection" / "sec-form345-issuer-symbol-point-v3-gzip-manifest.json"
FORM345_GZIP = ROOT / "reports" / "early-detection" / "sec-form345-issuer-symbol-point-v3.json.gz"

CONTRACT_RAW = "2c866f99e723e8faf72750eb99f695864a38199a415bbb2c738d11fd0cf7dc33"
CONTRACT_SELF = "e142799d16e7d0764792486627740c3dd224a3d46b154678e6b75941bdf80cdb"
SEALED_BASE = "996fd2eeb7f2193cfc6352ca15ab544d3f09ae4c"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
OWN_PATHS = (CONTRACT, BUILDER, TEST)
PLACEHOLDERS = {"-", "N/A", "NA", "NONE", "NOT APPLICABLE", "NO SYMBOL", "NULL"}


class CrosswalkError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise CrosswalkError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def git_text(*args: str) -> str:
    run = subprocess.run(
        ["git", *args], cwd=ROOT, check=False, capture_output=True,
        text=True, encoding="utf-8",
    )
    if run.returncode:
        fail("Git binding failed")
    return run.stdout.strip()


def git_raw(commit: str, path: Path) -> bytes:
    relative = path.relative_to(ROOT).as_posix()
    run = subprocess.run(
        ["git", "show", f"{commit}:{relative}"], cwd=ROOT,
        check=False, capture_output=True,
    )
    if run.returncode:
        fail(f"Git blob missing: {relative}")
    return run.stdout


def tree_path_exists(commit: str, path: Path) -> bool:
    relative = path.relative_to(ROOT).as_posix()
    return subprocess.run(
        ["git", "cat-file", "-e", f"{commit}:{relative}"], cwd=ROOT,
        check=False, capture_output=True,
    ).returncode == 0


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claimed = body.pop("contractSha256", None)
    if claimed != CONTRACT_SELF or sha(canonical(body)) != CONTRACT_SELF:
        fail("contract self binding changed")
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose",
        "implementationTopology", "inputs", "joinContract", "knownAtPolicy",
        "expectedPopulation", "noGoClaims", "claimLocks", "contractSha256",
    }, "contract")
    if value["schema"] != "early-detection-sec-form345-primary-descriptor-crosswalk-contract/v1":
        fail("contract schema changed")
    if value["taskId"] != "Q005-SEC-FORM345-PRIMARY-DESCRIPTOR-CROSSWALK-V1" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract study boundary changed")
    topology = value["implementationTopology"]
    if topology["sealedBaseCommit"] != SEALED_BASE or topology["sealedBaseTag"] != 854:
        fail("sealed implementation base changed")
    if topology["remote"] != REMOTE or topology["ref"] != REF:
        fail("remote binding changed")
    expected_own = [path.relative_to(ROOT).as_posix() for path in OWN_PATHS]
    if topology["ownPaths"] != expected_own or topology["futureOutputPath"] != OUTPUT.relative_to(ROOT).as_posix():
        fail("owned path set changed")
    required_true = (
        "sealedBaseMustRemainAncestor",
        "historyFromSealedBaseThroughCurrentHeadMustBeLinearSingleParent",
        "implementationIntroductionMayFollowUnrelatedLinearCommits",
        "implementationIntroductionAddsExactlyOwnThreePaths",
        "futureOutputMustRemainAbsentDuringImplementationValidation",
    )
    if any(topology[key] is not True for key in required_true):
        fail("implementation topology weakened")
    if topology["implementationIntroductionDirectChildOfSealedBaseRequired"] is not False:
        fail("contract makes an untrue direct-child claim")
    join = value["joinContract"]
    if join["expectedRows"] != 656 or join["oneOutputRowPerWorkItem"] is not True:
        fail("join denominator changed")
    if join["rawIssuerTradingSymbolMustRemainUnsplitAndUnnormalized"] is not True:
        fail("raw literal policy weakened")
    if join["tickerJoinAllowed"] is not False or join["issuerNameJoinAllowed"] is not False:
        fail("prohibited join enabled")
    if join["allowedPointStatuses"] != ["NO_PRIOR_POINT", "ONE_LATEST_LITERAL", "CONFLICTING_LATEST_LITERALS"]:
        fail("point status set changed")
    if join["allowedArchiveComparisonStatuses"] != ["EXACT_LITERAL_MATCH", "EXACT_LITERAL_MISMATCH", "NO_COMPARABLE_CANDIDATE"]:
        fail("archive comparison status set changed")
    if value["knownAtPolicy"]["historicalPublicKnownAtUtc"] is not None:
        fail("historical public knownAt invented")
    if value["knownAtPolicy"]["historicalStudyFeatureAuthorization"] is not False:
        fail("historical study feature authorization changed")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("contract claim lock changed")
    return value


def topology_state(
    contract: dict[str, Any], remote_required: bool = True,
    allow_local_uncommitted_output: bool = False,
) -> dict[str, Any]:
    head = git_text("rev-parse", "HEAD")
    if git_text("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    if subprocess.run(["git", "merge-base", "--is-ancestor", SEALED_BASE, head], cwd=ROOT).returncode:
        fail("Tag854 is not an ancestor of current HEAD")
    upstream = git_text("rev-parse", "@{upstream}")
    if upstream != head:
        fail("HEAD and upstream differ")
    if remote_required:
        rows = git_text("ls-remote", "--refs", "origin", REF).splitlines()
        if len(rows) != 1 or rows[0].split()[0] != head:
            fail("live remote and current HEAD differ")

    commits = git_text("rev-list", "--ancestry-path", "--reverse", f"{SEALED_BASE}..{head}").splitlines()
    previous = SEALED_BASE
    for commit in commits:
        parents = git_text("show", "-s", "--format=%P", commit).split()
        if parents != [previous]:
            fail("post-Tag854 history is not a linear single-parent chain")
        previous = commit

    own_rel = {path.relative_to(ROOT).as_posix() for path in OWN_PATHS}
    contract_committed = tree_path_exists(head, CONTRACT)
    if not contract_committed:
        for path in (*OWN_PATHS, OUTPUT):
            if tree_path_exists(head, path):
                fail("planned path already exists in pre-implementation HEAD")
        if any(not path.is_file() for path in OWN_PATHS):
            fail("planned implementation file missing")
        return {"phase": "PRE_IMPLEMENTATION", "currentHead": head, "implementationIntroduction": None}

    introductions = {
        git_text("log", "--diff-filter=A", "-1", "--format=%H", "--", path.relative_to(ROOT).as_posix())
        for path in OWN_PATHS
    }
    if len(introductions) != 1 or "" in introductions:
        fail("owned paths do not share one introduction commit")
    introduction = next(iter(introductions))
    if introduction not in commits:
        fail("implementation introduction is not after sealed Tag854")
    changes = git_text("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines()
    if len(changes) != 3 or any(not row.startswith("A\t") for row in changes):
        fail("implementation introduction did not add exactly three paths")
    if {row.split("\t", 1)[1] for row in changes} != own_rel:
        fail("implementation introduction path set changed")
    intro_index = commits.index(introduction)
    forbidden_rel = own_rel | {OUTPUT.relative_to(ROOT).as_posix()}
    for commit in commits[:intro_index]:
        touched = set(git_text("diff-tree", "--no-commit-id", "--name-only", "-r", commit).splitlines())
        if touched & forbidden_rel:
            fail("pre-introduction intermediate commit touched an owned or output path")
    for commit in commits[intro_index + 1:]:
        touched = set(git_text("diff-tree", "--no-commit-id", "--name-only", "-r", commit).splitlines())
        if touched & own_rel:
            fail("post-introduction commit changed an owned implementation path")
    if tree_path_exists(head, OUTPUT) or tree_path_exists(introduction, OUTPUT):
        fail("future output entered implementation Git history")
    if OUTPUT.exists() and not allow_local_uncommitted_output:
        fail("future output must remain absent during implementation validation")
    for path in OWN_PATHS:
        local = path.read_bytes()
        if git_raw(introduction, path) != local or git_raw(head, path) != local:
            fail("owned worktree, introduction and HEAD bytes differ")
    return {"phase": "IMPLEMENTED_NO_OUTPUT", "currentHead": head, "implementationIntroduction": introduction}


def bind_git_input(binding: dict[str, Any], path: Path, raw_key: str = "rawSha256") -> None:
    relative = path.relative_to(ROOT).as_posix()
    expected_raw = binding[raw_key]
    expected_blob = binding["gitBlob"]
    local = path.read_bytes()
    if sha(local) != expected_raw:
        fail(f"input raw bytes changed: {relative}")
    if git_text("rev-parse", f"{SEALED_BASE}:{relative}") != expected_blob:
        fail(f"sealed-base Git blob changed: {relative}")
    if git_text("rev-parse", f"HEAD:{relative}") != expected_blob:
        fail(f"current Git blob changed: {relative}")
    if git_raw(SEALED_BASE, path) != local or git_raw("HEAD", path) != local:
        fail(f"input worktree differs from Git bytes: {relative}")
    if git_text("log", "--diff-filter=A", "-1", "--format=%H", "--", relative) != binding["introductionCommit"]:
        fail(f"input introduction changed: {relative}")


def load_self_hashed_report(path: Path, binding: dict[str, Any], self_key: str = "reportSha256") -> dict[str, Any]:
    bind_git_input(binding, path)
    raw = path.read_bytes()
    value = json.loads(raw)
    body = dict(value)
    claimed = body.pop(self_key, None)
    expected = binding[self_key]
    if claimed != expected or sha(canonical(body)) != expected:
        fail(f"input self binding changed: {path.name}")
    return value


def validate_private_receipts(contract: dict[str, Any]) -> tuple[dict[str, str], dict[str, Any]]:
    binding = contract["inputs"]["privateCaptureReceipts"]
    local_appdata = os.environ.get("LOCALAPPDATA")
    if not local_appdata:
        fail("LOCALAPPDATA missing")
    private_root = (Path(local_appdata) / "GrowthScreenerResearchData" / "private" / "sec-form345-issuer-symbol-point-v1").resolve()
    if not private_root.is_absolute() or private_root == ROOT or ROOT in private_root.parents or "OneDrive" in private_root.parts:
        fail("private capture root boundary changed")
    manifest_path = private_root / binding["manifestPath"]
    raw = manifest_path.read_bytes()
    if sha(raw) != binding["manifestRawSha256"]:
        fail("private capture manifest raw bytes changed")
    manifest = json.loads(raw)
    body = dict(manifest)
    claimed = body.pop("manifestSha256", None)
    if claimed != binding["manifestSha256"] or sha(canonical(body)) != claimed:
        fail("private capture manifest self binding changed")
    if manifest.get("quarterCount") != 64 or len(manifest.get("receipts", [])) != 64:
        fail("private receipt denominator changed")
    if manifest.get("quarterSequenceSha256") != binding["quarterSequenceSha256"] or manifest.get("captureSequenceSha256") != binding["captureSequenceSha256"]:
        fail("private receipt sequence changed")
    receipt_known_at: dict[str, str] = {}
    fetched: list[str] = []
    quarters: list[str] = []
    for item in manifest["receipts"]:
        receipt_path = private_root / item["receiptPath"]
        receipt_raw = receipt_path.read_bytes()
        raw_hash = sha(receipt_raw)
        if raw_hash != item["receiptRawSha256"]:
            fail("private receipt raw bytes changed")
        receipt = json.loads(receipt_raw)
        receipt_body = dict(receipt)
        receipt_claim = receipt_body.pop("receiptSha256", None)
        if receipt_claim != sha(canonical(receipt_body)):
            fail("private receipt self binding changed")
        if receipt.get("quarter") != item["quarter"] or receipt.get("rawSha256") != item["zipRawSha256"]:
            fail("private receipt-to-manifest binding changed")
        known = receipt.get("fetchedAtUtc")
        if not isinstance(known, str) or not known.endswith("Z"):
            fail("private receipt fetchedAt changed")
        if raw_hash in receipt_known_at:
            fail("duplicate private receipt raw hash")
        receipt_known_at[raw_hash] = known
        fetched.append(known)
        quarters.append(item["quarter"])
    if quarters != sorted(quarters) or len(set(quarters)) != 64:
        fail("private receipt quarter order changed")
    if min(fetched) != binding["fetchedAtUtcMinimum"] or max(fetched) != binding["fetchedAtUtcMaximum"]:
        fail("private receipt knownAt range changed")
    return receipt_known_at, manifest


def load_inputs(contract: dict[str, Any]) -> dict[str, Any]:
    bindings = contract["inputs"]
    queue = load_self_hashed_report(QUEUE, bindings["terminalWealthQueueV5"])
    primary = load_self_hashed_report(PRIMARY_CROSSWALK, bindings["primaryQueueCrosswalk"])
    resolution = load_self_hashed_report(RESOLUTION, bindings["issuerCikResolution"])
    gap = load_self_hashed_report(GAP_QUEUE, bindings["identityGapQueue"])
    profile = load_self_hashed_report(POINT_PROFILE, bindings["companyTickerPointProfile"])
    descriptor = load_self_hashed_report(DESCRIPTOR, bindings["primarySecurityDescriptor"])
    manifest = load_self_hashed_report(FORM345_MANIFEST, bindings["form345GzipManifest"], "manifestSha256")

    form_binding = bindings["form345PointSource"]
    bind_git_input({
        "gzipRawSha256": form_binding["gzipRawSha256"],
        "gitBlob": form_binding["gzipGitBlob"],
        "introductionCommit": form_binding["introductionCommit"],
    }, FORM345_GZIP, "gzipRawSha256")
    gzip_raw = FORM345_GZIP.read_bytes()
    if len(gzip_raw) != form_binding["gzipBytes"]:
        fail("Form345 gzip size changed")
    decompressed = gzip.decompress(gzip_raw)
    if len(decompressed) != form_binding["decompressedBytes"] or sha(decompressed) != form_binding["decompressedRawSha256"]:
        fail("Form345 decompressed bytes changed")
    form345 = json.loads(decompressed)
    form_body = dict(form345)
    form_claim = form_body.pop("reportSha256", None)
    if form_claim != form_binding["reportSha256"] or sha(canonical(form_body)) != form_claim:
        fail("Form345 decompressed self binding changed")
    if manifest.get("gzip", {}).get("rawSha256") != form_binding["gzipRawSha256"]:
        fail("Form345 manifest gzip binding changed")
    if manifest.get("decompressed", {}).get("rawSha256") != form_binding["decompressedRawSha256"] or manifest.get("decompressed", {}).get("reportSha256") != form_binding["reportSha256"]:
        fail("Form345 manifest decompressed binding changed")

    expected_rows = {
        "queue": (queue, 44352), "primary": (primary, 656),
        "resolution": (resolution, 656), "gap": (gap, 656),
        "profile": (profile, 656), "descriptor": (descriptor, 656),
        "form345": (form345, 656),
    }
    for label, (value, count) in expected_rows.items():
        rows = value.get("rows")
        if not isinstance(rows, list) or len(rows) != count:
            fail(f"{label} row denominator changed")
    if queue.get("counts", {}).get("rows") != 44352:
        fail("terminal queue count changed")
    if form345.get("population", {}).get("sourceAllRows") != 3352003 or form345.get("population", {}).get("sourceTargetPoints") != 164675:
        fail("Form345 source denominator changed")
    receipt_known_at, capture_manifest = validate_private_receipts(contract)
    return {
        "queue": queue, "primary": primary, "resolution": resolution,
        "gap": gap, "profile": profile, "descriptor": descriptor,
        "form345": form345, "receiptKnownAt": receipt_known_at,
        "captureManifest": capture_manifest,
    }


def unique_index(rows: list[dict[str, Any]], key: str, label: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        value = row.get(key)
        if not isinstance(value, str) or not value or value in result:
            fail(f"{label} unique key changed")
        result[value] = row
    return result


def exact_subset_equal(source: dict[str, Any], candidate: dict[str, Any], label: str) -> None:
    for key, value in candidate.items():
        if key not in source or source[key] != value:
            fail(f"{label} source subset changed")


def observation_with_known_at(observation: dict[str, Any], receipt_known_at: dict[str, str]) -> dict[str, Any]:
    receipt_hash = observation.get("captureReceiptRawSha256")
    if receipt_hash not in receipt_known_at:
        fail("Form345 observation receipt binding changed")
    result = copy.deepcopy(observation)
    result["localKnownAtUtc"] = receipt_known_at[receipt_hash]
    result["historicalPublicKnownAtUtc"] = None
    return result


def derive_point_evidence(
    observations: list[dict[str, Any]], event_date: str,
    archive_candidates: list[dict[str, Any]], receipt_known_at: dict[str, str],
) -> dict[str, Any]:
    if not isinstance(observations, list) or not isinstance(archive_candidates, list):
        fail("point evidence input changed")
    prior_all = [row for row in observations if row.get("filingDate") <= event_date]
    future_all = [row for row in observations if row.get("filingDate") > event_date]
    prior_placeholder = [row for row in prior_all if row.get("issuerTradingSymbol") in PLACEHOLDERS]
    future_placeholder = [row for row in future_all if row.get("issuerTradingSymbol") in PLACEHOLDERS]
    prior_usable = [row for row in prior_all if row.get("issuerTradingSymbol") not in PLACEHOLDERS]
    future_usable = [row for row in future_all if row.get("issuerTradingSymbol") not in PLACEHOLDERS]
    for row in observations:
        symbol = row.get("issuerTradingSymbol")
        if not isinstance(symbol, str) or not symbol:
            fail("Form345 raw literal changed")
        if row.get("filingDate") is None or row.get("issuerCik") is None:
            fail("Form345 observation key changed")

    latest_date: str | None = None
    latest_rows: list[dict[str, Any]] = []
    latest_literals: list[str] = []
    point_status = "NO_PRIOR_POINT"
    age_days: int | None = None
    if prior_usable:
        latest_date = max(row["filingDate"] for row in prior_usable)
        latest_rows = [row for row in prior_usable if row["filingDate"] == latest_date]
        latest_rows.sort(key=lambda row: (row["accessionNumber"], row["evidenceRowId"]))
        latest_literals = sorted({row["issuerTradingSymbol"] for row in latest_rows})
        point_status = "ONE_LATEST_LITERAL" if len(latest_literals) == 1 else "CONFLICTING_LATEST_LITERALS"
        age_days = (date.fromisoformat(event_date) - date.fromisoformat(latest_date)).days
        if age_days < 0:
            fail("future point selected")

    candidate_tickers = [candidate.get("ticker") for candidate in archive_candidates]
    if any(not isinstance(ticker, str) or not ticker for ticker in candidate_tickers):
        fail("archive candidate ticker changed")
    matched_literals = [literal for literal in latest_literals if literal in candidate_tickers]
    reasons: list[str] = []
    if not latest_literals:
        reasons.append("PRIOR_FORM345_POINT_ABSENT")
    if not archive_candidates:
        reasons.append("ARCHIVE_CANDIDATE_ABSENT")
    if latest_literals and archive_candidates:
        comparison_status = "EXACT_LITERAL_MATCH" if matched_literals else "EXACT_LITERAL_MISMATCH"
    else:
        comparison_status = "NO_COMPARABLE_CANDIDATE"

    known_values = sorted({receipt_known_at[row["captureReceiptRawSha256"]] for row in latest_rows})
    return {
        "pointStatus": point_status,
        "selectionCutoffInclusive": event_date,
        "latestPointDate": latest_date,
        "latestPointAgeDays": age_days,
        "latestRawLiterals": latest_literals,
        "priorRawLiterals": sorted({row["issuerTradingSymbol"] for row in prior_usable}),
        "latestEvidence": [observation_with_known_at(row, receipt_known_at) for row in latest_rows],
        "quarantinedPriorPlaceholderEvidence": [
            observation_with_known_at(row, receipt_known_at)
            for row in sorted(prior_placeholder, key=lambda row: (row["filingDate"], row["accessionNumber"], row["evidenceRowId"]))
        ],
        "counts": {
            "allObservationReferences": len(observations),
            "priorObservationReferences": len(prior_all),
            "futureObservationReferences": len(future_all),
            "priorUsableObservationReferences": len(prior_usable),
            "futureUsableObservationReferences": len(future_usable),
            "priorPlaceholderObservationReferences": len(prior_placeholder),
            "futurePlaceholderObservationReferences": len(future_placeholder),
        },
        "archiveComparison": {
            "status": comparison_status,
            "archiveCandidates": copy.deepcopy(archive_candidates),
            "matchedRawLiterals": matched_literals,
            "reasons": reasons,
            "comparisonNormalizationApplied": False,
        },
        "knownAt": {
            "evidenceDate": latest_date,
            "localKnownAtUtc": known_values,
            "historicalPublicKnownAtUtc": None,
            "retrospectiveIdentityEvidenceOnly": True,
            "historicalStudyFeatureAuthorized": False,
        },
    }


def age_bucket(value: int | None) -> str:
    if value is None:
        return "NO_PRIOR_POINT"
    if value == 0:
        return "EXACT_EVENT_DAY"
    if value <= 7:
        return "DAYS_1_TO_7"
    if value <= 30:
        return "DAYS_8_TO_30"
    if value <= 90:
        return "DAYS_31_TO_90"
    if value <= 365:
        return "DAYS_91_TO_365"
    return "OVER_365_DAYS"


def reuse_counts(form_rows: list[dict[str, Any]]) -> tuple[int, int]:
    by_literal: dict[str, dict[str, list[str]]] = {}
    for row in form_rows:
        cik = row["issuerCik"]
        for observation in row["observations"]:
            literal = observation["issuerTradingSymbol"]
            if literal in PLACEHOLDERS:
                continue
            by_literal.setdefault(literal, {}).setdefault(cik, []).append(observation["filingDate"])
    reused = 0
    overlaps = 0
    for by_cik in by_literal.values():
        if len(by_cik) <= 1:
            continue
        reused += 1
        ranges = [(min(days), max(days)) for days in by_cik.values()]
        overlap = any(
            left_min <= right_max and right_min <= left_max
            for index, (left_min, left_max) in enumerate(ranges)
            for right_min, right_max in ranges[index + 1:]
        )
        if overlap:
            overlaps += 1
    return reused, overlaps


def build_rows(inputs: dict[str, Any]) -> list[dict[str, Any]]:
    queue_by_id = unique_index(inputs["queue"]["rows"], "rowId", "terminal queue")
    primary_by_id = unique_index(inputs["primary"]["rows"], "crosswalkRowId", "primary crosswalk")
    resolution_by_id = unique_index(inputs["resolution"]["rows"], "resolutionRowId", "issuer resolution")
    profile_by_id = unique_index(inputs["profile"]["rows"], "profileRowId", "point profile")
    descriptor_by_work = unique_index(inputs["descriptor"]["rows"], "gapWorkItemId", "primary descriptor")
    form_by_work = unique_index(inputs["form345"]["rows"], "workItemId", "Form345")
    gap_by_work = unique_index(inputs["gap"]["rows"], "workItemId", "gap queue")
    if len(gap_by_work) != 656:
        fail("gap work-item denominator changed")

    output: list[dict[str, Any]] = []
    for gap in inputs["gap"]["rows"]:
        work_id = gap["workItemId"]
        resolution = resolution_by_id.get(gap["sourceResolutionRowId"])
        profile = profile_by_id.get(gap["sourceProfileRowId"])
        descriptor = descriptor_by_work.get(work_id)
        form = form_by_work.get(work_id)
        if resolution is None or profile is None or descriptor is None or form is None:
            fail("exact work-item evidence chain changed")
        primary = primary_by_id.get(resolution["sourceCrosswalkRowId"])
        if primary is None:
            fail("primary crosswalk pointer changed")
        selected_queue = resolution.get("selectedIssuerQueueRow")
        if not isinstance(selected_queue, dict):
            fail("selected issuer queue row changed")
        queue = queue_by_id.get(selected_queue.get("rowId"))
        if queue is None:
            fail("terminal queue pointer changed")
        exact_subset_equal(queue, selected_queue, "selected terminal queue row")

        expected = (gap["accession"], gap["issuerCik"], gap["filedDate"])
        values = [
            (resolution["accession"], resolution["sourceDerivedIssuerCik"], resolution["selectedIssuerQueueRow"]["filedDate"]),
            (profile["accession"], profile["sourceDerivedIssuerCik"], profile["queueFiledDate"]),
            (descriptor["accession"], descriptor["queueIssuerCikGuard"], descriptor["filedDate"]),
            (form["issuerCik"], form["issuerCik"], gap["filedDate"]),
            (queue["accession"], queue["cik"], queue["filedDate"]),
        ]
        if values[0] != expected or values[1] != expected or values[2] != expected or values[4] != expected:
            fail("accession, CIK or filed-date chain changed")
        if form["issuerCik"] != gap["issuerCik"]:
            fail("Form345 CIK guard changed")
        if primary["accession"] != gap["accession"]:
            fail("primary crosswalk accession changed")
        if primary["sourceCandidateId"] != resolution["sourceCandidateId"]:
            fail("primary-to-resolution candidate pointer changed")
        if gap["pointEvidence"] != {
            "pointState": profile["pointState"],
            "snapshot": profile["snapshot"],
            "tickerCandidates": profile["pointTickerCandidates"],
        }:
            fail("gap-to-profile point evidence changed")

        point = derive_point_evidence(
            form["observations"], gap["filedDate"],
            gap["pointEvidence"]["tickerCandidates"], inputs["receiptKnownAt"],
        )
        row = {
            "workItemId": work_id,
            "eventAccession": gap["accession"],
            "eventFiledDate": gap["filedDate"],
            "issuerCik": gap["issuerCik"],
            "gapClass": gap["gapClass"],
            "sourceLane": descriptor["sourceLane"],
            "provenance": {
                "descriptorRowId": descriptor["descriptorRowId"],
                "sourceMetadataRowIds": copy.deepcopy(descriptor["sourceMetadataRowIds"]),
                "sourceProfileRowId": gap["sourceProfileRowId"],
                "sourceResolutionRowId": gap["sourceResolutionRowId"],
                "sourcePrimaryCrosswalkRowId": resolution["sourceCrosswalkRowId"],
                "selectedTerminalQueueRowId": selected_queue["rowId"],
            },
            "primarySecurityDescriptor": {
                "descriptors": copy.deepcopy(descriptor["descriptors"]),
                "missingFields": copy.deepcopy(descriptor["missingFields"]),
                "ambiguousFields": copy.deepcopy(descriptor["ambiguousFields"]),
            },
            "archivePointEvidence": copy.deepcopy(gap["pointEvidence"]),
            "form345PointEvidence": point,
            "resolutionCreditGranted": False,
            "historicalIdentityResolved": False,
            "securityIdentityResolved": False,
            "listingIdentityResolved": False,
            "tickerReuseResolved": False,
            "terminalWealthComplete": False,
            "originalV4GateCredit": False,
            "outcomesAccessed": False,
        }
        row["rowSha256"] = sha(canonical(row))
        output.append(row)
    output.sort(key=lambda row: row["workItemId"])
    return output


def population(rows: list[dict[str, Any]], inputs: dict[str, Any]) -> dict[str, Any]:
    point_status = Counter(row["form345PointEvidence"]["pointStatus"] for row in rows)
    comparisons = Counter(row["form345PointEvidence"]["archiveComparison"]["status"] for row in rows)
    gaps = Counter(row["gapClass"] for row in rows)
    lanes = Counter(row["sourceLane"] for row in rows)
    ages = Counter(age_bucket(row["form345PointEvidence"]["latestPointAgeDays"]) for row in rows)
    totals = Counter()
    for row in rows:
        totals.update(row["form345PointEvidence"]["counts"])
    reused, overlaps = reuse_counts(inputs["form345"]["rows"])
    return {
        "rows": len(rows),
        "uniqueAccessions": len({row["eventAccession"] for row in rows}),
        "uniqueIssuerCiks": len({row["issuerCik"] for row in rows}),
        "sourceLaneCounts": dict(sorted(lanes.items())),
        "pointStatusCounts": dict(sorted(point_status.items())),
        "archiveComparisonCounts": dict(sorted(comparisons.items())),
        "gapClassCounts": dict(sorted(gaps.items())),
        "latestPointAgeDaysCounts": dict(sorted(ages.items())),
        "rowsWithMultiplePreEventRawLiterals": sum(
            len(row["form345PointEvidence"]["priorRawLiterals"]) > 1 for row in rows
        ),
        "latestEvidenceRows": sum(len(row["form345PointEvidence"]["latestEvidence"]) for row in rows),
        "workItemObservationReferences": totals["allObservationReferences"],
        "priorObservationReferences": totals["priorObservationReferences"],
        "futureObservationReferences": totals["futureObservationReferences"],
        "priorUsableObservationReferences": totals["priorUsableObservationReferences"],
        "futureUsableObservationReferences": totals["futureUsableObservationReferences"],
        "priorPlaceholderObservationReferences": totals["priorPlaceholderObservationReferences"],
        "futurePlaceholderObservationReferences": totals["futurePlaceholderObservationReferences"],
        "rawLiteralsReusedAcrossTargetCiks": reused,
        "reusedRawLiteralsWithOverlappingObservedDateSpans": overlaps,
        "resolvedRows": 0,
    }


def implementation_bindings(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "sealedBaseCommit": SEALED_BASE,
        "currentHead": state["currentHead"],
        "phase": state["phase"],
        "implementationIntroduction": state["implementationIntroduction"],
        "remote": REMOTE,
        "ref": REF,
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "builderRawSha256": sha(BUILDER.read_bytes()),
        "testRawSha256": sha(TEST.read_bytes()),
    }


def build_report(contract: dict[str, Any], inputs: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    rows = build_rows(inputs)
    counts = population(rows, inputs)
    if counts != contract["expectedPopulation"]:
        fail("source-derived crosswalk population changed")
    value = {
        "schema": "early-detection-sec-form345-primary-descriptor-crosswalk/v1",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": CONTRACT_RAW,
        "inputBindings": copy.deepcopy(contract["inputs"]),
        "implementationBindings": implementation_bindings(state),
        "joinContract": copy.deepcopy(contract["joinContract"]),
        "knownAtPolicy": copy.deepcopy(contract["knownAtPolicy"]),
        "population": counts,
        "noGoClaims": copy.deepcopy(contract["noGoClaims"]),
        "rows": rows,
        "claimLocks": copy.deepcopy(contract["claimLocks"]),
        "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], expected: dict[str, Any]) -> None:
    if value != expected:
        fail("crosswalk differs from full source rebuild")
    body = dict(value)
    claimed = body.pop("reportSha256", None)
    if claimed != sha(canonical(body)):
        fail("crosswalk report self hash changed")
    if any(item is not False for item in value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("crosswalk claim boundary changed")
    for row in value["rows"]:
        row_body = dict(row)
        row_claim = row_body.pop("rowSha256", None)
        if row_claim != sha(canonical(row_body)):
            fail("crosswalk row self hash changed")
        if any(row[key] is not False for key in (
            "resolutionCreditGranted", "historicalIdentityResolved", "securityIdentityResolved",
            "listingIdentityResolved", "tickerReuseResolved", "terminalWealthComplete",
            "originalV4GateCredit", "outcomesAccessed",
        )):
            fail("row claim boundary changed")
        point = row["form345PointEvidence"]
        if point["knownAt"]["historicalPublicKnownAtUtc"] is not None:
            fail("row historical public knownAt invented")
        if point["archiveComparison"]["comparisonNormalizationApplied"] is not False:
            fail("archive comparison normalization enabled")


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (CrosswalkError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError, gzip.BadGzipFile):
        return True
    return False


def fixture_tests() -> dict[str, bool]:
    known = {"r1": "2026-08-13T00:22:23Z"}

    def observation(day: str, symbol: str, row_id: str) -> dict[str, Any]:
        return {
            "accessionNumber": f"0000000001-20-{row_id[-6:].zfill(6)}",
            "captureReceiptRawSha256": "r1",
            "documentType": "4",
            "evidenceRowId": row_id,
            "filingDate": day,
            "issuerCik": "0000000001",
            "issuerName": "FIXTURE",
            "issuerNameState": "PRESENT_SOURCE_VALUE",
            "issuerTradingSymbol": symbol,
            "sourceQuarter": "2020Q1",
            "sourceSubmissionRawSha256": "s",
            "sourceZipRawSha256": "z",
        }

    compound = derive_point_evidence([observation("2020-01-01", "PLA, PLAA", "a")], "2020-01-02", [], known)
    conflict = derive_point_evidence([
        observation("2020-01-02", "WNI", "a"), observation("2020-01-02", "SHF", "b"),
    ], "2020-01-02", [], known)
    case_mismatch = derive_point_evidence([observation("2020-01-01", "isns", "a")], "2020-01-02", [{"ticker": "ISNS"}], known)
    future = derive_point_evidence([observation("2020-01-03", "FUT", "a")], "2020-01-02", [{"ticker": "FUT"}], known)
    placeholder = derive_point_evidence([observation("2020-01-01", "N/A", "a")], "2020-01-02", [], known)
    return {
        "compoundLiteralNotSplit": compound["latestRawLiterals"] == ["PLA, PLAA"],
        "sameDayConflictNotChosen": conflict["pointStatus"] == "CONFLICTING_LATEST_LITERALS" and conflict["latestRawLiterals"] == ["SHF", "WNI"],
        "caseDifferenceIsExactMismatch": case_mismatch["archiveComparison"]["status"] == "EXACT_LITERAL_MISMATCH",
        "futurePointNeverSelected": future["pointStatus"] == "NO_PRIOR_POINT" and future["counts"]["futureUsableObservationReferences"] == 1,
        "placeholderQuarantined": placeholder["pointStatus"] == "NO_PRIOR_POINT" and len(placeholder["quarantinedPriorPlaceholderEvidence"]) == 1,
        "historicalPublicKnownAtNull": compound["knownAt"]["historicalPublicKnownAtUtc"] is None,
    }


def self_test(contract: dict[str, Any], inputs: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    expected = build_report(contract, inputs, state)
    validate_report(expected, expected)
    kills: dict[str, bool] = {}
    mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "rowRemoved": lambda value: value["rows"].pop(),
        "literalSplit": lambda value: value["rows"][0]["form345PointEvidence"]["latestRawLiterals"].append("SPLIT"),
        "literalNormalized": lambda value: value["rows"][0]["form345PointEvidence"]["archiveComparison"].__setitem__("comparisonNormalizationApplied", True),
        "conflictChosen": lambda value: next(row for row in value["rows"] if row["form345PointEvidence"]["pointStatus"] == "CONFLICTING_LATEST_LITERALS")["form345PointEvidence"].__setitem__("pointStatus", "ONE_LATEST_LITERAL"),
        "futureLiteralCopied": lambda value: value["rows"][0]["form345PointEvidence"].__setitem__("futureRawLiterals", ["LEAK"]),
        "archiveStatusChanged": lambda value: value["rows"][0]["form345PointEvidence"]["archiveComparison"].__setitem__("status", "EXACT_LITERAL_MATCH"),
        "historicalKnownAtInvented": lambda value: value["rows"][0]["form345PointEvidence"]["knownAt"].__setitem__("historicalPublicKnownAtUtc", "2010-01-01T00:00:00Z"),
        "localKnownAtChanged": lambda value: value["rows"][0]["form345PointEvidence"]["knownAt"].__setitem__("localKnownAtUtc", ["2010-01-01T00:00:00Z"]),
        "descriptorChanged": lambda value: value["rows"][0]["primarySecurityDescriptor"].__setitem__("missingFields", []),
        "workItemChanged": lambda value: value["rows"][0].__setitem__("workItemId", "TAMPER"),
        "identityResolved": lambda value: value["rows"][0].__setitem__("historicalIdentityResolved", True),
        "securityResolved": lambda value: value["rows"][0].__setitem__("securityIdentityResolved", True),
        "listingResolved": lambda value: value["rows"][0].__setitem__("listingIdentityResolved", True),
        "tickerReuseResolved": lambda value: value["rows"][0].__setitem__("tickerReuseResolved", True),
        "resolutionCredit": lambda value: value["rows"][0].__setitem__("resolutionCreditGranted", True),
        "terminalWealth": lambda value: value["rows"][0].__setitem__("terminalWealthComplete", True),
        "originalGateCredit": lambda value: value["rows"][0].__setitem__("originalV4GateCredit", True),
        "outcomesAccessed": lambda value: value.__setitem__("outcomesAccessed", True),
        "claimLockChanged": lambda value: value["claimLocks"].__setitem__("historicalIdentityResolved", True),
        "inputBindingChanged": lambda value: value["inputBindings"]["identityGapQueue"].__setitem__("rawSha256", "0" * 64),
    }
    for name, mutate in mutations.items():
        value = copy.deepcopy(expected)
        mutate(value)
        for row in value.get("rows", []):
            row_body = {key: item for key, item in row.items() if key != "rowSha256"}
            row["rowSha256"] = sha(canonical(row_body))
        value["reportSha256"] = sha(canonical({key: item for key, item in value.items() if key != "reportSha256"}))
        kills[name] = rejected(lambda value=value: validate_report(value, expected))
    fixtures = fixture_tests()
    if not all(kills.values()) or not all(fixtures.values()):
        fail("adversarial self-test did not fail closed")
    return {
        "schema": "early-detection-sec-form345-primary-descriptor-crosswalk-self-test/v1",
        "status": "PASS",
        "verifiedRows": 656,
        "mutationKills": kills,
        "fixtureKills": fixtures,
        "reportSha256": expected["reportSha256"],
        "outcomesAccessed": False,
    }


def write_new(path: Path, raw: bytes) -> None:
    if path.exists():
        fail("future output already exists")
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "dry-run", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract = validate_contract()
        state = topology_state(
            contract, remote_required=True,
            allow_local_uncommitted_output=args.command == "verify-output",
        )
        inputs = load_inputs(contract)
        if args.command == "verify-contract":
            report = build_report(contract, inputs, state)
            result = {
                "schema": "early-detection-sec-form345-primary-descriptor-crosswalk-contract-verification/v1",
                "status": "PASS", "phase": state["phase"], "currentHead": state["currentHead"],
                "verifiedRows": 656, "population": report["population"],
                "fullSourceRebuild": True, "outcomesAccessed": False,
            }
        elif args.command == "self-test":
            result = self_test(contract, inputs, state)
        elif args.command == "dry-run":
            report = build_report(contract, inputs, state)
            validate_report(report, report)
            result = {
                "schema": "early-detection-sec-form345-primary-descriptor-crosswalk-dry-run/v1",
                "status": "PASS", "phase": state["phase"], "currentHead": state["currentHead"],
                "verifiedRows": 656, "population": report["population"],
                "reportSha256": report["reportSha256"], "outputCreated": False,
                "fullSourceRebuild": True, "outcomesAccessed": False,
            }
        elif args.command == "build":
            if state["phase"] != "IMPLEMENTED_NO_OUTPUT":
                fail("build requires the committed implementation introduction")
            report = build_report(contract, inputs, state)
            validate_report(report, report)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {
                "schema": "early-detection-sec-form345-primary-descriptor-crosswalk-build/v1",
                "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(),
                "rawSha256": sha(raw), "reportSha256": report["reportSha256"],
                "rows": 656, "fullSourceRebuild": True, "outcomesAccessed": False,
            }
        else:
            if state["phase"] != "IMPLEMENTED_NO_OUTPUT":
                fail("output verification requires committed implementation")
            raw = OUTPUT.read_bytes()
            value = json.loads(raw)
            expected = build_report(contract, inputs, state)
            validate_report(value, expected)
            result = {
                "schema": "early-detection-sec-form345-primary-descriptor-crosswalk-verification/v1",
                "status": "PASS", "rawSha256": sha(raw),
                "reportSha256": value["reportSha256"], "rows": 656,
                "fullSourceRebuild": True, "outcomesAccessed": False,
            }
    except (CrosswalkError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError, gzip.BadGzipFile) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
