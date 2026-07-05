const fs=require("fs");
const path=require("path");
const REPO="C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data";
const R=require(REPO+"/src/scoring/router.js");
const {norm,hasPresent,firstPresent}=require(REPO+"/src/scoring/snapshot.js");
function presentValues(series){return Array.isArray(series)?series.filter(v=>v!==null&&v!==undefined):[];}
const dir=REPO+"/snapshots";
const files=fs.readdirSync(dir).filter(f=>f.endsWith(".json"));
// foreign asset-management OR capital-markets OR closed-end that ROUTED (not excluded)
const rows=[];
for(const f of files){
  let s; try{ s=JSON.parse(fs.readFileSync(path.join(dir,f),"utf8")); }catch(e){continue;}
  const m=s.meta||{};
  if(!R.isForeignListed(m)) continue;
  const ind=(m.industry||"").toLowerCase();
  const isAM = ind.includes("asset management");
  const isCM = ind.includes("capital markets");
  const isCEF = /closed-end|investment trust|bdc|business development/.test(ind+" "+(m.name||"").toLowerCase());
  if(!(isAM||isCM||isCEF)) continue;
  const r=R.route(s);
  if(r.action!=="route") continue; // only ones that survived routing
  // signature
  const revAnn=norm(s,"annualRev");
  const gp=norm(s,"annualGP");
  const ni=norm(s,"annualNetIncome");
  const revQ=norm(s,"revenueQ");
  const r0=firstPresent(revAnn), n0=firstPresent(ni), g0=firstPresent(gp);
  const niRev = (r0!==null&&r0>0&&n0!==null)? (n0/r0): null;
  const gpAllZero = hasPresent(gp) && presentValues(gp).every(v=>v===0);
  const anyNegQ = hasPresent(revQ) && presentValues(revQ).some(v=>v<0);
  const anyNegAnn = hasPresent(revAnn) && presentValues(revAnn).some(v=>v<0);
  rows.push({t:m.ticker,name:m.name,ind:m.industry,formula:r.formulaId,
    revPresent:hasPresent(revAnn), gpPresent:hasPresent(gp), gpAllZero, anyNegQ, anyNegAnn,
    niRev: niRev===null?null:Number(niRev.toFixed(2)), r0, g0});
}
rows.sort((a,b)=>(b.niRev||0)-(a.niRev||0));
console.log("count routed (AM/CM/CEF foreign):",rows.length);
console.log(JSON.stringify(rows,null,1));
