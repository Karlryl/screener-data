#!/usr/bin/env node
/**
 * Tag 25: Watchlist-Insights-Report Generator
 * =============================================
 * Liest snapshots/, scoret jeden Stock via Orchestrator, generiert
 * standalone HTML-Report mit Ranking, Verteilungen, Top-Picks.
 *
 * Run: node generate-insights-report.js [--snapshots ./snapshots] [--watchlist ./watchlist.json] [--out report.html]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Engine = require('./engine-v7.3.js');
const ManipulationFilters = require('./manipulation-filters.js');
const ScoreOrchestrator = require('./score-orchestrator.js');

function parseArgs(argv) {
  const args = { snapshots: './snapshots', watchlist: './watchlist.json', out: './insights-report.html' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--watchlist' && argv[i+1]) args.watchlist = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

const fxRates = { EUR_USD: 1.07, USD_USD: 1, DKK_USD: 0.143, GBP_USD: 1.27 };

function loadPositionMap(watchlistPath) {
  const map = {};
  if (!fs.existsSync(watchlistPath)) return map;
  const wl = JSON.parse(fs.readFileSync(watchlistPath, 'utf8'));
  for (const s of (wl.stocks || [])) {
    if (s.ticker) map[s.ticker] = { position: s.position || 'watching', name: s.name, track_hint: s.track_hint };
  }
  return map;
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function classifyStocks(args) {
  const files = fs.readdirSync(args.snapshots).filter(f => f.endsWith('.json') && f !== '_manifest.json');
  const positions = loadPositionMap(args.watchlist);
  const results = [];
  for (const file of files) {
    const filePath = path.join(args.snapshots, file);
    let stock;
    try { stock = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch (e) { continue; }
    const ticker = (stock.meta && stock.meta.ticker) || file.replace(/\.json$/, '');
    const positionInfo = positions[ticker] || { position: 'watching', name: ticker };
    let score;
    try {
      score = ScoreOrchestrator.scoreSnapshot(stock, { fxRates, engine: Engine, manipulationFilters: ManipulationFilters });
    } catch (e) {
      results.push({ ticker, name: positionInfo.name, error: e.message, position: positionInfo.position });
      continue;
    }
    const buyStatus = ScoreOrchestrator.buyStatus(score, positionInfo.position);
    results.push({
      ticker,
      name: stock.meta && stock.meta.name || ticker,
      sector: stock.meta && stock.meta.sector || '—',
      position: positionInfo.position,
      bucket: score.bucket && score.bucket.id || null,
      bucketLabel: score.bucket && score.bucket.label || null,
      track: score.track,
      subProfile: score.subProfile && score.subProfile.id || null,
      finalScore: score.finalScore,
      actionStatus: score.actionStatus,
      buyStatus,
      buyStatusLabel: ScoreOrchestrator.buyStatusLabel ? ScoreOrchestrator.buyStatusLabel(buyStatus) : buyStatus,
      hardPenalties: (score.reasonCodes || []).filter(c => ScoreOrchestrator.HARD_PENALTY_CODES.has(c)),
      reasonCodes: score.reasonCodes || [],
      revenueTTM: stock.metrics && stock.metrics.revenueTTM ? stock.metrics.revenueTTM.value : null,
      growthYoY: stock.metrics && stock.metrics.revenueGrowthYoY ? stock.metrics.revenueGrowthYoY.value : null,
      marketCap: stock.marketCap ? stock.marketCap.value : null
    });
  }
  return results;
}

function fmtMoney(v) {
  if (v == null) return '—';
  if (Math.abs(v) >= 1e12) return '$' + (v/1e12).toFixed(2) + 'T';
  if (Math.abs(v) >= 1e9)  return '$' + (v/1e9).toFixed(1) + 'B';
  if (Math.abs(v) >= 1e6)  return '$' + (v/1e6).toFixed(0) + 'M';
  return '$' + v.toFixed(0);
}
function fmtPct(v) { return v == null ? '—' : v.toFixed(1) + '%'; }
function fmtScore(v) { return (v == null || isNaN(v)) ? '—' : v.toFixed(1); }

function bucketRank(id) { return ({ A: 5, B: 4, INFLECTION: 3, SPEC: 2, OUT: 1 }[id] || 0); }
function buyRank(s) { return ({ BUY_READY: 6, OWNED_OK: 5, WATCH: 4, OWNED_REVIEW: 3, UNCLASSIFIABLE: 2, NO_BUY: 1, OWNED_CRITICAL: 0 }[s] || 0); }

function buildReport(results) {
  const total = results.length;
  const errors = results.filter(r => r.error);
  const ok = results.filter(r => !r.error);

  const byBucket = {}, bySubProfile = {}, byBuyStatus = {}, bySector = {};
  for (const r of ok) {
    byBucket[r.bucket || 'NULL'] = (byBucket[r.bucket || 'NULL'] || 0) + 1;
    bySubProfile[r.subProfile || 'NULL'] = (bySubProfile[r.subProfile || 'NULL'] || 0) + 1;
    byBuyStatus[r.buyStatus] = (byBuyStatus[r.buyStatus] || 0) + 1;
    bySector[r.sector] = (bySector[r.sector] || 0) + 1;
  }

  // Top-5 BUY_READY (watching+interested, score-sorted)
  const buyReady = ok
    .filter(r => r.buyStatus === 'BUY_READY')
    .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0))
    .slice(0, 5);

  // Owned-Stocks
  const owned = ok.filter(r => r.position === 'owned').sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

  // Top-5 NO_BUY / problematic
  const noBuy = ok
    .filter(r => r.buyStatus === 'NO_BUY' || r.actionStatus === 'DISQUALIFIED' || r.hardPenalties.length > 0)
    .sort((a, b) => b.hardPenalties.length - a.hardPenalties.length || (a.finalScore || 0) - (b.finalScore || 0))
    .slice(0, 5);

  // Full ranking
  const ranked = [...ok].sort((a, b) => {
    const br = bucketRank(b.bucket) - bucketRank(a.bucket);
    if (br !== 0) return br;
    return (b.finalScore || 0) - (a.finalScore || 0);
  });

  return { total, errors, ok, byBucket, bySubProfile, byBuyStatus, bySector, buyReady, owned, noBuy, ranked };
}

function buyStatusBadge(s) {
  const colorMap = {
    BUY_READY: '#10b981', OWNED_OK: '#3b82f6', WATCH: '#64748b',
    OWNED_REVIEW: '#f59e0b', NO_BUY: '#ef4444', OWNED_CRITICAL: '#dc2626',
    UNCLASSIFIABLE: '#a855f7'
  };
  const color = colorMap[s] || '#6b7280';
  return `<span class="badge" style="background:${color}25;color:${color};border:1px solid ${color}80">${s}</span>`;
}
function bucketBadge(b) {
  if (!b) return '<span class="badge">—</span>';
  const colorMap = { A: '#10b981', B: '#3b82f6', INFLECTION: '#f59e0b', SPEC: '#a855f7', OUT: '#6b7280' };
  const color = colorMap[b] || '#6b7280';
  return `<span class="badge" style="background:${color}25;color:${color};border:1px solid ${color}80">${b}</span>`;
}
function positionBadge(p) {
  const colorMap = { owned: '#fbbf24', watching: '#60a5fa', interested: '#94a3b8' };
  const color = colorMap[p] || '#94a3b8';
  return `<span class="badge" style="background:${color}25;color:${color}">${p}</span>`;
}

function renderHTML(report, generatedAt) {
  const { total, errors, ok, byBucket, bySubProfile, byBuyStatus, bySector, buyReady, owned, noBuy, ranked } = report;

  const distRow = (label, obj) => Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<span class="chip">${escHtml(k)}: ${v}</span>`)
    .join('');

  const stockCard = (r) => `
    <div class="stock-card">
      <div class="stock-head">
        <div><strong class="ticker">${escHtml(r.ticker)}</strong> ${positionBadge(r.position)}</div>
        <div>${bucketBadge(r.bucket)} ${buyStatusBadge(r.buyStatus)}</div>
      </div>
      <div class="stock-name">${escHtml(r.name)}</div>
      <div class="stock-meta">
        <span>${escHtml(r.sector)}</span> · <span>${r.subProfile || '—'}</span> · <span>Track ${r.track || '—'}</span>
      </div>
      <div class="stock-stats">
        <div><span class="lbl">Score</span><span class="val">${fmtScore(r.finalScore)}</span></div>
        <div><span class="lbl">MCap</span><span class="val">${fmtMoney(r.marketCap)}</span></div>
        <div><span class="lbl">Rev TTM</span><span class="val">${fmtMoney(r.revenueTTM)}</span></div>
        <div><span class="lbl">Growth</span><span class="val">${fmtPct(r.growthYoY)}</span></div>
      </div>
      ${r.hardPenalties.length ? `<div class="hard-pen">⚠ ${r.hardPenalties.map(escHtml).join(', ')}</div>` : ''}
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><title>Karl's Watchlist — Insights ${generatedAt}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 32px; line-height: 1.5; }
  h1 { color: #f1f5f9; font-size: 28px; margin: 0 0 4px; }
  h2 { color: #f1f5f9; font-size: 18px; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #334155; }
  .sub { color: #94a3b8; font-size: 13px; margin-bottom: 20px; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 16px 0; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 14px; }
  .card .num { font-size: 28px; font-weight: 700; color: #f1f5f9; }
  .card .lbl { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .chip { display: inline-block; padding: 4px 10px; margin: 3px 4px 3px 0; background: #334155; color: #cbd5e1; border-radius: 12px; font-size: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.3px; margin: 0 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th { text-align: left; padding: 10px; background: #1e293b; color: #94a3b8; font-weight: 600; border-bottom: 2px solid #334155; }
  td { padding: 8px 10px; border-bottom: 1px solid #1e293b; }
  tr:hover { background: #1a2436; }
  .stock-card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 14px; margin: 8px 0; }
  .stock-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .ticker { font-size: 16px; color: #f1f5f9; }
  .stock-name { color: #cbd5e1; font-size: 13px; }
  .stock-meta { color: #94a3b8; font-size: 11px; margin-top: 4px; }
  .stock-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #334155; }
  .stock-stats .lbl { color: #94a3b8; font-size: 10px; text-transform: uppercase; display: block; }
  .stock-stats .val { color: #f1f5f9; font-size: 14px; font-weight: 600; display: block; }
  .hard-pen { margin-top: 8px; padding: 6px 8px; background: #7f1d1d40; color: #fca5a5; border-radius: 4px; font-size: 11px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 800px) { .grid-2 { grid-template-columns: 1fr; } }
  .num.A { color: #10b981; } .num.B { color: #3b82f6; } .num.INFLECTION { color: #f59e0b; }
  .num.OUT { color: #6b7280; } .num.BUY_READY { color: #10b981; } .num.NO_BUY { color: #ef4444; }
  details { margin-top: 12px; }
  details summary { cursor: pointer; color: #94a3b8; font-size: 12px; padding: 4px 0; }
</style></head><body>

<h1>📊 Karl's Watchlist — Engine-Insights</h1>
<div class="sub">Generated ${escHtml(generatedAt)} · ${total} stocks · ${ok.length} scored · ${errors.length} errors · v7.3 Engine</div>

<h2>Summary</h2>
<div class="summary">
  <div class="card"><div class="num">${total}</div><div class="lbl">Total Stocks</div></div>
  <div class="card"><div class="num A">${byBucket.A || 0}</div><div class="lbl">Bucket A</div></div>
  <div class="card"><div class="num B">${byBucket.B || 0}</div><div class="lbl">Bucket B</div></div>
  <div class="card"><div class="num INFLECTION">${byBucket.INFLECTION || 0}</div><div class="lbl">Inflection</div></div>
  <div class="card"><div class="num OUT">${byBucket.OUT || 0}</div><div class="lbl">Out</div></div>
  <div class="card"><div class="num BUY_READY">${byBuyStatus.BUY_READY || 0}</div><div class="lbl">Buy Ready</div></div>
  <div class="card"><div class="num NO_BUY">${byBuyStatus.NO_BUY || 0}</div><div class="lbl">No Buy</div></div>
</div>

<h2>🔴 Owned Stocks — Conviction-Status</h2>
${owned.length ? owned.map(stockCard).join('') : '<div class="sub">Keine owned Stocks.</div>'}

<h2>🟢 Top-5 BUY_READY-Kandidaten</h2>
<div class="sub">Aus den watching+interested Stocks die mit höchstem Score, Track-A oder B, kein Hard-Penalty.</div>
${buyReady.length ? buyReady.map(stockCard).join('') : '<div class="sub">Aktuell keine BUY_READY-Kandidaten — was die Engine sagt: nichts kaufen.</div>'}

<h2>🟡 Top-5 NO_BUY / Problematisch</h2>
<div class="sub">Stocks mit Hard-Penalties oder DISQUALIFIED — explizit meiden.</div>
${noBuy.length ? noBuy.map(stockCard).join('') : '<div class="sub">Keine problematischen Stocks erkannt.</div>'}

<div class="grid-2">
  <div>
    <h2>Bucket-Verteilung</h2>
    <div>${distRow('Bucket', byBucket)}</div>
  </div>
  <div>
    <h2>Buy-Status-Verteilung</h2>
    <div>${distRow('Buy', byBuyStatus)}</div>
  </div>
</div>

<div class="grid-2">
  <div>
    <h2>Sub-Profile-Verteilung</h2>
    <div>${distRow('SubProf', bySubProfile)}</div>
  </div>
  <div>
    <h2>Sektor-Verteilung</h2>
    <div>${distRow('Sector', bySector)}</div>
  </div>
</div>

<h2>📋 Full Ranking (${ranked.length} Stocks)</h2>
<table>
<thead><tr><th>#</th><th>Ticker</th><th>Name</th><th>Pos</th><th>Bucket</th><th>Sub-Profile</th><th>Track</th><th>Score</th><th>Buy-Status</th><th>Action</th><th>MCap</th><th>Growth</th></tr></thead>
<tbody>
${ranked.map((r, i) => `<tr>
  <td>${i+1}</td>
  <td><strong>${escHtml(r.ticker)}</strong></td>
  <td>${escHtml(r.name)}</td>
  <td>${positionBadge(r.position)}</td>
  <td>${bucketBadge(r.bucket)}</td>
  <td>${escHtml(r.subProfile || '—')}</td>
  <td>${escHtml(r.track || '—')}</td>
  <td>${fmtScore(r.finalScore)}</td>
  <td>${buyStatusBadge(r.buyStatus)}</td>
  <td>${escHtml(r.actionStatus || '—')}</td>
  <td>${fmtMoney(r.marketCap)}</td>
  <td>${fmtPct(r.growthYoY)}</td>
</tr>`).join('')}
</tbody></table>

${errors.length ? `<h2>⚠ Scoring-Errors (${errors.length})</h2>
<details><summary>Show errors</summary>
${errors.map(e => `<div>${escHtml(e.ticker)}: ${escHtml(e.error)}</div>`).join('')}
</details>` : ''}

<div class="sub" style="margin-top: 40px; text-align: center;">v7.3 Engine · Tag-25-Insights · Buy-only-System (Sells via EW extern)</div>

</body></html>`;
}

function main() {
  const args = parseArgs(process.argv);
  console.log(`Loading snapshots from ${args.snapshots}...`);
  const results = classifyStocks(args);
  console.log(`Scored ${results.length} stocks (${results.filter(r => r.error).length} errors)`);
  const report = buildReport(results);
  const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const html = renderHTML(report, generatedAt);
  fs.writeFileSync(args.out, html);
  console.log(`✓ Report written: ${args.out} (${html.length} bytes)`);
  console.log('');
  console.log('Quick stats:');
  console.log(`  Buckets: ${JSON.stringify(report.byBucket)}`);
  console.log(`  Buy-Status: ${JSON.stringify(report.byBuyStatus)}`);
  console.log(`  Top BUY_READY: ${report.buyReady.map(r => r.ticker).join(', ') || '(none)'}`);
  console.log(`  Owned: ${report.owned.map(r => r.ticker + '=' + r.buyStatus).join(', ')}`);
}

main();
