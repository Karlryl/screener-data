'use strict';
// R8 audit: revisionsMomentum-Entfernung (8->7 Achsen). Vergleicht 7-Achsen (HEAD) gegen
// rekonstruiertes 8-Achsen-Scoring (revisionsMomentum wieder eingehaengt mit den alten Gewichten).
const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { loadUniverse } = require(REPO + '/src/scoring/run-screener.js');
const { scoreUniverse } = require(REPO + '/src/scoring/score.js');
const formulas7 = require(REPO + '/src/scoring/formulas/index.js');

// Alte revisionsMomentum-Gewichte (aus dem Diff von 76d34d7863).
const OLD_RM = {
  'consumer-discretionary': { profitable: 0.7, unprofitable: 0.5 },
  'consumer-staples':       { profitable: 0.3, unprofitable: 0.3 },
  energy:                   { profitable: 0.4, unprofitable: 0.5 },
  financials:               { profitable: 1.2, unprofitable: 1 },
  'health-care':            { profitable: 0.5, unprofitable: 0.5 },
  industrials:              { profitable: 0.6, unprofitable: 0.6 },
  'it-services':            { profitable: 1.2, unprofitable: 1.2 },
  materials:                { profitable: 2.4, unprofitable: 2.4 },
  'real-estate':            { profitable: 0.5, unprofitable: 0.5 },
  semiconductors:           { profitable: 0.5, unprofitable: 0.5 },
  'software-comm-services': { profitable: 0.8, unprofitable: 1 },
  utilities:                { profitable: 0.4, unprofitable: 0.5 },
};

// 8-Achsen-Rekonstruktion: revisionsMomentum wieder anhaengen (position egal, weightedScore ist positionsunabhaengig).
const formulas8 = {};
for (const [id, f] of Object.entries(formulas7)) {
  const rm = OLD_RM[id];
  formulas8[id] = { ...f, axes: [...f.axes, { key: 'revisionsMomentum', w: rm }] };
}

const u = loadUniverse();
console.log('Universe size:', u.length);

const r7 = scoreUniverse(u, formulas7);
const r8 = scoreUniverse(u, formulas8);

// --- Sanity: NaN / Range-Check auf 7-Achsen -----------------
let nan7 = 0, outOfRange7 = 0;
const actionCount7 = {};
for (const e of r7) {
  actionCount7[e.action] = (actionCount7[e.action] || 0) + 1;
  if (e.action === 'route') {
    if (e.score === null || !Number.isFinite(e.score)) nan7++;
    else if (e.score < 0 || e.score > 100) outOfRange7++;
  }
}
console.log('\n=== 7-Achsen Sanity ===');
console.log('actions:', JSON.stringify(actionCount7));
console.log('NaN/null-score route:', nan7, ' out-of-[0,100]:', outOfRange7);

// excluded breakdown
const exReason = {};
for (const e of r7) if (e.action === 'exclude') exReason[e.reason] = (exReason[e.reason]||0)+1;
console.log('exclude reasons:', JSON.stringify(exReason));

// survival count
const survival7 = r7.filter(e => e.action === 'survival').length;
console.log('survival:', survival7);

// score>=90
const ge90 = r7.filter(e => e.action==='route' && e.score>=90).map(e=>e.ticker+':'+e.score.toFixed(2));
console.log('score>=90:', ge90.length, ge90.slice(0,10).join(', '));

// --- Anker ------------------
const anchors = ['CRDO','PLTR','ALAB','BE','2383.TW','2308.TW','WTC.AX'];
console.log('\n=== Anker (7-Achsen) ===');
const m7 = {}; for (const e of r7) m7[e.ticker]=e;
for (const t of anchors) {
  const e = m7[t];
  console.log(t.padEnd(9), e ? (e.action+' '+(e.formulaId||'')+' '+(e.track||'')+' score='+(e.score!==null?e.score.toFixed(2):'null')) : 'MISSING');
}

// --- Per-Sektor Renorm-Check: kein NaN je Kohorte, Score-Range ok --------
console.log('\n=== Per-Sektor (7-Achsen): route-count, min/max/median score ===');
const bySector = {};
for (const e of r7) if (e.action==='route') (bySector[e.formulaId] ||= []).push(e.score);
for (const id of Object.keys(formulas7)) {
  const arr = (bySector[id]||[]).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!arr.length) { console.log(id.padEnd(24),'EMPTY'); continue; }
  const med = arr[Math.floor(arr.length/2)];
  const anyNaN = (bySector[id]||[]).some(s => !Number.isFinite(s));
  console.log(id.padEnd(24), 'n='+String(arr.length).padStart(4),
    'min='+arr[0].toFixed(1), 'max='+arr[arr.length-1].toFixed(1), 'med='+med.toFixed(1),
    anyNaN?'  <<NaN!':'');
}

module.exports = { r7, r8, m7, formulas7, formulas8, u };
