#!/usr/bin/env node
/**
 * Tag 106: Modes-Report — Premium-Design (FT/Bloomberg-Stil) + Filter-Strict
 * ===========================================================================
 * - Tiefes Anthrazit mit Pergament-Off-White, Champagner-Akzent.
 * - Source Serif 4 für Headlines + Werte (Buchtypografie),
 *   Inter für Body (modern-clean).
 * - Weniger Card-Boxen, mehr Listings mit horizontaler Trennung.
 * - Filter strict: wenn IPO-Slider aktiv (>min), Stocks ohne IPO ausblenden.
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

function dedupeByCompany(evaluated) {
  function norm(s) {
    if (!s) return '';
    return String(s).toLowerCase()
      .replace(/[éèêë]/g, 'e')
      .replace(/[óòôö]/g, 'o')
      .replace(/[áàâä]/g, 'a')
      .replace(/\b(inc|corporation|corp|incorporated|company|co|ltd|limited|plc|sa|a\/s|ag|nv|holdings|holding|group|grp|sarl|spa|n\.v\.)\b/gi, '')
      .replace(/[^a-z0-9]+/g, '')
      .trim();
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

  const ipoTag = ipoYear ? `<span class="meta-tag">IPO ${ipoYear}</span>` : '';
  const valBlock = sortValStr
    ? `<div class="row-val">${escHtml(sortValStr)}<span class="row-val-unit">${escHtml(sortLabel)}</span></div>`
    : '';

  return `<article class="row" data-prof-state="${profState}" data-mcap="${Math.round(mcap||0)}" data-ipo="${ipoYear||0}">
    <div class="row-head">
      <div class="row-id">
        <div class="row-rank">${String(i+1).padStart(2,'0')}</div>
        <div class="row-name">
          <div class="row-ticker">${escHtml(ticker)}</div>
          <div class="row-company">${escHtml(name.slice(0, 48))}${name.length>48?'…':''}</div>
        </div>
      </div>
      <div class="row-meta-block">
        ${valBlock}
        <div class="row-mcap">${fmtMoney(mcap)}</div>
      </div>
    </div>
    <div class="row-tags">
      <span class="meta-tag">${escHtml(sector || '—')}</span>
      <span class="meta-tag ${psClass}">${escHtml(psLabel)}</span>
      ${ipoTag}
    </div>
    <ul class="row-facts">${factsHtml}</ul>
    ${warningHtml}
  </article>`;
}

function renderModeSection(modeId, eligible, evaluated, topN) {
  const mode = SM.MODES[modeId];
  const evidenceClass = mode.evidence === 'literaturgestuetzt' ? 'ev-lit'
                     : mode.evidence === 'heuristisch' ? 'ev-heur' : 'ev-exp';
  const dotClass = modeId === 'HYPERGROWTH' ? 'dot-hg' : modeId === 'QUALITY_COMPOUNDER' ? 'dot-qc' : 'dot-ta';

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
    return `<section class="mode-section">${headerHtml}<div class="mode-disabled">Modus in Phase 2 — noch nicht aktiv.</div></section>`;
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
        ? `<div class="empty">Keine Stocks erfüllen alle MUST-Kriterien.</div>`
        : `<div class="row-list">${list.map((ev,i) => renderCard(ev, i, modeId, null)).join('')}</div>`;
    } else {
      const methodMeta = Runner.METHODS.find(m => m.id === tabId);
      const list = topByMethod(eligible, tabId, methodMeta, topN);
      cardsBlock = list.length === 0
        ? `<div class="empty">Keine Stocks mit computable Werten für diese Methode.</div>`
        : `<div class="row-list">${list.map((ev,i) => renderCard(ev, i, modeId, tabId)).join('')}</div>`;
    }
    const visible = tabId === defaultTab ? '' : 'display:none;';
    return `<div class="tab-panel" data-mode="${modeId}" data-tab="${escHtml(tabId)}" style="${visible}">${cardsBlock}</div>`;
  }).join('');

  const ipos = eligible.map(e => e.ipoYear || 0).filter(Boolean);
  const ipoMin = ipos.length ? Math.min(...ipos) : 1980;
  const ipoMax = ipos.length ? Math.max(...ipos) : new Date().getFullYear();

  const filtersHtml = `
    <div class="filters" data-mode="${modeId}" data-ipo-default="${ipoMin}">
      <div class="f-row">
        <span class="f-label">Profitabilität</span>
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
        <button class="reset-btn" data-mode="${modeId}">Reset Filter</button>
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
<title>Stock-Screener · Modes-Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Source+Serif+4:ital,opsz,wght@0,8..60,300;0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0e0f12;
    --bg-2: #14161a;
    --bg-3: #1a1d22;
    --bg-4: #232830;
    --line: #232830;
    --line-soft: #1a1d22;
    --paper: #e8e2d2;
    --paper-mute: #b8b2a3;
    --paper-faint: #7e7a6e;
    --paper-dim: #4f4d46;
    --champagne: #c4a96e;
    --champagne-soft: #2a2418;
    --champagne-deep: #b09554;
    --gold: #d4b878;
    --sage: #8fa284;
    --sage-soft: #1f2a1f;
    --slate: #7a8aa3;
    --slate-soft: #1d242e;
    --warning: #c69a5a;
    --warning-soft: #2a2018;
    --loss: #b56c66;
    --loss-soft: #2a1614;
    --turnaround: #c69a5a;
    --turnaround-soft: #2a2018;
    --recent: #98aa7a;
    --recent-soft: #1e2418;
    --stable: #76a48e;
    --stable-soft: #15241e;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { background: var(--bg); }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-2) 100%);
    background-attachment: fixed;
    color: var(--paper);
    font-size: 15px; line-height: 1.6;
    font-weight: 400;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
    font-feature-settings: 'kern', 'liga', 'calt';
  }
  .wrap { max-width: 1140px; margin: 0 auto; padding: 72px 40px 96px; }

  .doc-header { margin-bottom: 56px; padding-bottom: 36px; border-bottom: 1px solid var(--line); }
  .eyebrow { font-size: 11px; font-weight: 500; letter-spacing: 0.18em; text-transform: uppercase; color: var(--champagne); margin-bottom: 18px; }
  h1 {
    font-family: 'Source Serif 4', Georgia, serif;
    font-size: 48px; font-weight: 400; line-height: 1.08;
    letter-spacing: -0.018em; color: var(--paper);
    margin-bottom: 16px;
  }
  .sub { font-size: 15px; color: var(--paper-mute); max-width: 680px; line-height: 1.65; font-weight: 300; }

  .status-strip {
    display: grid; grid-template-columns: repeat(4, 1fr);
    margin-bottom: 40px;
    border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
  }
  .status-cell {
    padding: 22px 24px; border-right: 1px solid var(--line-soft);
  }
  .status-cell:last-child { border-right: none; }
  .status-label { font-size: 10px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: var(--paper-faint); margin-bottom: 8px; }
  .status-value {
    font-family: 'Source Serif 4', serif; font-size: 32px; font-weight: 400;
    color: var(--paper); font-feature-settings: 'tnum'; line-height: 1; letter-spacing: -0.01em;
  }
  .status-sub { font-size: 11.5px; color: var(--paper-mute); margin-top: 6px; font-weight: 300; }
  @media (max-width: 720px) { .status-strip { grid-template-columns: repeat(2, 1fr); } }

  .disclaimer {
    background: var(--champagne-soft); border-left: 2px solid var(--champagne);
    padding: 16px 22px; border-radius: 2px; margin-bottom: 56px;
    color: var(--gold); font-size: 13px; line-height: 1.65; font-weight: 300;
  }
  .disclaimer strong { color: var(--champagne); font-weight: 500; }

  .mode-section { margin-bottom: 64px; }
  .mode-header { display: flex; align-items: baseline; justify-content: space-between; gap: 20px; margin-bottom: 8px; }
  .mode-title { display: flex; align-items: center; gap: 14px; }
  .mode-title h2 {
    font-family: 'Source Serif 4', serif; font-size: 32px; font-weight: 400;
    letter-spacing: -0.012em; color: var(--paper);
  }
  .mode-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .dot-hg { background: var(--champagne); }
  .dot-qc { background: var(--slate); }
  .dot-ta { background: var(--sage); }
  .ev-pill {
    font-size: 10px; font-weight: 500; padding: 3px 9px; border-radius: 1px;
    letter-spacing: 0.1em; text-transform: uppercase;
  }
  .ev-pill.ev-lit { background: transparent; color: var(--sage); border: 1px solid var(--sage); }
  .ev-pill.ev-heur { background: transparent; color: var(--champagne); border: 1px solid var(--champagne); }
  .ev-pill.ev-exp { background: transparent; color: var(--slate); border: 1px solid var(--slate); }
  .mode-count { font-size: 12.5px; color: var(--paper-mute); font-feature-settings: 'tnum'; font-weight: 300; }
  .mode-desc {
    color: var(--paper-mute); font-size: 14.5px;
    margin-bottom: 28px; font-weight: 300;
    max-width: 640px; line-height: 1.65;
  }
  .mode-disabled {
    border: 1px dashed var(--line); padding: 28px;
    text-align: center; color: var(--paper-faint); font-size: 13px; font-style: italic;
  }

  .filters {
    padding: 18px 22px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    margin-bottom: 24px;
    display: grid; gap: 14px;
  }
  .f-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .f-label {
    font-size: 10px; font-weight: 500; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--paper-faint);
    margin-right: 10px; min-width: 100px;
  }
  .ps-btn {
    background: transparent; border: 1px solid var(--line);
    padding: 5px 14px; border-radius: 1px;
    font: inherit; font-size: 12px; font-weight: 400;
    cursor: pointer; color: var(--paper-mute);
    transition: all 0.15s; letter-spacing: 0.01em;
  }
  .ps-btn:hover { border-color: var(--paper-faint); color: var(--paper); }
  .ps-btn.ps-active { background: var(--paper); color: var(--bg); border-color: var(--paper); font-weight: 500; }
  .ps-btn.ps-loss.ps-active { background: var(--loss); border-color: var(--loss); color: var(--bg); }
  .ps-btn.ps-turnaround.ps-active { background: var(--turnaround); border-color: var(--turnaround); color: var(--bg); }
  .ps-btn.ps-recent.ps-active { background: var(--recent); border-color: var(--recent); color: var(--bg); }
  .ps-btn.ps-stable.ps-active { background: var(--stable); border-color: var(--stable); color: var(--bg); }

  .range-input {
    -webkit-appearance: none; appearance: none;
    background: transparent;
    width: 160px; height: 16px;
  }
  .range-input::-webkit-slider-runnable-track { background: var(--line); height: 1px; }
  .range-input::-moz-range-track { background: var(--line); height: 1px; }
  .range-input::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 11px; height: 11px; border-radius: 50%;
    background: var(--champagne); border: none;
    margin-top: -5px; cursor: pointer;
    transition: background 0.12s, transform 0.12s;
  }
  .range-input::-webkit-slider-thumb:hover { background: var(--gold); transform: scale(1.2); }
  .range-input::-moz-range-thumb {
    width: 11px; height: 11px; border-radius: 50%;
    background: var(--champagne); border: none; cursor: pointer;
  }
  .slider-val {
    font-family: 'Source Serif 4', serif;
    font-feature-settings: 'tnum'; font-size: 13.5px; color: var(--paper);
    font-weight: 400; min-width: 56px; display: inline-block;
  }
  .slider-sep { color: var(--paper-faint); font-size: 11px; }
  .reset-btn {
    background: transparent; border: 1px solid var(--line);
    padding: 5px 14px; border-radius: 1px;
    font: inherit; font-size: 11px; color: var(--paper-mute);
    cursor: pointer; margin-left: auto;
    text-transform: uppercase; letter-spacing: 0.1em;
    transition: all 0.15s;
  }
  .reset-btn:hover { border-color: var(--champagne); color: var(--champagne); }

  .tabs {
    display: flex; gap: 0; flex-wrap: wrap;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--line);
  }
  .tab-btn {
    background: transparent; border: none;
    padding: 12px 18px; border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    font: inherit; font-size: 13px; font-weight: 400;
    color: var(--paper-mute); cursor: pointer;
    transition: all 0.15s; letter-spacing: 0.005em;
  }
  .tab-btn:hover { color: var(--paper); }
  .tab-btn.tab-active { color: var(--paper); border-bottom-color: var(--champagne); font-weight: 500; }

  /* Listings statt Cards */
  .row-list { display: flex; flex-direction: column; }
  .row {
    padding: 22px 0;
    border-bottom: 1px solid var(--line-soft);
    transition: background 0.15s;
  }
  .row:last-child { border-bottom: none; }
  .row:hover { background: var(--bg-2); }
  .row-head {
    display: grid; grid-template-columns: 1fr auto;
    gap: 24px; align-items: baseline; margin-bottom: 12px;
  }
  .row-id { display: grid; grid-template-columns: 36px 1fr; gap: 18px; align-items: baseline; }
  .row-rank {
    font-family: 'Source Serif 4', serif;
    font-size: 14px; font-weight: 400; color: var(--paper-faint);
    font-feature-settings: 'tnum'; font-style: italic;
  }
  .row-name { min-width: 0; }
  .row-ticker {
    font-family: 'Source Serif 4', serif;
    font-size: 22px; font-weight: 500; color: var(--paper);
    font-feature-settings: 'tnum'; letter-spacing: 0;
    line-height: 1.1;
  }
  .row-company {
    font-size: 13px; color: var(--paper-mute);
    margin-top: 3px; line-height: 1.4; font-weight: 300;
  }
  .row-meta-block { text-align: right; }
  .row-val {
    font-family: 'Source Serif 4', serif;
    font-size: 26px; font-weight: 400; color: var(--champagne);
    font-feature-settings: 'tnum'; line-height: 1; letter-spacing: -0.01em;
  }
  .row-val-unit {
    display: block; font-family: 'Inter', sans-serif;
    font-size: 10px; color: var(--paper-faint);
    margin-top: 5px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 400;
  }
  .row-mcap {
    font-size: 12.5px; color: var(--paper-faint);
    margin-top: 8px; font-feature-settings: 'tnum';
  }

  .row-tags { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 10px 54px; }
  .meta-tag {
    font-size: 10.5px; font-weight: 400; padding: 3px 10px;
    background: var(--bg-3); color: var(--paper-mute);
    letter-spacing: 0.02em;
  }
  .pst-loss { background: var(--loss-soft); color: var(--loss); }
  .pst-turnaround { background: var(--turnaround-soft); color: var(--turnaround); }
  .pst-recent { background: var(--recent-soft); color: var(--recent); }
  .pst-stable { background: var(--stable-soft); color: var(--stable); }
  .pst-na { background: var(--bg-3); color: var(--paper-faint); }

  .row-facts { list-style: none; padding: 0; margin: 0 0 0 54px; }
  .row-facts li {
    font-size: 13.5px; color: var(--paper-mute); line-height: 1.6;
    padding: 1px 0 1px 16px; position: relative; font-weight: 300;
  }
  .row-facts li::before {
    content: '·'; color: var(--champagne); position: absolute; left: 4px;
    font-weight: 600; font-size: 16px; line-height: 1;
  }
  .row-facts li.muted { color: var(--paper-faint); font-style: italic; }
  .row-facts li.muted::before { content: ''; }
  .card-warn {
    margin: 12px 0 0 54px; padding: 8px 12px;
    background: var(--warning-soft); color: var(--warning);
    font-size: 12px; line-height: 1.5; font-weight: 300;
    border-left: 2px solid var(--warning);
  }

  .empty {
    padding: 48px; text-align: center;
    color: var(--paper-faint); font-size: 13.5px; font-style: italic;
    border: 1px dashed var(--line);
  }

  footer {
    margin-top: 80px; padding-top: 32px;
    border-top: 1px solid var(--line);
    font-size: 12px; color: var(--paper-faint);
    display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px;
    font-weight: 300;
  }
