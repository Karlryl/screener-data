'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { cutoffOf, tailOf, stepFor, buildFeed, validate, build, ROW_KEYS, SKIP_REASONS, MAX_BYTES } = require('../scripts/write-preisschritt-export.js');
const store = require('../lib/price-history-store.js');
const mini = require('./fixtures/preisschritt/store-mini.json');
const generatedAt = '2026-10-15T08:43:25.693Z';
const stamp = '2026-10-15T08:37:04.076Z';
const entriesOf = (history, stampAt = stamp) => Object.fromEntries(Object.entries(history).map(([t, bars]) => [t, tailOf(bars, cutoffOf(stampAt))]));
const make = (tickers = mini.universe, history = mini.history, stampAt = stamp) =>
  buildFeed({ tickers, entries: entriesOf(history, stampAt), generatedAt, priceStoreUpdatedAt: stampAt });
const bytesOf = feed => Buffer.byteLength(JSON.stringify(feed));
const row = (feed, ticker) => feed.rows.find(r => r.t === ticker);
const script = path.resolve(__dirname, '../scripts/write-preisschritt-export.js');
const workflowFile = path.resolve(__dirname, '../.github/workflows/daily-pull.yml');
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('hand fixture is exact: adjusted closes 100 then 102 give a step of 1.02, and only the last two finished bars count', () => {
  const before = JSON.stringify(mini), feed = make();
  assert.equal(JSON.stringify(mini), before);
  // HAND has three stored bars (90, 100, 102): the older one is ignored.
  assert.deepEqual(row(feed, 'HAND'), { t: 'HAND', d0: '2026-10-13', c0: 100, d1: '2026-10-14', c1: 102 });
  assert.equal(row(feed, 'HAND').c1 / row(feed, 'HAND').c0, 1.02);
  assert.deepEqual(row(feed, 'SPLT'), { t: 'SPLT', d0: '2026-10-13', c0: 50.5, d1: '2026-10-14', c1: 51 });
  // Non-consecutive bars (Friday 09.10. then Wednesday 14.10.) are kept as stored: the dates state the gap, findash judges it.
  assert.deepEqual(row(feed, 'GAPPY'), { t: 'GAPPY', d0: '2026-10-09', c0: 20, d1: '2026-10-14', c1: 21 });
  // Rows come out sorted although the fixture universe is not.
  assert.deepEqual(feed.rows.map(r => r.t), ['GAPPY', 'HAND', 'INTRA', 'SPLT', 'VANISH']);
  assert.notDeepEqual(mini.universe.filter(t => feed.rows.some(r => r.t === t)), feed.rows.map(r => r.t));
  // A ticker stored but outside the universe never appears.
  assert.equal(row(feed, 'OUTSIDE'), undefined);
  assert.deepEqual(validate(feed, bytesOf(feed)), []);
  for (const r of feed.rows) assert.deepEqual(Object.keys(r), ROW_KEYS);
  assert.deepEqual(Object.keys(feed), ['schema', 'generated_at', 'priceStoreUpdatedAt', 'cutoffDay', 'universeCount', 'skipped', 'rows']);
  assert.equal(feed.cutoffDay, '2026-10-15');
});

test('only finished bars count: a bar of the stamp day is intraday and excluded (P2-1)', () => {
  const feed = make();
  // INTRA: the last stored bar is dated the stamp day (999 would be an intraday value): the step is 13.10. to 14.10.
  assert.deepEqual(row(feed, 'INTRA'), { t: 'INTRA', d0: '2026-10-13', c0: 100, d1: '2026-10-14', c1: 101 });
  // VANISH: the previous-day bar (14.10.) vanished at a later pull; the stamp-day bar is not used to bridge the gap.
  assert.deepEqual(row(feed, 'VANISH'), { t: 'VANISH', d0: '2026-10-12', c0: 50, d1: '2026-10-13', c1: 51 });
  // EQSTAMP: the last stored bar date equals the stamp day and only one older bar exists: no finished pair, own reason.
  assert.equal(row(feed, 'EQSTAMP'), undefined);
  assert.deepEqual(stepFor('EQSTAMP', tailOf(mini.history.EQSTAMP, '2026-10-15')), { skip: 'fewer-than-two-finished-bars' });
  // Every row ends strictly before the cutoff day.
  for (const r of feed.rows) assert.ok(r.d1 < feed.cutoffDay, r.t);
  // The cutoff is the UTC day of the stamp, not the local one and not the day of generation.
  assert.equal(cutoffOf('2026-10-15T08:37:04.076Z'), '2026-10-15');
  assert.equal(cutoffOf('2026-10-15T00:00:00.000Z'), '2026-10-15');
  assert.equal(cutoffOf('2026-10-15T23:59:59.999Z'), '2026-10-15');
  assert.equal(cutoffOf('2026-10-15T01:30:00+02:00'), '2026-10-14');
  // The same store stamped before midnight UTC of the next day: the 15.10. bar is still not finished, stamped after it is.
  const history = { X: [{ date: '2026-10-13', close: 1 }, { date: '2026-10-14', close: 2 }, { date: '2026-10-15', close: 3 }] };
  assert.deepEqual(row(make(['X'], history, '2026-10-15T23:00:00Z'), 'X'), { t: 'X', d0: '2026-10-13', c0: 1, d1: '2026-10-14', c1: 2 });
  assert.deepEqual(row(make(['X'], history, '2026-10-16T01:00:00Z'), 'X'), { t: 'X', d0: '2026-10-14', c0: 2, d1: '2026-10-15', c1: 3 });
  // Bars after the stamp day (clock skew, bad data) are not finished either, and a bar before the cutoff that is not a real day still gets named.
  const odd = { Y: [{ date: '2026-10-13', close: 1 }, { date: '2026-10-14', close: 2 }, { date: '2026-10-17', close: 9 }], Z: [{ date: '2026-02-30', close: 1 }, { date: '2026-10-14', close: 2 }] };
  assert.deepEqual(row(make(['Y', 'Z'], odd), 'Y'), { t: 'Y', d0: '2026-10-13', c0: 1, d1: '2026-10-14', c1: 2 });
  assert.equal(make(['Y', 'Z'], odd).skipped['invalid-date'], 1);
});

