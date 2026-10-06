'use strict';
// P106: annual revenue growth that spans two fiscal years (vendor lacks the middle year) is withheld
// by the financial hand table, with its reason; the newest year stays; unrelated tickers are untouched;
// once the vendor delivers the missing year, the adjacent pair is used again without a table change.
// Fixture values = stored USD values of the frozen 06.10.2026 snapshots (run 37439518589), embedded here.
const test = require('node:test'), assert = require('node:assert/strict');
const { applyFinancialCases, table, validateTable } = require('../lib/financial-known-cases.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const value = row => (row && typeof row === 'object') ? row.value : row;

const snap = (ticker, ccy, fx, ends, stored) => ({
  meta: { ticker, reportingCurrency: 'USD', reportingCurrencyOriginal: ccy, fxRateApplied: fx, fxConverted: true },
  annual: { annualRev: stored.map(v => ({ value: v })), annualRevEnds: ends.slice() },
  timeseries: { revenueQ: [], revenueQEnds: [] },
});
const CASES = [
  ['OBM.AX', 'AUD', 0.69439626, ['2026-06-30', '2024-06-30', '2023-06-30', '2022-06-30'],
    [560724285.55374, 148764677.15736, 94360118.97888, 107118261.46386], 276.9],
  ['CMM.AX', 'AUD', 0.69439626, ['2026-06-30', '2024-06-30', '2023-06-30', '2022-06-30'],
    [493966417.90986, 249793083.42102, 222725517.20622, 199255618.01448], 97.8],
  ['3391.T', 'JPY', 0.0063445335, ['2026-02-28', '2024-05-31', '2023-05-31', '2022-05-31'],
    [9203285127.0975, 6518767078.977, 6154698713.1465, 5809689325.95], 41.2],
];

test('the table carries exactly the three non-adjacent-year holds plus the latent Tsuruha short-year hold and validates', () => {
  validateTable(table);
  const ids = table.cases.filter(c => /-nonadjacent$/.test(c.caseId)).map(c => c.ticker).sort();
  assert.deepEqual(ids, ['3391.T', 'CMM.AX', 'OBM.AX']);
  for (const c of table.cases.filter(c => /-nonadjacent$/.test(c.caseId))) {
    assert.equal(c.field, 'annualRev'); assert.equal(c.index, 1); assert.equal(c.replacementValue, null);
    assert.match(c.reason, /^Ältere Jahresumsätze zurückgehalten: /);
  }
  const short = table.cases.filter(c => /-shortyear$/.test(c.caseId));
  assert.deepEqual(short.map(c => [c.ticker, c.period, c.expectedBadValue, c.replacementValue]), [['3391.T', '2025-02-28', 845603000000, null]]);
});

for (const [ticker, ccy, fx, ends, stored, shown] of CASES) {
  test(ticker + ': two-year growth is shown without the table and withheld with its reason with it', () => {
    const raw = snap(ticker, ccy, fx, ends, stored);
    // Precondition: the vendor pair really spans two fiscal years and gives the wrong figure.
    const before = revGrowthLeg(raw);
    assert.equal(before.basis, 'year'); assert.equal(Math.round(before.pct * 10) / 10, shown);
    const { snapshot: out, events } = applyFinancialCases(raw);
    assert.equal(value(out.annual.annualRev[0]), stored[0], 'newest year stays');
    for (const i of [1, 2, 3]) {
      assert.equal(value(out.annual.annualRev[i]), null, 'older year ' + i + ' withheld');
      const marker = out.annual.annualRev[i].financialCorrection || out.annual.annualRev[i].financialMissing;
      assert.ok(marker && /-nonadjacent$/.test(marker.caseId), 'marker names the case');
    }
    assert.ok(events.some(e => e.status === 'missing' && e.index === 1 && /-nonadjacent$/.test(e.caseId)));
    const after = revGrowthLeg(out);
    assert.equal(after.basis, 'none'); assert.equal(after.pct, null);
    assert.equal(JSON.stringify(raw), JSON.stringify(snap(ticker, ccy, fx, ends, stored)), 'input not mutated');
  });

  if (ticker === '3391.T') {
    // Review D15 (M1): the delivered 2025-02-28 period is a 9.5-month short year (845,603 mn JPY); growth against it
    // would be +71.5 % and is no annual growth, so it stays empty; a different vendor value fails closed.
    test(ticker + ': a delivered 9.5-month short year never yields an annual growth', () => {
      const shortStored = 845603000000 * 0.0063445335;
      const raw = snap(ticker, ccy, fx, [ends[0], '2025-02-28', ...ends.slice(1)], [stored[0], shortStored, ...stored.slice(1)]);
      assert.equal(Math.round(revGrowthLeg(raw).pct * 10) / 10, 71.5, 'precondition: the unguarded pair would show +71.5 %');
      const { snapshot: out } = applyFinancialCases(raw);
      assert.equal(value(out.annual.annualRev[0]), stored[0]);
      for (const i of [1, 2, 3, 4]) assert.equal(value(out.annual.annualRev[i]), null, 'cell ' + i);
      assert.equal(revGrowthLeg(out).basis, 'none');
      const other = snap(ticker, ccy, fx, [ends[0], '2025-02-28', ...ends.slice(1)], [stored[0], shortStored + 1, ...stored.slice(1)]);
      assert.ok(applyFinancialCases(other).snapshot.annual.annualRev.every(r => value(r) === null), 'changed vendor value fails closed');
    });
    continue;
  }
  test(ticker + ': when the vendor delivers the missing year, the adjacent pair returns', () => {
    const missingEnd = '2025-06-30';
    const missingStored = { 'OBM.AX': 404292000 * 0.69439626, 'CMM.AX': 505892000 * 0.69439626 }[ticker];
    const raw = snap(ticker, ccy, fx, [ends[0], missingEnd, ...ends.slice(1)], [stored[0], missingStored, ...stored.slice(1)]);
    const { snapshot: out } = applyFinancialCases(raw);
    assert.equal(value(out.annual.annualRev[1]), missingStored, 'delivered middle year stays');
    assert.equal(value(out.annual.annualRev[2]), null, 'old non-adjacent partner still withheld');
    const leg = revGrowthLeg(out);
    assert.equal(leg.basis, 'year'); assert.equal(leg.periodEnd, ends[0]); assert.equal(leg.priorPeriodEnd, missingEnd);
  });
}

test('an unrelated ticker with the same series is untouched', () => {
  const raw = snap('ZZZ.AX', 'AUD', 0.69439626, CASES[0][3], CASES[0][4]);
  assert.equal(applyFinancialCases(raw).snapshot, raw);
});
