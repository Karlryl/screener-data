const fs=require("fs");
const REPO="C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data";
const {norm}=require(REPO+"/src/scoring/snapshot.js");
const tickers=["MF.PA","GBLB.BR","RF.PA","SOL.AX","ONEX.TO","BN.TO","IGG.L","1788.HK","PPT.AX","2799.HK","1359.HK","WHSP"];
for(const t of tickers){
  const p=REPO+"/snapshots/"+t+".json";
  if(!fs.existsSync(p)){console.log(t,"<missing>");continue;}
  const s=JSON.parse(fs.readFileSync(p,"utf8"));
  const m=s.meta||{};
  console.log("=== "+t+" | "+m.name+" | "+m.industry+" ===");
  console.log("  annualRev:",JSON.stringify(norm(s,"annualRev")));
  console.log("  annualGP :",JSON.stringify(norm(s,"annualGP")));
  console.log("  annualNI :",JSON.stringify(norm(s,"annualNetIncome")));
  console.log("  annualOpInc:",JSON.stringify(norm(s,"annualOpInc")));
  console.log("  revenueQ :",JSON.stringify(norm(s,"revenueQ")));
}
