'use strict';
/**
 * Belegbarkeits-Gate (18.08.2026) — die Waechter zur Regel in scripts/write-findash-export.js.
 *
 * REGEL: eine gescorte Zeile mit weniger als RANK_MIN_AXES (=4) belegten Messachsen bekommt
 * KEINEN Rang. Sie bleibt sichtbar — mit Score, mit allen Feldern und mit dem Grund
 * (rankGrund) — und verbraucht keine Rangnummer, sodass die uebrigen Raenge lueckenlos
 * bleiben. Anlass: 21 von ~40 Top-20-Zeilen des Finanzwerte-Boards ruhten auf 3-4 von 7
 * Achsen (geschlossene Fonds, ein Hedgefonds, Holdings); auf 3 Achsen genuegt zufaelliges
 * Gutaussehen fuer Rohwerte um 97-99.
 *
 * Diese Datei nagelt die SACHE fest, nicht ein Schreibmuster: geprueft werden Rang, Grund,
 * Sichtbarkeit und Lueckenlosigkeit an der oeffentlichen Bau- und Pruefkette
 * (mapBoardRow -> vergebeRaenge -> validateFile), nicht die Existenz einer Konstante.
 *
 * Usage:  node tests/scoring/belegbarkeits-gate.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const wfe = require('../../scripts/write-findash-export.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// Eine Zeile in der Form, die score.js/produceRankings liefert. cov = coverageAxes ("n/m"),
// undefined heisst: das Feld fehlt ganz (so kommen survival-Zeilen an).
const zeile = (ticker, score, cov) => {
  const r = {
    ticker, name: ticker + ' Inc.', score, track: 'profitable', lamps: [],
    overview: { kind: 'gp', value: 0.2, companion: 50 },
    country: 'United States', region: 'North America', sector: 'Technology',
    marketCap: 1e10, phase: 'established', mcapBand: 'large', ipoRecency: 'mature',
    profitTier: 'langfristig-profitabel', ipoYear: 1999, cohortN: 90, cohortFallback: false,
  };
  if (cov !== undefined) r.coverageAxes = cov;
  return r;
};
// Bau-Kette wie buildBoard(): mappen, dann Raenge vergeben.
const baue = (specs) => wfe.vergebeRaenge(specs.map((s, i) => wfe.mapBoardRow(zeile(s[0], s[1], s[2]), i)), 'test.profitable');
const huelle = (profitable) => ({
  schema: wfe.SCHEMA, generated_at: 'x', boardStatus: 'core', coverage: null,
  branch: 'financials', profitable, unprofitable: [],
});
const pruefe = (profitable) => { const e = []; wfe.validateFile(huelle(profitable), 'financials', e); return e; };

// --- 1. Drei von sieben Achsen: kein Rang, aber weiterhin sichtbar MIT Score UND Grund ----
// Realfall: GGN (geschlossener Fonds) stand am 16.08. auf Rang 6 des Finanzwerte-Boards mit
// 3/7 Achsen und Score 77,2.
test('3/7 Achsen: kein Rang — aber Zeile, Score und Grund bleiben in der Ausgabe', () => {
  const rows = baue([['GGN', 77.2, '3/7']]);
  assert.equal(rows.length, 1, 'die Zeile darf NICHT aus der Liste verschwinden');
  assert.equal(rows[0].rank, null, 'eine 3/7-Zeile darf keinen Rang tragen');
  assert.equal(rows[0].rankGrund, 'zuWenigBelegteAchsen', 'der Grund muss dranstehen');
  assert.equal(rows[0].score, 77.2, 'der Score bleibt sichtbar');
  assert.equal(rows[0].ticker, 'GGN');
  assert.equal(rows[0].coverageAxes, '3/7', 'die Belegbarkeit bleibt ausgewiesen');
  assert.deepEqual(pruefe(rows), [], '--check muss die entrangte Zeile als GUELTIG ansehen');
});

// --- 2. Die Schwelle beisst genau bei 4 ---------------------------------------------------
// Deklariertes, bekanntes Loch: CBDG.PA (Compagnie du Cambodge, Holding) hat exakt 4 Achsen
// und behaelt seinen Rang. Gewollt — die 5er-Schwelle wuerde 127 echte Firmen mitreissen.
test('4/7 Achsen tragen einen Rang, 3/7 nicht — die Schwelle beisst genau dazwischen', () => {
  const vier = baue([['CBDG.PA', 67.7, '4/7']]);
  assert.equal(vier[0].rank, 1, '4/7 muss einen Rang bekommen (Schwelle ist 4, nicht 5)');
  assert.equal(vier[0].rankGrund, null, 'eine gerankte Zeile traegt keinen Grund');
  const drei = baue([['GGN', 77.2, '3/7']]);
  assert.equal(drei[0].rank, null, '3/7 darf keinen Rang bekommen');
  assert.deepEqual(pruefe(vier), [], '--check muss die 4/7-Zeile als GUELTIG ansehen');
});

// --- 3. Kein Loch, wo eine Zeile herausfiel ----------------------------------------------
test('die uebrigen Raenge sind lueckenlos und aufsteigend (kein Loch an der Fehlstelle)', () => {
  const rows = baue([
    ['QXO', 96.6, '7/7'], ['GGN', 77.2, '3/7'], ['NXP', 77.0, '3/7'],
    ['MCX.BO', 76.0, '5/7'], ['NMR', 72.6, '4/7'],
  ]);
  assert.deepEqual(rows.map((r) => r.rank), [1, null, null, 2, 3], 'Raenge muessen 1,2,3 durchlaufen');
  const raenge = rows.map((r) => r.rank).filter((x) => x !== null);
  raenge.forEach((r, i) => assert.equal(r, i + 1, 'Rang ' + r + ' an Position ' + i + ' — Folge gebrochen'));
  assert.deepEqual(pruefe(rows), [], '--check darf an der lueckenlosen Folge nichts finden');
  // Gegenprobe an derselben Kette: wird die Luecke KUENSTLICH gelassen (Rangnummern wie ohne
  // Gate weitergezaehlt), muss der --check das melden. Sonst waere Kriterium 3 zahnlos.
  const mitLoch = baue([['QXO', 96.6, '7/7'], ['GGN', 77.2, '3/7'], ['MCX.BO', 76.0, '5/7']]);
  mitLoch[2].rank = 3; // haette 2 sein muessen
  assert.ok(pruefe(mitLoch).some((x) => /rank!=Sollrang/.test(x)), 'eine Rang-Luecke muss auffliegen');
});

// --- 4. Schutznamen: 7/7 (bzw. 8/8) behaelt Rang und Sichtbarkeit -------------------------
test('Schutznamen (QXO/LQDA/NBIS 7/7, ONDS 8/8) behalten Rang und Sichtbarkeit', () => {
  // score-desc wie score.js sie liefert — der --check prueft die Ordnung mit.
  const rows = baue([['LQDA', 97.8, '7/7'], ['QXO', 96.6, '7/7'], ['NBIS', 84.9, '7/7'], ['ONDS', 75.0, '8/8']]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, 4], 'kein Schutzname darf entrangt werden');
  rows.forEach((r) => {
    assert.equal(r.rankGrund, null, r.ticker + ': voll belegt, kein Grund erlaubt');
    assert.ok(Number.isFinite(r.score), r.ticker + ': Score muss sichtbar bleiben');
  });
  assert.deepEqual(pruefe(rows), []);
});

// --- 5. coverageAxes fehlt ganz: bewusst entrangt, mit EIGENEM Grund ---------------------
// Entscheidung (im Code begruendet): ohne Beleg kein Rang. Durchwinken hiesse, genau die
// Zeilen zu ranken, ueber deren Datenlage nichts bekannt ist. Still verworfen wird sie
// ebenso wenig — sie bleibt mit Score in der Liste und traegt einen von
// 'zuWenigBelegteAchsen' UNTERSCHEIDBAREN Grund.
test('coverageAxes fehlt ganz: kein Rang, eigener Grund coverageUnbekannt, Zeile bleibt sichtbar', () => {
  const ohne = baue([['X', 90, undefined]]);
  assert.equal(ohne.length, 1, 'die Zeile darf nicht still verworfen werden');
  assert.equal(ohne[0].rank, null, 'ohne Beleg kein Rang — nicht stillschweigend durchgewunken');
  assert.equal(ohne[0].rankGrund, 'coverageUnbekannt', 'eigener, unterscheidbarer Grund');
  assert.equal(ohne[0].score, 90, 'der Score bleibt sichtbar');
  assert.deepEqual(pruefe(ohne), [], '--check muss die Form akzeptieren');
  // Auch Muell im Feld (nicht "n/m") gilt als unbelegt, nicht als "irgendwie ok".
  const muell = baue([['Y', 90, 'viele']]);
  assert.equal(muell[0].rank, null, 'unlesbares coverageAxes darf keinen Rang erzeugen');
  assert.equal(muell[0].rankGrund, 'coverageUnbekannt');
});

// --- 5b. Die Ausnahme: survival-Zeilen laufen NIE durch das Gate -------------------------
// Sie werden nie gescort und tragen coverageAxes nie — ohne diese Ausnahme haetten alle 101
// Zeilen des Vintages 2026-08-16 geschlossen ihren Runway-Rang verloren.
test('survival-Zeilen (nie gescort, nie coverageAxes) behalten ihren Runway-Rang', () => {
  const sv = [9999, 12, 4].map((q, i) => wfe.mapSurvivalRow({
    ticker: 'PRE' + i, runwayQuarters: q, lamps: [],
    country: 'Germany', region: 'Europe', sector: 'Healthcare',
    marketCap: null, phase: null, mcapBand: 'small', ipoRecency: null,
    cohortN: null, cohortFallback: null,
  }, i));
  assert.deepEqual(sv.map((r) => r.rank), [1, 2, 3], 'survival darf das Gate nie sehen');
  const e = []; wfe.validateFile({ schema: wfe.SCHEMA, generated_at: 'x', coverage: null, rows: sv }, 'survival', e);
  assert.deepEqual(e, [], '--check muss survival ohne coverageAxes clean finden');
});

// --- 6. Der --check faengt eine Liste, die das Gate NIE gesehen hat ----------------------
// Ohne diese Richtung koennte ein Board, bei dem vergebeRaenge() vergessen wurde, mit
// rank=i+1 stumm durchrutschen — die Regel waere gebaut, aber wirkungslos.
test('eine Liste ohne angewandtes Gate faellt im --check auf (rank trotz zu duenner Belegung)', () => {
  const roh = [zeile('GGN', 77.2, '3/7')].map((r, i) => wfe.mapBoardRow(r, i)); // KEIN vergebeRaenge
  assert.equal(roh[0].rank, 1, 'Vorbedingung: der Mapper vergibt zunaechst i+1');
  const e = pruefe(roh);
  assert.ok(e.some((x) => /Belegbarkeits-Gate nicht angewandt/.test(x)), 'ungegatete Liste muss auffliegen: ' + JSON.stringify(e));
});

// --- 7. Unsinnige Abdeckungsangaben bekommen KEINEN Rang -------------------------------
// Reviewer-Befund 18.08. (MITTEL): die Regex /^(\d+)\/(\d+)$/ allein laesst inhaltlichen
// Unsinn durch. "0/0" lief in rangGrund() auf den QC-Zweig (Nenner < RANK_GATE_MIN_NENNER)
// und "9/7" auf "n >= RANK_MIN_AXES" — beide Male auf null, also auf "Rang steht ihr zu".
// Eine Zeile mit kaputter Abdeckungsangabe haette still einen Rang bekommen, statt als
// 'coverageUnbekannt' gefuehrt zu werden.
//
// Der Wert ueberquert eine Serialisierungsgrenze zwischen dem versiegelten src/scoring/ und
// dem Export. Was hier geprueft wird, ist deshalb die SACHE: eine Abdeckungsangabe, die
// keinen Sinn ergibt, ist keine Abdeckungsangabe — sie ist Unwissen, und Unwissen bekommt
// keinen Rang. Das gilt unabhaengig davon, welche Zahlen kuenftige Formeln liefern.
//
// GEGENPROBE (durchgefuehrt): Haertung in belegteAchsen() zurueckgedreht -> dieser Test rot.
test('unsinnige coverageAxes ("0/0", "9/7") bekommen keinen Rang, sondern coverageUnbekannt', () => {
  // NICHT dabei: '0/7'. Das ist eine GUELTIGE Angabe (keine von sieben Achsen belegt) und
  // gehoert korrekt zu 'zuWenigBelegteAchsen' — steht unten bei den Gegenproben. Der erste
  // Entwurf dieses Waechters hatte sie faelschlich als Unsinn gefuehrt und wurde dadurch rot;
  // richtig war der Code, nicht der Test.
  for (const kaputt of ['0/0', '9/7']) {
    const g = wfe.rangGrund({ coverageAxes: kaputt });
    assert.equal(g, 'coverageUnbekannt',
      `coverageAxes="${kaputt}" muss als unbekannt gelten, ergab aber ${JSON.stringify(g)} — ` +
      'eine kaputte Angabe darf nie zu "Rang steht ihr zu" fuehren');
  }
  // Gegenprobe in derselben Pruefung: gueltige Formen muessen weiterhin DURCHGEHEN,
  // sonst waere die Haertung ein Rundumschlag statt einer Praezisierung.
  assert.equal(wfe.rangGrund({ coverageAxes: '7/7' }), null, '7/7 muss einen Rang bekommen');
  assert.equal(wfe.rangGrund({ coverageAxes: '4/7' }), null, '4/7 muss einen Rang bekommen (Schwelle)');
  assert.equal(wfe.rangGrund({ coverageAxes: '3/7' }), 'zuWenigBelegteAchsen', '3/7 bleibt entrangt');
  assert.equal(wfe.rangGrund({ coverageAxes: '0/7' }), 'zuWenigBelegteAchsen', '0/7 ist gueltig und entrangt, NICHT unbekannt');
  assert.equal(wfe.rangGrund({ coverageAxes: '2/5' }), null, 'QC-Nenner 5 bleibt ungegated');
});

console.log(`\nbelegbarkeits-gate.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
