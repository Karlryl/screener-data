#!/usr/bin/env node
/**
 * Tag 28 - Methods-Plugin-Framework Tests
 * Tag 97+98: Liste auf 27 Methoden korrigiert (4 alte disabled, 3 neue hinzu)
 */
'use strict';
const Runner = require('./methods/runner.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(` V ${name}`); passed++; }
  catch (e) { console.log(` X ${name}\n ${e.message}`); failed++; }
}
function assertEq(a, b, m) {
  const aS = JSON.stringify(a), bS = JSON.stringify(b);
  if (aS !== bS) throw new Error(`${m||'eq'}: expected ${bS}, got ${aS}`);
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 0.001); }

console.log('Tag-28 Methods-Plugin Tests');
console.log('---------------------------');

function makeStock(metrics = {}, annual = {}, balance = []) {
  return {
    meta: { ticker: 'TEST' },
    metrics: Object.fromEntries(Object.entries(metrics).map(([k,v]) => [k, { value: v, source: 'test', confidence: 1, asOf: '2026-05-07' }])),
    annual: {
      annualNetIncome: (annual.netIncome || []).map(v => ({ value: v, currency: 'USD', source: 'test', confidence: 1 })),
      annualFCF: (annual.fcf || []).map(v => ({ value: v, currency: 'USD', source: 'test', confidence: 1 })),
      annualOpInc: (annual.opInc || []).map(v => ({ value: v, currency: 'USD', source: 'test', confidence: 1 })),
      annualBalance: balance
    }
  };
}

test('Rule of 40: pass case (50% growth + 10% FCF = 60)', () => {
  const s = makeStock({ revenueGrowthYoY: 50, fcfMarginTTM: 10 });
  const r = Runner.evaluateStock(s)['rule-of-40'];
  if (!r.pass || !r.computable) throw new Error(`expected pass, got ${JSON.stringify(r)}`);
  if (!approx(r.value, 60)) throw new Error(`value=${r.value}`);
});

test('Rule of 40: fail case (15% growth + 10% FCF = 25)', () => {
  const s = makeStock({ revenueGrowthYoY: 15, fcfMarginTTM: 10 });
  const r = Runner.evaluateStock(s)['rule-of-40'];
  if (r.pass) throw new Error('should fail');
  if (!approx(r.value, 25)) throw new Error(`value=${r.value}`);
});

test('Rule of 40: not computable when growth missing', () => {
  const s = makeStock({ fcfMarginTTM: 10 });
  const r = Runner.evaluateStock(s)['rule-of-40'];
  if (r.computable) throw new Error('should be incomputable');
});

test('ROIC: pass case (NI=20, Assets=100, Cash=20 -> 20/80 = 25%)', () => {
  const s = makeStock({}, { netIncome: [20] }, [{ totalAssets: 100, totalCash: 20, totalDebt: 30 }]);
  const r = Runner.evaluateStock(s)['roic'];
  if (!r.computable) throw new Error('should be computable');
  if (!approx(r.value, 0.25)) throw new Error(`value=${r.value}`);
  if (!r.pass) throw new Error('should pass (25% >= 15%)');
});

test('ROIC: fail case (NI=10, Assets=100 -> 10%)', () => {
  const s = makeStock({}, { netIncome: [10] }, [{ totalAssets: 100, totalCash: 0, totalDebt: 0 }]);
  const r = Runner.evaluateStock(s)['roic'];
  if (r.pass) throw new Error('should fail (10% < 15%)');
});

test('ROIC: not computable without balance', () => {
  const s = makeStock({}, { netIncome: [20] }, []);
  const r = Runner.evaluateStock(s)['roic'];
  if (r.computable) throw new Error('should be incomputable');
});

test('Net-Debt/EBITDA: pass case (debt=10, cash=2, opInc=10 -> 8/12 = 0.67)', () => {
  const s = makeStock({}, { opInc: [10] }, [{ totalDebt: 10, totalCash: 2, totalAssets: 100 }]);
  const r = Runner.evaluateStock(s)['net-debt-ebitda'];
  if (!r.computable) throw new Error('should be computable');
  if (!approx(r.value, 8 / 12, 0.01)) throw new Error(`value=${r.value}`);
  if (!r.pass) throw new Error('should pass');
});

test('Net-Debt/EBITDA: fail case (debt=50, opInc=10 -> 50/12 = 4.17 > 2.5)', () => {
  const s = makeStock({}, { opInc: [10] }, [{ totalDebt: 50, totalCash: 0, totalAssets: 100 }]);
  const r = Runner.evaluateStock(s)['net-debt-ebitda'];
  if (r.pass) throw new Error('should fail');
});

test('Sloan-Ratio: pass case (NI=10, FCF=11, Assets=200 -> -0.5%)', () => {
  const s = makeStock({}, { netIncome: [10], fcf: [11] }, [{ totalAssets: 200 }]);
  const r = Runner.evaluateStock(s)['sloan-ratio'];
  if (!r.computable) throw new Error('should be computable');
  if (!r.pass) throw new Error('should pass (|-0.5%| < 10%)');
});

test('Sloan-Ratio: fail case (Tag 117: 2-year >20% chronic)', () => {
  // Tag 117 v2: Sloan eskaliert - Hard-Fail nur bei 2 aufeinanderfolgenden Jahren >20%
  const s = makeStock({}, { netIncome: [25, 30], fcf: [0, 0] }, [{ totalAssets: 100 }, { totalAssets: 100 }]);
  const r = Runner.evaluateStock(s)['sloan-ratio'];
  if (r.pass) throw new Error('should fail (CHRONIC: 2y >20%)');
});

test('Earnings-Stability: fail when most-recent year has 30-50% decline (maxDeclineIdx===0)', () => {
  // Bug #25: before fix, maxDeclineIdx===0 branch was missing — most-recent year decline 30-50%
  // was treated as historical (recovery-test path) and could pass when no recovery was needed.
  // opInc[0]=60, opInc[1]=100 → 40% decline at index 0 (latest year). No future recovery exists yet.
  const s = makeStock({}, { opInc: [60, 100, 110, 115, 120], fcf: [50, 80, 90, 95, 100] }, []);
  const r = Runner.evaluateStock(s)['earnings-stability'];
  if (!r.computable) throw new Error('should be computable');
  if (r.pass) throw new Error('should fail: most-recent year shows 40% decline with no recovery data yet');
});

test('Revenue-Growth-3Y: pass case (100->200 over 3y = 26% CAGR)', () => {
  const s = { annual: { annualRev: [{value:200},{value:170},{value:140},{value:100}] } };
  const r = Runner.evaluateStock(s)['revenue-growth-3y'];
  if (!r.computable) throw new Error('should be computable');
  if (!r.pass) throw new Error(`should pass, got ${r.value}`);
});

test('Revenue-Growth-3Y: fail case (100->130 over 3y = 9% CAGR)', () => {
  const s = { annual: { annualRev: [{value:130},{value:120},{value:110},{value:100}] } };
  const r = Runner.evaluateStock(s)['revenue-growth-3y'];
  if (r.pass) throw new Error('should fail');
});

test('FCF-Yield: pass case (FCF=10B / MCap=100B = 10%)', () => {
  const s = { marketCap: { value: 100e9 }, annual: { annualFCF: [{value: 10e9}] } };
  const r = Runner.evaluateStock(s)['fcf-yield'];
  if (!r.pass) throw new Error('should pass');
});

test('FCF-Yield: fail case (FCF=2B / MCap=100B = 2%)', () => {
  const s = { marketCap: { value: 100e9 }, annual: { annualFCF: [{value: 2e9}] } };
  const r = Runner.evaluateStock(s)['fcf-yield'];
  if (r.pass) throw new Error('should fail');
});

test('GM-Stability: pass case (stable margins, low CoV)', () => {
  const s = { annual: {
    annualRev: [{value:100},{value:95},{value:90},{value:85}],
    annualGP: [{value:50},{value:48},{value:46},{value:43}]
  }};
  const r = Runner.evaluateStock(s)['gross-margin-stability'];
  if (!r.computable) throw new Error('should be computable');
  if (!r.pass) throw new Error(`should pass, CoV=${r.value}`);
});

test('GM-Stability: fail case (volatile margins)', () => {
  const s = { annual: {
    annualRev: [{value:100},{value:100},{value:100},{value:100}],
    annualGP: [{value:60},{value:30},{value:50},{value:40}]
  }};
  const r = Runner.evaluateStock(s)['gross-margin-stability'];
  if (r.pass) throw new Error('should fail');
});

// Tag 121f: Self-updating - count derives from filesystem, no hardcode.
// Anti-regression: catches silent method-drops (count<30) and runner/filesystem mismatch.
test('Runner: getMethods matches filesystem (no silent drops)', () => {
  const fs = require('fs');
  const path = require('path');
  const methods = Runner.getMethods();
  const ids = methods.map(m => m.id).sort();
  if (ids.length < 30) {
    throw new Error('only ' + ids.length + ' methods - did some silently drop?');
  }
  // Cross-check: filesystem .js count matches runner's loaded count.
  // Method-IDs may differ from filenames (z.B. 'quarterly-rev-acceleration' vs 'quarterly-revenue-acceleration.js').
  const NON_METHOD_FILES = new Set([
    'runner.js', 'trend.js', 'method-types.js',
    'score-aggregator.js', 'strategy-modes.js', 'sector-medians-compute.js',
    'index.js', 'data-quality.js',
    // Tag 167: helper modules (not method plugins)
    'region-mapping.js', 'sector-median-lookup.js'
  ]);
  const dir = path.join(__dirname, 'methods');
  const fsCount = fs.readdirSync(dir)
    .filter(f => f.endsWith('.js') && !f.startsWith('_') && !NON_METHOD_FILES.has(f))
    .length;
  assertEq(ids.length, fsCount, 'runner vs filesystem method count');
});

