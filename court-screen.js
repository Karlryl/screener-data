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

// Medtech-Bypass: Industry-Set aus Snapshots aufbauen (keine sector-Info in fundamentals-cache)
// Dieser Set wird NUR für den asset-light-Gate-Bypass genutzt; die eigentliche Bucket-Klassifikation
// bleibt in court-buckets.json (deterministisch, SI-5).
const SNAP_DIR = path.join(ROOT, 'snapshots');
const MEDTECH_INDUSTRIES = new Set(['Medical Devices', 'Medical Instruments & Supplies']);
const medtechTickers = new Set();
const snapMarketCap = new Map(); // ticker -> marketCap.value
const snapRnD = new Map(); // ticker -> annualRnD array
if (fs.existsSync(SNAP_DIR)) {
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!f.endsWith('.json') || /\./.test(f.replace(/\.json$/, ''))) continue;
    try {
      const sn = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8'));
      const t = (sn.meta && sn.meta.ticker) || f.replace(/\.json$/, '');
      if (sn.meta && sn.meta.sector === 'Healthcare' && MEDTECH_INDUSTRIES.has(sn.meta.industry)) {
        medtechTickers.add(t);
      }
      if (sn.marketCap && sn.marketCap.value != null) snapMarketCap.set(t, sn.marketCap.value);
      if (sn.annual && Array.isArray(sn.annual.annualRnD)) snapRnD.set(t, sn.annual.annualRnD.map(v => (v == null ? null : Number(v))).filter(v => v != null && isFinite(v)));
    } catch {}
  }
}

const CACHE = path.join(ROOT, 'fundamentals-cache');
const OUT = process.env.COURT_CAND_OUT || path.join(ROOT, 'outputs', 'court-candidates.json'); // env-Override für isolierten Test/Verify-Lauf (Re-Court-Auflage)

