'use strict';
/** tests/druckenmiller/universe.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG: U ist genau das, was Rat-Entscheid D4 (2026-09-14) eingefroren hat —
 *   country === "United States"  UND  Ticker ohne "."  UND  keine Daten-Verdachts-Lampe
 *   UND >= 250 Balken —
 * und jede Umdefinition faellt auf, weil der Tages-Hash der Mitgliederliste mitlaeuft.
 *
 * F-16 (gesperrte Klasse bis Ende Oktober): der Suffix-Test ist ein REINER STRING-TEST.
 * Kein Boersen-Mapping, keine Notierungs-Identitaet. Der Waechter dagegen steht in
 * f16-guard.test.js und liest den Quelltext selbst.
 */
const assert = require('node:assert/strict');
const U = require('../lib/druckenmiller/universe.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}

const meta = (extra) => Object.assign({ ticker: 'AAA', country: 'United States', sector: 'Industrials' }, extra || {});

test('U1 die vier Bedingungen von D4 — jede einzeln lehnt ab', () => {
  assert.equal(U.candidateReason(meta(), 250), null, 'der gute Fall muss durchgehen');
  assert.equal(U.candidateReason(meta({ country: 'Germany' }), 250), 'country');
  assert.equal(U.candidateReason(meta({ ticker: 'GS.VI' }), 250), 'suffix');
  assert.equal(U.candidateReason(meta({ _newestQtrSuspect: true }), 250), 'suspect');
  assert.equal(U.candidateReason(meta({ _annualCurrencyLeakSuspect: true }), 250), 'suspect');
  assert.equal(U.candidateReason(meta(), 249), 'bars');
});

test('U2 der Suffix-Test ist ein reiner String-Test (kein Boersen-Wissen)', () => {
  assert.equal(U.hasSuffix('BRK.B'), true);
  assert.equal(U.hasSuffix('7203.T'), true);
  assert.equal(U.hasSuffix('AAPL'), false);
  assert.equal(U.hasSuffix('BRK-B'), false, 'ein Bindestrich ist KEIN Suffix — D4 nennt nur den Punkt');
});

test('U3 universeHash haengt an der MENGE, nicht an der Reihenfolge', () => {
  const a = U.universeHash(['AAA', 'BBB', 'CCC']);
  const b = U.universeHash(['CCC', 'AAA', 'BBB']);
  assert.equal(a, b);
  assert.notEqual(a, U.universeHash(['AAA', 'BBB']), 'ein Mitglied weniger MUSS den Hash aendern');
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('U4 Sektor-Klassen sind eingefroren (Rat D3), Rest ist sichtbar "nicht zugeordnet"', () => {
  assert.equal(U.sectorClass('Industrials'), 'cyclical');
  assert.equal(U.sectorClass('Energy'), 'cyclical');
  assert.equal(U.sectorClass('Healthcare'), 'defensive');
  assert.equal(U.sectorClass('Utilities'), 'defensive');
  assert.equal(U.sectorClass('Technology'), 'unassigned');
  assert.equal(U.sectorClass('Real Estate'), 'unassigned');
  assert.equal(U.sectorClass(null), 'unassigned');
  // Gegenprobe gegen ein stilles Umsortieren: die beiden Listen ueberschneiden sich nie.
  for (const s of U.CYCLICAL_SECTORS) assert.ok(!U.DEFENSIVE_SECTORS.includes(s));
});

test('U5 L4b-Korb: seine namentlich genannten Branchen, sonst nichts', () => {
  assert.equal(U.inNamedBasket('Trucking'), true);
  assert.equal(U.inNamedBasket('Specialty Retail'), true);
  assert.equal(U.inNamedBasket('Department Stores'), true);
  assert.equal(U.inNamedBasket('Residential Construction'), true);
  assert.equal(U.inNamedBasket('Software - Application'), false);
  assert.equal(U.inNamedBasket(null), false);
});

test('U6 Revisions-Breite liest +1y 30 Tage netto; ohne Abdeckung -> null', () => {
  assert.equal(U.netRevision30({ '+1y': { upLast30Days: 8, downLast30Days: 1 } }), 7);
  assert.equal(U.netRevision30({ '+1y': { upLast30Days: 0, downLast30Days: 0 } }), 0);
  assert.equal(U.netRevision30({ '+1y': { upLast30Days: null, downLast30Days: null } }), null);
  assert.equal(U.netRevision30({}), null);
  assert.equal(U.netRevision30(null), null);
});

test('U7 Kandidaten-Sammler ueberspringt Mehrpunkt-Dateinamen, ohne sie zu parsen', () => {
  // Der billige Vorfilter darf nichts durchlassen, was der echte Test verwerfen wuerde,
  // und nichts verwerfen, was er behalten wuerde.
  assert.equal(U.filenameMayBeCandidate('AAPL.json'), true);
  assert.equal(U.filenameMayBeCandidate('GS.VI.json'), false);
  assert.equal(U.filenameMayBeCandidate('_manifest.json'), false);
  assert.equal(U.filenameMayBeCandidate('AAPL.txt'), false);
});

test('U8 marketCap wird aus BEIDEN Formen gelesen (Snapshot-Objekt und blanke Zahl)', () => {
  // Gefunden beim ersten echten Lauf: der Snapshot fuehrt marketCap als Objekt. Ein
  // blanker Zahl-Test liess L4cw und L8 still auf null stehen — kein Fehler, kein Wert.
  assert.equal(U.marketCapValue({ value: 4665759498240, source: 'yahoo', confidence: 0.9 }), 4665759498240);
  assert.equal(U.marketCapValue(2093783616), 2093783616);
  assert.equal(U.marketCapValue({ value: null }), null);
  assert.equal(U.marketCapValue(undefined), null);
  assert.equal(U.marketCapValue({ wert: 5 }), null, 'ein fremdes Feld wird nicht erraten');
});

console.log('\nuniverse.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
