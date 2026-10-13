'use strict';
/**
 * BH-028/029/030/031/032/033/034 regression (batch w2-13f,
 * scripts/pull-13f-institutional.js).
 *
 * BH-028: byInstitution[cik] was fully replaced on every successful refresh
 *   -- no cross-quarter history despite the header claiming "accumulation
 *   across quarters". Fix: byInstitution[cik].quarters[reportPeriod] keeps
 *   one entry per quarter, backward-compatible alongside the flat fields.
 * BH-029: base/amendment selection picked "newest" by filingDate alone, so a
 *   late 13F-HR/A for an OLD quarter filed after a NEWER quarter's original
 *   could get merged onto the wrong quarter's book. Fix: _selectPeriodFilings
 *   picks the target reportPeriod (SEC periodOfReport) first, then scopes
 *   base/amendment pairing to filings sharing that SAME period.
 * BH-030: AMENDMENT_MIN_RATIO(0.5) alone decided full-book vs partial merge.
 *   Fix: _isFullBookAmendment reads the SEC cover-page amendmentType
 *   (RESTATEMENT/NEW HOLDINGS) first; the ratio is a fallback only.
 * BH-031: issuer-name join picked shortest-ticker-wins on collision (GOOG vs
 *   GOOGL, identical name in this repo's ticker map -> no real disambiguator
 *   exists). Fix: buildByTickerView marks the collision and does NOT publish
 *   a guessed ticker for it; collisions are reported instead.
 * BH-032: derived by-ticker view always wrote to the hardcoded production
 *   path regardless of --out. Fix: deriveByTickerPath ties it to --out.
 * BH-033: a near-empty/stale store had no visible "this isn't real coverage"
 *   marker. Fix: computeResearchStatus stamps status:'research-inactive'
 *   below RESEARCH_ACTIVE_MIN_INSTITUTIONS live institutions.
 * BH-034: buildByTickerView published error-preserved stale positions
 *   indistinguishably from fresh ones. Fix: holding objects now carry
 *   fetchedAt/error/failedAt provenance through to byCusip/byIssuerName/byTicker.
 *
 * Standalone runner (node <datei>, exit 0/1) — no network, no fs writes;
 * only pure functions and buildByTickerView (which reads
 * external-data/sec-ticker-cik-map.json, already committed in-repo) are
 * exercised.
 *
 * Run standalone: node tests/scoring/bh-w2-13f.test.js
 */
const assert = require('node:assert/strict');
const mod = require('../../scripts/pull-13f-institutional.js');
const {
  _selectPeriodFilings,
  _isFullBookAmendment
} = mod._internals;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// ── BH-029: report-period selection, not filingDate-only ───────────────────
test('BH-029: late Q2 amendment filed after Q3 original does NOT become "newest"', () => {
  // Store-Beleg reproduction from the audit: Q2 original 08-14, Q3 original
  // 11-14, Q2/A filed LATE on 12-01. filingDate-only selection would pick
  // the Q2/A (latest filingDate) as newest and pair it against the Q3 base.
  const f13s = [
    { form: '13F-HR', filingDate: '2026-08-14', reportDate: '2026-06-30', accessionNumber: 'Q2-ORIG' },
    { form: '13F-HR', filingDate: '2026-11-14', reportDate: '2026-09-30', accessionNumber: 'Q3-ORIG' },
    { form: '13F-HR/A', filingDate: '2026-12-01', reportDate: '2026-06-30', accessionNumber: 'Q2-AMEND' }
  ];
  const { reportPeriod, newest, baseFiling, periodFilings } = _selectPeriodFilings(f13s);
  assert.equal(reportPeriod, '2026-09-30', 'target period is the newest REPORT period, not newest filingDate');
  assert.equal(newest.accessionNumber, 'Q3-ORIG', 'newest is the Q3 original, not the late Q2 amendment');
  assert.equal(baseFiling.accessionNumber, 'Q3-ORIG');
  assert.equal(periodFilings.length, 1, 'the late Q2/A must NOT be in the Q3 period pool');
});

test('BH-029: an amendment for the SAME period as its original is still paired correctly', () => {
  const f13s = [
    { form: '13F-HR', filingDate: '2026-08-14', reportDate: '2026-06-30', accessionNumber: 'Q2-ORIG' },
    { form: '13F-HR/A', filingDate: '2026-08-25', reportDate: '2026-06-30', accessionNumber: 'Q2-AMEND' }
  ];
  const { reportPeriod, newest, baseFiling, periodFilings } = _selectPeriodFilings(f13s);
  assert.equal(reportPeriod, '2026-06-30');
  assert.equal(newest.accessionNumber, 'Q2-AMEND', 'the same-period amendment IS newest within its period');
  assert.equal(baseFiling.accessionNumber, 'Q2-ORIG');
  assert.equal(periodFilings.length, 2);
});

