'use strict';
// B5: actual pullAll -> prune -> scoring/excluded output, isolated in-memory I/O.
// --break-once compiles mutants in child processes, never edits production files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const cp = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');

if (process.argv.includes('--break-once')) {
  for (const mutation of ['stale-cap', 'watchlist-age', 'survival-leak']) {
    const r = cp.spawnSync(process.execPath, [__filename], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, B5_MUTATION: mutation },
    });
    assert.equal(r.status, 1, mutation + ' must fail, not pass/crash in the runner');
    const expected = {
      'stale-cap': /old market cap must be absent/,
      'watchlist-age': /prune attempted an early exit: 1|first absence must not inherit watchlist age/,
      'survival-leak': /missing cap must be visibly excluded/,
    };
    assert.match(r.stderr, expected[mutation]);
    console.log('BREAK_ONCE ' + mutation + ' exit=1 detected=true ' + r.stderr.trim().split('\n')[0]);
  }
  process.exit(0);
}

const out = path.join(ROOT, '_scratch', 'b5-virtual', 'snapshots');
const incoming = path.join(ROOT, '_scratch', 'b5-virtual', 'incoming');
const merged = path.join(ROOT, '_scratch', 'b5-virtual', 'merged');
const wlPath = path.join(ROOT, '_scratch', 'b5-virtual', 'watchlist.json');
const virtualRoot = path.dirname(out);
const files = new Map(), fds = new Map(), writes = [], unlinks = [];
let nextFd = 900000, now = Date.parse('2026-09-27T00:00:00.000Z');
let cap = null, quoteCalls = 0, fullCalls = 0, ftsCalls = 0;
const ticker = process.env.B5_HISTORICAL === '1' ? '300475.SZ' : 'B5FIX';
const filename = ticker + '.json';
const snapPath = path.join(out, filename);
const cachePath = path.join(ROOT, 'fundamentals-cache', filename);
const norm = p => path.resolve(String(p));
const isVirtual = p => norm(p).startsWith(virtualRoot + path.sep) || norm(p) === virtualRoot || norm(p) === cachePath;
const original = {};
for (const k of ['readFileSync', 'existsSync', 'openSync', 'readSync', 'closeSync', 'readdirSync']) original[k] = fs[k].bind(fs);
const sourceRead = original.readFileSync;
const compile = Module.prototype._compile;
Module.prototype._compile = function (source, name) {
  if (process.env.B5_MUTATION === 'stale-cap' && name === path.join(ROOT, 'pull-yahoo.js')) {
    const before = 'snapshot.marketCap = { value: null, source, confidence: 0, asOf: observedAt, missing: true };';
    assert(source.includes(before), 'mutation anchor missing');
    source = source.replace(before, 'snapshot.marketCap = { value: snapshot.marketCap?.value ?? null, source, confidence: 0, asOf: observedAt, missing: true };');
  }
  if (process.env.B5_MUTATION === 'watchlist-age' && name === path.join(ROOT, 'scripts', 'prune-watchlist.js')) {
    const before = "let missingSince = typeof entry.missingSnapshotSince === 'string' ? Date.parse(entry.missingSnapshotSince) : NaN;";
    assert(source.includes(before), 'mutation anchor missing');
    source = source.replace(before, 'let missingSince = Date.parse(entry.added_at);');
  }
  if (process.env.B5_MUTATION === 'survival-leak' && name === path.join(ROOT, 'src', 'scoring', 'score.js')) {
    const guard = /  if \(s && s\.marketCap && s\.marketCap\.missing === true &&\r?\n      !Number\.isFinite\(s\.marketCap\.value\)\) return true;\r?\n/;
    assert(guard.test(source), 'mutation anchor missing');
    source = source.replace(guard, '');
  }
  if (process.env.B5_BASELINE === '1' && name === path.join(ROOT, 'pull-yahoo.js')) {
    source = cp.execFileSync('git', ['show', 'HEAD:pull-yahoo.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 2000000 });
  }
  return compile.call(this, source, name);
};
fs.readFileSync = (p, ...a) => files.has(norm(p)) ? files.get(norm(p)) : original.readFileSync(p, ...a);
fs.existsSync = p => files.has(norm(p)) || norm(p) === out || norm(p) === merged || norm(p) === incoming ||
  (isVirtual(p) ? false : original.existsSync(p));
fs.openSync = (p, ...a) => {
  if (files.has(norm(p))) { const fd = nextFd++; fds.set(fd, Buffer.from(files.get(norm(p)))); return fd; }
  if (isVirtual(p)) throw Error('Virtual file absent');
  return original.openSync(p, ...a);
};
fs.readSync = (fd, b, offset, len, pos) => fds.has(fd) ? fds.get(fd).copy(b, offset, pos ?? 0, (pos ?? 0) + len) : original.readSync(fd, b, offset, len, pos);
fs.closeSync = fd => fds.has(fd) ? fds.delete(fd) : original.closeSync(fd);
fs.readdirSync = (p, ...a) => isVirtual(p) ? [...files.keys()].filter(f => path.dirname(f) === norm(p)).map(f => path.basename(f)) : original.readdirSync(p, ...a);
fs.mkdirSync = p => { assert(isVirtual(p) || norm(p) === path.dirname(cachePath), 'unexpected mkdir'); };
fs.unlinkSync = p => { assert(isVirtual(p), 'unexpected unlink'); unlinks.push(norm(p)); files.delete(norm(p)); };
for (const k of ['writeFileSync', 'appendFileSync', 'renameSync', 'rmSync']) fs[k] = () => { throw Error('NO DISK WRITE: ' + k); };
global.fetch = () => { throw Error('NO NETWORK'); };
const RealDate = Date;
global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
const silent = () => {};
const print = console.log.bind(console);
console.log = console.warn = console.error = silent;
class FakeYahoo {
  async quote() { quoteCalls++; return { symbol: ticker, currency: 'USD', regularMarketPrice: 120, ...(cap === undefined ? {} : { marketCap: cap }) }; }
  async quoteSummary() { fullCalls++; return { price: { symbol: ticker, currency: 'USD', marketCap: cap, regularMarketPrice: 120 }, financialData: { financialCurrency: 'USD' }, summaryProfile: { sector: 'Technology', industry: 'Semiconductors', country: 'United States' } }; }
  async fundamentalsTimeSeries() { ftsCalls++; return []; }
}
const load = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === 'yahoo-finance2') return { default: FakeYahoo };
  if (/[/\\]atomic-write\.js$/.test(req)) return { writeFileAtomic: (p, raw) => {
    assert(isVirtual(p), 'unexpected atomic write ' + path.basename(p)); writes.push(norm(p)); files.set(norm(p), raw);
  } };
  return load.call(this, req, parent, ...rest);
};
const { pullAll, mergeSmallcapSnapshots } = require('../pull-yahoo.js');
const { main: prune } = require('../scripts/prune-watchlist.js');
// Turn prune's fail-closed CLI exit into a guard failure rather than losing the
// assertion diagnostics (the watchlist-age mutant trips its over-prune floor).
process.exit = code => { throw new Error('prune attempted an early exit: ' + code); };
const { scoreUniverse, produceRankings } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas');
const { buildExcludedList } = require('../scripts/write-excluded-list.js');
const { smallcapRoute } = require('../src/scoring/smallcap-route.js');
const day = 86400000, iso = days => new Date(now - days * day).toISOString();
let stock = { ticker, yahoo_symbol: ticker, name: 'B5 synthetic issuer', sector: 'Technology', added_at: '2020-01-01T00:00:00.000Z' };
let seed = {
  meta: { ticker, name: stock.name, country: 'United States', sector: 'Technology', industry: 'Semiconductors', reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', fxRateApplied: 1, asOf: iso(1), fetchedAt: iso(10), fundamentalsAsOf: iso(10) },
  marketCap: { value: 5e9, source: 'yahoo_quote', confidence: 0.9, asOf: iso(1) },
  price: { regularMarketPrice: 100, currency: 'USD', currencyUnit: 'USD' },
  annual: { annualRev: [1e9, 8e8, 6e8, 4e8], annualOpInc: [2e8, 1.4e8, 1e8, 6e7], annualNetIncome: [1.5e8, 1e8, 7e7, 4e7], annualGP: [5e8, 3.6e8, 2.4e8, 1.6e8], annualFCF: [1.6e8, 1.1e8, 8e7, 5e7], annualOCF: [1.8e8, 1.2e8, 9e7, 6e7], annualSGA: [1e8, 8e7, 6e7, 4e7], annualShares: [1e8, 1e8, 1e8, 1e8], annualBalance: [{ currentAssets: 1e9, currentLiabilities: 2e8, totalLiabilities: 3e8 }] },
  timeseries: { revenueQ: [3e8, 2.6e8, 2.4e8, 2e8, 1.8e8, 1.6e8, 1.5e8, 1.1e8].map(value => ({ value })) }, metrics: {},
};
if (process.env.B5_HISTORICAL === '1') {
  const pit = JSON.parse(sourceRead(path.join(ROOT, 'board-history/2026-09-24/semiconductors.json'), 'utf8')).cohort.profitable.find(r => r.ticker === ticker).pit;
  stock = JSON.parse(cp.execFileSync('git', ['show', '6f11048063:watchlist.json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 15000000 })).stocks.find(r => r.ticker === ticker);
  seed = { meta: { ticker, name: stock.name, sector: 'Technology', industry: 'Semiconductors', country: 'China', asOf: pit.fetchedAt, fetchedAt: pit.fetchedAt, fundamentalsAsOf: pit.fetchedAt, reportingCurrency: 'USD', reportingCurrencyOriginal: pit.reportingCurrencyOriginal, fxRateApplied: pit.fxRateApplied }, marketCap: { value: pit.marketCap, asOf: pit.fetchedAt }, annual: {}, metrics: {}, timeseries: { revenueQ: pit.revenueQ.map(value => ({ value })), revenueQEnds: pit.revenueQEnds, grossProfitQ: pit.grossProfitQ.map(value => ({ value })), grossProfitQEnds: pit.grossProfitQEnds } };
}
const cache = JSON.stringify({ _cacheVersion: 2, cachedAt: iso(40), payload: { retained: 'financial-cache-sentinel' } });
const read = p => JSON.parse(files.get(p));
function reset(age = 1) {
  files.clear(); writes.length = unlinks.length = 0; quoteCalls = fullCalls = ftsCalls = 0;
  const s = structuredClone(seed); s.meta.asOf = iso(age);
  files.set(snapPath, JSON.stringify(s)); files.set(cachePath, cache);
  files.set(wlPath, JSON.stringify({ stocks: [{ ...stock }], preservedSidecar: 'unchanged' }));
  return s;
}
function runPrune(extra = []) { prune(['node', 'prune', '--watchlist', wlPath, '--snapshots', out, ...extra]); }
function visible(s) {
  const scored = scoreUniverse([s], formulas);
  assert.equal(scored[0].action, 'exclude', 'missing cap must be visibly excluded'); assert.equal(scored[0].score, null);
  const excluded = buildExcludedList(scored, [s]);
  assert.equal(excluded.legs, 1); assert.equal(excluded.rows[0].ticker, ticker); assert.equal(excluded.rows[0].marketCap, null);
  assert(!JSON.stringify(produceRankings(scored)).includes('"ticker":"' + ticker + '"'), 'missing cap must have no rank');
  return excluded.rows[0].reason;
}
async function run() {
  // Both fast and forced-full paths, including a snapshot older than the young gate.
  for (const age of [1, 40]) for (const unavailable of [null, undefined, NaN, Infinity, -Infinity]) {
    cap = unavailable; const before = reset(age);
    const result = await pullAll({ stocks: [stock] }, out, 0);
    assert.equal(result.results[0]?.status, 'missing-market-cap');
    const s = read(snapPath);
    assert.equal(s.marketCap.value, null, 'old market cap must be absent'); assert.equal(s.marketCap.missing, true);
    assert.equal(s.marketCap.asOf, iso(0));
    const withoutCap = x => { const y = structuredClone(x); delete y.marketCap; return y; };
    assert.deepEqual(withoutCap(s), withoutCap(before), 'financials, price and freshness must survive unchanged');
    assert.equal(files.get(cachePath), cache); assert.deepEqual(unlinks, []); assert.equal(ftsCalls, 0);
    assert.equal(result.n_ok, 0); assert.equal(result.n_skipped_mcap, 0, 'missing data stays in coverage denominator');
    runPrune(); assert.equal(read(wlPath).stocks.length, 1); assert(!Object.hasOwn(read(wlPath).stocks[0], 'missingSnapshotSince'));
    visible(s);
  }
  print('PASS B5 null/non-finite: snapshot+financials+cache+watchlist+visible exclusion; no stale cap/rank/unlink/false freshness');
  if (process.env.B5_HISTORICAL === '1') {
    print('E2E_300475 null -> snapshot kept -> marketCap.value=null -> visible exclusion=' + visible(read(snapPath)) + ' -> watchlist kept; prior financial values/dates from 2026-09-24 PIT unchanged');
    return;
  }
  // One successful quote recovers the current size; fundamental timestamps stay old.
  cap = 6e9; const before = structuredClone(read(snapPath)); before.meta.asOf = iso(1); files.set(snapPath, JSON.stringify(before));
  let r = await pullAll({ stocks: [stock] }, out, 0); let s = read(snapPath);
  assert.equal(r.results[0].status, 'price-only'); assert.equal(s.marketCap.value, cap); assert(!s.marketCap.missing);
  assert.equal(s.marketCap.asOf, iso(0)); assert.deepEqual(s.annual, before.annual); assert.equal(s.meta.fundamentalsAsOf, before.meta.fundamentalsAsOf);
  print('PASS B5 finite quote recovery clears missing flag and preserves fundamentals');
  // Clearing the only former numeric field must not trigger the separate stale-
  // sparse-snapshot pruning rule. Confirmed delistings retain their own policy.
  reset(100); cap = null;
  const thin = { meta: { ticker, name: stock.name, asOf: iso(100), fetchedAt: iso(100), fundamentalsAsOf: iso(100) }, marketCap: { value: 5e9 }, annual: {}, metrics: {}, timeseries: {} };
  files.set(snapPath, JSON.stringify(thin));
  await pullAll({ stocks: [stock] }, out, 0); runPrune();
  assert.equal(read(wlPath).stocks.length, 1); assert.equal(read(snapPath).meta.fetchedAt, thin.meta.fetchedAt);
  visible(read(snapPath));
  print('PASS B5 old sparse snapshot remains present, excluded and unpruned on null');
  // Cold worker + warm merged store: do not overwrite the merged financials.
  cap = null; reset(); files.delete(snapPath);
  await pullAll({ stocks: [stock] }, out, 0); s = read(snapPath);
  assert.equal(s.meta.fetchedAt, null); assert.equal(s.meta.fundamentalsAsOf, null); assert.deepEqual(s.annual, {});
  files.set(path.join(incoming, filename), files.get(snapPath));
  const originalMerged = structuredClone(seed); originalMerged.marketCap.value = 5e8;
  files.set(path.join(merged, filename), JSON.stringify(originalMerged));
  files.set(path.join(incoming, 'CONTROL.json'), JSON.stringify({ meta: { ticker: 'CONTROL' }, marketCap: { value: 5e8 } }));
  assert.equal(mergeSmallcapSnapshots(incoming, merged).missingMarketCaps, 1);
  const m = read(path.join(merged, filename)); assert.equal(m.marketCap.value, null); assert.deepEqual(m.annual, originalMerged.annual); assert.deepEqual(m.meta, originalMerged.meta);
  assert.equal(smallcapRoute(m).action, 'exclude'); visible(m);
  assert.equal(files.get(path.join(merged, 'CONTROL.json')), files.get(path.join(incoming, 'CONTROL.json')));
  const workflow = sourceRead(path.join(ROOT, '.github/workflows/smallcap-pull.yml'), 'utf8');
  assert.match(workflow, /path: snapshots-smallcap-incoming/); assert.match(workflow, /mergeSmallcapSnapshots\('snapshots-smallcap-incoming', 'snapshots-smallcap'\)/);
  assert(workflow.indexOf('name: Merge small-cap observations') < workflow.indexOf('name: Small-Cap Freshness'));
  print('PASS B5 cold-worker merge: null wins, financials survive, valid control byte-identical');
  // Explicit missing-size observations must not leak into the Survival board.
  // A measured cap still permits Survival, including with a leftover missing flag.
  for (const missing of [null, undefined, NaN, Infinity, -Infinity]) {
    const cold = structuredClone(s); cold.marketCap.value = missing;
    assert.equal(visible(cold), 'data-suspect', 'excluded list must retain its reason');
  }
  const finite = structuredClone(s); finite.marketCap.value = 5e9; delete finite.marketCap.missing;
  const finiteScored = scoreUniverse([finite], formulas);
  assert.equal(finiteScored[0].action, 'survival', 'measured-cap pre-revenue control must retain Survival');
  assert(produceRankings(finiteScored).survival.some(r => r.ticker === ticker));
  finite.marketCap.missing = true;
  assert.equal(JSON.stringify(scoreUniverse([finite], formulas)), JSON.stringify(finiteScored), 'finite scoring must ignore the missing flag');
  print('PASS B5 real scorer: missing cap visibly excluded with reason, no Survival rank; measured-cap output byte-identical');
  // First absence is persisted even without removals and without --force.
  reset(); files.delete(snapPath); const raw = files.get(wlPath); const n = writes.length;
  runPrune(['--dry-run']); assert.equal(files.get(wlPath), raw); assert.equal(writes.length, n);
  runPrune(); assert.equal(read(wlPath).stocks[0].missingSnapshotSince, iso(0), 'first absence must not inherit watchlist age');
  assert.equal(read(wlPath).lastAutoPrune, undefined); assert.equal(read(wlPath).preservedSidecar, 'unchanged');
  now += day; runPrune(); assert.equal(read(wlPath).stocks.length, 1);
  files.set(snapPath, JSON.stringify(seed)); runPrune(); assert(!Object.hasOwn(read(wlPath).stocks[0], 'missingSnapshotSince'));
  files.delete(snapPath); runPrune(); const restarted = read(wlPath).stocks[0].missingSnapshotSince;
  now += 30 * day; runPrune(); assert.equal(read(wlPath).stocks[0].missingSnapshotSince, restarted);
  now += day; runPrune(['--force']); assert.equal(read(wlPath).stocks.length, 0); assert.equal(read(wlPath).lastAutoPruneRemoved[0].reason, 'no-snapshot-after-30d');
  for (const bad of ['invalid', 0, new Date(now + day).toISOString()]) {
    reset(); files.delete(snapPath); const w = read(wlPath); w.stocks[0].missingSnapshotSince = bad; files.set(wlPath, JSON.stringify(w)); runPrune(); assert.equal(read(wlPath).stocks[0].missingSnapshotSince, iso(0));
  }
  const w = read(wlPath); files.set(snapPath, '{broken'); runPrune(); assert(!Object.hasOwn(read(wlPath).stocks[0], 'missingSnapshotSince'));
  print('PASS B5 absence clock: day1 kept, return resets, day30 kept/day31 pruned, invalid/future reset, corrupt present protected, dry-run no writes');
  // Measured below-floor handling remains destructive, rather than being mislabelled missing.
  reset(40); cap = 1e6; r = await pullAll({ stocks: [stock] }, out, 0);
  assert.equal(r.results[0]?.status, 'skipped-mcap'); assert(!files.has(snapPath)); assert(!files.has(cachePath));
  print('PASS B5 measured below-floor control unchanged');
}

async function validControl() {
  for (const age of [1, 40]) {
    reset(age); cap = 5e9;
    const r = await pullAll({ stocks: [stock] }, out, 0);
    assert.equal(r.results[0]?.status, age === 1 ? 'price-only' : 'ok');
    print('VALID_CONTROL ' + JSON.stringify({ age, snapshot: read(snapPath), cache: files.get(cachePath) }));
  }
}
(process.argv.includes('--valid-only') ? validControl() : run()).then(() => print('B5_GUARD_PASS diskWrites=0 networkCalls=0'))
  .catch(e => { process.stderr.write('B5_GUARD_FAILURE: ' + e.message + '\n' + e.stack + '\n'); process.exitCode = 1; });
