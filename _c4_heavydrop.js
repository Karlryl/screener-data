'use strict';
const fs=require('fs'),path=require('path');
const { norm } = require('./src/scoring/snapshot.js');
const { q, weightedScore, coverageWeight, signTrack } = require('./src/scoring/engine.js');
const { route } = require('./src/scoring/router.js');
const axesFns = require('./src/scoring/axes.js');
const formulas = require('./src/scoring/formulas/index.js');
const { rawAxisValue, trackOf } = require('./src/scoring/score.js');
const SNAP_DIR=path.join(__dirname,'snapshots');
function loadUniverse(){const u=[];for(const f of fs.readdirSync(SNAP_DIR)){if(!f.endsWith('.json'))continue;if(f.startsWith('_manifest')||f==='_last_good_disk.json')continue;let s;try{s=JSON.parse(fs.readFileSync(path.join(SNAP_DIR,f),'utf8'));}catch(_){continue;}if(s&&s.meta&&s.meta.ticker)u.push(s);}return u;}
const universe=loadUniverse();
const routedRaw=[];
for(const s of universe){const r=route(s);if(r.action!=='route'||!formulas[r.formulaId])continue;const e={ticker:(s.meta&&s.meta.ticker),snapshot:s,formulaId:r.formulaId,formula:formulas[r.formulaId]};e.track=trackOf(s,e.formula);routedRaw.push(e);}
const WINSOR_TAIL=0.01,OPMARGIN_CAP=1.0;
function quantile(a,p){a=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const idx=(a.length-1)*p,lo=Math.floor(idx),hi=Math.ceil(idx);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(idx-lo);}
function wtb(s){const lo=quantile(s,WINSOR_TAIL),hi=quantile(s,1-WINSOR_TAIL);return(lo===null||hi===null)?null:[lo,hi];}
const opm=[],qoq=[];for(const e of routedRaw){for(const v of axesFns.quarterOpMargins(e.snapshot))opm.push(v);for(const v of axesFns.quarterQoQRates(e.snapshot))qoq.push(v);}
const ot=wtb(opm);const wb={opMargin:ot?[ot[0],OPMARGIN_CAP]:null,qoq:wtb(qoq)};
const cohorts={};for(const e of routedRaw)(cohorts[e.formulaId+'|'+e.track]||=[]).push(e);

// For each cohort, find names that dropped the HEAVIEST axis but kept most weight,
// and measure over-shrinkage: wcov vs variance-correct factor.
let flagged=[];
for(const[key,entries]of Object.entries(cohorts)){
  const formula=entries[0].formula,track=entries[0].track;
  const wts=formula.axes.map(a=>a.w[track]);
  const sumAll=wts.reduce((a,b)=>a+b,0);
  const varFull=wts.reduce((a,b)=>a+b*b,0)/(sumAll*sumAll);
  const rawByAxis={};for(const ax of formula.axes)rawByAxis[ax.key]=entries.map(e=>rawAxisValue(e.snapshot,ax.key,formula,track,wb));
  const base=[],wcov=[],presentMasks=[];
  for(let i=0;i<entries.length;i++){
    const mask=formula.axes.map(ax=>{const p=q(rawByAxis[ax.key][i],rawByAxis[ax.key]);return p!==null&&Number.isFinite(p);});
    presentMasks[i]=mask;
    const axes=formula.axes.map((ax,j)=>({value:mask[j]?q(rawByAxis[ax.key][i],rawByAxis[ax.key]):null,weight:ax.w[track]}));
    base[i]=weightedScore(axes);wcov[i]=coverageWeight(axes);
  }
  const med=quantile(base.filter(Number.isFinite),0.5);
  for(let i=0;i<entries.length;i++){
    if(!Number.isFinite(base[i])||wcov[i]===1||!Number.isFinite(wcov[i]))continue;
    const pw=wts.filter((_,j)=>presentMasks[i][j]);
    const sumP=pw.reduce((a,b)=>a+b,0);
    const varPart=pw.reduce((a,b)=>a+b*b,0)/(sumP*sumP);
    const sdCorrect=Math.sqrt(varFull/varPart);
    const finalWcov=med+wcov[i]*(base[i]-med);
    const finalCorrect=med+sdCorrect*(base[i]-med);
    // over-shrink magnitude = how much MORE C4 pulls it vs variance-correct
    const overShrink=finalCorrect-finalWcov; // positive if C4 pulled it below where variance-correct would
    if(base[i]>60 && Math.abs(overShrink)>3){ // only names above median that get materially mis-shrunk
      flagged.push({ticker:entries[i].ticker,key,base:base[i],wcov:wcov[i],sdCorrect,finalWcov,finalCorrect,overShrink,med});
    }
  }
}
flagged.sort((a,b)=>b.overShrink-a.overShrink);
console.log('=== Names ABOVE median that C4 OVER-shrinks vs variance-correct (top 20 by mis-shrink) ===');
console.log('(overShrink>0 = C4 pushed it LOWER than a variance-correct shrink would)');
for(const x of flagged.slice(0,20))console.log(`${x.ticker.padEnd(12)} ${x.key.padEnd(28)} base=${x.base.toFixed(1)} wcov=${x.wcov.toFixed(3)} sdCorrect=${x.sdCorrect.toFixed(3)} finalC4=${x.finalWcov.toFixed(1)} finalCorrect=${x.finalCorrect.toFixed(1)} miss=${x.overShrink>0?'+':''}${x.overShrink.toFixed(1)}`);
console.log('\ntotal flagged (base>60, |mis-shrink|>3):',flagged.length);
