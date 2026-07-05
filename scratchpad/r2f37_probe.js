const fs = require('fs');
const path = require('path');
const SNAP_DIR = 'snapshots';

// EXACT regex from router.js:52
const LENDING_INDUSTRY = /credit services|consumer finance|mortgage|savings|thrift|\blend/;
const lc = (s) => (s == null ? '' : String(s)).toLowerCase().trim();

const branches = {
  'credit services': /credit services/,
  'consumer finance': /consumer finance/,
  'mortgage': /mortgage/,
  'savings': /savings/,
  'thrift': /thrift/,
  '\blend': /\blend/,
};

const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json'));
const industryCount = new Map(); // industry -> count
let parseFail = 0;
for (const f of files) {
  let p;
  try { p = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); }
  catch (e) { parseFail++; continue; }
  const ind = p && p.meta ? p.meta.industry : undefined;
  const key = ind == null ? '<<null/undefined>>' : String(ind);
  industryCount.set(key, (industryCount.get(key) || 0) + 1);
}

const distinct = [...industryCount.keys()];
console.log('total files:', files.length, 'parseFail:', parseFail);
console.log('distinct industry values:', distinct.length);

// Which distinct industries match the full regex
const matched = [];
for (const ind of distinct) {
  if (ind === '<<null/undefined>>') continue;
  if (LENDING_INDUSTRY.test(lc(ind))) matched.push(ind);
}
console.log('\n[LENDING_INDUSTRY matches] (' + matched.length + ' distinct industries):');
for (const m of matched.sort()) console.log('  ', JSON.stringify(m), '-> count', industryCount.get(m));

// Per-branch: which branches match >=1 distinct industry
console.log('\n[Per-branch live/dead on current universe]');
for (const [name, rx] of Object.entries(branches)) {
  const hits = distinct.filter(ind => ind !== '<<null/undefined>>' && rx.test(lc(ind)));
  const totalCount = hits.reduce((a, ind) => a + industryCount.get(ind), 0);
  console.log('  branch', JSON.stringify(name), '-> distinct industries:', hits.length,
    '| total companies:', totalCount, hits.length ? '| e.g. ' + JSON.stringify(hits.slice(0,5)) : '<< DEAD');
}
