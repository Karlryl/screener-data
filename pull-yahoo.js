#!/usr/bin/env node
/**
 * Tag 13: Yahoo-Pull-Skript (v2 — mit yahoo-finance2)
 * ====================================================
 *
 * Liest watchlist.json, pullt für jede ISIN Yahoo-quoteSummary, mappt zu canonicalInput
 * (siehe engine-v7.3) und schreibt JSON-Files pro ISIN in den output-Ordner.
 *
 * Run:
 *   node pull-yahoo.js [--watchlist watchlist.json] [--output ./snapshots] [--rate-limit 1500]
 *
 * Dependencies:
 *   yahoo-finance2 (npm install yahoo-finance2). Yahoo blockt anonyme quoteSummary
 *   seit ~2024; yahoo-finance2 handhabt den Crumb/Cookie-Flow intern.
 *
 * Setup für GitHub-Actions:
 *   - package.json mit yahoo-finance2 als Dependency
 *   - actions/setup-node@v4 + npm ci im Workflow
 *   - rate-limit ≥1500ms gegen Yahoo-403/Blocking
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Tag 133c: data-quality grading (per-snapshot A/B/C/D)
const { gradeSnapshot } = require('./methods/data-quality.js');
// Tag 189: F-DP-052 — atomic FTS-cache + snapshot writes.
const { writeFileAtomic } = require('./lib/atomic-write.js');

// Tag 134: Windows reserved-name sanitization. Continental AG (`CON.DE`) collides
// with the Windows reserved device name CON; the file can't be written on Windows,
// breaking `git checkout` and `git pull` for any Windows developer. Prefix such
// tickers with `_` so the filename is portable. The ticker inside the JSON is
// unchanged — only the on-disk filename differs.
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
function safeSnapshotFilename(ticker) {
  const sanitized = String(ticker).replace(/[^A-Z0-9.-]/gi, '_');
  const stem = sanitized.split('.')[0];
  if (WINDOWS_RESERVED.test(stem)) return '_' + sanitized + '.json';
  return sanitized + '.json';
}

let YahooFinance;
try {
  YahooFinance = require('yahoo-finance2').default;
} catch (e) {
  // Fallback: lokale node_modules (z.B. /tmp während Dev)
  try { YahooFinance = require('/tmp/node_modules/yahoo-finance2').default; }
  catch (e2) {
    console.error('FATAL: yahoo-finance2 nicht installiert. Run: npm install yahoo-finance2');
    process.exit(1);
  }
}

// Tag 147: yf-queue concurrency now reads PULL_CONCURRENCY env (same as outer batch).
// Hard-coding 8 made PULL_CONCURRENCY=20 a no-op for actual HTTP parallelism.
const _YF_CONC = parseInt(process.env.PULL_CONCURRENCY || '10', 10);
// Tag 211c: silence yahoo-finance2 schema-validation logging (see
// refresh-universe.js for full rationale). Constructor-level option since
// yahoo-finance2 v3.14.x does not expose setGlobalConfig.
const yf = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
  queue: { concurrency: _YF_CONC },
  validation: { logErrors: false, logOptionsErrors: false }
});

// Tag 166: Frequenztrennung — price-only mode for recent snapshots.
// Tickers with existing snapshot < FUNDAMENTALS_MAX_AGE_DAYS get a cheap yf.quote()
// update (~1s) instead of the full quoteSummary+fundamentalsTimeSeries pull (~6 calls, ~5s).
// Composes with Tag 164 staleness-sort: oldest first → full pull, recent → price-only.
const FUNDAMENTALS_MAX_AGE_DAYS = parseInt(process.env.FUNDAMENTALS_MAX_AGE_DAYS || '7', 10);
const FUNDAMENTALS_MAX_AGE_MS = FUNDAMENTALS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

// Modules die wir brauchen für canonicalInput-Mapping
const MODULES = [
  'summaryDetail',                      // marketCap, priceToSalesTrailing12Months, forwardPE, trailingPE
  'financialData',                      // profitMargins, operatingMargins, grossMargins, freeCashflow, totalRevenue, revenueGrowth
  'defaultKeyStatistics',               // sharesOutstanding, beta, enterpriseValue
  'incomeStatementHistory',             // annual rev/OpInc/NetInc/grossProfit
  'balanceSheetHistory',                // cash, debt, totalAssets
  'cashflowStatementHistory',           // OpCash, capex
  'incomeStatementHistoryQuarterly',    // quartal-rev/OpInc — für Acceleration-Detection
  'price',                              // currency, exchange
  'assetProfile',                       // sector, industry
  'insiderTransactions',                // Tag 137: Form 4 insider buy/sell activity
  'earningsTrend',                      // Tag 211h: epsRevisions per period — activates analyst-revision-breadth
  // Tag 220c (audit F-219c-F6 MEDIUM): majorHoldersBreakdown — institutionsPercentHeld,
  // institutionsCount, insidersPercentHeld. Free fallback for institutional-ownership-13f
  // when the SEC 13F by-ticker cache is missing or hasn't been refreshed yet.
  'majorHoldersBreakdown',
  // Tag 220c (audit F-219c-F7 MEDIUM): earningsHistory — last 4 quarters with
  // epsActual / epsEstimate / epsDifference / surprisePercent / quarter.
  // Exposed via stock.external.earningsHistory; no new method (data lake build).
  'earningsHistory'
];

// ─── Logger ───────────────────────────────────────────────────────


// Tag-87c / Tag-133b: FX-Rates für Currency-Conversion (USD-base).
// Live-Rates aus fx-rates.json (refresh-fx.js Workflow-Step) wenn vorhanden + frisch (≤14d).
// Fallback: hardgecodete Tabelle (kann Monate stale sein — flagged via _log WARN).
// F-DQ-007 (Tag 188): FX_FALLBACK expanded to match refresh-fx.js CURRENCIES list.
// One missed CI run >14 days ago previously left TRY/IDR/EM tickers silently
// fxConversionFailed (no rate at all → meta.fxRateApplied=null) — universe
// effectively shrank without alarm. Hardcoded fallbacks are stale 2026-Q1 ish;
// flagged via FX_PROVENANCE='fallback-hardcoded' so downstream code can warn.
const FX_FALLBACK = {
  USD: 1.0, EUR: 1.08, GBP: 1.27, CHF: 1.10,
  SEK: 0.095, NOK: 0.092, DKK: 0.145,
  JPY: 0.0067, HKD: 0.128, CNY: 0.139,
  AUD: 0.65, CAD: 0.74, KRW: 0.00074, INR: 0.012,
  TWD: 0.031, BRL: 0.20, MXN: 0.058, ZAR: 0.054,
  SGD: 0.74,
  // F-DQ-007 additions — currencies refresh-fx now fetches but FX_FALLBACK lacked.
  PLN: 0.25, TRY: 0.029, THB: 0.029, IDR: 0.000063,
  MYR: 0.22, PHP: 0.018, VND: 0.000040, CZK: 0.044,
  HUF: 0.0028, RON: 0.22, AED: 0.27, SAR: 0.27,
  QAR: 0.27, ILS: 0.27
};
const FX_STALE_DAYS = 14;
let FX_TO_USD = FX_FALLBACK;
let FX_SOURCE = 'fallback-hardcoded';
// F-DQ-003 (Tag 181): track per-currency provenance so a per-stock conversion can
// report whether its specific rate was live or 2024-hardcoded. Without this,
// Object.assign(FX_FALLBACK, raw.rates) for a partial-refresh leaked stale 2024
// values into snapshots whose fxRateSource reported "live".
const FX_PROVENANCE = {};   // key uppercase currency → 'live' | 'fallback-hardcoded'
for (const k of Object.keys(FX_FALLBACK)) FX_PROVENANCE[k] = 'fallback-hardcoded';
(function loadFx() {
  try {
    const fxPath = require('path').join(__dirname, 'fx-rates.json');
    if (!require('fs').existsSync(fxPath)) return;
    const raw = JSON.parse(require('fs').readFileSync(fxPath, 'utf8'));
    if (!raw || !raw.rates || typeof raw.rates !== 'object') return;
    const fetchedAt = raw.fetchedAt ? new Date(raw.fetchedAt) : null;
    const ageDays = fetchedAt ? (Date.now() - fetchedAt.getTime()) / 86400000 : Infinity;
    if (ageDays > FX_STALE_DAYS) {
      console.log('[FX] fx-rates.json is ' + ageDays.toFixed(1) + 'd old — using fallback');
      return;
    }
    FX_TO_USD = Object.assign({}, FX_FALLBACK, raw.rates);
    FX_SOURCE = 'fx-rates.json @ ' + (raw.fetchedAt || 'unknown');
    // F-DP-051 / F-DQ-008 (Tag 188): per-currency staleness gate.
    // refresh-fx now writes currencyMeta[c].lastSuccessAt per-currency, but the
    // top-level fetchedAt only fails the freshness check above if EVERY currency
    // failed >14d. If TRY/IDR/EM-currency individually has been failing for 30d
    // while majors succeed, fetchedAt looks fresh and the stale per-currency rate
    // is silently applied — whole EM legs mis-priced. Honor lastSuccessAt: drop
    // rates whose per-currency last success is older than FX_STALE_DAYS so the
    // fallback table (with provenance='fallback-hardcoded') takes over.
    const currencyMeta = raw.currencyMeta || {};
    const failedList = Array.isArray(raw.failed) ? raw.failed : [];
    let staleCount = 0;
    let inFailedButFreshCount = 0;
    for (const k of Object.keys(raw.rates)) {
      const up = k.toUpperCase();
      const meta = currencyMeta[k] || currencyMeta[up] || null;
      const lastSuccess = meta && meta.lastSuccessAt ? new Date(meta.lastSuccessAt) : fetchedAt;
      const perCurAgeDays = lastSuccess
        ? (Date.now() - lastSuccess.getTime()) / 86400000
        : Infinity;
      const inFailedList = failedList.includes(k) || failedList.includes(up);
      if (perCurAgeDays > FX_STALE_DAYS) {
        // F-DP-051 / F-DQ-008: revert to FX_FALLBACK; mark provenance so
        // snapshot-side ratios that depend on this currency can flag
        // fxRateSource accordingly.
        if (FX_FALLBACK[up] != null) {
          FX_TO_USD[up] = FX_FALLBACK[up];
        } else {
          delete FX_TO_USD[up];  // no fallback at all → conversion will fail loudly
        }
        FX_PROVENANCE[up] = 'fallback-hardcoded';
        staleCount++;
        console.log('[FX] ' + up + ' stale (' + perCurAgeDays.toFixed(1) +
          'd since last success) → using fallback');
      } else {
        FX_PROVENANCE[up] = 'live';
        FX_TO_USD[up] = raw.rates[k];  // ensure uppercase key lookup hits
        // F-DP-034 (Tag 190): if the latest refresh-fx run failed THIS currency
        // but last-success is still within FX_STALE_DAYS, the rate is OK for
        // now — but worth flagging so operators see drift before it tips over
        // into the hard stale branch.
        if (inFailedList) {
          inFailedButFreshCount++;
          console.warn('[FX] ' + up + ' in failed[] of latest refresh-fx run; ' +
            'rate still fresh (' + perCurAgeDays.toFixed(1) + 'd) — monitor');
        }
      }
    }
    const liveCount = Object.values(FX_PROVENANCE).filter(v => v === 'live').length;
    const fallbackCount = Object.values(FX_PROVENANCE).filter(v => v === 'fallback-hardcoded').length;
    console.log('[FX] Loaded ' + Object.keys(raw.rates).length + ' rates from fx-rates.json (' +
      liveCount + ' live, ' + fallbackCount + ' fallback' +
      (staleCount > 0 ? ', ' + staleCount + ' reverted from stale per-currency' : '') +
      (inFailedButFreshCount > 0 ? ', ' + inFailedButFreshCount + ' in failed[] but fresh' : '') + ')');
  } catch (e) {
    console.log('[FX] fx-rates.json load failed: ' + e.message + ' — using fallback');
  }
})();
function _convertToUSD(value, currency) {
  if (value == null || !currency) return value;
  const rate = FX_TO_USD[currency.toUpperCase()];
  if (rate == null) return value;
  return value * rate;
}

// Tag 134: stable region enum derived from currency + exchangeName.
// Replaces the prior bug where meta.region held Yahoo's raw exchangeName
// like "NasdaqGS" / "Frankfurt", which the engine then compared against
// "US" / "EU" — never matched, fell through to 0.25 tax rate fallback.
const REGION_BY_CURRENCY = {
  USD: 'US', CAD: 'CA',
  EUR: 'EU', GBP: 'UK', GBp: 'UK', CHF: 'CH',
  SEK: 'SE', NOK: 'NO', DKK: 'DK', PLN: 'EU',
  JPY: 'JP', HKD: 'HK', CNY: 'CN', KRW: 'KR', TWD: 'TW',
  SGD: 'SG', INR: 'IN', THB: 'EM', IDR: 'EM',
  AUD: 'AU', NZD: 'AU',
  BRL: 'EM', MXN: 'EM', ZAR: 'EM', RUB: 'EM', TRY: 'EM',
  SAR: 'EM', AED: 'EM', ILS: 'EM'
};
function normalizeRegion(currency, exchangeName) {
  if (currency) {
    const cur = String(currency);
    const region = REGION_BY_CURRENCY[cur] || REGION_BY_CURRENCY[cur.toUpperCase()];
    if (region) return region;
  }
  const exch = String(exchangeName || '').toLowerCase();
  if (/nasdaq|nyse|amex|otc|pink|bats/.test(exch)) return 'US';
  if (/london|lse/.test(exch)) return 'UK';
  if (/frankfurt|xetra|stuttgart|berlin|munich|tradegate/.test(exch)) return 'EU';
  if (/paris|euronext|amsterdam|brussels|lisbon|milan/.test(exch)) return 'EU';
  if (/tokyo|osaka/.test(exch)) return 'JP';
  if (/hong ?kong|hkex/.test(exch)) return 'HK';
  if (/shanghai|shenzhen/.test(exch)) return 'CN';
  if (/toronto|tsx/.test(exch)) return 'CA';
  if (/sydney|asx|aussie/.test(exch)) return 'AU';
  return 'OTHER';
}

// Tag 134: single-pass USD normalization applied at end of mapper.
// Closes the structural defect where marketCap was USD but annual/quarterly
// series were left in reportingCurrency — silently corrupting every ratio
// (fcf-yield, ev/ebitda, etc.) for non-USD stocks.
function _convertSnapshotToUSD(snap) {
  if (!snap || !snap.meta) return snap;
  // F-DP-008: idempotency guard — if already converted, return immediately to prevent double-scaling
  if (snap.meta.fxConverted === true) return snap;
  const origCurrency = snap.meta.reportingCurrency || 'USD';
  if (origCurrency === 'USD') {
    snap.meta.reportingCurrencyOriginal = 'USD';
    snap.meta.fxRateApplied = 1.0;
    snap.meta.fxConverted = true;
    return snap;
  }

  // Tag 148: British pence (GBp/GBX) — Yahoo quotes some UK shares in pence, not pounds.
  // marketCap and financial values are already 100x too small relative to GBP.
  // Divide by 100 first to convert pence → pounds, then apply the GBP→USD rate.
  // F-DQ-003: case-insensitive match including GBX variant
  const isPence = /^GB[Xp]$/i.test(origCurrency) || origCurrency.toUpperCase() === 'GBPENCE';
  const fxKey = isPence ? 'GBP' : origCurrency.toUpperCase();

  const rate = FX_TO_USD[fxKey];
  if (rate == null) {
    // unknown currency — keep values as-is, flag for diagnostics
    snap.meta.reportingCurrencyOriginal = origCurrency;
    snap.meta.fxRateApplied = null;
    snap.meta.fxConversionFailed = true;
    snap.meta.fxConverted = false; // F-DP-008: not converted
    return snap;
  }
  // F-DP-024 / F-DQ-003 (Tag 181): per-currency provenance — even when FX_SOURCE
  // is fx-rates.json overall, a specific currency that wasn't in raw.rates is
  // still on the 2024 hardcoded fallback. Report that accurately per snapshot.
  const perCurrency = FX_PROVENANCE[fxKey] || 'fallback-hardcoded';
  if (FX_SOURCE === 'fallback-hardcoded' || perCurrency === 'fallback-hardcoded') {
    if (FX_SOURCE === 'fallback-hardcoded') {
      console.warn(`FX-FALLBACK: using hardcoded 2024 rates for ${fxKey} — may be stale. Consider running refresh-fx.js`);
    }
    snap.meta.fxRateSource = perCurrency === 'live' ? FX_SOURCE : 'hardcoded-fallback';
  } else {
    snap.meta.fxRateSource = FX_SOURCE;
  }

  // Combined factor: pence→pounds (÷100) then pounds→USD (*rate), or just *rate for normal currencies.
  const factor = isPence ? rate / 100 : rate;

  function scale(item) {
    if (item == null) return item;
    if (typeof item === 'number') return Number.isFinite(item) ? item * factor : item;
    if (typeof item !== 'object') return item;
    if ('value' in item) {
      const out = Object.assign({}, item);
      if (typeof item.value === 'number' && Number.isFinite(item.value)) out.value = item.value * factor;
      return out;
    }
    // balance-sheet rows: { totalCash, totalDebt, totalAssets }
    const out = {};
    for (const [k, v] of Object.entries(item)) {
      out[k] = (typeof v === 'number' && Number.isFinite(v)) ? v * factor : v;
    }
    return out;
  }

  if (snap.marketCap) snap.marketCap = scale(snap.marketCap);
  // Tag 204 (Bug #2 — architectural, LOW severity): explicit metrics.* allow-list.
  // The previous code only scaled `metrics.revenueTTM` ad-hoc; any future
  // currency-denominated metrics field (e.g. fcfTTM, ebitda, enterpriseValue,
  // bookValuePerShare) would silently bypass FX conversion and stay in local ccy.
  // We enumerate explicitly here so additions are reviewed at this single site.
  // RATIOS (margin/growth/pe/priceSales/sbcRatio/insidersOwnership) and counts
  // (cashRunway in months) are NOT included — they are unit-less or cancel out.
  const CCY_DENOMINATED_METRICS = [
    'revenueTTM',
    'fcfTTM',            // currently absent from metrics.* but reserved
    'ebitda',            // currently absent — reserved for future EV-EBITDA refactor
    'enterpriseValue',   // currently absent — reserved
    'bookValuePerShare', // currently absent — reserved
    'cashPerShare'       // currently absent — reserved
  ];
  if (snap.metrics) {
    for (const k of CCY_DENOMINATED_METRICS) {
      if (snap.metrics[k]) snap.metrics[k] = scale(snap.metrics[k]);
    }
  }
  if (snap.annual) {
    for (const key of Object.keys(snap.annual)) {
      if (Array.isArray(snap.annual[key])) snap.annual[key] = snap.annual[key].map(scale);
    }
  }
  if (snap.timeseries) {
    for (const key of Object.keys(snap.timeseries)) {
      if (Array.isArray(snap.timeseries[key])) snap.timeseries[key] = snap.timeseries[key].map(scale);
    }
  }
  snap.meta.reportingCurrencyOriginal = origCurrency;
  snap.meta.reportingCurrency = 'USD';
  // For GBp: store the effective combined factor (pence→USD = GBP_rate/100).
  // fxRateApplied reflects what was actually multiplied so callers can reverse if needed.
  snap.meta.fxRateApplied = factor;
  // F-DP-008: mark as converted to prevent double-scaling on subsequent calls
  snap.meta.fxConverted = true;
  return snap;
}

function _ts() { return new Date().toISOString(); }
function _log(level, msg) { console.log(`[${_ts()}] [${level}] ${msg}`); }

// ─── Mapper-Helpers ───────────────────────────────────────────────

function _y(obj, ...keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null) return null;
    cur = cur[k];
  }
  // yahoo-finance2 unwrappt {raw, fmt} schon zu Number — meistens.
  if (cur && typeof cur === 'object' && 'raw' in cur) return cur.raw;
  return cur;
}

function _metric(value, source, confidence, asOf) {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return null;
  return { value, source, confidence, asOf };
}

function _arr(history, key) {
  if (!Array.isArray(history)) return [];
  return history.map(r => {
    const v = _y(r, key);
    if (v == null) return null;
    return { value: v };
  }).filter(Boolean);
}

// ─── Tag 203: Fintech-aware OpInc fallback ────────────────────────
// Yahoo's `incomeStatementHistory.operatingIncome` (and FTS counterpart) is
// null for many Financial-Services tickers — banks (JPM, BAC), credit (UPST,
// SOFI, NU), insurance (LMND) — because the bank/insurance income statement
// uses a different chart-of-accounts (net interest income, premiums,
// provisions). Downstream methods that depend on annualOpInc (loss-magnitude-
// guard, metric-divergence-guard, ni-volatility-guard) then silently exit
// `computable:false`, preventing profitable fintech (NU) from being scored.
//
// This helper derives a per-year OpInc estimate from fields that ARE present
// in the canonical payload, only when:
//   (a) sector === 'Financial Services'  (sector-gated; never fires for tech)
//   (b) annualOpInc is empty after both quoteSummary + FTS paths
//
// Three derivation paths, tried in order:
//   1. "computed-bank":      OpInc[y] = totalRev[y] − totalOpEx[y] − provisionForCreditLosses[y]
//   2. "computed-insurance": OpInc[y] = totalRev[y] − costOfRev[y] − SG&A[y]
//   3. "computed-margin":    OpInc[y] = totalRev[y] × (operatingMargins TTM)
// Path 3 is the universal fallback — it works whenever Yahoo provides revenue
// and an operatingMargin metric (almost always true), even though it folds
// year-by-year volatility into a single TTM margin. Methods can flag this
// as derived via `meta.opIncSource`.
//
// Returns { values: [{value:n}, ...]  // latest-first, _arr-compatible
//         , source: 'computed-bank' | 'computed-insurance' | 'computed-margin' | null }
// `null` source means no fallback was possible (annualRev empty AND no margin).
function _deriveOpIncForFinancials(isHist, annualRev, operatingMarginsRaw) {
  // Path 1 & 2: try per-year line-item extraction from raw isHist rows.
  // Banks: totalRev − totalOperatingExpenses − provisionForLoanLeasesAndCreditLosses.
  // Insurance: totalRev − costOfRevenue − sellingGeneralAdministrative.
  // Yahoo legacy isHist rarely populates these for financials (as of 2026),
  // but if it ever does we prefer the line-item derivation over margin × rev.
  const rows = Array.isArray(isHist) ? isHist : [];
  const bankYearly = [];
  const insYearly = [];
  let bankNonNull = 0;
  let insNonNull = 0;
  for (const r of rows) {
    const rev = _y(r, 'totalRevenue');
    if (rev == null) { bankYearly.push(null); insYearly.push(null); continue; }
    // Bank pattern.
    // Tag 206j (Bug-Hunt Agent D MEDIUM F4): only emit a bank-derived OpInc
    // when BOTH operatingExpenses AND provisionForCreditLosses are present.
    // Previously `provisionForCreditLosses ?? 0` defaulted to zero, which
    // SILENTLY OVERSTATES OpInc by 5-15% of revenue for credit-heavy banks
    // where Yahoo omits the provision line (JPM, BAC, C class). Without the
    // provision the bank-pattern math is incomplete — better to push null and
    // let the insurance or margin-fallback paths handle the year.
    const opEx = _y(r, 'totalOperatingExpenses') ?? _y(r, 'operatingExpense');
    const provCL = _y(r, 'provisionForLoanLeasesAndCreditLosses')
                ?? _y(r, 'provisionForCreditLosses');  // NO fallback to 0
    if (opEx != null && provCL != null) {
      bankYearly.push({ value: rev - opEx - provCL });
      bankNonNull++;
    } else {
      bankYearly.push(null);
    }
    // Insurance pattern
    const cor = _y(r, 'costOfRevenue');
    const sga = _y(r, 'sellingGeneralAdministrative');
    if (cor != null && sga != null) {
      insYearly.push({ value: rev - cor - sga });
      insNonNull++;
    } else {
      insYearly.push(null);
    }
  }
  // Prefer the path with the most non-null derived years.
  if (bankNonNull > 0 && bankNonNull >= insNonNull) {
    return { values: bankYearly.filter(Boolean), source: 'computed-bank' };
  }
  if (insNonNull > 0) {
    return { values: insYearly.filter(Boolean), source: 'computed-insurance' };
  }

  // Path 3 (universal): margin × revenue. operatingMarginsRaw is a fraction
  // (Yahoo: 0.43741 = 43.741%). Skip if either input missing.
  if (typeof operatingMarginsRaw !== 'number' || !Number.isFinite(operatingMarginsRaw)) {
    return { values: [], source: null };
  }
  if (!Array.isArray(annualRev) || annualRev.length === 0) {
    return { values: [], source: null };
  }
  const derived = annualRev
    .map(r => (r && typeof r.value === 'number' && Number.isFinite(r.value))
        ? { value: r.value * operatingMarginsRaw }
        : null)
    .filter(Boolean);
  if (derived.length === 0) return { values: [], source: null };
  return { values: derived, source: 'computed-margin' };
}

// ─── Mapper ────────────────────────────────────────────────────────

function mapYahooToCanonical(yahoo, watchlistEntry, asOf) {
  const SRC = 'yahoo_quoteSummary';
  const CONF = 0.9;
  const sd = yahoo.summaryDetail || {};
  const fd = yahoo.financialData || {};
  const ks = yahoo.defaultKeyStatistics || {};
  const ap = yahoo.assetProfile || {};
  const pr = yahoo.price || {};
  const isHist = (yahoo.incomeStatementHistory && yahoo.incomeStatementHistory.incomeStatementHistory) || [];
  const isHistQ = (yahoo.incomeStatementHistoryQuarterly && yahoo.incomeStatementHistoryQuarterly.incomeStatementHistory) || [];
  const cfHist = (yahoo.cashflowStatementHistory && yahoo.cashflowStatementHistory.cashflowStatements) || [];
  const bsHist = (yahoo.balanceSheetHistory && yahoo.balanceSheetHistory.balanceSheetStatements) || [];

  const revGrowth = _y(fd, 'revenueGrowth');
  const revGrowthYoY = revGrowth != null ? revGrowth * 100 : null;

  // Annual-Arrays (latest first)
  const annualRev = _arr(isHist, 'totalRevenue');
  let annualOpInc = _arr(isHist, 'operatingIncome');
  const annualNetIncome = _arr(isHist, 'netIncome');
  const annualGP = _arr(isHist, 'grossProfit');

  // Tag 203: sector-aware OpInc fallback for Financial Services.
  // Yahoo's incomeStatementHistory.operatingIncome is null for banks (JPM,
  // BAC), credit (UPST, SOFI, NU), and insurance (LMND) because the bank/
  // insurance chart-of-accounts differs from industrials. Compute a per-year
  // OpInc estimate so downstream methods (loss-magnitude-guard, ni-volatility-
  // guard, metric-divergence-guard) become computable on profitable fintech.
  // SECTOR-GATED: never fires for non-financial sectors. Source recorded in
  // meta.opIncSource so methods can flag derived data. The FTS-merge in
  // pullAll re-applies this fallback if FTS also produced empty (see line ~990).
  let opIncSource = annualOpInc.length > 0 ? 'native' : null;
  const _sectorRaw = _y(ap, 'sector') || null;
  const _opMargRaw = _y(fd, 'operatingMargins');
  // Tag 206f (Bug-Hunt Agent D HIGH F3): Yahoo occasionally returns 'Financials'
  // (singular) instead of 'Financial Services' for holding-co's (BX, KKR class).
  // Strict equality missed those — fallback never ran for them.
  const _isFinancialSector = (_sectorRaw === 'Financial Services' || _sectorRaw === 'Financials');
  if (annualOpInc.length === 0 && _isFinancialSector) {
    const derived = _deriveOpIncForFinancials(isHist, annualRev, _opMargRaw);
    if (derived.values.length > 0 && derived.source) {
      annualOpInc = derived.values;
      opIncSource = derived.source;
    }
  }
  // Tag 202: annualRnD backfill from quoteSummary.incomeStatementHistory.
  // Bug #25 added FTS-based extraction, but Yahoo's FTS `financials` module
  // omits R&D for some tickers (ASML, V, MA, MSFT, NVDA, GOOG observed).
  // The legacy `incomeStatementHistory.researchDevelopment` field is still
  // populated for those names → use it as a primary source and let FTS
  // override below only when FTS has strictly more non-null entries.
  // Preserves positional alignment with annualRev (same isHist iteration).
  // Stored as raw numbers (latest-first) to match the FTS annualRnD shape.
  const annualRnDFromQS = (isHist || []).map(r => {
    const v = _y(r, 'researchDevelopment');
    return v != null ? v : null;
  });
  // P0-Fix Tag 13: capex-fallback `|| 0` ist gefährlich.
  // NVDA hat real $35B Capex/Jahr — wegfallen lassen verfälscht FCF um Milliarden.
  // Wenn capex unknown, FCF=null statt overstated.
  const annualFCF = (cfHist || []).map(r => {
    const op = _y(r, 'totalCashFromOperatingActivities');
    const capex = _y(r, 'capitalExpenditures');
    if (op == null || capex == null) return null;
    return { value: op + capex };  // Yahoo capex ist negativ → echte Subtraktion
  }).filter(Boolean);
  // Bug #23: annualOCF never written to snapshot — premium-compounder-proof check #6
  // ((Capex+R&D)/OCF) was always computable:false. Extract OCF directly from cfHist.
  const annualOCF = (cfHist || []).map(r => {
    const op = _y(r, 'totalCashFromOperatingActivities');
    return op != null ? { value: op } : null;
  }).filter(Boolean);
  // P0-Fix Tag 13: 0+0 wenn beide undefined ist semantisch falsch — Engine sieht Debt=0 statt null.
  // Plus: Yahoo-Field-Name-Drift seit Nov 2024 — multi-fallback für cash.
  const annualBalance = (bsHist || []).map(r => {
    const cash = _y(r, 'cash')
              ?? _y(r, 'cashAndCashEquivalents')
              ?? _y(r, 'cashAndShortTermInvestments');
    const std = _y(r, 'shortLongTermDebt');
    const ltd = _y(r, 'longTermDebt');
    const totalDebt = (std == null && ltd == null) ? null : (std || 0) + (ltd || 0);
    const _debtPartial = totalDebt != null && (std == null || ltd == null); // F-DQ-001
    const totalAssets = _y(r, 'totalAssets');
    if (cash == null && totalDebt == null && totalAssets == null) return null;
    return { totalCash: cash, totalDebt, totalAssets, ...(_debtPartial ? { _debtPartial: true } : {}) };
  }).filter(Boolean);

  // Quartalsweise Timeseries (latest first → wir flippen NICHT, Engine erwartet latest=index 0)
  const revenueQ = _arr(isHistQ, 'totalRevenue');
  const opIncQ = _arr(isHistQ, 'operatingIncome');
  const grossProfitQ = _arr(isHistQ, 'grossProfit');

  // FCF-Margin TTM
  // Tag 206b (Bug-Hunt Agent B HIGH-4): Yahoo's fcfMarginTTM is sometimes
  // mathematically implausible — values >200% are virtually always a one-time
  // event (asset sale, divestiture, tax-refund, REIT fair-value movement, M&A
  // working-capital flush). Examples observed: GPT.AX 598%, ASX.AX 275%,
  // 600816.SS 280%. Propagating these inflates R40, pbScore, score-aggregator
  // ratios — every downstream consumer is poisoned.
  //
  // Pattern-based bound: |fcfMargin| > 200% is the smoking gun. Real anchors
  // top out around 50% (MSFT 30, NVDA 27, MA 50, GOOG 25, V 50). Even
  // CRDO/NVDA at extreme growth never exceed 50%. The 200% threshold leaves
  // a very wide margin of safety while catching the obvious artifacts.
  //
  // When fcfMargin exceeds the bound, we null it (forcing downstream methods
  // to use annual.annualFCF / annual.annualRev[0] as the fallback path —
  // which is what rule-of-40.js Tag 201c already does). The validation array
  // gets a structured warning so the audit pipeline can flag affected tickers.
  const fcfTTM = _y(fd, 'freeCashflow');
  const revTTM = _y(fd, 'totalRevenue');
  let fcfMarginTTM = (fcfTTM != null && revTTM && revTTM !== 0) ? (fcfTTM / revTTM) * 100 : null;
  let fcfMarginTTMSuppressed = false;
  if (fcfMarginTTM != null && Math.abs(fcfMarginTTM) > 200) {
    fcfMarginTTMSuppressed = true;
    fcfMarginTTM = null;
  }

  // SBC-Ratio: nicht in Default-Modules — TODO Tag-14: separater financials-Module-Pull
  const sbcRatio = null;

  // Tag 137: Insider transaction activity (last 90 days, open-market buys)
  const insiderActivity = (function() {
    const it = yahoo.insiderTransactions;
    const txns = it && it.transactions;
    if (!txns || !Array.isArray(txns) || txns.length === 0) return null;
    const cutoffMs = Date.now() - 90 * 86400 * 1000;
    let buyCount = 0, sellCount = 0, netShares = 0, lastBuyDate = null;
    // F-DP-053 (Tag 190): normalize startDate via dedicated helper + sanity range.
    // Yahoo has historically passed insider startDate as either seconds, ms, or
    // a parsed Date instance. yahoo-finance2 sometimes converts (depending on
    // schema declaration). A silent unit flip (s vs ms) would shift every
    // timestamp by 1000× — epoch-zero or year-50000 — and the 90d cutoff would
    // silently drop or include the wrong set, flipping the cluster signal.
    // Reject anything outside [2000-01-01, now+1d]; treat as missing.
    const MIN_VALID_MS = Date.UTC(2000, 0, 1);
    const MAX_VALID_MS = Date.now() + 86400 * 1000;
    function _normTxTs(raw) {
      if (raw == null) return null;
      let ms;
      if (raw instanceof Date) ms = raw.getTime();
      else if (typeof raw === 'number') {
        // Heuristic: <1e12 is seconds (1970..~5138 in s), >=1e12 is ms.
        ms = raw < 1e12 ? raw * 1000 : raw;
      } else {
        const parsed = new Date(raw).getTime();
        ms = isNaN(parsed) ? null : parsed;
      }
      if (ms == null || !Number.isFinite(ms)) return null;
      if (ms < MIN_VALID_MS || ms > MAX_VALID_MS) return null;
      return ms;
    }
    // F-DP-038 (Tag 182): "cluster" buys should count UNIQUE insider filers, not
    // total transactions. A single insider buying in 5 separate transactions is
    // momentum-noise, not a cluster signal. Previously clusterBuys90d ≡ buyCount90d
    // which made the "cluster" name misleading. Now: dedupe by filer name.
    const uniqueBuyFilers = new Set();
    for (const tx of txns) {
      const ts = _normTxTs(tx.startDate);
      if (!ts || ts < cutoffMs) continue;
      const text = String(tx.transactionText || '').toLowerCase();
      const shares = (tx.shares && typeof tx.shares === 'object') ? tx.shares.raw : (tx.shares || 0);
      const filer = String(tx.filerName || tx.filerRelation || '').trim();
      // Open-market purchase: text contains "purchase" but NOT "automatic", "grant", "option", "award"
      const isOpenBuy = /purchase/i.test(text) && !/automatic|option|grant|award|vest|exercise/i.test(text);
      const isOpenSell = /sale|sell/i.test(text) && !/automatic/i.test(text);
      if (isOpenBuy) {
        buyCount++;
        netShares += (shares || 0);
        if (filer) uniqueBuyFilers.add(filer);
        const d = new Date(ts).toISOString().slice(0, 10);
        if (!lastBuyDate || d > lastBuyDate) lastBuyDate = d;
      } else if (isOpenSell) {
        sellCount++;
        netShares -= Math.abs(shares || 0);
      }
    }
    return {
      clusterBuys90d: uniqueBuyFilers.size,    // unique filers (cluster signal)
      buyCount90d: buyCount,                    // total open-market buy transactions
      sellCount90d: sellCount,
      netShares90d: netShares,
      lastBuyDate
    };
  })();

  // Tag 204 (Bug #1): ADR-class fix — prefer price.financialCurrency over price.currency
  // when both are present and differ. Yahoo's `price.currency` is the trading-quote ccy
  // (TSM=USD, BABA=USD, 9988.HK=HKD) but financials are reported in the local ccy
  // (TWD, CNY, CNY respectively). Before Tag 204, reportingCurrency was set from
  // `price.currency` → _convertSnapshotToUSD early-returned for ADRs because origCcy
  // matched 'USD', leaving annual.* in trillions of local ccy and corrupting
  // fcf-yield / ev-ebitda / p/s by ~30× for the affected names.
  //
  // Tag 219 (audit F-219c-1 CRITICAL fix): Yahoo's `price` module no longer
  // returns `financialCurrency` (live verified 2026-05-17 on TSM/BABA/9988.HK
  // — all return undefined). Tag 204's intent was to read it from price.
  // The field MOVED to financialData.financialCurrency at some unknown date,
  // making Tag 204 silently dead. ADRs again get the wrong reporting ccy and
  // their financials are mis-FX'd by the ratio of trading-ccy to reporting-ccy.
  // Fix: fall back to financialData.financialCurrency.
  const _fc = _y(pr, 'financialCurrency') || _y(yahoo.financialData, 'financialCurrency');
  const _tc = _y(pr, 'currency');
  const rcOriginal = (_fc && _fc !== _tc) ? _fc : (_tc || 'USD');
  const tradingCurrency = _tc || rcOriginal; // NEW: trading-quote ccy for downstream visibility
  // Tag 206f (Bug-Hunt Agent D HIGH C2): if Yahoo returns null financialCurrency,
  // we fall back to trading-currency — which is correct for native listings
  // (USD/USD) but WRONG for OTC pink-sheets where annual.* may be in a third
  // currency. Flag this case so the audit pipeline can surface affected tickers.
  // We can't detect the actual financialCurrency without external data, but we
  // CAN flag the uncertainty.
  const _ccyAmbiguous = (_fc == null && _tc != null);
  const exchangeName = _y(pr, 'exchangeName') || '';
  return {
    identifier: { primary: 'ISIN', value: watchlistEntry.isin || `TICKER:${watchlistEntry.ticker}` },
    meta: {
      ticker: watchlistEntry.ticker,
      name: _y(pr, 'longName') || watchlistEntry.name || watchlistEntry.ticker,
      sector: _y(ap, 'sector') || null,
      industry: _y(ap, 'industry') || null,
      region: normalizeRegion(rcOriginal, exchangeName),  // Tag 134: enum, not Yahoo string
      exchangeName: exchangeName || null,                  // Tag 134: preserved for diagnostics
      reportingCurrency: rcOriginal,                       // overwritten to 'USD' by _convertSnapshotToUSD
      tradingCurrency,                                     // Tag 204: trading-quote ccy (may differ from reporting for ADRs)
      fetchedAt: asOf,
      // Tag 215j: also write `asOf` for the F-CI-016 Verify Snapshot Freshness
      // gate. The gate scans for the `"asOf"` JSON key but pull-yahoo had only
      // ever set `fetchedAt`. Result: every full-pull snapshot was counted as
      // "unparseable" by the freshness gate. Run #107 showed the gate firing
      // a WARN ('continue-on-error: true' so non-blocking) but the underlying
      // bug needed fixing — without asOf the gate could never validate freshness
      // correctly. Same timestamp as fetchedAt so the two are synonyms post-fix;
      // existing consumers that read fetchedAt continue to work.
      asOf,
      filingDate: null,  // Yahoo liefert kein Filing-Datum für TTM
      firstTradeDate: null,  // wird unten aus yf.quote() gesetzt (Tag 106)
      ipoYear: null,
      // Tag 203: provenance for annualOpInc. 'native' = Yahoo isHist/FTS,
      // 'computed-bank' / 'computed-insurance' = per-year line-item derivation,
      // 'computed-margin' = annualRev × operatingMargin TTM (universal fallback
      // for Financial Services when line-items absent). null = no OpInc at all.
      opIncSource,
      // Tag 206b: fcfMarginTTM was suppressed because |raw value| > 200%.
      // Downstream methods (rule-of-40 etc.) will use the annual-FCF fallback
      // path or report computable:false. Flag preserved so audit pipeline can
      // surface affected tickers without re-deriving the bound.
      fcfMarginTTMSuppressed,
      // Tag 206f: Yahoo returned no financialCurrency — we used trading
      // currency as a best-effort proxy. Audit flag for OTC/pink-sheet edge.
      ccyAmbiguous: _ccyAmbiguous,
      // Tag 219 (audit F5 HIGH): Yahoo ships shares fields in
      // defaultKeyStatistics; the MODULES header lists "sharesOutstanding"
      // but the mapper never extracted it. buyback-yield.js docstring
      // lists meta.sharesOutstanding as a fallback that was never wired.
      sharesOutstanding:        _y(ks, 'sharesOutstanding'),
      floatShares:              _y(ks, 'floatShares'),
      impliedSharesOutstanding: _y(ks, 'impliedSharesOutstanding'),
      // Tag 220c (audit F-219c-F6 MEDIUM): majorHoldersBreakdown — institutional
      // ownership data, free fallback for institutional-ownership-13f.js when the
      // SEC 13F by-ticker cache is missing or hasn't been refreshed yet.
      // Priority: SEC 13F cache (curated CIK list, smart-money concentrated) →
      // Yahoo aggregate (broad-based, ~7k institutions, Form 13F-aggregated).
      institutionsPercentHeld:  _y(yahoo.majorHoldersBreakdown, 'institutionsPercentHeld'),
      institutionsCount:        _y(yahoo.majorHoldersBreakdown, 'institutionsCount'),
      insidersPercentHeld:      _y(yahoo.majorHoldersBreakdown, 'insidersPercentHeld'),
      // Tag 220c (audit F-219c-F9 LOW): mostRecentQuarter is the actual fiscal
      // quarter-end date, a more reliable dataAsOf source than fetchedAt (which
      // reflects API CALL time, not data time). Additive only — _dataAsOfFromStock
      // continues to prefer meta.fetchedAt for now; methods may opt in.
      mostRecentQuarter:        (function() {
        const v = _y(ks, 'mostRecentQuarter');
        if (v == null) return null;
        if (v instanceof Date) return v.toISOString();
        try { return new Date(v).toISOString(); } catch (_) { return null; }
      })(),
      // Tag 220c (audit F-219c-F11 LOW): assetProfile fields. Skip
      // longBusinessSummary — at 200-1000 chars × ~19k stocks it would bloat
      // snapshots by 4-20MB on disk; UI tooltip can re-fetch on demand.
      country:                  _y(ap, 'country'),
      fullTimeEmployees:        _y(ap, 'fullTimeEmployees')
    },
    // Tag 134: marketCap stored in reportingCurrency at mapper level;
    // _convertSnapshotToUSD applies FX conversion uniformly across all currency-denominated fields.
    marketCap: _metric(_y(sd, 'marketCap'), SRC, CONF, asOf),
    metrics: {
      revenueTTM:       _metric(revTTM, SRC, CONF, asOf),
      revenueGrowthYoY: _metric(revGrowthYoY, SRC, CONF, asOf),
      grossMargin:      _metric(_y(fd, 'grossMargins') != null ? _y(fd, 'grossMargins') * 100 : null, SRC, CONF, asOf),
      operatingMargin:  _metric(_y(fd, 'operatingMargins') != null ? _y(fd, 'operatingMargins') * 100 : null, SRC, CONF, asOf),
      fcfMarginTTM:     _metric(fcfMarginTTM, SRC, CONF, asOf),
      sbcRatio:         _metric(sbcRatio, SRC, 0.5, asOf),
      insidersOwnership: _metric(_y(ks, 'heldPercentInsiders'), SRC, 0.7, asOf),  // Tag-56
      cashRunway:       null,
      priceSales:       _metric(_y(sd, 'priceToSalesTrailing12Months'), SRC, CONF, asOf),
      forwardPE:        _metric(_y(sd, 'forwardPE'), SRC, CONF, asOf),
      pe:               _metric(_y(sd, 'trailingPE'), SRC, CONF, asOf),
      // Tag 219 (audit F2/F3 HIGH): Yahoo provides true EBITDA + Enterprise
      // Value pre-computed; ev-ebitda.js currently uses opInc*1.2 heuristic
      // and reconstructs EV from mcap+totalDebt-totalCash. Native fields are
      // more accurate (Yahoo's EV includes minority interest + preferred).
      ebitda:              _metric(_y(fd, 'ebitda'), SRC, CONF, asOf),
      ebitdaMargins:       _metric(_y(fd, 'ebitdaMargins') != null ? _y(fd, 'ebitdaMargins') * 100 : null, SRC, CONF, asOf),
      enterpriseValue:     _metric(_y(ks, 'enterpriseValue'),    SRC, CONF, asOf),
      enterpriseToEbitda:  _metric(_y(ks, 'enterpriseToEbitda'), SRC, CONF, asOf),
      enterpriseToRevenue: _metric(_y(ks, 'enterpriseToRevenue'),SRC, CONF, asOf),
      beta:                _metric(_y(ks, 'beta'),               SRC, 0.8,  asOf),
      // Tag 220c (audit F-219c-F8 MEDIUM): financialData ratios — all already
      // pulled in the financialData module; only the extraction was missing.
      // None are currency-denominated (ratios + counts + analyst price targets),
      // so no FX implication. SRC tag identifies provenance distinctly from
      // the SRC = 'yahoo_quoteSummary' above to aid downstream filtering.
      debtToEquity:         _metric(_y(fd, 'debtToEquity'),         'yahoo.financialData', 0.7, asOf),
      currentRatio:         _metric(_y(fd, 'currentRatio'),         'yahoo.financialData', 0.7, asOf),
      quickRatio:           _metric(_y(fd, 'quickRatio'),           'yahoo.financialData', 0.7, asOf),
      returnOnEquity:       _metric(_y(fd, 'returnOnEquity') != null ? _y(fd, 'returnOnEquity') * 100 : null,  'yahoo.financialData', 0.7, asOf),
      returnOnAssets:       _metric(_y(fd, 'returnOnAssets') != null ? _y(fd, 'returnOnAssets') * 100 : null,  'yahoo.financialData', 0.7, asOf),
      targetMeanPrice:      _metric(_y(fd, 'targetMeanPrice'),      'yahoo.financialData', 0.7, asOf),
      targetMedianPrice:    _metric(_y(fd, 'targetMedianPrice'),    'yahoo.financialData', 0.7, asOf),
      numberOfAnalystOpinions: _metric(_y(fd, 'numberOfAnalystOpinions'), 'yahoo.financialData', 0.7, asOf),
      recommendationMean:   _metric(_y(fd, 'recommendationMean'),   'yahoo.financialData', 0.7, asOf),
      recommendationKey:    _metric(_y(fd, 'recommendationKey'),    'yahoo.financialData', 0.7, asOf)
    },
    external: {
      // aktienfinderScore via Bookmarklet manuell synced
      // Tag 211h: estimateRevisions from yahoo.earningsTrend — activates
      // methods/analyst-revision-breadth.js (Tag 210d) which was returning
      // computable=false universally before this field was persisted. Keyed
      // by Yahoo period code ('0q','+1q','0y','+1y'); the method picks the
      // first period with non-null upLast30days/downLast30days.
      estimateRevisions: (function() {
        const et = yahoo.earningsTrend;
        const trend = et && Array.isArray(et.trend) ? et.trend : null;
        if (!trend || trend.length === 0) return null;
        const out = {};
        for (const t of trend) {
          if (!t || typeof t !== 'object') continue;
          const pk = t.period;
          if (!pk || typeof pk !== 'string') continue;
          const er = t.epsRevisions;
          if (!er || typeof er !== 'object') continue;
          // Yahoo varies casing ('upLast7days' vs 'upLast7Days'). Coalesce
          // both spellings so the consumer sees a single normalized shape.
          // Unwrap {value:n} envelopes if yahoo-finance2 returns wrapped.
          const _v = (x) => {
            if (x == null) return null;
            if (typeof x === 'number') return Number.isFinite(x) ? x : null;
            if (typeof x === 'object' && Number.isFinite(x.value)) return x.value;
            return null;
          };
          const pick = (a, b) => {
            const va = _v(er[a]); if (va != null) return va;
            return _v(er[b]);
          };
          const row = {
            upLast7Days:    pick('upLast7days',  'upLast7Days'),
            downLast7Days:  pick('downLast7days','downLast7Days'),
            upLast30Days:   pick('upLast30days', 'upLast30Days'),
            downLast30Days: pick('downLast30days','downLast30Days'),
            upLast60Days:   pick('upLast60days', 'upLast60Days'),
            downLast60Days: pick('downLast60days','downLast60Days'),
            upLast90Days:   pick('upLast90days', 'upLast90Days'),
            downLast90Days: pick('downLast90days','downLast90Days')
          };
          // Only emit periods that carry at least one non-null window —
          // saves bytes on snapshots when Yahoo returns empty epsRevisions.
          const hasData = Object.values(row).some(v => v != null);
          if (hasData) out[pk] = row;
        }
        return (Object.keys(out).length > 0) ? out : null;
      })(),
      // Tag 220c (audit F-219c-F7 MEDIUM): earningsHistory — last 4 quarters
      // with epsActual / epsEstimate / epsDifference / surprisePercent / quarter.
      // Persisted as data lake (no method consumes it yet); useful future input
      // for earnings-surprise momentum / PEAD diagnostic. Same pattern as
      // estimateRevisions above — only emit non-empty rows.
      earningsHistory: (function() {
        const eh = yahoo.earningsHistory;
        const hist = eh && Array.isArray(eh.history) ? eh.history : null;
        if (!hist || hist.length === 0) return null;
        const _v = (x) => {
          if (x == null) return null;
          if (typeof x === 'number') return Number.isFinite(x) ? x : null;
          if (typeof x === 'object' && Number.isFinite(x.value)) return x.value;
          if (typeof x === 'object' && Number.isFinite(x.raw)) return x.raw;
          return null;
        };
        const out = [];
        for (const q of hist) {
          if (!q || typeof q !== 'object') continue;
          const row = {
            quarter:         q.quarter ? (q.quarter instanceof Date ? q.quarter.toISOString() : String(q.quarter)) : null,
            period:          q.period || null,
            epsActual:       _v(q.epsActual),
            epsEstimate:     _v(q.epsEstimate),
            epsDifference:   _v(q.epsDifference),
            surprisePercent: _v(q.surprisePercent)
          };
          const hasData = row.epsActual != null || row.epsEstimate != null;
          if (hasData) out.push(row);
        }
        return out.length > 0 ? out : null;
      })()
    },
    timeseries: {
      revenueQ, opIncQ, grossProfitQ
    },
    annual: {
      annualRev, annualOpInc, annualNetIncome, annualGP, annualFCF, annualOCF, annualBalance,
      // Tag 202: quoteSummary-derived RnD (primary). FTS path may overwrite below
      // when FTS has strictly more non-null entries (see post-FTS merge in main pull).
      annualRnD: annualRnDFromQS
    },
    // Tag 137: insider buy/sell activity (90d window, open-market only)
    insiderActivity: insiderActivity || null
  };
}

// ─── Tag-14: fundamentalsTimeSeries-Pull (für annualOpInc/FCF/opIncQ) ───
// Yahoo's incomeStatementHistory Submodule liefern seit Nov 2024 fast nichts.
// fundamentalsTimeSeries ist die neue API mit annual + quarterly Income/CashFlow.

async function fetchFundamentalsTS(symbol) {
  // Period: 5y back, jetzt
  const period1 = new Date(Date.now() - 5 * 365 * 86400 * 1000);
  const period2 = new Date();
  const out = { annualFin: [], quarterlyFin: [], annualCash: [], annualBs: [] };
  // Defensive: jeder Aufruf eigener try/catch, Teilausfall darf nicht alles töten.
  try {
    out.annualFin = await yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'annual', module: 'financials' });
  } catch (e) { _log('WARN', `  fundamentalsTimeSeries annual financials failed for ${symbol}: ${e.message}`); }
  try {
    out.quarterlyFin = await yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'quarterly', module: 'financials' });
  } catch (e) { _log('WARN', `  fundamentalsTimeSeries quarterly financials failed for ${symbol}: ${e.message}`); }
  try {
    out.annualCash = await yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'annual', module: 'cash-flow' });
  } catch (e) { _log('WARN', `  fundamentalsTimeSeries annual cash-flow failed for ${symbol}: ${e.message}`); }
  // Tag-28: Balance-Sheet via fundamentalsTimeSeries (für ROIC/Sloan/Net-Debt-EBITDA).
  try {
    out.annualBs = await yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'annual', module: 'balance-sheet' });
  } catch (e) { _log('WARN', `  fundamentalsTimeSeries annual balance-sheet failed for ${symbol}: ${e.message}`); }
  return out;
}

function _ftsValue(row, ...keys) {
  // F-DP-041 (Tag 184): also try snake_case variants. Some Yahoo FTS edge nodes
  // emit `total_revenue` instead of `totalRevenue`, etc. — previously the entire
  // FTS payload read as null for those rows. Convert each requested key to its
  // snake_case equivalent and try as fallback.
  if (!row) return null;
  for (const k of keys) {
    if (row[k] != null) return row[k];
    // camelCase → snake_case fallback
    const snake = k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
    if (snake !== k && row[snake] != null) return row[snake];
  }
  return null;
}

// Mappt fundamentalsTimeSeries-Rows zu engine-Schema-Arrays (latest first).
// Bug #26 fix: preserve null entries for years where the field is absent so that
// annualSBC[i] and annualCapex[i] stay positionally aligned with annualRev[i].
// Previously, null-year rows were silently compacted, causing year-index drift.
function _ftsExtractByYear(rows, fieldNames) {
  const sorted = (rows || []).slice().reverse();  // oldest→latest, reverse → latest first
  const out = [];
  for (const r of sorted) {
    // Push null for empty/missing rows to preserve year-alignment
    const v = (r != null) ? _ftsValue(r, ...fieldNames) : null;
    out.push(v != null ? v : null);
  }
  return out;
}

function mapFTSToAnnual(annualRows, cashRows) {
  // Rows kommen oldest first → wir wollen latest first.
  // F-DP-030/031 (Tag 180): previously this skipped rows where rev==null
  // ("filtere wenn keine totalRevenue"), but _ftsExtractByYear preserves nulls
  // for annualSBC/Capex/RnD. The two conventions disagreed → annualRev[i] and
  // annualSBC[i] referenced DIFFERENT calendar years whenever a row had no rev.
  // Fix: push null placeholders here too so all annual arrays share positional
  // alignment with annualSBC/Capex/RnD. Downstream methods already null-check.
  // Trailing pure-null rows (no rev/oi/gp/ni at all) are trimmed to keep arrays
  // tight — preserved nulls only matter when surrounding data exists.
  const sorted = (annualRows || []).slice().reverse();
  const annualRev = [];
  const annualOpInc = [];
  const annualGP = [];
  const annualNetIncome = [];
  for (const r of sorted) {
    const rev = _ftsValue(r, 'totalRevenue', 'TotalRevenue');
    const oi = _ftsValue(r, 'operatingIncome', 'OperatingIncome', 'totalOperatingIncomeAsReported');
    const gp = _ftsValue(r, 'grossProfit', 'GrossProfit');
    const ni = _ftsValue(r, 'netIncome', 'NetIncome', 'netIncomeContinuousOperations');
    // Skip completely empty rows (no rev AND no derivative fields) — those add no info.
    if (rev == null && oi == null && gp == null && ni == null) continue;
    annualRev.push(rev != null ? { value: rev } : null);
    annualOpInc.push(oi != null ? { value: oi } : null);
    annualGP.push(gp != null ? { value: gp } : null);
    annualNetIncome.push(ni != null ? { value: ni } : null);
  }
  // FCF + OCF aus cash-flow-Module — same null-preservation convention.
  const annualFCF = [];
  const annualOCF = [];
  const cashSorted = (cashRows || []).slice().reverse();
  for (const r of cashSorted) {
    const op = _ftsValue(r, 'operatingCashFlow', 'OperatingCashFlow');
    let fcf = _ftsValue(r, 'freeCashFlow', 'FreeCashFlow');
    if (fcf == null) {
      const capex = _ftsValue(r, 'capitalExpenditure', 'CapitalExpenditure');
      if (op != null && capex != null) fcf = op + capex;  // capex ist negativ
    }
    if (op == null && fcf == null) continue;  // skip pure-empty
    annualOCF.push(op != null ? { value: op } : null);
    annualFCF.push(fcf != null ? { value: fcf } : null);
  }
  return { annualRev, annualOpInc, annualGP, annualNetIncome, annualFCF, annualOCF };
}

function mapFTSToBalance(bsRows) {
  // Tag-28: Pulled balance-sheet rows from fundamentalsTimeSeries → array of {totalCash, totalDebt, totalAssets}, latest first.
  // Tag 211l: Extended with accountsReceivable, netPPE, currentAssets,
  // currentLiabilities, totalLiabilities — unblocks beneish-m-score (Tag 209d)
  // and ohlson-o-score (Tag 210a) which were both returning computable=false
  // universally because these fields weren't persisted. Pattern matches the
  // existing extraction style: nullable, multi-key-fallback, skip row if
  // every field is null.
  const sorted = (bsRows || []).slice().reverse();
  const annualBalance = [];
  for (const r of sorted) {
    if (!r) continue;
    // Yahoo FTS field names: totalAssets, cashAndCashEquivalents, shortTermDebt, longTermDebt
    const cash = _ftsValue(r, 'cashAndCashEquivalents', 'cashCashEquivalentsAndShortTermInvestments', 'cashAndShortTermInvestments');
    const std = _ftsValue(r, 'currentDebt', 'shortLongTermDebt', 'shortTermDebt');
    const ltd = _ftsValue(r, 'longTermDebt');
    const totalDebt = (std == null && ltd == null) ? null : (std || 0) + (ltd || 0);
    const _debtPartial = totalDebt != null && (std == null || ltd == null); // F-DQ-001
    const totalAssets = _ftsValue(r, 'totalAssets');
    // Tag 211l extensions (Beneish/Ohlson inputs). All nullable.
    const accountsReceivable = _ftsValue(r, 'accountsReceivable', 'receivables');
    const netPPE = _ftsValue(r, 'netPPE', 'propertyPlantAndEquipmentNet', 'netTangibleAssets');
    const currentAssets = _ftsValue(r, 'currentAssets', 'totalCurrentAssets');
    const currentLiabilities = _ftsValue(r, 'currentLiabilities', 'totalCurrentLiabilities');
    const totalLiabilities = _ftsValue(r, 'totalLiabilitiesNetMinorityInterest', 'totalLiabilities');
    if (cash == null && totalDebt == null && totalAssets == null) continue;
    annualBalance.push({
      totalCash: cash,
      totalDebt,
      totalAssets,
      accountsReceivable,
      netPPE,
      currentAssets,
      currentLiabilities,
      totalLiabilities,
      ...(_debtPartial ? { _debtPartial: true } : {})
    });
  }
  return annualBalance;
}

function mapFTSToQuarterly(quarterlyRows) {
  const sorted = (quarterlyRows || []).slice().reverse();
  const revenueQ = [];
  const opIncQ = [];
  const grossProfitQ = [];
  for (const r of sorted) {
    const rev = _ftsValue(r, 'totalRevenue', 'TotalRevenue');
    if (rev == null) continue;
    revenueQ.push({ value: rev });
    const oi = _ftsValue(r, 'operatingIncome', 'OperatingIncome');
    opIncQ.push(oi != null ? { value: oi } : null);
    const gp = _ftsValue(r, 'grossProfit', 'GrossProfit');
    grossProfitQ.push(gp != null ? { value: gp } : null);
  }
  return { revenueQ, opIncQ, grossProfitQ };
}

// ─── Main Pull ─────────────────────────────────────────────────────

async function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Tag 145: per-ticker timeout wrapper — prevents one hanging socket from
// freezing the entire batch. Yahoo occasionally stalls indefinitely on rate-limit
// or network issues; without this a single stuck ticker blocks all concurrent slots.
function _withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`ETIMEDOUT after ${ms}ms (${label})`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Tag 164: sort by staleness — oldest snapshots pulled first so timeouts
// always refresh the most-stale data. Guarantees full universe coverage over ~3 days.
// Reads only the first 300 bytes of each snapshot to extract meta.asOf without
// parsing the full JSON — keeps overhead low even for 12k-file universes.
//
// Tag 218 (audit F-217a-08 perf fix): precompute ages ONCE into a Map before
// sorting. Previous implementation called getAge() inside the sort comparator,
// which invoked the (3-syscall) staleness probe O(N log N) times — that's
// ~340k sync file opens for a 15k-stock universe and the same ticker's age
// was recomputed dozens of times. Now: one O(N) precompute pass, then sort
// reads from the cached Map in O(1).
//
// Also accept BOTH meta.asOf and meta.fetchedAt — pre-Tag-215j snapshots
// only had fetchedAt; post-Tag-215j have both. Without this dual-read,
// old snapshots looked timestamp-0 and would be pulled first wastefully.
function sortByStaleness(stocks, outputDir) {
  const ageCache = new Map();
  const ageRegex = /"(?:asOf|fetchedAt)"\s*:\s*"([^"]+)"/;
  for (const stock of stocks) {
    const ticker = stock.ticker;
    if (ageCache.has(ticker)) continue;
    let age = 0;
    try {
      const fp = path.join(outputDir, safeSnapshotFilename(ticker));
      if (fs.existsSync(fp)) {
        const buf = Buffer.alloc(300);
        const fd = fs.openSync(fp, 'r');
        fs.readSync(fd, buf, 0, 300, 0);
        fs.closeSync(fd);
        const m = buf.toString('utf8').match(ageRegex);
        if (m) {
          const t = new Date(m[1]).getTime();
          if (Number.isFinite(t)) age = t;
        }
      }
    } catch {}
    ageCache.set(ticker, age);
  }
  return stocks.slice().sort((a, b) =>
    (ageCache.get(a.ticker) || 0) - (ageCache.get(b.ticker) || 0)
  );
}

async function pullAll(watchlist, outputDir, rateLimitMs) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const results = [];
  const failures = [];
  // Tag-80: Parallel pulls in batches of CONCURRENCY
  const CONCURRENCY = parseInt(process.env.PULL_CONCURRENCY || '10', 10);
  _log('INFO', `Parallel pulls: ${CONCURRENCY} concurrent. Total: ${watchlist.stocks.length} stocks.`);
  // Tag 164: sort by staleness — oldest snapshots pulled first so timeouts
  // always refresh the most-stale data. Guarantees full universe coverage over ~3 days.
  watchlist.stocks = sortByStaleness(watchlist.stocks, outputDir);
  _log('INFO', `Sorted ${watchlist.stocks.length} stocks by staleness (oldest first)`);
  // Tag 154: exponential-backoff retry for rate-limit errors.
  // Yahoo 429s are transient — one retry after 10–30s usually succeeds.
  // Max 3 attempts: initial + 2 retries with 10s / 25s sleep.
  // Tag 163: reduced timeouts (30s→12s) and delays (10s/25s→5s/12s) to unblock
  // the worker pool faster — stalled tickers no longer hold up other workers.
  //
  // Tag 215f: extended retry budget to 15s/45s/90s (4 attempts total).
  // Run #107 produced 7,210 rate-limit failures even with retry — Yahoo's
  // Cloudflare Edge throttle needs LONGER backoff than Tag 163's 5s/12s
  // (CDN Retry-After is typically 30-60s). Combined with PULL_CONCURRENCY 8
  // (down from 20) this should drop the rate-limit fail rate dramatically.
  async function quoteSummaryWithRetry(symbol, label) {
    const DELAYS = [15000, 45000, 90000];
    let lastErr;
    for (let attempt = 0; attempt <= DELAYS.length; attempt++) {
      try {
        return await _withTimeout(yf.quoteSummary(symbol, { modules: MODULES }), 12000, label);
      } catch (e) {
        lastErr = e;
        const msg = String(e.message || '');
        const isRateLimit = /429|too many request|rate.?limit/i.test(msg);
        // F-DP-048 (Tag 182): previously only `timeout` literal matched. yahoo-finance2
        // raises TimeoutError with message "Operation timed out" — the regex missed
        // it and the request was not retried. Match name + common variants.
        const isTimeout =
          (e.name === 'TimeoutError') ||
          (e.constructor && /timeout/i.test(e.constructor.name || '')) ||
          /timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN/i.test(msg);
        if ((isRateLimit || isTimeout) && attempt < DELAYS.length) {
          const delay = DELAYS[attempt];
          _log('WARN', `  ${label} rate-limited (attempt ${attempt + 1}) — retrying in ${delay / 1000}s`);
          await _sleep(delay);
        } else {
          throw e;
        }
      }
    }
    throw lastErr;
  }

  // Tag 155: incremental manifest write — flushes _manifest.json after every ~100 tickers
  // so a mid-run SIGKILL (GitHub Actions 165-min step timeout) leaves an accurate manifest
  // on disk reflecting snapshots actually written. Without this the downstream Verify Pull
  // Coverage gate sees n_ok=0/n_total=0 even though hundreds of snapshot files exist.
  // F-DP-012: boolean mutex prevents concurrent workers from racing this write.
  let _manifestWriting = false;
  let _manifestPending = false;
  // F-DP-039 (Tag 182): previously a concurrent call while mutex was set
  // returned silently, losing the second flush. Boundary writes (every 100
  // tickers) could be missed entirely. Now: if mutex set, mark pending and
  // re-trigger a single follow-up write when the current one finishes.
  function writeManifestIncremental() {
    if (_manifestWriting) { _manifestPending = true; return; }
    _manifestWriting = true;
    try {
      // F-DP-047 (Tag 192): n_ok previously equaled results.length, but results
      // includes 'skipped-mcap' entries where the snapshot was explicitly
      // deleted (line ~1036). That inflated n_ok and let Verify Pull Coverage
      // pass when actual on-disk snapshot count was much lower. Now: count
      // only entries whose status reflects a real snapshot write.
      const okResults = results.filter(r =>
        r && (r.status === 'ok' || r.status === 'price-only'));
      const skippedMcap = results.length - okResults.length;
      const slim = {
        pulled_at: new Date().toISOString(),
        watchlist_version: watchlist._meta && watchlist._meta.version,
        n_total: watchlist.stocks.length,
        n_ok: okResults.length,
        n_skipped_mcap: skippedMcap,
        n_failed: failures.length,
        partial: true
      };
      const mPath = path.join(outputDir, '_manifest.json');
      writeFileAtomic(mPath, JSON.stringify(slim));
    } catch (e) {
      _log('WARN', `Incremental manifest write failed: ${e.message}`);
    } finally {
      _manifestWriting = false;
      if (_manifestPending) {
        _manifestPending = false;
        // Don't recurse synchronously — defer one tick so we don't burn CPU on a tight ticker loop.
        setImmediate(writeManifestIncremental);
      }
    }
  }

  // Tag 166: read existing snapshot's asOf to decide price-only vs full pull
  function _getExistingSnapshotAge(ticker) {
    try {
      const fp = path.join(outputDir, safeSnapshotFilename(ticker));
      if (!fs.existsSync(fp)) return null;
      const buf = Buffer.alloc(500);
      const fd = fs.openSync(fp, 'r');
      fs.readSync(fd, buf, 0, 500, 0);
      fs.closeSync(fd);
      const m = buf.toString('utf8').match(/"asOf"\s*:\s*"([^"]+)"/);
      if (!m) return null;
      const age = Date.now() - new Date(m[1]).getTime();
      return age;
    } catch { return null; }
  }

  // Tag 226a-2: detect snapshots that pre-date Tag 211l (annualSGA /
  // annualDepreciation / currentAssets / currentLiabilities / totalLiabilities)
  // or Tag 219 (annualShares). The price-only fast-path keeps a snapshot
  // young (<7d) indefinitely by refreshing meta.asOf without touching the
  // annual.* block — so a stock pulled before these tags would NEVER pick
  // them up unless we force a full pull on schema detection.
  //
  // Cost: one ~50KB JSON.parse per ticker (only on the snapshots that pass
  // the age gate, so ~3500 reads). Probe Tag 225d showed 0/100 random
  // snapshots had Tag 211l fields → roughly 98% of the universe will trip
  // this once, then settle into normal price-only cadence on subsequent runs.
  //
  // Constraint: must NOT bump FTS_CACHE_VERSION (per pull-yahoo invariants
  // — many fundamentals caches are <28d old and rebuilding them all would
  // multiply this run's Yahoo load). Instead: snapshot-level schema gate
  // here forces the full-pull code path, which then sees the stale FTS
  // cache lacks ftsAnnualSGA and falls through to a fresh FTS fetch via
  // the existing `cached._cacheVersion !== FTS_CACHE_VERSION` branch (the
  // cache file's _cacheVersion is `undefined` for pre-Tag-211l caches, so
  // that branch already handles the FTS-cache side correctly).
  function _existingSnapshotMissingTag211lFields(ticker) {
    try {
      const fp = path.join(outputDir, safeSnapshotFilename(ticker));
      if (!fs.existsSync(fp)) return false;
      const raw = fs.readFileSync(fp, 'utf8');
      const s = JSON.parse(raw);
      const A = s && s.annual;
      if (!A) return false;
      // If the snapshot has no annualRev at all, it's a price-only seed
      // (no fundamentals yet). Don't force full-pull just to add Tag 211l
      // fields — the full-pull path will eventually run via normal age
      // expiry. We only care about snapshots that DO have annual data but
      // are missing the newer fields.
      const hasRev = Array.isArray(A.annualRev) && A.annualRev.length > 0;
      if (!hasRev) return false;
      // Tag 211l fields: annualSGA, annualDepreciation, and the extended
      // balance-sheet rows (currentAssets/currentLiabilities/totalLiabilities).
      const hasSGA = Array.isArray(A.annualSGA) && A.annualSGA.length > 0;
      const hasDepr = Array.isArray(A.annualDepreciation) && A.annualDepreciation.length > 0;
      const bal = A.annualBalance;
      const hasCA = Array.isArray(bal) && bal[0] && Number.isFinite(bal[0].currentAssets);
      // A snapshot is "stale-schema" if it lacks EITHER SGA/Depr OR the
      // extended balance fields. We use AND on the balance row + OR with
      // the income/cash items to avoid false-positives on companies that
      // legitimately have null SGA (some financial filers) but DO have
      // current-asset data persisted.
      return !(hasSGA || hasDepr) || !hasCA;
    } catch { return false; }
  }

  // Tag 166: lightweight price-only update — preserves fundamentals from previous snapshot
  async function _priceOnlyUpdate(stock, outputDir) {
    const fp = path.join(outputDir, safeSnapshotFilename(stock.ticker));
    if (!fs.existsSync(fp)) throw new Error('no existing snapshot to update');
    const existing = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const q = await _withTimeout(yf.quote(stock.yahoo_symbol), 8000, stock.ticker + '/quote-only');
    if (!q) throw new Error('quote returned null');
    // Update only fields that change daily
    const newAsOf = new Date().toISOString();
    if (existing.meta) existing.meta.asOf = newAsOf;
    // F-DP-007: if the snapshot was previously normalized to USD, re-apply the same FX factor
    // so price/mcap stay in USD (Yahoo quote() returns values in local currency).
    // F-DQ-002 (Tag 179): previous fxApplied=(meta.fxRateApplied||1) collapses null to 1,
    // making a non-USD original look FX-needless if the field is ever missing. Now:
    // refuse price-only update when original is non-USD but fxRateApplied is missing —
    // forces a full pull which will re-derive the FX rate correctly.
    const origCcy = existing.meta && existing.meta.reportingCurrencyOriginal;
    const fxAppliedRaw = existing.meta && existing.meta.fxRateApplied;
    if (origCcy && origCcy !== 'USD' && (fxAppliedRaw == null || !Number.isFinite(fxAppliedRaw))) {
      throw new Error('price-only refused: non-USD original (' + origCcy + ') with no fxRateApplied — full pull needed');
    }
    const fxApplied = Number.isFinite(fxAppliedRaw) ? fxAppliedRaw : 1;
    const needsFx = fxApplied !== 1 && !(existing.meta && existing.meta.reportingCurrencyOriginal === 'USD');
    if (q.regularMarketPrice != null) {
      existing.price = existing.price || {};
      existing.price.regularMarketPrice = needsFx ? q.regularMarketPrice * fxApplied : q.regularMarketPrice;
      // F-DP-040 (Tag 182): previously this overwrote existing.price.currency with
      // Yahoo's live value, flipping GBp ↔ GBP and breaking the invariant against
      // meta.reportingCurrencyOriginal. The snapshot's reporting currency is set
      // at full-pull time and must remain stable; only update if the existing
      // field is missing.
      if (existing.price.currency == null) existing.price.currency = q.currency;
    }
    if (q.marketCap != null) {
      existing.marketCap = existing.marketCap || {};
      existing.marketCap.value = needsFx ? q.marketCap * fxApplied : q.marketCap;
    }
    // F-DQ-009 (Tag 183): price-only path previously skipped the MIN_MCAP floor —
    // a stock that drifted below $1B post-last-full-pull stayed in the universe
    // (survivor bias on the small-cap side). Re-check the floor here; if violated,
    // delete the snapshot and report skipped-mcap-by-priceonly.
    const MIN_MCAP = 1e9;
    const mcapNow = existing.marketCap && existing.marketCap.value;
    if (mcapNow != null && mcapNow < MIN_MCAP) {
      try { fs.unlinkSync(fp); } catch (_) {}
      throw new Error('price-only floor: mcap=' + (mcapNow/1e9).toFixed(2) + 'B < $' + (MIN_MCAP/1e9).toFixed(0) + 'B — snapshot removed');
    }
    // Mark mode for downstream visibility
    existing._pullMode = 'price-only';
    existing._pullModeAt = newAsOf;
    // F-DQ-009 / F-DP-036 (Tag 182): mark quality grade as stale after price-only
    // update so downstream knows it was not re-evaluated. Also clear stale
    // nanRatio + missingFields — those reflected the LAST full pull and would
    // appear "fresh" if a method consults them later.
    if (existing._quality) {
      existing._quality.grade = null;
      existing._quality.nanRatio = null;
      existing._quality.missingFields = null;
      existing._quality.staleSincePriceOnly = newAsOf;
    }
    // F-DP-032 (Tag 179) → factored into lib/atomic-write.js in Tag 189.
    // ~80% of daily pulls go through this fast-path; atomic write protects
    // against SIGTERM corruption on CI cancellation.
    writeFileAtomic(fp, JSON.stringify(existing, null, 2));
    return { ticker: stock.ticker, status: 'price-only', mcap: q.marketCap, price: q.regularMarketPrice };
  }

  async function processOne(stock) {

    try {
      // Tag 166: price-only fast-path if recent snapshot exists
      // Tag 226a-2: but ONLY if the snapshot already carries the Tag 211l
      // schema (annualSGA / annualDepreciation / extended balance fields).
      // Pre-Tag-211l snapshots that pass the 7-day age gate would otherwise
      // be price-only-refreshed forever, keeping methods/sga-revenue-trend,
      // working-capital-trend, and ohlson-o-score at <2% coverage indefinitely.
      const age = _getExistingSnapshotAge(stock.ticker);
      const staleSchema = (age != null && age < FUNDAMENTALS_MAX_AGE_MS)
        ? _existingSnapshotMissingTag211lFields(stock.ticker)
        : false;
      if (age != null && age < FUNDAMENTALS_MAX_AGE_MS && !staleSchema) {
        try {
          const r = await _priceOnlyUpdate(stock, outputDir);
          results.push(r);
          _log('INFO', `  ✓ ${stock.ticker} [price-only]: mcap=${r.mcap}, price=${r.price}`);
          return;
        } catch (e) {
          _log('WARN', `  price-only failed for ${stock.ticker}, falling through to full pull: ${e.message}`);
          // fall through to full pull below
        }
      } else if (staleSchema) {
        _log('INFO', `  ${stock.ticker} [schema-stale]: forcing full pull to backfill Tag 211l fields`);
      }

      _log('INFO', `Pulling ${stock.ticker} (${stock.yahoo_symbol})…`);
      const yahoo = await quoteSummaryWithRetry(stock.yahoo_symbol, stock.ticker);
      const asOf = new Date().toISOString();
      const canonical = mapYahooToCanonical(yahoo, stock, asOf);

      // Tag 106: IPO-Datum via separates yf.quote() — quoteSummary.price hat das Feld nicht.
      try {
        const q = await _withTimeout(yf.quote(stock.yahoo_symbol), 8000, stock.ticker + '/quote'); // Tag 163: 15s→8s
        if (q && q.firstTradeDateMilliseconds) {
          const ftd = new Date(q.firstTradeDateMilliseconds);
          canonical.meta.firstTradeDate = ftd.toISOString();
          canonical.meta.ipoYear = ftd.getUTCFullYear();
        }
      } catch (e) { console.warn('IPO-DATE-FETCH:', stock.ticker, e.message); }

      // Tag-85: Smart-Cache — skip FTS-Pull wenn cache <28 Tage alt
      // F-DP-025: { recursive: true } makes mkdirSync idempotent
      const cacheDir = path.join(__dirname, 'fundamentals-cache');
      fs.mkdirSync(cacheDir, { recursive: true });
      const cachePath = path.join(cacheDir, safeSnapshotFilename(stock.ticker));
      const CACHE_TTL_MS = 28 * 86400 * 1000;
      const CACHE_PARTIAL_TTL_MS = 86400 * 1000; // F-DP-005: 24h for partial results
      const FTS_CACHE_VERSION = 2; // F-DP-019: bump when FTS schema changes (v2: null-alignment fix, added annualRnD)
      let useCache = false;
      let cached = null;
      if (fs.existsSync(cachePath)) {
        try {
          cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
          // F-DP-019: reject cache if version key is missing or differs.
          // Tag 222b (audit Tag 221a C4 followup): the write site at line ~1405
          // does stamp _cacheVersion correctly (verified via NVDA.json which
          // carries _cacheVersion=2), but the bulk of legacy cache files were
          // written before this stamp existed. They're correctly invalidated
          // here, then re-fetched. Counter below makes the invalidation
          // visible in the run summary — previously silent. Process-scope
          // (var on module global) so we count across the whole pull.
          if (cached._cacheVersion !== FTS_CACHE_VERSION) {
            if (typeof global.__ftsCacheInvalidations === 'undefined') global.__ftsCacheInvalidations = 0;
            global.__ftsCacheInvalidations++;
            cached = null;
          } else {
            const age = Date.now() - new Date(cached.cachedAt).getTime();
            const ttl = cached._ftsPartial ? CACHE_PARTIAL_TTL_MS : CACHE_TTL_MS;
            if (age < ttl) useCache = true;
          }
        } catch (e) {}
      }
      let ftsAnnual, ftsQuarterly, ftsBalance, ftsAnnualSBC, ftsAnnualCapex, ftsAnnualRnD;
      let ftsAnnualSGA, ftsAnnualDepreciation, ftsAnnualShares;
      let ftsQuarterlyNI;
      if (useCache && cached.payload) {
        ftsAnnual = cached.payload.ftsAnnual;
        ftsQuarterly = cached.payload.ftsQuarterly;
        ftsBalance = cached.payload.ftsBalance;
        ftsAnnualSBC = cached.payload.ftsAnnualSBC;
        ftsAnnualCapex = cached.payload.ftsAnnualCapex;
        ftsAnnualRnD = cached.payload.ftsAnnualRnD || [];  // Bug #25: added in cache v2
        ftsQuarterlyNI = cached.payload.ftsQuarterlyNI || [];
        // Tag 211l: SGA + Depreciation added without FTS_CACHE_VERSION bump.
        // Old caches will return undefined → default to empty array. Stocks get
        // these fields after their cache expires (CACHE_TTL_MS) and re-pulls.
        ftsAnnualSGA = cached.payload.ftsAnnualSGA || [];
        ftsAnnualDepreciation = cached.payload.ftsAnnualDepreciation || [];
        // Tag 219 (audit F4 HIGH): annualShares added — same gradual-rollout
        // pattern as Tag 211l SGA/Depreciation.
        ftsAnnualShares = cached.payload.ftsAnnualShares || [];
      } else {
        // Tag-14: fundamentalsTimeSeries-Pull für annualOpInc/FCF/opIncQ.
        const fts = await _withTimeout(fetchFundamentalsTS(stock.yahoo_symbol), 30000, stock.ticker + '/fts');
        ftsAnnual = mapFTSToAnnual(fts.annualFin, fts.annualCash);
        ftsQuarterly = mapFTSToQuarterly(fts.quarterlyFin);
        ftsBalance = mapFTSToBalance(fts.annualBs);
        ftsAnnualSBC = _ftsExtractByYear(fts.annualCash, ['stockBasedCompensation']);
        ftsAnnualCapex = _ftsExtractByYear(fts.annualCash, ['capitalExpenditure', 'capitalExpenditures']);
        // Bug #25: annualRnD was never extracted — reinvestment-rate always computed Capex-only
        ftsAnnualRnD = _ftsExtractByYear(fts.annualFin, ['researchAndDevelopment', 'ResearchAndDevelopment', 'researchAndDevelopmentExpenses']);
        // Tag 211l: SGA (income statement) + Depreciation (cash flow) — unblocks
        // beneish-m-score (Tag 209d) which needs SGA + Depreciation, and
        // ohlson-o-score (Tag 210a) which needs OCF (already had). Field names
        // verified live against NVDA: 'sellingGeneralAndAdministration' on
        // annualFin and 'depreciationAndAmortization' on annualCash.
        ftsAnnualSGA = _ftsExtractByYear(fts.annualFin, ['sellingGeneralAndAdministration', 'SellingGeneralAndAdministration']);
        ftsAnnualDepreciation = _ftsExtractByYear(fts.annualCash, ['depreciationAndAmortization', 'depreciationAmortizationDepletion', 'DepreciationAndAmortization']);
        // Tag 219 (audit F4 HIGH): shares per year — unblocks methods/buyback-yield.js
        // which has been computable=false universally because annual.annualShares
        // never existed. Tries dilutedAverageShares (more conservative — counts
        // options/RSUs) first, falls back to basicAverageShares, then to FTS
        // annualBs ordinarySharesNumber. methods/capital-allocation-quality.js
        // will scale 4/4 instead of 3/4 once this lands.
        ftsAnnualShares = _ftsExtractByYear(fts.annualFin,
          ['dilutedAverageShares', 'basicAverageShares']);
        if (!ftsAnnualShares.some(v => v != null)) {
          ftsAnnualShares = _ftsExtractByYear(fts.annualBs,
            ['ordinarySharesNumber', 'shareIssued']);
        }
        // Tag-90: Quarterly NetIncome (8-Quarter-Earnings-Stability)
        ftsQuarterlyNI = (fts.quarterlyFin || []).slice().reverse()
          .map(r => r && r.netIncome != null ? r.netIncome : null)
          .filter(v => v != null);
        // F-DP-005: detect partial FTS result — any module that returned empty array
        const ftsPartial = (
          (fts.annualFin || []).length === 0 ||
          (fts.quarterlyFin || []).length === 0 ||
          (fts.annualCash || []).length === 0 ||
          (fts.annualBs || []).length === 0
        );
        try {
          // F-DP-052 (Tag 189): atomic FTS-cache write; worker pool can hit
          // same ticker if a retry races, and a truncated cache fails downstream
          // _ftsExtractByYear silently → quarterly-NI series goes empty.
          writeFileAtomic(cachePath, JSON.stringify({
            _cacheVersion: FTS_CACHE_VERSION,
            _ftsPartial: ftsPartial,
            cachedAt: new Date().toISOString(),
            payload: { ftsAnnual, ftsQuarterly, ftsBalance, ftsAnnualSBC, ftsAnnualCapex, ftsAnnualRnD, ftsQuarterlyNI, ftsAnnualSGA, ftsAnnualDepreciation, ftsAnnualShares }
          }));
        } catch (e) {}
        if (ftsPartial) canonical._ftsPartial = true;
      }
      // Override leere annual-Arrays aus quoteSummary mit FTS-Daten wenn FTS welche hat
      if (ftsAnnual.annualRev.length > canonical.annual.annualRev.length) canonical.annual.annualRev = ftsAnnual.annualRev;
      // Tag 203: FTS-OpInc override is now gated by non-null COUNT, not length.
      // mapFTSToAnnual pushes null placeholders for OpInc-missing rows (bank/
      // fintech) — without this guard a 4-null-entry FTS array would wipe out
      // a 4-non-null derived OpInc series produced by the Financial-Services
      // fallback in mapYahooToCanonical. Native FTS data (non-null entries)
      // still wins as before. We also reset opIncSource accordingly.
      const _qsOpIncNonNull = (canonical.annual.annualOpInc || []).filter(v => v != null && (typeof v !== 'object' || v.value != null)).length;
      const _ftsOpIncNonNull = (ftsAnnual.annualOpInc || []).filter(v => v != null && (typeof v !== 'object' || v.value != null)).length;
      if (_ftsOpIncNonNull > _qsOpIncNonNull) {
        // Tag 206f (Bug-Hunt Agent D HIGH F2): do NOT .filter() out nulls.
        // mapFTSToAnnual.js pushes null placeholders for OpInc-missing rows so that
        // annualOpInc[i] stays aligned with annualRev[i] / annualNetIncome[i] by
        // year (F-DP-030/031). Filtering nulls re-introduces positional drift:
        // a bank with annualRev=[10,9,8,7] and annualOpInc=[3,null,2,null]
        // becomes [3,2] after filter — now annualOpInc[1] (=2) wrongly maps
        // to annualRev[1] (=9, last year) instead of annualRev[2] (=8, 2y ago).
        // Downstream methods (_rawVals helper inside reinvestment-rate / margin-
        // quality / etc.) already tolerate nulls in-place.
        canonical.annual.annualOpInc = ftsAnnual.annualOpInc;
        if (canonical.meta) canonical.meta.opIncSource = 'native';
      }
      // Tag-28: annualBalance aus FTS überschreiben wenn FTS mehr nicht-null Werte hat
      const oldBalanceUsable = (canonical.annual.annualBalance || []).filter(r => r.totalDebt != null || r.totalCash != null || r.totalAssets != null).length;
      const newBalanceUsable = ftsBalance.filter(r => r.totalDebt != null || r.totalCash != null || r.totalAssets != null).length;
      if (newBalanceUsable > oldBalanceUsable) canonical.annual.annualBalance = ftsBalance;
      // Tag-43: annualSBC aus FTS hinzufügen
      canonical.annual.annualSBC = ftsAnnualSBC;
      // Tag-44: annualCapex aus FTS hinzufügen
      canonical.annual.annualCapex = ftsAnnualCapex;
      // Bug #25: annualRnD war nie geschrieben — reinvestment-rate nutzte immer nur Capex
      // Tag 202: prefer FTS-extracted RnD only when it has strictly more non-null
      // entries than the quoteSummary-derived RnD already on canonical.annual.
      // Yahoo FTS `financials` omits researchAndDevelopment for many large caps
      // (ASML, V, MA, MSFT, NVDA, GOOG observed) — without this guard the FTS
      // empty-array overwrites the legacy isHist values and (Capex+0)/OCF stays
      // below the 20% reinvestment-rate gate.
      const qsRnDNonNull = (canonical.annual.annualRnD || []).filter(v => v != null).length;
      const ftsRnDNonNull = (ftsAnnualRnD || []).filter(v => v != null).length;
      if (ftsRnDNonNull > qsRnDNonNull) {
        canonical.annual.annualRnD = ftsAnnualRnD;
      } else if (qsRnDNonNull === 0 && (ftsAnnualRnD || []).length > 0) {
        // Both empty/null — keep FTS shape for downstream length-alignment.
        canonical.annual.annualRnD = ftsAnnualRnD;
      }
      // else: keep canonical.annual.annualRnD as set by mapYahooToCanonical (quoteSummary).
      // Tag 211l: annualSGA + annualDepreciation surfacing — only set if non-empty,
      // mirrors the additive pattern used for annualSBC/annualCapex.
      if ((ftsAnnualSGA || []).length > 0)          canonical.annual.annualSGA = ftsAnnualSGA;
      if ((ftsAnnualDepreciation || []).length > 0) canonical.annual.annualDepreciation = ftsAnnualDepreciation;
      // Tag 219: shares per year — see Tag 219c agent F4 fix. Unblocks
      // methods/buyback-yield.js + makes capital-allocation-quality 4/4.
      if ((ftsAnnualShares || []).length > 0)       canonical.annual.annualShares = ftsAnnualShares;
      // Tag-90: quarterlyNI in timeseries
      canonical.timeseries.netIncomeQ = (ftsQuarterlyNI || []).map(v => ({ value: v }));
      if (ftsAnnual.annualGP.length > 0) canonical.annual.annualGP = ftsAnnual.annualGP;
      if (ftsAnnual.annualNetIncome.length > canonical.annual.annualNetIncome.length) canonical.annual.annualNetIncome = ftsAnnual.annualNetIncome;
      if (ftsAnnual.annualFCF.length > 0) canonical.annual.annualFCF = ftsAnnual.annualFCF;
      if (ftsAnnual.annualOCF && ftsAnnual.annualOCF.length > 0) canonical.annual.annualOCF = ftsAnnual.annualOCF;
      if (ftsQuarterly.revenueQ.length > canonical.timeseries.revenueQ.length) canonical.timeseries.revenueQ = ftsQuarterly.revenueQ;
      if (ftsQuarterly.opIncQ.length > 0) canonical.timeseries.opIncQ = ftsQuarterly.opIncQ;
      if (ftsQuarterly.grossProfitQ.length > 0) canonical.timeseries.grossProfitQ = ftsQuarterly.grossProfitQ;

      // Tag 203: post-FTS sector-aware OpInc fallback. After both quoteSummary
      // and FTS merges, if annualOpInc is still empty AND sector is Financial
      // Services, derive an estimate from operatingMargin × annualRev. Must run
      // BEFORE _convertSnapshotToUSD so the derived values are FX-converted
      // alongside the rest of annual.*. Idempotent — only fires when needed.
      // The fallback in mapYahooToCanonical already ran on quoteSummary fields,
      // but a partial FTS merge can leave annualOpInc shorter than annualRev;
      // this re-derivation guarantees a complete series when the metric exists.
      try {
        const _postSector = canonical.meta && canonical.meta.sector;
        const _postRev = canonical.annual && canonical.annual.annualRev || [];
        const _postOpInc = canonical.annual && canonical.annual.annualOpInc || [];
        const _postOpIncNonNull = _postOpInc.filter(v => v != null && (typeof v !== 'object' || v.value != null)).length;
        const _postOpMarg = canonical.metrics && canonical.metrics.operatingMargin && canonical.metrics.operatingMargin.value;
        // operatingMargin.value is in percent (43.741); convert back to fraction.
        const _opMargFrac = (typeof _postOpMarg === 'number' && Number.isFinite(_postOpMarg)) ? _postOpMarg / 100 : null;
        // Tag 206f: accept both Financial Services and Financials variant (same fix as mapper line).
        const _postIsFinancial = (_postSector === 'Financial Services' || _postSector === 'Financials');
        if (_postOpIncNonNull === 0 && _postIsFinancial && _postRev.length > 0) {
          const _retry = _deriveOpIncForFinancials([], _postRev, _opMargFrac);
          if (_retry.values.length > 0 && _retry.source) {
            canonical.annual.annualOpInc = _retry.values;
            canonical.meta.opIncSource = _retry.source;
          }
        }
      } catch (e) { /* defensive — never fail the pull on fallback errors */ }

      // Tag 134: single-pass USD conversion across marketCap + revenueTTM + all annual/quarterly series.
      // Must run AFTER FTS overrides (FTS values are also in reporting currency) and BEFORE mcap filter
      // (which compares against $1B USD floor). Fixes the structural currency mismatch where mcap was USD
      // but annual.* was local — silently corrupting fcf-yield, ev/ebitda, ROIC and every other ratio.
      try { _convertSnapshotToUSD(canonical); }
      catch (e) { _log('WARN', `  FX conversion failed for ${stock.ticker}: ${e.message}`); }
      // F-DQ-002: skip tickers where FX conversion failed — mcap is in local currency and would
      // pass or fail the USD mcap filter incorrectly.
      if (canonical.meta && canonical.meta.fxConversionFailed === true) {
        _log('INFO', `  ⊘ ${stock.ticker} skipped: fx-unknown (currency=${canonical.meta.reportingCurrencyOriginal})`);
        failures.push({ ticker: stock.ticker, error: 'fx-unknown', errClass: 'fx-unknown' });
        return;
      }

      // Tag-87a: MarketCap-Filter — skip Stocks außerhalb Karl's Mid/Large-Cap-Range
      // Tag 170 (reverted): $1B min — Mid-Cap coverage preserved per user decision.
      const MIN_MCAP = 1e9;       // $1B
      const MAX_MCAP = Infinity;       // Tag 101: kein Mega-Cap-Cut mehr
      const mcapVal = canonical.marketCap && canonical.marketCap.value;
      // F-DQ-001 (Tag 179): null mcap previously short-circuited and passed through
      // the floor — admitting stocks with missing market-cap data into the universe.
      // Now: treat null/missing as below-floor and skip with a distinct reason.
      const mcapMissing = (mcapVal == null);
      const mcapOutOfRange = mcapVal != null && (mcapVal < MIN_MCAP || mcapVal > MAX_MCAP);
      if (mcapMissing || mcapOutOfRange) {
        const reason = mcapMissing
          ? `mcap=null (skip; no marketCap from Yahoo)`
          : (mcapVal < MIN_MCAP ? `mcap=${(mcapVal/1e9).toFixed(2)}B < $${(MIN_MCAP/1e9).toFixed(0)}B (Small-Cap)` : `mcap=${(mcapVal/1e9).toFixed(0)}B > $${MAX_MCAP === Infinity ? 'Infinity' : (MAX_MCAP/1e12).toFixed(0)+'T'} (Mega-Cap)`);
        _log('INFO', `  ⊘ ${stock.ticker} skipped: ${reason}`);
        // Remove existing snapshot if was previously included
        const filename = safeSnapshotFilename(stock.ticker);
        const outPath = path.join(outputDir, filename);
        if (fs.existsSync(outPath)) {
          try { fs.unlinkSync(outPath); } catch (e) {}
        }
        // Tag 134: also clean up the legacy un-sanitized name if it exists (migration step)
        const legacyFilename = `${stock.ticker.replace(/[^A-Z0-9.-]/gi, '_')}.json`;
        if (legacyFilename !== filename) {
          const legacyPath = path.join(outputDir, legacyFilename);
          if (fs.existsSync(legacyPath)) { try { fs.unlinkSync(legacyPath); } catch (e) {} }
        }
        // F-DP-035 (Tag 183): also clean up the 28-day FTS cache. Without this,
        // a ticker cycling around the $1B boundary gets fresh price mixed with
        // stale fundamentals when it bumps back above.
        const fundCachePath = path.join(__dirname, 'fundamentals-cache', filename);
        if (fs.existsSync(fundCachePath)) {
          try { fs.unlinkSync(fundCachePath); } catch (e) {}
        }
        results.push({ ticker: stock.ticker, status: 'skipped-mcap', reason });
        return;  // skip this stock
      }
      // Tag 133c: data-quality grade — A/B/C/D nach Anteil fehlender kritischer Felder.
      // Wird in jeden Snapshot geschrieben; score-aggregator nutzt es optional (DATAQUALITY_ENFORCE=1).
      try { canonical._quality = gradeSnapshot(canonical); }
      catch (e) {
        // F-DP-045 (Tag 182): previously the exception was swallowed and grade=D
        // attributed to "data quality" — masking grader bugs as missing data.
        // Log the actual error message so a grader regression becomes visible
        // instead of presenting as a wave of bad-data tickers.
        _log('WARN', `gradeSnapshot threw for ${stock.ticker}: ${e.message}`);
        canonical._quality = {
          grade: 'D', nanRatio: 1.0,
          missingFields: ['<grade-error: ' + e.message + '>'],
          computedAt: new Date().toISOString()
        };
      }

      const filename = safeSnapshotFilename(stock.ticker);
      const outPath = path.join(outputDir, filename);
      // Tag 134: migrate from legacy un-sanitized name (one-time)
      const legacyFilename = `${stock.ticker.replace(/[^A-Z0-9.-]/gi, '_')}.json`;
      if (legacyFilename !== filename) {
        const legacyPath = path.join(outputDir, legacyFilename);
        if (fs.existsSync(legacyPath)) { try { fs.unlinkSync(legacyPath); } catch (e) {} }
      }
      // F-DP-047 (Tag 192): atomic snapshot write. Vorher: direct writeFileSync
      // konnte unter SIGTERM (CI cancel @165min) eine truncated snapshot-Datei
      // hinterlassen; nächste Pull-Runde liest dann eine korrupte JSON beim
      // price-only-Check (line 801 _priceOnlyUpdate) und wirft, was die teure
      // full-pull-Branch trotz noch-frischer Daten triggert.
      writeFileAtomic(outPath, JSON.stringify(canonical, null, 2));
      const revStr = canonical.metrics.revenueTTM ? '$' + (canonical.metrics.revenueTTM.value / 1e9).toFixed(1) + 'B' : 'no-rev';
      const growthStr = canonical.metrics.revenueGrowthYoY ? canonical.metrics.revenueGrowthYoY.value.toFixed(1) + '%' : '-';
      // P1-Fix Tag 13: data-completeness pro Stock loggen, damit downstream-Filter
      // selbst entscheiden können bei leeren annual/timeseries-Arrays.
      const completeness = {
        annualRev: canonical.annual.annualRev.length,
        annualOpInc: canonical.annual.annualOpInc.length,
        annualNetIncome: canonical.annual.annualNetIncome.length,
        annualGP: canonical.annual.annualGP.length,
        annualFCF: canonical.annual.annualFCF.length,
        revenueQ: canonical.timeseries.revenueQ.length,
        opIncQ: canonical.timeseries.opIncQ.length
      };
      results.push({ ticker: stock.ticker, status: 'ok', file: filename, revenue: revStr, growth: growthStr, completeness });
      _log('INFO', `  ✓ ${stock.ticker}: revenue=${revStr}, growth=${growthStr}, sector=${canonical.meta.sector}`);
    } catch (e) {
      // Tag 134 — Phase 5.3: classify error type so pull-stats-check can alert on
      // patterns (e.g. >5% rate-limit suggests a Yahoo policy change vs >5% 404
      // suggests universe contains dead tickers).
      const msg = String(e.message || '');
      // F-DP-006: surface programming errors (TypeError/ReferenceError) separately from transient Yahoo failures
      let errClass = 'other';
      if (e.constructor && (e.constructor.name === 'TypeError' || e.constructor.name === 'ReferenceError')) {
        errClass = 'mapper-bug';
        console.error('MAPPER-BUG', e.stack);
      } else if (/429|too many request|rate.?limit/i.test(msg)) errClass = 'rate-limit';
      else if (/404|not found|invalid (cookie|crumb|symbol)|no data found|no fundamentals data found/i.test(msg)) errClass = 'not-found';
      else if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(msg)) errClass = 'timeout';
      else if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network/i.test(msg)) errClass = 'network';
      else if (/parse|unexpected token|JSON/i.test(msg)) errClass = 'parse';
      // Tag 215h: Yahoo schema-validation failures classified as not-found.
      // Run #107 produced 637 such failures, ALL on international tickers
      // (091990.KQ Korean, 2823.TW Taiwanese, 6502.T Japanese, 6837.HK HK,
      // 600837.SS Chinese). Single-module probes return literal "Quote not
      // found" / "No fundamentals data found"; the multi-module quoteSummary
      // call gets a partially-populated response that fails the library's
      // strict-shape validator. Empirically: these tickers do not exist in
      // Yahoo's database for the requested region. Treat them like not-found
      // so the snapshot gets marked delisted (instead of being retried daily
      // and hitting the same wall). Risk acknowledged: if Yahoo ever
      // introduces a real schema break we'd silently re-classify it as
      // not-found — pull-stats-check should monitor the schema-vs-not-found
      // ratio over time as a sentinel.
      else if (/Failed Yahoo Schema validation|schema validation/i.test(msg)) errClass = 'not-found';

      // Tag 148: mark snapshot as delisted when Yahoo definitively rejects the symbol
      // (not-found class only — transient errors like rate-limit/timeout/network must NOT set this flag).
      if (errClass === 'not-found') {
        const filename = safeSnapshotFilename(stock.ticker);
        const outPath = path.join(outputDir, filename);
        try {
          let existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : null;
          if (existing && existing.meta) {
            existing.meta.delisted = true;
            existing.meta.delistedAt = new Date().toISOString();
            // F-DP-028 → factored into writeFileAtomic (Tag 189).
            writeFileAtomic(outPath, JSON.stringify(existing, null, 2));
            _log('INFO', `  Marked ${stock.ticker} as delisted in snapshot`);
          }
        } catch (writeErr) {
          _log('WARN', `  Could not update delisted flag for ${stock.ticker}: ${writeErr.message}`);
        }
      }

      failures.push({ ticker: stock.ticker, error: msg, errClass });
      _log('ERROR', `  ✗ ${stock.ticker}: [${errClass}] ${msg}`);
    }

    }
  // Tag 163: p-limit style worker pool — each worker independently loops through tickers.
  // A stalled ticker blocks only its own worker, not all CONCURRENCY workers.
  // Replaces batch Promise.all which gated all workers on the slowest ticker.
  // With 20 workers and rateLimitMs=1500ms per worker, throughput is ~13 tickers/sec.
  // A rate-limited ticker (up to ~29s total: 12s + 5s + 12s timeouts/delays) blocks
  // only its own slot; the other 19 workers keep pulling uninterrupted.
  async function runWorkerPool(stocks, processOneFn, concurrency, sleepMs, writeManifestFn) {
    let idx = 0;
    async function worker() {
      while (idx < stocks.length) {
        const myIdx = idx++;
        const stock = stocks[myIdx];
        if (!stock) continue;
        await processOneFn(stock).catch(e => _log('WARN', `Worker error ${stock.ticker}: ${e.message}`));
        // flush manifest every 100 tickers using the captured local index
        if (myIdx > 0 && myIdx % 100 === 0) writeManifestFn();
        if (idx < stocks.length) await _sleep(sleepMs);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  await runWorkerPool(watchlist.stocks, processOne, CONCURRENCY, rateLimitMs, writeManifestIncremental);
  writeManifestIncremental(); // final incremental flush before full manifest

  // F-DP-047 (Tag 192): same n_ok-vs-skipped-mcap fix as in the incremental
  // writeManifestIncremental() — final manifest must agree with the snapshot
  // count actually on disk.
  const okResultsFinal = results.filter(r =>
    r && (r.status === 'ok' || r.status === 'price-only'));
  const skippedMcapFinal = results.length - okResultsFinal.length;
  const manifest = {
    pulled_at: new Date().toISOString(),
    watchlist_version: watchlist._meta && watchlist._meta.version,
    n_total: watchlist.stocks.length,
    n_ok: okResultsFinal.length,
    n_skipped_mcap: skippedMcapFinal,
    n_failed: failures.length,
    results,
    failures
  };
  // Tag 153: write slim manifest (n_ok/n_failed only) to committed _manifest.json.
  // Full manifest (with per-ticker results/failures) goes to gitignored _manifest-full.json.
  // Saves ~1.4 MB per daily commit (95% of the committed file was diagnostics-only).
  // Tag 155: partial:false signals clean end-of-run write (incremental writes during loop set partial:true).
  const slim = { pulled_at: manifest.pulled_at, watchlist_version: manifest.watchlist_version, n_total: manifest.n_total, n_ok: manifest.n_ok, n_skipped_mcap: manifest.n_skipped_mcap, n_failed: manifest.n_failed, partial: false };
  // Tag 189: factored into writeFileAtomic helper.
  const slimPath = path.join(outputDir, '_manifest.json');
  writeFileAtomic(slimPath, JSON.stringify(slim));
  const fullPath = path.join(outputDir, '_manifest-full.json');
  writeFileAtomic(fullPath, JSON.stringify(manifest));
  _log('INFO', `Pull complete: ${okResultsFinal.length}/${watchlist.stocks.length} ok (${skippedMcapFinal} skipped-mcap), ${failures.length} failed`);
  return manifest;
}

function parseArgs(argv) {
  const args = { watchlist: 'watchlist.json', output: './snapshots', rateLimit: 1500 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--watchlist' && argv[i+1]) args.watchlist = argv[++i];
    else if (argv[i] === '--output' && argv[i+1]) args.output = argv[++i];
    else if (argv[i] === '--rate-limit' && argv[i+1]) {
      const n = parseInt(argv[++i], 10);
      args.rateLimit = (Number.isFinite(n) && n > 0) ? n : 1500;  // P1-Fix Tag 13
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.watchlist)) {
    _log('ERROR', `Watchlist not found: ${args.watchlist}`);
    process.exit(1);
  }
  // Tag 153: delete committed _manifest.json before the pull so a mid-run SIGKILL cannot
  // leave yesterday's stale n_ok on disk, causing the quality gate to pass on partial data.
  const manifestPath = path.join(args.output, '_manifest.json');
  if (fs.existsSync(manifestPath)) {
    try { fs.unlinkSync(manifestPath); _log('INFO', 'Deleted stale _manifest.json'); }
    catch (e) { _log('WARN', 'Could not delete stale _manifest.json: ' + e.message); }
  }
  const watchlist = JSON.parse(fs.readFileSync(args.watchlist, 'utf8'));
  if (!watchlist.stocks || !Array.isArray(watchlist.stocks)) {
    _log('ERROR', 'Watchlist must have .stocks array');
    process.exit(1);
  }
  const manifest = await pullAll(watchlist, args.output, args.rateLimit);
  // Tag 147: threshold is relative to "attempted" (excludes skipped-mcap which never
  // hit the network). Counting skipped-mcap in n_total inflated the denominator and
  // made the 75% guard meaningless for large universes with many micro-cap tickers.
  const skippedMcap = (manifest.results || []).filter(r => r.status === 'skipped-mcap').length;
  const attempted = Math.max(1, manifest.n_total - skippedMcap);
  const failRatio = manifest.n_failed / attempted;
  _log('INFO', `Fail-ratio: ${(failRatio * 100).toFixed(1)}% (${manifest.n_failed} fail / ${attempted} attempted; ${skippedMcap} skipped-mcap)`);
  process.exit(failRatio > 0.75 ? 1 : 0);
}

if (require.main === module) {
  main().catch(e => {
    _log('FATAL', e.stack || e.message);
    process.exit(1);
  });
}

module.exports = { mapYahooToCanonical, pullAll, normalizeRegion, _convertSnapshotToUSD, safeSnapshotFilename };
