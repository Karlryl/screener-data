'use strict';
/**
 * QC-core ρ-Screen K2 (CFO/NI-Slope) — Discovery-Instrumentierung, KEIN Score-Effekt.
 * ==============================================================================
 * Erste billige Orthogonalitäts-Stufe für eine QC-core-Kandidatenachse. Misst
 * Spearman-|ρ| zwischen K2 (CFO/NI-Slope) und dem HG-Score über die geteilte
 * route+finite-Menge, pooled UND je Sektor|Track. Präreg (Achse+Gate eingefroren
 * VOR dem Lauf): protocol/qc-rho-k2-registered-20260721.md.
 *
 * HG byte-identisch (liest nur, schreibt nur outputs/quality/_rho-k2.json).
 *   node scripts/qc-rho-k2.js
 */
const fs = require('fs');
const path = require('path');
const { loadUniverse } = require('../src/scoring/run-screener.js');
const { scoreUniverse } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');
const { spearman } = require('./qc-overlap.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'quality', '_rho-k2.json');
const GATE = 0.4;
const MASK_MIN_N = 20;
// Power-Gate (Nachtrag 21.07. nach Erst-Lauf, universeller Check): ein |ρ|<0,4-Verdikt
// braucht eine Mindest-Stichprobe, sonst ist das CI zu breit (bei n=55 ~±0,27, schließt
// 0,4 ein). Analog rank-ic N_eff-Gate. Greift bei JEDEM kleinen n, nicht ergebnis-gewählt.
const POWER_MIN_N = 100;

// K2 = Steigung der linearen Regression von CFO/NI über den FY-Index.
// Nur FY mit NI>0 und finitem OCF; >=2 gültige FY. Reine Slope (GG4, kein Niveau).
function k2Slope(secAnnual) {
  if (!secAnnual) return null;
  const ni = secAnnual.annualNetIncome, ocf = secAnnual.annualOCF;
  if (!Array.isArray(ni) || !Array.isArray(ocf)) return null;
  const pts = [];
  const n = Math.min(ni.length, ocf.length);
  for (let i = 0; i < n; i++) {
    const niv = ni[i] && ni[i].value, ocfv = ocf[i] && ocf[i].value;
    if (Number.isFinite(niv) && niv > 0 && Number.isFinite(ocfv)) pts.push([i, ocfv / niv]);
  }
  if (pts.length < 2) return null;
  const m = pts.length;
  const sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0);
  const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0), sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
  const den = m * sxx - sx * sx;
  return den !== 0 ? (m * sxy - sx * sy) / den : null;
}

function sectorKey(e) {
  const fid = e.formulaId ? String(e.formulaId).replace(/^(hg-|quality-)/, '') : 'na';
  return fid + '|' + (e.track || 'na');
}

function run() {
  const universe = loadUniverse();
  const hg = scoreUniverse(universe, formulas);
  const hgBy = {};
  for (const e of hg) if (e.action === 'route' && Number.isFinite(e.score)) hgBy[e.ticker] = e;

  const k2By = {};
  let k2Eval = 0;
  for (const s of universe) {
    const tk = s && s.meta && s.meta.ticker;
    if (!tk) continue;
    const k2 = k2Slope(s.secAnnual);
    if (Number.isFinite(k2)) { k2By[tk] = k2; k2Eval++; }
  }

  const groups = {}, pooledK = [], pooledH = [];
  for (const tk of Object.keys(k2By)) {
    const h = hgBy[tk];
    if (!h) continue;                 // nur die geteilte Menge
    const key = sectorKey(h);
    (groups[key] ||= { k: [], h: [] });
    groups[key].k.push(k2By[tk]); groups[key].h.push(h.score);
    pooledK.push(k2By[tk]); pooledH.push(h.score);
  }

  const perSector = {};
  for (const [key, g] of Object.entries(groups)) {
    const rho = spearman(g.k, g.h);
    perSector[key] = {
      n: g.k.length,
      rho: rho === null ? null : Math.round(rho * 1000) / 1000,
      absRho: rho === null ? null : Math.round(Math.abs(rho) * 1000) / 1000,
    };
  }
  const pooledRho = spearman(pooledK, pooledH);
  const pooledAbs = pooledRho === null ? null : Math.abs(pooledRho);
  const maskFails = Object.entries(perSector)
    .filter(([, v]) => v.n >= MASK_MIN_N && v.absRho !== null && v.absRho >= GATE)
    .map(([k, v]) => ({ sector: k, n: v.n, absRho: v.absRho }));
  const underpowered = pooledK.length < POWER_MIN_N;
  const passed = pooledAbs !== null && pooledAbs < GATE && maskFails.length === 0;
  const maskUnprovable = !Object.values(perSector).some((v) => v.n >= MASK_MIN_N);
  const absRounded = pooledAbs === null ? null : Math.round(pooledAbs * 1000) / 1000;

  const out = {
    generated_at: new Date().toISOString(),
    axis: 'K2 CFO/NI-Slope',
    praereg: 'protocol/qc-rho-k2-registered-20260721.md',
    gate: `|rho|<${GATE} pooled UND perSector(n>=${MASK_MIN_N}); Power-Gate n>=${POWER_MIN_N}`,
    k2Evaluable: k2Eval,
    pooled: { n: pooledK.length, rho: pooledRho === null ? null : Math.round(pooledRho * 1000) / 1000, absRho: absRounded },
    perSector,
    maskFails,
    maskProvable: !maskUnprovable,
    verdict: underpowered
      ? `UNTERPOWERT: geteilte Menge n=${pooledK.length} < ${POWER_MIN_N} -> kein belastbares Verdikt. SEC-annual-Coverage im Live-Universe ist der Engpass (nur ${k2Eval} K2-auswertbar). perSector-Maskierungsschutz ${maskUnprovable ? 'NICHT pruefbar (kein Sektor n>=' + MASK_MIN_N + ')' : 'geprueft'}. Punktschaetzer pooled |rho|=${absRounded} ist vorlaeufig, CI zu breit.`
      : (passed
        ? 'ORTHOGONAL (|rho|<0.4 pooled + alle besetzten Sektoren) -> DIAGNOSTIC-Achsen-Kandidat (core erst nach rankIC, Monate)'
        : 'NICHT orthogonal (Gate verletzt) -> K2 Muster-Friedhof, weiter zu K3'),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`[qc-rho-k2] K2 auswertbar auf ${k2Eval} Namen; geteilte Menge n=${out.pooled.n}`);
  console.log(`[qc-rho-k2] pooled |rho|=${out.pooled.absRho} -> ${out.verdict}`);
  for (const [k, v] of Object.entries(perSector).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${k.padEnd(32)} n=${String(v.n).padStart(4)}  |rho|=${v.absRho}`);
  }
  return out;
}

if (require.main === module) run();
module.exports = { run, k2Slope };
