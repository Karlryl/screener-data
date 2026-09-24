'use strict';

// Run standalone: node tests/cov-lib-reine-zweige.test.js
// Additional coverage for pure helpers; all file fixtures are synthetic OS-temp data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { rankIC, hitRate, _median, cohortSpread, quintileMonotonicity } = require('../lib/metrics.js');
const { classify, resolveWindow, EXIT_STALE_FLAG_BUSINESS_DAYS } = require('../lib/forward-returns.js');
const { loadWatchlist } = require('../lib/watchlist-fs.js');
const { detectNewestQtrSuspect } = require('../lib/newest-qtr-guard.js');
const { detectAnnualCurrencyLeak } = require('../lib/annual-currency-guard.js');
const ROOT = path.resolve(__dirname, '..');
let assertions = 0;
function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions++;
}

// A: ranking metrics, including tie order that changes the numeric result.
check(_median([]), null, 'empty median');
check(_median(null), null, 'null median');
check(_median([9, 1, 3]), 3, 'odd-length median');
const medianInput = Object.freeze([8, 2, 6, 4]);
check(_median(medianInput), 5, 'even-length median averages the middle values');
check(medianInput, [8, 2, 6, 4], 'median does not mutate input');
const entries = [
  { ticker: 'D', score: 1 }, { ticker: 'A', score: 10 },
  { ticker: 'B', score: 9 }, { ticker: 'C', score: 8 },
];
check(hitRate(entries, { A: 4, B: 1, C: 3, D: 2 }, 2), { hitRate: 0.5, n: 2 },
  'top two scores have one return above the universe median');
check(hitRate(entries, {}, 2), { hitRate: null, n: 0 }, 'empty return universe');
check(hitRate([{ ticker: 'BAD', score: NaN }, { ticker: 'A', score: 1 }],
  { BAD: 0, A: 5, OTHER: 1 }, 1), { hitRate: 1, n: 1 }, 'NaN score cannot claim the top slot');
check(hitRate([{ ticker: 'BAD', score: null }, { ticker: 'A', score: 1 }],
  { BAD: 0, A: 5, OTHER: 1 }, 1), { hitRate: 1, n: 1 }, 'null score cannot claim the top slot');
const ties = [{ ticker: 'B', score: 1 }, { ticker: 'A', score: 1 }];
check(hitRate(ties, { A: 4, B: 0 }, 1), { hitRate: 1, n: 1 },
  'ticker A wins the score tie even when B appears first');
check(hitRate([{ ticker: 'A', score: 1 }], { A: 2, B: 1, C: 3 }, 1),
  { hitRate: 0, n: 1 }, 'return equal to median is not a hit');
const ten = Array.from({ length: 10 }, (_, i) => ({ ticker: 'T' + i, score: 10 - i }));
const tenReturns = Object.fromEntries(ten.map((e, i) => [e.ticker, i]));
check(hitRate(ten, tenReturns), { hitRate: 3 / 8, n: 8 }, 'default cohort size is eight');
check(hitRate(entries, { OTHER: 5 }, 2), { hitRate: null, n: 0 }, 'no selected name has a return');
check(hitRate(entries, { A: null, B: NaN, C: 4, D: undefined, OTHER: 0 }, 2),
  { hitRate: 1, n: 1 }, 'count includes only names with finite returns');
check(cohortSpread(ties, { A: 4, B: 0 }, { cohortN: 1 }),
  { spread: 2, cohortMean: 4, universeMedian: 2, cohortN_used: 1, universeN: 2 },
  'cohort score ties use ticker order and an even-length universe median');
check(cohortSpread(entries, { OTHER: 5 }, { cohortN: 2 }),
  { spread: null, cohortMean: null, universeMedian: null, cohortN_used: 0, universeN: 1 },
  'cohort without finite returns');
check(cohortSpread(entries, {}, { cohortN: 2 }),
  { spread: null, cohortMean: null, universeMedian: null, cohortN_used: 0, universeN: 0 },
  'empty universe and cohort');
check(cohortSpread(ten, tenReturns),
  { spread: -1, cohortMean: 3.5, universeMedian: 4.5, cohortN_used: 8, universeN: 10 },
  'default spread cohort size is eight');
