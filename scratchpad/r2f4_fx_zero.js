'use strict';
const fs = require('fs');
const path = require('path');
const { norm } = require('./../src/scoring/snapshot.js');
const SNAP_DIR = path.join(__dirname, '..', 'snapshots');

function mtNew(s){const oi=norm(s,'opIncQ'),rev=norm(s,'revenueQ');const p=[];const n=Math.max(oi.length,rev.length);for(let i=0;i<n;i++){const r=rev[i],o=oi[i];if(!(r>0))continue;if(o==null||!Number.isFinite(o))continue;p.push(o/r);}if(p.length<2)return null;return p[0]-p[p.length-1];}

// FX-invariance: scale BOTH opIncQ and revenueQ by k (a real FX conversion does this uniformly)
function mtScaled(s,k){
  const c=JSON.parse(JSON.stringify(s));
  for(const fld of ['opIncQ','revenueQ']){
    if(Array.isArray(c.timeseries&&c.timeseries[fld])){
      c.timeseries[fld]=c.timeseries[fld].map(e=>{
        if(e==null)return e;
        if(typeof e==='object'&&'value'in e)return {...e,value:(typeof e.value==='number')?e.value*k:e.value};
        return (typeof e==='number')?e*k:e;
      });
    }
  }
  return mtNew(c);
}

let total=0,scored=0,fxMismatch=0,zeroRevQ=0;const mm=[];
for (const f of fs.readdirSync(SNAP_DIR)){
  if(!f.endsWith('.json')||f.startsWith('_manifest'))continue;
  let s;try{s=JSON.parse(fs.readFileSync(path.join(SNAP_DIR,f),'utf8'));}catch{continue;}
  if(!s||!s.meta||!s.meta.ticker)continue;
  total++;
  const rev=norm(s,'revenueQ');
  if(rev.some(v=>v===0))zeroRevQ++;
  const base=mtNew(s);
  const sc=mtScaled(s,7.5);
  if(base!==null)scored++;
  // compare null-status and value (allow fp epsilon)
  const bothNull=(base===null&&sc===null);
  const bothNum=(base!==null&&sc!==null);
  if(!bothNull){
    if(!bothNum || Math.abs(base-sc)>1e-9*(1+Math.abs(base))){
      fxMismatch++; if(mm.length<10)mm.push(`${s.meta.ticker}: base ${base} scaled ${sc}`);
    }
  }
}
console.log('total           :',total);
console.log('scored (non-null):',scored);
console.log('names w/ revQ===0:',zeroRevQ);
console.log('FX x7.5 mismatches:',fxMismatch, mm);
