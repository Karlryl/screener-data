const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const L = require(path.join(ROOT,'src/scoring/lamps.js'));
const targets = ['MU','NVDA','SNDK','005930.KS'];
for (const t of targets) {
  const p = path.join(ROOT,'snapshots', t + '.json');
  if (!fs.existsSync(p)) { console.log(t, 'MISSING'); continue; }
  const s = JSON.parse(fs.readFileSync(p,'utf8'));
  const r = L.evaluateLamps(s);
  console.log('=== '+t+' ===');
  console.log('  newestQtrSuspect =', r.flags.newestQtrSuspect);
  console.log('  annualCurrencyLeak =', r.flags.annualCurrencyLeak);
  console.log('  active =', JSON.stringify(r.active));
}
