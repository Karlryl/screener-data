'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const lamps = require('../../src/scoring/lamps.js');
const { annualProfitSeries, profitTierOf } = require('../../src/scoring/profit-tier.js');
const { qualityRoute } = require('../../src/scoring/quality-route.js');
const { route } = require('../../src/scoring/router.js');

// All fixtures and injected I/O stay in memory; writing tests are never mutation targets.
test('F-07: the burn denominator retains the original revenue year', () => {
  const s = { meta: { opIncSource: 'yahoo-adjusted' }, annual: {
    annualOCF: [-200, -100, -50], annualOpInc: [-20, -10, -5], annualRev: [null, 1000, 100],
  } };
  const original = structuredClone(s);
  assert.equal(lamps.burnPressFactor(s), 10 / 11);
  for (const revenue of [[1500, 1000, 100], [null, null, 100], [100, 0, 100], [], [0, 0]]) {
    const sample = structuredClone(s);
    sample.annual.annualRev = revenue;
    const scale = Math.max(Number.isFinite(revenue[1]) ? Math.abs(revenue[1]) : 0, 200, 100);
    assert.equal(lamps.burnPressFactor(sample), 1 / (1 + 100 / scale));
  }
  const healthy = structuredClone(s);
  healthy.annual.annualOCF[0] = 1;
  assert.equal(lamps.burnPressFactor(healthy), 1);
  const synthetic = structuredClone(s);
  synthetic.meta.opIncSource = 'computed-margin';
  assert.equal(lamps.burnPressFactor(synthetic), 1);
  const reconstructed = structuredClone(s);
  reconstructed.annual.annualFCF = reconstructed.annual.annualOCF;
  reconstructed.annual.annualOCF = [];
  reconstructed.annual.annualCapex = [0, 0, 0];
  assert.equal(lamps.burnPressFactor(reconstructed), 10 / 11);
  assert.deepEqual(s, original);
});

test('F-12: missing current net income gives an unknown tier and excludes Quality', () => {
  const make = (netIncome, operatingIncome = [null, -5]) => ({
    meta: { ticker: 'P160', sector: 'Basic Materials', industry: 'Specialty Chemicals', country: 'United States' },
    annual: { annualRev: [100, 90, 80, 70], annualGP: [20, 18, 16, 14],
      annualOpInc: operatingIncome, annualNetIncome: netIncome },
  });
  const missing = make([null, 5, 4, 3, 2]);
  const original = structuredClone(missing);
  assert.deepEqual(annualProfitSeries(missing), []);
  assert.equal(profitTierOf(missing), null);
  assert.deepEqual(qualityRoute(missing), { action: 'exclude', reason: 'qc-not-compounder' });
  for (const values of [[0, 5, 4, 3], [5, 4, 3, 2]]) {
    const present = make(values);
    assert.deepEqual(annualProfitSeries(present), values);
    assert.equal(profitTierOf(present), 'langfristig-profitabel');
    assert.equal(qualityRoute(present).action, 'route');
  }
  assert.equal(profitTierOf(make([-2, 5])), 'nicht-profitabel');
  assert.equal(profitTierOf(make([null, 5], [2, 1])), 'seit-kurzem-profitabel');
  assert.deepEqual(annualProfitSeries(make([5, null, 4])), [5, 4]);
  for (const values of [[], [null], [null, null], [NaN, 5], [Infinity, 5]]) {
    assert.equal(profitTierOf(make(values)), null);
  }
  for (const values of [[null, 5, 4, 3, 2], [0, 5, 4, 3]]) {
    const synthetic = make(values, [2, 2, 2, 2]);
    synthetic.meta.opIncSource = 'computed-margin';
    assert.equal(profitTierOf(synthetic), values[0] === null ? null : 'langfristig-profitabel');
  }
  assert.deepEqual(missing, original);
});

test('F-13: asset managers use the newest jointly finite income and revenue', () => {
  const make = (revenue, netIncome) => ({
    meta: { ticker: 'P160', sector: 'Financial Services', industry: 'Asset Management', country: 'United States' },
    annual: { annualGP: [0, 0], annualRev: revenue, annualNetIncome: netIncome },
  });
  assert.equal(route(make([100, 1000], [null, 800])).action, 'route');
  for (const [revenue, netIncome, expected] of [
    [[100, 1000], [97, 800], 'exclude'],
    [[100, 1000], [90, 970], 'route'],
    [[100, null], [null, 800], 'route'],
    [[null, 1000], [800, 100], 'route'],
    [[0, 1000], [0, 970], 'route'],
    [[-100, 1000], [10, 800], 'exclude'],
  ]) assert.equal(route(make(revenue, netIncome)).action, expected);
  const positiveGrossProfit = make([100, 1000], [97, 800]);
  positiveGrossProfit.annual.annualGP = [10, 0];
  assert.equal(route(positiveGrossProfit).action, 'route');
  const negativeQuarter = make([100, 1000], [10, 800]);
  negativeQuarter.timeseries = { revenueQ: [-1, 100] };
  assert.equal(route(negativeQuarter).action, 'exclude');
});

