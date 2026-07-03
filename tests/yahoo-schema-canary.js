#!/usr/bin/env node
/**
 * Tag 220c (audit F-219c): Yahoo Schema Drift Canary.
 *
 * Why: The Tag 204 ADR-fix bug (Tag 219c F1 CRITICAL) is the textbook case
 * for needing this. A field that USED to exist — `price.financialCurrency` —
 * silently disappeared from Yahoo's API somewhere between Tag 204's commit
 * and 2026-05-17. NO test fired. For ~weeks, every ADR was getting the wrong
 * reporting currency, mis-FX-converting financials by ~30x. A daily canary
 * would have caught this within 24 hours.
 *
 * What this script does:
 *   For BOTH anchor tickers ('NVDA' and 'TSM'):
 *     1. Makes ONE call to yf.quoteSummary(ANCHOR, { modules: <all-modules> })
 *        and validates that critical quoteSummary fields are present with
 *        expected types (via getPath + checkType + SCHEMA_EXPECTATIONS).
 *     2. Makes TWO fundamentalsTimeSeries (FTS) calls (financials + cash-flow)
 *        and validates the LATEST period row carries the fields pull-yahoo
 *        depends on. FTS returns an ARRAY of period rows OLDEST-FIRST, so the
 *        latest is rows[rows.length-1]. FTS is NOT quoteSummary-shaped, so it
 *        does NOT use getPath (that would false-fire) — it uses _ftsValue, the
 *        verbatim helper from pull-yahoo.js, + Number.isFinite.
 *   Per-anchor, per-field alerting: ANY single (anchor, field) failure => exit(1).
 *   The two anchors do NOT have to agree (the financialCurrency-divergence bug
 *   is ADR-only and shows ONLY on TSM, whose financialCurrency is TWD != USD).
 *
 * Self-contained:
 *   No dependency on methods/, no dependency on pull-yahoo's internals.
 *   Only `yahoo-finance2`. Runs in ~10-15 seconds (2 anchors × ~3 calls each).
 *
 * Exit codes:
 *   0 = all invariants OK (or Yahoo unreachable after one retry — NON-FATAL).
 *   1 = genuine schema drift: a field is missing/wrong on an anchor.
 *   2 = NEVER the final exit code from a thrown call: a thrown yf call means
 *       "Yahoo unreachable"; the whole run is retried ONCE in-process, and if
 *       it still throws we emit a ::warning:: and exit 0 (Yahoo-down must not
 *       be treated as drift).
 *
 * Run:
 *   & "C:\Program Files\nodejs\node.exe" tests/yahoo-schema-canary.js
 */
'use strict';

const YF = require('yahoo-finance2').default;
const yf = new YF({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false, logOptionsErrors: false }
});

// Anchor tickers. NVDA is the best-covered name and stable across most modules.
// TSM is included specifically because its reporting currency is TWD (!= USD),
// which is the ONLY anchor that exercises the financialData.financialCurrency
// divergence bug (Tag 219c F1) — a USD-reporting anchor like NVDA would mask it.
const ANCHORS = ['NVDA', 'TSM'];

// All modules pull-yahoo.js currently uses. Keep in sync with MODULES in
// pull-yahoo.js line ~77. If pull-yahoo adds/removes modules, this list
// should follow.
const MODULES = [
  'summaryDetail',
  'financialData',
  'defaultKeyStatistics',
  'incomeStatementHistory',
  'balanceSheetHistory',
  'cashflowStatementHistory',
  'incomeStatementHistoryQuarterly',
  'price',
  'assetProfile',
  'insiderTransactions',
  'earningsTrend',
  'majorHoldersBreakdown',  // Tag 220c F6
  'earningsHistory'         // Tag 220c F7
];

