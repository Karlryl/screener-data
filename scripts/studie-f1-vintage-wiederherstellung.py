#!/usr/bin/env python3
"""Studie 2.0 / F1 — Wiederherstellung des registrierten DERA-Jahrgangs.

WAS DIESES SKRIPT TUT
---------------------
Es stellt den Jahrgang `legacy_earliest_archived` aus der im Repo registrierten
Herkunfts-Schliessung (`protocol/early-detection/2.0.0/provenance-closure.json`)
wieder her: je Payload wird die dort registrierte `sourceUrl` abgerufen und der
Byte-Strom gegen den dort registrierten `payloadSha256` geprueft. Stimmt der Hash
nicht, wird NICHTS abgelegt — der Payload zaehlt als FEHLGESCHLAGEN.

WARUM NICHT `early-detection-sec-wayback.py acquire`
---------------------------------------------------
Jenes Skript waehlt den Schnappschuss aus einer FRISCHEN CDX-Abfrage und prueft
gegen den dort gemeldeten SHA-1. Das beweist, dass der Abruf zu sich selbst passt
— nicht, dass er zum registrierten Jahrgang passt. Auflage A2 des Urteils
`_COURT-ZWEITQUELLE-2026-08-30.md` verlangt aber genau Letzteres:
„Vintage-Identitaet beweisen oder als gebrochen deklarieren." Der Massstab ist
der committete `payloadSha256`, nicht ein heute abgefragter Index.

DIE REGELN, DIE HIER IM CODE LEBEN
----------------------------------
* A2   Pruefsummenvergleich gegen die registrierte Herkunft VOR jeder Ablage.
       Abweichung = gebrochener Vintage = harter Einzelfehler, nie ein Fallback.
* A7   Plattenplatz-Gate VOR dem ersten Byte. Reicht der Platz nicht, laeuft
       ueberhaupt nichts.
* A13/W9  Negativ-Aussagen fuehren die geprueften Orte namentlich: der Bericht
       nennt je Payload URL, Soll-Hash, Ist-Hash und Zustand.
* R12a Der Speicherort kommt aus EARLY_DETECTION_DATA_ROOT oder --data-root,
       nie aus dem Code.
* R5   Fail-closed: kein stiller Fallback auf einen anderen Schnappschuss, keine
       Teil-Ablage, kein „nimm was da ist".

BLINDHEITS-ZAUN
---------------
Das Endtest-Fenster (2021q1-2024q4) ist versiegelt. Dieses Skript beruehrt es
nicht: Quartale nach LETZTES_OFFENES_QUARTAL werden abgelehnt, auch wenn sie in
der Herkunfts-Schliessung stehen.

Aufruf:
  python scripts/studie-f1-vintage-wiederherstellung.py --data-root <wurzel>
  python scripts/studie-f1-vintage-wiederherstellung.py --data-root <wurzel> \
      --von 2015q3 --bis 2015q3 --bericht reports/studie/f1-vintage.json
  python scripts/studie-f1-vintage-wiederherstellung.py --selbsttest
"""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DATENWURZEL_ENV = "EARLY_DETECTION_DATA_ROOT"
HERKUNFT_STD = Path("protocol") / "early-detection" / "2.0.0" / "provenance-closure.json"
JAHRGANG = "legacy_earliest_archived"
# Der Endtest ist versiegelt. F1 hat dort nichts zu suchen; deshalb steht die Grenze
# als Konstante im Code und nicht als Schalter auf der Kommandozeile.
# ponytail: harte Grenze statt Schalter — wer sie je braucht, begruendet sie im Diff.
LETZTES_OFFENES_QUARTAL = "2020q4"
HOEFLICHER_UA = "Karl Viehrig karl_viehrig@web.de research"
# Rohbestand + spaetere Ableitungen brauchen Luft. Faktor auf die noch fehlenden Bytes.
PLATZ_FAKTOR = 3.0
QUARTAL_RE = re.compile(r"^(\d{4})q([1-4])$")
SCHEMA = "studie-f1-vintage-wiederherstellung/v1"


