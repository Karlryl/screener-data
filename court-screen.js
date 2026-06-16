#!/usr/bin/env node
/**
 * court-screen.js — Schritt 1 von 2 des court-gehärteten Hypergrowth-Screens.
 *
 * Liest alle US-Fundamentals (no-suffix .json) aus fundamentals-cache/, extrahiert
 * die Achsen-Rohwerte der court-Formeln (Fabless v5.1 + SaaS v1.0) und wendet einen
 * WEITEN Membership-Vorfilter an (asset-light + GM-Floor + Scale + Growth), um das
 * Universum von ~3200 auf die plausiblen Hypergrowth-Kandidaten zu reduzieren.
 *
 * WICHTIG: Profitabilität ist NIE ein Gate (Spec §3). Pre-profit-Namen bleiben drin.
 * Ausgabe: outputs/court-candidates.json  (Rohwerte, noch NICHT cross-sectional gescort).
 * Das eigentliche pseudo-z/MAD/tanh-Scoring passiert in Schritt 2 (court-score.js),
 * NACH der Sub-Industry-Klassifikation, weil z/MAD bucket-relativ ist.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CACHE = path.join(ROOT, 'fundamentals-cache');
const OUT = path.join(ROOT, 'outputs', 'court-candidates.json');

// --- robuste Feld-Helfer (Format ist gemischt: ftsAnnual.* = [{value}], Rest = [num]) ---
function num(x) {
  if (x == null) return null;
  if (typeof x === 'number') return isFinite(x) ? x : null;
  if (typeof x === 'object' && 'value' in x) return num(x.value);
  const n = Number(x);
  return isFinite(n) ? n : null;
}
function arr(a) {
  if (!Array.isArray(a)) return [];
  return a.map(num).filter(v => v != null);
}
function median(xs) {
  const s = xs.filter(v => v != null && isFinite(v)).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mad(xs) {
  const med = median(xs);
  if (med == null) return null;
  return median(xs.map(v => Math.abs(v - med)));
}
// YoY-Reihe aus einer "neuestes-zuerst"-Jahresreihe: rev[i]/rev[i+1]-1
function yoySeries(series) {
  const out = [];
  for (let i = 0; i < series.length - 1; i++) {
    const a = series[i], b = series[i + 1];
    if (a != null && b != null && b > 0) out.push(a / b - 1);
  }
  return out;
}

// --- WEITER Vorfilter (nur um das Universum zu schneiden; bewusst großzügig) ---
const F = {
  minRevM: 50,        // Scale-Floor $50M (Spec Membership-Anker)
  maxPpeAssets: 0.20, // asset-light (Spec hart ≤0.15; +Puffer, damit Klassifizierer entscheidet)
  minGM: 0.30,        // weit (SaaS AI-native ~25%; die meisten Ziele >45%)
  minGrowth: 0.12,    // Hypergrowth-Vorfilter (weit; finales Gate ist weich in Schritt 2)
};

const files = fs.readdirSync(CACHE).filter(f => f.endsWith('.json') && !/\./.test(f.replace(/\.json$/, '')));

const candidates = [];
const stats = { total: files.length, parsed: 0, partial: 0, noBalance: 0, noRev: 0, passed: 0 };

for (const file of files) {
  const ticker = file.replace(/\.json$/, '');
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(CACHE, file), 'utf8')); }
  catch { continue; }
  stats.parsed++;
  const p = j.payload;
  if (!p) continue;
  if (j._ftsPartial) stats.partial++;

  const revA = arr(p.ftsAnnual && p.ftsAnnual.annualRev);
  const gpA = arr(p.ftsAnnual && p.ftsAnnual.annualGP);
  const fcfA = arr(p.ftsAnnual && p.ftsAnnual.annualFCF);
  const opA = arr(p.ftsAnnual && p.ftsAnnual.annualOpInc);
  const niA = arr(p.ftsAnnual && p.ftsAnnual.annualNetIncome);
  const ocfA = arr(p.ftsAnnual && p.ftsAnnual.annualOCF);
  const revQ = arr(p.ftsQuarterly && p.ftsQuarterly.revenueQ);
  const gpQ = arr(p.ftsQuarterly && p.ftsQuarterly.grossProfitQ);
  const sbc = arr(p.ftsAnnualSBC);
  const capex = arr(p.ftsAnnualCapex);
  const shares = arr(p.ftsAnnualShares);
  const bal = Array.isArray(p.ftsBalance) ? p.ftsBalance : [];
  const bal0 = bal[0] || null;

  if (revA.length < 2 && revQ.length < 5) { stats.noRev++; continue; }
  if (!bal0) { stats.noBalance++; continue; }

  const revLatest = revA[0] != null ? revA[0] : null;
  if (revLatest == null || revLatest <= 0) { stats.noRev++; continue; }

  // Growth: annual bevorzugt (matcht Spec-Anker), sonst quartals-YoY
  const gAnnual = (revA[0] != null && revA[1] != null && revA[1] > 0) ? revA[0] / revA[1] - 1 : null;
  const gQ = (revQ.length >= 5 && revQ[4] > 0) ? revQ[0] / revQ[4] - 1 : null;
  const growth = gAnnual != null ? gAnnual : gQ;

  // Gross-Margin
  const gm = (gpA[0] != null && revA[0]) ? gpA[0] / revA[0]
    : (gpQ[0] != null && revQ[0]) ? gpQ[0] / revQ[0] : null;

  // Stage: TTM-FCF-Marge (Proxy via annual)
  const fcfMargin = (fcfA[0] != null && revA[0]) ? fcfA[0] / revA[0] : null;
  const opMargin = (opA[0] != null && revA[0]) ? opA[0] / revA[0] : null;
  const niMargin = (niA[0] != null && revA[0]) ? niA[0] / revA[0] : null;

  // Penalty-Inputs
  const sbcPct = (sbc[0] != null && revA[0]) ? sbc[0] / revA[0] : null;
  const netShareGrowth = (shares[0] != null && shares[1] != null && shares[1] > 0) ? shares[0] / shares[1] - 1 : null;

  // Universum-Struktur
  const ppeAssets = (bal0.netPPE != null && bal0.totalAssets) ? bal0.netPPE / bal0.totalAssets : null;
  const scaleRevM = revLatest / 1e6;
  const capexPct = (capex[0] != null && revA[0]) ? capex[0] / revA[0] : null;

  // Durability (Fabless A_dur): Persistenz = Median(g)/MAD(g) über verfügbare Jahre
  const gSeriesA = yoySeries(revA);
  const durMed = median(gSeriesA);
  const durMad = mad(gSeriesA);
  const durability = (durMad != null && durMad > 0) ? durMed / durMad : null;

  // Acceleration (Fabless A_acc): jüngstes YoY - vorheriges YoY
  const accel = (gSeriesA.length >= 2) ? gSeriesA[0] - gSeriesA[1] : null;

  // ROIC-Proxy (SaaS A4): NOPAT/InvestedCapital (WACC fehlt -> in Schritt 2 grob)
  const ic = (bal0.totalDebt != null && bal0.totalEquity != null) ? (bal0.totalDebt + bal0.totalEquity) : null;
  const roicProxy = (opA[0] != null && ic && ic > 0) ? (opA[0] * 0.79) / ic : null;

  const flags = [];
  if (j._ftsPartial) flags.push('fts-partial');
  if (revA.length < 4) flags.push('short-annual-history');
  if (revQ.length < 8) flags.push('insufficient-8q-history');

  // --- Vorfilter (profitabilitäts-frei) ---
  if (growth == null || growth < F.minGrowth) continue;
  if (gm == null || gm < F.minGM) continue;
  if (scaleRevM < F.minRevM) continue;
  if (ppeAssets == null || ppeAssets > F.maxPpeAssets) continue;

  stats.passed++;
  candidates.push({
    ticker,
    growth: round(growth), growth_annual: round(gAnnual), growth_q: round(gQ),
    gm: round(gm), fcfMargin: round(fcfMargin), opMargin: round(opMargin), niMargin: round(niMargin),
    sbcPct: round(sbcPct), netShareGrowth: round(netShareGrowth),
    scaleRevM: Math.round(scaleRevM), ppeAssets: round(ppeAssets), capexPct: round(capexPct),
    durability: round(durability), durMed: round(durMed), durMad: round(durMad), accel: round(accel),
    roicProxy: round(roicProxy),
    nAnnualRev: revA.length, nQRev: revQ.length,
    flags,
  });
}

function round(x) { return (x == null || !isFinite(x)) ? null : Math.round(x * 10000) / 10000; }

candidates.sort((a, b) => (b.growth || 0) - (a.growth || 0));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generatedFromCacheAt: new Date && undefined, filter: F, stats, count: candidates.length, candidates }, null, 2));

console.log('=== court-screen Schritt 1 ===');
console.log(stats);
console.log(`KANDIDATEN nach Vorfilter: ${candidates.length}`);
console.log(`-> ${OUT}`);
console.log('\nTop 30 nach Growth:');
console.log('TICKER   growth    gm     fcfM    sbc%   scale$M  ppe/A   dur    accel   flags');
for (const c of candidates.slice(0, 30)) {
  console.log(
    `${c.ticker.padEnd(7)} ${fmt(c.growth)}  ${fmt(c.gm)}  ${fmt(c.fcfMargin)}  ${fmt(c.sbcPct)}  ${String(c.scaleRevM).padStart(6)}  ${fmt(c.ppeAssets)}  ${(c.durability==null?'—':c.durability.toFixed(1)).padStart(5)}  ${fmt(c.accel)}  ${c.flags.join(',')}`
  );
}
function fmt(x) { return (x == null ? '—' : (x * 100).toFixed(0) + '%').padStart(6); }
