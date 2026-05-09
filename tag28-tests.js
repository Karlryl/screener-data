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

test('Sloan-Ratio: fail case (NI=20, FCF=0, Assets=100 -> 20% high accruals)', () => {
  const s = makeStock({}, { netIncome: [20], fcf: [0] }, [{ totalAssets: 100 }]);
  const r = Runner.evaluateStock(s)['sloan-ratio'];
  if (r.pass) throw new Error('should fail (20% > 10%)');
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

// Tag 97+98: 28 Methoden total (Tag 112: hypergrowth-quality-class neu) (Tag 107: rule-of-x neu)
test('Runner: getMethods returns 28 methods', () => {
  const methods = Runner.getMethods();
  assertEq(methods.length, 28);
  const ids = methods.map(m => m.id).sort();
  assertEq(ids, ['above-200d-ma','capex-trend','drawdown-52w','ev-ebitda','fcf-yield','forward-pe','gross-margin-stability','high-proximity-52w','hypergrowth-quality-class','insider-ownership','margin-decay','net-debt-ebitda','opinc-margin-spike','peg','profitability-state','profitability-trend','quarterly-earnings-stability','quarterly-rev-acceleration','revenue-growth-3y','revenue-shock-guard','roic','rule-of-40','rule-of-x','sbc-revenue','sloan-ratio','stable-quarterly-growth','volatility-annualized','working-capital-anomaly']);
});

test('Runner: evaluateStock handles thrown errors', () => {
  const r = Runner.evaluateStock(null);
  for (const k of Object.keys(r)) {
    if (r[k].computable) throw new Error(`${k} should be incomputable for null stock`);
  }
});

console.log('---------------------------');
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
