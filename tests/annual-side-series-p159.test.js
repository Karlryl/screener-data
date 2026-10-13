'use strict';

// Reuse the offline pull fixture; its own suite and real filesystem writers never run.
// Writing tests are never mutation targets; --break-once copies only pull-yahoo.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const live = path.resolve(__dirname, '../pull-yahoo.js');
const original = fs.readFileSync(live, 'utf8');
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(live)).digest('hex');
const fixtureFile = path.join(__dirname, 'stale-quarter-reload.test.js');
const harness = fs.readFileSync(fixtureFile, 'utf8').split('if (require.main === module)');
assert.equal(harness.length, 2, 'Unique offline fixture entry');
const fixtureModule = { exports: {} };
vm.runInThisContext('(function(require, __dirname, module) {\n' + harness[0]
  + '\nmodule.exports = { fixture, snapshot, root };\n})', { filename: fixtureFile })(
  createRequire(fixtureFile), __dirname, fixtureModule);
const { fixture, snapshot, root } = fixtureModule.exports;

async function regression(pullSource) {
  for (const kind of ['equal-dates', 'older-fts', 'undated-fts', 'same-window']) {
    const ticker = 'P159SIDE';
    const latest = kind === 'older-fts' ? 2026 : 2025;
    const count = kind === 'same-window' ? 4 : 5;
    const income = Array.from({ length: count }, (_, i) => ({
      date: kind === 'undated-fts' ? undefined : `${2026 - count + i}-12-31`,
      totalRevenue: count === 5 && i === 2 ? null : 100,
      grossProfit: count === 5 && i === 2 ? null : 20,
      operatingIncome: count === 5 && i === 2 ? null : 10,
      netIncome: count === 5 && i === 2 ? null : 5,
      sellingGeneralAndAdministration: i + 11, researchAndDevelopment: i + 21,
    }));
    const cash = income.map((row, i) => ({ date: row.date,
      stockBasedCompensation: i + 1, capitalExpenditure: -(i + 31),
      depreciationAndAmortization: i + 41, repurchaseOfCapitalStock: -(i + 51),
      cashDividendsPaid: -(i + 61), netCommonStockIssuance: -(i + 71),
      freeCashFlow: 10, operatingCashFlow: 15,
    }));
    const f = fixture({ pullSource, snapshots: [snapshot(ticker)], manual: [ticker],
      env: { STALE_QUARTER_RELOAD: '0' },
      annualResponses: { financials: income, 'cash-flow': cash,
        'balance-sheet': income.map((row, i) => ({ date: row.date, totalAssets: 1000 + i, currentAssets: 200 })) },
      summaryResponse: { price: { currency: 'USD', regularMarketPrice: 100, marketCap: 1e12 },
        financialData: { financialCurrency: 'USD' }, quoteType: { quoteType: 'EQUITY' },
        summaryProfile: { sector: 'Technology', industry: 'Software' },
        incomeStatementHistory: { incomeStatementHistory: Array.from({ length: 4 }, (_, i) => ({
          endDate: `${latest - i}-12-31`, totalRevenue: 100, grossProfit: 20, operatingIncome: 10, netIncome: 5,
        })) } },
    });
    f.files.delete(path.join(root, 'fundamentals-cache', ticker + '.json'));
    const result = await f.run();
    assert.equal(result.results[0].status, 'ok', kind + ': real pull succeeds');
    assert.equal(f.calls.filter(call => call[1].includes('/')).length, 4, 'Actual FTS fetch path');
    const out = f.stored(ticker);
    const shifted = kind === 'older-fts' || kind === 'undated-fts';
    const fields = {
      annualSBC: cash.map(row => row.stockBasedCompensation),
      annualCapex: cash.map(row => row.capitalExpenditure),
      annualRnD: income.map(row => row.researchAndDevelopment),
      annualSGA: income.map(row => row.sellingGeneralAndAdministration),
      annualDepreciation: cash.map(row => row.depreciationAndAmortization),
      annualRepurchase: cash.map(row => row.repurchaseOfCapitalStock),
      annualDividendsPaid: cash.map(row => row.cashDividendsPaid),
      annualNetCommonStockIssuance: cash.map(row => row.netCommonStockIssuance),
      annualBalance: income.map((_, i) => 1000 + i),
    };
    const ends = income.map(row => row.date || null).reverse();
    for (const [field, oldestFirst] of Object.entries(fields)) {
      const expected = oldestFirst.slice().reverse();
      const fieldShifted = shifted && field !== 'annualCapex'; // Capex stays with the FTS cash winner for FCF - Capex.
      if (fieldShifted) expected.unshift(null);
      const actual = field === 'annualBalance' ? out.annual[field].map(row => row?.totalAssets ?? null) : out.annual[field];
      assert.deepEqual(actual, expected, `${kind}/${field}: values stay on their fiscal anchor`);
      const expectedEnds = fieldShifted ? [null, ...ends] : ends;
      assert.deepEqual(out.annual[field + 'Ends'], expectedEnds, `${kind}/${field}: period ends`);
      assert.deepEqual(out.meta.statementPeriods[field].map(period => period?.end ?? null), expectedEnds,
        `${kind}/${field}: statement evidence`);
    }
    assert.equal(out.annual.annualRevEnds[0], `${latest}-12-31`);
    assert.equal(out.annual.annualRev[0].value, 100, 'Income winner stays unchanged');
    console.log('PASS P159 annual: ' + kind + ', nine side series and their dates');
  }
}

