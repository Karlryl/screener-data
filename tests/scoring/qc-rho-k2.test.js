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

// BM-SK-002 (Tag 626/627): eine INNERE Luecke (NI<=0 mitten in der Reihe) darf die FY-Achse
// nicht zusammenschieben. Vorher zaehlte der Regressor die Position der gueltigen Punkte
// (0,1,2) statt des echten FY-Index (0,2,3) — der Abstand des uebersprungenen Jahres ging
// verloren und die Steigung wurde zu steil. Fuehrende Luecken (Test oben) verschieben nur
// den Nullpunkt und faerben deshalb nicht auf die Steigung ab; nur eine innere Luecke deckt
// den Fehler auf.
test('k2Slope: innere FY-Luecke bleibt auf der echten Zeitachse (BM-SK-002)', () => {
  // gueltig sind FY 0,2,3 mit CFO/NI = 1,3,4 -> echte Achse (0,2,3) ist exakt linear, Steigung 1.
  // Auf der gestauchten Achse (0,1,2) ergaeben dieselben Punkte 1.5.
  const s = k2Slope(fy([100, -50, 100, 100], [100, 999, 300, 400]));
  assert.ok(s !== null && Math.abs(s - 1) < 1e-9,
    'Steigung 1 auf FY-Index 0,2,3 erwartet (gestauchte Achse gaebe 1.5), war ' + s);
});

test('k2Slope: <2 gueltige FY oder fehlende Daten -> null', () => {
  assert.strictEqual(k2Slope(fy([100], [100])), null);        // nur 1 FY
  assert.strictEqual(k2Slope(fy([-1, -1], [100, 100])), null); // 0 gueltige (NI<=0)
  assert.strictEqual(k2Slope(null), null);
  assert.strictEqual(k2Slope({ annualNetIncome: null, annualOCF: null }), null);
});
