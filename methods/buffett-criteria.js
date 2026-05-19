'use strict';
/**
 * Buffett Criteria — 14-Point Composite Filter
 * ==============================================
 * Sources:
 *   - Berkshire Hathaway Annual Letters 1977-2024 (Buffett, W.E.)
 *   - Hagstrom, R.G. (2013). The Warren Buffett Way, 3rd ed.
 *     Tenets 4 (Profit Margins), 6 (Consistent Operating History), 7 (ROE),
 *     8 (ROIC Trend), 9 (Conservative Debt), 10 (Earnings Predictability),
 *     11 (Earnings Yield vs. Bonds).
 *   - Buffett, M. & Clark, D. (1997). Buffettology. Scribner.
 *     pp. 124 (Debt/NI), 181 (EPS acceleration).
 *   - Damodaran, A. (2012). Investment Valuation, 3rd ed.
 *     ch. 11 (Maintenance Capex), ch. 12 (ROIC / InvestedCapital),
 *     ch. 14 (Competitive Advantage Period proxy).
 *
 * Composite of 14 Buffett tests:
 *   Quantitative: T1 ROE 10y, T2 ROIC trend, T3 Conservative Debt,
 *     T4 EPS Acceleration, T5 FCF consistent+growing, T6 Owner Earnings,
 *     T7 Margins vs Industry, T8 Earnings Yield > Treasury, T9 Hurdle Rate,
 *     T10 One-Dollar Test
 *   Qualitative: Q1 Moat proxy, Q2 Pricing Power, Q3 Consistent Ops
 *   Industry exclusion: X1
 *
 * DIAGNOSTIC — not in SCORE_WEIGHTS for HG/QC/TURN; fixture-hash safe.
 * Used as a MUST in BUFFETT strategy mode.
 */

const H = require('./_helpers.js');

const ID = 'buffett-criteria';
const LABEL = 'Buffett 14-Punkt Komposit';

// --- Configurable constants ---
const PASS_THRESHOLD_DEFAULT = 0.85;   // 85% of tests must pass
const TREASURY_YIELD_DEFAULT = 0.045;  // 4.5% 10y Treasury (env: BUFFETT_TREASURY_YIELD_10Y)
const CORP_TAX_RATE = 0.21;            // US federal corporate tax rate
const MIN_YEARS_REQUIRED = 5;         // minimum years for computable result

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