class WiederherstellungsFehler(Exception):
    """Ein Befund, der den Lauf anhaelt — nie ein stiller Fallback."""


def lade_foundation():
    pfad = Path(__file__).resolve().with_name("early-detection-foundation.py")
    spec = importlib.util.spec_from_file_location("studie_f1_foundation", pfad)
    if spec is None or spec.loader is None:
        raise WiederherstellungsFehler("Foundation-Modul nicht ladbar: " + str(pfad))
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def quartal_schluessel(wert):
    treffer = QUARTAL_RE.match(str(wert).lower())
    if treffer is None:
        raise WiederherstellungsFehler("Kein gueltiges Quartal: " + repr(wert))
    return int(treffer.group(1)) * 4 + int(treffer.group(2)) - 1


def datenwurzel(vorgabe=None):
    wert = vorgabe or os.environ.get(DATENWURZEL_ENV)
    if not wert:
        raise WiederherstellungsFehler(
            "Speicherort unbekannt: " + DATENWURZEL_ENV + " ist nicht gesetzt "
            "(R12a verbietet einen fest verdrahteten Pfad)")
    return Path(wert)


def lies_herkunft(pfad):
    daten = json.loads(Path(pfad).read_text(encoding="utf-8-sig"))
    payloads = daten.get("payloads")
    if not isinstance(payloads, list) or not payloads:
        raise WiederherstellungsFehler("Herkunfts-Schliessung ohne payloads: " + str(pfad))
    return daten


def waehle_payloads(herkunft, jahrgang, von, bis):
    """Die registrierten Payloads im Fenster — mit hartem Siegel-Zaun."""
    grenze = quartal_schluessel(LETZTES_OFFENES_QUARTAL)
    if quartal_schluessel(bis) > grenze:
        raise WiederherstellungsFehler(
            "Quartal " + bis + " liegt hinter dem letzten offenen Quartal "
            + LETZTES_OFFENES_QUARTAL + " — das Endtest-Fenster ist versiegelt")
    if quartal_schluessel(von) > quartal_schluessel(bis):
        raise WiederherstellungsFehler("--von liegt hinter --bis")
    gewaehlt = []
    for eintrag in herkunft["payloads"]:
        if eintrag.get("vintage") != jahrgang:
            continue
        schluessel = quartal_schluessel(eintrag["quarter"])
        if quartal_schluessel(von) <= schluessel <= quartal_schluessel(bis):
            gewaehlt.append(eintrag)
    gewaehlt.sort(key=lambda e: quartal_schluessel(e["quarter"]))
    return gewaehlt


def blob_pfad(wurzel, sha256):
    return Path(wurzel) / "blobs" / "sha256" / sha256[:2] / (sha256 + ".zip")


