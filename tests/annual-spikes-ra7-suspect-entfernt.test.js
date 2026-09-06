// tests/annual-spikes-ra7-suspect-entfernt.test.js — Standalone-Runner (framework-los).
// Run: node tests/annual-spikes-ra7-suspect-entfernt.test.js
//
// WOFUER (Master-Verdikt C2, 06.09.2026 13:00, Ratsbrief 06.09.): sechs RA7-Pauschalzeilen (30.08.)
// auf Tickern, die die 05.09.-Klassifikation als SUSPECT fuehrt (KINV-A.ST, MFSL.BO, VPLAY-A.ST),
// sind aus data-health/annual-spikes-baseline.json entfernt - ein Pauschalanker ohne Beleg widerspricht
// Weg C. Gepinnt wird die SACHE: S1 die sechs Signaturen fehlen; S2 die heutigen CI-Funde dieser
// Ticker (Artefakt 33967836117) sind NICHT bekannt (kein stilles Neu-Verankern: sie liefen am 05.09.
// schon als NEU, das Zaehlwerk aendert sich um 0); S3 Bestand konsistent, hinweis traegt den Beleg;
// S4 die 24 OPEN-Pauschalzeilen (C1 vertagt) sind NICHT mit entfernt worden (Stichprobe).
// Sabotage-Nachweis (Anker 06.09. N31): eine der sechs Zeilen wieder eingefuegt -> S1 rot.
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
const RAUS = [
  'KINV-A.ST|annualOpInc|werte:2296750.789494|93467771.259408|0',
  'KINV-A.ST|annualRev|werte:2405050.2|97875086.4|0',
  'MFSL.BO|annualOpInc|werte:77576.68814918402|224906349.31044692|280926.029286504',
  'MFSL.BO|annualRev|werte:1686816.4416000003|4890331578.831201|6108415.5096',
  'VPLAY-A.ST|annualNetIncome|werte:11084144.4|-1019218447.8000001|33775270.2',
  'VPLAY-A.ST|annualOpInc|werte:-58348609.2|1074534602.4|43186336.2',
];
const reihe = (werte) => werte.map((value) => ({ value }));
// Reihen exakt wie im CI-Snapshot (Artefakt 33967836117) - die heutigen Funde der drei Ticker.
const CI = [
  ['KINV-A.ST', 'annualOpInc', [0, 2289076.6792231, 93155468.3370792, 0]],
  ['MFSL.BO', 'annualOpInc', [78293.278556388, 226983851.4090826, 283520.9956678155, 151851858.7338082]],
  ['VPLAY-A.ST', 'annualNetIncome', [-132148436.68, 11047109.06, -1015812943.47, 33662417.23]],
  ['VPLAY-A.ST', 'annualOpInc', [-50649952.86, -58153649.58, 1070944270.76, 43042038.13]],
];

check('S1: die sechs RA7-Pauschalzeilen der SUSPECT-Ticker fehlen im Bestand', () => {
  const nochDa = RAUS.filter((k) => bestand.has(k));
  assert.deepStrictEqual(nochDa, [], 'noch im Bestand: ' + nochDa.join(', '));
  for (const t of ['KINV-A.ST', 'MFSL.BO', 'VPLAY-A.ST']) {
    const rest = b.faelle.filter((k) => k.startsWith(t + '|'));
    assert.deepStrictEqual(rest, [], t + ' traegt noch Zeilen: ' + rest.join(', '));
  }
});
check('S2: die heutigen CI-Funde der drei Ticker sind NICHT bekannt (sie zaehlen wie am 05.09. als NEU - Zaehlwerk-Aenderung 0)', () => {
  for (const [t, r, werte] of CI) {
    const f = W.findeAusreisser(reihe(werte)).map((h) => ({ ticker: t, reihe: r, ...h }));
    assert.strictEqual(f.length, 1, t + '|' + r + ': ' + f.length + ' Funde');
    assert.strictEqual(W.istBekannt(f[0], bestand, W.fundeJeReihe(f, bestand)), false, t + '|' + r + ' bekannt');
  }
});
check('S3: Bestand konsistent - anzahl == faelle.length, keine Duplikate, sortiert, hinweis nennt C2 mit Klassifikations-Beleg', () => {
  assert.strictEqual(b.anzahl, b.faelle.length);
  assert.strictEqual(new Set(b.faelle).size, b.faelle.length);
  assert.deepStrictEqual(b.faelle, [...b.faelle].sort());
  assert.ok(b.hinweis.includes('Master-Verdikt C2'), 'C2-Vermerk fehlt');
  assert.ok(b.hinweis.includes('ja-klassifikation-2026-09-05.md'), 'Klassifikations-Beleg fehlt');
});
check('S4: die 24 OPEN-Pauschalzeilen (C1 vertagt) sind NICHT mit entfernt (Stichprobe: 000815.SZ, GCP.L, VOGL.BO)', () => {
  for (const t of ['000815.SZ', 'GCP.L', 'VOGL.BO']) {
    assert.ok(b.faelle.some((k) => k.startsWith(t + '|')), t + ' faelschlich entfernt');
  }
  assert.strictEqual(b.faelle.length, 149, 'Bestand ist ' + b.faelle.length + ', erwartet 155 - 6 = 149');
});

if (fail) { console.log('FAIL: annual-spikes-ra7-suspect-entfernt (' + fail + ')'); process.exit(1); }
console.log('OK: annual-spikes-ra7-suspect-entfernt (C2, 06.09.2026)');
