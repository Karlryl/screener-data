'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const R = require('../lib/stale-quarter-reload.js');
const { mergeCandidates } = require('../scripts/plan-stale-quarter-reload.js');
const { overviewGrowthHold } = require('../lib/overview-known-cases.js');
const { overviewMetric } = require('../src/scoring/overview.js');
const { fixture, snapshot, DEFAULT } = require('./stale-quarter-reload.test.js');
const root = path.resolve(__dirname, '..');
const NOW = Date.parse('2026-10-10T12:00:00Z');
const REASON = 'Vergleich über nicht benachbarte Geschäftsjahre, Jahresenden fehlen im Abruf';
const cells = values => values.map(value => ({ value }));

function undated(ticker, fetched = '2026-09-25T02:00:00Z') {
  const s = snapshot(ticker, '2026-09-30', fetched);
  s.annual.annualGP = cells([120, 100]);
  s.annual.annualGPEnds = [null, null];
  return s;
}

// Values and missing dates copied from the read-only 2026-10-10 PGHL.BO snapshot.
function pghl() {
  const s = undated('PGHL.BO', '2026-09-29T09:18:00Z');
  s.annual.annualGP = cells([102803557.8744, 80220863.8, 84776783.76619999, 75525338.6942]);
  s.annual.annualGPEnds = [null, null, null, null];
  return s;
}

function plan(snaps, options = {}) {
  const f = fixture({ snapshots: snaps, now: NOW });
  return R.planReload(snaps.map(s => ({ ticker: s.meta.ticker })), {
    snapshotDir: f.out, io: f.io, now: NOW, config: DEFAULT, ...options,
  });
}

// Only snapshot reads are virtualized. Configs and production mapper code are real.
function writerFor(main, smallcap = main) {
  const filename = path.join(root, 'scripts/write-findash-export.js');
  const mainDir = path.join(root, '_virtual-p186-main'), smallDir = path.join(root, '_virtual-p186-small');
  const realRequire = createRequire(filename), mod = { exports: {} };
  const io = new Proxy(fs, { get(target, prop) {
    if (prop !== 'readFileSync') return target[prop];
    return (file, encoding) => {
      const dir = path.dirname(String(file));
      if (dir === mainDir || dir === smallDir) {
        const s = dir === mainDir ? main : smallcap;
        if (!s) { const e = new Error('No fixture snapshot'); e.code = 'ENOENT'; throw e; }
        const json = JSON.stringify(s);
        return encoding ? json : Buffer.from(json);
      }
      return fs.readFileSync(file, encoding);
    };
  } });
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: mod, exports: mod.exports, __dirname: path.dirname(filename), __filename: filename,
    Buffer, console, process: { env: { FINDASH_SNAPSHOTS_DIR: mainDir, FINDASH_SMALLCAP_SNAPSHOTS_DIR: smallDir } },
    require: id => id === 'fs' ? io : realRequire(id),
  }, { filename });
  return mod.exports;
}

function board(ticker = 'PGHL.BO', value = 0.282, kind = 'gp') {
  return { ticker, score: 80, track: 'profitable', overview: { kind, value, companion: 43 },
    marketCap: null, revGrowthYoYPct: null };
}

test('oldest undated periods get half the unchanged cap; ordinary ranks keep their half', () => {
  const candidates = plan([
    undated('NEW', '2026-10-01T00:00:00Z'), undated('OLD', '2026-09-20T00:00:00Z'),
    undated('MID', '2026-09-25T00:00:00Z'), snapshot('B2'), snapshot('B1'), snapshot('B3'),
  ], { config: { ...DEFAULT, maxPerRun: 4 }, ranks: { B1: 1, B2: 2, B3: 3, NEW: 1 } });
  assert.deepEqual(candidates.selected.map(r => r.ticker), ['OLD', 'B1', 'MID', 'B2']);
  assert.equal(candidates.selected.length, 4);
  assert.equal(DEFAULT.maxPerRun, 3000);
  const before = JSON.stringify(candidates.candidates);
  assert.equal(R.selectReloadCandidates(candidates.candidates, 0).length, 0);
  assert.equal(R.selectReloadCandidates(candidates.candidates, 20).length, 6);
  assert.equal(JSON.stringify(candidates.candidates), before);
  assert.throws(() => R.selectReloadCandidates([], -1), /Invalid/);
});

