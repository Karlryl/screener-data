'use strict';
// P47 (06.10.2026): AEON Financial 8570.T and Okasan 8609.T showed one annual revenue from the
// non-consolidated statement (個別経営成績) instead of the consolidated one (連結経営成績).
// Memory-only fixtures with the real frozen 03.10. vendor values (m JPY, all four years); no live file is written.
const assert = require('assert/strict');
const { applyFinancialCases, table } = require('../lib/financial-known-cases.js');
const value = x => typeof x === 'number' ? x : x?.value;
const clone = structuredClone;
const CASES = {
  '8570.T': { fx: 0.0063445335, ends: ['2026-02-28', '2025-02-28', '2024-02-29', '2023-02-28'],
    vendor: [569370e6, 181699e6, 485608e6, 451767e6], shown: [569370e6, 533262e6, 485608e6, 451767e6] },
  '8609.T': { fx: 0.006335931, ends: ['2026-03-31', '2025-03-31', '2024-03-31', '2023-03-31'],
    vendor: [11058e6, 81936e6, 84509e6, 66551e6], shown: [95595e6, 81936e6, 84509e6, 66551e6] },
};
function fixture(ticker) {
  const c = CASES[ticker];
  return { meta: { ticker, source: 'yahoo', reportingCurrency: 'USD', reportingCurrencyOriginal: 'JPY', fxConverted: true, fxRateApplied: c.fx },
    annual: { annualRev: c.vendor.map(n => ({ value: n * c.fx })), annualRevEnds: c.ends.slice() }, timeseries: {} };
}
let passed = 0, breaks = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok ' + name); };
const guard = (ticker, snap) => assert.deepEqual(snap.annual.annualRev.map(value),
  CASES[ticker].shown.map(n => n == null ? null : n * CASES[ticker].fx), ticker + ': consolidated values shown, non-consolidated never');

test('eight sourced cases: two replacements, six confirmations, consolidated page-1 quotes', () => {
  const own = table.cases.filter(c => /^(aeon|okasan)-/.test(c.caseId));
  assert.equal(own.length, 8);
  for (const c of own) {
    assert.equal(c.page ?? c.sources[0].page, 1); assert.equal(c.currency, 'JPY'); assert.equal(c.sources[0].value, c.replacementValue);
    assert.ok(c.sources[0].quote.length > 0 && /連結経営成績/.test(c.sources[0].title));
  }
  assert.deepEqual(own.filter(c => c.expectedBadValue !== c.replacementValue).map(c => c.caseId).sort(),
    ['aeon-2025-02-28-annualRev', 'okasan-2026-03-31-annualRev']);
});
test('frozen input: consolidated values shown in all four years, nothing withheld, idempotent', () => {
  for (const t of Object.keys(CASES)) {
    const r = applyFinancialCases(fixture(t)); guard(t, r.snapshot);
    assert.ok(r.snapshot.annual.annualRev.every(x => !x.financialMissing));
    assert.deepEqual(applyFinancialCases(r.snapshot).snapshot, r.snapshot);
  }
});
test('break once: the vendor non-consolidated value returns -> guard red; without the case -> guard red', () => {
  for (const t of Object.keys(CASES)) {
    const good = applyFinancialCases(fixture(t)).snapshot; guard(t, good);
    const i = t === '8570.T' ? 1 : 0;
    const bad = clone(good); bad.annual.annualRev[i] = { value: CASES[t].vendor[i] * CASES[t].fx };
    assert.throws(() => guard(t, bad), assert.AssertionError); breaks++;
    const cfg = clone(table); cfg.cases = cfg.cases.filter(c => !(c.ticker === t && c.expectedBadValue !== c.replacementValue));
    assert.throws(() => guard(t, applyFinancialCases(fixture(t), { table: cfg }).snapshot), assert.AssertionError); breaks++;
  }
});
test('a new vendor year in front withholds the whole series (P50 rule)', () => {
  for (const t of Object.keys(CASES)) {
    const raw = fixture(t); raw.annual.annualRev.unshift({ value: 1 }); raw.annual.annualRevEnds.unshift('2027-03-31');
    assert.ok(applyFinancialCases(raw).snapshot.annual.annualRev.every(x => value(x) == null));
  }
});
console.log(`hand-table-p47-20261006: ${passed} passed; ${breaks} red probes caught`);
