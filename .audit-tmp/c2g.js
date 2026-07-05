const fs=require('fs'),path=require('path');
const R='C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const axesFns=require(R+'/src/scoring/axes.js');
const score=require(R+'/src/scoring/score.js');
const {route}=require(R+'/src/scoring/router.js');
const formulas=require(R+'/src/scoring/formulas/index.js');
const dir=R+'/snapshots';
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json'));
const snaps=files.map(f=>{try{return JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));}catch(e){return null;}}).filter(Boolean);

const WINSOR_TAIL=0.01,OPMARGIN_CAP=1.0;
function quantile(samples,p){const a=samples.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const idx=(a.length-1)*p;const lo=Math.floor(idx),hi=Math.ceil(idx);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(idx-lo);}
function wtb(s){const lo=quantile(s,WINSOR_TAIL),hi=quantile(s,1-WINSOR_TAIL);return(lo===null||hi===null)?null:[lo,hi];}

// EXACT score.js set: run scoreUniverse but intercept. We instrument by cloning score.js logic for step1+dedup+datasuspect.
// Simplest: monkeypatch axesFns.quarterOpMargins to log which snapshots it's called on during scoreUniverse sample loop.
const origOpm=axesFns.quarterOpMargins, origQoq=axesFns.quarterQoQRates;
let collectPhase=false; const seenOpm=[],seenQoq=[];
axesFns.quarterOpMargins=function(s,bounds){const r=origOpm(s,bounds);if(collectPhase&&bounds===undefined){for(const v of r)seenOpm.push(v);}return r;};
axesFns.quarterQoQRates=function(s,bounds){const r=origQoq(s,bounds);if(collectPhase&&bounds===undefined){for(const v of r)seenQoq.push(v);}return r;};
collectPhase=true;
const results=score.scoreUniverse(snaps,formulas);
collectPhase=false;
console.log('EXACT score.js opm samples',seenOpm.length,'qoq',seenQoq.length);
const opmTail=wtb(seenOpm);
console.log('EXACT opmTail',opmTail,'-> bounds',[opmTail[0],OPMARGIN_CAP]);
console.log('EXACT qoqTail',wtb(seenQoq));

// compare to raw-route bounds
const routed=snaps.filter(s=>route(s).action==='route');
const opm2=[],qoq2=[];for(const s of routed){for(const v of origOpm(s))opm2.push(v);for(const v of origQoq(s))qoq2.push(v);}
console.log('RAW-route opm samples',opm2.length,'opmTail',wtb(opm2));
console.log('delta opm p1:',(wtb(seenOpm)[0]-wtb(opm2)[0]).toFixed(6),' qoq p99:',(wtb(seenQoq)[1]-wtb(qoq2)[1]).toFixed(6));
