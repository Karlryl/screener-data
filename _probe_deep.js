const path = require('path');
const ROOT = __dirname;
const d = require(path.join(ROOT, 'external-data', 'sec-secannual.json'));
const S = require(path.join(ROOT, 'src', 'scoring', 'score.js'));
function chron(arr){ if(!Array.isArray(arr)) return []; return arr.map(e=> (e&&typeof e==='object')?e.value:e).filter(x=>Number.isFinite(x)).slice().reverse(); } // oldest->newest, finite
function report(tk){
  const e=d[tk]; if(!e){ console.log(tk.padEnd(6),'-- not in secannual'); return; }
  const opFull=chron(e.annualOpInc); const revFull=chron(e.annualRev);
  const op4=opFull.slice(-4); const rev4=revFull.slice(-4);
  const sfFull=S.signFlips(opFull); const sf4=S.signFlips(op4);
  const ddFull=S.revMaxDrawdown(revFull.slice().reverse());
  const dd4=S.revMaxDrawdown(rev4.slice().reverse());
  console.log(tk.padEnd(6), 'len='+String(opFull.length).padEnd(2),
    '| DEEP flips='+sfFull, 'osc='+Math.max(0,sfFull-1), 'revDD='+ddFull.toFixed(3),
    '|| 4J flips='+sf4, 'osc4='+Math.max(0,sf4-1), 'revDD4='+dd4.toFixed(3));
  console.log('       opInc(old->new,$M):', opFull.map(x=>Math.round(x/1e6)).join(', '));
}
console.log('=== UMSTRITTEN (lumpy-growth?) ===');
['VRTX','ARWR','STAA','CRSR','SONO','APPS','CALX'].forEach(report);
console.log('=== ZYKLIKER-KERN ===');
['MU','CLF','BTU','KRO','COHU','MXL','SLAB'].forEach(report);
