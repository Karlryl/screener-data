#!/usr/bin/env python3
"""Studie 2.0 / F1 — die mechanische Konzept-Auswahlregel und die Liste daraus.

WARUM REGEL *UND* LISTE
-----------------------
Das Urteil `_COURT-ZWEITQUELLE-2026-08-30.md` steht in K7 (a) bei **2:2**: zwei
Stimmen wollen eine mechanische AUSWAHLREGEL (P1/P2), zwei eine beschlossene
MINIMALLISTE (P3/P4). Das Gericht konstruiert keine Mehrheit — stellt aber fest,
dass **beide Lager dasselbe Ergebnis erzeugen**. Die Kanzlei-Empfehlung an den
Orchestrator (RR-1) lautet deshalb: Regel formulieren, Liste daraus erzeugen,
**beide** hashen, in dieser Reihenfolge. Genau das tut dieses Skript. Solange der
Council die Form nicht entschieden hat, tragen beide Lesarten dieselben Bytes.

DIE REGEL, WÖRTLICH AUS POSITION P2 (S3), MIT IHREN ZAHLEN
----------------------------------------------------------
Zugelassen wird **je Entity-Klasse die Kennung mit der hoechsten Rettungszahl in
dieser Klasse**, die alle Schranken erfuellt:

* **Z0  Rettungs-Untergrenze `ciksRettung >= 10`.** Aus Dissens D9 (S1): „die
  Auswahlregel muss eine Rettungs-Untergrenze tragen, die ueber 10 liegt — jede
  Regel mit einer Untergrenze <= 10 muss ausdruecklich als solche protokolliert
  und begruendet werden." Die Mehrheit laesst
  `RegulatedAndUnregulatedOperatingRevenue` bei **Rett = 10** zu; diese
  Unterschreitung ist damit ausdruecklich protokolliert (siehe
  `unterschreitungen` im Bericht). **Der Dissens bleibt bestehen.**
* **Z1  Quartalsfaehigkeit der Rettungen `RettQ/Rett >= 0,90`.** Torhoehe als
  Konstante, keine Studienzahl. `RettQ/Rett` ist eine OBERGRENZE fuer die
  Reifequote der eintretenden Kohorte — wer keinen Quartalsfakt traegt, erreicht
  nie vier Post-Signal-Stichtage.
* **Z2  Quartalsanteil `qtrs1AnteilFakten >= 0,50`.**
* **Z3a Rang-4-Sperre.** „Zins-TEILposten sind nie Umsatz." Eine Kennung, deren
  Name sie als Zins-, Investment- oder Dividendenertrag ausweist, ist Umsatz-
  Kopfzeile **nur** im Bank-/Zins-Stratum (K8) — anderswo ist sie Zins auf
  Kassen- oder Treuhandbestand NEBEN einer GuV ohne Umsatz. Beleg aus dem
  blinden Inventar selbst: `InterestAndDividendIncomeOperating` traegt 653 von
  734 Rettungen eine Bank; `InvestmentIncomeInterest` traegt 492 von 834 einen
  SPAC und 109 ein Biotech.
* **Z3b Bestandteil-Sperre.** Eine Kennung, die sich als KOMPLEMENT einer
  Ertragskomponente definiert (`Noninterest…`, `…ExcludingInterest…`,
  `…ExcludingDividend…`, `…OtherThanInterest…`), ist ein Bestandteil und nie die
  Gesamtgroesse. Quelle ist die Bestands-Doktrin, die K7 (b) woertlich zitiert
  (`merge-sec-xbrl.js:88-92`): „Eine fehlende Jahreszahl ist ehrlich, ein
  Bestandteil in der Rolle der Gesamtgroesse ist falsch."
  *Abgrenzung:* `…ExcludingAssessedTax` schliesst eine STEUER aus, keine
  Ertragskomponente — die Kennung der akzeptierten Liste bleibt unberuehrt.
* **Z4  Taxonomie-Schranke: nur `us-gaap`.** Alle `ifrs-full`-Kennungen sind in
  K7 mit **4:0** ausgeschlossen. Der Grund ist von Z1 unabhaengig und muss es
  bleiben: DERA traegt in `2015q3` und `2017q1` **null** `ifrs`-Zeilen, die
  Abdeckung beginnt zwischen 2017q2 und 2018q3 — eine IFRS-Firma koennte im
  Entdeckungsfenster 2009–2016 strukturell nie zur Signalfamilien-Ableitung
  beitragen, waere im Prueffenster aber Population: ein Klasse-C-Generator per
  Konstruktion. Beide Sperren werden getrennt gezaehlt, damit das Wegfallen
  einer von beiden auffliegt.
* **Z5 entfaellt.** Sie gilt nur im Eintritts-Modus „neuer Rang"; K7 (c) hat mit
  3:0 den **reinen Fallback** beschlossen.

WAS DIE REGEL NICHT TUT
-----------------------
Sie schliesst **keine Entity-Klasse vorab aus**. Klassen, die keine zulaessige
Kennung tragen (`versicherer`, `unbekannt`, `spac_blankcheck`, `biotech_pharma`,
`finanz_sonstige`), erscheinen als **ehrliche Ausschluesse mit Grund** — nie als
Datenluecke, nie imputiert (K10, 4:0). Der Bericht fuehrt sie namentlich.

Aufruf:
  python scripts/studie-f1-konzeptregel.py --inventar <konzept-inventar-blind.json> \\
      --bericht reports/studie/f1-konzeptregel-2026-08-30.json
  python scripts/studie-f1-konzeptregel.py --selbsttest
"""

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "studie-f1-konzeptregel/v1"
REGEL_ID = "F1-KONZEPTREGEL-Z0-Z4/2026-08-30"

