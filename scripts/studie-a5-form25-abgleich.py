#!/usr/bin/env python
"""A.5-Annex - Abgleich der echten Abgaenge gegen die lokale Form-25-Evidenz.

DIE FRAGE: E4g hat je Arm die Firmen isoliert, die nach ihrem Signal GAR KEINE
Zeile mehr einreichen - 8 im S-G-Signalarm, 172 im Kontrollpool. Taucht fuer
diese Firmen in der lokal geernteten Form-25-Evidenz ein Eintrag in einem
plausiblen Fenster auf?

FORM 25 IST KEIN TODESBELEG. Das steht so im gehashten Register-Eintragstext und
ist die wichtigste Zeile dieser Datei. Der bekannte Gegenbeleg (25-NSE bei
lebender Firma) gilt unveraendert: Form 25 meldet das Delisting eines
Wertpapiers von einer Boerse, nicht das Ende einer Firma. Dieser Lauf liefert
EREIGNIS-Evidenz, keine ZUSTANDS-Aussage, und darf nicht als
Abgangs-Bestaetigung gelesen werden. Wer aus `mit_form25_treffer` "so viele sind
gestorben" macht, liest das Gegenteil dessen, was hier gemessen wurde.

ZWEI QUELLEN, BEIDE LOKAL, KEIN NETZZUGRIFF:
  (1) die Panel-Datei des durch R15a verbrauchten Prueffensters - Input-Scope
      woertlich der committeten E4a-Registrierung und des E4g-v2-Eintrags;
  (2) der bereits lokal geerntete Form-25-Evidenz-Cache, Union 2016-2024 mit
      9.028 Accessions (d2-nachernte-2026-08-30.jsonl + d2-2016-2018-2026-08-30.
      jsonl), erzeugt durch den lokalen submissions.zip-Re-Harvest OHNE Netz.
Der Cache ist ein LOKALER Bestand, keine neue externe Quelle und kein Fetch.

DAS PLAUSIBLE FENSTER IST KEIN NEUER KNOPF. Es laeuft vom Melde-Zeitpunkt des
Signals ueber REIFE_QUARTALE * FISKALQUARTAL_TAGE Tage - also genau ueber jenes
Fenster, in dem die vier fehlenden Folgequartale haetten liegen muessen. Beide
Groessen sind eingefroren uebernommen (studie-basisraten.py::REIFE_QUARTALE,
studie-e4g-restursachen.py::FISKALQUARTAL_TAGE); hier wird keine dritte Zahl
erfunden. Treffer AUSSERHALB des Fensters werden AUSGEWIESEN, nie gefiltert -
dieselbe Disziplin wie im D2-Bericht.

DER BINDENDE SELBST-CHECK MIT BIT-ANKER (im Eintragstext gehasht): Die
Rekonstruktion der Abgangs-Population MUSS exakt 8 Firmen im S-G-Signal-Arm und
172 im Kontrollpool ergeben (committete E4g-Aggregate,
reports/studie/E4g-restursachen-diagnose-2026-08-29.json,
letzte_form_nach_signal 'keine'). JEDE Abweichung ist ein SOFORT-STOPP mit
Eskalation - kein Weiterrechnen, keine Anpassung an die Sollzahl, keine zweite
Variante. Genau das tut ANKER_ABBRUCH weiter unten.

EXPLORATIV - NIEMALS KONFIRMATORISCH. Beschreibender ANNEX zum R15a-Abschluss,
ausdruecklich NICHT dessen Bedingung (ENTSCHIED 38). Kein Verdikt, keine
Schwelle, keine Praeregistrierung. Pflicht-Stempel auf jeder Ausgabe. Das
Endtest-Fenster bleibt versiegelt. Kurs-/Rendite-/Preis-Endpunkte sind per R4
dauerhaft ausgeschlossen und werden weder berechnet noch ausgegeben.

WOHER DER CODE KOMMT: Population, Signaldefinition und Formularregime werden aus
scripts/studie-e4g-restursachen.py IMPORTIERT, nicht nachgebaut. Genau deshalb
kann der Bit-Anker ueberhaupt treffen - ein Nachbau haette die Population
auseinanderlaufen lassen.

Aufruf:
  python scripts/studie-a5-form25-abgleich.py --selbsttest
  python scripts/studie-a5-form25-abgleich.py --allowlist-ausgeben
  python scripts/studie-a5-form25-abgleich.py --freigabe <freigabe.json> --ziel <report.json>
"""

import argparse
import importlib.util
import json
import os
import platform
import sqlite3
import sys
from collections import defaultdict

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E4G_SKRIPT = os.path.join(WURZEL, "scripts", "studie-e4g-restursachen.py")

SCHEMA = "early-detection-a5-form25-abgleich/v1"
FENSTER_NAME = "pruefung"
VARIANTE = "S-G"
BAND = (2017, 2019)

# Der Form-25-Evidenz-Cache. Die beiden Dateien tragen zusammen die im
# Register-Eintrag benannte Union 2016-2024 mit 9.028 Accessions - je eine Zeile
# je Accession. Der Pfad kommt aus der Umgebung bzw. dem Aufruf; ein fest
# verdrahteter Pfad waere ein R12a-Bruch.
CACHE_ENV = "SEC_XBRL_CACHE"
CACHE_UNTERORDNER = ("submissions-bulk",)
CACHE_DATEIEN = ("d2-nachernte-2026-08-30.jsonl", "d2-2016-2018-2026-08-30.jsonl")
CACHE_SOLL_ACCESSIONS = 9028