test('rows without two usable bars are left out and counted by reason, never filled', () => {
  const feed = make();
  assert.deepEqual(feed.skipped, {
    'not-in-store': 1,                // NOSTORE: listed in the universe, no series
    'fewer-than-two-bars': 2,         // SOLO (one bar), EMPTY (none)
    'fewer-than-two-finished-bars': 1, // EQSTAMP: two bars, one of them dated the stamp day
    'invalid-date': 1,                // BADD: 2026-02-30
    'invalid-close': 2,               // ZERO (0), NEGC (negative)
    'dates-not-increasing': 2,        // SAME (equal), BACK (reversed)
    'not-refreshed-at-stamp': 0,      // make() has no last fetch days; the failed-pull tests below count it
  });
  assert.deepEqual(Object.keys(feed.skipped), SKIP_REASONS);
  assert.equal(feed.universeCount, mini.universe.length);
  assert.equal(feed.rows.length + Object.values(feed.skipped).reduce((a, b) => a + b, 0), feed.universeCount);
  for (const t of ['SOLO', 'EMPTY', 'EQSTAMP', 'ZERO', 'NEGC', 'SAME', 'BACK', 'BADD', 'NOSTORE']) assert.equal(row(feed, t), undefined, t);
  const step = bars => stepFor('X', tailOf(bars, '2026-10-15'));
  // The older valid bar is never promoted when the newest finished one is bad (no filling).
  assert.deepEqual(step([{ date: '2026-10-12', close: 3 }, { date: '2026-10-13', close: 4 }, { date: '2026-10-14', close: 0 }]), { skip: 'invalid-close' });
  // Non-number closes are glitches, not prices.
  for (const close of ['5', null, NaN, Infinity, undefined, -1, 0]) {
    assert.deepEqual(step([{ date: '2026-10-13', close: 5 }, { date: '2026-10-14', close }]), { skip: 'invalid-close' }, String(close));
    assert.deepEqual(step([{ date: '2026-10-13', close }, { date: '2026-10-14', close: 5 }]), { skip: 'invalid-close' }, String(close));
  }
  // A full timestamp is not a day.
  assert.deepEqual(step([{ date: '2026-10-13T00:00:00Z', close: 5 }, { date: '2026-10-14', close: 5 }]), { skip: 'invalid-date' });
  assert.deepEqual(step([null, { date: '2026-10-14', close: 5 }]), { skip: 'invalid-date' });
  assert.deepEqual(stepFor('X', undefined), { skip: 'not-in-store' });
  assert.deepEqual(stepFor('X', 'not an entry'), { skip: 'not-in-store' });
});

test('buildFeed refuses a broken generation or store stamp', () => {
  for (const bad of [undefined, '', 'yesterday']) {
    assert.throws(() => buildFeed({ tickers: ['HAND'], entries: {}, generatedAt: bad, priceStoreUpdatedAt: stamp }), /Invalid generation/);
    assert.throws(() => buildFeed({ tickers: ['HAND'], entries: {}, generatedAt, priceStoreUpdatedAt: bad }), /Invalid price store stamp/);
  }
});

test('rows are sorted by code point, not by locale', () => {
  const history = Object.fromEntries(['b.L', 'A', 'a', 'B', '7203.T', 'AB'].map(t => [t, [{ date: '2026-10-13', close: 1 }, { date: '2026-10-14', close: 2 }]]));
  const tickers = Object.keys(history);
  assert.deepEqual(make(tickers, history).rows.map(r => r.t), ['7203.T', 'A', 'AB', 'B', 'a', 'b.L']);
  assert.deepEqual(make(tickers.slice().reverse(), history).rows.map(r => r.t), ['7203.T', 'A', 'AB', 'B', 'a', 'b.L']);
});

test('no rank, percentile, score or judgement wording can appear in keys or file name', () => {
  assert.deepEqual(ROW_KEYS, ['t', 'd0', 'c0', 'd1', 'c1']);
  const feed = make(), keys = new Set([...feed.rows.flatMap(r => Object.keys(r)), ...Object.keys(feed), ...Object.keys(feed.skipped)]);
  for (const key of [...keys, path.basename(script), 'preisschritt.json']) assert.doesNotMatch(key, /rank|rk|perc|pct|score|sc$|signal|sig|fond|fund|contrarian|antizykl|kandidat|urteil|verdict/i);
});

