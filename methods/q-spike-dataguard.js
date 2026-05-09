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
const OI_SEVERITY_HARD = 2.0;       // Tag 113e: 3.0->2.0 (synchron mit HG-Quality), faengt IONQ (2.72x)        // OI-Verlust expandiert >3x → Fail
const HYPERGROWTH_TRIGGER = 100;     // YoY > 100% → DataGuard aktiv

function _arr(stock, path) {
  const a = H.val(stock, path);
  if (!Array.isArray(a)) return [];
  return a.map(v => v == null ? null : (typeof v === 'number' ? v : v.value)).filter(v => Number.isFinite(v));
}

function evaluate(stock) {
  // Tag 113d: bei null-stock alles incomputable (Test-Anforderung)
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'no stock data'
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
  let spikeShare = null;
  if (revQ.length >= 4) {
    const last4 = revQ.slice(0, 4);
    const total = last4.reduce((s, v) => s + v, 0);
    const max = Math.max(...last4);
    if (total > 0) spikeShare = max / total;
    if (spikeShare != null && spikeShare > SPIKE_SHARE_HARD) {
      fail = true;
      reasons.push('Spike-Konzentration ' + Math.round(spikeShare*100) + '% > ' + Math.round(SPIKE_SHARE_HARD*100) + '%');
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
      computable: true, pass: true, value: 'CLEAN',
      components: {
        spikeShare: spikeShare != null ? Math.round(spikeShare*100) : null,
        oiSeverity: oiSeverity,
        oiDir: oiDir,
        yoyGrowth: yoyGrowth,
        annualDecline3y: annualDecline != null ? Math.round(annualDecline*100) : null
      },
      reason: 'Hypergrowth-Pattern OK — keine Spike/OI-Anomalie'
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
