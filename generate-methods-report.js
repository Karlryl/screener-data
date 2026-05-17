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
// Tag 221c (audit F-GR-009 LOW fix): atomic main-output write.
const { writeFileAtomic } = require('./lib/atomic-write.js');

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
  // Tag 220 (audit F-GR-003 HIGH fix): guard null/undefined explicitly.
  // String(null) → 'null', String(undefined) → 'undefined' — both render
  // literally in output. Latent today (upstream `||` guards mostly cover)
  // but one schema change away from leaking through. Other generators
  // (generate-modes-report.js, generate-screener.js) already guard.
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function evaluateAllStocks(args) {
  // Tag 220 (audit F-GR-002 HIGH fix): filter '_*' prefix (not just
  // _manifest.json). _manifest-full.json was being read as a phantom ticker
  // and showing up in Top-Picks output. Same fix applies to other discovery
  // generators (modes / screener) which use the same broken filter.
  const files = fs.readdirSync(args.snapshots).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  let methodHistory = {};
  // F-SM-018 (Tag 180): methodHistory was moved to the sidecar file
  // method-history-state.json in F-SM-007. Reading from alert-state.json
  // now returns undefined → trend column was permanently empty. Read sidecar
  // first, fall back to alert-state for legacy state files.
  const sidecarPath = path.join(path.dirname(args.state), 'method-history-state.json');
  if (fs.existsSync(sidecarPath)) {
    try {
      const sc = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
      if (sc && sc.methodHistory && typeof sc.methodHistory === 'object') {
        methodHistory = sc.methodHistory;
      }
    } catch (e) { /* ignore */ }
  }
  if (!Object.keys(methodHistory).length && fs.existsSync(args.state)) {
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
    // Tag 221c (audit F-GR-005 fix): use `?? null` instead of `|| null` so
    // legitimate zero values (0% growth, $0 revenue for a freshly-spun
    // entity, exactly 0 FCF margin) are preserved instead of being coerced
    // to null and dropped from the deep-dive/leaderboard tables.
    rows.push({
      ticker,
      name: (stock.meta && stock.meta.name) || ticker,
      sector: (stock.meta && stock.meta.sector) || '—',
      marketCap: (stock.marketCap && stock.marketCap.value != null) ? stock.marketCap.value : null,
      revenueTTM: (stock.metrics && stock.metrics.revenueTTM && stock.metrics.revenueTTM.value != null) ? stock.metrics.revenueTTM.value : null,
      growthYoY: (stock.metrics && stock.metrics.revenueGrowthYoY && stock.metrics.revenueGrowthYoY.value != null) ? stock.metrics.revenueGrowthYoY.value : null,
      fcfMargin: (stock.metrics && stock.metrics.fcfMarginTTM && stock.metrics.fcfMarginTTM.value != null) ? stock.metrics.fcfMarginTTM.value : null,
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
    // Tag 221c (audit F-GR-005 fix): use explicit `!= null` check so zero is preserved.
    lastRow.grossMargin = (stock.metrics && stock.metrics.grossMargin && stock.metrics.grossMargin.value != null) ? stock.metrics.grossMargin.value : null;
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
  // Tag 221c (audit F-GR-007 fix): honor RUN_DATE_UTC so all reports built
  // in the same workflow run share the same date stamp even if the run
  // straddles 00:00 UTC. Falls back to current time when env not set.
  const runDate = process.env.RUN_DATE_UTC;
  const generatedAt = runDate
    ? runDate + ' (RUN_DATE_UTC)'
    : new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
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
  // Tag 220 (audit F-GR-001 CRITICAL fix): previously rendered ALL rows
  // (~3528 today, would be ~19k at full universe). Each row embeds the
  // entire results+trends object as URI-encoded JSON in data-row=,
  // producing a 267MB HTML output verified by smoke-test. At 19k tickers
  // it would exceed 1.3GB and crash artifact upload. Slice to TOP_PICKS_N
  // — the report's purpose is the top picks, not a 19k-ticker dump.
  //
  // Tag 221c (audit F-GR-001 followup): even after the slice, methods-report
  // remained ~69MB because each of the 200 rows still embedded a
  // URI-encoded JSON blob (~280KB per row of results+trends). Replaced with
  // a shared STOCK_DATA_MAP (same pattern modes-report uses per F-PF-006)
  // — the modal/passCount filter now reads STOCK_DATA_MAP[ticker]. Drops
  // output to <5MB.
  const TOP_PICKS_N = 200;
  const topPicksRanked = ranked.slice(0, TOP_PICKS_N);
  const stockDataMap = {};
  // Tag 222b (audit Tag 221a F1 followup): slim each STOCK_DATA_MAP entry.
  // Previously embedded the full results[mid] blob — which carries
  // `threshold, thresholdOp, methodType, confidence, dataAsOf, dataAgeDays,
  // sectorPercentile, flags` fields the modal/filter JS never reads. With
  // 200 tickers × 80 methods, those extra fields added ~5MB to the output.
  // Keep only what the modal + pc-filter actually consume.
  for (const r of topPicksRanked) {
    if (stockDataMap[r.ticker]) continue;
    const slimResults = {};
    for (const mid in r.results) {
      const res = r.results[mid];
      if (!res) continue;
      // Tag 222b: truncate reason to 120 chars (was unbounded, some methods
      // emit 500+ char explanations). Modal still shows the gist.
      const reasonStr = res.reason ? String(res.reason).slice(0, 120) : '';
      slimResults[mid] = {
        value: res.value,
        computable: res.computable,
        pass: res.pass,
        reason: reasonStr,
        components: res.components
      };
    }
    const slimTrends = {};
    for (const mid in (r.trends || {})) {
      const tr = r.trends[mid];
      if (!tr) continue;
      slimTrends[mid] = { direction: tr.direction, points: tr.points };
    }
    stockDataMap[r.ticker] = {
      ticker: r.ticker, name: r.name, sector: r.sector,
      marketCap: r.marketCap, growthYoY: r.growthYoY, revenueTTM: r.revenueTTM,
      results: slimResults, trends: slimTrends
    };
  }
  const topPicksRows = topPicksRanked.map((r, i) => {
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

    // Tag 221c (audit F-GR-001 followup): per-row data-row blob removed —
    // modal + passCount filter now look up STOCK_DATA_MAP[ticker].
    return `<tr class="row-clickable" data-ticker="${r.ticker}" data-prof-state="${pState}"
        data-ro40="${r.ruleOf40Value != null ? r.ruleOf40Value : ''}"
        data-rox="${r.ruleOfXValue != null ? r.ruleOfXValue : ''}"
        data-growth="${growthV != null ? growthV : ''}"
        data-fcfmargin="${fcfV != null ? fcfV : ''}"
        data-roic="${r.roicPct != null ? r.roicPct : ''}">
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

  // Tag 222b (audit Tag 221a F1 followup): matrix table was the bulk of the
  // remaining ~65MB output. With ~3528 rows × ~43 method cells each carrying
  // a `title=` reason attribute (~15KB/row), the matrix alone was ~50MB and
  // would grow to ~285MB at full 19k-ticker universe. Slice to TOP_MATRIX_N
  // — matrix is meant as a "ranked exploration" surface, not a 19k dump.
  // 300 keeps the file under 10MB; users wanting full ranking should use
  // the top-picks table (200) plus the per-method top-50 cards above.
  // Sort identical to ranked (pass-count desc, then computable desc, then ticker).
  const TOP_MATRIX_N = 300;
  const matrixRanked = [...rows].sort((a, b) => {
    if (b.passCount !== a.passCount) return b.passCount - a.passCount;
    if (b.computableCount !== a.computableCount) return b.computableCount - a.computableCount;
    return a.ticker.localeCompare(b.ticker);
  }).slice(0, TOP_MATRIX_N);
  const tableRows = matrixRanked.map(r => {
    const methodCells = methods.map(m => {
      const result = r.results[m.id];
      if (!result.computable) {
        // Tag 222b (audit Tag 221a F1 followup): drop the per-cell `title=` reason
        // attribute. With 500 rows × ~43 methods × ~250 bytes/title this was
        // ~5MB of pure hover-only text. The reason string is still available
        // via the row-click modal which reads STOCK_DATA_MAP[ticker].results.
        return `<td class="method-cell incomputable" data-method="${m.id}" data-pass="incomputable">—</td>`;
      }
      const klass = result.pass ? 'pass' : 'fail';
      const valStr = fmtValue(result.value, m.unit);
      const trend = r.trends[m.id] || { direction: 'n/a' };
      // Tag 222b: trend icon kept but `title=` on the wrapper span dropped (icon glyph self-explains).
      const trendIcon = ({ improving: '<span class="trend-up">↑</span>',
                          deteriorating: '<span class="trend-down">↓</span>',
                          stable: '<span class="trend-flat">·</span>',
                          'n/a': '' })[trend.direction] || '';
      return `<td class="method-cell ${klass}" data-method="${m.id}" data-pass="${result.pass}" data-value="${result.value}">${valStr} ${trendIcon}</td>`;
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
  // Tag 223c (audit F-222a-4 + F-222a-5 HIGH fix): collapse two rows.filter
  // sweeps per method into a single forward pass. Previously M × N × 2
  // accesses (83 × 19k × 2 ≈ 3.2M at full scale → ~7s per call, called twice
  // in this file). Now M × N once, ~4-5× faster.
  const _methodCounts = {};
  for (const r of rows) {
    for (const m of methods) {
      const c = _methodCounts[m.id] || (_methodCounts[m.id] = { computable: 0, passing: 0 });
      const x = r.results[m.id];
      if (x && x.computable) { c.computable++; if (x.pass) c.passing++; }
    }
  }
  const methodSummary = methods.map(m => {
    const c = _methodCounts[m.id] || { computable: 0, passing: 0 };
    return `<div class="msum"><div class="ml">${escHtml(m.label)}</div><div class="mv"><span class="pass-count">${c.passing}</span> / ${c.computable}</div><div class="mh">pass / computable (${rows.length} total)</div></div>`;
  }).join('');

  // ===== KENNZAHL-RANGLISTE =====
  const LEADERBOARD_METRICS = [
    { id: 'rule-of-40',        label: 'Rule of 40',        threshold: 40,  better: 'high',
      getValue: r => { const res = r.results['rule-of-40']; return (res && res.computable && Number.isFinite(res.value)) ? res.value : null; },
      getDisplay: r => { const res = r.results['rule-of-40']; if (!res || !res.computable) return null; if (res.components && res.components.growth != null) return res.components.growth.toFixed(0) + '% + ' + res.components.fcfMargin.toFixed(0) + '% = ' + res.value.toFixed(0); return res.value.toFixed(1); }
    },
    { id: 'rule-of-x',         label: 'Rule of X',         threshold: 50,  better: 'high',
      getValue: r => { const res = r.results['rule-of-x']; return (res && res.computable && Number.isFinite(res.value)) ? res.value : null; },
      getDisplay: r => { const res = r.results['rule-of-x']; if (!res || !res.computable) return null; if (res.components && res.components.growth != null) return '1.5\xD7' + res.components.growth.toFixed(0) + ' + ' + res.components.fcfMargin.toFixed(0) + ' = ' + res.value.toFixed(0); return res.value.toFixed(1); }
    },
    { id: 'roic',              label: 'ROIC',              threshold: 15,  better: 'high',
      getValue: r => { const res = r.results['roic']; return (res && res.computable && Number.isFinite(res.value)) ? res.value * 100 : null; },
      getDisplay: r => { const res = r.results['roic']; return (res && res.computable && Number.isFinite(res.value)) ? (res.value * 100).toFixed(1) + '%' : null; }
    },
    { id: 'rev-growth',        label: 'Rev Growth YoY',    threshold: 20,  better: 'high',
      getValue: r => r.growthYoYFromRo40,
      getDisplay: r => r.growthYoYFromRo40 != null ? r.growthYoYFromRo40.toFixed(1) + '%' : null
    },
    { id: 'fcf-margin',        label: 'FCF Margin',        threshold: 10,  better: 'high',
      getValue: r => r.fcfMarginFromRo40,
      getDisplay: r => r.fcfMarginFromRo40 != null ? r.fcfMarginFromRo40.toFixed(1) + '%' : null
    },
    { id: 'revenue-growth-3y', label: 'Rev Growth 3Y CAGR',threshold: 25,  better: 'high',
      getValue: r => { const res = r.results['revenue-growth-3y']; return (res && res.computable && Number.isFinite(res.value)) ? res.value : null; },
      getDisplay: r => { const res = r.results['revenue-growth-3y']; return (res && res.computable && Number.isFinite(res.value)) ? res.value.toFixed(1) + '%' : null; }
    },
    { id: 'gross-margin',      label: 'Gross Margin',      threshold: 40,  better: 'high',
      getValue: r => r.grossMargin,
      getDisplay: r => r.grossMargin != null ? r.grossMargin.toFixed(1) + '%' : null
    },
    { id: 'fcf-yield',         label: 'FCF Yield',         threshold: 3,   better: 'high',
      getValue: r => { const res = r.results['fcf-yield']; return (res && res.computable && Number.isFinite(res.value)) ? res.value * 100 : null; },
      getDisplay: r => { const res = r.results['fcf-yield']; return (res && res.computable && Number.isFinite(res.value)) ? (res.value * 100).toFixed(2) + '%' : null; }
    },
    { id: 'altman-z',          label: 'Altman Z-Score',    threshold: 2.6, better: 'high',
      getValue: r => { const res = r.results['altman-z-score']; return (res && res.computable && Number.isFinite(res.value)) ? res.value : null; },
      getDisplay: r => { const res = r.results['altman-z-score']; return (res && res.computable && Number.isFinite(res.value)) ? res.value.toFixed(2) : null; }
    },
    { id: 'ev-ebitda',         label: 'EV/EBITDA',         threshold: 20,  better: 'low',
      getValue: r => { const res = r.results['ev-ebitda']; return (res && res.computable && Number.isFinite(res.value)) ? res.value : null; },
      getDisplay: r => { const res = r.results['ev-ebitda']; return (res && res.computable && Number.isFinite(res.value)) ? res.value.toFixed(1) + 'x' : null; }
    },
    { id: 'net-debt',          label: 'Net Debt/EBITDA',   threshold: 2.5, better: 'low',
      getValue: r => { const res = r.results['net-debt-ebitda']; return (res && res.computable && Number.isFinite(res.value)) ? res.value : null; },
      getDisplay: r => { const res = r.results['net-debt-ebitda']; return (res && res.computable && Number.isFinite(res.value)) ? res.value.toFixed(2) + 'x' : null; }
    },
    { id: 'peg',               label: 'PEG (Lynch)',        threshold: 1.5, better: 'low',
      getValue: r => { const res = r.results['peg']; return (res && res.computable && Number.isFinite(res.value)) ? res.value : null; },
      getDisplay: r => { const res = r.results['peg']; return (res && res.computable && Number.isFinite(res.value)) ? res.value.toFixed(2) : null; }
    },
  ];
  const LEADERBOARD_TOP = 30;

  const leaderboardData = LEADERBOARD_METRICS.map(lm => {
    const valid = rows
      .filter(r => lm.getValue(r) != null)
      .map(r => ({ row: r, val: lm.getValue(r), display: lm.getDisplay(r) }));
    if (lm.better === 'high') valid.sort((a, b) => b.val - a.val);
    else valid.sort((a, b) => a.val - b.val);
    return { ...lm, list: valid.slice(0, LEADERBOARD_TOP) };
  });

  function buildLeaderboardPaneHtml(lm) {
    if (lm.list.length === 0) return '<div style="color:#64748b;padding:12px;">Keine Daten verf\xFCgbar.</div>';
    let h = '<table class="kenntl-table"><thead><tr>'
           + '<th style="width:32px;">#</th>'
           + '<th style="width:70px;">Ticker</th>'
           + '<th>Name</th>'
           + '<th style="width:120px;">Sektor</th>'
           + '<th style="width:140px;text-align:right;">' + escHtml(lm.label) + '</th>'
           + '<th style="width:80px;text-align:right;">MCap</th>'
           + '<th style="width:60px;text-align:center;">P/C</th>'
           + '</tr></thead><tbody>';
    for (let i = 0; i < lm.list.length; i++) {
      const { row: r, val, display } = lm.list[i];
      const color = metricColor(val, lm.threshold, lm.better === 'high');
      const passRate = r.computableCount > 0 ? r.passCount + '/' + r.computableCount : '—';
      const profState = (() => { const ps = r.results['profitability-state']; return ps && ps.computable && ps.components ? ps.components.state[0] : '?'; })();
      const profColor = { S: '#10b981', R: '#84cc16', T: '#f59e0b', L: '#ef4444' }[profState] || '#94a3b8';
      h += '<tr class="kenntl-row" data-ticker="' + escHtml(r.ticker) + '">'
         + '<td style="color:#475569;font-size:11px;">' + (i+1) + '</td>'
         + '<td><strong>' + escHtml(r.ticker) + '</strong> <span style="color:' + profColor + ';font-size:9px;font-weight:700;" title="profitability-state">' + profState + '</span></td>'
         + '<td style="color:#94a3b8;font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml((r.name||'').slice(0,30)) + '</td>'
         + '<td style="color:#64748b;font-size:10px;">' + escHtml((r.sector||'').slice(0,16)) + '</td>'
         + '<td style="text-align:right;font-size:16px;font-weight:800;color:' + color + ';" title="' + escHtml(display || '') + '">' + escHtml(display || '—') + '</td>'
         + '<td style="text-align:right;color:#64748b;font-size:10px;">' + fmtMoney(r.marketCap) + '</td>'
         + '<td style="text-align:center;color:#94a3b8;font-size:10px;">' + passRate + '</td>'
         + '</tr>';
    }
    h += '</tbody></table>';
    return h;
  }

  const leaderboardPanesHtml = leaderboardData.map((lm, idx) => {
    const hiddenClass = idx === 0 ? '' : ' kenntl-hidden';
    return '<div id="kp-' + lm.id + '" class="kenntl-pane' + hiddenClass + '">' + buildLeaderboardPaneHtml(lm) + '</div>';
  }).join('\n');

  const kenntlSectionHtml = `<div class="kenntl-section">
  <h2>Kennzahl-Rangliste — Top 30 direkt nach Kennzahl</h2>
  <div class="kenntl-tabs">
    <button class="kt-btn kt-active" data-metric="rule-of-40">Rule of 40</button>
    <button class="kt-btn" data-metric="rule-of-x">Rule of X</button>
    <button class="kt-btn" data-metric="roic">ROIC</button>
    <button class="kt-btn" data-metric="rev-growth">Rev Growth</button>
    <button class="kt-btn" data-metric="fcf-margin">FCF Margin</button>
    <button class="kt-btn" data-metric="revenue-growth-3y">Rev Growth 3Y</button>
    <button class="kt-btn" data-metric="gross-margin">Gross Margin</button>
    <button class="kt-btn" data-metric="fcf-yield">FCF Yield</button>
    <button class="kt-btn" data-metric="altman-z">Altman Z</button>
    <button class="kt-btn" data-metric="ev-ebitda">EV/EBITDA ↓</button>
    <button class="kt-btn" data-metric="net-debt">Net Debt/EBITDA ↓</button>
    <button class="kt-btn" data-metric="peg">PEG ↓</button>
  </div>
  ${leaderboardPanesHtml}
</div>`;

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
  /* Kennzahl-Rangliste */
  .kenntl-section { background: #0d1b2e; border: 1px solid #1d4ed8; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .kenntl-section h2 { color: #f1f5f9; font-size: 16px; margin: 0 0 12px; font-weight: 700; }
  .kenntl-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .kt-btn { background: #1e293b; color: #94a3b8; border: 1px solid #334155; padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600; transition: all 0.15s; }
  .kt-btn:hover { background: #334155; color: #e2e8f0; }
  .kt-btn.kt-active { background: #1d4ed8; color: #fff; border-color: #3b82f6; }
  .kenntl-pane { }
  .kenntl-hidden { display: none; }
  .kenntl-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .kenntl-table th { background: #0f172a; color: #64748b; padding: 6px 8px; border-bottom: 2px solid #1e293b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  .kenntl-table td { padding: 6px 8px; border-bottom: 1px solid #0f172a; }
  .kenntl-row { cursor: pointer; }
  .kenntl-row:hover td { background: #1a2436; }
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

${kenntlSectionHtml}

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
           // Tag-92b: data-passes für Filter-Reaktion.
           // Tag 222b (audit Tag 221a F1 followup): switched from
           // URI-encoded JSON object (every method-id × bool) to a
           // space-separated list of passing method-ids. Cuts per-row
           // payload from ~2.8KB to ~150 bytes (× ~850 rows = ~2.3MB saved).
           // JS filter updated to parse via .split(' ').
           const passList = [];
           for (const [mid2, res2] of Object.entries(r.results)) {
             if (res2.computable && res2.pass === true) passList.push(mid2);
           }
           const passDataAttr = passList.join(' ');
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

<details style="margin-top:30px;"><summary style="cursor:pointer;color:#f1f5f9;font-size:16px;font-weight:700;padding:12px;background:#1e293b;border:1px solid #334155;border-radius:8px;margin-bottom:8px;">Matrix Tabelle (Top ${TOP_MATRIX_N} nach Pass-Count, klicken zum Aufklappen)</summary><table id="matrix">
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
</details>

<script>
// Tag 221c (audit F-GR-001 followup): shared stock-data map keyed by ticker.
// Replaces the per-row 280KB data-row blob (267MB→<5MB output drop).
// Closing-</script> in any string value is escaped via the \\u003c trick.
var STOCK_DATA_MAP = ${JSON.stringify(stockDataMap).replace(/</g, '\\u003c')};
</script>

<script>
(function() {
  var tbody = document.querySelector('#matrix tbody');
  var tpTbody = document.getElementById('top-picks-tbody');
  var checkboxes = document.querySelectorAll('.filter-bar input[type=checkbox]');
  var modeSelect = document.getElementById('filter-mode');
  var countEl = document.getElementById('visible-count');
  var totalRows = tbody.querySelectorAll('tr').length;

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
          // Tag 222b: data-passes is now a space-separated list of passing
          // method-ids (was a URI-encoded JSON object). Build a Set once per
          // row for O(1) lookups.
          var passSet = {};
          var raw = row.dataset.passes || '';
          if (raw) {
            var ids = raw.split(' ');
            for (var i = 0; i < ids.length; i++) passSet[ids[i]] = true;
          }
          var passes2 = active.map(function(m){ return passSet[m] === true; });
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
        // Tag 221c: lookup from shared STOCK_DATA_MAP instead of decoding
        // a per-row blob. STOCK_DATA_MAP only contains top-picks entries;
        // matrix rows without an entry skip silently (same as before).
        var data = STOCK_DATA_MAP[tr.dataset.ticker];
        if (!data) return;
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
  // F-GC-001 (Tag 179): previously concatenated data.ticker / data.name / data.sector
  // / r.reason directly into innerHTML — Yahoo-sourced ticker names with " or <
  // could break the modal or inject HTML. Add a client-side escape helper.
  function escH(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  var modal = document.getElementById('modal-overlay');
  var modalContent = document.getElementById('modal-content');
  document.querySelectorAll('tr.row-clickable').forEach(function(tr) {
    tr.addEventListener('click', function(e) {
      // Tag 221c: lookup from STOCK_DATA_MAP (top-picks only).
      var data = STOCK_DATA_MAP[tr.dataset.ticker];
      if (!data) return;
      var html = '<h3>' + escH(data.ticker) + ' — ' + escH(data.name) + '</h3>';
      html += '<div class="stock-meta-row">' + escH(data.sector) + ' · MCap ' + (data.marketCap ? '$' + (data.marketCap/1e9).toFixed(1) + 'B' : '—') +
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
            parts.push(escH(ck) + '=' + (typeof r.components[ck] === 'number' ? r.components[ck].toFixed(2) : escH(r.components[ck])));
          }
          if (parts.length) compStr = ' [' + parts.join(', ') + ']';
        }
        html += '<tr>'
              + '<td class="method-name">' + escH(mid) + '</td>'
              + '<td>' + (r.value != null && isFinite(r.value) ? r.value.toFixed(3) : '—') + '</td>'
              + '<td>' + (r.computable ? (r.pass ? '<span style="color:#10b981;">✓</span>' : '<span style="color:#ef4444;">✗</span>') : '—') + '</td>'
              + '<td>' + trIcon + ' (' + t.points + ' pts)' + '</td>'
              + '<td class="calc">' + escH(r.reason || '') + compStr + '</td>'
              + '</tr>';
      }
      html += '</tbody></table>';
      modalContent.innerHTML = html;
      modal.classList.add('open');
    });
  });
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.classList.remove('open'); });

  // ===== KENNZAHL-RANGLISTE TABS =====
  document.querySelectorAll('.kt-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.kt-btn').forEach(function(b){ b.classList.remove('kt-active'); });
      btn.classList.add('kt-active');
      document.querySelectorAll('.kenntl-pane').forEach(function(p){ p.classList.add('kenntl-hidden'); });
      var pane = document.getElementById('kp-' + btn.dataset.metric);
      if (pane) pane.classList.remove('kenntl-hidden');
    });
  });
  // Leaderboard row click → open modal (lookup data from STOCK_DATA_MAP)
  document.querySelectorAll('.kenntl-row').forEach(function(tr) {
    tr.addEventListener('click', function() {
      var ticker = tr.dataset.ticker;
      // Tag 221c: lookup directly from STOCK_DATA_MAP (no need to traverse DOM).
      var data = STOCK_DATA_MAP[ticker];
      if (data) {
        try {
          // F-GC-001 (Tag 179): use escH helper above for the leaderboard modal too.
          var html = '<h3>' + escH(data.ticker) + ' — ' + escH(data.name) + '</h3>';
          html += '<div class="stock-meta-row">' + escH(data.sector) + ' · MCap ' + (data.marketCap ? '$' + (data.marketCap/1e9).toFixed(1) + 'B' : '—') + '</div>';
          html += '<table><thead><tr><th>Method</th><th>Value</th><th>Pass</th><th>Trend</th><th>Calc</th></tr></thead><tbody>';
          for (var mid in data.results) {
            var r2 = data.results[mid];
            var t2 = data.trends[mid] || { direction: 'n/a', points: 0 };
            var ti = { improving: '↑', deteriorating: '↓', stable: '·', 'n/a': '—' }[t2.direction] || '—';
            html += '<tr><td class="method-name">' + escH(mid) + '</td>'
                  + '<td>' + (r2.value != null && isFinite(r2.value) ? r2.value.toFixed(3) : '—') + '</td>'
                  + '<td>' + (r2.computable ? (r2.pass ? '<span style="color:#10b981;">✓</span>' : '<span style="color:#ef4444;">✗</span>') : '—') + '</td>'
                  + '<td>' + ti + '</td>'
                  + '<td class="calc">' + escH(r2.reason || '') + '</td></tr>';
          }
          html += '</tbody></table>';
          document.getElementById('modal-content').innerHTML = html;
          document.getElementById('modal-overlay').classList.add('open');
        } catch(e) {}
      }
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
  console.log(`Evaluated ${rows.length} stocks`);
  const methods = Runner.getMethods();
  const html = renderHTML(rows, methods);
  // Tag 221c (audit F-GR-009 LOW fix): atomic write — a CI cancellation
  // mid-write previously left a half-written file that GitHub Pages then
  // served (the file was many MB before Tag 221c's STOCK_DATA_MAP fix).
  writeFileAtomic(args.out, html);
  console.log(`✓ Report written: ${args.out} (${html.length} bytes)`);
  console.log('');
  console.log('Pass-counts per method:');
  // Tag 223c (audit F-222a-4 HIGH fix): collapse two rows.filter sweeps
  // per method into a single forward pass over rows. Previously M × N × 2
  // accesses (83 × 19k × 2 ≈ 3.2M at full scale → ~7s). Now M × N once.
  const passCounts = {};
  for (const r of rows) {
    for (const m of methods) {
      const c = passCounts[m.id] || (passCounts[m.id] = { computable: 0, passing: 0 });
      const x = r.results[m.id];
      if (x && x.computable) { c.computable++; if (x.pass) c.passing++; }
    }
  }
  for (const m of methods) {
    const c = passCounts[m.id] || { computable: 0, passing: 0 };
    console.log(`  ${m.label.padEnd(20)} ${c.passing.toString().padStart(2)} / ${c.computable.toString().padStart(2)} pass / computable`);
  }
}

main();
