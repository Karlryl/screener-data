#!/usr/bin/env node
/**
 * F-DQ-013: Data Quality Report
 * ==============================
 * Reads all snapshots, computes field coverage stats, groups by exchange/region,
 * and outputs a markdown table to outputs/data-quality-report.md.
 *
 * Run:  node scripts/data-quality-report.js [--snapshots ./snapshots] [--out ./outputs/data-quality-report.md]
 */
'use strict';
const fs   = require('fs');
const path = require('path');

// Import grading logic
let gradeSnapshot;
try {
  ({ gradeSnapshot } = require('../methods/data-quality.js'));
} catch (e) {
  gradeSnapshot = () => ({ grade: 'unknown', nanRatio: 0, missingFields: [] });
}

// Key fields to track coverage for in the report
const KEY_FIELDS = [
  { label: 'marketCap',         get: s => s.marketCap && s.marketCap.value != null },
  { label: 'revenueTTM',        get: s => s.metrics && s.metrics.revenueTTM && s.metrics.revenueTTM.value != null },
  { label: 'revenueGrowthYoY',  get: s => s.metrics && s.metrics.revenueGrowthYoY && s.metrics.revenueGrowthYoY.value != null },
  { label: 'grossMargin',       get: s => s.metrics && s.metrics.grossMargin && s.metrics.grossMargin.value != null },
  { label: 'operatingMargin',   get: s => s.metrics && s.metrics.operatingMargin && s.metrics.operatingMargin.value != null },
  { label: 'fcfMarginTTM',      get: s => s.metrics && s.metrics.fcfMarginTTM && s.metrics.fcfMarginTTM.value != null },
  { label: 'forwardPE',         get: s => s.metrics && s.metrics.forwardPE && s.metrics.forwardPE.value != null },
  { label: 'annualRev>=3',      get: s => Array.isArray(s.annual && s.annual.annualRev) && s.annual.annualRev.filter(x => x != null).length >= 3 },
  { label: 'annualFCF>=2',      get: s => Array.isArray(s.annual && s.annual.annualFCF) && s.annual.annualFCF.filter(x => x != null).length >= 2 },
  { label: 'annualBalance>=2',  get: s => Array.isArray(s.annual && s.annual.annualBalance) && s.annual.annualBalance.filter(x => x != null).length >= 2 },
  { label: 'annualSBC',         get: s => Array.isArray(s.annual && s.annual.annualSBC) && s.annual.annualSBC.filter(x => x != null).length > 0 },
  { label: 'annualCapex',       get: s => Array.isArray(s.annual && s.annual.annualCapex) && s.annual.annualCapex.filter(x => x != null).length > 0 },
  { label: 'revenueQ>=4',       get: s => Array.isArray(s.timeseries && s.timeseries.revenueQ) && s.timeseries.revenueQ.filter(x => x != null).length >= 4 },
  { label: 'sector',            get: s => !!(s.meta && s.meta.sector) },
  { label: 'insiderOwner',      get: s => s.metrics && s.metrics.insiderOwnerPercent && s.metrics.insiderOwnerPercent.value != null },
];

