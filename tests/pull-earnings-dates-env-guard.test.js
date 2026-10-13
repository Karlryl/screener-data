'use strict';
// S51: env parsing and bounded batching. No network or calendar-file access.
const assert = require('node:assert/strict');
const { parseIntEnv, isFreshEntry } = require('../pull-earnings-dates.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}
function withWarnings(fn) {
  const original = console.warn;
  const warnings = [];
  console.warn = message => warnings.push(message);
  try { fn(warnings); }
  finally { console.warn = original; }
}

const cases = [
  ['unset', undefined, {}, 15, false],
  ['empty', '', {}, 15, false],
  ['integer', '7', {}, 7, false],
  ['surrounding whitespace', ' 7 ', {}, 7, false],
  ['leading zeros', '007', {}, 7, false],
  ['minimum accepted', '1', {}, 1, false],
  ['zero rejected by default', '0', {}, 15, true],
  ['zero allowed for grace', '0', { min: 0 }, 0, false],
  ['whitespace zero allowed for grace', ' 0 ', { min: 0 }, 0, false],
  ['custom minimum', '7', { min: 8 }, 15, true],
  ['negative', '-5', {}, 15, true],
  ['fraction', '2.5', {}, 15, true],
  ['letters', 'abc', {}, 15, true],
  ['exponent', '1e3', {}, 15, true],
  ['whitespace alone', ' ', {}, 15, true],
  ['plus sign', '+7', {}, 15, true],
  ['numeric prefix', '7days', {}, 15, true],
  ['hex prefix', '0x10', {}, 15, true],
  ['largest safe integer', '9007199254740991', {}, Number.MAX_SAFE_INTEGER, false],
  ['finite integer beyond safe range', '9007199254740992', {}, 9007199254740992, false],
  ['overflowing integer', '9'.repeat(400), {}, 15, true],
];
for (const [label, raw, options, expected, warn] of cases) {
  test('parseIntEnv: ' + label, () => withWarnings(warnings => {
    assert.equal(parseIntEnv(raw, 15, { name: 'EARNINGS_TEST', ...options }), expected);
    assert.deepEqual(warnings, warn ? ['::warning::EARNINGS_TEST ungueltig (' + raw + '), Default 15'] : []);
  }));
}

test('invalid carry-fresh env uses the 30-day default', () => withWarnings(warnings => {
  const original = process.env.EARNINGS_CARRY_FRESH_DAYS;
  try {
    process.env.EARNINGS_CARRY_FRESH_DAYS = 'abc';
    assert.equal(isFreshEntry({ pulledAt: '2026-09-15' }, '2026-09-25'), true);
    assert.deepEqual(warnings, ['::warning::EARNINGS_CARRY_FRESH_DAYS ungueltig (abc), Default 30']);
  } finally {
    if (original === undefined) delete process.env.EARNINGS_CARRY_FRESH_DAYS;
    else process.env.EARNINGS_CARRY_FRESH_DAYS = original;
  }
}));

test('zero concurrency falls back and finishes 40 stocks in three batches', () => withWarnings(warnings => {
  assert.equal(parseInt('0' || '15', 10), 0, 'old parsing left the loop increment at zero');
  let n = 0;
  for (let s = 0; s < 40 && n < 1000; s += parseIntEnv('0', 15, { name: 't' })) n++;
  assert.equal(n, 3);
  assert.deepEqual(warnings, Array(3).fill('::warning::t ungueltig (0), Default 15'));
}));

console.log('\nS51 env guard: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
