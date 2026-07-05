'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse, produceRankings } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');

const SNAP_DIR = path.join(__dirname, '..', 'snapshots');
const files = fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json'));
const universe = [];
for (const f of files) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8'));
    if (s && s.meta && s.meta.ticker) universe.push(s);
  } catch (_) {}
}
console.log('Universum:', universe.length);
const results = scoreUniverse(universe, formulas);

const topN = 100;
const ranked = produceRankings(results, { topN });

// === Q1: topN-Kappung ===
console.log('\n=== Q1 topN-Kappung (topN='+topN+') ===');
console.log('overview.length =', ranked.overview.length, '(erwartet <= topN*2 =', topN*2, ')');
let maxBranch = 0, branchOverCount = 0;
for (const [id, b] of Object.entries(ranked.branches)) {
  for (const t of Object.keys(b)) {
    if (b[t].length > topN) { branchOverCount++; console.log('  OVER topN:', id, t, b[t].length); }
    maxBranch = Math.max(maxBranch, b[t].length);
  }
}
console.log('max branch-track length =', maxBranch, '; branches over topN:', branchOverCount);

// How many route-scored rows total exist (uncapped) vs overview cap
const routedScored = results.filter((e) => e.action === 'route' && e.score !== null);
console.log('total routed+scored (uncapped) =', routedScored.length);
console.log('overview is capped at topN*2 =', topN*2, '-> dropped from overview:', Math.max(0, routedScored.length - topN*2));

// === Q2: geo-enrichment on ALL rows ===
console.log('\n=== Q2 geo-Anreicherung auf ALLEN Zeilen ===');
function checkGeo(rows, label) {
  let missingCountry=0, missingMcapField=0, total=0;
  for (const r of rows) {
    total++;
    if (!('country' in r)) missingCountry++;
    if (!('marketCap' in r)) missingMcapField++;
  }
  console.log(`  ${label}: ${total} rows, missing 'country' key=${missingCountry}, missing 'marketCap' key=${missingMcapField}`);
}
let allBranchRows = [];
for (const b of Object.values(ranked.branches)) for (const t of Object.keys(b)) allBranchRows = allBranchRows.concat(b[t]);
checkGeo(allBranchRows, 'branch rows');
checkGeo(ranked.overview, 'overview rows');
checkGeo(ranked.survival, 'survival rows');

// === Q3: Sort-Determinismus ===
console.log('\n=== Q3 Sort-Determinismus (2 Laeufe + reversed input) ===');
function fingerprint(rk) {
  const parts = [];
  for (const id of Object.keys(rk.branches).sort()) {
    for (const t of Object.keys(rk.branches[id]).sort()) {
      parts.push(id+'|'+t+'='+rk.branches[id][t].map(r=>r.ticker).join(','));
    }
  }
  parts.push('OV='+rk.overview.map(r=>r.ticker).join(','));
  parts.push('SV='+rk.survival.map(r=>r.ticker).join(','));
  return parts.join('\n');
}
const r2 = produceRankings(scoreUniverse(universe.slice().reverse(), formulas), { topN });
const fp1 = fingerprint(ranked), fp2 = fingerprint(r2);
console.log('reversed-input fingerprint identical:', fp1 === fp2);
if (fp1 !== fp2) {
  const a = fp1.split('\n'), c = fp2.split('\n');
  for (let i=0;i<Math.max(a.length,c.length);i++) if (a[i]!==c[i]) { console.log('  DIFF line', i); console.log('   A:', (a[i]||'').slice(0,200)); console.log('   B:', (c[i]||'').slice(0,200)); break; }
}

// === Q4: Doppel-Zaehlung zwischen Toepfen ===
console.log('\n=== Q4 Doppel-Zaehlung ===');
// A ticker in branches AND survival? branches AND excluded? overview ticker set ⊆ branch ticker set?
const branchTickers = new Set(allBranchRows.map(r=>r.ticker));
const survTickers = new Set(ranked.survival.map(r=>r.ticker));
const ovTickers = new Set(ranked.overview.map(r=>r.ticker));
let inBranchAndSurv = [...branchTickers].filter(t=>survTickers.has(t));
console.log('tickers in BOTH a branch and survival:', inBranchAndSurv.length, inBranchAndSurv.slice(0,10));
// overview tickers that are NOT in any branch (should be empty -> overview is subset of routed)
let ovNotInBranch = [...ovTickers].filter(t=>!branchTickers.has(t));
console.log('overview tickers NOT present in any branch row (note: branch capped at topN, overview at topN*2):', ovNotInBranch.length, ovNotInBranch.slice(0,10));
// Same ticker appearing twice within a single branch-track list?
let dupInList = 0;
for (const b of Object.values(ranked.branches)) for (const t of Object.keys(b)) {
  const seen = new Set();
  for (const r of b[t]) { if (seen.has(r.ticker)) dupInList++; seen.add(r.ticker); }
}
console.log('duplicate ticker within a single branch-track list:', dupInList);
// Same ticker in two different branches (could legitimately not happen — each name routes to ONE formula)?
const tickerToBranches = {};
for (const [id,b] of Object.entries(ranked.branches)) for (const t of Object.keys(b)) for (const r of b[t]) {
  (tickerToBranches[r.ticker] ||= new Set()).add(id+'/'+t);
}
const multiBranch = Object.entries(tickerToBranches).filter(([k,v])=>v.size>1);
console.log('tickers appearing in >1 branch/track:', multiBranch.length, multiBranch.slice(0,5).map(([k,v])=>k+':'+[...v].join('&')));
// duplicate within overview list
{ const seen=new Set(); let d=0; for (const r of ranked.overview){ if(seen.has(r.ticker))d++; seen.add(r.ticker);} console.log('duplicate ticker within overview list:', d); }
// duplicate within survival list
{ const seen=new Set(); let d=0; for (const r of ranked.survival){ if(seen.has(r.ticker))d++; seen.add(r.ticker);} console.log('duplicate ticker within survival list:', d); }
// excluded counts: does sum of excluded + routed + survival == universe-ish? (sanity)
const exclTotal = Object.values(ranked.excluded).reduce((p,c)=>p+c,0);
const survAll = results.filter(e=>e.action==='survival').length;
const routedAll = results.filter(e=>e.action==='route'&&e.score!==null).length;
console.log('results breakdown: total=', results.length, 'routed+scored=', routedAll, 'survival=', survAll, 'excluded(sum counts)=', exclTotal);
console.log('sum =', routedAll+survAll+exclTotal, 'vs results.length', results.length, '(diff = route-but-score-null leftovers?)');
const routeNullScore = results.filter(e=>e.action==='route'&&e.score===null).length;
console.log('route action but score===null (NOT in any pot, silently dropped):', routeNullScore);
