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
 * SaaS: A2 (Forward-Book) = 0% Coverage lokal -> Readiness-Gate FEUERT -> coverage-normalisierter
 *       3-Achsen-Vektor {A1 .66, A3 .22, A4 .12}, explizit als DEGRADIERT deklariert.
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const CAND = path.join(ROOT, 'outputs', 'court-candidates.json');
const BUCK = path.join(ROOT, 'outputs', 'court-buckets.json');
const OUT = path.join(ROOT, 'outputs', 'court-results.json');

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

// Spearman-Rangkorrelation (für Kollaps-Detektor)
function spearman(a, b) {
  const n = a.length; if (n < 3) return null;
  const rank = arr => { const idx = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = Array(arr.length); idx.forEach(([, i], k) => r[i] = k + 1); return r; };
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
    label: 'System-&-Application-SaaS v1.0 (A2 fehlt -> DEGRADIERT, coverage-normalisiert)',
    membership: { g: { c: 0.28, s: 0.07 }, gm: { c: 0.55, s: 0.10 }, scaleLog: { c: 2.0, s: 0.45 } },
    axes: [
      { key: 'growth', name: 'A1-Growth', k: 2.6, w: 0.66 },
      { key: 'gm', name: 'A3-GM', k: 1.6, w: 0.11 },
      { key: 'opMargin', name: 'A3-OpMargin', k: 1.6, w: 0.11 },
      { key: 'roicMinusWacc', name: 'A4-ROIC-WACC', k: 1.8, w: 0.12 },
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
    degraded: true,
    degradedNote: 'A2 Forward-Book 0% Coverage lokal -> Readiness-Gate. Gewicht auf {A1 .66, A3 .22, A4 .12}. KEIN court-Score.',
  },
};

const WACC = 0.09; // [TODO-CAL] grober Proxy für A4

// --- Skeptiker-Welle-2-Befunde, deterministisch eingebaut ---
const KILL = new Set(['PS', 'RDVT', 'ADEA', 'OMDA', 'TEM', 'KMTS']); // verifiziert: Ticker-Mismatch / falscher Sektor / Daten-Fehler
const INORGANIC_FALLBACK = new Set(['GEN', 'AVGO']);                 // hardcoded fallback: AVGO in fabless_semi has no snapshot row; GEN covered by data-driven rule but kept here for safety
const MEGACAP_REVM = 15000;                                          // > $15B Umsatz = Mega-Cap (Fabless: vom Small-Cap-Kern trennen)

// --- Laden ---
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const candDoc = readJson(CAND);
const byTicker = new Map(candDoc.candidates.map(c => [c.ticker, c]));
const buckDoc = readJson(BUCK);
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
  const seen = new Set();
  const members = [];
  for (const [t, b] of bucketOf) {
    if (b !== bucket) continue;
    if (KILL.has(t)) continue;                       // skeptiker-verifizierte Entfernung
    const c = byTicker.get(t);
    if (!c) continue;
    if (c.gm != null && c.gm > 1.0) continue;        // GM>100% = unmöglich (Daten-Fehler) -> hard reject
    // dedupe identische Foreign-OTC-Doppellistings (gleiche gm+rev)
    const fp = `${c.gm}|${c.scaleRevM}`;
    if (seen.has(fp)) continue; seen.add(fp);
    const m = { ...c, conf: confOf.get(t) };
    m.roicMinusWacc = (c.roicProxy != null) ? c.roicProxy - WACC : null;
    m.opMargin = c.opMargin;
    // Winsorize für Statistik (nicht für Anzeige): kaputte accel/growth begrenzen
    m._growth = c.growth == null ? null : clip(c.growth, -0.9, 5);
    m._accel = c.accel == null ? null : clip(c.accel, -5, 5);
    members.push(m);
  }
  // Roh-Achswerte für Stats: nutze winsorisierte für growth/accel
  const rawOf = (m, key) => key === 'growth' ? m._growth : key === 'accel' ? m._accel : m[key];

  // Cross-sectional Anker (Median) + MAD je Achse über das Bucket-Universum
  const stats = {};
  for (const ax of F.axes) {
    const vals = members.map(m => rawOf(m, ax.key)).filter(v => v != null && isFinite(v));
    stats[ax.key] = { median: median(vals), mad: mad(vals), n: vals.length };
  }

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
    let core = 0; m.axisS = {};
    for (const ax of F.axes) {
      const s = sAxis(rawOf(m, ax.key), stats[ax.key].median, stats[ax.key].mad, ax.k);
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
    if (m.sbcPct != null && m.sbcPct > 0.50) L.push('IPO-SBC-distortion');
    else if (m.sbcPct != null && m.sbcPct > 0.15) L.push('SBC>15%');
    if (m.scaleRevM > MEGACAP_REVM) L.push('mega-cap');
    const _ioFlag = inorganicFlag(m.ticker);
    const _ioRec = maRpoByTicker.get(m.ticker);
    if (_ioFlag === 'inorganic') L.push(`M&A-inorganic-flow(pay${pct(_ioRec.paymentsToRev).trim()},dGW${pct(_ioRec.deltaGoodwillPctRev).trim()},rpoG${pct(_ioRec.rpoGrowthYoY).trim()})`);
    else if (_ioFlag === 'ambiguous') L.push('M&A-flow-high(book-NULL,ambiguous)');
    else if (_ioFlag === null && INORGANIC_FALLBACK.has(m.ticker)) L.push('M&A-growth(P_auth-blind,hardcoded-fallback)');
    if (m.flags && m.flags.includes('insufficient-8q-history')) L.push('8q-approx');
    if (m.flags && m.flags.includes('short-annual-history')) L.push('short-hist');
    L.push('P_auth=no-data');
    if (F.degraded) L.push('A2-missing-degraded');
    if (m.conf === 'low') L.push('class-low-conf');
    m.lamps = L;
    if (_ioFlag === 'inorganic') {
      m.degradedRankBias = `upward — A1 headline growth is M&A-flow-heavy (recent acquisition cash ${pct(_ioRec.paymentsToRev).trim()} of rev, goodwill +${pct(_ioRec.deltaGoodwillPctRev).trim()}) while forward book is flat (rpoGrowth ${pct(_ioRec.rpoGrowthYoY).trim()}); degraded-mode rank over-states growth quality pending an A2/organic-growth axis.`;
    }
  }

  // Kollaps-Detektor: Spearman(Score, Dominanz-Block-Score)
  const ranked = members.filter(m => m.score != null);
  let collapse = null;
  if (ranked.length >= 3) {
    const total = ranked.map(m => m.score);
    const block = ranked.map(m => F.dominantBlock.reduce((s, key) => {
      const ax = F.axes.find(a => a.key === key); return s + (ax ? (m.axisS[ax.name] || 0) : 0);
    }, 0));
    collapse = spearman(total, block);
  }

  members.sort((a, b) => b.score - a.score);
  results[bucket] = {
    label: F.label, degraded: F.degraded, degradedNote: F.degradedNote || null,
    universeSize: members.length,
    anchors: stats,
    collapseSpearman: collapse == null ? null : Math.round(collapse * 100) / 100,
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
