#!/usr/bin/env python3
"""Acquire and index official SEC EDGAR quarterly master indexes.

Direct sec.gov downloads are preferred.  If the local network denies them, an
exact Wayback CDX record may transport the same official URL.  The transport
digest, raw ZIP and parsed rows remain append-only.  A quarterly master index is
only a filing locator: it is never represented as a complete historical listing
ledger or as proof that a filing was observable at quarter end.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import importlib.util
import io
import json
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


CDX_BASE = "https://web.archive.org/cdx/search/cdx"
REPLAY_BASE = "https://web.archive.org/web/"
DEFAULT_USER_AGENT = "Growth-Screener-Research/1.0 contact=https://github.com/Karlryl/screener-data"
OBSERVATION_SCHEMA = "early-detection-sec-edgar-master-index-observation/v1"
REPORT_SCHEMA = "early-detection-sec-edgar-master-index-report/v1"
QUARTER_RE = re.compile(r"(20\d{2})q([1-4])")
ACCESSION_RE = re.compile(r"(\d{10}-\d{2}-\d{6})\.txt$", re.IGNORECASE)


class SecIndexError(RuntimeError):
    """SEC quarterly master-index evidence failed closed."""


def load_foundation() -> ModuleType:
    path = Path(__file__).resolve().with_name("early-detection-foundation.py")
    spec = importlib.util.spec_from_file_location("early_detection_foundation_sec_index", path)
    if spec is None or spec.loader is None:
        raise SecIndexError(f"cannot load foundation module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def quarter_key(value: str) -> int:
    match = QUARTER_RE.fullmatch(value)
    if match is None:
        raise SecIndexError(f"invalid quarter: {value}")
    return int(match.group(1)) * 4 + int(match.group(2)) - 1


def quarters(first: str, last: str) -> list[str]:
    start, end = quarter_key(first), quarter_key(last)
    if start > end:
        raise SecIndexError("from-quarter must not be after to-quarter")
    return [f"{key // 4}q{key % 4 + 1}" for key in range(start, end + 1)]


def official_url(quarter: str) -> str:
    match = QUARTER_RE.fullmatch(quarter)
    if match is None:
        raise SecIndexError(f"invalid quarter: {quarter}")
    return f"https://www.sec.gov/Archives/edgar/full-index/{match.group(1)}/QTR{match.group(2)}/master.zip"


def fetch(url: str, user_agent: str, timeout: int, retries: int) -> tuple[bytes, dict[str, str]]:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={"User-Agent": user_agent, "Accept-Encoding": "identity"},
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read(), {key.lower(): value for key, value in response.headers.items()}
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(8.0, 2.0 ** attempt))
    raise SecIndexError(f"download failed after {retries + 1} attempts: {url}: {last_error}")


def cdx_url(source_url: str) -> str:
    return CDX_BASE + "?" + urllib.parse.urlencode({
        "url": source_url,
        "output": "json",
        "filter": "statuscode:200",
        "fl": "timestamp,original,statuscode,digest,length",
        "collapse": "digest",
        "limit": "100",
    })


def timemap_url(source_url: str) -> str:
    return "https://web.archive.org/web/timemap/json?" + urllib.parse.urlencode({
        "url": source_url,
        "fl": "timestamp,original,digest,statuscode",
        "filter": "statuscode:200",
    })


def parse_cdx(payload: bytes, source_url: str) -> list[dict[str, Any]]:
    try:
        values = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SecIndexError("Wayback CDX response is not UTF-8 JSON") from exc
    header = ["timestamp", "original", "statuscode", "digest", "length"]
    if not isinstance(values, list) or not values or values[0] != header:
        raise SecIndexError("Wayback CDX columns changed")
    result: list[dict[str, Any]] = []
    for row in values[1:]:
        if not isinstance(row, list) or len(row) != len(header):
            raise SecIndexError("invalid Wayback CDX row")
        item = dict(zip(header, row))
        if item["statuscode"] != "200" or str(item["original"]).lower() != source_url.lower():
            continue
        if not re.fullmatch(r"20\d{12}", str(item["timestamp"])):
            raise SecIndexError("invalid Wayback capture timestamp")
        item["length"] = int(item["length"])
        result.append(item)
    return sorted(result, key=lambda item: str(item["timestamp"]))


def parse_timemap(payload: bytes, source_url: str) -> list[dict[str, Any]]:
    try:
        values = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SecIndexError("Wayback TimeMap response is not UTF-8 JSON") from exc
    header = ["timestamp", "original", "digest", "statuscode"]
    if not isinstance(values, list) or not values or values[0] != header:
        raise SecIndexError("Wayback TimeMap columns changed")
    result: list[dict[str, Any]] = []
    for row in values[1:]:
        if not isinstance(row, list) or len(row) != len(header):
            raise SecIndexError("invalid Wayback TimeMap row")
        item = dict(zip(header, row))
        if item["statuscode"] == "200" and str(item["original"]).lower() == source_url.lower():
            if not re.fullmatch(r"20\d{12}", str(item["timestamp"])):
                raise SecIndexError("invalid Wayback TimeMap timestamp")
            result.append(item)
    return sorted(result, key=lambda item: str(item["timestamp"]))


def sha1_base32(payload: bytes) -> str:
    return base64.b32encode(hashlib.sha1(payload).digest()).decode("ascii").rstrip("=")


def capture_instant(timestamp: str) -> str:
    parsed = datetime.strptime(timestamp, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_master_zip(payload: bytes, expected_quarter: str) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            bad_member = archive.testzip()
            if bad_member is not None:
                raise SecIndexError(f"SEC master ZIP CRC failed for {bad_member}")
            candidates = [info for info in archive.infolist() if Path(info.filename).name.lower() == "master.idx"]
            if len(candidates) != 1:
                raise SecIndexError(f"SEC master ZIP must contain exactly one master.idx, found {len(candidates)}")
            raw = archive.read(candidates[0])
    except zipfile.BadZipFile as exc:
        raise SecIndexError("SEC master payload is not a ZIP") from exc
    text = raw.decode("latin-1")
    lines = text.splitlines()
    header_index = next((index for index, line in enumerate(lines) if line.strip() == "CIK|Company Name|Form Type|Date Filed|Filename"), None)
    if header_index is None:
        raise SecIndexError("SEC master.idx header changed")
    records: list[dict[str, Any]] = []
    source_anomalies: list[dict[str, Any]] = []
    for row_number, row in enumerate(csv.reader(lines[header_index + 1 :], delimiter="|"), start=header_index + 2):
        if not row or not any(value.strip() for value in row):
            continue
        if set("|".join(row).strip()) <= {"-", "|", " "}:
            continue
        if len(row) != 5:
            raise SecIndexError(f"SEC master.idx row width changed at {row_number}: {len(row)}")
        cik_raw, company_name, form, filed_date, filename = (value.strip() for value in row)
        if not cik_raw.isdigit() or not form or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", filed_date):
            raise SecIndexError(f"invalid SEC master.idx row at {row_number}")
        if not company_name:
            source_anomalies.append({"rowNumber": row_number, "reason": "BLANK_COMPANY_NAME"})
        accession_match = ACCESSION_RE.search(filename)
        records.append({
            "rowNumber": row_number,
            "cik": int(cik_raw),
            "companyName": company_name,
            "form": form,
            "filedDate": filed_date,
            "filename": filename,
            "accession": accession_match.group(1) if accession_match else None,
        })
    if not records:
        raise SecIndexError(f"SEC {expected_quarter} master.idx contains no filings")
    return {
        "member": candidates[0].filename,
        "memberBytes": len(raw),
        "memberSha256": hashlib.sha256(raw).hexdigest(),
        "rows": len(records),
        "firstFiledDate": min(item["filedDate"] for item in records),
        "lastFiledDate": max(item["filedDate"] for item in records),
        "forms": dict(sorted(Counter(item["form"] for item in records).items())),
        "sourceAnomalies": source_anomalies,
        "records": records,
    }


def acquire_one(
    data_root: Path,
    quarter: str,
    user_agent: str,
    timeout: int,
    retries: int,
) -> dict[str, Any]:
    foundation = load_foundation()
    root = foundation.ensure_data_root(data_root)
    source_url = official_url(quarter)
    transport = "sec_direct"
    cdx_record: dict[str, Any] | None = None
    cdx_query_sha: str | None = None
    archive_query_transport: str | None = None
    try:
        payload, headers = fetch(source_url, user_agent, timeout, retries)
        observed_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except SecIndexError as direct_error:
        try:
            query_payload, _ = fetch(timemap_url(source_url), user_agent, timeout, retries)
            captures = parse_timemap(query_payload, source_url)
            archive_query_transport = "wayback_timemap_json"
        except SecIndexError:
            query_payload, _ = fetch(cdx_url(source_url), user_agent, timeout, retries)
            captures = parse_cdx(query_payload, source_url)
            archive_query_transport = "wayback_cdx_json"
        cdx_query_sha = hashlib.sha256(query_payload).hexdigest()
        if not captures:
            raise SecIndexError(f"no verified SEC or Wayback transport for {quarter}: {direct_error}") from direct_error
        replay_errors: list[str] = []
        for candidate in captures:
            replay = f"{REPLAY_BASE}{candidate['timestamp']}id_/{candidate['original']}"
            try:
                candidate_payload, candidate_headers = fetch(replay, user_agent, timeout, retries)
            except SecIndexError as exc:
                replay_errors.append(f"{candidate['timestamp']}:download:{exc}")
                continue
            if sha1_base32(candidate_payload) != candidate["digest"]:
                replay_errors.append(f"{candidate['timestamp']}:digest_mismatch")
                continue
            try:
                parse_master_zip(candidate_payload, quarter)
            except SecIndexError as exc:
                replay_errors.append(f"{candidate['timestamp']}:payload:{exc}")
                continue
            cdx_record = candidate
            payload, headers = candidate_payload, candidate_headers
            break
        if cdx_record is None:
            raise SecIndexError(f"no digest-valid Wayback replay for {quarter}: {'; '.join(replay_errors)}")
        observed_at = capture_instant(str(cdx_record["timestamp"]))
        transport = "wayback_cdx_digest_verified"
    parsed = parse_master_zip(payload, quarter)
    payload_sha, payload_relative, created = foundation.store_blob(root, ".zip", payload)
    observation = {
        "schema": OBSERVATION_SCHEMA,
        "sourceClass": "sec_edgar_quarterly_master_index",
        "sourceId": f"SEC_EDGAR_MASTER_{quarter.upper()}",
        "quarter": quarter,
        "sourceUrl": source_url,
        "transport": transport,
        "observedAt": observed_at,
        "payloadSha256": payload_sha,
        "payloadBytes": len(payload),
        "payloadPath": payload_relative.as_posix(),
        "member": parsed["member"],
        "memberBytes": parsed["memberBytes"],
        "memberSha256": parsed["memberSha256"],
        "rows": parsed["rows"],
        "firstFiledDate": parsed["firstFiledDate"],
        "lastFiledDate": parsed["lastFiledDate"],
        "sourceAnomalies": parsed["sourceAnomalies"],
        "cdxRecord": cdx_record,
        "cdxQuerySha256": cdx_query_sha,
        "archiveQueryTransport": archive_query_transport,
        "responseHeaders": headers,
        "blobCreated": created,
        "qualityState": "accepted_filing_locator_not_listing_ledger",
        "productiveGqsModified": False,
    }
    observation_path = root / "observations" / "sec-edgar-master-index" / quarter / f"{observed_at.replace(':', '').replace('-', '')}-{payload_sha}.json"
    foundation.write_observation_once(observation_path, observation)
    return {key: observation[key] for key in (
        "quarter", "transport", "observedAt", "payloadSha256", "payloadBytes", "memberSha256", "rows", "firstFiledDate", "lastFiledDate"
    )}


def observation_paths(data_root: Path) -> list[Path]:
    base = data_root / "observations" / "sec-edgar-master-index"
    return sorted(base.rglob("*.json")) if base.exists() else []


def initialize(connection: sqlite3.Connection) -> None:
    connection.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS payloads(
          payload_id INTEGER PRIMARY KEY,
          quarter TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          payload_sha256 TEXT NOT NULL UNIQUE,
          member_sha256 TEXT NOT NULL,
          rows INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS filings(
          payload_id INTEGER NOT NULL,
          row_number INTEGER NOT NULL,
          cik INTEGER NOT NULL,
          company_name TEXT NOT NULL,
          form TEXT NOT NULL,
          filed_date TEXT NOT NULL,
          filename TEXT NOT NULL,
          accession TEXT,
          PRIMARY KEY(payload_id,row_number),
          FOREIGN KEY(payload_id) REFERENCES payloads(payload_id)
        );
        CREATE INDEX IF NOT EXISTS filings_form_date ON filings(form,filed_date,cik);
        CREATE INDEX IF NOT EXISTS filings_accession ON filings(accession);
    """)


