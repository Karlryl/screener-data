#!/usr/bin/env node
/**
 * Tag 29 — Detect-Changes: Method-Pass-Fail-Tracking
 * ====================================================
 * Architektur-Pivot vom Tag 28:
 *   - keine BUCKET_CHANGE / BUY_STATUS_CHANGE Events mehr
 *   - dafür: METHOD_PASS_LOST (WARNING), METHOD_PASS_GAINED (INFO) pro Stock × Methode
 *   - FIELD_DRIFT bleibt aus Tag 22
 *
 * Run:
 *   node detect-changes.js [--snapshots ./snapshots] [--state ./alert-state.json]
 *
 * Workflow-Integration:
 *   - Step nach pull-yahoo.js + generate-methods-report.js
 *   - alert-state.json wird mit-committet
 */

'use strict';

const fs = require('fs');
const path = require('path');

const Runner = require('./methods/runner.js');
const FieldCoverage = require('./field-coverage.js');
const Trend = require('./methods/trend.js');

function _ts() { return new Date().toISOString(); }
function _log(level, msg) { console.log(`[${_ts()}] [${level}] ${msg}`); }

// ─── State-Management ─────────────────────────────────────────────
// alert-state.json schema (Tag-29):
// {
//   "lastRun": "2026-05-07T...",
//   "methodState": {
//     "CRDO": { "rule-of-40": { value, pass, lastChanged }, ... },
//     ...
//   },
//   "fieldCoverage": { history: [], baseline: {} }   // Tag-22
// }

// F-SM-001: method-history-state.json is now committed at repo root (not gitignored).
// This ensures trend signals accumulate across CI runs (GitHub runners are fresh per run).
// F-SM-007: sidecar migration code removed — single committed file is the source of truth.
const HISTORY_SIDECAR = path.join(__dirname, 'method-history-state.json');

function _loadMethodHistory() {
  if (!fs.existsSync(HISTORY_SIDECAR)) return {};
  try {
    const p = JSON.parse(fs.readFileSync(HISTORY_SIDECAR, 'utf8'));
    return (p && typeof p === 'object' && p.methodHistory && typeof p.methodHistory === 'object') ? p.methodHistory : {};
  } catch (e) {
    _log('WARN', 'history sidecar unparseable, treating as fresh: ' + e.message);
    return {};
  }
}

function _saveMethodHistory(history) {
  // F-SM-002: atomic write via tmp+rename to prevent partial-write corruption on SIGKILL
  try {
    const tmp = HISTORY_SIDECAR + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ lastSaved: new Date().toISOString(), methodHistory: history }));
    fs.renameSync(tmp, HISTORY_SIDECAR);
  } catch (e) { _log('WARN', 'failed to write history sidecar: ' + e.message); }
}

