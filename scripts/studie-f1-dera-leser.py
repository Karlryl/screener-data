#!/usr/bin/env python3
"""Studie 2.0 / F1 — der DERA-`num.txt`-Leser der verbreiterten Konzeptschicht.

WAS HIER GEBAUT WIRD
--------------------
Ein Leser fuer die `num.txt` der SEC Financial Statement Data Sets, der die drei
Fallen kennt, die die Nacht vom 30.08. gemessen hat, und darueber einen
Konzept-Zensus: je Payload und je Kennung die Zahl der Quartalszeilen — einmal
roh, einmal konsolidiert.

DIE DREI FALLEN, JEDE MIT IHRER AUFLAGE
---------------------------------------
1. **Spaltenzahl** (A3). Der archivierte Jahrgang hat 9 Spalten
   (`adsh tag version coreg ddate qtrs uom value footnote`), die heutige
   Neuveroeffentlichung 10 (`adsh tag version ddate qtrs uom segments coreg
   value footnote`) — andere MENGE und andere REIHENFOLGE. Ein Leser, der nach
   Position schneidet, liefert am jeweils anderen Jahrgang plausible falsche
   Zahlen ohne jede Ausnahme. Hier wird ausschliesslich nach SPALTENNAME aus der
   Kopfzeile geschnitten; ein unbekannter Spaltensatz ist ein harter Abbruch.
2. **Dimensionszeilen** (A4). Ohne Filter auf `segments=''` UND `coreg=''` zaehlt
   man Segment- und Tochter-Zeilen als Konzernzeilen — gemessen bei
   `RevenueFromContractWithCustomerExcludingAssessedTax` 2020q4: 55.184 Zeilen
   statt 4.867, Faktor 11,3. Der Filter ist hier ein ZAEHLER: beide Zahlen
   werden berichtet, die verworfenen Zeilen gezaehlt, und drei Waechter halten
   ihn scharf (siehe unten).
3. **Namensraum** (A5, K9-Restschluss §3). DERA schreibt die IFRS-Taxonomie als
   `version = "ifrs/JJJJ"`; `companyfacts` nennt dieselbe Taxonomie `ifrs-full`.
   Wer die Konzeptliste 1:1 aus `companyfacts`-Namen baut, verliert den
   IFRS-Zweig lautlos. Die Abbildung `ifrs-full -> ifrs` steht deshalb explizit
   im Code. Dazu die gemessene Deckungsgrenze: vor `IFRS_AB_QUARTAL` traegt
   `num.txt` NULL `ifrs`-Zeilen — eine Null dort ist Abwesenheit der Quelle, nie
   Abwesenheit der Firma, und wird als solche ausgewiesen (W9).

DIE WAECHTER DES DIMENSIONSFILTERS (A4, A17)
--------------------------------------------
* **W-A4-a** Nach dem Filter darf keine Zeile mit nichtleerem `segments` oder
  `coreg` uebrig sein. Bruchprobe: Filter abschalten -> muss rot.
* **W-A4-b** Auf einem 10-Spalten-Payload MUSS der Filter feuern (mindestens
  eine verworfene Zeile ueber alle Kennungen). Ein Filter, der nie greift, ist
  in Wahrheit ein Leser, der die falsche Spalte liest.
* **W-A4-c** Ein Verhaeltnis roh/konsolidiert oberhalb `--max-verhaeltnis`
  bricht ab. Der Deckel ist eine Groessenordnungs-Schranke, kein Messwert.

Der Naturschluessel einer Faktenzeile traegt `segments` (A4, S3): ohne ihn
kollidieren Dimensionszeilen auf dem Schluessel und ein `INSERT OR IGNORE`
behaelt eine beliebige davon — das Panel fuehrte dann still einen Segmentwert in
der Rolle des Konzernwerts.

LEGACY-SONDERFALL, OFFEN PROTOKOLLIERT (A4)
-------------------------------------------
Der archivierte Jahrgang kennt keine `segments`-Spalte; dort ist `coreg` die
einzige Trennung. Die beiden Jahrgaenge sind auf dieser Achse NICHT vergleichbar.
Der Zensus weist das je Payload aus (`dimensionsAchse`), statt es zu glaetten.

Aufruf:
  python scripts/studie-f1-dera-leser.py zensus --data-root <wurzel> \\
      --konzepte <liste.json> --von 2009q1 --bis 2020q4 --bericht <ziel.json>
  python scripts/studie-f1-dera-leser.py kopfzeilen --data-root <wurzel>
  python scripts/studie-f1-dera-leser.py --selbsttest
"""

