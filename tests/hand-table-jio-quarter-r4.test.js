'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { table, applyFinancialCases, validateTable } = require('../lib/financial-known-cases.js');
let { g31Shadow } = require('../lib/g31-recency.js');
if (process.argv.includes('--prove-filed-red')) {
  const { Module, createRequire } = require('node:module');
  const file = require.resolve('../lib/g31-recency.js');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const anchor = '    if (reviewed && !(filed(i, q.sourcePeriodEnd, q.basis) && filed(pair.idx, q.sourcePriorPeriodEnd, q.basis))) continue;';
  assert.equal(lines.filter(line => line === anchor).length, 1, 'whole-line mutation anchor');
  const copy = new Module(file, module); copy.filename = file; copy.paths = module.paths; copy.require = createRequire(file);
  copy._compile(lines.map(line => line === anchor ? '' : line).join('\n'), file);
  g31Shadow = copy.exports.g31Shadow;
}
const fixtures = require('./fixtures/hand-table-zahlenjagd-20261030.json').snapshots;
const REV = '2026-10-30-jio-quarter-r4';
const pct = (20044700000 / 6124600000 - 1) * 100;
const paths = ['configs/financial-known-cases.json', 'lib/g31-recency.js', 'tests/fixtures/hand-table-zahlenjagd-20261030.json'];
const hashes = () => paths.map(p => crypto.createHash('sha256').update(fs.readFileSync(require('node:path').join(__dirname, '..', p))).digest('hex'));
const originalHashes = hashes();
const old = structuredClone(table);
old.cases = old.cases.filter(c => c.revision !== REV);
old.coverage = old.coverage.filter(c => c.ticker !== 'JIOFIN.BO');
validateTable(old);
const active = process.argv.includes('--prove-red') ? old : table;
const value = r => typeof r === 'number' ? r : r?.value ?? null;

test('both actual Jio packets reproduce the unexplained vendor pair and use the two filed consolidated quarters', () => {
  for (const ticker of ['JIOFIN.BO', 'JIOFIN.NS']) {
    const raw = structuredClone(fixtures[ticker]);
    const before = g31Shadow(applyFinancialCases(raw, { table: old }).snapshot).v1;
    assert.ok(Math.abs(before.pct - 330.9648448756124) < 1e-9, ticker);
    const out = applyFinancialCases(raw, { table: active }).snapshot;
    const result = g31Shadow(out).v1;
    assert.ok(Math.abs(result.pct - pct) < 1e-9, ticker + ': filed growth');
    assert.deepEqual([result.basis, result.periodEnd, result.priorPeriodEnd], ['quarter', '2026-06-30', '2025-06-30']);
    for (const [period, expected] of [['2026-06-30', 20044700000], ['2025-06-30', 6124600000]]) {
      const i = out.timeseries.revenueQEnds.indexOf(period);
      assert.ok(Math.abs(value(out.timeseries.revenueQ[i]) / out.meta.fxRateApplied - expected) < 0.001);
      assert.ok(out.timeseries.revenueQ[i].financialCorrection, 'ordinary hand-table marker');
    }
    for (const i of [0, 2, 3]) {
      assert.equal(value(out.timeseries.revenueQ[i]), null, 'unverified quarters retain the existing coverage guard');
      assert.deepEqual(out.timeseries.revenueQ[i].financialMissing.originalVendorRow, raw.timeseries.revenueQ[i]);
    }
    assert.deepEqual(applyFinancialCases(out, { table: active }).snapshot, out, 'idempotent');
    assert.deepEqual(raw, fixtures[ticker], 'input is unchanged');
  }
});

