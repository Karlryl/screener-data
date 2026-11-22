'use strict';
/**
 * lib/source-priority.js — field registry for the "SEC first" rule (step 1, descriptive only).
 *
 * One entry per field a snapshot carries under metrics, timeseries and annual. Each entry names
 *   period    'quarter' | 'ttm' | 'year' | 'point' (a single current value, e.g. a quote)
 *   today     the source the pipeline writes today, read from the code path (pull-yahoo.js,
 *             scripts/opinc-source-migrate.js, scripts/fcf-ttm-overlay.js)
 *   target    sources in order of the rule: SEC concepts ('sec:<us-gaap concept>') for SEC filers,
 *             then the official home source where the project has one, or 'market' for quotes,
 *             market cap and estimates
 *   fallback  the documented substitute when no target source has a fresh value, or
 *             'empty-with-reason' (never a substitute number, T2)
 *   status    'live' (today already follows target) | 'planned' (target differs) | 'unknown'
 *   note      why, and what is not obvious
 *
 * NOTHING READS THIS FOR NUMBERS. No board value changes through this file; tests/source-priority.test.js
 * only fails when a snapshot field has no entry, so every new field must be placed under the rule.
 *
 * Cross-cutting, not repeated per entry:
 * - Vendor = Yahoo. 'yahoo-qs-*' is quoteSummary (financialData, summaryDetail, defaultKeyStatistics,
 *   incomeStatementHistory*, cashflowStatementHistory, balanceSheetHistory); 'yahoo-fts-*' is
 *   fundamentalsTimeSeries. Where both deliver a series, pull-yahoo.js picks one bundle per module
 *   (income, quarter, cash, balance) by count and density.
 * - Hand tables (configs/financial-known-cases.json, configs/yahoo-q4-known-cases.json) correct single
 *   vendor cells at pull and read time (lib/yahoo-q4-known-cases.js prepareSnapshot). They are repairs,
 *   not a source order.
 * - Every currency amount is stored in USD after one FX pass (pull-yahoo.js _convertSnapshotToUSD).
 * - SEC filers reporting under IFRS use the ifrs-full equivalents of the us-gaap concepts named here
 *   (merge-sec-xbrl.js TAXONOMIEN).
 * - Home sources the project has: EDINET (JP, jp-secannual), OpenDART (KR, kr-secannual), MOPS (TW:
 *   quarters from MOPS t164sb04, years from FinMind passing TWSE/TPEx figures through, tw-secannual),
 *   CNINFO/Eastmoney (CN and HK, cn-secannual and exchange-quarters cn/hk), NSE (IN, in-secannual),
 *   CVM (BR, exchange-quarters br). Only the operands a store actually carries are listed per field.
 */

const EMPTY = 'empty-with-reason';
const YEAR_HOME = ['EDINET', 'OpenDART', 'MOPS', 'CNINFO/Eastmoney', 'NSE', 'CVM'];
const QUARTER_REV_HOME = ['MOPS', 'CNINFO/Eastmoney', 'CVM'];
const BALANCE_HOME = ['EDINET', 'OpenDART', 'MOPS', 'CNINFO/Eastmoney', 'NSE'];
const REV = ['sec:RevenueFromContractWithCustomerExcludingAssessedTax', 'sec:Revenues',
  'sec:RevenueFromContractWithCustomerIncludingAssessedTax', 'sec:SalesRevenueNet']; // merge-sec-xbrl.js REV_CONCEPTS
const CAPEX = ['sec:PaymentsToAcquirePropertyPlantAndEquipment', 'sec:PaymentsToAcquireProductiveAssets',
  'sec:PaymentsForCapitalImprovements', 'sec:PaymentsToAcquireOilAndGasPropertyAndEquipment',
  'sec:PaymentsToAcquireOilAndGasProperty']; // lib/fcf-ttm.js CAPEX_MAIN (plus its add-on lines)