async function moduleRegression(pullSource) {
  const cases = [
    { name: 'reviewer', cash: 2025, balance: 2025, shifts: [0, 1, 1] },
    { name: 'qs-cash-winner', cash: 2025, balance: 2025, qsCash: true, shifts: [0, 1, 1] },
    { name: 'KBCA.VI-shaped', cash: 2025, balance: 2025, shifts: [0, 1, 1] },
    { name: 'CTYMF-shaped', cash: 2024, balance: 2024, nullSBC: true, shifts: [0, 2, 2] },
    { name: 'WTC.AX-shaped', cash: 2024, balance: 2024, nullSBC: true, shifts: [0, 2, 2] },
    { name: 'cash-only-lag', cash: 2025, balance: 2026, shifts: [0, 1, 0] },
    { name: 'balance-only-lag', cash: 2026, balance: 2025, shifts: [0, 0, 1] },
    { name: 'income-only-lag', income: 2025, cash: 2026, balance: 2026, shifts: [1, 0, 0] },
    { name: 'fts-winner-unchanged', cash: 2025, balance: 2024, ftsWins: true, shifts: [0, 0, 0] },
    { name: 'undated-cash-long', cash: 2026, balance: 2026, undated: 'cash', shifts: [0, 1, 0] },
    { name: 'undated-cash-short', cash: 2024, balance: 2026, undated: 'cash', shifts: [0, 0, 0] },
    { name: 'undated-balance-long', cash: 2026, balance: 2026, undated: 'balance', shifts: [0, 0, 1] },
    { name: 'undated-balance-short', cash: 2026, balance: 2024, undated: 'balance', shifts: [0, 0, 0] },
    { name: 'newer-cash', latest: 2025, income: 2025, cash: 2026, balance: 2025, shifts: [0, 0, 0] },
    { name: 'unmatched-dated-cash', cash: 2025, balance: 2026, cashDay: '12-31', shifts: [0, 0, 0] },
    { name: 'undated-winner', cash: 2025, balance: 2024, undatedWinner: true, shifts: [0, 0, 0] },
    { name: 'undated-leading-cash-slot', cash: 2026, balance: 2026, leadingUndatedCash: true, shifts: [0, 0, 0] },
    { name: 'undated-income-short-window', cash: 2026, balance: 2026, undated: 'income', trimmedIncome: true, shifts: [0, 0, 0] },
    { name: 'SGLD-shaped', latest: 2014, income: 2025, cash: 2025, balance: 2025, shifts: [null, null, null] },
    { name: 'newer-cash-380-days', latest: 2024, cash: 2025, cashDay: '07-15', balance: 2024, shifts: [0, 0, 0] },
    { name: 'newer-cash-381-days', latest: 2024, cash: 2025, cashDay: '07-16', balance: 2024, shifts: [0, null, 0] },
    { name: 'fts-winner-newer-cash', latest: 2014, income: 2014, cash: 2025, balance: 2014, ftsWins: true, shifts: [0, null, 0] },
  ];
  for (const c of cases) {
    const latest = c.latest || 2026, ticker = 'P159MODULE';
    const datedRows = (module, newest, count) => Array.from({ length: count }, (_, i) => {
      const year = newest - count + i + 1;
      return { date: c.undated === module ? undefined : `${year}-${module === 'cash' ? c.cashDay || '06-30' : '06-30'}`, year };
    });
    const income = datedRows('income', c.income || latest, 5).map((r, i) => ({ ...r,
      totalRevenue: (c.trimmedIncome ? i < 2 : i === 2 && !c.ftsWins) ? null : 100,
      grossProfit: (c.trimmedIncome ? i < 2 : i === 2 && !c.ftsWins) ? null : 20,
      operatingIncome: (c.trimmedIncome ? i < 2 : i === 2 && !c.ftsWins) ? null : 10,
      netIncome: (c.trimmedIncome ? i < 2 : i === 2 && !c.ftsWins) ? null : 5,
      researchAndDevelopment: r.year + 10, sellingGeneralAndAdministration: r.year + 20,
    }));
    const cash = datedRows('cash', c.cash, c.cash - 2021).map(r => ({ ...r,
      stockBasedCompensation: c.nullSBC ? null : r.year, capitalExpenditure: -r.year - 10,
      depreciationAndAmortization: r.year + 20, repurchaseOfCapitalStock: -r.year - 30,
      cashDividendsPaid: -r.year - 40, netCommonStockIssuance: -r.year - 50,
      freeCashFlow: 10, operatingCashFlow: c.ftsWins && r.year === 2024 ? null : 15,
    }));
    if (c.leadingUndatedCash) cash[cash.length - 1].date = undefined;
    const balance = datedRows('balance', c.balance, Math.max(1, c.balance - 2021)).map(r => ({ ...r,
      totalAssets: r.year, currentAssets: 200,
    }));
    const summaryIncome = Array.from({ length: 4 }, (_, i) => ({
      endDate: c.undatedWinner ? undefined : `${latest - i}-06-30`,
      totalRevenue: 100, grossProfit: 20, operatingIncome: 10, netIncome: 5,
    }));
    const f = fixture({ pullSource, snapshots: [snapshot(ticker)], manual: [ticker],
      env: { STALE_QUARTER_RELOAD: '0' },
      annualResponses: { financials: income, 'cash-flow': cash, 'balance-sheet': balance },
      summaryResponse: { price: { currency: 'USD', regularMarketPrice: 100, marketCap: 1e12 },
        financialData: { financialCurrency: 'USD' }, quoteType: { quoteType: 'EQUITY' },
        summaryProfile: { sector: 'Technology', industry: 'Software' },
        cashflowStatementHistory: { cashflowStatements: c.qsCash ? summaryIncome.map(row => ({
          endDate: row.endDate, totalCashFromOperatingActivities: 25, capitalExpenditures: -5,
        })) : [] },
        incomeStatementHistory: { incomeStatementHistory: summaryIncome } },
    });
    f.files.delete(path.join(root, 'fundamentals-cache', ticker + '.json'));
    const fields = [
      ['annualSBC', cash, 'stockBasedCompensation', 1], ['annualCapex', cash, 'capitalExpenditure', 1],
      ['annualRnD', income, 'researchAndDevelopment', 0], ['annualSGA', income, 'sellingGeneralAndAdministration', 0],
      ['annualDepreciation', cash, 'depreciationAndAmortization', 1],
      ['annualRepurchase', cash, 'repurchaseOfCapitalStock', 1], ['annualDividendsPaid', cash, 'cashDividendsPaid', 1],
      ['annualNetCommonStockIssuance', cash, 'netCommonStockIssuance', 1], ['annualBalance', balance, 'totalAssets', 2],
    ];
    for (const pass of ['fetch', 'cache']) {
      const result = await f.run();
      assert.equal(result.results[0].status, 'ok', `${c.name}/${pass}: real pull succeeds`);
      assert.equal(f.calls.filter(call => call[1].includes('/')).length, 4, `${c.name}/${pass}: one real FTS fetch, then cache`);
      const out = f.stored(ticker), annual = out.annual;
      for (const [field, rows, key, module] of fields) {
        if (c.shifts[module] === null) {
          assert.equal((annual[field] || []).some(value => value != null), false, `${c.name}/${field}: no cross-year ratio input`);
          assert.equal((annual[field + 'Ends'] || []).some(Boolean), false, `${c.name}/${field}: no claimed aligned dates`);
          assert.equal((out.meta.statementPeriods[field] || []).some(Boolean), false, `${c.name}/${field}: no claimed aligned evidence`);
          continue;
        }
        const prefix = Array(field === 'annualCapex' && !c.qsCash ? 0 : c.shifts[module]).fill(null); // Capex follows the FCF/OCF winner's axis.
        const expected = [...prefix, ...rows.map(row => row[key] ?? null).reverse()];
        const expectedEnds = [...prefix, ...rows.map(row => row.date || null).reverse()];
        const actual = field === 'annualBalance' ? annual[field].map(row => row?.totalAssets ?? null) : annual[field];
        assert.deepEqual(actual, expected, `${c.name}/${pass}/${field}: module-specific fiscal slots`);
        assert.deepEqual(annual[field + 'Ends'], expectedEnds, `${c.name}/${pass}/${field}: own dates`);
        assert.deepEqual(out.meta.statementPeriods[field].map(p => p?.end ?? null), expectedEnds,
          `${c.name}/${pass}/${field}: matching statement evidence`);
      }
      if (c.shifts[1] === null) assert.equal(require('../src/scoring/axes.js').dilution(out), null, c.name + ': no SBC over old revenue');
      const winnerRows = c.ftsWins ? income.slice().reverse() : summaryIncome;
      assert.deepEqual(annual.annualRevEnds, winnerRows.map(row => row.date || row.endDate || null), c.name + ': winner dates unchanged');
      assert.deepEqual(annual.annualRev.map(row => row?.value ?? null), winnerRows.map(row => row.totalRevenue), c.name + ': winner values unchanged');
      // The existing cash bundle is a separate merge; F-05 must not alter it.
      assert.deepEqual(annual.annualFCF, c.qsCash ? summaryIncome.map(() => ({ value: 20 })) : cash.map(() => ({ value: 10 })).reverse(), c.name + ': FCF unchanged');
      assert.deepEqual(annual.annualFCFEnds, c.qsCash ? summaryIncome.map(row => row.endDate) : cash.map(row => row.date || null).reverse(), c.name + ': FCF dates unchanged');
    }
    console.log('PASS P159b annual: ' + c.name + ', nine series, dates and evidence, fetch + cache');
  }
}

