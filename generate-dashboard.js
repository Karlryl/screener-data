#!/usr/bin/env node
'use strict';

/**
 * Tag 176: Dashboard v2 — Leaderboards per Mode & per Metric
 * ============================================================
 * Reads picks-history/latest.json + the freshest methods-history/YYYY-MM-DD.json
 * and emits a single self-contained dashboard.html with:
 *   - Mode leaderboards (HYPERGROWTH / QUALITY_COMPOUNDER / TURNAROUND), top 30 each
 *   - Metric leaderboards (Rule of 40, Rule of X, ROIC, FCF-Yield, Revenue Growth 3Y,
 *     Gross Margin, EV/EBITDA), top 25 each
 *   - Click ticker -> detail modal with all method scores, 4Q quarterly data, mini chart
 *   - Tier badges (A / B / NEAR_MISS / REJECT)
 *
 * Falls back to a minimal landing page if no picks or methods data exist (keeps CI green).
 */

const fs = require('fs');
const path = require('path');
// Tag 221c (audit F-GR-009 LOW fix): atomic main-output write.
const { writeFileAtomic } = require('./lib/atomic-write.js');

const REPO_OWNER = 'Karlryl';
const REPO_NAME = 'screener-data';
const WORKFLOW_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/actions/workflows/daily-pull.yml`;
const ACTIONS_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/actions`;
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;

const PICKS_LATEST = './picks-history/latest.json';
const METHODS_HISTORY_DIR = './methods-history';
const SNAPSHOTS_DIR = './snapshots';

const METRIC_LEADERBOARDS = [
  { id: 'rule-of-x',                label: 'Rule of X',           desc: '1.5×Growth + FCF-Marge',   sort: 'desc', fmt: 'num1'      },
  { id: 'rule-of-40',               label: 'Rule of 40',          desc: 'Growth + FCF-Marge',       sort: 'desc', fmt: 'num1'      },
  { id: 'revenue-growth-3y',        label: 'Revenue Growth 3Y',   desc: '3-Jahres-CAGR',            sort: 'desc', fmt: 'pct'       },
  { id: 'quality-compounder-roic',  label: 'ROIC',                desc: 'PreTax-ROIC',              sort: 'desc', fmt: 'pctRatio'  },
  { id: 'fcf-yield',                label: 'FCF-Yield',           desc: 'FCF / MarketCap',          sort: 'desc', fmt: 'pct'       },
  { id: 'gross-margin-stability',   label: 'Gross-Margin Quality',desc: '5Y GM-Stabilität (höher = besser)', sort: 'desc', fmt: 'num3' },
  { id: 'ev-ebitda',                label: 'EV/EBITDA',           desc: 'Bewertung (tief = günstig)',sort: 'asc', fmt: 'mult', positive: true }
];

const MODE_DEFINITIONS = [
  { id: 'HYPERGROWTH',         label: 'Hypergrowth',           color: '#10b981', icon: '🚀' },
  { id: 'QUALITY_COMPOUNDER',  label: 'Quality-Compounder',    color: '#3b82f6', icon: '💎' },
  { id: 'TURNAROUND',          label: 'Turnaround',            color: '#f59e0b', icon: '🔄' }
];

const TIER_STYLE = {
  A:         { bg: '#10b981', fg: '#022c22', label: 'A'  },
  B:         { bg: '#3b82f6', fg: '#0c1638', label: 'B'  },
  NEAR_MISS: { bg: '#a78bfa', fg: '#1e1b4b', label: 'NM' },
  REJECT:    { bg: '#475569', fg: '#0f172a', label: 'R'  }
};

// ----------- IO helpers -----------
function safeRead(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }
function safeJSON(p) { const t = safeRead(p); if (!t) return null; try { return JSON.parse(t); } catch (e) { return null; } }

