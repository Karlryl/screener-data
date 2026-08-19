#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E2 — Basisraten der Beschleunigungs-Signale S-U, S-G, S-UG.

WAS HIER BEANTWORTET WIRD
-------------------------
Wie oft feuert ein Beschleunigungs-Signal ueberhaupt, wenn man es ohne jede
Kenntnis von Kursen oder Ergebnissen nur aus den SEC-Zahlen baut? Zwei Zahlen,
die nie verwechselt werden duerfen:
  * FEUERUNGEN  — wie dicht liegen die Ereignisse (Firmen-Quartale je Monat)?
  * FALLZAHL    — wie viele FIRMEN tragen ein reifes ERST-Ereignis?
Wer nur die erste berichtet, haelt spaeter Dichte fuer Stichprobe.

DIE FENSTER-MAUER LEBT IM CODE, NICHT IN EINER ZUSAGE (R2)
----------------------------------------------------------
Geoeffnet wird GENAU EINE Datei: das Entdeckungsfenster. Pruef- und
Endtest-Fenster sind fuer diese Etappe tabu — jeder Pfad, der nach ihnen oder
nach Schluesselmaterial aussieht, ist ein Abbruch, kein Filter. Geprueft wird
der AUFGELOESTE Pfad (`realpath`, folgt Symlinks und NTFS-Junctions), nicht nur
der geschriebene: eine Verzeichnis-Verknuepfung mit harmlosem Namen hat in
diesem Projekt schon einmal woanders hingezeigt.

RECHEN-EHRLICHKEIT (R5)
-----------------------
Jede Groesse, die nicht berechenbar ist, wird MIT GRUND GEZAEHLT — nie
geschaetzt, nie auf null gesetzt, nie stillschweigend weggelassen. Die Zaehler
stehen vollstaendig im Report.

ZEITPUNKT-EHRLICHKEIT (R6)
--------------------------
Fuer jede Groesse (cik, tag, ddate, qtrs, uom) gilt der Wert aus dem FRUEHESTEN
`accepted`-Bericht, der sie enthaelt. Spaetere Fassungen werden fuer die
Signalrechnung ignoriert (sie werden nur gezaehlt). Lehre aus einem annullierten
Lauf am 19.07.: "juengstes statt urspruengliches Datum" verschob Ereignisse um
Jahre.

ERGEBNIS-SPERRE (R4)
--------------------
Dieses Skript oeffnet keine Kurs-, Rendite- oder Ergebnisdatei. Der Lauf
protokolliert das als Flag samt der Liste aller tatsaechlich geoeffneten Pfade.

WERKZEUGE (R14c)
----------------
Python-Standardbibliothek + sqlite3. numpy waere erlaubt, wird aber nicht
gebraucht: das Perzentil laeuft ueber den naechsten Rang und ist damit von Hand
nachrechenbar.

Aufruf:
  python scripts/studie-basisraten.py --selbsttest
  python scripts/studie-basisraten.py --bericht
  python scripts/studie-basisraten.py --bericht --fortsetzen   (nach Absturz)