import argparse
import hashlib
import io
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

DATENWURZEL_ENV = "EARLY_DETECTION_DATA_ROOT"
SCHEMA = "studie-f1-dera-zensus/v1"
QUARTAL_RE = re.compile(r"^(\d{4})q([1-4])$")
LETZTES_OFFENES_QUARTAL = "2020q4"

# Die beiden bekannten Spaltensaetze. Geprueft wird die MENGE (als sortiertes
# Tupel), geschnitten wird nach NAME — die Reihenfolge in der Datei ist damit
# egal, und ein umbenannter Kopf faellt trotzdem auf.
NUM_SATZ_LEGACY = ("adsh", "coreg", "ddate", "footnote", "qtrs", "tag", "uom",
                   "value", "version")
NUM_SATZ_HEUTE = ("adsh", "coreg", "ddate", "footnote", "qtrs", "segments",
                  "tag", "uom", "value", "version")
BEKANNTE_NUM_SAETZE = {
    NUM_SATZ_LEGACY: "legacy_9",
    NUM_SATZ_HEUTE: "aktuell_10",
}
# Ohne diese Spalten kann der Zensus nicht rechnen. Fehlt eine, bricht er ab.
NUM_PFLICHT = ("adsh", "tag", "version", "ddate", "qtrs", "uom", "value")
# Der Naturschluessel MIT segments (A4). `segments` fehlt im Alt-Jahrgang und
# wird dort als leer gefuehrt — das ist der offen protokollierte Sonderfall.
FAKT_SCHLUESSEL = ("adsh", "tag", "version", "ddate", "qtrs", "uom", "segments", "coreg")

# Namensraum-Abbildung: links, wie `companyfacts` die Taxonomie nennt; rechts das
# Praefix, das DERA in `num.txt.version` schreibt. Ohne diese Zeile faellt der
# IFRS-Zweig geraeuschlos aus (K9-Restschluss §3, live in die Falle getappt).
NAMENSRAUM = {
    "us-gaap": "us-gaap",
    "ifrs-full": "ifrs",
    "ifrs": "ifrs",
}
# Gemessene Deckungsgrenze: 2015q3 und 2017q1 tragen NULL ifrs-Zeilen, 2018q3 und
# 2020q4 tragen welche (k9-restschluss §4). Die Grenze liegt zwischen 2017q2 und
# 2018q3; konservativ auf den ersten belegten Jahrgang gesetzt.
IFRS_AB_QUARTAL = "2018q1"
MAX_VERHAELTNIS_STD = 100.0


class LeseFehler(Exception):
    """Ein Befund, der den Lauf anhaelt — nie ein stiller Fallback."""


def quartal_schluessel(wert):
    treffer = QUARTAL_RE.match(str(wert).lower())
    if treffer is None:
        raise LeseFehler("Kein gueltiges Quartal: " + repr(wert))
    return int(treffer.group(1)) * 4 + int(treffer.group(2)) - 1


def datenwurzel(vorgabe=None):
    wert = vorgabe or os.environ.get(DATENWURZEL_ENV)
    if not wert:
        raise LeseFehler("Speicherort unbekannt: " + DATENWURZEL_ENV + " ist nicht gesetzt "
                         "(R12a verbietet einen fest verdrahteten Pfad)")
    return Path(wert)


# -- A3: Kopfzeile lesen, nach Namen schneiden --------------------------------

