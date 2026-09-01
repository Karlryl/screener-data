'use strict';
/**
 * Tag 294: lib/price-history-store.js self-check (Standalone-Runner: node <datei>,
 * Exit 0/1 — same style as tests/scoring/*).
 *
 * Covers: shardOf determinism + distribution, saveAll→loadAll roundtrip deep-equal,
 * saveDirty writes ONLY the touched shards, and the legacy-fallback (dir with only
 * history.json → loadAll returns its content).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const store = require('../lib/price-history-store.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e.message)); }
}
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phs-'));
}
function sampleHistory(n) {
  const h = {};
  for (let i = 0; i < n; i++) {
    const t = 'TKR' + i;
    h[t] = [
      { date: '2026-07-0' + ((i % 9) + 1), close: 100 + i },
      { date: '2026-07-1' + ((i % 9) + 1), close: 101 + i },
    ];
  }
  // include real tickers with dots / benchmarks to exercise the key space
  h['SPY'] = [{ date: '2026-07-10', close: 500 }];
  h['BRK.B'] = [{ date: '2026-07-10', close: 400 }];
  return h;
}

test('shardOf is deterministic and in range', () => {
  for (const t of ['SPY', 'NVDA', 'AAPL', 'BRK.B', 'RHM.DE', '', 'a']) {
    const s1 = store.shardOf(t), s2 = store.shardOf(t);
    assert.equal(s1, s2, 'stable for ' + JSON.stringify(t));
    assert.ok(Number.isInteger(s1) && s1 >= 0 && s1 < store.SHARD_COUNT, 'in range for ' + t);
  }
});

test('shardOf is case-sensitive', () => {
  // documented: hash is on the exact key string. spy and SPY may differ.
  assert.equal(store.shardOf('spy'), store.shardOf('spy'));
  // not asserting they differ (could collide) — just that casing feeds the hash:
  const a = store.shardOf('AbC'), b = store.shardOf('abc');
  assert.ok(Number.isInteger(a) && Number.isInteger(b));
});

test('shardOf spreads a realistic universe across all 32 shards', () => {
  const h = sampleHistory(2000);
  const seen = new Set();
  for (const t of Object.keys(h)) seen.add(store.shardOf(t));
  assert.equal(seen.size, store.SHARD_COUNT, 'all ' + store.SHARD_COUNT + ' shards non-empty, got ' + seen.size);
});

test('saveAll → loadAll roundtrip deep-equal', () => {
  const dir = tmpDir();
  const h = sampleHistory(500);
  store.saveAll(dir, h);
  // all 32 shard files exist
  for (let n = 0; n < store.SHARD_COUNT; n++) {
    assert.ok(fs.existsSync(store.shardPath(dir, n)), 'shard ' + n + ' written');
  }
  const back = store.loadAll(dir);
  assert.deepEqual(back, h, 'roundtrip identical');
});

test('saveDirty writes ONLY the shards of changed tickers', () => {
  const dir = tmpDir();
  const h = sampleHistory(500);
  store.saveAll(dir, h);
  // record mtimes of all shards
  const before = [];
  for (let n = 0; n < store.SHARD_COUNT; n++) before[n] = fs.statSync(store.shardPath(dir, n)).mtimeMs;

  // change two tickers, note which shards they belong to
  h['TKR1'][0].close = 999;
  h['SPY'][0].close = 888;
  const dirty = new Set(['TKR1', 'SPY']);
  const expectShards = new Set([store.shardOf('TKR1'), store.shardOf('SPY')]);

  // ensure a measurable mtime delta on filesystems with coarse resolution
  const spin = Date.now() + 15; while (Date.now() < spin) { /* wait */ }

  const wrote = store.saveDirty(dir, h, dirty);
  assert.deepEqual(new Set(wrote), expectShards, 'saveDirty returns exactly the dirty shards');

  for (let n = 0; n < store.SHARD_COUNT; n++) {
    const after = fs.statSync(store.shardPath(dir, n)).mtimeMs;
    if (expectShards.has(n)) {
      assert.ok(after >= before[n], 'dirty shard ' + n + ' rewritten');
    } else {
      assert.equal(after, before[n], 'clean shard ' + n + ' untouched');
    }
  }
  // and the change is persisted + reloadable
  const back = store.loadAll(dir);
  assert.equal(back['TKR1'][0].close, 999);
  assert.equal(back['SPY'][0].close, 888);
});

