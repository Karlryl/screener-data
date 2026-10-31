'use strict';
// Guard for the reporting-currency hand table of 30.10.2026.
// PSQL: Yahoo omits financialCurrency, the pull fell back to the USD trading currency, and the euro statements stood as dollars.
// Runs the real mapper, the real converter, the real pull and the real valuation row on the figures of the snapshot of data day 30.10.2026 (run 41027769596).
// Presence: EUR is filled, amounts convert once, the USD market cap stays, the ratios against it are withheld by the existing currency rule.
// Hold (Codex P316, 31.10.2026): a vendor currency against the row, or a period past the row's bound, proves no currency at all.
// The amounts are withheld and the next run checks again. The run counts the firm by type, with an owner and a fixed deadline, and
// goes on with exit 0: a hold never stops the boards (master decision on P316 round 2). After the deadline: an alarm, still held.
// Absence: another ticker without a row and a currency Yahoo does deliver behave as before.
// Break-once on test data only: `node tests/hand-table-reporting-currency-20261030.test.js --prove-red` runs the presence check
// on a ticker without a row and must exit 1. No wall clock; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { mapYahooToCanonical, _convertSnapshotToUSD } = require('../pull-yahoo.js');
const { rowFor } = require('../scripts/write-bewertung-export.js');
const { mergeManifests } = require('../scripts/merge-shard-manifests.js');
const { preserveReloadHistory } = require('../lib/reload-history.js');
const { loadReportingCurrencyTable, reportingCurrencyFill, reportingRowPending, applyReportingRowHold, PROVENANCE, TABLE_PATH } = require('../lib/reporting-currency-hand-table.js');
const { pinFx, PINNED_RATES } = require('./fixtures/fx/pin-fx.js');
const { fixture, snapshot, NOW } = require('./stale-quarter-reload.test.js');
pinFx();

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'pull-yahoo.js'), 'utf8');
const PROBE_LINE = '      if (reportingRowPending(s, REPORTING_CCY_TABLE)) return true;';
const HOLD_LINE = '  const ccyHold = applyReportingRowHold(snap, REPORTING_CCY_TABLE);';
const TABLE_LINE = 'const REPORTING_CCY_TABLE = loadReportingCurrencyTable();';
const GATE = path.join(root, 'scripts', 'ccy-alarm-gate.js');
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

// Nothing in the reporting currency is left, the market cap is untouched, and no ratio against it can be computed.
function assertHeld(s, why) {
  assert.match(s.meta._reportingCcyHandTableConflict, why);
  for (const key of ['annualRev', 'annualNetIncome', 'annualOpInc', 'annualGP', 'annualOCF', 'annualFCF']) {
    assert.equal(s.annual[key][0].value, null, key);
    assert.equal(s.annual[key][0].financialMissing.rule, 'statement-currency-unverified', key);
  }
  for (const field of ['totalEquity', 'totalAssets', 'totalDebt']) assert.equal(s.annual.annualBalance[0][field], null, field);
  assert.equal(s.metrics.revenueTTM, null);
  assert.equal(s.marketCap.value, MC);
  assert.deepEqual(rowFor(s), { t: 'PSQL', ohne: 'waehrung-ungeprueft' }, 'no yield and no earnings per share');
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
  assert.equal(out.meta._reportingCcyHandTableConflict, undefined);
  assert.equal(reportingRowPending(out, loadReportingCurrencyTable()), false);
});

test('vendor currency: EUR from Yahoo wins, is not stamped and converts', () => {
  const same = mapped('PSQL', 'EUR');
  assert.equal(same.meta.reportingCurrency, 'EUR');
  assert.equal(same.meta.reportingCurrencySource, undefined);
  const out = _convertSnapshotToUSD(same);
  assert.equal(out.meta._reportingCcyHandTableConflict, undefined);
  assert.ok(close(out.annual.annualRev[0].value, 16468000 * PINNED_RATES.EUR));
});