function parseArgs(argv) {
  const args = {
    snapshots: path.join(__dirname, '..', 'snapshots'),
    out:       path.join(__dirname, '..', 'outputs', 'data-quality-report.md'),
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

function pct(n, total) {
  if (!total) return '—';
  return Math.round(n / total * 100) + '%';
}

function pad(s, len) {
  return String(s).padEnd(len);
}

function main() {
  const args = parseArgs(process.argv);
  console.log('Data Quality Report');
  console.log('  snapshots: ' + args.snapshots);
  console.log('  out:       ' + args.out);

  if (!fs.existsSync(args.snapshots)) {
    console.error('Snapshots dir not found: ' + args.snapshots);
    process.exit(1);
  }

  const files = fs.readdirSync(args.snapshots)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));

  console.log('  snapshot files: ' + files.length);

  // Load all snapshots
  const snapshots = [];
  let loadErrors = 0;
  for (const f of files) {
    const fp = path.join(args.snapshots, f);
    try {
      const s = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (s && typeof s === 'object') snapshots.push(s);
    } catch (e) {
      loadErrors++;
    }
  }
  console.log('  loaded: ' + snapshots.length + ' (' + loadErrors + ' parse errors)');

  // Grade all snapshots
  const gradeCounts = { 'A+': 0, A: 0, B: 0, C: 0, D: 0, unknown: 0 };
  const fieldMissCounts = {};
  for (const f of KEY_FIELDS) fieldMissCounts[f.label] = 0;

  // Per-exchange grouping
  const byExchange = {};

  for (const s of snapshots) {
    const { grade, missingFields } = gradeSnapshot(s);
    gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;

    // Count missing key fields
    for (const f of KEY_FIELDS) {
      let present = false;
      try { present = !!f.get(s); } catch (e) {}
      if (!present) fieldMissCounts[f.label]++;
    }

    // Group by exchange
    const exch = (s.meta && s.meta.exchange) || (s.meta && s.meta.exchangeCode) || 'Unknown';
    if (!byExchange[exch]) byExchange[exch] = { count: 0, grades: { 'A+': 0, A: 0, B: 0, C: 0, D: 0, unknown: 0 } };
    byExchange[exch].count++;
    byExchange[exch].grades[grade] = (byExchange[exch].grades[grade] || 0) + 1;
  }

  const total = snapshots.length;

  // Top 10 missing fields
  const topMissing = KEY_FIELDS
    .map(f => ({ label: f.label, missing: fieldMissCounts[f.label] }))
    .sort((a, b) => b.missing - a.missing)
    .slice(0, 10);

  // Sort exchanges by count desc
  const exchList = Object.entries(byExchange)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20);

  // Build markdown
  const lines = [];
  const now = new Date().toISOString();
  lines.push('# Data Quality Report');
  lines.push('');
  lines.push('Generated: ' + now);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push('| Total snapshots | ' + total + ' |');
  lines.push('| Grade A+ | ' + gradeCounts['A+'] + ' (' + pct(gradeCounts['A+'], total) + ') |');
  lines.push('| Grade A  | ' + gradeCounts['A']  + ' (' + pct(gradeCounts['A'],  total) + ') |');
  lines.push('| Grade B  | ' + gradeCounts['B']  + ' (' + pct(gradeCounts['B'],  total) + ') |');
  lines.push('| Grade C  | ' + gradeCounts['C']  + ' (' + pct(gradeCounts['C'],  total) + ') |');
  lines.push('| Grade D  | ' + gradeCounts['D']  + ' (' + pct(gradeCounts['D'],  total) + ') |');
  lines.push('| Parse errors | ' + loadErrors + ' |');
  lines.push('');
  lines.push('## Key Field Coverage');
  lines.push('');
  lines.push('| Field | Present | Coverage |');
  lines.push('|-------|---------|----------|');
  for (const f of KEY_FIELDS) {
    const present = total - fieldMissCounts[f.label];
    lines.push('| ' + f.label.padEnd(22) + ' | ' + String(present).padStart(6) + ' | ' + pct(present, total).padStart(7) + ' |');
  }
  lines.push('');
  lines.push('## Top 10 Missing Fields');
  lines.push('');
  lines.push('| Rank | Field | Missing | % Missing |');
  lines.push('|------|-------|---------|-----------|');
  topMissing.forEach((f, i) => {
    lines.push('| ' + (i+1) + ' | ' + f.label + ' | ' + f.missing + ' | ' + pct(f.missing, total) + ' |');
  });
  lines.push('');
  lines.push('## Coverage by Exchange (top 20)');
  lines.push('');
  lines.push('| Exchange | Count | A+ | A | B | C | D |');
  lines.push('|----------|-------|----|---|---|---|---|');
  for (const [exch, data] of exchList) {
    const g = data.grades;
    lines.push('| ' + exch.padEnd(10) + ' | ' + String(data.count).padStart(5) +
      ' | ' + (g['A+'] || 0) +
      ' | ' + (g['A']  || 0) +
      ' | ' + (g['B']  || 0) +
      ' | ' + (g['C']  || 0) +
      ' | ' + (g['D']  || 0) + ' |');
  }
  lines.push('');

  const outDir = path.dirname(args.out);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.out, lines.join('\n'));
  console.log('\nWritten: ' + args.out);
}

if (require.main === module) {
  main();
}
module.exports = { main };
