#!/usr/bin/env python3
"""R2-D1: compare frozen form-imputed and company-learned panel cadence.

Only the two pre-endtest D1 panels are accepted. Company identifiers exist only
as in-memory grouping keys and are discarded before aggregate output.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import statistics
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import timedelta


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREREG_REL = (
    "protocol/early-detection/2.0.0/"
    "r2-d1-cadence-edge-bias-preregistration.json"
)
PREREG = os.path.join(REPO, *PREREG_REL.split("/"))
PUBLISHED_REL = "reports/studie/D1-panel-survival-2026-08-23.json"
PUBLISHED = os.path.join(REPO, *PUBLISHED_REL.split("/"))
D1_PATH = os.path.join(REPO, "scripts", "studie-panel-survival.py")
EDGE_BANDS = (
    (0, 90, "0-90"),
    (91, 120, "91-120"),
    (121, 180, "121-180"),
    (181, 270, "181-270"),
    (271, 365, "271-365"),
    (366, None, "366+"),
)
REPORTER_TYPES = (
    "domestic-quarterly",
    "domestic-annual-only",
    "foreign-annual-only",
)


class CadenceBiasError(Exception):
    """Fail-closed correction-contract violation."""


def load_d1():
    spec = importlib.util.spec_from_file_location("studie_panel_survival", D1_PATH)
    if spec is None or spec.loader is None:
        raise CadenceBiasError("Could not load the frozen D1 implementation")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


D1 = load_d1()


def read_json(path: str) -> dict[str, object]:
    with open(path, "r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise CadenceBiasError("Expected a JSON object: " + path)
    return value


def reporter_type(forms: set[str]) -> str:
    if "10-Q" in forms:
        return "domestic-quarterly"
    if "10-K" in forms:
        return "domestic-annual-only"
    if forms.intersection({"20-F", "40-F"}):
        return "foreign-annual-only"
    raise CadenceBiasError("Periodic company has no preregistered reporter type")


def edge_band(days: int) -> str:
    for lower, upper, label in EDGE_BANDS:
        if days >= lower and (upper is None or days <= upper):
            return label
    raise CadenceBiasError("Negative or unclassified panel-edge distance")


def make_record(first, last, cadence_days: int) -> dict[str, object]:
    expected_next = last + timedelta(days=cadence_days)
    event = expected_next <= D1.CUTOFF
    endpoint = expected_next if event else D1.CUTOFF
    duration = D1.quarter_index(endpoint) - D1.quarter_index(first)
    if duration < 0:
        raise CadenceBiasError("Negative company duration")
    return {
        "duration": duration,
        "event": event,
        "exitQuarter": D1.quarter_label(expected_next) if event else None,
    }


def company_comparisons(companies: dict[str, dict[str, object]]) -> list[dict[str, object]]:
    comparisons = []
    for state in companies.values():
        accepted_dates = sorted(set(state["periods"].values()))
        if not accepted_dates:
            continue
        forms = set(state["forms"])
        frozen_days = (
            D1.QUARTERLY_DAYS
            if forms.intersection(D1.DOMESTIC_FORMS)
            else D1.ANNUAL_DAYS
        )
        intervals = [
            (right - left).days
            for left, right in zip(accepted_dates, accepted_dates[1:])
            if (right - left).days > 0
        ]
        fallback = not intervals
        learned_days = (
            frozen_days
            if fallback
            else math.ceil(statistics.median(intervals))
        )
        first = accepted_dates[0]
        last = accepted_dates[-1]
        comparisons.append({
            "reporterType": reporter_type(forms),
            "edgeBand": edge_band((D1.CUTOFF - last).days),
            "learnedCadenceDays": learned_days,
            "fallbackImputed": fallback,
            "frozen": make_record(first, last, frozen_days),
            "learned": make_record(first, last, learned_days),
        })
    if not comparisons:
        raise CadenceBiasError("No eligible panel companies")
    return comparisons


def reading_summary(records: list[dict[str, object]]) -> dict[str, object]:
    curve, median = D1.kaplan_meier(records)
    exits = Counter(row["exitQuarter"] for row in records if row["event"])
    terminal = sum(1 for row in records if row["event"])
    return {
        "terminalExits": terminal,
        "rightCensored": len(records) - terminal,
        "medianStayQuarters": median,
        "survivalCurve": curve,
        "exitByQuarter": [
            {"quarter": quarter, "companies": exits[quarter]}
            for quarter in sorted(exits)
        ],
    }


def classification_name(row: dict[str, object]) -> str:
    frozen_event = bool(row["frozen"]["event"])
    learned_event = bool(row["learned"]["event"])
    if frozen_event and learned_event:
        return "sameEvent"
    if not frozen_event and not learned_event:
        return "sameCensored"
    if frozen_event:
        return "frozenOnlyExit"
    return "learnedOnlyExit"


def count_rows(counter: Counter, labels: tuple[str, ...], key: str) -> list[dict[str, object]]:
    return [{key: label, "companies": counter[label]} for label in labels]


def cadence_summaries(comparisons: list[dict[str, object]]) -> list[dict[str, object]]:
    result = []
    for kind in REPORTER_TYPES:
        rows = [row for row in comparisons if row["reporterType"] == kind]
        learned = [
            int(row["learnedCadenceDays"])
            for row in rows
            if not row["fallbackImputed"]
        ]
        result.append({
            "reporterType": kind,
            "companies": len(rows),
            "learnedCompanies": len(learned),
            "fallbackImputedCompanies": len(rows) - len(learned),
            "minimumLearnedDays": min(learned) if learned else None,
            "medianLearnedDays": (
                round(float(statistics.median(learned)), 3) if learned else None
            ),
            "maximumLearnedDays": max(learned) if learned else None,
        })
    return result


def build_result(paths: list[str], published_path: str = PUBLISHED) -> dict[str, object]:
    prereg = read_json(PREREG)
    if prereg.get("status") != "FROZEN_BEFORE_CORRECTION_PANEL_ACCESS":
        raise CadenceBiasError("Cadence correction preregistration is not frozen")
    companies, input_summary = D1.read_panels(paths)
    comparisons = company_comparisons(companies)
    published = read_json(published_path)

    frozen_records = [row["frozen"] for row in comparisons]
    learned_records = [row["learned"] for row in comparisons]
    frozen = reading_summary(frozen_records)
    learned = reading_summary(learned_records)

    expected_frozen = {
        "terminalExits": published["counts"]["terminalExits"],
        "rightCensored": published["counts"]["rightCensored"],
        "medianStayQuarters": published["medianStayQuarters"],
        "survivalCurve": published["survivalCurve"],
        "exitByQuarter": published["exitByQuarter"],
    }
    if frozen != expected_frozen:
        raise CadenceBiasError("Frozen reading does not reproduce published D1 exactly")

    classifications = Counter(classification_name(row) for row in comparisons)
    fixed_only = [
        row for row in comparisons if classification_name(row) == "frozenOnlyExit"
    ]
    reporter_counts = Counter(row["reporterType"] for row in fixed_only)
    edge_counts = Counter(row["edgeBand"] for row in fixed_only)
    matrix_counts = Counter(
        (row["reporterType"], row["edgeBand"]) for row in fixed_only
    )
    band_labels = tuple(label for _, _, label in EDGE_BANDS)

    inputs = dict(input_summary)
    inputs["files"] = [
        {
            **row,
            "sha256": D1.sha256_file(next(
                path for path in paths
                if os.path.basename(os.path.abspath(path)) == row["file"]
            )),
        }
        for row in input_summary["files"]
    ]

    result = {
        "schema": "R2-D1-cadence-edge-bias/1",
        "preregistration": {
            "path": PREREG_REL,
            "sha256": D1.sha256_file(PREREG),
            "status": prereg["status"],
        },
        "publishedD1": {
            "path": PUBLISHED_REL,
            "sha256": D1.sha256_file(published_path),
            "reproducedExactly": True,
        },
        "scope": {
            "lastAllowedDate": D1.CUTOFF.isoformat(),
            "signalsUsed": 0,
            "pricesUsed": 0,
            "outcomesUsed": 0,
            "companyIdentifiersWritten": 0,
            "endtestOpened": False,
        },
        "inputs": inputs,
        "counts": {
            "companies": len(comparisons),
            "frozenOnlyExits": classifications["frozenOnlyExit"],
            "learnedOnlyExits": classifications["learnedOnlyExit"],
            "sameEvent": classifications["sameEvent"],
            "sameCensored": classifications["sameCensored"],
            "fallbackImputedCompanies": sum(
                1 for row in comparisons if row["fallbackImputed"]
            ),
        },
        "readings": {
            "frozenFormImputed": frozen,
            "companyLearned": learned,
        },
        "frozenOnlyByReporterType": count_rows(
            reporter_counts, REPORTER_TYPES, "reporterType"
        ),
        "frozenOnlyByPanelEdgeDays": count_rows(
            edge_counts, band_labels, "panelEdgeDays"
        ),
        "frozenOnlyByReporterTypeAndPanelEdgeDays": [
            {
                "reporterType": kind,
                "panelEdgeDays": band,
                "companies": matrix_counts[(kind, band)],
            }
            for kind in REPORTER_TYPES
            for band in band_labels
        ],
        "learnedCadenceByReporterType": cadence_summaries(comparisons),
        "panelEdgeCheck": {
            "quarter": "2020Q4",
            "frozenTerminalExits": next(
                (row["companies"] for row in frozen["exitByQuarter"]
                 if row["quarter"] == "2020Q4"),
                0,
            ),
            "learnedTerminalExits": next(
                (row["companies"] for row in learned["exitByQuarter"]
                 if row["quarter"] == "2020Q4"),
                0,
            ),
        },
        "correction": {
            "publishedMedianStayQuarters": published["medianStayQuarters"],
            "learnedMedianStayQuarters": learned["medianStayQuarters"],
            "appendOnlyNotesRequired": (
                learned["medianStayQuarters"] != published["medianStayQuarters"]
            ),
            "reports": ["D1", "D2", "D4", "D5"],
        },
    }
    validate_result(result)
    return result


def validate_result(result: dict[str, object]) -> None:
    counts = result["counts"]
    frozen = result["readings"]["frozenFormImputed"]
    learned = result["readings"]["companyLearned"]
    companies = counts["companies"]
    if frozen["terminalExits"] + frozen["rightCensored"] != companies:
        raise CadenceBiasError("Frozen reading does not reconcile to effective N")
    if learned["terminalExits"] + learned["rightCensored"] != companies:
        raise CadenceBiasError("Learned reading does not reconcile to effective N")
    if sum(counts[key] for key in (
            "frozenOnlyExits", "learnedOnlyExits", "sameEvent", "sameCensored")) != companies:
        raise CadenceBiasError("Classification cells do not partition effective N")
    if sum(row["companies"] for row in result["frozenOnlyByReporterType"]) != counts["frozenOnlyExits"]:
        raise CadenceBiasError("Reporter-type rows do not partition frozen-only exits")
    if sum(row["companies"] for row in result["frozenOnlyByPanelEdgeDays"]) != counts["frozenOnlyExits"]:
        raise CadenceBiasError("Panel-edge rows do not partition frozen-only exits")
    if sum(row["companies"] for row in result["frozenOnlyByReporterTypeAndPanelEdgeDays"]) != counts["frozenOnlyExits"]:
        raise CadenceBiasError("Reporter-by-edge matrix does not partition frozen-only exits")
    if result["publishedD1"]["reproducedExactly"] is not True:
        raise CadenceBiasError("Published D1 reproduction flag is not true")
    serialized = json.dumps(result, ensure_ascii=True, sort_keys=True).lower()
    for forbidden_key in ('"cik"', '"ticker"', '"adsh"', '"companyname"'):
        if forbidden_key in serialized:
            raise CadenceBiasError("Identity field leaked into aggregate output")
    for forbidden_year in ('"2021q', '"2022q', '"2023q', '"2024q'):
        if forbidden_year in serialized:
            raise CadenceBiasError("Post-cutoff quarter leaked into aggregate output")


def write_json(path: str, result: dict[str, object]) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def render_report(result: dict[str, object]) -> str:
    counts = result["counts"]
    frozen = result["readings"]["frozenFormImputed"]
    learned = result["readings"]["companyLearned"]
    lines = [
        (
            "**Ergebnis: Von den %s veroeffentlichten terminalen D1-Ausstiegen "
            "entfallen %s allein auf die eingefrorene Form-Kadenz; der Median "
            "liegt in der firmengelernten Lesart bei %s statt %s Quartalen.**"
        ) % (
            format(frozen["terminalExits"], ",").replace(",", "."),
            format(counts["frozenOnlyExits"], ",").replace(",", "."),
            learned["medianStayQuarters"],
            frozen["medianStayQuarters"],
        ),
        "",
        "# R2-D1 - Kadenzregel an der Panelkante",
        "",
        "## Wie gemessen",
        "",
        (
            "Die Gegenmessung wurde vor dem Panelzugriff in `%s` eingefroren. "
            "Die veroeffentlichte D1-Lesart blieb unveraendert: 91 Tage fuer "
            "jede Firma mit 10-K oder 10-Q, sonst 365 Tage. Daneben steht eine "
            "firmengelernte Lesart: aufgerundeter Median der positiven Abstaende "
            "zwischen aufeinanderfolgenden, periodenbereinigten `accepted`-Daten."
        ) % result["preregistration"]["path"],
        "",
        (
            "Firmen mit weniger als zwei verschiedenen Berichtsdaten behalten "
            "sichtbar die alte Imputation; das betrifft %s Firmen. Gelesen wurden "
            "nur die beiden vor dem Endtest liegenden D1-Panels bis 31.12.2020. "
            "Signale, Preise, Outcomes und das versiegelte Endtest-Fenster wurden "
            "nicht geoeffnet."
        ) % format(counts["fallbackImputedCompanies"], ",").replace(",", "."),
        "",
        "## Beide Lesarten",
        "",
        "| Kennzahl | Eingefrorene Form-Kadenz | Firmengelernte Kadenz |",
        "|---|---:|---:|",
        "| Terminale Ausstiege | %s | %s |" % (
            frozen["terminalExits"], learned["terminalExits"]),
        "| Rechtszensiert | %s | %s |" % (
            frozen["rightCensored"], learned["rightCensored"]),
        "| Median der Verweildauer (Quartale) | %s | %s |" % (
            frozen["medianStayQuarters"], learned["medianStayQuarters"]),
        "| Ausstiege 2020Q4 | %s | %s |" % (
            result["panelEdgeCheck"]["frozenTerminalExits"],
            result["panelEdgeCheck"]["learnedTerminalExits"],
        ),
        "",
        "## Nur durch die Form-Kadenz erzeugte Ausstiege",
        "",
        "### Nach Meldertyp",
        "",
        "| Meldertyp | Firmen |",
        "|---|---:|",
    ]
    for row in result["frozenOnlyByReporterType"]:
        lines.append("| %s | %s |" % (row["reporterType"], row["companies"]))
    lines.extend([
        "",
        "### Nach Abstand zur Panelkante",
        "",
        "| Tage vom letzten Bericht bis 31.12.2020 | Firmen |",
        "|---|---:|",
    ])
    for row in result["frozenOnlyByPanelEdgeDays"]:
        lines.append("| %s | %s |" % (row["panelEdgeDays"], row["companies"]))
    lines.extend([
        "",
        "## Ueberlebenskurven nebeneinander",
        "",
        "| Quartale seit Einstieg | Form-Kadenz Ueberleben | Firmengelernt Ueberleben |",
        "|---:|---:|---:|",
    ])
    frozen_curve = {row["quartersSinceEntry"]: row for row in frozen["survivalCurve"]}
    learned_curve = {row["quartersSinceEntry"]: row for row in learned["survivalCurve"]}
    for quarter in sorted(set(frozen_curve) | set(learned_curve)):
        left = frozen_curve.get(quarter)
        right = learned_curve.get(quarter)
        lines.append("| %s | %s | %s |" % (
            quarter,
            "" if left is None else format(left["survival"], ".12f"),
            "" if right is None else format(right["survival"], ".12f"),
        ))
    lines.extend([
        "",
        "## Was ausdruecklich nicht gezeigt ist",
        "",
        "- Die firmengelernte Lesart ersetzt weder D1 noch ein Studienverdikt.",
        "- Ein Berichtsabstand beweist weder Insolvenz noch Delisting oder wirtschaftliches Scheitern.",
        "- Firmen mit nur einem Bericht liefern keine gelernte Kadenz; ihr Fallback bleibt ausgewiesen.",
        "- Das Endtest-Fenster 2021-2023 wurde weder geoeffnet noch gezaehlt oder dargestellt.",
        "- Die Messung verwendet keine Signale, Preise oder Outcomes.",
        "",
        (
            "Alle Zahlen stehen in `reports/studie/"
            "R2-D1-cadence-edge-bias-2026-08-28.json`. Die eingefrorene "
            "Lesart reproduziert D1 vollstaendig und byteunabhaengig nach Zahlenstruktur."
        ),
        "",
    ])
    return "\n".join(lines)


def write_text(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def build_fixture(path: str, rows: list[tuple[object, ...]]) -> None:
    D1.build_fixture(path, rows)


def self_test() -> int:
    failures = []

    def check(name: str, condition: bool, actual: object = None) -> None:
        if condition:
            print("  ok    " + name)
        else:
            failures.append(name)
            print("  ROT   " + name + " (ist: " + repr(actual) + ")")

    with tempfile.TemporaryDirectory(prefix="r2-d1-cadence-") as directory:
        discovery = os.path.join(directory, D1.ALLOWED_BASENAMES[0])
        validation = os.path.join(directory, D1.ALLOWED_BASENAMES[1])
        build_fixture(discovery, [
            ("a1", "100", "10-K", "20181231", "2019-03-01 00:00:00"),
            ("a2", "100", "10-K", "20191231", "2020-03-01 00:00:00"),
            ("b1", "200", "10-Q", "20191231", "2020-01-01 00:00:00"),
            ("b2", "200", "10-Q", "20200331", "2020-05-01 00:00:00"),
            ("b3", "200", "10-K", "20200630", "2020-09-01 00:00:00"),
            ("c1", "300", "10-Q", "20200331", "2020-03-31 00:00:00"),
            ("c2", "300", "10-Q", "20200630", "2020-06-30 00:00:00"),
            ("c3", "300", "10-Q", "20200930", "2020-09-30 00:00:00"),
        ])
        build_fixture(validation, [
            ("d1", "400", "20-F", "20181231", "2019-04-01 00:00:00"),
            ("d2", "400", "20-F", "20191231", "2020-04-01 00:00:00"),
            ("e1", "500", "10-Q", "20191231", "2020-01-01 00:00:00"),
        ])
        companies, _ = D1.read_panels([discovery, validation])
        rows = company_comparisons(companies)
        classifications = Counter(classification_name(row) for row in rows)
        check("Jahresmelder und Quartalsmelder mit langer Luecke kippen gemeinsam",
              classifications["frozenOnlyExit"] == 2, classifications)
        check("Reiner 10-K-Melder ist eigener Meldertyp",
              sum(1 for row in rows if row["reporterType"] == "domestic-annual-only") == 1)
        check("Reiner 20-F-Melder bleibt auslaendischer Jahresmelder",
              sum(1 for row in rows if row["reporterType"] == "foreign-annual-only") == 1)
        check("Einzelbericht bleibt ehrlich fallback-imputiert",
              sum(1 for row in rows if row["fallbackImputed"]) == 1)
        quarterly_learned = [
            row["learnedCadenceDays"] for row in rows
            if row["reporterType"] == "domestic-quarterly"
            and not row["fallbackImputed"]
        ]
        check("Median mit halbem Tag wird konservativ aufgerundet",
              92 in quarterly_learned, quarterly_learned)
        frozen = reading_summary([row["frozen"] for row in rows])
        learned = reading_summary([row["learned"] for row in rows])
        check("Beide Lesarten rechnen auf dasselbe effektive N",
              frozen["terminalExits"] + frozen["rightCensored"] == 5
              and learned["terminalExits"] + learned["rightCensored"] == 5,
              (frozen, learned))
        check("Panelkanten-Band 91-120 ist erreichbar",
              any(row["edgeBand"] == "91-120" for row in rows),
              [row["edgeBand"] for row in rows])
        check("Die Gegenlesart kann 2020Q4-Ausstiege entfernen",
              sum(1 for row in rows if row["frozen"]["exitQuarter"] == "2020Q4")
              > sum(1 for row in rows if row["learned"]["exitQuarter"] == "2020Q4"))
        public = {
            "counts": dict(classifications),
            "rows": [{
                "reporterType": row["reporterType"],
                "edgeBand": row["edgeBand"],
                "fallbackImputed": row["fallbackImputed"],
            } for row in rows],
        }
        serialized = json.dumps(public, sort_keys=True).lower()
        check("Aggregat verwirft jede Firmenidentitaet",
              all(token not in serialized for token in ('"cik"', '"ticker"', '"adsh"')))
        check("Klassifikationen partitionieren das Fixture",
              sum(classifications.values()) == 5, classifications)

    if failures:
        print("SELBSTTEST ROT - %d Pruefung(en) gescheitert" % len(failures))
        return 1
    print("SELBSTTEST GRUEN - 10 benannte Pruefungen")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="R2-D1 cadence-edge sensitivity")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--discovery")
    parser.add_argument("--validation")
    parser.add_argument("--published", default=PUBLISHED)
    parser.add_argument("--output")
    parser.add_argument("--report")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if not (args.discovery and args.validation and args.output and args.report):
        parser.error("--discovery, --validation, --output and --report are required")
    result = build_result([args.discovery, args.validation], args.published)
    write_json(args.output, result)
    write_text(args.report, render_report(result))
    print(json.dumps({
        "companies": result["counts"]["companies"],
        "frozenOnlyExits": result["counts"]["frozenOnlyExits"],
        "frozenMedian": result["readings"]["frozenFormImputed"]["medianStayQuarters"],
        "learnedMedian": result["readings"]["companyLearned"]["medianStayQuarters"],
        "correctionNotesRequired": result["correction"]["appendOnlyNotesRequired"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (CadenceBiasError, D1.SurvivalError) as error:
        print("ABBRUCH: " + str(error), file=sys.stderr)
        sys.exit(1)
