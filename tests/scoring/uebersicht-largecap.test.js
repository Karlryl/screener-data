'use strict';
/**
 * Waechter fuer Karls Large-Cap-Regel in der Hypergrowth-Uebersicht (Tag 468).
 *
 * KARLS ANWEISUNG: "alles ueber der Large-Cap-Grenze geht in den anderen Screener."
 *
 * DIE DREI AUFLAGEN AUS RAT UND GERICHT, die dieser Test festnagelt:
 *   1. Der Filter greift NACH dem Scoren. Das Scoring ist kohorten-relativ — wer die Grossen
 *      vorher entfernt, verschiebt still die Scores aller anderen.
 *   2. Er greift NUR auf der Uebersicht. Die Branchen-Boards behalten alles, sonst
 *      verschwinden sieben Firmen aus jedem Board (gemessen am ausgelieferten Stand).
 *   3. Er ist optional. Der Quality-Compounder-Durchlauf ruft ohne ihn auf.
 *
 * GEGENPROBE (durchgefuehrt): Filter entfernt, Filter auf die Branchen ausgeweitet,
 * Filter auf fehlende Marktwerte losgelassen — jedes Mal rot.
 */
const assert = require('node:assert/strict');
const { produceRankings, MEGA_CAP_USD, mcapKlasseOf } = require('../../src/scoring/score.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const zeile = (ticker, score, marketCap) => ({
  ticker, action: 'route', score, track: 'profitable', formulaId: 'semiconductors',
  lamps: [], overview: { kind: 'gp', value: 0.5, companion: 100 }, marketCap,
});

// Vier kleine, zwei grosse — die Grossen stehen bewusst GANZ OBEN.
// ⚠ BIG2 stand hier urspruenglich auf 50 Mrd. Das war genau die Groessenordnung von ALAB
// (50,0 Mrd.) und CRDO (39,8 Mrd.) — den Firmen, die Karl in der Uebersicht SEHEN will.
// Seit der Korrektur vom 27.07. ist die Grenze die Mega-Cap-Schwelle; ein 50-Mrd-Wert ist
// jetzt korrekterweise KLEIN genug. Der Fall "gross" braucht deshalb echte Mega-Caps.
const results = [
  zeile('BIG1', 99, 900e9),
  zeile('BIG2', 98, 300e9),
  zeile('KLEIN1', 97, 5e9),
  zeile('KLEIN2', 96, 3e9),
  zeile('KLEIN3', 95, 1e9),
  // ⚠ ZWEI verschiedene Faelle, und nur einer ist gefaehrlich — das hat erst die Gegenprobe
  // gezeigt: fehlende Werte normalisiert rowMeta() ohnehin zu null, und Number(null) ist 0,
  // also harmlos klein. Ein KAPUTTER Wert kommt dagegen unveraendert durch: Number('kaputt')
  // ist NaN. Nur hier entscheidet sich, ob der Filter `!(NaN >= x)` rechnet (behaelt, richtig)
  // oder `NaN < x` (wirft raus, falsch). Ein Test mit null haette das nie geprueft.
  zeile('OHNEWERT', 94, null),
  zeile('KAPUTT', 93, 'nicht-lesbar'),
];

test('ohne Option bleibt alles wie bisher', () => {
  const r = produceRankings(results, { topN: 10 });
  assert.deepEqual(r.overview.map((x) => x.ticker), ['BIG1', 'BIG2', 'KLEIN1', 'KLEIN2', 'KLEIN3', 'OHNEWERT', 'KAPUTT']);
});

test('mit Option verschwinden die Grossen AUS DER UEBERSICHT', () => {
  const r = produceRankings(results, { topN: 10, overviewMaxMcap: MEGA_CAP_USD });
  const t = r.overview.map((x) => x.ticker);
  assert.ok(!t.includes('BIG1'), 'BIG1 (900 Mrd.) darf nicht in der Uebersicht stehen');
  assert.ok(!t.includes('BIG2'), 'BIG2 (50 Mrd.) darf nicht in der Uebersicht stehen');
  assert.deepEqual(t, ['KLEIN1', 'KLEIN2', 'KLEIN3', 'OHNEWERT', 'KAPUTT']);
});

test('die Branchen-Boards behalten ALLES — sonst verschwinden Firmen ganz', () => {
  const r = produceRankings(results, { topN: 10, overviewMaxMcap: MEGA_CAP_USD });
  const inBranche = r.branches.semiconductors.profitable.map((x) => x.ticker);
  assert.ok(inBranche.includes('BIG1'), 'BIG1 muss im Branchen-Board bleiben');
  assert.ok(inBranche.includes('BIG2'), 'BIG2 muss im Branchen-Board bleiben');
  assert.equal(inBranche.length, results.length);
});

test('weder fehlender noch KAPUTTER Marktwert wirft eine Firma hinaus', () => {
  // Der haeufigste Weg, wie ein Groessenfilter still zu viel entfernt: eine Zahl, die keine ist.
  const r = produceRankings(results, { topN: 10, overviewMaxMcap: MEGA_CAP_USD });
  const t = r.overview.map((x) => x.ticker);
  assert.ok(t.includes('OHNEWERT'), 'fehlender Marktwert darf nicht ausschliessen');
  assert.ok(t.includes('KAPUTT'), 'unlesbarer Marktwert darf nicht ausschliessen — Number() ergibt NaN');
});

