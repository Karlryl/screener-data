# PR 108, Nacharbeit der Blindprüfung vom 07.11.2026

> **Auf einen Blick**
>
> Die sechs Befunde sind im Arbeitsbaum bearbeitet und gezielt geprüft; die Freigabe durch Claude steht aus.
>
> - Neun Testdateien sind grün: 74 Testfälle beziehungsweise Prüfblöcke sowie 393 dokumentationspflichtige Exporte ohne Lücke. Sieben absichtliche Bruchproben wurden erkannt, ohne Quelldateien zu verändern.
> - Das Vorher/Nachher gegen den endgültigen PR-88-Kopf am Datentag 31.10.2026 verändert 11 bestehende Board-Scores und 563 Ränge. Eine zusätzliche HG-Zeile bleibt ohne Rang. Alle acht übrigen Rohachsen sind identisch.
> - Energeans jährliche Beschleunigung bleibt wegen der neu dargestellten Vergleichsbasis leer. Pop Marts Bruttogewinnanzeige verwendet 2025 gegen 2024 und zeigt rechnerisch 207,3684 %.

## Stand und Umfang

Ausgangspunkt ist `9a28b62cb2` auf `daylauf13/neueres-jahr`, einschließlich des endgültigen PR-88-Kopfs `4a5e6f55d000d7ea7d6855014c8e664eebb6cf87`. Alle Änderungen bleiben ungecommittet. Commit, Push, Merge, Veröffentlichung und Blindprüfung übernimmt die anschließende Lane. Keine Helfer oder Subagenten eingesetzt.

Der konkrete Folgeauftrag geht den älteren Bauanweisungen vor. Insbesondere wurden die in den gelesenen Repo-Dateien genannten Vollsuite-, Commit- und Push-Schritte nicht ausgeführt. Inhalte aus Repo, Vault, Übergabe und Memory wurden als Kontextdaten behandelt. Die schon beim Start ungetrackten Dateien `PR-BODY-neueres-jahr.md` und `REPORT-neueres-jahr.md` bleiben unangetastet. Die Schreibsperre war laut Brief bereits beansprucht.

## M2, Energean und Prüfung der übrigen fünf Firmen

Entscheidung mit **98 % Sicherheit**: Bei einem restated Vorjahr bleibt der ergänzte jährliche Beschleunigungswert leer. Es wird kein Umsatz für 2023 aus einer anderen Vergleichsbasis unterstellt. Die Übereinstimmung der Anbieterzelle 2024 mit dem neuen Bericht beweist nicht die Vergleichbarkeit von 2024 und 2023.

