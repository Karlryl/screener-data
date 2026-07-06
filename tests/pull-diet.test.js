// TASK 0.9 (Pull-Diät) — standalone test for the pure needsFullPull decision fn.
// No framework: assert, process.exit(fail?1:0). Run: node tests/pull-diet.test.js
const assert = require('assert');
const { needsFullPull } = require('../pull-yahoo.js');

const today = new Date('2026-07-06T00:00:00Z');
const meta = { fundamentalsAsOf: '2026-05-01T12:00:00Z' };

let fail = 0;
function check(name, got, want) {
  try {
    assert.strictEqual(got, want);
    console.log(`  ok   ${name} => ${got}`);
  } catch (_) {
    fail++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, want ${want}`);
  }
}

// date > fundamentalsAsOf AND <= today => 'full' (reported since last full pull)
check('reported-after-lastpull', needsFullPull(meta, { date: '2026-06-15' }, today), 'full');

// date < fundamentalsAsOf => 'price-only' (already have that report's financials)
check('reported-before-lastpull', needsFullPull(meta, { date: '2026-04-01' }, today), 'price-only');

// no earnings entry => 'price-only'
check('no-earnings-entry', needsFullPull(meta, undefined, today), 'price-only');
check('null-earnings-entry', needsFullPull(meta, null, today), 'price-only');
check('earnings-entry-no-date', needsFullPull(meta, {}, today), 'price-only');

// date in the future => 'price-only' (not yet reported)
check('future-earnings', needsFullPull(meta, { date: '2026-08-20' }, today), 'price-only');

// malformed meta => 'price-only', no throw
check('meta-null', needsFullPull(null, { date: '2026-06-15' }, today), 'price-only');
check('meta-undefined', needsFullPull(undefined, { date: '2026-06-15' }, today), 'price-only');
check('meta-no-fundamentalsAsOf', needsFullPull({}, { date: '2026-06-15' }, today), 'price-only');
check('meta-garbage-asOf', needsFullPull({ fundamentalsAsOf: 'not-a-date' }, { date: '2026-06-15' }, today), 'price-only');

// garbage earnings date => 'price-only', no throw
check('garbage-earnings-date', needsFullPull(meta, { date: 'xyz' }, today), 'price-only');
check('garbage-today', needsFullPull(meta, { date: '2026-06-15' }, 'not-a-date'), 'price-only');

// today accepted as string too (parity with Date)
check('today-as-string', needsFullPull(meta, { date: '2026-06-15' }, '2026-07-06'), 'full');

// edge: earnings exactly on today => 'full' (reported today, after May asOf)
check('earnings-equals-today', needsFullPull(meta, { date: '2026-07-06' }, today), 'full');

// edge: earnings date equals asOf day-portion but asOf has time → not strictly newer
check('earnings-equals-asOf-day', needsFullPull({ fundamentalsAsOf: '2026-06-15T00:00:00Z' }, { date: '2026-06-15' }, today), 'price-only');

// --- sortByStaleness earnings-recent prioritization (0.9a) ---
// Point outputDir at an empty temp dir so every ticker reads age=0 (no snapshot files);
// this isolates the earnings-recent priority group from the age tiebreak.
const { sortByStaleness } = require('../pull-yahoo.js');
const fs = require('fs');
const os = require('os');
const pathm = require('path');
const emptyDir = fs.mkdtempSync(pathm.join(os.tmpdir(), 'pull-diet-'));

// today ~ now (real Date used inside sortByStaleness). Use offsets from now so the
// window math (FUNDAMENTALS_REFRESH_DAYS default 30d) is deterministic.
const nowMs = Date.now();
const daysAgo = (n) => new Date(nowMs - n * 86400 * 1000).toISOString().slice(0, 10);
const daysAhead = (n) => new Date(nowMs + n * 86400 * 1000).toISOString().slice(0, 10);

const stocks = [
  { ticker: 'AAA' },  // no earnings entry            → normal
  { ticker: 'BBB' },  // reported 5d ago (in window)  → prioritized
  { ticker: 'CCC' },  // reports in 10d (future)      → normal
  { ticker: 'DDD' },  // reported 60d ago (past window)→ normal
  { ticker: 'EEE' },  // reported 2d ago (in window)  → prioritized
];
const cal = {
  BBB: { date: daysAgo(5) },
  CCC: { date: daysAhead(10) },
  DDD: { date: daysAgo(60) },
  EEE: { date: daysAgo(2) },
};
const ordered = sortByStaleness(stocks, emptyDir, cal).map(s => s.ticker);
// The two earnings-recent tickers (BBB, EEE) must occupy the first two slots (order
// between them is age-tiebroken and both age=0 → stable-ish; assert as a set).
const firstTwo = new Set(ordered.slice(0, 2));
check('sort-earnings-recent-front-BBB', firstTwo.has('BBB'), true);
check('sort-earnings-recent-front-EEE', firstTwo.has('EEE'), true);
check('sort-future-earnings-not-prioritized', firstTwo.has('CCC'), false);
check('sort-stale-earnings-not-prioritized', firstTwo.has('DDD'), false);
check('sort-no-earnings-not-prioritized', firstTwo.has('AAA'), false);
check('sort-preserves-all-tickers', ordered.length, 5);
try { fs.rmSync(emptyDir, { recursive: true, force: true }); } catch (_) {}

console.log(fail === 0 ? '\nPASS (all assertions ok)' : `\nFAIL (${fail} assertion(s) failed)`);
process.exit(fail ? 1 : 0);
