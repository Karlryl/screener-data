'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const config = require('../configs/non-operating-classes.json');
const { validateNonOperatingConfig, rankGrundShadowFor, rankGrundShadowDisplayText } = require('../lib/non-operating-classes.js');
const CONFIG_FILE = path.resolve(__dirname, '../configs/non-operating-classes.json');
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Every break below mutates a fresh in-memory copy. Writing tests are never break targets.
const badCases = [
  ['schema', (c) => { c.schemaVersion = 2; }, /schemaVersion/],
  ['boundary', (c) => { c.boundary = ''; }, /boundary/],
  ['fixed threshold', (c) => { c.cryptoTreasuryMinShareOfTotalAssets = 0.49; }, /threshold/],
  ['class dictionary missing', (c) => { c.classes = null; }, /classes/],
  ['unknown dictionary code', (c) => { c.classes.surprise = 'extra'; }, /classes/],
  ['missing dictionary code', (c) => { delete c.classes.nichtOperativEtf; }, /classes/],
  ['empty display text', (c) => { c.classes.nichtOperativEtf = ''; }, /classes/],
  ['entries', (c) => { c.entries = {}; }, /entries/],
  ['ticker', (c) => { c.entries[0].ticker = ''; }, /ticker/],
  ['noncanonical ticker', (c) => { c.entries[0].ticker = 'sbr'; }, /ticker/],
  ['duplicate ticker', (c) => { c.entries.push({ ...c.entries[0] }); }, /duplicate/],
  ['unknown entry class', (c) => { c.entries[0].class = 'invented'; }, /unknown class/],
  ...['source', 'sourceUrl', 'sourceQuote'].map((field) => ['missing ' + field, (c) => { delete c.entries[0][field]; }, /missing evidence/]),
  ...['source', 'sourceUrl', 'sourceQuote'].map((field) => ['empty ' + field, (c) => { c.entries[0][field] = ' '; }, /missing evidence/]),
  ['malformed URL', (c) => { c.entries[0].sourceUrl = 'not a URL'; }, /invalid sourceUrl/],
  ['unsupported URL', (c) => { c.entries[0].sourceUrl = 'file:///fixture'; }, /unsupported sourceUrl/],
  ['confidence missing', (c) => { delete c.entries[0].confidence; }, /confidence/],
  ['confidence zero', (c) => { c.entries[0].confidence = 0; }, /confidence/],
  ['confidence high', (c) => { c.entries[0].confidence = 101; }, /confidence/],
];
const cryptoEntry = (c) => c.entries.find((entry) => entry.class === 'nichtOperativKryptoTreasury');
const cryptoCases = [
  ['crypto without filing', (e) => { e.sourceUrl = 'p66://rule'; }, /filing/],
  ['missing digital assets', (e) => { delete e.digitalAssets; }, /amounts/],
  ['negative digital assets', (e) => { e.digitalAssets = -1; }, /amounts/],
  ['missing total assets', (e) => { delete e.totalAssets; }, /amounts/],
  ['zero total assets', (e) => { e.totalAssets = 0; }, /amounts/],
  ['nonfinite amounts', (e) => { e.digitalAssets = Infinity; }, /amounts/],
  ['below threshold despite reported share', (e) => { e.digitalAssets = 49; e.totalAssets = 100; e.share = 0.5; }, /threshold/],
  ['above total assets', (e) => { e.digitalAssets = e.totalAssets + 1; }, /threshold/],
  ['missing share', (e) => { delete e.share; }, /share/],
  ['inconsistent share', (e) => { e.share = 0.51; }, /share/],
  ['missing currency', (e) => { delete e.currency; }, /currency/],
  ['invalid currency', (e) => { e.currency = 'usd'; }, /currency/],
  ['missing date', (e) => { delete e.balanceSheetDate; }, /balanceSheetDate/],
  ['impossible date', (e) => { e.balanceSheetDate = '2026-02-30'; }, /balanceSheetDate/],
  ['unparseable date', (e) => { e.balanceSheetDate = '2026-99-99'; }, /balanceSheetDate/],
];
for (const [name, mutate, error] of [...badCases, ...cryptoCases.map(([name, mutate, error]) =>
  [name, (c) => mutate(cryptoEntry(c)), error])]) {
  test('break once and restore: ' + name, () => {
    const originalHash = digest(CONFIG_FILE);
    const copy = structuredClone(config);
    assert.equal(validateNonOperatingConfig(copy), copy);
    mutate(copy);
    assert.throws(() => validateNonOperatingConfig(copy), error);
    assert.doesNotThrow(() => validateNonOperatingConfig(structuredClone(config)));
    assert.equal(digest(CONFIG_FILE), originalHash, 'the live config must remain byte-identical');
  });
}

