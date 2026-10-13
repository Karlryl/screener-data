'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { table, validateTable } = require('../lib/financial-known-cases.js');
const S = require('../src/scoring/profit-streak.js');
const file = path.resolve(__dirname, '../src/scoring/profit-streak.js');
const source = fs.readFileSync(file, 'utf8');
const sha = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const beforeHash = sha();
const opCases = table.cases.filter(c => c.ticker === 'HL' && c.field === 'annualOpInc');
const clone = x => JSON.parse(JSON.stringify(x));
const annual = () => ({
  _fys: [2025, 2024, 2023, 2022, 2021, 2020, 2019],
  annualFiled: ['2026-02-17', '2025-02-13', '2024-02-15', '2023-02-17', '2022-02-23', '2021-02-18', '2020-02-10'].map(value => ({ value })),
  annualOpInc: [514795000, 106276000, -44674000, 12438000, 83420000, 51581000, -57109000].map(value => ({ value })),
  annualNetIncome: [321712000, 35802000, -84217000, -37348000, 35095000, -16790000, -99557000].map(value => ({ value })),
});
const oldStreak = { jahre: 2, basis: 'opInc', tiefe: 7, mindestens: false, letzterVerlust: 2023 };
const correctedStreak = { jahre: 6, basis: 'opInc', tiefe: 7, mindestens: false, letzterVerlust: 2019 };
const numbers = ({ financialCorrections, ...rest }) => rest;

function load(cases, text = source) {
  const config = validateTable({ schemaVersion: 1, cases, coverage: [], quarantines: [] });
  const localRequire = createRequire(file);
  const mod = { exports: {} };
  vm.runInNewContext(text, { module: mod, exports: mod.exports, __dirname: path.dirname(file), process,
    require: id => id === '../../lib/financial-known-cases.js' ? { table: config } : localRequire(id) }, { filename: file });
  return { profitStreak: (...args) => clone(mod.exports.profitStreak(...args)) };
}

test('documented Hecla values extend only the display streak and carry their sources', () => {
  const input = annual(), before = JSON.stringify(input);
  for (const rows of Object.values(input)) { for (const row of rows) if (row && typeof row === 'object') Object.freeze(row); Object.freeze(rows); }
  Object.freeze(input);
  const result = S.profitStreak('HL', input);
  assert.deepEqual(numbers(result), correctedStreak);
  assert.deepEqual(result.financialCorrections.map(c => [c.fiscalYear, c.value]),
    [[2025, 396409000], [2024, 123762000], [2023, 12009000]]);
  for (const correction of result.financialCorrections) {
    const c = opCases.find(c => c.caseId === correction.caseId);
    assert.ok(c);
    assert.equal(correction.field, 'annualOpInc');
    assert.equal(correction.period, c.period);
    assert.deepEqual(correction.sources, c.sources);
    assert.equal(correction.sources[0].filed, '2026-08-28');
    assert.match(correction.sources[0].quote, /Income from operations 396,409 123,762 12,009/);
  }
  assert.equal(JSON.stringify(input), before, 'SEC input, including older years and net income, stays byte-identical');
  assert.deepEqual(S.profitStreak('HL', input), result, 'Repeated calls are idempotent');
});

test('uncorrected ticker stays byte-identical; a documented listing alias uses its own SEC history', () => {
  assert.equal(JSON.stringify(S.profitStreak('UNLISTED', annual())), JSON.stringify(oldStreak));
  assert.deepEqual(S.profitStreak('HL.SW', annual()), S.profitStreak('HL', annual()));
  assert.equal(S.profitStreak('HL.SW', null), null, 'A hand-table alias does not invent SEC history');
});

test('other series and years cannot repair the selected series or add a missing fiscal year', () => {
  const otherSeries = table.cases.filter(c => c.ticker === 'HL' && c.field !== 'annualOpInc');
  assert.deepEqual(load(otherSeries).profitStreak('HL', annual()), oldStreak);
  const input = annual(); input._fys = input._fys.map(y => y - 10);
  assert.deepEqual(S.profitStreak('HL', input), { ...oldStreak, letzterVerlust: 2013 });
  delete input._fys;
  assert.deepEqual(S.profitStreak('HL', input), { ...oldStreak, letzterVerlust: null });
  const reordered = { _fys: [2023, 2022, 2019], annualOpInc: [{ value: -44674000 }, { value: 12438000 }, { value: -57109000 }] };
  const result = S.profitStreak('HL', reordered);
  assert.equal(result.jahre, 2, 'Match the fiscal year, never the Yahoo case index');
  assert.deepEqual(result.financialCorrections.map(c => c.fiscalYear), [2023]);
});

test('operating-income preference and net-income fallback remain unchanged', () => {
  const input = annual(); input.annualOpInc[0].value = null;
  assert.deepEqual(S.profitStreak('HL', input), { ...oldStreak, basis: 'netIncome' });
  const netCases = clone(opCases);
  for (const c of netCases) { c.field = 'annualNetIncome'; c.caseId += '-net-test'; }
  const net = load(netCases);
  assert.deepEqual(numbers(net.profitStreak('HL', input)),
    { jahre: 3, basis: 'netIncome', tiefe: 7, mindestens: false, letzterVerlust: 2022 });
  assert.deepEqual(net.profitStreak('HL', annual()), oldStreak, 'Net corrections cannot replace available operating income');
});

