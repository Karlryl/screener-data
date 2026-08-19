#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E1, Teilschritt d: der Abdeckungs-Report des Panels.

WAS HIER BEANTWORTET WIRD
-------------------------
Sechs Fragen, alle nur aus Entdeckungs- und Pruefenster:
  1. Wie viele Firmen je Jahr?
  2. Wie viele je Sektor (SEC-Branchenkennung `sic`, gruppiert)?
  3. Wie tief ist die Abdeckung je Firma (Verteilung, nicht Mittelwert)?
  4. Welche Kennzahlen (`tag`) sind wie gut belegt?
  5. Wo sind die Loecher?
  6. Fallzahl-Vorschau bei mehreren Mindesttiefen (R15a).

WARUM EIN EIGENES SKRIPT NEBEN scripts/studie-abdeckung.py
----------------------------------------------------------
Das aeltere `studie-abdeckung.py` misst etwas anderes: es laeuft auf der
41-GB-Roh-Datenbank `derived/sec-fsd-compact.sqlite` und liefert den
R6-Sensitivitaetslauf (Alt-Stand gegen reprozessiert). Es erzeugt den Report
vom 17.08. Wer es ueberschreibt, macht diesen Report unreproduzierbar (R13:
Vergangenes wird nicht nachtraeglich editiert). Dieses Skript hier liest
ausschliesslich das fertige Panel und ruehrt die Roh-Datenbank nicht an.

DIE FENSTER-MAUER LEBT HIER IM CODE, NICHT IN EINER ZUSAGE (R2)
---------------------------------------------------------------
Gelesen werden GENAU zwei Dateien, namentlich aufgezaehlt. Jeder Pfad, der nach
Endtest oder nach Schluesselmaterial aussieht, ist ein Abbruch — kein Filter,
kein Warnhinweis. Ein Filter waere ein Versprechen; ein Abbruch ist eine
Eigenschaft des Programms. Der Endtest wird von diesem Skript nie geoeffnet,
nie entschluesselt, nie gezaehlt.

RECHEN-EHRLICHKEIT (R5)
-----------------------
Fehlt ein Pflichtfeld (`period`, `sic`, `accepted`), heisst das Ergebnis fuer
diese Zeile NICHT BERECHENBAR und wird GEZAEHLT — nie geschaetzt, nie auf null
gesetzt, nie stillschweigend weggelassen. Jede solche Zahl steht im Report.

SPEICHER (R14d)
---------------
Die Faktentabelle hat 64 bzw. 40 Millionen Zeilen und keinen Index. Sie wird
nie am Stueck geladen und nie sortiert (ein GROUP BY ohne Index waere eine
externe Sortierung ueber Gigabytes). Stattdessen zwei sequenzielle Durchlaeufe
in Bloecken: der erste zaehlt Zeilen je Kennzahl, der zweite merkt sich fuer die
ausgewaehlten Kennzahlen in einem Bitfeld, welche Berichte sie tragen. Der
Speicherbedarf haengt an der Zahl der Kennzahlen, nicht an der Zeilenzahl.

Werkzeuge: Python-Standardbibliothek + sqlite3. numpy waere nach R14c erlaubt,
wird aber nicht gebraucht — weniger Abhaengigkeit, gleiche Zahl.

Aufruf:
  python scripts/studie-panel-abdeckung.py --selbsttest
  python scripts/studie-panel-abdeckung.py --bericht