const e = (period, today, target, fallback, status, note) => ({ period, today, target, fallback, status, note });
const market = (period, today, note) => e(period, today, ['market'], EMPTY, 'live',
  'Rule 3: no SEC item, stays with market data. ' + note);

const entries = {
  // ── metrics (pull-yahoo.js mapYahooToCanonical) ─────────────────────────────────────────────
  'metrics.revenueTTM': e('ttm', 'yahoo-qs-financialData.totalRevenue', [...REV, ...QUARTER_REV_HOME],
    'yahoo-qs-financialData.totalRevenue', 'planned', 'SEC TTM revenue already exists inside lib/fcf-ttm.js for the FCF margin, not written here.'),
  'metrics.revenueGrowthYoY': e('quarter', 'yahoo-qs-financialData.revenueGrowth', [...REV, ...QUARTER_REV_HOME],
    'yahoo-qs-financialData.revenueGrowth', 'planned', 'Newest quarter against the same quarter a year earlier. The growth axis and findash deliberately do not read this scalar (src/scoring/score.js, scripts/write-findash-export.js); they use timeseries.'),
  'metrics.grossMargin': e('ttm', 'yahoo-qs-financialData.grossMargins', ['sec:GrossProfit', ...REV, 'CVM'],
    'yahoo-qs-financialData.grossMargins', 'planned', 'GrossProfit over revenue, both TTM. Plan step 4.'),
  'metrics.operatingMargin': e('ttm', 'yahoo-qs-financialData.operatingMargins', ['sec:OperatingIncomeLoss', ...REV, 'CVM'],
    'yahoo-qs-financialData.operatingMargins', 'planned', 'Plan step 4. Also feeds the computed-margin OpInc fallback for financials.'),
  'metrics.fcfMarginTTM': e('ttm', 'sec-ttm then yahoo-fts-ttm (scripts/fcf-ttm-overlay.js apply, lib/fcf-ttm.js)',
    ['sec:NetCashProvidedByUsedInOperatingActivities', ...CAPEX, ...REV], 'yahoo-fts-ttm, else ' + EMPTY, 'live',
    'Since 18.11.2026 (#138). pull-yahoo.js writes yahoo-qs-financialData.freeCashflow/totalRevenue first; the scoring-job overlay replaces it. The snapshots artifact is uploaded before the overlay and still carries the Yahoo value. No home store carries capex.'),
  'metrics.sbcRatio': e('ttm', 'none (always null, pull-yahoo.js sbcRatio = null)', ['sec:ShareBasedCompensation', ...REV],
    EMPTY, 'planned', 'Placeholder since Tag 14; nothing fills it.'),
  'metrics.insidersOwnership': market('point', 'yahoo-qs-defaultKeyStatistics.heldPercentInsiders',
    'Ownership is not an XBRL item (Form 4 and proxy tables are not companyfacts).'),
  'metrics.cashRunway': e('point', 'none (always null, pull-yahoo.js cashRunway: null)',
    ['sec:CashAndCashEquivalentsAtCarryingValue', 'sec:NetCashProvidedByUsedInOperatingActivities'], EMPTY, 'planned',
    'Placeholder; nothing fills it. Target is cash over operating cash burn if it is ever built.'),
  'metrics.priceSales': market('point', 'yahoo-qs-summaryDetail.priceToSalesTrailing12Months', 'Price ratio; the revenue denominator would follow metrics.revenueTTM.'),
  'metrics.forwardPE': market('point', 'yahoo-qs-summaryDetail.forwardPE', 'Uses analyst estimates.'),
  'metrics.pe': market('point', 'yahoo-qs-summaryDetail.trailingPE', 'Price ratio.'),
  'metrics.dividendYield': market('point', 'yahoo-qs-summaryDetail.dividendYield', 'Price ratio.'),
  'metrics.dividendStatus': market('point', 'derived from yahoo-qs-summaryDetail.dividendYield (zahlt/keine/unbekannt)', 'Follows dividendYield.'),
  'metrics.payoutRatio': e('ttm', 'yahoo-qs-summaryDetail.payoutRatio', ['sec:PaymentsOfDividendsCommonStock', 'sec:NetIncomeLoss'],
    'yahoo-qs-summaryDetail.payoutRatio', 'planned', 'Dividends over net income, both reported by the SEC; not in plan steps 0 to 4.'),
  'metrics.fiftyTwoWeekHigh': market('point', 'yahoo-qs-summaryDetail.fiftyTwoWeekHigh', 'Quote; scaled with the trading FX factor.'),
  'metrics.ebitda': e('ttm', 'yahoo-qs-financialData.ebitda', ['sec:OperatingIncomeLoss', 'sec:DepreciationDepletionAndAmortization'],
    'yahoo-qs-financialData.ebitda', 'planned', 'EBITDA is not a reported item; target is operating income plus D&A, both TTM. Plan step 4.'),
  'metrics.ebitdaMargins': e('ttm', 'yahoo-qs-financialData.ebitdaMargins', ['sec:OperatingIncomeLoss', 'sec:DepreciationDepletionAndAmortization', ...REV],
    'yahoo-qs-financialData.ebitdaMargins', 'planned', 'Plan step 4.'),
  'metrics.enterpriseValue': market('point', 'yahoo-qs-defaultKeyStatistics.enterpriseValue, or computed:ev-mixed-reading for mixed-currency rows (pull-yahoo.js _evLesart)', 'Market cap plus debt minus cash.'),
  'metrics.enterpriseToEbitda': market('point', 'yahoo-qs-defaultKeyStatistics.enterpriseToEbitda, or computed:ev-mixed-reading', 'Price ratio.'),
  'metrics.enterpriseToRevenue': market('point', 'yahoo-qs-defaultKeyStatistics.enterpriseToRevenue, or computed:ev-mixed-reading', 'Price ratio.'),
  'metrics.beta': market('point', 'yahoo-qs-defaultKeyStatistics.beta', 'Price statistic.'),
  'metrics.debtToEquity': e('point', 'yahoo-qs-financialData.debtToEquity', ['sec:LongTermDebt', 'sec:DebtCurrent', 'sec:StockholdersEquity'],
    'yahoo-qs-financialData.debtToEquity', 'planned', 'Newest balance sheet. Plan step 3 (balance sheet). Home stores carry equity but no debt.'),
  'metrics.currentRatio': e('point', 'yahoo-qs-financialData.currentRatio', ['sec:AssetsCurrent', 'sec:LiabilitiesCurrent'],
    'yahoo-qs-financialData.currentRatio', 'planned', 'Newest balance sheet. Only CNINFO/Eastmoney stores current liabilities, no home store carries current assets.'),
  'metrics.quickRatio': e('point', 'yahoo-qs-financialData.quickRatio', ['sec:CashAndCashEquivalentsAtCarryingValue', 'sec:ShortTermInvestments', 'sec:AccountsReceivableNetCurrent', 'sec:LiabilitiesCurrent'],
    'yahoo-qs-financialData.quickRatio', 'planned', 'Newest balance sheet; definition to be fixed when built.'),
  'metrics.returnOnEquity': e('ttm', 'yahoo-qs-financialData.returnOnEquity', ['sec:NetIncomeLoss', 'sec:StockholdersEquity'],
    'yahoo-qs-financialData.returnOnEquity', 'planned', 'TTM net income over equity.'),
  'metrics.returnOnAssets': e('ttm', 'yahoo-qs-financialData.returnOnAssets', ['sec:NetIncomeLoss', 'sec:Assets'],
    'yahoo-qs-financialData.returnOnAssets', 'planned', 'TTM net income over assets.'),
  'metrics.targetMeanPrice': market('point', 'yahoo-qs-financialData.targetMeanPrice', 'Analyst estimate.'),
  'metrics.targetMedianPrice': market('point', 'yahoo-qs-financialData.targetMedianPrice', 'Analyst estimate.'),
  'metrics.numberOfAnalystOpinions': market('point', 'yahoo-qs-financialData.numberOfAnalystOpinions', 'Analyst coverage.'),
  'metrics.recommendationMean': market('point', 'yahoo-qs-financialData.recommendationMean', 'Analyst estimate.'),
  'metrics.recommendationKey': market('point', 'yahoo-qs-financialData.recommendationKey', 'Analyst estimate.'),

  // ── timeseries (quarter bundle: one source for all four series, pull-yahoo.js _mergeQuarterBundle) ──
  'timeseries.revenueQ': e('quarter', 'yahoo quarter bundle (yahoo-qs-incomeStatementHistoryQuarterly or yahoo-fts quarterly, denser wins); read-time exchange fill-only of empty 2025-09-30 cells for CN/TW (lib/exchange-quarter-check.js)',
    [...REV, ...QUARTER_REV_HOME], 'yahoo quarter bundle', 'planned',
    'Next step: SEC discrete quarters (lib/sec-pit.js pitSingleQuarters, open PR #85 formula/sec-quarter-fill), not merged here because it touches the same files as the open K2 change (PR #140). Plan step 1.'),
  'timeseries.opIncQ': e('quarter', 'yahoo quarter bundle (follows revenueQ)', ['sec:OperatingIncomeLoss', 'CVM'], 'yahoo quarter bundle', 'planned', 'Moves with revenueQ. CVM: DRE 3.05.'),
  'timeseries.grossProfitQ': e('quarter', 'yahoo quarter bundle (follows revenueQ)', ['sec:GrossProfit', 'CVM'], 'yahoo quarter bundle', 'planned', 'Moves with revenueQ. CVM: DRE 3.03.'),
  'timeseries.netIncomeQ': e('quarter', 'yahoo quarter bundle (follows revenueQ)', ['sec:NetIncomeLoss', 'CVM'], 'yahoo quarter bundle', 'planned', 'Moves with revenueQ; has no Ends sibling (positional with revenueQEnds). CVM: DRE 3.11.'),
  'timeseries.reportedRevenueQEnds': e('quarter', 'hand table periodLabels (configs/financial-known-cases.json via lib/financial-known-cases.js at pull time)',
    ['sec period end of the revenueQ fact', ...QUARTER_REV_HOME], 'null end (unknown date, never a shifted one)', 'planned',
    'The period end the company printed where the vendor dates month ends. With SEC or home quarters the filed end is the source itself.'),

  // ── annual (income bundle, cash bundle, balance rule in pull-yahoo.js; OpInc via opinc-source-migrate.js) ──
  'annual.annualRev': e('year', 'yahoo income bundle (yahoo-qs-incomeStatementHistory or yahoo-fts annual, more revenue years wins)', [...REV, ...YEAR_HOME],
    'yahoo income bundle', 'planned', 'SEC and home years reach scoring only through the separate snapshot.secAnnual channel (cycle damper) and as alignment proof for annualOpInc. Plan step 3.'),
  'annual.annualOpInc': e('year', 'sec-gaap where a SEC/EDINET/OpenDART/MOPS(FinMind) series exists and revenue alignment over the whole window holds within 2 % (scripts/opinc-source-migrate.js), else yahoo-adjusted; financials without a line use computed-bank/-insurance/-margin',
    ['sec:OperatingIncomeLoss', ...YEAR_HOME], 'yahoo income bundle', 'planned',
    'Live for SEC filers since 29.08.2026; CNINFO/Eastmoney, NSE and CVM layers are not wired (cn-secannual, in-secannual not in SECANNUAL_FILES). Label in meta.opIncSource.'),
  'annual.annualOpIncYahoo': e('year', 'yahoo (kept copy of the replaced series, scripts/opinc-source-migrate.js)', ['yahoo'], 'absent (only on sec-gaap rows)', 'live',
    'Reference copy, not a shown number: the vendor series behind a sec-gaap annualOpInc, read by build-secannual looseSanity. Written in the scoring job, so the snapshots artifact never carries it.'),
  'annual.annualNetIncome': e('year', 'yahoo income bundle', ['sec:NetIncomeLoss', ...YEAR_HOME], 'yahoo income bundle', 'planned', 'Plan step 3.'),
  'annual.annualGP': e('year', 'yahoo income bundle, years without GP derived as revenue minus cost of revenue (meta.gpSource)', ['sec:GrossProfit', ...YEAR_HOME],
    'yahoo income bundle', 'planned', 'Plan step 3.'),
  'annual.annualCostOfRevenue': e('year', 'yahoo income bundle', ['sec:CostOfRevenue', 'sec:CostOfGoodsAndServicesSold'], 'yahoo income bundle', 'planned', 'Operand of the GP derivation. No home store carries it.'),
  'annual.annualFCF': e('year', 'yahoo cash bundle (operating cash flow plus capex, yahoo-qs-cashflowStatementHistory or yahoo-fts annual)', ['sec:NetCashProvidedByUsedInOperatingActivities', ...CAPEX],
    'yahoo cash bundle', 'planned', 'No home store carries capex. Plan step 3.'),
  'annual.annualOCF': e('year', 'yahoo cash bundle', ['sec:NetCashProvidedByUsedInOperatingActivities', ...YEAR_HOME], 'yahoo cash bundle', 'planned', 'CVM: DFC 6.01. Plan step 3.'),
  'annual.annualCapex': e('year', 'yahoo-fts annual capitalExpenditure', CAPEX, 'yahoo-fts annual', 'planned', 'Aligned to the cash bundle axis.'),
  'annual.annualBalance': e('year', 'yahoo balance (yahoo-qs-balanceSheetHistory or yahoo-fts annual, schema rule chooseAnnualBalance)',
    ['sec:CashAndCashEquivalentsAtCarryingValue', 'sec:LongTermDebt', 'sec:DebtCurrent', 'sec:Assets', 'sec:AccountsReceivableNetCurrent',
      'sec:PropertyPlantAndEquipmentNet', 'sec:AssetsCurrent', 'sec:LiabilitiesCurrent', 'sec:Liabilities', 'sec:StockholdersEquity', ...BALANCE_HOME],
    'yahoo balance', 'planned', 'Rows of instants at fiscal year end (totalCash, totalDebt, totalAssets, accountsReceivable, netPPE, currentAssets, currentLiabilities, totalLiabilities, totalEquity). Home stores carry assets and equity only. Plan step 3.'),
  'annual.annualRnD': e('year', 'yahoo-qs-incomeStatementHistory.researchDevelopment, yahoo-fts annual when strictly more years', ['sec:ResearchAndDevelopmentExpense'],
    'yahoo', 'planned', 'No home store carries it.'),
  'annual.annualSBC': e('year', 'yahoo-fts annual stockBasedCompensation', ['sec:ShareBasedCompensation'], 'yahoo-fts annual', 'planned', 'Plan step 3 (SBC).'),
  'annual.annualSGA': e('year', 'yahoo-fts annual sellingGeneralAndAdministration', ['sec:SellingGeneralAndAdministrativeExpense'], 'yahoo-fts annual', 'planned', 'No home store carries it.'),
  'annual.annualDepreciation': e('year', 'yahoo-fts annual depreciationAndAmortization', ['sec:DepreciationDepletionAndAmortization'], 'yahoo-fts annual', 'planned', 'No home store carries it.'),
  'annual.annualShares': e('year', 'yahoo-fts annual dilutedAverageShares, else basicAverageShares, else balance ordinarySharesNumber', ['sec:EntityCommonStockSharesOutstanding (dei)',
    'sec:CommonStockSharesOutstanding', 'sec:WeightedAverageNumberOfSharesOutstandingBasic', 'EDINET', 'OpenDART', 'MOPS', 'CNINFO/Eastmoney', 'NSE'],
    'yahoo-fts annual', 'planned', 'Concept order of merge-sec-xbrl.js SHARE_CONCEPTS. Plan step 2: one share definition (changes dilution).'),
  'annual.annualRepurchase': e('year', 'yahoo-fts annual repurchaseOfCapitalStock', ['sec:PaymentsForRepurchaseOfCommonStock'], 'yahoo-fts annual', 'planned', 'Written only with at least one value.'),
  'annual.annualDividendsPaid': e('year', 'yahoo-fts annual cashDividendsPaid', ['sec:PaymentsOfDividends', 'sec:PaymentsOfDividendsCommonStock'], 'yahoo-fts annual', 'planned', 'Written only with at least one value.'),
  'annual.annualNetCommonStockIssuance': e('year', 'yahoo-fts annual netCommonStockIssuance', ['sec:ProceedsFromIssuanceOfCommonStock', 'sec:PaymentsForRepurchaseOfCommonStock'],
    'yahoo-fts annual', 'planned', 'Not a single SEC item: issuance minus repurchase. Written only with at least one value.'),
};

