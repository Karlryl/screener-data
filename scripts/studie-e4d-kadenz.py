#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""E4d + E4e - Das Kadenz-Kriterium und die konsistente Fensterkanten-Formel.

DIE FRAGE, EINE EINZIGE: Erreicht S-G im Prueffenster 2017-2019 die
praeregistrierte Auffindbarkeits-Schwelle, wenn die Zensur nach der eigenen
Meldekadenz der Firma bestimmt wird UND die Quote an der Fensterkante konsistent
gerechnet wird? S-U ist konfirmatorisch tot (unter keiner zulaessigen Korrektur
rettbar) und wird hier nur noch mitgezaehlt, nicht mehr entschieden.

DIE ENTSCHEIDUNGSREGEL IST VORAB VERRIEGELT. Sie steht woertlich in
protocol/early-detection/2.0.0/e4d-freeze.json, wurde eingefroren, BEVOR dieser
Lauf eine einzige Zahl gesehen hat, und wird von diesem Skript nicht neu
verhandelt - nur ausgefuehrt. Das Gate 90/10 stammt unveraendert aus der
versiegelten Praeregistrierung 2.0.0 (outcomes.auffindbarkeit.gate) und wird
weder gesenkt noch kalibriert; W12 bricht ab, wenn Siegel und Code auch nur um
eine Stelle auseinanderlaufen.

WAS SICH GEGENUEBER E3 AENDERT - GENAU ZWEI DINGE, BEIDE IM SELBEN SIEGEL:

  E4d  ZENSUR NACH KADENZ. E3 zensiert mit 4 * 80 Tagen, also mit der
       UNTEREN Kante des Quartals-Paarungsfensters. Das misst Unmoeglichkeit.
       Hier zaehlt stattdessen der eigene Melderhythmus der Firma: der Median
       der Abstaende zwischen den Bilanzstichtagen ihrer gewaehlten Reihe VOR
       dem Signal, nach unten begrenzt durch ein dokumentiertes Fiskalquartal.
       Richtung, hier vorab benannt: 4 * 91,25 > 4 * 80, das Kriterium zensiert
       also NIE weniger als E3, meist mehr - und hebt die Quote damit.

  E4e  KONSISTENTE QUOTE. E3 zaehlt im Zaehler ALLE reifen Firmen, laesst im
       Nenner aber die zensierten weg. Eine zensierte Firma KANN reif sein; im
       Pufferjahr 2016 kam deshalb 1,4 heraus. Hier fliegen die Zensierten aus
       Zaehler UND Nenner. Richtung, hier vorab benannt: das drueckt die Quote.

Beide zusammen sind ein Freeze, nicht zwei Wahlmoeglichkeiten. Sie ziehen in
entgegengesetzte Richtungen - genau deshalb stehen sie zusammen.

WAS DIESES SKRIPT NICHT TUT: Es rechnet keinen Ergebniswert (R4), es fasst das
verschluesselte Endtest-Fenster nicht an (Sperrzone, Karl 19.08.), es aendert
die versiegelte Praeregistrierung 2.0.0 nicht, und es enthaelt keinen
Entschluesselungs-Aufruf.

WOHER DER CODE KOMMT: Signaldefinition, Reifedefinition, Klassen-Zerlegung und
saemtliche Waechter werden aus scripts/studie-zaehlprobe.py,
scripts/studie-basisraten.py und scripts/studie-e4a-diagnose.py IMPORTIERT,
nicht nachgebaut. Ein Nachbau haette die Zahlen auseinanderlaufen lassen.

Aufruf:
  python scripts/studie-e4d-kadenz.py --selbsttest
  python scripts/studie-e4d-kadenz.py --allowlist-ausgeben
  python scripts/studie-e4d-kadenz.py --siegeln          (Skript-Hash ins Siegel)
  python scripts/studie-e4d-kadenz.py --fenster pruefung --freigabe <f.json> --ziel <r.json>