STEMPEL = ("bekannte Ueberlebens-Verzerrung, Obergrenzen-Lesart: die fehlenden "
           "10,7 % sind nicht zufaellig, Verlierer verschwinden oefter - jede "
           "hier berichtete Rate ist eine OBERGRENZE, keine Punktschaetzung")

KEINE_LABEL_SEMANTIK = (
    "Form 25 ist KEIN Todesbeleg. Der Gegenbeleg 25-NSE bei lebender Firma gilt "
    "unveraendert; dieser Lauf liefert EREIGNIS-Evidenz, keine Zustands-Aussage, "
    "und darf nicht als Abgangs-Bestaetigung gelesen werden.")

# ── Die Ausgabe-Allowlist ────────────────────────────────────────────────────
# EXAKT die 11 Felder, die der Register-Eintrag a5-form25-abgleich-2026-08-30
# unter `allowedOutputs` fuehrt. Die Gleichheit wird in
# pruefe_anmeldung_deckt_ausgabe() in BEIDE Richtungen geprueft. Alle 11 sind
# Firmen-ZAHLEN, ein Tages-Fenster oder eine daraus gebildete Quote - keine
# Kennung, keine CIK, keine Accession-Nummer, kein Rohwert.
DATEN_FELDER = (
    "abgaenge_gesamt",
    "abgaenge_kontrollpool",
    "abgaenge_signal_arm",
    "ausserhalb_plausiblem_fenster",
    "fallzahl",
    "mit_form25_treffer",
    "nenner_form25_abgleich",
    "ohne_form25_treffer",
    "plausibles_fenster_tage",
    "trefferquote_form25",
    "unentscheidbar_gesamt",
)

# Zaehler je Arm und je Jahr.
BLOCK_ZAEHLER = ("ausserhalb_plausiblem_fenster", "fallzahl",
                 "mit_form25_treffer", "nenner_form25_abgleich",
                 "ohne_form25_treffer", "unentscheidbar_gesamt")
BLOCK_RATEN = ("trefferquote_form25",)
JAHR_BLOCK = tuple(sorted(BLOCK_ZAEHLER + BLOCK_RATEN))
ARM_BLOCK = tuple(sorted(JAHR_BLOCK + ("jahre",)))
ARME = ("kontrolle", "signal")

OBEN_ZAEHLER = ("abgaenge_gesamt", "abgaenge_kontrollpool", "abgaenge_signal_arm",
                "plausibles_fenster_tage")

UMSCHLAG_ALLOWLIST = (
    "abgaenge_gesamt", "abgaenge_kontrollpool", "abgaenge_signal_arm",
    "accessedAt", "arme", "beendetAm", "ergebnisdatenBeruehrt", "ersterZugriffAm",
    "evidenzCache", "fenster", "fensterRegel", "gelesenePfade",
    "geschriebenePfade", "keineLabelSemantik", "lesart", "manifestGeprueft",
    "panelRand", "perzentil", "plausibles_fenster_tage", "protokoll", "runId",
    "schema", "selbstCheck", "serverConfirmedAt", "siegelWache", "umgebung",
    "variante",
)

# DER BIT-ANKER. Committete E4g-Aggregate, letzte_form_nach_signal == "keine".
ANKER = {"signal": 8, "kontrolle": 172}
ANKER_QUELLE = "reports/studie/E4g-restursachen-diagnose-2026-08-29.json"


class AbgleichsFehler(Exception):
    """Ein Befund, der den Lauf anhaelt - nie ein stiller Rueckfall."""


