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

test('Net-Debt/EBITDA: fail case (debt=50, opInc=10 -> 50/12 = 4.17 > 3)', () => {
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
    'score-aggregator.js', 'strategy-modes.js', 'sector-medians-compute.js'
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

test('data-quality: fully-populated snapshot -> grade A', () => {
  const g = gradeSnapshot(fullSnapshot());
  if (g.grade !== 'A') throw new Error('expected A, got ' + g.grade + ' (missing=' + g.missingFields.join(',') + ')');
  if (g.nanRatio !== 0) throw new Error('expected nanRatio=0, got ' + g.nanRatio);
});

test('data-quality: 30%-missing snapshot -> grade C (not B)', () => {
  // Drop 4 of 10 critical-weight fields to push nanRatio to >0.30
  const s = fullSnapshot();
  delete s.meta.industry;
  delete s.metrics.fcfMarginTTM;
  delete s.metrics.operatingMargin;
  delete s.metrics.grossMargin;
  const g = gradeSnapshot(s);
  if (g.grade !== 'C') throw new Error('expected C, got ' + g.grade + ' (ratio=' + g.nanRatio + ' missing=' + g.missingFields.join(',') + ')');
});

test('data-quality: heavily-empty snapshot -> grade D', () => {
  const g = gradeSnapshot({ meta: { ticker: 'TEST' } });
  if (g.grade !== 'D') throw new Error('expected D, got ' + g.grade + ' (ratio=' + g.nanRatio + ')');
});

test('data-quality: tierCapForGrade A/B -> null, C -> NEAR_MISS, D -> REJECT', () => {
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
  // FCF-yield should be FCF/Mcap = 0.1 = 10% regardless of currency conversion.
  const twdRate = 0.031; // matches FX fallback
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
  const usdSnap = {
    meta: { ticker: 'TWIN', reportingCurrency: 'USD', region: 'US' },
    marketCap: { value: 1000e9 * twdRate },
    metrics: { revenueTTM: { value: 500e9 * twdRate } },
    annual: {
      annualFCF: [{ value: 100e9 * twdRate }, { value: 80e9 * twdRate }],
      annualRev: [{ value: 500e9 * twdRate }, { value: 420e9 * twdRate }],
      annualBalance: [{ totalCash: 50e9 * twdRate, totalDebt: 20e9 * twdRate, totalAssets: 800e9 * twdRate }]
    },
    timeseries: { revenueQ: [{ value: 130e9 * twdRate }] }
  };
  PY._convertSnapshotToUSD(twdSnap);
  PY._convertSnapshotToUSD(usdSnap);

  // After conversion both should have identical values.
  if (Math.abs(twdSnap.marketCap.value - usdSnap.marketCap.value) > 1) {
    throw new Error('mcap differs: TWD=' + twdSnap.marketCap.value + ' USD=' + usdSnap.marketCap.value);
  }
  if (Math.abs(twdSnap.annual.annualFCF[0].value - usdSnap.annual.annualFCF[0].value) > 1) {
    throw new Error('annualFCF differs after conversion');
  }
  // FCF-yield must be currency-invariant (was the broken case).
  const twdYield = twdSnap.annual.annualFCF[0].value / twdSnap.marketCap.value;
  const usdYield = usdSnap.annual.annualFCF[0].value / usdSnap.marketCap.value;
  if (Math.abs(twdYield - usdYield) > 1e-6) {
    throw new Error('fcf-yield differs: TWD=' + twdYield.toFixed(5) + ' USD=' + usdYield.toFixed(5));
  }
  // And it should equal the raw TWD ratio (which is currency-invariant by construction).
  if (Math.abs(twdYield - 0.1) > 1e-6) {
    throw new Error('fcf-yield should be 10%, got ' + (twdYield * 100).toFixed(2) + '%');
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

test('walk-forward: evaluateVintage computes alpha vs universe-median', () => {
  // Use dates well in the past so 7d/28d/84d horizons resolve, not "too-early"
  const hist = {
    AAPL: [{ date: '2025-01-01', close: 100 }, { date: '2025-01-08', close: 130 }, { date: '2025-04-01', close: 150 }], // +30% at 7d
    MSFT: [{ date: '2025-01-01', close: 200 }, { date: '2025-01-08', close: 260 }, { date: '2025-04-01', close: 300 }], // +30% at 7d
    XYZ:  [{ date: '2025-01-01', close: 50 },  { date: '2025-01-08', close: 50 },  { date: '2025-04-01', close: 50 }]   //   0%
  };
  const picks = {
    asOf: '2025-01-01T00:00:00Z',
    modes: { HYPERGROWTH: [{ ticker: 'AAPL' }, { ticker: 'MSFT' }] }
  };
  const ev = WF.evaluateVintage(picks, hist);
  const h7 = ev.modes.HYPERGROWTH.horizons['7d'];
  if (h7.status !== 'ok') throw new Error('expected ok, got ' + h7.status);
  if (Math.round(h7.pickMedianReturn) !== 30) throw new Error('pick median 30% expected, got ' + h7.pickMedianReturn);
  // universe median across all 3 tickers' 7d returns = median(30, 30, 0) = 30
  if (Math.round(h7.universeMedianReturn) !== 30) throw new Error('universe median 30% expected, got ' + h7.universeMedianReturn);
  if (Math.abs(h7.alpha) > 0.01) throw new Error('alpha ~0 expected (picks tied with universe), got ' + h7.alpha);
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
