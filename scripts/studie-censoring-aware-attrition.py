#!/usr/bin/env python3
"""D4: censoring-aware sensitivity analysis for D2 size and sector attrition."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
from collections import Counter
from datetime import timedelta


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREREG_REL = (
    "protocol/early-detection/2.0.0/"
    "d4-censoring-aware-attrition-preregistration.json"
)
PREREG = os.path.join(REPO, *PREREG_REL.split("/"))
D1_SCRIPT_REL = "scripts/studie-panel-survival.py"
D2_SCRIPT_REL = "scripts/studie-attrition-size-sector.py"
D1_ARTIFACT_REL = "reports/studie/D1-panel-survival-2026-08-23.json"
D2_ARTIFACT_REL = "reports/studie/D2-attrition-size-sector-2026-08-23.json"
HORIZON_QUARTERS = 12
SIZE_THRESHOLD_PP = 5.0
SECTOR_THRESHOLD_PP = 10.0
SECTOR_MIN_N = 200

BOUND_INPUTS = {
    D1_SCRIPT_REL: "d1a6fae94a46588f5f1783a288ad5055737648de1fb480f673b985c75dbf4c54",
    D2_SCRIPT_REL: "a3f8e7806168b1b3b6dfda4e6e646dfe67cb7f42ddf35ff65a0a6a2ac58658b2",
    D1_ARTIFACT_REL: "81e9f312df2faac322fc64647ed33cf6862d8ce15120c80ce665e5fde14c8724",
    D2_ARTIFACT_REL: "c4d0c1f30b850920b48163f790f2a8704f892702d0686b583e4e315705a98d63",
}


class SensitivityError(Exception):
    """Fail-closed D4 contract violation."""


def repo_path(relative: str) -> str:
    return os.path.join(REPO, *relative.split("/"))


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_module(name: str, relative: str):
    spec = importlib.util.spec_from_file_location(name, repo_path(relative))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


D2 = load_module("d2_attrition_size_sector", D2_SCRIPT_REL)
D1 = D2.D1


def verify_bound_inputs() -> None:
    with open(PREREG, encoding="utf-8") as handle:
        prereg = json.load(handle)
    if prereg.get("status") != "FROZEN_BEFORE_D4_PANEL_ACCESS":
        raise SensitivityError("D4 preregistration is not frozen")
    if prereg.get("boundInputs") != BOUND_INPUTS:
        raise SensitivityError("D4 preregistration bound-input map changed")
    for relative, expected in BOUND_INPUTS.items():
        actual = sha256_file(repo_path(relative))
        if actual != expected:
            raise SensitivityError("Bound D4 input changed: " + relative)


def company_records(companies):
    records = []
    for state in companies.values():
        periods = list(state["periods"].values())
        if not periods:
            continue
        entry = min(periods, key=lambda row: row["accepted"])
        accepted_dates = sorted(set(row["accepted"] for row in periods))
        cadence_days = (
            D1.QUARTERLY_DAYS
            if state["forms"].intersection(D1.DOMESTIC_FORMS)
            else D1.ANNUAL_DAYS
        )
        expected_next = accepted_dates[-1] + timedelta(days=cadence_days)
        event = expected_next <= D1.CUTOFF
        endpoint = expected_next if event else D1.CUTOFF
        duration = D1.quarter_index(endpoint) - D1.quarter_index(accepted_dates[0])
        if duration < 0:
            raise SensitivityError("Negative company duration")
        afs_code = entry["afs"] if entry["afs"] in D2.AFS else None
        records.append({
            "duration": duration,
            "event": event,
            "cadence": "quarterly" if cadence_days == D1.QUARTERLY_DAYS else "annual",
            "sizeGroup": D2.AFS[afs_code][1] if afs_code else "missing_or_unknown",
            "sector": entry["sector"] or "unclassified",
        })
    if not records:
        raise SensitivityError("No eligible companies")
    return records


def km_summary(records):
    if not records:
        return {
            "companies": 0,
            "terminalExits": 0,
            "rightCensored": 0,
            "medianStayQuarters": None,
            "horizonEstimable": False,
            "atRiskAtHorizon": 0,
            "survivalAtHorizon": None,
            "survivalCurve": [],
        }
    curve, median = D1.kaplan_meier(records)
    horizon_row = next(
        (row for row in curve if row["quartersSinceEntry"] == HORIZON_QUARTERS),
        None,
    )
    events = sum(1 for row in records if row["event"])
    return {
        "companies": len(records),
        "terminalExits": events,
        "rightCensored": len(records) - events,
        "medianStayQuarters": median,
        "horizonEstimable": horizon_row is not None and horizon_row["atRisk"] > 0,
        "atRiskAtHorizon": horizon_row["atRisk"] if horizon_row is not None else 0,
        "survivalAtHorizon": (
            horizon_row["survival"]
            if horizon_row is not None and horizon_row["atRisk"] > 0
            else None
        ),
        "survivalCurve": curve,
    }


def summarize_groups(records, key, names):
    return {
        name: km_summary([row for row in records if row[key] == name])
        for name in names
    }


def sector_range(groups, minimum_n=SECTOR_MIN_N):
    eligible = [
        (name, group)
        for name, group in groups.items()
        if group["companies"] >= minimum_n
        and group["horizonEstimable"]
        and group["survivalAtHorizon"] is not None
    ]
    if len(eligible) < 2:
        return [], None
    values = [group["survivalAtHorizon"] for _, group in eligible]
    return [name for name, _ in eligible], 100.0 * (max(values) - min(values))


def raw_group_counts(records, key):
    counts = {}
    for row in records:
        group = counts.setdefault(row[key], {
            "companies": 0,
            "terminalExits": 0,
            "rightCensored": 0,
        })
        group["companies"] += 1
        if row["event"]:
            group["terminalExits"] += 1
        else:
            group["rightCensored"] += 1
    return counts


def reconcile_anchors(records, d1_anchor, d2_anchor):
    events = sum(1 for row in records if row["event"])
    actual_counts = {
        "companies": len(records),
        "terminalExits": events,
        "rightCensored": len(records) - events,
        "quarterlyCadenceCompanies": sum(row["cadence"] == "quarterly" for row in records),
        "annualCadenceCompanies": sum(row["cadence"] == "annual" for row in records),
    }
    if actual_counts != d1_anchor["counts"]:
        raise SensitivityError("D4 does not reproduce D1 counts exactly")

    actual_size = raw_group_counts(records, "sizeGroup")
    expected_size = {
        "larger": d2_anchor["size"]["groups"]["larger"],
        "smaller": d2_anchor["size"]["groups"]["smaller"],
        "missing_or_unknown": d2_anchor["size"]["groups"]["missingOrUnknown"],
    }
    for name, expected in expected_size.items():
        for field in ("companies", "terminalExits", "rightCensored"):
            if actual_size.get(name, {}).get(field, 0) != expected[field]:
                raise SensitivityError("D4 does not reproduce D2 size group: " + name)

    actual_sector = raw_group_counts(records, "sector")
    for expected in d2_anchor["sector"]["groups"]:
        name = expected["sector"]
        for field in ("companies", "terminalExits", "rightCensored"):
            if actual_sector.get(name, {}).get(field, 0) != expected[field]:
                raise SensitivityError("D4 does not reproduce D2 sector: " + name)


def result_from_records(records, inputs=None, d1_anchor=None, d2_anchor=None):
    events = sum(1 for row in records if row["event"])
    size_groups = summarize_groups(
        records,
        "sizeGroup",
        ("larger", "smaller", "missing_or_unknown"),
    )
    sector_names = sorted(set(row["sector"] for row in records))
    sector_groups = summarize_groups(records, "sector", sector_names)
    larger_survival = size_groups["larger"]["survivalAtHorizon"]
    smaller_survival = size_groups["smaller"]["survivalAtHorizon"]
    if larger_survival is None or smaller_survival is None:
        raise SensitivityError("Primary size horizon is not estimable")
    survival_difference_pp = 100.0 * (smaller_survival - larger_survival)

    if d2_anchor is None:
        raw_size = raw_group_counts(records, "sizeGroup")
        raw_difference_pp = 100.0 * (
            raw_size["smaller"]["terminalExits"] / raw_size["smaller"]["companies"]
            - raw_size["larger"]["terminalExits"] / raw_size["larger"]["companies"]
        )
    else:
        raw_difference_pp = d2_anchor["size"][
            "riskDifferencePercentagePointsSmallerMinusLarger"
        ]
    direction_consistent = (
        (raw_difference_pp == 0 and survival_difference_pp == 0)
        or raw_difference_pp * survival_difference_pp < 0
    )
    eligible_sectors, survival_range_pp = sector_range(sector_groups)

    result = {
        "schema": "D4-censoring-aware-attrition/1",
        "preregistration": {
            "path": PREREG_REL,
            "sha256": sha256_file(PREREG),
            "status": "FROZEN_BEFORE_D4_PANEL_ACCESS",
        },
        "boundInputs": BOUND_INPUTS,
        "anchors": (
            {
                "d1": {"path": D1_ARTIFACT_REL, "sha256": BOUND_INPUTS[D1_ARTIFACT_REL]},
                "d2": {"path": D2_ARTIFACT_REL, "sha256": BOUND_INPUTS[D2_ARTIFACT_REL]},
                "countsMatched": True,
                "groupsMatched": True,
            }
            if d1_anchor is not None and d2_anchor is not None
            else None
        ),
        "scope": {
            "lastAllowedDate": D1.CUTOFF.isoformat(),
            "signalsUsed": 0,
            "companyIdentifiersWritten": 0,
            "dailyObservationsUsed": 0,
        },
        "inputs": inputs or [],
        "counts": {
            "companies": len(records),
            "terminalExits": events,
            "rightCensored": len(records) - events,
        },
        "effectiveN": {
            "companies": len(records),
            "independentUnit": "company within stratum",
            "filingsAreIndependentObservations": False,
            "dailyPoints": 0,
            "repeatedCompaniesAcrossStrata": 0,
        },
        "horizonQuarters": HORIZON_QUARTERS,
        "size": {
            "groups": {
                "larger": size_groups["larger"],
                "smaller": size_groups["smaller"],
                "missingOrUnknown": size_groups["missing_or_unknown"],
            },
            "rawD2AttritionDifferencePercentagePointsSmallerMinusLarger": round(
                raw_difference_pp, 12
            ),
            "survivalDifferencePercentagePointsSmallerMinusLarger": round(
                survival_difference_pp, 12
            ),
            "absoluteDifferenceThresholdPercentagePoints": SIZE_THRESHOLD_PP,
            "thresholdCrossed": abs(survival_difference_pp) >= SIZE_THRESHOLD_PP,
            "directionConsistentWithD2": direction_consistent,
            "nullModel": "equal 12-quarter evaluability survival",
            "isSignificanceTest": False,
        },
        "sector": {
            "groups": [
                {"sector": name, **sector_groups[name]}
                for name in sector_names
            ],
            "minimumCompaniesForRange": SECTOR_MIN_N,
            "eligibleSectors": eligible_sectors,
            "maxMinusMinSurvivalPercentagePoints": (
                round(survival_range_pp, 12)
                if survival_range_pp is not None
                else None
            ),
            "rangeThresholdPercentagePoints": SECTOR_THRESHOLD_PP,
            "thresholdCrossed": (
                survival_range_pp is not None
                and survival_range_pp >= SECTOR_THRESHOLD_PP
            ),
            "nullModel": "equal 12-quarter evaluability survival across eligible sectors",
            "isSignificanceTest": False,
        },
    }
    validate_result(result)
    return result


def validate_group(group):
    if group["terminalExits"] + group["rightCensored"] != group["companies"]:
        raise SensitivityError("Group outcomes do not reconcile")
    previous = 1.0
    for row in group["survivalCurve"]:
        probability = row["survival"]
        if not 0.0 <= probability <= previous <= 1.0:
            raise SensitivityError("Group survival curve is invalid")
        previous = probability
    horizon = next(
        (row for row in group["survivalCurve"]
         if row["quartersSinceEntry"] == HORIZON_QUARTERS),
        None,
    )
    expected = (
        horizon["survival"]
        if horizon is not None and horizon["atRisk"] > 0
        else None
    )
    if group["survivalAtHorizon"] != expected:
        raise SensitivityError("Group horizon survival does not match its curve")


def validate_result(result):
    counts = result["counts"]
    if counts["terminalExits"] + counts["rightCensored"] != counts["companies"]:
        raise SensitivityError("D4 outcomes do not reconcile")
    size_groups = result["size"]["groups"]
    if sum(group["companies"] for group in size_groups.values()) != counts["companies"]:
        raise SensitivityError("D4 size groups do not reconcile")
    sector_groups = result["sector"]["groups"]
    if sum(group["companies"] for group in sector_groups) != counts["companies"]:
        raise SensitivityError("D4 sector groups do not reconcile")
    for group in list(size_groups.values()) + sector_groups:
        validate_group(group)
    recomputed = 100.0 * (
        size_groups["smaller"]["survivalAtHorizon"]
        - size_groups["larger"]["survivalAtHorizon"]
    )
    if abs(recomputed - result["size"][
            "survivalDifferencePercentagePointsSmallerMinusLarger"]) > 1e-10:
        raise SensitivityError("D4 primary contrast is not reproducible")

    def check_keys(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if str(key).lower() in {
                        "cik", "ticker", "adsh", "company", "companyname",
                        "company_name", "signal", "signalvalue"}:
                    raise SensitivityError("Identity or signal leaked into D4 output")
                check_keys(child)
        elif isinstance(value, list):
            for child in value:
                check_keys(child)
    check_keys(result)


def build_result(paths):
    verify_bound_inputs()
    with open(repo_path(D1_ARTIFACT_REL), encoding="utf-8") as handle:
        d1_anchor = json.load(handle)
    with open(repo_path(D2_ARTIFACT_REL), encoding="utf-8") as handle:
        d2_anchor = json.load(handle)
    companies, inputs = D2.read_panels(paths)
    records = company_records(companies)
    reconcile_anchors(records, d1_anchor, d2_anchor)
    return result_from_records(records, inputs, d1_anchor, d2_anchor)


def write_json(path, result):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def self_test():
    failures = []

    def check(name, condition, actual=None):
        if condition:
            print("  ok    " + name)
        else:
            failures.append(name)
            print("  ROT   " + name + " (ist: " + repr(actual) + ")")

    verify_bound_inputs()
    fixture = [
        {"duration": 2, "event": True, "cadence": "quarterly", "sizeGroup": "larger", "sector": "Manufacturing"},
        {"duration": 10, "event": True, "cadence": "quarterly", "sizeGroup": "larger", "sector": "Manufacturing"},
        {"duration": 6, "event": False, "cadence": "quarterly", "sizeGroup": "larger", "sector": "Services"},
        {"duration": 12, "event": False, "cadence": "quarterly", "sizeGroup": "larger", "sector": "Services"},
        {"duration": 1, "event": True, "cadence": "quarterly", "sizeGroup": "smaller", "sector": "Manufacturing"},
        {"duration": 3, "event": True, "cadence": "quarterly", "sizeGroup": "smaller", "sector": "Services"},
        {"duration": 6, "event": True, "cadence": "quarterly", "sizeGroup": "smaller", "sector": "Services"},
        {"duration": 12, "event": False, "cadence": "annual", "sizeGroup": "smaller", "sector": "Services"},
        {"duration": 12, "event": False, "cadence": "annual", "sizeGroup": "missing_or_unknown", "sector": "unclassified"},
    ]
    result = result_from_records(fixture)
    check("Gebundene D1- und D2-Eingaenge sind bytegleich zur Vorregistrierung",
          all(sha256_file(repo_path(name)) == expected
              for name, expected in BOUND_INPUTS.items()))
    check("Fixture zaehlt genau neun Firmen", result["counts"]["companies"] == 9,
          result["counts"])
    check("Ereignisse plus Zensuren gehen in der Fixture auf",
          result["counts"]["terminalExits"] == 5
          and result["counts"]["rightCensored"] == 4, result["counts"])
    check("Larger-Survival bei Quartal zwoelf ist von Hand 3/8",
          abs(result["size"]["groups"]["larger"]["survivalAtHorizon"] - 0.375) < 1e-12,
          result["size"]["groups"]["larger"])
    check("Smaller-Survival bei Quartal zwoelf ist von Hand 1/4",
          abs(result["size"]["groups"]["smaller"]["survivalAtHorizon"] - 0.25) < 1e-12,
          result["size"]["groups"]["smaller"])
    check("Zensierungsbewusste Differenz ist von Hand minus 12,5 Punkte",
          abs(result["size"]["survivalDifferencePercentagePointsSmallerMinusLarger"]
              + 12.5) < 1e-12, result["size"])
    check("Vorregistrierte Fuenf-Punkte-Schwelle greift in der Fixture",
          result["size"]["thresholdCrossed"] is True, result["size"])
    check("Rohe D2-Richtung und Survival-Richtung sind gegensinnig konsistent",
          result["size"]["directionConsistentWithD2"] is True, result["size"])
    check("Fehlende AFS-Gruppe bleibt sichtbar und ausserhalb des Kontrasts",
          result["size"]["groups"]["missingOrUnknown"]["companies"] == 1,
          result["size"]["groups"])
    same_time, _ = D1.kaplan_meier([
        {"duration": 1, "event": True},
        {"duration": 1, "event": False},
    ])
    check("Ereignis wird bei gleicher Dauer vor der Zensur verrechnet",
          same_time[1]["survival"] == 0.5, same_time[1])
    late = km_summary([{"duration": 6, "event": False}])
    check("Nicht beobachteter gemeinsamer Horizont wird nicht fortgeschrieben",
          late["horizonEstimable"] is False
          and late["survivalAtHorizon"] is None, late)
    fake_sector_groups = {
        "A": {"companies": 200, "horizonEstimable": True, "survivalAtHorizon": 0.8},
        "B": {"companies": 300, "horizonEstimable": True, "survivalAtHorizon": 0.6},
        "C": {"companies": 199, "horizonEstimable": True, "survivalAtHorizon": 0.1},
    }
    eligible, spread = sector_range(fake_sector_groups)
    check("Sektorspannweite schliesst Gruppen unter zweihundert Firmen aus",
          eligible == ["A", "B"] and abs(spread - 20.0) < 1e-12,
          {"eligible": eligible, "spread": spread})
    check("Alle Fixture-Kurven bleiben monoton",
          all(all(group["survivalCurve"][index]["survival"]
                  <= group["survivalCurve"][index - 1]["survival"]
                  for index in range(1, len(group["survivalCurve"])))
              for group in result["size"]["groups"].values()),
          result["size"]["groups"])
    check("Effektives N ist Firma und nie Bericht oder Tag",
          result["effectiveN"]["companies"] == 9
          and result["effectiveN"]["dailyPoints"] == 0
          and result["effectiveN"]["filingsAreIndependentObservations"] is False,
          result["effectiveN"])
    check("Aggregat schreibt weder Firmenidentitaet noch Signal",
          result["scope"]["companyIdentifiersWritten"] == 0
          and result["scope"]["signalsUsed"] == 0, result["scope"])

    if failures:
        print("SELBSTTEST ROT - %d Pruefung(en) gescheitert" % len(failures))
        return 1
    print("SELBSTTEST GRUEN - 15 benannte Pruefungen")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="D4 censoring-aware attrition sensitivity")
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
        "sizeSurvivalDifferencePP": result["size"][
            "survivalDifferencePercentagePointsSmallerMinusLarger"
        ],
        "sectorSurvivalRangePP": result["sector"][
            "maxMinusMinSurvivalPercentagePoints"
        ],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (SensitivityError, D1.SurvivalError, D2.AssociationError) as error:
        print("ABBRUCH: " + str(error), file=sys.stderr)
        sys.exit(1)
