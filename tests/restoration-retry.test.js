'use strict';
// Real pullAll with virtual files/Yahoo. No disk writes or network requests.
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture, snapshot } = require('./stale-quarter-reload.test.js');
const evidence = require('./fixtures/restore-pruned-null-cap.json');
const restored = evidence.restored.map(({ entry }) => ({ ...entry, restoreFullPullOn: '2026-09-29' }));
const clone = value => JSON.parse(JSON.stringify(value));
const tickers = rows => rows.map(row => row.ticker);
const ordinary = { ticker: 'ORDINARY', yahoo_symbol: 'ORDINARY' };
const stocks = [ordinary, ...restored];
let passed = 0;
async function check(name, fn) {
  await fn(); passed++; console.log('PASS ' + name);
}
function fastRetryFixture(options) {
  // Replace only the three backoff delays; keep actual timeout/abort semantics.
  const timer = global.setTimeout;
  global.setTimeout = (fn, ms, ...args) => timer(fn, [15000, 45000, 90000].includes(ms) ? 0 : ms, ...args);
  try { return fixture({ env: { STALE_QUARTER_RELOAD: '0' }, ...options }); }
  finally { global.setTimeout = timer; }
}
function currentSnapshot(ticker) {
  const s = snapshot(ticker, '2026-06-30');
  s.meta.asOf = s.meta.fetchedAt = s.meta.fundamentalsAsOf = '2026-09-29T02:17:00Z';
  return s;
}
async function run() {
  await check('14 UTC dates retain stable priority; no early priority and visible repeated expiry warnings', () => {
    const f = fixture({ snapshots: [] });
    f.logs.length = 0;
    for (let day = 0; day < 14; day++) {
      const date = new Date(Date.parse('2026-09-29') + day * 86400000 + 86399999);
      assert.deepEqual(tickers(clone(f.Y.prioritizeRestoredMissingSnapshots(stocks, f.out, date))),
        [...tickers(restored), ordinary.ticker]);
    }
    assert.equal(f.logs.length, 0, 'active recovery must not warn');
    assert.deepEqual(clone(f.Y.prioritizeRestoredMissingSnapshots(stocks, f.out, new Date('2026-09-28'))), stocks);
    for (const date of ['2026-10-13', '2026-10-14']) {
      f.logs.length = 0;
      assert.deepEqual(clone(f.Y.prioritizeRestoredMissingSnapshots(stocks, f.out, new Date(date))), stocks);
      for (const { ticker } of restored) assert(f.logs.some(line => line.startsWith('::warning::') && line.includes(ticker)
        && line.includes('14-Tage-Vorrang') && line.includes('Firma bleibt')), 'expired recovery must be visible: ' + ticker);
    }
  });
  await check('present snapshots stop recovery priority/warnings; invalid dates warn and unmarked rows stay ordinary', () => {
    const f = fixture({ snapshots: restored.map(s => currentSnapshot(s.ticker)) });
    f.logs.length = 0;
    for (const date of ['2026-09-30', '2026-10-13']) {
      assert.deepEqual(clone(f.Y.prioritizeRestoredMissingSnapshots(stocks, f.out, new Date(date))), stocks);
      assert.equal(f.logs.length, 0);
    }
    const empty = fixture({ snapshots: [] });
    for (const marker of ['bad-date', '2026-02-30']) {
      const input = [ordinary, { ticker: 'INVALID', restoreFullPullOn: marker }];
      assert.deepEqual(clone(empty.Y.prioritizeRestoredMissingSnapshots(input, empty.out, new Date('2026-09-30'))), input);
      assert(empty.logs.some(s => s.includes('::warning::Wiederaufnahme INVALID') && s.includes('ungueltiges')));
    }
  });
  await check('next-day real pull retries missing cap before ordinary prices; successful snapshot stops priority', async () => {
    const row = restored.find(s => s.ticker === '066970.KS');
    const f = fixture({ snapshots: [currentSnapshot('ORDINARY')], summaryMarketCap: null,
      now: Date.parse('2026-09-30T02:17:00Z'), env: { STALE_QUARTER_RELOAD: '0' } });
    const input = [ordinary, row];
    for (let run = 0; run < 2; run++) {
      f.calls.length = 0;
      const m = await f.Y.pullAll({ stocks: clone(input) }, f.out, 0);
      assert.deepEqual(f.calls[0], [row.ticker, 'quoteSummary']);
      assert.equal(m.results.find(r => r.ticker === row.ticker).status, 'missing-market-cap');
      assert(!f.files.has(path.join(f.out, row.ticker + '.json')), 'missing cap must not invent a snapshot');
      assert.equal(m.results.find(r => r.ticker === ordinary.ticker).status, 'price-only');
    }
    const recovered = fixture({ snapshots: [currentSnapshot('ORDINARY')], now: Date.parse('2026-10-01T02:17:00Z'),
      env: { STALE_QUARTER_RELOAD: '0' } });
    assert.equal((await recovered.Y.pullAll({ stocks: clone(input) }, recovered.out, 0)).results[0].status, 'ok');
    assert(recovered.files.has(path.join(recovered.out, row.ticker + '.json')));
    assert.deepEqual(clone(recovered.Y.prioritizeRestoredMissingSnapshots(input, recovered.out, new Date('2026-10-02'))), input);
  });
  await check('three missing 429 tickers retry next run, while the recovered fifth ticker uses its snapshot', async () => {
    const missing = restored.filter(s => ['300475.SZ', '600486.SS', 'OV8.SI'].includes(s.ticker));
    const recovered = restored.find(s => s.ticker === '600019.SS');
    const f = fastRetryFixture({ snapshots: [currentSnapshot(recovered.ticker)], summaryFails: true,
      summaryError: 'HTTP 429 Too Many Requests; no data found', now: Date.parse('2026-09-30T02:17:00Z') });
    const input = [recovered, ...missing];
    for (let run = 0; run < 2; run++) {
      f.calls.length = 0;
      const m = await f.Y.pullAll({ stocks: clone(input) }, f.out, 0);
      assert.deepEqual([...new Set(f.calls.filter(c => c[1] === 'quoteSummary').map(c => c[0]))], tickers(missing));
      assert.equal(m.failures.length, 3);
      assert(m.failures.every(r => r.errClass === 'rate-limit'), '429 must outrank not-found wording');
      for (const { ticker } of missing) {
        assert.equal(f.calls.filter(c => c[0] === ticker && c[1] === 'quoteSummary').length, 4);
        assert(!f.files.has(path.join(f.out, ticker + '.json')));
      }
      assert.equal(m.results.find(r => r.ticker === recovered.ticker).status, 'price-only');
      assert.equal(f.stored(recovered.ticker).meta.delisted, undefined);
    }
  });
  await check('429 leaves an existing not-found streak and snapshot unchanged; real not-found still advances it', async () => {
    const old = snapshot('CONTROL'); old.meta.notFoundStreak = 1;
    old.meta.asOf = old.meta.fetchedAt = old.meta.fundamentalsAsOf = '2026-08-01T00:00:00Z';
    const f = fastRetryFixture({ snapshots: [old], summaryFails: true, summaryError: 'HTTP 429 Too Many Requests' });
    const filename = path.join(f.out, 'CONTROL.json'), before = Buffer.from(f.files.get(filename));
    for (let run = 0; run < 3; run++) {
      const m = await f.run();
      assert.equal(m.failures[0].errClass, 'rate-limit');
      assert.deepEqual(f.files.get(filename), before);
      assert.equal(f.stored('CONTROL').meta.notFoundStreak, 1);
      assert.equal(f.stored('CONTROL').meta.delisted, undefined);
    }
    const absent = fixture({ snapshots: [old], summaryFails: true, summaryError: 'Quote not found for symbol',
      env: { STALE_QUARTER_RELOAD: '0' } });
    assert.equal((await absent.run()).failures[0].errClass, 'not-found');
    assert.equal(absent.stored('CONTROL').meta.notFoundStreak, 2);
  });
  console.log('restoration-retry.test.js: ' + passed + ' passed, 0 failed; diskWrites=0 networkCalls=0');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
