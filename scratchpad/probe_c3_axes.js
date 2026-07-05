'use strict';
const fs=require('fs'), path=require('path');
const axes=require('../src/scoring/axes.js');
const SNAP='snapshots';
const inspect=['VFS','DNLI','ERIC','SMMT','RVMD','SRRK','AB','KBDC','HYMC'];
for(const t of inspect){
  const fp=path.join(SNAP,t+'.json');
  if(!fs.existsSync(fp)){console.log(t,'<no file>');continue;}
  const s=JSON.parse(fs.readFileSync(fp,'utf8'));
  const a={};
  for(const k of ['revGrowthLevel','revAcceleration','gpGrowth','marginTrajectory','capitalEfficiency','revisionsMomentum','dilution']){
    try{ a[k]=axes[k](s); }catch(e){ a[k]='ERR'; }
  }
  try{ a.ruleOfX=axes.ruleOfX(s,2.3,false); }catch(e){ a.ruleOfX='ERR'; }
  const nonNull=Object.values(a).filter(v=>v!==null&&v!=='ERR').length;
  console.log(`${t.padEnd(7)} sector=${s.meta.sector} | revGrowthYoY=${JSON.stringify(s.metrics&&s.metrics.revenueGrowthYoY?s.metrics.revenueGrowthYoY.value:null)} | nonNullAxes=${nonNull}/8`);
  console.log('   axes:', JSON.stringify(a));
}
