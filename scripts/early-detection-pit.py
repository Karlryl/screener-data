#!/usr/bin/env python3
"""Build and verify the point-in-time SEC foundation used by FEM research.

The database is a derived, append-only index of byte-identical SEC Financial
Statement Data Set payloads.  It preserves source revisions separately and
never promotes a period end or a download time to a filing availability time.
"""

from __future__ import annotations

import argparse
import codecs
import csv
import hashlib
import io
import json
import sqlite3
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator


SCHEMA = "early-detection-pit-sqlite/v1"
OBSERVATION_SCHEMA = "early-detection-source-observation/v1"
TIME_POLICY = "SEC_EASTERN_US_DST_2007PLUS_V1"
REQUIRED_MEMBERS = ("sub.txt", "num.txt", "pre.txt", "tag.txt")
CSV_FIELD_LIMIT = 64 * 1024 * 1024
csv.field_size_limit(CSV_FIELD_LIMIT)


class PitError(RuntimeError):
    """A fail-closed PIT contract was violated."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def first_sunday(year: int, month: int) -> datetime:
    first = datetime(year, month, 1, 2, 0, 0)
    return first + timedelta(days=(6 - first.weekday()) % 7)


def sec_eastern_to_utc(raw: str) -> str:
    """Qualify SEC wall time using the US Eastern rules in force since 2007.

    EDGAR operates in Eastern Time.  The study starts in 2009, so the Energy
    Policy Act rule is sufficient: DST starts on March's second Sunday at 02:00
    and ends on November's first Sunday at 02:00.  EDGAR's filing window starts
    after the ambiguous fall-back hour.
    """
    value = str(raw or "").strip()
    parsed = None
    try:
        iso_candidate = datetime.fromisoformat(value)
        if iso_candidate.tzinfo is None:
            parsed = iso_candidate
    except ValueError:
        pass
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y%m%d%H%M%S"):
        if parsed is not None:
            break
        try:
            parsed = datetime.strptime(value, pattern)
            break
        except ValueError:
            pass
    if parsed is None or parsed.year < 2009:
        raise PitError(f"invalid or out-of-contract SEC accepted timestamp: {raw!r}")
    dst_start = first_sunday(parsed.year, 3) + timedelta(days=7)
    dst_end = first_sunday(parsed.year, 11)
    offset = -4 if dst_start <= parsed < dst_end else -5
    aware = parsed.replace(tzinfo=timezone(timedelta(hours=offset)))
    return aware.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_date(raw: Any, field: str) -> str | None:
    value = str(raw or "").strip().replace("-", "")
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y%m%d").date().isoformat()
    except ValueError as exc:
        raise PitError(f"invalid {field}: {raw!r}") from exc


def integer(raw: Any, field: str, nullable: bool = True) -> int | None:
    value = str(raw or "").strip()
    if not value and nullable:
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise PitError(f"invalid integer {field}: {raw!r}") from exc


def boolean_int(raw: Any, field: str) -> int:
    value = str(raw or "").strip()
    if value not in {"0", "1"}:
        raise PitError(f"invalid Boolean {field}: {raw!r}")
    return int(value)


def clean_row(row: dict[str, Any]) -> dict[str, str]:
    return {
        str(key or "").lstrip("\ufeff").strip().lower(): str(value or "").strip()
        for key, value in row.items()
    }


def archive_members(archive: zipfile.ZipFile) -> dict[str, str]:
    members = {Path(name).name.lower(): name for name in archive.namelist()}
    missing = [name for name in REQUIRED_MEMBERS if name not in members]
    if missing:
        raise PitError(f"FSD archive lacks required members: {', '.join(missing)}")
    return members


def tsv_rows(archive: zipfile.ZipFile, member: str) -> Iterator[dict[str, str]]:
    decoder = codecs.getincrementaldecoder("utf-8-sig")("strict")
    encoding = "utf-8-sig"
    try:
        with archive.open(member, "r") as probe:
            for chunk in iter(lambda: probe.read(1024 * 1024), b""):
                decoder.decode(chunk, final=False)
            decoder.decode(b"", final=True)
    except UnicodeDecodeError:
        encoding = "cp1252"
    with archive.open(member, "r") as binary:
        with io.TextIOWrapper(binary, encoding=encoding, newline="") as text:
            reader = csv.DictReader(text, delimiter="\t")
            if not reader.fieldnames:
                raise PitError(f"empty FSD table: {member}")
            for row in reader:
                yield clean_row(row)


def require(row: dict[str, str], fields: Iterable[str], table: str) -> None:
    absent = [field for field in fields if field not in row]
    if absent:
        raise PitError(f"{table} schema lacks: {', '.join(absent)}")


def connect(database: Path) -> sqlite3.Connection:
    database = database.expanduser().resolve()
    if database == Path(database.anchor):
        raise PitError("database path cannot be a filesystem root")
    database.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database)
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS source_payloads (
          payload_sha256 TEXT PRIMARY KEY,
          quarter TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          source_url TEXT NOT NULL,
          payload_path TEXT NOT NULL,
          payload_bytes INTEGER NOT NULL,
          observation_sha256 TEXT NOT NULL,
          imported_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS submissions (
          payload_sha256 TEXT NOT NULL,
          adsh TEXT NOT NULL,
          cik TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          name TEXT NOT NULL,
          sic INTEGER,
          countryba TEXT,
          form TEXT NOT NULL,
          period_end TEXT,
          fy INTEGER,
          fp TEXT,
          filed_date TEXT NOT NULL,
          accepted_raw TEXT NOT NULL,
          accepted_at TEXT NOT NULL,
          accepted_timezone_policy TEXT NOT NULL,
          prevrpt INTEGER NOT NULL,
          detail INTEGER NOT NULL,
          instance TEXT,
          row_sha256 TEXT NOT NULL,
          PRIMARY KEY (payload_sha256, adsh),
          FOREIGN KEY (payload_sha256) REFERENCES source_payloads(payload_sha256)
        );
        CREATE TABLE IF NOT EXISTS facts (
          payload_sha256 TEXT NOT NULL,
          row_number INTEGER NOT NULL,
          adsh TEXT NOT NULL,
          tag TEXT NOT NULL,
          version TEXT NOT NULL,
          ddate TEXT NOT NULL,
          qtrs INTEGER NOT NULL,
          uom TEXT NOT NULL,
          coreg TEXT NOT NULL,
          value_text TEXT,
          footnote TEXT,
          accepted_at TEXT NOT NULL,
          row_sha256 TEXT NOT NULL,
          PRIMARY KEY (payload_sha256, row_number),
          FOREIGN KEY (payload_sha256, adsh) REFERENCES submissions(payload_sha256, adsh)
        );
        CREATE TABLE IF NOT EXISTS presentations (
          payload_sha256 TEXT NOT NULL,
          row_number INTEGER NOT NULL,
          adsh TEXT NOT NULL,
          report INTEGER NOT NULL,
          line INTEGER NOT NULL,
          stmt TEXT,
          inpth INTEGER NOT NULL,
          rfile TEXT,
          tag TEXT NOT NULL,
          version TEXT NOT NULL,
          plabel TEXT,
          negating INTEGER NOT NULL,
          row_sha256 TEXT NOT NULL,
          PRIMARY KEY (payload_sha256, row_number),
          FOREIGN KEY (payload_sha256, adsh) REFERENCES submissions(payload_sha256, adsh)
        );
        CREATE TABLE IF NOT EXISTS tags (
          payload_sha256 TEXT NOT NULL,
          row_number INTEGER NOT NULL,
          tag TEXT NOT NULL,
          version TEXT NOT NULL,
          custom INTEGER NOT NULL,
          abstract INTEGER NOT NULL,
          datatype TEXT,
          iord TEXT,
          crdr TEXT,
          tlabel TEXT,
          doc TEXT,
          row_sha256 TEXT NOT NULL,
          PRIMARY KEY (payload_sha256, row_number),
          FOREIGN KEY (payload_sha256) REFERENCES source_payloads(payload_sha256)
        );
        CREATE INDEX IF NOT EXISTS submissions_asof
          ON submissions(accepted_at, cik, form, period_end);
        CREATE INDEX IF NOT EXISTS facts_accession
          ON facts(payload_sha256, adsh, tag, version, ddate, qtrs, uom, coreg);
        CREATE INDEX IF NOT EXISTS presentations_accession
          ON presentations(payload_sha256, adsh, stmt, report, line);
        """
    )
    current = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
    if current and current[0] != SCHEMA:
        raise PitError(f"database has incompatible schema {current[0]}")
    connection.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('schema',?)", (SCHEMA,))
    connection.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('time_policy',?)", (TIME_POLICY,))
    connection.commit()
    return connection