test('Runner: evaluateStock handles thrown errors', () => {
  const r = Runner.evaluateStock(null);
  for (const k of Object.keys(r)) {
    if (r[k].computable) throw new Error(`${k} should be incomputable for null stock`);
  }
});


// Tag 121g: net-debt-ebitda must flag EBITDA approximation (D&A synthesized).
test('Net-Debt/EBITDA: approximationFlag exposes EBITDA synthesis', () => {
  const s = makeStock({}, { opInc: [10] }, [{ totalDebt: 10, totalCash: 2, totalAssets: 100 }]);
  const r = Runner.evaluateStock(s)['net-debt-ebitda'];
  if (!r.computable) throw new Error('should be computable');
  if (!r.components || r.components.approximationFlag !== true) {
    throw new Error('approximationFlag missing - EBITDA-synthesis is silent (audit-finding)');
  }
  if (!r.components.approxReason || !/EBITDA/.test(r.components.approxReason)) {
    throw new Error('approxReason missing or unclear');
  }
});

// Tag 124: revenue-volatility-guard MATERIAL_REV_FLOOR must be currency-aware.
test('revenue-volatility-guard: MATERIAL_REV_FLOOR is currency-aware (USD)', () => {
  const stock = {
    meta: { ticker: '7203.T', reportingCurrency: 'JPY' },
    metrics: { revenueTTM: { value: 150e6 } },
    annual: { annualRev: [{ value: 150e6 }, { value: 140e6 }, { value: 50e6 }] }
  };
  const r = Runner.evaluateStock(stock)['revenue-volatility-guard'];
  if (!r.computable) throw new Error('should be computable (immaterial branch)');
  if (!r.reason || !/immaterial|usd-?aequiv|<\$100m/i.test(r.reason)) {
    throw new Error('JPY 150M (~$1M USD) should hit immaterial branch, got reason=' + r.reason);
  }
  if (r.pass !== true) {
    throw new Error('immaterial = pass:true; got pass=' + r.pass);
  }
});

// Tag 124: revenue-volatility-guard must still fire for USD-large stocks.
test('revenue-volatility-guard: USD large-cap with -67% YoY still FAILS', () => {
  const stock = {
    meta: { ticker: 'SPHR', reportingCurrency: 'USD' },
    metrics: { revenueTTM: { value: 1220e6 } },
    annual: { annualRev: [{ value: 1220e6 }, { value: 574e6 }, { value: 1725e6 }, { value: 180e6 }] }
  };
  const r = Runner.evaluateStock(stock)['revenue-volatility-guard'];
  if (!r.computable) throw new Error('should be computable');
  if (r.pass) throw new Error('SPHR-pattern (-67% YoY decline) should still FAIL after Tag 124');
});

// ─── Tag 133c: data-quality grading ───────────────────────────────────
const { gradeSnapshot, tierCapForGrade } = require('./methods/data-quality.js');

function fullSnapshot() {
  return {
    meta: { ticker: 'TEST', sector: 'Technology', industry: 'Software' },
    marketCap: { value: 50e9 },
    metrics: {
      revenueTTM: { value: 10e9 },
      revenueGrowthYoY: { value: 25 },
      grossMargin: { value: 70 },
      operatingMargin: { value: 30 },
      fcfMarginTTM: { value: 25 }
    },
    annual: {
      annualRev: [{ value: 10e9 }, { value: 8e9 }, { value: 6e9 }, { value: 4e9 }],
      annualOpInc: [{ value: 3e9 }, { value: 2e9 }, { value: 1.5e9 }],
      annualFCF: [{ value: 2.5e9 }, { value: 1.8e9 }],
      annualBalance: [{ totalCash: 1e9 }, { totalCash: 0.8e9 }]
    },
    timeseries: {
      revenueQ: [{ value: 2.5e9 }, { value: 2.4e9 }, { value: 2.3e9 }, { value: 2.2e9 }],
      opIncQ: [{ value: 0.7e9 }, { value: 0.6e9 }]
    }
  };
}

test('data-quality: fully-populated snapshot -> grade A+', () => {
  // F-DQ-007/008: new thresholds — nanRatio=0 → A+ (≤20% missing)
  const g = gradeSnapshot(fullSnapshot());
  if (g.grade !== 'A+') throw new Error('expected A+, got ' + g.grade + ' (missing=' + g.missingFields.join(',') + ')');
  if (g.nanRatio !== 0) throw new Error('expected nanRatio=0, got ' + g.nanRatio);
});

test('data-quality: 30%-missing snapshot -> grade A (not C)', () => {
  // F-DQ-007/008: drop 4 weight-1.0 fields → missingWeight=4, nanRatio=4/12.5=0.32 → A (20–40% missing)
  const s = fullSnapshot();
  delete s.meta.industry;
  delete s.metrics.fcfMarginTTM;
  delete s.metrics.operatingMargin;
  delete s.metrics.grossMargin;
  const g = gradeSnapshot(s);
  if (g.grade !== 'A') throw new Error('expected A, got ' + g.grade + ' (ratio=' + g.nanRatio + ' missing=' + g.missingFields.join(',') + ')');
});

test('data-quality: heavily-empty snapshot -> grade C', () => {
  // F-DQ-007/008: D is impossible with C threshold=1.0; nearly-empty → nanRatio≈0.92 → C
  const g = gradeSnapshot({ meta: { ticker: 'TEST' } });
  if (g.grade !== 'C') throw new Error('expected C, got ' + g.grade + ' (ratio=' + g.nanRatio + ')');
});

test('data-quality: tierCapForGrade A+/A/B -> null, C -> NEAR_MISS, D -> REJECT', () => {
  if (tierCapForGrade('A+') !== null) throw new Error('A+ should not cap');
  if (tierCapForGrade('A') !== null) throw new Error('A should not cap');
  if (tierCapForGrade('B') !== null) throw new Error('B should not cap');
  if (tierCapForGrade('C') !== 'NEAR_MISS') throw new Error('C should cap NEAR_MISS');
  if (tierCapForGrade('D') !== 'REJECT') throw new Error('D should REJECT');
});

// ─── Tag 133d: picks-regression detectDrift ───────────────────────────
const { detectDrift } = require('./scripts/picks-regression-check.js');

test('picks-regression: stable counts -> no alert', () => {
  const latest = { HYPERGROWTH: 80, QUALITY_COMPOUNDER: 50 };
  const priors = [
    { HYPERGROWTH: 78, QUALITY_COMPOUNDER: 49 },
    { HYPERGROWTH: 82, QUALITY_COMPOUNDER: 51 },
    { HYPERGROWTH: 79, QUALITY_COMPOUNDER: 50 },
    { HYPERGROWTH: 81, QUALITY_COMPOUNDER: 48 }
  ];
  const alerts = detectDrift(latest, priors, 0.35);
  if (alerts.length !== 0) throw new Error('expected no alerts, got ' + JSON.stringify(alerts));
});

test('picks-regression: 50% drop in HYPERGROWTH -> alert', () => {
  const latest = { HYPERGROWTH: 40, QUALITY_COMPOUNDER: 50 };
  const priors = [
    { HYPERGROWTH: 80, QUALITY_COMPOUNDER: 49 },
    { HYPERGROWTH: 82, QUALITY_COMPOUNDER: 51 },
    { HYPERGROWTH: 79, QUALITY_COMPOUNDER: 50 },
    { HYPERGROWTH: 81, QUALITY_COMPOUNDER: 48 }
  ];
  const alerts = detectDrift(latest, priors, 0.35);
  if (alerts.length !== 1) throw new Error('expected 1 alert, got ' + JSON.stringify(alerts));
  if (alerts[0].mode !== 'HYPERGROWTH') throw new Error('wrong mode');
  if (alerts[0].direction !== 'down') throw new Error('expected down, got ' + alerts[0].direction);
});

test('picks-regression: insufficient history (<4) -> no alert', () => {
  const latest = { HYPERGROWTH: 200 };
  const priors = [
    { HYPERGROWTH: 80 },
    { HYPERGROWTH: 82 }
  ];
  const alerts = detectDrift(latest, priors, 0.35);
  if (alerts.length !== 0) throw new Error('should not alert with <4 priors');
});

test('picks-regression: 35% jump up triggers alert', () => {
  const latest = { HYPERGROWTH: 110 };
  const priors = [{ HYPERGROWTH: 80 }, { HYPERGROWTH: 80 }, { HYPERGROWTH: 80 }, { HYPERGROWTH: 80 }];
  const alerts = detectDrift(latest, priors, 0.35);
  if (alerts.length !== 1) throw new Error('expected alert: 110 vs 80 = 37.5% up');
  if (alerts[0].direction !== 'up') throw new Error('expected up');
});

