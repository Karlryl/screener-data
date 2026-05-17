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

// Tag 217g (audit F-217b-01 HIGH fix): preserve positional year alignment.
// The previous .filter(Number.isFinite) silently compacted arrays, so a
// year with missing OpInc would make opInc[2] read as what was originally
// opInc[3]. Downstream pair-iteration (i, i+1) then treated multi-year
// gaps as one-year declines and false-failed QC compounders that had a
// single missing-data year. Now: keep nulls in place, downstream code
// must skip non-finite pairs explicitly.
function _arrVals(stock, path) {
  const arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(v => {
    if (v == null) return null;
    const n = (typeof v === 'number') ? v : v.value;
    return Number.isFinite(n) ? n : null;
  });
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({ computable: false, pass: false, reason: 'no stock data' });
  }
  const opInc = _arrVals(stock, 'annual.annualOpInc');
  const fcf = _arrVals(stock, 'annual.annualFCF');

  // Tag 217g: count OBSERVABLE (non-null) years, not array length.
  // Arrays may contain nulls (positional alignment preserved per Tag 217g).
  const oiObs = opInc.filter(v => v != null).length;
  const fcfObs = fcf.filter(v => v != null).length;
  if (oiObs < 4 || fcfObs < 4) {
    return H.buildResult({
      computable: false,
      reason: `need >= 4 observable annual: opInc=${oiObs} (len ${opInc.length}), fcf=${fcfObs} (len ${fcf.length})`
    });
  }

  // Use up to 5 years
  const opIncWindow = opInc.slice(0, 5);
  const fcfWindow = fcf.slice(0, 5);
  // Tag 217g: count positives + needed against NON-NULL entries only.
  // Window arrays may now contain nulls (Tag 217g positional-alignment fix);
  // 'needed' must be based on observable years, not array length, otherwise
  // a 5-year window with 2 missing years gets oiNeeded=min(4,5)=4 vs
  // oiPositive=3 (true positives out of 3 observable) → false fail.
  const oiPositive = opIncWindow.filter(v => v != null && v > 0).length;
  const fcfPositive = fcfWindow.filter(v => v != null && v > 0).length;
  const oiObservable = opIncWindow.filter(v => v != null).length;
  const fcfObservable = fcfWindow.filter(v => v != null).length;
  // Tag 221 (audit F-221b-2 anchor-safety fix): scale 'needed' proportionally
  // to observable years using the Tag-184 pattern. Previous min(4, observable)
  // demanded 4-of-4 from 4y-history companies (PLTR/CRDO) — that's stricter
  // than the 4-of-5 baseline for fully-historied compounders. Now: scale
  // round(4 × observable / 5), so 5y→4, 4y→3, 3y→2.
  const oiNeeded = Math.round(4 * oiObservable / 5);
  const fcfNeeded = Math.round(4 * fcfObservable / 5);

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
    // Tag 217g: skip pairs where either side is null (data missing year).
    // Without this guard, `older > 0 && newer < older` evaluates to
    // (null > 0)=false in JS — so null short-circuits naturally — but the
    // intent is clearer with the explicit guard, and protects against
    // hypothetical changes to comparison semantics.
    if (newer == null || older == null) continue;
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
      // Tag 217g: null-guard. Without this, `next > X` is null > X = false
      // and we false-fail. If the recovery year is missing data, we can't
      // judge recovery — emit a clear reason instead.
      if (next == null) {
        pass = false;
        reasons.push(`decline ${(maxDecline*100).toFixed(0)}% (30-50% range) — recovery year missing data, cannot verify`);
      } else if (!(next > declined * 1.2)) {
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
