# -*- coding: utf-8 -*-
"""Etappe E1, Vorstufe: Was liegt im Speicher, und was davon ist versiegelt?

Der Daten-Vertrag der Studie (protocol/early-detection/2.0.0/data-contract.json)
benennt eine Luecke ausdruecklich:

    „Ohne Payload-Filter erzeugt Schritt 2 eine Obermenge (der Speicher enthaelt
     inzwischen mehr akzeptierte Beobachtungen als die versiegelte Datenbank).
     […] der Filter selbst ist eine benannte E1-Aufgabe."

Dieses Werkzeug ist die Vorstufe dazu und beantwortet drei Fragen, die JEDE
Bauvariante des Filters braucht:

  1. Lese ich ueberhaupt dieselbe Menge, die E0 versiegelt hat?
     Geprueft wird durch Nachrechnen: canonical_sha256(payloads) muss die im
     Vertrag UND in der Herkunfts-Schliessung stehende `payloadSetSha256`
     treffen. Trifft sie nicht, wird abgebrochen — dann ist entweder die Datei
     veraendert worden oder meine Lesart falsch, und beides verbietet
     weiterzurechnen.
  2. Was liegt heute in observations/sec-fsd, und wie verteilt es sich auf
     versiegelt / Obermenge / unbekannt?
  3. Die Erlaubnisliste selbst: die 127 versiegelten payloadSha256 als eigene,
     kleine Datei — das ist das Stueck, das der spaetere Filter konsumiert,
     unabhaengig davon, wie er gebaut wird.

Bewusst NICHT enthalten: der Filter-Vollzug. Wie er die gepinnten Bau-Skripte
unberuehrt laesst, ist eine eigene Entscheidung.

Regeln, an die sich das Werkzeug haelt:
  R12a  Speicherort NUR aus der Umgebungsvariablen EARLY_DETECTION_DATA_ROOT
        (oder --data-root); kein absoluter Pfad im Code. Die Laufumgebung wird
        als Beobachtung mitgeschrieben.
  R14a  unter 200 KB.  R14c  nur Standardbibliothek.  R14d  grosse Artefakte
        werden gezielt abgefragt, nie am Stueck in den Bericht kopiert.

Aufruf:
  python scripts/studie-payload-inventar.py --bericht <datei.json>
  python scripts/studie-payload-inventar.py --erlaubnisliste <datei.json>
  python scripts/studie-payload-inventar.py --selbsttest
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
REPO = HIER.parent
PROTOKOLL = REPO / "protocol" / "early-detection" / "2.0.0"
DATENWURZEL_ENV = "EARLY_DETECTION_DATA_ROOT"


class VerfassungsBruch(RuntimeError):
    """Ein Regelbruch ist kein Warnfall, sondern ein Abbruch."""


def kanonisch_sha256(wert) -> str:
    """Dieselbe Kanonisierung wie scripts/studie-herkunft.py:69 — sonst
    vergleicht man zwei verschiedene Rechnungen und nennt es Abweichung."""
    roh = json.dumps(wert, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(roh.encode("utf-8")).hexdigest()


def datenwurzel(vorgabe: str | None) -> Path:
    wert = vorgabe or os.environ.get(DATENWURZEL_ENV)
    if not wert:
        raise VerfassungsBruch(
            "Speicherort unbekannt: %s ist nicht gesetzt und --data-root fehlt "
            "(R12a verbietet einen fest verdrahteten Pfad)." % DATENWURZEL_ENV
        )
    pfad = Path(wert)
    if not (pfad / "observations").is_dir():
        raise VerfassungsBruch("Kein Beobachtungs-Speicher unter %s" % pfad)
    return pfad


def lies_json(pfad: Path):
    with pfad.open(encoding="utf-8") as f:
        return json.load(f)


def pruefe_siegel(closure: dict, contract: dict) -> None:
    """Zuerst die eigene Lesart pruefen, dann erst rechnen.

    Ohne diesen Schritt koennte ein veraenderter oder nur anders gelesener
    Herkunfts-Record eine Erlaubnisliste erzeugen, die plausibel aussieht und
    eine andere Menge beschreibt als die versiegelte."""
    payloads = closure.get("payloads")
    if not isinstance(payloads, list):
        raise VerfassungsBruch("Herkunfts-Schliessung ohne Payload-Liste.")
    nachgerechnet = kanonisch_sha256(payloads)
    if nachgerechnet != closure.get("payloadSetSha256"):
        raise VerfassungsBruch(
            "ABBRUCH: die nachgerechnete Mengen-Pruefsumme %s trifft die in der "
            "Herkunfts-Schliessung stehende %s nicht. Entweder ist die Datei "
            "veraendert worden oder meine Lesart ist falsch — beides verbietet "
            "weiterzurechnen." % (nachgerechnet[:16], str(closure.get("payloadSetSha256"))[:16])
        )
    if contract.get("payloadSetSha256") != closure.get("payloadSetSha256"):
        raise VerfassungsBruch(
            "ABBRUCH: Daten-Vertrag und Herkunfts-Schliessung nennen verschiedene "
            "Mengen-Pruefsummen — sie beschreiben nicht dieselbe Datenbasis."
        )
    if contract.get("payloadCount") != len(payloads):
        raise VerfassungsBruch(
            "ABBRUCH: Vertrag nennt %s Payloads, die Schliessung fuehrt %d."
            % (contract.get("payloadCount"), len(payloads))
        )


def beobachtungen(wurzel: Path) -> list[dict]:
    """Alle SEC-Quartalsbeobachtungen, flach gelesen. Jede Datei ist klein
    (wenige KB); die grossen Rohdaten liegen als Blob daneben und werden hier
    bewusst nicht angefasst (R14d)."""
    ordner = wurzel / "observations" / "sec-fsd"
    if not ordner.is_dir():
        raise VerfassungsBruch("Kein sec-fsd-Beobachtungsordner unter %s" % ordner)
    raus = []
    for pfad in sorted(ordner.rglob("*.json")):
        o = lies_json(pfad)
        raus.append({
            "datei": pfad.relative_to(wurzel).as_posix(),
            "quartal": o.get("quarter"),
            "payloadSha256": o.get("payloadSha256"),
            "beobachtetAm": o.get("observedAt"),
            "guete": o.get("qualityState"),
            "quarantaene": o.get("quarantineReasons") or [],
            "variante": o.get("datasetVariant"),
        })
    return raus


def inventur(closure: dict, beob: list[dict]) -> dict:
    versiegelt = {p["payloadSha256"]: p for p in closure["payloads"]}
    obermenge = {p["payloadSha256"]: p for p in closure.get("supersetObservations", [])}

    klassen: dict[str, list[dict]] = {"versiegelt": [], "obermenge": [], "unbekannt": []}
    for b in beob:
        h = b.get("payloadSha256")
        if h in versiegelt:
            b = dict(b, vintage=versiegelt[h].get("vintage"))
            klassen["versiegelt"].append(b)
        elif h in obermenge:
            b = dict(b, vintage=obermenge[h].get("vintage"))
            klassen["obermenge"].append(b)
        else:
            klassen["unbekannt"].append(b)

    # Die Gegenrichtung ist genauso wichtig: ein versiegelter Payload, der im
    # Speicher FEHLT, macht den Neubau unmoeglich — und faellt bei einer reinen
    # Vorwaertszaehlung nicht auf.
    vorhanden = {b.get("payloadSha256") for b in beob}
    fehlend = [p for h, p in versiegelt.items() if h not in vorhanden]

    def je(schluessel, eintraege):
        zaehler: dict[str, int] = {}
        for e in eintraege:
            zaehler[str(e.get(schluessel))] = zaehler.get(str(e.get(schluessel)), 0) + 1
        return dict(sorted(zaehler.items()))

    return {
        "beobachtungenGesamt": len(beob),
        "versiegelt": len(klassen["versiegelt"]),
        "obermenge": len(klassen["obermenge"]),
        "unbekannt": len(klassen["unbekannt"]),
        "versiegeltFehltImSpeicher": [
            {"quartal": p["quarter"], "payloadSha256": p["payloadSha256"]} for p in fehlend
        ],
        "guetenVerteilung": {k: je("guete", v) for k, v in klassen.items() if v},
        "vintageVerteilung": {
            k: je("vintage", v) for k, v in klassen.items() if v and k != "unbekannt"
        },
        "unbekannteDateien": [
            {"datei": b["datei"], "quartal": b["quartal"], "guete": b["guete"],
             "quarantaene": b["quarantaene"]}
            for b in klassen["unbekannt"]
        ],
        "versiegeltJeQuartal": je("quartal", klassen["versiegelt"]),
    }


def umgebung() -> dict:
    """R12a: jeder Lauf schreibt seine Umgebung mit — sonst laesst sich ein
    abweichendes Ergebnis spaeter nicht zuordnen."""
    return {
        "python": sys.version.split()[0],
        "plattform": platform.system(),
        "maschinenunabhaengig": "Speicherort aus %s, keine absoluten Pfade im Code"
                                % DATENWURZEL_ENV,
    }


def erlaubnisliste(closure: dict) -> dict:
    """Die 127 versiegelten Pruefsummen als eigene kleine Datei. Sie traegt die
    Mengen-Pruefsumme mit, damit ein spaeterer Filter beweisen kann, dass er
    GENAU diese Menge benutzt hat und keine nachtraeglich ergaenzte."""
    return {
        "schema": "early-detection-payload-allowlist/v1",
        "protokoll": closure.get("protocol"),
        "zweck": "R12b/E1: erlaubte Roh-Payloads fuer den Neubau der versiegelten Datenbank.",
        "payloadCount": len(closure["payloads"]),
        "payloadSetSha256": closure["payloadSetSha256"],
        "quelle": "protocol/early-detection/2.0.0/provenance-closure.json",
        "erlaubt": [
            {"quartal": p["quarter"], "vintage": p["vintage"], "payloadSha256": p["payloadSha256"]}
            for p in closure["payloads"]
        ],
    }


# ------------------------------------------------------------------ Selbsttest
def selbsttest() -> None:
    """Ein Pruefer, der nie rot war, ist eine Behauptung. Braucht keinen Speicher."""
    payloads = [
        {"quarter": "2009q1", "vintage": "legacy_earliest_archived", "payloadSha256": "aa"},
        {"quarter": "2009q2", "vintage": "legacy_earliest_archived", "payloadSha256": "bb"},
    ]
    closure = {
        "protocol": "TEST@1", "payloads": payloads,
        "payloadSetSha256": kanonisch_sha256(payloads),
        "supersetObservations": [
            {"quarter": "2009q1", "vintage": "archived_digest_revision", "payloadSha256": "cc"}
        ],
    }
    contract = {"payloadSetSha256": closure["payloadSetSha256"], "payloadCount": 2}
    pruefe_siegel(closure, contract)

    beob = [
        {"datei": "a.json", "quartal": "2009q1", "payloadSha256": "aa", "guete": "accepted",
         "quarantaene": [], "variante": None, "beobachtetAm": "2018-03-28T00:00:00Z"},
        {"datei": "b.json", "quartal": "2009q1", "payloadSha256": "cc", "guete": "accepted",
         "quarantaene": [], "variante": None, "beobachtetAm": "2021-03-20T00:00:00Z"},
        {"datei": "c.json", "quartal": "2009q1", "payloadSha256": "zz", "guete": "quarantined",
         "quarantaene": ["truncated"], "variante": None, "beobachtetAm": "2022-01-01T00:00:00Z"},
    ]
    inv = inventur(closure, beob)
    erwartet = {"beobachtungenGesamt": 3, "versiegelt": 1, "obermenge": 1, "unbekannt": 1}
    for k, v in erwartet.items():
        if inv[k] != v:
            raise SystemExit("SELBSTTEST ROT: %s ist %s, erwartet %s" % (k, inv[k], v))
    # Der versiegelte Payload "bb" liegt NICHT im Speicher — das muss auffallen,
    # sonst meldet die Inventur einen unmoeglichen Neubau als in Ordnung.
    if [f["payloadSha256"] for f in inv["versiegeltFehltImSpeicher"]] != ["bb"]:
        raise SystemExit("SELBSTTEST ROT: ein fehlender versiegelter Payload faellt nicht auf.")
    print("  Klassifikation: versiegelt/Obermenge/unbekannt getrennt, fehlender Payload erkannt.")

    # Siegel-Bruch muss abbrechen, nicht durchrutschen.
    for was, kaputt in (
        ("veraenderte Payload-Liste",
         dict(closure, payloads=payloads + [{"quarter": "x", "vintage": "y", "payloadSha256": "dd"}])),
        ("abweichende Mengen-Pruefsumme", dict(closure, payloadSetSha256="0" * 64)),
    ):
        try:
            pruefe_siegel(kaputt, contract)
        except VerfassungsBruch:
            continue
        raise SystemExit("SELBSTTEST ROT: %s geht still durch." % was)
    try:
        pruefe_siegel(closure, dict(contract, payloadSetSha256="0" * 64))
    except VerfassungsBruch:
        pass
    else:
        raise SystemExit("SELBSTTEST ROT: Vertrag und Schliessung duerfen nicht auseinanderlaufen.")
    print("  Siegel-Pruefung: drei Verfaelschungen brechen ab.")
    print("Selbsttest gruen.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-root")
    ap.add_argument("--bericht")
    ap.add_argument("--erlaubnisliste")
    ap.add_argument("--selbsttest", action="store_true")
    args = ap.parse_args()

    if args.selbsttest:
        print("Selbsttest (ohne Speicher):")
        selbsttest()
        if not (args.bericht or args.erlaubnisliste):
            return

    closure = lies_json(PROTOKOLL / "provenance-closure.json")
    contract = lies_json(PROTOKOLL / "data-contract.json")
    pruefe_siegel(closure, contract)
    print("Siegel geprueft: %d Payloads, Mengen-Pruefsumme nachgerechnet und getroffen."
          % contract["payloadCount"])

    if args.erlaubnisliste:
        Path(args.erlaubnisliste).write_text(
            json.dumps(erlaubnisliste(closure), ensure_ascii=False, indent=1) + "\n",
            encoding="utf-8")
        print("Erlaubnisliste geschrieben:", args.erlaubnisliste)

    wurzel = datenwurzel(args.data_root)
    beob = beobachtungen(wurzel)
    inv = inventur(closure, beob)
    inv["umgebung"] = umgebung()

    print("\nInventur des Beobachtungs-Speichers:")
    print("  %4d Beobachtungen insgesamt" % inv["beobachtungenGesamt"])
    print("  %4d versiegelt  (gehoeren in die Datenbank)" % inv["versiegelt"])
    print("  %4d Obermenge   (liegen im Speicher, NICHT in der Datenbank)" % inv["obermenge"])
    print("  %4d unbekannt   (weder noch)" % inv["unbekannt"])
    if inv["versiegeltFehltImSpeicher"]:
        print("  !! %d versiegelte Payloads fehlen im Speicher — ein Neubau ist so unmoeglich."
              % len(inv["versiegeltFehltImSpeicher"]))
    for klasse, verteilung in inv["guetenVerteilung"].items():
        print("     %-11s Guete: %s" % (klasse, ", ".join("%s=%d" % kv for kv in verteilung.items())))
    for klasse, verteilung in inv["vintageVerteilung"].items():
        print("     %-11s Stand: %s" % (klasse, ", ".join("%s=%d" % kv for kv in verteilung.items())))
    if inv["unbekannteDateien"]:
        print("\n  Die unbekannten Beobachtungen im Einzelnen:")
        for u in inv["unbekannteDateien"]:
            print("     %s  %s  Guete=%s  %s"
                  % (u["quartal"], u["datei"].split("/")[-1][:40], u["guete"],
                     ", ".join(u["quarantaene"]) or "-"))

    if args.bericht:
        Path(args.bericht).write_text(
            json.dumps(inv, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print("\nBericht geschrieben:", args.bericht)


if __name__ == "__main__":
    main()
