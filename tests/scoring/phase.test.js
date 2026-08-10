'use strict';
/**
 * Filter-Schicht-Test (Karl-Direktive 5): Profitabilitaets-Phase + mcapBand + ipoRecency.
 * Prueft die reinen Klassifikatoren gegen eingefrorene Anker-Fixtures + synthetische Faelle
 * und dass die neuen Felder rein ADDITIV im produceRankings-Output erscheinen (Score/Rang
 * unveraendert -> byte-identisch, verifiziert durch die uebrigen Suiten + run-screener-Anker).
 *
 * Usage:  node tests/scoring/phase.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { phaseOf, mcapBandOf, ipoRecencyOf, ipoYearOf, scoreUniverse, produceRankings } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0, skip = 0;
// R2.R (Rumpf-Skip-Ehrlichkeit): wie in score.integration.test.js — ein Rumpf, der seine
// Voraussetzung erst drinnen vermisst, meldet das per skipBody() und wird als skip verbucht,
// NICHT als pass. Vorher stieg der Integrations-Anker unten per `return` aus und die Summenzeile
// meldete "12 ok, 0 fail" ohne jedes "skipped" — im CI ununterscheidbar von einem Voll-Pass.
const SKIP = Symbol('skip-body');
function skipBody(grund) { const e = new Error(grund); e[SKIP] = true; throw e; }
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) {
    if (e && e[SKIP]) { skip++; console.log('  skip ' + name + ' (' + e.message + ')'); return; }
    fail++; console.error('FAIL   ' + name + '\n       ' + e.message);
  }
}
function fix(t) { return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', t + '.json'), 'utf8')); }
const V = (arr) => arr.map((v) => ({ value: v }));

// --- phaseOf: Anker-Fixtures (Karls Zielarchetypen sind 'gerade gedreht') ---
test('phaseOf: CRDO/ALAB/BE/PLTR = inflected (gerade gedreht)', () => {
  for (const t of ['CRDO', 'ALAB', 'BE', 'PLTR']) assert.equal(phaseOf(fix(t)), 'inflected', t);
});
test('phaseOf: NVTS = unprofitable (juengstes Ergebnis negativ)', () => {
  assert.equal(phaseOf(fix('NVTS')), 'unprofitable');
});

// --- phaseOf: synthetisch (Definition praezise pinnen) ---
test('phaseOf: alle Jahre positiv -> established', () => {
  assert.equal(phaseOf({ annual: { annualOpInc: V([50, 40, 30, 20]) } }), 'established');
});
test('phaseOf: juengstes positiv, Verlust davor -> inflected', () => {
  assert.equal(phaseOf({ annual: { annualOpInc: V([10, -5, -8, -9]) } }), 'inflected');
});
test('phaseOf: juengstes negativ -> unprofitable', () => {
  assert.equal(phaseOf({ annual: { annualOpInc: V([-5, -4, -3]) } }), 'unprofitable');
});
test('phaseOf: OpInc leer -> NetIncome-Rescue', () => {
  assert.equal(phaseOf({ annual: { annualOpInc: [], annualNetIncome: V([10, 8, 6]) } }), 'established');
  assert.equal(phaseOf({ annual: { annualOpInc: [], annualNetIncome: V([-1, -2]) } }), 'unprofitable');
});
test('phaseOf: OpInc-Vorrang vor positivem NetIncome (NBIS/Yandex-Einmaleffekt-Muster)', () => {
  assert.equal(phaseOf({ annual: { annualOpInc: V([-100, -80, -60, -40]), annualNetIncome: V([20, 15, 10, 5]) } }), 'unprofitable');
});
test('phaseOf: <2 present Punkte -> null (unbekannt)', () => {
  assert.equal(phaseOf({ annual: { annualOpInc: V([50]) } }), null);
  assert.equal(phaseOf({ annual: {} }), null);
});

// --- mcapBandOf: data-learned Quintil-Baender ---
test('mcapBandOf: Quintil-Baender micro..mega + null', () => {
  const b = [1e9, 2e9, 5e9, 2e10];
  assert.equal(mcapBandOf(0.5e9, b), 'micro');
  assert.equal(mcapBandOf(1.5e9, b), 'small');
  assert.equal(mcapBandOf(3e9, b), 'mid');
  assert.equal(mcapBandOf(1e10, b), 'large');
  assert.equal(mcapBandOf(5e10, b), 'mega');
  assert.equal(mcapBandOf(null, b), null);
  assert.equal(mcapBandOf(1e9, null), null);
});

// --- ipoYearOf / ipoRecencyOf ---
test('ipoYearOf: ipoYear primaer, firstTradeDate-Jahr als Fallback', () => {
  assert.equal(ipoYearOf({ ipoYear: 2022 }), 2022);
  assert.equal(ipoYearOf({ firstTradeDate: '2019-05-10T00:00:00.000Z' }), 2019);
  assert.equal(ipoYearOf({}), null);
});
test('ipoRecencyOf: Quintil-Baender (recent=neueste IPOs)', () => {
  const b = [2000, 2010, 2015, 2020];
  assert.equal(ipoRecencyOf({ ipoYear: 2024 }, b), 'recent');
  assert.equal(ipoRecencyOf({ ipoYear: 2017 }, b), 'growth');
  assert.equal(ipoRecencyOf({ ipoYear: 2012 }, b), 'seasoned');
  assert.equal(ipoRecencyOf({ ipoYear: 2005 }, b), 'mature');
  assert.equal(ipoRecencyOf({ ipoYear: 1995 }, b), 'veteran');
  assert.equal(ipoRecencyOf({}, b), null);
});

// --- Integration: Felder additiv im Output, Anker unveraendert ---
test('Output-Zeilen tragen phase/mcapBand/ipoRecency; CRDO=inflected, route, Score finit', () => {
  // SCREENER_SNAPSHOTS_DIR: nur Test-Seam (die Skip-Ehrlichkeits-Regression zeigt damit ein leeres
  // Universum); ohne die Variable unveraendert das echte snapshots/.
  const SNAP_DIR = process.env.SCREENER_SNAPSHOTS_DIR || path.join(__dirname, '..', '..', 'snapshots');
  const files = fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json'));
  const universe = [];
  for (const f of files) { try { const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); if (s && s.meta && s.meta.ticker) universe.push(s); } catch (_) { /* defekt */ } }
  // Task 0.9-Fix (CI pre-pull gate): dieser Integrations-Anker braucht das ECHTE Live-Universum
  // (CRDO in der Semiconductor-Kohorte, non-leere survival-Liste). Vor dem Pull ist snapshots/ leer
  // -> N/A (fehlende Daten, kein Engine-Regress), sauber ueberspringen; lokal mit Snapshots laeuft er
  // voll. Die reinen phaseOf/mcapBand/ipoRecency-Klassifikatoren oben nutzen fixtures/ und laufen immer.
  if (universe.length === 0) skipBody('kein Universum — pre-pull-Gate');
  const results = scoreUniverse(universe, formulas);
  const r = produceRankings(results, { topN: 50 });
  const crdo = r.branches['semiconductors'].profitable.find((x) => x.ticker === 'CRDO');
  assert.ok(crdo, 'CRDO fehlt im Output');
  assert.equal(crdo.phase, 'inflected', 'CRDO phase');
  assert.ok('mcapBand' in crdo && 'ipoRecency' in crdo, 'Filter-Felder fehlen an branch-Zeile');
  assert.ok('phase' in r.overview[0] && 'mcapBand' in r.overview[0], 'overview-Zeile ohne Filter-Felder');
  assert.ok(r.survival.length && 'phase' in r.survival[0], 'survival-Zeile ohne Filter-Felder');
});

// P1-Chunk 4 Stufe 1 (Tag 623): die Skip-Zahl in der Summenzeile ist eine Fussnote — im CI-Log geht
// sie unter. Eine ::warning::-Zeile macht daraus eine sichtbare GitHub-Annotation. console.log direkt
// auf stdout, ohne Wrapper/Praefix (Lektion F2964), und VOR der Summenzeile, damit die letzte Zeile
// des Outputs weiter die Summenzeile bleibt (tests/skip-honesty.test.js liest sie per pop()).
// Exit-Code bleibt unveraendert gruen — die scharfe Stufe ist bewusst NICHT hier.
if (skip) console.log(`::warning::phase.test.js: ${skip} Live-Universums-Anker uebersprungen (leeres snapshots/) — hier wurde nichts gemessen; die Suite meldet trotzdem gruen.`);
// Skip-Zahl gehoert in die Summenzeile: sonst liest "12 ok, 0 fail" wie ein voller Pass, obwohl im
// pre-pull-CI der Live-Universums-Anker gar nicht gelaufen ist.
console.log(`\nphase.test.js: ${pass} ok, ${fail} fail` + (skip ? `, ${skip} skipped (kein Universum)` : ''));
process.exit(fail ? 1 : 0);
