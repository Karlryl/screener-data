// tests/annual-spikes-a-belege-20260906.test.js — Standalone-Runner (framework-los).
// Run: node tests/annual-spikes-a-belege-20260906.test.js
//
// WOFUER: Weg C (Master-Brief 20260906, Worker 3): fuenf der 30 NEUEN Jahres-Ausreisser aus Run
// 33951123754 wurden am 06.09.2026 an unabhaengigen Primaerquellen als reale Sonderjahre belegt
// (Grad A) und je Fall in data-health/annual-spikes-baseline.json verankert - Belegtexte im
// hinweis-Feld. Gepinnt wird die SACHE: die CI-Reihen (Snapshots-Artefakt des Laufs 33967836117)
// laufen durch findeAusreisser() + istBekannt() und muessen bekannt sein; eine gedriftete Reihe
// (FX-Neuabruf) darf es NICHT sein (JA-7-Preis, absichtlich laut); die vier SUSPECT-Faelle sind
// NICHT verankert. Sabotage-Nachweis (Anker 06.09. N3): Eintrag 1VIV.MI entfernt -> A1 rot.
'use strict';
const assert = require('assert');
const path = require('path');
const W = require('../scripts/watch-annual-spikes.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}
const reihe = (werte) => werte.map((value) => ({ value }));
// annualNetIncome-Reihen exakt wie im CI-Snapshot (Artefakt "snapshots", Run 33967836117).
const CI = {
  '1VIV.MI': [23258519.999999996, -6982207703.999999, 470985029.99999994, -1174555260],
  '4005.T': [389891123.552, 246874962.656, -1994895043.008, 44697348.192],
  'SOMMF': [389891123.552, 246874962.656, -1994895043.008, 44697348.192],
  'ASTERDM.BO': [41092581.692099996, 569353631.6824499, 13686940.1792, 44985440.52865],
  'OCI.AS': [183700000, 4978800000, -392000000, 1237400000],
  'SESG.PA': [-109966433, 17363121, -1047574967, -39356407.6],
  'SGBAF': [-109966433, 17363121, -1047574967, -39356407.6],
};
const ERWARTET_INDEX = { '1VIV.MI': 1, '4005.T': 2, 'SOMMF': 2, 'ASTERDM.BO': 1, 'OCI.AS': 1, 'SESG.PA': 2, 'SGBAF': 2 };
const b = require(path.join('..', 'data-health', 'annual-spikes-baseline.json'));
const bestand = new Set(b.faelle);
const funde = (ticker, werte) => W.findeAusreisser(reihe(werte)).map((h) => ({ ticker, reihe: 'annualNetIncome', ...h }));

check('A1: jede der 7 CI-Zeilen ergibt genau EINEN Fund am erwarteten Index und ist im Bestand bekannt', () => {
  for (const [t, werte] of Object.entries(CI)) {
    const f = funde(t, werte);
    assert.strictEqual(f.length, 1, t + ': ' + f.length + ' Funde');
    assert.strictEqual(f[0].index, ERWARTET_INDEX[t], t + ' Index');
    assert.ok(bestand.has(W.stabilerSchluessel(f[0])), t + ' Signatur fehlt im Bestand');
    assert.strictEqual(W.istBekannt(f[0], bestand, W.fundeJeReihe(f, bestand)), true, t + ' nicht bekannt');
  }
});
check('A2: eine um 0,1 % gedriftete Reihe (FX-Neuabruf) ist NICHT bekannt - der Preis aus JA-7 bleibt laut', () => {
  const drift = CI['1VIV.MI'].map((v) => v * 1.001);
  const f = funde('1VIV.MI', drift);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(W.istBekannt(f[0], bestand, W.fundeJeReihe(f, bestand)), false);
});
// Die vier SUSPECT-Faelle vom 05.09., Reihen exakt wie im CI-Snapshot desselben Laufs. Gepinnt wird
// der heutige FUND (Signatur), nicht der Ticker: VPLAY-A.ST traegt seit RA7 (30.08.) zwei aeltere,
// per FX gedriftete Signaturen im Bestand - genau der JA-7-Preis; die heutigen Werte sind NICHT bekannt.
const SUSPECT = [
  ['BANPU.BK', 'annualOpInc', [2486881000, -28259000, 6003496000, 524803000]],
  ['KINV-A.ST', 'annualOpInc', [0, 2289076.6792231, 93155468.3370792, 0]],
  ['MFSL.BO', 'annualOpInc', [78293.278556388, 226983851.4090826, 283520.9956678155, 151851858.7338082]],
  ['VPLAY-A.ST', 'annualNetIncome', [-132148436.68, 11047109.06, -1015812943.47, 33662417.23]],
  ['VPLAY-A.ST', 'annualOpInc', [-50649952.86, -58153649.58, 1070944270.76, 43042038.13]],
];
check('A3: die SUSPECT-Funde vom 05.09. sind NICHT verankert (istBekannt false); BANPU.BK bleibt gesperrt, nicht bekannt', () => {
  const gesperrt = new Set((b.ausgeschlossen || []).map((a) => a && a.sperrschluessel));
  for (const [t, r, werte] of SUSPECT) {
    const f = W.findeAusreisser(reihe(werte)).map((h) => ({ ticker: t, reihe: r, ...h }));
    assert.strictEqual(f.length, 1, t + '|' + r + ': ' + f.length + ' Funde');
    assert.strictEqual(W.istBekannt(f[0], bestand, W.fundeJeReihe(f, bestand)), false, t + '|' + r + ' verankert');
    assert.strictEqual(gesperrt.has(W.sperrSchluessel(f[0])), t === 'BANPU.BK', t + '|' + r + ' Sperre');
  }
});
check('A4: Bestand konsistent - anzahl == faelle.length, keine Duplikate, sortiert, hinweis nennt den 06.09.-Beleg', () => {
  assert.strictEqual(b.anzahl, b.faelle.length);
  assert.strictEqual(new Set(b.faelle).size, b.faelle.length);
  assert.deepStrictEqual(b.faelle, [...b.faelle].sort());
  assert.ok(b.hinweis.includes('2026-09-06 (Weg C, Grad A'), 'Belegtext fehlt');
  for (const t of Object.keys(CI)) assert.ok(b.hinweis.includes(t), 'hinweis ohne ' + t);
});

if (fail) { console.log('FAIL: annual-spikes-a-belege-20260906 (' + fail + ')'); process.exit(1); }
console.log('OK: annual-spikes-a-belege-20260906 (Weg C, Grad A, 06.09.2026)');