// Schema expectations: every field pull-yahoo silently depends on. If Yahoo
// moves or renames any of these (as they did with `financialCurrency`
// per Tag 219c F1), the canary fires within 24h instead of corrupting data
// for weeks.
//
// Kind one of: 'number', 'string', 'date', 'array', 'object'.
const SCHEMA_EXPECTATIONS = [
  // price module
  { path: 'price.currency',                          type: 'string' },
  { path: 'price.regularMarketPrice',                type: 'number' },
  { path: 'price.exchangeName',                      type: 'string' },
  // financialData — note: financialCurrency MOVED here from price (Tag 219c F1)
  { path: 'financialData.financialCurrency',         type: 'string' },
  { path: 'financialData.ebitda',                    type: 'number' },
  { path: 'financialData.freeCashflow',              type: 'number' },
  { path: 'financialData.totalRevenue',              type: 'number' },
  { path: 'financialData.revenueGrowth',             type: 'number' },  // pull-yahoo line 675
  { path: 'financialData.debtToEquity',              type: 'number' },  // Tag 220c F8
  { path: 'financialData.currentRatio',              type: 'number' },  // Tag 220c F8
  // summaryDetail
  { path: 'summaryDetail.marketCap',                 type: 'number' },
  { path: 'summaryDetail.priceToSalesTrailing12Months', type: 'number' },
  // defaultKeyStatistics
  { path: 'defaultKeyStatistics.sharesOutstanding',  type: 'number' },  // Tag 219 F5
  { path: 'defaultKeyStatistics.enterpriseValue',    type: 'number' },  // Tag 219 F3
  { path: 'defaultKeyStatistics.enterpriseToEbitda', type: 'number' },  // Tag 219 F3
  { path: 'defaultKeyStatistics.mostRecentQuarter',  type: 'date' },    // Tag 220c F9
  // assetProfile
  { path: 'assetProfile.sector',                     type: 'string' },
  { path: 'assetProfile.industry',                   type: 'string' },
  { path: 'assetProfile.country',                    type: 'string' },  // Tag 220c F11
  // earningsTrend
  { path: 'earningsTrend.trend',                     type: 'array' },
  // majorHoldersBreakdown (Tag 220c F6)
  { path: 'majorHoldersBreakdown.institutionsCount', type: 'number' },
  // earningsHistory (Tag 220c F7)
  { path: 'earningsHistory.history',                 type: 'array' }
];

function getPath(obj, dotPath) {
  return dotPath.split('.').reduce((cur, key) => {
    if (cur == null) return cur;
    return cur[key];
  }, obj);
}

// Verbatim copy of pull-yahoo.js _ftsValue (kept inline so the canary stays
// self-contained — only requires yahoo-finance2). fundamentalsTimeSeries rows
// are camelCase but Yahoo occasionally emits snake_case edge nodes, so we try
// both. Returns the first non-null hit, else null.
function _ftsValue(row, ...keys) {
  if (!row) return null;
  for (const k of keys) {
    if (row[k] != null) return row[k];
    const snake = k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
    if (snake !== k && row[snake] != null) return row[snake];
  }
  return null;
}

function checkType(value, kind) {
  if (value == null) return false;
  switch (kind) {
    case 'number':
      // Unwrap {raw, fmt} envelope occasionally returned by yahoo-finance2.
      if (typeof value === 'object' && 'raw' in value) value = value.raw;
      return Number.isFinite(value);
    case 'string':
      return typeof value === 'string' && value.length > 0;
    case 'date':
      if (value instanceof Date) return !Number.isNaN(value.getTime());
      if (typeof value === 'string') return !Number.isNaN(Date.parse(value));
      if (typeof value === 'number') return Number.isFinite(value) && value > 0;
      return false;
    case 'array':
      return Array.isArray(value) && value.length > 0;
    case 'object':
      return typeof value === 'object' && value !== null;
    default:
      return false;
  }
}

// Sentinel thrown by a yf call when Yahoo is unreachable. Distinguishes the
// exit(2) "retry the whole run" path from genuine drift (exit 1).
class YahooUnreachable extends Error {
  constructor(message) { super(message); this.name = 'YahooUnreachable'; }
}

// Number.isFinite after unwrapping the {raw, fmt} envelope yahoo-finance2
// sometimes returns. FTS rows are usually plain numbers, but stay defensive.
function _finite(v) {
  if (v != null && typeof v === 'object' && 'raw' in v) v = v.raw;
  return Number.isFinite(v);
}

