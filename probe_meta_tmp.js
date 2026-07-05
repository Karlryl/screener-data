const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
for (const t of ['MU','NVDA','SNDK','005930.KS','AKRBP.OL','GMAB.CO']) {
  const p = path.join(ROOT,'snapshots', t + '.json');
  if (!fs.existsSync(p)) { console.log(t,'MISSING'); continue; }
  const s = JSON.parse(fs.readFileSync(p,'utf8'));
  const m = s.meta || {};
  console.log(t, 'repOrig=', m.reportingCurrencyOriginal, 'trade=', m.tradingCurrency, 'repCur=', m.reportingCurrency, 'finCur=', m.financialCurrency);
}