// ─── Tag 133e: walk-forward perf primitives ──────────────────────────
const WF = require('./scripts/walk-forward-perf.js');

test('walk-forward: priceAt finds nearest prior date', () => {
  const hist = { AAPL: [
    { date: '2026-04-01', close: 100 },
    { date: '2026-04-05', close: 110 },
    { date: '2026-04-10', close: 120 }
  ]};
  if (WF.priceAt(hist, 'AAPL', '2026-04-05') !== 110) throw new Error('exact-date lookup wrong');
  if (WF.priceAt(hist, 'AAPL', '2026-04-07') !== 110) throw new Error('between-dates lookup should pick prior');
  if (WF.priceAt(hist, 'AAPL', '2026-03-15') !== null) throw new Error('before-series should be null');
});

test('walk-forward: returnPct + addDaysIso work', () => {
  if (WF.returnPct(100, 110) !== 10) throw new Error('10% return expected');
  if (WF.returnPct(100, 90) !== -10) throw new Error('-10% return expected');
  if (WF.returnPct(0, 100) !== null) throw new Error('div-by-0 must be null');
  if (WF.addDaysIso('2026-05-01', 7) !== '2026-05-08') throw new Error('addDaysIso wrong');
});

// ─── Tag 134: Phase 1 — currency coherence ────────────────────────────
const PY = require('./pull-yahoo.js');

test('normalizeRegion: USD → US, GBP → UK, JPY → JP, TWD → TW', () => {
  if (PY.normalizeRegion('USD', 'NasdaqGS') !== 'US') throw new Error('USD should be US');
  if (PY.normalizeRegion('GBP', 'London Stock Exchange') !== 'UK') throw new Error('GBP should be UK');
  if (PY.normalizeRegion('JPY', 'Tokyo') !== 'JP') throw new Error('JPY should be JP');
  if (PY.normalizeRegion('TWD', 'Taipei') !== 'TW') throw new Error('TWD should be TW');
  if (PY.normalizeRegion('EUR', 'Frankfurt') !== 'EU') throw new Error('EUR should be EU');
});

test('normalizeRegion: unknown currency falls back via exchangeName', () => {
  if (PY.normalizeRegion(null, 'NYSE') !== 'US') throw new Error('NYSE exchange → US');
  if (PY.normalizeRegion('XXX', 'London') !== 'UK') throw new Error('London exchange → UK');
  if (PY.normalizeRegion(null, 'Unknown Exchange 42') !== 'OTHER') throw new Error('unknown → OTHER');
});

test('_convertSnapshotToUSD: USD snapshot is unchanged numerically + tagged', () => {
  const snap = {
    meta: { ticker: 'AAPL', reportingCurrency: 'USD', region: 'US' },
    marketCap: { value: 3e12 },
    metrics: { revenueTTM: { value: 380e9 } },
    annual: { annualRev: [{ value: 380e9 }, { value: 350e9 }], annualBalance: [{ totalCash: 30e9, totalDebt: 100e9, totalAssets: 350e9 }] },
    timeseries: { revenueQ: [{ value: 95e9 }] }
  };
  PY._convertSnapshotToUSD(snap);
  if (snap.marketCap.value !== 3e12) throw new Error('USD mcap unchanged');
  if (snap.metrics.revenueTTM.value !== 380e9) throw new Error('USD rev unchanged');
  if (snap.meta.fxRateApplied !== 1.0) throw new Error('USD fxRate=1.0');
  if (snap.meta.reportingCurrencyOriginal !== 'USD') throw new Error('USD origCurrency=USD');
});

test('_convertSnapshotToUSD: TWD twin produces same ratios as USD twin', () => {
  // Synthetic Taiwan stock: 1000B TWD mcap, 100B TWD FCF.
  // FCF-yield = FCF/Mcap = 100/1000 = 10% — must be preserved after any FX conversion.
  // NOTE: We do NOT check absolute USD values here because the live FX rate from
  // fx-rates.json may differ from the hardcoded fallback (0.031). Instead we verify:
  //   1. Conversion was applied (fxConverted flag set, mcap is in ~USD range)
  //   2. Key ratios are preserved (FCF-yield, Revenue/Mcap — these are currency-invariant)
  const twdSnap = {
    meta: { ticker: '2345.TW', reportingCurrency: 'TWD', region: 'TW' },
    marketCap: { value: 1000e9 },                         // 1000B TWD
    metrics: { revenueTTM: { value: 500e9 } },
    annual: {
      annualFCF: [{ value: 100e9 }, { value: 80e9 }],
      annualRev: [{ value: 500e9 }, { value: 420e9 }],
      annualBalance: [{ totalCash: 50e9, totalDebt: 20e9, totalAssets: 800e9 }]
    },
    timeseries: { revenueQ: [{ value: 130e9 }] }
  };
  PY._convertSnapshotToUSD(twdSnap);

  // Conversion must have been applied
  if (!twdSnap.meta.fxConverted) throw new Error('fxConverted flag not set after TWD conversion');
  // Sanity: mcap should be ~30–35B USD (TWD rate ~0.030–0.033), not still 1000B
  if (twdSnap.marketCap.value > 50e9 || twdSnap.marketCap.value < 10e9) {
    throw new Error('TWD mcap outside expected USD range: got ' + (twdSnap.marketCap.value / 1e9).toFixed(2) + 'B USD');
  }
  // FCF-yield must be currency-invariant (100B / 1000B = 10%)
  const twdYield = twdSnap.annual.annualFCF[0].value / twdSnap.marketCap.value;
  if (Math.abs(twdYield - 0.1) > 1e-6) {
    throw new Error('fcf-yield should be 10%, got ' + (twdYield * 100).toFixed(4) + '%');
  }
  // Revenue/Mcap ratio preserved (500/1000 = 0.5)
  const revMcapRatio = twdSnap.metrics.revenueTTM.value / twdSnap.marketCap.value;
  if (Math.abs(revMcapRatio - 0.5) > 1e-6) {
    throw new Error('rev/mcap ratio should be 0.5, got ' + revMcapRatio.toFixed(6));
  }
});

test('_convertSnapshotToUSD: unknown currency leaves values + flags failure', () => {
  const snap = {
    meta: { ticker: 'X', reportingCurrency: 'ZZZ' },
    marketCap: { value: 100 },
    annual: { annualRev: [{ value: 100 }] }
  };
  PY._convertSnapshotToUSD(snap);
  if (snap.marketCap.value !== 100) throw new Error('unknown currency: values unchanged');
  if (!snap.meta.fxConversionFailed) throw new Error('fxConversionFailed flag should be set');
});

// ─── Tag 204 — ADR-class currency fix (financialCurrency vs currency) ────
// Bug #1: ADRs trade in USD but report financials in local ccy.
// Before Tag 204, mapYahooToCanonical read price.currency only → reportingCurrency
// matched 'USD' → _convertSnapshotToUSD early-returned → annual.* stayed in
// local trillions, corrupting fcf-yield/ev-ebitda/p/s ~30× for TSM/BABA/etc.
test('Tag 204 currency-fix: ADR (currency=USD, financialCurrency=TWD) → reportingCurrency=TWD', () => {
  const yahoo = {
    summaryDetail: { marketCap: 500e9, trailingPE: 25, priceToSalesTrailing12Months: 8, forwardPE: 22 },
    financialData: { totalRevenue: 2.1e12, operatingMargins: 0.42, freeCashflow: 800e9, grossMargins: 0.53, revenueGrowth: 0.30 },
    defaultKeyStatistics: { heldPercentInsiders: 0.001 },
    assetProfile: { sector: 'Technology', industry: 'Semiconductors' },
    price: { longName: 'Synthetic TSM-like ADR', currency: 'USD', financialCurrency: 'TWD', exchangeName: 'NYSE' },
    incomeStatementHistory: { incomeStatementHistory: [
      { totalRevenue: 2.1e12, operatingIncome: 880e9, netIncome: 750e9 }
    ]},
    incomeStatementHistoryQuarterly: { incomeStatementHistory: [] },
    cashflowStatementHistory: { cashflowStatements: [] },
    balanceSheetHistory: { balanceSheetStatements: [] }
  };
  const wl = { ticker: 'SYNADR', isin: null };
  const out = PY.mapYahooToCanonical(yahoo, wl, '2026-05-16T00:00:00.000Z');
  if (out.meta.reportingCurrency !== 'TWD') {
    throw new Error('expected reportingCurrency=TWD (financialCurrency), got ' + out.meta.reportingCurrency);
  }
  if (out.meta.tradingCurrency !== 'USD') {
    throw new Error('expected tradingCurrency=USD (price.currency), got ' + out.meta.tradingCurrency);
  }
});

