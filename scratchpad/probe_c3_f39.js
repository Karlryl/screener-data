'use strict';
const fs=require('fs'), path=require('path');
const { route } = require('../src/scoring/router.js');
const { evaluateLamps } = require('../src/scoring/lamps.js');
const { gradeSnapshot } = require('../methods/data-quality.js');
const SNAP='snapshots';
function hasMetric(m){ if(m==null)return false; if(typeof m==='number')return Number.isFinite(m); if(typeof m!=='object')return false; return typeof m.value==='number'&&Number.isFinite(m.value);}
function arrLen(a){ if(!Array.isArray(a))return 0; return a.filter(x=>{ if(x==null)return false; if(typeof x==='number')return Number.isFinite(x); if(typeof x==='object'&&'value'in x)return Number.isFinite(x.value); return true;}).length;}
const DATA_SUSPECT_LAMPS=['newestQtrSuspect','annualCurrencyLeak'];
let routeCnt=0, dGate=[], total=0;
for(const f of fs.readdirSync(SNAP)){
  if(!f.endsWith('.json')||f.startsWith('_manifest'))continue;
  let s; try{ s=JSON.parse(fs.readFileSync(path.join(SNAP,f),'utf8')); }catch(_){continue;}
  if(!(s&&s.meta&&s.meta.ticker))continue;
  total++;
  const r=route(s);
  if(r.action!=='route')continue;
  const lamps=evaluateLamps(s).active;
  // mirror isDataSuspect for route
  const fabricated = lamps.some(l=>DATA_SUSPECT_LAMPS.includes(l));
  const g=gradeSnapshot(s);
  const dataSuspect = fabricated || g.grade==='D';
  if(dataSuspect){
    // only count the grade-D-arm-only exclusions (not fabrication-lamp)
    if(!fabricated && g.grade==='D'){
      dGate.push({
        ticker:s.meta.ticker,
        criticalMissing:g.criticalMissing,
        nanRatio:g.nanRatio,
        mcPresent:hasMetric(s.marketCap),
        ttmPresent:hasMetric(s.metrics&&s.metrics.revenueTTM),
        revGrowthPresent:hasMetric(s.metrics&&s.metrics.revenueGrowthYoY),
        annualRevLen:arrLen(s.annual&&s.annual.annualRev),
      });
    }
  } else {
    routeCnt++;
  }
}
console.log('total snapshots with meta.ticker:', total);
console.log('route after gate:', routeCnt);
console.log('grade-D-arm-only exclusions (route):', dGate.length);
const critMissing = dGate.filter(d=>d.criticalMissing);
console.log('  of those criticalMissing=true:', critMissing.length);
console.log('  criticalMissing & marketCap PRESENT (D only from revenueTTM null):', critMissing.filter(d=>d.mcPresent).length);
console.log('  criticalMissing & marketCap PRESENT & annualRev>=3 & revGrowthYoY present (scorable):',
  critMissing.filter(d=>d.mcPresent && d.annualRevLen>=3 && d.revGrowthPresent).length);
console.log('--- detail (criticalMissing, mcPresent) ---');
for(const d of critMissing.filter(x=>x.mcPresent)){
  console.log(`${d.ticker.padEnd(10)} ttm=${d.ttmPresent} revG=${d.revGrowthPresent} annualRevLen=${d.annualRevLen} nanRatio=${d.nanRatio}`);
}
