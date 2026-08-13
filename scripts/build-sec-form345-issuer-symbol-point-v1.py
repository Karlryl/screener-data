#!/usr/bin/env python3
"""Capture and build SEC Form 3/4/5 issuer-symbol point evidence only."""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-form345-issuer-symbol-point-contract-v1.json"
BUILDER_PATH = Path(__file__).resolve()
TEST_PATH = ROOT / "tests" / "build-sec-form345-issuer-symbol-point-v1.test.js"
QUEUE_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-identity-evidence-gap-queue-v1.json"
OUTPUT_PATH = ROOT / "reports" / "early-detection" / "sec-form345-issuer-symbol-point-v1.json"

CONTRACT_RAW_SHA256 = "96aac6435c470ccd3c9f4b1e453951fa788f0b14d88d7f046270a65a71b1a8f8"
QUEUE_RAW_SHA256 = "4c5bff255368bb0d9f498a8f367c65964c0de80d577cca70c695afe50ce0c650"
QUEUE_REPORT_SHA256 = "cb0b6272b1c07a8091354336bd9e5e1195ba43f766d393fe46fbebf04874e954"
PARENT_REMOTE_COMMIT = "95b10fe726557c75dc1bcc828f595214fb77c8e2"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
REMOTE_TRACKING_REF = "origin/codex/early-detection-v4-gates-20260810"

CONTRACT_SCHEMA = "sec-form345-issuer-symbol-point-contract/v1"
OUTPUT_SCHEMA = "sec-form345-issuer-symbol-point/v1"
RECEIPT_SCHEMA = "sec-form345-private-quarter-receipt/v1"
MANIFEST_SCHEMA = "sec-form345-private-capture-manifest/v1"
DEFERRED_SCHEMA = "sec-form345-private-rate-deferred/v1"

SELECTED_FIELDS = (
    "ACCESSION_NUMBER",
    "FILING_DATE",
    "DOCUMENT_TYPE",
    "ISSUERCIK",
    "ISSUERNAME",
    "ISSUERTRADINGSYMBOL",
)
ALLOWED_DOCUMENT_TYPES = {"3", "3/A", "4", "4/A", "5", "5/A"}
ACCESSION_RE = re.compile(r"^[0-9]{10}-[0-9]{2}-[0-9]{6}$")
QUARTER_RE = re.compile(r"^(20(?:0[9]|1[0-9]|2[0-4]))Q([1-4])$")
MONTHS = {
    "JAN": "01", "FEB": "02", "MAR": "03", "APR": "04",
    "MAY": "05", "JUN": "06", "JUL": "07", "AUG": "08",
    "SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12",
}
HEADER_ALLOWLIST = {
    "content-type", "content-length", "etag", "last-modified",
    "cache-control", "date", "retry-after",
}
RATE_DEFERRED_STATUSES = {403, 429, 503}
MAX_RESPONSE_BYTES = 67_108_864
MINIMUM_INTERVAL_SECONDS = 0.2
REQUEST_TIMEOUT_SECONDS = 120
OWNED_PATHS = (CONTRACT_PATH, BUILDER_PATH, TEST_PATH)


class EvidenceError(RuntimeError):
    """Fail-closed contract, provenance, schema, or capture error."""


