// tests/annual-spikes-q1-eichformen.test.js — Standalone-Runner (framework-los).
// Run: node tests/annual-spikes-q1-eichformen.test.js
//
// WOFUER (Master-Entscheid C2/ii, 06.09.2026 13:15): sechs RA7-Zeilen (30.08.) auf Tickern, die die
// 05.09.-Klassifikation SUSPECT nennt (KINV-A.ST, MFSL.BO, VPLAY-A.ST), bleiben im Bestand — aber NUR
// als Eich-Formen des Gleichfaktor-Detektors (Ratsbeschluss Q1 03.09.; tests/annual-spikes.test.js
// Q1-3 liest den Bestand als Eichmenge), nicht als bekannte Faelle. Der erste Entfernungs-Versuch
// (PR #293, geschlossen) faerbte Q1-3 rot; die Eichmenge als eingefrorenes Fixture zu fuehren ist
// Gerichtspunkt. Gepinnt wird die SACHE: E1 die sechs Signaturen stehen im Bestand (Eichmenge
// unveraendert), E2 der hinweis markiert sie als Eich-Formen mit Klassifikations-Beleg, E3 die
// HEUTIGEN CI-Funde der drei Ticker (Artefakt 33967836117) sind NICHT bekannt — die Zeilen verankern
// kein JA-Ereignis (istBekannt trifft nur die exakten 30.08.-Floats, die per FX-Drift tot sind), E4 der
// Bestand ist konsistent. Sabotage-Nachweis (Anker 06.09. N33): Markierung aus dem hinweis -> E2 rot;
// eine Eich-Zeile entfernt -> E1 rot.
'use strict';
const assert = require('assert');
const path = require('path');
const W = require('../scripts/watch-annual-spikes.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}
const b = require(path.join('..', 'data-health', 'annual-spikes-baseline.json'));
const bestand = new Set(b.faelle);
const EICH = [
  'KINV-A.ST|annualOpInc|werte:2296750.789494|93467771.259408|0',
  'KINV-A.ST|annualRev|werte:2405050.2|97875086.4|0',
  'MFSL.BO|annualOpInc|werte:77576.68814918402|224906349.31044692|280926.029286504',
  'MFSL.BO|annualRev|werte:1686816.4416000003|4890331578.831201|6108415.5096',
  'VPLAY-A.ST|annualNetIncome|werte:11084144.4|-1019218447.8000001|33775270.2',
  'VPLAY-A.ST|annualOpInc|werte:-58348609.2|1074534602.4|43186336.2',
];
const reihe = (werte) => werte.map((value) => ({ value }));
const CI = [
  ['KINV-A.ST', 'annualOpInc', [0, 2289076.6792231, 93155468.3370792, 0]],
  ['MFSL.BO', 'annualOpInc', [78293.278556388, 226983851.4090826, 283520.9956678155, 151851858.7338082]],
  ['VPLAY-A.ST', 'annualNetIncome', [-132148436.68, 11047109.06, -1015812943.47, 33662417.23]],
  ['VPLAY-A.ST', 'annualOpInc', [-50649952.86, -58153649.58, 1070944270.76, 43042038.13]],
];

check('E1: die sechs Eich-Formen stehen unveraendert im Bestand (Q1-Eichmenge intakt)', () => {
  const fehlt = EICH.filter((k) => !bestand.has(k));
  assert.deepStrictEqual(fehlt, [], 'Eich-Formen fehlen: ' + fehlt.join(', '));
});
check('E2: der hinweis markiert sie als Eich-Formen, SUSPECT laut Klassifikation, NICHT als bekannte Faelle', () => {
  assert.ok(b.hinweis.includes('Master-Entscheid C2/ii'), 'C2/ii-Vermerk fehlt');
  assert.ok(b.hinweis.includes('NUR als Eich-Formen des Gleichfaktor-Detektors'), 'Eich-Form-Markierung fehlt');
  assert.ok(b.hinweis.includes('ja-klassifikation-2026-09-05.md'), 'Klassifikations-Beleg fehlt');
  for (const t of ['KINV-A.ST', 'MFSL.BO', 'VPLAY-A.ST']) assert.ok(b.hinweis.includes(t), t + ' nicht genannt');
});
check('E3: die heutigen CI-Funde der drei Ticker sind NICHT bekannt — die Eich-Zeilen verankern kein JA-Ereignis', () => {
  for (const [t, r, werte] of CI) {
    const f = W.findeAusreisser(reihe(werte)).map((h) => ({ ticker: t, reihe: r, ...h }));
    assert.strictEqual(f.length, 1, t + '|' + r + ': ' + f.length + ' Funde');
    assert.strictEqual(W.istBekannt(f[0], bestand, W.fundeJeReihe(f, bestand)), false, t + '|' + r + ' faelschlich bekannt');
  }
});
check('E4: Bestand konsistent (anzahl == faelle.length, keine Duplikate, sortiert) — nur der hinweis wurde angefasst', () => {
  assert.strictEqual(b.anzahl, b.faelle.length);
  assert.strictEqual(new Set(b.faelle).size, b.faelle.length);
  assert.deepStrictEqual(b.faelle, [...b.faelle].sort());
  assert.strictEqual(b.faelle.length, 155);
});

if (fail) { console.log('FAIL: annual-spikes-q1-eichformen (' + fail + ')'); process.exit(1); }
console.log('OK: annual-spikes-q1-eichformen (C2/ii, 06.09.2026)');