async function cashflowRegression(pullSource) {
  const income = Array.from({ length: 4 }, (_, i) => ({ date: `${2023 + i}-06-30`, totalRevenue: 100,
    grossProfit: 20, operatingIncome: -(i + 2) * 10, netIncome: -5 }));
  const cash = [[2022, 30, 50, -20], [2023, 10, 30, -20], [2024, -80, null, -100], [2025, -30, -20, -10]]
    .map(([year, freeCashFlow, operatingCashFlow, capitalExpenditure]) => ({ date: `${year}-06-30`,
      freeCashFlow, operatingCashFlow, capitalExpenditure, stockBasedCompensation: 1, depreciationAndAmortization: 1 }));
  const ticker = 'P159QSWIN';
  const f = fixture({ pullSource, snapshots: [snapshot(ticker)], manual: [ticker], env: { STALE_QUARTER_RELOAD: '0' },
    annualResponses: { financials: income, 'cash-flow': cash,
      'balance-sheet': income.map(row => ({ date: row.date, totalAssets: 1000, currentAssets: 200 })) },
    summaryResponse: { price: { currency: 'USD', regularMarketPrice: 100, marketCap: 1e12 },
      financialData: { financialCurrency: 'USD' }, quoteType: { quoteType: 'EQUITY' },
      summaryProfile: { sector: 'Technology', industry: 'Software' },
      incomeStatementHistory: { incomeStatementHistory: income.slice().reverse().map(row => ({ ...row, endDate: row.date })) } },
  });
  f.files.delete(path.join(root, 'fundamentals-cache', ticker + '.json'));
  for (const pass of ['fetch', 'cache']) {
    assert.equal((await f.run()).results[0].status, 'ok');
    const out = f.stored(ticker), annual = out.annual;
    assert.equal(annual.annualOCF[1]?.value ?? null, null, 'OCF is genuinely missing');
    assert.equal(annual.annualFCF[1].value - annual.annualCapex[1], 20, pass + ': OCF fallback uses the same fiscal year');
    assert.deepEqual(annual.annualCapex, [-10, -100, -20, -20]);
    assert.deepEqual(annual.annualCapexEnds, annual.annualFCFEnds);
    assert.deepEqual(out.meta.statementPeriods.annualCapex, out.meta.statementPeriods.annualFCF);
    const lamps = require('../src/scoring/lamps.js');
    assert.equal(lamps.burnAccelerating(out), true);
    assert.equal(lamps.burnPressFactor(out), 0.7142857142857143);
  }
  console.log('PASS P159b cashflow: OCF 20, burn factor 0.7142857142857143, fetch + cache');
}

