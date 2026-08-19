#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E2, Nebenmessung: steht die AKTIENZAHL flaechendeckend in den Daten?

WAS HIER BEANTWORTET WIRD — UND WAS NICHT
-----------------------------------------
R10 der Studien-Verfassung verlangt eine Pflicht-Nebenrechnung "Umsatz je
Aktie": wer seinen Umsatz verdoppelt, dabei aber die Aktienzahl verdreifacht,
ist fuer einen Anleger geschrumpft. Diese Rechnung ist nur praeregistrierbar,
wenn der Nenner ueberhaupt da ist. Gemessen wird deshalb AUSSCHLIESSLICH die
Abdeckung des Nenners:
  1. Welche SEC-Kennungen tragen eine Aktienzahl, und wie haeufig?
  2. Wie gut ist jede belegt — Anteil der Firmen UND Anteil der Firmen-Quartale?
  3. Wie stabil ueber die Kalenderjahre 2012-2016? Wechselt eine Kennung den
     Namen (wie es der Umsatz zwischen den Fenstern tut)?
  4. Wie viele der Firmen mit reifem Erst-Ereignis aus E2 tragen eine brauchbare
     Aktienzahl-Reihe?
  5. Wie stark aendert sich die Aktienzahl ueberhaupt? Bewegt sie sich nicht,
     ist die Je-Aktie-Rechnung teuer und wirkungslos.
  6. Verwaesserte oder unverwaesserte Zahl — welche ist besser belegt?

KEIN Signal, KEIN Ergebnis, KEINE Bewertung. Es wird kein Umsatz je Aktie
gerechnet, nur gezaehlt, wo er rechenbar WAERE.

DIE FENSTER-MAUER LEBT IM CODE, NICHT IN EINER ZUSAGE (R2)
----------------------------------------------------------
Geoeffnet wird GENAU EINE Datei: das Entdeckungsfenster, schreibgeschuetzt.
Prueffenster und Endtest sind tabu. Geprueft wird der AUFGELOESTE Pfad
(`realpath`, folgt Symlinks und NTFS-Junctions), nicht nur der geschriebene —
eine Verzeichnis-Verknuepfung mit harmlosem Namen hat in diesem Projekt schon
einmal woanders hingezeigt. Ein Treffer ist ein ABBRUCH, kein Filter: ein
Filter waere ein Versprechen, ein Abbruch ist eine Eigenschaft des Programms.

WAS "AKTIENZAHL" HEISST — DIE AUSWAHL STEHT NAMENTLICH IM CODE
--------------------------------------------------------------
In der SEC-Taxonomie tragen fast 80.000 verschiedene Kennungen die Einheit
"shares". Die allermeisten sind keine Aktienzahl im Sinne von R10 (genehmigtes
Kapital, Vorzugsaktien, Optionsprogramme, eigene Aktien). Deshalb zwei
getrennte Schritte, beide im Report sichtbar:
  Stufe 1 ENTDECKT datengetrieben, welche Kennungen mit Einheit "shares"
          vorkommen und wie oft — ohne Namensliste, damit nichts uebersehen wird.
  Stufe 2 WAEHLT daraus namentlich aus, mit Begruendung je aufgenommener UND je
          verworfener Kennung. Wer die Auswahl anders trifft, sieht in Stufe 1,
          was er anders haette waehlen koennen.

RECHEN-EHRLICHKEIT (R5)
-----------------------
Fehlt etwas, heisst das Ergebnis NICHT BERECHENBAR und wird MIT GRUND GEZAEHLT
— nie geschaetzt, nie auf null gesetzt, nie stillschweigend weggelassen.

ZEITPUNKT-EHRLICHKEIT (R6)
--------------------------
Fuer jede Groesse (cik, tag, ddate, qtrs) gilt der Wert aus dem FRUEHESTEN
`accepted`-Bericht. Spaetere Fassungen werden nur gezaehlt. Dieselbe Regel wie
in E2 — sonst waeren die Zahlen nicht vergleichbar.

WERKZEUGE (R14c)
----------------
Python-Standardbibliothek + sqlite3. numpy waere erlaubt, wird nicht gebraucht:
das Perzentil laeuft ueber den naechsten Rang und ist von Hand nachrechenbar.

Aufruf:
  python scripts/studie-panel-aktienzahl.py --selbsttest
  python scripts/studie-panel-aktienzahl.py --gegenprobe
  python scripts/studie-panel-aktienzahl.py --bericht
