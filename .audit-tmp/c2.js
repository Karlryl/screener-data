const fs = require('fs');
const path = require('path');
const R = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const axesFns = require(R+'/src/scoring/axes.js');
const score = require(R+'/src/scoring/score.js');
const formulas = require(R+'/src/scoring/formulas/index.js');

const dir = R+'/snapshots';
const files = fs.readdirSync(dir).filter(f=>f.endsWith('.json'));
const snaps = [];
for (const f of files) {
  try { snaps.push(JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))); } catch(e){}
}
console.log('loaded', snaps.length);
const results = score.scoreUniverse(snaps, formulas);
const routed = results.filter(e=>e.action==='route');
const excluded = {};
for (const e of results) if (e.action==='exclude'||e.action==='unrouted') { const k=e.reason||e.action; excluded[k]=(excluded[k]||0)+1; }
console.log('routed', routed.length, 'excluded', JSON.stringify(excluded));
