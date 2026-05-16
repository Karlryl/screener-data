#!/usr/bin/env node
/**
 * Tag 198: Screener — Bloomberg-style 6-Tab Dashboard
 * ====================================================
 * Output: screener.html — single self-contained HTML file.
 *
 * Tabs:
 *   1. HG          — Hypergrowth-Quality (sorted by HG mode score)
 *   2. QC          — Quality-Compounder (sorted by QC mode score)
 *   3. SMALL       — MCap < $2B, RevGrowth > 20%, profitability-state != LOSS
 *   4. R40         — Universal Rule-of-40 ranking
 *   5. PRE-BREAKOUT— TURNAROUND/RECENT with growth > 25% + GM available
 *   6. WATCH       — NEAR_MISS in HG or QC mode
 *
 * Detail modal: 6 sections (header, key metric cards, SVG sparklines,
 * score history placeholder, annual table, full method scorecard).
 * Click any row to open. ESC to close. ← → arrow keys navigate within
 * the current filtered list of the active tab.
 *
 * All data is pre-computed in node and embedded as window.SCREENER_DATA.
 * No external CSS/JS dependencies. Pure inline SVG sparklines.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Runner = require('./methods/runner.js');
const SM = require('./methods/strategy-modes.js');
const DQ = require('./methods/data-quality.js');

const REGION_TO_COUNTRY = {
  'Nasdaq': 'USA', 'NasdaqCM': 'USA', 'NasdaqGM': 'USA', 'NasdaqGS': 'USA',
  'NYSE': 'USA', 'NYSE American': 'USA', 'NYSEArca': 'USA',
  'Cboe US': 'USA', 'OTC Markets OTCPK': 'USA', 'OTC Markets OTCQX': 'USA',
  'XETRA': 'DE', 'Frankfurt': 'DE', 'LSE': 'UK', 'Toronto': 'CA',
  'HKSE': 'HK', 'Shanghai': 'CN', 'Shenzhen': 'CN',
  'KSE': 'KR', 'KOSDAQ': 'KR', 'ASX': 'AU', 'Tokyo': 'JP',
  'Paris': 'FR', 'Amsterdam': 'NL', 'Swiss': 'CH', 'Stockholm': 'SE',
  'Oslo': 'NO', 'Copenhagen': 'DK', 'Helsinki': 'FI', 'Milan': 'IT',
  'MCE': 'ES', 'Vienna': 'AT', 'Brussels': 'BE', 'Athens': 'GR',
  'Warsaw': 'PL', 'Lisbon': 'PT', 'Irish': 'IE', 'Sao Paulo': 'BR',
  'Mexico': 'MX', 'SES': 'SG', 'Taiwan': 'TW',
  'Jakarta': 'ID', 'Kuala Lumpur': 'MY', 'Thailand': 'TH'
};

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './screener.html' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function loadStocks(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== '_manifest.json');
  const out = [];
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (s && typeof s === 'object' && !Array.isArray(s)) out.push(s);
    } catch (e) { /* skip corrupt */ }
  }
  return out;
}

function arrUnwrap(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(unwrap);
}

// Tag 199: is the latest annual entry positive? (GAAP-profit / FCF-positive helpers)
function annual_isPositive(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const v = unwrap(arr[0]);
  if (v == null) return null;
  return v > 0;
}

// Build per-stock row with everything the dashboard needs to render.
// Deliberately compact: keep the embedded JSON payload manageable for
// 3.5k stocks.
function buildRow(stock) {
  const ticker = stock.meta && stock.meta.ticker;
  if (!ticker) return null;

  const allResults = Runner.evaluateStock(stock);
  const modeEvals = {};
  for (const mId of Object.keys(SM.MODES || {})) {
    try { modeEvals[mId] = SM.evaluateMode(stock, mId, allResults); }
    catch (e) { modeEvals[mId] = null; }
  }

  const mcap = unwrap(stock.marketCap) || 0;
  const region = (stock.meta && stock.meta.region) || '';
  const country = REGION_TO_COUNTRY[region] || region || '—';

  const growth = unwrap(stock.metrics && stock.metrics.revenueGrowthYoY);
  const grossMargin = unwrap(stock.metrics && stock.metrics.grossMargin);
  const opMargin = unwrap(stock.metrics && stock.metrics.operatingMargin);
  const fcfMargin = unwrap(stock.metrics && stock.metrics.fcfMarginTTM);
  const revenueTTM = unwrap(stock.metrics && stock.metrics.revenueTTM);

  const r40 = allResults['rule-of-40'];
  const r40Value = (r40 && r40.computable && Number.isFinite(r40.value)) ? r40.value : null;

  const ps = allResults['profitability-state'];
  const state = (ps && ps.computable && ps.components && ps.components.state) || 'NA';

  const hgClass = allResults['hypergrowth-quality-class'];
  const hgClassName = (hgClass && hgClass.computable && hgClass.components && hgClass.components.class) || null;

  const gma = allResults['gross-margin-acceleration'];
  const gmaTrend = (gma && gma.computable && gma.components && gma.components.trend) || null;
  const gmaChange = (gma && gma.computable && gma.components && Number.isFinite(gma.components.change3periods))
    ? gma.components.change3periods : null;

  const oma = allResults['operating-margin-acceleration'];
  const omaTrend = (oma && oma.computable && oma.components && oma.components.trend) || null;
  const omaChange = (oma && oma.computable && oma.components && Number.isFinite(oma.components.change3y))
    ? oma.components.change3y : null;

  const revAccel = allResults['revenue-acceleration-yoy'];
  const revAccelDelta = (revAccel && revAccel.computable && Number.isFinite(revAccel.value))
    ? revAccel.value : null;  // delta in pp (current YoY - prior YoY)

  // Pre-Breakout composite score (Tag 200c — capped at 100):
  //   pb_score = min(revGrowth,100)/100 * 25   (current-year growth, capped)
  //            + min(grossMargin,100)/100 * 20 (margin level, capped at 100% which is theoretical max)
  //            + min(max(r40,0),100)/100 * 15  (R40 capped at 100 — beyond is noise)
  //            + gma_bonus * 10                (GM trending up)
  //            + oma_bonus * 15                (OM trending up — Damodaran)
  //            + revAccel_bonus * 15           (growth re-accelerating)
  //   strict max 100. Caps prevent CRDO-level extremes (yoy=201, r40=217) from
  //   inflating pbScore to 136+. The signals are already binary above ~100 —
  //   "extremely fast growth" doesn't get extra credit over "very fast growth".
  let pbScore = null;
  if (Number.isFinite(growth) && Number.isFinite(grossMargin)) {
    const growthC = Math.min(100, Math.max(0, growth));
    const gmC     = Math.min(100, Math.max(0, grossMargin));
    const r40C    = Math.min(100, Math.max(0, r40Value || 0));
    const gmaBonus = (gmaTrend === 'accelerating') ? 10 : (gmaTrend === 'stable' ? 4 : 0);
    const omaBonus = (omaTrend === 'accelerating') ? 15 : (omaTrend === 'stable' ? 6 : 0);
    let revAccelBonus = 0;
    if (revAccelDelta != null && revAccelDelta > 0) {
      revAccelBonus = Math.min(15, revAccelDelta / 50 * 15);
    }
    pbScore = (growthC / 100 * 25) + (gmC / 100 * 20) + (r40C / 100 * 15) + gmaBonus + omaBonus + revAccelBonus;
  }

  // Mode scores (already on 0-100 scale, accumulated by score-aggregator)
  const hgScore = modeEvals.HYPERGROWTH && Number.isFinite(modeEvals.HYPERGROWTH.score) ? modeEvals.HYPERGROWTH.score : null;
  const hgTier = modeEvals.HYPERGROWTH ? modeEvals.HYPERGROWTH.tier : null;
  const qcScore = modeEvals.QUALITY_COMPOUNDER && Number.isFinite(modeEvals.QUALITY_COMPOUNDER.score) ? modeEvals.QUALITY_COMPOUNDER.score : null;
  const qcTier = modeEvals.QUALITY_COMPOUNDER ? modeEvals.QUALITY_COMPOUNDER.tier : null;

  // Tag 199 audit gates: per-stock disqualification signals consumed by classifyTabs.
  //   qSpikeFail        — q-spike-dataguard pass=false (DATAGUARD HARD-FAIL)
  //   lossMagFail       — loss-magnitude-guard pass=false (DATAGUARD HARD-FAIL)
  //   dqGrade           — A+/A/B/C/D from data-quality module
  //   listingYears      — clean fiscal years available
  // These are exposed on the row so the client can also render them in
  // tooltips and the filter UI.
  const qSpike = allResults['q-spike-dataguard'];
  const qSpikeFail = !!(qSpike && qSpike.computable && qSpike.pass === false);
  const lossMag = allResults['loss-magnitude-guard'];
  const lossMagFail = !!(lossMag && lossMag.computable && lossMag.pass === false);
  const metricDiv = allResults['metric-divergence-guard'];
  const metricDivFail = !!(metricDiv && metricDiv.computable && metricDiv.pass === false);
  const niVol = allResults['net-income-volatility-guard'];
  const niVolFail = !!(niVol && niVol.computable && niVol.pass === false);
  // Tag 201b: empty annualOpInc bypass (Agent 5 finding) — narrow guard
  // for mcap > 1B with rev < 100M (QS/JOBY pattern). Sits alongside the
  // four prior gates as defense-in-depth.
  const preComm = allResults['pre-commerciality-megacap-guard'];
  const preCommFail = !!(preComm && preComm.computable && preComm.pass === false);
  const listing = allResults['listing-age'];
  const listingYears = (listing && listing.computable && Number.isFinite(listing.value)) ? listing.value : null;

  let dqGrade = null;
  let dqMissing = null;
  try {
    const g = DQ.gradeSnapshot(stock);
    dqGrade = g.grade;
    dqMissing = g.missingFields;
  } catch (e) { /* skip */ }

  // Headline profitability flags (used by GAAP/FCF toggles in UI)
  const gaapProfitable = annual_isPositive((stock.annual && stock.annual.annualNetIncome) || []);
  const fcfPositive    = annual_isPositive((stock.annual && stock.annual.annualFCF) || []);

  // Annual time-series for sparklines (compact: just the numeric arrays)
  const a = stock.annual || {};
  const annual = {
    rev: arrUnwrap(a.annualRev).slice(0, 5),
    opInc: arrUnwrap(a.annualOpInc).slice(0, 5),
    gp: arrUnwrap(a.annualGP).slice(0, 5),
    fcf: arrUnwrap(a.annualFCF).slice(0, 5),
    netIncome: arrUnwrap(a.annualNetIncome).slice(0, 5)
  };

  // Compress allResults: drop heavy fields, keep only what scorecard renders
  const compactResults = {};
  for (const k of Object.keys(allResults)) {
    const r = allResults[k];
    compactResults[k] = {
      pass: r.pass,
      computable: r.computable,
      value: (r.value != null && Number.isFinite(r.value)) ? Math.round(r.value * 10000) / 10000 : null,
      reason: typeof r.reason === 'string' ? r.reason.slice(0, 120) : ''
    };
  }

  return {
    ticker,
    name: (stock.meta && stock.meta.name) || ticker,
    sector: (stock.meta && stock.meta.sector) || '—',
    industry: (stock.meta && stock.meta.industry) || '—',
    country,
    ipoYear: (stock.meta && Number.isFinite(stock.meta.ipoYear)) ? stock.meta.ipoYear : null,
    mcap,
    revenueTTM,
    growth, grossMargin, opMargin, fcfMargin,
    r40: r40Value,
    state,
    hgClass: hgClassName,
    hgScore, hgTier,
    qcScore, qcTier,
    pbScore,
    gmaTrend, gmaChange,
    omaTrend, omaChange,
    revAccelDelta,
    // Tag 199/200 audit gates
    qSpikeFail, lossMagFail, metricDivFail, niVolFail, preCommFail, dqGrade, listingYears,
    gaapProfitable, fcfPositive,
    annual,
    results: compactResults
  };
}

