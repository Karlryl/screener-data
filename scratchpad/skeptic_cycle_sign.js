'use strict';
const fs=require('fs'), path=require('path');
const R='C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
process.chdir(R);
const SNAP='snapshots';

function loadUniverse(){
  const u=[];
  for(const f of fs.readdirSync(SNAP)){
    if(!f.endsWith('.json')||f.startsWith('_'))continue;
    let s; try{ s=JSON.parse(fs.readFileSync(path.join(SNAP,f),'utf8')); }catch(_){continue;}
    if(s&&s.meta&&s.meta.ticker)u.push(s);
  }
  return u;
}

function runScore(){
  delete require.cache[require.resolve(R+'/src/scoring/score.js')];
  delete require.cache[require.resolve(R+'/src/scoring/engine.js')];
  const { scoreUniverse } = require(R+'/src/scoring/score.js');
  const formulas = require(R+'/src/scoring/formulas/index.js');
  const universe = loadUniverse();
  return scoreUniverse(universe, formulas);
}

// === BASELINE ===
let res = runScore();
function summarize(results){
  let route=0, survival=0, suspect=0, ge90=0;
  const byT={};
  for(const r of results){
    byT[r.ticker]=r;
    if(r.action==='route') route++;
    if(r.action==='route' && r.score!=null) survival++;
    if(r.reason && /suspect/i.test(r.reason)) suspect++;
    if(r.score!=null && r.score>=90) ge90++;
  }
  return {route, survival, ge90, byT};
}
const base = summarize(res);
console.log('=== BASELINE ===');
console.log('route=',base.route,'survival=',base.survival,'ge90=',base.ge90);
const anchors=['PLTR','CRDO','ALAB','BE','2383.TW','2308.TW','WTC.AX','ENEL.MI'];
for(const a of anchors){ const r=base.byT[a]; console.log(a.padEnd(9), r?`action=${r.action} score=${r.score} formula=${r.formulaId} track=${r.track} capEffPct?`:'<none>'); }

// === COUNTERFACTUAL: patch capitalEfficiency with roic>0 gate on discount ===
const axes = require(R+'/src/scoring/axes.js');
const orig = axes.capitalEfficiency;
const { norm } = require(R+'/src/scoring/snapshot.js');
axes.capitalEfficiency = function(s){
  // recompute raw roic to gate
  const opIncS=norm(s,'annualOpInc'), assets=norm(s,'annualBalance','totalAssets'), curLiab=norm(s,'annualBalance','currentLiabilities');
  const opP=[],invP=[]; const nY=Math.max(opIncS.length,assets.length);
  for(let i=0;i<nY;i++){const o=opIncS[i],a=assets[i];if(o==null||a==null)continue;const c=curLiab[i];if(c==null)continue;const inv=a-c;if(!(inv>0))continue;opP.push(o);invP.push(inv);}
  const mean=(arr)=>arr.reduce((p,c)=>p+c,0)/arr.length;
  const v = orig(s);
  if(opP.length===0) return v;
  const roic = mean(opP)/mean(invP);
  if(roic>=0) return v; // unchanged when roic>=0
  // roic<0: recompute WITHOUT cycleDiscount (apply penalty only) => emulate fix
  // fix = roic - penalty (cycleDiscount forced to 1). Reuse orig path by reconstructing:
  // easiest: penalty term — but orig already includes discount. Recompute fully here:
  const { firstTwoPresent } = require(R+'/src/scoring/snapshot.js');
  let penalty=0;
  const aTwo=firstTwoPresent(assets);
  const rTwo=firstTwoPresent(norm(s,'annualRev'));
  if(aTwo&&aTwo[1]>0&&rTwo&&rTwo[1]>0){const ag=aTwo[0]/aTwo[1]-1, rg=rTwo[0]/rTwo[1]-1; penalty=Math.max(0,ag-rg);}
  return roic - penalty; // cycleDiscount=1 for negative roic
};

const res2 = runScoreWithPatch(axes);
function runScoreWithPatch(axesMod){
  // score.js requires engine which requires axes; need to ensure score uses patched axes.
  // We patched the axes module object in-place, and require cache returns same object => OK if score uses same instance.
  delete require.cache[require.resolve(R+'/src/scoring/score.js')];
  delete require.cache[require.resolve(R+'/src/scoring/engine.js')];
  const { scoreUniverse } = require(R+'/src/scoring/score.js');
  const formulas = require(R+'/src/scoring/formulas/index.js');
  const universe = loadUniverse();
  return scoreUniverse(universe, formulas);
}
const cf = summarize(res2);
console.log('\n=== COUNTERFACTUAL (roic>0 gate) ===');
console.log('route=',cf.route,'survival=',cf.survival,'ge90=',cf.ge90);
for(const a of anchors){
  const b=base.byT[a], c=cf.byT[a];
  const bs=b?b.score:null, cs=c?c.score:null;
  console.log(a.padEnd(9), `base score=${bs} -> cf score=${cs}`, (bs!==cs)?'  <<< CHANGED':'');
}
// global diff
let changed=0, maxDelta=0, changedNames=[];
for(const t in base.byT){
  const b=base.byT[t], c=cf.byT[t];
  if(!c) continue;
  if(b.score!=null && c.score!=null){
    const d=Math.abs(b.score-c.score);
    if(d>1e-9){ changed++; changedNames.push([t,b.score,c.score,d]); if(d>maxDelta)maxDelta=d; }
  } else if(b.action!==c.action){ changed++; changedNames.push([t,b.action,c.action,'ACTION']); }
}
console.log('\nNames with score/action change:', changed, 'maxDelta=',maxDelta);
changedNames.sort((a,b)=> (typeof b[3]==='number'?b[3]:99) - (typeof a[3]==='number'?a[3]:99));
for(const cn of changedNames.slice(0,30)) console.log('  ', cn);
