'use strict';
// Daylauf 5 (22.10.2026): the source lamp opIncYahooAdjusted ("Betriebsergebnis aus Yahoo-Bereinigung") still burned
// on TWE.AX after the hand table P276 replaced every shown annualOpInc cell with the issuer value from the annual
// report. meta.opIncSource names the vendor stream of the packet; the lamp now also looks at what is shown:
// corrected cells (marker) and confirmed cells (expectedBadValue === replacementValue, no marker, VPLAY-A.ST).
// Real frozen packets: tests/fixtures/hand-table-p276.json (TWE.AX, TSRYF, Kinnevik) and
// tests/fixtures/financial-known-cases.json (HL); VPLAY-A.ST uses the native amounts of tests/annual-spikes-p168f.test.js.
// No file is written.
const test = require('node:test'), assert = require('node:assert/strict');
const { applyFinancialCases } = require('../lib/financial-known-cases.js');
const { evaluateLamps } = require('../src/scoring/lamps.js');
const { integritaetsVerfall, lampenBeobachtung, handTableOpIncListings } = require('../scripts/write-board-history.js');
const p276 = require('./fixtures/hand-table-p276.json').snapshots;
const shared = require('./fixtures/financial-known-cases.json').snapshots;
const prepared = s => applyFinancialCases(s).snapshot;
const flags = s => evaluateLamps(s).flags;
const fx = 0.099577785;
const vplay = () => ({
  meta: { ticker: 'VPLAY-A.ST', reportingCurrency: 'USD', reportingCurrencyOriginal: 'SEK', fxConverted: true, fxRateApplied: fx,
    opIncSource: 'yahoo-adjusted' },
  annual: { annualOpInc: [-486e6, -558e6, 10276e6, 413e6].map(v => ({ value: v * fx })),
    annualOpIncEnds: ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31'] },
});

test('every shown annualOpInc value is a hand-table issuer value: no Yahoo source lamp (TWE.AX, TSRYF, HL, HL.SW)', () => {
  const hlSw = structuredClone(shared.HL); hlSw.meta.ticker = 'HL.SW';
  for (const raw of [p276['TWE.AX'], p276.TSRYF, shared.HL, hlSw]) {
    assert.equal(raw.meta.opIncSource, 'yahoo-adjusted', raw.meta.ticker + ': packet label unchanged');
    assert.equal(flags(raw).opIncYahooAdjusted, true, raw.meta.ticker + ': vendor packet before the hand table keeps the lamp');
    assert.equal(flags(prepared(raw)).opIncYahooAdjusted, false, raw.meta.ticker + ': issuer series must not be labelled Yahoo');
  }
});

test('confirmed cells count as issuer values: VPLAY-A.ST (one corrected, three confirmed) loses the lamp', () => {
  const s = prepared(vplay());
  assert.deepEqual(s.annual.annualOpInc.map(r => !!r.financialCorrection), [false, false, true, false]);
  assert.equal(flags(vplay()).opIncYahooAdjusted, true, 'vendor packet keeps the lamp');
  assert.equal(flags(s).opIncYahooAdjusted, false);
});

test('a drifted confirmed vendor cell is withheld by the hand table (with the older years); no issuer claim, lamp as the source says', () => {
  const raw = vplay(); raw.annual.annualOpInc[0].value += 1;
  const s = prepared(raw);
  assert.equal(s.annual.annualOpInc[0].financialMissing.reasonCode, 'vendor-value-changed');
  assert.ok(s.annual.annualOpInc.every(r => r.value === null));
  assert.equal(flags(s).opIncYahooAdjusted, true);
});

test('a shown cell at a case period that is not the issuer value keeps the lamp', () => {
  const s = structuredClone(prepared(vplay()));
  s.annual.annualOpInc[0].value += 1;
  assert.equal(flags(s).opIncYahooAdjusted, true);
});

test('another currency factor than the one the case was applied under keeps the lamp', () => {
  const s = structuredClone(prepared(vplay()));
  s.meta.fxRateApplied = fx * 1.03;
  assert.equal(flags(s).opIncYahooAdjusted, true);
});

test('one vendor cell left in the shown series keeps the lamp', () => {
  const s = structuredClone(prepared(p276['TWE.AX']));
  s.annual.annualOpInc[1] = s.annual.annualOpInc[1].financialCorrection.originalVendorRow;
  assert.equal(flags(s).opIncYahooAdjusted, true);
});

test('the hand table does not decide a series without a shown value, nor opIncSynthetisch (K2 gate label)', () => {
  const kinv = prepared(p276['KINV-A.ST']);
  assert.ok(kinv.annual.annualOpInc.every(r => r?.value == null));
  for (const l of ['opIncSynthetisch', 'opIncYahooAdjusted']) assert.equal(flags(kinv)[l], flags(p276['KINV-A.ST'])[l], l);
  const raw = structuredClone(p276['TWE.AX']); raw.meta.opIncSource = 'computed-margin';
  assert.equal(flags(prepared(raw)).opIncSynthetisch, flags(raw).opIncSynthetisch);
});

test("WB-4' (c): a lost opIncYahooAdjusted on a hand-table listing is a source upgrade, not an integrity loss", () => {
  const set = handTableOpIncListings();
  for (const t of ['TWE.AX', 'TSRYF', 'HL', 'HL.SW', 'VPLAY-A.ST']) assert.ok(set.has(t), t);
  assert.ok(!set.has('MFSL.BO'), 'a hold-only case (replacementValue null) is no proof');
  const row = (ticker, lamps) => ({ ticker, lamps, pit: {} });
  const opts = { handTableOpInc: set };
  assert.equal(integritaetsVerfall(row('HL.SW', ['opIncYahooAdjusted']), row('HL.SW', []), opts), null);
  assert.deepEqual(lampenBeobachtung(row('HL.SW', ['opIncYahooAdjusted']), row('HL.SW', []), opts).quellUpgrade, ['opIncYahooAdjusted']);
  assert.equal(integritaetsVerfall(row('HL.SW', ['opIncYahooAdjusted']), row('HL.SW', []), {}), 'Lampe opIncYahooAdjusted verloren');
  assert.equal(integritaetsVerfall(row('AAPL', ['opIncYahooAdjusted']), row('AAPL', []), opts), 'Lampe opIncYahooAdjusted verloren');
  assert.equal(integritaetsVerfall(row('HL', ['opIncSynthetisch']), row('HL', []), opts), 'Lampe opIncSynthetisch verloren');
});
