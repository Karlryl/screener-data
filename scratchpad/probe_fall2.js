// Probe Fall 2: kandidaten-YoY-De-Fire-Leg an VCEL/SNDK/Samsung verifizieren.
const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { loadUniverse } = require(REPO + '/src/scoring/run-screener.js');
const { norm } = require(REPO + '/src/scoring/snapshot.js');
const lamps = require(REPO + '/src/scoring/lamps.js');
const u = loadUniverse();
const byT = {}; for (const s of u) byT[s.meta.ticker] = s;
const _median = (a) => { const x = [...a].sort((p, q) => p - q); const n = x.length; return n ? (n % 2 ? x[(n - 1) / 2] : (x[n / 2 - 1] + x[n / 2]) / 2) : null; };

function analyze(t) {
  const s = byT[t];
  if (!s) { console.log(t, 'FEHLT'); return; }
  const rev = norm(s, 'revenueQ'), oi = norm(s, 'opIncQ'), gp = norm(s, 'grossProfitQ');
  if (rev.length < 5) { console.log(t, 'rev.length<5'); return; }
  const r0 = rev[0], oi0 = oi[0], r4 = rev[4], oi4 = oi[4];
  const q0opm = oi0 / r0;
  const trailOpm = [];
  for (let i = 1; i <= 4 && i < rev.length; i++) { if (rev[i] > 0 && Number.isFinite(oi[i])) trailOpm.push(oi[i] / rev[i]); }
  const trailMed = _median(trailOpm);
  const q4opm = (r4 > 0 && Number.isFinite(oi4)) ? oi4 / r4 : null;
  const yoyDiff = q4opm === null ? null : Math.abs(q0opm - q4opm);
  const wouldDeFire = yoyDiff !== null && yoyDiff <= 0.20;
  // aktueller Lampen-Status (lib evaluateLamps):
  const active = lamps.evaluateLamps(s).active;
  const firesNow = active.includes('newestQtrSuspect');
  console.log(t.padEnd(11),
    'q0opm=' + (q0opm * 100).toFixed(1) + '%',
    'q4opm=' + (q4opm === null ? 'n/a' : (q4opm * 100).toFixed(1) + '%'),
    'trailMed=' + (trailMed === null ? 'n/a' : (trailMed * 100).toFixed(1) + '%'),
    '|q0-q4|=' + (yoyDiff === null ? 'n/a' : yoyDiff.toFixed(3)),
    'firesNow=' + firesNow,
    '=> YoY-deFire=' + wouldDeFire,
    '=> NACH-Fix-feuert=' + (firesNow && !wouldDeFire));
}
console.log('=== VCEL muss de-firen (FP); SNDK + Samsung muessen feuern ===');
for (const t of ['VCEL', 'SNDK', '005930.KS']) analyze(t);

// Gesamt: welche Namen feuern aktuell? Wie viele wuerde die Leg de-firen?
console.log('\n=== universe-weit: aktuelle newestQtrSuspect-Feurer + welche de-firen ===');
const firers = [];
for (const s of u) {
  if (lamps.evaluateLamps(s).active.includes('newestQtrSuspect')) {
    const rev = norm(s, 'revenueQ'), oi = norm(s, 'opIncQ');
    const r0 = rev[0], oi0 = oi[0], r4 = rev[4], oi4 = oi[4];
    const q0opm = oi0 / r0;
    const q4opm = (r4 > 0 && Number.isFinite(oi4)) ? oi4 / r4 : null;
    const deFire = q4opm !== null && Math.abs(q0opm - q4opm) <= 0.20;
    firers.push({ t: s.meta.ticker, deFire });
  }
}
console.log('Feurer aktuell:', firers.length);
console.log('davon de-fired (saisonal):', firers.filter((f) => f.deFire).map((f) => f.t).join(', '));
console.log('bleiben feuernd:', firers.filter((f) => !f.deFire).map((f) => f.t).join(', '));
