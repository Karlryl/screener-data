'use strict';
/**
 * P158 / V-DL3 F-08: overview annual growth requires adjacent fiscal years.
 * Usage: node tests/scoring/overview-adjacent-years.test.js
 */
const assert = require('node:assert/strict');
const ov = require('../../src/scoring/overview.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const REASON = 'Jahreswachstum nicht belegt, Jahre liegen nicht hintereinander';
const ENDS = ['2025-12-31', '2024-12-31', '2023-12-31'];
const gp = (values, ends) => ({ annual: { annualGP: values, annualGPEnds: ends } });
function withheld(s, opts, kind) {
  const result = ov.overviewMetric(s, opts);
  assert.equal(result.kind, kind);
  assert.equal(result.value, null);
  assert.equal(result.valuePresent, false);
  assert.equal(result.reason, REASON);
}
function plain(s, opts, kind, value) {
  const result = ov.overviewMetric(s, opts);
  assert.equal(result.kind, kind);
  assert.equal(result.value, value);
  assert.deepEqual(Object.keys(result).sort(), ['companion', 'kind', 'value']);
}

test('German reason is exported verbatim', () => {
  assert.equal(ov.OVERVIEW_YEARS_NOT_ADJACENT_TEXT, REASON);
});
test('GP: dated missing fiscal year withholds growth and marks absence', () => {
  withheld(gp([{ value: 200 }, null, { value: 100 }], ENDS), { gpClass: 'real' }, 'gp');
});
test('301563.SZ pattern: 2025 versus 2023 is not annual growth', () => {
  withheld(gp([76873585.19653031, null, 393343129.88320005], ENDS), { gpClass: 'real' }, 'gp');
});
test('7827.TW pattern: undated GP gap is not annual growth', () => {
  withheld(gp([9817716.105772, null, null, 64367.022508]), {}, 'gp');
});
test('7827.TW pattern: undated revenue gap is not annual growth', () => {
  withheld({ annual: { annualRev: [9817716.105772, null, null, 105748.068732] } },
    { gpClass: 'degenerate' }, 'revenue-badge');
});

test('adjacent object values without dates keep the old object shape', () => {
  plain(gp([{ value: 150 }, { value: 100 }]), {}, 'gp', 0.5);
});
test('dated adjacent fiscal years keep the number and object shape', () => {
  plain(gp([150, 100], ENDS.slice(0, 2)), {}, 'gp', 0.5);
});
test('52/53-week reporter: 364 days is an adjacent year', () => {
  plain(gp([150, 100], ['2025-12-27', '2024-12-28']), {}, 'gp', 0.5);
});
for (const [days, accepted] of [[397, true], [398, false], [333, false], [334, true]]) {
  test(`annual end distance ${days} days: ${accepted ? 'accepted' : 'withheld'}`, () => {
    const older = new Date(Date.UTC(2025, 11, 31) - days * 86400000).toISOString().slice(0, 10);
    const s = gp([150, 100], ['2025-12-31', older]);
    if (accepted) plain(s, {}, 'gp', 0.5);
    else withheld(s, {}, 'gp');
  });
}
test('adjacent positions with ends two years apart are withheld', () => {
  withheld(gp([150, 100], ['2025-12-31', '2023-12-31']), {}, 'gp');
});
test('leading missing values retain the selected pair positions and dates', () => {
  plain(gp([null, 150, 100], ENDS), {}, 'gp', 0.5);
  withheld(gp([null, 150, 100], ['2026-12-31', '2025-12-31', '2023-12-31']), {}, 'gp');
});
test('invalid or missing end at either selected position is undated', () => {
  for (const missing of [null, undefined, 'invalid', '2024-02-30']) {
    plain(gp([150, 100], [missing, '2023-12-31']), {}, 'gp', 0.5);
    plain(gp([150, 100], ['2025-12-31', missing]), {}, 'gp', 0.5);
  }
  plain(gp([150, 100], ['2025-12-31']), {}, 'gp', 0.5);
});
test('only the selected pair matters, not short or long prior periods', () => {
  for (const prior of ['2024-12-30', '2023-11-01']) {
    plain(gp([150, 100, 90], ['2025-12-31', '2024-12-31', prior]), {}, 'gp', 0.5);
  }
});
test('normalization preserves invalid values as gaps', () => {
  for (const missing of [{ value: null }, { value: NaN }, Infinity, '100', undefined]) {
    withheld(gp([150, missing, 100]), {}, 'gp');
  }
  withheld(gp([150, , 100]), {}, 'gp');
});
test('revenue badge uses its own annual period ends', () => {
  const s = { annual: { annualRev: [150, 100], annualRevEnds: ['2025-12-31', '2023-12-31'],
    annualGP: [150, 100], annualGPEnds: ENDS.slice(0, 2) } };
  withheld(s, { gpClass: 'degenerate' }, 'revenue-badge');
  s.annual.annualRevEnds = ENDS.slice(0, 2);
  plain(s, { gpClass: 'degenerate' }, 'revenue-badge', 0.5);
});

test('REIT: a gap in either component preserves the combined FFO gap', () => {
  for (const field of ['annualNetIncome', 'annualDepreciation']) {
    const s = { annual: { annualNetIncome: [100, 75, 50], annualDepreciation: [100, 75, 50],
      annualNetIncomeEnds: ENDS } };
    s.annual[field][1] = null;
    withheld(s, { specialTrack: 'reit' }, 'ffo-badge');
    assert.equal(ov.ffoProxyGrowthYoY(s), null);
  }
});
test('REIT: adjacent pair keeps the number and old object shape', () => {
  const s = { annual: { annualNetIncome: [{ value: 50 }, { value: 40 }],
    annualDepreciation: [50, 40], annualNetIncomeEnds: ENDS.slice(0, 2) } };
  plain(s, { specialTrack: 'reit', gpClass: 'degenerate' }, 'ffo-badge', 0.25);
  assert.equal(ov.ffoProxyGrowthYoY(s), 0.25);
});
test('REIT: dates come from NetIncome, not Depreciation or GP', () => {
  const s = { annual: { annualNetIncome: [75, 50], annualDepreciation: [75, 50],
    annualNetIncomeEnds: ['2025-12-31', '2023-12-31'], annualDepreciationEnds: ENDS.slice(0, 2) } };
  withheld(s, { specialTrack: 'reit' }, 'ffo-badge');
  s.annual.annualNetIncomeEnds = [null, '2023-12-31'];
  plain(s, { specialTrack: 'reit' }, 'ffo-badge', 0.5);
});
test('REIT: unequal component lengths leave a plain null without a second pair', () => {
  plain({ annual: { annualNetIncome: [100, 50], annualDepreciation: [100] } },
    { specialTrack: 'reit' }, 'ffo-badge', null);
});

for (const [field, opts, kind] of [
  ['annualGP', {}, 'gp'], ['annualRev', { gpClass: 'degenerate' }, 'revenue-badge'],
  ['annualNetIncome', { specialTrack: 'reit' }, 'ffo-badge'],
]) {
  test(`${kind}: reported zero, nonpositive older value and insufficient values retain T2 semantics`, () => {
    for (const [values, value] of [
      [[100, 100], 0], [[100, 0], null], [[100, -10], null],
      [[100, null, 0], null], [[100, null, -10], null],
      [[null, 100, null], null], [[null, null], null], [[], null],
    ]) {
      const annual = { [field]: values };
      if (kind === 'ffo-badge') annual.annualDepreciation = values.map(() => 0);
      plain({ annual }, opts, kind, value);
    }
  });
}

const QUARTER_ENDS = ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30',
  '2025-03-31', '2024-12-31', '2024-09-30', '2024-06-30'];
