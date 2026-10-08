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
  for (const mutation of ['export-key', 'reentry', 'counter', 'day30', 'day31', 'future', 'known', 'fallback', 'unknown-log', 'v2']) {
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
  day30: ['    .filter(r => options.referenceDay === undefined || (r.date <= options.referenceDay && Date.parse(options.referenceDay) - Date.parse(r.date) <= 30 * 86400000))', '    .filter(r => options.referenceDay === undefined || (r.date <= options.referenceDay && Date.parse(options.referenceDay) - Date.parse(r.date) < 30 * 86400000))'],
  day31: ['    .filter(r => options.referenceDay === undefined || (r.date <= options.referenceDay && Date.parse(options.referenceDay) - Date.parse(r.date) <= 30 * 86400000))', '    .filter(r => options.referenceDay === undefined || (r.date <= options.referenceDay && Date.parse(options.referenceDay) - Date.parse(r.date) <= 31 * 86400000))'],
  future: ['    .filter(r => options.referenceDay === undefined || (r.date <= options.referenceDay && Date.parse(options.referenceDay) - Date.parse(r.date) <= 30 * 86400000))', '    .filter(r => options.referenceDay === undefined || Date.parse(options.referenceDay) - Date.parse(r.date) <= 30 * 86400000)'],
  known: ['    sizeExitsKnown,', '    sizeExitsKnown: true,'],
  fallback: ['    exits = readSizeExitHistory(undefined, fs).exits;', '    exits = [];'],
  'unknown-log': ["  else console.log('[excluded-list] Austritte unbekannt, weil kein vollst\\u00e4ndiger Bericht dieses Laufs vorliegt.'", "  else console.log('[excluded-list] Nothing to report.'"],
  v2: ["    const manifest = validateSizeExitManifest(JSON.parse(fs.readFileSync(SIZE_EXITS_PATH, 'utf8')));", "    const manifest = JSON.parse(fs.readFileSync(SIZE_EXITS_PATH, 'utf8'));"],
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
const { buildSizeExit, SIZE_EXITS_FILE, SIZE_EXITS_HISTORY_FILE } = require('../../lib/size-exits.js');
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
const referenceDay = '2026-10-07';
const atAge = (ticker, age) => buildSizeExit(ticker, 1, 8e8,
  new Date(Date.parse(referenceDay) - age * 86400000).toISOString(), 'full-pull');
const windowExits = [atAge('DAY30', 30), atAge('DAY31', 31), atAge('FUTURE', -1), ...exits];
assert.deepEqual(buildExcludedList(results, universe, windowExits, { referenceDay }).sizeExits.map(r => r.ticker), ['DAY30', 'IMMX', 'SKS.AX']);
assert.deepEqual(buildExcludedList(results, universe, windowExits).sizeExits.map(r => r.ticker), ['DAY30', 'DAY31', 'FUTURE', 'IMMX', 'SKS.AX'], 'three-argument calls retain their existing behavior');
console.log('PASS export window: day 30 kept, day 31/future dropped and three-argument behavior unchanged');

function mainOutput(records, raw, options = {}) {
  const files = new Map(), logs = [], written = new Map();
  const exitsPath = path.join(ROOT, 'snapshots', SIZE_EXITS_FILE);
  const excludedPath = path.join(ROOT, 'outputs/findash-export/v1/excluded.json');
  files.set(path.join(ROOT, 'configs/scoring-mode.json'), JSON.stringify({ schema: 'scoring-mode/v1', modus: 'live-lernend' }));
  files.set(path.join(ROOT, 'outputs/calibration.json'), JSON.stringify(results.calibration));
  files.set(path.join(ROOT, 'outputs/findash-export/v1/index.json'), JSON.stringify({ excluded: counters }));
  if (records !== undefined) files.set(exitsPath, raw === undefined ? JSON.stringify(Array.isArray(records)
    ? { schema: 'size-exits/v2', known: options.known ?? true, runDate: referenceDay, exits: records } : records) : raw);
  if (options.history !== undefined) files.set(path.join(ROOT, SIZE_EXITS_HISTORY_FILE), options.history);
  const fakeFs = {
    readFileSync(p) { if (p === exitsPath && options.readError) throw options.readError;
      if (files.has(p)) return files.get(p); throw Object.assign(new Error('Virtual file missing'), { code: 'ENOENT' }); },
    mkdirSync() {}, statSync(p) { return { size: Buffer.byteLength(JSON.stringify(written.get(p))) }; },
  };
  const module = { exports: {} };
  const actualRequire = Module.createRequire(sourcePath);
  function fakeRequire(req) {
    if (req === 'fs') return fakeFs;
    if (req === '../lib/size-exits.js') return { ...actualRequire(req),
      sizeExitRunDay: env => actualRequire(req).sizeExitRunDay(env, () => Date.parse('2026-10-08T12:00:00Z')) };
    if (req === '../lib/atomic-write.js') return { writeJsonAtomic(p, value) {
      assert([excludedPath, path.join(ROOT, 'outputs/universe-hash.json')].includes(p), 'unexpected virtual write');
      written.set(p, value);
    } };
    if (req === '../src/scoring/run-screener.js') return { loadUniverse: () => universe };
    if (req === '../src/scoring/score.js') return { ...actualRequire(req), scoreUniverse: () => results };
    return actualRequire(req);
  }
  fakeRequire.main = module;
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-08T12:00:00Z'])); } }
  vm.runInNewContext(mutate(fs.readFileSync(sourcePath, 'utf8')), { module, require: fakeRequire,
    __dirname: path.dirname(sourcePath), Date: FixedDate, process: { env: {} }, console: { log: line => logs.push(line) } }, { filename: sourcePath });
  return { output: JSON.parse(JSON.stringify(written.get(excludedPath))), logs };
}
const baseline = mainOutput([]).output;
const exported = mainOutput(exits);
assert.deepEqual(exported.output.sizeExits, list.sizeExits);
assert.equal(exported.output.counts.sizeExits, 2);
assert.equal(exported.output.sizeExitsKnown, true);
assert.deepEqual(Object.keys(exported.output).slice(-2), ['sizeExitsKnown', 'sizeExits']);
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
assert.equal(missing.output.sizeExitsKnown, false);
assert(missing.logs.some(line => line.includes('Austritte unbekannt') && line.includes('kein vollst\u00e4ndiger Bericht dieses Laufs')));
assert.throws(() => mainOutput([], '{broken'), /JSON|Unexpected|position|property/i, 'corrupt reports must not become an empty list');
assert.throws(() => mainOutput({}), /size-exits\/v2/, 'invalid report shape must not become an empty list');
assert.throws(() => mainOutput([], '[]'), /size-exits\/v2/, 'legacy bare arrays are rejected');
for (const shape of [{ schema: 'wrong', known: true, runDate: referenceDay, exits: [] },
  { schema: 'size-exits/v2', known: 'true', runDate: referenceDay, exits: [] },
  { schema: 'size-exits/v2', known: true, runDate: '2026-02-30', exits: [] },
  { schema: 'size-exits/v2', known: true, runDate: referenceDay, exits: null }]) {
  assert.throws(() => mainOutput(shape), /size-exits\/v2/);
}
assert.throws(() => mainOutput(undefined, undefined, { readError: Object.assign(new Error('denied'), { code: 'EACCES' }) }), /denied/);
const fromHistory = mainOutput(undefined, undefined, {
  history: JSON.stringify({ schema: 'size-exits-history/v1', exits: [...exits, atAge('DAY30', 30), atAge('CLOCK30', 29)] }),
});
assert.equal(fromHistory.output.sizeExitsKnown, false);
assert.deepEqual(fromHistory.output.sizeExits.map(r => r.ticker), ['CLOCK30', 'IMMX', 'SKS.AX'], 'missing artifact uses clock day and committed history');
assert(fromHistory.logs.some(line => line.includes('Austritte unbekannt') && line.includes('3 fr\u00fchere Austritte')));
assert.throws(() => mainOutput(undefined, undefined, { history: '{broken' }), /JSON|Unexpected|position|property/i);
assert.throws(() => mainOutput(undefined, undefined, { history: '{"schema":"wrong","exits":[]}' }), /history/);
const unknown = mainOutput(exits, undefined, { known: false });
assert.equal(unknown.output.sizeExitsKnown, false);
assert.deepEqual(unknown.output.sizeExits, list.sizeExits);
assert(unknown.logs.some(line => line.includes('Austritte unbekannt') && line.includes('2 fr\u00fchere Austritte')));
const windowed = mainOutput(windowExits);
assert.deepEqual(windowed.output.sizeExits.map(r => r.ticker), ['DAY30', 'IMMX', 'SKS.AX'], 'artifact runDate overrides the clock day');
for (const result of [exported, missing, fromHistory, unknown, windowed, mainOutput([], undefined, { known: false })]) {
  assert.equal(result.output.counts.sizeExits, result.output.sizeExits.length);
  const unchanged = out => {
    const copy = structuredClone(out); delete copy.sizeExits; delete copy.sizeExitsKnown; delete copy.counts.sizeExits; return JSON.stringify(copy);
  };
  assert.equal(unchanged(result.output), unchanged(baseline), 'every other key/value is byte-identical');
}
console.log('PASS actual export: known/unknown, history fallback, v2 validation, reference day, exact counts and unchanged rows/byReason/hash');
console.log('ausschlussliste-size-exits.test.js: all passed; diskWrites=0 networkCalls=0');
