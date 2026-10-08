# Exchange cross-check: pair guard and fill of 2025-09-30 (Tag 1403, G2b)

`lib/exchange-quarter-check.js` compares the vendor's quarterly revenue with the exchange store
(`docs/exchange-quarters-store.md`, Tag 1399). **Committed mode: `off`** (`configs/exchange-quarter-policy.json`).
No reader sees any change; the measurement runs in mode `shadow` through `scripts/exchange-check-report.js`.

## Modes and placement

| Mode | Who | Effect |
|---|---|---|
| `off` | every reader (default) | strips the step's own markers (none exist) and returns the identical object |
| `shadow` | `scripts/exchange-check-report.js` only | computes the result, returns the snapshot unchanged |
| `active` | nobody yet (G2c = the one-line switch in the policy) | applies guard and fill at read time |

- Read time only: `prepareSnapshot` (`lib/yahoo-q4-known-cases.js`) appends the step after the zero guard, so
  scoring, board history, the findash and Rule-of-40 exports and the stale-quarter reload all go through it.
  The pull calls `prepareSnapshot(snap, { atPull: true })` and never runs it: a persisted fill or guard null
  would make `historyIsThinner` reject the next reload (critique 2; reproduced in
  `tests/exchange-quarter-check-wiring.test.js`).
- Every mode first removes the step's own markers (`financialMissing.reasonCode` `exchange-pair-mismatch` /
  `exchange-annual-mismatch` / `exchange-quarter-mismatch`, `exchangeFill`, `meta.exchangeCheck`) and restores the original vendor cells, so
  a mode change leaves no residue.
- Store missing, unreadable or older than 8 days before the snapshot (2 days between 15.10. and 20.11.): every
  row of that market is `unchecked`, one `::warning::` per process (`store-old` included), never a reader failure.
  With a fresh store, a company with neither an own run read nor any observations is `unchecked(no-own-read)`;
  an older own read is `unchecked(store-old)`. The runtime summary counts these separately and emits no
  `::warning::` for `no-own-read`.
- Hand tables keep authority: a ticker with any case in `configs/financial-known-cases.json` or
  `configs/yahoo-q4-known-cases.json`, or any foreign marker on a revenue cell, is `unchecked(hand-table)`.
- No file under `src/scoring/` changes. Feeding Eastmoney values into scoring is the route `scripts/build-cnannual.js`
  lines 8-18 describe as a seal question for `run-screener.js`; this step does not touch the sealed loader, it
  is a data-layer repair in the unsealed overlay like #398-#403, and it stays off until a reviewed switch.

## Guard

- Comparison in statement currency (stored value / `meta.fxRateApplied`), tolerance
  max(0.1 % of the exchange value, half the printed unit: 0.005 CNY, 500 TWD), one revenue line per company
  (China general: the line that matches the newest vendor quarter, `TOTAL_OPERATE_INCOME` on a tie).
- Pairs are the ones scoring forms: `jahresVergleichIdx(s, 'revenueQ', i)` with `quelle: 'datum'`. If either
  quarter of a pair misses the exchange figure, the OLDER quarter is withheld. The newest quarter is never
  withheld (j > i >= 0), so `latestReportedQuarter` does not move.
- Securities firms (Eastmoney `SINCOME`, MOPS `收益合計`) are their own stratum: a pair is mixed only when the
  vendor/exchange ratio of its two quarters differs by more than the tolerance. Banks and insurers (Yahoo industry
  `Banks*`, `Insurance*`, `Financial Conglomerates`) stay unchecked.
- When the level pair is withheld, the annual pair the growth figure falls back to (`revGrowthLeg`) is compared
  with the exchange full years (2025-12-31, 2024-12-31; undated vendor years by value). If it does not agree or
  cannot be checked, the growth figure is withheld entirely: every annual revenue cell older than the newest and
  a recorded newer fiscal year (`meta.annualRevNewerYear`, kept in place as null) are withheld. This also
  removes the older years from the margin, SBC and gross-margin readers of `annualRev`, so a row can lose its
  rank (11 securities firms in the active sandbox of 02.10.); **open decision before G2c**: null only the
  growth inputs, or accept the row exit (the same check runs when a withheld fill-period cell takes the
  quarterly leg away).
- H-share and other twin listings are not guarded; the shadow report counts board rows that look like twins.

## Fill of 2025-09-30

