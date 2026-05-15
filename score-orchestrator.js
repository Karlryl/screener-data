/**
 * v7.3 Score-Orchestrator — Tag 18
 * ===================================
 *
 * Single source of truth für Score-Berechnung. Beide Konsumenten (Browser-Dashboard
 * und detect-changes.js) nutzen diese Funktion → keine Drift mehr zwischen Pfaden.
 *
 * Plus: Karl-spezifische Buy-only-Semantik:
 *   - Tool ist BUY-ONLY (Sells laufen über Elliott Waves extern)
 *   - Bucket-DOWNGRADE für owned-Positions ist nicht-relevant
 *   - Bucket-UPGRADE = neuer Buy-Kandidat (CRITICAL severity)
 *   - Hard-Penalty NEU = Buy-Stop (CRITICAL severity)
 *
 * Public API:
 *   const result = ScoreOrchestrator.scoreSnapshot(stock, { fxRates, engine, manipulationFilters });
 *   const buyStatus = ScoreOrchestrator.buyStatus(result, position);
 *   const severity = ScoreOrchestrator.alertSeverity(eventType, direction, position);
 */

'use strict';

const ORCHESTRATOR_VERSION = '1.0.0';

// ─── Buy-Status-Mapping (Karl-spezifisch) ─────────────────────────

const BUY_READY_BUCKETS = new Set(['A', 'B']);
const WATCH_BUCKETS = new Set(['INFLECTION', 'SPEC']);
const NO_BUY_BUCKETS = new Set(['OUT']);

// Hard-Penalty-Codes die einen sofortigen Buy-Stop auslösen (auch bei A/B-Bucket).
// F-EN-006 (Tag 181): EXCLUDE_DILUTION_EXTREME and CORPORATE_ACTION_RISK are not
// currently emitted by the engine — kept here as forward-compatible reservations
// for future filters. They will be matched if/when a code path emits them and
// stay protected by isHardPenalty's prefix-/suffix-heuristic in the meantime.
const HARD_PENALTY_CODES = new Set([
  'EXCLUDE_CASH_RUNWAY',          // engine-v7.3 emits
  'EXCLUDE_MCAP_LOW',             // engine-v7.3 emits
  'SBC_EXTREME_HARD',             // engine-v7.3 emits
  'EXCLUDE_DILUTION_EXTREME',     // reserved — heuristic catches anyway
  'CORPORATE_ACTION_RISK'         // reserved — for spin-off/split risk filter
]);

// Tag-19-Audit-P1-2-Fix: Heuristik fuer Engine-erzeugte Hard-Penalty-Codes,
// die nicht in der statischen Liste sind (z.B. EXCLUDE_NO_GROWTH, EXCLUDE_SECTOR_FIT,
// SBC_EXTREME_HARD-Pattern fuer kuenftige Codes).
function isHardPenalty(code) {
  if (!code) return false;
  if (HARD_PENALTY_CODES.has(code)) return true;
  if (code.startsWith('EXCLUDE_')) return true;
  if (code.endsWith('_HARD')) return true;
  return false;
}

/**
 * Berechnet Buy-Status für einen Stock basierend auf Score + Position.
 *
 * Returns one of:
 *   - 'BUY_READY'   — Bucket A/B, keine Hard-Penalty, position != 'owned'
 *   - 'OWNED_OK'    — position = 'owned', Bucket noch A/B/INFLECTION (These bestätigt)
 *   - 'OWNED_REVIEW' — position = 'owned', Bucket gefallen auf SPEC/OUT (Conviction-Check nötig)
 *   - 'WATCH'       — INFLECTION/SPEC, beobachten
 *   - 'NO_BUY'      — OUT/DISQUALIFIED oder neue Hard-Penalty
 *   - 'UNCLASSIFIABLE' — kein Score
 */
function buyStatus(scoreResult, position) {
  if (!scoreResult || !scoreResult.bucket || !scoreResult.bucket.id) {
    return 'UNCLASSIFIABLE';
  }
  const bucket = scoreResult.bucket.id;
  const codes = scoreResult.reasonCodes || [];
  const hasHardPenalty = codes.some(isHardPenalty) || scoreResult.hardExcluded;

  if (position === 'owned') {
    // Tag-19-Audit-P1-1-Fix: Hard-Penalty fuer owned-Stocks ist existenz-bedrohend
    // (z.B. EXCLUDE_CASH_RUNWAY) und semantisch unterschiedlich von normalem Bucket-Demote.
    // OWNED_CRITICAL signalisiert "These bricht — Konvtiktion sofort pruefen".
    if (hasHardPenalty) return 'OWNED_CRITICAL';
    if (BUY_READY_BUCKETS.has(bucket)) return 'OWNED_OK';
    return 'OWNED_REVIEW';
  }

  // position = 'watching' oder undefined
  if (hasHardPenalty) return 'NO_BUY';
  if (BUY_READY_BUCKETS.has(bucket)) return 'BUY_READY';
  if (WATCH_BUCKETS.has(bucket)) return 'WATCH';
  return 'NO_BUY';
}