function fmtMoney(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1e12) return (v/1e12).toFixed(2) + 'T';
  if (Math.abs(v) >= 1e9)  return (v/1e9).toFixed(1) + 'B';
  if (Math.abs(v) >= 1e6)  return (v/1e6).toFixed(0) + 'M';
  return v.toFixed(0);
}

function classifyTabs(rows) {
  const tabs = { HG: [], QC: [], SMALL: [], R40: [], PRE_BREAKOUT: [], WATCH: [] };

  for (const r of rows) {
    // Tag 199 HARD GATES — stocks failing any gate land in WATCH ONLY, regardless
    // of growth/score. This is the precision-audit step: catches SOUN, IONQ, and
    // similar narrative-loss patterns that score-aggregator alone can't reject.
    //
    //   1. q-spike-dataguard fail → single-Q spike artifact
    //   2. loss-magnitude-guard fail → op loss > 50% of revenue
    //   3. data-quality grade D → too many missing fields to trust the score
    //
    // No hardcoded tickers — these are signatures the data must satisfy.
    const hardGated = r.qSpikeFail || r.lossMagFail || r.metricDivFail || r.niVolFail || r.preCommFail || r.dqGrade === 'D';

    if (hardGated) {
      // WATCH-only entry: surface them with the reason for review, but block
      // promotion to HG/QC/SMALL/R40/PRE_BREAKOUT.
      const reasons = [];
      if (r.qSpikeFail) reasons.push('Q-SPIKE');
      if (r.lossMagFail) reasons.push('LOSS>50%REV');
      if (r.metricDivFail) reasons.push('METRIC-DIV');
      if (r.niVolFail) reasons.push('NI-VOL');
      if (r.preCommFail) reasons.push('PRE-COMM-MEGACAP');
      if (r.dqGrade === 'D') reasons.push('DATA-D');
      r.watchReasons = reasons;
      tabs.WATCH.push(r);
      continue;
    }

    // QC requires ≥ 3 clean fiscal years (listing-age floor) — a "durable
    // compounder" with 1-2y of history is a misclassification by construction.
    // Soft signal: incomputable listing-age treated as eligible (avoid bad
    // data → false-negative path).
    const qcEligibleByAge = (r.listingYears == null) || (r.listingYears >= 3);
    // Data-quality grade C: visible in WATCH but blocked from HG/QC/PRE-BREAKOUT.
    const dqBlockedFromQuality = r.dqGrade === 'C';

    // HG: real-hypergrowth class + score available
    if (r.hgClass && (r.hgClass === 'REAL_HYPERGROWTH_ACCELERATING' || r.hgClass === 'REAL_HYPERGROWTH_BUT_LOSSY')
        && Number.isFinite(r.hgScore) && !dqBlockedFromQuality) {
      tabs.HG.push(r);
    }
    // QC: tier !== REJECT, score available, ≥3y history, grade ≥ B
    if (Number.isFinite(r.qcScore) && r.qcTier && r.qcTier !== 'REJECT'
        && qcEligibleByAge && !dqBlockedFromQuality) {
      tabs.QC.push(r);
    }
    // SMALL: mcap < 2B, growth > 20%, not LOSS
    if (r.mcap > 0 && r.mcap < 2e9 && Number.isFinite(r.growth) && r.growth > 20 && r.state !== 'LOSS') {
      tabs.SMALL.push(r);
    }
    // R40: r40 computable (also subject to hard gates above — already filtered)
    if (Number.isFinite(r.r40)) {
      tabs.R40.push(r);
    }
    // PRE-BREAKOUT: state TURNAROUND/RECENT, growth > 25%, grossMargin available
    if ((r.state === 'TURNAROUND' || r.state === 'RECENT') && Number.isFinite(r.growth) && r.growth > 25
        && Number.isFinite(r.grossMargin) && r.grossMargin > 0 && !dqBlockedFromQuality) {
      tabs.PRE_BREAKOUT.push(r);
    }
    // WATCH: NEAR_MISS tier in HG or QC
    if (r.hgTier === 'NEAR_MISS' || r.qcTier === 'NEAR_MISS') {
      tabs.WATCH.push(r);
    }
  }

  // Sorting per tab
  tabs.HG.sort((a, b) => (b.hgScore || 0) - (a.hgScore || 0));
  tabs.QC.sort((a, b) => (b.qcScore || 0) - (a.qcScore || 0));
  tabs.SMALL.sort((a, b) => (b.growth || 0) - (a.growth || 0));
  tabs.R40.sort((a, b) => (b.r40 || 0) - (a.r40 || 0));
  tabs.PRE_BREAKOUT.sort((a, b) => (b.pbScore || 0) - (a.pbScore || 0));
  tabs.WATCH.sort((a, b) => Math.max(b.hgScore || 0, b.qcScore || 0) - Math.max(a.hgScore || 0, a.qcScore || 0));

  // Embedded-JSON size guard: R40 tab is the most permissive (every stock with
  // a computable R40 qualifies) — without a cap the dashboard payload balloons
  // to >15 MB. Cap at top 500 by R40 desc; that's still 5x the skill's
  // "≥100 entries" requirement and includes everyone meaningful.
  tabs.R40 = tabs.R40.slice(0, 500);

  return tabs;
}

