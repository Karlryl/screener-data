# Quellenverzeichnis je Feld (`lib/source-priority.js`)

Stand 22.11.2026, Schritt 1 der Regel „SEC zuerst“. Das Verzeichnis beschreibt nur; es liest und ändert keine Zahl, kein Board und keinen Tageslauf.

## Was das Verzeichnis ist

`lib/source-priority.js` hält für jedes Feld, das ein Snapshot unter `metrics`, `timeseries` und `annual` trägt, einen Eintrag mit:

- `period`: Zeitraum (`quarter`, `ttm` für zwölf Monate, `year`, `point` für einen einzelnen aktuellen Wert wie einen Kurs),
- `today`: die Quelle, die der Tageslauf heute schreibt, aus dem Code gelesen (`pull-yahoo.js`, `scripts/opinc-source-migrate.js`, `scripts/fcf-ttm-overlay.js`),
- `target`: die Quellen in der Reihenfolge der Regel (SEC-Konzepte als `sec:<Konzept>`, danach die amtliche Heimatquelle, bei Kursen, Börsenwert und Schätzungen `market`),
- `fallback`: die festgeschriebene Ersatzquelle oder `empty-with-reason` (leer mit Grund, nie eine Ersatzzahl),
- `status`: `live` (heute schon wie das Ziel), `planned` (Ziel weicht ab) oder `unknown` (heutige Quelle nicht belegbar),
- `note`: Begründung und Besonderheiten.

`tests/source-priority.test.js` wird rot, sobald ein Snapshot-Feld ohne Eintrag auftaucht oder ein Eintrag die Form verletzt. Geprüft werden ein Snapshot aus dem echten Schreibcode (Mapper aus `pull-yahoo.js`, danach die OpInc-Umstellung, dazu jede Feldzuweisung nach dem Mapper) und die Schlüsselliste der echten Snapshots vom 21.11.2026 (`tests/fixtures/source-priority/snapshot-keys-2026-11-21.json`, nur Schlüssel und Anzahlen). Am 21.11. trugen 15.769 von 15.772 Snapshot-Dateien diese drei Blöcke mit zusammen 72 Schlüsseln; dazu kommt `annual.annualOpIncYahoo`, das erst im Scoring-Job entsteht. Das Verzeichnis hat 73 Einträge, davon 18 `live` und 55 `planned`.

## Die fünf Regeln des Plans

1. Für jedes Feld, das eine Firma bei der SEC meldet (10-K, 10-Q, Änderungen gewinnen), gilt die SEC-Zahl.
2. Meldet sie das Feld nicht oder nicht frisch (Zeitraum endet mehr als ein Quartal vor dem neuesten), gilt je Feld eine festgeschriebene Ersatzquelle mit Zeitraum, sonst bleibt das Feld leer mit Grund.
3. Felder, die es bei der SEC nicht gibt (Kurs, Börsenwert, Analystenschätzungen), bleiben bei Marktdaten.
4. Ausländische Firmen nehmen ihre amtliche Heimatquelle, wo das Projekt eine hat (Japan EDINET, Taiwan MOPS, China CNINFO/Eastmoney, Brasilien CVM; im Projekt außerdem Korea OpenDART und Indien NSE), sonst Yahoo.
5. Jede Zahl trägt Quelle und Zeitraum.

## Wie ein neues Feld einen Eintrag bekommt

Wer in einem Schreibschritt ein Feld unter `metrics`, `timeseries` oder `annual` neu anlegt, trägt es im selben Änderungsstand in `lib/source-priority.js` ein: Schlüssel `"<block>.<feld>"`, `today` aus dem Codepfad gelesen (nie geraten; ist er unklar, `status: 'unknown'` mit Grund in `note`), `target` nach den Regeln oben, `fallback`, `status`. Ein Geschwisterfeld mit Periodenenden (`…Ends`) kommt in `SIBLINGS` und übernimmt Zeitraum und Status seiner Reihe. Danach `node tests/source-priority.test.js`; ohne Eintrag bleibt der Test rot. Taucht das Feld erst in echten Snapshots auf, wird zusätzlich die Schlüsselliste unter `tests/fixtures/source-priority/` neu erzeugt.

