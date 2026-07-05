const fs=require('fs'),path=require('path');
const R='C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const axesFns=require(R+'/src/scoring/axes.js');
const score=require(R+'/src/scoring/score.js');
const {route}=require(R+'/src/scoring/router.js');
const formulas=require(R+'/src/scoring/formulas/index.js');
const dir=R+'/snapshots';
const snaps=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>{try{return JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));}catch(e){return null;}}).filter(Boolean);

// Replicate score.js sample collection precisely
const results=score.scoreUniverse(snaps,formulas);
// need route-only from a FRESH routing (scoreUniverse mutates action for dedup/no-axes/data-suspect)
// score.js collects samples from e.action==='route' AFTER dedup/data-suspect but BEFORE no-axes conversion.
// Reproduce by re-routing raw (approximation) then compare. Instead replicate the exact bounds:

const WINSOR_TAIL=0.01, OPMARGIN_CAP=1.0;
function quantile(samples,p){const a=samples.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const idx=(a.length-1)*p;const lo=Math.floor(idx),hi=Math.ceil(idx);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(idx-lo);}
function winsorTailBounds(samples){const lo=quantile(samples,WINSOR_TAIL),hi=quantile(samples,1-WINSOR_TAIL);return(lo===null||hi===null)?null:[lo,hi];}

// collect samples exactly as score.js: route-only, from routed set
// Use the results' route entries (matches score.js timing: dedup done, no-axes not yet reverted... actually score.js collects at line 237, no-axes conversion is later at 296)
const routedSnaps=results.filter(e=>e.action==='route').map(e=>e.snapshot).filter(Boolean);
// snapshot is deleted at end of scoreUniverse! so e.snapshot is undefined. Re-route manually.
