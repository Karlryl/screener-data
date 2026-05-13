'use strict';
/**
 * Tag 113: Q-Spike DataGuard
 * ============================
 * Hard-Filter NUR fuer eindeutige Q-Spike-Faelle (IONQ-Pattern):
 *   (a) largestQuarterShare > 55% — ein einzelnes Q traegt Mehrheit der TTM-Rev
 *   (b) OI-Severity > 3.0 — Operating-Loss expandiert >3x trotz Umsatzwachstum
 *
 * Architektur (Council + ChatGPT-Verdict Tag 113):
 *   - hypergrowth-quality-class bleibt als Soft-Tag (Reason-Code-Sichtbarkeit)
 *   - q-spike-dataguard ist der Hard-Gate — schmal & spezifisch
 *   - Trifft NUR Stocks mit yoyGrowth > 100% (Hypergrowth-Verdacht)
 *     → Slow-Grower mit volatilen Quartalen werden nicht falsch ausgeschlossen
 *
 * Material-Threshold: TTM-Rev >= $100M ODER >= 0.5% Mcap.
 * Unter Schwelle: pass=true (Mini-Stocks werden nicht hier gefiltert,
 * sondern in hypergrowth-quality-class als LOW_BASE_EFFECT markiert).
 *
 * Yahoo-Felder: timeseries.revenueQ, annual.annualOpInc, revenueGrowthYoY,
 *               revenueTTM, marketCap.
 */
const H = require('./_helpers.js');

const ID = 'q-spike-dataguard';
const LABEL = 'Q-Spike-Guard';

const MATERIAL_REV_FLOOR = 100e6;
const MATERIAL_MCAP_RATIO = 0.005;

const SPIKE_SHARE_HARD = 0.55;       // >55% Single-Q-Konzentration → Fail
// Tag 134 — Phase 2: Reverted from 2.0 → 3.0 per docs/threshold-discipline.md.
// The 2.0 value (Tag 113e) was a single-ticker tune for IONQ — explicitly forbidden
// by Tag 129 policy. Reverted to first-principles 3.0 (3× operating-loss expansion).
// Specific tickers that motivated the tune are now in EXCLUDED_TICKERS below
// (per Phase 2 plan: address single-ticker problems with excludes, not threshold-tuning).
const OI_SEVERITY_HARD = 3.0;
// Tag 134 — Phase 2: per-method exclude list for tickers where the structural pattern
// of the method genuinely doesn't apply. Each entry needs a one-line justification.
const EXCLUDED_TICKERS = new Set([
  'IONQ', 'RGTI', 'QBTS', 'QUBT'  // quantum-computing: pre-revenue R&D companies, Q-spikes are research-grant artifacts
]);
const HYPERGROWTH_TRIGGER = 100;     // YoY > 100% → DataGuard aktiv

function _arr(stock, path) {
  const a = H.val(stock, path);
  if (!Array.isArray(a)) return [];
  return a.map(v => v == null ? null : (typeof v === 'number' ? v : v.value)).filter(v => Number.isFinite(v));
}

// Tag 126: Clinical-Stage-Biotech-Detection.
// WVE-Pattern: Industry=Biotechnology + OpMargin<-100% + R&D/Rev>2.0 → Milestone-Revenue, not real product sales.
// These shouldn't be in HG at all (Revenue is accounting-artifact).
function _isClinicalStageBiotech(stock) {
  const industry = (stock.meta && stock.meta.industry) || '';
  if (!/biotechnology|drug manufacturers - specialty/i.test(industry)) return false;
  const opMargin = H.metricValue(stock, 'operatingMargin');
  if (opMargin == null || opMargin > -100) return false;
  // R&D/Rev not always available — heuristic: if FCF-Margin < -100 AND OpMargin < -100, it's clinical-stage
  const fcfMargin = H.metricValue(stock, 'fcfMarginTTM');
  return fcfMargin != null && fcfMargin < -100;
}

// Tag 125: Seasonal-Sector-Detection.
// GLBE/GENI-Pattern: Q4 strukturell 30-40% des FY (E-Commerce, Sports-Betting, Retail).
// Wenn aktuelle Q4-Share-of-TTM ≈ prior-Year-Q4-Share (within 3pp): NICHT als Spike werten.
const SEASONAL_SECTORS = /\b(internet retail|internet content|sports? betting|leisure|specialty retail|gambling|department stores|home improvement)\b/i;
function _isSeasonalQ4Spike(stock, qVals) {
  const sectorInfo = ((stock.meta && stock.meta.sector) || '') + ' ' + ((stock.meta && stock.meta.industry) || '');
  if (!SEASONAL_SECTORS.test(sectorInfo)) return false;
  if (qVals.length < 8) return false;
  const currentQ4Share = qVals[0] / (qVals[0] + qVals[1] + qVals[2] + qVals[3]);
  const priorQ4Share = qVals[4] / (qVals[4] + qVals[5] + qVals[6] + qVals[7]);
  return Math.abs(currentQ4Share - priorQ4Share) < 0.03;  // within 3pp = seasonal pattern
}