// --- diagnostics_lst (D&LST) Universum-Bypass ---
// ADDITIV (parity-safe): das D&LST-Universum (Diagnostics & Research + Life-Science-Tools, n=29) ist wie
// Medtech NICHT durchgehend asset-light (Tools/Instruments-Namen haben hohe PPE) und enthält Large-Caps
// (TMO/DHR/A) für die cross-sektionalen Perzentil-Anker. Wir nehmen exakt die in court-buckets.json als
// `diagnostics_lst` klassifizierten Ticker vom asset-light/ppe-Gate + den ökonomischen Floors aus (analog
// medtech, Fix A SI-5: keine stillen Drops → classifiedCount===scoredCount in court-score.js). Die Quelle
// ist die DETERMINISTISCHE Klassifikation (court-buckets.json), NICHT eine Industry-Heuristik — so kommt
// genau dieses Set rein und der Nicht-D&LST/Nicht-Medtech-Pfad bleibt BYTE-IDENTISCH (Parität SaaS/Fabless).
const BUCK = path.join(ROOT, 'outputs', 'court-buckets.json');
const dlstTickers = new Set();
try {
  const bd = JSON.parse(fs.readFileSync(BUCK, 'utf8'));
  const cls = Array.isArray(bd) ? bd : (bd.classifications || []);
  for (const c of cls) if (c && c.bucket === 'diagnostics_lst' && c.t) dlstTickers.add(c.t);
} catch {}

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

  // Annual YoY-Reihe (newest-first) — weiterhin Quelle für die Acceleration-Achse.
  const gSeriesA = yoySeries(revA);

  // --- Durability v3 (Fabless A_dur) — Iteration 10 Retrial: age-neutral quarterly persistence ---
  // Quelle: SEC-Quartals-YoY (payload.ftsQuarterly.revQYoYsec, newest-first) bevorzugt; sonst annual YoY Fallback.
  //   durRaw = (median(gW) − λ·downsideDrawdown(gW)) / (|median(gW)| + floor)
  //   gW = letzte W=12 YoY (Window-Cap = Recency-Hauptkontrolle gegen Alt-Zyklen → NVDA-Fix).
  //   downsideDrawdown: recency-gewichtet rho^i (i=0 = neuestes), Gewichte auf Mittel 1 über die Below-Menge
  //   renormiert (= LÄNGEN-NEUTRAL), normiert durch ÷COUNT-below (NICHT ÷n). scale-normalisiert durch (|median|+floor).
  //   WARUM v3: v2 (median/MAD bzw. median−downsideDev über 3 annual YoY) war Court-DENIED — n=3 degenerierte
  //   zu (median,min), dominierte den Score (ρ0.976), war scale-/längen-gekoppelt (Ledger Eintrag 19).
  //   STRIKT alters-neutral: reine Funktion des YoY-Fensters; KEIN dCred/Längen-Term. Konstanten [TODO-CAL].
  const DUR_W = 12, DUR_RHO = 0.9, DUR_LAMBDA = 1.0, DUR_FLOOR = 0.10;
  const revQYoYsec = arr(p.ftsQuarterly && p.ftsQuarterly.revQYoYsec); // SEC-Quartals-YoY, newest-first
  const gYoYDur = (revQYoYsec.length >= 4 ? revQYoYsec : gSeriesA).slice(0, DUR_W);
  const durMed = median(gYoYDur);
  let durDD = null, durCountBelow = 0;
  if (durMed != null) {
    const below = [];
    for (let i = 0; i < gYoYDur.length; i++) if (gYoYDur[i] != null && isFinite(gYoYDur[i]) && gYoYDur[i] < durMed) below.push(i);
    durCountBelow = below.length;
    if (!below.length) durDD = 0;
    else {
      const rawW = below.map(i => Math.pow(DUR_RHO, i));
      const wmean = rawW.reduce((a, v) => a + v, 0) / rawW.length;
      let ss = 0; below.forEach((i, k) => { const w = rawW[k] / wmean; ss += w * (gYoYDur[i] - durMed) ** 2; });
      durDD = Math.sqrt(ss / below.length);
    }
  }
  const durability = (durMed != null && durDD != null) ? (durMed - DUR_LAMBDA * durDD) / (Math.abs(durMed) + DUR_FLOOR) : null;
  const durWinN = gYoYDur.length;
  const durSource = revQYoYsec.length >= 4 ? 'sec-quarterly' : 'annual-fallback';

  // Acceleration (Fabless A_acc): jüngstes YoY - vorheriges YoY
  const accel = (gSeriesA.length >= 2) ? gSeriesA[0] - gSeriesA[1] : null;

  // ROIC-Proxy (SaaS A4): NOPAT/InvestedCapital (WACC fehlt -> in Schritt 2 grob)
  const ic = (bal0.totalDebt != null && bal0.totalEquity != null) ? (bal0.totalDebt + bal0.totalEquity) : null;
  const roicProxy = (opA[0] != null && ic && ic > 0) ? (opA[0] * 0.79) / ic : null;

  const flags = [];
  if (j._ftsPartial) flags.push('fts-partial');
  if (revA.length < 4) flags.push('short-annual-history');
  if (durWinN < 4) flags.push('thin-durability'); // Durability aus <4 YoY (annual Fallback) — nur Warnung, kein Score-Eingriff

  // Medtech-spezifische Achsen (für alle Ticker; null für Nicht-Medtech/fehlende Daten)
  // gmTrend: mean(letzte2 GM) - mean(erste2 GM) [aus annualGP/annualRev, newest-first]
  let gmTrend = null;
  if (gpA.length >= 4 && revA.length >= 4) {
    const gm0 = gpA[0] / revA[0], gm1 = gpA[1] / revA[1];
    const gm2 = gpA[2] / revA[2], gm3 = gpA[3] / revA[3];
    gmTrend = (gm0 + gm1) / 2 - (gm2 + gm3) / 2;
  } else if (gpA.length >= 3 && revA.length >= 3) {
    const gm0 = gpA[0] / revA[0], gm1 = gpA[1] / revA[1], gm2 = gpA[2] / revA[2];
    gmTrend = (gm0 + gm1) / 2 - ((gm1 + gm2) / 2);
  } else if (gpA.length >= 2 && revA.length >= 2) {
    gmTrend = (gpA[0] / revA[0]) - (gpA[1] / revA[1]);
  }
  // opLeverage: incremental ΔOpInc/ΔRev (neuestes Paar)
  let opLeverage = null;
  if (opA.length >= 2 && revA.length >= 2 && revA[0] !== revA[1]) {
    const dRev = revA[0] - revA[1];
    const dOp = opA[0] - opA[1];
    if (dRev !== 0) opLeverage = dOp / dRev;
  }
  // rdProductivity (neutral wenn kein R&D)
  const rdA = arr(p.ftsAnnual && p.ftsAnnual.annualRnD);
  const snapRnDArr = snapRnD.get(ticker) || [];
  const bestRnD = rdA.length > 0 ? rdA : snapRnDArr;
  const rdProductivity = (growth != null && bestRnD.length > 0 && revA[0] && bestRnD[0] > 0)
    ? growth / (bestRnD[0] / revA[0]) : null;
  // marketCap (snapshot bevorzugt für TTM-Aktualität)
  const marketCapVal = snapMarketCap.get(ticker) || null;

  // --- Vorfilter (profitabilitäts-frei) ---
  // v1.2 Fix A (SI-5 UNIVERSE FIX): Medtech ist KAPITALINTENSIV von Natur aus. Der asset-light/
  // ppeAssets-Gate UND die Growth/GM/Scale-Floors haben ~38 von 61 klassifizierten Medtech-Namen
  // STILL gedroppt (inkl. Large-Caps MDT/SYK/ABT/EW/BDX/ZBH). FINAL DECISION: Medtech wird KOMPLETT
  // vom asset-light-Gate ausgenommen und ALLE klassifizierten Medtech-Namen werden ins Universum
  // (cross-sektionale Mediane) + Scoring admittiert — nur milde Daten-Sanity bleibt.
  // Large-Caps kommen rein (für Perzentil-Anker), fallen aber am Growth-Floor (gateOpen) → NICHT auf
  // der Shortlist (korrekt). NICHT-Medtech-Pfad bleibt BYTE-IDENTISCH (Parität SaaS/Fabless).
  const isMedtech = medtechTickers.has(ticker);
  const isDlst = dlstTickers.has(ticker);
  if (isMedtech || isDlst) {
    // Milde Daten-Sanity: growth/gm/rev müssen vorhanden + endlich sein (keine ökonomischen Floors).
    // Medtech UND D&LST sind kapitalintensiv/Large-Cap-haltig → asset-light/ppe-Gate + ökonomische Floors
    // ENTFERNT (Fix A SI-5: kein stiller Drop). Der Growth-Floor wirkt über gateOpen in court-score.js.
    if (growth == null || !isFinite(growth)) continue;
    if (gm == null || !isFinite(gm)) continue;
  } else {
    if (growth == null || growth < F.minGrowth) continue;
    if (gm == null || gm < F.minGM) continue;
    if (scaleRevM < F.minRevM) continue;
    if (ppeAssets == null || ppeAssets > F.maxPpeAssets) continue;
  }

  stats.passed++;
  // v1.2 Fix D: Medtech-only annual revenue YoY series (newest-first) für die DEAL-YEAR-EXCLUSION
  // Growth-Metrik in court-score.js. Additiv/medtech-only → KEIN Feld auf Nicht-Medtech-Records (Parität).
  // Index i = YoY[i] (rev[i]/rev[i+1]-1); aligned mit goodwillHistory[i] (beide newest-first annual).
  const medtechExtra = isMedtech ? { revYoYMedtech: gSeriesA.map(round) } : {};
  // v0 D&LST: annual revenue YoY series (newest-first) für die DEAL-YEAR-EXCLUSION Growth-Metrik in
  // court-score.js. Additiv/dlst-only → KEIN Feld auf Nicht-D&LST-Records (Parität SaaS/Fabless/Medtech).
  // Index i = YoY[i] (rev[i]/rev[i+1]-1); aligned mit goodwillHistory[i] (beide newest-first annual).
  const dlstExtra = isDlst ? { revYoYDlst: gSeriesA.map(round) } : {};
  candidates.push({
    ticker,
    growth: round(growth), growth_annual: round(gAnnual), growth_q: round(gQ),
    gm: round(gm), fcfMargin: round(fcfMargin), opMargin: round(opMargin), niMargin: round(niMargin),
    sbcPct: round(sbcPct), netShareGrowth: round(netShareGrowth),
    scaleRevM: Math.round(scaleRevM), ppeAssets: round(ppeAssets), capexPct: round(capexPct),
    durability: round(durability), durMed: round(durMed), durDD: round(durDD),
    durCountBelow, durWinN, durSource, accel: round(accel),
    roicProxy: round(roicProxy),
    nAnnualRev: revA.length, nQRev: revQ.length,
    flags,
    gmTrend: round(gmTrend), opLeverage: round(opLeverage), rdProductivity: round(rdProductivity),
    marketCap: marketCapVal,
    ...medtechExtra,
    ...dlstExtra,
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
