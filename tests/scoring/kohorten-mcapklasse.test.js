/**
 * Kohorten-Umbau (Karl-Entscheid 02.08., Punkt 1+2): die absolute Groessenklasse muss die
 * Ausgabe-Zeile erreichen — sie ist die Grundlage der fuenf Kohorten-Reiter in findash.
 *
 * WARUM ES DIESEN TEST GIBT: mcapKlasse wurde am 27.07. eingebaut (score.js:1205) und steht
 * seither im Writer-Feldkatalog (write-findash-export.js ROW_FIELDS) und in der Schema-Doku.
 * Trotzdem war sie in JEDEM ausgelieferten Export null — auf allen 200 Zeilen des Stands vom
 * 29.07., den Karl sieht, und auch im aelteren Lauf vom 21.07. Die Ursache lag nicht dort, wo
 * man sie sucht: rowMeta() in score.js:1314 spreadet die Anzeige-Felder an jede Ausgabe-Zeile
 * und fuehrte mcapBand, aber nicht mcapKlasse. Der Wert wurde also berechnet und danach
 * weggeworfen; der Writer las ein Feld, das es auf dem Objekt nie gab, und schrieb pflichtgemaess
 * null. Ein Feld, das immer null ist, sieht aus wie "keine Daten" und nicht wie ein Bug —
 * deshalb prueft dieser Test den WERT, nicht die Anwesenheit.
 */
const assert = require('node:assert/strict');
const { produceRankings, mcapKlasseOf } = require('../../src/scoring/score.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

// Minimale Ergebniszeile, wie scoreUniverse sie an produceRankings uebergibt.
function zeile(ticker, score, marketCap, action = 'route') {
  return {
    ticker, action, score, track: 'profitable', formulaId: 'software', lamps: [],
    overview: { kind: 'gp', value: 1, companion: 1 },
    name: ticker, country: 'United States', region: 'US', sector: 'Technology',
    marketCap, phase: 'inflected',
    mcapBand: 'large', mcapKlasse: mcapKlasseOf(marketCap),
    ipoRecency: 'seasoned', profitTier: 'langfristig-profitabel', ipoYear: 2010,
    coverageAxes: '7/7', coverageWeight: 1, cohortN: 100, cohortFallback: false,
    revGrowthYoYPct: 30, profitStreak: 4,
  };
}

test('die absolute Groessenklasse erreicht die Board-Zeile (nicht null)', () => {
  const r = produceRankings([zeile('NVDA', 90, 5010e9), zeile('CRDO', 88, 39.75e9)], { topN: 10 });
  // Struktur nachgesehen, nicht geraten: produceRankings liefert branches.<formel>.<track> als
  // Array — also zwei Ebenen, nicht eine, und `branches` heisst es, nicht `boards`.
  const alle = [];
  for (const perTrack of Object.values(r.branches || {})) {
    for (const liste of Object.values(perTrack || {})) if (Array.isArray(liste)) alle.push(...liste);
  }
  assert.ok(alle.length >= 2, 'keine Board-Zeilen erzeugt');
  const nvda = alle.find((x) => x.ticker === 'NVDA');
  const crdo = alle.find((x) => x.ticker === 'CRDO');
  assert.equal(nvda.mcapKlasse, 'mega', 'NVIDIA muss als Mega Cap in der Zeile stehen');
  assert.equal(crdo.mcapKlasse, 'large', 'CRDO muss als Large Cap in der Zeile stehen');
});

test('die absolute Groessenklasse erreicht auch die Uebersichts-Zeile', () => {
  const r = produceRankings([zeile('NVDA', 90, 5010e9), zeile('CRDO', 88, 39.75e9)], { topN: 10 });
  assert.ok(r.overview.length >= 2, 'keine Uebersichts-Zeilen erzeugt');
  for (const row of r.overview) {
    assert.ok('mcapKlasse' in row, 'Uebersichts-Zeile ohne mcapKlasse-Feld');
    assert.equal(row.mcapKlasse, mcapKlasseOf(row.marketCap),
      row.ticker + ': mcapKlasse passt nicht zur Marktkapitalisierung');
  }
});

test('fuenf Kohorten sind aus der Ausgabe unterscheidbar — sonst gibt es keine Reiter', () => {
  // Der eigentliche Zweck: findash baut die Reiter aus diesem Feld. Sind alle Zeilen null,
  // faellt jede Zeile in denselben Topf und die Kohorten-Ansicht ist leer.
  const proben = [['MICRO', 150e6], ['SMALL', 1e9], ['MID', 5e9], ['LARGE', 50e9], ['MEGA', 3000e9]];
  const r = produceRankings(proben.map(([t, mc], i) => zeile(t, 90 - i, mc)), { topN: 10 });
  const klassen = new Set(r.overview.map((x) => x.mcapKlasse));
  assert.deepEqual([...klassen].sort(), ['large', 'mega', 'micro', 'mid', 'small'],
    'nicht alle fuenf Groessenklassen kommen in der Ausgabe an: ' + JSON.stringify([...klassen]));
});

test('kein Marktwert erfindet keine Klasse', () => {
  // Gegenprobe zum Fix: er darf nicht dadurch "gruen" werden, dass er irgendetwas hinschreibt.
  const r = produceRankings([zeile('OHNE', 90, null), zeile('KAPUTT', 89, 0)], { topN: 10 });
  for (const row of r.overview) assert.equal(row.mcapKlasse, null, row.ticker + ': Klasse erfunden');
});

console.log(`\nkohorten-mcapklasse: ${pass} ok, ${fail} fail`);
if (fail > 0) process.exit(1);