# --- Die Zahlen der Regel. Alles, was hier steht, ist eine Entscheidung; alles
# --- andere ist Ableitung. Wenige Zahlen, sichtbare Willkuer (P1, S1).
Z0_RETTUNGS_UNTERGRENZE = 10
Z1_QUARTALSFAEHIGKEIT = 0.90
Z2_QUARTALSANTEIL = 0.50
Z4_TAXONOMIEN = ("us-gaap",)

# Z3a — Namensmuster fuer Zins-/Kapitalertrag. Nur im Bank-Stratum zulaessig.
Z3A_MUSTER = re.compile(
    r"InterestIncome|InvestmentIncome|InterestAndDividendIncome|InterestAndOtherIncome"
    r"|InterestAndFeeIncome|DividendIncome|InterestRevenue|InterestAndDiscount")
# Z3b — Namensmuster fuer Komplement-/Bestandteil-Kennungen.
Z3B_MUSTER = re.compile(r"Noninterest|Excluding(Interest|Dividend)|OtherThanInterest")
# Das Stratum, in dem Zinsertrag die Kopfzeile der GuV IST (K8).
ZINS_STRATUM = "bank"

# K8, die vier kumulativen Bedingungen des Bank-Stratums. Faellt auch nur eine,
# bleibt die Klasse mit einer SCOPE-AUSSAGE draussen — ausdruecklich nicht als
# Datenluecke. Sie sind hier nicht pruefbar (drei von vieren sind Auflagen an
# spaetere Stufen); sie stehen im Artefakt, damit F3 sie woertlich uebernimmt.
K8_BEDINGUNGEN = [
    "getrennt berichtet, getrennt gegen die Nullmodelle geprueft, getrennt in der FDR-Familie",
    "praeregistrierte Klumpungseinheit Entity-Klasse x Signalquartal; effektives N konservativ",
    "eigene Ereignis-/Label-Abdeckungszahl, vorab gemessen, nicht unter der des Gesamtpanels",
    "Bank-Zinsertrag wird weder still mit operativem Produktumsatz gepoolt noch zur "
    "Reparatur des primaeren Arms benutzt",
]

# Kennungen, die das Urteil ausdruecklich ausschliesst. Das ist KEIN Filter der
# Regel — es ist ein WAECHTER hinter ihr: erzeugte die Regel je eine davon, waere
# das ein Befund, kein stiller Ausschluss.
URTEIL_DRAUSSEN = {
    "us-gaap:RevenueFromRelatedParties": "K7, 4:0",
    "us-gaap:PremiumsEarnedNet": "K7, 4:0 (Inventar misst 0 Rettungen)",
    "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax": "K7, 3:0",
    "us-gaap:InvestmentIncomeInterest": "K7, 3:0 (Rang-4-Sperre)",
    "us-gaap:NoninterestIncome": "K7, 3:0",
    "us-gaap:InterestIncomeExpenseNet": "K7, 3:0",
    "us-gaap:InterestIncomeOther": "K7, 3:0",
    "us-gaap:InterestIncomeOperating": "K7, 3:0",
}


