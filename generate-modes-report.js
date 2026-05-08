#!/usr/bin/env node
/**
 * Tag 103c: Modes-Report Generator — Claude-Design
 * =================================================
 * Cream-Hintergrund, Coral-Akzent, Sage/Slate sekundär.
 * Inter (sans) + Source Serif 4 (Headlines).
 * Cleaner Card-Style, generous whitespace, Pillen-basierte Filter.
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
    return { stock, allResults, mcap };
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

// ── Card-Render: Cream-Style ──────────────────────────
const PSTATE_LABEL = { LOSS:'Loss', TURNAROUND:'Turnaround', RECENT:'Recent', STABLE:'Stable', NA:'—' };
const PSTATE_CLASS = { LOSS:'pst-loss', TURNAROUND:'pst-turnaround', RECENT:'pst-recent', STABLE:'pst-stable', NA:'pst-na' };

function renderCard(ev, i, modeId, sortMethodId) {
  const s = ev.stock;
  const ticker = (s.meta && s.meta.ticker) || '???';
  const name = (s.meta && s.meta.name) || '';
  const sector = (s.meta && s.meta.sector) || '';
  const mcap = ev.mcap;

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
    if (story.warnings) {
      warningHtml = `<div class="card-warn">${escHtml(story.warnings)}</div>`;
    }
  } else {
    factsHtml = `<li class="muted">Erfüllt nicht alle MUST-Kriterien dieses Modus</li>`;
  }

  const valBlock = sortValStr
    ? `<div class="card-val">${escHtml(sortValStr)}</div><div class="card-val-label">${escHtml(sortLabel)}</div>`
    : '';

  return `
    <article class="card" data-prof-state="${profState}">
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
    return headerHtml + `<div class="mode-disabled">Modus in Phase 2 — noch nicht aktiv. Erst Hypergrowth + Quality validieren, dann Turnaround.</div>`;
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

  const profStateFilterHtml = `
    <div class="ps-filter" data-mode="${modeId}">
      <span class="ps-label">Profitabilität</span>
      <button class="ps-btn ps-active" data-mode="${modeId}" data-pstate="ALL">Alle</button>
      <button class="ps-btn ps-loss" data-mode="${modeId}" data-pstate="LOSS">Loss</button>
      <button class="ps-btn ps-turnaround" data-mode="${modeId}" data-pstate="TURNAROUND">Turnaround</button>
      <button class="ps-btn ps-recent" data-mode="${modeId}" data-pstate="RECENT">Recent</button>
      <button class="ps-btn ps-stable" data-mode="${modeId}" data-pstate="STABLE">Stable</button>
    </div>`;

  return `<section class="mode-section">
    ${headerHtml}
    ${profStateFilterHtml}
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
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root {
    --cream: #faf7f2; --cream-2: #f4efe6; --cream-3: #ebe4d3;
    --ink: #1a1a1a; --ink-soft: #3d3a36; --ink-mute: #6b665e; --ink-faint: #97928a;
    --rule: #e6dfd2; --rule-soft: #efeadc;
    --coral: #cc785c; --coral-soft: #f0d9cf; --coral-deep: #a85a3f;
    --sage: #6d8c6e; --sage-soft: #d9e3da;
    --slate: #5a6478; --slate-soft: #dde0e6;
    --warning: #c47a2c; --warning-soft: #f5e3cc;
    --loss: #b8443c; --loss-soft: #f2d9d6;
    --turnaround: #c47a2c; --turnaround-soft: #f5e3cc;
    --recent: #7a9d4c; --recent-soft: #e0e8cf;
    --stable: #4a8567; --stable-soft: #d2e3da;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--cream); color: var(--ink);
    font-size: 15px; line-height: 1.5;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  .wrap { max-width: 1280px; margin: 0 auto; padding: 48px 32px 80px; }

  /* Header */
  .doc-header { margin-bottom: 40px; }
  .eyebrow { font-size: 12px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: var(--coral); margin-bottom: 12px; }
  h1 { font-family: 'Source Serif 4', Georgia, serif; font-size: 38px; font-weight: 600; line-height: 1.1; letter-spacing: -0.01em; margin-bottom: 10px; }
  .sub { font-size: 14px; color: var(--ink-mute); }

  /* Status-Strip */
  .status-strip {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px;
    background: var(--rule); border: 1px solid var(--rule);
    border-radius: 10px; overflow: hidden; margin-bottom: 28px;
  }
  .status-cell { background: var(--cream-2); padding: 16px 18px; }
  .status-label { font-size: 11px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-faint); margin-bottom: 4px; }
  .status-value { font-size: 22px; font-weight: 600; color: var(--ink); font-feature-settings: 'tnum'; line-height: 1.1; }
  .status-sub { font-size: 11px; color: var(--ink-mute); margin-top: 2px; }
  @media (max-width: 720px) { .status-strip { grid-template-columns: repeat(2, 1fr); } }

  /* Disclaimer */
  .disclaimer {
    background: var(--coral-soft); border-left: 3px solid var(--coral);
    padding: 14px 20px; border-radius: 8px; margin-bottom: 40px;
    color: var(--coral-deep); font-size: 13px; line-height: 1.55;
  }
  .disclaimer strong { color: var(--coral-deep); font-weight: 600; }

  /* Mode-Section */
  .mode-section {
    background: white; border: 1px solid var(--rule);
    border-radius: 12px; padding: 32px;
    margin-bottom: 32px;
  }
  .mode-header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 6px; }
  .mode-title { display: flex; align-items: center; gap: 12px; }
  .mode-title h2 { font-family: 'Source Serif 4', serif; font-size: 26px; font-weight: 600; letter-spacing: -0.005em; }
  .mode-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .mode-dot-hg { background: var(--coral); }
  .mode-dot-qc { background: var(--slate); }
  .mode-dot-ta { background: var(--sage); }
  .ev-pill { font-size: 11px; font-weight: 500; padding: 3px 10px; border-radius: 12px; letter-spacing: 0.02em; }
  .ev-pill.ev-lit { background: var(--sage-soft); color: var(--sage); }
  .ev-pill.ev-heur { background: var(--coral-soft); color: var(--coral-deep); }
  .ev-pill.ev-exp { background: var(--slate-soft); color: var(--slate); }
  .mode-count { font-size: 13px; color: var(--ink-mute); font-feature-settings: 'tnum'; }
  .mode-desc { color: var(--ink-mute); font-size: 14px; margin-bottom: 20px; }
  .mode-disabled {
    background: var(--cream-2); border: 1px dashed var(--rule);
    padding: 20px; text-align: center; border-radius: 8px;
    color: var(--ink-mute); font-size: 13px;
  }

  /* Profitability-Filter */
  .ps-filter {
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
    padding: 10px 14px; background: var(--cream-2);
    border-radius: 8px; margin-bottom: 16px;
  }
  .ps-label { font-size: 11px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-faint); margin-right: 4px; }
  .ps-btn {
    background: white; border: 1px solid var(--rule);
    padding: 5px 12px; border-radius: 14px;
    font: inherit; font-size: 12px; font-weight: 500;
    cursor: pointer; color: var(--ink-soft);
    transition: all 0.12s;
  }
  .ps-btn:hover { border-color: var(--ink-faint); }
  .ps-btn.ps-active { background: var(--ink); color: white; border-color: var(--ink); }
  .ps-btn.ps-loss.ps-active { background: var(--loss); border-color: var(--loss); }
  .ps-btn.ps-turnaround.ps-active { background: var(--turnaround); border-color: var(--turnaround); }
  .ps-btn.ps-recent.ps-active { background: var(--recent); border-color: var(--recent); }
  .ps-btn.ps-stable.ps-active { background: var(--stable); border-color: var(--stable); }

  /* Sub-Tabs */
  .tabs {
    display: flex; gap: 4px; flex-wrap: wrap;
    padding-bottom: 12px; margin-bottom: 16px;
    border-bottom: 1px solid var(--rule);
  }
  .tab-btn {
    background: transparent; border: none;
    padding: 8px 14px; border-radius: 6px;
    font: inherit; font-size: 13px; font-weight: 500;
    color: var(--ink-mute); cursor: pointer;
    transition: all 0.12s;
  }
  .tab-btn:hover { background: var(--cream-2); color: var(--ink); }
  .tab-btn.tab-active { background: var(--ink); color: white; }

  /* Card-Grid */
  .card-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }
  .card {
    background: var(--cream-2); border: 1px solid var(--rule);
    border-radius: 10px; padding: 16px 18px;
    transition: border-color 0.15s, transform 0.15s;
  }
  .card:hover { border-color: var(--coral); transform: translateY(-1px); }
  .card-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
  .card-id { flex: 1; min-width: 0; }
  .card-ticker { font-weight: 700; font-size: 16px; color: var(--ink); font-feature-settings: 'tnum'; }
  .card-name { font-size: 12px; color: var(--ink-mute); margin-top: 1px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-meta { text-align: right; flex-shrink: 0; }
  .card-val { font-size: 18px; font-weight: 700; color: var(--coral-deep); font-feature-settings: 'tnum'; line-height: 1; }
  .card-val-label { font-size: 10px; color: var(--ink-faint); margin-top: 2px; letter-spacing: 0.04em; }
  .card-rank { font-size: 11px; color: var(--ink-faint); margin-top: 4px; font-feature-settings: 'tnum'; }

  .card-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  .tag { font-size: 11px; font-weight: 500; padding: 2px 9px; border-radius: 10px; }
  .tag-sector { background: var(--cream-3); color: var(--ink-soft); }
  .pst-loss { background: var(--loss-soft); color: var(--loss); }
  .pst-turnaround { background: var(--turnaround-soft); color: var(--turnaround); }
  .pst-recent { background: var(--recent-soft); color: var(--recent); }
  .pst-stable { background: var(--stable-soft); color: var(--stable); }
  .pst-na { background: var(--cream-3); color: var(--ink-faint); }

  .card-facts { list-style: none; padding: 0; margin: 0; }
  .card-facts li {
    font-size: 12.5px; color: var(--ink-soft); line-height: 1.5;
    padding: 2px 0 2px 16px; position: relative;
  }
  .card-facts li::before {
    content: '✓'; color: var(--sage); position: absolute; left: 0;
    font-weight: 600; font-size: 11px;
  }
  .card-facts li.muted { color: var(--ink-faint); font-style: italic; }
  .card-facts li.muted::before { content: ''; }
  .card-warn {
    margin-top: 10px; padding: 8px 10px;
    background: var(--warning-soft); color: var(--warning);
    border-radius: 6px; font-size: 11.5px; line-height: 1.45;
  }

  .empty {
    background: var(--cream-2); border: 1px dashed var(--rule);
    padding: 32px; text-align: center; border-radius: 8px;
    color: var(--ink-mute); font-size: 13px;
  }

  /* Footer */
  footer {
    margin-top: 56px; padding-top: 24px;
    border-top: 1px solid var(--rule);
    font-size: 12px; color: var(--ink-faint);
    display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px;
  }
</style>
</head>
<body>
<div class="wrap">

  <header class="doc-header">
    <div class="eyebrow">Modes-Report · ${escHtml(dateLabel)}</div>
    <h1>Drei Strategien, klare Story-Cards.</h1>
    <p class="sub">Discovery-Filter über ${totalStocks} Stocks. Banks, REITs und Insurance fliegen automatisch raus. DataGuards filtern Earnings-Manipulation, Solvenz-Risiken und Reverse-Mergers.</p>
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
      <div class="status-sub">Banks · REITs · Insurance</div>
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
  // Profitability-State Quick-Filter
  document.addEventListener('click', function(e) {
    const t = e.target;

    if (t.classList && t.classList.contains('ps-btn')) {
      const mode = t.dataset.mode;
      const pstate = t.dataset.pstate;
      document.querySelectorAll('.ps-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('ps-active'));
      t.classList.add('ps-active');
      document.querySelectorAll('.tab-panel[data-mode="' + mode + '"] .card').forEach(card => {
        const ps = card.dataset.profState;
        const visible = pstate === 'ALL' || ps === pstate;
        card.style.display = visible ? '' : 'none';
      });
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