// CSS — Bloomberg terminal styled, no rounded corners on data cells.
// Embedded as a single template literal; no external CSS.
const CSS = `
:root {
  --bg-0:#080b0f; --bg-1:#0d1117; --bg-2:#131a24; --bg-hover:#1a2535;
  --border:#1e2d3d; --border-bright:#2a4060;
  --text-0:#e2eaf3; --text-1:#8899aa; --text-2:#4a5f70;
  --green:#00cc88; --red:#ff3d5a; --yellow:#ffbb33; --blue:#3d8fff; --purple:#8866ff;
  --mono:'JetBrains Mono','Cascadia Code','Consolas',monospace;
  --ui:-apple-system,'Segoe UI',sans-serif;
}
* { box-sizing:border-box; }
body { margin:0; background:var(--bg-0); color:var(--text-0); font-family:var(--ui); font-size:13px; }
header { position:sticky; top:0; z-index:10; background:var(--bg-1); border-bottom:1px solid var(--border-bright); padding:10px 16px; display:flex; align-items:center; gap:16px; }
header .brand { font-weight:700; color:var(--blue); letter-spacing:0.05em; }
header .search { flex:1; max-width:480px; }
header input { width:100%; background:var(--bg-2); border:1px solid var(--border); color:var(--text-0); padding:6px 10px; font-family:var(--mono); font-size:12px; outline:none; }
header input:focus { border-color:var(--blue); }
.tabs { display:flex; gap:0; padding:0 16px; background:var(--bg-1); border-bottom:1px solid var(--border); }
.tabs button { background:transparent; border:none; color:var(--text-1); padding:10px 14px; font-family:var(--ui); font-size:12px; cursor:pointer; border-bottom:2px solid transparent; letter-spacing:0.03em; }
.tabs button:hover { color:var(--text-0); background:var(--bg-hover); }
.tabs button.active { color:var(--blue); border-bottom-color:var(--blue); }
.filters { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:8px 16px; background:var(--bg-1); border-bottom:1px solid var(--border); font-size:11px; }
.filters .group { display:flex; gap:4px; align-items:center; }
.filters .label { color:var(--text-2); margin-right:4px; }
.filters button.f { background:var(--bg-2); color:var(--text-1); border:1px solid var(--border); padding:3px 8px; font-family:var(--mono); font-size:11px; cursor:pointer; }
.filters button.f.on { background:var(--bg-hover); color:var(--text-0); border-color:var(--border-bright); }
.filters select { background:var(--bg-2); color:var(--text-0); border:1px solid var(--border); padding:3px 6px; font-family:var(--ui); font-size:11px; }
.filters input[type=number] { background:var(--bg-2); color:var(--text-0); border:1px solid var(--border); padding:3px 6px; font-family:var(--mono); font-size:11px; width:70px; }
.summary { padding:6px 16px; background:var(--bg-0); color:var(--text-1); font-size:11px; border-bottom:1px solid var(--border); font-family:var(--mono); }
.summary strong { color:var(--text-0); }
.table-wrap { overflow:auto; }
table.dt { width:100%; border-collapse:collapse; font-size:12px; }
table.dt th { background:var(--bg-1); color:var(--text-1); text-align:left; padding:7px 10px; border-bottom:1px solid var(--border-bright); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; position:sticky; top:0; }
table.dt td { padding:6px 10px; border-bottom:1px solid var(--border); font-family:var(--mono); }
table.dt tr.row { cursor:pointer; }
table.dt tr.row:hover { background:var(--bg-hover); }
table.dt td.num { text-align:right; }
table.dt td.ticker { color:var(--text-0); font-weight:600; }
table.dt td.name { font-family:var(--ui); color:var(--text-1); max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pill { display:inline-block; padding:1px 6px; font-size:10px; font-family:var(--mono); border:1px solid var(--border); }
.pill.LOSS      { background:#3a1118; color:#ff7a8e; border-color:#5a1b25; }
.pill.TURNAROUND{ background:#3a2a08; color:#ffbb33; border-color:#5a4010; }
.pill.RECENT    { background:#0e2a1e; color:#00cc88; border-color:#1a4a36; }
.pill.STABLE    { background:#0a1e3a; color:#3d8fff; border-color:#1a3358; }
.pill.NA        { background:#1a1e26; color:var(--text-2); }
.g-r40-excellent { color:#00ff99; font-weight:700; }
.g-r40-good      { color:#00cc88; }
.g-r40-fair      { color:#ffbb33; }
.g-r40-warn      { color:#ff9933; }
.g-r40-bad       { color:#ff3d5a; }
.g-pos { color:var(--green); }
.g-neg { color:var(--red); }
.g-mute { color:var(--text-2); }
.pagination { padding:10px 16px; display:flex; justify-content:center; gap:10px; align-items:center; background:var(--bg-1); border-top:1px solid var(--border); font-family:var(--mono); font-size:11px; }
.pagination button { background:var(--bg-2); color:var(--text-0); border:1px solid var(--border); padding:4px 10px; cursor:pointer; font-family:var(--mono); }
.pagination button:disabled { color:var(--text-2); cursor:default; }
.search-results { position:absolute; top:48px; left:50%; transform:translateX(-50%); width:480px; max-height:400px; overflow:auto; background:var(--bg-1); border:1px solid var(--border-bright); z-index:20; display:none; }
.search-results.show { display:block; }
.search-results .sr { padding:6px 10px; cursor:pointer; border-bottom:1px solid var(--border); font-size:12px; }
.search-results .sr:hover { background:var(--bg-hover); }
.search-results .sr .badge { display:inline-block; margin-left:6px; padding:1px 5px; font-size:10px; font-family:var(--mono); border:1px solid var(--border); color:var(--text-1); }
.modal { position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:100; display:none; overflow:auto; }
.modal.show { display:block; }
.modal-content { max-width:1100px; margin:24px auto; background:var(--bg-0); border:1px solid var(--border-bright); padding:20px 24px 32px; }
.modal-header { display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; padding-bottom:12px; border-bottom:1px solid var(--border); }
.modal-header .tk { font-size:24px; font-weight:700; color:var(--text-0); }
.modal-header .nm { font-size:14px; color:var(--text-1); }
.modal-header .meta { color:var(--text-2); font-size:11px; }
.modal-header .right { margin-left:auto; display:flex; gap:8px; }
.modal-header button { background:var(--bg-2); color:var(--text-0); border:1px solid var(--border); padding:4px 10px; cursor:pointer; font-family:var(--mono); font-size:11px; }
.cards { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:16px 0; }
.card { background:var(--bg-1); border:1px solid var(--border); padding:12px 14px; }
.card .lbl { font-size:10px; color:var(--text-2); text-transform:uppercase; letter-spacing:0.05em; }
.card .v { font-size:26px; font-family:var(--mono); font-weight:700; color:var(--text-0); margin-top:6px; }
.card .sub { font-size:11px; color:var(--text-1); margin-top:4px; font-family:var(--mono); }
.charts { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; margin:16px 0; }
.chart { background:var(--bg-2); border:1px solid var(--border); padding:8px; }
.chart .ct { font-size:11px; color:var(--text-1); text-transform:uppercase; margin-bottom:4px; }
.scorecard table { width:100%; border-collapse:collapse; font-size:11px; margin-top:6px; }
.scorecard td { padding:4px 8px; border-bottom:1px solid var(--border); font-family:var(--mono); }
.scorecard .ok { color:var(--green); }
.scorecard .fail { color:var(--red); }
.scorecard .na { color:var(--text-2); }
.annual table { width:100%; border-collapse:collapse; font-size:11px; }
.annual th { padding:5px 8px; background:var(--bg-1); border-bottom:1px solid var(--border-bright); text-align:right; }
.annual td { padding:4px 8px; border-bottom:1px solid var(--border); font-family:var(--mono); text-align:right; }
.annual td.fy { text-align:left; color:var(--text-1); }
h3.sec { color:var(--text-0); font-size:13px; font-weight:600; margin:20px 0 6px; padding-bottom:4px; border-bottom:1px solid var(--border); text-transform:uppercase; letter-spacing:0.05em; }
`;

