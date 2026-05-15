#!/usr/bin/env node
/**
 * Tag 28: Methods-Report Generator
 * Liest snapshots/, runnt alle Methoden, exportiert HTML-Matrix mit Filter-UI.
 * Kein Aggregat-Score — pure Werte-Tabelle pro Methode.
 *
 * Tag 150+: Metric Value Filters, Key-Metrics-Columns, Component-Breakdown in cards,
 *           Metric Deep-Dive section, improved color-coding.
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
      fcfMargin: stock.metrics && stock.metrics.fcfMarginTTM && stock.metrics.fcfMarginTTM.value || null,
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

    // Extract key metric values for filter & display
    const ro40 = lastRow.results['rule-of-40'];
    const rox  = lastRow.results['rule-of-x'];
    const roic = lastRow.results['roic'];
    lastRow.ruleOf40Value  = (ro40 && ro40.computable && Number.isFinite(ro40.value)) ? ro40.value : null;
    lastRow.ruleOfXValue   = (rox  && rox.computable  && Number.isFinite(rox.value))  ? rox.value  : null;
    lastRow.roicPct        = (roic && roic.computable  && Number.isFinite(roic.value)) ? roic.value * 100 : null;
    // growth and FCF margin from components (most reliable source)
    if (ro40 && ro40.computable && ro40.components) {
      lastRow.growthYoYFromRo40  = ro40.components.growth  != null ? ro40.components.growth  : lastRow.growthYoY;
      lastRow.fcfMarginFromRo40  = ro40.components.fcfMargin != null ? ro40.components.fcfMargin : lastRow.fcfMargin;
    } else {
      lastRow.growthYoYFromRo40  = lastRow.growthYoY;
      lastRow.fcfMarginFromRo40  = lastRow.fcfMargin;
    }
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

// Color a numeric value relative to a threshold: bright-green above, orange near, red below.
// Returns inline style string color only.
function metricColor(value, threshold, higherIsBetter) {
  if (value == null || !Number.isFinite(value)) return '#94a3b8';
  const delta = higherIsBetter ? (value - threshold) : (threshold - value);
  const pct = threshold !== 0 ? Math.abs(delta / threshold) : Math.abs(delta) / 10;
  if (delta >= 0) {
    // passing — intensity: >20% above = bright green, 0-20% = lighter green
    if (pct >= 0.2) return '#10b981';
    return '#6ee7b7';
  } else {
    // failing — near threshold = orange, far = red
    if (pct <= 0.15) return '#f59e0b';
    return '#ef4444';
  }
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

  const sectorHtml = '<h2 style="color:#f1f5f9;font-size:18px;margin:24px 0 8px;border-bottom:1px solid #334155;padding-bottom:6px;">Sektor-Distribution</h2>'
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
  // Tag 98f: nur CORE-Methoden + disqualified-Stocks raus aus Discovery-Cards
  const MT_local = require('./methods/method-types.js');
  const discoveryRows = rows.filter(r => {
    // disqualified durch DataGuard? Pruefen ob irgendein DATAGUARD pass=false hat
    for (const [mid, res] of Object.entries(r.results)) {
      if (MT_local.isDataGuard(mid) && res.computable === true && res.pass === false) return false;
    }
    return true;
  });
  for (const m of methods) {
    // Tag 98f: nur discoveryRows fuer Top-50 (DataGuard-disqualified bereits raus)
    const valid = discoveryRows.filter(r => r.results[m.id].computable && Number.isFinite(r.results[m.id].value));
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

  // --- Metric Deep-Dive: top 10 per key metric ---
  const deepDiveMetrics = [
    { key: 'ruleOf40Value',    label: 'Rule of 40', unit: '', decimals: 1, threshold: 40,  higherIsBetter: true  },
    { key: 'ruleOfXValue',     label: 'Rule of X',  unit: '', decimals: 1, threshold: 50,  higherIsBetter: true  },
    { key: 'growthYoYFromRo40',label: 'Rev Growth', unit: '%', decimals: 1, threshold: 20, higherIsBetter: true  },
    { key: 'fcfMarginFromRo40',label: 'FCF Margin', unit: '%', decimals: 1, threshold: 10, higherIsBetter: true  },
    { key: 'roicPct',          label: 'ROIC',       unit: '%', decimals: 1, threshold: 15, higherIsBetter: true  },
  ];
  const TOP_DD = 10;
  // Build top-10 per metric (only computable)
  const deepDiveLists = deepDiveMetrics.map(dm => {
    const sorted = rows
      .filter(r => r[dm.key] != null && Number.isFinite(r[dm.key]))
      .sort((a, b) => dm.higherIsBetter ? b[dm.key] - a[dm.key] : a[dm.key] - b[dm.key])
      .slice(0, TOP_DD);
    return { ...dm, list: sorted };
  });

  function fmtMetric(v, dm) {
    if (v == null || !Number.isFinite(v)) return '—';
    return v.toFixed(dm.decimals) + dm.unit;
  }

  // Build deep-dive table HTML
  const deepDiveHtml = (() => {
    // Table: rows = ranks 1-10, cols = ticker + each metric
    let h = '<table style="font-size:11px;table-layout:fixed;"><thead><tr>'
           + '<th style="width:30px;">#</th>';
    for (const dm of deepDiveLists) {
      h += '<th style="min-width:90px;text-align:center;" colspan="2">' + escHtml(dm.label) + '</th>';
    }
    h += '</tr></thead><tbody>';
    for (let i = 0; i < TOP_DD; i++) {
      h += '<tr>';
      h += '<td style="color:#64748b;">' + (i+1) + '</td>';
      for (const dm of deepDiveLists) {
        const entry = dm.list[i];
        if (!entry) {
          h += '<td colspan="2" style="color:#475569;text-align:center;">—</td>';
          continue;
        }
        const v = entry[dm.key];
        const color = metricColor(v, dm.threshold, dm.higherIsBetter);
        h += '<td><strong style="color:#e2e8f0;">' + escHtml(entry.ticker) + '</strong></td>';
        h += '<td style="text-align:right;color:' + color + ';font-weight:700;">' + fmtMetric(v, dm) + '</td>';
      }
      h += '</tr>';
    }
    h += '</tbody></table>';
    return h;
  })();

  // --- Build Top Picks rows with key metric data attributes ---
  const topPicksRows = ranked.map((r, i) => {
    const passRatio = r.computableCount > 0 ? (r.passCount / r.computableCount) : 0;
    const ratioColor = passRatio >= 0.9 ? '#10b981' : passRatio >= 0.7 ? '#84cc16' : passRatio >= 0.5 ? '#f59e0b' : '#94a3b8';
    const failedShort = r.failedMethods.length > 3
      ? r.failedMethods.slice(0, 3).join(', ') + ' +' + (r.failedMethods.length - 3)
      : r.failedMethods.join(', ');

    // Rule of 40 component breakdown string
    const ro40 = r.results['rule-of-40'];
    let ro40Display = '—';
    let ro40Color = '#94a3b8';
    if (ro40 && ro40.computable && ro40.components) {
      const g = ro40.components.growth, f = ro40.components.fcfMargin;
      ro40Display = g.toFixed(0) + '% + ' + f.toFixed(0) + '% = ' + ro40.value.toFixed(0);
      ro40Color = metricColor(ro40.value, 40, true);
    } else if (ro40 && ro40.computable && Number.isFinite(ro40.value)) {
      ro40Display = ro40.value.toFixed(1);
      ro40Color = metricColor(ro40.value, 40, true);
    }

    const growthV = r.growthYoYFromRo40;
    const fcfV    = r.fcfMarginFromRo40;
    const growthDisplay = growthV != null ? growthV.toFixed(1) + '%' : '—';
    const fcfDisplay    = fcfV   != null ? fcfV.toFixed(1) + '%'    : '—';
    const growthColor   = growthV != null ? metricColor(growthV, 20, true) : '#94a3b8';
    const fcfColor      = fcfV   != null ? metricColor(fcfV, 10, true)   : '#94a3b8';

    const psR = r.results['profitability-state'];
    const pState = (psR && psR.computable && psR.components) ? psR.components.state : 'NA';

    // Encode row data (needed for modal + pass-count filter)
    const rowData = encodeURIComponent(JSON.stringify({
      ticker: r.ticker, name: r.name, sector: r.sector,
      marketCap: r.marketCap, growthYoY: r.growthYoY, revenueTTM: r.revenueTTM,
      results: r.results, trends: r.trends
    }));

    return `<tr class="row-clickable" data-ticker="${r.ticker}" data-prof-state="${pState}"
        data-ro40="${r.ruleOf40Value != null ? r.ruleOf40Value : ''}"
        data-rox="${r.ruleOfXValue != null ? r.ruleOfXValue : ''}"
        data-growth="${growthV != null ? growthV : ''}"
        data-fcfmargin="${fcfV != null ? fcfV : ''}"
        data-roic="${r.roicPct != null ? r.roicPct : ''}"
        data-row='${rowData}'>
      <td><strong style="color:${ratioColor};">#${i+1}</strong></td>
      <td><strong>${escHtml(r.ticker)}</strong></td>
      <td>${escHtml(r.name)}</td>
      <td><span style="color:${ratioColor};font-weight:700;">${r.passCount} / ${r.computableCount}</span></td>
      <td>${escHtml(r.sector)}</td>
      <td style="font-weight:700;font-size:12px;color:${ro40Color};" title="growth + FCF margin = Rule of 40">${escHtml(ro40Display)}</td>
      <td style="color:${growthColor};font-weight:600;">${escHtml(growthDisplay)}</td>
      <td style="color:${fcfColor};font-weight:600;">${escHtml(fcfDisplay)}</td>
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

    const psR = r.results['profitability-state'];
    const pState = (psR && psR.computable && psR.components) ? psR.components.state : 'NA';
    return `<tr class="row-clickable" data-ticker="${r.ticker}" data-prof-state="${pState}">
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
  .filter-bar { background: #1e293b; border: 1px solid #334155; padding: 10px 14px; border-radius: 6px; margin-bottom: 10px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .filter-bar label { color: #cbd5e1; font-size: 12px; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 4px; padding: 2px 7px; background: #334155; border-radius: 4px; }
  .filter-bar label.active { background: #10b98140; color: #6ee7b7; border: 1px solid #10b98180; }
  .filter-bar label input { margin-right: 3px; }
  .filter-bar .filter-mode { color: #94a3b8; font-size: 12px; padding-left: 12px; border-left: 1px solid #334155; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; background: #1e293b; border-radius: 8px; overflow: hidden; }
  th { text-align: left; padding: 8px 8px; background: #0f172a; color: #94a3b8; border-bottom: 2px solid #334155; font-weight: 600; vertical-align: bottom; cursor: pointer; user-select: none; position: sticky; top: 0; z-index: 5; }
  th:hover { background: #1a2436; }
  th .threshold { color: #64748b; font-size: 10px; font-weight: 400; margin-top: 2px; }
  td { padding: 7px 8px; border-bottom: 1px solid #131c2b; }
  tr:hover td { background: #1a2436; }
  tr.hidden, tr.pc-hidden, tr.mv-hidden { display: none; }
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
  /* Metric Value Filter Bar */
  .mvf-bar { background: #162032; border: 1px solid #334155; border-left: 3px solid #0ea5e9; padding: 12px 16px; border-radius: 6px; margin-bottom: 10px; }
  .mvf-bar h3 { color: #f1f5f9; font-size: 13px; margin: 0 0 10px; font-weight: 700; }
  .mvf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
  .mvf-item { display: flex; flex-direction: column; gap: 3px; }
  .mvf-item label { font-size: 11px; color: #94a3b8; font-weight: 600; display: flex; justify-content: space-between; }
  .mvf-item label span.val { color: #0ea5e9; font-weight: 700; min-width: 36px; text-align: right; }
  .mvf-item label.active-filter span.val { color: #10b981; }
  .mvf-item label.active-filter { color: #6ee7b7; }
  .mvf-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 2px; background: #334155; outline: none; cursor: pointer; }
  .mvf-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #0ea5e9; cursor: pointer; }
  .mvf-slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #0ea5e9; cursor: pointer; border: none; }
  .mvf-reset { background: #1e293b; color: #cbd5e1; border: 1px solid #334155; padding: 3px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-top: 6px; }
  .mvf-reset:hover { background: #334155; color: #f1f5f9; }
  .mvf-count { color: #94a3b8; font-size: 11px; margin-top: 4px; }
  /* Deep-Dive section */
  .deep-dive-section { background: #162032; border: 1px solid #0ea5e960; border-radius: 8px; padding: 14px 16px; margin-bottom: 22px; }
  .deep-dive-section h2 { color: #f1f5f9; font-size: 16px; margin: 0 0 4px; }
  .deep-dive-section .sub { margin-bottom: 10px; }
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

<h1>Karl's Stock-Screener — Methoden-Matrix</h1>
<div class="sub">Generated ${escHtml(generatedAt)} · ${rows.length} stocks (${rows.length - discoveryRows.length} disqualified by DataGuards) · ${methods.length} methods · Buy-only-Filter (kein Aggregat-Score)</div>

<div class="summary">${methodSummary}</div>

<!-- ===== METRIC VALUE FILTER BAR ===== -->
<div class="mvf-bar">
  <h3>Metric Value Filter — direkt nach Kennzahlen filtern</h3>
  <div class="mvf-grid">
    <div class="mvf-item">
      <label id="mvf-ro40-label">Rule of 40 <span class="val" id="mvf-ro40-val">≥ 0</span></label>
      <input type="range" class="mvf-slider" id="mvf-ro40" min="-50" max="150" step="5" value="-50">
    </div>
    <div class="mvf-item">
      <label id="mvf-rox-label">Rule of X <span class="val" id="mvf-rox-val">≥ 0</span></label>
      <input type="range" class="mvf-slider" id="mvf-rox" min="-50" max="200" step="5" value="-50">
    </div>
    <div class="mvf-item">
      <label id="mvf-growth-label">Revenue Growth YoY <span class="val" id="mvf-growth-val">≥ 0%</span></label>
      <input type="range" class="mvf-slider" id="mvf-growth" min="-30" max="150" step="5" value="-30">
    </div>
    <div class="mvf-item">
      <label id="mvf-fcf-label">FCF Margin <span class="val" id="mvf-fcf-val">≥ 0%</span></label>
      <input type="range" class="mvf-slider" id="mvf-fcf" min="-50" max="80" step="2" value="-50">
    </div>
    <div class="mvf-item">
      <label id="mvf-roic-label">ROIC <span class="val" id="mvf-roic-val">≥ 0%</span></label>
      <input type="range" class="mvf-slider" id="mvf-roic" min="-20" max="100" step="2" value="-20">
    </div>
  </div>
  <div style="display:flex;gap:10px;align-items:center;margin-top:8px;">
    <button class="mvf-reset" id="mvf-reset-btn">Reset All Metric Filters</button>
    <span class="mvf-count" id="mvf-count"></span>
  </div>
</div>

<!-- ===== QUICK FILTER + PROF FILTER ===== -->
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
<div class="quick-filter-bar" style="background:#1e293b;border:1px solid #334155;padding:10px 14px;border-radius:6px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
  <strong style="color:#f1f5f9;font-size:12px;">Pass-Count ≥</strong>
  <input type="number" id="passcount-filter" min="0" max="30" value="0" style="width:46px;background:#0f172a;color:#cbd5e1;border:1px solid #334155;padding:3px 5px;border-radius:3px;">
  <button data-passcount="10" class="pcb">10</button>
  <button data-passcount="9" class="pcb">9+</button>
  <button data-passcount="8" class="pcb">8+</button>
  <button data-passcount="7" class="pcb">7+</button>
  <button data-passcount="0" class="pcb">All</button>
  <span id="quick-count" style="color:#94a3b8;font-size:11px;"></span>
</div>
<div class="prof-filter-bar" style="background:#1e293b;border:1px solid #334155;padding:10px 14px;border-radius:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
  <strong style="color:#f1f5f9;font-size:12px;">Profitabilität:</strong>
  <button data-prof="ALL" class="psb psb-active" style="background:#334155;color:#cbd5e1;border:1px solid #475569;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">Alle</button>
  <button data-prof="LOSS" class="psb" style="background:#1f0a14;color:#fca5a5;border:1px solid #ef444460;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">L · Loss</button>
  <button data-prof="TURNAROUND" class="psb" style="background:#332010;color:#fcd34d;border:1px solid #f59e0b60;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">T · Turnaround</button>
  <button data-prof="RECENT" class="psb" style="background:#1f2c10;color:#bef264;border:1px solid #84cc1660;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">R · Recent</button>
  <button data-prof="STABLE" class="psb" style="background:#0a2818;color:#6ee7b7;border:1px solid #10b98160;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">S · Stable</button>
  <span id="prof-count" style="color:#94a3b8;font-size:11px;margin-left:auto;"></span>
</div>
</div>

<div class="preset-bar" style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;align-items:center;">
  <strong style="color:#f1f5f9;font-size:12px;">Presets:</strong>
  <button class="preset-btn" data-preset="all-pass">All Pass</button>
  <button class="preset-btn" data-preset="hypergrowth">Hypergrowth</button>
  <button class="preset-btn" data-preset="quality">Quality</button>
  <button class="preset-btn" data-preset="solvency">Solvency-Guard</button>
  <button class="preset-btn" data-preset="value">Value</button>
  <button class="preset-btn" data-preset="clear">Clear</button>
</div>
<div class="filter-bar">
  <strong style="color:#f1f5f9;font-size:12px;">Pass/Fail Filter:</strong>
  ${methods.filter(m => MT_local.isCore(m.id) || MT_local.isDataGuard(m.id)).map(m => `<label data-filter="${m.id}"><input type="checkbox" data-method="${m.id}"> ${escHtml(m.label)}</label>`).join('')}
  <span class="filter-mode">Mode: <select id="filter-mode" style="background:#0f172a;color:#cbd5e1;border:1px solid #334155;padding:2px 6px;border-radius:3px;font-size:11px;"><option value="AND">AND</option><option value="OR">OR</option></select></span>
  <span class="filter-mode" id="visible-count">Showing all ${rows.length}</span>
</div>

<!-- ===== METRIC DEEP-DIVE ===== -->
<div class="deep-dive-section">
  <h2>Metric Deep-Dive — Top ${TOP_DD} per Kennzahl</h2>
  <div class="sub">Ranking nach einzelnen Kennzahlen. Farbe: hellgrün = knapp über Schwelle, grün = deutlich drüber, orange = knapp drunter, rot = klar drunter.</div>
  ${deepDiveHtml}
</div>

${sectorHtml}

<h2 style="color:#f1f5f9;font-size:18px;margin:24px 0 8px;border-bottom:1px solid #334155;padding-bottom:6px;">Top ${TOP_N} per Method (Discovery)</h2>
<div class="sub" style="margin-bottom:14px;">Pro Methode die ${TOP_N} Stocks mit besten Werten. Klick auf eine Methode-Karte für Top-${TOP_N}.</div>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-bottom:30px;">
${methods.filter(m => MT_local.isCore(m.id)).map(m => {
  const list = methodTopLists[m.id] || [];
  if (list.length === 0) return '';
  const opSym = m.thresholdOp === 'gte' ? '↑' : (m.thresholdOp === 'lte' ? '↓' : '|·|↓');
  return '<details class="topm-card" data-card-method="' + m.id + '" style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:12px;"><summary style="cursor:pointer;color:#f1f5f9;font-weight:600;font-size:13px;">'
       + escHtml(m.label) + ' <span class="topm-summary-count" style="color:#94a3b8;font-weight:400;font-size:11px;">' + opSym + ' (top ' + Math.min(list.length, TOP_N) + ')</span>'
       + '<div style="font-size:9px;color:#64748b;margin-top:2px;">Quality-Flags: P=Prof-State · R=ROIC · Pe=FwdPE · S=Sloan · E=EV/EBITDA</div></summary>'
       + '<div style="margin-top:8px;font-size:11px;color:#cbd5e1;">'
       + list.slice(0, TOP_N).map((r, i) => {
           const res = r.results[m.id];
           const v = res.value;
           // Component breakdown for Rule-of-40 / Rule-of-X style methods
           let valDisplay;
           if (res.components && res.components.growth != null && res.components.fcfMargin != null) {
             const g = res.components.growth, f = res.components.fcfMargin;
             if (res.components.multiplier != null) {
               // Rule of X: 1.5×growth + fcfMargin
               valDisplay = res.components.multiplier + '×' + g.toFixed(0) + ' + ' + f.toFixed(0) + ' = ' + v.toFixed(0);
             } else {
               // Rule of 40: growth + fcfMargin
               valDisplay = g.toFixed(0) + '% + ' + f.toFixed(0) + '% = ' + v.toFixed(0);
             }
           } else {
             valDisplay = (m.unit === 'percent') ? v.toFixed(1) + '%' :
                          (m.unit === 'ratio' && Math.abs(v) < 1) ? (v*100).toFixed(2) + '%' :
                          v.toFixed(2);
           }
           const valColor = metricColor(v, m.threshold, m.thresholdOp !== 'lte' && m.thresholdOp !== 'lte_abs');
           // Tag-89 Quality-Flags
           function flagSym(mid, sym) {
             const res2 = r.results[mid];
             if (!res2) return '';
             if (!res2.computable) return '<span title="' + mid + ': n/a" style="color:#475569;font-size:9px;margin:0 1px;">' + sym + '·</span>';
             const color2 = res2.pass ? '#10b981' : '#ef4444';
             const mark = res2.pass ? '✓' : '✗';
             return '<span title="' + mid + '" style="color:' + color2 + ';font-size:9px;margin:0 1px;font-weight:600;">' + sym + mark + '</span>';
           }
           function profStateBadge(rowR) {
             const ps = rowR.results['profitability-state'];
             if (!ps || !ps.computable) return '<span title="profitability-state: n/a" style="color:#475569;font-size:9px;margin:0 1px;">P·</span>';
             const state = ps.components && ps.components.state;
             const map = { LOSS: { c: '#ef4444', l: 'L' }, TURNAROUND: { c: '#f59e0b', l: 'T' }, RECENT: { c: '#84cc16', l: 'R' }, STABLE: { c: '#10b981', l: 'S' } };
             const mm = map[state] || { c: '#94a3b8', l: '?' };
             return '<span title="profitability-state=' + state + '" style="color:' + mm.c + ';font-size:9px;margin:0 1px;font-weight:700;">' + mm.l + '</span>';
           }
           const flags = profStateBadge(r) + flagSym('roic', 'R') + flagSym('forward-pe', 'Pe') + flagSym('sloan-ratio', 'S') + flagSym('ev-ebitda', 'E');
           // Tag-92b: data-passes für Filter-Reaktion
           const passMap = {};
           for (const [mid2, res2] of Object.entries(r.results)) passMap[mid2] = res2.computable && res2.pass === true;
           const passDataAttr = encodeURIComponent(JSON.stringify(passMap));
           // Tag 98c: data-prof-state für Profitability-Filter
           const psRes = r.results['profitability-state'];
           const profState = (psRes && psRes.computable && psRes.components) ? psRes.components.state : 'NA';
           return '<div class="topm-row" data-ticker="' + escHtml(r.ticker) + '" data-passes="' + passDataAttr + '" data-prof-state="' + profState + '"'
                + ' data-ro40="' + (r.ruleOf40Value != null ? r.ruleOf40Value : '') + '"'
                + ' data-rox="' + (r.ruleOfXValue != null ? r.ruleOfXValue : '') + '"'
                + ' data-growth="' + (r.growthYoYFromRo40 != null ? r.growthYoYFromRo40 : '') + '"'
                + ' data-fcfmargin="' + (r.fcfMarginFromRo40 != null ? r.fcfMarginFromRo40 : '') + '"'
                + ' data-roic="' + (r.roicPct != null ? r.roicPct : '') + '"'
                + ' style="padding:3px 0;border-bottom:1px solid #131c2b;display:flex;align-items:center;gap:4px;">'
                + '<span style="color:#94a3b8;width:24px;flex-shrink:0;">#' + (i+1) + '</span>'
                + '<strong style="color:#f1f5f9;min-width:55px;">' + escHtml(r.ticker) + '</strong>'
                + '<span style="color:#64748b;flex:1;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml((r.name || '').slice(0, 16)) + '</span>'
                + '<span style="white-space:nowrap;font-size:9px;">' + flags + '</span>'
                + '<span style="color:' + valColor + ';min-width:90px;text-align:right;font-size:10px;font-weight:700;" title="' + escHtml(res.reason || '') + '">' + escHtml(valDisplay) + '</span>'
                + '</div>';
         }).join('')
       + '</div></details>';
}).join('')}
</div>

<h2 style="color:#f1f5f9;font-size:18px;margin:24px 0 8px;border-bottom:1px solid #334155;padding-bottom:6px;">Top-Picks (Pass-Count-Ranking)</h2>
<div class="sub" style="margin-bottom:8px;">Stocks gerankt nach Pass-Count. Klick auf eine Reihe für Details. Rule-of-40 Spalte zeigt: <strong style="color:#10b981;">Growth% + FCF-Margin% = Score</strong> — so siehst du sofort warum ein Stock ranking-technisch gut oder schlecht abschneidet.</div>
<table id="top-picks" style="margin-bottom:30px;">
<thead><tr>
  <th data-sort-tp="rank">Rank</th>
  <th data-sort-tp="ticker">Ticker</th>
  <th data-sort-tp="name">Name</th>
  <th data-sort-tp="passcount">Pass / Comp</th>
  <th data-sort-tp="sector">Sector</th>
  <th data-sort-tp="ro40" title="Rule of 40 = Revenue Growth YoY + FCF Margin. Klick zum Sortieren.">Rule of 40<div class="threshold">growth% + FCF%</div></th>
  <th data-sort-tp="growth" title="Revenue Growth YoY">Rev Growth</th>
  <th data-sort-tp="fcfmargin" title="FCF Margin TTM">FCF Margin</th>
  <th>Failed Methods</th>
</tr></thead>
<tbody id="top-picks-tbody">${topPicksRows}</tbody>
</table>

<div id="modal-overlay" class="modal-overlay">
  <div class="modal">
    <button class="close" onclick="document.getElementById('modal-overlay').classList.remove('open');">×</button>
    <div id="modal-content">Loading...</div>
  </div>
</div>

<details style="margin-top:30px;"><summary style="cursor:pointer;color:#f1f5f9;font-size:16px;font-weight:700;padding:12px;background:#1e293b;border:1px solid #334155;border-radius:8px;margin-bottom:8px;">Full Matrix Tabelle (klicken zum Aufklappen)</summary><table id="matrix">
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
  var tbody = document.querySelector('#matrix tbody');
  var tpTbody = document.getElementById('top-picks-tbody');
  var checkboxes = document.querySelectorAll('.filter-bar input[type=checkbox]');
  var modeSelect = document.getElementById('filter-mode');
  var countEl = document.getElementById('visible-count');
  var totalRows = tbody.querySelectorAll('tr').length;

  // ===== METRIC VALUE FILTERS =====
  var mvfSliders = {
    'ro40':   { el: document.getElementById('mvf-ro40'),   valEl: document.getElementById('mvf-ro40-val'),   labelEl: document.getElementById('mvf-ro40-label'),   attr: 'ro40',      min: -50, suffix: '',  label: 'Rule of 40' },
    'rox':    { el: document.getElementById('mvf-rox'),    valEl: document.getElementById('mvf-rox-val'),    labelEl: document.getElementById('mvf-rox-label'),    attr: 'rox',       min: -50, suffix: '',  label: 'Rule of X' },
    'growth': { el: document.getElementById('mvf-growth'), valEl: document.getElementById('mvf-growth-val'), labelEl: document.getElementById('mvf-growth-label'), attr: 'growth',    min: -30, suffix: '%', label: 'Rev Growth YoY' },
    'fcf':    { el: document.getElementById('mvf-fcf'),    valEl: document.getElementById('mvf-fcf-val'),    labelEl: document.getElementById('mvf-fcf-label'),    attr: 'fcfmargin', min: -50, suffix: '%', label: 'FCF Margin' },
    'roic':   { el: document.getElementById('mvf-roic'),   valEl: document.getElementById('mvf-roic-val'),   labelEl: document.getElementById('mvf-roic-label'),   attr: 'roic',      min: -20, suffix: '%', label: 'ROIC' },
  };

  function getMvfThresholds() {
    var t = {};
    for (var k in mvfSliders) {
      var s = mvfSliders[k];
      t[k] = { min: parseFloat(s.el.value), isActive: parseFloat(s.el.value) > parseFloat(s.el.min) };
    }
    return t;
  }

  function updateMvfLabels() {
    var t = getMvfThresholds();
    for (var k in mvfSliders) {
      var s = mvfSliders[k];
      var thresh = t[k];
      if (thresh.isActive) {
        s.valEl.textContent = '≥ ' + thresh.min.toFixed(0) + s.suffix;
        s.labelEl.classList.add('active-filter');
        s.valEl.classList.add('active-filter');
      } else {
        s.valEl.textContent = '(off)';
        s.labelEl.classList.remove('active-filter');
        s.valEl.classList.remove('active-filter');
      }
    }
  }

  function applyMvFilter() {
    updateMvfLabels();
    var t = getMvfThresholds();
    var anyActive = Object.values ? Object.values(t).some(function(x){ return x.isActive; }) : false;
    if (!anyActive) {
      // clear all mv-hidden
      document.querySelectorAll('.mv-hidden').forEach(function(el){ el.classList.remove('mv-hidden'); });
      document.getElementById('mvf-count').textContent = '';
      return;
    }

    var visTP = 0, totalTP = 0;
    tpTbody.querySelectorAll('tr').forEach(function(tr) {
      totalTP++;
      var show = true;
      for (var k in mvfSliders) {
        var s = mvfSliders[k];
        var thresh = t[k];
        if (!thresh.isActive) continue;
        var raw = tr.dataset[s.attr];
        if (raw === '' || raw == null) { show = false; break; } // no data = filtered out
        var val = parseFloat(raw);
        if (isNaN(val) || val < thresh.min) { show = false; break; }
      }
      tr.classList.toggle('mv-hidden', !show);
      if (show) visTP++;
    });

    document.querySelectorAll('.topm-row').forEach(function(tr) {
      var show = true;
      for (var k in mvfSliders) {
        var s = mvfSliders[k];
        var thresh = t[k];
        if (!thresh.isActive) continue;
        var raw = tr.dataset[s.attr];
        if (raw === '' || raw == null) { show = false; break; }
        var val = parseFloat(raw);
        if (isNaN(val) || val < thresh.min) { show = false; break; }
      }
      tr.classList.toggle('mv-hidden', !show);
    });

    // Update topm-card counts
    document.querySelectorAll('.topm-card').forEach(function(card) {
      var total2 = card.querySelectorAll('.topm-row').length;
      var vis2 = card.querySelectorAll('.topm-row:not(.mv-hidden):not(.prof-hidden):not(.hidden):not(.pc-hidden)').length;
      var sum = card.querySelector('.topm-summary-count');
      if (sum) sum.textContent = anyActive ? '(' + vis2 + '/' + total2 + ' nach Metric-Filter)' : '(top ' + total2 + ')';
    });

    document.getElementById('mvf-count').textContent = 'Top-Picks: ' + visTP + ' / ' + totalTP + ' nach Metric-Filter';
  }

  // Wire sliders
  for (var k in mvfSliders) {
    (function(key) {
      mvfSliders[key].el.addEventListener('input', applyMvFilter);
    })(k);
  }
  document.getElementById('mvf-reset-btn').addEventListener('click', function() {
    for (var k in mvfSliders) {
      var s = mvfSliders[k];
      s.el.value = s.el.min; // reset to minimum (= off)
    }
    applyMvFilter();
  });
  updateMvfLabels(); // init display

  // ===== PASS/FAIL CHECKBOX FILTER =====
  function applyFilter() {
    var active = Array.from(checkboxes).filter(function(c){ return c.checked; }).map(function(c){ return c.dataset.method; });
    var mode = modeSelect.value;

    document.querySelectorAll('.filter-bar label').forEach(function(l) {
      var cb = l.querySelector('input');
      l.classList.toggle('active', cb && cb.checked);
    });

    var visible = 0;
    tbody.querySelectorAll('tr').forEach(function(tr) {
      var show = true;
      if (active.length > 0) {
        var passes = active.map(function(m) {
          var cell = tr.querySelector('[data-method="' + m + '"]');
          return cell && cell.dataset.pass === 'true';
        });
        if (mode === 'AND') show = passes.every(function(p){ return p; });
        else show = passes.some(function(p){ return p; });
      }
      tr.classList.toggle('hidden', !show);
      if (show) visible++;
    });

    countEl.textContent = active.length === 0
      ? 'Showing all ' + totalRows
      : 'Showing ' + visible + ' / ' + totalRows + ' (filter: ' + active.join(' ' + mode + ' ') + ')';

    // Tag-92b: Top-50-Cards reagieren auf Filter
    document.querySelectorAll('.topm-card').forEach(function(card) {
      var cardVisible = 0, cardTotal = 0;
      card.querySelectorAll('.topm-row').forEach(function(row) {
        cardTotal++;
        var show2 = true;
        if (active.length > 0) {
          var passData = {};
          try { passData = JSON.parse(decodeURIComponent(row.dataset.passes || '%7B%7D')); } catch(e) {}
          var passes2 = active.map(function(m){ return passData[m] === true; });
          if (mode === 'AND') show2 = passes2.every(function(p){ return p; });
          else show2 = passes2.some(function(p){ return p; });
        }
        row.style.display = show2 ? '' : 'none';
        if (show2) cardVisible++;
      });
      var summary = card.querySelector('.topm-summary-count');
      if (summary && active.length > 0) {
        summary.textContent = '(' + cardVisible + ' / ' + cardTotal + ' nach Filter)';
      } else if (summary) {
        summary.textContent = '(top ' + cardTotal + ')';
      }
    });
  }

  // ===== PROFITABILITY FILTER =====
  var profActive = 'ALL';
  document.querySelectorAll('.psb').forEach(function(btn) {
    btn.addEventListener('click', function() {
      profActive = btn.dataset.prof;
      document.querySelectorAll('.psb').forEach(function(b){ b.classList.remove('psb-active'); });
      btn.classList.add('psb-active');
      applyProfFilter();
    });
  });
  function applyProfFilter() {
    document.querySelectorAll('#matrix tbody tr').forEach(function(tr) {
      var ps = tr.dataset.profState || 'NA';
      var visible = profActive === 'ALL' || ps === profActive;
      tr.classList.toggle('prof-hidden', !visible);
    });
    document.querySelectorAll('#top-picks-tbody tr').forEach(function(tr) {
      var ps = tr.dataset.profState || 'NA';
      var visible = profActive === 'ALL' || ps === profActive;
      tr.classList.toggle('prof-hidden', !visible);
    });
    document.querySelectorAll('.topm-row').forEach(function(tr) {
      var ps = tr.dataset.profState || 'NA';
      var visible = profActive === 'ALL' || ps === profActive;
      tr.classList.toggle('prof-hidden', !visible);
    });
    var c = document.getElementById('prof-count');
    if (c) c.textContent = profActive === 'ALL' ? '' : 'Filter: ' + profActive;
    document.querySelectorAll('.topm-card').forEach(function(card) {
      var total2 = card.querySelectorAll('.topm-row').length;
      var visible2 = card.querySelectorAll('.topm-row:not(.prof-hidden):not(.pc-hidden):not(.hidden):not(.mv-hidden)').length;
      var sum = card.querySelector('.topm-summary-count');
      if (sum && profActive !== 'ALL') sum.textContent = ' (' + visible2 + '/' + total2 + ' nach Profit-Filter)';
    });
  }
  if (!document.getElementById('prof-style')) {
    var s = document.createElement('style');
    s.id = 'prof-style';
    s.textContent = '.prof-hidden { display: none !important; } .psb-active { outline: 2px solid #f1f5f9; }';
    document.head.appendChild(s);
  }
  checkboxes.forEach(function(cb){ cb.addEventListener('change', applyFilter); });
  modeSelect.addEventListener('change', applyFilter);

  // ===== PASS-COUNT FILTER =====
  var pcInput = document.getElementById('passcount-filter');
  var pcCount = document.getElementById('quick-count');
  function applyPassCount() {
    var min = parseInt(pcInput.value) || 0;
    var allRows = document.querySelectorAll('#matrix tbody tr, #top-picks-tbody tr');
    var visible = 0, total = 0;
    allRows.forEach(function(tr) {
      try {
        var data = JSON.parse(decodeURIComponent(tr.dataset.row));
        var passCount = 0;
        for (var key in data.results) {
          var rr = data.results[key];
          if (rr.computable && rr.pass) passCount++;
        }
        var show = passCount >= min;
        tr.classList.toggle('pc-hidden', !show);
        total++;
        if (show && !tr.classList.contains('hidden')) visible++;
      } catch(e) { /* skip rows without data */ }
    });
    if (pcCount) pcCount.textContent = min === 0 ? '' : (visible + ' / ' + total + ' ≥ ' + min + ' pass');
  }
  if (pcInput) pcInput.addEventListener('input', applyPassCount);
  document.querySelectorAll('.pcb').forEach(function(b) {
    b.addEventListener('click', function() {
      pcInput.value = b.dataset.passcount;
      applyPassCount();
    });
  });

  // ===== FILTER PRESETS =====
  var presetMap = {
    'all-pass': ['rule-of-40','rule-of-x','roic','net-debt-ebitda','sloan-ratio','revenue-growth-3y','fcf-yield','gross-margin-stability'],
    'hypergrowth': ['rule-of-40','rule-of-x','revenue-growth-3y'],
    'quality': ['roic','gross-margin-stability','sloan-ratio'],
    'solvency': ['net-debt-ebitda','sloan-ratio'],
    'value': ['fcf-yield','sloan-ratio'],
    'clear': []
  };
  document.querySelectorAll('.preset-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var preset = btn.dataset.preset;
      var ids = presetMap[preset] || [];
      checkboxes.forEach(function(cb){ cb.checked = ids.indexOf(cb.dataset.method) >= 0; });
      applyFilter();
    });
  });

  // ===== MATRIX TABLE COLUMN SORT =====
  document.querySelectorAll('th[data-sort]').forEach(function(th, idx) {
    th.addEventListener('click', function() {
      var rows2 = Array.from(tbody.querySelectorAll('tr'));
      var dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
      th.dataset.dir = dir;
      rows2.sort(function(a, b) {
        var av = a.cells[idx].textContent.trim();
        var bv = b.cells[idx].textContent.trim();
        var an = parseFloat(av.replace(/[^0-9.-]/g, ''));
        var bn = parseFloat(bv.replace(/[^0-9.-]/g, ''));
        if (!isNaN(an) && !isNaN(bn)) return dir === 'asc' ? an - bn : bn - an;
        return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
      rows2.forEach(function(r){ tbody.appendChild(r); });
    });
  });

  // ===== TOP PICKS TABLE SORT =====
  var tpSortAttrMap = {
    'rank':      null,   // no-op (natural order)
    'ticker':    'ticker-text',
    'name':      'name-text',
    'passcount': 'passcount-num',
    'sector':    'sector-text',
    'ro40':      'ro40',
    'growth':    'growth',
    'fcfmargin': 'fcfmargin',
    'roic':      'roic'
  };
  document.querySelectorAll('th[data-sort-tp]').forEach(function(th) {
    th.style.cursor = 'pointer';
    th.title = (th.title || '') + ' — klick zum Sortieren';
    th.addEventListener('click', function() {
      var key = th.dataset.sortTp;
      if (key === 'rank') return;
      var dir = th.dataset.dir === 'desc' ? 'asc' : 'desc';
      th.dataset.dir = dir;
      // reset other headers
      document.querySelectorAll('th[data-sort-tp]').forEach(function(h){
        if (h !== th) delete h.dataset.dir;
        h.style.background = '';
      });
      th.style.background = '#1a2436';

      var tpRows = Array.from(tpTbody.querySelectorAll('tr'));
      tpRows.sort(function(a, b) {
        var av, bv;
        if (key === 'ticker') {
          av = a.cells[1].textContent.trim();
          bv = b.cells[1].textContent.trim();
          return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        if (key === 'name') {
          av = a.cells[2].textContent.trim();
          bv = b.cells[2].textContent.trim();
          return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        if (key === 'passcount') {
          av = parseInt(a.cells[3].textContent) || 0;
          bv = parseInt(b.cells[3].textContent) || 0;
          return dir === 'asc' ? av - bv : bv - av;
        }
        if (key === 'sector') {
          av = a.cells[4].textContent.trim();
          bv = b.cells[4].textContent.trim();
          return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        // numeric data-attribute sorts
        var attrMap = { 'ro40': 'ro40', 'growth': 'growth', 'fcfmargin': 'fcfmargin', 'roic': 'roic' };
        var attr = attrMap[key];
        if (attr) {
          av = parseFloat(a.dataset[attr]);
          bv = parseFloat(b.dataset[attr]);
          if (isNaN(av) && isNaN(bv)) return 0;
          if (isNaN(av)) return 1;  // no data → bottom
          if (isNaN(bv)) return -1;
          return dir === 'asc' ? av - bv : bv - av;
        }
        return 0;
      });
      tpRows.forEach(function(r){ tpTbody.appendChild(r); });
    });
  });

  // ===== METHOD COLUMN SORT (matrix) =====
  document.querySelectorAll('th.method-col').forEach(function(th) {
    th.addEventListener('click', function() {
      var m = th.dataset.method;
      var rows2 = Array.from(tbody.querySelectorAll('tr'));
      var dir = th.dataset.dir === 'desc' ? 'asc' : 'desc';
      th.dataset.dir = dir;
      rows2.sort(function(a, b) {
        var ac = a.querySelector('[data-method="' + m + '"]');
        var bc = b.querySelector('[data-method="' + m + '"]');
        var av = parseFloat(ac.dataset.value);
        var bv = parseFloat(bc.dataset.value);
        if (isNaN(av) && isNaN(bv)) return 0;
        if (isNaN(av)) return 1;
        if (isNaN(bv)) return -1;
        return dir === 'asc' ? av - bv : bv - av;
      });
      rows2.forEach(function(r){ tbody.appendChild(r); });
    });
  });

  // ===== MODAL DETAIL-VIEW =====
  var modal = document.getElementById('modal-overlay');
  var modalContent = document.getElementById('modal-content');
  document.querySelectorAll('tr.row-clickable').forEach(function(tr) {
    tr.addEventListener('click', function(e) {
      if (!tr.dataset.row) return;
      var data;
      try { data = JSON.parse(decodeURIComponent(tr.dataset.row)); } catch(e2) { return; }
      var html = '<h3>' + data.ticker + ' — ' + data.name + '</h3>';
      html += '<div class="stock-meta-row">' + data.sector + ' · MCap ' + (data.marketCap ? '$' + (data.marketCap/1e9).toFixed(1) + 'B' : '—') +
              ' · Rev TTM ' + (data.revenueTTM ? '$' + (data.revenueTTM/1e9).toFixed(1) + 'B' : '—') +
              ' · Growth YoY ' + (data.growthYoY != null ? data.growthYoY.toFixed(1) + '%' : '—') + '</div>';
      html += '<table><thead><tr><th>Method</th><th>Value</th><th>Pass</th><th>Trend</th><th>Calc / Components</th></tr></thead><tbody>';
      for (var mid in data.results) {
        var r = data.results[mid];
        var t = data.trends[mid] || { direction: 'n/a', points: 0 };
        var trIcon = { improving: '↑', deteriorating: '↓', stable: '·', 'n/a': '—' }[t.direction] || '—';
        var compStr = '';
        if (r.components) {
          var parts = [];
          for (var ck in r.components) {
            parts.push(ck + '=' + (typeof r.components[ck] === 'number' ? r.components[ck].toFixed(2) : r.components[ck]));
          }
          if (parts.length) compStr = ' [' + parts.join(', ') + ']';
        }
        html += '<tr>'
              + '<td class="method-name">' + mid + '</td>'
              + '<td>' + (r.value != null && isFinite(r.value) ? r.value.toFixed(3) : '—') + '</td>'
              + '<td>' + (r.computable ? (r.pass ? '<span style="color:#10b981;">✓</span>' : '<span style="color:#ef4444;">✗</span>') : '—') + '</td>'
              + '<td>' + trIcon + ' (' + t.points + ' pts)' + '</td>'
              + '<td class="calc">' + (r.reason || '') + compStr + '</td>'
              + '</tr>';
      }
      html += '</tbody></table>';
      modalContent.innerHTML = html;
      modal.classList.add('open');
    });
  });
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.classList.remove('open'); });

})();
</script>

</body></html>`;
}

function main() {
  const args = parseArgs(process.argv);
  console.log(`Loading snapshots from ${args.snapshots}...`);
  const rows = evaluateAllStocks(args);
  console.log(`Evaluated ${rows.length} stocks`);
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
