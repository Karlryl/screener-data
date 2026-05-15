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

function _rawVals(stock, path) {
  const arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(v => v == null ? null : (typeof v === 'number' ? v : v.value));
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
  // Use raw arrays (preserving positional alignment) instead of filtering independently
  const rawRevs = _rawVals(stock, 'annual.annualRev');
  const rawGps = _rawVals(stock, 'annual.annualGP');
  const rawOpIncs = _rawVals(stock, 'annual.annualOpInc');
  const totalAssets = H.latestBalance(stock, 'totalAssets');

  // Count valid entries per array for the minimum-data check
  const validRevs = rawRevs.filter(v => Number.isFinite(v));
  const validGps = rawGps.filter(v => Number.isFinite(v));
  const validOpIncs = rawOpIncs.filter(v => Number.isFinite(v));

  if (validRevs.length < 4 || validGps.length < 4 || validOpIncs.length < 4) {
    return H.buildResult({
      computable: false,
      reason: `need >=4y annual: rev=${validRevs.length} gp=${validGps.length} opInc=${validOpIncs.length}`
    });
  }

  // Compute GM and OpMargin per year (up to 5) — zip by position, skip incomplete rows
  const len = Math.min(5, rawRevs.length, rawGps.length, rawOpIncs.length);
  const gms = [], opMs = [];
  for (let i = 0; i < len; i++) {
    if (Number.isFinite(rawRevs[i]) && rawRevs[i] > 0 && Number.isFinite(rawGps[i])) gms.push(rawGps[i] / rawRevs[i]);
    if (Number.isFinite(rawRevs[i]) && rawRevs[i] > 0 && Number.isFinite(rawOpIncs[i])) opMs.push(rawOpIncs[i] / rawRevs[i]);
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
  const latestRev = rawRevs[0];
  const at = (Number.isFinite(latestRev) && latestRev > 0 && totalAssets) ? latestRev / totalAssets : null;
  const highTurnover = at != null && at >= 2.0;

  const reasons = [];
  let pass = true;

  // Hard fail GM < 20%
  if (gmMedian < 0.20) {
    pass = false;
    reasons.push(`GM-Median ${(gmMedian*100).toFixed(0)}% < 20% (always-fail)`);
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
  threshold: 0.35, thresholdOp: 'gte', unit: 'ratio',
  evaluate
};
