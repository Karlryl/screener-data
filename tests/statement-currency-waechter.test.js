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
//              row with financialCurrency missing / other currency / mismatch gone: no correction, values withheld
// D3/B4: Vale/YPF are USD in both series; MODEC is USD annually but JPY quarterly.
// This guard writes no files; break-once mutations belong in an isolated in-memory table.
const assert = require('assert');
const fs = require('fs');
const { _convertSnapshotToUSD } = require('../pull-yahoo.js');
const { loadStatementCurrencyTable, statementFactor, statementRowPending, HOLD_REASON, PROVENANCE, TABLE_PATH } = require('../lib/statement-currency-hand-table.js');
const { financialReasons } = require('../lib/financial-known-cases.js');
// P251: convert with the pinned rates of tests/fixtures/fx/, not with whatever the live fx-rates.json says
// (a stale or missing file drops ARS and falls back to the hard-coded table; the daily pull that refreshes
// the file runs after this blocking test).
const { pinFx, PINNED_RATES } = require('./fixtures/fx/pin-fx.js');
pinFx();

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
const heldOk = (cell, period, raw) => {
  assert.strictEqual(cell.value, null, 'statement value must be withheld, got ' + JSON.stringify(cell));
  assert.strictEqual(cell.financialMissing.rule, 'statement-currency-unverified');
  assert.strictEqual(cell.financialMissing.period, period);
  assert.strictEqual(cell.financialMissing.reason, period ? HOLD_REASON : HOLD_REASON + ' Das Periodenende ist unbekannt.');
  assert.deepStrictEqual(cell.financialMissing.originalVendorRow, raw, 'raw vendor row kept for the audit');
};

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

// The pinned table makes the factor exact; without this the checks above only compare the converter
// with its own fxRateApplied, so a wrong factor that is recorded consistently would stay green.
for (const currency of ['BRL', 'ARS', 'JPY', 'EUR']) {
  pruefe('pinned rate: a ' + currency + ' reporter without a row converts with exactly the pinned ' + currency + ' rate', () => {
    const s = _convertSnapshotToUSD(snap('NOROW-' + currency, currency, currency, 7577.5e6, 44128e6));
    assert.strictEqual(s.meta.fxRateApplied, PINNED_RATES[currency]);
    assert.ok(close(s.annual.annualRev[0].value, 7577.5e6 * PINNED_RATES[currency]));
    assert.ok(close(s.timeseries.revenueQ[0].value, 1446.7e6 * PINNED_RATES[currency]));
    assert.ok(close(s.metrics.revenueTTM.value, 44128e6 * PINNED_RATES[currency]));
  });
}

// Raw values recovered from CI run 36227380588, checked against issuer filings in D3.
for (const [ticker, currency, listing, annual, ttm, quarter] of [
  ['VALE3.SA', 'BRL', 'BRL', 38403e6, 218068992000, 10498e6],
  ['XVALO.MC', 'BRL', 'EUR', 38403e6, 218068992000, 9258e6],
  ['YPF', 'ARS', 'USD', 18284e6, 29234837848064, 4943e6],
  ['YPFD.BA', 'ARS', 'ARS', 18284e6, 29234837848064, 6574e6],
]) {
  pruefe('presence: ' + ticker + ' keeps annual and quarterly USD statements', () => {
    const raw = snap(ticker, currency, listing, annual, ttm);
    raw.timeseries.revenueQ[0].value = quarter;
    const s = _convertSnapshotToUSD(raw);
    assert.strictEqual(s.annual.annualRev[0].value, annual, 'annual revenue must stay USD');
    assert.strictEqual(s.timeseries.revenueQ[0].value, quarter, 'quarterly revenue must stay USD');
    assert.ok(close(s.metrics.revenueTTM.value, ttm * s.meta.fxRateApplied));
    assert.strictEqual(s.meta.statementCurrencySource, PROVENANCE);
    assert.strictEqual(s.meta.statementCurrencySeries, undefined, 'omitted series must retain all-series scope');
    assert.strictEqual(statementRowPending(s, loadStatementCurrencyTable()), false);
  });
}

