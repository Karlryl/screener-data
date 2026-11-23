# Quellenverzeichnis je Feld (`lib/source-priority.js`)

Stand 22.11.2026, Schritt 1 der Regel „SEC zuerst“. Das Verzeichnis beschreibt nur; es liest und ändert keine Zahl, kein Board und keinen Tageslauf.

## Was das Verzeichnis ist

`lib/source-priority.js` hält für jedes Feld, das ein Snapshot unter `metrics`, `timeseries` und `annual` trägt, einen Eintrag mit:

- `period`: Zeitraum (`quarter`, `ttm` für zwölf Monate, `year`, `point` für einen einzelnen aktuellen Wert wie einen Kurs),
- `today`: die Quelle, die der Tageslauf heute schreibt, aus dem Code gelesen (`pull-yahoo.js`, `scripts/opinc-source-migrate.js`, `scripts/fcf-ttm-overlay.js`),
- `target`: die Quellen in der Reihenfolge der Regel (SEC-Konzepte als `sec:<Konzept>`, Deckblatt-Angaben als `dei:<Konzept>`, danach die amtliche Heimatquelle, bei Kursen, Börsenwert und Schätzungen `market`; bei einer Kennzahl aus Kurs und gemeldeter Zahl steht der Marktteil als `market:price` oder `market:marketCap` neben den SEC-Konzepten),
- `fallback`: die festgeschriebene Ersatzquelle oder `empty-with-reason` (leer mit Grund, nie eine Ersatzzahl),
- `status`: `live` (heute schon wie das Ziel), `planned` (Ziel weicht ab) oder `unknown` (heutige Quelle nicht belegbar),
- `note`: Begründung und Besonderheiten.

`tests/source-priority.test.js` wird rot, sobald ein Feld ohne Eintrag auftaucht, eine Reihe unter `annual` oder `timeseries` ohne eingetragenes Geschwisterfeld `…Ends` dasteht (oder umgekehrt) oder ein Eintrag die Form verletzt. Der Test sieht Felder aus zwei Quellen:

1. einem künstlichen Snapshot aus dem Schreibcode: Mapper aus `pull-yahoo.js`, danach die OpInc-Umstellung, dazu eine Textsuche in `pull-yahoo.js` nach direkten Zuweisungen (auch `??=`), Zuweisungen über einen Alias des Blocks, Schleifen über eine feste Feldliste und `setPeriods`-Aufrufen; auskommentierte Zeilen zählen nicht,
2. der Schlüsselliste echter Snapshots (`tests/fixtures/source-priority/snapshot-keys-2026-11-21.json`, nur Schlüssel und Anzahlen; der Test nimmt die neueste Datei dort).

Felder, die Overlay-Skripte (etwa `scripts/fcf-ttm-overlay.js`) oder andere Module (etwa die Spread-Zuweisung in `lib/financial-known-cases.js`) schreiben, und Schlüssel, die erst zur Laufzeit zusammengesetzt werden, sieht der Test nur über die Schlüsselliste. Nach jeder Änderung an einem Schreibschritt wird sie deshalb neu erzeugt:

```
gh run download <Lauf-ID> -R Karlryl/screener-data -n snapshots -D <Ordner außerhalb des Repos>
node scripts/source-priority-fixture.js <Ordner> <Lauf-ID> <Datentag JJJJ-MM-TT>
```

Das Skript liest den Ordner nur und schreibt allein `tests/fixtures/source-priority/snapshot-keys-<Datentag>.json`; bei gleichem Ordner entsteht byteweise dieselbe Datei. Die Snapshots des Tageslaufs werden vor dem Overlay hochgeladen; Felder, die erst im Scoring-Job entstehen (heute nur `annual.annualOpIncYahoo`), fehlen dort.

Am 21.11. trugen 15.769 von 15.772 Snapshot-Dateien diese drei Blöcke mit zusammen 72 Schlüsseln; dazu kommt `annual.annualOpIncYahoo`. Das Verzeichnis hat 73 Einträge, davon 12 `live` und 61 `planned`.

