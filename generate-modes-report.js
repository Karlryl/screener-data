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
  }).filter(Boolean);
}

function evaluateAll(stocks) {
  return stocks.map(stock => {
    const allResults = Runner.evaluateStock(stock);
    const mcap = (stock.marketCap && stock.marketCap.value) || stock.marketCap || 0;
    const ipoYear = stock.meta && stock.meta.ipoYear ? stock.meta.ipoYear : null;
    return { stock, allResults, mcap, ipoYear };
  });
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

function renderRow(ev, i, modeId, sortMethodId) {
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

  // Tag 114: Stock-Daten als JSON fuer Modal
  const _arrV = a => Array.isArray(a) ? a.map(v => v == null ? null : (typeof v === 'number' ? v : v.value)).filter(v => Number.isFinite(v)) : [];
  const hgRes = ev.allResults['hypergrowth-quality-class'];
  const hgClass = (hgRes && hgRes.computable && hgRes.components && hgRes.components.class) || null;
  const stockData = {
    ticker, name, sector,
    industry: (s.meta && s.meta.industry) || '',
    ipoYear: ipoYear || null,
    mcap: mcap || 0,
    afUrl,
    annualRev: _arrV(s.annual && s.annual.annualRev).slice(0, 5),
    annualOpInc: _arrV(s.annual && s.annual.annualOpInc).slice(0, 5),
    annualFCF: _arrV(s.annual && s.annual.annualFCF).slice(0, 5),
    annualGP: _arrV(s.annual && s.annual.annualGP).slice(0, 5),
    annualNetIncome: _arrV(s.annual && s.annual.annualNetIncome).slice(0, 5),
    revenueGrowthYoY: (function(){ const m = s.metrics && s.metrics.revenueGrowthYoY; return m == null ? null : (typeof m === 'number' ? m : m.value); })(),
    fcfMarginTTM: (function(){ const m = s.metrics && s.metrics.fcfMarginTTM; return m == null ? null : (typeof m === 'number' ? m : m.value); })(),
    rule40: (r40 && r40.computable) ? r40.value : null,
    profState, hgClass
  };
  const stockJson = escHtml(JSON.stringify(stockData));

  return `<div class="row" data-prof-state="${profState}" data-mcap="${Math.round(mcap||0)}" data-ipo="${ipoYear||0}" data-sector="${escHtml(sector)}" data-fcf-margin="${fcfMargin.toFixed(1)}" data-rev-growth="${revGrowth.toFixed(1)}" data-stock="${stockJson}" data-af-url="${escHtml(afUrl)}">
    <span class="r-rank">${String(i+1).padStart(3, '0')}</span>
    <span class="r-tk">${escHtml(ticker)}</span>
    <span class="r-name">${escHtml(name.slice(0, 36))}${name.length>36?'…':''}</span>
    <span class="r-sec">${escHtml(sector)}</span>
    <span class="r-state ${psClass}">${escHtml(psLabel)}<span class="r-conf">${escHtml(profConf)}</span></span>
    <span class="r-ipo">${ipoYear ? "'"+(ipoYear%100).toString().padStart(2,'0') : '—'}</span>
    <span class="r-spark">${spark}</span>
    <span class="r-val">${escHtml(sortValStr)}</span>
    <span class="r-mcap">${fmtMoney(mcap)}</span>
  </div>`;
}

function renderModeContent(modeId, eligible, topN) {
  const mode = SM.MODES[modeId];
  if (mode.enabled === false) {
    return `<div class="mode-disabled">Modus in Phase 2 — noch nicht aktiv. Erst Hypergrowth + Quality validieren.</div>`;
  }

  // Distinct sectors aus eligible
  const sectorSet = new Set();
  for (const ev of eligible) {
    const s = ev.stock.meta && ev.stock.meta.sector;
    if (s) sectorSet.add(s);
  }
  const sectors = [...sectorSet].sort();

  const tabMethods = mode.core.map(c => c.id);
  const tabs = ['__ALL_MUST__', ...tabMethods];
  const defaultTab = '__ALL_MUST__';

  const tabButtonsHtml = tabs.map(tabId => {
    const isAllMust = tabId === '__ALL_MUST__';
    const methodMeta = isAllMust ? null : Runner.METHODS.find(m => m.id === tabId);
    const label = isAllMust ? 'Beste Kandidaten' : (methodMeta && methodMeta.label) || tabId;
    const active = tabId === defaultTab;
    return `<button class="sub-tab ${active ? 'sub-tab-active' : ''}" data-mode="${modeId}" data-tab="${escHtml(tabId)}">${escHtml(label)}</button>`;
  }).join('');

  const panelsHtml = tabs.map(tabId => {
    const isAllMust = tabId === '__ALL_MUST__';
    const sortMethodId = isAllMust ? mode.defaultSortMethod : tabId;
    const sortMethodMeta = isAllMust ? Runner.METHODS.find(m => m.id === mode.defaultSortMethod) : Runner.METHODS.find(m => m.id === tabId);
    const headerLabel = isAllMust ? ((sortMethodMeta && sortMethodMeta.label) || 'Score') : ((sortMethodMeta && sortMethodMeta.label) || tabId);

    let rows;
    if (isAllMust) {
      const list = topAllMust(eligible, modeId, topN);
      rows = list.length === 0
        ? `<div class="empty">Keine Stocks erfüllen alle MUST-Kriterien.</div>`
        : list.map((ev, i) => renderRow(ev, i, modeId, mode.defaultSortMethod)).join('');
    } else {
      const list = topByMethod(eligible, tabId, sortMethodMeta, topN);
      rows = list.length === 0
        ? `<div class="empty">Keine Stocks mit computable Werten für diese Methode.</div>`
        : list.map((ev, i) => renderRow(ev, i, modeId, tabId)).join('');
    }

    const tableHead = `<div class="table-head">
      <span class="r-rank">#</span>
      <span class="r-tk">Ticker</span>
      <span class="r-name">Firma</span>
      <span class="r-sec">Sektor</span>
      <span class="r-state">Profit.</span>
      <span class="r-ipo">IPO</span>
      <span class="r-spark">Trend</span>
      <span class="r-val">${escHtml(headerLabel)}</span>
      <span class="r-mcap">Mcap</span>
    </div>`;

    const visible = tabId === defaultTab ? '' : 'display:none;';
    return `<div class="sub-panel" data-mode="${modeId}" data-tab="${escHtml(tabId)}" style="${visible}">
      ${tableHead}
      <div class="row-list">${rows}</div>
    </div>`;
  }).join('');

  // Filter
  const ipos = eligible.map(e => e.ipoYear || 0).filter(Boolean);
  const ipoMin = ipos.length ? Math.min(...ipos) : 1980;
  const ipoMax = ipos.length ? Math.max(...ipos) : new Date().getFullYear();

  const sectorPills = `<select class="sec-select" data-mode="${modeId}">
    <option value="ALL">Alle Branchen</option>
    ${sectors.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('')}
  </select>`;

  const filtersHtml = `
    <div class="filters" data-mode="${modeId}" data-ipo-default="${ipoMin}">
      <div class="f-row">
        <span class="f-label">Profit.</span>
        <button class="ps-btn ps-active" data-mode="${modeId}" data-pstate="ALL">Alle</button>
        <button class="ps-btn ps-loss" data-mode="${modeId}" data-pstate="LOSS">Loss</button>
        <button class="ps-btn ps-turnaround" data-mode="${modeId}" data-pstate="TURNAROUND">Turnaround</button>
        <button class="ps-btn ps-recent" data-mode="${modeId}" data-pstate="RECENT">Recent</button>
        <button class="ps-btn ps-stable" data-mode="${modeId}" data-pstate="STABLE">Stable</button>
      </div>
      <div class="f-row">
        <span class="f-label">MarketCap</span>
        <span class="slider-val" data-mode="${modeId}" data-slider="mcap-min">$2B</span>
        <input type="range" class="range-input" data-mode="${modeId}" data-slider="mcap-min" min="2" max="500" step="1" value="2">
        <span class="slider-sep">→</span>
        <input type="range" class="range-input" data-mode="${modeId}" data-slider="mcap-max" min="2" max="500" step="1" value="500">
        <span class="slider-val" data-mode="${modeId}" data-slider="mcap-max">$500B</span>
      </div>
      <div class="f-row">
        <span class="f-label">IPO ab</span>
        <input type="range" class="range-input" data-mode="${modeId}" data-slider="ipo-min" min="${ipoMin}" max="${ipoMax}" step="1" value="${ipoMin}">
        <span class="slider-val" data-mode="${modeId}" data-slider="ipo-min">${ipoMin}</span>
        <span class="f-label" style="margin-left:24px;">Branche</span>
        ${sectorPills}
      </div>
      <div class="f-row">
        <span class="f-label">FCF-Marge ≥</span>
        <input type="range" class="range-input" data-mode="${modeId}" data-slider="fcf-min" min="-30" max="50" step="1" value="-30">
        <span class="slider-val" data-mode="${modeId}" data-slider="fcf-min">-30%</span>
        <span class="f-label" style="margin-left:24px;">Wachstum ≥</span>
        <input type="range" class="range-input" data-mode="${modeId}" data-slider="growth-min" min="0" max="100" step="1" value="0">
        <span class="slider-val" data-mode="${modeId}" data-slider="growth-min">0%</span>
        <button class="reset-btn" data-mode="${modeId}">Reset</button>
      </div>
    </div>`;

  return `<div class="mode-content" data-mode="${modeId}">
    <p class="mode-desc">${escHtml(mode.description)}</p>
    ${filtersHtml}
    <div class="sub-tabs">${tabButtonsHtml}</div>
    ${panelsHtml}
  </div>`;
}

function buildHtml(evaluated, topN) {
  const generatedAt = new Date().toISOString();
  const modes = ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND'];
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
    font-feature-settings: 'kern', 'liga', 'calt';
  }
  .wrap { max-width: 1320px; margin: 0 auto; padding: 56px 36px 96px; }

  /* Header */
  .doc-header { margin-bottom: 32px; }
  .eyebrow {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px; font-weight: 400; letter-spacing: 0.2em;
    text-transform: uppercase; color: var(--champagne); margin-bottom: 16px;
  }
  h1 {
    font-family: 'Source Serif 4', Georgia, serif;
    font-size: clamp(32px, 4vw, 44px); font-weight: 300; line-height: 1.06;
    letter-spacing: -0.02em; color: var(--paper); margin-bottom: 12px;
  }
  h1 em { font-style: italic; color: var(--champagne); font-weight: 300; }
  .sub { font-size: 14px; color: var(--paper-mute); max-width: 720px; line-height: 1.65; font-weight: 300; }

  /* Status */
  .status-strip {
    display: grid; grid-template-columns: repeat(4, 1fr);
    margin: 32px 0;
    border-top: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline);
  }
  .status-cell { padding: 16px 20px; border-right: 1px solid var(--line-soft); }
  .status-cell:last-child { border-right: none; }
  .status-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px; font-weight: 400; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--paper-faint); margin-bottom: 8px;
  }
  .status-value {
    font-family: 'Source Serif 4', serif; font-size: 26px; font-weight: 300;
    color: var(--paper); font-feature-settings: 'tnum'; line-height: 1; letter-spacing: -0.015em;
  }
  .status-sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px; color: var(--paper-mute); margin-top: 6px; font-weight: 300; letter-spacing: 0.02em;
  }

  /* Disclaimer */
  .disclaimer {
    padding: 12px 0 12px 20px; margin-bottom: 32px;
    border-left: 1px solid var(--champagne);
    color: var(--gold); font-size: 12.5px; line-height: 1.65; font-weight: 300; max-width: 880px;
  }
  .disclaimer strong { color: var(--champagne); font-weight: 400; }

  /* TOP TABS — gross, edel */
  .top-tabs {
    display: flex; gap: 0; margin-bottom: 28px;
    border-bottom: 1px solid var(--hairline);
  }
  .top-tab {
    background: transparent; border: none; cursor: pointer;
    padding: 18px 24px 16px; margin-bottom: -1px;
    border-bottom: 2px solid transparent;
    display: flex; align-items: baseline; gap: 12px;
    color: var(--paper-mute); transition: all 0.18s;
    font: inherit;
  }
  .top-tab:first-child { padding-left: 0; }
  .top-tab:hover { color: var(--paper); }
  .top-tab.top-tab-active { color: var(--paper); border-bottom-color: var(--champagne); }
  .tt-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .dot-hg { background: var(--champagne); }
  .dot-qc { background: var(--slate); }
  .dot-ta { background: var(--sage); }
  .tt-name {
    font-family: 'Source Serif 4', serif; font-size: 24px; font-weight: 400;
    letter-spacing: -0.01em;
  }
  .tt-meta {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px; font-weight: 400; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--paper-faint);
  }
  .top-tab.top-tab-active .tt-meta { color: var(--champagne); }

  .mode-content-wrap { /* container per mode */ }
  .mode-desc {
    color: var(--paper-mute); font-size: 13.5px;
    margin-bottom: 18px; font-weight: 300; max-width: 720px; line-height: 1.65;
  }
  .mode-disabled {
    border-top: 1px solid var(--hairline); padding: 32px;
    text-align: center; color: var(--paper-faint); font-size: 13px; font-style: italic;
  }

  /* Filter */
  .filters {
    padding: 14px 0; margin-bottom: 16px;
    border-top: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline);
    display: grid; gap: 10px;
  }
  .f-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .f-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px; font-weight: 400; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--paper-faint);
    margin-right: 12px; min-width: 88px;
  }
  .ps-btn {
    background: transparent; border: none; padding: 5px 12px;
    font: inherit; font-size: 12px; font-weight: 400;
    cursor: pointer; color: var(--paper-mute);
    transition: all 0.18s; border-bottom: 1px solid transparent;
  }
  .ps-btn:hover { color: var(--paper); }
  .ps-btn.ps-active { color: var(--champagne); border-bottom-color: var(--champagne); font-weight: 500; }
  .ps-btn.ps-loss.ps-active { color: var(--loss); border-bottom-color: var(--loss); }
  .ps-btn.ps-turnaround.ps-active { color: var(--turnaround); border-bottom-color: var(--turnaround); }
  .ps-btn.ps-recent.ps-active { color: var(--recent); border-bottom-color: var(--recent); }
  .ps-btn.ps-stable.ps-active { color: var(--stable); border-bottom-color: var(--stable); }

  .range-input { -webkit-appearance: none; appearance: none; background: transparent; width: 140px; height: 14px; }
  .range-input::-webkit-slider-runnable-track { background: var(--hairline); height: 1px; }
  .range-input::-moz-range-track { background: var(--hairline); height: 1px; }
  .range-input::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 9px; height: 9px; border-radius: 50%;
    background: var(--champagne); border: none;
    margin-top: -4px; cursor: pointer; transition: all 0.15s;
  }
  .range-input::-webkit-slider-thumb:hover { background: var(--gold); transform: scale(1.3); }
  .range-input::-moz-range-thumb {
    width: 9px; height: 9px; border-radius: 50%;
    background: var(--champagne); border: none; cursor: pointer;
  }
  .slider-val {
    font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--paper);
    font-weight: 400; min-width: 50px; display: inline-block;
    font-variant-numeric: tabular-nums;
  }
  .slider-sep { color: var(--paper-faint); font-size: 11px; }
  .sec-select {
    background: var(--bg-2); border: 1px solid var(--hairline);
    color: var(--paper); padding: 4px 8px;
    font: inherit; font-size: 12px; cursor: pointer;
  }
  .reset-btn {
    background: transparent; border: 1px solid var(--hairline);
    padding: 4px 12px;
    font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: var(--paper-mute);
    cursor: pointer; margin-left: auto;
    text-transform: uppercase; letter-spacing: 0.14em;
    transition: all 0.18s;
  }
  .reset-btn:hover { border-color: var(--champagne); color: var(--champagne); }

  /* SUB-TABS */
  .sub-tabs {
    display: flex; gap: 0; flex-wrap: wrap;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--line);
  }
  .sub-tab {
    background: transparent; border: none;
    padding: 10px 16px; border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    font: inherit; font-size: 12.5px; font-weight: 400;
    color: var(--paper-mute); cursor: pointer; transition: all 0.18s;
  }
  .sub-tab:first-child { padding-left: 0; }
  .sub-tab:hover { color: var(--paper); }
  .sub-tab.sub-tab-active { color: var(--paper); border-bottom-color: var(--champagne); font-weight: 500; }

  /* TABLE-LIST */
  .table-head {
    display: grid; grid-template-columns: 36px 70px 1fr 130px 110px 36px 80px 72px 60px;
    gap: 10px; align-items: center;
    padding: 10px 12px 10px 4px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px; font-weight: 400; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--paper-faint);
    border-bottom: 1px solid var(--line);
  }
  .row-list { display: flex; flex-direction: column; }
  .row { cursor: pointer; }
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: none; z-index: 9000; backdrop-filter: blur(4px); }
  .modal-backdrop.show { display: block; }
  .modal-panel { position: fixed; top: 0; right: 0; width: min(560px, 92vw); height: 100vh; background: #1a1612; box-shadow: -8px 0 32px rgba(0,0,0,0.5); z-index: 9001; transform: translateX(100%); transition: transform 0.25s ease-out; overflow-y: auto; }
  .modal-panel.show { transform: translateX(0); }
  .modal-close { position: absolute; top: 16px; right: 16px; background: transparent; border: 1px solid var(--hairline); color: var(--paper-mute); padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .modal-close:hover { color: var(--paper); border-color: var(--champagne); }
  .modal-body { padding: 32px 28px 24px; font-family: ui-sans-serif, system-ui; }
  .modal-tk { font-size: 28px; font-weight: 700; color: var(--paper); letter-spacing: -0.01em; }
  .modal-name { font-size: 14px; color: var(--paper-faint); margin-top: 4px; }
  .modal-meta { font-size: 11px; color: var(--paper-mute); margin-top: 8px; text-transform: uppercase; letter-spacing: 0.04em; }
  .modal-badges { display: flex; gap: 8px; margin: 16px 0 24px; flex-wrap: wrap; }
  .modal-badge { padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; border: 1px solid; }
  .modal-section { margin-top: 24px; }
  .modal-section-title { text-transform: uppercase; font-size: 10px; letter-spacing: 0.08em; color: var(--paper-mute); margin-bottom: 8px; }
  .modal-chart-row { display: grid; grid-template-columns: 110px 1fr 90px; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--hairline); font-size: 12px; }
  .modal-chart-row:last-child { border-bottom: none; }
  .modal-chart-label { color: var(--paper-faint); }
  .modal-chart-value { text-align: right; font-family: 'JetBrains Mono', monospace; color: var(--paper); font-weight: 600; }
  .modal-chart-svg { height: 32px; }
  .modal-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; }
  .modal-stat { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--hairline); font-size: 12px; }
  .modal-stat-label { color: var(--paper-faint); }
  .modal-stat-value { color: var(--paper); font-family: 'JetBrains Mono', monospace; font-weight: 600; }
  .modal-action { display: flex; gap: 8px; margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--hairline); }
  .modal-action-btn { flex: 1; padding: 12px 16px; background: var(--champagne); color: #1a1612; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s; font-family: inherit; }
  .modal-action-btn:hover { background: var(--gold); }
  .modal-action-btn.secondary { background: transparent; color: var(--paper-faint); border: 1px solid var(--hairline); }
  .modal-action-btn.secondary:hover { color: var(--paper); border-color: var(--champagne); }
  .modal-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #1a3a24; color: #6ee7b7; padding: 10px 18px; border-radius: 6px; border: 1px solid #10b98140; z-index: 10000; font-size: 13px; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
  .modal-toast.show { opacity: 1; }
  .row {
    display: grid; grid-template-columns: 36px 70px 1fr 130px 110px 36px 80px 72px 60px;
    gap: 10px; align-items: center;
    padding: 9px 12px 9px 4px;
    border-bottom: 1px solid var(--line-soft);
    transition: background 0.15s, color 0.15s;
    cursor: pointer; text-decoration: none; color: inherit;
  }
  .row:hover { background: rgba(212,184,120,0.04); }
  .row:last-child { border-bottom: none; }

  .r-rank {
    font-family: 'JetBrains Mono', monospace; font-size: 10px;
    color: var(--paper-faint); font-variant-numeric: tabular-nums;
  }
  .r-tk {
    font-family: 'Source Serif 4', serif; font-size: 14px;
    color: var(--paper); font-weight: 500; letter-spacing: 0;
  }
  .r-name { color: var(--paper-mute); font-size: 12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .r-sec { color: var(--paper-faint); font-size: 11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .r-state {
    font-size: 10.5px; padding: 3px 8px;
    color: var(--paper-faint); display:flex; align-items:center; gap:4px;
    font-family: 'JetBrains Mono', monospace; letter-spacing: 0.04em;
  }
  .r-conf { color: var(--paper-dim); font-size: 9px; }
  .pst-loss { background: var(--loss-soft); color: var(--loss); }
  .pst-turnaround { background: var(--turnaround-soft); color: var(--turnaround); }
  .pst-recent { background: var(--recent-soft); color: var(--recent); }
  .pst-stable { background: var(--stable-soft); color: var(--stable); }
  .pst-na { background: var(--bg-3); color: var(--paper-faint); }

  .r-ipo {
    font-family: 'JetBrains Mono', monospace; font-size: 10px;
    color: var(--paper-faint); font-variant-numeric: tabular-nums;
  }
  .r-spark { color: var(--champagne); display: flex; align-items: center; }
  .r-spark .spark { display: block; }
  .r-val {
    font-family: 'Source Serif 4', serif; font-size: 16px;
    color: var(--champagne); font-weight: 400; font-feature-settings: 'tnum';
    text-align: right; letter-spacing: -0.005em;
  }
  .r-mcap {
    font-family: 'JetBrains Mono', monospace; font-size: 10.5px;
    color: var(--paper-mute); text-align: right; font-variant-numeric: tabular-nums;
  }

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

  @media (max-width: 1100px) {
    .table-head, .row { grid-template-columns: 30px 60px 1fr 90px 100px 30px 60px 60px 50px; gap: 6px; font-size: 11px; }
    .r-tk { font-size: 13px; }
    .r-val { font-size: 14px; }
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
  function fmtMcap(b) {
    if (b >= 1000) return '$' + (b/1000).toFixed(1) + 'T';
    if (b >= 1) return '$' + Math.round(b) + 'B';
    return '$' + Math.round(b*1000) + 'M';
  }

  function applyFilters(mode) {
    const root = document.querySelector('.filters[data-mode="' + mode + '"]');
    if (!root) return;
    const ipoDefault = parseFloat(root.dataset.ipoDefault || '1980');
    const activePs = root.querySelector('.ps-btn.ps-active');
    const pstate = activePs ? activePs.dataset.pstate : 'ALL';
    const mcapMin = parseFloat(root.querySelector('[data-slider="mcap-min"].range-input').value) * 1e9;
    const mcapMax = parseFloat(root.querySelector('[data-slider="mcap-max"].range-input').value) * 1e9;
    const ipoMin = parseFloat(root.querySelector('[data-slider="ipo-min"].range-input').value);
    const ipoActive = ipoMin > ipoDefault;
    const sector = root.querySelector('.sec-select').value;
    // Tag 113b: FCF-Margin und Growth Slider
    const fcfMinEl = root.querySelector('[data-slider="fcf-min"].range-input');
    const growthMinEl = root.querySelector('[data-slider="growth-min"].range-input');
    const fcfMin = fcfMinEl ? parseFloat(fcfMinEl.value) : -999;
    const growthMin = growthMinEl ? parseFloat(growthMinEl.value) : 0;

    document.querySelectorAll('.sub-panel[data-mode="' + mode + '"] .row').forEach(card => {
      const ps = card.dataset.profState;
      const mcap = parseFloat(card.dataset.mcap) || 0;
      const ipo = parseFloat(card.dataset.ipo) || 0;
      const sec = card.dataset.sector || '';
      const fcfM = parseFloat(card.dataset.fcfMargin);
      const revG = parseFloat(card.dataset.revGrowth);
      const psOk = pstate === 'ALL' || ps === pstate;
      const mcapOk = mcap >= mcapMin && mcap <= mcapMax;
      const ipoOk = !ipoActive ? true : (ipo > 0 && ipo >= ipoMin);
      const secOk = sector === 'ALL' || sec === sector;
      // Wenn fcfM nicht verfuegbar (-999) und Slider gesetzt: ausblenden
      const fcfOk = (fcfMin <= -30) ? true : (Number.isFinite(fcfM) && fcfM > -100 && fcfM >= fcfMin);
      const growthOk = (growthMin <= 0) ? true : (Number.isFinite(revG) && revG > -100 && revG >= growthMin);
      card.style.display = (psOk && mcapOk && ipoOk && secOk && fcfOk && growthOk) ? '' : 'none';
    });
  }

  function syncSliderLabel(input) {
    const mode = input.dataset.mode;
    const which = input.dataset.slider;
    const labelEl = document.querySelector('.slider-val[data-mode="' + mode + '"][data-slider="' + which + '"]');
    if (!labelEl) return;
    const v = parseFloat(input.value);
    if (which === 'mcap-min' || which === 'mcap-max') labelEl.textContent = fmtMcap(v);
    else if (which === 'fcf-min' || which === 'growth-min') labelEl.textContent = (v >= 0 ? '+' : '') + Math.round(v) + '%';
    else labelEl.textContent = String(Math.round(v));
  }

  // Tag 114: Modal-Render-Logik
  const PSTATE_LABEL_MODAL = { LOSS:'Loss', TURNAROUND:'Turnaround', RECENT:'Recent', STABLE:'Stable', NA:'Unbekannt' };
  const HG_CLASS_LABEL = { REAL_HYPERGROWTH_ACCELERATING:'Real HG · Accelerating', REAL_HYPERGROWTH_BUT_LOSSY:'Real HG · Lossy', HYPERGROWTH_REVIEW:'HG Review', LOW_BASE_EFFECT:'Low-Base', NOT_HYPERGROWTH:'Not HG', Q_SPIKE_FAKE:'Q-Spike-Fake' };
  const HG_CLASS_COLOR = { REAL_HYPERGROWTH_ACCELERATING:'#6ee7b7', REAL_HYPERGROWTH_BUT_LOSSY:'#bef264', HYPERGROWTH_REVIEW:'#fcd34d', LOW_BASE_EFFECT:'#a5b4fc', NOT_HYPERGROWTH:'#94a3b8', Q_SPIKE_FAKE:'#fca5a5' };
  function fmtM(v) { if (!Number.isFinite(v)) return '\u2014'; if (Math.abs(v) >= 1e9) return (v/1e9).toFixed(1)+'B'; if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(0)+'M'; return v.toFixed(0); }
  function fmtPct(v) { return Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '\u2014'; }
  function fmtMoneyM(v) { if (!Number.isFinite(v)) return '\u2014'; if (v >= 1e12) return '
    syncSliderLabel(input);
    input.addEventListener('input', () => {
      if (input.dataset.slider === 'mcap-min') {
        const max = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-max"]');
        if (max && parseFloat(input.value) > parseFloat(max.value)) input.value = max.value;
      } else if (input.dataset.slider === 'mcap-max') {
        const min = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-min"]');
        if (min && parseFloat(input.value) < parseFloat(min.value)) input.value = min.value;
      }
      syncSliderLabel(input);
      applyFilters(input.dataset.mode);
    });
  });

  document.querySelectorAll('.sec-select').forEach(sel => {
    sel.addEventListener('change', () => applyFilters(sel.dataset.mode));
  });

  document.addEventListener('click', function(e) {
    const t = e.target;

    // TOP-TABS (Modus-Switch)
    const topTab = t.closest && t.closest('.top-tab');
    if (topTab) {
      const mode = topTab.dataset.mode;
      document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('top-tab-active'));
      topTab.classList.add('top-tab-active');
      document.querySelectorAll('.mode-content-wrap').forEach(w => {
        w.style.display = w.dataset.mode === mode ? '' : 'none';
      });
      return;
    }

    if (t.classList && t.classList.contains('ps-btn')) {
      const mode = t.dataset.mode;
      document.querySelectorAll('.ps-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('ps-active'));
      t.classList.add('ps-active');
      applyFilters(mode);
      return;
    }
    if (t.classList && t.classList.contains('sub-tab')) {
      const mode = t.dataset.mode;
      const tab = t.dataset.tab;
      document.querySelectorAll('.sub-tab[data-mode="' + mode + '"]').forEach(b => b.classList.remove('sub-tab-active'));
      t.classList.add('sub-tab-active');
      document.querySelectorAll('.sub-panel[data-mode="' + mode + '"]').forEach(p => {
        p.style.display = p.dataset.tab === tab ? '' : 'none';
      });
      applyFilters(mode);
      return;
    }
    // Tag 114: Stock-Modal-Click
    const row = t.closest && t.closest('.row');
    if (row && row.dataset.stock) {
      e.preventDefault();
      try { openStockModal(JSON.parse(row.dataset.stock), row.dataset.afUrl); } catch (err) { console.error(err); }
      return;
    }
    if (t.classList && t.classList.contains('reset-btn')) {
      const mode = t.dataset.mode;
      const root = document.querySelector('.filters[data-mode="' + mode + '"]');
      root.querySelectorAll('.ps-btn').forEach(b => b.classList.remove('ps-active'));
      root.querySelector('.ps-btn[data-pstate="ALL"]').classList.add('ps-active');
      root.querySelectorAll('.range-input').forEach(input => {
        if (input.dataset.slider === 'mcap-min') input.value = input.min;
        else if (input.dataset.slider === 'mcap-max') input.value = input.max;
        else if (input.dataset.slider === 'ipo-min') input.value = input.min;
        else if (input.dataset.slider === 'fcf-min') input.value = input.min;
        else if (input.dataset.slider === 'growth-min') input.value = input.min;
        syncSliderLabel(input);
      });
      root.querySelector('.sec-select').value = 'ALL';
      applyFilters(mode);
    }
  });
})();
</script>

<div class="modal-backdrop" id="stockModalBackdrop"></div>
<aside class="modal-panel" id="stockModalPanel" role="dialog" aria-hidden="true">
  <button class="modal-close" id="stockModalClose">Schliessen ✕</button>
  <div class="modal-body" id="stockModalBody"></div>
</aside>
<div class="modal-toast" id="modalToast">Ticker kopiert</div>
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

  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    const eligible = eligibleForMode(evaluated, modeId);
    const allMust = topAllMust(eligible, modeId, args.topN);
    console.log(`  ${modeId}: ${eligible.length} eligible, ${allMust.length} all-MUST-pass`);
  }
}

