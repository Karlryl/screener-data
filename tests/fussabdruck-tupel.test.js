'use strict';
/**
 * Waechter zum Fussabdruck-Tupel (Gerichtsauflage 1 vom 23.08., Fall Fussabdruck-Vertrag).
 *
 * Das Gericht hat den Vertrag unter anderem daran gekippt, dass sein Erwartungs-Tupel KEINE
 * hinreichende Statistik ist: Anzahl geaenderter Zeilen, groesstes |Delta| und ein Hash der
 * Ticker-Liste sind blind fuer Richtung und Verteilung. Am Artefakt reproduziert - diese drei
 * Faelle lieferten identisch `3 | 6,2 | 52f4f9a564339e7e`:
 *
 *     gewollt      {AAA:+6,2, BBB:+1,4, CCC:+0,3}
 *     UMGEKEHRT    {AAA:-6,2, BBB:-1,4, CCC:-0,3}      <- das Gegenteil der Absicht
 *     verteilt     {AAA:+6,2, BBB:+0,000001, CCC:+0,000001}
 *
 * Dieser Test ist der PRUEFSTEIN fuer den Retrial: die drei Faelle muessen drei VERSCHIEDENE
 * Tupel liefern. Er haengt an keinem Substrat und wird deshalb nie uebersprungen.
 *
 * Usage:  node --test tests/fussabdruck-tupel.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fussabdruck } = require('../scripts/fussabdruck.js');

const HASHES = { AAA: 'h', BBB: 'h', CCC: 'h', DDD: 'h' };
const BASIS = { AAA: 50, BBB: 50, CCC: 50, DDD: 50 };

const FAELLE = {
  gewollt: { AAA: 56.2, BBB: 51.4, CCC: 50.3, DDD: 50 },
  umgekehrt: { AAA: 43.8, BBB: 48.6, CCC: 49.7, DDD: 50 },
  andersVerteilt: { AAA: 56.2, BBB: 50.000001, CCC: 50.000001, DDD: 50 },
};

/** Das VOLLE Tupel, so wie der Vertrag es nach der Revision deklariert. */
const tupel = (f) => [f.zeilenMitScoreAenderung, f.maxAbsDelta, f.tickerListHash, f.deltaVektorHash].join(' | ');
/** Das ALTE Tupel - nur als Kontrast, um zu belegen, dass die Ergaenzung noetig war. */
const altesTupel = (f) => [f.zeilenMitScoreAenderung, f.maxAbsDelta, f.tickerListHash].join(' | ');

test('die drei Faelle des Urteils liefern DREI VERSCHIEDENE Tupel', () => {
  const t = Object.fromEntries(Object.entries(FAELLE)
    .map(([n, k]) => [n, tupel(fussabdruck(BASIS, k, HASHES))]));
  const verschieden = new Set(Object.values(t));
  assert.equal(verschieden.size, 3,
    'Der Fussabdruck unterscheidet die drei Faelle nicht:\n'
    + Object.entries(t).map(([n, v]) => `         ${n.padEnd(16)} ${v}`).join('\n')
    + '\n       Solange das so ist, besteht eine vollstaendige Umkehr der Score-Wirkung die '
    + 'Pruefung identisch - der tragende toedliche Punkt des Urteils vom 23.08.');
});

test('ohne den Delta-Vektor waeren sie ununterscheidbar (Beleg, dass die Ergaenzung traegt)', () => {
  const alt = new Set(Object.values(FAELLE).map((k) => altesTupel(fussabdruck(BASIS, k, HASHES))));
  assert.equal(alt.size, 1,
    'Der Kontrast-Beleg stimmt nicht mehr: das ALTE Tupel unterscheidet die Faelle bereits. '
    + 'Dann ist entweder der Fall falsch nachgebaut oder die Messung hat sich geaendert - '
    + 'in beiden Faellen ist die Begruendung der Revisionsauflage neu zu pruefen.');
});

test('eine reine Vorzeichen-Umkehr wird gefangen', () => {
  const a = fussabdruck(BASIS, FAELLE.gewollt, HASHES);
  const b = fussabdruck(BASIS, FAELLE.umgekehrt, HASHES);
  assert.equal(a.zeilenMitScoreAenderung, b.zeilenMitScoreAenderung, 'Aufbau falsch: gleiche Zeilenzahl erwartet');
  assert.equal(a.maxAbsDelta, b.maxAbsDelta, 'Aufbau falsch: gleiches Maximum erwartet');
  assert.equal(a.tickerListHash, b.tickerListHash, 'Aufbau falsch: gleiche Ticker erwartet');
  assert.notEqual(a.deltaVektorHash, b.deltaVektorHash,
    'Die Umkehr passiert den Vektor-Hash. Dann traegt er nicht, wofuer er eingefuehrt wurde.');
});

test('die bewegten Firmen stehen im Klartext, nicht nur als Hash', () => {
  const f = fussabdruck(BASIS, FAELLE.gewollt, HASHES);
  assert.deepEqual(f.bewegteTicker, ['AAA', 'BBB', 'CCC'],
    'Die Namen fehlen oder sind unsortiert - ein Reviewer muss sehen, WELCHE Firmen sich '
    + 'bewegen, sonst ist die Deklaration Selbstbestaetigung (Einwand E4 des Urteils).');
  assert.equal(f.bewegteTicker.length, f.zeilenMitScoreAenderung, 'Liste und Zaehler widersprechen sich');
});

test('der Vektor-Hash ist gegen Fliesskomma-Rauschen stabil', () => {
  // 56.2 - 50 ergibt in IEEE-754 6.199999999999999. Ohne Rundung zappelte der Hash bei
  // bit-gleicher Wirkung und das Gate meldete falsch-rot.
  const a = fussabdruck(BASIS, { AAA: 56.2, BBB: 51.4, CCC: 50.3, DDD: 50 }, HASHES);
  const b = fussabdruck({ AAA: 50.0, BBB: 50.0, CCC: 50.0, DDD: 50 },
    { AAA: 56.2, BBB: 51.4, CCC: 50.3, DDD: 50 }, HASHES);
  assert.equal(a.deltaVektorHash, b.deltaVektorHash, 'derselbe Delta-Vektor ergibt zwei Hashes');
});

test('die Reihenfolge der Eingabe aendert das Tupel nicht', () => {
  const vorwaerts = fussabdruck(BASIS, FAELLE.gewollt, HASHES);
  const rueckwaerts = fussabdruck(
    Object.fromEntries(Object.entries(BASIS).reverse()),
    Object.fromEntries(Object.entries(FAELLE.gewollt).reverse()), HASHES);
  assert.equal(rueckwaerts.deltaVektorHash, vorwaerts.deltaVektorHash, 'der Vektor-Hash haengt an der Reihenfolge');
  assert.deepEqual(rueckwaerts.bewegteTicker, vorwaerts.bewegteTicker, 'die Namensliste haengt an der Reihenfolge');
});
