const path=require('path'), ROOT=__dirname;
const d=require(path.join(ROOT,'external-data','sec-secannual.json'));
// Diskriminator-Test: "terminal monotonic recovery" — feuert das Verlustjahr/Flip am ENDE (Zyklus-Downturn, MU)
// oder ist das juengste Segment monoton-positiv nach frueh-Verlust-Ramp (Biotech/MedTech turnaround, VRTX/STAA)?
function chron(a){return a.map(e=>(e&&typeof e==='object')?e.value:e).filter(Number.isFinite).slice().reverse();}
function tailPositiveRun(op){ // wie viele der JUENGSTEN Jahre ununterbrochen >0
  let n=0; for(let i=op.length-1;i>=0;i--){ if(op[i]>0) n++; else break; } return n; }
function firstProfitIdx(op){ for(let i=0;i<op.length;i++) if(op[i]>0) return i; return -1; }
for(const tk of ['VRTX','STAA','ARWR','MU','CLF','BTU','KRO','MXL','SLAB','COHU']){
  const op=chron(d[tk].annualOpInc);
  const fp=firstProfitIdx(op);
  console.log(tk.padEnd(6),'len='+String(op.length).padEnd(2),
    'tailPosRun='+tailPositiveRun(op),
    'firstProfitAtYear='+fp+'/'+op.length,
    'lastYear='+(op[op.length-1]>0?'+':'-'),
    '| earlyRamp(first'+Math.min(6,op.length)+')signs='+op.slice(0,6).map(x=>x>0?'+':(x<0?'-':'0')).join(''),
    'recent(last6)signs='+op.slice(-6).map(x=>x>0?'+':(x<0?'-':'0')).join(''));
}
