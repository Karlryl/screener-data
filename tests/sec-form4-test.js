#!/usr/bin/env node
/**
 * Tag 210e: Standalone smoke test for scripts/pull-insider-form4.js.
 *
 * Why standalone: tag28-tests.js is the canonical test harness but it's
 * being concurrently edited by sibling agents in this wave, so per
 * parallel_agent_race.md (CLAUDE memory) we own a separate file here.
 *
 * What it covers (all offline — no network):
 *   1. parseForm4Xml() pulls structured transactions from a hand-crafted
 *      minimal Form 4 XML doc — verifying the regex-based parser handles
 *      the <value>X</value> wrapper, multiple <nonDerivativeTransaction>
 *      blocks, and the reporting-owner relationship flags.
 *      1c/1d (audit/fix BH-036): a joint filing's multi-owner owners[] and
 *      a mixed-filing per-transaction 10b5-1 flag — the NEW parser
 *      contracts added by the BH-022/BH-023 fixes.
 *   2. selectUsTickers() keeps US-listed entries and drops foreign ones
 *      (China-A `.SZ`, Toronto `.TO`) when given a synthetic ticker→CIK
 *      map.
 *   3. _normalizeSubmissions() zips the SEC parallel-array shape into
 *      one row per filing, and _withinLookback() correctly windows dates
 *      — fixture dates are computed RELATIVE TO Date.now() (audit/fix
 *      BH-036: this used to hardcode 2026-04-20/2026-05-10, which goes
 *      falsely-red once "now" drifts past ~180d from those dates).
 *   4. (audit/fix BH-036) scripts/pull-insider-form4-daily.js's daily-index
 *      contracts: a 4/A amendment parses distinctly from a plain 4
 *      (parseDailyForm4Rows), and the widened txnKey (BH-025) no longer
 *      collides two real same-day multi-lot transactions at different
 *      prices.
 *
 * Run:
 *   & "C:\Program Files\nodejs\node.exe" tests/sec-form4-test.js
 *
 * Exits non-zero on any assertion failure (CI-friendly).
 */
'use strict';

const path = require('path');
const mod = require(path.join(__dirname, '..', 'scripts', 'pull-insider-form4.js'));
const dailyMod = require(path.join(__dirname, '..', 'scripts', 'pull-insider-form4-daily.js'));

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('  FAIL: ' + msg);
  } else {
    console.log('  ok: ' + msg);
  }
}