def lade(pfad, name):
    spec = importlib.util.spec_from_file_location(name, pfad)
    if spec is None or spec.loader is None:
        raise AbgleichsFehler("Skript nicht ladbar: " + pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


e4g = lade(E4G_SKRIPT, "studie_e4g_restursachen")
e4a = e4g.e4a
zp = e4g.zp

# Das plausible Fenster: vier Fiskalquartale, beide Faktoren eingefroren
# uebernommen. Es ist genau das Fenster, in dem die vier fehlenden
# Folgequartale haetten liegen muessen.
PLAUSIBLES_FENSTER_TAGE = int(round(zp.REIFE_QUARTALE * e4g.FISKALQUARTAL_TAGE))


# ── Der Evidenz-Cache ────────────────────────────────────────────────────────

def cache_verzeichnis(vorgabe=None):
    wert = vorgabe or os.environ.get(CACHE_ENV)
    if not wert:
        raise AbgleichsFehler(
            "Speicherort unbekannt: " + CACHE_ENV + " ist nicht gesetzt und "
            "--cache fehlt (R12a verbietet einen fest verdrahteten Pfad).")
    return os.path.join(wert, *CACHE_UNTERORDNER)


def lies_evidenz(verzeichnis, e2):
    """cik -> sortierte Liste von Melde-Ordinalen, plus die Deckung des Cache.

    Gelesen werden ausschliesslich `cik` und `filingDate`. Accession-Nummern,
    Formtypen, Wertpapier-Beschreibungen und Provisionsklassen werden NICHT
    uebernommen - sie werden fuer die Zaehlung nicht gebraucht, und was nicht
    gebraucht wird, wird auch nicht angefasst.

    Die CIK-Normalisierung auf int ist der gefaehrlichste Schritt dieses Laufs:
    stimmen die Formate nicht ueberein, liefert der Join stillschweigend NULL
    Treffer - und null Treffer saehe aus wie ein Befund. `pruefe_join_deckung`
    weiter unten macht daraus einen Abbruch."""
    je_cik = defaultdict(list)
    accessions = set()
    von, bis = None, None
    for name in CACHE_DATEIEN:
        pfad = os.path.join(verzeichnis, name)
        if not os.path.isfile(pfad):
            raise AbgleichsFehler(
                "CACHE-ABBRUCH: Evidenz-Datei fehlt: " + pfad + ". Der Lauf "
                "raet nicht und rechnet nicht mit einem Teilbestand weiter.")
        zp.pruefe_mauer(pfad, [FENSTER_NAME])
        kurz = zp.kurzpfad(os.path.abspath(pfad))
        if kurz not in zp.GEOEFFNETE_PFADE:
            zp.GEOEFFNETE_PFADE.append(kurz)
        with open(pfad, encoding="utf-8") as f:
            for zeile in f:
                zeile = zeile.strip()
                if not zeile:
                    continue
                satz = json.loads(zeile)
                datum = str(satz.get("filingDate") or "")[:10]
                if len(datum) != 10:
                    raise AbgleichsFehler(
                        "CACHE-ABBRUCH: Zeile ohne lesbares filingDate in "
                        + name + ". Ein unlesbares Datum wird nicht uebersprungen.")
                accessions.add(satz["accessionNumber"])
                try:
                    cik = int(str(satz["cik"]).strip())
                except (TypeError, ValueError):
                    raise AbgleichsFehler(
                        "CACHE-ABBRUCH: unlesbare CIK in " + name + ".")
                je_cik[cik].append(e2.ordinal(datum.replace("-", "")))
                von = datum if von is None or datum < von else von
                bis = datum if bis is None or datum > bis else bis
    if len(accessions) != CACHE_SOLL_ACCESSIONS:
        raise AbgleichsFehler(
            "CACHE-ABBRUCH: der Evidenz-Cache traegt " + str(len(accessions))
            + " Accessions, der Register-Eintrag nennt "
            + str(CACHE_SOLL_ACCESSIONS) + ". Ein anderer Bestand ist eine "
            "andere Quelle - und eine andere Quelle ist nicht angemeldet.")
    for cik in je_cik:
        je_cik[cik].sort()
    return dict(je_cik), {"von": von, "bis": bis, "accessions": len(accessions),
                          "ciks": len(je_cik), "dateien": list(CACHE_DATEIEN)}


def pruefe_join_deckung(evidenz, panel_ciks):
    """DER STILLE-NULL-WAECHTER.

    Wenn die CIK-Formate der beiden Quellen nicht zusammenpassen, liefert der
    Abgleich null Treffer - und null Treffer laesst sich als Befund lesen
    ("keine der Abgangsfirmen hat eine Form 25"). Genau diese Verwechslung von
    "nicht gefunden" mit "nicht vorhanden" ist die teuerste Fehlerklasse dieses
    Laufs. Der Waechter prueft deshalb NICHT die Abgangsfirmen, sondern die
    GESAMTE Panel-Population gegen den Cache: dort MUSS es reichlich
    Ueberschneidung geben, sonst ist der Join kaputt und nicht die Welt leer."""
    treffer = len(set(evidenz) & panel_ciks)
    if treffer == 0:
        raise AbgleichsFehler(
            "JOIN-ABBRUCH: keine einzige der " + str(len(panel_ciks))
            + " Panel-CIKs kommt im Form-25-Cache vor (" + str(len(evidenz))
            + " CIKs). Das ist kein Befund, sondern ein Format-Bruch zwischen "
            "den beiden Quellen. Es wird NICHT mit null Treffern weitergerechnet.")
    return treffer


# ── Der Abgleich ─────────────────────────────────────────────────────────────

def abgangsfirmen(unreif, formulare, e2):
    """Die Abgaenge: Firmen, die nach ihrem Signal GAR KEINE Zeile mehr melden.

    `formularregime` kommt WORTGLEICH aus E4g - dieselbe Funktion, dieselbe
    Grenze, dieselbe Definition von "keine Zeile mehr". Nur so kann der
    Bit-Anker 8/172 ueberhaupt treffen."""
    treffer = []
    for f in unreif:
        ohne_zeile, _jahres, _letzte = e4g.formularregime(f, formulare, e2)
        if ohne_zeile:
            treffer.append(f)
    return treffer


def leerer_block():
    block = dict((feld, 0) for feld in BLOCK_ZAEHLER)
    block["trefferquote_form25"] = None
    return block


def schliesse_block(block):
    n = block["nenner_form25_abgleich"]
    block["trefferquote_form25"] = (None if n == 0
                                    else block["mit_form25_treffer"] / float(n))
    return block


def beurteile(f, evidenz, deckung, e2):
    """Ein Abgang gegen die Evidenz. Rueckgabe: (befund, ausserhalb).

    befund aus {"mit", "ohne", "unentscheidbar"}; `ausserhalb` sagt, ob es fuer
    diese Firma ueberhaupt Form-25-Zeilen gibt, die NUR ausserhalb des
    plausiblen Fensters liegen. Das wird ausgewiesen, nicht gefiltert."""
    start = e4g.accepted_ordinal(e2, f["accepted"])
    ende = start + PLAUSIBLES_FENSTER_TAGE
    # Deckungs-Ehrlichkeit: reicht das plausible Fenster ueber den Cache hinaus,
    # ist die Firma UNENTSCHEIDBAR - nicht "ohne Treffer". Ein fehlender
    # Bestand ist kein Beleg fuer ein fehlendes Ereignis.
    cache_von = e2.ordinal(deckung["von"].replace("-", ""))
    cache_bis = e2.ordinal(deckung["bis"].replace("-", ""))
    if start < cache_von or ende > cache_bis:
        return "unentscheidbar", False
    ordinale = evidenz.get(int(f["cik"]), ())
    if not ordinale:
        return "ohne", False
    im_fenster = [o for o in ordinale if start <= o <= ende]
    if im_fenster:
        return "mit", False
    return "ohne", True


def zerlege_arm(abgaenge, evidenz, deckung, e2):
    """EIN Arm - Signal oder Kontrollpool, derselbe Code, dieselbe
    Fehlbehandlung. Zusaetzlich je Signaljahr gegliedert, wie angemeldet."""
    arm = leerer_block()
    jahre = {}
    for f in abgaenge:
        jahr = e2.jahr_aus_accepted(f["accepted"])
        if jahr is None:
            raise AbgleichsFehler(
                "R5-ABBRUCH: Abgang ohne lesbares Signaljahr. Es wird nicht "
                "geraten und die Firma nicht stillschweigend fallengelassen.")
        schluessel = str(jahr)
        block = jahre.setdefault(schluessel, leerer_block())
        befund, ausserhalb = beurteile(f, evidenz, deckung, e2)
        for ziel in (arm, block):
            ziel["fallzahl"] += 1
            if ausserhalb:
                ziel["ausserhalb_plausiblem_fenster"] += 1
            if befund == "unentscheidbar":
                ziel["unentscheidbar_gesamt"] += 1
            elif befund == "mit":
                ziel["mit_form25_treffer"] += 1
                ziel["nenner_form25_abgleich"] += 1
            else:
                ziel["ohne_form25_treffer"] += 1
                ziel["nenner_form25_abgleich"] += 1
    schliesse_block(arm)
    for block in jahre.values():
        schliesse_block(block)
    pruefe_blockinvarianten(arm, "arm")
    for schluessel, block in jahre.items():
        pruefe_blockinvarianten(block, "jahr " + schluessel)
    summe = sum(block["fallzahl"] for block in jahre.values())
    if summe != arm["fallzahl"]:
        raise AbgleichsFehler(
            "INVARIANTE: die Jahresblocke summieren auf " + str(summe)
            + ", der Arm traegt " + str(arm["fallzahl"]) + ".")
    arm["jahre"] = dict(sorted(jahre.items()))
    return arm


def pruefe_blockinvarianten(b, ort):
    zerlegung = (b["mit_form25_treffer"] + b["ohne_form25_treffer"]
                 + b["unentscheidbar_gesamt"])
    if zerlegung != b["fallzahl"]:
        raise AbgleichsFehler(
            "INVARIANTE (" + ort + "): mit + ohne + unentscheidbar ("
            + str(zerlegung) + ") deckt die Fallzahl (" + str(b["fallzahl"])
            + ") nicht.")
    if b["nenner_form25_abgleich"] != b["mit_form25_treffer"] + b["ohne_form25_treffer"]:
        raise AbgleichsFehler(
            "INVARIANTE (" + ort + "): der Nenner passt nicht zu mit+ohne.")
    if b["ausserhalb_plausiblem_fenster"] > b["ohne_form25_treffer"]:
        raise AbgleichsFehler(
            "INVARIANTE (" + ort + "): mehr Firmen mit Treffern ausserhalb des "
            "Fensters als Firmen ohne Treffer im Fenster - ausserhalb ist per "
            "Konstruktion eine Teilmenge von ohne.")
    return True


def pruefe_anker(arm, ist):
    """DER BIT-ANKER aus dem gehashten Register-Eintragstext.

    8 Firmen im S-G-Signal-Arm, 172 im Kontrollpool. Jede Abweichung ist ein
    SOFORT-STOPP mit Eskalation - kein Weiterrechnen, keine Anpassung der
    Rekonstruktion an die Sollzahl, keine zweite Variante."""
    soll = ANKER[arm]
    if ist != soll:
        raise AbgleichsFehler(
            "ANKER_ABBRUCH (SOFORT-STOPP, Eskalation an den Orchestrator): Arm "
            + arm + " ergibt " + str(ist) + " Abgaenge; das committete "
            "E4g-Aggregat nennt " + str(soll) + " (" + ANKER_QUELLE
            + ", letzte_form_nach_signal 'keine'). Der Selbst-Check des "
            "Register-Eintrags a5-form25-abgleich-2026-08-30 ist damit VERLETZT. "
            "Es wird NICHT weitergerechnet und die Rekonstruktion NICHT an die "
            "Sollzahl angepasst.")
    return True


def abgleich(panel, arbeit_pfad, evidenz, deckung, e2):
    """Dieselbe Datenstrecke wie studie-e4g-restursachen.py::restursachen -
    importiert, nicht nachgebaut. Nur der letzte Schritt ist ein anderer."""
    fenster = zp.FENSTER[FENSTER_NAME]
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

    formulare, _afs = e4g.lies_metadaten(panel, e2)

    alle, gewaehlt = e2.firmenreihen(je_firma, e2.ERGEBNIS_QUELLEN, False,
                                     zaehler, "betriebsergebnis_")
    _g, a_saetze = e2.wachstum_und_beschleunigung(alle, zaehler,
                                                  "betriebsergebnis_")
    feuerungen, auswertbar, _grenzen = e2.signale(a_saetze, zp.PERZENTIL, zaehler,
                                                   "betriebsergebnis_")
    band_f = [f for f in feuerungen if e4a.e2_im_band(f, e2, BAND[0], BAND[1])]
    band_a = [a for a in auswertbar if e4a.e2_im_band(a, e2, BAND[0], BAND[1])]
    signalfirmen = set(f["cik"] for f in band_f)
    kontroll = [a for a in band_a if a["cik"] not in signalfirmen]

    # Der Stille-Null-Waechter laeuft VOR dem Abgleich und gegen die GESAMTE
    # Panel-Population, nicht gegen die 180 Abgaenge.
    panel_ciks = set()
    for cik in gewaehlt:
        try:
            panel_ciks.add(int(str(cik).strip()))
        except (TypeError, ValueError):
            continue
    ueberschneidung = pruefe_join_deckung(evidenz, panel_ciks)

    arme = {}
    for name, eintraege in (("signal", band_f), ("kontrolle", kontroll)):
        _reif, unreif = e2.erst_ereignisse(eintraege, gewaehlt)
        abgaenge = abgangsfirmen(unreif, formulare, e2)
        pruefe_anker(name, len(abgaenge))
        arme[name] = zerlege_arm(abgaenge, evidenz, deckung, e2)
    return arme, ueberschneidung, len(panel_ciks)


# ── Waechter ─────────────────────────────────────────────────────────────────

def pruefe_anmeldung_deckt_ausgabe(freigabe, register_pfad=None):
    """W9: was ausgegeben wird, muss angemeldet sein - Feld fuer Feld, in BEIDE
    Richtungen."""
    pfad = register_pfad or zp.REGISTER
    with open(pfad, encoding="utf-8") as f:
        register = json.load(f)
    treffer = [e for e in (register.get("events") or [])
               if e.get("runId") == freigabe["runId"]]
    if len(treffer) != 1:
        raise AbgleichsFehler(
            "W9-ABBRUCH: runId " + repr(freigabe["runId"]) + " steht "
            + str(len(treffer)) + "-mal im Zugriffs-Register.")
    angemeldet = set(treffer[0].get("allowedOutputs") or ())
    erlaubt = set(DATEN_FELDER)
    if angemeldet != erlaubt:
        raise AbgleichsFehler(
            "W9-ABBRUCH: die Anmeldung deckt die Ausgabe nicht. Nur im Skript: "
            + str(sorted(erlaubt - angemeldet)) + "; nur im Register: "
            + str(sorted(angemeldet - erlaubt)) + ".")
    return True


def pruefe_zahl(wert, feld, ort, rate=False):
    if rate:
        if wert is None:
            return
        if isinstance(wert, bool) or not isinstance(wert, (int, float)):
            raise AbgleichsFehler("W3-ABBRUCH: " + ort + "." + feld
                                  + " ist keine Quote: " + repr(wert))
        if not 0.0 <= float(wert) <= 1.0:
            raise AbgleichsFehler(
                "W3-ABBRUCH: " + ort + "." + feld + " liegt ausserhalb [0, 1]: "
                + repr(wert) + ". Ein durchgereichter Roh- oder Kurswert faellt "
                "hier auf.")
        return
    if isinstance(wert, bool) or not isinstance(wert, int) or wert < 0:
        raise AbgleichsFehler(
            "W3-ABBRUCH: " + ort + "." + feld + " ist kein nicht-negativer "
            "Zaehler: " + repr(wert))


def pruefe_block(b, ort):
    if set(b) != set(JAHR_BLOCK):
        raise AbgleichsFehler(
            "W3-ABBRUCH: " + ort + " traegt nicht genau die angemeldeten Felder. "
            "Zuviel: " + str(sorted(set(b) - set(JAHR_BLOCK))) + "; zu wenig: "
            + str(sorted(set(JAHR_BLOCK) - set(b))))
    for feld in BLOCK_ZAEHLER:
        pruefe_zahl(b[feld], feld, ort)
    for feld in BLOCK_RATEN:
        pruefe_zahl(b[feld], feld, ort, rate=True)
    return True


def pruefe_ausgabe(ausgabe):
    """W3: die Ergebnis-Sperre, in BEIDE Richtungen, plus Typpruefung."""
    fremd = set(ausgabe) - set(UMSCHLAG_ALLOWLIST)
    if fremd:
        raise AbgleichsFehler(
            "W3-ABBRUCH: nicht angemeldete Umschlag-Schluessel: "
            + str(sorted(fremd)))
    fehlend = set(UMSCHLAG_ALLOWLIST) - set(ausgabe)
    if fehlend:
        raise AbgleichsFehler(
            "W3-ABBRUCH: fehlende Umschlag-Schluessel: " + str(sorted(fehlend)))
    if ausgabe.get("lesart") != STEMPEL:
        raise AbgleichsFehler(
            "STEMPEL-ABBRUCH: der Pflicht-Stempel steht nicht woertlich in der "
            "Ausgabe.")
    if ausgabe.get("keineLabelSemantik") != KEINE_LABEL_SEMANTIK:
        raise AbgleichsFehler(
            "LABEL-ABBRUCH: die Klausel 'Form 25 ist KEIN Todesbeleg' steht nicht "
            "woertlich in der Ausgabe. Sie ist im Register-Eintragstext gehasht - "
            "ohne sie liest jemand Ereignis-Evidenz als Todesbeleg.")
    if ausgabe.get("ergebnisdatenBeruehrt") is not False:
        raise AbgleichsFehler("W3-ABBRUCH: ergebnisdatenBeruehrt muss False sein.")
    for feld in OBEN_ZAEHLER:
        pruefe_zahl(ausgabe.get(feld), feld, "oben")
    if ausgabe.get("plausibles_fenster_tage") != PLAUSIBLES_FENSTER_TAGE:
        raise AbgleichsFehler(
            "W3-ABBRUCH: das ausgegebene Fenster weicht von der eingefrorenen "
            "Groesse ab.")
    if set(ausgabe.get("arme") or {}) != set(ARME):
        raise AbgleichsFehler("W3-ABBRUCH: die Arme sind nicht genau "
                              + str(sorted(ARME)))
    for arm in ARME:
        block = ausgabe["arme"][arm]
        if set(block) != set(ARM_BLOCK):
            raise AbgleichsFehler(
                "W3-ABBRUCH: Arm " + arm + " traegt nicht genau die angemeldeten "
                "Felder. Zuviel: " + str(sorted(set(block) - set(ARM_BLOCK)))
                + "; zu wenig: " + str(sorted(set(ARM_BLOCK) - set(block))))
        pruefe_block(dict((k, v) for k, v in block.items() if k != "jahre"),
                     "arme." + arm)
        for jahr, jb in (block["jahre"] or {}).items():
            if not (isinstance(jahr, str) and len(jahr) == 4 and jahr.isdigit()):
                raise AbgleichsFehler(
                    "W3-ABBRUCH: " + repr(jahr) + " ist kein Jahres-Etikett.")
            pruefe_block(jb, "arme." + arm + ".jahre." + jahr)
    return True


def lauf(freigabe_pfad, data_root=None, arbeit=None, ziel=None, siegel_voll=True,
         panel_pfad=None, register_pfad=None, cache=None):
    fenster = zp.FENSTER[FENSTER_NAME]
    if fenster["sperrzone"]:
        raise AbgleichsFehler("SPERRZONE-STOPP: " + FENSTER_NAME)

    del zp.GEOEFFNETE_PFADE[:]
    del zp.GESCHRIEBENE_PFADE[:]

    manifest = zp.pruefe_manifest()
    freigabe = zp.lies_freigabe(freigabe_pfad, FENSTER_NAME)
    pruefe_anmeldung_deckt_ausgabe(freigabe, register_pfad)
    wurzel = zp.datenwurzel(data_root)

    erster_zugriff = zp.zeitstempel()
    zp.pruefe_serverzeit(freigabe, erster_zugriff)
    wache = zp.siegel_wache(wurzel, voll=siegel_voll)

    if panel_pfad is None:
        panel_pfad = os.path.join(wurzel, "panel", fenster["datei"])
    arbeit_pfad = arbeit or os.path.join(
        wurzel, "arbeit", "A5-" + FENSTER_NAME + "-zwischenstand.sqlite")

    e2 = zp.lade_modul(zp.E2_SKRIPT, "studie_basisraten")
    evidenz, deckung = lies_evidenz(cache_verzeichnis(cache), e2)

    panel = zp.oeffne_nur_lesend(panel_pfad, FENSTER_NAME)
    try:
        arme, ueberschneidung, panel_ciks = abgleich(panel, arbeit_pfad, evidenz,
                                                     deckung, e2)
    finally:
        panel.close()

    s, k = arme["signal"], arme["kontrolle"]
    ausgabe = {
        "schema": SCHEMA,
        "protokoll": zp.PROTOKOLL,
        "runId": freigabe["runId"],
        "fenster": FENSTER_NAME,
        "variante": VARIANTE,
        "lesart": STEMPEL,
        "keineLabelSemantik": KEINE_LABEL_SEMANTIK,
        "fensterRegel": (
            "Plausibles Fenster = Melde-Zeitpunkt des Signals + "
            + str(zp.REIFE_QUARTALE) + " * " + repr(e4g.FISKALQUARTAL_TAGE)
            + " Tage = " + str(PLAUSIBLES_FENSTER_TAGE) + " Tage - genau das "
            "Fenster, in dem die vier fehlenden Folgequartale haetten liegen "
            "muessen. Beide Faktoren eingefroren uebernommen, keine dritte Zahl "
            "erfunden. Treffer ausserhalb werden ausgewiesen, nie gefiltert."),
        "evidenzCache": deckung,
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
        "umgebung": {"plattform": sys.platform, "python": platform.python_version(),
                     "sqlite": sqlite3.sqlite_version},
        "selbstCheck": {
            "quelle": ANKER_QUELLE,
            "sollAbgaengeSignal": ANKER["signal"],
            "istAbgaengeSignal": s["fallzahl"],
            "sollAbgaengeKontrollpool": ANKER["kontrolle"],
            "istAbgaengeKontrollpool": k["fallzahl"],
            "bestanden": True,
            "joinDeckungPanelCiksImCache": ueberschneidung,
            "panelCiks": panel_ciks,
        },
        "plausibles_fenster_tage": PLAUSIBLES_FENSTER_TAGE,
        "abgaenge_signal_arm": s["fallzahl"],
        "abgaenge_kontrollpool": k["fallzahl"],
        "abgaenge_gesamt": s["fallzahl"] + k["fallzahl"],
        "arme": arme,
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


def _bricht(fn):
    try:
        fn()
    except AbgleichsFehler:
        return True
    return False


class _E2:
    PERIODISCHE_FORMEN = ("10-K", "10-Q", "20-F", "40-F")

    @staticmethod
    def ordinal(ddate):
        import datetime
        d = datetime.date(int(ddate[:4]), int(ddate[4:6]), int(ddate[6:8]))
        return d.toordinal()

    @staticmethod
    def jahr_aus_accepted(accepted):
        return int(str(accepted)[:4])


def _abgang(cik="7", accepted="2018-05-01"):
    return {"cik": cik, "accepted": accepted, "ddate": "20180331"}


def _deckung(von="2016-01-04", bis="2024-12-31"):
    return {"von": von, "bis": bis, "accessions": CACHE_SOLL_ACCESSIONS,
            "ciks": 4281, "dateien": list(CACHE_DATEIEN)}


def _gueltige_ausgabe():
    jahr = {"ausserhalb_plausiblem_fenster": 0, "fallzahl": 2,
            "mit_form25_treffer": 1, "nenner_form25_abgleich": 2,
            "ohne_form25_treffer": 1, "trefferquote_form25": 0.5,
            "unentscheidbar_gesamt": 0}
    arm = dict(jahr); arm["jahre"] = {"2018": dict(jahr)}
    return {
        "schema": SCHEMA, "protokoll": "FEM-SEC-US@2.0.0", "runId": "test",
        "fenster": FENSTER_NAME, "variante": VARIANTE, "lesart": STEMPEL,
        "keineLabelSemantik": KEINE_LABEL_SEMANTIK, "fensterRegel": "regel",
        "evidenzCache": _deckung(), "panelRand": "2020-12-31", "perzentil": 95,
        "serverConfirmedAt": "z", "accessedAt": "z", "ersterZugriffAm": "z",
        "beendetAm": "z", "gelesenePfade": [], "geschriebenePfade": [],
        "ergebnisdatenBeruehrt": False, "siegelWache": {}, "manifestGeprueft": [],
        "umgebung": {}, "selbstCheck": {},
        "plausibles_fenster_tage": PLAUSIBLES_FENSTER_TAGE,
        "abgaenge_signal_arm": 2, "abgaenge_kontrollpool": 2,
        "abgaenge_gesamt": 4,
        "arme": {"signal": dict(arm, jahre={"2018": dict(jahr)}),
                 "kontrolle": dict(arm, jahre={"2018": dict(jahr)})},
    }


def selbsttest():
    e2 = _E2()
    print("A.5 Form-25-Abgleich - Selbsttest")

    print(" Das plausible Fenster")
    pruefe("Fenster ist vier Fiskalquartale (365 Tage)",
           PLAUSIBLES_FENSTER_TAGE == 365, PLAUSIBLES_FENSTER_TAGE, 365)

    print(" Die Beurteilung")
    d = _deckung()
    start = e2.ordinal("20180501")
    ev_im = {7: [start + 100]}
    pruefe("Treffer im Fenster -> mit",
           beurteile(_abgang(), ev_im, d, e2) == ("mit", False))
    ev_rand = {7: [start + 365]}
    pruefe("Treffer am letzten Fenstertag zaehlt noch",
           beurteile(_abgang(), ev_rand, d, e2) == ("mit", False))
    ev_spaet = {7: [start + 366]}
    pruefe("Treffer einen Tag zu spaet -> ohne, aber ausgewiesen",
           beurteile(_abgang(), ev_spaet, d, e2) == ("ohne", True))
    ev_frueh = {7: [start - 5]}
    pruefe("Treffer VOR dem Signal -> ohne, ausgewiesen",
           beurteile(_abgang(), ev_frueh, d, e2) == ("ohne", True))
    pruefe("gar keine Zeile fuer die CIK -> ohne, nicht ausgewiesen",
           beurteile(_abgang(), {}, d, e2) == ("ohne", False))
    schmal = _deckung(von="2018-06-01", bis="2019-01-01")
    pruefe("Fenster ragt aus dem Cache -> unentscheidbar, NICHT 'ohne'",
           beurteile(_abgang(), ev_im, schmal, e2) == ("unentscheidbar", False))

    print(" Der Stille-Null-Waechter")
    pruefe("Ueberschneidung geht durch", pruefe_join_deckung({7: [1]}, {7, 8}) == 1)
    pruefe("null Ueberschneidung ist ein ABBRUCH, kein Befund",
           _bricht(lambda: pruefe_join_deckung({7: [1]}, {90001, 90002})))

    print(" Der Bit-Anker 8/172")
    pruefe("8 im Signalarm geht durch", pruefe_anker("signal", 8))
    pruefe("172 im Kontrollpool geht durch", pruefe_anker("kontrolle", 172))
    pruefe("7 statt 8 ist ein SOFORT-STOPP",
           _bricht(lambda: pruefe_anker("signal", 7)))
    pruefe("9 statt 8 ist ein SOFORT-STOPP",
           _bricht(lambda: pruefe_anker("signal", 9)))
    pruefe("171 statt 172 ist ein SOFORT-STOPP",
           _bricht(lambda: pruefe_anker("kontrolle", 171)))

    print(" Arm-Zerlegung")
    abg = [_abgang("7", "2018-05-01"), _abgang("8", "2019-05-01")]
    ev = {7: [e2.ordinal("20180801")]}
    arm = zerlege_arm(abg, ev, d, e2)
    pruefe("zwei Abgaenge, ein Treffer -> Quote 0.5",
           arm["fallzahl"] == 2 and arm["mit_form25_treffer"] == 1
           and arm["trefferquote_form25"] == 0.5)
    pruefe("je Signaljahr gegliedert", sorted(arm["jahre"]) == ["2018", "2019"])
    pruefe("Jahresblocke summieren auf den Arm",
           sum(b["fallzahl"] for b in arm["jahre"].values()) == arm["fallzahl"])

    print(" Block-Invarianten")
    b = leerer_block(); b.update({"fallzahl": 3, "mit_form25_treffer": 1,
                                  "ohne_form25_treffer": 1,
                                  "unentscheidbar_gesamt": 1,
                                  "nenner_form25_abgleich": 2})
    pruefe("gueltiger Block geht durch", pruefe_blockinvarianten(b, "test"))
    pruefe("Zerlegung deckt Fallzahl nicht -> Abbruch",
           _bricht(lambda: pruefe_blockinvarianten(dict(b, fallzahl=4), "test")))
    pruefe("ausserhalb > ohne -> Abbruch",
           _bricht(lambda: pruefe_blockinvarianten(
               dict(b, ausserhalb_plausiblem_fenster=2), "test")))

    print(" Ausgabe-Sperre")
    pruefe("gueltige Ausgabe geht durch", pruefe_ausgabe(_gueltige_ausgabe()))
    a = _gueltige_ausgabe(); a["cik_liste"] = [1, 2]
    pruefe("Kennungs-Liste im Umschlag bricht ab",
           _bricht(lambda: pruefe_ausgabe(a)))
    a = _gueltige_ausgabe(); a["keineLabelSemantik"] = "weg"
    pruefe("entfernte 'kein Todesbeleg'-Klausel bricht ab",
           _bricht(lambda: pruefe_ausgabe(a)))
    a = _gueltige_ausgabe(); a["lesart"] = "weg"
    pruefe("entfernter Pflicht-Stempel bricht ab",
           _bricht(lambda: pruefe_ausgabe(a)))
    a = _gueltige_ausgabe(); a["plausibles_fenster_tage"] = 400
    pruefe("verschobenes Fenster bricht ab", _bricht(lambda: pruefe_ausgabe(a)))
    a = _gueltige_ausgabe(); a["arme"]["signal"]["accession"] = "0001-24-1"
    pruefe("Accession-Nummer im Arm bricht ab", _bricht(lambda: pruefe_ausgabe(a)))
    a = _gueltige_ausgabe(); a["arme"]["signal"]["jahre"]["2018"]["cik"] = 320193
    pruefe("CIK im Jahresblock bricht ab", _bricht(lambda: pruefe_ausgabe(a)))
    a = _gueltige_ausgabe(); a["arme"]["signal"]["trefferquote_form25"] = 12.5
    pruefe("Quote ausserhalb [0,1] bricht ab", _bricht(lambda: pruefe_ausgabe(a)))

    print(" Allowlist gegen das Register")
    pruefe("die 11 Skript-Felder sind genau 11",
           len(DATEN_FELDER) == 11 and len(set(DATEN_FELDER)) == 11)
    abgedeckt = set(JAHR_BLOCK) | set(OBEN_ZAEHLER)
    pruefe("Block- und Oben-Felder decken die Allowlist genau",
           abgedeckt == set(DATEN_FELDER),
           sorted(abgedeckt), sorted(DATEN_FELDER))
    try:
        pruefe("Anmeldung deckt Ausgabe (echtes Register)",
               pruefe_anmeldung_deckt_ausgabe(
                   {"runId": "a5-form25-abgleich-2026-08-30"}))
    except AbgleichsFehler as fehler:
        pruefe("Anmeldung deckt Ausgabe (echtes Register)", False, str(fehler))

    print()
    if FEHLER:
        print("ROT: " + str(len(FEHLER)) + " Pruefung(en) gescheitert")
        return 1
    print("GRUEN: alle Pruefungen bestanden")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description="A.5-Annex - Form-25-Abgleich")
    p.add_argument("--freigabe")
    p.add_argument("--ziel")
    p.add_argument("--data-root")
    p.add_argument("--cache")
    p.add_argument("--arbeit")
    p.add_argument("--panel")
    p.add_argument("--register")
    p.add_argument("--siegel-schnell", action="store_true")
    p.add_argument("--selbsttest", action="store_true")
    p.add_argument("--allowlist-ausgeben", action="store_true")
    a = p.parse_args(argv)
    if a.selbsttest:
        return selbsttest()
    if a.allowlist_ausgeben:
        print(json.dumps({"allowedOutputs": sorted(DATEN_FELDER)},
                         ensure_ascii=False, indent=1))
        return 0
    if not a.freigabe:
        p.error("--freigabe fehlt")
    ausgabe = lauf(a.freigabe, data_root=a.data_root, arbeit=a.arbeit,
                   ziel=a.ziel, siegel_voll=not a.siegel_schnell,
                   panel_pfad=a.panel, register_pfad=a.register, cache=a.cache)
    print(json.dumps(ausgabe, ensure_ascii=False, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
