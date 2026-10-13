'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const fixtures = require('./fixtures/market-cap-p205.json');
const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
const { route } = require('../src/scoring/router.js');
const before = JSON.stringify(fixtures);
const qh = prepareSnapshot(fixtures.QH);
assert.ok(Math.abs(qh.marketCap.value - 9834442.475) < 0.000001,
  `QH must use post-consolidation shares, got ${qh.marketCap.value}`);
assert.equal(route(qh).reason, 'skipped-mcap');
assert.equal(JSON.stringify(prepareSnapshot(fixtures.MSFT)), JSON.stringify(fixtures.MSFT), 'Real mega cap MSFT must stay unchanged');
assert.equal(JSON.stringify(fixtures), before, 'Stored input must remain unchanged');
console.log('P205: QH corrected and excluded; MSFT and raw inputs unchanged.');
const guard = require('../lib/market-cap-guard.js');
const { financialReasons } = require('../lib/financial-known-cases.js');
const { smallcapRoute } = require('../src/scoring/smallcap-route.js');
const { scoreUniverse } = require('../src/scoring/score.js');
const { buildExcludedList } = require('../scripts/write-excluded-list.js');
const live = ['lib/market-cap-guard.js', 'configs/share-count-hand-table.json', 'configs/market-cap-floors.json', 'tests/fixtures/market-cap-p205.json'].map(f => path.resolve(__dirname, '..', f));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const hashes = live.map(sha);
let checks = 4;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
check('3018 uses exchange share count with the already normalized USD price', () => {
  const s = prepareSnapshot(fixtures['3018.TW']);
  assert.ok(Math.abs(s.marketCap.value - 75377715 * 0.344654717) < 0.000001);
  assert.equal(route(s).reason, 'skipped-mcap');
  assert.equal(s.marketCap.source, 'hand-table:shares');
});
check('wrong multi-class cap is withheld with a German reason, not B-class-only cap', () => {
  const s = prepareSnapshot(fixtures['ISBTR.IS']);
  assert.equal(s.marketCap.value, null);
  assert.equal(s.marketCap.missing, true);
  assert.match(financialReasons(s)[0], /Börsenwert nicht verlässlich/);
  for (const field of ['priceSales', 'enterpriseValue', 'enterpriseToRevenue', 'enterpriseToEbitda']) assert.equal(s.metrics[field], null);
});
check('correct cap, corrected ADS cases and stale provider share counts are unchanged', () => {
  for (const ticker of ['MSFT', 'KRSA', 'ANDG', 'HSAI', '6135.T', 'ISCTR.IS']) {
    assert.equal(guard.prepareMarketCap(fixtures[ticker]), fixtures[ticker], ticker);
  }
  const right = structuredClone(fixtures.QH);
  right.marketCap.value = right.price.regularMarketPrice * guard.table.QH.shares;
  assert.deepEqual(guard.prepareMarketCap(right), right);
});
check('idempotence, correct observation day and unknown count fail closed', () => {
  assert.deepEqual(guard.prepareMarketCap(qh), qh);
  for (const change of [s => { s.marketCap.value *= 1.5; }, s => { s.price.currencyUnit = 'CNY'; },
    s => { s.marketCap.asOf = '2027-01-01'; }, s => { delete s.marketCap.asOf; delete s.meta.asOf; }]) {
    const s = structuredClone(fixtures.QH); change(s);
    assert.equal(guard.prepareMarketCap(s).marketCap.value, null);
  }
  const historical = structuredClone(fixtures.QH); historical.marketCap.asOf = '2026-07-16';
  assert.deepEqual(guard.prepareMarketCap(historical), historical);
});
check('pull invokes the same guard after conversion without rewriting raw fixtures', () => {
  const pull = require('../pull-yahoo.js');
  for (const ticker of ['QH', '3018.TW', 'ISBTR.IS']) {
    const s = structuredClone(fixtures[ticker]);
    pull._applyAdsHandTable(s, ticker, s.price.regularMarketPrice);
    assert.equal(s.marketCap.value, guard.prepareMarketCap(fixtures[ticker]).marketCap.value);
  }
  for (const ticker of ['QH', '3018.TW']) {
    const s = structuredClone(fixtures[ticker]);
    const priceUsd = s.price.regularMarketPrice;
    const nativePrice = priceUsd / s.meta.tradingFxRateApplied;
    delete s.price; delete s.meta.priceCurrency;
    pull._applyAdsHandTable(s, ticker, nativePrice);
    assert.equal(s.marketCap.value, guard.prepareMarketCap(fixtures[ticker]).marketCap.value, 'full pull without snapshot.price');
    const stalePrice = structuredClone(fixtures[ticker]);
    pull._applyAdsHandTable(stalePrice, ticker, null);
    assert.equal(stalePrice.marketCap.value, null, 'fresh quote has no price; retained price must not be used');
  }
});
check('normalized non-USD correction retains reproducible FX and source evidence', () => {
  const s = guard.prepareMarketCap(fixtures['3018.TW']);
  s._pullMode = 'price-only'; s._pullModeAt = s.meta.asOf = s.marketCap.asOf;
  const evidence = require('../lib/export-provenance.js').captureSnapshot(s);
  assert.equal(evidence.marketCap.missingReason, null);
  assert.equal(evidence.marketCapInputs[0].missingReason, null);
  assert.ok(Math.abs(evidence.marketCapInputs[0].nativeValue - 11) < 1e-12);
  assert.equal(evidence.marketCapInputs[0].fx.rate, 0.031332247);
  delete s.meta.tradingFxRateApplied;
  const sameCurrency = require('../lib/export-provenance.js').captureSnapshot(s);
  assert.equal(sameCurrency.marketCap.missingReason, null);
  assert.equal(sameCurrency.marketCapInputs[0].fx.rate, s.meta.fxRateApplied);
});
check('real full mapper and FX converter feed both USD and same-currency TWD cases', () => {
  const pull = require('../pull-yahoo.js');
  for (const [ticker, currency, price, marketCap, expected] of [
    ['QH', 'USD', 3.575, 314702102528, () => 9834442.475],
    // The TWD rate comes from the fx-rates.json the daily run refreshes; the fixed 0.031332247 turned the blocking lane red after
    // the refresh of 13.10.2026. The band still catches an inverted or missing rate.
    ['3018.TW', 'TWD', 11, 11 * 75377715000, rate => { assert.ok(rate > 0.02 && rate < 0.05, 'TWD/USD rate ' + rate); return 11 * rate * 75377715; }],
  ]) {
    const yahoo = { price: { currency, regularMarketPrice: price }, financialData: { financialCurrency: currency }, summaryDetail: { marketCap } };
    const s = pull.mapYahooToCanonical(yahoo, { ticker }, '2026-10-10T09:11:34.636Z');
    pull._convertSnapshotToUSD(s);
    assert.equal(s.price, undefined);
    assert.equal(s.meta.tradingFxRateApplied, undefined);
    pull._applyAdsHandTable(s, ticker, price);
    assert.ok(Math.abs(s.marketCap.value - expected(s.meta.fxRateApplied)) < 0.000001, ticker);
  }
});
check('smallcap retains its own 300M floor instead of inheriting the main floor', () => {
  const s = structuredClone(qh); s.marketCap.value = 550e6;
  assert.equal(route(s, 800e6).reason, 'skipped-mcap');
  assert.equal(smallcapRoute(s).action, 'route');
  assert.equal(smallcapRoute(qh).action, 'exclude');
  assert.equal(guard.marketCapFloor({ MIN_MCAP_USD: '800000000' }), 800e6);
});
check('every withheld/rerouted case reaches excluded.json with the explanation', () => {
  const universe = ['QH', '3018.TW', 'ISBTR.IS'].map(t => prepareSnapshot(fixtures[t]));
  const results = scoreUniverse(universe, require('../src/scoring/formulas/index.js'));
  const excluded = buildExcludedList(results, universe);
  assert.equal(excluded.legs, 3);
  const q = excluded.rows.find(r => r.ticker === 'QH');
  assert.equal(q.reason, 'skipped-mcap');
  assert.match(q.financialDataReasons[0], /32.000/);
  const i = excluded.rows.find(r => r.ticker === 'ISBTR.IS');
  assert.equal(i.marketCap, null);
  assert.match(i.financialDataReasons[0], /Aktienklassen/);
});
check('all shared export mappers drop old rows without stopping other boards', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p205-exports-'));
  assert.ok(!live.some(f => path.resolve(dir) === path.dirname(f)));
  for (const [ticker, snapshot] of Object.entries(fixtures)) fs.writeFileSync(path.join(dir, ticker + '.json'), JSON.stringify(snapshot));
  process.env.FINDASH_SNAPSHOTS_DIR = dir;
  process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = dir;
  const writer = require('../scripts/write-findash-export.js');
  const r40 = require('../scripts/write-rule40-export.js');
  for (const ticker of ['QH', '3018.TW', 'ISBTR.IS']) {
    const snap = prepareSnapshot(fixtures[ticker]);
    const old = { ticker, score: 20, marketCap: fixtures[ticker].marketCap.value, mcapBand: 'mega', mcapKlasse: 'mega', lamps: [] };
    for (const mapper of [writer.mapBoardRow, writer.mapOverviewRow, writer.mapSurvivalRow]) {
      assert.equal(mapper(old, 0), null);
    }
    assert.equal(writer.mapBoardRow(old, 0, 'smallcap'), null);
    assert.equal(r40.mcapBelegt({ row: old }, snap, snap.meta, {}), snap.marketCap.value);
  }
});
check('filter export drops stale membership but keeps excluded snapshots with a reason', () => {
  const { buildUniverse } = require('../scripts/write-filter-universe.js');
  for (const ticker of ['QH', '3018.TW', 'ISBTR.IS']) {
    const snapshot = prepareSnapshot(fixtures[ticker]);
    const input = { snapshots: [snapshot], generatedAt: '2026-10-10T09:52:42.659Z' };
    const boards = new Map([[ticker, { branch: 'software', row: { marketCap: fixtures[ticker].marketCap.value, score: 20, rank: 1 } }]]);
    const dropped = buildUniverse({ ...input, boards });
    assert.equal(dropped.rows.length, 0); assert.equal(dropped.marketCapDropped, 1);
    const row = buildUniverse(input).rows[0];
    assert.equal(row.b, undefined);
    assert.equal(row.rk, undefined);
    assert.ok(row.aus.length > 0);
    if (ticker === 'ISBTR.IS') {
      assert.equal(row.mc, undefined);
      assert.ok(row.aus.some(reason => /Börsenwert nicht verlässlich/.test(reason)));
    }
    else assert.ok(row.aus.includes('skipped-mcap'));
  }
});
check('old board rows cannot survive a missing snapshot after a size exit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p205-missing-'));
  const script = `const assert=require('node:assert/strict');const w=require('./scripts/write-findash-export.js');
    for(const ticker of ['QH','3018.TW','ISBTR.IS']) {
      for(const mapper of [w.mapBoardRow,w.mapOverviewRow,w.mapSurvivalRow]) {
        assert.equal(mapper({ticker,score:20,marketCap:314702102528,mcapBand:'mega',lamps:[]},0),null);
      }
    }`;
  const result = require('node:child_process').spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, FINDASH_SNAPSHOTS_DIR: dir, FINDASH_SMALLCAP_SNAPSHOTS_DIR: dir }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
check('break once on isolated test data; live bytes remain unchanged', () => {
  const { Module, createRequire } = require('node:module');
  const source = live[0], target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p205-break-')), 'guard.js');
  assert.notEqual(path.resolve(target), path.resolve(source));
  const code = fs.readFileSync(source, 'utf8');
  const anchor = '  applyMarketCapGuard(copy);';
  assert.equal(code.split('\n').filter(line => line.trimEnd() === anchor).length, 1);
  const broken = code.split('\n').map(line => line.trimEnd() === anchor ? '  // Deliberately disabled in this test copy.' : line).join('\n');
  fs.writeFileSync(target, broken);
  const mod = new Module(source, module); mod.filename = source; mod.paths = module.paths; mod.require = createRequire(source);
  mod._compile(fs.readFileSync(target, 'utf8'), source);
  assert.throws(() => assert.equal(mod.exports.prepareMarketCap(fixtures.QH).marketCap.value, qh.marketCap.value), assert.AssertionError);
  assert.deepEqual(live.map(sha), hashes);
  assert.equal(JSON.stringify(fixtures), before);
});
console.log(`P205: ${checks} checks passed, 0 failed; deliberate break caught; live SHA256 unchanged.`);