def import_observation(connection: sqlite3.Connection, data_root: Path, path: Path) -> None:
    observation = json.loads(path.read_text(encoding="utf-8"))
    if observation.get("schema") != OBSERVATION_SCHEMA:
        raise SecIndexError(f"unexpected SEC master observation: {path}")
    existing = connection.execute("SELECT payload_id FROM payloads WHERE payload_sha256=?", (observation["payloadSha256"],)).fetchone()
    if existing is not None:
        return
    payload_path = data_root / Path(str(observation["payloadPath"]))
    payload = payload_path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != observation["payloadSha256"]:
        raise SecIndexError(f"SEC master payload hash mismatch: {payload_path}")
    parsed = parse_master_zip(payload, str(observation["quarter"]))
    if parsed["memberSha256"] != observation["memberSha256"] or parsed["rows"] != observation["rows"]:
        raise SecIndexError(f"SEC master observation parser evidence mismatch: {path}")
    with connection:
        cursor = connection.execute(
            "INSERT INTO payloads(quarter,observed_at,payload_sha256,member_sha256,rows) VALUES(?,?,?,?,?)",
            (observation["quarter"], observation["observedAt"], observation["payloadSha256"], observation["memberSha256"], parsed["rows"]),
        )
        payload_id = int(cursor.lastrowid)
        connection.executemany(
            "INSERT INTO filings VALUES(?,?,?,?,?,?,?,?)",
            [
                (payload_id, item["rowNumber"], item["cik"], item["companyName"], item["form"], item["filedDate"], item["filename"], item["accession"])
                for item in parsed["records"]
            ],
        )