test('a documented missing value is usable; holds, foreign currency and ambiguous years are not replacements', () => {
  const input = annual(); input.annualOpInc[2].value = null;
  assert.deepEqual(numbers(S.profitStreak('HL', input)), correctedStreak);
  const holds = clone(opCases); for (const c of holds) c.replacementValue = null;
  assert.deepEqual(load(holds).profitStreak('HL', annual()), oldStreak);
  const foreign = clone(opCases);
  for (const c of foreign) { c.currency = 'EUR'; for (const s of c.sources) s.currency = 'EUR'; }
  assert.deepEqual(load(foreign).profitStreak('HL', annual()), oldStreak);
  const anotherEnd = clone(opCases[2]);
  anotherEnd.caseId += '-other-end'; anotherEnd.period = '2023-11-30';
  for (const s of anotherEnd.sources) { s.start = '2022-12-01'; s.end = anotherEnd.period; }
  const ambiguous = load([...opCases, anotherEnd]).profitStreak('HL', annual());
  assert.deepEqual(numbers(ambiguous), oldStreak);
  assert.deepEqual(ambiguous.financialCorrections.map(c => c.fiscalYear), [2025, 2024]);
});

test('cached SEC lookup uses the same overlay without changing its cached annual object', () => {
  const input = annual(), before = JSON.stringify(input);
  S._setKarte(new Map([['HL', input], ['UNLISTED', input]]));
  try {
    assert.deepEqual(numbers(S.profitStreakOf('HL')), correctedStreak);
    assert.deepEqual(S.profitStreakOf('UNLISTED'), oldStreak);
    assert.equal(S.profitStreakOf('NO-SEC'), null);
    assert.equal(JSON.stringify(input), before);
  } finally { S._setKarte(null); }
});

test('the latest filed value wins per fiscal year; undated hand-table sources never supersede SEC', () => {
  const input = annual(); input.annualFiled[2].value = '2026-10-01';
  input.annualOpInc[2].value = -1;
  const result = S.profitStreak('HL', input);
  assert.deepEqual(numbers(result), oldStreak);
  assert.deepEqual(result.financialCorrections.map(c => c.fiscalYear), [2025, 2024]);
  input.annualFiled[2].value = '2026-08-28';
  assert.deepEqual(numbers(S.profitStreak('HL', input)), correctedStreak, 'Documented correction wins a same-filing tie');
  input.annualFiled[2] = '2026-10-01';
  assert.deepEqual(numbers(S.profitStreak('HL', input)), oldStreak, 'Scalar and wrapped filing dates agree');
  input.annualFiled[2] = { value: null };
  assert.deepEqual(numbers(S.profitStreak('HL', input)), correctedStreak, 'A wrapped missing SEC filing date is not a newer filing');
  input.annualFiled[2] = null;
  assert.deepEqual(numbers(S.profitStreak('HL', input)), correctedStreak);
  const undated = clone(opCases); for (const c of undated) delete c.sources[0].filed;
  assert.deepEqual(load(undated).profitStreak('HL', annual()), oldStreak);
});

test('break-once guards detect absent overlay and wrong ticker, series, year or currency; live SHA stays unchanged', () => {
  const one = [opCases[2]];
  const guard = mod => {
    assert.deepEqual(numbers(mod.profitStreak('HL', annual())), correctedStreak);
    assert.deepEqual(mod.profitStreak('UNLISTED', annual()), oldStreak);
    const oldYears = annual(); oldYears._fys = oldYears._fys.map(y => y - 10);
    assert.deepEqual(mod.profitStreak('HL', oldYears), { ...oldStreak, letzterVerlust: 2013 });
  };
  guard(load(one));
  assert.throws(() => guard(load([])), assert.AssertionError);
  const mutate = (line, replacement) => {
    assert.equal(source.split(line).length, 2, 'Mutation anchor is one complete live-source line');
    return source.replace(line, replacement);
  };
  const tickerLine = "    (c.ticker === ticker || c.listingAliases?.includes(ticker)) && c.field === field &&";
  assert.throws(() => guard(load(one, mutate(tickerLine, '    c.field === field &&'))), assert.AssertionError);
  const wrongSeries = clone(one); wrongSeries[0].field = 'annualNetIncome';
  const seriesGuard = mod => assert.deepEqual(mod.profitStreak('HL', annual()), oldStreak);
  seriesGuard(load(wrongSeries));
  assert.throws(() => seriesGuard(load(wrongSeries, mutate(tickerLine,
    '    (c.ticker === ticker || c.listingAliases?.includes(ticker)) &&'))), assert.AssertionError);
  const yearLine = '    const matches = cases.filter(c => Number.isInteger(fys[i]) && c.period.slice(0, 4) === String(fys[i]));';
  assert.throws(() => guard(load(one, mutate(yearLine, '    const matches = cases;'))), assert.AssertionError);
  const currencyLine = "    c.periodType === '12M' && c.currency === 'USD' && c.unit === 'currency' && Number.isFinite(c.replacementValue));";
  const foreign = clone(one); foreign[0].currency = 'EUR'; foreign[0].sources[0].currency = 'EUR';
  seriesGuard(load(foreign));
  assert.throws(() => seriesGuard(load(foreign, mutate(currencyLine,
    "    c.periodType === '12M' && c.unit === 'currency' && Number.isFinite(c.replacementValue));"))), assert.AssertionError);
  const newer = annual(); newer.annualFiled[2].value = '2026-10-01'; newer.annualOpInc[2].value = -1;
  const filingGuard = mod => assert.deepEqual(mod.profitStreak('HL', newer), oldStreak);
  filingGuard(load(one));
  const filingLine = '    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(filed) || (secFiled != null && secFiled > filed)) return value;';
  assert.throws(() => filingGuard(load(one, mutate(filingLine, ''))), assert.AssertionError);
  guard(load(one));
  assert.equal(sha(), beforeHash, 'All mutations are in memory, never in the live file');
});