def spaltenplan(kopfzeile):
    """Kopfzeile -> {Spaltenname: Position}. Unbekannter Satz = harter Abbruch."""
    namen = [s.strip() for s in kopfzeile.rstrip("\r\n").split("\t")]
    if len(set(namen)) != len(namen):
        raise LeseFehler("num.txt-Kopfzeile hat doppelte Spaltennamen: " + repr(namen))
    satz = tuple(sorted(namen))
    variante = BEKANNTE_NUM_SAETZE.get(satz)
    if variante is None:
        raise LeseFehler(
            "num.txt hat einen unbekannten Spaltensatz: " + repr(namen)
            + " — bekannt sind nur " + repr(sorted(BEKANNTE_NUM_SAETZE.values()))
            + " (A3: fail-closed statt raten)")
    fehlend = [s for s in NUM_PFLICHT if s not in namen]
    if fehlend:
        raise LeseFehler("num.txt fehlen Pflichtspalten: " + repr(fehlend))
    return {name: i for i, name in enumerate(namen)}, variante, namen


def feld(felder, plan, name):
    """Spaltenwert nach NAME. Fehlt die Spalte im Jahrgang, gilt sie als leer."""
    i = plan.get(name)
    if i is None:
        return ""
    return felder[i] if i < len(felder) else ""


def ist_dimensionszeile(felder, plan):
    """A4: konsolidiert heisst `segments` leer UND `coreg` leer."""
    return bool(feld(felder, plan, "segments").strip()) or \
        bool(feld(felder, plan, "coreg").strip())


# -- Payload-Auswahl ----------------------------------------------------------

def payloads_der_wurzel(wurzel, jahrgang, von, bis):
    """Die abgelegten Beobachtungen im Fenster — aus dem Speicher, nicht aus dem Netz."""
    wurzel = Path(wurzel)
    beobachtungen = wurzel / "observations" / "sec-fsd"
    if not beobachtungen.is_dir():
        raise LeseFehler("Kein Beobachtungs-Verzeichnis: " + str(beobachtungen))
    grenze = quartal_schluessel(LETZTES_OFFENES_QUARTAL)
    if quartal_schluessel(bis) > grenze:
        raise LeseFehler("Quartal " + bis + " liegt hinter " + LETZTES_OFFENES_QUARTAL
                         + " — das Endtest-Fenster ist versiegelt")
    treffer = {}
    for pfad in sorted(beobachtungen.rglob("*.json")):
        eintrag = json.loads(pfad.read_text(encoding="utf-8-sig"))
        if jahrgang and eintrag.get("datasetVariant") != jahrgang:
            continue
        quartal = eintrag.get("quarter")
        if not quartal:
            continue
        schluessel = quartal_schluessel(quartal)
        if not (quartal_schluessel(von) <= schluessel <= grenze):
            continue
        if schluessel > quartal_schluessel(bis):
            continue
        blob = wurzel / eintrag["payloadPath"]
        if not blob.exists():
            raise LeseFehler("Beobachtung ohne Blob: " + str(pfad))
        treffer[(quartal, eintrag["payloadSha256"])] = blob
    if not treffer:
        raise LeseFehler("Kein Payload im Fenster " + von + ".." + bis
                         + " fuer Jahrgang " + repr(jahrgang))
    return [(q, s, p) for (q, s), p in sorted(treffer.items())]


# -- Konzeptliste -------------------------------------------------------------

def normiere_konzepte(konzepte):
    """[{taxonomy, concept}] -> {(dera_praefix, tag): Anzeigename}."""
    abbildung = {}
    for eintrag in konzepte:
        taxonomie = str(eintrag["taxonomy"]).strip()
        tag = str(eintrag["concept"]).strip()
        praefix = NAMENSRAUM.get(taxonomie)
        if praefix is None:
            raise LeseFehler("Unbekannte Taxonomie in der Konzeptliste: " + repr(taxonomie)
                             + " — bekannt: " + repr(sorted(NAMENSRAUM)))
        abbildung[(praefix, tag)] = taxonomie + ":" + tag
    if not abbildung:
        raise LeseFehler("Leere Konzeptliste")
    return abbildung


def version_praefix(wert):
    return str(wert).split("/", 1)[0].strip()


# -- Der Zensus ---------------------------------------------------------------

