'use strict';
const fs=require('fs'), path=require('path');
const axes=require('../src/scoring/axes.js');
const { route }=require('../src/scoring/router.js');
const SNAP='snapshots';
const T=['AB','AIAI','AIIR','AMLX','BRAI','BVC','DNLI','ERIC','FDXF','FRBP','HYMC','KBDC','OCTV','PDX','PRAX','RTEZ','RVMD','SMMT','SRRK','SYRE','VFS'];
console.log('ticker   | revGrowthYoY | growthAxes(revLvl,ruleOfX) | totalNonNull/8');
for(const t of T){
  const fp=path.join(SNAP,t+'.json'); if(!fs.existsSync(fp))continue;
  const s=JSON.parse(fs.readFileSync(fp,'utf8'));
  const rg=s.metrics&&s.metrics.revenueGrowthYoY?s.metrics.revenueGrowthYoY.value:null;
  const revLvl=axes.revGrowthLevel(s);
  const rox=axes.ruleOfX(s,2.3,false);
  let nn=0; for(const k of ['revGrowthLevel','revAcceleration','gpGrowth','marginTrajectory','capitalEfficiency','revisionsMomentum','dilution']){ try{ if(axes[k](s)!==null)nn++; }catch(_){} }
  if(rox!==null)nn++;
  const growthN=(revLvl!==null?1:0)+(rox!==null?1:0);
  console.log(`${t.padEnd(8)} | ${String(rg).padEnd(12)} | ${growthN}/2 ${(revLvl!==null?'revLvl':'').padEnd(7)}${rox!==null?'rox':''} | ${nn}/8`);
}
