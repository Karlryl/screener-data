'use strict';
/**
 * 2.11 Stufe A Teil 1 — calibrate ↔ Produktion. Beweist:
 *  (1) Die COARSE Kalibrier-Matrix (scoreWithWeights/rankCohort) ist NICHT rang-identisch zur Produktion —
 *      sie spiegelt EB-Shrinkage(2.10)/C4/Post-Faktoren nicht (der Scoring-Court-Befund). Also DARF man
 *      Gewichte nicht allein am Coarse-Ranking festmachen.
 *  (2) productionCohortRanking() IST das run-screener-Ranking (dieselbe scoreUniverse-Engine) — der exakte
 *      Verify-Pfad für einen Kalibrier-Kandidaten (Rang-Identität per Konstruktion).
 *  (3) withWeights() überschreibt Track-Gewichte immutabel und verändert das Produktions-Ranking spürbar
 *      (der Verify-Schritt funktioniert), ohne die anderen Formeln/Tracks zu berühren.
 *
 * Usage:  node tests/scoring/calib-parity.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse, rankBy, isDataSuspect, issuerDedupGroups, issuerDedupComparator, learnWinsorBounds, winsorTailBounds, growthYoYComponents } = require('../../src/scoring/score.js');
const { buildCalibMatrix, rankCohort, weightsObj, withWeights, productionCohortRanking } = require('../../src/scoring/calibrate.js');
const { route } = require('../../src/scoring/router.js');
const { evaluateLamps } = require('../../src/scoring/lamps.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

const SNAP_DIR = path.join(__dirname, '..', '..', 'snapshots');
const universe = [];
try {
  for (const f of fs.readdirSync(SNAP_DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
    try { const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); if (s && s.meta && s.meta.ticker) universe.push(s); } catch (_) {}
  }
} catch (_) {}

// synthetische Fallback-Kohorte (immer lauffähig, auch im pre-pull-Gate ohne snapshots)
const FID = 'semiconductors', TRACK = 'profitable';

if (universe.length < 100) {
  console.log('  (Universum < 100 -> Parität-Anker übersprungen, KEIN Fail — pre-pull-Gate)');
  console.log('calib-parity.test.js: 0 ok, 0 fail (skipped: kein Universum)');
  process.exit(0);
}
console.log(`  (Universum: ${universe.length} Snapshots geladen)`);

const defaultW = weightsObj(formulas[FID], TRACK);
const rankTickers = (arr) => arr.map((e) => e.ticker);

// (2) productionCohortRanking == run-screener-Ranking (Identität per Konstruktion).
test('productionCohortRanking(default) == scoreUniverse+rankBy (run-screener-Ranking)', () => {
  const prod = rankTickers(productionCohortRanking(universe, formulas, FID, TRACK));
  const direct = rankTickers(rankBy(scoreUniverse(universe, formulas), FID, TRACK).map((e) => ({ ticker: e.ticker })));
  assert.ok(prod.length > 10, `nicht-triviale Kohorte (${prod.length})`);
  assert.deepEqual(prod, direct, 'Verify-Pfad muss byte-genau das run-screener-Ranking sein');
});

// (1) Coarse-Matrix DIVERGIERT von der Produktion (der Court-Befund; kein Fudge auf Coarse zulassen).
test('COARSE-Matrix (rankCohort) ist NICHT rang-identisch zur Produktion (Court-Befund dokumentiert)', () => {
  const matrix = buildCalibMatrix(universe, formulas);
  const cohort = matrix[FID + '|' + TRACK];
  assert.ok(cohort && cohort.rows.length > 10, 'Coarse-Kohorte vorhanden');
  const coarse = rankTickers(rankCohort(cohort, defaultW));
  const prod = rankTickers(productionCohortRanking(universe, formulas, FID, TRACK)).filter((t) => coarse.includes(t));
  const coarseCommon = coarse.filter((t) => prod.includes(t));
  // Beide auf die Schnittmenge beschränken, dann Rang vergleichen: es MUSS Abweichungen geben (Shrinks+Faktoren).
  let diffs = 0;
  for (let i = 0; i < Math.min(coarseCommon.length, prod.length); i++) if (coarseCommon[i] !== prod[i]) diffs++;
  console.log(`       Coarse vs Produktion: ${diffs} Rangabweichungen auf ${prod.length} gemeinsamen Namen`);
  assert.ok(diffs > 0, 'Coarse-Ranking MUSS von der Produktion abweichen (sonst wäre der Court-Befund falsch — Fudge-Gefahr)');
});

// (3) withWeights: immutabel + verändert das Produktions-Ranking.
test('withWeights überschreibt Gewichte immutabel und verändert das Produktions-Ranking', () => {
  const axKey = formulas[FID].axes[0].key;
  const perturbed = { ...defaultW, [axKey]: defaultW[axKey] * 3 + 1 }; // eine Achse stark hochgewichten
  const modFormulas = withWeights(formulas, FID, TRACK, perturbed);
  // Immutabilität: Original unberührt
  assert.equal(formulas[FID].axes[0].w[TRACK], defaultW[axKey], 'Original-Gewicht darf NICHT mutiert sein');
  assert.notEqual(modFormulas[FID], formulas[FID], 'modifizierte Formel ist eine Kopie');
  // andere Formel unberührt (Referenzgleichheit)
  const otherId = Object.keys(formulas).find((id) => id !== FID);
  assert.equal(modFormulas[otherId], formulas[otherId], 'andere Formeln bleiben identische Referenz');
  // Ranking ändert sich
  const base = rankTickers(productionCohortRanking(universe, formulas, FID, TRACK));
  const perturbedRank = rankTickers(productionCohortRanking(universe, formulas, FID, TRACK, perturbed));
  let diffs = 0;
  for (let i = 0; i < Math.min(base.length, perturbedRank.length); i++) if (base[i] !== perturbedRank[i]) diffs++;
  console.log(`       withWeights-Perturbation: ${diffs} Rangänderungen`);
  assert.ok(diffs > 0, 'Gewichts-Override muss das Produktions-Ranking verändern (Verify-Primitiv funktioniert)');
});

// (4) R2.1+R2.8: buildCalibMatrix lernt die universe-weiten Winsor-/Growth-Schranken auf der
// POST-Dedup kept-Population (wie score.js), NICHT auf pre-dedup routed. Referenz UNABHAENGIG auf
// der route-only kept-Population gerechnet (calibrate-Semantik) — NICHT gegen scoreUniverse().calibration
// (route-vs-survival-Asymmetrie, R2.1-Auflage 5). BEIDE Schranken deepEqual ohne Toleranz (R2.8-Auflage 1).
test('Kalibrier-Bounds werden auf der post-Dedup kept-Population gelernt (R2.1+R2.8, winsor UND growth)', () => {
  const matrix = buildCalibMatrix(universe, formulas);
  // route-only Population exakt wie buildCalibMatrix: route -> Formel vorhanden -> nicht data-suspect.
  const routedEntries = [];
  for (const s of universe) {
    const r = route(s);
    if (r.action !== 'route') continue;
    if (!formulas[r.formulaId]) continue;
    const lamps = evaluateLamps(s).active;
    if (isDataSuspect(s, lamps, 'route')) continue;
    routedEntries.push({ snapshot: s, ticker: (s.meta && s.meta.ticker) || '?' });
  }
  // Issuer-Dedup mit derselben Gruppierung wie Produktion und Kalibrierung; Verlierer entfernen.
  // ⚠ Kreuz-Review 27.07., Befund P1: hier stand eine DRITTE Kopie der Gruppierung (strenger
  // issuerKey). Sie hat mitgeholfen, den Bruch zu verdecken — die Referenz rechnete falsch
  // dasselbe wie der falsche Produktionspfad. Jetzt dieselbe Funktion; damit gibt es genau eine
  // Stelle, an der sich die Dedup-Population aendern kann.
  const losers = new Set();
  for (const g of issuerDedupGroups(routedEntries)) {
    if (g.length < 2) continue;
    g.sort(issuerDedupComparator);
    for (let i = 1; i < g.length; i++) losers.add(g[i]);
  }
  const kept = routedEntries.filter((e) => !losers.has(e));
  // Diskriminanz-Schutz: nur wenn der Dedup wirklich Verlierer entfernt, unterscheiden sich pre-/post-Bounds.
  assert.ok(routedEntries.length - kept.length > 0, `Dedup muss Verlierer entfernen (routed=${routedEntries.length}, kept=${kept.length})`);
  const refWinsor = learnWinsorBounds(kept.map((e) => e.snapshot));
  const growthSamples = [];
  for (const e of kept) for (const v of growthYoYComponents(e.snapshot)) growthSamples.push(v);
  const refGrowth = winsorTailBounds(growthSamples);
  assert.deepEqual(matrix.calibration.winsorBounds, refWinsor, 'winsorBounds muss post-Dedup (kept) gelernt sein');
  assert.deepEqual(matrix.calibration.growthBounds, refGrowth, 'growthBounds muss post-Dedup (kept) gelernt sein');
});

console.log(`\ncalib-parity.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
