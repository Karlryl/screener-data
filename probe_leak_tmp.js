const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const L = require(path.join(ROOT,'src/scoring/lamps.js'));
const { norm, metricVal } = require(path.join(ROOT,'src/scoring/snapshot.js'));
for (const t of ['AKRBP.OL','GMAB.CO']) {
  const p = path.join(ROOT,'snapshots', t + '.json');
  if (!fs.existsSync(p)) { console.log(t,'MISSING'); continue; }
  const s = JSON.parse(fs.readFileSync(p,'utf8'));
  const a0 = norm(s,'annualRev')[0];
  const revQ = norm(s,'revenueQ').slice(0,6);
  const revTTM = metricVal(s,'revenueTTM');
  const q = revQ.filter(Number.isFinite).slice(0,4);
  const qTTM = q.length>=4 ? q[0]+q[1]+q[2]+q[3] : null;
  console.log('=== '+t+' ===');
  console.log('  meta repOrig/trade:', s.meta.reportingCurrencyOriginal, s.meta.tradingCurrency);
  console.log('  a0(annualRev[0])=', a0);
  console.log('  revQ[0..5]=', JSON.stringify(revQ));
  console.log('  qTTM=', qTTM, ' a0/qTTM=', qTTM? (a0/qTTM).toFixed(3):null);
  console.log('  revTTM=', revTTM, ' ttmRatio=', (qTTM&&revTTM)?(revTTM/qTTM).toFixed(3):null);
  console.log('  annualCurrencyLeak =', L.annualCurrencyLeak(s));
}
