/**
 * Skalen-Deckel — Waechter (19.08.2026)
 *
 * BEFUND (_BEFUND-BOARDQUALITAET-2026-08-18.md, Befund 4): drei Zeilen trugen einen Score ueber
 * 100 (278470.KS 101,0 · CUPID.NS 100,6 · ZEAL.CO 100,1). Der Score ist als 0-100-Skala gemeint;
 * der Wachstums-Bonus hebt strukturell bis Faktor 1,05 (96,2 x 1,05 = 101,0).
 *
 * DIE SACHE, die hier festgenagelt wird, ist NICHT "es steht ein Math.min im Code" — sondern:
 * (a) kein ausgelieferter Score liegt ueber 100, und
 * (b) DER DECKEL VERSCHIEBT KEINEN RANG.
 *
 * (b) ist der Grund, warum der Deckel nicht in src/scoring/score.js sitzt: dort liefe er VOR der
 * Sortierung und machte aus 101,0 und 100,6 zwei exakte Gleichstaende — der Ticker-Tie-Break
 * entschiede dann ueber Platz 1 und 2. Ein Waechter, der nur das Deckeln prueft, wuerde einen
 * spaeteren Umzug an genau diesen falschen Ort NICHT bemerken. Deshalb prueft Test 2 die Raenge.
 *
 * WO DER DECKEL NICHT STEHEN DARF: in scripts/write-board-history.js. Das ist die MESSREIHE,
 * auf der das Wert-Gate rechnet. Der erste Entwurf deckelte dort mit — (f3) in
 * tests/board-history.test.js wurde rot und zeigte warum: der Test stellt einen echten
 * Wertbruch nach (Score springt 92 -> 132); gedeckelt schrumpft der Sprung auf +8 und liegt
 * unter der Alarmschwelle. Der Deckel haette das Sicherheitsnetz stillgelegt. Diesen Schutz
 * haelt (f3) — wer ihn dort je entfernt, muss diesen Absatz gelesen haben.
 *
 * Usage:  node tests/scoring/score-deckel.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const wfe = require('../../scripts/write-findash-export.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const zeile = (ticker, score) => ({
  ticker, name: ticker + ' Inc.', score, track: 'profitable', lamps: [],
  overview: { kind: 'gp', value: 0.2, companion: 50 },
  country: 'United States', region: 'North America', sector: 'Technology',
  marketCap: 1e10, phase: 'established', mcapBand: 'large', ipoRecency: 'mature',
  profitTier: 'langfristig-profitabel', ipoYear: 1999, cohortN: 90, cohortFallback: false,
  coverageAxes: '7/7',
});

// Die drei echten Faelle vom 16.08. plus zwei normale Zeilen darunter.
const brett = () => [
  zeile('278470.KS', 101.0),
  zeile('CUPID.NS', 100.6),
  zeile('ZEAL.CO', 100.1),
  zeile('NORMAL1', 99.4),
  zeile('NORMAL2', 88.0),
];

// --- 1. Kein ausgelieferter Score ueber 100 -------------------------------------------
test('kein Score ueber 100 verlaesst den Export — beide Reihen (Board und Uebersicht)', () => {
  const board = brett().map((r, i) => wfe.mapBoardRow(r, i));
  const ueber = brett().map((r, i) => wfe.mapOverviewRow(r, i));
  for (const z of board.concat(ueber)) {
    assert.ok(z.score <= 100, z.ticker + ' liefert ' + z.score + ' — die Skala geht bis 100');
  }
  assert.equal(board[0].score, 100, '101,0 muss auf 100 gedeckelt werden');
  assert.equal(ueber[0].score, 100, 'die Uebersichtsreihe darf nicht vergessen werden');
});

// --- 2. DER KERN: der Deckel verschiebt keinen Rang ------------------------------------
test('der Deckel verschiebt KEINEN Rang — 101,0 und 100,6 bleiben Platz 1 und 2', () => {
  const board = wfe.vergebeRaenge(brett().map((r, i) => wfe.mapBoardRow(r, i)), 'test');
  assert.deepEqual(board.map((z) => z.ticker), ['278470.KS', 'CUPID.NS', 'ZEAL.CO', 'NORMAL1', 'NORMAL2'],
    'die Reihenfolge muss die des Exports bleiben');
  assert.deepEqual(board.map((z) => z.rank), [1, 2, 3, 4, 5],
    'die Raenge sind positional und duerfen vom Deckel nicht beruehrt werden');
  // Die eigentliche Gefahr in Worten: nach dem Deckeln tragen drei Zeilen denselben Score.
  assert.equal(board[0].score, board[1].score, 'Vorbedingung: nach dem Deckeln sind es Gleichstaende');
  assert.notEqual(board[0].rank, board[1].rank, 'trotz gleichem Score verschiedene Raenge — sonst entschiede ein Tie-Break');
});

// --- 3. Alles unter 100 bleibt unangetastet -------------------------------------------
test('Werte unter 100 gehen unveraendert durch — der Deckel ist kein Rundumschlag', () => {
  assert.equal(wfe.gedeckelt(99.4), 99.4);
  assert.equal(wfe.gedeckelt(0), 0);
  assert.equal(wfe.gedeckelt(100), 100, 'genau 100 ist gueltig und wird nicht veraendert');
  assert.equal(wfe.gedeckelt(-3.2), -3.2, 'negative Werte sind ein anderes Problem, nicht Sache des Deckels');
});

// --- 4. Nicht-Zahlen ueberleben ---------------------------------------------------------
test('null und fehlende Scores bleiben, was sie sind (survival-Zeilen tragen nie einen Score)', () => {
  assert.equal(wfe.gedeckelt(null), null, 'null darf nicht zu 100 werden');
  assert.equal(wfe.gedeckelt(undefined), undefined);
  assert.ok(Number.isNaN(wfe.gedeckelt(NaN)), 'NaN bleibt NaN — Math.min(100, NaN) waere NaN, aber nie 100');
  // Infinity wird ABSICHTLICH nicht gedeckelt (Number.isFinite-Pruefung in gedeckelt()).
  // Der erste Entwurf dieses Tests erwartete 100 und wurde rot — richtig war der Code:
  // ein Score von Infinity ist kein hoher Score, sondern ein schwerer Rechenfehler. Ihn auf
  // 100 zu deckeln wuerde ihn als perfekte Bestnote TARNEN statt ihn zu zeigen — genau die
  // stille Fehlklassifikation, die in diesem Projekt am teuersten ist. Er kommt sichtbar
  // durch und faellt oben an der 'kein Score ueber 100'-Pruefung auf.
  assert.equal(wfe.gedeckelt(Infinity), Infinity, 'ein kaputter Score muss sichtbar bleiben, nicht als 100 getarnt werden');
});

// --- 5. Das vorab deklarierte Scheiternskriterium ---------------------------------------
test('Scheiternskriterium: ein Brett voller Deckel-Treffer faellt auf, ein gesundes nicht', () => {
  // Vorab deklariert: liegen mehr als 10 Zeilen (0,1 %) eines echten Vintages auf 100,0,
  // maskiert der Deckel echte Skaleninflation statt drei Ausreisser zu begradigen.
  const anteilAufDeckel = (rows) => rows.filter((z) => z.score === 100).length / rows.length;
  const viele = brett().map((r, i) => wfe.mapBoardRow(r, i));
  assert.ok(anteilAufDeckel(viele) > 0.1, 'ein Brett aus lauter Ueberschreitungen muss auffallen');
  const normal = [zeile('A', 92), zeile('B', 88)].map((r, i) => wfe.mapBoardRow(r, i));
  assert.equal(anteilAufDeckel(normal), 0, 'ein gesundes Brett liegt bei null');
});

console.log(`\nscore-deckel.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
