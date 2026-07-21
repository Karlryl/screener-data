'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSecSeries } = require('../../merge-sec-xbrl.js');

const annualUsd = (rows) => ({
  units: {
    USD: rows.map(([fy, val]) => ({
      form: '10-K', fp: 'FY', fy, val,
      start: `${fy}-01-01`, end: `${fy}-12-31`, accn: `${fy}-annual`,
    })),
  },
});

test('annualShares aligns instant facts to FY ends with ordered concept fallbacks', () => {
  const companyfacts = {
    facts: {
      dei: {
        EntityCommonStockSharesOutstanding: {
          units: {
            shares: [
              { end: '2023-12-30', val: 130, form: '10-K', fy: 2023, fp: 'FY' },
              { end: '2024-01-15', val: 999, form: '10-K', fy: 2023, fp: 'FY' },
            ],
          },
        },
      },
      'us-gaap': {
        RevenueFromContractWithCustomerExcludingAssessedTax: annualUsd([
          [2020, 1000], [2021, 1100], [2022, 1200], [2023, 1300],
        ]),
        NetIncomeLoss: annualUsd([
          [2020, 10], [2021, 20], [2022, 30], [2023, 40],
        ]),
        NetCashProvidedByUsedInOperatingActivities: annualUsd([
          [2020, 20], [2021, 40], [2022, 60], [2023, 80],
        ]),
        CommonStockSharesOutstanding: {
          units: {
            shares: [
              { end: '2022-12-31', val: 120, form: '10-K', fy: 2022, fp: 'FY' },
              { end: '2023-12-31', val: 888, form: '10-K', fy: 2023, fp: 'FY' },
            ],
          },
        },
        WeightedAverageNumberOfSharesOutstandingBasic: {
          units: {
            shares: [
              {
                start: '2021-01-01', end: '2021-12-31', val: 100,
                form: '10-K', fy: 2021, fp: 'FY',
              },
              {
                start: '2022-01-01', end: '2022-12-31', val: 777,
                form: '10-K', fy: 2022, fp: 'FY',
              },
            ],
          },
        },
      },
    },
  };

  const { annual } = extractSecSeries(companyfacts);

  assert.deepEqual(annual._fys, [2023, 2022, 2021, 2020]);
  assert.deepEqual(annual.annualShares, [
    { value: 130 },
    { value: 120 },
    { value: 100 },
    { value: null },
  ]);
  assert.equal(annual.annualShares.length, annual.annualRev.length);
  assert.deepEqual(annual.annualNetIncome, [
    { value: 40 },
    { value: 30 },
    { value: 20 },
    { value: 10 },
  ]);
  assert.deepEqual(annual.annualOCF, [
    { value: 80 },
    { value: 60 },
    { value: 40 },
    { value: 20 },
  ]);
});
