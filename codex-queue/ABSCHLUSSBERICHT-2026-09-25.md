# Abschlussbericht Codex-Dauerlauf 2026-09-25 (ca. 07:05–08:50 Ortszeit, Ende durch Codex-Wochenlimit)

Geprueft von Claude um 12:10 Ortszeit gegen GitHub (PR-Liste, Check-Runs, Job-Logs) und die Log-Branches
`codex/log/L2..L8-20260925`. L1 hat keinen Log-Branch gepusht. Die Logs enden beim letzten Stundenspiegel (~08:20);
alles danach ist nur aus PRs und Branches rekonstruiert.

## AUF EINEN BLICK
- 27 neue PRs (14 screener-data, 13 findash) plus 1 Fix auf einem PR von gestern. Nichts gemerged; `main`/`master` unveraendert.
- screener-data: 13 von 14 neuen PRs CI-gruen, S18 (#360) repariert und gruen; rot bleiben S26 (#361, unangetastet) und S58 (#376, Draft).
- findash: auf GitHub lief kein einziger Test. Jeder Unit-Job bricht vor dem Start ab: „recent account payments failed OR spending limit needs increasing".

## 1. screener-data

| PR | Task | Lane | CI `test-gate` | Bemerkung |
|---|---|---|---|---|
| #363 | S50 | L3 | gruen | SEC-XBRL relative Redirects |
| #364 | S12 | L2 | gruen | atomic-write / HTTPS-Naehte offline |
| #365 | S11 | L2 | gruen | ZIP64 + SEC-PIT-Fehlerpfade |
| #366 | S44 | L4 | gruen | Laufzeit-Harness |
| #367 | S08 | L4 | gruen | k-Drift-Schlusssatz gepinnt |
| #368 | S48 | L4 | gruen | `lib/md-table.js` |
| #369 | S40 | L4 | gruen | Heartbeat-Schwellen validiert |
| #370 | S16 | L2 | gruen | 25 Existenz-Checks -> Inhalt; Stapel auf S14 (#359) |
| #371 | S57 | L3 | gruen | d2-submissions-bulk Stromfehler |
| #372 | S51 | L3 | gruen | Earnings-Env-Integer |
| #373 | S42 | L3 | gruen | fetch-secbulk Backpressure |
| #374 | S55 | L2 | gruen | Nebenlaeufigkeits-Test atomic-write |
| #375 | S02 | L2 | gruen | gekuerzt nach Audit |
| #376 | S58 | L3 | **rot**, Draft | CI: `sec-pit-check` 2 FAIL, `tests/druckenmiller/import-graph.test.js`, `tests/t204-wave5-atomic-write.test.js` |
| #360 | S18 | L1 | gruen (vorher rot) | Nachkommit 839d3e2: versiegelte lib-Quellen zurueckgesetzt, Waechter meldet sie |
| #361 | S26 | L1 | **rot** | kein neuer Commit; Ursache siehe PLAN-2026-09-25 Abschnitt 2 |

Beansprucht, aber ohne Commit auf GitHub: S32, S54, S60, S61 (Branch zeigt auf `main`). S54 liegt laut L2-Log als lokaler Commit
auf Karls Rechner („held locally for commit metadata correction").
Nicht erledigt: PRs fuer die 12 `claude/S*`-Branches, Merge-Reihenfolge-Doku screener-data, S04.

## 2. findash

| PR | Task | Lane | lokal laut Log | Bemerkung |
|---|---|---|---|---|
| #58 | F27 (Claude-Branch) | L8 | 1 rot im Nachlauf | `test/dl-aofd001-lock-zukunftszeit.test.js:51`: 503 nach 2.283 ms gegen 2.000-ms-Frist; Test und `file-lock.js` byte-gleich zu master |
| #59 | F03 (Claude-Branch) | L8 | alle 7 Gates gruen | |
| #60 | F28 (Claude-Branch) | L8 | gruen | 9 falsche README-Env-Zeilen korrigiert |
| #61 | F17 | L6 | gruen | 143 Tests neu, 3 `Object.hasOwn`-Wachen |
| #62 | F23 | L5 | gruen | Cache-Wurzel ohne Objekt = Miss |
| #63 | F12 | L6 | 2 rot, beide auf master vorhanden | Lock-Test (s. o.) und M8-Watchdog 200 vs. 201 Minuten |
| #64 | F10 | L5 | Draft nach 2 Anlaeufen | Mutations-Probe: `cnnComponents`/`calendar` ueberleben |
| #65 | F18 | L6 | nach Log-Ende | |
| #66 | F32 | L5 | gruen | rename-Retry deterministisch |
| #67 | F40 | L8 | Browser 555 gruen / 7 rot | die 7 roten Specs hat F40 nicht angefasst (BFCACHE-Timeouts, overview-quote-cache, Screener-Tooltip) |
| #68 | F19 | L6 | Review 98 % | |
| #69 | F72 (Claude-Branch) | L8 | nach Log-Ende | |
| #70 | F53 | L6 | nach Log-Ende | |

Ohne PR abgeschlossen: F04 (alle 41 data-layer-Module sind bereits getestet, Praemisse veraltet) und F07
(`web/package-lock.json` ist synchron, `npm ci` laeuft; Praemisse vom 24.09. nicht reproduziert).
Beansprucht ohne Commit auf GitHub: F11, F13, F24, F35, F36, F55, F79, F80. Lokal auf Karls Rechner laut Log:
F13 Batch 1+2 (Commits fa7c15f, 3ae946a) und F24 (Commit mit Metadaten-Fehler).

## 3. Befunde, die Karl kennen muss
1. **findash-CI blockiert durch GitHub-Billing.** Wortlaut der Annotation (3 Jobs einzeln geprueft von L5/L6/L8): „recent account
   payments failed OR spending limit needs increasing; check Billing & plans". Alle 13 findash-PRs haben keinen echten CI-Lauf.
   Actions-Minuten-Abfrage lieferte HTTP 404 (Token-Scope).
2. **Codex-Laufzeit erlaubt 4 Agenten je Chat inklusive Koordinator**, also 3 Subagenten statt der geplanten 8 (alle 7 Logs).
   Ueber 8 Chats waren damit hoechstens 24 Subagenten gleichzeitig moeglich, nicht 50.
3. **Codex-Wochenlimit**: L8 meldet um 08:03 „68 % used", Start bei 24 %. Das Limit war nach rund 1 h 45 min aufgebraucht.
4. Zwei zeitabhaengige findash-Tests sind auf master wacklig (Lock-Frist 2.000 ms, M8-Watchdog 200/201 Minuten). Beide stoeren jeden
   lokalen Voll-Lauf; Ursache nicht bewiesen.
5. Zwei Queue-Praemissen vom 24.09. waren falsch (F04, F07) — Queue-Tasks vor dem Start gegen den Code pruefen.

## 4. Offen fuer den naechsten Lauf
- Karl: Billing pruefen, sonst bleibt jeder findash-PR ohne CI.
- Karl: lokal liegende Commits (F13 Batch 1–2, F24, S54) pushen lassen oder verwerfen.
- Leere Claim-Branches (S32 S54 S60 S61, F11 F13 F24 F35 F36 F55 F79 F80) blockieren den Claim-Mechanismus: im naechsten Prompt
  als „Claim ohne Commit = frei" definieren. Loeschen nur mit Karls OK.
- L1-Aufgaben nachholen: #361 (S26) fixen, 12 `claude/S*`-PRs, Merge-Reihenfolge screener-data.
- #376 (S58): drei rote Test-Dateien in CI, Ursache im PR (L3).
