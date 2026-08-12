#!/usr/bin/env python3
"""Fail-closed FINRA Q004 public-catalog discovery and offline validator.

This v1 contract intentionally cannot perform a production network request.  The
official FINRA Query API is zero-cost with a Public Credential, but it is not a
no-account API; the public website terms do not authorize an automated database
crawl.  The runner therefore verifies the frozen contract, emits a dry-run plan,
and validates captured-page fixtures for a separately authorized future version.
"""

from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "finra-q004-public-catalog-contract-v1.json"
EXPECTED_CONTRACT_RAW_SHA256 = "fc85cc48194b4408ec7f917321a71d85cf7c1265d56acbec42b6a5e76a489654"
EXPECTED_CONTRACT_SHA256 = "756c7c815a2608ba663053df9252a4a2dd8eb507d5c1eef793d895a839c27b58"
EXPECTED_SCHEMA = "finra-q004-public-catalog-contract/v1"
EXPECTED_BASELINE_HEAD = "56eebdda0fe727d0b1f0714146ee0c28cf30301d"
EXPECTED_REMOTE = "https://github.com/Karlryl/screener-data.git"
EXPECTED_REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
EXPECTED_DATA_URL = "https://api.finra.org/data/group/otcMarket/name/OTCDAILYLIST"
EXPECTED_INPUTS = {
    "research/early-detection-v4/free-source-registry.json": "1e22e9e8746cd00b8478fdc9e9d6f57ee15d8505ff4e564f3a92c607a619b8bc",
    "research/early-detection-v4/continuous-free-source-registry-v1.json": "d07ba18a969aced361fb638d52226f373ec64052dba30ddf36789a2a130a8927",
    "research/early-detection-v4/continuous-free-source-queue-seed-v1.json": "9d192851b4be9ee965a522dd67e2818ac807e220d1a982694dc61e141e9f7f3b",
    "research/early-detection-v4/FREE_DATA_ARCHITECTURE.md": "c1662e1bcf26f5473a7c78a5b95509a280762e2e786f1f7ef957bb863b878107",
}
EXPECTED_TOP_KEYS = {
    "schema", "createdAt", "studyTrack", "taskId", "sourceId", "purpose",
    "bindings", "officialEvidence", "accessLanes", "dataset", "eventScope",
    "claimCeiling", "networkPolicy", "pagination", "capturePolicy",
    "catalogSchema", "killConditions", "claimLocks", "authorization",
    "contractSha256",
}
EXPECTED_ROW_KEYS = {
    "OTCDailyListID", "calendarDay", "dailyListDatetime", "dailyListEventCode",
    "securityAddFlag", "securityDeleteFlag", "changeSymbolFlag",
    "changeSecurityDescriptionFlag", "changeSecurityAttributeFlag",
    "changeFinancialStatusFlag", "bankruptcyFlag", "dividendNonADRFlag",
    "dividendADRFlag",
}
EXPECTED_CAPTURE_KEYS = {"schema", "contractRawSha256", "observedAt", "pages"}
EXPECTED_PAGE_KEYS = {"request", "response"}
EXPECTED_REQUEST_KEYS = {"method", "url", "body", "canonicalSha256"}
EXPECTED_RESPONSE_KEYS = {
    "status", "headers", "headersCanonicalSha256", "bodyBase64", "rawSha256", "observedAt"
}
REQUIRED_HEADERS = {
    "content-type", "record-total", "record-offset", "record-limit", "total-records-on-page"
}
EVENT_KEYS = (
    "OTC_SECURITY_ADDITION",
    "OTC_SECURITY_DELETION",
    "OTC_SYMBOL_OR_NAME_CHANGE",
    "OTC_SECURITY_ATTRIBUTE_OR_FINANCIAL_STATUS_CHANGE",
    "OTC_BANKRUPTCY_FLAG",
    "OTC_DIVIDEND_DISTRIBUTION_OR_SPLIT",
)
LOCKS = {
    "outcomesAccessed": False,
    "pricesAccessed": False,
    "returnsAccessed": False,
    "tickerOnlyIdentityAccepted": False,
    "historicalIntervalClaimed": False,
    "completeCorporateActionsClaimed": False,
    "terminalSessionClaimed": False,
    "terminalPaymentClaimed": False,
    "terminalWealthClaimed": False,
    "originalV4GateCredit": False,
    "humanAttestation": False,
    "networkProductionExecuted": False,
}
ERROR_MARKERS = (
    b"<html", b"<!doctype", b"login", b"sign in", b"password", b"unauthorized",
    b"forbidden", b"paywall", b"payment required", b"free trial", b"captcha",
)
FORBIDDEN_CATALOG_TOKENS = re.compile(
    r"(?:ticker|symbolcode|issuename|price|quote|return|wealth|cashamount|paymentamount|"
    r"terminalpayment|lastsession|delistingreturn|h-late|h-fem)", re.IGNORECASE
)
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
STAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{1,6}$")


