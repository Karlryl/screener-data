#!/usr/bin/env node
/**
 * Tag 104: Modes-Report — Anthrazit-Design + IPO/Mcap-Slider
 * ============================================================
 * - Anthrazit/Pewter Hintergrund, warmes Cream-Off-White, Bronze-Akzent.
 * - Source Serif (Headlines) + Inter (Body).
 * - Klassisch-modern: dezente Linien, Serifen-Headlines, generous whitespace.
 * - IPO-Filter (Slider Jahr-min) und MarketCap-Range-Slider pro Modus.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const Runner = require('./methods/runner.js');
const SM = require('./methods/strategy-modes.js');

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './modes-report.html', topN: 50 };
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
  return v.toFixed(2);
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

function topByMethod(eligible, methodId, methodMeta, topN) {
  const valid = eligible.filter(ev => {
    const r = ev.allResults[methodId];
    return r && r.computable && Number.isFinite(r.value);
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

const PSTATE_LABEL = { LOSS:'Loss', TURNAROUND:'Turnaround', RECENT:'Recent', STABLE:'Stable', NA:'—' };
const PSTATE_CLASS = { LOSS:'pst-loss', TURNAROUND:'pst-turnaround', RECENT:'pst-recent', STABLE:'pst-stable', NA:'pst-na' };

function renderCard(ev, i, modeId, sortMethodId) {
  const s = ev.stock;
  const ticker = (s.meta && s.meta.ticker) || '???';
  const name = (s.meta && s.meta.name) || '';
  const sector = (s.meta && s.meta.sector) || '';
  const mcap = ev.mcap;
  const ipoYear = ev.ipoYear;

  const me = SM.evaluateMode(s, modeId, ev.allResults);
  const story = me.passed ? SM.buildStory(s, me, ev.allResults, SM.MODES[modeId]) : null;

  const sortMethod = sortMethodId ? Runner.METHODS.find(m => m.id === sortMethodId) : null;
  const sortRes = sortMethodId ? ev.allResults[sortMethodId] : null;
  const sortValStr = sortRes && sortRes.computable
    ? fmtValue(sortRes.value, sortMethod && sortMethod.unit)
    : null;
  const sortLabel = (sortMethod && sortMethod.label) || sortMethodId || '';

  const psRes = ev.allResults['profitability-state'];
  const profState = (psRes && psRes.computable && psRes.components) ? psRes.components.state : 'NA';
  const psClass = PSTATE_CLASS[profState] || 'pst-na';
  const psLabel = PSTATE_LABEL[profState] || profState;

  let factsHtml = '';
  let warningHtml = '';
  if (story) {
    const facts = (story.coreSummary || '').split(', ').filter(Boolean).slice(0, 3);
    factsHtml = facts.map(f => `<li>${escHtml(f)}</li>`).join('');
    if (story.warnings) warningHtml = `<div class="card-warn">${escHtml(story.warnings)}</div>`;
  } else {
    factsHtml = `<li class="muted">Erfüllt nicht alle MUST-Kriterien dieses Modus</li>`;
  }

  const valBlock = sortValStr
    ? `<div class="card-val">${escHtml(sortValStr)}</div><div class="card-val-label">${escHtml(sortLabel)}</div>`
    : '';

  const ipoTag = ipoYear ? `<span class="tag tag-ipo">IPO ${ipoYear}</span>` : '';

  return `<article class="card" data-prof-state="${profState}" data-mcap="${Math.round(mcap||0)}" data-ipo="${ipoYear||0}">
      <header class="card-head">
        <div class="card-id">
          <div class="card-ticker">${escHtml(ticker)}</div>
          <div class="card-name">${escHtml(name.slice(0, 40))}${name.length>40?'…':''}</div>
        </div>
        <div class="card-meta">${valBlock}<div class="card-rank">#${i+1} · ${fmtMoney(mcap)}</div></div>
      </header>
      <div class="card-tags">
        <span class="tag tag-sector">${escHtml(sector || '—')}</span>
        <span class="tag ${psClass}">${escHtml(psLabel)}</span>
        ${ipoTag}
      </div>
      <ul class="card-facts">${factsHtml}</ul>
      ${warningHtml}
    </article>`;
}

function renderModeSection(modeId, eligible, evaluated, topN) {
  const mode = SM.MODES[modeId];
  const evidenceClass = mode.evidence === 'literaturgestuetzt' ? 'ev-lit'
                     : mode.evidence === 'heuristisch' ? 'ev-heur' : 'ev-exp';
  const dotClass = modeId === 'HYPERGROWTH' ? 'mode-dot-hg' : modeId === 'QUALITY_COMPOUNDER' ? 'mode-dot-qc' : 'mode-dot-ta';

  const headerHtml = `
    <div class="mode-header">
      <div class="mode-title">
        <span class="mode-dot ${dotClass}"></span>
        <h2>${escHtml(mode.label)}</h2>
        <span class="ev-pill ${evidenceClass}">${escHtml(mode.evidence)}</span>
      </div>
      <div class="mode-count">${eligible.length} eligible</div>
    </div>
    <p class="mode-desc">${escHtml(mode.description)}</p>
  `;

  if (mode.enabled === false) {
    return `<section class="mode-section">${headerHtml}<div class="mode-disabled">Modus in Phase 2 — noch nicht aktiv. Erst Hypergrowth + Quality validieren.</div></section>`;
  }

  const tabMethods = mode.core.map(c => c.id);
  const tabs = [...tabMethods, '__ALL_MUST__'];
  const defaultTab = '__ALL_MUST__';

  const tabButtonsHtml = tabs.map(tabId => {
    const isAllMust = tabId === '__ALL_MUST__';
    const methodMeta = isAllMust ? null : Runner.METHODS.find(m => m.id === tabId);
    const label = isAllMust ? 'Beste Kandidaten' : (methodMeta && methodMeta.label) || tabId;
    const active = tabId === defaultTab;
    return `<button class="tab-btn ${active ? 'tab-active' : ''}" data-mode="${modeId}" data-tab="${escHtml(tabId)}">${escHtml(label)}</button>`;
  }).join('');

  const panelsHtml = tabs.map(tabId => {
    const isAllMust = tabId === '__ALL_MUST__';
    let cardsBlock;
    if (isAllMust) {
      const list = topAllMust(eligible, modeId, topN);
      cardsBlock = list.length === 0
        ? `<div class="empty">Keine Stocks erfüllen alle MUST-Kriterien dieses Modus.</div>`
        : `<div class="card-grid">${list.map((ev,i) => renderCard(ev, i, modeId, null)).join('')}</div>`;
    } else {
      const methodMeta = Runner.METHODS.find(m => m.id === tabId);
      const list = topByMethod(eligible, tabId, methodMeta, topN);
      cardsBlock = list.length === 0
        ? `<div class="empty">Keine Stocks mit computable Werten für diese Methode.</div>`
        : `<div class="card-grid">${list.map((ev,i) => renderCard(ev, i, modeId, tabId)).join('')}</div>`;
    }
    const visible = tabId === defaultTab ? '' : 'display:none;';
    return `<div class="tab-panel" data-mode="${modeId}" data-tab="${escHtml(tabId)}" style="${visible}">${cardsBlock}</div>`;
  }).join('');

  // Mcap range and IPO range from eligible
  const mcaps = eligible.map(e => e.mcap || 0).filter(Boolean);
  const ipos = eligible.map(e => e.ipoYear || 0).filter(Boolean);
  const mcapMin = mcaps.length ? Math.min(...mcaps) : 0;
  const mcapMax = mcaps.length ? Math.max(...mcaps) : 1e12;
  const ipoMin = ipos.length ? Math.min(...ipos) : 1980;
  const ipoMax = ipos.length ? Math.max(...ipos) : new Date().getFullYear();

  const filtersHtml = `
    <div class="filters" data-mode="${modeId}">
      <div class="filter-group">
        <span class="f-label">Profitabilität</span>
        <button class="ps-btn ps-active" data-mode="${modeId}" data-pstate="ALL">Alle</button>
        <button class="ps-btn ps-loss" data-mode="${modeId}" data-pstate="LOSS">Loss</button>
        <button class="ps-btn ps-turnaround" data-mode="${modeId}" data-pstate="TURNAROUND">Turnaround</button>
        <button class="ps-btn ps-recent" data-mode="${modeId}" data-pstate="RECENT">Recent</button>
        <button class="ps-btn ps-stable" data-mode="${modeId}" data-pstate="STABLE">Stable</button>
      </div>
      <div class="filter-group filter-slider">
        <span class="f-label">MarketCap (USD)</span>
        <span class="slider-val" data-mode="${modeId}" data-slider="mcap-min">$2B</span>
        <input type="range" class="range-input" data-mode="${modeId}" data-slider="mcap-min" min="2" max="500" step="1" value="2">
        <span class="slider-sep">–</span>
        <input type="range" class="range-input" data-mode="${modeId}" data-slider="mcap-max" min="2" max="500" step="1" value="500">
        <span class="slider-val" data-mode="${modeId}" data-slider="mcap-max">$500B</span>
      </div>
      <div class="filter-group filter-slider">
        <span class="f-label">IPO ab</span>
        <input type="range" class="range-input" data-mode="${modeId}" data-slider="ipo-min" min="1980" max="${ipoMax}" step="1" value="1980">
        <span class="slider-val" data-mode="${modeId}" data-slider="ipo-min">1980</span>
        <button class="reset-btn" data-mode="${modeId}">Reset</button>
      </div>
    </div>`;

  return `<section class="mode-section">
    ${headerHtml}
    ${filtersHtml}
    <div class="tabs">${tabButtonsHtml}</div>
    ${panelsHtml}
  </section>`;
}

function buildHtml(evaluated, topN) {
  const generatedAt = new Date().toISOString();
  const modes = ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND'];
  const eligibleByMode = {};
  for (const m of modes) eligibleByMode[m] = eligibleForMode(evaluated, m);

  const sections = modes.map(m => renderModeSection(m, eligibleByMode[m], evaluated, topN)).join('\n');

  const totalStocks = evaluated.length;
  const sectorExcluded = totalStocks - eligibleByMode.HYPERGROWTH.length;
  const hgPicks = topAllMust(eligibleByMode.HYPERGROWTH, 'HYPERGROWTH', 9999).length;
  const qcPicks = topAllMust(eligibleByMode.QUALITY_COMPOUNDER, 'QUALITY_COMPOUNDER', 9999).length;
  const dateLabel = new Date(generatedAt).toLocaleDateString('de-DE', { day:'2-digit', month:'long', year:'numeric' });

  return `<!DOCTYPE html>
<html lang="de"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Karl's Stock-Screener · Modes-Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --anthracite: #1c1f24;
    --anthracite-2: #232831;
    --anthracite-3: #2c323d;
    --anthracite-4: #3a4150;
    --rule: #3a4150;
    --rule-soft: #2c323d;
    --paper: #f0ece3;
    --paper-mute: #c9c4b8;
    --paper-faint: #8a8579;
    --paper-dim: #5d5b54;
    --bronze: #c89866;
    --bronze-soft: #3d3328;
    --bronze-deep: #b5824a;
    --copper: #d4a574;
    --sage: #98a98a;
    --sage-soft: #2c3a2c;
    --slate-cool: #8a9bb5;
    --slate-soft: #2c333d;
    --warning: #d9a05f;
    --warning-soft: #3d2f1d;
    --loss: #c47a78;
    --loss-soft: #3a1f1d;
    --turnaround: #d9a05f;
    --turnaround-soft: #3d2f1d;
    --recent: #a5b884;
    --recent-soft: #2a3322;
    --stable: #7fb09c;
    --stable-soft: #1f3028;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--anthracite);
    color: var(--paper);
    font-size: 15px; line-height: 1.55;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  .wrap { max-width: 1280px; margin: 0 auto; padding: 56px 32px 80px; }

  .doc-header { margin-bottom: 44px; padding-bottom: 32px; border-bottom: 1px solid var(--rule); }
  .eyebrow { font-size: 11px; font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase; color: var(--bronze); margin-bottom: 14px; }
  h1 { font-family: 'Source Serif 4', Georgia, serif; font-size: 42px; font-weight: 500; line-height: 1.1; letter-spacing: -0.012em; color: var(--paper); margin-bottom: 12px; }
  .sub { font-size: 14px; color: var(--paper-mute); max-width: 640px; }

  .status-strip {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px;
    background: var(--rule); border: 1px solid var(--rule);
    border-radius: 8px; overflow: hidden; margin-bottom: 32px;
  }
  .status-cell { background: var(--anthracite-2); padding: 18px 20px; }
  .status-label { font-size: 10px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: var(--paper-faint); margin-bottom: 6px; }
  .status-value { font-family: 'Source Serif 4', serif; font-size: 28px; font-weight: 500; color: var(--paper); font-feature-settings: 'tnum'; line-height: 1; }
  .status-sub { font-size: 11px; color: var(--paper-mute); margin-top: 4px; }
  @media (max-width: 720px) { .status-strip { grid-template-columns: repeat(2, 1fr); } }

  .disclaimer {
    background: var(--bronze-soft); border-left: 2px solid var(--bronze);
    padding: 14px 20px; border-radius: 6px; margin-bottom: 44px;
    color: var(--copper); font-size: 13px; line-height: 1.6;
  }
  .disclaimer strong { color: var(--bronze); font-weight: 600; }

  .mode-section {
    background: var(--anthracite-2); border: 1px solid var(--rule);
    border-radius: 10px; padding: 32px;
    margin-bottom: 28px;
  }
  .mode-header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 6px; }
  .mode-title { display: flex; align-items: center; gap: 14px; }
  .mode-title h2 { font-family: 'Source Serif 4', serif; font-size: 28px; font-weight: 500; letter-spacing: -0.005em; color: var(--paper); }
  .mode-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .mode-dot-hg { background: var(--bronze); box-shadow: 0 0 8px rgba(200,152,102,0.35); }
  .mode-dot-qc { background: var(--slate-cool); box-shadow: 0 0 8px rgba(138,155,181,0.3); }
  .mode-dot-ta { background: var(--sage); box-shadow: 0 0 8px rgba(152,169,138,0.3); }
  .ev-pill { font-size: 10.5px; font-weight: 500; padding: 3px 10px; border-radius: 12px; letter-spacing: 0.04em; text-transform: lowercase; }
  .ev-pill.ev-lit { background: var(--sage-soft); color: var(--sage); border: 1px solid var(--sage)40; }
  .ev-pill.ev-heur { background: var(--bronze-soft); color: var(--bronze); border: 1px solid var(--bronze)40; }
  .ev-pill.ev-exp { background: var(--slate-soft); color: var(--slate-cool); border: 1px solid var(--slate-cool)40; }
  .mode-count { font-size: 13px; color: var(--paper-mute); font-feature-settings: 'tnum'; }
  .mode-desc { color: var(--paper-mute); font-size: 14px; margin-bottom: 22px; }
  .mode-disabled {
    background: var(--anthracite-3); border: 1px dashed var(--rule);
    padding: 22px; text-align: center; border-radius: 6px;
    color: var(--paper-faint); font-size: 13px;
  }

  .filters {
    display: grid; gap: 14px;
    padding: 16px 18px; background: var(--anthracite-3);
    border: 1px solid var(--rule); border-radius: 8px; margin-bottom: 18px;
  }
  .filter-group { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .f-label { font-size: 10.5px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--paper-faint); margin-right: 6px; min-width: 90px; }
  .ps-btn {
    background: var(--anthracite); border: 1px solid var(--rule);
    padding: 5px 12px; border-radius: 12px;
    font: inherit; font-size: 12px; font-weight: 500;
    cursor: pointer; color: var(--paper-mute);
    transition: all 0.12s;
  }
  .ps-btn:hover { border-color: var(--paper-faint); color: var(--paper); }
  .ps-btn.ps-active { background: var(--paper); color: var(--anthracite); border-color: var(--paper); }
  .ps-btn.ps-loss.ps-active { background: var(--loss); border-color: var(--loss); color: var(--anthracite); }
  .ps-btn.ps-turnaround.ps-active { background: var(--turnaround); border-color: var(--turnaround); color: var(--anthracite); }
  .ps-btn.ps-recent.ps-active { background: var(--recent); border-color: var(--recent); color: var(--anthracite); }
  .ps-btn.ps-stable.ps-active { background: var(--stable); border-color: var(--stable); color: var(--anthracite); }

  .filter-slider { gap: 12px; }
  .range-input {
    -webkit-appearance: none; appearance: none;
    background: transparent;
    width: 140px; height: 4px;
  }
  .range-input::-webkit-slider-runnable-track { background: var(--anthracite-4); height: 3px; border-radius: 2px; }
  .range-input::-moz-range-track { background: var(--anthracite-4); height: 3px; border-radius: 2px; }
  .range-input::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--bronze); border: 2px solid var(--anthracite);
    margin-top: -6px; cursor: pointer;
    transition: background 0.12s;
  }
  .range-input::-webkit-slider-thumb:hover { background: var(--copper); }
  .range-input::-moz-range-thumb {
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--bronze); border: 2px solid var(--anthracite);
    cursor: pointer;
  }
  .slider-val {
    font-feature-settings: 'tnum'; font-size: 12.5px; color: var(--paper);
    font-weight: 500; min-width: 56px; display: inline-block;
  }
  .slider-sep { color: var(--paper-faint); font-size: 12px; }
  .reset-btn {
    background: transparent; border: 1px solid var(--rule);
    padding: 4px 10px; border-radius: 4px;
    font: inherit; font-size: 11px; color: var(--paper-mute);
    cursor: pointer; margin-left: auto;
  }
  .reset-btn:hover { border-color: var(--bronze); color: var(--bronze); }

  .tabs {
    display: flex; gap: 2px; flex-wrap: wrap;
    padding-bottom: 14px; margin-bottom: 18px;
    border-bottom: 1px solid var(--rule);
  }
  .tab-btn {
    background: transparent; border: none;
    padding: 8px 14px; border-radius: 4px;
    font: inherit; font-size: 13px; font-weight: 500;
    color: var(--paper-mute); cursor: pointer;
    transition: all 0.12s; letter-spacing: 0.005em;
  }
  .tab-btn:hover { background: var(--anthracite-3); color: var(--paper); }
  .tab-btn.tab-active { background: var(--paper); color: var(--anthracite); }

  .card-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }
  .card {
    background: var(--anthracite-3); border: 1px solid var(--rule);
    border-radius: 8px; padding: 16px 18px;
    transition: border-color 0.15s, transform 0.15s, background 0.15s;
  }
  .card:hover {
    border-color: var(--bronze);
    background: var(--anthracite-3);
    transform: translateY(-1px);
  }
  .card-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
  .card-id { flex: 1; min-width: 0; }
  .card-ticker { font-family: 'Source Serif 4', serif; font-weight: 500; font-size: 18px; color: var(--paper); font-feature-settings: 'tnum'; letter-spacing: 0.01em; }
  .card-name { font-size: 12px; color: var(--paper-mute); margin-top: 1px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-meta { text-align: right; flex-shrink: 0; }
  .card-val { font-family: 'Source Serif 4', serif; font-size: 19px; font-weight: 500; color: var(--bronze); font-feature-settings: 'tnum'; line-height: 1; }
  .card-val-label { font-size: 10px; color: var(--paper-faint); margin-top: 3px; letter-spacing: 0.04em; }
  .card-rank { font-size: 11px; color: var(--paper-faint); margin-top: 4px; font-feature-settings: 'tnum'; }

  .card-tags { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 10px; }
  .tag { font-size: 10.5px; font-weight: 500; padding: 2px 8px; border-radius: 9px; letter-spacing: 0.01em; }
  .tag-sector { background: var(--anthracite-4); color: var(--paper-mute); }
  .tag-ipo { background: var(--anthracite-4); color: var(--paper-faint); font-feature-settings: 'tnum'; }
  .pst-loss { background: var(--loss-soft); color: var(--loss); }
  .pst-turnaround { background: var(--turnaround-soft); color: var(--turnaround); }
  .pst-recent { background: var(--recent-soft); color: var(--recent); }
  .pst-stable { background: var(--stable-soft); color: var(--stable); }
  .pst-na { background: var(--anthracite-4); color: var(--paper-faint); }

  .card-facts { list-style: none; padding: 0; margin: 0; }
  .card-facts li {
    font-size: 12.5px; color: var(--paper-mute); line-height: 1.5;
    padding: 2px 0 2px 16px; position: relative;
  }
  .card-facts li::before {
    content: '·'; color: var(--bronze); position: absolute; left: 4px;
    font-weight: 700; font-size: 16px; line-height: 1;
  }
  .card-facts li.muted { color: var(--paper-faint); font-style: italic; }
  .card-facts li.muted::before { content: ''; }
  .card-warn {
    margin-top: 10px; padding: 8px 10px;
    background: var(--warning-soft); color: var(--warning);
    border-radius: 5px; font-size: 11.5px; line-height: 1.45;
    border-left: 2px solid var(--warning);
  }

  .empty {
    background: var(--anthracite-3); border: 1px dashed var(--rule);
    padding: 32px; text-align: center; border-radius: 6px;
    color: var(--paper-faint); font-size: 13px;
  }

  footer {
    margin-top: 56px; padding-top: 24px;
    border-top: 1px solid var(--rule);
    font-size: 12px; color: var(--paper-faint);
    display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px;
  }
</style>
</head>
<body>
<div class="wrap">

  <header class="doc-header">
    <div class="eyebrow">Modes-Report · ${escHtml(dateLabel)}</div>
    <h1>Drei Strategien, klare Story-Cards.</h1>
    <p class="sub">Discovery-Filter über ${totalStocks} Stocks. Banks, REITs, Insurance und (in Hypergrowth) Mining/Materials/Oil & Gas fliegen automatisch raus. DataGuards filtern Earnings-Manipulation, Solvenz-Risiken und Reverse-Mergers.</p>
  </header>

  <div class="status-strip">
    <div class="status-cell">
      <div class="status-label">Universum</div>
      <div class="status-value">${totalStocks.toLocaleString('de-DE')}</div>
      <div class="status-sub">Stocks gepullt</div>
    </div>
    <div class="status-cell">
      <div class="status-label">Sektor-Ausschluss</div>
      <div class="status-value">${sectorExcluded.toLocaleString('de-DE')}</div>
      <div class="status-sub">Banks · REITs · Insurance · Mining</div>
    </div>
    <div class="status-cell">
      <div class="status-label">Hypergrowth</div>
      <div class="status-value">${hgPicks}</div>
      <div class="status-sub">erfüllen alle MUST</div>
    </div>
    <div class="status-cell">
      <div class="status-label">Quality-Compounder</div>
      <div class="status-value">${qcPicks}</div>
      <div class="status-sub">erfüllen alle MUST</div>
    </div>
  </div>

  <div class="disclaimer">
    <strong>Discovery-Tool, kein Alpha-System.</strong> Diese Modi sind strukturierte Ideenquellen, keine statistisch validierte Outperformance-Garantie. Finale Entscheidung liegt bei deinem Deep-Dive (Aktienfinder, Elliot-Wellen, eigene Recherche).
  </div>

  ${sections}

  <footer>
    <div>Karl's privater Stock-Screener · keine Anlageberatung · Daten via Yahoo Finance · ohne Gewähr</div>
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
    const filtersRoot = document.querySelector('.filters[data-mode="' + mode + '"]');
    if (!filtersRoot) return;
    const activePs = filtersRoot.querySelector('.ps-btn.ps-active');
    const pstate = activePs ? activePs.dataset.pstate : 'ALL';
    const mcapMin = parseFloat(filtersRoot.querySelector('[data-slider="mcap-min"].range-input').value) * 1e9;
    const mcapMax = parseFloat(filtersRoot.querySelector('[data-slider="mcap-max"].range-input').value) * 1e9;
    const ipoMin = parseFloat(filtersRoot.querySelector('[data-slider="ipo-min"].range-input').value);

    document.querySelectorAll('.tab-panel[data-mode="' + mode + '"] .card').forEach(card => {
      const ps = card.dataset.profState;
      const mcap = parseFloat(card.dataset.mcap) || 0;
      const ipo = parseFloat(card.dataset.ipo) || 0;
      const psOk = pstate === 'ALL' || ps === pstate;
      const mcapOk = mcap >= mcapMin && mcap <= mcapMax;
      const ipoOk = ipo === 0 || ipo >= ipoMin;
      card.style.display = (psOk && mcapOk && ipoOk) ? '' : 'none';
    });
  }

  function syncSliderLabel(input) {
    const mode = input.dataset.mode;
    const which = input.dataset.slider;
    const labelEl = document.querySelector('.slider-val[data-mode="' + mode + '"][data-slider="' + which + '"]');
    if (!labelEl) return;
    const v = parseFloat(input.value);
    if (which === 'mcap-min' || which === 'mcap-max') labelEl.textContent = fmtMcap(v);
    else labelEl.textContent = String(Math.round(v));
  }

  document.querySelectorAll('.range-input').forEach(input => {
    syncSliderLabel(input);
    input.addEventListener('input', () => {
      // mcap min must not exceed max
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

  document.addEventListener('click', function(e) {
    const t = e.target;
    if (t.classList && t.classList.contains('ps-btn')) {
      const mode = t.dataset.mode;
      document.querySelectorAll('.ps-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('ps-active'));
      t.classList.add('ps-active');
      applyFilters(mode);
      return;
    }
    if (t.classList && t.classList.contains('tab-btn')) {
      const mode = t.dataset.mode;
      const tab = t.dataset.tab;
      document.querySelectorAll('.tab-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('tab-active'));
      t.classList.add('tab-active');
      document.querySelectorAll('.tab-panel[data-mode="' + mode + '"]').forEach(p => {
        p.style.display = p.dataset.tab === tab ? '' : 'none';
      });
      // Re-apply filters in the new active panel (cards may need hiding)
      applyFilters(mode);
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
        syncSliderLabel(input);
      });
      applyFilters(mode);
    }
  });
})();
</script>

</body></html>`;
}

function main() {
  const args = parseArgs(process.argv);
  console.log('Loading snapshots from', args.snapshots);
  const stocks = loadStocks(args.snapshots);
  console.log('  loaded', stocks.length, 'stocks');
  const evaluated = evaluateAll(stocks);
  console.log('  evaluated all methods');

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
module.exports = { eligibleForMode, topByMethod, topAllMust, evaluateAll };
