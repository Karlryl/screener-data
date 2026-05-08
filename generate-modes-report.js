#!/usr/bin/env node
/**
 * Tag 100g: Modes-Report Generator mit Sub-Filter-Tabs
 * =====================================================
 * Karl-Sprache UI mit Tabs pro Methode INNERHALB jedes Modus.
 *
 * Output-Struktur:
 *   Hypergrowth [heuristisch]
 *     [Rule-of-40] [Rule-of-X] [Revenue-Growth-3y] [Gross-Margin] [Alle MUST]
 *     -> Top-50 Cards sortiert nach gewählter Methode
 *
 *   Quality-Compounder [literaturgestuetzt]
 *     [ROIC] [GM-Stability] [FCF-Yield] [Net-Debt-EBITDA] [Alle MUST]
 *
 *   Turnaround [experimentell] (Phase 2 — disabled)
 *
 * Pro Card: Ticker + Sector + Methodenwert + 1-Satz-Story + max 1 Warnung.
 * DataGuard + Sektor-Filter immer aktiv (egal welcher Tab).
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

// Stocks die fuer einen Modus eligible sind: nicht Sektor-excluded UND alle DataGuards passing
function eligibleForMode(evaluated, modeId) {
  const mode = SM.MODES[modeId];
  return evaluated.filter(ev => {
    if (SM.isExcludedBySector(ev.stock, mode)) return false;
    for (const guardId of mode.dataGuards) {
      const r = ev.allResults[guardId];
      if (r && r.computable === true && r.pass === false) return false;
    }
    return true;
  });
}

// Fuer einen Sub-Tab: sortiere eligible Stocks nach Methodenwert (descending)
function topByMethod(eligible, methodId, methodMeta, topN) {
  const valid = eligible.filter(ev => {
    const r = ev.allResults[methodId];
    return r && r.computable && Number.isFinite(r.value);
  });
  // Sortier-Richtung: gte = descending, lte = ascending
  const op = methodMeta && methodMeta.thresholdOp;
  valid.sort((a, b) => {
    const va = a.allResults[methodId].value;
    const vb = b.allResults[methodId].value;
    return op === 'lte' ? va - vb : vb - va;
  });
  return valid.slice(0, topN);
}

// "Alle MUST" Tab: Stocks die alle MUST-Kriterien des Modus passing
function topAllMust(eligible, modeId, topN) {
  const mode = SM.MODES[modeId];
  const passing = eligible.filter(ev => {
    const me = SM.evaluateMode(ev.stock, modeId, ev.allResults);
    return me.passed;
  });
  // Sortier nach mustPassCount + preferPassCount
  passing.sort((a, b) => {
    const ma = SM.evaluateMode(a.stock, modeId, a.allResults);
    const mb = SM.evaluateMode(b.stock, modeId, b.allResults);
    const sa = (ma.mustPassCount * 10) + ma.preferPassCount;
    const sb = (mb.mustPassCount * 10) + mb.preferPassCount;
    return sb - sa;
  });
  return passing.slice(0, topN);
}

function renderCard(ev, i, modeId, sortMethodId) {
  const s = ev.stock;
  const ticker = (s.meta && s.meta.ticker) || '???';
  const name = (s.meta && s.meta.name) || '';
  const sector = (s.meta && s.meta.sector) || '';
  const mcap = ev.mcap;

  // 1-Satz-Story aus mode evaluation
  const me = SM.evaluateMode(s, modeId, ev.allResults);
  const story = me.passed ? SM.buildStory(s, me, ev.allResults) : null;

  // Sortier-Methodenwert
  const sortMethod = sortMethodId ? Runner.METHODS.find(m => m.id === sortMethodId) : null;
  const sortRes = sortMethodId ? ev.allResults[sortMethodId] : null;
  const sortValDisplay = sortRes && sortRes.computable
    ? `<div style="color:#10b981;font-size:13px;font-weight:700;">${escHtml(fmtValue(sortRes.value, sortMethod && sortMethod.unit))}</div>
       <div style="color:#64748b;font-size:9px;">${escHtml((sortMethod && sortMethod.label) || sortMethodId)}</div>`
    : '';

  // Story-Facts
  let factsHtml = '';
  if (story) {
    const facts = (story.coreSummary || '').split(', ').filter(Boolean).slice(0, 3);
    factsHtml = facts.map(f =>
      `<li style="color:#cbd5e1;font-size:10.5px;line-height:1.4;list-style:none;padding-left:12px;position:relative;">
        <span style="position:absolute;left:0;color:#10b981;">✓</span> ${escHtml(f)}
      </li>`
    ).join('');
  } else {
    // Wenn nicht alle MUST pass: zeige passing/failing per Methode
    factsHtml = `<li style="color:#94a3b8;font-size:10.5px;list-style:none;font-style:italic;">Erfüllt nicht alle MUST-Kriterien dieses Modus</li>`;
  }

  const warningHtml = story && story.warnings ? `<div style="color:#fcd34d;font-size:10px;margin-top:4px;padding-top:4px;border-top:1px solid #334155;">${escHtml(story.warnings)}</div>` : '';

  return `
    <div class="mode-card">
      <div class="mode-card-head">
        <div>
          <div class="mode-card-ticker">${escHtml(ticker)}</div>
          <div class="mode-card-name">${escHtml(name.slice(0, 32))}${name.length>32?'…':''}</div>
        </div>
        <div style="text-align:right;">
          ${sortValDisplay || `<div style="color:#94a3b8;font-size:10px;">#${i+1}</div><div style="color:#10b981;font-size:11px;">${fmtMoney(mcap)}</div>`}
          ${sortValDisplay ? `<div style="color:#64748b;font-size:9px;">#${i+1} · ${fmtMoney(mcap)}</div>` : ''}
        </div>
      </div>
      <div style="color:#94a3b8;font-size:9px;margin-bottom:6px;">${escHtml(sector)}</div>
      <ul class="mode-card-facts">${factsHtml}</ul>
      ${warningHtml}
    </div>
  `;
}

function renderModeSection(modeId, eligible, evaluated, topN) {
  const mode = SM.MODES[modeId];
  const evidenceColor = mode.evidence === 'literaturgestuetzt' ? '#10b981'
                     : mode.evidence === 'heuristisch' ? '#f59e0b' : '#a855f7';

  const headerHtml = `
    <h2 class="mode-section-h2">
      ${escHtml(mode.label)}
      <span style="font-size:11px;padding:3px 10px;border-radius:12px;background:${evidenceColor}25;color:${evidenceColor};border:1px solid ${evidenceColor}60;">
        ${escHtml(mode.evidence)}
      </span>
      <span style="color:#64748b;font-size:13px;font-weight:400;margin-left:auto;">${eligible.length} eligible Stocks</span>
    </h2>
    <div class="mode-section-desc">${escHtml(mode.description)}</div>
    <div class="mode-section-evi">${escHtml(mode.evidenceLabel)}</div>
  `;

  if (mode.enabled === false) {
    return headerHtml + `<div class="mode-section-disabled">Modus in Phase 2 — noch nicht aktiv. Erst Hypergrowth + Quality validieren, dann Turnaround.</div>`;
  }

  // Sub-Tabs: Methode-Liste + "Alle MUST"
  const tabMethods = mode.core.map(c => c.id);
  const tabs = [...tabMethods, '__ALL_MUST__'];
  const defaultTab = tabMethods[0] || '__ALL_MUST__';

  const tabButtonsHtml = tabs.map(tabId => {
    const isAllMust = tabId === '__ALL_MUST__';
    const methodMeta = isAllMust ? null : Runner.METHODS.find(m => m.id === tabId);
    const label = isAllMust ? 'Alle MUST' : (methodMeta && methodMeta.label) || tabId;
    const active = tabId === defaultTab;
    return `<button class="mode-tab-btn ${active ? 'mode-tab-active' : ''}" data-mode="${modeId}" data-tab="${escHtml(tabId)}">${escHtml(label)}</button>`;
  }).join('');

  const panelsHtml = tabs.map(tabId => {
    const isAllMust = tabId === '__ALL_MUST__';
    let cards;
    if (isAllMust) {
      const list = topAllMust(eligible, modeId, topN);
      if (list.length === 0) {
        cards = `<div class="mode-empty">Keine Stocks erfuellen alle MUST-Kriterien dieses Modus. Pruefe einzelne Methoden-Tabs.</div>`;
      } else {
        cards = `<div class="mode-card-grid">${list.map((ev,i) => renderCard(ev, i, modeId, null)).join('')}</div>`;
      }
    } else {
      const methodMeta = Runner.METHODS.find(m => m.id === tabId);
      const list = topByMethod(eligible, tabId, methodMeta, topN);
      if (list.length === 0) {
        cards = `<div class="mode-empty">Keine Stocks mit computable Werten fuer diese Methode.</div>`;
      } else {
        cards = `<div class="mode-card-grid">${list.map((ev,i) => renderCard(ev, i, modeId, tabId)).join('')}</div>`;
      }
    }
    const visible = tabId === defaultTab ? '' : 'display:none;';
    return `<div class="mode-tab-panel" data-mode="${modeId}" data-tab="${escHtml(tabId)}" style="${visible}">${cards}</div>`;
  }).join('');

  return headerHtml + `
    <div class="mode-tabs">${tabButtonsHtml}</div>
    ${panelsHtml}
  `;
}

function buildHtml(evaluated, topN) {
  const generatedAt = new Date().toISOString();
  const modes = ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND'];
  const eligibleByMode = {};
  for (const m of modes) eligibleByMode[m] = eligibleForMode(evaluated, m);

  const sections = modes.map(m => renderModeSection(m, eligibleByMode[m], evaluated, topN)).join('\n');

  const totalStocks = evaluated.length;
  const sectorExcluded = evaluated.length - eligibleByMode.HYPERGROWTH.length;

  return `<!DOCTYPE html>
<html lang="de"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Karl's Stock-Screener — Modi-Discovery</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 28px 24px; min-height: 100vh; }
  h1 { color: #f1f5f9; font-size: 28px; margin: 0 0 4px; font-weight: 700; }
  .container { max-width: 1500px; margin: 0 auto; }
  .sub { color: #94a3b8; font-size: 13px; margin-bottom: 24px; }
  .stats { background: #1e293b; border-left: 4px solid #8b5cf6; padding: 12px 18px; border-radius: 6px; margin-bottom: 24px; font-size: 12px; color: #cbd5e1; display: flex; gap: 24px; flex-wrap: wrap; }
  .footer { color: #64748b; font-size: 11px; text-align: center; margin-top: 48px; padding-top: 16px; border-top: 1px solid #334155; }
  .disclaimer { background: #1f1419; border-left: 4px solid #ef4444; padding: 12px 18px; border-radius: 6px; margin-bottom: 24px; font-size: 12px; color: #fca5a5; }

  .mode-section-h2 { color:#f1f5f9; font-size:22px; margin:32px 0 4px; display:flex; align-items:center; gap:14px; }
  .mode-section-desc { color:#94a3b8; font-size:13px; margin-bottom:6px; }
  .mode-section-evi { color:#64748b; font-size:11px; font-style:italic; margin-bottom:12px; }
  .mode-section-disabled { background:#1e1b3a; border:1px dashed #6b7280; padding:24px; text-align:center; border-radius:8px; color:#94a3b8; font-size:13px; }
  .mode-empty { background:#1e293b; border:1px solid #334155; padding:24px; text-align:center; border-radius:8px; color:#94a3b8; font-size:13px; }

  .mode-tabs { display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap; padding:6px; background:#1e293b; border-radius:6px; }
  .mode-tab-btn { background:#334155; color:#cbd5e1; border:1px solid #475569; padding:6px 12px; border-radius:4px; font-size:11px; cursor:pointer; transition:all 0.15s; font-family:inherit; }
  .mode-tab-btn:hover { background:#475569; color:#f1f5f9; }
  .mode-tab-active { background:#3b82f6 !important; color:white !important; border-color:#2563eb !important; font-weight:600; }

  .mode-card-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:8px; margin-bottom:24px; }
  .mode-card { background:#1e293b; border:1px solid #334155; border-radius:6px; padding:10px; }
  .mode-card-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px; }
  .mode-card-ticker { color:#f1f5f9; font-weight:700; font-size:14px; }
  .mode-card-name { color:#64748b; font-size:9px; line-height:1.3; }
  .mode-card-facts { margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }
</style>
</head><body>
<div class="container">
<h1>📊 Karl's Stock-Screener — Modi-Discovery</h1>
<div class="sub">Generated ${escHtml(generatedAt)} · ${totalStocks} Stocks im Universum (${sectorExcluded} durch Sektor-Filter Banks/REITs/Insurance ausgeschlossen)</div>

<div class="disclaimer">
  <strong>Wichtig:</strong> Dies ist ein <em>Discovery-Tool</em>, kein Backtest-bewiesenes Alpha-System.
  Die Modi sind als strukturierte Ideenquellen konzipiert, nicht als statistisch validierte Outperformance-Garantie.
  Finale Investmententscheidung: dein Deep-Dive (Aktienfinder, Elliott-Wellen, eigene Recherche).
</div>

<div class="stats">
  <span><strong>Universum:</strong> ${totalStocks} Stocks</span>
  <span><strong>Sektor-Ausschluss:</strong> ${sectorExcluded} (Banks/Insurance/REITs)</span>
  <span><strong>Modi:</strong> Hypergrowth · Quality-Compounder · Turnaround (Phase 2)</span>
  <span><strong>Tabs:</strong> klick um nach Methode zu sortieren</span>
</div>

${sections}

<div class="footer">
  Karl's privater Stock-Screener · keine Anlageberatung · Daten via Yahoo Finance · ohne Gewaehr
</div>
</div>
<script>
(function() {
  document.addEventListener('click', function(e) {
    if (!e.target.classList || !e.target.classList.contains('mode-tab-btn')) return;
    const btn = e.target;
    const mode = btn.dataset.mode;
    const tab = btn.dataset.tab;
    // Update buttons in this mode
    document.querySelectorAll('.mode-tab-btn[data-mode="' + mode + '"]').forEach(b => b.classList.remove('mode-tab-active'));
    btn.classList.add('mode-tab-active');
    // Show/hide panels
    document.querySelectorAll('.mode-tab-panel[data-mode="' + mode + '"]').forEach(p => {
      p.style.display = p.dataset.tab === tab ? '' : 'none';
    });
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