def accepted_observations(data_root: Path) -> Iterator[tuple[Path, dict[str, Any]]]:
    root = data_root.expanduser().resolve()
    marker = root / "STORE.json"
    if not marker.exists():
        raise PitError("raw store marker is missing")
    identity = json.loads(marker.read_text(encoding="utf-8"))
    if identity.get("schema") != "early-detection-raw-store/v1":
        raise PitError("raw store marker has an incompatible schema")
    for path in sorted((root / "observations" / "sec-fsd").rglob("*.json")):
        observation = json.loads(path.read_text(encoding="utf-8"))
        if observation.get("schema") != OBSERVATION_SCHEMA:
            raise PitError(f"invalid observation schema: {path}")
        if observation.get("sourceClass") != "sec_financial_statement_dataset":
            continue
        if observation.get("qualityState") != "accepted":
            continue
        observed_at = str(observation.get("observedAt", ""))
        try:
            parsed_observed_at = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise PitError(f"observation has invalid observedAt: {path}") from exc
        if parsed_observed_at.tzinfo is None:
            raise PitError(f"observation observedAt is not timezone-qualified: {path}")
        relative = Path(str(observation.get("payloadPath", "")))
        if relative.is_absolute() or ".." in relative.parts:
            raise PitError(f"unsafe payload path: {path}")
        payload_path = root / relative
        if not payload_path.exists() or sha256_file(payload_path) != observation.get("payloadSha256"):
            raise PitError(f"observation payload mismatch: {path}")
        if payload_path.stat().st_size != observation.get("payloadBytes"):
            raise PitError(f"observation payload size mismatch: {path}")
        yield path, observation