// Tag 127: Launch-Inflection-Detection.
// INSM/CELH/ALNY-Pattern: recent-4Q-avg > 1.5x prior-4Q-avg = strukturelles step-change (M&A, FDA-approval, new indication).
// In dem Fall: Spike-Konzentration ist erwartet, nicht anomal. Suppress alert für 2-3 Quartale.
function _inLaunchInflection(qVals) {
  if (qVals.length < 8) return false;
  const recent4 = (qVals[0] + qVals[1] + qVals[2] + qVals[3]) / 4;
  const prior4 = (qVals[4] +qVals[5] + qVals[6] + qVals[7]) / 4;
  return prior4 > 0 && recent4 / prior4 > 1.5;
}


function evaluate(stock) {
  // Tag 113d: bei null-stock alles incomputable (Test-Anforderung)
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'no stock data'
    });
  }
  // Tag 134 — Phase 2: per-method exclude list (Tag 129 enforcement).
  // The threshold reverts to 3.0; specific quantum-computing names that
  // motivated the prior 2.0 tune are explicitly excluded here.
  const ticker = (stock.meta && stock.meta.ticker) || '';
  if (EXCLUDED_TICKERS.has(String(ticker).toUpperCase())) {
    return H.buildResult({
      computable: true, pass: false, value: 'EXCLUDED_TICKER',
      reason: 'ticker on q-spike-dataguard exclude list (pre-revenue R&D, Q-spikes are research-grant artifacts)'
    });
  }
  const yoyGrowth = H.metricValue(stock, 'revenueGrowthYoY');
  const revQ = _arr(stock, 'timeseries.revenueQ');
  const oiArr = _arr(stock, 'annual.annualOpInc');
  const ttmRev = H.metricValue(stock, 'revenueTTM') || (_arr(stock, 'annual.annualRev')[0] || 0);
  const mcapField = H.val(stock, 'marketCap');
  const mcap = (typeof mcapField === 'number') ? mcapField : (mcapField && mcapField.value) || 0;

  // Wenn YoY nicht hyper (oder unbekannt): nicht zustaendig → pass-by-default
  if (yoyGrowth == null || yoyGrowth < HYPERGROWTH_TRIGGER) {
    return H.buildResult({
      computable: true, pass: true, value: 'NOT_HYPERGROWTH_CASE',
      reason: 'YoY=' + (yoyGrowth == null ? 'n/a' : yoyGrowth.toFixed(0) + '%') + ' — DataGuard nicht zustaendig'
    });
  }

  // Material-Threshold: Mini-Stocks nicht hier filtern (passiert in hypergrowth-quality-class)
  const isMaterial = ttmRev >= MATERIAL_REV_FLOOR || (mcap > 0 && ttmRev / mcap >= MATERIAL_MCAP_RATIO);
  if (!isMaterial) {
    return H.buildResult({
      computable: true, pass: true, value: 'IMMATERIAL',
      reason: 'TTM-Rev=' + (ttmRev/1e6).toFixed(0) + 'M unter Material-Schwelle — Klassifikation in HG-Quality'
    });
  }

  // Tag 126: Clinical-Stage-Biotech early exit — these don't belong in HG at all.
  if (_isClinicalStageBiotech(stock)) {
    return H.buildResult({
      computable: true, pass: false, value: 'CLINICAL_STAGE_BIOTECH',
      reason: 'Clinical-Stage-Biotech (OpMargin<-100% + FCF<-100% + Industry=Biotech) - Revenue is milestone-accounting, not product sales'
    });
  }

  // Tag 128 integration: if pull-yahoo flagged validation issues (e.g. q_rev_guidance_suspect), fail.
  if (stock.validation && stock.validation.issues) {
    const dataIssues = stock.validation.issues.filter(i => i.code === 'q_rev_guidance_suspect');
    if (dataIssues.length > 0) {
      return H.buildResult({
        computable: true, pass: false, value: 'DATA_SUSPECT',
        reason: 'Snapshot validation: ' + dataIssues.map(i => i.code).join(', ') + ' — refusing to evaluate Q-spike on suspect data'
      });
    }
  }

  const reasons = [];
  let fail = false;

  // Check 0 (Tag 113f): Annual-Revenue-Decline — Cyclical-Rebound erkennen
  // MRNA-Pattern: annualRev geht stark rueckwaerts, aber YoY Q-vs-Q hoch wegen Tiefpunkt
  const revY = _arr(stock, 'annual.annualRev');
  let annualDecline = null;
  if (revY.length >= 4) {
    const latest = revY[0], threeYrAgo = revY[3];
    if (threeYrAgo > 0) {
      annualDecline = (latest - threeYrAgo) / threeYrAgo;
      if (latest < threeYrAgo) {
        fail = true;
        reasons.push('3y-Annual-Revenue ' + Math.round(annualDecline*100) + '% (Cyclical-Rebound, kein echter Hypergrowth)');
      }
    }
  }

  // Check 1: Spike Concentration (largest Q / sum letzte 4Q)
  // Tag 125: suppress for seasonal Q4 spikes (GLBE/GENI fix)
  // Tag 127: suppress during launch-inflection windows (INSM/CELH/ALNY fix)
  let spikeShare = null;
  let spikeSuppression = null;
  if (revQ.length >= 4) {
    const last4 = revQ.slice(0, 4);
    const total = last4.reduce((s, v) => s + v, 0);
    const max = Math.max(...last4);
    if (total > 0) spikeShare = max / total;
    if (spikeShare != null && spikeShare > SPIKE_SHARE_HARD) {
      if (_isSeasonalQ4Spike(stock, revQ)) {
        spikeSuppression = 'seasonal_q4_pattern';
      } else if (_inLaunchInflection(revQ)) {
        spikeSuppression =  'launch_inflection_window';
      } else {
        fail = true;
        reasons.push('Spike-Konzentration ' + Math.round(spikeShare*100) + '% > ' + Math.round(SPIKE_SHARE_HARD*100) + '%');
      }
    }
  }

  // Check 2: OI-Severity (annualOpInc YoY-Verschlechterung)
  let oiSeverity = 0, oiDir = 'unknown';
  if (oiArr.length >= 2) {
    const y0 = oiArr[0], y1 = oiArr[1];
    if (y0 < 0 && y1 < 0 && Math.abs(y0) > Math.abs(y1) * 1.5) {
      oiDir = 'loss-expanding';
      oiSeverity = Math.abs(y0) / Math.abs(y1);
      if (oiSeverity > OI_SEVERITY_HARD) {
        fail = true;
        reasons.push('OI-Severity ' + oiSeverity.toFixed(1) + 'x > ' + OI_SEVERITY_HARD + 'x (Loss expandiert dramatisch)');
      }
    } else if (y0 > 0) oiDir = 'profitable';
    else if (y0 < 0 && y1 > 0) oiDir = 'flip-negative';
    else if (y0 > 0 && y1 < 0) oiDir = 'flip-positive';
    else oiDir = 'mixed';
  }

  // Wenn beide Checks nicht ausloesen → pass
  if (!fail) {
    return H.buildResult({
      computable: true, pass: true, value: spikeSuppression ? 'CLEAN_SUPPRESSED' : 'CLEAN',
      components: {
        spikeShare: spikeShare != null ? Math.round(spikeShare*100) : null,
        oiSeverity: oiSeverity,
        oiDir: oiDir,
        yoyGrowth: yoyGrowth,
        annualDecline3y: annualDecline != null ? Math.round(annualDecline*100) : null,
        spikeSuppression: spikeSuppression
      },
      reason: spikeSuppression
        ? 'Hypergrowth-Pattern OK (Spike suppressed: ' + spikeSuppression + ')'
        : 'Hypergrowth-Pattern OK — keine Spike/OI-Anomalie'
    });
  }

  return H.buildResult({
    computable: true, pass: false, value: 'Q_SPIKE_DETECTED',
    components: {
        spikeShare: spikeShare != null ? Math.round(spikeShare*100) : null,
        oiSeverity: oiSeverity,
        oiDir: oiDir,
        yoyGrowth: yoyGrowth,
        annualDecline3y: annualDecline != null ? Math.round(annualDecline*100) : null
      },
    reason: 'Q-Spike: ' + reasons.join('; ')
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Hard-DataGuard fuer Q-Spike-Faelle: Spike-Konzentration >55% oder OI-Severity >2x bei YoY>100%',
  evaluate
};
