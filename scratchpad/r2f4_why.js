'use strict';
const fs = require('fs');
const path = require('path');
const { norm, ratioSeries } = require('./../src/scoring/snapshot.js');
const SNAP_DIR = path.join(__dirname, '..', 'snapshots');

function mtOld(s){const p=ratioSeries(norm(s,'opIncQ'),norm(s,'revenueQ')).filter(v=>v!=null);if(p.length<2)return null;return p[0]-p[p.length-1];}
function mtNew(s){const oi=norm(s,'opIncQ'),rev=norm(s,'revenueQ');const p=[];const n=Math.max(oi.length,rev.length);for(let i=0;i<n;i++){const r=rev[i],o=oi[i];if(!(r>0))continue;if(o==null||!Number.isFinite(o))continue;p.push(o/r);}if(p.length<2)return null;return p[0]-p[p.length-1];}

for (const f of fs.readdirSync(SNAP_DIR)) {
  if (!f.endsWith('.json')||f.startsWith('_manifest')) continue;
  let s; try{s=JSON.parse(fs.readFileSync(path.join(SNAP_DIR,f),'utf8'));}catch{continue;}
  if(!s||!s.meta||!s.meta.ticker)continue;
  const o=mtOld(s),nw=mtNew(s);
  if(o!=null&&nw!=null&&o!==nw){
    const rev=norm(s,'revenueQ');
    const negIdx=rev.map((v,i)=>(v!=null&&Number.isFinite(v)&&v<0)?i:-1).filter(i=>i>=0);
    // is there any non-negative-revQ explanation? Check if every divergence-driver is a neg revQ qtr
    const hasNeg = negIdx.length>0;
    console.log(`${s.meta.ticker.padEnd(8)} old ${o.toFixed(4).padStart(9)} new ${nw.toFixed(4).padStart(9)}  negRevQ@${JSON.stringify(negIdx)}  revQ=${JSON.stringify(rev.map(v=>v==null?null:Math.round(v)))}`);
  }
}
