'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { loadHelpers, readCounters, verdict, scanPopulation, report, main } = require('../scripts/durchsatz-lesehilfe');
const helpers = loadHelpers();
const manifest = values => Object.fromEntries(helpers.names.map((name, i) => [name, values[i]]));
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`OK ${name}`); }
  catch (err) { fail++; console.error(`FAIL ${name}: ${err.message}`); }
}

test('large eligible stale population: gate does not brake', () => {
  assert.equal(verdict([16048, 8750, 4, 0]), 'Tor bremst nicht');
});
test('few eligible, many excluded stale: gate brakes', () => {
  assert.equal(verdict([16048, 135, 8615, 0]), 'Tor bremst');
});
test('intermediate and observed 18/4 are undecidable with both distances', () => {
  assert.equal(verdict([16048, 2000, 2000, 0]), 'nicht entscheidbar: kein eindeutiges Urteil');
  const text = report(manifest([16048, 18, 4, 0]), null, helpers);
  assert.match(text, /zu 8750 = 8732; zu 135 = 117/);
  assert.match(text, /Urteil: nicht entscheidbar: kein eindeutiges Urteil$/);
});
test('missing is not zero: explicit independent counterexample', () => {
  assert.deepEqual(readCounters({}, helpers.names), [null, null, null, null]);
  assert.equal(verdict(readCounters({}, helpers.names)), 'nicht entscheidbar: Manifest ohne Selektor-Zähler');
  const zero = readCounters(manifest([0, 0, 0, 0]), helpers.names);
  assert.deepEqual(zero, [0, 0, 0, 0]);
  assert.equal(verdict(zero), 'nicht entscheidbar: kein eindeutiges Urteil');
  assert.equal((report({}, null, helpers).match(/nicht vorhanden/g) || []).length, 4);
});
test('each single missing counter prevents judgment', () => {
  for (let i = 0; i < 4; i++) {
    const mixed = Object.fromEntries(helpers.names.flatMap((name, j) => i === j ? [] : [[name, [16048, 8750, 4, 0][j]]]));
    assert.equal(verdict(readCounters(mixed, helpers.names)), 'nicht entscheidbar: Manifest ohne Selektor-Zähler');
  }
});
test('invalid numbers, partial runs and impossible subset fail closed', () => {
  for (const value of [null, '0', -1, 1.5, NaN]) assert.throws(() => readCounters(manifest([value, 0, 0, 0]), helpers.names));
  assert.match(verdict([16048, 8750, 4, 0], null, { partial: true }), /nicht entscheidbar/);
  assert.match(verdict([1, 8750, 4, 0]), /widersprüchliche/);
});

