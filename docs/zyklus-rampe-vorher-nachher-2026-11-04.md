> **Auf einen Blick: Die Rampe ändert am festen Datenstand 31.10.2026 insgesamt 66 HyperGrowth-Scores und 36 Quality-Scores.**
>
> HyperGrowth: 67 andere Faktoren, 32 höhere und 34 niedrigere sichtbare Scores. Quality: 36 andere Faktoren, 19 höhere und 17 niedrigere Scores.
> Außerhalb des jeweiligen Rampenbandes bleiben Faktor und ungerundeter Score bitgenau gleich. Alle übrigen Achsen, Faktoren und Kalibrierungen stimmen zwischen Vorher und Nachher vollständig überein.
> Formelentwurf zur blinden Claude-Prüfung, noch keine Freigabe oder Veröffentlichung.

Grundlage ist Tag 1526, `5d388afcbf0a658aacb6d6d9d1225ecb70be1bbc`. Die Rechnung verwendet dieselben vorbereiteten Firmenzahlen vom 31.10.2026 wie R12, einschließlich derselben SEC-Jahresreihen und Exchange-Quarter-Daten. Die Rampe ist die einzige numerische Änderung.

## Methode und Vergleichsfelder

Das Signal lautet `oscExcess(op) * clamp((dd - 0.8*t)/(0.4*t), 0, 1)`. Der Faktor bleibt `1 / (1 + 0.5 * signal)`. Die bestehende Auswahl der Jahresreihen, die Datenfilter, p75 und seine Stichprobe bleiben unverändert. Unterhalb von 80 % und oberhalb von 120 % bleibt der alte Faktor exakt erhalten. Fehlt eine gelernte Schwelle (Wert `null`), bleibt der Faktor neutral (1); bei einer gelernten Schwelle von genau 0 hat das Band keine Breite, und die bisherige harte Schwelle gilt, also volle Dämpfung bei jedem Drawdown einschließlich 0, sofern die übrigen Datenfilter erfüllt sind.

HyperGrowth-Schwelle: **0,14702589659492998**, Band **0,117620717275944 bis 0,176431075913916**. Quality verwendet unverändert seine eigene Schwelle **0,1265524620893388**.

An der Schwelle beträgt das Rampengewicht 0,5. Bei Oszillationssignal 2 ist der Faktor dort 2/3. Er liegt damit nicht in der Mitte zwischen 1 und 0,5.

Die neuen Exportfelder heißen `factors.cycleLegacy` und `scoreCycleLegacy`. Sie enthalten die alte Rechnung mit denselben sonstigen Faktoren und derselben Multiplikationsreihenfolge. Der Export rundet wie bisher und begrenzt beide Scores auf 100. Der alte Score wird nie zum Sortieren verwendet. Die Vergleichsfrist endet am **02.12.2026**, spätestens 28 Tage nach dem vorgesehenen Start; die Entfernung einschließlich der Einträge in der Feldliste ist als geprüfte Folgeänderung einzuplanen. Die Scoring-Funktion enthält keinen automatischen Kalenderwechsel. Beim Exportbau und bei `--check` warnt ein meldender Wächter nach `endsOn` in Europe/Berlin, wenn die alten Felder noch exportiert werden; die Meldung allein lässt keinen Lauf scheitern.

## Vorher und Nachher je Board

