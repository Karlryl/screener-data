#!/usr/bin/env python3
"""E1-Panel, Stufe 2: der Vollscan — wie tief ist jeder Stand wirklich?

DIE FRAGE, DIE HIER BEANTWORTET WIRD
------------------------------------
R6 der Studien-Verfassung behauptete zuerst "+11 bis +30 % Fakten-Tiefe" fuer den
reprozessierten Stand. Beide bisherigen Messungen waren unbrauchbar:

  1. Korrektur 17.08.: die Aussage galt nur fuer 20 von 62 Quartalen; ueber alle
     gemessen -9,5 bis +46,9 %.
  2. Zweite Korrektur 17.08.: auch DIESE Zahlen waren verunreinigt, weil der neue
     Stand Sparten-Aufrisse enthaelt, der alte praktisch nicht — es wurden
     Konzernzahlen gegen Konzernzahlen PLUS Sparten verglichen.
  3. Dritte Korrektur 18.08. (Stufe 1, scripts/studie-panel-schema.py): die
     Praemisse der Reparaturvorschrift war falsch. Der neue Stand traegt eine
     EIGENE `segments`-Spalte; eine Hash-Rueckrechnung ist unnoetig, ein
     Spaltenfilter genuegt.

Diese Stufe misst deshalb zum ersten Mal SAUBER: Konzern gegen Konzern, ueber alle
63 paarweise vergleichbaren Quartale.

WAS GEZAEHLT WIRD — und warum getrennt
--------------------------------------
Je Payload vier Groessen, absichtlich NICHT zu einer "Tiefe" verrechnet:

  zeilen_gesamt      alle num.txt-Zeilen (die alte, verunreinigte Zaehlung —
                     mitgefuehrt, damit der Bruch zur alten Zahl sichtbar bleibt)
  zeilen_segment     Zeilen mit befuelltem Segment-Feld = Sparten-Aufrisse
  zeilen_coreg       Zeilen mit befuelltem coreg = Mit-Registrant (eine ANDERE
                     Firma, keine Sparte). Ob die aus der Konzern-Zaehlung
                     gehoeren, ist eine offene methodische Frage — deshalb wird
                     hier gezaehlt und NICHT entschieden.
  fakten_eindeutig   eindeutige (adsh, tag, ddate, qtrs) OHNE Segment. Das ist die
                     ehrliche Antwort auf "wie viele Kennzahl-Zeitpunkte traegt
                     dieser Stand" — Mehrfachbelegung derselben Groesse zaehlt
                     einmal.
  berichte           Zeilen in sub.txt = eingereichte Berichte.

Eine Kennzahl, deren Name nicht beschreibt, was sie zaehlt, ist auch dann
gefaehrlich, wenn sie einen Fehler aufdeckt — das ist die Lehre aus Korrektur 2
und der Grund fuer die getrennte Ausweisung.

INVARIANTEN
-----------
* READ-ONLY gegenueber dem versiegelten Sichtkasten: nichts entpackt auf Platte,
  nichts geschrieben, nichts geloescht, kein Netz. Gelesen wird stroemend aus dem
  ZIP.
* Wiederaufnehmbar: nach jedem Payload wird der Zwischenstand geschrieben. Ein
  Abbruch kostet hoechstens einen Payload, nicht den ganzen Scan.
* Ein unlesbarer Payload ist ein BEFUND und wird benannt — nie stumm uebersprungen.

Aufruf:
  python scripts/studie-panel-zaehlung.py --out reports/studie/E1-panel-zaehlung-<datum>.json
  python scripts/studie-panel-zaehlung.py --selftest
"""

import argparse
import json
import os
import sys
import time
import zipfile

SEGMENT_KANDIDATEN = ("segments", "coreg")


def blob_pfad(sichtkasten: str, sha256: str) -> str:
    return os.path.join(sichtkasten, "blobs", "sha256", sha256[:2], f"{sha256}.zip")


