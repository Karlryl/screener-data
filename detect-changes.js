#!/usr/bin/env node
/**
 * Tag 16: Detect-Changes + Alerts
 * ================================
 *
 * Liest snapshots/*.json (canonicalInput-Snapshots aus pull-yahoo.js),
 * scoret jeden Stock via Engine, vergleicht mit alert-state.json (gestern-Stand),
 * feuert Discord-Webhook bei:
 *   - Bucket-Wechsel (A→B, B→INFLECTION, → OUT etc.)
 *   - Action-Wechsel (QUALIFIED → REVIEW → DISQUALIFIED)
 *   - Neuer Hard-Penalty (z.B. EXCLUDE_CASH_RUNWAY, EXCLUDE_MCAP_LOW, SBC_EXTREME_HARD)
 *   - Erst-Klassifikation (Stock noch nie geseen)
 *
 * Run:
 *   node detect-changes.js [--snapshots ./snapshots] [--state ./alert-state.json] [--webhook $DISCORD_WEBHOOK]
 *
 * Workflow-Integration:
 *   - Step nach pull-yahoo.js
 *   - DISCORD_WEBHOOK als GitHub-Secret
 *   - alert-state.json wird mit-committet (state-of-yesterday)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Engine + Tracks + Manipulation-Filters laden
let Engine, ManipulationFilters, ScoreOrchestrator;
try {
  Engine = require('./engine-v7.3.js');
  ManipulationFilters = require('./manipulation-filters.js');
  ScoreOrchestrator = require('./score-orchestrator.js');
} catch (e) {
  console.error('FATAL: engine-v7.3.js, manipulation-filters.js oder score-orchestrator.js fehlen.');
  console.error('       Erwartet im selben Ordner. Error:', e.message);
  process.exit(1);
}

function _ts() { return new Date().toISOString(); }
function _log(level, msg) { console.log(`[${_ts()}] [${level}] ${msg}`); }

// ─── Hard-Penalty-Codes — Tag-18-Audit-P2-Fix: aus orchestrator importieren statt duplizieren.
const HARD_PENALTY_CODES = ScoreOrchestrator.HARD_PENALTY_CODES;

// ─── Score-Wrapper: läuft Engine + Manipulation-Filters über einen Snapshot ──
// Tag-17-Fix: Multi-Track-Score statt naivem Track-A-First.
// Reife Quality-Compounder (NVO 24%, MSFT 18%, ASML 13% growth) sind unter Track-A-
// Hypergrowth-Floor und scoren als OUT — obwohl Track-B sie korrekt als A/B einordnen würde.
// Lösung: beide Tracks laufen lassen wenn beide passable, den mit dem höheren finalScore wählen.
// Bei Tie: bei sub-Profile-Hint (HEALTHCARE, sehr reife Tech) Track-B bevorzugen, sonst A.
function scoreSnapshot(stock, fxRates) {
  // Tag-18-Fix: zentral via ScoreOrchestrator. Vorher dupliziert in detect-changes
  // und Dashboard. Konsistenz-Garantie: beide Konsumenten produzieren identische Scores.
  return ScoreOrchestrator.scoreSnapshot(stock, { fxRates, engine: Engine, manipulationFilters: ManipulationFilters });
}


// ─── Alert-State-Format ───
// alert-state.json: { lastRun, byTicker: { TICKER: { bucket, action, hardPenalties[], scoreScored: 'YYYY-MM-DD' }}}

function loadState(statePath) {
  if (!fs.existsSync(statePath)) {
    return { lastRun: null, byTicker: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (e) {
    _log('WARN', `state-file unparseable, treating as fresh: ${e.message}`);
    return { lastRun: null, byTicker: {} };
  }
}

function saveState(statePath, state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// ─── Diff-Detector ───────────────────────────────────────────────

function detectDiff(prev, curr, position) {
  // Tag-18: position-aware Severity (Karl-Buy-only-Reframing).
  // position: 'owned' | 'watching' | undefined
  const events = [];
  const currBucket = (curr.bucket && curr.bucket.id) || null;
  const currAction = curr.actionStatus;
  const currCodes = curr.reasonCodes || [];
  const currHardPenalties = currCodes.filter(c => HARD_PENALTY_CODES.has(c));
  const currBuyStatus = ScoreOrchestrator.buyStatus(curr, position);

  if (!prev) {
    events.push({
      type: 'FIRST_SEEN',
      // Tag-19-Audit-P1-3: Severity nach buyStatus. Neuer Stock direkt OUT/Hard-Penalty
      // ist Karl-relevant ("schlechter Watchlist-Pick"), nicht INFO.
      severity: ScoreOrchestrator.alertSeverity('FIRST_SEEN', currBuyStatus, position),
      message: `bucket=${currBucket} action=${currAction} buyStatus=${currBuyStatus}`
    });
  } else {
    if (currBucket !== prev.bucket) {
      const ORDER = ['A', 'B', 'INFLECTION', 'SPEC', 'OUT', null];
      const prevIdx = ORDER.indexOf(prev.bucket);
      const currIdx = ORDER.indexOf(currBucket);
      const direction = currIdx > prevIdx ? 'DOWNGRADE' : (currIdx < prevIdx ? 'UPGRADE' : 'LATERAL');
      const arrow = direction === 'DOWNGRADE' ? '↓' : (direction === 'UPGRADE' ? '↑' : '·');
      events.push({
        type: 'BUCKET_CHANGE',
        severity: ScoreOrchestrator.alertSeverity('BUCKET_CHANGE', direction, position),
        direction,
        message: `${prev.bucket} → ${currBucket} ${arrow} ${direction}` +
                 (position === 'owned' && direction === 'DOWNGRADE'
                   ? ' (gehalten — Conviction-Hinweis, kein Sell-Trigger; Sells via EW)'
                   : (position !== 'owned' && direction === 'DOWNGRADE'
                      ? ' (von Watchlist streichen wenn weiter fällt)'
                      : ''))
      });
    }
    if (currAction !== prev.action) {
      events.push({
        type: 'ACTION_CHANGE',
        severity: ScoreOrchestrator.alertSeverity('ACTION_CHANGE', currAction, position),
        message: `${prev.action} → ${currAction}` +
                 (position === 'owned' ? ' (gehalten — kein Sell-Trigger; Sells via EW)' : '')
      });
    }
    const prevHard = new Set(prev.hardPenalties || []);
    const newHard = currHardPenalties.filter(c => !prevHard.has(c));
    if (newHard.length) {
      events.push({
        type: 'NEW_HARD_PENALTY',
        severity: ScoreOrchestrator.alertSeverity('NEW_HARD_PENALTY', null, position),
        message: newHard.join(', ') +
                 (position === 'owned' ? ' (Conviction-Check empfohlen — Buy-Stop für künftige Käufe)' : ' (Buy-Stop)')
      });
    }
    // Tag-19-Audit-P0-2 + P1-8-Fix: BUY_STATUS_CHANGE auch bei state-Migration ohne buyStatus,
    // plus saubere Severity-Logik (BUY_READY-Aufstieg, NO_BUY-Abstieg, OWNED_CRITICAL alle CRITICAL).
    const prevBuy = prev.buyStatus || 'UNKNOWN';
    if (prevBuy !== currBuyStatus) {
      const becomesNegative = currBuyStatus === 'NO_BUY';
      const becomesPositive = currBuyStatus === 'BUY_READY';
      const ownedDegraded = (currBuyStatus === 'OWNED_REVIEW' || currBuyStatus === 'OWNED_CRITICAL');
      const isCritical = becomesNegative || becomesPositive || ownedDegraded;
      events.push({
        type: 'BUY_STATUS_CHANGE',
        severity: isCritical ? 'CRITICAL' : 'INFO',
        message: `${prevBuy} → ${currBuyStatus}`
      });
    }
  }
  return {
    events,
    currState: {
      bucket: currBucket,
      action: currAction,
      buyStatus: currBuyStatus,
      hardPenalties: currHardPenalties,
      position: position || null,
      scoreScored: new Date().toISOString().slice(0, 10)
    }
  };
}

// ─── Discord-Webhook ─────────────────────────────────────────────

async function postToDiscord(webhook, content) {
  if (!webhook) {
    _log('WARN', 'Kein Webhook konfiguriert, skip notification.');
    return false;
  }
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) {
      _log('ERROR', `Discord HTTP ${res.status}: ${res.statusText}`);
      return false;
    }
    return true;
  } catch (e) {
    _log('ERROR', `Discord post failed: ${e.message}`);
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    snapshots: './snapshots',
    state: './alert-state.json',
    watchlist: './watchlist.json',
    webhook: process.env.DISCORD_WEBHOOK || ''
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--state' && argv[i+1]) args.state = argv[++i];
    else if (argv[i] === '--watchlist' && argv[i+1]) args.watchlist = argv[++i];
    else if (argv[i] === '--webhook' && argv[i+1]) args.webhook = argv[++i];
  }
  return args;
}

// Tag-18: Watchlist-Position pro Ticker extrahieren (für position-aware Severity).
function loadPositionMap(watchlistPath) {
  const map = {};
  if (!fs.existsSync(watchlistPath)) return map;
  try {
    const wl = JSON.parse(fs.readFileSync(watchlistPath, 'utf8'));
    for (const s of (wl.stocks || [])) {
      if (s.ticker) map[s.ticker] = s.position || 'watching';
    }
  } catch (e) { /* skip silently — position bleibt undefined */ }
  return map;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.snapshots)) {
    _log('ERROR', `Snapshots-Ordner fehlt: ${args.snapshots}`);
    process.exit(1);
  }
  const state = loadState(args.state);
  const newState = { lastRun: new Date().toISOString(), byTicker: {} };
  const positions = loadPositionMap(args.watchlist);
  _log('INFO', `Loaded ${Object.keys(positions).length} positions from ${args.watchlist}`);

  // Watchlist-Files lesen (alle .json außer _manifest)
  const files = fs.readdirSync(args.snapshots).filter(f => f.endsWith('.json') && f !== '_manifest.json');
  if (files.length === 0) {
    _log('WARN', 'Keine Snapshot-Files gefunden.');
    process.exit(0);
  }

  // FX-Rates: heute hardcoded — Tag 17+ kann das aus separatem fxRates.json kommen
  const fxRates = { EUR_USD: 1.07, USD_USD: 1, DKK_USD: 0.143, GBP_USD: 1.27 };

  const allEvents = [];
  for (const file of files) {
    const filePath = path.join(args.snapshots, file);
    let stock;
    try {
      stock = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      _log('WARN', `Skip ${file}: parse error ${e.message}`);
      continue;
    }
    const ticker = (stock.meta && stock.meta.ticker) || file.replace(/\.json$/, '');
    let score;
    try {
      score = scoreSnapshot(stock, fxRates);
    } catch (e) {
      // Tag-19-Audit-P1-7: ausführlicheres Logging für Diagnostik bei NaN-Pfaden
      _log('WARN', `Skip ${ticker}: score error ${e.message}\n  stack: ${(e.stack||'').split('\n').slice(0,3).join(' | ')}`);
      continue;
    }
    const prev = state.byTicker[ticker];
    const position = positions[ticker] || 'watching';
    const { events, currState } = detectDiff(prev, score, position);
    newState.byTicker[ticker] = currState;
    if (events.length) {
      _log('INFO', `${ticker}: ${events.map(e => e.type + '/' + e.severity + ': ' + e.message).join(' | ')}`);
      events.forEach(ev => allEvents.push(Object.assign({ ticker }, ev)));
    }
  }

  // Save state for next run
  saveState(args.state, newState);
  _log('INFO', `state saved: ${args.state} (${Object.keys(newState.byTicker).length} tickers)`);

  // Wenn keine Events: nichts posten
  if (allEvents.length === 0) {
    _log('INFO', 'Keine Bucket/Action-Wechsel oder neue Hard-Penalties. Kein Alert.');
    process.exit(0);
  }

  // Discord-Notification: gruppiere nach Severity
  const critical = allEvents.filter(e => e.severity === 'CRITICAL');
  const warning = allEvents.filter(e => e.severity === 'WARNING');
  const info = allEvents.filter(e => e.severity === 'INFO');

  let msg = `**📊 Watchlist-Alerts ${new Date().toISOString().slice(0, 10)}**\n`;
  if (critical.length) {
    msg += `\n🔴 **CRITICAL** (${critical.length}):\n`;
    msg += critical.map(e => `  • ${e.ticker}: ${e.type} — ${e.message}`).join('\n');
  }
  if (warning.length) {
    msg += `\n🟡 **WARNING** (${warning.length}):\n`;
    msg += warning.map(e => `  • ${e.ticker}: ${e.type} — ${e.message}`).join('\n');
  }
  if (info.length && critical.length + warning.length === 0) {
    msg += `\nℹ️ **INFO** (${info.length}):\n`;
    msg += info.slice(0, 5).map(e => `  • ${e.ticker}: ${e.type} — ${e.message}`).join('\n');
    if (info.length > 5) msg += `\n  …und ${info.length - 5} weitere.`;
  }

  if (msg.length > 1900) msg = msg.slice(0, 1850) + '\n…(truncated)';

  const posted = await postToDiscord(args.webhook, msg);
  if (posted) _log('INFO', `Discord-Alert posted (${allEvents.length} events).`);
  else _log('WARN', 'Discord-Alert NOT posted (siehe Log oben).');

  process.exit(0);
}

if (require.main === module) {
  main().catch(e => {
    _log('FATAL', e.stack || e.message);
    process.exit(1);
  });
}

module.exports = { detectDiff, scoreSnapshot };
