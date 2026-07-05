const { gpClass } = require('../src/scoring/router.js');
const { overviewMetric } = require('../src/scoring/overview.js');
const fs = require('fs');
const path = require('path');

function probe(s) {
  const a = overviewMetric(s, { gpClass: 'real' });
  const b = overviewMetric(s, { gpClass: 'none' });
  return JSON.stringify(a) === JSON.stringify(b);
}

const dir = path.join(__dirname, '..', 'snapshots');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
let identical = 0, differ = 0, differExamples = [];
for (const f of files) {
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  if (probe(s)) identical++; else { differ++; if (differExamples.length<5) differExamples.push(f); }
}
console.log('files', files.length);
console.log('overviewMetric identical real==none:', identical, 'differ:', differ, differExamples);

// reproduce the finding's specific tickers
const names = ['AB','ALLY','COF','KBDC','PDX'];
for (const n of names) {
  const p = path.join(dir, n + '.json');
  if (!fs.existsSync(p)) { console.log(n, 'MISSING'); continue; }
  const s = JSON.parse(fs.readFileSync(p,'utf8'));
  const gmv = (s.metrics && s.metrics.grossMargin) ? s.metrics.grossMargin.value : undefined;
  const a = overviewMetric(s, { gpClass: 'real' });
  const b = overviewMetric(s, { gpClass: 'none' });
  console.log(n, 'gpClass=', gpClass(s), 'grossMargin.value=', gmv, 'real:', JSON.stringify(a), 'none:', JSON.stringify(b));
}
