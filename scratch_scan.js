const fs = require('fs');
const path = require('path');
const { norm, ratioSeries, presentValues } = require('./src/scoring/snapshot.js');

const dir = 'snapshots';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

let divergeCount = 0;
let fireWithDiverge = [];
let allDiverge = [];

for (const f of files) {
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }

  const opIncS = norm(s, 'annualOpInc');
  const assets = norm(s, 'annualBalance', 'totalAssets');
  const curLiab = norm(s, 'annualBalance', 'currentLiabilities');

  const opPairedIdx = [];
  const nYears = Math.max(opIncS.length, assets.length);
  for (let i = 0; i < nYears; i++) {
    const o = opIncS[i], a = assets[i];
    if (o === null || o === undefined || a === null || a === undefined) continue;
    const c = curLiab[i];
    const inv = a - (c === null || c === undefined ? 0 : c);
    if (!(inv > 0)) continue;
    opPairedIdx.push(i);
  }
  if (opPairedIdx.length === 0) continue;
  const pairedNewestIdx = opPairedIdx[0];

  const marginSeries = ratioSeries(norm(s, 'annualOpInc'), norm(s, 'annualRev'));
  let marginNewestIdx = -1;
  for (let i = 0; i < marginSeries.length; i++) {
    if (Number.isFinite(marginSeries[i])) { marginNewestIdx = i; break; }
  }
  if (marginNewestIdx === -1) continue;

  const margins = presentValues(marginSeries);

  if (pairedNewestIdx !== marginNewestIdx) {
    divergeCount++;
    allDiverge.push(f.replace('.json',''));

    if (margins.length >= 3) {
      const cur = margins[0];
      const mean = (arr) => arr.reduce((p,c)=>p+c,0)/arr.length;
      const histRest = mean(margins.slice(1));
      const rising = margins[0] > margins[1];
      if (histRest > 0 && cur > histRest && !rising) {
        const overshoot = cur/histRest - 1;
        const disc = 1/(1+Math.max(0,overshoot));
        const pairedNewestMargin = marginSeries[pairedNewestIdx];
        fireWithDiverge.push({
          ticker: f.replace('.json',''),
          disc: disc.toFixed(4),
          curMargin0: cur,
          curMargin0Idx: marginNewestIdx,
          pairedNewestIdx,
          pairedNewestMargin
        });
      }
    }
  }
}

console.log('Total snapshots scanned:', files.length);
console.log('Divergent (pairedNewestIdx != marginNewestIdx):', divergeCount);
console.log('Divergent tickers:', allDiverge.join(', '));
console.log('--- Divergent AND cycleDiscount fires (disc<1) ---');
for (const r of fireWithDiverge) {
  console.log(JSON.stringify(r));
}
