'use strict';
const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { loadUniverse } = require(REPO + '/src/scoring/run-screener.js');
const { rawAxisValue } = require(REPO + '/src/scoring/score.js');
const { q } = require(REPO + '/src/scoring/engine.js');
const ax = require(REPO + '/src/scoring/axes.js');
const formulas = require(REPO + '/src/scoring/formulas/index.js');
const { scoreUniverse } = require(REPO + '/src/scoring/score.js');

const u = loadUniverse();
const byT = {}; for (const s of u) byT[s.meta.ticker] = s;
const results = scoreUniverse(u, formulas);
const mR = {}; for (const e of results) mR[e.ticker]=e;

// Winsor bounds like score.js
const opm=[],qoq=[];
for (const e of results){ if(e.action!=='route')continue; for(const v of ax.quarterOpMargins(byT[e.ticker]))opm.push(v); for(const v of ax.quarterQoQRates(byT[e.ticker]))qoq.push(v);}
const quant=(a,p)=>{const x=a.filter(Number.isFinite).sort((m,n)=>m-n);const i=(x.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return lo===hi?x[lo]:x[lo]+(x[hi]-x[lo])*(i-lo);};
const winsorBounds={opMargin:[quant(opm,0.01),1.0],qoq:[quant(qoq,0.01),quant(qoq,0.99)]};

const AXKEYS = ['revGrowthLevel','revAcceleration','gpGrowth','ruleOfX','marginTrajectory','capitalEfficiency','dilution','revisionsMomentum'];

function dumpRaw(t) {
  const s = byT[t];
  console.log('\n### '+t+' ('+(s?s.meta.sector:'?')+') action='+(mR[t]?mR[t].action:'?')+' fid='+(mR[t]?mR[t].formulaId:'?')+' track='+(mR[t]?mR[t].track:'?'));
  if (!s) { console.log('  no snapshot'); return; }
  for (const k of AXKEYS) {
    let raw;
    try { raw = rawAxisValue(s, k, formulas[mR[t]&&mR[t].formulaId] || {alpha:1.5}, mR[t]&&mR[t].track||'profitable', winsorBounds); }
    catch(e){ raw = 'ERR:'+e.message; }
    // revisionsMomentum uses ax directly
    if (k==='revisionsMomentum') raw = ax.revisionsMomentum(s);
    console.log('   ', k.padEnd(20), raw===null?'null (DROP)':(typeof raw==='number'?raw.toFixed(4):raw));
  }
}

// 2799.HK — the no-axes drop
dumpRaw('2799.HK');
// raw fields
const s = byT['2799.HK'];
if (s) {
  const { norm, metricVal, presentValues } = require(REPO+'/src/scoring/snapshot.js');
  console.log('   annualRev:', JSON.stringify(norm(s,'annualRev')));
  console.log('   revenueQ:', JSON.stringify(norm(s,'revenueQ')));
  console.log('   annualGP:', JSON.stringify(norm(s,'annualGP')));
  console.log('   annualSBC:', JSON.stringify(norm(s,'annualSBC')));
  console.log('   annualOpInc:', JSON.stringify(norm(s,'annualOpInc')));
  console.log('   revenueGrowthYoY:', metricVal(s,'revenueGrowthYoY'));
  console.log('   marketCap:', s.marketCap && s.marketCap.value);
  console.log('   estimateRevisions present?', !!(s.external&&s.external.estimateRevisions));
}

// AUGO — biggest riser, now >=90 in materials
dumpRaw('AUGO');
// AUGO cohort context: rank in materials profitable
const matP = results.filter(e=>e.action==='route'&&e.formulaId==='materials'&&e.track==='profitable').sort((a,b)=>b.score-a.score);
console.log('\nmaterials|profitable size:', matP.length);
console.log('Top-10 materials|profitable (7-Achsen):');
for (const e of matP.slice(0,10)) console.log('   ', e.ticker.padEnd(10), e.score.toFixed(2), (byT[e.ticker]?byT[e.ticker].meta.country:''));
console.log('AUGO rank:', (matP.findIndex(e=>e.ticker==='AUGO')+1)+'/'+matP.length);

// AUGO axis breakdown with cohort percentiles
console.log('\n=== AUGO Achsen-Perzentile in materials|profitable (7-Achsen) ===');
const f = formulas.materials;
for (const a of f.axes) {
  const cohortRaw = matP.map(e=>rawAxisValue(byT[e.ticker], a.key, f, 'profitable', winsorBounds));
  const raw = rawAxisValue(byT['AUGO'], a.key, f, 'profitable', winsorBounds);
  const pct = q(raw, cohortRaw);
  console.log('   ', a.key.padEnd(20), 'w='+a.w.profitable, 'raw='+(raw===null?'null':raw.toFixed(3)), 'pct='+(pct===null?'DROP':pct.toFixed(1)));
}
