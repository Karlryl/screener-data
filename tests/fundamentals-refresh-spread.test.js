'use strict';
/**
 * Refresh spread (2026-09-26): pins admitTimeRefreshes() in pull-yahoo.js and its wiring into pullAll.
 * Per run and shard, at most ceil(young snapshots / FUNDAMENTALS_REFRESH_SPREAD) sole-cause time-based
 * full pulls, oldest fundamentals clock first; the rest goes price-only and is first in line next run.
 *
 * Offline: yahoo-finance2 is stubbed on its prototype BEFORE pull-yahoo.js loads — a quote succeeds
 * (price-only path), a quoteSummary (= full pull) is recorded and refused.
 *
 * Usage:  node tests/fundamentals-refresh-spread.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const YF = require('yahoo-finance2').default;
const fullPulls = [];
let quotes = 0;
YF.prototype.quote = async () => { quotes++; return { regularMarketPrice: 10, marketCap: 5e9, currency: 'USD' }; };
YF.prototype.quoteSummary = async (symbol) => { fullPulls.push(symbol); throw new Error('offline stub: full pull refused'); };

const { admitTimeRefreshes, FUNDAMENTALS_REFRESH_SPREAD, pullAll } = require('../pull-yahoo.js');

const DAY = 864e5;
const REFRESH = 30 * DAY;
const NOW = Date.parse('2026-09-29T08:30:00Z');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

(async () => {
  await test('boundary: clock exactly 30 d old is not due, 30 d + 1 ms is due (same > as fundamentalsStaleness)', () => {
    const r = admitTimeRefreshes([
      { ticker: 'EXACT', clockMs: NOW - REFRESH },
      { ticker: 'OVER', clockMs: NOW - REFRESH - 1 },
    ], NOW, 1, REFRESH);
    assert.equal(r.due, 1);
    assert.deepEqual([...r.admitted], ['OVER']);
  });

  await test('cap = ceil(slice / divisor), filled oldest clock first', () => {
    const entries = [];
    for (let k = 0; k < 33; k++) entries.push({ ticker: 'T' + String(k).padStart(2, '0'), clockMs: NOW - REFRESH - (k + 1) * 3600e3 });
    const r = admitTimeRefreshes(entries, NOW, 16, REFRESH);
    assert.equal(r.cap, 3);                                   // ceil(33 / 16)
    assert.equal(r.due, 33);
    assert.deepEqual([...r.admitted].sort(), ['T30', 'T31', 'T32']);
    assert.equal(r.oldestDeferredClockMs, NOW - REFRESH - 30 * 3600e3);   // T29 is next in line
  });

  await test('deterministic: input order does not matter, equal clocks break on the ticker', () => {
    const same = NOW - 40 * DAY;
    const a = [{ ticker: 'B', clockMs: same }, { ticker: 'A', clockMs: same }, { ticker: 'C', clockMs: same },
      { ticker: 'D', clockMs: NOW - DAY }];
    const r1 = admitTimeRefreshes(a, NOW, 4, REFRESH);
    const r2 = admitTimeRefreshes([a[3], a[2], a[0], a[1]], NOW, 4, REFRESH);
    assert.deepEqual([...r1.admitted], ['A']);                // cap ceil(4/4) = 1
    assert.deepEqual([...r2.admitted], ['A']);
  });

  await test('an unreadable clock counts as due and oldest (never parked behind readable ones)', () => {
    const r = admitTimeRefreshes([
      { ticker: 'OLD', clockMs: NOW - 90 * DAY },
      { ticker: 'NOCLOCK', clockMs: NaN },
    ], NOW, 2, REFRESH);
    assert.deepEqual([...r.admitted], ['NOCLOCK']);
    assert.equal(r.due, 2);
  });

  await test('progress: a 160-ticker backlog drains oldest first in exactly ceil(160/10) runs, fresh ones never admitted', () => {
    const clock = new Map();
    for (let k = 0; k < 160; k++) clock.set('B' + String(k).padStart(3, '0'), NOW - REFRESH - (k + 1) * 60e3);
    for (let k = 0; k < 40; k++) clock.set('F' + String(k).padStart(3, '0'), NOW - 5 * DAY);
    const runOf = new Map();
    for (let run = 0; run < 25; run++) {
      const now = NOW + run * DAY;
      const r = admitTimeRefreshes([...clock].map(([ticker, clockMs]) => ({ ticker, clockMs })), now, 20, REFRESH);   // cap ceil(200/20) = 10
      for (const t of r.admitted) { assert.ok(!runOf.has(t), t + ' admitted twice'); runOf.set(t, run); clock.set(t, now); }
      if (run === 15) assert.equal(runOf.size, 160, 'backlog not drained after 16 runs');
    }
    for (let k = 0; k < 160; k++) assert.equal(runOf.get('B' + String(k).padStart(3, '0')), Math.floor((159 - k) / 10), 'B' + k + ' out of oldest-first order');
    // The 40 fresh clocks (5 d at run 0) come due at run 25 at the earliest: none may be admitted early.
    for (let k = 0; k < 40; k++) assert.ok(!runOf.has('F' + String(k).padStart(3, '0')), 'fresh F' + k + ' admitted before due');
  });

  await test('wiring: pullAll full-pulls only the oldest ceil(n/SPREAD) time-stale snapshots plus free rides, the rest go price-only', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-spread-'));
    try {
      const now = Date.now();
      const stocks = [];
      const write = (ticker, fundamentalsAgeDays, incomplete) => {
        const iso = (ms) => new Date(ms).toISOString();
        const snap = {
          identifier: { ticker },
          meta: { ticker, fetchedAt: iso(now - fundamentalsAgeDays * DAY), asOf: iso(now - 3600e3),
            fundamentalsAsOf: iso(now - fundamentalsAgeDays * DAY), reportingCurrency: 'USD', tradingCurrency: 'USD',
            ...(incomplete ? { fundamentalsIncomplete: true } : {}) },
          marketCap: { value: 5e9 },
          price: { regularMarketPrice: 10, currency: 'USD' },
          annual: { annualRev: [{ value: 1e9 }], annualBalance: [{ currentAssets: 1 }] },
        };
        fs.writeFileSync(path.join(dir, ticker + '.json'), JSON.stringify(snap));
        stocks.push({ ticker, yahoo_symbol: ticker, name: ticker });
      };
      for (let i = 0; i < 20; i++) write('ZZSTALE' + String(i).padStart(2, '0'), 40 + i);   // time-stale, oldest = 19
      for (let i = 0; i < 10; i++) write('ZZFRESH' + String(i).padStart(2, '0'), 5);
      write('ZZINCOMPLETE', 1, true);   // free ride (needsFullPull): must full-pull regardless of the spread
      const cap = Math.ceil(31 / FUNDAMENTALS_REFRESH_SPREAD);
      fullPulls.length = 0; quotes = 0;
      await pullAll({ stocks, _meta: { version: 'test' } }, dir, 0);
      const expected = ['ZZINCOMPLETE'];
      for (let i = 19; i > 19 - cap; i--) expected.push('ZZSTALE' + String(i).padStart(2, '0'));
      assert.deepEqual(fullPulls.slice().sort(), expected.sort(), 'full pulls != the free ride + the ' + cap + ' oldest clocks');
      assert.equal(quotes, 31 - 1 - cap, 'every other ticker must take the price-only path');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  console.log(`fundamentals-refresh-spread: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
