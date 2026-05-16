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
 *   2. selectUsTickers() keeps US-listed entries and drops foreign ones
 *      (China-A `.SZ`, Toronto `.TO`) when given a synthetic ticker→CIK
 *      map.
 *   3. _normalizeSubmissions() zips the SEC parallel-array shape into
 *      one row per filing, and _withinLookback() correctly windows dates.
 *
 * Run:
 *   & "C:\Program Files\nodejs\node.exe" tests/sec-form4-test.js
 *
 * Exits non-zero on any assertion failure (CI-friendly).
 */
'use strict';

const path = require('path');
const mod = require(path.join(__dirname, '..', 'scripts', 'pull-insider-form4.js'));

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
console.log('# 3. _normalizeSubmissions + _withinLookback');
const fakeSub = {
  filings: {
    recent: {
      form: ['4', '10-K', '4', '4'],
      filingDate: ['2026-05-10', '2026-01-01', '2024-01-01', '2026-04-20'],
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
  'Form 4 within 180d: 2 (got ' + form4Recent.length + ')');
assert(form4Recent.every(r => r.filingDate.startsWith('2026')),
  'within-window Form 4s are 2026-dated');

console.log('');
if (failed > 0) {
  console.error('FAILED: ' + failed + ' assertion(s) failed');
  process.exit(1);
}
console.log('PASSED: all assertions ok');
