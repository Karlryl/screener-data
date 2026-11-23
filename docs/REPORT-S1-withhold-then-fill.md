# S1: A-Aktien mit abweichendem Vorjahresquartal zurückhalten und auffüllen

> **Auf einen Blick**
> Am Datentag 21.11.2026 zeigen **12 A-Aktien** ihr Umsatzwachstum jetzt für Q3 2026 statt für das Geschäftsjahr 2025: Der falsche Q2-2025-Wert des Datenanbieters wird mit Hinweis ausgeblendet und das fehlende Q3 2025 aus der Börsenmeldung (Eastmoney) gefüllt, aber nur, wenn der CNINFO-Bericht zum 3. Quartal 2026 den Wert bestätigt. Alle 12 treffen das dort gedruckte Q3-Wachstum auf höchstens 0,014 Prozentpunkte.
>
> - Top-Listen: 000880.SZ (Industrie profitabel) steigt von Rang 67 auf 39, 600150.SS (Industrie profitabel) fällt von 64 auf 185 und damit heraus (93,4 % → 13,9 %), dafür kommt 688392.SS auf Rang 100; 000564.SZ (Zyklischer Konsum unprofitabel) 71 → 68.
> - Feste Kalibrierung: Keine andere Board-Zeile ändert ihren Score. Mit Schalter aus sind alle Boards identisch mit dem Code vorher (nur `generated_at` verschieden).

Stand 23.11.2026, gemessen auf dem Datentag 21.11.2026, Zählebene Ticker. Gebaut von Claude (Opus), Codex war leer; gestapelt auf PR #142 (Stand 15f25182, dieser auf PR #140). Der Schalter `withholdThenFill` steht im Arbeitsstand auf `true`; live geht er erst nach der Prüfung durch die andere KI. Fassung 2 nach der blinden Opus-Prüfung vom 23.11. (Abschnitt 5).

## 1. Was sich ändert

Bei 129 A-Aktien wich bisher ein älteres Quartal des Datenanbieters (meist Q2 2025) von der Börsenmeldung ab, und zugleich fehlte Q3 2025. Die Prüfung `lib/exchange-quarter-check.js` hat solche Firmen als `would-withhold` eingestuft und dann nichts getan: Im Modus `fill-only` wird nicht zurückgehalten, und die Auffüllprüfung lief nicht, weil die Auswertung vorher abbrach. Deshalb blieb Q3 2025 leer und das Board zeigte das Geschäftsjahr 2025 gegen 2024 (Diagnose vom 22.11., Abschnitt 1).

Neu gilt, wenn alle Abweichungen einer Firma nur Beschleunigungs-Glieder sind (kein Wachstums-Paar, keine Auffüllperiode):

- Die abweichende Zelle wird zurückgehalten, mit dem Hinweis „Vorjahresquartal 2. Quartal 2025 ausgeblendet: Der Wert des Datenanbieters weicht von der Börsenmeldung ab (vermutlich berichtigte Vorjahreszahlen). Er zählt nicht zur Beschleunigung des Umsatzwachstums.“ Das Quartal steht im Text, damit der Hinweis nicht für das daneben gefüllte Q3 gelesen wird.
- Auf diesem Stand läuft die Auffüllprüfung für Q3 2025 mit allen bisherigen Sperren (Berichtigungssignal, Juli-Stand, Nachbarquartale, Novemberregel und so weiter).
- Zusätzlich muss der gedruckte Bericht zum 3. Quartal 2026 den gefüllten Wert bestätigen (CNINFO für China, MOPS für Taiwan). Grund: Die ausgeblendete Zelle ist genau die, die sonst über den Juli-Stand belegt, dass die Zahlen für 2025 unverändert sind.
- Nur wenn beides gelingt, wirken Zurückhalten und Füllen zusammen, auch im Modus `fill-only`. Sonst bleibt alles wie bisher, und `withholdThenFillBlocked` hält fest, warum.

Eingefüllt wird die Zahl, die der bisherige Weg ohnehin liefert (Eastmoney 9 Monate minus Halbjahr). Beispiel für den Begründungstext am Wert (000880.SZ):