if (require.main === module) main();
module.exports = { eligibleForMode, topByMethod, topAllMust, evaluateAll, dedupeByCompany };
+(v/1e12).toFixed(1)+'T'; if (v >= 1e9) return '
    syncSliderLabel(input);
    input.addEventListener('input', () => {
      if (input.dataset.slider === 'mcap-min') {
        const max = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-max"]');
        if (max && parseFloat(input.value) > parseFloat(max.value)) input.value = max.value;
      } else if (input.dataset.slider === 'mcap-max') {
        const min = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-min"]');
        if (min && parseFloat(input.value) < parseFloat(min.value)) input.value = min.value;
      }
      syncSliderLabel(input);
      applyFilters(input.dataset.mode);
    });
  });

  document.querySelectorAll('.sec-select').forEach(sel => {
    sel.addEventListener('change', () => applyFilters(sel.dataset.mode));
  });

  document.addEventListener('click', function(e) {
    const t = e.target;

    // TOP-TABS (Modus-Switch)
    const topTab = t.closest && t.closest('.top-tab');
    if (topTab) {
      const mode = topTab.dataset.mode;
      document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('top-tab-active'));
      topTab.classList.add('top-tab-active');
      document.querySelectorAll('.mode-content-wrap').forEach(w => {
        w.style.display = w.dataset.mode === mode ? '' : 'none';
      });
      return;
    }

    if (t.classList && t.classList.contains('ps-btn')) {
      const mode = t.dataset.mode;
      document.querySelectorAll('.ps-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('ps-active'));
      t.classList.add('ps-active');
      applyFilters(mode);
      return;
    }
    if (t.classList && t.classList.contains('sub-tab')) {
      const mode = t.dataset.mode;
      const tab = t.dataset.tab;
      document.querySelectorAll('.sub-tab[data-mode="' + mode + '"]').forEach(b => b.classList.remove('sub-tab-active'));
      t.classList.add('sub-tab-active');
      document.querySelectorAll('.sub-panel[data-mode="' + mode + '"]').forEach(p => {
        p.style.display = p.dataset.tab === tab ? '' : 'none';
      });
      applyFilters(mode);
      return;
    }
    // Tag 114: Stock-Modal-Click
    const row = t.closest && t.closest('.row');
    if (row && row.dataset.stock) {
      e.preventDefault();
      try { openStockModal(JSON.parse(row.dataset.stock), row.dataset.afUrl); } catch (err) { console.error(err); }
      return;
    }
    if (t.classList && t.classList.contains('reset-btn')) {
      const mode = t.dataset.mode;
      const root = document.querySelector('.filters[data-mode="' + mode + '"]');
      root.querySelectorAll('.ps-btn').forEach(b => b.classList.remove('ps-active'));
      root.querySelector('.ps-btn[data-pstate="ALL"]').classList.add('ps-active');
      root.querySelectorAll('.range-input').forEach(input => {
        if (input.dataset.slider === 'mcap-min') input.value = input.min;
        else if (input.dataset.slider === 'mcap-max') input.value = input.max;
        else if (input.dataset.slider === 'ipo-min') input.value = input.min;
        else if (input.dataset.slider === 'fcf-min') input.value = input.min;
        else if (input.dataset.slider === 'growth-min') input.value = input.min;
        syncSliderLabel(input);
      });
      root.querySelector('.sec-select').value = 'ALL';
      applyFilters(mode);
    }
  });
})();
</script>

