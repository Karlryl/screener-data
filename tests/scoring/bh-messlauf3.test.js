'use strict';
/**
 * Messlauf 3 (Karl-Entscheid E-20260719-4, echte Zufallsstichprobe fuer
 * BH-014). Hermetische Tests fuer scripts/probe-smallcap-messlauf3.js:
 * reine Sampling-/Vergleichs-Funktionen mit inline Fixtures, kein Netz.
 * Prueft ausserdem per Quelltext-Invariante, dass scripts/probe-smallcap-
 * coverage.js weiterhin alle Symbole exportiert, die der schlanke Runner
 * wiederverwendet (Vertrags-Guard gegen stillen Export-Verlust).
 *
 * Standalone-Runner: node tests/scoring/bh-messlauf3.test.js (Exit 0/1).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const M3_SCRIPT = path.join(ROOT, 'scripts', 'probe-smallcap-messlauf3.js');
const M2_SCRIPT = path.join(ROOT, 'scripts', 'probe-smallcap-coverage.js');
const m3 = require(M3_SCRIPT);
const m2 = require(M2_SCRIPT);
const M3_SOURCE = fs.readFileSync(M3_SCRIPT, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e.message)); }
}

// --- wilsonCI: cross-check against an independent re-implementation of the
// textbook Wilson score interval, not against hand-rounded decimals. ---
function referenceWilson(successes, total) {
  if (!total) return { low: 0, high: 0 };
  const z = 1.959963984540054;
  const p = successes / total;
  const denom = 1 + z * z / total;
  const centre = p + z * z / (2 * total);
  const spread = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total));
  return { low: Math.max(0, (centre - spread) / denom) * 100, high: Math.min(100, (centre + spread) / denom) * 100 };
}

test('wilsonCI matches an independent formula re-implementation (n=100, several proportions)', () => {
  for (const successes of [0, 1, 50, 97, 100]) {
    const got = m3.wilsonCI(successes, 100);
    const want = referenceWilson(successes, 100);
    assert.ok(Math.abs(got.low - want.low) < 1e-6, `low mismatch @ ${successes}/100: ${got.low} vs ${want.low}`);
    assert.ok(Math.abs(got.high - want.high) < 1e-6, `high mismatch @ ${successes}/100: ${got.high} vs ${want.high}`);
  }
});

test('wilsonCI: bounds stay within [0,100] and bracket the point estimate', () => {
  const ci = m3.wilsonCI(30, 40);
  assert.ok(ci.low >= 0 && ci.high <= 100, 'CI must stay within [0,100]');
  assert.ok(ci.low <= 75 && ci.high >= 75, 'CI must bracket the point estimate (30/40=75%)');
});

test('wilsonCI: zero successes still yields a nonzero upper bound (rule-of-three-like behaviour)', () => {
  const ci = m3.wilsonCI(0, 20);
  assert.equal(ci.low, 0);
  assert.ok(ci.high > 0, 'a 0/20 draw does not prove the true rate is exactly 0');
});

test('wilsonCI: empty sample (total=0) returns [0,0] without dividing by zero', () => {
  assert.deepEqual(m3.wilsonCI(0, 0), { low: 0, high: 0 });
});

// --- coverageWithComparison: n/total/pct + delta + CI-overlap flag ---
function axesFixture(companies) {
  // companies: array of {ticker, yahoo: {axisId: bool}}
  return companies.map(c => ({ ticker: c.ticker, axes: { yahoo: c.yahoo || {}, xbrl: c.xbrl || {} } }));
}

test('coverageWithComparison: n/total/pct and delta are computed against the Messlauf-2 row', () => {
  const companies = axesFixture([
    { ticker: 'A', yahoo: { revGrowthLevel: true } },
    { ticker: 'B', yahoo: { revGrowthLevel: true } },
    { ticker: 'C', yahoo: { revGrowthLevel: false } },
    { ticker: 'D', yahoo: { revGrowthLevel: false } }
  ]);
  const m2Rows = [{ id: 'revGrowthLevel', label: 'x', n: 97, total: 100, pct: 97 }];
  const rows = m3.coverageWithComparison(companies, 'yahoo', m2Rows);
  const row = rows.find(r => r.id === 'revGrowthLevel');
  assert.equal(row.n, 2);
  assert.equal(row.total, 4);
  assert.equal(row.pct, 50);
  assert.equal(row.messlauf2N, 97);
  assert.equal(row.deltaPercentagePoints, -47);
});

test('coverageWithComparison: ciOverlap95 is false for a stark, non-overlapping gap and true for identical rates', () => {
  const companiesLow = axesFixture(Array.from({ length: 100 }, (_, i) => ({ ticker: 'T' + i, yahoo: { dilution: false } })));
  const m2RowsHigh = [{ id: 'dilution', label: 'x', n: 98, total: 100, pct: 98 }];
  const gapRow = m3.coverageWithComparison(companiesLow, 'yahoo', m2RowsHigh).find(r => r.id === 'dilution');
  assert.equal(gapRow.n, 0);
  assert.equal(gapRow.ciOverlap95, false, '0/100 vs 98/100 must not overlap at 95%');

  const companiesSame = axesFixture(Array.from({ length: 100 }, (_, i) => ({ ticker: 'T' + i, yahoo: { dilution: i < 98 } })));
  const m2RowsSame = [{ id: 'dilution', label: 'x', n: 98, total: 100, pct: 98 }];
  const sameRow = m3.coverageWithComparison(companiesSame, 'yahoo', m2RowsSame).find(r => r.id === 'dilution');
  assert.equal(sameRow.ciOverlap95, true, 'identical 98/100 vs 98/100 must overlap');
});

test('coverageWithComparison: a Messlauf-2 axis missing from m2Rows degrades to nulls instead of throwing', () => {
  const companies = axesFixture([{ ticker: 'A', yahoo: { gpGrowth: true } }]);
  const rows = m3.coverageWithComparison(companies, 'yahoo', []);
  const row = rows.find(r => r.id === 'gpGrowth');
  assert.equal(row.messlauf2N, null);
  assert.equal(row.deltaPercentagePoints, null);
  assert.equal(row.ciOverlap95, null);
});

// --- combinedCoverage: union of Yahoo OR XBRL per axis ---
test('combinedCoverage: a company covered by XBRL only (not Yahoo) still counts toward the union', () => {
  const companies = axesFixture([
    { ticker: 'A', yahoo: { capitalEfficiency: true }, xbrl: { capitalEfficiency: false } },
    { ticker: 'B', yahoo: { capitalEfficiency: false }, xbrl: { capitalEfficiency: true } },
    { ticker: 'C', yahoo: { capitalEfficiency: false }, xbrl: { capitalEfficiency: false } }
  ]);
  const rows = m3.combinedCoverage(companies, { capitalEfficiency: { n: 89, total: 100 } });
  const row = rows.find(r => r.id === 'capitalEfficiency');
  assert.equal(row.n, 2, 'A (Yahoo) and B (XBRL) both count; C counts toward neither');
  assert.equal(row.messlauf2Pct, 89);
});

// --- buildGoAssessment: verdict wording depends on whether any axis has a
// statistically significant, negative gap vs. Messlauf 2 ---
test('buildGoAssessment: HAELT when no axis has a significant drop', () => {
  const combined = [
    { id: 'revGrowthLevel', label: 'x', pct: 96, messlauf2Pct: 100, deltaPercentagePoints: -4, ciOverlap95: true },
    { id: 'dilution', label: 'x', pct: 99, messlauf2Pct: 99, deltaPercentagePoints: 0, ciOverlap95: true }
  ];
  const result = m3.buildGoAssessment(combined);
  assert.match(result.verdict, /^HAELT/);
});

test('buildGoAssessment: PRUEFEN and names the axis when a significant negative gap exists', () => {
  const combined = [
    { id: 'gpGrowth', label: 'x', pct: 40, messlauf2Pct: 75, deltaPercentagePoints: -35, ciOverlap95: false },
    { id: 'dilution', label: 'x', pct: 99, messlauf2Pct: 99, deltaPercentagePoints: 0, ciOverlap95: true }
  ];
  const result = m3.buildGoAssessment(combined);
  assert.match(result.verdict, /^PRUEFEN/);
  assert.ok(result.verdict.includes('gpGrowth'), 'the offending axis id must be named in the verdict');
});

test('buildGoAssessment: a non-overlapping but POSITIVE delta is not treated as a drop', () => {
  const combined = [
    { id: 'revAcceleration', label: 'x', pct: 100, messlauf2Pct: 60, deltaPercentagePoints: 40, ciOverlap95: false }
  ];
  const result = m3.buildGoAssessment(combined);
  assert.match(result.verdict, /^HAELT/, 'an improvement must not trigger PRUEFEN even if the CI does not overlap');
});

// --- m3FilterDefinitions: R1-R6 + DUP reused unchanged from Messlauf 2, plus one new MCAP rule ---
test('m3FilterDefinitions: extends Messlauf-2 filter defs with exactly one fail-closed MCAP rule', () => {
  const base = m2.m2FilterDefinitions();
  const extended = m3.m3FilterDefinitions();
  assert.equal(extended.length, base.length + 1);
  assert.deepEqual(extended.slice(0, base.length).map(f => f.id), base.map(f => f.id));
  const mcap = extended.find(f => f.id === 'MCAP');
  assert.ok(mcap, 'MCAP rule must be present');
  assert.equal(mcap.missing, 'fail-closed');
});

// --- issuerKeyOf: same normalization semantics as the inline helper in Messlauf 2 (Tag 315 P2 dedupe) ---
test('issuerKeyOf: share classes of the same issuer normalize to the same key', () => {
  const a = m3.issuerKeyOf({ longName: 'Kelly Services, Inc.' });
  const b = m3.issuerKeyOf({ shortName: 'KELLY SERVICES INC' });
  assert.equal(a, b);
});

test('issuerKeyOf: missing name fields do not throw and return an empty string', () => {
  assert.equal(m3.issuerKeyOf({}), '');
});

// --- buildRunHash: deterministic + sensitive to its input (same contract as M2's BH-019 hash) ---
test('buildRunHash is deterministic and sensitive to its input', () => {
  const a = m3.buildRunHash({ seed: 's', tickers: ['AAA', 'BBB'] });
  const b = m3.buildRunHash({ seed: 's', tickers: ['AAA', 'BBB'] });
  const c = m3.buildRunHash({ seed: 's', tickers: ['AAA', 'CCC'] });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{16}$/);
});

// --- require-safety: loading the module must not start a live network run ---
test('requiring the script does not auto-start a run (require.main guard present)', () => {
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(M3_SCRIPT)}); console.log('LOADED_OK');`],
    { encoding: 'utf8', timeout: 8000 });
  assert.equal(r.status, 0, 'require() must load cleanly without triggering a run: ' + (r.stderr || ''));
  assert.match(r.stdout, /LOADED_OK/);
});

// --- durability: report + checkpoint writes go through the atomic writer ---
test('report and checkpoint writes use writeFileAtomic, not a bare fs.writeFileSync', () => {
  assert.ok(!/fs\.writeFileSync\(REPORT_JSON/.test(M3_SOURCE));
  assert.ok(!/fs\.writeFileSync\(CHECKPOINT_FILE/.test(M3_SOURCE));
  for (const call of ['writeFileAtomic(REPORT_JSON', 'writeFileAtomic(REPORT_MD', 'writeFileAtomic(CHECKPOINT_FILE']) {
    assert.ok(M3_SOURCE.includes(call), `expected ${call} in the write path`);
  }
});

// --- reuse contract: probe-smallcap-coverage.js must keep exporting everything
// the lean Messlauf-3 runner depends on (guards against a silent export drop). ---
test('probe-smallcap-coverage.js still exports every symbol Messlauf 3 reuses', () => {
  const fns = ['fnv1a', 'unwrapYahooNumber', 'fetchSecJsonStrict', 'buildTickerCikMap',
    'fetchYahooSummaryM2', 'fetchYahooAxesM2', 'errText', 'm2FilterDefinitions', 'mdEscape',
    'filterOperatingCompanyM2', 'secDataFromCompanyFacts', 'axisSummary', 'fieldSummary'];
  for (const fn of fns) assert.equal(typeof m2[fn], 'function', `${fn} must stay exported`);
  assert.ok(Array.isArray(m2.AXES) && m2.AXES.length === 8, 'AXES must stay exported with all 8 axes');
  for (const num of ['MIN_MCAP', 'MAX_MCAP', 'SEC_DELAY_MS', 'YAHOO_DELAY_MS']) {
    assert.equal(typeof m2[num], 'number', `${num} must stay exported`);
  }
});

console.log('\nbh-messlauf3: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
