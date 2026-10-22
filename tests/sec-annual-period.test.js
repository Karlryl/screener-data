'use strict';
/**
 * sec-annual-period.test.js - F-02 (DL26, 08.10.2026): only full-year periods count as annual values.
 *
 * Finding: annualConcept() grouped 10-K/20-F/40-F rows by the SEC fiscal key `fy` and took the
 * latest period end, ignoring the period start. Quarters, single months, successor stubs and
 * since-inception totals were therefore accepted as annual values (16 of 129 locally cached
 * filers). Kodak FY2017 lost its 1,531 M USD annual revenue because a 414 M USD fourth quarter
 * counted as a competing annual value and the factor-2 conflict guard dropped the whole year.
 *
 * Rule: a duration value is accepted only if it is a full year (lib/sec-pit.js isAnnualPoint,
 * 330-380 elapsed days) AND ends on the period end the old rule picked for that concept and fiscal
 * key. Otherwise the cell stays empty. A bare day filter is not enough: for DBD FY2023 and EXE
 * FY2021 it would relabel the prior-year comparative (DBD 3,460.7 M USD revenue of 2022, EXE
 * -8,703 M USD operating income of 2020) as the current year. Balance-sheet values (instants)
 * are unchanged.
 *
 * Real cases: tests/fixtures/sec-annual-period-cases.json (trimmed SEC companyfacts, provenance
 * in each `_source`). Usage: node tests/sec-annual-period.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSecSeries, annualConcept, annualRevUnion, buildAnnual } = require('../merge-sec-xbrl.js');
const CASES = require('./fixtures/sec-annual-period-cases.json');

function quiet(fn) {
  const orig = console.warn, lines = [];
  console.warn = (...a) => lines.push(a.join(' '));
  try { return { value: fn(), warnings: lines }; } finally { console.warn = orig; }
}
function extract(tk) {
  const { value, warnings } = quiet(() => extractSecSeries(CASES[tk], tk));
  const at = (field, fy) => {
    const i = value.annual._fys.indexOf(fy);
    assert.ok(i >= 0, `${tk}: fiscal key ${fy} missing from the axis`);
    return value.annual[field][i].value;
  };
  return { at, warnings };
}
const row = (fy, start, end, val, extra = {}) => ({ fy, start, end, val, form: '10-K', fp: 'FY', filed: `${fy + 1}-02-15`, accn: `A-${fy}`, ...extra });
const tax = (concepts) => Object.fromEntries(Object.entries(concepts).map(([c, rows]) => [c, { units: { USD: rows } }]));

// -- Real cases ---------------------------------------------------------------------------------
test('KODK FY2016/FY2017: the fourth quarter no longer competes, the annual revenue comes back', () => {
  const k = extract('KODK');
  assert.equal(k.at('annualRev', 2017), 1531000000, 'FY2017 SalesRevenueNet 2017-01-01..2017-12-31');
  assert.equal(k.at('annualRev', 2016), 1543000000, 'FY2016 SalesRevenueNet 2016-01-01..2016-12-31');
  assert.ok(!k.warnings.some((w) => w.includes('KODK FY2017') || w.includes('KODK FY2016')), k.warnings.join('\n'));
});

test('DBD FY2023: the 140-day successor stub becomes a gap, the 2022 comparative does not move in', () => {
  const k = extract('DBD');
  for (const f of ['annualRev', 'annualOpInc', 'annualNetIncome', 'annualOCF', 'annualGP']) {
    assert.equal(k.at(f, 2023), null, `${f} FY2023 must stay empty`);
  }
  assert.equal(k.at('annualShares', 2023), 37566668, 'shares stay at the original period end');
  assert.equal(k.at('annualAssets', 2023), 4162000000, 'balance sheet unchanged');
  assert.equal(k.at('annualRev', 2022), 3460700000, 'FY2022 itself is unchanged');
});

test('EXE FY2021: the 324-day successor period becomes a gap, 2020 values stay in FY2020', () => {
  const k = extract('EXE');
  for (const f of ['annualRev', 'annualOpInc', 'annualNetIncome', 'annualOCF']) {
    assert.equal(k.at(f, 2021), null, `${f} FY2021 must stay empty`);
  }
  assert.equal(k.at('annualShares', 2021), 117105845, 'shares stay at the original period end');
  assert.equal(k.at('annualRev', 2020), 5296000000);
  assert.equal(k.at('annualOpInc', 2020), -8703000000);
  assert.equal(k.at('annualGP', 2011), null, 'FY2011 gross profit was no full-year value');
  assert.equal(k.at('annualGP', 2010), null, 'FY2010 gross profit was no full-year value');
});

test('STAA FY2012-FY2017: the quarter conflicts disappear, annual revenue comes back', () => {
  const k = extract('STAA');
  const expected = { 2017: 90611000, 2016: 82432000, 2015: 77123000, 2014: 74987000, 2013: 72215000, 2012: 63783000 };
  for (const [fy, val] of Object.entries(expected)) assert.equal(k.at('annualRev', Number(fy)), val, `FY${fy}`);
});

test('LITE FY2019: the 404.6 M USD quarter no longer blocks the 1,565.3 M USD annual revenue', () => {
  const k = extract('LITE');
  assert.equal(k.at('annualRev', 2019), 1565300000);
  assert.ok(!k.warnings.some((w) => w.includes('LITE FY2019')), k.warnings.join('\n'));
});

test('QMMM FY2024 (known open case, outside F-02): FCF pairs cash flow and capex of different years',
  { todo: 'OCF ends 2024-09-30, capex 2023-09-30; F-02 binds each concept only to its own period end' }, () => {
    assert.equal(extract('QMMM').at('annualFCF', 2024), null);
  });

// -- Rule details (synthetic rows) -------------------------------------------------------------
test('same period end: the full year wins over a quarter in either array order', () => {
  const q = row(2017, '2017-10-01', '2017-12-31', 414, { filed: '2018-03-16' });
  const y = row(2017, '2017-01-01', '2017-12-31', 1531, { filed: '2018-03-15' });
  for (const rows of [[q, y], [y, q]]) {
    assert.equal(annualConcept(tax({ Revenues: rows }), 'Revenues').get(2017).val, 1531);
  }
});

test('52/53-week and leap years are full years', () => {
  const rows = [
    row(2019, '2018-12-30', '2019-12-28', 1), // 363 days
    row(2020, '2019-12-29', '2021-01-02', 2), // 370 days, 53-week year
    row(2021, '2021-01-01', '2021-12-31', 3), // 364 days
    row(2024, '2024-01-01', '2024-12-31', 4), // leap year, 365 days
  ];
  const m = annualConcept(tax({ Revenues: rows }), 'Revenues');
  assert.deepEqual([...m.keys()].sort(), [2019, 2020, 2021, 2024]);
});

test('missing or invalid start: no value, never a guess', () => {
  const m = annualConcept(tax({ Revenues: [row(2022, undefined, '2022-12-31', 1), row(2023, 'kaputt', '2023-12-31', 2)] }), 'Revenues');
  assert.equal(m.size, 0);
});

test('an older comparative period never fills a rejected current period (DBD/EXE pattern)', () => {
  const rows = [row(2023, '2023-08-13', '2023-12-31', 1628), row(2023, '2022-01-01', '2022-12-31', 3460)];
  assert.equal(annualConcept(tax({ Revenues: rows }), 'Revenues').has(2023), false);
});

test('since-inception totals are not annual values; the same-end annual value is used instead', () => {
  const rows = [row(2013, '1980-07-22', '2013-12-31', -450952), row(2013, '2013-01-01', '2013-12-31', -90284)];
  assert.equal(annualConcept(tax({ OperatingIncomeLoss: rows }), 'OperatingIncomeLoss').get(2013).val, -90284);
});

test('balance-sheet instants need no start and keep their selection', () => {
  const gaap = tax({
    OperatingIncomeLoss: [row(2024, '2024-01-01', '2024-12-31', 10)],
    Assets: [{ fy: 2024, end: '2024-12-31', val: 500, form: '10-K', fp: 'FY', accn: 'A-2024' }],
    LiabilitiesCurrent: [{ fy: 2024, end: '2024-12-31', val: 100, form: '10-K', fp: 'FY', accn: 'A-2024' }],
  });
  const a = buildAnnual(gaap, {});
  assert.equal(a.annualAssets[0].value, 500);
  assert.equal(a.annualCurrentLiabilities[0].value, 100);
});

test('a genuine annual conflict (two full years, factor > 2) still drops the year', () => {
  const gaap = tax({
    RevenueFromContractWithCustomerIncludingAssessedTax: [row(2019, '2018-07-01', '2019-06-29', 1565300000)],
    Revenues: [row(2019, '2018-07-01', '2019-06-29', 404600000)],
  });
  const { value, warnings } = quiet(() => annualRevUnion(gaap, 'CONFLICT'));
  assert.equal(value.has(2019), false);
  assert.ok(warnings.join(' ').includes('Umsatz-Konflikt CONFLICT FY2019'));
});

test('taxonomy probing uses the same rule: a quarter alone does not make a newer year', () => {
  const facts = {
    'us-gaap': tax({ Revenues: [row(2024, '2024-01-01', '2024-12-31', 100)] }),
    'ifrs-full': tax({ Revenue: [row(2025, '2025-10-01', '2025-12-31', 30, { form: '20-F' })] }),
  };
  assert.equal(extractSecSeries({ facts }).taxonomie, 'us-gaap');
});

test('amendments and non-USD units stay excluded', () => {
  const gaap = { Revenues: { units: {
    USD: [row(2022, '2022-01-01', '2022-12-31', 1, { form: '10-K/A' })],
    EUR: [row(2023, '2023-01-01', '2023-12-31', 2)],
  } } };
  assert.equal(annualConcept(gaap, 'Revenues').size, 0);
});
