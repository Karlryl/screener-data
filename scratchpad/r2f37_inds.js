'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const SNAP_DIR = path.join(ROOT, 'snapshots');
const lc = (x) => (typeof x === 'string' ? x.toLowerCase() : '');
const cnt = new Map();
for (const f of fs.readdirSync(SNAP_DIR)) {
  if (!f.endsWith('.json')) continue;
  if (f === '_manifest.json' || f === '_manifest-full.json') continue;
  let s; try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch (_) { continue; }
  if (!s || !s.meta || !s.meta.ticker) continue;
  const ind = lc(s.meta.industry);
  cnt.set(ind, (cnt.get(ind)||0)+1);
}
// lending-adjacent keyword scan beyond the regex
const adj = /financ|loan|lend|credit|bank|mortgage|savings|thrift|capital|invest|asset manage|fund|broker|insur/;
console.log('=== financial-adjacent industries (keyword scan) ===');
[...cnt.entries()].filter(([i])=>adj.test(i)).sort((a,b)=>b[1]-a[1]).forEach(([i,c])=>console.log(`${c}\t${i}`));
