#!/usr/bin/env python3
"""VB-A9..VB-A13 (B4) - die Bandregel des F6-Tors, mechanisch auswertbar.

_COURT-VIERBANK-OFFEN23-2026-08-30, V2 / OFFEN-3, ratifiziert als ENTSCHIED 136.

WAS DIESES MODUL IST
--------------------
Die Rechenvorschrift des Tors, ausformuliert als Ja/Nein-Kette, plus das
Artefakt, das sie einfriert. Es ist eine FUNKTION VON ZAHLEN, die jemand
anderes misst: dieses Modul zaehlt nichts, oeffnet keine Lueckenliste, kein
Prueffenster, kein Panel und keine data/lockbox. Es kennt kein Ergebnis.

WAS ES AUSDRUECKLICH NICHT IST
------------------------------
Kein Startschuss. F5, F5b und F6 bleiben gesperrt. Der Freeze-Akt selbst
(VB-A11: B4 samt allen vier Groessen, im SELBEN Register-Akt mit der
E2-Ableitungsregel, gehasht und server-bestaetigt) ist Sache des
Orchestrators und ist hier NICHT vollzogen - siehe `freezeStatus` im Artefakt.

DIE VIER GROESSEN, DIE MITGEFROREN WERDEN MUESSEN (VB-A9)
---------------------------------------------------------
  1. Schwelle            0,90 (am Objekt festgestellt, preregistration.json:88/134)
  2. SE-Rechenvorschrift SE* = max(SE_binomial(p-Dach), SE_klumpen-robust)
  3. Klumpungseinheit    Zwischenregel: Klumpung nach Signal-Entitaet (Firma)
  4. Bandbreite          1 SE, geschlossen
Fehlt eine, ist das Tor nicht auswertbar und startet nicht.

Aufruf:
  python scripts/studie-vb-b4-band.py artefakt [--ziel <datei.json>]
  python scripts/studie-vb-b4-band.py hash [--datei <artefakt.json>]
  python scripts/studie-vb-b4-band.py auswerten --ergebnis <p> --n <n>
                                      --se-binomial <x> --se-klumpen <y>
  python scripts/studie-vb-b4-band.py selbsttest
"""

import argparse
import hashlib
import json
import math
import os
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTEFAKT = os.path.join(WURZEL, "protocol", "early-detection", "2.1.0",
                        "b4-bandregel-2026-08-30.json")

# 1. Bezugspunkt. Am Objekt festgestellt (Kanzlei §0.1), nicht abgestimmt:
#    registriert ist ein ANTEIL, keine Ganzzahl-Schranke.
SCHWELLE = 0.9
SCHWELLE_ANKER = ("protocol/early-detection/2.0.0/preregistration.json:88 "
                  '"gate": {"minimum": 0.9, ...}  und  :134 '
                  '"auffindbarkeitsGate": {"minimum": 0.9, ...}')
# 4. Bandbreite. Bleibt bei 1 SE - Freeze-before-look gilt auch fuer die Bremse.
BANDBREITE_SE = 1.0
# Zulaessigkeits-Gate: die bestehende Praereg-Schwelle, nicht eine neue.
FALLZAHL_MIN = 200

VERDIKT_BESTANDEN = "BESTANDEN"
VERDIKT_BAND = "NICHT UNTERSCHEIDBAR"
VERDIKT_NICHT_BESTANDEN = "NICHT BESTANDEN"

PFLICHTSATZ_BAND = ("Das Tor konnte bei dieser Fallzahl zwischen Bestehen und "
                    "Nichtbestehen nicht unterscheiden.")
ZWEITSATZ_BAND = ("Nicht die Hypothese ist widerlegt, sondern das Messgeraet "
                  "hat nicht getrennt. NIE: 'der Effekt ist abwesend'.")


class BandNichtAuswertbar(Exception):
    """Das Messgeraet ist unvollstaendig. Nie ein Pass."""


def se_binomial(p_dach, n):
    """SE = Wurzel(p(1-p)/n) mit p-Dach = dem REALISIERTEN Anteil des Laufs,
    nicht 0,90. Anschluss an die registrierte Streuungsgroesse der Studie
    (ZWEITQUELLE §0: SE = Wurzel(p(1-p)/365) = 1,6170 pp mit p = 326/365).
    Kontinuitaets-Feststellung, keine Praeferenz: unter max(...) kann diese
    Wahl ohnehin nur dort entscheiden, wo sie den klumpen-robusten SE
    uebersteigt."""
    if n is None or n <= 0 or p_dach is None or not 0.0 <= p_dach <= 1.0:
        return None
    return math.sqrt(p_dach * (1.0 - p_dach) / n)