test('saveDirty rebuilds a dirty shard COMPLETELY (siblings preserved)', () => {
  const dir = tmpDir();
  const h = sampleHistory(500);
  store.saveAll(dir, h);
  // pick a shard with ≥2 tickers, change one, verify the other survives
  const target = store.shardOf('SPY');
  const siblings = Object.keys(h).filter(t => store.shardOf(t) === target && t !== 'SPY');
  assert.ok(siblings.length > 0, 'need a sibling in SPY shard for this test');
  h['SPY'][0].close = 777;
  store.saveDirty(dir, h, new Set(['SPY']));
  const shard = store.loadShard(dir, target);
  assert.equal(shard['SPY'][0].close, 777);
  for (const s of siblings) assert.ok(s in shard, 'sibling ' + s + ' preserved in rebuilt shard');
});

test('legacy-fallback: dir with only history.json → loadAll returns its content', () => {
  const dir = tmpDir();
  const legacy = { SPY: [{ date: '2026-07-10', close: 1 }], NVDA: [{ date: '2026-07-10', close: 2 }] };
  fs.writeFileSync(store.legacyPath(dir), JSON.stringify(legacy));
  const back = store.loadAll(dir);
  assert.deepEqual(back, legacy, 'legacy content read when no shards exist');
  // loadShard on a legacy-only dir returns {} (no shard file) — documents that
  // consumers needing a single ticker must fall back to loadAll pre-migration.
  assert.deepEqual(store.loadShard(dir, store.shardOf('SPY')), {});
});

test('legacy-fallback: eine Datei, die zu null/Array/Zahl parst, wirft statt sie durchzureichen', () => {
  // JSON.parse('null') wirft NICHT — es liefert null. Ein solcher Rueckgabewert sieht
  // fuer jeden der zehn loadAll-Aufrufer wie eine Ticker-Karte aus und knallt erst
  // spaeter irgendwo im Consumer als TypeError (belegt: heartbeat-preis-abdeckung.js
  // brach damit mit Exit 1 ab und faerbte einen Schritt rot, der nie rot werden darf).
  // Dieselbe Klasse wie der corrupt-shard-Wurf: hier genauso laut.
  for (const inhalt of ['null', '[]', '5', '"SPY"']) {
    const dir = tmpDir();
    fs.writeFileSync(store.legacyPath(dir), inhalt);
    let err = null, wert;
    try { wert = store.loadAll(dir); } catch (e) { err = e; }
    assert.ok(err, 'loadAll muss bei ' + inhalt + ' werfen, gab aber ' + JSON.stringify(wert) + ' zurueck');
    assert.equal(err.shardPath, store.legacyPath(dir), 'der Wurf benennt die unbrauchbare Datei');
  }
  // GEGENPROBE: die gueltige Form muss weiter DURCHGEHEN (auch die leere Karte).
  const leer = tmpDir();
  fs.writeFileSync(store.legacyPath(leer), '{}');
  assert.deepEqual(store.loadAll(leer), {}, 'ein leerer Monolith ist gueltig, kein Fehler');
});

test('shards win over legacy once they exist', () => {
  const dir = tmpDir();
  fs.writeFileSync(store.legacyPath(dir), JSON.stringify({ SPY: [{ date: '2000-01-01', close: 1 }] }));
  const fresh = { SPY: [{ date: '2026-07-10', close: 500 }] };
  store.saveAll(dir, fresh);
  const back = store.loadAll(dir);
  assert.deepEqual(back, fresh, 'shard content wins, legacy ignored');
});

test('corrupt shard throws with shardPath set', () => {
  const dir = tmpDir();
  store.saveAll(dir, sampleHistory(100));
  const badN = store.shardOf('SPY');
  fs.writeFileSync(store.shardPath(dir, badN), '{ this is not json');
  let err = null;
  try { store.loadAll(dir); } catch (e) { err = e; }
  assert.ok(err, 'loadAll throws on corrupt shard');
  assert.equal(err.shardPath, store.shardPath(dir, badN), 'err.shardPath points at the bad shard');
});

