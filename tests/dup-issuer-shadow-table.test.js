'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadDupIssuerShadowTable, secondaryIndex, applyDupIssuerShadow } = require('../lib/dup-issuer-shadow-table.js');

const table = loadDupIssuerShadowTable();
const index = secondaryIndex(table);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dup-issuer-shadow-table-'));
let fixtureNumber = 0;
function loadFixture(value) {
  const file = path.join(tmp, `${fixtureNumber++}.json`);
  fs.writeFileSync(file, JSON.stringify(value));
  return loadDupIssuerShadowTable(file);
}
const valid = () => ({ _doku: ['Skipped documentation'], example: structuredClone(table.aerovironment) });

test('real table pins all nine issuers, all tickers and the recorded choices', () => {
  assert.deepEqual(Object.values(table).map((r) => [r.issuer, r.tickers, r.codeKeeps, r.homeListingProposal]), [
    ['AeroVironment', ['AVAV', 'AVAV.SW'], 'AVAV', 'AVAV'],
    ['GE Aerospace', ['GE', 'GCP.DE', 'GE.VI'], 'GE', 'GE'],
    ['Galaxy Digital', ['GLXY', '1GLXY.MI'], 'GLXY', 'GLXY'],
    ['Ascentage Pharma', ['AAPG', '6855.HK'], 'AAPG', null],
    ['Grupo Aeroméxico', ['AERO', 'AERO.MX'], 'AERO', null],
    ['Amrize', ['AMRZ', 'AMRZ.SW'], 'AMRZ', null],
    ['AXIA Energia', ['AXIA', 'AXIA3.SA'], 'AXIA', 'AXIA3.SA'],
    ['Copel', ['ELPC', 'CPLE3.SA'], 'ELPC', 'CPLE3.SA'],
    ['Klöckner & Co', ['KCO.VI', 'KCO.DE'], 'KCO.VI', 'KCO.DE'],
  ]);
  const tickers = Object.values(table).flatMap((r) => r.tickers);
  assert.equal(new Set(tickers).size, tickers.length);
  assert.equal(index.size, 10); // GE has two secondaries; GE.VI is currently absent.
  for (const ticker of ['QSR', 'QSP.TO', 'TAP-A', 'TPX.TO']) assert.ok(!tickers.includes(ticker));
  for (const row of Object.values(table)) {
    assert.equal(row.sourceCheckedOn, '2026-09-30');
    assert.equal(row.enteredOn, '2026-10-06');
  }
  assert.deepEqual(loadFixture(valid()), { example: table.aerovironment });
});

test('missing file and invalid JSON fail loudly', () => {
  assert.throws(() => loadDupIssuerShadowTable(path.join(tmp, 'missing.json')), /ENOENT/);
  const file = path.join(tmp, 'malformed.json');
  fs.writeFileSync(file, '{');
  assert.throws(() => loadDupIssuerShadowTable(file), SyntaxError);
});

for (const root of [null, [], true, 42, 'table']) {
  test(`rejects non-object root ${JSON.stringify(root)}`, () => assert.throws(() => loadFixture(root), /root must be an object/));
}
const badRows = [
  ['null row', (t) => { t.example = null; }, /not an object/],
  ['array row', (t) => { t.example = []; }, /not an object/],
  ['missing issuer', (t) => { delete t.example.issuer; }, /issuer missing/],
  ['empty tickers', (t) => { t.example.tickers = []; }, /tickers/],
  ['missing tickers', (t) => { delete t.example.tickers; }, /tickers/],
  ['invalid ticker', (t) => { t.example.tickers.push(null); }, /tickers/],
  ['whitespace ticker', (t) => { t.example.tickers.push(' BAD '); }, /whitespace/],
  ['wrong codeKeeps', (t) => { t.example.codeKeeps = 'OTHER'; }, /codeKeeps/],
  ['missing source', (t) => { delete t.example.source; }, /source/],
  ['missing URL', (t) => { delete t.example.source.url; }, /source/],
  ['invalid URL', (t) => { t.example.source.url = 'not-a-url'; }, /source/],
  ['missing quote', (t) => { delete t.example.source.quote; }, /source/],
  ['blank quote', (t) => { t.example.source.quote = ' '; }, /source/],
  ['duplicate across rows', (t) => { t.other = structuredClone(t.example); }, /duplicate ticker/],
  ['duplicate within row', (t) => { t.example.tickers.push('AVAV'); }, /duplicate ticker/],
  ['invalid proposal', (t) => { t.example.homeListingProposal = 'OTHER'; }, /homeListingProposal/],
  ['missing proposal', (t) => { delete t.example.homeListingProposal; }, /homeListingProposal/],
  ['invalid checked date', (t) => { t.example.sourceCheckedOn = '2026-02-30'; }, /sourceCheckedOn/],
  ['missing entry date', (t) => { delete t.example.enteredOn; }, /enteredOn/],
  ['missing note', (t) => { delete t.example.note; }, /note/],
  ['invalid slug', (t) => { t.BadSlug = t.example; delete t.example; }, /lower-case slug/],
];
for (const [name, mutate, expected] of badRows) {
  test(`rejects ${name}`, () => {
    const fixture = valid();
    mutate(fixture);
    assert.throws(() => loadFixture(fixture), expected);
  });
}

test('applicator adds only the exact marker, preserving every unrelated value byte-for-byte', () => {
  const tableBefore = JSON.stringify(table);
  for (const entry of Object.values(table)) {
    for (const ticker of entry.tickers) {
      const row = { ticker, rank: 41, score: 74.9, name: 'Existing name', lamps: ['unprofit'], nested: { empty: null, flag: false } };
      const bytes = JSON.stringify(row);
      assert.strictEqual(applyDupIssuerShadow(row, index), row);
      if (ticker === entry.codeKeeps) assert.ok(!Object.hasOwn(row, 'dupIssuer'));
      else {
        assert.deepEqual(row.dupIssuer, { of: entry.codeKeeps, issuer: entry.issuer, basis: 'hand-table:dup-issuer-shadow' });
        assert.deepEqual(index.get(ticker), { of: entry.codeKeeps, issuer: entry.issuer, homeListingProposal: entry.homeListingProposal });
        const once = JSON.stringify(row);
        applyDupIssuerShadow(row, index);
        assert.equal(JSON.stringify(row), once);
        delete row.dupIssuer;
      }
      assert.equal(JSON.stringify(row), bytes);
    }
  }
  const unknown = { ticker: 'FBNC', rank: 1, other: { key: 0 } };
  const bytes = JSON.stringify(unknown);
  assert.strictEqual(applyDupIssuerShadow(unknown, index), unknown);
  assert.equal(JSON.stringify(unknown), bytes);
  assert.equal(JSON.stringify(table), tableBefore);
});