// ─── 1. parseForm4Xml: hand-crafted minimal valid Form 4 XML ────────────
// Pattern: one director with isOfficer=true, two non-derivative transactions
// (one P=purchase 100 sh @ $50.00, one S=sale 50 sh @ $60.00).
const SAMPLE_XML = `<?xml version="1.0"?>
<ownershipDocument>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0000123456</rptOwnerCik>
      <rptOwnerName>Doe, Jane</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>true</isDirector>
      <isOfficer>true</isOfficer>
      <isTenPercentOwner>false</isTenPercentOwner>
      <isOther>false</isOther>
      <officerTitle>Chief Financial Officer</officerTitle>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-05-01</value></transactionDate>
      <transactionCoding>
        <transactionFormType>4</transactionFormType>
        <transactionCode>P</transactionCode>
        <equitySwapInvolved>0</equitySwapInvolved>
      </transactionCoding>
      <transactionAmounts>
        <transactionShares><value>100</value></transactionShares>
        <transactionPricePerShare><value>50.00</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-05-05</value></transactionDate>
      <transactionCoding>
        <transactionFormType>4</transactionFormType>
        <transactionCode>S</transactionCode>
      </transactionCoding>
      <transactionAmounts>
        <transactionShares><value>50</value></transactionShares>
        <transactionPricePerShare><value>60.00</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

console.log('# 1. parseForm4Xml');
const txns = mod.parseForm4Xml(SAMPLE_XML);
assert(Array.isArray(txns), 'parseForm4Xml returns array');
assert(txns.length === 2, 'extracts 2 transactions (got ' + txns.length + ')');
if (txns.length === 2) {
  const [buy, sell] = txns;
  assert(buy.transactionCode === 'P', 'buy.transactionCode == P (got ' + buy.transactionCode + ')');
  assert(buy.transactionShares === 100, 'buy.transactionShares == 100 (got ' + buy.transactionShares + ')');
  assert(buy.transactionPricePerShare === 50, 'buy.transactionPricePerShare == 50');
  assert(buy.transactionDate === '2026-05-01', 'buy.transactionDate == 2026-05-01');
  assert(buy.acquiredDisposed === 'A', 'buy.acquiredDisposed == A');
  assert(buy.reportingPersonName === 'Doe, Jane', 'reportingPersonName extracted');
  assert(buy.reportingPersonRelationship && buy.reportingPersonRelationship.isOfficer === true,
    'reportingPersonRelationship.isOfficer == true');
  assert(buy.reportingPersonRelationship.isTenPercentOwner === false,
    'reportingPersonRelationship.isTenPercentOwner == false');
  assert(buy.reportingPersonRelationship.officerTitle === 'Chief Financial Officer',
    'officerTitle extracted');
  assert(sell.transactionCode === 'S', 'sell.transactionCode == S');
  assert(sell.transactionShares === 50, 'sell.transactionShares == 50');
}

// Empty / malformed XML: parser should return [] not throw.
console.log('# 1b. parseForm4Xml on empty/malformed input');
assert(mod.parseForm4Xml('').length === 0, 'empty string → [] ');
assert(mod.parseForm4Xml('<not><a>form4</a></not>').length === 0, 'unrelated XML → []');

// ─── 2. selectUsTickers: filter watchlist via map ───────────────────────
console.log('# 2. selectUsTickers');
const fakeWatchlist = {
  stocks: [
    { ticker: 'AAPL', yahoo_symbol: 'AAPL' },
    { ticker: 'MSFT', yahoo_symbol: 'MSFT' },
    { ticker: '000001.SZ', yahoo_symbol: '000001.SZ', exchange_hint: 'CHINA_A' },
    { ticker: 'SHOP.TO', yahoo_symbol: 'SHOP.TO' },
    { ticker: 'NVDA', yahoo_symbol: 'NVDA' },
    { ticker: '', yahoo_symbol: '' }
  ]
};
const fakeMap = {
  AAPL: { cik: '0000320193', name: 'Apple Inc.' },
  MSFT: { cik: '0000789019', name: 'Microsoft Corp' },
  NVDA: { cik: '0001045810', name: 'NVIDIA Corp' }
};
const picked = mod.selectUsTickers(fakeWatchlist, fakeMap);
assert(picked.length === 3, 'picks 3 US tickers (got ' + picked.length + ')');
const pickedTickers = picked.map(p => p.ticker).sort().join(',');
assert(pickedTickers === 'AAPL,MSFT,NVDA',
  'picks AAPL,MSFT,NVDA (got ' + pickedTickers + ')');

// ─── 3. _normalizeSubmissions + _withinLookback ─────────────────────────
// audit/fix BH-036: fixture dates computed RELATIVE TO NOW instead of
// hardcoded 2026-xx-xx literals — those go falsely-red the moment "today"
// drifts far enough that the hardcoded "recent" dates fall outside the 180d
// window (found in the audit: true already by ~2026-10 for the old fixture).
function isoDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
console.log('# 3. _normalizeSubmissions + _withinLookback');
const fakeSub = {
  filings: {
    recent: {
      form: ['4', '10-K', '4', '4'],
      filingDate: [isoDaysAgo(20), isoDaysAgo(60), isoDaysAgo(400), isoDaysAgo(90)],
      accessionNumber: ['0000001-26-000001', '0000001-26-000002', '0000001-24-000001', '0000001-26-000003'],
      primaryDocument: ['form4a.xml', '10k.htm', 'form4b.xml', 'form4c.xml']
    }
  }
};
const rows = mod._internals._normalizeSubmissions(fakeSub);
assert(rows.length === 4, 'normalised 4 filings (got ' + rows.length + ')');
const form4Recent = rows.filter(r => r.form === '4' &&
  mod._internals._withinLookback(r.filingDate, 180));
assert(form4Recent.length === 2,
  'Form 4 within 180d: 2 (got ' + form4Recent.length + '); the 20d- and 90d-old ones, not the 400d-old one');
assert(form4Recent.some(r => r.filingDate === isoDaysAgo(20)) &&
  form4Recent.some(r => r.filingDate === isoDaysAgo(90)),
  'the two within-window rows are exactly the 20d and 90d ones');

// ─── 1c. parseForm4Xml: joint filing (multi-owner) — BH-036/BH-022 ───────
console.log('# 1c. parseForm4Xml: joint filing keeps ALL reporting owners');
const JOINT_XML = `<?xml version="1.0"?>
<ownershipDocument>
  <periodOfReport>2026-05-01</periodOfReport>
  <issuer><issuerTradingSymbol>ACME</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>Doe, Jane</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>true</isDirector><isOfficer>false</isOfficer>
      <isTenPercentOwner>false</isTenPercentOwner><isOther>false</isOther></reportingOwnerRelationship>
  </reportingOwner>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>Doe, John (Spouse)</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>false</isDirector><isOfficer>false</isOfficer>
      <isTenPercentOwner>false</isTenPercentOwner><isOther>true</isOther></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-05-01</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>10</value></transactionShares>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;
