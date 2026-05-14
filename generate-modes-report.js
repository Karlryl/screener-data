#!/usr/bin/env node
/**
 * Tag 109: Modes-Report — Top-Tabs + Tabellen-Layout + Sparklines + Aktienfinder-Klick
 * =====================================================================================
 * - Modi als Top-Level-Tabs (nicht mehr stacked Sections)
 * - Top-200 statt Top-50 pro Sub-Tab
 * - Compact Tabellen-Listings: ~38px pro Stock, ~20 sichtbar pro Viewport
 * - Sparkline (annual.annualRev) inline-SVG pro Stock
 * - Branchen-Filter im UI (dynamisch aus eligible-Set)
 * - Click → Aktienfinder (https://aktienfinder.net/aktie/[ticker-base])
 * - R-of-40 + R-of-X Sub-Tabs zeigen jeweils ihren Wert prominent
 * - Anthrazit-Premium-Stil, JetBrains Mono fuer Numerics
 */
'use strict';
const fs = require('fs');
const path = require('path');

const Runner = require('./methods/runner.js');
const SM = require('./methods/strategy-modes.js');

const REGION_TO_COUNTRY = {
  'Nasdaq': 'USA', 'NasdaqCM': 'USA', 'NasdaqGM': 'USA', 'NasdaqGS': 'USA',
  'NYSE': 'USA', 'NYSE American': 'USA', 'NYSEArca': 'USA',
  'Cboe US': 'USA', 'OTC Markets OTCPK': 'USA', 'OTC Markets OTCQX': 'USA', 'YHD': 'USA',
  'XETRA': 'Deutschland', 'Frankfurt': 'Deutschland',
  'LSE': 'UK', 'Toronto': 'Kanada', 'HKSE': 'Hongkong',
  'Shanghai': 'China', 'Shenzhen': 'China',
  'KSE': 'Südkorea', 'KOSDAQ': 'Südkorea',
  'ASX': 'Australien', 'Tokyo': 'Japan', 'Paris': 'Frankreich',
  'Amsterdam': 'Niederlande', 'Swiss': 'Schweiz', 'Stockholm': 'Schweden',
  'Oslo': 'Norwegen', 'Copenhagen': 'Dänemark', 'Helsinki': 'Finnland',
  'Milan': 'Italien', 'MCE': 'Spanien', 'Vienna': 'Österreich',
  'Brussels': 'Belgien', 'Athens': 'Griechenland', 'Warsaw': 'Polen',
  'Lisbon': 'Portugal', 'Irish': 'Irland', 'Sao Paulo': 'Brasilien',
  'Mexico': 'Mexiko', 'SES': 'Singapur', 'Taiwan': 'Taiwan',
  'Jakarta': 'Indonesien', 'Kuala Lumpur': 'Malaysia',
  'Thailand': 'Thailand', 'Dubai': 'UAE', 'Saudi': 'Saudi-Arabien'
};

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './modes-report.html', topN: 200 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
    else if (argv[i] === '--top' && argv[i+1]) args.topN = parseInt(argv[++i]);
  }
  return args;
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtMoney(v) {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e12) return '$' + (v/1e12).toFixed(1) + 'T';
  if (v >= 1e9) return '$' + (v/1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v/1e6).toFixed(0) + 'M';
  return '$' + v.toFixed(0);
}

function fmtValue(v, unit) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (unit === 'percent') return v.toFixed(1) + '%';
  if (unit === 'ratio' && Math.abs(v) < 1) return (v*100).toFixed(2) + '%';
  if (typeof v === 'string') return v;
  return v.toFixed(1);
}

function loadStocks(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== '_manifest.json');
  return files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
    catch (e) { return null; }
  }).filter(x => x !== null && typeof x === 'object' && !Array.isArray(x));
}

function evaluateAll(stocks) {
  return stocks.map(stock => {
    const allResults = Runner.evaluateStock(stock);
    const mcap = (stock.marketCap != null && typeof stock.marketCap === 'object' && stock.marketCap.value != null)
      ? stock.marketCap.value
      : (typeof stock.marketCap === 'number' ? stock.marketCap : 0);
    const ipoYear = stock.meta && stock.meta.ipoYear ? stock.meta.ipoYear : null;
    // Tag 121: pre-compute modeEvals fuer alle 3 Modi -> cross-profile-detection
    const modeEvals = {};
    for (const mId of Object.keys(SM.MODES)) {
      try { modeEvals[mId] = SM.evaluateMode(stock, mId, allResults); }
      catch (e) { modeEvals[mId] = null; }
    }
    return { stock, allResults, mcap, ipoYear, modeEvals };
  });
}

// Tag 121: Cross-Profile-Tags pro Stock (HG+QC, TRIPLE_PROFILE, ...)
function computeCrossProfileTags(modeEvals, currentModeId) {
  const tags = [];
  const SCORE_THRESHOLD = 65;  // Stock muss in einem Mode >=65 erreichen damit Cross-Profile zaehlt
  const strongModes = [];
  for (const [mId, me] of Object.entries(modeEvals)) {
    if (me && me.score != null && me.score >= SCORE_THRESHOLD) strongModes.push(mId);
  }
  if (strongModes.length >= 3) tags.push('TRIPLE_PROFILE');
  else if (strongModes.length === 2) {
    const ids = strongModes.sort().join('+');
    if (ids === 'HYPERGROWTH+QUALITY_COMPOUNDER') tags.push('HG+QC');
    else if (ids === 'HYPERGROWTH+TURNAROUND') tags.push('HG+TA');
    else if (ids === 'QUALITY_COMPOUNDER+TURNAROUND') tags.push('QC+TA');
  }
  return tags;
}

// Tag 121: Score-basierte Top-Selektion mit Tier-Klassifikation.
// Filtert NUR Hygiene-Layer (sector + mcap + DataGuards), nicht passed/MUSTs.
// Sortiert nach modus-spezifischem Score, gibt Tier-Info zurueck.
function topByScore(eligible, modeId, topN) {
  const valid = eligible.filter(ev => {
    const me = ev.modeEvals && ev.modeEvals[modeId];
    return me && me.score != null;  // Score muss berechenbar sein (Hygiene durch)
  });
  valid.sort((a, b) => {
    const sa = a.modeEvals[modeId].score;
    const sb = b.modeEvals[modeId].score;
    return sb - sa;  // descending
  });
  return valid.slice(0, topN);
}

// Tag 121b: Stocks die Hygiene durch + genau EINEN CORE-MUST verfehlen.
// Diagnose-Werkzeug fuer Tag 122-Entscheidung: zeigt Karl welche
// bekannten Compounder nur an einer Schwelle scheitern (z.B. nur ROIC).
function blockedByOneMust(eligible, modeId, topN) {
  const items = [];
  for (const ev of eligible) {
    const me = ev.modeEvals && ev.modeEvals[modeId];
    if (!me || me.passed || !me.mustResults) continue;
    const failed = me.mustResults.filter(m => m.status === 'fail');
    if (failed.length !== 1) continue;  // genau 1 MUST fail
    items.push({ ev: ev, me: me, failedMust: failed[0] });
  }
  items.sort(function(a, b) { return (b.me.score || 0) - (a.me.score || 0); });
  return items.slice(0, topN);
}

function dedupeByCompany(evaluated) {
  function norm(s) {
    if (!s) return '';
    return String(s).toLowerCase()
      .replace(/[éèêë]/g, 'e').replace(/[óòôö]/g, 'o').replace(/[áàâä]/g, 'a')
      .replace(/\b(inc|corporation|corp|incorporated|company|co|ltd|limited|plc|sa|a\/s|ag|nv|holdings|holding|group|grp|sarl|spa|n\.v\.)\b/gi, '')
      .replace(/[^a-z0-9]+/g, '').trim();
  }
  const byKey = new Map();
  for (const ev of evaluated) {
    const name = (ev.stock.meta && ev.stock.meta.name) || '';
    const ticker = (ev.stock.meta && ev.stock.meta.ticker) || '';
    const key = norm(name) || ticker.split(/[.\-]/)[0].toLowerCase();
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, ev); continue; }
    const evIsUS = !/\./.test(ticker);
    const exIsUS = !/\./.test(existing.stock.meta.ticker);
    let keep;
    if (evIsUS && !exIsUS) keep = ev;
    else if (!evIsUS && exIsUS) keep = existing;
    else keep = (ev.mcap || 0) >= (existing.mcap || 0) ? ev : existing;
    byKey.set(key, keep);
  }
  return [...byKey.values()];
}

