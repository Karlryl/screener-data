'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const P = require('../src/scoring/annual-pairs.js');
const A = require('../src/scoring/axes.js');
const { snapshot, boardZeile, baueExport } = require('./rule40-fixture.js');
const ROOT = path.resolve(__dirname, '..');
const FIXED = '2026-10-06T12:00:00.000Z';
const dates = ['2025-12-31', '2024-12-31', '2023-12-31'];
const gap = ['2025-12-31', '2023-12-31', '2022-12-31'];
const read = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const without = value => JSON.stringify(value, (key, v) => key === 'annualPairsShadow' ? undefined : v);
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok ' + name); }

// P89/P112 pattern: execute the real writers twice on identical input, once with
// ONLY the new shadow calculator replaced by a no-op. No frozen whole-row output.
function writers(files, { baseline = false, calibration = true, diskRoot } = {}) {
  const warnings = [], reads = new Map(), preparations = new Map(), shadows = new Map(), written = new Map();
  const virtualSnapshots = path.join(os.tmpdir(), 'p115-memory-snapshots');
  const calibrationFile = path.join(ROOT, 'outputs/calibration.json');
  if (calibration) files.set(calibrationFile, JSON.stringify({ growthBounds: [-1, 2], winsorBounds: { qoq: [-0.1, 0.1] } }));
  const fixtureFs = { ...fs,
    readFileSync(file, encoding) {
      const target = path.resolve(file);
      if (target.startsWith(virtualSnapshots + path.sep) || (diskRoot && target.startsWith(diskRoot + path.sep))) {
        reads.set(target, (reads.get(target) || 0) + 1);
      }
      if (files.has(target)) return encoding ? files.get(target) : Buffer.from(files.get(target));
      if (diskRoot && target.startsWith(diskRoot + path.sep)) return fs.readFileSync(target, encoding);
      throw Object.assign(new Error('Fixture file missing: ' + target), { code: 'ENOENT' });
    },
    existsSync(file) { return files.has(path.resolve(file)) || [...files.keys()].some(p => p.startsWith(path.resolve(file) + path.sep)); },
    readdirSync(file, opts) {
      if (diskRoot && path.resolve(file).startsWith(diskRoot + path.sep)) return fs.readdirSync(file, opts);
      return [];
    },
    mkdirSync() {}, rmSync() {}, // Virtual output only; never remove a real directory.
  };
  const prepared = require('../lib/yahoo-q4-known-cases.js');
  const fcf = require('../lib/fcf-stmt-shadow.js');
  const clock = class extends Date { constructor(...args) { super(...(args.length ? args : [FIXED])); } static now() { return Date.parse(FIXED); } };
  const processView = { ...process, env: { ...process.env, FINDASH_SNAPSHOTS_DIR: virtualSnapshots,
    FINDASH_SMALLCAP_SNAPSHOTS_DIR: path.join(os.tmpdir(), 'p115-memory-smallcap') } };
  function load(relative, findash) {
    const file = path.join(ROOT, relative), realRequire = createRequire(file), module = { exports: {} };
    const localRequire = id => {
      if (id === 'fs' || id === 'node:fs') return fixtureFs;
      if (id === './write-findash-export.js') return findash;
      if (id === '../lib/atomic-write.js') return { writeJsonAtomic: (file, value) => written.set(path.resolve(file), JSON.parse(JSON.stringify(value))) };
      if (id === '../lib/fcf-stmt-shadow.js') return { ...fcf, ladeBehoerdenJahre: () => new Map() };
      if (id === '../src/scoring/annual-pairs.js') return { ...P, annualPairsShadow: (s, ...args) => {
        if (s) shadows.set(s.meta.ticker, (shadows.get(s.meta.ticker) || 0) + 1);
        return baseline ? undefined : P.annualPairsShadow(s, ...args);
      } };
      if (id === '../lib/yahoo-q4-known-cases.js') return { ...prepared, prepareSnapshot: s => {
        if (s) preparations.set(s.meta.ticker, (preparations.get(s.meta.ticker) || 0) + 1);
        return prepared.prepareSnapshot(s);
      } };
      return realRequire(id);
    };
    let source = fs.readFileSync(file, 'utf8').replace(/^#![^\n]*\n/, '');
    if (relative.endsWith('write-findash-export.js')) {
      source += '\nmodule.exports.testBuilders = { buildOverview, buildQualityBoard, buildQualityOverview, buildSmallcapBoard, buildSmallcapOverview };';
    }
    vm.runInNewContext('(function(require,module,exports,__dirname,__filename){' + source + '\n})',
      { console: { ...console, warn: line => warnings.push(String(line)) }, process: processView, Date: clock, URL, Buffer })(
      localRequire, module, module.exports, path.dirname(file), file);
    return module.exports;
  }
  const W = load('scripts/write-findash-export.js');
  const R = load('scripts/write-rule40-export.js', W);
  return { W, R, warnings, reads, preparations, shadows, written, virtualSnapshots };
}

function exportFixture(options = {}) {
  const files = new Map(), harness = writers(files, options), { W, R, virtualSnapshots } = harness;
  const put = (file, value) => files.set(path.resolve(file), typeof value === 'string' ? value : JSON.stringify(value));
  const input = read('tests/fixtures/non-operating-shadow/export-fixture.json').input;
  const mcap = read('tests/fixtures/mcap-classes-shadow/exports/health-care.json');
  const allRows = [...input.board, ...input.overview, ...mcap.profitable].map(row => ({ ...row, coverageAxes: '7/7' }));
  for (const row of allRows) {
    const s = snapshot({ ticker: row.ticker, annualRevEnds: row.ticker === 'SBR' ? gap : dates });
    Object.assign(s.meta, { tradingCurrency: 'USD', reportingCurrency: 'USD' });
    s.annual.annualGPEnds = row.ticker === 'SBR' ? gap : dates;
    if (row.ticker === 'SBR') s.timeseries.revenueQ = []; // annual display visibly differs in shadow
    row.revGrowthYoYPct = A.revGrowthLevel(s);
    put(path.join(virtualSnapshots, row.ticker + '.json'), s);
  }
  const noSnapshot = { ...allRows[0], ticker: 'NOSNAP', revGrowthYoYPct: null, marketCap: null };
  const unreadable = { ...noSnapshot, ticker: 'BROKEN' };
  put(path.join(virtualSnapshots, 'BROKEN.json'), '{broken');
  const board = { profitable: [...allRows.filter(r => r.track === 'profitable'), noSnapshot, unreadable],
    unprofitable: allRows.filter(r => r.track === 'unprofitable') };
  const source = path.join(os.tmpdir(), 'p115-memory-boards');
  const fullSource = path.join(os.tmpdir(), 'p115-memory-full');
  const fullTarget = path.join(os.tmpdir(), 'p115-memory-output');
  put(path.join(source, 'financials.json'), board);
  for (const branch of W.BRANCHES) put(path.join(fullSource, branch + '.json'), branch === 'financials' ? board : { profitable: [], unprofitable: [] });
  put(path.join(ROOT, 'outputs/hypergrowth/overview.json'), allRows);
  put(path.join(source, 'quality-financials.json'), board);
  put(path.join(source, 'smallcap-financials.json'), board);
  put(path.join(source, 'overview.json'), allRows);
  const top = W.buildBoard('financials', null, { srcDir: source, rangOpts: { warn: false } });
  W.buildFullBoards(null, { hgFullDir: fullSource, outFullDir: fullTarget });
  const full = harness.written.get(path.join(fullTarget, 'financials.json'));
  const overview = W.testBuilders.buildOverview(null);
  const quality = W.testBuilders.buildQualityBoard('quality-financials.json', null, source);
  const qualityOverview = W.testBuilders.buildQualityOverview(null, source);
  // No small-cap snapshots available: this exercises its legitimate main-store fallback too.
  const smallcap = W.testBuilders.buildSmallcapBoard('smallcap-financials.json', null, source);
  const smallcapOverview = W.testBuilders.buildSmallcapOverview(null, source);
  const survival = input.survival.map(W.mapSurvivalRow);
  const rule40 = R.baueZeilen(input.candidates);
  return { harness, output: { top, full, overview, quality, qualityOverview, smallcap, smallcapOverview, survival, rule40 } };
}

check('real writers: every existing row key, value, rank and score is byte-identical', () => {
  const actual = exportFixture(), reference = exportFixture({ baseline: true });
  const compare = output => assert.equal(without(output), JSON.stringify(reference.output));
  compare(actual.output);
  const out = actual.output;
  for (const rows of [out.top.profitable, out.top.unprofitable, out.full.profitable, out.full.unprofitable, out.overview.rows, out.rule40.rows]) {
    assert.ok(rows.length);
    for (const row of rows) assert.ok(row.annualPairsShadow && row.annualPairsShadow.windowDays);
  }
  for (const rows of [out.quality.profitable, out.quality.unprofitable, out.qualityOverview.rows,
    out.smallcap.profitable, out.smallcap.unprofitable, out.smallcapOverview.rows, out.survival]) {
    for (const row of rows) assert.equal(Object.hasOwn(row, 'annualPairsShadow'), false);
  }
  const rejected = out.top.profitable.find(r => r.ticker === 'SBR').annualPairsShadow;
  assert.equal(rejected.growth.code, 'missing-year'); assert.equal(rejected.growth.shadow, null);
  assert.ok(Number.isFinite(rejected.growth.today));
  assert.equal(out.top.profitable.find(r => r.ticker === 'NOSNAP').annualPairsShadow.growth.code, 'no-snapshot');
  assert.equal(out.top.profitable.find(r => r.ticker === 'BROKEN').annualPairsShadow.growth.code, 'snapshot-unreadable');
  assert.equal(actual.harness.warnings.filter(x => x.includes('[annual-pairs-shadow]')).length, 0);
  const broken = JSON.parse(JSON.stringify(out)); broken.top.profitable[0].rank++;
  assert.throws(() => compare(broken), assert.AssertionError);
  broken.top.profitable[0].rank--; broken.top.profitable[0].score++;
  assert.throws(() => compare(broken), assert.AssertionError);
  compare(out);
  const count = actual.harness;
  for (const ticker of ['SBR', 'NXP', 'FRU.TO', 'BURE.ST', '688428.SS']) {
    assert.equal(count.reads.get(path.join(count.virtualSnapshots, ticker + '.json')), 1, ticker + ' snapshot read exactly once');
    assert.equal(count.preparations.get(ticker), 1, ticker + ' hand-table overlay exactly once');
    assert.equal(count.shadows.get(ticker), 1, ticker + ' shadow computed exactly once');
  }
});

check('missing calibration warns once and uses unclamped acceleration for both values', () => {
  const { harness, output } = exportFixture({ calibration: false });
  assert.equal(harness.warnings.filter(line => line.includes('[annual-pairs-shadow]')).length, 1);
  const s = snapshot({ annualRevEnds: dates });
  const row = output.top.profitable.find(r => r.ticker === 'NXP');
  assert.equal(row.annualPairsShadow.acceleration.today, A.revAcceleration(s));
  assert.equal(row.annualPairsShadow.acceleration.shadow, A.revAcceleration(s));
  const clamped = exportFixture().output.top.profitable.find(r => r.ticker === 'NXP');
  assert.equal(clamped.annualPairsShadow.acceleration.today, A.revAcceleration(s, [-0.1, 0.1]));
  assert.notEqual(row.annualPairsShadow.acceleration.today, clamped.annualPairsShadow.acceleration.today);
});

check('Rule of 40 prepared-snapshot path is additive for on-board and off-board candidates', () => {
  const s = snapshot({ annualRevEnds: gap }); s.annual.annualGPEnds = gap;
  const fixture = baueExport([{ row: boardZeile({ ticker: 'P115-ON', revGrowthYoYPct: 60 }), snap: s },
    { row: boardZeile({ ticker: 'P115-OFF', revGrowthYoYPct: 45 }), snap: snapshot({ annualRevEnds: dates }) }]);
  // Remove only the synthetic off-board row from the fixture's full board, not its snapshot.
  const boardFile = path.join(fixture.v1Dir, 'full/software-comm-services.json');
  assert.ok(boardFile.startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(!boardFile.startsWith(ROOT + path.sep));
  const board = JSON.parse(fs.readFileSync(boardFile, 'utf8'));
  board.profitable = board.profitable.filter(r => r.ticker !== 'P115-OFF');
  fs.writeFileSync(boardFile, JSON.stringify(board));
  const actual = writers(new Map(), { diskRoot: fixture.dir });
  const reference = writers(new Map(), { diskRoot: fixture.dir, baseline: true });
  const collect = h => h.R.sammleKandidaten({ v1Dir: fixture.v1Dir, snapshotsDir: fixture.snapshotsDir });
  const candidates = collect(actual), baseline = collect(reference);
  const rows = actual.R.baueZeilen(candidates.kandidaten).rows;
  assert.equal(rows.length, 2);
  assert.equal(without(rows), JSON.stringify(reference.R.baueZeilen(baseline.kandidaten).rows));
  assert.deepEqual(Array.from(rows, r => r.onBoard), [true, false]);
  for (const row of rows) {
    assert.ok(row.annualPairsShadow);
    assert.equal(actual.reads.get(path.join(fixture.snapshotsDir, row.ticker + '.json')), 1);
    assert.equal(actual.preparations.get(row.ticker), 1);
    assert.equal(actual.shadows.get(row.ticker), 1);
  }
  const on = rows.find(r => r.onBoard).annualPairsShadow;
  assert.equal(on.growth.code, 'missing-year');
  assert.equal(on.growth.today, on.growth.shadow, 'quarterly displayed growth stays unchanged');
  assert.equal(on.grossProfit.shadow, null); assert.equal(on.acceleration.shadow, null);
  assert.equal(P.annualPairRuleEnabled('growth'), false);
  assert.equal(P.annualPairRuleEnabled('acceleration'), false);
  // Temp fixture retained; cleanup is not needed for a correct check.
});

check('all nested keys are explicitly present in the existing sorted v1 key contract', () => {
  const frozen = read('tests/druckenmiller/fixtures/v1-row-keys.snapshot.json');
  assert.deepEqual(frozen, [...new Set(frozen)].sort());
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    for (const [key, v] of Object.entries(value)) { assert.ok(frozen.includes(key), key); walk(v); }
  }
  walk({ annualPairsShadow: P.annualPairsShadow(snapshot()) });
});

console.log(`annual-pairs-shadow-export.test.js: ${passed} ok, 0 fail`);
