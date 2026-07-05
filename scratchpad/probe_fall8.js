// Probe Fall 8: leer-annualRev-Namen in survival + ihre Industries.
const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { loadUniverse } = require(REPO + '/src/scoring/run-screener.js');
const { scoreUniverse, produceRankings } = require(REPO + '/src/scoring/score.js');
const { norm } = require(REPO + '/src/scoring/snapshot.js');
const formulas = require(REPO + '/src/scoring/formulas/index.js');
const u = loadUniverse();
const byT = {}; for (const s of u) byT[s.meta.ticker] = s;
const results = scoreUniverse(u, formulas);
const survival = produceRankings(results, { topN: 100 }).survival;

const hasPresent = (a) => Array.isArray(a) && a.some((x) => x && x.value != null && Number.isFinite(x.value));

// Alle survival-Namen, deren annualRev komplett leer/abwesend ist:
const emptyRev = [];
for (const e of survival) {
  const s = byT[e.ticker];
  const rev = norm(s, 'annualRev');
  if (!hasPresent(rev)) emptyRev.push({ t: e.ticker, sec: s.meta.sector, ind: s.meta.industry });
}
console.log('=== survival-Namen mit LEER annualRev:', emptyRev.length, '===');
const byInd = {};
for (const x of emptyRev) byInd[x.ind || '(leer)'] = (byInd[x.ind || '(leer)'] || 0) + 1;
console.log(JSON.stringify(byInd, null, 1));
console.log('--- Detail (sektor | industry | ticker) ---');
emptyRev.sort((a, b) => (a.ind || '').localeCompare(b.ind || ''));
for (const x of emptyRev) console.log((x.sec || '?').padEnd(22), '|', (x.ind || '?').padEnd(34), '|', x.t);

// Test der geplanten Signatur gegen ALLE survival-Namen (auch nicht-leer):
const SIG = /asset management|closed-end fund|closed end fund|shell companies|\bbdc\b|term trust/i;
console.log('\n=== survival-Namen, die die NON_OPERATING-Signatur matchen (egal ob leer-Rev) ===');
for (const e of survival) {
  const s = byT[e.ticker];
  if (SIG.test(s.meta.industry || '')) {
    const rev = norm(s, 'annualRev');
    console.log((s.meta.industry || '?').padEnd(34), '|', e.ticker, '| leerRev=' + (!hasPresent(rev)), '| sec=' + s.meta.sector);
  }
}

// GEGENPROBE: echte Healthcare-Pre-Rev-Biotechs — tragen die JE die Signatur?
console.log('\n=== Healthcare-survival-Namen, die FAELSCHLICH die Signatur matchen wuerden (MUSS 0 sein) ===');
let hcHit = 0;
for (const e of survival) {
  const s = byT[e.ticker];
  if ((s.meta.sector || '').toLowerCase().includes('health') && SIG.test(s.meta.industry || '')) {
    hcHit++; console.log('  TREFFER:', e.ticker, s.meta.industry);
  }
}
console.log('Healthcare-Treffer:', hcHit);