test('an empty stamped store keeps tickerCount zero valid', () => {
  const dir = tmpDir();
  store.saveAll(dir, {});
  assert.equal(store.loadMeta(dir).tickerCount, 0, 'zero is the valid empty-store boundary');
  assert.deepEqual(store.loadAll(dir), {}, 'a complete stamped empty store remains loadable');
});

test('present meta rejects an invalid tickerCount without becoming bootstrap', () => {
  const history = sampleHistory(3);
  const total = Object.keys(history).length;
  const invalid = [
    ['literal null', null],
    ['missing tickerCount', { schema: 'price-history-store/1' }],
    ['numeric string', { schema: 'price-history-store/1', tickerCount: String(total) }],
    ['negative', { schema: 'price-history-store/1', tickerCount: -1 }],
    ['fractional', { schema: 'price-history-store/1', tickerCount: 1.5 }],
    ['unsafe integer', { schema: 'price-history-store/1', tickerCount: 9007199254740992 }],
  ];

  for (const [name, meta] of invalid) {
    const dir = tmpDir();
    store.saveAll(dir, history);
    fs.writeFileSync(store.metaPath(dir), JSON.stringify(meta));
    let err = null;
    try { store.loadMeta(dir); } catch (e) { err = e; }
    assert.ok(err, name + ' must throw instead of disabling the count guard');
    assert.match(err.message, /invalid tickerCount|refusing to overwrite/);
    assert.equal(err.metaPath, store.metaPath(dir), name + ' identifies the meta path');
    assert.equal(err.shardPath, store.metaPath(dir), name + ' preserves the backup-path contract');
  }
});

test('present meta with zero shard files never falls back to stale legacy data', () => {
  for (const tickerCount of [0, 1]) {
    const dir = tmpDir();
    fs.mkdirSync(path.dirname(store.metaPath(dir)), { recursive: true });
    fs.writeFileSync(store.metaPath(dir), JSON.stringify({
      schema: 'price-history-store/1',
      updatedAt: '2026-08-31T00:00:00.000Z',
      tickerCount,
      shardsWritten: store.SHARD_COUNT,
    }));
    fs.writeFileSync(store.legacyPath(dir), JSON.stringify({
      STALE: [{ date: '2000-01-01', close: 1 }],
    }));

    let err = null;
    try { store.loadAll(dir); } catch (e) { err = e; }
    assert.ok(err, 'tickerCount ' + tickerCount + ' with no shards must fail');
    assert.match(err.message, /32 shard\(s\) missing|partial store/);
    assert.equal(err.missingShards.length, store.SHARD_COUNT);
    assert.equal(err.metaPath, store.metaPath(dir));
    assert.equal(err.shardPath, undefined, 'all shards are missing; no single one is the recovery target');
  }
});

test('loadAll rejects a valid but truncated shard against the stamped ticker count', () => {
  const dir = tmpDir();
  const history = { SPY: [{ date: '2026-07-10', close: 500 }] };
  const expected = Object.keys(history).length;
  store.saveAll(dir, history);
  const shardNumber = store.shardOf('SPY');
  const removed = Object.keys(store.loadShard(dir, shardNumber)).length;
  assert.equal(removed, 1, 'fixture removes its only ticker while all 32 shard files remain');
  fs.writeFileSync(store.shardPath(dir, shardNumber), '{}');

  let err = null;
  try { store.loadAll(dir); } catch (e) { err = e; }
  assert.ok(err, 'a valid empty replacement shard must not pass as complete');
  assert.match(err.message, /truncated\/incomplete, refusing to load/);
  assert.equal(err.metaPath, store.metaPath(dir));
  assert.equal(err.expectedTickerCount, expected);
  assert.equal(err.actualTickerCount, 0, 'actual zero must not disable the mismatch guard');
  assert.equal(err.shardPath, undefined, 'no individual shard can be blamed from a count mismatch alone');
});