def logical_manifest(connection: sqlite3.Connection) -> dict[str, Any]:
    hasher = hashlib.sha256()
    for row in connection.execute(
        """SELECT p.quarter,p.observed_at,p.payload_sha256,f.row_number,f.cik,f.company_name,
                  f.form,f.filed_date,f.filename,COALESCE(f.accession,'')
           FROM filings f JOIN payloads p USING(payload_id)
           ORDER BY p.quarter,p.observed_at,p.payload_sha256,f.row_number"""
    ):
        hasher.update(canonical_bytes(list(row)) + b"\n")
    forms = dict(connection.execute("SELECT form,COUNT(*) FROM filings GROUP BY form ORDER BY form").fetchall())
    return {
        "payloads": int(connection.execute("SELECT COUNT(*) FROM payloads").fetchone()[0]),
        "quarters": int(connection.execute("SELECT COUNT(DISTINCT quarter) FROM payloads").fetchone()[0]),
        "rows": int(connection.execute("SELECT COUNT(*) FROM filings").fetchone()[0]),
        "distinctCiks": int(connection.execute("SELECT COUNT(DISTINCT cik) FROM filings").fetchone()[0]),
        "forms": forms,
        "form25FamilyRows": sum(count for form, count in forms.items() if form == "25" or form.startswith(("25-", "25/"))),
        "form15FamilyRows": sum(count for form, count in forms.items() if form == "15" or form.startswith(("15-", "15F-"))),
        "blankCompanyNameRows": int(connection.execute("SELECT COUNT(*) FROM filings WHERE company_name='' ").fetchone()[0]),
        "logicalRowsSha256": hasher.hexdigest(),
    }