test('validator goes red on every tamper variant (with the specific error) and stays green on the control', () => {
  const control = make();
  assert.deepEqual(validate(control, bytesOf(control)), []);
  const tampers = {
    'unknown key (rank)': [f => { row(f, 'HAND').rank = 1; }, /row shape/],
    'missing key': [f => { delete row(f, 'HAND').c0; }, /row shape/],
    'null value': [f => { row(f, 'HAND').c1 = null; }, /c1 not a positive finite/],
    'key order changed': [f => { f.rows[0] = { t: 'GAPPY', c0: 20, d0: '2026-10-09', d1: '2026-10-14', c1: 21 }; }, /row shape/],
    'close as string': [f => { row(f, 'HAND').c0 = '100'; }, /c0 not a positive finite/],
    'close NaN': [f => { row(f, 'HAND').c1 = NaN; }, /c1 not a positive finite/],
    'close zero': [f => { row(f, 'HAND').c0 = 0; }, /c0 not a positive finite/],
    'close negative': [f => { row(f, 'HAND').c1 = -102; }, /c1 not a positive finite/],
    'equal dates': [f => { row(f, 'HAND').d1 = row(f, 'HAND').d0; }, /dates not increasing/],
    'reversed dates': [f => { const r = row(f, 'HAND'); [r.d0, r.d1] = [r.d1, r.d0]; }, /dates not increasing/],
    'date with time': [f => { row(f, 'HAND').d1 = '2026-10-14T00:00:00Z'; }, /invalid d1/],
    'impossible day': [f => { row(f, 'HAND').d0 = '2026-02-30'; }, /invalid d0/],
    'last bar on the stamp day (intraday)': [f => { row(f, 'HAND').d1 = '2026-10-15'; }, /unfinished bar/],
    'last bar after the stamp day': [f => { row(f, 'HAND').d1 = '2026-10-16'; }, /unfinished bar/],
    'cutoffDay missing': [f => { delete f.cutoffDay; }, /Invalid cutoffDay/],
    'cutoffDay not the stamp day': [f => { f.cutoffDay = '2026-10-16'; }, /Invalid cutoffDay/],
    'cutoffDay not a day': [f => { f.cutoffDay = '2026-10-15T00:00:00Z'; }, /Invalid cutoffDay/],
    'rows not sorted': [f => { f.rows.reverse(); }, /not sorted/],
    'rows sorted by locale only': [f => { f.rows.push({ t: 'a', d0: '2026-10-13', c0: 1, d1: '2026-10-14', c1: 1 }, { t: 'B', d0: '2026-10-13', c0: 1, d1: '2026-10-14', c1: 1 }); f.universeCount += 2; }, /not sorted/],
    'missing ticker': [f => { delete row(f, 'HAND').t; }, /missing\/duplicate ticker/],
    'duplicate ticker': [f => { f.rows.splice(2, 0, structuredClone(row(f, 'HAND'))); f.universeCount++; }, /duplicate ticker/],
    'row count off (row removed)': [f => { f.rows.pop(); }, /Universe count mismatch/],
    'universeCount off': [f => { f.universeCount += 1; }, /Universe count mismatch/],
    'skipped count off': [f => { f.skipped['invalid-close']++; }, /Universe count mismatch/],
    'skipped reason unknown': [f => { f.skipped.misc = 1; }, /Invalid skipped counts/],
    'skipped reason missing': [f => { delete f.skipped['fewer-than-two-finished-bars']; }, /Invalid skipped counts/],
    'skipped negative': [f => { f.skipped['invalid-close'] = -2; f.skipped['not-in-store'] += 4; }, /Invalid skipped counts/],
    'skipped missing': [f => { delete f.skipped; }, /Invalid skipped counts/],
    'priceStoreUpdatedAt missing': [f => { delete f.priceStoreUpdatedAt; }, /Invalid priceStoreUpdatedAt/],
    'priceStoreUpdatedAt unparsable': [f => { f.priceStoreUpdatedAt = 'recently'; }, /Invalid priceStoreUpdatedAt/],
    'wrong schema': [f => { f.schema = 'findash-export/v2'; }, /Invalid envelope/],
    'generated_at unparsable': [f => { f.generated_at = 'yesterday'; }, /Invalid envelope/],
    'rows missing': [f => { delete f.rows; }, /Missing rows/],
  };
  for (const [name, [mutate, expected]] of Object.entries(tampers)) {
    const feed = make(); mutate(feed);
    const errors = validate(feed, 1000);
    assert.ok(errors.some(e => expected.test(e)), name + ' -> ' + JSON.stringify(errors));
  }
  // The generation of the board index next to the file must match exactly.
  assert.deepEqual(validate(control, bytesOf(control), generatedAt), []);
  assert.ok(validate(control, bytesOf(control), '2026-09-01T12:00:00Z').some(e => e.includes('Generation mismatch')));
  // Against universum.json: same count and only universe members.
  assert.deepEqual(validate(control, bytesOf(control), generatedAt, mini.universe), []);
  assert.ok(validate(control, bytesOf(control), generatedAt, mini.universe.concat('MORE')).some(e => e.includes('Universe count differs')));
  assert.ok(validate(control, bytesOf(control), generatedAt, mini.universe.map(t => (t === 'HAND' ? 'OTHER' : t))).some(e => e.includes('not in universum.json')));
});

