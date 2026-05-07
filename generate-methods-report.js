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

function loadPositionMap(watchlistPath) {
  const map = {};
  if (!fs.existsSync(watchlistPath)) return map;
  const wl = JSON.parse(fs.readFileSync(watchlistPath, 'utf8'));
  for (const s of (wl.stocks || [])) {
    if (s.ticker) map[s.ticker] = { position: s.position || 'watching', name: s.name };
  }
  return map;
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function evaluateAllStocks(args) {
  const files = fs.readdirSync(args.snapshots).filter(f => f.endsWith('.json') && f !== '_manifest.json');
  const positions = loadPositionMap(args.watchlist);
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
    const pi = positions[ticker] || { position: 'watching', name: ticker };
    rows.push({
      ticker,
      name: stock.meta && stock.meta.name || ticker,
      sector: stock.meta && stock.meta.sector || '—',
      position: pi.position,
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
    const rowData = encodeURIComponent(JSON.stringify({ ticker: r.ticker, name: r.name, sector: r.sector, marketCap: r.marketCap, growthYoY: r.growthYoY, revenueTTM: r.revenueTTM, results: r.results, trends: r.trends }));
    return `<tr class="row-clickable" data-ticker="${r.ticker}" data-position="${r.position}" data-row='${rowData}'>
      <td><strong>${escHtml(r.ticker)}</strong></td>
      <td>${escHtml(r.name)}</td>
      <td><span class="position-${r.position}">${r.position}</span></td>
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
<html lang="de"><head><meta charset="UTF-8"><title>Karl's Stock-Screener — Methoden-Matrix ${generatedAt}</title>
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
  tr.hidden { display: none; }
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

<div id="modal-overlay" class="modal-overlay">
  <div class="modal">
    <button class="close" onclick="document.getElementById('modal-overlay').classList.remove('open');">×</button>
    <div id="modal-content">Loading...</div>
  </div>
</div>

<table id="matrix">
<thead><tr>
  <th data-sort="ticker">Ticker</th>
  <th data-sort="name">Name</th>
  <th data-sort="position">Pos</th>
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
      html += '</tbody></table>';
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
