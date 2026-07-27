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
const { produceRankings, LARGE_CAP_USD } = require('../../src/scoring/score.js');

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
const results = [
  zeile('BIG1', 99, 900e9),
  zeile('BIG2', 98, 50e9),
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
  const r = produceRankings(results, { topN: 10, overviewMaxMcap: LARGE_CAP_USD });
  const t = r.overview.map((x) => x.ticker);
  assert.ok(!t.includes('BIG1'), 'BIG1 (900 Mrd.) darf nicht in der Uebersicht stehen');
  assert.ok(!t.includes('BIG2'), 'BIG2 (50 Mrd.) darf nicht in der Uebersicht stehen');
  assert.deepEqual(t, ['KLEIN1', 'KLEIN2', 'KLEIN3', 'OHNEWERT', 'KAPUTT']);
});

test('die Branchen-Boards behalten ALLES — sonst verschwinden Firmen ganz', () => {
  const r = produceRankings(results, { topN: 10, overviewMaxMcap: LARGE_CAP_USD });
  const inBranche = r.branches.semiconductors.profitable.map((x) => x.ticker);
  assert.ok(inBranche.includes('BIG1'), 'BIG1 muss im Branchen-Board bleiben');
  assert.ok(inBranche.includes('BIG2'), 'BIG2 muss im Branchen-Board bleiben');
  assert.equal(inBranche.length, results.length);
});

test('weder fehlender noch KAPUTTER Marktwert wirft eine Firma hinaus', () => {
  // Der haeufigste Weg, wie ein Groessenfilter still zu viel entfernt: eine Zahl, die keine ist.
  const r = produceRankings(results, { topN: 10, overviewMaxMcap: LARGE_CAP_USD });
  const t = r.overview.map((x) => x.ticker);
  assert.ok(t.includes('OHNEWERT'), 'fehlender Marktwert darf nicht ausschliessen');
  assert.ok(t.includes('KAPUTT'), 'unlesbarer Marktwert darf nicht ausschliessen — Number() ergibt NaN');
});

test('genau an der Grenze wird ausgeschlossen, knapp darunter nicht', () => {
  const grenzfall = [zeile('GENAU', 90, LARGE_CAP_USD), zeile('KNAPP', 89, LARGE_CAP_USD - 1)];
  const r = produceRankings(grenzfall, { topN: 10, overviewMaxMcap: LARGE_CAP_USD });
  assert.deepEqual(r.overview.map((x) => x.ticker), ['KNAPP']);
});

test('die Liste bleibt gleich lang — es ruecken Namen nach', () => {
  // 30 Zeilen, davon 5 gross; bei topN 10 (also 20 Uebersichtszeilen) muessen trotzdem
  // 20 Zeilen herauskommen, nicht 15.
  const viele = [];
  for (let i = 0; i < 30; i++) viele.push(zeile('T' + i, 100 - i, i < 5 ? 100e9 : 1e9));
  const r = produceRankings(viele, { topN: 10, overviewMaxMcap: LARGE_CAP_USD });
  assert.equal(r.overview.length, 20, 'die Uebersicht muss weiter voll sein');
  assert.ok(!r.overview.some((x) => Number(x.marketCap) >= LARGE_CAP_USD));
});

test('die Grenze traegt ihre Herkunft — 22,7 Mrd. nach S&P', () => {
  assert.equal(LARGE_CAP_USD, 22.7e9);
});

console.log(`\nuebersicht-largecap: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
