#!/usr/bin/env node
/**
 * Tag 50 — Watchlist-Diff-Report
 * Vergleicht latest methods-history-Snapshot mit dem davor.
 * Zeigt: Stocks mit Pass-Count-Wechsel, große Methoden-Werte-Changes.
 *
 * Run: node generate-diff-report.js [--methods-history methods-history/] [--out diff-report.html]
 */
'use strict';
const fs = require('fs');
const path = require('path');
// Tag 221c (audit F-GR-009 LOW fix): atomic main-output write.
const { writeFileAtomic } = require('./lib/atomic-write.js');

function parseArgs(argv) {
  const args = { history: './methods-history', out: './diff-report.html' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--methods-history' && argv[i+1]) args.history = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.history)) {
    console.error(`No history at ${args.history}`);
    process.exit(1);
  }
  const files = fs.readdirSync(args.history).filter(f => f.endsWith('.json')).sort();
  if (files.length < 2) {
    console.log(`Only ${files.length} history snapshot(s). Need ≥2 for diff.`);
    // Tag 221c (audit F-GR-009 LOW fix): atomic write.
    writeFileAtomic(args.out, '<html><body style="background:#0f172a;color:#e2e8f0;font-family:sans-serif;padding:30px;"><h1>Watchlist-Diff</h1><p>Need ≥2 history snapshots — currently '+files.length+'.</p></body></html>');
    return;
  }
  const latest = JSON.parse(fs.readFileSync(path.join(args.history, files[files.length-1]), 'utf8'));
  const previous = JSON.parse(fs.readFileSync(path.join(args.history, files[files.length-2]), 'utf8'));

  const passCountDiffs = [];      // {ticker, prevPass, currPass}
  const methodValueDiffs = [];    // {ticker, methodId, prev, curr, delta}

  for (const [ticker, info] of Object.entries(latest.stocks)) {
    const prev = previous.stocks[ticker];
    if (!prev) {
      passCountDiffs.push({ ticker, prevPass: null, currPass: info.passing, status: 'NEW' });
      continue;
    }
    if (info.passing !== prev.passing) {
      passCountDiffs.push({ ticker, prevPass: prev.passing, currPass: info.passing,
        delta: info.passing - prev.passing,
        status: info.passing > prev.passing ? 'IMPROVED' : 'WORSENED' });
    }
    // Method-value-changes: detect ≥20% relative change pro Methode
    for (const [mid, r] of Object.entries(info.results || {})) {
      const pr = prev.results && prev.results[mid];
      if (!pr || pr.value == null || r.value == null) continue;
      if (pr.value === 0) continue;
      const rel = Math.abs((r.value - pr.value) / pr.value);
      if (rel >= 0.20) {
        methodValueDiffs.push({
          ticker, methodId: mid,
          prev: pr.value, curr: r.value,
          deltaPct: ((r.value - pr.value) / pr.value) * 100,
          flipped: pr.pass !== r.pass
        });
      }
    }
  }
  passCountDiffs.sort((a, b) => Math.abs((b.delta||0)) - Math.abs((a.delta||0)));

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Watchlist-Diff ${latest.date} vs ${previous.date}</title><style>
body{font-family:ui-sans-serif,system-ui;background:#0f172a;color:#e2e8f0;margin:0;padding:24px}
h1{color:#f1f5f9;font-size:22px}
h2{color:#f1f5f9;font-size:16px;border-bottom:1px solid #334155;padding-bottom:6px;margin-top:28px}
.sub{color:#94a3b8;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px;background:#1e293b;border-radius:6px;margin-top:8px}
th{text-align:left;padding:8px;color:#94a3b8;border-bottom:2px solid #334155;font-weight:600}
td{padding:8px;border-bottom:1px solid #131c2b}
.up{color:#10b981}.down{color:#ef4444}.flag{color:#f59e0b}
</style></head><body>
<h1>📊 Watchlist-Diff: ${escHtml(latest.date)} vs ${escHtml(previous.date)}</h1>
<div class="sub">Pass-Count-Wechsel + große Methoden-Werte-Changes (≥20%)</div>

<h2>Pass-Count-Wechsel (${passCountDiffs.length})</h2>`;
  if (passCountDiffs.length === 0) {
    html += `<p class="sub">Keine Pass-Count-Änderungen.</p>`;
  } else {
    html += '<table><thead><tr><th>Ticker</th><th>Vorher</th><th>Jetzt</th><th>Δ</th><th>Status</th></tr></thead><tbody>';
    for (const d of passCountDiffs) {
      const dirClass = d.status === 'IMPROVED' ? 'up' : (d.status === 'WORSENED' ? 'down' : 'flag');
      html += `<tr><td><strong>${escHtml(d.ticker)}</strong></td><td>${d.prevPass != null ? d.prevPass : '—'}</td><td>${d.currPass}</td><td class="${dirClass}">${d.delta > 0 ? '+' : ''}${d.delta != null ? d.delta : '?'}</td><td class="${dirClass}">${d.status}</td></tr>`;
    }
    html += '</tbody></table>';
  }

  html += `<h2>Methoden-Werte-Changes ≥ 20% (${methodValueDiffs.length})</h2>`;
  if (methodValueDiffs.length === 0) {
    html += `<p class="sub">Keine größeren Werte-Changes.</p>`;
  } else {
    html += '<table><thead><tr><th>Ticker</th><th>Method</th><th>Vorher</th><th>Jetzt</th><th>ΔPct</th><th>Pass-Flip</th></tr></thead><tbody>';
    for (const d of methodValueDiffs.sort((a,b)=>Math.abs(b.deltaPct)-Math.abs(a.deltaPct)).slice(0,50)) {
      const dirClass = d.deltaPct > 0 ? 'up' : 'down';
      html += `<tr><td><strong>${escHtml(d.ticker)}</strong></td><td>${escHtml(d.methodId)}</td><td>${d.prev != null ? d.prev.toFixed(2) : '—'}</td><td>${d.curr != null ? d.curr.toFixed(2) : '—'}</td><td class="${dirClass}">${d.deltaPct > 0 ? '+' : ''}${d.deltaPct.toFixed(0)}%</td><td>${d.flipped ? '<span class="flag">YES</span>' : ''}</td></tr>`;
    }
    html += '</tbody></table>';
  }

  html += '</body></html>';
  // Tag 221c (audit F-GR-009 LOW fix): atomic write.
  writeFileAtomic(args.out, html);
  console.log(`✓ Diff-Report: ${args.out}`);
  console.log(`  ${passCountDiffs.length} pass-count changes, ${methodValueDiffs.length} value-changes ≥20%`);
}
main();