// Tag 1140: DIESE Vorrichtung stand invertiert. Sie forderte, dass ein Shard-Satz
// GROESSER als sein Stempel rot wird — und schrieb damit genau den Zustand fest, den
// jeder wachsende Lauf erzeugt (merge-price-shards.js:157 laedt VOR dem Neustempeln
// :165). Die Richtung ist umgedreht: Wachstum muss LADEN, Schrumpfen bleibt hart
// (Gegenprobe im Test darueber und in der Wachstums-Sonde darunter).
test('loadAll accepts a shard set that grew past its stamp (append-only Normalbetrieb)', () => {
  const dir = tmpDir();
  const history = sampleHistory(50);
  const actual = Object.keys(history).length;
  store.saveAll(dir, history);
  const meta = store.loadMeta(dir);
  fs.writeFileSync(store.metaPath(dir), JSON.stringify({ ...meta, tickerCount: 0 }));

  const back = store.loadAll(dir);
  assert.equal(Object.keys(back).length, actual, 'der gewachsene Shard-Satz muss laden');
  assert.deepEqual(back, history, 'und zwar vollstaendig, nicht auf den Stempel gekuerzt');
});

test('loadAll rejects a cross-shard duplicate even when unique tickerCount still matches meta', () => {
  const dir = tmpDir();
  const history = {
    AZ: [{ date: '2026-07-10', close: 1 }],
  };
  store.saveAll(dir, history);
  const ticker = 'AZ';
  const source = store.shardOf(ticker);
  assert.equal(source, 0, 'fixture pins a falsy first-shard identity');
  const target = 1;
  const targetShard = store.loadShard(dir, target);
  targetShard[ticker] = [{ date: '2026-07-10', close: 999 }];
  fs.writeFileSync(store.shardPath(dir, target), JSON.stringify(targetShard));

  let err = null;
  try { store.loadAll(dir); } catch (e) { err = e; }
  assert.ok(err, 'a duplicate must fail before one shard silently overwrites the other');
  assert.match(err.message, /appears in multiple shards|ambiguous store/);
  assert.equal(err.duplicateTicker, ticker);
  assert.deepEqual(
    err.duplicateShards,
    [source, target].sort((a, b) => a - b).map(store.shardFilename),
  );
  assert.equal(err.shardPath, undefined, 'both duplicate shards are suspects; neither is a safe backup target');
});

test('loadAll rejects a ticker moved to the wrong shard even when tickerCount still matches meta', () => {
  const dir = tmpDir();
  const ticker = 'MOVED';
  const series = [{ date: '2026-07-10', close: 10 }];
  store.saveAll(dir, { [ticker]: series });
  const expected = store.shardOf(ticker);
  const actual = (expected + 1) % store.SHARD_COUNT;
  fs.writeFileSync(store.shardPath(dir, expected), '{}');
  fs.writeFileSync(store.shardPath(dir, actual), JSON.stringify({ [ticker]: series }));

  let err = null;
  try { store.loadAll(dir); } catch (e) { err = e; }
  assert.ok(err, 'an equal-count move must fail before direct shard readers lose the ticker');
  assert.match(err.message, /misplaced ticker, refusing to load/);
  assert.equal(err.misplacedTicker, ticker);
  assert.equal(err.expectedShard, store.shardFilename(expected));
  assert.equal(err.actualShard, store.shardFilename(actual));
  assert.equal(err.shardPath, store.shardPath(dir, actual));
});

