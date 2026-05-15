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
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'], queue: { concurrency: _YF_CONC } });

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
  'insiderTransactions'                 // Tag 137: Form 4 insider buy/sell activity
];

// ─── Logger ───────────────────────────────────────────────────────


// Tag-87c / Tag-133b: FX-Rates für Currency-Conversion (USD-base).
// Live-Rates aus fx-rates.json (refresh-fx.js Workflow-Step) wenn vorhanden + frisch (≤14d).
// Fallback: hardgecodete Tabelle (kann Monate stale sein — flagged via _log WARN).
const FX_FALLBACK = {
  USD: 1.0, EUR: 1.08, GBP: 1.27, CHF: 1.10,
  SEK: 0.095, NOK: 0.092, DKK: 0.145,
  JPY: 0.0067, HKD: 0.128, CNY: 0.139,
  AUD: 0.65, CAD: 0.74, KRW: 0.00074, INR: 0.012,
  TWD: 0.031, BRL: 0.20, MXN: 0.058, ZAR: 0.054,
  SGD: 0.74
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
    // Mark each rate that came from raw.rates as live; the rest stay as fallback.
    for (const k of Object.keys(raw.rates)) {
      const up = k.toUpperCase();
      FX_PROVENANCE[up] = 'live';
      FX_TO_USD[up] = raw.rates[k];  // ensure uppercase key lookup hits
    }
    console.log('[FX] Loaded ' + Object.keys(raw.rates).length + ' rates from fx-rates.json (' +
      Object.values(FX_PROVENANCE).filter(v => v === 'live').length + ' live, ' +
      Object.values(FX_PROVENANCE).filter(v => v === 'fallback-hardcoded').length + ' fallback)');
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
  if (snap.metrics && snap.metrics.revenueTTM) snap.metrics.revenueTTM = scale(snap.metrics.revenueTTM);
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
  const annualOpInc = _arr(isHist, 'operatingIncome');
  const annualNetIncome = _arr(isHist, 'netIncome');
  const annualGP = _arr(isHist, 'grossProfit');
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
  const fcfTTM = _y(fd, 'freeCashflow');
  const revTTM = _y(fd, 'totalRevenue');
  const fcfMarginTTM = (fcfTTM != null && revTTM && revTTM !== 0) ? (fcfTTM / revTTM) * 100 : null;

  // SBC-Ratio: nicht in Default-Modules — TODO Tag-14: separater financials-Module-Pull
  const sbcRatio = null;

  // Tag 137: Insider transaction activity (last 90 days, open-market buys)
  const insiderActivity = (function() {
    const it = yahoo.insiderTransactions;
    const txns = it && it.transactions;
    if (!txns || !Array.isArray(txns) || txns.length === 0) return null;
    const cutoffMs = Date.now() - 90 * 86400 * 1000;
    let buyCount = 0, sellCount = 0, netShares = 0, lastBuyDate = null;
    // F-DP-038 (Tag 182): "cluster" buys should count UNIQUE insider filers, not
    // total transactions. A single insider buying in 5 separate transactions is
    // momentum-noise, not a cluster signal. Previously clusterBuys90d ≡ buyCount90d
    // which made the "cluster" name misleading. Now: dedupe by filer name.
    const uniqueBuyFilers = new Set();
    for (const tx of txns) {
      const ts = tx.startDate && (typeof tx.startDate === 'number' ? tx.startDate * 1000 : new Date(tx.startDate).getTime());
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

  const rcOriginal = _y(pr, 'currency') || 'USD';
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
      fetchedAt: asOf,
      filingDate: null,  // Yahoo liefert kein Filing-Datum für TTM
      firstTradeDate: null,  // wird unten aus yf.quote() gesetzt (Tag 106)
      ipoYear: null
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
      pe:               _metric(_y(sd, 'trailingPE'), SRC, CONF, asOf)
    },
    external: {
      // aktienfinderScore via Bookmarklet manuell synced
    },
    timeseries: {
      revenueQ, opIncQ, grossProfitQ
    },
    annual: {
      annualRev, annualOpInc, annualNetIncome, annualGP, annualFCF, annualOCF, annualBalance
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
    if (cash == null && totalDebt == null && totalAssets == null) continue;
    annualBalance.push({ totalCash: cash, totalDebt, totalAssets, ...(_debtPartial ? { _debtPartial: true } : {}) });
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
function sortByStaleness(stocks, outputDir) {
  return stocks.slice().sort((a, b) => {
    const getAge = (ticker) => {
      try {
        const fp = path.join(outputDir, safeSnapshotFilename(ticker));
        if (!fs.existsSync(fp)) return 0; // no snapshot = oldest (age=0ms = earliest epoch)
        // Read only first 300 bytes to find asOf without parsing whole file
        const buf = Buffer.alloc(300);
        const fd = fs.openSync(fp, 'r');
        fs.readSync(fd, buf, 0, 300, 0);
        fs.closeSync(fd);
        const m = buf.toString('utf8').match(/"asOf"\s*:\s*"([^"]+)"/);
        return m ? new Date(m[1]).getTime() : 0;
      } catch { return 0; }
    };
    return getAge(a.ticker) - getAge(b.ticker); // ascending = oldest first
  });
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
  async function quoteSummaryWithRetry(symbol, label) {
    const DELAYS = [5000, 12000];
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
      const slim = {
        pulled_at: new Date().toISOString(),
        watchlist_version: watchlist._meta && watchlist._meta.version,
        n_total: watchlist.stocks.length,
        n_ok: results.length,
        n_failed: failures.length,
        partial: true
      };
      const mPath = path.join(outputDir, '_manifest.json');
      const mTmp = mPath + '.tmp';
      fs.writeFileSync(mTmp, JSON.stringify(slim));
      fs.renameSync(mTmp, mPath);
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
    // F-DP-032 (Tag 179): atomic tmp+rename — price-only path was the only snapshot
    // writer still doing direct writeFileSync, vulnerable to SIGTERM corruption on
    // CI cancellation. ~80% of daily pulls go through this fast-path.
    const tmpFp = fp + '.tmp.' + process.pid;
    fs.writeFileSync(tmpFp, JSON.stringify(existing, null, 2));
    fs.renameSync(tmpFp, fp);
    return { ticker: stock.ticker, status: 'price-only', mcap: q.marketCap, price: q.regularMarketPrice };
  }

  async function processOne(stock) {

    try {
      // Tag 166: price-only fast-path if recent snapshot exists
      const age = _getExistingSnapshotAge(stock.ticker);
      if (age != null && age < FUNDAMENTALS_MAX_AGE_MS) {
        try {
          const r = await _priceOnlyUpdate(stock, outputDir);
          results.push(r);
          _log('INFO', `  ✓ ${stock.ticker} [price-only]: mcap=${r.mcap}, price=${r.price}`);
          return;
        } catch (e) {
          _log('WARN', `  price-only failed for ${stock.ticker}, falling through to full pull: ${e.message}`);
          // fall through to full pull below
        }
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
          // F-DP-019: reject cache if version key is missing or differs
          if (cached._cacheVersion !== FTS_CACHE_VERSION) {
            cached = null;
          } else {
            const age = Date.now() - new Date(cached.cachedAt).getTime();
            const ttl = cached._ftsPartial ? CACHE_PARTIAL_TTL_MS : CACHE_TTL_MS;
            if (age < ttl) useCache = true;
          }
        } catch (e) {}
      }
      let ftsAnnual, ftsQuarterly, ftsBalance, ftsAnnualSBC, ftsAnnualCapex, ftsAnnualRnD;
      let ftsQuarterlyNI;
      if (useCache && cached.payload) {
        ftsAnnual = cached.payload.ftsAnnual;
        ftsQuarterly = cached.payload.ftsQuarterly;
        ftsBalance = cached.payload.ftsBalance;
        ftsAnnualSBC = cached.payload.ftsAnnualSBC;
        ftsAnnualCapex = cached.payload.ftsAnnualCapex;
        ftsAnnualRnD = cached.payload.ftsAnnualRnD || [];  // Bug #25: added in cache v2
        ftsQuarterlyNI = cached.payload.ftsQuarterlyNI || [];
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
          fs.writeFileSync(cachePath, JSON.stringify({
            _cacheVersion: FTS_CACHE_VERSION,
            _ftsPartial: ftsPartial,
            cachedAt: new Date().toISOString(),
            payload: { ftsAnnual, ftsQuarterly, ftsBalance, ftsAnnualSBC, ftsAnnualCapex, ftsAnnualRnD, ftsQuarterlyNI }
          }));
        } catch (e) {}
        if (ftsPartial) canonical._ftsPartial = true;
      }
      // Override leere annual-Arrays aus quoteSummary mit FTS-Daten wenn FTS welche hat
      if (ftsAnnual.annualRev.length > canonical.annual.annualRev.length) canonical.annual.annualRev = ftsAnnual.annualRev;
      if (ftsAnnual.annualOpInc.length > 0) canonical.annual.annualOpInc = ftsAnnual.annualOpInc;
      // Tag-28: annualBalance aus FTS überschreiben wenn FTS mehr nicht-null Werte hat
      const oldBalanceUsable = (canonical.annual.annualBalance || []).filter(r => r.totalDebt != null || r.totalCash != null || r.totalAssets != null).length;
      const newBalanceUsable = ftsBalance.filter(r => r.totalDebt != null || r.totalCash != null || r.totalAssets != null).length;
      if (newBalanceUsable > oldBalanceUsable) canonical.annual.annualBalance = ftsBalance;
      // Tag-43: annualSBC aus FTS hinzufügen
      canonical.annual.annualSBC = ftsAnnualSBC;
      // Tag-44: annualCapex aus FTS hinzufügen
      canonical.annual.annualCapex = ftsAnnualCapex;
      // Bug #25: annualRnD war nie geschrieben — reinvestment-rate nutzte immer nur Capex
      canonical.annual.annualRnD = ftsAnnualRnD || [];
      // Tag-90: quarterlyNI in timeseries
      canonical.timeseries.netIncomeQ = (ftsQuarterlyNI || []).map(v => ({ value: v }));
      if (ftsAnnual.annualGP.length > 0) canonical.annual.annualGP = ftsAnnual.annualGP;
      if (ftsAnnual.annualNetIncome.length > canonical.annual.annualNetIncome.length) canonical.annual.annualNetIncome = ftsAnnual.annualNetIncome;
      if (ftsAnnual.annualFCF.length > 0) canonical.annual.annualFCF = ftsAnnual.annualFCF;
      if (ftsAnnual.annualOCF && ftsAnnual.annualOCF.length > 0) canonical.annual.annualOCF = ftsAnnual.annualOCF;
      if (ftsQuarterly.revenueQ.length > canonical.timeseries.revenueQ.length) canonical.timeseries.revenueQ = ftsQuarterly.revenueQ;
      if (ftsQuarterly.opIncQ.length > 0) canonical.timeseries.opIncQ = ftsQuarterly.opIncQ;
      if (ftsQuarterly.grossProfitQ.length > 0) canonical.timeseries.grossProfitQ = ftsQuarterly.grossProfitQ;

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
      fs.writeFileSync(outPath, JSON.stringify(canonical, null, 2));
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
            // F-DP-028: use tmp+rename for atomic delisted-flag write
            const delistedTmp = outPath + '.tmp';
            fs.writeFileSync(delistedTmp, JSON.stringify(existing, null, 2));
            fs.renameSync(delistedTmp, outPath);
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

  const manifest = {
    pulled_at: new Date().toISOString(),
    watchlist_version: watchlist._meta && watchlist._meta.version,
    n_total: watchlist.stocks.length,
    n_ok: results.length,
    n_failed: failures.length,
    results,
    failures
  };
  // Tag 153: write slim manifest (n_ok/n_failed only) to committed _manifest.json.
  // Full manifest (with per-ticker results/failures) goes to gitignored _manifest-full.json.
  // Saves ~1.4 MB per daily commit (95% of the committed file was diagnostics-only).
  // Tag 155: partial:false signals clean end-of-run write (incremental writes during loop set partial:true).
  const slim = { pulled_at: manifest.pulled_at, watchlist_version: manifest.watchlist_version, n_total: manifest.n_total, n_ok: manifest.n_ok, n_failed: manifest.n_failed, partial: false };
  // F-DP-002: use tmp+rename for atomic manifest writes
  const slimPath = path.join(outputDir, '_manifest.json');
  const slimTmp = slimPath + '.tmp';
  fs.writeFileSync(slimTmp, JSON.stringify(slim));
  fs.renameSync(slimTmp, slimPath);
  const fullPath = path.join(outputDir, '_manifest-full.json');
  const fullTmp = fullPath + '.tmp';
  fs.writeFileSync(fullTmp, JSON.stringify(manifest));
  fs.renameSync(fullTmp, fullPath);
  _log('INFO', `Pull complete: ${results.length}/${watchlist.stocks.length} ok, ${failures.length} failed`);
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
