#!/usr/bin/env python3
"""E1-Panel, Stufe 1: Schema-Inventar ueber den versiegelten Sichtkasten.

WOZU DIESE STUFE EXISTIERT
--------------------------
Vor dem Panel-Bau muss feststehen, WELCHE Spalten die SEC-Lieferungen je Epoche
ueberhaupt tragen. Das ist keine Formalie, sondern der Kern des offenen
R6-Problems (siehe _STUDIE-NEUE-VERFASSUNG-2026-08-16.md, zweite Korrektur vom
17.08.):

  Die bisherige Messung "Fakten je Bericht" verglich Konzernzahlen des Alt-Stands
  gegen Konzernzahlen PLUS Sparten-Aufrisse des neuen Stands und nannte das
  "Tiefe". Auf eindeutigen Kennzahl-Zeitpunkten drehte sich das Vorzeichen
  (-38 % / -33 %). Verbindlich ist deshalb bis heute nur die Richtungsaussage
  "era-abhaengig, ueberwiegend flacher" — die Prozentwerte sind es NICHT.

Die Ursache ist eine Schema-Aenderung: die Zeilen-Tabelle num.txt fuehrt das
Segment-Feld je nach Epoche unter verschiedenen Namen (fruehe Lieferungen:
`coreg`; spaetere: `segments`) — oder gar nicht. Wer die Spalten nicht kennt,
zaehlt Aepfel gegen Birnen. Diese Stufe stellt fest, WAS es je Quartal und
Variante gibt, BEVOR irgendetwas gezaehlt wird.

WARUM NUR KOPFZEILEN
--------------------
Der Vollscan ueber 7,1 GB kommt in Stufe 2. Hier wird je Payload nur die erste
Zeile von sub.txt und num.txt gelesen. Das laeuft in Minuten statt Stunden und
liefert genau die Entscheidungsgrundlage, die Stufe 2 braucht.

INVARIANTEN
-----------
* READ-ONLY gegenueber dem Sichtkasten. Es wird NICHTS entpackt, nichts
  geschrieben, nichts geloescht. Der versiegelte Bestand bleibt unberuehrt.
* Kein Netzzugriff.
* Ein Payload, der sich nicht oeffnen laesst, ist ein BEFUND und wird benannt —
  nicht uebersprungen. Ein stilles Ueberspringen wuerde ein Schema-Loch als
  "einheitlich" ausweisen.

Aufruf:
  python scripts/studie-panel-schema.py --sichtkasten <pfad> --out reports/studie/E1-panel-schema-<datum>.json
  python scripts/studie-panel-schema.py --selftest
"""

import argparse
import collections
import hashlib
import json
import os
import sys
import zipfile

MITGLIEDER = ("sub.txt", "num.txt", "pre.txt", "tag.txt")

# Namen, unter denen eine Lieferung das Segment-/Sparten-Feld fuehren kann.
# Genau dieses Feld entscheidet, ob eine Zeile eine Konzernzahl oder einen
# Sparten-Aufriss traegt — und damit, ob eine Tiefen-Zaehlung ehrlich ist.
SEGMENT_KANDIDATEN = ("segments", "coreg")


def blob_pfad(sichtkasten: str, sha256: str) -> str:
    """Blobs liegen unter blobs/sha256/<erste zwei Zeichen>/<sha256>.zip."""
    return os.path.join(sichtkasten, "blobs", "sha256", sha256[:2], f"{sha256}.zip")


def kopfzeilen(zip_pfad: str) -> dict:
    """Liest die Spaltennamen der Mitglieder. Wirft bei kaputtem Archiv."""
    ergebnis = {}
    with zipfile.ZipFile(zip_pfad) as z:
        vorhanden = {i.filename for i in z.infolist()}
        ergebnis["_mitglieder"] = sorted(vorhanden)
        for name in MITGLIEDER:
            if name not in vorhanden:
                ergebnis[name] = None          # fehlend ist ein Befund, kein Fehler
                continue
            with z.open(name) as fh:
                kopf = fh.readline().decode("utf-8", "replace").rstrip("\r\n")
            ergebnis[name] = kopf.split("\t")
    return ergebnis


