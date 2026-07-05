const fs = require('fs');
const { norm, ratioSeries, presentValues } = require('./src/scoring/snapshot.js');
const s = JSON.parse(fs.readFileSync('snapshots/AWR.json','utf8'));

const opIncS = norm(s, 'annualOpInc');
const assets = norm(s, 'annualBalance', 'totalAssets');
const curLiab = norm(s, 'annualBalance', 'currentLiabilities');
const rev = norm(s, 'annualRev');

console.log('annualOpInc :', JSON.stringify(opIncS));
console.log('annualRev   :', JSON.stringify(rev));
console.log('totalAssets :', JSON.stringify(assets));
console.log('currentLiab :', JSON.stringify(curLiab));
const marginSeries = ratioSeries(norm(s,'annualOpInc'), norm(s,'annualRev'));
console.log('marginSeries (raw, year-aligned):', JSON.stringify(marginSeries));
console.log('margins = presentValues(marginSeries):', JSON.stringify(presentValues(marginSeries)));

// paired indices
const opPairedIdx=[]; const nYears=Math.max(opIncS.length,assets.length);
for(let i=0;i<nYears;i++){const o=opIncS[i],a=assets[i]; if(o==null||a==null)continue; const c=curLiab[i]; const inv=a-(c==null?0:c); if(!(inv>0))continue; opPairedIdx.push(i);}
console.log('opPairedIdx:', JSON.stringify(opPairedIdx), ' -> pairedNewestIdx=', opPairedIdx[0]);
console.log('marginSeries at pairedNewestIdx', opPairedIdx[0], '=', marginSeries[opPairedIdx[0]]);

// Now compute the actual axis value with current code
const { capitalEfficiency } = (()=>{ // re-extract by requiring axes if exported
  try { return require('./src/scoring/axes.js'); } catch(e){ return {}; }
})();
if (capitalEfficiency) {
  console.log('capitalEfficiency(AWR) =', capitalEfficiency(s));
}
