'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { HK_JAHR_TYP, pruefeYtdHk } = require('../scripts/build-cnannual');

function annualRow(startDate) {
  return {
    DATE_TYPE_CODE: HK_JAHR_TYP,
    START_DATE: startDate,
    REPORT_DATE: '2025-12-31 00:00:00',
  };
}

test('China annual YTD guard accepts a readable full-year span', () => {
  assert.doesNotThrow(() => pruefeYtdHk('9992.HK', [annualRow('2025-01-01 00:00:00')]));
});

test('China annual YTD guard rejects an unreadable annual start date', () => {
  assert.throws(() => pruefeYtdHk('9992.HK', [annualRow('not-a-date')]), /lesbarem START_DATE/);
});
