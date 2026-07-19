'use strict';
/**
 * BH-020/021/022/023/024/025/026 regression (batch w2-form4,
 * scripts/pull-insider-form4-daily.js, scripts/pull-insider-form4.js,
 * scripts/backfill-form345.js).
 *
 * BH-020: targetDates() used a fixed DAYS-back window with no memory of the
 *   last successfully indexed day — an outage longer than DAYS trading days
 *   dropped filings permanently. Fix: targetDates(lastIndexedDate) fills the
 *   gap from the cursor to yesterday, capped at MAX_CATCHUP_DAYS.
 * BH-021: the daily cache was keyed by the first-wins watchlist ticker for a
 *   CIK, not the filing's own issuerTradingSymbol — two tickers sharing one
 *   CIK folded onto the wrong symbol. Fix: resolveMergeTicker() prefers the
 *   parsed filing symbol.
 * BH-022: parseForm4Xml only kept the FIRST <reportingOwner> block — joint
 *   filings lost every co-filer. Fix: an owners[] array now carries every
 *   reporting owner (txn-agnostic, since the source doesn't tie a row to one
 *   owner); legacy single-owner fields = first owner, kept for back-compat.
 * BH-023: isTenB5One was decided once per FILING by scanning every footnote
 *   for "10b5-1" text, then stamped on every transaction — a mixed filing
 *   (one plan-based row, one discretionary row) mislabelled the discretionary
 *   row too. Fix: per-transaction footnoteId lookup, filing-wide signal only
 *   as a fallback when a transaction carries no footnote reference of its own.
 * BH-024: a Form 4/A carries its OWN accession number, so accession-keyed
 *   dedup never recognised it as a correction — original and amendment txns
 *   coexisted (additive, not replacing). Fix: parseDailyForm4Rows tags
 *   isAmendment; purgeAmendedPeriod() drops the prior period's txns first.
 * BH-025: txnKey (accession+date+code+shares) collided two REAL distinct
 *   lots of the same accession/date/code/share-count but different price or
 *   owner. Fix: txnKey widened with price, acquired/disposed and owner in
 *   both pull-insider-form4-daily.js and backfill-form345.js.
 * BH-026: dayFetched/grandFetched (daily) and cache overwrite (manual) both
 *   counted a filing as "successfully processed" BEFORE the parse attempt —
 *   an all-200-but-unparsable run looked identical to a healthy empty run,
 *   and a ticker whose every filing failed to parse silently erased its
 *   prior good cache entry. Fix: parse errors counted separately and gate
 *   the total-failure / cache-preservation decisions (both extracted as
 *   pure predicates: _isTotalFailure / _isAllParseFailure).
 *
 * Standalone runner (node <datei>, exit 0/1) — no network, no fs writes;
 * only pure functions are exercised. targetDates() is inherently relative to
 * "today" (that's the feature under test), so BH-020 cases derive their
 * fixture cursor FROM the module's own no-cursor output rather than a
 * hardcoded calendar date — the assertions hold no matter when this runs.
 *
 * Run standalone: node tests/scoring/bh-w2-form4.test.js
 */