def zaehle_payload(zip_pfad: str) -> dict:
    """Stroemende Zaehlung ueber num.txt + sub.txt. Haelt nur die Fakten-Menge im Speicher."""
    with zipfile.ZipFile(zip_pfad) as z:
        vorhanden = {i.filename for i in z.infolist()}

        berichte = 0
        if "sub.txt" in vorhanden:
            with z.open("sub.txt") as fh:
                fh.readline()                                  # Kopfzeile
                for _ in fh:
                    berichte += 1

        if "num.txt" not in vorhanden:
            raise ValueError("num.txt fehlt im Archiv")

        with z.open("num.txt") as fh:
            kopf = fh.readline().decode("utf-8", "replace").rstrip("\r\n").split("\t")
            idx = {name: i for i, name in enumerate(kopf)}
            # 'segments' hat Vorrang: wo es existiert, ist es DAS Sparten-Feld.
            # 'coreg' ist der Mit-Registrant und wird getrennt gezaehlt.
            i_seg = idx.get("segments")
            i_cor = idx.get("coreg")
            i_adsh, i_tag = idx.get("adsh"), idx.get("tag")
            i_ddate, i_qtrs = idx.get("ddate"), idx.get("qtrs")

            zeilen = seg = cor = 0
            fakten = set()
            for roh in fh:
                f = roh.decode("utf-8", "replace").rstrip("\r\n").split("\t")
                zeilen += 1
                hat_seg = i_seg is not None and len(f) > i_seg and f[i_seg].strip() != ""
                hat_cor = i_cor is not None and len(f) > i_cor and f[i_cor].strip() != ""
                if hat_seg:
                    seg += 1
                if hat_cor:
                    cor += 1
                # Fakten-Menge: nur Konzern-Zeilen (kein Sparten-Aufriss).
                if not hat_seg and None not in (i_adsh, i_tag, i_ddate, i_qtrs) \
                        and len(f) > max(i_adsh, i_tag, i_ddate, i_qtrs):
                    fakten.add((f[i_adsh], f[i_tag], f[i_ddate], f[i_qtrs]))

    return {
        "segmentfeld": "segments" if i_seg is not None else ("coreg" if i_cor is not None else None),
        "zeilen_gesamt": zeilen,
        "zeilen_segment": seg,
        "zeilen_coreg": cor,
        "zeilen_konzern": zeilen - seg,
        "fakten_eindeutig": len(fakten),
        "berichte": berichte,
    }


def scan(sichtkasten: str, schema_json: str, out: str, grenze: int | None = None) -> dict:
    with open(schema_json, encoding="utf-8") as fh:
        payloads = json.load(fh)["payloads"]

    # Wiederaufnahme: was schon gezaehlt ist, wird nicht neu gelesen.
    stand = {"payloads": {}, "fehler": []}
    if os.path.exists(out):
        with open(out, encoding="utf-8") as fh:
            stand = json.load(fh)
    fertig = stand["payloads"]

    offen = [p for p in payloads if p["sha256"] not in fertig]
    print(f"{len(fertig)} bereits gezaehlt, {len(offen)} offen.")
    if grenze:
        offen = offen[:grenze]

    for n, p in enumerate(offen, 1):
        zp = blob_pfad(sichtkasten, p["sha256"])
        start = time.time()
        try:
            e = zaehle_payload(zp)
        except Exception as ex:                                # noqa: BLE001
            stand["fehler"].append({"quartal": p["quartal"], "variante": p["variante"],
                                    "sha256": p["sha256"], "grund": str(ex)})
            print(f"  [{n}/{len(offen)}] {p['quartal']} {p['variante'][:20]} FEHLER: {ex}")
            continue
        e["quartal"], e["variante"] = p["quartal"], p["variante"]
        fertig[p["sha256"]] = e
        print(f"  [{n}/{len(offen)}] {p['quartal']} {p['variante'][:24]:26s} "
              f"Zeilen {e['zeilen_gesamt']:>9,} Sparten {e['zeilen_segment']:>9,} "
              f"Fakten {e['fakten_eindeutig']:>9,} ({time.time()-start:.0f}s)")
        # Nach JEDEM Payload sichern — ein Abbruch kostet hoechstens diesen einen.
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(stand, fh, ensure_ascii=False, indent=1)

    return stand