(async () => {
  await regression(original);
  await moduleRegression(original);
  await cashflowRegression(original);
  if (!process.argv.includes('--break-once')) return;
  const before = hash();
  const base = fs.realpathSync(process.env.P159_TEMP_DIR || os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(base, 'p159-annual-'));
  const target = path.resolve(scratch, 'pull-yahoo.js');
  try {
    assert.notEqual(target, live);
    assert.notEqual(target, path.resolve(__filename));
    assert.equal(path.dirname(target), fs.realpathSync(scratch));
    const lines = original.split(/\r?\n/);
    const mutations = [
      ['same-dated income', "          income: moduleShift('income', ftsAnnual.annualRev, ftsAnnual.annualRevEnds),",
        '          income: _incomeWinnerIsQS && ftsAnnual.annualRev.length > _winner.annualRev.length ? 1 : 0,', regression, /equal-dates\/annualRnD/],
      ['cash coupled to income', "          cash: moduleShift('cash', ftsAnnualSBC, ftsAnnual.annualOCFEnds),",
        "          cash: moduleShift('income', ftsAnnualRnD, ftsAnnual.annualRevEnds),", moduleRegression, /reviewer\/fetch\/annualSBC/],
      ['balance coupled to income', "          balance: moduleShift('balance', ftsBalance),",
        "          balance: moduleShift('income', ftsAnnualRnD, ftsAnnual.annualRevEnds),", moduleRegression, /reviewer\/fetch\/annualBalance/],
      ['Capex ignores cash winner', '        const capexShift = _cashWinner === _qsCash || _ftsAnnualShifts.cash === null ? _ftsAnnualShifts.cash : 0;',
        '        const capexShift = _ftsAnnualShifts.cash;', cashflowRegression, /OCF fallback uses the same fiscal year/],
      ['newer module paired with old income', '          if (Date.parse(newest) - Date.parse(winnerEnds[0]) > FISCAL_YEAR_STEP_DAYS.max * 86400000) return null;',
        '          if (Date.parse(newest) - Date.parse(winnerEnds[0]) > FISCAL_YEAR_STEP_DAYS.max * 86400000) return 0;', moduleRegression, /SGLD-shaped\/annualSBC: no cross-year/],
      ['undated income uses RnD window', "          income: moduleShift('income', ftsAnnual.annualRev, ftsAnnual.annualRevEnds),",
        "          income: moduleShift('income', ftsAnnualRnD, ftsAnnual.annualRevEnds),", moduleRegression, /undated-income-short-window\/fetch\/annualRnD/],
    ];
    for (const [name, anchor, oldLine, run, message] of mutations) {
      assert.equal(lines.filter(line => line === anchor).length, 1, 'Complete-line mutation anchor');
      fs.writeFileSync(target, lines.map(line => line === anchor ? oldLine : line).join('\n'));
      await assert.rejects(() => run(fs.readFileSync(target, 'utf8')), error => {
        assert.equal(error.code, 'ERR_ASSERTION');
        assert.match(error.message, message);
        console.log('BREAK-ONCE RED F-05 ' + name + ': ' + error.message);
        return true;
      });
      assert.equal(hash(), before, 'Live source must remain byte-identical after each mutation');
    }
  } finally {
    assert.equal(hash(), before, 'Live source must remain byte-identical');
    assert.equal(path.dirname(fs.realpathSync(scratch)), base);
    fs.rmSync(scratch, { recursive: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
