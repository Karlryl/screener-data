// Probe R2F39: count revenueQ===0 quarters and those with finite nonzero opIncQ at same index.
// Mirrors axes.js marginTrajectory: oi = norm(s,'opIncQ'), rev = norm(s,'revenueQ'), index-aligned.
const fs = require('fs');
const path = require('path');
const { norm } = require('../src/scoring/snapshot.js');

const SNAP_DIR = path.join(__dirname, '..', 'snapshots');
let total = 0, parseFail = 0;
let zeroRevQuarters = 0;       // revenueQ exactly === 0
let zeroRevWithFiniteOi = 0;   // of those, opIncQ finite AND nonzero -> would yield +/-Infinity under mutation
const culprits = [];

for (const f of fs.readdirSync(SNAP_DIR)) {
  if (!f.endsWith('.json')) continue;
  if (f === '_manifest.json' || f === '_manifest-full.json') continue;
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); }
  catch (e) { parseFail++; continue; }
  if (!s || !s.meta || !s.meta.ticker) continue;
  total++;
  const oi = norm(s, 'opIncQ');
  const rev = norm(s, 'revenueQ');
  const n = Math.max(oi.length, rev.length);
  for (let i = 0; i < n; i++) {
    const r = rev[i], o = oi[i];
    if (r === 0) {
      zeroRevQuarters++;
      if (o !== null && o !== undefined && Number.isFinite(o) && o !== 0) {
        zeroRevWithFiniteOi++;
        const ratio = o / r; // demonstrate the mutation result
        culprits.push({ ticker: s.meta.ticker, i, opIncQ: o, revenueQ: r, ratio });
      }
    }
  }
}

console.log(`universe parsed: ${total}, parseFail: ${parseFail}`);
console.log(`revenueQ===0 quarters: ${zeroRevQuarters}`);
console.log(`  of those, finite nonzero opIncQ (=> Infinity under r>=0 mutation): ${zeroRevWithFiniteOi}`);
console.log('culprits:');
for (const c of culprits) console.log(`  ${c.ticker} [q${c.i}] oi=${c.opIncQ} rev=${c.revenueQ} -> o/r=${c.ratio}`);