def selftest() -> int:
    import tempfile
    ok = fehl = 0

    def pruefe(name, bedingung):
        nonlocal ok, fehl
        if bedingung:
            ok += 1; print(f"  ok   {name}")
        else:
            fehl += 1; print(f"  FAIL {name}")

    with tempfile.TemporaryDirectory() as tmp:
        zp = os.path.join(tmp, "t.zip")
        with zipfile.ZipFile(zp, "w") as z:
            z.writestr("sub.txt", "adsh\tcik\n1\t9\n2\t8\n")
            # 5 Zeilen: 2 mit segments, 1 mit coreg, eine Dublette auf demselben
            # (adsh,tag,ddate,qtrs) -> Fakten muessen 2 sein, nicht 3.
            z.writestr("num.txt",
                       "adsh\ttag\tsegments\tcoreg\tddate\tqtrs\tvalue\n"
                       "1\tRev\t\t\t20130331\t1\t100\n"
                       "1\tRev\t\t\t20130331\t1\t100\n"
                       "1\tRev\tSparte=A\t\t20130331\t1\t40\n"
                       "1\tRev\tSparte=B\t\t20130331\t1\t60\n"
                       "2\tCost\t\tTochter\t20130331\t1\t7\n")
        e = zaehle_payload(zp)
        pruefe("Zeilen gesamt gezaehlt", e["zeilen_gesamt"] == 5)
        pruefe("Sparten-Zeilen erkannt", e["zeilen_segment"] == 2)
        pruefe("coreg getrennt gezaehlt", e["zeilen_coreg"] == 1)
        pruefe("Konzern-Zeilen = gesamt minus Sparten", e["zeilen_konzern"] == 3)
        pruefe("Dublette zaehlt EINMAL (2 statt 3 Fakten)", e["fakten_eindeutig"] == 2)
        pruefe("Berichte aus sub.txt", e["berichte"] == 2)
        pruefe("Segmentfeld benannt", e["segmentfeld"] == "segments")

        # BRUCHPROBE: Sparten-Zeilen duerfen NICHT in die Fakten. Waeren sie drin,
        # kaeme 4 heraus — genau der Fehler, den Korrektur 2 aufdeckte.
        pruefe("Sparten-Aufrisse sind NICHT in der Fakten-Menge",
               e["fakten_eindeutig"] != 4)

        # BRUCHPROBE: Alt-Format ohne segments-Spalte darf nicht abstuerzen.
        zp2 = os.path.join(tmp, "alt.zip")
        with zipfile.ZipFile(zp2, "w") as z:
            z.writestr("sub.txt", "adsh\n1\n")
            z.writestr("num.txt", "adsh\ttag\tcoreg\tddate\tqtrs\tvalue\n1\tRev\t\t20130331\t1\t5\n")
        e2 = zaehle_payload(zp2)
        pruefe("Alt-Format ohne segments-Spalte laeuft durch",
               e2["zeilen_segment"] == 0 and e2["fakten_eindeutig"] == 1)
        pruefe("Alt-Format meldet coreg als Segmentfeld", e2["segmentfeld"] == "coreg")

        # BRUCHPROBE: fehlendes num.txt MUSS werfen, nicht 0 melden.
        zp3 = os.path.join(tmp, "leer.zip")
        with zipfile.ZipFile(zp3, "w") as z:
            z.writestr("sub.txt", "adsh\n1\n")
        try:
            zaehle_payload(zp3); pruefe("fehlendes num.txt wirft", False)
        except ValueError:
            pruefe("fehlendes num.txt wirft (statt 0 zu melden)", True)

    print(f"\nstudie-panel-zaehlung selftest: {ok} ok, {fehl} fail")
    return 0 if fehl == 0 else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--sichtkasten", default=os.path.join(
        os.path.expanduser("~"), "Documents", "GrowthScreenerResearchData",
        "early-detection-v4-sealed127"))
    p.add_argument("--schema", default="reports/studie/E1-panel-schema-2026-08-18.json")
    p.add_argument("--out", default="reports/studie/E1-panel-zaehlung-2026-08-18.json")
    p.add_argument("--grenze", type=int, help="nur die ersten N offenen Payloads (Probelauf)")
    p.add_argument("--selftest", action="store_true")
    a = p.parse_args()

    if a.selftest:
        return selftest()

    stand = scan(a.sichtkasten, a.schema, a.out, a.grenze)
    print(f"\nGezaehlt: {len(stand['payloads'])} Payloads, {len(stand['fehler'])} Fehler.")
    return 1 if stand["fehler"] else 0


if __name__ == "__main__":
    sys.exit(main())
