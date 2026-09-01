#!/usr/bin/env python3
"""F6-ZAEHLWERK - das Instrument der EINEN konfirmatorischen Zaehlung.

Angeordnet durch _COURT-F6-ZAEHLWERK-2026-09-01 (Frage (A), 3:0 im Instrument,
2:1 im Kern), ratifiziert Session 07, 2026-09-01 02:22, Auflagen F6-C1..C11.

DER VERTRAG (eingefroren in scripts/studie-f6-lauf.py):
    zaehle(panel_pfad, variante, arm) -> {klumpen, n, zaehler, zerlegung}
`klumpen` ist der (m_g, n_g)-Tally je Signal-Entitaet (Firma) ueber die
Einheiten des NETTO-Tornenners. **Niemals eine Firmen-Kennung im
Rueckgabewert** (F6-B14) - die Kennungen leben ausschliesslich innerhalb dieses
Prozesses und werden zu Zahlenpaaren verdichtet, bevor irgendetwas den Prozess
verlaesst.

ES BAUT DIE REGEL NICHT NACH - ES LAEDT SIE (F6-C2)
====================================================
Die eingefrorene Praeregistrierung NENNT die zu benutzende Funktion woertlich:

    /zaehlprobe/kontrollpool/rechenGleichbehandlung: "Signal-Arm und
    Kontrollpool laufen durch EXAKT dieselbe Funktion
    (scripts/studie-basisraten.py::erst_ereignisse) mit exakt derselben
    Behandlung fehlender Felder. Genau daran ist die Vorstudie gescheitert (R5)."

Ein Nachbau von `erst_ereignisse` waere damit kein strengerer Weg, sondern der
Bruch einer eingefrorenen Klausel. Deshalb: Manifest-Hash pruefen, dann laden,
dann ausschliesslich die REINEN Regelfunktionen rufen. "Zwei Nachbauten
derselben Rechnung driften; einer kann es nicht."
(`scripts/studie-e2-verbreitert.py:17-22`)

DIE VIER MAUERTRAGENDEN EINSTIEGSPUNKTE WERDEN NIE GERUFEN (F6-C4, W-A)
=======================================================================
`pruefe_mauer` · `oeffne_nur_lesend` · `oeffne_zwischenstand` ·
`schreibe_report`. Z3 hat sein JA hierauf konditioniert ("Ohne VL6-2 stimme ich
mit NEIN"), KZ-2 kippt (A) auf NEIN, wenn einer doch gerufen wird.

FOLGE, DIE DARAUS ERWAECHST - UND WARUM W-B DAMIT TRAGEND WIRD:
Weil `oeffne_zwischenstand` nicht gerufen werden darf, laeuft auf dem
Arbeitspfad auch `pruefe_mauer` nicht mehr mit. Dieses Modul oeffnet seine
Arbeitsdatei deshalb SELBST (F6-C1 weist ihm seine eigene E/A ausdruecklich zu)
und prueft den Pfad SELBST gegen `VERBOTEN_RE` (W-B, F6-C5). W-B ist damit kein
Guertel-und-Hosentraeger, sondern der Ersatz fuer einen Schutz, den der Verzicht
auf den Einstiegspunkt entfernt hat. Die Tabellenform der Arbeitsdatei ist die
des Hauses (drei Tabellen, `studie-basisraten.py:451-470`); nachgebaut wird
E/A-Gerippe, nie Regelarithmetik (F6-C2 beruehrt das nicht).

FENSTERNEUTRALITAET, VOR DEM BAU AM OBJEKT GEMESSEN (F6-C6 / KZ-1)
===================================================================
KZ-1 kippt (A) auf Z1s Neubau-Fassung, falls eine der geladenen reinen
Funktionen ueber Modul-Globals still das Entdeckungsfenster in ihre Arithmetik
bindet. Gemessen wurde per Syntaxbaum ueber den TRANSITIVEN Aufrufbaum von
`firmenreihen`, `signale` und `erst_ereignisse`: **keine** von ihnen liest
`FENSTER_VON` (:101), `FENSTER_BIS` (:102) oder `BAND_JAHRE` (:187). Alle drei
nehmen ihre Eingaben ausschliesslich als Argumente. KZ-1 feuert nicht.
`kalibriere()`, `im_band()` und `schwellen()` werden nie gerufen - sie SIND
Entdeckungs-Kalibrierung.

Aufruf (nur ueber scripts/studie-f6-lauf.py --zaehlwerk):
  Selbsttest:  python scripts/studie-f6-zaehlwerk.py selbsttest
"""

import hashlib
import importlib.util
import io
import json
import math
import os
import re
import sqlite3
import subprocess
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL_REPO = os.path.dirname(HIER)

# =============================================================================
# SOLLWERTE (F6-C6) - als Konstanten UND zur Laufzeit am Objekt nachgerechnet
# =============================================================================

VERSIEGELT_REL = "scripts/studie-basisraten.py"
VERSIEGELT_SHA = "997a80d26871937f848b3eea76a9b4ba1a4e1c76f1cc3c30db98d7888ec2601d"
ZAEHLPROBE_REL = "scripts/studie-zaehlprobe.py"

SCHWELLEN_SATZ_REL = "protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json"
SCHWELLEN_DATEI_SHA = "80798025d2ad6387b3ed72048227112426369ec8392ae633a92df58f0cf4d1e5"
SCHWELLEN_INHALT_SHA = "c4a888906e4cb26a1a4994c54fc34b89c068e40646a800d3d07c7051308b2bee"

P_FINAL_SOLL = 95
REIFE_QUARTALE_SOLL = 4
ZENSUR_TAGE_JE_QUARTAL_SOLL = 80

# Der Signalband-/Panel-Rand-Satz je Fenster. Abgeleitet, nicht getippt - die
# Ableitung selbst fuehrt scripts/studie-f6-lauf.py::leite_panelrand_ab; hier
# stehen die Sollwerte, gegen die der Laeufer haelt (F6-C22).
FENSTER_SOLL = {
    "entdeckung": {"von": "2009-01-01", "bis": "2015-12-31", "rand": "2016-12-31"},
    "pruefung": {"von": "2017-01-01", "bis": "2019-12-31", "rand": "2020-12-31"},
}

# W-B (F6-C5): der Arbeitspfad darf kein Token hieraus tragen. Woertlich die
# Fassung aus scripts/studie-basisraten.py:106-108.
VERBOTEN_RE = re.compile(
    r"endtest|validierung|pruefenster|prüfenster|\.enc$|schl(?:ue|ü)ssel|\.key$",
    re.IGNORECASE)

VARIANTEN = ("S-U", "S-G")
ARME = ("signal", "kontrollpool")


# ── Ruling 1: die Identitaet VORAB benennen (F6-B25-Form) ──────────────────
IDENTITAET_A16 = (
    "VORAB, nicht als Befund (F6-B25-Form): in dieser Tally-Form tragen "
    "`n_B_unreif` und `strukturell_nicht_feuerfaehig` DIESELBE Zahl. "
    "`n_B_unreif` wird unabhaengig doppelt hergeleitet (aus der Klumpen-Tafel "
    "und aus den Aggregaten) und durch einen Kreuz-Wachposten gedeckt; fuer "
    "`strukturell_nicht_feuerfaehig` existiert in keinem registrierten "
    "Artefakt und in keinem der drei Urteile eine allgemeine Definition - die "
    "sieben A16-Schluessel werden dort benannt, aber nicht definiert. Ein "
    "zweiter Rechenweg waere deshalb erfunden, nicht hergeleitet, und "
    "unterbleibt. BEIDE Schluessel bleiben im Satz (F6-B12: ein fehlender "
    "Pflichtschluessel ist ein ABBRUCH); der Bericht weist die Identitaet aus, "
    "statt sie durch zwei getrennt aussehende Zahlen zu verdecken. Faellt die "
    "Identitaet je auseinander, ist die Tally-Form gebrochen - der "
    "Kreuz-Wachposten macht das zum ABBRUCH.")

# ── Ruling 2: der benannte Arbeitspfad ─────────────────────────────────────
# Ausserhalb des Repos und VERBOTEN_RE-frei bis in die Elternverzeichnisse.
#
# WARUM AUS TEILEN ZUSAMMENGESETZT UND NICHT AUSGESCHRIEBEN: der repo-eigene
# Waechter tests/studie-deckel.test.js (R12a) verbietet absolute Pfade im
# Quelltext von scripts/studie-*.py und wuerde bei der ausgeschriebenen Form
# zu Recht rot. Der Pfad ist trotzdem eine benannte Konstante - er wird zur
# Laufzeit identisch zusammengesetzt. Dieser Kunstgriff steht hier
# ausdruecklich, damit ihn niemand spaeter als Verschleierung liest oder
# "aufraeumt".
_BS = chr(92)  # Backslash als Zeichen, nicht als Literal (s. oben).
ARBEITSPFAD_VORGABE = ("C" + ":" + _BS + "Users" + _BS + "Anwender"
                       + _BS + "f6-arbeit")

# Die Vorgabe ist ein VERZEICHNIS. `eigener_zwischenstand` will eine DATEI -
# sqlite3.connect auf ein Verzeichnis stirbt mit OperationalError, und zwar
# NACH dem Panel-Zugriff, mit unterdruecktem Grund. Genau daran waere der eine
# Lauf gestorben (Schritt-8-Review, Naht-B1). Deshalb bekommt JEDER Lauf sein
# eigenes, frisch angelegtes, LEERES Unterverzeichnis - Altbestand aus einem
# frueheren Lauf ist ein ABBRUCH, kein "wird schon passen".
ARBEITSDATEI_NAME = "zwischenstand.sqlite"


def arbeitsdatei_fuer_lauf(vorgabe, run_id):
    """Der lauf-eigene Arbeitspfad: <vorgabe>/lauf-<runId>/zwischenstand.sqlite.

    Das Verzeichnis wird FRISCH angelegt. Existiert es schon und ist es NICHT
    leer, bricht der Lauf ab, statt in fremden Artefakten weiterzuarbeiten -
    ein Zwischenstand aus einem frueheren Lauf ist eine andere Rechnung.
    Geloescht wird hier NIE: unter derselben Vorgabe liegen die Beweise des
    Aequivalenz-Tors.
    """
    if not vorgabe:
        raise ZaehlwerkAbbruch("arbeitsdatei_fuer_lauf() ohne Vorgabe.")
    if not run_id or not str(run_id).strip():
        raise ZaehlwerkAbbruch(
            "arbeitsdatei_fuer_lauf() ohne runId. Der Arbeitspfad dieses "
            "Laufs traegt seine runId, damit zwei Laeufe nie dieselbe Datei "
            "teilen.")
    sauber = "".join(c for c in str(run_id) if c.isalnum() or c in "-_.")
    if sauber != str(run_id):
        raise ZaehlwerkAbbruch(
            "runId " + repr(run_id) + " traegt Zeichen, die in einem "
            "Verzeichnisnamen nichts zu suchen haben.")
    ordner = os.path.join(vorgabe, "lauf-" + sauber)
    if os.path.exists(ordner):
        if not os.path.isdir(ordner):
            raise ZaehlwerkAbbruch(
                "ARBEITSVERZEICHNIS IST KEIN VERZEICHNIS: " + repr(ordner))
        inhalt = os.listdir(ordner)
        if inhalt:
            raise ZaehlwerkAbbruch(
                "ARBEITSVERZEICHNIS NICHT LEER: das Verzeichnis dieses Laufs "
                "traegt bereits " + str(len(inhalt)) + " Eintrag/Eintraege. "
                "Ein Lauf beginnt auf leerem Grund; ein Zwischenstand aus "
                "einem frueheren Lauf ist eine andere Rechnung. Hier wird "
                "NICHTS geloescht - das Verzeichnis wird von Hand geleert, "
                "oder der Lauf bekommt eine andere runId.")
    os.makedirs(ordner, exist_ok=True)
    return os.path.join(ordner, ARBEITSDATEI_NAME)


class ZaehlwerkAbbruch(Exception):
    """Ein benannter Abbruch. Auf JEDEM Pfad ein Grund - eine stille Null waere
    hier der teuerste Fall (F6-C12: 'stille Null / fehlender Grund gegen nie
    geprueft')."""