test('Tag 204 currency-fix: US anchor (currency=USD, financialCurrency=USD) → reportingCurrency=USD', () => {
  // NVDA/MSFT-class: both fields are USD; behavior must be identical to pre-Tag-204.
  const yahoo = {
    summaryDetail: { marketCap: 3e12, trailingPE: 50, priceToSalesTrailing12Months: 30, forwardPE: 40 },
    financialData: { totalRevenue: 60e9, operatingMargins: 0.55, freeCashflow: 30e9, grossMargins: 0.75, revenueGrowth: 1.2 },
    defaultKeyStatistics: { heldPercentInsiders: 0.04 },
    assetProfile: { sector: 'Technology', industry: 'Semiconductors' },
    price: { longName: 'Synthetic NVDA-like', currency: 'USD', financialCurrency: 'USD', exchangeName: 'NASDAQ' },
    incomeStatementHistory: { incomeStatementHistory: [ { totalRevenue: 60e9, operatingIncome: 33e9, netIncome: 30e9 } ]},
    incomeStatementHistoryQuarterly: { incomeStatementHistory: [] },
    cashflowStatementHistory: { cashflowStatements: [] },
    balanceSheetHistory: { balanceSheetStatements: [] }
  };
  const wl = { ticker: 'SYNUS', isin: null };
  const out = PY.mapYahooToCanonical(yahoo, wl, '2026-05-16T00:00:00.000Z');
  if (out.meta.reportingCurrency !== 'USD') throw new Error('US anchor reportingCurrency must be USD, got ' + out.meta.reportingCurrency);
  if (out.meta.tradingCurrency !== 'USD') throw new Error('US anchor tradingCurrency must be USD, got ' + out.meta.tradingCurrency);
});

test('Tag 204 currency-fix: EU anchor (currency=CHF, financialCurrency=CHF) → reportingCurrency=CHF (no false flip)', () => {
  // NESN.SW/RMS.PA-class: both fields are the same local ccy → keep that ccy,
  // do NOT regress to USD. Critical because the (_fc !== _tc) guard is what
  // distinguishes ADRs from native non-USD listings.
  const yahoo = {
    summaryDetail: { marketCap: 250e9, trailingPE: 22, priceToSalesTrailing12Months: 2.5, forwardPE: 20 },
    financialData: { totalRevenue: 90e9, operatingMargins: 0.18, freeCashflow: 12e9, grossMargins: 0.48, revenueGrowth: 0.04 },
    defaultKeyStatistics: { heldPercentInsiders: 0.001 },
    assetProfile: { sector: 'Consumer Defensive', industry: 'Packaged Foods' },
    price: { longName: 'Synthetic NESN-like', currency: 'CHF', financialCurrency: 'CHF', exchangeName: 'SIX' },
    incomeStatementHistory: { incomeStatementHistory: [ { totalRevenue: 90e9, operatingIncome: 16e9, netIncome: 11e9 } ]},
    incomeStatementHistoryQuarterly: { incomeStatementHistory: [] },
    cashflowStatementHistory: { cashflowStatements: [] },
    balanceSheetHistory: { balanceSheetStatements: [] }
  };
  const wl = { ticker: 'SYNEU', isin: null };
  const out = PY.mapYahooToCanonical(yahoo, wl, '2026-05-16T00:00:00.000Z');
  if (out.meta.reportingCurrency !== 'CHF') throw new Error('EU anchor reportingCurrency must be CHF, got ' + out.meta.reportingCurrency);
  if (out.meta.tradingCurrency !== 'CHF') throw new Error('EU anchor tradingCurrency must be CHF, got ' + out.meta.tradingCurrency);
});

test('Tag 204 currency-fix: metrics.* allow-list — revenueTTM still scaled (smoke for Fix #2)', () => {
  // Synthetic JPY snapshot; the new enumeration must still scale metrics.revenueTTM.
  // (Other CCY_DENOMINATED_METRICS keys are reserved but currently absent, so this
  // test pins the only field that exists today.)
  const snap = {
    meta: { ticker: 'SYNJP', reportingCurrency: 'JPY', region: 'JP' },
    marketCap: { value: 1e12 },
    metrics: { revenueTTM: { value: 5e11 }, operatingMargin: { value: 25 } },
    annual: { annualRev: [{ value: 5e11 }] }
  };
  PY._convertSnapshotToUSD(snap);
  if (snap.meta.reportingCurrency !== 'USD') throw new Error('snap should be converted to USD');
  // operatingMargin (a ratio, not in allow-list) must NOT be scaled
  if (snap.metrics.operatingMargin.value !== 25) {
    throw new Error('operatingMargin (ratio) must not be scaled; got ' + snap.metrics.operatingMargin.value);
  }
  // revenueTTM must be scaled (value should be much smaller than 5e11 after JPY→USD)
  if (snap.metrics.revenueTTM.value >= 5e11) {
    throw new Error('revenueTTM should be FX-scaled; still ' + snap.metrics.revenueTTM.value);
  }
});

test('walk-forward: evaluateVintage computes alpha vs universe-median', () => {
  // Use dates well in the past so 7d/28d/84d horizons resolve, not "too-early"
  const hist = {
    AAPL: [{ date: '2025-01-01', close: 100 }, { date: '2025-01-08', close: 130 }, { date: '2025-04-01', close: 150 }], // +30% at 7d
    MSFT: [{ date: '2025-01-01', close: 200 }, { date: '2025-01-08', close: 260 }, { date: '2025-04-01', close: 300 }], // +30% at 7d
    XYZ:  [{ date: '2025-01-01', close: 50 },  { date: '2025-01-08', close: 50 },  { date: '2025-04-01', close: 50 }]   //   0%
  };
  const picks = {
    asOf: '2025-01-01T00:00:00Z',
    // F-BT-003: evaluatedTickers required for universe-median (survivor-bias correction)
    evaluatedTickers: ['AAPL', 'MSFT', 'XYZ'],
    modes: { HYPERGROWTH: [{ ticker: 'AAPL' }, { ticker: 'MSFT' }] }
  };
  // F-PF-003: evaluateVintage expects a Map-based priceIndex, not raw history arrays
  const priceIndex = WF.buildPriceIndex(hist);
  const ev = WF.evaluateVintage(picks, priceIndex);
  const h7 = ev.modes.HYPERGROWTH.horizons['7d'];
  if (h7.status !== 'ok') throw new Error('expected ok, got ' + h7.status);
  if (Math.round(h7.pickMedianReturn) !== 30) throw new Error('pick median 30% expected, got ' + h7.pickMedianReturn);
  // universe median across all 3 tickers' 7d returns = median(30, 30, 0) = 30
  if (Math.round(h7.universeMedianReturn) !== 30) throw new Error('universe median 30% expected, got ' + h7.universeMedianReturn);
  // alpha = pickMedian - universeMedian = 30 - 30 = 0 (picks tied with universe)
  // Bug #24: Math.abs(null) === 0, so the old assertion was vacuously true when alpha=null (n<MIN_SAMPLES=10).
  // Fix: only assert alpha value if non-null; null is acceptable for small samples.
  if (h7.alpha != null && Math.abs(h7.alpha) > 0.01) throw new Error('alpha ~0 expected (picks tied with universe), got ' + h7.alpha);
});

// ─── Tag 199 — New audit-method smoke tests ───────────────────────────
// Quick correctness checks for the seven methods added in the Tag 199
// audit cycle. They guard against accidental regressions if someone
// later touches the gating constants or value-formula in those files.

test('loss-magnitude-guard: PASS when op-loss < 50% of rev', () => {
  const s = makeStock({}, { opInc: [-200], }, []);
  s.annual.annualRev = [{ value: 1000 }];  // ratio -0.20 → PASS
  const r = Runner.evaluateStock(s)['loss-magnitude-guard'];
  if (!r.computable) throw new Error('should be computable');
  if (!r.pass) throw new Error('ratio -0.20 should pass -0.50 gate');
});

test('loss-magnitude-guard: FAIL when op-loss exceeds 50% of rev', () => {
  const s = makeStock({}, { opInc: [-200], }, []);
  s.annual.annualRev = [{ value: 300 }];  // ratio -0.67 → FAIL
  const r = Runner.evaluateStock(s)['loss-magnitude-guard'];
  if (r.pass) throw new Error('ratio -0.67 should fail -0.50 gate');
});

test('listing-age: counts consecutive non-null annualRev entries', () => {
  const s = makeStock({}, {}, []);
  s.annual.annualRev = [{ value: 100 }, { value: 80 }, { value: 60 }, null, { value: 40 }];
  const r = Runner.evaluateStock(s)['listing-age'];
  if (!r.computable) throw new Error('should be computable');
  if (r.value !== 3) throw new Error('expected 3 consecutive clean years, got ' + r.value);
});

test('listing-age: PASS at 3y floor', () => {
  const s = makeStock({}, {}, []);
  s.annual.annualRev = [{ value: 100 }, { value: 80 }, { value: 60 }];
  const r = Runner.evaluateStock(s)['listing-age'];
  if (!r.pass) throw new Error('3y should pass 3y floor');
});

test('metric-divergence-guard: PASS when TTM and annual margins agree', () => {
  const s = makeStock({ operatingMargin: 25 }, { opInc: [250] }, []);
  s.annual.annualRev = [{ value: 1000 }];  // annual margin = 25%, ttm = 25 → div = 0
  const r = Runner.evaluateStock(s)['metric-divergence-guard'];
  if (!r.pass) throw new Error('div=0 should pass');
});

test('metric-divergence-guard: FAIL on MSTR-style divergence', () => {
  const s = makeStock({ operatingMargin: -11641 }, { opInc: [-41] }, []);
  s.annual.annualRev = [{ value: 477 }];  // annual margin = -8.6%, div ≈ 11633pp
  const r = Runner.evaluateStock(s)['metric-divergence-guard'];
  if (r.pass) throw new Error('MSTR-pattern divergence should fail');
});