test('the size cap is enforced exactly', () => {
  const feed = make();
  assert.ok(validate(feed, MAX_BYTES + 1).some(e => e.includes('Size')));
  assert.ok(validate(feed, 0).some(e => e.includes('Size')));
  assert.deepEqual(validate(feed, MAX_BYTES), []);
  assert.equal(MAX_BYTES, 4_000_000);
});

// A temporary export tree (index.json + filter/universum.json) and a real sharded price store written with the store module.
function fixtureTree({ generated = generatedAt, universeGenerated = generated, universe = mini.universe } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preisschritt-'));
  const v1Dir = path.join(dir, 'v1'), pricesDir = path.join(dir, 'prices');
  fs.mkdirSync(path.join(v1Dir, 'filter'), { recursive: true });
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  write(path.join(v1Dir, 'index.json'), { schema: 'findash-export/v1', generated_at: generated, generatedFromSnapshots: universe.length, branches: ['x'] });
  write(path.join(v1Dir, 'filter', 'universum.json'), { schema: 'findash-export/v1', generated_at: universeGenerated, snapshotCount: universe.length, rows: universe.map(t => ({ t, n: 'Name ' + t })) });
  store.saveAll(pricesDir, structuredClone(mini.history));
  // saveAll stamps _meta.json with the wall clock; the fixtures assume the stamp day of `stamp`, so pin it (red from 16.10. on otherwise).
  // saveAll writes no fetch-day record; here every ticker counts as fetched in the run of the stamp.
  const metaFile = store.metaPath(pricesDir);
  write(metaFile, { ...JSON.parse(fs.readFileSync(metaFile, 'utf8')), updatedAt: stamp, fetchDay: stamp.slice(0, 10), notFetched: {} });
  return { dir, v1Dir, pricesDir, target: path.join(v1Dir, 'filter', 'preisschritt.json') };
}

