'use strict';
// main runs against an in-memory filesystem; break-once never modifies live files or writing tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const sourcePath = path.join(ROOT, 'scripts/write-excluded-list.js');
if (process.argv.includes('--break-once')) {
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
  const before = hash();
  for (const mutation of ['export-key', 'reentry', 'counter']) {
    const r = cp.spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8',
      env: { ...process.env, SIZE_EXCLUDED_MUTATION: mutation } });
    assert.equal(r.status, 1, mutation + ' must turn the guard red');
    assert.match(r.stderr, /AssertionError/);
    assert.equal(hash(), before, 'live export source changed');
    console.log('BREAK_ONCE ' + mutation + ' exit=1 detected=true liveHashUnchanged=true');
  }
  process.exit(0);
}
const mutations = {
  'export-key': ['    sizeExits,', '    // mutant: omit the additive export key'],
  reentry: ['  const sizeExits = mergeSizeExits([exits]).filter(r => !present.has(r.ticker))', '  const sizeExits = mergeSizeExits([exits])'],
  counter: ['    counts: { firmen: rows.length, zeilen: legs, byReason, sizeExits: sizeExits.length },', '    counts: { firmen: rows.length, zeilen: legs, byReason, sizeExits: 0 },'],
};
function mutate(source) {
  const row = mutations[process.env.SIZE_EXCLUDED_MUTATION];
  if (!row) return source;
  const lines = source.split(/\r?\n/);
  assert.equal(lines.filter(line => line === row[0]).length, 1, 'complete-line mutation anchor');
  return lines.map(line => line === row[0] ? row[1] : line).join('\n');
}
const compile = Module.prototype._compile;
Module.prototype._compile = function(source, file) { return compile.call(this, file === sourcePath ? mutate(source) : source, file); };
const { buildExcludedList, pruefeSummen, beineGesamt } = require('../../scripts/write-excluded-list.js');
const { buildSizeExit, SIZE_EXITS_FILE } = require('../../lib/size-exits.js');
const { scoreUniverse, produceRankings } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');
const basis = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/CRDO.json'), 'utf8'));
const bank = structuredClone(basis);
bank.meta = { ...bank.meta, ticker: 'TESTBANK', name: 'Size export test bank', sector: 'Financial Services', industry: 'Banks - Regional' };
const universe = [structuredClone(basis), bank];
const results = scoreUniverse(universe, formulas);
const counters = produceRankings(results, { topN: 50 }).excluded;
const exits = [buildSizeExit('SKS.AX', 790000000, 800000000, '2026-10-07T12:00:00Z', 'full-pull'),
  buildSizeExit('IMMX', 799999999, 800000000, '2026-10-07', 'price-only'),
  buildSizeExit('CRDO', 700000000, 800000000, '2026-10-07', 'price-only')];
const plain = buildExcludedList(results, universe);
const list = buildExcludedList(results, universe, exits);
assert.deepEqual(list.rows, plain.rows);
assert.equal(list.legs, plain.legs);
assert.equal(beineGesamt(list.rows), plain.legs);
assert.deepEqual(list.byReason, plain.byReason);
assert.deepEqual(pruefeSummen(list.byReason, counters), []);
assert.deepEqual(list.sizeExits.map(r => r.ticker), ['IMMX', 'SKS.AX']);
assert.equal(list.sizeExits[1].reasonDe, 'unter der Gr\u00f6\u00dfengrenze von 0,8 Mrd. USD am 07.10.2026');
assert.equal(pruefeSummen(list.byReason, { ...counters, insurer: (counters.insurer || 0) + 1 }).length, 1, 'sum guard must remain active');
console.log('PASS buildExcludedList: exits separate, exact reason, reentry suppressed and scored counters unchanged');

function mainOutput(records, raw) {
  const files = new Map(), logs = [], written = new Map();
  const exitsPath = path.join(ROOT, 'snapshots', SIZE_EXITS_FILE);
  const excludedPath = path.join(ROOT, 'outputs/findash-export/v1/excluded.json');
  files.set(path.join(ROOT, 'configs/scoring-mode.json'), JSON.stringify({ schema: 'scoring-mode/v1', modus: 'live-lernend' }));
  files.set(path.join(ROOT, 'outputs/calibration.json'), JSON.stringify(results.calibration));
  files.set(path.join(ROOT, 'outputs/findash-export/v1/index.json'), JSON.stringify({ excluded: counters }));
  if (records !== undefined) files.set(exitsPath, raw === undefined ? JSON.stringify(records) : raw);
  const fakeFs = {
    readFileSync(p) { if (files.has(p)) return files.get(p); throw Object.assign(new Error('Virtual file missing'), { code: 'ENOENT' }); },
    mkdirSync() {}, statSync(p) { return { size: Buffer.byteLength(JSON.stringify(written.get(p))) }; },
  };
  const module = { exports: {} };
  const actualRequire = Module.createRequire(sourcePath);
  function fakeRequire(req) {
    if (req === 'fs') return fakeFs;
    if (req === '../lib/atomic-write.js') return { writeJsonAtomic(p, value) {
      assert([excludedPath, path.join(ROOT, 'outputs/universe-hash.json')].includes(p), 'unexpected virtual write');
      written.set(p, value);
    } };
    if (req === '../src/scoring/run-screener.js') return { loadUniverse: () => universe };
    if (req === '../src/scoring/score.js') return { ...actualRequire(req), scoreUniverse: () => results };
    return actualRequire(req);
  }
  fakeRequire.main = module;
  vm.runInNewContext(mutate(fs.readFileSync(sourcePath, 'utf8')), { module, require: fakeRequire,
    __dirname: path.dirname(sourcePath), process: { env: {} }, console: { log: line => logs.push(line) } }, { filename: sourcePath });
  return { output: JSON.parse(JSON.stringify(written.get(excludedPath))), logs };
}
const baseline = mainOutput([]).output;
const exported = mainOutput(exits);
assert.deepEqual(exported.output.sizeExits, list.sizeExits);
assert.equal(exported.output.counts.sizeExits, 2);
assert.equal(exported.output.schema, 'findash-export/v1');
assert.deepEqual(exported.output.rows, baseline.rows);
assert.deepEqual(exported.output.counts.byReason, baseline.counts.byReason);
assert.equal(exported.output.counts.firmen, baseline.counts.firmen);
assert.equal(exported.output.counts.zeilen, baseline.counts.zeilen);
assert.equal(exported.output.universeHash, baseline.universeHash);
assert(exported.logs.some(line => line.includes('2 Gr\u00f6\u00dfenabg\u00e4nge')));
console.log('PASS actual main export: sizeExits/counts.sizeExits additive, existing rows/counts/schema/hash unchanged');
const missing = mainOutput();
assert.deepEqual(missing.output.sizeExits, []);
assert.equal(missing.output.counts.sizeExits, 0);
assert(missing.logs.some(line => line.includes('Es sind keine Abg\u00e4nge bekannt.')));
assert.throws(() => mainOutput([], '{broken'), /JSON|Unexpected|position|property/i, 'corrupt reports must not become an empty list');
assert.throws(() => mainOutput({}), /array/, 'invalid report shape must not become an empty list');
console.log('PASS missing exits file: no crash, honest log and zero count; corrupt reports fail loudly');
console.log('ausschlussliste-size-exits.test.js: all passed; diskWrites=0 networkCalls=0');
