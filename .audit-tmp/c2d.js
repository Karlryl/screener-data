const fs=require('fs'),path=require('path');
const R='C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const axesFns=require(R+'/src/scoring/axes.js');
const {route}=require(R+'/src/scoring/router.js');
const formulas=require(R+'/src/scoring/formulas/index.js');
const dir=R+'/snapshots';
const snaps=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>{try{return JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));}catch(e){return null;}}).filter(Boolean);
const routed=snaps.filter(s=>route(s).action==='route');

// opMargin lower bound = -13.09. How many quarter-margins get clamped at the LOW end?
const opmBounds=[-13.089142618563454,1.0];
let clampedLo=0,clampedHi=0,tot=0;
for(const s of routed){
  const raw=axesFns.quarterOpMargins(s); // unbounded
  for(const v of raw){tot++;if(v<opmBounds[0])clampedLo++;if(v>opmBounds[1])clampedHi++;}
}
console.log('total opm samples',tot,'clampedLo(<-13.09)',clampedLo,'clampedHi(>1)',clampedHi);

// Does clamping change marginTrajectory sign or rank for any NON-stub name?
// marginTrajectory = newest - oldest of quarter opmargins. Compare bounded vs unbounded per name.
const tk=s=>(s.meta&&s.meta.ticker)||'?';
let flips=[];
for(const s of routed){
  const u=axesFns.marginTrajectory(s,null);
  const b=axesFns.marginTrajectory(s,opmBounds);
  if(u===null&&b===null)continue;
  if(u===null||b===null){flips.push([tk(s),'nullflip',u,b]);continue;}
  if(Math.sign(u)!==Math.sign(b)&&Math.abs(u-b)>1e-9){flips.push([tk(s),'signflip',u.toFixed(3),b.toFixed(3)]);}
}
console.log('marginTraj sign/null flips from clamping:',flips.length);
for(const f of flips.slice(0,40))console.log(' ',f.join(' '));
