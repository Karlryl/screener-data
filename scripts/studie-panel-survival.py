#!/usr/bin/env python3
"""D1: identity-free descriptive survival curve for accessible panel companies.

The script reads only the two explicitly preregistered pre-endtest SQLite files.
It never reads facts, signals, prices, outcomes, or company names. CIK is used as
the in-memory company key and is discarded before output construction.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREREG_REL = "protocol/early-detection/2.0.0/d1-panel-survival-preregistration.json"
PREREG = os.path.join(REPO, *PREREG_REL.split("/"))
ALLOWED_BASENAMES = ("panel-entdeckung.sqlite", "panel-validierung.sqlite")
PERIODIC_FORMS = ("10-K", "10-Q", "20-F", "40-F")
DOMESTIC_FORMS = ("10-K", "10-Q")
CUTOFF = date(2020, 12, 31)
QUARTERLY_DAYS = 91
ANNUAL_DAYS = 365
ACCEPTED_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")
PERIOD_RE = re.compile(r"^\d{8}$")


class SurvivalError(Exception):
    """Fail-closed contract violation."""


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def form_root(value: object) -> str:
    return str(value or "").split("/")[0].strip().upper()


def parse_accepted(value: object) -> date:
    raw = str(value or "").strip()
    if not ACCEPTED_RE.match(raw):
        raise SurvivalError("Unparseable accepted timestamp in an allowed panel")
    try:
        parsed = datetime.strptime(raw[:10], "%Y-%m-%d").date()
    except ValueError as error:
        raise SurvivalError("Invalid accepted date in an allowed panel") from error
    if parsed > CUTOFF:
        raise SurvivalError("Row after the preregistered 2020-12-31 cutoff")
    return parsed


def quarter_index(value: date) -> int:
    return value.year * 4 + (value.month - 1) // 3


def quarter_label(value: date) -> str:
    return "%04dQ%d" % (value.year, (value.month - 1) // 3 + 1)


def check_panel_path(path: str) -> str:
    absolute = os.path.abspath(path)
    if os.path.basename(absolute) not in ALLOWED_BASENAMES:
        raise SurvivalError("Panel basename is not preregistered: " + os.path.basename(absolute))
    if not os.path.isfile(absolute):
        raise SurvivalError("Allowed panel file is missing: " + absolute)
    return absolute


def open_read_only(path: str) -> sqlite3.Connection:
    checked = check_panel_path(path)
    uri = "file:" + checked.replace("\\", "/") + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.execute("PRAGMA query_only=ON")
    return connection


def read_panels(paths: list[str]) -> tuple[dict[str, dict[str, object]], dict[str, object]]:
    expected = set(ALLOWED_BASENAMES)
    actual = [os.path.basename(os.path.abspath(path)) for path in paths]
    if len(actual) != 2 or set(actual) != expected:
        raise SurvivalError("Exactly the two preregistered panel basenames are required")

    companies: dict[str, dict[str, object]] = defaultdict(
        lambda: {"periods": {}, "forms": set()})
    input_stats = []
    total_rows = periodic_rows = nonperiodic_rows = 0

    for path in paths:
        checked = check_panel_path(path)
        rows_here = 0
        connection = open_read_only(checked)
        try:
            for adsh, cik, form, period, accepted in connection.execute(
                    "SELECT adsh, cik, form, period, accepted FROM bericht"):
                rows_here += 1
                total_rows += 1
                root = form_root(form)
                if root not in PERIODIC_FORMS:
                    nonperiodic_rows += 1
                    continue
                periodic_rows += 1
                company = str(cik or "").strip()
                if not company:
                    raise SurvivalError("Periodic filing without CIK in an allowed panel")
                accepted_date = parse_accepted(accepted)
                period_raw = str(period or "").strip()
                period_key = period_raw if PERIOD_RE.match(period_raw) else "ADSH:" + str(adsh)
                previous = companies[company]["periods"].get(period_key)
                if previous is None or accepted_date < previous:
                    companies[company]["periods"][period_key] = accepted_date
                companies[company]["forms"].add(root)
        finally:
            connection.close()
        input_stats.append({
            "file": os.path.basename(checked),
            "bytes": os.path.getsize(checked),
            "rowsRead": rows_here,
        })

    return companies, {
        "files": sorted(input_stats, key=lambda row: row["file"]),
        "reportRowsRead": total_rows,
        "periodicRows": periodic_rows,
        "nonperiodicRowsExcluded": nonperiodic_rows,
    }


def company_records(companies: dict[str, dict[str, object]]) -> list[dict[str, object]]:
    records = []
    for state in companies.values():
        accepted_dates = sorted(set(state["periods"].values()))
        if not accepted_dates:
            continue
        forms = state["forms"]
        cadence_days = QUARTERLY_DAYS if forms.intersection(DOMESTIC_FORMS) else ANNUAL_DAYS
        first = accepted_dates[0]
        last = accepted_dates[-1]
        expected_next = last + timedelta(days=cadence_days)
        event = expected_next <= CUTOFF
        endpoint = expected_next if event else CUTOFF
        duration = quarter_index(endpoint) - quarter_index(first)
        if duration < 0:
            raise SurvivalError("Negative company duration")
        records.append({
            "duration": duration,
            "event": event,
            "exitQuarter": quarter_label(expected_next) if event else None,
            "cadence": "quarterly" if cadence_days == QUARTERLY_DAYS else "annual",
        })
    if not records:
        raise SurvivalError("No eligible panel companies")
    return records


def kaplan_meier(records: list[dict[str, object]]) -> tuple[list[dict[str, object]], int | None]:
    events = Counter(int(row["duration"]) for row in records if row["event"])
    censored = Counter(int(row["duration"]) for row in records if not row["event"])
    maximum = max(int(row["duration"]) for row in records)
    at_risk = len(records)
    survival = 1.0
    median = None
    curve = []
    cumulative_exits = 0
    for duration in range(maximum + 1):
        event_count = events[duration]
        censor_count = censored[duration]
        risk_before = at_risk
        if event_count > risk_before:
            raise SurvivalError("More events than companies at risk")
        if event_count:
            survival *= 1.0 - event_count / risk_before
            cumulative_exits += event_count
            if median is None and survival <= 0.5:
                median = duration
        curve.append({
            "quartersSinceEntry": duration,
            "atRisk": risk_before,
            "exits": event_count,
            "censored": censor_count,
            "survival": round(survival, 12),
            "cumulativeExits": cumulative_exits,
        })
        at_risk -= event_count + censor_count
        if at_risk < 0:
            raise SurvivalError("Negative at-risk set")
    if at_risk != 0:
        raise SurvivalError("At-risk set did not reconcile to zero")
    return curve, median


def build_result(paths: list[str]) -> dict[str, object]:
    companies, input_summary = read_panels(paths)
    records = company_records(companies)
    curve, median = kaplan_meier(records)
    exits_by_quarter = Counter(row["exitQuarter"] for row in records if row["event"])
    event_count = sum(1 for row in records if row["event"])
    censor_count = len(records) - event_count
    cadence_counts = Counter(str(row["cadence"]) for row in records)
    result = {
        "schema": "D1-panel-survival/1",
        "preregistration": {
            "path": PREREG_REL,
            "sha256": sha256_file(PREREG),
            "status": "FROZEN_BEFORE_PANEL_ACCESS",
        },
        "scope": {
            "lastAllowedDate": CUTOFF.isoformat(),
            "signalsUsed": 0,
            "companyIdentifiersWritten": 0,
            "dailyObservationsUsed": 0,
        },
        "inputs": input_summary,
        "counts": {
            "companies": len(records),
            "terminalExits": event_count,
            "rightCensored": censor_count,
            "quarterlyCadenceCompanies": cadence_counts["quarterly"],
            "annualCadenceCompanies": cadence_counts["annual"],
        },
        "effectiveN": {
            "companies": len(records),
            "independentUnit": "company",
            "filingsAreIndependentObservations": False,
            "dailyPoints": 0,
        },
        "nullModel": {
            "name": "no terminal attrition after panel entry",
            "threshold": "at least one terminal exit",
            "rejectedDescriptively": event_count > 0,
            "isSignificanceTest": False,
        },
        "medianStayQuarters": median,
        "survivalCurve": curve,
        "exitByQuarter": [
            {"quarter": quarter, "companies": exits_by_quarter[quarter]}
            for quarter in sorted(exits_by_quarter)
        ],
    }
    validate_result(result)
    return result


def validate_result(result: dict[str, object]) -> None:
    counts = result["counts"]
    companies = counts["companies"]
    if counts["terminalExits"] + counts["rightCensored"] != companies:
        raise SurvivalError("Events plus censoring do not equal effective N")
    if counts["quarterlyCadenceCompanies"] + counts["annualCadenceCompanies"] != companies:
        raise SurvivalError("Cadence groups do not equal effective N")
    if sum(row["companies"] for row in result["exitByQuarter"]) != counts["terminalExits"]:
        raise SurvivalError("Exit-quarter counts do not equal terminal exits")
    previous = 1.0
    for row in result["survivalCurve"]:
        probability = row["survival"]
        if not 0.0 <= probability <= previous <= 1.0:
            raise SurvivalError("Survival curve is not monotone within [0,1]")
        previous = probability
    def check_keys(value: object) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if str(key).lower() in {
                        "cik", "company", "companyname", "company_name",
                        "ticker", "adsh", "signal", "signalvalue"}:
                    raise SurvivalError("Identity or signal field leaked into aggregate output")
                check_keys(child)
        elif isinstance(value, list):
            for child in value:
                check_keys(child)

    check_keys(result)
    serialized = json.dumps(result, ensure_ascii=True, sort_keys=True).lower()
    for forbidden_year in ('"2021q', '"2022q', '"2023q', '"2024q'):
        if forbidden_year in serialized:
            raise SurvivalError("Post-cutoff quarter leaked into aggregate output")


def write_json(path: str, result: dict[str, object]) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def build_fixture(path: str, rows: list[tuple[object, ...]]) -> None:
    connection = sqlite3.connect(path)
    connection.execute(
        "CREATE TABLE bericht (adsh TEXT PRIMARY KEY, cik TEXT, form TEXT, "
        "period TEXT, accepted TEXT)")
    connection.executemany("INSERT INTO bericht VALUES (?,?,?,?,?)", rows)
    connection.commit()
    connection.close()


def self_test() -> int:
    failures = []

    def check(name: str, condition: bool, actual: object = None) -> None:
        if condition:
            print("  ok    " + name)
        else:
            failures.append(name)
            print("  ROT   " + name + " (ist: " + repr(actual) + ")")

    with tempfile.TemporaryDirectory(prefix="d1-survival-") as directory:
        discovery = os.path.join(directory, ALLOWED_BASENAMES[0])
        validation = os.path.join(directory, ALLOWED_BASENAMES[1])
        build_fixture(discovery, [
            ("a1", "100", "10-Q", "20190331", "2019-02-01 12:00:00.0"),
            ("a2", "100", "10-Q", "20190630", "2019-05-01 12:00:00.0"),
            ("a3", "100", "10-Q", "20190930", "2019-08-01 12:00:00.0"),
            ("a3a", "100", "10-Q/A", "20190930", "2019-08-15 12:00:00.0"),
            ("x1", "999", "8-K", "20190331", "2019-02-02 12:00:00.0"),
        ])
        build_fixture(validation, [
            ("b1", "200", "10-Q", "20200331", "2020-03-01 12:00:00.0"),
            ("b2", "200", "10-Q", "20200630", "2020-06-01 12:00:00.0"),
            ("b3", "200", "10-Q", "20200930", "2020-09-01 12:00:00.0"),
            ("b4", "200", "10-Q", "20201231", "2020-12-01 12:00:00.0"),
            ("c1", "300", "20-F", "20181231", "2019-04-01 12:00:00.0"),
            ("c2", "300", "20-F", "20191231", "2020-04-01 12:00:00.0"),
        ])

        result = build_result([discovery, validation])
        check("Fixture zaehlt genau drei periodische Firmen", result["counts"]["companies"] == 3,
              result["counts"])
        check("Nichtperiodische 8-K wird ausgeschlossen",
              result["inputs"]["nonperiodicRowsExcluded"] == 1,
              result["inputs"]["nonperiodicRowsExcluded"])
        check("Korrekturfassung verlaengert die Firma nicht",
              result["inputs"]["periodicRows"] == 10 and result["counts"]["terminalExits"] == 1,
              (result["inputs"]["periodicRows"], result["counts"]["terminalExits"]))
        check("Quartalsmelder ohne Folgebericht scheidet im erwarteten Quartal aus",
              result["exitByQuarter"] == [{"quarter": "2019Q4", "companies": 1}],
              result["exitByQuarter"])
        check("Firmen am Panelrand werden rechtszensiert",
              result["counts"]["rightCensored"] == 2, result["counts"]["rightCensored"])
        check("Reine 20-F-Firma erhaelt Jahreskadenz",
              result["counts"]["annualCadenceCompanies"] == 1,
              result["counts"]["annualCadenceCompanies"])
        q3 = result["survivalCurve"][3]
        check("Kaplan-Meier bei Quartal drei ist von Hand 2/3",
              q3["atRisk"] == 3 and q3["exits"] == 1 and q3["censored"] == 1
              and abs(q3["survival"] - 2 / 3) < 1e-11, q3)
        check("Median wird bei Survival 2/3 nicht erreicht",
              result["medianStayQuarters"] is None, result["medianStayQuarters"])
        check("Effektives N ist Firma, nie Bericht oder Tag",
              result["effectiveN"]["companies"] == 3
              and result["effectiveN"]["dailyPoints"] == 0
              and result["effectiveN"]["filingsAreIndependentObservations"] is False,
              result["effectiveN"])
        check("Nullmodell kippt bereits bei einem terminalen Ereignis",
              result["nullModel"]["rejectedDescriptively"] is True, result["nullModel"])
        check("Aggregat enthaelt keine Firmenidentitaet", result["scope"]["companyIdentifiersWritten"] == 0,
              result["scope"])

        forbidden = os.path.join(directory, "panel-endtest.sqlite.enc")
        try:
            check_panel_path(forbidden)
            blocked = False
        except SurvivalError:
            blocked = True
        check("Nicht vorregistriertes drittes Panel wird vor Oeffnung abgewiesen", blocked)

        late_discovery = os.path.join(directory, "late", ALLOWED_BASENAMES[0])
        late_validation = os.path.join(directory, "late", ALLOWED_BASENAMES[1])
        os.makedirs(os.path.dirname(late_discovery), exist_ok=True)
        build_fixture(late_discovery, [
            ("z1", "400", "10-Q", "20250331", "2025-05-01 12:00:00.0"),
        ])
        build_fixture(late_validation, [])
        try:
            build_result([late_discovery, late_validation])
            cutoff_blocked = False
        except SurvivalError as error:
            cutoff_blocked = "cutoff" in str(error)
        check("Eine Zeile nach dem 2020-Cutoff bricht fail-closed ab", cutoff_blocked)

    if failures:
        print("SELBSTTEST ROT - %d Pruefung(en) gescheitert" % len(failures))
        return 1
    print("SELBSTTEST GRUEN - 13 benannte Pruefungen")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="D1 descriptive panel survival")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--discovery")
    parser.add_argument("--validation")
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if not (args.discovery and args.validation and args.output):
        parser.error("--discovery, --validation and --output are required")
    result = build_result([args.discovery, args.validation])
    write_json(args.output, result)
    print(json.dumps({
        "companies": result["counts"]["companies"],
        "terminalExits": result["counts"]["terminalExits"],
        "rightCensored": result["counts"]["rightCensored"],
        "medianStayQuarters": result["medianStayQuarters"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SurvivalError as error:
        print("ABBRUCH: " + str(error), file=sys.stderr)
        sys.exit(1)
