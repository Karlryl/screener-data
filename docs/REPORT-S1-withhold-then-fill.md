# S1: A-Aktien mit abweichendem Vorjahresquartal zurückhalten und auffüllen

> **Auf einen Blick**
> Am Datentag 21.11.2026 zeigen **22 A-Aktien** ihr Umsatzwachstum jetzt für Q3 2026 statt für das Geschäftsjahr 2025, weil der falsche Q2-2025-Wert des Datenanbieters ausgeblendet und das fehlende Q3 2025 aus der Börsenmeldung (Eastmoney) gefüllt wird; alle 14 davon mit gelesenem CNINFO-Bericht treffen das dort gedruckte Q3-Wachstum auf 0,05 Prozentpunkte.
>
> - Sichtbar in den Top-Listen ändern sich vier Zeilen: 000880.SZ (Industrie profitabel) steigt von Rang 67 auf 39, 600150.SS (Industrie profitabel) fällt von 64 auf 185 und damit aus der Liste, dafür kommt 688392.SS auf Rang 100; 603268.SS bleibt auf 39 (Wachstum 275,0 % → 181,0 %), 000564.SZ (Zyklischer Konsum unprofitabel) 71 → 68.
> - Mit Schalter aus sind alle Boards identisch mit dem Code vorher (nur der Zeitstempel `generated_at` unterscheidet sich).

Stand 23.11.2026, gemessen auf dem Datentag 21.11.2026, Zählebene Ticker. Gebaut von Claude (Opus), Codex war leer; gestapelt auf PR #142 (dieser auf PR #140). Der Schalter `withholdThenFill` steht im Arbeitsstand auf `true`; live geht er erst nach der Prüfung durch die andere KI.

## 1. Was sich ändert

Bei 126 A-Aktien wich bisher ein älteres Quartal des Datenanbieters (meist Q2 2025) von der Börsenmeldung ab, und zugleich fehlte Q3 2025. Die Prüfung `lib/exchange-quarter-check.js` hat solche Firmen als `would-withhold` eingestuft und dann gar nichts getan: Im Modus `fill-only` wird nicht zurückgehalten, und die Auffüllprüfung lief gar nicht erst, weil die Auswertung vorher abbrach. Deshalb blieb Q3 2025 leer und das Board zeigte das Geschäftsjahr 2025 gegen 2024 (Diagnose vom 22.11., Abschnitt 1).

Neu gilt, wenn alle Abweichungen einer Firma nur Beschleunigungs-Glieder sind (kein Wachstums-Paar, keine Auffüllperiode):

