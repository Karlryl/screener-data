const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const { norm, metricVal } = require(path.join(ROOT,'src/scoring/snapshot.js'));
function nqDetail(s){
  const rev=norm(s,'revenueQ'), oi=norm(s,'opIncQ'), gp=norm(s,'grossProfitQ');
  const r0=rev[0],oi0=oi[0],gp0=gp[0],r1=rev[1],oi1=oi[1];
  const q0opm=oi0/r0,q0gm=gp0/r0;
  const trailOpm=[],trailRev=[];
  for(let i=1;i<=4&&i<rev.length;i++){const ri=rev[i],oii=oi[i];if(ri>0)trailRev.push(ri);if(ri>0&&Number.isFinite(oii))trailOpm.push(oii/ri);}
  const med=a=>{const x=a.filter(Number.isFinite).slice().sort((p,q)=>p-q);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;};
  const trailOpmMed=med(trailOpm),trailRevMed=med(trailRev);
  const q1opm=(r1>0&&Number.isFinite(oi1))?oi1/r1:null;
  return {r0,r1,q0opm,q0gm,trailOpmMed,trailRevMed,q1opm,
    leg1:(q0opm-trailOpmMed)>0.20, leg2:q0gm>0.55, leg3:r0>1.35*trailRevMed,
    leg4:q1opm!==null&&q1opm>0.02&&q0opm>=1.9*q1opm, revQ:rev.slice(0,6), opIncQ:oi.slice(0,6)};
}
for (const t of ['LQDA','ONEX.TO','VCEL']) {
  const s=JSON.parse(fs.readFileSync(path.join(ROOT,'snapshots',t+'.json'),'utf8'));
  console.log('=== '+t+' ===', JSON.stringify(nqDetail(s),null,0));
  console.log('  name:', s.meta && (s.meta.name||s.meta.shortName), 'sector:', s.meta&&s.meta.sector);
}