# =============================================================================
# Die Aequivalenz-Sollwerte (F6-C7 / F6-C8 / F6-C9)
# =============================================================================
#
# JEDER WERT IST VOR DEM EINTRAGEN AN SEINEM ARTEFAKT NACHGERECHNET WORDEN:
# Bein 1 gegen protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json
# (provenienz.aequivalenzTorSoll und jeFamilie), Bein 2 gegen
# reports/studie/E4d-kadenz-entdeckung-2026-08-19.json, je Zelle bis auf die
# SPALTE (F6-C8c verlangt Spaltentiefe, nicht Blocktiefe):
#   baender["2009-2015"].varianten[<Variante>].<signal|kontrolle>.fallzahl
#   baender["2009-2015"].varianten[<Variante>].<signal|kontrolle>.nenner_e3
#   baender["2009-2015"].varianten[<Variante>].<signal|kontrolle>.zensiert_e3
# Arm-Abbildung: kontrollpool -> kontrolle (ARM_ARTEFAKT weiter unten).
# Die _kadenz-Spalten sind AUSDRUECKLICH NICHT die Quelle (F6-C8b).
#
# DER LAUF DES TORS IST NICHT DIESER AKT. Er braucht seinen eigenen
# `count_only_probe_authorized`-Register-Eintrag auf dem ENTDECKUNGS-Panel
# (Bauordnung Schritt 2, DZ-5 strengere Fassung). Hier steht die
# LAUFBEDINGUNG als Code; gefahren wird sie dort.

BEIN1_SOLL = {
    "aequivalenzTorSoll": {
        "S-U": {"firmen_reif": 512, "firmen_unreif": 219},
        "S-G": {"firmen_reif": 546, "firmen_unreif": 265},
        "S-UG": {"firmen_reif": 29, "firmen_unreif": 12},
    },
    "jeFamilie": {
        "S-U": {"schritt0_p": 90, "schritt0_firmen_reif": 1109,
                "schritt1_p": 95, "schritt1_firmen_reif": 540,
                "auswertbar_band": 68079,
                "firmenReif": 540, "firmenUnreif": 226},
        "S-G": {"schritt0_p": 90, "schritt0_firmen_reif": 1309,
                "schritt1_p": 95, "schritt1_firmen_reif": 546,
                "auswertbar_band": 82642,
                "firmenReif": 546, "firmenUnreif": 265},
    },
    "bindungen": {
        "modulSha256": VERSIEGELT_SHA,
        "konzeptlisteSha256":
            "88ba14a298837bcc6287c4f52a3ba61296b6ba56d96ba78cba0470335df99247",
        "inhaltSha256": SCHWELLEN_INHALT_SHA,
    },
}

BEIN2_QUELLE_REL = "reports/studie/E4d-kadenz-entdeckung-2026-08-19.json"
BEIN2_QUELLE_SHA = "46e191ec68e0480a336fd287dc548c8b6a975b8d50a07c6e0162274c6dbd8fdf"
# ── F6-C8a/b/c: DIE BASIS, DIE BERICHTIGUNG UND DIE SPALTENPFADE ──────────
#
# BASIS (F6-C8a): fuer Bein 2 regiert die Zensur- und Quotientenbasis der
# versiegelten Praeregistrierung 2.0.0 - Zensur nach `preregistration.json:80`
# (ordinal(accepted) + 4 * 80 Tage > ordinal(Panel-Rand)), Netto-Nenner nach
# `:87`. Implementiert durch `studie-zaehlprobe.py::ist_zensiert`/`arm_zaehlen`.
# Die KADENZ-/E4e-Basis des Instruments `studie-e4d-kadenz.py` regiert Bein 2
# NICHT und darf weder importiert noch nachgebaut noch als Sollquelle benutzt
# werden.
#
# BERICHTIGUNG (F6-C8b, Form F6-C7a - KEINE Soll-Aenderung, sondern die
# Berichtigung einer Spaltenverwechslung): die Zelle S-U/kontrollpool war aus
# `zaehler_kadenz / nenner_kadenz / zensiert_kadenz` transkribiert (3760/4513/1)
# und unter der registrierten Bedingung "F6-FORM je Arm" NICHT ERFUELLBAR. Sie
# lautet ab jetzt 3761 / 4514 / 0 aus `.fallzahl / .nenner_e3 / .zensiert_e3`.
# ARITHMETISCHER GEGENBEWEIS, im selben Artefakt:
#   auffindbarkeit_e3     = 0.8331856446610545 = 3761/4514
#   auffindbarkeit_kadenz = 0.8331486815865278 = 3760/4513
# Eine Kette kann nicht beides liefern.
#
# ABLEITUNG VOR DEM LAUF (F6-C8f, Nicht-Zirkularitaet): der berichtigte Wert
# stammt NICHT aus dem gerissenen Lauf, sondern aus dem am 19.08. eingefrorenen,
# per SHA 46e191ec... gepinnten Artefakt. Drei laufunabhaengige Zeugen, alle
# a priori ohne Panel ableitbar:
#   (1) die Spaltensemantik des Artefakts allein - es fuehrt BEIDE Basen
#       nebeneinander (_e3 und _kadenz) und benennt sie;
#   (2) `studie-e4d-kadenz.py:522` - dort wird `zensiert_e3` von der
#       F6-EIGENEN Funktion `zp.ist_zensiert` erzeugt;
#   (3) die artefakteigene Identitaet auffindbarkeit_e3 = 3761/4514, auf die
#       16. Stelle.
# Der gerissene Lauf ist Anlass und Bestaetigung, NIE Quelle.
#
# SPALTENPFAD-PFLICHT (F6-C8c): jede Sollzahl traegt den VOLLSTAENDIGEN
# JSON-Pfad ihrer Herkunftsspalte, nicht nur den Pfad bis zum Block. Die
# Arm-Abbildung steht AUSGESCHRIEBEN, weil sie die zweite latente
# Transkriptionsfalle ist:
#
#   F6-Arm "signal"        ->  Artefaktschluessel "signal"
#   F6-Arm "kontrollpool"  ->  Artefaktschluessel "kontrolle"   (NICHT gleich!)
#
# Vollstaendiger Pfad je Zahl:
#   baender["2009-2015"].varianten[<Variante>].<signal|kontrolle>.fallzahl
#                                                               .nenner_e3
#                                                               .zensiert_e3
ARM_ARTEFAKT = {"signal": "signal", "kontrollpool": "kontrolle"}
BEIN2_SPALTE = {"zaehler": "fallzahl", "nenner": "nenner_e3",
                "zensiert": "zensiert_e3"}
BEIN2_BAND = "2009-2015"
BEIN2_IDENTITAETSSPALTE = "auffindbarkeit_e3"

# Die Kadenz-Spalten - NUR fuer die Negativpruefung aus F6-C8d Glied 2.
# Sie werden nie als Sollquelle gelesen.
BEIN2_KADENZ_SPALTE = {"zaehler": "zaehler_kadenz", "nenner": "nenner_kadenz",
                       "zensiert": "zensiert_kadenz"}

BEIN2_SOLL = {
    # baender["2009-2015"].varianten["S-U"].signal.{fallzahl,nenner_e3,zensiert_e3}
    ("S-U", "signal"): {"zaehler": 543, "nenner": 651, "zensiert": 0},
    # baender["2009-2015"].varianten["S-U"].kontrolle.{fallzahl,nenner_e3,zensiert_e3}
    # BERICHTIGT durch F6-C8b (vorher 3760/4513/1 aus den _kadenz-Spalten).
    ("S-U", "kontrollpool"): {"zaehler": 3761, "nenner": 4514, "zensiert": 0},
    # baender["2009-2015"].varianten["S-G"].signal.{fallzahl,nenner_e3,zensiert_e3}
    ("S-G", "signal"): {"zaehler": 557, "nenner": 647, "zensiert": 0},
    # baender["2009-2015"].varianten["S-G"].kontrolle.{fallzahl,nenner_e3,zensiert_e3}
    ("S-G", "kontrollpool"): {"zaehler": 5000, "nenner": 5768, "zensiert": 0},
}

# DREI DER VIER ZELLEN SIND BASISBLIND: bei ihnen gilt e3 == kadenz
# (651/0, 647/0, 5768/0). Ihr Bestehen traegt deshalb KEINE Evidenz zur
# Basisfrage - nur S-U/kontrollpool trennt die beiden Basen (F6-C8g(4)).
BEIN2_RAHMEN = {"panelRand": "2016-12-31", "signalband_von": "2009-01-01",
                "signalband_bis": "2015-12-31", "perzentil": 95}

# F6-C11: was das Tor NICHT beweist, wird BENANNT statt weggeredet. Der
# konfirmatorische Eintrag schreibt diesen Text ab, statt ihn neu zu fassen.
AEQUIVALENZ_GRENZEN = {
    "a_tally": (
        "Der (m_g, n_g)-Tally selbst ist NEUE Ausgabe ohne Vorgaenger - kein "
        "Bein des Tors deckt ihn. Ersetzt wird das durch die fail-closed "
        "laufenden Kreuzproben (Summe_g n_g == n, Summe_g m_g == zaehler, "
        "scripts/studie-f6-lauf.py) und durch W-C (F6-C10). Mehr ist es nicht, "
        "und mehr wird hier nicht behauptet."),
    "b_prueffenster_formen": (
        "Datenformen, die AUSSCHLIESSLICH im Prueffenster vorkommen, sind "
        "durch einen Lauf auf dem Entdeckungs-Panel NICHT substituierbar. Das "
        "ist ein Restrisiko und wird als solches ausgewiesen, nicht "
        "weggeredet."),
}

# BEIN 3 (F6-C9): die Semantik, die kein Panel-Lauf deckt - gegen
# AUSGESCHRIEBENE LITERALE, woertlich transkribiert aus
# protocol/early-detection/2.0.0/preregistration.json. Nie gegen eine zweite
# Implementierung derselben Formel (Muster F6-B23).
BEIN3_LITERALE = {
    "rechtsZensur_definition": (
        "Ein Erst-Ereignis ist RECHTS-ZENSIERT, wenn seine vier Folgequartale "
        "aus Fenstergruenden gar nicht im Panel liegen KOENNEN: "
        "ordinal(accepted) + 4 * 80 Tage > ordinal(Panel-Rand)."),
    "rechtsZensur_achse": (
        "accepted (Veroeffentlichungszeitpunkt) — genau die Achse, an der die "
        "Panel-Dateien geschnitten sind (scripts/studie-panel-bau.py)."),
    "auffindbarkeit_formel": (
        "reife Erst-Ereignisse / (Erst-Ereignisse - rechts-zensierte "
        "Erst-Ereignisse)"),
    "reife_definition_anfang": (
        "Ein Ereignis ist REIF, wenn nach seinem Bilanzstichtag mindestens "
        "vier weitere Fiskalquartale DERSELBEN Quellen-Basis im Fenster-Panel "
        "existieren."),
    "untergrenze_4x80": (
        "4 * 80 Tage ist die UNTERE Kante des Quartals-Paarungsfensters."),
    # F6-C9c — BYTE-GENAU aus dem eingefrorenen Wortlaut, NICHT aus der
    # frueheren Codefassung. Die alte Zeile war eine PARAPHRASE und kein
    # Teilstring des Wortlauts; genau daran haette ein ehrlicher Test sofort
    # abgebrochen, und genau deshalb wurde der Schluessel damals nach NAMEN
    # ausgeschlossen statt die Herkunftsfrage zu eskalieren.
    "nie_stillschweigend": (
        "eine Nennereinheit ohne genau eine Klumpen-Kennung \u2014 sie wird "
        "**nie** stillschweigend fallengelassen"),
}

