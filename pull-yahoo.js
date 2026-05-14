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
    console.log('[FX] Loaded ' + Object.keys(raw.rates).length + ' rates from fx-rates.json');
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
  const origCurrency = snap.meta.reportingCurrency || 'USD';
  if (origCurrency === 'USD') {
    snap.meta.reportingCurrencyOriginal = 'USD';
    snap.meta.fxRateApplied = 1.0;
    return snap;
  }

  // Tag 148: British pence (GBp) — Yahoo quotes some UK shares in pence, not pounds.
  // marketCap and financial values are already 100x too small relative to GBP.
  // Divide by 100 first to convert pence → pounds, then apply the GBP→USD rate.
  const isPence = origCurrency === 'GBp';
  const fxKey = isPence ? 'GBP' : origCurrency.toUpperCase();

  const rate = FX_TO_USD[fxKey];
  if (rate == null) {
    // unknown currency — keep values as-is, flag for diagnostics
    snap.meta.reportingCurrencyOriginal = origCurrency;
    snap.meta.fxRateApplied = null;
    snap.meta.fxConversionFailed = true;
    return snap;
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
  // P0-Fix Tag 13: 0+0 wenn beide undefined ist semantisch falsch — Engine sieht Debt=0 statt null.
  // Plus: Yahoo-Field-Name-Drift seit Nov 2024 — multi-fallback für cash.
  const annualBalance = (bsHist || []).map(r => {
    const cash = _y(r, 'cash')
              ?? _y(r, 'cashAndCashEquivalents')
              ?? _y(r, 'cashAndShortTermInvestments');
    const std = _y(r, 'shortLongTermDebt');
    const ltd = _y(r, 'longTermDebt');
    const totalDebt = (std == null && ltd == null) ? null : (std || 0) + (ltd || 0);
    const totalAssets = _y(r, 'totalAssets');
    if (cash == null && totalDebt == null && totalAssets == null) return null;
    return { totalCash: cash, totalDebt, totalAssets };
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
    for (const tx of txns) {
      const ts = tx.startDate && (typeof tx.startDate === 'number' ? tx.startDate * 1000 : new Date(tx.startDate).getTime());
      if (!ts || ts < cutoffMs) continue;
      const text = String(tx.transactionText || '').toLowerCase();
      const shares = (tx.shares && typeof tx.shares === 'object') ? tx.shares.raw : (tx.shares || 0);
      // Open-market purchase: text contains "purchase" but NOT "automatic", "grant", "option", "award"
      const isOpenBuy = /purchase/i.test(text) && !/automatic|option|grant|award|vest|exercise/i.test(text);
      const isOpenSell = /sale|sell/i.test(text) && !/automatic/i.test(text);
      if (isOpenBuy) {
        buyCount++;
        netShares += (shares || 0);
        const d = new Date(ts).toISOString().slice(0, 10);
        if (!lastBuyDate || d > lastBuyDate) lastBuyDate = d;
      } else if (isOpenSell) {
        sellCount++;
        netShares -= Math.abs(shares || 0);
      }
    }
    return { clusterBuys90d: buyCount, buyCount90d: buyCount, sellCount90d: sellCount, netShares90d: netShares, lastBuyDate };
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
      annualRev, annualOpInc, annualNetIncome, annualGP, annualFCF, annualBalance
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
  for (const k of keys) if (row[k] != null) return row[k];
  return null;
}

// Mappt fundamentalsTimeSeries-Rows zu engine-Schema-Arrays (latest first).
function _ftsExtractByYear(rows, fieldNames) {
  // Returns [{year: 2025, value: ...}, ...] sorted latest first
  const sorted = (rows || []).slice().reverse();
  const out = [];
  for (const r of sorted) {
    if (!r) continue;
    const v = _ftsValue(r, ...fieldNames);
    if (v == null) continue;
    out.push(v);
  }
  return out;
}

function mapFTSToAnnual(annualRows, cashRows) {
  // Rows kommen oldest first → wir wollen latest first
  // Erste Row in annualRows ist meist null/incomplete-Quartal — filtere wenn keine totalRevenue.
  const sorted = (annualRows || []).slice().reverse();
  const annualRev = [];
  const annualOpInc = [];
  const annualGP = [];
  const annualNetIncome = [];
  for (const r of sorted) {
    const rev = _ftsValue(r, 'totalRevenue', 'TotalRevenue');
    if (rev == null) continue;  // skip leere Rows
    annualRev.push({ value: rev });
    const oi = _ftsValue(r, 'operatingIncome', 'OperatingIncome', 'totalOperatingIncomeAsReported');
    if (oi != null) annualOpInc.push({ value: oi });
    const gp = _ftsValue(r, 'grossProfit', 'GrossProfit');
    if (gp != null) annualGP.push({ value: gp });
    const ni = _ftsValue(r, 'netIncome', 'NetIncome', 'netIncomeContinuousOperations');
    if (ni != null) annualNetIncome.push({ value: ni });
  }
  // FCF aus cash-flow-Module
  const annualFCF = [];
  const cashSorted = (cashRows || []).slice().reverse();
  for (const r of cashSorted) {
    let fcf = _ftsValue(r, 'freeCashFlow', 'FreeCashFlow');
    if (fcf == null) {
      // Compute aus OpCash + CapEx wenn möglich
      const op = _ftsValue(r, 'operatingCashFlow', 'OperatingCashFlow');
      const capex = _ftsValue(r, 'capitalExpenditure', 'CapitalExpenditure');
      if (op != null && capex != null) fcf = op + capex;  // capex ist negativ
    }
    if (fcf != null) annualFCF.push({ value: fcf });
  }
  return { annualRev, annualOpInc, annualGP, annualNetIncome, annualFCF };
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
    const totalAssets = _ftsValue(r, 'totalAssets');
    if (cash == null && totalDebt == null && totalAssets == null) continue;
    annualBalance.push({ totalCash: cash, totalDebt, totalAssets });
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
    if (oi != null) opIncQ.push({ value: oi });
    const gp = _ftsValue(r, 'grossProfit', 'GrossProfit');
    if (gp != null) grossProfitQ.push({ value: gp });
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
        const isRateLimit = /429|too many request|rate.?limit/i.test(String(e.message || ''));
        if (isRateLimit && attempt < DELAYS.length) {
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
  function writeManifestIncremental() {
    try {
      const slim = {
        pulled_at: new Date().toISOString(),
        watchlist_version: watchlist._meta && watchlist._meta.version,
        n_total: watchlist.stocks.length,
        n_ok: results.length,
        n_failed: failures.length,
        partial: true
      };
      fs.writeFileSync(path.join(outputDir, '_manifest.json'), JSON.stringify(slim));
    } catch (e) {
      _log('WARN', `Incremental manifest write failed: ${e.message}`);
    }
  }

  async function processOne(stock) {

    try {
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
      } catch (e) { /* IPO-Feld optional, nicht-kritisch */ }

      // Tag-85: Smart-Cache — skip FTS-Pull wenn cache <28 Tage alt
      const cacheDir = path.join(__dirname, 'fundamentals-cache');
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      const cachePath = path.join(cacheDir, safeSnapshotFilename(stock.ticker));
      const CACHE_TTL_MS = 28 * 86400 * 1000;
      let useCache = false;
      let cached = null;
      if (fs.existsSync(cachePath)) {
        try {
          cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
          const age = Date.now() - new Date(cached.cachedAt).getTime();
          if (age < CACHE_TTL_MS) useCache = true;
        } catch (e) {}
      }
      let ftsAnnual, ftsQuarterly, ftsBalance, ftsAnnualSBC, ftsAnnualCapex;
      var ftsQuarterlyNI;
      if (useCache && cached.payload) {
        ftsAnnual = cached.payload.ftsAnnual;
        ftsQuarterly = cached.payload.ftsQuarterly;
        ftsBalance = cached.payload.ftsBalance;
        ftsAnnualSBC = cached.payload.ftsAnnualSBC;
        ftsAnnualCapex = cached.payload.ftsAnnualCapex;
        ftsQuarterlyNI = cached.payload.ftsQuarterlyNI || [];
      } else {
        // Tag-14: fundamentalsTimeSeries-Pull für annualOpInc/FCF/opIncQ.
        const fts = await _withTimeout(fetchFundamentalsTS(stock.yahoo_symbol), 30000, stock.ticker + '/fts');
        ftsAnnual = mapFTSToAnnual(fts.annualFin, fts.annualCash);
        ftsQuarterly = mapFTSToQuarterly(fts.quarterlyFin);
        ftsBalance = mapFTSToBalance(fts.annualBs);
        ftsAnnualSBC = _ftsExtractByYear(fts.annualCash, ['stockBasedCompensation']);
        ftsAnnualCapex = _ftsExtractByYear(fts.annualCash, ['capitalExpenditure', 'capitalExpenditures']);
        // Tag-90: Quarterly NetIncome (8-Quarter-Earnings-Stability)
        var ftsQuarterlyNI = (fts.quarterlyFin || []).slice().reverse()
          .map(r => r && r.netIncome != null ? r.netIncome : null)
          .filter(v => v != null);
        try {
          fs.writeFileSync(cachePath, JSON.stringify({
            cachedAt: new Date().toISOString(),
            payload: { ftsAnnual, ftsQuarterly, ftsBalance, ftsAnnualSBC, ftsAnnualCapex, ftsQuarterlyNI }
          }));
        } catch (e) {}
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
      // Tag-90: quarterlyNI in timeseries
      canonical.timeseries.netIncomeQ = (ftsQuarterlyNI || []).map(v => ({ value: v }));
      if (ftsAnnual.annualGP.length > 0) canonical.annual.annualGP = ftsAnnual.annualGP;
      if (ftsAnnual.annualNetIncome.length > canonical.annual.annualNetIncome.length) canonical.annual.annualNetIncome = ftsAnnual.annualNetIncome;
      if (ftsAnnual.annualFCF.length > 0) canonical.annual.annualFCF = ftsAnnual.annualFCF;
      if (ftsQuarterly.revenueQ.length > canonical.timeseries.revenueQ.length) canonical.timeseries.revenueQ = ftsQuarterly.revenueQ;
      if (ftsQuarterly.opIncQ.length > 0) canonical.timeseries.opIncQ = ftsQuarterly.opIncQ;
      if (ftsQuarterly.grossProfitQ.length > 0) canonical.timeseries.grossProfitQ = ftsQuarterly.grossProfitQ;

      // Tag 134: single-pass USD conversion across marketCap + revenueTTM + all annual/quarterly series.
      // Must run AFTER FTS overrides (FTS values are also in reporting currency) and BEFORE mcap filter
      // (which compares against $1B USD floor). Fixes the structural currency mismatch where mcap was USD
      // but annual.* was local — silently corrupting fcf-yield, ev/ebitda, ROIC and every other ratio.
      try { _convertSnapshotToUSD(canonical); }
      catch (e) { _log('WARN', `  FX conversion failed for ${stock.ticker}: ${e.message}`); }

      // Tag-87a: MarketCap-Filter — skip Stocks außerhalb Karl's Mid/Large-Cap-Range
      // Tag 116: untere Schwelle von $2B auf $1B gesenkt (konsistent mit refresh-universe).
      // Erhoeht Coverage; Karl filtert via Mcap-Slider in modes-report.
      const MIN_MCAP = 1e9;       // $1B (vorher $2B)
      const MAX_MCAP = Infinity;       // Tag 101: kein Mega-Cap-Cut mehr
      const mcapVal = canonical.marketCap && canonical.marketCap.value;
      if (mcapVal != null && (mcapVal < MIN_MCAP || mcapVal > MAX_MCAP)) {
        const reason = mcapVal < MIN_MCAP ? `mcap=${(mcapVal/1e9).toFixed(2)}B < $2B (Small-Cap)` : `mcap=${(mcapVal/1e9).toFixed(0)}B > $300B (Mega-Cap)`;
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
        results.push({ ticker: stock.ticker, status: 'skipped-mcap', reason });
        return;  // skip this stock
      }
      // Tag 133c: data-quality grade — A/B/C/D nach Anteil fehlender kritischer Felder.
      // Wird in jeden Snapshot geschrieben; score-aggregator nutzt es optional (DATAQUALITY_ENFORCE=1).
      try { canonical._quality = gradeSnapshot(canonical); }
      catch (e) { canonical._quality = { grade: 'D', nanRatio: 1.0, missingFields: ['<grade-error>'], computedAt: new Date().toISOString() }; }

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
      let errClass = 'other';
      if (/429|too many request|rate.?limit/i.test(msg)) errClass = 'rate-limit';
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
            fs.writeFileSync(outPath, JSON.stringify(existing, null, 2));
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
        const stock = stocks[idx++];
        if (!stock) continue;
        await processOneFn(stock).catch(e => _log('WARN', `Worker error ${stock.ticker}: ${e.message}`));
        // flush manifest every 100 tickers
        if (idx % 100 === 0) writeManifestFn();
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
  fs.writeFileSync(path.join(outputDir, '_manifest.json'), JSON.stringify(slim));
  fs.writeFileSync(path.join(outputDir, '_manifest-full.json'), JSON.stringify(manifest));
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
