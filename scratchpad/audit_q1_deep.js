'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse, produceRankings } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');
const SNAP_DIR = path.join(__dirname, '..', 'snapshots');
const files = fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json'));
const universe = [];
for (const f of files) { try { const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); if (s && s.meta && s.meta.ticker) universe.push(s); } catch (_) {} }
const results = scoreUniverse(universe, formulas);
const ranked = produceRankings(results, { topN: 100 });

// For each overview row, is the ticker present in its OWN branch list (which is capped at topN=100)?
// branches lists are per formulaId+track and capped at 100; overview holds 200 across ALL branches.
// A name ranked e.g. 150th overall by score, but it's #120 within its own branch-track -> would be
// DROPPED from its branch file (cap 100) yet SHOWN in overview (cap 200). That is a real dashboard
// inconsistency: overview row links to a branch tab where the name is absent.
const branchIndex = {}; // formulaId -> track -> Set(ticker)
for (const [id, b] of Object.entries(ranked.branches)) {
  branchIndex[id] = {};
  for (const t of Object.keys(b)) branchIndex[id][t] = new Set(b[t].map(r=>r.ticker));
}
let inOverviewNotInBranch = [];
for (const ov of ranked.overview) {
  const set = branchIndex[ov.formulaId] && branchIndex[ov.formulaId][ov.track];
  if (!set || !set.has(ov.ticker)) inOverviewNotInBranch.push(ov.ticker+' ('+ov.formulaId+'/'+ov.track+', score '+ov.score+')');
}
console.log('overview rows whose ticker is ABSENT from its own (topN-capped) branch list:', inOverviewNotInBranch.length);
console.log(inOverviewNotInBranch.slice(0, 20).join('\n'));

// Distribution: how many names per branch-track exceed 100 (so cap actually bites)?
const counts = {};
for (const e of results) if (e.action==='route'&&e.score!==null){ const k=e.formulaId+'/'+e.track; counts[k]=(counts[k]||0)+1; }
const over100 = Object.entries(counts).filter(([k,v])=>v>100).sort((a,c)=>c[1]-a[1]);
console.log('\nbranch-tracks with >100 scored names (cap bites):', over100.length);
over100.forEach(([k,v])=>console.log('  '+k+': '+v));
