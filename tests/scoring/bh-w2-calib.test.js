'use strict';
/**
 * Batch w2-calib — Findings BH-074, BH-075, BH-076, BH-079, BH-080, BH-081, BH-082, BH-083.
 * Achsen-/Kalibrierungs-Bugs: fuehrende/interne Luecken wurden von presentValues()-artigen Helfern
 * kompaktiert, dabei ging Adjazenz/Positions-Identitaet verloren -> Mehrjahres-Deltas als 1-Jahres-YoY,
 * stale Perioden als "aktuell" gelesen; ein refCal-Teil-Artefakt konnte scalars als `undefined` statt
 * `null` liefern und Guards umgehen; calibrationDrift meldete false-green bei nicht vergleichbaren
 * Kohorten; calibrate.js hatte keinen opts-Seam fuer QC-Paritaet; coverageAxes zaehlte w=0-Achsen mit.
 * Reine Funktionen/Fixtures, netzwerkfrei, deterministisch.
 *
 * Usage:  node tests/scoring/bh-w2-calib.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const {
  scoreUniverse, calibrationDrift, cycleSeriesPair, cycleSignal,
} = require('../../src/scoring/score.js');
const { buildCalibMatrix, productionCohortRanking } = require('../../src/scoring/calibrate.js');
const { profitTierOf } = require('../../src/scoring/profit-tier.js');
const { gpGrowth, revYoYComponents, quarterQoQRates, marginTrajectory } = require('../../src/scoring/axes.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

const V = (arr) => arr.map((v) => (v === null || v === undefined ? null : { value: v }));

// --- BH-074: calibrationDrift ------------------------------------------------
(() => {
  test('BH-074 calibrationDrift: fehlende Live-Kohorte -> ok:false (vorher false-green)', () => {
    const refCal = { cohortBases: { 'f|profitable': { axes: { a: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } } } };
    const liveCal = { cohortBases: {} }; // voller Kohortenkollaps
    const d = calibrationDrift(liveCal, refCal);
    assert.equal(d.ok, false);
    assert.ok(d.drifted.some((x) => x.cohort === 'f|profitable' && x.reason === 'uncomparable'));
  });
  test('BH-074 calibrationDrift: leere Live-Achse bei nicht-leerer Ref-Achse -> ok:false', () => {
    const refCal = { cohortBases: { 'f|profitable': { axes: { a: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } } } };
    const liveCal = { cohortBases: { 'f|profitable': { axes: { a: [] } } } };
    const d = calibrationDrift(liveCal, refCal);
    assert.equal(d.ok, false);
  });
  test('BH-074 calibrationDrift: identische Verteilung -> ok:true, maxKs:0 (Regression, kein Ueber-Trigger)', () => {
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const refCal = { cohortBases: { 'f|profitable': { axes: { a: vals.slice() } } } };
    const liveCal = { cohortBases: { 'f|profitable': { axes: { a: vals.slice() } } } };
    const d = calibrationDrift(liveCal, refCal);
    assert.equal(d.ok, true);
    assert.equal(d.maxKs, 0);
  });
  test('BH-074 calibrationDrift: echter KS-Threshold-Breach -> ok:false', () => {
    const refCal = { cohortBases: { 'f|profitable': { axes: { a: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } } } };
    const liveCal = { cohortBases: { 'f|profitable': { axes: { a: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110] } } } };
    const d = calibrationDrift(liveCal, refCal);
    assert.equal(d.ok, false);
    assert.ok(d.maxKs > 0.15);
  });
})();

// --- BH-075: refCal-Skalar-Praesenzguard ------------------------------------
(() => {
  const validRefCal = () => ({
    cohortBases: {}, gDistByCohort: {},
    winsorBounds: null, growthBounds: null, cycleDDThreshold: null, mcapBounds: null, ipoBounds: null,
  });
  test('BH-075 scoreUniverse: refCal fehlt ein Skalar-Feld -> fail-loud statt undefined-Bypass', () => {
    for (const k of ['winsorBounds', 'growthBounds', 'cycleDDThreshold', 'mcapBounds', 'ipoBounds']) {
      const rc = validRefCal();
      delete rc[k];
      assert.throws(() => scoreUniverse([], {}, { refCalibration: rc }), new RegExp(k), `fehlendes '${k}' muss werfen`);
    }
  });
  test('BH-075 scoreUniverse: refCal mit allen Feldern (auch null) -> kein Wurf', () => {
    assert.doesNotThrow(() => scoreUniverse([], {}, { refCalibration: validRefCal() }));
  });
})();

// --- BH-079: gpGrowth / revYoYComponents Adjazenz ---------------------------
(() => {
  const snap = ({ rev, gp, revQ } = {}) => ({
    annual: { ...(rev ? { annualRev: V(rev) } : {}), ...(gp ? { annualGP: V(gp) } : {}) },
    timeseries: revQ ? { revenueQ: V(revQ) } : {},
  });
  test('BH-079 gpGrowth: Luecke ZWISCHEN den present Werten (AUR-Muster) -> droppt statt Mehrjahres-Delta als 1J-YoY', () => {
    assert.equal(gpGrowth(snap({ gp: [-14e6, null, null, null, 82.5e6], rev: [1, 1] })), null);
  });
  test('BH-079 gpGrowth: fuehrende Luecke (HYMC-Muster) -> droppt, kein Altwert als "aktuell"', () => {
    assert.equal(gpGrowth(snap({ gp: [null, -12.1e6, -10e6], rev: [1, 1] })), null);
  });
  test('BH-079 gpGrowth: echte Nachbar-Jahre (kein Gap) -> unveraendert berechenbar (Regression)', () => {
    assert.ok(Number.isFinite(gpGrowth(snap({ gp: [110, 100, 90], rev: [110, 100, 90] }))));
  });
  test('BH-079 revYoYComponents: Mehrjahres-Luecke -> annual-lag1-Bein faellt weg, quartals-Bein bleibt unabhaengig', () => {
    const comps = revYoYComponents(snap({ rev: [200, null, null, 50], revQ: [120, 110, 105, 102, 100] }));
    assert.ok(!comps.some((c) => Math.abs(c - (200 / 50 - 1)) < 1e-9), 'erfundener 3-Jahres-Sprung darf nicht vorkommen');
    assert.ok(comps.some((c) => Math.abs(c - 0.2) < 1e-9), 'quartals-lag4-Bein bleibt unabhaengig erhalten');
  });
})();

// --- BH-080: quarterQoQRates / marginTrajectory Adjazenz --------------------
(() => {
  const qsnap = (revQ, opQ) => ({ timeseries: { revenueQ: V(revQ), ...(opQ ? { opIncQ: V(opQ) } : {}) } });
  test('BH-080 quarterQoQRates: interne Luecke bricht die Kette (keine Ratio ueber den Gap hinweg)', () => {
    const g = quarterQoQRates(qsnap([120, null, 100, 90]));
    assert.equal(g.length, 1, 'nur das echte Nachbarpaar (100,90) darf eine Rate liefern');
    assert.ok(Math.abs(g[0] - (100 / 90 - 1)) < 1e-9);
  });
  test('BH-080 quarterQoQRates: lueckenlos -> unveraendert 2 Raten (Regression)', () => {
    assert.equal(quarterQoQRates(qsnap([120, 110, 100])).length, 2);
  });
  test('BH-080 marginTrajectory: fuehrende opIncQ-Luecke -> droppt statt stale Marge als "juengste"', () => {
    assert.equal(marginTrajectory(qsnap([100, 95, 90], [null, 10, 9])), null);
  });
  test('BH-080 marginTrajectory: lueckenlos -> unveraendert berechenbar (Regression)', () => {
    assert.ok(Number.isFinite(marginTrajectory(qsnap([100, 95, 90], [12, 10, 9]))));
  });
})();

// --- BH-081: profit-tier.js fuehrende annualOpInc-Luecke --------------------
(() => {
  const pfSnap = (op, ni) => ({ annual: { ...(op ? { annualOpInc: V(op) } : {}), ...(ni ? { annualNetIncome: V(ni) } : {}) } });
  test('BH-081 profitTierOf: fuehrende annualOpInc-Luecke (CI-Muster) -> Fallback auf NetIncome statt stale Jahr als "aktuell"', () => {
    const s = pfSnap([null, 8.44e9, -88.6e9, 7.3e9, 15.57e9], [-1e9, 2e9]);
    assert.equal(profitTierOf(s), 'nicht-profitabel'); // NetIncome[0]=-1e9 negativ, keine Q-Reihe -> nicht-profitabel
  });
  test('BH-081 profitTierOf: annualOpInc lueckenlos -> unveraendert (Regression)', () => {
    assert.equal(profitTierOf(pfSnap([5, 4, 3, 2], null)), 'langfristig-profitabel');
  });
})();

// --- BH-082: cycleSeriesPair Yahoo-Zweig Index0-Guard -----------------------
(() => {
  const cySnap = (op, rev) => ({ annual: { ...(op ? { annualOpInc: V(op) } : {}), ...(rev ? { annualRev: V(rev) } : {}) } });
  test('BH-082 cycleSeriesPair: fuehrende annualOpInc-Luecke im Yahoo-Zweig -> leeres Paar statt Zeit-Misch-Signal', () => {
    const s = cySnap([null, 5, -3, 4, -2, 6], [100, 90, 80, 70, 60, 50]);
    const { op, rev } = cycleSeriesPair(s);
    assert.equal(op.length, 0);
    assert.equal(rev.length, 0);
    assert.equal(cycleSignal(s, 0.1), 0, 'ohne zeitlich verbundenes Paar darf kein Zyklus-Signal feuern');
  });
  test('BH-082 cycleSeriesPair: beide Index0 present -> unveraendert Yahoo-Paar (Regression)', () => {
    const s = cySnap([6, -2, 4, -3, 5], [100, 90, 80, 70, 60]);
    const { op, rev } = cycleSeriesPair(s);
    assert.equal(op.length, 5);
    assert.equal(rev.length, 5);
  });
})();

// --- BH-076 + BH-083: gemeinsame grade-sichere Fixture (volle scoreUniverse-Pipeline) ---
// annual.annualRev>=3 + marketCap + metrics.revenueTTM -> Data-Quality-Grade B (nanRatio ~0.49, < C-
// Schwelle 0.85, criticalMissing false) -> isDataSuspect() excludiert die Fixture NICHT.
function gradeSafeSnap(ticker, revSeries) {
  return {
    meta: { ticker, sector: 'Test', industry: 'Test' },
    marketCap: { value: 5e9 },
    metrics: {
      revenueTTM: { value: revSeries[0] },
      revenueGrowthYoY: { value: 0 },
      grossMargin: { value: 0.5 },
      operatingMargin: { value: 0.1 },
      fcfMarginTTM: { value: 0.05 },
    },
    annual: { annualRev: V(revSeries) },
  };
}

// --- BH-083: coverageAxes vs coverageWeight ---------------------------------
(() => {
  test('BH-083 coverageAxes: w=0-Achse zaehlt NICHT im Nenner (konsistent zu coverageWeight)', () => {
    const formulas = { fx: { axes: [
      { key: 'revGrowthLevel', w: { profitable: 1 } },
      { key: 'capitalEfficiency', w: { profitable: 0 } }, // benannt-leere Achse wie QCs roicStability
    ] } };
    const universe = [
      gradeSafeSnap('T1', [120, 100, 100]),
      gradeSafeSnap('T2', [130, 100, 100]),
      gradeSafeSnap('T3', [110, 100, 100]),
    ];
    const opts = { classify: () => ({ action: 'route', formulaId: 'fx' }) };
    const out = scoreUniverse(universe, formulas, opts);
    const routed = out.filter((e) => e.action === 'route');
    assert.ok(routed.length > 0, 'mind. ein gerouteter Name');
    for (const e of routed) {
      assert.equal(e.coverageAxes, '1/1', `w=0-Achse darf nicht im Nenner zaehlen (bekam: ${e.coverageAxes})`);
      assert.equal(e.coverageWeight, 1, 'coverageWeight (engine.js) war schon vorher korrekt — nur die Anzeige wurde gefixt');
    }
  });
})();

// --- BH-076: calibrate.js opts-Seam (classify, growthBoost) ----------------
(() => {
  const formulas = { fx: { axes: [{ key: 'revGrowthLevel', w: { profitable: 1 } }], alpha: 2.3 } };
  const universe = [];
  for (let i = 0; i < 15; i++) universe.push(gradeSafeSnap('T' + i, [100 + i * 10, 100, 100])); // 15 distinkte Wachstumsraten 0%..140%
  const fakeClassify = () => ({ action: 'route', formulaId: 'fx' }); // route() kennt 'fx' nicht -> Beweis, dass classify wirklich benutzt wird

  test('BH-076 buildCalibMatrix: nutzt opts.classify statt hart route()', () => {
    const matrix = buildCalibMatrix(universe, formulas, { classify: fakeClassify });
    const cohort = matrix['fx|profitable'];
    assert.ok(cohort, 'Kohorte muss unter dem custom-classify-formulaId existieren');
    assert.equal(cohort.rows.length, universe.length);
  });
  test('BH-076 buildCalibMatrix: ohne opts (Default) -> route() (byte-identisches Altverhalten, kein Crash)', () => {
    assert.doesNotThrow(() => buildCalibMatrix(universe, formulas));
  });

  test('BH-076 productionCohortRanking: opts.classify reicht bis scoreUniverse durch (vorher: hart route(), Kohorte blieb leer)', () => {
    const ranked = productionCohortRanking(universe, formulas, 'fx', 'profitable', undefined, { classify: fakeClassify });
    assert.equal(ranked.length, universe.length, 'ohne die opts-Weiterleitung bliebe die Kohorte leer (route() kennt formulaId "fx" nicht)');
  });

  test('BH-076 productionCohortRanking: opts.growthBoost:false reicht bis zum Post-Faktor durch (Score-Differential)', () => {
    const withBoost = productionCohortRanking(universe, formulas, 'fx', 'profitable', undefined, { classify: fakeClassify });
    const noBoost = productionCohortRanking(universe, formulas, 'fx', 'profitable', undefined, { classify: fakeClassify, growthBoost: false });
    const scoreOf = (arr, t) => arr.find((e) => e.ticker === t).score;
    // T14 = staerkster Wachser (140%, Perzentil 1.0) -> Boost-Faktor > 1 nur wenn growthBoost aktiv ist.
    const diff = scoreOf(withBoost, 'T14') - scoreOf(noBoost, 'T14');
    assert.ok(diff > 0.01, `growthBoost:false muss den Score des Top-Wachsers senken (diff=${diff}) — sonst ist opts.growthBoost tot`);
  });
})();

console.log(`\nbh-w2-calib.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
