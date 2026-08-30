#!/usr/bin/env python3
"""RR9-A1 (B1') - Ist-Stand-Manifest ueber den Studien-Speicher und der Lesepfad-Tripwire.

DIE SACHE: B1 war gruen auf einer Messebene, die nur 794 registrierte Payloads
kannte - 4,675 % der Blobs, 7,607 % der Bytes des Ist-Stands (Urteil
_COURT-RR9-2026-08-30, U6 und §0.1). Ein Waechter, dessen Pruefung 16.190 Blobs
nicht kennt, kann fuer diese Blobs nicht abbrechen. Dieses Werkzeug hebt die
Messebene auf den Stand, den der Bau WIRKLICH liest.

ZWEI ABGESTUFTE KONSEQUENZEN (RR9-A1 Ziffer 3, woertlich):
  * Payload NICHT im Manifest        -> STOPP, Rueckgabe an den Orchestrator.
    Reparabler Disziplinfehler; dieser Zweig deckt die Blobs ab, die B1s Text
    nie erfasste.
  * Payload im Manifest, Inhalt weicht ab -> BEERDIGEN. B1s Originalschaerfe,
    unveraendert.

WARUM DIE PRUEFUNG AM INHALT HAENGT UND NICHT AM NAMEN (RR9-A4): der Speicher ist
inhaltsadressiert, die Datei heisst wie ihr Hash. Eine Pruefung, die den Namen
mit dem Namen vergleicht, ist eine Tautologie und faellt nie rot aus. Gehasht
werden deshalb IMMER die Dateibytes; das Manifest fuehrt beides getrennt
(`inhaltSha256` und `nameSha256`) und meldet jede Abweichung als Befund.
Berichtet wird zusaetzlich der Durchsatz - ein Leser muss Messung und
Tautologie unterscheiden koennen, ohne den Code zu lesen.

AUFRUF:
  python scripts/studie-rr9-b1-manifest.py bauen --daten-wurzel <pfad> --ziel <datei.json>
  python scripts/studie-rr9-b1-manifest.py pruefen --manifest <datei.json> \
      --sichtkasten <pfad> --sha256 <sha>
  python scripts/studie-rr9-b1-manifest.py selbsttest
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time

# Die drei namentlich benannten Orte (RR9-A1 Ziffer 1). Die Liste ist Teil der
# Auflage - wer einen Ort ergaenzt oder weglaesst, aendert den Gegenstand des
# Waechters und nicht nur seine Konfiguration.
ORTE = ("early-detection-v4", "early-detection-v4-sealed127", "early-detection-store")
BLOB_UNTERPFAD = ("blobs", "sha256")

SANKTION_STOPP = "STOPP"
SANKTION_BEERDIGEN = "BEERDIGEN"
EXIT_STOPP = 3
EXIT_BEERDIGEN = 4

SCHEMA = "studie-rr9-b1-ist-stand-manifest/v1"
LESEBLOCK = 4 * 1024 * 1024


class BremsenBruch(Exception):
    """B1' hat gefeuert. `sanktion` sagt, welcher der beiden Zweige."""

    def __init__(self, sanktion, text):
        super().__init__(text)
        self.sanktion = sanktion


def sha256_datei(pfad):
    h = hashlib.sha256()
    with open(pfad, "rb") as fh:
        while True:
            block = fh.read(LESEBLOCK)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def blob_dateien(ort_pfad):
    """Alle Blobs eines Ortes, sortiert - damit das Manifest byte-stabil ist."""
    wurzel = os.path.join(ort_pfad, *BLOB_UNTERPFAD)
    if not os.path.isdir(wurzel):
        return []
    treffer = []
    for verzeichnis, _unter, dateien in os.walk(wurzel):
        for name in dateien:
            treffer.append(os.path.join(verzeichnis, name))
    treffer.sort()
    return treffer


HEX64 = re.compile(r"^[0-9a-f]{64}$")