// ─── Tag-19 Data-Cleanup-Layer ───────────────────────────────────
// Yahoo's quoteSummary liefert für manche Stocks (z.B. RHM.DE) kein revenueGrowth-Feld.
// Engine sieht dann `metrics.revenueGrowthYoY=null` und scort UNCLASSIFIABLE_DATA_RISK.
// Fix: aus `annual.annualRev[0]` und `[1]` selbst berechnen (mathematisch identisch
// zu Yahoo's eigener Berechnung). Funktioniert universell — pull-pipeline,
// manuell-pasted Snapshots, alle Konsumenten.

// Tag-20: defensive gegen Yahoo-Field-Drifts. Falls TTM-Margins fehlen, aus annual[0]
// derived. Annual ≠ TTM exakt (Annual-FY vs Last-4-Quartals), aber als Fallback OK
// und besser als UNCLASSIFIABLE. Confidence niedrig (0.5-0.6), damit Engine es als
// Risk-Faktor erkennen kann.
function _missing(metric) {
  return !metric || metric.value == null || (typeof metric.value === 'number' && !Number.isFinite(metric.value));
}

function _fillDerivedMetrics(stock) {
  if (!stock || !stock.metrics || !stock.annual) return stock;
  const m = stock.metrics;
  const a = stock.annual;
  const fetchedAt = stock.meta && stock.meta.fetchedAt;
  let cloned = null;

  // Hilfsfunktion: lazy-clone wenn nötig, Mutationen passieren am Klon
  function _ensureCloned() {
    if (!cloned) cloned = JSON.parse(JSON.stringify(stock));
    return cloned;
  }

  // P0: revenueGrowthYoY-Fallback aus annualRev[0]/[1] (Tag-19, RHM-Case)
  if (_missing(m.revenueGrowthYoY) && Array.isArray(a.annualRev) && a.annualRev.length >= 2) {
    const r0 = a.annualRev[0] && a.annualRev[0].value;
    const r1 = a.annualRev[1] && a.annualRev[1].value;
    if (r0 != null && r1 != null && r1 !== 0) {
      const c = _ensureCloned();
      c.metrics.revenueGrowthYoY = {
        value: (r0 - r1) / Math.abs(r1) * 100,
        source: 'orchestrator_derived_from_annualRev',
        confidence: 0.7,
        asOf: fetchedAt
      };
    }
  }

  // Tag-20: grossMargin-Fallback aus annualGP[0]/annualRev[0]
  if (_missing(m.grossMargin) && Array.isArray(a.annualRev) && Array.isArray(a.annualGP)
      && a.annualRev.length >= 1 && a.annualGP.length >= 1) {
    const rev = a.annualRev[0] && a.annualRev[0].value;
    const gp = a.annualGP[0] && a.annualGP[0].value;
    if (rev != null && rev !== 0 && gp != null) {
      const c = _ensureCloned();
      c.metrics.grossMargin = {
        value: (gp / rev) * 100,
        source: 'orchestrator_derived_from_annualGP',
        confidence: 0.6,  // niedriger weil Annual-Approximation für TTM
        asOf: fetchedAt
      };
    }
  }

  // Tag-20: operatingMargin-Fallback aus annualOpInc[0]/annualRev[0]
  if (_missing(m.operatingMargin) && Array.isArray(a.annualRev) && Array.isArray(a.annualOpInc)
      && a.annualRev.length >= 1 && a.annualOpInc.length >= 1) {
    const rev = a.annualRev[0] && a.annualRev[0].value;
    const oi = a.annualOpInc[0] && a.annualOpInc[0].value;
    if (rev != null && rev !== 0 && oi != null) {
      const c = _ensureCloned();
      c.metrics.operatingMargin = {
        value: (oi / rev) * 100,
        source: 'orchestrator_derived_from_annualOpInc',
        confidence: 0.6,
        asOf: fetchedAt
      };
    }
  }

  // Tag-20: fcfMarginTTM-Fallback aus annualFCF[0]/annualRev[0]
  if (_missing(m.fcfMarginTTM) && Array.isArray(a.annualRev) && Array.isArray(a.annualFCF)
      && a.annualRev.length >= 1 && a.annualFCF.length >= 1) {
    const rev = a.annualRev[0] && a.annualRev[0].value;
    const fcf = a.annualFCF[0] && a.annualFCF[0].value;
    if (rev != null && rev !== 0 && fcf != null) {
      const c = _ensureCloned();
      c.metrics.fcfMarginTTM = {
        value: (fcf / rev) * 100,
        source: 'orchestrator_derived_from_annualFCF',
        confidence: 0.5,  // niedrigste — FCF ist quartalsensitiver als Margin
        asOf: fetchedAt
      };
    }
  }

  return cloned || stock;
}

