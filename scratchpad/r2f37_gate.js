'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const SNAP_DIR = path.join(ROOT, 'snapshots');
const { route, structExcludeReason } = require(path.join(ROOT, 'src/scoring/router.js'));
const { norm, hasPresent, presentValues } = require(path.join(ROOT, 'src/scoring/snapshot.js'));
const lc = (x) => (typeof x === 'string' ? x.toLowerCase() : '');

const universe = [];
for (const f of fs.readdirSync(SNAP_DIR)) {
  if (!f.endsWith('.json')) continue;
  if (f === '_manifest.json' || f === '_manifest-full.json') continue;
  let s; try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch (_) { continue; }
  if (!s || !s.meta || !s.meta.ticker) continue;
  universe.push(s);
}

const reasons = new Map();
const lenderGp0 = [];
for (const s of universe) {
  const r = route(s);
  const key = r.action + (r.reason ? ':' + r.reason : (r.track ? ':' + r.track : ''));
  reasons.set(key, (reasons.get(key) || 0) + 1);
  if (r.reason === 'lender-gp0') lenderGp0.push(s.meta.ticker + ' [' + s.meta.industry + ']');
}
console.log('=== route reason tally (sorted) ===');
[...reasons.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`${v}\t${k}`));

console.log('\n=== lender-gp0 fired on', lenderGp0.length, 'names ===');
console.log(lenderGp0.join('\n'));

const FULL = /credit services|consumer finance|mortgage|savings|thrift|\blend/;
let inLending = 0, gp0InLending = 0, structExcludedFirst = 0;
const gp0Names = [];
for (const s of universe) {
  const ind = lc(s.meta.industry);
  if (!FULL.test(ind)) continue;
  inLending++;
  const gp = norm(s, 'annualGP');
  const isGp0 = hasPresent(gp) && presentValues(gp).every(v => v === 0);
  if (isGp0) {
    gp0InLending++;
    gp0Names.push(s.meta.ticker + ' [' + ind + '] structExcl=' + (structExcludeReason(s)||'no'));
    if (structExcludeReason(s)) structExcludedFirst++;
  }
}
console.log('\n=== Within LENDING industries:', inLending, 'names;', gp0InLending, 'all-zero GP;', structExcludedFirst, 'already struct-excluded ===');
console.log(gp0Names.join('\n'));
