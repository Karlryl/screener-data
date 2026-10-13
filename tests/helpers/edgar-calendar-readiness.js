'use strict';

const assert = require('node:assert/strict');

// Maintenance gate only: callers provide the clock so boundary tests stay fixed.
function assertEdgarCalendarReady(calendar, now) {
  const year = now.getUTCFullYear();
  const required = [year];
  if (now.getUTCMonth() === 11) required.push(year + 1);
  for (const target of required) {
    assert.ok(Array.isArray(calendar.years[target]) && calendar.years[target].length > 0,
      'EDGAR calendar missing year ' + target + ' in configs/edgar-holidays.json. ' +
      'Add sourced SEC dates; next year is required from December 1 UTC.');
  }
}

module.exports = { assertEdgarCalendarReady };