const fiveTies = ['E', 'D', 'C', 'B', 'A'].map(ticker => ({ ticker, score: 1 }));
check(quintileMonotonicity(fiveTies, { A: 5, B: 4, C: 3, D: 2, E: 1 }),
  { quintileMeans: [5, 4, 3, 2, 1], monotoneScore: 1, tieRate: 0, spread: 4 },
  'ticker tie order determines the quintile means');
check(quintileMonotonicity(entries, { A: 1, B: 2, C: 3, D: 4 }),
  { quintileMeans: null, monotoneScore: null, tieRate: null, spread: null },
  'fewer than five usable entries cannot form quintiles');
check(quintileMonotonicity(fiveTies, { A: 0.01, B: 0.01, C: 0.01, D: 0.01, E: 0.01 }),
  { quintileMeans: [0.01, 0.01, 0.01, 0.01, 0.01], monotoneScore: 0, tieRate: 1, spread: 0 },
  'flat quintiles are ties, not a monotone signal');
check(rankIC([{ ticker: 'A', score: 1 }, { ticker: 'B', score: 2 }, { ticker: 'C', score: 3 }],
  { A: 1, B: 2, C: 3 }), { ic: 1, n: 3, dropped: 0 }, 'positive rank correlation');
check(rankIC([{ ticker: 'A', score: NaN }], { A: 1 }), { ic: null, n: 0, dropped: 1 },
  'rank correlation cannot be computed after dropping all scores');

// B: benchmark windows use synthetic calendar-day prices only.
const spy = new Map(Array.from({ length: 120 }, (_, i) => [
  new Date(Date.UTC(2025, 2, 3 + i)).toISOString().slice(0, 10), 100 + i,
]));
const expectedWindow = {
  insufficient: false, entryDate: '2025-03-03', exitDate: '2025-05-26',
  benchmarkTicker: 'SPY', horizonActualDays: 84,
};
check(resolveWindow({ SPY: spy }, '2025-03-03', 84), expectedWindow, 'complete benchmark window');
const timedWindow = resolveWindow({ SPY: spy }, '2025-03-03T09:30:00Z', 84);
check(timedWindow, expectedWindow, 'timestamp is truncated to its ISO date');
check(timedWindow.exitDate > timedWindow.entryDate, true, 'exit follows entry');
check(timedWindow.horizonActualDays >= 79 && timedWindow.horizonActualDays <= 89, true,
  'actual horizon remains within the documented snapping window');
const warnings = [];
const originalWarn = console.warn;
try {
  console.warn = (...args) => warnings.push(args.join(' '));
  check(resolveWindow({}, '2025-03-03', 84), { insufficient: true }, 'missing benchmark');
  check(resolveWindow({ SPY: new Map(Array.from(spy).slice(0, 3)) }, '2025-03-03', 84),
    { insufficient: true }, 'three benchmark prices cannot anchor an 84-day window');
} finally {
  console.warn = originalWarn;
}
check(warnings.length, 2, 'both missing/insufficient benchmark conditions remain visible');
const index = { AAA: new Map([['2025-03-03', 100], ['2025-03-10', 110]]) };
const stale = classify(index, 'AAA', '2025-03-06', '2025-03-12');
check(stale.status, 'ok', 'in-range stale prices still produce an observation');
check(stale.resolvedEntryDate, '2025-03-03', 'entry resolves backward by three days');
check(stale.resolvedExitDate, '2025-03-10', 'exit resolves backward by two days');
check(stale.entryStaleDays, 3, 'entry staleness is measured in business days');
check(stale.exitStaleDays, 2, 'exit staleness at the flag boundary');
check(EXIT_STALE_FLAG_BUSINESS_DAYS, 2, 'documented stale-flag threshold');
check(stale.entryStale, true, 'three business days exceeds the threshold');
check(stale.exitStale, false, 'exactly two business days does not exceed the threshold');
check(stale.horizonActualDays, 7, 'actual horizon uses both resolved dates');
check(Math.abs(stale.ret - 0.1) < 1e-12, true, 'return is computed from the resolved prices');
check(classify(index, 'MISSING', '2025-03-03', '2025-03-10'),
  { status: 'no_series', ret: null }, 'absent ticker series');