// ─── Multi-Track-Score (Tag 17 Logik, jetzt zentral) ──────────────

function scoreSnapshot(stock, options) {
  options = options || {};
  const Engine = options.engine;
  const ManipulationFilters = options.manipulationFilters;
  const fxRates = options.fxRates || {};

  if (!Engine || typeof Engine.scoreTrackA !== 'function') {
    throw new Error('ScoreOrchestrator.scoreSnapshot needs options.engine with scoreTrackA/B');
  }

  // Tag-19: Data-Cleanup VOR Engine-Aufruf
  stock = _fillDerivedMetrics(stock);

  // Universe-Filter als reasonCode-Hinweis, nicht als Score-Gate (Tag-17-Iter2 Lessons-Learned)
  const passesA = Engine.passesTrackAUniverse ? Engine.passesTrackAUniverse(stock, fxRates) : false;
  const passesB = Engine.passesTrackBUniverse ? Engine.passesTrackBUniverse(stock, fxRates) : false;
  const candidates = [];
  try {
    const sA = Engine.scoreTrackA(stock, { fxRates });
    if (!passesA) sA.reasonCodes = (sA.reasonCodes || []).concat(['UNIVERSE_TRACK_A_FAILED']);
    candidates.push(sA);
  } catch (e) { /* skip */ }
  try {
    const sB = Engine.scoreTrackB(stock, { fxRates });
    if (!passesB) sB.reasonCodes = (sB.reasonCodes || []).concat(['UNIVERSE_TRACK_B_FAILED']);
    candidates.push(sB);
  } catch (e) { /* skip */ }

  // Tag-19-Audit-P0-1-Fix: Universe-Failure als Tiebreaker.
  // Vorher: Track-A finalScore=55 mit UNIVERSE_TRACK_A_FAILED schlug Track-B finalScore=50.
  // Jetzt: Universe-passende Tracks haben Vorrang, bei Tie höchster finalScore.
  function _failedUniverse(s) {
    return (s.reasonCodes || []).some(c => c.startsWith('UNIVERSE_') && c.endsWith('_FAILED'));
  }
  candidates.sort((a, b) => {
    const aF = _failedUniverse(a), bF = _failedUniverse(b);
    if (aF !== bF) return aF ? 1 : -1;  // failed sinkt nach unten
    return (b.finalScore || 0) - (a.finalScore || 0);
  });
  const score = candidates[0];

  if (!score) {
    return {
      finalScore: null,
      actionStatus: 'UNCLASSIFIABLE_DATA_RISK',
      reasonCodes: ['NO_TRACK_APPLICABLE'],
      track: null,
      bucket: null,
      orchestratorVersion: ORCHESTRATOR_VERSION
    };
  }

  // Multi-Track-Output: alternativen Track als Annotation
  if (candidates.length > 1) {
    const alt = candidates[1];
    score.alternativeTrack = {
      track: alt.track,
      finalScore: alt.finalScore,
      bucket: alt.bucket && alt.bucket.id,
      actionStatus: alt.actionStatus
    };
    score.reasonCodes = (score.reasonCodes || []).concat([`MULTI_TRACK_PRIMARY_${score.track}`]);
  }

  // Manipulation-Filter
  if (ManipulationFilters && typeof ManipulationFilters.evaluate === 'function') {
    try {
      const manip = ManipulationFilters.evaluate(stock, score);
      if (manip.codes && manip.codes.length) {
        score.reasonCodes = (score.reasonCodes || []).concat(manip.codes);
      }
    } catch (e) { /* skip */ }
  }

  score.orchestratorVersion = ORCHESTRATOR_VERSION;
  return score;
}