| Familie / Board | Zeilen | Faktor anders | Score höher | Score niedriger | Rang anders | Top-100 hinein | Top-100 heraus |
|---|---:|---:|---:|---:|---:|---|---|
| HyperGrowth / consumer-discretionary | 1149 | 2 | 1 | 1 | 165 | 0 | 0 |
| HyperGrowth / consumer-staples | 553 | 4 | 1 | 3 | 120 | 0 | 0 |
| HyperGrowth / energy | 373 | 1 | 0 | 1 | 70 | 0 | 0 |
| HyperGrowth / financials | 483 | 3 | 1 | 2 | 50 | 0 | 0 |
| HyperGrowth / health-care | 971 | 6 | 2 | 4 | 268 | 603301.SS (unprofitable) | 0460.HK (unprofitable) |
| HyperGrowth / industrials | 2037 | 10 | 5 | 5 | 715 | 000620.SZ (unprofitable) | 603131.SS (unprofitable) |
| HyperGrowth / it-services | 148 | 0 | 0 | 0 | 0 | 0 | 0 |
| HyperGrowth / materials | 999 | 15 | 7 | 8 | 722 | 0 | 0 |
| HyperGrowth / real-estate | 545 | 3 | 2 | 1 | 4 | 0 | 0 |
| HyperGrowth / semiconductors | 378 | 5 | 4 | 1 | 67 | 0 | 0 |
| HyperGrowth / software-comm-services | 622 | 6 | 4 | 2 | 114 | 0 | 0 |
| HyperGrowth / tech-hardware | 665 | 10 | 4 | 5 | 200 | CSCO (profitable) | 300480.SZ (profitable) |
| HyperGrowth / utilities | 346 | 2 | 1 | 1 | 2 | 0 | 0 |
| Quality / quality-consumer-discretionary | 1059 | 2 | 1 | 1 | 107 | 0 | 0 |
| Quality / quality-consumer-staples | 518 | 5 | 1 | 4 | 105 | 0 | 0 |
| Quality / quality-energy | 342 | 2 | 1 | 1 | 18 | 0 | 0 |
| Quality / quality-health-care | 718 | 2 | 2 | 0 | 33 | 0 | 0 |
| Quality / quality-industrials | 1867 | 8 | 2 | 6 | 985 | 0 | 0 |
| Quality / quality-it-services | 126 | 0 | 0 | 0 | 0 | 0 | 0 |
| Quality / quality-materials | 866 | 5 | 4 | 1 | 166 | 0 | 0 |
| Quality / quality-semiconductors | 302 | 2 | 1 | 1 | 45 | 0 | 0 |
| Quality / quality-software-comm-services | 465 | 2 | 1 | 1 | 46 | 0 | 0 |
| Quality / quality-tech-hardware | 555 | 8 | 6 | 2 | 178 | 0 | 0 |
| Quality / quality-utilities | 335 | 0 | 0 | 0 | 0 | 0 | 0 |

Gezählt werden Tickerzeilen. Ränge und Top 100 gelten je Board und Track; die Tabelle summiert beide Tracks. Ranglose Zeilen behalten ihren Status. Rangänderungen außerhalb des Bandes entstehen durch die Umsortierung, ihr Score bleibt unverändert.

| Familie | Bewertete Zeilen | Faktor anders | Sichtbarer Score anders | Höher | Niedriger |
|---|---:|---:|---:|---:|---:|
| HyperGrowth | 9269 | 67 | 66 | 32 | 34 |
| Quality | 7153 | 36 | 36 | 19 | 17 |
| Smallcap | 0 | 0 | 0 | 0 | 0 |

## 0460.HK und Rangfolgen

| Größe am selben Datentag | Bisher | Rampe |
|---|---:|---:|
| Zyklusfaktor, ungerundet | 1 | 0,666809681408215 |
| Zyklusfaktor, Export | 1 | 0,667 |
| Score, ungerundet | 76,5255524727533 | 51,02797926394427 |
| Sichtbarer Score | 76,5 | 51,0 |
| Health Care, unprofitable, Rang | 24 | 122 |

Bei exakt den beiden R12-Schwellen 0,14700697647017294 und 0,14702589659492998 springt der alte Faktor von 0,5 auf 1. Die Rampe bewegt ihn nur von 0,666666666666667 auf 0,666809681408215. Die Tests halten dafür die echten Eingangsreihen von 0460.HK fest.