function memoryRunner(readFileSync, writes = []) {
  const filename = require.resolve('../../src/scoring/run-screener.js');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = mod.require.bind(mod);
  mod.require = id => {
    if (id === 'fs') return { readFileSync, readdirSync: () => ['P160.json'],
      mkdirSync() {}, rmSync() {} };
    if (id === '../../lib/atomic-write.js') return { writeJsonAtomic: (file, value) => writes.push({ file, value }) };
    if (id === '../../lib/watchlist-fs.js') return { loadWatchlist: () => ({ stocks: [], error: null }) };
    if (id === '../../lib/yahoo-q4-known-cases.js') return { prepareSnapshot: s => s, FAILURE_CODE: 'HAND_TABLE_FAILED' };
    if (id === './score.js') return { ...originalRequire(id), scoreUniverse: () => [],
      produceRankings: () => ({ branches: {}, full: {}, overview: [], survival: [], excluded: {} }) };
    return originalRequire(id);
  };
  mod._compile(fs.readFileSync(filename, 'utf8'), filename);
  return mod.exports;
}

test('F-14: only absent stores are optional; errors precede attachments and main scoring', () => {
  const valid = JSON.stringify({ P160: { annualRev: [100], annualOpInc: [20] } });
  const denied = Object.assign(new Error('Synthetic permission denied'), { code: 'EACCES' });
  const absent = Object.assign(new Error('Synthetic missing file'), { code: 'ENOENT' });
  const bodies = { valid, empty: '{}', broken: '{"P160":', null: 'null', array: '[]',
    scalar: '42', string: '"invalid"', denied, absent };
  const runner = memoryRunner(file => {
    const body = bodies[file];
    if (body instanceof Error) throw body;
    return body;
  });
  for (const bad of ['broken', 'denied', 'null', 'array', 'scalar', 'string']) {
    for (const files of [[bad], ['valid', bad], [bad, 'valid']]) {
      const u = [{ meta: { ticker: 'P160' }, secAnnual: { marker: 'previous' } }];
      const original = structuredClone(u);
      assert.throws(() => runner.mergeSecIntoUniverse(u, files), error => {
        assert.ok(error.message.includes(bad));
        if (bad === 'denied') assert.equal(error.cause, denied);
        else assert.ok(error.cause instanceof (bad === 'broken' ? SyntaxError : TypeError));
        return true;
      });
      assert.deepEqual(u, original);
    }
  }
  for (const files of [[], ['absent'], ['empty']]) {
    const u = [{ meta: { ticker: 'P160' } }];
    assert.equal(runner.mergeSecIntoUniverse(u, files), u);
    assert.equal(Object.hasOwn(u[0], 'secAnnual'), false);
  }
  for (const files of [['valid'], ['valid', 'absent'], ['empty', 'valid']]) {
    const u = [{ meta: { ticker: 'P160' } }];
    assert.equal(runner.mergeSecIntoUniverse(u, files), u);
    assert.deepEqual(u[0].secAnnual.annualRev, [100]);
    assert.deepEqual(u[0].secAnnual.annualOpInc, [20]);
  }

  for (const mainFailure of [true, false]) {
    let mainStoreReads = 0;
    const writes = [];
    const execution = memoryRunner(file => {
      const name = path.basename(file);
      if (name === 'P160.json') return JSON.stringify({ meta: { ticker: 'P160' } });
      if (name === 'sec-secannual.json') {
        mainStoreReads++;
        return mainFailure || mainStoreReads > 1 ? bodies.broken : valid;
      }
      throw absent;
    }, writes);
    if (mainFailure) {
      assert.throws(() => execution.run(100), /SEC annual store.*sec-secannual\.json/);
      assert.equal(writes.some(w => w.file.includes(`${path.sep}outputs${path.sep}`)), false);
      assert.ok(writes.some(w => path.basename(w.file) === '_last_good_disk.json'));
    } else {
      assert.equal(execution.run(100).universe, 1);
      assert.ok(writes.some(w => w.file.endsWith(path.join('hypergrowth', 'index.json'))));
      assert.ok(writes.some(w => w.file.endsWith(path.join('quality', 'index.json'))));
      const failure = writes.find(w => w.file.endsWith(path.join('smallcap', '_failed')));
      assert.match(failure.value.reason, /SEC annual store.*sec-secannual\.json/);
      assert.equal(writes.some(w => w.file.endsWith(path.join('smallcap', 'index.json'))), false);
    }
  }
});