test('both queues make progress across days; spare slots and an odd cap are usable', () => {
  const rows = [undated('U1'), undated('U2'), undated('U3'), snapshot('D1'), snapshot('D2'), snapshot('D3')];
  const first = plan(rows, { config: { ...DEFAULT, maxPerRun: 3 } }).selected;
  assert.deepEqual(first.map(r => r.ticker), ['U1', 'D1', 'U2']);
  for (const s of rows.filter(s => first.some(r => r.ticker === s.meta.ticker))) {
    s.meta.fundamentalsTimeseriesFetchedAt = new Date(NOW).toISOString();
    if (s.annual.annualGP) s.annual.annualGPEnds = ['2025-12-31', '2024-12-31'];
  }
  assert.deepEqual(plan(rows, { config: { ...DEFAULT, maxPerRun: 3 } }).selected.map(r => r.ticker), ['U3', 'D2', 'D3']);
  assert.equal(plan([undated('ONLY')]).selected.length, 1);
});

test('dated, partial, malformed, recent, missing-clock and empty statement windows', () => {
  const dated = undated('DATED'); dated.annual.annualGPEnds = ['2025-12-31', '2024-12-31'];
  const partial = undated('PARTIAL'); partial.annual.annualGPEnds[0] = '2025-12-31';
  const invalid = undated('INVALID'); invalid.annual.annualGPEnds = ['2025-02-30', '2024-12-31'];
  const short = undated('SHORT'); short.annual.annualGPEnds = ['2025-12-31'];
  const unknown = undated('UNKNOWN'); unknown.meta = { ticker: 'UNKNOWN' };
  const empty = undated('EMPTY'); empty.annual.annualGP = []; empty.annual.annualGPEnds = [];
  const recent = undated('RECENT', '2026-10-09T00:00:00Z');
  assert.deepEqual(plan([dated, partial, invalid, short, unknown, empty, recent]).selected.map(r => r.ticker),
    ['UNKNOWN', 'INVALID', 'PARTIAL', 'SHORT']);
  assert.equal(R.missingAnnualPeriodEnds(null), false);
  assert.equal(R.missingAnnualPeriodEnds(dated), false);
});

test('global merge and 17 shards share one cap and the exact same selected order', () => {
  const snaps = Array.from({ length: 40 }, (_, i) => i % 2 ? snapshot('T' + i) : undated('T' + i));
  const f = fixture({ snapshots: snaps, now: NOW });
  const config = { ...DEFAULT, maxPerRun: 12 }, date = '2026-10-10', stocks = snaps.map(s => ({ ticker: s.meta.ticker }));
  const plans = Array.from({ length: 17 }, (_, index) => {
    const shard = { index, count: 17 };
    const p = R.planReload(f.Y.shardStocks(stocks, shard), { snapshotDir: f.out, io: f.io, now: NOW, config, shard });
    return JSON.parse(JSON.stringify({ ...p, date, config, shard }));
  });
  const merged = mergeCandidates(plans, config, 17, date);
  assert.equal(merged.selected.length, 12);
  assert.equal(merged.selected.filter(t => Number(t.slice(1)) % 2 === 0).length, 6);
  const local = plans.flatMap(p => R.planReload(f.Y.shardStocks(stocks, p.shard), {
    snapshotDir: f.out, io: f.io, now: NOW, config, shard: p.shard, selection: merged,
  }).selected.map(r => r.ticker));
  assert.deepEqual(local.sort(), merged.selected.slice().sort());
  assert.equal(plans.reduce((n, p) => n + R.shardBudget(3000, p.shard), 0), 3000);
});

