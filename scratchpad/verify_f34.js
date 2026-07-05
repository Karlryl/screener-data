const fs = require('fs');
const path = require('path');
const repo = path.join(__dirname, '..');
const { norm, presentValues } = require(path.join(repo, 'src/scoring/snapshot.js'));

const dir = path.join(repo, 'snapshots');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

let total = 0, reach8 = 0, maxPresent = 0, withInnerGaps8 = 0, ttmEffective = 0;

for (const f of files) {
  let snap;
  try { snap = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
  catch (e) { continue; }
  total++;
  const normSeries = norm(snap, 'grossProfitQ');
  const present = presentValues(normSeries);
  if (present.length > maxPresent) maxPresent = present.length;
  if (present.length >= 8) {
    reach8++;
    const ttmNew = present.slice(0,4).reduce((p,c)=>p+c,0);
    const ttmOld = present.slice(4,8).reduce((p,c)=>p+c,0);
    if (ttmOld > 0) ttmEffective++;
    let seenPresent = 0, sawGapBeforeEighth = false, idx = 0;
    for (; idx < normSeries.length && seenPresent < 8; idx++) {
      if (Number.isFinite(normSeries[idx])) seenPresent++;
      else sawGapBeforeEighth = true;
    }
    if (sawGapBeforeEighth) withInnerGaps8++;
  }
}

console.log('total snapshots parsed:', total);
console.log('grossProfitQ >=8 present (TTM branch reachable):', reach8);
console.log('  of those, ttmOld>0 (TTM actually returned):', ttmEffective);
console.log('  of those, with inner null gaps in first 8 (misalignment possible):', withInnerGaps8);
console.log('max present grossProfitQ quarters across universe:', maxPresent);