"""

import argparse
import importlib.util
import json
import os
import re
import sqlite3
import sys
from collections import defaultdict
from datetime import date, datetime, timezone

DATENWURZEL_ENV = "EARLY_DETECTION_DATA_ROOT"
PANEL_ORDNER = "panel"
PANEL_DATEI = "panel-entdeckung.sqlite"

# Alles, was nach dem versiegelten Endtest oder nach Schluesselmaterial aussieht.
VERBOTEN_RE = re.compile(r"endtest|\.enc$|schl(?:ue|ü)ssel|\.key$", re.IGNORECASE)
# Standard-Taxonomie ("us-gaap/2016", "dei/2014") vs. firmeneigene Erweiterung
# (dort steht die Einreichungsnummer der Firma). Die Trennlinie zwischen
# "vergleichbare Kennzahl" und "Hausnummer einer einzelnen Firma".
STANDARD_VERSION_RE = re.compile(r"^[a-z][a-z0-9-]*/\d{4}$")
PERIODISCHE_FORMEN = ("10-K", "10-Q", "20-F", "40-F")
EINHEIT = "shares"

# Die Auswahl. Familie "sofort" = Stichtagsbestand (qtrs=0, eine Zahl zum
# Bilanzstichtag); Familie "zeitraum" = Periodendurchschnitt (qtrs=1 Quartal,
# qtrs=4 Geschaeftsjahr). Der Unterschied ist nicht kosmetisch: der Umsatz ist
# eine Zeitraumgroesse, also gehoert rechnerisch ein Zeitraum-Nenner darunter —
# aber ein Periodendurchschnitt fuer das vierte Quartal laesst sich NICHT wie
# der Umsatz aus dem Jahr minus drei Quartalen ableiten (ein Durchschnitt ist
# nicht additiv). Genau dieser Unterschied wird gemessen, nicht behauptet.
KANDIDATEN = (
    ("CommonStockSharesOutstanding", "sofort",
     "Stammaktien im Umlauf zum Bilanzstichtag"),
    ("CommonStockSharesIssued", "sofort",
     "ausgegebene Stammaktien zum Bilanzstichtag (inkl. zurueckgekaufter)"),
    ("EntityCommonStockSharesOutstanding", "sofort",
     "Deckblatt-Angabe der Einreichung (dei), Stichtag nahe am Einreichungstag"),
    ("WeightedAverageNumberOfSharesOutstandingBasic", "zeitraum",
     "unverwaesserter Periodendurchschnitt (Nenner des einfachen Ergebnisses je Aktie)"),
    ("WeightedAverageNumberOfDilutedSharesOutstanding", "zeitraum",
     "verwaesserter Periodendurchschnitt (inkl. Optionen, Wandelanleihen, Warrants)"),
    ("WeightedAverageNumberOfShareOutstandingBasicAndDiluted", "zeitraum",
     "Periodendurchschnitt, wenn unverwaessert und verwaessert identisch sind"),
)
KANDIDAT_TAGS = tuple(t for t, _, _ in KANDIDATEN)
FAMILIE = dict((t, f) for t, f, _ in KANDIDATEN)
# Der Quartals-Nenner je Familie. "sofort" traegt nur qtrs=0, "zeitraum" nutzt
# qtrs=1 (ein Quartal). qtrs=4 wird getrennt gezaehlt, weil daran haengt, ob
# eine Firma ueberhaupt Quartalswerte meldet oder nur Jahreswerte.
QTRS_QUARTAL = {"sofort": "0", "zeitraum": "1"}
QTRS_JAHR = {"sofort": "0", "zeitraum": "4"}

# Geprueft und VERWORFEN. Steht im Report, damit "nicht dabei" nicht wie
# "uebersehen" aussieht (R5). Die Muster sind Praefixe, keine Regexe.
VERWORFEN = (
    ("CommonStockSharesAuthorized",
     "genehmigtes Kapital — Obergrenze aus der Satzung, keine existierende Aktie"),
    ("PreferredStockShares",
     "Vorzugsaktien — anderer Aktientyp, nicht der Nenner von 'Umsatz je Aktie'"),
    ("TreasuryStockShares",
     "eigene Aktien — Abzugsposten, keine umlaufende Aktie"),
    ("AntidilutiveSecuritiesExcludedFromComputationOfEarningsPerShareAmount",
     "ausdruecklich NICHT eingerechnete Rechte — das Gegenteil einer Aktienzahl"),
    ("ShareBasedCompensationArrangement",
     "Optionsprogramme — Bestand an Rechten, keine Aktien"),
    ("StockIssuedDuringPeriodShares",
     "Bewegung innerhalb der Periode, kein Bestand"),
    ("IncrementalCommonSharesAttributable",
     "Verwaesserungs-Zuschlag — Bestandteil der verwaesserten Zahl, nicht sie selbst"),
    ("WeightedAverageNumberDilutedSharesOutstandingAdjustment",
     "Ueberleitungsposten von unverwaessert nach verwaessert, kein Bestand"),
)

# Die erste Fassung dieser Messung lief am selben Tag gegen eine ANDERE
# E2-Kohorte. Sie steht hier, damit der Wechsel im Report benannt werden kann
# statt still ersetzt zu werden — die 487 sind nicht "512 minus 25", sondern
# eine andere Grundgesamtheit.
VORFASSUNG = {
    "kohorte": 487,
    "ereignisfenster_sofort": 407,
    "ereignisfenster_sofort_prozent": 83.6,
    "ereignisfenster_zeitraum_prozent": 11.3,
    "grund": "E2 waehlte die Umsatzquelle je Firmen-Quartal; seit dem "
             "Neulauf vom 19.08. steht sie je FIRMA fest (laengste Serie zum "
             "Signalzeitpunkt, Punkt-in-der-Zeit-Fassung). Damit verschwinden "
             "die Quellen-Nahtstellen (2.663 -> 0) und die Fallzahl waechst "
             "von 487 auf 512 Firmen.",
}

BAND_JAHRE = (2012, 2016)
# Abstandsfenster fuer "vier Quartale spaeter", in Kalendertagen. Uebernommen
# aus E2 (JAHR_FENSTER), damit beide Etappen dasselbe Jahr meinen.
JAHR_FENSTER = (330, 380)
VERWAESSERUNG_SCHWELLEN = (0.05, 0.20, 0.50)
# Verhaeltnisse, die wie ein Aktiensplit aussehen. Ein Split verdoppelt die
# Aktienzahl OHNE Verwaesserung — die Messung kann beides nicht unterscheiden,
# also wird die Ueberschneidung beziffert statt behauptet, sie sei klein.
SPLIT_VERHAELTNISSE = (2.0, 3.0, 1.5, 4.0, 5.0, 10.0, 0.5, 1.0 / 3.0, 0.2, 0.1)
SPLIT_TOLERANZ = 0.01
# So viele der haeufigsten "shares"-Kennungen bekommen eine Zeile im Report.
# Deckel, weil R14a den Report unter 200 KB haelt.
TOP_KENNUNGEN = 25
BLOCK = 500000

# Plausibilitaetsanker aus den Vor-Etappen. Weichen die eigenen Zahlen ab, ist
# das ein BEFUND und wird gemeldet — nicht angepasst.
#
# WARUM DIE SOLLWERTE GELESEN UND NICHT EINGETIPPT WERDEN: sie standen hier
# zuerst als feste Zahlen (487 reife Firmen). Wenige Stunden spaeter stellte E2
# seine Quellenwahl um — von "je Firmen-Quartal" auf "je Firma" — und die
# Kohorte wurde 512. Der feste Anker haette den Lauf dann zwar korrekt
# angehalten, aber aus dem falschen Grund: nicht weil die Rekonstruktion kaputt
# war, sondern weil die eingetippte Zahl veraltet war. Ein Anker, der die
# Wahrheit selbst mitfuehrt, kann nicht veralten — er zeigt weiterhin auf den
# veroeffentlichten E2-Report und schlaegt nur an, wenn die Rekonstruktion
# WIRKLICH von ihm abweicht.
ANKER_E1_FIRMEN_FELD = ("fiskalkalender", "firmen_mit_geschaeftsjahresende")
E2_REPORT = os.path.join("reports", "studie", "E2-basisraten-2026-08-19.json")

GELESENE_PFADE = []


class AktienzahlFehler(Exception):
    """Ein Befund, der den Lauf anhaelt — nie ein stiller Rueckfall."""


# -- Pfade und die Fenster-Mauer ---------------------------------------------

def kurzpfad(voll):
    """Elternverzeichnis + Dateiname. Genug zum Unterscheiden, ohne die
    Benutzerkennung des Rechners in den Report zu schreiben (R12a)."""
    return (os.path.basename(os.path.dirname(voll)) + "/"
            + os.path.basename(voll))


def datenwurzel(vorgabe=None):
    wert = vorgabe or os.environ.get(DATENWURZEL_ENV)
    if not wert:
        raise AktienzahlFehler(
            "Speicherort unbekannt: " + DATENWURZEL_ENV + " ist nicht gesetzt "
            "(R12a verbietet einen fest verdrahteten Pfad)")
    return wert


def pruefe_mauer(pfad):
    """R2: Darf dieser Pfad ueberhaupt angefasst werden? Sonst Abbruch.

    Geprueft wird der GANZE Pfad in ZWEI Formen. Der aufgeloeste (`realpath`)
    faengt die Umleitung ueber einen Symlink oder eine NTFS-Junction; der
    geschriebene faengt den Fall, dass das Ziel (noch) nicht existiert und
    `realpath` deshalb nichts aufloest. Mit `abspath` allein pruefte die Mauer
    nur die Zeichen des Pfades, waehrend das Betriebssystem eine ganz andere
    Datei oeffnet."""
    geschrieben = os.path.abspath(pfad)
    aufgeloest = os.path.realpath(geschrieben)
    for form in (geschrieben, aufgeloest):
        if VERBOTEN_RE.search(form.replace(os.sep, "/")):
            raise AktienzahlFehler(
                "R2-ABBRUCH: '" + pfad + "' fuehrt (aufgeloest: '" + aufgeloest
                + "') zum versiegelten Endtest oder zu Schluesselmaterial. Dieses "
                "Skript oeffnet das Endtest-Fenster nie — wer vorher hineinsieht, "
                "macht das Studienergebnis wertlos.")
    return aufgeloest


def oeffne_nur_lesend(pfad):
    """R2: Erst die Mauer, dann die Datei — und nur schreibgeschuetzt."""
    voll = pruefe_mauer(pfad)
    if not os.path.isfile(voll):
        raise AktienzahlFehler("Panel-Datei nicht gefunden: " + kurzpfad(voll))
    if kurzpfad(voll) not in GELESENE_PFADE:
        GELESENE_PFADE.append(kurzpfad(voll))
    uri = "file:" + voll.replace("\\", "/") + "?mode=ro"
    return sqlite3.connect(uri, uri=True)


# -- Kleine Rechenhelfer ------------------------------------------------------

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


def jahr_aus_ddate(ddate):
    text = (ddate or "").strip()
    if len(text) != 8 or not text.isdigit():
        return None
    jahr = int(text[:4])
    return jahr if 1900 <= jahr <= 2100 else None


def formstamm(form):
    """'10-K/A' -> '10-K'. Korrekturfassungen betreffen denselben Zeitraum."""
    return (form or "").split("/")[0].strip().upper()


def perzentil(sortierte_werte, anteil):
    """Naechster Rang, ohne Interpolation — von Hand nachrechenbar.

    Bei 10 sortierten Werten liegt der Median (0.5) auf Rang ceil(0.5*10)=5,
    also dem 5. Wert. Keine Zwischenwerte, die es in den Daten nicht gibt."""
    if not sortierte_werte:
        return None
    rang = int(-(-anteil * len(sortierte_werte) // 1))
    return sortierte_werte[max(0, min(rang - 1, len(sortierte_werte) - 1))]


def anteil(zaehler_wert, nenner_wert):
    """Anteil in Prozent. Nenner null -> None, nie 0.0 (R5)."""
    if not nenner_wert:
        return None
    return 100.0 * zaehler_wert / nenner_wert


def proz_aus(zaehler_wert, nenner_wert, stellen=1):
    """Anteil rechnen und rendern in EINEM Schritt.

    Warum zusammen: getrennt verleitet die Kombination `proz(anteil(a, b) or
    0.0)` dazu, ein NICHT BERECHENBAR in eine gemessene Null zu verwandeln —
    genau der Ausgang, den R5 als schlimmsten benennt. Wer keinen Zwischenwert
    in die Hand bekommt, kann ihn auch nicht mit `or` ueberschreiben."""
    return proz(anteil(zaehler_wert, nenner_wert), stellen)


def zeitstempel():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# -- Stufe 0: die Berichtstabelle ---------------------------------------------

def lies_berichte(con, zaehler):
    """adsh -> (cik, accepted). Nur periodische Formen, nur mit Kennung.

    Dieselben Filter wie in E2 — sonst waeren die Firmenzahlen der beiden
    Etappen nicht vergleichbar und der Plausibilitaetsanker waere wertlos."""
    berichte = {}
    firmen = set()
    gesehen = set()
    firmen_je_jahr = defaultdict(set)
    for adsh, cik, form, accepted, period in con.execute(
            "SELECT adsh, cik, form, accepted, period FROM bericht"):
        zaehler["berichte_gesamt"] += 1
        if adsh in gesehen:
            # Waere `adsh` nicht eindeutig, zaehlte spaeter derselbe Wert
            # mehrfach — eine falsche Zahl ohne Fehlermeldung ist der
            # schlimmste Ausgang, also wird die Voraussetzung geprueft.
            raise AktienzahlFehler(
                "Berichtsnummer '" + str(adsh) + "' kommt zweimal vor. Alle "
                "Belegungszahlen waeren still falsch.")
        gesehen.add(adsh)
        if formstamm(form) not in PERIODISCHE_FORMEN:
            zaehler["berichte_nicht_periodisch"] += 1
            continue
        zaehler["berichte_periodisch"] += 1
        if not cik or not str(cik).strip():
            zaehler["bericht_ohne_cik"] += 1
            continue
        if not accepted or not str(accepted).strip():
            zaehler["bericht_ohne_accepted"] += 1
            continue
        cik = sys.intern(str(cik).strip())
        berichte[adsh] = (cik, accepted)
        firmen.add(cik)
        # Die Bezugsgroesse fuer Frage 3. Ohne sie sieht der Rand des Fensters
        # (ein Bilanzstichtag im Q4 2016 wird erst 2017 eingereicht und faellt
        # damit heraus) wie ein Einbruch der Aktienzahl-Abdeckung aus.
        jahr = jahr_aus_ddate(period)
        if jahr is None:
            zaehler["bericht_ohne_periode"] += 1
        else:
            firmen_je_jahr[jahr].add(cik)
    return berichte, firmen, dict((j, len(s)) for j, s in firmen_je_jahr.items())


# -- Stufe 1: Entdeckung — welche Kennungen tragen ueberhaupt Aktienzahlen? ----

def entdecke_kennungen(con, zaehler):
    """Ein sequenzieller Durchlauf ueber alle Zeilen mit Einheit 'shares'.

    Kein Namensraten: gefragt wird die EINHEIT, nicht der Name. Was in
    Stueck gemessen wird, ist ein Kandidat; welche davon eine Aktienzahl im
    Sinne von R10 sind, entscheidet Stufe 2 namentlich."""
    zeilen_standard = defaultdict(int)
    zeilen_firmeneigen = defaultdict(int)
    cur = con.execute(
        "SELECT tag, version FROM fakt WHERE uom = ?", (EINHEIT,))
    while True:
        block = cur.fetchmany(BLOCK)
        if not block:
            break
        for tag, version in block:
            zaehler["shares_zeilen"] += 1
            if not tag or not str(tag).strip():
                zaehler["shares_zeilen_ohne_kennung"] += 1
                continue
            if STANDARD_VERSION_RE.match((version or "").strip()):
                zeilen_standard[tag] += 1
            else:
                zeilen_firmeneigen[tag] += 1
    zaehler["shares_kennungen_standard"] = len(zeilen_standard)
    zaehler["shares_kennungen_firmeneigen"] = len(zeilen_firmeneigen)
    zaehler["shares_zeilen_standard"] = sum(zeilen_standard.values())
    zaehler["shares_zeilen_firmeneigen"] = sum(zeilen_firmeneigen.values())
    return zeilen_standard, zeilen_firmeneigen


# -- Stufe 2: die Werte der gewaehlten Kennungen ------------------------------

def lies_werte(con, berichte, zaehler):
    """Je (cik, tag, ddate, qtrs) der Wert aus dem FRUEHESTEN Bericht (R6).

    Die Reduktion laeuft waehrend des Lesens, nicht danach: die Faktentabelle
    hat 64 Millionen Zeilen und keinen Index (R14d), und die Zwischenmenge
    aller Fassungen waere unnoetig gross."""
    je_firma = defaultdict(dict)
    # Welche Schluessel schon als widerspruechlich gemeldet wurden. Ohne das
    # zaehlt derselbe Widerspruch bei drei oder mehr Fassungen je nach
    # Zeilenreihenfolge ein- oder zweimal — und die Reihenfolge ist ohne
    # ORDER BY nicht festgelegt (ein Index waere nach R14d zu teuer). Eine
    # Diagnosezahl, die vom Ausfuehrungsplan abhaengt, ist keine Messung.
    konflikt_schluessel = set()
    platzhalter = ",".join("?" * len(KANDIDAT_TAGS))
    cur = con.execute(
        "SELECT adsh, tag, version, coreg, ddate, qtrs, value FROM fakt"
        " WHERE uom = ? AND tag IN (" + platzhalter + ")",
        (EINHEIT,) + KANDIDAT_TAGS)
    while True:
        block = cur.fetchmany(BLOCK)
        if not block:
            break
        for adsh, tag, version, coreg, ddate, qtrs, value in block:
            zaehler["kandidaten_zeilen"] += 1
            if coreg is not None and str(coreg).strip():
                # Ein Mitanmelder (Tochter, Garantiegeber) meldet SEINE Aktien.
                # Wer die mitzaehlt, addiert fremde Aktien zum Nenner.
                zaehler["verworfen_coreg"] += 1
                continue
            if not STANDARD_VERSION_RE.match((version or "").strip()):
                zaehler["verworfen_firmeneigene_taxonomie"] += 1
                continue
            traeger = berichte.get(adsh)
            if traeger is None:
                # Bewusst neutral benannt: der Bericht fehlt in der Map, weil
                # er nicht periodisch ist ODER keine Kennung ODER kein
                # Annahmedatum traegt ODER gar nicht in `bericht` steht. Diese
                # vier Gruende sind in `lies_berichte` einzeln gezaehlt; sie
                # hier alle "nicht periodisch" zu nennen waere eine falsche
                # Grundangabe (R5 verlangt den GRUND, nicht irgendein Etikett).
                zaehler["verworfen_kein_gueltiger_bericht"] += 1
                continue
            if ordinal(ddate) is None:
                zaehler["verworfen_stichtag_unlesbar"] += 1
                continue
            if value is None:
                zaehler["verworfen_wert_leer"] += 1
                continue
            if value <= 0:
                # Eine Aktienzahl von null oder darunter ist als Nenner
                # unbrauchbar. Gezaehlt statt weggeworfen (R5).
                zaehler["verworfen_wert_nicht_positiv"] += 1
                continue
            cik, accepted = traeger
            schluessel = (sys.intern(str(tag)), sys.intern(str(ddate)),
                          sys.intern(str(qtrs)))
            vorhanden = je_firma[cik].get(schluessel)
            if vorhanden is None:
                zaehler["werte_pit"] += 1
                je_firma[cik][schluessel] = (accepted, value)
            else:
                zaehler["werte_spaetere_fassung"] += 1
                if accepted < vorhanden[0]:
                    je_firma[cik][schluessel] = (accepted, value)
                if value != vorhanden[1] and (cik, schluessel) not in konflikt_schluessel:
                    konflikt_schluessel.add((cik, schluessel))
                    zaehler["werte_fassungskonflikt"] += 1
    return je_firma


# -- Stufe 3: Abdeckung je Kennung -------------------------------------------

def abdeckung_je_kennung(je_firma, firmen_gesamt, berichts_firmenquartale):
    """Frage 2 und 3: Firmen, Firmen-Quartale, und die Jahresreihe 2012-2016."""
    ergebnis = {}
    for tag, familie, zweck in KANDIDATEN:
        q_quartal = QTRS_QUARTAL[familie]
        q_jahr = QTRS_JAHR[familie]
        firmen = set()
        firmen_quartalswert = set()
        firmenquartale = set()
        firmen_je_jahr = defaultdict(set)
        werte_quartal = 0
        werte_jahr = 0
        auf_quartalsende = 0
        for cik, werte in je_firma.items():
            for (t, ddate, qtrs), _ in werte.items():
                if t != tag:
                    continue
                firmen.add(cik)
                if qtrs == q_jahr and q_jahr != q_quartal:
                    werte_jahr += 1
                if qtrs != q_quartal:
                    continue
                werte_quartal += 1
                firmen_quartalswert.add(cik)
                # Passt der Stichtag ueberhaupt auf ein Quartalsende? Eine
                # Kennung, die ihren Wert vier Wochen NACH dem Quartalsende
                # misst, ist reichlich vorhanden und trotzdem unbrauchbar,
                # sobald quartalsgenau gerechnet wird. Gemessen, nicht vermutet.
                monat = ddate[4:6] if len(ddate) == 8 and ddate.isdigit() else None
                if monat in ("03", "06", "09", "12"):
                    auf_quartalsende += 1
                q = kalenderquartal(ddate)
                if q is not None:
                    firmenquartale.add((cik, q))
                jahr = jahr_aus_ddate(ddate)
                if jahr is not None:
                    firmen_je_jahr[jahr].add(cik)
        ergebnis[tag] = {
            "familie": familie,
            "zweck": zweck,
            "quartals_qtrs": q_quartal,
            "firmen": len(firmen),
            "firmen_mit_quartalswert": len(firmen_quartalswert),
            "firmen_anteil_prozent": anteil(len(firmen_quartalswert), firmen_gesamt),
            "werte_quartal": werte_quartal,
            "stichtag_auf_quartalsende_prozent": anteil(auf_quartalsende,
                                                        werte_quartal),
            "werte_jahresperiode": werte_jahr if q_jahr != q_quartal else None,
            "firmenquartale": len(firmenquartale),
            "firmenquartale_anteil_prozent": anteil(len(firmenquartale),
                                                    berichts_firmenquartale),
            "firmen_je_jahr": dict((str(j), len(s)) for j, s in sorted(
                firmen_je_jahr.items())
                if BAND_JAHRE[0] <= j <= BAND_JAHRE[1]),
        }
    return ergebnis


def naht_je_familie(je_firma):
    """Frage 3, der harte Teil: wechselt eine Firma die Kennung mitten in der Reihe?

    Genau diese Sorte Bruch ist beim Umsatz dokumentiert (`SalesRevenueNet` ->
    `Revenues` -> `RevenueFromContract...`). Ein Namenswechsel sieht in einer
    Ein-Kennungs-Abfrage wie eine Datenluecke aus. Gemessen wird deshalb je
    Familie: wie viele Firmen benutzen im Fenster MEHR ALS EINE Kennung, und
    wie viele Firmen-Quartale traegt nur eine der Kennungen allein?"""
    ergebnis = {}
    for familie in ("sofort", "zeitraum"):
        tags = [t for t, f, _ in KANDIDATEN if f == familie]
        q_quartal = QTRS_QUARTAL[familie]
        firmen_je_tag = defaultdict(set)
        firmen_tags = defaultdict(set)
        union_fq = set()
        fq_je_tag = defaultdict(set)
        for cik, werte in je_firma.items():
            for (t, ddate, qtrs), _ in werte.items():
                if t not in tags or qtrs != q_quartal:
                    continue
                q = kalenderquartal(ddate)
                if q is None:
                    continue
                firmen_je_tag[t].add(cik)
                firmen_tags[cik].add(t)
                union_fq.add((cik, q))
                fq_je_tag[t].add((cik, q))
        mehrfach = sum(1 for s in firmen_tags.values() if len(s) > 1)
        beste = max((len(s), t) for t, s in fq_je_tag.items()) if fq_je_tag else (0, None)
        ergebnis[familie] = {
            "kennungen": tags,
            "firmen_union": len(firmen_tags),
            "firmen_mit_mehr_als_einer_kennung": mehrfach,
            "firmen_mit_mehr_als_einer_kennung_prozent": anteil(
                mehrfach, len(firmen_tags)),
            "firmenquartale_union": len(union_fq),
            "beste_einzelkennung": beste[1],
            "firmenquartale_beste_einzelkennung": beste[0],
            "zugewinn_durch_union_prozent": anteil(
                len(union_fq) - beste[0], beste[0]) if beste[0] else None,
            "firmenquartale_je_kennung": dict(
                (t, len(fq_je_tag.get(t, ()))) for t in tags),
        }
    return ergebnis


def issued_gegen_outstanding(je_firma):
    """Traegt der Rueckfall von 'im Umlauf' auf 'ausgegeben' wirklich?

    Buchhalterisch gilt: ausgegebene Aktien = umlaufende + zurueckgekaufte
    eigene. Daraus folgt 'ausgegeben >= im Umlauf', und daraus wiederum, dass
    der Rueckfall den Fehler in eine BEKANNTE Richtung schiebt (die
    Je-Aktie-Groesse wird zu klein, also zu vorsichtig).

    Das ist eine Behauptung ueber die Buchhaltung, keine ueber diese Daten —
    also wird sie an diesen Daten nachgezaehlt statt geglaubt. Gemessen wird
    an jedem Stichtag, an dem BEIDE Kennungen vorliegen."""
    paare = gleich = verletzt = 0
    for cik, werte in je_firma.items():
        je_stichtag = defaultdict(dict)
        for (tag, ddate, qtrs), (_, value) in werte.items():
            if qtrs != "0" or tag not in ("CommonStockSharesIssued",
                                          "CommonStockSharesOutstanding"):
                continue
            je_stichtag[ddate][tag] = value
        for ddate, beide in je_stichtag.items():
            if len(beide) != 2:
                continue
            paare += 1
            ausgegeben = beide["CommonStockSharesIssued"]
            umlaufend = beide["CommonStockSharesOutstanding"]
            if ausgegeben < umlaufend:
                verletzt += 1
            elif ausgegeben == umlaufend:
                gleich += 1
    return {
        "stichtage_mit_beiden": paare,
        "regel_haelt": paare - verletzt,
        "regel_haelt_prozent": anteil(paare - verletzt, paare),
        "identisch": gleich,
        "identisch_prozent": anteil(gleich, paare),
        "verletzt": verletzt,
        "verletzt_prozent": anteil(verletzt, paare),
    }


# -- Stufe 4: Verwaesserung ---------------------------------------------------

def verwaesserung(je_firma, tag, zaehler=None):
    """Frage 5: Wie stark bewegt sich die Aktienzahl ueber vier Quartale?

    Verglichen werden Stichtage im Abstand von 330 bis 380 Kalendertagen —
    dasselbe Jahresfenster, das E2 fuer den Vorjahresvergleich benutzt. Je
    Firma wird die GROESSTE Veraenderung genommen (der ungueenstigste Fall,
    nicht der Durchschnitt).

    GRENZE DER MESSUNG (R5): ein Aktiensplit verdoppelt die Aktienzahl OHNE
    jede Verwaesserung. Aus dieser Datenquelle allein ist beides nicht zu
    unterscheiden. Deshalb wird die Zahl der Faelle, deren Verhaeltnis auf ein
    Prozent genau einem gaengigen Splitverhaeltnis entspricht, getrennt
    ausgewiesen — als Untergrenze der Ueberschneidung, nicht als Korrektur."""
    familie = FAMILIE[tag]
    q_quartal = QTRS_QUARTAL[familie]
    if zaehler is not None:
        zaehler["verwaesserung_unter_zwei_werten_" + tag] += 0
    je_firma_max = {}
    split_verdacht = set()
    paare = 0
    paar_betraege = []
    rueckgang = set()
    for cik, werte in je_firma.items():
        reihe = []
        for (t, ddate, qtrs), (_, value) in werte.items():
            if t != tag or qtrs != q_quartal:
                continue
            o = ordinal(ddate)
            if o is not None:
                reihe.append((o, value))
        if len(reihe) < 2:
            # R5: gezaehlt, nicht stillschweigend weggelassen. Sonst ist der
            # Unterschied zwischen "Firma hat sich nicht bewegt" und "Firma
            # hatte nie zwei Messpunkte" aus dem Report nicht mehr ablesbar.
            if zaehler is not None:
                zaehler["verwaesserung_unter_zwei_werten_" + tag] += 1
            continue
        reihe.sort()
        groesste = None
        for i, (o_spaet, v_spaet) in enumerate(reihe):
            for j in range(i):
                o_frueh, v_frueh = reihe[j]
                abstand = o_spaet - o_frueh
                if not (JAHR_FENSTER[0] <= abstand <= JAHR_FENSTER[1]):
                    continue
                if v_frueh <= 0:
                    continue
                paare += 1
                verhaeltnis = v_spaet / v_frueh
                aenderung = verhaeltnis - 1.0
                paar_betraege.append(abs(aenderung))
                if any(abs(verhaeltnis - s) <= SPLIT_TOLERANZ * s
                       for s in SPLIT_VERHAELTNISSE if s != 1.0):
                    split_verdacht.add(cik)
                if groesste is None or abs(aenderung) > abs(groesste):
                    groesste = aenderung
        if groesste is not None:
            je_firma_max[cik] = groesste
            if groesste < 0:
                rueckgang.add(cik)
    betraege = sorted(abs(v) for v in je_firma_max.values())
    paar_sortiert = sorted(paar_betraege)
    ueber = {}
    for schwelle in VERWAESSERUNG_SCHWELLEN:
        treffer = sum(1 for v in je_firma_max.values() if abs(v) > schwelle)
        # Zweite Lesart, bewusst danebengestellt: der Firmenwert sagt "mindestens
        # einmal im Fenster", der Paarwert sagt "in einem beliebigen Firmenjahr".
        # Wer nur den ersten berichtet, laesst acht Jahre wie ein Jahr aussehen.
        paar_treffer = sum(1 for v in paar_betraege if v > schwelle)
        ueber["ueber_%d_prozent" % int(round(schwelle * 100))] = {
            "firmen": treffer,
            "anteil_prozent": anteil(treffer, len(je_firma_max)),
            "jahrespaare": paar_treffer,
            "jahrespaare_anteil_prozent": anteil(paar_treffer, len(paar_betraege)),
        }
    return {
        "kennung": tag,
        "firmen_messbar": len(je_firma_max),
        "jahrespaare": paare,
        "median_betrag_prozent": (100.0 * perzentil(betraege, 0.5)
                                  if betraege else None),
        "median_jahrespaar_prozent": (100.0 * perzentil(paar_sortiert, 0.5)
                                      if paar_sortiert else None),
        "p90_jahrespaar_prozent": (100.0 * perzentil(paar_sortiert, 0.9)
                                   if paar_sortiert else None),
        "p90_betrag_prozent": (100.0 * perzentil(betraege, 0.9)
                               if betraege else None),
        "firmen_mit_rueckgang": len(rueckgang),
        "firmen_mit_splitverdacht": len(split_verdacht),
        "firmen_mit_splitverdacht_prozent": anteil(len(split_verdacht),
                                                   len(je_firma_max)),
        "schwellen": ueber,
    }


# -- Stufe 5: die 487 Firmen mit reifem Erst-Ereignis --------------------------

def lies_e2_sollwerte(pfad):
    """Die veroeffentlichten E2-Zahlen aus ihrem eigenen Report holen.

    Fehlt der Report oder eine Zahl darin, ist das ein Abbruch und kein
    Rueckfall auf einen Vorgabewert: ein Anker, der sich selbst erfinden kann,
    ankert nichts (R5)."""
    pruefe_mauer(pfad)
    if not os.path.isfile(pfad):
        raise AktienzahlFehler(
            "E2-Report nicht gefunden: " + kurzpfad(pfad) + ". Ohne ihn gibt es "
            "keinen Sollwert — der Lauf haelt an, statt einen zu erfinden.")
    with open(pfad, encoding="utf-8") as fh:
        daten = json.load(fh)
    try:
        su = daten["signale"]["S-U"]
        kalibrierung = tuple((s["p"], s["feuerungen_band"], s["firmen_reif"])
                             for s in su["kalibrierung"])
        reif = su["firmen_reif"]
        firmen_e1 = daten[ANKER_E1_FIRMEN_FELD[0]][ANKER_E1_FIRMEN_FELD[1]]
    except (KeyError, TypeError) as fehler:
        raise AktienzahlFehler(
            "E2-Report hat nicht die erwartete Form (" + str(fehler) + "). "
            "Der Anker kann nicht gesetzt werden.")
    return {"reif": reif, "kalibrierung": kalibrierung, "firmen_e1": firmen_e1,
            "quelle": kurzpfad(os.path.abspath(pfad))}


def anker_stimmt(ist, soll):
    """Reiner Vergleich, damit er ohne den teuren E2-Lauf pruefbar ist.

    Bewusst exakt: eine Abweichung von einer einzigen Firma ist eine andere
    Grundgesamtheit und darf nicht durchrutschen."""
    return tuple(ist) == tuple(soll)


def lade_e2_modul(pfad):
    """Das E2-Skript als Bibliothek. Der Bindestrich im Namen verbietet den
    normalen Import — geladen wird ueber die Datei.

    WARUM NICHT NACHBAUEN: die 487 Firmen sind das Ergebnis einer langen Kette
    (Quellenwahl, Q4-Ableitung, Naht-Waechter, Kalibrierung). Wer sie nachbaut,
    misst seinen Nachbau. Gerufen wird deshalb der Originalcode, und das
    Ergebnis wird gegen die veroeffentlichten Zahlen geankert."""
    pruefe_mauer(pfad)
    spec = importlib.util.spec_from_file_location("studie_basisraten", pfad)
    if spec is None or spec.loader is None:
        raise AktienzahlFehler("E2-Skript nicht ladbar: " + kurzpfad(pfad))
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def hole_e2_reif(e2, panel_pfad, arbeit_pfad, soll):
    """Die S-U-Kette aus E2, Schritt fuer Schritt mit E2s eigenen Funktionen.

    Der Anker ist der Beweis, dass der Aufruf stimmt: kommen nicht genau die
    veroeffentlichten Zahlen heraus (P 90: 1979 Feuerungen / 1025 reife Firmen,
    P 95: 877 / 487), ist die Rekonstruktion falsch und der Lauf haelt an."""
    zaehler = defaultdict(int)
    for name in e2.alle_zaehlernamen():
        zaehler[name] += 0
    panel = e2.oeffne_nur_lesend(panel_pfad)
    arbeit = e2.oeffne_zwischenstand(arbeit_pfad, True)
    try:
        berichte, _, _, _ = e2.lade_berichte(panel, zaehler)
        e2.lies_rohwerte(panel, arbeit, berichte, zaehler, False)
        je_firma = e2.pit_reduktion(arbeit, zaehler)
    finally:
        panel.close()
        arbeit.close()
    # Diese Reihenfolge spiegelt E2s eigenes `auswertung()` fuer die
    # S-U-Familie. Sie wird GELESEN, nicht geraten — und sie hat sich am
    # 19.08. geaendert: seit E2 die Umsatzquelle je FIRMA waehlt (zum
    # Signalzeitpunkt laengste Serie) statt je Quartal, werden die Ketten aus
    # den Reihen JE QUELLE gebaut statt aus der gewaehlten Mischreihe —
    # `wachstum_und_beschleunigung` bekommt seither `alle` statt `gewaehlt`.
    # Der alte Aufruf waere mitten in der Rechnung an einem Typfehler
    # abgestuerzt. Deshalb faengt der Block Schnittstellen-Drift ab und sagt,
    # was zu tun ist, statt einen Stapelabzug auszuspucken.
    try:
        alle, gewaehlt = e2.firmenreihen(je_firma, e2.UMSATZ_QUELLEN, True,
                                         zaehler, "umsatz_")
        _, a_saetze = e2.wachstum_und_beschleunigung(alle, zaehler, "umsatz_")
        letzte, schritte = e2.kalibriere(a_saetze, gewaehlt, zaehler, "umsatz_")
    except (TypeError, AttributeError, ValueError, KeyError) as fehler:
        raise AktienzahlFehler(
            "E2-SCHNITTSTELLE GEAENDERT: die S-U-Kette laesst sich nicht mehr "
            "in dieser Reihenfolge rufen (" + type(fehler).__name__ + ": "
            + str(fehler) + "). Dieses Skript baut die Kette NICHT nach, es "
            "ruft E2s Originalcode — wenn der sich aendert, muss der Aufruf "
            "hier nachgezogen werden. Zu tun: `auswertung()` in "
            "scripts/studie-basisraten.py lesen und die S-U-Schleife hier "
            "spiegeln. Nicht raten: ein falsch gerufener Aufbau liefert "
            "Zahlen, die plausibel aussehen und eine andere Kohorte meinen.")

    ist = tuple((s["p"], s["feuerungen_band"], s["firmen_reif"]) for s in schritte)
    if not anker_stimmt(ist, soll["kalibrierung"]):
        raise AktienzahlFehler(
            "E2-ANKER GERISSEN: die Rekonstruktion der S-U-Kette liefert "
            + str(ist) + " statt " + str(soll["kalibrierung"]) + " (laut "
            + soll["quelle"] + "). Damit ist nicht sicher, dass dies dieselben "
            "Firmen sind wie im E2-Report — jede Zahl ueber 'die "
            + str(soll["reif"]) + "' waere eine andere Grundgesamtheit.")
    if letzte["firmen_reif"] != soll["reif"]:
        raise AktienzahlFehler(
            "E2-ANKER GERISSEN: " + str(letzte["firmen_reif"])
            + " reife Firmen statt " + str(soll["reif"]) + ".")
    # Geankert wurde bisher das ZAEHLFELD, weitergereicht wird die LISTE.
    # Fielen die beiden je auseinander, waere der Anker gruen und der Nenner
    # trotzdem ein anderer. Also die Sache pruefen, nicht ihren Stellvertreter.
    if len(letzte["reif"]) != letzte["firmen_reif"]:
        raise AktienzahlFehler(
            "E2-ANKER GERISSEN: die Liste der reifen Firmen hat "
            + str(len(letzte["reif"])) + " Eintraege, das Zaehlfeld meldet "
            + str(letzte["firmen_reif"]) + ". Der Anker haette das Zaehlfeld "
            "bestaetigt, gerechnet wuerde mit der Liste.")
    return letzte["reif"], gewaehlt, schritte


def abdeckung_der_e2_firmen(reif, gewaehlt, je_firma, zaehler=None):
    """Frage 4, die entscheidende Zahl.

    Drei Stufen, absteigend streng — weil "hat eine Aktienzahl" und "hat sie
    dort, wo R10 sie braucht" zwei verschiedene Dinge sind:
      (a) ueberhaupt ein Wert im Fenster,
      (b) ein Wert in JEDEM Quartal der Umsatzreihe, die E2 fuer diese Firma
          gewaehlt hat (das ist der Anspruch von R10: je Aktie IMMER, nicht
          gelegentlich),
      (c) ein Wert im Ereignisquartal UND in den vier Folgequartalen — das
          Fenster, an dem die Reife dieser Firmen haengt.
    Die Quartalsabdeckung (b) wird zusaetzlich als Verteilung ausgewiesen: ein
    Mittelwert wuerde verdecken, ob alle Firmen halb belegt sind oder die
    Haelfte voll und die Haelfte gar nicht."""
    ergebnis = {}
    for tag, familie, _ in KANDIDATEN:
        q_quartal = QTRS_QUARTAL[familie]
        if zaehler is not None:
            zaehler["e2_firma_ohne_umsatzreihe_" + tag] += 0
        hat_irgendwas = 0
        voll_gedeckt = 0
        ereignisfenster = 0
        ohne_folgequartale = 0
        quoten = []
        for eintrag in reif:
            cik = eintrag["cik"]
            werte = je_firma.get(cik, {})
            stichtage = set(d for (t, d, q) in werte if t == tag and q == q_quartal)
            if stichtage:
                hat_irgendwas += 1
            reihe = gewaehlt.get(cik, {})
            umsatzquartale = set(reihe)
            if not umsatzquartale:
                # Sollte per Konstruktion nicht vorkommen (die reifen Firmen
                # stammen aus genau dieser Auswahl) — aber das ist eine
                # Annahme ueber fremden Code, keine Eigenschaft dieses hier.
                # Also gezaehlt statt geglaubt (R5).
                if zaehler is not None:
                    zaehler["e2_firma_ohne_umsatzreihe_" + tag] += 1
                continue
            gedeckt = len(umsatzquartale & stichtage)
            quote = gedeckt / len(umsatzquartale)
            quoten.append(quote)
            if gedeckt == len(umsatzquartale):
                voll_gedeckt += 1
            # (c) Ereignisquartal + die vier Folgequartale derselben Quelle.
            folge = sorted(d for d in umsatzquartale
                           if d > eintrag["ddate"]
                           and reihe[d][3] == eintrag["basis"])[:4]
            if len(folge) < 4:
                ohne_folgequartale += 1
                continue
            fenster = set(folge) | {eintrag["ddate"]}
            if fenster <= stichtage:
                ereignisfenster += 1
        sortiert = sorted(quoten)
        ergebnis[tag] = {
            "familie": familie,
            "firmen_mit_irgendeinem_wert": hat_irgendwas,
            "firmen_mit_irgendeinem_wert_prozent": anteil(hat_irgendwas, len(reif)),
            "firmen_umsatzreihe_vollstaendig_gedeckt": voll_gedeckt,
            "firmen_umsatzreihe_vollstaendig_gedeckt_prozent": anteil(
                voll_gedeckt, len(reif)),
            "firmen_ereignisfenster_gedeckt": ereignisfenster,
            "firmen_ereignisfenster_gedeckt_prozent": anteil(ereignisfenster,
                                                             len(reif)),
            "firmen_ohne_vier_folgequartale": ohne_folgequartale,
            "quartalsabdeckung_median_prozent": (100.0 * perzentil(sortiert, 0.5)
                                                 if sortiert else None),
            "quartalsabdeckung_p10_prozent": (100.0 * perzentil(sortiert, 0.1)
                                              if sortiert else None),
            "quartalsabdeckung_p90_prozent": (100.0 * perzentil(sortiert, 0.9)
                                              if sortiert else None),
        }
    # Familien-Union: die drei Stichtags- bzw. die drei Zeitraum-Kennungen
    # zusammen. Wer nur eine Kennung abfragt, misst den Namenswechsel als Luecke.
    for familie in ("sofort", "zeitraum"):
        tags = set(t for t, f, _ in KANDIDATEN if f == familie)
        q_quartal = QTRS_QUARTAL[familie]
        voll = 0
        fenster_ok = 0
        for eintrag in reif:
            cik = eintrag["cik"]
            werte = je_firma.get(cik, {})
            stichtage = set(d for (t, d, q) in werte if t in tags and q == q_quartal)
            reihe = gewaehlt.get(cik, {})
            umsatzquartale = set(reihe)
            if umsatzquartale and umsatzquartale <= stichtage:
                voll += 1
            folge = sorted(d for d in umsatzquartale
                           if d > eintrag["ddate"]
                           and reihe[d][3] == eintrag["basis"])[:4]
            if len(folge) == 4 and (set(folge) | {eintrag["ddate"]}) <= stichtage:
                fenster_ok += 1
        ergebnis["UNION-" + familie] = {
            "familie": familie,
            "kennungen": sorted(tags),
            "firmen_umsatzreihe_vollstaendig_gedeckt": voll,
            "firmen_umsatzreihe_vollstaendig_gedeckt_prozent": anteil(voll, len(reif)),
            "firmen_ereignisfenster_gedeckt": fenster_ok,
            "firmen_ereignisfenster_gedeckt_prozent": anteil(fenster_ok, len(reif)),
        }
    return ergebnis


# -- Berichtsbau --------------------------------------------------------------

def zahl(n):
    if n is None:
        return "NICHT BERECHENBAR"
    return "{:,}".format(n).replace(",", ".")


def proz(x, stellen=1):
    if x is None:
        return "NICHT BERECHENBAR"
    return ("%." + str(stellen) + "f") % x


def markdown(daten):
    z = daten["zaehler"]
    a = daten["abdeckung"]
    zeilen = []
    zeilen.append("# E2 — Nebenmessung: Ist die Aktienzahl da? (Stand 2026-08-19)")
    zeilen.append("")
    zeilen.append("**Reine Abdeckungsmessung im Entdeckungsfenster "
                  "(2009-2016). Kein Signal, kein Ergebnis, keine Bewertung.** "
                  "Gemessen wird ausschliesslich, ob der *Nenner* der von R10 "
                  "geforderten Rechnung „Umsatz je Aktie“ in den Daten "
                  "steht — nicht, was diese Rechnung ergibt.")
    zeilen.append("")
    zeilen.append("Warum das vorher feststehen muss: R10 verlangt, dass "
                  "Wachstum **je Aktie** nachgerechnet wird. Eine Firma, die "
                  "ihren Umsatz verdoppelt, dafuer aber die Aktienzahl "
                  "verdreifacht hat, ist fuer einen Anleger geschrumpft. Ist "
                  "die Aktienzahl nicht flaechendeckend da, ist R10 in dieser "
                  "Form nicht praeregistrierbar — und das gehoert **vor** die "
                  "Praeregistrierung, nicht mittendrin.")
    zeilen.append("")

    zeilen.append("## Das Ergebnis in fuenf Saetzen")
    for satz in daten["kurzfassung"]:
        zeilen.append("- " + satz)
    zeilen.append("")

    zeilen.append("## 1. Welche Kennungen tragen ueberhaupt eine Aktienzahl?")
    zeilen.append("")
    zeilen.append("Gesucht wurde **nicht nach Namen**, sondern nach der "
                  "*Einheit*: jede Zeile, deren Messgroesse „shares“ "
                  "(Stueck) ist. Das findet auch, was eine Namensliste "
                  "uebersehen haette.")
    zeilen.append("")
    zeilen.append("- Zeilen mit Einheit „shares“: **" + zahl(z["shares_zeilen"]) + "**")
    zeilen.append("- verschiedene Kennungen davon in der **amtlichen** Taxonomie "
                  "(dem gemeinsamen Begriffskatalog der US-Boersenaufsicht, in "
                  "dem alle Firmen dasselbe Wort fuer dieselbe Sache benutzen): **"
                  + zahl(z["shares_kennungen_standard"]) + "**")
    zeilen.append("- verschiedene **firmeneigene** Kennungen (jede Firma erfindet "
                  "ihren eigenen Namen — nicht vergleichbar): **"
                  + zahl(z["shares_kennungen_firmeneigen"]) + "** in "
                  + zahl(z["shares_zeilen_firmeneigen"]) + " Zeilen")
    zeilen.append("")
    zeilen.append("Die haeufigsten amtlichen Kennungen mit Einheit "
                  "„shares“ (Top " + str(TOP_KENNUNGEN) + "):")
    zeilen.append("")
    zeilen.append("| Kennung | Zeilen | in der Auswahl? |")
    zeilen.append("|---|---:|---|")
    for eintrag in daten["entdeckung_top"]:
        zeilen.append("| `" + eintrag["tag"] + "` | " + zahl(eintrag["zeilen"])
                      + " | " + eintrag["urteil"] + " |")
    zeilen.append("")
    zeilen.append("**Geprueft und verworfen** (steht hier, damit "
                  "„nicht dabei“ nicht wie „uebersehen“ "
                  "aussieht):")
    zeilen.append("")
    for muster, grund in VERWORFEN:
        zeilen.append("- `" + muster + "…` — " + grund)
    zeilen.append("")

    zeilen.append("## 2. Wie gut ist jede Kennung belegt?")
    zeilen.append("")
    zeilen.append("Zwei Nenner, bewusst getrennt ausgewiesen. **Firmen**: von "
                  "allen " + zahl(daten["firmen_gesamt"]) + " Firmen, die im "
                  "Entdeckungsfenster ueberhaupt einen regelmaessigen Bericht "
                  "eingereicht haben. **Firmen-Quartale**: von allen "
                  + zahl(daten["berichts_firmenquartale"]) + " Kombinationen aus "
                  "Firma und Kalenderquartal, fuer die ein Bericht vorliegt. "
                  "Der zweite Nenner ist der strengere und der ehrlichere — "
                  "eine Firma „hat“ die Kennung schon, wenn sie sie "
                  "ein einziges Mal meldet.")
    zeilen.append("")
    zeilen.append("| Kennung | was sie misst | Firmen | Anteil | Firmen-Quartale | Anteil | Stichtag auf einem Quartalsende |")
    zeilen.append("|---|---|---:|---:|---:|---:|---:|")
    for tag, _, zweck in KANDIDATEN:
        e = a[tag]
        zeilen.append("| `" + tag + "` | " + zweck + " | "
                      + zahl(e["firmen_mit_quartalswert"]) + " | "
                      + proz(e["firmen_anteil_prozent"]) + " % | "
                      + zahl(e["firmenquartale"]) + " | "
                      + proz(e["firmenquartale_anteil_prozent"]) + " % | "
                      + proz(e["stichtag_auf_quartalsende_prozent"]) + " % |")
    zeilen.append("")
    zeilen.append("**Die letzte Spalte ist die Falle dieser Messung.** Eine "
                  "Aktienzahl nuetzt nur, wenn ihr Stichtag zum Quartal passt, "
                  "auf das sie bezogen werden soll. "
                  "`EntityCommonStockSharesOutstanding` steht auf dem Deckblatt "
                  "jeder Einreichung und ist deshalb die am **haeufigsten** "
                  "vorhandene Zahl — aber ihr Stichtag ist der Tag der "
                  "Einreichung, also typisch vier bis acht Wochen **nach** dem "
                  "Quartalsende. Sie ist reichlich da und fuer eine "
                  "quartalsgenaue Rechnung trotzdem fast unbrauchbar. Genau "
                  "das zeigt Abschnitt 4.")
    zeilen.append("")
    zeilen.append("*Stichtagszahlen* (`CommonStock…`, `Entity…`) sind "
                  "eine Zahl zum Bilanzstichtag. *Periodendurchschnitte* "
                  "(`WeightedAverage…`) mitteln ueber den Zeitraum — sie "
                  "sind der rechnerisch richtige Nenner unter einer "
                  "Zeitraumgroesse wie dem Umsatz, aber sie existieren nur "
                  "dort, wo die Firma die Periode auch einzeln ausweist.")
    zeilen.append("")

    zeilen.append("## 3. Stabil ueber die Jahre — oder Namenswechsel?")
    zeilen.append("")
    zeilen.append("Beim Umsatz ist dieser Bruch belegt: die Kennung wechselt "
                  "ueber die Jahre den Namen, und eine Abfrage auf nur einen "
                  "Namen misst den Wechsel als Datenluecke. Deshalb hier "
                  "ausdruecklich geprueft.")
    zeilen.append("")
    zeilen.append("Firmen mit mindestens einem Quartalswert, je Kalenderjahr — "
                  "**als Anteil an allen Firmen, die in diesem Jahr ueberhaupt "
                  "einen Bericht abgegeben haben**. Die rohe Firmenzahl faellt "
                  "in jeder Zeile, weil das Entdeckungsfenster am 31.12.2016 "
                  "endet: ein Bilanzstichtag aus dem vierten Quartal 2016 wird "
                  "erst 2017 eingereicht und faellt damit heraus. Erst der "
                  "Anteil zeigt, ob eine Kennung **verschwindet** oder ob nur "
                  "das Fenster zu Ende ist.")
    zeilen.append("")
    jahre = [str(j) for j in range(BAND_JAHRE[0], BAND_JAHRE[1] + 1)]
    basis = daten["firmen_je_berichtsjahr"]
    zeilen.append("| Kennung | " + " | ".join(jahre) + " |")
    zeilen.append("|---|" + "---:|" * len(jahre))
    zeilen.append("| *Bezugsgroesse: Firmen mit Bericht* | "
                  + " | ".join(zahl(basis.get(j)) for j in jahre) + " |")
    for tag, _, _ in KANDIDATEN:
        werte = a[tag]["firmen_je_jahr"]
        felder = []
        for j in jahre:
            n = werte.get(j, 0)
            felder.append(zahl(n) + " (" + proz(anteil(n, basis.get(j))) + " %)")
        zeilen.append("| `" + tag + "` | " + " | ".join(felder) + " |")
    zeilen.append("")
    for familie, e in sorted(daten["naht"].items()):
        zeilen.append("**Familie „" + ("Stichtag" if familie == "sofort"
                                            else "Periodendurchschnitt")
                      + "“** (" + ", ".join("`" + t + "`" for t in e["kennungen"])
                      + "): " + zahl(e["firmen_union"]) + " Firmen insgesamt, davon "
                      + zahl(e["firmen_mit_mehr_als_einer_kennung"]) + " ("
                      + proz(e["firmen_mit_mehr_als_einer_kennung_prozent"])
                      + " %) mit mehr als einer Kennung im Fenster. Die beste "
                      "Einzelkennung (`" + str(e["beste_einzelkennung"]) + "`) deckt "
                      + zahl(e["firmenquartale_beste_einzelkennung"])
                      + " Firmen-Quartale, alle drei zusammen "
                      + zahl(e["firmenquartale_union"]) + " — ein Zugewinn von "
                      + proz(e["zugewinn_durch_union_prozent"]) + " %.")
        zeilen.append("")

    zeilen.append("## 4. Die entscheidende Zahl: die "
                  + zahl(daten["e2_kohorte"]) + " Firmen aus E2")
    zeilen.append("")
    zeilen.append(daten["e2_herkunft"])
    zeilen.append("")
    if daten["e2_kohorte"] != VORFASSUNG["kohorte"]:
        v = VORFASSUNG
        u = daten["e2_abdeckung"].get("UNION-sofort") if daten["e2_abdeckung"] else None
        zeilen.append("> **Die Bezugsgroesse hat sich am selben Tag geaendert.** "
                      "Eine erste Fassung dieser Messung lief gegen **"
                      + zahl(v["kohorte"]) + "** Firmen. " + v["grund"] + " "
                      "Diese Fassung rechnet gegen die **"
                      + zahl(daten["e2_kohorte"]) + "**. Das ist kein "
                      "Zuwachs von " + zahl(daten["e2_kohorte"] - v["kohorte"])
                      + " Firmen auf derselben Liste, sondern eine **andere "
                      "Grundgesamtheit** — die Zahlen der beiden Fassungen "
                      "duerfen nicht vermischt werden.")
        zeilen.append(">")
        zeilen.append("> Der Befund selbst ist davon kaum beruehrt, und das "
                      "ist die eigentliche Nachricht: die Abdeckung im "
                      "Ereignisfenster lag mit den Stichtagszahlen bei **"
                      + proz(v["ereignisfenster_sofort_prozent"]) + " %** ("
                      + zahl(v["ereignisfenster_sofort"]) + " von "
                      + zahl(v["kohorte"]) + ") und liegt jetzt bei **"
                      + (proz(u["firmen_ereignisfenster_gedeckt_prozent"])
                         if u else "NICHT BERECHENBAR")
                      + " %** (" + (zahl(u["firmen_ereignisfenster_gedeckt"])
                                    if u else "—") + " von "
                      + zahl(daten["e2_kohorte"]) + "); mit "
                      "Periodendurchschnitten " + proz(v["ereignisfenster_zeitraum_prozent"])
                      + " % gegenueber jetzt "
                      + (proz(daten["e2_abdeckung"]["UNION-zeitraum"]
                              ["firmen_ereignisfenster_gedeckt_prozent"])
                         if daten["e2_abdeckung"] else "NICHT BERECHENBAR")
                      + " %. Die Empfehlung haengt also nicht an der "
                      "Kohortenwahl.")
        zeilen.append("")
    if not daten["e2_abdeckung"]:
        zeilen.append("**NICHT BERECHENBAR (R5)** — ohne die Rekonstruktion der "
                      "E2-Firmenliste gibt es diese Zahl nicht. Sie wird hier "
                      "nicht geschaetzt und nicht durch eine aehnliche Zahl "
                      "ersetzt.")
        zeilen.append("")
    else:
        zeilen.append("Drei Stufen, absteigend streng — weil „hat eine "
                      "Aktienzahl“ und „hat sie dort, wo R10 sie "
                      "braucht“ zwei verschiedene Dinge sind:")
        zeilen.append("")
        zeilen.append("| Kennung | (a) irgendein Wert | (b) **jedes** Quartal der Umsatzreihe | (c) Ereignisquartal + 4 Folgequartale | Median-Abdeckung der Umsatzquartale |")
        zeilen.append("|---|---:|---:|---:|---:|")
        for tag, _, _ in KANDIDATEN:
            e = daten["e2_abdeckung"][tag]
            zeilen.append("| `" + tag + "` | "
                          + zahl(e["firmen_mit_irgendeinem_wert"]) + " ("
                          + proz(e["firmen_mit_irgendeinem_wert_prozent"]) + " %) | "
                          + zahl(e["firmen_umsatzreihe_vollstaendig_gedeckt"]) + " ("
                          + proz(e["firmen_umsatzreihe_vollstaendig_gedeckt_prozent"])
                          + " %) | " + zahl(e["firmen_ereignisfenster_gedeckt"]) + " ("
                          + proz(e["firmen_ereignisfenster_gedeckt_prozent"]) + " %) | "
                          + proz(e["quartalsabdeckung_median_prozent"]) + " % |")
        for familie in ("sofort", "zeitraum"):
            e = daten["e2_abdeckung"]["UNION-" + familie]
            zeilen.append("| **alle " + ("Stichtags" if familie == "sofort"
                                         else "Durchschnitts") + "-Kennungen zusammen** | — | "
                          + zahl(e["firmen_umsatzreihe_vollstaendig_gedeckt"]) + " ("
                          + proz(e["firmen_umsatzreihe_vollstaendig_gedeckt_prozent"])
                          + " %) | " + zahl(e["firmen_ereignisfenster_gedeckt"]) + " ("
                          + proz(e["firmen_ereignisfenster_gedeckt_prozent"])
                          + " %) | — |")
        zeilen.append("")
    zeilen.append("")

    zeilen.append("## 5. Bewegt sich die Aktienzahl ueberhaupt?")
    zeilen.append("")
    zeilen.append("Wenn nicht, waere R10 teuer und wirkungslos: eine Division "
                  "durch eine Konstante aendert keine Rangfolge. Verglichen "
                  "werden Stichtage im Abstand von 330 bis 380 Kalendertagen "
                  "(dasselbe Jahresfenster, das E2 benutzt); je Firma zaehlt "
                  "die **groesste** Veraenderung, nicht der Durchschnitt.")
    zeilen.append("")
    zeilen.append("**Zwei Lesarten, bewusst nebeneinander.** *Je Firma* heisst: "
                  "hat sich die Aktienzahl **mindestens einmal** im ganzen "
                  "Fenster so stark bewegt? *Je Firmenjahr* heisst: wie oft "
                  "passiert das in einem **beliebigen einzelnen Jahr**? Die "
                  "erste Zahl ist zwangslaeufig groesser — acht Jahre bieten "
                  "acht Gelegenheiten. Wer nur sie berichtet, laesst acht Jahre "
                  "wie ein Jahr aussehen.")
    zeilen.append("")
    zeilen.append("| Kennung | messbare Firmen | Jahrespaare | Median je Firma (Maximum) | Median je Firmenjahr | ueber 5 % (Firmen / Firmenjahre) | ueber 20 % | ueber 50 % | Rueckgang | Split-Verdacht |")
    zeilen.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for tag, e in daten["verwaesserung"].items():
        w = e["schwellen"]
        felder = []
        for name in ("ueber_5_prozent", "ueber_20_prozent", "ueber_50_prozent"):
            felder.append(proz(w[name]["anteil_prozent"]) + " % / "
                          + proz(w[name]["jahrespaare_anteil_prozent"]) + " %")
        zeilen.append("| `" + tag + "` | " + zahl(e["firmen_messbar"]) + " | "
                      + zahl(e["jahrespaare"]) + " | "
                      + proz(e["median_betrag_prozent"]) + " % | "
                      + proz(e["median_jahrespaar_prozent"]) + " % | "
                      + " | ".join(felder) + " | "
                      + zahl(e["firmen_mit_rueckgang"]) + " | "
                      + zahl(e["firmen_mit_splitverdacht"]) + " ("
                      + proz(e["firmen_mit_splitverdacht_prozent"]) + " %) |")
    zeilen.append("")
    zeilen.append("**Grenze dieser Messung (R5):** ein *Aktiensplit* (die Firma "
                  "teilt jede Aktie in mehrere, ohne dass sich am Besitz etwas "
                  "aendert) verdoppelt die Aktienzahl, ohne dass ein Anleger "
                  "verwaessert wird. Aus dieser Datenquelle allein ist beides "
                  "**nicht** zu unterscheiden. Die Spalte „Split-Verdacht“ "
                  "zaehlt die Faelle, deren Verhaeltnis auf ein Prozent genau "
                  "einem gaengigen Splitverhaeltnis entspricht — das ist eine "
                  "**Untergrenze** der Ueberschneidung, keine Korrektur.")
    zeilen.append("")

    zeilen.append("## 6. Verwaessert oder unverwaessert?")
    zeilen.append("")
    zeilen.append("*Unverwaessert* zaehlt die Aktien, die es gibt. "
                  "*Verwaessert* zaehlt zusaetzlich die Aktien, die es geben "
                  "wird, wenn alle Optionen, Wandelanleihen und Bezugsrechte "
                  "eingeloest werden. Fuer die Frage „kommt das Wachstum "
                  "beim Anleger an?“ ist die verwaesserte Zahl die "
                  "haertere — lehrbuchmaessig also die richtige. Die Messung "
                  "dreht diese Rangfolge um; der zweite Punkt sagt, warum.")
    zeilen.append("")
    for satz in daten["empfehlung"]:
        zeilen.append("- " + satz)
    zeilen.append("")

    zeilen.append("## Ist R10 in dieser Form praeregistrierbar?")
    zeilen.append("")
    zeilen.append("**" + daten["r10_verdikt"]["urteil"] + "**")
    zeilen.append("")
    for satz in daten["r10_verdikt"]["begruendung"]:
        zeilen.append("- " + satz)
    zeilen.append("")

    zeilen.append("## Nicht berechenbar — mit Grund (R5)")
    zeilen.append("")
    zeilen.append("| Zaehler | Wert |")
    zeilen.append("|---|---:|")
    for name in sorted(z):
        zeilen.append("| `" + name + "` | " + zahl(z[name]) + " |")
    zeilen.append("")

    zeilen.append("## Woran das geprueft ist")
    zeilen.append("")
    zeilen.append("- **Selbsttest** gegen eine selbstgebaute Mini-Datenbank mit "
                  "von Hand nachgerechneten Erwartungswerten, "
                  + str(len(SABOTAGEN)) + " Pruefungen: "
                  "`python scripts/studie-panel-aktienzahl.py --selbsttest`")
    zeilen.append("- **Gegenprobe**: jede dieser Pruefungen wird einmal "
                  "absichtlich kaputtgemacht — kaputtgemacht wird die *Sache*, "
                  "die sie schuetzt, nicht die Pruefung selbst — und muss rot "
                  "werden. Bleibt eine gruen, ist sie wirkungslos und der Lauf "
                  "meldet das: "
                  "`python scripts/studie-panel-aktienzahl.py --gegenprobe`")
    zeilen.append("- **Fenster-Mauer**: geoeffnet wird ausschliesslich "
                  "`panel-entdeckung.sqlite`, schreibgeschuetzt. Geprueft wird "
                  "der *aufgeloeste* Pfad, nicht der geschriebene — eine "
                  "harmlos benannte Verzeichnis-Verknuepfung in Richtung "
                  "Endtest wird abgewiesen. Der Endtest wurde nie geoeffnet, "
                  "nie entschluesselt, nie gezaehlt.")
    zeilen.append("- **Plausibilitaetsanker** gegen die Vor-Etappen (unten). "
                  "Ein Anker, der Abweichungen schluckt, waere keiner: eine "
                  "Abweichung von einer einzigen Firma haelt den Lauf an.")
    zeilen.append("")
    zeilen.append("## Plausibilitaetsanker")
    zeilen.append("")
    for eintrag in daten["anker"]:
        zeilen.append("- " + eintrag["name"] + ": erwartet " + zahl(eintrag["soll"])
                      + ", gemessen " + zahl(eintrag["ist"]) + " — **"
                      + eintrag["status"] + "**")
    zeilen.append("")

    zeilen.append("## Neue Fragen und Hypothesen (R16)")
    zeilen.append("")
    for frage in daten["fragen"]:
        zeilen.append("- " + frage)
    zeilen.append("")

    zeilen.append("---")
    zeilen.append("")
    zeilen.append("Lauf: " + daten["zeitstempel"] + " · gelesene Dateien: "
                  + ", ".join("`" + p + "`" for p in daten["gelesene_pfade"])
                  + " · Ergebnisdaten (Kurse, Renditen) beruehrt: **"
                  + ("ja" if daten["ergebnisdaten_beruehrt"] else "nein") + "**")
    return "\n".join(zeilen) + "\n"


def schreibe_report(daten, md_pfad, json_pfad):
    for pfad in (md_pfad, json_pfad):
        pruefe_mauer(pfad)
        os.makedirs(os.path.dirname(os.path.abspath(pfad)), exist_ok=True)
    with open(md_pfad, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(markdown(daten))
    with open(json_pfad, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(daten, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")


# -- Die Gesamtauswertung -----------------------------------------------------

def auswertung(panel_pfad, e2_pfad, arbeit_pfad, e2_report, ohne_e2=False):
    soll = lies_e2_sollwerte(e2_report)
    zaehler = defaultdict(int)
    con = oeffne_nur_lesend(panel_pfad)
    try:
        berichte, firmen, firmen_je_berichtsjahr = lies_berichte(con, zaehler)
        zeilen_standard, _ = entdecke_kennungen(con, zaehler)
        je_firma = lies_werte(con, berichte, zaehler)
    finally:
        con.close()

    # Nenner fuer die Firmen-Quartals-Quote: jede Kombination aus Firma und
    # Kalenderquartal, fuer die ueberhaupt ein Wert einer der Kandidaten-
    # Kennungen vorliegen KOENNTE — gemessen an den Stichtagen, die im Panel
    # stehen. Genommen wird die Vereinigung ueber alle Kandidaten; das ist der
    # groesstmoegliche und damit strengste Nenner.
    berichts_fq = set()
    for cik, werte in je_firma.items():
        for (_, ddate, _) in werte:
            q = kalenderquartal(ddate)
            if q is not None:
                berichts_fq.add((cik, q))

    a = abdeckung_je_kennung(je_firma, len(firmen), len(berichts_fq))
    naht = naht_je_familie(je_firma)
    verw = dict((t, verwaesserung(je_firma, t, zaehler))
                for t, _, _ in KANDIDATEN)
    rueckfall = issued_gegen_outstanding(je_firma)

    anker = [{"name": "Firmen im Entdeckungsfenster (E1)",
              "soll": soll["firmen_e1"], "ist": len(firmen),
              "status": ("stimmt" if len(firmen) == soll["firmen_e1"]
                         else "ABWEICHUNG — BEFUND")}]

    e2_abdeckung = {}
    e2_herkunft = ("NICHT BERECHENBAR — die E2-Rekonstruktion wurde mit "
                   "`--ohne-e2` uebersprungen.")
    if not ohne_e2:
        e2 = lade_e2_modul(e2_pfad)
        reif, gewaehlt, schritte = hole_e2_reif(e2, panel_pfad, arbeit_pfad,
                                               soll)
        e2_abdeckung = abdeckung_der_e2_firmen(reif, gewaehlt, je_firma,
                                              zaehler)
        # Dieser Eintrag kann nur "stimmt" tragen: eine Abweichung hat den
        # Lauf oben bereits abgebrochen. Er steht trotzdem im Report, damit
        # sichtbar ist, GEGEN WAS geankert wurde — nicht als weicher Pfad.
        anker.append({"name": "reife Erst-Ereignisse S-U (E2)",
                      "soll": soll["reif"], "ist": len(reif),
                      "status": "stimmt" if len(reif) == soll["reif"]
                      else "ABWEICHUNG — BEFUND"})
        e2_herkunft = (
            "Die Firmenliste steht **nicht** im E2-Report — dort steht nur "
            "die Zahl " + zahl(soll["reif"]) + ". Sie wurde deshalb rekonstruiert, indem der "
            "**Originalcode** von E2 (`scripts/studie-basisraten.py`) als "
            "Bibliothek gerufen wurde, Schritt fuer Schritt in derselben "
            "Reihenfolge. Dass es dieselben Firmen sind, ist an vier Zahlen "
            "geankert: der Kalibrierungsweg liefert bei P 90 exakt "
            + zahl(schritte[0]["feuerungen_band"]) + " Feuerungen und "
            + zahl(schritte[0]["firmen_reif"]) + " reife Firmen, bei P 95 exakt "
            + zahl(schritte[1]["feuerungen_band"]) + " und "
            + zahl(schritte[1]["firmen_reif"]) + " — identisch mit dem "
            "veroeffentlichten E2-Report. Weicht eine dieser Zahlen ab, "
            "**haelt der Lauf an**, statt eine andere Grundgesamtheit als "
            "„die 487“ auszugeben.")

    top = []
    ausgewaehlt = set(KANDIDAT_TAGS)
    for tag, n in sorted(zeilen_standard.items(), key=lambda kv: -kv[1])[:TOP_KENNUNGEN]:
        if tag in ausgewaehlt:
            urteil = "**ja**"
        else:
            grund = next((g for m, g in VERWORFEN if tag.startswith(m)), None)
            urteil = ("nein — " + grund) if grund else "nein"
        top.append({"tag": tag, "zeilen": n, "urteil": urteil})

    daten = {
        "zeitstempel": zeitstempel(),
        "fenster": {"name": "entdeckung", "von": "2009-01-01", "bis": "2016-12-31"},
        "ergebnisdaten_beruehrt": False,
        "gelesene_pfade": list(GELESENE_PFADE),
        "firmen_gesamt": len(firmen),
        "e2_kohorte": soll["reif"],
        "e2_sollquelle": soll["quelle"],
        "firmen_je_berichtsjahr": dict(
            (str(j), n) for j, n in sorted(firmen_je_berichtsjahr.items())
            if BAND_JAHRE[0] <= j <= BAND_JAHRE[1]),
        "berichts_firmenquartale": len(berichts_fq),
        "zaehler": dict(zaehler),
        "entdeckung_top": top,
        "abdeckung": a,
        "naht": naht,
        "verwaesserung": verw,
        "rueckfall_issued_outstanding": rueckfall,
        "e2_abdeckung": e2_abdeckung,
        "e2_herkunft": e2_herkunft,
        "anker": anker,
        "umgebung": {"python": sys.version.split()[0], "sqlite": sqlite3.sqlite_version,
                     "plattform": sys.platform},
    }
    daten["kurzfassung"] = kurzfassung(daten)
    daten["empfehlung"] = empfehlung(daten)
    daten["r10_verdikt"] = r10_verdikt(daten)
    daten["fragen"] = folgefragen(daten)
    return daten


def kurzfassung(daten):
    """Die Kurzfassung folgt dem ZWECK, nicht der groessten Rohzahl.

    Die am haeufigsten vorhandene Kennung ist hier nicht die brauchbarste — wer
    nach Zeilenzahl sortiert, empfiehlt die Deckblatt-Angabe und merkt erst in
    der Rechnung, dass ihr Stichtag nie zum Quartal passt."""
    a = daten["abdeckung"]
    saetze = []
    haeufigste = max(KANDIDAT_TAGS, key=lambda t: a[t]["firmenquartale"])
    saetze.append(
        "Am haeufigsten vorhanden ist `" + haeufigste + "` ("
        + zahl(a[haeufigste]["firmen_mit_quartalswert"]) + " Firmen, "
        + proz(a[haeufigste]["firmen_anteil_prozent"]) + " %) — aber nur "
        + proz(a[haeufigste]["stichtag_auf_quartalsende_prozent"])
        + " % dieser Werte haben einen Stichtag, der auf ein Quartalsende "
        "faellt. Fuer eine quartalsgenaue Rechnung ist die haeufigste Kennung "
        "damit die schlechteste.")
    brauchbar = "CommonStockSharesOutstanding"
    saetze.append(
        "Brauchbar sind die Bilanz-Stichtagszahlen: `" + brauchbar + "` steht "
        "bei " + zahl(a[brauchbar]["firmen_mit_quartalswert"]) + " Firmen ("
        + proz(a[brauchbar]["firmen_anteil_prozent"]) + " %) und deckt "
        + proz(a[brauchbar]["firmenquartale_anteil_prozent"]) + " % der "
        "Firmen-Quartale, mit "
        + proz(a[brauchbar]["stichtag_auf_quartalsende_prozent"])
        + " % passenden Stichtagen.")
    d = a["WeightedAverageNumberOfDilutedSharesOutstanding"]
    b = a["WeightedAverageNumberOfSharesOutstandingBasic"]
    saetze.append(
        "Verwaessert (" + zahl(d["firmenquartale"]) + " Firmen-Quartale) ist "
        "knapp duenner belegt als unverwaessert (" + zahl(b["firmenquartale"])
        + "), Unterschied "
        + proz_aus(abs(b["firmenquartale"] - d["firmenquartale"]),
                   b["firmenquartale"])
        + " % — beide aber deutlich duenner als die Stichtagszahlen.")
    if daten["e2_abdeckung"]:
        u = daten["e2_abdeckung"]["UNION-sofort"]
        z = daten["e2_abdeckung"]["UNION-zeitraum"]
        saetze.append(
            "Die entscheidende Zahl: von den " + zahl(daten["e2_kohorte"]) + " Firmen "
            "mit reifem Erst-Ereignis haben "
            + zahl(u["firmen_ereignisfenster_gedeckt"]) + " ("
            + proz(u["firmen_ereignisfenster_gedeckt_prozent"]) + " %) eine "
            "Stichtags-Aktienzahl im Ereignisquartal UND in allen vier "
            "Folgequartalen. Mit Periodendurchschnitten waeren es nur "
            + zahl(z["firmen_ereignisfenster_gedeckt"]) + " ("
            + proz(z["firmen_ereignisfenster_gedeckt_prozent"]) + " %).")
    v = daten["verwaesserung"]["CommonStockSharesOutstanding"]
    saetze.append(
        "Die Aktienzahl bewegt sich, und zwar deutlich: in "
        + proz(v["schwellen"]["ueber_5_prozent"]["jahrespaare_anteil_prozent"])
        + " % aller gemessenen Firmenjahre aendert sie sich um mehr als 5 %, in "
        + proz(v["schwellen"]["ueber_20_prozent"]["jahrespaare_anteil_prozent"])
        + " % um mehr als 20 % (Median je Firmenjahr: "
        + proz(v["median_jahrespaar_prozent"]) + " %). Ueber das ganze Fenster "
        "trifft es " + proz(v["schwellen"]["ueber_20_prozent"]["anteil_prozent"])
        + " % der Firmen mindestens einmal. R10 ist also keine Division durch "
        "eine Konstante.")
    saetze.append(
        "Ein Namenswechsel wie beim Umsatz liegt **nicht** vor — keine Kennung "
        "verschwindet oder taucht neu auf. Wohl aber lohnt die Familie: alle "
        "drei Stichtags-Kennungen zusammen decken "
        + proz(daten["naht"]["sofort"]["zugewinn_durch_union_prozent"])
        + " % mehr Firmen-Quartale als die beste einzelne.")
    return saetze


def empfehlung(daten):
    """Die Empfehlung folgt den gemessenen Zahlen, nicht der Lehrbuch-Rangfolge.

    Lehrbuchmaessig ist der verwaesserte Periodendurchschnitt der richtige
    Nenner unter einer Zeitraumgroesse wie dem Umsatz. Die Messung sagt etwas
    anderes, und die Messung gewinnt: fuer das Fenster, an dem die Studie
    haengt, existiert dieser Durchschnitt fast nie."""
    a = daten["abdeckung"]
    d = a["WeightedAverageNumberOfDilutedSharesOutstanding"]
    b = a["WeightedAverageNumberOfSharesOutstandingBasic"]
    k = a["WeightedAverageNumberOfShareOutstandingBasicAndDiluted"]
    o = a["CommonStockSharesOutstanding"]
    r = daten["rueckfall_issued_outstanding"]
    saetze = []
    saetze.append(
        "**Belegung, unverwaessert gegen verwaessert:** unverwaessert "
        + zahl(b["firmenquartale"]) + " Firmen-Quartale ("
        + proz(b["firmenquartale_anteil_prozent"]) + " %), verwaessert "
        + zahl(d["firmenquartale"]) + " (" + proz(d["firmenquartale_anteil_prozent"])
        + " %). Die unverwaesserte Zahl ist also um "
        + proz_aus(abs(b["firmenquartale"] - d["firmenquartale"]),
                   b["firmenquartale"])
        + " % besser belegt — ein kleiner Vorsprung. Dazu kommen "
        + zahl(k["firmenquartale"]) + " Firmen-Quartale in der gemeinsamen "
        "Kennung `WeightedAverageNumberOfShareOutstandingBasicAndDiluted`, die "
        "Firmen benutzen, wenn beide Zahlen gleich sind — typisch bei "
        "Verlustfirmen, wo Optionen nicht eingerechnet werden duerfen. Wer "
        "diese dritte Kennung vergisst, verliert ausgerechnet die "
        "verlustschreibenden Wachstumsfirmen.")
    if daten["e2_abdeckung"]:
        ed = daten["e2_abdeckung"]["WeightedAverageNumberOfDilutedSharesOutstanding"]
        eb = daten["e2_abdeckung"]["WeightedAverageNumberOfSharesOutstandingBasic"]
        z = daten["e2_abdeckung"]["UNION-zeitraum"]
        u = daten["e2_abdeckung"]["UNION-sofort"]
        saetze.append(
            "**Der Befund, der die Rangfolge umdreht:** fuer das Fenster, auf "
            "das es ankommt (Ereignisquartal plus vier Folgequartale bei den "
            + zahl(daten["e2_kohorte"]) + " Firmen), liefert der verwaesserte "
            "Durchschnitt " + proz(ed["firmen_ereignisfenster_gedeckt_prozent"])
            + " % Abdeckung, der unverwaesserte "
            + proz(eb["firmen_ereignisfenster_gedeckt_prozent"])
            + " %, alle Durchschnitts-Kennungen zusammen "
            + proz(z["firmen_ereignisfenster_gedeckt_prozent"]) + " %. Die "
            "Stichtagszahlen kommen im selben Fenster auf "
            + proz(u["firmen_ereignisfenster_gedeckt_prozent"]) + " %. Der "
            "rechnerisch sauberere Nenner ist hier also der, den es fast nie "
            "gibt.")
        saetze.append(
            "**Der Grund ist Bauart, nicht Datenqualitaet:** E2 leitet den "
            "Umsatz des vierten Quartals aus dem Geschaeftsjahr minus den drei "
            "Vorquartalen ab. Bei einem *Durchschnitt* geht diese Subtraktion "
            "nicht (ein Durchschnitt ist nicht addierbar). Fuer jedes so "
            "abgeleitete Quartal existiert deshalb gar kein "
            "Durchschnitts-Nenner — und Firmen, die ohnehin nur Jahreswerte "
            "melden, haben nie einen.")
    saetze.append(
        "**Empfehlung — primaer die Stichtagszahl:** `CommonStockSharesOutstanding` "
        "(" + zahl(o["firmenquartale"]) + " Firmen-Quartale, "
        + proz(o["stichtag_auf_quartalsende_prozent"]) + " % passende Stichtage), "
        "und wo sie fehlt `CommonStockSharesIssued` — mit **protokollierter "
        "Herkunft je Wert**, nicht als stille Mischung. Dass dieser Rueckfall "
        "traegt, ist nachgezaehlt und nicht geglaubt: an "
        + zahl(r["stichtage_mit_beiden"]) + " Stichtagen liegen beide "
        "Kennungen vor, an " + proz(r["regel_haelt_prozent"], 2) + " % davon "
        "ist 'ausgegeben' groesser oder gleich 'im Umlauf' — der Fehler geht "
        "also in eine bekannte Richtung (die Je-Aktie-Groesse wird zu klein, "
        "also zu vorsichtig) — und an " + proz(r["identisch_prozent"])
        + " % sind beide Zahlen identisch, dort kostet der Rueckfall gar "
        "nichts. Die restlichen " + proz(r["verletzt_prozent"], 2) + " % ("
        + zahl(r["verletzt"]) + " Stichtage) verletzen die Regel und sind "
        "damit ein eigener, gezaehlter Vorbehalt statt einer Ausnahme, die "
        "unter den Tisch faellt.")
    saetze.append(
        "**Empfehlung — verwaessert als Zweitrechnung:** die verwaesserte "
        "Zahl ist die haertere Pruefung (sie zaehlt die Ansprueche mit, die dem "
        "Altaktionaer noch bevorstehen) und bleibt deshalb im Vertrag — aber "
        "als **Sensitivitaets-Rechnung auf der Teilmenge, wo sie existiert**, "
        "nicht als Hauptnenner. Innerhalb der Durchschnitts-Familie ist "
        "verwaessert der Vorzug, zusammen mit der gemeinsamen Kennung fuer die "
        "Verlustfirmen.")
    saetze.append(
        "**Ausdruecklich nicht verwenden:** "
        "`EntityCommonStockSharesOutstanding`. Sie ist die am besten belegte "
        "Kennung ueberhaupt und trotzdem falsch fuer diesen Zweck — ihr "
        "Stichtag ist der Einreichungstag, nicht das Quartalsende. Wer nach "
        "Belegungsquote auswaehlt, greift genau daneben.")
    return saetze


def r10_verdikt(daten):
    """Das Urteil folgt aus den gemessenen Zahlen, nicht aus einer Meinung."""
    if not daten["e2_abdeckung"]:
        return {"urteil": "NICHT BERECHENBAR — ohne die E2-Rekonstruktion "
                          "fehlt die entscheidende Zahl.",
                "begruendung": ["Lauf mit `--ohne-e2` gestartet."]}
    u_sofort = daten["e2_abdeckung"]["UNION-sofort"]
    u_zeit = daten["e2_abdeckung"]["UNION-zeitraum"]
    v = daten["verwaesserung"]["CommonStockSharesOutstanding"]
    bewegt = v["schwellen"]["ueber_5_prozent"]["jahrespaare_anteil_prozent"]
    quote = u_sofort["firmen_ereignisfenster_gedeckt_prozent"]
    begruendung = [
        "Der Nenner ist da, wo er gebraucht wird: "
        + zahl(u_sofort["firmen_ereignisfenster_gedeckt"]) + " von "
        + zahl(daten["e2_kohorte"]) + " Firmen (" + proz(quote) + " %) tragen eine "
        "Stichtags-Aktienzahl im Ereignisquartal und in allen vier "
        "Folgequartalen.",
        "Mit Periodendurchschnitten waeren es nur "
        + zahl(u_zeit["firmen_ereignisfenster_gedeckt"]) + " ("
        + proz(u_zeit["firmen_ereignisfenster_gedeckt_prozent"]) + " %). Der "
        "rechnerisch sauberere Nenner ist also der, den es fast nie gibt — die "
        "Praeregistrierung muss den Stichtags-Nenner benennen und den "
        "Durchschnitt als Sensitivitaets-Rechnung fuehren, nicht umgekehrt.",
        "Die Rechnung ist nicht wirkungslos: in " + proz(bewegt) + " % aller "
        "gemessenen Firmenjahre aendert sich die Aktienzahl um mehr als 5 %.",
        "Offene Auflage: Aktiensplits sind aus dieser Quelle nicht von echter "
        "Verwaesserung zu trennen (" + proz(v["firmen_mit_splitverdacht_prozent"])
        + " % der Firmen mit Split-Verdacht). Das gehoert als Vorbehalt in die "
        "Praeregistrierung — genauso wie R10 den Zukauf-Waechter offen "
        "als nicht berechenbar fuehrt.",
    ]
    if quote is None:
        # R5: ohne Quote gibt es kein Urteil. Frueher stand hier `or 0.0`, und
        # eine fehlende Messung haette das Urteil "NEIN" erzeugt — eine
        # inhaltliche Aussage aus einer Luecke. Das ist schlimmer als kein
        # Urteil.
        urteil = ("NICHT BERECHENBAR — die Abdeckungsquote im Ereignisfenster "
                  "liess sich nicht bestimmen (kein Nenner). Ohne sie wird "
                  "hier kein Urteil ueber R10 gefaellt.")
    elif quote >= 90.0:
        urteil = ("JA — R10 ist in dieser Form praeregistrierbar, mit einer "
                  "Auflage (Split-Vorbehalt).")
    elif quote >= 70.0:
        urteil = ("JA, MIT AUFLAGEN — praeregistrierbar, aber die "
                  "Abdeckungsquote gehoert als Pflichtangabe in jeden Report, "
                  "und die fehlenden Firmen brauchen Unsicherheits-Schranken "
                  "nach R11.")
    else:
        urteil = ("NEIN — die Abdeckung traegt die Pflicht-Nebenrechnung "
                  "nicht. R10 muss vor der Praeregistrierung umformuliert oder "
                  "als nicht berechenbar gefuehrt werden.")
    return {"urteil": urteil, "begruendung": begruendung, "quote": quote}


def folgefragen(daten):
    return [
        "Aktiensplits sind aus den SEC-Daten allein nicht von Verwaesserung zu "
        "trennen. Gibt es eine gratis verfuegbare Split-Historie (R17: erst "
        "gratis suchen, dann Geldfrage), oder wird der Vorbehalt offen "
        "praeregistriert? (Zeitschaetzung: 0,5 Tage Suche)",
        "Der Periodendurchschnitt fehlt genau dort, wo E2 das vierte Quartal "
        "ableitet. Soll die Je-Aktie-Rechnung durchgehend auf Stichtagszahlen "
        "laufen (einheitlich, aber rechnerisch unsauber) oder gemischt mit "
        "protokollierter Herkunft je Wert? Das beruehrt die Rechenvorschrift "
        "und gehoert vor die Praeregistrierung. (Zeitschaetzung: 0,5 Tage)",
        "Zwischen `CommonStockSharesIssued` und `CommonStockSharesOutstanding` "
        "liegen genau die zurueckgekauften eigenen Aktien, und `TreasuryStockShares` "
        "steht mit 91.014 Zeilen im Panel. Laesst sich die Luecke damit "
        "schliessen, statt sie als Herkunfts-Vermerk mitzuschleppen? "
        "(Zeitschaetzung: 0,5 Tage)",
        "R10 nennt den Zukauf-Waechter ausdruecklich als nicht berechenbar. "
        "Traegt das Panel eine Kennung fuer den Akquisitions-Umsatzbeitrag "
        "(z. B. `BusinessAcquisitionsProFormaRevenue`), und wie duenn ist sie? "
        "Dieselbe Messung, anderer Nenner. (Zeitschaetzung: 0,5 Tage)",
    ]


# -- Selbsttest ---------------------------------------------------------------

def _behaupte(bedingung, meldung):
    if not bedingung:
        raise SystemExit("SELBSTTEST ROT: " + meldung)


def baue_testpanel(pfad):
    """Eine kleine Panel-Datei, deren Erwartungswerte von Hand nachgerechnet sind.

    Drei Firmen mit periodischem Bericht (10, 20, 30) und eine vierte (40), die
    nur eine 8-K-Meldung hat und deshalb nirgends auftauchen darf.

      Firma 10: 100 -> 200 Aktien in 365 Tagen  = +100 % (und Verhaeltnis 2,0 -> Split-Verdacht)
      Firma 20: 100 -> 110 Aktien in 365 Tagen  = +10 %
      Firma 30:  50 ->  50 Aktien in 365 Tagen  =   0 %
    Dazu vier Zeilen, die alle weggefiltert werden muessen: genehmigtes Kapital,
    ein Mitanmelder, eine firmeneigene Kennung, und eine spaetere Fassung mit
    ANDEREM Wert (R6: der frueheste Bericht gewinnt)."""
    if os.path.isfile(pfad):
        os.remove(pfad)
    con = sqlite3.connect(pfad)
    con.executescript(
        "CREATE TABLE bericht (adsh TEXT PRIMARY KEY, cik TEXT, name TEXT,"
        " sic TEXT, form TEXT, period TEXT, accepted TEXT);"
        "CREATE TABLE fakt (adsh TEXT, tag TEXT, version TEXT, coreg TEXT,"
        " ddate TEXT, qtrs TEXT, uom TEXT, value REAL, footnote TEXT);")
    con.executemany("INSERT INTO bericht VALUES(?,?,?,?,?,?,?)", [
        ("a1", "10", "Alpha", "3674", "10-K", "20121231", "2013-02-01 10:00:00.0"),
        ("a2", "10", "Alpha", "3674", "10-K", "20131231", "2014-02-01 10:00:00.0"),
        ("a3", "20", "Beta", "3674", "10-K", "20131231", "2014-02-01 10:00:00.0"),
        ("a4", "30", "Gamma", "3674", "10-K", "20131231", "2014-02-01 10:00:00.0"),
        ("a9", "40", "Delta", "3674", "8-K", "20131231", "2014-02-01 10:00:00.0"),
    ])
    v = "us-gaap/2013"
    s = "CommonStockSharesOutstanding"
    con.executemany("INSERT INTO fakt VALUES(?,?,?,?,?,?,?,?,?)", [
        # Firma 10 — die Reihe, die zaehlt
        ("a1", s, v, "", "20121231", "0", "shares", 100.0, ""),
        ("a2", s, v, "", "20131231", "0", "shares", 200.0, ""),
        # R6-Falle: spaetere Fassung desselben Stichtags mit anderem Wert
        ("a2", s, v, "", "20121231", "0", "shares", 111.0, ""),
        # Firma 20 und 30
        ("a3", s, v, "", "20121231", "0", "shares", 100.0, ""),
        ("a3", s, v, "", "20131231", "0", "shares", 110.0, ""),
        ("a4", s, v, "", "20121231", "0", "shares", 50.0, ""),
        ("a4", s, v, "", "20131231", "0", "shares", 50.0, ""),
        # Ein Periodendurchschnitt, nur bei Firma 10
        ("a1", "WeightedAverageNumberOfDilutedSharesOutstanding", v, "",
         "20121231", "1", "shares", 95.0, ""),
        # Die vier Zeilen, die verschwinden muessen
        ("a1", "CommonStockSharesAuthorized", v, "", "20121231", "0", "shares",
         9999.0, ""),
        ("a1", s, v, "TOCHTER", "20121231", "0", "shares", 7777.0, ""),
        ("a1", s, "0001-13-000001", "", "20121231", "0", "shares", 6666.0, ""),
        ("a9", s, v, "", "20131231", "0", "shares", 5555.0, ""),
    ])
    con.commit()
    con.close()


def selbsttest(verzeichnis):
    print("Selbsttest gegen eine selbstgebaute Panel-Datei mit von Hand "
          "nachgerechneten Erwartungswerten.")
    os.makedirs(verzeichnis, exist_ok=True)
    pfad = os.path.join(verzeichnis, PANEL_DATEI)
    baue_testpanel(pfad)
    zaehler = defaultdict(int)
    con = oeffne_nur_lesend(pfad)
    berichte, firmen, firmen_je_berichtsjahr = lies_berichte(con, zaehler)
    zeilen_standard, zeilen_eigen = entdecke_kennungen(con, zaehler)
    je_firma = lies_werte(con, berichte, zaehler)
    con.close()

    # --- Pruefung 1: nur periodische Berichte zaehlen ------------------------
    _behaupte(len(firmen) == 3,
              "Firmen im Fenster: %s statt 3 — die 8-K-Firma 40 darf nicht "
              "mitzaehlen." % len(firmen))
    _behaupte("40" not in firmen, "Die 8-K-Firma 40 ist in der Firmenmenge.")
    _behaupte(zaehler["berichte_nicht_periodisch"] == 1,
              "Nicht-periodische Berichte: %s statt 1"
              % zaehler["berichte_nicht_periodisch"])
    print("  [1] Formfilter: 3 Firmen aus 4 periodischen Berichten; die "
          "8-K-Firma bleibt draussen.")

    # --- Pruefung 2: die Entdeckung findet alles, die Auswahl filtert --------
    _behaupte(zeilen_standard.get("CommonStockSharesAuthorized") == 1,
              "Die Entdeckung sieht das genehmigte Kapital nicht — sie "
              "filtert schon, statt nur zu zaehlen.")
    _behaupte(len(zeilen_eigen) == 1 and zeilen_eigen.get("CommonStockSharesOutstanding") == 1,
              "Firmeneigene Kennungen: %s statt genau 1 Zeile" % dict(zeilen_eigen))
    gesamt = sum(1 for cik in je_firma for _ in je_firma[cik])
    _behaupte(gesamt == 7,
              "Werte nach Auswahl und Filter: %s statt 7 — genehmigtes "
              "Kapital, Mitanmelder, firmeneigene Kennung und die 8-K-Zeile "
              "muessen weg sein." % gesamt)
    _behaupte(zaehler["verworfen_coreg"] == 1 and
              zaehler["verworfen_firmeneigene_taxonomie"] == 1 and
              zaehler["verworfen_kein_gueltiger_bericht"] == 1,
              "Verwerfungsgruende: coreg %s / firmeneigen %s / ohne gueltigen "
              "Bericht %s — erwartet je 1"
              % (zaehler["verworfen_coreg"],
                 zaehler["verworfen_firmeneigene_taxonomie"],
                 zaehler["verworfen_kein_gueltiger_bericht"]))
    print("  [2] Entdeckung sieht 4 amtliche und 1 firmeneigene Kennung; nach "
          "der Auswahl bleiben 7 Werte, jeder Wegwurf ist einzeln gezaehlt.")

    # --- Pruefung 3: der frueheste Bericht gewinnt (R6) ----------------------
    wert = je_firma["10"][("CommonStockSharesOutstanding", "20121231", "0")][1]
    _behaupte(wert == 100.0,
              "R6 verletzt: fuer Firma 10 zum 31.12.2012 steht %s statt 100 "
              "— die spaetere Fassung hat gewonnen." % wert)
    _behaupte(zaehler["werte_fassungskonflikt"] == 1,
              "Der Fassungskonflikt (100 gegen 111) wird nicht gezaehlt: %s"
              % zaehler["werte_fassungskonflikt"])
    print("  [3] Zeitpunkt-Ehrlichkeit: 100 aus dem Bericht von 2013 schlaegt "
          "111 aus dem Bericht von 2014; der Konflikt ist gezaehlt.")

    # --- Pruefung 4: Abdeckung je Kennung ------------------------------------
    a = abdeckung_je_kennung(je_firma, len(firmen), 6)
    s = a["CommonStockSharesOutstanding"]
    _behaupte(s["firmen_mit_quartalswert"] == 3,
              "Firmen mit Stichtagszahl: %s statt 3" % s["firmen_mit_quartalswert"])
    _behaupte(s["firmenquartale"] == 6,
              "Firmen-Quartale: %s statt 6 (3 Firmen x 2 Stichtage)"
              % s["firmenquartale"])
    _behaupte(abs(s["firmen_anteil_prozent"] - 100.0) < 1e-9,
              "Firmenanteil: %s statt 100.0" % s["firmen_anteil_prozent"])
    _behaupte(s["firmen_je_jahr"] == {"2012": 3, "2013": 3},
              "Jahresreihe: %s statt {2012: 3, 2013: 3}" % s["firmen_je_jahr"])
    d = a["WeightedAverageNumberOfDilutedSharesOutstanding"]
    _behaupte(d["firmen_mit_quartalswert"] == 1 and d["firmenquartale"] == 1,
              "Periodendurchschnitt: %s Firmen / %s Firmen-Quartale statt 1 / 1"
              % (d["firmen_mit_quartalswert"], d["firmenquartale"]))
    _behaupte("CommonStockSharesAuthorized" not in a,
              "Das genehmigte Kapital steht in der Abdeckungstabelle.")
    print("  [4] Abdeckung: Stichtagszahl bei 3 von 3 Firmen und 6 "
          "Firmen-Quartalen, Periodendurchschnitt bei 1 - je Jahr 3 und 3.")

    # --- Pruefung 5: Verwaesserung, von Hand nachgerechnet -------------------
    v = verwaesserung(je_firma, "CommonStockSharesOutstanding")
    _behaupte(v["firmen_messbar"] == 3,
              "Messbare Firmen: %s statt 3" % v["firmen_messbar"])
    _behaupte(v["jahrespaare"] == 3,
              "Jahrespaare: %s statt 3" % v["jahrespaare"])
    _behaupte(v["schwellen"]["ueber_5_prozent"]["firmen"] == 2,
              "Ueber 5 %%: %s Firmen statt 2 (+100 %% und +10 %%)"
              % v["schwellen"]["ueber_5_prozent"]["firmen"])
    _behaupte(v["schwellen"]["ueber_20_prozent"]["firmen"] == 1,
              "Ueber 20 %%: %s Firmen statt 1"
              % v["schwellen"]["ueber_20_prozent"]["firmen"])
    _behaupte(v["schwellen"]["ueber_50_prozent"]["firmen"] == 1,
              "Ueber 50 %%: %s Firmen statt 1"
              % v["schwellen"]["ueber_50_prozent"]["firmen"])
    _behaupte(abs(v["median_betrag_prozent"] - 10.0) < 1e-9,
              "Median: %s statt 10.0 (sortiert 0 / 10 / 100, naechster Rang)"
              % v["median_betrag_prozent"])
    _behaupte(abs(v["median_jahrespaar_prozent"] - 10.0) < 1e-9,
              "Median je Jahrespaar: %s statt 10.0 (drei Paare: 0 / 10 / 100)"
              % v["median_jahrespaar_prozent"])
    _behaupte(abs(v["schwellen"]["ueber_5_prozent"]["jahrespaare_anteil_prozent"]
                  - (200.0 / 3.0)) < 1e-9,
              "Anteil der Jahrespaare ueber 5 %%: %s statt 66.667 (2 von 3)"
              % v["schwellen"]["ueber_5_prozent"]["jahrespaare_anteil_prozent"])
    _behaupte(v["firmen_mit_splitverdacht"] == 1,
              "Split-Verdacht: %s Firmen statt 1 (Verhaeltnis genau 2,0)"
              % v["firmen_mit_splitverdacht"])
    _behaupte(v["firmen_mit_rueckgang"] == 0,
              "Rueckgaenge: %s statt 0" % v["firmen_mit_rueckgang"])
    print("  [5] Verwaesserung: 3 messbare Firmen, 2 ueber 5 %, je 1 ueber 20 % "
          "und 50 %, Median 10 %, 1 Split-Verdacht - alles von Hand nachgerechnet.")

    # --- Pruefung 6: die Fenster-Mauer ---------------------------------------
    for verboten in ("panel-endtest.sqlite.enc", "panel-endtest.sqlite",
                     os.path.join("schluessel", "endtest.key"),
                     os.path.join("endtest", PANEL_DATEI)):
        try:
            oeffne_nur_lesend(os.path.join(verzeichnis, verboten))
        except AktienzahlFehler as fehler:
            _behaupte("R2-ABBRUCH" in str(fehler),
                      "'%s' bricht ab, aber nicht an der Fenster-Mauer." % verboten)
        else:
            raise SystemExit(
                "SELBSTTEST ROT: '%s' laesst sich oeffnen — die "
                "Fenster-Mauer haelt nicht." % verboten)
    oeffne_nur_lesend(pfad).close()
    print("  [6] Fenster-Mauer: 4 Endtest-/Schluesselpfade abgewiesen, das "
          "Entdeckungsfenster geht durch.")

    # --- Pruefung 7: die Mauer haelt auch um die Ecke ------------------------
    # Ein Verzeichnis-Verweis, der harmlos heisst und in den Endtest zeigt.
    # Datei-Symlinks brauchen auf Windows erhoehte Rechte, VERZEICHNIS-
    # Verbindungen (Junctions) nicht — der Angriff ist fuer jeden Nutzer
    # verfuegbar und muss geprueft werden, nicht angenommen.
    echtes = os.path.join(verzeichnis, "endtest")
    os.makedirs(echtes, exist_ok=True)
    with open(os.path.join(echtes, PANEL_DATEI), "w", encoding="utf-8") as fh:
        fh.write("koeder")
    getarnt = os.path.join(verzeichnis, "harmlos")
    gelegt = False
    if not os.path.exists(getarnt):
        try:
            os.symlink(echtes, getarnt, target_is_directory=True)
            gelegt = True
        except (OSError, NotImplementedError, AttributeError):
            if os.name == "nt":
                import subprocess
                gelegt = subprocess.run(
                    ["cmd", "/c", "mklink", "/J", getarnt, echtes],
                    capture_output=True).returncode == 0
    else:
        gelegt = True
    if not gelegt:
        print("  [7] Verweis-Probe NICHT BERECHENBAR - dieses System laesst "
              "weder Symlinks noch Verzeichnis-Verbindungen anlegen (R5: nicht "
              "behaupten, was nicht gemessen wurde).")
    else:
        getarnter_pfad = os.path.join(getarnt, PANEL_DATEI)
        _behaupte("endtest" not in os.path.abspath(getarnter_pfad).lower(),
                  "Der getarnte Pfad enthaelt schon im Namen 'endtest' — die "
                  "Probe prueft dann nicht die Aufloesung des Verweises.")
        _behaupte("endtest" in os.path.realpath(getarnter_pfad).lower(),
                  "Der Verweis loest nicht in das Endtest-Verzeichnis auf — "
                  "die Probe ist wirkungslos aufgebaut.")
        try:
            pruefe_mauer(getarnter_pfad)
        except AktienzahlFehler as fehler:
            _behaupte("R2-ABBRUCH" in str(fehler),
                      "Der Verweis bricht ab, aber nicht an der Fenster-Mauer.")
        else:
            raise SystemExit(
                "SELBSTTEST ROT: ein harmlos benannter Verweis zeigt in den "
                "Endtest und wird durchgelassen — die Mauer prueft nur die "
                "Zeichen des Pfades, nicht sein Ziel.")
        print("  [7] Mauer um die Ecke: ein harmlos benannter Verzeichnis-Verweis "
              "in den Endtest wird abgewiesen (im geschriebenen Pfad steht "
              "'endtest' nicht, nur im aufgeloesten).")

    # --- Pruefung 8: schreibgeschuetzt --------------------------------------
    con = oeffne_nur_lesend(pfad)
    try:
        con.execute("DELETE FROM fakt")
    except sqlite3.OperationalError as fehler:
        _behaupte("readonly" in str(fehler).lower(),
                  "Der Schreibversuch scheitert, aber nicht am Schreibschutz: %s"
                  % fehler)
    else:
        raise SystemExit("SELBSTTEST ROT: das Panel laesst sich beschreiben — "
                         "`mode=ro` wirkt nicht.")
    finally:
        con.close()
    print("  [8] Schreibschutz: ein DELETE auf das Panel scheitert am "
          "Nur-Lesen-Modus.")

    # --- Pruefung 9: doppelte Berichtsnummer bricht ab -----------------------
    zweit = os.path.join(verzeichnis, "panel-entdeckung-zweit.sqlite")
    if os.path.isfile(zweit):
        os.remove(zweit)
    con = sqlite3.connect(zweit)
    con.executescript(
        "CREATE TABLE bericht (adsh TEXT, cik TEXT, name TEXT, sic TEXT,"
        " form TEXT, period TEXT, accepted TEXT);"
        "CREATE TABLE fakt (adsh TEXT, tag TEXT, version TEXT, coreg TEXT,"
        " ddate TEXT, qtrs TEXT, uom TEXT, value REAL, footnote TEXT);")
    con.executemany("INSERT INTO bericht VALUES(?,?,?,?,?,?,?)", [
        ("x1", "10", "A", "3674", "10-K", "20131231", "2014-03-01 10:00:00.0"),
        ("x1", "11", "Doppelt", "3674", "10-K", "20131231", "2014-03-02 10:00:00.0"),
    ])
    con.commit()
    con.close()
    con2 = oeffne_nur_lesend(zweit)
    try:
        lies_berichte(con2, defaultdict(int))
    except AktienzahlFehler as fehler:
        _behaupte("zweimal" in str(fehler),
                  "Die Dublette bricht ab, aber nicht mit der Dubletten-Meldung: %s"
                  % fehler)
    else:
        raise SystemExit(
            "SELBSTTEST ROT: dieselbe Berichtsnummer kommt zweimal vor und geht "
            "still durch — alle Belegungszahlen waeren falsch.")
    finally:
        con2.close()
    print("  [9] Dublette in der Berichtsnummer bricht ab statt still "
          "doppelt zu zaehlen.")

    # --- Pruefung 10: der E2-Anker meldet Abweichungen -----------------------
    # Ein Anker, der Abweichungen schluckt, ist kein Anker. Geprueft wird der
    # Vergleich selbst, ohne den teuren E2-Lauf.
    soll_probe = ((90, 2072, 1066), (95, 925, 512))
    _behaupte(anker_stimmt(((90, 2072, 1066), (95, 925, 512)), soll_probe),
              "Der Anker-Vergleich meldet bei EXAKT passenden Zahlen einen "
              "Unterschied — er wuerde jeden Lauf abbrechen.")
    _behaupte(not anker_stimmt(((90, 2072, 1066), (95, 925, 511)), soll_probe),
              "Eine Abweichung von einer einzigen Firma rutscht durch den "
              "E2-Anker — dann ist er kein Anker.")
    _behaupte(not anker_stimmt(((95, 925, 512),), soll_probe),
              "Ein verkuerzter Kalibrierungsweg rutscht durch — der Anker "
              "prueft dann nur noch den letzten Schritt.")
    try:
        lies_e2_sollwerte(os.path.join(verzeichnis, "gibtsnicht.json"))
    except AktienzahlFehler as fehler:
        _behaupte("nicht gefunden" in str(fehler),
                  "Ein fehlender E2-Report bricht ab, aber mit falscher "
                  "Meldung: %s" % fehler)
    else:
        raise SystemExit(
            "SELBSTTEST ROT: ein fehlender E2-Report liefert trotzdem "
            "Sollwerte — der Anker erfindet sich selbst.")
    print("  [10] Plausibilitaetsanker: exakt passend -> gruen; eine Firma "
          "daneben und ein verkuerzter Weg -> Abweichung; fehlender E2-Report "
          "-> Abbruch statt Vorgabewert.")

    # --- Pruefung 11: traegt der Rueckfall 'ausgegeben' statt 'im Umlauf'? ---
    # Von Hand gebaut, nicht aus dem Testpanel: vier Firmen, drei davon mit
    # beiden Kennungen am selben Stichtag.
    #   A: 100 ausgegeben / 90 umlaufend  -> Regel haelt, nicht identisch
    #   B:  50 /  50                      -> Regel haelt, identisch
    #   C:  10 /  20                      -> VERLETZT
    #   D: nur umlaufend                  -> zaehlt gar nicht
    ausgegeben = "CommonStockSharesIssued"
    umlaufend = "CommonStockSharesOutstanding"
    handgebaut = {
        "A": {(ausgegeben, "20131231", "0"): ("t", 100.0),
              (umlaufend, "20131231", "0"): ("t", 90.0)},
        "B": {(ausgegeben, "20131231", "0"): ("t", 50.0),
              (umlaufend, "20131231", "0"): ("t", 50.0)},
        "C": {(ausgegeben, "20131231", "0"): ("t", 10.0),
              (umlaufend, "20131231", "0"): ("t", 20.0)},
        "D": {(umlaufend, "20131231", "0"): ("t", 77.0)},
    }
    r = issued_gegen_outstanding(handgebaut)
    _behaupte(r["stichtage_mit_beiden"] == 3,
              "Stichtage mit beiden Kennungen: %s statt 3 (Firma D hat nur eine)"
              % r["stichtage_mit_beiden"])
    _behaupte(r["verletzt"] == 1,
              "Verletzungen: %s statt 1 (Firma C meldet 10 ausgegeben bei 20 "
              "umlaufend)" % r["verletzt"])
    _behaupte(r["identisch"] == 1,
              "Identische Paare: %s statt 1 (nur Firma B)" % r["identisch"])
    _behaupte(abs(r["regel_haelt_prozent"] - (200.0 / 3.0)) < 1e-9,
              "Regel haelt: %s %% statt 66.667 (2 von 3)"
              % r["regel_haelt_prozent"])
    print("  [11] Rueckfall-Regel: von 3 Stichtagen mit beiden Kennungen "
          "halten 2 (66,7 %), 1 verletzt sie, 1 ist identisch.")

    # --- Pruefung 12: NICHT BERECHENBAR wird nie zu einer gemessenen Null ---
    # Karls haeufigste Bugklasse: eine Luecke, die als 0,0 % im Report landet.
    # Ein Review fand genau das an vier Stellen (`... or 0.0`), deshalb hat
    # diese Pruefung jetzt einen festen Platz.
    _behaupte(anteil(5, 0) is None,
              "Ein Nenner von null liefert %s statt None — die Luecke wird zur "
              "Zahl." % anteil(5, 0))
    _behaupte(proz(None) == "NICHT BERECHENBAR",
              "None rendert als %r statt als NICHT BERECHENBAR" % proz(None))
    _behaupte(proz_aus(5, 0) == "NICHT BERECHENBAR",
              "proz_aus bei Nenner null: %r statt NICHT BERECHENBAR"
              % proz_aus(5, 0))
    _behaupte(proz_aus(1, 4) == "25.0",
              "proz_aus(1, 4): %r statt '25.0'" % proz_aus(1, 4))
    _behaupte(proz_aus(0, 4) == "0.0",
              "Eine ECHTE Null muss als 0.0 durchkommen, sonst verschweigt der "
              "Report gemessene Nullen: %r" % proz_aus(0, 4))
    # Und das Urteil: ohne Quote kein Urteil, statt eines falschen "NEIN".
    leer = {"e2_abdeckung": {"UNION-sofort": {
                "firmen_ereignisfenster_gedeckt": 0,
                "firmen_ereignisfenster_gedeckt_prozent": None},
            "UNION-zeitraum": {
                "firmen_ereignisfenster_gedeckt": 0,
                "firmen_ereignisfenster_gedeckt_prozent": None}},
            "e2_kohorte": 0,
            "verwaesserung": {"CommonStockSharesOutstanding": {
                "schwellen": {"ueber_5_prozent": {
                    "jahrespaare_anteil_prozent": None}},
                "firmen_mit_splitverdacht_prozent": None}}}
    urteil = r10_verdikt(leer)["urteil"]
    _behaupte(urteil.startswith("NICHT BERECHENBAR"),
              "Ohne Abdeckungsquote lautet das Urteil %r — aus einer Luecke "
              "wird eine inhaltliche Aussage." % urteil[:60])
    # Ein Grund, der nie vorkam, muss trotzdem im Report stehen (mit 0).
    probe = defaultdict(int)
    verwaesserung({}, "CommonStockSharesOutstanding", probe)
    _behaupte("verwaesserung_unter_zwei_werten_CommonStockSharesOutstanding"
              in probe,
              "Ein Grund, der null Mal vorkam, fehlt in der Zaehlertabelle — "
              "dann sieht 'kam nicht vor' aus wie 'wurde nie geprueft'.")
    _behaupte(probe["verwaesserung_unter_zwei_werten_"
                    "CommonStockSharesOutstanding"] == 0,
              "Der vorgemerkte Grund startet nicht bei 0.")
    print("  [12] Luecken bleiben Luecken: Nenner null -> NICHT BERECHENBAR, "
          "eine echte Null bleibt 0,0 %, ein nie eingetretener Grund steht "
          "trotzdem mit 0 im Report, und ohne Quote gibt es kein R10-Urteil "
          "statt eines falschen NEIN.")

    print("Selbsttest gruen (12 Pruefungen).")
    return 0


# -- Gegenprobe: jede Pruefung einmal absichtlich kaputtmachen ----------------

# (Pruefung, was kaputtgemacht wird, Zeilen-Praefix, Ersatzzeile)
# Kaputtgemacht wird jeweils die SACHE, die die Pruefung schuetzt — nie die
# Pruefung selbst. Eine Pruefung, die nur rot wird, wenn man sie umschreibt,
# prueft nichts. Genau diese Sorte Schein-Waechter war in diesem Projekt schon
# zweimal unbemerkt kaputt: einmal pinnte ein Test eine Zeichenkette statt der
# Sache, einmal hielt ein zweites Vorkommen den Test gruen, waehrend genau die
# geschuetzte Stelle sich aenderte.
SABOTAGEN = (
    ("1 Formfilter", "auch 8-K-Meldungen gelten als periodischer Bericht",
     "PERIODISCHE_FORMEN = (",
     'PERIODISCHE_FORMEN = ("10-K", "10-Q", "20-F", "40-F", "8-K")'),
    ("2 Taxonomie-Filter", "firmeneigene Kennungen zaehlen mit",
     '            if not STANDARD_VERSION_RE.match((version or "").strip()):',
     "            if False:"),
    ("3 Zeitpunkt-Ehrlichkeit R6",
     "die spaeteste Fassung gewinnt statt der fruehesten",
     "                if accepted < vorhanden[0]:",
     "                if accepted > vorhanden[0]:"),
    ("4 Abdeckung je Familie",
     "der Periodendurchschnitt wird am Stichtags-Quartal gesucht",
     "QTRS_QUARTAL = {",
     'QTRS_QUARTAL = {"sofort": "0", "zeitraum": "0"}'),
    ("5 Verwaesserung", "Zaehler und Nenner vertauscht",
     "                verhaeltnis = v_spaet / v_frueh",
     "                verhaeltnis = v_frueh / v_spaet"),
    ("6 Fenster-Mauer", "die Verbotsliste trifft nichts mehr",
     "VERBOTEN_RE = re.compile(",
     'VERBOTEN_RE = re.compile(r"^(?!)$", re.IGNORECASE)'),
    ("7 Mauer um die Ecke",
     "nur der geschriebene Pfad wird geprueft, nicht der aufgeloeste",
     "    for form in (geschrieben, aufgeloest):",
     "    for form in (geschrieben,):"),
    ("8 Schreibschutz", "das Panel wird schreibbar geoeffnet",
     '    uri = "file:" + voll.replace(',
     '    uri = "file:" + voll.replace(chr(92), "/") + "?mode=rw"'),
    ("9 Dubletten-Abbruch", "eine doppelte Berichtsnummer geht still durch",
     "        if adsh in gesehen:",
     "        if False:"),
    ("10 Plausibilitaetsanker",
     "der Anker-Vergleich sieht nur noch den letzten Kalibrierungsschritt",
     "def anker_stimmt(ist, soll):",
     "def anker_stimmt(ist, soll): return tuple(ist)[-1:] == tuple(soll)[-1:]"),
    ("12 Luecke bleibt Luecke",
     "der alte Fallback kehrt zurueck: fehlender Anteil wird zu 0,0 Prozent",
     "def proz_aus(zaehler_wert, nenner_wert, stellen=1):",
     "def proz_aus(zaehler_wert, nenner_wert, stellen=1):\n"
     "    return proz(anteil(zaehler_wert, nenner_wert) or 0.0, stellen)"),
    ("11 Rueckfall-Regel",
     "die Stichtagswerte werden an der falschen Periodenlaenge gesucht",
     '            if qtrs != "0" or tag not in ("CommonStockSharesIssued",',
     '            if qtrs != "1" or tag not in ("CommonStockSharesIssued",'),
)


def gegenprobe(verzeichnis):
    """Laeuft den Selbsttest zehnmal gegen eine je einmal sabotierte Kopie.

    Gruen heisst hier: JEDE Sabotage wurde rot gemeldet. Eine Sabotage, die
    durchgeht, ist der eigentliche Befund — dann schuetzt die zugehoerige
    Pruefung nichts, und das faellt sonst erst auf, wenn die Zahlen still
    falsch sind."""
    import subprocess
    os.makedirs(verzeichnis, exist_ok=True)
    eigen = os.path.abspath(__file__)
    with open(eigen, encoding="utf-8") as fh:
        zeilen = fh.read().split(chr(10))
    kopie = os.path.join(verzeichnis, "sabotierte-kopie.py")
    durchgerutscht = []
    print("Gegenprobe: " + str(len(SABOTAGEN))
          + " Sabotagen gegen den eigenen Selbsttest.")
    for name, was, praefix, ersatz in SABOTAGEN:
        treffer = [i for i, z in enumerate(zeilen) if z.startswith(praefix)]
        if len(treffer) != 1:
            # Kein Treffer heisst NICHT "in Ordnung": die Sabotage greift dann
            # ins Leere und die Pruefung bleibt ungeprueft (R5).
            print("  " + name + ": NICHT ANWENDBAR (" + str(len(treffer))
                  + " Treffer) - die Sabotage greift ins Leere, die Pruefung "
                    "bleibt damit UNGEPRUEFT.")
            durchgerutscht.append(name)
            continue
        gebaut = list(zeilen)
        gebaut[treffer[0]] = ersatz
        with open(kopie, "w", encoding="utf-8", newline=chr(10)) as fh:
            fh.write(chr(10).join(gebaut))
        lauf = subprocess.run([sys.executable, kopie, "--selbsttest"],
                              capture_output=True, text=True, encoding="utf-8",
                              errors="replace")
        text = (lauf.stdout or "") + (lauf.stderr or "")
        # Die Meldung kommt aus einem fremden Prozess mit eigener
        # Konsolen-Kodierung. Sie wird auf ASCII heruntergebrochen, sonst
        # stirbt ausgerechnet die Gegenprobe an einem Umlaut.
        rot = [z.encode("ascii", "replace").decode("ascii")
               for z in text.splitlines()
               if "SELBSTTEST ROT" in z or "Error" in z]
        if lauf.returncode == 0:
            print("  " + name + ": GRUEN GEBLIEBEN - " + was
                  + " faellt niemandem auf.")
            durchgerutscht.append(name)
        else:
            print("  " + name + ": rot (" + was + ")")
            print("      " + (rot[0].strip()[:200] if rot else "(ohne Meldung)"))
    if durchgerutscht:
        print("GEGENPROBE ROT: wirkungslose Pruefungen: "
              + ", ".join(durchgerutscht))
        return 1
    print("Gegenprobe gruen: alle " + str(len(SABOTAGEN))
          + " Pruefungen sind einmal rot gewesen.")
    return 0


# -- Hauptlauf ----------------------------------------------------------------

def haupt():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--selbsttest", action="store_true")
    ap.add_argument("--gegenprobe", action="store_true",
                    help="macht jede Pruefung des Selbsttests einmal "
                         "absichtlich kaputt und verlangt, dass sie rot wird")
    ap.add_argument("--bericht", action="store_true")
    ap.add_argument("--ohne-e2", action="store_true",
                    help="ueberspringt die teure E2-Rekonstruktion (Frage 4 "
                         "bleibt dann NICHT BERECHENBAR)")
    ap.add_argument("--data-root", default=None)
    ap.add_argument("--e2-report", default=E2_REPORT,
                    help="der veroeffentlichte E2-Report, aus dem die "
                         "Sollwerte des Plausibilitaetsankers kommen")
    ap.add_argument("--ziel", default=os.path.join(
        "reports", "studie", "E2-aktienzahl-2026-08-19.md"))
    args = ap.parse_args()

    if args.selbsttest or args.gegenprobe:
        import tempfile
        basis = os.path.join(tempfile.gettempdir(),
                             "studie-aktienzahl-selbsttest")
        if args.gegenprobe:
            return gegenprobe(os.path.join(basis, "gegenprobe"))
        return selbsttest(basis)
    if not args.bericht:
        ap.print_help()
        return 1

    wurzel = datenwurzel(args.data_root)
    panel_pfad = os.path.join(wurzel, PANEL_ORDNER, PANEL_DATEI)
    e2_pfad = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "studie-basisraten.py")
    arbeit_pfad = os.path.join(wurzel, "work", "E2-aktienzahl-zwischenstand.sqlite")
    daten = auswertung(panel_pfad, e2_pfad, arbeit_pfad, args.e2_report,
                       args.ohne_e2)
    json_pfad = os.path.splitext(args.ziel)[0] + ".json"
    schreibe_report(daten, args.ziel, json_pfad)
    print("Report: " + args.ziel + " ("
          + str(os.path.getsize(args.ziel)) + " Bytes)")
    print("JSON:   " + json_pfad + " ("
          + str(os.path.getsize(json_pfad)) + " Bytes)")
    for eintrag in daten["anker"]:
        print("ANKER " + eintrag["name"] + ": " + eintrag["status"]
              + " (soll " + str(eintrag["soll"]) + ", ist " + str(eintrag["ist"]) + ")")
    print("R10: " + daten["r10_verdikt"]["urteil"])
    return 0


if __name__ == "__main__":
    try:
        sys.exit(haupt())
    except AktienzahlFehler as fehler:
        print("ABBRUCH: " + str(fehler), file=sys.stderr)
        sys.exit(2)
