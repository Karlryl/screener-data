'use strict';
// Reproduce R2F1: count how dilution axis drops due to the [0,1] clamp.
const fs = require('fs');
const path = require('path');
const { norm, hasPresent, firstPresent, ratioSeries } = require('../src/scoring/snapshot.js');

const SNAP_DIR = path.join(__dirname, '..', 'snapshots');
const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_manifest'));

function lastPresent(series) {
  if (!Array.isArray(series)) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null && series[i] !== undefined) return series[i];
  }
  return null;
}

let total = 0;
let sbcPresent = 0;
let dropAfterClamp = 0;       // level === null after clamp (axis drops)
let dropNewestGT1 = 0;        // newest raw ratio > 1 AND axis drops
let newestGT1_butSurvives = 0;// newest >1 but an older year in [0,1] -> axis survives
let dropAllOutOfRange = 0;    // every raw ratio out of [0,1]
const samples = [];
const newestGT1Names = [];

for (const f of files) {
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
  if (!s || !s.meta || !s.meta.ticker) continue;
  total++;
  const sbc = norm(s, 'annualSBC');
  if (!hasPresent(sbc)) continue;
  sbcPresent++;
  const rawR = ratioSeries(sbc, norm(s, 'annualRev'));
  const clamped = rawR.map((v) => (v !== null && v >= 0 && v <= 1) ? v : null);
  const level = firstPresent(clamped);
  const newestRaw = firstPresent(rawR); // first non-null raw ratio (newest present)

  const newestGT1 = (newestRaw !== null && newestRaw > 1);
  if (newestGT1) newestGT1Names.push({ t: s.meta.ticker, newestRaw });

  if (level === null) {
    dropAfterClamp++;
    const anyInRange = rawR.some(v => v !== null && v >= 0 && v <= 1);
    if (!anyInRange) dropAllOutOfRange++;
    if (newestGT1) dropNewestGT1++;
    if (samples.length < 30) samples.push({ t: s.meta.ticker, newestRaw, rawR: rawR.filter(v=>v!==null) });
  } else {
    if (newestGT1) newestGT1_butSurvives++;
  }
}

console.log('total snapshots:', total);
console.log('sbc present:', sbcPresent);
console.log('axis drops after clamp (level===null):', dropAfterClamp);
console.log('  of which newest raw ratio >1:', dropNewestGT1);
console.log('  of which ALL years out of [0,1]:', dropAllOutOfRange);
console.log('newest>1 but axis SURVIVES (older year in range):', newestGT1_butSurvives);
console.log('total names with newest raw ratio >1:', newestGT1Names.length);
console.log('--- drop samples ---');
for (const x of samples) console.log(x.t, 'newestRaw=', x.newestRaw, 'rawR=', JSON.stringify(x.rawR));
console.log('--- specific finding tickers ---');
for (const t of ['ACHR','ABVX','AAVXF','CRNX','AUR','ENVX','CLDX','AEVA','CGON','DNTH']) {
  const f = newestGT1Names.find(x => x.t === t);
  const inSnap = files.includes(t + '.json');
  console.log(t, 'snapshotExists=', inSnap, 'newest>1?', f ? ('yes newestRaw='+f.newestRaw) : 'no');
}