"""

import argparse
import json
import os
import re
import sqlite3
import sys
from collections import defaultdict
from datetime import date, datetime, timezone

DATENWURZEL_ENV = "EARLY_DETECTION_DATA_ROOT"

# R2: die EINZIGE Datei, die dieses Skript je oeffnet.
FENSTER_NAME = "entdeckung"
FENSTER_DATEI = "panel-entdeckung.sqlite"
FENSTER_VON = "2009-01-01"
FENSTER_BIS = "2016-12-31"
# Alles, was nach einem anderen Fenster oder nach Schluesselmaterial aussieht.
# Gegenueber E1 zusaetzlich gesperrt: das Prueffenster — E2 misst Basisraten nur
# im Entdeckungsfenster, eine Prueffenster-Zahl waere hier ein Vorgriff.
VERBOTEN_RE = re.compile(
    r"endtest|validierung|pruefenster|prüfenster|\.enc$|schl(?:ue|ü)ssel|\.key$",
    re.IGNORECASE)

# Periodische Formen. 8-K/S-1 tragen keine Berichtsperiode; Korrekturfassungen
# ("/A") betreffen denselben Zeitraum und zaehlen zum Stamm.
PERIODISCHE_FORMEN = ("10-K", "10-Q", "20-F", "40-F")
# Amtliche Taxonomie ("us-gaap/2016") gegen firmeneigene Erweiterung (dort steht
# die Einreichungsnummer der Firma). Nur Amtliches ist zwischen Firmen vergleichbar.
STANDARD_VERSION_RE = re.compile(r"^[a-z][a-z0-9-]*/\d{4}$")

SIC_DIVISIONEN = (
    (100, 999, "Land- und Forstwirtschaft, Fischerei"),
    (1000, 1499, "Bergbau und Rohstoffgewinnung"),
    (1500, 1799, "Bau"),
    (2000, 3999, "Verarbeitendes Gewerbe"),
    (4000, 4999, "Transport, Kommunikation, Versorger"),
    (5000, 5199, "Grosshandel"),
    (5200, 5999, "Einzelhandel"),
    (6000, 6799, "Finanzen, Versicherung, Immobilien"),
    (7000, 8999, "Dienstleistungen"),
    (9100, 9729, "Oeffentliche Verwaltung"),
    (9900, 9999, "Nicht klassifiziert (SEC-Sammelcode)"),
)

# --- Die eingefrorene Umsatz-Abbildungsschicht -------------------------------
# Reihenfolge = Prioritaet. Je Firmen-Quartal waehlt sie GENAU EINE Quelle;
# verglichen wird nie ueber Quellen hinweg (siehe basis_gleich).
# `...IncludingAssessedTax` bleibt bewusst draussen: anderes Niveau (enthaelt
# durchlaufende Steuern), eine Reihe daraus waere ein Stufensprung ohne Substanz.
UMSATZ_QUELLEN = (
    ("Revenues", ("Revenues",)),
    ("RevenueFromContractWithCustomerExcludingAssessedTax",
     ("RevenueFromContractWithCustomerExcludingAssessedTax",)),
    ("SalesRevenueNet", ("SalesRevenueNet",)),
    ("SalesRevenueGoodsNet+SalesRevenueServicesNet",
     ("SalesRevenueGoodsNet", "SalesRevenueServicesNet")),
)
ERGEBNIS_QUELLEN = (("OperatingIncomeLoss", ("OperatingIncomeLoss",)),)
# Reine Diagnose, kein Signal, keine Schwelle (Auftrag E2).
DIAGNOSE_QUELLEN = (("NetIncomeLoss", ("NetIncomeLoss",)),)

ALLE_TAGS = tuple(sorted(set(
    t for _, tags in UMSATZ_QUELLEN + ERGEBNIS_QUELLEN + DIAGNOSE_QUELLEN
    for t in tags)))

# Paarungsfenster in Kalendertagen (Abstand der Bilanzstichtage `ddate`).
JAHR_FENSTER = (330, 380)
JAHR_ZIEL = 365
QUARTAL_FENSTER = (80, 110)
QUARTAL_ZIEL = 91
# Q4 = Geschaeftsjahr minus die drei Vorquartale desselben Fiskaljahres.
# 13-Wochen-Quartale enden 91/182/273 Tage vor dem Jahresende; ein
# 53-Wochen-Fiskaljahr schiebt einen dieser Abstaende um bis zu 7 Tage.
Q4_FENSTER = ((80, 110, 91), (165, 200, 182), (255, 295, 273))
# 53-WOCHEN-FISKALJAHRE: an dieser Datenquelle NICHT ueber den Stichtagsabstand
# erkennbar. Der SEC-Datensatz rundet `ddate` auf das Monatsende — gemessen ueber
# alle Umsatz-Zeilen kommen als Tag des Monats nur 28/29/30/31 vor, und alle
# 91.120 Jahrespaare liegen bei 365 oder 366 Tagen. Ein 53-Wochen-Jahr (371 Tage)
# kann hier also gar nicht auffallen. Ein Zaehler auf ">= 368 Tage" haette
# deshalb dauerhaft null gemeldet und wie ein Befund ausgesehen — das ist genau
# die Sorte stiller Null, die R5 verbietet.
# Gezaehlt wird stattdessen (a) jedes Jahrespaar, dessen Abstand KEIN Kalenderjahr
# ist, und (b) ueber `fye` (Geschaeftsjahresende im Berichtskopf) die Firmen, deren
# Geschaeftsjahresende wandert — das sind genau die 52/53-Wochen-Rechner.
KALENDERJAHR_TAGE = (365, 366)

G_DECKEL = 2.0
# Trailing-Fenster fuer die Schwelle: Kalenderquartale q-5 bis q-2. Der Abstand
# von zwei Quartalen ist der Veroeffentlichungspuffer — ein Wert mit Stichtag in
# q-2 ist zum Zeitpunkt q laengst publiziert.
TRAILING_VON, TRAILING_BIS = 5, 2
TRAILING_MIN_N = 200

P_START = 90
P_ERLAUBT = (80, 85, 90, 95)
MAX_NACHJUSTIER_SCHRITTE = 2
ZIEL_RATE_MIN, ZIEL_RATE_MAX = 0.005, 0.025
ZIEL_FIRMEN = 300
BAND_JAHRE = (2012, 2016)
RUMPFJAHRE = (2009, 2010, 2011)
REIFE_QUARTALE = 4

GLAETTE_MAX_SPRUNG = 5.0          # Prozentpunkte
UEBERLAPP_SCHWELLE = 0.05         # 5 Punkte in g
UEBERLAPP_ANTEIL_MAX = 0.10
KETTE_MINDESTTIEFE = 8            # Scheiternskriterium 2 haengt daran
KETTE_ERWARTET_E1 = 7973          # Plausibilitaetsanker aus dem E1-Report

BLOCK = 4000000                   # rowid-Haeppchen fuer Stufe 1 (R15c)

# Scheiternskriterien (vorab festgelegt).
SCHEITERN_KONZENTRATION_SEKTOR = 0.50
SCHEITERN_KONZENTRATION_JAHR = 0.40
SCHEITERN_KETTENANTEIL = 0.50


# R5: Jeder bekannte Grund steht im Report, auch wenn er null Mal vorkam. Sonst
# sieht "kam nicht vor" genauso aus wie "wurde nie geprueft" — und genau diese
# Verwechslung hat den 53-Wochen-Zaehler beinahe als Befund durchgehen lassen.
GRUENDE_JE_GROESSE = (
    "quellen_naht", "kein_vorjahrespartner", "kein_vorquartal",
    "kein_vorquartal_beschleunigung", "keine_schwelle", "q4_komponente_fehlt",
    "q4_abgeleitet", "komponente_fehlt_quartal", "nenner_null",
    "jahrespaar_abstand_abweichend",
)
GRUENDE_NUR_UMSATZ = ("umsatz_nicht_positiv", "q4_komponente_nicht_positiv")
GRUENDE_GLOBAL = (
    "berichte_periodisch", "bericht_ohne_cik", "bericht_ohne_accepted",
    "bericht_ohne_branche", "bericht_ohne_periode",
    "bericht_ohne_geschaeftsjahresende", "fakt_kandidaten", "verworfen_coreg",
    "verworfen_firmeneigene_taxonomie", "verworfen_nicht_periodisch",
    "verworfen_periodenlaenge", "verworfen_stichtag_unlesbar",
    "verworfen_wert_leer", "roh_zeilen", "pit_werte", "pit_schluessel_mehrfach",
    "pit_schluessel_wertkonflikt",
)
PRAEFIXE = ("umsatz_", "betriebsergebnis_", "nettoergebnis_")


def alle_zaehlernamen():
    namen = list(GRUENDE_GLOBAL)
    for praefix in PRAEFIXE:
        namen.extend(praefix + g for g in GRUENDE_JE_GROESSE)
    namen.extend("umsatz_" + g for g in GRUENDE_NUR_UMSATZ)
    return tuple(namen)


class BasisratenFehler(Exception):
    """Ein Befund, der den Lauf anhaelt — nie ein stiller Rueckfall."""


# -- Pfade und die Fenster-Mauer ---------------------------------------------

# Beobachtungsfelder fuer das Lauf-Flag (R4): was hat dieser Lauf wirklich
# angefasst? Gefuehrt wird der Pfad mit seinem Elternverzeichnis, nicht nur der
# Dateiname — sonst sieht die Selbsttest-Fixture, die absichtlich genauso heisst
# wie das Panel, im Report aus wie ein zweiter Panel-Zugriff.
GEOEFFNETE_PFADE = []
GESCHRIEBENE_PFADE = []


def kurzpfad(voll):
    """Elternverzeichnis + Dateiname. Genug zum Unterscheiden, ohne die
    Benutzerkennung des Rechners in den Report zu schreiben (R12a)."""
    return (os.path.basename(os.path.dirname(voll)) + "/"
            + os.path.basename(voll))


def datenwurzel(vorgabe=None):
    wert = vorgabe or os.environ.get(DATENWURZEL_ENV)
    if not wert:
        raise BasisratenFehler(
            "Speicherort unbekannt: " + DATENWURZEL_ENV + " ist nicht gesetzt "
            "(R12a verbietet einen fest verdrahteten Pfad)")
    return wert


def pruefe_mauer(pfad):
    """R2: Darf dieser Pfad angefasst werden? Sonst Abbruch, kein Filter.

    Geprueft werden BEIDE Formen: der aufgeloeste Pfad (`realpath` folgt
    Symlinks und NTFS-Junctions) faengt die Umleitung, der geschriebene faengt
    den Fall, dass das Ziel noch nicht existiert und `realpath` deshalb nichts
    aufloest."""
    geschrieben = os.path.abspath(pfad)
    aufgeloest = os.path.realpath(geschrieben)
    for form in (geschrieben, aufgeloest):
        if VERBOTEN_RE.search(form.replace(os.sep, "/")):
            raise BasisratenFehler(
                "R2-ABBRUCH: '" + pfad + "' fuehrt (aufgeloest: '" + aufgeloest
                + "') zu einem gesperrten Fenster oder zu Schluesselmaterial. "
                "E2 oeffnet ausschliesslich das Entdeckungsfenster; wer vorher "
                "in Pruef- oder Endtest-Fenster sieht, macht das Studienergebnis "
                "wertlos.")
    return aufgeloest


def oeffne_nur_lesend(pfad):
    """R2: erst die Mauer, dann die Datei — und nur schreibgeschuetzt."""
    voll = pruefe_mauer(pfad)
    if not os.path.isfile(voll):
        raise BasisratenFehler("Panel-Datei nicht gefunden: " + voll)
    if kurzpfad(voll) not in GEOEFFNETE_PFADE:
        GEOEFFNETE_PFADE.append(kurzpfad(voll))
    conn = sqlite3.connect("file:" + voll.replace("\\", "/") + "?mode=ro", uri=True)
    conn.execute("PRAGMA cache_size=-200000")
    return conn


# -- Kleine Rechenhelfer ------------------------------------------------------

def sic_division(sic):
    """4-stellige SEC-Branchenkennung -> amtlicher Bereich. Unlesbar -> None (R5)."""
    if sic is None:
        return None
    text = str(sic).strip()
    if not text.isdigit():
        return None
    zahl = int(text)
    for von, bis, name in SIC_DIVISIONEN:
        if von <= zahl <= bis:
            return name
    return None


def ordinal(ddate):
    """'YYYYMMDD' -> Tagesnummer. Unlesbar -> None (R5)."""
    text = (ddate or "").strip()
    if len(text) != 8 or not text.isdigit():
        return None
    try:
        return date(int(text[:4]), int(text[4:6]), int(text[6:8])).toordinal()
    except ValueError:
        return None


def kalenderquartal(ddate):
    """'YYYYMMDD' -> fortlaufende Quartalsnummer (Jahr*4 + Quartal-1)."""
    text = (ddate or "").strip()
    if len(text) != 8 or not text.isdigit():
        return None
    jahr, monat = int(text[:4]), int(text[4:6])
    if not (1900 <= jahr <= 2100) or not (1 <= monat <= 12):
        return None
    return jahr * 4 + (monat - 1) // 3


def formstamm(form):
    """'10-K/A' -> '10-K'."""
    return (form or "").split("/")[0].strip().upper()


def perzentil(sortierte_werte, anteil):
    """Naechster Rang, ohne Interpolation — von Hand nachrechenbar.

    Bei 10 sortierten Werten liegt P90 auf Rang ceil(0.9*10)=9, also dem 9. Wert.
    Keine Zwischenwerte, die es in den Daten nicht gibt."""
    if not sortierte_werte:
        return None
    rang = int(-(-anteil * len(sortierte_werte) // 1))
    return sortierte_werte[max(0, min(rang - 1, len(sortierte_werte) - 1))]


def laengste_kette(quartalsnummern):
    """Laengste ununterbrochene Folge von Quartalen. Leere Menge -> 0."""
    if not quartalsnummern:
        return 0
    sortiert = sorted(set(quartalsnummern))
    beste = laufend = 1
    for vorher, jetzt in zip(sortiert, sortiert[1:]):
        laufend = laufend + 1 if jetzt == vorher + 1 else 1
        beste = max(beste, laufend)
    return beste


def monat_aus_accepted(accepted):
    """'2013-05-08 17:02:00.0' -> '2013-05'. Unlesbar -> None (R5)."""
    text = (accepted or "").strip()
    if len(text) < 7 or text[4] != "-":
        return None
    return text[:7]


def jahr_aus_accepted(accepted):
    text = (accepted or "").strip()
    if len(text) < 4 or not text[:4].isdigit():
        return None
    return int(text[:4])


def zeitstempel():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# =============================================================================
# Stufe 1 — Rohwerte lesen (Haeppchen mit Wiederaufnahme, R15c)
# =============================================================================

def lade_berichte(conn, zaehler):
    """adsh -> (cik, accepted, sic-Division). Nur periodische Formen.

    Ausserdem die Nebenzahlen, die spaeter als Nenner gebraucht werden:
    Firmen je Kalenderjahr und die laengste Berichtsquartals-Kette je Firma."""
    berichte = {}
    firmen_jahr = defaultdict(set)
    quartale_je_firma = defaultdict(set)
    fye_je_firma = defaultdict(set)
    for adsh, cik, sic, form, period, accepted, fye in conn.execute(
            "SELECT adsh, cik, sic, form, period, accepted, fye FROM bericht"):
        if formstamm(form) not in PERIODISCHE_FORMEN:
            continue
        zaehler["berichte_periodisch"] += 1
        if not cik or not str(cik).strip():
            zaehler["bericht_ohne_cik"] += 1
            continue
        jahr = jahr_aus_accepted(accepted)
        if jahr is None:
            zaehler["bericht_ohne_accepted"] += 1
            continue
        berichte[adsh] = (str(cik).strip(), accepted, sic_division(sic))
        if sic_division(sic) is None:
            zaehler["bericht_ohne_branche"] += 1
        firmen_jahr[jahr].add(str(cik).strip())
        if fye and str(fye).strip():
            fye_je_firma[str(cik).strip()].add(str(fye).strip())
        else:
            zaehler["bericht_ohne_geschaeftsjahresende"] += 1
        q = kalenderquartal(period)
        if q is None:
            zaehler["bericht_ohne_periode"] += 1
        else:
            quartale_je_firma[str(cik).strip()].add(q)
    return berichte, firmen_jahr, quartale_je_firma, fye_je_firma


def oeffne_zwischenstand(pfad, neu):
    """Arbeitsdatei fuer Stufe 1. Traegt den Wiederaufnahme-Stand (R15c)."""
    pruefe_mauer(pfad)
    if neu and os.path.isfile(pfad):
        os.remove(pfad)
    os.makedirs(os.path.dirname(os.path.abspath(pfad)), exist_ok=True)
    if kurzpfad(os.path.abspath(pfad)) not in GESCHRIEBENE_PFADE:
        GESCHRIEBENE_PFADE.append(kurzpfad(os.path.abspath(pfad)))
    conn = sqlite3.connect(pfad, isolation_level=None)
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA cache_size=-200000")
    conn.execute("CREATE TABLE IF NOT EXISTS roh (cik TEXT, tag TEXT, ddate TEXT,"
                 " qtrs TEXT, uom TEXT, accepted TEXT, adsh TEXT, value REAL)")
    conn.execute("CREATE TABLE IF NOT EXISTS lauf_stand (block INTEGER PRIMARY KEY,"
                 " zeilen INTEGER, fertig_am TEXT)")
    conn.execute("CREATE TABLE IF NOT EXISTS zaehler_stand (name TEXT PRIMARY KEY,"
                 " wert INTEGER)")
    return conn


def lies_rohwerte(panel, arbeit, berichte, zaehler, fortsetzen):
    """Stufe 1: die Faktentabelle einmal sequenziell, in rowid-Haeppchen.

    Die Tabelle hat 64 Millionen Zeilen und keinen Index; sie wird nie am Stueck
    geladen (R14d). Jedes Haeppchen wird atomar geschrieben und im `lauf_stand`
    vermerkt — ein Absturz kostet hoechstens ein Haeppchen."""
    hoechste = panel.execute("SELECT MAX(rowid) FROM fakt").fetchone()[0] or 0
    erledigt = set(r[0] for r in arbeit.execute("SELECT block FROM lauf_stand"))
    if not fortsetzen and erledigt:
        raise BasisratenFehler(
            "Arbeitsdatei traegt bereits Haeppchen. Entweder --fortsetzen oder "
            "die Arbeitsdatei loeschen lassen (--neu).")
    for name, wert in arbeit.execute("SELECT name, wert FROM zaehler_stand"):
        zaehler[name] = wert
    platzhalter = ",".join("?" * len(ALLE_TAGS))
    frage = ("SELECT adsh, tag, version, coreg, ddate, qtrs, uom, value FROM fakt"
             " WHERE rowid BETWEEN ? AND ? AND tag IN (" + platzhalter + ")")
    block_nr = 0
    von = 1
    while von <= hoechste:
        bis = von + BLOCK - 1
        if block_nr not in erledigt:
            stapel = []
            for (adsh, tag, version, coreg, ddate, qtrs, uom,
                 value) in panel.execute(frage, (von, bis) + ALLE_TAGS):
                zaehler["fakt_kandidaten"] += 1
                if coreg is not None and str(coreg).strip():
                    zaehler["verworfen_coreg"] += 1
                    continue
                if not STANDARD_VERSION_RE.match((version or "").strip()):
                    zaehler["verworfen_firmeneigene_taxonomie"] += 1
                    continue
                traeger = berichte.get(adsh)
                if traeger is None:
                    zaehler["verworfen_nicht_periodisch"] += 1
                    continue
                if qtrs not in ("1", "4"):
                    zaehler["verworfen_periodenlaenge"] += 1
                    continue
                if ordinal(ddate) is None:
                    zaehler["verworfen_stichtag_unlesbar"] += 1
                    continue
                if value is None:
                    zaehler["verworfen_wert_leer"] += 1
                    continue
                stapel.append((traeger[0], tag, ddate, qtrs, uom, traeger[1],
                               adsh, value))
            arbeit.execute("BEGIN")
            arbeit.executemany("INSERT INTO roh VALUES (?,?,?,?,?,?,?,?)", stapel)
            arbeit.execute("INSERT OR REPLACE INTO lauf_stand VALUES (?,?,?)",
                           (block_nr, len(stapel), zeitstempel()))
            for name, wert in zaehler.items():
                arbeit.execute("INSERT OR REPLACE INTO zaehler_stand VALUES (?,?)",
                               (name, wert))
            arbeit.execute("COMMIT")
        von = bis + 1
        block_nr += 1
    return arbeit.execute("SELECT COUNT(*) FROM roh").fetchone()[0]


def pit_reduktion(arbeit, zaehler):
    """Stufe 2 (R6): je (cik, tag, ddate, qtrs, uom) der Wert aus dem FRUEHESTEN
    `accepted`-Bericht. Spaetere Fassungen werden nur noch gezaehlt.

    Gleichstand beim Zeitstempel wird nach Einreichungsnummer aufgeloest — nicht
    weil das inhaltlich richtiger waere, sondern damit das Ergebnis bei zwei
    Laeufen dasselbe ist."""
    arbeit.execute("CREATE INDEX IF NOT EXISTS i_roh ON roh"
                   " (cik, tag, ddate, qtrs, uom, accepted, adsh)")
    zaehler["pit_schluessel_mehrfach"] = arbeit.execute(
        "SELECT COUNT(*) FROM (SELECT 1 FROM roh GROUP BY cik,tag,ddate,qtrs,uom"
        " HAVING COUNT(*) > 1)").fetchone()[0]
    zaehler["pit_schluessel_wertkonflikt"] = arbeit.execute(
        "SELECT COUNT(*) FROM (SELECT 1 FROM roh GROUP BY cik,tag,ddate,qtrs,uom"
        " HAVING MIN(value) <> MAX(value))").fetchone()[0]
    je_firma = defaultdict(dict)
    for cik, tag, ddate, qtrs, uom, accepted, value in arbeit.execute(
            "SELECT cik, tag, ddate, qtrs, uom, accepted, value FROM ("
            "  SELECT cik, tag, ddate, qtrs, uom, accepted, value,"
            "         ROW_NUMBER() OVER (PARTITION BY cik, tag, ddate, qtrs, uom"
            "                            ORDER BY accepted, adsh) AS rn"
            "  FROM roh) WHERE rn = 1"):
        zaehler["pit_werte"] += 1
        je_firma[cik].setdefault((tag, uom), {})[(ddate, qtrs)] = (accepted, value)
    return je_firma


# =============================================================================
# Stufe 3 — Quartalsreihen, Wachstum, Beschleunigung
# =============================================================================

def basis_gleich(basis_a, basis_b):
    """DER NAHT-WAECHTER (Pruefschritt 1).

    Wachstum und Beschleunigung existieren nur, wenn ALLE beteiligten Werte
    dieselbe Quellen-Basis tragen — dieselbe Umsatz-Kennung UND dieselbe
    Waehrungseinheit. Ein Vergleich ueber die Naht hinweg (z. B. `SalesRevenueNet`
    2013 gegen `Revenues` 2014) misst den Namenswechsel als Wachstum. Solche
    Paare heissen NICHT BERECHENBAR und werden als Quellen-Naht gezaehlt.

    Der Wachtest dazu ist unabhaengig: `pruefe_naht_invariante` zaehlt am
    fertigen Ergebnis nach. Wer diese Funktion auf `return True` setzt, muss dort
    rot werden."""
    return basis_a == basis_b


def quelle_reihe(firma_werte, tags, uom, nur_positiv, zaehler, praefix):
    """Quartalsreihe EINER Quelle in EINER Einheit.

    qtrs=1 direkt; das vierte Quartal wird aus dem Geschaeftsjahr (qtrs=4) minus
    den drei Vorquartalen desselben Fiskaljahres abgeleitet — alle vier aus
    derselben Quellen-Kennung und Einheit. Fehlt eine Komponente, heisst das
    Quartal NICHT BERECHENBAR und wird gezaehlt."""
    teile = [firma_werte.get((t, uom)) for t in tags]
    if any(t is None for t in teile):
        return {}
    q1_mengen = [set(d for (d, q) in teil if q == "1") for teil in teile]
    gemeinsam_q1 = set.intersection(*q1_mengen) if q1_mengen else set()
    unvollstaendig = set.union(*q1_mengen) - gemeinsam_q1 if q1_mengen else set()
    zaehler[praefix + "komponente_fehlt_quartal"] += len(unvollstaendig)

    # `roh_q1` haelt ALLE gemeinsamen Quartalswerte, auch die nicht-positiven.
    # `reihe` haelt nur die, die als Wachstumsbasis taugen. Der Unterschied ist
    # Absicht: ein Umsatz von null ist als WACHSTUMSBASIS unbrauchbar (dort steht
    # er im Nenner), als SUMMAND in der Q4-Ableitung dagegen eine gueltige Zahl.
    # Wer ihn auch dort wegwirft, macht aus einer Wachstums-Regel eine
    # Arithmetik-Regel und verliert Quartale aus einem fremden Grund.
    roh_q1 = {}
    reihe = {}
    for d in gemeinsam_q1:
        werte = [teil[(d, "1")] for teil in teile]
        summe = sum(v for _, v in werte)
        roh_q1[d] = (summe, max(a for a, _ in werte))
        if nur_positiv and summe <= 0:
            zaehler[praefix + "umsatz_nicht_positiv"] += 1
            continue
        reihe[d] = (summe, max(a for a, _ in werte), "direkt")

    q4_mengen = [set(d for (d, q) in teil if q == "4") for teil in teile]
    gemeinsam_q4 = set.intersection(*q4_mengen) if q4_mengen else set()
    kandidaten_ord = sorted((ordinal(d), d) for d in roh_q1)
    for d in sorted(gemeinsam_q4):
        if d in reihe:
            continue                      # direkt gemeldetes Q4 schlaegt Ableitung
        ziel = ordinal(d)
        if ziel is None:
            continue
        gefunden = []
        for von, bis, ideal in Q4_FENSTER:
            treffer = [(abs((ziel - o) - ideal), dd) for o, dd in kandidaten_ord
                       if von <= ziel - o <= bis]
            if not treffer:
                break
            gefunden.append(min(treffer)[1])
        if len(gefunden) != len(Q4_FENSTER) or len(set(gefunden)) != len(Q4_FENSTER):
            zaehler[praefix + "q4_komponente_fehlt"] += 1
            continue
        jahreswerte = [teil[(d, "4")] for teil in teile]
        jahr_summe = sum(v for _, v in jahreswerte)
        abzug = sum(roh_q1[dd][0] for dd in gefunden)
        if nur_positiv and any(roh_q1[dd][0] <= 0 for dd in gefunden):
            zaehler[praefix + "q4_komponente_nicht_positiv"] += 1
        wert = jahr_summe - abzug
        if nur_positiv and wert <= 0:
            zaehler[praefix + "umsatz_nicht_positiv"] += 1
            continue
        accepted = max([a for a, _ in jahreswerte] + [roh_q1[dd][1] for dd in gefunden])
        reihe[d] = (wert, accepted, "abgeleitet_q4")
        zaehler[praefix + "q4_abgeleitet"] += 1
    return reihe


def firmenreihen(je_firma, quellen, nur_positiv, zaehler, praefix):
    """Je Firma: alle Quellen-Reihen, und daraus die per Prioritaet GEWAEHLTE.

    Die Prioritaet waehlt je Firmen-Quartal genau eine Quelle. Bei mehreren
    Waehrungseinheiten derselben Quelle gewinnt USD, sonst die alphabetisch
    erste — das ist eine Festlegung fuer Eindeutigkeit, kein Inhalt."""
    alle = {}
    gewaehlt = {}
    for cik, firma_werte in je_firma.items():
        uoms = sorted(set(u for (_, u) in firma_werte))
        je_quelle = {}
        for rang, (name, tags) in enumerate(quellen):
            for uom in uoms:
                reihe = quelle_reihe(firma_werte, tags, uom, nur_positiv,
                                     zaehler, praefix)
                if reihe:
                    je_quelle[(rang, name, uom)] = reihe
        if not je_quelle:
            continue
        alle[cik] = je_quelle
        beste = {}
        for (rang, name, uom) in sorted(
                je_quelle, key=lambda k: (k[0], 0 if k[2] == "USD" else 1, k[2])):
            for d, (wert, accepted, herkunft) in je_quelle[(rang, name, uom)].items():
                if d not in beste:
                    beste[d] = (wert, accepted, herkunft, (name, uom))
        gewaehlt[cik] = beste
    return alle, gewaehlt


def partner(sortiert, index, fenster, ziel):
    """Der Partner-Stichtag im Abstandsfenster, am naechsten am Zielabstand."""
    o = sortiert[index][1]
    treffer = [(abs((o - sortiert[j][1]) - ziel), j) for j in range(index)
               if fenster[0] <= o - sortiert[j][1] <= fenster[1]]
    if not treffer:
        return None
    return min(treffer)[1]


def g_wert(x_jetzt, x_vorjahr):
    """Symmetrisches Wachstum, begrenzt auf [-2, +2]. Nenner 0 -> None (R5).

    Symmetrisch heisst: der Nenner ist der Mittelwert der Betraege beider
    Perioden. Damit bleibt die Groesse auch bei Vorzeichenwechsel endlich —
    beim klassischen Prozentwachstum wuerde ein Vorjahr nahe null jede Zahl
    ins Unendliche treiben."""
    nenner = (abs(x_jetzt) + abs(x_vorjahr)) / 2.0
    if nenner == 0:
        return None
    roh = (x_jetzt - x_vorjahr) / nenner
    return max(-G_DECKEL, min(G_DECKEL, roh))


def wachstum_und_beschleunigung(gewaehlt, zaehler, praefix):
    """g(t) und a(t) je Firmen-Quartal, streng innerhalb einer Quellen-Basis.

    Rueckgabe: g_saetze und a_saetze als Listen von Diktaten. Jeder Satz traegt
    BEIDE beteiligten Basen — genau daran zaehlt der unabhaengige Wachtest die
    Naht-Invariante nach."""
    g_saetze, a_saetze = [], []
    for cik, reihe in gewaehlt.items():
        sortiert = sorted((d, ordinal(d)) for d in reihe)
        g_je_datum = {}
        for i, (d, o) in enumerate(sortiert):
            j = partner(sortiert, i, JAHR_FENSTER, JAHR_ZIEL)
            if j is None:
                zaehler[praefix + "kein_vorjahrespartner"] += 1
                continue
            d_v = sortiert[j][0]
            wert, accepted, _, basis = reihe[d]
            wert_v, accepted_v, _, basis_v = reihe[d_v]
            if not basis_gleich(basis, basis_v):
                zaehler[praefix + "quellen_naht"] += 1
                continue
            abstand = o - sortiert[j][1]
            if abstand not in KALENDERJAHR_TAGE:
                zaehler[praefix + "jahrespaar_abstand_abweichend"] += 1
            g = g_wert(wert, wert_v)
            if g is None:
                zaehler[praefix + "nenner_null"] += 1
                continue
            satz = {"cik": cik, "ddate": d, "ord": o, "g": g, "basis": basis,
                    "basis_partner": basis_v,
                    "accepted": max(accepted, accepted_v)}
            g_je_datum[d] = satz
            g_saetze.append(satz)
        # Beschleunigung: g(t) minus g(Vorquartal), gleiche Basis erzwungen.
        g_sortiert = sorted((s["ddate"], s["ord"]) for s in g_je_datum.values())
        for i, (d, o) in enumerate(g_sortiert):
            j = partner(g_sortiert, i, QUARTAL_FENSTER, QUARTAL_ZIEL)
            if j is None:
                zaehler[praefix + "kein_vorquartal"] += 1
                continue
            jetzt, vorher = g_je_datum[d], g_je_datum[g_sortiert[j][0]]
            if not basis_gleich(jetzt["basis"], vorher["basis"]):
                zaehler[praefix + "quellen_naht"] += 1
                continue
            a_saetze.append({
                "cik": cik, "ddate": d, "ord": o,
                "a": jetzt["g"] - vorher["g"], "g": jetzt["g"],
                "basis": jetzt["basis"], "basis_partner": vorher["basis"],
                "ddate_vorquartal": vorher["ddate"],
                "accepted": max(jetzt["accepted"], vorher["accepted"])})
    return g_saetze, a_saetze


# =============================================================================
# Stufe 4 — Schwellen, Signale, Zaehlung, Kalibrierung
# =============================================================================

def schwellen(a_saetze, p_wert):
    """Trailing-Perzentil je Kalenderquartal: der Querschnitt der Quartale q-5
    bis q-2. Unter TRAILING_MIN_N Werten gibt es keine Schwelle — dann ist das
    Quartal nicht bewertbar (R5, nie geraten)."""
    je_quartal = defaultdict(list)
    for s in a_saetze:
        q = kalenderquartal(s["ddate"])
        if q is not None:
            je_quartal[q].append(s["a"])
    ergebnis = {}
    if not je_quartal:
        return ergebnis
    for q in range(min(je_quartal) , max(je_quartal) + 1):
        pool = []
        for zurueck in range(TRAILING_BIS, TRAILING_VON + 1):
            pool.extend(je_quartal.get(q - zurueck, ()))
        if len(pool) < TRAILING_MIN_N:
            ergebnis[q] = (None, len(pool))
            continue
        ergebnis[q] = (perzentil(sorted(pool), p_wert / 100.0), len(pool))
    return ergebnis


def signale(a_saetze, p_wert, zaehler, praefix):
    """Ein Signal feuert im Firmen-Quartal, wenn ALLE DREI Bedingungen gelten:
       (a) a(t) > 0 UND a(t-1) > 0  — zwei Beschleunigungsquartale am Stueck
       (b) a(t) >= Schwelle(q)      — Trailing-Perzentil des Querschnitts
       (c) g(t) > 0                 — echtes Wachstum, kein langsameres Schrumpfen
    Persistenz (a) und Niveau-Gate (c) sind KEINE Knoepfe; nachjustiert wird nur
    das Perzentil in (b)."""
    grenzen = schwellen(a_saetze, p_wert)
    je_firma = defaultdict(dict)
    for s in a_saetze:
        je_firma[s["cik"]][s["ddate"]] = s
    feuerungen, auswertbar = [], []
    for cik, saetze in je_firma.items():
        sortiert = sorted((s["ddate"], s["ord"]) for s in saetze.values())
        for i, (d, o) in enumerate(sortiert):
            j = partner(sortiert, i, QUARTAL_FENSTER, QUARTAL_ZIEL)
            jetzt = saetze[d]
            if j is None:
                zaehler[praefix + "kein_vorquartal_beschleunigung"] += 1
                continue
            vorher = saetze[sortiert[j][0]]
            if not basis_gleich(jetzt["basis"], vorher["basis"]):
                zaehler[praefix + "quellen_naht"] += 1
                continue
            q = kalenderquartal(d)
            grenze, pool_n = grenzen.get(q, (None, 0))
            if grenze is None:
                zaehler[praefix + "keine_schwelle"] += 1
                continue
            eintrag = {"cik": cik, "ddate": d, "ord": o, "a": jetzt["a"],
                       "a_vorquartal": vorher["a"], "g": jetzt["g"],
                       "basis": jetzt["basis"], "schwelle": grenze,
                       "accepted": max(jetzt["accepted"], vorher["accepted"])}
            auswertbar.append(eintrag)
            if (jetzt["a"] > 0 and vorher["a"] > 0 and jetzt["a"] >= grenze
                    and jetzt["g"] > 0):
                feuerungen.append(eintrag)
    return feuerungen, auswertbar, grenzen


def erst_ereignisse(feuerungen, gewaehlt):
    """Fallzahl: Firmen mit REIFEM ERST-Ereignis.

    Reif heisst: nach dem Ereignis liegen im Entdeckungsfenster mindestens vier
    weitere Fiskalquartale mit auswertbarem Wert DERSELBEN Quellen-Basis vor.
    Das ist eine reine Existenz-Zaehlung — es wird kein einziger Ergebniswert
    berechnet (R4)."""
    erste = {}
    for f in feuerungen:
        vorhanden = erste.get(f["cik"])
        if vorhanden is None or (f["accepted"], f["ddate"]) < (vorhanden["accepted"],
                                                              vorhanden["ddate"]):
            erste[f["cik"]] = f
    reif, unreif = [], []
    for cik, f in erste.items():
        reihe = gewaehlt.get(cik, {})
        folge = sum(1 for d, eintrag in reihe.items()
                    if d > f["ddate"] and eintrag[3] == f["basis"])
        (reif if folge >= REIFE_QUARTALE else unreif).append(
            dict(f, folgequartale=folge))
    return reif, unreif


def im_band(eintrag):
    jahr = jahr_aus_accepted(eintrag["accepted"])
    return jahr is not None and BAND_JAHRE[0] <= jahr <= BAND_JAHRE[1]


def kalibriere(a_saetze, gewaehlt, zaehler, praefix):
    """Regelbasiert, kein Augenmaß: Rate > Obergrenze -> P + 5; Rate < Untergrenze
    oder zu wenige Firmen -> P - 5. Hoechstens zwei Schritte, jeder mit
    Vorher/Nachher-Zahlen. Danach immer noch draussen -> anhalten und melden."""
    schritte = []
    p = P_START
    letzte = None
    for versuch in range(MAX_NACHJUSTIER_SCHRITTE + 1):
        eigene = defaultdict(int)
        feuerungen, auswertbar, grenzen = signale(a_saetze, p, eigene, praefix)
        band_f = [f for f in feuerungen if im_band(f)]
        band_a = [a for a in auswertbar if im_band(a)]
        reif, unreif = erst_ereignisse(band_f, gewaehlt)
        rate = (len(band_f) / len(band_a)) if band_a else None
        letzte = {"p": p, "feuerungen_band": len(band_f),
                  "auswertbar_band": len(band_a), "rate": rate,
                  "firmen_reif": len(reif), "firmen_unreif": len(unreif),
                  "feuerungen": feuerungen, "auswertbar": auswertbar,
                  "reif": reif, "unreif": unreif, "grenzen": grenzen,
                  "zaehler": dict(eigene)}
        schritte.append({"schritt": versuch, "p": p, "rate": rate,
                         "feuerungen_band": len(band_f),
                         "auswertbar_band": len(band_a),
                         "firmen_reif": len(reif)})
        if rate is None:
            schritte[-1]["entscheid"] = "nicht bewertbar — kein auswertbares Quartal im Band"
            break
        zu_hoch = rate > ZIEL_RATE_MAX
        zu_tief = rate < ZIEL_RATE_MIN or len(reif) < ZIEL_FIRMEN
        if not zu_hoch and not zu_tief:
            schritte[-1]["entscheid"] = "im Zielband — keine Nachjustierung"
            break
        if versuch == MAX_NACHJUSTIER_SCHRITTE:
            schritte[-1]["entscheid"] = "Deckel erreicht — zwei Schritte verbraucht"
            break
        neu = p + 5 if zu_hoch else p - 5
        if neu not in P_ERLAUBT:
            schritte[-1]["entscheid"] = ("Wertebereich verlassen (" + str(neu)
                                         + " nicht in " + str(P_ERLAUBT) + ")")
            break
        schritte[-1]["entscheid"] = ("Rate " + ("ueber" if zu_hoch else "unter")
                                     + " dem Band -> P " + str(p) + " -> " + str(neu))
        p = neu
    for name, wert in letzte["zaehler"].items():
        zaehler[name] += wert
    return letzte, schritte


# =============================================================================
# Die drei Pruefschritte
# =============================================================================

def pruefe_naht_invariante(g_saetze, a_saetze):
    """PRUEFSCHRITT 1 — unabhaengiger Nachzaehler zum Naht-Waechter.

    Er fragt nicht, ob der Waechter aufgerufen wurde, sondern ob im FERTIGEN
    Ergebnis eine einzige Groesse steht, deren beide Enden verschiedene Quellen
    tragen. Das muss exakt 0 sein. Wer `basis_gleich` auf `return True` setzt,
    sieht diese Zahl sofort ueber null gehen."""
    verletzt_g = [s for s in g_saetze if s["basis"] != s["basis_partner"]]
    verletzt_a = [s for s in a_saetze if s["basis"] != s["basis_partner"]]
    return {"g_gemischt": len(verletzt_g), "a_gemischt": len(verletzt_a),
            "gesamt": len(verletzt_g) + len(verletzt_a),
            "bestanden": not verletzt_g and not verletzt_a,
            "beispiele": [{"cik": s["cik"], "ddate": s["ddate"],
                           "basis": list(s["basis"]),
                           "basis_partner": list(s["basis_partner"])}
                          for s in (verletzt_g + verletzt_a)[:5]]}


def pruefe_glaette(gewaehlt, firmen_jahr, von_jahr, bis_jahr):
    """PRUEFSCHRITT 2 — Belegungs-Glaette.

    Anteil der Firmen mit mindestens einem auswertbaren Umsatz-Quartal je
    Kalenderjahr. Nenner: Firmen mit mindestens einem periodischen Bericht in
    diesem Jahr. Ein Sprung von mehr als GLAETTE_MAX_SPRUNG Punkten zwischen
    Nachbarjahren ist kein Marktereignis, sondern fast immer ein Datenbruch —
    dann haelt der Lauf an."""
    mit_wert = defaultdict(set)
    for cik, reihe in gewaehlt.items():
        for _, (_, accepted, _, _) in reihe.items():
            jahr = jahr_aus_accepted(accepted)
            if jahr is not None:
                mit_wert[jahr].add(cik)
    zeilen = []
    for jahr in range(von_jahr, bis_jahr + 1):
        nenner = len(firmen_jahr.get(jahr, ()))
        zaehler_n = len(mit_wert.get(jahr, ()))
        anteil = (100.0 * zaehler_n / nenner) if nenner else None
        zeilen.append({"jahr": jahr, "firmen_gesamt": nenner,
                       "firmen_mit_umsatzquartal": zaehler_n, "anteil_prozent": anteil})
    spruenge = []
    for vorher, jetzt in zip(zeilen, zeilen[1:]):
        if vorher["anteil_prozent"] is None or jetzt["anteil_prozent"] is None:
            continue
        spruenge.append({"von": vorher["jahr"], "nach": jetzt["jahr"],
                         "punkte": jetzt["anteil_prozent"] - vorher["anteil_prozent"]})
    groesster = max((abs(s["punkte"]) for s in spruenge), default=0.0)
    return {"jahre": zeilen, "spruenge": spruenge, "groesster_sprung": groesster,
            "bestanden": groesster < GLAETTE_MAX_SPRUNG}


def quellen_g(alle):
    """g je Quelle EINZELN — nur fuer den Ueberlappungs-Vergleich.

    Hier waehlt die Prioritaet ausdruecklich NICHT: jede Quelle rechnet ihre
    eigene Reihe, damit man sehen kann, wie weit zwei Quellen im selben
    Firmen-Quartal auseinanderliegen."""
    ergebnis = defaultdict(dict)
    for cik, je_quelle in alle.items():
        for (rang, name, uom), reihe in je_quelle.items():
            sortiert = sorted((d, ordinal(d)) for d in reihe)
            for i, (d, o) in enumerate(sortiert):
                j = partner(sortiert, i, JAHR_FENSTER, JAHR_ZIEL)
                if j is None:
                    continue
                g = g_wert(reihe[d][0], reihe[sortiert[j][0]][0])
                if g is not None:
                    ergebnis[(cik, d)][(name, uom)] = g
    return ergebnis


def pruefe_ueberlappung(alle):
    """PRUEFSCHRITT 3 — wie weit widersprechen sich zwei Quellen?

    Wo mindestens zwei Umsatz-Quellen im selben Firmen-Quartal ein Wachstum
    liefern, wird der groesste Abstand |dg| zwischen zwei Quellen berichtet.
    Liegt der Anteil mit |dg| ueber UEBERLAPP_SCHWELLE ueber UEBERLAPP_ANTEIL_MAX,
    wird die Quelle je FIRMA fixiert (laengste Serie) statt je Quartal — diese
    Regel steht vorab fest, sie wird hier nicht neu erfunden."""
    je_quartal = quellen_g(alle)
    abstaende = []
    for (cik, d), werte in je_quartal.items():
        if len(werte) < 2:
            continue
        reihenfolge = sorted(werte.items())
        groesster = max(abs(a[1] - b[1]) for i, a in enumerate(reihenfolge)
                        for b in reihenfolge[i + 1:])
        abstaende.append(groesster)
    n = len(abstaende)
    ueber = sum(1 for x in abstaende if x > UEBERLAPP_SCHWELLE)
    anteil = (ueber / n) if n else None
    sortiert = sorted(abstaende)
    return {"firmenquartale_mit_mehreren_quellen": n,
            "davon_abstand_ueber_schwelle": ueber,
            "anteil": anteil,
            "median": perzentil(sortiert, 0.5),
            "p90": perzentil(sortiert, 0.9),
            "p99": perzentil(sortiert, 0.99),
            "regel_greift": bool(anteil is not None and anteil > UEBERLAPP_ANTEIL_MAX),
            "bestanden": bool(anteil is None or anteil <= UEBERLAPP_ANTEIL_MAX)}


# =============================================================================
# Zaehlung: Feuerungsdichte und Fallzahl
# =============================================================================

def firmen_branche(conn):
    """cik -> SIC-Bereich. Bei Wechsel gewinnt der haeufigste Bereich der Firma;
    Gleichstand alphabetisch. Eine Festlegung fuer Eindeutigkeit, kein Inhalt."""
    zaehlwerk = defaultdict(lambda: defaultdict(int))
    for cik, sic, form in conn.execute("SELECT cik, sic, form FROM bericht"):
        if formstamm(form) not in PERIODISCHE_FORMEN or not cik:
            continue
        division = sic_division(sic)
        if division is not None:
            zaehlwerk[str(cik).strip()][division] += 1
    return dict((cik, sorted(d.items(), key=lambda kv: (-kv[1], kv[0]))[0][0])
                for cik, d in zaehlwerk.items())


def dichte(feuerungen, auswertbar, branche):
    """Feuerungen je Kalendermonat und SIC-Bereich — IMMER mit Nenner.

    Der Monat ist der Monat des Signal-Zeitstempels (`accepted`), also des
    Moments, ab dem die Rechnung oeffentlich moeglich war."""
    monat_z = defaultdict(int)
    monat_n = defaultdict(int)
    sektor_z = defaultdict(int)
    sektor_n = defaultdict(int)
    kreuz = defaultdict(int)
    jahr_z = defaultdict(int)
    ohne_branche = 0
    for eintrag in auswertbar:
        m = monat_aus_accepted(eintrag["accepted"])
        b = branche.get(eintrag["cik"])
        if m:
            monat_n[m] += 1
        if b:
            sektor_n[b] += 1
    for eintrag in feuerungen:
        m = monat_aus_accepted(eintrag["accepted"])
        b = branche.get(eintrag["cik"])
        j = jahr_aus_accepted(eintrag["accepted"])
        if m:
            monat_z[m] += 1
        if j:
            jahr_z[j] += 1
        if b:
            sektor_z[b] += 1
            if m:
                kreuz[(m, b)] += 1
        else:
            ohne_branche += 1
    return {"monat": sorted((m, monat_z.get(m, 0), monat_n[m]) for m in monat_n),
            "sektor": sorted((b, sektor_z.get(b, 0), sektor_n[b]) for b in sektor_n),
            "jahr": sorted(jahr_z.items()),
            "kreuz_monat_sektor": sorted((m, b, n) for (m, b), n in kreuz.items()),
            "feuerungen_ohne_branche": ohne_branche}


def scheiternskriterien(name, ergebnis, kette_anteil):
    """Vorab festgelegt. Greifen sie, wird das gemeldet — nicht wegdefiniert."""
    treffer = []
    if ergebnis["firmen_reif"] < ZIEL_FIRMEN:
        treffer.append("K1: nur " + str(ergebnis["firmen_reif"]) + " Firmen mit reifem "
                       "Erst-Ereignis (gefordert " + str(ZIEL_FIRMEN) + ")")
    sektor = ergebnis["dichte"]["sektor"]
    gesamt = sum(z for _, z, _ in sektor) or 0
    if gesamt:
        groesster = max(sektor, key=lambda r: r[1])
        if groesster[1] / gesamt > SCHEITERN_KONZENTRATION_SEKTOR:
            treffer.append("K3a: " + str(round(100.0 * groesster[1] / gesamt, 1))
                           + " % aller Feuerungen im Bereich " + groesster[0])
        jahre = ergebnis["dichte"]["jahr"]
        if jahre:
            groesstes = max(jahre, key=lambda r: r[1])
            if groesstes[1] / gesamt > SCHEITERN_KONZENTRATION_JAHR:
                treffer.append("K3b: " + str(round(100.0 * groesstes[1] / gesamt, 1))
                               + " % aller Feuerungen im Jahr " + str(groesstes[0]))
    if name == "S-U" and kette_anteil is not None and kette_anteil < SCHEITERN_KETTENANTEIL:
        treffer.append("K2: nur " + str(round(100.0 * kette_anteil, 1)) + " % der Firmen "
                       "mit 8-Quartals-Kette haben ein auswertbares Wachstumsquartal")
    return treffer


# =============================================================================
# Der ganze Lauf
# =============================================================================

def auswertung(panel, arbeit, fortsetzen, trailing_min=None):
    """Ein kompletter Durchlauf. Rueckgabe: alles, was der Report braucht."""
    global TRAILING_MIN_N
    if trailing_min is not None:
        TRAILING_MIN_N = trailing_min
    zaehler = defaultdict(int)
    for name in alle_zaehlernamen():
        zaehler[name] += 0
    berichte, firmen_jahr, quartale_je_firma, fye_je_firma = lade_berichte(
        panel, zaehler)
    zaehler["roh_zeilen"] = lies_rohwerte(panel, arbeit, berichte, zaehler, fortsetzen)
    je_firma = pit_reduktion(arbeit, zaehler)
    branche = firmen_branche(panel)

    ketten_firmen = set(cik for cik, qs in quartale_je_firma.items()
                        if laengste_kette(qs) >= KETTE_MINDESTTIEFE)

    ergebnisse = {}
    familien = (("S-U", UMSATZ_QUELLEN, True, "umsatz_"),
                ("S-G", ERGEBNIS_QUELLEN, False, "betriebsergebnis_"))
    reihen = {}
    for name, quellen, nur_positiv, praefix in familien:
        alle, gewaehlt = firmenreihen(je_firma, quellen, nur_positiv, zaehler, praefix)
        g_saetze, a_saetze = wachstum_und_beschleunigung(gewaehlt, zaehler, praefix)
        letzte, schritte = kalibriere(a_saetze, gewaehlt, zaehler, praefix)
        band_f = [f for f in letzte["feuerungen"] if im_band(f)]
        band_a = [a for a in letzte["auswertbar"] if im_band(a)]
        rumpf_f = [f for f in letzte["feuerungen"]
                   if jahr_aus_accepted(f["accepted"]) in RUMPFJAHRE]
        reihen[name] = {"alle": alle, "gewaehlt": gewaehlt, "g": g_saetze,
                        "a": a_saetze, "feuerungen": letzte["feuerungen"],
                        "band_f": band_f, "band_a": band_a}
        ergebnisse[name] = {
            "p_final": letzte["p"], "kalibrierung": schritte,
            "feuerungen_gesamt": len(letzte["feuerungen"]),
            "feuerungen_band": len(band_f),
            "feuerungen_rumpfjahre": len(rumpf_f),
            "auswertbar_gesamt": len(letzte["auswertbar"]),
            "auswertbar_band": len(band_a),
            "rate_band": letzte["rate"],
            "firmen_reif": letzte["firmen_reif"],
            "firmen_unreif": letzte["firmen_unreif"],
            "firmen_mit_feuerung_band": len(set(f["cik"] for f in band_f)),
            "g_werte": len(g_saetze), "a_werte": len(a_saetze),
            "firmen_mit_g": len(set(s["cik"] for s in g_saetze)),
            "firmen_mit_reihe": len(gewaehlt),
            "dichte": dichte(band_f, band_a, branche),
            "naht": pruefe_naht_invariante(g_saetze, a_saetze),
            "schwellen": sorted((q, w, n) for q, (w, n) in letzte["grenzen"].items()),
        }

    # Scheiternskriterium 2 haengt an der Umsatz-Familie.
    firmen_mit_g = set(s["cik"] for s in reihen["S-U"]["g"])
    kette_anteil = (len(ketten_firmen & firmen_mit_g) / len(ketten_firmen)
                    if ketten_firmen else None)

    # S-UG: beide Signale im selben Fiskalquartal, keine eigenen Parameter.
    su = set((f["cik"], f["ddate"]) for f in reihen["S-U"]["band_f"])
    sg = set((f["cik"], f["ddate"]) for f in reihen["S-G"]["band_f"])
    schnitt = su & sg
    ug_feuerungen = [f for f in reihen["S-U"]["band_f"]
                     if (f["cik"], f["ddate"]) in schnitt]
    # Nenner von S-UG: nur Firmen-Quartale, in denen BEIDE Signale ueberhaupt
    # bewertbar waren — sonst misst die Rate die Luecken des duenneren Signals.
    ug_nenner_ids = (set((a["cik"], a["ddate"]) for a in reihen["S-U"]["band_a"])
                     & set((a["cik"], a["ddate"]) for a in reihen["S-G"]["band_a"]))
    ug_auswertbar = [a for a in reihen["S-U"]["band_a"]
                     if (a["cik"], a["ddate"]) in ug_nenner_ids]
    ug_reif, ug_unreif = erst_ereignisse(ug_feuerungen, reihen["S-U"]["gewaehlt"])
    # Wieviele Doppel-Feuerungen waeren zu erwarten, wenn die beiden Signale
    # nichts miteinander zu tun haetten? Der Vergleich sagt, ob S-UG duenn ist,
    # weil die Daten duenn sind — oder weil die beiden Signale verschiedene
    # Dinge sehen. Gerechnet wird auf dem GEMEINSAMEN Nenner, sonst vergleicht
    # man zwei verschieden grosse Grundgesamtheiten.
    n_gemeinsam = len(ug_nenner_ids)
    ug_erwartet = ((len(su & ug_nenner_ids) / n_gemeinsam)
                   * (len(sg & ug_nenner_ids) / n_gemeinsam)
                   * n_gemeinsam) if n_gemeinsam else None
    ergebnisse["S-UG"] = {
        "feuerungen_band": len(ug_feuerungen),
        "firmen_reif": len(ug_reif), "firmen_unreif": len(ug_unreif),
        "firmen_mit_feuerung_band": len(set(f["cik"] for f in ug_feuerungen)),
        "auswertbar_band": len(ug_auswertbar),
        "rate_band": (len(ug_feuerungen) / len(ug_auswertbar)) if ug_auswertbar else None,
        "erwartet_bei_unabhaengigkeit": ug_erwartet,
        "ueberhang_faktor": ((len(ug_feuerungen) / ug_erwartet)
                             if ug_erwartet else None),
        "anteil_an_su": (len(ug_feuerungen) / len(su)) if su else None,
        "anteil_an_sg": (len(ug_feuerungen) / len(sg)) if sg else None,
        "dichte": dichte(ug_feuerungen, ug_auswertbar, branche),
        "p_final": None, "kalibrierung": [],
    }

    # Reine Diagnose: NetIncomeLoss (kein Signal, keine Schwelle).
    d_alle, d_gewaehlt = firmenreihen(je_firma, DIAGNOSE_QUELLEN, False, zaehler,
                                      "nettoergebnis_")
    d_g, d_a = wachstum_und_beschleunigung(d_gewaehlt, zaehler, "nettoergebnis_")
    diagnose = {
        "firmen_mit_reihe": len(d_gewaehlt),
        "firmenquartale": sum(len(r) for r in d_gewaehlt.values()),
        "g_werte": len(d_g), "a_werte": len(d_a),
        "firmen_mit_g": len(set(s["cik"] for s in d_g)),
        "firmen_mit_a": len(set(s["cik"] for s in d_a)),
        "vergleich_betriebsergebnis": {
            "firmen_mit_reihe": ergebnisse["S-G"]["firmen_mit_reihe"],
            "g_werte": ergebnisse["S-G"]["g_werte"],
            "a_werte": ergebnisse["S-G"]["a_werte"],
        }}

    # 52/53-Wochen-Rechner: ihr Geschaeftsjahresende wandert von Jahr zu Jahr.
    # Das ist die einzige Spur, die diese Datenquelle davon uebrig laesst.
    wandernd = set(cik for cik, werte in fye_je_firma.items() if len(werte) > 1)
    mit_reihe = set(reihen["S-U"]["gewaehlt"])
    fiskalkalender = {
        "firmen_mit_geschaeftsjahresende": len(fye_je_firma),
        "firmen_mit_wanderndem_ende": len(wandernd),
        "davon_mit_umsatzreihe": len(wandernd & mit_reihe),
        "jahrespaare_abstand_abweichend":
            zaehler["umsatz_jahrespaar_abstand_abweichend"],
    }

    glaette = pruefe_glaette(reihen["S-U"]["gewaehlt"], firmen_jahr, *BAND_JAHRE)
    ueberlappung = pruefe_ueberlappung(reihen["S-U"]["alle"])

    for name in ("S-U", "S-G", "S-UG"):
        ergebnisse[name]["scheitern"] = scheiternskriterien(
            name, ergebnisse[name], kette_anteil if name == "S-U" else None)
    if not ergebnisse["S-U"]["naht"]["bestanden"]:
        ergebnisse["S-U"]["scheitern"].append("K4: Naht-Invariante verletzt")
    if not glaette["bestanden"]:
        ergebnisse["S-U"]["scheitern"].append(
            "K4: Belegungssprung " + str(round(glaette["groesster_sprung"], 2))
            + " Punkte zwischen Nachbarjahren")

    return {
        "zeitstempel": zeitstempel(),
        "fenster": {"name": FENSTER_NAME, "von": FENSTER_VON, "bis": FENSTER_BIS},
        "gelesene_pfade": list(GEOEFFNETE_PFADE),
        "geschriebene_pfade": list(GESCHRIEBENE_PFADE),
        "ergebnisdaten_beruehrt": False,
        "umgebung": {"python": sys.version.split()[0],
                     "sqlite": sqlite3.sqlite_version,
                     "plattform": sys.platform},
        "zaehler": dict(sorted(zaehler.items())),
        "signale": ergebnisse,
        "diagnose_nettoergebnis": diagnose,
        "fiskalkalender": fiskalkalender,
        "pruefschritt_glaette": glaette,
        "pruefschritt_ueberlappung": ueberlappung,
        "kette": {"mindesttiefe": KETTE_MINDESTTIEFE,
                  "firmen": len(ketten_firmen),
                  "erwartet_laut_e1": KETTE_ERWARTET_E1,
                  "anker_stimmt": len(ketten_firmen) == KETTE_ERWARTET_E1,
                  "davon_mit_umsatzwachstum": len(ketten_firmen & firmen_mit_g),
                  "anteil": kette_anteil},
        "parameter": {"p_start": P_START, "p_erlaubt": list(P_ERLAUBT),
                      "zielband": [ZIEL_RATE_MIN, ZIEL_RATE_MAX],
                      "ziel_firmen": ZIEL_FIRMEN,
                      "trailing_fenster": [TRAILING_VON, TRAILING_BIS],
                      "trailing_min_n": TRAILING_MIN_N,
                      "jahr_fenster": list(JAHR_FENSTER),
                      "quartal_fenster": list(QUARTAL_FENSTER),
                      "g_deckel": G_DECKEL, "reife_quartale": REIFE_QUARTALE,
                      "band_jahre": list(BAND_JAHRE),
                      "rumpfjahre": list(RUMPFJAHRE)},
    }


# =============================================================================
# Report
# =============================================================================

def zahl(n):
    if n is None:
        return "nicht berechenbar"
    if isinstance(n, float):
        return ("%.4f" % n).replace(".", ",")
    return "{:,}".format(n).replace(",", ".")


def prozent(x, stellen=2):
    if x is None:
        return "nicht berechenbar"
    return (("%." + str(stellen) + "f") % (100.0 * x)).replace(".", ",") + " %"


def basis_text(basis):
    return basis[0] + " / " + basis[1]


def schreibe_report(daten, md_pfad, json_pfad):
    pruefe_mauer(md_pfad)
    pruefe_mauer(json_pfad)
    os.makedirs(os.path.dirname(os.path.abspath(md_pfad)), exist_ok=True)
    with open(json_pfad, "w", encoding="utf-8") as fh:
        json.dump(daten, fh, ensure_ascii=False, indent=1, sort_keys=True, default=str)
    with open(md_pfad, "w", encoding="utf-8") as fh:
        fh.write(markdown(daten))


# Protokoll der Gegenproben vom 2026-08-19. Jede der drei Pruefungen wurde
# einmal absichtlich kaputtgemacht; hier steht die Meldung, die dabei kam.
# Ein Waechter, den man nie hat rot werden sehen, ist eine Zeremonie.
GEGENPROBEN = (
    ("Prüfschritt 1 — Naht-Wächter",
     "`basis_gleich` liefert statt des Vergleichs immer `True`",
     ["ROT   Firma 3000: Quellenwechsel erzeugt VIER Naht-Faelle   (ist: 0 | soll: 4)",
      "ROT   Firma 3000 hat kein einziges Wachstum ueber die Naht",
      "ROT   Naht-Invariante ist null (gueltige Form geht DURCH)   (ist: 4 | soll: 0)",
      "SELBSTTEST ROT — 3 Pruefung(en) gescheitert (Exit-Code 1)"]),
    ("Prüfschritt 2 — Belegungs-Glätte",
     "die Sprungmessung wird entfernt (größter Sprung immer 0)",
     ["ROT   Glaette: Loch in 2014 faellt AUF (50 Punkte Sprung)   (ist: 0.0 | soll: 50.0)",
      "SELBSTTEST ROT — 1 Pruefung(en) gescheitert (Exit-Code 1)"]),
    ("Prüfschritt 3 — Überlappung",
     "der Vergleich zweier Quellen im selben Firmen-Quartal wird abgeschaltet",
     ["ROT   Ueberlappung: zwei Firmen-Quartale mit zwei Quellen   (ist: 0 | soll: 2)",
      "ROT   Ueberlappung: genau eines davon ueber 5 Punkten   (ist: 0 | soll: 1)",
      "ROT   Ueberlappung: Anteil 50 % > 10 % -> Folgeregel greift   (ist: None | soll: 0.5)",
      "SELBSTTEST ROT — 3 Pruefung(en) gescheitert (Exit-Code 1)"]),
)


def verifikationsblock(d, a):
    a("## 10. Woran das hier verifiziert wurde")
    a("")
    a("**a) Selbsttest gegen eine kleine, selbst gebaute Datenbank.** Geprüft "
      "wird gegen acht Fixture-Firmen, deren Erwartungswerte von Hand "
      "nachgerechnet sind — unter anderem: die Zeitpunkt-Regel (früherer Bericht 100 schlägt "
      "späteren 999), die Ableitung des vierten Quartals (100 − (10+20+30) = 40), "
      "das symmetrische Wachstum (20/110 = 0,181818…), der Quellenwechsel als "
      "Naht, der 53-Wochen-Fall, und alle drei Signal-Bedingungen einzeln — jede "
      "einmal erfüllt und einmal verletzt. Jede Prüfung wird in **beide** "
      "Richtungen gestellt: die gültige Form muss durchgehen, die kaputte muss "
      "auffliegen.")
    a("")
    a("**b) Jede Prüfung einmal absichtlich kaputtgemacht.** Ein Wächter, den man "
      "nie rot gesehen hat, ist eine Zeremonie. Protokoll:")
    a("")
    for name, wie, meldungen in GEGENPROBEN:
        a("*" + name + "* — Sabotage: " + wie + ".")
        a("")
        a("```")
        for m in meldungen:
            a("  " + m)
        a("```")
        a("")
    a("Nach jeder Gegenprobe wurde der Originalstand wiederhergestellt und der "
      "Selbsttest lief wieder grün.")
    a("")
    a("**c) Nachrechnung von außen.** Drei Feuerungen und eine abgeleitete "
      "Q4-Zahl wurden mit **eigenem Code und eigenen Datenbank-Abfragen** neu "
      "berechnet. Vom Skript stammt dabei nur die Behauptung „hier feuert es\"; "
      "die Zahlen dahinter wurden ohne eine einzige seiner Funktionen aus dem "
      "Panel neu geholt und neu gerechnet — Wachstum, "
      "beide Beschleunigungen und der Schwellenvergleich stimmen auf neun "
      "Nachkommastellen überein; die Q4-Ableitung "
      "(1.163.096 − 816.610 − 3.837 − 3.804 = 338.845) ebenfalls.")
    a("")
    a("**d) Plausibilitätsanker gegen E1.** Die unabhängig nachgezählte Zahl der "
      "Firmen mit mindestens acht Berichtsquartalen am Stück trifft den "
      "E1-Report exakt (7.973).")
    a("")
    a("**e) Wiederaufnahme (R15c).** Der Lauf arbeitet in Häppchen und vermerkt "
      "jedes abgeschlossene. Ein zweiter Lauf über dieselbe Arbeitsdatei "
      "verdoppelt nichts — das ist eine eigene Selbsttest-Prüfung.")
    a("")

def markdown(d):
    su, sg, ug = d["signale"]["S-U"], d["signale"]["S-G"], d["signale"]["S-UG"]
    z = d["zaehler"]
    t = []
    a = t.append
    a("# E2 — Basisraten der Beschleunigungs-Signale")
    a("")
    a("Stand 2026-08-19. Gelesen wurde **ausschließlich** das Entdeckungsfenster "
      "(" + d["fenster"]["von"] + " bis " + d["fenster"]["bis"] + "). "
      "Prüffenster und Endtest-Fenster wurden **nicht geöffnet, nicht entschlüsselt "
      "und nicht gezählt** — der Endtest bleibt bis zum Ende der Studie verschlossen.")
    a("")
    a("*Fachwörter werden bei der ersten Verwendung in einem Halbsatz übersetzt.*")
    a("")
    a("**Lauf-Flag (R4): Ergebnisdaten berührt = " +
      ("JA" if d["ergebnisdaten_beruehrt"] else "NEIN") + ".** Es wurde keine Kurs-, "
      "Rendite- oder Ergebnisdatei geöffnet. Was dieser Lauf wirklich angefasst "
      "hat (Verzeichnis und Dateiname):")
    a("")
    for p in d["gelesene_pfade"]:
        a("- gelesen: `" + p + "`")
    for p in d["geschriebene_pfade"]:
        a("- geschrieben: `" + p + "` (Arbeitsdatei für die Wiederaufnahme)")
    a("")
    a("Läuft im selben Aufruf zuerst der Selbsttest, taucht hier zusätzlich "
      "dessen Fixture-Datenbank auf — sie heißt absichtlich genauso wie das "
      "Panel und liegt in einem Temp-Verzeichnis. Am Verzeichnisnamen ist sie "
      "eindeutig zu unterscheiden.")
    a("")

    a("## Kurz gefasst")
    a("")
    a("- **S-U** (Umsatz-Beschleunigung) feuert im Zielzeitraum 2012–2016 in **"
      + zahl(su["feuerungen_band"]) + "** Firmen-Quartalen von **"
      + zahl(su["auswertbar_band"]) + "** auswertbaren — Feuerrate **"
      + prozent(su["rate_band"]) + "**. Reifes Erst-Ereignis bei **"
      + zahl(su["firmen_reif"]) + " Firmen**.")
    a("- **S-G** (Beschleunigung des Betriebsergebnisses) feuert in **"
      + zahl(sg["feuerungen_band"]) + "** von **" + zahl(sg["auswertbar_band"])
      + "** — Rate **" + prozent(sg["rate_band"]) + "**, reifes Erst-Ereignis bei **"
      + zahl(sg["firmen_reif"]) + " Firmen**.")
    a("- **S-UG** (beides im selben Fiskalquartal) feuert in **"
      + zahl(ug["feuerungen_band"]) + "** von **" + zahl(ug["auswertbar_band"])
      + "** — Rate **" + prozent(ug["rate_band"]) + "**, reifes Erst-Ereignis bei **"
      + zahl(ug["firmen_reif"]) + " Firmen**.")
    a("")
    gescheitert = sorted(set(x for n in ("S-U", "S-G", "S-UG")
                             for x in d["signale"][n]["scheitern"]))
    if gescheitert:
        a("**Vorab festgelegte Scheiternskriterien, die gegriffen haben:**")
        for x in sorted(set(d["signale"]["S-U"]["scheitern"])):
            a("- S-U — " + x)
        for x in sorted(set(d["signale"]["S-G"]["scheitern"])):
            a("- S-G — " + x)
        for x in sorted(set(d["signale"]["S-UG"]["scheitern"])):
            a("- S-UG — " + x)
    else:
        a("**Kein vorab festgelegtes Scheiternskriterium hat gegriffen.**")
    a("")
    a("Plausibilitätsanker gegen den E1-Report: Firmen mit einer ununterbrochenen "
      "Kette von mindestens " + str(d["kette"]["mindesttiefe"]) + " Berichtsquartalen — "
      "hier gezählt **" + zahl(d["kette"]["firmen"]) + "**, laut E1 **"
      + zahl(d["kette"]["erwartet_laut_e1"]) + "** → "
      + ("stimmt" if d["kette"]["anker_stimmt"] else "**stimmt NICHT**") + ".")
    a("")

    a("## 1. Was hier eigentlich gemessen wird")
    a("")
    a("Ein **Signal** ist hier kein Kaufsignal, sondern nur ein Datum, an dem ein "
      "vorab festgelegtes Muster in den veröffentlichten Zahlen einer Firma "
      "auftritt. Ob daraus je etwas folgt, ist Gegenstand späterer Etappen — "
      "diese Etappe misst ausschließlich, **wie oft** das Muster überhaupt "
      "vorkommt und **wie viele Firmen** es tragen.")
    a("")
    a("- **Wachstum g(t)**: Umsatz des Quartals gegen dasselbe Quartal des "
      "Vorjahres, geteilt durch den Mittelwert beider Beträge (*symmetrisch* — "
      "so bleibt die Zahl auch dann endlich, wenn das Vorjahr nahe null lag). "
      "Begrenzt auf ±2.")
    a("- **Beschleunigung a(t)**: g(t) minus g des Vorquartals. Positiv heißt: "
      "das Wachstum wird schneller, nicht bloß, dass es Wachstum gibt.")
    a("- **Schwelle θ(q)**: das **Trailing-Perzentil** — der Wert, den nur die "
      "obersten X % aller Firmen im *bereits veröffentlichten* Rückblick "
      "(Kalenderquartale q−5 bis q−2) überschritten haben. Damit kennt die "
      "Schwelle zum Signalzeitpunkt keine Zukunft.")
    a("- **Feuerung**: ein Firmen-Quartal, in dem alle drei Bedingungen gelten — "
      "zwei Beschleunigungsquartale hintereinander, a(t) über der Schwelle, und "
      "g(t) > 0 (echtes Wachstum, kein langsameres Schrumpfen).")
    a("- **Reifes Erst-Ereignis**: die **erste** Feuerung einer Firma, gefolgt von "
      "mindestens " + str(d["parameter"]["reife_quartale"]) + " weiteren Quartalen "
      "mit auswertbarem Wert derselben Quelle. Nur *Existenz* geprüft — es wurde "
      "kein einziger Ergebniswert berechnet.")
    a("")
    a("**Feuerungen und Fallzahl sind zwei verschiedene Dinge und werden hier "
      "getrennt berichtet.** Die Feuerungen sagen, wie dicht die Ereignisse "
      "liegen; die Fallzahl sagt, wie viele *Firmen* eine spätere Auswertung "
      "überhaupt tragen könnten. Wer nur eine der beiden nennt, verwechselt "
      "später Dichte mit Stichprobe.")
    a("")
    a("### Die Umsatz-Abbildungsschicht (eingefroren)")
    a("")
    a("Der Umsatz heißt in den SEC-Daten nicht durchgehend gleich. Feste "
      "Priorität, je Firmen-Quartal wird **genau eine** Quelle gewählt:")
    a("")
    for i, (name, tags) in enumerate(UMSATZ_QUELLEN, start=1):
        a(str(i) + ". `" + name + "`" + (" (Summe beider Komponenten, nur wenn "
          "beide in beiden Perioden vorliegen)" if len(tags) > 1 else ""))
    a("")
    a("`RevenueFromContractWithCustomerIncludingAssessedTax` bleibt bewusst "
      "draußen — diese Kennung enthält durchlaufende Steuern und liegt damit auf "
      "einem anderen Niveau.")
    a("")
    a("**Die zentrale Regel:** verglichen wird **nie über Quellen hinweg**. "
      "Wechselt eine Firma zwischen zwei Quartalen die Kennung, existiert für "
      "dieses Paar kein Wachstum — der Fall heißt *nicht berechenbar* und wird "
      "als **Quellen-Naht** gezählt (" + zahl(z.get("umsatz_quellen_naht", 0))
      + " Fälle).")
    a("")
    a("Im Entdeckungsfenster ist Priorität 2 "
      "(`RevenueFromContractWithCustomerExcludingAssessedTax`) **leer**: die "
      "Kennung wurde erst ab 2018 verwendet. Für dieses Fenster tragen also nur "
      "die Prioritäten 1, 3 und 4.")
    a("")

    a("## 2. Kalibrierung — regelbasiert, nicht nach Augenmaß")
    a("")
    a("Zielband je Signal, vorab festgelegt: Feuerrate zwischen **"
      + prozent(d["parameter"]["zielband"][0], 1) + "** und **"
      + prozent(d["parameter"]["zielband"][1], 1) + "** der auswertbaren "
      "Firmen-Quartale **und** mindestens **" + str(d["parameter"]["ziel_firmen"])
      + " Firmen** mit reifem Erst-Ereignis, gemessen 2012–2016. Nachjustiert "
      "wird ausschließlich das Perzentil P: Rate zu hoch → P + 5, Rate zu tief "
      "oder zu wenige Firmen → P − 5; höchstens zwei Schritte, erlaubt sind "
      + str(d["parameter"]["p_erlaubt"]) + ".")
    a("")
    a("Die Persistenz-Regel (zwei Quartale) und das Niveau-Gate (g > 0) sind "
      "**keine Knöpfe** — sie wurden nicht verändert.")
    a("")
    for name in ("S-U", "S-G"):
        s = d["signale"][name]
        a("**" + name + "** — Endstand P" + str(s["p_final"]) + ":")
        a("")
        a("| Schritt | P | Feuerungen | auswertbar | Rate | Firmen reif | Entscheid |")
        a("|---|---:|---:|---:|---:|---:|---|")
        for k in s["kalibrierung"]:
            a("| " + str(k["schritt"]) + " | " + str(k["p"]) + " | "
              + zahl(k["feuerungen_band"]) + " | " + zahl(k["auswertbar_band"])
              + " | " + prozent(k["rate"]) + " | " + zahl(k["firmen_reif"])
              + " | " + k.get("entscheid", "") + " |")
        a("")
    a("S-UG hat **keine eigenen Parameter** — es ist die Schnittmenge von S-U und "
      "S-G im selben Fiskalquartal.")
    a("")

    a("## 3. Feuerraten und Fallzahlen je Signal")
    a("")
    a("| Größe | S-U | S-G | S-UG |")
    a("|---|---:|---:|---:|")
    def zeile(bez, schluessel, fmt=zahl):
        # Fehlender Schluessel heisst "gilt fuer dieses Signal nicht" — das ist
        # etwas anderes als "nicht berechenbar" und darf nicht so aussehen.
        def z(quelle):
            return fmt(quelle[schluessel]) if schluessel in quelle else "—"
        a("| " + bez + " | " + z(su) + " | " + z(sg) + " | " + z(ug) + " |")
    zeile("Firmen mit auswertbarer Quartalsreihe", "firmen_mit_reihe")
    zeile("Wachstumswerte g", "g_werte")
    zeile("Beschleunigungswerte a", "a_werte")
    zeile("auswertbare Firmen-Quartale 2012–2016", "auswertbar_band")
    zeile("**Feuerungen 2012–2016**", "feuerungen_band")
    zeile("Feuerrate 2012–2016", "rate_band", prozent)
    zeile("Firmen mit mindestens einer Feuerung", "firmen_mit_feuerung_band")
    zeile("**Firmen mit reifem Erst-Ereignis**", "firmen_reif")
    zeile("Firmen mit unreifem Erst-Ereignis", "firmen_unreif")
    a("")
    a("Feuerungen in den **Rumpfjahren 2009–2011** — nur nachrichtlich, sie sind "
      "von Kalibrierung und Zielband ausgeschlossen (2009 trägt laut E1 nur 6 %, "
      "2010 nur 19 % der Firmen des Fensters): S-U **"
      + zahl(su["feuerungen_rumpfjahre"]) + "**, S-G **"
      + zahl(sg["feuerungen_rumpfjahre"]) + "**.")
    a("")
    if ug["anteil_an_su"] is not None:
        a("S-UG ist " + prozent(ug["anteil_an_su"]) + " von S-U und "
          + prozent(ug["anteil_an_sg"]) + " von S-G.")
        a("")
    if ug.get("erwartet_bei_unabhaengigkeit"):
        a("**Warum S-UG so dünn ist.** Hätten die beiden Signale nichts "
          "miteinander zu tun, wären auf dem gemeinsamen Nenner rein rechnerisch "
          "**" + ("%.1f" % ug["erwartet_bei_unabhaengigkeit"]).replace(".", ",")
          + "** Doppel-Feuerungen zu erwarten. Beobachtet sind **"
          + zahl(ug["feuerungen_band"]) + "** — das "
          + ("%.1f" % ug["ueberhang_faktor"]).replace(".", ",") + "-fache. "
          "Umsatz- und Ergebnis-Beschleunigung treten also **häufiger gemeinsam "
          "auf als der Zufall es täte, aber bei weitem nicht deckungsgleich**. "
          "S-UG scheitert an der Fallzahl nicht, weil die Daten fehlen, sondern "
          "weil beide Bedingungen zugleich schlicht selten sind. Das ist ein "
          "Ergebnis, kein Defekt — und es ist der Grund, warum S-UG als eigenes "
          "Signal in dieser Form nicht trägt.")
        a("")

    a("## 4. Wie dicht liegen die Feuerungen?")
    a("")
    a("Gezählt wird nach dem **Signal-Zeitstempel**: dem Moment, ab dem alle "
      "Zutaten der Rechnung öffentlich waren (spätester `accepted`-Zeitpunkt "
      "aller beteiligten Berichte). Jede Zahl steht **mit ihrem Nenner** — die "
      "auswertbaren Firmen-Quartale desselben Monats bzw. Bereichs.")
    a("")
    a("### S-U je Kalendermonat (2012–2016)")
    a("")
    a("| Monat | Feuerungen | auswertbar | Rate |")
    a("|---|---:|---:|---:|")
    for m, zz, nn in su["dichte"]["monat"]:
        a("| " + m + " | " + zahl(zz) + " | " + zahl(nn) + " | "
          + prozent(zz / nn if nn else None) + " |")
    a("")
    a("### Feuerungen je SIC-Bereich (2012–2016)")
    a("")
    a("Die **SIC-Kennung** ist die vierstellige amtliche US-Branchenkennung der "
      "SEC; gruppiert wird auf die amtlichen Bereiche.")
    a("")
    a("| Bereich | S-U | Nenner | Rate | S-G | Nenner | Rate |")
    a("|---|---:|---:|---:|---:|---:|---:|")
    sg_map = dict((b, (zz, nn)) for b, zz, nn in sg["dichte"]["sektor"])
    for b, zz, nn in sorted(su["dichte"]["sektor"], key=lambda r: -r[1]):
        g_z, g_n = sg_map.get(b, (0, 0))
        a("| " + b + " | " + zahl(zz) + " | " + zahl(nn) + " | "
          + prozent(zz / nn if nn else None) + " | " + zahl(g_z) + " | "
          + zahl(g_n) + " | " + prozent(g_z / g_n if g_n else None) + " |")
    a("")
    a("### Feuerungen je Kalenderjahr (2012–2016)")
    a("")
    a("| Jahr | S-U | S-G | S-UG |")
    a("|---|---:|---:|---:|")
    jahre = sorted(set([j for j, _ in su["dichte"]["jahr"]]
                       + [j for j, _ in sg["dichte"]["jahr"]]))
    su_j, sg_j, ug_j = (dict(su["dichte"]["jahr"]), dict(sg["dichte"]["jahr"]),
                        dict(ug["dichte"]["jahr"]))
    for j in jahre:
        a("| " + str(j) + " | " + zahl(su_j.get(j, 0)) + " | " + zahl(sg_j.get(j, 0))
          + " | " + zahl(ug_j.get(j, 0)) + " |")
    a("")
    a("Die vollständige Kreuztabelle Monat × Bereich steht in der JSON-Fassung "
      "dieses Reports (`kreuz_monat_sektor`); sie hier abzudrucken würde den "
      "Report nur aufblähen.")
    a("")

    a("## 5. Die drei Prüfschritte")
    a("")
    naht = su["naht"]
    a("### Prüfschritt 1 — Naht-Invariante")
    a("")
    a("Frage: steht im fertigen Ergebnis auch nur **eine** Wachstums- oder "
      "Beschleunigungszahl, deren beide Enden verschiedene Umsatz-Quellen tragen? "
      "Antwort: **" + zahl(naht["gesamt"]) + "** (gefordert: 0) — davon "
      + zahl(naht["g_gemischt"]) + " Wachstums- und " + zahl(naht["a_gemischt"])
      + " Beschleunigungswerte. Ergebnis: **"
      + ("bestanden" if naht["bestanden"] else "DURCHGEFALLEN") + "**.")
    a("")
    a("Der Nachzähler ist **unabhängig vom Wächter**: er prüft nicht, ob der "
      "Wächter aufgerufen wurde, sondern zählt am Ergebnis nach. Beim "
      "Gegenprobe-Lauf wurde der Wächter absichtlich ausgebaut — dann geht diese "
      "Zahl über null und der Selbsttest wird rot. Die rote Meldung steht "
      "wörtlich in Abschnitt 10.")
    a("")
    gl = d["pruefschritt_glaette"]
    a("### Prüfschritt 2 — Belegungs-Glätte")
    a("")
    a("Anteil der Firmen mit mindestens einem auswertbaren Umsatz-Quartal je "
      "Kalenderjahr. Nenner: Firmen mit mindestens einem periodischen Bericht in "
      "diesem Jahr. Ein Sprung von über "
      + str(GLAETTE_MAX_SPRUNG).replace(".", ",")
      + " Prozentpunkten zwischen Nachbarjahren wäre fast immer ein Datenbruch, "
      "kein Marktereignis.")
    a("")
    a("| Jahr | Firmen gesamt | davon mit Umsatz-Quartal | Anteil |")
    a("|---|---:|---:|---:|")
    for r in gl["jahre"]:
        a("| " + str(r["jahr"]) + " | " + zahl(r["firmen_gesamt"]) + " | "
          + zahl(r["firmen_mit_umsatzquartal"]) + " | "
          + (("%.2f" % r["anteil_prozent"]).replace(".", ",") + " %"
             if r["anteil_prozent"] is not None else "nicht berechenbar") + " |")
    a("")
    a("Größter Sprung zwischen Nachbarjahren: **"
      + ("%.2f" % gl["groesster_sprung"]).replace(".", ",") + " Punkte** → **"
      + ("bestanden" if gl["bestanden"] else "DURCHGEFALLEN") + "**.")
    a("")
    ue = d["pruefschritt_ueberlappung"]
    a("### Prüfschritt 3 — Überlappung der Quellen")
    a("")
    a("Wo mindestens zwei Umsatz-Quellen im selben Firmen-Quartal ein Wachstum "
      "liefern: wie weit liegen sie auseinander?")
    a("")
    a("| Größe | Wert |")
    a("|---|---:|")
    a("| Firmen-Quartale mit mindestens zwei Quellen | "
      + zahl(ue["firmenquartale_mit_mehreren_quellen"]) + " |")
    a("| davon Abstand über 5 Punkte | " + zahl(ue["davon_abstand_ueber_schwelle"]) + " |")
    a("| Anteil | " + prozent(ue["anteil"]) + " |")
    a("| Median des Abstands | " + zahl(ue["median"]) + " |")
    a("| 90. Perzentil | " + zahl(ue["p90"]) + " |")
    a("| 99. Perzentil | " + zahl(ue["p99"]) + " |")
    a("")
    if ue["regel_greift"]:
        a("Der Anteil liegt über 10 % — die **vorab festgelegte** Folgeregel greift: "
          "die Quelle wird künftig **je Firma** fixiert (längste Serie) statt je "
          "Quartal. Diese Regel stand vor der Messung fest, sie wurde hier nicht "
          "erfunden. **Sie ist in dieser Etappe noch nicht angewandt** — das wäre "
          "eine Änderung der präregistrierten Rechenvorschrift und gehört in die "
          "nächste Etappe.")
    else:
        a("Der Anteil liegt bei oder unter 10 % — die Quellenwahl bleibt je "
          "Firmen-Quartal, wie präregistriert.")
    a("")

    a("## 6. Was nicht berechenbar war (Regel R5)")
    a("")
    a("Nie geschätzt, nie auf null gesetzt — jeder Fall mit Grund gezählt.")
    a("")
    a("| Fall | Anzahl |")
    a("|---|---:|")
    erklaerung = {
        "umsatz_quellen_naht": "Umsatz: Partnerquartal trägt eine andere Quelle (Quellen-Naht)",
        "umsatz_kein_vorjahrespartner": "Umsatz: kein Vorjahresquartal im Fenster 330–380 Tage",
        "umsatz_kein_vorquartal": "Umsatz: kein Vorquartal im Fenster 80–110 Tage",
        "umsatz_kein_vorquartal_beschleunigung": "Umsatz: kein Vorquartal für die zweite Beschleunigung",
        "umsatz_keine_schwelle": "Umsatz: Trailing-Fenster trägt weniger als 200 Werte",
        "umsatz_jahrespaar_abstand_abweichend": "Umsatz: Jahrespaar kein volles Kalenderjahr (nachrichtlich)",
        "betriebsergebnis_jahrespaar_abstand_abweichend": "Betriebsergebnis: Jahrespaar kein volles Kalenderjahr (nachrichtlich)",
        "nettoergebnis_jahrespaar_abstand_abweichend": "Nettoergebnis (Diagnose): Jahrespaar kein volles Kalenderjahr",
        "betriebsergebnis_komponente_fehlt_quartal": "Betriebsergebnis: Summen-Quelle unvollständig",
        "nettoergebnis_komponente_fehlt_quartal": "Nettoergebnis (Diagnose): Summen-Quelle unvollständig",
        "nettoergebnis_quellen_naht": "Nettoergebnis (Diagnose): Quellen-Naht",
        "nettoergebnis_keine_schwelle": "Nettoergebnis (Diagnose): keine Schwelle (Diagnose hat keine)",
        "nettoergebnis_kein_vorquartal_beschleunigung": "Nettoergebnis (Diagnose): kein Vorquartal für die zweite Beschleunigung",
        "bericht_ohne_geschaeftsjahresende": "Bericht ohne Geschäftsjahresende",
        "umsatz_q4_komponente_fehlt": "Umsatz: viertes Quartal nicht ableitbar (Komponente fehlt)",
        "umsatz_q4_komponente_nicht_positiv": "Umsatz: viertes Quartal abgeleitet, aber ein Vorquartal war <= 0 (nachrichtlich)",
        "umsatz_q4_abgeleitet": "Umsatz: viertes Quartal erfolgreich abgeleitet (nachrichtlich)",
        "umsatz_komponente_fehlt_quartal": "Umsatz: Summen-Quelle unvollständig (nur eine Komponente)",
        "umsatz_umsatz_nicht_positiv": "Umsatz: Wert kleiner oder gleich null",
        "umsatz_nenner_null": "Umsatz: symmetrischer Nenner ist null",
        "betriebsergebnis_quellen_naht": "Betriebsergebnis: Quellen-Naht",
        "betriebsergebnis_kein_vorjahrespartner": "Betriebsergebnis: kein Vorjahresquartal",
        "betriebsergebnis_kein_vorquartal": "Betriebsergebnis: kein Vorquartal",
        "betriebsergebnis_kein_vorquartal_beschleunigung": "Betriebsergebnis: kein Vorquartal für die zweite Beschleunigung",
        "betriebsergebnis_keine_schwelle": "Betriebsergebnis: Trailing-Fenster zu dünn",
        "betriebsergebnis_q4_komponente_fehlt": "Betriebsergebnis: viertes Quartal nicht ableitbar",
        "betriebsergebnis_q4_abgeleitet": "Betriebsergebnis: viertes Quartal abgeleitet (nachrichtlich)",
        "betriebsergebnis_nenner_null": "Betriebsergebnis: symmetrischer Nenner ist null",
        "nettoergebnis_kein_vorjahrespartner": "Nettoergebnis (Diagnose): kein Vorjahresquartal",
        "nettoergebnis_kein_vorquartal": "Nettoergebnis (Diagnose): kein Vorquartal",
        "nettoergebnis_q4_komponente_fehlt": "Nettoergebnis (Diagnose): viertes Quartal nicht ableitbar",
        "nettoergebnis_q4_abgeleitet": "Nettoergebnis (Diagnose): viertes Quartal abgeleitet",
        "nettoergebnis_nenner_null": "Nettoergebnis (Diagnose): symmetrischer Nenner ist null",
        "verworfen_coreg": "Datenzeile eines Mit-Registranten (nicht Konzern) — verworfen",
        "verworfen_firmeneigene_taxonomie": "Datenzeile mit firmeneigener Kennung — verworfen",
        "verworfen_nicht_periodisch": "Datenzeile aus nicht-periodischem Bericht — verworfen",
        "verworfen_periodenlaenge": "Datenzeile mit anderer Periodenlänge als 1 oder 4 Quartale",
        "verworfen_stichtag_unlesbar": "Datenzeile mit unlesbarem Bilanzstichtag",
        "verworfen_wert_leer": "Datenzeile ohne Wert",
        "bericht_ohne_cik": "Bericht ohne Firmennummer",
        "bericht_ohne_accepted": "Bericht ohne Veröffentlichungszeitpunkt",
        "bericht_ohne_branche": "Bericht ohne brauchbare Branchenkennung",
        "bericht_ohne_periode": "Bericht ohne lesbaren Berichtszeitraum",
        "pit_schluessel_mehrfach": "Größe steht in mehreren Berichtsfassungen (frühester gewinnt)",
        "pit_schluessel_wertkonflikt": "Größe wurde später mit ANDEREM Wert erneut gemeldet",
        "berichte_periodisch": "periodische Berichte gesamt (nachrichtlich)",
        "fakt_kandidaten": "geprüfte Datenzeilen der Zielkennungen (nachrichtlich)",
        "pit_werte": "Größen nach der Zeitpunkt-Bereinigung (nachrichtlich)",
        "roh_zeilen": "Datenzeilen nach allen Filtern (nachrichtlich)",
    }
    for name in sorted(z):
        a("| " + erklaerung.get(name, name) + " | " + zahl(z[name]) + " |")
    a("")
    a("Die Zeile *Groesse wurde spaeter mit ANDEREM Wert erneut gemeldet* ist der "
      "Beleg dafür, dass die Zeitpunkt-Regel etwas bewirkt: in **"
      + zahl(z.get("pit_schluessel_wertkonflikt", 0)) + "** Fällen hätte ein "
      "späterer Berichtsstand eine andere Zahl geliefert. Gerechnet wurde immer "
      "mit der **zuerst veröffentlichten**.")
    a("")

    fk = d["fiskalkalender"]
    a("### Was diese Datenquelle nicht hergibt: 53-Wochen-Geschäftsjahre")
    a("")
    a("Viele Handels- und Technikfirmen rechnen nicht in Kalendermonaten, sondern "
      "in 52 bzw. 53 Wochen — etwa alle fünf bis sechs Jahre hat ihr "
      "Geschäftsjahr eine Woche mehr. Der Plan sah vor, diese Fälle zu **zählen**. "
      "Über den Abstand der Bilanzstichtage geht das hier **nicht**: der "
      "SEC-Datensatz rundet den Stichtag `ddate` auf das Monatsende. Als Tag des "
      "Monats kommen nur 28, 29, 30 und 31 vor, und **alle** Jahrespaare liegen "
      "bei 365 oder 366 Tagen — ein 53-Wochen-Jahr (371 Tage) kann in diesen "
      "Daten gar nicht auffallen.")
    a("")
    a("Ein Zähler auf „Abstand ab 368 Tagen\" hätte deshalb dauerhaft **0** "
      "gemeldet und wie ein Befund ausgesehen. Er wurde ersetzt durch das, was "
      "hier wirklich messbar ist:")
    a("")
    a("| Größe | Anzahl |")
    a("|---|---:|")
    a("| Firmen mit angegebenem Geschäftsjahresende | "
      + zahl(fk["firmen_mit_geschaeftsjahresende"]) + " |")
    a("| davon mit **wanderndem** Geschäftsjahresende (das sind die "
      "52/53-Wochen-Rechner) | " + zahl(fk["firmen_mit_wanderndem_ende"]) + " |")
    a("| davon mit auswertbarer Umsatzreihe | " + zahl(fk["davon_mit_umsatzreihe"]) + " |")
    a("| Jahrespaare, deren Abstand kein volles Kalenderjahr ist | "
      + zahl(fk["jahrespaare_abstand_abweichend"]) + " |")
    a("")
    a("Diese Firmen sind also **nicht ignoriert** — sie sind gezählt und laufen "
      "normal mit. Was fehlt, ist die Möglichkeit, das einzelne 53-Wochen-Jahr "
      "zu markieren; das steht als offene Frage in Abschnitt 9.")
    a("")
    dg = d["diagnose_nettoergebnis"]
    a("## 7. Diagnose: trägt `NetIncomeLoss` mehr als `OperatingIncomeLoss`?")
    a("")
    a("Reine Diagnose — kein Signal, keine Schwelle, keine Kalibrierung. Sie soll "
      "der nächsten Etappe erlauben, **mit Zahlen** zu entscheiden, falls S-G zu "
      "dünn trägt. `NetIncomeLoss` ist das Ergebnis nach Steuern, "
      "`OperatingIncomeLoss` das Betriebsergebnis.")
    a("")
    a("| Größe | NetIncomeLoss | OperatingIncomeLoss |")
    a("|---|---:|---:|")
    v = dg["vergleich_betriebsergebnis"]
    a("| Firmen mit auswertbarer Quartalsreihe | " + zahl(dg["firmen_mit_reihe"])
      + " | " + zahl(v["firmen_mit_reihe"]) + " |")
    a("| Wachstumswerte g | " + zahl(dg["g_werte"]) + " | " + zahl(v["g_werte"]) + " |")
    a("| Beschleunigungswerte a | " + zahl(dg["a_werte"]) + " | " + zahl(v["a_werte"]) + " |")
    a("| Firmen mit mindestens einem g | " + zahl(dg["firmen_mit_g"]) + " | — |")
    a("")

    a("## 8. Scheiternskriterien — vorab festgelegt")
    a("")
    a("| Kriterium | Stand |")
    a("|---|---|")
    a("| K1 — S-U unter " + str(ZIEL_FIRMEN) + " Firmen mit reifem Erst-Ereignis | "
      + zahl(su["firmen_reif"]) + " → "
      + ("**GEGRIFFEN**" if su["firmen_reif"] < ZIEL_FIRMEN else "nicht gegriffen") + " |")
    k = d["kette"]
    a("| K2 — unter 50 % der Firmen mit 8-Quartals-Kette haben ein "
      "Umsatz-Wachstumsquartal | " + prozent(k["anteil"]) + " von "
      + zahl(k["firmen"]) + " → "
      + ("**GEGRIFFEN**" if (k["anteil"] or 0) < SCHEITERN_KETTENANTEIL
         else "nicht gegriffen") + " |")
    sekt = su["dichte"]["sektor"]
    ges = sum(x for _, x, _ in sekt) or 1
    top_s = max(sekt, key=lambda r: r[1]) if sekt else ("—", 0, 0)
    top_j = max(su["dichte"]["jahr"], key=lambda r: r[1]) if su["dichte"]["jahr"] else (0, 0)
    a("| K3a — über 50 % der S-U-Feuerungen in einem SIC-Bereich | "
      + prozent(top_s[1] / ges) + " (" + str(top_s[0]) + ") → "
      + ("**GEGRIFFEN**" if top_s[1] / ges > SCHEITERN_KONZENTRATION_SEKTOR
         else "nicht gegriffen") + " |")
    a("| K3b — über 40 % der S-U-Feuerungen in einem Kalenderjahr | "
      + prozent(top_j[1] / ges) + " (" + str(top_j[0]) + ") → "
      + ("**GEGRIFFEN**" if top_j[1] / ges > SCHEITERN_KONZENTRATION_JAHR
         else "nicht gegriffen") + " |")
    a("| K4 — Naht-Invariante ungleich 0 oder Belegungssprung über 5 Punkte | "
      "Naht " + zahl(naht["gesamt"]) + ", Sprung "
      + ("%.2f" % gl["groesster_sprung"]).replace(".", ",") + " → "
      + ("**GEGRIFFEN**" if (naht["gesamt"] or not gl["bestanden"])
         else "nicht gegriffen") + " |")
    a("")
    a("S-G und S-UG dürfen **einzeln** scheitern, ohne die Signalfamilie zu kippen.")
    a("")

    a("## 9. Neue Fragen und Hypothesen (Pflichtblock nach R16)")
    a("")
    for frage in d["fragen"]:
        a("- " + frage)
    a("")
    verifikationsblock(d, a)
    a("---")
    a("")
    a("*Erzeugt " + d["zeitstempel"] + " · Python " + d["umgebung"]["python"]
      + " · SQLite " + d["umgebung"]["sqlite"] + " · nur Standardbibliothek "
      "und sqlite3 (R14c).*")
    return "\n".join(t) + "\n"


def folgefragen(d):
    """R16: die Etappe endet mit ihren Folgefragen, nicht mit dem Ergebnis."""
    su, sg = d["signale"]["S-U"], d["signale"]["S-G"]
    dg = d["diagnose_nettoergebnis"]
    ue = d["pruefschritt_ueberlappung"]
    fragen = []
    fragen.append(
        "**Banken-Sonderfamilie ja/nein?** Der Bereich „Finanzen, Versicherung, "
        "Immobilien\" stellt laut E1 die zweitgrößte Firmengruppe, hat aber ein "
        "anderes Umsatzverständnis (Zinsertrag statt Warenverkauf). Hier trägt er "
        + prozent(next((zz / (sum(x for _, x, _ in su["dichte"]["sektor"]) or 1)
                        for b, zz, _ in su["dichte"]["sektor"]
                        if b.startswith("Finanzen")), 0.0))
        + " der S-U-Feuerungen. Zu klären: eigene Signalfamilie, Ausschluss oder "
          "unverändert mitlaufen lassen — mit Vorab-Kriterium, nicht nach "
          "Ergebnislage. (Zeitschätzung: 1–2 Tage)")
    fragen.append(
        "**`NetIncomeLoss` als Alternative für S-G?** Das Ergebnis nach Steuern "
        "liefert " + zahl(dg["a_werte"]) + " Beschleunigungswerte gegen "
        + zahl(sg["a_werte"]) + " beim Betriebsergebnis. Ob die zusätzliche Tiefe "
        "die schlechtere Aussagekraft (Einmaleffekte, Steuerquote) aufwiegt, ist "
        "eine Vorab-Entscheidung der nächsten Etappe — nicht nachträglich nach "
        "Ergebnis auswählbar. (Zeitschätzung: 1 Tag)")
    fragen.append(
        "**Aktienzahl-Abdeckung für die Je-Aktie-Rechnung (R10).** Der "
        "Endpunkt-Wächter verlangt eine Pflicht-Nebenrechnung „Umsatz je Aktie\". "
        "Laut E1 steht `CommonStockSharesOutstanding` in 70 % der periodischen "
        "Berichte — ob das nach denselben Filtern (Konzern-Zeilen, amtliche "
        "Taxonomie, Zeitpunkt-Regel) reicht, ist ungemessen. Das ist die "
        "nächste Pflichtmessung, bevor R10 präregistriert wird. "
        "(Zeitschätzung: 1 Tag)")
    if ue["regel_greift"]:
        fragen.append(
            "**Quellenwahl je Firma statt je Quartal.** Prüfschritt 3 hat die "
            "vorab festgelegte Schwelle gerissen (" + prozent(ue["anteil"])
            + " der überlappenden Firmen-Quartale liegen über 5 Punkten "
              "auseinander). Die Regel verlangt, die Quelle künftig je Firma zu "
              "fixieren. Offen: um wie viel schrumpft dadurch die Fallzahl, und "
              "ändert sich die Feuerrate? Beides muss vor der Umstellung gemessen "
              "und präregistriert werden. (Zeitschätzung: 1 Tag)")
    fragen.append(
        "**Wie viel kostet die Naht?** " + zahl(d["zaehler"].get("umsatz_quellen_naht", 0))
        + " Firmen-Quartale sind nur deshalb nicht berechenbar, weil die Firma "
          "zwischen zwei Quartalen die Umsatz-Kennung wechselt. Offen: Sind das "
          "Zufallswechsel oder systematisch dieselben Firmen (dann fehlt eine ganze "
          "Firmenklasse)? Und: wäre eine Verkettung über einen Überlappungsfaktor "
          "verantwortbar, oder ist das genau die Sorte stiller Annahme, die diese "
          "Studie verbietet? (Zeitschätzung: 1–2 Tage)")
    fragen.append(
        "**53-Wochen-Geschäftsjahre sichtbar machen.** Der Stichtag `ddate` ist in "
        "dieser Quelle auf das Monatsende gerundet, deshalb ist ein "
        "53-Wochen-Jahr über den Stichtagsabstand unsichtbar. Messbar wäre es "
        "über das Geschäftsjahresende `fye` im Berichtskopf ("
        + zahl(d["fiskalkalender"]["firmen_mit_wanderndem_ende"]) + " Firmen mit "
        "wanderndem Ende, davon " + zahl(d["fiskalkalender"]["davon_mit_umsatzreihe"])
        + " mit Umsatzreihe) oder über das echte Periodenende in den "
        "Original-Einreichungen. Offen: Verzerrt das zusätzliche Quartal die "
        "Wachstumsrate dieser Firmen systematisch nach oben — und liegen sie "
        "deshalb häufiger unter den Feuerungen? (Zeitschätzung: 1 Tag)")
    fragen.append(
        "**Was bedeutet der Deckel bei ±2?** Wie viele Wachstumswerte laufen "
        "tatsächlich in die Begrenzung, und sind das dieselben Firmen (Neulinge "
        "aus dem Nichts) wie die späteren Signalträger? Wenn ja, misst das Signal "
        "womöglich vor allem Basiseffekte kleiner Ausgangszahlen. "
        "(Zeitschätzung: 0,5 Tage)")
    return fragen


# =============================================================================
# Selbsttest — kleine selbstgebaute Datenbank mit von Hand nachgerechneten Werten
# =============================================================================

FEHLER = []


def pruefe(name, bedingung, ist=None, soll=None):
    if bedingung:
        print("  ok    " + name)
    else:
        zusatz = ""
        if ist is not None or soll is not None:
            zusatz = "   (ist: " + repr(ist) + " | soll: " + repr(soll) + ")"
        print("  ROT   " + name + zusatz)
        FEHLER.append(name + zusatz)


def _plus_tage(ddate, tage):
    return date.fromordinal(ordinal(ddate) + tage).strftime("%Y%m%d")


def _baue_fixture(pfad):
    """Winzige Panel-Datei mit von Hand nachgerechneten Erwartungswerten."""
    conn = sqlite3.connect(pfad, isolation_level=None)
    conn.execute("CREATE TABLE bericht (adsh TEXT PRIMARY KEY, cik TEXT, name TEXT,"
                 " sic TEXT, fye TEXT, form TEXT, period TEXT, accepted TEXT)")
    conn.execute("CREATE TABLE fakt (adsh TEXT, tag TEXT, version TEXT, coreg TEXT,"
                 " ddate TEXT, qtrs TEXT, uom TEXT, value REAL, footnote TEXT)")
    zaehlwerk = [0]

    def bericht(cik, sic, form, ddate, tage=45, adsh=None):
        zaehlwerk[0] += 1
        kennung = adsh or ("B%05d" % zaehlwerk[0])
        acc = date.fromordinal(ordinal(ddate) + tage).strftime("%Y-%m-%d") + " 12:00:00.0"
        # Firma 8000 rechnet in Wochen: ihr Geschaeftsjahresende wandert.
        fye = ddate[4:] if cik == "8000" else "1231"
        conn.execute("INSERT INTO bericht VALUES (?,?,?,?,?,?,?,?)",
                     (kennung, cik, "FIRMA " + cik, sic, fye, form, ddate, acc))
        return kennung

    def fakt(adsh, tag, ddate, qtrs, wert, uom="USD", version="us-gaap/2013", coreg=""):
        conn.execute("INSERT INTO fakt VALUES (?,?,?,?,?,?,?,?,?)",
                     (adsh, tag, version, coreg, ddate, qtrs, uom, wert, ""))

    # -- Firma 1000: saubere Umsatzreihe, direkte Quartalswerte ---------------
    klar = {"20120331": 100.0, "20120630": 110.0, "20120930": 120.0, "20121231": 130.0,
            "20130331": 120.0, "20130630": 143.0, "20130930": 168.0, "20131231": 169.0,
            "20140331": 168.0, "20140630": 200.0}
    for d, w in klar.items():
        b = bericht("1000", "3674", "10-K" if d.endswith("1231") else "10-Q", d)
        fakt(b, "Revenues", d, "1", w)

    # -- Firma 2000: viertes Quartal muss abgeleitet werden ------------------
    for jahr, (q1, q2, q3, fy) in {"2012": (10.0, 20.0, 30.0, 100.0),
                                   "2013": (15.0, 25.0, 35.0, 125.0)}.items():
        for d, w in ((jahr + "0331", q1), (jahr + "0630", q2), (jahr + "0930", q3)):
            b = bericht("2000", "3674", "10-Q", d)
            fakt(b, "SalesRevenueNet", d, "1", w)
        b = bericht("2000", "3674", "10-K", jahr + "1231")
        fakt(b, "SalesRevenueNet", jahr + "1231", "4", fy)

    # -- Firma 3000: Quellenwechsel zwischen den Jahren = Naht ---------------
    for d in ("20120331", "20120630", "20120930", "20121231"):
        b = bericht("3000", "7372", "10-Q", d)
        fakt(b, "SalesRevenueNet", d, "1", 100.0)
    for d in ("20130331", "20130630", "20130930", "20131231"):
        b = bericht("3000", "7372", "10-Q", d)
        fakt(b, "Revenues", d, "1", 120.0)

    # -- Firma 4000: Zeitpunkt-Regel — der FRUEHESTE Bericht gewinnt ---------
    b_frueh = bericht("4000", "2836", "10-Q", "20120331", tage=45)
    fakt(b_frueh, "Revenues", "20120331", "1", 100.0)
    b_spaet = bericht("4000", "2836", "10-K/A", "20120331", tage=410)
    fakt(b_spaet, "Revenues", "20120331", "1", 999.0)

    # -- Firma 5000: alles, was ignoriert werden MUSS ------------------------
    b = bericht("5000", "3674", "10-Q", "20120331")
    fakt(b, "Revenues", "20120331", "1", 500.0, coreg="TOCHTER")
    fakt(b, "Revenues", "20120630", "1", 500.0, version="0001234567-13-000001")
    b8 = bericht("5000", "3674", "8-K", "20120930")
    fakt(b8, "Revenues", "20120930", "1", 500.0)

    # -- Firma 6000: Umsatz kleiner/gleich null ------------------------------
    for d, w in (("20120331", 0.0), ("20120630", 50.0), ("20120930", -10.0)):
        b = bericht("6000", "1311", "10-Q", d)
        fakt(b, "Revenues", d, "1", w)

    # -- Firma 7000: zwei Quellen im selben Firmen-Quartal -------------------
    for d, rev, srn in (("20120331", 100.0, 100.0), ("20130331", 120.0, 150.0),
                        ("20120630", 100.0, 100.0), ("20130630", 110.0, 111.0)):
        b = bericht("7000", "3711", "10-Q", d)
        fakt(b, "Revenues", d, "1", rev)
        fakt(b, "SalesRevenueNet", d, "1", srn)

    # -- Firma 8000: 53-Wochen-Fiskaljahr (371 Tage Abstand) -----------------
    for d, w in (("20120929", 100.0), ("20131005", 110.0)):
        b = bericht("8000", "2020", "10-Q", d)
        fakt(b, "Revenues", d, "1", w)

    conn.commit()
    conn.close()


def _fast(a, b, toleranz=1e-9):
    return a is not None and abs(a - b) < toleranz


def selbsttest():
    import shutil
    import tempfile
    global TRAILING_MIN_N
    verzeichnis = tempfile.mkdtemp(prefix="e2-selbsttest-")
    print("Selbsttest in " + verzeichnis)
    try:
        # --- Die Fenster-Mauer: beide Richtungen --------------------------------
        print("\n[1] Fenster-Mauer (R2)")
        for boese in (r"C:\daten\panel\panel-endtest.sqlite.enc",
                      r"C:\daten\schluessel\endtest.key",
                      r"C:\daten\panel\panel-validierung.sqlite",
                      r"C:\daten\endtest\panel-entdeckung.sqlite"):
            try:
                pruefe_mauer(boese)
                pruefe("gesperrter Pfad wird abgewiesen: " + boese, False)
            except BasisratenFehler:
                pruefe("gesperrter Pfad wird abgewiesen: " + boese, True)
        try:
            pruefe_mauer(os.path.join(verzeichnis, FENSTER_DATEI))
            pruefe("gueltiger Pfad geht DURCH (sonst waere die Mauer nur Deko)", True)
        except BasisratenFehler as fehler:
            pruefe("gueltiger Pfad geht DURCH", False, str(fehler), "kein Abbruch")

        # --- Der ganze Weg auf der kleinen Datenbank ---------------------------
        print("\n[2] Rohwerte, Zeitpunkt-Regel, Quartalsreihen")
        panel_pfad = os.path.join(verzeichnis, FENSTER_DATEI)
        _baue_fixture(panel_pfad)
        panel = oeffne_nur_lesend(panel_pfad)
        arbeit = oeffne_zwischenstand(os.path.join(verzeichnis, "zwischen.sqlite"), True)
        zaehler = defaultdict(int)
        berichte, firmen_jahr, quartale, fye = lade_berichte(panel, zaehler)
        zeilen = lies_rohwerte(panel, arbeit, berichte, zaehler, False)
        # 39 Berichte liegen in der Fixture, genau einer davon ist ein 8-K.
        pruefe("nur periodische Berichte zaehlen (38 von 39, das 8-K faellt raus)",
               len(berichte) == 38 and zaehler["berichte_periodisch"] == 38,
               (len(berichte), zaehler["berichte_periodisch"]), (38, 38))
        je_firma = pit_reduktion(arbeit, zaehler)

        # Wiederaufnahme (R15c): zweiter Lauf darf nichts verdoppeln.
        vorher = arbeit.execute("SELECT COUNT(*) FROM roh").fetchone()[0]
        lies_rohwerte(panel, arbeit, berichte, defaultdict(int), True)
        nachher = arbeit.execute("SELECT COUNT(*) FROM roh").fetchone()[0]
        pruefe("Wiederaufnahme verdoppelt nichts", vorher == nachher, nachher, vorher)

        pruefe("Zeitpunkt-Regel: der FRUEHESTE Bericht gewinnt (100, nicht 999)",
               _fast(je_firma["4000"][("Revenues", "USD")][("20120331", "1")][1], 100.0),
               je_firma["4000"][("Revenues", "USD")][("20120331", "1")][1], 100.0)
        pruefe("Zeitpunkt-Konflikt wird gezaehlt",
               zaehler["pit_schluessel_wertkonflikt"] == 1,
               zaehler["pit_schluessel_wertkonflikt"], 1)
        pruefe("Mit-Registrant, firmeneigene Kennung und 8-K sind draussen",
               "5000" not in je_firma, sorted(je_firma), "ohne 5000")
        pruefe("verworfen: Mit-Registrant gezaehlt", zaehler["verworfen_coreg"] == 1,
               zaehler["verworfen_coreg"], 1)
        pruefe("verworfen: firmeneigene Taxonomie gezaehlt",
               zaehler["verworfen_firmeneigene_taxonomie"] == 1,
               zaehler["verworfen_firmeneigene_taxonomie"], 1)
        pruefe("verworfen: nicht-periodischer Bericht gezaehlt",
               zaehler["verworfen_nicht_periodisch"] == 1,
               zaehler["verworfen_nicht_periodisch"], 1)

        alle, gewaehlt = firmenreihen(je_firma, UMSATZ_QUELLEN, True, zaehler, "umsatz_")
        pruefe("Firma 1000: zehn direkte Quartalswerte",
               len(gewaehlt["1000"]) == 10, len(gewaehlt["1000"]), 10)
        pruefe("Firma 2000: viertes Quartal 2012 abgeleitet = 100 - (10+20+30) = 40",
               _fast(gewaehlt["2000"]["20121231"][0], 40.0)
               and gewaehlt["2000"]["20121231"][2] == "abgeleitet_q4",
               gewaehlt["2000"].get("20121231"), "(40.0, ..., 'abgeleitet_q4')")
        pruefe("Firma 2000: viertes Quartal 2013 abgeleitet = 125 - (15+25+35) = 50",
               _fast(gewaehlt["2000"]["20131231"][0], 50.0),
               gewaehlt["2000"].get("20131231"), 50.0)
        # Der 10-K zum 31.12.2012 wird in der Fixture 45 Tage spaeter angenommen.
        pruefe("Firma 2000: Zeitstempel des abgeleiteten Q4 ist der spaeteste Eingang",
               gewaehlt["2000"]["20121231"][1] == "2013-02-14 12:00:00.0",
               gewaehlt["2000"]["20121231"][1], "2013-02-14 12:00:00.0")
        pruefe("Firma 6000: Umsatz <= 0 faellt raus, zwei Faelle gezaehlt",
               zaehler["umsatz_umsatz_nicht_positiv"] == 2
               and set(gewaehlt["6000"]) == {"20120630"},
               (zaehler["umsatz_umsatz_nicht_positiv"], sorted(gewaehlt["6000"])),
               (2, ["20120630"]))

        print("\n[3] Wachstum und Beschleunigung")
        g_saetze, a_saetze = wachstum_und_beschleunigung(gewaehlt, zaehler, "umsatz_")
        g_map = dict(((s["cik"], s["ddate"]), s["g"]) for s in g_saetze)
        a_map = dict(((s["cik"], s["ddate"]), s["a"]) for s in a_saetze)
        pruefe("g(1000, 20130331) = 20/110 = 0,181818...",
               _fast(g_map[("1000", "20130331")], 20.0 / 110.0),
               g_map.get(("1000", "20130331")), 20.0 / 110.0)
        pruefe("g(1000, 20130630) = 33/126,5 = 0,260870...",
               _fast(g_map[("1000", "20130630")], 33.0 / 126.5),
               g_map.get(("1000", "20130630")), 33.0 / 126.5)
        pruefe("a(1000, 20130630) = 33/126,5 - 20/110 = 0,079051...",
               _fast(a_map[("1000", "20130630")], 33.0 / 126.5 - 20.0 / 110.0),
               a_map.get(("1000", "20130630")), 33.0 / 126.5 - 20.0 / 110.0)
        pruefe("a(1000, 20131231) = 39/149,5 - 48/144 = -0,072464...",
               _fast(a_map[("1000", "20131231")], 39.0 / 149.5 - 48.0 / 144.0),
               a_map.get(("1000", "20131231")), 39.0 / 149.5 - 48.0 / 144.0)
        pruefe("g(2000, 20131231) aus zwei abgeleiteten Q4 = 10/45 = 0,222222...",
               _fast(g_map[("2000", "20131231")], 10.0 / 45.0),
               g_map.get(("2000", "20131231")), 10.0 / 45.0)
        pruefe("Deckel: kein g liegt ausserhalb von [-2, +2]",
               all(-G_DECKEL <= s["g"] <= G_DECKEL for s in g_saetze))
        pruefe("Jahrespaar ohne volles Kalenderjahr wird GEZAEHLT (371 Tage)",
               zaehler["umsatz_jahrespaar_abstand_abweichend"] == 1
               and ("8000", "20131005") in g_map,
               zaehler["umsatz_jahrespaar_abstand_abweichend"], 1)
        wandernd = set(c for c, w in fye.items() if len(w) > 1)
        pruefe("wanderndes Geschaeftsjahresende findet genau die Wochen-Rechnerin",
               wandernd == {"8000"}, sorted(wandernd), ["8000"])

        print("\n[4] Pruefschritt 1 — Naht-Invariante")
        pruefe("Firma 3000: Quellenwechsel erzeugt VIER Naht-Faelle",
               zaehler["umsatz_quellen_naht"] == 4,
               zaehler["umsatz_quellen_naht"], 4)
        pruefe("Firma 3000 hat kein einziges Wachstum ueber die Naht",
               not any(s["cik"] == "3000" for s in g_saetze))
        naht = pruefe_naht_invariante(g_saetze, a_saetze)
        pruefe("Naht-Invariante ist null (gueltige Form geht DURCH)",
               naht["gesamt"] == 0 and naht["bestanden"], naht["gesamt"], 0)
        gemischt = [{"cik": "X", "ddate": "20130331", "g": 1.0,
                     "basis": ("Revenues", "USD"),
                     "basis_partner": ("SalesRevenueNet", "USD")}]
        gegenprobe = pruefe_naht_invariante(gemischt, [])
        pruefe("Naht-Invariante schlaegt bei gemischter Basis AN (kaputte Form faellt auf)",
               gegenprobe["gesamt"] == 1 and not gegenprobe["bestanden"],
               gegenprobe["gesamt"], 1)

        print("\n[5] Pruefschritt 2 — Belegungs-Glaette")
        jahre = dict((j, set("ABCD")) for j in range(2012, 2017))
        ruhig = dict((cik, {"2012" + str(i): (1.0, str(j) + "-06-01 12:00:00.0",
                                              "direkt", ("Revenues", "USD"))
                            for i, j in enumerate(range(2012, 2017))})
                     for cik in ("A", "B"))
        gl = pruefe_glaette(ruhig, jahre, 2012, 2016)
        pruefe("Glaette: gleichmaessige Belegung geht DURCH",
               gl["bestanden"] and _fast(gl["groesster_sprung"], 0.0),
               gl["groesster_sprung"], 0.0)
        holprig = {"A": {"a": (1.0, "2012-06-01 12:00:00.0", "direkt", ("R", "USD")),
                         "b": (1.0, "2013-06-01 12:00:00.0", "direkt", ("R", "USD")),
                         "c": (1.0, "2015-06-01 12:00:00.0", "direkt", ("R", "USD")),
                         "d": (1.0, "2016-06-01 12:00:00.0", "direkt", ("R", "USD"))},
                    "B": {"a": (1.0, "2012-06-01 12:00:00.0", "direkt", ("R", "USD")),
                          "b": (1.0, "2013-06-01 12:00:00.0", "direkt", ("R", "USD")),
                          "c": (1.0, "2015-06-01 12:00:00.0", "direkt", ("R", "USD")),
                          "d": (1.0, "2016-06-01 12:00:00.0", "direkt", ("R", "USD"))}}
        gl2 = pruefe_glaette(holprig, jahre, 2012, 2016)
        pruefe("Glaette: Loch in 2014 faellt AUF (50 Punkte Sprung)",
               not gl2["bestanden"] and _fast(gl2["groesster_sprung"], 50.0),
               gl2["groesster_sprung"], 50.0)

        print("\n[6] Pruefschritt 3 — Ueberlappung der Quellen")
        ue = pruefe_ueberlappung(alle)
        pruefe("Ueberlappung: zwei Firmen-Quartale mit zwei Quellen",
               ue["firmenquartale_mit_mehreren_quellen"] == 2,
               ue["firmenquartale_mit_mehreren_quellen"], 2)
        pruefe("Ueberlappung: genau eines davon ueber 5 Punkten "
               "(|0,4 - 0,181818| = 0,218...)",
               ue["davon_abstand_ueber_schwelle"] == 1,
               ue["davon_abstand_ueber_schwelle"], 1)
        pruefe("Ueberlappung: Anteil 50 % > 10 % -> Folgeregel greift",
               ue["regel_greift"] and _fast(ue["anteil"], 0.5), ue["anteil"], 0.5)
        einig = pruefe_ueberlappung(
            {"Z": {(0, "Revenues", "USD"): {"20120331": (100.0, "a", "direkt"),
                                            "20130331": (120.0, "b", "direkt")},
                   (2, "SalesRevenueNet", "USD"): {"20120331": (100.0, "a", "direkt"),
                                                   "20130331": (121.0, "b", "direkt")}}})
        pruefe("Ueberlappung: einige Quellen gehen DURCH (kein Fehlalarm)",
               einig["bestanden"] and not einig["regel_greift"],
               einig["anteil"], 0.0)

        print("\n[7] Schwelle und Signal-Bedingungen")
        kuenstlich = []
        for q in range(2010 * 4, 2010 * 4 + 8):
            jahr, quartal = q // 4, q % 4
            ddate = "%04d%02d31" % (jahr, quartal * 3 + 1)
            ddate = ddate[:6] + "28"
            for i in range(1, 251):
                kuenstlich.append({"cik": "F%03d" % i, "ddate": ddate, "a": i / 1000.0,
                                   "g": 1.0, "basis": ("Revenues", "USD"),
                                   "accepted": "%04d-01-01 00:00:00.0" % jahr,
                                   "ord": 0})
        alt_min = TRAILING_MIN_N
        grenzen = schwellen(kuenstlich, 90)
        ziel = 2010 * 4 + 6
        pruefe("Trailing-P90 ueber 1000 Werte = 225. Wert = 0,225",
               _fast(grenzen[ziel][0], 0.225), grenzen.get(ziel), 0.225)
        pruefe("Trailing-Pool zaehlt genau vier Quartale (1000 Werte)",
               grenzen[ziel][1] == 1000, grenzen[ziel][1], 1000)
        pruefe("zu duennes Trailing-Fenster gibt KEINE Schwelle (R5)",
               grenzen[2010 * 4 + 1][0] is None, grenzen[2010 * 4 + 1], None)

        TRAILING_MIN_N = 1
        try:
            fest = [{"cik": "S", "ddate": "20120331", "a": 0.0, "g": 1.0,
                     "basis": ("Revenues", "USD"), "ord": ordinal("20120331"),
                     "accepted": "2012-05-01 00:00:00.0"}]
            faelle = {
                "feuert": (0.9, 0.5, 1.0, True),
                "erste Beschleunigung negativ": (0.9, -0.5, 1.0, False),
                "zweite Beschleunigung negativ": (-0.9, 0.5, 1.0, False),
                "unter der Schwelle": (0.001, 0.5, 1.0, False),
                "Wachstum nicht positiv": (0.9, 0.5, -1.0, False),
            }
            for bez, (a_jetzt, a_vor, g_jetzt, soll) in faelle.items():
                proben = list(fest)
                proben.append({"cik": "S", "ddate": "20120630", "a": a_vor, "g": 1.0,
                               "basis": ("Revenues", "USD"), "ord": ordinal("20120630"),
                               "accepted": "2012-08-01 00:00:00.0"})
                proben.append({"cik": "S", "ddate": "20120930", "a": a_jetzt,
                               "g": g_jetzt, "basis": ("Revenues", "USD"),
                               "ord": ordinal("20120930"),
                               "accepted": "2012-11-01 00:00:00.0"})
                # Querschnitt fuer die Schwelle: 200 fremde Werte bei 0,1.
                for i in range(200):
                    proben.append({"cik": "N%03d" % i, "ddate": "20111231", "a": 0.1,
                                   "g": 1.0, "basis": ("Revenues", "USD"),
                                   "ord": ordinal("20111231"),
                                   "accepted": "2012-02-01 00:00:00.0"})
                eigene = defaultdict(int)
                feuerungen, auswertbar, _ = signale(proben, 90, eigene, "t_")
                ist = any(f["cik"] == "S" and f["ddate"] == "20120930"
                          for f in feuerungen)
                pruefe("Signal-Bedingung: " + bez, ist == soll, ist, soll)
        finally:
            TRAILING_MIN_N = alt_min

        print("\n[8] Fallzahl — reifes Erst-Ereignis")
        basis = ("Revenues", "USD")
        reihe = dict((d, (1.0, "2013-01-01 00:00:00.0", "direkt", basis))
                     for d in ("20120331", "20120630", "20120930", "20121231",
                               "20130331", "20130630", "20130930", "20131231"))
        f_frueh = {"cik": "R", "ddate": "20120630", "basis": basis,
                   "accepted": "2012-08-01 00:00:00.0"}
        f_spaet = {"cik": "R", "ddate": "20130331", "basis": basis,
                   "accepted": "2013-05-01 00:00:00.0"}
        reif, unreif = erst_ereignisse([f_spaet, f_frueh], {"R": reihe})
        pruefe("nur das FRUEHESTE Ereignis der Firma zaehlt (R3)",
               len(reif) + len(unreif) == 1 and (reif + unreif)[0]["ddate"] == "20120630",
               (reif + unreif)[0]["ddate"], "20120630")
        pruefe("sechs Folgequartale -> reif", len(reif) == 1 and not unreif,
               (len(reif), len(unreif)), (1, 0))
        knapp = dict((d, reihe[d]) for d in ("20120331", "20120630", "20120930",
                                             "20121231", "20130331"))
        reif2, unreif2 = erst_ereignisse([f_frueh], {"R": knapp})
        pruefe("drei Folgequartale -> UNREIF (Existenz, keine Ergebniswerte)",
               not reif2 and len(unreif2) == 1, (len(reif2), len(unreif2)), (0, 1))
        andere = dict(reihe)
        andere["20130331"] = (1.0, "2013-05-01 00:00:00.0", "direkt",
                              ("SalesRevenueNet", "USD"))
        reif3, unreif3 = erst_ereignisse([f_frueh], {"R": andere})
        pruefe("Folgequartal anderer Quelle zaehlt fuer die Reife NICHT mit",
               len(reif3) == 1 and reif3[0]["folgequartale"] == 5,
               reif3[0]["folgequartale"] if reif3 else None, 5)

        panel.close()
        arbeit.close()
    finally:
        shutil.rmtree(verzeichnis, ignore_errors=True)

    print("")
    if FEHLER:
        print("SELBSTTEST ROT — " + str(len(FEHLER)) + " Pruefung(en) gescheitert:")
        for f in FEHLER:
            print("  - " + f)
        return 1
    print("SELBSTTEST GRUEN — alle Pruefungen bestanden.")
    return 0


# =============================================================================
# Einstieg
# =============================================================================

def haupt(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-root")
    ap.add_argument("--selbsttest", action="store_true")
    ap.add_argument("--bericht", action="store_true")
    ap.add_argument("--fortsetzen", action="store_true",
                    help="nach Absturz: erledigte Haeppchen ueberspringen (R15c)")
    ap.add_argument("--arbeit", help="Pfad der Zwischenstands-Datei")
    ap.add_argument("--ziel", default=os.path.join(
        "reports", "studie", "E2-basisraten-2026-08-19.md"))
    args = ap.parse_args(argv)

    if args.selbsttest:
        code = selbsttest()
        if code or not args.bericht:
            return code
    if not args.bericht:
        ap.error("Nichts zu tun: --selbsttest und/oder --bericht angeben.")

    wurzel = datenwurzel(args.data_root)
    panel_pfad = os.path.join(wurzel, "panel", FENSTER_DATEI)
    arbeit_pfad = args.arbeit or os.path.join(wurzel, "arbeit",
                                              "E2-zwischenstand.sqlite")
    panel = oeffne_nur_lesend(panel_pfad)
    arbeit = oeffne_zwischenstand(arbeit_pfad, not args.fortsetzen)
    try:
        daten = auswertung(panel, arbeit, args.fortsetzen)
    finally:
        panel.close()
        arbeit.close()
    daten["fragen"] = folgefragen(daten)
    json_pfad = os.path.splitext(args.ziel)[0] + ".json"
    schreibe_report(daten, args.ziel, json_pfad)
    print("Report: " + args.ziel + " (" + str(os.path.getsize(args.ziel)) + " Bytes)")
    print("JSON:   " + json_pfad + " (" + str(os.path.getsize(json_pfad)) + " Bytes)")
    for name in ("S-U", "S-G", "S-UG"):
        s = daten["signale"][name]
        print(name + ": Feuerungen " + str(s["feuerungen_band"]) + " / auswertbar "
              + str(s.get("auswertbar_band")) + " = "
              + (("%.3f %%" % (100.0 * s["rate_band"])) if s.get("rate_band") else "—")
              + " | Firmen reif " + str(s["firmen_reif"])
              + " | P " + str(s["p_final"]))
        for eintrag in s["scheitern"]:
            print("   SCHEITERNSKRITERIUM: " + eintrag)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(haupt())
    except BasisratenFehler as fehler:
        print("ABBRUCH: " + str(fehler), file=sys.stderr)
        sys.exit(2)