test('legal-form boundary, exact threshold, and German display lookup', () => {
  assert.equal(rankGrundShadowFor('SBR'), 'nichtOperativRoyaltyTrust');
  assert.equal(rankGrundShadowFor('PBT'), 'nichtOperativRoyaltyTrust');
  assert.equal(rankGrundShadowFor('AD.TO'), 'nichtOperativHolding');
  for (const ticker of ['FRU.TO', 'BSM', 'WPM', 'TPZ.TO', 'PSK.TO', 'DMLP', 'FNV', 'INVE-A.ST', 'INVE-B.ST', '1INVEB.MI', 'IVSBF', 'MF.PA', 'UNKNOWN']) {
    assert.equal(rankGrundShadowFor(ticker), null, ticker);
  }
  for (const ticker of ['SBET', '3350.T', 'XXI']) assert.equal(rankGrundShadowFor(ticker), 'nichtOperativKryptoTreasury', ticker);
  assert.equal(rankGrundShadowDisplayText(null), null);
  assert.equal(rankGrundShadowDisplayText(undefined), null);
  for (const [code, text] of Object.entries(config.classes)) assert.equal(rankGrundShadowDisplayText(code), text);
  assert.throws(() => rankGrundShadowDisplayText('unknown'), /Unknown/);
  const copy = structuredClone(config), entry = cryptoEntry(copy);
  Object.assign(entry, { digitalAssets: 50, totalAssets: 100, share: 0.5 });
  assert.doesNotThrow(() => validateNonOperatingConfig(copy), 'equality qualifies');
});

function isolatedWriter(filename, findash) {
  const absolute = path.resolve(__dirname, '../scripts', filename);
  const realRequire = createRequire(absolute);
  const module = { exports: {} };
  const fixtureFs = { ...fs, readFileSync() { throw new Error('Fixture has no external data'); } };
  const localRequire = (id) => id === 'fs' || id === 'node:fs' ? fixtureFs
    : id === './write-findash-export.js' ? findash : realRequire(id);
  const source = fs.readFileSync(absolute, 'utf8').replace(/^#![^\n]*\n/, '');
  vm.runInNewContext('(function(require,module,exports,__dirname,__filename){' + source + '\n})',
    { console, process, URL, Buffer })(localRequire, module, module.exports, path.dirname(absolute), absolute);
  return module.exports;
}
const stripShadow = (value) => JSON.parse(JSON.stringify(value, (key, v) => key === 'rankGrundShadow' ? undefined : v));

test('real row exporters match the pre-change HEAD fixture byte for byte except shadow', () => {
  const fixturePath = path.join(__dirname, 'fixtures/non-operating-shadow/export-fixture.json');
  const originalHash = digest(fixturePath);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const w = isolatedWriter('write-findash-export.js');
  const r = isolatedWriter('write-rule40-export.js', w);
  const input = fixture.input;
  const actual = {
    board: w.vergebeRaenge(input.board.map(w.mapBoardRow), 'fixture', { warn: false }),
    overview: w.vergebeRaenge(input.overview.map(w.mapOverviewRow), 'fixture', { warn: false }),
    survival: input.survival.map(w.mapSurvivalRow),
    rule40: r.baueZeilen(input.candidates),
  };
  const check = (value) => assert.equal(JSON.stringify(stripShadow(value)), JSON.stringify(fixture.before));
  check(actual);
  for (const rows of [actual.board, actual.overview, actual.rule40.rows]) {
    for (const row of rows) {
      assert.ok(Object.hasOwn(row, 'rankGrundShadow'));
      assert.equal(row.rankGrundShadow, rankGrundShadowFor(row.ticker));
      const keys = Object.keys(row);
      assert.equal(keys.indexOf('rankGrundShadow'), keys.indexOf('rankGrund') + 1);
    }
  }
  for (const row of actual.survival) assert.equal(Object.hasOwn(row, 'rankGrundShadow'), false);
  assert.equal(actual.board[0].rank, 1, 'SBR keeps its actual rank');
  assert.equal(actual.board[1].rankGrund, 'zuWenigBelegteAchsen', 'existing gate stays unchanged');
  const broken = JSON.parse(JSON.stringify(actual));
  broken.board[0].rank = null;
  assert.throws(() => check(broken), assert.AssertionError, 'rank-inertness guard fires');
  broken.board[0].rank = actual.board[0].rank;
  broken.board[0].score++;
  assert.throws(() => check(broken), assert.AssertionError, 'score-inertness guard fires');
  check(actual);
  assert.equal(digest(fixturePath), originalHash);
});
