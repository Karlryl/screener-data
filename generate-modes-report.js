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
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400;500&family=Source+Serif+4:ital,opsz,wght@0,8..60,300;0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0a0b0d;
    --bg-2: #0f1114;
    --bg-3: #14171c;
    --bg-4: #1c2027;
    --line: #1c2027;
    --line-soft: #14171c;
    --hairline: #2a2f38;
    --paper: #ebe4d2;
    --paper-mute: #b8b1a0;
    --paper-faint: #7a766a;
    --paper-dim: #4a4842;
    --champagne: #d4b878;
    --champagne-soft: #2c2519;
    --champagne-deep: #b59653;
    --gold: #e0c890;
    --sage: #a3b693;
    --sage-soft: #1c2519;
    --slate: #8a98ad;
    --slate-soft: #1a2129;
    --warning: #d4a368;
    --warning-soft: #2a1f12;
    --loss: #c47a72;
    --loss-soft: #2c1815;
    --turnaround: #d4a368;
    --turnaround-soft: #2a1f12;
    --recent: #aabb88;
    --recent-soft: #1f2618;
    --stable: #82b8a0;
    --stable-soft: #15261f;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { background: var(--bg); }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background:
      radial-gradient(ellipse 1200px 800px at 50% -10%, rgba(212,184,120,0.06), transparent 60%),
      linear-gradient(180deg, var(--bg) 0%, var(--bg-2) 100%);
    background-attachment: fixed;
    color: var(--paper);
    font-size: 15px; line-height: 1.65;
    font-weight: 400;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
    font-feature-settings: 'kern', 'liga', 'calt', 'ss01';
  }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 96px 48px 120px; }

  /* Hero */
  .doc-header { margin-bottom: 80px; }
  .eyebrow {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 11px; font-weight: 400; letter-spacing: 0.2em;
    text-transform: uppercase; color: var(--champagne); margin-bottom: 28px;
    display: inline-block; padding-bottom: 0;
  }
  h1 {
    font-family: 'Source Serif 4', Georgia, serif;
    font-size: clamp(40px, 6vw, 64px); font-weight: 300; line-height: 1.04;
    letter-spacing: -0.025em; color: var(--paper); margin-bottom: 24px;
    max-width: 880px;
    font-feature-settings: 'ss01';
  }
  h1 em { font-style: italic; color: var(--champagne); font-weight: 300; }
  .sub {
    font-size: 16px; color: var(--paper-mute); max-width: 620px;
    line-height: 1.7; font-weight: 300;
  }

  /* Status — minimaler, ohne Outer-Border, hairline only */
  .status-strip {
    display: grid; grid-template-columns: repeat(4, 1fr);
    margin: 64px 0 56px;
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
  }
  .status-cell { padding: 28px 28px 24px; border-right: 1px solid var(--line-soft); }
  .status-cell:last-child { border-right: none; }
  .status-label {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 10px; font-weight: 400; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--paper-faint); margin-bottom: 14px;
  }
  .status-value {
    font-family: 'Source Serif 4', serif; font-size: 38px; font-weight: 300;
    color: var(--paper); font-feature-settings: 'tnum'; line-height: 1; letter-spacing: -0.02em;
  }
  .status-sub {
    font-size: 11.5px; color: var(--paper-mute); margin-top: 10px; font-weight: 300;
    font-family: 'JetBrains Mono', monospace; letter-spacing: 0.02em;
  }
  @media (max-width: 720px) { .status-strip { grid-template-columns: repeat(2, 1fr); } }

  /* Disclaimer — minimal, kein Border-Box */
  .disclaimer {
    padding: 18px 0 18px 24px; margin-bottom: 80px;
    border-left: 1px solid var(--champagne);
    color: var(--gold); font-size: 13.5px; line-height: 1.7; font-weight: 300;
    max-width: 720px;
  }
  .disclaimer strong { color: var(--champagne); font-weight: 400; }

  /* Mode-Section: kein Container, nur große Typo */
  .mode-section { margin-bottom: 96px; }
  .mode-header {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 24px; margin-bottom: 12px;
  }
  .mode-title { display: flex; align-items: center; gap: 18px; }
  .mode-title h2 {
    font-family: 'Source Serif 4', serif; font-size: 38px; font-weight: 300;
    letter-spacing: -0.018em; color: var(--paper);
  }
  .mode-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .dot-hg { background: var(--champagne); }
  .dot-qc { background: var(--slate); }
  .dot-ta { background: var(--sage); }
  .ev-pill {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; font-weight: 400; padding: 4px 10px;
    letter-spacing: 0.14em; text-transform: uppercase;
    background: transparent;
  }
  .ev-pill.ev-lit { color: var(--sage); border: 1px solid var(--sage); }
  .ev-pill.ev-heur { color: var(--champagne); border: 1px solid var(--champagne); }
  .ev-pill.ev-exp { color: var(--slate); border: 1px solid var(--slate); }
  .mode-count {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; color: var(--paper-mute); letter-spacing: 0.04em;
  }
  .mode-desc {
    color: var(--paper-mute); font-size: 15px;
    margin-bottom: 36px; font-weight: 300;
    max-width: 680px; line-height: 1.7;
  }
  .mode-disabled {
    border-top: 1px solid var(--hairline); padding: 40px 0;
    text-align: center; color: var(--paper-faint); font-size: 13px; font-style: italic;
  }

  /* Filters — kein Container, hairline-Trennung */
  .filters {
    padding: 18px 0;
    border-top: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline);
    margin-bottom: 32px;
    display: grid; gap: 16px;
  }
  .f-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .f-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; font-weight: 400; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--paper-faint);
    margin-right: 14px; min-width: 110px;
  }
  .ps-btn {
    background: transparent; border: none;
    padding: 5px 14px; border-radius: 0;
    font: inherit; font-size: 12.5px; font-weight: 400;
    cursor: pointer; color: var(--paper-mute);
    transition: all 0.18s; letter-spacing: 0.005em;
    border-bottom: 1px solid transparent;
  }
  .ps-btn:hover { color: var(--paper); }
  .ps-btn.ps-active { color: var(--champagne); border-bottom-color: var(--champagne); font-weight: 500; }
  .ps-btn.ps-loss.ps-active { color: var(--loss); border-bottom-color: var(--loss); }
  .ps-btn.ps-turnaround.ps-active { color: var(--turnaround); border-bottom-color: var(--turnaround); }
  .ps-btn.ps-recent.ps-active { color: var(--recent); border-bottom-color: var(--recent); }
  .ps-btn.ps-stable.ps-active { color: var(--stable); border-bottom-color: var(--stable); }

  .range-input {
    -webkit-appearance: none; appearance: none;
    background: transparent; width: 180px; height: 14px;
  }
  .range-input::-webkit-slider-runnable-track { background: var(--hairline); height: 1px; }
  .range-input::-moz-range-track { background: var(--hairline); height: 1px; }
  .range-input::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--champagne); border: none;
    margin-top: -4.5px; cursor: pointer;
    transition: all 0.15s;
  }
  .range-input::-webkit-slider-thumb:hover { background: var(--gold); transform: scale(1.3); }
  .range-input::-moz-range-thumb {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--champagne); border: none; cursor: pointer;
  }
  .slider-val {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12.5px; color: var(--paper); font-weight: 400;
    min-width: 56px; display: inline-block;
    font-variant-numeric: tabular-nums;
  }
  .slider-sep { color: var(--paper-faint); font-size: 12px; }
  .reset-btn {
    background: transparent; border: 1px solid var(--hairline);
    padding: 5px 14px; border-radius: 0;
    font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--paper-mute);
    cursor: pointer; margin-left: auto;
    text-transform: uppercase; letter-spacing: 0.14em;
    transition: all 0.18s;
  }
  .reset-btn:hover { border-color: var(--champagne); color: var(--champagne); }

  /* Tabs — sehr clean, nur underline */
  .tabs {
    display: flex; gap: 0; flex-wrap: wrap;
    margin-bottom: 32px;
    border-bottom: 1px solid var(--hairline);
  }
  .tab-btn {
    background: transparent; border: none;
    padding: 14px 20px; border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    font: inherit; font-size: 13px; font-weight: 400;
    color: var(--paper-mute); cursor: pointer;
    transition: all 0.18s; letter-spacing: 0;
  }
  .tab-btn:first-child { padding-left: 0; }
  .tab-btn:hover { color: var(--paper); }
  .tab-btn.tab-active { color: var(--paper); border-bottom-color: var(--champagne); font-weight: 500; }

  /* Listings — ultra-clean, Editorial */
  .row-list { display: flex; flex-direction: column; }
  .row {
    padding: 28px 0;
    border-bottom: 1px solid var(--line-soft);
    transition: background 0.2s;
  }
  .row:last-child { border-bottom: none; }
  .row:hover { background: rgba(212,184,120,0.025); }
  .row-head {
    display: grid; grid-template-columns: 1fr auto;
    gap: 32px; align-items: baseline; margin-bottom: 14px;
  }
  .row-id { display: grid; grid-template-columns: 44px 1fr; gap: 22px; align-items: baseline; }
  .row-rank {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; font-weight: 400; color: var(--paper-faint);
    font-variant-numeric: tabular-nums; letter-spacing: 0.08em;
  }
  .row-name { min-width: 0; }
  .row-ticker {
    font-family: 'Source Serif 4', serif;
    font-size: 26px; font-weight: 400; color: var(--paper);
    font-feature-settings: 'tnum'; letter-spacing: -0.005em;
    line-height: 1.05;
  }
  .row-company {
    font-size: 13.5px; color: var(--paper-mute);
    margin-top: 5px; line-height: 1.5; font-weight: 300;
  }
  .row-meta-block { text-align: right; }
  .row-val {
    font-family: 'Source Serif 4', serif;
    font-size: 32px; font-weight: 300; color: var(--champagne);
    font-feature-settings: 'tnum'; line-height: 1; letter-spacing: -0.018em;
  }
  .row-val-unit {
    display: block; font-family: 'JetBrains Mono', monospace;
    font-size: 10px; color: var(--paper-faint);
    margin-top: 7px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 400;
  }
  .row-mcap {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px; color: var(--paper-faint);
    margin-top: 10px; font-variant-numeric: tabular-nums; letter-spacing: 0.04em;
  }

  .row-tags { display: flex; gap: 10px; flex-wrap: wrap; margin: 0 0 12px 66px; }
  .meta-tag {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; font-weight: 400; padding: 3px 10px;
    color: var(--paper-mute); border: 1px solid var(--line);
    letter-spacing: 0.04em; text-transform: uppercase;
  }
  .pst-loss { color: var(--loss); border-color: var(--loss); }
  .pst-turnaround { color: var(--turnaround); border-color: var(--turnaround); }
  .pst-recent { color: var(--recent); border-color: var(--recent); }
  .pst-stable { color: var(--stable); border-color: var(--stable); }
  .pst-na { color: var(--paper-faint); border-color: var(--line); }

  .row-facts { list-style: none; padding: 0; margin: 0 0 0 66px; }
  .row-facts li {
    font-size: 14px; color: var(--paper-mute); line-height: 1.65;
    padding: 2px 0 2px 18px; position: relative; font-weight: 300;
  }
  .row-facts li::before {
    content: '·'; color: var(--champagne); position: absolute; left: 4px;
    font-weight: 600; font-size: 16px; line-height: 1;
  }
  .row-facts li.muted { color: var(--paper-faint); font-style: italic; }
  .row-facts li.muted::before { content: ''; }
  .card-warn {
    margin: 14px 0 0 66px; padding: 9px 14px;
    background: var(--warning-soft); color: var(--warning);
    font-size: 12.5px; line-height: 1.55; font-weight: 300;
    border-left: 1px solid var(--warning);
  }

  .empty {
    padding: 64px 32px; text-align: center;
    color: var(--paper-faint); font-size: 14px; font-style: italic;
    border-top: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline);
  }

  footer {
    margin-top: 96px; padding-top: 36px;
    border-top: 1px solid var(--hairline);
    font-size: 11.5px; color: var(--paper-faint);
    display: flex; justify-content: space-between; flex-wrap: wrap; gap: 14px;
    font-weight: 300; font-family: 'JetBrains Mono', monospace;
    letter-spacing: 0.02em;
  }
</style>
</head>
<body>
<div class="wrap">

  <header class="doc-header">
    <div class="eyebrow">Modes-Report &middot; ${escHtml(dateLabel)}</div>
    <h1>Drei Strategien, <em>klare</em> Story-Cards.</h1>
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