test('eight gapless quarters keep TTM growth despite an annual gap', () => {
  const s = gp([200, null, 100], ENDS);
  s.timeseries = { grossProfitQ: [150, 150, 150, 150, 100, 100, 100, 100], grossProfitQEnds: QUARTER_ENDS };
  plain(s, {}, 'gp', 0.5);
  assert.equal(ov.grossProfitGrowthYoY(s), 0.5);
  s.timeseries.grossProfitQ = Array(8).fill(100);
  plain(s, {}, 'gp', 0);
});
test('unusable quarterly values fall back to the withheld annual pair', () => {
  for (const quarters of [[150, 150, 150, null, 100, 100, 100, 100],
    [150, 150, 150, 150, 100], [150, 150, 150, 150, 0, 0, 0, 0]]) {
    const s = gp([200, null, 100], ENDS);
    s.timeseries = { grossProfitQ: quarters };
    withheld(s, {}, 'gp');
  }
});
test('misaligned quarterly dates fall back to the withheld annual pair', () => {
  const s = gp([200, null, 100], ENDS);
  s.timeseries = { grossProfitQ: [150, 150, 150, 150, 100, 100, 100, 100],
    grossProfitQEnds: ['2026-03-31', '2025-12-31', '2025-06-30', '2025-03-31',
      '2024-12-31', '2024-09-30', '2024-06-30', '2024-03-31'] };
  withheld(s, {}, 'gp');
});
test('public growth APIs return null, never a verdict object', () => {
  for (const s of [gp([200, null, 100], ENDS), gp([200, 100], ['2025-12-31', '2023-12-31'])]) {
    assert.equal(ov.yoyAnnual(s, 'annualGP'), null);
    assert.equal(ov.grossProfitGrowthYoY(s), null);
  }
  assert.equal(ov.yoyAnnual(gp([100, 100]), 'annualGP'), 0);
});

console.log(`\noverview-adjacent-years.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