<div class="modal-backdrop" id="stockModalBackdrop"></div>
<aside class="modal-panel" id="stockModalPanel" role="dialog" aria-hidden="true">
  <button class="modal-close" id="stockModalClose">Schliessen ✕</button>
  <div class="modal-body" id="stockModalBody"></div>
</aside>
<div class="modal-toast" id="modalToast">Ticker kopiert</div>
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

  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    const eligible = eligibleForMode(evaluated, modeId);
    const allMust = topAllMust(eligible, modeId, args.topN);
    console.log(`  ${modeId}: ${eligible.length} eligible, ${allMust.length} all-MUST-pass`);
  }
}

if (require.main === module) main();
module.exports = { eligibleForMode, topByMethod, topAllMust, evaluateAll, dedupeByCompany };
+(v/1e9).toFixed(1)+'B'; if (v >= 1e6) return '
    syncSliderLabel(input);
    input.addEventListener('input', () => {
      if (input.dataset.slider === 'mcap-min') {
        const max = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-max"]');
        if (max && parseFloat(input.value) > parseFloat(max.value)) input.value = max.value;
      } else if (input.dataset.slider === 'mcap-max') {
        const min = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-min"]');
        if (min && parseFloat(input.value) < parseFloat(min.value)) input.value = min.value;
      }
      syncSliderLabel(input);
      applyFilters(input.dataset.mode);
    });
  });

  document.querySelectorAll('.sec-select').forEach(sel => {
    sel.addEventListener('change', () => applyFilters(sel.dataset.mode));
  });

  document.addEventListener('click', function(e) {
    const t = e.target;

    // TOP-TABS (Modus-Switch)
    const topTab = t.closest && t.closest('.top-tab');
    if (topTab) {
      const mode = topTab.dataset.mode;
      document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('top-tab-active'));
      topTab.classList.add('top-tab-active');
      document.querySelectorAll('.mode-content-wrap').forEach(w => {
        w.style.display = w.dataset.mode === mode ? '' : 'none';
      });
      return;
    }

    if (t.classList && t.classList.contains('ps-btn')) {
      const mode = t.dataset.mode;
      document.querySelectorAll('.ps-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('ps-active'));
      t.classList.add('ps-active');
      applyFilters(mode);
      return;
    }
    if (t.classList && t.classList.contains('sub-tab')) {
      const mode = t.dataset.mode;
      const tab = t.dataset.tab;
      document.querySelectorAll('.sub-tab[data-mode="' + mode + '"]').forEach(b => b.classList.remove('sub-tab-active'));
      t.classList.add('sub-tab-active');
      document.querySelectorAll('.sub-panel[data-mode="' + mode + '"]').forEach(p => {
        p.style.display = p.dataset.tab === tab ? '' : 'none';
      });
      applyFilters(mode);
      return;
    }
    // Tag 114: Stock-Modal-Click
    const row = t.closest && t.closest('.row');
    if (row && row.dataset.stock) {
      e.preventDefault();
      try { openStockModal(JSON.parse(row.dataset.stock), row.dataset.afUrl); } catch (err) { console.error(err); }
      return;
    }
    if (t.classList && t.classList.contains('reset-btn')) {
      const mode = t.dataset.mode;
      const root = document.querySelector('.filters[data-mode="' + mode + '"]');
      root.querySelectorAll('.ps-btn').forEach(b => b.classList.remove('ps-active'));
      root.querySelector('.ps-btn[data-pstate="ALL"]').classList.add('ps-active');
      root.querySelectorAll('.range-input').forEach(input => {
        if (input.dataset.slider === 'mcap-min') input.value = input.min;
        else if (input.dataset.slider === 'mcap-max') input.value = input.max;
        else if (input.dataset.slider === 'ipo-min') input.value = input.min;
        else if (input.dataset.slider === 'fcf-min') input.value = input.min;
        else if (input.dataset.slider === 'growth-min') input.value = input.min;
        syncSliderLabel(input);
      });
      root.querySelector('.sec-select').value = 'ALL';
      applyFilters(mode);
    }
  });
})();
</script>

