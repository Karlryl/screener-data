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
 *   Makes ONE call to yf.quoteSummary('NVDA', { modules: <all-modules> })
 *   and validates that critical fields are present with expected types.
 *   Fails (exits 1, emits ::error::) on any assertion failure.
 *
 * Self-contained:
 *   No dependency on methods/, no dependency on pull-yahoo's internals.
 *   Only `yahoo-finance2`. Runs in ~3-5 seconds.
 *
 * Intended use:
 *   Daily CI canary step (separate workflow or part of daily-pull.yml).
 *   Wiring is INTENTIONALLY left out of daily-pull.yml in this commit —
 *   that's a separate decision Karl should make explicitly. A drift here
 *   should WARN, not block daily-pull (which has its own multi-anchor
 *   fallback handling).
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

// Anchor ticker. NVDA is the best-covered name and stable across most modules.
// Single ticker keeps the canary cheap (~one quoteSummary call + 4 FTS calls
// = ~10s wall-clock). For broader coverage, run against multiple anchors in
// a follow-up.
const ANCHOR = 'NVDA';

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

async function run() {
  console.log('[canary] Pulling quoteSummary(' + ANCHOR + ') with ' + MODULES.length + ' modules...');
  let payload;
  try {
    payload = await yf.quoteSummary(ANCHOR, { modules: MODULES });
  } catch (e) {
    console.error('::error::Yahoo quoteSummary call itself failed for ' + ANCHOR + ': ' + e.message);
    process.exit(2);
  }
  if (!payload || typeof payload !== 'object') {
    console.error('::error::Yahoo quoteSummary returned a non-object payload (' + typeof payload + ')');
    process.exit(2);
  }
  let failed = 0;
  let passed = 0;
  for (const { path: p, type } of SCHEMA_EXPECTATIONS) {
    const v = getPath(payload, p);
    const ok = checkType(v, type);
    if (ok) {
      passed++;
      console.log('  OK   ' + p.padEnd(50) + ' (' + type + ')');
    } else {
      failed++;
      // Truncate value preview for log readability.
      let preview;
      try { preview = JSON.stringify(v); } catch (_) { preview = String(v); }
      if (preview && preview.length > 80) preview = preview.slice(0, 77) + '...';
      console.error('::error::SCHEMA-DRIFT ' + ANCHOR + '.' + p +
        ' expected ' + type + ', got ' + (typeof v) + '=' + preview);
    }
  }
  console.log('');
  console.log('[canary] ' + passed + ' / ' + SCHEMA_EXPECTATIONS.length + ' invariants OK; ' +
    failed + ' failed.');
  if (failed > 0) {
    console.error('::error::' + failed + ' Yahoo schema invariant(s) failed on ' + ANCHOR +
      ' — pull-yahoo extraction may be silently corrupted.');
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  run().catch(e => {
    console.error('::error::CANARY UNCAUGHT: ' + (e.stack || e.message));
    process.exit(2);
  });
}

module.exports = { SCHEMA_EXPECTATIONS, MODULES, getPath, checkType };
