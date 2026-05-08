#!/usr/bin/env node
/**
 * Tag 100: Modes-Report Generator
 * ================================
 * Liest snapshots/, evaluiert pro Mode, exportiert HTML mit 3-Modi-Discovery.
 *
 * Output: modes-report.html
 *   - Hypergrowth-Sektion (heuristisch)
 *   - Quality-Compounder-Sektion (literaturgestuetzt)
 *   - Turnaround-Sektion (experimentell, Phase 2)
 *
 * Pro Stock: 1-Satz-Story + 3 Fakten + max 1 Warnhinweis.
 * Keine Methoden-Lab-UI. Karl-Sprache.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const Runner = require('./methods/runner.js');
const SM = require('./methods/strategy-modes.js');

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './modes-report.html', topN: 25 };
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

function discoveryByMode(evaluated, modeId, topN) {
  const mode = SM.MODES[modeId];
  const passing = [];
  for (const ev of evaluated) {
    const me = SM.evaluateMode(ev.stock, modeId, ev.allResults);
    if (me.passed) {
      const story = SM.buildStory(ev.stock, me, ev.allResults);
      passing.push({ ...ev, modeEval: me, story });
    }
  }
  // Sort by mustPassCount + preferPassCount (descending)
  passing.sort((a, b) => {
    const sa = (a.modeEval.mustPassCount * 10) + a.modeEval.preferPassCount;
    const sb = (b.modeEval.mustPassCount * 10) + b.modeEval.preferPassCount;
    return sb - sa;
  });
  return { mode, candidates: passing.slice(0, topN), totalMatching: passing.length };
}

function renderModeSection(modeResult) {
  const { mode, candidates, totalMatching } = modeResult;
  const evidenceColor = mode.evidence === 'literaturgestuetzt' ? '#10b981'
                     : mode.evidence === 'heuristisch' ? '#f59e0b' : '#a855f7';

  const headerHtml = `
    <h2 style="color:#f1f5f9;font-size:22px;margin:32px 0 4px;display:flex;align-items:center;gap:14px;">
      ${escHtml(mode.label)}
      <span style="font-size:11px;padding:3px 10px;border-radius:12px;background:${evidenceColor}25;color:${evidenceColor};border:1px solid ${evidenceColor}60;">
        ${escHtml(mode.evidence)}
      </span>
      <span style="color:#64748b;font-size:13px;font-weight:400;margin-left:auto;">${candidates.length}/${totalMatching} Kandidaten</span>
    </h2>
    <div style="color:#94a3b8;font-size:13px;margin-bottom:6px;">${escHtml(mode.description)}</div>
    <div style="color:#64748b;font-size:11px;font-style:italic;margin-bottom:16px;">${escHtml(mode.evidenceLabel)}</div>
  `;

  if (mode.enabled === false) {
    return headerHtml + `<div style="background:#1e1b3a;border:1px dashed #6b7280;padding:24px;text-align:center;border-radius:8px;color:#94a3b8;font-size:13px;">Modus in Phase 2 — noch nicht aktiv. Erst Hypergrowth + Quality validieren, dann Turnaround.</div>`;
  }

  if (candidates.length === 0) {
    return headerHtml + `<div style="background:#1e293b;border:1px solid #334155;padding:24px;text-align:center;border-radius:8px;color:#94a3b8;font-size:13px;">Keine Kandidaten erfuellen aktuell alle Kriterien. Pruefe ob Universum oder Methoden-Schwellen zu eng sind.</div>`;
  }

  const cards = candidates.map((c, i) => {
    const s = c.stock;
    const story = c.story;
    const ticker = (s.meta && s.meta.ticker) || '???';
    const name = (s.meta && s.meta.name) || '';
    const sector = (s.meta && s.meta.sector) || '';
    const mcap = c.mcap;

    const factsHtml = (story.coreSummary || '').split(', ').filter(Boolean).slice(0, 3).map(f =>
      `<li style="color:#cbd5e1;font-size:11px;line-height:1.5;list-style:none;padding-left:14px;position:relative;">
        <span style="position:absolute;left:0;color:#10b981;">✓</span> ${escHtml(f)}
      </li>`
    ).join('');

    const warningHtml = story.warnings ? `<div style="color:#fcd34d;font-size:11px;margin-top:6px;padding-top:6px;border-top:1px solid #334155;">${escHtml(story.warnings)}</div>` : '';

    return `
      <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:14px;display:flex;flex-direction:column;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div>
            <div style="color:#f1f5f9;font-weight:700;font-size:15px;">${escHtml(ticker)}</div>
            <div style="color:#64748b;font-size:10px;line-height:1.3;">${escHtml(name.slice(0, 32))}${name.length>32?'…':''}</div>
          </div>
          <div style="text-align:right;">
            <div style="color:#94a3b8;font-size:10px;">#${i+1}</div>
            <div style="color:#10b981;font-size:11px;font-weight:600;">${fmtMoney(mcap)}</div>
          </div>
        </div>
        <div style="color:#94a3b8;font-size:10px;margin-bottom:8px;">${escHtml(sector)}</div>
        <ul style="margin:0;padding:0;display:flex;flex-direction:column;gap:3px;">${factsHtml}</ul>
        ${warningHtml}
      </div>
    `;
  }).join('');

  return headerHtml + `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-bottom:32px;">${cards}</div>`;
}

function buildHtml(evaluated, topN) {
  const generatedAt = new Date().toISOString();
  const modes = ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND'];
  const sections = modes.map(m => renderModeSection(discoveryByMode(evaluated, m, topN))).join('\n');

  // Stats
  const totalStocks = evaluated.length;
  const excludedBySector = evaluated.filter(ev => SM.isExcludedBySector(ev.stock, SM.MODES.HYPERGROWTH)).length;

  return `<!DOCTYPE html>
<html lang="de"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Karl's Stock-Screener — Modi-Discovery</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 28px 24px; min-height: 100vh; }
  h1 { color: #f1f5f9; font-size: 28px; margin: 0 0 4px; font-weight: 700; }
  .container { max-width: 1400px; margin: 0 auto; }
  .sub { color: #94a3b8; font-size: 13px; margin-bottom: 24px; }
  .stats { background: #1e293b; border-left: 4px solid #8b5cf6; padding: 12px 18px; border-radius: 6px; margin-bottom: 24px; font-size: 12px; color: #cbd5e1; display: flex; gap: 24px; flex-wrap: wrap; }
  .footer { color: #64748b; font-size: 11px; text-align: center; margin-top: 48px; padding-top: 16px; border-top: 1px solid #334155; }
  .disclaimer { background: #1f1419; border-left: 4px solid #ef4444; padding: 12px 18px; border-radius: 6px; margin-bottom: 24px; font-size: 12px; color: #fca5a5; }
</style>
</head><body>
<div class="container">
<h1>📊 Karl's Stock-Screener — Modi-Discovery</h1>
<div class="sub">Generated ${escHtml(generatedAt)} · ${totalStocks} Stocks im Universum (${excludedBySector} durch Sektor-Filter ausgeschlossen)</div>

<div class="disclaimer">
  <strong>Wichtig:</strong> Dies ist ein <em>Discovery-Tool</em>, kein Backtest-bewiesenes Alpha-System.
  Die Modi sind als strukturierte Ideenquellen konzipiert, nicht als statistisch validierte Outperformance-Garantie.
  Finale Investmententscheidung: dein Deep-Dive (Aktienfinder, Elliott-Wellen, eigene Recherche).
</div>

<div class="stats">
  <span><strong>Universum:</strong> ${totalStocks} Stocks</span>
  <span><strong>Sektor-Ausschluss:</strong> ${excludedBySector} (Banks/Insurance/REITs)</span>
  <span><strong>Modi:</strong> Hypergrowth · Quality-Compounder · Turnaround (Phase 2)</span>
</div>

${sections}

<div class="footer">
  Karl's privater Stock-Screener · keine Anlageberatung · Daten via Yahoo Finance · ohne Gewaehr
</div>
</div></body></html>`;
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
  console.log('Wrote', args.out, '(' + html.length + ' bytes)');

  // Stats
  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    const r = discoveryByMode(evaluated, modeId, args.topN);
    console.log(`  ${modeId}: ${r.candidates.length}/${r.totalMatching} Kandidaten (Top-${args.topN})`);
  }
}

if (require.main === module) main();
module.exports = { discoveryByMode, evaluateAll };