test('operating-margin-acceleration: PASS when 3 consecutive years improving', () => {
  const s = makeStock({}, {}, []);
  s.annual.annualRev = [{ value: 100 }, { value: 100 }, { value: 100 }, { value: 100 }];
  s.annual.annualOpInc = [{ value: 30 }, { value: 25 }, { value: 20 }, { value: 15 }];
  const r = Runner.evaluateStock(s)['operating-margin-acceleration'];
  if (!r.pass) throw new Error('rising OM should pass; got ' + JSON.stringify(r.value));
  if (r.components.trend !== 'accelerating') throw new Error('trend should be accelerating');
});

test('revenue-acceleration-yoy: PASS when current YoY > prior YoY', () => {
  const s = makeStock({}, {}, []);
  // 200 / 100 = +100% YoY current; 100 / 90 = +11% YoY prior → delta = +89pp
  s.annual.annualRev = [{ value: 200 }, { value: 100 }, { value: 90 }];
  const r = Runner.evaluateStock(s)['revenue-acceleration-yoy'];
  if (!r.pass) throw new Error('current YoY > prior should pass');
  if (r.value < 80) throw new Error('expected ~89pp delta, got ' + r.value);
});

test('revenue-acceleration-yoy: FAIL when growth decelerates', () => {
  const s = makeStock({}, {}, []);
  // 110 / 100 = +10%; 100 / 50 = +100% → delta = -90pp
  s.annual.annualRev = [{ value: 110 }, { value: 100 }, { value: 50 }];
  const r = Runner.evaluateStock(s)['revenue-acceleration-yoy'];
  if (r.pass) throw new Error('decelerating growth should fail');
});

test('sbc-growth-ratio: PASS when SBC grows slower than revenue', () => {
  const s = makeStock({}, {}, []);
  s.annual.annualRev = [{ value: 1500 }, { value: 1000 }];  // +50% growth
  s.annual.annualSBC = [{ value: 120 }, { value: 100 }];    // +20% growth
  // ratio = 0.20 / 0.50 = 0.40 → pass
  const r = Runner.evaluateStock(s)['sbc-growth-ratio'];
  if (!r.pass) throw new Error('SBC slower than rev should pass; got ' + r.value);
});

test('sbc-growth-ratio: FAIL when SBC dramatically outpaces revenue', () => {
  const s = makeStock({}, {}, []);
  s.annual.annualRev = [{ value: 1100 }, { value: 1000 }];  // +10% growth
  s.annual.annualSBC = [{ value: 200 }, { value: 100 }];    // +100% growth
  // ratio = 1.0 / 0.10 = 10 → fail (above 1.5 threshold)
  const r = Runner.evaluateStock(s)['sbc-growth-ratio'];
  if (r.pass) throw new Error('SBC 10x rev growth should fail');
});

test('net-income-volatility-guard: PASS on normal NI fluctuations', () => {
  const s = makeStock({}, { netIncome: [2000, 1500, 1000, 800] }, []);
  s.annual.annualRev = [{ value: 10000 }];
  // max delta = 500 / rev 10000 = 0.05 → pass
  const r = Runner.evaluateStock(s)['net-income-volatility-guard'];
  if (!r.computable) throw new Error('should be computable');
  if (!r.pass) throw new Error('low-vol NI should pass');
});

test('net-income-volatility-guard: FAIL on MSTR-pattern', () => {
  const s = makeStock({}, { netIncome: [-4229, -1167, 429, -1470] }, []);
  s.annual.annualRev = [{ value: 477 }];
  // max delta = 3062 / 477 = 6.4 → fail
  const r = Runner.evaluateStock(s)['net-income-volatility-guard'];
  if (r.pass) throw new Error('MSTR-pattern NI swing should fail');
});

test('roic-trend: PASS when current ROIC > prior', () => {
  const s = makeStock({}, { netIncome: [20, 15] }, [
    { totalAssets: 100, totalCash: 20, totalDebt: 0 },   // y0 IC=80, ROIC=25%
    { totalAssets: 90,  totalCash: 15, totalDebt: 0 }    // y1 IC=75, ROIC=20%
  ]);
  const r = Runner.evaluateStock(s)['roic-trend'];
  if (!r.computable) throw new Error('should be computable; reason=' + r.reason);
  if (!r.pass) throw new Error('rising ROIC should pass');
  if (r.value < 4) throw new Error('expected ~5pp delta, got ' + r.value);
});

test('roic-trend: FAIL when ROIC drops', () => {
  const s = makeStock({}, { netIncome: [10, 20] }, [
    { totalAssets: 100, totalCash: 20, totalDebt: 0 },
    { totalAssets: 100, totalCash: 20, totalDebt: 0 }
  ]);
  const r = Runner.evaluateStock(s)['roic-trend'];
  if (r.pass) throw new Error('declining ROIC should fail');
});

test('single-quarter-dependency: incomputable on <8 quarters', () => {
  const s = makeStock({}, {}, []);
  s.timeseries = { revenueQ: [{ value: 100 }, { value: 80 }, { value: 60 }, { value: 40 }] };
  const r = Runner.evaluateStock(s)['single-quarter-dependency'];
  if (r.computable) throw new Error('should be incomputable with 4 quarters');
});

// Tag 201b: pre-commerciality megacap guard
test('pre-commerciality-megacap-guard: PASS when mcap < 1B', () => {
  const s = makeStock({}, {}, []);
  s.marketCap = 500e6;
  s.annual.annualRev = [{ value: 0 }];
  const r = Runner.evaluateStock(s)['pre-commerciality-megacap-guard'];
  if (!r.pass) throw new Error('sub-1B mcap should pass guard');
});

test('pre-commerciality-megacap-guard: FAIL on QS-pattern (mcap>1B + rev=0)', () => {
  const s = makeStock({}, {}, []);
  s.marketCap = 5e9;
  s.annual.annualRev = [{ value: 0 }];
  const r = Runner.evaluateStock(s)['pre-commerciality-megacap-guard'];
  if (!r.computable) throw new Error('should be computable');
  if (r.pass) throw new Error('QS-pattern (5B mcap, 0 rev) must fail');
});

test('pre-commerciality-megacap-guard: PASS for established compounder', () => {
  const s = makeStock({}, {}, []);
  s.marketCap = 100e9;
  s.annual.annualRev = [{ value: 50e9 }];
  const r = Runner.evaluateStock(s)['pre-commerciality-megacap-guard'];
  if (!r.pass) throw new Error('mega-cap with 50B rev must pass');
});

// Tag 202: closed-end-trust guard
test('closed-end-trust-guard: PASS on BRK-B pattern (Insurance-Diversified + 30% Rev/Assets)', () => {
  const s = makeStock({}, { fcf: [25e9, 11e9, 30e9, 22e9] }, [{ totalAssets: 1.22e12, totalCash: 0, totalDebt: 0 }]);
  s.meta.industry = 'Insurance - Diversified';
  s.meta.sector   = 'Financial Services';
  s.annual.annualRev = [{ value: 371e9 }, { value: 371e9 }, { value: 364e9 }, { value: 302e9 }];
  const r = Runner.evaluateStock(s)['closed-end-trust-guard'];
  if (!r.computable) throw new Error('should be computable, got: ' + r.reason);
  if (!r.pass) throw new Error('BRK-B-pattern must pass; signals=' + r.value + ' reason=' + r.reason);
});

test('closed-end-trust-guard: FAIL on SMT.L pattern (Asset Management + neg-rev + low Rev/Assets)', () => {
  const s = makeStock({}, { fcf: [-82e6, -62e6, -63e6, -85e6] }, [{ totalAssets: 13.7e9, totalCash: 0, totalDebt: 0 }]);
  s.meta.industry = 'Asset Management';
  s.meta.sector   = 'Financial Services';
  s.annual.annualRev = [{ value: 1.24e9 }, { value: 1.38e9 }, { value: -2.91e9 }, { value: -2.54e9 }];
  const r = Runner.evaluateStock(s)['closed-end-trust-guard'];
  if (!r.computable) throw new Error('should be computable');
  if (r.pass) throw new Error('SMT.L-pattern must fail; signals=' + r.value + ' reason=' + r.reason);
});

test('closed-end-trust-guard: PASS on NVDA (Technology, no signals fire)', () => {
  const s = makeStock({}, { fcf: [96e9, 60e9, 27e9, 4e9] }, [{ totalAssets: 207e9, totalCash: 0, totalDebt: 0 }]);
  s.meta.industry = 'Semiconductors';
  s.meta.sector   = 'Technology';
  s.annual.annualRev = [{ value: 216e9 }, { value: 130e9 }, { value: 61e9 }, { value: 27e9 }];
  const r = Runner.evaluateStock(s)['closed-end-trust-guard'];
  if (!r.computable) throw new Error('should be computable');
  if (!r.pass) throw new Error('NVDA must pass; signals=' + r.value + ' reason=' + r.reason);
});