function loadState(statePath) {
  // Tag-21-Robustness + Tag-29-Schema-Migration
  // F-SM-007: simplified — no sidecar migration. Single committed history file.
  // F-SM-015 (Tag 187): when alert-state is corrupt, do NOT silently default to
  // an empty state — that wipes all dedup baselines and causes the next run to
  // emit a CRITICAL event per ticker × method (~186k Discord messages for a
  // 6200-ticker universe). Back up the corrupt file and exit non-zero so the
  // workflow visibly fails and the operator decides how to recover.
  let parsed = null;
  if (fs.existsSync(statePath)) {
    try { parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
    catch (e) {
      const backup = statePath + '.corrupt.' + Date.now();
      try { fs.copyFileSync(statePath, backup); } catch (_) {}
      _log('ERROR', `alert-state.json is corrupt (${e.message}). Backup at ${backup}.`);
      if (process.env.RESET_ALERT_STATE !== '1') {
        _log('ERROR', 'Refusing to wipe baselines — set RESET_ALERT_STATE=1 to start fresh.');
        process.exit(1);
      }
      _log('WARN', 'RESET_ALERT_STATE=1 — proceeding with empty state. Next run will flood alerts.');
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
  // F-SM-007: methodHistory lives only in the committed sidecar file (not inline in alert-state.json).
  const methodHistory = _loadMethodHistory();
  return {
    lastRun: typeof parsed.lastRun === 'string' ? parsed.lastRun : null,
    methodState: (parsed.methodState && typeof parsed.methodState === 'object' && !Array.isArray(parsed.methodState)) ? parsed.methodState : {},
    methodHistory,
    fieldCoverage: (parsed.fieldCoverage && typeof parsed.fieldCoverage === 'object')
      ? {
          history: Array.isArray(parsed.fieldCoverage.history) ? parsed.fieldCoverage.history : [],
          baseline: (parsed.fieldCoverage.baseline && typeof parsed.fieldCoverage.baseline === 'object') ? parsed.fieldCoverage.baseline : {}
        }
      : { history: [], baseline: {} }
  };
}

function saveState(statePath, state) {
  // F-SM-003: delete methodHistory from committed alert-state (it lives in the sidecar only).
  // F-SM-006: prune methodState entries for tickers not in current run if lastChanged > 30 days ago.
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const cutoffDate = thirtyDaysAgo.toISOString().slice(0, 10);
  const prunedMethodState = {};
  for (const [ticker, methods] of Object.entries(state.methodState || {})) {
    // Keep if any method was changed within 30 days.
    // Tag 225e-2a (audit F-216-08): defensively normalize lastChanged to its
    // YYYY-MM-DD prefix before lexicographic compare. Works today because
    // detectMethodDiffs writes plain dates, but a future migration that
    // stores full ISO timestamps or epoch ms would silently break the
    // string-compare semantics. .slice(0,10) is no-op for already-truncated
    // dates and correct for ISO timestamps (e.g. '2026-05-17T12:00Z' → '2026-05-17').
    const hasRecentChange = Object.values(methods).some(m => {
      if (!m || !m.lastChanged) return false;
      const ts = String(m.lastChanged).slice(0, 10);
      return ts >= cutoffDate;
    });
    if (hasRecentChange) prunedMethodState[ticker] = methods;
  }
  const committed = {
    lastRun: state.lastRun,
    methodState: prunedMethodState,
    // F-SM-003: explicitly exclude methodHistory from committed file
    fieldCoverage: state.fieldCoverage
  };
  // F-SM-008: write sidecar first, then committed state (sidecar failure won't skew stores)
  _saveMethodHistory(state.methodHistory || {});
  // Atomic write via tmp+rename (was already done; preserved from existing code)
  const tmp = statePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(committed)); // Tag 119: no pretty-print
  fs.renameSync(tmp, statePath);
}

// ─── Diff-Detector ────────────────────────────────────────────────

function detectMethodDiffs(prevMethods, currResults, today) {
  // prevMethods: { 'rule-of-40': { value, pass, lastChanged }, ... } oder {}
  // currResults: aus Runner.evaluateStock()
  const events = [];
  const newState = {};
  for (const [methodId, result] of Object.entries(currResults)) {
    const prev = prevMethods[methodId];
    const wasPass = prev && prev.pass === true;
    const isPass = result.computable && result.pass === true;
    const wasComputable = prev && prev.value != null;
    const isComputable = result.computable;

    // Events nur wenn beide computable sind UND pass-Status flippt
    if (wasComputable && isComputable && wasPass !== isPass) {
      const lastChanged = today;
      if (isPass) {
        events.push({
          methodId,
          type: 'METHOD_PASS_GAINED',
          severity: 'INFO',
          message: `${methodId}: ${prev.value != null ? prev.value.toFixed(2) : '?'} → ${result.value != null ? result.value.toFixed(2) : '?'} (now PASS)`
        });
      } else {
        events.push({
          methodId,
          type: 'METHOD_PASS_LOST',
          severity: 'WARNING',
          message: `${methodId}: ${prev.value != null ? prev.value.toFixed(2) : '?'} → ${result.value != null ? result.value.toFixed(2) : '?'} (now FAIL)`
        });
      }
      newState[methodId] = { value: result.value, pass: isPass, lastChanged };
    } else if (wasComputable && !isComputable) {
      // F-GC-014 (Tag 182): emit event when a method goes computable→incomputable.
      // Previously this transition was silent — a Yahoo schema change that broke
      // a method's data dependency would erase buy/sell signals without any
      // alert. Treat as a WARNING-tier diagnostic so Karl notices upstream gaps.
      events.push({
        methodId,
        type: 'METHOD_INCOMPUTABLE',
        severity: 'WARNING',
        message: `${methodId}: was ${prev.value != null ? prev.value.toFixed(2) : '?'} (${wasPass ? 'PASS' : 'FAIL'}) → now NOT COMPUTABLE`
      });
      newState[methodId] = {
        value: null, pass: false,
        lastChanged: today,
        wasComputable: true
      };
    } else if (!prev && isComputable) {
      // F-SM-012: first-time observation — mark firstSeen so UI can distinguish
      // "just added to universe" from "long-term PASS/FAIL"
      //
      // Tag 216b (audit F-216-04 MEDIUM fix): emit METHOD_PASS_NEW event when
      // the first-observed ticker is already passing. Previously this branch
      // silently set state without alerting; Karl lost signal on newly-added
      // universe entrants that were strong from day-1. The event is INFO
      // severity (not WARNING) — it's an opportunity flag, not a regression.
      if (isPass) {
        events.push({
          methodId,
          type: 'METHOD_PASS_NEW',
          severity: 'INFO',
          message: methodId + ': first observation in universe, value=' +
                   (Number.isFinite(result.value) ? result.value.toFixed(2) : result.value) +
                   ' (PASS — new entrant already strong)'
        });
      }
      newState[methodId] = {
        value: result.value,
        pass: isPass,
        lastChanged: today,
        firstSeen: true
      };
    } else if (prev && prev.wasComputable === true && !wasComputable && isComputable) {
      // Tag 229c-1: METHOD_RECOVERED — the asymmetric counterpart of
      // METHOD_INCOMPUTABLE. After METHOD_INCOMPUTABLE writes
      // {value:null, pass:false, wasComputable:true}, `prev.value === null`
      // makes wasComputable=false here. A method that goes
      // computable → incomputable → computable previously fell into the final
      // ELSE branch and silently wrote new state with no event — Karl lost
      // signal on every recovery from a Yahoo schema gap. We use the sticky
      // `prev.wasComputable` marker (set when entering METHOD_INCOMPUTABLE) to
      // detect recovery and emit an INFO event so the upstream-gap-closed
      // transition is observable. Severity is INFO not WARNING — a fixed gap
      // is an opportunity flag, paralleling METHOD_PASS_NEW.
      events.push({
        methodId,
        type: 'METHOD_RECOVERED',
        severity: 'INFO',
        message: methodId + ': recovered from NOT COMPUTABLE → value=' +
                 (Number.isFinite(result.value) ? result.value.toFixed(2) : result.value) +
                 ' (' + (isPass ? 'PASS' : 'FAIL') + ')'
      });
      newState[methodId] = {
        value: result.value,
        pass: isPass,
        lastChanged: today
      };
    } else {
      // Behalte lastChanged falls vorhanden, sonst heute
      newState[methodId] = {
        value: result.computable ? result.value : null,
        pass: isPass,
        lastChanged: prev && prev.lastChanged ? prev.lastChanged : today
      };
    }
  }
  return { events, newState };
}

// ─── Discord-Webhook (legacy, wird nicht aktiv genutzt da Karl Discord nicht will) ───

async function postToDiscord(webhook, content) {
  if (!webhook) return false;
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    return res.ok;
  } catch (e) {
    _log('ERROR', `Discord post failed: ${e.message}`);
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    snapshots: './snapshots',
    state: './alert-state.json',
    webhook: process.env.DISCORD_WEBHOOK || ''
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--state' && argv[i+1]) args.state = argv[++i];
    else if (argv[i] === '--webhook' && argv[i+1]) args.webhook = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.snapshots)) {
    _log('ERROR', `Snapshots-Ordner fehlt: ${args.snapshots}`);
    process.exit(1);
  }
  const state = loadState(args.state);
  const today = new Date().toISOString().slice(0, 10);

  // Tag 222b (audit Tag 221a M3 fix): one-time orphan-method cleanup.
  // alert-state.methodState carries entries per ticker × method-id. When a
  // method is renamed or removed (e.g. reinvestment-rate, fcf-yield,
  // deceleration-guard, forecast-contamination-guard,
  // quarter-concentration-guard, quarterly-rev-acceleration — 6 orphans
  // flagged by the audit), its state entry becomes orphan noise that bloats
  // alert-state.json (~21MB) and the diff-report. Drop any entry whose
  // method-id is not in the live REGISTRY before processing this run.
  try {
    const liveMethodIds = new Set(Runner.getMethods().map(m => m.id));
    let droppedCount = 0, tickersTouched = 0;
    for (const [ticker, methods] of Object.entries(state.methodState || {})) {
      if (!methods || typeof methods !== 'object') continue;
      const before = Object.keys(methods).length;
      for (const mid of Object.keys(methods)) {
        if (!liveMethodIds.has(mid)) {
          delete methods[mid];
          droppedCount++;
        }
      }
      if (Object.keys(methods).length !== before) tickersTouched++;
    }
    if (droppedCount > 0) {
      _log('INFO', `orphan-method cleanup: dropped ${droppedCount} entries across ${tickersTouched} tickers (live methods: ${liveMethodIds.size})`);
    }
  } catch (e) {
    _log('WARN', 'orphan-method cleanup failed: ' + e.message);
  }

  // F-SM-014: prior state preserved so tickers absent from a partial pull are NOT deleted.
  // Tag 223c (audit F-222a-3 BLOCKING fix): swapped two JSON.parse(JSON.stringify(...))
  // deep-clones for shallow Object.assign copies. The loop below at ~line 316 reassigns
  // newState.methodState[ticker] = tickerNewState wholesale (whole-reference swap), so
  // structural sharing is fine — entries for current-run tickers are entirely replaced,
  // and absent-ticker entries keep their original reference (which we never mutate
  // because the loop only ever sets newState.methodState[ticker], never deep-edits).
  // Same reasoning applies to methodHistory. Saves 2× full O(N) walks of 20.6 MB
  // (~3-5s today, ~25-40s at 19k) plus multi-GB transient heap during JSON parse.
  const newState = {
    lastRun: new Date().toISOString(),
    methodState: Object.assign({}, state.methodState || {}),
    methodHistory: Object.assign({}, state.methodHistory || {}),
    fieldCoverage: state.fieldCoverage
  };

  const files = fs.readdirSync(args.snapshots).filter(f => f.endsWith('.json') && f !== '_manifest.json');
  if (files.length === 0) {
    _log('WARN', 'Keine Snapshot-Files gefunden.');
    process.exit(0);
  }

  const allEvents = [];
  const allStocks = [];

  // Tag 223c (audit F-222a-10 MEDIUM fix): load snapshot files in parallel
  // batches via fs.promises.readFile (same pattern as snapshot-methods-history.js
  // F-PF-007/009). Previously sync readFileSync over every snapshot serial =
  // ~18s at 3.5k tickers, ~95s at 19k. With 4 libuv workers ~3-4× faster.
  const SNAPSHOT_LOAD_BATCH = 200;
  const loadedSnapshots = [];
  for (let i = 0; i < files.length; i += SNAPSHOT_LOAD_BATCH) {
    const batch = files.slice(i, i + SNAPSHOT_LOAD_BATCH);
    const loaded = await Promise.all(batch.map(async f => {
      try {
        const raw = await fs.promises.readFile(path.join(args.snapshots, f), 'utf8');
        return { file: f, stock: JSON.parse(raw), error: null };
      } catch (e) {
        return { file: f, stock: null, error: e.message };
      }
    }));
    loadedSnapshots.push(...loaded);
  }

  for (const { file, stock, error } of loadedSnapshots) {
    if (error || !stock) {
      _log('WARN', `Skip ${file}: parse error ${error || 'null data'}`);
      continue;
    }
    allStocks.push(stock);
    const ticker = (stock.meta && stock.meta.ticker) || file.replace(/\.json$/, '');
    const results = Runner.evaluateStock(stock);
    const prevMethods = state.methodState[ticker] || {};
    const { events, newState: tickerNewState } = detectMethodDiffs(prevMethods, results, today);
    newState.methodState[ticker] = tickerNewState;
    // Tag-31: append history per method per ticker
    const tickerHist = state.methodHistory[ticker] || {};
    const newHist = {};
    for (const [methodId, result] of Object.entries(results)) {
      if (result.computable) {
        newHist[methodId] = Trend.appendHistory(tickerHist[methodId] || [], today, result.value, result.pass);
      } else if (tickerHist[methodId]) {
        newHist[methodId] = tickerHist[methodId];  // preserve prior history if current incomputable
      }
    }
    newState.methodHistory[ticker] = newHist;
    if (events.length) {
      _log('INFO', `${ticker}: ${events.map(e => e.type + '/' + e.severity + ': ' + e.message).join(' | ')}`);
      events.forEach(ev => allEvents.push(Object.assign({ ticker }, ev)));
    }
  }

  // Tag-22: Field-Coverage
  const currentCoverage = FieldCoverage.computeCoverage(allStocks);
  const todayEntry = { date: today, coverage: currentCoverage };
  const newHistory = FieldCoverage.updateHistory(state.fieldCoverage.history, todayEntry);
  const newBaseline = FieldCoverage.computeBaseline(newHistory);
  const drifts = FieldCoverage.detectDrift(currentCoverage, newBaseline);
  newState.fieldCoverage = { history: newHistory, baseline: newBaseline };
  if (drifts.length) {
    for (const d of drifts) {
      const msg = `${d.field}: ${(d.current*100).toFixed(0)}% (baseline ${(d.baseline*100).toFixed(0)}%, drop ${(d.drop*100).toFixed(0)}pp)`;
      _log('WARN', `FIELD_DRIFT: ${msg}`);
      allEvents.push({ ticker: '_GLOBAL', methodId: '_FIELD_COVERAGE', type: 'FIELD_DRIFT', severity: 'WARNING', message: msg });
    }
  }

  saveState(args.state, newState);
  _log('INFO', `state saved: ${args.state} (${Object.keys(newState.methodState).length} tickers tracked)`);

  if (allEvents.length === 0) {
    _log('INFO', 'Keine Method-Pass-Fail-Wechsel oder Drift. Kein Alert.');
    process.exit(0);
  }

  const critical = allEvents.filter(e => e.severity === 'CRITICAL');
  const warning = allEvents.filter(e => e.severity === 'WARNING');
  const info = allEvents.filter(e => e.severity === 'INFO');
  _log('INFO', `Events: ${critical.length} critical · ${warning.length} warning · ${info.length} info`);

  if (args.webhook) {
    let msg = `**📊 Method-Changes ${today}**\n`;
    if (warning.length) {
      msg += `\n🟡 **METHOD_PASS_LOST** (${warning.length}):\n`;
      msg += warning.slice(0, 10).map(e => `  • ${e.ticker}: ${e.message}`).join('\n');
    }
    if (info.length && warning.length === 0) {
      msg += `\nℹ️ **METHOD_PASS_GAINED** (${info.length}):\n`;
      msg += info.slice(0, 10).map(e => `  • ${e.ticker}: ${e.message}`).join('\n');
    }
    if (msg.length > 1900) msg = msg.slice(0, 1850) + '\n…(truncated)';
    const posted = await postToDiscord(args.webhook, msg);
    if (posted) _log('INFO', `Discord-Alert posted (${allEvents.length} events).`);
  }

  process.exit(0);
}

if (require.main === module) {
  main().catch(e => {
    _log('FATAL', e.stack || e.message);
    process.exit(1);
  });
}

module.exports = { detectMethodDiffs, loadState, saveState };