function eligibleForMode(evaluated, modeId) {
  const mode = SM.MODES[modeId];
  if (mode.enabled === false) return [];
  return evaluated.filter(ev => {
    if (SM.isExcludedBySector(ev.stock, mode)) return false;
    for (const guardId of mode.dataGuards) {
      const r = ev.allResults[guardId];
      if (r && r.computable === true && r.pass === false) return false;
    }
    return true;
  });
}

function topByMethod(eligible, methodId, methodMeta, topN, modeId) {
  // Tag 112c: Sub-Tab respektiert MUST-Filter — IONQ/MRNA fliegen ueberall raus, nicht nur in "Beste Kandidaten"
  const valid = eligible.filter(ev => {
    const r = ev.allResults[methodId];
    if (!(r && r.computable && Number.isFinite(r.value))) return false;
    if (modeId) {
      const me = SM.evaluateMode(ev.stock, modeId, ev.allResults);
      if (!me.passed) return false;
    }
    return true;
  });
  const op = methodMeta && methodMeta.thresholdOp;
  valid.sort((a, b) => {
    const va = a.allResults[methodId].value;
    const vb = b.allResults[methodId].value;
    return op === 'lte' ? va - vb : vb - va;
  });
  return valid.slice(0, topN);
}

function topAllMust(eligible, modeId, topN) {
  const mode = SM.MODES[modeId];
  const passing = eligible.filter(ev => {
    const me = SM.evaluateMode(ev.stock, modeId, ev.allResults);
    return me.passed;
  });
  const sortMethodId = mode && mode.defaultSortMethod;
  const sortMethodMeta = sortMethodId ? Runner.METHODS.find(m => m.id === sortMethodId) : null;
  const op = sortMethodMeta && sortMethodMeta.thresholdOp;
  if (sortMethodId) {
    passing.sort((a, b) => {
      const ra = a.allResults[sortMethodId];
      const rb = b.allResults[sortMethodId];
      const va = ra && ra.computable && Number.isFinite(ra.value) ? ra.value : (op === 'lte' ? Infinity : -Infinity);
      const vb = rb && rb.computable && Number.isFinite(rb.value) ? rb.value : (op === 'lte' ? Infinity : -Infinity);
      return op === 'lte' ? va - vb : vb - va;
    });
  }
  return passing.slice(0, topN);
}

const PSTATE_LABEL = { LOSS:'Loss', TURNAROUND:'Turn', RECENT:'Recent', STABLE:'Stable', NA:'—' };
const PSTATE_CLASS = { LOSS:'pst-loss', TURNAROUND:'pst-turnaround', RECENT:'pst-recent', STABLE:'pst-stable', NA:'pst-na' };

function _arrVals(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(v => v == null ? null : (typeof v === 'number' ? v : v.value)).filter(v => Number.isFinite(v));
}