def datei_sha256(pfad):
    hasher = hashlib.sha256()
    with open(pfad, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            hasher.update(block)
    return hasher.hexdigest()


def platz_gate(wurzel, fehlende_bytes, faktor=PLATZ_FAKTOR):
    """A7: erst der Platz, dann das erste Byte."""
    ziel = Path(wurzel)
    while not ziel.exists() and ziel.parent != ziel:
        ziel = ziel.parent
    frei = shutil.disk_usage(str(ziel)).free
    noetig = int(fehlende_bytes * faktor)
    return {
        "freieBytes": frei,
        "fehlendeBytes": fehlende_bytes,
        "geforderteBytes": noetig,
        "faktor": faktor,
        "bestanden": frei >= noetig,
    }


def hole_bytes(url, user_agent, timeout, versuche):
    letzter = None
    for versuch in range(versuche + 1):
        try:
            anfrage = urllib.request.Request(
                url, headers={"User-Agent": user_agent, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(anfrage, timeout=timeout) as antwort:
                return antwort.read(), {k.lower(): v for k, v in antwort.headers.items()}
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            letzter = exc
        if versuch < versuche:
            time.sleep(min(20.0, 2.0 * (2 ** versuch)))
    raise WiederherstellungsFehler("Abruf fehlgeschlagen nach " + str(versuche + 1)
                                   + " Versuchen: " + url + ": " + str(letzter))


def jetzt():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def wiederherstellen(wurzel, herkunft_pfad, jahrgang, von, bis, user_agent,
                     timeout, versuche, pause_ms, nur_pruefen=False):
    herkunft = lies_herkunft(herkunft_pfad)
    gewaehlt = waehle_payloads(herkunft, jahrgang, von, bis)
    if not gewaehlt:
        raise WiederherstellungsFehler(
            "Kein registrierter Payload fuer Jahrgang " + jahrgang + " im Fenster "
            + von + ".." + bis)
    wurzel = Path(wurzel)

    fehlend = [e for e in gewaehlt if not blob_pfad(wurzel, e["payloadSha256"]).exists()]
    gate = platz_gate(wurzel, sum(e["payloadBytes"] for e in fehlend))
    if fehlend and not gate["bestanden"]:
        raise WiederherstellungsFehler(
            "A7-Plattenplatz-Gate gerissen: frei " + str(gate["freieBytes"])
            + " Bytes, gefordert " + str(gate["geforderteBytes"]) + " Bytes")
    if nur_pruefen:
        fehlend = []

    foundation = lade_foundation() if fehlend else None
    zeilen = []
    for eintrag in gewaehlt:
        quartal = eintrag["quarter"]
        soll = eintrag["payloadSha256"]
        ziel = blob_pfad(wurzel, soll)
        zeile = {
            "quartal": quartal,
            "jahrgang": jahrgang,
            "sourceUrl": eintrag.get("sourceUrl"),
            "sollSha256": soll,
            "sollBytes": eintrag.get("payloadBytes"),
        }
        try:
            if not ziel.exists():
                if nur_pruefen:
                    zeile.update(zustand="FEHLT", istSha256=None, istBytes=None)
                    zeilen.append(zeile)
                    continue
                nutzlast, kopfzeilen = hole_bytes(
                    eintrag["sourceUrl"], user_agent, timeout, versuche)
                ist = hashlib.sha256(nutzlast).hexdigest()
                if ist != soll:
                    zeile.update(zustand="VINTAGE_GEBROCHEN", istSha256=ist,
                                 istBytes=len(nutzlast),
                                 grund="Abruf weicht vom registrierten payloadSha256 ab")
                    zeilen.append(zeile)
                    continue
                foundation.ingest_fsd_bytes(
                    wurzel, quartal, nutzlast, eintrag["sourceUrl"], jetzt(), kopfzeilen,
                    "registered_provenance_replay", eintrag.get("originalSourceUrl"),
                    {"provider": "provenance-closure replay",
                     "registeredSourceUrl": eintrag["sourceUrl"],
                     "registeredPayloadSha256": soll}, jahrgang)
                if pause_ms:
                    time.sleep(pause_ms / 1000)
                zustand = "WIEDERHERGESTELLT"
            else:
                zustand = "VORHANDEN"
            # Immer gegen die Bytes auf der Platte pruefen, nie gegen den Dateinamen.
            ist = datei_sha256(ziel)
            groesse = ziel.stat().st_size
            zeile.update(istSha256=ist, istBytes=groesse)
            if ist != soll:
                zeile.update(zustand="VINTAGE_GEBROCHEN",
                             grund="Blob auf der Platte weicht vom registrierten Hash ab")
            elif eintrag.get("payloadBytes") not in (None, groesse):
                zeile.update(zustand="VINTAGE_GEBROCHEN",
                             grund="Byte-Zahl weicht von der registrierten ab")
            else:
                zeile["zustand"] = zustand
        except WiederherstellungsFehler as exc:
            zeile.update(zustand="ABRUF_FEHLGESCHLAGEN", grund=str(exc),
                         istSha256=None, istBytes=None)
        zeilen.append(zeile)

    gezaehlt = {}
    for zeile in zeilen:
        gezaehlt[zeile["zustand"]] = gezaehlt.get(zeile["zustand"], 0) + 1
    bestaetigt = [z for z in zeilen if z["zustand"] in ("WIEDERHERGESTELLT", "VORHANDEN")]
    return {
        "schema": SCHEMA,
        "erzeugt": jetzt(),
        "auftrag": "Studie 2.0 F1 — Auflage A2/A7 des Urteils _COURT-ZWEITQUELLE-2026-08-30",
        "dataRoot": str(Path(wurzel).resolve()),
        "herkunftsSchliessung": str(herkunft_pfad),
        "herkunftsSchliessungSha256": datei_sha256(herkunft_pfad),
        "jahrgang": jahrgang,
        "fenster": {"von": von, "bis": bis, "siegelGrenze": LETZTES_OFFENES_QUARTAL},
        "userAgent": user_agent,
        "plattenplatzGate": gate,
        "payloads": len(zeilen),
        "zustaende": gezaehlt,
        "bitGleich": len(bestaetigt),
        "bitGleicheBytes": sum(z["istBytes"] or 0 for z in bestaetigt),
        "vintageIdentitaet": ("BEWIESEN" if len(bestaetigt) == len(zeilen) else "GEBROCHEN"),
        "zeilen": zeilen,
    }


# -- Selbsttest ---------------------------------------------------------------

def selbsttest():
    import tempfile

    ergebnisse = []

    def pruefe(name, bedingung):
        ergebnisse.append((name, bool(bedingung)))

    herkunft = {
        "payloads": [
            {"quarter": "2015q3", "vintage": JAHRGANG, "payloadSha256": "a" * 64,
             "payloadBytes": 10, "sourceUrl": "https://example.invalid/2015q3.zip"},
            {"quarter": "2021q1", "vintage": JAHRGANG, "payloadSha256": "b" * 64,
             "payloadBytes": 10, "sourceUrl": "https://example.invalid/2021q1.zip"},
            {"quarter": "2015q3", "vintage": "post_2024_reprocessed_or_current",
             "payloadSha256": "c" * 64, "payloadBytes": 10,
             "sourceUrl": "https://example.invalid/neu.zip"},
        ]
    }

    # Der Siegel-Zaun haelt: ein Quartal hinter der Grenze wird abgelehnt.
    try:
        waehle_payloads(herkunft, JAHRGANG, "2015q3", "2021q1")
        pruefe("Endtest-Quartal wird abgelehnt", False)
    except WiederherstellungsFehler as exc:
        pruefe("Endtest-Quartal wird abgelehnt", "versiegelt" in str(exc))

    # Und er haelt auch, wenn nur das Fenster-Ende sauber ist.
    gewaehlt = waehle_payloads(herkunft, JAHRGANG, "2009q1", "2020q4")
    pruefe("nur der angeforderte Jahrgang wird gewaehlt",
           len(gewaehlt) == 1 and gewaehlt[0]["quarter"] == "2015q3")

    # Quartals-Arithmetik.
    pruefe("Quartals-Ordnung stimmt",
           quartal_schluessel("2020q4") + 1 == quartal_schluessel("2021q1"))
    try:
        quartal_schluessel("2020Q9")
        pruefe("unlesbares Quartal bricht ab", False)
    except WiederherstellungsFehler:
        pruefe("unlesbares Quartal bricht ab", True)

    # Das Plattenplatz-Gate muss reissen koennen — sonst ist es keins.
    with tempfile.TemporaryDirectory() as tmp:
        frei = shutil.disk_usage(tmp).free
        pruefe("Plattenplatz-Gate laesst Kleines durch",
               platz_gate(tmp, 1024)["bestanden"] is True)
        pruefe("Plattenplatz-Gate reisst bei Grossem",
               platz_gate(tmp, frei)["bestanden"] is False)

        # Der Hash-Vergleich muss den gebrochenen Vintage sehen. Blob liegt unter
        # dem SOLL-Namen, traegt aber andere Bytes — genau der Fall, den ein
        # Namens-Check durchwinken wuerde.
        wurzel = Path(tmp) / "wurzel"
        soll = "d" * 64
        ziel = blob_pfad(wurzel, soll)
        ziel.parent.mkdir(parents=True, exist_ok=True)
        ziel.write_bytes(b"nicht der registrierte Payload")
        herkunft_datei = Path(tmp) / "closure.json"
        herkunft_datei.write_text(json.dumps({"payloads": [
            {"quarter": "2015q3", "vintage": JAHRGANG, "payloadSha256": soll,
             "payloadBytes": 30, "sourceUrl": "https://example.invalid/x.zip"}]}),
            encoding="utf-8")
        bericht = wiederherstellen(wurzel, herkunft_datei, JAHRGANG, "2015q3", "2015q3",
                                   HOEFLICHER_UA, 5, 0, 0, nur_pruefen=True)
        pruefe("falsche Bytes unter richtigem Namen fliegen auf",
               bericht["vintageIdentitaet"] == "GEBROCHEN"
               and bericht["zeilen"][0]["zustand"] == "VINTAGE_GEBROCHEN")

        # Gegenprobe: richtige Bytes -> BEWIESEN. Ohne sie waere der Waechter
        # womoeglich immer rot und damit wertlos.
        echt = b"echter Payload"
        soll2 = hashlib.sha256(echt).hexdigest()
        ziel2 = blob_pfad(wurzel, soll2)
        ziel2.parent.mkdir(parents=True, exist_ok=True)
        ziel2.write_bytes(echt)
        herkunft_datei.write_text(json.dumps({"payloads": [
            {"quarter": "2015q3", "vintage": JAHRGANG, "payloadSha256": soll2,
             "payloadBytes": len(echt), "sourceUrl": "https://example.invalid/x.zip"}]}),
            encoding="utf-8")
        bericht2 = wiederherstellen(wurzel, herkunft_datei, JAHRGANG, "2015q3", "2015q3",
                                    HOEFLICHER_UA, 5, 0, 0, nur_pruefen=True)
        pruefe("richtige Bytes gelten als bewiesen",
               bericht2["vintageIdentitaet"] == "BEWIESEN"
               and bericht2["zeilen"][0]["zustand"] == "VORHANDEN")

    for name, ok in ergebnisse:
        print(("PASS  " if ok else "FAIL  ") + name)
    schlecht = [n for n, ok in ergebnisse if not ok]
    print("\n" + str(len(ergebnisse) - len(schlecht)) + "/" + str(len(ergebnisse))
          + " Pruefungen bestanden")
    return 0 if not schlecht else 1


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data-root")
    p.add_argument("--herkunft", default=str(HERKUNFT_STD))
    p.add_argument("--jahrgang", default=JAHRGANG)
    p.add_argument("--von", default="2009q1")
    p.add_argument("--bis", default=LETZTES_OFFENES_QUARTAL)
    p.add_argument("--user-agent", default=HOEFLICHER_UA)
    p.add_argument("--timeout", type=int, default=600)
    p.add_argument("--versuche", type=int, default=3)
    p.add_argument("--pause-ms", type=int, default=800)
    p.add_argument("--nur-pruefen", action="store_true",
                   help="nichts abrufen, nur die vorhandenen Blobs gegen die Registrierung pruefen")
    p.add_argument("--bericht")
    p.add_argument("--selbsttest", action="store_true")
    args = p.parse_args()

    if args.selbsttest:
        return selbsttest()

    try:
        wurzel = datenwurzel(args.data_root)
        bericht = wiederherstellen(
            wurzel, args.herkunft, args.jahrgang, args.von, args.bis,
            args.user_agent, args.timeout, args.versuche, args.pause_ms,
            nur_pruefen=args.nur_pruefen)
    except WiederherstellungsFehler as exc:
        print("ABBRUCH: " + str(exc), file=sys.stderr)
        return 2

    if args.bericht:
        ziel = Path(args.bericht)
        ziel.parent.mkdir(parents=True, exist_ok=True)
        ziel.write_text(json.dumps(bericht, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
    print(json.dumps({k: v for k, v in bericht.items() if k != "zeilen"},
                     indent=2, ensure_ascii=False))
    return 0 if bericht["vintageIdentitaet"] == "BEWIESEN" else 1


if __name__ == "__main__":
    sys.exit(main())
