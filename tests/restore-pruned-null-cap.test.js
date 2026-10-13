'use strict';
// C9: read-only guards; prune/pull writers run only against in-memory copies.
// Never use a disk-writing test as a break-once target.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { createRequire } = require('module');
const { fixture, snapshot, NOW } = require('./stale-quarter-reload.test.js');
const evidence = require('./fixtures/restore-pruned-null-cap.json');
const root = path.resolve(__dirname, '..');
const livePath = path.join(root, 'watchlist.json');
const restored = new Set(evidence.restored.map(r => r.entry.ticker));
const date = evidence.runAt.slice(0, 10);
const clone = x => JSON.parse(JSON.stringify(x));
const issuerName = name => String(name).toLowerCase().replace(/\bclass\s+[a-z]\b/g, '').replace(/[^a-z0-9]/g, '');

function assertRestoration(watchlist) {
  assert.equal(restored.size, 5);
  assert.equal(Object.keys(evidence.duplicates).length, 13);
  const stocks = watchlist.stocks;
  for (const { entry } of evidence.restored) {
    const rows = stocks.filter(s => s.ticker === entry.ticker);
    assert.equal(rows.length, 1, 'restored ticker missing/duplicated: ' + entry.ticker);
    for (const [key, value] of Object.entries(entry)) assert.equal(rows[0][key], value, entry.ticker + '.' + key);
    assert.equal(rows[0].restoreFullPullOn, date, 'recovery run missing: ' + entry.ticker);
    if (rows[0].missingSnapshotSince !== undefined) {
      const since = Date.parse(rows[0].missingSnapshotSince);
      assert(Number.isFinite(since) && since <= NOW && NOW - since < 30 * 86400000,
        'expired absence clock: ' + entry.ticker);
    }
    assert.equal(stocks.filter(s => issuerName(s.name) === issuerName(entry.name)).length, 1,
      'duplicate restored issuer: ' + entry.ticker);
  }
  for (const ticker of [...evidence.excluded, ...Object.keys(evidence.duplicates)]) {
    // C9 excludes these names from its restoration, not from future discovery.
    // Daily commit 0f049a8372 rediscovered twelve after the restoration cutoff.
    for (const row of stocks.filter(s => s.ticker === ticker)) {
      assert(row.restoreFullPullOn === undefined && typeof row.added_via === 'string' && row.added_via.length > 0
        && Number.isFinite(Date.parse(row.added_at)) && Date.parse(row.added_at) > Date.parse(evidence.runAt),
      'excluded/duplicate ticker re-added: ' + ticker);
    }
  }
  for (const [ticker, listings] of Object.entries(evidence.duplicates)) {
    assert(listings.some(t => stocks.some(s => s.ticker === t)), 'existing issuer listing lost: ' + ticker);
  }
}

function pruneCopy(watchlist, snapshots = new Map()) {
  const filename = path.join(root, 'scripts/prune-watchlist.js');
  const copyPath = path.join(root, '_scratch', 'c9-virtual-watchlist.json');
  const snapshotDir = path.join(root, '_scratch', 'c9-virtual-snapshots');
  assert.notEqual(path.resolve(copyPath), path.resolve(livePath));
  let result = clone(watchlist);
  const io = {
    existsSync: p => snapshots.has(path.basename(p, '.json')),
    readFileSync: p => {
      if (p === copyPath) return JSON.stringify(result);
      assert.equal(path.dirname(p), snapshotDir, 'unexpected prune read');
      const value = snapshots.get(path.basename(p, '.json'));
      assert(value, 'missing virtual snapshot');
      return typeof value === 'string' ? value : JSON.stringify(value);
    }
  };
  const mod = { exports: {} }, localRequire = createRequire(filename);
  class FixedDate extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: mod, exports: mod.exports, __dirname: path.dirname(filename), Date: FixedDate,
    console: { log() {}, warn() {}, error() {} }, process: { exit: c => { throw Error('prune exit ' + c); } },
    require: id => id === 'fs' ? io : id === '../lib/atomic-write.js' ? {
      writeFileAtomic: (p, raw) => { assert.equal(p, copyPath); result = JSON.parse(raw); }
    } : localRequire(id)
  }, { filename });
  mod.exports.main(['node', filename, '--watchlist', copyPath, '--snapshots', snapshotDir]);
  return result;
}