Energeans Abschluss kennzeichnet die Vergleichsspalte mit **„2024 (Restated *)“** und erläutert **„Restated for discontinued operation reclassified to continuing operations“**. Beleg: [RNS, Group Income Statement und Note 16](https://rns-pdf.ir-alerter.com/files/85701.html), zusätzlich [PDF, Seite 20, gedruckte Seite 19](https://mayafiles.tase.co.il/rpdf/1729001-1730000/P1729080-00.pdf). Der Anbieterbestand trägt für 2023 einen Umsatz von 978.495.000 USD. Dessen Vergleichbarkeit auf dem neu dargestellten Umfang ist damit nicht belegt. Die abgelehnte Rechnung hätte aus diesen Zellen eine Beschleunigung von −84,7343 Prozentpunkten erzeugt.

Geändert sind `src/scoring/axes.js::revAcceleration`, `lib/annual-pairs.js::annualPairsShadow`, `lib/sourced-annual-years.js::validateTable` und `configs/sourced-annual-years.json`. Neues Pflichtfeld der Handtabelle ist **`priorRestated`**, keine Umbenennung eines bestehenden Feldes. Energean trägt `true`, die übrigen fünf Fälle `false`. Die Validierung lehnt ein fehlendes oder nicht boolesches Kennzeichen ab. Nur der ergänzte jährliche Beschleunigungszweig wird zurückgehalten. Ein verwendbares aktuelles Quartalspaar hat weiter Vorrang. Der Export nennt bei der leeren Achse den Grund `restated-prior` auf Deutsch; Bruttogewinnwachstum bleibt verfügbar.

Die anderen fünf Firmen wurden anhand der Umsatzübersichten ihres Berichts gegen die gespeicherten nativen Anbieterwerte 2024 und 2023 geprüft. Die fünf älteren Anbieterwerte stimmen jeweils mit der im selben Bericht gezeigten Mehrjahresübersicht überein. Es wurde kein weiteres Energean-Muster festgestellt, Sicherheit **95 %**. Diese Prüfung ergänzt die bestehenden zwei Lesedurchgänge für 2025/2024; sie behauptet keine zwei neuen unabhängigen Lesedurchgänge für 2023. Die Variante, einen zusätzlichen älteren Quellenwert einzubauen, wurde bewusst nicht gewählt.

| Firma | Prüfung der Vergleichsbasis und kurze Originalstelle | Beleg |
|---|---|---|
| Pop Mart, 9992.HK | Financial Summary, Zeile „Revenue“, Vergleichswert „6,301,002“. Die Spalten sind 2025, 2024, 2023, Beträge in CNY Tausend. 2023 stimmt mit 6.301.002.000 CNY im Anbieterbestand überein. | [Annual Report, PDF Seite 7](https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0421/2026042100395_c.pdf) |
| Shenzhen Salubris, 002294.SZ | „公司是否需追溯调整或重述以前年度会计数据“, Antwort „□是 否“. Umsatz 2023 ist 3.365.343.342,73 CNY und stimmt mit dem Anbieterbestand überein. | [Annual Report, PDF Seite 10](https://static.cninfo.com.cn/finalpage/2026-04-21/1225130579.PDF) |
| Nantong Jiangshan, 600389.SS | „营业收入 5,816,188,535.51 5,431,591,346.96 7.08 5,085,696,347.20“. Die ausgewiesenen Jahre 2025, 2024 und 2023 stimmen mit der Handtabelle beziehungsweise den älteren Anbieterwerten überein. | [Annual Report, PDF Seite 8](https://static.cninfo.com.cn/finalpage/2026-04-21/1225128424.PDF) |
| Energean, ENOG.L | Restated 2024 ausdrücklich belegt. Ein älteres Jahr auf gleicher Vergleichsbasis wird nicht vorausgesetzt. | [RNS, Group Income Statement](https://rns-pdf.ir-alerter.com/files/85701.html) |
| Jilin Sino-Microelectronics, 600360.SS | „营业收入 2,255,244,574.28 2,057,608,183.78 9.61 1,741,756,017.59“. Die Spalten 2024 und 2023 stimmen mit den beiden Anbieterwerten überein. | [Annual Report, PDF Seite 7](https://static.cninfo.com.cn/finalpage/2026-04-21/1225133069.PDF) |
| Guangdong Fenghua, 000636.SZ | „公司是否需追溯调整或重述以前年度会计数据“, Antwort „□是 ☑否“. Umsatz 2023 ist 4.221.429.523,25 CNY und stimmt mit dem Anbieterbestand überein. | [Annual Report auf der Börsenseite, gedruckte Seite 10, PDF Seite 11](https://disc.static.szse.cn/disc/disk03/finalpage/2026-04-21/be616d17-d875-4473-ae98-d1b94696952d.PDF) |

Nachweis in `tests/sourced-annual-years-review.test.js`, Prüfungen **M2 Energean** und **M2 the restatement hint**: Echtdatensatz, leere Beschleunigung, weiterhin vorhandenes GP-Wachstum, unveränderte Eingangsdaten, fünf verwendbare Kontrollfirmen, Vorrang frischer Quartale und der Hinweis bei altem Quartalspaar. Im Speicher wird einmal die Restatement-Bedingung ausgeschaltet und einmal die Hinweisbedingung. Beide gleichen Prüfaussagen schlagen dann absichtlich fehl und bestehen am richtigen Code. Quelldatei-Hashes bleiben unverändert.

## M3, Bruttogewinnanzeige

`src/scoring/overview.js::growthVerdict`, Zweig `gp`, verwendet für einen verfügbaren ergänzten Abschluss dasselbe Jahrespaar wie `gpGrowth`. Wert und Periodenbeschriftung werden gemeinsam zurückgegeben. Pop Mart erhält 31.12.2025 gegen 31.12.2024 und den Hinweis auf den geprüften Abschluss. Die Anzeige ist das reine GP-Wachstum von 207,3684 %; die unveränderte Margenkomponente der Scoring-Achse wird nicht als GP-Wachstum ausgegeben. Der alte G31-Vergleich und unkonfigurierte Firmen behalten ihren bisherigen Weg. Auch das Aufholen der Anbieterreihe ist geprüft.

Test **M3 real Pop Mart display** in `tests/sourced-annual-years-review.test.js`: echter Datensatz, Wert, beide Periodenenden, fehlender Veraltet-Hinweis, Altvergleich und Anbieter-Aufholen. Eine vollständige Zeile wird nur im Speicher so ersetzt, dass kein ergänzter Abschluss gefunden wird. Dieselbe Wert-/Periodenprüfung wird rot; der richtige Code ist grün.

## M4, Wiedervorlage vor Ablauf

`lib/handtabellen-fristen.js::fristen` liest die Jahrestabelle im vorhandenen Fristenbericht zusätzlich ein. Der bestehende Aufrufer `scripts/tageslauf-erwartungen.js::run` übernimmt dessen Textzeilen bereits. Es gibt keinen neuen Zeitgeber und keine Ausgabe in jeder einzelnen Achsenberechnung.

Das vorhandene Fenster von 30 Tagen gilt auch hier. Für die derzeitige Frist 04.12.2026 wird ab 04.11.2026 gewarnt; am 03.11.2026 noch nicht. Die Zeile nennt Firma, Ticker, Frist, ersten Datentag ohne Ergänzung und mögliche Folgen für Achsen, Score und Rang. Am Fristtag und nach Überschreitung bleibt sie sichtbar. Die Warnung wirkt nur meldend. Ein schon nachgezogener Anbieter kann die regulären Werte weiterhin liefern; der Text behauptet deshalb keinen sicheren Board-Verlust.

Test **M4 fixed clock** in `tests/sourced-annual-years-review.test.js`: 31 und 30 Tage vor der Frist, Fristtag, Folgetag, alle sechs Namen sowie die tatsächliche Auslaufgrenze des Resolvers. Im Speicher wird die Verarbeitung der Jahrestabelle einmal unterdrückt. Die Erwartung von sechs Meldungen wird rot, danach am richtigen Code grün. Zusätzlich besteht die bestehende Datei `tests/handtabellen-fristen.test.js`, einschließlich ihres Durchlaufs über den Tageserwartungs-Aufrufer.

## L5, Veröffentlichungstag

`lib/sourced-annual-years.js::resolveSourcedAnnualYear` lehnt jetzt `at <= published` ab. Es zählt wie bisher die späteste Veröffentlichung der hinterlegten Belege. Test **L5 all six records** prüft für alle sechs echten Datensätze den Veröffentlichungstag als `not-public` und den Folgetag als `available`. Die maßgeblichen Veröffentlichungen sind Dienstag, 21.04.2026, beziehungsweise Donnerstag, 19.03.2026; ihre Folgetage sind reguläre Wochentage. Ein neuer Börsenfeiertagskalender wurde nicht eingeführt, der Auftrag verlangte diese Tagesgrenze.

Bruchprobe: Nur im Speicher wird `<=` wieder zu `<`. Die gleiche Prüfung des Veröffentlichungstags wird rot. Die reale Quelldatei bleibt unverändert und besteht.

## L6, eigene GP-Periodenenden

`lib/annual-pairs.js::annualPairsShadow` berechnet die frühere Periodenlänge für `grossProfit` aus `gpEnds`, für `acceleration` weiter aus Umsatzenden. Fehlende oder ungültige GP-Enden ergeben `null`.

Test **L6 GP prior length** verändert nur die Testkopie von Pop Mart: GP-Abstand 397 Tage, Umsatzabstand 366 Tage. Die Bruchprobe setzt nur im Speicher wieder Umsatzenden für beide Achsen ein; die GP-Prüfung wird rot. Zusätzlich werden fehlende und ungültige GP-Enden geprüft.

## M1, endgültiger Ausgangsstand und Vorher/Nachher

`scripts/sourced-annual-years-replay.js` erhält den optionalen vierten Parameter `baseline-head`. Standard ist `4a5e6f55d000d7ea7d6855014c8e664eebb6cf87`. Nur vollständige Commit-Hashes werden angenommen. Beide Ergebnisarme müssen denselben angeforderten Kopf und Datentag tragen. Abweichendes `RUN_DATE_UTC` wird zurückgewiesen. `overview.js` wird ebenfalls aus dem Baseline-Commit geladen, damit Vorher nicht versehentlich schon die korrigierte Anzeige verwendet.

Test **M1 compare CLI** führt den echten Vergleichscode mit einem virtuellen Dateisystem aus: endgültiger Standard, explizite alternative Baseline, gemischte Baselines und ungültiger Parameter. Eine Bruchprobe stellt den alten Standardkopf im Speicher wieder her; die Prüfung wird rot. Es entsteht kein zusätzlicher Replay-Arm und keine Kopie eines Datenbaums.

Am Beginn von M1 waren **84,738 GB** frei, gemessen am 07.11.2026 um 12:44:01 UTC. Der zulässige Vergleich wurde deshalb ausgeführt. Bestehender Datenbaum: `C:/Users/Anwender/.codex/t/daylauf10/nachziehen-rv/r88/a88b`. Neue Belege: `C:/Users/Anwender/.codex/reports/daylauf-2026-11-07/ergebnisse/B05-neueres-jahr-fix/replay/`.

Die drei folgenden Aufrufe wurden im Klon mit Exit **0 / 0 / 0** ausgeführt. Der Zielordner muss bei einer Wiederholung neu sein; vorhandene Armdateien werden nicht überschrieben.

```powershell
$env:RUN_DATE_UTC = '2026-10-31'
node scripts/sourced-annual-years-replay.js before 'C:/Users/Anwender/.codex/t/daylauf10/nachziehen-rv/r88/a88b' 'C:/Users/Anwender/.codex/reports/daylauf-2026-11-07/ergebnisse/B05-neueres-jahr-fix/replay' '4a5e6f55d000d7ea7d6855014c8e664eebb6cf87'
node scripts/sourced-annual-years-replay.js after 'C:/Users/Anwender/.codex/t/daylauf10/nachziehen-rv/r88/a88b' 'C:/Users/Anwender/.codex/reports/daylauf-2026-11-07/ergebnisse/B05-neueres-jahr-fix/replay' '4a5e6f55d000d7ea7d6855014c8e664eebb6cf87'
node scripts/sourced-annual-years-replay.js compare 'C:/Users/Anwender/.codex/t/daylauf10/nachziehen-rv/r88/a88b' 'C:/Users/Anwender/.codex/reports/daylauf-2026-11-07/ergebnisse/B05-neueres-jahr-fix/replay' '4a5e6f55d000d7ea7d6855014c8e664eebb6cf87'
```

Beim ausgeführten Lauf blieb der optionale vierte Parameter weg und der geprüfte Standard griff. Oben ist derselbe Kopf zum Wiederholen ausdrücklich angegeben.

15.826 Snapshots, 15.815 autorisierte Ticker, 48 HG-/Quality-Boards und identische Vorher-Kalibrierung. Eingaben wurden in jedem Arm vor/nach dem Lesen gehasht; zusätzlich stimmen die Eingabemanifeste beider Arme überein. Auch Firmenliste und Kalibrierung werden im Vergleich hart auf Gleichheit geprüft.

- Eingabedigest: `4066ca0fa2d7b344edb3371474b9eff79114f52bc5a29a9fc72a0ac1de49be94`.
- Kalibrierungsdigest: `2f4f444ec86f6d7945fd6965adbc6ecfd597a08f43d800cb16057df399ef34bd`.
- HG: 9.243 auf 9.244 Zeilen; Quality: unverändert 7.147 Zeilen. Neu ist 600360.SS auf HG ohne Rang. Keine Zeile geht ganz verloren.
- 11 bestehende Zeilen erhalten andere Scores; 563 bestehende Zeilen erhalten andere Ränge. Zusammen mit dem Zugang sind es 564 bewegte Board-Zeilen, nachfolgend vollständig aufgeführt. Board-Zeilen sind keine Zahl unterschiedlicher Firmen.
- Erste 100: HG Zyklischer Konsum nimmt Pop Mart auf und ALWN.AT rutscht von 100 auf 101; Quality Energie verliert Energean aus den ersten 100, COP rückt von 101 auf 100.
- Exakt sechs Ticker ändern eine der beiden erlaubten Rohachsen. `revGrowthLevel`, `ruleOfX`, `marginTrajectory`, `capitalEfficiency`, `revisionsMomentum`, `dilution`, `marginLevel`, `roicStability` bleiben bei allen 15.815 Tickern identisch.

## Tests und Siegel

Alle Aufrufe waren einzelne Testdateien. TEMP und TMP lagen ausschließlich im zugelassenen Ergebnisordner. Der Protokollname ist jeweils der Dateipfad mit `/` als `_` und der Endung `.log`, beispielsweise `tests_sourced-annual-years-review.test.js.log`.

| Aufruf | Exit | Bestandene Prüfungen |
|---|---:|---:|
| `node tests/stale-series-p286.test.js` | 0 | 21 |
| `node tests/sourced-annual-years.test.js` | 0 | 11 |
| `node tests/annual-pairs-shadow-export.test.js` | 0 | 4 |
| `node tests/gqs00-sourcehash-wachposten.test.js` | 0 | 4 |
| `node tests/scoring/gqs00-freeze.test.js` | 0 | 6 |
| `node tests/scoring/cycle-ramp.test.js` | 0 | 8 |
| `node tests/jsdoc-exports.test.js` | 0 | 393 prüfpflichtige Exporte, 0 fehlend; 52 bestehende versiegelte Ausnahmen |
| `node tests/sourced-annual-years-review.test.js` | 0 | 7, einschließlich 7 erkannter absichtlicher Brüche |
| `node tests/handtabellen-fristen.test.js` | 0 | 13 |

`node scripts/gqs00-freeze.js --verify` ist Exit 0: 25 Golden Cases, 13 Zweige, 14.801 Alt-/Referenzzeilen, 8.908 veröffentlichte Referenzzeilen, 0 Score- und 0 Rangabweichungen; negativeMutationGate PASS. Das sind Siegel-Referenzdaten, nicht die Zeilenzahlen des neuen Replays.

In `protocol/gqs-00/1.2.0-pending/transition.json` ist `sourcedAnnualYear20261104.reviewFix20261107` ergänzt: vorheriger und neuer Hash für `axes.js`, `overview.js`, `annual-pairs.js`, `sourced-annual-years.js` und die Jahrestabelle. Die maßgeblichen aktuellen `sourceFiles`-/`dependencyFiles`-Einträge wurden entsprechend gesetzt. Das Siegel selbst bleibt unberührt. `git diff --check` besteht.

Die Bruchproben ersetzen jeweils eine eindeutig identifizierte vollständige Quellzeile in einem In-Memory-Modul beziehungsweise einer VM. Keine Bruchprobe schreibt eine reale Datei oder führt einen schreibenden Test als Bruchziel aus. SHA-256 vor/nach jeder Probe muss identisch sein; die regulären Module werden nicht im Require-Cache ersetzt.

## Nicht ausgeführt und offene Punkte

- **Claudes Blindprüfung** ist offen, wie beauftragt. Dieser Bericht ist ein Baunachweis und keine eigene Freigabe.
- **Commit, Push, Merge, Deployment und Browserkontrolle** sind nicht ausgeführt. Das übernimmt die Folgelane nach Prüfung. Keine Playwright-Ausführung.
- **Vollsuite und weitere Replay-Arme** wurden wegen des ausdrücklichen Ressourcenlimits nicht gestartet. Der vorhandene Replay deckt HG und Quality ab, nicht einen zusätzlichen Small-Cap-Lauf. Seine 564 Zeilen beziehen sich exakt auf diese 48 Boards.
- **Energean 2023 neu belegen** wurde nicht ausgeführt, weil die zulässige Alternative gewählt wurde, die jährliche Beschleunigung mit Hinweis leer zu lassen. Das ist keine Behauptung, dass ein vergleichbarer Wert nicht beschaffbar wäre.
- **Historische Berichte** `REPORT-neueres-jahr.md` und `docs/sourced-annual-years-2026-11-04.md` wurden nicht umgeschrieben. Ihre Messung gegen den älteren PR-88-Kopf bleibt historische Evidenz, nicht die aktuelle Freigabegrundlage. Die neue Registrierung verweist ausdrücklich auf diesen Bericht.
- **Quellenabruf**: Die verlangten curl-Aufrufe scheiterten mit `SEC_E_NO_CREDENTIALS`; auch die installierte Git-curl-Fassung tat das. Bereits vorhandene PDFs wurden nur gelesen. Energeans PDF/HTML wurden anschließend per Node-HTTPS mit 25-Sekunden-Limit in den Ergebnisordner geladen. Für chinesische Restatement-Angaben wurde zusätzlich der lesbare Berichtstext der Original-Börsenquellen verwendet, da der lokale PDF-Textauszug die chinesischen Zeichen nicht vollständig dekodiert. Kein neuer Interpreter und kein Paket installiert; der im Brief genannte Python-Pfad war nicht vorhanden.
- **Geschützte Daten, Positionsreihen, andere Achsen, Kalibrierungsdateien und Siegel** wurden nicht verändert. Alle neuen Dateien liegen in den zwei erlaubten Verzeichnissen. Neue Belege belegen rund 31 MB und bleiben deutlich unter 1 GB; keine Klone oder Baumkopien angelegt.

## Messwerte der sechs Handprüffälle

Die folgende Tabelle und die vollständige Bewegungsliste werden direkt aus `comparison.json`, `before.json` und `after.json` erzeugt. „Leer“ ist `null`, „nicht enthalten“ bedeutet fehlende Board-Zeile. Rohachsen werden als dimensionslose Rechenwerte gezeigt; sie sind nicht mit dem gerundeten Board-Score oder dem reinen GP-Anzeigewachstum gleichzusetzen.

| Firma | GP-Achse vorher | GP-Achse nachher | Beschleunigung vorher | Beschleunigung nachher |
|---|---:|---:|---:|---:|
| Pop Mart International Group Limited (9992.HK) | leer | 2,1804165671886646 | leer | 0,7779663582560343 |
| Shenzhen Salubris Pharmaceuticals (002294.SZ) | leer | 0,12332064965706602 | leer | -0,10737259562981993 |
| Nantong Jiangshan Agrochemical & Chemicals (600389.SS) | leer | 0,2164995007293977 | leer | 0,002794158629175092 |
| Energean plc (ENOG.L) | leer | -0,230901180065188 | leer | leer |
| Jilin Sino-Microelectronics (600360.SS) | leer | 0,05317094993843127 | leer | -0,08528970439556272 |
| Guangdong Fenghua Advanced Technology (000636.SZ) | leer | -0,05306260238273938 | 0,5307171131369792 | 0,5307171131369792 |

| Firma | Board | Score vorher | Score nachher | Rang vorher | Rang nachher | Achsen vorher | Achsen nachher |
|---|---|---:|---:|---:|---:|---|---|
| Pop Mart International Group Limited (9992.HK) | hg/consumer-discretionary/profitable | 70,6 | 93,2 | 136 | 8 | 4/7 | 6/7 |
| Pop Mart International Group Limited (9992.HK) | quality/quality-consumer-discretionary/profitable | 77,5 | 86,5 | 28 | 7 | 4/5 | 5/5 |
| Shenzhen Salubris Pharmaceuticals (002294.SZ) | hg/health-care/profitable | 57,4 | 51,4 | 228 | 298 | 4/7 | 6/7 |
| Shenzhen Salubris Pharmaceuticals (002294.SZ) | quality/quality-health-care/profitable | 59,4 | 61,2 | 194 | 169 | 3/5 | 4/5 |
| Nantong Jiangshan Agrochemical & Chemicals (600389.SS) | hg/materials/profitable | 64,2 | 65,9 | 206 | 183 | 5/7 | 7/7 |
| Nantong Jiangshan Agrochemical & Chemicals (600389.SS) | quality/quality-materials/profitable | 61,3 | 64,4 | 223 | 178 | 4/5 | 5/5 |
| Energean plc (ENOG.L) | hg/energy/profitable | 39,6 | 35,3 | 256 | 277 | 4/7 | 5/7 |
| Energean plc (ENOG.L) | quality/quality-energy/profitable | 58,3 | 53,6 | 97 | 144 | 3/5 | 4/5 |
| Jilin Sino-Microelectronics (600360.SS) | hg/semiconductors/profitable | nicht enthalten | 40,8 | nicht enthalten | ohne Rang | nicht enthalten | 2/7 |
| Jilin Sino-Microelectronics (600360.SS) | quality/quality-semiconductors/profitable | 42,4 | 40,1 | 180 | 191 | 1/5 | 2/5 |
| Guangdong Fenghua Advanced Technology (000636.SZ) | hg/tech-hardware/profitable | 60,3 | 52,7 | 143 | 233 | 6/8 | 7/8 |
| Guangdong Fenghua Advanced Technology (000636.SZ) | quality/quality-tech-hardware/profitable | 45,0 | 38,9 | 329 | 400 | 3/5 | 4/5 |

## Vollst?ndige Liste aller 564 bewegten Board-Zeilen

Auch reine Rangverschiebungen unver?nderter Scores stehen in dieser Tabelle. Die zw?lf Handpr?f-Zeilen oben sind hier noch einmal enthalten.

| Board | Ticker | Score vorher | Score nachher | Rang vorher | Rang nachher |
|---|---|---:|---:|---:|---:|
| hg/materials/profitable | SCCC.BK | 65,9 | 65,9 | 183 | 184 |
| hg/materials/profitable | AVIA.JK | 65,9 | 65,9 | 184 | 185 |
| hg/materials/profitable | CMPDI.BO | 65,9 | 65,9 | 185 | 186 |
| hg/materials/profitable | RPEL.BO | 65,8 | 65,8 | 186 | 187 |
| hg/materials/profitable | ULTRACEMCO.NS | 65,8 | 65,8 | 187 | 188 |
| hg/materials/profitable | 603979.SS | 65,8 | 65,8 | 188 | 189 |
| hg/materials/profitable | 5741.T | 65,7 | 65,7 | 189 | 190 |
| hg/materials/profitable | 603688.SS | 65,6 | 65,6 | 190 | 191 |
| hg/materials/profitable | PAAS | 65,6 | 65,6 | 191 | 192 |
| hg/materials/profitable | 002859.SZ | 65,5 | 65,5 | 192 | 193 |
| hg/materials/profitable | PCBL.NS | 65,5 | 65,5 | 193 | 194 |
| hg/materials/profitable | 300769.SZ | 65,4 | 65,4 | 194 | 195 |
| hg/materials/profitable | ECVT | 65,3 | 65,3 | 195 | 196 |
| hg/materials/profitable | MLM | 65,2 | 65,2 | 196 | 197 |
| hg/materials/profitable | 1ACX.MI | 65,1 | 65,1 | 197 | 198 |
| hg/materials/profitable | VINATIORGA.NS | 65,0 | 65,0 | 198 | 199 |
| hg/materials/profitable | 2006.TW | 64,9 | 64,9 | 199 | 200 |
| hg/materials/profitable | 3794.KL | 64,7 | 64,7 | 200 | 201 |
| hg/materials/profitable | 601702.SS | 64,6 | 64,6 | 201 | 202 |
| hg/materials/profitable | 014680.KS | 64,6 | 64,6 | 202 | 203 |
| hg/materials/profitable | PRU.AX | 64,6 | 64,6 | 203 | 204 |
| hg/materials/profitable | 1211.SR | 64,6 | 64,6 | 204 | 205 |
| hg/materials/profitable | 4626.T | 64,3 | 64,3 | 205 | 206 |
| hg/materials/profitable | 600389.SS | 64,2 | 65,9 | 206 | 183 |
| hg/tech-hardware/profitable | 000636.SZ | 60,3 | 52,7 | 143 | 233 |
| hg/tech-hardware/profitable | 688337.SS | 60,2 | 60,2 | 144 | 143 |
| hg/tech-hardware/profitable | 688475.SS | 60,1 | 60,1 | 145 | 144 |
| hg/tech-hardware/profitable | 007660.KS | 60,0 | 60,0 | 146 | 145 |
| hg/tech-hardware/profitable | 002273.SZ | 59,8 | 59,8 | 147 | 146 |
| hg/tech-hardware/profitable | VAIAS.HE | 59,7 | 59,7 | 148 | 147 |
| hg/tech-hardware/profitable | ASTRAMICRO.NS | 59,6 | 59,6 | 149 | 148 |
| hg/tech-hardware/profitable | 301631.SZ | 59,3 | 59,3 | 150 | 149 |
| hg/tech-hardware/profitable | 002380.SZ | 59,2 | 59,2 | 151 | 150 |
| hg/tech-hardware/profitable | 6442.TW | 59,2 | 59,2 | 152 | 151 |
| hg/tech-hardware/profitable | P | 59,0 | 59,0 | 153 | 152 |
| hg/tech-hardware/profitable | 688502.SS | 58,8 | 58,8 | 154 | 153 |
| hg/tech-hardware/profitable | 3005.TW | 58,8 | 58,8 | 155 | 154 |
| hg/tech-hardware/profitable | 4062.T | 58,7 | 58,7 | 156 | 155 |
| hg/tech-hardware/profitable | 6672.TW | 58,7 | 58,7 | 157 | 156 |
| hg/tech-hardware/profitable | 300739.SZ | 58,6 | 58,6 | 158 | 157 |
| hg/tech-hardware/profitable | 1723.T | 58,5 | 58,5 | 159 | 158 |
| hg/tech-hardware/profitable | TTMI | 58,5 | 58,5 | 160 | 159 |
| hg/tech-hardware/profitable | 601869.SS | 58,4 | 58,4 | 161 | 160 |
| hg/tech-hardware/profitable | TEL | 58,4 | 58,4 | 162 | 161 |
| hg/tech-hardware/profitable | 603119.SS | 58,4 | 58,4 | 163 | 162 |
| hg/tech-hardware/profitable | 6965.T | 58,2 | 58,2 | 164 | 163 |
| hg/tech-hardware/profitable | 3583.TW | 58,2 | 58,2 | 165 | 164 |
| hg/tech-hardware/profitable | 4980.T | 58,1 | 58,1 | 166 | 165 |
| hg/tech-hardware/profitable | 300322.SZ | 58,0 | 58,0 | 167 | 166 |
| hg/tech-hardware/profitable | CTS | 58,0 | 58,0 | 168 | 167 |
| hg/tech-hardware/profitable | 002138.SZ | 58,0 | 58,0 | 169 | 168 |
| hg/tech-hardware/profitable | LOGI | 57,9 | 57,9 | 170 | 169 |
| hg/tech-hardware/profitable | 688717.SS | 57,8 | 57,8 | 171 | 170 |
| hg/tech-hardware/profitable | NXT | 57,7 | 57,7 | 172 | 171 |
| hg/tech-hardware/profitable | 002217.SZ | 57,7 | 57,7 | 173 | 172 |
| hg/tech-hardware/profitable | GLW | 57,6 | 57,6 | 174 | 173 |
| hg/tech-hardware/profitable | 300726.SZ | 57,6 | 57,6 | 175 | 174 |
| hg/tech-hardware/profitable | DAKT | 57,6 | 57,6 | 176 | 175 |
| hg/tech-hardware/profitable | 301162.SZ | 57,6 | 57,6 | 177 | 176 |
| hg/tech-hardware/profitable | 300684.SZ | 57,5 | 57,5 | 178 | 177 |
| hg/tech-hardware/profitable | PREMIERENE.NS | 57,4 | 57,4 | 179 | 178 |
| hg/tech-hardware/profitable | BDC | 57,4 | 57,4 | 180 | 179 |
| hg/tech-hardware/profitable | 688522.SS | 57,4 | 57,4 | 181 | 180 |
| hg/tech-hardware/profitable | 002913.SZ | 57,3 | 57,3 | 182 | 181 |
| hg/tech-hardware/profitable | 300065.SZ | 56,9 | 56,9 | 183 | 182 |
| hg/tech-hardware/profitable | 3026.TW | 56,8 | 56,8 | 184 | 183 |
| hg/tech-hardware/profitable | 6856.T | 56,7 | 56,7 | 185 | 184 |
| hg/tech-hardware/profitable | 002179.SZ | 56,7 | 56,7 | 186 | 185 |
| hg/tech-hardware/profitable | 140860.KQ | 56,6 | 56,6 | 187 | 186 |
| hg/tech-hardware/profitable | ALSN.SW | 56,6 | 56,6 | 188 | 187 |
| hg/tech-hardware/profitable | KEYS | 56,6 | 56,6 | 189 | 188 |
| hg/tech-hardware/profitable | 688775.SS | 56,5 | 56,5 | 190 | 189 |
| hg/tech-hardware/profitable | ENPH | 56,4 | 56,4 | 191 | 190 |
| hg/tech-hardware/profitable | 603297.SS | 56,4 | 56,4 | 192 | 191 |
| hg/tech-hardware/profitable | COHR | 56,4 | 56,4 | 193 | 192 |
| hg/tech-hardware/profitable | 300975.SZ | 56,4 | 56,4 | 194 | 193 |
| hg/tech-hardware/profitable | 688322.SS | 56,4 | 56,4 | 195 | 194 |
| hg/tech-hardware/profitable | SMCI | 56,4 | 56,4 | 196 | 195 |
| hg/tech-hardware/profitable | LFUS | 56,3 | 56,3 | 197 | 196 |
| hg/tech-hardware/profitable | 688103.SS | 56,3 | 56,3 | 198 | 197 |
| hg/tech-hardware/profitable | AVT | 56,2 | 56,2 | 199 | 198 |
| hg/tech-hardware/profitable | VISN | 56,1 | 56,1 | 200 | 199 |
| hg/tech-hardware/profitable | 301282.SZ | 56,1 | 56,1 | 201 | 200 |
| hg/tech-hardware/profitable | 2472.TW | 56,1 | 56,1 | 202 | 201 |
| hg/tech-hardware/profitable | ZBRA | 55,9 | 55,9 | 203 | 202 |
| hg/tech-hardware/profitable | 3008.TW | 55,9 | 55,9 | 204 | 203 |
| hg/tech-hardware/profitable | 301165.SZ | 55,8 | 55,8 | 205 | 204 |
| hg/tech-hardware/profitable | 3702.TW | 55,6 | 55,6 | 206 | 205 |
| hg/tech-hardware/profitable | 3491.TWO | 55,5 | 55,5 | 207 | 206 |
| hg/tech-hardware/profitable | CGNX | 55,4 | 55,4 | 208 | 207 |
| hg/tech-hardware/profitable | DELL | 55,2 | 55,2 | 209 | 208 |
| hg/tech-hardware/profitable | 301682.SZ | 55,2 | 55,2 | 210 | 209 |
| hg/tech-hardware/profitable | TWEKA.AS | 54,8 | 54,8 | 211 | 210 |
| hg/tech-hardware/profitable | 600673.SS | 54,8 | 54,8 | 212 | 211 |
| hg/tech-hardware/profitable | 301366.SZ | 54,6 | 54,6 | 213 | 212 |
| hg/tech-hardware/profitable | 300224.SZ | 54,6 | 54,6 | 214 | 213 |
| hg/tech-hardware/profitable | 002947.SZ | 54,5 | 54,5 | 215 | 214 |
| hg/tech-hardware/profitable | 6274.TWO | 54,4 | 54,4 | 216 | 215 |
| hg/tech-hardware/profitable | DGII | 54,3 | 54,3 | 217 | 216 |
| hg/tech-hardware/profitable | 600563.SS | 54,1 | 54,1 | 218 | 217 |
| hg/tech-hardware/profitable | 001287.SZ | 54,0 | 54,0 | 219 | 218 |
| hg/tech-hardware/profitable | VNT | 54,0 | 54,0 | 220 | 219 |
| hg/tech-hardware/profitable | 3706.TW | 53,9 | 53,9 | 221 | 220 |
| hg/tech-hardware/profitable | 603236.SS | 53,8 | 53,8 | 222 | 221 |
| hg/tech-hardware/profitable | TRMB | 53,8 | 53,8 | 223 | 222 |
| hg/tech-hardware/profitable | 9960.T | 53,6 | 53,6 | 224 | 223 |
| hg/tech-hardware/profitable | 300101.SZ | 53,6 | 53,6 | 225 | 224 |
| hg/tech-hardware/profitable | 300857.SZ | 53,5 | 53,5 | 226 | 225 |
| hg/tech-hardware/profitable | DIXON.BO | 53,5 | 53,5 | 227 | 226 |
| hg/tech-hardware/profitable | 300628.SZ | 53,4 | 53,4 | 228 | 227 |
| hg/tech-hardware/profitable | 002484.SZ | 53,3 | 53,3 | 229 | 228 |
| hg/tech-hardware/profitable | 688582.SS | 53,2 | 53,2 | 230 | 229 |
| hg/tech-hardware/profitable | 301458.SZ | 53,1 | 53,1 | 231 | 230 |
| hg/tech-hardware/profitable | HEXA-B.ST | 53,0 | 53,0 | 232 | 231 |
| hg/tech-hardware/profitable | 7744.T | 52,9 | 52,9 | 233 | 232 |
| hg/consumer-discretionary/profitable | KALYANKJIL.NS | 91,0 | 91,0 | 8 | 9 |
| hg/consumer-discretionary/profitable | PWH.AX | 89,9 | 89,9 | 9 | 10 |
| hg/consumer-discretionary/profitable | ATZ.TO | 89,6 | 89,6 | 10 | 11 |
| hg/consumer-discretionary/profitable | 0590.HK | 89,3 | 89,3 | 11 | 12 |
| hg/consumer-discretionary/profitable | 301655.SZ | 89,1 | 89,1 | 12 | 13 |
| hg/consumer-discretionary/profitable | LUMAXTECH.BO | 89,0 | 89,0 | 13 | 14 |
| hg/consumer-discretionary/profitable | SSWL.BO | 88,2 | 88,2 | 14 | 15 |
| hg/consumer-discretionary/profitable | CRAFTSMAN.BO | 87,9 | 87,9 | 15 | 16 |
| hg/consumer-discretionary/profitable | 603129.SS | 87,3 | 87,3 | 16 | 17 |
| hg/consumer-discretionary/profitable | SONACOMS.NS | 86,3 | 86,3 | 17 | 18 |
| hg/consumer-discretionary/profitable | EICHERMOT.NS | 86,1 | 86,1 | 18 | 19 |
| hg/consumer-discretionary/profitable | 6015.SR | 84,9 | 84,9 | 19 | 20 |
| hg/consumer-discretionary/profitable | HEROMOTOCO.NS | 84,7 | 84,7 | 20 | 21 |
| hg/consumer-discretionary/profitable | 8919.T | 84,7 | 84,7 | 21 | 22 |
| hg/consumer-discretionary/profitable | 3677.HK | 84,4 | 84,4 | 22 | 23 |
| hg/consumer-discretionary/profitable | CVNA | 84,1 | 84,1 | 23 | 24 |
| hg/consumer-discretionary/profitable | AMCR | 83,8 | 83,8 | 24 | 25 |
| hg/consumer-discretionary/profitable | ENDURANCE.NS | 83,7 | 83,7 | 25 | 26 |
| hg/consumer-discretionary/profitable | 7564.T | 83,3 | 83,3 | 26 | 27 |
| hg/consumer-discretionary/profitable | 2767.T | 83,2 | 83,2 | 27 | 28 |
| hg/consumer-discretionary/profitable | BANCOINDIA.NS | 83,0 | 83,0 | 28 | 29 |
| hg/consumer-discretionary/profitable | SGHC | 82,9 | 82,9 | 29 | 30 |
| hg/consumer-discretionary/profitable | MINDACORP.NS | 82,8 | 82,8 | 30 | 31 |
| hg/consumer-discretionary/profitable | FIVE | 82,4 | 82,4 | 31 | 32 |
| hg/consumer-discretionary/profitable | SANSERA.BO | 82,0 | 82,0 | 32 | 33 |
| hg/consumer-discretionary/profitable | SE | 81,8 | 81,8 | 33 | 34 |
| hg/consumer-discretionary/profitable | PNGJL.BO | 81,7 | 81,7 | 34 | 35 |
| hg/consumer-discretionary/profitable | 5326.KL | 81,6 | 81,6 | 35 | 36 |
| hg/consumer-discretionary/profitable | 301225.SZ | 81,6 | 81,6 | 36 | 37 |
| hg/consumer-discretionary/profitable | 6181.HK | 81,5 | 81,5 | 37 | 38 |
| hg/consumer-discretionary/profitable | 111770.KS | 81,1 | 81,1 | 38 | 39 |
| hg/consumer-discretionary/profitable | MSUMI.BO | 80,9 | 80,9 | 39 | 40 |
| hg/consumer-discretionary/profitable | FDJU.PA | 80,7 | 80,7 | 40 | 41 |
| hg/consumer-discretionary/profitable | 5337.KL | 80,6 | 80,6 | 41 | 42 |
| hg/consumer-discretionary/profitable | WEB.AX | 80,4 | 80,4 | 42 | 43 |
| hg/consumer-discretionary/profitable | 3918.HK | 80,2 | 80,2 | 43 | 44 |
| hg/consumer-discretionary/profitable | 301563.SZ | 80,1 | 80,1 | 44 | 45 |
| hg/consumer-discretionary/profitable | TENNIND.NS | 80,0 | 80,0 | 45 | 46 |
| hg/consumer-discretionary/profitable | 7936.T | 79,7 | 79,7 | 46 | 47 |
| hg/consumer-discretionary/profitable | MARUTI.BO | 79,6 | 79,6 | 47 | 48 |
| hg/consumer-discretionary/profitable | 161390.KS | 79,5 | 79,5 | 48 | 49 |
| hg/consumer-discretionary/profitable | CYD | 79,3 | 79,3 | 49 | 50 |
| hg/consumer-discretionary/profitable | MKS.L | 79,3 | 79,3 | 50 | 51 |
| hg/consumer-discretionary/profitable | SUNDRMFAST.NS | 79,1 | 79,1 | 51 | 52 |
| hg/consumer-discretionary/profitable | 301376.SZ | 79,1 | 79,1 | 52 | 53 |
| hg/consumer-discretionary/profitable | 009970.KS | 79,0 | 79,0 | 53 | 54 |
| hg/consumer-discretionary/profitable | SCHAEFFLER.NS | 78,9 | 78,9 | 54 | 55 |
| hg/consumer-discretionary/profitable | ARVIND.BO | 78,5 | 78,5 | 55 | 56 |
| hg/consumer-discretionary/profitable | 1929.HK | 78,4 | 78,4 | 56 | 57 |
| hg/consumer-discretionary/profitable | DOO | 77,6 | 77,6 | 57 | 58 |
| hg/consumer-discretionary/profitable | 301526.SZ | 77,4 | 77,4 | 58 | 59 |
| hg/consumer-discretionary/profitable | VIK | 77,2 | 77,2 | 59 | 60 |
| hg/consumer-discretionary/profitable | WINA | 77,0 | 77,0 | 60 | 61 |
| hg/consumer-discretionary/profitable | AG1.VI | 76,8 | 76,8 | 61 | 62 |
| hg/consumer-discretionary/profitable | 007340.KS | 76,8 | 76,8 | 62 | 63 |
| hg/consumer-discretionary/profitable | TPR | 76,7 | 76,7 | 63 | 64 |
| hg/consumer-discretionary/profitable | RL | 76,6 | 76,6 | 64 | 65 |
| hg/consumer-discretionary/profitable | 9863.HK | 76,5 | 76,5 | 65 | 66 |
| hg/consumer-discretionary/profitable | TVSMOTOR.BO | 76,4 | 76,4 | 66 | 67 |
| hg/consumer-discretionary/profitable | PUUILO.HE | 76,2 | 76,2 | 67 | 68 |
| hg/consumer-discretionary/profitable | TBOTEK.BO | 76,1 | 76,1 | 68 | 69 |
| hg/consumer-discretionary/profitable | 301488.SZ | 76,0 | 76,0 | 69 | 70 |
| hg/consumer-discretionary/profitable | 002906.SZ | 76,0 | 76,0 | 70 | 71 |
| hg/consumer-discretionary/profitable | NYKAA.BO | 75,9 | 75,9 | 71 | 72 |
| hg/consumer-discretionary/profitable | TVSHLTD.BO | 75,8 | 75,8 | 72 | 73 |
| hg/consumer-discretionary/profitable | THELEELA.NS | 75,7 | 75,7 | 73 | 74 |
| hg/consumer-discretionary/profitable | ULTA | 75,6 | 75,6 | 74 | 75 |
| hg/consumer-discretionary/profitable | 002283.SZ | 75,4 | 75,4 | 75 | 76 |
| hg/consumer-discretionary/profitable | 2726.T | 75,4 | 75,4 | 76 | 77 |
| hg/consumer-discretionary/profitable | LOV.AX | 75,2 | 75,2 | 77 | 78 |
| hg/consumer-discretionary/profitable | 0666.HK | 74,8 | 74,8 | 78 | 79 |
| hg/consumer-discretionary/profitable | KRT | 74,7 | 74,7 | 79 | 80 |
| hg/consumer-discretionary/profitable | RERE | 74,6 | 74,6 | 80 | 81 |
| hg/consumer-discretionary/profitable | 7453.T | 74,5 | 74,5 | 81 | 82 |
| hg/consumer-discretionary/profitable | 601339.SS | 74,2 | 74,2 | 82 | 83 |
| hg/consumer-discretionary/profitable | AGS.SI | 73,9 | 73,9 | 83 | 84 |
| hg/consumer-discretionary/profitable | PLOW | 73,8 | 73,8 | 84 | 85 |
| hg/consumer-discretionary/profitable | BOBS | 73,7 | 73,7 | 85 | 86 |
| hg/consumer-discretionary/profitable | LPP.WA | 73,6 | 73,6 | 86 | 87 |
| hg/consumer-discretionary/profitable | CASY | 73,6 | 73,6 | 87 | 88 |
| hg/consumer-discretionary/profitable | ATMU | 73,6 | 73,6 | 88 | 89 |
| hg/consumer-discretionary/profitable | APOLLOTYRE.NS | 73,5 | 73,5 | 89 | 90 |
| hg/consumer-discretionary/profitable | 021240.KS | 73,4 | 73,4 | 90 | 91 |
| hg/consumer-discretionary/profitable | AS | 73,3 | 73,3 | 91 | 92 |
| hg/consumer-discretionary/profitable | 4732.T | 73,3 | 73,3 | 92 | 93 |
| hg/consumer-discretionary/profitable | MRDIYT.BK | 73,2 | 73,2 | 93 | 94 |
| hg/consumer-discretionary/profitable | FNAC.PA | 73,2 | 73,2 | 94 | 95 |
| hg/consumer-discretionary/profitable | TITAN.BO | 73,2 | 73,2 | 95 | 96 |
| hg/consumer-discretionary/profitable | 4731.KL | 73,1 | 73,1 | 96 | 97 |
| hg/consumer-discretionary/profitable | ROST | 73,1 | 73,1 | 97 | 98 |
| hg/consumer-discretionary/profitable | 3064.T | 72,9 | 72,9 | 98 | 99 |
| hg/consumer-discretionary/profitable | 605599.SS | 72,9 | 72,9 | 99 | 100 |
| hg/consumer-discretionary/profitable | ALWN.AT | 72,9 | 72,9 | 100 | 101 |
| hg/consumer-discretionary/profitable | 603166.SS | 72,9 | 72,9 | 101 | 102 |
| hg/consumer-discretionary/profitable | BAJAJ-AUTO.NS | 72,8 | 72,8 | 102 | 103 |
| hg/consumer-discretionary/profitable | 2585.HK | 72,8 | 72,8 | 103 | 104 |
| hg/consumer-discretionary/profitable | BOOT | 72,7 | 72,7 | 104 | 105 |
| hg/consumer-discretionary/profitable | FTDR | 72,7 | 72,7 | 105 | 106 |
| hg/consumer-discretionary/profitable | H22.SI | 72,6 | 72,6 | 106 | 107 |
| hg/consumer-discretionary/profitable | 002832.SZ | 72,5 | 72,5 | 107 | 108 |
| hg/consumer-discretionary/profitable | 6412.T | 72,5 | 72,5 | 108 | 109 |
| hg/consumer-discretionary/profitable | MAPA.JK | 72,5 | 72,5 | 109 | 110 |
| hg/consumer-discretionary/profitable | 301345.SZ | 72,4 | 72,4 | 110 | 111 |
| hg/consumer-discretionary/profitable | NXT.L | 72,2 | 72,2 | 111 | 112 |
| hg/consumer-discretionary/profitable | 002126.SZ | 72,2 | 72,2 | 112 | 113 |
| hg/consumer-discretionary/profitable | ASKAUTOLTD.NS | 72,2 | 72,2 | 113 | 114 |
| hg/consumer-discretionary/profitable | METROBRAND.NS | 72,2 | 72,2 | 114 | 115 |
| hg/consumer-discretionary/profitable | 1364.HK | 72,1 | 72,1 | 115 | 116 |
| hg/consumer-discretionary/profitable | CCK | 72,0 | 72,0 | 116 | 117 |
| hg/consumer-discretionary/profitable | 9616.T | 71,9 | 71,9 | 117 | 118 |
| hg/consumer-discretionary/profitable | 7282.T | 71,8 | 71,8 | 118 | 119 |
| hg/consumer-discretionary/profitable | DYNAMATECH.NS | 71,6 | 71,6 | 119 | 120 |
| hg/consumer-discretionary/profitable | 002293.SZ | 71,5 | 71,5 | 120 | 121 |
| hg/consumer-discretionary/profitable | 000333.SZ | 71,4 | 71,4 | 121 | 122 |
| hg/consumer-discretionary/profitable | 002448.SZ | 71,4 | 71,4 | 122 | 123 |
| hg/consumer-discretionary/profitable | 001311.SZ | 71,3 | 71,3 | 123 | 124 |
| hg/consumer-discretionary/profitable | SKYGOLD.BO | 71,3 | 71,3 | 124 | 125 |
| hg/consumer-discretionary/profitable | BYLOT.AT | 71,3 | 71,3 | 125 | 126 |
| hg/consumer-discretionary/profitable | 3306.HK | 71,3 | 71,3 | 126 | 127 |
| hg/consumer-discretionary/profitable | APE.AX | 71,0 | 71,0 | 127 | 128 |
| hg/consumer-discretionary/profitable | SON | 70,9 | 70,9 | 128 | 129 |
| hg/consumer-discretionary/profitable | 605319.SS | 70,9 | 70,9 | 129 | 130 |
| hg/consumer-discretionary/profitable | BALL | 70,8 | 70,8 | 130 | 131 |
| hg/consumer-discretionary/profitable | GTX | 70,8 | 70,8 | 131 | 132 |
| hg/consumer-discretionary/profitable | FIGS | 70,7 | 70,7 | 132 | 133 |
| hg/consumer-discretionary/profitable | 3774.HK | 70,6 | 70,6 | 133 | 134 |
| hg/consumer-discretionary/profitable | HSAI | 70,6 | 70,6 | 134 | 135 |
| hg/consumer-discretionary/profitable | MOON.L | 70,6 | 70,6 | 135 | 136 |
| hg/consumer-discretionary/profitable | 9992.HK | 70,6 | 93,2 | 136 | 8 |
| hg/health-care/profitable | 002294.SZ | 57,4 | 51,4 | 228 | 298 |
| hg/health-care/profitable | 603456.SS | 57,3 | 57,3 | 229 | 228 |
| hg/health-care/profitable | 2070.SR | 57,3 | 57,3 | 230 | 229 |
| hg/health-care/profitable | 603658.SS | 57,1 | 57,1 | 231 | 230 |
| hg/health-care/profitable | MAXHEALTH.BO | 57,1 | 57,1 | 232 | 231 |
| hg/health-care/profitable | 603939.SS | 57,0 | 57,0 | 233 | 232 |
| hg/health-care/profitable | 603233.SS | 57,0 | 57,0 | 234 | 233 |
| hg/health-care/profitable | SEPN | 56,7 | 56,7 | 235 | 234 |
| hg/health-care/profitable | STE | 56,7 | 56,7 | 236 | 235 |
| hg/health-care/profitable | BTSG | 56,5 | 56,5 | 237 | 236 |
| hg/health-care/profitable | 688108.SS | 56,3 | 56,3 | 238 | 237 |
| hg/health-care/profitable | DRW3.DE | 56,2 | 56,2 | 239 | 238 |
| hg/health-care/profitable | 300171.SZ | 56,2 | 56,2 | 240 | 239 |
| hg/health-care/profitable | BONEX.ST | 56,2 | 56,2 | 241 | 240 |
| hg/health-care/profitable | IRMD | 56,2 | 56,2 | 242 | 241 |
| hg/health-care/profitable | OSCR | 56,1 | 56,1 | 243 | 242 |
| hg/health-care/profitable | 5878.KL | 56,1 | 56,1 | 244 | 243 |
| hg/health-care/profitable | 1177.HK | 56,0 | 56,0 | 245 | 244 |
| hg/health-care/profitable | VCEL | 56,0 | 56,0 | 246 | 245 |
| hg/health-care/profitable | 688105.SS | 55,9 | 55,9 | 247 | 246 |
| hg/health-care/profitable | VIYASH.BO | 55,9 | 55,9 | 248 | 247 |
| hg/health-care/profitable | HCG.NS | 55,7 | 55,7 | 249 | 248 |
| hg/health-care/profitable | AMBU-B.CO | 55,7 | 55,7 | 250 | 249 |
| hg/health-care/profitable | LIVN | 55,6 | 55,6 | 251 | 250 |
| hg/health-care/profitable | 2268.HK | 55,6 | 55,6 | 252 | 251 |
| hg/health-care/profitable | 4528.T | 55,4 | 55,4 | 253 | 252 |
| hg/health-care/profitable | SHC | 55,2 | 55,2 | 254 | 253 |
| hg/health-care/profitable | KNSA | 55,2 | 55,2 | 255 | 254 |
| hg/health-care/profitable | 002030.SZ | 55,2 | 55,2 | 256 | 255 |
| hg/health-care/profitable | MCK | 55,1 | 55,1 | 257 | 256 |
| hg/health-care/profitable | GSK | 54,9 | 54,9 | 258 | 257 |
| hg/health-care/profitable | BIOCON.BO | 54,8 | 54,8 | 259 | 258 |
| hg/health-care/profitable | HCA | 54,8 | 54,8 | 260 | 259 |
| hg/health-care/profitable | SUNPHARMA.BO | 54,8 | 54,8 | 261 | 260 |
| hg/health-care/profitable | 4007.SR | 54,7 | 54,7 | 262 | 261 |
| hg/health-care/profitable | AMGN | 54,6 | 54,6 | 263 | 262 |
| hg/health-care/profitable | 4164.SR | 54,6 | 54,6 | 264 | 263 |
| hg/health-care/profitable | 7730.T | 54,5 | 54,5 | 265 | 264 |
| hg/health-care/profitable | 1795.TW | 54,4 | 54,4 | 266 | 265 |
| hg/health-care/profitable | 1801.HK | 54,4 | 54,4 | 267 | 266 |
| hg/health-care/profitable | AFX.VI | 54,3 | 54,3 | 268 | 267 |
| hg/health-care/profitable | AMN | 54,1 | 54,1 | 269 | 268 |
| hg/health-care/profitable | MCOV-B.ST | 54,0 | 54,0 | 270 | 269 |
| hg/health-care/profitable | BSLN.SW | 53,9 | 53,9 | 271 | 270 |
| hg/health-care/profitable | JAZZ | 53,8 | 53,8 | 272 | 271 |
| hg/health-care/profitable | DIM.VI | 53,7 | 53,7 | 273 | 272 |
| hg/health-care/profitable | 300529.SZ | 53,7 | 53,7 | 274 | 273 |
| hg/health-care/profitable | UHS | 53,5 | 53,5 | 275 | 274 |
| hg/health-care/profitable | SNW.DE | 53,4 | 53,4 | 276 | 275 |
| hg/health-care/profitable | 300888.SZ | 53,4 | 53,4 | 277 | 276 |
| hg/health-care/profitable | TMDX | 53,3 | 53,3 | 278 | 277 |
| hg/health-care/profitable | 7476.T | 53,3 | 53,3 | 279 | 278 |
| hg/health-care/profitable | VCYT | 53,2 | 53,2 | 280 | 279 |
| hg/health-care/profitable | 7649.T | 52,9 | 52,9 | 281 | 280 |
| hg/health-care/profitable | 0241.HK | 52,9 | 52,9 | 282 | 281 |
| hg/health-care/profitable | RPRX | 52,8 | 52,8 | 283 | 282 |
| hg/health-care/profitable | ADRX | 52,7 | 52,7 | 284 | 283 |
| hg/health-care/profitable | 300049.SZ | 52,6 | 52,6 | 285 | 284 |
| hg/health-care/profitable | DOCS | 52,4 | 52,4 | 286 | 285 |
| hg/health-care/profitable | 3088.T | 52,3 | 52,3 | 287 | 286 |
| hg/health-care/profitable | ELAN | 52,3 | 52,3 | 288 | 287 |
| hg/health-care/profitable | DVA | 52,2 | 52,2 | 289 | 288 |
| hg/health-care/profitable | COR | 52,1 | 52,1 | 290 | 289 |
| hg/health-care/profitable | 002349.SZ | 52,1 | 52,1 | 291 | 290 |
| hg/health-care/profitable | 002001.SZ | 52,1 | 52,1 | 292 | 291 |
| hg/health-care/profitable | ELV | 52,1 | 52,1 | 293 | 292 |
| hg/health-care/profitable | NUTX | 51,8 | 51,8 | 294 | 293 |
| hg/health-care/profitable | SHL.VI | 51,7 | 51,7 | 295 | 294 |
| hg/health-care/profitable | 6849.T | 51,6 | 51,6 | 296 | 295 |
| hg/health-care/profitable | 300181.SZ | 51,6 | 51,6 | 297 | 296 |
| hg/health-care/profitable | ABT | 51,5 | 51,5 | 298 | 297 |
| hg/semiconductors/profitable | 600360.SS | nicht enthalten | 40,8 | nicht enthalten | ohne Rang |
| hg/energy/profitable | ENOG.L | 39,6 | 35,3 | 256 | 277 |
| hg/energy/profitable | TGS | 39,6 | 39,6 | 257 | 256 |
| hg/energy/profitable | YAL.AX | 39,4 | 39,4 | 258 | 257 |
| hg/energy/profitable | HWX.TO | 38,8 | 38,8 | 259 | 258 |
| hg/energy/profitable | SPM3.VI | 38,6 | 38,6 | 260 | 259 |
| hg/energy/profitable | ADRO.JK | 38,5 | 38,5 | 261 | 260 |
| hg/energy/profitable | BWLP | 38,2 | 38,2 | 262 | 261 |
| hg/energy/profitable | 600026.SS | 38,1 | 38,1 | 263 | 262 |
| hg/energy/profitable | 010950.KS | 38,1 | 38,1 | 264 | 263 |
| hg/energy/profitable | ODL.OL | 38,0 | 38,0 | 265 | 264 |
| hg/energy/profitable | QFLS.QA | 37,7 | 37,7 | 266 | 265 |
| hg/energy/profitable | 601666.SS | 37,6 | 37,6 | 267 | 266 |
| hg/energy/profitable | WTTR | 37,5 | 37,5 | 268 | 267 |
| hg/energy/profitable | NOV | 37,4 | 37,4 | 269 | 268 |
| hg/energy/profitable | TGS.OL | 37,4 | 37,4 | 270 | 269 |
| hg/energy/profitable | BKR | 36,9 | 36,9 | 271 | 270 |
| hg/energy/profitable | MNR | 36,6 | 36,6 | 272 | 271 |
| hg/energy/profitable | GLNG | 36,5 | 36,5 | 273 | 272 |
| hg/energy/profitable | ALD.AX | 36,4 | 36,4 | 274 | 273 |
| hg/energy/profitable | CCJ | 35,9 | 35,9 | 275 | 274 |
| hg/energy/profitable | WOR.AX | 35,5 | 35,5 | 276 | 275 |
| hg/energy/profitable | 6033.KL | 35,5 | 35,5 | 277 | 276 |
| quality/quality-materials/profitable | TATASTEEL.BO | 64,4 | 64,4 | 178 | 179 |
| quality/quality-materials/profitable | BAYERCROP.BO | 64,2 | 64,2 | 179 | 180 |
| quality/quality-materials/profitable | FACT.BO | 64,2 | 64,2 | 180 | 181 |
| quality/quality-materials/profitable | EIDPARRY.BO | 64,2 | 64,2 | 181 | 182 |
| quality/quality-materials/profitable | CLEAN.BO | 64,1 | 64,1 | 182 | 183 |
| quality/quality-materials/profitable | BVN | 64,1 | 64,1 | 183 | 184 |
| quality/quality-materials/profitable | 002842.SZ | 64,1 | 64,1 | 184 | 185 |
| quality/quality-materials/profitable | 301373.SZ | 63,9 | 63,9 | 185 | 186 |
| quality/quality-materials/profitable | SHW | 63,9 | 63,9 | 186 | 187 |
| quality/quality-materials/profitable | ENAEX.SN | 63,8 | 63,8 | 187 | 188 |
| quality/quality-materials/profitable | 300285.SZ | 63,7 | 63,7 | 188 | 189 |
| quality/quality-materials/profitable | DPM.AX | 63,6 | 63,6 | 189 | 190 |
| quality/quality-materials/profitable | ATUL.NS | 63,6 | 63,6 | 190 | 191 |
| quality/quality-materials/profitable | 000933.SZ | 63,6 | 63,6 | 191 | 192 |
| quality/quality-materials/profitable | 000807.SZ | 63,5 | 63,5 | 192 | 193 |
| quality/quality-materials/profitable | XVOLB.MC | 63,5 | 63,5 | 193 | 194 |
| quality/quality-materials/profitable | 601958.SS | 63,5 | 63,5 | 194 | 195 |
| quality/quality-materials/profitable | 1KEMI.MI | 63,4 | 63,4 | 195 | 196 |
| quality/quality-materials/profitable | NHY.OL | 63,4 | 63,4 | 196 | 197 |
| quality/quality-materials/profitable | 2020.SR | 63,1 | 63,1 | 197 | 198 |
| quality/quality-materials/profitable | USLM | 63,1 | 63,1 | 198 | 199 |
| quality/quality-materials/profitable | DESN.SW | 63,1 | 63,1 | 199 | 200 |
| quality/quality-materials/profitable | SUDARSCHEM.NS | 62,9 | 62,9 | 200 | 201 |
| quality/quality-materials/profitable | CSC.AX | 62,9 | 62,9 | 201 | 202 |
| quality/quality-materials/profitable | CMIN3.SA | 62,7 | 62,7 | 202 | 203 |
| quality/quality-materials/profitable | BREE.L | 62,6 | 62,6 | 203 | 204 |
| quality/quality-materials/profitable | HMY | 62,4 | 62,4 | 204 | 205 |
| quality/quality-materials/profitable | PAAS | 62,4 | 62,4 | 205 | 206 |
| quality/quality-materials/profitable | AG | 62,3 | 62,3 | 206 | 207 |
| quality/quality-materials/profitable | JSWCEMENT.BO | 62,3 | 62,3 | 207 | 208 |
| quality/quality-materials/profitable | 301219.SZ | 62,3 | 62,3 | 208 | 209 |
| quality/quality-materials/profitable | 2259.HK | 62,3 | 62,3 | 209 | 210 |
| quality/quality-materials/profitable | FSM | 62,3 | 62,3 | 210 | 211 |
| quality/quality-materials/profitable | LTR.AX | 62,3 | 62,3 | 211 | 212 |
| quality/quality-materials/profitable | 603256.SS | 62,2 | 62,2 | 212 | 213 |
| quality/quality-materials/profitable | 000792.SZ | 62,2 | 62,2 | 213 | 214 |
| quality/quality-materials/profitable | RS | 61,9 | 61,9 | 214 | 215 |
| quality/quality-materials/profitable | 600490.SS | 61,8 | 61,8 | 215 | 216 |
| quality/quality-materials/profitable | FLUOROCHEM.NS | 61,8 | 61,8 | 216 | 217 |
| quality/quality-materials/profitable | 605020.SS | 61,6 | 61,6 | 217 | 218 |
| quality/quality-materials/profitable | SBSW | 61,6 | 61,6 | 218 | 219 |
| quality/quality-materials/profitable | VINATIORGA.NS | 61,5 | 61,5 | 219 | 220 |
| quality/quality-materials/profitable | NVG.LS | 61,5 | 61,5 | 220 | 221 |
| quality/quality-materials/profitable | PRN.AX | 61,4 | 61,4 | 221 | 222 |
| quality/quality-materials/profitable | 4403.T | 61,4 | 61,4 | 222 | 223 |
| quality/quality-materials/profitable | 600389.SS | 61,3 | 64,4 | 223 | 178 |
| quality/quality-tech-hardware/profitable | 000636.SZ | 45,0 | 38,9 | 329 | 400 |
| quality/quality-tech-hardware/profitable | 300814.SZ | 45,0 | 45,0 | 330 | 329 |
| quality/quality-tech-hardware/profitable | 300136.SZ | 44,8 | 44,8 | 331 | 330 |
| quality/quality-tech-hardware/profitable | 9824.T | 44,7 | 44,7 | 332 | 331 |
| quality/quality-tech-hardware/profitable | 688635.SS | 44,7 | 44,7 | 333 | 332 |
| quality/quality-tech-hardware/profitable | 300224.SZ | 44,6 | 44,6 | 334 | 333 |
| quality/quality-tech-hardware/profitable | 301280.SZ | 44,6 | 44,6 | 335 | 334 |
| quality/quality-tech-hardware/profitable | 2385.TW | 44,5 | 44,5 | 336 | 335 |
| quality/quality-tech-hardware/profitable | 301366.SZ | 44,3 | 44,3 | 337 | 336 |
| quality/quality-tech-hardware/profitable | 6762.T | 44,3 | 44,3 | 338 | 337 |
| quality/quality-tech-hardware/profitable | 300939.SZ | 44,2 | 44,2 | 339 | 338 |
| quality/quality-tech-hardware/profitable | 4749.TWO | 44,2 | 44,2 | 340 | 339 |
| quality/quality-tech-hardware/profitable | 6724.T | 44,1 | 44,1 | 341 | 340 |
| quality/quality-tech-hardware/profitable | 688818.SS | 43,9 | 43,9 | 342 | 341 |
| quality/quality-tech-hardware/profitable | 002025.SZ | 43,9 | 43,9 | 343 | 342 |
| quality/quality-tech-hardware/profitable | 600198.SS | 43,9 | 43,9 | 344 | 343 |
| quality/quality-tech-hardware/profitable | ESE | 43,9 | 43,9 | 345 | 344 |
| quality/quality-tech-hardware/profitable | NOK | 43,9 | 43,9 | 346 | 345 |
| quality/quality-tech-hardware/profitable | 301421.SZ | 43,8 | 43,8 | 347 | 346 |
| quality/quality-tech-hardware/profitable | MSI | 43,7 | 43,7 | 348 | 347 |
| quality/quality-tech-hardware/profitable | 8070.TW | 43,7 | 43,7 | 349 | 348 |
| quality/quality-tech-hardware/profitable | 002139.SZ | 43,7 | 43,7 | 350 | 349 |
| quality/quality-tech-hardware/profitable | 600060.SS | 43,6 | 43,6 | 351 | 350 |
| quality/quality-tech-hardware/profitable | 300480.SZ | 43,5 | 43,5 | 352 | 351 |
| quality/quality-tech-hardware/profitable | 000021.SZ | 43,4 | 43,4 | 353 | 352 |
| quality/quality-tech-hardware/profitable | 2356.TW | 43,4 | 43,4 | 354 | 353 |
| quality/quality-tech-hardware/profitable | V03.SI | 43,4 | 43,4 | 355 | 354 |
| quality/quality-tech-hardware/profitable | 300140.SZ | 43,0 | 43,0 | 356 | 355 |
| quality/quality-tech-hardware/profitable | 688583.SS | 43,0 | 43,0 | 357 | 356 |
| quality/quality-tech-hardware/profitable | PLXS | 43,0 | 43,0 | 358 | 357 |
| quality/quality-tech-hardware/profitable | 002815.SZ | 42,9 | 42,9 | 359 | 358 |
| quality/quality-tech-hardware/profitable | 009150.KS | 42,9 | 42,9 | 360 | 359 |
| quality/quality-tech-hardware/profitable | 603186.SS | 42,9 | 42,9 | 361 | 360 |
| quality/quality-tech-hardware/profitable | 3396.HK | 42,8 | 42,8 | 362 | 361 |
| quality/quality-tech-hardware/profitable | 301486.SZ | 42,2 | 42,2 | 363 | 362 |
| quality/quality-tech-hardware/profitable | 002169.SZ | 42,2 | 42,2 | 364 | 363 |
| quality/quality-tech-hardware/profitable | 600552.SS | 42,0 | 42,0 | 365 | 364 |
| quality/quality-tech-hardware/profitable | 0270.KL | 41,9 | 41,9 | 366 | 365 |
| quality/quality-tech-hardware/profitable | 1JEN.MI | 41,9 | 41,9 | 367 | 366 |
| quality/quality-tech-hardware/profitable | 6588.T | 41,9 | 41,9 | 368 | 367 |
| quality/quality-tech-hardware/profitable | 300857.SZ | 41,9 | 41,9 | 369 | 368 |
| quality/quality-tech-hardware/profitable | SENS.SW | 41,8 | 41,8 | 370 | 369 |
| quality/quality-tech-hardware/profitable | 6787.T | 41,6 | 41,6 | 371 | 370 |
| quality/quality-tech-hardware/profitable | 011070.KS | 41,6 | 41,6 | 372 | 371 |
| quality/quality-tech-hardware/profitable | 600105.SS | 41,6 | 41,6 | 373 | 372 |
| quality/quality-tech-hardware/profitable | 688661.SS | 41,4 | 41,4 | 374 | 373 |
| quality/quality-tech-hardware/profitable | 0215.KL | 41,4 | 41,4 | 375 | 374 |
| quality/quality-tech-hardware/profitable | 001326.SZ | 41,0 | 41,0 | 376 | 375 |
| quality/quality-tech-hardware/profitable | 002881.SZ | 41,0 | 41,0 | 377 | 376 |
| quality/quality-tech-hardware/profitable | 2357.TW | 40,9 | 40,9 | 378 | 377 |
| quality/quality-tech-hardware/profitable | OSIS | 40,9 | 40,9 | 379 | 378 |
| quality/quality-tech-hardware/profitable | 300602.SZ | 40,8 | 40,8 | 380 | 379 |
| quality/quality-tech-hardware/profitable | 000062.SZ | 40,8 | 40,8 | 381 | 380 |
| quality/quality-tech-hardware/profitable | 0968.HK | 40,8 | 40,8 | 382 | 381 |
| quality/quality-tech-hardware/profitable | VSAT | 40,6 | 40,6 | 383 | 382 |
| quality/quality-tech-hardware/profitable | 000938.SZ | 40,6 | 40,6 | 384 | 383 |
| quality/quality-tech-hardware/profitable | 002925.SZ | 40,5 | 40,5 | 385 | 384 |
| quality/quality-tech-hardware/profitable | 6951.T | 40,4 | 40,4 | 386 | 385 |
| quality/quality-tech-hardware/profitable | 002475.SZ | 40,4 | 40,4 | 387 | 386 |
| quality/quality-tech-hardware/profitable | 002955.SZ | 40,3 | 40,3 | 388 | 387 |
| quality/quality-tech-hardware/profitable | 066570.KS | 40,3 | 40,3 | 389 | 388 |
| quality/quality-tech-hardware/profitable | 3037.TW | 39,7 | 39,7 | 390 | 389 |
| quality/quality-tech-hardware/profitable | 300303.SZ | 39,5 | 39,5 | 391 | 390 |
| quality/quality-tech-hardware/profitable | 8046.TW | 39,4 | 39,4 | 392 | 391 |
| quality/quality-tech-hardware/profitable | 6810.HK | 39,3 | 39,3 | 393 | 392 |
| quality/quality-tech-hardware/profitable | 688375.SS | 39,3 | 39,3 | 394 | 393 |
| quality/quality-tech-hardware/profitable | 001339.SZ | 39,2 | 39,2 | 395 | 394 |
| quality/quality-tech-hardware/profitable | 300747.SZ | 39,2 | 39,2 | 396 | 395 |
| quality/quality-tech-hardware/profitable | 2347.TW | 39,1 | 39,1 | 397 | 396 |
| quality/quality-tech-hardware/profitable | 002841.SZ | 39,1 | 39,1 | 398 | 397 |
| quality/quality-tech-hardware/profitable | 300735.SZ | 39,0 | 39,0 | 399 | 398 |
| quality/quality-tech-hardware/profitable | 603936.SS | 39,0 | 39,0 | 400 | 399 |
| quality/quality-consumer-discretionary/profitable | MRDIYT.BK | 85,4 | 85,4 | 7 | 8 |
| quality/quality-consumer-discretionary/profitable | 7685.T | 84,1 | 84,1 | 8 | 9 |
| quality/quality-consumer-discretionary/profitable | PWH.AX | 83,3 | 83,3 | 9 | 10 |
| quality/quality-consumer-discretionary/profitable | 8932.TWO | 83,0 | 83,0 | 10 | 11 |
| quality/quality-consumer-discretionary/profitable | 3092.T | 82,3 | 82,3 | 11 | 12 |
| quality/quality-consumer-discretionary/profitable | FDJU.PA | 82,0 | 82,0 | 12 | 13 |
| quality/quality-consumer-discretionary/profitable | 7936.T | 81,3 | 81,3 | 13 | 14 |
| quality/quality-consumer-discretionary/profitable | SGHC | 80,7 | 80,7 | 14 | 15 |
| quality/quality-consumer-discretionary/profitable | LPP.WA | 80,6 | 80,6 | 15 | 16 |
| quality/quality-consumer-discretionary/profitable | SL.MI | 80,5 | 80,5 | 16 | 17 |
| quality/quality-consumer-discretionary/profitable | TBOTEK.BO | 80,4 | 80,4 | 17 | 18 |
| quality/quality-consumer-discretionary/profitable | MDIY.JK | 80,1 | 80,1 | 18 | 19 |
| quality/quality-consumer-discretionary/profitable | LOV.AX | 79,4 | 79,4 | 19 | 20 |
| quality/quality-consumer-discretionary/profitable | BANCOINDIA.NS | 79,3 | 79,3 | 20 | 21 |
| quality/quality-consumer-discretionary/profitable | MOON.L | 79,3 | 79,3 | 21 | 22 |
| quality/quality-consumer-discretionary/profitable | 605098.SS | 79,2 | 79,2 | 22 | 23 |
| quality/quality-consumer-discretionary/profitable | SEDEMAC.NS | 79,2 | 79,2 | 23 | 24 |
| quality/quality-consumer-discretionary/profitable | 2020.HK | 78,7 | 78,7 | 24 | 25 |
| quality/quality-consumer-discretionary/profitable | 6015.SR | 78,7 | 78,7 | 25 | 26 |
| quality/quality-consumer-discretionary/profitable | 4732.T | 78,3 | 78,3 | 26 | 27 |
| quality/quality-consumer-discretionary/profitable | TGYM.MI | 77,5 | 77,5 | 27 | 28 |
| quality/quality-consumer-discretionary/profitable | 9992.HK | 77,5 | 86,5 | 28 | 7 |
| quality/quality-health-care/profitable | LENSKART.NS | 61,2 | 61,2 | 169 | 170 |
| quality/quality-health-care/profitable | APOLLOHOSP.NS | 61,1 | 61,1 | 170 | 171 |
| quality/quality-health-care/profitable | 301580.SZ | 61,0 | 61,0 | 171 | 172 |
| quality/quality-health-care/profitable | GMED | 61,0 | 61,0 | 172 | 173 |
| quality/quality-health-care/profitable | 4528.T | 61,0 | 61,0 | 173 | 174 |
| quality/quality-health-care/profitable | 300832.SZ | 61,0 | 61,0 | 174 | 175 |
| quality/quality-health-care/profitable | SAILIFE.BO | 60,8 | 60,8 | 175 | 176 |
| quality/quality-health-care/profitable | TMDX | 60,7 | 60,7 | 176 | 177 |
| quality/quality-health-care/profitable | GILD | 60,7 | 60,7 | 177 | 178 |
| quality/quality-health-care/profitable | LMAT | 60,6 | 60,6 | 178 | 179 |
| quality/quality-health-care/profitable | 002901.SZ | 60,6 | 60,6 | 179 | 180 |
| quality/quality-health-care/profitable | 300009.SZ | 60,5 | 60,5 | 180 | 181 |
| quality/quality-health-care/profitable | PARKHOSPS.BO | 60,5 | 60,5 | 181 | 182 |
| quality/quality-health-care/profitable | 688108.SS | 60,5 | 60,5 | 182 | 183 |
| quality/quality-health-care/profitable | 688336.SS | 60,4 | 60,4 | 183 | 184 |
| quality/quality-health-care/profitable | STMN.VI | 60,2 | 60,2 | 184 | 185 |
| quality/quality-health-care/profitable | SYK | 60,2 | 60,2 | 185 | 186 |
| quality/quality-health-care/profitable | DXCM | 60,1 | 60,1 | 186 | 187 |
| quality/quality-health-care/profitable | HCA | 60,0 | 60,0 | 187 | 188 |
| quality/quality-health-care/profitable | WOCKPHARMA.NS | 60,0 | 60,0 | 188 | 189 |
| quality/quality-health-care/profitable | PGHL.BO | 59,9 | 59,9 | 189 | 190 |
| quality/quality-health-care/profitable | 068270.KS | 59,9 | 59,9 | 190 | 191 |
| quality/quality-health-care/profitable | 2096.HK | 59,9 | 59,9 | 191 | 192 |
| quality/quality-health-care/profitable | KIMS.BO | 59,7 | 59,7 | 192 | 193 |
| quality/quality-health-care/profitable | NUTX | 59,4 | 59,4 | 193 | 194 |
| quality/quality-health-care/profitable | 002294.SZ | 59,4 | 61,2 | 194 | 169 |
| quality/quality-semiconductors/profitable | 600360.SS | 42,4 | 40,1 | 180 | 191 |
| quality/quality-semiconductors/profitable | 688536.SS | 41,5 | 41,5 | 181 | 180 |
| quality/quality-semiconductors/profitable | PLAB | 41,4 | 41,4 | 182 | 181 |
| quality/quality-semiconductors/profitable | 688230.SS | 41,3 | 41,3 | 183 | 182 |
| quality/quality-semiconductors/profitable | 603078.SS | 41,1 | 41,1 | 184 | 183 |
| quality/quality-semiconductors/profitable | 300327.SZ | 41,0 | 41,0 | 185 | 184 |
| quality/quality-semiconductors/profitable | 688082.SS | 40,9 | 40,9 | 186 | 185 |
| quality/quality-semiconductors/profitable | 688261.SS | 40,7 | 40,7 | 187 | 186 |
| quality/quality-semiconductors/profitable | 605111.SS | 40,7 | 40,7 | 188 | 187 |
| quality/quality-semiconductors/profitable | AWX.SI | 40,5 | 40,5 | 189 | 188 |
| quality/quality-semiconductors/profitable | 688757.SS | 40,5 | 40,5 | 190 | 189 |
| quality/quality-semiconductors/profitable | 5483.TWO | 40,4 | 40,4 | 191 | 190 |
| quality/quality-energy/profitable | ENOG.L | 58,3 | 53,6 | 97 | 144 |
| quality/quality-energy/profitable | TRMD | 58,1 | 58,1 | 98 | 97 |
| quality/quality-energy/profitable | BP | 58,1 | 58,1 | 99 | 98 |
| quality/quality-energy/profitable | PR | 58,1 | 58,1 | 100 | 99 |
| quality/quality-energy/profitable | COP | 57,9 | 57,9 | 101 | 100 |
| quality/quality-energy/profitable | FANG | 57,7 | 57,7 | 102 | 101 |
| quality/quality-energy/profitable | BRAV3.SA | 57,6 | 57,6 | 103 | 102 |
| quality/quality-energy/profitable | AEGISVOPAK.NS | 57,3 | 57,3 | 104 | 103 |
| quality/quality-energy/profitable | VTOL | 57,2 | 57,2 | 105 | 104 |
| quality/quality-energy/profitable | ONGC.BO | 57,1 | 57,1 | 106 | 105 |
| quality/quality-energy/profitable | QGTS.QA | 57,1 | 57,1 | 107 | 106 |
| quality/quality-energy/profitable | TGS | 57,1 | 57,1 | 108 | 107 |
| quality/quality-energy/profitable | WCP.TO | 56,9 | 56,9 | 109 | 108 |
| quality/quality-energy/profitable | 002128.SZ | 56,8 | 56,8 | 110 | 109 |
| quality/quality-energy/profitable | ODL.OL | 56,8 | 56,8 | 111 | 110 |
| quality/quality-energy/profitable | AADI.JK | 56,8 | 56,8 | 112 | 111 |
| quality/quality-energy/profitable | VPK.AS | 56,7 | 56,7 | 113 | 112 |
| quality/quality-energy/profitable | EC | 56,6 | 56,6 | 114 | 113 |
| quality/quality-energy/profitable | ENRG.JK | 56,6 | 56,6 | 115 | 114 |
| quality/quality-energy/profitable | SCR.TO | 56,4 | 56,4 | 116 | 115 |
| quality/quality-energy/profitable | MPLX | 56,3 | 56,3 | 117 | 116 |
| quality/quality-energy/profitable | 300191.SZ | 56,3 | 56,3 | 118 | 117 |
| quality/quality-energy/profitable | ATH.TO | 56,2 | 56,2 | 119 | 118 |
| quality/quality-energy/profitable | 1277.HK | 56,0 | 56,0 | 120 | 119 |
| quality/quality-energy/profitable | HINDPETRO.NS | 56,0 | 56,0 | 121 | 120 |
| quality/quality-energy/profitable | AKSO.OL | 55,7 | 55,7 | 122 | 121 |
| quality/quality-energy/profitable | EROK | 55,7 | 55,7 | 123 | 122 |
| quality/quality-energy/profitable | BPCL.NS | 55,6 | 55,6 | 124 | 123 |
| quality/quality-energy/profitable | 6269.T | 55,6 | 55,6 | 125 | 124 |
| quality/quality-energy/profitable | 601001.SS | 55,5 | 55,5 | 126 | 125 |
| quality/quality-energy/profitable | TGS.OL | 55,5 | 55,5 | 127 | 126 |
| quality/quality-energy/profitable | TOT.TO | 55,4 | 55,4 | 128 | 127 |
| quality/quality-energy/profitable | NVGS | 55,2 | 55,2 | 129 | 128 |
| quality/quality-energy/profitable | MEDC.JK | 55,0 | 55,0 | 130 | 129 |
| quality/quality-energy/profitable | 267250.KS | 55,0 | 55,0 | 131 | 130 |
| quality/quality-energy/profitable | FLUX.BR | 54,7 | 54,7 | 132 | 131 |
| quality/quality-energy/profitable | AR | 54,4 | 54,4 | 133 | 132 |
| quality/quality-energy/profitable | RUI.VI | 54,4 | 54,4 | 134 | 133 |
| quality/quality-energy/profitable | ENB | 54,3 | 54,3 | 135 | 134 |
| quality/quality-energy/profitable | NOG | 54,3 | 54,3 | 136 | 135 |
| quality/quality-energy/profitable | VLO | 54,3 | 54,3 | 137 | 136 |
| quality/quality-energy/profitable | WHC.AX | 53,9 | 53,9 | 138 | 137 |
| quality/quality-energy/profitable | ALA.TO | 53,9 | 53,9 | 139 | 138 |
| quality/quality-energy/profitable | SOBO | 53,8 | 53,8 | 140 | 139 |
| quality/quality-energy/profitable | TRGP | 53,8 | 53,8 | 141 | 140 |
| quality/quality-energy/profitable | 018670.KS | 53,7 | 53,7 | 142 | 141 |
| quality/quality-energy/profitable | GALP.LS | 53,6 | 53,6 | 143 | 142 |
| quality/quality-energy/profitable | RELIANCE.NS | 53,6 | 53,6 | 144 | 143 |


## Nachtrag, zweite Nacharbeit vom 07.11.2026

Die vorherigen Abschnitte bewahren den Bericht der ersten Runde unverändert. Für den jetzigen Stand gilt dieser Nachtrag; Claudes blinde Prüfung ist weiterhin offen.

Gleicher Datentag **31.10.2026**, Ausgangskopf **4c5620ce99d175ad3e775cac472c4686643a6d9b**. 15.826 Snapshots, 15.815 autorisierte Ticker, 48 HG-/Quality-Boards und 16.391 gemeinsame Board-Zeilen. **8 Scores und 173 Ränge** ändern sich, keine Ein- oder Austritte und keine Wechsel in den ersten 100. Nur sechs GP-Rohachsen ändern sich. Alle neun übrigen Rohachsen einschließlich jährlicher Beschleunigung und capitalEfficiency sind exakt gleich.

- **N1:** In `overview.js::growthVerdict` konkurriert der ergänzte Jahreswert mit dem Quartal. Energean zeigt −36,4773 % zum 31.03.2026 statt −26,2799 % zum 31.12.2025. Der irreführende Jahreshinweis entfällt beim Quartal. Alle sechs Firmen sind mit echten Daten sowie neueren, gleichen, älteren und fehlenden Quartalen geprüft.
- **N2:** In `axes.js::gpGrowth` entfällt bei Energean nur der unbelegte Margenzuschlag. Restated 2024 belegt keine Vergleichbarkeit mit einer älteren Anbieter-Marge. Entscheidungssicherheit **98 %**. Das belegte jährliche GP-Wachstum bleibt vorhanden.
- **N3:** Das lokale Margenfenster rollt um ein Jahr weiter. Bei den fünf übrigen Firmen vergleicht es 2025 mit 2022, drei Jahre wie im normalen Pfad, statt 2025 mit 2021. Keine Positionsreihe wird geändert.
- **N4:** `handtabellen-fristen.js::fristen` warnt für Jahresergänzungen erst sieben Tage vor Ablauf, erstmals 27.11. statt 04.11.; Frist 04.12. unverändert. Eine Woche ermöglicht die Prüfung, ohne den gesamten Monatszyklus zu warnen, Entscheidungssicherheit **95 %**. Der Text nennt den Aufhebungsbeleg: passende Anbieterwerte für Umsatz und GP bis 31.12.2025 mit geprüfter Währung, Einheit und Vergleichsbasis; sonst erneute Quellen-/Vorjahresprüfung vor Ablauf.
- **N5:** Der vorherige Bericht ist vollständig hier erhalten. Beide bisherigen Berichtsverweise der Registrierung zeigen auf diese Datei. Die ungetrackten Originale im Klon bleiben unverändert.

Elf Einzeltestdateien sind mit Exit 0 geprüft: **119 Fälle/Prüfblöcke** sowie 393 dokumentationspflichtige Exporte ohne Lücke. In der Review-Testdatei werden **12 absichtliche Bruchproben** erkannt, davon fünf zu N1 bis N4. Das Siegel besteht mit 25 Golden Cases, 0 Score- und 0 Rangabweichungen; es wurde nicht verändert. Aktuelle Hashes und der vorherige Stand stehen in `sourcedAnnualYear20261104.reviewFix2_20261107`.

Der B05-Nachher-Arm wird als Vorher wiederverwendet: Alle sechs dort erfassten Quelldateien stimmen per SHA-256 mit dem neuen Ausgangskopf überein. Der zusätzliche Nachher-Arm nutzt denselben vorhandenen Datenbaum, Eingaben und Kalibrierung. Freier Platz vor Start: 77,855 GB. Eingabedigest `4066ca0fa2d7b344edb3371474b9eff79114f52bc5a29a9fc72a0ac1de49be94`, Kalibrierungsdigest `2f4f444ec86f6d7945fd6965adbc6ecfd597a08f43d800cb16057df399ef34bd`. Die Anzeige wurde zusätzlich mit dem alten und neuen overview-Modul gegen dieselben vorbereiteten sechs Datenpakete geprüft; alle Eingabehashes stimmen mit dem Replay überein.

| Board | Ticker | Score vorher | Score nachher | Rang vorher | Rang nachher |
|---|---|---:|---:|---:|---:|
| hg/materials/profitable | 600389.SS | 65,9 | 64,7 | 183 | 200 |
| hg/tech-hardware/profitable | 000636.SZ | 52,7 | 56,9 | 233 | 183 |
| hg/health-care/profitable | 002294.SZ | 51,4 | 52,5 | 298 | 285 |
| hg/energy/profitable | ENOG.L | 35,3 | 34,9 | 277 | 281 |
| quality/quality-materials/profitable | 600389.SS | 64,4 | 62,4 | 178 | 206 |
| quality/quality-tech-hardware/profitable | 000636.SZ | 38,9 | 42,4 | 400 | 362 |
| quality/quality-health-care/profitable | 002294.SZ | 61,2 | 62,2 | 169 | 158 |
| quality/quality-energy/profitable | ENOG.L | 53,6 | 53,1 | 144 | 148 |

Die vollständige Bewegungsliste und Einzeltestprotokolle liegen als Arbeitsnachweis im beauftragten `REPORT-neueres-jahr-fix2.md` und im B06-Ergebnisordner. Commit und Push übernimmt die Folgelane; keine Vollsuite, kein Browserlauf, keine neuen Datenbäume und keine eigene Freigabe.
