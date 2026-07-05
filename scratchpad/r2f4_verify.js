'use strict';
const fs = require('fs');
const path = require('path');
const { norm, ratioSeries } = require('./../src/scoring/snapshot.js');

const SNAP_DIR = path.join(__dirname, '..', 'snapshots');

// OLD (pre-fix 4ad676bc7f): ratioSeries drops den===0 but NOT den<0
function mtOld(s) {
  const present = ratioSeries(norm(s, 'opIncQ'), norm(s, 'revenueQ'))
    .filter((v) => v !== null && v !== undefined);
  if (present.length < 2) return null;
  return present[0] - present[present.length - 1];
}

// NEW (current axes.js): guard !(r>0)
function mtNew(s) {
  const oi = norm(s, 'opIncQ'), rev = norm(s, 'revenueQ');
  const present = [];
  const n = Math.max(oi.length, rev.length);
  for (let i = 0; i < n; i++) {
    const r = rev[i], o = oi[i];
    if (!(r > 0)) continue;
    if (o === null || o === undefined || !Number.isFinite(o)) continue;
    present.push(o / r);
  }
  if (present.length < 2) return null;
  return present[0] - present[present.length - 1];
}

let total = 0, negRevQ = 0;
let axisLostByGuard = 0;   // old had value, new is null  (legit axis dropped?)
let axisGainedByGuard = 0; // old null, new has value     (fabrication?)
let changedValue = 0;      // both non-null but differ
const lostNames = [], gainedNames = [], changedSamples = [];

for (const f of fs.readdirSync(SNAP_DIR)) {
  if (!f.endsWith('.json') || f.startsWith('_manifest')) continue;
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
  if (!s || !s.meta || !s.meta.ticker) continue;
  total++;
  const rev = norm(s, 'revenueQ');
  const hasNeg = rev.some(v => v !== null && v !== undefined && Number.isFinite(v) && v < 0);
  if (hasNeg) negRevQ++;

  const o = mtOld(s), nw = mtNew(s);
  if (o !== null && nw === null) { axisLostByGuard++; lostNames.push(s.meta.ticker); }
  if (o === null && nw !== null) { axisGainedByGuard++; gainedNames.push(s.meta.ticker); }
  if (o !== null && nw !== null && o !== nw) {
    changedValue++;
    if (hasNeg && changedSamples.length < 12)
      changedSamples.push(`${s.meta.ticker}: old ${o.toFixed(4)} -> new ${nw.toFixed(4)}`);
  }
}

console.log('total snapshots          :', total);
console.log('names w/ negative revenueQ:', negRevQ);
console.log('axisLostByGuard (old->null):', axisLostByGuard, lostNames.slice(0,20));
console.log('axisGainedByGuard(null->val):', axisGainedByGuard, gainedNames.slice(0,20));
console.log('changedValue (both, differ) :', changedValue);
console.log('changed samples (neg revQ)  :');
changedSamples.forEach(x => console.log('   ', x));