async function run() {
  const wl = JSON.parse(fs.readFileSync(livePath, 'utf8'));
  assertRestoration(wl);
  assertRestoration(pruneCopy(wl));
  const discoveryControl = clone(wl);
  discoveryControl.stocks = discoveryControl.stocks.filter(s => s.ticker !== '1URI.MI');
  const rediscovered = { ticker: '1URI.MI', added_at: '2026-09-29T08:43:34.483Z', added_via: 'tvit' };
  discoveryControl.stocks.push(rediscovered);
  assertRestoration(discoveryControl);
  for (const invalid of [
    { ...rediscovered, restoreFullPullOn: date },
    { ...rediscovered, added_at: evidence.runAt },
    { ...rediscovered, added_at: 'invalid' },
    { ...rediscovered, added_via: '' },
    { ticker: rediscovered.ticker },
  ]) {
    const bad = clone(discoveryControl);
    bad.stocks[bad.stocks.length - 1] = invalid;
    assert.throws(() => assertRestoration(bad), /excluded\/duplicate ticker re-added/);
  }
  console.log('PASS later ordinary discovery allowed; restored, early, undated and unproven exclusions rejected');
  console.log('PASS five restored / thirteen duplicate issuers / two exclusions / real prune');

  const ordinary = [snapshot('OLD'), snapshot('FRESH', '2026-06-30')];
  const recovered = wl.stocks.filter(s => restored.has(s.ticker));
  const f = fixture({ snapshots: ordinary, cap: 1 });
  const stocks = [...ordinary.map(s => ({ ticker: s.meta.ticker, yahoo_symbol: s.meta.ticker })), ...recovered];
  const m = await f.Y.pullAll({ stocks: clone(stocks) }, f.out, 0);
  assert.deepEqual(clone(m.results.slice(0, 5).map(r => r.ticker)), recovered.map(s => s.ticker));
  for (const s of recovered) {
    assert(f.calls.some(([t, method]) => t === s.ticker && method === 'quoteSummary'), s.ticker + ' full summary');
    assert.equal(f.calls.filter(([t, method]) => t === s.ticker && method.includes('/')).length, 4,
      s.ticker + ' all four financial series');
    assert.equal(m.results.find(r => r.ticker === s.ticker).status, 'ok');
  }
  assert.equal(m.n_stale_quarter_selected, 1, 'restoration must not consume quarter reload cap');
  assert.equal(m.n_stale_quarter_pulled, 1);
  assert.equal(m.results.find(r => r.ticker === 'FRESH').status, 'price-only');
  console.log('PASS real pullAll: five first, full summaries + four financial requests each, cap unchanged');

  const empty = fixture({ snapshots: [] });
  assert.deepEqual(clone(empty.Y.prioritizeRestoredMissingSnapshots(stocks, empty.out, new Date('2026-09-28'))), stocks,
    'recovery priority must not start before the requested day');
  assert.deepEqual(clone(empty.Y.prioritizeRestoredMissingSnapshots(stocks, empty.out, new Date('2026-09-30'))),
    [...recovered, ...stocks.filter(s => !restored.has(s.ticker))], 'missing snapshots retain next-day recovery priority');
  assert.deepEqual(clone(f.Y.prioritizeRestoredMissingSnapshots(stocks, f.out, new Date(NOW))), stocks,
    'existing snapshots must not receive recovery priority');
  const markedFresh = { ...stocks[1], restoreFullPullOn: date };
  const existing = fixture({ snapshots: [ordinary[1]] });
  const present = await existing.Y.pullAll({ stocks: [markedFresh] }, existing.out, 0);
  assert.equal(present.results[0].status, 'price-only', 'recovered snapshot resumes ordinary treatment');
  console.log('PASS priority persists next day, absent before start and for existing snapshots');

  if (process.argv.includes('--break-once')) {
    const hash = () => crypto.createHash('sha256').update(fs.readFileSync(livePath)).digest('hex');
    const before = hash();
    const mutants = [
      ['presence', c => { c.stocks = c.stocks.filter(s => s.ticker !== '300475.SZ'); }, /restored ticker missing/],
      ['excluded', c => { c.stocks.push({ ticker: 'PHK' }); }, /excluded\/duplicate ticker re-added/],
      ['issuer', c => { c.stocks.push({ ticker: 'FCC.MC' }); }, /excluded\/duplicate ticker re-added/],
      ['clock', c => { c.stocks.find(s => s.ticker === '066970.KS').missingSnapshotSince = '2026-08-01'; }, /expired absence clock/]
    ];
    for (const [name, mutate, message] of mutants) {
      const copy = clone(wl); mutate(copy);
      assert.throws(() => assertRestoration(copy), message, name + ' mutant must fail');
      assert.equal(hash(), before, 'live watchlist changed during mutation');
      console.log('PASS break-once: ' + name + ' rejected on copy; live SHA256 unchanged');
    }
    assertRestoration(wl);
  }
}
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { assertRestoration, pruneCopy, restored, evidence };
