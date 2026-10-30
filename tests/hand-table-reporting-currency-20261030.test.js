'use strict';
// Guard for the reporting-currency hand table of 30.10.2026.
// PSQL: Yahoo omits financialCurrency, the pull fell back to the USD trading currency, and the euro statements stood as dollars.
// Runs the real mapper, the real converter and the real valuation row on the figures of the snapshot of data day 30.10.2026 (run 41027769596).
// Presence: EUR is filled, amounts convert once, the USD market cap stays, the ratios against it are withheld by the existing currency rule.
// Absence: another ticker without a row and a currency Yahoo does deliver behave as before.
// Break-once on test data only: `node tests/hand-table-reporting-currency-20261030.test.js --prove-red` runs the presence check
// on a ticker without a row and must exit 1. No wall clock; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { mapYahooToCanonical, _convertSnapshotToUSD } = require('../pull-yahoo.js');
const { rowFor } = require('../scripts/write-bewertung-export.js');
const { loadReportingCurrencyTable, reportingCurrencyFill, reportingRowPending, PROVENANCE, TABLE_PATH } = require('../lib/reporting-currency-hand-table.js');
const { pinFx, PINNED_RATES } = require('./fixtures/fx/pin-fx.js');
pinFx();

const root = path.resolve(__dirname, '..');
const live = ['configs/reporting-currency-hand-table.json', 'lib/reporting-currency-hand-table.js', 'pull-yahoo.js'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();

const AS_OF = '2026-10-30T09:23:23.361Z', MC = 1112418944;
const mapped = (ticker, financialCurrency) => {
  const snap = mapYahooToCanonical({
    price: { currency: 'USD', regularMarketPrice: 5.24, marketCap: MC, exchangeName: 'NasdaqGM' },
    financialData: financialCurrency ? { financialCurrency } : {},
  }, { ticker, name: 'Fixture' }, AS_OF);
  // Vendor figures of the stored packet, in the shape of annual.*.
  snap.marketCap = { value: MC, source: 'yahoo_quote', confidence: 0.9, asOf: AS_OF };
  snap.annual = {
    annualRev: [{ value: 16468000 }, { value: 3508000 }], annualNetIncome: [{ value: -92355000 }, { value: -48498000 }],
    annualOCF: [{ value: -24270000 }, { value: -29922000 }],
    annualBalance: [{ totalEquity: -4415000 }, { totalEquity: 32672000 }],
    annualRevEnds: ['2025-12-31', '2024-12-31'], annualNetIncomeEnds: ['2025-12-31', '2024-12-31'],
    annualOCFEnds: ['2025-12-31', '2024-12-31'], annualBalanceEnds: ['2025-12-31', '2024-12-31'],
  };
  return snap;
};
const close = (a, b) => Math.abs(a / b - 1) < 1e-9;

function presence(ticker) {
  const snap = mapped(ticker);
  assert.equal(snap.meta.reportingCurrency, 'EUR');
  assert.equal(snap.meta.ccyAmbiguous, false);
  assert.equal(snap.meta.reportingCurrencySource, PROVENANCE);
  assert.equal(snap.meta.tradingCurrency, 'USD');
  const out = _convertSnapshotToUSD(snap);
  assert.equal(out.meta.reportingCurrencyOriginal, 'EUR');
  assert.equal(out.meta.fxRateApplied, PINNED_RATES.EUR);
  assert.ok(close(out.annual.annualRev[0].value, 16468000 * PINNED_RATES.EUR), 'revenue converted once');
  assert.ok(close(out.annual.annualRev[0].value / out.annual.annualRev[1].value, 16468000 / 3508000), 'growth unchanged');
  assert.equal(out.marketCap.value, MC, 'the USD market cap is not converted');
  assert.equal(out.meta.tradingFxRateApplied, 1);
  return out;
}

if (process.argv.includes('--prove-red')) { presence('AIIR'); process.exit(0); }

test('PSQL: euro statements convert once, growth and the USD market cap stay', () => {
  assert.ok(PINNED_RATES.EUR > 1, 'a rate of 1 would hide the conversion');
  presence('PSQL');
});

test('PSQL: the ratios against the market cap no longer mix currencies', () => {
  const stored = mapped('NOROW');
  stored.meta.ticker = 'PSQL';
  const before = rowFor(_convertSnapshotToUSD(stored));
  assert.deepEqual([before.ep, before.cp, before.bp], [-8.3, -2.18, -0.4], 'the figures published on 30.10.2026');
  const after = rowFor(presence('PSQL'));
  assert.deepEqual(after, { t: 'PSQL', ohne: 'waehrung-ungeprueft' });
});

test('absence: a ticker without a row keeps the fallback, factor 1, nothing stamped', () => {
  const out = _convertSnapshotToUSD(mapped('AIIR'));
  assert.equal(out.meta.ccyAmbiguous, true);
  assert.equal(out.meta.reportingCurrencyOriginal, 'USD');
  assert.equal(out.annual.annualRev[0].value, 16468000);
  assert.equal(out.meta.reportingCurrencySource, undefined);
  assert.equal(reportingRowPending(out, loadReportingCurrencyTable()), false);
});

test('vendor currency: agreeing is not stamped; a conflict stays the vendor value, is stamped and warned', () => {
  const same = mapped('PSQL', 'EUR');
  assert.equal(same.meta.reportingCurrency, 'EUR');
  assert.equal(same.meta.reportingCurrencySource, undefined);
  const warn = console.warn, seen = [];
  console.warn = m => seen.push(m);
  let conflict;
  try { conflict = mapped('PSQL', 'USD'); } finally { console.warn = warn; }
  assert.equal(conflict.meta.reportingCurrency, 'USD');
  assert.match(conflict.meta._reportingCcyHandTableConflict, /USD != row EUR/);
  assert.ok(seen.some(m => /::warning::PSQL: reporting-currency hand table/.test(m)));
  assert.equal(reportingRowPending(_convertSnapshotToUSD(conflict), loadReportingCurrencyTable()), false, 'a conflict must not re-pull on every run');
});

test('pending: the stored USD packet forces one full pull, the converted one does not', () => {
  const table = loadReportingCurrencyTable();
  const stored = { meta: { ticker: 'PSQL', reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', ccyAmbiguous: true, fxRateApplied: 1, fxConverted: true } };
  assert.equal(reportingRowPending(stored, table), true);
  assert.equal(reportingRowPending(presence('PSQL'), table), false);
  // ponytail: the probe is private to pullAll; the line is pinned here, the run itself is checked by data-health/erwartungen.json.
  const src = fs.readFileSync(path.join(root, 'pull-yahoo.js'), 'utf8');
  const probe = src.slice(src.indexOf('function _existingSnapshotMissingCurrencyNormalization'), src.indexOf('function _rawQuarterEnd'));
  assert.ok(/if \(reportingRowPending\(s, REPORTING_CCY_TABLE\)\) return true;/.test(probe));
});

test('table: every row is proven, a USD row or a row without a quote is refused', () => {
  const rows = loadReportingCurrencyTable(TABLE_PATH);
  assert.deepEqual(Object.keys(rows), ['PSQL']);
  assert.equal(rows.PSQL.statementCurrency, 'EUR');
  assert.deepEqual(reportingCurrencyFill('OTHER', undefined, rows), { currency: undefined });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporting-ccy-'));
  try {
    const file = path.join(dir, 't.json');
    for (const [patch, why] of [[{ statementCurrency: 'USD' }, /statementCurrency/], [{ quote: '' }, /quote/], [{ url: 'http://x' }, /url/]]) {
      fs.writeFileSync(file, JSON.stringify({ PSQL: { ...rows.PSQL, ...patch } }));
      assert.throws(() => loadReportingCurrencyTable(file), why);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('break-once: the presence check is red on a ticker without a row', () => {
  const child = spawnSync(process.execPath, [__filename, '--prove-red'], { cwd: root, encoding: 'utf8' });
  assert.equal(child.status, 1, child.stdout + child.stderr);
});

test('live files stayed unchanged', () => assert.deepEqual(liveHashes(), beforeHashes));