<div class="modal-backdrop" id="stockModalBackdrop"></div>
<aside class="modal-panel" id="stockModalPanel" role="dialog" aria-hidden="true">
  <button class="modal-close" id="stockModalClose">Schliessen ✕</button>
  <div class="modal-body" id="stockModalBody"></div>
</aside>
<div class="modal-toast" id="modalToast">Ticker kopiert</div>
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

  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    const eligible = eligibleForMode(evaluated, modeId);
    const allMust = topAllMust(eligible, modeId, args.topN);
    console.log(`  ${modeId}: ${eligible.length} eligible, ${allMust.length} all-MUST-pass`);
  }
}

if (require.main === module) main();
module.exports = { eligibleForMode, topByMethod, topAllMust, evaluateAll, dedupeByCompany };
+(v/1e6).toFixed(0)+'M'; return '
    syncSliderLabel(input);
    input.addEventListener('input', () => {
      if (input.dataset.slider === 'mcap-min') {
        const max = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-max"]');
        if (max && parseFloat(input.value) > parseFloat(max.value)) input.value = max.value;
      } else if (input.dataset.slider === 'mcap-max') {
        const min = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-min"]');
        if (min && parseFloat(input.value) < parseFloat(min.value)) input.value = min.value;
      }
      syncSliderLabel(input);
      applyFilters(input.dataset.mode);
    });
  });

  document.querySelectorAll('.sec-select').forEach(sel => {
    sel.addEventListener('change', () => applyFilters(sel.dataset.mode));
  });

  document.addEventListener('click', function(e) {
    const t = e.target;

    // TOP-TABS (Modus-Switch)
    const topTab = t.closest && t.closest('.top-tab');
    if (topTab) {
      const mode = topTab.dataset.mode;
      document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('top-tab-active'));
      topTab.classList.add('top-tab-active');
      document.querySelectorAll('.mode-content-wrap').forEach(w => {
        w.style.display = w.dataset.mode === mode ? '' : 'none';
      });
      return;
    }

    if (t.classList && t.classList.contains('ps-btn')) {
      const mode = t.dataset.mode;
      document.querySelectorAll('.ps-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('ps-active'));
      t.classList.add('ps-active');
      applyFilters(mode);
      return;
    }
    if (t.classList && t.classList.contains('sub-tab')) {
      const mode = t.dataset.mode;
      const tab = t.dataset.tab;
      document.querySelectorAll('.sub-tab[data-mode="' + mode + '"]').forEach(b => b.classList.remove('sub-tab-active'));
      t.classList.add('sub-tab-active');
      document.querySelectorAll('.sub-panel[data-mode="' + mode + '"]').forEach(p => {
        p.style.display = p.dataset.tab === tab ? '' : 'none';
      });
      applyFilters(mode);
      return;
    }
    // Tag 114: Stock-Modal-Click
    const row = t.closest && t.closest('.row');
    if (row && row.dataset.stock) {
      e.preventDefault();
      try { openStockModal(JSON.parse(row.dataset.stock), row.dataset.afUrl); } catch (err) { console.error(err); }
      return;
    }
    if (t.classList && t.classList.contains('reset-btn')) {
      const mode = t.dataset.mode;
      const root = document.querySelector('.filters[data-mode="' + mode + '"]');
      root.querySelectorAll('.ps-btn').forEach(b => b.classList.remove('ps-active'));
      root.querySelector('.ps-btn[data-pstate="ALL"]').classList.add('ps-active');
      root.querySelectorAll('.range-input').forEach(input => {
        if (input.dataset.slider === 'mcap-min') input.value = input.min;
        else if (input.dataset.slider === 'mcap-max') input.value = input.max;
        else if (input.dataset.slider === 'ipo-min') input.value = input.min;
        else if (input.dataset.slider === 'fcf-min') input.value = input.min;
        else if (input.dataset.slider === 'growth-min') input.value = input.min;
        syncSliderLabel(input);
      });
      root.querySelector('.sec-select').value = 'ALL';
      applyFilters(mode);
    }
  });
})();
</script>

