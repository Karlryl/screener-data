#!/usr/bin/env node
/**
 * court-score.js — Schritt 2 von 2: das court-gehärtete Skelett, cross-sectional je Bucket.
 *
 * Liest:
 *   outputs/court-candidates.json   (Achsen-Rohwerte aller Kandidaten, aus court-screen.js)
 *   outputs/court-buckets.json      ({classifications:[{t,bucket,confidence}]} aus dem Klassifikations-Workflow)
 * Rechnet je Formel-Bucket:
 *   Membership-Gate (logistisch) · Stage-Buckets (FCF-Marge) · pseudo-z=(x−Median)/MAD ·
 *   tanh-Sättigung · additive Gewichte · gedeckelte Penalties · Floor-0 · Kollaps-Detektor (Spearman).
 * Schreibt outputs/court-results.json und druckt Top-X je Stage.
 *
 * WICHTIG: Konstanten sind [TODO-CAL] (ungekalibriert) -> verified-DESIGN, nicht verified-Instance.
 * SaaS v1.1 (2026-06-16, Court PASS): A2-Forward-Book-Demand-Achse AKTIV (degraded=false), 5-Achs-Vektor
 *       {A1 .429, A2 .35, A3gm .0715, A3opm .0715, A4 .078}. A2 = additiver RPO-Growth+Level-Blend mit
 *       continuous Base-Credibility-Gates. Details: a2Note (FORMULAS) + Spec v1.1. (v1.0 lief degradiert.)
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const CAND = process.env.COURT_CAND_OUT || path.join(ROOT, 'outputs', 'court-candidates.json');
const BUCK = process.env.COURT_BUCK || path.join(ROOT, 'outputs', 'court-buckets.json'); // audit F-A-2026-06-21: env-Override (mirror COURT_CAND_OUT/COURT_OUT) → Test-Harness erzeugt deterministische Buckets im isolierten Temp-Dir; ohne ihn lehnte der Gate auf einem undeklarierten, von keinem Skript erzeugten Shared-Artefakt
const OUT = process.env.COURT_OUT || path.join(ROOT, 'outputs', 'court-results.json'); // env-Override → Test/Verify-Harness schreibt isoliert (Re-Court-Auflage: keine geteilten Outputs racen)

const median = xs => { const s = xs.filter(v => v != null && isFinite(v)).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mad = xs => { const md = median(xs); if (md == null) return null; const d = median(xs.map(v => Math.abs(v - md))); return d; };
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const logistic = (x, c, s) => 1 / (1 + Math.exp(-(x - c) / s));
const log10 = x => Math.log(x) / Math.LN10;

// pseudo-z mit robustem Median/MAD; mad==0 -> z=0
function sAxis(raw, med, m, k) {
  if (raw == null || med == null || m == null || m === 0) return 0; // neutral
  const z = (raw - med) / m;
  return Math.tanh(z / k); // [-1,1]
}

// Spearman-Rangkorrelation (für Kollaps-Detektor) — TIE-AVERAGED Ränge (order-stabil; Re-Court-Auflage:
// ohne Mittel-Rang war rhoDom reihenfolge-abhängig 0.68–0.86 bei durS-Ties MXL=AMBA=-1).
function spearman(a, b) {
  const n = a.length; if (n < 3) return null;
  const rank = arr => {
    const idx = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const r = Array(arr.length);
    let i = 0;
    while (i < idx.length) {
      let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1; // Mittel der Ränge (i+1 … j+1) für gleiche Werte
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b);
  const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = ra[i] - ma, y = rb[i] - mb; num += x * y; da += x * x; db += y * y; }
  return (da && db) ? num / Math.sqrt(da * db) : null;
}

// --- Formel-Konfigurationen (alle Konstanten [TODO-CAL]) ---
const FORMULAS = {
  fabless_semi: {
    label: 'Fabless-AI-Connectivity-Semis v5.1',
    membership: { g: { c: 0.25, s: 0.05 }, gm: { c: 0.50, s: 0.05 }, scaleLog: { c: log10(50), s: 0.40 } },
    axes: [
      { key: 'growth', name: 'Growth', k: 2.5, w: 0.35 },
      { key: 'gm', name: 'GM', k: 1.0, w: 0.25 },
      { key: 'durability', name: 'Durability', k: 1.0, w: 0.25 },
      { key: 'accel', name: 'Accel', k: 2.0, w: 0.15 },
    ],
    dilCap: 8, dilStart: 0.05, dilRange: 0.20,
    stages: [
      { name: 'Profitabel', test: f => f > 0.05 },
      { name: 'Inflection', test: f => f >= -0.05 && f <= 0.05 },
      { name: 'Pre-profit', test: () => true },
    ],
    dominantBlock: ['gm', 'durability'],
    degraded: false,
  },
  system_app_software: {
    label: 'System-&-Application-SaaS v1.1 (A2 forward-book-demand axis live)',
    membership: { g: { c: 0.28, s: 0.07 }, gm: { c: 0.55, s: 0.10 }, scaleLog: { c: 2.0, s: 0.45 } },
    // v1.1 5-axis (A2 forward-book activated). Weights = degraded {A1 .66, A3gm .11, A3opm .11, A4 .12} * (1-0.35), A2=0.35. Sum=1. All [TODO-CAL].
    axes: [
      { key: 'growth', name: 'A1-Growth', k: 2.6, w: 0.4290 },
      { key: 'a2Forward', name: 'A2-Forward', k: 2.5, w: 0.3500 },
      { key: 'gm', name: 'A3-GM', k: 1.6, w: 0.0715 },
      { key: 'opMargin', name: 'A3-OpMargin', k: 1.6, w: 0.0715 },
      { key: 'roicMinusWacc', name: 'A4-ROIC-WACC', k: 1.8, w: 0.0780 },
    ],
    dilCap: 12, dilStart: 0.05, dilRange: 0.10,
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv', test: f => f >= 0.08 },
      { name: 'S1-Approaching', test: f => f >= -0.05 },
      { name: 'S0-Land-Grab', test: f => f >= -0.25 },
      { name: 'below-line', test: () => true },
    ],
    dominantBlock: ['gm', 'opMargin'],
    degraded: false,
    a2Note: 'A2 = additive forward-book-DEMAND axis (0.65*credibility(rpoPrior)*s(rpoGrowthYoY) + 0.35*credibility(rpoLatest)*s(rpoToRev)). It rewards a building forward book and refuses to reward a flat one; it BREAKS the flat-book anchor-inversion (GEN: 21% M&A flow + 1.3% RPO growth -> #2 -> #7). It is NOT a standalone organic-vs-inorganic detector: a roll-up whose acquired deferred-revenue book inflates reported RPO (e.g. BRZE) reads as forward demand here; the M&A-flow control remains the SEPARATE inorganicFlag lamp. Continuous base-credibility gates (B0=$50M,B1=$300M) neutralise small-base artefacts (WAY/SDGR) and never punish a small/absent book. CAVEATS [TODO-CAL + disclosed]: GEN ranks below FIG/DUOL/HNGE robustly across wA2 in [0.33,0.50] & GW>=0.57; GEN ranks below DDOG (the weakest cohort member) for wA2>=~0.34 & GW>=~0.61, and is co-ranked with DDOG (within ~0.1-1.2pt) at the wA2<=0.34 / low-GW (0.57-0.64) corner — the ship point GW=0.65,wA2=0.35 sits safely inside the holding region (grid-verified 204/216 cells in wA2[0.33,0.50]xGW[0.57,0.68]; 12 edge-corner co-ranks: 8 at wA2=0.33, 4 at wA2=0.34). below-median RPO-growth yields negative sA2 (cross-sectional relative read, not absolute); names with null rpoPrior (CWAN) escape the growth test (neutral, lamp-only); RPO-concept-heterogeneity — 8/44 substitute DeferredRevenue/ContractWithCustomerLiability for true RemainingPerformanceObligation (understate forward book vs true-RPO reporters; the level-anchor mixes concepts; empirically contained at ship — proxy names land near-neutral — but the load-bearing assumption most likely to break under recalibration/universe-expansion). verified-DESIGN not -instance; forward-fitness calendar-gated ~2026-07-14.',
  },
};

const WACC = 0.09; // [TODO-CAL] grober Proxy für A4

// --- Skeptiker-Welle-2-Befunde, deterministisch eingebaut ---
const KILL = new Set(['PS', 'RDVT', 'ADEA', 'OMDA', 'TEM', 'KMTS']); // verifiziert: Ticker-Mismatch / falscher Sektor / Daten-Fehler
// audit F-A-2026-06-21: removed hardcoded INORGANIC_FALLBACK set (GEN/AVGO) — name-level overrides reintroduce
// exactly the hardcoded exclusions inorganicFlag() was built to replace. GEN is already covered by the
// data-driven rule; AVGO (and any other snapshot-missing high-growth fabless name) is now caught structurally
// below via a coverage-absence lamp keyed on missing M&A/RPO data, not on the ticker. Self-maintains as the
// snapshot universe grows.
const FABLESS_GROWTH_FLOOR = 0.25;                                   // headline growth above which missing M&A/RPO coverage is worth flagging (mirrors fabless_semi membership g.c)
const MEGACAP_REVM = 15000;                                          // > $15B Umsatz = Mega-Cap (Fabless: vom Small-Cap-Kern trennen)

// --- A2 forward-book-demand axis (v1.1) — additive, composite; constants [TODO-CAL] ---
const A2_B0 = 50e6, A2_B1 = 300e6, A2_GW = 0.65; // base-credibility floor/ceiling (USD); growth-vs-level tilt
// continuous base-credibility: <=B0 -> 0 (no credit), >=B1 -> 1, smooth log10 ramp between. No cliff, no per-name boundary.
const cred = b => (b == null || b <= A2_B0) ? 0 : (b >= A2_B1 ? 1 : log10(b / A2_B0) / log10(A2_B1 / A2_B0));
// blended sA2 in [-1,1]: un-normalised neutral-shrink — an uncredible/absent book pulls toward 0 (neutral), NEVER a penalty. Cannot zero a name (enters core as w*(s+1)/2 >= 0).
function computeA2Forward(rec, sA2stats) {
  if (!rec) return 0;                                               // no snapshot coverage -> neutral
  const sGrowth = rec.rpoGrowthYoY == null ? null : sAxis(rec.rpoGrowthYoY, sA2stats.gMed, sA2stats.gMad, 2.5);
  const sLevel  = rec.rpoToRev     == null ? null : sAxis(rec.rpoToRev,     sA2stats.lMed, sA2stats.lMad, 2.5);
  const g = (sGrowth != null) ? cred(rec.rpoPrior)  * A2_GW       * sGrowth : 0; // rpoPrior credibility kills small-base growth artefacts (WAY/SDGR)
  const l = (sLevel  != null) ? cred(rec.rpoLatest) * (1 - A2_GW) * sLevel  : 0; // rpoLatest credibility avoids punishing tiny/absent books (ZETA/TTAN)
  return g + l;
}

// --- Laden ---
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const candDoc = readJson(CAND);
const byTicker = new Map(candDoc.candidates.map(c => [c.ticker, c]));
// audit F-A-2026-06-21: fail loudly with a named error instead of a raw ENOENT — court-buckets.json
// has no producer script in the repo, so a missing file must point the operator at the classification workflow.
let buckDoc;
try {
  buckDoc = readJson(BUCK);
} catch (e) {
  if (e && e.code === 'ENOENT') {
    throw new Error(`court-buckets.json missing — run classification workflow first (expected at ${BUCK}; set COURT_BUCK to override)`);
  }
  throw e;
}
const cls = Array.isArray(buckDoc) ? buckDoc : (buckDoc.classifications || []);
const bucketOf = new Map(cls.map(c => [c.t, c.bucket]));
const confOf = new Map(cls.map(c => [c.t, c.confidence]));
// M&A/RPO snapshot (data-driven inorganic detection; 44 SaaS names; 400-day-freshness->NULL baked in)
const maRpoByTicker = new Map(readJson(path.join(ROOT, 'data', 'ma-rpo-snapshot.json')).map(r => [r.ticker, r]));

// Data-driven inorganic-growth flag (replaces the hardcoded INORGANIC set). Deterministic (no Date/random).
// 'inorganic' = recent M&A FLOW >=15% of rev AND forward book flat (rpoGrowthYoY < 15%) -> growth is bought, not built.
// 'ambiguous' = high flow but RPO unknown. 'clean' = organic (low flow, or high flow WITH a building book). null = no snapshot coverage -> hardcoded fallback.
// Signal verified Iter 5: GEN pay 20.6% + rpoGrowth 1.3% (inorganic) vs DDOG pay 3.4% + rpoGrowth 43.6% (organic). Recent FLOW (not goodwill-stock) avoids the Iter-3 decade-old-goodwill false positives.
function inorganicFlag(t) {
  const r = maRpoByTicker.get(t);
  if (!r) return null;
  const pay = r.paymentsToRev, dgw = r.deltaGoodwillPctRev;
  const flowHi = (pay != null && pay >= 0.15) || (dgw != null && dgw >= 0.15); // 15% floor clears CDNS/CRWD ~8% tuck-ins
  if (!flowHi) return 'clean';
  if (r.rpoGrowthYoY == null) return 'ambiguous';
  return (r.rpoGrowthYoY < 0.15) ? 'inorganic' : 'clean';
}

function stageOf(formula, fcf) {
  if (fcf == null) return 'unknown';
  for (const s of formula.stages) if (s.test(fcf)) return s.name;
  return 'unknown';
}

const results = {};
for (const [bucket, F] of Object.entries(FORMULAS)) {
  // Mitglieder + abgeleitete Felder; Winsorize krasse Datenfehler (für robuste Stats)
  const seen = new Map(); // audit F-A-2026-06-21: Map (not Set) so the kept record is reachable to log dropped duplicates
  const members = [];
  for (const [t, b] of bucketOf) {
    if (b !== bucket) continue;
    if (KILL.has(t)) continue;                       // skeptiker-verifizierte Entfernung
    const c = byTicker.get(t);
    if (!c) continue;
    if (c.gm != null && c.gm > 1.0) continue;        // GM>100% = unmöglich (Daten-Fehler) -> hard reject
    // dedupe identische Foreign-OTC-Doppellistings (gleiche gm+rev)
    // audit F-A-2026-06-21: fp collision on (gm,revM) silently drops a distinct issuer — gm is rounded to
    // 4 decimals and scaleRevM to integer $M, so two genuinely different companies can share that key. Match
    // on MORE fields (gm AND revM AND growth AND fcfMargin) so only true co-listings collide, and emit an
    // auditable 'deduped-duplicate-listing' lamp on the kept record so any dropped name is traceable.
    const fp = `${c.gm}|${c.scaleRevM}|${c.growth}|${c.fcfMargin}`;
    if (seen.has(fp)) { const k = seen.get(fp); if (k) (k._dupDropped = k._dupDropped || []).push(t); continue; }
    const m = { ...c, conf: confOf.get(t) };
    m.roicMinusWacc = (c.roicProxy != null) ? c.roicProxy - WACC : null;
    m.opMargin = c.opMargin;
    // Winsorize für Statistik (nicht für Anzeige): kaputte accel/growth begrenzen
    m._growth = c.growth == null ? null : clip(c.growth, -0.9, 5);
    m._accel = c.accel == null ? null : clip(c.accel, -5, 5);
    seen.set(fp, m); // audit F-A-2026-06-21: register the kept record so any later collision attaches its dropped ticker here
    members.push(m);
  }
  // Roh-Achswerte für Stats: nutze winsorisierte für growth/accel
  const rawOf = (m, key) => key === 'growth' ? m._growth : key === 'accel' ? m._accel : m[key];

  // Cross-sectional Anker (Median) + MAD je Achse über das Bucket-Universum
  const stats = {};
  for (const ax of F.axes) {
    if (ax.key === 'a2Forward') continue; // composite axis -> anchors computed separately (statsA2)
    const vals = members.map(m => rawOf(m, ax.key)).filter(v => v != null && isFinite(v));
    stats[ax.key] = { median: median(vals), mad: mad(vals), n: vals.length };
  }
  // A2 forward-book cross-sectional anchors (only when the bucket has the a2Forward axis)
  const statsA2 = F.axes.some(a => a.key === 'a2Forward') ? (() => {
    const gv = members.map(m => { const r = maRpoByTicker.get(m.ticker); return r ? r.rpoGrowthYoY : null; }).filter(v => v != null && isFinite(v));
    const lv = members.map(m => { const r = maRpoByTicker.get(m.ticker); return r ? r.rpoToRev : null; }).filter(v => v != null && isFinite(v));
    return { gMed: median(gv), gMad: mad(gv), lMed: median(lv), lMad: mad(lv), gn: gv.length, ln: lv.length };
  })() : null;

  // Score je Mitglied
  for (const m of members) {
    // Membership-Gate
    const mg = logistic(m.growth, F.membership.g.c, F.membership.g.s);
    const mGM = logistic(m.gm, F.membership.gm.c, F.membership.gm.s);
    const mSc = logistic(log10(Math.max(m.scaleRevM, 1)), F.membership.scaleLog.c, F.membership.scaleLog.s);
    const M = mg * mGM * mSc;
    m.membership = Math.round(M * 100) / 100;
    m.membershipClass = M >= 0.66 ? 'In' : M >= 0.20 ? 'Borderline' : 'Out';

    // Achsen
    m._a2 = statsA2 ? computeA2Forward(maRpoByTicker.get(m.ticker), statsA2) : null;
    let core = 0; m.axisS = {};
    for (const ax of F.axes) {
      const s = ax.key === 'a2Forward'
        ? (m._a2 == null ? 0 : m._a2)                                  // composite forward-book axis (already a blended s in [-1,1])
        : sAxis(rawOf(m, ax.key), stats[ax.key].median, stats[ax.key].mad, ax.k);
      m.axisS[ax.name] = Math.round(s * 100) / 100;
      core += ax.w * (s + 1) / 2;
    }
    // Penalties
    const pDil = clip(((m.sbcPct == null ? 0 : m.sbcPct) - F.dilStart) / F.dilRange, 0, 1) * F.dilCap;
    const pAuth = 0; // keine M&A-Daten lokal
    m.pDil = Math.round(pDil * 10) / 10;
    m.score = Math.max(0, 100 * core - pDil - pAuth);
    m.score = Math.round(m.score * 10) / 10;
    m.stage = stageOf(F, m.fcfMargin);

    // Lampen
    const L = [];
    if (m._dupDropped && m._dupDropped.length) L.push(`deduped-duplicate-listing(${m._dupDropped.join(',')})`); // audit F-A-2026-06-21: makes silently-dropped fp-collision names auditable
    if (m.sbcPct != null && m.sbcPct > 0.50) L.push('IPO-SBC-distortion');
    else if (m.sbcPct != null && m.sbcPct > 0.15) L.push('SBC>15%');
    if (m.scaleRevM > MEGACAP_REVM) L.push('mega-cap');
    const _ioFlag = inorganicFlag(m.ticker);
    const _ioRec = maRpoByTicker.get(m.ticker);
    if (_ioFlag === 'inorganic') L.push(`M&A-inorganic-flow(pay${pct(_ioRec.paymentsToRev).trim()},dGW${pct(_ioRec.deltaGoodwillPctRev).trim()},rpoG${pct(_ioRec.rpoGrowthYoY).trim()})`);
    else if (_ioFlag === 'ambiguous') L.push('M&A-flow-high(book-NULL,ambiguous)');
    // audit F-A-2026-06-21: structural replacement for the hardcoded GEN/AVGO fallback — a high-growth
    // fabless_semi member with NO M&A/RPO snapshot row (coverage absence) gets a generic coverage-missing
    // lamp keyed on the data gap, not on the ticker. Prevents the hardcoded-ticker exclusion failure mode and
    // self-maintains: any future snapshot-missing high-growth name is flagged automatically.
    else if (_ioFlag === null && bucket === 'fabless_semi' && m.growth != null && m.growth >= FABLESS_GROWTH_FLOOR) L.push('M&A-coverage-missing(P_auth-blind)');
    if (m.flags && m.flags.includes('thin-durability')) L.push('thin-durability');           // Durability aus <4 YoY (annual Fallback) — ersetzt irreführende 8q-approx-Lampe (v3 nutzt SEC-Quartals-YoY)
    if (m.durSource === 'sec-quarterly' && m.durWinN != null && m.durWinN < 12) L.push('short-durability-window'); // 4<=winN<12: NICHT 12Q-vergleichbar (ALAB 7Q, ARM 8Q) — Re-Court-Disclosure
    if (m.durability != null && Math.abs(m.durability) > 2) L.push('near-zero-median-amplified'); // |med|+floor bläht durRaw auf wenn median≈0 (z.B. MXL -3.65); tanh sättigt -> Rang ok, Rohwert-Artefakt offengelegt
    if (m.flags && m.flags.includes('short-annual-history')) L.push('short-hist');
    L.push('P_auth=no-data');
    if (F.degraded) L.push('A2-missing-degraded');
    if (m.conf === 'low') L.push('class-low-conf');
    m.lamps = L;
    if (_ioFlag === 'inorganic') {
      m.degradedRankBias = `upward — A1 headline growth is M&A-flow-heavy (recent acquisition cash ${pct(_ioRec.paymentsToRev).trim()} of rev, goodwill +${pct(_ioRec.deltaGoodwillPctRev).trim()}) while forward book is flat (rpoGrowth ${pct(_ioRec.rpoGrowthYoY).trim()}); degraded-mode rank over-states growth quality pending an A2/organic-growth axis.`;
    }
  }

  // Kollaps-Detektor + Durability-Dominanz-Guard (Spec §5 L88: harte Re-Gewichtung bei Kollaps, nicht nur Lampe).
  // Veröffentlicht BEIDE Maße jeden Lauf (Re-Court-Auflage „decompose WHICH block collapses"):
  //   collapseSpearman = Spearman(Score, GM+Durability-Block);  rhoDomAxisDurability = Spearman(Score, Durability allein).
  // spearman() ist tie-averaged → order-stabil. Backstop feuert rhoDom > T=0.90 → deterministischer ≤50%-Haircut.
  const ranked = members.filter(m => m.score != null);
  let collapse = null, rhoDomAxis = null, collapseReweight = null;
  if (ranked.length >= 3) {
    const total = ranked.map(m => m.score);
    const block = ranked.map(m => F.dominantBlock.reduce((s, key) => {
      const ax = F.axes.find(a => a.key === key); return s + (ax ? (m.axisS[ax.name] || 0) : 0);
    }, 0));
    collapse = spearman(total, block);
    const durAx = F.axes.find(a => a.key === 'durability');
    if (durAx) {
      rhoDomAxis = spearman(total, ranked.map(m => m.axisS[durAx.name] || 0));
      const T = 0.90;
      if (rhoDomAxis != null && rhoDomAxis > T) {
        const hf = clip((rhoDomAxis - T) / (1 - T), 0, 1) * 0.5; // ≤50% Haircut
        const wDur = durAx.w * (1 - hf), freed = durAx.w - wDur;
        const otherWsum = F.axes.filter(a => a.key !== 'durability').reduce((s, a) => s + a.w, 0);
        for (const m of ranked) {
          let core = 0;
          for (const a of F.axes) {
            const w = a.key === 'durability' ? wDur : a.w + freed * (a.w / otherWsum);
            core += w * ((m.axisS[a.name] || 0) + 1) / 2;
          }
          m.score = Math.round(Math.max(0, 100 * core - (m.pDil || 0)) * 10) / 10; // pAuth=0
          m.lamps.push('collapse-reweight-applied');
        }
        collapseReweight = { axis: 'durability', rhoDomAxis: Math.round(rhoDomAxis * 100) / 100, threshold: T, haircutFrac: Math.round(hf * 1000) / 1000, wDurBefore: durAx.w, wDurAfter: Math.round(wDur * 1000) / 1000, note: 'pro-rata redistribution slightly re-couples score to growth/gm/accel when active' };
      }
    }
  }

  members.sort((a, b) => b.score - a.score);
  results[bucket] = {
    label: F.label, degraded: F.degraded, degradedNote: F.degradedNote || null, a2Note: F.a2Note || null,
    universeSize: members.length,
    anchors: stats, anchorsA2: statsA2,
    collapseSpearman: collapse == null ? null : Math.round(collapse * 100) / 100,
    rhoDomAxisDurability: rhoDomAxis == null ? null : Math.round(rhoDomAxis * 100) / 100,
    collapseReweight,
    members,
  };
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));

// --- Ausgabe ---
for (const [bucket, R] of Object.entries(results)) {
  console.log('\n' + '='.repeat(90));
  console.log(`### ${R.label}`);
  console.log(`Universum: ${R.universeSize} Namen | Kollaps-Detektor Spearman(Score, Quality-Block) = ${R.collapseSpearman}`);
  if (R.degraded) console.log(`⚠ DEGRADIERT: ${R.degradedNote}`);
  const F = FORMULAS[bucket];
  // MEMBERSHIP-GATE greift jetzt: nur In + Borderline sind rankbare Picks; Out separat gelistet.
  const ranked = R.members.filter(m => m.membershipClass !== 'Out');
  const outClass = R.members.filter(m => m.membershipClass === 'Out').sort((a, b) => b.score - a.score);
  for (const st of F.stages) {
    const inStage = ranked.filter(m => m.stage === st.name);
    if (!inStage.length) continue;
    console.log(`\n  --- Stage: ${st.name} (${inStage.length}, membership-gated) ---`);
    console.log('  TICKER  Score  Memb(cls)   g     gm    fcf   SBC%  Pdil  ' + F.axes.map(a => a.name).join(' ') + '  Lampen');
    for (const m of inStage.slice(0, 10)) {
      const axes = F.axes.map(a => String(m.axisS[a.name]).padStart(5)).join(' ');
      console.log(`  ${m.ticker.padEnd(7)} ${String(m.score).padStart(5)}  ${String(m.membership).padStart(4)}(${m.membershipClass[0]})  ${pct(m.growth)} ${pct(m.gm)} ${pct(m.fcfMargin)} ${pct(m.sbcPct)} ${String(m.pDil).padStart(4)}  ${axes}  ${m.lamps.join(',')}`);
    }
  }
  if (outClass.length) {
    console.log(`\n  --- Out-Klasse (Membership-Gate ausgeschlossen, ${outClass.length}) ---`);
    console.log('  ' + outClass.map(m => `${m.ticker}(${m.membership}, score ${m.score})`).join(' · '));
  }
  console.log(`  [removed pre-score (skeptiker-kill): ${[...KILL].join(', ')}]`);
}
function pct(x) { return (x == null ? '—' : (x * 100).toFixed(0) + '%').padStart(5); }
console.log(`\n-> ${OUT}`);
