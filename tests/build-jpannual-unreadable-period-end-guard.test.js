'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { bauJahre, MIN_BELEGE } = require('../scripts/build-jpannual.js');

const row = (element, context, circle, value) => [
  element, '', context, '', circle, '', '', '', String(value),
];

function fixture() {
  return [
    ...Array.from({ length: MIN_BELEGE }, (_, index) => row(
      `proof:${index}`,
      'CurrentYearInstant_NonConsolidatedMember',
      '個別',
      index + 1,
    )),
    row('jpdei_cor:WhetherConsolidatedFinancialStatementsArePreparedDEI',
      'FilingDateInstant', 'その他', 'true'),
    row('jpdei_cor:AccountingStandardsDEI', 'FilingDateInstant', 'その他', 'Japan GAAP'),
    row('jpcrp_cor:NetSalesSummaryOfBusinessResults', 'CurrentYearDuration', '連結', 300),
    row('jpcrp_cor:NetSalesSummaryOfBusinessResults', 'Prior1YearDuration', '連結', 200),
    row('jpcrp_cor:NetSalesSummaryOfBusinessResults', 'Prior2YearDuration', '連結', 100),
  ];
}

test('valid periodEnd anchors the fiscal-year axis', () => {
  const result = bauJahre(fixture(), '2025-12-31', 'TEST.T');

  assert.deepEqual(result.fys, [2025, 2024, 2023]);
  assert.deepEqual(result.annualRev.map(({ value }) => value), [300, 200, 100]);
});

test('nonnumeric periodEnd year fails closed', () => {
  assert.throws(
    () => bauJahre(fixture(), 'not-a-date', 'TEST.T'),
    /TEST\.T: periodEnd "not-a-date" unbrauchbar/,
  );
});