All must hold: China general or Taiwan general; the vendor cell exists, is empty and is not the newest; no
restatement signal in the store (a key with more than one observation); the vendor's 2025 quarters equal the
newest board-history vintage before 2026-08-01 (statement currency; no row there = no fill; a vendor 2025
quarter that vintage does not carry = `baseline-quarter-missing`, no fill); the store has a
single quarter for every vendor period end and every present vendor quarter agrees; exchange Q3 > 0; once the
store holds the next-year quarter (Q3-2026), the Q3-2025 observation must carry a confirmation whose
`UPDATE_DATE` is on or after the Q3-2026 notice date (Taiwan: Q3-2025 then comes from the Q3-2026 filing's
comparative). The cell then carries `exchangeFill` (native value, line, derivation `9M-H1` or `printed-quarter`,
operands with notice dates, source, original vendor row, reason). When the vendor later delivers the quarter, an
agreeing value stays untouched; a disagreeing one is withheld wherever it sits (`exchange-quarter-mismatch`,
general stratum, never the newest cell; in November it is the year-ago partner of the newest quarter and carries
the pair code), and counted (`vendor-delivered-disagrees`, a `::warning::` on the summary line). "Later" is
proven against the baseline vintage: the company has a row there and the quarter is absent or null in it. A
fill-period cell the baseline already carried was delivered on time: outside a pair it stays untouched (G1) and is
only counted; without a baseline row nothing is withheld on this ground. (Review of deddc959d3: on the data of
02.10.2026 the broader rule held 8 on-time cells, at least 4 of them correct; 003816.SZ and 601038.SS with a vendor
value of 0 are real wrong values and go on the false-hold list for G2c and the hand table.)

Store age is measured per company: the newest run that read one of the company's own keys again (China: a
listed period the company has and is not absent for; Taiwan: an entry in the run's `read` list) must be within
the limit of the snapshot's fetch time. A newer run that did not read the company (partial Taiwan pass) does not
make an older own read fresh: that row stays `unchecked(store-old)`. A store whose newest run is too old is old
for every row, including companies never read. In a fresh store, no own run read and no non-empty observation
list (Taiwan `seasons`, China `ytd`) means `unchecked(no-own-read)`: the source has never delivered the company.
The 25 Taiwan cases found on 07.10.2026 comprise 23 with `no-line` and two with `bad-id` (`1312A.TW`, `2002A.TW`).
Observations without a matching run read are inconsistent and conservatively remain `unchecked(store-old)`.
Both reasons carry `whyText`; `no-own-read` also carries the sorted unique `noDataCodes` from the entry's
`noData`. German labels: `no-own-read` = "Börsenquelle hat diese Firma noch nie geliefert";
`store-old` = "Der letzte Abruf der Börsenquelle für diese Firma ist älter als die Frist".

## Reason texts (German, `financialDataReasons`)

- level pair: "Quartalsvergleich ausgeblendet: Das Vorjahresquartal des Datenanbieters weicht von der Börsenmeldung ab (vermutlich berichtigte Vorjahreszahlen). Gezeigt wird der Jahreswert."
- level pair, no annual figure: "Quartalsvergleich ausgeblendet: Das Vorjahresquartal des Datenanbieters weicht von der Börsenmeldung ab (vermutlich berichtigte Vorjahreszahlen). Ein Jahreswert liegt nicht vor, deshalb wird kein Umsatzwachstum gezeigt."
- delivered fill-period quarter off the exchange: "Quartalsumsatz ausgeblendet: Der nachgelieferte Wert des Datenanbieters weicht von der Börsenmeldung ab. Das Quartal wird nicht verwendet."
- other pair: "Vorjahresquartal ausgeblendet: Der Wert des Datenanbieters weicht von der Börsenmeldung ab (vermutlich berichtigte Vorjahreszahlen). Er zählt nicht zur Beschleunigung des Umsatzwachstums."
- growth withheld: "Umsatzwachstum ausgeblendet: Vorjahresquartal und Jahreswerte des Datenanbieters weichen von der Börsenmeldung ab oder sind nicht prüfbar (vermutlich berichtigte Vorjahreszahlen)."
- fill: "Umsatz 3. Quartal 2025 fehlte beim Datenanbieter und stammt aus der Börsenmeldung (Eastmoney, veröffentlicht 31.10.2025)."

Board history (active mode only): `pit.revenueQExchange: { filled, withheld }` with the original vendor values.

## Shadow report

`node scripts/exchange-check-report.js --out <file> [--snapshots] [--outputs] [--store] [--board-history]
[--active-outputs <sandbox outputs with mode active>] [--must-withhold <tickers>]`, or the manual workflow
`.github/workflows/exchange-check-shadow.yml` (input: the run id of a finished daily run; artifact
`exchange-check-shadow`). It writes only `--out`. Lists are read from the export (`findash-export/v1`):
`boardRows` = every China/Taiwan row on a visible list (branch top lists, overview, quality, survival, Rule of 40),
`census` = every China/Taiwan row whose category is `would-*`, on a list or not, with every list it is on and its
full-list rank. The go criterion of G2c (0 false holds) is checked row by row against `census`.
