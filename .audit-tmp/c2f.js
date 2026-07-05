const fs=require('fs'),path=require('path');
const R='C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const axesFns=require(R+'/src/scoring/axes.js');
const {route,isUS}=require(R+'/src/scoring/router.js');
const {q,weightedScore,coverageWeight,signTrack,fcfTrack}=require(R+'/src/scoring/engine.js');
const {norm,metricVal}=require(R+'/src/scoring/snapshot.js');
const dir=R+'/snapshots';
const snaps=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>{try{return JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));}catch(e){return null;}}).filter(Boolean);

const WINSOR_TAIL=0.01,OPMARGIN_CAP=1.0;
function quantile(samples,p){const a=samples.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const idx=(a.length-1)*p;const lo=Math.floor(idx),hi=Math.ceil(idx);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(idx-lo);}
function winsorTailBounds(samples){const lo=quantile(samples,WINSOR_TAIL),hi=quantile(samples,1-WINSOR_TAIL);return(lo===null||hi===null)?null:[lo,hi];}

// DETERMINISM: run sample collection & bounds twice in different snapshot order
function boundsFromOrder(order){
  const opm=[],qoq=[];
  for(const s of order){if(route(s).action!=='route')continue;for(const v of axesFns.quarterOpMargins(s))opm.push(v);for(const v of axesFns.quarterQoQRates(s))qoq.push(v);}
  const opmTail=winsorTailBounds(opm);
  return {opMargin:opmTail?[opmTail[0],OPMARGIN_CAP]:null,qoq:winsorTailBounds(qoq)};
}
const b1=boundsFromOrder(snaps);
const rev=snaps.slice().reverse();
const b2=boundsFromOrder(rev);
const shuf=snaps.slice().sort(()=>Math.random()-0.5);
const b3=boundsFromOrder(shuf);
console.log('bounds order-invariant (fwd vs rev):',JSON.stringify(b1)===JSON.stringify(b2));
console.log('bounds order-invariant (fwd vs shuffle):',JSON.stringify(b1)===JSON.stringify(b3));
console.log('b1',JSON.stringify(b1));

// Sort stability: are there duplicate values near the p1/p99 idx that could reorder? quantile sorts by numeric,
// duplicates compare equal -> value identical regardless of tie order. Confirm bounds numerically stable.
