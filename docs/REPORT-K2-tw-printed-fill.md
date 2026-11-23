# K2-TW: Vorjahresquartal für Taiwan aus dem MOPS-Bericht belegt

> **Auf einen Blick**
> Am Datentag 21.11.2026 füllt der neue Weg **27 Quartale Q3 2025** bei Taiwan-Aktien, die bisher nur am fehlenden Juli-Stand (`no-baseline`) scheiterten; **24** davon zeigen jetzt Q3 2026 statt Q2 2026, und alle 24 Wachstumswerte treffen das Wachstum aus den beiden MOPS-Zahlen auf 0,01 Prozentpunkte.
>
> - Taiwan-Zeilen nach gezeigtem Zeitraum (286 Snapshots): Q3 2026 **197 → 221**, Q2 2026 **56 → 32**, alles andere unverändert. Mit Schalter aus sind alle 286 Taiwan-Snapshots und alle Boards bytegleich mit dem heutigen Code.
> - Boards (feste Kalibrierung, Nachtrag 23.11.): 2464.TW Industrie unprofitabel 42 → 11, 3563.TW Halbleiter profitabel 47 → 9, 2421.TW Industrie profitabel 57 → 38, 4919.TW Halbleiter unprofitabel 51 → 49; neu in der Top-Liste Halbleiter profitabel 2455.TW (74) und 2441.TW (75), heraus 8016.TW und 300236.SZ. Keine Zeile außerhalb Taiwans ändert ihren Score.

Stand 22.11.2026, gemessen auf dem Datentag 21.11.2026, Zählebene Ticker. Gebaut von einem Claude-Opus-Helfer (Codex war leer), gestapelt auf PR #140. Der Schalter `printedQ3CheckTw` steht im Arbeitsstand auf `true`; live geht er erst nach der Prüfung durch die andere KI.

## 1. Was sich ändert

Bisher füllte `lib/exchange-quarter-check.js` ein fehlendes Taiwan-Quartal Q3 2025 nur, wenn die Firma im Board-Stand vor dem 01.08.2026 (Juli-Stand, `board-history/2026-07-29`) stand. Der Juli-Stand belegt, dass die Zahlen des Datenanbieters für 2025 seitdem gleich geblieben sind. Fehlte die Firma dort oder ihr Quartal 2025 (so bei 2441.TW und 2633.TW), blieb die Füllung mit `no-baseline` gesperrt, obwohl die Prüfung schon verlangte, dass der MOPS-Bericht zu Q3 2026 das Vorjahresquartal selbst abdruckt.