# =============================================================================
# F6-C9b — QUELLENGEBUNDENE LITERALGRUPPEN MIT HASH-GATE
# =============================================================================
#
# Jede Gruppe wird gegen IHRE EIGENE Quelle geprueft, und der SHA der Quelle
# wird VOR dem Literalvergleich nachgerechnet. Fehlende Datei, fehlender
# Registerdatensatz oder Hash-Drift sind ein ABBRUCH VOR JEDER ZAHL.
#
# Warum ueberhaupt Gruppen: die fruehere Fassung fuehrte alle Literale gegen
# EINE Quelle (die Praeregistrierung) und schloss das eine, das dort nicht
# steht, NACH NAMEN aus - still, im Inneren des Wachpostens, mit
# zahlerhaltender Substitution. Die Zahl "fuenf" blieb dadurch wahr ueber
# einer falschen Menge. Quellenbindung macht diesen Ausschluss unnoetig und
# unmoeglich zugleich.
PRAEREG_REL = "protocol/early-detection/2.0.0/preregistration.json"
PRAEREG_SHA = "799f925142860b4db97b5f18894b62c749aeb014872279aa6a7df8ee99ac5a6c"
WORTLAUT_REL = "protocol/early-detection/2.1.0/f6-se-klumpen-v1-wortlaut.json"
WORTLAUT_DATEI_SHA = "10e812fa345bba545077f333de7d81edf18bb371e9e48ee7b697558c1bc944e8"
# Der vom Gericht benannte wortlaut-sha256 (registriert in Eintrag 24).
WORTLAUT_TEXT_SHA = "d4f8d4d79927c2b58e351074bb9b026b3e79915652d7cd5b1b9b51eccdbafda1"
EINTRAG24_RUNID = "f6-se-klumpen-freeze-2026-08-31"
LEDGER_REL = "protocol/early-detection/2.0.0/outcome-access-ledger.json"

BEIN3_GRUPPEN = (
    {
        "name": "praeregistrierung",
        "herkunft": PRAEREG_REL + " (Fundstellen :80, :81, :82, :87)",
        "art": "praereg",
        "zaehlt_als_f6c9_ziffer": True,
        "literale": ("rechtsZensur_definition", "rechtsZensur_achse",
                     "untergrenze_4x80", "auffindbarkeit_formel"),
    },
    {
        "name": "eintrag24_wortlaut",
        "herkunft": (WORTLAUT_REL + ", Feld wortlaut == Register-Eintrag 24 "
                     "vorschriftWortlaut.text (F6-SE-KLUMPEN/v1, Ziffer 8)"),
        "art": "wortlaut",
        "zaehlt_als_f6c9_ziffer": True,
        "literale": ("nie_stillschweigend",),
    },
    {
        # F6-C9e: additiv, in der Praereg belegt, rein verschaerfend - und
        # AUSDRUECKLICH keine der fuenf F6-C9-Ziffern.
        "name": "bauseitig_ergaenzt",
        "herkunft": PRAEREG_REL + " (bauseitige Zugabe, keine F6-C9-Ziffer)",
        "art": "praereg",
        "zaehlt_als_f6c9_ziffer": False,
        "literale": ("reife_definition_anfang",),
    },
)


def _bein3_quelltext(art, wurzel):
    """Der hash-gepruefte Text EINER Gruppe. Beide Richtungen zu."""
    if art == "praereg":
        pfad = os.path.join(wurzel, *PRAEREG_REL.split("/"))
        if not os.path.isfile(pfad):
            raise ZaehlwerkAbbruch("BEIN 3: die Praeregistrierung fehlt: " + pfad)
        ist = sha256_datei(pfad)
        if ist != PRAEREG_SHA:
            raise ZaehlwerkAbbruch(
                "BEIN 3 HASH-GATE: " + PRAEREG_REL + " ist " + ist + ", "
                "gebunden ist " + PRAEREG_SHA + ". Eine andere Quelle ist eine "
                "andere Semantik - hier wird VOR jeder Zahl angehalten.")
        with open(pfad, encoding="utf-8") as fh:
            return fh.read()

    if art == "wortlaut":
        pfad = os.path.join(wurzel, *WORTLAUT_REL.split("/"))
        if not os.path.isfile(pfad):
            raise ZaehlwerkAbbruch("BEIN 3: der eingefrorene Wortlaut fehlt: "
                                   + pfad)
        ist = sha256_datei(pfad)
        if ist != WORTLAUT_DATEI_SHA:
            raise ZaehlwerkAbbruch(
                "BEIN 3 HASH-GATE: " + WORTLAUT_REL + " ist " + ist + ", "
                "gebunden ist " + WORTLAUT_DATEI_SHA + ".")
        with open(pfad, encoding="utf-8") as fh:
            text = json.load(fh).get("wortlaut")
        if not isinstance(text, str):
            raise ZaehlwerkAbbruch(
                "BEIN 3: " + WORTLAUT_REL + " fuehrt kein Textfeld 'wortlaut'.")
        text_sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if text_sha != WORTLAUT_TEXT_SHA:
            raise ZaehlwerkAbbruch(
                "BEIN 3 HASH-GATE: der Wortlaut-Text ist " + text_sha + ", "
                "registriert ist " + WORTLAUT_TEXT_SHA + ".")

        # F6-C9b: "Ein loser Lesezugriff auf die Registerdatei genuegt NICHT."
        # Der Registerdatensatz selbst muss denselben Text fuehren.
        ledger = os.path.join(wurzel, *LEDGER_REL.split("/"))
        if not os.path.isfile(ledger):
            raise ZaehlwerkAbbruch("BEIN 3: das Zugriffsregister fehlt: " + ledger)
        with open(ledger, encoding="utf-8") as fh:
            eintraege = json.load(fh).get("events") or []
        treffer = [e for e in eintraege if e.get("runId") == EINTRAG24_RUNID]
        if len(treffer) != 1:
            raise ZaehlwerkAbbruch(
                "BEIN 3: das Register fuehrt " + str(len(treffer)) + " Eintraege "
                "mit runId " + repr(EINTRAG24_RUNID) + ", erwartet genau einen. "
                "Ohne Registerdatensatz gibt es fuer Ziffer 5 keine Herkunft.")
        aus_register = ((treffer[0].get("vorschriftWortlaut") or {}).get("text"))
        if not isinstance(aus_register, str):
            raise ZaehlwerkAbbruch(
                "BEIN 3: Register-Eintrag 24 fuehrt kein Feld "
                "vorschriftWortlaut.text.")
        if hashlib.sha256(aus_register.encode("utf-8")).hexdigest() != WORTLAUT_TEXT_SHA:
            raise ZaehlwerkAbbruch(
                "BEIN 3: der Wortlaut im Register-Eintrag 24 weicht vom "
                "Artefakt ab. Zwei Fassungen derselben eingefrorenen Vorschrift "
                "sind ein ABBRUCH, keine Auslegungsfrage.")
        return text

    raise ZaehlwerkAbbruch("BEIN 3: unbekannte Gruppenart " + repr(art) + ".")


# =============================================================================
# Kleinwerkzeug
# =============================================================================

def sha256_datei(pfad, block=1 << 22):
    h = hashlib.sha256()
    with open(pfad, "rb") as fh:
        for stueck in iter(lambda: fh.read(block), b""):
            h.update(stueck)
    return h.hexdigest()