def zensus_payload(blob, abbildung, max_verhaeltnis):
    """Ein Payload -> Zeilenzahlen je Kennung, roh und konsolidiert."""
    roh = {}
    konsolidiert = {}
    schluessel_konsolidiert = {}
    verworfen_gesamt = 0
    zeilen_gesamt = 0
    ueberlebende_dimensionszeile = None
    with zipfile.ZipFile(blob) as z:
        namen = {n.lower(): n for n in z.namelist()}
        if "num.txt" not in namen:
            raise LeseFehler("Payload ohne num.txt: " + str(blob))
        with z.open(namen["num.txt"]) as fh:
            text = io.TextIOWrapper(fh, encoding="utf-8", errors="replace", newline="")
            kopfzeile = text.readline()
            if not kopfzeile:
                raise LeseFehler("num.txt ist leer: " + str(blob))
            plan, variante, kopf_namen = spaltenplan(kopfzeile)
            for zeile in text:
                if not zeile.strip():
                    continue
                zeilen_gesamt += 1
                felder = zeile.rstrip("\r\n").split("\t")
                if feld(felder, plan, "qtrs").strip() != "1":
                    continue
                schluessel = (version_praefix(feld(felder, plan, "version")),
                              feld(felder, plan, "tag").strip())
                name = abbildung.get(schluessel)
                if name is None:
                    continue
                roh[name] = roh.get(name, 0) + 1
                if ist_dimensionszeile(felder, plan):
                    verworfen_gesamt += 1
                    continue
                # W-A4-a: was hier ankommt, MUSS konsolidiert sein.
                if feld(felder, plan, "segments").strip() or feld(felder, plan, "coreg").strip():
                    ueberlebende_dimensionszeile = zeile[:200]
                konsolidiert[name] = konsolidiert.get(name, 0) + 1
                schluessel_konsolidiert.setdefault(name, set()).add(
                    tuple(feld(felder, plan, s) for s in FAKT_SCHLUESSEL))
    if ueberlebende_dimensionszeile is not None:
        raise LeseFehler("W-A4-a gerissen: eine Dimensionszeile hat den Filter ueberlebt: "
                         + repr(ueberlebende_dimensionszeile))
    if variante == "aktuell_10" and roh and verworfen_gesamt == 0:
        raise LeseFehler(
            "W-A4-b gerissen: auf einem 10-Spalten-Payload hat der Dimensionsfilter "
            "keine einzige Zeile verworfen — das ist der Fingerabdruck eines Lesers, "
            "der die falsche Spalte liest (" + str(blob) + ")")
    je_kennung = {}
    for name in sorted(set(roh) | set(konsolidiert)):
        r = roh.get(name, 0)
        k = konsolidiert.get(name, 0)
        verhaeltnis = (r / k) if k else None
        if verhaeltnis is not None and verhaeltnis > max_verhaeltnis:
            raise LeseFehler(
                "W-A4-c gerissen: " + name + " hat ein Verhaeltnis roh/konsolidiert von "
                + format(verhaeltnis, ".1f") + " > " + str(max_verhaeltnis))
        je_kennung[name] = {
            "zeilenRoh": r,
            "zeilenKonsolidiert": k,
            "zeilenVerworfen": r - k,
            "verhaeltnisRohKonsolidiert": (round(verhaeltnis, 4)
                                           if verhaeltnis is not None else None),
            "naturschluesselKonsolidiert": len(schluessel_konsolidiert.get(name, ())),
            "dublettenKonsolidiert": k - len(schluessel_konsolidiert.get(name, ())),
        }
    return {
        "kopfzeile": kopf_namen,
        "spaltensatz": variante,
        "dimensionsAchse": ("segments+coreg" if variante == "aktuell_10"
                            else "nur coreg (Alt-Jahrgang ohne segments-Spalte, "
                                 "auf dieser Achse NICHT mit dem heutigen vergleichbar)"),
        "zeilenGesamt": zeilen_gesamt,
        "dimensionszeilenVerworfen": verworfen_gesamt,
        "jeKennung": je_kennung,
    }