"""

import argparse
import hashlib
import json
import os
import platform
import sqlite3
import statistics
import sys
from collections import defaultdict
from datetime import date

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZP_SKRIPT = os.path.join(WURZEL, "scripts", "studie-zaehlprobe.py")
E4A_SKRIPT = os.path.join(WURZEL, "scripts", "studie-e4a-diagnose.py")
FREEZE = os.path.join(WURZEL, "protocol", "early-detection", "2.0.0",
                      "e4d-freeze.json")
SELBST = os.path.abspath(__file__)

SCHEMA = "early-detection-e4d-kadenz/v1"

# ── Das Kadenz-Kriterium, in Konstanten ──────────────────────────────────────
# EIN Fiskalquartal in Tagen. Herleitung, nicht Wahl: SEC Exchange Act Rule
# 13a-13 verlangt fuer die ersten drei Fiskalquartale je ein 10-Q, Rule 13a-1
# fuer das Geschaeftsjahr ein 10-K - also GENAU VIER periodische Berichte je
# Geschaeftsjahr. Ein Geschaeftsjahr hat 365 Tage, ein Fiskalquartal folglich
# 365/4 = 91,25 Tage. Kein gerundeter, kein gegriffener Wert.
FISKALQUARTAL_TAGE = 365.0 / 4.0
# Reife verlangt vier Folgequartale (studie-basisraten.py::REIFE_QUARTALE).
# Der Faktor wird von dort GELESEN, nicht hier zweitgepflegt.

# Histogramm-Bandbreite: ein Fiskalquartal, abgerundet auf ganze Tage. Die
# Bandbreite ist eine Darstellungsgroesse und im Siegel festgeschrieben.
HISTOGRAMM_BIN_TAGE = 91

# ── Baender je Fenster ───────────────────────────────────────────────────────
# `registry` ist das Band, das die Fenster-Registry der Zaehlprobe fuehrt. Das
# E2-Ankerband 2012-2016 laeuft hier NICHT mit: es enthaelt das Pufferjahr im
# Signalband und ist deshalb genau der Fall, den E4e repariert - als Anker taugt
# es damit nicht mehr, weil sich seine Quote definitionsgemaess aendern MUSS.
BAENDER = {
    "pruefung": (("registry", 2017, 2019),),
    "entdeckung": (("registry", 2009, 2015),),
}

# Das Fenster, ueber das die verriegelte Regel entscheidet. Alles andere laeuft
# als Gegenprobe mit und entscheidet nichts.
ENTSCHEIDUNGS_FENSTER = "pruefung"
ENTSCHEIDUNGS_VARIANTE = "S-G"

# ── Die veroeffentlichten Anker ──────────────────────────────────────────────
# Sie werden nicht "verglichen und dann geglaettet", sondern brechen den Lauf ab.
# Geprueft wird der E3-BLOCK - also die Zaehlung mit dem ALTEN Zensur-Kriterium
# und der ALTEN Formel. Trifft er nicht, misst dieser Lauf eine andere Strecke
# als der Befund, den er korrigieren soll, und ist wertlos.
ANKER = {
    ("pruefung", "registry"): {
        "quelle": "reports/studie/E3-zaehlprobe-pruefung-2026-08-19.json",
        "signal": {
            "S-U": {"firmen_mit_erst_ereignis": 438, "fallzahl": 292,
                    "zensiert_e3": 0},
            "S-G": {"firmen_mit_erst_ereignis": 365, "fallzahl": 326,
                    "zensiert_e3": 0},
        },
        "kontrolle": {
            "S-U": {"firmen_mit_erst_ereignis": 4163, "fallzahl": 3085,
                    "zensiert_e3": 0},
            "S-G": {"firmen_mit_erst_ereignis": 4733, "fallzahl": 4285,
                    "zensiert_e3": 0},
        },
    },
    ("entdeckung", "registry"): {
        "quelle": "reports/studie/E4a-diagnose-entdeckung-2026-08-19.json",
        "signal": {
            "S-U": {"firmen_mit_erst_ereignis": 651, "fallzahl": 543,
                    "zensiert_e3": 0},
            "S-G": {"firmen_mit_erst_ereignis": 647, "fallzahl": 557,
                    "zensiert_e3": 0},
        },
        "kontrolle": {
            "S-U": {"firmen_mit_erst_ereignis": 4514, "fallzahl": 3761,
                    "zensiert_e3": 0},
            "S-G": {"firmen_mit_erst_ereignis": 5768, "fallzahl": 5000,
                    "zensiert_e3": 0},
        },
    },
}

# ── Die Ausgabe-Allowlist ────────────────────────────────────────────────────
# Muster ist die Allowlist der Zaehlprobe und die von E4a. Sie wird hier BEWUSST
# UND MINIMAL erweitert - um die zweite Zensur-Zaehlung, die zwei zusaetzlichen
# Quoten und das Abstands-Histogramm - statt umgangen. E3s Reviewer fanden an
# genau dieser Stelle zwei harte Befunde (ein ganzer Namensraum lief ungeprueft
# durch); deshalb steht hier kein Praefix, sondern jeder Name einzeln.
#
# Alle Felder sind FIRMEN-ZAHLEN oder Quoten daraus. Kein Umsatz, kein Gewinn,
# keine Wachstumsrate, keine Firmen-Kennung, kein Kennungsname, kein Tagesdatum.
ZAEHL_FELDER = (
    "firmen_mit_erst_ereignis",
    "fallzahl",
    "klasse_c_firmen",
    "zensiert_e3",
    "zensiert_kadenz",
    "zensiert_kadenz_und_reif",
    "kadenz_untergrenze_gebunden",
    "nenner_e3",
    "nenner_kadenz",
    "zaehler_kadenz",
)
QUOTEN_FELDER = (
    "auffindbarkeit_e3",
    "auffindbarkeit_kadenz_e3formel",
    "auffindbarkeit_kadenz",
)
HISTOGRAMM_FELD = "abstand_histogramm_klasse_c"
ARM_BLOCK = tuple(sorted(ZAEHL_FELDER + QUOTEN_FELDER + (HISTOGRAMM_FELD,)))
ARME = ("signal", "kontrolle")
VARIANTEN_FELDER = ("ampel", "differenz_auffindbarkeit")
VARIANTEN_BLOCK = tuple(sorted(ARME + VARIANTEN_FELDER))
BAND_BLOCK = ("bis", "rolle", "varianten", "von")

# Was im Zugriffs-Register angemeldet wird (W9). Genau das, was die Ausgabe
# fuehrt - nicht mehr, nicht weniger.
ANMELDE_FELDER = tuple(sorted(
    ZAEHL_FELDER + QUOTEN_FELDER + (HISTOGRAMM_FELD,) + VARIANTEN_FELDER))

UMSCHLAG_ALLOWLIST = (
    "accessedAt", "ampelEntscheidung", "ankerGeprueft", "baender", "beendetAm",
    "entscheidungsregel", "ergebnisdatenBeruehrt", "ersterZugriffAm", "fenster",
    "freezeGeprueft", "gelesenePfade", "geschriebenePfade", "manifestGeprueft",
    "panelRand", "perzentil", "protokoll", "runId", "schema",
    "serverConfirmedAt", "siegelWache", "umgebung",
)


class KadenzFehler(Exception):
    """Ein Befund, der den Lauf anhaelt - nie ein stiller Rueckfall."""


def lade(pfad, name):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, pfad)
    if spec is None or spec.loader is None:
        raise KadenzFehler("Skript nicht ladbar: " + pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


zp = lade(ZP_SKRIPT, "studie_zaehlprobe")
e4a = lade(E4A_SKRIPT, "studie_e4a_diagnose")


def sha256_datei(pfad):
    h = hashlib.sha256()
    with open(pfad, "rb") as f:
        for stueck in iter(lambda: f.read(1 << 22), b""):
            h.update(stueck)
    return h.hexdigest()


# ── W11/W12: das Siegel dieser Etappe ────────────────────────────────────────

def lies_freeze(pfad=FREEZE, skript=SELBST):
    """Das Siegel dieser Etappe - und die Pruefung, dass es zu DIESEM Code gehoert.

    Zwei Richtungen, beide fail-closed:
      W11  Der SHA-256 dieser Datei muss der sein, den das Siegel nennt. Wer den
           Code nach dem Einfrieren aendert, macht jeden Lauf rot.
      W12  Die Schwellen im Siegel muessen die der versiegelten Praeregistrierung
           2.0.0 sein - gelesen aus scripts/studie-zaehlprobe.py, nicht hier
           zweitgepflegt. Das Gate 90/10 wird in dieser Etappe nicht angefasst;
           dieser Waechter macht die Zusage pruefbar statt nur behauptet.
    """
    if not os.path.isfile(pfad):
        raise KadenzFehler(
            "W11-ABBRUCH: kein e4d-freeze.json. Ohne vorab verriegelte "
            "Entscheidungsregel ist dieser Lauf wertlos - die Regel IST der "
            "ganze Schutz dieser Etappe.")
    with open(pfad, encoding="utf-8") as f:
        siegel = json.load(f)
    regel = siegel.get("entscheidungsregel") or {}
    for feld in ("minimum", "maxDifferenz", "fallzahlMin", "gruen", "rot",
                 "bedingungen"):
        if feld not in regel:
            raise KadenzFehler(
                "W11-ABBRUCH: der Entscheidungsregel im Siegel fehlt '" + feld
                + "'. Eine Regel mit Luecken ist keine Regel.")
    ist = sha256_datei(skript)
    soll = siegel.get("skriptSha256")
    if soll != ist:
        raise KadenzFehler(
            "W11-ABBRUCH: dieses Skript hat den SHA-256 " + str(ist)[:16]
            + "..., das Siegel bindet " + str(soll)[:16] + ".... Der Code ist "
            "nach dem Einfrieren veraendert worden - der Lauf ist wertlos.")
    if regel["minimum"] != zp.AUFFINDBARKEIT_MIN:
        raise KadenzFehler(
            "W12-ABBRUCH: das Siegel nennt die Schwelle " + repr(regel["minimum"])
            + ", die versiegelte Praeregistrierung " + repr(zp.AUFFINDBARKEIT_MIN)
            + ". Das Gate wird in dieser Etappe nicht angefasst.")
    if regel["maxDifferenz"] != zp.AUFFINDBARKEIT_MAX_DIFFERENZ:
        raise KadenzFehler(
            "W12-ABBRUCH: das Siegel nennt die Hoechstdifferenz "
            + repr(regel["maxDifferenz"]) + ", die versiegelte Praeregistrierung "
            + repr(zp.AUFFINDBARKEIT_MAX_DIFFERENZ) + ".")
    if regel["fallzahlMin"] != zp.FALLZAHL_MIN:
        raise KadenzFehler(
            "W12-ABBRUCH: das Siegel nennt die Mindestfallzahl "
            + repr(regel["fallzahlMin"]) + ", die versiegelte Praeregistrierung "
            + repr(zp.FALLZAHL_MIN) + ".")
    kadenz = siegel.get("kadenzKriterium") or {}
    if kadenz.get("untergrenzeTage") != FISKALQUARTAL_TAGE:
        raise KadenzFehler(
            "W12-ABBRUCH: das Siegel nennt die Kadenz-Untergrenze "
            + repr(kadenz.get("untergrenzeTage")) + ", der Code rechnet mit "
            + repr(FISKALQUARTAL_TAGE) + ".")
    if kadenz.get("statistik") != "median":
        raise KadenzFehler(
            "W12-ABBRUCH: das Siegel nennt die Kadenz-Statistik "
            + repr(kadenz.get("statistik")) + ", der Code rechnet mit 'median'.")
    hist = siegel.get("histogramm") or {}
    if hist.get("binBreiteTage") != HISTOGRAMM_BIN_TAGE:
        raise KadenzFehler(
            "W12-ABBRUCH: das Siegel nennt die Histogramm-Bandbreite "
            + repr(hist.get("binBreiteTage")) + ", der Code rechnet mit "
            + repr(HISTOGRAMM_BIN_TAGE) + ".")
    if sorted(siegel.get("ausgabeAllowlist") or ()) != sorted(ANMELDE_FELDER):
        raise KadenzFehler(
            "W12-ABBRUCH: die Ausgabe-Allowlist des Siegels deckt die des Codes "
            "nicht. Nur im Siegel: "
            + str(sorted(set(siegel.get("ausgabeAllowlist") or ())
                         - set(ANMELDE_FELDER)))
            + "; nur im Code: "
            + str(sorted(set(ANMELDE_FELDER)
                         - set(siegel.get("ausgabeAllowlist") or ()))) + ".")
    return siegel


def pruefe_siegel_im_register(freigabe, siegel_sha, register_pfad=None):
    """W10: der Fingerabdruck des Siegels muss IM Register-Eintrag stehen.

    Das Siegel ist eine lokale Datei; fuer sich genommen beweist es nichts. Erst
    wenn sein SHA-256 in der vorab gepushten und serverbestaetigten Anmeldung
    steht, ist belegt, dass die Entscheidungsregel VOR dem Zugriff festlag. Ohne
    diesen Waechter koennte die Regel nach dem ersten Blick auf die Zahl
    umgeschrieben werden, und niemand saehe es."""
    pfad = register_pfad or zp.REGISTER
    with open(pfad, encoding="utf-8") as f:
        register = json.load(f)
    treffer = [e for e in (register.get("events") or ())
               if e.get("runId") == freigabe["runId"]]
    if len(treffer) != 1:
        raise KadenzFehler(
            "W10-ABBRUCH: runId " + repr(freigabe["runId"]) + " steht "
            + str(len(treffer)) + "-mal im Zugriffs-Register.")
    text = json.dumps(treffer[0], ensure_ascii=False)
    if siegel_sha not in text:
        raise KadenzFehler(
            "W10-ABBRUCH: der Fingerabdruck des Siegels (" + siegel_sha[:16]
            + "...) steht nicht in der Anmeldung " + repr(freigabe["runId"])
            + ". Eine Entscheidungsregel, die erst nach dem Zugriff belegbar "
            "ist, ist keine.")
    return True


def pruefe_anmeldung_deckt_ausgabe(freigabe, register_pfad=None):
    """W9: was ausgegeben wird, muss angemeldet sein - Feld fuer Feld."""
    pfad = register_pfad or zp.REGISTER
    with open(pfad, encoding="utf-8") as f:
        register = json.load(f)
    treffer = [e for e in (register.get("events") or ())
               if e.get("runId") == freigabe["runId"]]
    if len(treffer) != 1:
        raise KadenzFehler(
            "W9-ABBRUCH: runId " + repr(freigabe["runId"]) + " steht "
            + str(len(treffer)) + "-mal im Zugriffs-Register.")
    angemeldet = set(treffer[0].get("allowedOutputs") or ())
    erlaubt = set(ANMELDE_FELDER)
    if angemeldet != erlaubt:
        raise KadenzFehler(
            "W9-ABBRUCH: die Anmeldung deckt die Ausgabe nicht. Nur angemeldet: "
            + str(sorted(erlaubt - angemeldet)) + "; nur im Register: "
            + str(sorted(angemeldet - erlaubt)) + ".")
    return True


# ── E4d: das Kadenz-Kriterium ────────────────────────────────────────────────

def melde_kadenz(f, gewaehlt, e2):
    """Der eigene Melderhythmus der Firma VOR dem Signal, in Tagen.

    WORTLAUT (eingefroren in e4d-freeze.json): Median der Abstaende zwischen
    aufeinanderfolgenden BILANZSTICHTAGEN der gewaehlten Reihe der Firma, ueber
    alle Quartale mit `ddate <= ddate(Signal)`, nach unten begrenzt durch ein
    Fiskalquartal (365/4 Tage).

    WORAUS ABGELEITET, Stueck fuer Stueck:
      * Die Untergrenze ist DOKUMENTIERT, nicht gegriffen: SEC Exchange Act Rule
        13a-13 (10-Q fuer die ersten drei Fiskalquartale) und Rule 13a-1 (10-K
        fuer das Geschaeftsjahr) ergeben genau vier periodische Berichte je
        Geschaeftsjahr, also 365/4 = 91,25 Tage je Bericht. Schnellere gemessene
        Abstaende stammen aus Nachtraegen und Ueberschneidungen, nicht aus einem
        schnelleren Melderhythmus.
      * Gemessen wird auf der STICHTAGS-Achse und nur VOR dem Signal. Beides ist
        Vorgriffs-Schutz (R11): die Fiskalkalender-Abstaende stehen zum
        Signalzeitpunkt fest, waehrend eine Messung auf der Anmelde-Achse ueber
        spaete Nachreichungen Wissen aus der Zukunft einsammeln koennte.
      * Der MEDIAN, nicht Mittelwert/Maximum/Minimum - Begruendung und die
        verworfenen Varianten stehen im Siegel, nicht hier, damit sie nicht
        nachtraeglich umgeschrieben werden koennen.

    NICHT AN DEN DATEN GESTIMMT: keine dieser Groessen ist am Ergebnis justiert
    worden; die Wirkung wurde erst NACH dem Einfrieren gesehen.

    Rueckgabe: (kadenz_tage, untergrenze_hat_gegriffen)
    """
    reihe = gewaehlt.get(f["cik"])
    if not reihe:
        raise KadenzFehler(
            "KADENZ-ABBRUCH: Erst-Ereignis-Firma ohne gewaehlte Reihe. Wer "
            "feuert, MUSS in der gewaehlten Reihe stehen - kommt das vor, ist "
            "die Datenstrecke kaputt und nicht die Kadenz zu langsam.")
    vorher = sorted(d for d in reihe if d <= f["ddate"])
    ordinale = []
    for d in vorher:
        o = e2.ordinal(d)
        if o is None:
            raise KadenzFehler(
                "R5-ABBRUCH: unlesbarer Bilanzstichtag " + repr(d) + " in der "
                "gewaehlten Reihe. Die Kadenz ist damit NICHT BERECHENBAR und "
                "wird nicht geraten.")
        ordinale.append(o)
    if len(ordinale) < 2:
        raise KadenzFehler(
            "KADENZ-ABBRUCH: nur " + str(len(ordinale)) + " Quartal(e) vor dem "
            "Signal. Ohne mindestens einen Abstand gibt es keinen Rhythmus - "
            "konstruktiv unmoeglich, weil jede Feuerung ein Vorquartal derselben "
            "Quelle braucht. Kommt es doch vor, ist es ein Befund.")
    abstaende = [b - a for a, b in zip(ordinale, ordinale[1:])]
    gemessen = statistics.median(abstaende)
    if gemessen < FISKALQUARTAL_TAGE:
        return FISKALQUARTAL_TAGE, True
    return float(gemessen), False


def kadenz_zensiert(f, gewaehlt, e2, rand_ordinal):
    """Ist dieses Erst-Ereignis nach dem eigenen Melderhythmus nicht mehr bis zum
    Panelrand verfolgbar?

    zensiert  <=>  ordinal(accepted) + REIFE_QUARTALE * Kadenz > ordinal(Rand)

    Derselbe Anker wie E3 (`accepted`, die Achse, an der die Panel-Dateien
    geschnitten sind) und dieselbe Vergleichsrichtung - ersetzt ist einzig die
    feste 80-Tage-Kante durch die gemessene Kadenz der Firma.

    Rueckgabe: (zensiert, untergrenze_hat_gegriffen)"""
    tag = str(f["accepted"])[:10].replace("-", "")
    o = e2.ordinal(tag)
    if o is None:
        raise KadenzFehler(
            "R5-ABBRUCH: Erst-Ereignis mit unlesbarem Zeitstempel ("
            + repr(f.get("accepted")) + ") - die Zensur ist damit NICHT "
            "BERECHENBAR und wird nicht geraten.")
    kadenz, gegriffen = melde_kadenz(f, gewaehlt, e2)
    return (o + e2.REIFE_QUARTALE * kadenz > rand_ordinal), gegriffen


def abstand_zum_rand(f, e2, rand_ordinal):
    """Tage vom Melde-Eingang des Signals bis zum Panelrand. Nie negativ: das
    Panel traegt per Bauart nur Berichte bis zum Rand."""
    o = e2.ordinal(str(f["accepted"])[:10].replace("-", ""))
    if o is None:
        raise KadenzFehler(
            "R5-ABBRUCH: Erst-Ereignis mit unlesbarem Zeitstempel ("
            + repr(f.get("accepted")) + ").")
    return rand_ordinal - o


def histogramm_bins(von_jahr, rand_ordinal):
    """Die Bin-Kanten - deterministisch aus dem Band, nicht aus den Daten.

    Von 0 bis zum groesstmoeglichen Abstand des Bandes (Rand minus 1. Januar des
    ersten Bandjahres), in Schritten von HISTOGRAMM_BIN_TAGE. ALLE Bins werden
    ausgegeben, auch leere: ein Histogramm, das nur seine gefuellten Faecher
    zeigt, sieht immer geklumpt aus."""
    hoechster = rand_ordinal - date(von_jahr, 1, 1).toordinal()
    anzahl = max(1, hoechster // HISTOGRAMM_BIN_TAGE + 1)
    return ["%d-%d" % (i * HISTOGRAMM_BIN_TAGE,
                       (i + 1) * HISTOGRAMM_BIN_TAGE - 1) for i in range(anzahl)]


def bin_fuer(abstand):
    i = max(0, int(abstand)) // HISTOGRAMM_BIN_TAGE
    return "%d-%d" % (i * HISTOGRAMM_BIN_TAGE, (i + 1) * HISTOGRAMM_BIN_TAGE - 1)


# ── E4e: die konsistente Fensterkanten-Formel ────────────────────────────────

def quote_e3(zaehler, nenner):
    """Die GEERBTE Formel, unveraendert: alle reifen Firmen geteilt durch die
    nicht zensierten Erst-Ereignis-Firmen. Sie steht hier ausschliesslich, damit
    der Anker gegen E3 exakt trifft - nicht als Alternative zur Wahl.

    Sie ist an der Fensterkante keine Quote: eine zensierte Firma KANN reif
    sein, dann steht im Zaehler mehr als im Nenner. Dieser Fall heisst NICHT
    BERECHENBAR (R5), nie eine Zahl ueber 1."""
    if nenner <= 0 or zaehler > nenner:
        return None
    return zaehler / nenner


def quote_konsistent(zaehler, nenner):
    """E4e: dieselbe Grundgesamtheit in Zaehler UND Nenner - die Zensierten sind
    aus beiden heraus.

    Damit ist `zaehler <= nenner` KONSTRUKTIV wahr. Ist es das nicht, hat sich
    jemand verzaehlt, und das bricht ab, statt eine Quote ueber 1 zu melden."""
    if nenner <= 0:
        return None
    if zaehler > nenner:
        raise KadenzFehler(
            "FORMEL-ABBRUCH: " + str(zaehler) + " reife nicht zensierte Firmen "
            "gegen " + str(nenner) + " nicht zensierte Firmen. Bei konsistenter "
            "Grundgesamtheit ist der Zaehler eine Teilmenge des Nenners - das "
            "hier ist ein Zaehlfehler, kein Kantenartefakt.")
    return zaehler / nenner


# ── Die Zaehlung eines Arms ──────────────────────────────────────────────────

def leerer_block(bins):
    block = dict((feld, 0) for feld in ZAEHL_FELDER)
    for feld in QUOTEN_FELDER:
        block[feld] = None
    block[HISTOGRAMM_FELD] = dict((b, 0) for b in bins)
    return block


def zaehle_arm(eintraege, gewaehlt, e2, rand_ordinal, bins):
    """EIN Arm - Signal oder Kontrolle, derselbe Code, dieselbe Fehlbehandlung.

    Die Vorstudie ist daran gestorben, dass fehlende Werte in einer Gruppe
    strenger gebucht wurden als in der anderen. Hier ruft jeder Arm dieselbe
    Funktion.

    Reif/unreif kommt aus e2.erst_ereignisse - der EINGEFROREN definierten
    Reifepruefung; die Klasse kommt aus e4a.klassifiziere - der in E4a
    veroeffentlichten Zerlegung. Beides wird importiert, nicht nachgebaut."""
    reif, unreif = e2.erst_ereignisse(eintraege, gewaehlt)
    alle_erste = reif + unreif
    if len(set(e["cik"] for e in alle_erste)) != len(alle_erste):
        raise KadenzFehler(
            "R3-ABBRUCH: eine Firma traegt mehr als ein Erst-Ereignis.")

    block = leerer_block(bins)
    for f, ist_reif in [(x, True) for x in reif] + [(x, False) for x in unreif]:
        block["firmen_mit_erst_ereignis"] += 1
        if ist_reif:
            block["fallzahl"] += 1
        alt = zp.ist_zensiert(f, e2, rand_ordinal)
        neu, gegriffen = kadenz_zensiert(f, gewaehlt, e2, rand_ordinal)
        if alt:
            block["zensiert_e3"] += 1
        if neu:
            block["zensiert_kadenz"] += 1
            if ist_reif:
                block["zensiert_kadenz_und_reif"] += 1
        if gegriffen:
            block["kadenz_untergrenze_gebunden"] += 1
        if not ist_reif:
            klasse, _unter, _anschluss = e4a.klassifiziere(f, gewaehlt)
            if klasse == e4a.KLASSE_C:
                block["klasse_c_firmen"] += 1
                schluessel = bin_fuer(abstand_zum_rand(f, e2, rand_ordinal))
                if schluessel not in block[HISTOGRAMM_FELD]:
                    raise KadenzFehler(
                        "HISTOGRAMM-ABBRUCH: der Abstand faellt in das Fach "
                        + schluessel + ", das die Bandkanten gar nicht vorsehen. "
                        "Ein Histogramm mit nachwachsenden Faechern zaehlt nicht "
                        "das, was es zu zaehlen behauptet.")
                block[HISTOGRAMM_FELD][schluessel] += 1

    block["nenner_e3"] = (block["firmen_mit_erst_ereignis"]
                          - block["zensiert_e3"])
    block["nenner_kadenz"] = (block["firmen_mit_erst_ereignis"]
                              - block["zensiert_kadenz"])
    block["zaehler_kadenz"] = (block["fallzahl"]
                               - block["zensiert_kadenz_und_reif"])
    block["auffindbarkeit_e3"] = quote_e3(block["fallzahl"], block["nenner_e3"])
    block["auffindbarkeit_kadenz_e3formel"] = quote_e3(block["fallzahl"],
                                                       block["nenner_kadenz"])
    block["auffindbarkeit_kadenz"] = quote_konsistent(block["zaehler_kadenz"],
                                                      block["nenner_kadenz"])
    pruefe_blockinvarianten(block)
    return block


def pruefe_blockinvarianten(b):
    """Die Zaehlung muss AUFGEHEN. Ein Zaehler, der sich still von der Gesamtzahl
    loest, waere die bequemste Art, ein gewuenschtes Ergebnis zu erzeugen."""
    if b["zensiert_e3"] + b["nenner_e3"] != b["firmen_mit_erst_ereignis"]:
        raise KadenzFehler(
            "ZAEHL-ABBRUCH: zensiert (E3) + Nenner (E3) ergibt nicht die Zahl "
            "der Erst-Ereignis-Firmen.")
    if b["zensiert_kadenz"] + b["nenner_kadenz"] != b["firmen_mit_erst_ereignis"]:
        raise KadenzFehler(
            "ZAEHL-ABBRUCH: zensiert (Kadenz) + Nenner (Kadenz) ergibt nicht die "
            "Zahl der Erst-Ereignis-Firmen.")
    # DIE RICHTUNGS-INVARIANTE. 4 * 91,25 Tage > 4 * 80 Tage, also ist jedes von
    # E3 zensierte Ereignis auch nach Kadenz zensiert - nie umgekehrt. Diese
    # Ungleichung ist die Hebelrichtung des Kriteriums, hier vorab benannt und
    # nachgeprueft. Kippt sie, rechnet das Kriterium etwas anderes, als der
    # Wortlaut sagt.
    if b["zensiert_kadenz"] < b["zensiert_e3"]:
        raise KadenzFehler(
            "RICHTUNGS-ABBRUCH: das Kadenz-Kriterium zensiert "
            + str(b["zensiert_kadenz"]) + " Ereignisse, das E3-Kriterium "
            + str(b["zensiert_e3"]) + ". Weil ein Fiskalquartal (91,25 Tage) "
            "laenger ist als E3s 80 Tage, KANN das Kadenz-Kriterium nie weniger "
            "zensieren. Tut es das doch, misst es etwas anderes als seinen "
            "eigenen Wortlaut.")
    if b["zensiert_kadenz_und_reif"] > min(b["zensiert_kadenz"], b["fallzahl"]):
        raise KadenzFehler(
            "ZAEHL-ABBRUCH: reif UND zensiert ("
            + str(b["zensiert_kadenz_und_reif"]) + ") ist groesser als die "
            "kleinere der beiden Mengen.")
    if b["zaehler_kadenz"] + b["zensiert_kadenz_und_reif"] != b["fallzahl"]:
        raise KadenzFehler(
            "ZAEHL-ABBRUCH: Zaehler (Kadenz) plus reif-und-zensiert ergibt nicht "
            "die Fallzahl.")
    if b["zaehler_kadenz"] > b["nenner_kadenz"]:
        raise KadenzFehler(
            "ZAEHL-ABBRUCH: der konsistente Zaehler ist groesser als sein "
            "Nenner. Nach E4e ist er dessen Teilmenge - das ist unmoeglich.")
    if sum(b[HISTOGRAMM_FELD].values()) != b["klasse_c_firmen"]:
        raise KadenzFehler(
            "HISTOGRAMM-ABBRUCH: das Histogramm traegt "
            + str(sum(b[HISTOGRAMM_FELD].values())) + " Firmen, die Klasse (c) "
            + str(b["klasse_c_firmen"]) + ". Ein Histogramm, das nicht die Menge "
            "abbildet, die es abbilden soll, beantwortet die Frage nicht.")
    if b["klasse_c_firmen"] > b["firmen_mit_erst_ereignis"] - b["fallzahl"]:
        raise KadenzFehler(
            "ZAEHL-ABBRUCH: mehr Klasse-(c)-Firmen als unreife Firmen.")
    return True


# ── Die verriegelte Entscheidungsregel ───────────────────────────────────────

def entscheide(signal, kontrolle, siegel):
    """Die Regel, WOERTLICH wie im Siegel - drei Bedingungen, kein Ermessen.

        Signal-Arm >= minimum  UND  Kontrollpool >= minimum
        UND |Signal - Kontrollpool| <= maxDifferenz
          -> GRUEN, sonst ROT (INCONCLUSIVE_DATA)

    Es gibt keine dritte Option und kein Nachfassen. Die Schwellen kommen aus
    dem Siegel, das sie aus der versiegelten Praeregistrierung uebernommen hat;
    dieser Code kennt keine eigenen.

    Rueckgabe: (ampel, differenz_oder_None)"""
    regel = siegel["entscheidungsregel"]
    a = signal["auffindbarkeit_kadenz"]
    b = kontrolle["auffindbarkeit_kadenz"]
    if a is None or b is None:
        return zp.AMPEL_ROT, None
    differenz = abs(a - b)
    if (a >= regel["minimum"] and b >= regel["minimum"]
            and differenz <= regel["maxDifferenz"]):
        return zp.AMPEL_GRUEN, differenz
    return zp.AMPEL_ROT, differenz


def pruefe_fallzahl_deckt_regel(signal, siegel, ort):
    """Die verriegelte Regel setzt eine tragfaehige Fallzahl VORAUS - E3 hat sie
    mit 292/326 gegen 200 bereits erbracht. Faellt sie durch die neue Zensur
    unter das Minimum, ist das eine Lage, die die Regel nicht beschreibt: dann
    wird angehalten und gemeldet, nicht sinngemaess weiterentschieden."""
    minimum = siegel["entscheidungsregel"]["fallzahlMin"]
    if signal["zaehler_kadenz"] < minimum:
        raise KadenzFehler(
            "FALLZAHL-ABBRUCH: " + ort + " traegt nach der Kadenz-Zensur nur "
            + str(signal["zaehler_kadenz"]) + " auswertbare Firmen, "
            "praeregistriertes Minimum ist " + str(minimum) + ". Die verriegelte "
            "Entscheidungsregel setzt eine tragfaehige Fallzahl voraus und "
            "beschreibt diesen Fall nicht - hier wird angehalten, nicht "
            "sinngemaess entschieden.")
    return True


# ── Der Lauf ueber ein Fenster ───────────────────────────────────────────────

def zaehle_fenster(panel, arbeit_pfad, e2, fenster_name, siegel):
    """Dieselbe Datenstrecke wie scripts/studie-zaehlprobe.py::zaehle_fenster und
    scripts/studie-e4a-diagnose.py::diagnose_fenster - gelesen, nicht geraten.
    Nur der letzte Schritt ist ein anderer."""
    fenster = zp.FENSTER[fenster_name]
    if not (zp.REIFE_QUARTALE == e2.REIFE_QUARTALE == e4a.zp.REIFE_QUARTALE):
        raise KadenzFehler(
            "REIFE-ABBRUCH: die drei beteiligten Skripte fuehren "
            + str((zp.REIFE_QUARTALE, e2.REIFE_QUARTALE, e4a.zp.REIFE_QUARTALE))
            + " Folgequartale. Drei Schwellen fuer dieselbe Sache heisst: keine.")
    zaehler = defaultdict(int)
    berichte, _fj, _q, _fye = e2.lade_berichte(panel, zaehler)
    arbeit = e2.oeffne_zwischenstand(arbeit_pfad, True)
    try:
        e2.lies_rohwerte(panel, arbeit, berichte, zaehler, False)
        je_firma = e2.pit_reduktion(arbeit, zaehler)
    finally:
        arbeit.close()
    kurz = zp.kurzpfad(os.path.abspath(arbeit_pfad))
    if kurz not in zp.GESCHRIEBENE_PFADE:
        zp.GESCHRIEBENE_PFADE.append(kurz)

    rand_ordinal = e2.ordinal(fenster["rand"].replace("-", ""))
    familien = (("S-U", e2.UMSATZ_QUELLEN, True, "umsatz_"),
                ("S-G", e2.ERGEBNIS_QUELLEN, False, "betriebsergebnis_"))
    vorbereitet = {}
    for name, quellen, nur_positiv, praefix in familien:
        alle, gewaehlt = e2.firmenreihen(je_firma, quellen, nur_positiv, zaehler,
                                         praefix)
        _g, a_saetze = e2.wachstum_und_beschleunigung(alle, zaehler, praefix)
        feuerungen, auswertbar, _grenzen = e2.signale(a_saetze, zp.PERZENTIL,
                                                      zaehler, praefix)
        vorbereitet[name] = (feuerungen, auswertbar, gewaehlt)

    baender = {}
    for rolle, von, bis in BAENDER[fenster_name]:
        bins = histogramm_bins(von, rand_ordinal)
        varianten = {}
        for name, (feuerungen, auswertbar, gewaehlt) in vorbereitet.items():
            band_f = [f for f in feuerungen if e4a.e2_im_band(f, e2, von, bis)]
            band_a = [a for a in auswertbar if e4a.e2_im_band(a, e2, von, bis)]
            signalfirmen = set(f["cik"] for f in band_f)
            kontroll = [a for a in band_a if a["cik"] not in signalfirmen]
            signal = zaehle_arm(band_f, gewaehlt, e2, rand_ordinal, bins)
            kontrolle = zaehle_arm(kontroll, gewaehlt, e2, rand_ordinal, bins)
            ampel, differenz = entscheide(signal, kontrolle, siegel)
            varianten[name] = {"signal": signal, "kontrolle": kontrolle,
                               "ampel": ampel,
                               "differenz_auffindbarkeit": differenz}
        baender["%d-%d" % (von, bis)] = {
            "von": von, "bis": bis, "rolle": rolle, "varianten": varianten}
    return baender


def pruefe_anker(baender, fenster_name):
    """W8: die veroeffentlichten Zahlen von E3 und E4a muessen exakt herauskommen -
    im E3-BLOCK, also mit dem alten Kriterium und der alten Formel.

    Das ist der einzige harte Beweis, dass diese Zaehlung dieselbe Strecke misst
    wie der Befund, den sie korrigieren soll. Eine Abweichung wird NICHT als
    Rundung durchgewunken - sie bricht ab."""
    geprueft = []
    for (fenster, rolle), erwartung in sorted(ANKER.items()):
        if fenster != fenster_name:
            continue
        treffer = [b for b in baender.values() if b["rolle"] == rolle]
        if len(treffer) != 1:
            raise KadenzFehler(
                "W8-ABBRUCH: fuer den Anker '" + rolle + "' liegen "
                + str(len(treffer)) + " Baender vor, erwartet ist genau eines.")
        band = treffer[0]
        for arm in ARME:
            for vname, felder in sorted((erwartung[arm]).items()):
                ist = band["varianten"][vname][arm]
                for feld, soll in sorted(felder.items()):
                    if ist[feld] != soll:
                        raise KadenzFehler(
                            "W8-ABBRUCH: Anker " + rolle + "/" + vname + "/"
                            + arm + "/" + feld + " ist " + str(ist[feld])
                            + ", veroeffentlicht ist " + str(soll) + " ("
                            + erwartung["quelle"] + "). Diese Zaehlung misst "
                            "dann nicht die Strecke, deren Befund sie "
                            "korrigieren soll.")
                geprueft.append(rolle + "/" + vname + "/" + arm + " gegen "
                                + erwartung["quelle"])
    if not geprueft:
        raise KadenzFehler(
            "W8-ABBRUCH: fuer Fenster '" + fenster_name + "' ist kein Anker "
            "hinterlegt. Ein Lauf ohne Anker belegt nicht, dass er dieselbe "
            "Strecke misst.")
    return sorted(set(geprueft))


# ── W3: die Ergebnis-Sperre ──────────────────────────────────────────────────

def pruefe_ausgabe(ausgabe):
    """Jeder nicht gelistete Schluessel ist ein ABBRUCH, in BEIDE Richtungen -
    ein fehlendes Pflichtfeld ist genauso rot wie ein zusaetzliches, sonst liesse
    sich ein unbequemer Zaehler durch Weglassen entschaerfen.

    Zusaetzlich eine TYPPRUEFUNG: Zaehlfelder sind nicht negative ganze Zahlen,
    Quoten liegen in [0,1] oder sind None. Ein durchgereichter Umsatz- oder
    Wachstumswert faellt damit auf, auch wenn er sich unter einem erlaubten
    Namen versteckt."""
    fremd = sorted(set(ausgabe) - set(UMSCHLAG_ALLOWLIST))
    if fremd:
        raise KadenzFehler("W3-ABBRUCH: der Umschlag traegt nicht gelistete "
                           "Schluessel: " + ", ".join(fremd))
    fehlend = sorted(set(UMSCHLAG_ALLOWLIST) - set(ausgabe))
    if fehlend:
        raise KadenzFehler("W3-ABBRUCH: dem Umschlag fehlen Pflichtfelder: "
                           + ", ".join(fehlend))
    baender = ausgabe.get("baender") or {}
    if not baender:
        raise KadenzFehler(
            "W3-ABBRUCH: die Ausgabe fuehrt kein einziges Band. Eine Ausgabe "
            "ohne Ergebnis-Kern haette die Pruefung sonst bestanden.")
    for bandname, band in baender.items():
        if sorted(band) != sorted(BAND_BLOCK):
            raise KadenzFehler(
                "W3-ABBRUCH: Band " + bandname + " fuehrt " + str(sorted(band))
                + ", erlaubt ist " + str(sorted(BAND_BLOCK)) + ".")
        varianten = band["varianten"]
        if sorted(varianten) != ["S-G", "S-U"]:
            raise KadenzFehler(
                "W3-ABBRUCH: Band " + bandname + " fuehrt die Varianten "
                + str(sorted(varianten)) + ", erwartet sind ['S-G', 'S-U'].")
        for vname, variante in varianten.items():
            if sorted(variante) != sorted(VARIANTEN_BLOCK):
                raise KadenzFehler(
                    "W3-ABBRUCH: Variante " + vname + " in Band " + bandname
                    + " fuehrt " + str(sorted(variante)) + ", erwartet ist "
                    + str(sorted(VARIANTEN_BLOCK)) + ".")
            if variante["ampel"] not in (zp.AMPEL_GRUEN, zp.AMPEL_ROT):
                raise KadenzFehler(
                    "W3-ABBRUCH: Variante " + vname + " meldet die unbekannte "
                    "Ampel " + repr(variante["ampel"]) + ".")
            differenz = variante["differenz_auffindbarkeit"]
            if differenz is not None and not (
                    isinstance(differenz, float) and 0.0 <= differenz <= 1.0):
                raise KadenzFehler(
                    "W3-ABBRUCH: Variante " + vname + " meldet die Differenz "
                    + repr(differenz) + " - erwartet ist eine Zahl in [0,1] "
                    "oder NICHT BERECHENBAR.")
            for aname in ARME:
                pruefe_block(variante[aname], bandname + "/" + vname + "/" + aname)
    return True


def pruefe_block(block, ort):
    if not isinstance(block, dict):
        raise KadenzFehler("W3-ABBRUCH: " + ort + " ist kein Block.")
    fremd = sorted(set(block) - set(ARM_BLOCK))
    if fremd:
        raise KadenzFehler(
            "W3-ABBRUCH: " + ort + " gibt nicht gelistete Groessen aus: "
            + ", ".join(fremd) + ". Genau das ist die Ergebnis-Sperre (R4) - ein "
            "Wert, der in den Output leckt, macht die ganze Studie wertlos.")
    fehlend = sorted(set(ARM_BLOCK) - set(block))
    if fehlend:
        raise KadenzFehler("W3-ABBRUCH: " + ort + " fehlen Pflichtgroessen: "
                           + ", ".join(fehlend))
    for feld in ZAEHL_FELDER:
        wert = block[feld]
        if not isinstance(wert, int) or isinstance(wert, bool) or wert < 0:
            raise KadenzFehler(
                "W3-ABBRUCH: " + ort + "/" + feld + " ist " + repr(wert)
                + " - erwartet ist eine nicht-negative ganze Zahl. Ein "
                "Nachkommawert an dieser Stelle waere ein durchgereichter "
                "Messwert, kein Zaehler.")
    for feld in QUOTEN_FELDER:
        wert = block[feld]
        if wert is None:
            continue
        if not isinstance(wert, float) or not (0.0 <= wert <= 1.0):
            raise KadenzFehler(
                "W3-ABBRUCH: " + ort + "/" + feld + " ist " + repr(wert)
                + " - eine Quote liegt in [0,1] oder ist NICHT BERECHENBAR.")
    hist = block[HISTOGRAMM_FELD]
    if not isinstance(hist, dict) or not hist:
        raise KadenzFehler("W3-ABBRUCH: " + ort + "/" + HISTOGRAMM_FELD
                           + " ist kein gefuellter Block.")
    for schluessel, wert in hist.items():
        teile = str(schluessel).split("-")
        if len(teile) != 2 or not all(t.isdigit() for t in teile):
            raise KadenzFehler(
                "W3-ABBRUCH: " + ort + "/" + HISTOGRAMM_FELD + " traegt das Fach "
                + repr(schluessel) + " - erwartet ist ein Tagesbereich "
                "'von-bis'.")
        if not isinstance(wert, int) or isinstance(wert, bool) or wert < 0:
            raise KadenzFehler(
                "W3-ABBRUCH: " + ort + "/" + HISTOGRAMM_FELD + "/"
                + str(schluessel) + " ist " + repr(wert) + " - ein Histogramm "
                "zaehlt Firmen, es misst nichts.")
    return True


# ── Lauf ─────────────────────────────────────────────────────────────────────

def lauf(fenster_name, freigabe_pfad, data_root=None, arbeit=None, ziel=None,
         siegel_voll=True, panel_pfad=None, register_pfad=None,
         freeze_pfad=FREEZE):
    fenster = zp.FENSTER.get(fenster_name)
    if fenster is None:
        raise KadenzFehler("Unbekanntes Fenster: " + str(fenster_name))
    if fenster["sperrzone"]:
        raise KadenzFehler(
            "SPERRZONE-STOPP: Fenster '" + fenster_name + "' wird nicht "
            "geoeffnet. Karls Wort vom 19.08.2026: 'Studien-Endtest ist "
            "VERSCHLUESSELT: nicht oeffnen, keinen Oeffner bauen.' Diese Datei "
            "enthaelt keinen Entschluesselungs-Aufruf, und es soll auch keiner "
            "hinein.")
    if fenster_name not in BAENDER:
        raise KadenzFehler(
            "Fuer Fenster '" + fenster_name + "' ist kein Band hinterlegt.")

    del zp.GEOEFFNETE_PFADE[:]
    del zp.GESCHRIEBENE_PFADE[:]

    siegel = lies_freeze(freeze_pfad)
    siegel_sha = sha256_datei(freeze_pfad)
    manifest = zp.pruefe_manifest()
    freigabe = zp.lies_freigabe(freigabe_pfad, fenster_name)
    pruefe_anmeldung_deckt_ausgabe(freigabe, register_pfad)
    pruefe_siegel_im_register(freigabe, siegel_sha, register_pfad)
    wurzel = zp.datenwurzel(data_root)

    erster_zugriff = zp.zeitstempel()
    zp.pruefe_serverzeit(freigabe, erster_zugriff)
    wache = zp.siegel_wache(wurzel, voll=siegel_voll)

    if panel_pfad is None:
        panel_pfad = os.path.join(wurzel, "panel", fenster["datei"])
    arbeit_pfad = arbeit or os.path.join(
        wurzel, "arbeit", "E4d-" + fenster_name + "-zwischenstand.sqlite")

    e2 = zp.lade_modul(zp.E2_SKRIPT, "studie_basisraten")
    panel = zp.oeffne_nur_lesend(panel_pfad, fenster_name)
    try:
        baender = zaehle_fenster(panel, arbeit_pfad, e2, fenster_name, siegel)
    finally:
        panel.close()

    ampel_entscheidung = None
    if fenster_name == ENTSCHEIDUNGS_FENSTER:
        for band in baender.values():
            variante = band["varianten"][ENTSCHEIDUNGS_VARIANTE]
            pruefe_fallzahl_deckt_regel(
                variante["signal"], siegel,
                ENTSCHEIDUNGS_FENSTER + "/" + ENTSCHEIDUNGS_VARIANTE)
            ampel_entscheidung = variante["ampel"]

    ausgabe = {
        "schema": SCHEMA,
        "protokoll": zp.PROTOKOLL,
        "runId": freigabe["runId"],
        "fenster": fenster_name,
        "panelRand": fenster["rand"],
        "perzentil": zp.PERZENTIL,
        "serverConfirmedAt": freigabe["serverConfirmedAt"],
        "accessedAt": freigabe["accessedAt"],
        "ersterZugriffAm": erster_zugriff,
        "beendetAm": zp.zeitstempel(),
        "gelesenePfade": sorted(zp.GEOEFFNETE_PFADE),
        "geschriebenePfade": sorted(zp.GESCHRIEBENE_PFADE),
        "ergebnisdatenBeruehrt": False,
        "siegelWache": wache,
        "manifestGeprueft": sorted(manifest),
        "freezeGeprueft": {"datei": zp.kurzpfad(os.path.abspath(freeze_pfad)),
                           "sha256": siegel_sha,
                           "skriptSha256": siegel["skriptSha256"]},
        "entscheidungsregel": siegel["entscheidungsregel"]["kurzform"],
        "ampelEntscheidung": ampel_entscheidung,
        "umgebung": {"plattform": sys.platform, "python": platform.python_version(),
                     "sqlite": sqlite3.sqlite_version},
        "ankerGeprueft": pruefe_anker(baender, fenster_name),
        "baender": baender,
    }
    pruefe_ausgabe(ausgabe)
    if ziel:
        os.makedirs(os.path.dirname(os.path.abspath(ziel)), exist_ok=True)
        with open(ziel, "w", encoding="utf-8", newline="\n") as f:
            json.dump(ausgabe, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
    return ausgabe


# ── Selbsttest ───────────────────────────────────────────────────────────────

FEHLER = []


def pruefe(name, bedingung, ist=None, soll=None):
    if bedingung:
        print("  ok    " + name)
    else:
        FEHLER.append(name)
        print("  ROT   " + name)
        if ist is not None or soll is not None:
            print("        (ist: %r | soll: %r)" % (ist, soll))


# Das Raster des Fixtures: 2014q1 .. 2020q3. Weiter reicht es nicht, weil ein
# Bericht zum Stichtag 2020-12-31 erst 2021 angenommen wuerde und damit hinter
# dem Panelrand laege - das Fixture bildet den Panelschnitt nach.
QUARTALE = [(j, m) for j in range(2014, 2021) for m in (3, 6, 9, 12)][:27]
MELDEVERZUG_TAGE = 45
MARKER_WERT = 0.777
CIK_REIF = "410001"          # quartalsweise, feuert 2017, reif, nie zensiert
CIK_C_FERN = "420001"        # quartalsweise, feuert 2017, drei Folgequartale
CIK_C_NAH = "430001"         # quartalsweise, feuert 2019, drei Folgequartale
CIK_LANGSAM_UNREIF = "440001"  # lange Kadenz, feuert 2019, zwei Folgequartale
CIK_LANGSAM_REIF = "450001"    # lange Kadenz, feuert 2019, vier Folgequartale
ALLE_CIK = (CIK_REIF, CIK_C_FERN, CIK_C_NAH, CIK_LANGSAM_UNREIF,
            CIK_LANGSAM_REIF)


def _index(jahr, monat):
    return QUARTALE.index((jahr, monat))


def _quartalsende(index):
    jahr, monat = QUARTALE[index]
    tag = 31 if monat in (3, 12) else 30
    return "%04d%02d%02d" % (jahr, monat, tag)


def _accepted(ddate):
    o = date(int(ddate[:4]), int(ddate[4:6]), int(ddate[6:])).toordinal()
    return date.fromordinal(o + MELDEVERZUG_TAGE).strftime("%Y-%m-%d") + " 12:00:00.0"


def baue_kadenz_fixture(pfad, hintergrund=260):
    """Ein Fixture, das den Unterschied WIRKLICH TRAEGT.

    Die Lehre vom 19.08.: Sabotagen bleiben gruen, wenn das Fixture den
    Unterschied gar nicht zeigen kann. Fuer diese Etappe heisst das drei Dinge:

      * CIK_LANGSAM_UNREIF und CIK_LANGSAM_REIF haben eine LANGE Melde-Kadenz
        (jahrweise Vorgeschichte, erst kurz vor dem Signal quartalsweise). Sie
        sind unter E3s 80-Tage-Kriterium NICHT zensiert und unter dem
        Kadenz-Kriterium SCHON - ohne sie zeigt die Sabotage des Kriteriums
        nichts.
      * CIK_LANGSAM_REIF ist zusaetzlich REIF. Nur an ihr laesst sich die
        Formel-Korrektur pruefen: die alte Formel zaehlt sie im Zaehler mit und
        laesst sie im Nenner weg, die konsistente wirft sie aus beiden.
      * CIK_C_NAH liegt genauso nah am Rand wie die langsamen Firmen, meldet
        aber quartalsweise. Sie darf NICHT zensiert werden - sonst waere das
        Kriterium eine verkappte Randregel und keine Kadenzregel.
    """
    if os.path.isfile(pfad):
        os.remove(pfad)
    os.makedirs(os.path.dirname(os.path.abspath(pfad)), exist_ok=True)
    conn = sqlite3.connect(pfad, isolation_level=None)
    zaehlwerk = [0]

    def schreibe(cik, ddate, wert):
        zaehlwerk[0] += 1
        adsh = "B%06d" % zaehlwerk[0]
        conn.execute("INSERT INTO bericht VALUES (?,?,?,?,?,?,?,?)",
                     (adsh, cik, "FIRMA " + cik, "3674", "1231", "10-Q", ddate,
                      _accepted(ddate)))
        for tag in ("Revenues", "OperatingIncomeLoss"):
            conn.execute("INSERT INTO fakt VALUES (?,?,?,?,?,?,?,?,?)",
                         (adsh, tag, "us-gaap/2016", "", ddate, "1", "USD",
                          wert, ""))

    def linear(n):
        return [100.0 + 2.0 * i for i in range(n)]

    def mit_sprung(werte, sprung_bei):
        """Zwei Stufen: a(s) > 0 und a(s+1) > 0, danach wieder negativ. Die Firma
        feuert damit GENAU EINMAL, naemlich bei s+1. Linear statt prozentual
        konstant, weil bei konstanter Rate a exakt null ist und das Vorzeichen
        des Rundungsfehlers entscheidet."""
        werte = list(werte)
        for versatz, faktor in ((0, 1.8), (1, 3.2)):
            for i in range(sprung_bei + versatz, len(werte)):
                werte[i] *= faktor
        return werte

    def quartalsreihe(cik, von_i, bis_i, sprung_bei=None, marker_bei=None):
        indizes = list(range(von_i, bis_i + 1))
        werte = linear(len(indizes))
        if sprung_bei is not None:
            werte = mit_sprung(werte, indizes.index(sprung_bei))
        for i, wert in zip(indizes, werte):
            schreibe(cik, _quartalsende(i),
                     MARKER_WERT if i == marker_bei else round(wert, 4))

    def langsame_reihe(cik, folge_indizes):
        """Jahrweise Vorgeschichte 2011-2018, dann quartalsweise bis zum Signal
        im Quartal 2019q3. Der Median der Stichtags-Abstaende liegt damit bei
        einem Jahr, nicht bei einem Quartal - genau das ist der Unterschied, den
        das Kriterium sehen soll. `folge_indizes` sind die Folgequartale NACH
        dem Signal."""
        jahre = ["%04d0331" % j for j in range(2011, 2019)]
        vorlauf = [_quartalsende(_index(2018, 6)), _quartalsende(_index(2018, 9)),
                   _quartalsende(_index(2019, 3)), _quartalsende(_index(2019, 6)),
                   _quartalsende(_index(2019, 9))]
        ddates = jahre + vorlauf
        werte = mit_sprung(linear(len(ddates)), len(ddates) - 2)
        for ddate, wert in zip(ddates, werte):
            schreibe(cik, ddate, round(wert, 4))
        # Die Folgequartale tragen den Wert der Sprungstufe weiter; ihre Hoehe
        # ist fuer die Reife ohne Belang - gezaehlt wird ihre EXISTENZ.
        for i in folge_indizes:
            schreibe(cik, _quartalsende(i), round(werte[-1] * 1.01, 4))

    try:
        conn.execute("CREATE TABLE bericht (adsh TEXT PRIMARY KEY, cik TEXT,"
                     " name TEXT, sic TEXT, fye TEXT, form TEXT, period TEXT,"
                     " accepted TEXT)")
        conn.execute("CREATE TABLE fakt (adsh TEXT, tag TEXT, version TEXT,"
                     " coreg TEXT, ddate TEXT, qtrs TEXT, uom TEXT, value REAL,"
                     " footnote TEXT)")
        conn.execute("PRAGMA synchronous=OFF")
        conn.execute("BEGIN")
        ende = len(QUARTALE) - 1
        for n in range(hintergrund):
            quartalsreihe("9%05d" % n, 0, ende)
        # Sprung bei 2016q4 -> Feuerung 2017q1 (Stichtag 2017-03-31, angenommen
        # 2017-05-15). Nachgerechnet, nicht geraten.
        quartalsreihe(CIK_REIF, 0, ende, sprung_bei=_index(2016, 12),
                      marker_bei=_index(2019, 6))
        quartalsreihe(CIK_C_FERN, 0, _index(2017, 12),
                      sprung_bei=_index(2016, 12))
        # Sprung bei 2019q2 -> Feuerung 2019q3 (Stichtag 2019-09-30, angenommen
        # 2019-11-14): 413 Tage vor dem Panelrand. Quartalsweise Kadenz, also
        # 4 * 91,25 = 365 < 413 -> NICHT zensiert.
        quartalsreihe(CIK_C_NAH, 0, _index(2020, 6), sprung_bei=_index(2019, 6))
        langsame_reihe(CIK_LANGSAM_UNREIF,
                       [_index(2019, 12), _index(2020, 3)])
        langsame_reihe(CIK_LANGSAM_REIF,
                       [_index(2019, 12), _index(2020, 3), _index(2020, 6),
                        _index(2020, 9)])
        conn.execute("COMMIT")
    finally:
        conn.close()


def _fixture_lauf(verzeichnis, e2, siegel):
    panel_pfad = os.path.join(verzeichnis, "panel-validierung.sqlite")
    baue_kadenz_fixture(panel_pfad)
    panel = sqlite3.connect("file:" + panel_pfad.replace("\\", "/") + "?mode=ro",
                            uri=True)
    try:
        return zaehle_fenster(panel, os.path.join(verzeichnis, "zwischen.sqlite"),
                              e2, "pruefung", siegel)
    finally:
        panel.close()


def _fixture_siegel():
    """Ein Siegel fuer den Selbsttest - mit denselben Schwellen wie das echte,
    damit der Selbsttest nicht am Siegel vorbei laeuft."""
    return {"entscheidungsregel": {
        "minimum": zp.AUFFINDBARKEIT_MIN,
        "maxDifferenz": zp.AUFFINDBARKEIT_MAX_DIFFERENZ,
        "fallzahlMin": zp.FALLZAHL_MIN,
        "kurzform": "Selbsttest",
        "gruen": "-", "rot": "-", "bedingungen": []}}


def _arm(kadenz, alt, reif, klasse_c=0, bins=("0-90",), hist=None):
    """Ein von Hand gebauter Arm-Block - fuer die Pruefungen, die keine ganze
    Datenstrecke brauchen."""
    block = leerer_block(bins)
    block.update(kadenz)
    block["zensiert_e3"] = alt
    block["fallzahl"] = reif
    block["klasse_c_firmen"] = klasse_c
    if hist:
        block[HISTOGRAMM_FELD] = dict(hist)
    return block


def _fertig(firmen, reif, zensiert_e3, zensiert_kadenz, reif_und_zensiert,
            klasse_c=0):
    block = leerer_block(("0-90",))
    block["firmen_mit_erst_ereignis"] = firmen
    block["fallzahl"] = reif
    block["zensiert_e3"] = zensiert_e3
    block["zensiert_kadenz"] = zensiert_kadenz
    block["zensiert_kadenz_und_reif"] = reif_und_zensiert
    block["klasse_c_firmen"] = klasse_c
    block[HISTOGRAMM_FELD] = {"0-90": klasse_c}
    block["nenner_e3"] = firmen - zensiert_e3
    block["nenner_kadenz"] = firmen - zensiert_kadenz
    block["zaehler_kadenz"] = reif - reif_und_zensiert
    block["auffindbarkeit_e3"] = quote_e3(reif, block["nenner_e3"])
    block["auffindbarkeit_kadenz_e3formel"] = quote_e3(reif,
                                                       block["nenner_kadenz"])
    block["auffindbarkeit_kadenz"] = quote_konsistent(block["zaehler_kadenz"],
                                                      block["nenner_kadenz"])
    return block


def _bricht(fn, *args):
    try:
        fn(*args)
    except KadenzFehler:
        return True
    return False


def _kadenz(ddates, signal_ddate=None, accepted=None, rand="20201231"):
    """Ruft kadenz_zensiert() mit einer von Hand gebauten Reihe auf - ohne
    Datenstrecke, damit die Regel selbst geprueft wird und nicht ihre Umgebung."""
    e2 = zp.lade_modul(zp.E2_SKRIPT, "studie_basisraten")
    signal_ddate = signal_ddate or ddates[-1]
    reihe = dict((d, (1.0, _accepted(d), "direkt", ("Revenues", "USD")))
                 for d in ddates)
    f = {"cik": "X", "ddate": signal_ddate,
         "accepted": accepted or _accepted(signal_ddate),
         "basis": ("Revenues", "USD")}
    return kadenz_zensiert(f, {"X": reihe}, e2, e2.ordinal(rand))


def selbsttest():
    import shutil
    import tempfile
    verzeichnis = tempfile.mkdtemp(prefix="e4d-kadenz-")
    print("Selbsttest in " + verzeichnis)
    siegel = _fixture_siegel()
    try:
        e2 = zp.lade_modul(zp.E2_SKRIPT, "studie_basisraten")

        print("\n[1] Das Kadenz-Kriterium direkt - ohne Datenstrecke")
        quartale = ["%04d%02d%02d" % (j, m, 31 if m in (3, 12) else 30)
                    for j in range(2014, 2020) for m in (3, 6, 9, 12)]
        # Quartalsweise Melderin, Signal 2019-09-30 (angenommen 2019-11-14),
        # 413 Tage vor dem Rand: 4 * 91,25 = 365 < 413 -> nicht zensiert.
        quartalsweise = _kadenz(quartale[:-1])
        pruefe("quartalsweise Melderin nahe am Rand: NICHT zensiert",
               quartalsweise[0] is False, quartalsweise[0], False)
        # Dieselbe Firma, dieselbe Stelle - nur jahrweise gemeldet.
        jahresweise = _kadenz(["%04d0331" % j for j in range(2011, 2020)]
                              + ["20190930"])
        pruefe("jahrweise Melderin an derselben Stelle: ZENSIERT",
               jahresweise[0] is True, jahresweise[0], True)
        pruefe("und E3s 80-Tage-Kriterium sieht bei ihr NICHTS - genau das ist "
               "der Unterschied, den die Sabotage braucht",
               zp.ist_zensiert({"accepted": _accepted("20190930")}, e2,
                               e2.ordinal("20201231")) is False)
        pruefe("die dokumentierte Untergrenze greift bei einer schnelleren "
               "Meldefolge", _kadenz(["20190101", "20190201", "20190301"])[1] is True)
        pruefe("und sie greift NICHT bei einer quartalsweisen Melderin",
               quartalsweise[1] is False, quartalsweise[1], False)
        pruefe("eine Firma mit nur einem Quartal vor dem Signal bricht ab",
               _bricht(_kadenz, ["20190930"]))
        pruefe("eine Firma ohne gewaehlte Reihe bricht ab",
               _bricht(melde_kadenz, {"cik": "X", "ddate": "20190930"}, {}, e2))
        # Der Anker ist accepted, nicht ddate: DIESELBE Stichtagsreihe, nur
        # spaeter gemeldet - und die Zensur kippt. Waere der Anker der
        # Bilanzstichtag, aendere sich hier nichts.
        spaet = _kadenz(quartale[:-1], accepted="2020-06-01 12:00:00.0")
        pruefe("der Anker ist der Melde-Eingang, nicht der Bilanzstichtag",
               (quartalsweise[0], spaet[0]) == (False, True),
               (quartalsweise[0], spaet[0]), (False, True))
        # DIE STATISTIK DIREKT. Ohne diese Pruefung stuende im Siegel 'median',
        # waehrend der Code heimlich Mittelwert oder Maximum rechnete - und der
        # Siegel-Waechter W12 haette es nicht gemerkt, weil er nur Zeichenketten
        # vergleicht. Abstaende 100/120/400: Median 120, Mittel rund 207,
        # Maximum 400. Nur einer dieser drei Werte kommt hier heraus.
        basis = date(2016, 1, 4).toordinal()
        drei = [date.fromordinal(basis + o).strftime("%Y%m%d")
                for o in (0, 100, 220, 620)]
        gemessen, _g = melde_kadenz(
            {"cik": "X", "ddate": drei[-1]},
            {"X": dict((d, (1.0, _accepted(d), "direkt", ("Revenues", "USD")))
                       for d in drei)}, e2)
        pruefe("die Kadenz ist der MEDIAN der Abstaende (120), nicht der "
               "Mittelwert (rund 207) und nicht das Maximum (400)",
               gemessen == 120.0, gemessen, 120.0)

        print("\n[2] Die konsistente Formel gegen die geerbte (E4e)")
        pruefe("ohne zensierte Faelle sind beide Formeln GLEICH",
               quote_e3(90, 100) == quote_konsistent(90, 100))
        # Zehn Firmen, fuenf zensiert, davon zwei reif: die geerbte Formel
        # rechnet 7/5 - keine Quote -, die konsistente 5/5.
        pruefe("die geerbte Formel liefert an der Kante NICHT BERECHENBAR",
               quote_e3(7, 5) is None, quote_e3(7, 5), None)
        pruefe("die konsistente Formel liefert dort eine echte Quote",
               quote_konsistent(5, 5) == 1.0)
        pruefe("und ein Zaehler ueber dem Nenner bricht bei ihr AB, statt zu "
               "runden", _bricht(quote_konsistent, 7, 5))
        # Der messbare Unterschied: 8 reife von 10, 2 davon zensiert.
        alt = quote_e3(8, 8)
        neu = quote_konsistent(6, 8)
        pruefe("die Formel-Korrektur aendert die Quote MESSBAR (1,000 -> 0,750)",
               alt == 1.0 and neu == 0.75, (alt, neu), (1.0, 0.75))

        print("\n[3] Die verriegelte Entscheidungsregel")
        knapp_drueber = _fertig(362, 326, 0, 0, 0)
        pool_gut = _fertig(4733, 4285, 0, 0, 0)
        pruefe("Signal 90,06 % und Pool 90,53 % -> GRUEN",
               entscheide(knapp_drueber, pool_gut, siegel)[0] == zp.AMPEL_GRUEN)
        knapp_drunter = _fertig(365, 326, 0, 0, 0)
        pruefe("Signal 89,32 % bei gutem Pool -> ROT (die Schwelle liegt "
               "wirklich dazwischen)",
               entscheide(knapp_drunter, pool_gut, siegel)[0] == zp.AMPEL_ROT)
        pool_schlecht = _fertig(4733, 4200, 0, 0, 0)
        pruefe("gutes Signal, aber Pool unter 90 % -> ROT",
               entscheide(knapp_drueber, pool_schlecht, siegel)[0] == zp.AMPEL_ROT)
        weit_auseinander = _fertig(1000, 1000, 0, 0, 0)
        pruefe("beide ueber 90 %, aber mehr als 10 Punkte auseinander -> ROT",
               entscheide(weit_auseinander, _fertig(1000, 899, 0, 0, 0),
                          siegel)[0] == zp.AMPEL_ROT)
        pruefe("eine nicht berechenbare Quote heisst ROT, nie GRUEN",
               entscheide(_fertig(0, 0, 0, 0, 0), pool_gut, siegel)
               == (zp.AMPEL_ROT, None))
        pruefe("die Regel nimmt ihre Schwellen aus dem Siegel, nicht aus sich "
               "selbst",
               entscheide(knapp_drueber, pool_gut,
                          {"entscheidungsregel": dict(
                              siegel["entscheidungsregel"], minimum=0.95)})[0]
               == zp.AMPEL_ROT)
        pruefe("eine zu kleine Fallzahl bricht ab, statt sinngemaess zu "
               "entscheiden",
               _bricht(pruefe_fallzahl_deckt_regel, _fertig(210, 199, 0, 0, 0),
                       siegel, "test"))

        print("\n[4] Die Zaehl-Invarianten")
        pruefe("ein gueltiger Block geht DURCH",
               pruefe_blockinvarianten(_fertig(10, 8, 0, 2, 1, klasse_c=1)) is True)
        pruefe("weniger Kadenz- als E3-Zensuren bricht ab (Richtungs-Invariante)",
               _bricht(pruefe_blockinvarianten,
                       dict(_fertig(10, 8, 2, 2, 0), zensiert_kadenz=1)))
        pruefe("ein Histogramm, das nicht auf Klasse (c) aufgeht, bricht ab",
               _bricht(pruefe_blockinvarianten,
                       dict(_fertig(10, 8, 0, 0, 0, klasse_c=2),
                            **{HISTOGRAMM_FELD: {"0-90": 1}})))
        pruefe("ein Nenner, der nicht aufgeht, bricht ab",
               _bricht(pruefe_blockinvarianten,
                       dict(_fertig(10, 8, 0, 2, 1, klasse_c=1), nenner_kadenz=9)))
        pruefe("mehr reif-und-zensiert als zensiert bricht ab",
               _bricht(pruefe_blockinvarianten,
                       dict(_fertig(10, 8, 0, 1, 1, klasse_c=1),
                            zensiert_kadenz_und_reif=2)))

        print("\n[5] Die Bin-Kanten des Histogramms")
        bins = histogramm_bins(2017, e2.ordinal("20201231"))
        pruefe("die Faecher beginnen bei 0 und sind 91 Tage breit",
               bins[0] == "0-90" and bins[1] == "91-181", bins[:2],
               ["0-90", "91-181"])
        pruefe("die Faecher decken das ganze Band ab (1460 Tage)",
               len(bins) == 17, len(bins), 17)
        pruefe("ein Abstand faellt in das Fach, das zu ihm gehoert",
               (bin_fuer(0), bin_fuer(90), bin_fuer(91), bin_fuer(413))
               == ("0-90", "0-90", "91-181", "364-454"))
        pruefe("die Faecher haengen am BAND, nicht an den Daten",
               histogramm_bins(2009, e2.ordinal("20161231")) != bins)

        print("\n[6] Die ganze Strecke am Fixture")
        baender = _fixture_lauf(verzeichnis, e2, siegel)
        su = baender["2017-2019"]["varianten"]["S-U"]["signal"]
        pruefe("das Fixture erzeugt genau fuenf Erst-Ereignis-Firmen",
               su["firmen_mit_erst_ereignis"] == 5,
               su["firmen_mit_erst_ereignis"], 5)
        pruefe("E3s Kriterium zensiert im Fixture NICHTS",
               su["zensiert_e3"] == 0, su["zensiert_e3"], 0)
        pruefe("das Kadenz-Kriterium zensiert genau die beiden langsamen Firmen",
               su["zensiert_kadenz"] == 2, su["zensiert_kadenz"], 2)
        pruefe("genau eine der beiden ist REIF - ohne sie zeigt die "
               "Formel-Sabotage nichts",
               su["zensiert_kadenz_und_reif"] == 1,
               su["zensiert_kadenz_und_reif"], 1)
        pruefe("die randnahe QUARTALSweise Firma bleibt unzensiert - das "
               "Kriterium ist eine Kadenzregel, keine Randregel",
               su["firmen_mit_erst_ereignis"] - su["zensiert_kadenz"] == 3)
        pruefe("die geerbte Formel zaehlt die reife ZENSIERTE Firma weiter mit: "
               "2 von 3", su["auffindbarkeit_kadenz_e3formel"] == 2.0 / 3.0,
               su["auffindbarkeit_kadenz_e3formel"], 2.0 / 3.0)
        pruefe("die konsistente Formel wirft sie aus BEIDEN Seiten: 1 von 3",
               su["auffindbarkeit_kadenz"] == 1.0 / 3.0,
               su["auffindbarkeit_kadenz"], 1.0 / 3.0)
        pruefe("die beiden Formeln liefern am selben Lauf VERSCHIEDENE Quoten - "
               "genau das ist die Sabotage der Formel-Korrektur",
               su["auffindbarkeit_kadenz"] != su["auffindbarkeit_kadenz_e3formel"])
        pruefe("Klasse (c) traegt drei Firmen (eine fern, zwei nah am Rand)",
               su["klasse_c_firmen"] == 3, su["klasse_c_firmen"], 3)
        hist = su[HISTOGRAMM_FELD]
        pruefe("das Histogramm setzt sie in ZWEI verschiedene Faecher - sonst "
               "koennte es Klumpen und Fluss nicht unterscheiden",
               len([b for b, n in hist.items() if n]) == 2,
               sorted(b for b, n in hist.items() if n), "zwei Faecher")
        pruefe("und es fuehrt auch die leeren Faecher",
               len(hist) == 17, len(hist), 17)
        pruefe("das Fixture traegt beide Arme",
               baender["2017-2019"]["varianten"]["S-U"]["kontrolle"][
                   "firmen_mit_erst_ereignis"] > 0)

        print("\n[7] Die Ergebnis-Sperre (W3)")
        umschlag = _beispiel_umschlag(baender)
        pruefe("die gueltige Ausgabe geht DURCH", pruefe_ausgabe(umschlag) is True)
        pruefe("ein geleckter Kennungsname fliegt auf",
               _fliegt_auf(umschlag, ["S-U", "signal"], "quelle_name", "Revenues"))
        pruefe("ein geleckter Wachstumswert fliegt am Typ auf",
               _fliegt_auf(umschlag, ["S-U", "signal"], "fallzahl", 1.53))
        pruefe("eine Quote ausserhalb [0,1] fliegt auf",
               _fliegt_auf(umschlag, ["S-U", "signal"], "auffindbarkeit_kadenz",
                           4.2))
        pruefe("eine WEGGELASSENE Pflichtgroesse fliegt auch auf",
               _fliegt_ohne(umschlag, ["S-U", "signal"], "zensiert_kadenz"))
        pruefe("ein Messwert im HISTOGRAMM fliegt auf",
               _fliegt_hist(umschlag, ["S-U", "signal"], "0-90", 0.42))
        pruefe("eine erfundene Ampel fliegt auf",
               _fliegt_variante(umschlag, "S-U", "ampel", "FAST_GRUEN"))
        pruefe("eine Ausgabe ohne Baender besteht die Pruefung NICHT",
               _fliegt(dict(umschlag, baender={})))

        print("\n[8] R4: kein Ergebniswert, keine Firmen-Kennung im Output")
        roh = json.dumps(umschlag, ensure_ascii=False, sort_keys=True)
        pruefe("kein Folgequartal-Wert im Output (Marker 0.777)",
               "0.777" not in roh)
        lecks = [c for c in ALLE_CIK if c in roh]
        pruefe("keine Firmen-Kennung im Output", not lecks, lecks, [])
        pruefe("kein Kennungsname im Output",
               "Revenues" not in roh and "OperatingIncomeLoss" not in roh)

        print("\n[9] Das Siegel dieser Etappe (W11/W12)")
        pruefe("das ausgelieferte Siegel passt zu diesem Code",
               _siegel_geht_durch())
        pruefe("ein veraenderter Skript-Hash im Siegel bricht ab",
               _siegel_bricht(verzeichnis, {"skriptSha256": "0" * 64}))
        pruefe("eine GESENKTE Schwelle im Siegel bricht ab - das Gate wird nicht "
               "angefasst",
               _siegel_bricht(verzeichnis, None, regel={"minimum": 0.85}))
        pruefe("eine geaenderte Hoechstdifferenz bricht ab",
               _siegel_bricht(verzeichnis, None, regel={"maxDifferenz": 0.2}))
        pruefe("eine andere Kadenz-Untergrenze im Siegel bricht ab",
               _siegel_bricht(verzeichnis, {"kadenzKriterium": {
                   "untergrenzeTage": 80.0, "statistik": "median"}}))
        pruefe("eine andere Kadenz-Statistik im Siegel bricht ab",
               _siegel_bricht(verzeichnis, {"kadenzKriterium": {
                   "untergrenzeTage": FISKALQUARTAL_TAGE, "statistik": "maximum"}}))
        pruefe("eine Allowlist, die die Ausgabe nicht deckt, bricht ab",
               _siegel_bricht(verzeichnis, {"ausgabeAllowlist": ["fallzahl"]}))
        pruefe("ein fehlendes Siegel heisst gar kein Lauf",
               _bricht(lies_freeze, os.path.join(verzeichnis, "gibtsnicht.json")))

        print("\n[10] Sperrzone Endtest")
        pruefe("das Endtest-Fenster wird nicht geoeffnet", _sperrzone_haelt())
        with open(SELBST, encoding="utf-8") as f:
            quelle = f.read().lower()
        # Zur Laufzeit zusammengesetzt, sonst stuende der Test in seinem eigenen
        # Suchraum und waere immer rot.
        verboten = ("de" + "crypt", "aes" + "-256", "ci" + "pher", "un" + "seal",
                    "open" + "ssl")
        gefunden = [w for w in verboten if w in quelle]
        pruefe("diese Datei enthaelt keinen Entschluesselungs-Aufruf",
               not gefunden, gefunden, "keine Fundstelle")
    finally:
        shutil.rmtree(verzeichnis, ignore_errors=True)

    if FEHLER:
        print("\nSELBSTTEST ROT - " + str(len(FEHLER)) + " Pruefung(en) gescheitert:")
        for name in FEHLER:
            print("  - " + name)
        return 1
    print("\nSELBSTTEST GRUEN - alle Pruefungen bestanden.")
    return 0


def _beispiel_umschlag(baender):
    return {
        "schema": SCHEMA, "protokoll": zp.PROTOKOLL, "runId": "selbsttest",
        "fenster": "pruefung", "panelRand": "2020-12-31", "perzentil": zp.PERZENTIL,
        "serverConfirmedAt": "2026-08-19T00:00:00.000Z",
        "accessedAt": "2026-08-19T00:00:01.000Z",
        "ersterZugriffAm": "2026-08-19T00:00:02.000Z",
        "beendetAm": "2026-08-19T00:00:03.000Z",
        "gelesenePfade": [], "geschriebenePfade": [], "ergebnisdatenBeruehrt": False,
        "siegelWache": {}, "manifestGeprueft": [], "umgebung": {},
        "freezeGeprueft": {}, "entscheidungsregel": "-", "ampelEntscheidung": None,
        "ankerGeprueft": [], "baender": baender,
    }


def _kopie(umschlag):
    return json.loads(json.dumps(umschlag))


def _fliegt(umschlag):
    try:
        pruefe_ausgabe(umschlag)
    except KadenzFehler:
        return True
    return False


def _fliegt_auf(umschlag, pfad, feld, wert):
    ziel = _kopie(umschlag)
    ziel["baender"]["2017-2019"]["varianten"][pfad[0]][pfad[1]][feld] = wert
    return _fliegt(ziel)


def _fliegt_ohne(umschlag, pfad, feld):
    ziel = _kopie(umschlag)
    del ziel["baender"]["2017-2019"]["varianten"][pfad[0]][pfad[1]][feld]
    return _fliegt(ziel)


def _fliegt_hist(umschlag, pfad, fach, wert):
    ziel = _kopie(umschlag)
    ziel["baender"]["2017-2019"]["varianten"][pfad[0]][pfad[1]][
        HISTOGRAMM_FELD][fach] = wert
    return _fliegt(ziel)


def _fliegt_variante(umschlag, variante, feld, wert):
    ziel = _kopie(umschlag)
    ziel["baender"]["2017-2019"]["varianten"][variante][feld] = wert
    return _fliegt(ziel)


def _siegel_geht_durch():
    try:
        lies_freeze()
        return True
    except KadenzFehler:
        return False


def _siegel_bricht(verzeichnis, aenderung, regel=None):
    """Baut eine KOPIE des ausgelieferten Siegels mit genau einer gekippten
    Stelle und prueft, dass sie abgewiesen wird. Ohne die Kopie wuerde die
    Sabotage am echten Siegel haengen bleiben."""
    if not os.path.isfile(FREEZE):
        return False
    with open(FREEZE, encoding="utf-8") as f:
        siegel = json.load(f)
    if aenderung:
        siegel.update(aenderung)
    if regel:
        siegel["entscheidungsregel"] = dict(siegel["entscheidungsregel"], **regel)
    pfad = os.path.join(verzeichnis, "siegel-sabotage.json")
    with open(pfad, "w", encoding="utf-8") as f:
        json.dump(siegel, f, ensure_ascii=False)
    try:
        lies_freeze(pfad)
    except KadenzFehler:
        return True
    return False


def _sperrzone_haelt():
    try:
        lauf("endtest", None)
    except KadenzFehler as fehler:
        return "SPERRZONE-STOPP" in str(fehler)
    return False


def siegeln(ziel=FREEZE):
    """Traegt den SHA-256 DIESER Datei in das Siegel ein.

    Reihenfolge: Skript fertig -> siegeln -> committen -> pushen -> anmelden ->
    Server-Bestaetigung -> Lauf. Wer danach am Skript etwas aendert, macht jeden
    Lauf rot (W11) - das ist der Zweck."""
    with open(ziel, encoding="utf-8") as f:
        siegel = json.load(f)
    siegel["skriptSha256"] = sha256_datei(SELBST)
    with open(ziel, "w", encoding="utf-8", newline="\n") as f:
        json.dump(siegel, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    print(siegel["skriptSha256"])
    return siegel


def haupt(argv=None):
    p = argparse.ArgumentParser(description="E4d/E4e - Kadenz-Zensur und "
                                            "konsistente Auffindbarkeit")
    p.add_argument("--fenster", choices=sorted(BAENDER))
    p.add_argument("--freigabe", help="Freigabe-Protokoll aus studie-r1-serverzeit.js")
    p.add_argument("--data-root")
    p.add_argument("--arbeit")
    p.add_argument("--ziel")
    p.add_argument("--ohne-siegel-hash", action="store_true",
                   help="Endtest-Siegel nur ueber die Byte-Zahl pruefen")
    p.add_argument("--allowlist-ausgeben", action="store_true",
                   help="die Ausgabe-Allowlist als JSON - Eingabe fuer die Anmeldung")
    p.add_argument("--siegeln", action="store_true",
                   help="den Skript-Hash in e4d-freeze.json eintragen (VOR dem Push)")
    p.add_argument("--selbsttest", action="store_true")
    a = p.parse_args(argv)
    if a.allowlist_ausgeben:
        print(json.dumps(list(ANMELDE_FELDER), ensure_ascii=False, indent=1))
        return 0
    if a.siegeln:
        siegeln()
        return 0
    if a.selbsttest:
        return selbsttest()
    if not a.fenster:
        p.error("--fenster wird gebraucht (oder --selbsttest)")
    ausgabe = lauf(a.fenster, a.freigabe, data_root=a.data_root, arbeit=a.arbeit,
                   ziel=a.ziel, siegel_voll=not a.ohne_siegel_hash)
    print(json.dumps(ausgabe["baender"], ensure_ascii=False, indent=1,
                     sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(haupt())
