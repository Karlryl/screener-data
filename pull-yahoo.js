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

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'], queue: { concurrency: 1 } });

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
  'assetProfile'                        // sector, industry
];

// ─── Logger ───────────────────────────────────────────────────────


// Tag-87c: FX-Rates für Currency-Conversion (USD-base)
const FX_TO_USD = {
  USD: 1.0, EUR: 1.08, GBP: 1.27, CHF: 1.10,
  SEK: 0.095, NOK: 0.092, DKK: 0.145,
  JPY: 0.0067, HKD: 0.128, CNY: 0.139,
  AUD: 0.65, CAD: 0.74, KRW: 0.00074, INR: 0.012,
  TWD: 0.031, BRL: 0.20, MXN: 0.058, ZAR: 0.054
};
function _convertToUSD(value, currency) {
  if (value == null || !currency) return value;
  const rate = FX_TO_USD[currency.toUpperCase()];
  if (rate == null) return value;  // unknown currency, leave as is
  return value * rate;
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
    return { totalCash: cash, totalDebt, totalAssets: _y(r, 'totalAssets') };
  });

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

  return {
    identifier: { primary: 'ISIN', value: watchlistEntry.isin || `TICKER:${watchlistEntry.ticker}` },
    meta: {
      ticker: watchlistEntry.ticker,
      name: _y(pr, 'longName') || watchlistEntry.name || watchlistEntry.ticker,
      sector: _y(ap, 'sector') || null,
      industry: _y(ap, 'industry') || null,
      region: _y(pr, 'exchangeName') || null,
      reportingCurrency: _y(pr, 'currency') || 'USD',
      fetchedAt: asOf,
      filingDate: null  // Yahoo liefert kein Filing-Datum für TTM
    },
    marketCap: _metric(_convertToUSD(_y(sd, 'marketCap'), _y(sd, 'currency') || _y(pr, 'currency')), SRC, CONF, asOf),
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
    }
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

async function pullAll(watchlist, outputDir, rateLimitMs) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const results = [];
  const failures = [];
  // Tag-80: Parallel pulls in batches of CONCURRENCY
  const CONCURRENCY = parseInt(process.env.PULL_CONCURRENCY || '10', 10);
  _log('INFO', `Parallel pulls: ${CONCURRENCY} concurrent. Total: ${watchlist.stocks.length} stocks.`);
  async function processOne(stock) {

    try {
      _log('INFO', `Pulling ${stock.ticker} (${stock.yahoo_symbol})…`);
      const yahoo = await yf.quoteSummary(stock.yahoo_symbol, { modules: MODULES });
      const asOf = new Date().toISOString();
      const canonical = mapYahooToCanonical(yahoo, stock, asOf);

      // Tag-85: Smart-Cache — skip FTS-Pull wenn cache <28 Tage alt
      const cacheDir = path.join(__dirname, 'fundamentals-cache');
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      const cachePath = path.join(cacheDir, stock.ticker.replace(/[^A-Z0-9.-]/gi, '_') + '.json');
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
        const fts = await fetchFundamentalsTS(stock.yahoo_symbol);
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

      // Tag-87a: MarketCap-Filter — skip Stocks außerhalb Karl's Mid/Large-Cap-Range
      const MIN_MCAP = 2e9;       // $2B
      const MAX_MCAP = Infinity;       // Tag 101: kein Mega-Cap-Cut mehr
      const mcapVal = canonical.marketCap && canonical.marketCap.value;
      if (mcapVal != null && (mcapVal < MIN_MCAP || mcapVal > MAX_MCAP)) {
        const reason = mcapVal < MIN_MCAP ? `mcap=${(mcapVal/1e9).toFixed(2)}B < $2B (Small-Cap)` : `mcap=${(mcapVal/1e9).toFixed(0)}B > $300B (Mega-Cap)`;
        _log('INFO', `  ⊘ ${stock.ticker} skipped: ${reason}`);
        // Remove existing snapshot if was previously included
        const filename = `${stock.ticker.replace(/[^A-Z0-9.-]/gi, '_')}.json`;
        const outPath = path.join(outputDir, filename);
        if (fs.existsSync(outPath)) {
          try { fs.unlinkSync(outPath); } catch (e) {}
        }
        results.push({ ticker: stock.ticker, status: 'skipped-mcap', reason });
        return;  // skip this stock
      }
      const filename = `${stock.ticker.replace(/[^A-Z0-9.-]/gi, '_')}.json`;
      const outPath = path.join(outputDir, filename);
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
      failures.push({ ticker: stock.ticker, error: e.message });
      _log('ERROR', `  ✗ ${stock.ticker}: ${e.message}`);
    }

    }
  // Run in parallel batches with rate-limit sleep between batches
  for (let batchStart = 0; batchStart < watchlist.stocks.length; batchStart += CONCURRENCY) {
    const batch = watchlist.stocks.slice(batchStart, batchStart + CONCURRENCY);
    await Promise.all(batch.map(s => processOne(s).catch(e => _log('WARN', `Batch error ${s.ticker}: ${e.message}`))));
    if (batchStart + CONCURRENCY < watchlist.stocks.length) {
      await _sleep(rateLimitMs);
      _log('INFO', `Batch ${Math.ceil((batchStart + CONCURRENCY) / CONCURRENCY)} done (${batchStart + CONCURRENCY}/${watchlist.stocks.length})`);
    }
  }

  const manifest = {
    pulled_at: new Date().toISOString(),
    watchlist_version: watchlist._meta && watchlist._meta.version,
    n_total: watchlist.stocks.length,
    n_ok: results.length,
    n_failed: failures.length,
    results,
    failures
  };
  fs.writeFileSync(path.join(outputDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
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
  const watchlist = JSON.parse(fs.readFileSync(args.watchlist, 'utf8'));
  if (!watchlist.stocks || !Array.isArray(watchlist.stocks)) {
    _log('ERROR', 'Watchlist must have .stocks array');
    process.exit(1);
  }
  const manifest = await pullAll(watchlist, args.output, args.rateLimit);
  process.exit(manifest.n_failed > manifest.n_total / 2 ? 1 : 0);
}

if (require.main === module) {
  main().catch(e => {
    _log('FATAL', e.stack || e.message);
    process.exit(1);
  });
}

module.exports = { mapYahooToCanonical, pullAll };
