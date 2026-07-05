'use strict';
const fs = require('fs');
const path = require('path');
const { norm, metricVal, firstPresent, presentValues } = require('./src/scoring/snapshot.js');
const { q, weightedScore, coverageWeight, signTrack } = require('./src/scoring/engine.js');
const { route } = require('./src/scoring/router.js');
const { evaluateLamps } = require('./src/scoring/lamps.js');
const axesFns = require('./src/scoring/axes.js');
const formulas = require('./src/scoring/formulas/index.js');
const { rawAxisValue, trackOf, scoreUniverse, produceRankings } = require('./src/scoring/score.js');

const SNAP_DIR = path.join(__dirname, 'snapshots');
function loadUniverse() {
  const u = [];
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!f.endsWith('.json')) continue;
    if (f.startsWith('_manifest') || f === '_last_good_disk.json') continue;
    let s; try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch(_) { continue; }
    if (s && s.meta && s.meta.ticker) u.push(s);
  }
  return u;
}
const universe = loadUniverse();
const results = scoreUniverse(universe, formulas);

// find all routed with final score, sorted desc
const scored = results.filter(e=>e.action==='route'&&e.score!==null).sort((a,b)=>b.score-a.score);
console.log('=== TOP 20 FINAL SCORES (post-C4) ===');
for (const e of scored.slice(0,20)) {
  console.log(`${e.ticker.padEnd(12)} ${e.formulaId}|${e.track} score=${e.score.toFixed(2)}`);
}
console.log('\ntotal route+scored:', scored.length, ' max:', scored[0].score.toFixed(2), ' >=90:', scored.filter(e=>e.score>=90).length, ' >=85:', scored.filter(e=>e.score>=85).length, ' >=80:', scored.filter(e=>e.score>=80).length);

// anchors
console.log('\n=== ANCHORS ===');
for (const t of ['PLTR','CRDO','ALAB','BE','2383.TW','2308.TW','WTC.AX']) {
  const e = scored.find(x=>x.ticker===t) || results.find(x=>x.ticker===t);
  if (e) console.log(`${t.padEnd(10)} action=${e.action} score=${e.score!==null&&e.score!==undefined?e.score.toFixed(2):'--'}`);
  else console.log(`${t.padEnd(10)} NOT FOUND`);
}
