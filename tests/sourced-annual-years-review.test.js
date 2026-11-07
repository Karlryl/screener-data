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
const { withG31Variant, quarterCandidate } = require('../lib/g31-recency.js');
const { norm } = require('../src/scoring/snapshot.js');
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
  test('N1 Energean and all six firms select the newest valid GP period, including ties and missing quarters', () => {
    const check = o => {
      const real = fixture('ENOG.L'), original = JSON.stringify(real);
      const result = o.overviewMetric(real);
      close(result.value, 76825000 / 120941000 - 1);
      assert.deepEqual(result.period, { basis: 'quarter', periodEnd: '2026-03-31', priorPeriodEnd: '2025-03-31', reason: null });
      close(o.overviewShadow(real, 'gp').value, result.value);
      close(o.grossProfitGrowthYoY(real), result.value);
      assert.equal(JSON.stringify(real), original);
      for (const r of table.records) {
        const packet = fixture(r.ticker), q = quarterCandidate(packet, 'grossProfitQ');
        const expected = r.ticker === 'ENOG.L' ? 76825000 / 120941000 - 1 : r.grossProfit / r.priorGrossProfit - 1;
        close(o.overviewMetric(packet).value, expected);
        assert.equal(q.pct !== null, r.ticker === 'ENOG.L', r.ticker);
        for (const [end, priorEnd, wins] of [['2026-03-31', '2025-03-31', true],
          ['2025-12-31', '2024-12-31', true], ['2025-09-30', '2024-09-30', false]]) {
          const s = fixture(r.ticker);
          s.timeseries = { grossProfitQ: [127, 100], grossProfitQEnds: [end, priorEnd] };
          if (s.meta.statementPeriods) delete s.meta.statementPeriods.grossProfitQ;
          // All publications are available and even the older quarter is still valid.
          // Thus the annual win is an ordering decision, not a stale-quarter rejection.
          const savedDay = process.env.RUN_DATE_UTC;
          let value;
          try {
            process.env.RUN_DATE_UTC = '2026-04-22';
            assert.notEqual(quarterCandidate(s, 'grossProfitQ').pct, null);
            value = o.overviewMetric(s);
          } finally { process.env.RUN_DATE_UTC = savedDay; }
          close(value.value, wins ? 0.27 : r.grossProfit / r.priorGrossProfit - 1);
          assert.equal(value.period.periodEnd, wins ? end : r.end, r.ticker);
          assert.equal(value.period.basis, wins ? 'quarter' : 'year');
          if (wins) assert.equal(value.period.reason, null);
          else assert.match(value.period.reason, /Jahresreihe des Anbieters/);
        }
        const missing = fixture(r.ticker); missing.timeseries = {};
        close(o.overviewMetric(missing).value, r.grossProfit / r.priorGrossProfit - 1);
      }
    };
    check(overview);
    const anchor = "    const quarter = annual ? quarterCandidate(s, 'grossProfitQ') : null;";
    mutate('src/scoring/overview.js', anchor, '    if (sourced?.status === \'available\') return annual;\n' + anchor, check);
    const tie = '        && (annual.value === null || !annual.period?.sourcePeriodEnd || quarter.sourcePeriodEnd >= annual.period.sourcePeriodEnd)) {';
    mutate('src/scoring/overview.js', tie, tie.replace(' >= ', ' > '), check);
    check(overview);
  });
  test('N2 restated Energean holds only the margin tilt, independent of every older vendor margin', () => {
    const r = table.records.find(r => r.ticker === 'ENOG.L');
    const check = a => {
      const s = fixture(r.ticker), before = JSON.stringify(s);
      close(a.gpGrowth(s), r.grossProfit / r.priorGrossProfit - 1);
      assert.equal(a.revAcceleration(s), null);
      assert.equal(JSON.stringify(s), before);
      for (const margin of [0.05, 0.95]) {
        for (let i = 1; i < s.annual.annualGP.length; i++) s.annual.annualGP[i] = { value: norm(s, 'annualRev')[i] * margin };
        close(a.gpGrowth(s), r.grossProfit / r.priorGrossProfit - 1);
      }
    };
    check(axes);
    mutate('src/scoring/axes.js', '    const gmOld = r.priorRestated ? null : lastPresent(gmWindow',
      '    const gmOld = lastPresent(gmWindow', check);
    check(axes);
  });
  test('N3 non-restated firms retain the normal three-year margin span and ignore the retired oldest slot', () => {
    const check = a => {
      for (const r of table.records.filter(r => !r.priorRestated)) {
        const s = fixture(r.ticker), before = JSON.stringify(s);
        assert.equal(s.annual.annualGPEnds[2], '2022-12-31');
        const expected = r.grossProfit / r.priorGrossProfit - 1 + r.grossProfit / r.revenue
          - norm(s, 'annualGP')[2] / norm(s, 'annualRev')[2];
        close(a.gpGrowth(s), expected);
        assert.equal(JSON.stringify(s), before);
        s.annual.annualGP[3] = { value: norm(s, 'annualRev')[3] * 0.01 };
        close(a.gpGrowth(s), expected);
        // The ordinary vendor path with its four rolling observations is the comparator.
        const caughtUp = fixture(r.ticker), factor = s.meta.fxRateApplied || 1;
        for (const [field, amount] of [['annualRev', r.revenue], ['annualGP', r.grossProfit]]) {
          caughtUp.annual[field] = [{ value: amount * factor }, ...caughtUp.annual[field].slice(0, 3)];
          caughtUp.annual[field + 'Ends'] = [r.end, ...caughtUp.annual[field + 'Ends'].slice(0, 3)];
        }
        close(a.gpGrowth(caughtUp), expected);
      }
    };
    check(axes);
    mutate('src/scoring/axes.js', "    const gmWindow = ratioSeries(norm(s, 'annualGP'), norm(s, 'annualRev')).slice(0, -1);",
      "    const gmWindow = ratioSeries(norm(s, 'annualGP'), norm(s, 'annualRev'));", check);
    check(axes);
  });
  test('M4/N4 fixed clock: all six annual rows warn only in the last week, on deadline and afterwards', () => {
    const report = (fn, datum) => fn({ tabelle: {}, universum: [], datum });
    const annualLines = r => r.zeilen.filter(l => l.includes('ergänzte Jahresstand'));
    const check = fn => {
      const lines = annualLines(report(fn, '2026-11-27'));
      assert.equal(lines.length, 6);
      for (const r of table.records) assert.ok(lines.some(l => l.includes(r.ticker) && l.includes('04.12.2026 (in 7 Tagen)') && l.includes('05.12.2026')
        && l.includes('passender Währung, Einheit und Vergleichsbasis')));
      for (const day of ['2026-11-04', '2026-11-26']) assert.equal(annualLines(report(fn, day)).length, 0);
    };
    check(fristen);
    assert.equal(annualLines(report(fristen, '2026-11-03')).length, 0);
    assert.ok(annualLines(report(fristen, '2026-12-04')).every(l => l.includes('(heute)')));
    assert.ok(annualLines(report(fristen, '2026-12-05')).every(l => l.includes('seit 1 Tag überschritten')));
    mutate('lib/handtabellen-fristen.js', '  for (const r of sourcedAnnualTable.records) {', '  for (const r of []) {', m => check(m.fristen));
    mutate('lib/handtabellen-fristen.js', '  const annualWarningDays = Math.min(tage, 7);', '  const annualWarningDays = tage;', m => check(m.fristen));
    check(fristen);
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