function _toNum(v) {
  if (v == null) return null;
  const n = (typeof v === 'number') ? v : v.value;
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract a raw number array from a stock path.
 * Each element may be a plain number OR { value: N }.
 */
function _rawArr(stock, path) {
  const arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(_toNum);
}

/** Finite numbers only from an array. */
function _finite(arr) {
  return arr.filter(v => Number.isFinite(v));
}

/** Simple median. */
function _median(arr) {
  const f = _finite(arr);
  if (!f.length) return null;
  const s = [...f].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** CAGR over a window. Requires oldest > 0 and latest > 0. Returns null otherwise. */
function _cagr(latest, oldest, periods) {
  if (!Number.isFinite(latest) || !Number.isFinite(oldest) || periods <= 0) return null;
  if (oldest <= 0 || latest <= 0) return null;
  return Math.pow(latest / oldest, 1 / periods) - 1;
}

/** Linear regression slope over index-aligned pairs (x=0,1,...n-1, y=values). */
function _slope(values) {
  const f = values.filter(v => Number.isFinite(v));
  if (f.length < 2) return null;
  const n = f.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const xMean = xs.reduce((s, x) => s + x, 0) / n;
  const yMean = f.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (f[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Get equity from balance row: direct > derived > null. */
function _equityFromRow(row) {
  if (!row) return null;
  if (Number.isFinite(row.totalEquity)) return row.totalEquity;
  if (Number.isFinite(row.totalAssets) && Number.isFinite(row.totalLiabilities)) {
    return row.totalAssets - row.totalLiabilities;
  }
  return null;
}

/** Compute ROIC per year (Damodaran canonical: OpInc / (TotalDebt+Equity-Cash)).
 *  Returns array (newest first) parallel to min(annualOpInc, annualBalance) length. */
function _computeAnnualROIC(stock) {
  const rawOI  = _rawArr(stock, 'annual.annualOpInc');
  const rawBal = H.val(stock, 'annual.annualBalance');
  if (!Array.isArray(rawBal) || !rawOI.length) return [];

  const n = Math.min(10, rawOI.length, rawBal.length);
  const result = [];
  for (let i = 0; i < n; i++) {
    const oi = rawOI[i];
    const row = rawBal[i];
    if (!Number.isFinite(oi) || !row) { result.push(null); continue; }

    const equity = _equityFromRow(row);
    const debt   = Number.isFinite(row.totalDebt) ? row.totalDebt : 0;
    const cash   = Number.isFinite(row.totalCash) ? row.totalCash : 0;
    const assets = Number.isFinite(row.totalAssets) ? row.totalAssets : null;

    let ic;
    if (equity != null) {
      ic = debt + equity - cash;
    } else if (assets != null) {
      ic = assets - cash;
    } else {
      result.push(null); continue;
    }
    result.push(ic > 0 ? oi / ic : null);
  }
  return result;
}

// --------------------------------------------------------------------------
// T1 — ROE 10-year average
// Buffett 1979 Letter ("return on shareholder equity"); Hagstrom Tenet 7
// --------------------------------------------------------------------------
function _testT1_ROE(stock) {
  const rawNI  = _rawArr(stock, 'annual.annualNetIncome');
  const rawBal = H.val(stock, 'annual.annualBalance');
  if (!Array.isArray(rawBal) || !rawNI.length) {
    return { pass: false, avgROE: null, minROE: null, yearsUsed: 0,
      reason: 'missing NI or balance data for ROE' };
  }

  const n = Math.min(10, rawNI.length, rawBal.length);
  const roes = [];
  for (let i = 0; i < n; i++) {
    const ni  = rawNI[i];
    const row = rawBal[i];
    if (!Number.isFinite(ni) || !row) continue;
    const eq = _equityFromRow(row);
    if (eq == null || eq <= 0) continue;
    roes.push(ni / eq);
  }

  const yearsUsed = roes.length;
  if (yearsUsed < 3) {
    return { pass: false, avgROE: null, minROE: null, yearsUsed,
      reason: `only ${yearsUsed} ROE-computable years (need ≥3)` };
  }

  const avgROE = roes.reduce((s, v) => s + v, 0) / roes.length;
  const minROE = Math.min(...roes);

  const avgPass = avgROE > 0.20;
  const minPass = minROE > 0.15;
  const pass = avgPass && minPass;

  let reason;
  if (!avgPass) reason = `avg ROE ${(avgROE * 100).toFixed(1)}% ≤ 20%`;
  else if (!minPass) reason = `min ROE ${(minROE * 100).toFixed(1)}% ≤ 15% in some year`;
  else reason = `avg ROE ${(avgROE * 100).toFixed(1)}%, min ${(minROE * 100).toFixed(1)}%, ${yearsUsed}y`;

  return { pass, avgROE, minROE, yearsUsed, reason };
}

// --------------------------------------------------------------------------
// T2 — ROIC trend over 10y
// Hagstrom Tenet 8; Damodaran Investment Valuation ch. 12
// --------------------------------------------------------------------------
function _testT2_ROIC(stock) {
  const roics = _computeAnnualROIC(stock);  // newest first
  const valid  = roics.filter(v => Number.isFinite(v));
  const yearsUsed = valid.length;

  if (yearsUsed < 3) {
    return { pass: false, avgROIC: null, latestROIC: null, yearsUsed,
      reason: `only ${yearsUsed} ROIC-computable years (need ≥3)` };
  }

  const avgROIC   = valid.reduce((s, v) => s + v, 0) / valid.length;
  const latestROIC = valid[0];  // newest in the finite-filtered array

  // Avg over latest 5 valid (5y slice) vs. avg over older (5+ slice)
  const fiveSlice = valid.slice(0, 5);
  const fiveAvg   = fiveSlice.reduce((s, v) => s + v, 0) / fiveSlice.length;

  // Not declining: latest year >= 5y average
  const notDeclining = latestROIC >= fiveAvg;
  const avgPass = avgROIC > 0.15;
  const pass = avgPass && notDeclining;

  let reason;
  if (!avgPass) reason = `avg ROIC ${(avgROIC * 100).toFixed(1)}% ≤ 15%`;
  else if (!notDeclining) reason = `latest ROIC ${(latestROIC * 100).toFixed(1)}% < 5y-avg ${(fiveAvg * 100).toFixed(1)}% (declining)`;
  else reason = `avg ROIC ${(avgROIC * 100).toFixed(1)}%, latest ${(latestROIC * 100).toFixed(1)}%, not declining, ${yearsUsed}y`;

  return { pass, avgROIC, latestROIC, yearsUsed, reason };
}

// --------------------------------------------------------------------------
// T3 — Conservative debt
// Mary Buffett Buffettology p. 124; Hagstrom Tenet 9
// --------------------------------------------------------------------------
function _testT3_Debt(stock) {
  const rawNI = _rawArr(stock, 'annual.annualNetIncome');
  const rawBal = H.val(stock, 'annual.annualBalance');

  if (!Array.isArray(rawBal) || !rawBal.length || !rawNI.length) {
    return { pass: false, ltdToNI: null, totalLiabRatio: null, industryRatio: null,
      reason: 'missing balance or NI data for debt test' };
  }

  const ni    = rawNI[0];
  const row   = rawBal[0];
  if (!Number.isFinite(ni) || !row) {
    return { pass: false, ltdToNI: null, totalLiabRatio: null, industryRatio: null,
      reason: 'NI or latest balance missing' };
  }

  // LongTermDebt: use totalDebt as proxy (Yahoo rarely splits LTD separately in annual)
  const ltd        = Number.isFinite(row.totalDebt) ? row.totalDebt : 0;
  const totalAssets = Number.isFinite(row.totalAssets) ? row.totalAssets : null;
  const totalLiab  = Number.isFinite(row.totalLiabilities) ? row.totalLiabilities :
    (totalAssets != null && _equityFromRow(row) != null ? totalAssets - _equityFromRow(row) : null);

  // Test 1: LTD < 5× NI (Buffettology p. 124)
  const abNI = Math.abs(ni);
  const ltdToNI   = abNI > 0 ? ltd / abNI : null;
  const debtTest  = ltdToNI != null && ltdToNI < 5;

  // Test 2: TotalLiab / TotalAssets < 0.60 fallback
  const tlRatio   = (totalLiab != null && totalAssets != null && totalAssets > 0)
    ? totalLiab / totalAssets : null;
  const liabTest  = tlRatio == null || tlRatio < 0.60;

  const pass = debtTest && liabTest;

  let reason;
  if (!debtTest) reason = `LTD/NI=${ltdToNI != null ? ltdToNI.toFixed(1) : 'n/a'}x ≥ 5x`;
  else if (!liabTest) reason = `TotalLiab/Assets=${(tlRatio * 100).toFixed(0)}% ≥ 60%`;
  else reason = `LTD/NI=${ltdToNI != null ? ltdToNI.toFixed(1) : 'n/a'}x, Liab/Assets=${tlRatio != null ? (tlRatio * 100).toFixed(0) + '%' : 'n/a'}`;

  return { pass, ltdToNI, totalLiabRatio: tlRatio, industryRatio: 0.60, reason };
}

// --------------------------------------------------------------------------
// T4 — EPS growth acceleration
// AAII screener; Mary Buffett Buffettology
// --------------------------------------------------------------------------
function _testT4_EPSGrowth(stock) {
  const rawNI     = _rawArr(stock, 'annual.annualNetIncome');
  const rawShares = _rawArr(stock, 'annual.annualShares');

  // Compute per-share EPS if shares available, else use NI as proxy
  let series;
  if (rawShares.length >= 4) {
    series = [];
    const n = Math.min(rawNI.length, rawShares.length);
    for (let i = 0; i < n; i++) {
      const ni = rawNI[i];
      const sh = rawShares[i];
      if (Number.isFinite(ni) && Number.isFinite(sh) && sh > 0) {
        series.push(ni / sh);
      } else {
        series.push(null);
      }
    }
  } else {
    series = rawNI;
  }

  const valid = series.filter(v => Number.isFinite(v));
  if (valid.length < 7) {
    return { pass: false, cagr7y: null, cagr3y: null, isAccelerating: false,
      reason: `only ${valid.length} EPS-computable years, need ≥7 for 7y CAGR` };
  }

  // series is newest-first; valid[0]=latest, valid[6]=7y-ago (if 7 entries)
  const latest  = valid[0];
  const three   = valid[3];  // 3y ago (index 3 = year[-3])
  const seven   = valid[6];  // 7y ago (index 6 = year[-7])

  const cagr7y = _cagr(latest, seven, 7);
  const cagr3y = _cagr(latest, three, 3);

  if (cagr7y == null || cagr3y == null) {
    return { pass: false, cagr7y, cagr3y, isAccelerating: false,
      reason: 'CAGR undefined (negative EPS in base year)' };
  }

  const growthOk = cagr7y > 0.07;
  const isAccelerating = cagr3y > cagr7y;
  const pass = growthOk && isAccelerating;

  let reason;
  if (!growthOk) reason = `7y EPS CAGR ${(cagr7y * 100).toFixed(1)}% ≤ 7%`;
  else if (!isAccelerating) reason = `3y CAGR ${(cagr3y * 100).toFixed(1)}% ≤ 7y CAGR ${(cagr7y * 100).toFixed(1)}% (decelerating)`;
  else reason = `7y CAGR ${(cagr7y * 100).toFixed(1)}%, 3y CAGR ${(cagr3y * 100).toFixed(1)}%, accelerating`;

  return { pass, cagr7y, cagr3y, isAccelerating, reason };
}

// --------------------------------------------------------------------------
// T5 — FCF consistent and growing 10y
// Buffett 1986 Letter (FCF as proxy for distributable earnings)
// --------------------------------------------------------------------------
function _testT5_FCF(stock) {
  const rawFCF = _rawArr(stock, 'annual.annualFCF');
  const valid  = rawFCF.filter(v => Number.isFinite(v));
  const n      = Math.min(10, valid.length);

  if (n < 5) {
    return { pass: false, isPositiveEveryYear: false, cagrFCF: null,
      reason: `only ${n} FCF years (need ≥5)` };
  }

  const slice = valid.slice(0, n);
  const isPositiveEveryYear = slice.every(v => v > 0);
  const cagrFCF = _cagr(slice[0], slice[n - 1], n - 1);

  const pass = isPositiveEveryYear && (cagrFCF != null && cagrFCF > 0);

  let reason;
  if (!isPositiveEveryYear) reason = 'FCF negative in ≥1 year';
  else if (cagrFCF == null || cagrFCF <= 0) reason = `FCF CAGR ${cagrFCF != null ? (cagrFCF * 100).toFixed(1) + '%' : 'n/a'} ≤ 0`;
  else reason = `FCF positive ${n}y, CAGR ${(cagrFCF * 100).toFixed(1)}%`;

  return { pass, isPositiveEveryYear, cagrFCF, reason };
}

// --------------------------------------------------------------------------
// T6 — Owner Earnings (delegate to owner-earnings method)
// Buffett 1986 Berkshire Annual Letter
// --------------------------------------------------------------------------
function _testT6_OwnerEarnings(oeResult) {
  if (!oeResult || !oeResult.computable) {
    return { pass: false, delegatedTo: 'owner-earnings', subPass: false,
      reason: 'owner-earnings not computable' };
  }
  const subPass = !!oeResult.pass;
  return {
    pass: subPass,
    delegatedTo: 'owner-earnings',
    subPass,
    reason: subPass ? 'OE positive+growing (delegated pass)' : ('OE failed: ' + (oeResult.reason || 'see owner-earnings'))
  };
}

// --------------------------------------------------------------------------
// T7 — Margins above industry median, stable 10y
// Hagstrom Tenet 4 (Profit Margins)
// --------------------------------------------------------------------------
function _testT7_Margins(stock) {
  const rawOpInc = _rawArr(stock, 'annual.annualOpInc');
  const rawRev   = _rawArr(stock, 'annual.annualRev');

  const margins = [];
  const n = Math.min(5, rawOpInc.length, rawRev.length);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(rawOpInc[i]) && Number.isFinite(rawRev[i]) && rawRev[i] > 0) {
      margins.push(rawOpInc[i] / rawRev[i]);
    }
  }

  if (margins.length < 3) {
    return { pass: false, opMarginMedian: null, industryMedian: 0.15, stabilityMet: false,
      reason: `only ${margins.length} margin-years (need ≥3)` };
  }

  const opMarginMedian = _median(margins);
  const industryMedian = 0.15;  // absolute fallback when no sector data

  const aboveIndustry = opMarginMedian != null && opMarginMedian > industryMedian;
  const maxM = Math.max(...margins);
  const minM = Math.min(...margins);
  const stabilityMet = (maxM - minM) <= 0.10;  // ≤10pp spread

  const pass = aboveIndustry && stabilityMet;

  let reason;
  if (!aboveIndustry) reason = `OpMargin median ${(opMarginMedian * 100).toFixed(1)}% ≤ industry floor ${(industryMedian * 100).toFixed(0)}%`;
  else if (!stabilityMet) reason = `OpMargin range ${((maxM - minM) * 100).toFixed(1)}pp > 10pp stability threshold`;
  else reason = `OpMargin median ${(opMarginMedian * 100).toFixed(1)}%, stable (${((maxM - minM) * 100).toFixed(1)}pp range)`;

  return { pass, opMarginMedian, industryMedian, stabilityMet, reason };
}

// --------------------------------------------------------------------------
// T8 — Earnings Yield > 10y Treasury
// Buffett 1996 Owner's Manual ("opportunity cost is government bonds"); Hagstrom Tenet 11
// --------------------------------------------------------------------------
function _testT8_EarningsYield(stock) {
  const treasuryYield = parseFloat(process.env.BUFFETT_TREASURY_YIELD_10Y) || TREASURY_YIELD_DEFAULT;

  // E/P = 1 / P/E  OR  NI / MarketCap
  let earningsYield = null;
  const peRaw = H.val(stock, 'metrics.pe');
  const pe = _toNum(peRaw);
  if (Number.isFinite(pe) && pe > 0) {
    earningsYield = 1 / pe;
  } else {
    // Fallback: NI_latest / MarketCap
    const ni    = _toNum(H.val(stock, 'annual.annualNetIncome') && H.val(stock, 'annual.annualNetIncome')[0]);
    const mcap  = _toNum(H.val(stock, 'marketCap'));
    if (Number.isFinite(ni) && Number.isFinite(mcap) && mcap > 0 && ni > 0) {
      earningsYield = ni / mcap;
    }
  }

  if (earningsYield == null) {
    return { pass: false, pretaxEY: null, treasuryYield,
      reason: 'P/E or market cap missing — earnings yield not computable' };
  }

  // Pretax-adjusted: divide post-tax E/P by (1 - corp tax rate)
  const pretaxEY = earningsYield / (1 - CORP_TAX_RATE);
  const pass = pretaxEY > treasuryYield;

  const reason = pass
    ? `pretax E/P ${(pretaxEY * 100).toFixed(1)}% > Treasury ${(treasuryYield * 100).toFixed(1)}%`
    : `pretax E/P ${(pretaxEY * 100).toFixed(1)}% ≤ Treasury ${(treasuryYield * 100).toFixed(1)}%`;

  return { pass, pretaxEY, treasuryYield, reason };
}

// --------------------------------------------------------------------------
// T9 — Hurdle Rate test (delegate to dcf-intrinsic-value)
// Buffett 1992 Coca-Cola valuation discussion
// --------------------------------------------------------------------------
function _testT9_HurdleRate(dcfResult) {
  if (!dcfResult || !dcfResult.computable) {
    return { pass: false, delegatedTo: 'dcf-intrinsic-value', projectedReturn: null,
      reason: 'dcf-intrinsic-value not computable' };
  }
  const hurdleMet = !!(dcfResult.components && dcfResult.components.hurdleRateMet);
  const projectedReturn = (dcfResult.components && dcfResult.components.projectedAnnualReturnPct) || null;

  return {
    pass: hurdleMet,
    delegatedTo: 'dcf-intrinsic-value',
    projectedReturn,
    reason: hurdleMet
      ? `hurdle rate met (${projectedReturn != null ? projectedReturn.toFixed(1) + '%/yr' : 'projected'})`
      : `hurdle rate NOT met (${projectedReturn != null ? projectedReturn.toFixed(1) + '%/yr' : 'n/a'})`
  };
}

// --------------------------------------------------------------------------
// T10 — One-Dollar Test
// Buffett 1983 Owner's Manual
// --------------------------------------------------------------------------
function _testT10_OneDollar(stock) {
  const rawNI    = _rawArr(stock, 'annual.annualNetIncome');
  const rawDiv   = _rawArr(stock, 'annual.annualDividends');  // may be empty
  const peRaw    = H.val(stock, 'metrics.pe');
  const pe       = _toNum(peRaw);

  const window = 5;
  const ni5    = _finite(rawNI.slice(0, window));
  if (ni5.length < 3) {
    return { pass: true, retained5y: null, mvChange5yProxy: null,
      proxyMethod: 'pass-on-missing-data',
      reason: 'One-Dollar test: insufficient data — pass (no false-fail)' };
  }

  // Retained = NI - Dividends (per year; if div data missing, assume 0 payout)
  let retained5y = 0;
  for (let i = 0; i < ni5.length; i++) {
    const div = (rawDiv.length > i && Number.isFinite(rawDiv[i])) ? Math.abs(rawDiv[i]) : 0;
    retained5y += ni5[i] - div;
  }

  // Market value change proxy: NI growth × P/E
  // Δ MarketCap ≈ (NI_latest - NI_5yago) × P/E_current (assume stable multiple)
  const niLatest = ni5[0];
  const niOldest = ni5[ni5.length - 1];
  let mvChange5yProxy = null;
  let proxyMethod = 'ni-growth-pe-multiple';

  if (Number.isFinite(pe) && pe > 0 && Number.isFinite(niLatest) && Number.isFinite(niOldest)) {
    mvChange5yProxy = (niLatest - niOldest) * pe;
  }

  // Pass if ratio >= 1.0 OR data unavailable (no false-fail per spec)
  let pass = true;
  let reason;
  if (mvChange5yProxy != null && retained5y > 0) {
    const ratio = mvChange5yProxy / retained5y;
    pass = ratio >= 1.0;
    reason = `$1 retained → $${ratio.toFixed(2)} mkt value (proxy); ${pass ? 'PASS' : 'FAIL'}`;
  } else if (retained5y <= 0) {
    pass = false;
    reason = 'retained5y ≤ 0 — capital destruction';
    proxyMethod = 'negative-retained';
  } else {
    proxyMethod = 'pass-on-missing-pe';
    reason = 'One-Dollar test: P/E missing — pass (no false-fail)';
  }

  return { pass, retained5y, mvChange5yProxy, proxyMethod, reason };
}

// --------------------------------------------------------------------------
// Q1 — Moat proxy (ROIC > industry + 5pp)
// Buffett 1999 Letter ("durable competitive advantage"); Damodaran ch. 14
// --------------------------------------------------------------------------
function _testQ1_Moat(stock) {
  const roics = _computeAnnualROIC(stock);
  const valid  = _finite(roics);
  const n      = Math.min(10, valid.length);

  if (n < 3) {
    return { pass: false, avgROIC: null, industryMedianPlus5pp: null,
      reason: `only ${n} ROIC years (need ≥3 for moat test)` };
  }

  const avgROIC = valid.slice(0, n).reduce((s, v) => s + v, 0) / n;
  // Industry median ROIC fallback: 0.10 (soft floor per Damodaran);
  // buffett-criteria keeps it simple (no sub-profile lookup in DIAGNOSTIC method)
  const industryMedianROIC     = 0.10;
  const industryMedianPlus5pp  = industryMedianROIC + 0.05;

  const pass = avgROIC > industryMedianPlus5pp;
  const reason = pass
    ? `avg ROIC ${(avgROIC * 100).toFixed(1)}% > industry+5pp ${(industryMedianPlus5pp * 100).toFixed(0)}%`
    : `avg ROIC ${(avgROIC * 100).toFixed(1)}% ≤ industry+5pp ${(industryMedianPlus5pp * 100).toFixed(0)}%`;

  return { pass, avgROIC, industryMedianPlus5pp, reason };
}

// --------------------------------------------------------------------------
// Q2 — Pricing Power
// Buffett 1980 Letter (post-Vietnam inflation discussion)
// --------------------------------------------------------------------------
function _testQ2_PricingPower(stock) {
  const rawGP  = _rawArr(stock, 'annual.annualGP');
  const rawRev = _rawArr(stock, 'annual.annualRev');

  const gms = [];
  const n = Math.min(5, rawGP.length, rawRev.length);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(rawGP[i]) && Number.isFinite(rawRev[i]) && rawRev[i] > 0) {
      gms.push(rawGP[i] / rawRev[i]);
    }
  }

  if (gms.length < 3) {
    return { pass: false, gmSlope: null, gmTTMvsMedian: null,
      reason: `only ${gms.length} GM years (need ≥3)` };
  }

  // gms is newest-first; oldest-first for slope (increasing index = newer)
  const gmsOldestFirst = [...gms].reverse();
  const gmSlope = _slope(gmsOldestFirst);  // positive = improving
  const gmMedian = _median(gms);
  const gmLatest = gms[0];
  const gmTTMvsMedian = gmLatest - gmMedian;

  // Pass: slope >= -0.005 (-0.5pp/yr) AND latest >= median - 0.05 (-5pp)
  const slopeOk  = gmSlope != null && gmSlope >= -0.005;
  const levelOk  = gmTTMvsMedian != null && gmTTMvsMedian >= -0.05;
  const pass = slopeOk && levelOk;

  let reason;
  if (!slopeOk) reason = `GM slope ${gmSlope != null ? (gmSlope * 100).toFixed(2) : 'n/a'}pp/yr < -0.5pp/yr (declining)`;
  else if (!levelOk) reason = `GM latest ${(gmLatest * 100).toFixed(1)}% < median-5pp ${((gmMedian - 0.05) * 100).toFixed(1)}%`;
  else reason = `GM slope ${gmSlope != null ? (gmSlope * 100).toFixed(2) : 'n/a'}pp/yr, TTM vs median ${(gmTTMvsMedian * 100).toFixed(1)}pp`;

  return { pass, gmSlope, gmTTMvsMedian, reason };
}

// --------------------------------------------------------------------------
// Q3 — Consistent operating history (no op-income losses)
// Hagstrom Tenet 6
// --------------------------------------------------------------------------
function _testQ3_ConsistentOps(stock) {
  const rawOI = _rawArr(stock, 'annual.annualOpInc');
  const rawNI = _rawArr(stock, 'annual.annualNetIncome');

  const nOI = Math.min(10, rawOI.length);
  const nNI = Math.min(10, rawNI.length);

  if (nOI < 3 && nNI < 3) {
    return { pass: false, opIncLossYears: null, niLossYears: null,
      reason: 'insufficient OpInc/NI data' };
  }

  const oiSlice = rawOI.slice(0, nOI).filter(v => Number.isFinite(v));
  const niSlice = rawNI.slice(0, nNI).filter(v => Number.isFinite(v));

  const opIncLossYears = oiSlice.filter(v => v < 0).length;
  const niLossYears    = niSlice.filter(v => v < 0).length;

  const pass = opIncLossYears === 0 && niLossYears === 0;

  let reason;
  if (opIncLossYears > 0) reason = `${opIncLossYears} OpInc loss year(s) in window`;
  else if (niLossYears > 0) reason = `${niLossYears} NI loss year(s) in window`;
  else reason = `no losses in ${oiSlice.length}y OpInc, ${niSlice.length}y NI window`;

  return { pass, opIncLossYears, niLossYears, reason };
}

// --------------------------------------------------------------------------
// X1 — Industry exclusion
// Buffett 2007 Annual Meeting + 2012 Letter
// --------------------------------------------------------------------------
function _testX1_IndustryExclusion(stock) {
  const industry = (stock && stock.meta && stock.meta.industry) || '';
  const rawNI    = _rawArr(stock, 'annual.annualNetIncome');

  // Airline exclusion (Buffett: "the worst sort of business" — 2007 Letter)
  if (/airline/i.test(industry)) {
    return { pass: false, excludedReason: 'airline',
      reason: 'Airlines excluded (Buffett 2007: worst sort of business)' };
  }

  // Biotech exclusion only when unprofitable (no mature earnings moat)
  if (/biotech/i.test(industry)) {
    const latestNI = rawNI.length > 0 ? rawNI[0] : null;
    if (!Number.isFinite(latestNI) || latestNI < 0) {
      return { pass: false, excludedReason: 'biotech-unprofitable',
        reason: 'Biotech with negative NI excluded (no earnings moat)' };
    }
  }

  // Commodity miners exclusion (uranium, coal, gold mining)
  if (/uranium|coal|gold mining/i.test(industry)) {
    return { pass: false, excludedReason: 'commodity-miner',
      reason: 'Commodity miner excluded (no durable cost advantage proxy)' };
  }

  return { pass: true, excludedReason: null, reason: 'industry not excluded' };
}

// --------------------------------------------------------------------------
// Main evaluate()
// --------------------------------------------------------------------------

/**
 * Evaluate all 14 Buffett tests for a stock.
 *
 * Dependencies: reads owner-earnings and dcf-intrinsic-value from Runner
 * to avoid circular require (lazy require inside evaluate).
 *
 * Pass rule:
 *   x1_industryExclusion.pass === true  (not excluded), AND
 *   dcf.mosMet === true  (hard MoS requirement — Buffett 1989), AND
 *   passRate >= threshold  (default 0.85)
 */
function evaluate(stock) {
  if (!stock) {
    return H.buildResult({ computable: false, pass: false, reason: 'no stock data',
      threshold: PASS_THRESHOLD_DEFAULT, thresholdOp: 'gte' });
  }

  // --- Insufficient data guard ---
  const rawNI  = _rawArr(stock, 'annual.annualNetIncome');
  const rawBal = H.val(stock, 'annual.annualBalance');

  const niValid  = rawNI.filter(v => Number.isFinite(v)).length;
  const balValid = Array.isArray(rawBal) ? rawBal.filter(r => r != null).length : 0;

  if (niValid < MIN_YEARS_REQUIRED && balValid < MIN_YEARS_REQUIRED) {
    return H.buildResult({
      computable: false, pass: false,
      reason: `fewer than ${MIN_YEARS_REQUIRED}y data — Buffett rules require multi-year track record`,
      threshold: PASS_THRESHOLD_DEFAULT, thresholdOp: 'gte',
      components: { insufficientDataReason: 'both annualNetIncome and annualBalance < 5y' }
    });
  }

  // Tag 232e fix: call the delegate modules DIRECTLY (not via Runner) to
  // avoid infinite recursion — Runner.evaluateStock iterates ALL registered
  // methods including buffett-criteria itself, which then re-calls Runner →
  // stack overflow. Direct module require + evaluate is also faster (skips
  // ~30 unrelated method evaluations per call). The two delegates are
  // self-contained and tolerate missing data gracefully.
  let oeResult  = null;
  let dcfResult = null;
  try {
    const OE = require('./owner-earnings.js');
    oeResult = OE.evaluate(stock);
  } catch (e) { /* owner-earnings load/eval failed — delegate test will not-pass */ }
  try {
    const DCF = require('./dcf-intrinsic-value.js');
    dcfResult = DCF.evaluate(stock);
  } catch (e) { /* dcf load/eval failed — delegate test will not-pass */ }

  // --- Run all tests ---
  const t1  = _testT1_ROE(stock);
  const t2  = _testT2_ROIC(stock);
  const t3  = _testT3_Debt(stock);
  const t4  = _testT4_EPSGrowth(stock);
  const t5  = _testT5_FCF(stock);
  const t6  = _testT6_OwnerEarnings(oeResult);
  const t7  = _testT7_Margins(stock);
  const t8  = _testT8_EarningsYield(stock);
  const t9  = _testT9_HurdleRate(dcfResult);
  const t10 = _testT10_OneDollar(stock);
  const q1  = _testQ1_Moat(stock);
  const q2  = _testQ2_PricingPower(stock);
  const q3  = _testQ3_ConsistentOps(stock);
  const x1  = _testX1_IndustryExclusion(stock);

  const allTests = [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, q1, q2, q3, x1];
  const nTests   = allTests.length;
  const nPassed  = allTests.filter(t => t.pass).length;
  const passRate = nPassed / nTests;

  // DCF echo for visibility
  const mosMet  = !!(dcfResult && dcfResult.computable &&
    dcfResult.components && dcfResult.components.marginOfSafetyMet);
  const hurdleMet = !!(dcfResult && dcfResult.computable &&
    dcfResult.components && dcfResult.components.hurdleRateMet);
  const dcf = {
    mosMet,
    hurdleMet: hurdleMet,
    intrinsicValuePerShare: (dcfResult && dcfResult.components && dcfResult.components.intrinsicValuePerShare) || null,
    discountToIntrinsicPct: (dcfResult && dcfResult.components && dcfResult.components.discountToIntrinsicPercent) || null
  };

  const threshold = parseFloat(process.env.BUFFETT_PASS_THRESHOLD) || PASS_THRESHOLD_DEFAULT;

  // Hard requirements (per spec):
  const industryOk  = x1.pass;
  const mosOk       = mosMet;
  const rateOk      = passRate >= threshold;
  const pass = industryOk && mosOk && rateOk;

  const requiredFailed = [];
  if (!industryOk) requiredFailed.push('x1_industryExclusion');
  if (!mosOk)      requiredFailed.push('dcf.mosMet');

  // Collect per-test failures for reason string
  const testMap = { t1_roe10y: t1, t2_roic10y: t2, t3_debt: t3, t4_epsGrowth: t4,
    t5_fcfGrowing: t5, t6_ownerEarnings: t6, t7_marginsVsIndustry: t7,
    t8_earningsYieldVsTreasury: t8, t9_hurdleRate: t9, t10_oneDollar: t10,
    q1_moat: q1, q2_pricingPower: q2, q3_consistentOps: q3, x1_industryExclusion: x1 };

  const failedTests = Object.keys(testMap).filter(k => !testMap[k].pass);

  let reason;
  if (!industryOk) reason = 'Industry excluded: ' + x1.reason;
  else if (!mosOk) reason = 'DCF Margin-of-Safety not met (HARD requirement)';
  else if (!rateOk) reason = `pass rate ${(passRate * 100).toFixed(0)}% < ${(threshold * 100).toFixed(0)}% threshold; failed: ${failedTests.join(', ')}`;
  else reason = `PASS — ${nPassed}/${nTests} tests (${(passRate * 100).toFixed(0)}%), MoS met`;

  // dataYearsAvailable: max of NI years and balance years
  const dataYearsAvailable = Math.max(niValid, balValid);

  return H.buildResult({
    computable: true,
    pass,
    value: Math.round(passRate * 100),  // 0-100 for sorting
    threshold: threshold,
    thresholdOp: 'gte',
    reason,
    components: {
      t1_roe10y:               t1,
      t2_roic10y:              t2,
      t3_debt:                 t3,
      t4_epsGrowth:            t4,
      t5_fcfGrowing:           t5,
      t6_ownerEarnings:        t6,
      t7_marginsVsIndustry:    t7,
      t8_earningsYieldVsTreasury: t8,
      t9_hurdleRate:           t9,
      t10_oneDollar:           t10,
      q1_moat:                 q1,
      q2_pricingPower:         q2,
      q3_consistentOps:        q3,
      x1_industryExclusion:    x1,
      dcf,
      nTests,
      nPassed,
      passRate,
      requiredFailed,
      dataYearsAvailable,
      insufficientDataReason: null
    }
  });
}

module.exports = {
  id: ID,
  label: LABEL,
  description: 'Buffett 14-Punkt Komposit (ROE, ROIC, Debt, EPS-Acceleration, FCF, OE, Margins, E/P, Hurdle Rate, One-Dollar, Moat, Pricing-Power, Consistency, Industry-Exclusion). Pass: MoS hard-required + ≥85% tests.',
  threshold: PASS_THRESHOLD_DEFAULT,
  thresholdOp: 'gte',
  unit: 'percent',
  evaluate
};
