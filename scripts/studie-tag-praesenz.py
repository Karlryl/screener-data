#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Kipp-Pruefung zur Verbreiterung: tragen die vier Kennungen ueberhaupt Zeilen?

WOZU
----
ENTSCHIED 145 haelt das bestehende E1-Panel als Panel der Folgephase fest und
setzt dafuer eine vorab benannte Kipp-Bedingung: zeigt sich, dass das Panel
Zeilen der vier verbreiterten Kennungen NICHT traegt, ist das ein Befund und
kein Weiterbau - der Code sagt, es traegt alle, aber Code ist nicht Bestand.
Dieses Werkzeug misst den Bestand.

DIE FENSTER-MAUER (R2)
----------------------
Geoeffnet wird GENAU EINE Datei: das Entdeckungs-Fenster. Der Pfad wird
AUFGELOEST geprueft (`realpath`, folgt Symlinks und NTFS-Junctions) und der
Dateiname muss stimmen - eine Verzeichnis-Verknuepfung mit harmlosem Namen hat
in diesem Projekt schon einmal woanders hingezeigt. Pruef- und Endtest-Fenster
sind fuer diese Etappe tabu; ein Pfad, der nach ihnen aussieht, ist ein
Abbruch, kein Filter. Geoeffnet wird nur-lesend (`mode=ro`).

EHRLICHKEIT (R5)
----------------
Eine Kennung ohne Zeile wird als 0 GEDRUCKT, nie weggelassen. Das Weglassen
waere hier der teure Fehler: eine fehlende Zeile IST der Befund, und ein
Report, der sie verschweigt, liest sich wie ein bestandener Test.

Aufruf:
  python scripts/studie-tag-praesenz.py --data-root <pfad> [--ziel <datei.json>]
  python scripts/studie-tag-praesenz.py --selbsttest
