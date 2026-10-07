'use strict';
const assert = require('node:assert/strict');
const { buildFirmMap, countEntities, compareBoard, datedPairs, isGapless, counterCheck } = require('../scripts/p115-jahrespaare-vorher-nachher.js');
const { annualPairsShadow, withAnnualPairRule } = require('../src/scoring/annual-pairs.js');

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
const abf = snap('ABF.L', 'Associated British Foods', [365, 336, 30], [25756111422.8, 26568807471.6, 26141281700, 26141281700]);
abf.annual.annualRevEnds = abf.annual.annualGPEnds = ['2025-08-31', '2024-08-31', '2023-09-30', '2023-08-31'];
assert.equal(isGapless(datedPairs(abf, 'annualRev')), false, 'raw distances still retain the duplicate');
for (const field of ['annualRev', 'annualGP']) assert.equal(isGapless(datedPairs(abf, field, true)), true, 'ABF.L is gapless after duplicate collapse');
const abfShadow = annualPairsShadow(abf), abfCheck = counterCheck(abf, abfShadow);
assert.equal(abfCheck.checked.length, 2);
assert.equal(abfCheck.falseFailures.length, 0);
assert.deepEqual(abfCheck.duplicateEntriesCollapsed, ['annualRev', 'annualGP'].map(field => ({
  ticker: 'ABF.L', field, newer: '2023-09-30', older: '2023-08-31', value: 26141281700,
})));
const brokenAbf = structuredClone(abfShadow);
brokenAbf.acceleration = { ...brokenAbf.acceleration, code: 'short-prior-period', priorLengthDays: 30, shadow: null };
assert.equal(counterCheck(abf, brokenAbf).falseFailures.length, 1, 'counter-check detects the original duplicate-induced failure');
const stub = snap('SIG.AX', 'Stub', [365, 150], [5000000000, 4184504749.76, 3383060818.13]);
assert.equal(isGapless(datedPairs(stub, 'annualRev', true)), false, 'different-valued stubs are not gapless');
assert.equal(counterCheck(stub, annualPairsShadow(stub)).checked.length, 0);
assert.deepEqual(counterCheck(stub, annualPairsShadow(stub)).duplicateEntriesCollapsed, []);
const repeated = snap('REPEATED', 'Repeated', [365, 30, 30, 306], [180, 120, 120, 120, 100]);
assert.deepEqual(datedPairs(repeated, 'annualRev', true).map(p => [p.iNew, p.iOld]), [[0, 1], [1, 4]]);
assert.equal(isGapless(datedPairs(repeated, 'annualRev', true)), true);
assert.equal(counterCheck(repeated, annualPairsShadow(repeated)).duplicateEntriesCollapsed.length, 4);
assert.equal(annualPairsShadow(repeated).acceleration.code, 'short-period');
assert.equal(counterCheck(repeated, annualPairsShadow(repeated)).falseFailures.length, 0, 'a selected duplicate pair is intentionally rejected');
assert.equal(counterCheck(repeated, annualPairsShadow(repeated)).checked[0].failures[0].code, 'short-period', 'intentional rejection remains documented');
const firstDuplicate = snap('PAIR', 'Pair', [30, 335, 365], [180, 180, 120, 80]);
const pairShadow = annualPairsShadow(firstDuplicate), pairCheck = counterCheck(firstDuplicate, pairShadow);
for (const axis of ['growth', 'grossProfit', 'acceleration']) assert.equal(pairShadow[axis].code, 'short-period');
assert.equal(pairCheck.falseFailures.length, 0);
assert.equal(pairCheck.zeroOnly.length, 0);
const brokenPair = structuredClone(pairShadow);
brokenPair.acceleration.code = 'short-prior-period';
assert.equal(counterCheck(firstDuplicate, brokenPair).falseFailures.length, 1, 'only the intended short-period code is exempt');
firstDuplicate.meta.annualRevNewerYear = { end: '2026-06-30', priorEnd: firstDuplicate.annual.annualRevEnds[0], revenue: 360, priorRevenue: 180, priorStored: 180 };
assert.equal(counterCheck(firstDuplicate, annualPairsShadow(firstDuplicate)).falseFailures.length, 1, 'a newer record is not a collapsed stored pair');
const newerShadow = annualPairsShadow(firstDuplicate);
assert.deepEqual(withAnnualPairRule({ growth: true }, () => counterCheck(firstDuplicate, newerShadow)),
  counterCheck(firstDuplicate, newerShadow), 'counter-check is independent of the ambient growth switch');
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
