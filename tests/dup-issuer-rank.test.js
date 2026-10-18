'use strict';
/**
 * Brief sd-dup (18.10.2026, with the master decision of the same day): no firm twice in a
 * ranking, and two fund wrappers carry their non-operating class.
 *
 * Rule: the hand table's homeListingProposal is the primary listing. Every other listing of
 * that issuer holds no rank (rankGrund "dupIssuer") when the home listing stands in the same
 * ranking; alone it keeps its rank. Issuers with an open proposal (null) stay unchanged.
 *
 * Runs the real export chain (mapBoardRow/mapOverviewRow -> vergebeRaenge -> validateFile)
 * on synthetic rows built from the REAL hand table. Nothing is read from snapshots or engine
 * outputs; no file is written.
 *
 * Usage: node tests/dup-issuer-rank.test.js (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const wfe = require('../scripts/write-findash-export.js');
const { loadDupIssuerShadowTable } = require('../lib/dup-issuer-shadow-table.js');
const { rankGrundShadowFor } = require('../lib/non-operating-classes.js');
const nonOperating = require('../configs/non-operating-classes.json');

const tableById = loadDupIssuerShadowTable();
const table = Object.values(tableById);
const decided = table.filter((issuer) => issuer.homeListingProposal !== null);
const open = table.filter((issuer) => issuer.homeListingProposal === null);
const issuerOf = new Map(table.flatMap((issuer) => issuer.tickers.map((t) => [t, issuer])));

const row = (ticker, score, cov = '7/7') => ({
  ticker, name: ticker + ' Ltd.', score, track: 'profitable', lamps: [], coverageAxes: cov,
  overview: { kind: 'gp', value: 0.2, companion: 50 },
  formulaId: 'industrials', overviewKind: 'gp', overviewValue: 0.2, overviewCompanion: 50,
  country: 'United States', region: 'North America', sector: 'Industrials',
  marketCap: 1e10, phase: 'established', mcapBand: 'large', ipoRecency: 'mature',
  profitTier: 'langfristig-profitabel', ipoYear: 1999, cohortN: 90, cohortFallback: false,
});
const rows = (tickers, cov) => tickers.map((t, i) => row(t, 99 - i * 0.5, cov));
// Every table ticker interleaved with unrelated fillers, score-desc like produceRankings.
const cohort = (cov) => rows(table.flatMap((issuer) => issuer.tickers).flatMap((t, i) => ['FILL' + i, t]), cov);
const board = (input, ranking) => wfe.vergebeRaenge(input.map((r, i) => wfe.mapBoardRow(r, i)), 'test.profitable', { warn: false, ranking });
const overview = (input) => wfe.vergebeRaenge(input.map((r, i) => wfe.mapOverviewRow(r, i)), 'test.overview', { warn: false });
const check = (profitable, rankings) => {
  const errors = [];
  wfe.validateFile({ schema: wfe.SCHEMA, generated_at: 'x', boardStatus: 'core', coverage: null,
    branch: 'industrials', profitable, unprofitable: [] }, 'industrials', errors, rankings ? { rankings } : {});
  return errors;
};
const pick = (list, ticker) => list.find((r) => r.ticker === ticker);

test('the real table: decided and open issuers exist; Copel and AXIA carry the marker on the home row', () => {
  assert.ok(decided.length > 0 && open.length > 0);
  for (const id of ['copel', 'axia-energia']) {
    const issuer = tableById[id];
    assert.notEqual(issuer.homeListingProposal, issuer.codeKeeps, `${id}: precondition of the wrong-row case`);
  }
});

for (const [name, build, cov] of [['board', board, '7/7'], ['quality board (5 axes)', board, '5/5'], ['overview', overview, '7/7']]) {
  test(`${name}: every issuer holds at most one rank; only the home listing keeps it`, () => {
    const out = build(cohort(cov));
    const ranked = new Map();
    for (const r of out) {
      const issuer = issuerOf.get(r.ticker);
      if (issuer && r.rank !== null) ranked.set(issuer.issuer, (ranked.get(issuer.issuer) || 0) + 1);
    }
    for (const issuer of decided) {
      assert.equal(ranked.get(issuer.issuer), 1, `${issuer.issuer} must hold exactly one rank`);
      for (const ticker of issuer.tickers) {
        const r = pick(out, ticker);
        if (ticker === issuer.homeListingProposal) {
          assert.ok(Number.isInteger(r.rank) && r.rankGrund === null, `${ticker}: home listing keeps its rank`);
        } else {
          assert.equal(r.rank, null, `${ticker}: other listing must not hold a rank`);
          assert.equal(r.rankGrund, 'dupIssuer', `${ticker}: reason must be stated`);
          assert.ok(Number.isFinite(r.score), `${ticker}: score stays visible`);
        }
      }
    }
    for (const issuer of open) {
      for (const ticker of issuer.tickers) {
        const r = pick(out, ticker);
        assert.ok(Number.isInteger(r.rank) && r.rankGrund === null, `${ticker}: open home listing, row unchanged`);
      }
    }
    const ranks = out.filter((r) => r.rank !== null).map((r) => r.rank);
    assert.deepEqual(ranks, ranks.map((_, i) => i + 1), 'remaining ranks are gapless');
    if (name !== 'overview') assert.deepEqual(check(out), [], 'the --check accepts the gated list');
  });
}

test('marker on the wrong row (Copel, AXIA): the home row keeps rank and marker, the unmarked other row loses its rank', () => {
  const out = board(rows(['CPLE3.SA', 'ELPC', 'AXIA', 'AXIA3.SA']));
  assert.equal(pick(out, 'CPLE3.SA').rank, 1);
  assert.equal(pick(out, 'CPLE3.SA').dupIssuer?.of, 'ELPC', 'the shadow marker itself is not moved by this change');
  assert.equal(pick(out, 'ELPC').rank, null);
  assert.equal(pick(out, 'ELPC').rankGrund, 'dupIssuer');
  assert.ok(!Object.hasOwn(pick(out, 'ELPC'), 'dupIssuer'), 'ELPC carries no marker, the reason still applies');
  assert.equal(pick(out, 'AXIA').rank, null);
  assert.equal(pick(out, 'AXIA3.SA').rank, 2);
  assert.deepEqual(check(out), []);
});

test('a non-home listing alone keeps its rank (Kloeckner: KCO.DE not in the ranking)', () => {
  for (const ticker of ['KCO.VI', 'ELPC', 'AVAV.SW']) {
    const [r] = board(rows([ticker]));
    assert.equal(r.rank, 1, `${ticker}: the firm must not vanish from a ranking without its home listing`);
    assert.equal(r.rankGrund, null);
  }
});

test('a short list is ranked against its full cohort, and the --check uses the same cohort', () => {
  const full = rows(['A', 'AVAV.SW', 'B', 'C', 'AVAV']);
  const ranking = new Set(full.map((r) => r.ticker));
  const fullOut = board(full);
  const shortOut = board(full.slice(0, 3), ranking);
  assert.deepEqual(shortOut.map((r) => r.rank), fullOut.slice(0, 3).map((r) => r.rank), 'short list = prefix of the full ranking');
  assert.equal(pick(shortOut, 'AVAV.SW').rank, null, 'home AVAV stands in the full cohort, not in the short list');
  assert.deepEqual(check(shortOut, { profitable: ranking, unprofitable: new Set() }), []);
  assert.ok(check(shortOut).some((e) => /dupIssuer/.test(e)), 'without the cohort the short list would not match');
});

test('other rows move up by exactly one place per removed row above them', () => {
  const tickers = ['A', 'AVAV.SW', 'B', 'ELPC', 'C', 'AVAV', 'CPLE3.SA', 'D'];
  const after = board(rows(tickers));
  const removed = new Set(['AVAV.SW', 'ELPC']);
  const before = board(rows(tickers.map((t, i) => (removed.has(t) ? 'NEUTRAL' + i : t))));
  after.forEach((r, i) => {
    if (r.rank === null) return;
    const above = tickers.slice(0, i).filter((t) => removed.has(t)).length;
    assert.equal(r.rank, before[i].rank - above, `${r.ticker}: shift`);
  });
  assert.deepEqual(after.map((r) => r.rank), [1, null, 2, null, 3, 4, 5, 6]);
  assert.deepEqual(after.map((r) => r.score), before.map((r) => r.score), 'scores and order unchanged');
});

test('an existing coverage reason takes precedence over dupIssuer', () => {
  const out = board([row('AVAV.SW', 80, '3/7'), row('AVAV', 70)]);
  assert.equal(out[0].rank, null);
  assert.equal(out[0].rankGrund, 'zuWenigBelegteAchsen');
});

test('the --check rejects a non-home listing that still holds a rank next to its home listing', () => {
  for (const pair of [['AVAV', 'AVAV.SW'], ['CPLE3.SA', 'ELPC']]) {
    const ungated = rows(pair).map((r, i) => wfe.mapBoardRow(r, i)); // no vergebeRaenge
    assert.deepEqual(ungated.map((r) => r.rank), [1, 2], 'precondition: the mapper alone numbers every row');
    const errors = check(ungated);
    assert.ok(errors.some((e) => /\[1\]/.test(e) && /dupIssuer/.test(e)), JSON.stringify(errors));
  }
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
