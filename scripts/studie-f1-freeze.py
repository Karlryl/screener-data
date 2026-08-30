#!/usr/bin/env python3
"""Studie 2.0 / F1 — das Einfrieren des Datenfundaments VOR dem Blick von F2.

WAS BEI F1-ENDE GEHASHT WIRD — UND WARUM GENAU DAS
--------------------------------------------------
Der Bauplan (§6, Zeile F1) verlangt an dieser Stelle nur eins: „SHA ueber die
`.json` als Wahl-Grundlagen-Nachweis in den F3-Eintragstext." Der Auftrag dieser
Phase ist breiter — F1 umfasst zusaetzlich das **Datenfundament** (der
wiederhergestellte, pruefsummen-verifizierte Jahrgang), die **Extraktion** (der
Leser, der die drei gemessenen Fallen kennt) und die **Regel** samt der aus ihr
erzeugten **Liste**. Alles vier muss eingefroren sein, bevor F2 hinsieht, sonst
ist „freeze before look" ein Versprechen statt einer Eigenschaft der Bytes.

Eingefroren werden deshalb, in dieser Reihenfolge:

1. **Wahl-Grundlage** — `konzept-inventar-blind-2026-08-30.json` (+ `.md`), der
   einzige zulaessige Eingang der Konzeptwahl. Nicht kopiert, sondern gehasht:
   die Datei lebt im Vault, ihr SHA reist in den F3-Eintragstext.
2. **Regel** — die mechanische Auswahlregel Z0-Z4 mit ihren Zahlen.
3. **Liste** — die Kennungen, die aus der Regel folgen. Regel VOR Liste, weil
   die Liste eine Ableitung ist und keine Wahl (RR-1, Kanzlei-Empfehlung an den
   Orchestrator: beide hashen, in dieser Reihenfolge).
4. **Datenfundament** — je Payload Quartal, registrierter und gemessener
   sha256, Zustand; dazu ein Mengen-Hash ueber alle Payload-Hashes. Optional
   eine ZWEITLINIE: dieselbe Pruefung, unabhaengig gewonnen (Bytes auf der
   Platte gegen frischen Abruf der registrierten Quell-URL). Zwei Linien sind
   fuer A2 strikt besser als eine, und ihre Deckungsgleichheit ist selbst eine
   Aussage.
5. **Extraktions-Code** — sha256 der vier F1-Skripte. Eine Regel, deren
   Implementierung sich danach aendert, ist nicht eingefroren.
6. **Kontaminations-Vorgeschichte, woertlich** — Bedingung 5 des Urteils K3 und
   Auflage A16 verlangen sie im Eintragstext. Sie steht hier, damit F3 sie
   woertlich uebernehmen kann statt sie neu zu formulieren.

Der `f1FreezeSha256` am Ende ist der Wert, der dem Orchestrator VOR F2 gemeldet
wird. Er deckt alle sechs Bloecke; jede Byte-Aenderung an einem Eingang aendert
ihn.

WAS HIER NICHT PASSIERT
-----------------------
Kein Register-Eintrag (F1 braucht keinen — nur oeffentliche Daten, Bauplan §6).
Kein Siegel wird beruehrt. Keine Lueckenliste, kein Panel, kein Endtest. Die
Zaehlprobe K11 ist vor F2/F3 ausdruecklich ausgeschlossen (4:0).

Aufruf:
  python scripts/studie-f1-freeze.py --konzeptregel <regel.json> \\
      --vintage <vintage.json> [--zensus <zensus.json>] \\
      --bericht reports/studie/f1-datenfundament-freeze-2026-08-30.json
  python scripts/studie-f1-freeze.py --pruefen <freeze.json>
  python scripts/studie-f1-freeze.py --selbsttest
"""

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "studie-f1-datenfundament-freeze/v1"
CRLF = b"\r\n"
# Der Code, der die Regel ausfuehrt und die Daten liest. Aendert er sich, ist der
# Freeze nicht mehr derselbe — deshalb steht er mit im Hash.
F1_SKRIPTE = (
    "scripts/studie-f1-vintage-wiederherstellung.py",
    "scripts/studie-f1-dera-leser.py",
    "scripts/studie-f1-konzeptregel.py",
    "scripts/studie-f1-freeze.py",
)

