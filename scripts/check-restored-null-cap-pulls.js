'use strict';
// C9 dry run: real selection, ordering and pullAll; virtual writers and fake Yahoo.
// Input paths are explicit. No live financial files are written or network calls made.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const assert = require('assert/strict');
const crypto = require('crypto');
const { fixture, NOW, DEFAULT } = require('../tests/stale-quarter-reload.test.js');
const { assertRestoration, pruneCopy, restored, evidence } = require('../tests/restore-pruned-null-cap.test.js');
const R = require('../lib/stale-quarter-reload.js');
const { prepareRanks } = require('./prepare-stale-quarter-ranks.js');
const { mergeCandidates } = require('./plan-stale-quarter-reload.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const root = path.resolve(__dirname, '..');
const clone = x => JSON.parse(JSON.stringify(x));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

async function run() {
  const snapshotDir = process.env.SCREENER_SNAPSHOTS_DIR;
  const boardDir = process.env.C9_BOARD_DIR;
  const cacheDir = process.env.C9_CACHE_DIR;
  for (const dir of [snapshotDir, boardDir, cacheDir]) assert(dir && fs.statSync(dir).isDirectory(), 'explicit input directory required');
  const wlPath = path.join(root, 'watchlist.json'), beforeHash = hash(fs.readFileSync(wlPath));
  const wl = JSON.parse(fs.readFileSync(wlPath));
  const base = JSON.parse(cp.execFileSync('git', ['show', evidence.baseline + ':watchlist.json'], { cwd: root, encoding: 'utf8', maxBuffer: 20000000 }));
  assert.deepEqual({ ...wl, stocks: wl.stocks.filter(s => !restored.has(s.ticker)) }, base,
    'zero unrelated watchlist edits, including row order and metadata');
  const snapshots = new Map(), caches = new Map();
  for (const s of wl.stocks) {
    for (const [dir, map] of [[snapshotDir, snapshots], [cacheDir, caches]]) {
      const p = path.join(dir, safeSnapshotFilename(s.ticker));
      if (fs.existsSync(p)) map.set(s.ticker, fs.readFileSync(p));
    }
  }
  assertRestoration(pruneCopy(wl, new Map([...snapshots].map(([t, b]) => [safeSnapshotFilename(t).slice(0, -5), b.toString()]))));
  const smallcap = new Set(JSON.parse(fs.readFileSync(path.join(root, 'watchlist-smallcap.json'))).stocks.map(s => s.ticker));
  const seed = fixture({ snapshots: [] });
  const stocks = wl.stocks.filter(s => !seed.Y.ueberspringtSmallcapTicker({ aufSmallcapListe: smallcap.has(s.ticker), hatSnapshot: snapshots.has(s.ticker) }));
  for (const t of restored) assert(stocks.some(s => s.ticker === t), 'restoration skipped by ownership: ' + t);
  const calendar = JSON.parse(fs.readFileSync(path.join(root, 'earnings-calendar.json')));
  const warnings = [];
  const ranks = await prepareRanks(async file => {
    const p = path.join(boardDir, file);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p)) : null;
  }, warning => warnings.push(warning));
  assert(Object.keys(ranks.ranks).length, 'dry run needs actual board ranks');
  const count = 17, date = new Date(NOW).toISOString().slice(0, 10);
  const plans = Array.from({ length: count }, (_, index) => {
    const shard = { index, count }, rows = seed.Y.shardStocks(stocks, shard);
    return { date, shard, config: DEFAULT, ...R.planReload(rows, { snapshotDir, cacheDir, calendar, ranks: ranks.ranks, now: NOW, config: DEFAULT, shard }) };
  });
  assert(plans.every(p => p.readErrors === 0), 'unreadable selection inputs');
  const selection = mergeCandidates(plans, DEFAULT, count, date);
  const oldPlans = plans.map(p => ({ ...p, ...R.planReload(seed.Y.shardStocks(stocks.filter(s => !restored.has(s.ticker)), p.shard),
    { snapshotDir, cacheDir, calendar, ranks: ranks.ranks, now: NOW, config: DEFAULT, shard: p.shard }) }));
  assert.deepEqual(selection, mergeCandidates(oldPlans, DEFAULT, count, date), 'zero other quarter selections changed');
  const result = { runAt: new Date(NOW).toISOString(), watchlistBefore: base.stocks.length, watchlistAfter: wl.stocks.length,
    processed: stocks.length, snapshotCount: snapshots.size, cacheCount: caches.size, boardAt: ranks.generated_at,
    quarterEligible: selection.eligible, quarterSelected: selection.selected.length, warnings,
    otherWatchlistChanges: 0, otherOrderingChanges: 0, otherPullModeChanges: 0, otherBudgetChanges: 0, restored: [] };
  for (let index = 0; index < count; index++) {
    const shard = { index, count }, rows = seed.Y.shardStocks(stocks, shard);
    const execute = async enable => {
      const f = fixture({ snapshots: [], ranks: ranks.ranks, calendar, selection, shard,
        env: { STALE_QUARTER_RELOAD: 'planned', RUN_DATE_UTC: date } });
      for (const s of rows) {
        if (snapshots.has(s.ticker)) f.files.set(path.join(f.out, f.Y.safeSnapshotFilename(s.ticker)), snapshots.get(s.ticker));
        if (caches.has(s.ticker)) f.files.set(path.join(root, 'fundamentals-cache', f.Y.safeSnapshotFilename(s.ticker)), caches.get(s.ticker));
      }
      const input = clone(rows);
      if (!enable) for (const s of input) delete s.restoreFullPullOn;
      const watchlist = { stocks: input, _pullShard: shard };
      const manifest = await f.Y.pullAll(watchlist, f.out, 0);
      const full = new Set(f.logs.map(line => line.match(/\[INFO\] Pulling (\S+) \(/)?.[1]).filter(Boolean));
      const priceOnly = new Set(manifest.results.filter(r => r.status === 'price-only').map(r => r.ticker));
      const modes = new Map(watchlist.stocks.map(s => {
        assert(full.has(s.ticker) || priceOnly.has(s.ticker), 'unobserved pull mode: ' + s.ticker);
        return [s.ticker, full.has(s.ticker) ? 'full' : 'price-only'];
      }));
      const budget = f.logs.find(line => line.includes('Fundamentals-refresh budget:'));
      assert(budget && /budget: \d+\/\d+ time-based/.test(budget), 'budget observation required');
      return { modes, calls: f.calls, budget, order: [...modes.keys()] };
    };
    const before = await execute(false), after = await execute(true);
    assert.deepEqual(after.order.filter(t => !restored.has(t)), before.order.filter(t => !restored.has(t)), 'other relative order: shard ' + index);
    assert.deepEqual([...after.modes].filter(([t]) => !restored.has(t)), [...before.modes].filter(([t]) => !restored.has(t)), 'other pull modes: shard ' + index);
    assert.equal(after.budget, before.budget, 'other budgets: shard ' + index);
    for (const t of restored) if (after.modes.has(t)) {
      assert.equal(after.modes.get(t), 'full', 'full pull required: ' + t);
      assert(after.order.indexOf(t) < rows.filter(s => restored.has(s.ticker)).length, 'must start before ordinary work');
      assert.equal(after.calls.filter(([name, method]) => name === t && method.includes('/')).length, 4, 'all financial series: ' + t);
      result.restored.push({ ticker: t, shard: index, before: before.order.indexOf(t) + 1, after: after.order.indexOf(t) + 1,
        total: rows.length, mode: after.modes.get(t), financialRequests: 4 });
    }
  }
  assert.equal(result.restored.length, 5);
  assert.equal(hash(fs.readFileSync(wlPath)), beforeHash, 'live watchlist unchanged');
  for (const [dir, inputs] of [[snapshotDir, snapshots], [cacheDir, caches]]) {
    for (const [ticker, data] of inputs) assert.equal(hash(fs.readFileSync(path.join(dir, safeSnapshotFilename(ticker)))), hash(data), 'live input changed: ' + ticker);
  }
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
