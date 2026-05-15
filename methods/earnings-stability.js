'use strict';
/**
 * Tag 117: Earnings-Stability (Quality-Compounder MUST 1)
 * =========================================================
 * Konsens nach 5-Runden ChatGPT-Battle:
 *   - OpInc positive in mindestens 4/5 Jahren
 *   - FCF positive in mindestens 4/5 Jahren
 *   - Max Single-Year OpInc Decline <= 50%
 *   - Recovery-Regel: bei Decline 30-50%, Folgejahr OpInc_t+1 > OpInc_t * 1.2
 *
 * Yahoo-Felder: annual.annualOpInc, annual.annualFCF
 * Reihenfolge: [0] = neueste, [4] = aelteste
 */
const H = require('./_helpers.js');

const ID = 'earnings-stability';
const LABEL = 'Earnings-Stability';

function _arrVals(stock, path) {
  const arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(v => v == null ? null : (typeof v === 'number' ? v : v.value)).filter(v => Number.isFinite(v));
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({ computable: false, pass: false, reason: 'no stock data' });
  }
  const opInc = _arrVals(stock, 'annual.annualOpInc');
  const fcf = _arrVals(stock, 'annual.annualFCF');

  if (opInc.length < 4 || fcf.length < 4) {
    return H.buildResult({
      computable: false,
      reason: `need >= 4 annual: opInc=${opInc.length}, fcf=${fcf.length}`
    });
  }

  // Use up to 5 years
  const opIncWindow = opInc.slice(0, 5);
  const fcfWindow = fcf.slice(0, 5);
  const oiPositive = opIncWindow.filter(v => v > 0).length;
  const fcfPositive = fcfWindow.filter(v => v > 0).length;
  const oiNeeded = Math.min(4, opIncWindow.length);
  const fcfNeeded = Math.min(4, fcfWindow.length);

  const reasons = [];
  let pass = true;

  if (oiPositive < oiNeeded) {
    pass = false;
    reasons.push(`OpInc positive ${oiPositive}/${opIncWindow.length} (need >=${oiNeeded})`);
  }
  if (fcfPositive < fcfNeeded) {
    pass = false;
    reasons.push(`FCF positive ${fcfPositive}/${fcfWindow.length} (need >=${fcfNeeded})`);
  }

  // Max Single-Year Decline (year-over-year, descending order so [i+1] is older)
  let maxDecline = 0;
  let maxDeclineIdx = -1;
  for (let i = 0; i < opIncWindow.length - 1; i++) {
    const newer = opIncWindow[i];
    const older = opIncWindow[i + 1];
    if (older > 0 && newer < older) {
      const decline = (older - newer) / older;
      if (decline > maxDecline) {
        maxDecline = decline;
        maxDeclineIdx = i;
      }
    }
  }

  if (maxDecline > 0.50) {
    pass = false;
    reasons.push(`max OpInc decline ${(maxDecline*100).toFixed(0)}% > 50%`);
  } else if (maxDecline > 0.30) {
    if (maxDeclineIdx === 0) {
      // Bug #2: Most-recent-year declined 30-50% — no future recovery data yet → fail
      pass = false;
      reasons.push(`max OpInc decline ${(maxDecline*100).toFixed(0)}% (30-50%) in latest year — no recovery data yet`);
    } else {
      // Recovery-test: OpInc[maxDeclineIdx-1] > OpInc[maxDeclineIdx] * 1.2 (year after decline must recover)
      const declined = opIncWindow[maxDeclineIdx];
      const next = opIncWindow[maxDeclineIdx - 1];  // newer than declined
      if (!(next > declined * 1.2)) {
        pass = false;
        reasons.push(`decline ${(maxDecline*100).toFixed(0)}% (30-50% range) without recovery (next=${(next/1e9).toFixed(1)}B vs ${(declined*1.2/1e9).toFixed(1)}B required)`);
      }
    }
  }

  return H.buildResult({
    computable: true,
    pass,
    value: maxDecline,
    components: {
      opIncPositiveYears: oiPositive,
      fcfPositiveYears: fcfPositive,
      maxDecline,
      maxDeclineIdx,
      yearsConsidered: opIncWindow.length
    },
    reason: pass
      ? `OpInc+/FCF+ ${oiPositive}/${fcfPositive} of ${opIncWindow.length}y, maxDecline=${(maxDecline*100).toFixed(0)}%`
      : reasons.join('; ')
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'OpInc+FCF positive 4/5y, max OpInc-Decline <=50%, Recovery-Test bei 30-50% Decline',
  threshold: 0.50, thresholdOp: 'lte', unit: 'ratio',
  evaluate
};