// Run ALL checks (quoteSummary modules + 2 FTS calls) for one anchor.
// Pushes one human-readable string per FAILED (anchor, field) into `failures`.
// Throws YahooUnreachable if any yf call throws (Yahoo down — caller retries).
async function checkAnchor(anchor, failures, warnings) {
  // ── 1. quoteSummary ───────────────────────────────────────────────────
  console.log('[canary] ' + anchor + ': quoteSummary with ' + MODULES.length + ' modules...');
  let payload;
  try {
    payload = await yf.quoteSummary(anchor, { modules: MODULES });
  } catch (e) {
    throw new YahooUnreachable('quoteSummary(' + anchor + ') threw: ' + e.message);
  }
  if (!payload || typeof payload !== 'object') {
    // A non-object payload is not "Yahoo down" — it's a genuine schema break.
    failures.push(anchor + ': quoteSummary returned a non-object payload (' + typeof payload + ')');
    return;
  }

  for (const { path: p, type } of SCHEMA_EXPECTATIONS) {
    const v = getPath(payload, p);
    if (checkType(v, type)) {
      console.log('  OK   ' + (anchor + '.' + p).padEnd(56) + ' (' + type + ')');
    } else {
      let preview;
      try { preview = JSON.stringify(v); } catch (_) { preview = String(v); }
      if (preview && preview.length > 80) preview = preview.slice(0, 77) + '...';
      failures.push(anchor + '.' + p + ' expected ' + type + ', got ' + (typeof v) + '=' + preview);
    }
  }

  // TSM-only: financialCurrency must be a non-empty string (HARD — already
  // covered by SCHEMA_EXPECTATIONS, but assert explicitly here so the TSM
  // currency-divergence invariant is self-documenting at the anchor level),
  // and as a WARNING-only secondary, financialCurrency !== price.currency
  // (TSM reports in TWD but trades as a USD ADR — the Tag 219c F1 divergence).
  if (anchor === 'TSM') {
    const finCur = getPath(payload, 'financialData.financialCurrency');
    const priceCur = getPath(payload, 'price.currency');
    if (!(typeof finCur === 'string' && finCur.length > 0)) {
      failures.push(anchor + '.financialData.financialCurrency expected non-empty string, got ' +
        (typeof finCur) + '=' + JSON.stringify(finCur));
    } else if (finCur === priceCur) {
      // WARNING-only: does NOT contribute to exit 1.
      warnings.push(anchor + ': financialData.financialCurrency (' + finCur +
        ') === price.currency (' + priceCur + ') — expected divergence (TWD != USD) is GONE; ' +
        'either Yahoo changed TSM\'s ADR mapping or the financialCurrency field moved again');
    } else {
      console.log('  OK   ' + (anchor + ' financialCurrency=' + finCur + ' != price.currency=' + priceCur).padEnd(56) +
        ' (divergence intact)');
    }
  }

  // ── 2. fundamentalsTimeSeries (NOT quoteSummary-shaped → no getPath) ─────
  // FTS returns an ARRAY of period rows OLDEST-FIRST; use the LATEST row.
  const period1 = new Date(Date.now() - 5 * 365 * 86400 * 1000);
  const period2 = new Date();

  // 2a. financials module: totalRevenue, shares, SGA.
  let finRows;
  try {
    finRows = await yf.fundamentalsTimeSeries(anchor, { period1, period2, type: 'annual', module: 'financials' });
  } catch (e) {
    throw new YahooUnreachable('fundamentalsTimeSeries(' + anchor + ', financials) threw: ' + e.message);
  }
  if (!Array.isArray(finRows) || finRows.length === 0) {
    failures.push(anchor + ': fundamentalsTimeSeries(financials) returned an empty array (rows.length===0) — drift');
  } else {
    const r = finRows[finRows.length - 1];  // latest = oldest-first array's last
    const fields = [
      ['totalRevenue', _ftsValue(r, 'totalRevenue', 'TotalRevenue')],
      ['shares',       _ftsValue(r, 'dilutedAverageShares', 'basicAverageShares')],
      ['SGA',          _ftsValue(r, 'sellingGeneralAndAdministration', 'SellingGeneralAndAdministration')]
    ];
    for (const [name, val] of fields) {
      if (_finite(val)) {
        console.log('  OK   ' + (anchor + '.FTS.financials.' + name).padEnd(56) + ' (finite)');
      } else {
        let preview;
        try { preview = JSON.stringify(val); } catch (_) { preview = String(val); }
        failures.push(anchor + '.FTS.financials.' + name + ' expected finite number, got ' +
          (typeof val) + '=' + preview);
      }
    }
  }

  // 2b. cash-flow module: operatingCashFlow, FCF (with op+capex fallback), depreciation.
  let cashRows;
  try {
    cashRows = await yf.fundamentalsTimeSeries(anchor, { period1, period2, type: 'annual', module: 'cash-flow' });
  } catch (e) {
    throw new YahooUnreachable('fundamentalsTimeSeries(' + anchor + ', cash-flow) threw: ' + e.message);
  }
  if (!Array.isArray(cashRows) || cashRows.length === 0) {
    failures.push(anchor + ': fundamentalsTimeSeries(cash-flow) returned an empty array (rows.length===0) — drift');
  } else {
    const r = cashRows[cashRows.length - 1];  // latest = oldest-first array's last
    const ocf = _ftsValue(r, 'operatingCashFlow', 'OperatingCashFlow');
    const fcfDirect = _ftsValue(r, 'freeCashFlow', 'FreeCashFlow');
    const capex = _ftsValue(r, 'capitalExpenditure', 'CapitalExpenditure');
    const dep = _ftsValue(r, 'depreciationAndAmortization', 'depreciationAmortizationDepletion', 'DepreciationAndAmortization');

    // operatingCashFlow must be finite.
    if (_finite(ocf)) {
      console.log('  OK   ' + (anchor + '.FTS.cash-flow.operatingCashFlow').padEnd(56) + ' (finite)');
    } else {
      failures.push(anchor + '.FTS.cash-flow.operatingCashFlow expected finite number, got ' +
        (typeof ocf) + '=' + JSON.stringify(ocf));
    }

    // FCF present = freeCashFlow finite OR (op finite AND capex finite).
    // Mirrors pull-yahoo's op+capex FCF fallback so a legitimately-absent
    // freeCashFlow does NOT false-fire.
    const fcfPresent = _finite(fcfDirect) || (_finite(ocf) && _finite(capex));
    if (fcfPresent) {
      const via = _finite(fcfDirect) ? 'direct' : 'op+capex fallback';
      console.log('  OK   ' + (anchor + '.FTS.cash-flow.FCF (' + via + ')').padEnd(56) + ' (finite)');
    } else {
      failures.push(anchor + '.FTS.cash-flow.FCF absent: freeCashFlow=' + JSON.stringify(fcfDirect) +
        ' not finite AND op+capex fallback unavailable (op=' + JSON.stringify(ocf) +
        ', capex=' + JSON.stringify(capex) + ')');
    }

    // depreciation must be finite.
    if (_finite(dep)) {
      console.log('  OK   ' + (anchor + '.FTS.cash-flow.depreciation').padEnd(56) + ' (finite)');
    } else {
      failures.push(anchor + '.FTS.cash-flow.depreciation expected finite number, got ' +
        (typeof dep) + '=' + JSON.stringify(dep));
    }
  }
}

