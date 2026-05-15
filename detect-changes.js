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
  let parsed = null;
  if (fs.existsSync(statePath)) {
    try { parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
    catch (e) {
      _log('WARN', `state-file unparseable, treating as fresh: ${e.message}`);
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
    // Keep if any method was changed within 30 days
    const hasRecentChange = Object.values(methods).some(m => m && m.lastChanged && m.lastChanged >= cutoffDate);
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
      newState[methodId] = {
        value: result.value,
        pass: isPass,
        lastChanged: today,
        firstSeen: true
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
  // F-SM-014: deep clone prior state so tickers absent from a partial pull are NOT deleted.
  // Only entries for tickers present in the current snapshots are overwritten below.
  const newState = {
    lastRun: new Date().toISOString(),
    methodState: JSON.parse(JSON.stringify(state.methodState || {})),
    methodHistory: JSON.parse(JSON.stringify(state.methodHistory || {})),
    fieldCoverage: state.fieldCoverage
  };

  const files = fs.readdirSync(args.snapshots).filter(f => f.endsWith('.json') && f !== '_manifest.json');
  if (files.length === 0) {
    _log('WARN', 'Keine Snapshot-Files gefunden.');
    process.exit(0);
  }

  const allEvents = [];
  const allStocks = [];

  for (const file of files) {
    const filePath = path.join(args.snapshots, file);
    let stock;
    try { stock = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch (e) { _log('WARN', `Skip ${file}: parse error ${e.message}`); continue; }
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