</style>
</head>
<body>
<div class="wrap">

  <header class="doc-header">
    <div class="eyebrow">Modes-Report &middot; ${escHtml(dateLabel)}</div>
    <h1>Drei Strategien, klare Story-Cards.</h1>
    <p class="sub">Discovery-Filter über ${totalStocks.toLocaleString('de-DE')} Stocks. Banks, REITs, Insurance sowie Mining, Materials und Oil &amp; Gas werden automatisch ausgeschlossen. DataGuards filtern Earnings-Manipulation, Solvenz-Risiken und Reverse-Mergers.</p>
  </header>

  <div class="status-strip">
    <div class="status-cell">
      <div class="status-label">Universum</div>
      <div class="status-value">${totalStocks.toLocaleString('de-DE')}</div>
      <div class="status-sub">Stocks gepullt</div>
    </div>
    <div class="status-cell">
      <div class="status-label">Sektor-Exclude</div>
      <div class="status-value">${sectorExcluded.toLocaleString('de-DE')}</div>
      <div class="status-sub">Banks · REITs · Mining · Oil &amp; Gas</div>
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
    const root = document.querySelector('.filters[data-mode="' + mode + '"]');
    if (!root) return;
    const ipoDefault = parseFloat(root.dataset.ipoDefault || '1980');
    const activePs = root.querySelector('.ps-btn.ps-active');
    const pstate = activePs ? activePs.dataset.pstate : 'ALL';
    const mcapMin = parseFloat(root.querySelector('[data-slider="mcap-min"].range-input').value) * 1e9;
    const mcapMax = parseFloat(root.querySelector('[data-slider="mcap-max"].range-input').value) * 1e9;
    const ipoMin = parseFloat(root.querySelector('[data-slider="ipo-min"].range-input').value);
    const ipoActive = ipoMin > ipoDefault;  // wenn slider ueber default min, aktiv

    document.querySelectorAll('.tab-panel[data-mode="' + mode + '"] .row').forEach(card => {
      const ps = card.dataset.profState;
      const mcap = parseFloat(card.dataset.mcap) || 0;
      const ipo = parseFloat(card.dataset.ipo) || 0;
      const psOk = pstate === 'ALL' || ps === pstate;
      const mcapOk = mcap >= mcapMin && mcap <= mcapMax;
      // Tag 106: wenn IPO-Filter aktiv UND Stock hat keine IPO-Daten → ausblenden
      const ipoOk = !ipoActive ? true : (ipo > 0 && ipo >= ipoMin);
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