## Die fünf Regeln des Plans

1. Für jedes Feld, das eine Firma bei der SEC meldet (10-K, 10-Q, Änderungen gewinnen), gilt die SEC-Zahl.
2. Meldet sie das Feld nicht oder nicht frisch (Zeitraum endet mehr als ein Quartal vor dem neuesten), gilt je Feld eine festgeschriebene Ersatzquelle mit Zeitraum, sonst bleibt das Feld leer mit Grund.
3. Felder, die es bei der SEC nicht gibt (Kurs, Börsenwert, Analystenschätzungen), bleiben bei Marktdaten.
4. Ausländische Firmen nehmen ihre amtliche Heimatquelle, wo das Projekt eine hat (Japan EDINET, Taiwan MOPS, China CNINFO/Eastmoney, Brasilien CVM; im Projekt außerdem Korea OpenDART und Indien NSE), sonst Yahoo.
5. Jede Zahl trägt Quelle und Zeitraum.

## Wie ein neues Feld einen Eintrag bekommt

Wer in einem Schreibschritt ein Feld unter `metrics`, `timeseries` oder `annual` neu anlegt, trägt es im selben Änderungsstand in `lib/source-priority.js` ein: Schlüssel `"<block>.<feld>"`, `today` aus dem Codepfad gelesen (nie geraten; ist er unklar, `status: 'unknown'` mit Grund in `note`), `target` nach den Regeln oben, `fallback`, `status`. Ein Geschwisterfeld mit Periodenenden (`…Ends`) kommt in `SIBLINGS` und übernimmt Zeitraum und Status seiner Reihe. Eine neue Reihe unter `annual` oder `timeseries` braucht ihr Geschwisterfeld im Verzeichnis, sonst steht sie mit Grund in `NO_ENDS` im Test. Danach `node tests/source-priority.test.js`; ohne Eintrag bleibt der Test rot. Schreibt ein Overlay, ein anderes Modul oder ein zusammengesetzter Schlüssel das Feld, sieht der Test es erst nach dem nächsten Erzeugen der Schlüsselliste (siehe oben).

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
| `metrics.priceSales` | point | Börsenwert (Markt), Umsatzkonzepte | MOPS, CNINFO/Eastmoney, CVM | 15.769 |
| `metrics.pe` | point | Kurs (Markt), EarningsPerShareDiluted u. a. | keine | 15.769 |
| `metrics.dividendYield` | point | Kurs (Markt), CommonStockDividendsPerShareDeclared | keine | 15.769 |
| `metrics.enterpriseValue` | point | Börsenwert (Markt), LongTermDebtNoncurrent, DebtCurrent u. a. | keine | 15.769 |
| `metrics.enterpriseToRevenue` | point | Börsenwert (Markt), Schulden, Kasse, Umsatzkonzepte | keine | 15.769 |
| `metrics.enterpriseToEbitda` | point | Börsenwert (Markt), Schulden, Kasse, OperatingIncomeLoss u. a. | keine | 15.769 |
| `metrics.debtToEquity` | point | LongTermDebtNoncurrent, DebtCurrent u. a. | keine | 15.769 |
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
| `annual.annualBalance` | year | CashAndCashEquivalentsAtCarryingValue, LongTermDebtNoncurrent u. a. | EDINET, OpenDART, MOPS, CNINFO/Eastmoney, NSE (Vermögen und Eigenkapital, CNINFO/Eastmoney auch kurzfristige Verbindlichkeiten) | 15.769 |
| `annual.annualRnD` | year | ResearchAndDevelopmentExpense | keine | 15.769 |
| `annual.annualSBC` | year | ShareBasedCompensation | keine | 15.769 |
| `annual.annualSGA` | year | SellingGeneralAndAdministrativeExpense | keine | 14.514 |
| `annual.annualDepreciation` | year | DepreciationDepletionAndAmortization | keine | 14.707 |
| `annual.annualShares` | year | dei:EntityCommonStockSharesOutstanding, CommonStockSharesOutstanding u. a. | EDINET, OpenDART, MOPS, CNINFO/Eastmoney, NSE, CVM | 15.747 |
| `annual.annualRepurchase` | year | PaymentsForRepurchaseOfCommonStock | keine | 8.691 |
| `annual.annualDividendsPaid` | year | PaymentsOfDividends, PaymentsOfDividendsCommonStock | keine | 13.079 |
| `annual.annualNetCommonStockIssuance` | year | ProceedsFromIssuanceOfCommonStock, PaymentsForRepurchaseOfCommonStock | keine | 11.194 |

