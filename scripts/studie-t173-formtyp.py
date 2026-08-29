#!/usr/bin/env python3
"""T173: form-type breakdown of the nonperiodic report exclusions, per window.

Governed by the frozen addendum
protocol/early-detection/2.0.0/r2-a1-t173-form-type-counter-addendum.json
(SHA-256 a7002de9b01c83bb025471ce1fc2c32faf3d947ca0f76e99eb4e6b5eb931dcc7),
approved as ENTSCHIED 17 (Orchestrator-Direktiven 2026-08-29, 19:06).

Reads EXACTLY ONE column, `bericht.form`, in EXACTLY the two fixed window
labels the bridge artifact already carries (`entdeckung`, `pruefung`; the
endtest window is structurally absent from WINDOWS and is never named here).
No `fakt`, no identity, no signal, no outcome, no price, no key material.

The counter does not reimplement anything. `form_stem` and
`PERIODISCHE_FORMEN` are IMPORTED from the production path
(scripts/studie-identity-bridge-artifact.py) and additionally pinned against
the frozen addendum record, so a drift on either side is red, not silent.

Three proofs, each shown firing in --selbsttest:
  * zwei-fenster-waechter        (synthetic, per-window separation)
  * sabotage-leck                (periodic row routed into the map)
  * sabotage-fehlklassifikation  (normalisation altered)
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import importlib.util
import inspect
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRIDGE_SCRIPT_REL = "scripts/studie-identity-bridge-artifact.py"
ADDENDUM_REL = (
    "protocol/early-detection/2.0.0/"
    "r2-a1-t173-form-type-counter-addendum.json"
)
ADDENDUM = os.path.join(REPO, *ADDENDUM_REL.split("/"))
# The hash the orchestrator told us to cite. Pinning it here means a silently
# edited "frozen" record stops this run instead of being counted against.
ADDENDUM_SHA256 = (
    "a7002de9b01c83bb025471ce1fc2c32faf3d947ca0f76e99eb4e6b5eb931dcc7"
)
OUTPUT_FIELD = "nonperiodicReportsExcludedByForm"
TOTAL_FIELD = "nonperiodicReportsExcluded"
# Committed output of the governed artifact's own v1.2.0 run. Used ONLY as an
# informational cross-check that this counter reproduces the production
# exclusion path - never as the reconciliation, which the addendum binds to the
# counter measured in THIS run (`reconciliation.sameRunOnly`).
ARTEFAKT_BERICHT_REL = "reports/studie/R2-A1-identity-bridge-artifact-2026-08-29.json"

# Behaviour pin for the normalisation. Not a second implementation: the SOLL
# side is written out by hand ONCE so that a changed `form_stem` has something
# to disagree with. Covers suffix stripping, case, whitespace and the empty
# value; and both sides of the periodic/nonperiodic verdict.
NORMALISIERUNGS_PROBE = (
    ("10-K", "10-K", True),
    ("10-K/A", "10-K", True),
    ("10-Q", "10-Q", True),
    ("20-F", "20-F", True),
    ("40-F", "40-F", True),
    (" 10-q ", "10-Q", True),
    ("6-K", "6-K", False),
    ("6-K/A", "6-K", False),
    ("8-K", "8-K", False),
    ("s-1", "S-1", False),
    (None, "", False),
    ("", "", False),
)


class T173Fehler(Exception):
    """A broken contract stops the run. Never a warning, never a fallback."""


def lade_bruecke():
    pfad = os.path.join(REPO, *BRIDGE_SCRIPT_REL.split("/"))
    spec = importlib.util.spec_from_file_location("t173_bruecke", pfad)
    if spec is None or spec.loader is None:
        raise T173Fehler("Bridge artifact cannot be loaded: " + BRIDGE_SCRIPT_REL)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


BRUECKE = lade_bruecke()
FORM_STEM = BRUECKE.form_stem
PERIODISCHE_FORMEN = BRUECKE.BASIS.PERIODISCHE_FORMEN
WINDOWS = BRUECKE.WINDOWS


def sha256_datei(pfad):
    digest = hashlib.sha256()
    with open(pfad, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def lies_addendum():
    """The frozen record is the SOLL side of every pin below."""
    ist = sha256_datei(ADDENDUM)
    if ist != ADDENDUM_SHA256:
        raise T173Fehler(
            "ABBRUCH: the frozen T173 addendum does not carry its approved "
            "hash. Soll " + ADDENDUM_SHA256 + ", Ist " + ist)
    with open(ADDENDUM, "r", encoding="utf-8") as f:
        record = json.load(f)
    if record.get("status") != "FROZEN_T173_FORM_TYPE_COUNTER_ADDENDUM":
        raise T173Fehler("ABBRUCH: addendum status is not the frozen one")
    return record


def _ausdruck(quelltext):
    """The body of a one-line function, quote style normalised.

    The addendum spells the definition with single quotes, the code with
    double ones. Comparing the raw text would fail on typography instead of
    on substance, so both sides are flattened first.
    """
    zeile = quelltext.strip().splitlines()[-1].strip()
    zeile = re.sub(r"^return\s+", "", zeile)
    return zeile.replace('"', "'").replace(" ", "")


def normalisierungs_waechter(klassifikator, periodische, record):
    """Pins the normalisation against the frozen record AND against behaviour.

    Fires on both directions: an altered `form_stem`, an altered periodic set,
    and an altered record all turn this red with Ist against Soll.
    """
    soll_menge = list(record["normalization"]["periodicSet"])
    ist_menge = list(periodische)
    if ist_menge != soll_menge:
        raise T173Fehler(
            "ABBRUCH normalisierung: periodic set differs from the frozen "
            "record. Soll " + repr(soll_menge) + ", Ist " + repr(ist_menge))

    # Behaviour before text: an altered normalisation must be caught by what it
    # DOES, not merely by how it reads. Stem and periodicity verdict are
    # compared as one pair so neither half is a branch that never fires.
    for roh, soll_stamm, soll_periodisch in NORMALISIERUNGS_PROBE:
        ist_stamm = klassifikator(roh)
        ist = (ist_stamm, ist_stamm in periodische)
        soll = (soll_stamm, soll_periodisch)
        if ist != soll:
            raise T173Fehler(
                "ABBRUCH normalisierung: " + repr(roh) + " is normalised and "
                "classified wrong. Soll (stamm, periodisch)=" + repr(soll)
                + ", Ist " + repr(ist))

    soll_def = _ausdruck(record["normalization"]["definition"])
    try:
        ist_def = _ausdruck(inspect.getsource(klassifikator))
    except (OSError, TypeError):
        ist_def = "<nicht lesbar>"
    if ist_def != soll_def:
        raise T173Fehler(
            "ABBRUCH normalisierung: form_stem differs from the frozen "
            "definition. Soll " + repr(soll_def) + ", Ist " + repr(ist_def))
    return {"periodicSet": ist_menge, "definition": soll_def,
            "probeCases": len(NORMALISIERUNGS_PROBE)}


def standard_weiche(_stamm, nichtperiodisch):
    """Which rows reach the map. Identical to the exclusion condition."""
    return nichtperiodisch


def zaehle_zeilen(zeilen, klassifikator=None, weiche=None, karte=None):
    """Two INDEPENDENT arms over one row stream.

    Arm 1 (`gesamt`) is the production exclusion counter: it counts exactly
    what `scan_panel` counts into `nonperiodicReportsExcluded`. Arm 2 is the
    breakdown. They are deliberately not derived from each other - otherwise
    the reconciliation below would be a tautology and the leak sabotage could
    not make them diverge.

    `karte` is injectable so the two-window guard can be broken on purpose by
    handing both windows the SAME counter.
    """
    klassifikator = klassifikator or FORM_STEM
    weiche = weiche or standard_weiche
    karte = collections.Counter() if karte is None else karte
    gesamt = 0
    gelesen = 0
    for (form,) in zeilen:
        gelesen += 1
        stamm = klassifikator(form)
        nichtperiodisch = stamm not in PERIODISCHE_FORMEN
        if nichtperiodisch:
            gesamt += 1
        if weiche(stamm, nichtperiodisch):
            karte[stamm] += 1
    return gelesen, gesamt, dict(sorted(karte.items()))


def abgleich(fenster, gesamt, karte):
    """Same-run reconciliation. A deviation is an ABORT, never a note."""
    summe = sum(karte.values())
    if summe != gesamt:
        raise T173Fehler(
            "ABBRUCH abgleich [" + str(fenster) + "]: the broken-down sum "
            "does not match the total counter measured in THIS run. Vertrag "
            "gebrochen: sum(" + OUTPUT_FIELD + ") == " + TOTAL_FIELD
            + ". Soll " + str(gesamt) + ", Ist " + str(summe))
    return summe


def zaehle_fenster(datenwurzel, fenster, wall, basisname, **kwargs):
    pfad = os.path.join(datenwurzel, "panel", basisname)
    if os.path.basename(os.path.abspath(pfad)) != basisname:
        raise T173Fehler("Panel basename does not match the fixed window")
    verbindung = BRUECKE.COUNT.oeffne_nur_lesend(pfad, wall)
    try:
        zeilen = verbindung.execute("SELECT form FROM bericht")
        gelesen, gesamt, karte = zaehle_zeilen(zeilen, **kwargs)
    finally:
        verbindung.close()
    abgleich(fenster, gesamt, karte)
    return {
        "window": fenster,
        "file": basisname,
        "reportRowsRead": gelesen,
        TOTAL_FIELD: gesamt,
        OUTPUT_FIELD: karte,
        "reconciled": True,
    }


# -- synthetische Belege ------------------------------------------------------

def fixture(formen):
    verbindung = sqlite3.connect(":memory:")
    verbindung.execute("CREATE TABLE bericht (form TEXT)")
    verbindung.executemany(
        "INSERT INTO bericht (form) VALUES (?)", [(f,) for f in formen])
    return verbindung


ZWEI_FENSTER_FALL = {
    "entdeckung": ["10-K", "10-K", "10-Q", "8-K", "S-1"],
    "pruefung": ["10-K", "6-K", "6-K", "6-K/A", "8-K"],
}
ZWEI_FENSTER_SOLL = {
    "entdeckung": {"S-1": 1, "8-K": 1},
    "pruefung": {"6-K": 3, "8-K": 1},
}


def zwei_fenster_waechter(geteilte_karte=None):
    """Hermetic two-window case with different distributions per window.

    Broken on purpose by passing ONE shared counter: the second window then
    carries the first window's rows and the guard goes red.
    """
    beobachtet = {}
    summen = {}
    for name, formen in ZWEI_FENSTER_FALL.items():
        verbindung = fixture(formen)
        _gelesen, gesamt, karte = zaehle_zeilen(
            verbindung.execute("SELECT form FROM bericht"),
            karte=geteilte_karte)
        verbindung.close()
        beobachtet[name] = karte
        summen[name] = gesamt
    # Separation first: this guard exists to prove the maps stay apart, so a
    # shared pot must turn THIS red - not the reconciliation downstream of it.
    if beobachtet != ZWEI_FENSTER_SOLL:
        raise T173Fehler(
            "ABBRUCH zwei-fenster-waechter: the per-window maps ran into one "
            "pot. Soll " + json.dumps(ZWEI_FENSTER_SOLL, sort_keys=True)
            + ", Ist " + json.dumps(beobachtet, sort_keys=True))
    for name, karte in beobachtet.items():
        abgleich(name, summen[name], karte)
    return beobachtet


def leck_weiche(_stamm, _nichtperiodisch):
    """Sabotage: every row reaches the map, periodic ones included."""
    return True


def fehl_stamm(value):
    """Sabotage: 6-K is normalised onto a periodic stem."""
    stamm = str(value or "").upper().strip().split("/", 1)[0]
    return "10-K" if stamm == "6-K" else stamm


def belege(record):
    """All three proofs, each healthy AND deliberately broken.

    A guard whose red was never observed is not a proof (addendum proofRule).
    """
    zeilen = []

    def lauf(kennung, richtung, aufruf):
        try:
            aufruf()
        except T173Fehler as fehler:
            zeilen.append((kennung, richtung, "ROT", str(fehler)))
            return False
        zeilen.append((kennung, richtung, "GRUEN", "-"))
        return True

    ok = lauf("normalisierung", "intakt",
              lambda: normalisierungs_waechter(
                  FORM_STEM, PERIODISCHE_FORMEN, record))
    rot = not lauf("sabotage-fehlklassifikation", "gebrochen",
                   lambda: normalisierungs_waechter(
                       fehl_stamm, PERIODISCHE_FORMEN, record))

    ok &= lauf("zwei-fenster-waechter", "intakt", zwei_fenster_waechter)
    rot &= not lauf(
        "zwei-fenster-waechter", "gebrochen",
        lambda: zwei_fenster_waechter(geteilte_karte=collections.Counter()))

    def leck_intakt():
        verbindung = fixture(ZWEI_FENSTER_FALL["pruefung"])
        _g, gesamt, karte = zaehle_zeilen(
            verbindung.execute("SELECT form FROM bericht"))
        verbindung.close()
        abgleich("leck-probe", gesamt, karte)

    def leck_gebrochen():
        verbindung = fixture(ZWEI_FENSTER_FALL["pruefung"])
        _g, gesamt, karte = zaehle_zeilen(
            verbindung.execute("SELECT form FROM bericht"), weiche=leck_weiche)
        verbindung.close()
        abgleich("leck-probe", gesamt, karte)

    ok &= lauf("sabotage-leck", "intakt", leck_intakt)
    rot &= not lauf("sabotage-leck", "gebrochen", leck_gebrochen)

    if not ok:
        raise T173Fehler("ABBRUCH: an intact guard was red")
    if not rot:
        raise T173Fehler(
            "ABBRUCH: a deliberately broken guard stayed green - it is not a "
            "guard, it is decoration")
    return zeilen


def drucke_belege(zeilen):
    for kennung, richtung, ampel, text in zeilen:
        print("  [" + ampel + "] " + kennung + " (" + richtung + ")")
        if ampel == "ROT":
            print("        " + text)


# -- Lauf und Bericht ---------------------------------------------------------

def zeitstempel():
    jetzt = datetime.now(timezone.utc)
    return jetzt.strftime("%Y-%m-%dT%H:%M:%SZ")


def quervergleich(fenster):
    """Informational only: does this run reproduce the production counter?

    Not the reconciliation. The addendum binds that to the same-run counter;
    this reads a committed, already-disclosed number and reports agreement as
    a fact. A disagreement is reported, not swallowed - and not fatal, because
    a fatal check against a stored value is exactly what `sameRunOnly` forbids.
    """
    pfad = os.path.join(REPO, *ARTEFAKT_BERICHT_REL.split("/"))
    if not os.path.isfile(pfad):
        return {"available": False, "source": ARTEFAKT_BERICHT_REL}
    with open(pfad, "r", encoding="utf-8") as f:
        bericht = json.load(f)
    veroeffentlicht = (bericht.get("exclusions") or {}).get("byWindow") or {}
    zeilen = {}
    for f_ in fenster:
        soll = (veroeffentlicht.get(f_["window"]) or {}).get(TOTAL_FIELD)
        zeilen[f_["window"]] = {
            "published": soll,
            "measuredThisRun": f_[TOTAL_FIELD],
            "match": soll == f_[TOTAL_FIELD],
        }
    return {"available": True, "source": ARTEFAKT_BERICHT_REL,
            "binding": False, "byWindow": zeilen}


def lauf(datenwurzel, ziel_json, ziel_md):
    record = lies_addendum()
    print("T173 Belege (jeder Waechter einmal absichtlich gebrochen):")
    beleg_zeilen = belege(record)
    drucke_belege(beleg_zeilen)
    normalisierung = normalisierungs_waechter(
        FORM_STEM, PERIODISCHE_FORMEN, record)

    fenster = [zaehle_fenster(datenwurzel, name, wall, basisname)
               for name, wall, basisname in WINDOWS]

    ausgabe = {
        "schema": "t173-form-type-count/v1",
        "runId": "T173-formtyp-zaehlung-2026-08-29",
        "measuredAt": zeitstempel(),
        "addendum": {
            "path": ADDENDUM_REL,
            "sha256": ADDENDUM_SHA256,
            "authority": "ENTSCHIED 17 (Orchestrator-Direktiven 2026-08-29)",
            "accessLedgerEntryRequired": record["ledgerRelation"][
                "accessLedgerEntryRequired"],
        },
        "readColumns": ["bericht.form"],
        "normalization": normalisierung,
        "windows": fenster,
        "reconciliation": {
            "rule": "sum(" + OUTPUT_FIELD + ") == " + TOTAL_FIELD,
            "sameRunOnly": True,
            "result": {f["window"]: {
                "sum": sum(f[OUTPUT_FIELD].values()),
                "counter": f[TOTAL_FIELD],
                "match": sum(f[OUTPUT_FIELD].values()) == f[TOTAL_FIELD],
            } for f in fenster},
        },
        "crossCheckNonBinding": quervergleich(fenster),
        "proofs": [{"guard": k, "direction": r, "signal": a}
                   for k, r, a, _t in beleg_zeilen],
    }
    schreibe_json(ziel_json, ausgabe)
    schreibe_md(ziel_md, ausgabe)
    print("\nGeschrieben: " + os.path.relpath(ziel_json, REPO).replace("\\", "/"))
    print("Geschrieben: " + os.path.relpath(ziel_md, REPO).replace("\\", "/"))
    return ausgabe


def schreibe_json(pfad, ausgabe):
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    with open(pfad, "w", encoding="utf-8", newline="\n") as f:
        json.dump(ausgabe, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")


def schreibe_md(pfad, ausgabe):
    zeilen = [
        "# T173 - Formtyp-Zaehlung der periodenlosen Berichte",
        "",
        "Gemessen: " + ausgabe["measuredAt"] + " - Vertrag: `"
        + ADDENDUM_REL + "` SHA-256 `" + ADDENDUM_SHA256 + "`",
        "Autoritaet: " + ausgabe["addendum"]["authority"]
        + " - Zugriffs-Register: nicht erforderlich (`"
        + "accessLedgerEntryRequired: false`).",
        "Gelesen: ausschliesslich `bericht.form` in den festen Fenstern "
        "`entdeckung` und `pruefung`.",
        "",
        "## Zahlen",
        "",
    ]
    for f in ausgabe["windows"]:
        zeilen.append("### " + f["window"])
        zeilen.append("")
        zeilen.append("`" + TOTAL_FIELD + "` = " + str(f[TOTAL_FIELD])
                      + " von " + str(f["reportRowsRead"]) + " gelesenen "
                      "Berichtszeilen.")
        zeilen.append("")
        zeilen.append("| form_stem | Anzahl |")
        zeilen.append("| --------- | -----: |")
        for stamm, anzahl in f[OUTPUT_FIELD].items():
            zeilen.append("| `" + (stamm or "(leer)") + "` | " + str(anzahl)
                          + " |")
        zeilen.append("")
        if f[OUTPUT_FIELD]:
            # Die einzige Aussage neben den Zahlen: welcher Formtyp die
            # Zaehlung traegt. Abgelesen, nicht gedeutet.
            spitze = max(f[OUTPUT_FIELD].items(), key=lambda p: (p[1], p[0]))
            anteil = 100.0 * spitze[1] / f[TOTAL_FIELD]
            zeilen.append("Groesster Posten: `" + spitze[0] + "` mit "
                          + str(spitze[1]) + " von " + str(f[TOTAL_FIELD])
                          + " (" + ("%.1f" % anteil) + " %).")
            zeilen.append("")
    zeilen += ["## Summenabgleich (selber Lauf)", "",
               "| Fenster | Summe Karte | " + TOTAL_FIELD + " | gleich |",
               "| ------- | ----------: | ---------------------------: "
               "| ------ |"]
    for name, wert in sorted(ausgabe["reconciliation"]["result"].items()):
        zeilen.append("| " + name + " | " + str(wert["sum"]) + " | "
                      + str(wert["counter"]) + " | "
                      + ("ja" if wert["match"] else "NEIN") + " |")
    quer = ausgabe["crossCheckNonBinding"]
    if quer.get("available"):
        zeilen += ["", "## Quervergleich (NICHT bindend, nur zur Kenntnis)", "",
                   "Gegen den bereits veroeffentlichten Gesamtzaehler aus `"
                   + quer["source"] + "`. Der bindende Abgleich ist der "
                   "Summenabgleich oben (`sameRunOnly`).", "",
                   "| Fenster | veroeffentlicht | dieser Lauf | gleich |",
                   "| ------- | --------------: | ----------: | ------ |"]
        for name, wert in sorted(quer["byWindow"].items()):
            zeilen.append("| " + name + " | " + str(wert["published"]) + " | "
                          + str(wert["measuredThisRun"]) + " | "
                          + ("ja" if wert["match"] else "NEIN") + " |")
    zeilen += ["", "## Belege", "",
               "| Waechter | Richtung | Ampel |",
               "| -------- | -------- | ----- |"]
    for beleg in ausgabe["proofs"]:
        zeilen.append("| " + beleg["guard"] + " | " + beleg["direction"]
                      + " | " + beleg["signal"] + " |")
    zeilen += [
        "",
        "## Neue Fragen und Hypothesen",
        "",
        "Dieser Lauf ist eine Zaehlung, keine Analyse. Er benennt, welcher "
        "Formtyp die nichtperiodische Zaehlung je Fenster traegt, und sonst "
        "nichts. Was er ausdruecklich NICHT beantwortet, bleibt offen:",
        "",
        "- Warum die Formtyp-Zusammensetzung zwischen den beiden Fenstern "
        "abweicht. Die Verteilung wird hier weder gedeutet noch auf eine "
        "Ursache zurueckgefuehrt (Addendum, `explicitNonClaims`).",
        "- Ob ein gezaehlter Ausschluss inhaltlich richtig war. Der Lauf "
        "prueft die Ausschlussregel nicht, er schluesselt ihr Ergebnis auf.",
        "- Was die Zusammensetzung fuer die Fakt-Ebene bedeutet. Die Tabelle "
        "`fakt` wurde nicht gelesen; Berichte je Formtyp sind nicht Fakten je "
        "Formtyp.",
        "- Ob die Arbeitshypothese aus der Inbox (hoeherer Anteil "
        "auslaendischer Einreicher) traegt. Sie wird hier weder bestaetigt "
        "noch verworfen - dazu braeuchte es Groessen, die dieser Vertrag "
        "nicht freigibt.",
        "",
        "Keine Deutung ueber die Zahlen hinaus. Keine Schwelle, kein Gate und "
        "keine Entscheidungsregel wurde beruehrt.",
        "",
    ]
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    with open(pfad, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(zeilen))


def selbsttest():
    record = lies_addendum()
    print("T173 Selbsttest - Addendum " + ADDENDUM_SHA256[:12] + " gepinnt")
    zeilen = belege(record)
    drucke_belege(zeilen)
    normalisierungs_waechter(FORM_STEM, PERIODISCHE_FORMEN, record)
    print("T173 Selbsttest: 3 Waechter, je intakt gruen und gebrochen rot.")
    return 0


def haupt(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--selbsttest", action="store_true",
                   help="Die drei Belege, je intakt und absichtlich gebrochen")
    p.add_argument("--data-root",
                   help="Wurzel mit panel/ (kein fest verdrahteter Pfad, R12a)")
    p.add_argument("--json", help="Zieldatei fuer die Zahlen")
    p.add_argument("--md", help="Zieldatei fuer den Kurzbericht")
    a = p.parse_args(argv)
    if a.selbsttest:
        return selbsttest()
    wurzel = a.data_root or os.environ.get("EARLY_DETECTION_DATA_ROOT")
    if not wurzel:
        raise T173Fehler(
            "Speicherort unbekannt: --data-root oder "
            "EARLY_DETECTION_DATA_ROOT setzen (R12a verbietet einen fest "
            "verdrahteten Pfad)")
    ziel = os.path.join(REPO, "reports", "studie")
    lauf(wurzel,
         a.json or os.path.join(ziel, "T173-formtyp-zaehlung-2026-08-29.json"),
         a.md or os.path.join(ziel, "T173-formtyp-zaehlung-2026-08-29.md"))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(haupt())
    except T173Fehler as fehler:
        print(str(fehler), file=sys.stderr)
        sys.exit(2)