"""

import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone

DATENWURZEL_ENV = "EARLY_DETECTION_DATA_ROOT"

# R2: Die einzigen zwei Dateien, die dieses Skript je oeffnet.
ERLAUBTE_FENSTER = (
    ("entdeckung", "panel-entdeckung.sqlite", "2009-01-01", "2016-12-31"),
    ("validierung", "panel-validierung.sqlite", "2017-01-01", "2020-12-31"),
)
# Alles, was nach dem versiegelten Fenster oder nach Schluesselmaterial aussieht.
VERBOTEN_RE = re.compile(r"endtest|\.enc$|schluessel|\.key$", re.IGNORECASE)

# Periodische Berichte. 8-K, S-1 und Freunde stehen im Panel, tragen aber keine
# Berichtsperiode im Sinne dieser Studie — wer sie mitzaehlt, misst Ad-hoc-Meldungen
# als Quartalsabdeckung. Korrekturfassungen ("/A") gehoeren zum selben Zeitraum und
# zaehlen deshalb zum Stamm.
PERIODISCHE_FORMEN = ("10-K", "10-Q", "20-F", "40-F")

# Standard-Taxonomie vs. firmeneigene Erweiterung. Der Alt-Stand fuehrt die
# Standardversion als "praefix/jahr" (us-gaap/2016, dei/2014); eine firmeneigene
# Erweiterung traegt statt dessen die Einreichungsnummer der Firma. Das ist die
# Trennlinie zwischen "vergleichbare Kennzahl" und "Hausnummer einer einzelnen Firma".
STANDARD_VERSION_RE = re.compile(r"^[a-z][a-z0-9-]*/\d{4}$")

# SIC-Divisionen nach der amtlichen SEC-Gliederung. Die 4-stellige Kennung ist zu
# fein (423 verschiedene allein im Pruefenster); gruppiert wird auf die amtlichen
# Bereiche, damit die Gruppierung nachschlagbar und nicht erfunden ist.
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

# Die Kennzahlen, an denen eine Frueherkennungs-Studie haengt. Bewusst mit den
# konkurrierenden Umsatz-Kennungen: der Umsatz heisst in der US-Rechnungslegung
# nicht durchgehend gleich, und genau dieser Wechsel faellt zwischen die beiden
# Fenster. Wer nur einen Namen abfragt, misst den Namenswechsel als Datenluecke.
PFLICHT_KENNZAHLEN = (
    ("Umsatz (alt, bis ASC 606)", "SalesRevenueNet"),
    ("Umsatz (alt, Waren)", "SalesRevenueGoodsNet"),
    ("Umsatz (alt, Dienstleistung)", "SalesRevenueServicesNet"),
    ("Umsatz (Sammelkennung)", "Revenues"),
    ("Umsatz (neu, ab ASC 606)", "RevenueFromContractWithCustomerExcludingAssessedTax"),
    ("Umsatz (neu, inkl. Umlagen)", "RevenueFromContractWithCustomerIncludingAssessedTax"),
    ("Ergebnis nach Steuern", "NetIncomeLoss"),
    ("Betriebsergebnis", "OperatingIncomeLoss"),
    ("Rohertrag", "GrossProfit"),
    ("Forschung und Entwicklung", "ResearchAndDevelopmentExpense"),
    ("Bilanzsumme", "Assets"),
    ("Verbindlichkeiten", "Liabilities"),
    ("Eigenkapital", "StockholdersEquity"),
    ("Zahlungsmittel", "CashAndCashEquivalentsAtCarryingValue"),
    ("Operativer Cashflow", "NetCashProvidedByUsedInOperatingActivities"),
    ("Ergebnis je Aktie (verwaessert)", "EarningsPerShareDiluted"),
    ("Aktien im Umlauf", "CommonStockSharesOutstanding"),
    ("Vertrieb und Verwaltung", "SellingGeneralAndAdministrativeExpense"),
)
# So viele der haeufigsten Standard-Kennzahlen bekommen zusaetzlich eine exakte
# Belegungsquote. Deckel, weil R14a den Report unter 200 KB haelt.
TOP_KENNZAHLEN = 150
# Mindesttiefen fuer die Fallzahl-Vorschau (R15a).
MINDESTTIEFEN = (1, 4, 6, 8, 12, 16, 20)
BLOCK = 500000


class AbdeckungsFehler(Exception):
    """Ein Befund, der den Lauf anhaelt — nie ein stiller Rueckfall."""


# -- Pfade und die Fenster-Mauer ---------------------------------------------

def datenwurzel(vorgabe=None):
    wert = vorgabe or os.environ.get(DATENWURZEL_ENV)
    if not wert:
        raise AbdeckungsFehler(
            "Speicherort unbekannt: " + DATENWURZEL_ENV + " ist nicht gesetzt "
            "(R12a verbietet einen fest verdrahteten Pfad)")
    return wert


def oeffne_nur_lesend(pfad):
    """R2: Erst die Mauer, dann die Datei — und nur schreibgeschuetzt.

    Die Pruefung laeuft ueber den GANZEN Pfad, nicht nur den Dateinamen: ein
    Verzeichnis `.../endtest/panel-entdeckung.sqlite` waere sonst durchgerutscht."""
    voll = os.path.abspath(pfad)
    if VERBOTEN_RE.search(voll.replace(os.sep, "/")):
        raise AbdeckungsFehler(
            "R2-ABBRUCH: '" + voll + "' fuehrt zum versiegelten Endtest oder zu "
            "Schluesselmaterial. Dieses Skript oeffnet das Endtest-Fenster nie — "
            "wer vorher hineinsieht, macht das Studienergebnis wertlos.")
    if not os.path.isfile(voll):
        raise AbdeckungsFehler("Panel-Datei nicht gefunden: " + voll)
    uri = "file:" + voll.replace("\\", "/") + "?mode=ro"
    return sqlite3.connect(uri, uri=True)


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


def quartal_aus_period(period):
    """'YYYYMMDD' -> fortlaufende Quartalsnummer. Unlesbar -> None (R5).

    Die fortlaufende Nummer (Jahr*4 + Quartal) macht 'zwei Quartale am Stueck'
    zu einer Differenz von 1 und damit pruefbar."""
    if period is None:
        return None
    text = str(period).strip()
    if len(text) != 8 or not text.isdigit():
        return None
    jahr, monat = int(text[:4]), int(text[4:6])
    if not (1900 <= jahr <= 2100) or not (1 <= monat <= 12):
        return None
    return jahr * 4 + (monat - 1) // 3


def formstamm(form):
    """'10-K/A' -> '10-K'. Korrekturfassungen betreffen denselben Zeitraum."""
    return (form or "").split("/")[0].strip().upper()


def perzentil(sortierte_werte, anteil):
    """Naechster Rang, ohne Interpolation — von Hand nachrechenbar.

    Bei 10 sortierten Werten liegt der Median (0.5) auf Rang ceil(0.5*10)=5,
    also dem 5. Wert. Keine Zwischenwerte, die es in den Daten nicht gibt."""
    if not sortierte_werte:
        return None
    rang = int(-(-anteil * len(sortierte_werte) // 1))  # aufrunden
    return sortierte_werte[max(0, min(rang - 1, len(sortierte_werte) - 1))]


def fensterbreite_quartale(von, bis):
    """Wie viele Quartale ist ein Fenster breit? '2017-01-01'..'2020-12-31' -> 16.

    Diese Zahl ist die Obergrenze, gegen die jede Fallzahl-Forderung laeuft: eine
    Kette von 20 Quartalen ist in einem 16 Quartale breiten Fenster nicht deshalb
    selten, weil die Daten schlecht waeren, sondern weil sie nicht hineinpasst."""
    a = quartal_aus_period(von.replace("-", ""))
    b = quartal_aus_period(bis.replace("-", ""))
    if a is None or b is None:
        return None
    return b - a + 1


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


def bits_gesetzt(feld, maske=None):
    """Anzahl gesetzter Bits, wahlweise nur innerhalb einer Maske."""
    if maske is None:
        return sum(bin(b).count("1") for b in feld)
    return sum(bin(b & m).count("1") for b, m in zip(feld, maske))


# -- Ebene 1: die Berichtstabelle ---------------------------------------------

def lies_berichte(con):
    """Ein Durchlauf ueber `bericht`. 150-180k Zeilen — klein genug fuer den Speicher.

    Rueckgabe: je Firma die Quartalsmenge, plus alle Zaehler fuer Jahr und Sektor,
    plus die Bitmaske der periodischen Berichte (der Nenner fuer Frage 4)."""
    ergebnis = {
        "berichte_gesamt": 0,
        "berichte_periodisch": 0,
        "formen": {},
        "formen_je_jahr": {},
        "nicht_berechenbar": {
            "accepted_fehlt": 0, "period_unlesbar": 0,
            "sic_fehlt_oder_unlesbar": 0, "cik_fehlt": 0,
        },
        "firmen_je_jahr_veroeffentlichung": {},
        "firmen_je_jahr_berichtsperiode": {},
        "berichte_je_jahr_veroeffentlichung": {},
        "firmen_je_division": {},
        "firmen_je_sic2": {},
    }
    firmen_jahr_v, firmen_jahr_p = {}, {}
    firmen_div, firmen_sic2 = {}, {}
    je_firma = {}
    adsh_index = {}
    periodisch_nummern = []

    cur = con.execute("SELECT adsh, cik, sic, form, period, accepted FROM bericht")
    while True:
        block = cur.fetchmany(50000)
        if not block:
            break
        for adsh, cik, sic, form, period, accepted in block:
            nummer = len(adsh_index)
            adsh_index[adsh] = nummer
            ergebnis["berichte_gesamt"] += 1
            stamm = formstamm(form)
            ergebnis["formen"][stamm] = ergebnis["formen"].get(stamm, 0) + 1
            if stamm in PERIODISCHE_FORMEN:
                ergebnis["berichte_periodisch"] += 1
                periodisch_nummern.append(nummer)

            if not accepted:
                ergebnis["nicht_berechenbar"]["accepted_fehlt"] += 1
                jahr_v = None
            else:
                jahr_v = str(accepted)[:4]
                ergebnis["berichte_je_jahr_veroeffentlichung"][jahr_v] = \
                    ergebnis["berichte_je_jahr_veroeffentlichung"].get(jahr_v, 0) + 1
                je_jahr = ergebnis["formen_je_jahr"].setdefault(stamm, {})
                je_jahr[jahr_v] = je_jahr.get(jahr_v, 0) + 1
            if not cik:
                ergebnis["nicht_berechenbar"]["cik_fehlt"] += 1
                continue
            if jahr_v:
                firmen_jahr_v.setdefault(jahr_v, set()).add(cik)

            division = sic_division(sic)
            if division is None:
                ergebnis["nicht_berechenbar"]["sic_fehlt_oder_unlesbar"] += 1
            else:
                firmen_div.setdefault(division, set()).add(cik)
                firmen_sic2.setdefault(str(sic).strip()[:2], set()).add(cik)

            # Ab hier nur noch periodische Berichte: nur sie tragen eine
            # Berichtsperiode im Sinne der Abdeckungstiefe.
            if stamm not in PERIODISCHE_FORMEN:
                continue
            quartal = quartal_aus_period(period)
            if quartal is None:
                ergebnis["nicht_berechenbar"]["period_unlesbar"] += 1
                continue
            je_firma.setdefault(cik, set()).add(quartal)
            firmen_jahr_p.setdefault(str(quartal // 4), set()).add(cik)

    maske = bytearray((len(adsh_index) + 7) // 8)
    for nummer in periodisch_nummern:
        maske[nummer >> 3] |= 1 << (nummer & 7)

    ergebnis["firmen_je_jahr_veroeffentlichung"] = \
        dict(sorted((j, len(m)) for j, m in firmen_jahr_v.items()))
    ergebnis["firmen_je_jahr_berichtsperiode"] = \
        dict(sorted((j, len(m)) for j, m in firmen_jahr_p.items()))
    ergebnis["firmen_je_division"] = \
        dict(sorted(((d, len(m)) for d, m in firmen_div.items()), key=lambda p: -p[1]))
    ergebnis["firmen_je_sic2"] = \
        dict(sorted((s, len(m)) for s, m in firmen_sic2.items()))
    ergebnis["berichte_je_jahr_veroeffentlichung"] = \
        dict(sorted(ergebnis["berichte_je_jahr_veroeffentlichung"].items()))
    ergebnis["formen"] = dict(sorted(ergebnis["formen"].items(), key=lambda p: -p[1]))
    ergebnis["firmen_gesamt"] = len(je_firma)
    return ergebnis, je_firma, adsh_index, maske


def tiefe_und_fallzahl(je_firma, fensterbreite=None):
    """Frage 3 und 6: Verteilung der Abdeckungstiefe und Fallzahl je Mindesttiefe."""
    tiefen = sorted(len(q) for q in je_firma.values())
    ketten = sorted(laengste_kette(q) for q in je_firma.values())
    histogramm = {}
    for t in tiefen:
        eimer = ("1" if t == 1 else "2-3" if t <= 3 else "4-7" if t <= 7
                 else "8-11" if t <= 11 else "12-19" if t <= 19
                 else "20-31" if t <= 31 else "32+")
        histogramm[eimer] = histogramm.get(eimer, 0) + 1

    vorschau = []
    for k in MINDESTTIEFEN:
        treffer = [(len(q), laengste_kette(q)) for q in je_firma.values()
                   if laengste_kette(q) >= k]
        vorschau.append({
            "mindesttiefeQuartaleAmStueck": k,
            "firmen": len(treffer),
            # Nur die Quartale, die wirklich in einer Kette der Mindestlaenge
            # liegen, sind auswertbar — die Gesamtzahl der Firmenquartale waere
            # hier eine Schoenrechnung.
            "firmenQuartaleInKetten": sum(kette for _tiefe, kette in treffer),
            "firmenQuartaleGesamtDieserFirmen": sum(tiefe for tiefe, _k in treffer),
            # Passt die Forderung ueberhaupt ins Fenster? Wenn nicht, ist eine
            # kleine Zahl kein Datenmangel, sondern Arithmetik.
            "strukturellGedeckelt": bool(fensterbreite and k >= fensterbreite),
        })
    return {
        "fensterbreiteQuartale": fensterbreite,
        "quartaleJeFirma": {
            "firmen": len(tiefen),
            "minimum": tiefen[0] if tiefen else None,
            "p10": perzentil(tiefen, 0.10), "p25": perzentil(tiefen, 0.25),
            "median": perzentil(tiefen, 0.50), "p75": perzentil(tiefen, 0.75),
            "p90": perzentil(tiefen, 0.90),
            "maximum": tiefen[-1] if tiefen else None,
            "summeFirmenQuartale": sum(tiefen),
            "histogramm": histogramm,
        },
        "laengsteKetteJeFirma": {
            "minimum": ketten[0] if ketten else None,
            "p25": perzentil(ketten, 0.25), "median": perzentil(ketten, 0.50),
            "p75": perzentil(ketten, 0.75), "p90": perzentil(ketten, 0.90),
            "maximum": ketten[-1] if ketten else None,
        },
        "fallzahlVorschau": vorschau,
    }


# -- Ebene 2: die Faktentabelle (zwei Durchlaeufe, nie am Stueck) --------------

def zaehle_kennzahlen(con, fortschritt=lambda _s: None):
    """Durchlauf 1: Zeilen je Standard-Kennzahl. Firmeneigene Erweiterungen werden
    nur summiert, nicht namentlich gefuehrt — es sind Millionen Einzelnamen, und
    keiner davon ist zwischen zwei Firmen vergleichbar."""
    zeilen_je_tag = {}
    eigen_zeilen = 0
    eigen_namen = set()
    gesamt = 0
    cur = con.execute("SELECT tag, version FROM fakt")
    while True:
        block = cur.fetchmany(BLOCK)
        if not block:
            break
        gesamt += len(block)
        for tag, version in block:
            if version and STANDARD_VERSION_RE.match(version):
                zeilen_je_tag[tag] = zeilen_je_tag.get(tag, 0) + 1
            else:
                eigen_zeilen += 1
                eigen_namen.add(tag)
        fortschritt("  Durchlauf 1: %d Faktenzeilen" % gesamt)
    return {
        "faktenzeilen": gesamt,
        "zeilenStandard": gesamt - eigen_zeilen,
        "zeilenFirmeneigen": eigen_zeilen,
        "kennzahlenStandard": len(zeilen_je_tag),
        "kennzahlenFirmeneigen": len(eigen_namen),
        "zeilen_je_tag": zeilen_je_tag,
    }


def belege_kennzahlen(con, adsh_index, gesuchte, fortschritt=lambda _s: None):
    """Durchlauf 2: In WIE VIELEN BERICHTEN kommt jede gesuchte Kennzahl vor?

    Ein Bitfeld je Kennzahl statt einer Menge von Berichtsnummern: 176 502
    Berichte passen in 22 KB, eine Menge derselben Groesse braucht das
    Hundertfache. Exakt ist beides, nur kostet das eine nichts."""
    breite = (len(adsh_index) + 7) // 8
    felder = dict((tag, bytearray(breite)) for tag in gesuchte)
    gesamt = 0
    fehlender_adsh = 0
    cur = con.execute("SELECT adsh, tag FROM fakt")
    while True:
        block = cur.fetchmany(BLOCK)
        if not block:
            break
        gesamt += len(block)
        for adsh, tag in block:
            feld = felder.get(tag)
            if feld is None:
                continue
            nr = adsh_index.get(adsh)
            if nr is None:
                # Waisen-Zeile. Der Bau meldet 0 davon; wenn hier doch eine
                # auftaucht, ist das ein Befund und keine Rundungsfrage.
                fehlender_adsh += 1
                continue
            feld[nr >> 3] |= 1 << (nr & 7)
        fortschritt("  Durchlauf 2: %d Faktenzeilen" % gesamt)
    return felder, gesamt, fehlender_adsh


# -- Ein Fenster komplett -----------------------------------------------------

def werte_fenster_aus(con, name, fensterbreite=None, fortschritt=lambda _s: None):
    fortschritt("[%s] Berichtstabelle" % name)
    b, je_firma, adsh_index, periodisch_maske = lies_berichte(con)
    tiefe = tiefe_und_fallzahl(je_firma, fensterbreite)

    fortschritt("[%s] Faktentabelle, Durchlauf 1 von 2" % name)
    k1 = zaehle_kennzahlen(con, fortschritt)
    zeilen_je_tag = k1.pop("zeilen_je_tag")

    haeufigste = sorted(zeilen_je_tag.items(), key=lambda p: -p[1])[:TOP_KENNZAHLEN]
    gesucht = set(t for t, _ in haeufigste)
    gesucht.update(tag for _bez, tag in PFLICHT_KENNZAHLEN)

    fortschritt("[%s] Faktentabelle, Durchlauf 2 von 2" % name)
    felder, gesamt2, waisen = belege_kennzahlen(con, adsh_index, gesucht, fortschritt)
    if gesamt2 != k1["faktenzeilen"]:
        raise AbdeckungsFehler(
            "Die zwei Durchlaeufe sehen verschieden viele Zeilen (%d gegen %d) — "
            "die Datei hat sich waehrend des Laufs geaendert."
            % (k1["faktenzeilen"], gesamt2))

    # Der ehrliche Nenner fuer eine Bilanzkennzahl sind die PERIODISCHEN Berichte.
    # Wer durch alle Berichte teilt, laesst Ad-hoc-Meldungen (8-K) jede Bilanzgroesse
    # kuenstlich duenn aussehen — die tragen naturgemaess keine Bilanzsumme.
    alle_nenner = b["berichte_gesamt"]
    per_nenner = b["berichte_periodisch"]

    def quote(tag):
        feld = felder.get(tag)
        if feld is None:
            return {"berichte": 0, "anteilProzent": 0.0,
                    "berichtePeriodisch": 0, "anteilPeriodischProzent": 0.0}
        alle = bits_gesetzt(feld)
        per = bits_gesetzt(feld, periodisch_maske)
        return {
            "berichte": alle,
            "anteilProzent": round(100.0 * alle / alle_nenner, 2) if alle_nenner else None,
            "berichtePeriodisch": per,
            "anteilPeriodischProzent": round(100.0 * per / per_nenner, 2) if per_nenner else None,
        }

    pflicht = [{"bezeichnung": bez, "tag": tag, "zeilen": zeilen_je_tag.get(tag, 0),
                **quote(tag)} for bez, tag in PFLICHT_KENNZAHLEN]
    top = [{"tag": tag, "zeilen": zeilen, **quote(tag)} for tag, zeilen in haeufigste]

    # Verteilung der Belegung ueber die haeufigsten Kennzahlen — die Antwort auf
    # "flaechendeckend oder nur ein Bruchteil?" in einer Zahl statt in 150.
    anteile = sorted(e["anteilPeriodischProzent"] for e in top)
    verteilung = {
        "nenner": "periodische Berichte (10-K, 10-Q, 20-F, 40-F)",
        "kennzahlenBetrachtet": len(top),
        "ueber90Prozent": sum(1 for a in anteile if a >= 90),
        "ueber50Prozent": sum(1 for a in anteile if a >= 50),
        "unter10Prozent": sum(1 for a in anteile if a < 10),
        "median": perzentil(anteile, 0.50),
    }
    return {
        "fenster": name,
        "berichte": b,
        "abdeckungstiefe": tiefe,
        "kennzahlen": {
            **k1,
            "nennerAlleBerichte": alle_nenner,
            "nennerPeriodischeBerichte": per_nenner,
            "waisenZeilenOhneBericht": waisen,
            "belegungVerteilungTop": verteilung,
            "pflichtKennzahlen": pflicht,
            "haeufigsteKennzahlen": top,
        },
    }


# -- Loecher ------------------------------------------------------------------

def finde_loecher(je_fenster):
    """Frage 5. Ein Loch ist keine Meinung: entweder ein Jahr faellt gegen den
    Median des Fensters stark ab, oder eine Pflicht-Kennzahl kippt zwischen den
    Fenstern, oder ein Sektor ist zu duenn fuer einen eigenen Schnitt."""
    loecher = []
    for name, f in je_fenster.items():
        jahre = f["berichte"]["firmen_je_jahr_veroeffentlichung"]
        if jahre:
            werte = sorted(jahre.values())
            mitte = perzentil(werte, 0.50)
            for jahr, anzahl in sorted(jahre.items()):
                if mitte and anzahl < 0.6 * mitte:
                    loecher.append({
                        "art": "Jahr duenn besetzt", "fenster": name, "stelle": jahr,
                        "zahl": anzahl, "vergleich": mitte,
                        "text": "Im %s tragen die Berichte aus %s nur %d Firmen gegen %d im Mittel "
                                "des Fensters (%.0f %%)." % (fenstername(name), jahr, anzahl,
                                                            mitte, 100.0 * anzahl / mitte)})

    # Kennzahlen, die zwischen den Fenstern kippen — der gefaehrlichste Fall,
    # weil eine Auswertung ueber beide Fenster dann einen Namenswechsel als
    # Verhaltensaenderung misst.
    namen = list(je_fenster)
    if len(namen) == 2:
        a, b = namen
        qa = dict((e["tag"], e) for e in je_fenster[a]["kennzahlen"]["pflichtKennzahlen"])
        qb = dict((e["tag"], e) for e in je_fenster[b]["kennzahlen"]["pflichtKennzahlen"])
        for tag in qa:
            pa = qa[tag]["anteilPeriodischProzent"]
            pb = qb[tag]["anteilPeriodischProzent"]
            if abs(pa - pb) >= 20:
                loecher.append({
                    "art": "Kennzahl kippt zwischen den Fenstern", "fenster": "beide",
                    "stelle": tag, "zahl": pb, "vergleich": pa,
                    "text": "%s (%s) steht in %.1f %% der periodischen Berichte im %s, "
                            "aber in %.1f %% im %s — Unterschied %.1f Punkte."
                            % (qa[tag]["bezeichnung"], tag, pa, fenstername(a),
                               pb, fenstername(b), pb - pa)})
            if pa < 5 and pb < 5:
                loecher.append({
                    "art": "Pflicht-Kennzahl praktisch nicht belegt", "fenster": "beide",
                    "stelle": tag, "zahl": pb, "vergleich": pa,
                    "text": "%s (%s) steht in beiden Fenstern unter 5 %% der periodischen "
                            "Berichte (%s: %.1f %%, %s: %.1f %%)."
                            % (qa[tag]["bezeichnung"], tag, fenstername(a), pa,
                               fenstername(b), pb)})

    # Formularmix-Brueche. Wenn eine Berichtsart in einem Jahr vielfach haeufiger
    # geliefert wird als sonst im selben Fenster, aendert sich die Zusammensetzung
    # der Datenbasis — nicht das Verhalten der Firmen. Wer Berichte je Jahr zaehlt,
    # misst dann den Lieferumfang der Behoerde.
    for name, f in je_fenster.items():
        for stamm, je_jahr in f["berichte"]["formen_je_jahr"].items():
            if len(je_jahr) < 3:
                continue
            mitte = perzentil(sorted(je_jahr.values()), 0.50)
            if not mitte:
                continue
            for jahr, anzahl in sorted(je_jahr.items()):
                if anzahl >= 1000 and anzahl >= 5 * mitte:
                    loecher.append({
                        "art": "Formularmix bricht in einem Jahr", "fenster": name,
                        "stelle": "%s %s" % (stamm, jahr), "zahl": anzahl,
                        "vergleich": mitte,
                        "text": "Im %s springt %s im Jahr %s auf %d Berichte gegen %d im Mittel der "
                                "uebrigen Jahre des Fensters (Faktor %.0f). Die Zahl der "
                                "Berichte je Jahr ist damit ueber die Jahre nicht "
                                "vergleichbar."
                                % (fenstername(name), stamm, jahr, anzahl, mitte,
                                   float(anzahl) / mitte)})

    # Mindesttiefen, die gar nicht ins Fenster passen.
    for name, f in je_fenster.items():
        breite = f["abdeckungstiefe"].get("fensterbreiteQuartale")
        gedeckelt = [v["mindesttiefeQuartaleAmStueck"]
                     for v in f["abdeckungstiefe"]["fallzahlVorschau"]
                     if v.get("strukturellGedeckelt")]
        if breite and gedeckelt:
            loecher.append({
                "art": "Fenster zu schmal fuer die geforderte Tiefe", "fenster": name,
                "stelle": ", ".join("%d Quartale" % k for k in gedeckelt),
                "zahl": min(gedeckelt), "vergleich": breite,
                "text": "Das %s ist nur %d Quartale breit. Die Mindesttiefen "
                        "%s liegen an oder ueber dieser Grenze — die kleinen Fallzahlen "
                        "dort sind Arithmetik, kein Datenmangel."
                        % (fenstername(name), breite,
                           " und ".join("%d" % k for k in gedeckelt))})

    # Sektoren, die zu duenn fuer eine eigene Auswertung sind.
    for name, f in je_fenster.items():
        for bereich, anzahl in f["berichte"]["firmen_je_division"].items():
            if anzahl < 100:
                loecher.append({
                    "art": "Sektor zu duenn fuer eine eigene Auswertung",
                    "fenster": name, "stelle": bereich, "zahl": anzahl, "vergleich": 100,
                    "text": "%s hat im %s nur %d Firmen — unter 100 traegt kein "
                            "eigener Sektor-Schnitt." % (bereich, fenstername(name), anzahl)})
    return loecher


# -- Plausibilitaetsanker -----------------------------------------------------

def pruefe_anker(je_fenster, bau_report_pfad):
    """Die Zahlen dieses Laufs gegen den Bau-Report. Eine Abweichung ist ein
    BEFUND und wird berichtet — sie wird nie durch Anpassen der Rechnung geheilt."""
    if not os.path.isfile(bau_report_pfad):
        return {"status": "NICHT BERECHENBAR",
                "grund": "Bau-Report nicht gefunden: " + bau_report_pfad}
    with open(bau_report_pfad, encoding="utf-8") as fh:
        bau = json.load(fh)
    zeilen = []
    alle_gleich = True
    for name, f in je_fenster.items():
        soll = bau.get("jeFenster", {}).get(name)
        if not soll:
            zeilen.append({"fenster": name, "status": "NICHT BERECHENBAR",
                           "grund": "Fenster steht nicht im Bau-Report"})
            alle_gleich = False
            continue
        for feld, ist, sollwert in (
                ("berichte", f["berichte"]["berichte_gesamt"], soll["berichte"]),
                ("fakten", f["kennzahlen"]["faktenzeilen"], soll["fakten"])):
            passt = ist == sollwert
            alle_gleich = alle_gleich and passt
            zeilen.append({"fenster": name, "groesse": feld, "ist": ist,
                           "sollLautBauReport": sollwert,
                           "status": "stimmt" if passt else "ABWEICHUNG",
                           "differenz": ist - sollwert})
    return {"status": "alle Anker stimmen" if alle_gleich else "ABWEICHUNG — BEFUND",
            "quelle": os.path.basename(bau_report_pfad), "pruefungen": zeilen}


# -- Markdown fuer Karl -------------------------------------------------------

def zahl(n):
    return "NICHT BERECHENBAR" if n is None else "{:,}".format(n).replace(",", ".")


def fenstername(name):
    """'entdeckung' -> 'Entdeckungsfenster'. Karl liest den Report, nicht den Code."""
    return {"entdeckung": "Entdeckungsfenster",
            "validierung": "Prüffenster"}.get(name, name)


def markdown(daten):
    z = []
    A = z.append
    fenster = daten["jeFenster"]
    spalten = list(fenster)
    A("# E1d — Abdeckungs-Report des Datenpanels")
    A("")
    A("Stand %s. Gelesen wurden **nur** das Entdeckungs- und das Prüffenster." % daten["erstelltAm"][:10])
    A("Das Endtest-Fenster wurde nicht geöffnet, nicht entschlüsselt und nicht gezählt —")
    A("es bleibt bis zum Ende der Studie verschlossen.")
    A("")
    A("*Fachwörter werden bei der ersten Verwendung in einem Halbsatz übersetzt.*")
    A("")
    A("## Kurz gefasst")
    A("")
    for name, f in fenster.items():
        b = f["berichte"]
        t = f["abdeckungstiefe"]["quartaleJeFirma"]
        A("- **%s** (%s bis %s, **%s Quartale breit**): %s Firmen, %s Berichte, "
          "%s Kennzahl-Zeilen. Die typische Firma trägt **%s Berichtsquartale**." % (
              name.capitalize(), f["von"], f["bis"],
              zahl(f["abdeckungstiefe"].get("fensterbreiteQuartale")),
              zahl(b["firmen_gesamt"]), zahl(b["berichte_gesamt"]),
              zahl(f["kennzahlen"]["faktenzeilen"]), zahl(t["median"])))
    A("")
    A("Die beiden Fenster sind **unterschiedlich breit** — das Entdeckungsfenster deckt")
    A("acht Jahre ab, das Prüffenster vier. Tiefen- und Fallzahlen sind zwischen den")
    A("beiden deshalb nicht direkt vergleichbar: im schmaleren Fenster kann keine Firma")
    A("mehr Quartale am Stück haben, als das Fenster breit ist.")
    A("")
    anker = daten["plausibilitaetsanker"]
    A("**Plausibilitätsanker** (Abgleich gegen den Bau-Report des Panel-Laufs): **%s**." % anker["status"])
    A("")
    for p in anker.get("pruefungen", []):
        if "groesse" in p:
            A("- %s / %s: gezählt %s, laut Bau-Report %s → %s" % (
                p["fenster"], p["groesse"], zahl(p["ist"]),
                zahl(p["sollLautBauReport"]), p["status"]))
    A("")

    A("## 1. Firmen je Jahr")
    A("")
    A("Gezählt wird über die **SEC-Firmennummer** (`cik`) — die dauerhafte Kennung einer")
    A("Firma bei der US-Börsenaufsicht, unabhängig von Namensänderungen. Das Jahr ist das")
    A("Jahr der **Veröffentlichung** (`accepted`), also der Moment, ab dem die Zahlen")
    A("öffentlich waren — nicht der Bilanzstichtag. Genau an dieser Grenze sind die drei")
    A("Fenster geschnitten.")
    A("")
    A("| Jahr | Fenster | Firmen | Berichte |")
    A("|---|---|---:|---:|")
    for name, f in fenster.items():
        jahre = f["berichte"]["firmen_je_jahr_veroeffentlichung"]
        berichte = f["berichte"]["berichte_je_jahr_veroeffentlichung"]
        for jahr, firmen in jahre.items():
            A("| %s | %s | %s | %s |" % (jahr, name, zahl(firmen),
                                         zahl(berichte.get(jahr))))
    A("")

    A("## 2. Firmen je Sektor")
    A("")
    A("Die SEC führt die Branche als **SIC-Kennung** — eine vierstellige Zahl aus einem")
    A("amtlichen US-Branchenverzeichnis. Vierstellig ist sie zu fein (über 400 verschiedene")
    A("allein im Prüffenster), deshalb wird auf die **amtlichen SIC-Bereiche** gruppiert.")
    A("Die Gruppierung ist nicht erfunden, sie steht so im Verzeichnis:")
    A("")
    for von, bis, bezeichnung in SIC_DIVISIONEN:
        A("- `%04d`–`%04d` → %s" % (von, bis, bezeichnung))
    A("")
    A("Eine Firma zählt in jedem Bereich, in dem sie einen Bericht abgegeben hat.")
    A("")
    A("| Sektor | %s |" % " | ".join(n.capitalize() for n in spalten))
    A("|---|%s" % ("---:|" * len(spalten)))
    bereiche = []
    for f in fenster.values():
        for d in f["berichte"]["firmen_je_division"]:
            if d not in bereiche:
                bereiche.append(d)
    for bereich in bereiche:
        A("| %s | %s |" % (bereich, " | ".join(
            zahl(fenster[n]["berichte"]["firmen_je_division"].get(bereich, 0))
            for n in spalten)))
    A("")

    A("## 3. Wie tief ist die Abdeckung je Firma?")
    A("")
    A("Gezählt werden **Berichtsquartale**: verschiedene Kalenderquartale, für die eine")
    A("Firma einen periodischen Bericht abgegeben hat (Jahresbericht `10-K`, Quartalsbericht")
    A("`10-Q`, Auslandsberichte `20-F`/`40-F`). Ad-hoc-Meldungen (`8-K`) und Emissions-")
    A("prospekte (`S-1`) zählen hier **nicht** mit — sie tragen keine Berichtsperiode.")
    A("")
    A("Ein **Perzentil** teilt die Firmen der Größe nach: beim 25. Perzentil haben 25 % der")
    A("Firmen weniger Quartale, 75 % mehr. Der Median ist die Mitte.")
    A("")
    A("| Größe | %s |" % " | ".join(n.capitalize() for n in spalten))
    A("|---|%s" % ("---:|" * len(spalten)))
    for schluessel, beschriftung in (
            ("firmen", "Firmen mit mindestens einem periodischen Bericht"),
            ("minimum", "Schlechteste Firma (Quartale)"),
            ("p10", "10. Perzentil"), ("p25", "25. Perzentil"),
            ("median", "Median (typische Firma)"), ("p75", "75. Perzentil"),
            ("p90", "90. Perzentil"), ("maximum", "Beste Firma (Quartale)"),
            ("summeFirmenQuartale", "Summe aller Firmenquartale")):
        A("| %s | %s |" % (beschriftung, " | ".join(
            zahl(fenster[n]["abdeckungstiefe"]["quartaleJeFirma"][schluessel])
            for n in spalten)))
    A("")
    A("Verteilung in Klassen (wie viele Firmen tragen wie viele Quartale):")
    A("")
    A("| Quartale | %s |" % " | ".join(n.capitalize() for n in spalten))
    A("|---|%s" % ("---:|" * len(spalten)))
    for eimer in ("1", "2-3", "4-7", "8-11", "12-19", "20-31", "32+"):
        A("| %s | %s |" % (eimer, " | ".join(
            zahl(fenster[n]["abdeckungstiefe"]["quartaleJeFirma"]["histogramm"].get(eimer, 0))
            for n in spalten)))
    A("")

    A("## 4. Welche Kennzahlen sind wie gut belegt?")
    A("")
    A("Jede Zahl in einem SEC-Bericht trägt eine **Kennzahl-Kennung** (`tag`), zum Beispiel")
    A("`Assets` für die Bilanzsumme. Es gibt zwei Sorten: Kennungen aus der **amtlichen")
    A("Taxonomie** (dem gemeinsamen Vokabular, `us-gaap/2016` und Verwandte) sind zwischen")
    A("Firmen vergleichbar — **firmeneigene Erweiterungen** sind es nicht, denn dort")
    A("erfindet jede Firma ihre eigenen Namen.")
    A("")
    A("| Größe | %s |" % " | ".join(n.capitalize() for n in spalten))
    A("|---|%s" % ("---:|" * len(spalten)))
    for schluessel, beschriftung in (
            ("faktenzeilen", "Kennzahl-Zeilen gesamt"),
            ("zeilenStandard", "davon amtliche Taxonomie"),
            ("zeilenFirmeneigen", "davon firmeneigene Erweiterung"),
            ("kennzahlenStandard", "verschiedene amtliche Kennungen"),
            ("kennzahlenFirmeneigen", "verschiedene firmeneigene Kennungen"),
            ("nennerPeriodischeBerichte", "Nenner: periodische Berichte")):
        A("| %s | %s |" % (beschriftung, " | ".join(
            zahl(fenster[n]["kennzahlen"][schluessel]) for n in spalten)))
    A("")
    A("Wie sich die %d häufigsten amtlichen Kennungen auf die periodischen Berichte"
      % TOP_KENNZAHLEN)
    A("verteilen — „Belegung“ heißt: die Kennung kommt im Bericht überhaupt vor:")
    A("")
    A("| Belegung | %s |" % " | ".join(n.capitalize() for n in spalten))
    A("|---|%s" % ("---:|" * len(spalten)))
    for schluessel, beschriftung in (
            ("ueber90Prozent", "Kennungen in ≥ 90 % der Berichte"),
            ("ueber50Prozent", "Kennungen in ≥ 50 % der Berichte"),
            ("unter10Prozent", "Kennungen in < 10 % der Berichte"),
            ("median", "Median der Belegungsquote (%)")):
        A("| %s | %s |" % (beschriftung, " | ".join(
            str(fenster[n]["kennzahlen"]["belegungVerteilungTop"][schluessel])
            for n in spalten)))
    A("")
    A("Die Kennzahlen, an denen diese Studie hängt — Anteil der **periodischen** Berichte,")
    A("in denen die Kennung überhaupt vorkommt:")
    A("")
    A("| Kennzahl | Kennung | %s |" % " | ".join(n.capitalize() + " %" for n in spalten))
    A("|---|---|%s" % ("---:|" * len(spalten)))
    erste = fenster[spalten[0]]
    for eintrag in erste["kennzahlen"]["pflichtKennzahlen"]:
        werte = []
        for n in spalten:
            treffer = next(e for e in fenster[n]["kennzahlen"]["pflichtKennzahlen"]
                           if e["tag"] == eintrag["tag"])
            werte.append("%.1f" % treffer["anteilPeriodischProzent"])
        A("| %s | `%s` | %s |" % (eintrag["bezeichnung"], eintrag["tag"], " | ".join(werte)))
    A("")

    A("## 5. Wo sind die Löcher?")
    A("")
    A("Das ist der wichtigste Abschnitt: eine Auswertung, die auf einem dieser Löcher")
    A("aufbaut, misst nicht Verhalten, sondern eine Lücke in den Daten.")
    A("")
    if not daten["loecher"]:
        A("Keine Auffälligkeit oberhalb der gesetzten Schwellen gefunden.")
    else:
        nach_art = {}
        for loch in daten["loecher"]:
            nach_art.setdefault(loch["art"], []).append(loch)
        for art, liste in nach_art.items():
            A("### %s (%d)" % (art, len(liste)))
            A("")
            for loch in liste:
                A("- %s" % loch["text"])
            A("")

    A("## 6. Fallzahl-Vorschau")
    A("")
    A("Wie viel bleibt übrig, wenn man eine **Mindesttiefe am Stück** verlangt — also")
    A("ununterbrochene Quartale ohne Lücke? Eine Lücke von einem Quartal zerreißt die")
    A("Kette; die Spalte „Quartale“ zählt nur die Quartale, die wirklich in einer solchen")
    A("Kette liegen. Die Studie braucht nach Regel R15a mindestens **200 reife Ereignisse**.")
    A("")
    A("| Mindesttiefe | %s |" % " | ".join(
        "%s: Firmen | %s: Quartale" % (n.capitalize(), n.capitalize()) for n in spalten))
    A("|---|%s" % ("---:|" * (2 * len(spalten))))
    for i, k in enumerate(MINDESTTIEFEN):
        felder = []
        gedeckelt = False
        for n in spalten:
            v = fenster[n]["abdeckungstiefe"]["fallzahlVorschau"][i]
            marke = " ⚠" if v.get("strukturellGedeckelt") else ""
            gedeckelt = gedeckelt or v.get("strukturellGedeckelt")
            felder.append(zahl(v["firmen"]) + marke)
            felder.append(zahl(v["firmenQuartaleInKetten"]))
        A("| %d %s | %s |" % (k, "Quartal" if k == 1 else "Quartale", " | ".join(felder)))
    A("")
    A("⚠ = die geforderte Tiefe erreicht oder überschreitet die Breite des Fensters.")
    A("Die kleine Zahl dort ist Arithmetik, kein Datenmangel: in ein vier Jahre breites")
    A("Fenster passen keine zwanzig Quartale am Stück.")
    A("")

    A("## Was nicht berechenbar war (Regel R5)")
    A("")
    A("Fehlt ein Pflichtfeld, wird die Zeile gezählt und benannt — nie geschätzt.")
    A("")
    A("| Fall | %s |" % " | ".join(n.capitalize() for n in spalten))
    A("|---|%s" % ("---:|" * len(spalten)))
    for schluessel, beschriftung in (
            ("accepted_fehlt", "Bericht ohne Veröffentlichungszeitpunkt"),
            ("period_unlesbar", "Periodischer Bericht ohne lesbaren Bilanzstichtag"),
            ("sic_fehlt_oder_unlesbar", "Bericht ohne brauchbare Branchenkennung"),
            ("cik_fehlt", "Bericht ohne Firmennummer")):
        A("| %s | %s |" % (beschriftung, " | ".join(
            zahl(fenster[n]["berichte"]["nicht_berechenbar"][schluessel])
            for n in spalten)))
    A("")
    A("## Neue Fragen und Hypothesen (Pflichtblock nach R16)")
    A("")
    for frage in daten["neueFragen"]:
        A("- %s" % frage)
    A("")
    return "\n".join(z) + "\n"


def neue_fragen(daten):
    fragen = []
    kipper = [l for l in daten["loecher"]
              if l["art"] == "Kennzahl kippt zwischen den Fenstern"]
    if kipper:
        fragen.append(
            "%d Pflicht-Kennzahlen wechseln zwischen Entdeckungs- und Prüffenster stark "
            "die Belegung. Zu klären, bevor irgendeine Größe über beide Fenster gerechnet "
            "wird: Braucht die Studie eine zusammengesetzte Umsatz-Größe, die die alten "
            "und die neuen Kennungen zu einer Reihe verbindet? (Zeitschätzung: 1 Tag)"
            % len(kipper))
    fragen.append(
        "Die Abdeckungstiefe misst Berichtsquartale, nicht Zahlen-Vollständigkeit: eine "
        "Firma kann 20 Quartale abgeben und in der Hälfte davon keinen Umsatz ausweisen. "
        "Offen: eine Tiefen-Zahl auf Kennzahl-Ebene (Quartale mit belegtem Umsatz je "
        "Firma) statt auf Berichts-Ebene. (Zeitschätzung: 1 Tag)")
    fragen.append(
        "Firmeneigene Kennungen tragen einen messbaren Teil der Zeilen, sind aber zwischen "
        "Firmen nicht vergleichbar. Offen: Wie viel Substanz geht verloren, wenn die Studie "
        "sie ignoriert — betrifft es Randgrößen oder Kern-Positionen? (Zeitschätzung: 2 Tage)")
    fragen.append(
        "Die Fenstergrenzen laufen am Veröffentlichungszeitpunkt, die Berichtsperioden "
        "reichen darüber hinaus. Offen: Wie vielen Firmen zerreißt die Fenstergrenze die "
        "Kette, und verzerrt das die Fallzahl? (Zeitschätzung: 1 Tag)")
    return fragen


# -- Selbsttest ---------------------------------------------------------------

def _mini_panel(pfad):
    """Eine winzige Datenbank mit genau der Form des echten Panels — von Hand
    nachrechenbar. Das echte Panel wird zum Testen NIE gebraucht."""
    if os.path.exists(pfad):
        os.remove(pfad)
    con = sqlite3.connect(pfad)
    con.executescript(
        "CREATE TABLE bericht (adsh TEXT PRIMARY KEY, cik TEXT, name TEXT, sic TEXT,"
        " form TEXT, period TEXT, accepted TEXT);"
        "CREATE TABLE fakt (adsh TEXT, tag TEXT, version TEXT, coreg TEXT, ddate TEXT,"
        " qtrs TEXT, uom TEXT, value REAL, footnote TEXT);")
    # Firma 10: vier Quartale am Stueck (2013q1..q4), Verarbeitendes Gewerbe (3674).
    # Firma 20: zwei Quartale mit Luecke (2013q1, 2013q3), Dienstleistung (7372).
    # Firma 30: ein Quartal, Branchenkennung fehlt.
    # Firma 40: nur eine Ad-hoc-Meldung (8-K) — zaehlt bei den Firmen je Jahr mit,
    #           aber NICHT bei der Abdeckungstiefe.
    # Firma 50: periodischer Bericht mit kaputtem Bilanzstichtag (R5-Fall).
    berichte = [
        ("a1", "10", "Alpha", "3674", "10-Q", "20130331", "2013-05-01 10:00:00.0"),
        ("a2", "10", "Alpha", "3674", "10-Q", "20130630", "2013-08-01 10:00:00.0"),
        ("a3", "10", "Alpha", "3674", "10-Q", "20130930", "2013-11-01 10:00:00.0"),
        ("a4", "10", "Alpha", "3674", "10-K", "20131231", "2014-03-01 10:00:00.0"),
        ("b1", "20", "Beta", "7372", "10-Q", "20130331", "2013-05-02 10:00:00.0"),
        ("b2", "20", "Beta", "7372", "10-Q", "20130930", "2013-11-02 10:00:00.0"),
        ("c1", "30", "Gamma", "", "10-K", "20131231", "2014-03-02 10:00:00.0"),
        ("d1", "40", "Delta", "3674", "8-K", "", "2013-06-01 10:00:00.0"),
        ("e1", "50", "Epsilon", "3674", "10-K", "kaputt", "2014-03-03 10:00:00.0"),
    ]
    con.executemany("INSERT INTO bericht VALUES(?,?,?,?,?,?,?)", berichte)
    # Assets in 4 der 9 Berichte (alle periodisch), Revenues in 2, dazu eine
    # firmeneigene Kennung mit 2 Zeilen.
    fakten = (
        [("a1", "Assets", "us-gaap/2013", "", "20130331", "0", "USD", 1.0, "")] * 3 +
        [("a2", "Assets", "us-gaap/2013", "", "20130630", "0", "USD", 2.0, "")] +
        [("b1", "Assets", "us-gaap/2013", "", "20130331", "0", "USD", 3.0, "")] +
        [("c1", "Assets", "us-gaap/2013", "", "20131231", "0", "USD", 4.0, "")] +
        [("a1", "Revenues", "us-gaap/2013", "", "20130331", "1", "USD", 5.0, "")] +
        [("b1", "Revenues", "us-gaap/2013", "", "20130331", "1", "USD", 6.0, "")] +
        [("a1", "MeineEigeneKennzahl", "a1", "", "20130331", "0", "USD", 7.0, "")] * 2
    )
    con.executemany("INSERT INTO fakt VALUES(?,?,?,?,?,?,?,?,?)", fakten)
    con.commit()
    con.close()
    return len(berichte), len(fakten)


def _behaupte(bedingung, text):
    if not bedingung:
        raise SystemExit("SELBSTTEST ROT: " + text)


def selbsttest():
    import tempfile
    verzeichnis = tempfile.mkdtemp(prefix="e1d-selbsttest-")
    pfad = os.path.join(verzeichnis, "panel-entdeckung.sqlite")
    n_berichte, n_fakten = _mini_panel(pfad)
    con = oeffne_nur_lesend(pfad)
    f = werte_fenster_aus(con, "entdeckung")
    b = f["berichte"]
    t = f["abdeckungstiefe"]

    # --- Pruefung 1: Firmen je Jahr (Veroeffentlichungsjahr) -----------------
    # Von Hand: 2013 bringt a1,a2,a3 (Firma 10), b1,b2 (20), d1 (40) -> 3 Firmen,
    #           6 Berichte. 2014 bringt a4 (10), c1 (30), e1 (50) -> 3 Firmen, 3 Berichte.
    _behaupte(b["firmen_je_jahr_veroeffentlichung"] == {"2013": 3, "2014": 3},
              "Firmen je Jahr: %s statt {'2013': 3, '2014': 3}"
              % b["firmen_je_jahr_veroeffentlichung"])
    _behaupte(b["berichte_je_jahr_veroeffentlichung"] == {"2013": 6, "2014": 3},
              "Berichte je Jahr: %s statt {'2013': 6, '2014': 3}"
              % b["berichte_je_jahr_veroeffentlichung"])
    print("  [1] Firmen je Jahr: 2013 -> 3 Firmen / 6 Berichte, 2014 -> 3 / 3.")

    # --- Pruefung 2: Sektor-Gruppierung --------------------------------------
    # 3674 und 7372 sind zwei verschiedene amtliche Bereiche; Firma 30 hat keine
    # Kennung und darf in KEINEM Bereich auftauchen.
    _behaupte(sic_division("3674") == "Verarbeitendes Gewerbe",
              "SIC 3674 landet in '%s'" % sic_division("3674"))
    _behaupte(sic_division("7372") == "Dienstleistungen",
              "SIC 7372 landet in '%s'" % sic_division("7372"))
    _behaupte(sic_division("") is None and sic_division("abc") is None,
              "Eine leere oder unlesbare Branchenkennung ergibt keinen Bereich.")
    _behaupte(b["firmen_je_division"] == {"Verarbeitendes Gewerbe": 3,
                                          "Dienstleistungen": 1},
              "Firmen je Bereich: %s statt {Verarb.: 3, Dienstl.: 1}"
              % b["firmen_je_division"])
    _behaupte(b["nicht_berechenbar"]["sic_fehlt_oder_unlesbar"] == 1,
              "Der Bericht ohne Branchenkennung wird nicht als solcher gezaehlt.")
    print("  [2] Sektoren: Verarbeitendes Gewerbe 3, Dienstleistungen 1, "
          "1 Bericht ohne Kennung gezaehlt.")

    # --- Pruefung 3: Abdeckungstiefe -----------------------------------------
    # Firma 10 -> 4 Quartale, Firma 20 -> 2, Firma 30 -> 1. Firma 40 (nur 8-K)
    # und Firma 50 (kaputter Stichtag) tauchen hier NICHT auf.
    q = t["quartaleJeFirma"]
    _behaupte(q["firmen"] == 3, "Firmen mit Berichtsquartalen: %s statt 3" % q["firmen"])
    _behaupte((q["minimum"], q["median"], q["maximum"]) == (1, 2, 4),
              "Tiefen-Verteilung: min/median/max = %s statt (1, 2, 4)"
              % ((q["minimum"], q["median"], q["maximum"]),))
    _behaupte(q["summeFirmenQuartale"] == 7,
              "Summe Firmenquartale: %s statt 7" % q["summeFirmenQuartale"])
    _behaupte(b["nicht_berechenbar"]["period_unlesbar"] == 1,
              "Der periodische Bericht mit kaputtem Stichtag wird nicht gezaehlt.")
    _behaupte(b["berichte_periodisch"] == 8 and b["berichte_gesamt"] == n_berichte,
              "Periodische Berichte: %s von %s statt 8 von %s"
              % (b["berichte_periodisch"], b["berichte_gesamt"], n_berichte))
    print("  [3] Tiefe: 3 Firmen, min 1 / Median 2 / max 4 Quartale, Summe 7. "
          "8-K-Firma und kaputter Stichtag sind ausgeschlossen.")

    # --- Pruefung 4: Ketten und Fallzahl -------------------------------------
    # Firma 10 hat 4 am Stueck, Firma 20 hat wegen der Luecke nur 1, Firma 30 hat 1.
    _behaupte(laengste_kette([1, 2, 3, 4]) == 4,
              "4 aufeinanderfolgende Quartale sind eine Kette von 4.")
    _behaupte(laengste_kette([1, 3]) == 1, "Eine Luecke zerreisst die Kette.")
    _behaupte(laengste_kette([]) == 0, "Keine Quartale sind eine Kette von 0.")
    v = dict((e["mindesttiefeQuartaleAmStueck"], e) for e in t["fallzahlVorschau"])
    _behaupte(v[1]["firmen"] == 3, "Mindesttiefe 1: %s Firmen statt 3" % v[1]["firmen"])
    _behaupte(v[4]["firmen"] == 1, "Mindesttiefe 4: %s Firmen statt 1" % v[4]["firmen"])
    _behaupte(v[4]["firmenQuartaleInKetten"] == 4,
              "Mindesttiefe 4: %s Quartale in Ketten statt 4"
              % v[4]["firmenQuartaleInKetten"])
    _behaupte(v[8]["firmen"] == 0, "Mindesttiefe 8: %s Firmen statt 0" % v[8]["firmen"])
    print("  [4] Fallzahl: bei 1 Quartal 3 Firmen, bei 4 am Stueck 1 Firma "
          "(4 Quartale), bei 8 keine.")

    # --- Pruefung 5: Kennzahl-Belegung ---------------------------------------
    # Assets steht in 4 der 9 Berichte = 44,44 %, und in 4 der 8 periodischen
    # Berichte = 50,00 %. Der Nenner entscheidet — deshalb werden beide geprueft.
    # Die firmeneigene Kennung zaehlt NICHT als amtliche Kennzahl.
    k = f["kennzahlen"]
    _behaupte(k["faktenzeilen"] == n_fakten,
              "Faktenzeilen: %s statt %s" % (k["faktenzeilen"], n_fakten))
    _behaupte(k["kennzahlenStandard"] == 2,
              "Amtliche Kennungen: %s statt 2" % k["kennzahlenStandard"])
    _behaupte(k["kennzahlenFirmeneigen"] == 1 and k["zeilenFirmeneigen"] == 2,
              "Firmeneigene Kennungen: %s Namen / %s Zeilen statt 1 / 2"
              % (k["kennzahlenFirmeneigen"], k["zeilenFirmeneigen"]))
    quoten = dict((e["tag"], e) for e in k["haeufigsteKennzahlen"])
    _behaupte(quoten["Assets"]["berichte"] == 4 and quoten["Assets"]["zeilen"] == 6,
              "Assets: %s Berichte / %s Zeilen statt 4 / 6"
              % (quoten["Assets"]["berichte"], quoten["Assets"]["zeilen"]))
    _behaupte(abs(quoten["Assets"]["anteilProzent"] - 44.44) < 0.01,
              "Assets-Anteil an ALLEN Berichten: %s statt 44.44"
              % quoten["Assets"]["anteilProzent"])
    _behaupte(abs(quoten["Assets"]["anteilPeriodischProzent"] - 50.0) < 0.01,
              "Assets-Anteil an den PERIODISCHEN Berichten: %s statt 50.0"
              % quoten["Assets"]["anteilPeriodischProzent"])
    _behaupte(quoten["Revenues"]["berichte"] == 2,
              "Revenues: %s Berichte statt 2" % quoten["Revenues"]["berichte"])
    print("  [5] Kennzahlen: Assets in 4 von 9 Berichten (44,44 %) bzw. 4 von 8 "
          "periodischen (50,00 %) bei 6 Zeilen; firmeneigene Kennung getrennt.")

    # --- Pruefung 6: die Fenster-Mauer ---------------------------------------
    # Der Kern der Studienmethodik: der Endtest darf nicht einmal versehentlich
    # zu oeffnen sein.
    for verboten in ("panel-endtest.sqlite.enc", "panel-endtest.sqlite",
                     os.path.join("schluessel", "endtest.key"),
                     os.path.join("endtest", "panel-entdeckung.sqlite")):
        try:
            oeffne_nur_lesend(os.path.join(verzeichnis, verboten))
        except AbdeckungsFehler as fehler:
            _behaupte("R2-ABBRUCH" in str(fehler),
                      "'%s' bricht ab, aber nicht an der Fenster-Mauer." % verboten)
        else:
            raise SystemExit(
                "SELBSTTEST ROT: '%s' laesst sich oeffnen — die Fenster-Mauer haelt nicht."
                % verboten)
    # Gegenprobe: die erlaubte Datei MUSS durchgehen, sonst prueft die Mauer nichts.
    oeffne_nur_lesend(pfad).close()
    print("  [6] Fenster-Mauer: 4 Endtest-/Schluesselpfade abgewiesen, "
          "das Entdeckungsfenster geht durch.")

    # --- Pruefung 7: der Plausibilitaetsanker meldet Abweichungen ------------
    # Ein Anker, der Abweichungen schluckt, ist kein Anker.
    anker_pfad = os.path.join(verzeichnis, "bau.json")
    with open(anker_pfad, "w", encoding="utf-8") as fh:
        json.dump({"jeFenster": {"entdeckung": {"berichte": n_berichte,
                                                "fakten": n_fakten}}}, fh)
    gut = pruefe_anker({"entdeckung": f}, anker_pfad)
    _behaupte(gut["status"] == "alle Anker stimmen",
              "Passende Zahlen melden '%s'" % gut["status"])
    with open(anker_pfad, "w", encoding="utf-8") as fh:
        json.dump({"jeFenster": {"entdeckung": {"berichte": n_berichte + 1,
                                                "fakten": n_fakten}}}, fh)
    schlecht = pruefe_anker({"entdeckung": f}, anker_pfad)
    _behaupte(schlecht["status"] == "ABWEICHUNG — BEFUND",
              "Eine Abweichung von 1 Bericht meldet '%s' statt eines Befunds"
              % schlecht["status"])
    _behaupte(any(p.get("differenz") == -1 for p in schlecht["pruefungen"]),
              "Die Abweichung wird nicht beziffert.")
    fehlt = pruefe_anker({"entdeckung": f}, os.path.join(verzeichnis, "gibtsnicht.json"))
    _behaupte(fehlt["status"] == "NICHT BERECHENBAR",
              "Ein fehlender Bau-Report meldet '%s' statt NICHT BERECHENBAR (R5)"
              % fehlt["status"])
    print("  [7] Plausibilitaetsanker: passend -> gruen, um 1 daneben -> BEFUND "
          "mit Differenz, Report fehlt -> NICHT BERECHENBAR.")

    # --- Pruefung 8: die Fensterbreite deckelt die Fallzahl ------------------
    # 2017-01-01..2020-12-31 sind 16 Quartale; 2009-01-01..2016-12-31 sind 32.
    # Wer das nicht ausweist, laesst eine arithmetische Grenze wie einen
    # Datenmangel aussehen — genau die Fehllesung, die eine Studie kippt.
    _behaupte(fensterbreite_quartale("2017-01-01", "2020-12-31") == 16,
              "Fensterbreite 2017-2020: %s statt 16"
              % fensterbreite_quartale("2017-01-01", "2020-12-31"))
    _behaupte(fensterbreite_quartale("2009-01-01", "2016-12-31") == 32,
              "Fensterbreite 2009-2016: %s statt 32"
              % fensterbreite_quartale("2009-01-01", "2016-12-31"))
    schmal = tiefe_und_fallzahl({"10": {1, 2, 3, 4}}, fensterbreite=6)
    marken = dict((e["mindesttiefeQuartaleAmStueck"], e["strukturellGedeckelt"])
                  for e in schmal["fallzahlVorschau"])
    _behaupte(marken[4] is False, "Mindesttiefe 4 passt in ein 6 Quartale breites Fenster.")
    _behaupte(marken[6] is True and marken[8] is True,
              "Mindesttiefe 6 und 8 passen NICHT in ein 6 Quartale breites Fenster, "
              "werden aber nicht markiert: %s" % marken)
    _behaupte(schmal["fensterbreiteQuartale"] == 6,
              "Die Fensterbreite steht nicht im Ergebnis.")
    print("  [8] Fensterbreite: 2017-2020 = 16 Quartale, 2009-2016 = 32; "
          "in einem 6er-Fenster sind Mindesttiefen ab 6 als gedeckelt markiert.")

    # --- Pruefung 9: ein Formularmix-Bruch wird gefunden ---------------------
    # Nachgebaut nach dem echten Fall: 8-K liegt drei Jahre bei ~200 und springt
    # dann auf 35 000. Der Median der vier Jahre ist 200 -> Faktor 175.
    gebaut = {
        "pruef": {
            "berichte": {
                "formen_je_jahr": {"8-K": {"2017": 100, "2018": 200,
                                           "2019": 200, "2020": 35000},
                                   "10-Q": {"2017": 19012, "2018": 18395,
                                            "2019": 17807, "2020": 17287}},
                "firmen_je_jahr_veroeffentlichung": {}, "firmen_je_division": {},
            },
            "abdeckungstiefe": {"fensterbreiteQuartale": 16, "fallzahlVorschau": []},
        }
    }
    brueche = [l for l in finde_loecher(gebaut) if l["art"] == "Formularmix bricht in einem Jahr"]
    _behaupte(len(brueche) == 1,
              "Genau ein Formularmix-Bruch erwartet, gefunden: %d" % len(brueche))
    _behaupte(brueche[0]["stelle"] == "8-K 2020",
              "Der Bruch wird bei '%s' gemeldet statt bei '8-K 2020'." % brueche[0]["stelle"])
    _behaupte(brueche[0]["vergleich"] == 200,
              "Vergleichswert %s statt 200" % brueche[0]["vergleich"])
    # Gegenprobe: die gleichmaessige Reihe 10-Q darf NICHT als Bruch gelten,
    # sonst meldet der Pruefer alles und damit nichts.
    _behaupte(all("10-Q" not in l["stelle"] for l in brueche),
              "Die gleichmaessige 10-Q-Reihe wird faelschlich als Bruch gemeldet.")
    print("  [9] Formularmix: der 8-K-Sprung 2020 (200 -> 35.000, Faktor 175) wird "
          "gemeldet, die gleichmaessige 10-Q-Reihe nicht.")

    con.close()
    for datei in os.listdir(verzeichnis):
        os.remove(os.path.join(verzeichnis, datei))
    os.rmdir(verzeichnis)
    print("Selbsttest gruen (9 Pruefungen).")


# -- Hauptlauf ----------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-root")
    ap.add_argument("--selbsttest", action="store_true")
    ap.add_argument("--bericht", action="store_true")
    ap.add_argument("--ziel", default=os.path.join("reports", "studie",
                                                   "E1-abdeckung-2026-08-19"))
    ap.add_argument("--bau-report", default=os.path.join(
        "reports", "studie", "E1-panel-bau-2026-08-19.json"))
    args = ap.parse_args()

    if args.selbsttest:
        print("Selbsttest an einer winzigen selbstgebauten Datenbank:")
        selbsttest()
        if not args.bericht:
            return 0

    if not args.bericht:
        ap.error("Nichts zu tun: --selbsttest und/oder --bericht angeben.")

    panel = os.path.join(datenwurzel(args.data_root), "panel")
    je_fenster = {}
    for name, datei, von, bis in ERLAUBTE_FENSTER:
        con = oeffne_nur_lesend(os.path.join(panel, datei))
        try:
            f = werte_fenster_aus(con, name, fensterbreite_quartale(von, bis),
                                  fortschritt=lambda s: print(s, flush=True))
        finally:
            con.close()
        f["von"], f["bis"], f["datei"] = von, bis, datei
        je_fenster[name] = f

    daten = {
        "schema": "early-detection-abdeckung-panel/v1",
        "etappe": "E1d",
        "erstelltAm": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "gelesen": [d for _n, d, _v, _b in ERLAUBTE_FENSTER],
        "nichtGeoeffnet": "panel-endtest.sqlite.enc (versiegelt, R2/R4) und das "
                          "Schluesselmaterial — von diesem Lauf weder geoeffnet noch "
                          "entschluesselt noch gezaehlt.",
        "jeFenster": je_fenster,
    }
    daten["loecher"] = finde_loecher(je_fenster)
    daten["plausibilitaetsanker"] = pruefe_anker(je_fenster, args.bau_report)
    daten["neueFragen"] = neue_fragen(daten)

    json_pfad, md_pfad = args.ziel + ".json", args.ziel + ".md"
    os.makedirs(os.path.dirname(os.path.abspath(json_pfad)), exist_ok=True)
    with open(json_pfad, "w", encoding="utf-8") as fh:
        json.dump(daten, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    with open(md_pfad, "w", encoding="utf-8") as fh:
        fh.write(markdown(daten))

    print("")
    print("Geschrieben:")
    for p in (json_pfad, md_pfad):
        groesse = os.path.getsize(p)
        print("  %s (%.1f KB)%s" % (
            p, groesse / 1024.0,
            "  ACHTUNG: ueber dem 200-KB-Deckel R14a" if groesse > 200 * 1024 else ""))
    print("Plausibilitaetsanker: %s" % daten["plausibilitaetsanker"]["status"])
    print("Loecher gefunden: %d" % len(daten["loecher"]))
    if daten["plausibilitaetsanker"]["status"].startswith("ABWEICHUNG"):
        print("BEFUND: die Zaehlung weicht vom Bau-Report ab — siehe Report, "
              "nicht die Rechnung anpassen.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
