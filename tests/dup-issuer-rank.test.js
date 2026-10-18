'use strict';
/**
 * Brief sd-dup (18.10.2026): no firm twice in a ranking, and two fund wrappers carry their
 * non-operating class.
 *
 * Runs the real export chain (mapBoardRow/mapOverviewRow -> vergebeRaenge -> validateFile)
 * on synthetic rows built from the REAL hand table, so a later table decision (an open
 * homeListingProposal resolved) is picked up without editing this file. Nothing is read
 * from snapshots or engine outputs; no file is written.
 *
 * Usage: node tests/dup-issuer-rank.test.js (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const wfe = require('../scripts/write-findash-export.js');
const { loadDupIssuerShadowTable } = require('../lib/dup-issuer-shadow-table.js');
const { rankGrundShadowFor } = require('../lib/non-operating-classes.js');
const nonOperating = require('../configs/non-operating-classes.json');

const table = Object.values(loadDupIssuerShadowTable());
// Decided = the sourced home listing is the kept ticker; only then is the primary listing known.
const decided = table.filter((issuer) => issuer.homeListingProposal === issuer.codeKeeps);
const open = table.filter((issuer) => issuer.homeListingProposal !== issuer.codeKeeps);
const issuerOf = new Map(table.flatMap((issuer) => issuer.tickers.map((t) => [t, issuer])));

const row = (ticker, score, cov = '7/7') => ({
  ticker, name: ticker + ' Ltd.', score, track: 'profitable', lamps: [], coverageAxes: cov,
  overview: { kind: 'gp', value: 0.2, companion: 50 },
  formulaId: 'industrials', overviewKind: 'gp', overviewValue: 0.2, overviewCompanion: 50,
  country: 'United States', region: 'North America', sector: 'Industrials',
  marketCap: 1e10, phase: 'established', mcapBand: 'large', ipoRecency: 'mature',
  profitTier: 'langfristig-profitabel', ipoYear: 1999, cohortN: 90, cohortFallback: false,
});
// Every table ticker interleaved with unrelated fillers, score-desc like produceRankings.
function cohort(cov) {
  const tickers = table.flatMap((issuer) => issuer.tickers).flatMap((t, i) => ['FILL' + i, t]);
  return tickers.map((t, i) => row(t, 99 - i * 0.5, cov));
}
const board = (rows) => wfe.vergebeRaenge(rows.map((r, i) => wfe.mapBoardRow(r, i)), 'test.profitable', { warn: false });
const overview = (rows) => wfe.vergebeRaenge(rows.map((r, i) => wfe.mapOverviewRow(r, i)), 'test.overview', { warn: false });
const check = (profitable) => {
  const errors = [];
  wfe.validateFile({ schema: wfe.SCHEMA, generated_at: 'x', boardStatus: 'core', coverage: null,
    branch: 'industrials', profitable, unprofitable: [] }, 'industrials', errors);
  return errors;
};
const rankedPerIssuer = (rows) => {
  const count = new Map();
  for (const r of rows) {
    const issuer = issuerOf.get(r.ticker);
    if (issuer && r.rank !== null) count.set(issuer.issuer, (count.get(issuer.issuer) || 0) + 1);
  }
  return count;
};

test('the real table decides at least one issuer and leaves the open ones listed', () => {
  assert.ok(decided.length > 0, 'no decided issuer: the guard below would test nothing');
  assert.ok(open.every((issuer) => issuer.homeListingProposal === null || issuer.tickers.includes(issuer.homeListingProposal)));
});

for (const [name, build, cov] of [['board', board, '7/7'], ['quality board (5 axes)', board, '5/5'], ['overview', overview, '7/7']]) {
  test(`${name}: no decided issuer holds two ranks; its second listing stays visible without a rank`, () => {
    const rows = build(cohort(cov));
    const ranked = rankedPerIssuer(rows);
    for (const issuer of decided) {
      assert.equal(ranked.get(issuer.issuer), 1, `${issuer.issuer} must hold exactly one rank`);
      for (const r of rows.filter((x) => issuer.tickers.includes(x.ticker))) {
        if (r.ticker === issuer.homeListingProposal) {
          assert.ok(Number.isInteger(r.rank), `${r.ticker}: primary listing keeps its rank`);
          assert.equal(r.rankGrund, null);
        } else {
          assert.equal(r.rank, null, `${r.ticker}: second listing must not hold a rank`);
          assert.equal(r.rankGrund, 'dupIssuer', `${r.ticker}: reason must be stated`);
          assert.equal(r.dupIssuer?.of, issuer.codeKeeps, `${r.ticker}: marker stays`);
          assert.ok(Number.isFinite(r.score), `${r.ticker}: score stays visible`);
        }
      }
    }
    // Brief: an open or conflicting home-listing proposal decides nothing, so nothing changes there.
    for (const issuer of open) {
      for (const r of rows.filter((x) => issuer.tickers.includes(x.ticker))) {
        assert.ok(Number.isInteger(r.rank) && r.rankGrund === null, `${r.ticker}: undecided case must stay unchanged`);
      }
    }
    // Remaining ranks are gapless 1..k in list order.
    assert.deepEqual(rows.filter((r) => r.rank !== null).map((r) => r.rank),
      rows.filter((r) => r.rank !== null).map((_, i) => i + 1));
    if (name !== 'overview') assert.deepEqual(check(rows), [], 'the --check accepts the gated list');
  });
}

test('other rows move up by exactly one place per removed row above them', () => {
  const tickers = ['A', 'AVAV.SW', 'B', 'GCP.DE', 'C', 'AVAV', 'GE', 'D'];
  const after = board(tickers.map((t, i) => row(t, 90 - i)));
  // Reference: the same list with neutral tickers in place of the two second listings.
  const before = board(tickers.map((t, i) => row(t === 'AVAV.SW' || t === 'GCP.DE' ? 'NEUTRAL' + i : t, 90 - i)));
  const removedAbove = (i) => tickers.slice(0, i).filter((t) => t === 'AVAV.SW' || t === 'GCP.DE').length;
  after.forEach((r, i) => {
    if (r.rank === null) return;
    assert.equal(r.rank, before[i].rank - removedAbove(i), `${r.ticker}: shift`);
  });
  assert.deepEqual(after.map((r) => r.rank), [1, null, 2, null, 3, 4, 5, 6]);
  assert.deepEqual(after.map((r) => r.score), before.map((r) => r.score), 'scores and order unchanged');
});

test('an existing coverage reason takes precedence over dupIssuer', () => {
  const [r] = board([row('AVAV.SW', 80, '3/7')]);
  assert.equal(r.rank, null);
  assert.equal(r.rankGrund, 'zuWenigBelegteAchsen');
});

test('the --check rejects a decided second listing that still holds a rank (export without the gate)', () => {
  const ungated = [row('AVAV', 90), row('AVAV.SW', 89)].map((r, i) => wfe.mapBoardRow(r, i)); // no vergebeRaenge
  assert.deepEqual(ungated.map((r) => r.rank), [1, 2], 'precondition: the mapper alone numbers every row');
  const errors = check(ungated);
  assert.ok(errors.some((e) => /AVAV|\[1\]/.test(e) && /dupIssuer/.test(e)), JSON.stringify(errors));
});

test('INPP.L and OCI.L are non-operating closed-end funds with a sourced entry', () => {
  for (const ticker of ['INPP.L', 'OCI.L']) {
    assert.equal(rankGrundShadowFor(ticker), 'nichtOperativGeschlossenerFonds', ticker);
    const entry = nonOperating.entries.find((e) => e.ticker === ticker);
    assert.match(entry.sourceUrl, /^https:\/\//, ticker + ': primary source, not a p66 rule');
    assert.ok(entry.sourceQuote.length > 20, ticker + ': verbatim quote');
    const [mapped] = board([row(ticker, 77)]);
    assert.equal(mapped.rankGrundShadow, 'nichtOperativGeschlossenerFonds', ticker + ': export carries the class');
  }
});