test('genau an der Grenze wird ausgeschlossen, knapp darunter nicht', () => {
  const grenzfall = [zeile('GENAU', 90, MEGA_CAP_USD), zeile('KNAPP', 89, MEGA_CAP_USD - 1)];
  const r = produceRankings(grenzfall, { topN: 10, overviewMaxMcap: MEGA_CAP_USD });
  assert.deepEqual(r.overview.map((x) => x.ticker), ['KNAPP']);
});

test('die Liste bleibt gleich lang — es ruecken Namen nach', () => {
  // 30 Zeilen, davon 5 gross; bei topN 10 (also 20 Uebersichtszeilen) muessen trotzdem
  // 20 Zeilen herauskommen, nicht 15.
  const viele = [];
  for (let i = 0; i < 30; i++) viele.push(zeile('T' + i, 100 - i, i < 5 ? 100e9 : 1e9));
  const r = produceRankings(viele, { topN: 10, overviewMaxMcap: MEGA_CAP_USD });
  assert.equal(r.overview.length, 20, 'die Uebersicht muss weiter voll sein');
  assert.ok(!r.overview.some((x) => Number(x.marketCap) >= MEGA_CAP_USD));
});

test('die Grenze ist die Mega-Cap-Schwelle — 200 Mrd. nach Marktstandard', () => {
  // KARL-KORREKTUR 27.07.2026: vorher standen hier 22,7 Mrd. Das ist die Aufnahmeschwelle
  // fuer den S&P 500, nicht die Large-Cap-Grenze — und sie war so scharf, dass die Uebersicht
  // nur noch Firmen bis 22,24 Mrd. enthielt (Median 4,37). Karls Urteil beim Draufschauen:
  // "Ich glaube, ich habe gerade einen Small-Cap-Screener."
  assert.equal(MEGA_CAP_USD, 200e9);
});

test('Karls Kernnamen bleiben in der Uebersicht, die Billionen-Konzerne nicht', () => {
  // Der eigentliche Zweck der Korrektur, mit den echten Marktwerten vom 27.07.2026.
  // Faellt dieser Test, ist Karls Screener wieder ein Small-Cap-Screener.
  const echt = [
    zeile('NVDA', 99, 5009.87e9),
    zeile('TSM', 98, 2066.14e9),
    zeile('AVGO', 97, 1817.02e9),
    zeile('BE', 96, 52.59e9),
    zeile('ALAB', 95, 49.98e9),
    zeile('CRDO', 94, 39.75e9),
  ];
  const r = produceRankings(echt, { topN: 10, overviewMaxMcap: MEGA_CAP_USD });
  const t = r.overview.map((x) => x.ticker);
  assert.deepEqual(t, ['BE', 'ALAB', 'CRDO'], 'genau die drei Kernnamen, genau die drei Riesen raus');
});

test('die absolute Groessenklasse trennt, was die gelernte zusammenwirft', () => {
  // Am 27.07. gemessen: die gelernten Grenzen lagen bei 2,47 / 3,89 / 7,02 / 17,02 Mrd. —
  // CRDO (39,8) und NVIDIA (5.010) fielen BEIDE in die oberste gelernte Klasse, obwohl
  // zwischen ihnen der Faktor 126 liegt. Genau das war Karls Kritik an mcapBand.
  assert.equal(mcapKlasseOf(39.75e9), 'large', 'CRDO ist ein Large Cap');
  assert.equal(mcapKlasseOf(49.98e9), 'large', 'ALAB ist ein Large Cap');
  assert.equal(mcapKlasseOf(5009.87e9), 'mega', 'NVIDIA ist ein Mega Cap');
  // Die uebrigen Klassengrenzen, jeweils knapp darunter und darauf.
  assert.equal(mcapKlasseOf(299e6), 'micro');
  assert.equal(mcapKlasseOf(300e6), 'small');
  assert.equal(mcapKlasseOf(1.99e9), 'small');
  assert.equal(mcapKlasseOf(2e9), 'mid');
  assert.equal(mcapKlasseOf(9.99e9), 'mid');
  assert.equal(mcapKlasseOf(10e9), 'large');
  assert.equal(mcapKlasseOf(199e9), 'large');
  assert.equal(mcapKlasseOf(200e9), 'mega');
});

test('die Groessenklasse erfindet nichts, wo kein Marktwert ist', () => {
  // Dieselbe Falle wie beim Filter: Number(null) ist 0, Number('kaputt') ist NaN. Beides
  // darf keine Klasse ergeben — eine erfundene "micro"-Einstufung waere schlimmer als keine.
  assert.equal(mcapKlasseOf(null), null);
  assert.equal(mcapKlasseOf(undefined), null);
  assert.equal(mcapKlasseOf('nicht-lesbar'), null);
  assert.equal(mcapKlasseOf(0), null);
  assert.equal(mcapKlasseOf(-5e9), null);
});

console.log(`\nuebersicht-largecap: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
