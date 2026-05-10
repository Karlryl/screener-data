'use strict';
/**
 * Tag 117: Margin-Quality (Quality-Compounder MUST 3)
 * ====================================================
 * Konsens nach 5-Runden-Battle:
 *   - GM-Floor: Standard >= 35%, High-Turnover-Override >= 20% mit AT>=2.0, < 20% always FAIL
 *   - OpMargin-Floor: Standard >= 15%, High-Turnover-Override >= 3.5% mit AT>=2.0
 *   - GM-Decline asymmetrisch: GM_TTM >= GM_5Y_Median - 5pp; falls GM_End > GM_Start: niemals Fail;
 *     falls GM_End <= GM_Start UND GM_TTM < GM_5Y_Median - 5pp: FAIL
 *
 * Diese Methode kapselt alle drei Tests in einem Composite-Filter,
 * weil sie konzeptionell zusammen gehoeren (Pricing-Power + Decline).
 */
const H = require('./_helpers.js');

const ID = 'margin-quality';
const LABEL = 'Margin-Quality';

function _arrVals(stock, path) {
  const arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(v => v == null ? null : (typeof v === 'number' ? v : v.value)).filter(v => Number.isFinite(v));
}

function _median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({ computable: false, pass: false, reason: 'no stock data' });
  }
  const revs = _arrVals(stock, 'annual.annualRev');
  const gps = _arrVals(stock, 'annual.annualGP');
  const opIncs = _arrVals(stock, 'annual.annualOpInc');
  const totalAssets = H.latestBalance(stock, 'totalAssets');

  if (revs.length < 4 || gps.length < 4 || opIncs.length < 4) {
    return H.buildResult({
      computable: false,
      reason: `need >=4y annual: rev=${revs.length} gp=${gps.length} opInc=${opIncs.length}`
    });
  }

  // Compute GM and OpMargin per year (up to 5)
  const yrs = Math.min(5, revs.length, gps.length, opIncs.length);
  const gms = [], opMs = [];
  for (let i = 0; i < yrs; i++) {
    if (revs[i] > 0 && gps[i] != null) gms.push(gps[i] / revs[i]);
    if (revs[i] > 0 && opIncs[i] != null) opMs.push(opIncs[i] / revs[i]);
  }
  if (gms.length < 3 || opMs.length < 3) {
    return H.buildResult({
      computable: false,
      reason: `usable margin-points < 3 (gm=${gms.length}, opM=${opMs.length})`
    });
  }

  const gmMedian = _median(gms);
  const opMargMedian = _median(opMs);
  const gmEnd = gms[0]; // newest
  const gmStart = gms[gms.length - 1];

  // Asset-Turnover for Override
  const at = (revs[0] && totalAssets) ? revs[0] / totalAssets : null;
  const highTurnover = at != null && at >= 2.0;

  const reasons = [];
  let pass = true;

  // Hard fail GM < 20%
  if (gmMedian < 0.10) {
    pass = false;
    reasons.push(`GM-Median ${(gmMedian*100).toFixed(0)}% < 10% (always-fail)`);
  } else {
    // GM-Floor
    const gmFloorRequired = highTurnover ? 0.20 : 0.35;
    if (gmMedian < gmFloorRequired) {
      pass = false;
      reasons.push(`GM-Median ${(gmMedian*100).toFixed(0)}% < ${(gmFloorRequired*100).toFixed(0)}% (${highTurnover ? 'AT-Override' : 'Standard'})`);
    }
  }

  // OpMargin-Floor
  const opMarginRequired = highTurnover ? 0.035 : 0.15;
  if (opMargMedian < opMarginRequired) {
    pass = false;
    reasons.push(`OpMargin-Median ${(opMargMedian*100).toFixed(1)}% < ${(opMarginRequired*100).toFixed(1)}% (${highTurnover ? 'AT-Override' : 'Standard'})`);
  }

  // GM-Decline asymmetric
  // Use GM[0] as TTM-proxy
  const gmTTM = gmEnd;
  const gmDeclineFail = (gmEnd <= gmStart) && (gmTTM < gmMedian - 0.05);
  if (gmDeclineFail) {
    pass = false;
    reasons.push(`GM-Decline: TTM ${(gmTTM*100).toFixed(1)}% < Median-5pp (${((gmMedian-0.05)*100).toFixed(1)}%) und GM_End <= GM_Start`);
  }

  return H.buildResult({
    computable: true,
    pass,
    value: gmMedian,
    components: {
      gmMedian,
      opMarginMedian: opMargMedian,
      gmEnd,
      gmStart,
      gmTTM,
      assetTurnover: at,
      highTurnoverPath: highTurnover,
      gmDeclineFail
    },
    reason: pass
      ? `GM-Med=${(gmMedian*100).toFixed(0)}% OpM-Med=${(opMargMedian*100).toFixed(1)}% (${highTurnover ? 'AT-Override' : 'Std'})`
      : reasons.join('; ')
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'GM>=35% (oder >=20% mit AT>=2), OpMargin>=15% (oder >=3.5% mit AT>=2), GM-Decline asymmetrisch',
  evaluate
};