// Client-side JS — runs in the browser, reads window.SCREENER_DATA
const CLIENT_JS = `
(function(){
  const DATA = window.SCREENER_DATA;
  const ROWS = DATA.rowsByTicker;
  // TABS came over as { TAB: [ticker, ticker, ...] }; hydrate into row arrays for filter/render code.
  const TABS = {};
  for (const t of Object.keys(DATA.tabs)) {
    TABS[t] = DATA.tabs[t].map(tk => ROWS[tk]).filter(Boolean);
  }
  const PAGE_SIZE = 50;

  let activeTab = 'HG';
  let page = 1;
  let filterState = { LOSS:true, TURNAROUND:true, RECENT:true, STABLE:true, NA:true };
  let filterCap = { MICRO:true, SMALL:true, MID:true, LARGE:true, MEGA:true };
  let filterSector = '';
  let filterCountry = '';
  let filterMinR40 = '';
  let filterMaxR40 = '';
  let filterMin = '';     // tab-specific min input — auto-resets on tab switch
  // Tag 199 audit filters
  let filterIpo = 'ALL';  // ALL | LT1 | LT2 | LT5 | GT5
  let filterDQ = { 'A+':true, 'A':true, 'B':true, 'C':false, 'D':false };
  let onlyGaap = false;
  let onlyFcf  = false;
  let sortKey = 'auto';   // auto = tab's primary; or one of {score,r40,growth,fcfMargin,mcap,pbScore}
  let currentList = [];   // active filtered list

  function capBucket(mcap){
    if (!mcap) return null;
    if (mcap < 300e6) return 'MICRO';
    if (mcap < 2e9) return 'SMALL';
    if (mcap < 10e9) return 'MID';
    if (mcap < 200e9) return 'LARGE';
    return 'MEGA';
  }
  function fmtM(v){ if (v==null||!isFinite(v)) return '—'; if (Math.abs(v)>=1e12) return (v/1e12).toFixed(2)+'T'; if (Math.abs(v)>=1e9) return (v/1e9).toFixed(1)+'B'; if (Math.abs(v)>=1e6) return (v/1e6).toFixed(0)+'M'; return v.toFixed(0); }
  function fmtP(v,d){ if (v==null||!isFinite(v)) return '—'; return (v>=0?'':'')+(v).toFixed(d==null?1:d)+'%'; }
  function fmtN(v,d){ if (v==null||!isFinite(v)) return '—'; return v.toFixed(d==null?1:d); }
  function pct(v){ if (v==null||!isFinite(v)) return '—'; return v.toFixed(1)+'%'; }
  function colorPct(v){ if (v==null||!isFinite(v)) return 'g-mute'; return v>=0?'g-pos':'g-neg'; }
  function r40Class(v){ if (v==null) return 'g-mute'; if (v>=60) return 'g-r40-excellent'; if (v>=40) return 'g-r40-good'; if (v>=20) return 'g-r40-fair'; if (v>=0) return 'g-r40-warn'; return 'g-r40-bad'; }

  // ------- filter application -------
  function ipoAgeYears(r){
    // listingYears is the canonical signal (counts clean fiscal years).
    // Fallback to meta.ipoYear if listing-age was incomputable.
    if (r.listingYears != null) return r.listingYears;
    if (r.ipoYear != null) return DATA.currentYear - r.ipoYear;
    return null;
  }
  function applyFilters(list){
    return list.filter(r => {
      if (!filterState[r.state]) return false;
      const cb = capBucket(r.mcap);
      if (cb && !filterCap[cb]) return false;
      if (filterSector && r.sector !== filterSector) return false;
      if (filterCountry && r.country !== filterCountry) return false;
      if (filterMinR40 !== '' && !isNaN(+filterMinR40)) {
        if (r.r40 == null || r.r40 < +filterMinR40) return false;
      }
      if (filterMaxR40 !== '' && !isNaN(+filterMaxR40)) {
        if (r.r40 != null && r.r40 > +filterMaxR40) return false;
      }
      if (filterMin !== '' && !isNaN(+filterMin)) {
        const minV = +filterMin;
        if (activeTab === 'HG' && (r.r40 == null || r.r40 < minV)) return false;
        if (activeTab === 'QC' && (r.fcfMargin == null || r.fcfMargin < minV)) return false;
        if (activeTab === 'SMALL' && (r.growth == null || r.growth < minV)) return false;
        if (activeTab === 'R40' && (r.r40 == null || r.r40 < minV)) return false;
        if (activeTab === 'PRE_BREAKOUT' && (r.growth == null || r.growth < minV)) return false;
      }
      // Tag 199 audit filters
      if (filterIpo !== 'ALL') {
        const age = ipoAgeYears(r);
        if (filterIpo === 'LT1' && !(age != null && age < 1)) return false;
        if (filterIpo === 'LT2' && !(age != null && age < 2)) return false;
        if (filterIpo === 'LT5' && !(age != null && age < 5)) return false;
        if (filterIpo === 'GT5' && !(age != null && age >= 5)) return false;
      }
      const grade = r.dqGrade || 'A+';  // unknown grade defaults to A+ to avoid silent exclusion
      if (!filterDQ[grade]) return false;
      if (onlyGaap && r.gaapProfitable !== true) return false;
      if (onlyFcf && r.fcfPositive !== true) return false;
      return true;
    });
  }

  // ------- sort dispatcher -------
  function sortList(list){
    const tab = activeTab;
    const key = sortKey;
    const cmp = (a, b) => {
      const k = key;
      if (k === 'auto') {
        if (tab === 'HG') return (b.hgScore||0) - (a.hgScore||0);
        if (tab === 'QC') return (b.qcScore||0) - (a.qcScore||0);
        if (tab === 'SMALL') return (b.growth||0) - (a.growth||0);
        if (tab === 'R40') return (b.r40||0) - (a.r40||0);
        if (tab === 'PRE_BREAKOUT') return (b.pbScore||0) - (a.pbScore||0);
        if (tab === 'WATCH') return Math.max(b.hgScore||0, b.qcScore||0) - Math.max(a.hgScore||0, a.qcScore||0);
        return 0;
      }
      if (k === 'score')     return Math.max(b.hgScore||0, b.qcScore||0) - Math.max(a.hgScore||0, a.qcScore||0);
      if (k === 'r40')       return (b.r40||0) - (a.r40||0);
      if (k === 'growth')    return (b.growth||0) - (a.growth||0);
      if (k === 'fcfMargin') return (b.fcfMargin||0) - (a.fcfMargin||0);
      if (k === 'mcap')      return (b.mcap||0) - (a.mcap||0);
      if (k === 'pbScore')   return (b.pbScore||0) - (a.pbScore||0);
      return 0;
    };
    list.sort(cmp);
    return list;
  }

  // ------- table rendering -------
  function tabColumns(tab){
    if (tab === 'HG') return [
      {k:'#',w:30}, {k:'Ticker',w:60}, {k:'Company',w:240}, {k:'Sector',w:120},
      {k:'Score',w:60,num:true}, {k:'State',w:80}, {k:'R40',w:60,num:true},
      {k:'RevGr%',w:70,num:true}, {k:'GrossM%',w:70,num:true}, {k:'FCFM%',w:70,num:true}, {k:'MCap',w:70,num:true}
    ];
    if (tab === 'QC') return [
      {k:'#',w:30}, {k:'Ticker',w:60}, {k:'Company',w:240}, {k:'Sector',w:120},
      {k:'Score',w:60,num:true}, {k:'State',w:80}, {k:'FCFM%',w:70,num:true},
      {k:'OpM%',w:70,num:true}, {k:'GrossM%',w:70,num:true}, {k:'MCap',w:70,num:true}
    ];
    if (tab === 'SMALL') return [
      {k:'#',w:30}, {k:'Ticker',w:60}, {k:'Company',w:240}, {k:'Country',w:60},
      {k:'State',w:80}, {k:'RevGr%',w:70,num:true}, {k:'R40',w:60,num:true},
      {k:'GrossM%',w:70,num:true}, {k:'MCap',w:70,num:true}
    ];
    if (tab === 'R40') return [
      {k:'#',w:30}, {k:'Ticker',w:60}, {k:'Company',w:240}, {k:'Sector',w:120},
      {k:'R40',w:60,num:true}, {k:'RevGr%',w:70,num:true}, {k:'FCFM%',w:70,num:true},
      {k:'OpM%',w:70,num:true}, {k:'GrossM%',w:70,num:true}, {k:'State',w:80}, {k:'MCap',w:70,num:true}
    ];
    if (tab === 'PRE_BREAKOUT') return [
      {k:'#',w:30}, {k:'Ticker',w:60}, {k:'Company',w:220}, {k:'Sector',w:110},
      {k:'State',w:80}, {k:'RevGr%',w:65,num:true}, {k:'GrossM%',w:65,num:true},
      {k:'R40',w:55,num:true}, {k:'Signals',w:95}, {k:'MCap',w:70,num:true}, {k:'PB-Score',w:70,num:true}
    ];
    if (tab === 'WATCH') return [
      {k:'#',w:30}, {k:'Ticker',w:60}, {k:'Company',w:240}, {k:'Reason',w:120},
      {k:'Score',w:60,num:true}, {k:'State',w:80}, {k:'RevGr%',w:70,num:true}, {k:'MCap',w:70,num:true}
    ];
    return [];
  }

  function renderRow(r, i, tab){
    const stateP = '<span class="pill '+r.state+'">'+r.state+'</span>';
    const r40Html = r.r40==null ? '—' : '<span class="'+r40Class(r.r40)+'">'+r.r40.toFixed(1)+'</span>';
    const growthHtml = r.growth==null ? '—' : '<span class="'+colorPct(r.growth)+'">'+r.growth.toFixed(1)+'%</span>';
    const gmHtml = r.grossMargin==null ? '—' : r.grossMargin.toFixed(1)+'%';
    const opmHtml = r.opMargin==null ? '—' : '<span class="'+colorPct(r.opMargin)+'">'+r.opMargin.toFixed(1)+'%</span>';
    const fcfmHtml = r.fcfMargin==null ? '—' : '<span class="'+colorPct(r.fcfMargin)+'">'+r.fcfMargin.toFixed(1)+'%</span>';

    if (tab === 'HG') {
      const score = r.hgScore==null ? '—' : r.hgScore.toFixed(0);
      return '<tr class="row" data-tk="'+r.ticker+'"><td>'+(i+1)+'</td><td class="ticker">'+r.ticker+'</td><td class="name">'+r.name+'</td><td>'+r.sector+'</td><td class="num">'+score+'</td><td>'+stateP+'</td><td class="num">'+r40Html+'</td><td class="num">'+growthHtml+'</td><td class="num">'+gmHtml+'</td><td class="num">'+fcfmHtml+'</td><td class="num">'+fmtM(r.mcap)+'</td></tr>';
    }
    if (tab === 'QC') {
      const score = r.qcScore==null ? '—' : r.qcScore.toFixed(0);
      return '<tr class="row" data-tk="'+r.ticker+'"><td>'+(i+1)+'</td><td class="ticker">'+r.ticker+'</td><td class="name">'+r.name+'</td><td>'+r.sector+'</td><td class="num">'+score+'</td><td>'+stateP+'</td><td class="num">'+fcfmHtml+'</td><td class="num">'+opmHtml+'</td><td class="num">'+gmHtml+'</td><td class="num">'+fmtM(r.mcap)+'</td></tr>';
    }
    if (tab === 'SMALL') {
      return '<tr class="row" data-tk="'+r.ticker+'"><td>'+(i+1)+'</td><td class="ticker">'+r.ticker+'</td><td class="name">'+r.name+'</td><td>'+r.country+'</td><td>'+stateP+'</td><td class="num">'+growthHtml+'</td><td class="num">'+r40Html+'</td><td class="num">'+gmHtml+'</td><td class="num">'+fmtM(r.mcap)+'</td></tr>';
    }
    if (tab === 'R40') {
      return '<tr class="row" data-tk="'+r.ticker+'"><td>'+(i+1)+'</td><td class="ticker">'+r.ticker+'</td><td class="name">'+r.name+'</td><td>'+r.sector+'</td><td class="num">'+r40Html+'</td><td class="num">'+growthHtml+'</td><td class="num">'+fcfmHtml+'</td><td class="num">'+opmHtml+'</td><td class="num">'+gmHtml+'</td><td>'+stateP+'</td><td class="num">'+fmtM(r.mcap)+'</td></tr>';
    }
    if (tab === 'PRE_BREAKOUT') {
      const pb = r.pbScore==null ? '—' : r.pbScore.toFixed(0);
      // Three-signal acceleration column: GM↑ OM↑ Rev↑ — only show active ones.
      const sigs = [];
      if (r.gmaTrend === 'accelerating') sigs.push('<span class="g-pos" title="Gross-Margin accelerating">GM↑</span>');
      if (r.omaTrend === 'accelerating') sigs.push('<span class="g-pos" title="Operating-Margin accelerating">OpM↑</span>');
      if (r.revAccelDelta != null && r.revAccelDelta > 0) sigs.push('<span class="g-pos" title="Revenue YoY accelerating +'+r.revAccelDelta.toFixed(0)+'pp">Rev↑</span>');
      const signalsHtml = sigs.length ? sigs.join(' ') : '<span class="g-mute">—</span>';
      return '<tr class="row" data-tk="'+r.ticker+'"><td>'+(i+1)+'</td><td class="ticker">'+r.ticker+'</td><td class="name">'+r.name+'</td><td>'+r.sector+'</td><td>'+stateP+'</td><td class="num">'+growthHtml+'</td><td class="num">'+gmHtml+'</td><td class="num">'+r40Html+'</td><td style="font-size:10px">'+signalsHtml+'</td><td class="num">'+fmtM(r.mcap)+'</td><td class="num">'+pb+'</td></tr>';
    }
    if (tab === 'WATCH') {
      const score = Math.max(r.hgScore||0, r.qcScore||0).toFixed(0);
      // Reasons priority: explicit hard-gate reasons > NEAR_MISS tier label.
      let reason;
      if (r.watchReasons && r.watchReasons.length) reason = r.watchReasons.join(',');
      else if (r.hgTier==='NEAR_MISS') reason = 'HG NEAR';
      else if (r.qcTier==='NEAR_MISS') reason = 'QC NEAR';
      else reason = '—';
      return '<tr class="row" data-tk="'+r.ticker+'"><td>'+(i+1)+'</td><td class="ticker">'+r.ticker+'</td><td class="name">'+r.name+'</td><td style="font-size:10px">'+reason+'</td><td class="num">'+score+'</td><td>'+stateP+'</td><td class="num">'+growthHtml+'</td><td class="num">'+fmtM(r.mcap)+'</td></tr>';
    }
    return '';
  }

  // Per-tab explainer text (rendered above the table when the tab activates).
  const TAB_EXPLAINERS = {
    'PRE_BREAKOUT': 'Companies recently turning profitable with accelerating growth. These are the future compounders — before the market prices in the quality improvement. Historical examples: PLTR (TURNAROUND→HG mid-2023), CRDO (2022), ALAB (2023).',
    'WATCH': 'Stocks flagged by hard-gates (Q-Spike, Loss>50%Rev, Metric-Divergence, DQ-D) and NEAR_MISS tier — explicitly held out of HG/QC/SMALL/R40/PRE-BREAKOUT for human review.',
    'SMALL': 'Market cap < $2B, revenue growth > 20%, not in LOSS state. Hunting the next CRDO/ALAB before they hit the radar.'
  };

  function renderTable(){
    const filtered = applyFilters(TABS[activeTab] || []);
    const list = sortList(filtered.slice());
    currentList = list;
    const cols = tabColumns(activeTab);
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const slice = list.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);

    let avgR40 = 0, n = 0;
    for (const r of list) { if (r.r40 != null) { avgR40 += r.r40; n++; } }
    const summary = '<strong>'+list.length+'</strong> of '+(TABS[activeTab]||[]).length+' · Avg R40: '+(n>0?(avgR40/n).toFixed(1):'—')+' · Updated: '+DATA.generatedAt;
    document.getElementById('summary').innerHTML = summary;

    // Tag 199m: per-tab explainer (italicized, muted color) above the table.
    const explEl = document.getElementById('explainer');
    const exp = TAB_EXPLAINERS[activeTab];
    if (exp) {
      explEl.innerHTML = '<em>' + exp + '</em>';
      explEl.style.display = 'block';
    } else {
      explEl.style.display = 'none';
    }

    let html = '<table class="dt"><thead><tr>';
    for (const c of cols) html += '<th'+(c.num?' class="num"':'')+' style="width:'+c.w+'px">'+c.k+'</th>';
    html += '</tr></thead><tbody>';
    for (let i=0;i<slice.length;i++) html += renderRow(slice[i], (page-1)*PAGE_SIZE + i, activeTab);
    html += '</tbody></table>';
    document.getElementById('table').innerHTML = html;

    document.getElementById('pageInfo').textContent = 'Page '+page+' of '+totalPages;
    document.getElementById('prevPage').disabled = page <= 1;
    document.getElementById('nextPage').disabled = page >= totalPages;
  }

  // ------- modal -------
  function spark(values, opts){
    // values newest-first; reverse for left-to-right oldest-to-newest
    const vs = values.filter(v => v != null && isFinite(v)).slice().reverse();
    if (vs.length < 2) return '<svg width="300" height="160"><text x="150" y="80" text-anchor="middle" fill="#4a5f70" font-size="11">no data</text></svg>';
    const W = 300, H = 160, pad = 18;
    const minV = Math.min(...vs, 0);
    const maxV = Math.max(...vs, 0);
    const range = (maxV - minV) || 1;
    const x = i => pad + (i/(vs.length-1)) * (W - pad*2);
    const y = v => H - pad - ((v - minV)/range) * (H - pad*2);
    const trendUp = vs[vs.length-1] > vs[0];
    const color = trendUp ? '#3d8fff' : '#ff3d5a';
    let svg = '<svg width="'+W+'" height="'+H+'" style="display:block">';
    // Zero line if range crosses zero
    if (minV < 0 && maxV > 0) {
      const y0 = y(0);
      svg += '<line x1="'+pad+'" y1="'+y0+'" x2="'+(W-pad)+'" y2="'+y0+'" stroke="#1e2d3d" stroke-dasharray="2 3"/>';
    }
    // Min/Max y-axis labels
    svg += '<text x="3" y="'+(pad+4)+'" fill="#4a5f70" font-family="JetBrains Mono,monospace" font-size="9">'+(opts && opts.fmt ? opts.fmt(maxV) : maxV.toFixed(1))+'</text>';
    svg += '<text x="3" y="'+(H-pad+10)+'" fill="#4a5f70" font-family="JetBrains Mono,monospace" font-size="9">'+(opts && opts.fmt ? opts.fmt(minV) : minV.toFixed(1))+'</text>';
    if (opts && opts.bar) {
      const barW = (W - pad*2) / vs.length * 0.7;
      for (let i=0;i<vs.length;i++){
        const bx = x(i) - barW/2;
        const by = y(Math.max(vs[i],0));
        const bh = Math.abs(y(vs[i]) - y(0));
        svg += '<rect x="'+bx+'" y="'+by+'" width="'+barW+'" height="'+bh+'" fill="'+color+'"/>';
      }
    } else {
      let path = '';
      for (let i=0;i<vs.length;i++){
        path += (i===0?'M':'L')+x(i)+','+y(vs[i]);
      }
      svg += '<path d="'+path+'" stroke="'+color+'" stroke-width="1.5" fill="none"/>';
      for (let i=0;i<vs.length;i++){
        svg += '<circle cx="'+x(i)+'" cy="'+y(vs[i])+'" r="2.5" fill="'+color+'"/>';
      }
    }
    svg += '</svg>';
    return svg;
  }

  function showModal(ticker){
    const r = ROWS[ticker];
    if (!r) return;
    window._modalTk = ticker;
    const m = document.getElementById('modal');
    const c = document.getElementById('modalContent');

    // Section A: Header — extended with Tag 199 audit signals
    let html = '<div class="modal-header">';
    html += '<div><span class="tk">'+r.ticker+'</span> <span class="nm">'+r.name+'</span><div class="meta">'+r.sector+' · '+r.industry+' · '+r.country+'</div></div>';
    const score = activeTab==='QC' ? r.qcScore : (activeTab==='HG' ? r.hgScore : Math.max(r.hgScore||0, r.qcScore||0));
    // Audit-signal mini-badges. Color: green for healthy, red for fail, mute for n/a.
    const sigBadges = [];
    if (r.dqGrade) {
      const dqColor = r.dqGrade === 'A+' || r.dqGrade === 'A' ? 'var(--green)'
        : r.dqGrade === 'B' ? 'var(--text-1)'
        : r.dqGrade === 'C' ? 'var(--yellow)' : 'var(--red)';
      sigBadges.push('<span style="color:'+dqColor+';border:1px solid '+dqColor+';padding:1px 5px;font-size:10px">DQ:'+r.dqGrade+'</span>');
    }
    if (r.listingYears != null) {
      sigBadges.push('<span style="color:var(--text-1);border:1px solid var(--border);padding:1px 5px;font-size:10px">'+r.listingYears+'y data</span>');
    }
    if (r.qSpikeFail) sigBadges.push('<span style="color:var(--red);border:1px solid var(--red);padding:1px 5px;font-size:10px">Q-SPIKE</span>');
    if (r.lossMagFail) sigBadges.push('<span style="color:var(--red);border:1px solid var(--red);padding:1px 5px;font-size:10px">LOSS&gt;50%REV</span>');
    if (r.metricDivFail) sigBadges.push('<span style="color:var(--red);border:1px solid var(--red);padding:1px 5px;font-size:10px">METRIC-DIV</span>');
    if (r.gmaTrend === 'accelerating') sigBadges.push('<span style="color:var(--green);border:1px solid var(--green);padding:1px 5px;font-size:10px">GM↑</span>');
    if (r.omaTrend === 'accelerating') sigBadges.push('<span style="color:var(--green);border:1px solid var(--green);padding:1px 5px;font-size:10px">OpM↑</span>');
    if (r.revAccelDelta != null && r.revAccelDelta > 0) sigBadges.push('<span style="color:var(--green);border:1px solid var(--green);padding:1px 5px;font-size:10px">Rev-Accel +'+r.revAccelDelta.toFixed(0)+'pp</span>');
    html += '<div class="meta">Score: '+(score!=null?score.toFixed(0):'—')+' · <span class="pill '+r.state+'">'+r.state+'</span> · MCap '+fmtM(r.mcap)+'</div>';
    if (sigBadges.length) html += '<div class="meta" style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px;">'+sigBadges.join('')+'</div>';
    html += '<div class="right"><button id="prevC">← Prev</button><button id="closeM">✕ ESC</button><button id="nextC">Next →</button></div>';
    html += '</div>';

    // Section B: Key Metric cards
    html += '<div class="cards">';
    const yoyDelta = (a, b) => (a!=null && b!=null && b!==0) ? (((a/b)-1)*100).toFixed(1)+'%' : '—';
    const revPrev = r.annual.rev[1];
    html += '<div class="card"><div class="lbl">Revenue TTM</div><div class="v">'+fmtM(r.revenueTTM)+'</div><div class="sub">YoY '+(r.growth!=null?r.growth.toFixed(1)+'%':'—')+'</div></div>';
    html += '<div class="card"><div class="lbl">Rev Growth YoY</div><div class="v">'+(r.growth!=null?(r.growth>=0?'+':'')+r.growth.toFixed(1)+'%':'—')+'</div><div class="sub">—</div></div>';
    html += '<div class="card"><div class="lbl">Gross Margin</div><div class="v">'+(r.grossMargin!=null?r.grossMargin.toFixed(1)+'%':'—')+'</div><div class="sub">'+(r.gmaTrend?r.gmaTrend:'—')+(r.gmaChange!=null?' '+(r.gmaChange>=0?'+':'')+r.gmaChange.toFixed(1)+'pp':'')+'</div></div>';
    html += '<div class="card"><div class="lbl">Operating Margin</div><div class="v">'+(r.opMargin!=null?r.opMargin.toFixed(1)+'%':'—')+'</div><div class="sub">—</div></div>';
    html += '<div class="card"><div class="lbl">FCF Margin TTM</div><div class="v">'+(r.fcfMargin!=null?r.fcfMargin.toFixed(1)+'%':'—')+'</div><div class="sub">—</div></div>';
    html += '<div class="card"><div class="lbl">Rule of 40</div><div class="v '+(r.r40!=null?r40Class(r.r40):'')+'">'+(r.r40!=null?r.r40.toFixed(1):'—')+'</div><div class="sub">'+(r.growth!=null&&r.fcfMargin!=null?r.growth.toFixed(0)+' + '+r.fcfMargin.toFixed(0):'—')+'</div></div>';
    html += '</div>';

    // Section C: Sparklines (revenue bar, gross margin %, op margin %, fcf margin %)
    const gmSeries = r.annual.rev.map((rv,i)=>{ const g = r.annual.gp[i]; return (rv && g && rv>0) ? (g/rv*100) : null; });
    const omSeries = r.annual.rev.map((rv,i)=>{ const o = r.annual.opInc[i]; return (rv && o!=null && rv>0) ? (o/rv*100) : null; });
    const fmSeries = r.annual.rev.map((rv,i)=>{ const f = r.annual.fcf[i]; return (rv && f!=null && rv>0) ? (f/rv*100) : null; });
    html += '<h3 class="sec">Annual Trends</h3><div class="charts">';
    html += '<div class="chart"><div class="ct">Revenue ($)</div>'+spark(r.annual.rev, {bar:true, fmt:fmtM})+'</div>';
    html += '<div class="chart"><div class="ct">Gross Margin (%)</div>'+spark(gmSeries)+'</div>';
    html += '<div class="chart"><div class="ct">Operating Margin (%)</div>'+spark(omSeries)+'</div>';
    html += '<div class="chart"><div class="ct">FCF Margin (%)</div>'+spark(fmSeries)+'</div>';
    html += '</div>';

    // Section D: Score history (placeholder — no multi-snapshot history yet)
    html += '<h3 class="sec">Score</h3>';
    html += '<div style="font-family:var(--mono);font-size:12px;color:var(--text-1);">HG Score: '+(r.hgScore!=null?r.hgScore.toFixed(1):'—')+' ('+(r.hgTier||'—')+') &nbsp;·&nbsp; QC Score: '+(r.qcScore!=null?r.qcScore.toFixed(1):'—')+' ('+(r.qcTier||'—')+') &nbsp;·&nbsp; PB Score: '+(r.pbScore!=null?r.pbScore.toFixed(1):'—')+'</div>';
    html += '<div style="color:var(--text-2);font-size:10px;margin-top:4px;">Score history accumulates as daily snapshots are retained (single snapshot today).</div>';

    // Section E: Annual table
    html += '<h3 class="sec">Annual Financials</h3><div class="annual"><table><thead><tr><th class="fy" style="text-align:left;">FY</th><th>Revenue</th><th>RevGrowth</th><th>GrossM%</th><th>OpM%</th><th>FCFM%</th><th>NetIncM%</th></tr></thead><tbody>';
    for (let i=0;i<r.annual.rev.length;i++){
      const rv = r.annual.rev[i];
      const rvPrev = r.annual.rev[i+1];
      const grRow = (rv!=null && rvPrev!=null && rvPrev!==0) ? ((rv/rvPrev-1)*100) : null;
      const gpx = r.annual.gp[i];
      const opx = r.annual.opInc[i];
      const fcx = r.annual.fcf[i];
      const nix = r.annual.netIncome[i];
      const gmPct = (rv && gpx!=null && rv>0) ? gpx/rv*100 : null;
      const omPct = (rv && opx!=null && rv>0) ? opx/rv*100 : null;
      const fmPct = (rv && fcx!=null && rv>0) ? fcx/rv*100 : null;
      const niPct = (rv && nix!=null && rv>0) ? nix/rv*100 : null;
      const fy = 'Y-'+i;
      html += '<tr><td class="fy">'+fy+'</td><td>'+fmtM(rv)+'</td><td>'+(grRow!=null?(grRow>=0?'+':'')+grRow.toFixed(0)+'%':'—')+'</td><td>'+(gmPct!=null?gmPct.toFixed(1)+'%':'—')+'</td><td>'+(omPct!=null?omPct.toFixed(1)+'%':'—')+'</td><td>'+(fmPct!=null?fmPct.toFixed(1)+'%':'—')+'</td><td>'+(niPct!=null?niPct.toFixed(1)+'%':'—')+'</td></tr>';
    }
    html += '</tbody></table></div>';

    // Section F: Full method scorecard
    html += '<h3 class="sec">Method Scorecard</h3><div class="scorecard"><table><tbody>';
    const methodIds = Object.keys(r.results).sort();
    for (const mid of methodIds) {
      const m = r.results[mid];
      const ic = !m.computable ? '⚪' : (m.pass ? '✅' : '❌');
      const cls = !m.computable ? 'na' : (m.pass ? 'ok' : 'fail');
      const val = m.value != null ? m.value : '—';
      html += '<tr><td>'+ic+'</td><td>'+mid+'</td><td class="'+cls+'" style="text-align:right">'+(typeof val === 'number' ? val.toFixed(2) : val)+'</td><td style="color:var(--text-2);">'+(m.reason||'')+'</td></tr>';
    }
    html += '</tbody></table></div>';

    c.innerHTML = html;
    m.classList.add('show');
    document.getElementById('closeM').onclick = closeModal;
    document.getElementById('prevC').onclick = () => navModal(-1);
    document.getElementById('nextC').onclick = () => navModal(1);
  }

  function closeModal(){
    document.getElementById('modal').classList.remove('show');
    window._modalTk = null;
  }
  function navModal(dir){
    if (!window._modalTk) return;
    const idx = currentList.findIndex(r => r.ticker === window._modalTk);
    if (idx < 0) return;
    const next = currentList[idx+dir];
    if (next) showModal(next.ticker);
  }

  // ------- search -------
  const searchInput = document.getElementById('search');
  const searchResults = document.getElementById('searchResults');
  function runSearch(q){
    if (!q || q.length < 1) { searchResults.classList.remove('show'); return; }
    const ql = q.toLowerCase();
    const hits = [];
    const all = Object.values(ROWS);
    for (const r of all) {
      if (r.ticker.toLowerCase().includes(ql) || r.name.toLowerCase().includes(ql)) {
        hits.push(r);
        if (hits.length >= 30) break;
      }
    }
    let html = '';
    for (const h of hits) {
      const badge = h.hgClass && (h.hgClass.startsWith('REAL_HYPERGROWTH')) ? 'HG' :
                    (h.qcTier && h.qcTier !== 'REJECT' ? 'QC' : '');
      html += '<div class="sr" data-tk="'+h.ticker+'"><strong>'+h.ticker+'</strong> '+h.name+(badge?'<span class="badge">'+badge+'</span>':'')+' <span class="badge">'+(h.hgScore!=null?'HG '+h.hgScore.toFixed(0):'')+(h.qcScore!=null?(h.hgScore!=null?' / ':'')+'QC '+h.qcScore.toFixed(0):'')+'</span></div>';
    }
    searchResults.innerHTML = html || '<div class="sr">no results</div>';
    searchResults.classList.add('show');
  }
  searchInput.addEventListener('input', e => runSearch(e.target.value));
  searchResults.addEventListener('click', e => {
    const t = e.target.closest('.sr');
    if (t && t.dataset.tk) { searchResults.classList.remove('show'); searchInput.value=''; showModal(t.dataset.tk); }
  });

  // ------- event wiring -------
  document.querySelectorAll('.tabs button').forEach(b => {
    b.onclick = () => {
      activeTab = b.dataset.tab;
      page = 1;
      // Tag 199 fix: reset tab-specific Min input on tab switch — the prior
      // value belonged to a different metric (e.g. min-R40 for HG vs min-Growth
      // for SMALL) and would silently kill the new tab's row count.
      filterMin = '';
      const fMinEl = document.getElementById('fMin');
      if (fMinEl) fMinEl.value = '';
      document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderTable();
    };
  });
  document.querySelectorAll('.filters .f-state').forEach(b => {
    b.onclick = () => {
      filterState[b.dataset.state] = !filterState[b.dataset.state];
      b.classList.toggle('on', filterState[b.dataset.state]);
      page = 1; renderTable();
    };
  });
  document.querySelectorAll('.filters .f-cap').forEach(b => {
    b.onclick = () => {
      filterCap[b.dataset.cap] = !filterCap[b.dataset.cap];
      b.classList.toggle('on', filterCap[b.dataset.cap]);
      page = 1; renderTable();
    };
  });
  document.getElementById('fSector').onchange = e => { filterSector = e.target.value; page=1; renderTable(); };
  document.getElementById('fCountry').onchange = e => { filterCountry = e.target.value; page=1; renderTable(); };
  document.getElementById('fMinR40').oninput = e => { filterMinR40 = e.target.value; page=1; renderTable(); };
  document.getElementById('fMaxR40').oninput = e => { filterMaxR40 = e.target.value; page=1; renderTable(); };
  document.getElementById('fMin').oninput = e => { filterMin = e.target.value; page=1; renderTable(); };
  // Tag 199: new audit filters
  document.querySelectorAll('.filters .f-ipo').forEach(b => {
    b.onclick = () => {
      filterIpo = b.dataset.ipo;
      document.querySelectorAll('.filters .f-ipo').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      page = 1; renderTable();
    };
  });
  document.querySelectorAll('.filters .f-dq').forEach(b => {
    b.onclick = () => {
      filterDQ[b.dataset.dq] = !filterDQ[b.dataset.dq];
      b.classList.toggle('on', filterDQ[b.dataset.dq]);
      page = 1; renderTable();
    };
  });
  const onlyGaapEl = document.getElementById('onlyGaap');
  const onlyFcfEl = document.getElementById('onlyFcf');
  onlyGaapEl.onchange = e => { onlyGaap = e.target.checked; page=1; renderTable(); };
  onlyFcfEl.onchange = e => { onlyFcf = e.target.checked; page=1; renderTable(); };
  document.getElementById('fSort').onchange = e => { sortKey = e.target.value; page=1; renderTable(); };
  document.getElementById('prevPage').onclick = () => { if (page>1) { page--; renderTable(); } };
  document.getElementById('nextPage').onclick = () => { page++; renderTable(); };
  document.getElementById('table').addEventListener('click', e => {
    const tr = e.target.closest('tr.row');
    if (tr && tr.dataset.tk) showModal(tr.dataset.tk);
  });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== searchInput) { e.preventDefault(); searchInput.focus(); }
    if (e.key === 'Escape') {
      if (searchResults.classList.contains('show')) { searchResults.classList.remove('show'); searchInput.value=''; }
      else if (document.getElementById('modal').classList.contains('show')) closeModal();
    }
    if (document.getElementById('modal').classList.contains('show')) {
      if (e.key === 'ArrowLeft') navModal(-1);
      if (e.key === 'ArrowRight') navModal(1);
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('header')) searchResults.classList.remove('show');
  });

  renderTable();
})();
`;