test('exactly two sourced corrections retain aliases, dates, native units and expected bad values', () => {
  const cases = active.cases.filter(c => c.revision === REV);
  assert.equal(cases.length, 2);
  assert.deepEqual(cases.map(c => [c.period, c.expectedBadValue, c.replacementValue]), [
    ['2026-06-30', 17947100000, 20044700000], ['2025-06-30', 4164400000, 6124600000],
  ]);
  for (const c of cases) {
    assert.deepEqual(c.listingAliases, ['JIOFIN.NS']);
    assert.equal(c.currency, 'INR'); assert.equal(c.periodType, '3M');
    assert.equal(c.verifiedAt, '2026-10-30');
    assert.ok(c.sources.some(s => s.url.endsWith('JIOFINANCIAL_16072026175802_JFSL.pdf') && s.page.includes('5') && s.quote.includes('Total revenue from operations')));
  }
});

test('an unexpected vendor revision is withheld, never silently overwritten with this correction', () => {
  for (const i of [1, 4]) {
    const raw = structuredClone(fixtures['JIOFIN.BO']);
    raw.timeseries.revenueQ[i].value *= 1.1;
    const out = applyFinancialCases(raw, { table: active }).snapshot;
    assert.equal(value(out.timeseries.revenueQ[i]), null);
    assert.ok(out.timeseries.revenueQ[i].financialMissing);
  }
});

test('a reviewed older pair requires source-backed corrections on both exact operands', () => {
  const prepared = applyFinancialCases(structuredClone(fixtures['JIOFIN.BO'])).snapshot;
  for (const index of [1, 4]) {
    for (const change of ['missing-marker', 'wrong-period', 'wrong-value', 'wrong-start']) {
      const s = structuredClone(prepared), row = s.timeseries.revenueQ[index];
      if (change === 'missing-marker') delete row.financialCorrection;
      else for (const src of row.financialCorrection.sources) {
        if (change === 'wrong-period') src.end = '2024-06-30';
        else if (change === 'wrong-start') src.start = src.end.slice(0, 4) + '-01-01';
        else src.value += 1;
      }
      assert.ok(Math.abs(g31Shadow(s).v1.pct - 71.97331257862558) < 1e-9, change + ' at ' + index);
    }
  }
});

test('test data probes never modify live files', () => assert.deepEqual(hashes(), originalHashes));

test('delivery expectations preserve historical bounds and pin the filed pair and measured rank from 3 November', () => {
  const expectations = require('../data-health/erwartungen.json');
  for (const [id, min, max, feld, grund] of [
    ['pr73-JIOFINBO-wachstum', 71, 73, 'revGrowthYoYPct', 'Jio Financial zeigt das Jahreswachstum aus dem Konzernabschluss von etwa +72,0 % statt +136,4 % (Datenstand 30.10.2026).'],
    ['pr73-JIOFINBO-rang', 60, 105, 'rank', 'Jio Financial steht auf dem Board Finanzen etwa auf Rang 81 statt 8 (Datenstand 30.10.2026).'],
  ]) assert.deepEqual(expectations.find(e => e.id === id), { id, pr: 73, name: 'Jio Financial Services Limited', board: 'full/financials', track: 'profitable', feld, op: 'between', min, max, gueltigAb: '2026-10-31', gueltigBis: '2026-11-02', grund });
  const own = expectations.filter(e => e.id.startsWith('pr75-JIOFINBO-r4-'));
  assert.equal(own.length, 5);
  assert.ok(own.every(e => e.gueltigAb === '2026-11-03' && e.ticker === 'JIOFIN.BO'));
  const growth = own.find(e => e.feld === 'revGrowthYoYPct');
  assert.ok(growth.min <= pct && growth.max >= pct && growth.max - growth.min < 1e-6);
  const rank = own.find(e => e.feld === 'rank');
  assert.deepEqual([rank.op, rank.min, rank.max], ['between', 17, 25]);
  assert.equal(own.find(e => e.feld === 'revGrowthBasis').wert, 'quarter');
  assert.equal(own.find(e => e.feld === 'revGrowthPeriodEnd').wert, '2026-06-30');
  assert.equal(own.find(e => e.feld === 'revGrowthPriorPeriodEnd').wert, '2025-06-30');
});
