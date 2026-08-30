#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E2 mit der verbreiterten Konzeptliste - OHNE das Siegel anzufassen.

WARUM EIN EIGENES WERKZEUG
--------------------------
`UMSATZ_QUELLEN` steht als Konstante in `scripts/studie-basisraten.py`, und die
Datei ist hash-gebunden: `protocol/early-detection/2.0.0/hash-manifest.json` und
`d3-identifier-bridge-preregistration.json` fuehren beide
997a80d26871937f848b3eea76a9b4ba1a4e1c76f1cc3c30db98d7888ec2601d. Gemessene
Bruchprobe: EINE angehaengte Kommentarzeile laesst `pruefe_manifest` mit
W1-ABBRUCH anhalten. Die Verbreiterung dort einzubauen wuerde also den
V0-Zeugen zerstoeren, den A12 als UNVERAENDERTEN Vergleichsmassstab verlangt.

WAS DIESES WERKZEUG STATTDESSEN TUT
-----------------------------------
Es baut die Mechanik NICHT nach. Es LAEDT das versiegelte Modul (nach einer
Hash-Pruefung) und ruft dieselben Funktionen. `auswertung()` liest
`UMSATZ_QUELLEN` und `ALLE_TAGS` zur AUFRUFZEIT aus den Modul-Globals - der
einzige Unterschied zwischen V0-Lauf und Verbreiterungs-Lauf ist damit die
Eingabe, nie der Rechenweg. Zwei Nachbauten derselben Rechnung driften; einer
kann es nicht.

DER AEQUIVALENZ-WAECHTER LAEUFT IN JEDEM LAUF (Auflage B)
---------------------------------------------------------
Durchlauf 1 faehrt mit den ORIGINAL-Globals und MUSS die publizierten V0-Zahlen
liefern (S-U 512/219, S-G 546/265, S-UG 29/12). Erst danach laeuft Durchlauf 2.
Weicht Durchlauf 1 ab, ist nicht der Vergleich kaputt, sondern die Grundlage -
dann STOPP, und zwar vor jeder verbreiterten Zahl. So ist die gemeinsame
Mechanik je Lauf BEWIESEN statt angenommen.

REINER FALLBACK, NIE GEMISCHT (Auflage C, K7(c) 3:0)
-----------------------------------------------------
Die vier Kennungen greifen NUR bei Firmen, bei denen KEINE der alten Quellen
eine Reihe traegt. Der Vorfilter benutzt fuer diesen Test `quelle_reihe` DESSELBEN
geladenen Moduls - auch die Frage "traegt sie eine alte Quelle?" wird also mit
der versiegelten Mechanik beantwortet, nicht mit einer zweiten Meinung.
Eine Firma, die nach dem Filter alte UND neue Quellen fuehrt, ist ein Abbruch,
kein Sonderfall.

Aufruf:
  python scripts/studie-e2-verbreitert.py --selbsttest
  python scripts/studie-e2-verbreitert.py --bericht --data-root <pfad>
      --fallback-granularitaet firma --ziel reports/studie/E2-verbreitert-<datum>.md
