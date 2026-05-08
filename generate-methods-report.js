#!/usr/bin/env node
/**
 * Tag 28: Methods-Report Generator
 * Liest snapshots/, runnt alle Methoden, exportiert HTML-Matrix mit Filter-UI.
 * Kein Aggregat-Score — pure Werte-Tabelle pro Methode.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Runner = require('./methods/runner.js');
const Trend = require('./methods/trend.js');

function parseArgs(argv) {
  const args = { snapshots: './snapshots', watchlist: './watchlist.json', state: './alert-state.json', out: './methods-report.html' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--watchlist' && argv[i+1]) args.watchlist = argv[++i];
    else if (argv[i] === '--state' && argv[i+1]) args.state = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function evaluateAllStocks(args) {
  const files = fs.readdirSync(args.snapshots).filter(f => f.endsWith('.json') && f !== '_manifest.json');
  let methodHistory = {};
  if (fs.existsSync(args.state)) {
    try {
      const s = JSON.parse(fs.readFileSync(args.state, 'utf8'));
      methodHistory = s.methodHistory || {};
    } catch (e) { /* ignore */ }
  }
  const rows = [];
  for (const file of files) {
    let stock;
    try { stock = JSON.parse(fs.readFileSync(path.join(args.snapshots, file), 'utf8')); }
    catch (e) { continue; }
    const ticker = (stock.meta && stock.meta.ticker) || file.replace(/\.json$/, '');
    rows.push({
      ticker,
      name: stock.meta && stock.meta.name || ticker,
      sector: stock.meta && stock.meta.sector || '—',
      marketCap: stock.marketCap && stock.marketCap.value || null,
      revenueTTM: stock.metrics && stock.metrics.revenueTTM && stock.metrics.revenueTTM.value || null,
      growthYoY: stock.metrics && stock.metrics.revenueGrowthYoY && stock.metrics.revenueGrowthYoY.value || null,
      results: Runner.evaluateStock(stock),
      // Tag-31: trend per method based on methodHistory
      trends: (() => {
        const tickerHist = methodHistory[ticker] || {};
        const tr = {};
        for (const m of Runner.getMethods()) {
          tr[m.id] = Trend.computeTrend(tickerHist[m.id] || [], m.thresholdOp);
        }
        return tr;
      })()
    });
    // Tag-36: Pass-Count-Ranking
    const lastRow = rows[rows.length - 1];
    let passCount = 0, computableCount = 0;
    const failedMethods = [];
    for (const m of Runner.getMethods()) {
      const r = lastRow.results[m.id];
      if (r.computable) computableCount++;
      if (r.computable && r.pass) passCount++;
      else if (r.computable && !r.pass) failedMethods.push(m.label);
    }
    lastRow.passCount = passCount;
    lastRow.computableCount = computableCount;
    lastRow.failedMethods = failedMethods;
  }
  return rows;
}

function fmtMoney(v) {
  if (v == null) return '—';
  if (Math.abs(v) >= 1e12) return '$' + (v/1e12).toFixed(2) + 'T';
  if (Math.abs(v) >= 1e9)  return '$' + (v/1e9).toFixed(1) + 'B';
  if (Math.abs(v) >= 1e6)  return '$' + (v/1e6).toFixed(0) + 'M';
  return '$' + v.toFixed(0);
}
function fmtValue(v, unit) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (unit === 'percent') return (v).toFixed(1) + '%';
  if (unit === 'ratio') {
    if (Math.abs(v) < 1) return (v * 100).toFixed(2) + '%';  // small ratios als % (FCF-Yield, ROIC, Sloan)
    return v.toFixed(2);  // larger ratios as-is (Net-Debt/EBITDA, GMI)
  }
  return v.toFixed(1);
}

