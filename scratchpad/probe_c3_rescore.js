'use strict';
const fs=require('fs'), path=require('path');
const dq = require('../methods/data-quality.js');
const SNAP='snapshots';

// Monkeypatch gradeSnapshot: D->C ONLY when criticalMissing is solely from revenueTTM null (marketCap present).
const orig = dq.gradeSnapshot;
const targetTickers = new Set(['AB','AIAI','AIIR','AMLX','BRAI','BVC','DNLI','ERIC','FDXF','FRBP','HYMC','KBDC','OCTV','PDX','PRAX','RTEZ','RVMD','SMMT','SRRK','SYRE','VFS']);
dq.gradeSnapshot = function(s){
  const g = orig(s);
  const t = s&&s.meta&&s.meta.ticker;
  if(targetTickers.has(t) && g.grade==='D' && g.criticalMissing){
    // re-grade ignoring the criticalMissing floor: recompute band from nanRatio
    const nr = g.nanRatio;
    let grade;
    if(nr<=0.20)grade='A+'; else if(nr<=0.40)grade='A'; else if(nr<=0.60)grade='B'; else if(nr<=0.85)grade='C'; else grade='D';
    return {...g, grade, criticalMissing:false, _patched:true};
  }
  return g;
};

// Now require score AFTER patching (score.js binds gradeSnapshot at require). Need fresh module.
delete require.cache[require.resolve('../src/scoring/score.js')];
const { scoreUniverse, produceRankings } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');

const universe=[];
for(const f of fs.readdirSync(SNAP)){
  if(!f.endsWith('.json')||f.startsWith('_manifest'))continue;
  let s; try{ s=JSON.parse(fs.readFileSync(path.join(SNAP,f),'utf8')); }catch(_){continue;}
  if(s&&s.meta&&s.meta.ticker)universe.push(s);
}
const results = scoreUniverse(universe, formulas);
const byTicker={};
for(const r of results) byTicker[r.ticker]=r;
let valid=0, exclu=0, other=0;
const rows=[];
for(const t of targetTickers){
  const r=byTicker[t];
  if(!r){ rows.push(`${t.padEnd(8)} <not found>`); continue; }
  if(r.action==='route' && r.score!==null){ valid++; rows.push(`${t.padEnd(8)} route score=${r.score} formula=${r.formulaId} track=${r.track}`); }
  else if(r.action==='exclude'){ exclu++; rows.push(`${t.padEnd(8)} EXCLUDE reason=${r.reason}`); }
  else { other++; rows.push(`${t.padEnd(8)} action=${r.action} reason=${r.reason||''} score=${r.score}`); }
}
console.log('=== Re-score with D->C patch for the 21 mcPresent names ===');
rows.sort();
for(const x of rows)console.log(x);
console.log('---');
console.log('valid route+score:', valid, ' exclude:', exclu, ' other:', other);