Dazu die 19 Periodenende-Geschwister, die ihrer Reihe folgen, je 15.769 Snapshots: `timeseries.revenueQEnds`, `grossProfitQEnds`, `opIncQEnds` und `annual.annualRevEnds`, `annualOpIncEnds`, `annualNetIncomeEnds`, `annualGPEnds`, `annualFCFEnds`, `annualOCFEnds`, `annualCapexEnds`, `annualBalanceEnds`, `annualRnDEnds`, `annualSBCEnds`, `annualSGAEnds`, `annualDepreciationEnds`, `annualSharesEnds`, `annualRepurchaseEnds`, `annualDividendsPaidEnds`, `annualNetCommonStockIssuanceEnds`.

`annual.annualOpInc` stammt bei SEC-Meldern seit dem 29.08.2026 schon aus der SEC (bei japanischen, koreanischen und taiwanischen Firmen aus EDINET, OpenDART und den taiwanischen Jahreszahlen), wo der Umsatzabgleich über das ganze Fenster hält; es steht als `planned`, weil die Schichten für China, Indien und Brasilien nicht angeschlossen sind. Die FCF-Marge (`metrics.fcfMarginTTM`) folgt der Regel seit dem 18.11.2026 (#138) und steht deshalb als `live`; sie liest nur us-gaap-Zahlen in USD, Firmen mit IFRS-Abschluss (20-F) bekommen die Yahoo-Zwölfmonatszeile.

Kennzahlen aus Marktdaten (die 16 Einträge mit `market` im Ziel) tragen den Stand des letzten Vollabrufs: Läufe, die nur den Kurs holen, erneuern Kurs und Börsenwert, aber keine Kennzahl. Am 21.11. war `metrics.pe` im Median 10,6 Tage alt. Die sechs Kennzahlen aus Kurs und gemeldeter Zahl (`priceSales`, `pe`, `dividendYield`, `enterpriseValue`, `enterpriseToRevenue`, `enterpriseToEbitda`) stehen als `planned`: Der Marktteil bleibt bei Marktdaten, der gemeldete Teil soll aus der SEC kommen. Schulden zählen als LongTermDebtNoncurrent plus DebtCurrent; fehlt LongTermDebtNoncurrent, gilt LongTermDebt plus nur ShortTermBorrowings, weil LongTermDebt die kurzfristig fälligen Teile schon enthält.

## Nächster Schritt

Für `timeseries.revenueQ` ist der nächste Schritt der SEC-Quartalsumsatz (offener PR #85, Zweig `formula/sec-quarter-fill`, `lib/sec-pit.js` `pitSingleQuarters`). Er ist hier nicht zusammengeführt, weil er dieselben Dateien berührt wie die offene K2-Änderung (PR #140).

Die nächste Absicherung des Verzeichnisses ist ein Schritt im Scoring-Job, der `missingEntries` über die echten Snapshots nach allen Overlays laufen lässt. Dann fällt ein neues Feld aus einem Overlay am selben Tag auf und nicht erst beim nächsten Erzeugen der Schlüsselliste. Dieser Schritt ändert den Tageslauf und gehört deshalb nicht in diese Änderung.
