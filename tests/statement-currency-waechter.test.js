'use strict';
// Guard for the statement-currency hand table (2026-09-26).
//
// FINDING: Petrobras (PBR-A) and Embraer (EMBJ) file their statements in US dollars (SEC 6-K/20-F),
// but Yahoo's financialCurrency says BRL. The pull multiplied the USD statement series by the BRL
// rate again: EMBJ Q1-2026 revenue US$1,446.7M came out as US$284M (fxRateApplied 0.1963).
// Yahoo's financialData (revenueTTM, ebitda) IS in BRL, so only annual.*/timeseries.* change.
// Runs the REAL _convertSnapshotToUSD on synthetic snapshots in the real key shape:
//   presence - EMBJ-like row: statement series keep the USD value, revenueTTM still BRL-converted
//   absence  - a BRL reporter without a row, a USD-listed US company: unchanged behaviour;
//              row with financialCurrency missing / other currency / mismatch gone: no correction
const assert = require('assert');
const { _convertSnapshotToUSD } = require('../pull-yahoo.js');
const { loadStatementCurrencyTable, statementFactor, statementRowPending, PROVENANCE } = require('../lib/statement-currency-hand-table.js');

let ok = 0, fail = 0;
function pruefe(name, fn) {
  try { fn(); ok++; }
  catch (e) { fail++; console.error('FAIL ' + name + ': ' + (e && e.message)); }
}

// EMBJ raw figures from CI run 36227380588 (Yahoo units, before conversion).
function snap(ticker, reportingCurrency, tradingCurrency, annualRev, revenueTTM, extraMeta = {}) {
  return {
    meta: Object.assign({ ticker, reportingCurrency, tradingCurrency, ccyAmbiguous: false, exchangeName: 'NYSE' }, extraMeta),
    marketCap: { value: 14e9 },
    metrics: { revenueTTM: { value: revenueTTM } },
    annual: { annualRev: [{ value: annualRev }, { value: 6394.7e6 }], annualShares: [{ value: 178e6 }] },
    timeseries: { revenueQ: [{ value: 1446.7e6 }], revenueQEnds: ['2026-03-31'] },
  };
}
const close = (a, b) => Math.abs(a / b - 1) < 1e-9;

pruefe('presence: USD reporter listed/labelled BRL keeps its USD statement series', () => {
  const s = _convertSnapshotToUSD(snap('EMBJ', 'BRL', 'USD', 7577.5e6, 44128e6));
  const f = s.meta.fxRateApplied;
  assert.ok(f > 0.1 && f < 0.4, 'BRL factor expected, got ' + f);
  assert.strictEqual(s.timeseries.revenueQ[0].value, 1446.7e6, 'Q1-2026 revenue must stay US$1,446.7M');
  assert.strictEqual(s.annual.annualRev[0].value, 7577.5e6);
  assert.ok(close(s.metrics.revenueTTM.value, 44128e6 * f), 'revenueTTM (financialData, BRL) must still convert');
  assert.strictEqual(s.annual.annualShares[0].value, 178e6);
  assert.strictEqual(s.meta.statementCurrencySource, PROVENANCE);
  assert.strictEqual(s.meta.statementFxRateApplied, 1);
  assert.strictEqual(s.meta._statementCcyHandTableStale, undefined);
});

pruefe('absence: BRL reporter without a row converts every series with the BRL factor', () => {
  const s = _convertSnapshotToUSD(snap('ITUB4.SA', 'BRL', 'BRL', 7577.5e6, 44128e6));
  const f = s.meta.fxRateApplied;
  assert.ok(close(s.timeseries.revenueQ[0].value, 1446.7e6 * f));
  assert.ok(close(s.annual.annualRev[0].value, 7577.5e6 * f));
  assert.strictEqual(s.meta.statementCurrencySource, undefined);
});

pruefe('absence: USD-listed US company unchanged', () => {
  const s = _convertSnapshotToUSD(snap('MSFT', 'USD', 'USD', 7577.5e6, 7577.5e6));
  assert.strictEqual(s.timeseries.revenueQ[0].value, 1446.7e6);
  assert.strictEqual(s.annual.annualRev[0].value, 7577.5e6);
  assert.strictEqual(s.meta.fxRateApplied, 1);
  assert.strictEqual(s.meta.statementCurrencySource, undefined);
});

pruefe('absence: row whose Yahoo financialCurrency is missing never switches on', () => {
  const t = loadStatementCurrencyTable();
  const s = snap('EMBJ', 'BRL', 'USD', 7577.5e6, 44128e6, { ccyAmbiguous: true });
  const r = statementFactor(s, 'BRL', 0.2, t);
  assert.strictEqual(r.status, 'stale');
  assert.strictEqual(r.factor, 0.2);
});

pruefe('absence: row with another Yahoo currency or a vanished mismatch uses the reporting factor', () => {
  const eur = _convertSnapshotToUSD(snap('EMBJ', 'EUR', 'USD', 7577.5e6, 44128e6));
  assert.ok(close(eur.annual.annualRev[0].value, 7577.5e6 * eur.meta.fxRateApplied));
  assert.ok(/re-verify/.test(eur.meta._statementCcyHandTableStale));
  // Yahoo fixed: statements now BRL too (annual ~ TTM) -> row must not divide a second time.
  const fixed = _convertSnapshotToUSD(snap('PBR-A', 'BRL', 'USD', 548000e6, 548490e6));
  assert.ok(close(fixed.annual.annualRev[0].value, 548000e6 * fixed.meta.fxRateApplied));
  assert.ok(/no longer visible/.test(fixed.meta._statementCcyHandTableStale));
});

pruefe('row on a USD / missing financialCurrency: numbers unchanged, stale stamped, no endless re-pull', () => {
  const t = loadStatementCurrencyTable();
  for (const extra of [{ ccyAmbiguous: true }, {}]) {
    const s = _convertSnapshotToUSD(snap('EMBJ', 'USD', 'USD', 7577.5e6, 44128e6, extra));
    assert.strictEqual(s.annual.annualRev[0].value, 7577.5e6);
    assert.strictEqual(s.meta.statementCurrencySource, undefined);
    assert.ok(s.meta._statementCcyHandTableStale, 'USD-branch row must be stamped stale');
    assert.strictEqual(statementRowPending(s, t), false, 'USD-branch row would re-pull forever');
  }
});

pruefe('real table: proven rows load, unstamped row snapshot forces one re-pull', () => {
  const t = loadStatementCurrencyTable();
  for (const k of ['PBR-A', 'EMBJ']) assert.ok(t[k], 'row missing: ' + k);
  const before = snap('EMBJ', 'BRL', 'USD', 7577.5e6, 44128e6);
  before.meta.fxConverted = true;
  assert.strictEqual(statementRowPending(before, t), true);
  const after = _convertSnapshotToUSD(snap('EMBJ', 'BRL', 'USD', 7577.5e6, 44128e6));
  assert.strictEqual(statementRowPending(after, t), false);
  assert.strictEqual(statementRowPending(snap('ITUB4.SA', 'BRL', 'BRL', 1, 1), t), false);
});

console.log('statement-currency-waechter: ' + ok + ' ok, ' + fail + ' fail');
if (fail) process.exit(1);