class CatalogError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise CatalogError(message)


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def pretty_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        actual = sorted(value) if isinstance(value, dict) else type(value).__name__
        fail(f"{label} exact keys mismatch: {actual}")


def self_hash(value: dict[str, Any], field: str) -> str:
    clone = copy.deepcopy(value)
    clone.pop(field, None)
    return sha256_bytes(canonical_bytes(clone))


def parse_utc(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        fail(f"{label} must be an ISO UTC timestamp")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise CatalogError(f"{label} invalid timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        fail(f"{label} must be UTC")
    return parsed


def parse_daily_stamp(value: Any) -> datetime:
    if not isinstance(value, str) or STAMP_RE.fullmatch(value) is None:
        fail("dailyListDatetime schema drift")
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S.%f").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise CatalogError("dailyListDatetime invalid") from exc


def git(*args: str) -> str:
    proc = subprocess.run(
        ["git", "-C", str(ROOT), *args], capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if proc.returncode != 0:
        fail(f"git {' '.join(args)} failed: {proc.stderr.strip()}")
    return proc.stdout.strip()


def verify_input_selectors() -> None:
    free_registry = json.loads((ROOT / "research/early-detection-v4/free-source-registry.json").read_text("utf-8"))
    continuous = json.loads((ROOT / "research/early-detection-v4/continuous-free-source-registry-v1.json").read_text("utf-8"))
    queue = json.loads((ROOT / "research/early-detection-v4/continuous-free-source-queue-seed-v1.json").read_text("utf-8"))
    if sum(x.get("sourceId") == "FINRA_OTC_DAILY_LIST" for x in free_registry.get("sources", [])) != 1:
        fail("free registry FINRA selector drift")
    if sum(x.get("sourceId") == "FINRA_OTC_PRIMARY" for x in continuous.get("sources", [])) != 1:
        fail("continuous registry FINRA selector drift")
    tasks = [x for x in queue.get("tasks", []) if x.get("taskId") == "Q004-FINRA-OTC-CATALOG"]
    if len(tasks) != 1 or tasks[0].get("sourceId") != "FINRA_OTC_PRIMARY":
        fail("Q004 queue selector drift")
    # FREE_DATA_ARCHITECTURE is a policy-byte binding, not a FINRA row selector.
    # Its exact raw hash is enforced in load_contract().


def verify_contract_semantics(contract: dict[str, Any]) -> None:
    exact_keys(contract, EXPECTED_TOP_KEYS, "contract")
    if contract.get("schema") != EXPECTED_SCHEMA:
        fail("contract schema drift")
    if contract.get("taskId") != "Q004-FINRA-OTC-CATALOG" or contract.get("sourceId") != "FINRA_OTC_PRIMARY":
        fail("task/source drift")
    bindings = contract.get("bindings", {})
    if bindings.get("repository") != EXPECTED_REMOTE or bindings.get("remoteRef") != EXPECTED_REMOTE_REF:
        fail("remote binding drift")
    for key in ("baselineHead", "baselineUpstreamHead", "baselineRemoteHead"):
        if bindings.get(key) != EXPECTED_BASELINE_HEAD:
            fail(f"baseline binding drift: {key}")
    bound = {x.get("path"): x.get("rawSha256") for x in bindings.get("inputs", [])}
    if bound != EXPECTED_INPUTS:
        fail("input binding set drift")
    if contract.get("dataset", {}).get("dataUrl") != EXPECTED_DATA_URL:
        fail("data URL drift")
    if set(contract.get("dataset", {}).get("catalogOnlyFields", [])) != EXPECTED_ROW_KEYS:
        fail("catalog-only field set drift")
    lanes = {x.get("laneId"): x for x in contract.get("accessLanes", [])}
    if set(lanes) != {
        "PUBLIC_CREDENTIAL_QUERY_API", "OTCE_WEBSITE_AND_ARCHIVES", "FIRM_OR_ORGANIZATION_QUERY_API"
    }:
        fail("access lane set drift")
    public_api = lanes["PUBLIC_CREDENTIAL_QUERY_API"]
    if public_api.get("monthlyPriceUsd") != 0 or public_api.get("accountRequired") is not True:
        fail("zero-cost registered API disposition drift")
    if public_api.get("permittedInThisNoAccountContract") is not False:
        fail("accounted API must remain forbidden in no-account contract")
    website = lanes["OTCE_WEBSITE_AND_ARCHIVES"]
    if website.get("permittedInThisNoAccountContract") is not False:
        fail("website scrape must remain forbidden")
    paid = lanes["FIRM_OR_ORGANIZATION_QUERY_API"]
    if paid.get("monthlyPriceUsd") != 1650 or paid.get("disposition") != "PROHIBITED_PAID":
        fail("paid lane disposition drift")
    policy = contract.get("networkPolicy", {})
    required_policy = {
        "networkExecutionAuthorized": False,
        "redirectsAllowed": False,
        "proxyUseAllowed": False,
        "proxyBypassAllowed": False,
        "automaticRetriesAllowed": False,
        "retryStormAllowed": False,
        "requestsPerRunMaximum": 0,
        "responseBytesPerRunMaximum": 0,
        "documentedSyncRequestsPerMinute": 1200,
        "contractCeilingRequestsPerMinuteAfterSeparateAuthorization": 30,
    }
    for key, value in required_policy.items():
        if policy.get(key) != value:
            fail(f"network policy drift: {key}")
    if contract.get("claimLocks") != LOCKS:
        fail("claim locks drift")
    if set(contract.get("claimCeiling", {}).get("forbidden", [])) < {
        "TICKER_ONLY_IDENTITY", "LAST_QUOTE_OR_LAST_SESSION", "TERMINAL_PAYMENT_OR_TERMINAL_WEALTH",
        "PRICE_RETURN_OR_OUTCOME", "ORIGINAL_V4_GATE_CREDIT", "HUMAN_ATTESTATION",
    }:
        fail("claim ceiling drift")
    auth = contract.get("authorization", {})
    if any(auth.get(key) is not False for key in (
        "catalogBuildAuthorized", "networkRunAuthorized", "outcomeAccessAuthorized"
    )):
        fail("authorization lock drift")
    if contract.get("contractSha256") != EXPECTED_CONTRACT_SHA256:
        fail("declared contract self-hash drift")
    if self_hash(contract, "contractSha256") != EXPECTED_CONTRACT_SHA256:
        fail("contract self-hash mismatch")


def load_contract() -> dict[str, Any]:
    raw = CONTRACT_PATH.read_bytes()
    if sha256_bytes(raw) != EXPECTED_CONTRACT_RAW_SHA256:
        fail("contract raw-byte hash mismatch")
    try:
        contract = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CatalogError(f"contract is not valid UTF-8 JSON: {exc}") from exc
    verify_contract_semantics(contract)
    for rel, expected in EXPECTED_INPUTS.items():
        if sha256_bytes((ROOT / rel).read_bytes()) != expected:
            fail(f"input raw-byte hash mismatch: {rel}")
    verify_input_selectors()
    if git("remote", "get-url", "origin") != EXPECTED_REMOTE:
        fail("origin URL drift")
    if git("cat-file", "-t", EXPECTED_BASELINE_HEAD) != "commit":
        fail("baseline commit unavailable")
    return contract


def canonical_request_body(contract: dict[str, Any], day: str, limit: int, offset: int) -> dict[str, Any]:
    if DAY_RE.fullmatch(day) is None:
        fail("request calendarDay invalid")
    ceiling = contract["pagination"]["contractPageLimitAfterSeparateAuthorization"]
    if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1 or limit > ceiling:
        fail("request limit invalid")
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
        fail("request offset invalid")
    return {
        "fields": contract["dataset"]["catalogOnlyFields"],
        "dateRangeFilters": [{"fieldName": "calendarDay", "startDate": day, "endDate": day}],
        "limit": limit,
        "offset": offset,
        "sortFields": ["+calendarDay", "+dailyListDatetime", "+OTCDailyListID"],
    }


def event_classes(row: dict[str, Any]) -> list[str]:
    result: list[str] = []
    if row["securityAddFlag"] == "Y":
        result.append("OTC_SECURITY_ADDITION")
    if row["securityDeleteFlag"] == "Y":
        result.append("OTC_SECURITY_DELETION")
    if row["changeSymbolFlag"] == "Y" or row["changeSecurityDescriptionFlag"] == "Y":
        result.append("OTC_SYMBOL_OR_NAME_CHANGE")
    if row["changeSecurityAttributeFlag"] == "Y" or row["changeFinancialStatusFlag"] == "Y":
        result.append("OTC_SECURITY_ATTRIBUTE_OR_FINANCIAL_STATUS_CHANGE")
    if row["bankruptcyFlag"] == "Y":
        result.append("OTC_BANKRUPTCY_FLAG")
    if row["dividendNonADRFlag"] == "Y" or row["dividendADRFlag"] == "Y":
        result.append("OTC_DIVIDEND_DISTRIBUTION_OR_SPLIT")
    return result


def validate_row(row: Any, expected_day: str, observed: datetime) -> tuple[int, list[str]]:
    exact_keys(row, EXPECTED_ROW_KEYS, "catalog row")
    row_id = row.get("OTCDailyListID")
    if not isinstance(row_id, int) or isinstance(row_id, bool) or row_id <= 0:
        fail("OTCDailyListID must be a positive integer")
    if row.get("calendarDay") != expected_day:
        fail("partition loss or calendarDay drift")
    if DAY_RE.fullmatch(row["calendarDay"]) is None:
        fail("calendarDay schema drift")
    stamp = parse_daily_stamp(row.get("dailyListDatetime"))
    if stamp.date().isoformat() != expected_day or stamp > observed:
        fail("date inversion")
    code = row.get("dailyListEventCode")
    if not isinstance(code, str) or not code or len(code) > 16:
        fail("dailyListEventCode schema drift")
    for key in EXPECTED_ROW_KEYS - {"OTCDailyListID", "calendarDay", "dailyListDatetime", "dailyListEventCode"}:
        if row.get(key) not in {"Y", "N", None}:
            fail(f"event flag schema drift: {key}")
    classes = event_classes(row)
    if not classes:
        fail("row has no catalog event class")
    return row_id, classes


def validate_capture_bundle(bundle: Any, contract: dict[str, Any]) -> dict[str, Any]:
    exact_keys(bundle, EXPECTED_CAPTURE_KEYS, "capture bundle")
    if bundle.get("schema") != "finra-q004-capture-fixture/v1":
        fail("capture schema drift")
    if bundle.get("contractRawSha256") != EXPECTED_CONTRACT_RAW_SHA256:
        fail("capture contract binding drift")
    bundle_observed = parse_utc(bundle.get("observedAt"), "bundle observedAt")
    pages = bundle.get("pages")
    if not isinstance(pages, list) or not pages:
        fail("capture pages missing")
    if len(pages) > 10000:
        fail("fixture request ceiling exceeded")

    seen_ids: dict[int, str] = {}
    total_expected: int | None = None
    expected_offset = 0
    expected_day: str | None = None
    page_summaries: list[dict[str, Any]] = []
    counts = {key: 0 for key in EVENT_KEYS}

    for index, page in enumerate(pages):
        exact_keys(page, EXPECTED_PAGE_KEYS, f"page {index}")
        request = page["request"]
        response = page["response"]
        exact_keys(request, EXPECTED_REQUEST_KEYS, f"page {index} request")
        exact_keys(response, EXPECTED_RESPONSE_KEYS, f"page {index} response")
        if request.get("method") != "POST" or request.get("url") != EXPECTED_DATA_URL:
            fail("request method or exact URL drift")
        body = request.get("body")
        if not isinstance(body, dict):
            fail("request body missing")
        ranges = body.get("dateRangeFilters")
        if not isinstance(ranges, list) or len(ranges) != 1 or not isinstance(ranges[0], dict):
            fail("calendarDay filter drift")
        day = ranges[0].get("startDate")
        if body != canonical_request_body(contract, day, body.get("limit"), body.get("offset")):
            fail("request body drift")
        if request.get("canonicalSha256") != sha256_bytes(canonical_bytes({
            "method": request["method"], "url": request["url"], "body": body
        })):
            fail("request canonical hash mismatch")
        if expected_day is None:
            expected_day = day
        elif day != expected_day:
            fail("multiple partitions in one capture bundle")
        if body["offset"] != expected_offset:
            fail("pagination gap or overlap")

        if response.get("status") != 200:
            fail("non-200 response")
        page_observed = parse_utc(response.get("observedAt"), f"page {index} observedAt")
        if page_observed > bundle_observed:
            fail("observedAt date inversion")
        headers = response.get("headers")
        if not isinstance(headers, dict) or any(not isinstance(k, str) or k != k.lower() for k in headers):
            fail("response headers must use lowercase keys")
        if not REQUIRED_HEADERS.issubset(headers):
            fail("required pagination headers missing")
        if "location" in headers:
            fail("redirect header forbidden")
        if response.get("headersCanonicalSha256") != sha256_bytes(canonical_bytes(headers)):
            fail("response header hash mismatch")
        if headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            fail("content-type drift")
        try:
            raw = base64.b64decode(response.get("bodyBase64"), validate=True)
        except (TypeError, ValueError) as exc:
            raise CatalogError("response bodyBase64 invalid") from exc
        if len(raw) > contract["networkPolicy"]["responseBytesPerRequestMaximum"]:
            fail("response byte ceiling exceeded")
        if response.get("rawSha256") != sha256_bytes(raw):
            fail("raw response hash mismatch")
        lowered = raw.lower()
        if any(marker in lowered for marker in ERROR_MARKERS):
            fail("HTTP 200 error/login/paywall body")
        try:
            rows = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CatalogError("response is not valid JSON") from exc
        if isinstance(rows, dict):
            fail("HTTP 200 error object or schema drift")
        if not isinstance(rows, list):
            fail("response schema drift")
        try:
            record_total = int(headers["record-total"])
            record_offset = int(headers["record-offset"])
            record_limit = int(headers["record-limit"])
            records_on_page = int(headers["total-records-on-page"])
        except (TypeError, ValueError) as exc:
            raise CatalogError("pagination header is not an integer") from exc
        if min(record_total, record_offset, record_limit, records_on_page) < 0 or record_limit < 1:
            fail("negative or zero pagination header")
        if record_offset != body["offset"] or record_limit != body["limit"] or records_on_page != len(rows):
            fail("pagination header/body mismatch")
        if total_expected is None:
            total_expected = record_total
        elif record_total != total_expected:
            fail("record-total drift")
        if record_total < record_offset + len(rows):
            fail("pagination exceeds record-total")

        for row in rows:
            row_id, classes = validate_row(row, day, page_observed)
            row_hash = sha256_bytes(canonical_bytes(row))
            if row_id in seen_ids:
                if seen_ids[row_id] != row_hash:
                    fail("duplicate OTCDailyListID with conflicting row bytes")
                fail("duplicate OTCDailyListID")
            seen_ids[row_id] = row_hash
            for event in classes:
                counts[event] += 1
        expected_offset += len(rows)
        page_summaries.append({
            "pageIndex": index,
            "offset": record_offset,
            "records": len(rows),
            "rawSha256": response["rawSha256"],
            "requestCanonicalSha256": request["canonicalSha256"],
            "responseHeaderCanonicalSha256": response["headersCanonicalSha256"],
            "observedAt": response["observedAt"],
        })

    if total_expected is None or len(seen_ids) != total_expected or expected_offset != total_expected:
        fail("pagination row loss or incomplete exhaustion")
    if page_summaries[-1]["records"] > contract["pagination"]["contractPageLimitAfterSeparateAuthorization"]:
        fail("final page limit exceeded")
    source_refs = ["FINRA_DOCS_OTC_DAILY_LIST", "FINRA_OTC_METADATA", "FINRA_EQUITY_SPECIFIC_TERMS"]
    run_id = sha256_bytes(canonical_bytes({
        "contract": EXPECTED_CONTRACT_RAW_SHA256,
        "day": expected_day,
        "pages": [p["rawSha256"] for p in page_summaries],
    }))[:24]
    catalog: dict[str, Any] = {
        "schema": contract["catalogSchema"]["schema"],
        "contractRawSha256": EXPECTED_CONTRACT_RAW_SHA256,
        "runId": run_id,
        "observedAt": bundle["observedAt"],
        "accessDisposition": "OFFLINE_FIXTURE_VALIDATION_ONLY_NO_NETWORK_OR_GATE_CREDIT",
        "dataset": {"group": "otcMarket", "name": "otcDailyList", "catalogOnly": True},
        "pages": page_summaries,
        "partitions": [{"calendarDay": expected_day, "recordTotal": total_expected}],
        "eventClassCounts": counts,
        "sourceRefs": source_refs,
        "claimCeiling": "EVENT_CATALOG_CANDIDATE_ONLY",
        "claimLocks": LOCKS,
        "catalogSha256": "",
    }
    if set(catalog) != set(contract["catalogSchema"]["exactTopLevelKeys"]):
        fail("catalog exact schema mismatch")
    catalog["catalogSha256"] = self_hash(catalog, "catalogSha256")
    if FORBIDDEN_CATALOG_TOKENS.search(json.dumps(catalog, sort_keys=True)):
        # The fixed lock names contain terminal/payment words by design; inspect data-bearing sections only.
        inspectable = {key: value for key, value in catalog.items() if key not in {"claimLocks"}}
        if FORBIDDEN_CATALOG_TOKENS.search(json.dumps(inspectable, sort_keys=True)):
            fail("forbidden ticker/price/payment/outcome token in catalog")
    return catalog


def atomic_write_new(path: Path, raw: bytes) -> None:
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        fail("output already exists")
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temp = Path(temp_name)
    linked = False
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        if sha256_bytes(temp.read_bytes()) != sha256_bytes(raw):
            fail("temporary output verification failed")
        os.link(temp, path)
        linked = True
        if path.read_bytes() != raw:
            fail("atomic output verification failed")
    except FileExistsError as exc:
        raise CatalogError("output already exists") from exc
    finally:
        try:
            temp.unlink(missing_ok=True)
        except OSError:
            if not linked:
                raise


def dry_run(contract: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": "finra-q004-public-catalog-dry-run/v1",
        "status": "BLOCKED_AS_DESIGNED",
        "networkRequests": 0,
        "filesWritten": 0,
        "todayAccessStatus": contract["authorization"]["todayAccessStatus"],
        "noAccountStatus": contract["authorization"]["noAccountStatus"],
        "nextPermissibleStep": contract["authorization"]["nextPermissibleStep"],
        "claimLocks": LOCKS,
    }


def fixture_row(row_id: int, stamp: str, **flags: str | None) -> dict[str, Any]:
    row: dict[str, Any] = {
        "OTCDailyListID": row_id,
        "calendarDay": "2020-01-02",
        "dailyListDatetime": stamp,
        "dailyListEventCode": "TEST",
        "securityAddFlag": "N",
        "securityDeleteFlag": "N",
        "changeSymbolFlag": "N",
        "changeSecurityDescriptionFlag": "N",
        "changeSecurityAttributeFlag": "N",
        "changeFinancialStatusFlag": "N",
        "bankruptcyFlag": "N",
        "dividendNonADRFlag": "N",
        "dividendADRFlag": "N",
    }
    row.update(flags)
    return row


def fixture_page(contract: dict[str, Any], rows: list[dict[str, Any]], offset: int, total: int) -> dict[str, Any]:
    body = canonical_request_body(contract, "2020-01-02", 2, offset)
    request_core = {"method": "POST", "url": EXPECTED_DATA_URL, "body": body}
    raw = canonical_bytes(rows)
    headers = {
        "content-type": "application/json",
        "record-total": str(total),
        "record-offset": str(offset),
        "record-limit": "2",
        "total-records-on-page": str(len(rows)),
    }
    return {
        "request": {**request_core, "canonicalSha256": sha256_bytes(canonical_bytes(request_core))},
        "response": {
            "status": 200,
            "headers": headers,
            "headersCanonicalSha256": sha256_bytes(canonical_bytes(headers)),
            "bodyBase64": base64.b64encode(raw).decode("ascii"),
            "rawSha256": sha256_bytes(raw),
            "observedAt": "2026-08-12T15:00:00Z",
        },
    }


def valid_fixture(contract: dict[str, Any]) -> dict[str, Any]:
    rows = [
        fixture_row(10, "2020-01-02 09:00:00.000", securityAddFlag="Y"),
        fixture_row(11, "2020-01-02 10:00:00.000", changeSymbolFlag="Y"),
        fixture_row(12, "2020-01-02 11:00:00.000", securityDeleteFlag="Y", bankruptcyFlag="Y"),
        fixture_row(13, "2020-01-02 12:00:00.000", dividendNonADRFlag="Y"),
    ]
    return {
        "schema": "finra-q004-capture-fixture/v1",
        "contractRawSha256": EXPECTED_CONTRACT_RAW_SHA256,
        "observedAt": "2026-08-12T15:00:01Z",
        "pages": [fixture_page(contract, rows[:2], 0, 4), fixture_page(contract, rows[2:], 2, 4)],
    }


def refresh_page_hash(page: dict[str, Any]) -> None:
    raw = canonical_bytes(json.loads(base64.b64decode(page["response"]["bodyBase64"])))
    page["response"]["bodyBase64"] = base64.b64encode(raw).decode("ascii")
    page["response"]["rawSha256"] = sha256_bytes(raw)
    page["response"]["headersCanonicalSha256"] = sha256_bytes(canonical_bytes(page["response"]["headers"]))
    core = {key: page["request"][key] for key in ("method", "url", "body")}
    page["request"]["canonicalSha256"] = sha256_bytes(canonical_bytes(core))


def expect_kill(contract: dict[str, Any], mutator: Any, label: str) -> None:
    candidate = valid_fixture(contract)
    mutator(candidate)
    try:
        validate_capture_bundle(candidate, contract)
    except CatalogError:
        return
    fail(f"self-test kill did not fire: {label}")


def self_test(contract: dict[str, Any]) -> dict[str, Any]:
    fixture = valid_fixture(contract)
    first = validate_capture_bundle(fixture, contract)
    second = validate_capture_bundle(copy.deepcopy(fixture), contract)
    if canonical_bytes(first) != canonical_bytes(second):
        fail("determinism self-test failed")
    reordered = copy.deepcopy(fixture)
    for page in reordered["pages"]:
        rows = json.loads(base64.b64decode(page["response"]["bodyBase64"]))
        rows.reverse()
        page["response"]["bodyBase64"] = base64.b64encode(canonical_bytes(rows)).decode("ascii")
        refresh_page_hash(page)
    reordered_catalog = validate_capture_bundle(reordered, contract)
    if reordered_catalog["eventClassCounts"] != first["eventClassCounts"]:
        fail("row reordering changed event counts")

    def error_200(x: dict[str, Any]) -> None:
        raw = b'{"error":"login required"}'
        x["pages"][0]["response"]["bodyBase64"] = base64.b64encode(raw).decode("ascii")
        x["pages"][0]["response"]["rawSha256"] = sha256_bytes(raw)

    def drop_row(x: dict[str, Any]) -> None:
        page = x["pages"][1]
        rows = json.loads(base64.b64decode(page["response"]["bodyBase64"]))[:-1]
        page["response"]["bodyBase64"] = base64.b64encode(canonical_bytes(rows)).decode("ascii")
        page["response"]["headers"]["total-records-on-page"] = str(len(rows))
        refresh_page_hash(page)

    def duplicate_row(x: dict[str, Any]) -> None:
        page = x["pages"][1]
        rows = json.loads(base64.b64decode(page["response"]["bodyBase64"]))
        rows[0]["OTCDailyListID"] = 10
        page["response"]["bodyBase64"] = base64.b64encode(canonical_bytes(rows)).decode("ascii")
        refresh_page_hash(page)

    def ticker_only(x: dict[str, Any]) -> None:
        page = x["pages"][0]
        rows = json.loads(base64.b64decode(page["response"]["bodyBase64"]))
        rows[0]["symbolCode"] = "FAKE"
        page["response"]["bodyBase64"] = base64.b64encode(canonical_bytes(rows)).decode("ascii")
        refresh_page_hash(page)

    def payment_inference(x: dict[str, Any]) -> None:
        page = x["pages"][0]
        rows = json.loads(base64.b64decode(page["response"]["bodyBase64"]))
        rows[0]["cashAmountText"] = "1.00"
        page["response"]["bodyBase64"] = base64.b64encode(canonical_bytes(rows)).decode("ascii")
        refresh_page_hash(page)

    def future_date(x: dict[str, Any]) -> None:
        page = x["pages"][0]
        rows = json.loads(base64.b64decode(page["response"]["bodyBase64"]))
        rows[0]["dailyListDatetime"] = "2030-01-02 09:00:00.000"
        page["response"]["bodyBase64"] = base64.b64encode(canonical_bytes(rows)).decode("ascii")
        refresh_page_hash(page)

    def bad_offset(x: dict[str, Any]) -> None:
        x["pages"][1]["request"]["body"]["offset"] = 3
        x["pages"][1]["response"]["headers"]["record-offset"] = "3"
        refresh_page_hash(x["pages"][1])

    def redirect(x: dict[str, Any]) -> None:
        x["pages"][0]["response"]["headers"]["location"] = "https://example.invalid/"
        refresh_page_hash(x["pages"][0])

    kills = [
        (lambda x: x["pages"][0]["response"].__setitem__("status", 401), "login/account"),
        (error_200, "HTTP 200 error"),
        (lambda x: x["pages"][0]["response"].__setitem__("rawSha256", "0" * 64), "raw hash"),
        (lambda x: x["pages"][0]["response"]["headers"].__setitem__("content-type", "text/html"), "content type"),
        (drop_row, "row loss"),
        (duplicate_row, "duplicate row"),
        (bad_offset, "pagination gap"),
        (lambda x: x["pages"][1]["response"]["headers"].__setitem__("record-total", "5"), "count drift"),
        (ticker_only, "ticker-only promotion"),
        (payment_inference, "payment inference"),
        (future_date, "date inversion"),
        (redirect, "redirect"),
        (lambda x: x["pages"][0]["request"].__setitem__("url", "https://proxy.invalid/data"), "proxy URL"),
        (lambda x: x.__setitem__("outcome", 1), "capture schema drift"),
    ]
    for mutator, label in kills:
        expect_kill(contract, mutator, label)
    return {
        "schema": "finra-q004-public-catalog-self-test/v1",
        "status": "PASS",
        "tests": len(kills) + 3,
        "networkRequests": 0,
        "claimLocks": LOCKS,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("verify-contract", "dry-run", "self-test", "build-fixture", "crawl"))
    parser.add_argument("--output")
    args = parser.parse_args()
    try:
        contract = load_contract()
        if args.command == "verify-contract":
            result = {
                "schema": "finra-q004-public-catalog-contract-verification/v1",
                "status": "PASS",
                "contractRawSha256": EXPECTED_CONTRACT_RAW_SHA256,
                "contractSha256": EXPECTED_CONTRACT_SHA256,
                "networkRequests": 0,
                "claimLocks": LOCKS,
            }
        elif args.command == "dry-run":
            result = dry_run(contract)
        elif args.command == "self-test":
            result = self_test(contract)
        elif args.command == "crawl":
            fail("NETWORK_EXECUTION_NOT_AUTHORIZED_NO_ACCOUNT_CONTRACT")
        else:
            try:
                bundle = json.loads(sys.stdin.buffer.read())
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise CatalogError(f"fixture input is not valid UTF-8 JSON: {exc}") from exc
            result = validate_capture_bundle(bundle, contract)
            if args.output:
                atomic_write_new(Path(args.output), pretty_bytes(result))
                result = {
                    "schema": "finra-q004-public-catalog-write-result/v1",
                    "status": "PASS",
                    "output": str(Path(args.output).resolve()),
                    "outputRawSha256": sha256_bytes(Path(args.output).read_bytes()),
                    "catalogSha256": result["catalogSha256"],
                    "networkRequests": 0,
                    "claimLocks": LOCKS,
                }
        sys.stdout.buffer.write(pretty_bytes(result))
        return 0
    except CatalogError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