<div class="modal-backdrop" id="stockModalBackdrop"></div>
<aside class="modal-panel" id="stockModalPanel" role="dialog" aria-hidden="true">
  <button class="modal-close" id="stockModalClose">Schliessen ✕</button>
  <div class="modal-body" id="stockModalBody"></div>
</aside>
<div class="modal-toast" id="modalToast">Ticker kopiert</div>
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

  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    const eligible = eligibleForMode(evaluated, modeId);
    const allMust = topAllMust(eligible, modeId, args.topN);
    console.log(`  ${modeId}: ${eligible.length} eligible, ${allMust.length} all-MUST-pass`);
  }
}

if (require.main === module) main();
module.exports = { eligibleForMode, topByMethod, topAllMust, evaluateAll, dedupeByCompany };
+v.toFixed(0); }
  function spark(values, height) {
    if (!values || values.length < 2) return '';
    const arr = values.slice().reverse();
    const minV = Math.min(...arr), maxV = Math.max(...arr); const range = maxV - minV || 1;
    const w = 280, h = height || 32;
    const pts = arr.map((v, i) => { const x = (i/(arr.length-1))*w; const y = h - ((v-minV)/range)*h; return x.toFixed(1)+','+y.toFixed(1); }).join(' ');
    const color = arr[arr.length-1] >= arr[0] ? '#10b981' : '#ef4444';
    return '<svg class="modal-chart-svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'"><polyline points="'+pts+'" fill="none" stroke="'+color+'" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }
  function gmRow(s) { if (!s.annualGP || !s.annualRev || s.annualGP.length < 2 || s.annualRev.length < 2) return null; const margins = s.annualGP.map((gp, i) => s.annualRev[i] > 0 ? (gp/s.annualRev[i])*100 : null).filter(v => Number.isFinite(v)); if (margins.length < 2) return null; return margins; }
  function omRow(s) { if (!s.annualOpInc || !s.annualRev || s.annualOpInc.length < 2 || s.annualRev.length < 2) return null; const margins = s.annualOpInc.map((oi, i) => s.annualRev[i] > 0 ? (oi/s.annualRev[i])*100 : null).filter(v => Number.isFinite(v)); if (margins.length < 2) return null; return margins; }
  
  function openStockModal(s, afUrl) {
    const body = document.getElementById('stockModalBody');
    const psBadgeColor = { LOSS:'#fca5a5', TURNAROUND:'#fcd34d', RECENT:'#bef264', STABLE:'#6ee7b7', NA:'#94a3b8' };
    const psColor = psBadgeColor[s.profState] || '#94a3b8';
    const psLabel = PSTATE_LABEL_MODAL[s.profState] || s.profState;
    let badgesHtml = '<span class="modal-badge" style="color:'+psColor+';border-color:'+psColor+'40;background:'+psColor+'15;">Profit · '+psLabel+'</span>';
    if (s.hgClass) {
      const hgC = HG_CLASS_COLOR[s.hgClass] || '#94a3b8';
      const hgL = HG_CLASS_LABEL[s.hgClass] || s.hgClass;
      badgesHtml += '<span class="modal-badge" style="color:'+hgC+';border-color:'+hgC+'40;background:'+hgC+'15;">HG-Class · '+hgL+'</span>';
    }
    
    const revLatest = s.annualRev && s.annualRev[0];
    const revOldest = s.annualRev && s.annualRev[s.annualRev.length-1];
    const revGrowthAbs = (revLatest && revOldest) ? '
    syncSliderLabel(input);
    input.addEventListener('input', () => {
      if (input.dataset.slider === 'mcap-min') {
        const max = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-max"]');
        if (max && parseFloat(input.value) > parseFloat(max.value)) input.value = max.value;
      } else if (input.dataset.slider === 'mcap-max') {
        const min = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-min"]');
        if (min && parseFloat(input.value) < parseFloat(min.value)) input.value = min.value;
      }
      syncSliderLabel(input);
      applyFilters(input.dataset.mode);
    });
  });

  document.querySelectorAll('.sec-select').forEach(sel => {
    sel.addEventListener('change', () => applyFilters(sel.dataset.mode));
  });

  document.addEventListener('click', function(e) {
    const t = e.target;

    // TOP-TABS (Modus-Switch)
    const topTab = t.closest && t.closest('.top-tab');
    if (topTab) {
      const mode = topTab.dataset.mode;
      document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('top-tab-active'));
      topTab.classList.add('top-tab-active');
      document.querySelectorAll('.mode-content-wrap').forEach(w => {
        w.style.display = w.dataset.mode === mode ? '' : 'none';
      });
      return;
    }

    if (t.classList && t.classList.contains('ps-btn')) {
      const mode = t.dataset.mode;
      document.querySelectorAll('.ps-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('ps-active'));
      t.classList.add('ps-active');
      applyFilters(mode);
      return;
    }
    if (t.classList && t.classList.contains('sub-tab')) {
      const mode = t.dataset.mode;
      const tab = t.dataset.tab;
      document.querySelectorAll('.sub-tab[data-mode="' + mode + '"]').forEach(b => b.classList.remove('sub-tab-active'));
      t.classList.add('sub-tab-active');
      document.querySelectorAll('.sub-panel[data-mode="' + mode + '"]').forEach(p => {
        p.style.display = p.dataset.tab === tab ? '' : 'none';
      });
      applyFilters(mode);
      return;
    }
    // Tag 114: Stock-Modal-Click
    const row = t.closest && t.closest('.row');
    if (row && row.dataset.stock) {
      e.preventDefault();
      try { openStockModal(JSON.parse(row.dataset.stock), row.dataset.afUrl); } catch (err) { console.error(err); }
      return;
    }
    if (t.classList && t.classList.contains('reset-btn')) {
      const mode = t.dataset.mode;
      const root = document.querySelector('.filters[data-mode="' + mode + '"]');
      root.querySelectorAll('.ps-btn').forEach(b => b.classList.remove('ps-active'));
      root.querySelector('.ps-btn[data-pstate="ALL"]').classList.add('ps-active');
      root.querySelectorAll('.range-input').forEach(input => {
        if (input.dataset.slider === 'mcap-min') input.value = input.min;
        else if (input.dataset.slider === 'mcap-max') input.value = input.max;
        else if (input.dataset.slider === 'ipo-min') input.value = input.min;
        else if (input.dataset.slider === 'fcf-min') input.value = input.min;
        else if (input.dataset.slider === 'growth-min') input.value = input.min;
        syncSliderLabel(input);
      });
      root.querySelector('.sec-select').value = 'ALL';
      applyFilters(mode);
    }
  });
})();
</script>

