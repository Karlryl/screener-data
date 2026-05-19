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

// Tag 232c-11 (audit F-PF-003 HIGH): async batched-concurrency snapshot read.
// Pre-fix: serial fs.readFileSync over 3-15k+ files added 2-3 minutes per
// generator run. snapshot-methods-history + detect-changes already used async
// batches; modes/screener generators hadn't. 32-way concurrency scales total
// wall-time with ~1/32 of files; sequential batching keeps memory bounded.
async function loadStocks(dir) {
  if (!fs.existsSync(dir)) return [];
  // Tag 220 (audit F-GR-002 HIGH): exclude all '_*' files (was just _manifest).
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const CONCURRENCY = 32;
  const out = [];
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const parsed = await Promise.all(batch.map(async (f) => {
      try {
        const content = await fs.promises.readFile(path.join(dir, f), 'utf8');
        return JSON.parse(content);
      } catch (e) { return null; }
    }));
    for (const s of parsed) {
      if (s !== null && typeof s === 'object' && !Array.isArray(s)) out.push(s);
    }
  }
  return out;
}

// Tag 232b-2: module-level country flag + continent maps. Defined here (above
// CLIENT_JS at line ~858) so the browser-side template can interpolate them via
// ${JSON.stringify(...)}. Yahoo emits a mix of ISO codes (US/JP/DE), full names
// ("USA"), and city/region tokens ("Dubai" / "Saudi" / "São Paulo" / "YHD" — the
// last is an unknown placeholder). Best-effort mapping; unmapped codes get no
// flag prefix and fail the continent filter (excluded when filter is set).
const COUNTRY_FLAGS = {
  US:'🇺🇸', USA:'🇺🇸', JP:'🇯🇵', CN:'🇨🇳', HK:'🇭🇰', TW:'🇹🇼', KR:'🇰🇷', IN:'🇮🇳',
  SG:'🇸🇬', TH:'🇹🇭', ID:'🇮🇩', MY:'🇲🇾',
  DE:'🇩🇪', UK:'🇬🇧', FR:'🇫🇷', IT:'🇮🇹', ES:'🇪🇸', NL:'🇳🇱', CH:'🇨🇭', SE:'🇸🇪',
  NO:'🇳🇴', DK:'🇩🇰', FI:'🇫🇮', IE:'🇮🇪', AT:'🇦🇹', BE:'🇧🇪', PT:'🇵🇹', GR:'🇬🇷',
  PL:'🇵🇱',
  CA:'🇨🇦', MX:'🇲🇽',
  AU:'🇦🇺', NZ:'🇳🇿',
  'São Paulo':'🇧🇷', Saudi:'🇸🇦', Dubai:'🇦🇪'
};
// Tag 232b-5: inline-embed the Twemoji Country Flags font. The b-4 attempt
// loaded it from jsdelivr CDN, but Karl reported flags still didn't render
// — likely the CDN-load failed for him (file:// origin / offline / corp
// proxy / fast page-render that beat the lazy font fetch). Inlining the
// ~78KB woff2 as a data: URI guarantees the font is available at the
// moment the popover opens. Adds ~104KB to screener.html (already ~24MB
// — negligible). File at assets/TwemojiCountryFlags.woff2 is the same
// content jsdelivr serves; if missing, falls back to "no flag font"
// (regional indicators degrade to ISO letter pairs, which is what Karl
// already sees — no worse than the b-4 state).
const TWEMOJI_FLAGS_B64 = (() => {
  try {
    const buf = require('fs').readFileSync(
      require('path').join(__dirname, 'assets', 'TwemojiCountryFlags.woff2')
    );
    return buf.toString('base64');
  } catch (e) {
    console.warn('[screener] assets/TwemojiCountryFlags.woff2 missing — flags will fall back to OS emoji font');
    return '';
  }
})();

const COUNTRY_TO_CONTINENT = {
  US:'Americas', USA:'Americas', CA:'Americas', MX:'Americas', 'São Paulo':'Americas',
  UK:'Europe', DE:'Europe', FR:'Europe', IT:'Europe', ES:'Europe', NL:'Europe', CH:'Europe',
  SE:'Europe', NO:'Europe', DK:'Europe', FI:'Europe', IE:'Europe', AT:'Europe', BE:'Europe',
  PT:'Europe', GR:'Europe', PL:'Europe',
  JP:'Asia', CN:'Asia', HK:'Asia', TW:'Asia', KR:'Asia', IN:'Asia', SG:'Asia', TH:'Asia',
  ID:'Asia', MY:'Asia', Saudi:'Asia', Dubai:'Asia',
  AU:'Oceania', NZ:'Oceania'
};

// Tag 203: Score-History reader. Memoised per-process so the dashboard build
// only touches the filesystem once per ticker even though buildRow() is called
// in a loop. Returns null if score-history is unavailable (first run, missing
// dir, parse error) — callers must tolerate null.
const SCORE_HISTORY_DIR = './score-history';
const _scoreHistoryCache = new Map();
function readScoreHistory(ticker, dir) {
  const base = dir || SCORE_HISTORY_DIR;
  const cacheKey = base + '::' + ticker;
  if (_scoreHistoryCache.has(cacheKey)) return _scoreHistoryCache.get(cacheKey);
  let result = null;
  try {
    const file = path.join(base, ticker + '.json');
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && Array.isArray(parsed.entries)) {
        result = parsed;
      }
    }
  } catch (e) { /* swallow — null = "no history available" */ }
  _scoreHistoryCache.set(cacheKey, result);
  return result;
}

// findEntryAtOrBefore: returns the most recent entry whose date is
// on-or-before `targetIso`. Tolerates weekends/holidays/missed pulls per
// design §5. Returns null if no entry that old exists.
function findEntryAtOrBefore(entries, targetIso) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  let best = null;
  for (const e of entries) {
    if (!e || !e.date) continue;
    if (e.date <= targetIso) {
      if (best == null || e.date > best.date) best = e;
    }
  }
  return best;
}