"""

import argparse
import json
import os
import sqlite3
import sys
import tempfile

FENSTER_DATEI = "panel-entdeckung.sqlite"
VERBOTEN = ("validierung", "endtest", "schluessel", "key")

# Die vier Kennungen aus protocol/early-detection/2.1.0/konzeptliste.json (F3a).
# Bewusst als Liste hier und nicht aus der Datei gelesen: dieses Werkzeug soll
# auch dann noch messbar bleiben, wenn die Liste bewegt wird - und eine
# Abweichung zwischen beiden ist dann sichtbar statt stillschweigend gefolgt.
VERBREITERT = (
    "InterestAndDividendIncomeOperating",
    "OilAndGasRevenue",
    "RealEstateRevenueNet",
    "RegulatedAndUnregulatedOperatingRevenue",
)
# Die alten Umsatz-Quellen (V0) aus scripts/studie-basisraten.py::UMSATZ_QUELLEN,
# als Vergleichsmassstab im selben Lauf - eine Zahl ohne Bezugsgroesse ist keine.
ALT = (
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
    "SalesRevenueServicesNet",
)


# Pflicht-Fussnote fuer jedes Artefakt eines unversiegelten Werkzeugs zu diesem
# Fenster (Anordnung des Orchestrators, einheitlicher Wortlaut). Sie steht hier
# WOERTLICH und wird nie umformuliert: der Satz ist der Gegenstand der Auflage,
# nicht seine Aussage. In versiegelte Ausgaben wird nichts injiziert.
FUSSNOTE = (
    "Quellen-Asymmetrie: Im Entdeckungs-Fenster (bis 2016-12-30) trägt "
    "RevenueFromContractWithCustomerExcludingAssessedTax konstruktionsbedingt 0 Zeilen "
    "(ASC 606 ab 2018); die V0-Umsatzfamilie ruht hier faktisch auf drei ihrer vier "
    "Quellen. Jeder fensterübergreifende Vergleich muss diese Asymmetrie ausweisen."
)


class Abbruch(Exception):
    pass


def pruefe_fenster(pfad):
    """Der aufgeloeste Pfad muss das Entdeckungs-Fenster sein - sonst Abbruch."""
    echt = os.path.realpath(pfad)
    if os.path.basename(echt) != FENSTER_DATEI:
        raise Abbruch(
            "Geoeffnet werden darf nur %s. Aufgeloest wurde %s. Ein anderer "
            "Fenster-Stand ist fuer diese Etappe Sperrzone, kein Sonderfall."
            % (FENSTER_DATEI, echt))
    klein = echt.replace("\\", "/").lower()
    for wort in VERBOTEN:
        if wort in klein:
            raise Abbruch(
                "Der aufgeloeste Pfad %s enthaelt '%s'. Abbruch statt Filter."
                % (echt, wort))
    return echt


def messe(panel_pfad):
    echt = pruefe_fenster(panel_pfad)
    tags = list(VERBREITERT) + list(ALT)
    verb = sqlite3.connect("file:" + echt.replace("\\", "/") + "?mode=ro", uri=True)
    try:
        platz = ",".join("?" * len(tags))
        gefunden = {}
        for tag, zeilen, berichte, firmen in verb.execute(
                "SELECT f.tag, COUNT(*), COUNT(DISTINCT f.adsh), COUNT(DISTINCT b.cik) "
                "FROM fakt f JOIN bericht b ON b.adsh = f.adsh "
                "WHERE f.tag IN (%s) GROUP BY f.tag" % platz, tags):
            gefunden[tag] = {"zeilen": zeilen, "berichte": berichte, "firmen": firmen}
        gesamt_zeilen = verb.execute("SELECT COUNT(*) FROM fakt").fetchone()[0]
        gesamt_firmen = verb.execute("SELECT COUNT(DISTINCT cik) FROM bericht").fetchone()[0]
        von, bis = verb.execute("SELECT MIN(accepted), MAX(accepted) FROM bericht").fetchone()
    finally:
        verb.close()

    # Die Null muss im Report STEHEN, nicht fehlen.
    leer = {"zeilen": 0, "berichte": 0, "firmen": 0}
    verbreitert = {t: gefunden.get(t, dict(leer)) for t in VERBREITERT}
    alt = {t: gefunden.get(t, dict(leer)) for t in ALT}
    ohne_zeile = sorted(t for t, w in verbreitert.items() if w["zeilen"] == 0)
    return {
        "schema": "studie-tag-praesenz/v1",
        "auflage": "ENTSCHIED 145, vorab benannte Kipp-Bedingung zur Verbreiterung",
        "fenster": FENSTER_DATEI,
        # NUR die maschinen-unabhaengige Form (R12a). Geprueft wird sehr wohl der
        # AUFGELOESTE Pfad - aber der traegt das Nutzerverzeichnis dieser Maschine,
        # und ein Artefakt, das einen Laufwerksbuchstaben als Gueltigkeitsbedingung
        # fuehrt, kann kein anderer Motor weiterrechnen. Was in den Bericht gehoert,
        # ist die Zusicherung, nicht der Beweisweg.
        "gelesenesFenster": "DATENWURZEL/panel/" + FENSTER_DATEI,
        "pfadAufgeloestGeprueft": True,
        "acceptedVon": von,
        "acceptedBis": bis,
        "gesamtFaktenzeilen": gesamt_zeilen,
        "gesamtFirmen": gesamt_firmen,
        "verbreitert": verbreitert,
        "altV0": alt,
        "verbreiterteOhneZeile": ohne_zeile,
        "kippBedingungGetroffen": bool(ohne_zeile),
        "quellenAsymmetrie": FUSSNOTE,
    }


def selbsttest():
    """Anwesenheit UND Abwesenheit, plus die Fenster-Mauer."""
    ok = fail = 0

    def pruef(bedingung, text):
        nonlocal ok, fail
        if bedingung:
            ok += 1
            print("  ok    " + text)
        else:
            fail += 1
            print("  FAIL  " + text)

    with tempfile.TemporaryDirectory() as tmp:
        pfad = os.path.join(tmp, FENSTER_DATEI)
        verb = sqlite3.connect(pfad)
        verb.execute("CREATE TABLE bericht (adsh TEXT PRIMARY KEY, cik TEXT, accepted TEXT)")
        verb.execute("CREATE TABLE fakt (adsh TEXT, tag TEXT)")
        verb.execute("INSERT INTO bericht VALUES ('a1','100','2010-01-01 00:00:00.0')")
        verb.execute("INSERT INTO bericht VALUES ('a2','200','2016-01-01 00:00:00.0')")
        # DREI der vier verbreiterten Kennungen tragen Zeilen, die vierte nicht.
        for tag, adsh in (("OilAndGasRevenue", "a1"), ("RealEstateRevenueNet", "a1"),
                          ("RegulatedAndUnregulatedOperatingRevenue", "a2"),
                          ("Revenues", "a1"), ("Revenues", "a2")):
            verb.execute("INSERT INTO fakt VALUES (?,?)", (adsh, tag))
        verb.commit()
        verb.close()

        erg = messe(pfad)
        pruef(erg["verbreitert"]["OilAndGasRevenue"]["zeilen"] == 1,
              "eine vorhandene Kennung wird gezaehlt")
        pruef(erg["verbreitert"]["InterestAndDividendIncomeOperating"]["zeilen"] == 0,
              "die FEHLENDE Kennung steht mit 0 im Report, statt zu fehlen")
        pruef(erg["verbreiterteOhneZeile"] == ["InterestAndDividendIncomeOperating"],
              "genau die fehlende Kennung wird benannt")
        pruef(erg["kippBedingungGetroffen"] is True,
              "ROT-PROBE: eine fehlende Kennung TRIFFT die Kipp-Bedingung")
        pruef(erg["verbreitert"]["RegulatedAndUnregulatedOperatingRevenue"]["firmen"] == 1,
              "verschiedene Firmen werden ueber den Bericht aufgeloest")
        pruef(erg["altV0"]["Revenues"]["berichte"] == 2,
              "die alte Vergleichsgroesse wird im selben Lauf gemessen")
        pruef(erg.get("quellenAsymmetrie") == FUSSNOTE,
              "die Pflicht-Fussnote steht WOERTLICH im Artefakt")
        pruef("ASC 606 ab 2018" in erg.get("quellenAsymmetrie", ""),
              "und sie traegt den Grund, nicht nur die Behauptung")

        # Gegenprobe: liegt die vierte Kennung vor, ist die Bedingung NICHT getroffen.
        verb = sqlite3.connect(pfad)
        verb.execute("INSERT INTO fakt VALUES ('a2','InterestAndDividendIncomeOperating')")
        verb.commit()
        verb.close()
        erg2 = messe(pfad)
        pruef(erg2["kippBedingungGetroffen"] is False,
              "GEGENPROBE: tragen alle vier Zeilen, ist die Bedingung nicht getroffen")

        # Die Fenster-Mauer, beide Richtungen.
        falsch = os.path.join(tmp, "panel-validierung.sqlite")
        with open(falsch, "wb") as fh:
            fh.write(b"")
        try:
            messe(falsch)
            pruef(False, "ROT-PROBE: ein fremdes Fenster bricht ab")
        except Abbruch:
            pruef(True, "ROT-PROBE: ein fremdes Fenster bricht ab")

    print("\nselbsttest: %d ok, %d FAIL" % (ok, fail))
    return 1 if fail else 0


def haupt(argv):
    ap = argparse.ArgumentParser(description="Tag-Praesenz der verbreiterten Kennungen.")
    ap.add_argument("--data-root")
    ap.add_argument("--ziel")
    ap.add_argument("--selbsttest", action="store_true")
    a = ap.parse_args(argv)

    if a.selbsttest:
        return selbsttest()

    wurzel = a.data_root or os.environ.get("EARLY_DETECTION_DATA_ROOT")
    if not wurzel:
        print("ABBRUCH: --data-root fehlt und EARLY_DETECTION_DATA_ROOT ist nicht "
              "gesetzt (R12a verbietet einen fest verdrahteten Pfad).", file=sys.stderr)
        return 2
    try:
        erg = messe(os.path.join(wurzel, "panel", FENSTER_DATEI))
    except Abbruch as e:
        print("ABBRUCH: " + str(e), file=sys.stderr)
        return 3

    text = json.dumps(erg, ensure_ascii=False, indent=1) + "\n"
    if a.ziel:
        # Atomar: dieselbe Regel wie ueberall sonst, ein halber Report ist kein Report.
        daneben = a.ziel + ".teil"
        with open(daneben, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(daneben, a.ziel)
        print("Report: " + a.ziel)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(haupt(sys.argv[1:]))