pruefe('presence: MODEC retains annual USD statements and withholds quarterly revenue per council F5', () => {
  const raw = snap('6269.T', 'JPY', 'JPY', 4581232e3, 814098022400);
  raw.annual.annualOCF = [{ value: 350e6 }, null, -10e6];
  raw.annual.annualBalance = [{ totalAssets: 8000e6, totalCash: 500e6 }];
  raw.timeseries.revenueQ = [{ value: 225152e6 }, { value: 172224e6 }];
  raw.timeseries.revenueQEnds = ['2026-06-30', '2026-03-31'];
  raw.timeseries.ocfQ = [{ value: 20e9 }, null, -2e9];
  const s = _convertSnapshotToUSD(structuredClone(raw));
  const f = s.meta.fxRateApplied;
  assert.ok(f > 0 && f < 0.02, 'JPY factor expected');
  assert.deepStrictEqual(s.annual, raw.annual, 'all annual USD amounts and share counts must stay unchanged');
  // RATSBLOCK-2026-10-06 F5: JPY-derived quarters remain empty until reporting-currency quarters exist.
  assert.strictEqual(s.timeseries.revenueQ[0].value, null);
  assert.strictEqual(s.timeseries.revenueQ[1].value, null);
  assert.match(s.timeseries.revenueQ[0].financialCorrection.reason, /Ratsbeschluss F5/);
  assert.match(s.timeseries.revenueQ[1].financialCorrection.reason, /Ratsbeschluss F5/);
  assert.deepStrictEqual(s.timeseries.ocfQ, [{ value: 20e9 * f }, null, -2e9 * f]);
  assert.deepStrictEqual(s.timeseries.revenueQEnds, raw.timeseries.revenueQEnds);
  assert.ok(close(s.metrics.revenueTTM.value, 814098022400 * f));
  assert.strictEqual(s.meta.statementCurrencySource, PROVENANCE);
  assert.strictEqual(s.meta.statementFxRateApplied, 1);
  assert.strictEqual(s.meta.statementCurrencySeries, 'annual');
  assert.strictEqual(statementRowPending(s, loadStatementCurrencyTable()), false);
  assert.deepStrictEqual(_convertSnapshotToUSD(structuredClone(s)), s, 'conversion must remain idempotent');
});

pruefe('absence: D3 NOT_A_CASE Pop Mart retains CNY conversion despite the suspicious ratio', () => {
  const raw = snap('9992.HK', 'CNY', 'HKD', 13037749e3, 40416698368);
  // Pop Mart has no latest revenue quarter in that snapshot; this quarter is synthetic.
  const s = _convertSnapshotToUSD(raw);
  assert.ok(close(s.annual.annualRev[0].value, 13037749e3 * s.meta.fxRateApplied));
  assert.ok(close(s.timeseries.revenueQ[0].value, 1446.7e6 * s.meta.fxRateApplied));
  assert.strictEqual(s.meta.statementCurrencySource, undefined);
  assert.strictEqual(s.meta.statementCurrencySeries, undefined);
});

pruefe('annual-only row whose mismatch disappeared withholds annual series, quarters keep the JPY factor', () => {
  const raw = snap('6269.T', 'JPY', 'JPY', 717100e6, 814098022400);
  raw.timeseries.ocfQ = [{ value: 20e9 }, null];
  const s = _convertSnapshotToUSD(raw);
  assert.strictEqual(s.annual.annualRev[0].value, null);
  assert.strictEqual(s.annual.annualRev[0].financialMissing.rule, 'statement-currency-unverified');
  assert.deepStrictEqual(s.annual.annualRev[0].financialMissing.originalVendorRow, { value: 717100e6 });
  assert.deepStrictEqual(s.timeseries.ocfQ, [{ value: 20e9 * s.meta.fxRateApplied }, null]);
  // RATSBLOCK-2026-10-06 F5: a drifted MODEC quarterly fingerprint fails closed as well.
  assert.strictEqual(s.timeseries.revenueQ[0].value, null);
  assert.strictEqual(s.timeseries.revenueQ[0].financialMissing.reasonCode, 'vendor-value-changed');
  assert.ok(/no longer visible/.test(s.meta._statementCcyHandTableStale));
  assert.strictEqual(s.meta.statementCurrencySource, undefined);
  assert.strictEqual(s.meta.statementCurrencySeries, undefined);
});