function renderHTML(rows, tabs, sectors, countries, generatedAt) {
  // Only ship rows that appear in at least one tab. Non-tabbed stocks can't be
  // searched anyway (skill says "search across ALL tabs"), so dropping them
  // cuts the embedded JSON dramatically (3500 stocks → typically <1000 tabbed).
  const tabbedTickers = new Set();
  for (const tab of Object.keys(tabs)) {
    for (const r of tabs[tab]) tabbedTickers.add(r.ticker);
  }
  const rowsByTicker = {};
  for (const r of rows) {
    if (tabbedTickers.has(r.ticker)) rowsByTicker[r.ticker] = r;
  }
  // tabs[tab] contains references — JSON.stringify deep-clones, so each tabbed
  // stock appears twice (once in rowsByTicker, once in its tab array(s)).
  // Trade visibility for size: rebuild tabs as ticker-only lists, look up the
  // full row from rowsByTicker on the client.
  const tabsByTicker = {};
  for (const tab of Object.keys(tabs)) tabsByTicker[tab] = tabs[tab].map(r => r.ticker);

  const payload = {
    generatedAt,
    currentYear: new Date().getUTCFullYear(),
    rowsByTicker,
    tabs: tabsByTicker,
    sectors, countries
  };

  // </script>-break-out guard — escape forward slash in any embedded "</"
  // sequence so a malformed company name can't terminate the data block.
  const json = JSON.stringify(payload).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Screener — Bloomberg View</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <span class="brand">◆ SCREENER</span>
  <div class="search" style="position:relative;">
    <input id="search" type="text" placeholder="/ Search ticker or company..." />
    <div id="searchResults" class="search-results"></div>
  </div>
</header>
<div class="tabs">
  <button data-tab="HG" class="active">⚡ Hypergrowth</button>
  <button data-tab="QC">🏛 Quality-Compounder</button>
  <button data-tab="SMALL">📈 Small Cap</button>
  <button data-tab="R40">📊 Rule of 40</button>
  <button data-tab="PRE_BREAKOUT">🎯 Pre-Breakout</button>
  <button data-tab="WATCH">👁 Watch</button>
</div>
<div class="filters">
  <span class="group"><span class="label">State:</span>
    <button class="f f-state on" data-state="LOSS">LOSS</button>
    <button class="f f-state on" data-state="TURNAROUND">TURN</button>
    <button class="f f-state on" data-state="RECENT">RECENT</button>
    <button class="f f-state on" data-state="STABLE">STABLE</button>
    <button class="f f-state on" data-state="NA">N/A</button>
  </span>
  <span class="group"><span class="label">Cap:</span>
    <button class="f f-cap on" data-cap="MICRO">Micro</button>
    <button class="f f-cap on" data-cap="SMALL">Small</button>
    <button class="f f-cap on" data-cap="MID">Mid</button>
    <button class="f f-cap on" data-cap="LARGE">Large</button>
    <button class="f f-cap on" data-cap="MEGA">Mega</button>
  </span>
  <span class="group"><span class="label">Sector:</span>
    <select id="fSector"><option value="">All</option>${sectors.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('')}</select>
  </span>
  <span class="group"><span class="label">Country:</span>
    <select id="fCountry"><option value="">All</option>${countries.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')}</select>
  </span>
  <span class="group"><span class="label">R40:</span><input id="fMinR40" type="number" step="1" placeholder="min" style="width:50px"/><input id="fMaxR40" type="number" step="1" placeholder="max" style="width:50px"/></span>
  <span class="group"><span class="label">Tab Min:</span><input id="fMin" type="number" step="1" placeholder="—"/></span>
  <span class="group"><span class="label">IPO:</span>
    <button class="f f-ipo on" data-ipo="ALL">All</button>
    <button class="f f-ipo" data-ipo="LT1">&lt;1y</button>
    <button class="f f-ipo" data-ipo="LT2">&lt;2y</button>
    <button class="f f-ipo" data-ipo="LT5">&lt;5y</button>
    <button class="f f-ipo" data-ipo="GT5">≥5y</button>
  </span>
  <span class="group"><span class="label">Grade:</span>
    <button class="f f-dq on" data-dq="A+">A+</button>
    <button class="f f-dq on" data-dq="A">A</button>
    <button class="f f-dq on" data-dq="B">B</button>
    <button class="f f-dq"    data-dq="C">C</button>
    <button class="f f-dq"    data-dq="D">D</button>
  </span>
  <span class="group"><label style="color:var(--text-1);font-size:11px;cursor:pointer;"><input id="onlyGaap" type="checkbox"/> GAAP+</label></span>
  <span class="group"><label style="color:var(--text-1);font-size:11px;cursor:pointer;"><input id="onlyFcf" type="checkbox"/> FCF+</label></span>
  <span class="group"><span class="label">Sort:</span>
    <select id="fSort">
      <option value="auto">Auto (tab default)</option>
      <option value="score">Score</option>
      <option value="r40">Rule of 40</option>
      <option value="growth">Rev Growth</option>
      <option value="fcfMargin">FCF Margin</option>
      <option value="mcap">Market Cap</option>
      <option value="pbScore">PB-Score</option>
    </select>
  </span>
</div>
<div class="summary" id="summary"></div>
<div id="explainer" style="padding:8px 16px;background:var(--bg-1);border-bottom:1px solid var(--border);color:var(--text-1);font-size:12px;display:none;"></div>
<div class="table-wrap"><div id="table"></div></div>
<div class="pagination">
  <button id="prevPage">← Prev</button>
  <span id="pageInfo">Page 1 of 1</span>
  <button id="nextPage">Next →</button>
</div>
<div id="modal" class="modal"><div class="modal-content" id="modalContent"></div></div>
<script>window.SCREENER_DATA = ${json};</script>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}

function main() {
  const args = parseArgs(process.argv);
  console.log('[screener] loading snapshots from ' + args.snapshots);
  const stocks = loadStocks(args.snapshots);
  console.log('[screener] loaded ' + stocks.length + ' stocks');

  const rows = [];
  for (const s of stocks) {
    try {
      const r = buildRow(s);
      if (r) rows.push(r);
    } catch (e) {
      // Tag 198: swallow per-stock errors so one bad snapshot doesn't kill the build.
      const tk = (s && s.meta && s.meta.ticker) || '???';
      console.warn('[screener] skip ' + tk + ': ' + e.message);
    }
  }
  console.log('[screener] built ' + rows.length + ' rows');

  const tabs = classifyTabs(rows);
  for (const t of Object.keys(tabs)) console.log('[screener] tab ' + t + ': ' + tabs[t].length);

  const sectorSet = new Set();
  const countrySet = new Set();
  for (const r of rows) {
    if (r.sector && r.sector !== '—') sectorSet.add(r.sector);
    if (r.country && r.country !== '—') countrySet.add(r.country);
  }
  const sectors = Array.from(sectorSet).sort();
  const countries = Array.from(countrySet).sort();

  const generatedAt = new Date().toISOString().slice(0, 10);
  const html = renderHTML(rows, tabs, sectors, countries, generatedAt);
  fs.writeFileSync(args.out, html);
  console.log('[screener] wrote ' + args.out + ' (' + (html.length/1024).toFixed(0) + ' KB)');
}

if (require.main === module) main();

module.exports = { buildRow, classifyTabs, renderHTML };
