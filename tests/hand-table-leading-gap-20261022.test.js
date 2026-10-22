'use strict';
// Leading gap (22.10.2026): since the pull of 14.10.2026 the vendor returns the PLUS quarter ending 2026-06-30 as an
// empty row (the pull trims it), so the series ends at 2026-03-31. The hand table holds source-checked cases for exactly
// that quarter (10-Q of 2026-08-04: revenue 649,113, gross profit 151,329, operating income 38,832 TUSD), but a case
// only acted on an existing cell, so the board fell back to the fiscal year to 31.03.2026 (22.1 % instead of 1.0 %).
// In a covered series a source-backed case newer than the vendor's newest dated end now fills that quarter (G2).
// Real frozen packet of the daily run 39741351636 (tests/fixtures/hand-table-leading-gap-plus.json). Every probe works
// on copies; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, table } = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const stored = require('./fixtures/hand-table-leading-gap-plus.json').snapshots.PLUS;
const root = path.resolve(__dirname, '..');
const value = row => typeof row === 'number' ? row : row?.value ?? null;
const live = ['configs/financial-known-cases.json', 'lib/financial-known-cases.js', 'tests/fixtures/hand-table-leading-gap-plus.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const apply = s => applyFinancialCases(structuredClone(s)).snapshot;
// The raw vendor packet as the pull sees it: every hand-table marker unwrapped to its original vendor row.
const raw = (() => {
  const s = structuredClone(stored);
  for (const f of ['revenueQ', 'grossProfitQ', 'opIncQ']) s.timeseries[f] = s.timeseries[f].map(r =>
    r?.financialCorrection ? r.financialCorrection.originalVendorRow : r?.financialMissing ? r.financialMissing.originalVendorRow : r);
  return s;
})();

const june = { revenueQ: 649113000, grossProfitQ: 151329000, opIncQ: 38832000 };

test('fixture: the vendor series ends at 2026-03-31 although the table verified 2026-06-30', () => {
  for (const f of Object.keys(june)) {
    assert.equal(stored.timeseries[f + 'Ends'][0], '2026-03-31');
    assert.ok(table.cases.some(c => c.ticker === 'PLUS' && c.field === f && c.period === '2026-06-30' && c.replacementValue === june[f]));
    assert.equal(table.coverage.find(v => v.ticker === 'PLUS' && v.field === f).coversThrough, '2026-06-30');
  }
});

for (const [name, input] of [['stored packet (read time)', stored], ['raw packet (pull time)', raw]]) {
  test(`guard: the verified June quarter is shown, never the fiscal year (${name})`, () => {
    const s = apply(input);
    for (const f of Object.keys(june)) {
      assert.equal(s.timeseries[f + 'Ends'][0], '2026-06-30', f);
      assert.equal(value(s.timeseries[f][0]), june[f], f);
      assert.equal(s.timeseries[f][0].financialCorrection.caseId, `plus-2026-06-30-${f}`);
      assert.equal(s.timeseries[f][0].financialCorrection.originalVendorRow, null);
      assert.equal(s.timeseries[f].length, s.timeseries[f + 'Ends'].length);
      // The older cells keep their verified values and positions behind the filled quarter.
      assert.deepEqual(s.timeseries[f + 'Ends'].slice(1), stored.timeseries[f + 'Ends']);
    }
    // netIncomeQ has no own ends and is read against revenueQEnds: it gets an empty cell, its values do not move.
    assert.deepEqual(s.timeseries.netIncomeQ.map(value), [null, ...stored.timeseries.netIncomeQ.map(value)]);
    assert.equal(s.meta.statementPeriods.revenueQ.length, s.timeseries.revenueQ.length);
    assert.equal(s.meta.statementPeriods.revenueQ[0].end, '2026-06-30');
    assert.equal(s.meta.statementPeriods.netIncomeQ.length, s.timeseries.netIncomeQ.length);
    const leg = g31Shadow(s).v1;
    assert.equal(leg.basis, 'quarter');
    assert.equal(leg.periodEnd, '2026-06-30');
    assert.equal(leg.priorPeriodEnd, '2025-06-30');
    assert.equal(Math.round(leg.pct * 100) / 100, 0.99); // 649,113 / 642,775
    assert.ok(financialReasons(s).some(r => /Anbieter liefert dieses Quartal nicht mehr/.test(r)));
    // A second pass (read time over a persisted fill) changes nothing.
    assert.deepEqual(apply(s).timeseries, s.timeseries);
  });
}

test('no fill when the vendor delivers the quarter itself or a newer one', () => {
  const back = structuredClone(raw);
  const ts = back.timeseries;
  for (const f of Object.keys(june)) { ts[f] = [{ value: june[f] }, ...ts[f]]; ts[f + 'Ends'] = ['2026-06-30', ...ts[f + 'Ends']]; }
  ts.netIncomeQ = [{ value: 37000000 }, ...ts.netIncomeQ];
  back.meta.statementPeriods.revenueQ = [{ ...back.meta.statementPeriods.revenueQ[0], end: '2026-06-30' }, ...back.meta.statementPeriods.revenueQ];
  const s = apply(back);
  for (const f of Object.keys(june)) assert.deepEqual(s.timeseries[f + 'Ends'], back.timeseries[f + 'Ends'], f);
  assert.equal(value(s.timeseries.revenueQ[0]), june.revenueQ);
  // A newer vendor quarter (after coverage) is withheld as before; the June case is then interior and not inserted.
  const newer = structuredClone(raw);
  newer.timeseries.revenueQ = [{ value: 700000000 }, ...newer.timeseries.revenueQ];
  newer.timeseries.revenueQEnds = ['2026-09-30', ...newer.timeseries.revenueQEnds];
  newer.timeseries.netIncomeQ = [{ value: 1 }, ...newer.timeseries.netIncomeQ];
  const n = apply(newer);
  assert.deepEqual(n.timeseries.revenueQEnds, newer.timeseries.revenueQEnds);
  assert.equal(n.timeseries.revenueQ[0].financialMissing.reasonCode, 'period-after-coverage');
  // The same quarter on a shifted vendor end (within a week) is no gap: it is withheld as unverified, never doubled.
  const shifted = structuredClone(raw);
  shifted.timeseries.revenueQ = [{ value: june.revenueQ }, ...shifted.timeseries.revenueQ];
  shifted.timeseries.revenueQEnds = ['2026-06-27', ...shifted.timeseries.revenueQEnds];
  shifted.timeseries.netIncomeQ = [{ value: 1 }, ...shifted.timeseries.netIncomeQ];
  const sh = apply(shifted);
  assert.deepEqual(sh.timeseries.revenueQEnds, shifted.timeseries.revenueQEnds);
  assert.equal(sh.timeseries.revenueQ[0].financialMissing.reasonCode, 'period-not-verified');
});

test('live files unchanged', () => assert.deepEqual(liveHashes(), beforeHashes));
