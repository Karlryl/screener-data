const fs=require('fs'),path=require('path');
const R='C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const axesFns=require(R+'/src/scoring/axes.js');
const {route}=require(R+'/src/scoring/router.js');
const formulas=require(R+'/src/scoring/formulas/index.js');
const dir=R+'/snapshots';
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json'));
const snaps=files.map(f=>{try{return JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));}catch(e){return null;}}).filter(Boolean);

const WINSOR_TAIL=0.01, OPMARGIN_CAP=1.0;
function quantile(samples,p){const a=samples.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const idx=(a.length-1)*p;const lo=Math.floor(idx),hi=Math.ceil(idx);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(idx-lo);}
function winsorTailBounds(samples){const lo=quantile(samples,WINSOR_TAIL),hi=quantile(samples,1-WINSOR_TAIL);return(lo===null||hi===null)?null:[lo,hi];}

// route-only set (matches score.js action==='route' timing; dedup/data-suspect drop a handful but
// they still feed samples in score.js because sample loop is over results with action==='route'.
// data-suspect names are converted to exclude BEFORE, dup-issuer BEFORE too. But bounds are robust.)
const routed=snaps.filter(s=>route(s).action==='route');
console.log('route(raw) count',routed.length);

const opm=[],qoq=[];
for(const s of routed){for(const v of axesFns.quarterOpMargins(s))opm.push(v);for(const v of axesFns.quarterQoQRates(s))qoq.push(v);}
console.log('opm samples',opm.length,'qoq samples',qoq.length);
const opmTail=winsorTailBounds(opm);
const qoqTail=winsorTailBounds(qoq);
console.log('opmTail p1/p99',opmTail);
console.log('OPMARGIN opMargin bounds used = [p1, 1.0] =',opmTail?[opmTail[0],OPMARGIN_CAP]:null);
console.log('qoq bounds',qoqTail);

// distribution probes
const so=opm.slice().sort((a,b)=>a-b);
console.log('opm min/max',so[0],so[so.length-1]);
console.log('opm >1 count',opm.filter(v=>v>1).length,'/',opm.length);
console.log('opm p0.1/p1/p5/p50/p95/p99/p99.9', [0.001,0.01,0.05,0.5,0.95,0.99,0.999].map(p=>quantile(opm,p).toFixed(4)).join(' '));
const sq=qoq.slice().sort((a,b)=>a-b);
console.log('qoq min/max',sq[0],sq[sq.length-1]);
console.log('qoq p1/p99',quantile(qoq,0.01).toFixed(4),quantile(qoq,0.99).toFixed(4));

// how many opMargins are between p99 and 1.0 (the ones the CAP does NOT clamp but a p99 would have)?
const p99=quantile(opm,0.99);
console.log('opm in (p99,1.0]:',opm.filter(v=>v>p99&&v<=1.0).length,'(legit high margins spared by CAP vs old p99)');
console.log('opm >1.0 (clamped by CAP):',opm.filter(v=>v>1.0).length);