class RegelFehler(Exception):
    """Ein Befund, der den Lauf anhaelt — nie ein stiller Fallback."""


def datei_sha256(pfad):
    hasher = hashlib.sha256()
    with open(pfad, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            hasher.update(block)
    return hasher.hexdigest()


def kanonisch(objekt):
    """Bytes, die ein Dritter reproduzieren kann: sortiert, kompakt, UTF-8."""
    return json.dumps(objekt, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False).encode("utf-8")


def name(konzept):
    return str(konzept["taxonomy"]) + ":" + str(konzept["concept"])


def schranken(konzept, klasse):
    """Alle Schranken einer Kennung in einer Klasse. Liste der GERISSENEN."""
    gerissen = []
    rett = int(konzept.get("ciksRettung") or 0)
    rettq = int(konzept.get("ciksRettungMitQuartal") or 0)
    if str(konzept.get("taxonomy")) not in Z4_TAXONOMIEN:
        gerissen.append("Z4")
    if rett < Z0_RETTUNGS_UNTERGRENZE:
        gerissen.append("Z0")
    if not rett or (rettq / rett) < Z1_QUARTALSFAEHIGKEIT:
        gerissen.append("Z1")
    if float(konzept.get("qtrs1AnteilFakten") or 0.0) < Z2_QUARTALSANTEIL:
        gerissen.append("Z2")
    if Z3A_MUSTER.search(str(konzept["concept"])) and klasse != ZINS_STRATUM:
        gerissen.append("Z3a")
    if Z3B_MUSTER.search(str(konzept["concept"])):
        gerissen.append("Z3b")
    return gerissen


def wende_regel_an(inventar):
    """Regel -> Liste. Deterministisch, ohne Kenntnis irgendeiner Studien-Datei."""
    konzepte = inventar.get("konzepte")
    if not isinstance(konzepte, list) or not konzepte:
        raise RegelFehler("Inventar ohne Konzeptliste")
    klassen = sorted(inventar.get("universum", {}).get("jeKlasse", {}))
    if not klassen:
        raise RegelFehler("Inventar ohne Entity-Klassen (universum.jeKlasse)")

    je_klasse = []
    unterschreitungen = []
    for klasse in klassen:
        kandidaten = []
        for konzept in konzepte:
            if konzept.get("akzeptiert"):
                continue  # die akzeptierte Liste ist die Basis, nicht die Verbreiterung
            rettungen = int(konzept.get("rettungJeKlasse", {}).get(klasse, 0) or 0)
            if rettungen <= 0:
                continue
            if schranken(konzept, klasse):
                continue
            kandidaten.append((rettungen, name(konzept), konzept))
        # Gleichstand loest der Name auf — nicht die Reihenfolge im Inventar.
        kandidaten.sort(key=lambda t: (-t[0], t[1]))
        if not kandidaten:
            je_klasse.append({
                "klasse": klasse,
                "kennung": None,
                "grund": "keine Kennung dieser Klasse erfuellt Z0-Z4 — ehrlicher "
                         "Ausschluss mit Grund, nie Imputation, nie Miss (K10, 4:0)",
            })
            continue
        rettungen, kennung, konzept = kandidaten[0]
        rett = int(konzept["ciksRettung"])
        gleichstand = [k for r, k, _ in kandidaten if r == rettungen]
        if len(gleichstand) > 1:
            # Position P3 (R): „mehrdeutige Klasse oder Gleichstand = NICHT
            # BERECHENBAR." Das trifft die KLASSE, nicht den Lauf — genau wie die
            # Eventual-Regel aus K4 den einzelnen Wertkonflikt trifft. Wer hier
            # global abbricht, laesst eine Restklasse mit einer Rettung die ganze
            # Regel toeten; wer still die erste nimmt, trifft eine Auswahl.
            je_klasse.append({
                "klasse": klasse,
                "kennung": None,
                "grund": "NICHT BERECHENBAR: Gleichstand bei " + str(rettungen)
                         + " Rettungen zwischen " + ", ".join(gleichstand)
                         + " — nie eine Auswahl (Position P3, R)",
                "gleichstand": gleichstand,
            })
            continue
        if rett <= Z0_RETTUNGS_UNTERGRENZE:
            unterschreitungen.append({
                "klasse": klasse, "kennung": kennung, "ciksRettung": rett,
                "protokoll": "S1s Dissens D9 verlangt eine Untergrenze UEBER 10. Die "
                             "Mehrheit laesst diese Kennung bei Rett = " + str(rett)
                             + " zu; die Unterschreitung ist hiermit ausdruecklich "
                               "protokolliert. Der Dissens bleibt bestehen.",
            })
        je_klasse.append({
            "klasse": klasse,
            "kennung": kennung,
            "taxonomy": konzept["taxonomy"],
            "concept": konzept["concept"],
            "rettungenInKlasse": rettungen,
            "ciksRettung": rett,
            "ciksRettungMitQuartal": int(konzept["ciksRettungMitQuartal"]),
            "z1": round(int(konzept["ciksRettungMitQuartal"]) / rett, 4),
            "z2": float(konzept["qtrs1AnteilFakten"]),
            "naechsterVerfolger": (kandidaten[1][1] if len(kandidaten) > 1 else None),
        })

    liste = []
    gesehen = {}
    for eintrag in je_klasse:
        if not eintrag["kennung"]:
            continue
        gesehen.setdefault(eintrag["kennung"], []).append(eintrag["klasse"])
    for kennung in sorted(gesehen):
        treffer = next(e for e in je_klasse if e["kennung"] == kennung)
        liste.append({
            "taxonomy": treffer["taxonomy"],
            "concept": treffer["concept"],
            "entityKlassen": sorted(gesehen[kennung]),
            "eintrittsModus": "reiner_fallback",
            "brutto": True,
            "eigenesStratum": kennung.endswith(":InterestAndDividendIncomeOperating"),
        })

    # Der Waechter hinter der Regel: keine der vom Urteil ausgeschlossenen
    # Kennungen darf herausfallen. Tut sie es doch, ist das ein Befund.
    verstoss = [e["concept"] for e in liste
                if (e["taxonomy"] + ":" + e["concept"]) in URTEIL_DRAUSSEN]
    if verstoss:
        raise RegelFehler("Die Regel erzeugt vom Urteil ausgeschlossene Kennungen: "
                          + repr(verstoss))
    return je_klasse, liste, unterschreitungen


def bericht(inventar_pfad):
    inventar = json.loads(Path(inventar_pfad).read_text(encoding="utf-8-sig"))
    je_klasse, liste, unterschreitungen = wende_regel_an(inventar)
    regel = {
        "regelId": REGEL_ID,
        "auswahl": "je Entity-Klasse die Kennung mit der hoechsten Rettungszahl in "
                   "dieser Klasse, die alle Schranken erfuellt; Gleichstand = NICHT "
                   "BERECHENBAR",
        "schranken": {
            "Z0": {"groesse": "ciksRettung", "operator": ">=",
                   "wert": Z0_RETTUNGS_UNTERGRENZE, "herkunft": "Dissens D9 (S1)"},
            "Z1": {"groesse": "ciksRettungMitQuartal/ciksRettung", "operator": ">=",
                   "wert": Z1_QUARTALSFAEHIGKEIT, "herkunft": "Position P2 (S3)"},
            "Z2": {"groesse": "qtrs1AnteilFakten", "operator": ">=",
                   "wert": Z2_QUARTALSANTEIL, "herkunft": "Position P2 (S3)"},
            "Z3a": {"groesse": "Kennungsname", "operator": "kein Treffer ausserhalb "
                    + ZINS_STRATUM, "wert": Z3A_MUSTER.pattern,
                    "herkunft": "Rang-4-Sperre, K7/K8"},
            "Z3b": {"groesse": "Kennungsname", "operator": "kein Treffer",
                    "wert": Z3B_MUSTER.pattern,
                    "herkunft": "Bestands-Doktrin, K7 (b), merge-sec-xbrl.js:88-92"},
            "Z4": {"groesse": "taxonomy", "operator": "in", "wert": list(Z4_TAXONOMIEN),
                   "herkunft": "K7, 4:0 IFRS-Ausschluss"},
            "Z5": {"status": "entfaellt",
                   "herkunft": "K7 (c), 3:0 reiner Fallback statt neuer Rang"},
        },
        "eintrittsModus": "reiner_fallback",
        "eintrittsModusBegruendung":
            "K7 (c), 3:0. Ein gemischter oder je-Stichtag wirkender Fallback ist "
            "UNZULAESSIG (S1, unwidersprochen).",
        "bruttoNetto": "brutto",
        "bruttoNettoBegruendung":
            "K7 (b), 3:0. Eine Netto-Zinsertragsreihe ist eine Differenz zweier "
            "Stroeme, kann null durchqueren und das Vorzeichen wechseln.",
        "bankStratumBedingungenK8": K8_BEDINGUNGEN,
    }
    inhalt = {
        "schema": SCHEMA,
        "erzeugt": datetime.now(timezone.utc).isoformat(timespec="milliseconds")
                   .replace("+00:00", "Z"),
        "auftrag": "Studie 2.0 F1 — K7 (a) ist OFFEN (2:2). Regel UND Liste, in dieser "
                   "Reihenfolge gehasht (RR-1, Kanzlei-Empfehlung).",
        "inventar": {
            "pfad": str(inventar_pfad),
            "sha256": datei_sha256(inventar_pfad),
            "erzeugt": inventar.get("erzeugt"),
        },
        "regel": regel,
        "regelSha256": hashlib.sha256(kanonisch(regel)).hexdigest(),
        "jeKlasse": je_klasse,
        "unterschreitungen": unterschreitungen,
        "konzeptliste": liste,
        "konzeptlisteSha256": hashlib.sha256(kanonisch(liste)).hexdigest(),
        "waechterUrteilDraussen": sorted(URTEIL_DRAUSSEN),
        "ehrlicheAusschluesse": [e for e in je_klasse if not e["kennung"]],
    }
    return inhalt


# -- Selbsttest ---------------------------------------------------------------

def selbsttest():
    ergebnisse = []

    def pruefe(nm, bedingung):
        ergebnisse.append((nm, bool(bedingung)))

    def k(concept, taxonomy="us-gaap", rett=100, rettq=100, q=0.6, klassen=None,
          akzeptiert=False):
        return {"taxonomy": taxonomy, "concept": concept, "akzeptiert": akzeptiert,
                "ciksRettung": rett, "ciksRettungMitQuartal": rettq,
                "qtrs1AnteilFakten": q, "rettungJeKlasse": klassen or {}}

    def inv(konzepte, klassen=("bank", "operativ")):
        return {"universum": {"jeKlasse": {kl: 1 for kl in klassen}},
                "konzepte": konzepte}

    # Grundfall: die hoechste Rettungszahl je Klasse gewinnt.
    je, liste, _ = wende_regel_an(inv([
        k("OilAndGasRevenue", klassen={"operativ": 60}),
        k("OilAndGasSalesRevenue", rett=11, rettq=11, klassen={"operativ": 11}),
    ], klassen=("operativ",)))
    pruefe("hoechste Rettungszahl gewinnt", liste[0]["concept"] == "OilAndGasRevenue")
    pruefe("Verfolger wird ausgewiesen",
           je[0]["naechsterVerfolger"] == "us-gaap:OilAndGasSalesRevenue")

    # Z0/Z1/Z2/Z4 muessen einzeln reissen koennen.
    for konzept, schranke in (
        (k("Kleinkram", rett=9, rettq=9, klassen={"operativ": 9}), "Z0"),
        (k("Unreif", rett=100, rettq=80, klassen={"operativ": 80}), "Z1"),
        (k("Jahresding", q=0.49, klassen={"operativ": 100}), "Z2"),
        (k("Revenue", taxonomy="ifrs-full", klassen={"operativ": 100}), "Z4"),
    ):
        pruefe(schranke + " reisst", schranke in schranken(konzept, "operativ"))
        _, leer, _ = wende_regel_an(inv([konzept], klassen=("operativ",)))
        pruefe(schranke + " haelt die Kennung aus der Liste", leer == [])

    # Z3a: Zinsertrag ist NUR im Bank-Stratum Kopfzeile.
    zins = k("InvestmentIncomeInterest", klassen={"bank": 5, "operativ": 148})
    pruefe("Z3a reisst ausserhalb des Bank-Stratums", "Z3a" in schranken(zins, "operativ"))
    pruefe("Z3a reisst im Bank-Stratum nicht", "Z3a" not in schranken(zins, "bank"))

    # Z3b: das Komplement einer Ertragskomponente ist nie die Gesamtgroesse ...
    for nm in ("NoninterestIncome", "RevenuesExcludingInterestAndDividends"):
        pruefe("Z3b reisst bei " + nm,
               "Z3b" in schranken(k(nm, klassen={"bank": 5}), "bank"))
    # ... und die Abgrenzung haelt: eine ausgeschlossene STEUER ist kein Bestandteil.
    pruefe("Z3b laesst ExcludingAssessedTax durch",
           "Z3b" not in schranken(k("RevenueFromContractWithCustomerExcludingAssessedTax",
                                    klassen={"operativ": 5}), "operativ"))

    # Die akzeptierte Liste ist die Basis, nicht die Verbreiterung.
    _, leer, _ = wende_regel_an(inv([k("Revenues", akzeptiert=True,
                                       klassen={"operativ": 500})], klassen=("operativ",)))
    pruefe("akzeptierte Kennungen treten nicht als Verbreiterung an", leer == [])

    # Gleichstand ist NICHT BERECHENBAR — fuer die KLASSE, nie eine stille Auswahl,
    # und nie ein Abbruch des ganzen Laufs.
    je, liste, _ = wende_regel_an(inv([
        k("AlphaRevenue", klassen={"operativ": 7, "bank": 20}),
        k("BetaRevenue", klassen={"operativ": 7}),
    ], klassen=("bank", "operativ")))
    operativ = next(e for e in je if e["klasse"] == "operativ")
    pruefe("Gleichstand macht die Klasse NICHT BERECHENBAR",
           operativ["kennung"] is None and "NICHT BERECHENBAR" in operativ["grund"])
    pruefe("Gleichstand toetet die uebrigen Klassen nicht",
           [e["concept"] for e in liste] == ["AlphaRevenue"])

    # Der Waechter hinter der Regel muss rot werden koennen: eine vom Urteil
    # ausgeschlossene Kennung, die alle Schranken passiert, ist ein Befund.
    try:
        wende_regel_an(inv([k("RevenueFromRelatedParties", klassen={"operativ": 50})],
                           klassen=("operativ",)))
        pruefe("Urteils-Waechter reisst", False)
    except RegelFehler as exc:
        pruefe("Urteils-Waechter reisst", "ausgeschlossene Kennungen" in str(exc))

    # Eine Klasse ohne zulaessige Kennung ist ein ehrlicher Ausschluss, kein Miss.
    je, liste, _ = wende_regel_an(inv([k("Nix", rett=2, rettq=2, klassen={"bank": 2})],
                                      klassen=("bank",)))
    pruefe("leere Klasse wird als ehrlicher Ausschluss gefuehrt",
           liste == [] and je[0]["kennung"] is None and "K10" in je[0]["grund"])

    # Unterschreitung der Untergrenze wird protokolliert statt verschwiegen.
    _, _, unter = wende_regel_an(inv([k("Grenzfall", rett=10, rettq=10,
                                        klassen={"versorger": 9})],
                                     klassen=("versorger",)))
    pruefe("Unterschreitung wird protokolliert",
           len(unter) == 1 and unter[0]["ciksRettung"] == 10)

    # Determinismus: derselbe Eingang, dieselben Bytes.
    daten = inv([k("OilAndGasRevenue", klassen={"operativ": 60})], klassen=("operativ",))
    a = kanonisch(wende_regel_an(daten)[1])
    b = kanonisch(wende_regel_an(json.loads(json.dumps(daten)))[1])
    pruefe("Liste ist bit-identisch reproduzierbar", a == b)

    for nm, ok in ergebnisse:
        print(("PASS  " if ok else "FAIL  ") + nm)
    schlecht = [n for n, ok in ergebnisse if not ok]
    print("\n" + str(len(ergebnisse) - len(schlecht)) + "/" + str(len(ergebnisse))
          + " Pruefungen bestanden")
    return 0 if not schlecht else 1


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--inventar")
    p.add_argument("--bericht")
    p.add_argument("--selbsttest", action="store_true")
    args = p.parse_args()

    if args.selbsttest:
        return selbsttest()
    if not args.inventar:
        p.error("--inventar fehlt")

    try:
        inhalt = bericht(args.inventar)
    except RegelFehler as exc:
        print("ABBRUCH: " + str(exc), file=sys.stderr)
        return 2

    if args.bericht:
        ziel = Path(args.bericht)
        ziel.parent.mkdir(parents=True, exist_ok=True)
        ziel.write_text(json.dumps(inhalt, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
    print(json.dumps({k: v for k, v in inhalt.items() if k != "jeKlasse"},
                     indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
