#!/usr/bin/env python3
"""D2: aggregate association of D1 attrition with entry AFS and SIC division."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import sqlite3
import sys
import tempfile
from collections import defaultdict
from datetime import timedelta


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D1_SCRIPT = os.path.join(REPO, "scripts", "studie-panel-survival.py")
D1_ARTIFACT_REL = "reports/studie/D1-panel-survival-2026-08-23.json"
D1_ARTIFACT = os.path.join(REPO, *D1_ARTIFACT_REL.split("/"))
PREREG_REL = "protocol/early-detection/2.0.0/d2-attrition-size-sector-preregistration.json"
PREREG = os.path.join(REPO, *PREREG_REL.split("/"))
SIZE_THRESHOLD_PP = 5.0
SECTOR_THRESHOLD_V = 0.10
SECTOR_MIN_N = 200

AFS = {
    "1-LAF": ("Large Accelerated Filer", "larger"),
    "2-ACC": ("Accelerated Filer", "larger"),
    "3-SRA": ("Smaller Reporting Accelerated Filer", "smaller"),
    "4-NON": ("Non-Accelerated Filer", "smaller"),
    "5-SML": ("Smaller Reporting Filer", "smaller"),
}

SIC_DIVISIONS = (
    (100, 999, "Agriculture, Forestry and Fishing"),
    (1000, 1499, "Mining"),
    (1500, 1799, "Construction"),
    (2000, 3999, "Manufacturing"),
    (4000, 4999, "Transportation, Communications and Utilities"),
    (5000, 5199, "Wholesale Trade"),
    (5200, 5999, "Retail Trade"),
    (6000, 6799, "Finance, Insurance and Real Estate"),
    (7000, 8999, "Services"),
    (9100, 9729, "Public Administration"),
    (9900, 9999, "Nonclassifiable Establishments"),
)


class AssociationError(Exception):
    """Fail-closed contract violation."""


def load_d1():
    spec = importlib.util.spec_from_file_location("d1_panel_survival", D1_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


D1 = load_d1()


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sic_division(value: object) -> str | None:
    raw = str(value or "").strip()
    if not raw.isdigit():
        return None
    number = int(raw)
    for low, high, label in SIC_DIVISIONS:
        if low <= number <= high:
            return label
    return None


def read_panels(paths: list[str]):
    actual = [os.path.basename(os.path.abspath(path)) for path in paths]
    if len(actual) != 2 or set(actual) != set(D1.ALLOWED_BASENAMES):
        raise AssociationError("Exactly the two D1 panel basenames are required")
    companies = defaultdict(lambda: {"periods": {}, "forms": set()})
    input_rows = []
    for path in paths:
        checked = D1.check_panel_path(path)
        connection = D1.open_read_only(checked)
        rows_here = 0
        try:
            for adsh, cik, sic, afs, form, period, accepted in connection.execute(
                    "SELECT adsh, cik, sic, afs, form, period, accepted FROM bericht"):
                rows_here += 1
                root = D1.form_root(form)
                if root not in D1.PERIODIC_FORMS:
                    continue
                company = str(cik or "").strip()
                if not company:
                    raise AssociationError("Periodic filing without CIK")
                accepted_date = D1.parse_accepted(accepted)
                period_raw = str(period or "").strip()
                period_key = (period_raw if D1.PERIOD_RE.match(period_raw)
                              else "ADSH:" + str(adsh))
                candidate = {
                    "accepted": accepted_date,
                    "afs": str(afs or "").strip().upper(),
                    "sector": sic_division(sic),
                }
                previous = companies[company]["periods"].get(period_key)
                if previous is None or accepted_date < previous["accepted"]:
                    companies[company]["periods"][period_key] = candidate
                companies[company]["forms"].add(root)
        finally:
            connection.close()
        input_rows.append({"file": os.path.basename(checked), "rowsRead": rows_here})
    return companies, sorted(input_rows, key=lambda row: row["file"])


def company_rows(companies):
    rows = []
    for state in companies.values():
        periods = list(state["periods"].values())
        if not periods:
            continue
        entry = min(periods, key=lambda row: row["accepted"])
        accepted_dates = sorted(set(row["accepted"] for row in periods))
        cadence_days = (D1.QUARTERLY_DAYS if state["forms"].intersection(D1.DOMESTIC_FORMS)
                        else D1.ANNUAL_DAYS)
        expected_next = accepted_dates[-1] + timedelta(days=cadence_days)
        event = expected_next <= D1.CUTOFF
        afs_code = entry["afs"] if entry["afs"] in AFS else None
        rows.append({
            "event": event,
            "afs": afs_code,
            "sizeGroup": AFS[afs_code][1] if afs_code else "missing_or_unknown",
            "sector": entry["sector"] or "unclassified",
        })
    if not rows:
        raise AssociationError("No eligible companies")
    return rows


def grouped(rows, key):
    result = defaultdict(lambda: {"companies": 0, "terminalExits": 0, "rightCensored": 0})
    for row in rows:
        group = row[key]
        result[group]["companies"] += 1
        if row["event"]:
            result[group]["terminalExits"] += 1
        else:
            result[group]["rightCensored"] += 1
    for counts in result.values():
        counts["exitRate"] = counts["terminalExits"] / counts["companies"]
    return result


def cramers_v(group_counts) -> tuple[float, float]:
    usable = [counts for counts in group_counts.values() if counts["companies"] > 0]
    total = sum(counts["companies"] for counts in usable)
    total_events = sum(counts["terminalExits"] for counts in usable)
    if total == 0 or total_events in (0, total) or len(usable) < 2:
        return 0.0, 0.0
    total_censored = total - total_events
    chi_square = 0.0
    for counts in usable:
        group_total = counts["companies"]
        expected_events = group_total * total_events / total
        expected_censored = group_total * total_censored / total
        chi_square += (counts["terminalExits"] - expected_events) ** 2 / expected_events
        chi_square += (counts["rightCensored"] - expected_censored) ** 2 / expected_censored
    return chi_square, math.sqrt(chi_square / total)


def result_from_rows(rows, inputs, d1_anchor=None):
    total_events = sum(1 for row in rows if row["event"])
    total_censored = len(rows) - total_events
    if d1_anchor is not None:
        d1_counts = d1_anchor["counts"]
        actual = (len(rows), total_events, total_censored)
        expected = (d1_counts["companies"], d1_counts["terminalExits"],
                    d1_counts["rightCensored"])
        if actual != expected:
            raise AssociationError("D2 population/outcome does not match committed D1 totals")

    size_groups = grouped(rows, "sizeGroup")
    larger = size_groups.get("larger", {"companies": 0, "terminalExits": 0,
                                        "rightCensored": 0, "exitRate": None})
    smaller = size_groups.get("smaller", {"companies": 0, "terminalExits": 0,
                                           "rightCensored": 0, "exitRate": None})
    if not larger["companies"] or not smaller["companies"]:
        raise AssociationError("Both preregistered size groups are required")
    risk_difference_pp = 100.0 * (smaller["exitRate"] - larger["exitRate"])
    risk_ratio = (smaller["exitRate"] / larger["exitRate"]
                  if larger["exitRate"] > 0 else None)

    afs_counts = grouped(rows, "afs")
    sector_counts_all = grouped(rows, "sector")
    sector_counts = dict((key, value) for key, value in sector_counts_all.items()
                         if key != "unclassified")
    chi_square, sector_v = cramers_v(sector_counts)
    eligible_rates = [counts["exitRate"] for counts in sector_counts.values()
                      if counts["companies"] >= SECTOR_MIN_N]
    rate_range_pp = (100.0 * (max(eligible_rates) - min(eligible_rates))
                     if len(eligible_rates) >= 2 else None)

    result = {
        "schema": "D2-attrition-size-sector/1",
        "preregistration": {"path": PREREG_REL, "sha256": sha256_file(PREREG),
                            "status": "FROZEN_BEFORE_D2_PANEL_ACCESS"},
        "d1Anchor": ({"path": D1_ARTIFACT_REL, "sha256": sha256_file(D1_ARTIFACT)}
                     if d1_anchor is not None else None),
        "scope": {"lastAllowedDate": D1.CUTOFF.isoformat(), "signalsUsed": 0,
                  "companyIdentifiersWritten": 0, "dailyObservationsUsed": 0},
        "inputs": inputs,
        "counts": {"companies": len(rows), "terminalExits": total_events,
                   "rightCensored": total_censored},
        "effectiveN": {"companies": len(rows), "independentUnit": "company",
                       "filingsAreIndependentObservations": False, "dailyPoints": 0},
        "size": {
            "proxy": "SEC afs at entry",
            "groups": {"larger": larger, "smaller": smaller,
                       "missingOrUnknown": size_groups.get(
                           "missing_or_unknown", {"companies": 0, "terminalExits": 0,
                                                  "rightCensored": 0, "exitRate": None})},
            "afsCategories": [
                {"code": code, "label": AFS[code][0], **afs_counts.get(
                    code, {"companies": 0, "terminalExits": 0,
                           "rightCensored": 0, "exitRate": None})}
                for code in AFS
            ],
            "riskDifferencePercentagePointsSmallerMinusLarger": round(risk_difference_pp, 12),
            "riskRatioSmallerToLarger": round(risk_ratio, 12) if risk_ratio is not None else None,
            "nullModel": "equal terminal-exit risk",
            "absoluteRiskDifferenceThresholdPercentagePoints": SIZE_THRESHOLD_PP,
            "thresholdCrossed": abs(risk_difference_pp) >= SIZE_THRESHOLD_PP,
            "isSignificanceTest": False,
        },
        "sector": {
            "groups": [
                {"sector": sector, **counts}
                for sector, counts in sorted(sector_counts_all.items())
            ],
            "classifiedCompanies": sum(c["companies"] for c in sector_counts.values()),
            "unclassifiedCompanies": sector_counts_all.get(
                "unclassified", {"companies": 0})["companies"],
            "chiSquare": round(chi_square, 12),
            "cramersV": round(sector_v, 12),
            "cramersVThreshold": SECTOR_THRESHOLD_V,
            "thresholdCrossed": sector_v >= SECTOR_THRESHOLD_V,
            "minimumNForRateRange": SECTOR_MIN_N,
            "maxMinusMinExitRatePercentagePoints": (
                round(rate_range_pp, 12) if rate_range_pp is not None else None),
            "nullModel": "terminal attrition independent of entry SIC division",
            "isSignificanceTest": False,
        },
    }
    validate_result(result)
    return result


def validate_result(result):
    counts = result["counts"]
    if counts["terminalExits"] + counts["rightCensored"] != counts["companies"]:
        raise AssociationError("Outcome totals do not reconcile")
    size_total = sum(group["companies"] for group in result["size"]["groups"].values())
    if size_total != counts["companies"]:
        raise AssociationError("Size groups do not reconcile")
    sector_total = sum(group["companies"] for group in result["sector"]["groups"])
    if sector_total != counts["companies"]:
        raise AssociationError("Sector groups do not reconcile")
    for group in list(result["size"]["groups"].values()) + result["sector"]["groups"]:
        if group["terminalExits"] + group["rightCensored"] != group["companies"]:
            raise AssociationError("A group does not reconcile")

    def check_keys(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if str(key).lower() in {"cik", "ticker", "adsh", "companyname", "company_name"}:
                    raise AssociationError("Company identity leaked into output")
                check_keys(child)
        elif isinstance(value, list):
            for child in value:
                check_keys(child)
    check_keys(result)


def build_result(paths):
    with open(D1_ARTIFACT, encoding="utf-8") as handle:
        anchor = json.load(handle)
    companies, inputs = read_panels(paths)
    return result_from_rows(company_rows(companies), inputs, anchor)


def write_json(path, result):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def build_fixture(path, rows):
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE bericht (adsh TEXT PRIMARY KEY, cik TEXT, sic TEXT, "
                       "afs TEXT, form TEXT, period TEXT, accepted TEXT)")
    connection.executemany("INSERT INTO bericht VALUES (?,?,?,?,?,?,?)", rows)
    connection.commit()
    connection.close()


def self_test():
    failures = []

    def check(name, condition, actual=None):
        if condition:
            print("  ok    " + name)
        else:
            failures.append(name)
            print("  ROT   " + name + " (ist: " + repr(actual) + ")")

    with tempfile.TemporaryDirectory(prefix="d2-association-") as directory:
        discovery = os.path.join(directory, D1.ALLOWED_BASENAMES[0])
        validation = os.path.join(directory, D1.ALLOWED_BASENAMES[1])
        build_fixture(discovery, [
            ("l1", "100", "3674", "1-LAF", "10-Q", "20190331", "2019-02-01 12:00:00.0"),
            ("l1b", "100", "3674", "5-SML", "10-Q", "20190630", "2019-05-01 12:00:00.0"),
            ("s1", "200", "7372", "3-SRA", "10-Q", "20190331", "2019-02-02 12:00:00.0"),
            ("s2", "300", "7372", "4-NON", "10-Q", "20190331", "2019-02-03 12:00:00.0"),
            ("s3", "400", "7372", "5-SML", "10-Q", "20190331", "2019-02-04 12:00:00.0"),
        ])
        build_fixture(validation, [
            ("l2", "500", "3674", "1-LAF", "10-Q", "20201231", "2020-12-01 12:00:00.0"),
            ("l3", "600", "1311", "2-ACC", "10-Q", "20201231", "2020-12-02 12:00:00.0"),
            ("m1", "700", "", "", "20-F", "20191231", "2020-04-01 12:00:00.0"),
        ])
        companies, inputs = read_panels([discovery, validation])
        rows = company_rows(companies)
        result = result_from_rows(rows, inputs)

        check("Fixture bleibt bei sieben Firmen nach Zusammenfuehrung", result["counts"]["companies"] == 7,
              result["counts"])
        check("AFS wird am Einstieg fixiert und folgt keinem spaeteren Status",
              result["size"]["groups"]["larger"]["companies"] == 3,
              result["size"]["groups"])
        check("Die drei kleineren AFS-Klassen landen gemeinsam in smaller",
              result["size"]["groups"]["smaller"]["companies"] == 3,
              result["size"]["groups"])
        check("Fehlender AFS bleibt sichtbar und aus dem Kontrast draussen",
              result["size"]["groups"]["missingOrUnknown"]["companies"] == 1,
              result["size"]["groups"])
        check("Groessere Gruppe hat von Hand 1/3 terminale Ausstiege",
              abs(result["size"]["groups"]["larger"]["exitRate"] - 1 / 3) < 1e-12,
              result["size"]["groups"]["larger"])
        check("Kleinere Gruppe hat von Hand 3/3 terminale Ausstiege",
              result["size"]["groups"]["smaller"]["exitRate"] == 1.0,
              result["size"]["groups"]["smaller"])
        check("Risikodifferenz smaller minus larger ist von Hand 66,67 Punkte",
              abs(result["size"]["riskDifferencePercentagePointsSmallerMinusLarger"]
                  - 66.666666666667) < 1e-9,
              result["size"]["riskDifferencePercentagePointsSmallerMinusLarger"])
        check("Vorregistrierte Fuenf-Punkte-Schwelle greift in der Fixture",
              result["size"]["thresholdCrossed"] is True, result["size"])
        services = next(row for row in result["sector"]["groups"] if row["sector"] == "Services")
        check("Sektorzaehler Services ist von Hand 3/3 Ausstiege",
              services["companies"] == 3 and services["terminalExits"] == 3, services)
        check("Cramers V ist als 2xK-Effekt berechenbar und positiv",
              result["sector"]["cramersV"] > 0, result["sector"]["cramersV"])
        check("Unklassifizierter SIC bleibt als eigene Luecke sichtbar",
              result["sector"]["unclassifiedCompanies"] == 1,
              result["sector"]["unclassifiedCompanies"])
        check("Effektives N ist Firma, nie Bericht oder Tag",
              result["effectiveN"]["companies"] == 7
              and result["effectiveN"]["dailyPoints"] == 0
              and result["effectiveN"]["filingsAreIndependentObservations"] is False,
              result["effectiveN"])
        check("Aggregat schreibt keine Firmenidentitaet",
              result["scope"]["companyIdentifiersWritten"] == 0, result["scope"])

    if failures:
        print("SELBSTTEST ROT - %d Pruefung(en) gescheitert" % len(failures))
        return 1
    print("SELBSTTEST GRUEN - 13 benannte Pruefungen")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="D2 attrition by size proxy and sector")
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
        "sizeRiskDifferencePP": result["size"]["riskDifferencePercentagePointsSmallerMinusLarger"],
        "sectorCramersV": result["sector"]["cramersV"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (AssociationError, D1.SurvivalError) as error:
        print("ABBRUCH: " + str(error), file=sys.stderr)
        sys.exit(1)