// Tag 1140: die Ein-Ticker-Sonde aus der Diagnose — der kleinstmoegliche Fall des
// Zustands, der den Tageslauf rot gemacht hat, mit seiner Gegenprobe im selben Test.
// Beide Richtungen stehen hier bewusst zusammen: wer eine davon kippt, sieht sofort,
// dass der Waechter nur EINE Richtung meinen darf.
test('Wachstums-Sonde: Stempel N + Shards N+1 laedt, Stempel N + Shards N-1 wird benannt abgelehnt', () => {
  const spy = [{ date: '2026-07-10', close: 500 }];
  const nvda = [{ date: '2026-07-10', close: 120 }];
  assert.notEqual(store.shardOf('NVDA'), store.shardOf('SPY'),
    'Vorbedingung: die Sonde braucht zwei verschiedene Shards');

  // (a) gewachsen — Stempel 1, Shard-Satz 2: MUSS laden.
  const gewachsen = tmpDir();
  store.saveAll(gewachsen, { SPY: spy });                    // stempelt tickerCount 1
  const zielShard = store.shardOf('NVDA');
  const shard = store.loadShard(gewachsen, zielShard);
  shard['NVDA'] = nvda;                                      // Neuzugang im RICHTIGEN Shard
  fs.writeFileSync(store.shardPath(gewachsen, zielShard), JSON.stringify(shard));
  assert.equal(store.loadMeta(gewachsen).tickerCount, 1, 'der Stempel steht noch auf N');
  assert.deepEqual(store.loadAll(gewachsen), { SPY: spy, NVDA: nvda },
    'N+1 muss durchgehen — das ist jeder wachsende Lauf');

  // (b) geschrumpft — Stempel 2, Shard-Satz 1: MUSS benannt abgelehnt werden.
  const geschrumpft = tmpDir();
  store.saveAll(geschrumpft, { SPY: spy, NVDA: nvda });      // stempelt tickerCount 2
  fs.writeFileSync(store.shardPath(geschrumpft, store.shardOf('NVDA')), '{}');
  let err = null;
  try { store.loadAll(geschrumpft); } catch (e) { err = e; }
  assert.ok(err, 'ein verlorener Ticker darf NICHT als vollstaendiger Store durchgehen');
  assert.match(err.message, /truncated\/incomplete, refusing to load/);
  assert.equal(err.expectedTickerCount, 2);
  assert.equal(err.actualTickerCount, 1);
  assert.equal(err.metaPath, store.metaPath(geschrumpft));
});

// Tag 1140: derselbe Wachstumszustand durch den ECHTEN Aufrufer. Der Store-Test allein
// belegt nicht, dass die rote Stelle im Tageslauf wieder gruen ist: dort steht
// loadAll (merge-price-shards.js:157) VOR dem Neustempeln (:165). Nur dieser Lauf
// beweist beides — laedt UND stempelt danach auf N+1 nach.
test('merge-price-shards laedt den gewachsenen Store und stempelt _meta auf N+1 nach', () => {
  const dir = tmpDir();
  store.saveAll(dir, { SPY: [{ date: '2026-07-10', close: 500 }] });   // Stempel 1
  const zielShard = store.shardOf('NVDA');
  const shard = store.loadShard(dir, zielShard);
  shard['NVDA'] = [{ date: '2026-07-10', close: 120 }];
  fs.writeFileSync(store.shardPath(dir, zielShard), JSON.stringify(shard));

  const datum = '2026-09-01';
  fs.writeFileSync(path.join(dir, datum + '.shard-0.json'), '{}');
  const lauf = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'merge-price-shards.js'),
    '--prices', dir, '--date', datum, '--expected-shards', '1',
  ], { encoding: 'utf8' });

  assert.equal(lauf.status, 0,
    'der Merge muss den gewachsenen Store laden:\n' + (lauf.stdout || '') + (lauf.stderr || ''));
  assert.equal(store.loadMeta(dir).tickerCount, 2, '_meta zieht auf den Gesamtstand N+1 nach');
});

test('A7-b: saveAll/saveDirty stamp _meta.json (freshness proof), loadMeta reads it', () => {
  const dir = tmpDir();
  const h = sampleHistory(50);
  assert.equal(store.loadMeta(dir), null, 'no meta before first write');
  store.saveAll(dir, h);
  const m1 = store.loadMeta(dir);
  assert.ok(m1 && m1.schema === 'price-history-store/1', 'meta stamped by saveAll');
  assert.equal(m1.tickerCount, Object.keys(h).length, 'tickerCount matches');
  assert.equal(m1.shardsWritten, store.SHARD_COUNT, 'saveAll writes all shards');
  assert.ok(Number.isFinite(Date.parse(m1.updatedAt)), 'updatedAt parses');
  const spin = Date.now() + 15; while (Date.now() < spin) { /* mtime/clock delta */ }
  h['SPY'][0].close = 555;
  store.saveDirty(dir, h, new Set(['SPY']));
  const m2 = store.loadMeta(dir);
  assert.equal(m2.shardsWritten, 1, 'saveDirty stamps with dirty-shard count');
  assert.ok(Date.parse(m2.updatedAt) >= Date.parse(m1.updatedAt), 'stamp advances');
});

console.log('\nprice-history-store: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