HyperGrowth hat **2.497 veränderte Rangnummern**, Quality **1.683**. Darin sind unveränderte Scores enthalten, die durch andere Namen überholt werden. Die Rangberechtigung und die Kohorten bleiben unverändert. In HyperGrowth kommen 603301.SS und 000620.SZ jeweils im unprofitable-Track sowie CSCO im profitable-Track hinzu; heraus fallen 0460.HK, 603131.SS und 300480.SZ in den entsprechenden Tracks. Quality hat keine Ein- oder Austritte unter den ersten 100. SONO ändert den Faktor, bleibt gerundet aber auf 23,1 Punkten.

## Betroffene Ticker

**HyperGrowth (67 Zeilen):** 000555.SZ, 000825.SZ, 000930.SZ, 002004.SZ, 002110.SZ, 002115.SZ, 002163.SZ, 002195.SZ, 002385.SZ, 002739.SZ, 002747.SZ, 002840.SZ, 007810.KS, 0336.HK, 0460.HK, 1963.T, 2367.TW, 300006.SZ, 300296.SZ, 300358.SZ, 300480.SZ, 300868.SZ, 301396.SZ, 3105.TWO, 5214.T, 600266.SS, 600468.SS, 600567.SS, 600589.SS, 600884.SS, 601606.SS, 603103.SS, 603131.SS, 603580.SS, 688234.SS, 688313.SS, 7711.TW, AA, AUTO.OL, CBAV3.SA, CC, CDNA, DIA.MC, DSFI.VI, EWG.L, EXTR, EYE, FLNC, FNV, GFS, IFF, IVZ, MAXESTATES.NS, MC, MRCY, NVST, O5G.DE, OMCL, RIOT, SFD, SMTC, SONO, SPRC.BK, TKCC.DE, TLN, UAA, VOGL.BO.

**Quality (36 Zeilen):** 000825.SZ, 002004.SZ, 002100.SZ, 002115.SZ, 002350.SZ, 002714.SZ, 002747.SZ, 0460.HK, 1963.T, 2367.TW, 300296.SZ, 300480.SZ, 300567.SZ, 301396.SZ, 3105.TWO, 5214.T, 600189.SS, 600468.SS, 600617.SS, 600884.SS, 603580.SS, 603685.SS, 603985.SS, 6963.T, 7711.TW, ALPA3.SA, DSFI.VI, EWG.L, EXTR, EYE, FSM, IFT.NZ, OMCL, SFD, SPRC.BK, TSN.

## Reproduktion und Nachweise

Der Vergleich läuft mit `scripts/cycle-ramp-compare.js`. Er lädt den unveränderten Ausgangscode direkt aus dem Git-Objekt von Tag 1526 und verwendet für beide Rechenwege dieselben übrigen Module und dieselben Snapshots. Er schreibt ausschließlich ins explizite Ausgabeverzeichnis außerhalb der Eingabebäume.

```powershell
node scripts/cycle-ramp-compare.js --data-root $DataRoot --export-root $ExportRoot --r12-root $R12Root --out $Output
```

DataRoot ist der R12-Snapshotbaum mit 15.826 Firmenpaketen; ExportRoot enthält die dazu vorbereiteten Exporte und Kalibrierungen nach Tag 1524, und R12Root enthält scored-cycle-inputs.json sowie measurement.json. Die konkreten lokalen Pfade stehen im uncommitteten Bericht und im Eingangsmanifest der Rechnung. Erzeugt werden comparison.json mit allen Faktor-, Score- und Rangänderungen, comparison.md mit der Tabelle sowie input-hashes.json.

Die Basisrechnung reproduziert **alle 9.269 gespeicherten R12-Rohscores und Faktoren exakt**. Quality ist zusätzlich über seine vollständig neu gerechnete Kohorte und gegen die vorhandenen Export-Toplisten geprüft. Die Kalibrierungen der beiden Rechenwege sind vollständig identisch. Der zusätzliche Abgleich mit gespeicherten Kalibrierungsdateien sortiert alle numerischen Arrays, auch feste Wertepaare, und normalisiert −0 zu 0; er erhält Werte und Häufigkeiten, prüft aber nicht die Reihenfolge dieser Paare, während der direkte Vergleich beider Rechenwege auch jede Array-Reihenfolge exakt prüft.

