#!/usr/bin/env node
/**
 * Tag 102: Regional Out-of-Sample Test (Best-Effort mit Yahoo)
 * STRUKTUR-CAVEAT: echtes Point-In-Time-Universum braucht Norgate/Sharadar.
 * Hier: regionaler OOS-Test gegen JP/AU/KR-Slice. OOS bzgl. Threshold-Tuning, NICHT Survivorship.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Runner = require('../methods/runner.js');
const Modes = require('../methods/strategy-modes.js');
// Tag 219a (audit F-218b-01): use shared safeSnapshotFilename helper.
// Previously this script did `path.join(SNAP_DIR, t + '.json')` which silently
// skipped tickers whose snapshots are written with a `_` prefix (Windows
// reserved names like CON) or with sanitised characters — the OOS report
// then under-counted the HG-passing universe.
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

const SNAP_DIR = path.join(__dirname, '..', 'snapshots');
const OUT_DIR = path.join(__dirname, '..', 'outputs');

const REGION_RULES = {
  JP: /\.T$/, AU: /\.AX$/, KR: /\.KS$|\.KQ$/, US: /^[A-Z]{1,5}$/
};

function classifyRegion(ticker) {
  for (const [region, regex] of Object.entries(REGION_RULES)) {
    if (regex.test(ticker)) return region;
  }
  return 'OTHER';
}

function evaluateAll(tickers) {
  const out = [];
  for (const t of tickers) {
    let snap;
    try { snap = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, safeSnapshotFilename(t)), 'utf8')); }
    catch (e) { continue; }
    if (!snap.meta) continue;
    snap.quarterly = snap.quarterly || {};
    if (snap.timeseries) snap.quarterly.quarterlyRev = snap.timeseries.revenueQ || [];
    let results;
    try { results = Runner.evaluateStockExtended(snap, { onlyDefault: false }); } catch (e) { continue; }
    let modeEval;
    try { modeEval = Modes.evaluateMode(snap, 'HYPERGROWTH', results.results); } catch (e) { continue; }
    if (!modeEval.passed) continue;
    const r40 = results.results['rule-of-40'];
    if (!r40 || !r40.computable) continue;
    out.push({
      ticker: t, region: classifyRegion(t),
      name: snap.meta.name || '', sector: snap.meta.sector || '',
      r40: r40.value, score: modeEval.score, tier: modeEval.tier
    });
  }
  out.sort((a, b) => (b.r40 || 0) - (a.r40 || 0));
  return out;
}

function main() {
  if (!fs.existsSync(SNAP_DIR)) { console.error('Snapshots dir missing'); process.exit(1); }
  const all = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && f !== '_manifest.json')
    .map(f => f.replace(/\.json$/, ''));
  console.log('Total snapshots: ' + all.length);
  const passed = evaluateAll(all);
  console.log('HG-passing: ' + passed.length);
  const byRegion = { US: [], JP: [], AU: [], KR: [], OTHER: [] };
  for (const p of passed) byRegion[p.region].push(p);
  for (const r of Object.keys(byRegion)) console.log('  ' + r + ': ' + byRegion[r].length);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(OUT_DIR, 'regional-oos-' + date + '.md');
  let md = '# Regional OOS-Test — ' + date + '\n\n';
  md += '**Methodologie:** Aktuelle HG-Thresholds gegen JP/AU/KR-Slice ohne Re-Tuning.\n';
  md += '**Caveat:** Yahoo-Universe ist survivor-only — OOS bzgl. Threshold-Tuning, NICHT Survivorship.\n\n';
  md += '## HG-passing pro Region\n\n| Region | Count | Top-R40 | Median-R40 |\n|---|---|---|---|\n';
  for (const r of ['US', 'JP', 'AU', 'KR', 'OTHER']) {
    const list = byRegion[r];
    if (list.length === 0) { md += '| ' + r + ' | 0 | - | - |\n'; continue; }
    const top = list[0].r40, med = list[Math.floor(list.length/2)].r40;
    md += '| ' + r + ' | ' + list.length + ' | ' + top.toFixed(1) + ' | ' + med.toFixed(1) + ' |\n';
  }
  md += '\n## Top-20 pro Region\n\n';
  for (const r of ['US', 'JP', 'AU', 'KR']) {
    md += '### ' + r + '\n\n';
    if (byRegion[r].length === 0) { md += '_keine HG-Picks_\n\n'; continue; }
    md += '| # | Ticker | Name | Sector | R40 | Score | Tier |\n|---|---|---|---|---|---|---|\n';
    for (let i = 0; i < Math.min(20, byRegion[r].length); i++) {
      const p = byRegion[r][i];
      md += '| ' + (i+1) + ' | ' + p.ticker + ' | ' + (p.name || '').slice(0,30) + ' | ' + p.sector + ' | ' + p.r40.toFixed(1) + ' | ' + (p.score?.toFixed(1) || '-') + ' | ' + (p.tier || '-') + ' |\n';
    }
    md += '\n';
  }
  md += '## Interpretation\n\nWenn JP/AU/KR Top-20 vergleichbar plausibel mit US Top-20 → Thresholds generalisieren.\nWenn deutlich willkürlicher → US-zentrische Tuning-Bias.\n';
  fs.writeFileSync(reportPath, md);
  console.log('Report: ' + reportPath);
}

if (require.main === module) main();
module.exports = { evaluateAll, classifyRegion };