test('real pullAll refreshes undated GP despite a fresh quarter and warm cache, within the cap', async () => {
  const s = undated('OLD'); s.meta.asOf = '2026-10-09T00:00:00Z';
  const income = [2024, 2025].map((year, i) => ({ date: year + '-12-31', totalRevenue: 400,
    grossProfit: i ? 120 : 100, operatingIncome: 50, netIncome: 30 }));
  const f = fixture({ snapshots: [s, { ...structuredClone(s), meta: { ...s.meta, ticker: 'TAIL' } }], now: NOW, cap: 1,
    annualResponses: { financials: income, 'cash-flow': income.map(r => ({ date: r.date, operatingCashFlow: 60, freeCashFlow: 40 })),
      'balance-sheet': [{ date: '2025-12-31', totalAssets: 1000, currentAssets: 200, currentLiabilities: 100, totalDebt: 50 }] },
    quarterlyRows: [{ date: '2026-09-30', totalRevenue: 100, grossProfit: 40, operatingIncome: 20, netIncome: 10 }] });
  const m = await f.run();
  assert.equal(m.n_stale_quarter_selected, 1);
  assert.equal(m.n_failed, 0);
  assert.equal(f.calls.filter(c => c[1] === 'annual/financials').length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'TAIL' && c[1] === 'quoteSummary').length, 0);
  assert.deepEqual(f.stored('OLD').annual.annualGPEnds, ['2025-12-31', '2024-12-31']);
  assert.equal(R.missingAnnualPeriodEnds(f.stored('OLD')), false);
  assert.equal(R.missingAnnualPeriodEnds(f.stored('TAIL')), true);
});

test('failed undated refresh retains stored values and never claims that dates arrived', async () => {
  const s = undated('OLD'); s.meta.asOf = '2026-10-09T00:00:00Z';
  const f = fixture({ snapshots: [s], now: NOW, annualFails: true });
  const m = await f.run();
  assert.equal(m.n_stale_quarter_reload_failed, 1);
  assert.deepEqual(f.stored('OLD').annual, s.annual);
  assert.equal(R.missingAnnualPeriodEnds(f.stored('OLD')), true);
});

test('a successful but GP-empty reply cannot erase the undated GP history being repaired', async () => {
  const s = undated('OLD'); s.meta.asOf = '2026-10-09T00:00:00Z';
  const income = [2024, 2025].map(year => ({ date: year + '-12-31', totalRevenue: 400, operatingIncome: 50, netIncome: 30 }));
  const f = fixture({ snapshots: [s], now: NOW,
    annualResponses: { financials: income, 'cash-flow': income.map(r => ({ date: r.date, operatingCashFlow: 60, freeCashFlow: 40 })),
      'balance-sheet': [{ date: '2025-12-31', totalAssets: 1000, currentAssets: 200, currentLiabilities: 100, totalDebt: 50 }] },
    quarterlyRows: [{ date: '2026-09-30', totalRevenue: 100, grossProfit: 40, operatingIncome: 20, netIncome: 10 }] });
  const m = await f.run();
  assert.equal(m.n_stale_quarter_selected, 1);
  assert.equal(m.n_stale_quarter_pulled, 1);
  assert.equal(m.n_stale_quarter_reload_failed, 1);
  assert.equal(m.n_failed, 0);
  assert.deepEqual(f.stored('OLD').annual, s.annual);
  assert.equal(f.stored('OLD').meta.fundamentalsTimeseriesFetchedAt, s.meta.fundamentalsTimeseriesFetchedAt);
});

