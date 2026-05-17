# Tag 219c — Yahoo Schema vs pull-yahoo Extraction Audit

**Date:** 2026-05-17
**Scope:** Read-only audit of `pull-yahoo.js` (extraction) vs live `yahoo-finance2` ground truth for NVDA (well-covered anchor) + spot ADR checks (TSM, BABA, 9988.HK).
**Mode:** Compare what Yahoo actually returns today against what pull-yahoo extracts/persists, identifying both missed value and silent breakage.

---

## 1. Executive Summary

**11 findings total**, split:

| # | Severity | Class | Field / area |
|---|---|---|---|
| F1 | **CRITICAL** | Silent breakage | `price.financialCurrency` — does not exist; Tag-204 ADR fix is dead |
| F2 | **HIGH** | Missed value | `financialData.ebitda` — `ev-ebitda` method uses `opInc*1.2` proxy |
| F3 | **HIGH** | Missed value | `defaultKeyStatistics.enterpriseValue` / `enterpriseToEbitda` — same |
| F4 | **HIGH** | Missed value | FTS `basicAverageShares` / `ordinarySharesNumber` — buyback-yield dead |
| F5 | **HIGH** | Missed value | `defaultKeyStatistics.sharesOutstanding` not persisted — header lies |
| F6 | MEDIUM | Missed value | `majorHoldersBreakdown` module — `institutionsPercentHeld` (13F proxy) |
| F7 | MEDIUM | Missed value | `earningsHistory` module — epsActual/estimate/surprisePercent (4 q) |
| F8 | MEDIUM | Missed value | `financialData` ratios — debtToEquity, currentRatio, ROE, ROA |
| F9 | LOW | Missed value | `defaultKeyStatistics.mostRecentQuarter` — superior dataAsOf source |
| F10 | LOW | Missed value | `calendarEvents` — earnings date + estimates (replaces puller) |
| F11 | LOW | Missed value | `assetProfile.country` / `longBusinessSummary` / `fullTimeEmployees` |

