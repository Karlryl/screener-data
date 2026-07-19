'use strict';
/**
 * Bug-hunt fixes, batch b11-storearchiv (BH-139, BH-142, BH-144, BH-145, BH-190).
 * Reine Funktionen + tmp-Verzeichnisse -> netzwerkfrei. Standalone-Runner: node <datei> (Exit 0/1).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../../lib/price-history-store.js');
const { archiveDirByDate } = require('../../scripts/archive-old-snapshots.js');
const { readStateFileOrThrow, allFailed } = require('../../scripts/backfill-prices-max.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e.message)); }
}
function tmpDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-')); }

// --- BH-139: loadAll fails loud on a partial store (meta present, shard missing) ---
test('BH-139: loadAll throws when _meta.json exists but a shard file is missing', () => {
  const dir = tmpDir('phs-b139');
  const h = { AAPL: [{ date: '2026-07-10', close: 1 }], MSFT: [{ date: '2026-07-10', close: 2 }] };
  store.saveAll(dir, h); // stamps _meta.json + writes all 32 shards
  // simulate a partial checkout/sync: delete one shard file, meta stays
  const victim = store.shardOf('AAPL');
  fs.unlinkSync(store.shardPath(dir, victim));
  let err = null;
  try { store.loadAll(dir); } catch (e) { err = e; }
  assert.ok(err, 'loadAll must throw, not silently drop the missing shard');
  assert.ok(/shard\(s\) missing/.test(err.message), 'error names the missing-shard condition');
});
test('BH-139: loadAll still succeeds when the store is genuinely complete', () => {
  const dir = tmpDir('phs-b139ok');
  const h = { AAPL: [{ date: '2026-07-10', close: 1 }] };
  store.saveAll(dir, h);
  assert.deepEqual(store.loadAll(dir), h);
});
test('BH-139: loadAll unaffected when NO meta exists yet (pre-migration / empty dir)', () => {
  const dir = tmpDir('phs-b139pre');
  assert.deepEqual(store.loadAll(dir), {}); // no shards, no legacy file, no meta
});

// --- BH-142 + BH-190: archive merge no longer silently drops/overwrites data ---
function writeSnapshots(dir, entries) {
  fs.mkdirSync(dir, { recursive: true });
  for (const e of entries) fs.writeFileSync(path.join(dir, e.date + '.json'), JSON.stringify(e.content));
}

test('BH-142: a corrupt existing archive line aborts instead of being dropped', () => {
  const root = tmpDir('arch-b142');
  const src = path.join(root, 'src');
  const archiveDir = path.join(root, 'archive');
  writeSnapshots(src, [{ date: '2020-01-02', content: { a: 1 } }]); // old enough to archive (cutoff default keepDays)
  fs.mkdirSync(archiveDir, { recursive: true });
  // pre-seed archive with one valid + one corrupt line for the same month
  fs.writeFileSync(path.join(archiveDir, '2020-01.ndjson'),
    JSON.stringify({ date: '2020-01-01', a: 0 }) + '\n' + '{ not valid json' + '\n');
  assert.throws(() => archiveDirByDate(src, archiveDir, 14, false), /JSON/i,
    'must throw rather than silently drop the corrupt line on rewrite');
  // original snapshot must NOT have been unlinked (we aborted before that point)
  assert.ok(fs.existsSync(path.join(src, '2020-01-02.json')), 'source snapshot preserved after abort');
});

test('BH-190: same-date collision with DIFFERENT content throws instead of deleting the correction', () => {
  const root = tmpDir('arch-b190');
  const src = path.join(root, 'src');
  const archiveDir = path.join(root, 'archive');
  // live snapshot for 2020-01-01 has CORRECTED content...
  writeSnapshots(src, [{ date: '2020-01-01', content: { a: 'corrected' } }]);
  fs.mkdirSync(archiveDir, { recursive: true });
  // ...but the archive already has the OLD content for that same date
  fs.writeFileSync(path.join(archiveDir, '2020-01.ndjson'), JSON.stringify({ date: '2020-01-01', a: 'stale' }) + '\n');
  assert.throws(() => archiveDirByDate(src, archiveDir, 14, false), /archive collision/,
    'must refuse to silently keep the stale archived version');
  assert.ok(fs.existsSync(path.join(src, '2020-01-01.json')), 'live correction not deleted');
});

test('BH-190: same-date collision with IDENTICAL content is a true no-op (unlinks original, no throw)', () => {
  const root = tmpDir('arch-b190ok');
  const src = path.join(root, 'src');
  const archiveDir = path.join(root, 'archive');
  writeSnapshots(src, [{ date: '2020-01-01', content: { a: 1 } }]);
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(archiveDir, '2020-01.ndjson'), JSON.stringify({ date: '2020-01-01', a: 1 }) + '\n');
  const result = archiveDirByDate(src, archiveDir, 14, false);
  assert.equal(result.archived, 1);
  assert.ok(!fs.existsSync(path.join(src, '2020-01-01.json')), 'already-archived original gets unlinked');
});

test('archiveDirByDate still works normally on a fresh (no pre-existing archive) month', () => {
  const root = tmpDir('arch-fresh');
  const src = path.join(root, 'src');
  const archiveDir = path.join(root, 'archive');
  writeSnapshots(src, [{ date: '2020-01-01', content: { a: 1 } }, { date: '2020-01-02', content: { a: 2 } }]);
  const result = archiveDirByDate(src, archiveDir, 14, false);
  assert.equal(result.archived, 2);
  const lines = fs.readFileSync(path.join(archiveDir, '2020-01.ndjson'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.ok(!fs.existsSync(path.join(src, '2020-01-01.json')));
});

// --- BH-144: STATE_FILE corruption must not silently reset to {} ---
test('BH-144: readStateFileOrThrow returns empty seed on ENOENT (no file yet)', () => {
  const dir = tmpDir('state-b144');
  const f = path.join(dir, 'ath-state.json');
  const s = readStateFileOrThrow(f);
  assert.deepEqual(s, { asOf: null, entries: {} });
});
test('BH-144: readStateFileOrThrow throws on an existing-but-corrupt STATE_FILE', () => {
  const dir = tmpDir('state-b144corrupt');
  const f = path.join(dir, 'ath-state.json');
  fs.writeFileSync(f, '{ not valid json');
  assert.throws(() => readStateFileOrThrow(f), /Corrupt STATE_FILE/);
});
test('BH-144: readStateFileOrThrow returns the parsed state when valid', () => {
  const dir = tmpDir('state-b144ok');
  const f = path.join(dir, 'ath-state.json');
  const seed = { asOf: '2026-07-01', entries: { AAPL: { ath: 200 } } };
  fs.writeFileSync(f, JSON.stringify(seed));
  assert.deepEqual(readStateFileOrThrow(f), seed);
});

// --- BH-145: total-failure gate ---
test('BH-145: allFailed true only when 0 ok AND >0 failed AND >0 attempted', () => {
  assert.equal(allFailed(10, 0, 10), true, 'total wipeout');
  assert.equal(allFailed(10, 3, 7), false, 'partial failure is fine');
  assert.equal(allFailed(10, 10, 0), false, 'full success is fine');
  assert.equal(allFailed(0, 0, 0), false, 'nothing to do is fine (empty universe)');
});

console.log('\nbh-b11-storearchiv: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