def beobachtungen(sichtkasten: str):
    """Alle Beobachtungs-JSONs des Sichtkastens, sortiert nach Quartal."""
    wurzel = os.path.join(sichtkasten, "observations")
    for pfad, _, dateien in os.walk(wurzel):
        for d in sorted(dateien):
            if not d.endswith(".json"):
                continue
            voll = os.path.join(pfad, d)
            with open(voll, encoding="utf-8") as fh:
                yield voll, json.load(fh)


def inventar(sichtkasten: str) -> dict:
    zeilen = []
    fehler = []
    for pfad, obs in beobachtungen(sichtkasten):
        sha = obs.get("payloadSha256")
        quartal = obs.get("quarter")
        variante = obs.get("datasetVariant")
        zp = blob_pfad(sichtkasten, sha) if sha else None
        if not zp or not os.path.exists(zp):
            # Fail-loud: ein fehlender Blob darf NICHT als "Quartal ohne
            # Besonderheit" durchgehen — sonst meldet das Inventar Einheitlichkeit,
            # die es nur mangels Daten gibt.
            fehler.append({"beobachtung": os.path.basename(pfad), "quartal": quartal,
                           "variante": variante, "grund": "Blob fehlt", "sha256": sha})
            continue
        try:
            k = kopfzeilen(zp)
        except Exception as e:                      # noqa: BLE001 — Grund wird benannt
            fehler.append({"beobachtung": os.path.basename(pfad), "quartal": quartal,
                           "variante": variante, "grund": f"Archiv unlesbar: {e}", "sha256": sha})
            continue
        num = k.get("num.txt") or []
        zeilen.append({
            "quartal": quartal,
            "variante": variante,
            "sha256": sha,
            "mitglieder": k["_mitglieder"],
            "sub_spalten": k.get("sub.txt"),
            "num_spalten": num,
            # Die eigentliche Frage dieser Stufe:
            "segmentfeld": next((s for s in SEGMENT_KANDIDATEN if s in num), None),
        })

    zeilen.sort(key=lambda z: (z["quartal"] or "", z["variante"] or ""))

    # Gruppieren: welche num.txt-Spaltensaetze gibt es ueberhaupt?
    formen = collections.OrderedDict()
    for z in zeilen:
        schluessel = hashlib.sha256("\t".join(z["num_spalten"]).encode()).hexdigest()[:12]
        eintrag = formen.setdefault(schluessel, {
            "num_spalten": z["num_spalten"],
            "segmentfeld": z["segmentfeld"],
            "quartale": [],
            "varianten": set(),
        })
        eintrag["quartale"].append(z["quartal"])
        eintrag["varianten"].add(z["variante"])
    for e in formen.values():
        e["varianten"] = sorted(e["varianten"])
        e["quartale"] = sorted(set(e["quartale"]))
        e["von"] = e["quartale"][0] if e["quartale"] else None
        e["bis"] = e["quartale"][-1] if e["quartale"] else None
        e["anzahl"] = len(e["quartale"])

    return {"payloads": zeilen, "num_formen": formen, "fehler": fehler}