**Top 3 actionable items**: F1 (silent ADR currency mis-classification right now), F4+F5 (unlock buyback-yield → capital-allocation-quality composite), F2+F3 (replace heuristic EBITDA proxy with Yahoo's actual figure).

---

## 2. Methodology

### Live calls executed

```js
const YF = require('yahoo-finance2').default;
const yf = new YF({ suppressNotices: ['yahooSurvey'], validation: {logErrors:false, logOptionsErrors:false} });
await yf.quoteSummary('NVDA', { modules: [<the 11 in MODULES>] });
await yf.fundamentalsTimeSeries('NVDA', { type:'annual', module:'financials|cash-flow|balance-sheet' });
await yf.fundamentalsTimeSeries('NVDA', { type:'quarterly', module:'financials' });
// + probes for ADRs (TSM, BABA, 9988.HK) and for un-pulled modules
//   (earningsHistory, calendarEvents, recommendationTrend,
//    upgradeDowngradeHistory, majorHoldersBreakdown, netSharePurchaseActivity).
```

### Field-by-field comparison

For each MODULE in `pull-yahoo.js:77` and each `mapYahooToCanonical` (~line 465) read, I matched:
- (a) the Yahoo field name actually returned in the live payload,
- (b) the path the code reads (`_y(obj, 'fieldName')`),
- (c) at least one downstream consumer (grep in `methods/`).

---

## 3. Findings

### F1 — CRITICAL — `price.financialCurrency` is undefined; Tag-204 ADR fix is BROKEN

**Yahoo field:** `financialData.financialCurrency` (NOT `price.financialCurrency`).
**Live evidence:**

| Ticker | `price.currency` | `price.financialCurrency` | `financialData.financialCurrency` |
|---|---|---|---|
| NVDA | USD | **undefined** | USD |
| TSM | USD | **undefined** | TWD |
| BABA | USD | **undefined** | CNY |
| 9988.HK | HKD | **undefined** | CNY |

**Current state:** `pull-yahoo.js:658` reads `_fc = _y(pr, 'financialCurrency')` — always returns `null` today.
**Impact:** The whole Tag-204 ADR fix collapses. For TSM/BABA/9988.HK the mapper picks `rcOriginal = _tc` (trading ccy) → `_convertSnapshotToUSD` runs the WRONG currency conversion. TSM annual.* end up multiplied by USD→TWD path or skipped entirely; in practice ADRs labeled USD silently early-return from FX scaling while their annual.* are reported in local currency → fcf-yield, ev/ebitda, P/S inflated by ~30× exactly the bug Tag-204 thought it fixed.

Also, `meta.ccyAmbiguous` flag at line 668 fires for **every ticker**, not just OTC edge cases.

**Proposed fix (one-line):**
```js
// Replaces line 658
const _fc = _y(pr, 'financialCurrency') ?? _y(yahoo.financialData, 'financialCurrency');
```

**Downstream beneficiary:** every method that consumes `marketCap`, `annualRev`, `annualFCF`, `annualBalance`, `revenueTTM` — i.e. essentially the whole pipeline — when the ticker is an ADR or cross-listed name.

---

### F2 — HIGH — `financialData.ebitda` available but unused; `ev-ebitda` uses `opInc * 1.2` proxy

**Yahoo field:** `financialData.ebitda` (NVDA: `133230002176` = $133B; matches `defaultKeyStatistics.enterpriseToEbitda` of 40.7).
**Current state:** Extracted: NO. Used: NO.
**Method dependency:** `methods/ev-ebitda.js:31` — `const ebitda = opInc * 1.2;` (hardcoded D&A multiplier).
**Impact:** EBITDA proxy systematically wrong for capital-intensive firms (D&A >> 20% of OpInc → underestimates EBITDA → EV/EBITDA too high → false fails) and asset-light SaaS (D&A << 20% → overestimates EBITDA → EV/EBITDA too low → false passes).
**Proposed extraction** (in `mapYahooToCanonical`, metrics block ~line 711):
```js
ebitda:     _metric(_y(fd, 'ebitda'), SRC, CONF, asOf),
ebitdaMargins: _metric(_y(fd, 'ebitdaMargins') != null ? _y(fd, 'ebitdaMargins') * 100 : null, SRC, CONF, asOf),
```
Then `ev-ebitda.js` reads `stock.metrics.ebitda.value` with fallback to opInc*1.2.
**Note:** `ebitda` is currency-denominated — already on the CCY_DENOMINATED_METRICS whitelist (line 308–315) as "reserved", so FX conversion is in place the day extraction is added.

---

### F3 — HIGH — `defaultKeyStatistics.enterpriseValue` / `enterpriseToEbitda` / `enterpriseToRevenue` unused

**Yahoo fields:** `ks.enterpriseValue` (NVDA: $5.42T), `ks.enterpriseToEbitda` (40.71), `ks.enterpriseToRevenue` (25.12).
**Current state:** Module IS pulled (`defaultKeyStatistics`), but mapper extracts only `heldPercentInsiders` from it (line 718). Header comment at line 80 promises "sharesOutstanding, beta, enterpriseValue" — none of those make it into the snapshot.
**Impact:** `ev-ebitda.js` reconstructs EV from `mcap + totalDebt - totalCash` manually (line 21) when Yahoo already provides it pre-computed. Two discrepancies risk regressions:
  1. Yahoo's EV includes minority-interest / preferred (proper definition), our manual EV omits both.
  2. `enterpriseToRevenue` would be a one-line replacement of the priceSales sector-relative gap.

**Proposed extraction** (in metrics block):
```js
enterpriseValue:     _metric(_y(ks, 'enterpriseValue'),    SRC, CONF, asOf),  // CCY-denominated
enterpriseToEbitda:  _metric(_y(ks, 'enterpriseToEbitda'), SRC, CONF, asOf),  // ratio
enterpriseToRevenue: _metric(_y(ks, 'enterpriseToRevenue'),SRC, CONF, asOf),  // ratio
beta:                _metric(_y(ks, 'beta'),               SRC, 0.8,  asOf),
```

---

### F4 — HIGH — FTS share-count series never extracted; `buyback-yield` is DEAD

**Yahoo fields (FTS annual financials, all NVDA confirmed):**
- `basicAverageShares` (4 years: 24.87B → 24.36B)
- `dilutedAverageShares` (4 years: 25.07B → 24.51B)

**Yahoo fields (FTS annual balance-sheet):**
- `ordinarySharesNumber` (5 years: undefined, 24.66B, 24.64B, 24.48B, 24.30B)
- `shareIssued` (same)

**Current state:** `_ftsExtractByYear` in pull-yahoo never names these fields. Mapper `mapFTSToAnnual` reads only rev/oi/gp/ni. `mapFTSToBalance` reads only cash/debt/assets/AR/PPE/etc.
**Method dependency:** `methods/buyback-yield.js:60` explicitly looks for `stock.annual.annualShares` (Tag-201 method, comment line 28 calls it "future-proofed for a planned pull-yahoo extension" — the extension never happened). Result: buyback-yield returns `computable:false` UNIVERSALLY → dilutes `capital-allocation-quality.js` composite to a 3-of-4 scaling instead of full 4-of-4.
**Proposed extraction** (in `processOne` after FTS pull, ~line 1264):
```js
// Tag 219c: annualShares from FTS — unblocks buyback-yield + cap-alloc-quality
const ftsAnnualShares = _ftsExtractByYear(fts.annualFin,
  ['dilutedAverageShares', 'basicAverageShares']);
// ... merge:
if (ftsAnnualShares.length > 0) canonical.annual.annualShares = ftsAnnualShares;
```
**Downstream beneficiaries:** `buyback-yield` (becomes computable for ~all anchors), `capital-allocation-quality` (one more dimension), future per-share metrics (FCF/share, BV/share, OE/share).

---

### F5 — HIGH — `defaultKeyStatistics.sharesOutstanding` extracted in name only

**Yahoo field:** `ks.sharesOutstanding` (NVDA: 24,220,525,225), `ks.floatShares`, `ks.impliedSharesOutstanding`.
**Current state:** Pull-yahoo MODULES comment line 80 lists "sharesOutstanding" but mapper never reads it. `meta.sharesOutstanding` is therefore never set, contradicting the buyback-yield.js docstring line 32 which lists `stock.meta.sharesOutstanding` as a Source-3 fallback.
**Proposed extraction** (in meta block ~line 671):
```js
sharesOutstanding: _y(ks, 'sharesOutstanding'),
floatShares:       _y(ks, 'floatShares'),
```
**Downstream:** spot-value fallback for buyback-yield (Source 3), enables price-per-share derivation in price-only updates, EV cross-check.

---

### F6 — MEDIUM — `majorHoldersBreakdown` module not in MODULES; institutional ownership free

**Yahoo module (not currently pulled):**
```
majorHoldersBreakdown.insidersPercentHeld         = 0.03979
majorHoldersBreakdown.institutionsPercentHeld     = 0.70567
majorHoldersBreakdown.institutionsFloatPercentHeld= 0.7349
majorHoldersBreakdown.institutionsCount           = 7487
```
**Current state:** `methods/institutional-ownership-13f.js` requires an external `external-data/sec-13f-by-ticker.json` cache that must be separately maintained (line 49). Yahoo gives a free 13F-aggregated approximation in one module call.
**Method dependency:** `institutional-ownership-13f.js` returns `computable:false` whenever the cache is missing/stale; Yahoo's value would be a clean fallback.
**Proposed:** Add `'majorHoldersBreakdown'` to MODULES (line 77) and persist as `meta.institutionsPercentHeld` / `meta.institutionsCount`.

---

### F7 — MEDIUM — `earningsHistory` module — surprise % over last 4 quarters

**Yahoo module (not currently pulled):**
```
earningsHistory.history[4]  // each: { epsActual, epsEstimate, epsDifference, surprisePercent, quarter, period }
```
**Current state:** Not pulled. The eight-quarter earnings-stability check (`quarterly-earnings-stability.js`) reconstructs from `timeseries.netIncomeQ` which is noisier than direct EPS-surprise data.
**Use case:** Earnings-surprise momentum is a documented post-earnings-announcement-drift (PEAD) signal — would feed a new diagnostic and improve `estimate-revision-proxy`.

---

### F8 — MEDIUM — `financialData` ratios extracted only partially

**Yahoo fields available in `fd` but NOT extracted:**
| Field | NVDA value | Potential consumer |
|---|---|---|
| `debtToEquity` | 7.255 | leverage diagnostic; redundant with net-debt-ebitda but quicker |
| `currentRatio` | 3.905 | working-capital sanity; piotroski-f sub-check |
| `quickRatio` | 3.141 | distress filter |
| `returnOnEquity` | 1.01485 | redundant with ROIC but ROE = directly-comparable to street headlines |
| `returnOnAssets` | 0.51188 | piotroski-f sub-check (one of 9) |
| `targetMeanPrice` / `targetMedianPrice` | 272.94 / 275 | implied upside, sell-side consensus |
| `numberOfAnalystOpinions` | 57 | "coverage" filter — newer IPOs <5 analysts have wider revision noise |
| `recommendationMean` / `recommendationKey` | 1.295 / strong_buy | sell-side sentiment signal |

**Cost:** Adding these is free — `financialData` is already in MODULES (line 79). 8 lines of `_y(fd, ...)` extraction.

---

### F9 — LOW — `defaultKeyStatistics.mostRecentQuarter` would beat `fetchedAt` as dataAsOf

**Yahoo field:** `ks.mostRecentQuarter` = `2026-01-25T00:00:00.000Z` (NVDA's actual fiscal-quarter-end).
**Current state:** `meta.fetchedAt` and `meta.asOf` reflect the API CALL time, not the actual quarter-end. `_dataAsOfFromStock` in `methods/_helpers.js:195` looks at `meta.fetchedAt` first, never the true fiscal quarter end. A snapshot pulled in May 2026 reports asOf=May-17 even though the underlying fundamentals are from January.
**Impact:** confidence decay (`_inferConfidence` in helpers, line 212) penalizes age — but uses the wrong reference (call time, not data time).
**Proposed:** Persist as `meta.mostRecentQuarter` and `meta.lastFiscalYearEnd`, then prefer them in `_dataAsOfFromStock`.

---

### F10 — LOW — `calendarEvents` module already replaces a separate puller

**Yahoo module:**
```
calendarEvents.earnings.earningsDate[]      = ['2026-05-20T20:00:00.000Z']
calendarEvents.earnings.earningsAverage     = 1.78058
calendarEvents.earnings.revenueAverage      = 79166935860
calendarEvents.exDividendDate               = '2026-03-11T00:00:00.000Z'
```
**Current state:** Project has a dedicated `pull-earnings-dates.js` script + `earnings-calendar.json` artifact. If Yahoo's `calendarEvents` is fetched alongside the regular quoteSummary, the second-pass puller becomes redundant.
**Recommendation:** Investigate folding `calendarEvents` into MODULES; retire the secondary pull script when proven.

---

### F11 — LOW — `assetProfile` ignored beyond sector/industry

**Yahoo fields extracted from `ap`:** `sector`, `industry` only.
**Yahoo fields available but unused:**
- `country` (would feed region normalization more reliably than the current FX-ccy heuristic in `normalizeRegion`)
- `fullTimeEmployees` (size-vs-revenue sanity)
- `longBusinessSummary` (UI tooltip; saves the UI from re-fetching)
- `sectorKey`, `industryKey` (canonical lowercased forms — would simplify the `sector === 'Financial Services' || sector === 'Financials'` workaround at lines 502, 1374)
- `auditRisk`, `boardRisk`, `compensationRisk`, `shareHolderRightsRisk`, `overallRisk` (ISS-style governance scores 1–10)
- `executiveTeam`, `companyOfficers[].totalPay` (proxy compensation ratio)

**Proposed minimum addition:**
```js
country:    _y(ap, 'country'),
sectorKey:  _y(ap, 'sectorKey'),
employees:  _y(ap, 'fullTimeEmployees'),
overallRisk: _y(ap, 'overallRisk'),
```

---

## 4. Schema-Drift Sentinel — proposed `tests/yahoo-schema-canary.js`

The Tag-204 ADR-fix breakage (F1) is the textbook case why we need a daily canary: a field that USED to exist (`price.financialCurrency`) silently disappeared sometime between 2026-Q1 (Tag-204 commit) and 2026-05-17 (this audit), and NO test fired.

### Design

```js
// tests/yahoo-schema-canary.js
// Runs daily in CI. Pulls a few anchor tickers, asserts the SHAPE of every
// field pull-yahoo depends on. Diffs against tests/_yahoo-schema-baseline.json.

const YF = require('yahoo-finance2').default;
const fs = require('fs');

const ANCHORS = ['NVDA','MSFT','TSM','BABA','9988.HK','JPM','BAC','LMND'];
const MODULES = require('../pull-yahoo.js').MODULES;  // export MODULES
const REQUIRED = {
  // path: kind (one of: 'number','string','date','array','object')
  'price.currency':                'string',
  'price.regularMarketPrice':      'number',
  'price.exchangeName':            'string',
  'financialData.financialCurrency': 'string',   // F1 sentinel — moved from price
  'financialData.ebitda':          'number',
  'financialData.freeCashflow':    'number',
  'financialData.totalRevenue':    'number',
  'summaryDetail.marketCap':       'number',
  'summaryDetail.trailingPE':      'number',
  'defaultKeyStatistics.sharesOutstanding': 'number',
  'defaultKeyStatistics.enterpriseValue':   'number',
  'defaultKeyStatistics.mostRecentQuarter': 'date',
  'assetProfile.sector':           'string',
  'assetProfile.industry':         'string',
  'earningsTrend.trend':           'array',
  'insiderTransactions.transactions': 'array',
  // FTS shapes
  'fts.annualFin[0].totalRevenue':  'number',
  'fts.annualFin[0].basicAverageShares': 'number',  // F4 sentinel
  'fts.annualCash[0].stockBasedCompensation': 'number',
  'fts.annualCash[0].capitalExpenditure': 'number',
  'fts.annualBs[0].cashAndCashEquivalents': 'number',
  'fts.annualBs[0].ordinarySharesNumber': 'number'  // F4 sentinel
};

async function run() {
  let failed = 0;
  for (const ticker of ANCHORS) {
    const qs  = await yf.quoteSummary(ticker, { modules: MODULES });
    const fts = {
      annualFin:  await yf.fundamentalsTimeSeries(ticker, { type:'annual', module:'financials',    period1: new Date(Date.now()-5*365*86400e3), period2: new Date() }),
      annualCash: await yf.fundamentalsTimeSeries(ticker, { type:'annual', module:'cash-flow',     period1: new Date(Date.now()-5*365*86400e3), period2: new Date() }),
      annualBs:   await yf.fundamentalsTimeSeries(ticker, { type:'annual', module:'balance-sheet', period1: new Date(Date.now()-5*365*86400e3), period2: new Date() })
    };
    const payload = { ...qs, fts };
    for (const [path, kind] of Object.entries(REQUIRED)) {
      const v = path.split(/\.|\[|\]/).filter(Boolean).reduce((o,k) => o == null ? o : o[k], payload);
      const ok = v != null && (
        kind === 'number'  ? Number.isFinite(v) :
        kind === 'string'  ? typeof v === 'string' && v.length > 0 :
        kind === 'date'    ? (v instanceof Date) || !Number.isNaN(Date.parse(v)) :
        kind === 'array'   ? Array.isArray(v) && v.length > 0 :
        kind === 'object'  ? typeof v === 'object' :
        false
      );
      if (!ok) {
        console.error(`SCHEMA-DRIFT ${ticker}.${path} expected ${kind}, got ${typeof v}=${JSON.stringify(v).slice(0,80)}`);
        failed++;
      }
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} schema-drift violations across ${ANCHORS.length} anchors`);
    process.exit(1);
  }
  console.log(`All ${Object.keys(REQUIRED).length * ANCHORS.length} schema invariants OK`);
}