# Woertlich, wie Urteil K3 Bedingung 5 und Auflage A16 es verlangen. Kein
# Folgedokument darf diesen Text glaetten oder kuerzen.
KONTAMINATIONS_VORGESCHICHTE = (
    "Diese Konzeptliste entsteht in Kenntnis eines gerissenen Tors bei 89,32 % "
    "(326/365). Der Deckel von Arm (a) auf der alten Population betraegt "
    "330/365 = 90,411 % und ist arithmetisch identisch mit der von ENTSCHIED 36 "
    "verworfenen Zahl. Dieser Deckel darf nicht mehr als Argument gefuehrt werden "
    "(A18) — weder fuer eine Beerdigung noch fuer eine Wiederbelebung von K1; "
    "beide Schluesse setzen m = 0 voraus, und m = 0 ist genau der Fall, den die "
    "Verbreiterung ausschliesst. Zulaessig bleibt allein: die Quote steigt genau "
    "dann, wenn die neu eintretende Kohorte selbst eine Reifequote ueber 89,32 % "
    "hat. Die Richtung kennt heute niemand."
)

# Die offenen Punkte, die F1 NICHT schliesst und die F3 mitnehmen muss.
OFFENE_PUNKTE = [
    {"id": "RR-1", "sache": "Form der Konzeptauswahl: mechanische Regel oder beschlossene "
                            "Minimalliste (K7 a, 2:2)",
     "standF1": "beide Lesarten tragen dieselben Bytes — Regel und Liste sind hier "
                "getrennt gehasht, in dieser Reihenfolge. Die Weiche bleibt offen."},
    {"id": "RR-2", "sache": "OilAndGasRevenue drin oder draussen (keine Mehrheit)",
     "standF1": "unter der Regel ist es DRIN (Z1 = 1,000, Z2 = 0,516, 60 Rettungen in "
                "der Klasse operativ). Faellt automatisch mit RR-1."},
    {"id": "RR-4", "sache": "PIT-feste Bestimmung der Entity-Klasse",
     "standF1": "UNGELOEST. Die Klassenspalte des blinden Inventars stammt aus dem "
                "heutigen SIC (submissions.zip) und ist zeitpunktlos; 211 Firmen "
                "tragen gar keinen. Die Regel benutzt sie, weil es keine andere gibt "
                "— das ist hiermit offen ausgewiesen, nicht geglaettet."},
    {"id": "RR-9", "sache": "A2/A12/B3 ruhen auf der widerlegten Praemisse, der Vintage "
                            "sei nicht wiederherstellbar",
     "standF1": "die Praemisse ist hier zum dritten Mal widerlegt: der registrierte "
                "Jahrgang ist aus Quell-URL und sha256 bit-gleich wiederherstellbar. "
                "Die Umschrift von A2/A12/B3 ist Sache der naechsten Ratssitzung."},
    {"id": "D9", "sache": "S1s Rettungs-Untergrenze muss UEBER 10 liegen",
     "standF1": "die Regel traegt >= 10; RegulatedAndUnregulatedOperatingRevenue steht "
                "bei genau 10. Die Unterschreitung ist protokolliert. Der Dissens "
                "bleibt bestehen und ist als solcher zu zitieren."},
    {"id": "A10", "sache": "Kontingent EINS auf das Prueffenster",
     "standF1": "gehoert in den F3-Register-Eintragstext, mit eigener Zeile, beim "
                "zweiten Antrag maschinell sichtbar. F1 schreibt keinen Eintrag."},
]

BLINDHEIT = {
    "gelesen": [
        "_COURT-ZWEITQUELLE-2026-08-30.md (vollstaendig, inkl. beider Orchestrator-Nachtraege)",
        "BAUPLAN-STUDIE-2.0-ENTWURF-2026-08-30.md (Entwurf, nicht bindend)",
        "k1-restkanaele-messung-2026-08-30.md",
        "k9-restschluss-2026-08-30.md",
        "konzept-inventar-blind-2026-08-30.json + .md",
        "protocol/early-detection/2.0.0/provenance-closure.json",
        "scripts/studie-panel-bau.py, scripts/studie-basisraten.py (Kopfbereiche), "
        "scripts/early-detection-sec-wayback.py, scripts/early-detection-foundation.py",
        "die DERA-Payload-Bytes selbst (oeffentliche SEC-Daten) — sowohl im "
        "versiegelten Sichtkasten early-detection-v4-sealed127 als auch in der "
        "eigenen Wiederherstellung; ausschliesslich Quartale bis 2020q4",
        "VIEW.json / STORE.json des Sichtkastens (Bestandsangaben, keine Studiendaten)",
    ],
    "nichtGeoeffnet": [
        "jede s0-*-Datei", "jede Luecken- oder Fehlfirmen-Liste",
        "E4g-/E4h-Berichtstexte ueber das hinaus, was das Urteil selbst zitiert",
        "outcome-access-ledger.json",
        "panel-entdeckung.sqlite und panel-validierung.sqlite — als Dateinamen im "
        "Traeger-Befund gezaehlt, NICHT geoeffnet",
        "das versiegelte Endtest-Fenster 2021q1-2024q4 in jeder Form",
        "Signalwerte, Outcomes, Allowlists", "data/lockbox in jeder Form",
    ],
    "netzabrufe": "ausschliesslich die in provenance-closure.json registrierten "
                  "SEC-/Wayback-Quell-URLs, gratis, mit hoeflichem User-Agent "
                  "'Karl Viehrig karl_viehrig@web.de research'",
}


