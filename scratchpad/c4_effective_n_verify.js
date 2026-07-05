'use strict';
// Adversariale Verifikation des Befunds: linearer wcov-Shrink heilt das effektive-N-Artefakt
// nicht varianz-korrekt, sondern invertiert es (konservative Über-Stauchung). Reproduktion
// der empirischen Behauptungen: zentrierte BASIS-SD ~flach über wcov-Buckets; FINAL-SD
// skaliert ~linear mit wcov; Cross-Bucket-Spread WÄCHST.
process.env.MS_C4_CAPTURE = '1';
const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { scoreUniverse } = require(path.join(REPO, 'src/scoring/score.js'));
const formulas = require(path.join(REPO, 'src/scoring/formulas/index.js'));
const SNAP_DIR = path.join(REPO, 'snapshots');

const snaps = [];
for (const f of fs.readdirSync(SNAP_DIR)) {
  if (!f.endsWith('.json')) continue;
  if (f.startsWith('_manifest') || f === '_last_good_disk.json') continue;
  try { const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); if (s && s.meta && s.meta.ticker) snaps.push(s); } catch (_) {}
}
console.log('snapshots geladen:', snaps.length);

const results = scoreUniverse(snaps, formulas);
const cap = global.__C4 || [];
console.log('C4-Records erfasst:', cap.length);

// --- per-Bucket-Analyse ---
function sd(arr) { if (arr.length < 2) return null; const m = arr.reduce((a, b) => a + b, 0) / arr.length; return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length); }

// 1. cohMedian je Kohorte (für Zentrierung der FINAL-Scores) bauen
const buckets = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 0.999999], [0.999999, 1.0001]];
const blabel = ['0.0-0.2', '0.2-0.4', '0.4-0.6', '0.6-0.8', '0.8-1.0', 'wcov=1'];
function bidx(w) { for (let i = 0; i < buckets.length; i++) if (w >= buckets[i][0] && w < buckets[i][1]) return i; return null; }

// zentrierte BASIS-SD je Bucket: (base - cohMedian)
const baseCent = blabel.map(() => []);
const finalCent = blabel.map(() => []);
const finalRaw = blabel.map(() => []);
for (const r of cap) {
  const bi = bidx(r.wcov);
  if (bi === null) continue;
  if (Number.isFinite(r.base) && Number.isFinite(r.cohMedian)) baseCent[bi].push(r.base - r.cohMedian);
  if (Number.isFinite(r.final) && Number.isFinite(r.cohMedian)) { finalCent[bi].push(r.final - r.cohMedian); finalRaw[bi].push(r.final); }
}
console.log('\nwcov-Bucket      n     base-SD(zentr)   final-SD(zentr)   meanBase   meanFinal');
const bSDs = [], fSDs = [];
for (let i = 0; i < blabel.length; i++) {
  const bs = sd(baseCent[i]); const fsd = sd(finalCent[i]);
  bSDs.push(bs); fSDs.push(fsd);
  const mB = baseCent[i].length ? (baseCent[i].reduce((a, b) => a + b, 0) / baseCent[i].length) : NaN;
  const mF = finalCent[i].length ? (finalCent[i].reduce((a, b) => a + b, 0) / finalCent[i].length) : NaN;
  console.log(`${blabel[i].padEnd(12)} ${String(baseCent[i].length).padStart(5)}   ${(bs == null ? 'n/a' : bs.toFixed(2)).padStart(12)}   ${(fsd == null ? 'n/a' : fsd.toFixed(2)).padStart(14)}   ${mB.toFixed(2).padStart(8)}   ${mF.toFixed(2).padStart(8)}`);
}
const bsp = bSDs.filter((x) => x != null);
const fsp = fSDs.filter((x) => x != null);
console.log('\nbase-SD Cross-Bucket-Spread (max-min):', (Math.max(...bsp) - Math.min(...bsp)).toFixed(2), '  [', bsp.map((x) => x.toFixed(1)).join(', '), ']');
console.log('final-SD Cross-Bucket-Spread (max-min):', (Math.max(...fsp) - Math.min(...fsp)).toFixed(2), '  [', fsp.map((x) => x.toFixed(1)).join(', '), ']');

// 2. Tail-Belegung: P(final >= 85) je Bucket vs P(base >= 85)
console.log('\nwcov-Bucket    P(base>=85)   P(final>=85)   P(base>=90)  P(final>=90)');
for (let i = 0; i < blabel.length; i++) {
  const recs = cap.filter((r) => bidx(r.wcov) === i);
  if (!recs.length) { console.log(`${blabel[i].padEnd(12)}  (leer)`); continue; }
  const pb85 = recs.filter((r) => r.base >= 85).length / recs.length;
  const pf85 = recs.filter((r) => r.final >= 85).length / recs.length;
  const pb90 = recs.filter((r) => r.base >= 90).length / recs.length;
  const pf90 = recs.filter((r) => r.final >= 90).length / recs.length;
  console.log(`${blabel[i].padEnd(12)}  ${(pb85 * 100).toFixed(1).padStart(8)}%   ${(pf85 * 100).toFixed(1).padStart(8)}%   ${(pb90 * 100).toFixed(1).padStart(8)}%  ${(pf90 * 100).toFixed(1).padStart(8)}%`);
}

// 3. base>=90 Namen: wie viele low-coverage? final?
const base90 = cap.filter((r) => r.base >= 90);
console.log('\nbase>=90 Namen:', base90.length);
console.log('  davon wcov<1 (low-coverage):', base90.filter((r) => r.wcov < 0.999999).length);
console.log('  davon wcov=1 (voll):', base90.filter((r) => r.wcov >= 0.999999).length);
console.log('  final>=90 nach C4:', base90.filter((r) => r.final >= 90).length);

// 4. final>=90 gesamt + welche Coverage
const final90 = cap.filter((r) => r.final >= 90);
console.log('\nfinal>=90 Namen gesamt:', final90.length, final90.map((r) => `${r.ticker}(wcov=${r.wcov.toFixed(2)},base=${r.base.toFixed(1)})`).join(', '));

// 5. Anker-Check
const ANCHORS = ['PLTR', 'CRDO', 'ALAB', 'BE', '2383.TW', '2308.TW', 'WTC.AX'];
console.log('\nAnker:');
for (const a of ANCHORS) {
  const r = cap.find((x) => x.ticker === a);
  if (r) console.log(`  ${a.padEnd(8)} wcov=${r.wcov.toFixed(3)} base=${r.base.toFixed(2)} final=${r.final.toFixed(2)}`);
  else console.log(`  ${a.padEnd(8)} (nicht in cap — evtl. exclude/survival)`);
}
