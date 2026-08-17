# E1(a): Der Payload-Filter ist geschlossen

**Datum:** 2026-08-17 · **Protokoll:** FEM-SEC-US@2.0.0 · **Zweig:** `studie/e1-datenbasis`
**Werkzeug:** `scripts/early-detection-sealed-view.py`
**Kein Siegel angefasst.** Die drei hash-gepinnten Bau-Skripte und alle Artefakte unter
`protocol/early-detection/2.0.0/` sind byte-unveraendert.

---

## Was geschlossen wurde

Der Daten-Vertrag fuehrte seit dem 16.08. eine offene Luecke:

> „Ohne Payload-Filter erzeugt Schritt 2 eine Obermenge (der Speicher enthaelt inzwischen
> mehr akzeptierte Beobachtungen als die versiegelte Datenbank). […] der Filter selbst ist
> eine benannte E1-Aufgabe."

Diese Luecke ist geschlossen.

## Wie — und warum nicht anders

**Nicht** durch eine Option im Bau-Skript. `scripts/early-detection-pit-compact.py` steht mit
seiner sha256 `48fb6661…` im Daten-Vertrag; jede Aenderung haette den Vertrag zur Luege
gemacht.

**Sondern** durch einen **Sichtkasten**: ein eigenes Verzeichnis, das nur die 127 versiegelten
Beobachtungen und deren Roh-Payloads enthaelt. Das gepinnte Skript liest seinen Speicher
vollstaendig ueber `--data-root` (STORE.json, `observations/sec-fsd/*.json`, dann je
Beobachtung den Blob unter ihrem relativen `payloadPath`) — ein solches Verzeichnis ist fuer
es ununterscheidbar von einem echten Speicher und kann die Obermenge gar nicht enthalten.

**Erlaubnisliste, keine Sperrliste.** Am 17.08. lagen im Speicher **183** Beobachtungen:
127 versiegelte, 51 aus der Herkunfts-Schliessung bekannte, und **5 Neuzugaenge**
(2025q1–2026q1), die in keiner Liste stehen. Ein Filter, der „die bekannten 51 ausschliesst",
haette heute **132 statt 127** importiert — stille Kontamination, die niemandem aufgefallen
waere. Deshalb wird positiv auf die 127 Pruefsummen geschlossen und alles andere
ausgeschlossen, egal wie der Speicher weiter waechst.

**Kein Voll-Neubau als Nachweis.** Die versiegelte Datenbank ist eine deterministische
Funktion aus (Payload-Menge x gepinnte Skripte). Der Filter aendert ausschliesslich die
**Eingangsmenge** — und Mengengleichheit beweist man auf Mengen-Ebene. Der Voll-Neubau bleibt
das finale Gate fuer den Tag, an dem die Datenbank wirklich gebraucht wird (Rezept-Schritte
3+4 gegen `logicalEvidenceSha256`).

---

## Woran das verifiziert ist

| Schritt | Ergebnis |
|---|---|
| 1. Selbsttest (Mini-Speicher im Temp-Verzeichnis) | **gruen** — 1 von 2 Beobachtungen uebernommen, die Obermenge blieb draussen |
| 1a. Sabotage: eine Beobachtung zu viel | **benannt** |
| 1b. Sabotage: ein Byte im Payload gekippt | **benannt** |
| 1c. Sabotage: Vertrags-Selbstdigest und Mengen-Pruefsumme verfaelscht | **beide brechen ab** |
| 2. Bau-Skript unveraendert? | sha256 `48fb6661756c3c75…` — **identisch mit dem Vertrag** |
| 3. Sichtkasten gebaut | **127 Payloads**, 127 verknuepft, 0 kopiert, jeder gegen seinen versiegelten Hash nachgerechnet |
| 4. `verify` | **PASS** — 127 Beobachtungen, keine einzige zu viel |
| 5. **Gruene Probe** 2009q1 gegen den Sichtkasten | `verify-db` **PASS** |
| 6. **Bruchprobe** 2009q1 gegen den ROH-Speicher | `verify-db` **FAIL**, benennt den Eindringling: `FREMDER Payload in der Datenbank: b523831003d78e84 (2009q1) — steht nicht in der Herkunfts-Schliessung` |

Schritt 6 ist der eigentliche Beweis: Ohne Sichtkasten importiert dasselbe Skript im selben
Quartal **drei** statt zwei Payloads, und der Waechter sagt genau, welcher zu viel ist. Ein
Filter, dessen Fehlen nicht auffaellt, waere kein Filter.

**Platzbedarf: null.** Die 7 GB Roh-Payloads sind per Hardlink verknuepft, nicht kopiert. Die
Gueltigkeit haengt aber an keinem Link: jeder Blob im Sichtkasten wird nach dem Verknuepfen
**erneut gehasht**, und wenn Verknuepfen scheitert, wird kopiert (R12a — kein
Betriebssystem-Kunstgriff als Gueltigkeitsbedingung).

**Quittung.** Der Sichtkasten traegt `VIEW.json`: Payload-Zahl, Mengen-Pruefsumme
`c861d255…`, Vertrags-Digest `aebe2093…`, verknuepft/kopiert je Blob, Python-Version,
Plattform und den **Selbst-Hash des Werkzeugs**. Ein spaeterer Lauf kann damit sagen, womit
der Kasten gebaut wurde.

---

## Was das fuer E1 bedeutet

- **(a) Payload-Filter — erledigt.**
- (b) Drei Fenster-Dateien mit verschluesseltem Endtest — offen.
- (c) Vintage-Regel nach dem 8-K-Befund — **Vorarbeit liegt** (siehe
  `E1-datenbasis-inventar-2026-08-17.md` und den Abdeckungs-Report), die Regel selbst offen.
- (d) Abdeckungs-Report — **gemessen**, mit einem schweren Befund gegen R6 (eigener Bericht).
- (e) Fallzahl-Vorschau nach R15a — offen; die Firmenzahlen je Jahr liegen jetzt vor.

## Folgefragen (R16)

1. Wann wird der Sichtkasten neu gebaut? Er ist ein abgeleitetes Verzeichnis; waechst der
   Speicher, bleibt er gueltig (Erlaubnisliste), aber `verify` sollte vor jedem Import laufen.
   Vorschlag: `verify` als Pflichtschritt vor jedem Import-Haeppchen, `verify-db` danach.
2. Soll `VIEW.json` zusaetzlich in die Vorwaerts-Mitschrift eingetragen werden? Dafuer
   spricht, dass die Mitschrift sonst nicht weiss, auf welchem Substrat gerechnet wurde.
   Aufwand: eine Zeile in `scripts/studie-mitschrift.js`, halber Tag mit Wachtest.
