'use strict';
// Independent reverify of R2F12 / F50 FX-dedup. Replicates the pre-dedup eligible population
// (route+survival after data-suspect gate) with REAL snapshot refs, rebuilds issuer groups
// exactly as score.js does, and inspects every fx-decisive tie-break.
const path=require('path'), FS=require('fs');
const { route, isUS } = require('../src/scoring/router.js');
const { evaluateLamps } = require('../src/scoring/lamps.js');
const { gradeSnapshot } = require('../methods/data-quality.js');

const SNAP_DIR=path.join(__dirname,'..','snapshots');
const universe=[];
for(const f of FS.readdirSync(SNAP_DIR)){ if(!f.endsWith('.json')||f.startsWith('_manifest'))continue; let s;try{s=JSON.parse(FS.readFileSync(path.join(SNAP_DIR,f),'utf8'));}catch(_){continue;} if(s&&s.meta&&s.meta.ticker)universe.push(s); }

// Reproduce isDataSuspect EXACTLY (score.js:40-55)
const DATA_SUSPECT_LAMPS=['newestQtrSuspect','annualCurrencyLeak'];
function isDataSuspect(s,lampsActive,action){
  if(lampsActive.some((l)=>DATA_SUSPECT_LAMPS.includes(l))) return true;
  if(action!=='route') return false;
  if(!s||typeof s!=='object') return false;
  return gradeSnapshot(s).grade==='D';
}
const tickerOf=(s)=>(s&&s.meta&&s.meta.ticker)||(s&&s.identifier&&s.identifier.value)||'?';

// Build the pre-dedup eligible legs (route/survival that survive the A4 gate)
const eligible=[];
for(const s of universe){
  const r=route(s);
  const lampsActive=evaluateLamps(s).active;
  if((r.action==='route'||r.action==='survival') && isDataSuspect(s,lampsActive,r.action)) continue; // gated out
  if(r.action==='route'||r.action==='survival'){ eligible.push({ ticker:tickerOf(s), snapshot:s, action:r.action }); }
}
console.log('eligible route+survival legs:', eligible.length);

// EXACT helpers from score.js
const cmpTicker=(x,y)=>(x<y?-1:x>y?1:0);
const issuerKey=(s)=>{ const n=s&&s.meta&&s.meta.name; return (typeof n==='string'&&n.trim())?n.toLowerCase().replace(/\s+/g,' ').trim():null; };
const mcapOf=(s)=>(s&&s.marketCap&&Number.isFinite(s.marketCap.value))?s.marketCap.value:0;
const fxSuspect=(s)=>{ const m=s&&s.meta; if(!m)return false; const tc=m.tradingCurrency, rc=m.reportingCurrencyOriginal; return !!(tc&&rc&&String(tc).toUpperCase()!==String(rc).toUpperCase()&&m.tradingFxRateApplied==null); };
// "good leg" = trading ccy == reporting ccy (FX-consistent), includes USD/USD native
const ccyConsistent=(s)=>{ const m=s&&s.meta; if(!m)return false; const tc=String(m.tradingCurrency||'').toUpperCase(), rc=String(m.reportingCurrencyOriginal||'').toUpperCase(); return !!(tc&&rc&&tc===rc); };
const usdNative=(s)=>{ const m=s&&s.meta; if(!m)return false; return String(m.tradingCurrency||'').toUpperCase()==='USD'&&String(m.reportingCurrencyOriginal||'').toUpperCase()==='USD'; };

const groups={};
for(const e of eligible){ const k=issuerKey(e.snapshot); if(k)(groups[k]=groups[k]||[]).push(e); }

let multi=0, fxDecisive=0, wrongDemote=0;
const cases=[], wrong=[];
for(const [k,group] of Object.entries(groups)){
  if(group.length<2) continue; multi++;
  const sortProd=[...group].sort((a,b)=>{
    const ua=isUS(a.snapshot)?1:0, ub=isUS(b.snapshot)?1:0; if(ua!==ub)return ub-ua;
    const fa=fxSuspect(a.snapshot)?1:0, fb=fxSuspect(b.snapshot)?1:0; if(fa!==fb)return fa-fb;
    const ma=mcapOf(a.snapshot), mb=mcapOf(b.snapshot); if(ma!==mb)return mb-ma;
    return cmpTicker(a.ticker,b.ticker);
  });
  const sortNoFx=[...group].sort((a,b)=>{
    const ua=isUS(a.snapshot)?1:0, ub=isUS(b.snapshot)?1:0; if(ua!==ub)return ub-ua;
    const ma=mcapOf(a.snapshot), mb=mcapOf(b.snapshot); if(ma!==mb)return mb-ma;
    return cmpTicker(a.ticker,b.ticker);
  });
  if(sortProd[0].ticker!==sortNoFx[0].ticker){
    fxDecisive++;
    const promoted=sortProd[0], demoted=sortNoFx[0]; // demoted = winner-without-fx, pushed down by fx rule
    const rec={name:k, promoted:promoted.ticker, demoted:demoted.ticker,
      demoted_fxSuspect:fxSuspect(demoted.snapshot), demoted_ccyConsistent:ccyConsistent(demoted.snapshot), demoted_usdNative:usdNative(demoted.snapshot),
      promoted_fxSuspect:fxSuspect(promoted.snapshot), promoted_ccyConsistent:ccyConsistent(promoted.snapshot), promoted_usdNative:usdNative(promoted.snapshot),
      mcap_demoted:mcapOf(demoted.snapshot), mcap_promoted:mcapOf(promoted.snapshot)};
    cases.push(rec);
    if(ccyConsistent(demoted.snapshot)||usdNative(demoted.snapshot)){ wrongDemote++; wrong.push(rec); }
  }
}
console.log('multi-leg issuer groups:', multi);
console.log('fx tie-break decisive (changed winner):', fxDecisive);
console.log('WRONGLY demoted FX-consistent/USD-native leg:', wrongDemote);
console.log('--- ALL fx-decisive cases ---');
for(const c of cases) console.log(JSON.stringify(c));
if(wrong.length){ console.log('!!! WRONG !!!'); for(const c of wrong) console.log(JSON.stringify(c)); }

// --- Second lens: count groups where fxSuspect is CONSULTED (differs among legs after US tie) ---
let consulted=0, consultedWrong=0; const consultedCases=[];
for(const [k,group] of Object.entries(groups)){
  if(group.length<2) continue;
  // group only matters within same top US-tier (US legs sort first; fx only breaks ties below)
  // Find legs at the top US tier
  const anyUS=group.some(e=>isUS(e.snapshot));
  const tier=group.filter(e=> (isUS(e.snapshot)?1:0) === (anyUS?1:0));
  const fxVals=new Set(tier.map(e=>fxSuspect(e.snapshot)?1:0));
  if(fxVals.size>1){ // fxSuspect differs within the deciding tier -> consulted
    consulted++;
    // within this tier, is any FX-consistent/USD leg ranked BELOW a suspect leg due to fx? 
    // fx rule puts suspect last, so a good leg can only be PROMOTED, never demoted. Verify:
    const suspectLegs=tier.filter(e=>fxSuspect(e.snapshot));
    const goodLegs=tier.filter(e=>!fxSuspect(e.snapshot));
    // wrong would be: a suspect leg wins over a good leg -> impossible by construction; assert
    consultedCases.push({name:k, legs:tier.map(e=>e.ticker+(fxSuspect(e.snapshot)?'(susp)':'(ok)'))});
  }
}
console.log('\n=== Lens 2: groups where fxSuspect CONSULTED (differs in deciding tier):', consulted, '===');
for(const c of consultedCases) console.log(JSON.stringify(c));