class FreezeFehler(Exception):
    """Ein Befund, der den Lauf anhaelt — nie ein stiller Fallback."""


def kanonisch(objekt):
    return json.dumps(objekt, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False).encode("utf-8")


def hash_von(objekt):
    return hashlib.sha256(kanonisch(objekt)).hexdigest()


def datei_sha256(pfad):
    hasher = hashlib.sha256()
    with open(pfad, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            hasher.update(block)
    return hasher.hexdigest()


def lies(pfad):
    return json.loads(Path(pfad).read_text(encoding="utf-8-sig"))


def _fundament(vintage, quelle):
    gebrochen = [z for z in vintage["zeilen"]
                 if z["zustand"] not in ("WIEDERHERGESTELLT", "VORHANDEN")]
    payload_hashes = sorted(z["istSha256"] for z in vintage["zeilen"] if z.get("istSha256"))
    return {
        "quelle": quelle,
        "jahrgang": vintage["jahrgang"],
        "fenster": vintage["fenster"],
        "herkunftsSchliessung": vintage["herkunftsSchliessung"],
        "herkunftsSchliessungSha256": vintage["herkunftsSchliessungSha256"],
        "datenwurzelName": vintage.get("datenwurzelName"),
        "datenwurzelHerkunft": vintage.get("datenwurzelHerkunft"),
        "payloads": vintage["payloads"],
        "bitGleich": vintage["bitGleich"],
        "bitGleicheBytes": vintage["bitGleicheBytes"],
        "vintageIdentitaet": vintage["vintageIdentitaet"],
        "gebrocheneZeilen": [{"quartal": z["quartal"], "zustand": z["zustand"],
                              "grund": z.get("grund")} for z in gebrochen],
        "payloadMengeSha256": hashlib.sha256(
            "\n".join(payload_hashes).encode("utf-8")).hexdigest(),
        "jePayload": sorted(({"quartal": z["quartal"], "sollSha256": z["sollSha256"],
                              "istSha256": z.get("istSha256"), "zustand": z["zustand"]}
                             for z in vintage["zeilen"]), key=lambda z: z["quartal"]),
    }


def baue(regel_pfad, vintage_pfad, zensus_pfad, wurzel, zweitlinie_pfad=None,
         selbst_pfad=None):
    regel_bericht = lies(regel_pfad)
    vintage = lies(vintage_pfad)
    zweitlinie = lies(zweitlinie_pfad) if zweitlinie_pfad else None
    zensus = lies(zensus_pfad) if zensus_pfad else None
    wurzel = Path(wurzel)

    # Der Freeze uebernimmt die Hashes NICHT, er rechnet sie nach. Ein Freeze, der
    # seinen Eingaengen glaubt, friert eine Behauptung ein statt einer Tatsache.
    regel_sha = hash_von(regel_bericht["regel"])
    liste_sha = hash_von(regel_bericht["konzeptliste"])
    if regel_sha != regel_bericht["regelSha256"]:
        raise FreezeFehler("Regel-Hash im Bericht stimmt nicht mit dem Inhalt ueberein")
    if liste_sha != regel_bericht["konzeptlisteSha256"]:
        raise FreezeFehler("Listen-Hash im Bericht stimmt nicht mit dem Inhalt ueberein")

    datenfundament = _fundament(vintage, "primaer")
    if zweitlinie is not None:
        # A2 verlangt den Beweis der Vintage-Identitaet. Zwei unabhaengig gewonnene
        # Linien — die Bytes auf der Platte und ein frischer Abruf der registrierten
        # Quell-URL — sind strikt besser als eine, und die Deckungsgleichheit ihrer
        # Payload-Mengen ist selbst eine Aussage.
        zweit = _fundament(zweitlinie, "zweitlinie")
        datenfundament["zweitlinie"] = zweit
        datenfundament["zweitlinieDeckungsgleich"] = (
            zweit["payloadMengeSha256"] == datenfundament["payloadMengeSha256"])

    code = []
    for rel in F1_SKRIPTE:
        pfad = wurzel / rel
        if not pfad.exists():
            raise FreezeFehler("F1-Skript fehlt: " + rel)
        # .gitattributes pinnt scripts/studie-*.py auf eol=lf. Laege hier CRLF,
        # wuerde der Freeze Bytes hashen, die Git so nie speichert — der Hash
        # waere nach dem naechsten Checkout falsch, ohne dass es jemand sieht.
        # Live einmal passiert; deshalb steht die Pruefung hier und nicht im Kopf.
        if CRLF in pfad.read_bytes():
            raise FreezeFehler(
                "F1-Skript traegt CRLF, .gitattributes pinnt aber eol=lf: " + rel
                + " — der gehashte Stand waere nicht der committete")
        code.append({"pfad": rel, "sha256": datei_sha256(pfad),
                     "bytes": pfad.stat().st_size})
    # `--wurzel` steht per Voreinstellung auf "." — hier liegen mehrere Worktrees
    # nebeneinander. Zeigte die Wurzel auf ein anderes Checkout, hashte der Freeze
    # klaglos FREMDE Skript-Bytes neben Zahlen, die dieses Checkout erzeugt hat,
    # und verifizierte sich danach sauber gegen seinen eigenen Irrtum. Mindest-
    # Bodensatz: die Datei, die gerade laeuft, muss die sein, die gehasht wurde.
    selbst = datei_sha256(Path(selbst_pfad or __file__).resolve())
    gehasht = next(c["sha256"] for c in code
                   if c["pfad"].endswith("studie-f1-freeze.py"))
    if selbst != gehasht:
        raise FreezeFehler(
            "Die gehashte Fassung von studie-f1-freeze.py ist nicht die laufende "
            "(--wurzel zeigt auf ein anderes Checkout): gehasht " + gehasht[:16]
            + ", laufend " + selbst[:16])

    inhalt = {
        "schema": SCHEMA,
        "stufe": "F1",
        "erzeugt": datetime.now(timezone.utc).isoformat(timespec="milliseconds")
                   .replace("+00:00", "Z"),
        "auftrag": "Studie 2.0, Phase F1 — Datenfundament des verbreiterten "
                   "Konzept-Panels. Autorisierung: ratifiziertes Rats-Verdikt "
                   "_COURT-ZWEITQUELLE-2026-08-30.md (ENTSCHIED 78, F1-F3 frei) + "
                   "Orchestrator ENTSCHIED 120.",
        "registerEintrag": "keiner — F1 arbeitet ausschliesslich auf oeffentlichen "
                           "Daten (Bauplan §6, Zeile F1). Der Eintrag faellt bei F3.",
        "block1_wahlGrundlage": {
            "datei": regel_bericht["inventar"]["datei"],
            "ablage": regel_bericht["inventar"]["ablage"],
            "sha256": regel_bericht["inventar"]["sha256"],
            "erzeugt": regel_bericht["inventar"].get("erzeugt"),
            "vermerk": "einziger zulaessiger Eingang der Konzeptwahl. Unzulaessig als "
                       "Grundlage: die S0-Firmennamen und ihre Konzepte, jede "
                       "E4g/E4h-Zahl, jede Klassen-Verteilung der 25/21 (N4.2).",
        },
        "block2_regel": regel_bericht["regel"],
        "block2_regelSha256": regel_sha,
        "block3_konzeptliste": regel_bericht["konzeptliste"],
        "block3_konzeptlisteSha256": liste_sha,
        "block3_ehrlicheAusschluesse": regel_bericht["ehrlicheAusschluesse"],
        "block3_unterschreitungen": regel_bericht["unterschreitungen"],
        "block4_datenfundament": datenfundament,
        "block5_extraktionsCode": code,
        "block6_kontaminationsVorgeschichte": KONTAMINATIONS_VORGESCHICHTE,
        "k7aKoinzidenz": {
            "sache": "K7 (a) ist mit 2:2 OFFEN — mechanische Regel gegen beschlossene "
                     "Minimalliste. Das Gericht stellt fest, dass beide Lager dasselbe "
                     "Ergebnis erzeugen.",
            "regelErzeugt": sorted(e["taxonomy"] + ":" + e["concept"]
                                   for e in regel_bericht["konzeptliste"]),
            "urteilsListe": sorted([
                "us-gaap:InterestAndDividendIncomeOperating",
                "us-gaap:RealEstateRevenueNet",
                "us-gaap:RegulatedAndUnregulatedOperatingRevenue",
                "us-gaap:OilAndGasRevenue",
            ]),
            "deckungsgleich": sorted(e["taxonomy"] + ":" + e["concept"]
                                     for e in regel_bericht["konzeptliste"]) == sorted([
                "us-gaap:InterestAndDividendIncomeOperating",
                "us-gaap:RealEstateRevenueNet",
                "us-gaap:RegulatedAndUnregulatedOperatingRevenue",
                "us-gaap:OilAndGasRevenue",
            ]),
        },
        "block7_deraNachweis": ({
            "sache": "Zensus ueber die eingefrorene Liste auf dem wiederhergestellten "
                     "Jahrgang: traegt die Quelle die gewaehlten Kennungen? Gelaufen "
                     "NACH dem Einfrieren von Regel und Liste — seine Zahlen koennen "
                     "die Wahl nicht mehr gesteuert haben.",
            "payloads": zensus["payloads"],
            "fenster": zensus["fenster"],
            "summeJeKennung": zensus["summeJeKennung"],
            "ohneZeilen": zensus["ohneZeilen"],
            "naturschluessel": zensus["naturschluessel"],
            "namensraumAbbildung": zensus["namensraumAbbildung"],
        } if zensus else None),
        "offenePunkte": OFFENE_PUNKTE,
        "blindheitserklaerung": BLINDHEIT,
    }
    inhalt["f1FreezeSha256"] = hash_von(inhalt)
    return inhalt


def pruefe_freeze(pfad):
    inhalt = lies(pfad)
    gemeldet = inhalt.get("f1FreezeSha256")
    if not gemeldet:
        raise FreezeFehler("Freeze-Datei ohne f1FreezeSha256")
    ohne = {k: v for k, v in inhalt.items() if k != "f1FreezeSha256"}
    gerechnet = hash_von(ohne)
    return gemeldet, gerechnet, gemeldet == gerechnet


# -- Selbsttest ---------------------------------------------------------------

def selbsttest():
    import tempfile

    ergebnisse = []

    def pruefe(nm, bedingung):
        ergebnisse.append((nm, bool(bedingung)))

    liste = [{"taxonomy": "us-gaap", "concept": c, "entityKlassen": ["x"],
              "eintrittsModus": "reiner_fallback", "brutto": True, "eigenesStratum": False}
             for c in ("InterestAndDividendIncomeOperating", "OilAndGasRevenue",
                       "RealEstateRevenueNet", "RegulatedAndUnregulatedOperatingRevenue")]
    regel = {"regelId": "test", "schranken": {}}
    regel_bericht = {
        "inventar": {"datei": "inv.json", "ablage": "Vault", "sha256": "0" * 64,
                     "erzeugt": "x"},
        "regel": regel, "regelSha256": hash_von(regel),
        "konzeptliste": liste, "konzeptlisteSha256": hash_von(liste),
        "ehrlicheAusschluesse": [], "unterschreitungen": [],
    }
    vintage = {
        "jahrgang": "legacy_earliest_archived",
        "fenster": {"von": "2009q1", "bis": "2020q4"},
        "herkunftsSchliessung": "closure.json", "herkunftsSchliessungSha256": "1" * 64,
        "payloads": 2, "bitGleich": 2, "bitGleicheBytes": 20,
        "vintageIdentitaet": "BEWIESEN",
        "zeilen": [
            {"quartal": "2009q1", "sollSha256": "a" * 64, "istSha256": "a" * 64,
             "zustand": "WIEDERHERGESTELLT"},
            {"quartal": "2009q2", "sollSha256": "b" * 64, "istSha256": "b" * 64,
             "zustand": "VORHANDEN"},
        ],
    }

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "scripts").mkdir()
        for rel in F1_SKRIPTE:
            # write_bytes, nicht write_text: Letzteres macht auf Windows CRLF
            # daraus — und genau das lehnt der Freeze jetzt ab.
            (tmp / rel).write_bytes(b"# platzhalter\n")
        rp, vp = tmp / "regel.json", tmp / "vintage.json"
        rp.write_text(json.dumps(regel_bericht), encoding="utf-8")
        vp.write_text(json.dumps(vintage), encoding="utf-8")

        zp = tmp / "zweitlinie.json"
        zp.write_text(json.dumps(dict(vintage, datenwurzelName="anderswo")),
                      encoding="utf-8")
        mit_zweit = baue(rp, vp, None, tmp, zp, selbst_pfad=tmp / F1_SKRIPTE[3])
        pruefe("Zweitlinie wird als deckungsgleich erkannt",
               mit_zweit["block4_datenfundament"]["zweitlinieDeckungsgleich"] is True)
        abweichend = json.loads(json.dumps(vintage))
        abweichend["zeilen"][0]["istSha256"] = "c" * 64
        zp.write_text(json.dumps(abweichend), encoding="utf-8")
        pruefe("abweichende Zweitlinie faellt auf",
               baue(rp, vp, None, tmp, zp, selbst_pfad=tmp / F1_SKRIPTE[3])["block4_datenfundament"]
               ["zweitlinieDeckungsgleich"] is False)

        # Die CRLF-Sperre muss reissen koennen.
        echt_bytes = (tmp / F1_SKRIPTE[0]).read_bytes()
        (tmp / F1_SKRIPTE[0]).write_bytes(b"# platzhalter" + CRLF)
        try:
            baue(rp, vp, None, tmp, selbst_pfad=tmp / F1_SKRIPTE[3])
            pruefe("CRLF im Extraktions-Code fliegt auf", False)
        except FreezeFehler as exc:
            pruefe("CRLF im Extraktions-Code fliegt auf", "CRLF" in str(exc))
        (tmp / F1_SKRIPTE[0]).write_bytes(echt_bytes)

        # Zeigt die Wurzel auf ein FREMDES Checkout, hasht der Freeze fremde
        # Skript-Bytes neben eigenen Zahlen und verifiziert sich danach sauber
        # gegen seinen eigenen Irrtum. Der Bodensatz muss das sehen.
        try:
            baue(rp, vp, None, tmp)  # laufende Datei != Platzhalter in tmp
            pruefe("fremdes Checkout fliegt auf", False)
        except FreezeFehler as exc:
            pruefe("fremdes Checkout fliegt auf", "anderes Checkout" in str(exc))

        eins = baue(rp, vp, None, tmp, selbst_pfad=tmp / F1_SKRIPTE[3])
        pruefe("K7a-Koinzidenz wird festgestellt", eins["k7aKoinzidenz"]["deckungsgleich"])
        pruefe("Kontaminations-Vorgeschichte steht woertlich drin",
               "89,32 %" in eins["block6_kontaminationsVorgeschichte"]
               and "90,411 %" in eins["block6_kontaminationsVorgeschichte"])
        pruefe("Reihenfolge Regel vor Liste",
               list(eins).index("block2_regel") < list(eins).index("block3_konzeptliste"))

        ziel = tmp / "freeze.json"
        ziel.write_text(json.dumps(eins, ensure_ascii=False), encoding="utf-8")
        gemeldet, gerechnet, ok = pruefe_freeze(ziel)
        pruefe("Freeze-Hash verifiziert sich selbst", ok)

        # Der Waechter muss rot werden koennen: ein Byte an der Liste aendern.
        manipuliert = json.loads(ziel.read_text(encoding="utf-8"))
        manipuliert["block3_konzeptliste"][0]["concept"] = "Revenues"
        (tmp / "kaputt.json").write_text(json.dumps(manipuliert, ensure_ascii=False),
                                         encoding="utf-8")
        _, _, ok2 = pruefe_freeze(tmp / "kaputt.json")
        pruefe("manipulierte Liste fliegt auf", ok2 is False)

        # Und der Code gehoert mit in den Hash — sonst friert man eine Regel ein,
        # deren Ausfuehrung sich danach still aendern kann.
        (tmp / F1_SKRIPTE[2]).write_bytes(b"# andere Regel\n")
        zwei = baue(rp, vp, None, tmp, selbst_pfad=tmp / F1_SKRIPTE[3])
        pruefe("geaenderter Code aendert den Freeze-Hash",
               zwei["f1FreezeSha256"] != eins["f1FreezeSha256"])

        # Ein Bericht, dessen gemeldeter Hash nicht zu seinem Inhalt passt, wird
        # nicht uebernommen, sondern abgelehnt.
        falsch = dict(regel_bericht, konzeptlisteSha256="f" * 64)
        (tmp / "falsch.json").write_text(json.dumps(falsch), encoding="utf-8")
        try:
            baue(tmp / "falsch.json", vp, None, tmp, selbst_pfad=tmp / F1_SKRIPTE[3])
            pruefe("falsch gemeldeter Listen-Hash wird abgelehnt", False)
        except FreezeFehler as exc:
            pruefe("falsch gemeldeter Listen-Hash wird abgelehnt",
                   "Listen-Hash" in str(exc))

        # Ein gebrochener Vintage darf nicht stillschweigend als bewiesen gelten.
        kaputt_vintage = json.loads(json.dumps(vintage))
        kaputt_vintage["zeilen"][0]["zustand"] = "VINTAGE_GEBROCHEN"
        kaputt_vintage["zeilen"][0]["grund"] = "Testbruch"
        kaputt_vintage["vintageIdentitaet"] = "GEBROCHEN"
        (tmp / "vkaputt.json").write_text(json.dumps(kaputt_vintage), encoding="utf-8")
        drei = baue(rp, tmp / "vkaputt.json", None, tmp, selbst_pfad=tmp / F1_SKRIPTE[3])
        pruefe("gebrochener Vintage steht namentlich im Freeze",
               drei["block4_datenfundament"]["gebrocheneZeilen"][0]["quartal"] == "2009q1"
               and drei["block4_datenfundament"]["vintageIdentitaet"] == "GEBROCHEN")

    for nm, ok in ergebnisse:
        print(("PASS  " if ok else "FAIL  ") + nm)
    schlecht = [n for n, ok in ergebnisse if not ok]
    print("\n" + str(len(ergebnisse) - len(schlecht)) + "/" + str(len(ergebnisse))
          + " Pruefungen bestanden")
    return 0 if not schlecht else 1


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--konzeptregel")
    p.add_argument("--vintage")
    p.add_argument("--zensus")
    p.add_argument("--vintage-zweitlinie",
                   help="zweite, unabhaengig gewonnene Vintage-Pruefung (A2)")
    p.add_argument("--wurzel", default=".")
    p.add_argument("--bericht")
    p.add_argument("--pruefen")
    p.add_argument("--selbsttest", action="store_true")
    args = p.parse_args()

    if args.selbsttest:
        return selbsttest()
    if args.pruefen:
        try:
            gemeldet, gerechnet, ok = pruefe_freeze(args.pruefen)
        except FreezeFehler as exc:
            print("ABBRUCH: " + str(exc), file=sys.stderr)
            return 2
        print(json.dumps({"datei": args.pruefen, "gemeldet": gemeldet,
                          "gerechnet": gerechnet, "gueltig": ok}, indent=2))
        return 0 if ok else 1
    if not (args.konzeptregel and args.vintage):
        p.error("--konzeptregel und --vintage werden gebraucht")

    try:
        inhalt = baue(args.konzeptregel, args.vintage, args.zensus, args.wurzel,
                      args.vintage_zweitlinie)
    except FreezeFehler as exc:
        print("ABBRUCH: " + str(exc), file=sys.stderr)
        return 2

    if args.bericht:
        ziel = Path(args.bericht)
        ziel.parent.mkdir(parents=True, exist_ok=True)
        ziel.write_text(json.dumps(inhalt, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
    print(json.dumps({
        "f1FreezeSha256": inhalt["f1FreezeSha256"],
        "regelSha256": inhalt["block2_regelSha256"],
        "konzeptlisteSha256": inhalt["block3_konzeptlisteSha256"],
        "inventarSha256": inhalt["block1_wahlGrundlage"]["sha256"],
        "payloadMengeSha256": inhalt["block4_datenfundament"]["payloadMengeSha256"],
        "vintageIdentitaet": inhalt["block4_datenfundament"]["vintageIdentitaet"],
        "zweitlinieDeckungsgleich":
            inhalt["block4_datenfundament"].get("zweitlinieDeckungsgleich"),
        "k7aDeckungsgleich": inhalt["k7aKoinzidenz"]["deckungsgleich"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