// Tag 206a: REIT/Real-Estate token expansion (Karl's direct GPT.AX complaint)
test('closed-end-trust-guard: FAIL on GPT.AX-pattern (REIT + Real Estate sector + low Rev/Assets)', () => {
  // GPT.AX: REIT - Diversified, Real Estate sector, fcfMargin 598%, low rev/assets
  const s = makeStock({}, { fcf: [200e6, 180e6, 150e6, 100e6] }, [{ totalAssets: 10e9, totalCash: 0, totalDebt: 0 }]);
  s.meta.industry = 'REIT - Diversified';
  s.meta.sector   = 'Real Estate';
  s.annual.annualRev = [{ value: 250e6 }, { value: 240e6 }, { value: 220e6 }, { value: 200e6 }];  // 2.5% Rev/Assets
  const r = Runner.evaluateStock(s)['closed-end-trust-guard'];
  if (!r.computable) throw new Error('should be computable');
  if (r.pass) throw new Error('GPT.AX-pattern (REIT + Real Estate + 2.5% Rev/Assets) must fail; signals=' + r.value);
});

// Tag 206a: ensure operating REIT (high Rev/Assets) still PASSES — don't over-quarantine
test('closed-end-trust-guard: PASS on operating REIT with high Rev/Assets', () => {
  const s = makeStock({}, { fcf: [500e6, 480e6, 450e6, 420e6] }, [{ totalAssets: 3e9, totalCash: 0, totalDebt: 0 }]);
  s.meta.industry = 'REIT - Industrial';
  s.meta.sector   = 'Real Estate';
  s.annual.annualRev = [{ value: 1.5e9 }, { value: 1.4e9 }, { value: 1.3e9 }, { value: 1.2e9 }];  // 50% Rev/Assets
  const r = Runner.evaluateStock(s)['closed-end-trust-guard'];
  if (!r.computable) throw new Error('should be computable');
  // S1 fires (REIT industry) but S2/S3/S4 miss → only 1 signal → PASS
  if (!r.pass) throw new Error('operating REIT (50% Rev/Assets) must pass; signals=' + r.value);
});

// Tag 205: R40-sanity-cap guard
test('r40-sanity-cap: PASS on CRDO-pattern (revGrowth=201%, OpInc>0 → carve-out)', () => {
  const s = makeStock({ revenueGrowthYoY: 201, fcfMarginTTM: 9, operatingMargin: 9 }, { opInc: [50] }, []);
  const r = Runner.evaluateStock(s)['r40-sanity-cap'];
  if (!r.computable) throw new Error('should be computable');
  if (!r.pass) throw new Error('CRDO-pattern (revGrowth=201% with positive OpInc) must pass; reason=' + r.reason);
});

test('r40-sanity-cap: FAIL on ONDS-pattern (revGrowth=629%, OpInc<0 → F1 fires)', () => {
  const s = makeStock({ revenueGrowthYoY: 629, fcfMarginTTM: 10, operatingMargin: 5 }, { opInc: [-200] }, []);
  const r = Runner.evaluateStock(s)['r40-sanity-cap'];
  if (!r.computable) throw new Error('should be computable');
  if (r.pass) throw new Error('ONDS-pattern (revGrowth=629% with negative OpInc) must fail');
});

test('r40-sanity-cap: PASS on NVDA-pattern (revGrowth=73, fcfMargin=27, opM=60 → no condition fires)', () => {
  const s = makeStock({ revenueGrowthYoY: 73, fcfMarginTTM: 27, operatingMargin: 60 }, { opInc: [5000] }, []);
  const r = Runner.evaluateStock(s)['r40-sanity-cap'];
  if (!r.computable) throw new Error('should be computable');
  if (!r.pass) throw new Error('NVDA-pattern (div=33pp < 50pp) must pass; reason=' + r.reason);
});

// Tag 201c: anchor repair — revenue-growth-3y threshold lowered to 22%
test('Revenue-Growth-3Y: AVGO-pattern (24.4% CAGR) now passes at 22% bar', () => {
  // 100 → 194.74 over 3y = 24.7% CAGR
  const s = { annual: { annualRev: [{value:194.74},{value:165},{value:135},{value:100}] } };
  const r = Runner.evaluateStock(s)['revenue-growth-3y'];
  if (!r.computable) throw new Error('should be computable');
  if (!r.pass) throw new Error('AVGO/NOW-style 24% CAGR should now pass after Tag 201c');
});

// Tag 201c: rule-of-40 annual-FCF fallback for MELI-pattern TTM anomaly
test('Rule of 40: MELI-pattern (TTM negative, annual positive) uses fallback', () => {
  const s = makeStock({ revenueGrowthYoY: 49, fcfMarginTTM: -13 });
  // annual median ~33% margin: FCF/Rev = 10.8/32.7=33%, 7.1/21.5=33%, 4.6/14=33%, 2.5/9=28%
  s.annual.annualRev = [{value: 32.7e9}, {value: 21.5e9}, {value: 14e9}, {value: 9e9}];
  s.annual.annualFCF = [{value: 10.8e9}, {value: 7.1e9}, {value: 4.6e9}, {value: 2.5e9}];
  const r = Runner.evaluateStock(s)['rule-of-40'];
  if (!r.computable) throw new Error('should be computable');
  if (!r.pass) throw new Error('MELI-pattern (TTM=-13, annual median ~33) should pass via fallback');
  if (r.components.fcfMarginSource !== '3y-annual-median')
    throw new Error('expected fallback, got source=' + r.components.fcfMarginSource);
});

test('Rule of 40: TTM positive — fallback NOT triggered (preserves fixture-hash semantics)', () => {
  const s = makeStock({ revenueGrowthYoY: 38, fcfMarginTTM: 22 });
  s.annual.annualRev = [{value: 10e9}, {value: 7.2e9}, {value: 5.2e9}, {value: 3.8e9}];
  s.annual.annualFCF = [{value: 2.2e9}, {value: 1.4e9}];
  const r = Runner.evaluateStock(s)['rule-of-40'];
  if (r.components.fcfMarginSource !== 'TTM')
    throw new Error('positive TTM must NOT trigger fallback');
});

// ─── Tag 202: High-Turnover-Retail-Tier (COST-pattern) ─────────────────
// Pattern: AT>=3 + OpMargin-Median>=3.5% relaxes ROIC-Floor to 15% and waives 20% GM-Hard-Floor.
// Gated by AT AND OpMargin, so software/megacap anchors (AT<1) cannot trigger it.

function _retailStock() {
  // COST-shaped synthetic: 275B rev, 77B assets → AT=3.57; GM~12.8%; OpM~3.6%; ROIC~16.5%
  return {
    meta: { ticker: 'RETAIL-FIX' },
    annual: {
      annualRev:   [{value:275e9},{value:254e9},{value:242e9},{value:227e9}],
      annualGP:    [{value:35.3e9},{value:32.1e9},{value:29.7e9},{value:27.6e9}],
      annualOpInc: [{value:10.4e9},{value:9.3e9},{value:8.1e9},{value:7.8e9}],
      annualNetIncome: [{value:8e9},{value:7.4e9},{value:6.3e9},{value:5.8e9}],
      annualBalance: [{ totalAssets: 77e9, totalCash: 14e9, totalDebt: 6e9 }]
    }
  };
}

test('Tag 202: QC-ROIC retail-tier — COST-pattern (ROIC=16.5%, AT=3.57, OpM~3.8%) PASSES via retail-tier', () => {
  const r = Runner.evaluateStock(_retailStock())['quality-compounder-roic'];
  if (!r.computable) throw new Error('should be computable');
  if (!r.pass) throw new Error('COST-pattern should pass via high-turnover-retail-tier');
  if (r.components.pathUsed !== 'high-turnover-retail-tier')
    throw new Error('expected pathUsed=high-turnover-retail-tier, got ' + r.components.pathUsed);
});

test('Tag 202: Margin-Quality retail-tier — COST-pattern (GM~13%, OpM~3.6%, AT=3.57) PASSES (20% GM-floor waived)', () => {
  const r = Runner.evaluateStock(_retailStock())['margin-quality'];
  if (!r.computable) throw new Error('should be computable');
  if (!r.pass) throw new Error('COST-pattern should pass via retail-tier (GM-floor waived)');
  if (!r.components.retailTierPath) throw new Error('expected retailTierPath=true');
});

test('Tag 202: retail-tier gate is tight — AT=3 but OpM=2% does NOT trigger (still fails GM<20%)', () => {
  // Low-quality high-AT retailer: GM=12%, OpM=2% (below 3.5% gate). Must NOT bypass GM-floor.
  const s = {
    meta: { ticker: 'BAD-RETAIL' },
    annual: {
      annualRev:   [{value:100e9},{value:90e9},{value:80e9},{value:70e9}],
      annualGP:    [{value:12e9},{value:11e9},{value:10e9},{value:9e9}],
      annualOpInc: [{value:2e9},{value:1.8e9},{value:1.6e9},{value:1.4e9}],
      annualBalance: [{ totalAssets: 33e9, totalCash: 2e9 }]
    }
  };
  const r = Runner.evaluateStock(s)['margin-quality'];
  if (r.pass) throw new Error('OpM=2% (<3.5% gate) must not bypass 20% GM-floor');
  if (r.components.retailTierPath) throw new Error('retailTierPath must be false when OpM-median < 3.5%');
});

// ─── Tag 203 — fintech-aware OpInc fallback (pull-yahoo.js) ──────────
// Exercises the mapYahooToCanonical fallback that fires when
// incomeStatementHistory.operatingIncome is null for Financial-Services
// tickers (banks, neobanks, insurance). DIAGNOSTIC ONLY — fixture-hash
// invariant unchanged because mapYahooToCanonical is upstream of methods.
// (PY = require('./pull-yahoo.js') is already imported earlier in this file.)

