'use strict';
/**
 * Waechter fuer die Kipp-Beobachtungsliste (scripts/f1-rekonstruktions-kipppunkte.js).
 *
 * DIE SACHE: Findet die Liste genau die Namen, deren Burn-Urteil am VORZEICHEN einer
 * Rekonstruktion haengt UND deren rekonstruierter Wert knapp an der Null liegt? Und —
 * genauso wichtig — bleibt sie still bei allen anderen? Eine Beobachtungsliste, die jeden
 * Rekonstruierer nennt, ist so wertlos wie eine, die niemanden nennt. Beide Richtungen
 * werden hier geprueft, an gebauten Snapshots ohne Datei-Zugriff.
 *
 * Usage: node tests/f1-kipppunkte.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { kippBefund, rekonstruierendePositionen, KIPP_BAND } = require('../scripts/f1-rekonstruktions-kipppunkte.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// annualOCF/FCF/OpInc sind {value}-Reihen, annualCapex ist skalar (FIELD_REGISTRY).
const wert = (xs) => xs.map((v) => ({ value: v }));
const snap = ({ ocf, fcf, capex, opInc, ticker = 'TEST' }) => ({
  meta: { ticker },
  annual: {
    annualOCF: wert(ocf), annualFCF: wert(fcf), annualCapex: capex, annualOpInc: wert(opInc),
    annualRev: wert([1000e6, 900e6]),
  },
});

check('rekonstruierendePositionen: nur wo OCF fehlt UND beide Ersatzteile da sind', () => {
  const s = snap({ ocf: [null, -50e6], fcf: [-30e6, -40e6], capex: [-20e6, -10e6], opInc: [-5e6, -4e6] });
  const r = rekonstruierendePositionen(s);
  assert.equal(r.length, 1, 'Position 1 hat ein echtes OCF und darf nicht mitgezaehlt werden');
  assert.equal(r[0].i, 0);
  assert.equal(r[0].wert, -10e6, 'FCF -30 minus Capex -20 = -10 Mio');
  // fehlendes Ersatzteil -> keine Rekonstruktion, kein Risiko
  assert.deepEqual(rekonstruierendePositionen(snap({ ocf: [null, null], fcf: [-30e6, -40e6], capex: [null, null], opInc: [-5e6, -4e6] })), []);
});

check('KIPP-KANDIDAT: Urteil haengt am Vorzeichen UND der Wert liegt knapp an der Null', () => {
  // Position 0 rekonstruiert: FCF -101, Capex -100 -> OCF -1 Mio. Skala 101 -> Abstand 0,0099.
  // Mit gedrehtem Vorzeichen (+1) faellt das Tor ocf[0] < 0 weg -> Urteil kippt von true auf false.
  const s = snap({ ocf: [null, -0.5e6], fcf: [-101e6, -0.5e6], capex: [-100e6, 0], opInc: [-9e6, -4e6] });
  const b = kippBefund(s);
  assert.ok(b, 'dieser Name MUSS auf die Liste');
  assert.equal(b.urteil, true);
  assert.equal(b.gegenUrteil, false, 'gedrehtes Vorzeichen muss das Urteil kippen');
  assert.equal(b.positionen[0].i, 0);
  assert.ok(b.positionen[0].abstand < KIPP_BAND, 'Abstand muss innerhalb der Bande liegen');
});

check('KEIN Kandidat: rekonstruiert, aber weit von der Null entfernt', () => {
  // FCF -300, Capex -10 -> OCF -290 Mio bei Skala 300 -> Abstand 0,967, weit ausserhalb der Bande.
  const s = snap({ ocf: [null, -50e6], fcf: [-300e6, -50e6], capex: [-10e6, 0], opInc: [-9e6, -4e6] });
  assert.equal(kippBefund(s), null);
});

check('KEIN Kandidat: gar keine Rekonstruktion (OCF liegt vor)', () => {
  const s = snap({ ocf: [-1e6, -50e6], fcf: [-101e6, -50e6], capex: [-100e6, 0], opInc: [-9e6, -4e6] });
  assert.equal(kippBefund(s), null);
});

check('KEIN Kandidat: Urteil steht auch mit gedrehtem Vorzeichen', () => {
  // opInc[0] >= 0 -> das Tor faellt ohnehin, egal welches Vorzeichen das OCF hat.
  const s = snap({ ocf: [null, -50e6], fcf: [-101e6, -50e6], capex: [-100e6, 0], opInc: [+9e6, -4e6] });
  assert.equal(kippBefund(s), null, 'wenn das Urteil nicht am Vorzeichen haengt, ist der Name nicht gefaehrdet');
});

check('KEIN Kandidat: nicht bewertbar (Position 1 fehlt komplett)', () => {
  const s = snap({ ocf: [null], fcf: [-101e6], capex: [-100e6], opInc: [-9e6] });
  assert.equal(kippBefund(s), null);
});

check('die Bande wirkt: derselbe Name faellt mit engerer Bande heraus', () => {
  const s = snap({ ocf: [null, -0.5e6], fcf: [-101e6, -0.5e6], capex: [-100e6, 0], opInc: [-9e6, -4e6] });
  assert.ok(kippBefund(s, 0.05), 'Abstand 0,0099 liegt unter 0,05');
  assert.equal(kippBefund(s, 0.005), null, 'unter 0,005 liegt er nicht mehr');
});

check('der Snapshot wird NICHT veraendert — die Gegenrechnung darf nicht zurueckschlagen', () => {
  const s = snap({ ocf: [null, -0.5e6], fcf: [-101e6, -0.5e6], capex: [-100e6, 0], opInc: [-9e6, -4e6] });
  const vorher = JSON.stringify(s);
  kippBefund(s);
  assert.equal(JSON.stringify(s), vorher, 'kippBefund muss rein lesend sein');
});

console.log('\nf1-kipppunkte: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