// In-memory filesystem: test fixtures never write, delete, or read user data.
const now = Date.parse('2026-09-20T12:00:00Z');
const ago = days => new Date(now - days * 86400000).toISOString();
function virtualFS(entries) {
  const files = new Map(Object.entries(entries).map(([name, value]) => [path.normalize(name), typeof value === 'string' ? value : JSON.stringify(value)]));
  return {
    existsSync: file => files.has(path.normalize(file)),
    openSync: file => { if (!files.has(path.normalize(file))) throw Error('missing'); return path.normalize(file); },
    closeSync() {},
    readSync(fd, buffer, offset, length, position) { return Buffer.from(files.get(fd)).copy(buffer, offset, position, position + length); },
    readFileSync(file) { if (!files.has(path.normalize(file))) throw Error('missing'); return files.get(path.normalize(file)); },
    readdirSync(dir) {
      const prefix = path.normalize(dir) + path.sep;
      const entries = new Map();
      for (const file of files.keys()) if (file.startsWith(prefix)) {
        const parts = file.slice(prefix.length).split(path.sep);
        entries.set(parts[0], parts.length > 1);
      }
      return [...entries].map(([name, directory]) => ({ name, isDirectory: () => directory, isFile: () => !directory, isSymbolicLink: () => false }));
    },
  };
}
function fixture() {
  const snapshot = (ticker, age, fundamental, extra = {}) => ({ meta: { ticker, asOf: ago(age), fundamentalsAsOf: ago(fundamental), ...extra } });
  return virtualFS({
    'pop/shard/a.json': snapshot('A', 1, 31),
    'pop/shard/b.json': snapshot('B', 8, 40),
    'pop/shard/c.json': snapshot('C', 7, 30),
    'pop/shard/d.json': snapshot('D', 8, 0, { fundamentalsAsOf: 'bad' }),
    'pop/shard/e.json': snapshot('E', 1, 0, { fundamentalsIncomplete: true }),
    'pop/shard/f.json': snapshot('F', 1, 0, { fundamentalsAsOf: null, fetchedAt: ago(40) }),
    'pop/shard/g.json': snapshot('G', 0, 50, { asOf: 'bad' }),
    'pop/shard/h.json': snapshot('H', 1, -1),
    'pop/_manifest.json': { n_ok: 8 },
    'manifest.json': { pulled_at: new Date(now).toISOString() },
  });
}
test('recursive population, metadata, exact boundaries, fallback and incomplete clocks', () => {
  const io = fixture(), p = scanPopulation('pop', now, loadHelpers(io), io);
  assert.equal(p.files, 9); assert.equal(p.snapshots, 8); assert.equal(p.metadata, 1);
  assert.equal(p.known, 6); assert.equal(p.stale, 3);
  assert.deepEqual(p.ages, [1, 1, 1, 3, 0, 0, 2]);
  assert.deepEqual(p.counters, [4, 3, 1, 1]);
  assert.equal(p.none, 1); assert.equal(p.oldFresh, 1);
  assert.equal(p.youngClockStale, 1); assert.equal(p.youngRuleOnly, 2);
  assert.equal(p.youngIncomplete, 1);
});
test('different measurements override gate heuristic; matching values do not', () => {
  const p = { snapshots: 17393, invalid: 0, counters: [16050, 18, 1318, 0] };
  assert.equal(verdict([16048, 18, 4, 0], p), 'die beiden Messungen messen nicht dasselbe');
  assert.equal(verdict([16050, 18, 1318, 0], p), 'nicht entscheidbar: kein eindeutiges Urteil');
  assert.match(verdict([0, 0, 0, 0], { snapshots: 0, invalid: 0 }), /leere/);
});
test('CLI path: old manifest gives four missing fields, share, verdict, exit zero', () => {
  let output = '';
  const exit = main(['manifest.json', 'pop'], { io: fixture(), write: s => { output = s; }, error: s => assert.fail(s) });
  assert.equal(exit, 0);
  assert.equal((output.match(/nicht vorhanden \(Manifest älter als #323\)/g) || []).length, 4);
  assert.match(output, /3\/6 lesbare fundamentalsAsOf = 50.00 %/);
  assert.match(output, /Urteil: nicht entscheidbar: Manifest ohne Selektor-Zähler$/);
});
test('bad JSON and missing analysis time return exit one', () => {
  for (const data of ['{', '{}']) {
    let message;
    const exit = main(['m', 'pop'], { io: virtualFS({ m: data }), write: () => assert.fail('unexpected success'), error: s => { message = s; } });
    assert.equal(exit, 1); assert.match(message, /Fehler:/);
  }
});
test('unreadable snapshot is counted and blocks inference', () => {
  const io = virtualFS({ 'pop/a.json': '{' });
  const p = scanPopulation('pop', now, loadHelpers(io), io);
  assert.equal(p.invalid, 1);
  assert.match(verdict([10000, 8750, 0, 0], p), /beschädigte/);
});
test('500-byte asOf and 4096-byte fundamentals windows stay distinct', () => {
  const io = virtualFS({ 'pop/a.json': { meta: { ticker: 'A', padding: 'x'.repeat(600), asOf: ago(1), fundamentalsAsOf: ago(31) } } });
  const p = scanPopulation('pop', now, loadHelpers(io), io);
  assert.equal(p.stale, 1); assert.equal(p.none, 1);
  assert.deepEqual(p.counters, [0, 0, 0, 0]);
});

console.log(`durchsatz-lesehilfe: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