def build(data_root: Path, database: Path, report_path: Path) -> dict[str, Any]:
    database.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database)
    try:
        initialize(connection)
        for path in observation_paths(data_root):
            import_observation(connection, data_root, path)
        integrity = connection.execute("PRAGMA quick_check").fetchone()[0]
        manifest = logical_manifest(connection)
        connection.execute("PRAGMA journal_mode=DELETE").fetchone()
    finally:
        connection.close()
    if integrity != "ok":
        raise SecIndexError(f"SEC master index quick_check failed: {integrity}")
    unsigned = {
        "schema": REPORT_SCHEMA,
        "status": "FILING_LOCATOR_PASS_NOT_LISTING_LEDGER",
        "database": str(database.resolve()),
        "databaseBytes": database.stat().st_size,
        **manifest,
        "confirmatoryEligible": False,
        "limitations": [
            "Quarterly EDGAR master indexes locate public filings but do not identify securities or historical listings.",
            "SEC indexes are rebuilt for post-acceptance corrections; original filing headers remain required for exact acceptance evidence.",
            "Rows with a blank issuer name are retained as source anomalies and excluded from name-based entity matching.",
            "Form 25/15 rows are event candidates until the corresponding original submission is hash-bound and parsed.",
        ],
        "productiveGqsModified": False,
    }
    report = {**unsigned, "reportSha256": hashlib.sha256(canonical_bytes(unsigned)).hexdigest()}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def self_test() -> dict[str, Any]:
    text = """Description:           Master Index of EDGAR Dissemination Feed\n\nCIK|Company Name|Form Type|Date Filed|Filename\n---|------------|---------|----------|--------\n1000045|NICHOLAS FINANCIAL INC|10-Q|2009-02-13|edgar/data/1000045/0001193125-09-029469.txt\n2000000|EXAMPLE INC|25-NSE|2009-03-31|edgar/data/2000000/0001234567-09-123456.txt\n3000000||485BPOS|2009-03-31|edgar/data/3000000/0001234567-09-654321.txt\n"""
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("master.idx", text.encode("latin-1"))
    parsed = parse_master_zip(stream.getvalue(), "2009q1")
    if parsed["rows"] != 3 or parsed["records"][1]["accession"] != "0001234567-09-123456" or len(parsed["sourceAnomalies"]) != 1:
        raise SecIndexError("self-test SEC master parser failed")
    cdx = json.dumps([
        ["timestamp", "original", "statuscode", "digest", "length"],
        ["20210327210140", official_url("2009q1"), "200", "ABC", "10"],
    ]).encode()
    if len(parse_cdx(cdx, official_url("2009q1"))) != 1:
        raise SecIndexError("self-test CDX parser failed")
    timemap = json.dumps([
        ["timestamp", "original", "digest", "statuscode"],
        ["20210327210140", official_url("2009q1"), "ABC", "200"],
    ]).encode()
    if len(parse_timemap(timemap, official_url("2009q1"))) != 1:
        raise SecIndexError("self-test TimeMap parser failed")
    return {
        "status": "PASS",
        "rows": parsed["rows"],
        "form25FamilyRows": parsed["forms"].get("25-NSE", 0),
        "sourceAnomalies": len(parsed["sourceAnomalies"]),
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    sub = result.add_subparsers(dest="command", required=True)
    acquire = sub.add_parser("acquire")
    acquire.add_argument("--data-root", type=Path, required=True)
    acquire.add_argument("--from-quarter", required=True)
    acquire.add_argument("--to-quarter", required=True)
    acquire.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    acquire.add_argument("--timeout", type=int, default=120)
    acquire.add_argument("--retries", type=int, default=2)
    acquire.add_argument("--sleep-ms", type=int, default=500)
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--data-root", type=Path, required=True)
    build_parser.add_argument("--database", type=Path, required=True)
    build_parser.add_argument("--report", type=Path, required=True)
    sub.add_parser("self-test")
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "self-test":
            result = self_test()
        elif args.command == "acquire":
            rows = []
            failures = []
            for index, quarter in enumerate(quarters(args.from_quarter, args.to_quarter)):
                try:
                    rows.append(acquire_one(args.data_root, quarter, args.user_agent, args.timeout, args.retries))
                except Exception as exc:  # keep the batch evidence explicit
                    failures.append({"quarter": quarter, "error": str(exc)})
                if index + 1 < len(quarters(args.from_quarter, args.to_quarter)) and args.sleep_ms:
                    time.sleep(args.sleep_ms / 1000)
            result = {
                "schema": "early-detection-sec-edgar-master-index-batch/v1",
                "completed": rows,
                "failed": failures,
                "status": "PASS" if not failures else "PARTIAL",
                "productiveGqsModified": False,
            }
        else:
            result = build(args.data_root, args.database, args.report)
        output = result
        if args.command == "build":
            output = {
                "status": result["status"],
                "payloads": result["payloads"],
                "quarters": result["quarters"],
                "rows": result["rows"],
                "distinctCiks": result["distinctCiks"],
                "form25FamilyRows": result["form25FamilyRows"],
                "form15FamilyRows": result["form15FamilyRows"],
                "blankCompanyNameRows": result["blankCompanyNameRows"],
                "logicalRowsSha256": result["logicalRowsSha256"],
                "reportSha256": result["reportSha256"],
                "report": str(args.report),
            }
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 0 if result.get("status") in {"PASS", "FILING_LOCATOR_PASS_NOT_LISTING_LEDGER"} else 2
    except Exception as exc:
        print(json.dumps({"status": "ERROR", "error": str(exc)}, ensure_ascii=False), file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
