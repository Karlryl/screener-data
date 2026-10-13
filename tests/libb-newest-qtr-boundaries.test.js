'use strict';
// lib/newest-qtr-guard.js:83,91-100. P1: boundary changes can change the warning/exclusion flag.
// The existing Samsung/MU shapes do not pin each exact inequality independently.
const assert = require('node:assert/strict');
const { detectNewestQtrSuspect: detect } = require('../lib/newest-qtr-guard.js');
function check(name, fn) { try { fn(); console.log('PASS ' + name); } catch (e) { console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }
const base = () => ({ revenueQ: [200,100,100,100,100], opIncQ: [100,10,10,10,10], grossProfitQ: [140,40,40,40,40] });
function result(edit) { const s = base(); edit(s); const before = structuredClone(s); const out = detect(s); assert.deepEqual(s,before); return out.suspect; }
check('control all four legs flag a spike without changing source arrays', () => assert.equal(result(() => {}), true));
check('leg1 margin discontinuity exactly 0.20 is excluded, just above is flagged', () => {
  assert.equal(0.25 - 0.05, 0.20, 'fixture lands exactly on the floating-point threshold');
  assert.equal(result(s => { s.opIncQ = [50,5,5,5,5]; }), false);
  assert.equal(result(s => { s.opIncQ = [50.001,5,5,5,5]; }), true);
});
check('leg2 gross margin exactly 0.55 is excluded, just above is flagged', () => {
  assert.equal(result(s => { s.grossProfitQ[0] = 110; }), false);
  assert.equal(result(s => { s.grossProfitQ[0] = 110.001; }), true);
});
check('leg3 revenue exactly 1.35 times trailing median is excluded, just above is flagged', () => {
  for (const [r, want] of [[135,false],[135.001,true]]) assert.equal(result(s => { s.revenueQ[0] = r; s.opIncQ[0] = r*0.5; s.grossProfitQ[0] = r*0.7; }),want);
});
check('leg4 prior margin exactly 0.02 is excluded, just above is flagged', () => {
  assert.equal(result(s => { s.opIncQ[1] = 2; }), false);
  assert.equal(result(s => { s.opIncQ[1] = 2.001; }), true);
});
check('leg4 inclusive spike ratio is flagged at 1.9, below it is excluded', () => {
  assert.equal(result(s => { s.opIncQ[1] = 25; s.opIncQ[0] = 95; }), true);
  assert.equal(result(s => { s.opIncQ[1] = 25; s.opIncQ[0] = 94.999; }), false);
});
check('history needs three finite trailing margins, two are insufficient', () => {
  assert.equal(result(s => { s.opIncQ[4] = null; }), true);
  assert.equal(result(s => { s.opIncQ[3] = s.opIncQ[4] = null; }), false);
});