test('Tag 203 OpInc-fallback: synthetic bank (sector=Financial Services, empty OpInc, populated rev+margin) derives OpInc via margin path', () => {
  // Mimics Yahoo payload for JPM/BAC: isHist rows have totalRevenue but null
  // operatingIncome, AND no bank line-items (totalOperatingExpenses null).
  // operatingMargins TTM is populated (Yahoo provides it via financialData
  // even when income-statement detail is missing).
  const yahoo = {
    summaryDetail: { marketCap: 800e9, trailingPE: 14, priceToSalesTrailing12Months: 4.5, forwardPE: 13 },
    financialData: { totalRevenue: 180e9, operatingMargins: 0.43, freeCashflow: 50e9, grossMargins: 0, revenueGrowth: 0.12 },
    defaultKeyStatistics: { heldPercentInsiders: 0.004 },
    assetProfile: { sector: 'Financial Services', industry: 'Banks - Diversified' },
    price: { longName: 'Synthetic Bank', currency: 'USD', exchangeName: 'NYSE' },
    incomeStatementHistory: { incomeStatementHistory: [
      { totalRevenue: 182e9, operatingIncome: null, netIncome: 55e9 },
      { totalRevenue: 177e9, operatingIncome: null, netIncome: 56e9 },
      { totalRevenue: 158e9, operatingIncome: null, netIncome: 47e9 },
      { totalRevenue: 128e9, operatingIncome: null, netIncome: 35e9 }
    ]},
    incomeStatementHistoryQuarterly: { incomeStatementHistory: [] },
    cashflowStatementHistory: { cashflowStatements: [] },
    balanceSheetHistory: { balanceSheetStatements: [] }
  };
  const wl = { ticker: 'SYNBANK', isin: null };
  const out = PY.mapYahooToCanonical(yahoo, wl, '2026-05-16T00:00:00.000Z');
  if (out.annual.annualOpInc.length !== 4) throw new Error('expected 4 derived OpInc entries, got ' + out.annual.annualOpInc.length);
  if (out.meta.opIncSource !== 'computed-margin') throw new Error('expected opIncSource=computed-margin, got ' + out.meta.opIncSource);
  // 182e9 * 0.43 = 78.26e9 — derived value should match within FP tolerance.
  const v0 = out.annual.annualOpInc[0].value;
  if (!approx(v0, 182e9 * 0.43, 1e6)) throw new Error('first-year derived OpInc=' + v0 + ', expected ~' + (182e9*0.43));
});

test('Tag 203 OpInc-fallback: NEVER fires for non-Financial-Services (sector-gated)', () => {
  // Same null-OpInc shape but sector=Technology — fallback must not trigger
  // so anchor tickers (NVDA, MSFT, etc.) are unaffected.
  const yahoo = {
    summaryDetail: { marketCap: 3e12, trailingPE: 50, priceToSalesTrailing12Months: 30, forwardPE: 40 },
    financialData: { totalRevenue: 60e9, operatingMargins: 0.55, freeCashflow: 30e9, grossMargins: 0.75, revenueGrowth: 1.2 },
    defaultKeyStatistics: { heldPercentInsiders: 0.04 },
    assetProfile: { sector: 'Technology', industry: 'Semiconductors' },
    price: { longName: 'Synthetic Tech', currency: 'USD', exchangeName: 'NASDAQ' },
    // Note: operatingIncome present here (rare for tech to be null) — we
    // simulate the rare null case to prove sector gate, not data presence.
    incomeStatementHistory: { incomeStatementHistory: [
      { totalRevenue: 60e9, operatingIncome: null, netIncome: 30e9 }
    ]},
    incomeStatementHistoryQuarterly: { incomeStatementHistory: [] },
    cashflowStatementHistory: { cashflowStatements: [] },
    balanceSheetHistory: { balanceSheetStatements: [] }
  };
  const wl = { ticker: 'SYNTECH', isin: null };
  const out = PY.mapYahooToCanonical(yahoo, wl, '2026-05-16T00:00:00.000Z');
  // For Tech with null OpInc, annualOpInc stays empty and opIncSource is null.
  if (out.annual.annualOpInc.length !== 0) throw new Error('Tech sector must NOT trigger fallback; got ' + out.annual.annualOpInc.length + ' entries');
  if (out.meta.opIncSource !== null) throw new Error('expected opIncSource=null for Tech, got ' + out.meta.opIncSource);
});

// ─── Tag 204 — fcf-stability + operating-cashflow-coverage smoke tests ──
// DIAGNOSTIC methods, NOT in SCORE_WEIGHTS → fixture-hash invariant safe.

test('Tag 204 FCF-Stability: PASS case (stable FCF/Rev margins, CoV << 0.40)', () => {
  // MSFT-shape: FCF margins ~30% with low year-to-year dispersion.
  // FCF/Rev = 30/100, 28/95, 29/92, 27/88 → margins ~0.30, ~0.295, ~0.315, ~0.307
  // mean ≈ 0.304, σ small → CoV << 0.40.
  const s = { annual: {
    annualFCF: [{value:30},{value:28},{value:29},{value:27}],
    annualRev: [{value:100},{value:95},{value:92},{value:88}]
  }};
  const r = Runner.evaluateStock(s)['fcf-stability'];
  if (!r.computable) throw new Error('should be computable (4 clean pairs)');
  if (!r.pass) throw new Error('stable margins should pass, got CoV=' + r.value);
  if (r.value >= 0.40) throw new Error('expected CoV < 0.40, got ' + r.value);
});

test('Tag 204 FCF-Stability: FAIL case (lumpy FCF — one big year masking three weak ones)', () => {
  // Pattern: 3 marginally-positive years + 1 spike year → CoV blows past 0.40.
  // FCF/Rev = 40/100, 1/100, 2/100, 1/100 → margins 0.40, 0.01, 0.02, 0.01
  // mean = 0.11, σ ≈ 0.169 → CoV ≈ 1.54 → FAIL.
  const s = { annual: {
    annualFCF: [{value:40},{value:1},{value:2},{value:1}],
    annualRev: [{value:100},{value:100},{value:100},{value:100}]
  }};
  const r = Runner.evaluateStock(s)['fcf-stability'];
  if (!r.computable) throw new Error('should be computable');
  if (r.pass) throw new Error('lumpy FCF should fail, got CoV=' + r.value);
  if (r.value <= 0.40) throw new Error('expected CoV > 0.40, got ' + r.value);
});

test('Tag 204 OCF-Coverage: PASS case (3y mean OCF/NI = 1.10, above 0.80 floor)', () => {
  // MSFT-shape: OCF consistently exceeds NI thanks to D&A add-back.
  // OCF/NI = 110/100, 105/95, 99/90 → ~1.10, ~1.105, ~1.10 → mean ≈ 1.10.
  const s = { annual: {
    annualOCF:       [{value:110},{value:105},{value:99}],
    annualNetIncome: [{value:100},{value:95},{value:90}]
  }};
  const r = Runner.evaluateStock(s)['operating-cashflow-coverage'];
  if (!r.computable) throw new Error('should be computable (3 same-sign positive pairs)');
  if (!r.pass) throw new Error('should pass (mean ~1.10 >= 0.80), got ' + r.value);
  if (r.value < 0.80) throw new Error('expected mean >= 0.80, got ' + r.value);
});

test('Tag 204 OCF-Coverage: FAIL case (NI inflated, OCF lagging — 3y mean ~0.50)', () => {
  // Accrual-drift shape: company reports rising NI but cash collection trails.
  // OCF/NI = 50/100, 45/90, 40/80 → 0.50, 0.50, 0.50 → mean = 0.50 < 0.80.
  const s = { annual: {
    annualOCF:       [{value:50},{value:45},{value:40}],
    annualNetIncome: [{value:100},{value:90},{value:80}]
  }};
  const r = Runner.evaluateStock(s)['operating-cashflow-coverage'];
  if (!r.computable) throw new Error('should be computable');
  if (r.pass) throw new Error('mean 0.50 must fail 0.80 floor, got ' + r.value);
});

// ─── Tag 203 — score-history append + prune smoke tests ──────────────
// Exercise scripts/snapshot-score-history.js's pure logic (no fs needed).
// DIAGNOSTIC ONLY — does not affect fixture-hash (fixture_hash_invariant.md:
// only methods listed in SCORE_WEIGHTS feed the hash; snapshot-score-history
// is downstream of score-aggregator).
const SH = require('./scripts/snapshot-score-history.js');

test('Tag 203 score-history: append-and-prune is idempotent on same date', () => {
  // Two runs on the same date with different scores → second replaces first,
  // single entry stays. Mirrors the design §3 "drop today's entry if it
  // already exists (idempotent re-runs)" requirement.
  const hist = { ticker: 'FAKE', schemaVersion: SH.SCHEMA_VERSION, entries: [] };
  const e1 = { date: '2026-05-16', hgScore: 50, qcScore: 60, pbScore: 40, hgTier: 'STRONG', qcTier: 'STRONG', hgClass: null };
  const e2 = { date: '2026-05-16', hgScore: 55, qcScore: 65, pbScore: 45, hgTier: 'STRONG', qcTier: 'STRONG', hgClass: null };
  const after1 = SH.appendAndPrune(hist, e1);
  if (after1.entries.length !== 1) throw new Error('first append should produce 1 entry, got ' + after1.entries.length);
  const after2 = SH.appendAndPrune(after1, e2);
  if (after2.entries.length !== 1) throw new Error('same-date re-append should replace, got ' + after2.entries.length + ' entries');
  if (after2.entries[0].hgScore !== 55) throw new Error('expected latest entry to win (hgScore=55), got ' + after2.entries[0].hgScore);
});