const assert = require('node:assert/strict');
const dailyMod = require('../../scripts/pull-insider-form4-daily.js');
const formMod = require('../../scripts/pull-insider-form4.js');
const backfillMod = require('../../scripts/backfill-form345.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// ── BH-020: cursor-driven targetDates() ─────────────────────────────────
test('BH-020: no cursor falls back to the fixed DAYS window (unchanged default behaviour)', () => {
  const noCursor = dailyMod.targetDates();
  assert.ok(Array.isArray(noCursor) && noCursor.length >= 1, 'returns a non-empty date list');
  assert.ok(/^\d{8}$/.test(noCursor[0]), 'entries are YYYYMMDD strings');
});

test('BH-020: cursor already at yesterday -> already caught up, empty list', () => {
  const noCursor = dailyMod.targetDates();
  const alreadyCaughtUp = dailyMod.targetDates(noCursor[0]);
  assert.deepEqual(alreadyCaughtUp, [], 'zero dates to (re-)fetch when the cursor IS yesterday');
});

test('BH-020: cursor N trading days back yields exactly the gap, newest-first', () => {
  const noCursor = dailyMod.targetDates(); // [yesterday, TD-1, TD-2, TD-3, TD-4] by default DAYS=5
  assert.ok(noCursor.length >= 5, 'precondition: default DAYS window has >=5 entries');
  const cursor = noCursor[4]; // 5th trading day back
  const gapFilled = dailyMod.targetDates(cursor);
  assert.deepEqual(gapFilled, noCursor.slice(0, 4),
    'fills exactly the 4 trading days strictly after the cursor, through yesterday');
});

test('BH-020: a very old cursor is capped at MAX_CATCHUP_DAYS, not fetched unbounded', () => {
  const capped = dailyMod.targetDates('19990101');
  assert.equal(capped.length, 60, 'catch-up caps at 60 trading days, older days stay unindexed (logged, not silent)');
});

// ── BH-021: merge-key resolution prefers the filed symbol ───────────────
test('BH-021: resolveMergeTicker prefers the FILING symbol over the watchlist first-wins ticker', () => {
  const parsed = [{ issuerTradingSymbol: 'AXIA3' }];
  assert.equal(dailyMod._internals.resolveMergeTicker(parsed, 'AXIA'), 'AXIA3',
    'a sibling share-class symbol from the filing must not fold onto the CIK first-wins ticker');
});
test('BH-021: resolveMergeTicker falls back to the watchlist ticker when the filing omits the symbol', () => {
  assert.equal(dailyMod._internals.resolveMergeTicker([{}], 'AAPL'), 'AAPL');
  assert.equal(dailyMod._internals.resolveMergeTicker([], 'AAPL'), 'AAPL', 'empty parsed array (no txns) is safe too');
});

// ── BH-022: multi-owner joint filings ────────────────────────────────────
const JOINT_FILING_XML = `<?xml version="1.0"?>
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
      <transactionAmounts>
        <transactionShares><value>10</value></transactionShares>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

test('BH-022: parseForm4Xml captures ALL reportingOwner blocks in owners[], not just the first', () => {
  const [txn] = formMod.parseForm4Xml(JOINT_FILING_XML);
  assert.ok(Array.isArray(txn.owners), 'owners[] present');
  assert.equal(txn.owners.length, 2, 'both joint co-filers captured');
  assert.equal(txn.owners[0].name, 'Doe, Jane');
  assert.equal(txn.owners[1].name, 'Doe, John (Spouse)');
  assert.equal(txn.owners[1].relationship.isOther, true);
  assert.equal(txn.reportingPersonName, 'Doe, Jane', 'legacy single-owner field = first owner (back-compat)');
});

// ── BH-023: per-transaction 10b5-1, not filing-wide ──────────────────────
const MIXED_10B51_XML = `<?xml version="1.0"?>
<ownershipDocument>
  <periodOfReport>2026-05-01</periodOfReport>
  <issuer><issuerTradingSymbol>ACME</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>Doe, Jane</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isOfficer>true</isOfficer></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-05-01</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode><footnoteId id="F1"/></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>100</value></transactionShares>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-05-02</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>50</value></transactionShares>
        <transactionPricePerShare><value>12.00</value><footnoteId id="F2"/></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <footnotes>
    <footnote id="F1">Sold pursuant to a Rule 10b5-1 trading plan adopted 2026-01-15.</footnote>
    <footnote id="F2">Price is the weighted average of a range of prices; discretionary sale.</footnote>
  </footnotes>
</ownershipDocument>`;

test('BH-023: a mixed filing tags the 10b5-1 row true and the discretionary row false', () => {
  const [planTxn, discretionaryTxn] = formMod.parseForm4Xml(MIXED_10B51_XML);
  assert.equal(planTxn.isTenB5One, true, 'row referencing the 10b5-1 footnote is flagged');
  assert.equal(discretionaryTxn.isTenB5One, false,
    'sibling row referencing an UNRELATED footnote must not inherit the plan flag from elsewhere in the filing');
});

test('BH-023: a transaction with no footnote reference at all falls back to the filing-wide signal', () => {
  const xml = MIXED_10B51_XML.replace('<footnoteId id="F1"/>', ''); // strip the only per-txn reference
  const [row1] = formMod.parseForm4Xml(xml);
  assert.equal(row1.isTenB5One, true,
    'no footnote of its own to disambiguate with -> falls back to "any footnote mentions 10b5-1"');
});

// ── BH-024: 4/A amendment parsing + purge-and-replace ────────────────────
test('BH-024: parseDailyForm4Rows tells a 4/A apart from a 4 and still parses cik/date/accession correctly', () => {
  const idxText = [
    '4      ACME CORP                       1234567   20260501   edgar/data/1234567/0000320193-26-000045.txt',
    '4/A    ACME CORP                       1234567   20260502   edgar/data/1234567/0000320193-26-000046.txt'
  ].join('\n');
  const rows = dailyMod.parseDailyForm4Rows(idxText);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].isAmendment, false);
  assert.equal(rows[0].cik, 1234567, 'group re-indexing (BH-024) must not shift cik into NaN (the F-A-2026-06-22 bug)');
  assert.equal(rows[0].dateFiled, '20260501');
  assert.equal(rows[0].accession, '0000320193-26-000045');
  assert.equal(rows[1].isAmendment, true);
  assert.equal(rows[1].cik, 1234567);
  assert.equal(rows[1].accession, '0000320193-26-000046');
});

test('BH-024: purgeAmendedPeriod drops only the amended period, leaving other periods intact', () => {
  const entry = {
    transactions: [
      { periodOfReport: '2026-05-01', transactionShares: 10 },
      { periodOfReport: '2026-05-01', transactionShares: 20 },
      { periodOfReport: '2026-02-01', transactionShares: 5 }
    ]
  };
  const removed = dailyMod._internals.purgeAmendedPeriod(entry, '2026-05-01');
  assert.equal(removed, 2);
  assert.equal(entry.transactions.length, 1);
  assert.equal(entry.transactions[0].periodOfReport, '2026-02-01');
});

test('BH-024: purgeAmendedPeriod is a no-op on a missing entry or missing period (no crash)', () => {
  assert.equal(dailyMod._internals.purgeAmendedPeriod(null, '2026-05-01'), 0);
  assert.equal(dailyMod._internals.purgeAmendedPeriod({ transactions: [] }, null), 0);
});

// ── BH-025: widened txnKey stops legitimate multi-lot collisions ─────────
test('BH-025 (daily): two real lots, same accession/date/code/shares, different price -> different keys', () => {
  const base = { accessionNumber: 'ACC1', transactionDate: '2026-05-01', transactionCode: 'S',
    transactionShares: 100, acquiredDisposed: 'D', reportingPersonName: 'Doe, Jane' };
  const lot1 = Object.assign({}, base, { transactionPricePerShare: 10 });
  const lot2 = Object.assign({}, base, { transactionPricePerShare: 12 });
  assert.notEqual(dailyMod._internals.txnKey(lot1), dailyMod._internals.txnKey(lot2),
    'distinct price -> distinct lots must not collide under the old accession+date+code+shares key');
});
test('BH-025 (daily): a true re-fetch of the SAME lot still collapses to one key (dedup still works)', () => {
  const t = { accessionNumber: 'ACC1', transactionDate: '2026-05-01', transactionCode: 'S',
    transactionShares: 100, transactionPricePerShare: 10, acquiredDisposed: 'D', reportingPersonName: 'Doe, Jane' };
  assert.equal(dailyMod._internals.txnKey(t), dailyMod._internals.txnKey(Object.assign({}, t)));
});
test('BH-025 (backfill): txnKey widened the same way (price + acquiredDisposed + owner)', () => {
  const base = { accessionNumber: 'ACC1', transactionDate: '2026-05-01', transactionCode: 'S',
    transactionShares: 100, acquiredDisposed: 'D', rptOwnerCik: '0001111111' };
  const lot1 = Object.assign({}, base, { transactionPricePerShare: 10 });
  const lot2 = Object.assign({}, base, { transactionPricePerShare: 12 });
  assert.notEqual(backfillMod.txnKey(lot1), backfillMod.txnKey(lot2));
});

// ── BH-026: parse-failure accounting, not fetch-count accounting ─────────
test('BH-026 (daily): _isTotalFailure trips only when NOTHING was fetched but errors OR parse-errors occurred', () => {
  const { _isTotalFailure } = dailyMod._internals;
  assert.equal(_isTotalFailure(0, 0, 0), false, 'genuine no-filings day stays healthy');
  assert.equal(_isTotalFailure(5, 3, 0), false, 'partial success is not a total failure');
  assert.equal(_isTotalFailure(0, 3, 0), true, 'old behaviour: 0 fetched + errors -> failure');
  assert.equal(_isTotalFailure(0, 0, 12), true,
    'NEW: 0 fetched + all-unparsable (parseErrors, zero fetch errors) must ALSO trip — this used to look like a healthy empty day');
});
test('BH-026 (manual): _isAllParseFailure preserves the prior cache only when every filing failed to parse', () => {
  const { _isAllParseFailure } = formMod._internals;
  assert.equal(_isAllParseFailure({ transactions: [], parseErrors: 0 }), false, 'genuinely zero Form-4 activity -> ok to write empty');
  assert.equal(_isAllParseFailure({ transactions: [{ x: 1 }], parseErrors: 2 }), false, 'got SOME data despite some parse errors -> ok to write');
  assert.equal(_isAllParseFailure({ transactions: [], parseErrors: 3 }), true,
    'every fetched filing failed to parse -> must NOT overwrite prior good cache with an empty one');
});

console.log(`\nbh-w2-form4.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
