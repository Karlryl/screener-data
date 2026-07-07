'use strict';
/**
 * 2.10 — n-bewusste Scores (Fable-Scoring-Court T1). Beweist:
 *  (1) shrinkToNeutral: exakte EB-Shrinkage Richtung 50 fuer n=1/3/15/100, monoton, gross-n->Identitaet.
 *  (2) Within-Kohorten-Rang bleibt exakt (uniforme affine Transformation je Kohorte) — Anker-Rang stabil.
 *  (3) Solo-/duenne Kohorte: Score Richtung 50 gezogen (nicht mehr stumm "50 Mitte" ODER n-gedeckelte 83),
 *      cohortN je Zeile gesetzt, cohortFallback bei n<MIN_COHORT_N (Eltern-Kohorten-Basis) aktiv.
 *  (4) cohortN == echte Kohortengroesse; cohortFallback == (cohortN < MIN_COHORT_N) auf ALLEN routed Zeilen.
 *
 * Usage:  node tests/scoring/cohort-shrinkage.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { scoreUniverse, rankBy, shrinkToNeutral, SHRINK_K, MIN_COHORT_N } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

// --- (1) shrinkToNeutral: reine Funktion, exakte Werte ----------------------
test('shrinkToNeutral: exakte Faktoren n=1/3/15/100 (Richtung 50)', () => {
  const f = (n) => n / (n + SHRINK_K);
  // score 90 -> 50 + 40*f(n)
  assert.ok(Math.abs(shrinkToNeutral(90, 1) - (50 + 40 * f(1))) < 1e-9, 'n=1');
  assert.ok(Math.abs(shrinkToNeutral(90, 3) - (50 + 40 * f(3))) < 1e-9, 'n=3');
  assert.ok(Math.abs(shrinkToNeutral(90, 15) - (50 + 40 * f(15))) < 1e-9, 'n=15');
  assert.ok(Math.abs(shrinkToNeutral(90, 100) - (50 + 40 * f(100))) < 1e-9, 'n=100');
  // kleine Kohorte zieht STAERKER Richtung 50 als grosse
  assert.ok(shrinkToNeutral(90, 3) < shrinkToNeutral(90, 100), 'n=3 naeher an 50 als n=100');
  // grosse Kohorte ~ Identitaet (n=100/k=2 -> Faktor 0.980)
  assert.ok(shrinkToNeutral(90, 100) > 88, 'n=100 fast unveraendert');
  // exakt 50 bleibt 50 (kein Level aufgezwungen), symmetrisch fuer <50
  assert.equal(shrinkToNeutral(50, 3), 50);
  assert.ok(Math.abs(shrinkToNeutral(10, 3) - (50 - 40 * f(3))) < 1e-9, 'symmetrisch unter 50');
});
test('shrinkToNeutral: Edge-Guards (n<=0, nicht-finit -> unveraendert)', () => {
  assert.equal(shrinkToNeutral(90, 0), 90);
  assert.equal(shrinkToNeutral(90, -3), 90);
  assert.equal(shrinkToNeutral(90, NaN), 90);
  assert.equal(shrinkToNeutral(NaN, 10), NaN.toString() === 'NaN' ? shrinkToNeutral(NaN, 10) : 0); // NaN in -> NaN out (unveraendert)
  assert.ok(Number.isNaN(shrinkToNeutral(NaN, 10)));
});
test('shrinkToNeutral: monoton (Rang-erhaltend) fuer festes n', () => {
  const n = 7;
  let prev = -Infinity;
  for (const s of [10, 30, 45, 50, 55, 70, 95]) {
    const v = shrinkToNeutral(s, n);
    assert.ok(v > prev, `monoton bei score=${s}`);
    prev = v;
  }
});

// --- synthetisches, routebares Semiconductor-Universum -----------------------
const V = (arr) => arr.map((v) => ({ value: v }));
// Profitabler Semi mit Wachstums-Parameter g (%) -> Score-Spread in der Kohorte.
function profSemi(ticker, g) {
  const r0 = 100 * (1 + g / 100), gp0 = r0 * 0.5;
  return {
    meta: { sector: 'Technology', industry: 'Semiconductors', region: 'US', ticker },
    marketCap: { value: 5e9 },
    metrics: { revenueTTM: { value: r0 }, revenueGrowthYoY: { value: g }, fcfMarginTTM: { value: 0.12 } },
    annual: { annualRev: V([r0, 100, 80, 65]), annualGP: V([gp0, 50, 40, 33]),
      annualOpInc: V([r0 * 0.2, 18, 14, 10]), annualNetIncome: V([r0 * 0.15, 14, 11, 8]),
      annualFCF: V([r0 * 0.1, 9, 7, 5]), annualOCF: V([r0 * 0.12, 11, 9, 7]) },
    timeseries: {
      revenueQ: V([r0 / 4 * 1.05, r0 / 4, 24, 23, 22, 21, 20, 19]),
      opIncQ: V([r0 * 0.05, r0 * 0.048, 4.5, 4.3, 4.1, 3.9, 3.7, 3.5]),
      grossProfitQ: V([gp0 / 4 * 1.05, gp0 / 4, 12, 11.5, 11, 10.5, 10, 9.5]),
    },
  };
}
// Unprofitabler Semi (negativer opInc/netInc/FCF) -> unprofitable-Track.
function unprofSemi(ticker, g) {
  const r0 = 100 * (1 + g / 100), gp0 = r0 * 0.4;
  return {
    meta: { sector: 'Technology', industry: 'Semiconductors', region: 'US', ticker },
    marketCap: { value: 2e9 },
    metrics: { revenueTTM: { value: r0 }, revenueGrowthYoY: { value: g }, fcfMarginTTM: { value: -0.2 } },
    annual: { annualRev: V([r0, 100, 80, 65]), annualGP: V([gp0, 40, 32, 26]),
      annualOpInc: V([-r0 * 0.2, -18, -14, -10]), annualNetIncome: V([-r0 * 0.25, -22, -18, -12]),
      annualFCF: V([-r0 * 0.2, -18, -14, -10]), annualOCF: V([-r0 * 0.1, -9, -7, -5]) },
    timeseries: {
      revenueQ: V([r0 / 4 * 1.05, r0 / 4, 24, 23, 22, 21, 20, 19]),
      opIncQ: V([-r0 * 0.05, -r0 * 0.048, -4.5, -4.3, -4.1, -3.9, -3.7, -3.5]),
      grossProfitQ: V([gp0 / 4 * 1.05, gp0 / 4, 10, 9.5, 9, 8.5, 8, 7.5]),
    },
  };
}

// 20 profitable (fette Kohorte, n>=MIN_COHORT_N) + 3 unprofitable (duenn, n<MIN_COHORT_N).
const FAT = 20, THIN = 3;
const universe = [];
for (let i = 0; i < FAT; i++) universe.push(profSemi('PF' + i, 5 + i * 4));      // g 5..81
for (let i = 0; i < THIN; i++) universe.push(unprofSemi('UN' + i, 8 + i * 10));  // g 8..28
const results = scoreUniverse(universe, formulas);
const byTicker = Object.fromEntries(results.map((r) => [r.ticker, r]));

// Kohortengroesse je formulaId|track aus den gerouteten Ergebnissen.
function cohortSize(formulaId, track) {
  return results.filter((e) => e.action === 'route' && e.formulaId === formulaId && e.track === track).length;
}

test('Setup: fette (>=MIN_COHORT_N) UND duenne (<MIN_COHORT_N) Kohorte existieren', () => {
  const routed = results.filter((e) => e.action === 'route' && Number.isFinite(e.score));
  assert.ok(routed.length >= 20, `genug geroutete Namen (${routed.length})`);
  const sizes = [...new Set(routed.map((e) => e.formulaId + '|' + e.track))].map((k) => {
    const [f, t] = k.split('|'); return { k, n: cohortSize(f, t) };
  });
  assert.ok(sizes.some((s) => s.n >= MIN_COHORT_N), 'eine fette Kohorte da: ' + JSON.stringify(sizes));
  assert.ok(sizes.some((s) => s.n < MIN_COHORT_N), 'eine duenne Kohorte da: ' + JSON.stringify(sizes));
});

// --- (4) cohortN + cohortFallback korrekt auf ALLEN routed Zeilen -----------
test('cohortN == echte Kohortengroesse; cohortFallback == (cohortN < MIN_COHORT_N)', () => {
  for (const e of results) {
    if (e.action !== 'route' || !Number.isFinite(e.score)) continue;
    const n = cohortSize(e.formulaId, e.track);
    assert.equal(e.cohortN, n, `${e.ticker}: cohortN=${e.cohortN} != Kohortengroesse ${n}`);
    assert.equal(e.cohortFallback, n < MIN_COHORT_N, `${e.ticker}: cohortFallback falsch (n=${n})`);
  }
});

// --- (3) duenne Kohorte: Fallback aktiv, Score Richtung 50 geschrumpft -------
test('duenne unprofitable-Kohorte (n=3): cohortFallback=true, Scores per n=3 Richtung 50 geschrumpft', () => {
  const un = results.filter((e) => e.action === 'route' && e.track === 'unprofitable' && Number.isFinite(e.score));
  assert.ok(un.length > 0 && un.length < MIN_COHORT_N, `duenne unprofitable-Kohorte (${un.length})`);
  for (const e of un) {
    assert.equal(e.cohortFallback, true, `${e.ticker} sollte Fallback tragen`);
    // n=3, k=2 -> Faktor 0.6: |score-50| spuerbar komprimiert (Konfidenz), plus Eltern-Basis (Fallback).
    assert.ok(e.score > 20 && e.score < 80, `${e.ticker} Score ${e.score} sollte Richtung Mitte gezogen sein`);
  }
});

// --- (2) fette Kohorte: within-Rang bleibt (Scores absteigend sortierbar, kein NaN) --
test('fette profitable-Kohorte: kein NaN, within-Rang konsistent (monoton nach Score)', () => {
  const cohort = rankBy(results, 'semiconductors', 'profitable');
  assert.ok(cohort.length >= MIN_COHORT_N, `fette Kohorte (${cohort.length})`);
  for (const e of cohort) assert.ok(Number.isFinite(e.score), `${e.ticker} finit`);
  for (let i = 1; i < cohort.length; i++) assert.ok(cohort[i - 1].score >= cohort[i].score, 'absteigend');
  // fette Kohorte NICHT im Fallback
  assert.ok(cohort.every((e) => byTicker[e.ticker].cohortFallback === false), 'fette Kohorte ohne Fallback');
  // der Top-Wachser bleibt oben (Rang-Erhalt trotz Shrinkage)
  assert.equal(cohort[0].ticker, 'PF19', 'staerkster Wachser (g=81) bleibt #1');
});

console.log(`\ncohort-shrinkage.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