def row_digest(row: dict[str, str]) -> str:
    return sha256_bytes(canonical_bytes(row))


def import_payload(connection: sqlite3.Connection, data_root: Path, obs_path: Path, obs: dict[str, Any]) -> dict[str, int]:
    digest = str(obs["payloadSha256"])
    if connection.execute("SELECT 1 FROM source_payloads WHERE payload_sha256=?", (digest,)).fetchone():
        return {"payloadsReused": 1, "submissions": 0, "facts": 0, "presentations": 0, "tags": 0}
    payload_path = data_root.resolve() / str(obs["payloadPath"])
    counts = {"payloadsImported": 1, "submissions": 0, "facts": 0, "presentations": 0, "tags": 0}
    with zipfile.ZipFile(payload_path) as archive:
        members = archive_members(archive)
        with connection:
            connection.execute(
                "INSERT INTO source_payloads VALUES(?,?,?,?,?,?,?,?)",
                (
                    digest, str(obs["quarter"]), str(obs["observedAt"]), str(obs["sourceUrl"]),
                    str(obs["payloadPath"]), int(obs["payloadBytes"]), sha256_file(obs_path), utc_now(),
                ),
            )
            acceptance: dict[str, str] = {}
            for row in tsv_rows(archive, members["sub.txt"]):
                require(row, ("adsh", "cik", "name", "form", "filed", "accepted", "prevrpt", "detail"), "sub")
                adsh = row["adsh"]
                cik = str(integer(row["cik"], "sub.cik", nullable=False)).zfill(10)
                accepted_at = sec_eastern_to_utc(row["accepted"])
                acceptance[adsh] = accepted_at
                connection.execute(
                    """INSERT INTO submissions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        digest, adsh, cik, f"SEC-CIK:{cik}", row["name"], integer(row.get("sic"), "sub.sic"),
                        row.get("countryba") or None, row["form"], parse_date(row.get("period"), "sub.period"),
                        integer(row.get("fy"), "sub.fy"), row.get("fp") or None,
                        parse_date(row["filed"], "sub.filed"), row["accepted"], accepted_at, TIME_POLICY,
                        boolean_int(row["prevrpt"], "sub.prevrpt"), boolean_int(row["detail"], "sub.detail"),
                        row.get("instance") or None, row_digest(row),
                    ),
                )
                counts["submissions"] += 1
            for number, row in enumerate(tsv_rows(archive, members["num.txt"]), start=1):
                require(row, ("adsh", "tag", "version", "ddate", "qtrs", "uom"), "num")
                if row["adsh"] not in acceptance:
                    raise PitError(f"num references missing submission {row['adsh']}")
                connection.execute(
                    "INSERT INTO facts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        digest, number, row["adsh"], row["tag"], row["version"],
                        parse_date(row["ddate"], "num.ddate"), integer(row["qtrs"], "num.qtrs", False),
                        row["uom"], row.get("coreg", ""), row.get("value") or None,
                        row.get("footnote") or None, acceptance[row["adsh"]], row_digest(row),
                    ),
                )
                counts["facts"] += 1
            for number, row in enumerate(tsv_rows(archive, members["pre.txt"]), start=1):
                require(row, ("adsh", "report", "line", "inpth", "tag", "version", "negating"), "pre")
                if row["adsh"] not in acceptance:
                    raise PitError(f"pre references missing submission {row['adsh']}")
                connection.execute(
                    "INSERT INTO presentations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        digest, number, row["adsh"], integer(row["report"], "pre.report", False),
                        integer(row["line"], "pre.line", False), row.get("stmt") or None,
                        integer(row["inpth"], "pre.inpth", False), row.get("rfile") or None,
                        row["tag"], row["version"], row.get("plabel") or None,
                        boolean_int(row["negating"], "pre.negating"), row_digest(row),
                    ),
                )
                counts["presentations"] += 1
            for number, row in enumerate(tsv_rows(archive, members["tag.txt"]), start=1):
                require(row, ("tag", "version", "custom", "abstract"), "tag")
                connection.execute(
                    "INSERT INTO tags VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        digest, number, row["tag"], row["version"],
                        boolean_int(row["custom"], "tag.custom"), boolean_int(row["abstract"], "tag.abstract"),
                        row.get("datatype") or None, row.get("iord") or None, row.get("crdr") or None,
                        row.get("tlabel") or None, row.get("doc") or None, row_digest(row),
                    ),
                )
                counts["tags"] += 1
    return counts


def import_store(data_root: Path, database: Path, full_verification: bool = False) -> dict[str, Any]:
    connection = connect(database)
    totals: dict[str, int] = {}
    try:
        for path, observation in accepted_observations(data_root):
            result = import_payload(connection, data_root.expanduser().resolve(), path, observation)
            for key, value in result.items():
                totals[key] = totals.get(key, 0) + value
        verified = verify_database(connection) if full_verification else status_database(connection)
    finally:
        connection.close()
    return {
        "schema": "early-detection-pit-import-result/v1",
        "status": verified["status"],
        "dataRoot": str(data_root.expanduser().resolve()),
        "database": str(database.expanduser().resolve()),
        "import": totals,
        "verification": verified,
    }


def table_count(connection: sqlite3.Connection, table: str) -> int:
    return int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])


def asof_submission_count(connection: sqlite3.Connection, cutoff: str) -> int:
    parsed = datetime.fromisoformat(cutoff.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise PitError("as-of cutoff must be timezone-qualified")
    normalized = parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return int(connection.execute("SELECT COUNT(*) FROM submissions WHERE accepted_at<=?", (normalized,)).fetchone()[0])


def status_database(connection: sqlite3.Connection) -> dict[str, Any]:
    issues: list[str] = []
    schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
    policy = connection.execute("SELECT value FROM meta WHERE key='time_policy'").fetchone()
    if not schema or schema[0] != SCHEMA:
        issues.append("schema")
    if not policy or policy[0] != TIME_POLICY:
        issues.append("time_policy")
    rows = connection.execute(
        """SELECT quarter, COUNT(*), MIN(observed_at), MAX(observed_at)
           FROM source_payloads GROUP BY quarter ORDER BY quarter"""
    ).fetchall()
    payloads = sum(int(row[1]) for row in rows)
    return {
        "schema": "early-detection-pit-status/v1",
        "status": "PASS" if not issues else "FAIL",
        "checkedAt": utc_now(),
        "sourcePayloads": payloads,
        "quarters": [
            {
                "quarter": row[0],
                "payloads": int(row[1]),
                "firstObservedAt": row[2],
                "lastObservedAt": row[3],
            }
            for row in rows
        ],
        "readiness": "RECOVERY_OPEN_PASS_NOT_FULL_INTEGRITY_AUDIT" if payloads else "NOT_READY_EMPTY",
        "issues": issues,
        "timePolicy": TIME_POLICY,
    }


def verify_database(connection: sqlite3.Connection) -> dict[str, Any]:
    issues: list[str] = []
    integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        issues.append(f"sqlite_integrity:{integrity}")
    foreign = connection.execute("PRAGMA foreign_key_check").fetchall()
    if foreign:
        issues.append(f"foreign_keys:{len(foreign)}")
    schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
    if not schema or schema[0] != SCHEMA:
        issues.append("schema")
    future_join = connection.execute(
        """SELECT COUNT(*) FROM facts f JOIN submissions s
           ON s.payload_sha256=f.payload_sha256 AND s.adsh=f.adsh
           WHERE f.accepted_at<>s.accepted_at"""
    ).fetchone()[0]
    if future_join:
        issues.append(f"fact_acceptance_mismatch:{future_join}")
    counts = {table: table_count(connection, table) for table in (
        "source_payloads", "submissions", "facts", "presentations", "tags"
    )}
    return {
        "schema": "early-detection-pit-verification/v1",
        "status": "PASS" if not issues else "FAIL",
        "verifiedAt": utc_now(),
        "counts": counts,
        "readiness": "STRUCTURAL_PASS" if counts["source_payloads"] else "NOT_READY_EMPTY",
        "issues": issues,
        "timePolicy": TIME_POLICY,
    }


def verify_file(database: Path) -> dict[str, Any]:
    if not database.exists():
        raise PitError("PIT database does not exist")
    connection = connect(database)
    try:
        return verify_database(connection)
    finally:
        connection.close()


def status_file(database: Path) -> dict[str, Any]:
    if not database.exists():
        raise PitError("PIT database does not exist")
    connection = connect(database)
    try:
        return status_database(connection)
    finally:
        connection.close()


def synthetic_fsd() -> bytes:
    tables = {
        "sub.txt": (
            "adsh\tcik\tname\tsic\tcountryba\tform\tperiod\tfy\tfp\tfiled\taccepted\tprevrpt\tdetail\tinstance\n"
            "0000000001-20-000001\t1\tALPHA INC\t3571\tUS\t10-Q\t20191231\t2019\tQ4\t20200115\t2020-01-15 16:00:00\t0\t1\ta.xml\n"
            "0000000002-20-000001\t2\tBETA INC\t3571\tUS\t10-Q\t20191231\t2019\tQ4\t20200215\t2020-02-15 16:00:00\t0\t1\tb.xml\n"
        ),
        "num.txt": (
            "adsh\ttag\tversion\tddate\tqtrs\tuom\tcoreg\tvalue\tfootnote\n"
            "0000000001-20-000001\tRevenues\tus-gaap/2019\t20191231\t1\tUSD\t\t100\t\n"
            "0000000002-20-000001\tRevenues\tus-gaap/2019\t20191231\t1\tUSD\t\t200\t\n"
        ),
        "pre.txt": (
            "adsh\treport\tline\tstmt\tinpth\trfile\ttag\tversion\tplabel\tnegating\n"
            "0000000001-20-000001\t1\t1\tIS\t0\tH\tRevenues\tus-gaap/2019\tRevenue\t0\n"
            "0000000002-20-000001\t1\t1\tIS\t0\tH\tRevenues\tus-gaap/2019\tRevenue\t0\n"
        ),
        "tag.txt": (
            "tag\tversion\tcustom\tabstract\tdatatype\tiord\tcrdr\ttlabel\tdoc\n"
            "Revenues\tus-gaap/2019\t0\t0\tmonetary\tD\tC\tRevenue\tRevenue from customers\n"
        ),
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in tables.items():
            if name == "pre.txt":
                content = content.replace("Revenue\t0", "Revenue \u00a2\t0").encode("cp1252")
            archive.writestr(name, content)
    return buffer.getvalue()


def self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="early-detection-pit-") as temporary:
        root = Path(temporary) / "store"
        database = Path(temporary) / "pit.sqlite"
        payload = synthetic_fsd()
        digest = sha256_bytes(payload)
        relative = Path("blobs") / "sha256" / digest[:2] / f"{digest}.zip"
        (root / relative).parent.mkdir(parents=True)
        (root / relative).write_bytes(payload)
        (root / "STORE.json").write_text(
            json.dumps({"schema": "early-detection-raw-store/v1"}) + "\n",
            encoding="utf-8",
        )
        observation = {
            "schema": OBSERVATION_SCHEMA,
            "sourceClass": "sec_financial_statement_dataset",
            "sourceUrl": "https://www.sec.gov/example.zip",
            "quarter": "2020q1",
            "observedAt": "2026-01-01T00:00:00.000Z",
            "payloadSha256": digest,
            "payloadBytes": len(payload),
            "payloadPath": relative.as_posix(),
            "qualityState": "accepted",
        }
        obs_path = root / "observations" / "sec-fsd" / "2020q1" / "test.json"
        obs_path.parent.mkdir(parents=True)
        obs_path.write_bytes(canonical_bytes(observation) + b"\n")
        first = import_store(root, database, full_verification=True)
        second = import_store(root, database, full_verification=True)
        connection = connect(database)
        try:
            before = asof_submission_count(connection, "2020-02-01T00:00:00.000Z")
            after = asof_submission_count(connection, "2020-03-01T00:00:00.000Z")
        finally:
            connection.close()
        if first["status"] != "PASS" or first["verification"]["counts"]["submissions"] != 2:
            raise PitError("self-test initial import failed")
        if second["import"].get("payloadsReused") != 1:
            raise PitError("self-test idempotent import failed")
        if before != 1 or after != 2:
            raise PitError("self-test as-of leakage exclusion failed")
        if sec_eastern_to_utc("2009-05-29 15:59:00.0") != "2009-05-29T19:59:00.000Z":
            raise PitError("fractional legacy SEC acceptance time failed")
        return {
            "schema": "early-detection-pit-self-test/v1",
            "status": "PASS",
            "submissions": 2,
            "facts": 2,
            "futureFilingExcludedBeforeCutoff": True,
            "idempotentPayloadReuse": True,
            "timePolicy": TIME_POLICY,
            "legacyFractionalAcceptanceSupported": True,
            "csvFieldLimit": CSV_FIELD_LIMIT,
            "legacyCp1252Supported": True,
        }


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    ingest = commands.add_parser("import-fsd-store")
    ingest.add_argument("--data-root", type=Path, required=True)
    ingest.add_argument("--database", type=Path, required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("--database", type=Path, required=True)
    status = commands.add_parser("status")
    status.add_argument("--database", type=Path, required=True)
    commands.add_parser("self-test")
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "import-fsd-store":
            result = import_store(args.data_root, args.database)
        elif args.command == "verify":
            result = verify_file(args.database)
        elif args.command == "status":
            result = status_file(args.database)
        else:
            result = self_test()
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0 if result["status"] == "PASS" else 1
    except (
        PitError, OSError, UnicodeError, csv.Error, json.JSONDecodeError,
        sqlite3.Error, zipfile.BadZipFile,
    ) as exc:
        print(f"[early-detection-pit] {exc}", file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