> Umsatz 3. Quartal 2025 fehlte beim Datenanbieter und stammt aus der Börsenmeldung (Eastmoney, veröffentlicht 29.10.2025). Der Wert passt zu der Veränderung gegenüber dem Vorjahresquartal (+72,76 %), die die Firma im CNINFO-Bericht zum 3. Quartal 2026 (veröffentlicht 30.10.2026) selbst angibt.

**Eigener Schalter:** `withholdThenFill` in `configs/exchange-quarter-policy.json`. `false` stellt das bisherige Ergebnis und den Snapshot exakt her.

## 2. Vorher/Nachher am 21.11.

Gleiche Eingaben in beiden Armen: 15.772 Snapshots aus dem Zwischenspeicher des Laufs vom 21.11., Börsenspeicher `external-data/exchange-quarters/` des Zweigs (letzter China-Abruf 20.11.2026 21:33 UTC, CNINFO-Speicher des Zweigs), Juli-Stand `board-history/2026-07-29`, Uhr `RUN_DATE_UTC=2026-11-21`, derselbe Produktionsweg `prepareSnapshot` und `src/scoring/run-screener.js` mit fester Kalibrierung (Lineal des Arms „aus“ über `SCORING_REF_CALIB`, L15). Einziger Unterschied ist der Schalter. Nicht nachgestellt wurde der FCF-Schritt des Tageslaufs; er wirkt in beiden Armen gleich.

| Prüfergebnis der 2.785 China- und Taiwan-Snapshots | Vorher | Nachher |
|---|---:|---:|
| would-fill | 2.001 | **2.013** |
| would-withhold | 129 | **117** |
| would-withhold-growth | 3 | 3 |
| agree | 461 | 461 |
| unchecked | 191 | 191 |

Alle 12 Wechsel sind A-Aktien (5 Shanghai, 7 Shenzhen), Taiwan ist nicht betroffen. Bei allen 12 wird Q2 2025 zurückgehalten und Q3 2025 gefüllt; der gezeigte Zeitraum wechselt von Geschäftsjahr 2025 auf Q3 2026. Die Wachstumszahl ändert sich im Median um 15,9 Punkte, höchstens um 79,5 Punkte.

| Ticker | Board (Spur) | Rang vorher → nachher | Wachstum vorher (GJ 2025) | nachher (Q3 2026) | CNINFO gedruckt |
|---|---|---|---:|---:|---:|
| 000880.SZ | Industrie (profitabel), Top-Liste | 67 → 39 | 46,5 % | 72,8 % | 72,76 % |
| 600150.SS | Industrie (profitabel), Top-Liste | 64 → 185 | 93,4 % | 13,9 % | 13,88 % |
| 000564.SZ | Zyklischer Konsum (unprofitabel), Top-Liste | 71 → 68 | 1,5 % | −16,2 % | −16,19 % |
| 000595.SZ | Industrie (profitabel) | 1585 → 708 | 6,0 % | 31,5 % | 31,47 % |
| 000410.SZ | Industrie (profitabel) | 1680 → 931 | 1,0 % | 33,8 % | 33,78 % |
| 000425.SZ | Industrie (profitabel) | 722 → 494 | 8,4 % | 9,8 % | 9,81 % |
| 000061.SZ | Basiskonsum (profitabel) | 190 → 500 | 13,4 % | −13,8 % | −13,8 % |
| 600056.SS | Gesundheit (profitabel) | 437 → 480 | 0,3 % | −8,9 % | −8,86 % |
| 600362.SS | Rohstoffe (profitabel) | 438 → 501 | 5,4 % | −2,7 % | −2,75 % |
| 000422.SZ | Rohstoffe (profitabel) | 832 → 838 | 1,0 % | −13,2 % | −13,17 % |
| 600131.SS | Versorger (profitabel) | 239 → 286 | 2,0 % | −5,3 % | −5,32 % |
| 600027.SS | Versorger (profitabel) | 313 → 306 | −10,9 % | −12,5 % | −12,51 % |

Nebenwirkung auf alle anderen Board-Zeilen: kein Score ändert sich, Ränge verschieben sich nur durch die 12 Firmen um höchstens 2 Plätze. Mit neu gelernter Kalibrierung je Arm, wie im Tageslauf, wären es Score-Änderungen von höchstens 0,4 Punkten.