function buildSparkline(stock) {
  const a = (stock.annual && stock.annual.annualRev) || [];
  const vals = _arrVals(a).slice(0, 5).reverse(); // oldest → newest, max 5
  if (vals.length < 2) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const w = 56, h = 16;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function aktienfinderUrl(ticker) {
  // Tag 110: Aktienfinder hat kein einheitliches URL-Schema → Google-Site-Search nutzen
  // Top-Treffer ist meist die Aktienfinder-Aktien-Seite
  const base = ticker.split(/[.\-]/)[0];
  return 'https://www.google.com/search?q=' + encodeURIComponent('site:aktienfinder.net ' + base + ' aktie');
}

// ─── Tag 136: Complete UI redesign — card grid + sidebar filters ──────────────

function scoreColor(s) {
  if (s >= 80) return '#4ade80';
  if (s >= 65) return '#86efac';
  if (s >= 50) return '#fbbf24';
  return '#f87171';
}

function renderCard(ev, modeId, opts) {
  const s = ev.stock;
  const ticker  = (s.meta && s.meta.ticker) || '???';
  const name    = (s.meta && s.meta.name) || '';
  const sector  = (s.meta && s.meta.sector) || '';
  const mcap    = ev.mcap;
  const ipoYear = ev.ipoYear;
  const afUrl   = aktienfinderUrl(ticker);
  const region  = (s.meta && s.meta.region) || '';
  const country = REGION_TO_COUNTRY[region] || region || '';
  const spark   = buildSparkline(s);

  const psRes    = ev.allResults['profitability-state'];
  const profState = (psRes && psRes.computable && psRes.components) ? psRes.components.state : 'NA';
  const psClass  = PSTATE_CLASS[profState] || 'pst-na';
  const psLabel  = PSTATE_LABEL[profState] || profState;

  const r40 = ev.allResults['rule-of-40'];
  const fcfMargin = (r40 && r40.computable && r40.components && Number.isFinite(r40.components.fcfMargin)) ? r40.components.fcfMargin : -999;
  const revGrowth = (r40 && r40.computable && r40.components && Number.isFinite(r40.components.growth)) ? r40.components.growth : -999;

  const me    = (ev.modeEvals && ev.modeEvals[modeId]) || {};
  const score = (me.score != null && Number.isFinite(me.score)) ? Math.round(me.score) : null;
  const tier  = (opts && opts.tier) || (me.tier) || '';
  const xpTags = (opts && opts.crossProfileTags) || [];
  const dqGrade = me.dataQualityGrade || (s._quality && s._quality.grade) || null;

  const tierBadgeHtml = tier ? `<span class="cb-tier cb-tier-${tier.toLowerCase()}">${tier === 'NEAR_MISS' ? 'Near' : tier}</span>` : '';
  const xpHtml = xpTags.length > 0
    ? xpTags.map(t => `<span class="cb-xp">${escHtml(t)}</span>`).join('')
    : '';
  const dqHtml = dqGrade ? `<span class="cb-dq cb-dq-${dqGrade.toLowerCase()}">${dqGrade}</span>` : '';

  const scoreBarHtml = score != null
    ? `<div class="card-score-bar"><div class="csb-track"><div class="csb-fill" style="width:${score}%;background:${scoreColor(score)}"></div></div><span class="csb-num" style="color:${scoreColor(score)}">${score}</span></div>`
    : `<div class="card-score-bar"><div class="csb-track"><div class="csb-fill csb-na"></div></div><span class="csb-num csb-na-num">—</span></div>`;

  let chipsHtml = '';
  try {
    const bd = me && me.scoreBreakdown;
    if (bd && typeof bd === 'object') {
      const chips = Object.entries(bd).slice(0, 8).map(([mid, b]) => {
        const meta = Runner.METHODS.find(m => m.id === mid);
        const lbl = (meta && meta.label) || mid;
        const short = lbl.replace(/Rule[- ]of[- ]/i, 'R').replace(/Hypergrowth /i, 'HG ').slice(0, 14);
        if (!b.computable) return `<span class="chip chip-na" title="${escHtml(lbl)}">${escHtml(short)}</span>`;
        const cls = b.pass ? 'chip-pass' : 'chip-fail';
        return `<span class="chip ${cls}" title="${escHtml(lbl + ': ' + (b.value != null ? b.value.toFixed(1) : '?'))}">${escHtml(short)}</span>`;
      }).join('');
      if (chips) chipsHtml = `<div class="card-chips">${chips}</div>`;
    }
  } catch (e) { /* chips best-effort */ }

  const revGrowthStr = revGrowth > -100 ? (revGrowth >= 0 ? '+' : '') + revGrowth.toFixed(0) + '%' : '—';
  const fcfStr       = fcfMargin > -100 ? (fcfMargin >= 0 ? '+' : '') + fcfMargin.toFixed(0) + '%' : '—';

  const stockSlim = {
    meta: { ticker, name, sector, industry: (s.meta && s.meta.industry) || '', country: (s.meta && s.meta.country) || '', marketCap: mcap },
    timeseries: { revenueQ: ((s.timeseries && s.timeseries.revenueQ) || []).slice(0, 8) },
    annual: { annualRev: ((s.annual && s.annual.annualRev) || []).slice(0, 5), annualOpInc: ((s.annual && s.annual.annualOpInc) || []).slice(0, 5), annualFCF: ((s.annual && s.annual.annualFCF) || []).slice(0, 5) },
    metrics: { revenueGrowthYoY: (s.metrics && s.metrics.revenueGrowthYoY && s.metrics.revenueGrowthYoY.value != null) ? s.metrics.revenueGrowthYoY.value : null }
  };

  return `<div class="card" data-stock="${escHtml(JSON.stringify(stockSlim))}" data-af-url="${escHtml(afUrl)}" data-prof-state="${escHtml(profState)}" data-mcap="${Math.round(mcap||0)}" data-ipo="${ipoYear||0}" data-sector="${escHtml(sector)}" data-country="${escHtml(country)}" data-fcf-margin="${fcfMargin.toFixed(1)}" data-rev-growth="${revGrowth.toFixed(1)}" data-tier="${escHtml(tier)}" data-name="${escHtml(name.toLowerCase())}" data-ticker="${escHtml(ticker.toLowerCase())}">
  <div class="card-top">
    <span class="card-ticker">${escHtml(ticker)}</span>
    <div class="card-badges">${dqHtml}${tierBadgeHtml}${xpHtml}</div>
  </div>
  <div class="card-name" title="${escHtml(name)}">${escHtml(name.length > 28 ? name.slice(0,27) + '…' : name)}</div>
  ${scoreBarHtml}
  <div class="card-row"><span class="card-sector" title="${escHtml(sector)}">${escHtml(sector.slice(0,22))}</span><span class="card-mcap">${fmtMoney(mcap)}</span></div>
  <div class="card-row card-metrics">
    <span class="card-pstate ${psClass}">${escHtml(psLabel)}</span>
    <span class="card-metric">Rev ${revGrowthStr}</span>
    <span class="card-metric">FCF ${fcfStr}</span>
  </div>
  <div class="card-bottom">${spark ? `<span class="card-spark">${spark}</span>` : ''}<span class="card-ipo">${ipoYear ? "'" + (ipoYear % 100).toString().padStart(2, '0') : '—'}</span></div>
  ${chipsHtml}
</div>`;
}

// Legacy: keep renderRow as alias for backward compat with any external callers
function renderRow(ev, i, modeId, sortMethodId, opts) {
  const s = ev.stock;
  const ticker = (s.meta && s.meta.ticker) || '???';
  const name = (s.meta && s.meta.name) || '';
  const sector = (s.meta && s.meta.sector) || '';
  const mcap = ev.mcap;
  const ipoYear = ev.ipoYear;

  const sortMethod = sortMethodId ? Runner.METHODS.find(m => m.id === sortMethodId) : null;
  const sortRes = sortMethodId ? ev.allResults[sortMethodId] : null;
  const sortValStr = sortRes && sortRes.computable
    ? fmtValue(sortRes.value, sortMethod && sortMethod.unit)
    : '—';

  const psRes = ev.allResults['profitability-state'];
  const profState = (psRes && psRes.computable && psRes.components) ? psRes.components.state : 'NA';
  const profConf = (psRes && psRes.components && psRes.components.confidence) ? psRes.components.confidence.split(' ')[0] : '';
  const psClass = PSTATE_CLASS[profState] || 'pst-na';
  const psLabel = PSTATE_LABEL[profState] || profState;

  const spark = buildSparkline(s);
  const afUrl = aktienfinderUrl(ticker);

  // Tag 113: FCF-Margin und Revenue-Growth als data-attrs fuer Filter-Slider
  const r40 = ev.allResults['rule-of-40'];
  const fcfMargin = (r40 && r40.computable && r40.components && Number.isFinite(r40.components.fcfMargin)) ? r40.components.fcfMargin : -999;
  const revGrowth = (r40 && r40.computable && r40.components && Number.isFinite(r40.components.growth)) ? r40.components.growth : -999;

// Tag 114-fix: minimal stock data for modal (avoid HTML bloat)
  const stockSlim = {
    meta: { ticker: ticker, name: name, sector: sector,
            industry: (s.meta && s.meta.industry) || '',
            country: (s.meta && s.meta.country) || '',
            marketCap: mcap },
    timeseries: { revenueQ: ((s.timeseries && s.timeseries.revenueQ) || []).slice(0, 8) },
    annual: {
      annualRev: ((s.annual && s.annual.annualRev) || []).slice(0, 5),
      annualOpInc: ((s.annual && s.annual.annualOpInc) || []).slice(0, 5),
      annualFCF: ((s.annual && s.annual.annualFCF) || []).slice(0, 5)
    },
    metrics: { revenueGrowthYoY: (s.metrics && s.metrics.revenueGrowthYoY && s.metrics.revenueGrowthYoY.value != null) ? s.metrics.revenueGrowthYoY.value : null }
  };

    // Tag 121: Tier + Cross-Profile-Badges
    const tier = (opts && opts.tier) || null;
    const xpTags = (opts && opts.crossProfileTags) || [];
    const tierBadge = tier ? `<span class="tier-badge tier-${tier.toLowerCase()}">${tier === 'NEAR_MISS' ? 'Near' : tier}</span>` : '';
    const xpHtml = xpTags.length > 0 ? `<span class="xp-tags">${xpTags.map(t => `<span class="xp-tag">${escHtml(t)}</span>`).join('')}</span>` : '';

    // Tag 133h: per-pick reason-chips. Pulls scoreBreakdown from modeEvals (compute on-demand if missing).
    let chipsHtml = '';
    try {
      const me = (ev.modeEvals && ev.modeEvals[modeId]) || SM.evaluateMode(ev.stock, modeId, ev.allResults);
      const bd = me && me.scoreBreakdown;
      const dqGrade = me && me.dataQualityGrade;
      if (bd && typeof bd === 'object') {
        const chips = Object.entries(bd).map(([mid, b]) => {
          const meta = Runner.METHODS.find(m => m.id === mid);
          const lbl = (meta && meta.label) || mid;
          const short = lbl.replace(/Rule[- ]of[- ]/i, 'R').replace(/Hypergrowth /, 'HG ').slice(0, 18);
          if (!b.computable) return `<span class="chip chip-na" title="${escHtml(lbl + ': incomputable')}">${escHtml(short)}</span>`;
          const cls = b.pass ? 'chip-pass' : 'chip-fail';
          const valStr = b.value == null ? '' : ' ' + fmtValue(b.value, meta && meta.unit);
          const wPct = b.weight ? ' · w' + Math.round(b.weight * 100) : '';
          return `<span class="chip ${cls}" title="${escHtml(lbl + valStr + wPct + ' · score=' + b.score)}">${escHtml(short + valStr)}</span>`;
        }).join('');
        const dqChip = dqGrade ? `<span class="chip chip-dq chip-dq-${dqGrade.toLowerCase()}" title="Data-Quality Grade">DQ ${dqGrade}</span>` : '';
        if (chips || dqChip) chipsHtml = `<div class="chip-strip">${dqChip}${chips}</div>`;
      }
    } catch (e) { /* chips are best-effort; never block row rendering */ }

    return `<div class="row" data-stock="${escHtml(JSON.stringify(stockSlim))}" data-af-url="${afUrl}" data-prof-state="${profState}" data-mcap="${Math.round(mcap||0)}" data-ipo="${ipoYear||0}" data-sector="${escHtml(sector)}" data-fcf-margin="${fcfMargin.toFixed(1)}" data-rev-growth="${revGrowth.toFixed(1)}" data-tier="${tier||''}" data-xp="${xpTags.join(',')}">
    <span class="r-rank">${String(i+1).padStart(3, '0')}</span>
    <span class="r-tk">${escHtml(ticker)}${tierBadge}${xpHtml}</span>
    <span class="r-name">${escHtml(name.slice(0, 36))}${name.length>36?'…':''}</span>
    <span class="r-sec">${escHtml(sector)}</span>
    <span class="r-state ${psClass}">${escHtml(psLabel)}<span class="r-conf">${escHtml(profConf)}</span></span>
    <span class="r-ipo">${ipoYear ? "'"+(ipoYear%100).toString().padStart(2,'0') : '—'}</span>
    <span class="r-spark">${spark}</span>
    <span class="r-val">${escHtml(sortValStr)}</span>
    <span class="r-mcap">${fmtMoney(mcap)}</span>
    ${chipsHtml}
  </div>`;
}

function renderModeContent(modeId, eligible, topN) {  // NEW TAG 136 redesign
  const mode = SM.MODES[modeId];
  if (mode.enabled === false) {
    return `<div class="mode-layout"><div class="mode-disabled">Modus in Phase 2 — noch nicht aktiv. Erst Hypergrowth + Quality validieren.</div></div>`;
  }

  const sectorSet = new Set();
  for (const ev of eligible) { const sec = ev.stock.meta && ev.stock.meta.sector; if (sec) sectorSet.add(sec); }
  const sectors = [...sectorSet].sort();
  const countrySet = new Set();
  for (const ev of eligible) { const reg = ev.stock.meta && ev.stock.meta.region; const cty = REGION_TO_COUNTRY[reg] || reg || ''; if (cty) countrySet.add(cty); }
  const countries = [...countrySet].sort();
  const ipos = eligible.map(e => e.ipoYear || 0).filter(Boolean);
  const ipoMin = ipos.length ? Math.min(...ipos) : 1962;
  const ipoMax = ipos.length ? Math.max(...ipos) : new Date().getFullYear();

  // Picks panel (tier groups)
  const picksList = topByScore(eligible, modeId, topN);
  const groups = { A: [], B: [], NEAR_MISS: [], RED_FLAG: [] };
  for (const ev of picksList) {
    const me = ev.modeEvals[modeId];
    if (me.redFlags && me.redFlags.length > 0) groups.RED_FLAG.push(ev);
    else if (me.tier === 'A') groups.A.push(ev);
    else if (me.tier === 'B') groups.B.push(ev);
    else groups.NEAR_MISS.push(ev);
  }

  function renderTierGroup(label, evs, cls) {
    if (evs.length === 0) return '';
    const cards = evs.map(ev => {
      const me = ev.modeEvals[modeId];
      return renderCard(ev, modeId, { tier: me.tier, crossProfileTags: computeCrossProfileTags(ev.modeEvals, modeId) });
    }).join('');
    return `<div class="tier-section tier-section-${cls}"><div class="tier-header"><span>${escHtml(label)}</span><span class="tier-count">${evs.length}</span></div><div class="card-grid">${cards}</div></div>`;
  }

  const picksHtml = picksList.length === 0
    ? `<div class="empty">Keine Stocks mit Score-Daten.</div>`
    : renderTierGroup('A-Tier — Score ≥ 80', groups.A, 'a') +
      renderTierGroup('B-Tier — Score 65–79', groups.B, 'b') +
      renderTierGroup('Near-Miss — Score 50–64', groups.NEAR_MISS, 'near') +
      renderTierGroup('Red-Flag', groups.RED_FLAG, 'red');

  // Near-misses panel (blocked by 1 MUST)
  const nearList = blockedByOneMust(eligible, modeId, topN);
  let nearHtml = '';
  if (nearList.length === 0) {
    nearHtml = `<div class="empty">Keine Stocks die genau 1 MUST verfehlen.</div>`;
  } else {
    const byMust = {};
    for (const item of nearList) {
      const k = item.failedMust.id;
      if (!byMust[k]) byMust[k] = [];
      byMust[k].push(item);
    }
    nearHtml = Object.keys(byMust).sort().map(mustId => {
      const items = byMust[mustId];
      const meta = Runner.METHODS.find(m => m.id === mustId);
      const mustLabel = (meta && meta.label) || mustId;
      const cards = items.map(item => renderCard(item.ev, modeId, { tier: item.me.tier, crossProfileTags: computeCrossProfileTags(item.ev.modeEvals, modeId) })).join('');
      return `<div class="tier-section tier-section-blocked"><div class="tier-header"><span>Scheitert an: ${escHtml(mustLabel)}</span><span class="tier-count">${items.length}</span></div><div class="card-grid">${cards}</div></div>`;
    }).join('');
  }

  const sectorOptions = `<option value="ALL">Alle Branchen</option>${sectors.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('')}`;
  const countryOptions = `<option value="ALL">Alle Länder</option>${countries.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join("")}`;
  const picksTotal = groups.A.length + groups.B.length + groups.NEAR_MISS.length + groups.RED_FLAG.length;

  return `<div class="mode-layout" data-mode="${modeId}">
  <aside class="sidebar" data-mode="${modeId}" data-ipo-default="${ipoMin}">
    <div class="sb-search-wrap">
      <input class="sb-search" type="text" placeholder="Suche Ticker / Firma…" data-mode="${modeId}" autocomplete="off" spellcheck="false">
    </div>
    <div class="sb-section">
      <div class="sb-label">PROFITABILITÄT</div>
      <div class="sb-pills">
        <button class="ps-btn ps-active" data-mode="${modeId}" data-pstate="ALL">Alle</button>
        <button class="ps-btn ps-stable" data-mode="${modeId}" data-pstate="STABLE">Stable</button>
        <button class="ps-btn ps-recent" data-mode="${modeId}" data-pstate="RECENT">Recent</button>
        <button class="ps-btn ps-turnaround" data-mode="${modeId}" data-pstate="TURNAROUND">Turn.</button>
        <button class="ps-btn ps-loss" data-mode="${modeId}" data-pstate="LOSS">Loss</button>
      </div>
    </div>
    <div class="sb-section">
      <div class="sb-label">MARKTKAP. <span class="sb-val" data-mode="${modeId}" data-slider="mcap-min">$2B</span> → <span class="sb-val" data-mode="${modeId}" data-slider="mcap-max">$500B</span></div>
      <input type="range" class="range-input" data-mode="${modeId}" data-slider="mcap-min" min="2" max="500" step="1" value="2">
      <input type="range" class="range-input" data-mode="${modeId}" data-slider="mcap-max" min="2" max="500" step="1" value="500">
    </div>
    <div class="sb-section">
      <div class="sb-label">WACHSTUM ≥ <span class="sb-val" data-mode="${modeId}" data-slider="growth-min">0%</span></div>
      <input type="range" class="range-input" data-mode="${modeId}" data-slider="growth-min" min="0" max="100" step="1" value="0">
    </div>
    <div class="sb-section">
      <div class="sb-label">FCF-MARGE ≥ <span class="sb-val" data-mode="${modeId}" data-slider="fcf-min">-30%</span></div>
      <input type="range" class="range-input" data-mode="${modeId}" data-slider="fcf-min" min="-30" max="50" step="1" value="-30">
    </div>
    <div class="sb-section">
      <div class="sb-label">IPO SEIT <span class="sb-val" data-mode="${modeId}" data-slider="ipo-min">${ipoMin}</span></div>
      <input type="range" class="range-input" data-mode="${modeId}" data-slider="ipo-min" min="${ipoMin}" max="${ipoMax}" step="1" value="${ipoMin}">
    </div>
    <div class="sb-section">
      <div class="sb-label">SEKTOR</div>
      <select class="sb-select sec-select" data-mode="${modeId}">${sectorOptions}</select>
    </div>
    <div class="sb-section">
      <div class="sb-label">LAND</div>
      <select class="sb-select country-select" data-mode="${modeId}">${countryOptions}</select>
    </div>
    <div class="sb-footer">
      <span class="sb-count"><span class="sb-count-num" data-mode="${modeId}">${picksTotal}</span> sichtbar</span>
      <button class="reset-btn" data-mode="${modeId}">Reset</button>
    </div>
  </aside>
  <div class="content-area">
    <p class="mode-desc">${escHtml(mode.description)}</p>
    <div class="view-toggle">
      <button class="vt-btn vt-active" data-mode="${modeId}" data-view="picks">Picks <span class="vt-count">${picksTotal}</span></button>
      <button class="vt-btn" data-mode="${modeId}" data-view="near">Near-Misses <span class="vt-count">${nearList.length}</span></button>
    </div>
    <div class="view-panel" data-mode="${modeId}" data-view="picks">${picksHtml}</div>
    <div class="view-panel" data-mode="${modeId}" data-view="near" style="display:none">${nearHtml}</div>
  </div>
</div>`;
}

function buildHtml(evaluated, topN) {
  const generatedAt = new Date().toISOString();
  const modes = Object.keys(SM.MODES);
  const eligibleByMode = {};
  for (const m of modes) eligibleByMode[m] = eligibleForMode(evaluated, m);

  const totalStocks = evaluated.length;
  const sectorExcluded = totalStocks - eligibleByMode.HYPERGROWTH.length;
  const hgPicks = topAllMust(eligibleByMode.HYPERGROWTH, 'HYPERGROWTH', 9999).length;
  const qcPicks = topAllMust(eligibleByMode.QUALITY_COMPOUNDER, 'QUALITY_COMPOUNDER', 9999).length;
  const dateLabel = new Date(generatedAt).toLocaleDateString('de-DE', { day:'2-digit', month:'long', year:'numeric' });

  const modeLabels = {
    HYPERGROWTH: 'Hypergrowth',
    QUALITY_COMPOUNDER: 'Quality-Compounder',
    TURNAROUND: 'Turnaround'
  };
  const modeMeta = {
    HYPERGROWTH: 'heuristisch',
    QUALITY_COMPOUNDER: 'literaturgestützt',
    TURNAROUND: 'experimentell'
  };

  const topTabsHtml = modes.map((m, i) => {
    const cls = i === 0 ? 'top-tab-active' : '';
    const dotClass = m === 'HYPERGROWTH' ? 'dot-hg' : m === 'QUALITY_COMPOUNDER' ? 'dot-qc' : 'dot-ta';
    return `<button class="top-tab ${cls}" data-mode="${m}">
      <span class="tt-dot ${dotClass}"></span>
      <span class="tt-name">${modeLabels[m]}</span>
      <span class="tt-meta">${modeMeta[m]}</span>
    </button>`;
  }).join('');

  const contentsHtml = modes.map((m, i) => {
    const visible = i === 0 ? '' : 'display:none;';
    return `<div class="mode-content-wrap" data-mode="${m}" style="${visible}">${renderModeContent(m, eligibleByMode[m], topN)}</div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="de"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stock-Screener · Modes-Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400;500&family=Source+Serif+4:ital,opsz,wght@0,8..60,300;0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0a0b0d; --bg-2: #0f1114; --bg-3: #14171c; --bg-4: #1c2027;
    --line: #1c2027; --line-soft: #14171c; --hairline: #2a2f38;
    --paper: #ebe4d2; --paper-mute: #b8b1a0; --paper-faint: #7a766a; --paper-dim: #4a4842;
    --champagne: #d4b878; --champagne-soft: #2c2519; --champagne-deep: #b59653;
    --gold: #e0c890;
    --sage: #a3b693; --sage-soft: #1c2519;
    --slate: #8a98ad; --slate-soft: #1a2129;
    --warning: #d4a368; --warning-soft: #2a1f12;
    --loss: #b56c66; --loss-soft: #2c1815;
    --turnaround: #d4a368; --turnaround-soft: #2a1f12;
    --recent: #aabb88; --recent-soft: #1f2618;
    --stable: #82b8a0; --stable-soft: #15261f;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { background: var(--bg); }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-2) 100%);
    background-attachment: fixed;
    color: var(--paper);
    font-size: 14px; line-height: 1.55; font-weight: 400;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  .wrap { max-width: 1400px; margin: 0 auto; padding: 48px 32px 96px; }

  /* Header */
  .doc-header { margin-bottom: 32px; }
  .eyebrow {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px; font-weight: 400; letter-spacing: 0.2em;
    text-transform: uppercase; color: var(--champagne); margin-bottom: 16px;
  }
  h1 {
    font-family: 'Source Serif 4', Georgia, serif;
    font-size: clamp(28px, 3.5vw, 40px); font-weight: 300; line-height: 1.08;
    letter-spacing: -0.02em; color: var(--paper); margin-bottom: 10px;
  }
  h1 em { font-style: italic; color: var(--champagne); font-weight: 300; }
  .sub { font-size: 13.5px; color: var(--paper-mute); max-width: 720px; line-height: 1.65; font-weight: 300; }

  /* Status strip */
  .status-strip {
    display: grid; grid-template-columns: repeat(4, 1fr);
    margin: 28px 0;
    border-top: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline);
  }
  .status-cell { padding: 14px 18px; border-right: 1px solid var(--line-soft); }
  .status-cell:last-child { border-right: none; }
  .status-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px; font-weight: 400; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--paper-faint); margin-bottom: 6px;
  }
  .status-value {
    font-family: 'Source Serif 4', serif; font-size: 24px; font-weight: 300;
    color: var(--paper); font-feature-settings: 'tnum'; line-height: 1; letter-spacing: -0.015em;
  }
  .status-sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; color: var(--paper-mute); margin-top: 5px; font-weight: 300; letter-spacing: 0.02em;
  }

  /* Disclaimer */
  .disclaimer {
    padding: 12px 0 12px 18px; margin-bottom: 28px;
    border-left: 1px solid var(--champagne);
    color: var(--gold); font-size: 12.5px; line-height: 1.65; font-weight: 300; max-width: 880px;
  }
  .disclaimer strong { color: var(--champagne); font-weight: 400; }

  /* Top tabs */
  .top-tabs {
    display: flex; gap: 0; margin-bottom: 24px;
    border-bottom: 1px solid var(--hairline);
  }
  .top-tab {
    background: transparent; border: none; cursor: pointer;
    padding: 16px 24px 14px; margin-bottom: -1px;
    border-bottom: 2px solid transparent;
    display: flex; align-items: baseline; gap: 10px;
    color: var(--paper-mute); transition: all 0.18s; font: inherit;
  }
  .top-tab:first-child { padding-left: 0; }
  .top-tab:hover { color: var(--paper); }
  .top-tab.top-tab-active { color: var(--paper); border-bottom-color: var(--champagne); }
  .tt-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .dot-hg { background: var(--champagne); }
  .dot-qc { background: var(--slate); }
  .dot-ta { background: var(--sage); }
  .tt-name { font-family: 'Source Serif 4', serif; font-size: 22px; font-weight: 400; letter-spacing: -0.01em; }
  .tt-meta {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px; font-weight: 400; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--paper-faint);
  }
  .top-tab.top-tab-active .tt-meta { color: var(--champagne); }

  /* Mode layout: sidebar + content */
  .mode-content-wrap { }
  .mode-disabled {
    border-top: 1px solid var(--hairline); padding: 32px;
    text-align: center; color: var(--paper-faint); font-size: 13px; font-style: italic;
  }
  .mode-layout {
    display: grid; grid-template-columns: 256px 1fr; gap: 20px; align-items: start;
  }
  @media (max-width: 900px) { .mode-layout { grid-template-columns: 1fr; } }

  /* Sidebar */
  .sidebar {
    background: var(--bg-2); border: 1px solid var(--hairline); border-radius: 6px;
    padding: 16px; position: sticky; top: 20px;
  }
  .sb-search-wrap { margin-bottom: 14px; }
  .sb-search {
    width: 100%; background: var(--bg-3); border: 1px solid var(--hairline);
    color: var(--paper); padding: 7px 10px; font: inherit; font-size: 12.5px;
    border-radius: 4px; outline: none;
  }
  .sb-search::placeholder { color: var(--paper-faint); }
  .sb-search:focus { border-color: var(--champagne); }
  .sb-section { margin-bottom: 14px; }
  .sb-label {
    font-family: 'JetBrains Mono', monospace; font-size: 9px;
    font-weight: 400; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--paper-faint); margin-bottom: 6px; display: block;
  }
  .sb-val {
    font-family: 'JetBrains Mono', monospace; font-size: 10px;
    color: var(--champagne); font-variant-numeric: tabular-nums;
  }
  .sb-pills { display: flex; flex-wrap: wrap; gap: 4px; }
  .sb-select {
    width: 100%; background: var(--bg-3); border: 1px solid var(--hairline);
    color: var(--paper); padding: 6px 8px; font: inherit; font-size: 12px;
    cursor: pointer; border-radius: 3px;
  }
  .sb-footer {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 6px; padding-top: 12px; border-top: 1px solid var(--hairline);
  }
  .sb-count { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--paper-mute); }
  .sb-count-num { color: var(--champagne); font-weight: 500; }

  /* Profitability filter pills */
  .ps-btn {
    background: transparent; border: none; padding: 4px 10px;
    font: inherit; font-size: 11.5px; font-weight: 400;
    cursor: pointer; color: var(--paper-mute);
    transition: all 0.18s; border-bottom: 1px solid transparent;
  }
  .ps-btn:hover { color: var(--paper); }
  .ps-btn.ps-active { color: var(--champagne); border-bottom-color: var(--champagne); font-weight: 500; }
  .ps-btn.ps-loss.ps-active { color: var(--loss); border-bottom-color: var(--loss); }
  .ps-btn.ps-turnaround.ps-active { color: var(--turnaround); border-bottom-color: var(--turnaround); }
  .ps-btn.ps-recent.ps-active { color: var(--recent); border-bottom-color: var(--recent); }
  .ps-btn.ps-stable.ps-active { color: var(--stable); border-bottom-color: var(--stable); }

  /* Range sliders */
  .range-input { -webkit-appearance: none; appearance: none; background: transparent; width: 100%; height: 14px; }
  .range-input::-webkit-slider-runnable-track { background: var(--hairline); height: 1px; }
  .range-input::-moz-range-track { background: var(--hairline); height: 1px; }
  .range-input::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 9px; height: 9px; border-radius: 50%;
    background: var(--champagne); border: none;
    margin-top: -4px; cursor: pointer; transition: all 0.15s;
  }
  .range-input::-webkit-slider-thumb:hover { background: var(--gold); transform: scale(1.3); }
  .range-input::-moz-range-thumb { width: 9px; height: 9px; border-radius: 50%; background: var(--champagne); border: none; cursor: pointer; }

  /* Reset button */
  .reset-btn {
    background: transparent; border: 1px solid var(--hairline); padding: 4px 12px;
    font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--paper-mute);
    cursor: pointer; text-transform: uppercase; letter-spacing: 0.14em; transition: all 0.18s;
  }
  .reset-btn:hover { border-color: var(--champagne); color: var(--champagne); }

  /* Content area */
  .content-area { min-width: 0; }
  .mode-desc {
    color: var(--paper-mute); font-size: 13px;
    margin-bottom: 16px; font-weight: 300; max-width: 720px; line-height: 1.65;
  }

  /* View toggle */
  .view-toggle {
    display: flex; gap: 0; margin-bottom: 18px;
    border-bottom: 1px solid var(--hairline);
  }
  .vt-btn {
    background: transparent; border: none; cursor: pointer; font: inherit;
    padding: 9px 16px 7px; border-bottom: 2px solid transparent; margin-bottom: -1px;
    color: var(--paper-mute); font-size: 13px; transition: all .15s;
    display: flex; align-items: baseline; gap: 6px;
  }
  .vt-btn:hover { color: var(--paper); }
  .vt-btn.vt-active { color: var(--paper); border-bottom-color: var(--champagne); }
  .vt-count {
    font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--paper-faint);
  }
  .vt-btn.vt-active .vt-count { color: var(--champagne); }

  /* Tier sections */
  .tier-section { margin-bottom: 24px; }
  .tier-header {
    font-size: 11px; font-weight: 600; color: var(--paper); padding: 7px 12px;
    background: linear-gradient(90deg, rgba(217,119,6,0.15), transparent);
    border-left: 3px solid #d97706; margin-bottom: 10px;
    letter-spacing: 0.5px; text-transform: uppercase;
    display: flex; justify-content: space-between; align-items: center;
  }
  .tier-count {
    font-family: 'JetBrains Mono', monospace; font-size: 10px;
    font-weight: 400; color: var(--paper-faint);
  }
  .tier-section-a .tier-header { border-left-color: #16a34a; background: linear-gradient(90deg, rgba(22,163,74,0.15), transparent); }
  .tier-section-b .tier-header { border-left-color: #2563eb; background: linear-gradient(90deg, rgba(37,99,235,0.15), transparent); }
  .tier-section-near .tier-header { border-left-color: #ca8a04; background: linear-gradient(90deg, rgba(202,138,4,0.15), transparent); }
  .tier-section-red .tier-header { border-left-color: #dc2626; background: linear-gradient(90deg, rgba(220,38,38,0.15), transparent); }
  .tier-section-blocked .tier-header { border-left-color: #d97706; background: linear-gradient(90deg, rgba(217,119,6,0.18), transparent); }

  /* Card grid */
  .card-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px;
  }
  .card {
    background: var(--bg-3); border: 1px solid var(--hairline); border-radius: 6px;
    padding: 13px 14px; cursor: pointer;
    transition: border-color .15s, background .15s;
  }
  .card:hover { border-color: var(--champagne); background: rgba(212,184,120,0.03); }
  .card-top {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin-bottom: 3px;
  }
  .card-ticker {
    font-family: 'Source Serif 4', serif; font-size: 17px; font-weight: 500;
    color: var(--paper); letter-spacing: 0;
  }
  .card-badges { display: flex; gap: 3px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
  .card-name {
    font-size: 10.5px; color: var(--paper-mute); margin-bottom: 7px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .card-score-bar { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
  .csb-track { flex: 1; height: 3px; background: var(--bg-4); border-radius: 2px; }
  .csb-fill { height: 100%; border-radius: 2px; transition: width .2s; min-width: 2px; }
  .csb-fill.csb-na { width: 0; min-width: 0; }
  .csb-num {
    font-family: 'JetBrains Mono', monospace; font-size: 11.5px; font-weight: 500;
    min-width: 22px; text-align: right; font-variant-numeric: tabular-nums;
  }
  .csb-na-num { color: var(--paper-faint); }
  .card-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; }
  .card-sector { font-size: 10px; color: var(--paper-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%; }
  .card-mcap { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--paper-mute); }
  .card-metrics { gap: 5px; flex-wrap: wrap; margin-bottom: 4px; }
  .card-pstate {
    font-size: 9px; padding: 2px 5px; border-radius: 3px;
    font-family: 'JetBrains Mono', monospace; letter-spacing: 0.04em;
  }
  .card-metric { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: var(--paper-mute); }
  .card-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; }
  .card-spark svg { display: block; }
  .card-ipo { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: var(--paper-faint); }
  .card-chips { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 3px; }

  /* Card badges */
  .cb-tier {
    display: inline-block; padding: 1px 5px; border-radius: 3px;
    font-size: 8.5px; font-weight: 700; letter-spacing: 0.3px;
    font-family: 'JetBrains Mono', monospace;
  }
  .cb-tier-a { background: rgba(22,163,74,0.2); color: #4ade80; }
  .cb-tier-b { background: rgba(37,99,235,0.2); color: #93c5fd; }
  .cb-tier-near_miss { background: rgba(202,138,4,0.2); color: #fde047; }
  .cb-tier-reject { background: rgba(107,114,128,0.2); color: #9ca3af; }
  .cb-xp {
    display: inline-block; padding: 1px 5px; border-radius: 3px;
    font-size: 8.5px; font-weight: 700;
    background: linear-gradient(135deg, #d97706, #f59e0b); color: #fff;
    font-family: 'JetBrains Mono', monospace;
  }
  .cb-dq { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 8.5px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
  .cb-dq-a { background: rgba(22,163,74,0.22); color: #4ade80; }
  .cb-dq-b { background: rgba(37,99,235,0.22); color: #93c5fd; }
  .cb-dq-c { background: rgba(202,138,4,0.22); color: #fde047; }
  .cb-dq-d { background: rgba(220,38,38,0.28); color: #fca5a5; }

  /* Profitability state colors (reused in cards) */
  .pst-loss { background: var(--loss-soft); color: var(--loss); }
  .pst-turnaround { background: var(--turnaround-soft); color: var(--turnaround); }
  .pst-recent { background: var(--recent-soft); color: var(--recent); }
  .pst-stable { background: var(--stable-soft); color: var(--stable); }
  .pst-na { background: var(--bg-4); color: var(--paper-faint); }

  /* Chip strip inside cards */
  .chip {
    display: inline-block; padding: 2px 5px; border-radius: 3px;
    font-size: 9px; line-height: 1.2; letter-spacing: 0.02em;
    font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums;
  }
  .chip-pass { background: rgba(22,163,74,0.16); color: #4ade80; }
  .chip-fail { background: rgba(220,38,38,0.16); color: #f87171; }
  .chip-na   { background: rgba(107,114,128,0.18); color: #9ca3af; opacity: 0.7; }

  .empty {
    padding: 40px 24px; text-align: center;
    color: var(--paper-faint); font-size: 13px; font-style: italic;
    border-top: 1px solid var(--hairline);
  }

  footer {
    margin-top: 64px; padding-top: 24px;
    border-top: 1px solid var(--hairline);
    font-size: 11px; color: var(--paper-faint);
    display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px;
    font-weight: 300; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.02em;
  }

  /* Modal */
  .card { cursor: pointer; }
  #stockModalBackdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 999; display: none; }
  #stockModalBackdrop.show { display: block; }
  #stockModalPanel { position: fixed; top: 0; right: 0; width: 720px; max-width: 95vw; height: 100vh; background: #1a1a1a; z-index: 1000; transform: translateX(100%); transition: transform .25s ease; overflow-y: auto; padding: 24px 28px; box-shadow: -8px 0 32px rgba(0,0,0,0.5); }
  #stockModalPanel.show { transform: translateX(0); }
  #stockModalClose { position: absolute; top: 16px; right: 20px; background: none; border: 0; color: #999; font-size: 24px; cursor: pointer; }
  #stockModalClose:hover { color: #fff; }
  #stockModalBody h2 { margin: 0 0 4px; font-size: 22px; color: #fff; }
  #stockModalBody .modal-meta { color: #888; font-size: 12px; margin-bottom: 20px; }
  #stockModalBody .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
  #stockModalBody .kpi { background: #222; padding: 10px 12px; border-radius: 6px; }
  #stockModalBody .kpi .lbl { color: #888; font-size: 11px; text-transform: uppercase; }
  #stockModalBody .kpi .val { color: #fff; font-size: 17px; font-weight: 600; margin-top: 2px; }
  #stockModalBody .chart-block { margin: 18px 0 6px; }
  #stockModalBody .chart-title { color: #ccc; font-size: 13px; margin-bottom: 4px; }
  #stockModalBody .chart-svg { background: #0f0f0f; border-radius: 4px; }
  #stockModalBody .af-btn { display: inline-block; margin-top: 18px; padding: 10px 16px; background: #d97706; color: #fff; border: 0; border-radius: 6px; cursor: pointer; font-size: 13px; }
  #stockModalBody .af-btn:hover { background: #b45309; }
  #modalToast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); background: #333; color: #fff; padding: 12px 20px; border-radius: 6px; z-index: 1100; opacity: 0; transition: opacity .2s; pointer-events: none; }
  #modalToast.show { opacity: 1; }

  @media (max-width: 768px) {
    .status-strip { grid-template-columns: repeat(2, 1fr); }
    .card-grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
    .wrap { padding: 32px 16px 64px; }
  }
</style>
</head>
<body>
<div class="wrap">

  <header class="doc-header">
    <div class="eyebrow">Modes-Report &middot; ${escHtml(dateLabel)}</div>
    <h1>Drei Strategien, <em>klare</em> Story-Cards.</h1>
    <p class="sub">Discovery-Filter über ${totalStocks.toLocaleString('de-DE')} Stocks. Banks · REITs · Insurance · Mining · Oil &amp; Gas werden automatisch ausgeschlossen. DataGuards filtern Earnings-Manipulation, Solvenz-Risiken und Reverse-Mergers. Klick auf eine Aktie öffnet Aktienfinder.</p>
  </header>

  <div class="status-strip">
    <div class="status-cell"><div class="status-label">Universum</div><div class="status-value">${totalStocks.toLocaleString('de-DE')}</div><div class="status-sub">Stocks gepullt</div></div>
    <div class="status-cell"><div class="status-label">Sektor-Exclude</div><div class="status-value">${sectorExcluded.toLocaleString('de-DE')}</div><div class="status-sub">Banks · REITs · Mining</div></div>
    <div class="status-cell"><div class="status-label">Hypergrowth</div><div class="status-value">${hgPicks}</div><div class="status-sub">erfüllen alle MUST</div></div>
    <div class="status-cell"><div class="status-label">Quality</div><div class="status-value">${qcPicks}</div><div class="status-sub">erfüllen alle MUST</div></div>
  </div>

  <div class="disclaimer">
    <strong>Discovery-Tool, kein Alpha-System.</strong> Strukturierte Ideenquelle, keine Outperformance-Garantie. Finale Entscheidung liegt bei deinem Deep-Dive (Aktienfinder, Elliot-Wellen).
  </div>

  <div class="top-tabs">${topTabsHtml}</div>

  ${contentsHtml}

  <footer>
    <div>Karl's Stock-Screener · keine Anlageberatung · Daten via Yahoo Finance</div>
    <div>Generated ${escHtml(generatedAt.slice(0,16).replace('T',' '))} UTC</div>
  </footer>

</div>

<script>
(function() {
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function fmtMcap(b) {
    if (b >= 1000) return '$' + (b/1000).toFixed(1) + 'T';
    if (b >= 1) return '$' + Math.round(b) + 'B';
    return '$' + Math.round(b*1000) + 'M';
  }
  function fmtM(v) { if (v == null || !isFinite(v)) return 'n/a'; var n = Math.abs(v); if (n >= 1e9) return (v/1e9).toFixed(2) + 'B'; if (n >= 1e6) return (v/1e6).toFixed(1) + 'M'; return v.toFixed(0); }
  function fmtP(v) { return (v == null || !isFinite(v)) ? 'n/a' : v.toFixed(1) + '%'; }
  function spk(values, w, h, color) {
    if (!values || !values.length) return '';
    w = w||280; h = h||60; color = color||'#fbbf24';
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values), range = (max-min)||1;
    var pts = values.map(function(v,i){ var x = (i/(values.length-1||1))*(w-4)+2; var y = h-2-((v-min)/range)*(h-4); return x.toFixed(1)+','+y.toFixed(1); });
    return '<svg class="chart-svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'"><polyline fill="none" stroke="'+color+'" stroke-width="2" points="'+pts.join(' ')+'"/></svg>';
  }
  function arrVals(a) { if (!Array.isArray(a)) return []; return a.map(function(x){ return typeof x === 'number' ? x : (x&&x.value); }).filter(function(v){ return isFinite(v); }); }

  function openStockModal(stock, afUrl) {
    var b = document.getElementById('stockModalBody');
    if (!b) return;
    var m = stock.meta || {}, ts = stock.timeseries || {}, ann = stock.annual || {};
    var revQ = arrVals(ts.revenueQ).slice().reverse();
    var revA = arrVals(ann.annualRev).slice().reverse();
    var oiA  = arrVals(ann.annualOpInc).slice().reverse();
    var fcfA = arrVals(ann.annualFCF).slice().reverse();
    var mcap = (typeof m.marketCap === 'number') ? m.marketCap : (m.marketCap && m.marketCap.value);
    var html = '<h2>' + escHtml(m.ticker||'?') + ' &middot; ' + escHtml(m.name||'') + '</h2>';
    html += '<div class="modal-meta">' + escHtml(m.sector||'') + ' &middot; ' + escHtml(m.industry||'') + ' &middot; ' + escHtml(m.country||'') + '</div>';
    html += '<div class="kpi-grid">';
    html += '<div class="kpi"><div class="lbl">Market Cap</div><div class="val">' + fmtM(mcap) + '</div></div>';
    html += '<div class="kpi"><div class="lbl">Rev TTM</div><div class="val">' + fmtM(revA[revA.length-1]) + '</div></div>';
    html += '<div class="kpi"><div class="lbl">YoY</div><div class="val">' + fmtP(stock.metrics && stock.metrics.revenueGrowthYoY) + '</div></div>';
    html += '</div>';
    html += '<div class="chart-block"><div class="chart-title">Revenue (annual, 5y)</div>' + spk(revA.slice(-5), 640, 90, '#fbbf24') + '</div>';
    html += '<div class="chart-block"><div class="chart-title">Revenue (quarterly, 8Q)</div>' + spk(revQ.slice(-8), 640, 90, '#60a5fa') + '</div>';
    html += '<div class="chart-block"><div class="chart-title">Operating Income (annual, 5y)</div>' + spk(oiA.slice(-5), 640, 90, '#10b981') + '</div>';
    html += '<div class="chart-block"><div class="chart-title">Free Cash Flow (annual, 5y)</div>' + spk(fcfA.slice(-5), 640, 90, '#a78bfa') + '</div>';
    if (afUrl) html += '<button class="af-btn" data-af="' + afUrl + '">Aktienfinder oeffnen</button>';
    b.innerHTML = html;
    var afBtn = b.querySelector('.af-btn');
    if (afBtn) afBtn.addEventListener('click', function(){ window.open(afBtn.dataset.af, '_blank'); });
    document.getElementById('stockModalBackdrop').classList.add('show');
    var pn = document.getElementById('stockModalPanel');
    pn.classList.add('show'); pn.setAttribute('aria-hidden', 'false');
  }
  function closeStockModal() {
    var bd = document.getElementById('stockModalBackdrop');
    var pn = document.getElementById('stockModalPanel');
    if (bd) bd.classList.remove('show');
    if (pn) { pn.classList.remove('show'); pn.setAttribute('aria-hidden', 'true'); }
  }
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeStockModal(); });

  function syncSliderLabel(input) {
    var mode = input.dataset.mode, which = input.dataset.slider;
    var el = document.querySelector('.sb-val[data-mode="' + mode + '"][data-slider="' + which + '"]');
    if (!el) return;
    var v = parseFloat(input.value);
    if (which === 'mcap-min' || which === 'mcap-max') el.textContent = fmtMcap(v);
    else if (which === 'fcf-min' || which === 'growth-min') el.textContent = (v >= 0 ? '+' : '') + Math.round(v) + '%';
    else el.textContent = String(Math.round(v));
  }

  function applyFilters(mode) {
    var sb = document.querySelector('.sidebar[data-mode="' + mode + '"]');
    if (!sb) return;
    var ipoDefault = parseFloat(sb.dataset.ipoDefault || '1962');
    var activePs = sb.querySelector('.ps-btn.ps-active');
    var pstate = activePs ? activePs.dataset.pstate : 'ALL';
    var mcapMinEl   = sb.querySelector('[data-slider="mcap-min"].range-input');
    var mcapMaxEl   = sb.querySelector('[data-slider="mcap-max"].range-input');
    var ipoMinEl    = sb.querySelector('[data-slider="ipo-min"].range-input');
    var fcfMinEl    = sb.querySelector('[data-slider="fcf-min"].range-input');
    var growthMinEl = sb.querySelector('[data-slider="growth-min"].range-input');
    var secEl       = sb.querySelector('.sec-select');
    var cselEl      = sb.querySelector('.country-select');
    var searchEl    = sb.querySelector('.sb-search');
    var mcapMin   = mcapMinEl   ? parseFloat(mcapMinEl.value)   * 1e9 : 0;
    var mcapMax   = mcapMaxEl   ? parseFloat(mcapMaxEl.value)   * 1e9 : Infinity;
    var ipoMin    = ipoMinEl    ? parseFloat(ipoMinEl.value)          : 0;
    var ipoActive = ipoMin > ipoDefault;
    var fcfMin    = fcfMinEl    ? parseFloat(fcfMinEl.value)          : -999;
    var growthMin = growthMinEl ? parseFloat(growthMinEl.value)       : 0;
    var sector    = secEl    ? secEl.value    : 'ALL';
    var country   = cselEl   ? cselEl.value   : 'ALL';
    var query     = searchEl ? searchEl.value.trim().toLowerCase() : '';

    var visible = 0;
    document.querySelectorAll('.mode-layout[data-mode="' + mode + '"] .card').forEach(function(card) {
      var ps    = card.dataset.profState || '';
      var mcap  = parseFloat(card.dataset.mcap) || 0;
      var ipo   = parseFloat(card.dataset.ipo) || 0;
      var sec   = card.dataset.sector || '';
      var fcfM  = parseFloat(card.dataset.fcfMargin);
      var revG  = parseFloat(card.dataset.revGrowth);
      var cname = card.dataset.name   || '';
      var ctick = card.dataset.ticker || '';
      var cty   = card.dataset.country || '';
      var psOk      = pstate === 'ALL' || ps === pstate;
      var mcapOk    = mcap >= mcapMin && mcap <= mcapMax;
      var ipoOk     = !ipoActive || (ipo > 0 && ipo >= ipoMin);
      var secOk     = sector === 'ALL' || sec === sector;
      var countryOk = country === 'ALL' || cty === country;
      var fcfOk     = (fcfMin <= -30) || (Number.isFinite(fcfM) && fcfM > -100 && fcfM >= fcfMin);
      var growthOk  = (growthMin <= 0) || (Number.isFinite(revG) && revG > -100 && revG >= growthMin);
      var searchOk  = !query || ctick.includes(query) || cname.includes(query);
      var show = psOk && mcapOk && ipoOk && secOk && countryOk && fcfOk && growthOk && searchOk;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    var countEl = document.querySelector('.sb-count-num[data-mode="' + mode + '"]');
    if (countEl) countEl.textContent = String(visible);
  }

  // Range sliders
  document.querySelectorAll('.range-input').forEach(function(input) {
    syncSliderLabel(input);
    input.addEventListener('input', function() {
      var mode = input.dataset.mode;
      if (input.dataset.slider === 'mcap-min') {
        var maxEl = document.querySelector('.sidebar[data-mode="' + mode + '"] [data-slider="mcap-max"].range-input');
        if (maxEl && parseFloat(input.value) > parseFloat(maxEl.value)) input.value = maxEl.value;
      } else if (input.dataset.slider === 'mcap-max') {
        var minEl = document.querySelector('.sidebar[data-mode="' + mode + '"] [data-slider="mcap-min"].range-input');
        if (minEl && parseFloat(input.value) < parseFloat(minEl.value)) input.value = minEl.value;
      }
      syncSliderLabel(input);
      applyFilters(mode);
    });
  });

  // Sector selects
  document.querySelectorAll('.sb-select').forEach(function(sel) {
    sel.addEventListener('change', function() { applyFilters(sel.dataset.mode); });
  });

  // Search inputs
  document.querySelectorAll('.sb-search').forEach(function(inp) {
    inp.addEventListener('input', function() { applyFilters(inp.dataset.mode); });
  });

  document.addEventListener('click', function(e) {
    var t = e.target;
    // Close modal
    if (t.id === 'stockModalBackdrop' || t.id === 'stockModalClose') { closeStockModal(); return; }

    // Top mode tabs
    var topTab = t.closest && t.closest('.top-tab');
    if (topTab) {
      var mode = topTab.dataset.mode;
      document.querySelectorAll('.top-tab').forEach(function(b) { b.classList.remove('top-tab-active'); });
      topTab.classList.add('top-tab-active');
      document.querySelectorAll('.mode-content-wrap').forEach(function(w) {
        w.style.display = w.dataset.mode === mode ? '' : 'none';
      });
      return;
    }

    // View toggle (Picks / Near-Misses)
    var vtBtn = t.closest && t.closest('.vt-btn');
    if (vtBtn) {
      var mode = vtBtn.dataset.mode, view = vtBtn.dataset.view;
      document.querySelectorAll('.vt-btn[data-mode="' + mode + '"]').forEach(function(b) { b.classList.remove('vt-active'); });
      vtBtn.classList.add('vt-active');
      document.querySelectorAll('.view-panel[data-mode="' + mode + '"]').forEach(function(p) {
        p.style.display = p.dataset.view === view ? '' : 'none';
      });
      return;
    }

    // Profitability state pills
    if (t.classList && t.classList.contains('ps-btn')) {
      var mode = t.dataset.mode;
      document.querySelectorAll('.ps-btn[data-mode="' + mode + '"]').forEach(function(b) { b.classList.remove('ps-active'); });
      t.classList.add('ps-active');
      applyFilters(mode);
      return;
    }

    // Reset button
    if (t.classList && t.classList.contains('reset-btn')) {
      var mode = t.dataset.mode;
      var sb = document.querySelector('.sidebar[data-mode="' + mode + '"]');
      if (!sb) return;
      sb.querySelectorAll('.ps-btn').forEach(function(b) { b.classList.remove('ps-active'); });
      var allBtn = sb.querySelector('.ps-btn[data-pstate="ALL"]');
      if (allBtn) allBtn.classList.add('ps-active');
      sb.querySelectorAll('.range-input').forEach(function(inp) {
        var s = inp.dataset.slider;
        inp.value = (s === 'mcap-max') ? inp.max : inp.min;
        syncSliderLabel(inp);
      });
      sb.querySelectorAll('.sb-select').forEach(function(sel) { sel.value = 'ALL'; });
      var search = sb.querySelector('.sb-search');
      if (search) search.value = '';
      applyFilters(mode);
      return;
    }

    // Card click → modal
    var card = t.closest && t.closest('.card');
    if (card && card.dataset.stock) {
      e.preventDefault();
      try { openStockModal(JSON.parse(card.dataset.stock), card.dataset.afUrl); } catch (err) { console.error(err); }
      return;
    }
  });
})();
</script>

<div id="stockModalBackdrop"></div>
<aside id="stockModalPanel" role="dialog" aria-hidden="true">
  <button id="stockModalClose" aria-label="Schliessen">&times;</button>
  <div id="stockModalBody"></div>
</aside>
<div id="modalToast"></div>
</body></html>`;
}

function main() {
  const args = parseArgs(process.argv);
  console.log('Loading snapshots from', args.snapshots);
  const stocks = loadStocks(args.snapshots);
  console.log('  loaded', stocks.length, 'stocks');
  let evaluated = evaluateAll(stocks);
  console.log('  evaluated all methods,', evaluated.length, 'stocks');
  evaluated = dedupeByCompany(evaluated);
  console.log('  after dedupe:', evaluated.length, 'unique companies');

  const html = buildHtml(evaluated, args.topN);
  fs.writeFileSync(args.out, html);
  console.log('Wrote', args.out, '(' + (html.length/1024).toFixed(0) + ' KB)');

  for (const modeId of Object.keys(SM.MODES)) {
    const eligible = eligibleForMode(evaluated, modeId);
    const allMust = topAllMust(eligible, modeId, args.topN);
    console.log(`  ${modeId}: ${eligible.length} eligible, ${allMust.length} all-MUST-pass`);
  }
}

if (require.main === module) main();
module.exports = { eligibleForMode, topByMethod, topAllMust, evaluateAll, dedupeByCompany };
