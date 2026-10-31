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
const { buildUniverse } = require('../scripts/write-filter-universe.js');
const filterSnapshots = require('./fixtures/w6/snapshots.json');
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

test('the real table: decided and open issuers exist; only Copel and AXIA move their marker to the non-home listing', () => {
  assert.ok(decided.length > 0 && open.length > 0);
  for (const id of ['copel', 'axia-energia']) {
    const issuer = tableById[id];
    assert.notEqual(issuer.homeListingProposal, issuer.codeKeeps, `${id}: recorded codeKeeps is the non-home listing`);
  }
  // Master decision 18.10.2026: no other issuer's marker moves (Kloeckner stays on codeKeeps KCO.VI).
  assert.deepEqual(Object.keys(tableById).filter((id) => tableById[id].markFollowsHomeListing === true), ['axia-energia', 'copel']);
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

test('Copel and AXIA: the home row keeps its rank and carries no marker, the ADR row is marked and unranked', () => {
  const out = board(rows(['CPLE3.SA', 'ELPC', 'AXIA', 'AXIA3.SA']));
  assert.equal(pick(out, 'CPLE3.SA').rank, 1);
  assert.ok(!Object.hasOwn(pick(out, 'CPLE3.SA'), 'dupIssuer'), 'home listing CPLE3.SA is not marked');
  assert.equal(pick(out, 'ELPC').rank, null);
  assert.equal(pick(out, 'ELPC').rankGrund, 'dupIssuer');
  assert.equal(pick(out, 'ELPC').dupIssuer?.of, 'CPLE3.SA');
  assert.equal(pick(out, 'AXIA').rank, null);
  assert.equal(pick(out, 'AXIA').dupIssuer?.of, 'AXIA3.SA');
  assert.equal(pick(out, 'AXIA3.SA').rank, 2);
  assert.ok(!Object.hasOwn(pick(out, 'AXIA3.SA'), 'dupIssuer'), 'home listing AXIA3.SA is not marked');
  assert.deepEqual(check(out), []);
});

// P290 (30.10.2026): the declared home leg must be the leg the reader sees, whatever the score order:
// exactly that leg ranked and unmarked, every other leg unranked and marked with that home leg.
test('a declared home leg is the shown leg in either score order', () => {
  // Marker kept on codeKeeps by decision and home legs that stand in no ranking today; they cannot pass yet.
  const notShownYet = ['Klöckner & Co', 'Vinci'];
  const covered = decided.filter((issuer) => !notShownYet.includes(issuer.issuer));
  assert.equal(covered.length, decided.length - notShownYet.length, 'the exception names real rows');
  assert.ok(covered.some((issuer) => issuer.homeListingProposal === 'AMRZ'), 'Amrize is covered');
  for (const issuer of covered) {
    for (const tickers of [issuer.tickers, [...issuer.tickers].reverse()]) {
      const out = board(rows(['A', ...tickers, 'B']));
      const shown = out.filter((r) => issuerOf.get(r.ticker) === issuer && r.rank !== null && !Object.hasOwn(r, 'dupIssuer'));
      assert.deepEqual(shown.map((r) => r.ticker), [issuer.homeListingProposal], tickers.join(','));
      for (const ticker of issuer.tickers.filter((t) => t !== issuer.homeListingProposal)) {
        assert.equal(pick(out, ticker).rank, null, ticker);
        assert.equal(pick(out, ticker).rankGrund, 'dupIssuer', ticker);
        assert.equal(pick(out, ticker).dupIssuer?.of, issuer.homeListingProposal, ticker);
      }
      assert.equal(pick(out, 'B').rank, 3, 'the row below moves up one place');
      assert.deepEqual(check(out), []);
    }
  }
});

// Literal, independent of the table's own fields, on the row the reader actually gets: the filter's visible row.
test('Amrize: AMRZ is the visible row with rank and P/E, AMRZ.SW is hidden without a rank', () => {
  const hiddenByDefault = ['data-suspect', 'dup-issuer'];
  for (const order of [['AMRZ', 'AMRZ.SW'], ['AMRZ.SW', 'AMRZ']]) {
    const out = board(order.map((t) => row(t, 54.1)));
    assert.equal(pick(out, 'AMRZ').rank, 1, order.join(','));
    assert.equal(pick(out, 'AMRZ').rankGrund, null);
    assert.ok(!Object.hasOwn(pick(out, 'AMRZ'), 'dupIssuer'));
    assert.equal(pick(out, 'AMRZ.SW').rank, null);
    assert.equal(pick(out, 'AMRZ.SW').rankGrund, 'dupIssuer');
    assert.equal(pick(out, 'AMRZ.SW').score, 54.1, 'score stays visible');
    assert.deepEqual(pick(out, 'AMRZ.SW').dupIssuer, { of: 'AMRZ', issuer: 'Amrize', basis: 'hand-table:dup-issuer-shadow' });
    const template = filterSnapshots.find((s) => s.meta.ticker === 'PAY');
    const snapshots = order.map((t) => {
      const snapshot = structuredClone(template);
      snapshot.meta.ticker = t;
      snapshot.metrics.pe = { value: 18.28 };
      return snapshot;
    });
    const boards = new Map(out.map((r) => [r.ticker, { branch: 'materials', row: r }]));
    const feed = buildUniverse({ snapshots, boards, generatedAt: '2026-10-17T14:47:00Z' }).rows;
    const visible = feed.find((r) => r.t === 'AMRZ'), hidden = feed.find((r) => r.t === 'AMRZ.SW');
    assert.ok(!visible.aus.some((a) => hiddenByDefault.includes(a)), JSON.stringify(visible.aus));
    assert.equal(visible.rk, 1);
    assert.equal(visible.pe, 18.28);
    assert.equal(visible.peSt, 'vorhanden');
    assert.ok(hidden.aus.includes('dup-issuer') && hidden.aus.includes('dupIssuer'), JSON.stringify(hidden.aus));
    assert.equal(hidden.rk, undefined);
  }
});

test('filter feed: the home row of Copel and AXIA stays visible with its rank, the ADR row is hidden by default', () => {
  // findash filter contract (web/src/lib/filter-vertrag.json hiddenReasons) hides these reasons by default.
  const hiddenByDefault = ['data-suspect', 'dup-issuer'];
  const tickers = ['CPLE3.SA', 'ELPC', 'AXIA', 'AXIA3.SA'];
  const out = board(rows(tickers));
  const template = filterSnapshots.find((s) => s.meta.ticker === 'PAY');
  const snapshots = tickers.map((t) => ({ ...structuredClone(template), meta: { ...template.meta, ticker: t } }));
  const boards = new Map(out.map((r) => [r.ticker, { branch: 'utilities', row: r }]));
  const feed = buildUniverse({ snapshots, boards, generatedAt: '2026-10-17T14:47:00Z' }).rows;
  const visible = (t) => !feed.find((r) => r.t === t).aus.some((a) => hiddenByDefault.includes(a));
  for (const home of ['CPLE3.SA', 'AXIA3.SA']) {
    assert.ok(visible(home), `${home}: home row must be visible in the filter tab`);
    assert.ok(Number.isInteger(feed.find((r) => r.t === home).rk), `${home}: keeps its rank`);
  }
  for (const adr of ['ELPC', 'AXIA']) {
    assert.ok(!visible(adr), `${adr}: second listing hidden by default`);
    assert.equal(feed.find((r) => r.t === adr).rk, undefined, `${adr}: no rank`);
  }
});

// Codex review P266 P2-01: literal markers on the exported rows, independent of markKeeps().
test('exported rows carry the literal markers for Copel, AXIA and Kloeckner', () => {
  const basis = 'hand-table:dup-issuer-shadow';
  const out = board(rows(['CPLE3.SA', 'ELPC', 'AXIA3.SA', 'AXIA', 'KCO.VI', 'KCO.DE']));
  const marker = (t) => (Object.hasOwn(pick(out, t), 'dupIssuer') ? pick(out, t).dupIssuer : 'none');
  assert.equal(marker('CPLE3.SA'), 'none');
  assert.deepEqual(marker('ELPC'), { of: 'CPLE3.SA', issuer: 'Copel', basis });
  assert.equal(marker('AXIA3.SA'), 'none');
  assert.deepEqual(marker('AXIA'), { of: 'AXIA3.SA', issuer: 'AXIA Energia', basis });
  assert.equal(marker('KCO.VI'), 'none', 'Kloeckner keeps its marker on KCO.DE');
  assert.deepEqual(marker('KCO.DE'), { of: 'KCO.VI', issuer: 'Klöckner & Co', basis });
});

test('filter feed: KCO.VI alone (17.10. situation) stays visible by default with its rank', () => {
  const [kco] = board(rows(['KCO.VI']));
  const template = filterSnapshots.find((s) => s.meta.ticker === 'PAY');
  const snapshots = [{ ...structuredClone(template), meta: { ...template.meta, ticker: 'KCO.VI' } }];
  const [row] = buildUniverse({ snapshots, boards: new Map([['KCO.VI', { branch: 'materials', row: kco }]]),
    generatedAt: '2026-10-17T14:47:00Z' }).rows;
  assert.equal(row.rk, 1);
  assert.ok(!row.aus.some((a) => ['data-suspect', 'dup-issuer'].includes(a)), JSON.stringify(row.aus));
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

// Numbers-trust audit 23.10.2026: Circle stood twice (CRCL rank 4, CRCL.SW rank 5, both 63.2).
test('CRCL/CRCL.SW with the same score: the home listing keeps its rank in either tie order', () => {
  for (const order of [['CRCL', 'CRCL.SW'], ['CRCL.SW', 'CRCL']]) {
    const out = board([row('A', 70), ...order.map((t) => row(t, 63.2)), row('B', 60)]);
    assert.equal(pick(out, 'CRCL').rank, 2, order.join(','));
    assert.equal(pick(out, 'CRCL').rankGrund, null);
    assert.equal(pick(out, 'CRCL.SW').rank, null);
    assert.equal(pick(out, 'CRCL.SW').rankGrund, 'dupIssuer');
    assert.equal(pick(out, 'CRCL.SW').score, 63.2, 'score stays visible');
    assert.deepEqual(pick(out, 'CRCL.SW').dupIssuer, { of: 'CRCL', issuer: 'Circle Internet Group', basis: 'hand-table:dup-issuer-shadow' });
    assert.equal(pick(out, 'B').rank, 3, 'the row below moves up one place');
  }
});

// Audit 23.10.2026: AVAV.SW (59.7, ipoYear 2026) stood far above its home leg AVAV (29.9, ipoYear 2007).
test('AVAV.SW with a higher score and a newer ipoYear still loses the rank to the home listing AVAV', () => {
  const leg = { ...row('AVAV.SW', 59.7), ipoYear: 2026 };
  const home = { ...row('AVAV', 29.9), ipoYear: 2007 };
  const out = board([row('A', 70), leg, row('B', 50), row('C', 40), home]);
  assert.deepEqual(out.map((r) => [r.ticker, r.rank, r.rankGrund]), [
    ['A', 1, null], ['AVAV.SW', null, 'dupIssuer'], ['B', 2, null], ['C', 3, null], ['AVAV', 4, null],
  ]);
  assert.equal(pick(out, 'AVAV.SW').score, 59.7);
  assert.deepEqual(check(out), []);
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