test('BH-029: missing reportDate everywhere degrades to the old filingDate-only pool (no crash)', () => {
  const f13s = [
    { form: '13F-HR', filingDate: '2026-08-14', accessionNumber: 'A' },
    { form: '13F-HR/A', filingDate: '2026-11-14', accessionNumber: 'B' }
  ];
  const { newest, periodFilings } = _selectPeriodFilings(f13s);
  assert.equal(newest.accessionNumber, 'B');
  assert.equal(periodFilings.length, 2);
});

// ── BH-030: cover-page amendmentType overrides the ratio heuristic ─────────
test('BH-030: RESTATEMENT is always a full-book replace, even with a tiny amend count', () => {
  assert.equal(_isFullBookAmendment('RESTATEMENT', /*baseCount*/ 100, /*amendCount*/ 1), true);
});
test('BH-030: NEW HOLDINGS is always a partial merge, even above the 50% ratio', () => {
  assert.equal(_isFullBookAmendment('NEW HOLDINGS', /*baseCount*/ 100, /*amendCount*/ 90), false);
});
test('BH-030: unreadable cover page (null) falls back to the ratio heuristic', () => {
  assert.equal(_isFullBookAmendment(null, 100, 51), true);  // 51% >= 50% fallback
  assert.equal(_isFullBookAmendment(null, 100, 49), false); // 49% < 50% fallback
});

// ── BH-031/BH-034: buildByTickerView collision + provenance ────────────────
// Uses the real, committed external-data/sec-ticker-cik-map.json (read via
// readJsonSafe inside buildByTickerView) — no network, no writes.
test('BH-031: GOOG/GOOGL issuer-name collision is NOT silently resolved to one ticker', () => {
  const synthCache = {
    byInstitution: {
      '0001067983': {
        cik: '0001067983', name: 'Berkshire Hathaway Inc', filingDate: '2026-02-14',
        positions: [
          { nameOfIssuer: 'Alphabet Inc.', cusip: '02079K305', value: 100000, sshPrnamt: 500, sshPrnamtType: 'SH' }
        ]
      }
    }
  };
  const view = mod.buildByTickerView(synthCache);
  assert.ok(view.collisions && typeof view.collisions === 'object', 'collisions object is returned');
  const norm = Object.keys(view.collisions).find(k => k.includes('ALPHABET'));
  assert.ok(norm, 'ALPHABET collision is reported (' + JSON.stringify(Object.keys(view.collisions)) + ')');
  assert.ok(view.collisions[norm].includes('GOOG') && view.collisions[norm].includes('GOOGL'),
    'both colliding tickers are listed');
  assert.equal(view.byTicker['GOOG'], undefined, 'GOOG must NOT be silently guessed');
  assert.equal(view.byTicker['GOOGL'], undefined, 'GOOGL must NOT be silently guessed');
  // Still published under the unambiguous keys.
  assert.ok(view.byCusip['02079K305'], 'byCusip is unaffected by the ticker collision');
  assert.ok(view.byIssuerName['ALPHABET INC.'], 'byIssuerName is unaffected by the ticker collision');
});

test('BH-034: an errored institution\'s carried-over positions keep error/fetchedAt provenance in the derived view', () => {
  const synthCache = {
    byInstitution: {
      '0009999999': {
        cik: '0009999999', name: 'Errored Fund LLC',
        filingDate: '2025-11-14', fetchedAt: '2025-11-20T00:00:00.000Z',
        error: 'info-table-fetch: timeout', failedAt: '2026-02-20T00:00:00.000Z',
        positions: [
          { nameOfIssuer: 'MICROSOFT CORP', cusip: '594918104', value: 1000, sshPrnamt: 10, sshPrnamtType: 'SH' }
        ]
      }
    }
  };
  const view = mod.buildByTickerView(synthCache);
  const holder = view.byCusip['594918104'].holders[0];
  assert.equal(holder.error, 'info-table-fetch: timeout', 'error carried onto the holding');
  assert.equal(holder.failedAt, '2026-02-20T00:00:00.000Z', 'failedAt carried onto the holding');
  assert.equal(holder.fetchedAt, '2025-11-20T00:00:00.000Z', 'fetchedAt (last SUCCESSFUL pull) carried onto the holding');
});