def name_sha256(pfad):
    """Der Hash, den der Dateiname BEHAUPTET - oder None. Nie das Messergebnis.

    ACHSENFEHLER, DEN DIESE FUNKTION EINMAL HATTE (RR9-A4, hier festgehalten
    statt weggeputzt): `os.path.splitext` schneidet nur EINE Endung ab. Bei
    `<sha>.warc.gz` und `<sha>.tar.zst` blieb `<sha>.warc` stehen, und der
    erste Lauf meldete 15 von 17.159 Blobs als 'Name weicht vom Inhalt ab' -
    ein falsches Positiv der eigenen Messung, kein Datenbefund. Geschnitten
    wird deshalb am ERSTEN Punkt, und was danach kein 64-stelliger Hex-String
    ist, BEHAUPTET keinen Hash und wird auch nicht so verglichen."""
    behauptet = os.path.basename(pfad).split(".", 1)[0]
    return behauptet if HEX64.match(behauptet) else None


def baue_manifest(daten_wurzel, orte=ORTE):
    start = time.time()
    eintraege = {}
    ort_berichte = []
    abweichungen = []
    for ort in orte:
        ort_pfad = os.path.join(daten_wurzel, ort)
        dateien = blob_dateien(ort_pfad)
        blobs = {}
        bytes_ort = 0
        ohne_hashnamen = 0
        for pfad in dateien:
            groesse = os.path.getsize(pfad)
            inhalt = sha256_datei(pfad)
            behauptet = name_sha256(pfad)
            if behauptet is None:
                # Der Name behauptet nichts. Der Blob bleibt im Manifest - er
                # gehoert zum Ist-Stand - aber er geht nicht in den
                # Name-gegen-Inhalt-Vergleich ein, sonst misst der Vergleich
                # die Namenskonvention statt der Bytes.
                ohne_hashnamen += 1
                behauptet = os.path.basename(pfad)
            elif inhalt != behauptet:
                abweichungen.append({"ort": ort, "nameSha256": behauptet,
                                     "inhaltSha256": inhalt, "bytes": groesse})
            blobs[behauptet] = {"inhaltSha256": inhalt, "bytes": groesse}
            bytes_ort += groesse
        eintraege[ort] = blobs
        ort_berichte.append({
            "name": ort,
            "blobWurzel": "/".join(BLOB_UNTERPFAD),
            "vorhanden": os.path.isdir(ort_pfad),
            "blobs": len(dateien),
            "bytes": bytes_ort,
            "ohneHashNamen": ohne_hashnamen,
        })
    dauer = time.time() - start
    bytes_gesamt = sum(o["bytes"] for o in ort_berichte)
    blobs_gesamt = sum(o["blobs"] for o in ort_berichte)
    return {
        "schema": SCHEMA,
        "protokoll": "FEM-SEC-US@2.1.0",
        "auflage": "RR9-A1 (B1') - _COURT-RR9-2026-08-30",
        "gegenstand": ("Der Speicherstand, den der Bau LIEST - nicht der "
                       "11.08.-Checkpoint. Ersetzt B1s Messebene (794 Payloads, "
                       "4,675 % der Blobs) durch den Ist-Stand."),
        "pruefmethode": {
            "wie": ("Inhalts-Hash: SHA-256 ueber alle Dateibytes jedes Blobs. "
                    "KEIN Dateinamens- und KEIN Indexvergleich."),
            "sekunden": round(dauer, 3),
            "bytesJeSekunde": int(bytes_gesamt / dauer) if dauer > 0 else None,
            "durchsatzMbProSekunde": round(bytes_gesamt / dauer / 1e6, 1) if dauer > 0 else None,
            "warumBerichtet": ("RR9-A4: ein Leser muss Inhalts-Hashen von einem "
                               "Namensvergleich unterscheiden koennen, ohne den "
                               "Code zu lesen."),
        },
        "suchachsen": [
            {"achse": "Verzeichnis", "status": "gemessen",
             "wert": "je Ort blobs/sha256/**, rekursiv"},
            {"achse": "Dateiname", "status": "gemessen",
             "wert": "als BEHAUPTETER Hash gefuehrt, nie als Messergebnis"},
            {"achse": "Inhalts-Hash", "status": "gemessen", "wert": "SHA-256 ueber alle Bytes"},
            {"achse": "Feldname", "status": "nicht zutreffend",
             "wert": "Blobs sind undurchsuchte Archive; kein Feldzugriff in diesem Lauf"},
            {"achse": "Registerfeld", "status": "ungemessen",
             "wert": ("Dieses Manifest behauptet NICHT, dass jeder Blob "
                      "registriert ist - genau dafuer ist der STOPP-Zweig da.")},
        ],
        "orte": ort_berichte,
        "gesamt": {"blobs": blobs_gesamt, "bytes": bytes_gesamt},
        # Der Datei-Hash des Manifests aendert sich bei jedem Lauf, weil der
        # Durchsatz mitgemessen wird. Ein spaeterer Pruefer braucht aber einen
        # Wert, der NUR am Messergebnis haengt: das ist dieser hier. Wer den
        # Speicher unveraendert neu hasht, muss denselben Wert bekommen.
        "inhaltsSha256": hashlib.sha256(json.dumps(
            eintraege, ensure_ascii=False, sort_keys=True,
            separators=(",", ":")).encode("utf-8")).hexdigest(),
        "nameGegenInhalt": {
            "regel": ("Verglichen wird nur, wo der Dateiname einen 64-stelligen "
                      "Hex-Hash BEHAUPTET (Schnitt am ersten Punkt). Namen ohne "
                      "Hash-Behauptung zaehlen als `ohneHashNamen` und nicht als "
                      "Abweichung."),
            "geprueft": blobs_gesamt - sum(o["ohneHashNamen"] for o in ort_berichte),
            "ohneHashNamen": sum(o["ohneHashNamen"] for o in ort_berichte),
            "abweichend": len(abweichungen),
            "abweichungen": abweichungen[:100],
        },
        "blobs": eintraege,
    }


