#!/usr/bin/env python3
"""F6-B6 - der Panel-Byte-Digest: Streaming-SHA-256 ueber die BYTES einer Datei.

Eingefroren angeordnet durch _COURT-F6-VOLLZUG-2026-08-31, Auflage F6-B6 (3:0):

    "Panel-Byte-Digest VOR der Anmeldung. Streaming-Hash ueber die Bytes mit
    einem benannten, reviewten, SQL-freien Werkzeug (Muster `sha256_datei`),
    dessen eigener SHA-256 mitgebunden wird; Ausfuehrung protokolliert (Pfad,
    Groesse, Zeit) und in `begruendung` beurkundet. Kein stiller Griff."

WAS DIESES WERKZEUG IST
-----------------------
Ein Hash ueber einen Bytestrom. Mehr nicht. Es oeffnet die Datei binaer, liest
sie in Bloecken und gibt einen SHA-256 aus. Es hat keinen Begriff von Tabellen,
Zeilen, Spalten, Firmen oder Werten - und kann deshalb keine sehen.

WARUM DAS KEIN "ERGEBNISDATEN LESEN" IST (V1, zum Zweitangriff)
---------------------------------------------------------------
`ledger:674` und R4 knuepfen an "Ergebnisdaten liest" an. Ein Streaming-SHA-256
macht keinen Wert, keine Zeile und keine Kennung sichtbar; die Ausgabe ist eine
Zahl fester Laenge, aus der nichts rekonstruierbar ist. Kipp-Bedingung KV-5
steht dagegen: zeigt jemand, dass der Byte-Digest doch unter R4 faellt, gilt der
Rueckfallpfad (Bindung der Eintrag-22-Anker + Pflicht-Nachattestierung nach dem
Lauf, jede Abweichung = Sofort-Stopp). Dieses Werkzeug entscheidet das nicht -
es macht den Griff nur SICHTBAR statt still.

DER WAECHTER PINNT DIE IMPORTLISTE, NICHT DEN KOMMENTAR (F6-B6, V3)
-------------------------------------------------------------------
`tests/studie-panel-digest.test.js` liest die Importe dieser Datei mit `ast`
aus dem Syntaxbaum - nicht mit einer Regex ueber den Quelltext, die ein
Kommentar taeuschen koennte - und haelt sie gegen eine POSITIVE Allowlist.
Jeder sechste Import macht ihn rot, `sqlite3` und jeder andere Parser mit einer
namentlichen Meldung. Ein Parser auf dem Panel-Pfad ist genau der stille Griff,
den F6-B6 verbietet.

DESHALB: DIESE FUENF IMPORTE UND KEINEN SECHSTEN.
Kein `json`, kein `csv`, kein `sqlite3`, kein `pickle`, kein `xml`. Wer hier
einen Parser ergaenzt, macht den Waechter rot - das ist die Absicht.

Aufruf:
  python scripts/studie-panel-digest.py --datei <pfad>
"""

import argparse
import hashlib
import os
import sys
import time

# 4 MiB - die Hausform aus scripts/studie-rr9-a2-nullpunkt-repro.py:132 und
# scripts/studie-e4d-kadenz.py:206. Gross genug, dass ein Mehr-GB-Panel nicht an
# der Blockzahl haengt, klein genug, dass nie mehr als ein Block im Speicher
# steht. Das Panel darf NIE am Stueck gelesen werden (Muster
# scripts/studie-endtest-versiegeln.js:46).
BLOCK = 1 << 22


class DigestAbbruch(Exception):
    """Ein benannter Abbruch. Ein halber Digest waere schlimmer als keiner:
    er wuerde als Byte-Beweis in einen Register-Eintrag wandern und dort eine
    Datei bezeugen, die so nie existiert hat."""


def sha256_datei(pfad, block=BLOCK):
    """Streaming-SHA-256 ueber die Bytes. Gibt (hexdigest, gelesene_bytes).

    Die gelesenen Bytes werden MITGEZAEHLT und nicht nachtraeglich per
    `os.path.getsize` erfragt: nur so faellt ein Kurzlesen auf. Ein Lesefehler,
    der stillschweigend weniger liefert, erzeugte sonst einen sauber
    aussehenden Hash ueber ein Fragment.
    """
    h = hashlib.sha256()
    gelesen = 0
    with open(pfad, "rb") as fh:
        for stueck in iter(lambda: fh.read(block), b""):
            h.update(stueck)
            gelesen += len(stueck)
    return h.hexdigest(), gelesen


def digest(pfad):
    """Der protokollierte Griff: Pfad, Groesse, Dauer, Hash (F6-B6)."""
    if not pfad:
        raise DigestAbbruch("Kein --datei angegeben.")
    if os.path.isdir(pfad):
        raise DigestAbbruch(
            "'" + str(pfad) + "' ist ein Verzeichnis, keine Datei. Ein Digest "
            "ueber ein Verzeichnis gibt es nicht.")
    if not os.path.isfile(pfad):
        raise DigestAbbruch(
            "'" + str(pfad) + "' existiert nicht oder ist keine regulaere "
            "Datei. Ein Byte-Digest ueber eine fehlende Datei ist kein Beweis, "
            "sondern eine Behauptung.")

    # Die Groesse VOR dem Lesen. Weicht sie hinterher von den gelesenen Bytes
    # ab, wurde waehrend des Laufs geschrieben oder gekuerzt - dann bezeugt der
    # Hash keinen definierten Zustand.
    gemeldet = os.path.getsize(pfad)
    start = time.monotonic()
    try:
        hexdigest, gelesen = sha256_datei(pfad)
    except OSError as fehler:
        raise DigestAbbruch(
            "Die Datei '" + str(pfad) + "' liess sich nicht vollstaendig "
            "lesen: " + str(fehler))
    dauer = time.monotonic() - start

    if gelesen != gemeldet:
        raise DigestAbbruch(
            "Kurzlesen: gemeldet " + str(gemeldet) + " Bytes, gelesen "
            + str(gelesen) + ". Der Hash bezeugt damit keinen definierten "
            "Dateizustand und darf nicht in einen Register-Eintrag.")

    return {"pfad": pfad, "groesse": gelesen, "dauer": dauer,
            "sha256": hexdigest}


def main(argv=None):
    p = argparse.ArgumentParser(
        description="F6-B6 - Streaming-SHA-256 ueber die Bytes einer Datei")
    p.add_argument("--datei", required=True,
                   help="Pfad der Datei, deren Bytes gehasht werden")
    a = p.parse_args(argv)

    # Fail-closed bis in die Ausgabe: bei einem Abbruch geht NICHTS nach
    # stdout. Ein Digest auf stdout ist ein Beweisangebot; ein halber Beweis
    # ist ein falscher Beweis.
    try:
        r = digest(a.datei)
    except DigestAbbruch as fehler:
        print("F6-PANEL-DIGEST-ABBRUCH: " + str(fehler), file=sys.stderr)
        return 1

    print("Pfad          : " + r["pfad"])
    print("Groesse       : " + str(r["groesse"]) + " Bytes")
    print("Dauer         : " + ("%.3f" % r["dauer"]) + " s")
    print("SHA-256       : " + r["sha256"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
