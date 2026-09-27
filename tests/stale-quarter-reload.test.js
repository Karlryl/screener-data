'use strict';
// Real pullAll, frozen clock, virtual files and fake Yahoo. No live reads/writes/network.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const R = require('../lib/stale-quarter-reload.js');
const { prepareRanks } = require('../scripts/prepare-stale-quarter-ranks.js');
const { mergeCandidates } = require('../scripts/plan-stale-quarter-reload.js');
const { baueMarker, JOB_REIHENFOLGE } = require('../scripts/pipeline-status.js');
const { mergeManifests } = require('../scripts/merge-shard-manifests.js');
const root = path.resolve(__dirname, '..'), requireRoot = createRequire(path.join(root, 'pull-yahoo.js'));
const source = fs.readFileSync(path.join(root, 'pull-yahoo.js'), 'utf8');
const NOW = Date.parse('2026-09-29T02:17:00Z');
const DEFAULT = JSON.parse(fs.readFileSync(path.join(root, 'configs/stale-quarter-reload.json'), 'utf8'));
let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
const rows = end => [{ date: '2025-12-31', totalRevenue: 90, grossProfit: 30, operatingIncome: 15, netIncome: 8 },
  { date: end, totalRevenue: 100, grossProfit: 40, operatingIncome: 20, netIncome: 10 }];
