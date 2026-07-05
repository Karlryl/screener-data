const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { scoreUniverse } = require(ROOT + '/src/scoring/score.js');
const { buildCalibMatrix } = require(ROOT + '/src/scoring/calibrate.js');
const formulas = require(ROOT + '/src/scoring/formulas/index.js');
const dir = ROOT + '/snapshots';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const universe = [];
for (const f of files) { try { universe.push(JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))); } catch(e){} }
const results = scoreUniverse(universe, formulas);
const liveRouteTickers = new Set(results.filter(e => e.action === 'route').map(e => e.ticker));
const liveUniverse = universe.filter(s => liveRouteTickers.has(s.meta && s.meta.ticker));
const mFull = buildCalibMatrix(universe, formulas);
const mLive = buildCalibMatrix(liveUniverse, formulas);
// defaultWeights identical per cohort?
let diff = 0;
for (const key of Object.keys(mLive)) {
  if (!mFull[key]) continue;
  if (JSON.stringify(mFull[key].defaultWeights) !== JSON.stringify(mLive[key].defaultWeights)) { diff++; console.log('WEIGHTS DIFFER', key); }
}
console.log('cohorts with differing defaultWeights:', diff, '(0 => score-shift is pure percentile drift, not weight artifact)');
