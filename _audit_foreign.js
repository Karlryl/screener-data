const fs=require("fs");
const path=require("path");
const REPO="C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data";
const R=require(REPO+"/src/scoring/router.js");
const dir=REPO+"/snapshots";
const files=fs.readdirSync(dir).filter(f=>f.endsWith(".json"));
let foreign=0, route={}, exclude={}, surv=0;
const nonOpExcluded=[];
const slipThrough=[];
for(const f of files){
  let s; try{ s=JSON.parse(fs.readFileSync(path.join(dir,f),"utf8")); }catch(e){continue;}
  const m=s.meta||{};
  if(!R.isForeignListed(m)) continue;
  foreign++;
  const r=R.route(s);
  if(r.action==="exclude"){ exclude[r.reason]=(exclude[r.reason]||0)+1;
    if(r.reason==="non-operating-rev") nonOpExcluded.push({t:m.ticker,name:m.name,ind:m.industry,sec:m.sector});
  } else if(r.action==="route"){ route[r.formulaId]=(route[r.formulaId]||0)+1;
    const ind=(m.industry||"").toLowerCase(), name=(m.name||"").toLowerCase();
    if(/asset management|closed-end|investment trust|holding|capital|bdc|business development|\bfund\b|\btrust\b/.test(ind+" "+name)){
      slipThrough.push({t:m.ticker,name:m.name,ind:m.industry,sec:m.sector,formula:r.formulaId});
    }
  } else if(r.action==="survival"){ surv++; }
}
console.log("foreign-listed total:",foreign);
console.log("route:",JSON.stringify(route));
console.log("exclude:",JSON.stringify(exclude));
console.log("survival:",surv);
console.log("\n--- non-operating-rev EXCLUDED (foreign), count="+nonOpExcluded.length+" ---");
for(const x of nonOpExcluded) console.log(`${x.t} | ${x.name} | ind=${x.ind} | sec=${x.sec}`);
console.log("\n--- POTENTIAL SLIP-THROUGH (foreign holding/AM/trust/fund ROUTED), count="+slipThrough.length+" ---");
for(const x of slipThrough) console.log(`${x.t} | ${x.name} | ind=${x.ind} | sec=${x.sec} | -> ${x.formula}`);
