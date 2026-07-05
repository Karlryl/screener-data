'use strict';
// R2F1 counterfactual: compare baseline dilution (clamp->null out of [0,1])
// vs. a CAP variant (out-of-range -> clamp to 1, keep the axis) over the REAL
// scoreUniverse. Report score + within-(branch|track) rank deltas for affected names.
const fs = require('fs');
const path = require('path');

const SNAP_DIR = path.join(__dirname, '..', 'snapshots');
const formulas = require('../src/scoring/formulas/index.js');
const axesFns = require('../src/scoring/axes.js');
const snap = require('../src/scoring/snapshot.js');
const { norm, hasPresent, firstPresent, ratioSeries } = snap;

function loadUniverse() {
  const u = [];
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!f.endsWith('.json') || f.startsWith('_manifest')) continue;
    let s; try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    if (s && s.meta && s.meta.ticker) u.push(s);
  }
  return u;
}

function lastPresent(series) {
  if (!Array.isArray(series)) return null;
  for (let i = series.length - 1; i >= 0; i--) if (series[i] !== null && series[i] !== undefined) return series[i];
  return null;
}

// CAP variant: out-of-range clamps INTO [0,1] (1 for >1, 0 for <0) instead of null.
function dilutionCap(s) {
  const sbc = norm(s, 'annualSBC');
  if (!hasPresent(sbc)) return null;
  const r = ratioSeries(sbc, norm(s, 'annualRev'))
    .map((v) => v === null ? null : (v > 1 ? 1 : (v < 0 ? 0 : v)));
  const level = firstPresent(r);
  if (level === null) return null;
  const old = lastPresent(r);
  const slope = (old !== null) ? (level - old) : 0;
  return -(level) - slope;
}

function runScore() {
  // fresh require of score.js each time so it picks up patched axesFns? score.js requires axes once.
  // Instead we patch axesFns.dilution in place and require score.js once.
  delete require.cache[require.resolve('../src/scoring/score.js')];
  const { scoreUniverse } = require('../src/scoring/score.js');
  const universe = loadUniverse();
  return scoreUniverse(universe, formulas);
}

function indexByTicker(results) {
  const m = {};
  for (const e of results) m[e.ticker] = e;
  return m;
}

// rank within (formulaId|track) among action=route, score desc, ties by ticker
function rankMap(results) {
  const groups = {};
  for (const e of results) {
    if (e.action !== 'route' || e.score === null) continue;
    const k = e.formulaId + '|' + e.track;
    (groups[k] ||= []).push(e);
  }
  const ranks = {};
  for (const [k, arr] of Object.entries(groups)) {
    arr.sort((a, b) => b.score - a.score || (a.ticker < b.ticker ? -1 : 1));
    arr.forEach((e, i) => { ranks[e.ticker] = { rank: i + 1, n: arr.length, key: k }; });
  }
  return ranks;
}

// BASELINE
const baseResults = runScore();
const baseIdx = indexByTicker(baseResults);
const baseRanks = rankMap(baseResults);

// PATCH dilution -> cap, re-run
const origDilution = axesFns.dilution;
axesFns.dilution = dilutionCap;
const capResults = runScore();
const capIdx = indexByTicker(capResults);
const capRanks = rankMap(capResults);
axesFns.dilution = origDilution; // restore

const names = ['ABVX','CRNX','ACHR','AEVA','AUR','CGON','DNTH','AAVXF','ENVX','CLDX','ABSI','ATEX','ALMS'];
console.log('ticker  | base action/score/rank        -> cap action/score/rank      (delta)');
for (const t of names) {
  const b = baseIdx[t], c = capIdx[t];
  if (!b) { console.log(t, 'NOT IN UNIVERSE'); continue; }
  const br = baseRanks[t], cr = capRanks[t];
  const bScore = b.score === null ? 'null' : b.score.toFixed(1);
  const cScore = (c && c.score !== null) ? c.score.toFixed(1) : 'null';
  const bRank = br ? `${br.rank}/${br.n}` : '-';
  const cRank = cr ? `${cr.rank}/${cr.n}` : '-';
  const d = (b.score !== null && c && c.score !== null) ? (c.score - b.score).toFixed(2) : 'n/a';
  console.log(`${t.padEnd(7)} | ${b.action} ${bScore} ${b.track||''} r${bRank}  ->  ${c?c.action:'?'} ${cScore} r${cRank}   d=${d}`);
}

// global sanity: how many route names change score at all, and aggregate direction
let changed = 0, up = 0, down = 0, sumAbs = 0;
for (const e of baseResults) {
  if (e.action !== 'route' || e.score === null) continue;
  const c = capIdx[e.ticker];
  if (!c || c.score === null) continue;
  const d = c.score - e.score;
  if (Math.abs(d) > 1e-9) { changed++; if (d > 0) up++; else down++; sumAbs += Math.abs(d); }
}
console.log('\nroute names with score change (cap vs base):', changed, 'up:', up, 'down:', down, 'meanAbs:', (sumAbs/Math.max(changed,1)).toFixed(3));
