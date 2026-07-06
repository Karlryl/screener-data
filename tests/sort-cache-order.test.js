// TASK 0.9 STRUKTUR-FIX (Tag 260) — sortByStaleness: un-snapshotted tickers must sort
// LAST so the Tag-259 snapshot cache actually accumulates coverage (cached young snapshots
// get price-only'd first — fast, counted in n_ok — before the budget expands into slow
// full pulls of new tickers). Run: node tests/sort-cache-order.test.js  (exit 0/1)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sortByStaleness, safeSnapshotFilename } = require('../pull-yahoo.js');

let fail = 0;
function check(name, got, want) {
  try { assert.strictEqual(got, want); console.log('  ok   ' + name + ' => ' + got); }
  catch (_) { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + want); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sort-cache-'));
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
function writeSnap(ticker, asOfMsAgo, fundAsOf) {
  const meta = { asOf: iso(asOfMsAgo) };
  if (fundAsOf) meta.fundamentalsAsOf = fundAsOf;
  fs.writeFileSync(path.join(dir, safeSnapshotFilename(ticker)), JSON.stringify({ meta }));
}

// CACHEDOLD: snapshot 10d old. CACHEDNEW: 1h old. NEW1/NEW2: no snapshot at all.
writeSnap('CACHEDOLD', 10 * 864e5);
writeSnap('CACHEDNEW', 3600e3);
const today = new Date(now);
const stocks = [{ ticker: 'NEW1' }, { ticker: 'CACHEDNEW' }, { ticker: 'CACHEDOLD' }, { ticker: 'NEW2' }];

const order = sortByStaleness(stocks, dir, {}, today).map(s => s.ticker);
const idx = (t) => order.indexOf(t);
console.log('       order:', order.join(', '));

// Cached (any) must precede un-snapshotted (both).
check('CACHEDOLD before NEW1', idx('CACHEDOLD') < idx('NEW1'), true);
check('CACHEDOLD before NEW2', idx('CACHEDOLD') < idx('NEW2'), true);
check('CACHEDNEW before NEW1', idx('CACHEDNEW') < idx('NEW1'), true);
check('CACHEDNEW before NEW2', idx('CACHEDNEW') < idx('NEW2'), true);
// Within cached: older snapshot first (oldest-first refresh preserved).
check('CACHEDOLD before CACHEDNEW (oldest-first within cached)', idx('CACHEDOLD') < idx('CACHEDNEW'), true);
// Un-snapshotted occupy the LAST two slots.
check('two un-snapshotted are last', idx('NEW1') >= 2 && idx('NEW2') >= 2, true);

// Earnings-forward: a cached ticker that reported since its last full pull jumps to age 0
// (front), ahead of an older-timestamp cached ticker with no new earnings.
writeSnap('CACHEDNEW', 3600e3, iso(60 * 864e5));   // fundamentalsAsOf 60d ago
const cal = { CACHEDNEW: { date: iso(2 * 864e5).slice(0, 10) } }; // reported 2d ago (> fundAsOf, <= today)
const order2 = sortByStaleness(stocks, dir, cal, today).map(s => s.ticker);
console.log('       order2 (earnings-forward):', order2.join(', '));
check('earnings-forward CACHEDNEW jumps ahead of CACHEDOLD', order2.indexOf('CACHEDNEW') < order2.indexOf('CACHEDOLD'), true);
check('earnings-forward still before un-snapshotted', order2.indexOf('CACHEDNEW') < order2.indexOf('NEW1'), true);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
console.log(fail === 0 ? '\nPASS (all assertions ok)' : `\nFAIL (${fail} assertion(s) failed)`);
process.exit(fail ? 1 : 0);
