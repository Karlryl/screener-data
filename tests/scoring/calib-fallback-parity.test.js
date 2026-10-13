'use strict';
/**
 * R2.2 (Scoring-Court, PASS_MIT_AUFLAGEN, Karl-Entscheid E-20260717-5) — Kalibrier-Matrix ↔ Produktion
 * fuer DUENNE Kohorten (n < MIN_COHORT_N). Beweist den min-cohort-n Eltern-Basis-Fallback in
 * buildCalibMatrix: eine duenne Kohorte MUSS ihre Achsen-Perzentile gegen die ELTERN-Basis (Branche ueber
 * BEIDE Tracks) berechnen — exakt wie scoreUniverse (score.js parentBasis 591-604 / isFallback 615) —,
 * NICHT gegen die eigene duenne Stichprobe. Vor dem R2.2-Fix perzentiliert die Matrix die 3 duennen Namen
 * gegen die eigenen 3, die Produktion gegen alle 23 Geschwister-Namen beider Tracks -> Perzentile 50-78
 * Punkte auseinander.
 *
 * HARTE VORGABE (Auflage 1 / KILL 3): Vergleich auf Achsen-PERZENTIL-Werten (matrix.rows[i].pct[axis] vs.
 * scoreUniverse-Entry._axes[j].pct), NIEMALS auf Rang — ein Rang-Vergleich wuerde die Abweichung verdecken,
 * waehrend der Rang zufaellig gleich bleibt (der utilities-Fall).
 *
 * Fixture: das FAT/THIN-Semiconductor-Universum aus cohort-shrinkage.test.js (20 profitable + 3 unprofitable);
 * die duenne Kohorte semiconductors|unprofitable hat n=3 < MIN_COHORT_N=15. Universumsfrei -> CI-tauglich.
 *
 * Usage:  node tests/scoring/calib-fallback-parity.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { scoreUniverse, MIN_COHORT_N } = require('../../src/scoring/score.js');
const { buildCalibMatrix } = require('../../src/scoring/calibrate.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

// --- synthetisches, routebares Semiconductor-Universum (Spiegel cohort-shrinkage.test.js) --------------
const V = (arr) => arr.map((v) => ({ value: v }));
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

const FAT = 20, THIN = 3;
const universe = [];
for (let i = 0; i < FAT; i++) universe.push(profSemi('PF' + i, 5 + i * 4));      // g 5..81  -> profitable
for (let i = 0; i < THIN; i++) universe.push(unprofSemi('UN' + i, 8 + i * 10));  // g 8..28  -> unprofitable

const THIN_KEY = 'semiconductors|unprofitable';
const FAT_KEY = 'semiconductors|profitable';
const matrix = buildCalibMatrix(universe, formulas);
const results = scoreUniverse(universe, formulas);
const byTicker = Object.fromEntries(results.map((r) => [r.ticker, r]));

// --- Setup: die duenne Kohorte existiert und ist wirklich duenn; die fette Geschwister-Kohorte auch ---
test('Setup: duenne Kohorte (n < MIN_COHORT_N) UND fette Geschwister-Kohorte existieren', () => {
  const thin = matrix[THIN_KEY], fat = matrix[FAT_KEY];
  assert.ok(thin && thin.rows.length > 0, `duenne Kohorte ${THIN_KEY} fehlt in der Matrix`);
  assert.ok(thin.rows.length < MIN_COHORT_N, `n=${thin.rows.length} muss < ${MIN_COHORT_N} sein (Fallback-Trigger)`);
  // Diskriminanz: nur wenn eine fette Geschwister-Kohorte existiert, weicht Eltern-Basis von der eigenen ab
  // -> der Test beisst ueberhaupt. (23 Eltern-Namen vs. 3 eigene.)
  assert.ok(fat && fat.rows.length >= MIN_COHORT_N, `fette Geschwister-Kohorte ${FAT_KEY} noetig, damit Eltern != eigene`);
});

// --- KERN (Auflage 1): Matrix-Perzentile der duennen Kohorte == Produktions-_axes-Perzentile ----------
// pct-Werte VOR Shrinkage (matrix.rows[i].pct == q(); score.js _axes[j].pct == q(), beide vor EB-Shrinkage).
test('Fallback-Paritaet: matrix.rows[i].pct[axis] == scoreUniverse._axes[j].pct fuer JEDEN duennen Namen/jede Achse', () => {
  const thin = matrix[THIN_KEY];
  let compared = 0;
  for (const row of thin.rows) {
    const prod = byTicker[row.ticker];
    assert.ok(prod && prod.action === 'route', `${row.ticker} nicht in Produktion geroutet (action=${prod && prod.action})`);
    const prodPct = Object.fromEntries(prod._axes.map((a) => [a.key, a.pct]));
    for (const k of thin.axisKeys) {
      const a = row.pct[k], b = prodPct[k];
      // HARTE VORGABE: PERZENTIL-Werte vergleichen, NIEMALS Rang.
      if (a === null || a === undefined || b === null || b === undefined) {
        assert.equal(a == null ? null : a, b == null ? null : b, `${row.ticker}.${k}: null-Mismatch (matrix=${a} prod=${b})`);
      } else {
        assert.ok(Math.abs(a - b) < 1e-6, `${row.ticker}.${k}: Matrix-Perzentil ${a} != Produktion ${b} (Delta ${Math.abs(a - b).toFixed(2)})`);
        compared++;
      }
    }
  }
  assert.ok(compared > 0, 'kein einziger present-Perzentil-Vergleich — Test beisst nicht');
  console.log(`       ${compared} present-Achsen-Perzentile der duennen Kohorte gegen Produktion verglichen`);
});

console.log(`\ncalib-fallback-parity.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