## Geplante Felder (Ziel weicht von heute ab)

Anzahl = Snapshot-Dateien vom 21.11.2026, die den Schlüssel tragen (der Schlüssel ist da, ein Wert nicht unbedingt). Bei den SEC-Konzepten stehen hier höchstens die ersten zwei, die volle Liste steht im Eintrag.

| Feld | Zeitraum | SEC-Konzepte (erste) | Heimatquellen | Snapshots |
|---|---|---|---|---|
| `metrics.revenueTTM` | ttm | RevenueFromContractWithCustomerExcludingAssessedTax, Revenues u. a. | MOPS, CNINFO/Eastmoney, CVM | 15.769 |
| `metrics.revenueGrowthYoY` | quarter | RevenueFromContractWithCustomerExcludingAssessedTax, Revenues u. a. | MOPS, CNINFO/Eastmoney, CVM | 15.769 |
| `metrics.grossMargin` | ttm | GrossProfit, Umsatzkonzepte | CVM | 15.769 |
| `metrics.operatingMargin` | ttm | OperatingIncomeLoss, Umsatzkonzepte | CVM | 15.769 |
| `metrics.sbcRatio` | ttm | ShareBasedCompensation, Umsatzkonzepte | keine | 15.769 |
| `metrics.cashRunway` | point | CashAndCashEquivalentsAtCarryingValue, NetCashProvidedByUsedInOperatingActivities | keine | 15.769 |
| `metrics.payoutRatio` | ttm | PaymentsOfDividendsCommonStock, NetIncomeLoss | keine | 15.769 |
| `metrics.ebitda` | ttm | OperatingIncomeLoss, DepreciationDepletionAndAmortization | keine | 15.769 |
| `metrics.ebitdaMargins` | ttm | OperatingIncomeLoss, DepreciationDepletionAndAmortization u. a. | keine | 15.769 |
| `metrics.debtToEquity` | point | LongTermDebt, DebtCurrent u. a. | keine | 15.769 |
| `metrics.currentRatio` | point | AssetsCurrent, LiabilitiesCurrent | keine | 15.769 |
| `metrics.quickRatio` | point | CashAndCashEquivalentsAtCarryingValue, ShortTermInvestments u. a. | keine | 15.769 |
| `metrics.returnOnEquity` | ttm | NetIncomeLoss, StockholdersEquity | keine | 15.769 |
| `metrics.returnOnAssets` | ttm | NetIncomeLoss, Assets | keine | 15.769 |
| `timeseries.revenueQ` | quarter | RevenueFromContractWithCustomerExcludingAssessedTax, Revenues u. a. | MOPS, CNINFO/Eastmoney, CVM | 15.769 |
| `timeseries.opIncQ` | quarter | OperatingIncomeLoss | CVM | 15.769 |
| `timeseries.grossProfitQ` | quarter | GrossProfit | CVM | 15.769 |
| `timeseries.netIncomeQ` | quarter | NetIncomeLoss | CVM | 15.769 |
| `timeseries.reportedRevenueQEnds` | quarter | Periodenende des SEC-Umsatzquartals | MOPS, CNINFO/Eastmoney, CVM | 3 |
| `annual.annualRev` | year | RevenueFromContractWithCustomerExcludingAssessedTax, Revenues u. a. | EDINET, OpenDART, MOPS, CNINFO/Eastmoney, NSE, CVM | 15.769 |
| `annual.annualOpInc` | year | OperatingIncomeLoss | EDINET, OpenDART, MOPS, CNINFO/Eastmoney, NSE, CVM | 15.769 |
| `annual.annualNetIncome` | year | NetIncomeLoss | EDINET, OpenDART, MOPS, CNINFO/Eastmoney, NSE, CVM | 15.769 |
| `annual.annualGP` | year | GrossProfit | EDINET, OpenDART, MOPS, CNINFO/Eastmoney, NSE, CVM | 15.769 |
| `annual.annualCostOfRevenue` | year | CostOfRevenue, CostOfGoodsAndServicesSold | keine | 15.769 |
| `annual.annualFCF` | year | NetCashProvidedByUsedInOperatingActivities, PaymentsToAcquirePropertyPlantAndEquipment u. a. | keine | 15.769 |
| `annual.annualOCF` | year | NetCashProvidedByUsedInOperatingActivities | EDINET, OpenDART, MOPS, CNINFO/Eastmoney, NSE, CVM | 15.769 |
| `annual.annualCapex` | year | PaymentsToAcquirePropertyPlantAndEquipment, PaymentsToAcquireProductiveAssets u. a. | keine | 15.769 |
| `annual.annualBalance` | year | CashAndCashEquivalentsAtCarryingValue, LongTermDebt u. a. | EDINET, OpenDART, MOPS, CNINFO/Eastmoney, NSE (nur Vermögen und Eigenkapital) | 15.769 |
| `annual.annualRnD` | year | ResearchAndDevelopmentExpense | keine | 15.769 |
| `annual.annualSBC` | year | ShareBasedCompensation | keine | 15.769 |
| `annual.annualSGA` | year | SellingGeneralAndAdministrativeExpense | keine | 14.514 |
| `annual.annualDepreciation` | year | DepreciationDepletionAndAmortization | keine | 14.707 |
| `annual.annualShares` | year | dei:EntityCommonStockSharesOutstanding, CommonStockSharesOutstanding u. a. | EDINET, OpenDART, MOPS, CNINFO/Eastmoney, NSE | 15.747 |
| `annual.annualRepurchase` | year | PaymentsForRepurchaseOfCommonStock | keine | 8.691 |
| `annual.annualDividendsPaid` | year | PaymentsOfDividends, PaymentsOfDividendsCommonStock | keine | 13.079 |
| `annual.annualNetCommonStockIssuance` | year | ProceedsFromIssuanceOfCommonStock, PaymentsForRepurchaseOfCommonStock | keine | 11.194 |

