const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { scoreUniverse } = require(ROOT + '/src/scoring/score.js');
const { buildCalibMatrix, rankCohort } = require(ROOT + '/src/scoring/calibrate.js');
const formulas = require(ROOT + '/src/scoring/formulas/index.js');

const dir = ROOT + '/snapshots';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const universe = [];
const byTicker = {};
for (const f of files) {
  try { const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); universe.push(s); byTicker[(s.meta&&s.meta.ticker)||f] = s; }
  catch (e) {}
}

// live-gated universe: only snapshots whose ticker ends action==='route'
const results = scoreUniverse(universe, formulas);
const liveRouteTickers = new Set(results.filter(e => e.action === 'route').map(e => e.ticker));
const liveUniverse = universe.filter(s => liveRouteTickers.has((s.meta && s.meta.ticker)));
console.log('full universe:', universe.length, 'liveUniverse:', liveUniverse.length);

const mFull = buildCalibMatrix(universe, formulas);
const mLive = buildCalibMatrix(liveUniverse, formulas);

// For each cohort present in both, rank with default weights, compare ranks of names present in BOTH
let worstRankShift = 0, worstRankName = '', worstRankKey = '';
let worstScoreShift = 0, worstScoreName = '', worstScoreKey = '';
let cohortsAffected = 0;
const cohortPhantomPct = [];
for (const key of Object.keys(mLive)) {
  const cf = mFull[key], cl = mLive[key];
  if (!cf) continue;
  const wFull = cf.defaultWeights, wLive = cl.defaultWeights;
  const rFull = rankCohort(cf, wFull);
  const rLive = rankCohort(cl, wLive);
  const idxFull = {}; rFull.forEach((r,i)=>idxFull[r.ticker]=i);
  const idxLive = {}; rLive.forEach((r,i)=>idxLive[r.ticker]=i);
  const scoreFull = {}; rFull.forEach(r=>scoreFull[r.ticker]=r.score);
  const scoreLive = {}; rLive.forEach(r=>scoreLive[r.ticker]=r.score);
  const phantomCount = cf.rows.length - cl.rows.length;
  if (cl.rows.length>0) cohortPhantomPct.push({key, pct: phantomCount/cf.rows.length, n: cl.rows.length, phantom: phantomCount});
  let anyShift = false;
  for (const t of Object.keys(idxLive)) {
    if (!(t in idxFull)) continue;
    const ds = Math.abs(idxFull[t] - idxLive[t]);
    if (ds > 0) anyShift = true;
    if (ds > worstRankShift) { worstRankShift = ds; worstRankName = t; worstRankKey = key; }
    const dsc = Math.abs((scoreFull[t]||0) - (scoreLive[t]||0));
    if (dsc > worstScoreShift) { worstScoreShift = dsc; worstScoreName = t; worstScoreKey = key; }
  }
  if (anyShift) cohortsAffected++;
}
console.log('cohorts in live matrix:', Object.keys(mLive).length, 'cohorts with >=1 rank shift:', cohortsAffected);
console.log('WORST rank shift:', worstRankShift, 'name', worstRankName, 'cohort', worstRankKey);
console.log('WORST score shift:', worstScoreShift.toFixed(3), 'name', worstScoreName, 'cohort', worstScoreKey);
cohortPhantomPct.sort((a,b)=>b.pct-a.pct);
console.log('top phantom-% cohorts:');
for (const c of cohortPhantomPct.slice(0,5)) console.log('  ', c.key, 'phantom', c.phantom, '/', c.n+c.phantom, '=', (100*c.pct).toFixed(1)+'%');
