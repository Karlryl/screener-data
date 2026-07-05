const fs=require('fs'),path=require('path');
const R='C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const axesFns=require(R+'/src/scoring/axes.js');
const {route}=require(R+'/src/scoring/router.js');
const {norm}=require(R+'/src/scoring/snapshot.js');
const dir=R+'/snapshots';
const snaps=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>{try{return JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));}catch(e){return null;}}).filter(Boolean);
const routed=snaps.filter(s=>route(s).action==='route');

// qoq samples from names with <3 quarters (rq.length<3) => quarterQoQRates still produces (rq.length-1) rates,
// but revAcceleration REJECTS them (needs g.length>=2 i.e. >=3 quarters). So samples include QoQ from 2-quarter names.
let n2q=0, qoqFrom2q=0, qoqTotal=0;
for(const s of routed){
  const rq=norm(s,'revenueQ').filter(v=>v!=null);
  const rates=axesFns.quarterQoQRates(s);
  qoqTotal+=rates.length;
  if(rq.length<3){n2q++;qoqFrom2q+=rates.length;}
}
console.log('routed names with <3 present revenueQ:',n2q,'| qoq rates they contribute:',qoqFrom2q,'/',qoqTotal);

// opm samples from names with <2 quarter-margins (marginTraj null) still contribute to opm bounds
let nOpmSingle=0,opmFromSingle=0,opmTotal=0;
for(const s of routed){
  const m=axesFns.quarterOpMargins(s);
  opmTotal+=m.length;
  if(m.length<2){nOpmSingle++;opmFromSingle+=m.length;}
}
console.log('routed names with <2 quarter-opmargins (marginTraj=null):',nOpmSingle,'| opm samples they contribute:',opmFromSingle,'/',opmTotal);

// Does including these single-quarter samples shift bounds? Compare bounds with vs without <2/<3 names.
const WINSOR_TAIL=0.01,OPMARGIN_CAP=1.0;
function quantile(s,p){const a=s.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const idx=(a.length-1)*p;const lo=Math.floor(idx),hi=Math.ceil(idx);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(idx-lo);}
const opmAll=[],opmConsumersOnly=[],qoqAll=[],qoqConsumersOnly=[];
for(const s of routed){
  const m=axesFns.quarterOpMargins(s);for(const v of m)opmAll.push(v);if(m.length>=2)for(const v of m)opmConsumersOnly.push(v);
  const rq=norm(s,'revenueQ').filter(v=>v!=null);const rates=axesFns.quarterQoQRates(s);for(const v of rates)qoqAll.push(v);if(rq.length>=3)for(const v of rates)qoqConsumersOnly.push(v);
}
console.log('opm p1 all vs consumers-only:',quantile(opmAll,0.01).toFixed(4),quantile(opmConsumersOnly,0.01).toFixed(4));
console.log('qoq p1/p99 all:',quantile(qoqAll,0.01).toFixed(4),quantile(qoqAll,0.99).toFixed(4),'| consumers-only:',quantile(qoqConsumersOnly,0.01).toFixed(4),quantile(qoqConsumersOnly,0.99).toFixed(4));
