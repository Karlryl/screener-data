'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { HK_INC_ITEMS, HK_JAHR_TYP, bauHkJahre } = require('../scripts/build-cnannual');

const DATE = '2025-12-31 00:00:00';
const IFRS = '国际会计准则';
const HKFRS = '香港会计准则';

function input(grossProfitStandard) {
  const incomeRow = (code, amount, standard) => ({
    DATE_TYPE_CODE: HK_JAHR_TYP,
    REPORT_DATE: DATE,
    STD_ITEM_CODE: code,
    AMOUNT: amount,
    ACCOUNT_STANDARD: standard,
    CURRENCY_CODE: 'CNY',
  });

  return {
    main: [{
      DATE_TYPE_CODE: HK_JAHR_TYP,
      START_DATE: '2025-01-01 00:00:00',
      REPORT_DATE: DATE,
      OPERATE_INCOME: 100,
      NETCASH_OPERATE: 25,
    }],
    inc: [
      incomeRow(HK_INC_ITEMS.annualRev, 100, IFRS),
      incomeRow(HK_INC_ITEMS.annualGrossProfit, 40, grossProfitStandard),
    ],
    bal: [],
  };
}

test('China annual parser accepts one label across income-statement line items', () => {
  const annual = bauHkJahre(input(IFRS), '9992.HK');

  assert.equal(annual.standard, 'IFRS');
  assert.equal(annual.annualGrossProfit[0].value, 40);
});

test('China annual parser rejects conflicting labels within one income report', () => {
  assert.throws(() => bauHkJahre(input(HKFRS), '9992.HK'), /zwei Etiketten/);
});