Dazu die 19 Periodenende-Geschwister, die mit ihrer Reihe wandern, je 15.769 Snapshots: `timeseries.revenueQEnds`, `grossProfitQEnds`, `opIncQEnds` und `annual.annualRevEnds`, `annualOpIncEnds`, `annualNetIncomeEnds`, `annualGPEnds`, `annualFCFEnds`, `annualOCFEnds`, `annualCapexEnds`, `annualBalanceEnds`, `annualRnDEnds`, `annualSBCEnds`, `annualSGAEnds`, `annualDepreciationEnds`, `annualSharesEnds`, `annualRepurchaseEnds`, `annualDividendsPaidEnds`, `annualNetCommonStockIssuanceEnds`.

`annual.annualOpInc` ist für SEC-Melder seit dem 29.08.2026 schon auf der SEC (und auf EDINET, OpenDART und den taiwanischen Jahreszahlen), wo der Umsatzabgleich über das ganze Fenster hält; es steht als `planned`, weil die Schichten für China, Indien und Brasilien nicht angeschlossen sind. Die FCF-Marge (`metrics.fcfMarginTTM`) folgt der Regel seit dem 18.11.2026 (#138) und steht deshalb als `live`.

## Nächster Schritt

Für `timeseries.revenueQ` ist der nächste Schritt der SEC-Quartalsumsatz (offener PR #85, Zweig `formula/sec-quarter-fill`, `lib/sec-pit.js` `pitSingleQuarters`). Er ist hier nicht zusammengeführt, weil er dieselben Dateien berührt wie die offene K2-Änderung (PR #140).