// ─── Alert-Severity-Mapping für Buy-only ──────────────────────────
//
// Tag-18-Karl-Reframing: Tool ist Buy-only. Sells laufen über EW.
// Konsequenz: Bucket-Downgrades sind keine "WARNING/CRITICAL"-Events, sondern
// für die Watchlist-Pflege relevant ("nicht mehr buy-fähig"), nicht für Sell.
//
// eventType: 'BUCKET_CHANGE' | 'ACTION_CHANGE' | 'NEW_HARD_PENALTY' | 'FIRST_SEEN'
// direction (für BUCKET_CHANGE): 'UPGRADE' | 'DOWNGRADE' | 'LATERAL'
// position: 'owned' | 'watching' | undefined

function alertSeverity(eventType, direction, position) {
  const isOwned = position === 'owned';

  if (eventType === 'NEW_HARD_PENALTY') {
    // Hard-Penalty ist immer wichtig — bei owned: Conviction-Check, bei watching: Buy-Stop.
    return 'CRITICAL';
  }

  if (eventType === 'BUCKET_CHANGE') {
    if (direction === 'UPGRADE') {
      // Upgrade ist Buy-Kandidat-Signal. Bei owned: bestätigt These.
      return isOwned ? 'INFO' : 'CRITICAL';
    }
    if (direction === 'DOWNGRADE') {
      // Downgrade ist für Buy-only NICHT relevant für Sells (EW macht das),
      // aber: für watching ist es Buy-Stop-Signal ("streiche von Watchlist").
      // für owned: nur Conviction-Hinweis (INFO), kein Action-Trigger.
      return isOwned ? 'INFO' : 'WARNING';
    }
    return 'INFO';  // LATERAL
  }

  if (eventType === 'ACTION_CHANGE') {
    // Tag-18-Audit-P1-B-Fix: direction wird hier als curr-action-String erwartet (z.B. 'QUALIFIED').
    // → QUALIFIED = neuer Buy-Kandidat (für watching) oder These-bestätigt (für owned)
    // → DISQUALIFIED = Buy-Stop (für watching) oder Conviction-Review (für owned)
    if (direction === 'QUALIFIED') return isOwned ? 'INFO' : 'CRITICAL';
    if (direction === 'DISQUALIFIED') return isOwned ? 'INFO' : 'WARNING';
    return isOwned ? 'INFO' : 'WARNING';
  }

  if (eventType === 'FIRST_SEEN') {
    // Tag-19-Audit-P1-3-Fix: neue Stocks die direkt OUT scoren oder Hard-Penalty haben
    // sind keine "INFO"-Events sondern Buy-Stop bzw. Conviction-Risk.
    if (direction === 'NO_BUY') return 'WARNING';
    if (direction === 'OWNED_CRITICAL') return 'CRITICAL';
    return 'INFO';
  }

  return 'INFO';
}

// ─── Helper: Format Buy-Status für UI ──────────────────────────────

function buyStatusLabel(status) {
  switch (status) {
    case 'BUY_READY':       return { emoji: '🟢', text: 'BUY-FÄHIG',           color: '#10b981' };
    case 'OWNED_OK':        return { emoji: '✓',  text: 'GEHALTEN — These OK', color: '#6ee7b7' };
    case 'OWNED_REVIEW':    return { emoji: '⚠',  text: 'GEHALTEN — Review',   color: '#fcd34d' };
    case 'OWNED_CRITICAL':  return { emoji: '🔴', text: 'GEHALTEN — These bricht!', color: '#ef4444' };
    case 'WATCH':           return { emoji: '🟡', text: 'BEOBACHTEN',          color: '#fcd34d' };
    case 'NO_BUY':          return { emoji: '🔴', text: 'KEIN BUY',            color: '#fca5a5' };
    case 'UNCLASSIFIABLE':  return { emoji: '❔',  text: 'KEINE DATEN',         color: '#94a3b8' };
    default:                return { emoji: '·',  text: status || '—',          color: '#94a3b8' };
  }
}

// ─── Public API ────────────────────────────────────────────────────

const ScoreOrchestrator = {
  ORCHESTRATOR_VERSION,
  HARD_PENALTY_CODES,
  isHardPenalty,
  scoreSnapshot,
  buyStatus,
  alertSeverity,
  buyStatusLabel,
  _fillDerivedMetrics
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScoreOrchestrator;
} else if (typeof window !== 'undefined') {
  window.ScoreOrchestrator = ScoreOrchestrator;
}