class RateDeferred(EvidenceError):
    def __init__(self, status: int, headers: dict[str, str], quarter: str, url: str):
        super().__init__(f"SEC request deferred with HTTP {status}")
        self.status = status
        self.headers = headers
        self.quarter = quarter
        self.url = url


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Prevent SEC_CONTACT-bearing headers from following any redirect."""

    def redirect_request(
        self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str
    ) -> None:
        return None


SEC_OPENER = urllib.request.build_opener(NoRedirectHandler())


def fail(message: str) -> None:
    raise EvidenceError(message)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        fail(f"{label} keys changed")


def with_self_hash(value: dict[str, Any], field: str) -> dict[str, Any]:
    body = {key: item for key, item in value.items() if key != field}
    value[field] = sha256(canonical_bytes(body))
    return value


def validate_self_hash(value: dict[str, Any], field: str, label: str) -> None:
    expected = sha256(canonical_bytes({key: item for key, item in value.items() if key != field}))
    if value.get(field) != expected:
        fail(f"{label} self hash changed")


def expected_quarters() -> list[dict[str, str]]:
    return [
        {
            "quarter": f"{year}Q{quarter}",
            "url": (
                "https://www.sec.gov/files/structureddata/data/"
                f"insider-transactions-data-sets/{year}q{quarter}_form345.zip"
            ),
        }
        for year in range(2009, 2025)
        for quarter in range(1, 5)
    ]


def expected_quarter_sequence_sha(contract: dict[str, Any]) -> str:
    return sha256(canonical_bytes(contract["quarterScope"]["quarters"]))


def validate_contract_value(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "officialDocumentation",
        "remoteBinding", "authorizedImplementation", "gapQueue", "quarterScope",
        "networkPolicy", "privateCapture", "zipPolicy", "submissionContract",
        "population", "futureOutput", "claimCeiling", "claimLocks", "abortCriteria",
        "contractSha256",
    }, "contract")
    if value["schema"] != CONTRACT_SCHEMA:
        fail("contract schema changed")
    if value["taskId"] != "Q005-SEC-FORM345-ISSUER-SYMBOL-POINT":
        fail("contract task changed")
    if value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract track changed")
    validate_self_hash(value, "contractSha256", "contract")
    documentation = value["officialDocumentation"]
    exact_keys(documentation, {"datasetUrl", "readmeUrl", "developerPolicyUrl", "verifiedFacts"}, "official documentation")
    if (
        documentation["datasetUrl"] != "https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets"
        or documentation["readmeUrl"] != "https://www.sec.gov/files/insider_transactions_readme.pdf"
        or documentation["developerPolicyUrl"] != "https://www.sec.gov/about/developer-resources"
    ):
        fail("official documentation binding changed")
    remote = value["remoteBinding"]
    exact_keys(remote, {
        "remote", "ref", "parentRemoteCommit", "parentTag",
        "productionExecutionRequiresRemoteDirectChild", "precommitCommandsAllowedAtExactParent",
    }, "remote binding")
    if remote["remote"] != REMOTE_URL or remote["ref"] != REMOTE_REF:
        fail("remote binding changed")
    if remote["parentRemoteCommit"] != PARENT_REMOTE_COMMIT or remote["parentTag"] != 834:
        fail("parent remote binding changed")
    if remote["productionExecutionRequiresRemoteDirectChild"] is not True:
        fail("production topology weakened")
    if remote["precommitCommandsAllowedAtExactParent"] != ["verify-contract", "dry-run", "self-test"]:
        fail("precommit command allowlist changed")
    implementation = value["authorizedImplementation"]
    if implementation != {
        "contractPath": "research/early-detection-v4/sec-form345-issuer-symbol-point-contract-v1.json",
        "builderPath": "scripts/build-sec-form345-issuer-symbol-point-v1.py",
        "testPath": "tests/build-sec-form345-issuer-symbol-point-v1.test.js",
        "futureOutputPath": "reports/early-detection/sec-form345-issuer-symbol-point-v1.json",
    }:
        fail("authorized implementation paths changed")
    queue = value["gapQueue"]
    if queue != {
        "path": "reports/early-detection/sec-terminal-identity-evidence-gap-queue-v1.json",
        "rawSha256": QUEUE_RAW_SHA256,
        "reportSha256": QUEUE_REPORT_SHA256,
        "schema": "early-detection-sec-terminal-identity-evidence-gap-queue/v1",
        "rows": 656,
        "uniqueIssuerCiks": 607,
        "outcomesAccessed": False,
    }:
        fail("gap queue binding changed")
    scope = value["quarterScope"]
    exact_keys(scope, {
        "firstQuarter", "lastQuarter", "expectedQuarterCount", "urlTemplate", "quarters",
    }, "quarter scope")
    if scope["firstQuarter"] != "2009Q1" or scope["lastQuarter"] != "2024Q4":
        fail("quarter boundary changed")
    if scope["expectedQuarterCount"] != 64 or scope["quarters"] != expected_quarters():
        fail("sealed quarter URL sequence changed")
    if scope["urlTemplate"] != (
        "https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/"
        "{year}q{quarter}_form345.zip"
    ):
        fail("quarter URL template changed")
    network = value["networkPolicy"]
    exact_keys(network, {
        "productionCommandsOnly", "sequentialRequests", "maximumRequestsPerSecond",
        "minimumIntervalMilliseconds", "requestTimeoutSeconds", "maximumResponseBytes",
        "secContactEnvironmentVariable", "secContactRequiredBeforeAnyNetworkOrPrivateWrite",
        "secContactMayBePrintedStoredOrHashed", "acceptedContentTypes",
        "rateDeferredHttpStatuses", "responseHeaderAllowlist", "redirectPolicy",
        "allOtherHttpOrSchemaFailures",
    }, "network policy")
    if network["productionCommandsOnly"] != ["capture"] or network["sequentialRequests"] is not True:
        fail("network command policy changed")
    if network["maximumRequestsPerSecond"] != 5 or network["minimumIntervalMilliseconds"] != 200:
        fail("SEC request rate changed")
    if network["maximumRequestsPerSecond"] > 10:
        fail("SEC request rate exceeds official limit")
    if network["secContactEnvironmentVariable"] != "SEC_CONTACT":
        fail("SEC contact variable changed")
    if network["secContactRequiredBeforeAnyNetworkOrPrivateWrite"] is not True:
        fail("SEC contact requirement weakened")
    if network["secContactMayBePrintedStoredOrHashed"] is not False:
        fail("SEC contact confidentiality changed")
    if set(network["responseHeaderAllowlist"]) != HEADER_ALLOWLIST:
        fail("response header allowlist changed")
    if set(network["rateDeferredHttpStatuses"]) != RATE_DEFERRED_STATUSES:
        fail("rate-deferred status policy changed")
    if network["requestTimeoutSeconds"] != REQUEST_TIMEOUT_SECONDS:
        fail("request timeout changed")
    if network["maximumResponseBytes"] != MAX_RESPONSE_BYTES:
        fail("maximum response size changed")
    if set(network["acceptedContentTypes"]) != {"application/zip", "application/octet-stream"}:
        fail("accepted content types changed")
    if network["redirectPolicy"] != "FINAL_URL_MUST_EQUAL_SEALED_URL":
        fail("redirect policy changed")
    private = value["privateCapture"]
    exact_keys(private, {
        "defaultRoot", "rootMustBeAbsolute", "rootMustBeOutsideRepositoryGitAndSyncTrees",
        "rawBlobPath", "receiptPath", "deferredPath", "finalManifestPath", "atomicWriteNew",
        "resumePolicy", "partialCaptureMayNotProduceFinalManifest", "rawZipMayEnterGitOrPublicOutput",
    }, "private capture policy")
    if (
        private["rootMustBeAbsolute"] is not True
        or private["rootMustBeOutsideRepositoryGitAndSyncTrees"] is not True
        or private["atomicWriteNew"] is not True
        or private["partialCaptureMayNotProduceFinalManifest"] is not True
        or private["rawZipMayEnterGitOrPublicOutput"] is not False
        or private["resumePolicy"] != "VALIDATE_EXISTING_RECEIPT_AND_BLOB_THEN_SKIP"
    ):
        fail("private capture policy weakened")
    zip_policy = value["zipPolicy"]
    exact_keys(zip_policy, {
        "allowedMember", "memberMatch", "exactlyOneSubmissionMemberRequired",
        "otherMembersMayNotBeOpened", "pathTraversalRejected", "encryptedMembersRejected",
    }, "ZIP policy")
    if zip_policy != {
        "allowedMember": "SUBMISSION.tsv",
        "memberMatch": "CASE_INSENSITIVE_EXACT_BASENAME_WITHOUT_DIRECTORY",
        "exactlyOneSubmissionMemberRequired": True,
        "otherMembersMayNotBeOpened": True,
        "pathTraversalRejected": True,
        "encryptedMembersRejected": True,
    }:
        fail("ZIP member policy changed")
    submission = value["submissionContract"]
    exact_keys(submission, {
        "encoding", "delimiter", "selectedFields", "missingOrDuplicateSelectedHeader",
        "unselectedSubmissionColumns", "otherTables", "allowedDocumentTypes", "accessionFormat",
        "filingDateInputFormat", "issuerCikCanonicalization", "blankSelectedValue",
        "duplicateAccessionAcrossQuarterSet",
    }, "SUBMISSION contract")
    if tuple(submission["selectedFields"]) != SELECTED_FIELDS:
        fail("selected SUBMISSION fields changed")
    if set(submission["allowedDocumentTypes"]) != ALLOWED_DOCUMENT_TYPES:
        fail("document type allowlist changed")
    if submission["otherTables"] != "NEVER_OPEN_OR_PARSE":
        fail("other table access was authorized")
    population = value["population"]
    if population != {
        "joinKey": "EXACT_CANONICAL_10_DIGIT_ISSUER_CIK",
        "tickerJoinAllowed": False,
        "issuerNameJoinAllowed": False,
        "oneOutputRowPerGapWorkItem": True,
        "pointDate": "FILING_DATE",
        "pointEvidenceMayResolveHistoricalInterval": False,
        "pointEvidenceMayResolvePermanentIdentity": False,
        "amendmentsRemainSeparatePoints": True,
    }:
        fail("population or point-evidence policy changed")
    future_output = value["futureOutput"]
    exact_keys(future_output, {
        "schema", "writeNewAtomic", "exactSourceFieldsAllowed", "provenanceRequired",
        "forbiddenFieldFamilies",
    }, "future output")
    if future_output["exactSourceFieldsAllowed"] != [
        "accessionNumber", "filingDate", "documentType", "issuerCik", "issuerName", "issuerTradingSymbol"
    ]:
        fail("future source output fields changed")
    exact_keys(value["claimLocks"], {
        "outcomesAccessed", "pricesAccessed", "returnsAccessed",
        "ownerTransactionOrHoldingTablesAccessed", "historicalIdentityIntervalsComplete",
        "permanentSecurityIdentityResolved", "listingIdentityResolved", "tickerReuseResolved",
        "terminalSessionProven", "terminalPaymentVerified", "terminalWealthComplete",
        "originalV4GateCredit", "humanAttestation",
    }, "claim locks")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock promoted")
    forbidden_claims = set(value["claimCeiling"]["forbidden"])
    required_forbidden = {
        "HISTORICAL_IDENTITY_INTERVAL", "PERMANENT_SECURITY_OR_LISTING_IDENTITY",
        "TERMINAL_SESSION_PAYMENT_OR_WEALTH", "PRICE_RETURN_OR_OUTCOME",
        "ORIGINAL_V4_GATE_CREDIT", "HUMAN_ATTESTATION",
    }
    if not required_forbidden.issubset(forbidden_claims):
        fail("claim ceiling weakened")


def load_contract() -> tuple[dict[str, Any], bytes]:
    raw = CONTRACT_PATH.read_bytes()
    if sha256(raw) != CONTRACT_RAW_SHA256:
        fail("contract raw binding changed")
    value = json.loads(raw)
    validate_contract_value(value)
    return value, raw


def canonical_cik(value: Any) -> str:
    text = str(value).strip()
    if not re.fullmatch(r"[0-9]{1,10}", text):
        fail("issuer CIK is not 1-10 ASCII digits")
    return text.zfill(10)


def load_gap_queue(contract: dict[str, Any]) -> dict[str, Any]:
    raw = QUEUE_PATH.read_bytes()
    if sha256(raw) != contract["gapQueue"]["rawSha256"]:
        fail("gap queue raw binding changed")
    value = json.loads(raw)
    if value.get("schema") != contract["gapQueue"]["schema"]:
        fail("gap queue schema changed")
    if value.get("reportSha256") != contract["gapQueue"]["reportSha256"]:
        fail("gap queue self binding changed")
    if value.get("outcomesAccessed") is not False or len(value.get("rows", [])) != 656:
        fail("gap queue population or outcome lock changed")
    ciks = {canonical_cik(row["issuerCik"]) for row in value["rows"]}
    if len(ciks) != 607:
        fail("gap queue unique issuer CIK count changed")
    for row in value["rows"]:
        if row.get("outcomesAccessed") is not False:
            fail("gap queue row outcome lock changed")
    return value


def git_text(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def git_bytes(*args: str) -> bytes:
    result = subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True)
    return result.stdout


def validate_topology_values(head: str, remote: str, parent: str | None, production: bool) -> None:
    if production:
        if head == PARENT_REMOTE_COMMIT or remote != head or parent != PARENT_REMOTE_COMMIT:
            fail("production execution requires the exact remote direct child of Tag834")
    else:
        if head != PARENT_REMOTE_COMMIT or remote != PARENT_REMOTE_COMMIT:
            fail("precommit verification requires exact Tag834 local and remote base")


def verify_precommit_topology() -> dict[str, str]:
    if git_text("remote", "get-url", "origin") != REMOTE_URL:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    remote = git_text("rev-parse", REMOTE_TRACKING_REF)
    validate_topology_values(head, remote, None, False)
    return {"head": head, "remote": remote}


def verify_production_topology() -> dict[str, str]:
    if git_text("remote", "get-url", "origin") != REMOTE_URL:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    parent = git_text("rev-parse", "HEAD^")
    remote_lines = git_text("ls-remote", "--exit-code", "origin", REMOTE_REF).splitlines()
    if len(remote_lines) != 1:
        fail("remote ref resolution is ambiguous")
    remote = remote_lines[0].split()[0]
    validate_topology_values(head, remote, parent, True)
    for path in OWNED_PATHS:
        relative = path.relative_to(ROOT).as_posix()
        if git_bytes("show", f"{head}:{relative}") != path.read_bytes():
            fail(f"owned implementation drift: {relative}")
    return {"head": head, "remote": remote, "parent": parent}


def validate_sec_contact() -> str:
    value = os.environ.get("SEC_CONTACT", "")
    if value != value.strip() or "\n" in value or "\r" in value:
        fail("SEC_CONTACT is invalid")
    if len(value) < 6 or len(value) > 254 or not re.search(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        fail("SEC_CONTACT is required and must contain a contact email")
    return value


def default_private_root() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        fail("LOCALAPPDATA is required when --private-root is omitted")
    return Path(local_app_data) / "GrowthScreenerResearchData" / "private" / "sec-form345-issuer-symbol-point-v1"


def is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def validate_private_root(path: Path) -> Path:
    if not path.is_absolute():
        fail("private root must be absolute")
    resolved = path.resolve(strict=False)
    if is_within(resolved, ROOT.resolve()):
        fail("private root may not be inside the repository")
    lowered = str(resolved).casefold()
    if any(marker in lowered for marker in ("onedrive", "dropbox", "google drive", "icloud")):
        fail("private root may not be inside a sync tree")
    if resolved.parent == resolved:
        fail("private root may not be a filesystem root")
    for ancestor in (resolved, *resolved.parents):
        if (ancestor / ".git").exists():
            fail("private root may not be inside a Git work tree")
    return resolved


def atomic_create_new(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.tmp-{os.getpid()}-{time.time_ns()}"
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError as exc:
            fail(f"write-new target already exists: {path.name}")
        except OSError as exc:
            fail(f"atomic write-new link failed: {exc}")
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sanitized_headers(headers: Any) -> dict[str, str]:
    result: dict[str, str] = {}
    for key in HEADER_ALLOWLIST:
        value = headers.get(key)
        if value is not None:
            result[key] = str(value).strip()
    return dict(sorted(result.items()))


def inspect_zip(raw: bytes) -> str:
    if not raw.startswith(b"PK"):
        fail("SEC response is not a ZIP file")
    try:
        with zipfile.ZipFile(io.BytesIO(raw), "r") as archive:
            matches: list[str] = []
            for info in archive.infolist():
                name = info.filename
                normalized = name.replace("\\", "/")
                parts = Path(normalized).parts
                if normalized.startswith("/") or ".." in parts:
                    fail("ZIP path traversal detected")
                if info.flag_bits & 0x1:
                    fail("encrypted ZIP member detected")
                if "/" not in normalized and normalized.casefold() == "submission.tsv":
                    matches.append(name)
            if len(matches) != 1:
                fail("ZIP must contain exactly one top-level SUBMISSION.tsv member")
            archive.getinfo(matches[0])
            return matches[0]
    except zipfile.BadZipFile as exc:
        fail(f"invalid ZIP: {exc}")
    raise AssertionError("unreachable")


def read_submission_member(raw: bytes) -> tuple[str, bytes]:
    member = inspect_zip(raw)
    with zipfile.ZipFile(io.BytesIO(raw), "r") as archive:
        return member, archive.read(member)


def parse_filing_date(value: str) -> str:
    match = re.fullmatch(r"([0-9]{2})-([A-Za-z]{3})-([0-9]{4})", value)
    if match is None or match.group(2).upper() not in MONTHS:
        fail("FILING_DATE format changed")
    day = int(match.group(1))
    month = int(MONTHS[match.group(2).upper()])
    year = int(match.group(3))
    try:
        parsed = datetime(year, month, day)
    except ValueError as exc:
        fail(f"invalid FILING_DATE: {exc}")
    return parsed.date().isoformat()


def parse_submission_rows(raw: bytes, target_ciks: set[str]) -> list[dict[str, str]]:
    try:
        text = raw.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError as exc:
        fail(f"SUBMISSION.tsv encoding changed: {exc}")
    reader = csv.reader(io.StringIO(text, newline=""), delimiter="\t")
    try:
        header = next(reader)
    except StopIteration:
        fail("SUBMISSION.tsv is empty")
    if len(header) != len(set(header)):
        fail("SUBMISSION.tsv contains duplicate headers")
    missing = [field for field in SELECTED_FIELDS if field not in header]
    if missing:
        fail("SUBMISSION.tsv selected header is missing")
    indices = {field: header.index(field) for field in SELECTED_FIELDS}
    selected: list[dict[str, str]] = []
    for line_number, fields in enumerate(reader, start=2):
        if not fields or (len(fields) == 1 and fields[0] == ""):
            continue
        if len(fields) != len(header):
            fail(f"SUBMISSION.tsv row width changed at line {line_number}")
        values = {field: fields[index].strip() for field, index in indices.items()}
        if any(values[field] == "" for field in SELECTED_FIELDS):
            fail(f"blank selected SUBMISSION value at line {line_number}")
        if not ACCESSION_RE.fullmatch(values["ACCESSION_NUMBER"]):
            fail(f"invalid ACCESSION_NUMBER at line {line_number}")
        if values["DOCUMENT_TYPE"] not in ALLOWED_DOCUMENT_TYPES:
            fail(f"unknown DOCUMENT_TYPE at line {line_number}")
        cik = canonical_cik(values["ISSUERCIK"])
        if len(values["ISSUERNAME"]) > 150 or len(values["ISSUERTRADINGSYMBOL"]) > 10:
            fail(f"issuer field length changed at line {line_number}")
        if cik not in target_ciks:
            continue
        selected.append({
            "accessionNumber": values["ACCESSION_NUMBER"],
            "filingDate": parse_filing_date(values["FILING_DATE"]),
            "documentType": values["DOCUMENT_TYPE"],
            "issuerCik": cik,
            "issuerName": values["ISSUERNAME"],
            "issuerTradingSymbol": values["ISSUERTRADINGSYMBOL"],
        })
    return selected


def fetch_quarter(quarter: str, url: str, contact: str) -> tuple[bytes, dict[str, Any]]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": f"GrowthScreenerResearchData sec-form345-point/1.0 {contact}",
            "Accept": "application/zip, application/octet-stream",
        },
    )
    try:
        response = SEC_OPENER.open(request, timeout=REQUEST_TIMEOUT_SECONDS)
    except urllib.error.HTTPError as exc:
        headers = sanitized_headers(exc.headers)
        if exc.code in RATE_DEFERRED_STATUSES:
            raise RateDeferred(exc.code, headers, quarter, url) from exc
        fail(f"SEC HTTP failure {exc.code}")
    except urllib.error.URLError as exc:
        fail(f"SEC network failure: {type(exc.reason).__name__}")
    with response:
        status = int(getattr(response, "status", response.getcode()))
        if status != 200:
            fail(f"SEC HTTP status changed: {status}")
        final_url = response.geturl()
        if final_url != url:
            fail("SEC response redirected away from the sealed URL")
        headers = sanitized_headers(response.headers)
        content_type = headers.get("content-type", "").split(";", 1)[0].strip().casefold()
        if content_type not in {"application/zip", "application/octet-stream"}:
            fail("SEC response content type changed")
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            fail("SEC response exceeded the sealed byte ceiling")
    submission_member = inspect_zip(raw)
    metadata = {
        "fetchedAtUtc": utc_now(),
        "httpStatus": 200,
        "finalUrl": final_url,
        "responseHeaders": headers,
        "submissionMember": submission_member,
    }
    return raw, metadata


def receipt_path(private_root: Path, quarter: str) -> Path:
    return private_root / "receipts" / f"{quarter}.json"


def blob_path(private_root: Path, raw_sha: str) -> Path:
    return private_root / "blobs" / "sha256" / f"{raw_sha}.zip"


def build_receipt(
    contract: dict[str, Any], quarter: str, url: str, raw: bytes, metadata: dict[str, Any]
) -> dict[str, Any]:
    value = {
        "schema": RECEIPT_SCHEMA,
        "contractRawSha256": CONTRACT_RAW_SHA256,
        "contractSha256": contract["contractSha256"],
        "quarter": quarter,
        "url": url,
        "fetchedAtUtc": metadata["fetchedAtUtc"],
        "httpStatus": metadata["httpStatus"],
        "finalUrl": metadata["finalUrl"],
        "responseHeaders": metadata["responseHeaders"],
        "rawSha256": sha256(raw),
        "bytes": len(raw),
        "submissionMember": metadata["submissionMember"],
        "claimLocks": contract["claimLocks"],
        "receiptSha256": "",
    }
    return with_self_hash(value, "receiptSha256")


def validate_receipt(
    value: dict[str, Any], contract: dict[str, Any], private_root: Path,
    expected_quarter: str, expected_url: str,
) -> tuple[str, int]:
    exact_keys(value, {
        "schema", "contractRawSha256", "contractSha256", "quarter", "url",
        "fetchedAtUtc", "httpStatus", "finalUrl", "responseHeaders", "rawSha256",
        "bytes", "submissionMember", "claimLocks", "receiptSha256",
    }, "quarter receipt")
    validate_self_hash(value, "receiptSha256", "quarter receipt")
    if value["schema"] != RECEIPT_SCHEMA:
        fail("quarter receipt schema changed")
    if value["contractRawSha256"] != CONTRACT_RAW_SHA256 or value["contractSha256"] != contract["contractSha256"]:
        fail("quarter receipt contract binding changed")
    if value["quarter"] != expected_quarter or value["url"] != expected_url:
        fail("quarter receipt scope changed")
    if value["httpStatus"] != 200 or value["finalUrl"] != expected_url:
        fail("quarter receipt HTTP provenance changed")
    if value["submissionMember"].casefold() != "submission.tsv":
        fail("quarter receipt member changed")
    if value["claimLocks"] != contract["claimLocks"]:
        fail("quarter receipt claim locks changed")
    if set(value["responseHeaders"]) - HEADER_ALLOWLIST:
        fail("quarter receipt contains unauthorized headers")
    raw_path = blob_path(private_root, value["rawSha256"])
    if not raw_path.is_file():
        fail("quarter receipt raw blob is missing")
    raw = raw_path.read_bytes()
    if len(raw) != value["bytes"] or sha256(raw) != value["rawSha256"]:
        fail("quarter receipt raw blob binding changed")
    if inspect_zip(raw) != value["submissionMember"]:
        fail("quarter receipt ZIP member binding changed")
    return value["rawSha256"], value["bytes"]


def load_receipt(
    path: Path, contract: dict[str, Any], private_root: Path, quarter: str, url: str
) -> tuple[dict[str, Any], bytes]:
    raw = path.read_bytes()
    value = json.loads(raw)
    validate_receipt(value, contract, private_root, quarter, url)
    return value, raw


def write_rate_deferred(
    private_root: Path, contract: dict[str, Any], deferred: RateDeferred
) -> Path:
    timestamp = utc_now()
    safe_timestamp = timestamp.replace(":", "").replace("-", "")
    value = {
        "schema": DEFERRED_SCHEMA,
        "contractRawSha256": CONTRACT_RAW_SHA256,
        "contractSha256": contract["contractSha256"],
        "quarter": deferred.quarter,
        "url": deferred.url,
        "deferredAtUtc": timestamp,
        "httpStatus": deferred.status,
        "responseHeaders": deferred.headers,
        "status": "RATE_DEFERRED",
        "claimLocks": contract["claimLocks"],
        "deferredSha256": "",
    }
    with_self_hash(value, "deferredSha256")
    path = private_root / "deferred" / f"{deferred.quarter}-{safe_timestamp}-{time.time_ns()}.json"
    atomic_create_new(path, json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n")
    return path


def build_final_manifest(
    private_root: Path, contract: dict[str, Any], introduction_commit: str
) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    fetched_times: list[str] = []
    for source in contract["quarterScope"]["quarters"]:
        quarter = source["quarter"]
        path = receipt_path(private_root, quarter)
        if not path.is_file():
            fail("final manifest requires all 64 quarter receipts")
        value, raw = load_receipt(path, contract, private_root, quarter, source["url"])
        fetched_times.append(value["fetchedAtUtc"])
        items.append({
            "quarter": quarter,
            "receiptPath": f"receipts/{quarter}.json",
            "receiptRawSha256": sha256(raw),
            "zipRawSha256": value["rawSha256"],
            "bytes": value["bytes"],
        })
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "contractRawSha256": CONTRACT_RAW_SHA256,
        "contractSha256": contract["contractSha256"],
        "parentRemoteCommit": PARENT_REMOTE_COMMIT,
        "introductionCommit": introduction_commit,
        "completedAtUtc": max(fetched_times),
        "quarterCount": len(items),
        "quarterSequenceSha256": expected_quarter_sequence_sha(contract),
        "receipts": items,
        "captureSequenceSha256": sha256(canonical_bytes(items)),
        "claimLocks": contract["claimLocks"],
        "manifestSha256": "",
    }
    return with_self_hash(manifest, "manifestSha256")


def validate_final_manifest(
    value: dict[str, Any], contract: dict[str, Any], private_root: Path, introduction_commit: str
) -> None:
    exact_keys(value, {
        "schema", "contractRawSha256", "contractSha256", "parentRemoteCommit",
        "introductionCommit", "completedAtUtc", "quarterCount", "quarterSequenceSha256",
        "receipts", "captureSequenceSha256", "claimLocks", "manifestSha256",
    }, "capture manifest")
    validate_self_hash(value, "manifestSha256", "capture manifest")
    if value["schema"] != MANIFEST_SCHEMA or value["quarterCount"] != 64:
        fail("capture manifest scope changed")
    if value["contractRawSha256"] != CONTRACT_RAW_SHA256 or value["contractSha256"] != contract["contractSha256"]:
        fail("capture manifest contract binding changed")
    if value["parentRemoteCommit"] != PARENT_REMOTE_COMMIT or value["introductionCommit"] != introduction_commit:
        fail("capture manifest Git binding changed")
    if value["quarterSequenceSha256"] != expected_quarter_sequence_sha(contract):
        fail("capture manifest quarter sequence changed")
    if value["captureSequenceSha256"] != sha256(canonical_bytes(value["receipts"])):
        fail("capture manifest receipt sequence changed")
    if value["claimLocks"] != contract["claimLocks"]:
        fail("capture manifest claim locks changed")
    rebuilt = build_final_manifest(private_root, contract, introduction_commit)
    for key in rebuilt:
        if key not in {"completedAtUtc", "manifestSha256"} and rebuilt[key] != value[key]:
            fail("capture manifest does not rebuild from receipts")
    if rebuilt["completedAtUtc"] != value["completedAtUtc"]:
        fail("capture manifest completion timestamp changed")


def capture(private_root_arg: str | None, max_requests: int) -> dict[str, Any]:
    contract, _ = load_contract()
    contact = validate_sec_contact()
    topology = verify_production_topology()
    private_root = validate_private_root(Path(private_root_arg) if private_root_arg else default_private_root())
    completed = 0
    requests = 0
    last_request_started: float | None = None
    for source in contract["quarterScope"]["quarters"]:
        quarter, url = source["quarter"], source["url"]
        existing = receipt_path(private_root, quarter)
        if existing.exists():
            load_receipt(existing, contract, private_root, quarter, url)
            completed += 1
            continue
        if requests >= max_requests:
            continue
        if last_request_started is not None:
            wait_for = MINIMUM_INTERVAL_SECONDS - (time.monotonic() - last_request_started)
            if wait_for > 0:
                time.sleep(wait_for)
        last_request_started = time.monotonic()
        try:
            raw, metadata = fetch_quarter(quarter, url, contact)
        except RateDeferred as deferred:
            if verify_production_topology()["head"] != topology["head"]:
                fail("Git or remote topology drifted during capture")
            deferred_path = write_rate_deferred(private_root, contract, deferred)
            raise RateDeferred(deferred.status, {"receipt": deferred_path.name}, quarter, url) from deferred
        requests += 1
        raw_sha = sha256(raw)
        target_blob = blob_path(private_root, raw_sha)
        if target_blob.exists():
            if target_blob.read_bytes() != raw:
                fail("content-addressed blob collision")
        else:
            atomic_create_new(target_blob, raw)
        receipt = build_receipt(contract, quarter, url, raw, metadata)
        atomic_create_new(
            existing,
            json.dumps(receipt, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n",
        )
        completed += 1
    if verify_production_topology()["head"] != topology["head"]:
        fail("Git or remote topology drifted during capture")
    if completed == 64:
        manifest = build_final_manifest(private_root, contract, topology["head"])
        manifest_path = private_root / "capture-manifest.json"
        encoded = json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
        if manifest_path.exists():
            existing = json.loads(manifest_path.read_bytes())
            validate_final_manifest(existing, contract, private_root, topology["head"])
            if manifest_path.read_bytes() != encoded:
                fail("existing capture manifest bytes changed")
        else:
            atomic_create_new(manifest_path, encoded)
        return {
            "status": "PASS",
            "capturedQuarters": 64,
            "networkRequestsThisRun": requests,
            "manifestSha256": manifest["manifestSha256"],
            "outcomesAccessed": False,
        }
    return {
        "status": "INCOMPLETE",
        "capturedQuarters": completed,
        "remainingQuarters": 64 - completed,
        "networkRequestsThisRun": requests,
        "outcomesAccessed": False,
    }


def validate_public_output(
    value: dict[str, Any], contract: dict[str, Any], queue: dict[str, Any]
) -> None:
    exact_keys(value, {
        "schema", "taskId", "track", "contractRawSha256", "contractSha256",
        "gapQueueRawSha256", "gapQueueReportSha256", "captureManifestSha256",
        "introductionCommit", "quarterCoverage", "population", "rows", "claimCeiling",
        "claimLocks", "reportSha256",
    }, "public output")
    validate_self_hash(value, "reportSha256", "public output")
    if value["schema"] != OUTPUT_SCHEMA or value["claimLocks"] != contract["claimLocks"]:
        fail("public output schema or claim locks changed")
    if value["taskId"] != contract["taskId"] or value["track"] != contract["track"]:
        fail("public output task binding changed")
    if value["contractRawSha256"] != CONTRACT_RAW_SHA256 or value["contractSha256"] != contract["contractSha256"]:
        fail("public output contract binding changed")
    if value["gapQueueRawSha256"] != QUEUE_RAW_SHA256 or value["gapQueueReportSha256"] != QUEUE_REPORT_SHA256:
        fail("public output gap queue binding changed")
    if not re.fullmatch(r"[0-9a-f]{64}", value["captureManifestSha256"]):
        fail("public output capture manifest hash is invalid")
    if not re.fullmatch(r"[0-9a-f]{40}", value["introductionCommit"]):
        fail("public output introduction commit is invalid")
    if value["claimCeiling"] != contract["claimCeiling"]:
        fail("public output claim ceiling changed")
    if len(value["rows"]) != 656:
        fail("public output population changed")
    if len(value["quarterCoverage"]) != 64:
        fail("public output quarter coverage changed")
    target_point_sum = 0
    for expected, observed in zip(expected_quarters(), value["quarterCoverage"], strict=True):
        exact_keys(observed, {
            "quarter", "sourceZipRawSha256", "sourceSubmissionRawSha256", "targetPointCount",
        }, "public quarter coverage")
        if observed["quarter"] != expected["quarter"]:
            fail("public output quarter sequence changed")
        if not re.fullmatch(r"[0-9a-f]{64}", observed["sourceZipRawSha256"]):
            fail("public quarter ZIP hash is invalid")
        if not re.fullmatch(r"[0-9a-f]{64}", observed["sourceSubmissionRawSha256"]):
            fail("public quarter SUBMISSION hash is invalid")
        if type(observed["targetPointCount"]) is not int or observed["targetPointCount"] < 0:
            fail("public quarter target count is invalid")
        target_point_sum += observed["targetPointCount"]
    exact_keys(value["population"], {
        "gapRows", "uniqueIssuerCiks", "rowsWithPointEvidence",
        "rowsWithoutPointEvidence", "uniqueTargetAccessions",
    }, "public output population")
    population = value["population"]
    if population["gapRows"] != 656 or population["uniqueIssuerCiks"] != 607:
        fail("public output frozen population changed")
    if (
        type(population["rowsWithPointEvidence"]) is not int
        or type(population["rowsWithoutPointEvidence"]) is not int
        or population["rowsWithPointEvidence"] < 0
        or population["rowsWithoutPointEvidence"] < 0
        or population["rowsWithPointEvidence"] + population["rowsWithoutPointEvidence"] != 656
    ):
        fail("public output point-state counts changed")
    if type(population["uniqueTargetAccessions"]) is not int or population["uniqueTargetAccessions"] < 0:
        fail("public output accession count is invalid")
    if population["uniqueTargetAccessions"] != target_point_sum:
        fail("public output accession and quarter counts disagree")
    allowed_observation = {
        "accessionNumber", "filingDate", "documentType", "issuerCik", "issuerName",
        "issuerTradingSymbol", "sourceQuarter", "sourceZipRawSha256",
        "sourceSubmissionRawSha256", "captureReceiptRawSha256", "evidenceRowId",
    }
    forbidden_tokens = ("price", "return", "outcome", "holding", "owner", "transaction", "terminal")
    queue_bindings = [
        (item["workItemId"], canonical_cik(item["issuerCik"])) for item in queue["rows"]
    ]
    observed_accessions: set[str] = set()
    rows_with_points = 0
    for row, expected_binding in zip(value["rows"], queue_bindings, strict=True):
        exact_keys(row, {
            "workItemId", "issuerCik", "pointState", "observations",
            "distinctIssuerTradingSymbols", "rowSha256",
        }, "public output row")
        validate_self_hash(row, "rowSha256", "public output row")
        if (row["workItemId"], row["issuerCik"]) != expected_binding:
            fail("public output row-to-gap binding changed")
        if row["pointState"] not in {"OBSERVED_FILING_POINTS", "NO_FORM345_POINT_EVIDENCE"}:
            fail("public output point state changed")
        expected_state = "OBSERVED_FILING_POINTS" if row["observations"] else "NO_FORM345_POINT_EVIDENCE"
        if row["pointState"] != expected_state:
            fail("public output point state disagrees with observations")
        if row["observations"]:
            rows_with_points += 1
        expected_symbols = sorted({item["issuerTradingSymbol"] for item in row["observations"]})
        if row["distinctIssuerTradingSymbols"] != expected_symbols:
            fail("public output symbol summary changed")
        if row["observations"] != sorted(
            row["observations"],
            key=lambda item: (item["filingDate"], item["accessionNumber"], item["sourceQuarter"]),
        ):
            fail("public observations are not deterministically ordered")
        for observation in row["observations"]:
            if set(observation) != allowed_observation:
                fail("public observation fields changed")
            if any(token in key.casefold() for key in observation for token in forbidden_tokens):
                fail("forbidden public observation field")
            if canonical_cik(observation["issuerCik"]) != row["issuerCik"]:
                fail("public observation CIK join changed")
            if observation["sourceQuarter"] not in {item["quarter"] for item in expected_quarters()}:
                fail("public observation quarter is outside the sealed scope")
            for field in ("sourceZipRawSha256", "sourceSubmissionRawSha256", "captureReceiptRawSha256"):
                if not re.fullmatch(r"[0-9a-f]{64}", observation[field]):
                    fail("public observation provenance hash is invalid")
            evidence_body = {key: item for key, item in observation.items() if key != "evidenceRowId"}
            if observation["evidenceRowId"] != sha256(canonical_bytes(evidence_body)):
                fail("public evidence row hash changed")
            observed_accessions.add(observation["accessionNumber"])
    if rows_with_points != population["rowsWithPointEvidence"]:
        fail("public output rows-with-points count changed")
    if len(observed_accessions) != population["uniqueTargetAccessions"]:
        fail("public output unique accession count changed")


def build(private_root_arg: str | None) -> dict[str, Any]:
    contract, _ = load_contract()
    topology = verify_production_topology()
    private_root = validate_private_root(Path(private_root_arg) if private_root_arg else default_private_root())
    manifest_path = private_root / "capture-manifest.json"
    if not manifest_path.is_file():
        fail("complete private capture manifest is required")
    manifest_raw = manifest_path.read_bytes()
    manifest = json.loads(manifest_raw)
    validate_final_manifest(manifest, contract, private_root, topology["head"])
    queue = load_gap_queue(contract)
    target_ciks = {canonical_cik(row["issuerCik"]) for row in queue["rows"]}
    observations_by_cik: dict[str, list[dict[str, str]]] = {cik: [] for cik in target_ciks}
    target_accessions: dict[str, tuple[str, str]] = {}
    quarter_coverage: list[dict[str, Any]] = []
    receipt_by_quarter = {item["quarter"]: item for item in manifest["receipts"]}
    for source in contract["quarterScope"]["quarters"]:
        quarter, url = source["quarter"], source["url"]
        receipt, receipt_raw = load_receipt(receipt_path(private_root, quarter), contract, private_root, quarter, url)
        zip_raw = blob_path(private_root, receipt["rawSha256"]).read_bytes()
        _member, submission_raw = read_submission_member(zip_raw)
        submission_sha = sha256(submission_raw)
        selected = parse_submission_rows(submission_raw, target_ciks)
        for item in selected:
            accession = item["accessionNumber"]
            identity = (item["issuerCik"], quarter)
            if accession in target_accessions:
                fail("duplicate target accession across the sealed quarter set")
            target_accessions[accession] = identity
            evidence = {
                **item,
                "sourceQuarter": quarter,
                "sourceZipRawSha256": receipt["rawSha256"],
                "sourceSubmissionRawSha256": submission_sha,
                "captureReceiptRawSha256": sha256(receipt_raw),
            }
            evidence["evidenceRowId"] = sha256(canonical_bytes(evidence))
            observations_by_cik[item["issuerCik"]].append(evidence)
        quarter_coverage.append({
            "quarter": quarter,
            "sourceZipRawSha256": receipt_by_quarter[quarter]["zipRawSha256"],
            "sourceSubmissionRawSha256": submission_sha,
            "targetPointCount": len(selected),
        })
    rows: list[dict[str, Any]] = []
    rows_with_points = 0
    for queue_row in queue["rows"]:
        cik = canonical_cik(queue_row["issuerCik"])
        points = sorted(
            observations_by_cik[cik],
            key=lambda item: (item["filingDate"], item["accessionNumber"], item["sourceQuarter"]),
        )
        if points:
            rows_with_points += 1
        row = {
            "workItemId": queue_row["workItemId"],
            "issuerCik": cik,
            "pointState": "OBSERVED_FILING_POINTS" if points else "NO_FORM345_POINT_EVIDENCE",
            "observations": points,
            "distinctIssuerTradingSymbols": sorted({item["issuerTradingSymbol"] for item in points}),
            "rowSha256": "",
        }
        with_self_hash(row, "rowSha256")
        rows.append(row)
    output = {
        "schema": OUTPUT_SCHEMA,
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": CONTRACT_RAW_SHA256,
        "contractSha256": contract["contractSha256"],
        "gapQueueRawSha256": QUEUE_RAW_SHA256,
        "gapQueueReportSha256": QUEUE_REPORT_SHA256,
        "captureManifestSha256": sha256(manifest_raw),
        "introductionCommit": topology["head"],
        "quarterCoverage": quarter_coverage,
        "population": {
            "gapRows": 656,
            "uniqueIssuerCiks": 607,
            "rowsWithPointEvidence": rows_with_points,
            "rowsWithoutPointEvidence": 656 - rows_with_points,
            "uniqueTargetAccessions": len(target_accessions),
        },
        "rows": rows,
        "claimCeiling": contract["claimCeiling"],
        "claimLocks": contract["claimLocks"],
        "reportSha256": "",
    }
    with_self_hash(output, "reportSha256")
    validate_public_output(output, contract, queue)
    if verify_production_topology()["head"] != topology["head"]:
        fail("Git or remote topology drifted during build")
    return output


def dry_run(private_root_arg: str | None) -> dict[str, Any]:
    contract, _ = load_contract()
    topology = verify_precommit_topology()
    load_gap_queue(contract)
    private_root = validate_private_root(Path(private_root_arg) if private_root_arg else default_private_root())
    contact_present = bool(os.environ.get("SEC_CONTACT"))
    if contact_present:
        validate_sec_contact()
    return {
        "status": "PASS",
        "head": topology["head"],
        "expectedQuarters": 64,
        "quarterSequenceSha256": expected_quarter_sequence_sha(contract),
        "gapRows": 656,
        "uniqueIssuerCiks": 607,
        "privateRootPolicyValidated": private_root.is_absolute(),
        "secContactPresent": contact_present,
        "secContactRequiredAtCapture": True,
        "networkRequests": 0,
        "filesWritten": 0,
        "outcomesAccessed": False,
    }


def expect_failure(callback: Any) -> bool:
    try:
        callback()
    except (EvidenceError, json.JSONDecodeError, UnicodeDecodeError, zipfile.BadZipFile):
        return True
    return False


def fixture_zip(submission: bytes, member_name: str = "SUBMISSION.tsv") -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member_name, submission)
        archive.writestr("UNUSED.tsv", b"ACCESSION_NUMBER\tSECRET_VALUE\n0000000000-00-000000\t999.99\n")
    return buffer.getvalue()


def self_test() -> dict[str, Any]:
    contract, _ = load_contract()
    verify_precommit_topology()
    queue = load_gap_queue(contract)
    header = "\t".join((*SELECTED_FIELDS, "UNSELECTED_COLUMN"))
    row = "\t".join((
        "0000123456-09-000001", "31-DEC-2009", "4/A", "123456",
        "Example Issuer", "EXMPL", "IGNORED",
    ))
    zip_raw = fixture_zip(f"{header}\n{row}\n".encode("utf-8"))
    member, submission_raw = read_submission_member(zip_raw)
    parsed = parse_submission_rows(submission_raw, {"0000123456"})
    checks: dict[str, bool] = {
        "contractRawBound": sha256(CONTRACT_PATH.read_bytes()) == CONTRACT_RAW_SHA256,
        "contractSelfBound": contract["contractSha256"] == sha256(canonical_bytes({
            key: value for key, value in contract.items() if key != "contractSha256"
        })),
        "all64QuarterUrlsBound": contract["quarterScope"]["quarters"] == expected_quarters(),
        "submissionOnlyMemberOpened": member == "SUBMISSION.tsv",
        "selectedFieldsOnly": parsed == [{
            "accessionNumber": "0000123456-09-000001",
            "filingDate": "2009-12-31",
            "documentType": "4/A",
            "issuerCik": "0000123456",
            "issuerName": "Example Issuer",
            "issuerTradingSymbol": "EXMPL",
        }],
        "unselectedColumnNotOutput": "UNSELECTED_COLUMN" not in canonical_bytes(parsed).decode("utf-8"),
        "otherTableBytesNotOutput": "SECRET_VALUE" not in canonical_bytes(parsed).decode("utf-8"),
    }
    missing_header = fixture_zip(
        ("\t".join(SELECTED_FIELDS[:-1]) + "\n" + "\t".join(row.split("\t")[:-2]) + "\n").encode("utf-8")
    )
    duplicate_header = fixture_zip(
        (header + "\tISSUERCIK\n" + row + "\t123456\n").encode("utf-8")
    )
    invalid_doc_row = row.replace("\t4/A\t", "\t8-K\t")
    invalid_cik_row = row.replace("\t123456\t", "\t12X456\t")
    checks.update({
        "missingSelectedHeaderRejected": expect_failure(
            lambda: parse_submission_rows(read_submission_member(missing_header)[1], {"0000123456"})
        ),
        "duplicateHeaderRejected": expect_failure(
            lambda: parse_submission_rows(read_submission_member(duplicate_header)[1], {"0000123456"})
        ),
        "unknownDocumentTypeRejected": expect_failure(
            lambda: parse_submission_rows(
                read_submission_member(fixture_zip(f"{header}\n{invalid_doc_row}\n".encode()))[1],
                {"0000123456"},
            )
        ),
        "invalidCikRejected": expect_failure(
            lambda: parse_submission_rows(
                read_submission_member(fixture_zip(f"{header}\n{invalid_cik_row}\n".encode()))[1],
                {"0000123456"},
            )
        ),
        "nestedSubmissionRejected": expect_failure(
            lambda: read_submission_member(fixture_zip(f"{header}\n{row}\n".encode(), "nested/SUBMISSION.tsv"))
        ),
        "pathTraversalRejected": expect_failure(
            lambda: read_submission_member(fixture_zip(f"{header}\n{row}\n".encode(), "../SUBMISSION.tsv"))
        ),
    })
    mutated_contract = copy.deepcopy(contract)
    mutated_contract["quarterScope"]["quarters"][0]["url"] = "https://example.invalid/2009q1.zip"
    with_self_hash(mutated_contract, "contractSha256")
    checks["rehashedQuarterUrlMutationRejected"] = expect_failure(lambda: validate_contract_value(mutated_contract))
    promoted_contract = copy.deepcopy(contract)
    promoted_contract["claimLocks"]["historicalIdentityIntervalsComplete"] = True
    with_self_hash(promoted_contract, "contractSha256")
    checks["rehashedIntervalPromotionRejected"] = expect_failure(lambda: validate_contract_value(promoted_contract))
    checks["tickerOnlyJoinRejected"] = expect_failure(lambda: canonical_cik("EXMPL"))
    checks["relativePrivateRootRejected"] = expect_failure(lambda: validate_private_root(Path("private")))
    checks["repositorySidepathRejected"] = expect_failure(lambda: validate_private_root(ROOT / ".private"))
    checks["productionAtParentRejected"] = expect_failure(
        lambda: validate_topology_values(PARENT_REMOTE_COMMIT, PARENT_REMOTE_COMMIT, None, True)
    )
    checks["remoteDriftRejected"] = expect_failure(
        lambda: validate_topology_values("a" * 40, "b" * 40, PARENT_REMOTE_COMMIT, True)
    )
    checks["rateDeferredClassified"] = all(status in RATE_DEFERRED_STATUSES for status in (403, 429, 503))
    checks["hardHttpFailureNotDeferred"] = 500 not in RATE_DEFERRED_STATUSES
    with tempfile.TemporaryDirectory(prefix="sec-form345-selftest-") as temp_name:
        private_root = validate_private_root(Path(temp_name).resolve())
        raw_sha = sha256(zip_raw)
        atomic_create_new(blob_path(private_root, raw_sha), zip_raw)
        metadata = {
            "fetchedAtUtc": "2026-08-13T00:00:00Z",
            "httpStatus": 200,
            "finalUrl": expected_quarters()[0]["url"],
            "responseHeaders": {"content-type": "application/zip"},
            "submissionMember": "SUBMISSION.tsv",
        }
        receipt = build_receipt(contract, "2009Q1", expected_quarters()[0]["url"], zip_raw, metadata)
        validate_receipt(receipt, contract, private_root, "2009Q1", expected_quarters()[0]["url"])
        mutated_receipt = copy.deepcopy(receipt)
        mutated_receipt["url"] = expected_quarters()[1]["url"]
        with_self_hash(mutated_receipt, "receiptSha256")
        checks["rehashedReceiptScopeMutationRejected"] = expect_failure(
            lambda: validate_receipt(
                mutated_receipt, contract, private_root, "2009Q1", expected_quarters()[0]["url"]
            )
        )
        tampered_blob = zip_raw + b"tamper"
        blob_path(private_root, raw_sha).write_bytes(tampered_blob)
        checks["rawBlobMutationRejected"] = expect_failure(
            lambda: validate_receipt(receipt, contract, private_root, "2009Q1", expected_quarters()[0]["url"])
        )
    fixture_cik = canonical_cik(queue["rows"][0]["issuerCik"])
    fake_observation = {
        **parsed[0],
        "issuerCik": fixture_cik,
        "sourceQuarter": "2009Q4",
        "sourceZipRawSha256": "a" * 64,
        "sourceSubmissionRawSha256": "b" * 64,
        "captureReceiptRawSha256": "c" * 64,
    }
    fake_observation["evidenceRowId"] = sha256(canonical_bytes(fake_observation))
    fake_rows: list[dict[str, Any]] = []
    fake_rows_with_points = 0
    for queue_row in queue["rows"]:
        row_cik = canonical_cik(queue_row["issuerCik"])
        observations = [copy.deepcopy(fake_observation)] if row_cik == fixture_cik else []
        if observations:
            fake_rows_with_points += 1
        fake_row = {
            "workItemId": queue_row["workItemId"],
            "issuerCik": row_cik,
            "pointState": "OBSERVED_FILING_POINTS" if observations else "NO_FORM345_POINT_EVIDENCE",
            "observations": observations,
            "distinctIssuerTradingSymbols": ["EXMPL"] if observations else [],
            "rowSha256": "",
        }
        fake_rows.append(with_self_hash(fake_row, "rowSha256"))
    fake_quarter_coverage = [{
        "quarter": source["quarter"],
        "sourceZipRawSha256": "a" * 64,
        "sourceSubmissionRawSha256": "b" * 64,
        "targetPointCount": 1 if source["quarter"] == "2009Q4" else 0,
    } for source in expected_quarters()]
    fake_output = {
        "schema": OUTPUT_SCHEMA,
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": CONTRACT_RAW_SHA256,
        "contractSha256": contract["contractSha256"],
        "gapQueueRawSha256": QUEUE_RAW_SHA256,
        "gapQueueReportSha256": QUEUE_REPORT_SHA256,
        "captureManifestSha256": "e" * 64,
        "introductionCommit": "f" * 40,
        "quarterCoverage": fake_quarter_coverage,
        "population": {
            "gapRows": 656,
            "uniqueIssuerCiks": 607,
            "rowsWithPointEvidence": fake_rows_with_points,
            "rowsWithoutPointEvidence": 656 - fake_rows_with_points,
            "uniqueTargetAccessions": 1,
        },
        "rows": fake_rows,
        "claimCeiling": contract["claimCeiling"],
        "claimLocks": contract["claimLocks"],
        "reportSha256": "",
    }
    with_self_hash(fake_output, "reportSha256")
    validate_public_output(fake_output, contract, queue)
    outcome_mutation = copy.deepcopy(fake_output)
    outcome_mutation["rows"][0]["observations"][0]["outcome"] = "forbidden"
    with_self_hash(outcome_mutation["rows"][0], "rowSha256")
    with_self_hash(outcome_mutation, "reportSha256")
    checks["outcomeFieldRejected"] = expect_failure(
        lambda: validate_public_output(outcome_mutation, contract, queue)
    )
    price_mutation = copy.deepcopy(fake_output)
    price_mutation["rows"][0]["observations"][0]["price"] = 1
    with_self_hash(price_mutation["rows"][0], "rowSha256")
    with_self_hash(price_mutation, "reportSha256")
    checks["priceFieldRejected"] = expect_failure(
        lambda: validate_public_output(price_mutation, contract, queue)
    )
    evidence_hash_mutation = copy.deepcopy(fake_output)
    evidence_hash_mutation["rows"][0]["observations"][0]["evidenceRowId"] = "d" * 64
    with_self_hash(evidence_hash_mutation["rows"][0], "rowSha256")
    with_self_hash(evidence_hash_mutation, "reportSha256")
    checks["rehashedEvidenceMutationRejected"] = expect_failure(
        lambda: validate_public_output(evidence_hash_mutation, contract, queue)
    )
    queue_binding_mutation = copy.deepcopy(fake_output)
    queue_binding_mutation["rows"][0]["issuerCik"] = "0000000001"
    with_self_hash(queue_binding_mutation["rows"][0], "rowSha256")
    with_self_hash(queue_binding_mutation, "reportSha256")
    checks["rehashedQueueBindingMutationRejected"] = expect_failure(
        lambda: validate_public_output(queue_binding_mutation, contract, queue)
    )
    if not all(checks.values()):
        fail("self-test failed: " + ",".join(key for key, passed in checks.items() if not passed))
    return {"status": "PASS", **checks, "networkRequests": 0, "outcomesAccessed": False}


def verify_contract() -> dict[str, Any]:
    contract, raw = load_contract()
    topology = verify_precommit_topology()
    load_gap_queue(contract)
    return {
        "status": "PASS",
        "contractRawSha256": sha256(raw),
        "contractSha256": contract["contractSha256"],
        "head": topology["head"],
        "expectedQuarters": 64,
        "networkRequests": 0,
        "filesWritten": 0,
        "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("verify-contract")
    dry_parser = subparsers.add_parser("dry-run")
    dry_parser.add_argument("--private-root")
    subparsers.add_parser("self-test")
    capture_parser = subparsers.add_parser("capture")
    capture_parser.add_argument("--private-root")
    capture_parser.add_argument("--max-requests", type=int, default=64)
    build_parser = subparsers.add_parser("build")
    build_parser.add_argument("--private-root")
    build_parser.add_argument("--output", default=str(OUTPUT_PATH))
    args = parser.parse_args()
    try:
        if args.command == "verify-contract":
            result = verify_contract()
        elif args.command == "dry-run":
            result = dry_run(args.private_root)
        elif args.command == "self-test":
            result = self_test()
        elif args.command == "capture":
            if not 1 <= args.max_requests <= 64:
                fail("--max-requests must be between 1 and 64")
            result = capture(args.private_root, args.max_requests)
        elif args.command == "build":
            requested_output = Path(args.output).resolve(strict=False)
            if requested_output != OUTPUT_PATH.resolve(strict=False):
                fail("public output sidepaths are forbidden")
            payload = build(args.private_root)
            encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            before_write = verify_production_topology()["head"]
            atomic_create_new(OUTPUT_PATH, encoded)
            if verify_production_topology()["head"] != before_write:
                fail("Git or remote topology drifted across public output write")
            result = {
                "status": "PASS",
                "rows": payload["population"]["gapRows"],
                "rowsWithPointEvidence": payload["population"]["rowsWithPointEvidence"],
                "reportSha256": payload["reportSha256"],
                "outcomesAccessed": False,
            }
        else:
            raise AssertionError("unreachable")
    except RateDeferred as exc:
        print(json.dumps({
            "status": "RATE_DEFERRED",
            "quarter": exc.quarter,
            "httpStatus": exc.status,
            "outcomesAccessed": False,
        }, sort_keys=True))
        return 75
    except (EvidenceError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