run().catch(e => { console.error('CANARY FAIL', e); process.exit(2); });
```

### Wiring

- Add to `.github/workflows/daily-pull.yml` as a non-blocking job (continue-on-error: true) that posts a WARN comment to today's pull-run if drift is detected.
- Alternative: cheap nightly cron-only workflow (3 min, 8 tickers) that emails Karl on drift.
- The `REQUIRED` map is the single point of truth — every new field pull-yahoo starts depending on should be added here too. F1's regression would have caught `financialData.financialCurrency` becoming required while `price.financialCurrency` was silently dropped.

### Baseline strategy

On first green run, persist a frozen baseline (`tests/_yahoo-schema-baseline.json`). Subsequent runs diff against it; review-required for any new/missing field. This pattern is widely used (e.g. snapshot tests in Jest, OpenAPI lockfiles) — keeps human-in-the-loop for legit schema upgrades without permitting silent drift.

---

## 5. Appendix — modules pulled vs fields extracted (compact view)

| Module | Pulled | Fields extracted | Useful fields NOT extracted |
|---|---|---|---|
| `summaryDetail` | ✓ | marketCap, priceToSalesTrailing12Months, forwardPE, trailingPE | beta, fiftyTwoWeekHigh/Low, allTimeHigh, dividendYield, payoutRatio, averageVolume |
| `financialData` | ✓ | freeCashflow, totalRevenue, grossMargins, operatingMargins, revenueGrowth | **ebitda, financialCurrency (F1), debtToEquity, currentRatio, quickRatio, ROE, ROA, targetMeanPrice, recommendationMean, numberOfAnalystOpinions** |
| `defaultKeyStatistics` | ✓ | heldPercentInsiders | **sharesOutstanding (F5), floatShares, enterpriseValue (F3), enterpriseToEbitda, enterpriseToRevenue, beta, mostRecentQuarter (F9), pegRatio, bookValue, priceToBook, trailingEps, forwardEps, earningsQuarterlyGrowth, lastDividendValue/Date, 52WeekChange** |
| `incomeStatementHistory` | ✓ | totalRevenue, operatingIncome, netIncome, grossProfit, researchDevelopment, +financials-fallback line items | costOfRevenue, ebit, interestExpense, incomeBeforeTax, incomeTaxExpense |
| `balanceSheetHistory` | ✓ | (almost empty since Nov 2024 — FTS fallback) | n/a (use FTS) |
| `cashflowStatementHistory` | ✓ | OpCash, capex (with FTS fallback) | (almost empty since Nov 2024 — FTS fallback) |
| `incomeStatementHistoryQuarterly` | ✓ | totalRevenue, operatingIncome, grossProfit | researchDevelopment quarterly, netIncome quarterly (could replace `ftsQuarterlyNI`) |
| `price` | ✓ | currency, financialCurrency (BROKEN — F1), exchangeName, longName | exchange, quoteType, regularMarketChangePercent, fiftyTwoWeekHigh |
| `assetProfile` | ✓ | sector, industry | **country (F11), fullTimeEmployees, longBusinessSummary, sectorKey, overallRisk, executiveTeam** |
| `insiderTransactions` | ✓ | shares/text/date (90d cluster) | per-tx `value` (USD), `ownership` field, multi-window (180d, 365d) |
| `earningsTrend` | ✓ | epsRevisions per period | **growth (per-period analyst-consensus growth %), revenueEstimate avg/low/high, earningsEstimate avg/low/high, epsTrend (current vs 7d/30d/60d/90d)** |
| `majorHoldersBreakdown` | **✗** | — | **institutionsPercentHeld (F6), institutionsCount** |
| `earningsHistory` | **✗** | — | **epsSurprise per quarter (F7)** |
| `calendarEvents` | **✗** | — | **earningsDate, exDividendDate (F10) — could retire pull-earnings-dates.js** |
| `recommendationTrend` | **✗** | — | strongBuy/buy/hold/sell/strongSell counts by period |
| `upgradeDowngradeHistory` | **✗** | — | analyst rating changes (984 entries for NVDA) |
| `netSharePurchaseActivity` | **✗** | — | 6-month aggregated insider buy/sell counts (richer than our 90d derived data) |

### FTS modules — fields extracted vs fields available

| FTS module | Extracted | Notable un-extracted |
|---|---|---|
| `annual financials` | totalRevenue, operatingIncome, grossProfit, netIncome, researchAndDevelopment, sellingGeneralAndAdministration (Tag 211l) | **basicAverageShares (F4), dilutedAverageShares, EBIT, EBITDA, normalizedEBITDA, normalizedIncome, taxProvision, taxRateForCalcs, interestExpense** |
| `quarterly financials` | totalRevenue, operatingIncome, grossProfit, netIncome | same shares + EBITDA fields, plus per-quarter R&D |
| `annual cash-flow` | OpCash, FCF, capex, SBC, D&A (Tag 211l) | **cashDividendsPaid, repurchaseOfCapitalStock, netCommonStockIssuance, changeInWorkingCapital, changeInReceivables** (all useful for capital-allocation + earnings-quality) |
| `annual balance-sheet` | cash, debt, totalAssets, AR, netPPE, currentAssets, currentLiabilities, totalLiabilities (Tag 211l) | **ordinarySharesNumber (F4), shareIssued, goodwill, intangibleAssets, retainedEarnings, stockholdersEquity, commonStockEquity, netDebt, investedCapital, tangibleBookValue, workingCapital** |

---

## 6. Recommended fix priority

1. **F1 (10 min, NOW)** — one-line fallback `_y(yahoo.financialData, 'financialCurrency')` in pull-yahoo line 658. Silent ADR mis-classification today.
2. **F4 + F5 (30 min)** — add 3 lines to surface `annualShares` from FTS and `sharesOutstanding` from quoteSummary. Unlocks `buyback-yield` and improves `capital-allocation-quality`.
3. **F2 + F3 (1 hour)** — extract Yahoo's native `ebitda` + `enterpriseValue`; refactor `ev-ebitda.js` to prefer them with `opInc*1.2` fallback. Eliminates a systematic heuristic bias.
4. **Schema-drift canary (2 hours)** — author + wire `tests/yahoo-schema-canary.js`. Catches the next F1-class breakage at most 24h after Yahoo deploys it.
5. F6–F11 — additive value, lower urgency.

---

End of audit.