test('vendor conflict: USD or a third currency holds the amounts and warns', () => {
  for (const vendor of ['USD', 'GBP']) {
    const warn = console.warn, seen = [];
    console.warn = m => seen.push(m);
    let out;
    try { out = _convertSnapshotToUSD(mapped('PSQL', vendor)); } finally { console.warn = warn; }
    assert.equal(out.annual.annualRev[0].value, null, vendor);
    assert.equal(out.annual.annualBalance[0].totalEquity, null, vendor);
    assert.equal(out.annual.annualRev[0].financialMissing.originalVendorRow.value, 16468000, 'the vendor value stays readable for the check');
    assert.match(out.annual.annualRev[0].financialMissing.staleReason, new RegExp(`${vendor} != row EUR`));
    assert.equal(out.marketCap.value, MC);
    assert.deepEqual(rowFor(out), { t: 'PSQL', ohne: 'waehrung-ungeprueft' });
    assert.deepEqual(out.meta._reportingCcyHold, { type: 'conflict', owner: 'Claude-Tageslauf-Master', firstSeen: '2026-10-30', pruefungBis: '2026-11-06' });
    assert.ok(seen.some(m => /::warning::PSQL: reporting-currency hand table/.test(m)), vendor);
    assert.equal(reportingRowPending(out, loadReportingCurrencyTable()), true, 'a held packet is checked again on the next run');
  }
});

test('period bound: a filled row vouches only up to its bound', () => {
  const table = loadReportingCurrencyTable();
  const bound = table.PSQL.provenThrough;
  assert.match(bound, /^\d{4}-\d{2}-\d{2}$/);
  const later = (financialCurrency, value = 16468000) => {
    const snap = mapped('PSQL', financialCurrency);
    snap.annual.annualRev = [{ value }, { value: 3508000 }];
    snap.annual.annualRevEnds = ['2026-12-31', '2025-12-31'];
    return snap;
  };
  assert.ok(bound < '2026-12-31', 'the probe period lies past the bound');
  const out = _convertSnapshotToUSD(later());
  assert.equal(out.annual.annualRev[0].value, null);
  assert.equal(out.annual.annualRev[1].value, null, 'the whole packet, a currency change restates the older years too');
  assert.match(out.meta._reportingCcyHandTableConflict, /statement period 2026-12-31 after row bound/);
  assert.deepEqual(out.meta._reportingCcyHold, { type: 'new-period', owner: 'Claude-Tageslauf-Master', firstSeen: '2026-10-30', pruefungBis: '2026-11-13' });
  // At the bound, or with the bound moved after a new check, the row vouches.
  const atBound = mapped('PSQL');
  atBound.annual.annualRevEnds = [bound, '2025-12-31'];
  assert.equal(applyReportingRowHold(atBound, table), null);
  assert.equal(applyReportingRowHold(later(), { PSQL: { ...table.PSQL, provenThrough: '2026-12-31' } }), null);
  // Yahoo's own EUR proves the new period, and a row without an amount cannot be mislabelled.
  assert.equal(_convertSnapshotToUSD(later('EUR')).meta._reportingCcyHandTableConflict, undefined);
  const padding = later(undefined, null);
  assert.equal(applyReportingRowHold(padding, table), null);
  assert.equal(padding.annual.annualNetIncome[0].value, -92355000, 'nothing withheld');
});