def wilson(p_dach, n, z=1.959963984540054):
    """Zweiseitiges 95-%-Wilson-Intervall (VB-A10). Steht in JEDEM Zweig neben
    dem Verdikt - es ist der stehende Vorbehalt D6, nicht seine Ausraeumung."""
    if n is None or n <= 0 or p_dach is None:
        return None
    mitte = (p_dach + z * z / (2 * n)) / (1 + z * z / n)
    rand = (z / (1 + z * z / n)) * math.sqrt(
        p_dach * (1 - p_dach) / n + z * z / (4 * n * n))
    return [mitte - rand, mitte + rand]


def _endlich(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) \
        and math.isfinite(x) and x >= 0.0


def se_stern(se_binom, se_klumpen):
    """SE* = max(beide). Beide sind PFLICHT. Fehlt oder entartet einer, gibt es
    KEINEN Rueckfall auf den kleineren - das Tor ist dann nicht auswertbar
    (4:0, fail-closed). Ist der klumpen-robuste kleiner als der binomiale
    (negative Intra-Block-Korrelation), bleibt es bei max(...); das ist Absicht
    und kippt nichts (Kipp-Bedingung 5)."""
    fehlend = [name for name, wert in (("SE_binomial", se_binom),
                                       ("SE_klumpen-robust", se_klumpen))
               if not _endlich(wert)]
    if fehlend:
        raise BandNichtAuswertbar(
            "Pflicht-SE nicht berechenbar: " + ", ".join(fehlend)
            + ". Kein Rueckfall auf den kleineren SE.")
    return max(se_binom, se_klumpen)


def auswerten(ergebnis, n, se_binom, se_klumpen, schwelle=SCHWELLE,
              breite=BANDBREITE_SE, fallzahl_min=FALLZAHL_MIN):
    """Die Regel B4, in der Reihenfolge des Urteils. Jeder Schritt eine
    Ja/Nein-Pruefung, das Ergebnis binaer.

    Gibt IMMER ein Verdikt zurueck - auch der gerissene Zulaessigkeits-Gate ist
    ein Verdikt, kein Fehler. `weiter` ist 0 oder 1, nie etwas dazwischen.
    """
    bericht = {
        "schwelle": schwelle,
        "bandbreiteInSE": breite,
        "fallzahlMin": fallzahl_min,
        "n": n,
        "ergebnis": ergebnis,
        "seBinomial": se_binom,
        "seKlumpenRobust": se_klumpen,
        "wilson95": wilson(ergebnis, n),
    }

    # 1. Zulaessigkeits-Gate, fail-closed. Nie ein Pass.
    if n is None or n < fallzahl_min:
        return dict(bericht, seStern=None, entschied=None, abstand=None,
                    verdikt=VERDIKT_BAND, weiter=0, messgeraetVollstaendig=False,
                    grund=("Zulaessigkeits-Gate gerissen: der Nenner des Tors "
                           "ist " + repr(n) + " < " + str(fallzahl_min)
                           + " (bestehende Praereg-Schwelle R5). NICHT "
                           "BEWERTBAR."),
                    pflichtsatz=PFLICHTSATZ_BAND, zweitsatz=ZWEITSATZ_BAND)
    try:
        stern = se_stern(se_binom, se_klumpen)
    except BandNichtAuswertbar as exc:
        return dict(bericht, seStern=None, entschied=None, abstand=None,
                    verdikt=VERDIKT_BAND, weiter=0, messgeraetVollstaendig=False,
                    grund="Zulaessigkeits-Gate gerissen: " + str(exc),
                    pflichtsatz=PFLICHTSATZ_BAND, zweitsatz=ZWEITSATZ_BAND)

    # 3./4. Band, geschlossen. Gleichheit zaehlt INS Band, keine Rundung vor
    #       dem Vergleich - deshalb wird hier nichts gerundet.
    abstand = ergebnis - schwelle
    breite_abs = breite * stern
    bericht.update({
        "seStern": stern,
        "entschied": ("SE_klumpen-robust" if se_klumpen >= se_binom
                      else "SE_binomial"),
        "abstand": abstand,
        "bandbreiteAbsolut": breite_abs,
        "messgeraetVollstaendig": True,
        "abstandZu329Von365": ergebnis - (329.0 / 365.0),
    })

    # 5. Drei erschoepfende Zweige, zwei Konsequenzen.
    if abs(abstand) <= breite_abs:
        return dict(bericht, verdikt=VERDIKT_BAND, weiter=0,
                    grund=("|Ergebnis - " + repr(schwelle) + "| <= SE* - das "
                           "Ergebnis liegt im geschlossenen Band."),
                    pflichtsatz=PFLICHTSATZ_BAND, zweitsatz=ZWEITSATZ_BAND)
    if abstand > breite_abs:
        return dict(bericht, verdikt=VERDIKT_BESTANDEN, weiter=1,
                    grund="Ergebnis - " + repr(schwelle) + " > SE*.",
                    etikett=("Tor-Bestehen nach HAUSREGEL, nicht "
                             "95-%-gesicherte Ueberlegenheit."))
    return dict(bericht, verdikt=VERDIKT_NICHT_BESTANDEN, weiter=0,
                grund=repr(schwelle) + " - Ergebnis > SE*.",
                etikett=("Gerissenes Tor. Sauberes Negativergebnis - nach "
                         "Hausmethodik ein Erfolg. Dokumentiertes Negativ im "
                         "Muster-Friedhof."))