def schreibe_manifest(manifest, ziel):
    text = json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    with open(ziel, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def lade_manifest(pfad):
    """Fail-closed: ohne Manifest gibt es keinen Lesepfad, nicht einen ungeprueften."""
    if not pfad or not os.path.isfile(pfad):
        raise BremsenBruch(
            SANKTION_STOPP,
            "B1'-ABBRUCH (STOPP): kein Ist-Stand-Manifest unter " + repr(pfad)
            + ". Ohne Manifest ist die Messgrundlage unbekannt; ein ungeprueftes "
            "Lesen waere genau der Zustand, gegen den RR9-A1 geschrieben ist. "
            "Rueckgabe an den Orchestrator.")
    with open(pfad, encoding="utf-8") as fh:
        manifest = json.load(fh)
    if manifest.get("schema") != SCHEMA:
        raise BremsenBruch(
            SANKTION_STOPP,
            "B1'-ABBRUCH (STOPP): " + repr(pfad) + " traegt schema "
            + repr(manifest.get("schema")) + ", erwartet " + SCHEMA + ".")
    return manifest


def blob_pfad(sichtkasten, sha256):
    return os.path.join(sichtkasten, *BLOB_UNTERPFAD, sha256[:2], sha256 + ".zip")


def _eintrag(manifest, sha256):
    for blobs in (manifest.get("blobs") or {}).values():
        if sha256 in blobs:
            return blobs[sha256]
    return None


def pruefe_payload(manifest, sichtkasten, sha256):
    """Der Lesepfad-Tripwire. Gibt die Bytezahl zurueck oder feuert.

    Verankert am OBJEKT: geprueft wird der Inhalt der Datei gegen den im
    Manifest festgehaltenen Inhalts-Hash. Kein Textmuster, kein Dateiname.
    """
    eintrag = _eintrag(manifest, sha256)
    if eintrag is None:
        raise BremsenBruch(
            SANKTION_STOPP,
            "B1'-ABBRUCH (STOPP, Rueckgabe an den Orchestrator): Payload "
            + sha256 + " steht in KEINEM der Orte des Ist-Stand-Manifests. Ein "
            "Bau liest damit an der Messgrundlage vorbei. Das ist ein "
            "reparabler Disziplinfehler - kein Datenschaden.")
    pfad = blob_pfad(sichtkasten, sha256)
    if not os.path.isfile(pfad):
        raise BremsenBruch(
            SANKTION_STOPP,
            "B1'-ABBRUCH (STOPP): Payload " + sha256 + " steht im Manifest, "
            "liegt aber nicht unter " + pfad + ".")
    ist = sha256_datei(pfad)
    if ist != eintrag["inhaltSha256"]:
        raise BremsenBruch(
            SANKTION_BEERDIGEN,
            "B1'-ABBRUCH (BEERDIGEN): Byte-Nichtidentitaet an " + pfad
            + ". Manifest " + eintrag["inhaltSha256"] + ", gemessen " + ist
            + ". Das ist der Fall, gegen den B1 geschrieben wurde; seine "
            "Konsequenz bleibt unveraendert.")
    return eintrag["bytes"]


# -- Selbsttest ---------------------------------------------------------------

def selbsttest():
    import tempfile
    ok = fehl = 0

    def pruefe(name, bedingung):
        nonlocal ok, fehl
        if bedingung:
            ok += 1
            print("  ok   " + name)
        else:
            fehl += 1
            print("  FAIL " + name)

    with tempfile.TemporaryDirectory() as tmp:
        wurzel = os.path.join(tmp, "wurzel")
        ort = ORTE[1]
        kasten = os.path.join(wurzel, ort)
        namen = []
        for i, inhalt in enumerate((b"payload-eins", b"payload-zwei")):
            name = ("%02x" % (0xa0 + i)) + "0" * 62
            verz = os.path.join(kasten, *BLOB_UNTERPFAD, name[:2])
            os.makedirs(verz, exist_ok=True)
            with open(os.path.join(verz, name + ".zip"), "wb") as fh:
                fh.write(inhalt)
            namen.append(name)

        manifest = baue_manifest(wurzel, orte=(ort,))
        pruefe("Manifest zaehlt beide Blobs", manifest["gesamt"]["blobs"] == 2)
        pruefe("Manifest fuehrt die Bytesumme",
               manifest["gesamt"]["bytes"] == len(b"payload-eins") + len(b"payload-zwei"))
        pruefe("Pruefmethode nennt Inhalts-Hash",
               "Inhalts-Hash" in manifest["pruefmethode"]["wie"])
        pruefe("Durchsatz ist berichtet (RR9-A4)",
               manifest["pruefmethode"]["durchsatzMbProSekunde"] is not None)
        pruefe("Name-gegen-Inhalt ist GEMESSEN, nicht angenommen",
               manifest["nameGegenInhalt"]["geprueft"] == 2
               and manifest["nameGegenInhalt"]["abweichend"] == 2)
        pruefe("alle drei Orte stehen namentlich im Manifest-Bau",
               ORTE == ("early-detection-v4", "early-detection-v4-sealed127",
                        "early-detection-store"))

        # ANWESENHEIT: der unveraenderte Blob darf NICHT feuern.
        pruefe("unveraenderter Blob geht durch",
               pruefe_payload(manifest, kasten, namen[0]) == len(b"payload-eins"))

        # ABWESENHEIT 1 - ROT-PROBE STOPP: ein nicht registriertes Payload.
        fremd = "ff" + "0" * 62
        verz = os.path.join(kasten, *BLOB_UNTERPFAD, fremd[:2])
        os.makedirs(verz, exist_ok=True)
        with open(os.path.join(verz, fremd + ".zip"), "wb") as fh:
            fh.write(b"nie registriert")
        try:
            pruefe_payload(manifest, kasten, fremd)
            pruefe("ROT-PROBE 1: nicht registriertes Payload -> STOPP", False)
        except BremsenBruch as exc:
            pruefe("ROT-PROBE 1: nicht registriertes Payload -> STOPP",
                   exc.sanktion == SANKTION_STOPP)

        # ABWESENHEIT 2 - ROT-PROBE BEERDIGEN: ein bit-gekipptes Payload.
        ziel = blob_pfad(kasten, namen[1])
        with open(ziel, "wb") as fh:
            fh.write(b"payload-zwei".replace(b"zwei", b"drei"))
        try:
            pruefe_payload(manifest, kasten, namen[1])
            pruefe("ROT-PROBE 2: bit-gekipptes Payload -> BEERDIGEN", False)
        except BremsenBruch as exc:
            pruefe("ROT-PROBE 2: bit-gekipptes Payload -> BEERDIGEN",
                   exc.sanktion == SANKTION_BEERDIGEN)

        # ABWESENHEIT 3: ohne Manifest gibt es keinen stillen Durchlauf.
        try:
            lade_manifest(os.path.join(tmp, "gibt-es-nicht.json"))
            pruefe("ROT-PROBE 3: fehlendes Manifest -> STOPP", False)
        except BremsenBruch as exc:
            pruefe("ROT-PROBE 3: fehlendes Manifest -> STOPP",
                   exc.sanktion == SANKTION_STOPP)

    print("selbsttest: %d ok, %d FAIL" % (ok, fehl))
    return 0 if fehl == 0 else 1


def main(argv=None):
    p = argparse.ArgumentParser(description="RR9-A1 (B1') - Ist-Stand-Manifest")
    unter = p.add_subparsers(dest="befehl", required=True)

    b = unter.add_parser("bauen", help="Ist-Stand-Manifest ueber die drei Orte bauen")
    b.add_argument("--daten-wurzel", required=True)
    b.add_argument("--ziel", required=True)

    v = unter.add_parser("pruefen", help="ein Payload gegen das Manifest pruefen")
    v.add_argument("--manifest", required=True)
    v.add_argument("--sichtkasten", required=True)
    v.add_argument("--sha256", required=True)

    unter.add_parser("selbsttest")

    args = p.parse_args(argv)
    if args.befehl == "selbsttest":
        return selbsttest()
    try:
        if args.befehl == "bauen":
            manifest = baue_manifest(args.daten_wurzel)
            selbst = schreibe_manifest(manifest, args.ziel)
            print("Orte      : " + ", ".join(
                "%s %d Blobs / %d B" % (o["name"], o["blobs"], o["bytes"])
                for o in manifest["orte"]))
            print("Gesamt    : %d Blobs / %d B"
                  % (manifest["gesamt"]["blobs"], manifest["gesamt"]["bytes"]))
            print("Methode   : " + manifest["pruefmethode"]["wie"])
            print("Durchsatz : %.1f MB/s in %.1f s"
                  % (manifest["pruefmethode"]["durchsatzMbProSekunde"],
                     manifest["pruefmethode"]["sekunden"]))
            print("Name!=Inhalt: %d von %d"
                  % (manifest["nameGegenInhalt"]["abweichend"],
                     manifest["nameGegenInhalt"]["geprueft"]))
            print("Manifest  : " + args.ziel)
            print("sha256    : " + selbst)
            return 0
        manifest = lade_manifest(args.manifest)
        bytes_ = pruefe_payload(manifest, args.sichtkasten, args.sha256)
        print("ok %s (%d B)" % (args.sha256, bytes_))
        return 0
    except BremsenBruch as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_STOPP if exc.sanktion == SANKTION_STOPP else EXIT_BEERDIGEN


if __name__ == "__main__":
    sys.exit(main())
