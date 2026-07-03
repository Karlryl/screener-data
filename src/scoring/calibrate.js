'use strict';
/**
 * Kalibrier-Harness fuer die per-Formel-Gewichts-Optimierung.
 *
 * Schluessel-Einsicht: die q()-Achsen-Perzentile einer Kohorte sind FIX (haengen
 * nur von den Roh-Achsenwerten der Kohorte ab, NICHT von den Gewichten). Also
 * EINMAL die Perzentil-Matrix bauen (teuer: Universum laden), dann ist jede
 * Gewichts-Bewertung ein sofortiges gewichtetes Mittel (renorm-on-drop). Damit
 * koennen Sub-Agenten hunderte Gewichts-Vektoren instant testen.
 *
 * Hinweis: ruleOfX-Rohwert haengt von formula.alpha ab -> Matrix gilt fuer FIXES
 * alpha. Gewichts-Kalibrierung ist instant; alpha-Aenderung braucht Rebuild.
 */
const { route } = require('./router.js');
const { q, signTrack } = require('./engine.js');
const { norm } = require('./snapshot.js');
const { evaluateLamps } = require('./lamps.js');
const { trackOf, rawAxisValue } = require('./score.js');

// Baut pro (formulaId|track) die Perzentil-Matrix: rows[{ticker, pct:{axis:0-100}, lamps}].
function buildCalibMatrix(universe, formulas) {
  const routed = [];
  for (const s of (Array.isArray(universe) ? universe : [])) {
    const r = route(s);
    if (r.action !== 'route') continue;
    const formula = formulas[r.formulaId];
    if (!formula) continue;
    const track = trackOf(s, formula); // liefert nie 'unknown' (Fallback intern -> profitable)
    routed.push({ s, formulaId: r.formulaId, track, formula, ticker: (s.meta && s.meta.ticker) || '?', lamps: evaluateLamps(s).active });
  }
  const cohorts = {};
  for (const e of routed) (cohorts[e.formulaId + '|' + e.track] = cohorts[e.formulaId + '|' + e.track] || []).push(e);

  const matrix = {};
  for (const [key, entries] of Object.entries(cohorts)) {
    const formula = entries[0].formula;
    const track = entries[0].track;
    const axisKeys = formula.axes.map((a) => a.key);
    const rawByAxis = {};
    for (const k of axisKeys) rawByAxis[k] = entries.map((e) => rawAxisValue(e.s, k, formula, track));
    // audit/fix (C1): score.js perzentiliert capitalEfficiency bei subCohortByProfit-Branchen
    // (real-estate/it-services) gegen die profit-Vorzeichen-Sub-Kohorte (Iron-Rule 2). Hier exakt
    // spiegeln (score.js:85-98), sonst weicht die Kalibrier-Matrix von der Produktion ab -> Weights
    // wuerden gegen ein Ranking getunt, das Produktion fuer diese 2 Branchen nie erzeugt (100% Mismatch).
    const profitSign = formula.subCohortByProfit
      ? entries.map((e) => signTrack(norm(e.s, 'annualOpInc')))
      : null;
    const rows = entries.map((e, i) => {
      const pct = {};
      for (const k of axisKeys) {
        let cohort = rawByAxis[k];
        if (profitSign && k === 'capitalEfficiency') {
          cohort = cohort.filter((_, j) => profitSign[j] === profitSign[i]);
        }
        pct[k] = q(rawByAxis[k][i], cohort);
      }
      return { ticker: e.ticker, pct, lamps: e.lamps };
    });
    matrix[key] = { formulaId: entries[0].formulaId, track, axisKeys, defaultWeights: weightsObj(formula, track), alpha: formula.alpha, rows };
  }
  return matrix;
}

function weightsObj(formula, track) {
  const w = {};
  for (const ax of formula.axes) w[ax.key] = ax.w[track];
  return w;
}

// Gewichtetes Mittel der vorhandenen Achsen-Perzentile (renorm-on-drop).
function scoreWithWeights(pct, weights) {
  let w = 0, v = 0;
  for (const k of Object.keys(weights)) {
    const p = pct[k];
    if (p === null || p === undefined || !Number.isFinite(p)) continue;
    const wt = weights[k];
    if (!(wt > 0) || !Number.isFinite(wt)) continue;
    w += wt; v += wt * p;
  }
  return w > 0 ? v / w : null;
}

function rankCohort(cohort, weights) {
  return cohort.rows
    .map((r) => ({ ticker: r.ticker, score: scoreWithWeights(r.pct, weights), lamps: r.lamps }))
    .filter((r) => r.score !== null)
    .sort((a, b) => b.score - a.score);
}

/**
 * Diagnose einer Gewichtung gegen Anker/Decliner/Peak-Falle.
 * anchorPos/declinerPos in [0,1] (0 = Spitze). peakTrap = Anteil Top-10 mit Peak-Lampe.
 */
function diagnostics(cohort, weights, opts = {}) {
  const anchors = opts.anchors || [];
  const decliners = opts.decliners || [];
  const peakLamps = opts.peakLamps || ['peakMargin', 'lowRoic'];
  const ranked = rankCohort(cohort, weights);
  const n = ranked.length || 1;
  const posOf = (t) => { const i = ranked.findIndex((r) => r.ticker === t); return i < 0 ? null : i / n; };
  const top10 = ranked.slice(0, 10);
  return {
    n: ranked.length,
    anchorPos: anchors.map((t) => ({ ticker: t, pct: posOf(t), rank: ranked.findIndex((r) => r.ticker === t) + 1 || null })),
    declinerPos: decliners.map((t) => ({ ticker: t, pct: posOf(t), rank: ranked.findIndex((r) => r.ticker === t) + 1 || null })),
    peakTrapTop10: top10.filter((r) => r.lamps.some((l) => peakLamps.includes(l))).length / Math.max(1, top10.length),
    top10: top10.map((r) => ({ ticker: r.ticker, score: Math.round(r.score * 10) / 10, lamps: r.lamps })),
  };
}

// Dump der Perzentil-Matrix pro Branche nach outputs/hypergrowth/calib/<id>.json
// (damit Sub-Agenten billig laden statt das Universum neu zu parsen).
function dumpMatrix() {
  const fs = require('fs');
  const path = require('path');
  const { writeJsonAtomic } = require('../../lib/atomic-write.js'); // audit/fix (C2): atomar dumpen
  const { loadUniverse } = require('./run-screener.js');
  const formulas = require('./formulas/index.js');
  const universe = loadUniverse();
  const matrix = buildCalibMatrix(universe, formulas);
  const outDir = path.join(__dirname, '..', '..', 'outputs', 'hypergrowth', 'calib');
  fs.mkdirSync(outDir, { recursive: true });
  const byBranch = {};
  for (const [key, cohort] of Object.entries(matrix)) {
    const [fid, track] = key.split('|');
    (byBranch[fid] = byBranch[fid] || {})[track] = cohort;
  }
  for (const [fid, tracks] of Object.entries(byBranch)) {
    // audit/fix (C2): atomar; indent 0 = kompakt, byte-identisch zum bisherigen JSON.stringify(tracks).
    writeJsonAtomic(path.join(outDir, fid + '.json'), tracks, { indent: 0 });
  }
  return { universe: universe.length, branches: Object.keys(byBranch), dir: outDir };
}

if (require.main === module) {
  const r = dumpMatrix();
  console.log(`Calib-Matrix gedumpt: ${r.branches.length} Branchen (Universum ${r.universe}) -> ${r.dir}`);
}

module.exports = { buildCalibMatrix, weightsObj, scoreWithWeights, rankCohort, diagnostics, dumpMatrix };