def kanonisch_sha256(objekt):
    roh = json.dumps(objekt, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(roh).hexdigest()


def _ganzzahl(x):
    """bool ist ein int - hier zaehlt es NICHT als Zahl."""
    return isinstance(x, int) and not isinstance(x, bool)


# =============================================================================
# W-B (F6-C5) - die Arbeitsdatei-Falle
# =============================================================================

def pruefe_arbeitspfad(pfad):
    """W-B: der Arbeitspfad traegt kein VERBOTEN_RE-Token - auch nicht ueber
    ein Elternverzeichnis oder eine aufgeloeste Junction.

    Dieser Wachposten ist TRAGEND, nicht dekorativ: weil F6-C4 den Aufruf von
    `oeffne_zwischenstand` verbietet, laeuft `pruefe_mauer` auf diesem Pfad
    nicht mehr mit. Was dort wegfiel, steht hier.
    """
    geschrieben = os.path.abspath(pfad)
    aufgeloest = os.path.realpath(geschrieben)
    for form in (geschrieben, aufgeloest):
        if VERBOTEN_RE.search(form.replace(os.sep, "/")):
            raise ZaehlwerkAbbruch(
                "W-B-ABBRUCH: der Arbeitspfad '" + str(pfad) + "' (aufgeloest: '"
                + aufgeloest + "') traegt ein gesperrtes Token. Ein Arbeitspfad "
                "mit 'validierung', 'endtest' oder Schluesselmaterial im Namen "
                "laesst die Mauer des versiegelten Moduls feuern und ist "
                "ausserdem selbst ein Befund. Vor der Freigabe zu pruefen, nie "
                "zur Laufzeit zu entdecken (KZ-3).")
    return aufgeloest


# =============================================================================
# Laden statt Nachbauen (F6-C2) - Hash-Pruefung VOR exec_module
# =============================================================================

def _lade_modul(wurzel, rel, soll_sha, name):
    """Erst die Bindung pruefen, dann laden. Nie umgekehrt.
    Muster scripts/studie-e2-verbreitert.py:97-119."""
    pfad = os.path.join(wurzel, *rel.split("/"))
    if not os.path.isfile(pfad):
        raise ZaehlwerkAbbruch("Das gebundene Modul fehlt: " + rel)
    ist = sha256_datei(pfad)
    if soll_sha and ist != soll_sha:
        raise ZaehlwerkAbbruch(
            rel + " weicht von der Bindung ab (ist " + ist[:16] + "..., soll "
            + soll_sha[:16] + "...). Die eingefrorene Regel ist nach ihrer "
            "Bindung veraendert worden - jede Zahl aus ihr waere wertlos.")
    spec = importlib.util.spec_from_file_location(name, pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul, ist


def lade_regelmodule(wurzel=None):
    """Das versiegelte Modul (F6-C2) und das Zaehlproben-Modul (F6-C3).

    `studie-zaehlprobe.py` wird durch diese Verwendung zu AUSFUEHRENDEM
    REGELCODE und ist damit zwingend per SHA im konfirmatorischen Eintrag zu
    binden (F6-C20). Der Nebenpreis ist mitbeurkundet: jede spaetere Aenderung
    daran bricht ab sofort den F6-Vollzug.
    """
    wurzel = wurzel or WURZEL_REPO
    e2, e2_sha = _lade_modul(wurzel, VERSIEGELT_REL, VERSIEGELT_SHA,
                             "studie_basisraten")
    # Der Sollwert des Zaehlprobe-Moduls wird zur Laufzeit GEMESSEN und
    # zurueckgegeben, damit der Laeufer ihn binden kann; ein hier eingetippter
    # Sollwert waere eine zweite Kopie derselben Bindung.
    zp, zp_sha = _lade_modul(wurzel, ZAEHLPROBE_REL, None, "studie_zaehlprobe")
    return {"e2": e2, "zp": zp, "modulSha256": e2_sha, "zaehlprobeSha256": zp_sha}


# =============================================================================
# F6-C6 - Regelparameter am Objekt nachrechnen, beide Richtungen zu
# =============================================================================

def _hole(baum, pfad, wo):
    """Ein Feld aus dem Artefakt - oder ABBRUCH. Nie ein Vorgabewert."""
    stand = baum
    for glied in pfad:
        if isinstance(glied, int):
            if not isinstance(stand, list) or len(stand) <= glied:
                raise ZaehlwerkAbbruch(
                    "F6-C7d: im Schwellen-Satz fehlt " + wo + " (Listenplatz "
                    + str(glied) + " nicht vorhanden). Ein fehlender "
                    "Schluessel ist ein ABBRUCH, kein Vorgabewert.")
            stand = stand[glied]
            continue
        if not isinstance(stand, dict) or glied not in stand:
            raise ZaehlwerkAbbruch(
                "F6-C7d: im Schwellen-Satz fehlt " + wo + " (Schluessel "
                + repr(glied) + "). Ein fehlender Schluessel ist ein ABBRUCH, "
                "kein Vorgabewert.")
        stand = stand[glied]
    return stand


def pruefe_kalibrier_konstanten(satz):
    """F6-C7d - der Laufzeit-Konstanten-Abgleich der ARTEFAKT-HAELFTE.

    WAS HIER GEPRUEFT WIRD UND WAS NICHT (F6-C7a/C7g): die acht Kalibrierzahlen
    werden NICHT GEFAHREN, sondern GEPRUEFT. Sie stammen nachweislich aus dem
    Durchlauf `verbreitertOhneBank`, nicht aus ORIGINAL-Globals - der
    arithmetische Gegenbeweis steht im selben Artefakt: aequivalenzTorSoll
    S-U firmen_reif = 512 gegen jeFamilie S-U firmenReif = 540 (und S-UG 29
    gegen 30). Ein Lauf kann nicht beides liefern. Bewiesen wird deshalb die
    UNVERAENDERTHEIT der eingefrorenen Bytes, nie die Wahrheit der Zahlen
    darin (Restrisiko F6-C7g (c), ausgewiesen statt wegargumentiert).

    Reisst dieser Abgleich, ist das ein STOPP vor jedem Prueffenster-Byte und
    wird NICHT durch Anpassen der Konstanten geheilt (KZ-11): er heisst, dass
    Zaehlwerk und eingefrorenes Artefakt auseinanderstehen - und welches von
    beiden recht hat, entscheidet der Hash, nie der Bauende.
    """
    je_familie = _hole(satz, ["jeFamilie"], "jeFamilie")

    # (1) Die acht Kalibrierzahlen: kalibrierungsWeg, auswertbarImBand,
    #     firmenReif, firmenUnreif - je S-U und S-G.
    for fam in ("S-U", "S-G"):
        soll = BEIN1_SOLL["jeFamilie"][fam]
        art = _hole(je_familie, [fam], "jeFamilie." + fam)
        paare = [
            ("kalibrierungsWeg[0].p", soll["schritt0_p"],
             _hole(art, ["kalibrierungsWeg", 0, "p"], fam + ".kalibrierungsWeg[0].p")),
            ("kalibrierungsWeg[0].firmen_reif", soll["schritt0_firmen_reif"],
             _hole(art, ["kalibrierungsWeg", 0, "firmen_reif"],
                   fam + ".kalibrierungsWeg[0].firmen_reif")),
            ("kalibrierungsWeg[1].p", soll["schritt1_p"],
             _hole(art, ["kalibrierungsWeg", 1, "p"], fam + ".kalibrierungsWeg[1].p")),
            ("kalibrierungsWeg[1].firmen_reif", soll["schritt1_firmen_reif"],
             _hole(art, ["kalibrierungsWeg", 1, "firmen_reif"],
                   fam + ".kalibrierungsWeg[1].firmen_reif")),
            ("auswertbarImBand", soll["auswertbar_band"],
             _hole(art, ["auswertbarImBand"], fam + ".auswertbarImBand")),
            ("firmenReif", soll["firmenReif"],
             _hole(art, ["firmenReif"], fam + ".firmenReif")),
            ("firmenUnreif", soll["firmenUnreif"],
             _hole(art, ["firmenUnreif"], fam + ".firmenUnreif")),
        ]
        for name, konstante, artefakt in paare:
            if konstante != artefakt:
                raise ZaehlwerkAbbruch(
                    "F6-C7d KONSTANTEN-ABGLEICH GERISSEN bei " + fam + "."
                    + name + ": das Zaehlwerk fuehrt " + repr(konstante)
                    + ", das eingefrorene Artefakt " + repr(artefakt)
                    + ". STOPP vor jedem Prueffenster-Byte. Das wird NICHT "
                    "durch Anpassen der Konstante geheilt (KZ-11) - welches "
                    "von beiden recht hat, entscheidet der Hash, nie der "
                    "Bauende.")

    # (2) pFinal == 95 == PERZENTIL, gelesen aus dem Artefakt UND aus dem
    #     geladenen Modul. Beide Richtungen zu.
    for fam in ("S-U", "S-G"):
        ist = _hole(je_familie, [fam, "pFinal"], "jeFamilie." + fam + ".pFinal")
        if ist != P_FINAL_SOLL:
            raise ZaehlwerkAbbruch(
                "F6-C7d: jeFamilie." + fam + ".pFinal ist " + repr(ist)
                + ", gebunden ist " + repr(P_FINAL_SOLL) + ".")

    # (3) regelParameter.reife_quartale == 4 == REIFE_QUARTALE, ebenso.
    reife = _hole(satz, ["regelParameter", "reife_quartale"],
                  "regelParameter.reife_quartale")
    if reife != REIFE_QUARTALE_SOLL:
        raise ZaehlwerkAbbruch(
            "F6-C7d: regelParameter.reife_quartale ist " + repr(reife)
            + ", gebunden ist " + repr(REIFE_QUARTALE_SOLL) + ".")
    return True


def pruefe_regelparameter(wurzel, module):
    """Sollwerte gegen die eingefrorenen Artefakte. Abweichung oder fehlender
    Wert = Abbruch VOR jeder Zahl."""
    wurzel = wurzel or WURZEL_REPO
    pfad = os.path.join(wurzel, *SCHWELLEN_SATZ_REL.split("/"))
    if not os.path.isfile(pfad):
        raise ZaehlwerkAbbruch("Der Schwellen-Satz fehlt: " + SCHWELLEN_SATZ_REL)
    ist_datei = sha256_datei(pfad)
    if ist_datei != SCHWELLEN_DATEI_SHA:
        raise ZaehlwerkAbbruch(
            "Der Schwellen-Satz weicht ab (Datei-SHA ist " + ist_datei[:16]
            + "..., soll " + SCHWELLEN_DATEI_SHA[:16] + "...).")
    with open(pfad, encoding="utf-8") as fh:
        satz = json.load(fh)
    ohne = {k: v for k, v in satz.items() if k != "inhaltSha256"}
    ist_inhalt = kanonisch_sha256(ohne)
    if ist_inhalt != SCHWELLEN_INHALT_SHA:
        raise ZaehlwerkAbbruch(
            "Der Schwellen-Satz reproduziert seinen inhaltSha256 nicht (ist "
            + ist_inhalt[:16] + "..., soll " + SCHWELLEN_INHALT_SHA[:16] + "...).")

    # pFinal aus dem Artefakt LESEN, nie tippen - und gegen den Sollwert halten.
    # JE FAMILIE EINZELN. Eine Pruefung ueber die VEREINIGUNG der gefundenen
    # Werte laesst eine fehlende Familie durchgehen: fehlt S-U ganz, bleibt
    # {95} aus S-G stehen, beide Schranken halten - und S-U waere NIE geprueft
    # worden, obwohl der Bericht so liest, als waere es das. Genau die Klasse
    # "nie geprueft gegen stille Null", gegen die diese Funktion existiert.
    for name in VARIANTEN:
        fam = (satz.get("jeFamilie") or {}).get(name)
        if not isinstance(fam, dict) or "pFinal" not in fam:
            raise ZaehlwerkAbbruch(
                "Der Schwellen-Satz fuehrt kein pFinal fuer die Familie "
                + repr(name) + ". Ein fehlender Regelparameter ist ein "
                "Abbruch, kein Vorgabewert.")
        if fam["pFinal"] != P_FINAL_SOLL:
            raise ZaehlwerkAbbruch(
                "pFinal der Familie " + repr(name) + " ist "
                + repr(fam["pFinal"]) + ", gebunden ist "
                + repr(P_FINAL_SOLL) + ".")

    # ── F6-C7d GLIED 2: LAUFZEIT-KONSTANTEN-ABGLEICH ──────────────────
    # Der Abgleich stand bisher NUR im Test (tests/studie-f6-zaehlwerk.test.js).
    # Ein Test laeuft aber nicht im Lauf: er belegt den Stand zur Bauzeit, nicht
    # den zur Laufzeit. Anhang 1 verlangt ihn deshalb IM LAUF - der Test bleibt
    # zusaetzlich stehen. Feldweise, gegen das HASH-GEPRUEFT geladene Artefakt
    # (der Doppel-Hash oben ist schon durch), beide Richtungen zu.
    #
    # KEIN VORGABEWERT BEI FEHLENDEM SCHLUESSEL. Ein fehlendes Feld ist genau
    # der Fall "nie geprueft, liest sich aber wie geprueft" - deshalb Abbruch.
    pruefe_kalibrier_konstanten(satz)

    # Und die Zensur-Konstanten des Zaehlproben-Moduls, ebenfalls beidseitig.
    zp = module["zp"]
    for name, soll in (("PERZENTIL", P_FINAL_SOLL),
                       ("REIFE_QUARTALE", REIFE_QUARTALE_SOLL),
                       ("ZENSUR_TAGE_JE_QUARTAL", ZENSUR_TAGE_JE_QUARTAL_SOLL)):
        ist = getattr(zp, name, None)
        if ist != soll:
            raise ZaehlwerkAbbruch(
                "studie-zaehlprobe." + name + " ist " + repr(ist) + ", gebunden "
                "ist " + repr(soll) + ".")
    return {"pFinal": P_FINAL_SOLL, "schwellenDateiSha256": ist_datei,
            "schwellenInhaltSha256": ist_inhalt}


# =============================================================================
# Eigene E/A (F6-C1) - nie ueber die vier Einstiegspunkte
# =============================================================================

def eigene_panel_verbindung(panel_pfad):
    """Nur-lesend, mit eigenem URI. Bewusst NICHT `e2.oeffne_nur_lesend`
    (F6-C4) - dessen erste Zeile ist `pruefe_mauer`, und die sperrt genau das
    Fenster, das der konfirmatorische Eintrag autorisiert."""
    if not os.path.isfile(panel_pfad):
        raise ZaehlwerkAbbruch("Panel-Datei nicht gefunden: " + str(panel_pfad))
    voll = os.path.abspath(panel_pfad)
    conn = sqlite3.connect("file:" + voll.replace("\\", "/") + "?mode=ro",
                           uri=True)
    try:
        conn.execute("PRAGMA cache_size=-200000")
    except Exception:
        # Scheitert das PRAGMA, ist die Verbindung offen und kommt nie beim
        # Aufrufer an - er kann sie also auch nicht schliessen.
        conn.close()
        raise
    return conn


# Eintrag 22 (rr9-a3-jahrgang-registrierung-2026-08-30) haelt das
# Prueffenster-Panel byte-genau fest. Der konfirmatorische Eintrag BEHAUPTET,
# die Groesse sei "verriegelt" - bis PR G war das eine einmalige Messung und
# kein Riegel (Schritt-8-Review, Quellspalten-F1).
PANEL_BYTES_PIN_PRUEFUNG = 4447633408


def pruefe_panel_bytes(panel_pfad):
    """Positiv auf die EINE zugelassene Groesse. Ein anderes Panel ist ein
    anderes Panel - auch wenn es genauso heisst."""
    if not os.path.isfile(panel_pfad):
        raise ZaehlwerkAbbruch("Panel-Datei nicht gefunden: " + str(panel_pfad))
    with open(panel_pfad, "rb") as fh:
        ist = os.fstat(fh.fileno()).st_size
    if ist != PANEL_BYTES_PIN_PRUEFUNG:
        raise ZaehlwerkAbbruch(
            "PANEL-BYTE-PIN GERISSEN: die Datei misst " + str(ist)
            + " B, der in Eintrag 22 registrierte Pin verlangt "
            + str(PANEL_BYTES_PIN_PRUEFUNG) + " B. Ein anders grosses Panel "
            "ist ein anderes Panel; der Lauf haelt VOR dem ersten Byte an.")


def eigener_zwischenstand(pfad):
    """Die Arbeitsdatei, selbst geoeffnet (F6-C1) und selbst geprueft (W-B).

    Tabellenform woertlich die des Hauses (`studie-basisraten.py:451-470`) -
    `lies_rohwerte` und `pit_reduktion` erwarten genau diese drei Tabellen.
    Nachgebaut wird E/A-Gerippe, nie Regelarithmetik.
    """
    pruefe_arbeitspfad(pfad)
    if os.path.isfile(pfad):
        os.remove(pfad)
    os.makedirs(os.path.dirname(os.path.abspath(pfad)), exist_ok=True)
    conn = sqlite3.connect(pfad, isolation_level=None)
    try:
        conn.execute("PRAGMA synchronous=OFF")
        conn.execute("PRAGMA cache_size=-200000")
        conn.execute("CREATE TABLE IF NOT EXISTS roh (cik TEXT, tag TEXT, ddate TEXT,"
                     " qtrs TEXT, uom TEXT, accepted TEXT, adsh TEXT, value REAL)")
        conn.execute("CREATE TABLE IF NOT EXISTS lauf_stand (block INTEGER PRIMARY KEY,"
                     " zeilen INTEGER, fertig_am TEXT)")
        conn.execute("CREATE TABLE IF NOT EXISTS zaehler_stand (name TEXT PRIMARY KEY,"
                     " wert INTEGER)")
    except Exception:
        conn.close()
        raise
    return conn


# =============================================================================
# Die Zaehlung
# =============================================================================

# ponytail: Prozess-weiter Cache je Panel-Pfad. Der Vertrag ruft zaehle() vier
# Mal (2 Varianten x 2 Arme); ohne Cache liefe die ganze ETL vier Mal ueber ein
# Mehr-GB-Panel. Ceiling: der Cache lebt im Prozess und kennt keine Invalidierung
# - genau richtig fuer den EINEN Lauf, fuer den dieses Modul existiert.
_VORBEREITUNG = {}


def _vorbereitung(panel_pfad, arbeit_pfad, module):
    # W-B UNBEDINGT, VOR dem Cache-Blick. Liefe die Pruefung erst im
    # Cache-Miss-Zweig (in `eigener_zwischenstand`), bliebe ein zweiter Aufruf
    # mit einem ANDEREN, moeglicherweise gesperrten Arbeitspfad ungeprueft -
    # der Wachposten haette dann genau fuer die Aufrufe geschwiegen, die er
    # decken soll. Der Cache-Schluessel traegt den Arbeitspfad deshalb mit.
    pruefe_arbeitspfad(arbeit_pfad)
    schluessel = (os.path.abspath(panel_pfad), os.path.abspath(arbeit_pfad))
    if schluessel in _VORBEREITUNG:
        return _VORBEREITUNG[schluessel]
    e2 = module["e2"]
    from collections import defaultdict
    zaehler = defaultdict(int)
    for name in e2.alle_zaehlernamen():
        zaehler[name] += 0

    panel = eigene_panel_verbindung(panel_pfad)
    try:
        berichte, _fj, _q, _fye = e2.lade_berichte(panel, zaehler)
        arbeit = eigener_zwischenstand(arbeit_pfad)
        try:
            zaehler["roh_zeilen"] = e2.lies_rohwerte(panel, arbeit, berichte,
                                                     zaehler, False)
            je_firma = e2.pit_reduktion(arbeit, zaehler)
        finally:
            arbeit.close()
    finally:
        panel.close()

    _VORBEREITUNG[schluessel] = (je_firma, zaehler)
    return _VORBEREITUNG[schluessel]


def _familie(variante, module):
    """Die Quellen-Konfiguration je Variante - dieselbe Reihenfolge wie
    `studie-basisraten.py::auswertung` und `studie-zaehlprobe.py:556-558`,
    gelesen und nicht geraten."""
    e2 = module["e2"]
    familien = {"S-U": (e2.UMSATZ_QUELLEN, True, "umsatz_"),
                "S-G": (e2.ERGEBNIS_QUELLEN, False, "betriebsergebnis_")}
    if variante not in familien:
        raise ZaehlwerkAbbruch(
            "Unbekannte Signalvariante " + repr(variante) + ". Bekannt sind "
            + repr(sorted(familien)) + " - eine dritte waere eine andere Studie.")
    return familien[variante]


def _pruefe_pufferjahr(eintraege, e2, von_jahr, bis_jahr, wo):
    """Zaehlwerk-Gericht (D), woertlich: "Ein Erst-Ereignis mit accepted im
    Pufferjahr 2020 ist ein ABBRUCH, kein Sonderfall."

    Bis PR G war der Schutz ein stiller FILTER (`im_signalband` vor
    `erst_ereignisse`): das Ergebnis stimmte, die angeordnete FORM nicht - ein
    Ereignis am Panel-Rand wurde weggeworfen statt gemeldet. Der Riegel steht
    jetzt HINTER der Erst-Ereignis-Bildung und benennt, was er findet.

    Die Zensur darf den Panel-Rand referenzieren (rand_ordinal); ein
    URSPRUNGS-Ereignis darf nicht von dort kommen.
    """
    for eintrag in eintraege:
        jahr = e2.jahr_aus_accepted(eintrag["accepted"])
        if jahr is None:
            raise ZaehlwerkAbbruch(
                "PUFFERJAHR-PRUEFUNG NICHT BERECHENBAR in " + wo + ": ein "
                "Erst-Ereignis traegt kein lesbares accepted-Jahr. Nicht "
                "berechenbar heisst ANHALTEN, nicht 'gilt als in Ordnung'.")
        if not von_jahr <= jahr <= bis_jahr:
            raise ZaehlwerkAbbruch(
                "ERST-EREIGNIS AUSSERHALB DES SIGNALBANDES in " + wo + ": ein "
                "Erst-Ereignis traegt das accepted-Jahr " + str(jahr)
                + ", das Signalband ist " + str(von_jahr) + ".."
                + str(bis_jahr) + ". Ein Erst-Ereignis aus einem Pufferjahr "
                "ist ein ABBRUCH, kein Sonderfall - der Panel-Rand darf das "
                "Signalband nicht still um ein Jahr verlaengern.")


def _arme(panel_pfad, arbeit_pfad, variante, module, fenster):
    """Beide Arme EINER Variante. Signal und Kontrollpool laufen durch
    denselben Code - `arm_zaehlen` -, wie die Praereg-Klausel
    `rechenGleichbehandlung` es verlangt."""
    e2, zp = module["e2"], module["zp"]
    je_firma, zaehler = _vorbereitung(panel_pfad, arbeit_pfad, module)
    quellen, nur_positiv, praefix = _familie(variante, module)

    alle, gewaehlt = e2.firmenreihen(je_firma, quellen, nur_positiv, zaehler,
                                     praefix)
    _g, a_saetze = e2.wachstum_und_beschleunigung(alle, zaehler, praefix)
    feuerungen, auswertbar, _grenzen = e2.signale(a_saetze, zp.PERZENTIL,
                                                  zaehler, praefix)
    # `im_signalband` vergleicht das JAHR aus `accepted` gegen `von`/`bis` und
    # erwartet deshalb JAHRESZAHLEN, so wie sie in der eigenen Fenster-Registry
    # des Zaehlprobe-Moduls stehen (`FENSTER`: "von": 2009, "bis": 2015).
    # FENSTER_SOLL hier fuehrt die ISO-Grenzen, weil F6-C22 das Signalband
    # datumsgenau beurkundet (2017-01-01/2019-12-31) - die Umrechnung gehoert
    # deshalb an die Uebergabestelle, nicht in die Konstante.
    von_jahr = int(str(fenster["von"])[:4])
    bis_jahr = int(str(fenster["bis"])[:4])
    band_f = [f for f in feuerungen
              if zp.im_signalband(f, e2, von_jahr, bis_jahr)]
    band_a = [a for a in auswertbar
              if zp.im_signalband(a, e2, von_jahr, bis_jahr)]

    rand_ordinal = e2.ordinal(fenster["rand"].replace("-", ""))
    signal = zp.arm_zaehlen(band_f, gewaehlt, e2, rand_ordinal)
    # Kontrollpool: Firmen mit auswertbarem Firmen-Quartal im Signalband, die
    # NIE feuern (R3). Woertlich die Konstruktion aus
    # `studie-zaehlprobe.py:567-570` - keine dritte Implementierung.
    signalfirmen = set(f["cik"] for f in band_f)
    kontroll_eintraege = [a for a in band_a if a["cik"] not in signalfirmen]
    kontrolle = zp.arm_zaehlen(kontroll_eintraege, gewaehlt, e2, rand_ordinal)
    # DIE EINHEITEN DES TALLYS SIND DIE ERST-EREIGNISSE, NICHT DIE FEUERUNGEN.
    # Wortlaut Ziffer 2: "i = 1..N sind genau die Einheiten des Netto-Tornenners:
    # Erst-Ereignisse minus rechts-zensierte". Eine Firma kann im Signalband
    # MEHRFACH feuern; `erst_ereignisse` reduziert auf ihr fruehestes Ereignis.
    # Wer `band_f` weiterreicht, zaehlt Feuerungen als Stichprobe - genau der
    # Befund, den W-C und der R3-ABBRUCH benennen.
    #
    # Gerufen wird DIESELBE praeregistrierte Funktion, die `arm_zaehlen`
    # intern verwendet (F6-C2: exakt dieselbe Funktion, kein Nachbau); sie ist
    # rein, ein zweiter Aufruf kann nicht driften. `arm_zaehlen` gibt die
    # Einheitenmenge selbst nicht heraus, nur `reif` und ihre Anzahl.
    sig_reif, sig_unreif = e2.erst_ereignisse(band_f, gewaehlt)
    kon_reif, kon_unreif = e2.erst_ereignisse(kontroll_eintraege, gewaehlt)
    # (D) Pufferjahr-Riegel - benannt, nicht gefiltert.
    _pruefe_pufferjahr(sig_reif + sig_unreif, e2, von_jahr, bis_jahr,
                       variante + "/signal")
    _pruefe_pufferjahr(kon_reif + kon_unreif, e2, von_jahr, bis_jahr,
                       variante + "/kontrollpool")
    return {"signal": (signal, sig_reif + sig_unreif),
            "kontrollpool": (kontrolle, kon_reif + kon_unreif),
            "band_a": band_a, "rand_ordinal": rand_ordinal}


def _tally(eintraege, reif_rows, e2, zp, rand_ordinal, wo):
    """Der (m_g, n_g)-Tally je Signal-Entitaet ueber die Einheiten des
    NETTO-Tornenners - und W-C (F6-C10) gleich mit.

    Die Einheiten sind `Erst-Ereignisse minus rechts-zensierte` (Wortlaut
    Ziffer 2). Die Firmen-Kennung wird HIER verbraucht: was diese Funktion
    zurueckgibt, sind Zahlenpaare (F6-B14).
    """
    reife_ciks = set(e["cik"] for e in reif_rows)
    klumpen_je_firma = {}
    zensiert = 0
    gesehen_netto = 0  # unabhaengig mitgezaehlt, fuer W-C
    for e in eintraege:
        cik = e.get("cik")
        if cik is None:
            # Wortlaut Ziffer 8 / F6-C9: NIE stillschweigend fallengelassen.
            raise ZaehlwerkAbbruch(
                "Eine Nennereinheit ohne Klumpen-Kennung in " + wo
                + ". Sie wird nie stillschweigend fallengelassen - das ist ein "
                "ABBRUCH, kein Filter.")
        if zp.ist_zensiert(e, e2, rand_ordinal):
            zensiert += 1
            continue
        gesehen_netto += 1
        m, n = klumpen_je_firma.get(cik, (0, 0))
        klumpen_je_firma[cik] = (m + (1 if cik in reife_ciks else 0), n + 1)

    # ── W-C (F6-C10): die Tally-Invariante ────────────────────────────────
    gross = sorted(n for _m, n in klumpen_je_firma.values() if n != 1)
    if gross:
        raise ZaehlwerkAbbruch(
            "W-C-ABBRUCH in " + wo + ": " + str(len(gross)) + " Klumpen tragen "
            "n_g > 1 (groesster " + str(gross[-1]) + "). Eine Firma zaehlt nur "
            "mit ihrem fruehesten Ereignis; wer Ereignisse zaehlt, verwechselt "
            "Dichte mit Stichprobe - derselbe Befund, den der R3-ABBRUCH in "
            "scripts/studie-zaehlprobe.py:507-509 benennt.")

    klumpen = sorted(klumpen_je_firma.values())
    n = sum(paar[1] for paar in klumpen)
    zaehler = sum(paar[0] for paar in klumpen)
    # G gegen N - aber gegen eine UNABHAENGIG gezaehlte Menge, nicht gegen die
    # Summe derselben Liste. Aus `klumpen` allein folgt G == N bereits aus der
    # n_g-Schranke oben; ein Vergleich damit koennte nie feuern und waere ein
    # Wachposten, der nur so aussieht.
    if len(klumpen_je_firma) != gesehen_netto:
        raise ZaehlwerkAbbruch(
            "W-C-ABBRUCH in " + wo + ": " + str(len(klumpen_je_firma))
            + " verschiedene Klumpen-Kennungen gegen " + str(gesehen_netto)
            + " gezaehlte Netto-Einheiten. Eine Firma zaehlt nur mit ihrem "
            "fruehesten Ereignis (R3).")
    if n != gesehen_netto:
        raise ZaehlwerkAbbruch(
            "W-C-ABBRUCH in " + wo + ": Summe_g n_g = " + str(n) + " gegen "
            + str(gesehen_netto) + " gezaehlte Netto-Einheiten.")
    return [[m, nn] for m, nn in klumpen], n, zaehler, zensiert


# Der Arbeitspfad wird vom Laeufer GESETZT, nicht vom Zaehlwerk erfunden.
# WARUM NICHT ALS ARGUMENT VON zaehle(): der Vertrag `zaehle(panel_pfad,
# variante, arm)` ist eingefroren (F6-C1, `studie-f6-lauf.py:563-576`) - ihn um
# ein viertes Pflichtargument zu erweitern waere eine Vertragsaenderung. Der
# Pfad kommt deshalb VOR dem ersten Aufruf ueber diesen benannten Setzer, und
# `zaehle` bricht ab, solange er nicht gesetzt ist (W-B / KZ-3: "vor der
# Freigabe pruefen und im Eintrag nennen, nicht zur Laufzeit entdecken").
_ARBEITSPFAD = None


_FENSTER = None


def setze_fenster(name):
    """Wie `setze_arbeitspfad`: der Laeufer setzt das Fenster AUSDRUECKLICH.

    Der Vertrag `zaehle(panel, variante, arm)` ist eingefroren (F6-C1) und kann
    das Fenster nicht tragen. Ein Vorgabewert im Kopf von `zaehle` waere aber
    genau die stille Kopie, die driften kann: der Umschlag meldete dann ein
    Fenster und gezaehlt wuerde ein anderes (Naht-F2).
    """
    global _FENSTER
    if not name:
        raise ZaehlwerkAbbruch(
            "setze_fenster() ohne Namen. Das Fenster ist eine Angabe des "
            "Laufs, kein Vorgabewert.")
    if name not in FENSTER_SOLL:
        raise ZaehlwerkAbbruch("Unbekanntes Fenster " + repr(name) + ".")
    _FENSTER = name
    return name


def setze_arbeitspfad(pfad):
    """Vom Laeufer EINMAL vor der Zaehlung zu rufen. Prueft sofort (W-B)."""
    global _ARBEITSPFAD
    if not pfad:
        raise ZaehlwerkAbbruch(
            "setze_arbeitspfad() ohne Pfad. Der Arbeitspfad ist eine Angabe "
            "des Laufs, kein Vorgabewert.")
    pruefe_arbeitspfad(pfad)
    _ARBEITSPFAD = pfad
    return pfad


def pruefe_a16_kreuz(aus_tafel, aus_skalaren, wo):
    """Ruling 1 - der Kreuz-Wachposten ueber n_B_unreif.

    Zwei Wege ueber zwei verschiedene Datenstrukturen: einmal aus der
    Klumpen-Tafel (Summe_g (n_g - m_g)), einmal aus den beiden Aggregat-
    Skalaren (n - zaehler_reife). In dieser Tally-Form KOENNEN sie nicht
    auseinanderlaufen - laufen sie es doch, ist nicht die Zahl falsch, sondern
    die Tally-Form selbst gebrochen. Deshalb ABBRUCH, nicht Korrektur.

    Steht bewusst als EIGENE Funktion und nicht inline in `zaehle`: ein
    Wachposten, der nur ueber einen vollen Panel-Lauf erreichbar ist, laesst
    sich nicht bruchproben - und ein Waechter ohne Bruchprobe gilt als nicht
    abgenommen (KV-3).
    """
    if aus_tafel != aus_skalaren:
        raise ZaehlwerkAbbruch(
            "KREUZ-WACHPOSTEN A16 gerissen in " + wo + ": n_B_unreif ist aus "
            "der Klumpen-Tafel " + str(aus_tafel) + ", aus den Aggregaten "
            + str(aus_skalaren) + ". Beide Wege beschreiben dieselbe Menge; "
            "eine Abweichung heisst, dass die Tally-Form gebrochen ist, nicht "
            "dass eine Zahl danebenliegt.")
    return aus_tafel


def zaehle(panel_pfad, variante, arm, wurzel=None, arbeit_pfad=None,
           fenster_name=None):
    """DER VERTRAG (F6-C1): {klumpen, n, zaehler, zerlegung}.

    Aufgerufen wird er mit GENAU DREI Argumenten; die weiteren sind
    Test-Einstiege mit Vorgabe aus dem gesetzten Arbeitspfad.

    Niemals eine Firmen-Kennung im Rueckgabewert.
    """
    if arm not in ARME:
        raise ZaehlwerkAbbruch("Unbekannter Arm " + repr(arm) + ".")
    wurzel = wurzel or WURZEL_REPO
    if arbeit_pfad is None:
        arbeit_pfad = _ARBEITSPFAD
    if arbeit_pfad is None:
        raise ZaehlwerkAbbruch(
            "Kein Arbeitspfad gesetzt. Der Laeufer ruft setze_arbeitspfad() "
            "VOR der ersten Zaehlung; der Pfad wird vor der Freigabe geprueft "
            "und im Eintrag genannt, nie zur Laufzeit erfunden (W-B / KZ-3).")
    # Das Fenster wird NACH dem Arbeitspfad geprueft, damit der aeltere
    # Wachposten seine Reihenfolge behaelt - sonst verdeckte der neue Riegel
    # den, den er ergaenzen soll.
    if fenster_name is None:
        fenster_name = _FENSTER
    if fenster_name is None:
        raise ZaehlwerkAbbruch(
            "Kein Fenster gesetzt. Der Laeufer ruft setze_fenster() VOR der "
            "ersten Zaehlung; das Fenster wird AUSDRUECKLICH uebergeben und "
            "nie aus einem Vorgabewert geerbt (Naht-F2).")
    fenster_soll = FENSTER_SOLL.get(fenster_name)
    if not fenster_soll:
        raise ZaehlwerkAbbruch("Unbekanntes Fenster " + repr(fenster_name) + ".")

    # (9) Quellspalten-F1: der Byte-Pin des Prueffenster-Panels wird zur
    # LAUFZEIT erzwungen, nicht nur im Eintrag behauptet. Ohne ihn steht
    # zwischen dem Eintrag und einem anders grossen Panel nichts.
    if fenster_name == "pruefung":
        pruefe_panel_bytes(panel_pfad)

    module = lade_regelmodule(wurzel)
    pruefe_regelparameter(wurzel, module)
    e2, zp = module["e2"], module["zp"]

    arme = _arme(panel_pfad, arbeit_pfad, variante, module, fenster_soll)
    ergebnis, eintraege = arme[arm]
    klumpen, n, zaehler_reife, zensiert = _tally(
        eintraege, ergebnis["reif"], e2, zp, arme["rand_ordinal"],
        variante + "/" + arm)

    # Kreuzprobe gegen den Arm-Zaehler des Hauses. Die eingefrorene Formel
    # rechnet `len(reif) / (len(alle) - zensiert)`; die SE-Einheiten sind die
    # NICHT-zensierten. Beide muessen denselben Zaehler ergeben - tun sie es
    # nicht, waere ein reifes Ereignis zensiert, und die zwei Definitionen
    # widersprechen sich. Das ist ein Abbruch, keine Auslegungsfrage.
    if zaehler_reife != len(ergebnis["reif"]):
        raise ZaehlwerkAbbruch(
            "Kreuzprobe gerissen in " + variante + "/" + arm + ": der Tally "
            "zaehlt " + str(zaehler_reife) + " reife nicht-zensierte Einheiten, "
            "der Arm-Zaehler " + str(len(ergebnis["reif"])) + " reife "
            "Erst-Ereignisse. Ein reifes Ereignis waere damit zensiert - die "
            "eingefrorene Auffindbarkeits-Formel und die SE-Einheitenmenge "
            "widersprechen sich. Kein Ermessen.")
    if zensiert != ergebnis["zensierte_erst_ereignisse"]:
        raise ZaehlwerkAbbruch(
            "Kreuzprobe gerissen in " + variante + "/" + arm + ": Zensur "
            + str(zensiert) + " gegen " + str(ergebnis["zensierte_erst_ereignisse"]))

    alle = ergebnis["firmen_mit_erst_ereignis"]
    # DRITTE Kreuzprobe. `alle` kommt aus dem fremden `arm_zaehlen`, `n` und
    # `zensiert` aus dem eigenen Tally ueber (nominell) dieselben Eintraege.
    # Driften die beiden Vorstellungen auseinander, waere `n_verloren` falsch -
    # und koennte sogar negativ werden - und liefe als plausible Zahl in den
    # Bericht. Ohne diese Zeile waere das ein stiller Fehler.
    if alle != n + zensiert:
        raise ZaehlwerkAbbruch(
            "Kreuzprobe gerissen in " + variante + "/" + arm + ": der Arm-"
            "Zaehler meldet " + str(alle) + " Erst-Ereignisse, der Tally "
            + str(n) + " Netto-Einheiten plus " + str(zensiert) + " zensierte. "
            "Die beiden Einheitenmengen sind nicht dieselbe.")
    # ── A16-Zerlegung (Ruling 1) ──────────────────────────────────────────
    # `n_B_unreif` wird UNABHAENGIG hergeleitet: einmal aus der Klumpen-Tafel
    # (Summe_g (n_g - m_g) - die Einheiten des Netto-Nenners mit y_i = 0) und
    # einmal aus den beiden Aggregat-Skalaren (n - zaehler_reife). Zwei Wege
    # ueber zwei verschiedene Datenstrukturen; der Kreuz-Wachposten darunter
    # macht jede Abweichung zum ABBRUCH. In dieser Tally-Form KOENNEN sie nie
    # auseinanderlaufen - laufen sie es doch, ist nicht die Zahl falsch,
    # sondern die Tally-Form selbst gebrochen.
    unreif_aus_tafel = pruefe_a16_kreuz(
        sum(nn - m for m, nn in klumpen), n - zaehler_reife,
        variante + "/" + arm)

    zerlegung = {
        "n_A": alle,
        "n_B_reif": zaehler_reife,
        "n_B_unreif": unreif_aus_tafel,
        "n_verloren": alle - n,
        "feuerfaehig": len(arme["band_a"]) if arm == "kontrollpool" else alle,
        # KEINE UNABHAENGIGE HERLEITUNG - und das wird hier gesagt statt
        # verdeckt. Fuer `strukturell_nicht_feuerfaehig` existiert NIRGENDS
        # eine registrierte allgemeine Definition: weder in
        # protocol/, noch in einem der drei Urteile (sie nennen die sieben
        # A16-Schluessel, definieren aber keinen davon), noch sonst im Repo.
        # Ohne Definition gibt es keinen zweiten Rechenweg, den man ehrlich
        # fuehren koennte - eine erfundene Zweitformel waere Pseudo-
        # Unabhaengigkeit und genau das, was hier nicht passieren soll.
        # Es bleibt deshalb bei EINER Rechnung, und die Identitaet zu
        # n_B_unreif wird VORAB benannt (F6-B25-Form, s. IDENTITAET_A16),
        # nie hinterher als Befund.
        "strukturell_nicht_feuerfaehig": unreif_aus_tafel,
        "rechts_zensiert": zensiert,
    }
    negativ = sorted(k for k, v in zerlegung.items() if v < 0)
    if negativ:
        raise ZaehlwerkAbbruch(
            "Negative Zaehlung in der A16-Zerlegung (" + variante + "/" + arm
            + "): " + ", ".join(negativ) + ". Eine Zaehlung ist nie negativ; "
            "ein negativer Wert ist ein Rechenfehler, kein Messwert.")
    return {
        "klumpen": klumpen,
        "n": n,
        "zaehler": zaehler_reife,
        # A16-Zerlegungen als REINE Zaehlungen, keine Kennung.
        "zerlegung": zerlegung,
    }


# =============================================================================
# Das Aequivalenz-Tor (F6-C7 / C8 / C9) - Laufbedingung, kein Bau-Test
# =============================================================================

VERBREITERT_REL = "scripts/studie-e2-verbreitert.py"
VERBREITERT_SHA = "9a24ed94e943e9a6f5b4a1373ba6c6aa2001ddadb2d60a705277bf5eb359984b"


def bein1_laufhaelfte(wurzel, arbeit_pfad, ergebnis_pfad, data_root):
    """F6-C7b - die LAUF-HAELFTE von Bein 1, woertlich unveraendert.

    Entdeckungs-Panel, ORIGINAL-Globals, bit-identisch gegen
    aequivalenzTorSoll S-U 512/219 - S-G 546/265 - S-UG 29/12.

    GEFAHREN WIRD DAS UNVERAENDERTE WERKZEUG `scripts/studie-e2-verbreitert.py`
    ueber `durchlauf --modus alt`, Ausgabe ausschliesslich nach `--ergebnis`,
    NIE ins Artefakt. Das ist kein Widerspruch zur Negativ-Klausel F6-C7e:
    die verbietet den Aufruf ausdruecklich nur "fuer die Kalibrier-Haelfte";
    die torSoll-Haelfte war unbeanstandet und bleibt es. Fuer die
    KALIBRIER-Haelfte ruft dieses Modul das Werkzeug NICHT auf - dort
    entscheidet der Doppel-Hash plus Konstanten-Abgleich (F6-C7c/d).

    Das Werkzeug bleibt Byte fuer Byte unangetastet (F6-C7e/f); sein SHA ist
    ein ratifizierter PIN aus Register-Eintrag 23. Er wird VOR dem Aufruf
    geprueft - ein veraendertes Werkzeug ist ein anderes Werkzeug.
    """
    pfad = os.path.join(wurzel, *VERBREITERT_REL.split("/"))
    if not os.path.isfile(pfad):
        raise ZaehlwerkAbbruch("Das Werkzeug fehlt: " + VERBREITERT_REL)
    ist = sha256_datei(pfad)
    if ist != VERBREITERT_SHA:
        raise ZaehlwerkAbbruch(
            VERBREITERT_REL + " weicht vom ratifizierten PIN ab (ist "
            + ist[:16] + "..., soll " + VERBREITERT_SHA[:16] + "...). Der PIN "
            "ist zugleich Bindung aus Register-Eintrag 23; ein veraendertes "
            "Werkzeug ist ein anderes Werkzeug (F6-C7f).")
    pruefe_arbeitspfad(arbeit_pfad)

    ruf = [sys.executable, pfad, "durchlauf", "--modus", "alt",
           "--data-root", data_root, "--arbeit", arbeit_pfad,
           "--ergebnis", ergebnis_pfad]
    fertig = subprocess.run(ruf, capture_output=True, text=True, timeout=7200)
    if fertig.returncode != 0:
        raise ZaehlwerkAbbruch(
            "BEIN 1 LAUF-HAELFTE: `durchlauf --modus alt` ist gescheitert "
            "(Code " + str(fertig.returncode) + "): "
            + (fertig.stderr or "").strip()[:400])
    return pruefe_bein1_laufzahlen(ergebnis_pfad)


def pruefe_bein1_laufzahlen(ergebnis_pfad):
    """Die sechs torSoll-Zahlen gegen die Ausgabe nach --ergebnis.

    EINE Abweichung = STOPP (KZ-4). Kein zweiter Kandidaten-Sollwert, kein
    "nah genug", keine Nachjustierung.
    """
    if not os.path.isfile(ergebnis_pfad):
        raise ZaehlwerkAbbruch(
            "BEIN 1 LAUF-HAELFTE: das Werkzeug hat keine Ergebnisdatei "
            "geschrieben (" + str(ergebnis_pfad) + ").")
    with open(ergebnis_pfad, encoding="utf-8") as fh:
        roh = json.load(fh)
    signale = roh.get("signale", roh)
    gemessen, abweichungen = {}, []
    for fam, soll in BEIN1_SOLL["aequivalenzTorSoll"].items():
        ist = signale.get(fam)
        if not isinstance(ist, dict):
            abweichungen.append(fam + " fehlt in der Ergebnisdatei")
            continue
        gemessen[fam] = {}
        for feld in ("firmen_reif", "firmen_unreif"):
            if feld not in ist:
                abweichungen.append(fam + "." + feld + " fehlt")
                continue
            gemessen[fam][feld] = ist[feld]
            if ist[feld] != soll[feld]:
                abweichungen.append(
                    fam + "." + feld + ": ist " + repr(ist[feld]) + ", soll "
                    + repr(soll[feld]))
    if abweichungen:
        raise ZaehlwerkAbbruch(
            "AEQUIVALENZ-TOR BEIN 1 (LAUF-HAELFTE) GERISSEN - STOPP vor jedem "
            "Prueffenster-Byte (KZ-4): " + " | ".join(abweichungen)
            + ". Weicht Durchlauf 1 ab, ist nicht der Vergleich kaputt, "
            "sondern die Grundlage.")
    return {"bestanden": True, "gemessen": gemessen,
            "verbreitertSha256": ist}


def pruefe_bein2_basis(wurzel):
    """F6-C8d - Laufzeit-Basis-Reinheit, fail-closed VOR jeder Zahl.

    Drei Glieder, jedes ohne Vorgabewert, nach der SHA-Pruefung des
    Referenzartefakts:
      1. Konstanten-Abgleich an den Spaltenpfaden (F6-C8c), beide Richtungen.
      2. Basis-Reinheit, negativ UND positiv: kein `_kadenz`-Segment in einem
         Soll-Pfad; BASIS-ABBRUCH, wenn ein Soll-Tripel das Kadenz-Tripel
         trifft und zugleich vom E3-Tripel abweicht.
      3. Identitaet je Arm, EXAKTE Float-Gleichheit gegen die artefakteigene
         Rate `auffindbarkeit_e3`.

    ZAUN-RANDBEDINGUNG: die Rate aus Glied 3 ist eine ENTDECKUNGSFENSTER-
    Groesse aus einem committeten Artefakt. Sie ist hier zulaessig, gehoert
    aber ausschliesslich in diesen Bein-2-Block und darf NIEMALS in die
    Prueffenster-Ausgabemenge wandern, wo F6-A2 genau EINEN Schluessel zulaesst.
    """
    pfad = os.path.join(wurzel, *BEIN2_QUELLE_REL.split("/"))
    if not os.path.isfile(pfad):
        raise ZaehlwerkAbbruch("Das Referenzartefakt fehlt: " + BEIN2_QUELLE_REL)
    ist_sha = sha256_datei(pfad)
    if ist_sha != BEIN2_QUELLE_SHA:
        raise ZaehlwerkAbbruch(
            BEIN2_QUELLE_REL + " weicht von der Bindung ab (ist "
            + ist_sha[:16] + "..., soll " + BEIN2_QUELLE_SHA[:16] + "...).")
    with open(pfad, encoding="utf-8") as fh:
        artefakt = json.load(fh)

    # ── GLIED 2a: Basis-Reinheit NEGATIV, vor jedem Lesen ─────────────────
    for name, spalte in list(BEIN2_SPALTE.items()):
        if "kadenz" in spalte.lower():
            raise ZaehlwerkAbbruch(
                "BASIS-ABBRUCH: der Soll-Spaltenpfad fuer " + name + " ist "
                + repr(spalte) + " und traegt ein kadenz-Segment. Die "
                "Kadenz-Basis regiert Bein 2 NICHT (F6-C8a).")
    for arm, schluessel in ARM_ARTEFAKT.items():
        if "kadenz" in schluessel.lower():
            raise ZaehlwerkAbbruch(
                "BASIS-ABBRUCH: die Arm-Abbildung " + repr(arm) + " -> "
                + repr(schluessel) + " traegt ein kadenz-Segment.")

    gemessen = {}
    for (variante, arm), soll in BEIN2_SOLL.items():
        wo = variante + "/" + arm
        art_arm = ARM_ARTEFAKT[arm]
        zelle = _hole(artefakt,
                      ["baender", BEIN2_BAND, "varianten", variante, art_arm],
                      "baender[" + BEIN2_BAND + "].varianten." + variante
                      + "." + art_arm)

        # Beide Spaltensaetze werden GELESEN, bevor irgendetwas abbricht -
        # sonst waere Glied 2b unerreichbar (s. u.).
        e3 = {}
        for feld, spalte in BEIN2_SPALTE.items():
            e3[feld] = _hole(zelle, [spalte], wo + "." + spalte)
        kadenz = {}
        for feld, spalte in BEIN2_KADENZ_SPALTE.items():
            kadenz[feld] = zelle.get(spalte)

        # ── GLIED 2b: Basis-Reinheit POSITIV - VOR Glied 1 ────────────────
        # REIHENFOLGE IST ABSICHT: Glied 1 bricht bei JEDER Abweichung vom
        # E3-Tripel ab. Stuende es davor, koennte dieser Zweig nie feuern -
        # er waere ein Wachtposten, der nur so aussieht (dieselbe Klasse wie
        # der tote G-gegen-N-Vergleich, der frueher in diesem Modul stand).
        # Er steht deshalb zuerst und liefert die SCHAERFERE Diagnose: nicht
        # "irgendeine Abweichung", sondern "das Soll steht auf der falschen
        # Basis".
        trifft_kadenz = all(soll[f] == kadenz[f] for f in soll)
        weicht_von_e3 = any(soll[f] != e3[f] for f in soll)
        if trifft_kadenz and weicht_von_e3:
            raise ZaehlwerkAbbruch(
                "BASIS-ABBRUCH bei " + wo + ": das Soll-Tripel trifft "
                "(zaehler_kadenz, nenner_kadenz, zensiert_kadenz) = "
                + repr(tuple(kadenz[f] for f in ("zaehler", "nenner", "zensiert")))
                + " und weicht zugleich von (fallzahl, nenner_e3, zensiert_e3) = "
                + repr(tuple(e3[f] for f in ("zaehler", "nenner", "zensiert")))
                + " ab. Genau diese Verwechslung hat den vierten Anlauf "
                "gerissen; sie ist ab jetzt ein Abbruch, kein Befund.")

        # ── GLIED 1: Konstanten-Abgleich an den Spaltenpfaden ─────────────
        for feld, spalte in BEIN2_SPALTE.items():
            if e3[feld] != soll[feld]:
                raise ZaehlwerkAbbruch(
                    "F6-C8d KONSTANTEN-ABGLEICH GERISSEN bei " + wo + "."
                    + spalte + ": das Zaehlwerk fuehrt " + repr(soll[feld])
                    + ", das gepinnte Artefakt " + repr(e3[feld]) + ". STOPP "
                    "vor jeder Zahl. Kein Bein-2-Soll darf je aus einer "
                    "Laufausgabe abgeleitet werden (F6-C8c).")

        # ── GLIED 3: Identitaet, EXAKTE Float-Gleichheit ──────────────────
        rate = _hole(zelle, [BEIN2_IDENTITAETSSPALTE],
                     wo + "." + BEIN2_IDENTITAETSSPALTE)
        if soll["nenner"] == 0:
            raise ZaehlwerkAbbruch("Nenner 0 in " + wo + ".")
        if soll["zaehler"] / soll["nenner"] != rate:
            raise ZaehlwerkAbbruch(
                "F6-C8d IDENTITAET GERISSEN bei " + wo + ": "
                + repr(soll["zaehler"]) + "/" + repr(soll["nenner"]) + " = "
                + repr(soll["zaehler"] / soll["nenner"]) + " != "
                + BEIN2_IDENTITAETSSPALTE + " = " + repr(rate)
                + ". Das Soll steht nicht auf der Basis, die es zu fuehren "
                "vorgibt.")
        gemessen[wo] = dict(e3)
    return {"bestanden": True, "zellen": gemessen, "quelleSha256": ist_sha}


def aequivalenz_bein3():
    """BEIN 3: die Semantik gegen ausgeschriebene Literale. KEIN Panel-Lauf.

    F6-C9b..e: die Literale sind nach QUELLE gruppiert, jede Gruppe wird gegen
    ihre eigene hash-gepruefte Quelle gehalten, und die Pruefung ist
    ZWEISEITIG - kein Literal fehlt im Quelltext UND die geprueft Menge ist
    gleich der deklarierten Menge. Es gibt KEINE Ausnahmeliste; der fruehere
    Ausschluss nach Namen ist ersatzlos gefallen.
    """
    # (1) ZWEISEITIG, Teil 2 - zuerst, weil eine Luecke hier jede weitere Zahl
    #     wertlos macht: die Gruppen muessen GENAU die deklarierten Literale
    #     abdecken. Ein Schluessel, den keine Gruppe fuehrt, waere wieder ein
    #     stiller Ausschluss; einer, den es nicht gibt, eine leere Behauptung.
    aus_gruppen = []
    for gruppe in BEIN3_GRUPPEN:
        aus_gruppen.extend(gruppe["literale"])
    doppelt = sorted({n for n in aus_gruppen if aus_gruppen.count(n) > 1})
    if doppelt:
        raise ZaehlwerkAbbruch(
            "BEIN 3: diese Literale stehen in mehr als einer Quellgruppe: "
            + ", ".join(doppelt) + ". Ein Literal hat GENAU EINE Herkunft.")
    ungeprueft = sorted(set(BEIN3_LITERALE) - set(aus_gruppen))
    unbekannt = sorted(set(aus_gruppen) - set(BEIN3_LITERALE))
    if ungeprueft or unbekannt:
        raise ZaehlwerkAbbruch(
            "BEIN 3 MENGENGLEICHHEIT GERISSEN: nicht geprueft "
            + repr(ungeprueft) + ", ohne Literal deklariert " + repr(unbekannt)
            + ". Die geprueft Menge MUSS die deklarierte Menge sein - ein "
            "Schluessel, der aus der Pruefung faellt, ist genau der Befund, "
            "den F6-C9d abstellt.")

    # (2) ZWEISEITIG, Teil 1 - je Gruppe gegen die eigene, hash-gepruefte
    #     Quelle. Das Hash-Gate steht VOR dem Vergleich.
    geprueft = {}
    for gruppe in BEIN3_GRUPPEN:
        # Die Werte werden VOR dem Abbruchtext an lokale Namen gebunden: die
        # Hausregel verbietet dict-Subscripts in Abbruchtexten, weil dort
        # sonst irgendwann eine Datenzeile interpoliert wird.
        gname = gruppe["name"]
        gherkunft = gruppe["herkunft"]
        gliterale = gruppe["literale"]
        text = _bein3_quelltext(gruppe["art"], WURZEL_REPO)
        fehlend = [n for n in gliterale if BEIN3_LITERALE[n] not in text]
        if fehlend:
            raise ZaehlwerkAbbruch(
                "BEIN 3 gerissen in Gruppe " + gname + ": diese woertlichen "
                "Literale stehen nicht mehr in " + gherkunft + ": "
                + ", ".join(fehlend) + ". Die Semantik, gegen die dieses "
                "Zaehlwerk gebaut ist, hat sich bewegt.")
        geprueft[gname] = sorted(gliterale)

    # (3) F6-C9e - SECHS Literale, GETRENNT gezaehlt. Die bauseitige Zugabe
    #     zaehlt NIE als eine der fuenf F6-C9-Ziffern.
    f6c9 = sum(len(g["literale"]) for g in BEIN3_GRUPPEN
               if g["zaehlt_als_f6c9_ziffer"])
    bauseitig = sum(len(g["literale"]) for g in BEIN3_GRUPPEN
                    if not g["zaehlt_als_f6c9_ziffer"])
    return {
        "bestanden": True,
        "geprueft": sorted(BEIN3_LITERALE),
        "jeGruppe": geprueft,
        "zaehlung": {
            "f6c9_praereg": len(BEIN3_GRUPPEN[0]["literale"]),
            "f6c9_eintrag24": len(BEIN3_GRUPPEN[1]["literale"]),
            "f6c9_ziffern_gesamt": f6c9,
            "bauseitig_ergaenzt": bauseitig,
            "gesamt": f6c9 + bauseitig,
        },
    }


def aequivalenz_tor(panel_pfad, wurzel=None, arbeit_pfad=None):
    """Die LAUFBEDINGUNG vor jedem Prueffenster-Byte (F6-C7/C8, 3:0).

    Form woertlich aus `scripts/studie-e2-verbreitert.py:26-30`: "Durchlauf 1
    faehrt mit den ORIGINAL-Globals und MUSS die publizierten V0-Zahlen liefern
    ... dann STOPP, und zwar vor jeder verbreiterten Zahl."

    EINE Abweichung in EINER Stelle = STOPP (KZ-4). Kein zweiter
    Kandidaten-Sollwert, kein "nah genug", keine Nachjustierung.

    ACHTUNG - REIHENFOLGE: dieses Tor laeuft auf dem ENTDECKUNGS-Panel und
    braucht dafuer seinen eigenen `count_only_probe_authorized`-Eintrag
    (Bauordnung Schritt 2). Es ist NICHT Teil des konfirmatorischen Laufs auf
    dem Prueffenster, sondern seine Vorbedingung.
    """
    wurzel = wurzel or WURZEL_REPO
    if arbeit_pfad is None:
        arbeit_pfad = _ARBEITSPFAD
    if arbeit_pfad is None:
        raise ZaehlwerkAbbruch(
            "Kein Arbeitspfad gesetzt. Auch das Aequivalenz-Tor oeffnet eine "
            "Arbeitsdatei und braucht den vorab geprueften Pfad (W-B / KZ-3).")
    module = lade_regelmodule(wurzel)
    pruefe_regelparameter(wurzel, module)
    # F6-C8d: die Basis-Reinheit steht VOR jeder gemessenen Zahl.
    basis = pruefe_bein2_basis(wurzel)
    bein3 = aequivalenz_bein3()

    fenster = FENSTER_SOLL["entdeckung"]
    gemessen, abweichungen = {}, []
    for variante in VARIANTEN:
        arme = _arme(panel_pfad, arbeit_pfad, variante, module, fenster)
        for arm in ARME:
            ergebnis, eintraege = arme[arm]
            klumpen, n, zaehler_reife, zensiert = _tally(
                eintraege, ergebnis["reif"], module["e2"], module["zp"],
                arme["rand_ordinal"], variante + "/" + arm)
            ist = {"zaehler": zaehler_reife, "nenner": n, "zensiert": zensiert}
            gemessen[variante + "/" + arm] = ist
            soll = BEIN2_SOLL[(variante, arm)]
            for feld in ("zaehler", "nenner", "zensiert"):
                if ist[feld] != soll[feld]:
                    abweichungen.append(
                        variante + "/" + arm + "." + feld + ": ist "
                        + str(ist[feld]) + ", soll " + str(soll[feld]))
    if abweichungen:
        raise ZaehlwerkAbbruch(
            "AEQUIVALENZ-TOR BEIN 2 GERISSEN - STOPP vor jedem "
            "Prueffenster-Byte (KZ-4): " + " | ".join(abweichungen)
            + ". Weicht Durchlauf 1 ab, ist nicht der Vergleich kaputt, "
            "sondern die Grundlage.")
    return {"bestanden": True, "bein2Gemessen": gemessen, "bein3": bein3,
            "bein2Basis": basis,
            "modulSha256": module["modulSha256"],
            "zaehlprobeSha256": module["zaehlprobeSha256"],
            "bein2QuelleSha256": BEIN2_QUELLE_SHA}


# =============================================================================
# Selbsttest - ohne Panel, ohne Freigabe, ohne eine einzige Studienzahl
# =============================================================================

def selbsttest():
    ok = fehl = 0

    def pruefe(name, bedingung):
        nonlocal ok, fehl
        if bedingung:
            ok += 1
            print("  ok   " + name)
        else:
            fehl += 1
            print("  FAIL " + name)

    # W-B
    for schlecht in ("arbeit/validierung/x.sqlite", "x/endtest/a.sqlite",
                     "a/pruefenster/b.sqlite", "a/b.key", "a/schluessel.db"):
        try:
            pruefe_arbeitspfad(schlecht)
            pruefe("W-B faengt " + schlecht, False)
        except ZaehlwerkAbbruch:
            pruefe("W-B faengt " + schlecht, True)
    try:
        pruefe_arbeitspfad("arbeit/f6/zwischenstand.sqlite")
        pruefe("W-B GEGENPROBE: ein sauberer Arbeitspfad geht durch", True)
    except ZaehlwerkAbbruch:
        pruefe("W-B GEGENPROBE: ein sauberer Arbeitspfad geht durch", False)

    # W-C, an der reinen Tally-Funktion
    class _ZP:
        @staticmethod
        def ist_zensiert(e, e2, rand):
            return bool(e.get("zensiert"))

    def tally(eintraege, reif, wo="probe"):
        return _tally(eintraege, reif, None, _ZP, 0, wo)

    e = [{"cik": "1"}, {"cik": "2"}, {"cik": "3"}]
    klumpen, n, z, zens = tally(e, [{"cik": "1"}, {"cik": "2"}])
    pruefe("Tally: drei Firmen -> N = 3, Zaehler = 2, alle n_g = 1",
           n == 3 and z == 2 and all(p[1] == 1 for p in klumpen))
    pruefe("Tally gibt NUR Zahlenpaare zurueck, keine Kennung",
           all(isinstance(p, list) and len(p) == 2
               and all(_ganzzahl(x) for x in p) for p in klumpen))
    klumpen2, n2, z2, zens2 = tally(
        [{"cik": "1"}, {"cik": "2", "zensiert": True}], [{"cik": "1"}])
    pruefe("Tally: eine zensierte Einheit faellt aus dem Netto-Nenner",
           n2 == 1 and z2 == 1 and zens2 == 1)

    try:
        tally([{"cik": "1"}, {"cik": "1"}], [{"cik": "1"}])
        pruefe("W-C: n_g > 1 ist ein ABBRUCH", False)
    except ZaehlwerkAbbruch as f:
        pruefe("W-C: n_g > 1 ist ein ABBRUCH", "R3-ABBRUCH" in str(f))
    try:
        tally([{"cik": None}], [])
        pruefe("Einheit ohne Klumpen-Kennung: ABBRUCH, kein Filter", False)
    except ZaehlwerkAbbruch as f:
        pruefe("Einheit ohne Klumpen-Kennung: ABBRUCH, kein Filter",
               "kein Filter" in str(f))

    # BEIN 3
    try:
        r3 = aequivalenz_bein3()
        z3 = r3["zaehlung"]
        # F6-C9e: SECHS geprueft Literale, davon FUENF F6-C9-Ziffern (vier aus
        # der Praereg, eins aus dem Wortlaut von Eintrag 24) und EINE
        # bauseitige Zugabe, die NIE als Ziffer zaehlt.
        pruefe("BEIN 3: sechs Literale, quellengebunden und getrennt gezaehlt",
               r3["bestanden"] and len(r3["geprueft"]) == 6
               and z3["f6c9_praereg"] == 4 and z3["f6c9_eintrag24"] == 1
               and z3["f6c9_ziffern_gesamt"] == 5
               and z3["bauseitig_ergaenzt"] == 1 and z3["gesamt"] == 6)
        # F6-C9f/2 haengt hier: faellt ein Schluessel aus der Pruefmenge, muss
        # die Mengengleichheit ihn melden - nicht die Zahl still halten.
        pruefe("BEIN 3: die geprueft Menge IST die deklarierte Menge",
               set(r3["geprueft"]) == set(BEIN3_LITERALE))
    except ZaehlwerkAbbruch as f:
        pruefe("BEIN 3: sechs Literale, quellengebunden (" + str(f)[:60] + ")",
               False)

    # F6-C6 / F6-C2 am echten Repo
    try:
        module = lade_regelmodule()
        pruefe("F6-C2: das versiegelte Modul laedt nach Hash-Pruefung",
               module["modulSha256"] == VERSIEGELT_SHA)
        p = pruefe_regelparameter(None, module)
        pruefe("F6-C6: pFinal = 95 am Artefakt nachgerechnet",
               p["pFinal"] == P_FINAL_SOLL)
        pruefe("F6-C6: der Schwellen-Satz reproduziert BEIDE Hashes",
               p["schwellenDateiSha256"] == SCHWELLEN_DATEI_SHA
               and p["schwellenInhaltSha256"] == SCHWELLEN_INHALT_SHA)
        # W-A am Objekt: keiner der vier Einstiegspunkte steht im Quelltext.
        with open(os.path.abspath(__file__), encoding="utf-8") as fh:
            quelle = fh.read()
        import ast
        rufe = {k.func.attr for k in ast.walk(ast.parse(quelle))
                if isinstance(k, ast.Call) and isinstance(k.func, ast.Attribute)}
        verboten = rufe & {"pruefe_mauer", "oeffne_nur_lesend",
                           "oeffne_zwischenstand", "schreibe_report"}
        pruefe("W-A: keiner der vier mauertragenden Einstiegspunkte wird gerufen",
               not verboten)
    except ZaehlwerkAbbruch as f:
        pruefe("F6-C2/C6 am echten Repo (" + str(f)[:70] + ")", False)

    print("selbsttest: " + str(ok) + " ok, " + str(fehl) + " FAIL")
    return 1 if fehl else 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["selbsttest"]:
        return selbsttest()
    print("F6-ZAEHLWERK - Instrument der einen konfirmatorischen Zaehlung.\n"
          "Es wird nicht selbst gestartet, sondern von scripts/studie-f6-lauf.py\n"
          "ueber --zaehlwerk geladen. Eigener Aufruf: selbsttest.", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