function snapshot(ticker, end = '2026-03-31', fetched = '2026-09-20T02:17:00Z') {
  return { meta: { ticker, reportingCurrency: 'USD', tradingCurrency: 'USD', asOf: '2026-09-26T03:00:00Z',
    fundamentalsAsOf: '2026-09-25T03:00:00Z', fetchedAt: '2026-09-25T03:00:00Z',
    fundamentalsTimeseriesFetchedAt: fetched },
  marketCap: { value: 1e12 }, price: { value: 100 }, metrics: { revenueTTM: { value: 400 } },
  annual: { annualRev: [{ value: 400 }], annualBalance: [{ currentAssets: 100 }] },
  timeseries: { revenueQ: [{ value: 100 }], grossProfitQ: [{ value: 40 }], opIncQ: [{ value: 20 }], netIncomeQ: [{ value: 10 }],
    revenueQEnds: [end], grossProfitQEnds: [end], opIncQEnds: [end] } };
}
function fixture({ snapshots = [snapshot('OLD')], ranks = {}, cap = DEFAULT.maxPerRun, shard = null, selection = null,
  newer = true, quarterFails = false, manual = [], calendar = {} } = {}) {
  const base = path.join(root, '_scratch', 'b6-virtual'), out = path.join(base, 'snapshots');
  const files = new Map(), handles = new Map(), calls = [], logs = []; let fd = 1000;
  const key = p => path.resolve(String(p));
  const put = (p, value) => files.set(key(p), Buffer.from(JSON.stringify(value)));
  const configPath = path.join(root, 'configs/stale-quarter-reload.json');
  put(configPath, { ...DEFAULT, maxPerRun: cap });
  put(path.join(root, 'earnings-calendar.json'), calendar);
  put(path.join(root, 'outputs/stale-quarter-ranks.json'), { generated_at: '2026-09-26T09:00:00Z', ranks });
  if (selection) put(path.join(root, 'outputs/stale-quarter-selection.json'), selection);
  for (const s of snapshots) {
    put(path.join(out, s.meta.ticker + '.json'), s);
    put(path.join(root, 'fundamentals-cache', s.meta.ticker + '.json'), { _cacheVersion: 2, _ftsPartial: false,
      cachedAt: '2026-09-20T02:17:00Z', payload: { ftsAnnual: s.annual, ftsQuarterly: s.timeseries,
        ftsBalance: s.annual.annualBalance, ftsAnnualSGA: [1], ftsAnnualDepreciation: [1] } });
  }
  const io = new Proxy(fs, { get(target, prop) {
    if (prop === 'existsSync') return p => files.has(key(p));
    if (prop === 'readFileSync') return (p, enc) => { if (!files.has(key(p))) { const e = new Error('virtual file missing'); e.code = 'ENOENT'; throw e; } const b = files.get(key(p)); return enc ? b.toString() : Buffer.from(b); };
    if (prop === 'writeFileSync') return (p, data) => { files.set(key(p), Buffer.from(data)); };
    if (prop === 'mkdirSync') return () => {};
    if (prop === 'unlinkSync') return p => files.delete(key(p));
    if (prop === 'renameSync') return (a, b) => { files.set(key(b), files.get(key(a))); files.delete(key(a)); };
    if (prop === 'openSync') return p => { if (!files.has(key(p))) throw new Error('missing virtual handle'); handles.set(++fd, files.get(key(p))); return fd; };
    if (prop === 'readSync') return (h, buffer, offset, length, position) => handles.get(h).copy(buffer, offset, position, position + length);
    if (prop === 'closeSync') return h => handles.delete(h);
    if (prop === 'statSync') return p => ({ size: files.get(key(p)).length, mtimeMs: NOW - 86400000 });
    return target[prop];
  } });
  const quote = { currency: 'USD', regularMarketPrice: 100, marketCap: 1e12 };
  class Yahoo {
    async quote(t) { calls.push([t, 'quote']); return quote; }
    async quoteSummary(t) { calls.push([t, 'quoteSummary']); return { price: quote, financialData: { financialCurrency: 'USD' },
      quoteType: { quoteType: 'EQUITY' }, summaryProfile: { sector: 'Technology', industry: 'Software' } }; }
    async fundamentalsTimeSeries(t, q) {
      calls.push([t, q.type + '/' + q.module]);
      if (q.type === 'quarterly' && quarterFails) throw new Error('fixture quarterly failure');
      if (q.type === 'quarterly') return rows(newer ? '2026-06-30' : '2026-03-31');
      return [{ date: '2025-12-31', totalRevenue: 400, grossProfit: 100, operatingIncome: 50, netIncome: 30,
        operatingCashFlow: 60, freeCashFlow: 40, totalAssets: 1000, currentAssets: 200, currentLiabilities: 100, totalDebt: 50 }];
    }
  }
  const mod = { exports: {} }, log = (...a) => logs.push(a.join(' '));
  class FixedDate extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
  const context = { module: mod, exports: mod.exports, __dirname: root, __filename: path.join(root, 'pull-yahoo.js'),
    Date: FixedDate, Buffer, AbortController, setTimeout, clearTimeout, setImmediate,
    console: { log, warn: log, error: log, dir() {} },
    process: { env: { ...process.env, PULL_CONCURRENCY: '1' }, cwd: () => root, exit: c => { throw new Error('unexpected exit ' + c); } },
    require: id => id === 'fs' ? io : id === 'yahoo-finance2' ? { default: Yahoo }
      : id === './lib/atomic-write.js' ? { writeFileAtomic: (p, s) => io.writeFileSync(p, s) } : requireRoot(id) };
  context.global = context;
  vm.runInNewContext(source + '\nmodule.exports.__manual = x => { _vollPullTicker = new Set(x); };', context, { filename: path.join(root, 'pull-yahoo.js') });
  const Y = mod.exports; Y.__manual(manual);
  const stocks = snapshots.map(s => ({ ticker: s.meta.ticker, yahoo_symbol: s.meta.ticker, name: s.meta.ticker }));
  return { Y, calls, files, logs, out, io, config: { ...DEFAULT, maxPerRun: cap },
    stored: ticker => JSON.parse(files.get(key(path.join(out, ticker + '.json')))),
    run: () => Y.pullAll({ stocks: Y.shardStocks(stocks, shard), _pullShard: shard, _meta: { version: 'b6-fixture' } }, out, 0) };
}
(async () => {
  await check('selected old quarter bypasses both clocks and persists the newer quarter + FTS clock', async () => {
    const f = fixture(), m = await f.run();
    assert.equal(m.n_stale_quarter_selected, 1); assert.equal(m.n_stale_quarter_pulled, 1);
    assert.equal(f.calls.filter(x => x[1].includes('/')).length, 4);
    assert.equal(m.n_stale_quarter_newer, 1); assert.equal(m.n_stale_quarter_still_old_yahoo, 0);
    assert.equal(f.stored('OLD').meta.fundamentalsTimeseriesFetchedAt, new Date(NOW).toISOString());
    assert.equal(f.stored('OLD').meta.fundamentalsTimeseriesClockSource, 'fts');
    assert.equal(m.results[0].quarterReload.reason, R.REASON);
    assert(f.logs.some(s => s.includes('stale-quarter-reload: selected=1, pulled=1, newer=1')));
    const slim = JSON.parse(f.files.get(path.join(f.out, '_manifest.json')));
    assert.equal(slim.n_stale_quarter_newer, 1); assert.equal(slim._staleQuarterReload.reason, R.REASON);
  });
  for (const [name, snap] of [['fresh quarter', snapshot('OLD', '2026-06-30')],
    ['three-day fetch', snapshot('OLD', '2026-03-31', '2026-09-26T02:17:00Z')]]) {
    await check('absence: ' + name + ' stays price-only', async () => {
      const f = fixture({ snapshots: [snap] }), m = await f.run();
      assert.equal(m.n_stale_quarter_selected, 0); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1], 'quote');
      assert.equal(f.stored('OLD').meta.fundamentalsTimeseriesFetchedAt, snap.meta.fundamentalsTimeseriesFetchedAt);
    });
  }
  await check('still-old successful Yahoo quarter waits a week; a failure does not advance its clock', async () => {
    const f = fixture({ newer: false }), m = await f.run();
    assert.equal(m.n_stale_quarter_still_old_yahoo, 1); assert.equal(m.n_stale_quarter_newer, 0);
    assert.equal(R.fetchClock(f.stored('OLD'), null, NOW).at, new Date(NOW).toISOString());
    assert.equal((await f.run()).n_stale_quarter_selected, 0);
    const bad = fixture({ quarterFails: true }), b = await bad.run();
    assert.equal(b.n_stale_quarter_fetch_failed, 1); assert.equal(b.n_stale_quarter_newer, 0);
    assert.equal(bad.stored('OLD').meta.fundamentalsTimeseriesFetchedAt, '2026-09-20T02:17:00.000Z');
  });
  await check('failed quarterly fetch preserves the legacy clock despite a new full-pull date', async () => {
    const s = snapshot('OLD'); delete s.meta.fundamentalsTimeseriesFetchedAt;
    s.meta.fundamentalsAsOf = s.meta.fetchedAt = '2026-09-20T02:17:00Z';
    const f = fixture({ snapshots: [s], quarterFails: true });
    f.files.delete(path.join(root, 'fundamentals-cache', 'OLD.json'));
    const m = await f.run();
    assert.equal(m.n_stale_quarter_legacy_clock, 1); assert.equal(m.n_stale_quarter_fetch_failed, 1);
    assert.equal(f.stored('OLD').meta.fundamentalsTimeseriesFetchedAt, '2026-09-20T02:17:00.000Z');
    assert.equal(f.stored('OLD').meta.fundamentalsTimeseriesClockSource, 'legacy-full-proxy');
  });
  await check('recent successful warm cache suppresses an old snapshot clock', async () => {
    const f = fixture(), cachePath = path.join(root, 'fundamentals-cache', 'OLD.json');
    const cache = JSON.parse(f.files.get(cachePath)); cache.cachedAt = '2026-09-26T02:17:00Z';
    f.files.set(cachePath, Buffer.from(JSON.stringify(cache)));
    assert.equal((await f.run()).n_stale_quarter_selected, 0);
    assert.equal(f.calls.length, 1);
  });
  await check('manual full with warm cache preserves successful FTS time', async () => {
    const f = fixture({ snapshots: [snapshot('OLD', '2026-06-30')], manual: ['OLD'] }); await f.run();
    assert.equal(f.calls.filter(x => x[1].includes('/')).length, 0);
    assert.equal(f.stored('OLD').meta.fundamentalsTimeseriesFetchedAt, '2026-09-20T02:17:00.000Z');
    assert.throws(() => f.Y.parseVollPullTicker(Array.from({ length: 51 }, (_, i) => 'X' + i).join(','), new Set()), /Obergrenze/);
  });
  await check('board ranks beat unranked rows; calendar absence/future never excludes', async () => {
    const f = fixture({ snapshots: ['REST', 'B2', 'B1'].map(t => snapshot(t)), ranks: { B1: 1, B2: 2 }, cap: 2,
      calendar: { B1: { date: '2026-12-01' } } }), m = await f.run();
    assert.deepEqual(f.calls.filter(x => x[1] === 'quarterly/financials').map(x => x[0]), ['B1', 'B2']);
    assert.equal(m.n_stale_quarter_skipped_cap, 1);
  });
  await check('17 real pullAll shards consume one global cap; merged counters do not disappear', async () => {
    const snapshots = Array.from({ length: 170 }, (_, i) => snapshot('T' + i)), manifests = [];
    const plans = [], config = { ...DEFAULT, maxPerRun: 23 }, date = '2026-09-29';
    const seed = fixture({ snapshots });
    for (let i = 0; i < 17; i++) {
      const shard = { index: i, count: 17 }, stocks = seed.Y.shardStocks(snapshots.map(s => ({ ticker: s.meta.ticker })), shard);
      const p = R.planReload(stocks, { snapshotDir: seed.out, config, shard, now: NOW, io: seed.io });
      plans.push(JSON.parse(JSON.stringify({ date, config, shard, candidates: p.candidates })));
    }
    const selection = mergeCandidates(plans, config, 17, date);
    let calls = 0;
    for (let i = 0; i < 17; i++) {
      const f = fixture({ snapshots, cap: 23, shard: { index: i, count: 17 }, selection });
      const m = await f.run(); manifests.push(JSON.parse(f.files.get(path.join(f.out, '_manifest.json'))));
      calls += f.calls.filter(x => x[1] === 'quarterly/financials').length;
      assert.equal(m._staleQuarterReload.allocation, 'global-rank-order');
    }
    assert.equal(calls, 23);
    const merged = mergeManifests(manifests, 170, 17);
    assert.equal(merged.n_stale_quarter_selected, 23); assert.equal(merged.n_stale_quarter_pulled, 23);
    assert.equal(merged.n_stale_quarter_skipped_cap, 147); assert.equal(merged._staleQuarterReload.reason, R.REASON);
    assert.equal(Array.from({ length: 17 }, (_, i) => R.shardBudget(DEFAULT.maxPerRun, { index: i, count: 17 })).reduce((a, b) => a + b), 3000);
    assert.throws(() => mergeCandidates(plans.slice(1), config, 17, date), /Incomplete/);
    assert.throws(() => R.validateSelection({ ...selection, selected: ['DUP', 'DUP'] }, config, { count: 17 }, NOW), /Invalid/);
    assert.throws(() => R.validateSelection({ ...selection, date: '2026-09-28' }, config, { count: 17 }, NOW), /Invalid/);
  });
  await check('global allocation prefers board rows even when both are in the same shard', async () => {
    const config = { ...DEFAULT, maxPerRun: 2 }, date = '2026-09-29';
    const seed = fixture({ snapshots: ['T0', 'T2', 'T1'].map(t => snapshot(t)) });
    const stocks = ['T0', 'T2', 'T1'].map(ticker => ({ ticker })), plans = [];
    assert.equal(seed.Y.shardStocks(stocks, { index: 1, count: 2 }).length, 2);
    for (let i = 0; i < 2; i++) {
      const shard = { index: i, count: 2 };
      const p = R.planReload(seed.Y.shardStocks(stocks, shard), { snapshotDir: seed.out, config, shard, now: NOW,
        ranks: { T0: 2, T2: 1 }, io: seed.io });
      plans.push(JSON.parse(JSON.stringify({ date, config, shard, candidates: p.candidates })));
    }
    const selection = mergeCandidates(plans, config, 2, date);
    assert.deepEqual(selection.selected, ['T2', 'T0']);
    let pulled = [];
    for (let i = 0; i < 2; i++) {
      const f = fixture({ snapshots: ['T0', 'T2', 'T1'].map(t => snapshot(t)), cap: 2, shard: { index: i, count: 2 }, selection });
      await f.run(); pulled.push(...f.calls.filter(x => x[1] === 'quarterly/financials').map(x => x[0]));
    }
    assert.deepEqual(pulled, ['T2', 'T0']);
  });
  await check('120 calendar days excluded, 121 included; seven-day clock is inclusive', () => {
    const f = fixture({ snapshots: [snapshot('EDGE', '2026-06-01', '2026-09-22T02:17:00Z')] });
    const opts = { snapshotDir: f.out, now: NOW, config: f.config, io: f.io };
    assert.equal(R.planReload([{ ticker: 'EDGE' }], opts).selected.length, 0);
    assert.equal(R.planReload([{ ticker: 'EDGE' }], { ...opts, now: NOW + 86400000 }).selected.length, 1);
    const old = fixture({ snapshots: [snapshot('OLD', '2026-03-31', '2026-09-22T02:17:00Z')] });
    assert.equal(R.planReload([{ ticker: 'OLD' }], { ...opts, snapshotDir: old.out, io: old.io }).selected.length, 1);
  });
  await check('legacy clock labelled; daily price clock and unknown timestamps never count as FTS', () => {
    const s = snapshot('OLD'); delete s.meta.fundamentalsTimeseriesFetchedAt;
    assert.equal(R.fetchClock(s, null, NOW).source, 'legacy-full-proxy');
    delete s.meta.fundamentalsAsOf; delete s.meta.fetchedAt;
    assert.equal(R.fetchClock(s, null, NOW).source, 'unknown');
    assert.throws(() => R.validateConfig({ ...DEFAULT, maxPerRun: 0 }), /maxPerRun/);
    assert.throws(() => R.shardBudget(3000, { index: 17, count: 17 }), /shard/);
    assert.equal(R.latestReportedQuarter({ timeseries: { revenueQ: [null], revenueQEnds: ['2026-06-30'] } }, NOW), null);
  });
  await check('current board prep keeps best rank, includes survival, rejects mixed dates', async () => {
    const get = async file => {
      if (file === 'index.json') return { branches: ['energy'], generated_at: '2026-09-26T09:00:00Z' };
      if (file === 'quality/index.json') return { boards: ['quality-energy'], generated_at: '2026-09-26T09:00:00Z' };
      if (file === 'quality/energy.json') return { generated_at: '2026-09-26T09:00:00Z', profitable: [{ ticker: 'QC', rank: 1 }] };
      if (file === 'smallcap/index.json') return { boards: ['smallcap-energy'], generated_at: '2026-09-26T09:00:00Z' };
      if (file === 'smallcap/energy.json') return { generated_at: '2026-09-26T09:00:00Z', profitable: [{ ticker: 'SC', rank: 2 }] };
      assert(['full/energy.json', 'survival.json'].includes(file));
      return { generated_at: '2026-09-26T09:00:00Z', rows: [{ ticker: 'A', rank: file === 'survival.json' ? 1 : 3 },
        { ticker: 'BEYOND_DISPLAY', rank: 250 }, { ticker: 'GATED', rank: null }] };
    };
    const ranks = (await prepareRanks(get)).ranks;
    assert.equal(ranks.A, 1); assert.equal(ranks.BEYOND_DISPLAY, 250); assert.equal(ranks.GATED, undefined);
    assert.equal(ranks.QC, 1); assert.equal(ranks.SC, 2);
    assert.equal((await prepareRanks(async f => /^(quality|smallcap)\//.test(f) ? null : get(f))).ranks.A, 1);
    await assert.rejects(prepareRanks(async f => /^(quality|smallcap)\//.test(f) ? null : f === 'index.json' ? get(f) : { generated_at: '2026-09-25' }), /Mixed board dates/);
  });
  await check('planning failure is named before skipped pulls and preserves last successful run', () => {
    for (const failed of ['quarter-candidates', 'quarter-selection']) {
      const marker = baueMarker({ runId: '123', runAttempt: 1, headSha: 'a'.repeat(40),
        startedAt: '2026-09-29T02:17:00Z', completedAt: '2026-09-29T02:20:00Z',
        vorgaenger: { last_success_at: '2026-09-26T09:00:00Z' },
        jobErgebnisse: JOB_REIHENFOLGE.map(name => ({ name, result: name === failed ? 'failure' : name === 'pull' ? 'skipped' : 'success' })) });
      assert.equal(marker.status, 'failure'); assert.equal(marker.failed_job, failed);
      assert.equal(marker.last_success_at, '2026-09-26T09:00:00Z');
    }
  });
  console.log(`stale-quarter-reload.test.js: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