Gegenüber Fassung 1 fallen 10 Firmen weg, weil ihr CNINFO-Bericht nicht im Speicher liegt oder nach der Projektregel nicht bestätigt: 000060.SZ, 002320.SZ, 300498.SZ, 600397.SS, 600761.SS, 601158.SS, 601228.SS, 603268.SS, 603298.SS, 603786.SS. Sie zeigen weiter das Geschäftsjahr 2025. Eine falsche Zahl war bei ihnen nicht belegt; sie kommen dazu, sobald ihr Bericht gelesen ist.

## 3. Grenzen

- Die übrigen 117 `would-withhold`-A-Aktien bleiben wie bisher (vor allem Berichtigungssignal bei Eastmoney und Wertpapierhäuser, Diagnose Abschnitt 1). Ihr abweichender Wert wird weiter nicht zurückgehalten; das ginge nur über den Modus `active` und ist eine eigene Entscheidung.
- Fällt das Wachstums-Paar selbst oder eine Auffüllperiode unter die Abweichung, greift der neue Weg nicht (absichtlich). Die Bedingung „keine Auffüllperiode“ hat noch keinen eigenen Test; sie wird erst mit den Zahlen für Q4 2026 erreichbar, wenn Q3 2025 Glied eines älteren Paares wird.
- Wechselwirkung mit PR #143: Dessen Prüfung sieht 600150.SS danach als passend (nachgerechnet von der Opus-Prüfung). Die beiden PRs ändern keine gemeinsame Datei.
- Der Nachstell-Bericht `scripts/exchange-check-report.js` zählt im Modus fill-only die Felder des Zurückhaltungs-Vermerks als „sonstige Änderung“; das betrifft nur den Bericht, nicht die Boards.

## 4. Prüfung

- `tests/exchange-quarter-check.test.js`: 59 grün, davon fünf S1-Tests (Zurückhalten und Füllen mit Druckbeleg, Modus aus stellt jede Zelle wieder her; Wachstums-Paar und gesperrte Füllung bleiben beim alten Ergebnis; ohne Druckbeleg oder mit abweichendem Druck nichts; Schalter aus ist exakt das alte Ergebnis; ungültiger Schalter wirft). Absichtlich rot gemacht, nur an Modulkopien: Füllung ohne Zurückhalten, Zurückhalten ohne Füllung, Wegfall der Eingangsbedingung, Wegfall der Druckbeleg-Pflicht.
- `scripts/exchange-check-report.js`: Eine der Pflicht-Zurückhaltungen gilt auch als bestanden, wenn sie als Füllung mit Zurückhaltung endet; `tests/exchange-check-report.test.js` grün.
- Fassung 1: Alle 693 Testdateien liefen mit `node <Datei>`, rot waren nur zwei schon vorher rote Dateien (`tests/discovery/lse-uk.test.js`, `tests/fixtures/clock-shift/red-at-real-clock.test.js`). Fassung 2: Börsen-, G31-, Herkunfts- und JSDoc-Tests erneut grün.
- GQS-00: Der neue Hash von `lib/exchange-quarter-check.js` steht in `protocol/gqs-00/1.2.0-pending/transition.json` (Eintrag `s1WithholdThenFill20261123`); `tests/scoring/gqs00-freeze.test.js` grün.
- Arbeitsdateien: `C:\Users\Anwender\.codex\reports\diener3-2026-11-23\s1\` (`vn.js`, `vn2-1121.json`, `cmp.js`, `s1b-off`, `s1b-on`).

## 5. Blinde Opus-Prüfung vom 23.11. und was daraus wurde

Urteil APPROVE MIT AUFLAGEN (75 %), Bericht `C:\Users\Anwender\.codex\reports\diener3-2026-11-23\review-147.md`. Umgesetzt: Druckbeleg-Pflicht für S1 (M1, 22 → 12 Firmen), Quartal im Hinweistext (M2), bei gescheitertem Einfügen bleibt der Snapshot unverändert (N1), Berichtszahlen und Kommentare berichtigt (N3, N4). Offen und hier vermerkt: Test für die Auffüllperioden-Bedingung (N2), Zählweise des Nachstell-Berichts (N5).
