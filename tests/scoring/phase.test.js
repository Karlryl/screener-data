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

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }
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
  const SNAP_DIR = path.join(__dirname, '..', '..', 'snapshots');
  const files = fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json'));
  const universe = [];
  for (const f of files) { try { const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); if (s && s.meta && s.meta.ticker) universe.push(s); } catch (_) { /* skip */ } }
  // Task 0.9-Fix (CI pre-pull gate): dieser Integrations-Anker braucht das ECHTE Live-Universum
  // (CRDO in der Semiconductor-Kohorte, non-leere survival-Liste). Vor dem Pull ist snapshots/ leer
  // -> N/A (fehlende Daten, kein Engine-Regress), sauber ueberspringen; lokal mit Snapshots laeuft er
  // voll. Die reinen phaseOf/mcapBand/ipoRecency-Klassifikatoren oben nutzen fixtures/ und laufen immer.
  if (universe.length === 0) { console.log('       (kein Universum — pre-pull-Gate — uebersprungen)'); return; }
  const results = scoreUniverse(universe, formulas);
  const r = produceRankings(results, { topN: 50 });
  const crdo = r.branches['semiconductors'].profitable.find((x) => x.ticker === 'CRDO');
  assert.ok(crdo, 'CRDO fehlt im Output');
  assert.equal(crdo.phase, 'inflected', 'CRDO phase');
  assert.ok('mcapBand' in crdo && 'ipoRecency' in crdo, 'Filter-Felder fehlen an branch-Zeile');
  assert.ok('phase' in r.overview[0] && 'mcapBand' in r.overview[0], 'overview-Zeile ohne Filter-Felder');
  assert.ok(r.survival.length && 'phase' in r.survival[0], 'survival-Zeile ohne Filter-Felder');
});

console.log(`\nphase.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
