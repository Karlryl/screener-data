'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadDupIssuerShadowTable, markKeeps, secondaryIndex, applyDupIssuerShadow } = require('../lib/dup-issuer-shadow-table.js');

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

test('real table pins all twenty issuers, all tickers and the recorded choices', () => {
  assert.deepEqual(Object.values(table).map((r) => [r.issuer, r.tickers, r.codeKeeps, r.homeListingProposal]), [
    ['AeroVironment', ['AVAV', 'AVAV.SW'], 'AVAV', 'AVAV'],
    ['GE Aerospace', ['GE', 'GCP.DE', 'GE.VI', '1GE.MI'], 'GE', 'GE'],
    ['Galaxy Digital', ['GLXY', '1GLXY.MI'], 'GLXY', 'GLXY'],
    ['Ascentage Pharma', ['AAPG', '6855.HK'], 'AAPG', null],
    ['Grupo Aeroméxico', ['AERO', 'AERO.MX'], 'AERO', null],
    // P290 (30.10.2026): decided for the leading listing, see the row's note.
    ['Amrize', ['AMRZ', 'AMRZ.SW'], 'AMRZ', 'AMRZ'],
    ['AXIA Energia', ['AXIA', 'AXIA3.SA'], 'AXIA', 'AXIA3.SA'],
    ['Copel', ['ELPC', 'CPLE3.SA'], 'ELPC', 'CPLE3.SA'],
    // P290 (01.11.2026): KCO.DE ended on 2026-08-12, so KCO.VI is the home. Vinci's recorded choice moved with the dedup.
    ['Klöckner & Co', ['KCO.VI', 'KCO.DE'], 'KCO.VI', 'KCO.VI'],
    // Numbers-trust audit 23.10.2026: legs the name-only duplicate check missed.
    ['Circle Internet Group', ['CRCL', 'CRCL.SW'], 'CRCL', 'CRCL'],
    ['Strategy', ['MSTR', 'MSTR.SW'], 'MSTR', 'MSTR'],
    ['Energy Fuels', ['UUUU', 'EF2.AX'], 'UUUU', 'UUUU'],
    ['Star Bulk Carriers', ['SBLK', 'SBLK.AT'], 'SBLK', 'SBLK'],
    // P290 (01.11.2026): the first row entered for the dedup itself, from the issuer's sentence on its principal market.
    ['ASML Holding N.V.', ['ASML.AS', '1ASML.MI', 'ASME.DE', 'ASML.SW', 'ASML.VI', 'ASML.WA'], 'ASML.AS', 'ASML.AS'],
    // P290: found wrong by the source check of the country table (Metlen), or a class with crossing market caps.
    ['Metlen Energy & Metals PLC', ['MTLN.L', 'MTLN.AT', 'X4Z.DE'], 'MTLN.L', 'MTLN.L'],
    ['Orion Oyj', ['ORNBV.HE', 'ORNAV.HE', '1ORNBV.MI'], 'ORNBV.HE', 'ORNBV.HE'],
    ['Metsä Board Oyj', ['METSB.HE', 'METSA.HE'], 'METSB.HE', 'METSB.HE'],
    ['Modern Times Group MTG AB', ['MTG-B.ST', 'MTG-A.ST'], 'MTG-B.ST', 'MTG-B.ST'],
    ['Vinci', ['DG.PA', 'DG.SW', 'DG.VI'], 'DG.PA', 'DG.PA'],
    // Numbers-trust audit 23.10.2026, entered 24.10.: PSKY is the former Nasdaq ticker of SKYD (8-K of 2026-10-06).
    ['Skydance Corporation', ['SKYD', 'PSKY'], 'SKYD', 'SKYD'],
  ]);
  const tickers = Object.values(table).flatMap((r) => r.tickers);
  assert.equal(new Set(tickers).size, tickers.length);
  assert.equal(index.size, 29); // 18 before P290, ASML's five other legs, Metlen 2, Orion 2, Metsae Board 1, MTG 1. GE has three secondaries; GE.VI is currently absent.
  for (const ticker of ['QSR', 'QSP.TO', 'TAP-A', 'TPX.TO']) assert.ok(!tickers.includes(ticker));
  const added = new Set(['circle', 'strategy', 'energy-fuels', 'star-bulk', 'vinci']);
  for (const [id, row] of Object.entries(table)) {
    const day = id === 'skydance' ? '2026-10-24' : ['asml-holding', 'metlen', 'orion', 'metsa-board', 'mtg'].includes(id) ? '2026-11-01' : null;
    // Amrize: decided on 2026-10-30 from a re-read source; the row itself dates from 2026-10-06.
    assert.equal(row.sourceCheckedOn, day || (id === 'amrize' ? '2026-10-30' : added.has(id) ? '2026-10-23' : '2026-09-30'));
    assert.equal(row.enteredOn, day || (added.has(id) ? '2026-10-23' : '2026-10-06'));
  }
  assert.deepEqual(loadFixture(valid()), { example: table.aerovironment });
});