test('pending: the stored USD packet forces one full pull, the converted one does not, a held one always', () => {
  const table = loadReportingCurrencyTable();
  const stored = { meta: { ticker: 'PSQL', reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', ccyAmbiguous: true, fxRateApplied: 1, fxConverted: true } };
  assert.equal(reportingRowPending(stored, table), true);
  assert.equal(reportingRowPending(presence('PSQL'), table), false);
  const held = { meta: { ticker: 'PSQL', reportingCurrency: 'USD', reportingCurrencyOriginal: 'EUR', _reportingCcyHandTableConflict: 'x' } };
  assert.equal(reportingRowPending(held, table), true);
  assert.equal(reportingRowPending(held, {}), true, 'a row taken out after the check must free the packet too');
});

// Real pullAll, virtual files and provider (fixture of tests/stale-quarter-reload.test.js); the break-once target is copied source.
// The vendor statements behind PSQL's stored packet: the figures of the euro filing, whatever label Yahoo puts on them.
const annualResponses = {
  financials: [
    { date: '2024-12-31', totalRevenue: 3508000, grossProfit: 3929000, operatingIncome: -46750000, netIncome: -48498000 },
    { date: '2025-12-31', totalRevenue: 16468000, grossProfit: 8076000, operatingIncome: -50496000, netIncome: -92355000 },
  ],
  'cash-flow': [
    { date: '2024-12-31', operatingCashFlow: -29922000, freeCashFlow: -49985000 },
    { date: '2025-12-31', operatingCashFlow: -24270000, freeCashFlow: -35088000 },
  ],
  'balance-sheet': [
    { date: '2024-12-31', totalAssets: 126007000, totalDebt: 13382000, currentAssets: 39713000, totalEquity: 32672000, stockholdersEquity: 32672000 },
    { date: '2025-12-31', totalAssets: 187824000, totalDebt: 112804000, currentAssets: 103980000, totalEquity: -4415000, stockholdersEquity: -4415000 },
  ],
};
const pullPsql = (snapshots, pullSource, { now = NOW, financialCurrency, env = { STALE_QUARTER_RELOAD: '' }, responses = annualResponses, quarterEmpty = true, manual = [], quarterlyRows = null, summaryFails = false, earningsHistory = null } = {}) => {
  const summaryResponse = { price: { currency: 'USD', marketCap: MC, regularMarketPrice: 5.24, exchangeName: 'NasdaqGM' },
    financialData: { totalRevenue: 16468000, ...(financialCurrency ? { financialCurrency } : {}) }, ...(earningsHistory ? { earningsHistory } : {}),
    summaryDetail: { marketCap: MC, fiftyTwoWeekHigh: 24.69 }, quoteType: { quoteType: 'EQUITY' }, summaryProfile: { sector: 'Technology', industry: 'Computer Hardware', country: 'France' } };
  // The fixture's default switches the stale-quarter reload on, which would pull in full for its own reason.
  return fixture({ snapshots, summaryResponse, pullSource, now, annualResponses: responses, quarterEmpty, quarterlyRows, summaryFails, quotePrice: 5.24, quoteMarketCap: MC, env, manual });
};
// The same figures in the stored shape: the fixture's statement cache is built from them, so a pull within its age reads them too.
const statementRows = (rows, field) => rows.slice().reverse().map(r => ({ value: r[field] }));
const ENDS = ['2025-12-31', '2024-12-31'];
const storedUsdPacket = () => {
  const s = snapshot('PSQL');
  Object.assign(s.meta, { reportingCurrencyOriginal: 'USD', ccyAmbiguous: true, fxRateApplied: 1, fxConverted: true, tradingFxRateApplied: 1, tradingCurrencyAssumed: false });
  const { financials, 'cash-flow': cash, 'balance-sheet': balance } = annualResponses;
  s.annual = { annualRev: statementRows(financials, 'totalRevenue'), annualGP: statementRows(financials, 'grossProfit'),
    annualOpInc: statementRows(financials, 'operatingIncome'), annualNetIncome: statementRows(financials, 'netIncome'),
    annualOCF: statementRows(cash, 'operatingCashFlow'), annualFCF: statementRows(cash, 'freeCashFlow'),
    annualBalance: balance.slice().reverse().map(({ date, stockholdersEquity, ...row }) => row),
    annualRevEnds: ENDS, annualGPEnds: ENDS, annualOpIncEnds: ENDS, annualNetIncomeEnds: ENDS, annualOCFEnds: ENDS, annualFCFEnds: ENDS, annualBalanceEnds: ENDS };
  s.timeseries = { revenueQ: [], grossProfitQ: [], opIncQ: [], netIncomeQ: [], revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [] };
  return s;
};
// The packet as it stands before the row: the real pull without a table, euro figures under the USD label, dated and comparable.
const packetWithoutRow = async () => {
  assert.ok(source.includes(TABLE_LINE), 'table line not found');
  const f = pullPsql([storedUsdPacket()], source.replace(TABLE_LINE, 'const REPORTING_CCY_TABLE = {};'), { manual: ['PSQL'] });
  f.files.delete(CACHE); // the provider path, which dates every statement
  await f.run();
  const packet = f.stored('PSQL');
  assert.equal(packet._pullMode, undefined, 'a full pull');
  assert.equal(packet.meta.statementPeriods.annualBalance[0].currency, 'USD', 'the wrong label on every statement');
  return packet;
};
const slimManifest = f => JSON.parse(f.io.readFileSync(path.join(f.out, '_manifest.json'), 'utf8'));
// Objects of the fixture's vm context have other prototypes than this file's.
const plain = x => JSON.parse(JSON.stringify(x));
// The fixture builds its statement cache from the snapshot. The real cache keeps the raw vendor figures across runs, also under a hold.
const CACHE = path.resolve(root, 'fundamentals-cache', 'PSQL.json');
const nextRun = (previous, options) => {
  const f = pullPsql([previous.stored('PSQL')], source, options);
  f.files.set(CACHE, previous.files.get(CACHE));
  return f;
};

test('pullAll: the stored USD packet is pulled in full once, stored in EUR, and the next day only priced', async () => {
  const day1 = pullPsql([storedUsdPacket()], source);
  const manifest = await day1.run();
  assert.equal(manifest.results[0].status, 'ok', JSON.stringify(manifest.results[0]));
  assert.equal(manifest.n_reporting_ccy_held, 0);
  const s = day1.stored('PSQL');
  assert.equal(s._pullMode, undefined, 'a full pull');
  assert.equal(s.meta.reportingCurrencyOriginal, 'EUR');
  assert.equal(s.meta.ccyAmbiguous, false);
  assert.ok(s.meta.fxRateApplied > 1, 'a rate of 1 would hide the conversion');
  assert.equal(s.marketCap.value, MC);
  const day2 = pullPsql([s], source, { now: NOW + 864e5 });
  await day2.run();
  assert.equal(day2.stored('PSQL')._pullMode, 'price-only', 'no second forced pull');
});

test('pullAll: Yahoo adds USD on the euro figures: held, counted on every run, freed once Yahoo is silent again', async () => {
  const stored = await packetWithoutRow();
  assert.equal(stored.annual.annualRev[0].value, 16468000);
  const damage = rowFor(stored);
  assert.deepEqual([damage.ep, damage.cp, damage.bp], [-8.3, -2.18, -0.4], 'the reproduced damage');
  const day1 = pullPsql([stored], source, { financialCurrency: 'USD' });
  const m1 = await day1.run();
  assert.equal(m1.results[0].status, 'ok', JSON.stringify(m1.results[0]));
  assertHeld(day1.stored('PSQL'), /USD != row EUR/);
  assert.equal(m1.n_reporting_ccy_held, 1);
  assert.deepEqual(plain(m1._reportingCcyHeld), [{ ticker: 'PSQL', type: 'conflict', reason: day1.stored('PSQL').meta._reportingCcyHandTableConflict,
    owner: 'Claude-Tageslauf-Master', firstSeen: day1.stored('PSQL').meta._reportingCcyHold.firstSeen, pruefungBis: day1.stored('PSQL').meta._reportingCcyHold.pruefungBis, overdue: false }]);
  assert.equal(m1.n_reporting_ccy_conflicts, 1);
  assert.equal(m1.n_reporting_ccy_new_periods, 0);
  const slim = slimManifest(day1);
  assert.equal(slim.n_reporting_ccy_held, 1, 'the committed manifest carries the count');
  assert.deepEqual(slim._reportingCcyHeld, plain(m1._reportingCcyHeld));
  // Same answer the next day: pulled in full again, still held, still counted.
  const day2 = nextRun(day1, { now: NOW + 864e5, financialCurrency: 'USD' });
  const m2 = await day2.run();
  assert.equal(day2.stored('PSQL')._pullMode, undefined, 'a full pull, not price-only');
  assertHeld(day2.stored('PSQL'), /USD != row EUR/);
  assert.equal(m2.n_reporting_ccy_held, 1);
  assert.deepEqual(day2.stored('PSQL').meta._reportingCcyHold, day1.stored('PSQL').meta._reportingCcyHold, 'the deadline does not restart');
  // Yahoo is silent again: the row vouches, the hold is gone, nothing is left over.
  const day3 = nextRun(day2, { now: NOW + 2 * 864e5 });
  const m3 = await day3.run();
  const freed = day3.stored('PSQL');
  assert.equal(m3.n_reporting_ccy_held, 0);
  assert.equal(freed.meta._reportingCcyHandTableConflict, undefined);
  assert.equal(freed.meta._reportingCcyHold, undefined);
  assert.equal(freed.meta.reportingCurrencyOriginal, 'EUR');
  assert.ok(close(freed.annual.annualRev[0].value, 16468000 * freed.meta.fxRateApplied));
  assert.deepEqual(rowFor(freed), { t: 'PSQL', ohne: 'waehrung-ungeprueft' });
});

test('history: a held packet takes no old figures; the same test data without the stamp would (break-once)', async () => {
  const stored = await packetWithoutRow();
  const day1 = pullPsql([stored], source, { financialCurrency: 'USD' });
  await day1.run();
  const held = day1.stored('PSQL');
  const refilled = preserveReloadHistory(plain(held), stored);
  assert.equal(refilled.annual.annualBalance[0].totalEquity, null);
  assert.equal(refilled.annual.annualRev[0].value, null);
  assert.ok(refilled.meta.reloadHistoryArchive.some(a => a.field === 'annualBalance' && a.end === '2025-12-31' && a.reason === 'statement-basis-unverified'), 'the old figures stay in the audit archive');
  const unstamped = plain(held);
  delete unstamped.meta._reportingCcyHandTableConflict;
  assert.equal(preserveReloadHistory(unstamped, stored).annual.annualBalance[0].totalEquity, -4415000, 'the condition is what keeps the wrong balance out');
});

const runGate = manifest => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporting-ccy-gate-'));
  try {
    fs.mkdirSync(path.join(dir, 'snapshots'));
    fs.writeFileSync(path.join(dir, 'snapshots', '_manifest.json'), JSON.stringify(manifest));
    const r = spawnSync(process.execPath, [GATE], { cwd: dir, encoding: 'utf8' });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

const LATER = Date.parse('2026-10-31T09:00:00Z');
const QUARTERS = [{ date: '2026-06-30', totalRevenue: 4872000, grossProfit: 1000000, netIncome: -10000000, operatingIncome: -9000000 },
  { date: '2026-09-30', totalRevenue: 5000000, grossProfit: 2000000, netIncome: -8000000, operatingIncome: -7000000 }];
const mergedGate = run => runGate(mergeManifests([slimManifest(run)], 1, 1));

test('new quarter past the bound, Yahoo silent: exit 0 with the row held, deadline fixed, after 14 days an alarm and still held', async () => {
  const proven = pullPsql([storedUsdPacket()], source);
  await proven.run();
  const q = { financialCurrency: undefined, quarterEmpty: false, quarterlyRows: QUARTERS };
  const day1 = pullPsql([proven.stored('PSQL')], source, { ...q, now: LATER });
  const m1 = await day1.run();
  assertHeld(day1.stored('PSQL'), /statement period 2026-09-30 after row bound 2026-06-30/);
  assert.equal(m1.n_reporting_ccy_new_periods, 1);
  assert.equal(m1.n_reporting_ccy_conflicts, 0);
  assert.equal(day1.Y.finishPull(m1), 0);
  const gate = mergedGate(day1);
  assert.equal(gate.status, 0, gate.out);
  assert.match(gate.out, /^::warning::PSQL: /m);
  assert.doesNotMatch(gate.out, /::error::/);
  const hold = day1.stored('PSQL').meta._reportingCcyHold;
  assert.deepEqual([hold.type, hold.firstSeen, hold.pruefungBis], ['new-period', '2026-10-31', '2026-11-14']);
  const day15 = nextRun(day1, { ...q, now: LATER + 15 * 864e5 });
  const m15 = await day15.run();
  assertHeld(day15.stored('PSQL'), /after row bound/);
  assert.deepEqual(day15.stored('PSQL').meta._reportingCcyHold, hold, 'the deadline does not restart');
  assert.equal(m15._reportingCcyHeld[0].overdue, true);
  assert.equal(m15.n_reporting_ccy_overdue, 1);
  const alarm = mergedGate(day15);
  assert.equal(alarm.status, 0, alarm.out);
  assert.match(alarm.out, /^::error::ALARM an Karl.*PSQL/m);
});

test('a real conflict has the shorter deadline: exit 0, alarm after 7 days, still held', async () => {
  const day1 = pullPsql([await packetWithoutRow()], source, { financialCurrency: 'USD' });
  await day1.run();
  assert.equal(mergedGate(day1).status, 0);
  const day8 = nextRun(day1, { now: NOW + 8 * 864e5, financialCurrency: 'USD' });
  await day8.run();
  assertHeld(day8.stored('PSQL'), /USD != row EUR/);
  const alarm = mergedGate(day8);
  assert.equal(alarm.status, 0, alarm.out);
  assert.match(alarm.out, /^::error::ALARM an Karl.*PSQL/m);
});

test('earnings per share of a held firm do not escape through the valuation row', async () => {
  const earningsHistory = { history: [{ quarter: '2026-06-30', epsActual: -0.2, epsEstimate: -0.1 }] };
  const f = pullPsql([await packetWithoutRow()], source, { financialCurrency: 'USD', earningsHistory });
  await f.run();
  assert.match(JSON.stringify(f.stored('PSQL').external.earningsHistory), /-0\.2/, 'the vendor row reached the snapshot');
  assert.deepEqual(rowFor(f.stored('PSQL')), { t: 'PSQL', ohne: 'waehrung-ungeprueft' });
});

test('a failed retry keeps the held firm in the count, from the kept state', async () => {
  const day1 = pullPsql([await packetWithoutRow()], source, { financialCurrency: 'USD' });
  await day1.run();
  const day2 = nextRun(day1, { now: NOW + 864e5, summaryFails: true });
  const m2 = await day2.run();
  assert.equal(m2.n_failed, 1, 'the retry did fail');
  assert.equal(m2.n_reporting_ccy_held, 1);
  assert.equal(m2._reportingCcyHeld[0].type, 'conflict');
  assert.equal(slimManifest(day2).n_reporting_ccy_held, 1);
  assertHeld(day2.stored('PSQL'), /USD != row EUR/);
});

test('pullAll: EUR from Yahoo needs no bound and frees a held packet', async () => {
  const held = pullPsql([await packetWithoutRow()], source, { financialCurrency: 'USD' });
  await held.run();
  const f = nextRun(held, { now: NOW + 864e5, financialCurrency: 'EUR' });
  const m = await f.run();
  assert.equal(m.n_reporting_ccy_held, 0);
  assert.equal(f.stored('PSQL').meta.reportingCurrencySource, undefined);
  assert.equal(f.stored('PSQL').meta.reportingCurrencyOriginal, 'EUR');
  assert.ok(close(f.stored('PSQL').annual.annualRev[0].value, 16468000 * f.stored('PSQL').meta.fxRateApplied));
});

test('pullAll: a conflict on an ordinary or a reload pull of a proven packet is held and counted, not kept silently', async () => {
  const proven = pullPsql([storedUsdPacket()], source);
  await proven.run();
  // Fundamentals clock past its limit: an ordinary full pull, the period guard would have kept the old packet without a count.
  const ordinary = pullPsql([proven.stored('PSQL')], source, { now: NOW + 40 * 864e5, financialCurrency: 'USD' });
  const m = await ordinary.run();
  assertHeld(ordinary.stored('PSQL'), /USD != row EUR/);
  assert.equal(m.n_reporting_ccy_held, 1);
  assert.equal(m.n_full_period_regression_blocked, 0);
  // Stale-quarter reload of a proven packet, which otherwise falls back to the stored figures.
  const old = snapshot('PSQL');
  Object.assign(old.meta, { reportingCurrency: 'USD', reportingCurrencyOriginal: 'EUR', fxRateApplied: 1.1, fxConverted: true, tradingFxRateApplied: 1, tradingCurrencyAssumed: false });
  const reload = pullPsql([old], source, { financialCurrency: 'USD', env: { STALE_QUARTER_RELOAD: 'local' }, quarterEmpty: false });
  const r = await reload.run();
  assert.equal(r.n_stale_quarter_selected, 1, 'the reload path ran');
  assert.equal(reload.stored('PSQL').annual.annualRev[0].value, null);
  assert.equal(r.n_reporting_ccy_held, 1);
});

test('pullAll: a period past the bound with Yahoo still silent is held and counted', async () => {
  const withNewYear = {
    financials: [...annualResponses.financials, { date: '2026-12-31', totalRevenue: 30000000, grossProfit: 9000000, operatingIncome: -40000000, netIncome: -50000000 }],
    'cash-flow': [...annualResponses['cash-flow'], { date: '2026-12-31', operatingCashFlow: -20000000, freeCashFlow: -30000000 }],
    'balance-sheet': [...annualResponses['balance-sheet'], { date: '2026-12-31', totalAssets: 200000000, totalDebt: 100000000, currentAssets: 90000000, totalEquity: 10000000, stockholdersEquity: 10000000 }],
  };
  const stored = pullPsql([storedUsdPacket()], source);
  await stored.run();
  const f = pullPsql([stored.stored('PSQL')], source, { now: Date.parse('2027-04-15T02:00:00Z'), responses: withNewYear });
  const m = await f.run();
  assertHeld(f.stored('PSQL'), /statement period 2026-12-31 after row bound/);
  assert.equal(m.n_reporting_ccy_held, 1);
});

test('break-once on copied source: without the hold the wrong dollars come back', async () => {
  assert.ok(source.includes(HOLD_LINE), 'hold line not found');
  const f = pullPsql([await packetWithoutRow()], source.replace(HOLD_LINE, '  const ccyHold = null;'), { financialCurrency: 'USD' });
  await f.run();
  const s = f.stored('PSQL');
  assert.equal(s.annual.annualRev[0].value, 16468000);
  assert.throws(() => assertHeld(s, /USD != row EUR/));
});

test('break-once on copied source: without the probe line the packet stays in USD and is only priced', async () => {
  assert.ok(source.includes(PROBE_LINE), 'probe line not found');
  const f = pullPsql([storedUsdPacket()], source.replace(PROBE_LINE, ''));
  await f.run();
  const s = f.stored('PSQL');
  assert.equal(s._pullMode, 'price-only');
  assert.equal(s.meta.reportingCurrencyOriginal, 'USD');
});

test('visibility: the merge adds the shards up by type, the data-run gate warns with exit 0 and stays hard only for a missing currency', () => {
  const row = { ticker: 'PSQL', type: 'conflict', reason: 'USD != row EUR', owner: 'Claude-Tageslauf-Master', firstSeen: '2026-10-30', pruefungBis: '2026-11-06', overdue: false };
  const shard = rows => ({ n_ok: 1, n_full: 1, n_priceonly: 0, n_failed: 0, n_total: 1, n_reporting_ccy_held: rows.length, _reportingCcyHeld: rows });
  const merged = mergeManifests([shard([row]), shard([])], 2, 2);
  assert.equal(merged.n_reporting_ccy_held, 1);
  assert.equal(merged.n_reporting_ccy_conflicts, 1);
  assert.equal(merged.n_reporting_ccy_new_periods, 0);
  assert.equal(merged.n_reporting_ccy_overdue, 0);
  assert.deepEqual(merged._reportingCcyHeld, [row]);
  const held = runGate(merged);
  assert.equal(held.status, 0, held.out);
  assert.match(held.out, /^::warning::PSQL: /m);
  assert.equal(runGate({ n_reporting_ccy_held: 0, _reportingCcyHeld: [] }).status, 0);
  const invalid = runGate({ n_reporting_ccy_held: 'x' });
  assert.equal(invalid.status, 0, 'not even a broken count of held firms stops the boards');
  assert.match(invalid.out, /^::warning::Invalid n_reporting_ccy_held\b/m);
  assert.equal(runGate({ n_ccy_missing_completely: 1, n_reporting_ccy_held: 0 }).status, 1, 'the other currency alarm stays hard');
  assert.equal(mergeManifests([shard([{ ...row, type: 'other' }])], 1, 1).n_shards_invalid, 1, 'a stable type or an invalid shard');
  // A shard whose count disagrees with its rows must not pass as a valid shard.
  const broken = mergeManifests([{ ...shard([]), n_reporting_ccy_held: 1 }], 1, 1);
  assert.equal(broken.n_shards_invalid, 1);
  // A timed-out run leaves only the incremental manifest: it must carry the count too.
  const from = source.indexOf('function writeManifestIncremental');
  assert.ok(from > 0);
  assert.match(source.slice(from, source.indexOf('\n  }', from)), /\.\.\.reportingCcyCounters\(\)/);
});

test('table: every row is proven and bounded, a USD row, a row without a quote or a bound is refused', () => {
  const rows = loadReportingCurrencyTable(TABLE_PATH);
  assert.deepEqual(Object.keys(rows), ['PSQL']);
  assert.equal(rows.PSQL.statementCurrency, 'EUR');
  assert.deepEqual(reportingCurrencyFill('OTHER', undefined, rows), { currency: undefined });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporting-ccy-'));
  try {
    const file = path.join(dir, 't.json');
    for (const [patch, why] of [[{ statementCurrency: 'USD' }, /statementCurrency/], [{ quote: '' }, /quote/], [{ url: 'http://x' }, /url/],
      [{ provenThrough: undefined }, /provenThrough/], [{ provenThrough: '2026-02-31' }, /provenThrough/], [{ provenThroughSource: '' }, /provenThroughSource/]]) {
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