function renderHTML(rows, methods) {
  const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  // Build table headers
  const methodCols = methods.map(m =>
    `<th class="method-col" data-method="${m.id}" title="${escHtml(m.description)}">${escHtml(m.label)}<div class="threshold">${m.thresholdOp === 'gte' ? '≥' : (m.thresholdOp === 'lte' ? '≤' : '|·|≤')} ${m.threshold}</div></th>`
  ).join('');

  // Tag-42: Sektor-Distribution
  const sectorMap = {};
  for (const r of rows) {
    const sec = r.sector || 'Unknown';
    if (!sectorMap[sec]) sectorMap[sec] = { count: 0, totalPass: 0, totalComputable: 0, stocks: [] };
    sectorMap[sec].count++;
    sectorMap[sec].totalPass += r.passCount;
    sectorMap[sec].totalComputable += r.computableCount;
    sectorMap[sec].stocks.push(r.ticker);
  }
  const sectorRows = Object.entries(sectorMap)
    .map(([sec, d]) => ({
      sector: sec,
      count: d.count,
      avgPass: d.count > 0 ? (d.totalPass / d.count) : 0,
      avgPassRate: d.totalComputable > 0 ? (d.totalPass / d.totalComputable * 100) : 0,
      stocks: d.stocks
    }))
    .sort((a, b) => b.count - a.count);

  const sectorHtml = '<h2 style="color:#f1f5f9;font-size:18px;margin:24px 0 8px;border-bottom:1px solid #334155;padding-bottom:6px;">📈 Sektor-Distribution</h2>'
    + '<div class="sub" style="margin-bottom:14px;">Konzentrationen + durchschnittliche Pass-Rate pro Sektor.</div>'
    + '<table style="margin-bottom:30px;"><thead><tr><th>Sektor</th><th># Stocks</th><th>% of Total</th><th>Avg Pass-Count</th><th>Avg Pass-Rate</th><th>Bar</th></tr></thead><tbody>'
    + sectorRows.map(s => {
      const pct = (s.count / rows.length * 100);
      const barWidth = (s.avgPassRate || 0).toFixed(0);
      const barColor = s.avgPassRate >= 70 ? '#10b981' : s.avgPassRate >= 50 ? '#f59e0b' : '#ef4444';
      return '<tr>'
           + '<td><strong>' + escHtml(s.sector) + '</strong></td>'
           + '<td>' + s.count + '</td>'
           + '<td>' + pct.toFixed(1) + '%</td>'
           + '<td>' + s.avgPass.toFixed(1) + '</td>'
           + '<td>' + s.avgPassRate.toFixed(0) + '%</td>'
           + '<td><div style="width:120px;height:14px;background:#334155;border-radius:2px;overflow:hidden;"><div style="width:' + barWidth + '%;height:100%;background:' + barColor + ';"></div></div></td>'
           + '</tr>';
    }).join('') + '</tbody></table>';

  // Tag-81: Top-N-per-Method-Ranking
  const TOP_N = 50;
  const methodTopLists = {};
  for (const m of methods) {
    const valid = rows.filter(r => r.results[m.id].computable && Number.isFinite(r.results[m.id].value));
    // Sort by value, direction depends on thresholdOp
    valid.sort((a, b) => {
      const av = a.results[m.id].value, bv = b.results[m.id].value;
      if (m.thresholdOp === 'gte') return bv - av;     // higher = better
      if (m.thresholdOp === 'lte_abs') return Math.abs(av) - Math.abs(bv);  // lower abs = better
      return av - bv;  // lte: lower = better
    });
    methodTopLists[m.id] = valid.slice(0, TOP_N);
  }

  // Tag-36: Top-Picks-Ranking (gesamt-pass-count)
  const ranked = [...rows].sort((a, b) => {
    if (b.passCount !== a.passCount) return b.passCount - a.passCount;
    if (b.computableCount !== a.computableCount) return b.computableCount - a.computableCount;
    return a.ticker.localeCompare(b.ticker);
  });
  const topPicksRows = ranked.map((r, i) => {
    const passRatio = r.computableCount > 0 ? (r.passCount / r.computableCount) : 0;
    const ratioColor = passRatio >= 0.9 ? '#10b981' : passRatio >= 0.7 ? '#84cc16' : passRatio >= 0.5 ? '#f59e0b' : '#94a3b8';
    const failedShort = r.failedMethods.length > 3
      ? r.failedMethods.slice(0, 3).join(', ') + ' +' + (r.failedMethods.length - 3)
      : r.failedMethods.join(', ');
    return `<tr class="row-clickable" data-ticker="${r.ticker}" data-row='${encodeURIComponent(JSON.stringify({ ticker: r.ticker, name: r.name, sector: r.sector, marketCap: r.marketCap, growthYoY: r.growthYoY, revenueTTM: r.revenueTTM, results: r.results, trends: r.trends }))}'>
      <td><strong style="color:${ratioColor};">#${i+1}</strong></td>
      <td><strong>${escHtml(r.ticker)}</strong></td>
      <td>${escHtml(r.name)}</td>
      <td><span style="color:${ratioColor};font-weight:700;">${r.passCount} / ${r.computableCount}</span></td>
      <td>${escHtml(r.sector)}</td>
      <td style="color:#fca5a5;font-size:11px;">${escHtml(failedShort) || '<span style="color:#10b981;">— alle pass —</span>'}</td>
    </tr>`;
  }).join('');

  const tableRows = rows.map(r => {
    const methodCells = methods.map(m => {
      const result = r.results[m.id];
      if (!result.computable) {
        return `<td class="method-cell incomputable" data-method="${m.id}" data-pass="incomputable" title="${escHtml(result.reason)}">—</td>`;
      }
      const klass = result.pass ? 'pass' : 'fail';
      const valStr = fmtValue(result.value, m.unit);
      const trend = r.trends[m.id] || { direction: 'n/a' };
      const trendIcon = ({ improving: '<span class="trend-up" title="improving">↑</span>',
                          deteriorating: '<span class="trend-down" title="deteriorating">↓</span>',
                          stable: '<span class="trend-flat" title="stable">·</span>',
                          'n/a': '' })[trend.direction] || '';
      return `<td class="method-cell ${klass}" data-method="${m.id}" data-pass="${result.pass}" data-value="${result.value}" title="${escHtml(result.reason)} | trend=${trend.direction} (${trend.points || 0} pts)">${valStr} ${trendIcon}</td>`;
    }).join('');
    
    return `<tr class="row-clickable" data-ticker="${r.ticker}" >
      <td><strong>${escHtml(r.ticker)}</strong></td>
      <td>${escHtml(r.name)}</td>
      <td>${escHtml(r.sector)}</td>
      <td>${fmtMoney(r.marketCap)}</td>
      <td>${r.growthYoY != null ? r.growthYoY.toFixed(1) + '%' : '—'}</td>
      ${methodCells}
    </tr>`;
  }).join('');

  // Method-summary
  const methodSummary = methods.map(m => {
    const computable = rows.filter(r => r.results[m.id].computable).length;
    const passing = rows.filter(r => r.results[m.id].pass).length;
    return `<div class="msum"><div class="ml">${escHtml(m.label)}</div><div class="mv"><span class="pass-count">${passing}</span> / ${computable}</div><div class="mh">pass / computable (${rows.length} total)</div></div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Karl's Stock-Screener — Methoden-Matrix ${generatedAt}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; line-height: 1.4; }
  h1 { color: #f1f5f9; font-size: 24px; margin: 0 0 4px; }
  .sub { color: #94a3b8; font-size: 12px; margin-bottom: 18px; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 14px 0 22px; }
  .msum { background: #1e293b; border: 1px solid #334155; border-left: 3px solid #8b5cf6; border-radius: 6px; padding: 10px 14px; }
  .ml { font-size: 12px; color: #94a3b8; font-weight: 600; }
  .mv { font-size: 22px; font-weight: 700; color: #f1f5f9; margin: 2px 0; }
  .mv .pass-count { color: #10b981; }
  .mh { font-size: 10px; color: #64748b; }
  .filter-bar { background: #1e293b; border: 1px solid #334155; padding: 12px 16px; border-radius: 6px; margin-bottom: 14px; display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
  .filter-bar label { color: #cbd5e1; font-size: 13px; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 4px; padding: 3px 8px; background: #334155; border-radius: 4px; }
  .filter-bar label.active { background: #10b98140; color: #6ee7b7; border: 1px solid #10b98180; }
  .filter-bar label input { margin-right: 4px; }
  .filter-bar .filter-mode { color: #94a3b8; font-size: 12px; padding-left: 12px; border-left: 1px solid #334155; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; background: #1e293b; border-radius: 8px; overflow: hidden; }
  th { text-align: left; padding: 10px 8px; background: #0f172a; color: #94a3b8; border-bottom: 2px solid #334155; font-weight: 600; vertical-align: bottom; cursor: pointer; user-select: none; position: sticky; top: 0; z-index: 5; }
  th:hover { background: #1a2436; }
  th .threshold { color: #64748b; font-size: 10px; font-weight: 400; margin-top: 2px; }
  td { padding: 8px 8px; border-bottom: 1px solid #131c2b; }
  tr:hover td { background: #1a2436; }
  tr.hidden, tr.pc-hidden { display: none; }
  td.method-cell { text-align: center; font-weight: 600; }
  td.method-cell.pass { background: #10b98115; color: #6ee7b7; }
  td.method-cell.fail { background: #ef444415; color: #fca5a5; }
  td.method-cell.incomputable { color: #475569; background: transparent; }
  .position-owned { color: #fbbf24; font-weight: 600; padding: 1px 6px; background: #fbbf2420; border-radius: 3px; font-size: 10px; }
  .position-watching { color: #60a5fa; padding: 1px 6px; background: #60a5fa20; border-radius: 3px; font-size: 10px; }
  .position-interested { color: #94a3b8; padding: 1px 6px; background: #94a3b820; border-radius: 3px; font-size: 10px; }
  .trend-up { color: #10b981; font-weight: bold; margin-left: 2px; }
  .trend-down { color: #ef4444; font-weight: bold; margin-left: 2px; }
  .trend-flat { color: #64748b; margin-left: 2px; }
  .preset-btn { background: #1e293b; color: #cbd5e1; border: 1px solid #334155; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; }
  .preset-btn:hover { background: #334155; color: #f1f5f9; }
  .pcb { background: #334155; color: #cbd5e1; border: 1px solid #475569; padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; margin: 0 1px; }
  .pcb:hover { background: #475569; color: #f1f5f9; }
  tr.row-clickable { cursor: pointer; }
  /* Modal */
  .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 100; padding: 30px; overflow-y: auto; }
  .modal-overlay.open { display: block; }
  .modal { background: #1e293b; border: 1px solid #334155; border-radius: 8px; max-width: 900px; margin: 0 auto; padding: 24px; }
  .modal h3 { margin: 0 0 8px; color: #f1f5f9; font-size: 22px; }
  .modal .close { float: right; background: #334155; color: #cbd5e1; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; }
  .modal .stock-meta-row { color: #94a3b8; font-size: 12px; margin-bottom: 16px; }
  .modal table { width: 100%; }
  .modal td.method-name { font-weight: 600; color: #cbd5e1; }
  .modal td.calc { color: #64748b; font-size: 11px; font-family: ui-monospace, monospace; }
</style></head><body>

<h1>📊 Karl's Stock-Screener — Methoden-Matrix</h1>
<div class="sub">Generated ${escHtml(generatedAt)} · ${rows.length} stocks · ${methods.length} methods · Buy-only-Filter (kein Aggregat-Score)</div>

<div class="summary">${methodSummary}</div>

<div class="quick-filter-bar" style="background:#1e293b;border:1px solid #334155;padding:10px 14px;border-radius:6px;margin-bottom:10px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
  <strong style="color:#f1f5f9;font-size:13px;">Quick-Filter:</strong>
  <label style="color:#cbd5e1;font-size:12px;">Pass-Count ≥
    <input type="number" id="passcount-filter" min="0" max="10" value="0" style="width:50px;background:#0f172a;color:#cbd5e1;border:1px solid #334155;padding:3px 6px;border-radius:3px;margin:0 6px;">
    <button data-passcount="10" class="pcb">10</button>
    <button data-passcount="9" class="pcb">9+</button>
    <button data-passcount="8" class="pcb">8+</button>
    <button data-passcount="7" class="pcb">7+</button>
    <button data-passcount="0" class="pcb">All</button>
  </label>
  <span id="quick-count" style="color:#94a3b8;font-size:12px;margin-left:auto;"></span>
</div>
<div class="preset-bar" style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
  <strong style="color:#f1f5f9;font-size:12px;align-self:center;">Presets:</strong>
  <button class="preset-btn" data-preset="all-pass">All Pass (alle 8)</button>
  <button class="preset-btn" data-preset="hypergrowth">Hypergrowth (Rule of 40 + Rule of X + Rev-Growth-3Y)</button>
  <button class="preset-btn" data-preset="quality">Quality (ROIC + GM-Stability + Sloan)</button>
  <button class="preset-btn" data-preset="solvency">Solvency-Guard (Net-Debt + Sloan)</button>
  <button class="preset-btn" data-preset="value">Value (FCF-Yield + Sloan)</button>
  <button class="preset-btn" data-preset="clear">Clear</button>
</div>
<div class="filter-bar">
  <strong style="color:#f1f5f9;font-size:13px;">Filter:</strong>
  ${methods.map(m => `<label data-filter="${m.id}"><input type="checkbox" data-method="${m.id}"> ${escHtml(m.label)}</label>`).join('')}
  <span class="filter-mode">Mode: <select id="filter-mode" style="background:#0f172a;color:#cbd5e1;border:1px solid #334155;padding:2px 6px;border-radius:3px;"><option value="AND">AND (alle ausgewählten pass)</option><option value="OR">OR (mind. einer pass)</option></select></span>
  <span class="filter-mode" id="visible-count">Showing all ${rows.length}</span>
</div>

${sectorHtml}

<h2 style="color:#f1f5f9;font-size:18px;margin:24px 0 8px;border-bottom:1px solid #334155;padding-bottom:6px;">🎯 Top ${TOP_N} per Method (Discovery)</h2>
<div class="sub" style="margin-bottom:14px;">Pro Methode die ${TOP_N} Stocks mit besten Werten — sortiert nach Methoden-Wert (nicht Pass/Fail). Karl's Discovery-Modus für Mid/Small-Caps. Klick auf eine Methode-Karte für Top-${TOP_N}.</div>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-bottom:30px;">
${methods.map(m => {
  const list = methodTopLists[m.id] || [];
  if (list.length === 0) return '';
  const top5 = list.slice(0, 5);
  const opSym = m.thresholdOp === 'gte' ? '↑' : (m.thresholdOp === 'lte' ? '↓' : '|·|↓');
  return '<details class="topm-card" style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:12px;"><summary style="cursor:pointer;color:#f1f5f9;font-weight:600;font-size:13px;">'
       + escHtml(m.label) + ' <span style="color:#94a3b8;font-weight:400;font-size:11px;">' + opSym + ' (top ' + Math.min(list.length, TOP_N) + ')</span></summary>'
       + '<div style="margin-top:8px;font-size:11px;color:#cbd5e1;">'
       + list.slice(0, TOP_N).map((r, i) => {
           const v = r.results[m.id].value;
           const valStr = (m.unit === 'percent') ? v.toFixed(1) + '%' :
                          (m.unit === 'ratio' && Math.abs(v) < 1) ? (v*100).toFixed(2) + '%' :
                          v.toFixed(2);
           return '<div style="padding:2px 0;border-bottom:1px solid #131c2b;">'
                + '<span style="color:#94a3b8;width:24px;display:inline-block;">#' + (i+1) + '</span>'
                + '<strong style="color:#f1f5f9;">' + escHtml(r.ticker) + '</strong>'
                + ' <span style="color:#64748b;">' + escHtml((r.name || '').slice(0, 22)) + '</span>'
                + ' <span style="float:right;color:#10b981;">' + valStr + '</span>'
                + '</div>';
         }).join('')
       + '</div></details>';
}).join('')}
</div>

<h2 style="color:#f1f5f9;font-size:18px;margin:24px 0 8px;border-bottom:1px solid #334155;padding-bottom:6px;">🏆 Top-Picks (Pass-Count-Ranking)</h2>
<div class="sub" style="margin-bottom:14px;">Stocks gerankt nach Pass-Count. Klick auf eine Reihe für Details. Stocks mit ≥7 Pass von 10 Methoden sind potentielle Kandidaten — die fehlenden Methoden geben dir konkrete Punkte zum manuellen Prüfen.</div>
<table id="top-picks" style="margin-bottom:30px;">
<thead><tr><th>Rank</th><th>Ticker</th><th>Name</th><th>Pass / Computable</th><th>Sector</th><th>Failed Methods</th></tr></thead>
<tbody>${topPicksRows}</tbody>
</table>

<div id="modal-overlay" class="modal-overlay">
  <div class="modal">
    <button class="close" onclick="document.getElementById('modal-overlay').classList.remove('open');">×</button>
    <div id="modal-content">Loading...</div>
  </div>
</div>

<details style="margin-top:30px;"><summary style="cursor:pointer;color:#f1f5f9;font-size:16px;font-weight:700;padding:12px;background:#1e293b;border:1px solid #334155;border-radius:8px;margin-bottom:8px;">📋 Full Matrix Tabelle (klicken zum Aufklappen)</summary><table id="matrix">
<thead><tr>
  <th data-sort="ticker">Ticker</th>
  <th data-sort="name">Name</th>
  <th data-sort="sector">Sector</th>
  <th data-sort="marketCap">MCap</th>
  <th data-sort="growthYoY">Growth YoY</th>
  ${methodCols}
</tr></thead>
<tbody>${tableRows}</tbody>
</table>

<script>
(function() {
  const tbody = document.querySelector('#matrix tbody');
  const checkboxes = document.querySelectorAll('.filter-bar input[type=checkbox]');
  const modeSelect = document.getElementById('filter-mode');
  const countEl = document.getElementById('visible-count');
  const totalRows = tbody.querySelectorAll('tr').length;

  function applyFilter() {
    const active = Array.from(checkboxes).filter(c => c.checked).map(c => c.dataset.method);
    const mode = modeSelect.value;

    document.querySelectorAll('.filter-bar label').forEach(l => {
      const cb = l.querySelector('input');
      l.classList.toggle('active', cb && cb.checked);
    });

    let visible = 0;
    tbody.querySelectorAll('tr').forEach(tr => {
      let show = true;
      if (active.length > 0) {
        const passes = active.map(m => {
          const cell = tr.querySelector('[data-method="' + m + '"]');
          return cell && cell.dataset.pass === 'true';
        });
        if (mode === 'AND') show = passes.every(p => p);
        else show = passes.some(p => p);
      }
      tr.classList.toggle('hidden', !show);
      if (show) visible++;
    });

    countEl.textContent = active.length === 0
      ? 'Showing all ' + totalRows
      : 'Showing ' + visible + ' / ' + totalRows + ' (filter: ' + active.join(' ' + mode + ' ') + ')';
  }

  checkboxes.forEach(cb => cb.addEventListener('change', applyFilter));
  modeSelect.addEventListener('change', applyFilter);

  // Sortable columns
  document.querySelectorAll('th[data-sort]').forEach((th, idx) => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
      th.dataset.dir = dir;
      rows.sort((a, b) => {
        const av = a.cells[idx].textContent.trim();
        const bv = b.cells[idx].textContent.trim();
        const an = parseFloat(av.replace(/[^0-9.-]/g, ''));
        const bn = parseFloat(bv.replace(/[^0-9.-]/g, ''));
        if (!isNaN(an) && !isNaN(bn)) return dir === 'asc' ? an - bn : bn - an;
        return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
      rows.forEach(r => tbody.appendChild(r));
    });
  });

  // Tag-41: Pass-Count-Quick-Filter
  const pcInput = document.getElementById('passcount-filter');
  const pcCount = document.getElementById('quick-count');
  function applyPassCount() {
    const min = parseInt(pcInput.value) || 0;
    const allRows = document.querySelectorAll('#matrix tbody tr, #top-picks tbody tr');
    let visible = 0, total = 0;
    allRows.forEach(tr => {
      try {
        const data = JSON.parse(decodeURIComponent(tr.dataset.row));
        let passCount = 0;
        for (const r of Object.values(data.results)) {
          if (r.computable && r.pass) passCount++;
        }
        const show = passCount >= min;
        // Don't override the methods-filter hidden class — only set our own marker
        tr.classList.toggle('pc-hidden', !show);
        total++;
        if (show && !tr.classList.contains('hidden')) visible++;
      } catch (e) { /* skip rows without data */ }
    });
    if (pcCount) pcCount.textContent = min === 0 ? '' : (visible + ' / ' + total + ' stocks ≥ ' + min + ' pass');
  }
  if (pcInput) pcInput.addEventListener('input', applyPassCount);
  document.querySelectorAll('.pcb').forEach(b => {
    b.addEventListener('click', () => {
      pcInput.value = b.dataset.passcount;
      applyPassCount();
    });
  });

  // Tag-32: Filter-Presets
  const presetMap = {
    'all-pass': ['rule-of-40','rule-of-x','roic','net-debt-ebitda','sloan-ratio','revenue-growth-3y','fcf-yield','gross-margin-stability'],
    'hypergrowth': ['rule-of-40','rule-of-x','revenue-growth-3y'],
    'quality': ['roic','gross-margin-stability','sloan-ratio'],
    'solvency': ['net-debt-ebitda','sloan-ratio'],
    'value': ['fcf-yield','sloan-ratio'],
    'clear': []
  };
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      const ids = presetMap[preset] || [];
      checkboxes.forEach(cb => { cb.checked = ids.includes(cb.dataset.method); });
      applyFilter();
    });
  });

  // Tag-32: Modal Detail-View
  const modal = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');
  document.querySelectorAll('tr.row-clickable').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.method-cell')) {
        // direct method-cell click — show only that method's details
        // (skip — main row click handler)
      }
      const data = JSON.parse(decodeURIComponent(tr.dataset.row));
      let html = '<h3>' + data.ticker + ' — ' + data.name + '</h3>';
      html += '<div class="stock-meta-row">' + data.sector + ' · MCap ' + (data.marketCap ? '$' + (data.marketCap/1e9).toFixed(1) + 'B' : '—') +
              ' · Rev TTM ' + (data.revenueTTM ? '$' + (data.revenueTTM/1e9).toFixed(1) + 'B' : '—') +
              ' · Growth YoY ' + (data.growthYoY != null ? data.growthYoY.toFixed(1) + '%' : '—') + '</div>';
      html += '<table><thead><tr><th>Method</th><th>Value</th><th>Pass</th><th>Trend</th><th>Calc</th></tr></thead><tbody>';
      for (const [mid, r] of Object.entries(data.results)) {
        const t = data.trends[mid] || { direction: 'n/a', points: 0 };
        const trIcon = { improving: '↑', deteriorating: '↓', stable: '·', 'n/a': '—' }[t.direction];
        html += '<tr>'
              + '<td class="method-name">' + mid + '</td>'
              + '<td>' + (r.value != null && Number.isFinite(r.value) ? r.value.toFixed(3) : '—') + '</td>'
              + '<td>' + (r.computable ? (r.pass ? '✓' : '✗') : '—') + '</td>'
              + '<td>' + trIcon + ' (' + t.points + ' pts)' + '</td>'
              + '<td class="calc">' + r.reason + '</td>'
              + '</tr>';
      }
      html += '</tbody></table></details>';
      modalContent.innerHTML = html;
      modal.classList.add('open');
    });
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });

  // Method-Spalten sortieren
  document.querySelectorAll('th.method-col').forEach((th) => {
    th.addEventListener('click', () => {
      const m = th.dataset.method;
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const dir = th.dataset.dir === 'desc' ? 'asc' : 'desc';
      th.dataset.dir = dir;
      rows.sort((a, b) => {
        const ac = a.querySelector('[data-method="' + m + '"]');
        const bc = b.querySelector('[data-method="' + m + '"]');
        const av = parseFloat(ac.dataset.value);
        const bv = parseFloat(bc.dataset.value);
        if (isNaN(av) && isNaN(bv)) return 0;
        if (isNaN(av)) return 1;
        if (isNaN(bv)) return -1;
        return dir === 'asc' ? av - bv : bv - av;
      });
      rows.forEach(r => tbody.appendChild(r));
    });
  });
})();
</script>

</body></html>`;
}

function main() {
  const args = parseArgs(process.argv);
  console.log(`Loading snapshots from ${args.snapshots}...`);
  const rows = evaluateAllStocks(args);
  console.log(`Evaluated ${rows.length} stocks across 5 methods`);
  const methods = Runner.getMethods();
  const html = renderHTML(rows, methods);
  fs.writeFileSync(args.out, html);
  console.log(`✓ Report written: ${args.out} (${html.length} bytes)`);
  console.log('');
  console.log('Pass-counts per method:');
  for (const m of methods) {
    const computable = rows.filter(r => r.results[m.id].computable).length;
    const passing = rows.filter(r => r.results[m.id].pass).length;
    console.log(`  ${m.label.padEnd(20)} ${passing.toString().padStart(2)} / ${computable.toString().padStart(2)} pass / computable`);
  }
}

main();
