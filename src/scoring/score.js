'use strict';
/**
 * Hypergrowth Engine — Orchestrator
 * =================================
 * Verdrahtet die Schichten zu einem per-Aktie-Ergebnis. Weil q() COHORT-relativ
 * perzentil-normiert, arbeitet das Scoring ueber ein UNIVERSUM (nicht je Einzel-
 * aktie): erst alle Roh-Achsenwerte je Branchen+Track-Kohorte sammeln, dann
 * innerhalb der Kohorte perzentil-normieren, dann gewichtet (renorm-on-drop)
 * summieren. Lampen + Overview kommen getrennt obendrauf.
 *
 * scoreUniverse(snapshots, formulas) -> Array<Ergebnis je Aktie>:
 *   { ticker, action, formulaId, track, score|null, lamps[], overview, reason? }
 */

const { norm, metricVal } = require('./snapshot.js');
const { q, weightedScore, signTrack, fcfTrack } = require('./engine.js');
const { route } = require('./router.js');
const { evaluateLamps } = require('./lamps.js');
const { overviewMetric } = require('./overview.js');
const axesFns = require('./axes.js');

const tickerOf = (s) => (s && s.meta && s.meta.ticker) || (s && s.identifier && s.identifier.value) || '?';

// Roh-Achsenwert (ruleOfX braucht alpha + track-abhaengiges includeFcf).
function rawAxisValue(s, key, formula, track) {
  if (key === 'ruleOfX') return axesFns.ruleOfX(s, formula.alpha, track === 'profitable');
  const fn = axesFns[key];
  return typeof fn === 'function' ? fn(s) : null;
}

// Track-Zuordnung gemaess splitMetric der Branchen-Formel.
function trackOf(s, formula) {
  let t;
  switch (formula.splitMetric) {
    case 'FCF':
      t = fcfTrack(metricVal(s, 'fcfMarginTTM'), norm(s, 'annualFCF'), norm(s, 'annualOCF'));
      break;
    case 'OpInc': t = signTrack(norm(s, 'annualOpInc')); break;
    case 'NetIncome': t = signTrack(norm(s, 'annualNetIncome')); break;
    case 'none': default: t = 'profitable'; // Einzel-Formel-Branchen ohne Split
  }
  return t === 'unknown' ? 'profitable' : t; // konservativer Fallback
}

function scoreUniverse(snapshots, formulas) {
  const results = [];
  // 1. Routing + Track
  for (const s of (Array.isArray(snapshots) ? snapshots : [])) {
    const r = route(s);
    const base = { ticker: tickerOf(s), snapshot: s, lamps: evaluateLamps(s).active };
    if (r.action !== 'route') {
      results.push({ ...base, action: r.action, formulaId: null, track: null, score: null, reason: r.reason || r.track });
      continue;
    }
    const formula = formulas[r.formulaId];
    if (!formula) {
      results.push({ ...base, action: 'unrouted', formulaId: r.formulaId, track: null, score: null });
      continue;
    }
    results.push({
      ...base, action: 'route', formulaId: r.formulaId, gpClass: r.gpClass,
      track: trackOf(s, formula), formula, score: null,
    });
  }

  // 2. Kohorten (formulaId|track) bilden, Roh-Achsen sammeln, q()-normieren, gewichten
  const cohorts = {};
  for (const e of results) {
    if (e.action !== 'route') continue;
    (cohorts[e.formulaId + '|' + e.track] ||= []).push(e);
  }
  for (const entries of Object.values(cohorts)) {
    const formula = entries[0].formula;
    const track = entries[0].track;
    const rawByAxis = {};
    for (const ax of formula.axes) {
      rawByAxis[ax.key] = entries.map((e) => rawAxisValue(e.snapshot, ax.key, formula, track));
    }
    for (let i = 0; i < entries.length; i++) {
      const axes = formula.axes.map((ax) => ({
        value: q(rawByAxis[ax.key][i], rawByAxis[ax.key]), // Perzentil INNERHALB der Kohorte
        weight: ax.w[track],
      }));
      entries[i].score = weightedScore(axes);
    }
  }

  // 3. Overview-Metrik anhaengen + interne Felder entfernen
  for (const e of results) {
    if (e.action === 'route') {
      e.overview = overviewMetric(e.snapshot, { gpClass: e.gpClass, specialTrack: SPECIAL_OVERVIEW[e.formulaId] });
    } else if (e.action === 'survival') {
      // Pre-Revenue/Biotech: KEIN Growth-Score, nur Runway-Badge (Plan: nie growth-gescort)
      e.overview = overviewMetric(e.snapshot, { specialTrack: 'biotech' });
    }
    delete e.snapshot;
    delete e.formula;
  }
  return results;
}

// Branchen, deren Overview-Spalte eine track-eigene Badge statt GP-Wachstum nutzt.
const SPECIAL_OVERVIEW = { 'real-estate': 'reit' };

// Bequemer Helfer: gerankte Liste je Branche+Track (Score absteigend).
function rankBy(results, formulaId, track) {
  return results
    .filter((e) => e.action === 'route' && e.formulaId === formulaId && (!track || e.track === track) && e.score !== null)
    .sort((a, b) => b.score - a.score);
}

const round1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

/**
 * produceRankings(results, {topN}) -> dashboard-integrierbares JSON-Objekt:
 *   { branches: { <id>: { profitable:[...], unprofitable:[...] } },
 *     overview: [...cross-branch nach Score],
 *     survival: [...pre-revenue-biotech mit Runway],
 *     excluded: {<reason>: count} }
 * Reine Funktion (kein I/O) — vom CLI run-screener.js sowie Tests genutzt.
 */
function produceRankings(results, opts = {}) {
  const topN = opts.topN || 50;
  const branches = {};
  const overview = [];
  const survival = [];
  const excluded = {};
  for (const e of (Array.isArray(results) ? results : [])) {
    if (e.action === 'survival') {
      survival.push({ ticker: e.ticker, runwayQuarters: e.overview ? e.overview.value : null, lamps: e.lamps });
      continue;
    }
    if (e.action === 'exclude' || e.action === 'unrouted') {
      const k = e.reason || e.action;
      excluded[k] = (excluded[k] || 0) + 1;
      continue;
    }
    if (e.action !== 'route' || e.score === null) continue;
    const row = {
      ticker: e.ticker, score: round1(e.score), track: e.track, lamps: e.lamps,
      overview: e.overview ? { kind: e.overview.kind, value: round1(e.overview.value) } : null,
    };
    branches[e.formulaId] = branches[e.formulaId] || { profitable: [], unprofitable: [] };
    (branches[e.formulaId][e.track] = branches[e.formulaId][e.track] || []).push(row);
    overview.push({ ticker: e.ticker, formulaId: e.formulaId, track: e.track, score: round1(e.score),
      overviewKind: e.overview ? e.overview.kind : null, overviewValue: e.overview ? round1(e.overview.value) : null,
      lamps: e.lamps });
  }
  for (const b of Object.values(branches)) {
    for (const t of Object.keys(b)) { b[t].sort((a, c) => c.score - a.score); b[t] = b[t].slice(0, topN); }
  }
  overview.sort((a, c) => c.score - a.score);
  return { branches, overview: overview.slice(0, topN * 2), survival, excluded };
}

module.exports = { scoreUniverse, rankBy, trackOf, rawAxisValue, produceRankings };