// Codex review P266 P2-01: literal expectation, independent of markKeeps(). Copel and AXIA mark the
// non-home ADR (markFollowsHomeListing); every other issuer keeps codeKeeps.
test('real table: literal marker per secondary ticker (no other issuer moves)', () => {
  assert.deepEqual(Object.fromEntries([...index].map(([ticker, v]) => [ticker, v.of])), {
    'AVAV.SW': 'AVAV', 'GCP.DE': 'GE', 'GE.VI': 'GE', '1GLXY.MI': 'GLXY', '6855.HK': 'AAPG',
    'AERO.MX': 'AERO', 'AMRZ.SW': 'AMRZ', AXIA: 'AXIA3.SA', ELPC: 'CPLE3.SA', 'KCO.DE': 'KCO.VI',
    '1GE.MI': 'GE', 'CRCL.SW': 'CRCL', 'MSTR.SW': 'MSTR', 'EF2.AX': 'UUUU', 'SBLK.AT': 'SBLK',
    'DG.VI': 'DG.PA', 'DG.SW': 'DG.PA', PSKY: 'SKYD',
    '1ASML.MI': 'ASML.AS', 'ASME.DE': 'ASML.AS', 'ASML.SW': 'ASML.AS', 'ASML.VI': 'ASML.AS', 'ASML.WA': 'ASML.AS',
    'MTLN.AT': 'MTLN.L', 'X4Z.DE': 'MTLN.L', 'ORNAV.HE': 'ORNBV.HE', '1ORNBV.MI': 'ORNBV.HE', 'METSA.HE': 'METSB.HE', 'MTG-A.ST': 'MTG-B.ST',
  });
  for (const ticker of ['AVAV', 'GE', 'GLXY', 'AAPG', 'AERO', 'AMRZ', 'AXIA3.SA', 'CPLE3.SA', 'KCO.VI', 'CRCL', 'MSTR', 'UUUU', 'SBLK', 'DG.PA', 'SKYD', 'ASML.AS', 'MTLN.L', 'ORNBV.HE', 'METSB.HE', 'MTG-B.ST']) {
    assert.ok(!index.has(ticker), ticker + ' must stay unmarked');
  }
  const kco = applyDupIssuerShadow({ ticker: 'KCO.DE' }, index);
  assert.deepEqual(kco.dupIssuer, { of: 'KCO.VI', issuer: 'Klöckner & Co', basis: 'hand-table:dup-issuer-shadow' });
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
  ['non-true markFollowsHomeListing', (t) => { t.example.markFollowsHomeListing = false; }, /markFollowsHomeListing/],
  ['markFollowsHomeListing without proposal', (t) => { t.example.markFollowsHomeListing = true; t.example.homeListingProposal = null; }, /markFollowsHomeListing/],
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
      if (ticker === markKeeps(entry)) assert.ok(!Object.hasOwn(row, 'dupIssuer'));
      else {
        assert.deepEqual(row.dupIssuer, { of: markKeeps(entry), issuer: entry.issuer, basis: 'hand-table:dup-issuer-shadow' });
        assert.deepEqual(index.get(ticker), { of: markKeeps(entry), issuer: entry.issuer, homeListingProposal: entry.homeListingProposal });
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

test('no sourced home names a listing that ended', () => {
  const dead = JSON.parse(fs.readFileSync(path.join(__dirname, '../data-health/dead-tickers.json'), 'utf8')).tickers;
  assert.ok(dead['KCO.DE'], 'precondition: the ended listing is on the list');
  const rows = Object.entries(table).filter(([, r]) => r.homeListingProposal);
  assert.ok(rows.length >= 10);
  assert.deepEqual(rows.filter(([, r]) => dead[r.homeListingProposal]).map(([id]) => id), []);
});