# =============================================================================
# Das eingefrorene Artefakt
# =============================================================================

def kanonisch(baum):
    """Dieselbe Kanonisierung wie bei Register-Eintrag 22: JSON, Schluessel
    sortiert, separators ',' und ':', ensure_ascii=False, UTF-8."""
    return json.dumps(baum, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def inhalt():
    """Der einzufrierende Regelkoerper. ALLES, was das Tor entscheidet, steht
    hier - und nichts, was ein Ergebnis vorwegnimmt."""
    return {
        "regel": "B4 - Bandregel des F6-Tors",
        "auflagen": "VB-A9 bis VB-A13 - _COURT-VIERBANK-OFFEN23-2026-08-30",
        "ratifikation": "ENTSCHIED 136 (Orchestrator)",
        "vierGroessen": {
            "1_schwelle": {
                "wert": SCHWELLE,
                "form": ("ANTEIL, ausgewertet auf dem im F6-Lauf gueltigen "
                         "Nenner. Genau EIN Bezugspunkt, vor dem Blick "
                         "eingefroren, kein Wahlrecht danach."),
                "anker": SCHWELLE_ANKER,
                "329von365": (
                    "329/365 ist NIRGENDS als Schwelle registriert. Die Suche "
                    "nach '329' in protocol/** liefert einen einzigen, "
                    "beschreibenden Treffer: "
                    "protocol/early-detection/2.0.0/friedhof.json:71 "
                    "\"... gegen ein Tor von 90 % bzw. 329 von 365 - "
                    "Fehlbetrag exakt 3 Firmen ...\". Es ist die kleinste "
                    "Zaehlerzahl, die 0,9 auf dem ALTEN Nenner ueberschreitet "
                    "- eine Darstellung, keine zweite Schwelle. Der Nenner "
                    "bewegt sich in der Verbreiterung ohnehin (N = 365 + m, "
                    "K6/A18), womit 329 als Ganzzahl gar nicht mitwandern "
                    "kann. Es bleibt BERICHTSANGABE und wird NIE "
                    "Entscheidungsgroesse."),
            },
            "2_seRechenvorschrift": {
                "formel": "SE* = max(SE_binomial(p-Dach), SE_klumpen-robust)",
                "seBinomial": ("Wurzel(p-Dach*(1-p-Dach)/n) mit p-Dach = dem "
                               "REALISIERTEN Anteil des Laufs, nicht 0,90."),
                "beidePflicht": ("Beide aus DEMSELBEN Lauf, beide berichtet "
                                 "(A16); der groessere entscheidet. Fehlt oder "
                                 "entartet einer, ist das Tor nicht auswertbar "
                                 "- kein Rueckfall auf den kleineren SE."),
                "negativeKorrelation": ("Ist SE_klumpen-robust kleiner als der "
                                        "binomiale, bleibt es bei max(...). "
                                        "Absicht, nicht Versehen; kippt nichts."),
            },
            "3_klumpungseinheit": {
                "gilt": "Klumpung nach Signal-Entitaet (Firma)",
                "status": ("ZWISCHENREGEL, bindend bis zum F6-Register-Akt "
                           "(ENTSCHIED 136). Der Rat hat OFFEN-A nicht "
                           "entschieden; die Einheit ist fuer 2.0.0 NICHT "
                           "praeregistriert."),
                "herkunft": ("protocol/early-detection/1.2.0/"
                             "preregistration.json:384 - \"10,000 ... "
                             "replicates clustered by signal entity\", "
                             "fortgefuehrt aus 1.1.0/1.0.0 "
                             "(\"entity-clustered confidence intervals\")."),
                "zwischenregelWoertlich": (
                    "ZWISCHENREGEL, bis der Orchestrator entscheidet - "
                    "benannt, damit die Luecke nicht als Wahlrecht "
                    "offensteht: Es gilt die Einheit, die die registrierte "
                    "Ahnenreihe der Studie bereits fuehrt - Klumpung nach "
                    "Signal-Entitaet (Firma), "
                    "protocol/early-detection/1.2.0/preregistration.json:384 "
                    "(\"replicates clustered by signal entity\"), "
                    "fortgefuehrt aus 1.1.0/1.0.0 (\"entity-clustered "
                    "confidence intervals\"). Jede groebere Einheit - "
                    "Entity-Klasse x Signalquartal eingeschlossen - ist eine "
                    "Aenderung und muss im selben Freeze-Akt (VB-A11) "
                    "namentlich, begruendet und vor dem Blick registriert "
                    "werden; nach dem Blick ist sie unzulaessig."),
                "entschied136": (
                    "Die Zwischenregel 'Klumpung nach Signal-Entitaet' ist "
                    "bindend, bis der F6-Register-Akt die endgueltige Einheit "
                    "festlegt. Eine Abweichung dort nur mit Gegenzeichnung des "
                    "Rates."),
                "failClosed": ("Ist bis zum Freeze-Akt keine Einheit gefroren, "
                               "gilt die Zwischenregel - und ist sie auf den "
                               "Daten nicht berechenbar, startet F6 nicht."),
            },
            "4_bandbreite": {
                "wert": BANDBREITE_SE,
                "einheit": "SE*",
                "geschlossen": ("|Ergebnis - 0,90| <= SE*. Gleichheit zaehlt "
                                "INS Band. Keine Rundung vor dem Vergleich."),
                "warumNicht1_96": (
                    "Ehrlich waere das Band, in dem das Konfidenzintervall die "
                    "Schwelle ueberdeckt - zweiseitig 95 %, also ca. 1,96 SE. "
                    "Die Breite wird trotzdem nicht angefasst: sie steht seit "
                    "K3 Bedingung 6 / A16 mit 4:0, und sie staende jetzt zur "
                    "Verstellung an, NACHDEM der Abstand der alten "
                    "Punktschaetzung zur Schwelle publiziert ist. "
                    "Freeze-before-look gilt auch fuer die Bremse. Die "
                    "ehrliche Antwort ist keine Verstellung, sondern eine "
                    "Berichtspflicht (VB-A10)."),
            },
        },
        "zulaessigkeitsGate": {
            "fallzahlMin": FALLZAHL_MIN,
            "regel": ("Ist der Nenner des Tors < 200 (bestehende "
                      "Praereg-Schwelle: 'unter 200 Werten im Pool gibt es "
                      "keine Schwelle und das Quartal ist NICHT BEWERTBAR', "
                      "R5), ODER ist einer der beiden Pflicht-SE nicht "
                      "berechenbar (entartete Bloecke), dann: NICHT "
                      "UNTERSCHEIDBAR, WEITER = 0, Messgeraet unvollstaendig. "
                      "NIE ein Pass. Kein Rueckfall auf den kleineren SE."),
            "prospektiveForm": ("Laesst sich der klumpen-robuste SE VOR dem "
                                "Blick nicht als Rechenvorschrift einfrieren, "
                                "ist das Tor in dieser Form nicht fahrbar - "
                                "dann startet F6 gar nicht, und die Regel wird "
                                "nicht weicher ausgelegt."),
        },
        "zweige": [
            {"bedingung": "Ergebnis - 0,90 > SE*", "verdikt": VERDIKT_BESTANDEN,
             "weiter": 1},
            {"bedingung": "|Ergebnis - 0,90| <= SE*", "verdikt": VERDIKT_BAND,
             "weiter": 0, "folge": "Pfad endet"},
            {"bedingung": "0,90 - Ergebnis > SE*",
             "verdikt": VERDIKT_NICHT_BESTANDEN, "weiter": 0,
             "folge": "Pfad endet"},
            {"bedingung": "Zulaessigkeits-Gate gerissen",
             "verdikt": VERDIKT_BAND + " (Messgeraet unvollstaendig)",
             "weiter": 0, "folge": "Pfad endet"},
        ],
        "endtestSiegel": {
            "BESTANDEN": {
                "k2Kontingent": "verbraucht, Flaeche endgueltig verbrannt",
                "siegel": (
                    "Das Siegel bleibt zu. Ein bestandenes Tor ist Zulassung, "
                    "nie Ausloeser - das Abfeuern bleibt ein EIGENER Akt mit "
                    "eigenem Register-Eintrag, aufgeloestem RR-3/K11 und Karls "
                    "Entschluesselungs-Freigabe, die diese Bank NICHT einholt. "
                    "Kein Automatismus vom Tor zum Siegel. Wenn er spaeter "
                    "faellt: genau EIN Lauf, unter der VORHER eingefrorenen, "
                    "mit F6 identischen Gruen-Definition (K11, 4:0), "
                    "Publikation unabhaengig vom Vorzeichen."),
                "zitierbarkeit": ("als bestandenes Tor NACH HAUSREGEL, mit "
                                  "Wilson-Intervall daneben"),
            },
            "NICHT UNTERSCHEIDBAR": {
                "k2Kontingent": "verbraucht (der Lauf hat stattgefunden), Flaeche verbrannt",
                "siegel": (
                    "bleibt zu und wird NICHT verbraucht. Fuer DIESE "
                    "Studienfamilie - diese Frage, diese Konzeptliste, dieses "
                    "Prueffenster - dauerhaft gesperrt; nie als zweiter Anlauf "
                    "derselben Frage. Ob ein anderes, kuenftig neu "
                    "praeregistriertes Design ihn ausgeben darf, entscheidet "
                    "NICHT diese Bank (RR-3/K11, Karl)."),
                "zitierbarkeit": (
                    "weder als bestanden noch als nicht bestanden zitierfaehig. "
                    "Pflichtsatz in Bericht und jeder Zitierung: \""
                    + PFLICHTSATZ_BAND + "\" Wer die Zahl ohne diesen Satz "
                    "zitiert, zitiert falsch."),
            },
            "NICHT BESTANDEN": {
                "k2Kontingent": "verbraucht, Flaeche verbrannt",
                "siegel": ("bleibt zu und wird NICHT verbraucht, fuer dieses "
                           "Design endgueltig"),
                "zitierbarkeit": ("als gerissenes Tor; sauberes "
                                  "Negativergebnis, nach Hausmethodik ein "
                                  "Erfolg. Dokumentiertes Negativ im "
                                  "Muster-Friedhof."),
            },
            "k2Grundsatz": (
                "Das Kontingent EINS aus A10/K2 IST der F6-Lauf selbst. K2 "
                "woertlich: 'Nach diesem einen Lauf ist die Flaeche endgueltig "
                "verbrannt - unabhaengig vom Ergebnis.' Ein fuer das Band "
                "reservierter Rerun waere ein ZWEITER konfirmatorischer Lauf, "
                "also die Zahl >= 2, die K2 als Suchraum verworfen hat - und "
                "er waere wirkungslos: dieselbe Fallzahl hat dieselbe SE."),
            "inAllenDreiZweigen": "Das versiegelte Endtest-Siegel bleibt ZU.",
        },
        "berichtspflichten": {
            "auflage": "VB-A10, zusaetzlich zu A16",
            "inJedemZweig": [
                "exakter Bruch",
                "BEIDE SE, mit Kennzeichnung, welcher entschied",
                "Abstand zu 0,90 UND zu 329/365",
                "zweiseitiges 95-%-Wilson-Intervall",
                "A16-Zerlegungen",
            ],
            "imBandzweig": [PFLICHTSATZ_BAND, ZWEITSATZ_BAND],
            "beiBestanden": ("Ein BESTANDEN ausserhalb des 1-SE-Bandes wird "
                             "als Tor-Bestehen NACH HAUSREGEL ausgewiesen, "
                             "nicht als 95-%-gesicherte Ueberlegenheit."),
        },
        "verbotsliste": {
            "auflage": "VB-A12, in allen drei Zweigen",
            "verboten": [
                "das Kontingent EINS (A10/K2) zur Aufloesung des Bandes verbrauchen",
                ("Schwelle, SE-Vorschrift, Klumpungseinheit oder E2-Ableitung "
                 "nach dem Bandergebnis neu ableiten"),
                ("einen Lauf unter dem anderen Jahrgang als zweiten Torlauf "
                 "fahren (folgt bereits aus A10/K2 und Register-Eintrag 22)"),
                "das Band nach dem Blick neu definieren",
                "den Bezugspunkt wechseln",
                ("ein Folgedokument, das A16 oder B4 als Aufloesung der "
                 "Trennschaerfe (RR-8) zitiert"),
            ],
            "folge": ("Jede Abweichung ist ein Gerichtsakt mit eigenem Eintrag "
                      "und einem Namen darunter."),
        },
        "stehenderVorbehalt": (
            "Die Zange E1/RR-8, unveraendert und ausdruecklich NICHT "
            "aufgeloest: ein Tor, dessen Bestehensschwelle 0,42-0,51 SE von "
            "der Punktschaetzung entfernt liegt, kann Bestehen und "
            "Nichtbestehen nicht unterscheiden. A16 dokumentiert das Problem; "
            "sie loest es nicht. B4 loest es ebenfalls nicht - B4 entscheidet "
            "allein, WER den Preis traegt: die Studie, nicht die Behauptung."),
        "preisschild": (
            "VB-A13: Diese Regel wird dem Orchestrator vorgelegt, BEVOR "
            "8,5-14,5 Motortage ausgegeben werden - sie macht das Tor spuerbar "
            "schwerer, und das gehoert vor die Ausgabe, nicht danach. Der "
            "einzige nicht verbotene Weg aus dem Bandproblem - groessere "
            "Fallzahl (laengeres Prueffenster, K3 Kipp (a)) - ist eine "
            "Designaenderung und muss PROSPEKTIV UND BLIND vor dem Lauf "
            "entschieden werden; nach dem Ergebnis ist sie unzulaessig "
            "(K3, 4:0)."),
        "beschlussSperre": (
            "Kein Satz dieses Artefakts sagt etwas ueber die Richtung einer "
            "kuenftigen Messung. Der einzige Satz, der gilt: 'Wir frieren eine "
            "Regel ein und messen ehrlich; die Richtung kennt heute niemand.'"),
    }


def artefakt():
    k = inhalt()
    return {
        "schema": "studie-vb-b4-bandregel/v1",
        "inhalt": k,
        "inhaltSha256": hashlib.sha256(kanonisch(k)).hexdigest(),
        "kanonisierung": ("JSON, Schluessel sortiert, separators ',' und ':', "
                          "ensure_ascii=False, UTF-8 - identisch mit "
                          "Register-Eintrag 22"),
        "freezeStatus": {
            "auflage": "VB-A11",
            "eingefroren": False,
            "halter": "Orchestrator",
            "verlangt": (
                "B4 samt allen vier Groessen wird im SELBEN Register-Akt mit "
                "der E2-Ableitungsregel gehasht und server-bestaetigt "
                "eingefroren - vor dem ersten Motortag jenseits F3 und vor "
                "jedem Zugriff auf Lueckenliste oder Prueffenster. Zeitkette "
                "registeredAt < serverConfirmedAt < accessedAt maschinell "
                "geprueft (K3 Bed. 2)."),
            "warumHierNichtVollzogen": (
                "Der Akt verlangt die E2-ABLEITUNGSREGEL im selben Eintrag. "
                "Diese Regel existiert im Repo nicht (Suche ueber alle "
                "Quell-, JSON- und Markdown-Dateien: null Treffer), und nach "
                "ENTSCHIED 133 wird sie AUSDRUECKLICH im F6-Tor-Register-Akt "
                "mitgehasht. Ein Freeze ohne sie waere ein Teil-Akt, den "
                "VB-A11 nicht kennt. Halter ist zudem namentlich der "
                "Orchestrator, und VB-A13 stellt die Vorlage VOR die "
                "Motortage. Dieses Artefakt ist der vollstaendig vorbereitete "
                "Gegenstand des Akts, nicht der Akt."),
            "nichtGetan": ["kein Register-Eintrag", "kein Siegel beruehrt",
                           "keine Lueckenliste", "kein Prueffenster",
                           "kein versiegelter Endtest", "keine data/lockbox",
                           "F5, F5b und F6 bleiben gesperrt"],
        },
    }


def schreibe(ziel=ARTEFAKT):
    a = artefakt()
    with open(ziel, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(a, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    return a


# =============================================================================
# Selbsttest
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

    n = 400
    # SE* ist der GROESSERE - hier entscheidet der klumpen-robuste.
    r = auswerten(0.95, n, 0.01, 0.02)
    pruefe("SE* nimmt den groesseren der beiden",
           abs(r["seStern"] - 0.02) < 1e-12
           and r["entschied"] == "SE_klumpen-robust")
    pruefe("klar oberhalb -> BESTANDEN, WEITER = 1",
           r["verdikt"] == VERDIKT_BESTANDEN and r["weiter"] == 1)
    pruefe("BESTANDEN traegt das Hausregel-Etikett",
           "HAUSREGEL" in r["etikett"])

    r = auswerten(0.80, n, 0.01, 0.02)
    pruefe("klar unterhalb -> NICHT BESTANDEN, WEITER = 0",
           r["verdikt"] == VERDIKT_NICHT_BESTANDEN and r["weiter"] == 0)

    r = auswerten(0.905, n, 0.01, 0.02)
    pruefe("innerhalb -> NICHT UNTERSCHEIDBAR, WEITER = 0",
           r["verdikt"] == VERDIKT_BAND and r["weiter"] == 0)
    pruefe("der Bandzweig traegt den Pflichtsatz woertlich",
           r["pflichtsatz"] == PFLICHTSATZ_BAND
           and "Messgeraet hat nicht getrennt" in r["zweitsatz"])

    # GESCHLOSSEN: Gleichheit zaehlt INS Band. Ohne `<=` waere das ein PASS.
    # Exakte Gleichheit ist in Gleitkomma nur mit binaer darstellbaren Zahlen
    # herstellbar - 0,9 ist keine. Der Operator wird deshalb an Zahlen
    # geprueft, die exakt aufgehen (0,75 - 0,5 == 0,25), und die Schwelle
    # dafuer als Parameter gefahren. Geprueft wird der VERGLEICH, nicht die
    # Konstante; die Konstante hat ihre eigene Probe im Artefakt.
    r = auswerten(0.75, n, 0.125, 0.25, schwelle=0.5)
    pruefe("Gleichheit zaehlt INS Band (geschlossen, <=)",
           r["abstand"] == r["bandbreiteAbsolut"]
           and r["verdikt"] == VERDIKT_BAND and r["weiter"] == 0)
    # Und die Gegenprobe: der kleinste darstellbare Schritt darueber ist
    # BESTANDEN. Ohne sie waere "immer Band" ein bestandener Test.
    r = auswerten(math.nextafter(0.75, 1.0), n, 0.125, 0.25, schwelle=0.5)
    pruefe("GEGENPROBE: ein Hauch ueber der Bandkante ist BESTANDEN",
           r["verdikt"] == VERDIKT_BESTANDEN and r["weiter"] == 1)

    # KEINE RUNDUNG VOR DEM VERGLEICH.
    r = auswerten(0.9200000001, n, 0.01, 0.02)
    pruefe("keine Rundung vor dem Vergleich",
           r["verdikt"] == VERDIKT_BESTANDEN)

    # Zulaessigkeits-Gate, fail-closed. NIE ein Pass.
    for name, args in (
        ("n < 200", (0.99, 199, 0.001, 0.001)),
        ("n fehlt", (0.99, None, 0.001, 0.001)),
        ("SE_binomial fehlt", (0.99, n, None, 0.001)),
        ("SE_klumpen fehlt", (0.99, n, 0.001, None)),
        ("SE entartet (nan)", (0.99, n, float("nan"), 0.001)),
        ("SE entartet (inf)", (0.99, n, 0.001, float("inf"))),
    ):
        r = auswerten(*args)
        pruefe("Zulaessigkeits-Gate " + name + " -> nie ein Pass",
               r["verdikt"] == VERDIKT_BAND and r["weiter"] == 0
               and r["messgeraetVollstaendig"] is False
               and r["seStern"] is None)

    # Kein Rueckfall auf den kleineren SE: mit nur EINEM SE gibt es kein Tor.
    pruefe("kein Rueckfall auf den kleineren SE",
           auswerten(0.99, n, 0.001, None)["weiter"] == 0)

    # Kipp-Bedingung 5: negativer Klumpen-SE kippt nichts.
    r = auswerten(0.95, n, 0.02, 0.01)
    pruefe("negative Intra-Block-Korrelation kippt nichts (max bleibt max)",
           abs(r["seStern"] - 0.02) < 1e-12 and r["entschied"] == "SE_binomial")

    # WEITER ist binaer, in JEDEM Zweig.
    alle = [auswerten(*a) for a in (
        (0.95, n, 0.01, 0.02), (0.905, n, 0.01, 0.02), (0.80, n, 0.01, 0.02),
        (0.99, 10, 0.01, 0.02))]
    pruefe("WEITER ist binaer, nie etwas dazwischen",
           all(v["weiter"] in (0, 1) for v in alle))
    pruefe("genau EIN Zweig hat WEITER = 1",
           sum(v["weiter"] for v in alle) == 1)

    # Wilson steht in JEDEM Zweig (VB-A10).
    pruefe("Wilson-Intervall steht in jedem Zweig",
           all(v["wilson95"] is not None and len(v["wilson95"]) == 2
               for v in alle))
    lo, hi = auswerten(0.9, 365, 0.016, 0.016)["wilson95"]
    pruefe("Wilson ist plausibel (enthaelt p-Dach, Breite > 0)",
           lo < 0.9 < hi and hi - lo > 0)

    # Beide Abstaende wandern in den Bericht (VB-A10).
    r = auswerten(0.91, n, 0.01, 0.02)
    pruefe("Bericht traegt Abstand zu 0,90 UND zu 329/365",
           r["abstand"] is not None and r["abstandZu329Von365"] is not None)

    # Das Artefakt.
    a = artefakt()
    pruefe("Artefakt: alle vier Groessen stehen drin",
           set(a["inhalt"]["vierGroessen"]) == {
               "1_schwelle", "2_seRechenvorschrift", "3_klumpungseinheit",
               "4_bandbreite"})
    pruefe("Artefakt: der Hash deckt genau den Inhalt",
           a["inhaltSha256"] == hashlib.sha256(
               kanonisch(a["inhalt"])).hexdigest())
    pruefe("Artefakt: der Freeze-Akt ist NICHT vollzogen",
           a["freezeStatus"]["eingefroren"] is False
           and a["freezeStatus"]["halter"] == "Orchestrator")
    pruefe("Artefakt: das Siegel bleibt in ALLEN drei Zweigen zu",
           all("bleibt zu" in a["inhalt"]["endtestSiegel"][z]["siegel"]
               for z in (VERDIKT_BESTANDEN, VERDIKT_BAND,
                         VERDIKT_NICHT_BESTANDEN)))
    pruefe("Artefakt: 329/365 ist nirgends Entscheidungsgroesse",
           "NIE Entscheidungsgroesse"
           in a["inhalt"]["vierGroessen"]["1_schwelle"]["329von365"])
    pruefe("Artefakt: die Zwischenregel steht woertlich drin",
           "Klumpung nach Signal-Entitaet (Firma)"
           in a["inhalt"]["vierGroessen"]["3_klumpungseinheit"][
               "zwischenregelWoertlich"])
    pruefe("Artefakt: kein Ergebnis, keine Prognose",
           not any(z in json.dumps(a, ensure_ascii=False)
                   for z in ("90,4", "90.4", "89,32", "89.32")))

    print("selbsttest: " + str(ok) + " ok, " + str(fehl) + " FAIL")
    return 1 if fehl else 0


def main(argv=None):
    p = argparse.ArgumentParser(description="VB-A9..A13 (B4) - die Bandregel")
    unter = p.add_subparsers(dest="befehl", required=True)
    ar = unter.add_parser("artefakt")
    ar.add_argument("--ziel", default=ARTEFAKT)
    ha = unter.add_parser("hash")
    ha.add_argument("--datei", default=ARTEFAKT)
    au = unter.add_parser("auswerten")
    au.add_argument("--ergebnis", type=float, required=True)
    au.add_argument("--n", type=int, required=True)
    au.add_argument("--se-binomial", type=float)
    au.add_argument("--se-klumpen", type=float)
    unter.add_parser("selbsttest")
    a = p.parse_args(argv)

    if a.befehl == "selbsttest":
        return selbsttest()
    if a.befehl == "artefakt":
        geschrieben = schreibe(a.ziel)
        print("Artefakt      : " + a.ziel)
        print("inhaltSha256  : " + geschrieben["inhaltSha256"])
        print("Datei-SHA-256 : " + hashlib.sha256(
            open(a.ziel, "rb").read()).hexdigest())
        print("eingefroren   : "
              + str(geschrieben["freezeStatus"]["eingefroren"])
              + "  (Halter: " + geschrieben["freezeStatus"]["halter"] + ")")
        return 0
    if a.befehl == "hash":
        with open(a.datei, encoding="utf-8") as fh:
            gelesen = json.load(fh)
        ist = hashlib.sha256(kanonisch(gelesen["inhalt"])).hexdigest()
        print("inhaltSha256 gefuehrt : " + gelesen["inhaltSha256"])
        print("inhaltSha256 gerechnet: " + ist)
        print("Datei-SHA-256         : " + hashlib.sha256(
            open(a.datei, "rb").read()).hexdigest())
        if ist != gelesen["inhaltSha256"]:
            print("HASH WEICHT AB", file=sys.stderr)
            return 1
        return 0
    r = auswerten(a.ergebnis, a.n, a.se_binomial, a.se_klumpen)
    print("Verdikt : " + r["verdikt"])
    print("WEITER  : " + str(r["weiter"]))
    print("SE*     : " + repr(r["seStern"]) + "  (" + repr(r["entschied"]) + ")")
    print("Abstand : " + repr(r["abstand"]))
    print("Wilson  : " + repr(r["wilson95"]))
    print("Grund   : " + r["grund"])
    for feld in ("pflichtsatz", "zweitsatz", "etikett"):
        if r.get(feld):
            print(feld + ": " + r[feld])
    return 0


if __name__ == "__main__":
    sys.exit(main())
