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
  for (const mutation of ['stale-cap', 'watchlist-age', 'survival-leak', 'fast-null-final', 'placeholder', 'streak', 'legacy-prune', 'empty-summary-stale-cap']) {
    const r = cp.spawnSync(process.execPath, [__filename], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, B5_MUTATION: mutation },
    });
    assert.equal(r.status, 1, mutation + ' must fail, not pass/crash in the runner');
    const expected = {
      'stale-cap': /old market cap must be absent/,
      'watchlist-age': /prune attempted an early exit: 1|first absence must not inherit watchlist age/,
      'survival-leak': /missing cap must be visibly excluded/,
      'fast-null-final': /missing quote cap must fall through to full pull/,
      'placeholder': /never-seen main ticker must not get a placeholder/,
      'streak': /real full answer must reset not-found streak/,
      'legacy-prune': /legacy entry without added_at must not be auto-pruned/,
      'empty-summary-stale-cap': /empty full answer must invalidate old market cap/,
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
const writeEvents = [];
let nextFd = 900000, now = Date.parse('2026-09-27T00:00:00.000Z');
let cap = null, quoteCalls = 0, fullCalls = 0, ftsCalls = 0;
let quoteMode = 'normal', fullMode = 'normal', fullCap, quoteCurrency = 'USD';
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
  const regressions = {
    'fast-null-final': ['pull-yahoo.js', "throw new Error('price-only refused: quote without finite marketCap - full pull decides');", "return preserveMissingMarketCap(outputDir, stock, new Date().toISOString(), 'yahoo_quote');"],
    'placeholder': ['pull-yahoo.js', "if (!preserved && process.env.MISSING_CAP_CARRIER !== '1')", "if (false && !preserved && process.env.MISSING_CAP_CARRIER !== '1')"],
    'streak': ['pull-yahoo.js', 'if (snapshot.meta && !keepStreak) delete snapshot.meta.notFoundStreak;', '// mutant: keep the stale not-found streak'],
    'empty-summary-stale-cap': ['pull-yahoo.js', "preserveMissingMarketCap(outputDir, stock, new Date().toISOString(), 'yahoo_quoteSummary', { keepStreak: true });", '// mutant: leave the old market cap after an empty response'],
    'legacy-prune': ['scripts/prune-watchlist.js', 'if ((entry.added_at || entry.addedAt) && absenceDays > args.pruneNoDataDays)', 'if (absenceDays > args.pruneNoDataDays)'],
  };
  const regression = regressions[process.env.B5_MUTATION];
  if (regression && name === path.join(ROOT, regression[0])) {
    assert(source.includes(regression[1]), 'mutation anchor missing');
    source = source.replace(regression[1], regression[2]);
  }
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
    source = cp.execFileSync('git', ['show', 'origin/main:pull-yahoo.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 2000000 });
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
  async quote() {
    quoteCalls++;
    if (quoteMode === 'undefined') return undefined;
    if (quoteMode === 'empty') return {};
    if (quoteMode === 'not-found') throw new Error('Quote not found for symbol');
    return { symbol: ticker, currency: quoteCurrency, regularMarketPrice: 120, ...(cap === undefined ? {} : { marketCap: cap }) };
  }
  async quoteSummary() {
    fullCalls++;
    if (fullMode === 'not-found') throw new Error('Quote not found for symbol');
    if (fullMode === 'empty') return {};
    if (fullMode === 'undefined') return undefined;
    if (fullMode === 'empty-modules') return { price: {}, summaryDetail: {} };
    return { price: { symbol: ticker, currency: 'USD', marketCap: fullCap === undefined ? cap : fullCap, regularMarketPrice: 120 }, financialData: { financialCurrency: 'USD' }, summaryProfile: { sector: 'Technology', industry: 'Semiconductors', country: 'United States' } };
  }
  async fundamentalsTimeSeries() {
    ftsCalls++;
    return []; // Existing snapshot + empty FTS must still allow ordinary cap recovery.
  }
}
const load = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === 'yahoo-finance2') return { default: FakeYahoo };
  if (/[/\\]atomic-write\.js$/.test(req)) return { writeFileAtomic: (p, raw) => {
    assert(isVirtual(p), 'unexpected atomic write ' + path.basename(p)); writes.push(norm(p)); writeEvents.push({ path: norm(p), raw }); files.set(norm(p), raw);
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
  writeEvents.length = 0; quoteMode = fullMode = 'normal'; fullCap = undefined; quoteCurrency = 'USD';
  delete process.env.MISSING_CAP_CARRIER;
  const s = structuredClone(seed); s.meta.asOf = iso(age);
  files.set(snapPath, JSON.stringify(s)); files.set(cachePath, cache);
  files.set(wlPath, JSON.stringify({ stocks: [{ ...stock }], preservedSidecar: 'unchanged' }));
  return s;
}
const reviewCases = {
  async fallback() {
    for (const mode of ['undefined', 'empty', 'normal', 'overflow']) {
      reset(); cap = undefined; quoteMode = mode === 'overflow' ? 'normal' : mode; fullCap = 5.5e9;
      if (mode === 'overflow') { cap = Number.MAX_VALUE; quoteCurrency = 'GBP'; }
      const result = await pullAll({ stocks: [stock] }, out, 0);
      assert.equal(fullCalls, 1, 'missing quote cap must fall through to full pull: ' + mode);
      assert.equal(result.results[0]?.status, 'ok'); assert.equal(read(snapPath).marketCap.value, 5.5e9);
    }
    reset(); cap = null;
    const result = await pullAll({ stocks: [stock] }, out, 0);
    assert.equal(fullCalls, 1); assert.equal(result.results[0]?.status, 'missing-market-cap');
    assert.equal(read(snapPath).marketCap.value, null);
  },
  async placeholder() {
    reset(); cap = null; files.delete(snapPath);
    const result = await pullAll({ stocks: [stock] }, out, 0);
    assert.equal(result.results[0]?.status, 'missing-market-cap');
    assert.equal(result.results[0]?.preserved, false);
    assert(!files.has(snapPath), 'never-seen main ticker must not get a placeholder');
    assert.equal(files.get(cachePath), cache);
    runPrune(); assert.equal(read(wlPath).stocks[0].missingSnapshotSince, iso(0));
  },
  async carrier() {
    reset(); cap = null; files.delete(snapPath); process.env.MISSING_CAP_CARRIER = '1';
    await pullAll({ stocks: [stock] }, out, 0); delete process.env.MISSING_CAP_CARRIER;
    const carrier = read(snapPath); assert.equal(carrier.marketCap.value, null); assert.equal(carrier.meta.asOf, null);
    files.set(path.join(incoming, filename), files.get(snapPath));
    mergeSmallcapSnapshots(incoming, merged);
    assert(!files.has(path.join(merged, filename)), 'cold merged store must not receive a raw carrier');
    files.set(path.join(merged, filename), JSON.stringify(seed));
    mergeSmallcapSnapshots(incoming, merged);
    assert.equal(read(path.join(merged, filename)).marketCap.value, null);
    assert.deepEqual(read(path.join(merged, filename)).annual, seed.annual);
  },
  async streak() {
    reset(); cap = null; const s = read(snapPath); s.meta.notFoundStreak = 1; files.set(snapPath, JSON.stringify(s));
    await pullAll({ stocks: [stock] }, out, 0);
    assert(!Object.hasOwn(read(snapPath).meta, 'notFoundStreak'), 'real full answer must reset not-found streak');
    quoteMode = fullMode = 'not-found';
    await pullAll({ stocks: [stock] }, out, 0);
    assert.equal(read(snapPath).meta.notFoundStreak, 1); assert(!read(snapPath).meta.delisted);
    runPrune(); assert.equal(read(wlPath).stocks.length, 1);
    reset(); cap = null; const empty = read(snapPath); empty.meta.notFoundStreak = 1; files.set(snapPath, JSON.stringify(empty));
    quoteMode = fullMode = 'empty'; await pullAll({ stocks: [stock] }, out, 0);
    assert.equal(read(snapPath).meta.notFoundStreak, 1, 'empty responses cannot confirm the company is alive');
    assert.equal(read(snapPath).marketCap.value, null, 'empty full answer must invalidate old market cap');
  },
  async emptySummary() {
    for (const mode of ['empty', 'undefined', 'empty-modules']) {
      for (const age of [1, 40]) {
        reset(age); cap = undefined; fullMode = mode;
        const before = read(snapPath); before.meta.notFoundStreak = 1;
        files.set(snapPath, JSON.stringify(before));
        for (let attempt = 0; attempt < 3; attempt++) {
          const result = await pullAll({ stocks: [stock] }, out, 0);
          const after = read(snapPath);
          assert.equal(after.marketCap.value, null, 'empty full answer must invalidate old market cap');
          assert.equal(after.marketCap.missing, true);
          assert.equal(after.marketCap.asOf, iso(0));
          assert.deepEqual(after.meta, before.meta, 'empty answer must preserve streak and freshness clocks');
          assert.deepEqual(after.annual, before.annual);
          assert.deepEqual(after.timeseries, before.timeseries);
          assert.equal(files.get(cachePath), cache);
          assert.equal(result.n_failed, 1, 'empty full answer must still count as failure');
          assert.equal(result.n_ok, 0);
          assert.equal(result.results.length, 0, 'failure must not also become a successful result');
          visible(after); runPrune(); assert.equal(read(wlPath).stocks.length, 1);
        }
        assert.equal(fullCalls, 3);
        assert(age === 40 || quoteCalls > 0, 'young snapshot must exercise the fast-path fallback');
        assert.equal(unlinks.length, 0);
      }
    }
    reset(); cap = null; fullMode = 'empty'; files.delete(snapPath);
    await pullAll({ stocks: [stock] }, out, 0);
    assert(!files.has(snapPath), 'empty answer must not create a main-store placeholder');
    process.env.MISSING_CAP_CARRIER = '1';
    await pullAll({ stocks: [stock] }, out, 0); delete process.env.MISSING_CAP_CARRIER;
    files.set(path.join(incoming, filename), files.get(snapPath));
    const baseline = structuredClone(seed); baseline.meta.notFoundStreak = 1;
    files.set(path.join(merged, filename), JSON.stringify(baseline));
    mergeSmallcapSnapshots(incoming, merged);
    const afterMerge = read(path.join(merged, filename));
    assert.equal(afterMerge.marketCap.value, null);
    assert.deepEqual(afterMerge.meta, baseline.meta, 'empty carrier must not reset the merge baseline streak');
    assert.deepEqual(afterMerge.annual, baseline.annual);
  },
  async legacy() {
    reset(); files.delete(snapPath); const w = read(wlPath); delete w.stocks[0].added_at;
    files.set(wlPath, JSON.stringify(w)); runPrune();
    assert.equal(read(wlPath).stocks[0].missingSnapshotSince, iso(0));
    now += 40 * day; runPrune(['--force']);
    assert.equal(read(wlPath).stocks.length, 1, 'legacy entry without added_at must not be auto-pruned');
    files.set(snapPath, JSON.stringify(seed)); runPrune(); assert(!read(wlPath).stocks[0].missingSnapshotSince);
  },
  async counts() {
    reset(); cap = null; const result = await pullAll({ stocks: [stock] }, out, 0);
    assert.equal(result.n_missing_mcap, 1, 'pull summary must count missing caps');
    const manifests = writeEvents.filter(e => path.basename(e.path).startsWith('_manifest')).map(e => JSON.parse(e.raw));
    assert(manifests.some(m => m.partial === true), 'real incremental manifest must be exercised');
    assert(manifests.some(m => m.partial === false));
    for (const m of manifests) assert.equal(m.n_missing_mcap, 1, 'every manifest must count missing caps');
    const { mergeManifests } = require('../scripts/merge-shard-manifests');
    const latest = manifests.find(m => m.partial === false);
    const legacy = { ...latest }; delete legacy.n_missing_mcap;
    assert.equal(mergeManifests([latest, legacy], 2, 2).n_missing_mcap, 1, 'daily merge must retain the missing-cap counter');
    for (const bad of [-1, NaN, null, '1']) {
      assert.equal(mergeManifests([{ ...latest, n_missing_mcap: bad }], 1, 1).n_shards_invalid, 1);
    }
  },
  async reason() {
    const s = structuredClone(seed); s.marketCap = { value: null, missing: true };
    assert.equal(smallcapRoute(s).reason, 'smallcap-mcap-missing', 'missing is not a measured out-of-band value');
    s.marketCap.value = 1e6; assert.equal(smallcapRoute(s).reason, 'smallcap-mcap-out-of-band');
  },
  async reserved() {
    reset(); const old = structuredClone(seed); old.meta.ticker = 'CON';
    files.set(path.join(merged, '_CON.json'), JSON.stringify(old));
    files.set(path.join(incoming, '_CON.json'), JSON.stringify({ meta: { ticker: 'CON' }, marketCap: { value: null, missing: true, asOf: iso(0) }, annual: {} }));
    mergeSmallcapSnapshots(incoming, merged);
    const s = read(path.join(merged, '_CON.json'));
    assert.deepEqual(s.annual, old.annual, 'reserved filename must retain financials'); assert.equal(s.marketCap.value, null);
  },
};
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
  process.env.MISSING_CAP_CARRIER = '1';
  await pullAll({ stocks: [stock] }, out, 0); s = read(snapPath); delete process.env.MISSING_CAP_CARRIER;
  assert.equal(s.meta.fetchedAt, null); assert.equal(s.meta.fundamentalsAsOf, null); assert.deepEqual(s.annual, {});
  files.set(path.join(incoming, filename), files.get(snapPath));
  const originalMerged = structuredClone(seed); originalMerged.marketCap.value = 5e8;
  files.set(path.join(merged, filename), JSON.stringify(originalMerged));
  files.set(path.join(incoming, 'CONTROL.json'), JSON.stringify({ meta: { ticker: 'CONTROL' }, marketCap: { value: 5e8 } }));
  assert.equal(mergeSmallcapSnapshots(incoming, merged).missingMarketCaps, 1);
  const m = read(path.join(merged, filename)); assert.equal(m.marketCap.value, null); assert.deepEqual(m.annual, originalMerged.annual); assert.deepEqual(m.meta, originalMerged.meta);
  assert.equal(smallcapRoute(m).action, 'exclude'); visible(m);
  assert.equal(files.get(path.join(merged, 'CONTROL.json')), files.get(path.join(incoming, 'CONTROL.json')));
  const workflow = sourceRead(path.join(ROOT, '.github/workflows/smallcap-pull.yml'), 'utf8').replace(/\r\n/g, '\n');
  function jobSteps(name) {
    const marker = '\n  ' + name + ':\n', start = workflow.indexOf(marker);
    assert(start >= 0, 'workflow job must exist: ' + name);
    const tail = workflow.slice(start + marker.length), end = tail.search(/^  [\w-]+:\s*$/m);
    return (end < 0 ? tail : tail.slice(0, end)).split(/^      - /m).slice(1);
  }
  const steps = jobSteps('merge');
  const download = steps.findIndex(step => /^        uses: actions\/download-artifact@/m.test(step));
  const merge = steps.findIndex(step => /^        run: .*mergeSmallcapSnapshots\(/m.test(step));
  const save = steps.findIndex(step => /^        uses: actions\/cache\/save@/m.test(step));
  assert.match(steps[download], /^          path: snapshots-smallcap-incoming$/m); assert.match(steps[download], /^          merge-multiple: true$/m);
  assert(download < merge && merge < save, 'merge must run after download and before cache save in merge job');
  const carrierSteps = jobSteps('pull').filter(step => /^          MISSING_CAP_CARRIER:/m.test(step));
  assert.equal(carrierSteps.length, 1); assert.match(carrierSteps[0], /^          MISSING_CAP_CARRIER: '1'$/m);
  assert.match(carrierSteps[0], /^        run: node pull-yahoo\.js .*--output snapshots-smallcap/m);
  assert.equal((workflow.match(/^\s*MISSING_CAP_CARRIER:/gm) || []).length, 1);
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
  runPrune(['--force']); assert.equal(read(wlPath).stocks.length, 1, 'first absence must not inherit watchlist age');
  assert.equal(read(wlPath).stocks[0].missingSnapshotSince, iso(0));
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
  for (const [name, check] of Object.entries(reviewCases)) {
    now = Date.parse('2026-09-27T00:00:00.000Z'); // Keep the fast-path fixtures young after the 31-day prune test.
    await check(); print('PASS B5 review ' + name);
  }
}

async function validControl() {
  for (const age of [1, 40]) {
    reset(age); cap = 5e9;
    const r = await pullAll({ stocks: [stock] }, out, 0);
    assert.equal(r.results[0]?.status, age === 1 ? 'price-only' : 'ok');
    print('VALID_CONTROL ' + JSON.stringify({ age, snapshot: read(snapPath), cache: files.get(cachePath) }));
  }
}
const reviewArg = process.argv.find(arg => arg.startsWith('--review-case='));
(reviewArg ? reviewCases[reviewArg.split('=')[1]]() : process.argv.includes('--valid-only') ? validControl() : run()).then(() => print('B5_GUARD_PASS diskWrites=0 networkCalls=0'))
  .catch(e => { process.stderr.write('B5_GUARD_FAILURE: ' + e.message + '\n' + e.stack + '\n'); process.exitCode = 1; });