test('build reads the sharded store, is idempotent (byte-equal second run), leaves universum.json untouched and rejects a foreign generation', () => {
  const t = fixtureTree();
  const universe = path.join(t.v1Dir, 'filter', 'universum.json');
  const universeHash = sha(universe), indexHash = sha(path.join(t.v1Dir, 'index.json'));
  const first = build({ pricesDir: t.pricesDir, v1Dir: t.v1Dir }), hash = sha(t.target);
  const second = build({ pricesDir: t.pricesDir, v1Dir: t.v1Dir });
  assert.equal(sha(t.target), hash);
  assert.equal(first.bytes, second.bytes);
  assert.equal(first.bytes, fs.statSync(t.target).size);
  assert.equal(sha(universe), universeHash);
  assert.equal(sha(path.join(t.v1Dir, 'index.json')), indexHash);
  assert.deepEqual(fs.readdirSync(path.join(t.v1Dir, 'filter')).sort(), ['preisschritt.json', 'universum.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(t.target, 'utf8')), first.feed);
  assert.deepEqual(row(first.feed, 'HAND'), { t: 'HAND', d0: '2026-10-13', c0: 100, d1: '2026-10-14', c1: 102 });
  assert.equal(first.feed.rows.length, 5);
  // The cutoff comes from the store stamp: the stamp-day bar of INTRA (999) is not used, the real store layout gives the same row.
  assert.equal(first.feed.cutoffDay, '2026-10-15');
  assert.deepEqual(row(first.feed, 'INTRA'), { t: 'INTRA', d0: '2026-10-13', c0: 100, d1: '2026-10-14', c1: 101 });
  assert.equal(first.feed.skipped['fewer-than-two-finished-bars'], 1);
  assert.equal(first.feed.universeCount, mini.universe.length);
  // The stamp comes from the store's _meta.json.
  assert.equal(first.feed.priceStoreUpdatedAt, store.loadMeta(t.pricesDir).updatedAt);
  // A universe file of another generation than the board index is refused; nothing is written.
  const foreign = fixtureTree({ universeGenerated: '2026-09-01T12:00:00Z' });
  assert.throws(() => build({ pricesDir: foreign.pricesDir, v1Dir: foreign.v1Dir }), /foreign filter universe/);
  assert.equal(fs.existsSync(foreign.target), false);
});

test('generated_at is copied character for character from index.json', () => {
  // Spellings that a Date round trip or an own timestamp would change: milliseconds, an offset, zero milliseconds, none.
  for (const generated of ['2026-10-15T08:43:25.693Z', '2026-10-15T10:43:25+02:00', '2026-10-15T08:43:25.000Z', '2026-10-15T08:43:25Z']) {
    const t = fixtureTree({ generated });
    const index = JSON.parse(fs.readFileSync(path.join(t.v1Dir, 'index.json'), 'utf8'));
    const { feed } = build({ pricesDir: t.pricesDir, v1Dir: t.v1Dir });
    assert.strictEqual(feed.generated_at, index.generated_at);
    const raw = fs.readFileSync(t.target, 'utf8');
    assert.ok(raw.includes('"generated_at":' + JSON.stringify(index.generated_at) + ','), 'bytes on disk carry the index string');
    assert.equal(spawnSync(process.execPath, [script, '--check', '--v1-dir', t.v1Dir], { encoding: 'utf8' }).status, 0, generated);
    const other = generated.endsWith('Z') ? generated.replace('Z', '+00:00') : generated.replace('+02:00', 'Z');
    assert.ok(validate(feed, bytesOf(feed), other).some(e => e.includes('Generation mismatch')), other);
  }
});

test('without the filter folder, with a partial store or without a store stamp nothing is written', () => {
  const t = fixtureTree();
  fs.rmSync(path.join(t.v1Dir, 'filter'), { recursive: true });
  assert.throws(() => build({ pricesDir: t.pricesDir, v1Dir: t.v1Dir }), /filter\/ folder missing/);
  assert.equal(fs.existsSync(path.join(t.v1Dir, 'filter')), false);
  const partial = fixtureTree();
  fs.rmSync(store.shardPath(partial.pricesDir, 7));
  assert.throws(() => build({ pricesDir: partial.pricesDir, v1Dir: partial.v1Dir }), /partial/);
  assert.equal(fs.existsSync(partial.target), false);
  // A shard replaced by an empty one (truncated copy): its tickers would silently count as not-in-store, so the count against _meta.json stops it.
  const truncated = fixtureTree();
  fs.writeFileSync(store.shardPath(truncated.pricesDir, store.shardOf('HAND')), '{}');
  assert.throws(() => build({ pricesDir: truncated.pricesDir, v1Dir: truncated.v1Dir }), /truncated shard/);
  assert.equal(fs.existsSync(truncated.target), false);
  const unstamped = fixtureTree();
  fs.rmSync(store.metaPath(unstamped.pricesDir));
  assert.throws(() => build({ pricesDir: unstamped.pricesDir, v1Dir: unstamped.v1Dir }), /no _meta\.json/);
  assert.equal(fs.existsSync(unstamped.target), false);
  const empty = fixtureTree({ universe: [] });
  assert.throws(() => build({ pricesDir: empty.pricesDir, v1Dir: empty.v1Dir }), /foreign filter universe/);
  const twice = fixtureTree({ universe: ['HAND', 'HAND'] });
  assert.throws(() => build({ pricesDir: twice.pricesDir, v1Dir: twice.v1Dir }), /duplicate ticker/);
});

test('CLI checks a real file, rejects a corrupted copy, a foreign generation, a foreign universe and an oversized one, and self-tests', () => {
  const t = fixtureTree(), run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  build({ pricesDir: t.pricesDir, v1Dir: t.v1Dir });
  const hash = sha(t.target);
  const ok = run('--check', '--v1-dir', t.v1Dir);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /check OK/);
  // Only generated fixture copies are break targets; the good file is never mutated.
  const bad = fixtureTree(), corrupt = make(); row(corrupt, 'HAND').rank = 1;
  fs.writeFileSync(bad.target, JSON.stringify(corrupt));
  const rejected = run('--check', '--v1-dir', bad.v1Dir);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /row shape/);
  const old = fixtureTree(), stale = make(); stale.generated_at = '2026-09-01T12:00:00Z';
  fs.writeFileSync(old.target, JSON.stringify(stale));
  const foreign = run('--check', '--v1-dir', old.v1Dir);
  assert.equal(foreign.status, 1);
  assert.match(foreign.stderr, /Generation mismatch/);
  fs.rmSync(path.join(old.v1Dir, 'index.json'));
  assert.equal(run('--check', '--v1-dir', old.v1Dir).status, 1);
  // A file built for another universe than the one next to it.
  const other = fixtureTree({ universe: mini.universe.concat('MORE') });
  fs.writeFileSync(other.target, JSON.stringify(make()));
  const wrongUniverse = run('--check', '--v1-dir', other.v1Dir);
  assert.equal(wrongUniverse.status, 1);
  assert.match(wrongUniverse.stderr, /Universe count differs/);
  const big = fixtureTree(), source = row(make(), 'HAND');
  const rows = Array.from({ length: 60000 }, (_, i) => ({ ...source, t: 'T' + String(i).padStart(6, '0') }));
  fs.writeFileSync(big.target, JSON.stringify({ schema: 'findash-export/v1', generated_at: generatedAt, priceStoreUpdatedAt: stamp, cutoffDay: '2026-10-15', universeCount: rows.length,
    skipped: Object.fromEntries(SKIP_REASONS.map(r => [r, 0])), rows }));
  assert.ok(fs.statSync(big.target).size > MAX_BYTES);
  const oversized = run('--check', '--v1-dir', big.v1Dir);
  assert.equal(oversized.status, 1);
  assert.match(oversized.stderr, /Size must be between/);
  assert.equal(run('--check', '--v1-dir', path.join(t.dir, 'nowhere')).status, 1);
  assert.equal(run('--unknown').status, 1);
  const self = run('--selftest');
  assert.equal(self.status, 0, self.stderr);
  assert.equal(sha(t.target), hash);
});

