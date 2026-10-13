// T2 (Karl-Audit): build-krannual.js numOf() coerced an ABSENT or BLANK OpenDART
// thstrm_amount field straight into Number(), which yields 0 (Number('')===0,
// Number.isFinite(0)===true) — indistinguishable from a genuinely reported zero.
// main() then wrote that phantom 0 into revByYear/opByYear as if OpenDART had
// actually reported a $0 result for that account/year. '-' (OpenDART's real
// no-data marker) already produced NaN and was correctly filtered downstream —
// only the '' / undefined / comma-only cases silently became real zeroes.
//
// Run: node tests/build-krannual-numof.test.js   (Exit 0/1)
'use strict';
const assert = require('node:assert/strict');
const { numOf } = require('../scripts/build-krannual.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

check("blank thstrm_amount ('') -> null, not 0 (THE BUG)", () => {
  assert.equal(numOf({ thstrm_amount: '' }), null);
});
check('missing thstrm_amount ({}) -> null, not 0 (THE BUG)', () => {
  assert.equal(numOf({}), null);
});
check("comma-only thstrm_amount (',') -> null, not 0", () => {
  assert.equal(numOf({ thstrm_amount: ',' }), null);
});
check("whitespace-only thstrm_amount ('   ') -> null, not 0", () => {
  assert.equal(numOf({ thstrm_amount: '   ' }), null);
});
check('absent object (null/undefined) -> null (control, no regression)', () => {
  assert.equal(numOf(null), null);
  assert.equal(numOf(undefined), null);
});
check("real reported zero ('0') -> 0, must stay 0 (no over-correction)", () => {
  assert.equal(numOf({ thstrm_amount: '0' }), 0);
});
check("thousands-separated amount ('1,234') -> 1234", () => {
  assert.equal(numOf({ thstrm_amount: '1,234' }), 1234);
});
check("OpenDART no-data marker ('-') -> null (control, no regression)", () => {
  assert.equal(numOf({ thstrm_amount: '-' }), null);
});

console.log(fail ? `\nbuild-krannual-numof: ${fail} FAILED` : '\nbuild-krannual-numof: all passed');
process.exit(fail ? 1 : 0);