<div class="modal-backdrop" id="stockModalBackdrop"></div>
<aside class="modal-panel" id="stockModalPanel" role="dialog" aria-hidden="true">
  <button class="modal-close" id="stockModalClose">Schliessen ✕</button>
  <div class="modal-body" id="stockModalBody"></div>
</aside>
<div class="modal-toast" id="modalToast">Ticker kopiert</div>
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

  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    const eligible = eligibleForMode(evaluated, modeId);
    const allMust = topAllMust(eligible, modeId, args.topN);
    console.log(`  ${modeId}: ${eligible.length} eligible, ${allMust.length} all-MUST-pass`);
  }
}

if (require.main === module) main();
module.exports = { eligibleForMode, topByMethod, topAllMust, evaluateAll, dedupeByCompany };
+fmtM(revOldest)+' \u2192 
    syncSliderLabel(input);
    input.addEventListener('input', () => {
      if (input.dataset.slider === 'mcap-min') {
        const max = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-max"]');
        if (max && parseFloat(input.value) > parseFloat(max.value)) input.value = max.value;
      } else if (input.dataset.slider === 'mcap-max') {
        const min = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-min"]');
        if (min && parseFloat(input.value) < parseFloat(min.value)) input.value = min.value;
      }
      syncSliderLabel(input);
      applyFilters(input.dataset.mode);
    });
  });

  document.querySelectorAll('.sec-select').forEach(sel => {
    sel.addEventListener('change', () => applyFilters(sel.dataset.mode));
  });

  document.addEventListener('click', function(e) {
    const t = e.target;

    // TOP-TABS (Modus-Switch)
    const topTab = t.closest && t.closest('.top-tab');
    if (topTab) {
      const mode = topTab.dataset.mode;
      document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('top-tab-active'));
      topTab.classList.add('top-tab-active');
      document.querySelectorAll('.mode-content-wrap').forEach(w => {
        w.style.display = w.dataset.mode === mode ? '' : 'none';
      });
      return;
    }

    if (t.classList && t.classList.contains('ps-btn')) {
      const mode = t.dataset.mode;
      document.querySelectorAll('.ps-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('ps-active'));
      t.classList.add('ps-active');
      applyFilters(mode);
      return;
    }
    if (t.classList && t.classList.contains('sub-tab')) {
      const mode = t.dataset.mode;
      const tab = t.dataset.tab;
      document.querySelectorAll('.sub-tab[data-mode="' + mode + '"]').forEach(b => b.classList.remove('sub-tab-active'));
      t.classList.add('sub-tab-active');
      document.querySelectorAll('.sub-panel[data-mode="' + mode + '"]').forEach(p => {
        p.style.display = p.dataset.tab === tab ? '' : 'none';
      });
      applyFilters(mode);
      return;
    }
    // Tag 114: Stock-Modal-Click
    const row = t.closest && t.closest('.row');
    if (row && row.dataset.stock) {
      e.preventDefault();
      try { openStockModal(JSON.parse(row.dataset.stock), row.dataset.afUrl); } catch (err) { console.error(err); }
      return;
    }
    if (t.classList && t.classList.contains('reset-btn')) {
      const mode = t.dataset.mode;
      const root = document.querySelector('.filters[data-mode="' + mode + '"]');
      root.querySelectorAll('.ps-btn').forEach(b => b.classList.remove('ps-active'));
      root.querySelector('.ps-btn[data-pstate="ALL"]').classList.add('ps-active');
      root.querySelectorAll('.range-input').forEach(input => {
        if (input.dataset.slider === 'mcap-min') input.value = input.min;
        else if (input.dataset.slider === 'mcap-max') input.value = input.max;
        else if (input.dataset.slider === 'ipo-min') input.value = input.min;
        else if (input.dataset.slider === 'fcf-min') input.value = input.min;
        else if (input.dataset.slider === 'growth-min') input.value = input.min;
        syncSliderLabel(input);
      });
      root.querySelector('.sec-select').value = 'ALL';
      applyFilters(mode);
    }
  });
})();
</script>

<div class="modal-backdrop" id="stockModalBackdrop"></div>
<aside class="modal-panel" id="stockModalPanel" role="dialog" aria-hidden="true">
  <button class="modal-close" id="stockModalClose">Schliessen ✕</button>
  <div class="modal-body" id="stockModalBody"></div>
</aside>
<div class="modal-toast" id="modalToast">Ticker kopiert</div>
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

  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    const eligible = eligibleForMode(evaluated, modeId);
    const allMust = topAllMust(eligible, modeId, args.topN);
    console.log(`  ${modeId}: ${eligible.length} eligible, ${allMust.length} all-MUST-pass`);
  }
}

if (require.main === module) main();
module.exports = { eligibleForMode, topByMethod, topAllMust, evaluateAll, dedupeByCompany };
+fmtM(revLatest) : '\u2014';
    
    const oiLatest = s.annualOpInc && s.annualOpInc[0];
    const oiOldest = s.annualOpInc && s.annualOpInc[s.annualOpInc.length-1];
    const oiText = (Number.isFinite(oiLatest) && Number.isFinite(oiOldest)) ? '
    syncSliderLabel(input);
    input.addEventListener('input', () => {
      if (input.dataset.slider === 'mcap-min') {
        const max = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-max"]');
        if (max && parseFloat(input.value) > parseFloat(max.value)) input.value = max.value;
      } else if (input.dataset.slider === 'mcap-max') {
        const min = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-min"]');
        if (min && parseFloat(input.value) < parseFloat(min.value)) input.value = min.value;
      }
      syncSliderLabel(input);
      applyFilters(input.dataset.mode);
    });
  });

  document.querySelectorAll('.sec-select').forEach(sel => {
    sel.addEventListener('change', () => applyFilters(sel.dataset.mode));
  });

  document.addEventListener('click', function(e) {
    const t = e.target;

    // TOP-TABS (Modus-Switch)
    const topTab = t.closest && t.closest('.top-tab');
    if (topTab) {
      const mode = topTab.dataset.mode;
      document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('top-tab-active'));
      topTab.classList.add('top-tab-active');
      document.querySelectorAll('.mode-content-wrap').forEach(w => {
        w.style.display = w.dataset.mode === mode ? '' : 'none';
      });
      return;
    }

    if (t.classList && t.classList.contains('ps-btn')) {
      const mode = t.dataset.mode;
      document.querySelectorAll('.ps-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('ps-active'));
      t.classList.add('ps-active');
      applyFilters(mode);
      return;
    }
    if (t.classList && t.classList.contains('sub-tab')) {
      const mode = t.dataset.mode;
      const tab = t.dataset.tab;
      document.querySelectorAll('.sub-tab[data-mode="' + mode + '"]').forEach(b => b.classList.remove('sub-tab-active'));
      t.classList.add('sub-tab-active');
      document.querySelectorAll('.sub-panel[data-mode="' + mode + '"]').forEach(p => {
        p.style.display = p.dataset.tab === tab ? '' : 'none';
      });
      applyFilters(mode);
      return;
    }
    // Tag 114: Stock-Modal-Click
    const row = t.closest && t.closest('.row');
    if (row && row.dataset.stock) {
      e.preventDefault();
      try { openStockModal(JSON.parse(row.dataset.stock), row.dataset.afUrl); } catch (err) { console.error(err); }
      return;
    }
    if (t.classList && t.classList.contains('reset-btn')) {
      const mode = t.dataset.mode;
      const root = document.querySelector('.filters[data-mode="' + mode + '"]');
      root.querySelectorAll('.ps-btn').forEach(b => b.classList.remove('ps-active'));
      root.querySelector('.ps-btn[data-pstate="ALL"]').classList.add('ps-active');
      root.querySelectorAll('.range-input').forEach(input => {
        if (input.dataset.slider === 'mcap-min') input.value = input.min;
        else if (input.dataset.slider === 'mcap-max') input.value = input.max;
        else if (input.dataset.slider === 'ipo-min') input.value = input.min;
        else if (input.dataset.slider === 'fcf-min') input.value = input.min;
        else if (input.dataset.slider === 'growth-min') input.value = input.min;
        syncSliderLabel(input);
      });
      root.querySelector('.sec-select').value = 'ALL';
      applyFilters(mode);
    }
  });
})();
</script>

<div class="modal-backdrop" id="stockModalBackdrop"></div>
<aside class="modal-panel" id="stockModalPanel" role="dialog" aria-hidden="true">
  <button class="modal-close" id="stockModalClose">Schliessen ✕</button>
  <div class="modal-body" id="stockModalBody"></div>
</aside>
<div class="modal-toast" id="modalToast">Ticker kopiert</div>
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

  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    const eligible = eligibleForMode(evaluated, modeId);
    const allMust = topAllMust(eligible, modeId, args.topN);
    console.log(`  ${modeId}: ${eligible.length} eligible, ${allMust.length} all-MUST-pass`);
  }
}

