'use strict';
/**
 * P290: fixed home listing with an allowed fallback in the one issuer comparator that scoring, calibration, the
 * Rule-of-40 export and the excluded list share. The fallback is the point: stability must not cost a firm its newest
 * shown period, and a listing that only looks newer (no year-ago partner, revenue padded with 0) must not win.
 *
 * Standalone runner, no network. Run: node tests/home-listing.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { issuerDedupComparator, issuerDedupComparatorOld, issuerDedupGroups } = require('../src/scoring/score.js');
const { homeListingRank, shownGrowthMonth, loadHomeListingTable, NOT_HOME, SECONDARY_BOARD, SOURCED_HOME } = require('../lib/home-listing.js');
const { buildExcludedList, homeListingWarning } = require('../scripts/write-excluded-list.js');
const { comparisonShown } = require('../lib/comparison-ends.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

const JUNE = { values: [120, 110, 105, 100, 90], ends: ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'] };
const SEPT = { values: [130, 120, 110, 105, 100], ends: ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30'] };
function leg(ticker, country, mcap, series = JUNE, name = 'Firm N.V.') {
  return { ticker, snapshot: {
    meta: { ticker, name, country, exchangeName: 'X', tradingCurrency: 'EUR', reportingCurrencyOriginal: 'EUR' },
    marketCap: { value: mcap },
    timeseries: { revenueQ: series.values.map((value) => ({ value })), revenueQEnds: series.ends },
    annual: { annualRev: [{ value: 400 }, { value: 380 }], annualRevEnds: ['2025-12-31', '2024-12-31'] },
  } };
}
const first = (legs) => [...legs].sort(issuerDedupComparator)[0].ticker;
const permutations = (a) => (a.length < 2 ? [a] : a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));

test('the sourced home listing beats a dearer mirror line (ASML, 711 against 608 bn USD)', () => {
  assert.equal(first([leg('1ASML.MI', 'Netherlands', 711e9), leg('ASML.VI', 'Netherlands', 606e9), leg('ASML.AS', 'Netherlands', 608e9)]), 'ASML.AS');
  assert.equal(homeListingRank('ASML.AS', 'Netherlands'), SOURCED_HOME);
});

test('the rule before P290 would have chosen Milan: the comparison in excluded.json measures a real difference', () => {
  const legs = [leg('1ASML.MI', 'Netherlands', 711e9), leg('ASML.AS', 'Netherlands', 608e9)];
  assert.equal([...legs].sort(issuerDedupComparatorOld)[0].ticker, '1ASML.MI');
});

test('fallback: a home listing with an older shown period gives way, and returns when its reload caught up', () => {
  assert.equal(first([leg('ASML.AS', 'Netherlands', 608e9, JUNE), leg('1ASML.MI', 'Netherlands', 711e9, SEPT)]), '1ASML.MI');
  assert.equal(first([leg('ASML.AS', 'Netherlands', 608e9, SEPT), leg('1ASML.MI', 'Netherlands', 711e9, SEPT)]), 'ASML.AS');
});

test('a newer quarter without its year-ago partner does not count (BESI.VI: 22 to 252 in the first draft)', () => {
  const noPartner = { values: [130, 120, 110], ends: ['2026-09-30', '2026-06-30', '2026-03-31'] };
  const home = leg('BESI.AS', 'Netherlands', 13e9, JUNE), other = leg('BESI.VI', 'Netherlands', 14e9, noPartner);
  assert.equal(shownGrowthMonth(other.snapshot), '2025-12'); // only the annual pair remains
  assert.equal(shownGrowthMonth(home.snapshot), '2026-06');
  assert.equal(first([other, home]), 'BESI.AS');
});

test('a revenue of 0 is no report (3993.HK: 0 for 2026-09-30 would show -100 %)', () => {
  const zero = { values: [0, 120, 110, 105, 100], ends: SEPT.ends };
  const shadow = leg('3993.HK', 'China', 33e9, zero), home = leg('603993.SS', 'China', 43e9, JUNE);
  assert.equal(shownGrowthMonth(shadow.snapshot), '');
  assert.equal(first([shadow, home]), '603993.SS');
});

test('R23-2 real Sichuan Expressway (31.10.2026): the H share carries the A share figures and gets its exchange gate, shown and compared alike', () => {
  // A frozen store extract (601107.SS only), read in a child process: the committed store grows every day.
  const { spawnSync } = require('node:child_process');
  const fx = path.join(__dirname, 'fixtures', 'home-listing');
  const probe = `
    const path = require('path'), fs = require('fs'), root = ${JSON.stringify(path.join(__dirname, '..'))}, fx = ${JSON.stringify(fx)};
    console.log = () => {}; console.warn = () => {};
    const { g31Shadow } = require(path.join(root, 'lib/g31-recency.js'));
    const { prepareSnapshot } = require(path.join(root, 'lib/yahoo-q4-known-cases.js'));
    const X = require(path.join(root, 'lib/exchange-quarter-check.js'));
    const { shownGrowthMonth } = require(path.join(root, 'lib/home-listing.js'));
    const read = (t) => prepareSnapshot(JSON.parse(fs.readFileSync(path.join(fx, t + '.json'), 'utf8')), { atPull: true });
    const h = read('0107.HK'), a = read('601107.SS'), v = (s) => g31Shadow(s).v1;
    process.stdout.write(JSON.stringify({ siblings: X.exchangeSiblings(X.stripOwn(h), X.defaultContext()), ends: [v(h).periodEnd, v(a).periodEnd],
      pct: [v(h).pct, v(a).pct], months: [shownGrowthMonth(h), shownGrowthMonth(a)] }));`;
  const r = spawnSync(process.execPath, ['-e', probe], { env: { ...process.env, EXCHANGE_QUARTERS_DIR: path.join(fx, 'exchange-store') }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.deepEqual(got.siblings, ['601107.SS'], 'linked by the figures');
  // Before: the H share showed +11.31 % for June 2026, a pair the exchange check withholds on the A share.
  assert.deepEqual(got.ends, ['2025-12-31', '2025-12-31']);
  assert.equal(got.pct[0], got.pct[1]);
  assert.deepEqual(got.months, ['2025-12', '2025-12']);
});

test('R23-2 no country rule: the same figures give the same months in China, Hong Kong, Switzerland or without a country', () => {
  const gap = { values: [130, 120, 110, 105, 100], ends: ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-06-30'] };
  const seen = [];
  for (const country of ['China', 'Hong Kong', 'Switzerland', undefined]) {
    const legs = [leg('TESTA.SS', country, 1e9, gap), leg('TESTH.HK', country, 2e9, gap)];
    seen.push(JSON.stringify(legs.map((e) => shownGrowthMonth(e.snapshot))) + first(legs));
  }
  assert.equal(new Set(seen).size, 1, seen.join(' | '));
});

test('R23-2 a Hong Kong home with no exchange twin keeps its June pair against a March mirror (no period lost)', () => {
  const home = leg('TESTH.HK', 'China', 1e9, { values: [130, 120, 110, 105, 100], ends: ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-06-30'] });
  const mirror = leg('TESTM.DE', 'China', 2e9, { values: [120, 110, 105, 100, 90], ends: ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'] });
  assert.deepEqual([shownGrowthMonth(home.snapshot), shownGrowthMonth(mirror.snapshot)], ['2026-06', '2026-03']);
  assert.equal(first([mirror, home]), 'TESTH.HK');
});

test('R23-1 same month: a home listing without enough axes for a rank never pushes out a listing with a rank (ALNY probe)', () => {
  const F = require('../src/scoring/formulas/index.js');
  const W = require('../scripts/write-findash-export.js');
  const { scoreUniverse } = require('../src/scoring/score.js');
  const g = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'protocol', 'gqs-00', '1.1.0', 'golden-fixtures.json'), 'utf8')).cases.find((c) => c.ticker === 'ALNY');
  const good = structuredClone(g.rawSnapshot);
  good.meta = { ...good.meta, ticker: 'PROBE.VI', country: 'Germany', name: 'Review Quality Probe', exchangeName: 'X', tradingCurrency: 'USD', reportingCurrencyOriginal: 'USD' };
  good.marketCap = { value: 2e9 };
  const bad = structuredClone(good);
  bad.meta.ticker = 'PROBE.DE'; bad.marketCap = { value: 1e9 };
  for (const k of Object.keys(bad)) {
    if (k === 'timeseries') bad[k] = Object.fromEntries(Object.entries(bad[k]).filter(([f]) => f.startsWith('revenue')));
    else if (k === 'annual') bad[k] = Object.fromEntries(Object.entries(bad[k]).filter(([f]) => f.startsWith('annualRev')));
    else if (!['meta', 'marketCap', 'timeseries', 'annual'].includes(k)) delete bad[k];
  }
  assert.equal(shownGrowthMonth(good), shownGrowthMonth(bad), 'same month: the old key never decided');
  assert.ok(homeListingRank('PROBE.DE', 'Germany') < homeListingRank('PROBE.VI', 'Germany'), 'PROBE.DE is the home listing');
  const all = scoreUniverse([bad, good], F), rows = all.filter((e) => e.action === 'route');
  W.vergebeRaenge(rows, 'test', { warn: false });
  // 4/7, not 7/7, since Tag 1542 (period gate on #75): only the sealed fixture ALNY itself is excused for its undated pairs,
  // the renamed copy drops those three axes. It still holds a rank, which is all this probe needs.
  assert.deepEqual(rows.map((e) => [e.ticker, e.coverageAxes, e.rank]), [['PROBE.VI', '4/7', 1]]);
  // excluded.json reads the deciding key after the dedup, when the loser has lost its formula (CSC Financial, Mabwell on 31.10.)
  const loser = all.find((e) => e.ticker === 'PROBE.DE');
  assert.deepEqual([loser.reason, require('../src/scoring/score.js').issuerDedupDecision(rows[0], loser).key], ['dup-issuer', 'keinRang']);
});

test('R23-1 the keys: rank first, then the newest month, then more axes, then the home listing; excluded.json names the key', () => {
  const { issuerDedupDecision } = require('../src/scoring/score.js');
  const cov = (e, n, m = 7) => Object.assign(e, { formula: { axes: [] }, _dedupCoverage: { n, m, rankable: n >= 4 } });
  const home = (n, series) => cov(leg('TESTX.DE', 'Germany', 1e9, series), n), other = (n, series) => cov(leg('TESTX.VI', 'Germany', 2e9, series), n);
  const SEPT = { values: [130, 120, 110, 105, 100], ends: ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30'] };
  assert.deepEqual([first([home(3, SEPT), other(6)]), issuerDedupDecision(home(3, SEPT), other(6)).key], ['TESTX.VI', 'keinRang']);
  assert.deepEqual([first([home(5, SEPT), other(7)]), issuerDedupDecision(home(5, SEPT), other(7)).key], ['TESTX.DE', 'aeltererZeitraum']);
  assert.deepEqual([first([home(5), other(7)]), issuerDedupDecision(home(5), other(7)).key], ['TESTX.VI', 'wenigerBelegteAchsen']);
  assert.deepEqual([first([home(7), other(7)]), issuerDedupDecision(home(7), other(7)).key], ['TESTX.DE', 'heimat']);
});

test('R23-3 the homeListingProposal rows are sealed: any change needs a new registration', () => {
  const crypto = require('node:crypto');
  const { loadDupIssuerShadowTable } = require('../lib/dup-issuer-shadow-table.js');
  const rows = Object.entries(loadDupIssuerShadowTable()).filter(([, r]) => r && r.homeListingProposal).map(([k, r]) => [k, r.homeListingProposal]).sort();
  const sha = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'protocol', 'gqs-00', '1.2.0-pending', 'transition.json'), 'utf8')).p290HomeListing;
  assert.equal(sha, reg.homeListingProposalSha256, rows.length + ' rows; a changed proposal needs the registration updated in the same reviewed commit');
});

test('outside China and Taiwan the walk counts: a home listing whose newest quarter lacks its partner keeps its June pair (Boliden)', () => {
  const gap = { values: [130, 120, 110, 105, 100], ends: ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-06-30'] };
  const home = leg('TESTB.ST', 'Sweden', 10e9, gap), mirror = leg('1TESTB.MI', 'Sweden', 12e9, JUNE);
  assert.deepEqual([shownGrowthMonth(home.snapshot), shownGrowthMonth(mirror.snapshot)], ['2026-06', '2026-06']);
  assert.equal(first([mirror, home]), 'TESTB.ST');
});

test('no period at all: the listing with a shown period wins, whatever the home rank', () => {
  const empty = leg('RNO.PA', 'France', 10e9); empty.snapshot.timeseries = {}; empty.snapshot.annual = {};
  assert.equal(shownGrowthMonth(empty.snapshot), '');
  assert.equal(first([empty, leg('RNL.DE', 'France', 9e9)]), 'RNL.DE');
});

test('a sourced row beats the country table and the ticker order (Metlen in London, Orion B)', () => {
  assert.equal(first([leg('MTLN.AT', 'Greece', 8e9), leg('MTLN.L', 'Greece', 7e9), leg('X4Z.DE', 'Greece', 9e9)]), 'MTLN.L');
  assert.equal(first([leg('ORNAV.HE', 'Finland', 15.7e9), leg('ORNBV.HE', 'Finland', 15.6e9)]), 'ORNBV.HE');
});

test('India: NSE before BSE whatever the market caps say, in either direction', () => {
  assert.equal(first([leg('TCS.BO', 'India', 101e9), leg('TCS.NS', 'India', 100e9)]), 'TCS.NS');
  assert.equal(first([leg('TCS.BO', 'India', 100e9), leg('TCS.NS', 'India', 101e9)]), 'TCS.NS');
});

test('share classes on the home exchange stay put when their market caps cross inside a 10 % step, and a line a step larger wins', () => {
  assert.equal(first([leg('AAK-A.ST', 'Sweden', 20.0e9), leg('AAK-B.ST', 'Sweden', 20.1e9)]), 'AAK-A.ST');
  assert.equal(first([leg('AAK-A.ST', 'Sweden', 20.1e9), leg('AAK-B.ST', 'Sweden', 20.0e9)]), 'AAK-A.ST');
  assert.equal(first([leg('CBE.PA', 'France', 1.46e9), leg('RBT.PA', 'France', 1.86e9)]), 'RBT.PA', 'Robertet: a thin line by ticker order lost 21 % of the market cap');
});

test('US primary stays first (Bug 7): a home exchange never beats it', () => {
  const adr = leg('ELPC', 'Brazil', 1e9); adr.snapshot.meta.exchangeName = 'NYSE';
  assert.equal(first([leg('CPLE3.SA', 'Brazil', 2e9), adr]), 'ELPC');
  assert.ok(homeListingRank('CPLE3.SA', 'Brazil') < NOT_HOME);
});

test('a suspect currency on the home listing keeps it out', () => {
  const suspect = leg('SHEL.AS', 'Netherlands', 2e9); suspect.snapshot.meta.reportingCurrencyOriginal = 'USD';
  assert.equal(first([suspect, leg('R6C.DE', 'Netherlands', 1e9)]), 'R6C.DE');
});

test('no evidenced home: the old rule (market cap), with mirror boards last', () => {
  assert.equal(homeListingRank('APAM.AS', 'Luxembourg'), NOT_HOME);
  assert.equal(homeListingRank('1APAM.MI', 'Luxembourg'), SECONDARY_BOARD);
  assert.equal(homeListingRank('APAM.VI', 'Luxembourg'), SECONDARY_BOARD);
  assert.equal(first([leg('APAM.AS', 'Luxembourg', 2e9), leg('APAM.PA', 'Luxembourg', 3e9)]), 'APAM.PA');
  assert.equal(first([leg('1APAM.MI', 'Luxembourg', 9e9), leg('APAM.AS', 'Luxembourg', 2e9), leg('APAM.VI', 'Luxembourg', 8e9)]), 'APAM.AS');
});

test('Austrian and Italian shares are home on their own boards', () => {
  assert.equal(homeListingRank('EBS.VI', 'Austria'), 0);
  assert.equal(homeListingRank('ENI.MI', 'Italy'), 0);
  assert.equal(homeListingRank('1NBA.MI', 'Germany'), SECONDARY_BOARD);
  assert.equal(homeListingRank('ABC.MI', 'Germany'), NOT_HOME); // Only the 1-prefixed Milan lines are the mirror segment.
});

test('the order is total: every input order gives the same winner (scoring and calibration sort separately)', () => {
  const legs = [leg('1FOO.MI', 'Germany', 9e9), leg('FOO.VI', 'Germany', 8e9), leg('FOO.DE', 'Germany', 7e9, SEPT), leg('FOO.SW', 'Germany', 10e9), leg('FOO.PA', 'Germany', 6e9, SEPT)];
  for (const p of permutations(legs)) assert.equal(first(p), 'FOO.DE');
  const classes = [leg('A.ST', 'Sweden', 3e9), leg('B.ST', 'Sweden', 5e9), leg('C.DE', 'Sweden', 4e9), leg('D.ST', 'Sweden', 3.01e9)];
  for (const p of permutations(classes)) assert.deepEqual([...p].sort(issuerDedupComparator).map((e) => e.ticker), ['B.ST', 'A.ST', 'D.ST', 'C.DE']);
});

test('a slim snapshot (meta and market cap only, as in the name count of the merge step) neither throws nor flips', () => {
  const slim = (t, c, m) => ({ ticker: t, snapshot: { meta: { ticker: t, name: 'Firm', country: c }, marketCap: { value: m } } });
  assert.equal(first([slim('FOO.VI', 'Germany', 2e9), slim('FOO.DE', 'Germany', 1e9)]), 'FOO.DE');
});

test('excluded.json names the fallback, its reason and the old rule', () => {
  const home = leg('ASML.AS', 'Netherlands', 608e9, JUNE), other = leg('1ASML.MI', 'Netherlands', 711e9, SEPT);
  const us = leg('GFL', 'United States', 1e9, JUNE, 'GFL Inc'); us.snapshot.meta.exchangeName = 'NYSE';
  const usAbroad = leg('GFL.TO', 'United States', 2e9, JUNE, 'GFL Inc');
  const sw = leg('NESN.SW', 'Switzerland', 200e9, JUNE, 'Nestle SA'), de = leg('NESR.DE', 'Switzerland', 201e9, JUNE, 'Nestle SA');
  const universe = [home, other, us, usAbroad, sw, de].map((e) => e.snapshot);
  const row = (e, action, reason) => ({ ticker: e.ticker, action, reason, score: null, lamps: [] });
  const results = [row(home, 'exclude', 'dup-issuer'), row(other, 'route'), row(us, 'route'), row(usAbroad, 'exclude', 'dup-issuer'), row(sw, 'route'), row(de, 'exclude', 'dup-issuer')];
  const { homeListing } = buildExcludedList(results, universe, []);
  assert.deepEqual(homeListing.fallbacks, [{ issuer: 'Firm N.V.', shown: '1ASML.MI', home: 'ASML.AS', reason: 'aeltererZeitraum', shownMonth: '2026-09', homeMonth: '2026-06' }]);
  // The old-rule comparison ends by data day (lib/comparison-ends.js, arm p290OldRule; both sides: tests/comparison-ends.test.js).
  assert.deepEqual(homeListing.oldRuleDiffers, comparisonShown('p290OldRule') ? [{ shown: 'NESN.SW', oldRule: 'NESR.DE' }] : []);
});

test('excluded.json names a home listing that never reached the contest', () => {
  const home = leg('FOO.DE', 'Germany', 2e9), other = leg('FOO.VI', 'Germany', 3e9);
  const results = [{ ticker: 'FOO.DE', action: 'exclude', reason: 'data-suspect', score: null, lamps: [] }, { ticker: 'FOO.VI', action: 'route', score: null, lamps: [] }];
  const { homeListing } = buildExcludedList(results, [home.snapshot, other.snapshot], []);
  assert.equal(issuerDedupGroups([home, other]).length, 1);
  assert.equal(homeListing.fallbacks.length, 1);
  assert.equal(homeListing.fallbacks[0].reason, 'data-suspect');
  assert.deepEqual(homeListing.counts, { firmsWithHomeTable: 1, onHomeListing: 0, multiListed: 0, multiListedOnHome: 0, multiListedWithoutCountry: 0 });
});

test('excluded.json names a firm with no home listing in the universe, and leaves out what has no home table', () => {
  const mirror = leg('BC8.VI', 'Germany', 3e9, JUNE, 'Bechtle AG'), other = leg('BC8.SW', 'Germany', 2e9, JUNE, 'Bechtle AG');
  const offshore = leg('AAA.VI', 'Bermuda', 3e9, JUNE, 'Offshore Ltd'), offshore2 = leg('AAA.PA', 'Bermuda', 2e9, JUNE, 'Offshore Ltd');
  const us = leg('BBB', 'United States', 3e9, JUNE, 'Plain Inc'), us2 = leg('BBB.VI', 'United States', 2e9, JUNE, 'Plain Inc'); us.snapshot.meta.exchangeName = 'NYSE';
  const results = [mirror, other, offshore, offshore2, us, us2].map((e, i) => ({ ticker: e.ticker, action: i % 2 ? 'exclude' : 'route', reason: i % 2 ? 'dup-issuer' : undefined, score: null, lamps: [] }));
  const { homeListing } = buildExcludedList(results, [mirror, other, offshore, offshore2, us, us2].map((e) => e.snapshot), []);
  assert.deepEqual(homeListing.fallbacks, [{ issuer: 'Bechtle AG', shown: 'BC8.VI', home: null, reason: 'keineLandesnotierungInGruppe', shownMonth: '2026-06', homeMonth: null }]);
  assert.deepEqual(homeListing.counts, { firmsWithHomeTable: 1, onHomeListing: 0, multiListed: 1, multiListedOnHome: 0, multiListedWithoutCountry: 0 });
});

test('the home-listing warning fires when the country vanishes or the firms leave their home, and not on the measured share', () => {
  const firms = (country, a, b) => Array.from({ length: 200 }, (_, i) => [leg(`F${i}${a}`, country, 3e9, JUNE, `Firm ${i}`), leg(`F${i}${b}`, country, 2e9, JUNE, `Firm ${i}`)]).flat();
  const counts = (entries) => {
    const results = entries.map((e, i) => ({ ticker: e.ticker, action: i % 2 ? 'exclude' : 'route', reason: i % 2 ? 'dup-issuer' : undefined, score: null, lamps: [] }));
    return buildExcludedList(results, entries.map((e) => e.snapshot), []).homeListing.counts;
  };
  const home = counts(firms('Germany', '.DE', '.VI'));
  assert.equal(home.multiListedOnHome, 200);
  assert.equal(homeListingWarning(home), null);
  const noCountry = counts(firms(undefined, '.DE', '.VI'));
  assert.deepEqual(noCountry, { firmsWithHomeTable: 0, onHomeListing: 0, multiListed: 0, multiListedOnHome: 0, multiListedWithoutCountry: 200 });
  assert.match(homeListingWarning(noCountry), /0 von 200 .* 200 ohne Land/);
  assert.match(homeListingWarning({ multiListed: 200, multiListedOnHome: 99, multiListedWithoutCountry: 0 }), /99 von 200/);
  assert.equal(homeListingWarning({ multiListed: 1209, multiListedOnHome: 1182, multiListedWithoutCountry: 0 }), null, 'the share of 31.10.2026');
  assert.equal(homeListingWarning({ multiListed: 50, multiListedOnHome: 0, multiListedWithoutCountry: 0 }), null, 'too few to judge');
});

test('the old-rule comparison counts only listings that reached the contest', () => {
  const home = leg('FOO.DE', 'Germany', 1e9), other = leg('FOO.VI', 'Germany', 2e9), dropped = leg('FOO.PA', 'Germany', 9e9);
  const results = [{ ticker: 'FOO.DE', action: 'route', score: null, lamps: [] }, { ticker: 'FOO.VI', action: 'exclude', reason: 'dup-issuer', score: null, lamps: [] }, { ticker: 'FOO.PA', action: 'exclude', reason: 'data-suspect', score: null, lamps: [] }];
  const { homeListing } = buildExcludedList(results, [home.snapshot, other.snapshot, dropped.snapshot], []);
  assert.deepEqual(homeListing.oldRuleDiffers, comparisonShown('p290OldRule') ? [{ shown: 'FOO.DE', oldRule: 'FOO.VI' }] : []);
});

test('the table fails loud when it is malformed, and the committed one loads', () => {
  const { exchanges, boards } = loadHomeListingTable();
  assert.deepEqual(exchanges.get('India'), ['.NS', '.BO']);
  assert.deepEqual(exchanges.get('China'), ['.SS', '.SZ', '.HK']);
  assert.ok(!exchanges.has('United States'), 'US listings are settled by the first comparator keys');
  assert.equal(boards.get('.MI'), '1');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-listing-'));
  const file = path.join(dir, 'bad.json');
  for (const bad of [{}, { exchangesByCountry: { India: 'NS' }, secondaryBoards: { '.VI': { tickerPrefix: '' } } },
    { exchangesByCountry: { India: ['NS'] }, secondaryBoards: { '.VI': { tickerPrefix: '' } } },
    { exchangesByCountry: { India: ['.NS'] }, secondaryBoards: { VI: { tickerPrefix: '' } } }]) {
    fs.writeFileSync(file, JSON.stringify(bad));
    assert.throws(() => loadHomeListingTable(file));
  }
});

console.log(`\nhome-listing.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
