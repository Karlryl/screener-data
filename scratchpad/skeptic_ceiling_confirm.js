'use strict';
const fs=require('fs'),path=require('path');
const REPO='C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { scoreUniverse, rawAxisValue } = require(path.join(REPO,'src/scoring/score.js'));
const { q, weightedScore, coverageWeight, signTrack } = require(path.join(REPO,'src/scoring/engine.js'));
const axesFns = require(path.join(REPO,'src/scoring/axes.js'));
const formulas = require(path.join(REPO,'src/scoring/formulas/index.js'));
const { norm } = require(path.join(REPO,'src/scoring/snapshot.js'));
const SNAP_DIR=path.join(REPO,'snapshots');
const WINSOR_TAIL=0.01;
function quantile(s,p){const a=s.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const i=(a.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(i-lo);}
function wtb(s){const lo=quantile(s,WINSOR_TAIL),hi=quantile(s,1-WINSOR_TAIL);return(lo===null||hi===null)?null:[lo,hi];}
function load(){const out=[];for(const f of fs.readdirSync(SNAP_DIR)){if(!f.endsWith('.json'))continue;if(f.startsWith('_manifest')||f==='_last_good_disk.json')continue;try{const s=JSON.parse(fs.readFileSync(path.join(SNAP_DIR,f),'utf8'));if(s&&s.meta&&s.meta.ticker)out.push(s);}catch(_){}}return out;}
const tk=(s)=>s&&s.meta&&s.meta.ticker;
const results=scoreUniverse(load(),formulas);
const route=results.filter(e=>e.action==='route');
const fresh=new Map();for(const s of load())fresh.set(tk(s),s);
const opm=[],qoq=[];for(const e of route){const s=fresh.get(e.ticker);if(!s)continue;for(const v of axesFns.quarterOpMargins(s))opm.push(v);for(const v of axesFns.quarterQoQRates(s))qoq.push(v);}
const wb={opMargin:wtb(opm),qoq:wtb(qoq)};
const cohorts={};for(const e of route)(cohorts[e.formulaId+'|'+e.track]||=[]).push(e);
const rec=[];
for(const key of Object.keys(cohorts)){const entries=cohorts[key];const formula=formulas[entries[0].formulaId];const track=entries[0].track;const snapOf=(e)=>fresh.get(e.ticker);
  const ps=formula.subCohortByProfit?entries.map(e=>signTrack(norm(snapOf(e),'annualOpInc'))):null;
  const rba={};for(const ax of formula.axes)rba[ax.key]=entries.map(e=>rawAxisValue(snapOf(e),ax.key,formula,track,wb));
  for(let i=0;i<entries.length;i++){const axes=formula.axes.map(ax=>{let c=rba[ax.key];if(ps&&ax.key==='capitalEfficiency')c=c.filter((_,j)=>ps[j]===ps[i]);return{value:q(rba[ax.key][i],c),weight:ax.w[track],key:ax.key};});
    const base=weightedScore(axes);const wcov=coverageWeight(axes);
    const presentAxes=axes.filter(a=>a.value!==null&&Number.isFinite(a.value)&&a.weight>0).map(a=>a.key);
    rec.push({ticker:entries[i].ticker,base,wcov,final:entries[i].score,nPresent:presentAxes.length,nTotal:formula.axes.length,present:presentAxes});}}
// TEST A: alle wcov===1 -> final === base (kein C4-Shrink)?
const full=rec.filter(r=>r.wcov===1&&Number.isFinite(r.base)&&Number.isFinite(r.final));
let flipped=0,maxd=0;for(const r of full){const d=Math.abs(r.final-r.base);if(d>maxd)maxd=d;if(d>1e-9)flipped++;}
console.log('TEST A wcov===1 final===base: n='+full.length+' geshrinkt(>1e-9)='+flipped+' maxdiff='+maxd.toExponential(2));
// TEST B: 2360.TW Achsen-Coverage
const top=rec.filter(r=>r.wcov===1).sort((a,b)=>b.base-a.base)[0];
console.log('TEST B hoechster wcov===1: '+top.ticker+' base='+top.base.toFixed(2)+' final='+top.final.toFixed(2)+' nPresent='+top.nPresent+'/'+top.nTotal+' achsen=['+top.present.join(',')+']');
// TEST C: gibt es IRGENDEINEN wcov===1 Name mit base>=88?
const near=rec.filter(r=>r.wcov===1&&Number.isFinite(r.base)&&r.base>=88).sort((a,b)=>b.base-a.base);
console.log('TEST C wcov===1 mit base>=88: '+near.length+' -> '+near.map(r=>r.ticker+'='+r.base.toFixed(2)).join(', '));
// TEST D: Counterfactual OHNE C4 — wie viele Namen waeren score>=90 (= base>=90)? davon wcov===1?
const b90=rec.filter(r=>Number.isFinite(r.base)&&r.base>=90);
console.log('TEST D counterfactual ohne C4: base>=90 n='+b90.length+' davon wcov===1='+b90.filter(r=>r.wcov===1).length);