// One full pass over all anchors. Returns { failures, warnings }.
// Re-throws YahooUnreachable so run() can decide whether to retry.
async function runOnce() {
  const failures = [];
  const warnings = [];
  for (const anchor of ANCHORS) {
    await checkAnchor(anchor, failures, warnings);
  }
  return { failures, warnings };
}

async function run() {
  let result;
  try {
    result = await runOnce();
  } catch (e) {
    if (e instanceof YahooUnreachable) {
      // exit(2)-class: a yf call THREW (Yahoo unreachable). Retry the whole
      // run ONCE in-process before deciding it's down.
      console.error('[canary] Yahoo unreachable on first pass (' + e.message + ') — retrying once...');
      try {
        result = await runOnce();
      } catch (e2) {
        if (e2 instanceof YahooUnreachable) {
          console.warn('::warning::SCHEMA-CANARY: Yahoo unreachable on both attempts (' + e2.message +
            '). Treating as Yahoo-down (NON-FATAL), NOT schema drift. Exit 0.');
          process.exit(0);
        }
        throw e2;  // unexpected error type — let the top-level guard exit(2)
      }
    } else {
      throw e;  // unexpected error type — let the top-level guard exit(2)
    }
  }

  const { failures, warnings } = result;

  // WARNING-only diagnostics (do NOT affect exit code).
  for (const w of warnings) {
    console.warn('::warning::SCHEMA-CANARY: ' + w);
  }

  console.log('');
  if (failures.length === 0) {
    console.log('[canary] PASS — all invariants OK across ' + ANCHORS.join(', ') + '.');
    process.exit(0);
  }

  // Genuine drift: emit one ::error:: per failed (anchor, field), then exit 1.
  for (const f of failures) {
    console.error('::error::SCHEMA-DRIFT ' + f);
  }
  console.error('::error::' + failures.length + ' Yahoo schema invariant(s) failed across ' +
    ANCHORS.join(', ') + ' — pull-yahoo extraction may be silently corrupted.');
  process.exit(1);
}

if (require.main === module) {
  run().catch(e => {
    // Anything reaching here is an unexpected (non-Yahoo-down, non-drift)
    // crash — treat as exit(2)-class (unreachable / infrastructural), NOT drift.
    console.error('::error::CANARY UNCAUGHT: ' + (e.stack || e.message));
    process.exit(2);
  });
}

module.exports = { SCHEMA_EXPECTATIONS, MODULES, ANCHORS, getPath, checkType, _ftsValue };
