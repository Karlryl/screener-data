const fs=require('fs'),path=require('path');
const R='C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const axesFns=require(R+'/src/scoring/axes.js');
const {norm}=require(R+'/src/scoring/snapshot.js');
const dir=R+'/snapshots';
const load=t=>JSON.parse(fs.readFileSync(dir+'/'+t+'.json','utf8'));
for(const t of ['ABSI','ACHR','IE','NAMS','POET','PLSE']){
  const s=load(t);
  const rq=norm(s,'revenueQ'),oi=norm(s,'opIncQ');
  const raw=axesFns.quarterOpMargins(s,null);
  console.log(t,'revenueQ',JSON.stringify(rq.slice(0,6)),'opIncQ',JSON.stringify(oi.slice(0,6)));
  console.log('   rawOpMargins',raw.map(v=>v.toFixed(2)));
}