**15.864 ausdrücklich gelesene Eingabedateien** sind nach der Rechnung anhand ihrer SHA-256 unverändert. Die neuen Legacy-Scores entsprechen dem Ausgangscode bitgenau. Die Prüfung vergleicht außerdem alle übrigen Ergebnisfelder, Achsen und Faktoren beider Rechenwege. Die numerische Änderung außerhalb des Bandes ist null.

Der Nachlauf zur Blindprüfung enthält dieselben **701 unterschiedlichen Warnmeldungen** wie der Erstlauf; sie stehen jetzt auch in Konsole und Vergleichsbericht, ihre Anzahl in `checks.warningCount`. Die belegte Gleichheit der Rechenwege bedeutet keine Warnungsfreiheit der Eingangsdaten.

| R12-Eingabe | SHA-256 |
|---|---|
| scored-cycle-inputs.json | 5a8b1e9f17f45683e58e76549c859d695e03fd8c8d7609e18c706e11395dc975 |
| measurement.json | ae419779073385586333ab82ed6c6a69063f5f51b01825b336ad76a6f2a9e40e |

## Prüfungen und offene Grenzen

Der Grenzfall-Test war auf dem alten Stand rot (3 von 5 Tests rot) und besteht mit der Rampe. Die endgültige Zyklusrampe-Suite hat 7 bestandene Tests, einschließlich 1.001 Stützstellen der Stetigkeitsprüfung, Datenfiltern, Null- und Nullschwelle, Legacy-Export, absichtlich beschädigten Vergleichswerten sowie unveränderter Sortierung durch den Legacy-Score. Sie besteht auch mit um 3 und 40 Tage vorgestellter Uhr.

Bestanden sind außerdem die 25 bisherigen Zyklustests, 9 Fixture-Anker, 19 Exportprüfungen, 13 Market-Cap-Schattenprüfungen, die Freeze-Prüfung einschließlich der 25 Golden Cases und der Test-Gate-Selftest mit 24 Proben. Der Freeze-Wächter war nach der Quelländerung vor der Übergangsregistrierung rot und danach grün; historische Siegel und Golden Traces wurden nicht geändert.

Die vollständige PR-Suite `node scripts/test-gate.js --mode=all` wurde ausgeführt. Die Gesamtsuite ist lokal **nicht grün**. 20 Fehler sind mit unverändertem Ausgangscode nachgestellt, überwiegend wegen im Klon fehlender Datenbestände; hinzu kommt unter anderem der lange Windows-Temp-Pfad der Forschungsprobe. Der endgültige Lauf zählt 625 bestandene, 20 rote und 7 übersprungene Dateien; jeder Dateiname steht im uncommitteten Bericht. Tests wurden nicht abgeschwächt, Datenlücken im Klon nicht aufgefüllt.

Smallcap hat im vorbereiteten R12-Fallback-Bestand **0 geroutete Firmen**. Ein eigenständiger Smallcap-Snapshotbestand und dessen tatsächliche Board-Wirkung sind damit nicht geprüft. Rule of 40, Filter- und Survival-Ansichten wurden nicht separat nachgebaut. Es gab keinen Linux-CI-Lauf, keinen Browser- oder Frontend-Sichttest und keine blinde Claude-Freigabe. Die sichtbare Anzeige der neuen Vergleichsfelder in findash bleibt bei der ausliefernden Lane zu prüfen.

Nicht untersucht sind eine optimale Rampenbreite, historische Firmenjahresreihen, tatsächlich damalige Umschaltungen sowie Renditevorteile gegenüber Index oder Zufallsauswahl. Die Breite folgt dem bereits vereinbarten Methodenentscheid; diese Messung prüft ihre unmittelbaren Auswirkungen.