- Die abweichende Zelle wird zurückgehalten, mit dem bestehenden Hinweis „Vorjahresquartal ausgeblendet: Der Wert des Datenanbieters weicht von der Börsenmeldung ab (vermutlich berichtigte Vorjahreszahlen). Er zählt nicht zur Beschleunigung des Umsatzwachstums.“
- Auf diesem Stand läuft die Auffüllprüfung für Q3 2025 mit allen bisherigen Sperren (Berichtigungssignal, Juli-Stand, Nachbarquartale, Novemberregel, CNINFO-Druckbeleg aus PR #140 und so weiter).
- Nur wenn sie füllt, wirkt beides zusammen, auch im Modus `fill-only`. Sperrt sie, bleibt alles wie bisher; dann wird auch nichts zurückgehalten.

Eingefüllt wird die Zahl, die der bisherige Weg ohnehin liefert: Eastmoney 9 Monate minus Halbjahr, bei vier Firmen zusätzlich mit dem CNINFO-Druckbeleg (`printed-check`). Ein Beispiel für den Begründungstext am Wert (000880.SZ):

> Umsatz 3. Quartal 2025 fehlte beim Datenanbieter und stammt aus der Börsenmeldung (Eastmoney, veröffentlicht 29.10.2025). Der Wert passt zu der Veränderung gegenüber dem Vorjahresquartal (+72,76 %), die die Firma im CNINFO-Bericht zum 3. Quartal 2026 (veröffentlicht 30.10.2026) selbst angibt.

**Eigener Schalter:** `withholdThenFill` in `configs/exchange-quarter-policy.json`. `false` stellt das bisherige Ergebnis und den Snapshot exakt her.

## 2. Vorher/Nachher am 21.11.

Gleiche Eingaben in beiden Armen: 15.772 Snapshots aus dem Zwischenspeicher des Laufs vom 21.11., Börsenspeicher `external-data/exchange-quarters/` des Zweigs (letzter China-Abruf 20.11.2026 21:33 UTC), Juli-Stand `board-history/2026-07-29`, Uhr `RUN_DATE_UTC=2026-11-21`, derselbe Produktionsweg `prepareSnapshot` und `src/scoring/run-screener.js` mit fester Kalibrierung (Lineal des Arms „aus“ über `SCORING_REF_CALIB`, L15). Einziger Unterschied ist der Schalter. Arm „aus“ mit eigener und mit fester Kalibrierung ergab dieselben Boards, und ein dritter Arm mit dem Code von PR #142 (fa120a5a22) ebenso (nur `generated_at` verschieden). Nicht nachgestellt wurde der FCF-Schritt des Tageslaufs; er wirkt in beiden Armen gleich.

| Prüfergebnis der 2.785 China- und Taiwan-Snapshots | Vorher | Nachher |
|---|---:|---:|
| would-fill | 2.001 | **2.023** |
| would-withhold | 129 | **107** |
| would-withhold-growth | 3 | 3 |
| agree | 461 | 461 |
| unchecked | 191 | 191 |

Alle 22 Wechsel sind A-Aktien (12 Shanghai, 10 Shenzhen), Taiwan ist nicht betroffen. Bei allen 22 wird Q2 2025 zurückgehalten und Q3 2025 gefüllt; der gezeigte Zeitraum wechselt bei allen von Geschäftsjahr 2025 auf Q3 2026. Die Wachstumszahl ändert sich im Median um 14,2 Punkte, höchstens um 94,0 Punkte.

| Ticker | Board (Spur) | Rang vorher → nachher | Wachstum vorher (GJ 2025) | nachher (Q3 2026) | CNINFO gedruckt |
|---|---|---|---:|---:|---:|
| 000880.SZ | Industrie (profitabel), Top-Liste | 67 → 39 | 46,5 % | 72,8 % | 72,76 % |
| 600150.SS | Industrie (profitabel), Top-Liste | 64 → 185 | 93,4 % | 13,9 % | 13,88 % |
| 603268.SS | Zyklischer Konsum (profitabel), Top-Liste | 39 → 39 | 275,0 % | 181,0 % | nicht gelesen |
| 000564.SZ | Zyklischer Konsum (unprofitabel), Top-Liste | 71 → 68 | 1,5 % | −16,2 % | −16,19 % |
| 000595.SZ | Industrie (profitabel) | 1585 → 708 | 6,0 % | 31,5 % | 31,47 % |
| 000410.SZ | Industrie (profitabel) | 1680 → 931 | 1,0 % | 33,8 % | 33,78 % |
| 000061.SZ | Basiskonsum (profitabel) | 190 → 500 | 13,4 % | −13,8 % | −13,8 % |
| 603786.SS | Zyklischer Konsum (profitabel) | 663 → 904 | 13,8 % | −7,6 % | nicht gelesen |
| 000425.SZ | Industrie (profitabel) | 722 → 494 | 8,4 % | 9,8 % | 9,81 % |
| 601158.SS | Versorger (profitabel) | 128 → 218 | 5,8 % | −3,2 % | nicht gelesen |
| übrige 12 | volle Listen | höchstens 105 Plätze | | | 7 von 7 gelesenen auf 0,05 Punkte |

Gegenprobe: 14 der 22 Firmen haben einen gelesenen CNINFO-Bericht zum 3. Quartal 2026; alle 14 Werte treffen das dort gedruckte Wachstum auf höchstens 0,049 Prozentpunkte. Bei den übrigen 8 gibt es keine zweite Quelle für das Wachstum; der gefüllte Vorjahreswert ist Eastmoneys 9 Monate minus Halbjahr unter denselben Sperren wie bei den 2.001 bisherigen Füllungen (Sicherheit, dass diese 8 Werte stimmen: 90 %, abgeleitet aus 14 von 14 und der Trefferquote von PR #140).

Nebenwirkung auf alle anderen 8.788 Board-Zeilen bei fester Kalibrierung: kein Score ändert sich, Ränge verschieben sich nur durch die 22 Firmen um höchstens 2 Plätze. In den Top-Listen fällt eine Zeile heraus (600150.SS), eine kommt neu (688392.SS auf Rang 100 Industrie profitabel). Mit neu gelernter Kalibrierung je Arm, wie im Tageslauf, wären es höchstens 0,4 Score-Punkte und 7 Plätze.

## 3. Grenzen

- Die übrigen 104 `would-withhold`-A-Aktien bleiben wie bisher: Bei 60 meldet Eastmoney ein Berichtigungssignal, 31 sind Wertpapierhäuser, die übrigen haben keinen Beleg oder sonstige Sperren (Diagnose Abschnitt 1). Ihr abweichender Wert wird weiter nicht zurückgehalten; das ginge nur über den Modus `active` und ist eine eigene Entscheidung.
- Fällt das Wachstums-Paar selbst oder eine Auffüllperiode unter die Abweichung, greift der neue Weg nicht (absichtlich; Test vorhanden).
- Wechselwirkung mit PR #143: 600150.SS steht dort in der Stichprobe falscher China-Wachstumswerte (gezeigt 93,4 % für 2025). Mit dieser Änderung zeigt die Firma 13,9 % für Q3 2026 aus der Börsenmeldung; die Prüfung von PR #143 sollte den Wert dann als passend sehen (nicht gemessen, Sicherheit 80 %). Die beiden PRs ändern keine gemeinsame Datei.

## 4. Prüfung

- `tests/exchange-quarter-check.test.js`: 57 grün, davon vier neue S1-Tests (abweichendes Beschleunigungs-Glied wird zurückgehalten und Q3 2025 gefüllt, Modus aus stellt jede Zelle wieder her; Wachstums-Paar, Auffüllperiode und gesperrte Füllung bleiben beim alten Ergebnis; Schalter aus ist exakt das alte Ergebnis; ungültiger Schalter wirft). Absichtlich rot gemacht, nur an Modulkopien: Füllung ohne Zurückhalten, Zurückhalten ohne Füllung, Wegfall der Eingangsbedingung.
- `scripts/exchange-check-report.js`: Eine der Pflicht-Zurückhaltungen gilt auch als bestanden, wenn sie als Füllung mit Zurückhaltung endet (der falsche Wert ist dann trotzdem ausgeblendet); `tests/exchange-check-report.test.js` grün.
- Alle 693 Testdateien liefen mit `node <Datei>`: 691 grün, rot sind nur `tests/discovery/lse-uk.test.js` und `tests/fixtures/clock-shift/red-at-real-clock.test.js`, beide auch auf dem Stand von PR #142 rot.
- GQS-00: Der neue Hash von `lib/exchange-quarter-check.js` steht in `protocol/gqs-00/1.2.0-pending/transition.json` (Eintrag `s1WithholdThenFill20261123`); `tests/scoring/gqs00-freeze.test.js` grün.
- Arbeitsdateien des Vorher/Nachher: `C:\Users\Anwender\.codex\reports\diener3-2026-11-23\s1\` (`vn.js`, `vn-1121.json`, `cmp.js`).
