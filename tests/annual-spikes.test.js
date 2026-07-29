'use strict';
/**
 * Waechter fuer den Ausreisser-Waechter (29.07., Anlass Cigna).
 *
 * DIE SACHE: Wird ein Jahr erkannt, das von BEIDEN Nachbarn um Groessenordnungen
 * abweicht? Und — genauso wichtig — bleibt eine normale Reihe unauffaellig? Ein
 * Detektor, der alles meldet, ist so wertlos wie einer, der nichts meldet. Beide
 * Richtungen werden hier geprueft.
 *
 * Usage: node tests/annual-spikes.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { findeAusreisser } = require('../scripts/watch-annual-spikes.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
const reihe = (...zahlen) => zahlen.map((v) => (v === null ? null : { value: v * 1e6 }));

check('der echte Cigna-Fall wird gefunden', () => {
  // Reihenfolge wie im Store (neueste zuerst): null, 8.444, -88.600, 7.295, 15.570 Mio
  const t = findeAusreisser(reihe(null, 8444, -88600, 7295, 15570));
  assert.equal(t.length, 1, 'genau ein Ausreisser erwartet');
  assert.equal(t[0].index, 2);
  assert.equal(t[0].wert, -88600e6);
});

check('eine normale Reihe bleibt still — auch bei kraeftigem Wachstum', () => {
  assert.deepEqual(findeAusreisser(reihe(1200, 900, 700, 500, 380)), []);
  // Verdopplung je Jahr: schnell, aber kein Ausreisser.
  assert.deepEqual(findeAusreisser(reihe(1600, 800, 400, 200, 100)), []);
  // Ein Verlustjahr in normaler Groessenordnung ist kein Ausreisser.
  assert.deepEqual(findeAusreisser(reihe(500, -300, 400, 450, 480)), []);
});

check('Raender werden NICHT beurteilt — ohne zweiten Nachbarn waere es geraten', () => {
  assert.deepEqual(findeAusreisser(reihe(-99000, 700, 800, 900)), []);
  assert.deepEqual(findeAusreisser(reihe(700, 800, 900, -99000)), []);
});

check('Luecken brechen die Pruefung nicht und erzeugen keinen Treffer', () => {
  assert.deepEqual(findeAusreisser(reihe(700, null, -99000, null, 900)), []);
  assert.deepEqual(findeAusreisser([]), []);
  assert.deepEqual(findeAusreisser(null), []);
  assert.deepEqual(findeAusreisser(undefined), []);
});

check('winzige Betraege loesen nichts aus, auch wenn das Verhaeltnis gross ist', () => {
  // 8 Mio gegen 0,5 Mio ist Faktor 16 — aber unter der Betragsschwelle.
  assert.deepEqual(findeAusreisser(reihe(0.4, 8, 0.5, 0.6)), []);
});

check('die Schwelle ist einstellbar und wirkt', () => {
  const r = reihe(100, 500, 100, 100);
  assert.equal(findeAusreisser(r, 8).length, 0, 'Faktor 5 liegt unter der Standardschwelle 8');
  assert.equal(findeAusreisser(r, 4).length, 1, 'mit Faktor 4 muss derselbe Punkt auffliegen');
});

// --- Populations-Wache (Fund 29.07.2026) -----------------------------------
// Die Wache klagt die BASIS an, wenn sie auf einer anderen Population aufgenommen
// wurde. Geprueft wird beides: dass sie feuert UND dass sie schweigt — eine Wache,
// die immer feuert, ist genauso wertlos wie eine, die nie feuert.
const { basisGueltig, POP_TOLERANZ } = require('../scripts/watch-annual-spikes.js');
const basisMit = (n) => ({ faelle: ['A|annualRev|1'], snapshotsBeiAufnahme: n });

check('gleiche Population -> Basis gilt, es wird normal geprueft', () => {
  assert.equal(basisGueltig(basisMit(12000), 12000).ok, true);
  assert.equal(basisGueltig(basisMit(12000), 13000).ok, true, '8 % Wachstum ist Alltag');
});

check('andere Population -> die BASIS wird angeklagt, nicht die Funde', () => {
  const r = basisGueltig(basisMit(4768), 12482);
  assert.equal(r.ok, false);
  assert.match(r.grund, /UNGUELTIG, nicht die Funde/,
    'die Meldung muss auf die Basis zeigen — sonst untersucht der Leser die falschen Zahlen');
  assert.match(r.grund, /4768/, 'die Aufnahme-Zahl gehoert in die Meldung');
  assert.match(r.grund, /12482/, 'die heutige Zahl gehoert in die Meldung');
  // auch der umgekehrte Fall: Population geschrumpft
  assert.equal(basisGueltig(basisMit(12482), 4768).ok, false);
});

check('die Toleranzgrenze wirkt in BEIDE Richtungen', () => {
  const n = 10000, knappDrunter = Math.round(n * (1 + POP_TOLERANZ * 0.9));
  const knappDrueber = Math.round(n * (1 + POP_TOLERANZ * 1.1));
  assert.equal(basisGueltig(basisMit(n), knappDrunter).ok, true, 'knapp innerhalb muss durchgehen');
  assert.equal(basisGueltig(basisMit(n), knappDrueber).ok, false, 'knapp ausserhalb muss auffliegen');
});

check('Basis ohne Populationsangabe ist ungueltig — Schweigen waere hier das Schlimmste', () => {
  const r = basisGueltig({ faelle: ['A|annualRev|1'] }, 12482);
  assert.equal(r.ok, false);
  assert.match(r.grund, /snapshotsBeiAufnahme/);
});

check('Erstlauf ohne Basis wird NICHT angeklagt', () => {
  assert.equal(basisGueltig({}, 12482).ok, true);
  assert.equal(basisGueltig(null, 12482).ok, true);
});

console.log('\nannual-spikes: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