// P303, failed pull: the real merge step and the real build on a real sharded store, over consecutive runs. A runner's
// failed ticker has no entry in its slice and keeps its old bars; the store stamp moves on anyway. The stamp is pinned
// after each merge because the merge stamps with the wall clock.
const mergeScript = path.resolve(__dirname, '../scripts/merge-price-shards.js');
const bars = (...pairs) => pairs.map(([date, close]) => ({ date, close }));
const failedPullTree = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preisschritt-failed-pull-'));
  const v1Dir = path.join(dir, 'v1'), pricesDir = path.join(dir, 'prices');
  fs.mkdirSync(path.join(v1Dir, 'filter'), { recursive: true });
  const universe = ['FRESH', 'FAILS', 'USFAIL'];
  fs.writeFileSync(path.join(v1Dir, 'index.json'), JSON.stringify({ schema: 'findash-export/v1', generated_at: generatedAt }));
  fs.writeFileSync(path.join(v1Dir, 'filter', 'universum.json'), JSON.stringify({ schema: 'findash-export/v1', generated_at: generatedAt, rows: universe.map(t => ({ t })) }));
  return { v1Dir, pricesDir };
};
const pullAndMerge = ({ pricesDir }, day, history, fetched, stampAt) => {
  store.saveAll(pricesDir, history); // what the runners and the overlay leave behind ...
  return (previousMeta) => {
    if (previousMeta) fs.writeFileSync(store.metaPath(pricesDir), JSON.stringify(previousMeta)); // ... with the stamp of the checkout, as in the merge job
    fs.writeFileSync(path.join(pricesDir, day + '.shard-0.json'), JSON.stringify(Object.fromEntries(fetched.map(t => [t, { close: 1, asOf: day, pulledOn: day }]))));
    const run = spawnSync(process.execPath, [mergeScript, '--prices', pricesDir, '--date', day, '--expected-shards', '1'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const meta = { ...store.loadMeta(pricesDir), updatedAt: stampAt };
    fs.writeFileSync(store.metaPath(pricesDir), JSON.stringify(meta));
    return { meta, stdout: run.stdout };
  };
};
const stepsOf = ({ pricesDir, v1Dir }) => build({ pricesDir, v1Dir }).feed;

test('a failed pull keeps the unfinished bar out of the file: skipped by name, never booked as a close, all other rows unchanged (P303)', () => {
  const tree = failedPullTree();
  // Run of 14.10., all fetched. The EU tickers hold an intraday bar of 14.10., USFAIL has no bar of 14.10. yet (the pull runs before the US open).
  const day14 = {
    FRESH: bars(['2026-10-12', 100], ['2026-10-13', 101], ['2026-10-14', 150]),
    FAILS: bars(['2026-10-12', 200], ['2026-10-13', 202], ['2026-10-14', 300]),
    USFAIL: bars(['2026-10-12', 50], ['2026-10-13', 51]),
    SHORT: bars(['2026-10-13', 7]),
  };
  const first = pullAndMerge(tree, '2026-10-14', day14, ['FRESH', 'FAILS', 'USFAIL'], '2026-10-14T09:00:00Z')();
  assert.equal(first.meta.fetchDay, '2026-10-14');
  // SHORT was not fetched, but under two bars it can never make a step: it costs no bytes in _meta.
  assert.deepEqual(first.meta.notFetched, {});
  assert.match(first.stdout, /no per-ticker fetch days yet/, 'a stamp without the record is named once, not passed over');
  const before = stepsOf(tree);
  assert.deepEqual(before.rows.map(r => r.t), ['FAILS', 'FRESH', 'USFAIL']);
  assert.deepEqual(row(before, 'FAILS'), { t: 'FAILS', d0: '2026-10-12', c0: 200, d1: '2026-10-13', c1: 202 });

  // Run of 15.10.: FRESH gets the final close of 14.10. and an intraday bar of 15.10.; FAILS and USFAIL fail and keep their series.
  const day15 = { ...day14, FRESH: bars(['2026-10-12', 100], ['2026-10-13', 101], ['2026-10-14', 151], ['2026-10-15', 999]) };
  const second = pullAndMerge(tree, '2026-10-15', day15, ['FRESH'], '2026-10-15T09:00:00Z')(first.meta);
  assert.equal(second.meta.fetchDay, '2026-10-15');
  assert.deepEqual(second.meta.notFetched, { '2026-10-14': ['FAILS', 'USFAIL'] }, 'the fetch day survives the merge, per ticker');
  const failed = stepsOf(tree);
  assert.equal(failed.skipped['not-refreshed-at-stamp'], 1);
  // The heart of the guard: 300 is the intraday value of 14.10. and before the stamp day; without the rule it would be booked as the close.
  assert.equal(row(failed, 'FAILS'), undefined);
  assert.ok(!JSON.stringify(failed.rows).includes('300'), 'the unfinished bar must not be in the file');
  // A refreshed ticker moves on as before.
  assert.deepEqual(row(failed, 'FRESH'), { t: 'FRESH', d0: '2026-10-13', c0: 101, d1: '2026-10-14', c1: 151 });
  // USFAIL also failed, but its last bar is older than its last fetch and therefore final: same row as yesterday, byte for byte.
  assert.deepEqual(row(failed, 'USFAIL'), row(before, 'USFAIL'));
  assert.equal(failed.rows.length + Object.values(failed.skipped).reduce((a, b) => a + b, 0), failed.universeCount);
  assert.deepEqual(validate(failed, bytesOf(failed), generatedAt, ['FRESH', 'FAILS', 'USFAIL']), []);

  // Run of 16.10.: FAILS still fails: its day stays 14.10., it does not become 15.10. by being carried. USFAIL recovers and leaves the list.
  const day16 = { ...day15, USFAIL: bars(['2026-10-12', 50], ['2026-10-13', 51], ['2026-10-14', 52], ['2026-10-15', 53]) };
  const third = pullAndMerge(tree, '2026-10-16', day16, ['FRESH', 'USFAIL'], '2026-10-16T09:00:00Z')(second.meta);
  assert.deepEqual(third.meta.notFetched, { '2026-10-14': ['FAILS'] });
  const still = stepsOf(tree);
  assert.equal(still.skipped['not-refreshed-at-stamp'], 1);
  assert.deepEqual(row(still, 'USFAIL'), { t: 'USFAIL', d0: '2026-10-14', c0: 52, d1: '2026-10-15', c1: 53 });

  // Run of 17.10.: FAILS recovers: the corrected bar of 14.10. replaces the intraday one, the row comes back and the list is empty.
  const day17 = { ...day16, FAILS: bars(['2026-10-13', 202], ['2026-10-14', 204], ['2026-10-15', 205], ['2026-10-16', 206]) };
  const fourth = pullAndMerge(tree, '2026-10-17', day17, ['FRESH', 'FAILS', 'USFAIL'], '2026-10-17T09:00:00Z')(third.meta);
  assert.deepEqual(fourth.meta.notFetched, {});
  const back = stepsOf(tree);
  assert.equal(back.skipped['not-refreshed-at-stamp'], 0);
  assert.deepEqual(row(back, 'FAILS'), { t: 'FAILS', d0: '2026-10-15', c0: 205, d1: '2026-10-16', c1: 206 });
});

test('first run: a ticker without a fetch day is neither fresh nor dropped unnamed, and a stamp without the record builds no file (P303)', () => {
  // The merge of the first run reads a stamp without the record: what it did not fetch goes in as unknown and is skipped by name, whatever its dates say.
  const tree = failedPullTree();
  const history = {
    FRESH: bars(['2026-10-13', 1], ['2026-10-14', 2]),
    FAILS: bars(['2026-07-01', 3], ['2026-07-02', 4]),
    USFAIL: bars(['2026-10-13', 5], ['2026-10-14', 6]),
  };
  const merge = pullAndMerge(tree, '2026-10-15', history, ['FRESH'], '2026-10-15T09:00:00Z');
  const oldStamp = store.loadMeta(tree.pricesDir);
  assert.equal(oldStamp.notFetched, undefined, 'the stamp of saveAll has no record');
  // Before the first merge with the record: no file and a reason, not a guess.
  fs.writeFileSync(store.metaPath(tree.pricesDir), JSON.stringify({ ...oldStamp, updatedAt: '2026-10-15T09:00:00Z' }));
  const target = path.join(tree.v1Dir, 'filter', 'preisschritt.json');
  assert.throws(() => stepsOf(tree), /no per-ticker fetch days/);
  assert.equal(fs.existsSync(target), false);
  const { meta } = merge();
  assert.deepEqual(meta.notFetched, { [store.UNKNOWN_FETCH_DAY]: ['FAILS', 'USFAIL'] });
  const feed = stepsOf(tree);
  assert.deepEqual(feed.rows.map(r => r.t), ['FRESH']);
  assert.equal(feed.skipped['not-refreshed-at-stamp'], 2);
  // The next run keeps them unknown rather than dating them to the run before.
  const next = pullAndMerge(tree, '2026-10-16', history, ['FRESH'], '2026-10-16T09:00:00Z')(meta);
  assert.deepEqual(next.meta.notFetched, { [store.UNKNOWN_FETCH_DAY]: ['FAILS', 'USFAIL'] });
  // A write outside the merge step (manual backfill) leaves a stamp without the record: again no file, until the next merge.
  store.saveDirty(tree.pricesDir, history, new Set(['FRESH']));
  assert.throws(() => stepsOf(tree), /no per-ticker fetch days/);
  // A broken record counts as none, on both sides.
  for (const broken of [{ fetchDay: '2026-10-15' }, { notFetched: {} }, { fetchDay: 'yesterday', notFetched: {} }, { fetchDay: '2026-10-15', notFetched: [] },
    { fetchDay: '2026-10-15', notFetched: { soon: ['X'] } }, { fetchDay: '2026-10-15', notFetched: { '2026-10-14': 'X' } }]) {
    assert.equal(store.notFetchedIndex(broken), null, JSON.stringify(broken));
    assert.deepEqual(store.nextNotFetched({ X: bars(['2026-10-13', 1], ['2026-10-14', 2]) }, {}, broken), { [store.UNKNOWN_FETCH_DAY]: ['X'] });
  }
  assert.equal(store.notFetchedIndex(null), null);
});

// Step order and fail-soft shape of the workflow step, checked on text so that a mutated copy can be shown red.
function workflowErrors(yaml) {
  const text = yaml.replace(/\r\n/g, '\n'), errors = [];
  const names = [...text.matchAll(/^ {6}- name: (.*)$/gm)].map(m => ({ name: m[1].trim(), at: m.index }));
  const at = name => names.filter(n => n.name === name);
  const step = at('Build and check preisschritt (additive, fail-soft)');
  if (step.length !== 1) return ['preisschritt step must exist exactly once (found ' + step.length + ')'];
  const filter = at('Build and check filter universe (additive, fail-soft)'), bewertung = at('Build and check bewertung (additive, fail-soft)');
  const guard = at('Oeffentlicher-Baum-Waechter'), deploy = at('Deploy Scoring Output to GitHub Pages');
  if (filter.length !== 1 || bewertung.length !== 1 || guard.length !== 1 || deploy.length !== 1) return ['anchor steps missing or duplicated'];
  if (!(filter[0].at < bewertung[0].at && bewertung[0].at < step[0].at)) errors.push('must run after the filter universe and bewertung steps');
  if (!(step[0].at < guard[0].at && guard[0].at < deploy[0].at)) errors.push('must run before the public-tree guard and the deploy');
  const next = names.find(n => n.at > step[0].at), body = text.slice(step[0].at, next ? next.at : undefined);
  const run = body.split('\n').filter(l => !l.trim().startsWith('#'));
  // The build must read the archive of the main tip, not the (older) trigger checkout in ./prices.
  if (!/write-preisschritt-export\.js --prices-dir "\$store\/prices"/.test(body) || !/write-preisschritt-export\.js --check/.test(body)) errors.push('must build and then check');
  if (body.indexOf('write-preisschritt-export.js --prices-dir') > body.indexOf('write-preisschritt-export.js --check')) errors.push('check must follow the build');
  if (!/git archive FETCH_HEAD prices\/history/.test(body) || !/git fetch --no-tags origin main/.test(body)) errors.push('must read the store of the main tip, not the stale trigger checkout');
  if (/git (checkout|reset|pull|rebase|merge)/.test(run.join('\n'))) errors.push('must not touch the working tree');
  if (!run.some(l => /rm -rf outputs\/findash-export\/v1\/filter\/preisschritt\.json\*/.test(l))) errors.push('failure must remove only preisschritt.json*');
  if (run.some(l => /rm -rf outputs\/findash-export\/v1\/filter(?!\/preisschritt)/.test(l))) errors.push('must never remove the filter folder or other files');
  if (!run.some(l => /\|\| \{ rm -rf .*; false; \} \|\| true\s*$/.test(l))) errors.push('must be fail-soft (ends with || true)');
  if (/continue-on-error/.test(body.replace(/^\s*#.*$/gm, ''))) errors.push('fail-soft belongs in the shell, as in the bewertung step');
  return errors;
}

test('workflow: the step runs after bewertung, before the public-tree guard and the deploy, and is fail-soft', () => {
  const yaml = fs.readFileSync(workflowFile, 'utf8').replace(/\r\n/g, '\n');
  assert.deepEqual(workflowErrors(yaml), []);
  const sabotage = {
    'step removed': y => y.replace('Build and check preisschritt (additive, fail-soft)', 'Something else'),
    'step moved before bewertung': y => {
      const m = y.match(/\r?\n {6}# A5\/P240[\s\S]*?\|\| true(?=\r?\n)/);
      return y.replace(m[0], '').replace(/\r?\n( {6}# A5\/S2 \(private research tab\))/, m[0] + '\n\n$1');
    },
    'step moved after the guard': y => {
      const m = y.match(/\r?\n {6}# A5\/P240[\s\S]*?\|\| true(?=\r?\n)/);
      return y.replace(m[0], '').replace(/(\r?\n {6}- name: Deploy Scoring Output to GitHub Pages)/, m[0] + '\n$1');
    },
    'fail-soft tail removed': y => y.replace(/(preisschritt\.json could not be built or checked[^\n]*; false; \}) \|\| true/, '$1'),
    'cleanup removed': y => y.replace('rm -rf outputs/findash-export/v1/filter/preisschritt.json*;', ''),
    'cleanup widens to the filter folder': y => y.replace('rm -rf outputs/findash-export/v1/filter/preisschritt.json*;', 'rm -rf outputs/findash-export/v1/filter;'),
    'stale trigger checkout read instead of main tip': y => y.replace('git archive FETCH_HEAD prices/history', 'git archive HEAD prices/history'),
    'working tree touched': y => y.replace('git fetch --no-tags origin main &&', 'git fetch --no-tags origin main && git checkout FETCH_HEAD -- prices/history &&'),
    'build reads the old trigger checkout': y => y.replace('--prices-dir "$store/prices"', '--prices-dir prices'),
    'check dropped': y => y.replace(/ &&\r?\n\s*node scripts\/write-preisschritt-export\.js --check/, ''),
  };
  for (const [name, mutate] of Object.entries(sabotage)) {
    const broken = mutate(yaml);
    assert.notEqual(broken, yaml, name + ' changed nothing');
    assert.ok(workflowErrors(broken).length > 0, name);
  }
});