pruefe('schema rejects an invalid series scope instead of silently correcting quarters', () => {
  const raw = JSON.parse(fs.readFileSync(TABLE_PATH, 'utf8'));
  const read = fs.readFileSync;
  try {
    for (const series of ['quarterly', '', null, true, ['annual']]) {
      raw['6269.T'].series = series;
      fs.readFileSync = function (file, ...args) {
        return file === TABLE_PATH ? JSON.stringify(raw) : read.call(this, file, ...args);
      };
      assert.throws(() => loadStatementCurrencyTable(), /series must be annual/);
    }
  } finally {
    fs.readFileSync = read;
  }
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

// P301 (P2-1 of the review of #42): both cases applied the reporting factor with only a WARN. If Yahoo delivers the
// annual series in BRL and the quarters still in USD (MODEC shows they can diverge), the quarters came out ~5x too small.
pruefe('fail closed: row with another Yahoo currency or a vanished mismatch withholds its statement series', () => {
  const eur = _convertSnapshotToUSD(snap('EMBJ', 'EUR', 'USD', 7577.5e6, 44128e6));
  assert.ok(/re-verify/.test(eur.meta._statementCcyHandTableStale));
  heldOk(eur.annual.annualRev[0], null, { value: 7577.5e6 });
  heldOk(eur.timeseries.revenueQ[0], '2026-03-31', { value: 1446.7e6 });
  assert.ok(close(eur.metrics.revenueTTM.value, 44128e6 * eur.meta.fxRateApplied), 'financialData still converts');
  assert.strictEqual(eur.annual.annualShares[0].value, 178e6, 'share counts are not money');
  assert.strictEqual(eur.meta.statementCurrencySource, undefined);
  assert.strictEqual(statementRowPending(eur, loadStatementCurrencyTable()), false, 'no endless re-pull');
  assert.deepStrictEqual(_convertSnapshotToUSD(structuredClone(eur)), eur, 'conversion must remain idempotent');
  // Yahoo fixed: annual ~ TTM, and the quarters may or may not have moved with the annual series.
  const fixed = _convertSnapshotToUSD(snap('PBR-A', 'BRL', 'USD', 548000e6, 548490e6));
  assert.ok(/no longer visible/.test(fixed.meta._statementCcyHandTableStale));
  heldOk(fixed.annual.annualRev[0], null, { value: 548000e6 });
  heldOk(fixed.timeseries.revenueQ[0], '2026-03-31', { value: 1446.7e6 });
  assert.ok(close(fixed.metrics.revenueTTM.value, 548490e6 * fixed.meta.fxRateApplied), 'financialData still converts');
  assert.strictEqual(fixed.meta.statementCurrencySource, undefined);
  assert.strictEqual(statementRowPending(fixed, loadStatementCurrencyTable()), false, 'no endless re-pull');
});

pruefe('fail closed: another Yahoo currency on an annual-only row withholds its quarters too', () => {
  const raw = snap('6269.T', 'EUR', 'JPY', 4581232e3, 814098022400);
  raw.timeseries.ocfQ = [{ value: 20e9 }, null];
  const s = _convertSnapshotToUSD(raw);
  assert.strictEqual(s.annual.annualRev[0].value, null);
  assert.strictEqual(s.timeseries.ocfQ[0].value, null, 'the row says nothing about quarters in another currency');
  assert.strictEqual(s.timeseries.ocfQ[0].financialMissing.rule, 'statement-currency-unverified');
  assert.strictEqual(s.timeseries.ocfQ[1], null, 'a vendor gap stays a gap');
});

pruefe('P3-4: the WARN line says what really happened in each branch', () => {
  const log = console.log;
  const warnings = (raw) => {
    const lines = [];
    console.log = (...a) => lines.push(a.join(' '));
    const warn = console.warn;
    console.warn = () => {};
    try { _convertSnapshotToUSD(raw); } finally { console.log = log; console.warn = warn; }
    return lines.filter((l) => /STALE/.test(l)).join('\n');
  };
  const usd = warnings(snap('PBR-A', 'USD', 'USD', 89195e6, 89195e6, { ccyAmbiguous: true }));
  assert.match(usd, /USD reporting currency, factor 1 kept, nothing withheld/);
  assert.doesNotMatch(usd, /not verifiable|series withheld/);
  assert.match(warnings(snap('PBR-A', 'BRL', 'USD', 548000e6, 548490e6)), /statement series withheld: mismatch no longer visible/);
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
  for (const k of ['PBR-A', 'EMBJ', 'VALE3.SA', 'XVALO.MC', 'YPF', 'YPFD.BA', '6269.T']) assert.ok(t[k], 'row missing: ' + k);
  const before = snap('EMBJ', 'BRL', 'USD', 7577.5e6, 44128e6);
  before.meta.fxConverted = true;
  assert.strictEqual(statementRowPending(before, t), true);
  const after = _convertSnapshotToUSD(snap('EMBJ', 'BRL', 'USD', 7577.5e6, 44128e6));
  assert.strictEqual(statementRowPending(after, t), false);
  assert.strictEqual(statementRowPending(snap('ITUB4.SA', 'BRL', 'BRL', 1, 1), t), false);
});

// Sweep 24.10. (finding 4): a row whose check inputs are missing fell back to the reporting factor and
// divided the proven USD statements by the local rate again (measured on this converter before the fix:
// VALE3.SA 38.40 bn -> 7.58 bn, YPFD.BA 18.28 bn -> 0.012 bn), with only a WARN. Now the statement series
// are withheld: value null plus a financialMissing marker naming the period (T2, never a replacement 0).

// P3-3: one hint per firm that names every period, in plain German; the internal term never reaches Karl.
pruefe('the hint of a held firm is one text naming its period ends', () => {
  const raw = snap('VALE3.SA', 'BRL', 'BRL', 38403e6, 1);
  delete raw.metrics.revenueTTM;
  raw.annual.annualRevEnds = ['2025-12-31', '2024-12-31'];
  // Blind review of #58: the two real series without an own *Ends series are index-aligned to revenue.
  raw.annual.annualCostOfRevenue = [{ value: 30000e6 }, { value: 28000e6 }];
  raw.timeseries.netIncomeQ = [{ value: 2000e6 }];
  const s = _convertSnapshotToUSD(raw);
  heldOk(s.annual.annualCostOfRevenue[1], '2024-12-31', { value: 28000e6 });
  heldOk(s.timeseries.netIncomeQ[0], '2026-03-31', { value: 2000e6 });
  const reasons = financialReasons(s);
  assert.deepStrictEqual(reasons, [HOLD_REASON + ' Das betrifft die Perioden mit Ende 31.03.2026, 31.12.2025 und 31.12.2024.']);
  assert.doesNotMatch(reasons[0], /Handtabelle/);
});
for (const [ticker, currency, annual, quarter] of [
  ['VALE3.SA', 'BRL', 38403e6, 10498e6], ['EMBJ3.SA', 'BRL', 7577.5e6, 1446.7e6], ['YPFD.BA', 'ARS', 18284e6, 6574e6],
]) {
  pruefe('fail closed: ' + ticker + ' without revenueTTM withholds its statement series instead of dividing them', () => {
    const raw = snap(ticker, currency, currency, annual, 1);
    delete raw.metrics.revenueTTM;
    raw.timeseries.revenueQ[0].value = quarter;
    raw.annual.annualRevEnds = ['2025-12-31', '2024-12-31'];
    raw.annual.annualRnD = [12e6, null, 7e6];
    raw.annual.annualBalance = [{ totalAssets: 8000e6, totalCash: 500e6, totalDebt: null }];
    raw.annual.annualBalanceEnds = ['2025-12-31'];
    const s = _convertSnapshotToUSD(structuredClone(raw));
    assert.ok(/revenueTTM missing/.test(s.meta._statementCcyHandTableStale));
    assert.strictEqual(s.meta.statementCurrencySource, undefined, 'an unverified row is not a correction');
    heldOk(s.annual.annualRev[0], '2025-12-31', { value: annual });
    heldOk(s.annual.annualRev[1], '2024-12-31', { value: 6394.7e6 });
    heldOk(s.timeseries.revenueQ[0], '2026-03-31', { value: quarter });
    // No own *Ends: the revenue period ends hold where they reach, a cell beyond them stays undated (23 real tickers on 30.10.).
    heldOk(s.annual.annualRnD[0], '2025-12-31', 12e6);
    assert.strictEqual(s.annual.annualRnD[1], null, 'a vendor gap stays a gap');
    heldOk(s.annual.annualRnD[2], null, 7e6);
    const bal = s.annual.annualBalance[0];
    assert.strictEqual(bal.totalAssets, null); assert.strictEqual(bal.totalCash, null); assert.strictEqual(bal.totalDebt, null);
    assert.strictEqual(bal.financialMissing.period, '2025-12-31');
    assert.strictEqual(s.annual.annualShares[0].value, 178e6, 'share counts are not money');
    assert.deepStrictEqual(s.annual.annualRevEnds, raw.annual.annualRevEnds);
    assert.deepStrictEqual(s.timeseries.revenueQEnds, raw.timeseries.revenueQEnds);
    assert.strictEqual(statementRowPending(s, loadStatementCurrencyTable()), false, 'no endless re-pull');
    assert.deepStrictEqual(_convertSnapshotToUSD(structuredClone(s)), s, 'conversion must remain idempotent');
  });
}

pruefe('fail closed: a BRL-listed row with financialCurrency missing withholds as well', () => {
  const s = _convertSnapshotToUSD(snap('VALE3.SA', 'BRL', 'BRL', 38403e6, 218068992000, { ccyAmbiguous: true }));
  assert.ok(/financialCurrency missing/.test(s.meta._statementCcyHandTableStale));
  heldOk(s.timeseries.revenueQ[0], '2026-03-31', { value: 1446.7e6 });
  assert.strictEqual(s.annual.annualRev[0].value, null);
  assert.ok(close(s.metrics.revenueTTM.value, 218068992000 * s.meta.fxRateApplied), 'financialData still converts');
});

pruefe('fail closed: MODEC (annual-only row) withholds annual series, quarters keep the JPY factor', () => {
  const raw = snap('6269.T', 'JPY', 'JPY', 4581232e3, 1);
  delete raw.metrics.revenueTTM;
  raw.timeseries.ocfQ = [{ value: 20e9 }, null];
  const s = _convertSnapshotToUSD(raw);
  assert.strictEqual(s.annual.annualRev[0].value, null);
  assert.strictEqual(s.annual.annualRev[0].financialMissing.rule, 'statement-currency-unverified');
  assert.deepStrictEqual(s.timeseries.ocfQ, [{ value: 20e9 * s.meta.fxRateApplied }, null]);
});

pruefe('counter case: a reporter without a row and without revenueTTM converts as before', () => {
  const raw = snap('ITUB4.SA', 'BRL', 'BRL', 7577.5e6, 1);
  delete raw.metrics.revenueTTM;
  const s = _convertSnapshotToUSD(raw);
  assert.ok(close(s.annual.annualRev[0].value, 7577.5e6 * s.meta.fxRateApplied));
  assert.strictEqual(s.annual.annualRev[0].financialMissing, undefined);
  assert.strictEqual(s.meta._statementCcyHandTableStale, undefined);
});

pruefe('statementFactor marks every stale case as hold and only a confirmed row or no row as not', () => {
  const t = loadStatementCurrencyTable();
  const noTtm = snap('VALE3.SA', 'BRL', 'BRL', 38403e6, 1); delete noTtm.metrics.revenueTTM;
  assert.strictEqual(statementFactor(noTtm, 'BRL', 0.2, t).hold, true);
  assert.strictEqual(statementFactor(snap('6269.T', 'JPY', 'JPY', 1, 0), 'JPY', 0.0067, t).series, 'annual');
  assert.strictEqual(statementFactor(snap('EMBJ', 'EUR', 'USD', 7577.5e6, 44128e6), 'EUR', 1.1, t).hold, true);
  assert.strictEqual(statementFactor(snap('PBR-A', 'BRL', 'USD', 548000e6, 548490e6), 'BRL', 0.2, t).hold, true);
  // Vanished mismatch on an annual-only row: annual only. Another currency: every series (no series key).
  assert.strictEqual(statementFactor(snap('6269.T', 'JPY', 'JPY', 717100e6, 814098022400), 'JPY', 0.0067, t).series, 'annual');
  const eur = statementFactor(snap('6269.T', 'EUR', 'JPY', 4581232e3, 814098022400), 'EUR', 1.1, t);
  assert.strictEqual(eur.hold, true);
  assert.strictEqual(eur.series, undefined);
  assert.strictEqual(statementFactor(snap('EMBJ', 'BRL', 'USD', 7577.5e6, 44128e6), 'BRL', 0.2, t).hold, undefined);
  assert.strictEqual(statementFactor(snap('ITUB4.SA', 'BRL', 'BRL', 1, 1), 'BRL', 0.2, t).hold, undefined);
});

console.log('statement-currency-waechter: ' + ok + ' ok, ' + fail + ' fail');
if (fail) process.exit(1);
