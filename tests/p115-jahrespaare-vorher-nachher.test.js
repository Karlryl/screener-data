'use strict';
const assert = require('node:assert/strict');
const { buildFirmMap, countEntities, compareBoard, datedPairs, isGapless, counterCheck } = require('../scripts/p115-jahrespaare-vorher-nachher.js');
const { annualPairsShadow } = require('../src/scoring/annual-pairs.js');

const snap = (ticker, name = ticker, distances = [366, 336], values = [180, 120, 80]) => {
  let day = Date.parse('2025-12-31T00:00:00Z');
  const dates = [new Date(day).toISOString().slice(0, 10)];
  for (const distance of distances) { day -= distance * 86400000; dates.push(new Date(day).toISOString().slice(0, 10)); }
  return { meta: { ticker, name }, annual: { annualRev: values, annualRevEnds: dates, annualGP: values, annualGPEnds: dates }, timeseries: {} };
};
const input = Array.from({ length: 110 }, (_, i) => snap('T' + i));
input.push(snap('CLASSA', 'Example Holdings Class A'), snap('CLASSB', 'Example Holdings Class B'), { meta: { ticker: 'UNNAMED' } });
const firms = buildFirmMap(input);
assert.deepEqual(countEntities(['CLASSA', 'CLASSB', 'CLASSB'], firms), { firms: 1, tickers: 2 });
assert.deepEqual(countEntities(['UNNAMED'], firms), { firms: 1, tickers: 1 });
const before = Array.from({ length: 110 }, (_, i) => ({ ticker: 'T' + i }));
const after = before.slice();
[after[0], after[5]] = [after[5], after[0]]; // Exactly five places.
[after[10], after[14]] = [after[14], after[10]]; // Four places must not count.
[after[19], after[20]] = [after[20], after[19]];
[after[103], after[109]] = [after[109], after[103]]; // Outside top 100 on both sides.
after.splice(30, 1, { ticker: 'CLASSA' });
const result = compareBoard(before, after, firms);
assert.deepEqual(result.jumps.map(r => r.ticker), ['T0', 'T5']);
assert.deepEqual(result.topIn.map(r => r.ticker), ['T20']);
assert.deepEqual(result.topOut.map(r => r.ticker), ['T19']);
assert.deepEqual(result.counts.topIn, { firms: 1, tickers: 1 });
assert.deepEqual(result.lost.map(r => [r.ticker, r.before, r.after]), [['T30', 31, null]]);
assert.deepEqual(result.gained.map(r => [r.ticker, r.before, r.after]), [['CLASSA', null, 31]]);
const swap = compareBoard([{ ticker: 'CLASSA' }], [{ ticker: 'CLASSB' }], firms);
assert.deepEqual(swap.counts.topIn, { firms: 0, tickers: 1 });
assert.deepEqual(swap.counts.topOut, { firms: 0, tickers: 1 });
assert.deepEqual(compareBoard(before, [], firms).counts.lost, { firms: 110, tickers: 110 });
assert.deepEqual(compareBoard([], before, firms).counts.gained, { firms: 110, tickers: 110 });

assert.equal(isGapless(datedPairs(snap('GOOD'), 'annualRev')), true, '336 and 366 days are gapless');
for (const days of [456, 730]) assert.equal(isGapless(datedPairs(snap('GAP', 'Gap', [366, days]), 'annualRev')), false);
assert.equal(isGapless([]), false, 'no dated evidence is not a checked gapless series');
const zero = snap('ZERO', 'Zero', [366, 365, 365], [180, 0, 120, 80]);
const zeroCheck = counterCheck(zero, annualPairsShadow(zero));
assert.equal(zeroCheck.falseFailures.length, 0);
assert.equal(zeroCheck.zeroOnly.length, 1);
assert.equal(zeroCheck.zeroOnly[0].failures[0].code, 'zero-year');
const missing = snap('NULL', 'Missing', [366, 365, 365], [180, null, 120, 80]);
assert.equal(isGapless(datedPairs(missing, 'annualRev')), false, 'missing is not zero; present values span the gap');
assert.equal(counterCheck(missing, annualPairsShadow(missing)).zeroOnly.length, 0);
const good = snap('GOOD'), goodShadow = annualPairsShadow(good);
assert.equal(counterCheck(good, goodShadow).falseFailures.length, 0);
// Deliberately break only synthetic evidence: the counter-check must detect it.
const broken = structuredClone(goodShadow);
broken.growth = { ...broken.growth, code: 'missing-year', shadow: null };
assert.equal(counterCheck(good, broken).falseFailures.length, 1);
assert.equal(counterCheck(good, broken).zeroOnly.length, 0);
console.log('p115-jahrespaare-vorher-nachher.test.js: Rangwechsel, Emittenten, Abstände und Gegenprobe bestanden.');