"""

import argparse
import hashlib
import importlib.util
import json
import os
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL_REPO = os.path.dirname(HIER)
VERSIEGELT = os.path.join(HIER, "studie-basisraten.py")
VERSIEGELT_REL = "scripts/studie-basisraten.py"
MANIFEST = os.path.join(WURZEL_REPO, "protocol", "early-detection", "2.0.0",
                        "hash-manifest.json")
KONZEPTLISTE = os.path.join(WURZEL_REPO, "protocol", "early-detection", "2.1.0",
                            "konzeptliste.json")

# Die publizierten V0-Zahlen, gegen die Durchlauf 1 gehalten wird. Sie stehen
# hier als Sollwert und nicht als "was auch immer der Lauf liefert" - ein
# Vergleich gegen sich selbst ist kein Vergleich.
V0_SOLL = {
    "S-U": {"firmen_reif": 512, "firmen_unreif": 219},
    "S-G": {"firmen_reif": 546, "firmen_unreif": 265},
    "S-UG": {"firmen_reif": 29, "firmen_unreif": 12},
}

# Wortgleich wie in scripts/studie-tag-praesenz.py - Anordnung des Orchestrators.
FUSSNOTE = (
    "Quellen-Asymmetrie: Im Entdeckungs-Fenster (bis 2016-12-30) trägt "
    "RevenueFromContractWithCustomerExcludingAssessedTax konstruktionsbedingt 0 Zeilen "
    "(ASC 606 ab 2018); die V0-Umsatzfamilie ruht hier faktisch auf drei ihrer vier "
    "Quellen. Jeder fensterübergreifende Vergleich muss diese Asymmetrie ausweisen."
)


class Abbruch(Exception):
    pass


def sha256_datei(pfad):
    with open(pfad, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def kanonisch_sha256(objekt):
    """Der in der Konzeptliste dokumentierte Rechenweg, nicht ein eigener."""
    roh = json.dumps(objekt, sort_keys=True, separators=(",", ":"),
                     ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(roh).hexdigest()


def lade_versiegeltes_modul():
    """Erst die Bindung pruefen, dann laden. Nie umgekehrt."""
    if not os.path.exists(MANIFEST):
        raise Abbruch("Das Hash-Manifest fehlt: " + MANIFEST)
    with open(MANIFEST, encoding="utf-8") as fh:
        manifest = json.load(fh)
    gebunden = (manifest.get("files") or manifest.get("dateien") or manifest)
    soll = gebunden.get(VERSIEGELT_REL) if isinstance(gebunden, dict) else None
    if not soll:
        raise Abbruch(
            "Das Manifest bindet %s nicht. Ein Lauf, der sich auf eine Bindung "
            "beruft, die es nicht gibt, ist der teuerste Fall - Abbruch."
            % VERSIEGELT_REL)
    ist = sha256_datei(VERSIEGELT)
    if ist != soll:
        raise Abbruch(
            "%s weicht vom Siegel ab (ist %s..., soll %s...). Die V0-Mechanik "
            "ist nach dem Siegel veraendert worden - jeder Vergleich gegen die "
            "publizierten Zahlen waere wertlos." % (VERSIEGELT_REL, ist[:16], soll[:16]))
    spec = importlib.util.spec_from_file_location("studie_basisraten", VERSIEGELT)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul, ist


def lade_verbreiterung():
    """Die vier Kennungen kommen AUS dem eingefrorenen Artefakt (Auflage A)."""
    with open(KONZEPTLISTE, encoding="utf-8") as fh:
        d = json.load(fh)
    ist = kanonisch_sha256(d["konzeptliste"])
    soll = d.get("konzeptlisteSha256")
    if ist != soll:
        raise Abbruch(
            "Die Konzeptliste reproduziert ihren eigenen Hash nicht (ist %s..., "
            "soll %s...). Eine bewegte Liste ist keine eingefrorene Liste."
            % (ist[:16], (soll or "")[:16]))
    eintraege = d["konzeptliste"]
    fremd = [e for e in eintraege if e.get("eintrittsModus") != "reiner_fallback"]
    if fremd:
        raise Abbruch(
            "Ein Eintrag traegt einen anderen Eintritts-Modus als reiner_fallback: "
            "%s. Gemischter Fallback ist per Urteil unzulaessig (K7(c) 3:0) - "
            "Abbruch, kein Filter." % [e.get("concept") for e in fremd])
    nicht_brutto = [e for e in eintraege if e.get("brutto") is not True]
    if nicht_brutto:
        raise Abbruch(
            "Ein Eintrag ist nicht als brutto gefuehrt: %s. Nettoreihen sind als "
            "Signalgrundlage ausgeschlossen (K7(b))."
            % [e.get("concept") for e in nicht_brutto])
    return eintraege, ist


def als_quellen(eintraege, nur_stratum=None):
    """Die Konzeptliste in die Form, die firmenreihen() erwartet.

    Jede Kennung wird EINE Quelle - nie zu einer Summe zusammengefasst. Eine
    Summe waere eine neue Groesse; die Liste friert Kennungen ein, keine Summen.
    """
    gewaehlt = [e for e in eintraege
                if nur_stratum is None
                or bool(e.get("eigenesStratum")) == bool(nur_stratum)]
    return tuple((e["concept"], (e["concept"],)) for e in sorted(
        gewaehlt, key=lambda e: e["concept"]))


def alle_tags_aus(modul, umsatz_quellen):
    """ALLE_TAGS wird im versiegelten Modul aus den drei Familien abgeleitet -
    hier dieselbe Ableitung, damit der SQL-Filter zu den Quellen passt."""
    return tuple(sorted(set(
        t for _, tags in tuple(umsatz_quellen) + modul.ERGEBNIS_QUELLEN
        + modul.DIAGNOSE_QUELLEN for t in tags)))


def baue_fallback_firmenreihen(modul, alt_quellen, neu_quellen):
    """Reiner Fallback JE FIRMA (ENTSCHIED 148, Granularitaet i).

    Die Regel: traegt eine Firma IRGENDWO eine der alten Quellen, bleiben die
    vier Kennungen fuer ihre GANZE Reihe tabu. Nur Firmen, bei denen keine alte
    Quelle eine Reihe traegt, bekommen die vier - und dann NUR die vier.

    Warum je Firma und nicht je Stichtag: Ketten laufen im versiegelten Modul
    vollstaendig innerhalb EINER Quelle (Docstring firmenreihen). Eine
    Stichtags-Granularitaet erzeugte quellwechselnde Ketten - mechanisch ein
    Fremdkoerper und faktisch der 3:0 verbotene gemischte Fallback.

    Gerechnet wird BEIDE Male mit der versiegelten Funktion. Auch die Frage
    "traegt sie eine alte Quelle?" wird damit von der versiegelten Mechanik
    beantwortet und nicht von einer zweiten Meinung.

    ZAEHLER: der zweite Aufruf bekommt einen EIGENEN Praefix. Sonst zaehlte eine
    Firma ohne jede Quelle zweimal als `firma_ohne_quelle` - ein Zaehler, der
    zwei verschiedene Sachverhalte unter einem Namen summiert, ist schlimmer als
    keiner.
    """
    echt = modul.firmenreihen

    def wrapper(je_firma, quellen, nur_positiv, zaehler, praefix):
        # Nur die Umsatz-Familie wird gefiltert. Ergebnis- und Diagnosequelle
        # laufen unveraendert durch das versiegelte Original.
        if tuple(quellen) != tuple(neu_quellen):
            return echt(je_firma, quellen, nur_positiv, zaehler, praefix)

        # Das versiegelte Modul saet ALLE bekannten Gruende auf 0 vor, mit
        # ausdruecklicher Begruendung: "Sonst sieht 'kam nicht vor' genauso aus
        # wie 'wurde nie geprueft'." Sein alle_zaehlernamen() kennt aber nur die
        # drei eigenen Praefixe - der Fallback-Zweig schrieb seine Gruende
        # deshalb nur, wenn sie mindestens einmal feuerten, und ein nie
        # gefeuerter Grund FEHLTE statt 0 zu sein. Genau die Klasse, gegen die
        # die Vorsaat gebaut wurde (ecc-Review 30.08.). Also hier dieselbe
        # Vorsaat fuer den vierten Praefix, abgeleitet aus der Liste des Moduls.
        fb = praefix + "fallback_"
        for name in modul.alle_zaehlernamen():
            if name.startswith(praefix):
                # setdefault statt `+= 0`: der Zaehler ist in der Produktion ein
                # defaultdict, im Test aber ein blankes dict - eine Vorsaat, die
                # nur auf einem der beiden funktioniert, ist keine.
                zaehler.setdefault(fb + name[len(praefix):], 0)

        alle_alt, gewaehlt_alt = echt(je_firma, alt_quellen, nur_positiv,
                                      zaehler, praefix)
        mit_alt = set(alle_alt)
        ohne_alt = {cik: w for cik, w in je_firma.items() if cik not in mit_alt}
        alle_neu, gewaehlt_neu = echt(ohne_alt, neu_quellen, nur_positiv,
                                      zaehler, praefix + "fallback_")

        doppelt = mit_alt & set(alle_neu)
        if doppelt:
            raise Abbruch(
                "%d Firmen fuehren nach dem Vorfilter ALTE UND NEUE Quellen "
                "(z. B. %s). Ein gemischter Zustand ist Abbruch, kein Filter "
                "(K7(c) 3:0)." % (len(doppelt), sorted(doppelt)[:3]))

        zaehler[praefix + "firmen_auf_alten_quellen"] = len(mit_alt)
        zaehler[praefix + "firmen_im_fallback"] = len(alle_neu)
        zaehler[praefix + "firmen_ohne_jede_quelle"] = len(ohne_alt) - len(alle_neu)

        alle = dict(alle_alt)
        alle.update(alle_neu)
        gewaehlt = dict(gewaehlt_alt)
        gewaehlt.update(gewaehlt_neu)
        return alle, gewaehlt

    return wrapper


def pruefe_plausibilitaet(v0, verbreitert):
    """Ein reiner Fallback JE FIRMA kann nur HINZUFUEGEN.

    Firmen mit alter Quelle bekommen exakt ihre alten Quellen, also dieselbe
    Reihe und dieselbe Reife; dazu kommen die Fallback-Firmen. Also darf in S-U
    und S-UG WEDER die reife NOCH die unreife Zahl sinken - eine hinzugekommene
    Firma landet in einem der beiden Toepfe, keiner darf schrumpfen. Und S-G
    darf sich gar nicht bewegen, die Ergebnis-Familie wird nicht angefasst.

    DIESE FUNKTION IST DAS TOR. Sie stand vorher als Kopie im Selbsttest und
    inline in haupt() - der Test bewies damit, dass die KOPIE greift, nicht der
    ausgelieferte Code, und beide Fassungen pruefen nur `firmen_reif`. Beides
    im ecc-Review 30.08. gefunden; jetzt gibt es genau eine Fassung, und sie
    prueft beide Toepfe.

    Ein FEHLENDES Signal ist ein Verstoss, kein Freispruch: "nicht da" darf nie
    aussehen wie "nicht gesunken".
    """
    verstoesse = []
    for name in ("S-U", "S-UG"):
        a = v0.get(name)
        b = verbreitert.get(name)
        if a is None or b is None:
            verstoesse.append("%s fehlt in einem der beiden Durchlaeufe" % name)
            continue
        for topf in ("firmen_reif", "firmen_unreif"):
            if a.get(topf) is None or b.get(topf) is None:
                verstoesse.append("%s.%s fehlt" % (name, topf))
            elif b[topf] < a[topf]:
                verstoesse.append(
                    "%s.%s sinkt von %d auf %d - ein reiner Fallback kann nur "
                    "hinzufuegen" % (name, topf, a[topf], b[topf]))
    if v0.get("S-G") != verbreitert.get("S-G"):
        verstoesse.append("S-G bewegt sich (%s -> %s), obwohl die Ergebnis-Familie "
                          "nicht angefasst wird" % (v0.get("S-G"), verbreitert.get("S-G")))
    return verstoesse


def bewerte_k8(mit_bank, ohne_bank, bank_allein):
    """Die vier KUMULATIVEN Bedingungen aus K8 (einstimmig 4:0), einzeln belegt.

    Woertlich im Urteil: "ZULASSEN - ABER AUSSCHLIESSLICH ALS EIGENES STRATUM,
    mit vier kumulativen Bedingungen. Faellt auch nur eine, bleibt die
    Bank-/Zinsklasse mit einer SCOPE-AUSSAGE in der Praereg draussen -
    ausdruecklich nicht als Datenluecke."

    Diese Funktion belegt jede Bedingung EINZELN und zieht die Konsequenz selbst.
    Sie ist bewusst so gebaut, dass sie NICHT weichgekocht werden kann: eine
    Bedingung, die einen Register-Akt braucht, gilt ohne diesen Akt als NICHT
    belegt - nicht als "im Prinzip erfuellt".
    """
    # Was hier NICHT steht, und warum: eine "Reifequote der Bank-Kohorte".
    # Die erste Fassung rechnete sie aus dem Bank-Durchlauf - aber dessen S-U
    # enthaelt AUCH alle Firmen auf alten Quellen, die vom Fallback gar nicht
    # beruehrt werden. Die Zahl war damit die Quote der ganzen Familie und nicht
    # die der Kohorte, und ein Vergleich gegen das Panel war bedeutungslos. Eine
    # Zahl, die wie ein Beleg aussieht und keiner ist, ist schlimmer als keine.
    # Beziffert wird deshalb nur, was sauber beziffert werden kann: wie viele
    # Firmen ueber WELCHE Kennung eingetreten sind.
    def eingetreten(lauf):
        z = lauf.get("zaehler") or {}
        return z.get("umsatz_firmen_im_fallback")

    lager = {
        "ueberAlleVier": eingetreten(mit_bank),
        "ueberDieDreiOperativen": eingetreten(ohne_bank),
        "ueberDieBankKennungAllein": eingetreten(bank_allein),
    }

    bedingungen = [
        {
            "nummer": 1,
            "wortlaut": ("Getrennt berichtet, getrennt gegen die Nullmodelle geprueft "
                         "und getrennt in der FDR-Familie."),
            "belegt": False,
            "begruendung": ("Getrennt BERICHTET ist erfuellt - dieses Artefakt fuehrt "
                            "das Stratum als eigenen Durchlauf. Getrennt gegen die "
                            "Nullmodelle und getrennt in der FDR-Familie sind "
                            "Eigenschaften spaeterer Stufen, zu denen es heute kein "
                            "Artefakt gibt. Eine Bedingung, die zu einem Drittel "
                            "erfuellt ist, ist nicht erfuellt."),
        },
        {
            "nummer": 2,
            "wortlaut": ("Praeregistrierte Klumpungseinheit Entity-Klasse x Signalquartal "
                         "fuer jede nachgelagerte Streuungs- und Signifikanzaussage."),
            "belegt": False,
            "begruendung": ("PRAEREGISTRIERT heisst: vor dem Blick angemeldet. Ein "
                            "solcher Register-Eintrag existiert nicht. Der Executor "
                            "kann ihn nicht selbst setzen - das Register ist "
                            "nur-anhaengend und extern bezeugt."),
        },
        {
            "nummer": 3,
            "wortlaut": ("Eigene Ereignis-/Label-Abdeckungszahl, vorab gemessen, nicht "
                         "unter der des Gesamtpanels."),
            "belegt": False,
            "gemessenFirmenImFallback": lager,
            "begruendung": ("Messbar war nur, WIE VIELE Firmen ueber welche Kennung "
                            "eingetreten sind. Das Urteil verlangt die EREIGNIS-/"
                            "LABEL-Abdeckung der Bank-Kohorte, und deren Loch sitzt "
                            "laut Urteil genau bei Banken (SEC-only-Ereignisregel, "
                            "Meldeweg ueber Dritte, First Republic als Beleg). Diese "
                            "Groesse ist mit den heute vorhandenen Artefakten nicht "
                            "messbar. Eine Eintritts- oder Reifezahl als Ersatz "
                            "auszugeben waere genau die Waehrungs-Abwertung, vor der "
                            "das Urteil warnt - deshalb steht hier eine Eintrittszahl "
                            "und ausdruecklich KEIN Abdeckungs-Ersatz."),
        },
        {
            "nummer": 4,
            "wortlaut": ("Bank-Zinsertrag wird weder still mit operativem Produktumsatz "
                         "gepoolt noch zur Reparatur des primaeren Arms benutzt."),
            "belegt": True,
            "begruendung": ("Konstruktiv erfuellt: die Bank-Kennung laeuft in einem "
                            "EIGENEN Prozess mit eigener Quellenmenge; es gibt keinen "
                            "Codepfad, der sie in die operative Familie mischt. Der "
                            "Nachweis liegt in den getrennten Durchlauf-Protokollen."),
        },
    ]
    offen = [b_["nummer"] for b_ in bedingungen if not b_["belegt"]]
    return {
        "urteil": "K8, einstimmig 4:0, vier kumulative Bedingungen",
        "bedingungen": bedingungen,
        "nichtBelegt": offen,
        "stratumZulaessig": not offen,
        "konsequenz": (
            "Bedingung(en) %s nicht belegt -> das Bank-Stratum faellt. Die "
            "Bank-/Zinsklasse bleibt damit als SCOPE-AUSSAGE draussen, "
            "ausdruecklich NICHT als Datenluecke: die Bank-Kennung tritt gar "
            "nicht ein, weder als eigenes Stratum noch gepoolt. Massgeblich ist "
            "deshalb der Durchlauf OHNE Bank. Das ist das korrekte Ergebnis und "
            "kein Fehlschlag - es wurde VOR der Messung so festgelegt, damit "
            "niemand hinterher die Bedingungen weichkocht, um die Zahl zu "
            "retten." % offen) if offen else
            "Alle vier Bedingungen belegt - das Stratum ist zulaessig und wird "
            "getrennt gefuehrt.",
    }


def zahlen_aus(ergebnis):
    """Die drei Paare, an denen der Aequivalenz-Waechter haengt."""
    signale = ergebnis.get("signale", ergebnis)
    return {name: {"firmen_reif": signale[name]["firmen_reif"],
                   "firmen_unreif": signale[name]["firmen_unreif"]}
            for name in V0_SOLL if name in signale}


def pruefe_aequivalenz(gemessen):
    """Auflage B: Durchlauf 1 MUSS die publizierten V0-Zahlen liefern."""
    abweichungen = []
    for name, soll in V0_SOLL.items():
        ist = gemessen.get(name)
        if ist is None:
            abweichungen.append("%s fehlt im Ergebnis" % name)
            continue
        for feld, wert in soll.items():
            if ist.get(feld) != wert:
                abweichungen.append("%s.%s ist %s, soll %s"
                                    % (name, feld, ist.get(feld), wert))
    if abweichungen:
        raise Abbruch(
            "AEQUIVALENZ-STOPP: der Nur-Alt-Quellen-Durchlauf trifft die "
            "publizierten V0-Zahlen nicht (%s). Nicht der Vergleich ist kaputt, "
            "sondern die Grundlage - es wird keine verbreiterte Zahl gerechnet."
            % "; ".join(abweichungen))
    return True


def fuehre_durchlauf(modus, wurzel, arbeit_pfad):
    """EIN Durchlauf in DIESEM Prozess. Nie zwei - Auflage F.

    Der Aufrufer startet fuer jeden Modus einen eigenen Interpreter. Damit kann
    kein Zustand aus dem Alt-Lauf in den Verbreiterungs-Lauf wandern; die
    Speicher-Substitution ist auf einen Prozess begrenzt, der nichts anderes tut.
    """
    modul, modul_hash = lade_versiegeltes_modul()
    eintraege, listen_hash = lade_verbreiterung()
    alt_quellen = tuple(modul.UMSATZ_QUELLEN)
    protokoll = {
        "modus": modus,
        "versiegeltesModul": VERSIEGELT_REL,
        "modulSha256": modul_hash,
        "modulSha256GegenManifestGeprueft": True,
        "konzeptlisteSha256": listen_hash,
        "globalsVorher": {"UMSATZ_QUELLEN": [n for n, _ in alt_quellen],
                          "ALLE_TAGS": list(modul.ALLE_TAGS)},
    }

    if modus in ("verbreitert", "verbreitert_ohne_bank", "bank_allein"):
        if modus == "verbreitert":
            neu_quellen = als_quellen(eintraege)
        elif modus == "verbreitert_ohne_bank":
            # Die Fassung, die gilt, wenn das Bank-Stratum nach K8 faellt: die
            # Bank-Kennung tritt dann GAR NICHT ein - weder eigenes Stratum noch
            # gepoolt. "Begruendet draussen lassen" heisst draussen, nicht leise
            # mitlaufen.
            neu_quellen = als_quellen(eintraege, nur_stratum=False)
        else:
            neu_quellen = als_quellen(eintraege, nur_stratum=True)
        # Die Substitution: NUR im Speicher, nie auf der Platte. Das Siegel
        # bindet Bytes - die Datei bleibt unangetastet, und dass substituiert
        # wurde, steht nachpruefbar im Artefakt statt nirgends.
        modul.UMSATZ_QUELLEN = neu_quellen
        # ALLE_TAGS ist der SQL-Filter, mit dem die Rohwerte ueberhaupt erst aus
        # dem Panel geladen werden - und der Vorfilter braucht BEIDE Seiten: er
        # muss je Firma fragen, ob eine ALTE Quelle eine Reihe traegt. Stuenden
        # hier nur die vier neuen Kennungen, waeren die alten Zeilen nie geladen,
        # der Vorfilter saehe ueberall "keine alte Quelle" und schoebe faktisch
        # ALLE Firmen in den Fallback. Genau das ist im ersten Lauf passiert:
        # S-U fiel von 512 auf 253 - eine Verbreiterung, die die Zahl SENKT, ist
        # kein Ergebnis, sondern ein Befund. Deshalb die Vereinigung.
        modul.ALLE_TAGS = alle_tags_aus(modul, tuple(alt_quellen) + tuple(neu_quellen))
        modul.firmenreihen = baue_fallback_firmenreihen(modul, alt_quellen, neu_quellen)
        protokoll["globalsNachher"] = {
            "UMSATZ_QUELLEN": [n for n, _ in neu_quellen],
            "ALLE_TAGS": list(modul.ALLE_TAGS),
            "firmenreihen": "Vorfilter reiner Fallback je Firma (ENTSCHIED 148)",
        }
        protokoll["fallbackGranularitaet"] = "firma"
    else:
        protokoll["globalsNachher"] = protokoll["globalsVorher"]

    panel_pfad = os.path.join(wurzel, "panel", modul.FENSTER_DATEI)
    panel = modul.oeffne_nur_lesend(panel_pfad)
    arbeit = modul.oeffne_zwischenstand(arbeit_pfad, True)
    try:
        daten = modul.auswertung(panel, arbeit, False)
    finally:
        panel.close()
        arbeit.close()
    daten["substitutionsProtokoll"] = protokoll
    daten["quellenAsymmetrie"] = FUSSNOTE
    return daten


def starte_prozess(modus, wurzel, arbeit_pfad, ergebnis_pfad):
    """Auflage F: eigener Interpreter je Durchlauf, frisch geladen."""
    import subprocess
    ruf = [sys.executable, os.path.abspath(__file__), "durchlauf",
           "--modus", modus, "--data-root", wurzel,
           "--arbeit", arbeit_pfad, "--ergebnis", ergebnis_pfad]
    # Frist statt Ewigkeit: der Lauf ist unbeaufsichtigt. Ein Kind, das an einer
    # sqlite-Sperre oder einer haengenden Platte stehenbleibt, wuerde sonst die
    # ganze Nacht blockieren, ohne eine Zeile zu sagen (ecc-Review 30.08.).
    try:
        fertig = subprocess.run(ruf, capture_output=True, text=True, timeout=7200)
    except subprocess.TimeoutExpired:
        raise Abbruch("Durchlauf '%s' hat die Frist von 7200 s ueberschritten "
                      "und wurde abgebrochen." % modus)
    if fertig.returncode != 0:
        raise Abbruch("Durchlauf '%s' endete mit %d: %s"
                      % (modus, fertig.returncode, (fertig.stderr or "").strip()[:400]))
    with open(ergebnis_pfad, encoding="utf-8") as fh:
        return json.load(fh)


def haupt(argv):
    ap = argparse.ArgumentParser(
        description="E2 mit verbreiterter Konzeptliste, ohne das Siegel anzufassen.")
    ap.add_argument("befehl", nargs="?", choices=["durchlauf"],
                    help="intern: EIN Durchlauf in diesem Prozess (Auflage F)")
    ap.add_argument("--modus", choices=["alt", "verbreitert",
                                          "verbreitert_ohne_bank", "bank_allein"])
    ap.add_argument("--data-root")
    ap.add_argument("--arbeit")
    ap.add_argument("--ergebnis")
    ap.add_argument("--ziel")
    ap.add_argument("--bericht", action="store_true")
    ap.add_argument("--selbsttest", action="store_true")
    # BEWUSST OHNE VORGABEWERT: die Granularitaet des reinen Fallbacks ist eine
    # Konformitaetsfrage an die Urteilslage, keine Voreinstellung. Ein Lauf ohne
    # ausdrueckliche Wahl ist ein Lauf, dessen Semantik niemand entschieden hat.
    ap.add_argument("--fallback-granularitaet", choices=["firma"])
    a = ap.parse_args(argv)

    if a.selbsttest:
        return selbsttest()

    wurzel = a.data_root or os.environ.get("EARLY_DETECTION_DATA_ROOT")
    if not wurzel:
        print("ABBRUCH: --data-root fehlt und EARLY_DETECTION_DATA_ROOT ist nicht "
              "gesetzt (R12a).", file=sys.stderr)
        return 2

    if a.befehl == "durchlauf":
        if not (a.modus and a.arbeit and a.ergebnis):
            ap.error("durchlauf braucht --modus, --arbeit und --ergebnis.")
        daten = fuehre_durchlauf(a.modus, wurzel, a.arbeit)
        text = json.dumps(daten, ensure_ascii=False, indent=1) + "\n"
        with open(a.ergebnis + ".teil", "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(a.ergebnis + ".teil", a.ergebnis)
        return 0

    if not a.bericht:
        ap.error("Nichts zu tun: --selbsttest, --bericht oder durchlauf.")
    if a.fallback_granularitaet != "firma":
        print("ABBRUCH: --fallback-granularitaet firma fehlt. Die Granularitaet "
              "des reinen Fallbacks ist eine Konformitaetsfrage an die "
              "Urteilslage und hat bewusst keinen Vorgabewert.", file=sys.stderr)
        return 4
    if not a.ziel:
        ap.error("--ziel fehlt (Artefakt-Pfad, 2.1.0-Namensraum bzw. reports/studie).")
    if "2.0.0" in a.ziel.replace("\\", "/"):
        print("ABBRUCH: aus dem Verbreiterungs-Lauf wird nichts in eine "
              "2.0.0-Ausgabe geschrieben (Auflage E/F).", file=sys.stderr)
        return 5

    arbeitsdir = os.path.join(wurzel, "arbeit")
    os.makedirs(arbeitsdir, exist_ok=True)
    marke = os.path.basename(os.path.splitext(a.ziel)[0])

    print("Durchlauf 1/2 (Original-Globals, Aequivalenz-Tor) ...")
    alt = starte_prozess("alt", wurzel, os.path.join(arbeitsdir, marke + "-alt.sqlite"),
                         os.path.join(arbeitsdir, marke + "-alt.json"))
    gemessen = zahlen_aus(alt)
    pruefe_aequivalenz(gemessen)
    print("  Tor offen: " + ", ".join("%s %d/%d" % (n, v["firmen_reif"], v["firmen_unreif"])
                                      for n, v in gemessen.items()))

    print("Durchlauf 2/2 (substituierte Globals, reiner Fallback je Firma) ...")
    neu = starte_prozess("verbreitert", wurzel,
                         os.path.join(arbeitsdir, marke + "-neu.sqlite"),
                         os.path.join(arbeitsdir, marke + "-neu.json"))

    # PLAUSIBILITAETS-TOR. Die Regel steht in pruefe_plausibilitaet() - EINMAL,
    # damit der Selbsttest dasselbe prueft, was hier laeuft. Die erste Fassung
    # stand inline und im Test als Kopie; der Test bewies dann die Kopie.
    neu_zahlen = zahlen_aus(neu)
    verstoesse = pruefe_plausibilitaet(gemessen, neu_zahlen)
    if verstoesse:
        raise Abbruch("PLAUSIBILITAETS-STOPP: " + "; ".join(verstoesse)
                      + ". Es wird kein Artefakt geschrieben.")

    print("Durchlauf 3/4 (ohne Bank - die Fassung, wenn K8 das Stratum fallen laesst) ...")
    ohne_bank = starte_prozess("verbreitert_ohne_bank", wurzel,
                               os.path.join(arbeitsdir, marke + "-ob.sqlite"),
                               os.path.join(arbeitsdir, marke + "-ob.json"))
    print("Durchlauf 4/4 (Bank allein - fuer die K8-Bedingungen) ...")
    bank = starte_prozess("bank_allein", wurzel,
                          os.path.join(arbeitsdir, marke + "-bank.sqlite"),
                          os.path.join(arbeitsdir, marke + "-bank.json"))
    k8 = bewerte_k8(neu, ohne_bank, bank)
    massgeblich = "verbreitertOhneBank" if not k8["stratumZulaessig"] else "verbreitert"
    print("  K8: " + ("Stratum zulaessig" if k8["stratumZulaessig"]
                      else "Stratum FAELLT (Bedingungen %s nicht belegt)" % k8["nichtBelegt"]))

    artefakt = {
        "schema": "studie-e2-verbreitert/v1",
        "k8BankStratum": k8,
        "massgeblicheFassung": massgeblich,
        "durchlaufOhneBank": {"protokoll": ohne_bank["substitutionsProtokoll"],
                              "signale": zahlen_aus(ohne_bank)},
        "durchlaufBankAllein": {"protokoll": bank["substitutionsProtokoll"],
                                "signale": zahlen_aus(bank)},
        "auflagen": "ENTSCHIED 147 (Weg a) + 148 (Granularitaet Firma), Auflagen A-F",
        "quellenAsymmetrie": FUSSNOTE,
        "aequivalenzTor": {"soll": V0_SOLL, "gemessen": gemessen, "bestanden": True},
        "durchlaufAlt": {"protokoll": alt["substitutionsProtokoll"],
                         "signale": zahlen_aus(alt)},
        "durchlaufVerbreitert": {"protokoll": neu["substitutionsProtokoll"],
                                 "signale": zahlen_aus(neu),
                                 "zaehlerFallback": {
                                     k: v for k, v in (neu.get("zaehler") or {}).items()
                                     if "fallback" in k or "firmen_auf_alten" in k
                                     or "firmen_im_fallback" in k
                                     or "firmen_ohne_jede" in k}},
    }
    text = json.dumps(artefakt, ensure_ascii=False, indent=1) + "\n"
    with open(a.ziel + ".teil", "w", encoding="utf-8") as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(a.ziel + ".teil", a.ziel)
    print("Artefakt: " + a.ziel)
    for name in ("S-U", "S-G", "S-UG"):
        av = zahlen_aus(alt).get(name, {})
        nv = zahlen_aus(neu).get(name, {})
        print("  %-5s V0 %4s/%-4s -> verbreitert %4s/%-4s"
              % (name, av.get("firmen_reif"), av.get("firmen_unreif"),
                 nv.get("firmen_reif"), nv.get("firmen_unreif")))
    return 0


def selbsttest():
    """Was hier schon pruefbar ist: die Tore, nicht die Rechnung."""
    ok = fail = 0

    def pruef(bedingung, text):
        nonlocal ok, fail
        if bedingung:
            ok += 1
            print("  ok    " + text)
        else:
            fail += 1
            print("  FAIL  " + text)

    # Die Hash-Bindung, beide Richtungen - ohne die versiegelte Datei anzufassen.
    try:
        modul, h = lade_versiegeltes_modul()
        pruef(hasattr(modul, "UMSATZ_QUELLEN") and hasattr(modul, "auswertung"),
              "das versiegelte Modul laedt und traegt UMSATZ_QUELLEN + auswertung")
        pruef(len(modul.UMSATZ_QUELLEN) == 4,
              "die alten Quellen sind unveraendert vier")
    except Abbruch as e:
        pruef(False, "das versiegelte Modul laedt: " + str(e)[:80])
        modul = None

    echt_manifest = MANIFEST
    try:
        globals()["MANIFEST"] = os.path.join(HIER, "gibt-es-nicht.json")
        try:
            lade_versiegeltes_modul()
            pruef(False, "ROT-PROBE: fehlendes Manifest bricht ab")
        except Abbruch:
            pruef(True, "ROT-PROBE: fehlendes Manifest bricht ab")
    finally:
        globals()["MANIFEST"] = echt_manifest

    eintraege, lh = lade_verbreiterung()
    pruef(len(eintraege) == 4, "die eingefrorene Liste traegt vier Kennungen")
    pruef(all(e["eintrittsModus"] == "reiner_fallback" for e in eintraege),
          "alle vier sind reiner Fallback - sonst waere hier Abbruch")
    quellen = als_quellen(eintraege)
    pruef(len(quellen) == 4 and all(len(t) == 1 for _, t in quellen),
          "jede Kennung wird EINE Quelle, nie zu einer Summe zusammengefasst")
    bank = als_quellen(eintraege, nur_stratum=True)
    pruef([n for n, _ in bank] == ["InterestAndDividendIncomeOperating"],
          "das Banken-Stratum ist genau eine Kennung und getrennt fuehrbar")

    if modul is not None:
        tags = alle_tags_aus(modul, quellen)
        pruef(set(tags) >= set(e["concept"] for e in eintraege),
              "der SQL-Filter deckt die vier neuen Kennungen ab")
        pruef("OperatingIncomeLoss" in tags and "NetIncomeLoss" in tags,
              "und laesst Ergebnis- und Diagnosequelle unangetastet")
        # Die Probe, die den ersten Fehllauf gefangen haette: im
        # Verbreiterungs-Modus muss der SQL-Filter BEIDE Seiten laden, sonst
        # sieht der Vorfilter nirgends eine alte Quelle und schiebt alle Firmen
        # in den Fallback (gemessen: S-U 512 -> 253).
        beide = alle_tags_aus(modul, tuple(modul.UMSATZ_QUELLEN) + tuple(quellen))
        pruef(set(beide) >= set(t for _, ts in modul.UMSATZ_QUELLEN for t in ts),
              "der Filter des Verbreiterungs-Laufs traegt AUCH die alten Kennungen")
        pruef(set(beide) >= set(e["concept"] for e in eintraege),
              "und die neuen - der Vorfilter braucht beide Seiten")

    # Das Plausibilitaets-Tor - geprueft wird DIE FUNKTION, die auch laeuft.
    basis = {"S-U": {"firmen_reif": 512, "firmen_unreif": 219},
             "S-G": {"firmen_reif": 546, "firmen_unreif": 265},
             "S-UG": {"firmen_reif": 29, "firmen_unreif": 12}}
    mehr = {"S-U": {"firmen_reif": 540, "firmen_unreif": 248},
            "S-G": {"firmen_reif": 546, "firmen_unreif": 265},
            "S-UG": {"firmen_reif": 31, "firmen_unreif": 12}}
    pruef(pruefe_plausibilitaet(basis, mehr) == [],
          "GEGENPROBE: ein Fallback, der HINZUFUEGT, geht durch")
    weniger = {"S-U": {"firmen_reif": 253, "firmen_unreif": 81},
               "S-G": {"firmen_reif": 546, "firmen_unreif": 265},
               "S-UG": {"firmen_reif": 2, "firmen_unreif": 1}}
    pruef(len(pruefe_plausibilitaet(basis, weniger)) == 4,
          "ROT-PROBE: der echte Fehllauf (512->253) wird gefangen, in BEIDEN Toepfen")
    nur_unreif = {"S-U": {"firmen_reif": 512, "firmen_unreif": 90},
                  "S-G": {"firmen_reif": 546, "firmen_unreif": 265},
                  "S-UG": {"firmen_reif": 29, "firmen_unreif": 4}}
    pruef(len(pruefe_plausibilitaet(basis, nur_unreif)) == 2,
          "ROT-PROBE (ecc-Review): NUR die unreifen sinken - fruehere Fassung war hier gruen")
    bewegt = {"S-U": {"firmen_reif": 540, "firmen_unreif": 248},
              "S-G": {"firmen_reif": 545, "firmen_unreif": 265},
              "S-UG": {"firmen_reif": 31, "firmen_unreif": 12}}
    pruef(pruefe_plausibilitaet(basis, bewegt) == ["S-G bewegt sich ({'firmen_reif': 546, "
          "'firmen_unreif': 265} -> {'firmen_reif': 545, 'firmen_unreif': 265}), obwohl die "
          "Ergebnis-Familie nicht angefasst wird"],
          "ROT-PROBE: eine Bewegung in der unberuehrten Ergebnis-Familie wird gefangen")
    pruef(pruefe_plausibilitaet(basis, {"S-U": basis["S-U"], "S-G": basis["S-G"]}) != [],
          "ROT-PROBE: ein FEHLENDES Signal ist ein Verstoss, kein Freispruch")

    # ── Der Vorfilter: reiner Fallback je Firma, an einem Puppen-Modul ─────────
    # Geprueft wird die REGEL, nicht die Rechnung: welche Firma bekommt welche
    # Quellen. Das echte firmenreihen wird dafuer durch eine Attrappe ersetzt,
    # die nur festhaelt, womit sie gerufen wurde - so ist sichtbar, WER wen sieht.
    pruef(FUSSNOTE.startswith("Quellen-Asymmetrie:") and "ASC 606 ab 2018" in FUSSNOTE,
          "die Pflicht-Fussnote liegt woertlich vor")
    # "wortgleich" war eine Behauptung, bis das hier stand: der WORTLAUT ist der
    # Gegenstand der Auflage, also wird die Gleichheit gemessen statt zugesagt.
    nachbar = os.path.join(HIER, "studie-tag-praesenz.py")
    if os.path.exists(nachbar):
        sp = importlib.util.spec_from_file_location("studie_tag_praesenz", nachbar)
        mp = importlib.util.module_from_spec(sp)
        sp.loader.exec_module(mp)
        pruef(mp.FUSSNOTE == FUSSNOTE,
              "und ist mit der in studie-tag-praesenz.py WIRKLICH wortgleich")
    else:
        print("  --    Nachbar-Werkzeug liegt auf einem anderen Zweig; "
              "Wortgleichheit hier nicht pruefbar (ehrlich benannt, nicht uebersprungen)")

    class Puppe:
        # Steht fuer das versiegelte Modul. Sie muss alles koennen, was der
        # Vorfilter davon benutzt - auch die Zaehlernamen-Liste, aus der er
        # den Fallback-Praefix vorsaet.
        @staticmethod
        def alle_zaehlernamen():
            return ["umsatz_firma_ohne_quelle", "umsatz_umsatz_nicht_positiv",
                    "betriebsergebnis_firma_ohne_quelle"]

    ALT = (("Revenues", ("Revenues",)),)
    NEU = (("OilAndGasRevenue", ("OilAndGasRevenue",)),)
    rufe = []

    def attrappe(je_firma, quellen, nur_positiv, zaehler, praefix):
        rufe.append((sorted(je_firma), [n for n, _ in quellen], praefix))
        # Firma "A" traegt Revenues, Firma "B" nur OilAndGas, "C" gar nichts.
        traegt = {"Revenues": {"A"}, "OilAndGasRevenue": {"B"}}
        namen = set(n for n, _ in quellen)
        treffer = set()
        for n in namen:
            treffer |= traegt.get(n, set())
        alle = {cik: {"reihe": n} for cik in sorted(set(je_firma) & treffer)
                for n in namen if cik in traegt.get(n, set())}
        return alle, {cik: {} for cik in alle}

    p = Puppe()
    p.firmenreihen = attrappe
    wrapper = baue_fallback_firmenreihen(p, ALT, NEU)
    zaehler = {}
    alle, _gew = wrapper({"A": 1, "B": 2, "C": 3}, NEU, True, zaehler, "umsatz_")
    pruef(sorted(alle) == ["A", "B"],
          "A bleibt auf der alten Quelle, B kommt ueber den Fallback dazu")
    pruef(rufe[0][1] == ["Revenues"] and rufe[0][0] == ["A", "B", "C"],
          "erst werden ALLE Firmen gegen die ALTEN Quellen gefragt")
    pruef(rufe[1][1] == ["OilAndGasRevenue"] and rufe[1][0] == ["B", "C"],
          "die vier sehen NUR die Firmen ohne alte Quelle - A ist fuer sie unsichtbar")
    pruef(rufe[1][2] == "umsatz_fallback_",
          "der Fallback-Aufruf zaehlt unter EIGENEM Praefix, nichts wird doppelt gezaehlt")
    # Der HIGH aus dem ecc-Review: ein Fallback-Grund, der NIE feuert, muss als 0
    # dastehen und darf nicht fehlen - sonst sieht "kam nicht vor" aus wie "wurde
    # nie geprueft". Das versiegelte Modul saet seine drei Praefixe vor, den
    # vierten kannte es nicht.
    pruef(zaehler.get("umsatz_fallback_umsatz_nicht_positiv") == 0,
          "ein NIE gefeuerter Fallback-Grund steht als 0 im Zaehlwerk, statt zu fehlen")
    pruef("betriebsergebnis_fallback_firma_ohne_quelle" not in zaehler,
          "und die Vorsaat greift nur beim eigenen Praefix, nicht bei fremden Familien")
    pruef(zaehler.get("umsatz_firmen_auf_alten_quellen") == 1
          and zaehler.get("umsatz_firmen_im_fallback") == 1
          and zaehler.get("umsatz_firmen_ohne_jede_quelle") == 1,
          "die drei Lager werden einzeln beziffert (1 alt, 1 Fallback, 1 ohne)")

    # ROT-PROBE fuer die Misch-Wache. WAS sie wirklich bewacht, musste erst
    # geklaert werden: der gemischte Zustand ist durch die Konstruktion
    # unmoeglich - `ohne_alt` IST das Komplement von `mit_alt`. Die erste Fassung
    # dieser Probe war deshalb gruen aus dem falschen Grund und wurde ersetzt.
    # Bewacht wird der VERTRAG des Originals: gaebe firmenreihen je eine Firma
    # zurueck, die gar nicht in seiner Eingabe stand, waere die Trennung still
    # gebrochen. Genau das stellt die Attrappe nach.
    def attrappe_vertragsbruch(je_firma, quellen, nur_positiv, zaehler, praefix):
        if [n for n, _ in quellen] == ["Revenues"]:
            return {"A": {}}, {"A": {}}
        return {"A": {}}, {"A": {}}   # liefert A zurueck, obwohl A nie Eingabe war

    p2 = Puppe()
    p2.firmenreihen = attrappe_vertragsbruch
    try:
        baue_fallback_firmenreihen(p2, ALT, NEU)({"A": 1, "B": 2}, NEU, True, {}, "umsatz_")
        pruef(False, "ROT-PROBE: eine Firma in BEIDEN Lagern bricht ab, statt zu filtern")
    except Abbruch:
        pruef(True, "ROT-PROBE: eine Firma in BEIDEN Lagern bricht ab, statt zu filtern")

    # Die Ergebnis-Familie darf der Vorfilter NICHT anfassen.
    rufe.clear()
    wrapper({"A": 1}, (("OperatingIncomeLoss", ("OperatingIncomeLoss",)),), False,
            {}, "betriebsergebnis_")
    pruef(len(rufe) == 1 and rufe[0][1] == ["OperatingIncomeLoss"],
          "die Ergebnis-Familie laeuft unveraendert durch das Original")

    print("\nselbsttest: %d ok, %d FAIL" % (ok, fail))
    return 1 if fail else 0


if __name__ == "__main__":
    try:
        sys.exit(haupt(sys.argv[1:]))
    except Abbruch as e:
        print("ABBRUCH: " + str(e), file=sys.stderr)
        sys.exit(3)