// Period-end siblings carry the dates of their series and follow its source.
const SIBLINGS = {
  'timeseries.revenueQEnds': 'timeseries.revenueQ', 'timeseries.grossProfitQEnds': 'timeseries.grossProfitQ',
  'timeseries.opIncQEnds': 'timeseries.opIncQ', 'annual.annualRevEnds': 'annual.annualRev',
  'annual.annualOpIncEnds': 'annual.annualOpInc', 'annual.annualNetIncomeEnds': 'annual.annualNetIncome',
  'annual.annualGPEnds': 'annual.annualGP', 'annual.annualFCFEnds': 'annual.annualFCF', 'annual.annualOCFEnds': 'annual.annualOCF',
  'annual.annualCapexEnds': 'annual.annualCapex', 'annual.annualBalanceEnds': 'annual.annualBalance', 'annual.annualRnDEnds': 'annual.annualRnD',
  'annual.annualSBCEnds': 'annual.annualSBC', 'annual.annualSGAEnds': 'annual.annualSGA', 'annual.annualDepreciationEnds': 'annual.annualDepreciation',
  'annual.annualSharesEnds': 'annual.annualShares', 'annual.annualRepurchaseEnds': 'annual.annualRepurchase',
  'annual.annualDividendsPaidEnds': 'annual.annualDividendsPaid', 'annual.annualNetCommonStockIssuanceEnds': 'annual.annualNetCommonStockIssuance',
};
for (const [key, parent] of Object.entries(SIBLINGS)) {
  const p = entries[parent];
  entries[key] = e(p.period, 'period ends of ' + parent + ' (' + p.today + ')', ['period end of the source chosen for ' + parent],
    'null end (unknown date, never a shifted one)', p.status, 'Sibling of ' + parent + '; moves with it.');
}

const REGISTRY = Object.freeze(Object.fromEntries(Object.entries(entries).map(([k, v]) =>
  [k, Object.freeze({ ...v, target: Object.freeze(v.target.slice()) })])));
const CONTAINERS = Object.freeze(['metrics', 'timeseries', 'annual']);

/**
 * Field keys ("metrics.<k>", "timeseries.<k>", "annual.<k>") a snapshot carries, sorted.
 * A container that is absent or not a plain object contributes nothing.
 * @param {object} snapshot Snapshot as written to snapshots/<ticker>.json.
 * @returns {string[]}
 */
function fieldsOf(snapshot) {
  const out = [];
  for (const c of CONTAINERS) {
    const block = snapshot && snapshot[c];
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    for (const k of Object.keys(block)) out.push(c + '.' + k);
  }
  return out.sort();
}

/**
 * Field keys of a snapshot that have no registry entry, sorted (empty when every field is placed).
 * @param {object} snapshot Snapshot as written to snapshots/<ticker>.json.
 * @returns {string[]}
 */
function missingEntries(snapshot) {
  return fieldsOf(snapshot).filter(k => !Object.hasOwn(REGISTRY, k));
}

module.exports = { REGISTRY, CONTAINERS, fieldsOf, missingEntries };