def selftest() -> int:
    """Laufender Selbstcheck ohne Netz und ohne den echten Bestand."""
    import tempfile
    ok = fehl = 0

    def pruefe(name, bedingung):
        nonlocal ok, fehl
        if bedingung:
            ok += 1
            print(f"  ok   {name}")
        else:
            fehl += 1
            print(f"  FAIL {name}")

    with tempfile.TemporaryDirectory() as tmp:
        # Kunst-Sichtkasten mit zwei Quartalen: eines mit coreg, eines mit segments.
        for quartal, segspalte, sha in (("2009q1", "coreg", "aa" + "0" * 62),
                                        ("2024q1", "segments", "bb" + "0" * 62)):
            bd = os.path.join(tmp, "blobs", "sha256", sha[:2])
            os.makedirs(bd, exist_ok=True)
            with zipfile.ZipFile(os.path.join(bd, f"{sha}.zip"), "w") as z:
                z.writestr("sub.txt", "adsh\tcik\tname\n1\t2\tX\n")
                z.writestr("num.txt", f"adsh\ttag\t{segspalte}\tvalue\n1\tRev\t\t5\n")
                z.writestr("pre.txt", "adsh\n1\n")
                z.writestr("tag.txt", "tag\nRev\n")
            od = os.path.join(tmp, "observations", "sec-fsd", quartal)
            os.makedirs(od, exist_ok=True)
            with open(os.path.join(od, f"{quartal}.json"), "w", encoding="utf-8") as fh:
                json.dump({"payloadSha256": sha, "quarter": quartal,
                           "datasetVariant": "legacy_earliest_archived"}, fh)

        erg = inventar(tmp)
        pruefe("beide Payloads erfasst", len(erg["payloads"]) == 2)
        pruefe("keine Fehler bei heilem Bestand", erg["fehler"] == [])
        pruefe("coreg als Segmentfeld erkannt",
               any(p["segmentfeld"] == "coreg" for p in erg["payloads"]))
        pruefe("segments als Segmentfeld erkannt",
               any(p["segmentfeld"] == "segments" for p in erg["payloads"]))
        pruefe("zwei verschiedene num-Formen unterschieden", len(erg["num_formen"]) == 2)

        # BRUCHPROBE: fehlender Blob MUSS als Fehler auftauchen, nicht still fehlen.
        os.remove(os.path.join(tmp, "blobs", "sha256", "aa", "aa" + "0" * 62 + ".zip"))
        erg2 = inventar(tmp)
        pruefe("fehlender Blob wird BENANNT statt uebersprungen",
               len(erg2["fehler"]) == 1 and erg2["fehler"][0]["grund"] == "Blob fehlt")
        pruefe("und er zaehlt nicht als Payload", len(erg2["payloads"]) == 1)

        # BRUCHPROBE: kaputtes Archiv MUSS benannt werden.
        bd = os.path.join(tmp, "blobs", "sha256", "bb")
        with open(os.path.join(bd, "bb" + "0" * 62 + ".zip"), "wb") as fh:
            fh.write(b"kein zip")
        erg3 = inventar(tmp)
        pruefe("kaputtes Archiv wird BENANNT",
               any("unlesbar" in f["grund"] for f in erg3["fehler"]))

    print(f"\nstudie-panel-schema selftest: {ok} ok, {fehl} fail")
    return 0 if fehl == 0 else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--sichtkasten", default=os.path.join(
        os.path.expanduser("~"), "Documents", "GrowthScreenerResearchData",
        "early-detection-v4-sealed127"))
    p.add_argument("--out")
    p.add_argument("--selftest", action="store_true")
    a = p.parse_args()

    if a.selftest:
        return selftest()

    if not os.path.isdir(a.sichtkasten):
        print(f"FEHLER: Sichtkasten nicht gefunden: {a.sichtkasten}", file=sys.stderr)
        return 1

    erg = inventar(a.sichtkasten)
    print(f"Payloads gelesen: {len(erg['payloads'])}")
    print(f"Verschiedene num.txt-Formen: {len(erg['num_formen'])}\n")
    for schluessel, e in erg["num_formen"].items():
        seg = e["segmentfeld"] or "KEINS"
        print(f"  Form {schluessel}: {e['anzahl']} Quartale ({e['von']}..{e['bis']}), "
              f"Segmentfeld={seg}, Varianten={','.join(e['varianten'])}")
        print(f"    Spalten: {', '.join(e['num_spalten'])}")
    if erg["fehler"]:
        print(f"\n!! {len(erg['fehler'])} Payload(s) NICHT lesbar — das sind Luecken im Inventar:")
        for f in erg["fehler"][:10]:
            print(f"   {f['quartal']} ({f['variante']}): {f['grund']}")

    if a.out:
        os.makedirs(os.path.dirname(a.out), exist_ok=True)
        ausgabe = dict(erg)
        ausgabe["num_formen"] = {k: v for k, v in erg["num_formen"].items()}
        with open(a.out, "w", encoding="utf-8") as fh:
            json.dump(ausgabe, fh, ensure_ascii=False, indent=1)
        print(f"\nGeschrieben: {a.out}")

    # Ein Inventar mit Luecken ist kein gruener Lauf.
    return 1 if erg["fehler"] else 0


if __name__ == "__main__":
    sys.exit(main())