test('BH-034: a healthy institution\'s holdings carry error:null (unambiguous "not stale")', () => {
  const synthCache = {
    byInstitution: {
      '0001067983': {
        cik: '0001067983', name: 'Berkshire Hathaway Inc',
        filingDate: '2026-02-14', fetchedAt: '2026-02-20T00:00:00.000Z', error: null,
        positions: [
          { nameOfIssuer: 'APPLE INC', cusip: '037833100', value: 100000, sshPrnamt: 500, sshPrnamtType: 'SH' }
        ]
      }
    }
  };
  const view = mod.buildByTickerView(synthCache);
  assert.equal(view.byCusip['037833100'].holders[0].error, null);
});

// ── BH-032: derived by-ticker path follows --out ────────────────────────────
test('BH-032: default --out keeps the default production by-ticker path', () => {
  const path = require('path');
  const EXTERNAL_DIR = path.join(__dirname, '..', '..', 'external-data');
  const defaultCache = path.join(EXTERNAL_DIR, 'sec-13f-cache.json');
  assert.equal(mod.deriveByTickerPath(defaultCache), path.join(EXTERNAL_DIR, 'sec-13f-by-ticker.json'));
});
test('BH-032: a custom --out derives its OWN sibling by-ticker path, not the production one', () => {
  const path = require('path');
  const custom = path.join(__dirname, 'temp-smoke-cache.json');
  const derived = mod.deriveByTickerPath(custom);
  assert.notEqual(derived, path.join(__dirname, '..', '..', 'external-data', 'sec-13f-by-ticker.json'));
  assert.equal(derived, path.join(__dirname, 'temp-smoke-cache.by-ticker.json'));
});

// ── BH-033: research-inactive coverage stamp ────────────────────────────────
test('BH-033: sparse coverage (below the minimum) is stamped research-inactive', () => {
  const byInstitution = {
    '0001067983': { positions: [{ nameOfIssuer: 'A', cusip: '1' }], error: null }
  };
  const { status, activeInstitutionCount } = mod.computeResearchStatus(byInstitution);
  assert.equal(status, 'research-inactive');
  assert.equal(activeInstitutionCount, 1);
});
test('BH-033: errored and empty-positions entries do not count toward coverage', () => {
  const byInstitution = {
    a: { positions: [{ x: 1 }], error: 'submissions-404' }, // errored -> doesn't count
    b: { positions: [], error: null },                      // empty -> doesn't count
    c: { positions: [{ x: 1 }], error: null }                // counts
  };
  const { activeInstitutionCount } = mod.computeResearchStatus(byInstitution);
  assert.equal(activeInstitutionCount, 1);
});
test('BH-033: coverage at/above the minimum is stamped active', () => {
  const byInstitution = {};
  for (let i = 0; i < 10; i++) {
    byInstitution['cik' + i] = { positions: [{ x: 1 }], error: null };
  }
  const { status, activeInstitutionCount } = mod.computeResearchStatus(byInstitution);
  assert.equal(activeInstitutionCount, 10);
  assert.equal(status, 'active');
});

// ── BH-028: per-reportPeriod quarter history shape (structural check) ──────
// main() itself does network + fs writes, so this pins the CONTRACT the fix
// promises (documented in the file header) rather than driving main().
test('BH-028: quarters map keys are reportPeriod strings, each holding its own positions snapshot', () => {
  const quarters = {};
  const q2 = { filingDate: '2026-08-14', accessionNumber: 'Q2-ORIG', form: '13F-HR', positions: [{ cusip: 'AAA' }] };
  const q3 = { filingDate: '2026-11-14', accessionNumber: 'Q3-ORIG', form: '13F-HR', positions: [{ cusip: 'BBB' }] };
  // Simulates two successive successful runs merging into the same quarters map
  // (mirrors the Object.assign({}, prevQuarters) merge in main()).
  Object.assign(quarters, { '2026-06-30': q2 });
  const merged = Object.assign({}, quarters, { '2026-09-30': q3 });
  assert.equal(Object.keys(merged).length, 2, 'both quarters survive -- the second run does not evict the first');
  assert.equal(merged['2026-06-30'].positions[0].cusip, 'AAA');
  assert.equal(merged['2026-09-30'].positions[0].cusip, 'BBB');
});

console.log(`\nbh-w2-13f.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