test('Tag 203 score-history: prune keeps last 30 entries and stays sorted', () => {
  // Push 35 entries with descending-date order → after prune, only the
  // 30 most recent survive AND they're sorted ascending.
  let hist = { ticker: 'FAKE', schemaVersion: SH.SCHEMA_VERSION, entries: [] };
  // Generate 35 dates: i=1..30 → 2026-04-01..2026-04-30; i=31..35 → 2026-05-01..2026-05-05.
  for (let i = 35; i >= 1; i--) {
    const monthDay = i <= 30
      ? '2026-04-' + (i < 10 ? '0' + i : i)
      : '2026-05-' + ((i - 30) < 10 ? '0' + (i - 30) : (i - 30));
    hist = SH.appendAndPrune(hist, { date: monthDay, hgScore: i, qcScore: null, pbScore: null, hgTier: null, qcTier: null, hgClass: null });
  }
  if (hist.entries.length !== SH.MAX_ENTRIES) throw new Error('expected ' + SH.MAX_ENTRIES + ' entries after prune, got ' + hist.entries.length);
  // Verify ascending sort
  for (let i = 1; i < hist.entries.length; i++) {
    if (hist.entries[i].date < hist.entries[i-1].date) {
      throw new Error('entries should be sorted ascending; failed at index ' + i + ' (' + hist.entries[i-1].date + ' > ' + hist.entries[i].date + ')');
    }
  }
  // Verify oldest entry is gone (we pushed Apr-01..Apr-30 then May-01..May-05;
  // last 30 should start no earlier than Apr-06).
  if (hist.entries[0].date < '2026-04-06') {
    throw new Error('prune did not drop oldest entries; oldest=' + hist.entries[0].date);
  }
});

// ─── Tag 209a — gross-profitability (Novy-Marx GP/TA) smoke tests ──────
// DIAGNOSTIC method, NOT in SCORE_WEIGHTS → fixture-hash invariant safe.
// Citation: Novy-Marx & Medhat 2025 (SSRN 5190788) — GP/TA >= 0.20 floor.

test('Tag 209a Gross-Profitability: PASS case (GP=70, TA=100 → ratio 0.70, >= 0.20)', () => {
  const s = { annual: {
    annualGP:      [{value:70}],
    annualBalance: [{ totalAssets: 100, totalCash: 0, totalDebt: 0 }]
  }};
  const r = Runner.evaluateStock(s)['gross-profitability'];
  if (!r.computable) throw new Error('should be computable (gp + ta present)');
  if (!approx(r.value, 0.70)) throw new Error('expected ratio=0.70, got ' + r.value);
  if (!r.pass) throw new Error('0.70 must pass the 0.20 floor, got pass=' + r.pass);
  if (r.components.gp !== 70 || r.components.totalAssets !== 100) {
    throw new Error('components mismatch: ' + JSON.stringify(r.components));
  }
});

test('Tag 209a Gross-Profitability: FAIL case (GP=10, TA=100 → ratio 0.10, < 0.20)', () => {
  const s = { annual: {
    annualGP:      [{value:10}],
    annualBalance: [{ totalAssets: 100, totalCash: 0, totalDebt: 0 }]
  }};
  const r = Runner.evaluateStock(s)['gross-profitability'];
  if (!r.computable) throw new Error('should be computable');
  if (!approx(r.value, 0.10)) throw new Error('expected ratio=0.10, got ' + r.value);
  if (r.pass) throw new Error('0.10 must fail the 0.20 floor, got pass=' + r.pass);
});

// ─── Tag 134 — Phase 5.4: Fixture-Hash Golden Test ────────────────────
// Pre-pull guard against silent behavior changes in score-aggregator.
// Re-evaluates a fixed synthetic stock and asserts the SHA256 hash of the
// output is stable. If a method's behavior changes intentionally, regen the
// hash with ALLOW_FIXTURE_CHANGE=1 node tag28-tests.js (writes new hash to disk).
const crypto = require('crypto');
const SM = require('./methods/strategy-modes.js');
const FIXTURE_HASH_PATH = require('path').join(__dirname, 'tests', 'fixture-hash.txt');

function _fixtureStock() {
  // Synthetic A-grade HG candidate. Deterministic. Currency-coherent (USD).
  return {
    meta: { ticker: 'FIXTURE', name: 'Fixture Co.', sector: 'Technology', industry: 'Software', region: 'US',
            reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', fxRateApplied: 1.0 },
    marketCap: { value: 50e9 },
    metrics: {
      revenueTTM: { value: 10e9 },
      revenueGrowthYoY: { value: 38 },
      grossMargin: { value: 72 },
      operatingMargin: { value: 25 },
      fcfMarginTTM: { value: 22 },
      pe: { value: 35 }
    },
    annual: {
      annualRev: [{ value: 10e9 }, { value: 7.2e9 }, { value: 5.2e9 }, { value: 3.8e9 }],
      annualOpInc: [{ value: 2.5e9 }, { value: 1.6e9 }, { value: 1.0e9 }],
      annualNetIncome: [{ value: 2.0e9 }, { value: 1.3e9 }, { value: 0.7e9 }],
      annualGP: [{ value: 7.2e9 }, { value: 5.0e9 }, { value: 3.5e9 }],
      annualFCF: [{ value: 2.2e9 }, { value: 1.4e9 }],
      annualBalance: [{ totalCash: 5e9, totalDebt: 2e9, totalAssets: 30e9 }, { totalCash: 4e9, totalDebt: 2e9, totalAssets: 25e9 }],
      annualSBC: [{ value: 0.5e9 }, { value: 0.4e9 }],
      annualCapex: [{ value: 0.3e9 }, { value: 0.2e9 }]
    },
    timeseries: {
      revenueQ: [{ value: 2.6e9 }, { value: 2.5e9 }, { value: 2.5e9 }, { value: 2.4e9 }],
      opIncQ: [{ value: 0.65e9 }, { value: 0.6e9 }, { value: 0.6e9 }, { value: 0.55e9 }],
      grossProfitQ: [{ value: 1.9e9 }, { value: 1.8e9 }],
      netIncomeQ: [{ value: 0.5e9 }, { value: 0.5e9 }]
    },
    _quality: { grade: 'A', nanRatio: 0.0 }
  };
}

function _computeFixtureHash() {
  const stock = _fixtureStock();
  const results = Runner.evaluateStock(stock);
  const evHG = SM.evaluateMode(stock, 'HYPERGROWTH', results);
  const evQC = SM.evaluateMode(stock, 'QUALITY_COMPOUNDER', results);
  // Project to a deterministic subset: per-method pass + scoreBreakdown keys.
  // Drop noisy floats by rounding to 4 decimals; drop messages.
  const project = (ev) => ({
    passed: ev.passed,
    mustPassCount: ev.mustPassCount,
    mustTotal: ev.mustTotal,
    tier: ev.tier,
    score: ev.score,
    breakdown: Object.fromEntries(Object.entries(ev.scoreBreakdown || {}).map(([k, v]) => [k, {
      pass: v.pass, weight: v.weight, computable: v.computable,
      score: v.score != null ? Math.round(v.score * 10000) / 10000 : null
    }]))
  });
  const projection = { HG: project(evHG), QC: project(evQC) };
  return crypto.createHash('sha256').update(JSON.stringify(projection)).digest('hex').slice(0, 16);
}

test('fixture-hash: score-aggregator output is stable', () => {
  const fs = require('fs');
  const path = require('path');
  const computed = _computeFixtureHash();
  if (process.env.ALLOW_FIXTURE_CHANGE === '1') {
    if (!fs.existsSync(path.dirname(FIXTURE_HASH_PATH))) fs.mkdirSync(path.dirname(FIXTURE_HASH_PATH), { recursive: true });
    fs.writeFileSync(FIXTURE_HASH_PATH, computed + '\n');
    console.log('  ALLOW_FIXTURE_CHANGE=1 — wrote new hash ' + computed);
    return;
  }
  if (!fs.existsSync(FIXTURE_HASH_PATH)) {
    if (!fs.existsSync(path.dirname(FIXTURE_HASH_PATH))) fs.mkdirSync(path.dirname(FIXTURE_HASH_PATH), { recursive: true });
    fs.writeFileSync(FIXTURE_HASH_PATH, computed + '\n');
    console.log('  no prior fixture-hash — wrote initial ' + computed);
    return;
  }
  const stored = fs.readFileSync(FIXTURE_HASH_PATH, 'utf8').trim();
  if (stored !== computed) {
    throw new Error('fixture-hash mismatch: stored=' + stored + ' computed=' + computed +
      '\n   If intentional, re-run with ALLOW_FIXTURE_CHANGE=1 to update tests/fixture-hash.txt.');
  }
});

console.log('---------------------------');
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
