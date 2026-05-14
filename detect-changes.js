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

// Tag 134 — Phase 5.2: methodHistory subtree moved out of committed alert-state.json
// to external-data/method-history-state.json (git-ignored).
// Was bloating the repo by ~25 MB per push. Rebuildable from methods-history/*.
const HISTORY_SIDECAR = path.join(__dirname, 'external-data', 'method-history-state.json');

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
  try {
    if (!fs.existsSync(path.dirname(HISTORY_SIDECAR))) fs.mkdirSync(path.dirname(HISTORY_SIDECAR), { recursive: true });
    fs.writeFileSync(HISTORY_SIDECAR, JSON.stringify({ lastSaved: new Date().toISOString(), methodHistory: history }));
  } catch (e) { _log('WARN', 'failed to write history sidecar: ' + e.message); }
}

function loadState(statePath) {
  // Tag-21-Robustness + Tag-29-Schema-Migration + Tag 134 Phase 5.2 sidecar load
  const fallback = { lastRun: null, methodState: {}, methodHistory: {}, fieldCoverage: { history: [], baseline: {} } };
  let parsed = null;
  if (fs.existsSync(statePath)) {
    try { parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
    catch (e) {
      _log('WARN', `state-file unparseable, treating as fresh: ${e.message}`);
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
  // Tag 134 Phase 5.2: methodHistory now lives in the sidecar.
  // Migration: if the committed alert-state.json still has an inline methodHistory
  // (from before this change), use it as the initial sidecar value and let the next
  // save move it out of the committed file.
  const inlineHistory = (parsed.methodHistory && typeof parsed.methodHistory === 'object' && !Array.isArray(parsed.methodHistory)) ? parsed.methodHistory : null;
  const sidecarHistory = _loadMethodHistory();
  const methodHistory = Object.keys(sidecarHistory).length > 0 ? sidecarHistory : (inlineHistory || {});
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
  // Tag 134 Phase 5.2: split write — methodHistory to sidecar, everything else to committed file.
  const committed = {
    lastRun: state.lastRun,
    methodState: state.methodState,
    fieldCoverage: state.fieldCoverage
  };
  const tmp = statePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(committed)); // Tag 119: no pretty-print
  fs.renameSync(tmp, statePath);
  _saveMethodHistory(state.methodHistory || {});
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
    } else {
      // Behalte lastChanged falls vorhanden, sonst heute
      newState[methodId] = {
        value: result.computable ? result.value : null,
        pass: isPass,
        lastChanged: prev && prev.lastChanged ? prev.lastChanged : today
      };
    }

    // First-time detection: wenn kein prev-state, optional FIRST_SEEN-Event (skip per default — alert-noise)
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
  const newState = { lastRun: new Date().toISOString(), methodState: {}, methodHistory: {}, fieldCoverage: state.fieldCoverage };

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