if (require.main === module) main();
module.exports = { eligibleForMode, topByMethod, topAllMust, evaluateAll, dedupeByCompany };
+fmtM(oiOldest)+' \u2192 
    syncSliderLabel(input);
    input.addEventListener('input', () => {
      if (input.dataset.slider === 'mcap-min') {
        const max = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-max"]');
        if (max && parseFloat(input.value) > parseFloat(max.value)) input.value = max.value;
      } else if (input.dataset.slider === 'mcap-max') {
        const min = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-min"]');
        if (min && parseFloat(input.value) < parseFloat(min.value)) input.value = min.value;
      }
      syncSliderLabel(input);
      applyFilters(input.dataset.mode);
    });
  });

  document.querySelectorAll('.sec-select').forEach(sel => {
    sel.addEventListener('change', () => applyFilters(sel.dataset.mode));
  });

  document.addEventListener('click', function(e) {
    const t = e.target;

    // TOP-TABS (Modus-Switch)
    const topTab = t.closest && t.closest('.top-tab');
    if (topTab) {
      const mode = topTab.dataset.mode;
      document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('top-tab-active'));
      topTab.classList.add('top-tab-active');
      document.querySelectorAll('.mode-content-wrap').forEach(w => {
        w.style.display = w.dataset.mode === mode ? '' : 'none';
      });
      return;
    }

    if (t.classList && t.classList.contains('ps-btn')) {
      const mode = t.dataset.mode;
      document.querySelectorAll('.ps-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('ps-active'));
      t.classList.add('ps-active');
      applyFilters(mode);
      return;
    }
    if (t.classList && t.classList.contains('sub-tab')) {
      const mode = t.dataset.mode;
      const tab = t.dataset.tab;
      document.querySelectorAll('.sub-tab[data-mode="' + mode + '"]').forEach(b => b.classList.remove('sub-tab-active'));
      t.classList.add('sub-tab-active');
      document.querySelectorAll('.sub-panel[data-mode="' + mode + '"]').forEach(p => {
        p.style.display = p.dataset.tab === tab ? '' : 'none';
      });
      applyFilters(mode);
      return;
    }
    // Tag 114: Stock-Modal-Click
    const row = t.closest && t.closest('.row');
    if (row && row.dataset.stock) {
      e.preventDefault();
      try { openStockModal(JSON.parse(row.dataset.stock), row.dataset.afUrl); } catch (err) { console.error(err); }
      return;
    }
    if (t.classList && t.classList.contains('reset-btn')) {
      const mode = t.dataset.mode;
      const root = document.querySelector('.filters[data-mode="' + mode + '"]');
      root.querySelectorAll('.ps-btn').forEach(b => b.classList.remove('ps-active'));
      root.querySelector('.ps-btn[data-pstate="ALL"]').classList.add('ps-active');
      root.querySelectorAll('.range-input').forEach(input => {
        if (input.dataset.slider === 'mcap-min') input.value = input.min;
        else if (input.dataset.slider === 'mcap-max') input.value = input.max;
        else if (input.dataset.slider === 'ipo-min') input.value = input.min;
        else if (input.dataset.slider === 'fcf-min') input.value = input.min;
        else if (input.dataset.slider === 'growth-min') input.value = input.min;
        syncSliderLabel(input);
      });
      root.querySelector('.sec-select').value = 'ALL';
      applyFilters(mode);
    }
  });
})();
</script>

<div class="modal-backdrop" id="stockModalBackdrop"></div>
<aside class="modal-panel" id="stockModalPanel" role="dialog" aria-hidden="true">
  <button class="modal-close" id="stockModalClose">Schliessen ✕</button>
  <div class="modal-body" id="stockModalBody"></div>
</aside>
<div class="modal-toast" id="modalToast">Ticker kopiert</div>
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

  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    const eligible = eligibleForMode(evaluated, modeId);
    const allMust = topAllMust(eligible, modeId, args.topN);
    console.log(`  ${modeId}: ${eligible.length} eligible, ${allMust.length} all-MUST-pass`);
  }
}

if (require.main === module) main();
module.exports = { eligibleForMode, topByMethod, topAllMust, evaluateAll, dedupeByCompany };
+fmtM(oiLatest) : '\u2014';
    
    const fcfLatest = s.annualFCF && s.annualFCF[0];
    const fcfOldest = s.annualFCF && s.annualFCF[s.annualFCF.length-1];
    const fcfText = (Number.isFinite(fcfLatest) && Number.isFinite(fcfOldest)) ? '
    syncSliderLabel(input);
    input.addEventListener('input', () => {
      if (input.dataset.slider === 'mcap-min') {
        const max = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-max"]');
        if (max && parseFloat(input.value) > parseFloat(max.value)) input.value = max.value;
      } else if (input.dataset.slider === 'mcap-max') {
        const min = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-min"]');
        if (min && parseFloat(input.value) < parseFloat(min.value)) input.value = min.value;
      }
      syncSliderLabel(input);
      applyFilters(input.dataset.mode);
    });
  });

  document.querySelectorAll('.sec-select').forEach(sel => {
    sel.addEventListener('change', () => applyFilters(sel.dataset.mode));
  });

  document.addEventListener('click', function(e) {
    const t = e.target;

    // TOP-TABS (Modus-Switch)
    const topTab = t.closest && t.closest('.top-tab');
    if (topTab) {
      const mode = topTab.dataset.mode;
      document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('top-tab-active'));
      topTab.classList.add('top-tab-active');
      document.querySelectorAll('.mode-content-wrap').forEach(w => {
        w.style.display = w.dataset.mode === mode ? '' : 'none';
      });
      return;
    }

    if (t.classList && t.classList.contains('ps-btn')) {
      const mode = t.dataset.mode;
      document.querySelectorAll('.ps-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('ps-active'));
      t.classList.add('ps-active');
      applyFilters(mode);
      return;
    }
    if (t.classList && t.classList.contains('sub-tab')) {
      const mode = t.dataset.mode;
      const tab = t.dataset.tab;
      document.querySelectorAll('.sub-tab[data-mode="' + mode + '"]').forEach(b => b.classList.remove('sub-tab-active'));
      t.classList.add('sub-tab-active');
      document.querySelectorAll('.sub-panel[data-mode="' + mode + '"]').forEach(p => {
        p.style.display = p.dataset.tab === tab ? '' : 'none';
      });
      applyFilters(mode);
      return;
    }
    // Tag 114: Stock-Modal-Click
    const row = t.closest && t.closest('.row');
    if (row && row.dataset.stock) {
      e.preventDefault();
      try { openStockModal(JSON.parse(row.dataset.stock), row.dataset.afUrl); } catch (err) { console.error(err); }
      return;
    }
    if (t.classList && t.classList.contains('reset-btn')) {
      const mode = t.dataset.mode;
      const root = document.querySelector('.filters[data-mode="' + mode + '"]');
      root.querySelectorAll('.ps-btn').forEach(b => b.classList.remove('ps-active'));
      root.querySelector('.ps-btn[data-pstate="ALL"]').classList.add('ps-active');
      root.querySelectorAll('.range-input').forEach(input => {
        if (input.dataset.slider === 'mcap-min') input.value = input.min;
        else if (input.dataset.slider === 'mcap-max') input.value = input.max;
        else if (input.dataset.slider === 'ipo-min') input.value = input.min;
        else if (input.dataset.slider === 'fcf-min') input.value = input.min;
        else if (input.dataset.slider === 'growth-min') input.value = input.min;
        syncSliderLabel(input);
      });
      root.querySelector('.sec-select').value = 'ALL';
      applyFilters(mode);
    }
  });
})();
</script>

<div class="modal-backdrop" id="stockModalBackdrop"></div>
<aside class="modal-panel" id="stockModalPanel" role="dialog" aria-hidden="true">
  <button class="modal-close" id="stockModalClose">Schliessen ✕</button>
  <div class="modal-body" id="stockModalBody"></div>
</aside>
<div class="modal-toast" id="modalToast">Ticker kopiert</div>
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

  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    const eligible = eligibleForMode(evaluated, modeId);
    const allMust = topAllMust(eligible, modeId, args.topN);
    console.log(`  ${modeId}: ${eligible.length} eligible, ${allMust.length} all-MUST-pass`);
  }
}

if (require.main === module) main();
module.exports = { eligibleForMode, topByMethod, topAllMust, evaluateAll, dedupeByCompany };
+fmtM(fcfOldest)+' \u2192 
    syncSliderLabel(input);
    input.addEventListener('input', () => {
      if (input.dataset.slider === 'mcap-min') {
        const max = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-max"]');
        if (max && parseFloat(input.value) > parseFloat(max.value)) input.value = max.value;
      } else if (input.dataset.slider === 'mcap-max') {
        const min = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-min"]');
        if (min && parseFloat(input.value) < parseFloat(min.value)) input.value = min.value;
      }
      syncSliderLabel(input);
      applyFilters(input.dataset.mode);
    });
  });

  document.querySelectorAll('.sec-select').forEach(sel => {
    sel.addEventListener('change', () => applyFilters(sel.dataset.mode));
  });

  document.addEventListener('click', function(e) {
    const t = e.target;

    // TOP-TABS (Modus-Switch)
    const topTab = t.closest && t.closest('.top-tab');
    if (topTab) {
      const mode = topTab.dataset.mode;
      document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('top-tab-active'));
      topTab.classList.add('top-tab-active');
      document.querySelectorAll('.mode-content-wrap').forEach(w => {
        w.style.display = w.dataset.mode === mode ? '' : 'none';
      });
      return;
    }

    if (t.classList && t.classList.contains('ps-btn')) {
      const mode = t.dataset.mode;
      document.querySelectorAll('.ps-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('ps-active'));
      t.classList.add('ps-active');
      applyFilters(mode);
      return;
    }
    if (t.classList && t.classList.contains('sub-tab')) {
      const mode = t.dataset.mode;
      const tab = t.dataset.tab;
      document.querySelectorAll('.sub-tab[data-mode="' + mode + '"]').forEach(b => b.classList.remove('sub-tab-active'));
      t.classList.add('sub-tab-active');
      document.querySelectorAll('.sub-panel[data-mode="' + mode + '"]').forEach(p => {
        p.style.display = p.dataset.tab === tab ? '' : 'none';
      });
      applyFilters(mode);
      return;
    }
    // Tag 114: Stock-Modal-Click
    const row = t.closest && t.closest('.row');
    if (row && row.dataset.stock) {
      e.preventDefault();
      try { openStockModal(JSON.parse(row.dataset.stock), row.dataset.afUrl); } catch (err) { console.error(err); }
      return;
    }
    if (t.classList && t.classList.contains('reset-btn')) {
      const mode = t.dataset.mode;
      const root = document.querySelector('.filters[data-mode="' + mode + '"]');
      root.querySelectorAll('.ps-btn').forEach(b => b.classList.remove('ps-active'));
      root.querySelector('.ps-btn[data-pstate="ALL"]').classList.add('ps-active');
      root.querySelectorAll('.range-input').forEach(input => {
        if (input.dataset.slider === 'mcap-min') input.value = input.min;
        else if (input.dataset.slider === 'mcap-max') input.value = input.max;
        else if (input.dataset.slider === 'ipo-min') input.value = input.min;
        else if (input.dataset.slider === 'fcf-min') input.value = input.min;
        else if (input.dataset.slider === 'growth-min') input.value = input.min;
        syncSliderLabel(input);
      });
      root.querySelector('.sec-select').value = 'ALL';
      applyFilters(mode);
    }
  });
})();
</script>