const [jointTxn] = mod.parseForm4Xml(JOINT_XML);
assert(Array.isArray(jointTxn.owners) && jointTxn.owners.length === 2,
  'both co-filers captured in owners[] (got ' + (jointTxn.owners || []).length + ')');
assert(jointTxn.owners[1].name === 'Doe, John (Spouse)', 'second owner name preserved');
assert(jointTxn.reportingPersonName === 'Doe, Jane', 'legacy single-owner field stays the first owner');

// ─── 1d. parseForm4Xml: mixed 10b5-1 filing — BH-036/BH-023 ──────────────
console.log('# 1d. parseForm4Xml: mixed filing — per-row 10b5-1, not filing-wide');
const MIXED_10B51_XML = `<?xml version="1.0"?>
<ownershipDocument>
  <periodOfReport>2026-05-01</periodOfReport>
  <issuer><issuerTradingSymbol>ACME</issuerTradingSymbol></issuer>
  <reportingOwner><reportingOwnerId><rptOwnerName>Doe, Jane</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isOfficer>true</isOfficer></reportingOwnerRelationship></reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-05-01</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode><footnoteId id="F1"/></transactionCoding>
      <transactionAmounts><transactionShares><value>100</value></transactionShares>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-05-02</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>50</value></transactionShares>
        <transactionPricePerShare><value>12.00</value><footnoteId id="F2"/></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <footnotes>
    <footnote id="F1">Sold pursuant to a Rule 10b5-1 trading plan adopted 2026-01-15.</footnote>
    <footnote id="F2">Weighted-average price; discretionary sale.</footnote>
  </footnotes>
</ownershipDocument>`;
const [planRow, discretionaryRow] = mod.parseForm4Xml(MIXED_10B51_XML);
assert(planRow.isTenB5One === true, '10b5-1-footnoted row flagged true');
assert(discretionaryRow.isTenB5One === false,
  'sibling row with an UNRELATED footnote must not inherit the plan flag filing-wide');

// ─── 4. pull-insider-form4-daily.js: 4/A amendment + dedup collision ────
// BH-036/BH-024/BH-025: the daily-index-driven contracts, not covered by
// this file before.
console.log('# 4. pull-insider-form4-daily.js: 4/A amendment + widened dedup key');
const idxText = [
  '4      ACME CORP                       1234567   20260501   edgar/data/1234567/0000320193-26-000045.txt',
  '4/A    ACME CORP                       1234567   20260502   edgar/data/1234567/0000320193-26-000046.txt'
].join('\n');
const idxRows = dailyMod.parseDailyForm4Rows(idxText);
assert(idxRows.length === 2, 'parses both the original and the amendment row');
assert(idxRows[0].isAmendment === false && idxRows[0].cik === 1234567,
  'original row: isAmendment=false, cik correctly parsed (not shifted into NaN)');
assert(idxRows[1].isAmendment === true && idxRows[1].accession === '0000320193-26-000046',
  'amendment row: isAmendment=true, own accession captured');

const lotBase = { accessionNumber: 'ACC1', transactionDate: '2026-05-01', transactionCode: 'S',
  transactionShares: 100, acquiredDisposed: 'D', reportingPersonName: 'Doe, Jane' };
const key10 = dailyMod._internals.txnKey(Object.assign({}, lotBase, { transactionPricePerShare: 10 }));
const key12 = dailyMod._internals.txnKey(Object.assign({}, lotBase, { transactionPricePerShare: 12 }));
assert(key10 !== key12,
  'two same-day/same-code/same-share-count lots at DIFFERENT prices must not collide (BH-025)');

console.log('');
if (failed > 0) {
  console.error('FAILED: ' + failed + ' assertion(s) failed');
  process.exit(1);
}
console.log('PASSED: all assertions ok');