// ISO date - N days (UTC-safe).
function _isoMinusDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Compute { deltaScore7d, deltaScore30d, history } from a parsed history file.
// Score basis is hgScore (matches Section D's primary axis). If hgScore is
// null on either side of the delta, the delta returns null (renders as "—").
function _buildScoreHistoryPayload(history, todayIso) {
  if (!history || !Array.isArray(history.entries) || history.entries.length === 0) {
    return { deltaScore7d: null, deltaScore30d: null, history: [] };
  }
  const today = findEntryAtOrBefore(history.entries, todayIso);
  const hgToday = today && Number.isFinite(today.hgScore) ? today.hgScore : null;
  const e7  = findEntryAtOrBefore(history.entries, _isoMinusDays(todayIso, 7));
  const e30 = findEntryAtOrBefore(history.entries, _isoMinusDays(todayIso, 30));
  // Don't compare an entry to itself — only emit a delta if the prior point
  // is older than today's entry.
  const prior7  = (e7  && today && e7.date  !== today.date) ? e7  : null;
  const prior30 = (e30 && today && e30.date !== today.date) ? e30 : null;
  const d7 = (hgToday != null && prior7  && Number.isFinite(prior7.hgScore))  ? hgToday - prior7.hgScore  : null;
  const d30 = (hgToday != null && prior30 && Number.isFinite(prior30.hgScore)) ? hgToday - prior30.hgScore : null;
  // Trim to last 30 entries for sparkline rendering — array is already sorted
  // ascending by the snapshot script.
  const trimmed = history.entries.slice(-30);
  return { deltaScore7d: d7, deltaScore30d: d30, history: trimmed };
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
  // Tag 232g: Buffett mode (14-point composite + Owner-Earnings + DCF MoS).
  // bfScore is the score-aggregator output; bfPassed is true only when all 3
  // MUST methods pass — Buffett mode is intentionally strict (10y history,
  // DCF MoS ≥ 25%, ALL_OF on the 14-point composite). Most stocks score
  // partially but bfPassed=false because they fail the MoS hard-gate.
  const bfScore = modeEvals.BUFFETT && Number.isFinite(modeEvals.BUFFETT.score) ? modeEvals.BUFFETT.score : null;
  const bfTier = modeEvals.BUFFETT ? modeEvals.BUFFETT.tier : null;
  const bfPassed = modeEvals.BUFFETT ? !!modeEvals.BUFFETT.passed : false;

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
  // Tag 202: closed-end-trust pattern (industry + Rev/Assets + neg-rev signals).
  // Catches SMT.L / HICL.L style trust noise (fair-value swings reported as
  // "revenue" inflate Rule-of-40 to 1000%+). BRK-B passes by design — see
  // anchor analysis in methods/closed-end-trust-guard.js header.
  const cetGuard = allResults['closed-end-trust-guard'];
  const cetFail  = !!(cetGuard && cetGuard.computable && cetGuard.pass === false);
  // Tag 205: R40-sanity-cap — filters R40-poisoning input artifacts:
  //   F1 revGrowth>150% AND OpInc<0 (ONDS/BEAM Q-spike pattern, CRDO-safe carve-out)
  //   F2 fcfMargin>80% (one-time event tell, no anchor exceeds 50%)
  //   F3 |OpM-FCFM|>50pp (R&D-capex phantom FCF, biotech pattern)
  // Pattern-based, all anchors verified PASS — see methods/r40-sanity-cap.js header.
  const r40Sanity = allResults['r40-sanity-cap'];
  const r40SanityFail = !!(r40Sanity && r40Sanity.computable && r40Sanity.pass === false);
  // Tag 206g (Bug-Hunt Agent E HIGH-1): revenue-shock-guard was registered as
  // DATAGUARD since Tag 98b but never wired into the row-level hardGated chain.
  // Its pass=false signaled silently — any robust-outlier-detected Q-revenue
  // stock slipped through HG/QC/SMALL/R40/PRE-BREAKOUT and only got caught
  // when mode-eval's dataGuards[] happened to include it (HYPERGROWTH only).
  // Wire it here so all 6 tabs honor the dataguard.
  const revShock = allResults['revenue-shock-guard'];
  const revShockFail = !!(revShock && revShock.computable && revShock.pass === false);
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

  // Tag 203: Score-history (sliding 30-entry window from snapshot-score-history.js).
  // Drives Section D's ΔScore badges + sparkline. Null on first run / when the
  // file is missing — client renders "—" gracefully (design §6 migration path).
  const todayIso = new Date().toISOString().slice(0, 10);
  const histRaw = readScoreHistory(ticker);
  const scoreHistory = _buildScoreHistoryPayload(histRaw, todayIso);

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
    bfScore, bfTier, bfPassed,
    pbScore,
    gmaTrend, gmaChange,
    omaTrend, omaChange,
    revAccelDelta,
    // Tag 199/200/205 audit gates
    qSpikeFail, lossMagFail, metricDivFail, niVolFail, preCommFail, cetFail, r40SanityFail, revShockFail, dqGrade, listingYears,
    gaapProfitable, fcfPositive,
    annual,
    scoreHistory,
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

// Tag 205: R40-sort penalty — pushes suspect rows down without removing them.
// Each component caps at a known max so total ≤ 1.0 (so r40 * (1-pen) ≥ 0).
// All anchors (NVDA/CRDO/ALAB/PLTR/MSFT) return 0 → sort unchanged for them.
function computeR40Penalty(r) {
  let pen = 0;
  // Data-quality grade D: max-out (already hard-gated, defensive belt-and-
  // suspenders in case a D-grade ever slips past). Grade C: half-weight.
  if (r.dqGrade === 'D') pen += 0.5;
  else if (r.dqGrade === 'C') pen += 0.25;
  // Margin divergence: OpM vs FCFM > 30pp = phantom-FCF tell (R&D-capex
  // pattern in biotech, working-capital-release pattern in distress sales).
  // Anchors all run |OpM-FCFM| < 30pp → 0 contribution.
  if (Number.isFinite(r.opMargin) && Number.isFinite(r.fcfMargin)) {
    const div = Math.abs(r.opMargin - r.fcfMargin);
    if (div > 30) pen += Math.min(0.2, (div - 30) / 100);  // caps at +0.2 at div=50pp
  }
  // High growth (>150% YoY) AND not a real-hypergrowth class → likely
  // single-Q-spike survivor. Real-hypergrowth tags (set by hg-class) get a pass.
  if (Number.isFinite(r.growth) && r.growth > 150
      && r.hgClass !== 'REAL_HYPERGROWTH_ACCELERATING'
      && r.hgClass !== 'REAL_HYPERGROWTH_BUT_LOSSY') {
    pen += 0.3;
  }
  return Math.min(0.95, pen);  // cap at 0.95 — never zero-out a row entirely
}

function classifyTabs(rows) {
  const tabs = { HG: [], QC: [], BF: [], SMALL: [], R40: [], PRE_BREAKOUT: [], WATCH: [] };

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
    //
    // Tag 203 (Q_SPIKE_FAKE escape): hypergrowth-quality-class' Q_SPIKE_FAKE
    // verdict is now a hard-gate co-signal. q-spike-dataguard only fires when
    // YoY>100% AND single-Q-share>55%; that leaves a dead-zone (e.g. 300033.SZ
    // — YoY 40%, single-Q 49% — classified Q_SPIKE_FAKE by HG-class but slipping
    // into QC). Using the existing classifier output costs nothing extra and
    // closes the gap without new thresholds. Anchor safety verified: all anchors
    // (NVDA/MSFT/PLTR/ALAB/CRDO) have spikeShare < 45%, so the isSpikeConc gate
    // in hypergrowth-quality-class never triggers Q_SPIKE_FAKE for them.
    const hgClassFail = r.hgClass === 'Q_SPIKE_FAKE';
    // Tag 206g: revShockFail added to hardGated chain (Agent E HIGH-1).
    const hardGated = r.qSpikeFail || r.lossMagFail || r.metricDivFail || r.niVolFail || r.preCommFail || r.cetFail || r.r40SanityFail || r.revShockFail || r.dqGrade === 'D' || hgClassFail;

    if (hardGated) {
      // WATCH-only entry: surface them with the reason for review, but block
      // promotion to HG/QC/SMALL/R40/PRE_BREAKOUT.
      const reasons = [];
      if (r.qSpikeFail) reasons.push('Q-SPIKE');
      if (r.lossMagFail) reasons.push('LOSS>50%REV');
      if (r.metricDivFail) reasons.push('METRIC-DIV');
      if (r.niVolFail) reasons.push('NI-VOL');
      if (r.preCommFail) reasons.push('PRE-COMM-MEGACAP');
      if (r.cetFail) reasons.push('CLOSED-END-TRUST');
      if (r.r40SanityFail) reasons.push('R40-SANITY');
      if (r.revShockFail) reasons.push('REV-SHOCK');
      if (r.dqGrade === 'D') reasons.push('DATA-D');
      if (hgClassFail) reasons.push('Q-SPIKE-FAKE');
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
    // QC: tier !== REJECT, score available, ≥3y history, grade ≥ B,
    //     AND non-shrinking revenue (Tag 201d — Agent 1 found NHY.OL/BAH/
    //     PNDORA.CO leaking into QC despite negative growth).
    //     A "quality compounder" by definition compounds; -3% growth means
    //     mature/declining, which belongs in WATCH or a future "DIVIDEND"
    //     tab — not a QC list. Threshold 0% (not 5%): we still admit flat-
    //     growth fortresses (regulated utilities-style stable-share-buyer
    //     compounders like AZO sometimes print 1-2% growth in down years).
    //     Stocks with null growth (data gap) stay eligible — better to
    //     show with a missing-data flag than silently exclude.
    const qcGrowthFloorOK = (r.growth == null) || (r.growth >= 0);
    if (Number.isFinite(r.qcScore) && r.qcTier && r.qcTier !== 'REJECT'
        && qcEligibleByAge && !dqBlockedFromQuality && qcGrowthFloorOK) {
      tabs.QC.push(r);
    }
    // Tag 232g: BUFFETT tab — value-compounder filter (14-point composite +
    // Owner-Earnings + DCF MoS ≥ 25% hard-gate). The BUFFETT strategy-mode
    // already enforces sector-exclusion, dataGuards (sloan-ratio,
    // forecast-contamination-guard), and 10y-history floor via T1/T6/T10.
    // Show every stock with a computable bfScore + tier !== REJECT so users
    // can see partial-pass candidates (e.g. 9/14 tests pass but MoS missing
    // → still informative). The bfPassed badge marks the strict winners.
    // dqBlockedFromQuality reused: grade C blocks here too — Buffett requires
    // pristine accounting.
    if (Number.isFinite(r.bfScore) && r.bfTier && r.bfTier !== 'REJECT' && !dqBlockedFromQuality) {
      tabs.BF.push(r);
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
    // WATCH: NEAR_MISS tier in HG, QC, or BUFFETT
    if (r.hgTier === 'NEAR_MISS' || r.qcTier === 'NEAR_MISS' || r.bfTier === 'NEAR_MISS') {
      tabs.WATCH.push(r);
    }
  }

  // Sorting per tab
  tabs.HG.sort((a, b) => (b.hgScore || 0) - (a.hgScore || 0));
  tabs.QC.sort((a, b) => (b.qcScore || 0) - (a.qcScore || 0));
  // Tag 232g: BUFFETT — passed=true rows always sort above passed=false (rare
  // strict winners first), then ties broken by bfScore desc.
  tabs.BF.sort((a, b) => {
    const ap = a.bfPassed ? 1 : 0;
    const bp = b.bfPassed ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (b.bfScore || 0) - (a.bfScore || 0);
  });
  tabs.SMALL.sort((a, b) => (b.growth || 0) - (a.growth || 0));
  // Tag 205 R40-poisoning defense (penalized sort): hard-gates already filter
  // qSpikeFail / lossMagFail / r40SanityFail / etc., but edge-case survivors
  // (e.g. -growth + ultra-high one-time FCF margin, large margin-divergence
  // without crossing METRIC-DIV threshold) can still poison the top of R40.
  // We multiply r40 by (1 - penalty) so reliable stocks (penalty=0) sort by
  // raw r40 unchanged, while suspect-but-not-gated stocks get pushed down.
  // Anchor safety: NVDA/CRDO/ALAB/PLTR/MSFT all carry dqGrade=A+, no q-spike,
  // and |opMargin - fcfMargin| < 30pp → penalty=0 → sort identical for them.
  // Tag 206g (Bug-Hunt Agent E HIGH-4): the original multiplicative penalty
  // `r40 * (1 - pen)` sign-flips for negative r40 values: a deep-loss SaaS
  // with r40 = -50 and pen = 0.2 gets effective = -40, which sorts ABOVE
  // its raw -50 — penalty incorrectly improves rank. Switch to subtractive
  // penalty: effective_r40 = r40 - 100 * pen. Penalty always pushes down
  // regardless of r40 sign. Anchors (pen=0) sort identically.
  tabs.R40.sort((a, b) => {
    const aPen = computeR40Penalty(a);
    const bPen = computeR40Penalty(b);
    const bEff = (b.r40 == null ? -Infinity : b.r40) - 100 * bPen;
    const aEff = (a.r40 == null ? -Infinity : a.r40) - 100 * aPen;
    return bEff - aEff;
  });
  tabs.PRE_BREAKOUT.sort((a, b) => (b.pbScore || 0) - (a.pbScore || 0));
  tabs.WATCH.sort((a, b) => Math.max(b.hgScore || 0, b.qcScore || 0, b.bfScore || 0) - Math.max(a.hgScore || 0, a.qcScore || 0, a.bfScore || 0));

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
  /* Tag 232b-4: 'Twemoji Country Flags' is loaded via @font-face below (unicode-
     range scoped to regional indicators only). Listed FIRST so flag glyphs
     resolve to it regardless of the rest of the chain — text glyphs fall
     through to Segoe UI / Apple system / Roboto as before. Solves the
     "flags don't render in Chromium on Windows" problem that the b-3
     font-family-only fix couldn't fully address (Segoe UI Emoji does
     ship flag glyphs since Win11 Fluent rollout but Chromium often
     ignores font-family for native <option> elements — the b-4 country
     popover replaces <select> with a div-based grid so font-family wins). */
  --ui:'Twemoji Country Flags',-apple-system,'Segoe UI','Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji','Twemoji Mozilla',Roboto,system-ui,sans-serif;
  /* Tag 211g spacing scale (4/8/12/16/24) — use these vars in new code rather
     than hard-coded px values. Existing inline values left alone except for
     the most visible offenders. */
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-6:24px;
}
/* Tag 232b-5: Twemoji Country Flags font, inlined as base64 data URI.
   b-4 used a jsdelivr CDN URL but Karl's browser fell back to ISO-letter
   pairs anyway — likely the CDN-load lost the race against page render,
   or file:// origin / corp proxy / offline mode broke the fetch. Inline
   removes the network dependency entirely. unicode-range scopes the
   font to regional indicator code-points only, so text rendering is
   unaffected. */
@font-face {
  font-family: 'Twemoji Country Flags';
  unicode-range: U+1F1E6-1F1FF, U+1F3F4, U+E0062-E007F;
  src: url('data:font/woff2;base64,${TWEMOJI_FLAGS_B64}') format('woff2');
  font-display: block;
}
/* Country popover: 4-column grid of country chips for fast multi-select
   without scrolling through 35+ options vertically. Reuses .col-popover
   chrome but overrides the body to grid layout. */
.ctry-popover { min-width:300px; max-width:520px; }
.ctry-popover .ctry-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:2px 6px; padding:6px 12px; }
.ctry-popover .ctry-grid label { display:flex; align-items:center; gap:4px; cursor:pointer; padding:3px 4px; font-family:var(--mono); font-size:11px; color:var(--text-0); transition:background 80ms ease-out; }
.ctry-popover .ctry-grid label:hover { background:var(--bg-hover); }
.ctry-popover .ctry-grid label input { margin:0; cursor:pointer; }
/* Tag 232b-5: explicit flag-capable font on .flag — the parent label uses
   var(--mono) which has NO flag glyphs, so regional indicator pairs fell
   back to the small ISO-letter-pair tags Karl saw. Twemoji Country Flags
   first (loaded via @font-face above, unicode-range scoped), then OS
   emoji fonts as fallback. The 'emoji' keyword at the end is a CSS
   generic font family that asks the browser for its emoji font of
   choice — last resort. */
.ctry-popover .ctry-grid .flag {
  font-family: 'Twemoji Country Flags', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', 'Twemoji Mozilla', emoji, sans-serif;
  font-size:14px; line-height:1;
}
* { box-sizing:border-box; }
/* Tag 211g: global tabular-nums for all mono text so percent/number columns
   align vertically regardless of digit width (1 vs 4 etc). Applies to the
   whole document — mono is used only for numerics + UI chrome (buttons,
   chips), both of which benefit. */
body { margin:0; background:var(--bg-0); color:var(--text-0); font-family:var(--ui); font-size:13px; -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; font-variant-numeric:tabular-nums; }
/* Tag 211g focus-visible polish — keyboard-only ring on EVERY interactive
   surface. Mouse clicks suppress it (focus-visible spec). Uses --blue with
   2px offset so it reads as an intentional Bloomberg cursor highlight. */
:focus-visible { outline:2px solid var(--blue); outline-offset:2px; }
button:focus-visible, select:focus-visible, input:focus-visible, [tabindex]:focus-visible, tr.peer-row:focus-visible, tr.row:focus-visible { outline:2px solid var(--blue); outline-offset:2px; }
/* Suppress legacy outlines that conflict with the new ring */
button:focus:not(:focus-visible) { outline:none; }
header { position:sticky; top:0; z-index:10; background:var(--bg-1); border-bottom:1px solid var(--border-bright); padding:10px 16px; display:flex; align-items:center; gap:16px; }
header .brand { font-weight:700; color:var(--blue); letter-spacing:0.08em; font-size:13px; }
header .search { flex:1; max-width:480px; }
header input { width:100%; background:var(--bg-2); border:1px solid var(--border); color:var(--text-0); padding:6px 10px; font-family:var(--mono); font-size:12px; outline:none; transition:border-color 100ms ease-out; }
header input:focus { border-color:var(--blue); }
.tabs { display:flex; gap:0; padding:0 16px; background:var(--bg-1); border-bottom:1px solid var(--border); }
.tabs button { background:transparent; border:none; color:var(--text-1); padding:10px 14px; font-family:var(--ui); font-size:12px; cursor:pointer; border-bottom:2px solid transparent; letter-spacing:0.05em; text-transform:uppercase; transition:background 100ms ease-out, color 100ms ease-out; }
.tabs button:hover { color:var(--text-0); background:var(--bg-hover); }
.tabs button.active { color:var(--blue); border-bottom-color:var(--blue); }
/* Tag 226c-3: tab-count badge — Bloomberg/Koyfin convention. Subtle muted
   "(N)" appended to each tab so the universe size is visible at a glance
   without entering the tab. Bumps tab info-density with one number per tab. */
.tabs button .tc { color:var(--text-2); font-family:var(--mono); font-size:10px; margin-left:6px; font-weight:400; letter-spacing:0; text-transform:none; font-variant-numeric:tabular-nums; }
.tabs button.active .tc { color:var(--blue); opacity:0.7; }
.filters { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:8px 16px; background:var(--bg-1); border-bottom:1px solid var(--border); font-size:11px; }
.filters .group { display:flex; gap:4px; align-items:center; }
.filters .label { color:var(--text-2); margin-right:4px; text-transform:uppercase; letter-spacing:0.05em; font-size:10px; }
.filters button.f { background:var(--bg-2); color:var(--text-1); border:1px solid var(--border); padding:3px 8px; font-family:var(--mono); font-size:11px; cursor:pointer; transition:background 100ms ease-out, color 100ms ease-out, border-color 100ms ease-out; }
.filters button.f:hover { color:var(--text-0); border-color:var(--border-bright); }
.filters button.f.on { background:var(--bg-hover); color:var(--text-0); border-color:var(--border-bright); }
.filters select { background:var(--bg-2); color:var(--text-0); border:1px solid var(--border); padding:3px 6px; font-family:var(--ui); font-size:11px; transition:border-color 100ms ease-out; }
.filters select:hover { border-color:var(--border-bright); }
.filters input[type=number] { background:var(--bg-2); color:var(--text-0); border:1px solid var(--border); padding:3px 6px; font-family:var(--mono); font-size:11px; width:70px; transition:border-color 100ms ease-out; }
.filters input[type=number]:hover { border-color:var(--border-bright); }
.summary { padding:6px 16px; background:var(--bg-0); color:var(--text-1); font-size:11px; border-bottom:1px solid var(--border); font-family:var(--mono); }
.summary strong { color:var(--text-0); font-weight:600; }
/* Tag 223b: bound the table-wrap so position:sticky on thead actually pins
   headers as the user scrolls a long list. Falls back to natural body scroll
   on mobile (overflow visible) so iOS momentum scrolling stays smooth. */
.table-wrap { overflow:auto; max-height:calc(100vh - 220px); }
table.dt { width:100%; border-collapse:collapse; font-size:12px; }
/* Tag 223b: sortable column header polish (click to sort). aria-sort gets a
   subtle indicator caret so screen readers and sighted users agree on which
   column is the active sort axis. Headers are sticky (top:0) inside the
   .table-wrap scroll container; z-index 5 keeps them above tinted row
   backgrounds but below the page header (z-index 10). */
table.dt th { background:var(--bg-1); color:var(--text-1); text-align:left; padding:8px 12px; border-bottom:1px solid var(--border-bright); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; position:sticky; top:0; z-index:5; font-family:var(--ui); }
table.dt th.sortable { cursor:pointer; user-select:none; }
table.dt th.sortable:hover { color:var(--text-0); background:var(--bg-hover); }
table.dt th[aria-sort="ascending"]::after  { content:" \\25B2"; color:var(--blue); font-size:9px; }
table.dt th[aria-sort="descending"]::after { content:" \\25BC"; color:var(--blue); font-size:9px; }
/* Tag 223b: keyboard-active row (j/k navigation). Distinct from :hover so
   mouse and keyboard cursors can coexist without confusion. */
table.dt tr.row.kbd-active { background:var(--bg-hover); box-shadow:inset 3px 0 0 var(--blue); }
table.dt tr.row.kbd-active td:first-child { color:var(--blue); font-weight:700; }
table.dt td { padding:6px 12px; border-bottom:1px solid var(--border); font-family:var(--mono); font-weight:500; font-size:12px; }
table.dt tr.row { cursor:pointer; transition:background 80ms ease-out; }
table.dt tr.row:hover { background:var(--bg-hover); }
table.dt td.num { text-align:right; font-variant-numeric:tabular-nums; }
/* Tag 212c: inline percentile-rank bullet bar behind numeric cells.
   The .bar is absolutely positioned and z-index:0 so the number (.v)
   sits on top. opacity:0.18 keeps the chrome subtle in both themes.
   right:12px matches td padding so the fill stops short of the
   right-side breathing room and the number stays readable. */
table.dt td.num.bullet { position:relative; overflow:hidden; }
table.dt td.num.bullet .bar { position:absolute; left:0; top:0; bottom:0; right:12px; z-index:0; opacity:0.18; transition: width 120ms ease-out; pointer-events:none; }
table.dt td.num.bullet .v { position:relative; z-index:1; }
/* Tag 212d: Δ7d delta badge next to the per-row score sparkline.
   Tag 231b-1: each badge carries a leading ▲/▼/■ glyph as a colour-blind
   shape cue, so direction is encoded by shape AND colour (per WCAG 1.4.1).
   Glyph is injected via CSS ::before so the JS continues to write only the
   numeric delta + sign — no payload growth, deterministic per class. */
.d7 { margin-left:4px; font-size:10px; font-family:var(--mono); font-variant-numeric:tabular-nums; }
.d7::before { display:inline-block; margin-right:2px; font-size:9px; line-height:1; }
.d7.pos { color:var(--green); }
.d7.pos::before { content:"\\25B2"; }
.d7.neg { color:var(--red); }
.d7.neg::before { content:"\\25BC"; }
.d7.mute { color:var(--text-2); }
.d7.mute::before { content:"\\25A0"; opacity:0.6; }
/* Tag 231b-1: R40 tier colour-blind affordance — each tier gets a unique
   underline texture as a non-colour cue. Solid (excellent), dotted (good),
   wavy (fair/warn), thick (bad). Underlines are 1px so they don't shout in
   normal viewing but become a tier discriminator for red/green CB users.
   Numeric R40 values appear in 5 tiers across HG/QC/R40/SMALL tables. */
.g-r40-excellent { text-decoration:underline; text-decoration-thickness:1px; text-decoration-color:currentColor; text-underline-offset:2px; }
.g-r40-good      { text-decoration:underline dotted; text-decoration-thickness:1px; text-underline-offset:2px; }
.g-r40-fair      { text-decoration:underline dashed; text-decoration-thickness:1px; text-underline-offset:2px; }
.g-r40-warn      { text-decoration:underline dashed; text-decoration-thickness:1px; text-underline-offset:2px; text-decoration-color:currentColor; }
.g-r40-bad       { text-decoration:line-through; text-decoration-thickness:1px; }
table.dt td.ticker { color:var(--text-0); font-weight:600; }
table.dt td.name { font-family:var(--ui); color:var(--text-1); font-weight:400; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
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
/* Tag 226c-1: pagination bar pinned to viewport bottom on desktop so the
   Prev/Next controls stay reachable while scrolling a 50-row tab. Mobile
   keeps the natural flow (no sticky) to avoid eating ~10% of the touch
   viewport. z-index:6 sits above sticky thead (5) but below header (10). */
.pagination { padding:8px 16px; display:flex; justify-content:center; gap:12px; align-items:center; background:var(--bg-1); border-top:1px solid var(--border-bright); font-family:var(--mono); font-size:11px; position:sticky; bottom:0; z-index:6; box-shadow:0 -4px 12px rgba(0,0,0,0.25); }
.pagination button { background:var(--bg-2); color:var(--text-0); border:1px solid var(--border); padding:4px 12px; cursor:pointer; font-family:var(--mono); transition:border-color 100ms ease-out, color 100ms ease-out; }
.pagination button:hover:not(:disabled) { border-color:var(--border-bright); color:var(--blue); }
.pagination button:disabled { color:var(--text-2); cursor:default; }
.search-results { position:absolute; top:48px; left:50%; transform:translateX(-50%); width:480px; max-height:400px; overflow:auto; background:var(--bg-1); border:1px solid var(--border-bright); z-index:60; display:none; box-shadow:0 8px 24px rgba(0,0,0,0.45); }
.search-results.show { display:block; }
.search-results .sr { padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--border); font-size:12px; transition:background 80ms ease-out; }
.search-results .sr:hover { background:var(--bg-hover); }
.search-results .sr .badge { display:inline-block; margin-left:6px; padding:1px 5px; font-size:10px; font-family:var(--mono); border:1px solid var(--border); color:var(--text-1); }
.modal { position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:100; display:none; overflow:auto; opacity:0; transition:opacity 120ms ease-out; }
.modal.show { display:block; opacity:1; }
.modal-content { max-width:1100px; margin:24px auto; background:var(--bg-0); border:1px solid var(--border-bright); padding:24px; box-shadow:0 12px 48px rgba(0,0,0,0.5); }
.modal-header { display:flex; align-items:baseline; gap:16px; flex-wrap:wrap; padding-bottom:12px; border-bottom:1px solid var(--border); }
.modal-header .tk { font-size:24px; font-weight:700; color:var(--text-0); letter-spacing:0.02em; }
.modal-header .nm { font-size:14px; color:var(--text-1); font-weight:400; }
.modal-header .meta { color:var(--text-2); font-size:11px; font-family:var(--mono); }
.modal-header .right { margin-left:auto; display:flex; gap:8px; }
.modal-header button { background:var(--bg-2); color:var(--text-0); border:1px solid var(--border); padding:4px 10px; cursor:pointer; font-family:var(--mono); font-size:11px; transition:border-color 100ms ease-out, color 100ms ease-out; }
.modal-header button:hover { border-color:var(--border-bright); color:var(--blue); }
.cards { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:16px 0; }
.card { background:var(--bg-1); border:1px solid var(--border); padding:12px 16px; transition:border-color 120ms ease-out; }
.card:hover { border-color:var(--border-bright); }
.card .lbl { font-size:10px; color:var(--text-2); text-transform:uppercase; letter-spacing:0.08em; font-weight:500; }
.card .v { font-size:26px; font-family:var(--mono); font-weight:600; color:var(--text-0); margin-top:8px; letter-spacing:-0.02em; }
.card .sub { font-size:11px; color:var(--text-1); margin-top:4px; font-family:var(--mono); }
.charts { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; margin:16px 0; }
.chart { background:var(--bg-2); border:1px solid var(--border); padding:8px; transition:border-color 120ms ease-out; }
.chart:hover { border-color:var(--border-bright); }
.chart .ct { font-size:11px; color:var(--text-1); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px; }
.scorecard table { width:100%; border-collapse:collapse; font-size:11px; margin-top:8px; }
.scorecard td { padding:4px 8px; border-bottom:1px solid var(--border); font-family:var(--mono); }
.scorecard .ok { color:var(--green); }
.scorecard .fail { color:var(--red); }
.scorecard .na { color:var(--text-2); }
.annual table { width:100%; border-collapse:collapse; font-size:11px; }
.annual th { padding:6px 8px; background:var(--bg-1); border-bottom:1px solid var(--border-bright); text-align:right; font-family:var(--ui); font-weight:600; text-transform:uppercase; letter-spacing:0.05em; font-size:10px; color:var(--text-1); }
.annual td { padding:4px 8px; border-bottom:1px solid var(--border); font-family:var(--mono); text-align:right; }
.annual td.fy { text-align:left; color:var(--text-1); }
.annual tr.peer-row { transition:background 80ms ease-out; }
.annual tr.peer-row:hover { background:var(--bg-hover); }
h3.sec { color:var(--text-0); font-size:14px; font-weight:600; margin:24px 0 8px; padding-bottom:6px; border-bottom:1px solid var(--border); text-transform:uppercase; letter-spacing:0.08em; font-family:var(--ui); }
/* Tag 211g empty-state polish — used when a tab/table has no rows. */
.empty-state { padding:48px 16px; text-align:center; color:var(--text-2); font-style:italic; font-family:var(--ui); font-size:13px; }
.empty-state .dash { font-size:24px; color:var(--text-2); margin-bottom:8px; font-style:normal; }
/* Tag 209e — UI quick-wins (per Tag 208 research §2.2 / §4 / §5) */
/* Upgrade 1: active-filter breadcrumb chips */
#active-filters { padding:6px 16px; background:var(--bg-1); border-bottom:1px solid var(--border); display:none; flex-wrap:wrap; gap:6px; align-items:center; font-size:11px; }
#active-filters.show { display:flex; }
#active-filters .label { color:var(--text-2); font-size:10px; text-transform:uppercase; letter-spacing:0.05em; margin-right:4px; }
.chip { display:inline-flex; align-items:center; padding:2px 4px 2px 8px; background:var(--bg-2); border:1px solid var(--border-bright); color:var(--text-0); font-family:var(--mono); font-size:11px; transition:border-color 100ms ease-out; }
.chip:hover { border-color:var(--blue); }
.chip .x { display:inline-block; margin-left:6px; padding:0 5px; cursor:pointer; color:var(--text-2); border-left:1px solid var(--border); transition:color 100ms ease-out, background 100ms ease-out; }
.chip .x:hover { color:var(--red); background:var(--bg-hover); }
#active-filters .clear-all { color:var(--text-1); background:transparent; border:1px solid var(--border); padding:2px 8px; cursor:pointer; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.05em; transition:color 100ms ease-out, border-color 100ms ease-out; }
#active-filters .clear-all:hover { color:var(--red); border-color:var(--red); }
/* Upgrade 3: print button in header */
header button.print-btn { background:var(--bg-2); color:var(--text-1); border:1px solid var(--border); padding:6px 10px; cursor:pointer; font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:0.05em; transition:color 100ms ease-out, border-color 100ms ease-out; }
header button.print-btn:hover { color:var(--text-0); border-color:var(--border-bright); }
/* Tag 210f: light-theme toggle. Sits next to [print]; same button shape. */
header button.theme-btn { background:var(--bg-2); color:var(--text-1); border:1px solid var(--border); padding:6px 10px; cursor:pointer; font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:0.05em; transition:color 100ms ease-out, border-color 100ms ease-out; }
header button.theme-btn:hover { color:var(--text-0); border-color:var(--border-bright); }
/* Tag 231b-2: data-freshness chip in header. At-a-glance staleness signal —
   tinted by snapshot age computed client-side against the user's local date.
   Updated: same day | Stale: 1-6 days | Old: 7+ days. Same chrome as the
   print/theme buttons so it visually belongs in the header toolbar. */
header .data-freshness { background:var(--bg-2); color:var(--text-1); border:1px solid var(--border); padding:6px 10px; font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:0.05em; cursor:default; transition:color 120ms ease-out, border-color 120ms ease-out; }
header .data-freshness.fresh { color:var(--green); border-color:var(--green); }
header .data-freshness.stale { color:var(--yellow); border-color:var(--yellow); }
header .data-freshness.old   { color:var(--red); border-color:var(--red); }
/* Tag 210f: Light theme — daylight-readable palette (Stock Rover / Koyfin style).
   Greens/reds stay vivid (Karl's Bloomberg muscle memory: signals = saturated).
   Only chrome colors invert; semantic colors keep their meaning. */
body.theme-light {
  --bg-0:#fafbfc; --bg-1:#ffffff; --bg-2:#f5f6f8; --bg-hover:#e8edf3;
  --border:#e1e4e8; --border-bright:#c8cdd4;
  --text-0:#1a1d23; --text-1:#5f6b7a; --text-2:#8b94a1;
  /* Signal colors stay saturated — darken slightly for white-bg contrast,
     but preserve the green=good / red=bad / blue=primary muscle memory. */
  --green:#00a86b; --red:#e63946; --yellow:#d97706; --blue:#1f6feb; --purple:#6f42c1;
}
/* State pills — re-tint for light bg so dark badges don't sit on white. */
body.theme-light .pill.LOSS      { background:#fde4e7; color:#a02436; border-color:#f1bcc4; }
body.theme-light .pill.TURNAROUND{ background:#fdf0d4; color:#8b5500; border-color:#f0d9a8; }
body.theme-light .pill.RECENT    { background:#d6f5e6; color:#006e3a; border-color:#a8e0c2; }
body.theme-light .pill.STABLE    { background:#dbe9ff; color:#0b4ea2; border-color:#aacbf5; }
body.theme-light .pill.NA        { background:#f0f1f3; color:var(--text-2); border-color:#dcdfe3; }
/* R40 score colors — darker variants for white-bg legibility */
body.theme-light .g-r40-excellent { color:#007a4c; font-weight:700; }
body.theme-light .g-r40-good      { color:#00a86b; }
body.theme-light .g-r40-fair      { color:#b06400; }
body.theme-light .g-r40-warn      { color:#cc5500; }
body.theme-light .g-r40-bad       { color:#c1162b; }
body.theme-light .g-pos { color:#00a86b; }
body.theme-light .g-neg { color:#c1162b; }
/* Modal overlay — light-mode uses a softer scrim so it reads as a card over
   a daylit page, not a punched-out black hole. */
body.theme-light .modal { background:rgba(120,128,140,0.35); }
/* Search results need a white surface in light mode (not the dark bg-1). */
body.theme-light .search-results { background:#ffffff; box-shadow:0 4px 12px rgba(0,0,0,0.08); }
/* Sparklines: dark-mode uses #3d8fff for "trend up" — fine on light bg too
   (decent contrast on white). The #ff3d5a for trend-down is also OK. We
   leave the inline SVG colors alone (they're set in JS via the --blue/--red
   semantic vars consumed elsewhere; spark() hard-codes hex which we override
   below via the colorMap injected into window). See CLIENT_JS spark() — the
   light-mode-aware color lookup runs at draw time. */
/* Tag 213c: Bloomberg-style command palette (Ctrl+K / Cmd+K / "/").
   Centered modal overlay with single input + result list. Matches dark/light
   theme via CSS vars; no theme-specific overrides needed beyond the variables. */
.cp-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.40); z-index:200; display:none; }
.cp-overlay.show { display:block; }
.cp-panel { position:absolute; top:12vh; left:50%; transform:translateX(-50%); width:480px; max-width:calc(100vw - 24px); max-height:60vh; display:flex; flex-direction:column; background:var(--bg-1); border:1px solid var(--border-bright); box-shadow:0 16px 48px rgba(0,0,0,0.55); }
.cp-input { background:var(--bg-0); color:var(--text-0); border:0; border-bottom:1px solid var(--border-bright); padding:12px 14px; font-family:var(--mono); font-size:13px; outline:none; width:100%; box-sizing:border-box; }
.cp-input::placeholder { color:var(--text-2); }
.cp-results { overflow:auto; max-height:calc(60vh - 50px); }
.cp-result { padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--border); font-size:12px; font-family:var(--mono); color:var(--text-0); border-left:1px solid transparent; transition:background 80ms ease-out, border-color 80ms ease-out; display:flex; align-items:center; gap:8px; }
.cp-result:hover { background:var(--bg-hover); }
.cp-result.selected { background:var(--bg-hover); border-left:1px solid var(--blue); }
.cp-result .tk { font-weight:600; color:var(--text-0); }
.cp-result .meta { color:var(--text-1); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cp-result .kind { display:inline-block; padding:1px 5px; font-size:10px; border:1px solid var(--border-bright); color:var(--text-1); margin-left:auto; font-family:var(--mono); }
.cp-empty { padding:16px; text-align:center; color:var(--text-2); font-size:12px; font-style:italic; font-family:var(--ui); }
.cp-hint { padding:6px 12px; border-top:1px solid var(--border); color:var(--text-2); font-size:10px; font-family:var(--mono); background:var(--bg-1); text-transform:uppercase; letter-spacing:0.05em; }
body.theme-light .cp-overlay { background:rgba(40,48,60,0.30); }
/* Tag 223b: shortcuts help overlay (triggered by "?" outside any input).
   Shares the cp-overlay scrim color so the keyboard-cursor feel is
   consistent with the Ctrl+K palette. */
.kbd-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:210; display:none; }
.kbd-overlay.show { display:block; }
.kbd-panel { position:absolute; top:10vh; left:50%; transform:translateX(-50%); width:520px; max-width:calc(100vw - 24px); max-height:80vh; overflow:auto; background:var(--bg-1); border:1px solid var(--border-bright); padding:20px 24px; box-shadow:0 16px 48px rgba(0,0,0,0.55); }
.kbd-panel h2 { margin:0 0 12px; font-size:13px; color:var(--text-0); text-transform:uppercase; letter-spacing:0.08em; border-bottom:1px solid var(--border); padding-bottom:8px; }
.kbd-panel .kbd-row { display:flex; align-items:baseline; gap:12px; padding:5px 0; border-bottom:1px solid var(--border); font-size:12px; }
.kbd-panel .kbd-row:last-child { border-bottom:none; }
.kbd-panel .kbd-keys { flex:0 0 110px; }
.kbd-panel .kbd-desc { color:var(--text-1); font-family:var(--ui); }
.kbd-key { display:inline-block; padding:1px 6px; margin-right:2px; background:var(--bg-2); border:1px solid var(--border-bright); border-bottom-width:2px; color:var(--text-0); font-family:var(--mono); font-size:11px; min-width:14px; text-align:center; }
.kbd-close { position:absolute; top:10px; right:12px; background:transparent; color:var(--text-1); border:none; font-size:18px; cursor:pointer; line-height:1; padding:4px 8px; }
.kbd-close:hover { color:var(--text-0); }
body.theme-light .kbd-overlay { background:rgba(40,48,60,0.45); }

/* Tag 223b: column-visibility popover (toggle which columns render). */
.col-toggle-wrap { position:relative; display:inline-block; }
.col-toggle-btn { background:var(--bg-2); color:var(--text-1); border:1px solid var(--border); padding:6px 10px; cursor:pointer; font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:0.05em; transition:color 100ms ease-out, border-color 100ms ease-out; }
.col-toggle-btn:hover { color:var(--text-0); border-color:var(--border-bright); }
.col-popover { position:absolute; top:calc(100% + 4px); right:0; min-width:200px; background:var(--bg-1); border:1px solid var(--border-bright); box-shadow:0 8px 24px rgba(0,0,0,0.45); padding:8px 0; z-index:50; display:none; }
.col-popover.show { display:block; }
.col-popover .col-item { display:flex; align-items:center; padding:5px 12px; cursor:pointer; font-family:var(--mono); font-size:11px; color:var(--text-0); transition:background 80ms ease-out; }
.col-popover .col-item:hover { background:var(--bg-hover); }
.col-popover .col-item input { margin-right:8px; cursor:pointer; }
.col-popover .col-sep { border-top:1px solid var(--border); margin:6px 0; }
.col-popover .col-reset { padding:5px 12px; color:var(--text-1); font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.05em; cursor:pointer; }
.col-popover .col-reset:hover { color:var(--blue); background:var(--bg-hover); }

/* Tag 223b: data error / loading state when window.SCREENER_DATA is missing. */
.data-error { padding:40px 24px; text-align:center; color:var(--red); font-family:var(--mono); font-size:13px; background:var(--bg-1); border:1px solid var(--red); margin:24px; }
.data-error .hint { color:var(--text-1); font-family:var(--ui); font-size:11px; margin-top:8px; }

/* Tag 223b: visible focus on table rows when keyboard-navigating. */
table.dt tr.row:focus-visible { outline:2px solid var(--blue); outline-offset:-2px; background:var(--bg-hover); }

/* Tag 223b: button hover for icon-only modal nav buttons (close, prev, next)
   already covered by .modal-header button — no extra rule needed. Add a
   distinct close-X style so the close button reads as destructive-ish. */
.modal-header button.close-btn:hover { color:var(--red); border-color:var(--red); }

/* Tag 231b-5: external research jump-links + ticker copy button in modal. */
.modal-header .ext-link { display:inline-block; padding:2px 8px; background:var(--bg-2); color:var(--text-1); border:1px solid var(--border); font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.05em; text-decoration:none; cursor:pointer; transition:color 100ms ease-out, border-color 100ms ease-out; }
.modal-header .ext-link:hover { color:var(--blue); border-color:var(--blue); }
.modal-header button.ext-link { line-height:1.4; }
.modal-header button.ext-link.copied { color:var(--green); border-color:var(--green); }

/* Upgrade 3a: mobile responsive (≤700px) */
@media (max-width:700px) {
  header { flex-wrap:wrap; gap:8px; padding:8px 10px; }
  header .search { max-width:100%; flex-basis:100%; order:3; }
  .tabs { overflow-x:auto; white-space:nowrap; padding:0 8px; }
  .tabs button { flex-shrink:0; min-height:36px; padding:8px 12px; }
  .filters { padding:6px 10px; }
  .filters select, .filters input, .filters button.f { min-height:32px; font-size:12px; padding:4px 8px; }
  .filters input[type=number] { width:60px; }
  .pagination button, header button.print-btn { min-height:32px; padding:6px 12px; }
  .modal-content { margin:0; padding:12px; max-width:100%; }
  .cards { grid-template-columns:1fr; }
  .charts { grid-template-columns:1fr; }
  .search-results { left:0; transform:none; width:100%; max-width:100%; top:auto; position:relative; }
  table.dt th, table.dt td { padding:4px 6px; font-size:11px; }
  #active-filters { padding:6px 10px; }
  /* Tag 223b: drop max-height cap on mobile — let body scroll instead so
     iOS momentum scrolling stays smooth. Sticky headers gracefully degrade. */
  .table-wrap { max-height:none; }
  /* Tag 226c-1: also drop sticky pagination on mobile — sticky bottom bars
     eat scarce viewport on phones and the natural flow works fine. */
  .pagination { position:static; box-shadow:none; }
}
/* Upgrade 3b: print styles — render only the active table, light theme */
@media print {
  body { background:#fff; color:#000; font-size:10pt; }
  header, .tabs, .filters, #active-filters, .pagination, .modal, .search-results, #themeBtn, .cp-overlay, .kbd-overlay, .col-popover { display:none !important; }
  .summary { background:#fff; color:#000; border-bottom:1px solid #888; padding:4px 0; }
  .summary strong { color:#000; }
  #explainer { background:#fff; color:#333; border-bottom:1px solid #888; }
  .table-wrap { overflow:visible; }
  table.dt { font-size:9pt; }
  table.dt th { background:#eee; color:#000; border-bottom:1px solid #888; position:static; }
  table.dt td { color:#000; border-bottom:1px solid #ccc; }
  table.dt tr.row { background:#fff !important; }
  .pill { border:1px solid #888; color:#000 !important; background:#fff !important; }
  .g-pos, .g-r40-excellent, .g-r40-good { color:#006622 !important; }
  .g-neg, .g-r40-bad { color:#aa0011 !important; }
  .g-r40-fair, .g-r40-warn { color:#885500 !important; }
  .g-mute { color:#666 !important; }
  /* keep SVG sparklines visible per spec */
  svg { color-adjust:exact; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
}
`;

// Client-side JS — runs in the browser, reads window.SCREENER_DATA
const CLIENT_JS = `
(function(){
  const DATA = window.SCREENER_DATA;
  // Tag 232b-2: country→continent map mirrored from Node-side. Used by the
  // new continent select filter. Injected at build time via JSON.stringify.
  const COUNTRY_TO_CONTINENT = ${JSON.stringify(COUNTRY_TO_CONTINENT)};
  // Tag 223b: error state — if the data block is missing (corrupted output,
  // network failure, browser blocked inline script), surface a clear message
  // instead of throwing on the first ROWS lookup below.
  if (!DATA || !DATA.rowsByTicker || !DATA.tabs) {
    const tbl = document.getElementById('table');
    if (tbl) tbl.innerHTML = '<div class="data-error">Error loading data: window.SCREENER_DATA is missing or invalid.<div class="hint">Try re-running <code>node generate-screener.js</code> or re-loading the page.</div></div>';
    return;
  }
  const ROWS = DATA.rowsByTicker;
  // TABS came over as { TAB: [ticker, ticker, ...] }; hydrate into row arrays for filter/render code.
  const TABS = {};
  for (const t of Object.keys(DATA.tabs)) {
    TABS[t] = DATA.tabs[t].map(tk => ROWS[tk]).filter(Boolean);
  }
  const PAGE_SIZE = 50;

  // Tag 223b: hidden-column state per tab. Loaded from localStorage; defaults
  // to all-columns-shown. Stored as { tab: [hidden col-key, ...] }.
  let hiddenCols = {};
  try {
    const raw = localStorage.getItem('screener.hiddenCols');
    if (raw) hiddenCols = JSON.parse(raw) || {};
  } catch (e) { /* ignore — localStorage may be blocked */ }
  function isColHidden(tab, key) {
    return (hiddenCols[tab] || []).indexOf(key) >= 0;
  }
  function setColHidden(tab, key, hidden) {
    const list = hiddenCols[tab] || [];
    const i = list.indexOf(key);
    if (hidden && i < 0) list.push(key);
    else if (!hidden && i >= 0) list.splice(i, 1);
    hiddenCols[tab] = list;
    try { localStorage.setItem('screener.hiddenCols', JSON.stringify(hiddenCols)); } catch (e) { /* ignore */ }
  }

  let activeTab = 'HG';
  let page = 1;
  let filterState = { LOSS:true, TURNAROUND:true, RECENT:true, STABLE:true, NA:true };
  // Tag 232b-3: filterCap (MICRO/SMALL/MID/LARGE/MEGA bucket toggles) removed.
  // The Cap≥ $B input introduced in Tag 232b-2 is the only mcap filter now.
  // Tag 232b-1: sector filter is now multi-select (per-sector boolean, all-on default).
  // Initialized from DOM at startup so the server-templated sectors list is the
  // single source of truth. Karl asked for the ability to exclude e.g. Basic Materials
  // when looking at R40 candidates; the prior single-select forced choosing one.
  // (NB: no inner backticks in this block — outer is a template literal, see CLIENT_JS note above.)
  let filterSectors = {};
  // Tag 232b-4: country filter is now multi-select (per-country bool, all-on
  // default). Parallel to filterSectors. Driven from the new ctry-popover
  // checkbox grid in the filter bar. Old single-select snap.filterCountry
  // strings still load via presetApply migration.
  let filterCountries = {};
  // Tag 232b-2: continent select (alternative to country) and a market-cap
  // minimum in billions USD (Karl: "wie groß das market cap mindestens sein muss").
  let filterContinent = '';
  let filterMinMcap = '';  // value in $B; multiplied by 1e9 at filter time
  let filterMinR40 = '';
  let filterMaxR40 = '';
  let filterMin = '';     // tab-specific min input — auto-resets on tab switch
  // Tag 232b-1: persistent FCF-margin and revenue-growth minimums. Strict null-handling:
  // a stock with r.fcfMargin == null is excluded when filterMinFcfm is set (same pattern
  // as existing filterMinR40 below). User wanted to exclude negative-margin / weak-growth.
  let filterMinFcfm = '';
  let filterMinGrowth = '';
  // Tag 232b-1: IPO filter replaced bucket buttons (LT1/LT2/LT5/GT5) with year-range
  // inputs. Buckets removed because Karl needed precision ("nur 2020-2024 IPOs"); the
  // <1y/<2y shortcuts didn't scale to that.
  let filterIpoMin = '';
  let filterIpoMax = '';
  let filterDQ = { 'A+':true, 'A':true, 'B':true, 'C':false, 'D':false };
  let onlyGaap = false;
  let onlyFcf  = false;
  let sortKey = 'auto';   // auto = tab's primary; or one of {score,r40,growth,fcfMargin,mcap,pbScore}
  let currentList = [];   // active filtered list

  // Tag 232b-1: short labels for sector buttons (the full Yahoo names are too long
  // for the filter bar; full name shown via title= tooltip).
  const SECTOR_LABELS = {
    'Basic Materials':         'Mat',
    'Communication Services':  'Comm',
    'Consumer Cyclical':       'Cyc',
    'Consumer Defensive':      'Def',
    'Energy':                  'Energy',
    'Financial Services':      'Fin',
    'Healthcare':              'Health',
    'Industrials':             'Ind',
    'Real Estate':             'Real',
    'Technology':              'Tech',
    'Utilities':               'Util'
  };

  function capBucket(mcap){
    if (!mcap) return null;
    if (mcap < 300e6) return 'MICRO';
    if (mcap < 2e9) return 'SMALL';
    if (mcap < 10e9) return 'MID';
    if (mcap < 200e9) return 'LARGE';
    return 'MEGA';
  }
  function fmtM(v){ if (v==null||!Number.isFinite(v)) return '—'; if (Math.abs(v)>=1e12) return (v/1e12).toFixed(2)+'T'; if (Math.abs(v)>=1e9) return (v/1e9).toFixed(1)+'B'; if (Math.abs(v)>=1e6) return (v/1e6).toFixed(0)+'M'; return v.toFixed(0); }
  // Tag 206k (Bug-Hunt Agent E MEDIUM-3): the original sign-prefix ternary
  // was (v>=0 ? "" : "") — both branches empty string, dead code. Intent was
  // a '+' prefix for positive values so the eye can quickly scan +/− deltas.
  // NOTE: do NOT use backticks in this comment block — CLIENT_JS itself lives
  // inside a node template-literal, so an inner backtick terminates the outer
  // string and breaks parsing (runtime ReferenceError, found Tag 206p).
  function fmtP(v,d){ if (v==null||!Number.isFinite(v)) return '—'; return (v>=0?'+':'')+(v).toFixed(d==null?1:d)+'%'; }
  function fmtN(v,d){ if (v==null||!Number.isFinite(v)) return '—'; return v.toFixed(d==null?1:d); }
  function pct(v){ if (v==null||!Number.isFinite(v)) return '—'; return v.toFixed(1)+'%'; }
  function colorPct(v){ if (v==null||!Number.isFinite(v)) return 'g-mute'; return v>=0?'g-pos':'g-neg'; }
  function r40Class(v){ if (v==null) return 'g-mute'; if (v>=60) return 'g-r40-excellent'; if (v>=40) return 'g-r40-good'; if (v>=20) return 'g-r40-fair'; if (v>=0) return 'g-r40-warn'; return 'g-r40-bad'; }
  // Tag 206k (Bug-Hunt Agent E MEDIUM-5): escape HTML special chars when
  // dropping Yahoo-sourced strings (ticker, name, sector, industry, country)
  // into innerHTML. Defense-in-depth: Yahoo data is generally trusted, but
  // a compromised feed or malformed company name (e.g. an ampersand or
  // angle-bracket in a real ticker name) would otherwise corrupt the DOM
  // or silently truncate the row.
  function esc(s){ if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  // Tag 209e Upgrade 2: conditional row tint based on dominant signal.
  // Returns inline-style background tint (2-4% alpha) for each row. Tints
  // stack UNDER :hover (hover background is fully opaque in CSS), so they
  // never interfere with row-selection feedback.
  //   RED   — any hard-gate fired OR dqGrade === 'D' (defensive flag)
  //   GREEN — scoreHistory.deltaScore7d >= 5 (recent positive momentum)
  //   AMBER — dqGrade === 'C' (moderate data quality)
  //   else  — no tint (default bg)
  function rowTint(r){
    if (r.qSpikeFail || r.lossMagFail || r.metricDivFail || r.niVolFail
        || r.preCommFail || r.cetFail || r.r40SanityFail || r.revShockFail
        || r.dqGrade === 'D') {
      return 'background:rgba(255,61,90,0.04);';
    }
    if (r.scoreHistory && Number.isFinite(r.scoreHistory.deltaScore7d) && r.scoreHistory.deltaScore7d >= 5) {
      return 'background:rgba(0,204,136,0.04);';
    }
    if (r.dqGrade === 'C') {
      return 'background:rgba(255,187,51,0.04);';
    }
    return '';
  }

  // Tag 209e Upgrade 1: render active-filter breadcrumb chips with × removers.
  // Each chip's data-chip identifies which filter to clear; click on .x dispatches
  // a reset for that specific filter and triggers re-render. Hides container if
  // no filters are active.
  function renderActiveChips(){
    const chips = [];
    // State pills (only show if NOT all-on)
    const stateKeys = Object.keys(filterState);
    const stateOff = stateKeys.filter(k => !filterState[k]);
    if (stateOff.length > 0 && stateOff.length < stateKeys.length) {
      const stateOn = stateKeys.filter(k => filterState[k]);
      chips.push({k:'state', label:'State: ' + stateOn.join('/')});
    }
    // Tag 232b-3: cap-bucket chip removed (filter no longer exists).
    // Tag 232b-1: multi-select sector chip (only when partial selection)
    const secKeys = Object.keys(filterSectors);
    const secOff = secKeys.filter(s => !filterSectors[s]);
    if (secKeys.length > 0 && secOff.length > 0 && secOff.length < secKeys.length) {
      const secOn = secKeys.filter(s => filterSectors[s]);
      const labels = secOn.map(s => SECTOR_LABELS[s] || s);
      chips.push({k:'sector', label:'Sector: ' + labels.join('/')});
    }
    // Tag 232b-4: country chip only when selection is partial
    const ctryKeys = Object.keys(filterCountries);
    const ctryOff = ctryKeys.filter(c => !filterCountries[c]);
    if (ctryKeys.length > 0 && ctryOff.length > 0 && ctryOff.length < ctryKeys.length) {
      const ctryOn = ctryKeys.filter(c => filterCountries[c]);
      const label = ctryOn.length <= 3 ? ctryOn.join('/') : (ctryOn.length + '/' + ctryKeys.length);
      chips.push({k:'country', label:'Country: ' + label});
    }
    // Tag 232b-2: continent + mcap min chips
    if (filterContinent) chips.push({k:'continent', label:'Continent: ' + filterContinent});
    if (filterMinMcap !== '') chips.push({k:'minMcap', label:'Cap ≥ $' + filterMinMcap + 'B'});
    if (filterMinR40 !== '') chips.push({k:'minR40', label:'R40 ≥ ' + filterMinR40});
    if (filterMaxR40 !== '') chips.push({k:'maxR40', label:'R40 ≤ ' + filterMaxR40});
    if (filterMin !== '') chips.push({k:'tabMin', label:'Tab Min ≥ ' + filterMin});
    // Tag 232b-1: new chips for FCFM/Growth/IPO-year
    if (filterMinFcfm !== '') chips.push({k:'minFcfm', label:'FCFM ≥ ' + filterMinFcfm + '%'});
    if (filterMinGrowth !== '') chips.push({k:'minGrowth', label:'Growth ≥ ' + filterMinGrowth + '%'});
    if (filterIpoMin !== '' || filterIpoMax !== '') {
      let ipoLbl = 'IPO ';
      if (filterIpoMin !== '' && filterIpoMax !== '') ipoLbl += filterIpoMin + '-' + filterIpoMax;
      else if (filterIpoMin !== '') ipoLbl += '≥ ' + filterIpoMin;
      else ipoLbl += '≤ ' + filterIpoMax;
      chips.push({k:'ipo', label: ipoLbl});
    }
    // DQ filter — show if any of A+/A/B/C/D is off
    const dqAll = ['A+','A','B','C','D'];
    const dqOn = dqAll.filter(g => filterDQ[g]);
    const dqDefault = (filterDQ['A+'] && filterDQ['A'] && filterDQ['B'] && !filterDQ['C'] && !filterDQ['D']);
    if (!dqDefault) {
      chips.push({k:'dq', label:'Grade: ' + (dqOn.length ? dqOn.join('/') : 'none')});
    }
    if (onlyGaap) chips.push({k:'gaap', label:'GAAP+'});
    if (onlyFcf) chips.push({k:'fcf', label:'FCF+'});
    if (sortKey !== 'auto') chips.push({k:'sort', label:'Sort: ' + sortKey});

    const el = document.getElementById('active-filters');
    if (!el) return;
    if (chips.length === 0) {
      el.classList.remove('show');
      el.innerHTML = '';
      return;
    }
    let html = '<span class="label">Active:</span>';
    for (const c of chips) {
      html += '<span class="chip" data-chip="'+c.k+'">' + esc(c.label) + '<span class="x" role="button" tabindex="0" aria-label="Remove filter '+esc(c.label)+'" title="Remove filter">×</span></span>';
    }
    html += '<button type="button" class="clear-all" id="chipsClearAll" aria-label="Clear all filters" title="Reset all filters">Clear All</button>';
    el.innerHTML = html;
    el.classList.add('show');
  }

  // Per-chip reset dispatcher. Keep filter setters and UI controls in sync.
  function clearChipFilter(key){
    if (key === 'state') {
      filterState = { LOSS:true, TURNAROUND:true, RECENT:true, STABLE:true, NA:true };
      document.querySelectorAll('.filters .f-state').forEach(b => b.classList.add('on'));
    } else if (key === 'sector') {
      Object.keys(filterSectors).forEach(s => filterSectors[s] = true);
      // Tag 232b-2: sector buttons replaced by checkbox popover
      document.querySelectorAll('.filters .f-sec-cb').forEach(cb => { cb.checked = true; });
      updateSecBtnLabel();
    } else if (key === 'country') {
      Object.keys(filterCountries).forEach(c => filterCountries[c] = true);
      document.querySelectorAll('.filters .f-ctry-cb').forEach(cb => { cb.checked = true; });
      if (typeof updateCtryBtnLabel === 'function') updateCtryBtnLabel();
    } else if (key === 'continent') {
      filterContinent = '';
      const el = document.getElementById('fContinent'); if (el) el.value = '';
    } else if (key === 'minMcap') {
      filterMinMcap = '';
      const el = document.getElementById('fMinMcap'); if (el) el.value = '';
    } else if (key === 'minR40') {
      filterMinR40 = '';
      const el = document.getElementById('fMinR40'); if (el) el.value = '';
    } else if (key === 'maxR40') {
      filterMaxR40 = '';
      const el = document.getElementById('fMaxR40'); if (el) el.value = '';
    } else if (key === 'tabMin') {
      filterMin = '';
      const el = document.getElementById('fMin'); if (el) el.value = '';
    } else if (key === 'minFcfm') {
      filterMinFcfm = '';
      const el = document.getElementById('fMinFcfm'); if (el) el.value = '';
    } else if (key === 'minGrowth') {
      filterMinGrowth = '';
      const el = document.getElementById('fMinGrowth'); if (el) el.value = '';
    } else if (key === 'ipo') {
      filterIpoMin = ''; filterIpoMax = '';
      const minEl = document.getElementById('fIpoMin'); if (minEl) minEl.value = '';
      const maxEl = document.getElementById('fIpoMax'); if (maxEl) maxEl.value = '';
    } else if (key === 'dq') {
      filterDQ = { 'A+':true, 'A':true, 'B':true, 'C':false, 'D':false };
      document.querySelectorAll('.filters .f-dq').forEach(b => {
        const g = b.dataset.dq;
        b.classList.toggle('on', !!filterDQ[g]);
      });
    } else if (key === 'gaap') {
      onlyGaap = false;
      const el = document.getElementById('onlyGaap'); if (el) el.checked = false;
    } else if (key === 'fcf') {
      onlyFcf = false;
      const el = document.getElementById('onlyFcf'); if (el) el.checked = false;
    } else if (key === 'sort') {
      sortKey = 'auto';
      const el = document.getElementById('fSort'); if (el) el.value = 'auto';
    }
    page = 1;
    renderTable();
  }

  function clearAllFilters(){
    filterState = { LOSS:true, TURNAROUND:true, RECENT:true, STABLE:true, NA:true };
    // Tag 232b-3: filterCap removed
    Object.keys(filterSectors).forEach(s => filterSectors[s] = true);
    Object.keys(filterCountries).forEach(c => filterCountries[c] = true);
    filterContinent = '';
    filterMinMcap = '';
    filterMinR40 = ''; filterMaxR40 = ''; filterMin = '';
    filterMinFcfm = ''; filterMinGrowth = '';
    filterIpoMin = ''; filterIpoMax = '';
    filterDQ = { 'A+':true, 'A':true, 'B':true, 'C':false, 'D':false };
    onlyGaap = false; onlyFcf = false; sortKey = 'auto';
    document.querySelectorAll('.filters .f-state').forEach(b => b.classList.add('on'));
    document.querySelectorAll('.filters .f-sec').forEach(b => b.classList.add('on'));
    document.querySelectorAll('.filters .f-dq').forEach(b => {
      const g = b.dataset.dq;
      b.classList.toggle('on', !!filterDQ[g]);
    });
    ['fContinent','fMinMcap','fMinR40','fMaxR40','fMin','fMinFcfm','fMinGrowth','fIpoMin','fIpoMax'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    // Tag 232b-2/4: reset sector + country popover checkboxes
    document.querySelectorAll('.filters .f-sec-cb').forEach(cb => { cb.checked = true; });
    document.querySelectorAll('.filters .f-ctry-cb').forEach(cb => { cb.checked = true; });
    const secBtn = document.getElementById('secToggleBtn'); if (secBtn) secBtn.textContent = 'All ▾';
    const ctryBtn = document.getElementById('ctryToggleBtn'); if (ctryBtn) ctryBtn.textContent = 'All ▾';
    const gEl = document.getElementById('onlyGaap'); if (gEl) gEl.checked = false;
    const fEl = document.getElementById('onlyFcf'); if (fEl) fEl.checked = false;
    const sEl = document.getElementById('fSort'); if (sEl) sEl.value = 'auto';
    page = 1;
    renderTable();
  }

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
      // Tag 232b-3: cap-bucket filter removed; Cap≥ input handles mcap filtering.
      // Tag 232b-1: multi-select sector — exclude only if the row's sector is
      // explicitly off (rows with missing/null sector pass; matches existing
      // single-select fallthrough behavior).
      if (r.sector && filterSectors[r.sector] === false) return false;
      // Tag 232b-4: multi-select country (exclude only when explicitly off).
      if (r.country && filterCountries[r.country] === false) return false;
      // Tag 232b-2: continent filter (independent of country — set either or both).
      if (filterContinent) {
        const cont = r.country ? COUNTRY_TO_CONTINENT[r.country] : null;
        if (cont !== filterContinent) return false;
      }
      // Tag 232b-2: market-cap minimum input in $B (Karl wants finer control than
      // the cap buckets). Strict null exclusion to match Karl's stated intent.
      if (filterMinMcap !== '' && !isNaN(+filterMinMcap)) {
        if (r.mcap == null || r.mcap < (+filterMinMcap) * 1e9) return false;
      }
      if (filterMinR40 !== '' && !isNaN(+filterMinR40)) {
        if (r.r40 == null || r.r40 < +filterMinR40) return false;
      }
      if (filterMaxR40 !== '' && !isNaN(+filterMaxR40)) {
        if (r.r40 != null && r.r40 > +filterMaxR40) return false;
      }
      // Tag 232b-1: strict-null FCF-margin / growth minimums — null is excluded.
      if (filterMinFcfm !== '' && !isNaN(+filterMinFcfm)) {
        if (r.fcfMargin == null || r.fcfMargin < +filterMinFcfm) return false;
      }
      if (filterMinGrowth !== '' && !isNaN(+filterMinGrowth)) {
        if (r.growth == null || r.growth < +filterMinGrowth) return false;
      }
      if (filterMin !== '' && !isNaN(+filterMin)) {
        const minV = +filterMin;
        if (activeTab === 'HG' && (r.r40 == null || r.r40 < minV)) return false;
        if (activeTab === 'QC' && (r.fcfMargin == null || r.fcfMargin < minV)) return false;
        if (activeTab === 'BF' && (r.bfScore == null || r.bfScore < minV)) return false;
        if (activeTab === 'SMALL' && (r.growth == null || r.growth < minV)) return false;
        if (activeTab === 'R40' && (r.r40 == null || r.r40 < minV)) return false;
        if (activeTab === 'PRE_BREAKOUT' && (r.growth == null || r.growth < minV)) return false;
      }
      // Tag 232b-1: IPO-year range (replaces LT1/LT2/LT5/GT5 buckets).
      // Null ipoYear is excluded when either bound is set.
      if (filterIpoMin !== '' && !isNaN(+filterIpoMin)) {
        if (r.ipoYear == null || r.ipoYear < +filterIpoMin) return false;
      }
      if (filterIpoMax !== '' && !isNaN(+filterIpoMax)) {
        if (r.ipoYear == null || r.ipoYear > +filterIpoMax) return false;
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
        if (tab === 'BF') {
          const ap = a.bfPassed ? 1 : 0, bp = b.bfPassed ? 1 : 0;
          if (ap !== bp) return bp - ap;
          return (b.bfScore||0) - (a.bfScore||0);
        }
        if (tab === 'SMALL') return (b.growth||0) - (a.growth||0);
        if (tab === 'R40') return (b.r40||0) - (a.r40||0);
        if (tab === 'PRE_BREAKOUT') return (b.pbScore||0) - (a.pbScore||0);
        if (tab === 'WATCH') return Math.max(b.hgScore||0, b.qcScore||0, b.bfScore||0) - Math.max(a.hgScore||0, a.qcScore||0, a.bfScore||0);
        return 0;
      }
      if (k === 'score')     return Math.max(b.hgScore||0, b.qcScore||0, b.bfScore||0) - Math.max(a.hgScore||0, a.qcScore||0, a.bfScore||0);
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
      {k:'RevGr%',w:70,num:true}, {k:'GrossM%',w:70,num:true}, {k:'FCFM%',w:70,num:true}, {k:'MCap',w:70,num:true},
      {k:'Trend',w:75}
    ];
    if (tab === 'QC') return [
      {k:'#',w:30}, {k:'Ticker',w:60}, {k:'Company',w:240}, {k:'Sector',w:120},
      {k:'Score',w:60,num:true}, {k:'State',w:80}, {k:'FCFM%',w:70,num:true},
      {k:'OpM%',w:70,num:true}, {k:'GrossM%',w:70,num:true}, {k:'MCap',w:70,num:true},
      {k:'Trend',w:75}
    ];
    if (tab === 'BF') return [
      {k:'#',w:30}, {k:'Ticker',w:60}, {k:'Company',w:230}, {k:'Sector',w:110},
      {k:'Score',w:55,num:true}, {k:'14-Pt',w:55}, {k:'OE',w:40}, {k:'MoS',w:50},
      {k:'FCFM%',w:65,num:true}, {k:'OpM%',w:65,num:true}, {k:'MCap',w:65,num:true},
      {k:'Trend',w:70}
    ];
    if (tab === 'SMALL') return [
      {k:'#',w:30}, {k:'Ticker',w:60}, {k:'Company',w:240}, {k:'Country',w:60},
      {k:'State',w:80}, {k:'RevGr%',w:70,num:true}, {k:'R40',w:60,num:true},
      {k:'GrossM%',w:70,num:true}, {k:'MCap',w:70,num:true}
    ];
    if (tab === 'R40') return [
      {k:'#',w:30}, {k:'Ticker',w:60}, {k:'Company',w:240}, {k:'Sector',w:120},
      {k:'R40',w:60,num:true}, {k:'RevGr%',w:70,num:true}, {k:'FCFM%',w:70,num:true},
      {k:'OpM%',w:70,num:true}, {k:'GrossM%',w:70,num:true}, {k:'State',w:80}, {k:'MCap',w:70,num:true},
      {k:'Trend',w:75}
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

  // Tag 212c: Per-tab numeric columns that get the inline percentile-rank
  // bullet bar. Keys are the row-field names (or virtual keys handled below).
  // Skip WATCH (per spec) and SECTOR (different layout). Score column resolves
  // to hgScore/qcScore/pbScore depending on tab.
  const BULLET_COLS = {
    'HG':           ['score','r40','growth','grossMargin','fcfMargin','mcap'],
    'QC':           ['score','fcfMargin','opMargin','grossMargin','mcap'],
    'BF':           ['score','fcfMargin','opMargin','mcap'],
    'SMALL':        ['growth','r40','grossMargin','mcap'],
    'R40':          ['r40','growth','fcfMargin','opMargin','grossMargin','mcap'],
    'PRE_BREAKOUT': ['growth','grossMargin','r40','mcap','pbScore']
  };
  function _rowMetricForBullet(r, key, tab){
    if (key === 'score') {
      if (tab === 'QC') return r.qcScore;
      if (tab === 'HG') return r.hgScore;
      if (tab === 'BF') return r.bfScore;
      return null;
    }
    if (key === 'mcap') return r.mcap;
    if (key === 'pbScore') return r.pbScore;
    return r[key];
  }
  // buildPercentileMaps: for each numeric column on the active tab, sort the
  // currently filtered list and create a ticker→percentile (0..1) map. Used by
  // bulletCell to size the inline bar. Computed once per renderTable call so
  // we avoid O(n²) work per row.
  function buildPercentileMaps(list, tab){
    const keys = BULLET_COLS[tab] || [];
    const maps = {};
    for (const k of keys) {
      const vals = [];
      for (const r of list) {
        const v = _rowMetricForBullet(r, k, tab);
        if (v != null && Number.isFinite(v)) vals.push({tk: r.ticker, v});
      }
      vals.sort((a,b) => a.v - b.v);
      const map = {};
      const n = vals.length;
      if (n > 1) {
        for (let i = 0; i < n; i++) map[vals[i].tk] = i / (n - 1);
      } else if (n === 1) {
        map[vals[0].tk] = 1;
      }
      maps[k] = map;
    }
    return maps;
  }
  // bulletCell: render a numeric <td> with a percentile bar behind the number.
  // innerHtml is the pre-formatted number HTML (may include its own color
  // span like .g-pos). pct is 0..1 or null (null → no bar, plain cell).
  function bulletCell(innerHtml, pct){
    if (innerHtml === '—' || innerHtml == null) return '<td class="num">—</td>';
    if (pct == null || !Number.isFinite(pct)) return '<td class="num">'+innerHtml+'</td>';
    const w = Math.max(0, Math.min(100, pct * 100));
    const color = pct >= 0.66 ? 'var(--green)' : pct >= 0.33 ? 'var(--blue)' : 'var(--text-2)';
    return '<td class="num bullet"><div class="bar" style="width:'+w.toFixed(1)+'%;background:'+color+'"></div><span class="v">'+innerHtml+'</span></td>';
  }
  // Tag 212d: microSpark — tiny inline SVG sparkline for per-row trend column.
  // values: ascending time-ordered array of numbers (oldest → newest). Returns
  // empty string when there's nothing useful to draw (graceful degrade).
  function microSpark(values, w, h){
    const vs = (values||[]).filter(v => v != null && Number.isFinite(v));
    if (vs.length < 2) return '';
    const min = Math.min.apply(null, vs), max = Math.max.apply(null, vs), range = (max-min) || 1;
    const pts = vs.map(function(v,i){
      return (i/(vs.length-1)*w).toFixed(1)+','+(h - (v-min)/range*h).toFixed(1);
    }).join(' ');
    const color = vs[vs.length-1] >= vs[0] ? 'var(--green)' : 'var(--red)';
    return '<svg width="'+w+'" height="'+h+'" style="vertical-align:middle;display:inline-block;"><polyline points="'+pts+'" stroke="'+color+'" stroke-width="1" fill="none"/></svg>';
  }
  // trendCell: builds the Trend <td> for HG/QC/BF/R40 tabs — microSpark + Δ7d
  // badge. Source field on history entries: hgScore (HG, R40) or qcScore (QC).
  // r40 isn't stored in score-history so the R40 tab falls back to hgScore as
  // a correlated proxy (same momentum axis). Tag 232g: bfScore isn't in
  // snapshot-score-history yet (would need a backfill); fall back to hgScore
  // which approximates fundamentals momentum for the same stock.
  function trendCell(r, tab){
    const sh = r.scoreHistory;
    if (!sh || !Array.isArray(sh.history) || sh.history.length === 0) return '<td><span class="g-mute" style="font-size:10px">—</span></td>';
    const field = tab === 'QC' ? 'qcScore' : 'hgScore';
    const series = sh.history.map(function(e){ return (e && Number.isFinite(e[field])) ? e[field] : null; }).filter(function(v){ return v != null; });
    const spark = microSpark(series, 60, 16);
    // Δ7d: use deltaScore7d if it's the right axis (hgScore), else derive
    // from the trimmed series. For QC we look back ~7 entries (1/day).
    let delta = null;
    if (field === 'hgScore' && sh.deltaScore7d != null && Number.isFinite(sh.deltaScore7d)) {
      delta = sh.deltaScore7d;
    } else if (series.length >= 2) {
      const lookback = Math.min(7, series.length - 1);
      delta = series[series.length-1] - series[series.length-1-lookback];
    }
    let badge = '';
    if (delta != null && Number.isFinite(delta)) {
      const cls = delta >= 5 ? 'pos' : delta <= -5 ? 'neg' : 'mute';
      const sign = delta >= 0 ? '+' : '';
      badge = '<span class="d7 '+cls+'">'+sign+delta.toFixed(1)+'</span>';
    }
    if (!spark && !badge) return '<td><span class="g-mute" style="font-size:10px">—</span></td>';
    return '<td>'+spark+badge+'</td>';
  }

  function renderRow(r, i, tab, pctMaps){
    pctMaps = pctMaps || {};
    const stateP = '<span class="pill '+r.state+'">'+r.state+'</span>';
    const r40Html = r.r40==null ? '—' : '<span class="'+r40Class(r.r40)+'">'+r.r40.toFixed(1)+'</span>';
    const growthHtml = r.growth==null ? '—' : '<span class="'+colorPct(r.growth)+'">'+r.growth.toFixed(1)+'%</span>';
    const gmHtml = r.grossMargin==null ? '—' : r.grossMargin.toFixed(1)+'%';
    const opmHtml = r.opMargin==null ? '—' : '<span class="'+colorPct(r.opMargin)+'">'+r.opMargin.toFixed(1)+'%</span>';
    const fcfmHtml = r.fcfMargin==null ? '—' : '<span class="'+colorPct(r.fcfMargin)+'">'+r.fcfMargin.toFixed(1)+'%</span>';
    // bullet shorthand — looks up the row's percentile for the column key
    // on the current tab. Returns full <td>...</td>. Falls back to a plain
    // <td> when the map is missing (e.g. WATCH/SECTOR tabs that opt out).
    const bp = function(key){ return (pctMaps[key] && pctMaps[key][r.ticker] != null) ? pctMaps[key][r.ticker] : null; };
    const bc = function(innerHtml, key){ return bulletCell(innerHtml, bp(key)); };
    // Tag 209e Upgrade 2: per-row tint based on dominant signal.
    const tint = rowTint(r);
    // Tag 223b: make rows focusable; tr has implicit role=row so no role attr.
    // aria-label kept short (ticker only) to limit per-row HTML overhead at
    // 3,500+ rows; screen readers still announce cell content on cursor entry.
    const rowOpen = '<tr class="row" tabindex="-1" aria-label="'+esc(r.ticker)+'" style="'+tint+'" data-tk="'+esc(r.ticker)+'">';

    if (tab === 'HG') {
      // Tag 223b: scores standardised to 1 decimal (was .toFixed(0)).
      const score = r.hgScore==null ? '—' : r.hgScore.toFixed(1);
      return rowOpen+'<td>'+(i+1)+'</td><td class="ticker">'+esc(r.ticker)+'</td><td class="name">'+esc(r.name)+'</td><td>'+esc(r.sector)+'</td>'+bc(score,'score')+'<td>'+stateP+'</td>'+bc(r40Html,'r40')+bc(growthHtml,'growth')+bc(gmHtml,'grossMargin')+bc(fcfmHtml,'fcfMargin')+bc(fmtM(r.mcap),'mcap')+trendCell(r,'HG')+'</tr>';
    }
    if (tab === 'QC') {
      const score = r.qcScore==null ? '—' : r.qcScore.toFixed(1);
      return rowOpen+'<td>'+(i+1)+'</td><td class="ticker">'+esc(r.ticker)+'</td><td class="name">'+esc(r.name)+'</td><td>'+esc(r.sector)+'</td>'+bc(score,'score')+'<td>'+stateP+'</td>'+bc(fcfmHtml,'fcfMargin')+bc(opmHtml,'opMargin')+bc(gmHtml,'grossMargin')+bc(fmtM(r.mcap),'mcap')+trendCell(r,'QC')+'</tr>';
    }
    if (tab === 'BF') {
      // Tag 232g: read 14-pt composite + OE pass + MoS from compactResults.
      // buffett-criteria.value is the count of passing tests (0-14). owner-
      // earnings.pass is the OE-positive-and-growing check. dcf-intrinsic-value
      // .value is the discount-to-intrinsic ratio (≥0.25 = MoS pass).
      const score = r.bfScore==null ? '—' : r.bfScore.toFixed(1);
      const bc14 = r.results['buffett-criteria'];
      const bc14Cell = (bc14 && bc14.computable && Number.isFinite(bc14.value))
        ? '<span class="'+(bc14.pass?'g-pos':'g-mute')+'">'+bc14.value.toFixed(0)+'/14</span>'
        : '<span class="g-mute">—</span>';
      const oe = r.results['owner-earnings'];
      const oeCell = (oe && oe.computable)
        ? '<span class="'+(oe.pass?'g-pos':'g-neg')+'">'+(oe.pass?'✓':'✗')+'</span>'
        : '<span class="g-mute">—</span>';
      const dcf = r.results['dcf-intrinsic-value'];
      const mosCell = (dcf && dcf.computable && Number.isFinite(dcf.value))
        ? '<span class="'+(dcf.pass?'g-pos':'g-mute')+'">'+(dcf.value*100).toFixed(0)+'%</span>'
        : '<span class="g-mute">—</span>';
      return rowOpen+'<td>'+(i+1)+'</td><td class="ticker">'+esc(r.ticker)+'</td><td class="name">'+esc(r.name)+'</td><td>'+esc(r.sector)+'</td>'+bc(score,'score')+'<td>'+bc14Cell+'</td><td>'+oeCell+'</td><td>'+mosCell+'</td>'+bc(fcfmHtml,'fcfMargin')+bc(opmHtml,'opMargin')+bc(fmtM(r.mcap),'mcap')+trendCell(r,'BF')+'</tr>';
    }
    if (tab === 'SMALL') {
      return rowOpen+'<td>'+(i+1)+'</td><td class="ticker">'+esc(r.ticker)+'</td><td class="name">'+esc(r.name)+'</td><td>'+esc(r.country)+'</td><td>'+stateP+'</td>'+bc(growthHtml,'growth')+bc(r40Html,'r40')+bc(gmHtml,'grossMargin')+bc(fmtM(r.mcap),'mcap')+'</tr>';
    }
    if (tab === 'R40') {
      // Tag 205 R40-poisoning visual warnings: red badges on the ticker cell.
      // Visual only — hard-gates do the actual filtering. These catch edge cases
      // where a row passed gates but still has a one-time-effect tell.
      //   ⚠ HighGrowth   : growth > 150% (often Q-spike survivor)
      //   ⚠ FCFM>80%     : FCF margin > 80% (one-time event tell; no anchor > 50%)
      //   ⚠ Margin-Div   : |OpM - FCFM| > 50pp (phantom FCF; R&D-capex pattern)
      const warnBadges = [];
      if (Number.isFinite(r.growth) && r.growth > 150) warnBadges.push('<span class="g-neg" style="font-size:9px;border:1px solid var(--red);padding:0 3px;margin-left:3px" title="Growth '+r.growth.toFixed(0)+'% — likely Q-spike">⚠ HighGr</span>');
      if (Number.isFinite(r.fcfMargin) && r.fcfMargin > 80) warnBadges.push('<span class="g-neg" style="font-size:9px;border:1px solid var(--red);padding:0 3px;margin-left:3px" title="FCFM '+r.fcfMargin.toFixed(0)+'% — one-time event tell">⚠ FCFM&gt;80%</span>');
      if (Number.isFinite(r.opMargin) && Number.isFinite(r.fcfMargin) && Math.abs(r.opMargin - r.fcfMargin) > 50) warnBadges.push('<span class="g-neg" style="font-size:9px;border:1px solid var(--red);padding:0 3px;margin-left:3px" title="|OpM-FCFM|='+Math.abs(r.opMargin-r.fcfMargin).toFixed(0)+'pp — phantom FCF">⚠ Margin-Div</span>');
      // Tag 217g (audit F-217d-2 HIGH XSS-safety fix): R40 ticker cell was
      // the only one in the file that skipped esc() on r.ticker. All current
      // tickers happen to be metachar-free so the bug is latent, but
      // consistency with every other tab is the right call.
      const tkCell = esc(r.ticker) + warnBadges.join('');
      return rowOpen+'<td>'+(i+1)+'</td><td class="ticker">'+tkCell+'</td><td class="name">'+esc(r.name)+'</td><td>'+esc(r.sector)+'</td>'+bc(r40Html,'r40')+bc(growthHtml,'growth')+bc(fcfmHtml,'fcfMargin')+bc(opmHtml,'opMargin')+bc(gmHtml,'grossMargin')+'<td>'+stateP+'</td>'+bc(fmtM(r.mcap),'mcap')+trendCell(r,'R40')+'</tr>';
    }
    if (tab === 'PRE_BREAKOUT') {
      const pb = r.pbScore==null ? '—' : r.pbScore.toFixed(1);
      // Three-signal acceleration column: GM↑ OM↑ Rev↑ — only show active ones.
      const sigs = [];
      if (r.gmaTrend === 'accelerating') sigs.push('<span class="g-pos" title="Gross-Margin accelerating">GM↑</span>');
      if (r.omaTrend === 'accelerating') sigs.push('<span class="g-pos" title="Operating-Margin accelerating">OpM↑</span>');
      if (r.revAccelDelta != null && r.revAccelDelta > 0) sigs.push('<span class="g-pos" title="Revenue YoY accelerating +'+r.revAccelDelta.toFixed(0)+'pp">Rev↑</span>');
      const signalsHtml = sigs.length ? sigs.join(' ') : '<span class="g-mute">—</span>';
      return rowOpen+'<td>'+(i+1)+'</td><td class="ticker">'+esc(r.ticker)+'</td><td class="name">'+esc(r.name)+'</td><td>'+esc(r.sector)+'</td><td>'+stateP+'</td>'+bc(growthHtml,'growth')+bc(gmHtml,'grossMargin')+bc(r40Html,'r40')+'<td style="font-size:10px">'+signalsHtml+'</td>'+bc(fmtM(r.mcap),'mcap')+bc(pb,'pbScore')+'</tr>';
    }
    if (tab === 'WATCH') {
      const score = Math.max(r.hgScore||0, r.qcScore||0, r.bfScore||0).toFixed(1);
      // Reasons priority: explicit hard-gate reasons > NEAR_MISS tier label.
      let reason;
      if (r.watchReasons && r.watchReasons.length) reason = r.watchReasons.join(',');
      else if (r.hgTier==='NEAR_MISS') reason = 'HG NEAR';
      else if (r.qcTier==='NEAR_MISS') reason = 'QC NEAR';
      else if (r.bfTier==='NEAR_MISS') reason = 'BF NEAR';
      else reason = '—';
      return rowOpen+'<td>'+(i+1)+'</td><td class="ticker">'+esc(r.ticker)+'</td><td class="name">'+esc(r.name)+'</td><td style="font-size:10px">'+reason+'</td><td class="num">'+score+'</td><td>'+stateP+'</td><td class="num">'+growthHtml+'</td><td class="num">'+fmtM(r.mcap)+'</td></tr>';
    }
    return '';
  }

  // Per-tab explainer text (rendered above the table when the tab activates).
  const TAB_EXPLAINERS = {
    'BF': 'Warren Buffett-style value-compounder filter (literaturgestützt: Berkshire Letters 1977–2024 + Hagstrom + Damodaran). 14-Punkt-Komposit (10 quantitative T1–T10: ROE, ROIC, Debt, EPS-Acceleration, FCF, OE, Margins, E/P, Hurdle Rate, One-Dollar-Premise + 3 qualitative Q1–Q3: Moat, Pricing-Power, Consistency + 1 Industrie-Exclusion X1). Owner-Earnings (Buffett 1986): NI + D&A + non-cash − Maint-Capex − ΔWC > 0 und wachsend. DCF Margin-of-Safety: ≥25% Discount-to-Intrinsic UND Hurdle-Rate ≥15% (3-Stage DCF mit Gordon-Growth Terminal). Strict-Mode: ✓ in der Passed-Spalte heißt alle 3 MUST gleichzeitig erfüllt — heute meist sehr selten, weil das Universum von Premium-Multiples dominiert wird.',
    'PRE_BREAKOUT': 'Companies recently turning profitable with accelerating growth. These are the future compounders — before the market prices in the quality improvement. Historical examples: PLTR (TURNAROUND→HG mid-2023), CRDO (2022), ALAB (2023).',
    'WATCH': 'Stocks flagged by hard-gates (Q-Spike, Loss>50%Rev, Metric-Divergence, Closed-End-Trust, DQ-D) and NEAR_MISS tier — explicitly held out of HG/QC/SMALL/R40/PRE-BREAKOUT for human review.',
    'SMALL': 'Market cap < $2B, revenue growth > 20%, not in LOSS state. Hunting the next CRDO/ALAB before they hit the radar.',
    'R40': 'Every stock with computable R40. Hard-gated (Q-Spike, Loss>50%Rev, Pre-Commerciality, Closed-End-Trust, NI-Vol, Metric-Divergence, Q-Spike-Fake hgClass, R40-Sanity-Cap, DQ-D) — but READ THE FLAGS: ⚠ FCFM>80% or ⚠ HighGrowth or ⚠ Margin-Div badges indicate one-time-effect tells even within passing stocks. Sort uses penalized R40 (raw × (1 - dq_penalty - q_spike_penalty - margin_div_penalty)).',
    'SECTOR': 'Sector heatmap. Rows = sectors (clean stocks only — WATCH-tab outliers excluded). Columns = median of each metric across the sector. Cell color is the GLOBAL percentile rank of that sector-median (green = top quartile of sectors, red = bottom). Hover a cell for N=count. GP/TA = Novy-Marx gross-profitability (annual gross profit / total assets). ROIC% = sector-relative percentile rank (0-100).'
  };

  // Tag 210g: Sector-heatmap helpers — compute medians per sector across the
  // universe of tabbed rows (everyone who appears in at least one of HG/QC/
  // SMALL/R40/PRE_BREAKOUT). WATCH-only rows excluded (they're hard-gate
  // outliers; including them would poison the medians). Memoised; the data
  // is static for the lifetime of the page load.
  let _sectorHeatmapCache = null;
  function _median(arr) {
    const xs = arr.filter(v => v != null && Number.isFinite(v)).slice().sort((a,b) => a-b);
    if (xs.length === 0) return null;
    const mid = Math.floor(xs.length / 2);
    return (xs.length % 2 === 0) ? (xs[mid-1] + xs[mid]) / 2 : xs[mid];
  }
  function _rowMetric(r, key) {
    if (key === 'score')   return (r.hgScore != null) ? r.hgScore : (r.qcScore != null ? r.qcScore : r.bfScore);
    if (key === 'r40')     return r.r40;
    if (key === 'fcfm')    return r.fcfMargin;
    if (key === 'growth')  return r.growth;
    if (key === 'roicPct') {
      // sector-relative-roic exposes value = 0-100 rank ONLY when computable=true.
      // When the sector-medians-auto.json file hasn't been re-populated with
      // p75 keys (pre-Tag-209b), the method returns computable=false but still
      // stores the raw ROIC ratio in value (.0..1). Two value spaces must NOT
      // be mixed in the same median.
      // Decision: when computable=true, treat value as a 0-100 rank. When false,
      // treat value as a raw ratio and convert to a percentage (multiply by 100)
      // so the column reads consistently as "%" across rows. _formatRoic below
      // chooses the right printer.
      const m = r.results && r.results['sector-relative-roic'];
      if (!m || m.value == null || !Number.isFinite(m.value)) return null;
      // Detect rank vs ratio: ranks are in [0,100], ratios in [-1,1]ish.
      // Use computable as the authoritative flag.
      if (m.computable) return m.value;       // already 0-100 rank
      return m.value * 100;                    // raw ratio → %
    }
    if (key === 'gpta') {
      const m = r.results && r.results['gross-profitability'];
      if (!m || m.value == null) return null;
      return m.value;
    }
    return null;
  }
  function buildSectorHeatmap() {
    if (_sectorHeatmapCache) return _sectorHeatmapCache;
    // Universe: rows in HG/QC/SMALL/R40/PRE_BREAKOUT (clean stocks).
    const cleanTabs = ['HG','QC','BF','SMALL','R40','PRE_BREAKOUT'];
    const seen = new Set();
    const universe = [];
    for (const t of cleanTabs) {
      for (const r of (TABS[t] || [])) {
        if (!seen.has(r.ticker)) { seen.add(r.ticker); universe.push(r); }
      }
    }
    // Group by sector.
    const bySector = {};
    for (const r of universe) {
      const s = r.sector || '—';
      if (s === '—') continue;
      (bySector[s] = bySector[s] || []).push(r);
    }
    const metrics = [
      { k:'score',   label:'Score',    fmt:(v) => v.toFixed(1),     dir:'higher' },
      { k:'r40',     label:'R40',      fmt:(v) => v.toFixed(1),     dir:'higher' },
      { k:'fcfm',    label:'FCFM%',    fmt:(v) => v.toFixed(1)+'%', dir:'higher' },
      { k:'growth',  label:'RevGr%',   fmt:(v) => v.toFixed(1)+'%', dir:'higher' },
      { k:'roicPct', label:'ROIC%',    fmt:(v) => v.toFixed(0),     dir:'higher' },
      { k:'gpta',    label:'GP/TA',    fmt:(v) => v.toFixed(2),     dir:'higher' }
    ];
    // Per-sector medians.
    const rows = [];
    for (const sector of Object.keys(bySector).sort()) {
      const stocks = bySector[sector];
      const row = { sector, n: stocks.length, vals: {} };
      for (const m of metrics) {
        row.vals[m.k] = _median(stocks.map(r => _rowMetric(r, m.k)));
      }
      rows.push(row);
    }
    // Cross-sector percentile rank per metric (color scale uses where THIS
    // sector's median ranks among all sector medians for that metric).
    for (const m of metrics) {
      const allVals = rows.map(r => r.vals[m.k]).filter(v => v != null && Number.isFinite(v));
      const sorted = allVals.slice().sort((a,b) => a-b);
      for (const r of rows) {
        const v = r.vals[m.k];
        if (v == null || !Number.isFinite(v) || sorted.length < 2) {
          r.vals['_pct_' + m.k] = null; continue;
        }
        // Position of v in sorted (count of values strictly less than v) /
        // (n-1). "higher = better" mapping → green at top, red at bottom.
        let count = 0;
        for (const x of sorted) { if (x < v) count++; }
        const pct = count / (sorted.length - 1);  // 0..1
        r.vals['_pct_' + m.k] = pct;
      }
    }
    _sectorHeatmapCache = { rows, metrics };
    return _sectorHeatmapCache;
  }
  // Map percentile (0..1) → background color. Uses the saturation-down trick
  // from heatmap UX research: mid-range stays near-neutral so the eye picks
  // out extremes immediately. Same hue as the row-tint signal palette.
  function _heatColor(pct) {
    if (pct == null) return '';
    // 0.0 = deep red, 0.5 = neutral, 1.0 = deep green
    let r, g, b;
    if (pct <= 0.5) {
      // red → neutral
      const t = pct / 0.5;  // 0..1
      r = 255; g = Math.round(61 + (255-61)*t); b = Math.round(90 + (255-90)*t);
      // alpha proportional to distance from 0.5
      const a = (1 - pct/0.5) * 0.35;
      return 'background:rgba(255,61,90,'+a.toFixed(2)+');';
    } else {
      const t = (pct - 0.5) / 0.5;
      const a = t * 0.35;
      return 'background:rgba(0,204,136,'+a.toFixed(2)+');';
    }
  }
  function renderSectorHeatmap() {
    const { rows, metrics } = buildSectorHeatmap();
    if (rows.length === 0) {
      document.getElementById('table').innerHTML = '<div style="padding:24px;color:var(--text-2);font-family:var(--mono);">No sector data — clean-stock universe is empty.</div>';
      document.getElementById('pageInfo').textContent = '';
      document.getElementById('prevPage').disabled = true;
      document.getElementById('nextPage').disabled = true;
      document.getElementById('summary').innerHTML = '<strong>0</strong> sectors · Updated: '+DATA.generatedAt;
      return;
    }
    let html = '<table class="dt"><thead><tr>';
    html += '<th style="width:200px">Sector</th>';
    html += '<th class="num" style="width:50px">N</th>';
    for (const m of metrics) html += '<th class="num" style="width:90px">'+m.label+'</th>';
    html += '</tr></thead><tbody>';
    for (const row of rows) {
      html += '<tr class="row">';
      html += '<td>'+esc(row.sector)+'</td>';
      html += '<td class="num g-mute">'+row.n+'</td>';
      for (const m of metrics) {
        const v = row.vals[m.k];
        const pct = row.vals['_pct_' + m.k];
        const tint = _heatColor(pct);
        const cell = (v == null || !Number.isFinite(v)) ? '—' : m.fmt(v);
        const title = 'N='+row.n+' · '+m.label+' median for '+row.sector+(pct!=null?' · sector-rank '+(pct*100).toFixed(0)+'%':'');
        html += '<td class="num" style="'+tint+'" title="'+esc(title)+'">'+cell+'</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    document.getElementById('table').innerHTML = html;
    document.getElementById('summary').innerHTML = '<strong>'+rows.length+'</strong> sectors · clean-stock universe · Updated: '+DATA.generatedAt;
    document.getElementById('pageInfo').textContent = '';
    document.getElementById('prevPage').disabled = true;
    document.getElementById('nextPage').disabled = true;
    // Heatmap rows are not clickable to detail modal — keep behavior clean.
  }

  function renderTable(){
    // Tag 210g: SECTOR tab bypasses the standard filter/sort/paginate pipeline.
    // It's a pre-aggregated cross-sector view, not a stock list. We still call
    // renderActiveChips() at the bottom so the chip bar stays in sync, but the
    // chips don't filter the heatmap (filters target stock rows, not sectors).
    if (activeTab === 'SECTOR') {
      currentList = [];
      const explEl = document.getElementById('explainer');
      const exp = TAB_EXPLAINERS['SECTOR'];
      if (exp) { explEl.innerHTML = '<em>' + exp + '</em>'; explEl.style.display = 'block'; }
      else { explEl.style.display = 'none'; }
      renderSectorHeatmap();
      renderActiveChips();
      return;
    }
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

    // Tag 232b-2: trend empty-state banner. Show whenever zero rows in the
    // current view have a computable Δ7d delta — that's the signal Karl sees
    // as "Trend ist leer". Two underlying causes get the same banner:
    //   1. score-history/ dir entirely empty (no vintages on disk yet)
    //   2. <2 vintages with a >=7d gap exist (deltas still incomputable)
    // Banner copy explains both cases so users don't read "—" as a bug.
    const trendBannerEl = document.getElementById('trend-empty-banner');
    if (trendBannerEl) {
      const hasAnyDelta = list.some(r => r.scoreHistory && Number.isFinite(r.scoreHistory.deltaScore7d));
      trendBannerEl.style.display = (list.length > 0 && !hasAnyDelta) ? 'block' : 'none';
    }

    // Tag 212c: percentile-rank maps are computed over the FULL filtered list
    // (not just the current page) so bar widths reflect each row's rank within
    // everything the user is currently looking at — not just this page.
    const pctMaps = buildPercentileMaps(list, activeTab);

    // Tag 223b: per-column hide via CSS nth-child rules. Rows are still
    // rendered with all cells (cheaper than rewriting six tab-specific
    // renderRow branches) — we just hide the header + every cell at the
    // same column index. Visible "#" column is always col 1; user toggles
    // are 1-indexed by tabColumns().
    let html = '';
    const hideIdx = [];
    for (let i = 0; i < cols.length; i++) {
      if (isColHidden(activeTab, cols[i].k)) hideIdx.push(i + 1);
    }
    if (hideIdx.length) {
      let css = '';
      for (const ci of hideIdx) {
        css += 'table.dt th:nth-child(' + ci + '),table.dt td:nth-child(' + ci + '){display:none}';
      }
      html += '<style>' + css + '</style>';
    }
    html += '<table class="dt"><thead><tr>';
    // Tag 223b: sortable headers + aria-sort indicators. Click toggles sort.
    const sortKeyMap = {
      'Score':'score','R40':'r40','RevGr%':'growth','FCFM%':'fcfMargin',
      'OpM%':'opMargin','GrossM%':'grossMargin','MCap':'mcap','PB-Score':'pbScore'
    };
    // Tag 231b-4: header tooltips for jargon columns — surfaced via native
    // title="" (no external lib). Click-to-sort still works; the browser shows
    // the tooltip on hover-without-click after a short delay. Definitions
    // mirror what the modal already explains, just compressed for hover.
    const HEADER_TOOLTIPS = {
      'Score':    'Mode score (0-100). HG tab = Hypergrowth mode; QC tab = Quality-Compounder mode.',
      'R40':      'Rule of 40: Revenue YoY % + FCF Margin %. >40 healthy; >60 elite; <0 distressed. Sorted with a penalty for suspect rows (Q-spike, margin-divergence, DQ grade).',
      'RevGr%':   'Revenue growth year-over-year (most recent TTM vs. prior TTM).',
      'GrossM%':  'Gross margin = (Revenue - COGS) / Revenue. Quality moat indicator.',
      'OpM%':     'Operating margin = Operating Income / Revenue.',
      'FCFM%':    'Free-Cash-Flow margin TTM = FCF / Revenue. Cash quality, harder to manipulate than GAAP earnings.',
      'MCap':     'Market capitalisation (shares outstanding x last close).',
      'PB-Score': 'Pre-Breakout composite (0-100): growth + margin + R40 + acceleration bonuses. Higher = stronger inflection signal.',
      'State':    'Profitability state: LOSS (deep loss), TURNAROUND (improving), RECENT (just hit profit), STABLE (durable profit), NA (insufficient data).',
      'Reason':   'Why this stock was hard-gated into WATCH instead of HG/QC/SMALL/R40/PRE-BREAKOUT (e.g. Q-SPIKE, LOSS>50%REV, DATA-D).',
      'Reasons':  'Why this stock was hard-gated into WATCH instead of HG/QC/SMALL/R40/PRE-BREAKOUT.',
      'Trend':    'Last 30 days of mode score: sparkline + delta-7d badge.',
      'Signals':  'Acceleration signals: GM↑ (gross-margin trending up), OpM↑ (operating-margin trending up), Rev↑ (revenue YoY re-accelerating).'
    };
    for (const c of cols) {
      const skKey = sortKeyMap[c.k];
      const isSortable = !!skKey;
      const sortAttr = isSortable ? (sortKey === skKey ? ' aria-sort="descending"' : ' aria-sort="none"') : '';
      const cls = (c.num ? 'num ' : '') + (isSortable ? 'sortable' : '');
      const dataAttr = isSortable ? ' data-sortkey="' + skKey + '"' : '';
      const tip = HEADER_TOOLTIPS[c.k];
      const sortHint = isSortable ? ' (click to sort)' : '';
      const titleAttr = tip ? ' title="' + esc(tip + sortHint) + '"' : (isSortable ? ' title="Click to sort by ' + esc(c.k) + '"' : '');
      html += '<th' + (cls ? ' class="' + cls.trim() + '"' : '') + sortAttr + dataAttr + titleAttr
            + ' scope="col" style="width:' + c.w + 'px">' + c.k + '</th>';
    }
    html += '</tr></thead><tbody>';
    for (let i=0;i<slice.length;i++) html += renderRow(slice[i], (page-1)*PAGE_SIZE + i, activeTab, pctMaps);
    html += '</tbody></table>';
    // Tag 211g empty-state polish — show a centered "No matches" when filters
    // shrink the list to zero rows. Avoids a blank white expanse.
    // Tag 223b: suggest concrete filter relaxations based on current active state.
    if (slice.length === 0) {
      const hints = [];
      const dqAll = ['A+','A','B','C','D'];
      const dqOn = dqAll.filter(g => filterDQ[g]);
      if (dqOn.length < 3) hints.push('include lower data-quality grades (C, D)');
      const stateOff = Object.keys(filterState).filter(k => !filterState[k]);
      if (stateOff.length) hints.push('toggle on state pills: ' + stateOff.join(', '));
      // Tag 232b-3: cap-buckets-off hint removed; Cap≥ input is the new filter.
      const secOffNames = Object.keys(filterSectors).filter(s => !filterSectors[s]);
      if (secOffNames.length > 0) hints.push('include excluded sectors: ' + secOffNames.map(s => SECTOR_LABELS[s] || s).join(', '));
      const ctryOffNames = Object.keys(filterCountries).filter(c => !filterCountries[c]);
      if (ctryOffNames.length > 0) hints.push('include excluded countries: ' + (ctryOffNames.length <= 5 ? ctryOffNames.join(', ') : ctryOffNames.slice(0,5).join(', ') + '... and ' + (ctryOffNames.length-5) + ' more'));
      if (filterMinR40 !== '' || filterMaxR40 !== '') hints.push('clear R40 min/max');
      if (filterMin !== '') hints.push('clear Tab Min');
      if (filterMinFcfm !== '') hints.push('lower or clear FCFM≥ filter (currently ' + filterMinFcfm + '%)');
      if (filterMinGrowth !== '') hints.push('lower or clear Growth≥ filter (currently ' + filterMinGrowth + '%)');
      if (filterIpoMin !== '' || filterIpoMax !== '') hints.push('widen or clear IPO-year filter');
      if (onlyGaap) hints.push('uncheck GAAP+');
      if (onlyFcf) hints.push('uncheck FCF+');
      const hintHtml = hints.length
        ? '<div style="margin-top:10px;font-size:11px;color:var(--text-1);font-style:normal;">Try: ' + hints.slice(0,3).join(' · ') + '</div>'
        : '';
      html += '<div class="empty-state"><div class="dash">—</div>No matches in ' + activeTab + ' tab.' + hintHtml + '</div>';
    }
    document.getElementById('table').innerHTML = html;

    document.getElementById('pageInfo').textContent = 'Page '+page+' of '+totalPages;
    document.getElementById('prevPage').disabled = page <= 1;
    document.getElementById('nextPage').disabled = page >= totalPages;
    // Tag 209e Upgrade 1: refresh active-filter chip bar.
    renderActiveChips();
  }

  // ------- modal -------
  function spark(values, opts){
    // values newest-first; reverse for left-to-right oldest-to-newest
    const vs = values.filter(v => v != null && Number.isFinite(v)).slice().reverse();
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
    html += '<div><span class="tk">'+esc(r.ticker)+'</span> <span class="nm">'+esc(r.name)+'</span><div class="meta">'+esc(r.sector)+' · '+esc(r.industry)+' · '+esc(r.country)+'</div></div>';
    const score = activeTab==='QC' ? r.qcScore
      : activeTab==='HG' ? r.hgScore
      : activeTab==='BF' ? r.bfScore
      : Math.max(r.hgScore||0, r.qcScore||0, r.bfScore||0);
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
    if (r.cetFail) sigBadges.push('<span style="color:var(--red);border:1px solid var(--red);padding:1px 5px;font-size:10px">TRUST</span>');
    // Tag 206g (Agent E HIGH-2): modal sigBadges parity with row-level badges.
    if (r.niVolFail) sigBadges.push('<span style="color:var(--red);border:1px solid var(--red);padding:1px 5px;font-size:10px">NI-VOL</span>');
    if (r.preCommFail) sigBadges.push('<span style="color:var(--red);border:1px solid var(--red);padding:1px 5px;font-size:10px">PRE-COMM</span>');
    if (r.r40SanityFail) sigBadges.push('<span style="color:var(--red);border:1px solid var(--red);padding:1px 5px;font-size:10px">R40-SANITY</span>');
    if (r.revShockFail) sigBadges.push('<span style="color:var(--red);border:1px solid var(--red);padding:1px 5px;font-size:10px">REV-SHOCK</span>');
    if (r.gmaTrend === 'accelerating') sigBadges.push('<span style="color:var(--green);border:1px solid var(--green);padding:1px 5px;font-size:10px">GM↑</span>');
    if (r.omaTrend === 'accelerating') sigBadges.push('<span style="color:var(--green);border:1px solid var(--green);padding:1px 5px;font-size:10px">OpM↑</span>');
    if (r.revAccelDelta != null && r.revAccelDelta > 0) sigBadges.push('<span style="color:var(--green);border:1px solid var(--green);padding:1px 5px;font-size:10px">Rev-Accel +'+r.revAccelDelta.toFixed(0)+'pp</span>');
    html += '<div class="meta">Score: '+(score!=null?score.toFixed(1):'—')+' · <span class="pill '+r.state+'">'+r.state+'</span> · MCap '+fmtM(r.mcap)+'</div>';
    if (sigBadges.length) html += '<div class="meta" style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px;">'+sigBadges.join('')+'</div>';
    // Tag 231b-5: external research jump-links + copy-to-clipboard ticker.
    // One-click handoff to Yahoo/StockAnalysis/TradingView/SEC for deeper
    // research without leaving the dashboard's keyboard flow. All open in a
    // new tab (rel=noopener for security). SEC EDGAR link uses the ticker
    // search endpoint; non-US tickers may not resolve but the link degrades
    // gracefully (search page shows no results, user can retry).
    // urlTicker: Yahoo accepts the raw ticker incl. exchange suffix
    // (e.g. ASML.AS) but a few exchanges need normalization. Keep as-is.
    const urlTk = encodeURIComponent(r.ticker);
    const bareTk = encodeURIComponent(r.ticker.split('.')[0]);
    const extLinks = [
      ['Yahoo',  'https://finance.yahoo.com/quote/' + urlTk],
      ['SA',     'https://stockanalysis.com/stocks/' + bareTk.toLowerCase() + '/'],
      ['TV',     'https://www.tradingview.com/symbols/' + bareTk + '/'],
      ['SEC',    'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' + bareTk + '&type=10-K&dateb=&owner=include&count=10']
    ];
    let linksHtml = '<div class="meta" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center;">';
    linksHtml += '<button type="button" id="copyTk" class="ext-link" aria-label="Copy ticker '+esc(r.ticker)+' to clipboard" title="Copy ticker to clipboard">⧉ '+esc(r.ticker)+'</button>';
    for (const [label, url] of extLinks) {
      linksHtml += '<a class="ext-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer" title="Open in '+esc(label === 'SA' ? 'StockAnalysis.com' : label === 'TV' ? 'TradingView' : label)+'">'+esc(label)+' ↗</a>';
    }
    linksHtml += '</div>';
    html += linksHtml;
    // Tag 223b: aria-labels on icon-only modal nav buttons.
    html += '<div class="right">'
          + '<button id="prevC" type="button" aria-label="Previous stock (Left arrow)" title="Previous stock (Left arrow)">← Prev</button>'
          + '<button id="closeM" type="button" class="close-btn" aria-label="Close modal (Escape)" title="Close (Esc)">✕ ESC</button>'
          + '<button id="nextC" type="button" aria-label="Next stock (Right arrow)" title="Next stock (Right arrow)">Next →</button>'
          + '</div>';
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

    // Section D: Score + Score-History (Tag 203 — sparkline + Δ7d/Δ30d badges).
    // History data comes from r.scoreHistory = { deltaScore7d, deltaScore30d, history[] }.
    // Render rules (design §5): green ≥ +5, red ≤ -5, mute otherwise.
    // Falls back to placeholder text on Day-1 (history empty) so the modal
    // never breaks when score-history hasn't been populated yet.
    html += '<h3 class="sec">Score</h3>';
    html += '<div style="font-family:var(--mono);font-size:12px;color:var(--text-1);">HG Score: '+(r.hgScore!=null?r.hgScore.toFixed(1):'—')+' ('+(r.hgTier||'—')+') &nbsp;·&nbsp; QC Score: '+(r.qcScore!=null?r.qcScore.toFixed(1):'—')+' ('+(r.qcTier||'—')+') &nbsp;·&nbsp; BF Score: '+(r.bfScore!=null?r.bfScore.toFixed(1):'—')+' ('+(r.bfTier||'—')+(r.bfPassed?' ✓':'')+') &nbsp;·&nbsp; PB Score: '+(r.pbScore!=null?r.pbScore.toFixed(1):'—')+'</div>';
    const sh = r.scoreHistory || { history: [], deltaScore7d: null, deltaScore30d: null };
    function _dBadge(label, v) {
      if (v == null || !Number.isFinite(v)) return '<span style="color:var(--text-2);border:1px solid var(--border);padding:1px 5px;font-size:10px;margin-right:4px;">'+label+': —</span>';
      const color = (v >= 5) ? 'var(--green)' : (v <= -5 ? 'var(--red)' : 'var(--text-1)');
      const sign = v >= 0 ? '+' : '';
      return '<span style="color:'+color+';border:1px solid '+color+';padding:1px 5px;font-size:10px;margin-right:4px;">'+label+': '+sign+v.toFixed(1)+'</span>';
    }
    html += '<div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">';
    html += _dBadge('Δ7d', sh.deltaScore7d) + _dBadge('Δ30d', sh.deltaScore30d);
    html += '<span style="color:var(--text-2);font-size:10px;">('+(sh.history ? sh.history.length : 0)+' daily snapshots)</span>';
    html += '</div>';
    if (sh.history && sh.history.length >= 2) {
      // Reuse spark() — pass hgScore series in newest-first order (spark()
      // reverses to oldest→newest). history[] is ascending date, so reverse.
      const hgSeries = sh.history.slice().reverse().map(e => (e && Number.isFinite(e.hgScore)) ? e.hgScore : null);
      html += '<div style="margin-top:6px;"><div class="chart" style="background:var(--bg-2);border:1px solid var(--border);padding:8px;display:inline-block;"><div class="ct" style="font-size:11px;color:var(--text-1);text-transform:uppercase;margin-bottom:4px;">HG Score (last '+sh.history.length+'d)</div>'+spark(hgSeries)+'</div></div>';
    } else {
      html += '<div style="color:var(--text-2);font-size:10px;margin-top:4px;">Score history accumulates daily (need ≥2 snapshots for sparkline).</div>';
    }

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
      // Tag 223b: percentages standardised to 1 decimal across the board.
      html += '<tr><td class="fy">'+fy+'</td><td>'+fmtM(rv)+'</td><td>'+(grRow!=null?(grRow>=0?'+':'')+grRow.toFixed(1)+'%':'—')+'</td><td>'+(gmPct!=null?gmPct.toFixed(1)+'%':'—')+'</td><td>'+(omPct!=null?omPct.toFixed(1)+'%':'—')+'</td><td>'+(fmPct!=null?fmPct.toFixed(1)+'%':'—')+'</td><td>'+(niPct!=null?niPct.toFixed(1)+'%':'—')+'</td></tr>';
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

    // Section G: Peers (Tag 210h). 5 closest peers by:
    //   - same sector
    //   - mcap within ±50% of subject
    //   - sort by sector-relative-roic percentile DESC, take top 5
    // Excludes the subject itself. Each row clickable → re-renders the modal
    // for that peer (reuses showModal()). Falls back gracefully when the
    // subject has no sector, zero mcap, or no qualifying peers.
    html += '<h3 class="sec">Peers</h3>';
    const peerRoicPct = (x) => {
      // Sort key: prefer the 0-100 sector-rank when available (computable=true);
      // fall back to raw ROIC ratio (still the same sector → still a sane
      // sort within the same peer group) when the percentile data is missing
      // (sector-medians-auto.json hasn't been re-populated after Tag 209b).
      // Both are monotonic in the underlying ROIC, so the top-5 ordering
      // matches what the percentile would produce anyway.
      const m = x.results && x.results['sector-relative-roic'];
      if (!m || m.value == null || !Number.isFinite(m.value)) return -Infinity;
      return m.value;
    };
    const peerGpTa = (x) => {
      const m = x.results && x.results['gross-profitability'];
      return (m && m.value != null && Number.isFinite(m.value)) ? m.value : null;
    };
    let peers = [];
    if (r.sector && r.sector !== '—' && r.mcap > 0) {
      const lo = r.mcap * 0.5, hi = r.mcap * 1.5;
      const all = Object.values(ROWS);
      peers = all.filter(p =>
        p.ticker !== r.ticker
        && p.sector === r.sector
        && p.mcap > 0
        && p.mcap >= lo && p.mcap <= hi
      );
      peers.sort((a, b) => peerRoicPct(b) - peerRoicPct(a));
      peers = peers.slice(0, 5);
    }
    if (peers.length === 0) {
      const why = (!r.sector || r.sector === '—') ? 'no sector classification'
        : (!(r.mcap > 0))                          ? 'no market-cap data'
        : 'no peers in ±50% mcap band within sector';
      html += '<div style="color:var(--text-2);font-size:11px;font-family:var(--mono);margin-top:4px;">No peers — '+why+'.</div>';
    } else {
      html += '<div class="annual" style="margin-top:6px;"><table><thead><tr>'
        + '<th style="text-align:left;">Ticker</th>'
        + '<th>MCap</th><th>R40</th><th>FCFM%</th><th>GP/TA</th><th>ΔScore</th>'
        + '</tr></thead><tbody>';
      const subjScore = (r.hgScore != null) ? r.hgScore : (r.qcScore != null ? r.qcScore : (r.bfScore != null ? r.bfScore : null));
      for (const p of peers) {
        const pScore = (p.hgScore != null) ? p.hgScore : (p.qcScore != null ? p.qcScore : (p.bfScore != null ? p.bfScore : null));
        const dScore = (subjScore != null && pScore != null) ? (pScore - subjScore) : null;
        const dCls = (dScore == null) ? 'g-mute' : (dScore >= 0 ? 'g-pos' : 'g-neg');
        const dStr = (dScore == null) ? '—' : (dScore >= 0 ? '+' : '') + dScore.toFixed(1);
        const gpta = peerGpTa(p);
        const gptaStr = (gpta == null) ? '—' : gpta.toFixed(2);
        const r40Str = (p.r40 != null && Number.isFinite(p.r40)) ? p.r40.toFixed(1) : '—';
        const fcfmStr = (p.fcfMargin != null && Number.isFinite(p.fcfMargin)) ? p.fcfMargin.toFixed(1)+'%' : '—';
        // data-peer attribute used by the delegated click handler below.
        html += '<tr class="peer-row" data-peer="'+esc(p.ticker)+'" style="cursor:pointer;">'
          + '<td class="fy" style="text-align:left;color:var(--text-0);font-weight:600;">'+esc(p.ticker)+' <span style="color:var(--text-2);font-weight:normal;font-family:var(--ui);font-size:10px;margin-left:4px;">'+esc(p.name)+'</span></td>'
          + '<td>'+fmtM(p.mcap)+'</td>'
          + '<td>'+r40Str+'</td>'
          + '<td>'+fcfmStr+'</td>'
          + '<td>'+gptaStr+'</td>'
          + '<td class="'+dCls+'">'+dStr+'</td>'
          + '</tr>';
      }
      html += '</tbody></table></div>';
      html += '<div style="color:var(--text-2);font-size:10px;margin-top:4px;font-family:var(--mono);">Same sector · mcap ±50% · top 5 by sector-relative ROIC percentile. Click a row to navigate.</div>';
    }

    c.innerHTML = html;
    m.classList.add('show');
    m.setAttribute('aria-hidden', 'false');
    document.getElementById('closeM').onclick = closeModal;
    document.getElementById('prevC').onclick = () => navModal(-1);
    document.getElementById('nextC').onclick = () => navModal(1);
    // Tag 231b-5: copy-ticker button. Uses navigator.clipboard when available
    // (HTTPS / localhost / file:// in modern browsers) and falls back to a
    // textarea + execCommand path for older / file:// without clipboard API.
    const copyBtn = document.getElementById('copyTk');
    if (copyBtn) copyBtn.onclick = () => {
      const tk = r.ticker;
      const done = () => {
        const original = copyBtn.textContent;
        copyBtn.classList.add('copied');
        copyBtn.textContent = '✓ copied';
        setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.textContent = original; }, 1100);
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(tk).then(done, () => fallback());
        } else {
          fallback();
        }
      } catch (e) { fallback(); }
      function fallback() {
        const ta = document.createElement('textarea');
        ta.value = tk; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* give up silently */ }
        document.body.removeChild(ta);
      }
    };
    // Tag 210h: peer-row click → re-open modal for that peer ticker. Uses
    // delegation on the rendered modal content so we don't need per-row
    // listeners. Click bubbles from <td> → closest tr.peer-row.
    // Tag 211g: peer-row hover now via CSS (.annual tr.peer-row:hover) — drop
    // the inline mouseover/mouseout pair. Click handler stays; also wire
    // Enter/Space for keyboard activation (rows get tabindex below).
    const peerRows = c.querySelectorAll('tr.peer-row');
    peerRows.forEach(pr => {
      pr.setAttribute('tabindex', '0');
      pr.addEventListener('click', () => {
        const tk = pr.getAttribute('data-peer');
        if (tk) showModal(tk);
      });
      pr.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const tk = pr.getAttribute('data-peer');
          if (tk) showModal(tk);
        }
      });
    });
  }

  function closeModal(){
    const m = document.getElementById('modal');
    m.classList.remove('show');
    m.setAttribute('aria-hidden', 'true');
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
                    (h.qcTier && h.qcTier !== 'REJECT' ? 'QC' :
                    (h.bfPassed ? 'BF' : ''));
      // Tag 217g (audit F-217d-1 HIGH XSS-safety fix): use esc() on ticker
      // and name. 124+ stocks have '&' or "'" in name (Sun Hung Kai & Co.,
      // AVIC Xi'an Aircraft, Goldwind Science&Technology) — without esc()
      // they render visually broken ("&amp;") at best and could enable
      // injection if Yahoo ever passes through angle brackets.
      // Tag 223b: scores now 1 decimal everywhere.
      html += '<div class="sr" role="option" data-tk="'+esc(h.ticker)+'"><strong>'+esc(h.ticker)+'</strong> '+esc(h.name)+(badge?'<span class="badge">'+badge+'</span>':'')+' <span class="badge">'+(h.hgScore!=null?'HG '+h.hgScore.toFixed(1):'')+(h.qcScore!=null?(h.hgScore!=null?' / ':'')+'QC '+h.qcScore.toFixed(1):'')+'</span></div>';
    }
    searchResults.innerHTML = html || '<div class="sr">no results</div>';
    searchResults.classList.add('show');
  }
  searchInput.addEventListener('input', e => runSearch(e.target.value));
  searchResults.addEventListener('click', e => {
    const t = e.target.closest('.sr');
    if (t && t.dataset.tk) { searchResults.classList.remove('show'); searchInput.value=''; showModal(t.dataset.tk); }
  });

  // ------- Tag 213c/d: command palette (Ctrl+K / Cmd+K / "/") -------
  // Bloomberg-style keyboard-first overlay. Three modes selected by prefix:
  //   ""       fuzzy ticker / company search across ALL tabs (Enter → modal)
  //   ">"      command mode (>tab, >filter, >preset, >theme)
  //   "?"      help mode (lists all commands)
  //
  // localStorage schema (Tag 213d):
  //   key:   "screener.preset.<NAME>"
  //   value: JSON.stringify({
  //            activeTab, filterSector, filterCountry, filterMinR40, filterMaxR40,
  //            filterMin, filterIpo, filterState, filterCap, filterDQ,
  //            onlyGaap, onlyFcf, sortKey, savedAt:ISO-string
  //          })
  //   index: "screener.preset.__index" → JSON array of preset names (so >preset
  //          list / delete works without scanning all of localStorage).
  // All storage ops wrapped in try/catch (gracefully degrade if disabled).
  const cpOverlay  = document.getElementById('commandPalette');
  const cpInput    = document.getElementById('cpInput');
  const cpResults  = document.getElementById('cpResults');
  let cpSel = 0;          // currently highlighted result index
  let cpCurrent = [];     // last computed result list

  const TAB_LABELS = {
    HG: 'Hypergrowth', QC: 'Quality-Compounder', BF: 'Buffett', SMALL: 'Small Cap',
    R40: 'Rule of 40', PRE_BREAKOUT: 'Pre-Breakout', WATCH: 'Watch', SECTOR: 'Sector Heatmap'
  };
  // Map common aliases → canonical tab keys (case-insensitive lookup).
  const TAB_ALIASES = {
    hg:'HG', hypergrowth:'HG',
    qc:'QC', quality:'QC', 'quality-compounder':'QC', compounder:'QC',
    bf:'BF', buffett:'BF', buffet:'BF', value:'BF',
    small:'SMALL', smallcap:'SMALL', 'small-cap':'SMALL',
    r40:'R40', 'rule-of-40':'R40', rule40:'R40',
    pre:'PRE_BREAKOUT', prebreakout:'PRE_BREAKOUT', 'pre-breakout':'PRE_BREAKOUT', breakout:'PRE_BREAKOUT',
    watch:'WATCH', watchlist:'WATCH',
    sector:'SECTOR', heatmap:'SECTOR'
  };

  // Storage helpers — every read/write wrapped (private mode, full disk, etc.).
  const PRESET_PREFIX = 'screener.preset.';
  const PRESET_INDEX  = 'screener.preset.__index';
  function presetIndex(){
    try { const v = localStorage.getItem(PRESET_INDEX); return v ? JSON.parse(v) : []; }
    catch (e) { return []; }
  }
  function presetIndexSet(arr){
    try { localStorage.setItem(PRESET_INDEX, JSON.stringify(arr)); } catch (e) { /* ignore */ }
  }
  function presetSnapshot(){
    return {
      activeTab, filterMinR40, filterMaxR40, filterMin,
      // Tag 232b-4: multi-select country (parallel to filterSectors)
      filterCountries: Object.assign({}, filterCountries),
      // Tag 232b-1/2: persist new filter state (sectors object + numeric inputs +
      // continent + mcap min).
      filterSectors: Object.assign({}, filterSectors),
      filterContinent, filterMinMcap,
      filterMinFcfm, filterMinGrowth, filterIpoMin, filterIpoMax,
      filterState: Object.assign({}, filterState),
      // Tag 232b-3: filterCap dropped from preset payload
      filterDQ:    Object.assign({}, filterDQ),
      onlyGaap, onlyFcf, sortKey,
      savedAt: new Date().toISOString()
    };
  }
  function presetApply(snap){
    if (!snap) return false;
    if (snap.activeTab && TABS[snap.activeTab]) {
      activeTab = snap.activeTab;
      document.querySelectorAll('.tabs button').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === activeTab);
      });
    }
    // Tag 232b-1: restore new filter state. Migrate from legacy single-select
    // snap.filterSector string by mapping it to filterSectors{} (set the named
    // sector on, others off) so a pre-Tag-232b preset still loads sanely.
    if (snap.filterSectors && typeof snap.filterSectors === 'object') {
      Object.keys(filterSectors).forEach(s => {
        filterSectors[s] = snap.filterSectors[s] !== false;
      });
    } else if (typeof snap.filterSector === 'string' && snap.filterSector) {
      Object.keys(filterSectors).forEach(s => { filterSectors[s] = (s === snap.filterSector); });
    }
    // Tag 232b-4: restore country multi-select. Migrate legacy single-select
    // snap.filterCountry string to filterCountries{} same way sector did.
    if (snap.filterCountries && typeof snap.filterCountries === 'object') {
      Object.keys(filterCountries).forEach(c => {
        filterCountries[c] = snap.filterCountries[c] !== false;
      });
    } else if (typeof snap.filterCountry === 'string' && snap.filterCountry) {
      Object.keys(filterCountries).forEach(c => { filterCountries[c] = (c === snap.filterCountry); });
    }
    if (typeof snap.filterContinent === 'string') filterContinent = snap.filterContinent;
    if (typeof snap.filterMinMcap !== 'undefined') filterMinMcap = snap.filterMinMcap;
    if (typeof snap.filterMinR40 !== 'undefined') filterMinR40 = snap.filterMinR40;
    if (typeof snap.filterMaxR40 !== 'undefined') filterMaxR40 = snap.filterMaxR40;
    if (typeof snap.filterMin !== 'undefined') filterMin = snap.filterMin;
    if (typeof snap.filterMinFcfm !== 'undefined') filterMinFcfm = snap.filterMinFcfm;
    if (typeof snap.filterMinGrowth !== 'undefined') filterMinGrowth = snap.filterMinGrowth;
    if (typeof snap.filterIpoMin !== 'undefined') filterIpoMin = snap.filterIpoMin;
    if (typeof snap.filterIpoMax !== 'undefined') filterIpoMax = snap.filterIpoMax;
    if (snap.filterState) filterState = Object.assign({LOSS:true,TURNAROUND:true,RECENT:true,STABLE:true,NA:true}, snap.filterState);
    // Tag 232b-3: filterCap restore dropped (snap.filterCap from old presets is ignored)
    if (snap.filterDQ)    filterDQ    = Object.assign({'A+':true,'A':true,'B':true,'C':false,'D':false}, snap.filterDQ);
    if (typeof snap.onlyGaap === 'boolean') onlyGaap = snap.onlyGaap;
    if (typeof snap.onlyFcf  === 'boolean') onlyFcf  = snap.onlyFcf;
    if (typeof snap.sortKey === 'string') sortKey = snap.sortKey;

    // Sync DOM controls so the visible UI matches restored state.
    document.querySelectorAll('.filters .f-state').forEach(b => b.classList.toggle('on', !!filterState[b.dataset.state]));
    // Tag 232b-3: f-cap buttons no longer exist
    document.querySelectorAll('.filters .f-sec-cb').forEach(cb => { cb.checked = filterSectors[cb.dataset.sec] !== false; });
    if (typeof updateSecBtnLabel === 'function') updateSecBtnLabel();
    document.querySelectorAll('.filters .f-dq').forEach(b => b.classList.toggle('on', !!filterDQ[b.dataset.dq]));
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v == null ? '' : v); };
    // Tag 232b-4: sync country popover checkboxes from restored state
    document.querySelectorAll('.filters .f-ctry-cb').forEach(cb => { cb.checked = filterCountries[cb.dataset.ctry] !== false; });
    if (typeof updateCtryBtnLabel === 'function') updateCtryBtnLabel();
    setVal('fContinent', filterContinent); setVal('fMinMcap', filterMinMcap);
    setVal('fMinR40', filterMinR40); setVal('fMaxR40', filterMaxR40); setVal('fMin', filterMin);
    setVal('fMinFcfm', filterMinFcfm); setVal('fMinGrowth', filterMinGrowth);
    setVal('fIpoMin', filterIpoMin); setVal('fIpoMax', filterIpoMax);
    const gEl = document.getElementById('onlyGaap'); if (gEl) gEl.checked = !!onlyGaap;
    const fEl = document.getElementById('onlyFcf');  if (fEl) fEl.checked = !!onlyFcf;
    const sEl = document.getElementById('fSort');    if (sEl) sEl.value = sortKey || 'auto';
    page = 1;
    renderTable();
    return true;
  }
  function presetSave(name){
    if (!name) return { ok:false, msg:'Preset name required' };
    try {
      localStorage.setItem(PRESET_PREFIX + name, JSON.stringify(presetSnapshot()));
      const idx = presetIndex();
      if (idx.indexOf(name) < 0) { idx.push(name); presetIndexSet(idx); }
      return { ok:true, msg:'Saved preset "'+name+'"' };
    } catch (e) { return { ok:false, msg:'Save failed (storage disabled?)' }; }
  }
  function presetLoad(name){
    if (!name) return { ok:false, msg:'Preset name required' };
    try {
      const raw = localStorage.getItem(PRESET_PREFIX + name);
      if (!raw) return { ok:false, msg:'No preset named "'+name+'"' };
      const ok = presetApply(JSON.parse(raw));
      return ok ? { ok:true, msg:'Loaded preset "'+name+'"' } : { ok:false, msg:'Preset data invalid' };
    } catch (e) { return { ok:false, msg:'Load failed' }; }
  }
  function presetDelete(name){
    if (!name) return { ok:false, msg:'Preset name required' };
    try {
      localStorage.removeItem(PRESET_PREFIX + name);
      const idx = presetIndex().filter(n => n !== name);
      presetIndexSet(idx);
      return { ok:true, msg:'Deleted preset "'+name+'"' };
    } catch (e) { return { ok:false, msg:'Delete failed' }; }
  }

  // Command registry — each entry has cmd (prefix), label (help-mode display),
  // and handler(args) that returns an optional toast string.
  const CP_COMMANDS = [
    { cmd:'>tab',           label:'>tab <name>           Switch to tab (hg, qc, smallcap, r40, prebreakout, watch, sector)', handler:cpHandleTab },
    { cmd:'>filter sector', label:'>filter sector <name> Set sector filter (or "clear")',                                   handler:cpHandleFilterSector },
    { cmd:'>filter clear',  label:'>filter clear         Reset all filters',                                                 handler:cpHandleFilterClear },
    { cmd:'>preset save',   label:'>preset save <name>   Save current filter state to localStorage',                         handler:cpHandlePresetSave },
    { cmd:'>preset load',   label:'>preset load <name>   Restore a saved preset',                                            handler:cpHandlePresetLoad },
    { cmd:'>preset list',   label:'>preset list          List saved presets',                                                handler:cpHandlePresetList },
    { cmd:'>preset delete', label:'>preset delete <name> Delete a saved preset',                                             handler:cpHandlePresetDelete },
    { cmd:'>theme light',   label:'>theme light          Switch to light theme',                                             handler:() => { try { applyTheme('light'); localStorage.setItem('screener_theme','light'); } catch(e){ applyTheme('light'); } return 'Theme: light'; } },
    { cmd:'>theme dark',    label:'>theme dark           Switch to dark theme',                                              handler:() => { try { applyTheme('dark'); localStorage.setItem('screener_theme','dark'); } catch(e){ applyTheme('dark'); } return 'Theme: dark'; } }
  ];
  function cpHandleTab(arg){
    const key = (arg || '').trim().toLowerCase().replace(/\s+/g, '');
    const tab = TAB_ALIASES[key] || (TABS[key.toUpperCase()] ? key.toUpperCase() : null);
    if (!tab) return 'Unknown tab: '+arg;
    activeTab = tab; page = 1; filterMin = '';
    const fMinEl = document.getElementById('fMin'); if (fMinEl) fMinEl.value = '';
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    renderTable();
    return 'Tab: '+TAB_LABELS[tab];
  }
  function cpHandleFilterSector(arg){
    // Tag 232b-2: command palette adapter for the checkbox-popover sector filter.
    // "X" selects only X (others off); "clear" or empty resets all to on. Updates
    // both filterSectors{} state and the checkbox DOM.
    const v = (arg || '').trim();
    const secKeys = Object.keys(filterSectors);
    if (!v || v.toLowerCase() === 'clear') {
      secKeys.forEach(s => filterSectors[s] = true);
      document.querySelectorAll('.filters .f-sec-cb').forEach(cb => { cb.checked = true; });
      if (typeof updateSecBtnLabel === 'function') updateSecBtnLabel();
      page = 1; renderTable();
      return 'Sector filter cleared';
    }
    const match = secKeys.find(s => s.toLowerCase() === v.toLowerCase())
               || secKeys.find(s => s.toLowerCase().indexOf(v.toLowerCase()) >= 0);
    if (!match) return 'No sector matching "'+v+'"';
    secKeys.forEach(s => filterSectors[s] = (s === match));
    document.querySelectorAll('.filters .f-sec-cb').forEach(cb => { cb.checked = !!filterSectors[cb.dataset.sec]; });
    if (typeof updateSecBtnLabel === 'function') updateSecBtnLabel();
    page = 1; renderTable();
    return 'Sector: '+match;
  }
  function cpHandleFilterClear(){
    clearAllFilters();
    return 'All filters cleared';
  }
  function cpHandlePresetSave(arg){  const r = presetSave((arg||'').trim());   return r.msg; }
  function cpHandlePresetLoad(arg){  const r = presetLoad((arg||'').trim());   return r.msg; }
  function cpHandlePresetDelete(arg){const r = presetDelete((arg||'').trim()); return r.msg; }
  function cpHandlePresetList(){
    const names = presetIndex();
    return names.length ? 'Presets: '+names.join(', ') : 'No saved presets';
  }

  // Parse the input into {cmdEntry, args}. Longest-match first so ">preset save"
  // beats ">preset" when both prefixes exist.
  function cpResolveCommand(text){
    const t = text.trim();
    if (!t.startsWith('>')) return null;
    const sorted = CP_COMMANDS.slice().sort((a,b) => b.cmd.length - a.cmd.length);
    for (const c of sorted) {
      if (t === c.cmd) return { entry:c, args:'' };
      if (t.toLowerCase().startsWith(c.cmd.toLowerCase() + ' ')) {
        return { entry:c, args:t.slice(c.cmd.length + 1) };
      }
    }
    return null;
  }

  // Build the result list for the current input value.
  function cpQuery(text){
    const q = (text || '').trim();
    // Help mode
    if (q === '?' || q.toLowerCase() === '?help') {
      return CP_COMMANDS.map(c => ({ type:'help', label:c.label, cmd:c.cmd }));
    }
    // Command mode — show matching commands (live filter as user types).
    if (q.startsWith('>')) {
      const ql = q.toLowerCase();
      const matches = CP_COMMANDS.filter(c =>
        c.cmd.toLowerCase().startsWith(ql) || ql.startsWith(c.cmd.toLowerCase())
      );
      // If the input is a fully-formed command (e.g. ">preset list"), the
      // command resolver finds an exact handler — surface it as an executable
      // result so Enter runs it.
      const resolved = cpResolveCommand(q);
      if (resolved) {
        return [{ type:'exec', label:'Run: '+q, resolved }]
          .concat(matches.filter(m => m.cmd !== resolved.entry.cmd).slice(0, 6)
                          .map(c => ({ type:'help', label:c.label, cmd:c.cmd })));
      }
      return matches.slice(0, 12).map(c => ({ type:'help', label:c.label, cmd:c.cmd }));
    }
    // Ticker / company search across ALL tabs.
    if (!q) {
      // Empty input → recent presets + a hint to type something.
      const names = presetIndex().slice(0, 5);
      return names.map(n => ({ type:'preset', name:n, label:'Load preset: '+n }));
    }
    const ql = q.toLowerCase();
    const all = Object.values(ROWS);
    const hits = [];
    for (const r of all) {
      const tk = r.ticker.toLowerCase();
      const nm = (r.name || '').toLowerCase();
      if (tk.includes(ql) || nm.includes(ql)) {
        // Build short list of tabs this ticker appears in for the badge.
        const tabBadges = [];
        for (const t of Object.keys(TABS)) {
          if (TABS[t].some(x => x.ticker === r.ticker)) tabBadges.push(t);
        }
        hits.push({ type:'ticker', row:r, tabBadges });
        if (hits.length >= 30) break;
      }
    }
    return hits;
  }

  function cpRender(){
    const text = cpInput.value;
    cpCurrent = cpQuery(text);
    if (!cpCurrent.length) {
      cpResults.innerHTML = '<div class="cp-empty">No matches. Try a ticker, "&gt;" for commands, or "?" for help.</div>';
      return;
    }
    if (cpSel >= cpCurrent.length) cpSel = 0;
    let html = '';
    for (let i = 0; i < cpCurrent.length; i++) {
      const r = cpCurrent[i];
      const sel = i === cpSel ? ' selected' : '';
      if (r.type === 'ticker') {
        const tk = escHtml(r.row.ticker);
        const nm = escHtml(r.row.name || '');
        const badge = r.tabBadges.length ? r.tabBadges.slice(0,3).join(' ') : '';
        html += '<div class="cp-result'+sel+'" data-idx="'+i+'">'
              +   '<span class="tk">'+tk+'</span>'
              +   '<span class="meta">· '+nm+'</span>'
              +   (badge ? '<span class="kind">'+escHtml(badge)+'</span>' : '')
              + '</div>';
      } else if (r.type === 'help' || r.type === 'exec') {
        html += '<div class="cp-result'+sel+'" data-idx="'+i+'">'
              +   '<span class="meta" style="flex:1;overflow:hidden;text-overflow:ellipsis;">'+escHtml(r.label)+'</span>'
              +   '<span class="kind">'+(r.type === 'exec' ? 'RUN' : 'CMD')+'</span>'
              + '</div>';
      } else if (r.type === 'preset') {
        html += '<div class="cp-result'+sel+'" data-idx="'+i+'">'
              +   '<span class="meta">'+escHtml(r.label)+'</span>'
              +   '<span class="kind">PRESET</span>'
              + '</div>';
      }
    }
    cpResults.innerHTML = html;
    // Scroll the selected row into view.
    const selEl = cpResults.querySelector('.cp-result.selected');
    if (selEl) selEl.scrollIntoView({ block:'nearest' });
  }

  // Tiny HTML escaper for the palette (we don't have a global one in this scope).
  function escHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function cpExecute(r){
    if (!r) return;
    if (r.type === 'ticker') { closePalette(); showModal(r.row.ticker); return; }
    if (r.type === 'preset') { const res = presetLoad(r.name); cpFlash(res.msg); closePalette(); return; }
    if (r.type === 'exec') {
      const msg = r.resolved.entry.handler(r.resolved.args);
      cpFlash(msg);
      // Preset-list output and the help-mode command labels keep the palette
      // open; everything else closes after running.
      if (r.resolved.entry.cmd === '>preset list') { /* keep open so list stays visible */ }
      else closePalette();
      return;
    }
    if (r.type === 'help') {
      // Pre-fill the input with the command so the user can fill in args.
      cpInput.value = r.cmd + ' ';
      cpSel = 0;
      cpRender();
      cpInput.focus();
    }
  }
  // Lightweight toast — reuse the panel hint area so we don't ship a new widget.
  function cpFlash(msg){
    if (!msg) return;
    const hint = cpOverlay.querySelector('.cp-hint');
    if (!hint) return;
    const prev = hint.textContent;
    hint.textContent = msg;
    setTimeout(() => { hint.textContent = prev; }, 1800);
  }

  function openPalette(){
    cpOverlay.classList.add('show');
    cpInput.value = '';
    cpSel = 0;
    cpRender();
    // Focus after the show transition so the browser actually grabs caret.
    setTimeout(() => cpInput.focus(), 0);
  }
  function closePalette(){
    cpOverlay.classList.remove('show');
    cpInput.value = '';
    cpCurrent = [];
    cpSel = 0;
  }
  function togglePalette(){
    if (cpOverlay.classList.contains('show')) closePalette();
    else openPalette();
  }
  // Expose to outer keydown handler (defined just below event-wiring section).
  window._cp = { open:openPalette, close:closePalette, toggle:togglePalette };

  cpInput.addEventListener('input', () => { cpSel = 0; cpRender(); });
  cpInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (cpCurrent.length) { cpSel = (cpSel + 1) % cpCurrent.length; cpRender(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (cpCurrent.length) { cpSel = (cpSel - 1 + cpCurrent.length) % cpCurrent.length; cpRender(); } }
    else if (e.key === 'Enter') { e.preventDefault(); cpExecute(cpCurrent[cpSel]); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  cpResults.addEventListener('click', e => {
    const row = e.target.closest('.cp-result');
    if (!row) return;
    const idx = +row.dataset.idx;
    if (!isNaN(idx)) cpExecute(cpCurrent[idx]);
  });
  // Click on the dim backdrop (outside the panel) closes the palette.
  cpOverlay.addEventListener('click', e => {
    if (e.target === cpOverlay) closePalette();
  });
  // Convenience hoisted bindings — outer keydown handler calls these by name.
  function openPaletteRef(){ openPalette(); }
  function closePaletteRef(){ closePalette(); }
  function togglePaletteRef(){ togglePalette(); }
  // Make sure outer-scope handler can call these (they're in the same closure,
  // so just being declared above is enough — JS hoisting handles it).

  // ------- event wiring -------
  // Tag 223b: extracted into a function so the keyboard chord (g h, g q, ...)
  // can switch tabs without simulating a click.
  function switchToTab(tabKey) {
    if (!TABS[tabKey] && tabKey !== 'SECTOR') return;
    activeTab = tabKey;
    page = 1;
    filterMin = '';
    const fMinEl = document.getElementById('fMin');
    if (fMinEl) fMinEl.value = '';
    document.querySelectorAll('.tabs button').forEach(x => {
      const on = x.dataset.tab === tabKey;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) x.setAttribute('aria-current', 'page');
      else x.removeAttribute('aria-current');
    });
    kbdActiveIdx = -1;  // reset row cursor on tab change
    // Tag 231b-6: persist last-viewed tab so a page reload restores the user's
    // workflow context instead of dumping them back on HG. Skip if storage
    // blocked (private mode / file:// w/ restrictions).
    try { localStorage.setItem('screener_last_tab', tabKey); } catch (e) { /* ignore */ }
    renderTable();
  }
  // Tag 231b-6: restore last-viewed tab from localStorage. Runs once at init,
  // before the initial renderTable() call. Falls back to default HG if the
  // stored tab no longer exists (snapshot dropped to zero, or someone
  // hand-edited storage).
  (function restoreLastTab(){
    try {
      const saved = localStorage.getItem('screener_last_tab');
      if (saved && (TABS[saved] || saved === 'SECTOR')) {
        activeTab = saved;
        document.querySelectorAll('.tabs button').forEach(x => {
          const on = x.dataset.tab === saved;
          x.classList.toggle('active', on);
          x.setAttribute('aria-selected', on ? 'true' : 'false');
          if (on) x.setAttribute('aria-current', 'page');
          else x.removeAttribute('aria-current');
        });
      }
    } catch (e) { /* localStorage blocked — stay on default */ }
  })();
  document.querySelectorAll('.tabs button').forEach(b => {
    b.onclick = () => switchToTab(b.dataset.tab);
  });
  document.querySelectorAll('.filters .f-state').forEach(b => {
    b.onclick = () => {
      filterState[b.dataset.state] = !filterState[b.dataset.state];
      b.classList.toggle('on', filterState[b.dataset.state]);
      page = 1; renderTable();
    };
  });
  // Tag 232b-3: f-cap click handler removed (cap buckets no longer in DOM).
  // Tag 232b-2: multi-select sector via checkbox popover (replaces b-1 toggle
  // buttons which Karl found too cluttered). Init filterSectors from checkbox
  // DOM so the server-templated sector list is the single source of truth.
  function updateSecBtnLabel(){
    const btn = document.getElementById('secToggleBtn');
    if (!btn) return;
    const keys = Object.keys(filterSectors);
    const on = keys.filter(s => filterSectors[s]);
    if (on.length === keys.length) btn.textContent = 'All ▾';
    else if (on.length === 0) btn.textContent = '(none) ▾';
    else if (on.length <= 2) btn.textContent = on.map(s => SECTOR_LABELS[s] || s).join(', ') + ' ▾';
    else btn.textContent = on.length + '/' + keys.length + ' ▾';
  }
  document.querySelectorAll('.filters .f-sec-cb').forEach(cb => {
    filterSectors[cb.dataset.sec] = true;  // default all-on
    cb.addEventListener('change', () => {
      filterSectors[cb.dataset.sec] = cb.checked;
      updateSecBtnLabel();
      page = 1; renderTable();
    });
  });
  const secToggleBtn = document.getElementById('secToggleBtn');
  const secPopover   = document.getElementById('secPopover');
  if (secToggleBtn && secPopover) {
    secToggleBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = secPopover.classList.toggle('show');
      secToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', e => {
      if (!secPopover.classList.contains('show')) return;
      if (e.target.closest('.sec-popover-wrap')) return;
      secPopover.classList.remove('show');
      secToggleBtn.setAttribute('aria-expanded', 'false');
    });
  }
  const secAllBtn  = document.getElementById('secAllBtn');
  const secNoneBtn = document.getElementById('secNoneBtn');
  if (secAllBtn) secAllBtn.addEventListener('click', () => {
    Object.keys(filterSectors).forEach(s => filterSectors[s] = true);
    document.querySelectorAll('.filters .f-sec-cb').forEach(cb => { cb.checked = true; });
    updateSecBtnLabel(); page = 1; renderTable();
  });
  if (secNoneBtn) secNoneBtn.addEventListener('click', () => {
    Object.keys(filterSectors).forEach(s => filterSectors[s] = false);
    document.querySelectorAll('.filters .f-sec-cb').forEach(cb => { cb.checked = false; });
    updateSecBtnLabel(); page = 1; renderTable();
  });
  // Tag 232b-4: country multi-select popover (parallel to sector). Replaces
  // the b-2 native <select> which couldn't render flag-emoji on Chromium-on-
  // Windows AND forced single-column scrolling through 35+ options.
  function updateCtryBtnLabel(){
    const btn = document.getElementById('ctryToggleBtn');
    if (!btn) return;
    const keys = Object.keys(filterCountries);
    const on = keys.filter(c => filterCountries[c]);
    if (on.length === keys.length) btn.textContent = 'All ▾';
    else if (on.length === 0) btn.textContent = '(none) ▾';
    else if (on.length <= 3) btn.textContent = on.join(', ') + ' ▾';
    else btn.textContent = on.length + '/' + keys.length + ' ▾';
  }
  document.querySelectorAll('.filters .f-ctry-cb').forEach(cb => {
    filterCountries[cb.dataset.ctry] = true;  // default all-on
    cb.addEventListener('change', () => {
      filterCountries[cb.dataset.ctry] = cb.checked;
      updateCtryBtnLabel();
      page = 1; renderTable();
    });
  });
  const ctryToggleBtn = document.getElementById('ctryToggleBtn');
  const ctryPopover   = document.getElementById('ctryPopover');
  if (ctryToggleBtn && ctryPopover) {
    ctryToggleBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = ctryPopover.classList.toggle('show');
      ctryToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', e => {
      if (!ctryPopover.classList.contains('show')) return;
      if (e.target.closest('.ctry-popover-wrap')) return;
      ctryPopover.classList.remove('show');
      ctryToggleBtn.setAttribute('aria-expanded', 'false');
    });
  }
  const ctryAllBtn  = document.getElementById('ctryAllBtn');
  const ctryNoneBtn = document.getElementById('ctryNoneBtn');
  if (ctryAllBtn) ctryAllBtn.addEventListener('click', () => {
    Object.keys(filterCountries).forEach(c => filterCountries[c] = true);
    document.querySelectorAll('.filters .f-ctry-cb').forEach(cb => { cb.checked = true; });
    updateCtryBtnLabel(); page = 1; renderTable();
  });
  if (ctryNoneBtn) ctryNoneBtn.addEventListener('click', () => {
    Object.keys(filterCountries).forEach(c => filterCountries[c] = false);
    document.querySelectorAll('.filters .f-ctry-cb').forEach(cb => { cb.checked = false; });
    updateCtryBtnLabel(); page = 1; renderTable();
  });
  // Tag 232b-2: continent select + market-cap minimum
  document.getElementById('fContinent').onchange = e => { filterContinent = e.target.value; page=1; renderTable(); };
  document.getElementById('fMinMcap').oninput = e => { filterMinMcap = e.target.value; page=1; renderTable(); };
  document.getElementById('fMinR40').oninput = e => { filterMinR40 = e.target.value; page=1; renderTable(); };
  document.getElementById('fMaxR40').oninput = e => { filterMaxR40 = e.target.value; page=1; renderTable(); };
  document.getElementById('fMin').oninput = e => { filterMin = e.target.value; page=1; renderTable(); };
  // Tag 232b-1: FCFM-min + Growth-min + IPO-year inputs (strict null exclusion).
  document.getElementById('fMinFcfm').oninput = e => { filterMinFcfm = e.target.value; page=1; renderTable(); };
  document.getElementById('fMinGrowth').oninput = e => { filterMinGrowth = e.target.value; page=1; renderTable(); };
  document.getElementById('fIpoMin').oninput = e => { filterIpoMin = e.target.value; page=1; renderTable(); };
  document.getElementById('fIpoMax').oninput = e => { filterIpoMax = e.target.value; page=1; renderTable(); };
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
    // Tag 223b: clickable sortable column header.
    const th = e.target.closest('th.sortable');
    if (th && th.dataset.sortkey) {
      sortKey = th.dataset.sortkey;
      const sortSel = document.getElementById('fSort');
      if (sortSel) {
        // Map sort axes that exist in fSort dropdown; fallback gracefully if not present.
        const opts = Array.from(sortSel.options).map(o => o.value);
        if (opts.indexOf(sortKey) >= 0) sortSel.value = sortKey;
      }
      page = 1;
      renderTable();
      return;
    }
    const tr = e.target.closest('tr.row');
    if (tr && tr.dataset.tk) showModal(tr.dataset.tk);
  });

  // Tag 223b: keyboard-navigation state and helpers (j/k row cursor + g chord).
  let kbdActiveIdx = -1;  // index into currentList of the keyboard-highlighted row
  let gChordPending = false;
  let gChordTimer = null;
  function clearKbdActive() {
    document.querySelectorAll('tr.row.kbd-active').forEach(el => el.classList.remove('kbd-active'));
  }
  function setKbdActive(idx) {
    if (!currentList || !currentList.length) { kbdActiveIdx = -1; return; }
    if (idx < 0) idx = 0;
    if (idx >= currentList.length) idx = currentList.length - 1;
    kbdActiveIdx = idx;
    // Page may need to change to bring this row into view.
    const targetPage = Math.floor(idx / PAGE_SIZE) + 1;
    if (targetPage !== page) {
      page = targetPage;
      renderTable();
      // renderTable rebuilds the DOM — re-apply highlight after.
    }
    clearKbdActive();
    const tk = currentList[idx].ticker;
    const tr = document.querySelector('tr.row[data-tk="' + (window.CSS && CSS.escape ? CSS.escape(tk) : tk) + '"]');
    if (tr) {
      tr.classList.add('kbd-active');
      tr.scrollIntoView({ block:'nearest' });
    }
  }
  function handleGChord(ch) {
    const map = { h:'HG', q:'QC', b:'BF', s:'SMALL', r:'R40', p:'PRE_BREAKOUT', w:'WATCH' };
    const tab = map[ch];
    if (tab) switchToTab(tab);
  }

  // Tag 223b: help overlay (?) — lists all power-user shortcuts.
  const kbdOverlay = document.getElementById('kbdHelp');
  function openHelp() {
    if (kbdOverlay) { kbdOverlay.classList.add('show'); kbdOverlay.setAttribute('aria-hidden', 'false'); }
  }
  function closeHelp() {
    if (kbdOverlay) { kbdOverlay.classList.remove('show'); kbdOverlay.setAttribute('aria-hidden', 'true'); }
  }
  const helpBtn = document.getElementById('helpBtn');
  if (helpBtn) helpBtn.onclick = openHelp;
  const kbdHelpClose = document.getElementById('kbdHelpClose');
  if (kbdHelpClose) kbdHelpClose.onclick = closeHelp;
  if (kbdOverlay) kbdOverlay.addEventListener('click', e => { if (e.target === kbdOverlay) closeHelp(); });

  document.addEventListener('keydown', e => {
    // Tag 213c: command palette triggers — Ctrl+K / Cmd+K (anywhere) or "/"
    // (only when not already typing in an input). Stop propagation so we don't
    // accidentally trigger other shortcuts in the same frame.
    const isMod = e.ctrlKey || e.metaKey;
    if (isMod && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      togglePalette();
      return;
    }
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (e.key === '/' && !inField) { e.preventDefault(); openPalette(); return; }
    if (e.key === 'Escape') {
      if (kbdOverlay && kbdOverlay.classList.contains('show')) { closeHelp(); return; }
      if (document.getElementById('commandPalette').classList.contains('show')) { closePalette(); return; }
      if (searchResults.classList.contains('show')) { searchResults.classList.remove('show'); searchInput.value=''; return; }
      if (document.getElementById('modal').classList.contains('show')) { closeModal(); return; }
      // Clear j/k cursor if active.
      if (kbdActiveIdx >= 0) { kbdActiveIdx = -1; clearKbdActive(); return; }
    }
    if (document.getElementById('modal').classList.contains('show')) {
      if (e.key === 'ArrowLeft') navModal(-1);
      if (e.key === 'ArrowRight') navModal(1);
      return;  // suppress other shortcuts while modal is open
    }
    // Tag 223b: power-user shortcuts. Skip when typing in inputs or when a
    // modifier is held (avoid stealing browser shortcuts like Ctrl+J).
    if (inField || e.altKey || e.ctrlKey || e.metaKey) return;

    if (e.key === '?') {
      e.preventDefault();
      openHelp();
      return;
    }
    // g-chord: press 'g' then a destination letter within 1s.
    if (gChordPending) {
      gChordPending = false;
      if (gChordTimer) { clearTimeout(gChordTimer); gChordTimer = null; }
      const ch = (e.key || '').toLowerCase();
      if ('hqsrpw'.indexOf(ch) >= 0) {
        e.preventDefault();
        handleGChord(ch);
        return;
      }
      // Unknown second char → fall through (so plain 'j'/'k' still work after a 'g' false-start).
    }
    if (e.key === 'g' || e.key === 'G') {
      e.preventDefault();
      gChordPending = true;
      gChordTimer = setTimeout(() => { gChordPending = false; gChordTimer = null; }, 1000);
      return;
    }
    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      setKbdActive(kbdActiveIdx < 0 ? 0 : kbdActiveIdx + 1);
      return;
    }
    if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      setKbdActive(kbdActiveIdx < 0 ? 0 : kbdActiveIdx - 1);
      return;
    }
    // Tag 226c-2: Home/End jump to first/last row of the filtered list.
    // Bloomberg muscle memory + saves a lot of j/k presses on long tabs.
    if (e.key === 'Home') {
      e.preventDefault();
      setKbdActive(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setKbdActive((currentList && currentList.length) ? currentList.length - 1 : 0);
      return;
    }
    if (e.key === 'Enter' && kbdActiveIdx >= 0 && currentList[kbdActiveIdx]) {
      e.preventDefault();
      showModal(currentList[kbdActiveIdx].ticker);
      return;
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('header')) searchResults.classList.remove('show');
  });

  // Tag 209e Upgrade 1: chip-removal event wiring (delegated; chips re-render
  // every applyFilters() pass so we can't bind per-chip listeners).
  const chipBar = document.getElementById('active-filters');
  if (chipBar) {
    chipBar.addEventListener('click', e => {
      if (e.target.id === 'chipsClearAll') { clearAllFilters(); return; }
      if (e.target.classList && e.target.classList.contains('x')) {
        const chip = e.target.closest('.chip');
        if (chip && chip.dataset.chip) clearChipFilter(chip.dataset.chip);
      }
    });
    // Tag 223b: keyboard activation for the role=button chip-× icons.
    chipBar.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('x')) {
        e.preventDefault();
        const chip = e.target.closest('.chip');
        if (chip && chip.dataset.chip) clearChipFilter(chip.dataset.chip);
      }
    });
  }

  // Tag 209e Upgrade 3: print button — uses browser print (CSS @media print
  // hides chrome and renders the active table only).
  const printBtn = document.getElementById('printBtn');
  if (printBtn) printBtn.onclick = () => window.print();

  // Tag 231b-3: CSV export of the current filtered/sorted view.
  // Vanilla Blob + URL.createObjectURL — no external deps. Exports the
  // FULL filtered list (not just the current page) so the user gets every
  // row that matches their filters. Columns mirror what's on-screen for
  // the active tab. SECTOR tab opts out (different data shape). RFC 4180
  // CSV: comma-separated, double-quote-wrapped, embedded quotes doubled.
  const exportBtn = document.getElementById('exportBtn');
  function _csvQuote(v) {
    if (v == null) return '';
    const s = String(v);
    // \\n and \\r in source = single backslash in browser JS = newline/CR check.
    if (s.indexOf(',') < 0 && s.indexOf('"') < 0 && s.indexOf('\\n') < 0 && s.indexOf('\\r') < 0) return s;
    // NOTE: above strings look like backslash-n / backslash-r in the rendered
    // browser JS, which JS itself parses as actual newline / CR escape codes.
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function _csvValue(r, key, tab) {
    if (key === 'score') {
      const v = tab === 'QC' ? r.qcScore
        : tab === 'HG' ? r.hgScore
        : tab === 'BF' ? r.bfScore
        : null;
      return v != null && Number.isFinite(v) ? v.toFixed(2) : '';
    }
    if (key === 'bf14') {
      const m = r.results && r.results['buffett-criteria'];
      return (m && Number.isFinite(m.value)) ? m.value.toFixed(0) : '';
    }
    if (key === 'bfMos') {
      const m = r.results && r.results['dcf-intrinsic-value'];
      return (m && Number.isFinite(m.value)) ? (m.value*100).toFixed(1) : '';
    }
    if (key === 'bfPassed') {
      return r.bfPassed ? 'YES' : 'NO';
    }
    if (key === 'rank') return ''; // filled by caller
    const v = r[key];
    if (v == null) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(4).replace(/\\.?0+$/, '') : '';
    return v;
  }
  function exportCsv() {
    if (activeTab === 'SECTOR') {
      alert('CSV export not available for the SECTOR heatmap tab.');
      return;
    }
    const list = currentList || [];
    if (!list.length) {
      alert('Nothing to export — current filtered view is empty.');
      return;
    }
    // Tab-specific column maps. Keys: header label → row field name (or virtual).
    const colMaps = {
      'HG':           [['Rank','rank'],['Ticker','ticker'],['Company','name'],['Sector','sector'],['Country','country'],['Score','score'],['State','state'],['R40','r40'],['RevGr%','growth'],['GrossM%','grossMargin'],['OpM%','opMargin'],['FCFM%','fcfMargin'],['MCap','mcap'],['DQ','dqGrade']],
      'QC':           [['Rank','rank'],['Ticker','ticker'],['Company','name'],['Sector','sector'],['Country','country'],['Score','score'],['State','state'],['FCFM%','fcfMargin'],['OpM%','opMargin'],['GrossM%','grossMargin'],['RevGr%','growth'],['MCap','mcap'],['DQ','dqGrade']],
      'BF':           [['Rank','rank'],['Ticker','ticker'],['Company','name'],['Sector','sector'],['Country','country'],['Score','score'],['14-Pt','bf14'],['MoS%','bfMos'],['Passed','bfPassed'],['FCFM%','fcfMargin'],['OpM%','opMargin'],['GrossM%','grossMargin'],['RevGr%','growth'],['MCap','mcap'],['DQ','dqGrade']],
      'SMALL':        [['Rank','rank'],['Ticker','ticker'],['Company','name'],['Sector','sector'],['Country','country'],['State','state'],['RevGr%','growth'],['R40','r40'],['GrossM%','grossMargin'],['FCFM%','fcfMargin'],['MCap','mcap'],['DQ','dqGrade']],
      'R40':          [['Rank','rank'],['Ticker','ticker'],['Company','name'],['Sector','sector'],['Country','country'],['R40','r40'],['RevGr%','growth'],['FCFM%','fcfMargin'],['OpM%','opMargin'],['GrossM%','grossMargin'],['State','state'],['MCap','mcap'],['DQ','dqGrade']],
      'PRE_BREAKOUT': [['Rank','rank'],['Ticker','ticker'],['Company','name'],['Sector','sector'],['Country','country'],['State','state'],['RevGr%','growth'],['GrossM%','grossMargin'],['R40','r40'],['MCap','mcap'],['PB-Score','pbScore'],['DQ','dqGrade']],
      'WATCH':        [['Rank','rank'],['Ticker','ticker'],['Company','name'],['Sector','sector'],['Country','country'],['Reasons','watchReasons'],['State','state'],['RevGr%','growth'],['MCap','mcap'],['DQ','dqGrade']]
    };
    const cols = colMaps[activeTab];
    if (!cols) { alert('No CSV mapping for tab ' + activeTab); return; }
    const lines = [];
    lines.push(cols.map(c => _csvQuote(c[0])).join(','));
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const cells = cols.map(c => {
        if (c[1] === 'rank') return _csvQuote(i + 1);
        if (c[1] === 'watchReasons') return _csvQuote(Array.isArray(r.watchReasons) ? r.watchReasons.join('|') : '');
        return _csvQuote(_csvValue(r, c[1], activeTab));
      });
      lines.push(cells.join(','));
    }
    const csv = lines.join('\\r\\n') + '\\r\\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'screener-' + activeTab + '-' + DATA.generatedAt + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (exportBtn) exportBtn.onclick = exportCsv;

  // Tag 223b: column-visibility popover. Renders the current tab's columns
  // (minus the always-on '#' index column) as checkboxes. Selection persists
  // per tab via localStorage. Re-renders the table on toggle so column changes
  // are immediate.
  const colToggleBtn = document.getElementById('colToggleBtn');
  const colPopover   = document.getElementById('colPopover');
  function renderColPopover() {
    if (!colPopover) return;
    const cols = (typeof tabColumns === 'function') ? tabColumns(activeTab) : [];
    if (!cols.length) { colPopover.innerHTML = '<div class="col-item" style="color:var(--text-2);">No columns for this tab.</div>'; return; }
    let html = '';
    for (const c of cols) {
      if (c.k === '#') continue;  // index column always on
      const id = 'col_' + c.k.replace(/[^A-Za-z0-9]/g, '_');
      const checked = !isColHidden(activeTab, c.k) ? ' checked' : '';
      html += '<label class="col-item" for="' + id + '"><input type="checkbox" id="' + id + '" data-colkey="' + c.k + '"' + checked + ' /> ' + c.k + '</label>';
    }
    html += '<div class="col-sep"></div><div class="col-reset" id="colResetAll">Reset (show all)</div>';
    colPopover.innerHTML = html;
  }
  if (colToggleBtn && colPopover) {
    colToggleBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = colPopover.classList.toggle('show');
      colToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) renderColPopover();
    });
    colPopover.addEventListener('click', e => {
      if (e.target.id === 'colResetAll') {
        hiddenCols[activeTab] = [];
        try { localStorage.setItem('screener.hiddenCols', JSON.stringify(hiddenCols)); } catch (err) { /* ignore */ }
        renderColPopover();
        renderTable();
        return;
      }
    });
    colPopover.addEventListener('change', e => {
      const cb = e.target.closest('input[type=checkbox]');
      if (!cb) return;
      setColHidden(activeTab, cb.dataset.colkey, !cb.checked);
      renderTable();
    });
    // Click outside closes the popover.
    document.addEventListener('click', e => {
      if (!colPopover.classList.contains('show')) return;
      if (e.target.closest('.col-toggle-wrap')) return;
      colPopover.classList.remove('show');
      colToggleBtn.setAttribute('aria-expanded', 'false');
    });
  }

  // Tag 210f: light-theme toggle. State persists in localStorage so the page
  // remembers Karl's preference across reloads. Default = dark (Bloomberg).
  // Button label flips between [☀] (currently dark, click to go light) and
  // [☾] (currently light, click to go dark). No prefers-color-scheme auto-
  // detect — Karl explicitly chose dark-by-default in the spec.
  const themeBtn = document.getElementById('themeBtn');
  function applyTheme(theme) {
    if (theme === 'light') {
      document.body.classList.add('theme-light');
      if (themeBtn) { themeBtn.textContent = '[☾]'; themeBtn.title = 'Switch to dark theme'; }
    } else {
      document.body.classList.remove('theme-light');
      if (themeBtn) { themeBtn.textContent = '[☀]'; themeBtn.title = 'Switch to light theme'; }
    }
  }
  let savedTheme = 'dark';
  try { savedTheme = localStorage.getItem('screener_theme') || 'dark'; } catch (e) { /* localStorage blocked */ }
  applyTheme(savedTheme);
  if (themeBtn) themeBtn.onclick = () => {
    const next = document.body.classList.contains('theme-light') ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem('screener_theme', next); } catch (e) { /* ignore */ }
  };

  // Tag 231b-2: tint the data-freshness chip based on snapshot age.
  // Compares DATA.generatedAt (ISO date) to the client's local date so
  // a stale dashboard surfaces the warning even if regenerated offline.
  (function tintFreshness(){
    const el = document.getElementById('dataFreshness');
    if (!el || !DATA.generatedAt) return;
    const gen = new Date(DATA.generatedAt + 'T00:00:00Z');
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const ageDays = Math.max(0, Math.floor((todayUtc - gen.getTime()) / 86400000));
    if (!Number.isFinite(ageDays)) return;
    let cls = 'fresh';
    let label = 'today';
    if (ageDays >= 7)      { cls = 'old';   label = ageDays + 'd old'; }
    else if (ageDays >= 2) { cls = 'stale'; label = ageDays + 'd old'; }
    else if (ageDays === 1){ cls = 'stale'; label = '1d old'; }
    el.classList.add(cls);
    el.title = 'Data snapshot: ' + DATA.generatedAt + ' (' + label + ')';
  })();

  // Tag 226c-3: populate tab-count badges (universe size per tab). Counts
  // are static — tabs are pre-classified at HTML generation. SECTOR is the
  // heatmap view (not a stock list) so no count is appended for it.
  (function populateTabCounts(){
    document.querySelectorAll('.tabs button').forEach(b => {
      const t = b.dataset.tab;
      if (!t || t === 'SECTOR') return;
      const list = TABS[t] || [];
      const span = document.createElement('span');
      span.className = 'tc';
      span.setAttribute('aria-label', list.length + ' stocks in this tab');
      span.textContent = '(' + list.length + ')';
      b.appendChild(span);
    });
  })();

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
<header role="banner">
  <span class="brand">◆ SCREENER</span>
  <div class="search" style="position:relative;">
    <label for="search" class="sr-only" style="position:absolute;left:-9999px;">Search ticker or company</label>
    <input id="search" type="text" aria-label="Search ticker or company" placeholder="/ Search ticker or company..." />
    <div id="searchResults" class="search-results" role="listbox" aria-label="Search results"></div>
  </div>
  <span id="dataFreshness" class="data-freshness" title="Data snapshot date — green = today, amber = ≥2d stale, red = ≥7d stale" aria-label="Data freshness">DATA ${escHtml(generatedAt)}</span>
  <div class="col-toggle-wrap">
    <button id="colToggleBtn" class="col-toggle-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Toggle column visibility" title="Show/hide columns">[cols]</button>
    <div id="colPopover" class="col-popover" role="menu" aria-label="Column visibility"></div>
  </div>
  <button id="helpBtn" class="print-btn" type="button" aria-label="Show keyboard shortcuts (press ?)" title="Keyboard shortcuts (?)">[?]</button>
  <button id="exportBtn" class="print-btn" type="button" aria-label="Download current filtered view as CSV" title="Export current view to CSV (no external service)">[csv]</button>
  <button id="printBtn" class="print-btn" type="button" aria-label="Print current view" title="Print current view">[print]</button>
  <button id="themeBtn" class="theme-btn" type="button" aria-label="Toggle light/dark theme" title="Toggle light/dark theme">[☀]</button>
</header>
<div class="tabs" role="tablist" aria-label="Screener tabs">
  <button data-tab="HG" class="active" role="tab" aria-current="page" aria-selected="true">⚡ Hypergrowth</button>
  <button data-tab="QC" role="tab" aria-selected="false">🏛 Quality-Compounder</button>
  <button data-tab="BF" role="tab" aria-selected="false">📜 Buffett</button>
  <button data-tab="SMALL" role="tab" aria-selected="false">📈 Small Cap</button>
  <button data-tab="R40" role="tab" aria-selected="false">📊 Rule of 40</button>
  <button data-tab="PRE_BREAKOUT" role="tab" aria-selected="false">🎯 Pre-Breakout</button>
  <button data-tab="WATCH" role="tab" aria-selected="false">👁 Watch</button>
  <button data-tab="SECTOR" role="tab" aria-selected="false">🌡 SECTOR</button>
</div>
<div class="filters">
  <span class="group"><span class="label">State:</span>
    <button class="f f-state on" data-state="LOSS">LOSS</button>
    <button class="f f-state on" data-state="TURNAROUND">TURN</button>
    <button class="f f-state on" data-state="RECENT">RECENT</button>
    <button class="f f-state on" data-state="STABLE">STABLE</button>
    <button class="f f-state on" data-state="NA">N/A</button>
  </span>
  <!-- Tag 232b-3: MICRO/SMALL/MID/LARGE/MEGA cap-bucket toggle removed per Karl's
       request — the Cap≥ $B input below is the only mcap filter now. -->

  <span class="group sec-popover-wrap" style="position:relative">
    <span class="label">Sector:</span>
    <button id="secToggleBtn" class="f" type="button" aria-expanded="false" aria-haspopup="menu" title="Multi-select sectors">All ▾</button>
    <div id="secPopover" class="col-popover" role="menu" aria-label="Sector multi-select">${sectors.map(s => `<label class="col-item"><input type="checkbox" class="f-sec-cb" data-sec="${escHtml(s)}" checked/> ${escHtml(s)}</label>`).join('')}<div class="col-sep"></div><div class="col-reset" id="secAllBtn">Select all</div><div class="col-reset" id="secNoneBtn">Clear all</div></div>
  </span>
  <span class="group ctry-popover-wrap" style="position:relative">
    <span class="label">Country:</span>
    <button id="ctryToggleBtn" class="f" type="button" aria-expanded="false" aria-haspopup="menu" title="Multi-select countries">All ▾</button>
    <div id="ctryPopover" class="col-popover ctry-popover" role="menu" aria-label="Country multi-select">
      <div class="ctry-grid">${countries.map(c => {
        const flag = COUNTRY_FLAGS[c] || '';
        const flagSpan = flag ? `<span class="flag">${flag}</span>` : '';
        return `<label><input type="checkbox" class="f-ctry-cb" data-ctry="${escHtml(c)}" checked/>${flagSpan}<span>${escHtml(c)}</span></label>`;
      }).join('')}</div>
      <div class="col-sep"></div>
      <div class="col-reset" id="ctryAllBtn">Select all</div>
      <div class="col-reset" id="ctryNoneBtn">Clear all</div>
    </div>
  </span>
  <span class="group"><span class="label">Continent:</span>
    <select id="fContinent"><option value="">All</option><option value="Americas">🌎 Americas</option><option value="Europe">🌍 Europe</option><option value="Asia">🌏 Asia</option><option value="Oceania">🇦🇺 Oceania</option><option value="Africa">🌍 Africa</option></select>
  </span>
  <span class="group"><span class="label" title="Market cap minimum in billions USD (e.g. 1 → only stocks ≥ $1B)">Cap≥:</span><input id="fMinMcap" type="number" step="0.1" placeholder="$B" style="width:55px"/></span>
  <span class="group"><span class="label">R40:</span><input id="fMinR40" type="number" step="1" placeholder="min" style="width:50px"/><input id="fMaxR40" type="number" step="1" placeholder="max" style="width:50px"/></span>
  <span class="group"><span class="label">Tab Min:</span><input id="fMin" type="number" step="1" placeholder="—"/></span>
  <span class="group"><span class="label">FCFM≥:</span><input id="fMinFcfm" type="number" step="0.1" placeholder="%" style="width:55px"/></span>
  <span class="group"><span class="label">Growth≥:</span><input id="fMinGrowth" type="number" step="0.1" placeholder="%" style="width:55px"/></span>
  <span class="group"><span class="label">IPO Year:</span><input id="fIpoMin" type="number" step="1" placeholder="from" style="width:60px"/><input id="fIpoMax" type="number" step="1" placeholder="to" style="width:60px"/></span>
  <span class="group"><span class="label" title="Data Quality grade. A+ = 95%+ of expected Yahoo fields present and clean; A/B = minor gaps; C = significant NaN/missing (e.g. balance sheet incomplete); D = unusable. Click letters to include/exclude that grade. Default: A+/A/B on, C/D off — i.e. only stocks with reliable underlying data.">DQ:</span>
    <button class="f f-dq on" data-dq="A+" title="A+ — 95%+ field coverage, no critical gaps">A+</button>
    <button class="f f-dq on" data-dq="A" title="A — minor field gaps, still reliable">A</button>
    <button class="f f-dq on" data-dq="B" title="B — moderate gaps, watch for stale ratios">B</button>
    <button class="f f-dq"    data-dq="C" title="C — significant data quality issues">C</button>
    <button class="f f-dq"    data-dq="D" title="D — unusable; reject by design">D</button>
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
<div id="active-filters"></div>
<div class="summary" id="summary" aria-live="polite" aria-atomic="true"></div>
<div id="explainer" style="padding:8px 16px;background:var(--bg-1);border-bottom:1px solid var(--border);color:var(--text-1);font-size:12px;display:none;"></div>
<div id="trend-empty-banner" style="display:none;padding:6px 16px;background:rgba(255,187,51,0.08);border-bottom:1px solid var(--border);color:var(--text-1);font-size:11px;">⚠ <strong>Trend column is empty</strong> — score-history accumulates from daily-pull runs. Δ7d shows after ≥7 vintages exist (after Run #110 you'll have 1; after Run #117 the Δ7d column starts populating). Once you see "—" for everyone, that's why.</div>
<div class="table-wrap"><div id="table"></div></div>
<div class="pagination" role="navigation" aria-label="Pagination">
  <button id="prevPage" type="button" aria-label="Previous page">← Prev</button>
  <span id="pageInfo" aria-live="polite">Page 1 of 1</span>
  <button id="nextPage" type="button" aria-label="Next page">Next →</button>
</div>
<div id="modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="modalContent" aria-hidden="true"><div class="modal-content" id="modalContent"></div></div>
<div id="commandPalette" class="cp-overlay" role="dialog" aria-modal="true" aria-label="Command palette">
  <div class="cp-panel">
    <input id="cpInput" class="cp-input" type="text" autocomplete="off" spellcheck="false" aria-label="Command palette input" placeholder="Search tickers, type > for commands, ? for help..." />
    <div id="cpResults" class="cp-results" role="listbox" aria-label="Command palette results"></div>
    <div class="cp-hint">↑↓ navigate · Enter select · Esc close · Ctrl+K / Cmd+K / "/" to open</div>
  </div>
</div>
<div id="kbdHelp" class="kbd-overlay" role="dialog" aria-modal="true" aria-labelledby="kbdHelpTitle" aria-hidden="true">
  <div class="kbd-panel">
    <button id="kbdHelpClose" class="kbd-close" type="button" aria-label="Close shortcuts">×</button>
    <h2 id="kbdHelpTitle">Keyboard Shortcuts</h2>
    <div class="kbd-row"><div class="kbd-keys"><span class="kbd-key">?</span></div><div class="kbd-desc">Show this help</div></div>
    <div class="kbd-row"><div class="kbd-keys"><span class="kbd-key">Ctrl</span><span class="kbd-key">K</span></div><div class="kbd-desc">Command palette (also /)</div></div>
    <div class="kbd-row"><div class="kbd-keys"><span class="kbd-key">Esc</span></div><div class="kbd-desc">Close modal / clear search</div></div>
    <div class="kbd-row"><div class="kbd-keys"><span class="kbd-key">j</span> / <span class="kbd-key">k</span></div><div class="kbd-desc">Move row cursor down / up</div></div>
    <div class="kbd-row"><div class="kbd-keys"><span class="kbd-key">Home</span> / <span class="kbd-key">End</span></div><div class="kbd-desc">Jump to first / last row of filtered list</div></div>
    <div class="kbd-row"><div class="kbd-keys"><span class="kbd-key">Enter</span></div><div class="kbd-desc">Open detail modal for active row</div></div>
    <div class="kbd-row"><div class="kbd-keys"><span class="kbd-key">←</span> / <span class="kbd-key">→</span></div><div class="kbd-desc">Prev / next stock (in modal)</div></div>
    <div class="kbd-row"><div class="kbd-keys"><span class="kbd-key">g</span> <span class="kbd-key">h</span></div><div class="kbd-desc">Go to Hypergrowth tab</div></div>
    <div class="kbd-row"><div class="kbd-keys"><span class="kbd-key">g</span> <span class="kbd-key">q</span></div><div class="kbd-desc">Go to Quality-Compounder tab</div></div>
    <div class="kbd-row"><div class="kbd-keys"><span class="kbd-key">g</span> <span class="kbd-key">b</span></div><div class="kbd-desc">Go to Buffett tab</div></div>
    <div class="kbd-row"><div class="kbd-keys"><span class="kbd-key">g</span> <span class="kbd-key">s</span></div><div class="kbd-desc">Go to Small Cap tab</div></div>
    <div class="kbd-row"><div class="kbd-keys"><span class="kbd-key">g</span> <span class="kbd-key">r</span></div><div class="kbd-desc">Go to Rule of 40 tab</div></div>
    <div class="kbd-row"><div class="kbd-keys"><span class="kbd-key">g</span> <span class="kbd-key">p</span></div><div class="kbd-desc">Go to Pre-Breakout tab</div></div>
    <div class="kbd-row"><div class="kbd-keys"><span class="kbd-key">g</span> <span class="kbd-key">w</span></div><div class="kbd-desc">Go to Watch tab</div></div>
  </div>
</div>
<script>window.SCREENER_DATA = ${json};</script>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('[screener] loading snapshots from ' + args.snapshots);
  // Tag 232c-11: loadStocks now async (batched concurrency).
  const stocks = await loadStocks(args.snapshots);
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
  // Tag 232b-2: country list ordered with US / JP / CN pinned to the top
  // (Karl's most-watched markets), then the rest alphabetical. Flag emoji
  // and continent mapping are in module-level COUNTRY_FLAGS / COUNTRY_TO_CONTINENT.
  const COUNTRY_PRIORITY = ['US', 'USA', 'JP', 'CN'];
  const countriesRaw = Array.from(countrySet);
  const countries = [
    ...COUNTRY_PRIORITY.filter(c => countriesRaw.includes(c)),
    ...countriesRaw.filter(c => !COUNTRY_PRIORITY.includes(c)).sort()
  ];

  const generatedAt = new Date().toISOString().slice(0, 10);
  const html = renderHTML(rows, tabs, sectors, countries, generatedAt);
  fs.writeFileSync(args.out, html);
  console.log('[screener] wrote ' + args.out + ' (' + (html.length/1024).toFixed(0) + ' KB)');
}

if (require.main === module) main().catch(e => { console.error('FATAL:', e); process.exit(1); });

module.exports = { buildRow, classifyTabs, renderHTML, readScoreHistory, findEntryAtOrBefore, _buildScoreHistoryPayload };