Neu gilt dieser Abdruck als Beleg, dass Vorjahres- und aktuelles Quartal auf derselben Grundlage stehen, genau wie beim CNINFO-Beleg für China (PR #140). Gefüllt wird nur, wenn alle drei Bedingungen gelten (die zweite ist im heutigen Betrieb immer erfüllt, weil der Speicher den eingefüllten Wert schon aus diesem Abdruck ableitet; sie schließt die Füllung, falls sich die Ableitung je ändert):

- Die MOPS-Saison 115Q3 (Bericht zum 3. Quartal 2026) liegt im Speicher und druckt in der Zeile 營業收入合計 die Spalte 114年第3季.
- Dieser gedruckte Wert stimmt mit dem eingefüllten MOPS-Einzelquartal überein (bisherige Toleranz 0,1 %, mindestens 500 TWD).
- Die Saison wurde spätestens am Tag des Snapshots zum ersten Mal abgerufen. Ein Rückblick auf einen alten Datentag benutzt also keinen Beleg, der damals noch nicht da war.

Eingefüllt wird die Zahl, die der Speicher schon heute ableitet, also das MOPS-Einzelquartal; die Ableitung heißt weiter `printed-quarter`. Alle anderen Sperren bleiben unverändert (etwa `vendor-2025-changed`, `baseline-quarter-missing`, `restatement-signal`, Speicheralter). Fehlt die Saison (`no-printed-report`), kam sie zu spät (`read-after-snapshot`) oder weicht der Abdruck ab (`fill-value-differs-from-print`), bleibt es bei `no-baseline`.

Der Begründungstext am Wert nennt MOPS, die Saison und die Stelle im Bericht, etwa bei 1434.TW:

> Umsatz 3. Quartal 2025 fehlte beim Datenanbieter und stammt aus der Börsenmeldung (MOPS, abgerufen 08.11.2026). Die Firma druckt diesen Wert selbst als Vorjahresquartal im MOPS-Bericht zum 3. Quartal 2026 (Saison 115Q3), Zeile 營業收入合計, Spalte 114年第3季 (6,505,738 Tausend TWD).

**Eigener Schalter:** `printedQ3CheckTw` in `configs/exchange-quarter-policy.json`, getrennt von `printedQ3Check` (China). So lässt sich Taiwan zurückschalten, ohne den China-Weg anzufassen, und umgekehrt; die Tests prüfen beide Richtungen. `false` stellt das heutige Verhalten exakt her.

## 2. Vorher/Nachher am 21.11.

Gleiche Eingaben in allen drei Armen: 15.769 Snapshots aus dem Zwischenspeicher des Laufs vom 21.11., Juli-Stand `board-history/2026-07-29`, MOPS-Speicher `external-data/exchange-quarters/tw.json` unverändert, derselbe Produktionsweg `prepareSnapshot`, Uhr 21.11.2026 11:22:31 UTC, jeder Arm mit eigener Kalibrierung wie im Tageslauf. Arm „heute“ ist der Code vor dieser Änderung, Arm „aus“ der neue Code mit Schalter aus: beide gleich (Digest der 286 vorbereiteten Taiwan-Snapshots `c2820f11…`, Digest aller Boards `e2141939…`).

| Gezeigter Wachstumszeitraum der 286 Taiwan-Aktien | Vorher | Nachher |
|---|---:|---:|
| Q3 2026 | 197 | **221** |
| Q2 2026 | 56 | **32** |
| Geschäftsjahr 2025 | 25 | 25 |
| Q1 2026 | 7 | 7 |
| kein Wachstum | 1 | 1 |

Füllungen von Q3 2025: Juli-Weg unverändert **44**, neu **27**. Die Sperre `no-baseline` kam vorher 27-mal vor und kommt nachher nicht mehr vor; alle anderen Sperren zählen gleich. Genau 24 Firmen ändern ihr Wachstum, alle mit neuer Füllung. Bei den übrigen 3 (1773.TW, 3006.TW, 3035.TW) endet die Reihe des Datenanbieters noch bei Q2 2026; die Füllung schließt dort nur die Lücke in der Reihe, das gezeigte Wachstum bleibt gleich.

Gegenprobe: Bei allen 27 ist die Zahl aus dem ursprünglichen MOPS-Bericht zu Q3 2025 (Saison 114Q3) identisch mit dem Vorjahreswert, den der Bericht zu Q3 2026 druckt. Bei allen 24 sichtbaren Änderungen ist das neue Wachstum gleich dem Wachstum aus den beiden MOPS-Zahlen (größte Abweichung kleiner als 0,000001 Prozentpunkte). Erster Abruf der Saison 115Q3 lag zwischen 25.10. und 12.11., also vor allen Snapshot-Tagen.

Die Diagnose vom 22.11. nannte 26 Zeilen; sie zählte Board-Zeilen mit veraltetem Zeitraum. Auf den Snapshots gemessen sind es 27 Firmen, von denen 24 sichtbar wechseln.

### Board-Zeilen

| Board | Top 50 rein / raus | Rangänderungen |
|---|---|---:|
| HyperGrowth Industrie profitabel | 2421.TW / 6532.T | 829 |
| HyperGrowth Halbleiter unprofitabel | 4919.TW / 0600.HK | 7 |
| HyperGrowth Gesundheit unprofitabel | MEDANTA.NS / BBIO | 22 |
| sechs weitere HyperGrowth-Listen | keine | 1.510 |
| Rule of 40 | keine | 237 |

Die Wechsel in Gesundheit unprofitabel betreffen keine Taiwan-Firma; sie folgen aus der neuen Kalibrierung. In Rule of 40 kommt 3563.TW neu auf die Liste (Rang 378), 8016.TW fällt heraus (vorher Rang 467, Wachstum jetzt 25,64 %). Größte Bewegungen der gefüllten Firmen: 9933.TW Industrie profitabel 1.431 → 371, 3211.TWO 329 → 1.004, 2441.TW Halbleiter profitabel 181 → 75, 2455.TW 157 → 74, 6271.TW 249 → 128, 2464.TW Rule of 40 441 → 232.

## 3. Fünf Belege

Zum Wiederfinden auf MOPS (Gewinn- und Verlustrechnung `t164sb04`, Jahr 115, Saison 3): Zeile 營業收入合計, Spalten 115年第3季 und 114年第3季, Beträge in Tausend TWD.

| Ticker | Wachstum vorher (Q2 2026) | Wachstum nachher (Q3 2026) | MOPS 115年第3季 | MOPS 114年第3季 (gefüllt) | Board |
|---|---:|---:|---:|---:|---|
| 2464.TW | 32,56 % | **71,38 %** | 2,789,153 | 1,627,461 | HyperGrowth Industrie unprofitabel 42 → 11 |
| 3563.TW | 8,10 % | **42,35 %** | 1,092,135 | 767,206 | HyperGrowth Halbleiter profitabel 47 → 9 |
| 2421.TW | 16,20 % | **24,48 %** | 6,142,510 | 4,934,408 | HyperGrowth Industrie profitabel 57 → 38 |
| 4919.TW | 1,61 % | **8,03 %** | 7,856,135 | 7,272,079 | HyperGrowth Halbleiter unprofitabel 51 → 49 |
| 2441.TW | 22,28 % | **41,10 %** | 5,998,024 | 4,250,756 | HyperGrowth Halbleiter profitabel 181 → 75 |

Beispiel 2464.TW: 2.789.153 / 1.627.461 − 1 = 71,38 %, gleich dem neuen Board-Wert.

## 4. Tests

- `tests/exchange-quarter-check.test.js`: 53 grün, davon vier neue Taiwan-Tests (übereinstimmender Abdruck füllt mit Begründungstext; fehlende, zu späte oder abweichende Abdrucke füllen nicht, andere Sperren sperren weiter; Schalter aus stellt das alte Ergebnis bytegleich her, der China-Schalter steuert Taiwan nicht und umgekehrt). Absichtlich rot gemacht: die Übereinstimmungsprüfung und die Abruftag-Prüfung (Speicherkopien, nie die Live-Datei).
- GQS-00: Der neue Hash von `lib/exchange-quarter-check.js` steht in `protocol/gqs-00/1.2.0-pending/transition.json` (Eintrag `k2TwPrintedFill20261122`); `tests/scoring/gqs00-freeze.test.js` und `tests/jsdoc-exports.test.js` grün.
- Alle 301 Testdateien, die einen geänderten Baustein laden, liefen mit `node <Datei>`: 297 grün. Rot sind nur die vier bekannten lokalen Fälle `tests/yahoo-q4-known-cases.test.js` (nur `.probe-unrouted.js`), `tests/rev-growth-basis.test.js`, `tests/export-w8-profit-split.test.js` und `tests/scoring/calibration-ref.test.js`.

## 5. Grenzen und offene Punkte

- Solange der Speicher für Q3 2025 den Vorjahreswert des neueren Berichts bevorzugt (`taiwanSingleQuarters`), ist der eingefüllte Wert genau dieser Abdruck; die Übereinstimmung gilt dann von selbst. Die Prüfung sichert, dass die Füllung schließt, falls sich die Ableitung je ändert. Den eigentlichen Beleg liefert, dass Wert und laufendes Quartal aus demselben amtlichen Bericht stammen (Sicherheit, dass das trägt: 90 %).
- Der Begründungstext zitiert den Betrag in der Schreibweise von MOPS (Tausenderkommas) und nennt danach die deutsche Lesart, etwa „gedruckt „767,206“ in Tausend TWD, also rund 767,2 Mio. TWD“, dazu das Jahr der taiwanischen Zählung (115 = 2026). Live auf der MOPS-Seite nachgesehen wurde die Schreibweise nicht (Sicherheit 85 %).
- Die 32 Taiwan-Zeilen, die weiter Q2 2026 zeigen, haben andere Ursachen: Bei den meisten liefert der Datenanbieter Q3 2026 noch nicht (Diagnose Abschnitt 2, Mechanismus B), dazu kommen zu alte MOPS-Abrufe und geänderte Anbieterwerte für 2025. Dieser Auftrag ändert daran nichts.
- Der Begründungstext wurde nach dem Bau von „gleich abgegrenzt“ auf einen Satz ohne Fachbegriff umgestellt; Zahlen und Füllungen sind davon nicht betroffen, nur die Prüfsumme im GQS-00-Übergang wurde nachgezogen.
- 3264.TWO und 8039.TW haben ein im Juli bestätigtes Quartal 2025 und bleiben trotzdem gesperrt (andere Sperre als `no-baseline`); der neue Weg greift für sie nicht. Das ist eine Schieflage gegenüber Firmen ohne Juli-Stand, aber keine falsche Zahl.
- Der Abruftag wird als Kalendertag verglichen: Eine Saison, die am Snapshot-Tag erst nach dem Snapshot gelesen wurde, zählt als rechtzeitig. Im Tageslauf ist das ohne Wirkung; nur eine Nachrechnung mit neuerem Speicher könnte so einen Beleg benutzen, den es am Snapshot-Zeitpunkt noch nicht gab.

## 6. Nachtrag 23.11.2026 nach der blinden Opus-Prüfung

Urteil APPROVE MIT AUFLAGEN (85 %). Umgesetzt: Begründungstext mit deutscher Lesart des Betrags und Jahr der taiwanischen Zählung (M2); Tageslauf-Erwartungen für 2464.TW und 3563.TW (M1); Absichtlich-rot-Prüfungen erkennen einen fehlenden Anker (N3); drei neue Tests für Lesung am Snapshot-Tag, fehlende erste Lesung und Vorrang von `asOf` (N4); Board-Ränge mit fester Kalibrierung neu gemessen (N6, oben eingetragen). Welche Zellen gefüllt werden, ändert sich dadurch nicht. `tests/exchange-quarter-check.test.js` 54 grün.