test('10 October PGHL values are withheld in both export shapes without changing score, rank or inputs', () => {
  const s = pghl(), before = JSON.stringify(s), r = board(), original = JSON.stringify(r);
  // Period gate round 2 (30.10.2026): the undated pair behind the former 28.2 % is empty at the source as well.
  assert.equal(overviewMetric(s).value, null);
  const writer = writerFor(s), b = writer.mapBoardRow(r, 30);
  const o = writer.mapOverviewRow({ ...r, overviewKind: 'gp', overviewValue: 0.282, overviewCompanion: 43 }, 30);
  assert.equal(b.overview.value, null); assert.equal(o.overviewValue, null);
  assert(b.financialDataReasons.includes(REASON)); assert(o.financialDataReasons.includes(REASON));
  for (const row of [b, o]) { assert.equal(row.rank, 31); assert.equal(row.score, 80); }
  assert.equal(b.overview.companion, 43); assert.equal(o.overviewCompanion, 43);
  assert.equal(JSON.stringify(s), before); assert.equal(JSON.stringify(r), original);
});

test('a dated adjacent snapshot releases the hold; a dated 639-day gap stays under P158', () => {
  const s = pghl(); s.annual.annualGPEnds = ['2026-03-31', '2025-03-31', '2024-03-31', '2023-03-31'];
  const released = writerFor(s).mapBoardRow(board(), 30);
  assert.equal(released.overview.value, 0.282);
  assert(!released.financialDataReasons?.includes(REASON));
  s.annual.annualGPEnds = ['2026-03-31', '2024-06-30', '2023-06-30', '2022-06-30'];
  const gap = writerFor(s).mapBoardRow(board(), 30);
  assert.equal(overviewMetric(s).value, null); assert.equal(gap.overview.value, null);
  assert(gap.financialDataReasons.includes('Jahreswachstum nicht belegt, Jahre liegen nicht hintereinander'));
});

test('missing, invalid or mismatching snapshot evidence cannot release PGHL; zero growth can', () => {
  for (const ends of [[null, null, null, null], ['2025-12-31'], ['2026-02-30', '2025-03-31', null, null]]) {
    const s = pghl(); s.annual.annualGPEnds = ends;
    assert.equal(writerFor(s).mapBoardRow(board(), 0).overview.value, null);
  }
  assert.equal(writerFor(null).mapBoardRow(board(), 0).overview.value, null);
  const s = pghl(); s.annual.annualGPEnds = ['2026-03-31', '2025-03-31', '2024-03-31', '2023-03-31'];
  s.annual.annualGP[0].value = s.annual.annualGP[1].value;
  assert.equal(writerFor(s).mapBoardRow(board(), 0).overview.value, null);
  assert.equal(writerFor(s).mapBoardRow(board('PGHL.BO', 0), 0).overview.value, 0);
});

test('only the named GP display is held; smallcap uses its own snapshot', () => {
  const s = pghl(), writer = writerFor(s);
  assert.equal(overviewGrowthHold('PGHL.NS', s), null);
  assert.equal(writer.mapBoardRow(board('CONTROL'), 0).overview.value, 0.282);
  assert.equal(writer.mapBoardRow(board('PGHL.BO', 0.282, 'revenue-badge'), 0).overview.value, 0.282);
  const dated = pghl(); dated.annual.annualGPEnds = ['2026-03-31', '2025-03-31', '2024-03-31', '2023-03-31'];
  const separate = writerFor(dated, s);
  assert.equal(separate.mapBoardRow(board(), 0).overview.value, 0.282);
  assert.equal(separate.mapBoardRow(board(), 0, 'smallcap').overview.value, null);
  assert.equal(writerFor(s, dated).mapBoardRow(board(), 0, 'smallcap').overview.value, 0.282);
});

test('Rule of 40 carries the withheld value and its existing financial reason channel', () => {
  const { baueZeilen } = require('../scripts/write-rule40-export.js');
  const row = writerFor(pghl()).mapBoardRow(board(), 30);
  const rows = baueZeilen([{ ticker: 'PGHL.BO', row, onBoard: true, branch: 'health-care',
    wachstumRoh: 30, fcfMarginPct: 30, ebitdaMarginPct: null, marketCap: 1e10, industry: 'Biotechnology' }]).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].overviewValue, null);
  assert(rows[0].financialDataReasons.includes(REASON));
});