<div class="modal-backdrop" id="stockModalBackdrop"></div>
<aside class="modal-panel" id="stockModalPanel" role="dialog" aria-hidden="true">
  <button class="modal-close" id="stockModalClose">Schliessen ✕</button>
  <div class="modal-body" id="stockModalBody"></div>
</aside>
<div class="modal-toast" id="modalToast">Ticker kopiert</div>
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

  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    const eligible = eligibleForMode(evaluated, modeId);
    const allMust = topAllMust(eligible, modeId, args.topN);
    console.log(`  ${modeId}: ${eligible.length} eligible, ${allMust.length} all-MUST-pass`);
  }
}

if (require.main === module) main();
module.exports = { eligibleForMode, topByMethod, topAllMust, evaluateAll, dedupeByCompany };
+fmtM(fcfLatest) : '\u2014';
    
    const gms = gmRow(s);
    const oms = omRow(s);
    const gmText = gms ? gms[0].toFixed(1)+'%' : '\u2014';
    const omText = oms ? oms[0].toFixed(1)+'%' : '\u2014';
    
    body.innerHTML = ''
      + '<div class="modal-tk">'+s.ticker+'</div>'
      + '<div class="modal-name">'+s.name+'</div>'
      + '<div class="modal-meta">'+s.sector+(s.industry ? ' \u00b7 '+s.industry : '')+(s.ipoYear ? ' \u00b7 IPO '+s.ipoYear : '')+'</div>'
      + '<div class="modal-badges">'+badgesHtml+'</div>'
      + '<div class="modal-section"><div class="modal-section-title">5-Jahres-Trends</div>'
      + '<div class="modal-chart-row"><span class="modal-chart-label">Revenue</span>'+spark(s.annualRev)+'<span class="modal-chart-value">'+revGrowthAbs+'</span></div>'
      + '<div class="modal-chart-row"><span class="modal-chart-label">Op Income</span>'+spark(s.annualOpInc)+'<span class="modal-chart-value">'+oiText+'</span></div>'
      + '<div class="modal-chart-row"><span class="modal-chart-label">Free Cash Flow</span>'+spark(s.annualFCF)+'<span class="modal-chart-value">'+fcfText+'</span></div>'
      + (gms ? '<div class="modal-chart-row"><span class="modal-chart-label">Gross Margin</span>'+spark(gms)+'<span class="modal-chart-value">'+gmText+'</span></div>' : '')
      + (oms ? '<div class="modal-chart-row"><span class="modal-chart-label">Op Margin</span>'+spark(oms)+'<span class="modal-chart-value">'+omText+'</span></div>' : '')
      + '</div>'
      + '<div class="modal-section"><div class="modal-section-title">Kennzahlen</div><div class="modal-stat-grid">'
      + '<div class="modal-stat"><span class="modal-stat-label">Marktkap</span><span class="modal-stat-value">'+fmtMoneyM(s.mcap)+'</span></div>'
      + '<div class="modal-stat"><span class="modal-stat-label">Rule-of-40</span><span class="modal-stat-value">'+(Number.isFinite(s.rule40) ? s.rule40.toFixed(1) : '\u2014')+'</span></div>'
      + '<div class="modal-stat"><span class="modal-stat-label">YoY Growth</span><span class="modal-stat-value">'+fmtPct(s.revenueGrowthYoY)+'</span></div>'
      + '<div class="modal-stat"><span class="modal-stat-label">FCF-Margin</span><span class="modal-stat-value">'+fmtPct(s.fcfMarginTTM)+'</span></div>'
      + '</div></div>'
      + '<div class="modal-action">'
      + '<button class="modal-action-btn" id="modalCopyOpenBtn">\u270e '+s.ticker+' kopieren + Aktienfinder</button>'
      + '<button class="modal-action-btn secondary" id="modalCopyOnlyBtn">Nur kopieren</button>'
      + '</div>';
    
    document.getElementById('stockModalBackdrop').classList.add('show');
    document.getElementById('stockModalPanel').classList.add('show');
    document.getElementById('stockModalPanel').setAttribute('aria-hidden', 'false');
    
    document.getElementById('modalCopyOpenBtn').onclick = () => { 
      navigator.clipboard.writeText(s.ticker).then(() => showToast(s.ticker + ' kopiert')); 
      window.open(afUrl, '_blank');
    };
    document.getElementById('modalCopyOnlyBtn').onclick = () => {
      navigator.clipboard.writeText(s.ticker).then(() => showToast(s.ticker + ' kopiert'));
    };
  }
  function closeStockModal() {
    document.getElementById('stockModalBackdrop').classList.remove('show');
    document.getElementById('stockModalPanel').classList.remove('show');
    document.getElementById('stockModalPanel').setAttribute('aria-hidden', 'true');
  }
  function showToast(msg) {
    const t = document.getElementById('modalToast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1800);
  }
  document.getElementById('stockModalClose').onclick = closeStockModal;
  document.getElementById('stockModalBackdrop').onclick = closeStockModal;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeStockModal(); });

  document.querySelectorAll('.range-input').forEach(input => {
    syncSliderLabel(input);
    input.addEventListener('input', () => {
      if (input.dataset.slider === 'mcap-min') {
        const max = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-max"]');
        if (max && parseFloat(input.value) > parseFloat(max.value)) input.value = max.value;
      } else if (input.dataset.slider === 'mcap-max') {
        const min = document.querySelector('.range-input[data-mode="' + input.dataset.mode + '"][data-slider="mcap-min"]');
        if (min && parseFloat(input.value) < parseFloat(min.value)) input.value = min.value;
      }
      syncSliderLabel(input);
      applyFilters(input.dataset.mode);
    });
  });

  document.querySelectorAll('.sec-select').forEach(sel => {
    sel.addEventListener('change', () => applyFilters(sel.dataset.mode));
  });

  document.addEventListener('click', function(e) {
    const t = e.target;

    // TOP-TABS (Modus-Switch)
    const topTab = t.closest && t.closest('.top-tab');
    if (topTab) {
      const mode = topTab.dataset.mode;
      document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('top-tab-active'));
      topTab.classList.add('top-tab-active');
      document.querySelectorAll('.mode-content-wrap').forEach(w => {
        w.style.display = w.dataset.mode === mode ? '' : 'none';
      });
      return;
    }

    if (t.classList && t.classList.contains('ps-btn')) {
      const mode = t.dataset.mode;
      document.querySelectorAll('.ps-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('ps-active'));
      t.classList.add('ps-active');
      applyFilters(mode);
      return;
    }
    if (t.classList && t.classList.contains('sub-tab')) {
      const mode = t.dataset.mode;
      const tab = t.dataset.tab;
      document.querySelectorAll('.sub-tab[data-mode="' + mode + '"]').forEach(b => b.classList.remove('sub-tab-active'));
      t.classList.add('sub-tab-active');
      document.querySelectorAll('.sub-panel[data-mode="' + mode + '"]').forEach(p => {
        p.style.display = p.dataset.tab === tab ? '' : 'none';
      });
      applyFilters(mode);
      return;
    }
    // Tag 114: Stock-Modal-Click
    const row = t.closest && t.closest('.row');
    if (row && row.dataset.stock) {
      e.preventDefault();
      try { openStockModal(JSON.parse(row.dataset.stock), row.dataset.afUrl); } catch (err) { console.error(err); }
      return;
    }
    if (t.classList && t.classList.contains('reset-btn')) {
      const mode = t.dataset.mode;
      const root = document.querySelector('.filters[data-mode="' + mode + '"]');
      root.querySelectorAll('.ps-btn').forEach(b => b.classList.remove('ps-active'));
      root.querySelector('.ps-btn[data-pstate="ALL"]').classList.add('ps-active');
      root.querySelectorAll('.range-input').forEach(input => {
        if (input.dataset.slider === 'mcap-min') input.value = input.min;
        else if (input.dataset.slider === 'mcap-max') input.value = input.max;
        else if (input.dataset.slider === 'ipo-min') input.value = input.min;
        else if (input.dataset.slider === 'fcf-min') input.value = input.min;
        else if (input.dataset.slider === 'growth-min') input.value = input.min;
        syncSliderLabel(input);
      });
      root.querySelector('.sec-select').value = 'ALL';
      applyFilters(mode);
    }
  });
})();
</script>

<div class="modal-backdrop" id="stockModalBackdrop"></div>
<aside class="modal-panel" id="stockModalPanel" role="dialog" aria-hidden="true">
  <button class="modal-close" id="stockModalClose">Schliessen ✕</button>
  <div class="modal-body" id="stockModalBody"></div>
</aside>
<div class="modal-toast" id="modalToast">Ticker kopiert</div>
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

  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    const eligible = eligibleForMode(evaluated, modeId);
    const allMust = topAllMust(eligible, modeId, args.topN);
    console.log(`  ${modeId}: ${eligible.length} eligible, ${allMust.length} all-MUST-pass`);
  }
}

if (require.main === module) main();
module.exports = { eligibleForMode, topByMethod, topAllMust, evaluateAll, dedupeByCompany };