function latestMethodsHistoryFile() {
  if (!fs.existsSync(METHODS_HISTORY_DIR)) return null;
  const files = fs.readdirSync(METHODS_HISTORY_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  return files.length ? path.join(METHODS_HISTORY_DIR, files[files.length - 1]) : null;
}

function tickerToSnapshotPath(ticker) {
  // pull-yahoo.js Windows-reserved fix: CON.DE → _CON.DE.json
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
  const fn = reserved.test(ticker) ? '_' + ticker + '.json' : ticker + '.json';
  return path.join(SNAPSHOTS_DIR, fn);
}

function readSnapshotMeta(ticker) {
  const s = safeJSON(tickerToSnapshotPath(ticker));
  if (!s) return null;
  const m = s.meta || {};
  return {
    name: m.name || m.longName || m.shortName || null,
    sector: m.sector || null,
    industry: m.industry || null
  };
}

// Read quarterly data for a single ticker — used by modal detail
function readQuarterly(ticker) {
  const s = safeJSON(tickerToSnapshotPath(ticker));
  if (!s) return null;
  const ts = s.timeseries || {};
  function pluck(arr) {
    if (!Array.isArray(arr)) return null;
    return arr.slice(0, 4).map(v => v == null ? null : (typeof v === 'number' ? v : v.value));
  }
  return {
    revenueQ: pluck(ts.revenueQ),
    opIncQ:   pluck(ts.opIncQ),
    grossProfitQ: pluck(ts.grossProfitQ),
    netIncomeQ: pluck(ts.netIncomeQ)
  };
}

// ----------- Data assembly -----------
function buildTickerNameMap(picks) {
  const map = Object.create(null);
  if (!picks || !picks.modes) return map;
  for (const modeId of Object.keys(picks.modes)) {
    for (const p of (picks.modes[modeId] || [])) {
      if (!map[p.ticker]) {
        map[p.ticker] = { name: p.name || null, sector: p.sector || null, industry: p.industry || null };
      }
    }
  }
  return map;
}

function buildMetricLeaderboard(methodsHistory, metricId, sortDir, topN) {
  if (!methodsHistory || !methodsHistory.stocks) return [];
  const arr = [];
  for (const ticker of Object.keys(methodsHistory.stocks)) {
    const data = methodsHistory.stocks[ticker];
    const r = data && data.results && data.results[metricId];
    if (!r || r.value == null || !Number.isFinite(r.value)) continue;
    // For ratio metrics where lower=better (EV/EBITDA), skip non-positive (companies with negative EBITDA).
    arr.push({
      ticker,
      value: r.value,
      pass: r.pass === true,
      sector: data.inputs && data.inputs.sector || null,
      marketCap: data.inputs && data.inputs.marketCapUsd || null
    });
  }
  arr.sort((a, b) => sortDir === 'asc' ? a.value - b.value : b.value - a.value);
  // For EV/EBITDA (asc): drop entries <=0 (negative EBITDA, mathematically meaningless)
  return arr.filter(e => sortDir === 'asc' ? e.value > 0 : true).slice(0, topN);
}

function buildDetailIndex(picks, methodsHistory, metricLeaderboards, nameMap) {
  const tickers = new Set();
  if (picks && picks.modes) {
    for (const m of Object.keys(picks.modes)) {
      for (const p of (picks.modes[m] || [])) tickers.add(p.ticker);
    }
  }
  for (const lb of metricLeaderboards) for (const e of lb.entries) tickers.add(e.ticker);

  const details = Object.create(null);
  for (const ticker of tickers) {
    const mh = methodsHistory && methodsHistory.stocks && methodsHistory.stocks[ticker];
    if (!mh) { details[ticker] = { results: {}, inputs: null, quarterly: null, meta: nameMap[ticker] || null }; continue; }
    details[ticker] = {
      results: mh.results || {},
      inputs: mh.inputs || null,
      quality: mh.quality || null,
      quarterly: readQuarterly(ticker),
      meta: nameMap[ticker] || readSnapshotMeta(ticker) || null
    };
  }
  return details;
}

// ----------- HTML generation -----------
function escapeHTML(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderFallback() {
  // Tag 221c (audit F-GR-007 fix): honor RUN_DATE_UTC if set.
  const buildStamp = process.env.RUN_DATE_UTC || new Date().toISOString().slice(0,16);
  return `<!DOCTYPE html><html lang="de"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Karl's Stock-Screener — Dashboard</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:40px;text-align:center}h1{color:#f1f5f9}a{color:#10b981}</style>
</head><body>
<h1>📊 Karl's Stock-Screener</h1>
<p>Pipeline läuft. Dashboard wird beim nächsten Run gefüllt.</p>
<p><a href="${WORKFLOW_URL}" target="_blank">▶ Discover starten</a> · <a href="${ACTIONS_URL}" target="_blank">⚙ Actions</a> · <a href="${REPO_URL}" target="_blank">📁 Repo</a></p>
<p style="color:#64748b;font-size:11px">Last build: ${buildStamp}Z</p>
</body></html>`;
}

function render(picks, methodsHistory) {
  const asOf = picks && picks.asOf ? picks.asOf.slice(0,16).replace('T',' ') + 'Z' : '—';
  const universeSize = picks && picks.universeSize ? picks.universeSize : (methodsHistory && methodsHistory.summary && methodsHistory.summary.totalStocks) || 0;
  const methodCount = methodsHistory && methodsHistory.summary && methodsHistory.summary.methodCount || 0;

  const nameMap = buildTickerNameMap(picks);

  const metricLeaderboards = METRIC_LEADERBOARDS.map(lb => ({
    ...lb,
    entries: buildMetricLeaderboard(methodsHistory, lb.id, lb.sort, 25)
  }));

  const details = buildDetailIndex(picks, methodsHistory, metricLeaderboards, nameMap);

  // Mode picks: take top 30 per mode (already sorted by score by upstream).
  const modePicks = Object.create(null);
  if (picks && picks.modes) {
    for (const md of MODE_DEFINITIONS) {
      const arr = picks.modes[md.id] || [];
      modePicks[md.id] = arr.slice(0, 30);
    }
  }

  // Embedded data payload for client-side modal lookup.
  const payload = {
    asOf, universeSize, methodCount,
    modePicks, metricLeaderboards,
    details
  };

  const dataJSON = JSON.stringify(payload).replace(/</g, '\\u003c');

  return `<!DOCTYPE html><html lang="de"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Karl's Stock-Screener — Dashboard</title>
<style>
* { box-sizing: border-box; }
:root {
  --bg-0: #0a0f1f;
  --bg-1: #111827;
  --bg-2: #1e293b;
  --bg-3: #2a3a52;
  --fg-0: #f8fafc;
  --fg-1: #e2e8f0;
  --fg-2: #94a3b8;
  --fg-3: #64748b;
  --line: #334155;
  --accent: #10b981;
  --accent-2: #3b82f6;
}
html, body { margin:0; padding:0; }
body { font-family: ui-sans-serif, -apple-system, system-ui, sans-serif; background: var(--bg-0); color: var(--fg-1); min-height:100vh; line-height:1.45; }
.wrap { max-width: 1280px; margin: 0 auto; padding: 28px 20px 60px; }
header { display:flex; flex-wrap:wrap; align-items:center; gap:16px; margin-bottom:24px; }
header h1 { color:var(--fg-0); font-size:24px; margin:0; flex:1; min-width:280px; }
header .meta { color:var(--fg-2); font-size:13px; }
header .meta strong { color: var(--fg-0); }
header .links a { color: var(--fg-2); text-decoration:none; margin-left:14px; font-size:13px; }
header .links a:hover { color: var(--accent); }
.tabs { display:flex; gap:4px; border-bottom:1px solid var(--line); margin-bottom:24px; flex-wrap:wrap; }
.tab { background:transparent; border:none; color:var(--fg-2); padding:12px 18px; font-size:14px; font-weight:600; cursor:pointer; border-bottom:2px solid transparent; transition: all .15s; }
.tab:hover { color: var(--fg-0); }
.tab.active { color: var(--fg-0); border-bottom-color: var(--accent); }
.section { display:none; }
.section.active { display:block; }
.grid-modes { display:grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap:18px; }
.grid-metrics { display:grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap:18px; }
.card { background: var(--bg-1); border:1px solid var(--line); border-radius: 10px; padding: 16px; }
.card h2 { margin: 0 0 12px; font-size: 16px; color: var(--fg-0); display:flex; align-items:center; gap:8px; }
.card h2 small { color: var(--fg-2); font-weight: 400; font-size: 11px; }
.card .count { background: var(--bg-3); color: var(--fg-1); padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 500; }
table.lb { width: 100%; border-collapse: collapse; font-size: 13px; }
table.lb td { padding: 7px 6px; border-top: 1px solid var(--bg-2); vertical-align: middle; }
table.lb tr:first-child td { border-top: 0; }
table.lb tr:hover td { background: var(--bg-2); }
table.lb td.rank { color: var(--fg-3); font-variant-numeric: tabular-nums; width:28px; }
table.lb td.tk { font-weight: 600; }
table.lb td.tk button { background:none; border:none; color: var(--fg-0); font-weight: 600; cursor:pointer; padding:0; font-size: 13px; font-family: inherit; }
table.lb td.tk button:hover { color: var(--accent); text-decoration: underline; }
table.lb td.name { color: var(--fg-2); font-size: 12px; }
table.lb td.val { text-align: right; font-variant-numeric: tabular-nums; color: var(--fg-0); font-weight: 600; white-space: nowrap; }
table.lb td.tier { text-align: right; width:42px; }
.tier-badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; }
.pass-dot { display:inline-block; width:6px; height:6px; border-radius:50%; background: var(--accent); margin-right:6px; vertical-align: middle; }
.pass-dot.fail { background: #475569; }
.pipeline-card { background: var(--bg-1); border: 1px solid var(--line); border-radius: 10px; padding: 22px; margin-bottom: 16px; }
.pipeline-card h2 { color: var(--fg-0); margin: 0 0 12px; }
.pipeline-card p { color: var(--fg-2); font-size: 13px; line-height:1.6; }
.pipeline-card .actions a { display:inline-block; background: var(--bg-3); color: var(--fg-1); text-decoration:none; padding: 10px 16px; border-radius: 8px; font-size:13px; margin: 4px 8px 4px 0; }
.pipeline-card .actions a.primary { background: linear-gradient(135deg, var(--accent), #059669); color: white; font-weight: 600; }
.pipeline-card .actions a:hover { filter: brightness(1.15); }
.empty { color: var(--fg-3); font-size: 13px; padding: 12px 0; }
/* Modal */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.72); display: none; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
.modal-backdrop.open { display:flex; }
.modal { background: var(--bg-1); border:1px solid var(--line); border-radius: 12px; max-width: 920px; width: 100%; max-height: 90vh; overflow-y:auto; }
.modal-head { display:flex; align-items:center; justify-content:space-between; padding:18px 22px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--bg-1); z-index:1; }
.modal-head h3 { margin:0; color:var(--fg-0); font-size:18px; }
.modal-head .sub { color: var(--fg-2); font-size: 12px; margin-top: 3px; }
.modal-close { background: var(--bg-3); color: var(--fg-0); border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: 600; }
.modal-body { padding: 20px 22px; }
.modal-body h4 { color: var(--fg-0); font-size: 13px; margin: 18px 0 8px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
.modal-grid-methods { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px; }
.method-row { display:flex; justify-content:space-between; padding: 6px 10px; background: var(--bg-2); border-radius: 6px; font-size: 12px; }
.method-row.pass { border-left: 3px solid var(--accent); }
.method-row.fail { border-left: 3px solid #475569; opacity: 0.85; }
.method-row.incomp { border-left: 3px solid var(--fg-3); opacity: 0.55; }
.method-row .mid { color: var(--fg-2); }
.method-row .val { color: var(--fg-0); font-variant-numeric: tabular-nums; font-weight: 600; }
.quarterly-table { width:100%; border-collapse: collapse; font-size:12px; margin-top:6px; }
.quarterly-table th { color:var(--fg-2); text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--line); font-weight: 500; }
.quarterly-table th:first-child { text-align:left; }
.quarterly-table td { padding: 6px 10px; border-bottom: 1px solid var(--bg-2); text-align: right; font-variant-numeric: tabular-nums; }
.quarterly-table td:first-child { text-align:left; color: var(--fg-2); }
.spark { display:inline-block; height: 20px; vertical-align: middle; }
.footer { color: var(--fg-3); font-size: 11px; margin-top: 36px; text-align:center; }
@media (max-width: 640px) {
  .wrap { padding: 16px 12px 40px; }
  header h1 { font-size: 20px; }
  header .links a { margin-left: 8px; font-size: 12px; }
  .tab { padding: 10px 12px; font-size: 13px; }
  table.lb td.name { display:none; }
  .modal-body { padding: 14px 16px; }
}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>📊 Karl's Stock-Screener</h1>
    <div class="meta">
      <strong>${universeSize.toLocaleString('de-DE')}</strong> Ticker · <strong>${methodCount}</strong> Methoden · Stand <strong>${escapeHTML(asOf)}</strong>
    </div>
    <div class="links">
      <a href="${WORKFLOW_URL}" target="_blank">▶ Discover</a>
      <a href="./methods-report.html">📋 Methods</a>
      <a href="./modes-report.html">🎯 Modes</a>
      <a href="./diff-report.html">🔄 Diff</a>
      <a href="${REPO_URL}" target="_blank">📁 Repo</a>
    </div>
  </header>

  <div class="tabs" id="tabs">
    <button class="tab active" data-tab="modes">🎯 Top per Modus</button>
    <button class="tab" data-tab="metrics">📐 Top per Kennzahl</button>
    <button class="tab" data-tab="pipeline">⚙️ Pipeline</button>
  </div>

  <section class="section active" id="section-modes"></section>
  <section class="section" id="section-metrics"></section>
  <section class="section" id="section-pipeline">
    <div class="pipeline-card">
      <h2>🔍 Discover-Flow</h2>
      <p>Klick auf <strong>Discover</strong> öffnet die GitHub-Action. Dort rechts oben „Run workflow" drücken. Nach 5–8 Min sind alle Reports aktualisiert (Yahoo-Pull, ${methodCount} Methoden, ${universeSize.toLocaleString('de-DE')} Ticker).</p>
      <div class="actions">
        <a class="primary" href="${WORKFLOW_URL}" target="_blank">▶ Discover starten</a>
        <a href="${ACTIONS_URL}" target="_blank">⚙ Actions</a>
        <a href="${REPO_URL}" target="_blank">📁 Repo</a>
      </div>
    </div>
    <div class="pipeline-card">
      <h2>📑 Reports</h2>
      <div class="actions">
        <a href="./methods-report.html">📋 Methods-Report (detailliert pro Stock)</a>
        <a href="./modes-report.html">🎯 Modes-Report (Stories pro Modus)</a>
        <a href="./diff-report.html">🔄 Diff-Report (Änderungen)</a>
      </div>
    </div>
    <div class="pipeline-card">
      <h2>📅 Schedule</h2>
      <p>Pipeline läuft Mo 08:00 UTC automatisch. Manueller Discover für frische Daten zwischendurch.</p>
    </div>
  </section>

  <div class="footer">Last build: ${(process.env.RUN_DATE_UTC || new Date().toISOString().slice(0,16))} UTC · ${REPO_OWNER}/${REPO_NAME}</div>
</div>

<div class="modal-backdrop" id="modal" onclick="if(event.target===this)closeModal()">
  <div class="modal" id="modal-content"></div>
</div>

<script>
const DATA = ${dataJSON};
const MODE_DEFS = ${JSON.stringify(MODE_DEFINITIONS)};
const TIER_STYLE = ${JSON.stringify(TIER_STYLE)};
const METRIC_DEFS = ${JSON.stringify(METRIC_LEADERBOARDS)};

function fmt(value, kind) {
  if (value == null || !Number.isFinite(value)) return '—';
  switch (kind) {
    case 'num1': return value.toFixed(1);
    case 'num3': return value.toFixed(3);
    case 'pct': return value.toFixed(1) + '%';
    case 'pctRatio': return (value * 100).toFixed(1) + '%';
    case 'mult': return value.toFixed(1) + 'x';
    case 'usd': {
      const abs = Math.abs(value);
      if (abs >= 1e12) return (value/1e12).toFixed(2)+'T';
      if (abs >= 1e9) return (value/1e9).toFixed(2)+'B';
      if (abs >= 1e6) return (value/1e6).toFixed(1)+'M';
      return value.toFixed(0);
    }
    default: return String(value);
  }
}

function tierBadge(tier) {
  const s = TIER_STYLE[tier] || TIER_STYLE.REJECT;
  return '<span class="tier-badge" style="background:'+s.bg+';color:'+s.fg+'">'+s.label+'</span>';
}

function renderModes() {
  const root = document.getElementById('section-modes');
  const parts = ['<div class="grid-modes">'];
  for (const m of MODE_DEFS) {
    const picks = DATA.modePicks[m.id] || [];
    parts.push('<div class="card">');
    parts.push('<h2><span style="color:'+m.color+'">'+m.icon+'</span> '+m.label+' <span class="count">'+picks.length+'</span></h2>');
    if (!picks.length) {
      parts.push('<div class="empty">Keine Picks in diesem Modus.</div>');
    } else {
      parts.push('<table class="lb"><tbody>');
      picks.forEach((p, i) => {
        // Tag 221c (audit F-GR-006 MEDIUM fix): guard against
        // p.primaryMetric being { value: null } / { value: undefined }
        // -- .toFixed() on null/undefined throws TypeError. Picks-history
        // is upstream-generated and nothing here guarantees value is
        // always finite when primaryMetric exists.
        const pmv = p.primaryMetric && p.primaryMetric.value;
        const valFmt = (pmv != null && Number.isFinite(pmv)) ? pmv.toFixed(1) : '—';
        const tier = p.score >= 80 ? 'A' : p.score >= 65 ? 'B' : p.score >= 50 ? 'NEAR_MISS' : 'REJECT';
        parts.push('<tr>');
        parts.push('<td class="rank">'+(i+1)+'</td>');
        parts.push('<td class="tk"><button onclick="openDetail(\\''+p.ticker.replace(/'/g,"\\\\'")+'\\')">'+escapeAttr(p.ticker)+'</button></td>');
        parts.push('<td class="name">'+escapeAttr(p.name || '')+'</td>');
        parts.push('<td class="val">'+valFmt+'</td>');
        parts.push('<td class="tier">'+tierBadge(tier)+'</td>');
        parts.push('</tr>');
      });
      parts.push('</tbody></table>');
    }
    parts.push('</div>');
  }
  parts.push('</div>');
  root.innerHTML = parts.join('');
}

function renderMetrics() {
  const root = document.getElementById('section-metrics');
  const parts = ['<div class="grid-metrics">'];
  for (const lb of DATA.metricLeaderboards) {
    parts.push('<div class="card">');
    parts.push('<h2>📐 '+escapeAttr(lb.label)+' <small>· '+escapeAttr(lb.desc)+'</small></h2>');
    if (!lb.entries.length) {
      parts.push('<div class="empty">Keine berechenbaren Werte.</div>');
    } else {
      parts.push('<table class="lb"><tbody>');
      lb.entries.forEach((e, i) => {
        const det = DATA.details[e.ticker];
        const nm = det && det.meta ? det.meta.name : '';
        parts.push('<tr>');
        parts.push('<td class="rank">'+(i+1)+'</td>');
        parts.push('<td class="tk"><button onclick="openDetail(\\''+e.ticker.replace(/'/g,"\\\\'")+'\\')">'+escapeAttr(e.ticker)+'</button></td>');
        parts.push('<td class="name">'+escapeAttr(nm || '')+'</td>');
        parts.push('<td class="val">'+fmt(e.value, lb.fmt)+'</td>');
        parts.push('<td class="tier"><span class="pass-dot '+(e.pass?'':'fail')+'"></span></td>');
        parts.push('</tr>');
      });
      parts.push('</tbody></table>');
    }
    parts.push('</div>');
  }
  parts.push('</div>');
  root.innerHTML = parts.join('');
}

function escapeAttr(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderSparkline(arr, width, height, color) {
  if (!arr || arr.length < 2) return '';
  const vals = arr.slice().reverse().filter(v => v != null && Number.isFinite(v));
  if (vals.length < 2) return '';
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const step = width / (vals.length - 1);
  const pts = vals.map((v, i) => i*step + ',' + (height - ((v - min) / range) * height).toFixed(1)).join(' ');
  return '<svg class="spark" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'"><polyline points="'+pts+'" fill="none" stroke="'+color+'" stroke-width="1.5"/></svg>';
}

function openDetail(ticker) {
  const det = DATA.details[ticker];
  const parts = [];
  const meta = det && det.meta || {};
  const inputs = det && det.inputs || {};
  parts.push('<div class="modal-head">');
  parts.push('<div><h3>'+escapeAttr(ticker)+(meta.name?' — '+escapeAttr(meta.name):'')+'</h3>');
  parts.push('<div class="sub">'+escapeAttr([meta.sector, meta.industry].filter(Boolean).join(' · ') || '—'));
  if (inputs.marketCapUsd) parts.push(' · MCap '+fmt(inputs.marketCapUsd, 'usd'));
  if (det && det.quality) parts.push(' · Data-Quality '+escapeAttr(det.quality));
  parts.push('</div></div>');
  parts.push('<button class="modal-close" onclick="closeModal()">Schließen</button>');
  parts.push('</div>');
  parts.push('<div class="modal-body">');

  // Mode tier section
  const modeStatus = [];
  for (const m of MODE_DEFS) {
    const picks = DATA.modePicks[m.id] || [];
    const inPick = picks.find(p => p.ticker === ticker);
    if (inPick) {
      const tier = inPick.score >= 80 ? 'A' : inPick.score >= 65 ? 'B' : inPick.score >= 50 ? 'NEAR_MISS' : 'REJECT';
      modeStatus.push('<span style="margin-right:14px"><strong style="color:'+m.color+'">'+m.icon+' '+m.label+'</strong> · Score '+inPick.score+' · '+tierBadge(tier)+'</span>');
    }
  }
  if (modeStatus.length) {
    parts.push('<h4>Mode-Status</h4>');
    parts.push('<div style="font-size:13px">'+modeStatus.join('')+'</div>');
  }

  // Quarterly data
  if (det && det.quarterly) {
    const q = det.quarterly;
    const hasAny = ['revenueQ','opIncQ','grossProfitQ','netIncomeQ'].some(k => q[k] && q[k].some(v => v != null));
    if (hasAny) {
      parts.push('<h4>Letzte 4 Quartale</h4>');
      parts.push('<table class="quarterly-table">');
      parts.push('<thead><tr><th>Serie</th><th>Q-4</th><th>Q-3</th><th>Q-2</th><th>Q-1</th><th>Trend</th></tr></thead><tbody>');
      const seriesDef = [
        ['Revenue', q.revenueQ, '#10b981'],
        ['Op-Income', q.opIncQ, '#3b82f6'],
        ['Gross-Profit', q.grossProfitQ, '#a78bfa'],
        ['Net-Income', q.netIncomeQ, '#f59e0b']
      ];
      for (const [label, arr, color] of seriesDef) {
        if (!arr || !arr.some(v => v != null)) continue;
        // arr is most-recent first; reverse for display (Q-4 → Q-1).
        const display = arr.slice(0, 4).reverse();
        parts.push('<tr><td>'+label+'</td>');
        for (const v of display) parts.push('<td>'+(v == null ? '—' : fmt(v, 'usd'))+'</td>');
        parts.push('<td>'+renderSparkline(arr.slice(0,4), 70, 18, color)+'</td>');
        parts.push('</tr>');
      }
      parts.push('</tbody></table>');
    }
  }

  // All methods
  if (det && det.results && Object.keys(det.results).length) {
    parts.push('<h4>Alle Methoden-Scores</h4>');
    parts.push('<div class="modal-grid-methods">');
    const ids = Object.keys(det.results).sort();
    for (const id of ids) {
      const r = det.results[id];
      let cls = 'incomp', valStr = 'n/a';
      if (r && r.value != null && Number.isFinite(r.value)) {
        cls = r.pass ? 'pass' : 'fail';
        valStr = (typeof r.value === 'number') ? (Math.abs(r.value) < 1 ? r.value.toFixed(3) : r.value.toFixed(2)) : String(r.value);
      } else if (r && r.pass != null) {
        cls = r.pass ? 'pass' : 'fail';
        valStr = r.pass ? '✓' : '✗';
      }
      parts.push('<div class="method-row '+cls+'"><span class="mid">'+escapeAttr(id)+'</span><span class="val">'+valStr+'</span></div>');
    }
    parts.push('</div>');
  } else {
    parts.push('<div class="empty">Keine Methoden-Daten für '+escapeAttr(ticker)+' verfügbar.</div>');
  }

  parts.push('</div>');
  document.getElementById('modal-content').innerHTML = parts.join('');
  document.getElementById('modal').classList.add('open');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

// Tab switching
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  const tabId = btn.dataset.tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
  document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === 'section-'+tabId));
});

// Esc to close modal
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

renderModes();
renderMetrics();
</script>
</body></html>`;
}

// ----------- main -----------
function main() {
  const outFile = process.argv[2] || './dashboard.html';
  const picks = safeJSON(PICKS_LATEST);
  const methodsFile = latestMethodsHistoryFile();
  const methodsHistory = methodsFile ? safeJSON(methodsFile) : null;

  let html;
  if (!picks || !methodsHistory) {
    console.warn('⚠ Falling back to minimal dashboard (picks=' + !!picks + ', methods=' + !!methodsHistory + ')');
    html = renderFallback();
  } else {
    html = render(picks, methodsHistory);
  }

  // Tag 221c (audit F-GR-009 LOW fix): atomic write to prevent
  // half-written file being served by GitHub Pages on CI cancellation.
  writeFileAtomic(outFile, html);
  console.log('✓ Dashboard generated: ' + outFile + ' (' + html.length + ' bytes)');
}

if (require.main === module) main();

module.exports = { render, renderFallback, buildMetricLeaderboard, METRIC_LEADERBOARDS };