def zensus(wurzel, jahrgang, von, bis, konzepte, max_verhaeltnis):
    abbildung = normiere_konzepte(konzepte)
    payloads = payloads_der_wurzel(wurzel, jahrgang, von, bis)
    je_payload = []
    summe = {}
    for quartal, sha, blob in payloads:
        ergebnis = zensus_payload(blob, abbildung, max_verhaeltnis)
        ergebnis.update(quartal=quartal, payloadSha256=sha, jahrgang=jahrgang)
        je_payload.append(ergebnis)
        for name, zahlen in ergebnis["jeKennung"].items():
            eintrag = summe.setdefault(name, {"zeilenRoh": 0, "zeilenKonsolidiert": 0,
                                              "zeilenVerworfen": 0, "quartaleMitZeilen": 0})
            eintrag["zeilenRoh"] += zahlen["zeilenRoh"]
            eintrag["zeilenKonsolidiert"] += zahlen["zeilenKonsolidiert"]
            eintrag["zeilenVerworfen"] += zahlen["zeilenVerworfen"]
            if zahlen["zeilenKonsolidiert"]:
                eintrag["quartaleMitZeilen"] += 1
    # W9 (A13): Kennungen ohne Zeilen bekommen ihre Achsenliste, statt als
    # „traegt DERA nicht" zu gelten.
    fehlend = []
    for (praefix, tag), name in sorted(abbildung.items(), key=lambda kv: kv[1]):
        if summe.get(name, {}).get("zeilenKonsolidiert"):
            continue
        achsen = {
            "namensraum": {"status": "gemessen",
                           "wert": praefix + "/ (companyfacts nennt dieselbe Taxonomie "
                                   + ("ifrs-full" if praefix == "ifrs" else praefix) + ")"},
            "datum": {"status": "gemessen", "wert": von + ".." + bis},
            "qtrsKlassifikation": {"status": "gemessen", "wert": "qtrs=1"},
            "segmentsCoreg": {"status": "gemessen", "wert": "segments='' und coreg=''"},
            "form": {"status": "ungemessen",
                     "wert": "Formtyp nicht eingeschraenkt; sub.txt wird hier nicht gelesen"},
            "waisenVerwerfung": {"status": "ungemessen",
                                 "wert": "Waisen werden im Zensus nicht aufgeloest"},
            "dublettenRegel": {"status": "gemessen",
                               "wert": "Naturschluessel " + "+".join(FAKT_SCHLUESSEL)},
        }
        if praefix == "ifrs" and quartal_schluessel(bis) < quartal_schluessel(IFRS_AB_QUARTAL):
            achsen["ifrsDeckung"] = {
                "status": "gemessen",
                "wert": "Fenster endet vor " + IFRS_AB_QUARTAL
                        + " — DERA traegt dort NULL ifrs-Zeilen (k9-restschluss §4). "
                          "Die Null ist Abwesenheit der QUELLE, nicht der Firma."}
        fehlend.append({"kennung": name, "gepruefteAchsen": achsen})
    return {
        "schema": SCHEMA,
        "erzeugt": datetime.now(timezone.utc).isoformat(timespec="milliseconds")
                   .replace("+00:00", "Z"),
        "dataRoot": str(Path(wurzel).resolve()),
        "jahrgang": jahrgang,
        "fenster": {"von": von, "bis": bis, "siegelGrenze": LETZTES_OFFENES_QUARTAL},
        "payloads": len(je_payload),
        "maxVerhaeltnis": max_verhaeltnis,
        "naturschluessel": list(FAKT_SCHLUESSEL),
        "namensraumAbbildung": NAMENSRAUM,
        "ifrsAbQuartal": IFRS_AB_QUARTAL,
        "summeJeKennung": {k: summe[k] for k in sorted(summe)},
        "ohneZeilen": fehlend,
        "jePayload": je_payload,
    }


# -- Selbsttest ---------------------------------------------------------------

def _zip_mit_num(pfad, kopf, zeilen):
    with zipfile.ZipFile(pfad, "w") as z:
        z.writestr("num.txt", "\t".join(kopf) + "\n"
                   + "".join("\t".join(r) + "\n" for r in zeilen))
        z.writestr("sub.txt", "adsh\n")
    return pfad


