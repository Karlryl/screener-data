'use strict';
/**
 * Waechter fuer die Anteilsklassen-Regel im Issuer-Schluessel (Tag 467).
 *
 * DER FEHLER, DEN ES GAB: Im ausgelieferten Board stand Palantir auf Rang 19 UND 20, AppLovin
 * auf 13 UND 14, Carvana auf 175 UND 176 — vier doppelt belegte Plaetze in Karls 200er-Listen.
 * Ursache: Yahoo haengt je nach Boersenplatz eine Anteilsklasse an den Firmennamen
 * ("Palantir Technologies Inc. Class A" in Zuerich gegen "Palantir Technologies Inc." in
 * New York). Fuer den Issuer-Schluessel waren das zwei Firmen.
 *
 * WARUM ES NIEMAND SAH: die naechtliche Pruefung "0 Doppelnennungen" gruppierte mit demselben
 * Schluessel, den der Fehler betrifft. Sie konnte gar nichts anderes melden. Dieser Test
 * arbeitet deshalb mit AUSGESCHRIEBENEN Namenspaaren statt mit dem Schluessel selbst.
 *
 * GEGENPROBE (durchgefuehrt): die Regel entfernt -> die vier realen Paare zerfallen wieder in
 * je zwei Emittenten, der Test wird rot.
 */
const assert = require('node:assert/strict');
const { issuerKeyLoose } = require('../../src/scoring/score.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
const key = (name) => issuerKeyLoose({ meta: { name } });

test('die vier real doppelt gelisteten Firmen sind EIN Emittent', () => {
  // Genau die Paare, die am 27.07. im ausgelieferten Board doppelt standen.
  const paare = [
    ['Palantir Technologies Inc.', 'Palantir Technologies Inc. Class A'],
    ['AppLovin Corporation', 'AppLovin Corp. Class A'],
    ['Carvana Co.', 'Carvana Co. Class A'],
    ['Alphabet Inc.', 'Alphabet Inc. Class A'],
  ];
  assert.ok(paare.length > 0, 'darf nicht ins Leere laufen');
  for (const [a, b] of paare) {
    assert.equal(key(a), key(b), `"${a}" und "${b}" muessen derselbe Emittent sein`);
  }
});

test('auch die selteneren Klassen-Buchstaben greifen', () => {
  // Am CI-Bestand vorgefunden: Class B, Class N (Prosus), Class P (Kinder Morgan),
  // Class R (Stora Enso).
  assert.equal(key('NIKE, Inc.'), key('NIKE, Inc. Class B'));
  assert.equal(key('Prosus N.V.'), key('Prosus N.V. Class N'));
  assert.equal(key('Kinder Morgan, Inc.'), key('Kinder Morgan Inc Class P'));
  assert.equal(key('Stora Enso Oyj'), key('Stora Enso Oyj Class R'));
});

test('"Class" als echtes Namenswort wird NICHT abgeschnitten', () => {
  // Der gefaehrliche Fall: zwei verschiedene Firmen zu einer verschmelzen ist schlimmer als
  // eine Doppelung stehen zu lassen — die eine Firma verschwindet dann aus dem Board.
  assert.notEqual(key('World Class Extractions Inc.'), key('World Extractions Inc.'));
  assert.notEqual(key('First Class Holding AG'), key('First Holding AG'));
  assert.notEqual(key('Series Entertainment Ltd.'), key('Entertainment Ltd.'));
  // Und die Namen bleiben ueberhaupt unterscheidbar:
  assert.notEqual(key('World Class Extractions Inc.'), key('First Class Holding AG'));
});

test('verschiedene Firmen bleiben verschieden', () => {
  // Negativ-Kontrolle: waere die Normalisierung zu grob, wuerde hier etwas verschmelzen.
  assert.notEqual(key('Graham Corporation'), key('Graham Holdings Company'));
  assert.notEqual(key('Metro Inc.'), key('Metro AG'));
  assert.notEqual(key('Heineken N.V.'), key('Heineken Holding N.V.'));
  assert.notEqual(key('Interparfums Inc.'), key('Interparfums SA'));
});

test('Mehrklassen-Firmen mit ZWEI US-Notierungen bleiben trotzdem EIN Emittent', () => {
  // Tag 469, vom Live-Universum-Gate gefangen: bei zwei US-Primaerlistings faellt der Dedup
  // auf den strengen Schluessel zurueck (Schutz gegen Fehlverschmelzung). Fuehrt eine der
  // beiden Notierungen die Anteilsklasse IM NAMEN, trennte der Rueckfall sie wieder — und
  // BEIDE standen im Board. Am CI-Bestand waren es sieben Faelle.
  const { issuerDedupGroups } = require('../../src/scoring/score.js');
  const { isUsPrimaryListing } = require('../../src/scoring/router.js');
  // ⚠ Das Feld heisst exchangeName, NICHT exchange — die erste Fassung dieses Tests setzte das
  // falsche Feld, isUsPrimaryListing lieferte fuer alle Beine false, der Rueckfallpfad wurde nie
  // betreten und der Test war gruen, ohne irgendetwas zu pruefen. Gefunden hat das nur die
  // Gegenprobe. Deshalb steht die Vorbedingung jetzt als eigene Zusicherung darunter.
  const bein = (ticker, name, exchangeName) => ({
    ticker,
    snapshot: { meta: { name, exchangeName, ticker, country: 'United States', currency: 'USD' } },
  });
  const beine = [
    bein('FOX', 'Fox Corporation', 'NasdaqGS'),
    bein('FOXA', 'Fox Corporation', 'NasdaqGS'),
    bein('1FOXA.MI', 'Fox Corporation Class A', 'Milan'),
  ];
  const usPrimaer = beine.filter((b) => isUsPrimaryListing(b.snapshot.meta)).length;
  assert.equal(usPrimaer, 2, 'Vorbedingung: genau zwei US-Primaerlistings — sonst wird der Rueckfallpfad gar nicht betreten und der Test prueft nichts');

  const gruppen = issuerDedupGroups(beine);
  assert.equal(gruppen.length, 1, `Fox darf nicht aufgeteilt werden, wurde aber zu ${gruppen.length} Gruppen`);
  assert.equal(gruppen[0].length, 3);
});

test('die Regel greift WIRKLICH — sonst waeren die Tests oben wertlos', () => {
  // Ohne Zusatz muss der Schluessel unveraendert bleiben, MIT Zusatz muss er sich aendern.
  const ohne = key('Palantir Technologies Inc.');
  const mit = key('Palantir Technologies Inc. Class A');
  const roh = 'Palantir Technologies Inc. Class A'.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
  assert.equal(ohne, mit, 'Regel greift nicht');
  assert.notEqual(mit, roh, 'der Zusatz muesste im Schluessel verschwunden sein');
});

console.log(`\nissuer-gattung: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
