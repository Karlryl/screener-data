'use strict';

// Review regressions and break-once probes run entirely in memory. Never mutate a
// live artifact or use a writing test as the mutation target; hash every source.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const table = require('../configs/sourced-annual-years.json');
const fixtures = require('./fixtures/sourced-annual-years.json');
const axes = require('../src/scoring/axes.js');
const annual = require('../lib/annual-pairs.js');
const overview = require('../src/scoring/overview.js');
const sourced = require('../lib/sourced-annual-years.js');
const { withG31Variant } = require('../lib/g31-recency.js');
const { fristen } = require('../lib/handtabellen-fristen.js');
const fixture = (ticker = '9992.HK') => structuredClone(fixtures[ticker]);
const close = (a, b) => { assert.equal(typeof a, 'number'); assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`); };
let count = 0, breaks = 0;
const test = (name, fn) => { fn(); count++; console.log('PASS ' + name); };
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function mutate(relative, anchor, replacement, check, script = false) {
  const file = path.resolve(root, relative), before = hash(file);
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  assert.ok(text.split('\n').includes(anchor), 'Mutation anchor must be a whole line');
  assert.equal(text.split(anchor).length, 2, 'Mutation anchor must be unique');
  try {
    const broken = text.replace(anchor, replacement);
    let exports = broken;
    if (!script) {
      const mod = new Module(file, module);
      mod.filename = file; mod.paths = Module._nodeModulePaths(path.dirname(file));
      mod._compile(broken, file); exports = mod.exports;
    }
    assert.throws(() => check(exports), { name: 'AssertionError' }, 'Regression must fail without fix');
    breaks++;
  } finally { assert.equal(hash(file), before, 'Live source hash changed'); }
}
const oldDay = process.env.RUN_DATE_UTC;
process.env.RUN_DATE_UTC = '2026-10-31';
try {
  test('M2 Energean: restated prior leaves acceleration empty; GP, inputs and other firms remain usable', () => {
    const s = fixture('ENOG.L'), before = JSON.stringify(s);
    const check = a => assert.equal(a.revAcceleration(s), null);
    check(axes);
    assert.equal(sourced.resolveSourcedAnnualYear(s).status, 'available');
    assert.ok(Number.isFinite(axes.gpGrowth(s)));
    assert.equal(JSON.stringify(s), before);
    for (const r of table.records) {
      assert.equal(r.priorRestated, r.ticker === 'ENOG.L');
      if (!r.priorRestated) assert.ok(Number.isFinite(axes.revAcceleration(fixture(r.ticker))), r.ticker);
    }
    const missing = structuredClone(table); delete missing.records[0].priorRestated;
    assert.throws(() => sourced.validateTable(missing), /Invalid sourced annual record/);
    mutate('src/scoring/axes.js', '    if (r.priorRestated) {', '    if (false) {', check);
  });
  test('M2 the restatement hint follows the actual annual branch, never a fresh quarterly pair', () => {
    const s = fixture('ENOG.L');
    const check = a => {
      const verdict = a.annualPairsShadow(s).acceleration;
      assert.equal(verdict.code, 'restated-prior');
      assert.equal(verdict.today, null); assert.equal(verdict.shadow, null);
      assert.match(verdict.reason, /Vorjahr 2024.*restated.*älteres Umsatzjahr/);
    };
    check(annual);
    mutate('lib/annual-pairs.js', "      if (accelerationBasis === 'sourcedYearRestatedPrior') {", '      if (false) {', check);
    s.timeseries = { revenueQ: [150, 120, 80, 80], revenueQEnds: ['2026-06-30', '2026-03-31', '2025-06-30', '2025-03-31'] };
    close(axes.revAcceleration(s), 150 / 80 - 120 / 80);
    assert.doesNotMatch(annual.annualPairsShadow(s).acceleration.reason, /restated/);
    s.timeseries.revenueQEnds = ['2024-06-30', '2024-03-31', '2023-06-30', '2023-03-31'];
    check(annual);
  });
  test('M3 real Pop Mart display and period use the sourced GP pair, excluding the axis margin tilt', () => {
    const s = fixture(), expected = 26764916 / 8707765 - 1;
    const check = o => {
      const value = o.overviewMetric(s);
      close(value.value, expected);
      assert.deepEqual([value.period.periodEnd, value.period.priorPeriodEnd], ['2025-12-31', '2024-12-31']);
      assert.match(value.period.reason, /Abschluss 2025 gegen 2024/);
      assert.doesNotMatch(value.period.reason, /veraltet/);
      assert.notEqual(value.valuePresent, false);
    };
    check(overview);
    close(overview.grossProfitGrowthYoY(s), expected);
    close(overview.overviewShadow(s, 'gp').value, expected);
    assert.equal(Math.round(expected * 100), 207);
    mutate('src/scoring/overview.js', "    const sourced = shadow || g31Variant() ? require('../../lib/sourced-annual-years.js').resolveSourcedAnnualYear(s) : null;", '    const sourced = null;', check);
    withG31Variant('legacy', () => close(overview.grossProfitGrowthYoY(s), 8707765 / 3864071 - 1));
    const unconfigured = fixture(); unconfigured.meta.ticker = 'UNCONFIGURED';
    assert.equal(overview.overviewMetric(unconfigured).value, null);
    const caughtUp = fixture(), r = table.records[0], factor = s.meta.fxRateApplied;
    for (const [field, amount] of [['annualRev', r.revenue], ['annualGP', r.grossProfit]]) {
      caughtUp.annual[field].unshift({ value: amount * factor }); caughtUp.annual[field + 'Ends'].unshift(r.end);
    }
    close(overview.overviewMetric(caughtUp).value, expected);
  });
  test('M4 fixed clock: all six annual rows warn from 30 days before expiry, on deadline and afterwards', () => {
    const report = (fn, datum) => fn({ tabelle: {}, universum: [], datum });
    const annualLines = r => r.zeilen.filter(l => l.includes('ergänzte Jahresstand'));
    const check = fn => {
      const lines = annualLines(report(fn, '2026-11-04'));
      assert.equal(lines.length, 6);
      for (const r of table.records) assert.ok(lines.some(l => l.includes(r.ticker) && l.includes('04.12.2026 (in 30 Tagen)') && l.includes('05.12.2026')));
    };
    check(fristen);
    assert.equal(annualLines(report(fristen, '2026-11-03')).length, 0);
    assert.ok(annualLines(report(fristen, '2026-12-04')).every(l => l.includes('(heute)')));
    assert.ok(annualLines(report(fristen, '2026-12-05')).every(l => l.includes('seit 1 Tag überschritten')));
    mutate('lib/handtabellen-fristen.js', '  for (const r of sourcedAnnualTable.records) {', '  for (const r of []) {', m => check(m.fristen));
    for (const [day, status] of [['2026-12-04', 'available'], ['2026-12-05', 'review-expired']]) {
      process.env.RUN_DATE_UTC = day; assert.equal(sourced.resolveSourcedAnnualYear(fixture()).status, status);
    }
    process.env.RUN_DATE_UTC = '2026-10-31';
  });
  test('L5 all six records reject the publication day and allow the following day', () => {
    const check = resolver => {
      for (const r of table.records) {
        const published = r.readings.flatMap(p => p.sources.map(s => s.published)).sort().at(-1);
        process.env.RUN_DATE_UTC = published;
        assert.equal(resolver.resolveSourcedAnnualYear(fixture(r.ticker)).status, 'not-public', r.ticker);
        process.env.RUN_DATE_UTC = new Date(Date.parse(published) + 864e5).toISOString().slice(0, 10);
        assert.equal(resolver.resolveSourcedAnnualYear(fixture(r.ticker)).status, 'available', r.ticker);
      }
    };
    check(sourced);
    const line = "  if (!day(at) || at <= published) return reject('not-public', 'Der neuere Abschluss ist frühestens am Handelstag nach seiner Veröffentlichung verwendbar.');";
    mutate('lib/sourced-annual-years.js', line, line.replace('at <= published', 'at < published'), check);
    process.env.RUN_DATE_UTC = '2026-10-31';
  });
  test('L6 GP prior length uses its own ends, including missing and invalid GP ends', () => {
    const s = fixture(); s.annual.annualGPEnds[1] = '2023-11-30';
    const check = a => {
      const result = a.annualPairsShadow(s);
      assert.equal(result.grossProfit.priorLengthDays, 397);
      assert.equal(result.acceleration.priorLengthDays, 366);
    };
    check(annual);
    mutate('lib/annual-pairs.js', "        const priorEnds = axis === 'grossProfit' ? gpEnds : ends;", '        const priorEnds = ends;', check);
    for (const end of [null, 'bad-date']) {
      s.annual.annualGPEnds[1] = end;
      assert.equal(annual.annualPairsShadow(s).grossProfit.priorLengthDays, null);
    }
  });
  test('M1 compare CLI defaults to final PR88, accepts explicit baseline and rejects mismatched arms', () => {
    const file = path.join(root, 'scripts/sourced-annual-years-replay.js'), text = fs.readFileSync(file, 'utf8');
    const final88 = '4a5e6f55d000d7ea7d6855014c8e664eebb6cf87', custom = '1'.repeat(40);
    const run = (code, baseline = final88, arg, other = baseline) => {
      let output;
      const result = { baselineHead: baseline, day: '2026-10-31', inputDigest: 'same', calibrationDigest: 'same',
        universe: ['A'], axes: { A: { gpGrowth: 1, capitalEfficiency: 2 } }, boards: { test: [{ ticker: 'A', score: 1, rank: 1 }] } };
      const fakeFs = { mkdirSync() {}, readFileSync: f => JSON.stringify({ ...result, baselineHead: f.endsWith('after.json') ? other : baseline }),
        writeFileSync: (f, v) => { output = JSON.parse(v); } };
      vm.runInNewContext(code, { __dirname: path.dirname(file), process: { argv: ['node', file, 'compare', path.resolve(root, '../test-input'), path.resolve(root, '../test-output'), ...(arg ? [arg] : [])] },
        require: id => id === 'node:fs' ? fakeFs : require(id), console: { log() {} } }, { filename: file });
      return output;
    };
    const check = code => assert.equal(run(code).baselineHead, final88);
    check(text);
    assert.equal(run(text, custom, custom).baselineHead, custom);
    assert.throws(() => run(text, final88, undefined, custom), /After baseline differs/);
    assert.throws(() => run(text, final88, '--invalid'), /Baseline must be/);
    const anchor = `const [arm, dataArg, outArg, baselineHead = '${final88}'] = process.argv.slice(2);`;
    mutate('scripts/sourced-annual-years-replay.js', anchor, anchor.replace(final88, '42ba5140c676e8cc5131bd350673e3e7f5c16258'), check, true);
  });
  console.log(`${count} checks passed; ${breaks} in-memory break-once probes detected; live hashes unchanged`);
} finally {
  if (oldDay === undefined) delete process.env.RUN_DATE_UTC; else process.env.RUN_DATE_UTC = oldDay;
}