def selbsttest():
    import tempfile

    ergebnisse = []

    def pruefe(name, bedingung):
        ergebnisse.append((name, bool(bedingung)))

    KOPF9 = ["adsh", "tag", "version", "coreg", "ddate", "qtrs", "uom", "value", "footnote"]
    KOPF10 = ["adsh", "tag", "version", "ddate", "qtrs", "uom", "segments", "coreg",
              "value", "footnote"]

    # A3: beide bekannten Koepfe muessen sauber parsen ...
    plan9, var9, _ = spaltenplan("\t".join(KOPF9) + "\n")
    plan10, var10, _ = spaltenplan("\t".join(KOPF10) + "\n")
    pruefe("9-Spalten-Kopf parst", var9 == "legacy_9" and plan9["value"] == 7)
    pruefe("10-Spalten-Kopf parst", var10 == "aktuell_10" and plan10["value"] == 8)
    pruefe("nach Namen geschnitten, nicht nach Position",
           plan9["coreg"] == 3 and plan10["coreg"] == 7)

    # ... und ein umbenannter Kopf muss ROT werden.
    for kaputt, warum in (
        (KOPF10[:6] + ["segment"] + KOPF10[7:], "umbenannte Spalte"),
        (KOPF10 + ["extra"], "zusaetzliche Spalte"),
        (KOPF10[:-1], "fehlende Spalte"),
        (["adsh", "adsh"] + KOPF10[2:], "doppelte Spalte"),
    ):
        try:
            spaltenplan("\t".join(kaputt) + "\n")
            pruefe("fremder Kopf fliegt auf (" + warum + ")", False)
        except LeseFehler:
            pruefe("fremder Kopf fliegt auf (" + warum + ")", True)

    # Namensraum: ifrs-full aus companyfacts trifft ifrs in DERA.
    abb = normiere_konzepte([{"taxonomy": "ifrs-full", "concept": "Revenue"},
                             {"taxonomy": "us-gaap", "concept": "Revenues"}])
    pruefe("ifrs-full wird auf ifrs abgebildet", ("ifrs", "Revenue") in abb)
    pruefe("Anzeigename behaelt die companyfacts-Schreibweise",
           abb[("ifrs", "Revenue")] == "ifrs-full:Revenue")
    try:
        normiere_konzepte([{"taxonomy": "ifrsfull", "concept": "Revenue"}])
        pruefe("unbekannte Taxonomie bricht ab", False)
    except LeseFehler:
        pruefe("unbekannte Taxonomie bricht ab", True)
    pruefe("version-Praefix wird abgeschnitten", version_praefix("ifrs/2019") == "ifrs")

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        konzepte = [{"taxonomy": "us-gaap", "concept": "Revenues"}]
        abb = normiere_konzepte(konzepte)

        # A4: 3 Dimensionszeilen, 2 Konzernzeilen -> Verhaeltnis 5/2.
        zeilen10 = [
            ["a1", "Revenues", "us-gaap/2020", "20200930", "1", "USD", "", "", "10", ""],
            ["a2", "Revenues", "us-gaap/2020", "20200930", "1", "USD", "", "", "20", ""],
            ["a3", "Revenues", "us-gaap/2020", "20200930", "1", "USD", "Seg=Nord", "", "30", ""],
            ["a4", "Revenues", "us-gaap/2020", "20200930", "1", "USD", "", "TOCHTER", "40", ""],
            ["a5", "Revenues", "us-gaap/2020", "20200930", "1", "USD", "Seg=Sued", "T2", "50", ""],
            ["a6", "Revenues", "us-gaap/2020", "20200930", "4", "USD", "", "", "60", ""],
        ]
        blob = _zip_mit_num(tmp / "heute.zip", KOPF10, zeilen10)
        ergebnis = zensus_payload(blob, abb, MAX_VERHAELTNIS_STD)
        zahlen = ergebnis["jeKennung"]["us-gaap:Revenues"]
        pruefe("Dimensionsfilter zaehlt beide Seiten",
               zahlen["zeilenRoh"] == 5 and zahlen["zeilenKonsolidiert"] == 2
               and zahlen["zeilenVerworfen"] == 3)
        pruefe("qtrs!=1 zaehlt nicht mit", zahlen["zeilenRoh"] == 5)
        pruefe("coreg allein genuegt als Dimensionsgrund", zahlen["zeilenKonsolidiert"] == 2)

        # W-A4-c: der Deckel muss reissen koennen.
        try:
            zensus_payload(blob, abb, 2.0)
            pruefe("W-A4-c reisst bei zu hohem Verhaeltnis", False)
        except LeseFehler as exc:
            pruefe("W-A4-c reisst bei zu hohem Verhaeltnis", "W-A4-c" in str(exc))

        # W-A4-b: 10-Spalten-Payload ohne eine einzige verworfene Zeile ist der
        # Fingerabdruck eines Lesers, der die falsche Spalte liest.
        blob_ohne = _zip_mit_num(tmp / "ohne-dimensionen.zip", KOPF10, zeilen10[:2])
        try:
            zensus_payload(blob_ohne, abb, MAX_VERHAELTNIS_STD)
            pruefe("W-A4-b reisst, wenn der Filter nie feuert", False)
        except LeseFehler as exc:
            pruefe("W-A4-b reisst, wenn der Filter nie feuert", "W-A4-b" in str(exc))

        # W-A4-a absichtlich brechen: der Filter wird abgeschaltet, die Zeilen
        # laufen unveraendert durch — der Waechter MUSS das sehen. Ohne diese
        # Probe waere er nur eine Zeile, die nie ausgeloest hat.
        global ist_dimensionszeile
        echt = ist_dimensionszeile
        try:
            ist_dimensionszeile = lambda felder, plan: False
            zensus_payload(blob, abb, MAX_VERHAELTNIS_STD)
            pruefe("W-A4-a reisst bei abgeschaltetem Filter", False)
        except LeseFehler as exc:
            pruefe("W-A4-a reisst bei abgeschaltetem Filter", "W-A4-a" in str(exc))
        finally:
            ist_dimensionszeile = echt
        pruefe("W-A4-a bleibt bei eingeschaltetem Filter gruen",
               zensus_payload(blob, abb, MAX_VERHAELTNIS_STD)["jeKennung"]
               ["us-gaap:Revenues"]["zeilenKonsolidiert"] == 2)

        # Gegenprobe zum Alt-Jahrgang: 9 Spalten, keine segments-Spalte, coreg
        # traegt die Trennung allein — und W-A4-b darf dort NICHT feuern.
        zeilen9 = [
            ["a1", "Revenues", "us-gaap/2015", "", "20150630", "1", "USD", "10", ""],
            ["a2", "Revenues", "us-gaap/2015", "TOCHTER", "20150630", "1", "USD", "20", ""],
        ]
        blob9 = _zip_mit_num(tmp / "alt.zip", KOPF9, zeilen9)
        alt = zensus_payload(blob9, abb, MAX_VERHAELTNIS_STD)
        pruefe("Alt-Jahrgang wird ohne segments-Spalte gelesen",
               alt["jeKennung"]["us-gaap:Revenues"]["zeilenKonsolidiert"] == 1
               and alt["spaltensatz"] == "legacy_9")
        pruefe("Alt-Jahrgang weist die unvergleichbare Achse aus",
               "NICHT mit dem heutigen vergleichbar" in alt["dimensionsAchse"])
        blob9_leer = _zip_mit_num(tmp / "alt-ohne.zip", KOPF9, zeilen9[:1])
        pruefe("W-A4-b feuert im Alt-Jahrgang nicht",
               zensus_payload(blob9_leer, abb, MAX_VERHAELTNIS_STD)
               ["dimensionszeilenVerworfen"] == 0)

        # Naturschluessel MIT segments: zwei Dimensionszeilen desselben Konzerns
        # duerfen nicht auf einen Schluessel fallen. Gegenprobe ohne den Filter:
        # der Schluessel ohne `segments` traegt 1 statt 2 Eintraege.
        felder_a = ["a3", "Revenues", "us-gaap/2020", "20200930", "1", "USD", "Seg=Nord", "", "30", ""]
        felder_b = ["a3", "Revenues", "us-gaap/2020", "20200930", "1", "USD", "Seg=Sued", "", "31", ""]
        mit = {tuple(feld(f, plan10, s) for s in FAKT_SCHLUESSEL) for f in (felder_a, felder_b)}
        ohne = {tuple(feld(f, plan10, s) for s in FAKT_SCHLUESSEL if s != "segments")
                for f in (felder_a, felder_b)}
        pruefe("Naturschluessel mit segments trennt Dimensionszeilen", len(mit) == 2)
        pruefe("Naturschluessel ohne segments wuerde sie kollidieren lassen", len(ohne) == 1)

    for name, ok in ergebnisse:
        print(("PASS  " if ok else "FAIL  ") + name)
    schlecht = [n for n, ok in ergebnisse if not ok]
    print("\n" + str(len(ergebnisse) - len(schlecht)) + "/" + str(len(ergebnisse))
          + " Pruefungen bestanden")
    return 0 if not schlecht else 1


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("befehl", nargs="?", choices=("zensus", "kopfzeilen"))
    p.add_argument("--data-root")
    p.add_argument("--jahrgang", default="legacy_earliest_archived")
    p.add_argument("--von", default="2009q1")
    p.add_argument("--bis", default=LETZTES_OFFENES_QUARTAL)
    p.add_argument("--konzepte", help="JSON-Liste [{taxonomy, concept}, ...]")
    p.add_argument("--max-verhaeltnis", type=float, default=MAX_VERHAELTNIS_STD)
    p.add_argument("--bericht")
    p.add_argument("--selbsttest", action="store_true")
    args = p.parse_args()

    if args.selbsttest:
        return selbsttest()
    if not args.befehl:
        p.error("Befehl fehlt (zensus | kopfzeilen) — oder --selbsttest")

    try:
        wurzel = datenwurzel(args.data_root)
        if args.befehl == "kopfzeilen":
            zeilen = []
            for quartal, sha, blob in payloads_der_wurzel(
                    wurzel, args.jahrgang, args.von, args.bis):
                with zipfile.ZipFile(blob) as z:
                    namen = {n.lower(): n for n in z.namelist()}
                    with z.open(namen["num.txt"]) as fh:
                        kopf = io.TextIOWrapper(fh, encoding="utf-8", errors="replace").readline()
                plan, variante, felder = spaltenplan(kopf)
                zeilen.append({"quartal": quartal, "payloadSha256": sha,
                               "spaltensatz": variante, "kopfzeile": felder})
            bericht = {"schema": "studie-f1-dera-kopfzeilen/v1", "payloads": len(zeilen),
                       "zeilen": zeilen}
        else:
            if not args.konzepte:
                p.error("zensus braucht --konzepte")
            roh = json.loads(Path(args.konzepte).read_text(encoding="utf-8-sig"))
            if isinstance(roh, list):
                konzepte = roh
            else:
                # Der Regel-Bericht heisst sein Feld `konzeptliste`; eine reine
                # Konzeptdatei `konzepte`. Beides lesen, nichts raten.
                konzepte = roh.get("konzepte") or roh.get("konzeptliste")
                if konzepte is None:
                    raise LeseFehler("Konzeptdatei ohne Feld 'konzepte' oder 'konzeptliste': "
                                     + args.konzepte)
            bericht = zensus(wurzel, args.jahrgang, args.von, args.bis, konzepte,
                             args.max_verhaeltnis)
    except LeseFehler as exc:
        print("ABBRUCH: " + str(exc), file=sys.stderr)
        return 2

    if args.bericht:
        ziel = Path(args.bericht)
        ziel.parent.mkdir(parents=True, exist_ok=True)
        ziel.write_text(json.dumps(bericht, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
    print(json.dumps({k: v for k, v in bericht.items() if k not in ("jePayload", "zeilen")},
                     indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