check(classify(index, 'AAA', '2025-02-01', '2025-03-10'),
  { status: 'no_entry_price', ret: null }, 'entry has no recent price');
// Defensive _resolvedDate failure and delisted branches cannot arise with normal Maps;
// do not manufacture inconsistent Maps to force those paths.

// C: execute the existing selftest unchanged, preserving coverage inheritance.
const selftest = spawnSync(process.execPath, ['lib/read-json.js'], {
  cwd: ROOT, env: { ...process.env }, encoding: 'utf8', timeout: 3000,
});
check(selftest.error, undefined, 'JSON-reader selftest child completed');
check(selftest.status, 0, 'JSON-reader selftest exit code');
check(selftest.stdout.includes('lib/read-json.js selftest: ok'), true, 'JSON-reader selftest completion marker');

// D: parsed but unrecognized watchlists preserve raw input, unlike missing/broken JSON.
// These new fixtures are deliberately retained; this test performs no deletion.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-lib-pure-'));
for (const [name, raw] of [['string', 'nur-ein-string'], ['bad-stocks', { stocks: 5 }]]) {
  const file = path.join(dir, name + '.json');
  fs.writeFileSync(file, JSON.stringify(raw));
  check(loadWatchlist(file),
    { shape: 'invalid', stocks: [], size: 0, raw, error: 'unrecognized watchlist shape' },
    'existing ' + name + ' retains the parsed value in raw');
}
const goodPath = path.join(dir, 'good.json');
const good = { stocks: [{ ticker: 'AAA' }] };
fs.writeFileSync(goodPath, JSON.stringify(good));
check(loadWatchlist(goodPath),
  { shape: 'wrapped', stocks: good.stocks, size: 1, raw: good, error: null }, 'valid wrapped watchlist');
const missingPath = path.join(dir, 'missing.json');
check(loadWatchlist(missingPath),
  { shape: 'invalid', stocks: [], size: 0, raw: null, error: 'file not found: ' + missingPath },
  'missing file is distinct from unknown parsed shape');
const badPath = path.join(dir, 'broken.json');
fs.writeFileSync(badPath, '{');
const broken = loadWatchlist(badPath);
check(broken.raw, null, 'parse error has no parsed value');
check(broken.shape, 'invalid', 'parse error has invalid shape');
check(typeof broken.error, 'string', 'parse error is reported');

// E: malformed numeric envelopes behave exactly like null, without hiding thrown errors.
const quarterly = value => ({
  revenueQ: [value, 40, 40, 40, 40], opIncQ: [40, 4, 4, 4, 4],
  grossProfitQ: [70, 20, 20, 20, 20],
});
const annual = value => ({
  meta: { reportingCurrencyOriginal: 'USD', tradingCurrency: 'NOK' },
  annual: { annualRev: [value] }, timeseries: { revenueQ: [25, 25, 25, 25] },
  metrics: { revenueTTM: { value: 100 } },
});
check(detectNewestQtrSuspect(quarterly(null)), { suspect: false, reason: null }, 'null newest revenue');
check(detectAnnualCurrencyLeak(annual(null)), { suspect: false, reason: null }, 'null annual revenue');
for (const value of [{ value: 'abc' }, {}, { value: NaN }]) {
  check(detectNewestQtrSuspect(quarterly(value)), detectNewestQtrSuspect(quarterly(null)),
    'invalid quarterly envelope equals null at the same position');
  check(detectAnnualCurrencyLeak(annual(value)), detectAnnualCurrencyLeak(annual(null)),
    'invalid annual envelope equals null at the same position');
}
check(detectNewestQtrSuspect(quarterly({ value: 100 })).suspect, true,
  'valid envelope still reaches the positive quarterly guard');
check(detectAnnualCurrencyLeak(annual({ value: 1000 })).suspect, true,
  'valid envelope still reaches the positive annual guard');

console.log(`cov-lib-reine-zweige: ${assertions} assertions passed`);
