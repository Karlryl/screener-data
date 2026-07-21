'use strict';
// Guard fuer die K2-Achse (CFO/NI-Slope) des QC-core-rho-Screens.
// Reine Slope (GG4, kein Niveau); nur FY mit NI>0 + finitem OCF; >=2 gueltige FY.
const { test } = require('node:test');
const assert = require('node:assert');
const { k2Slope } = require('../../scripts/qc-rho-k2.js');

const fy = (ni, ocf) => ({
  annualNetIncome: ni.map((v) => ({ value: v })),
  annualOCF: ocf.map((v) => ({ value: v })),
});

test('k2Slope: steigende CFO/NI-Ratio -> positive Steigung', () => {
  // CFO/NI = 1,2,3 ueber FY-Index 0,1,2 -> Steigung 1
  const s = k2Slope(fy([100, 100, 100], [100, 200, 300]));
  assert.ok(s !== null && Math.abs(s - 1) < 1e-9, 'Steigung 1 erwartet, war ' + s);
});

test('k2Slope: fallende CFO/NI-Ratio -> negative Steigung', () => {
  const s = k2Slope(fy([100, 100, 100], [300, 200, 100]));
  assert.ok(s !== null && s < 0, 'negative Steigung erwartet, war ' + s);
});

test('k2Slope: FY mit NI<=0 werden gefiltert (Ratio waere bedeutungslos)', () => {
  // gueltig nur Index 1+2: CFO/NI = 1, 2 -> Steigung 1
  const s = k2Slope(fy([-50, 100, 100], [999, 100, 200]));
  assert.ok(s !== null && Math.abs(s - 1) < 1e-9, 'Steigung 1 nach NI-Filter erwartet, war ' + s);
});

test('k2Slope: <2 gueltige FY oder fehlende Daten -> null', () => {
  assert.strictEqual(k2Slope(fy([100], [100])), null);        // nur 1 FY
  assert.strictEqual(k2Slope(fy([-1, -1], [100, 100])), null); // 0 gueltige (NI<=0)
  assert.strictEqual(k2Slope(null), null);
  assert.strictEqual(k2Slope({ annualNetIncome: null, annualOCF: null }), null);
});
