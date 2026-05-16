#!/usr/bin/env node
/**
 * Tag 203 — Score-History Snapshot
 * =================================
 * Implements the design from audit-reports/2026-05-16-tag202-score-history-design.md.
 *
 * For each ticker in ./snapshots, computes today's
 *   { date, hgScore, qcScore, pbScore, hgTier, qcTier, hgClass }
 * and appends to score-history/<TICKER>.json (last-30 sliding window).
 * Idempotent: re-runs on the same day replace today's entry rather than
 * append a duplicate.
 *
 * Pipeline-health entry written to pipeline-health/snapshot-score-history.json.
 * Atomic per-ticker writes via lib/atomic-write.js (Tag 189 invariant).
 *
 * IMPORTANT: must be invoked with the same AUDIT_SCORE_MULTIPLIERS env value as
 * generate-screener.js so stored scores agree with displayed scores. Drift here
 * produces a permanent fake "score uplift today" artifact in the dashboard.
 *
 * Run:
 *   node scripts/snapshot-score-history.js [--snapshots ./snapshots] [--out ./score-history]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Runner = require('../methods/runner.js');
const SM = require('../methods/strategy-modes.js');
const { writeFileAtomic } = require('../lib/atomic-write.js');

const SCHEMA_VERSION = 1;
const MAX_ENTRIES = 30;
// Mirror generate-screener.js' pbScore formula so stored history matches the
// dashboard's pb-score basis.
function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function _computePbScore(stock, allResults) {
  const growth = _unwrap(stock.metrics && stock.metrics.revenueGrowthYoY);
  const grossMargin = _unwrap(stock.metrics && stock.metrics.grossMargin);
  if (!Number.isFinite(growth) || !Number.isFinite(grossMargin)) return null;
  const r40 = allResults['rule-of-40'];
  const r40Value = (r40 && r40.computable && Number.isFinite(r40.value)) ? r40.value : null;
  const gma = allResults['gross-margin-acceleration'];
  const gmaTrend = (gma && gma.computable && gma.components && gma.components.trend) || null;
  const oma = allResults['operating-margin-acceleration'];
  const omaTrend = (oma && oma.computable && oma.components && oma.components.trend) || null;
  const revAccel = allResults['revenue-acceleration-yoy'];
  const revAccelDelta = (revAccel && revAccel.computable && Number.isFinite(revAccel.value))
    ? revAccel.value : null;

  const growthC = Math.min(100, Math.max(0, growth));
  const gmC     = Math.min(100, Math.max(0, grossMargin));
  const r40C    = Math.min(100, Math.max(0, r40Value || 0));
  const gmaBonus = (gmaTrend === 'accelerating') ? 10 : (gmaTrend === 'stable' ? 4 : 0);
  const omaBonus = (omaTrend === 'accelerating') ? 15 : (omaTrend === 'stable' ? 6 : 0);
  let revAccelBonus = 0;
  if (revAccelDelta != null && revAccelDelta > 0) {
    revAccelBonus = Math.min(15, revAccelDelta / 50 * 15);
  }
  return (growthC / 100 * 25) + (gmC / 100 * 20) + (r40C / 100 * 15) + gmaBonus + omaBonus + revAccelBonus;
}

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './score-history' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

// Async batched loader — mirrors snapshot-methods-history.js's loadFilesAsync.
async function loadSnapshotsAsync(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const BATCH = 200;
  const results = [];
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const loaded = await Promise.all(batch.map(async f => {
      try {
        const raw = await fs.promises.readFile(path.join(dir, f), 'utf8');
        const stock = JSON.parse(raw);
        return (stock && stock.meta && stock.meta.ticker) ? stock : null;
      } catch (e) { return null; }
    }));
    results.push(...loaded.filter(Boolean));
  }
  return results;
}

// Load existing history file for a ticker. Returns { ticker, schemaVersion, entries }
// shape. Missing file → fresh container. Schema-version mismatch → reset entries
// (gracefully — the dashboard will show "—" until a new history accumulates).
function readHistoryFile(outDir, ticker) {
  const file = path.join(outDir, ticker + '.json');
  if (!fs.existsSync(file)) {
    return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] };
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] };
    }
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      // Design doc §7: schema bump → reset, log warning, continue gracefully.
      console.log('::warning::score-history schema v' + parsed.schemaVersion +
                  ' for ' + ticker + ', expected v' + SCHEMA_VERSION + ' — resetting entries');
      return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] };
    }
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return { ticker, schemaVersion: SCHEMA_VERSION, entries };
  } catch (e) {
    // Corrupt JSON → reset (safer than crashing the whole pipeline).
    console.log('::warning::failed to parse score-history/' + ticker + '.json: ' + e.message + ' — resetting');
    return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] };
  }
}

// Append today's entry (replacing any existing one for `today`), sort by date,
// prune to MAX_ENTRIES (keeping the most recent).
function appendAndPrune(history, todayEntry) {
  const filtered = (history.entries || []).filter(e => e.date !== todayEntry.date);
  filtered.push(todayEntry);
  filtered.sort((a, b) => (a.date < b.date) ? -1 : (a.date > b.date ? 1 : 0));
  const trimmed = filtered.length > MAX_ENTRIES ? filtered.slice(filtered.length - MAX_ENTRIES) : filtered;
  return Object.assign({}, history, { entries: trimmed, schemaVersion: SCHEMA_VERSION });
}

function computeEntryForStock(stock, today) {
  const allResults = Runner.evaluateStock(stock);
  const evHG = SM.evaluateMode(stock, 'HYPERGROWTH', allResults);
  const evQC = SM.evaluateMode(stock, 'QUALITY_COMPOUNDER', allResults);
  const hgScore = (evHG && Number.isFinite(evHG.score)) ? Math.round(evHG.score * 100) / 100 : null;
  const qcScore = (evQC && Number.isFinite(evQC.score)) ? Math.round(evQC.score * 100) / 100 : null;
  const hgTier = evHG ? evHG.tier : null;
  const qcTier = evQC ? evQC.tier : null;
  const hgClassRes = allResults['hypergrowth-quality-class'];
  const hgClass = (hgClassRes && hgClassRes.computable && hgClassRes.components && hgClassRes.components.class) || null;
  const pbScoreRaw = _computePbScore(stock, allResults);
  const pbScore = (pbScoreRaw != null && Number.isFinite(pbScoreRaw)) ? Math.round(pbScoreRaw * 100) / 100 : null;
  return { date: today, hgScore, qcScore, pbScore, hgTier, qcTier, hgClass };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.out)) fs.mkdirSync(args.out, { recursive: true });

  console.log('[score-history] AUDIT_SCORE_MULTIPLIERS=' + (process.env.AUDIT_SCORE_MULTIPLIERS || '0'));
  console.log('[score-history] loading snapshots from ' + args.snapshots);
  const stocks = await loadSnapshotsAsync(args.snapshots);
  console.log('[score-history]   ' + stocks.length + ' stocks loaded');

  const today = new Date().toISOString().slice(0, 10);
  const failures = [];
  let written = 0, skipped = 0;

  for (const stock of stocks) {
    const ticker = stock.meta && stock.meta.ticker;
    if (!ticker) { skipped++; continue; }
    try {
      const entry = computeEntryForStock(stock, today);
      // Skip writing if every score is null AND no tier — nothing useful to
      // record. This avoids creating files for stocks that can't be evaluated.
      if (entry.hgScore == null && entry.qcScore == null && entry.pbScore == null
          && entry.hgTier == null && entry.qcTier == null) {
        skipped++;
        continue;
      }
      const history = readHistoryFile(args.out, ticker);
      const next = appendAndPrune(history, entry);
      const outPath = path.join(args.out, ticker + '.json');
      writeFileAtomic(outPath, JSON.stringify(next));
      written++;
    } catch (e) {
      failures.push({ ticker, error: e.message });
    }
  }

  // _meta.json — schema version, last-run-date, ticker count (design §2).
  const meta = {
    schemaVersion: SCHEMA_VERSION,
    lastRun: new Date().toISOString(),
    tickerCount: written,
    auditScoreMultipliers: process.env.AUDIT_SCORE_MULTIPLIERS === '1'
  };
  writeFileAtomic(path.join(args.out, '_meta.json'), JSON.stringify(meta, null, 2));

  console.log('[score-history] written: ' + written + ', skipped: ' + skipped + ', failed: ' + failures.length);

  // Tag 168 pipeline-health contract.
  const healthDir = './pipeline-health';
  if (!fs.existsSync(healthDir)) fs.mkdirSync(healthDir, { recursive: true });
  const n_total = stocks.length;
  const n_failed = failures.length;
  const n_ok = n_total - n_failed;
  const failure_rate = n_total > 0 ? n_failed / n_total : 0;
  const healthReport = {
    script: 'snapshot-score-history',
    date: today,
    n_total, n_ok, n_failed, failure_rate,
    failures: failures.slice(0, 200)
  };
  fs.writeFileSync(path.join(healthDir, 'snapshot-score-history.json'), JSON.stringify(healthReport, null, 2));
  console.log('[score-history] health: ' + n_ok + '/' + n_total + ' ok (' + (failure_rate * 100).toFixed(2) + '%)');
  if (failure_rate > 0.05) {
    console.error('::error::snapshot-score-history failure rate ' + (failure_rate * 100).toFixed(2) + '% exceeds 5% threshold');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => { console.error('snapshot-score-history failed: ' + e.message); process.exit(1); });
}

module.exports = { readHistoryFile, appendAndPrune, computeEntryForStock, SCHEMA_VERSION, MAX_ENTRIES };
