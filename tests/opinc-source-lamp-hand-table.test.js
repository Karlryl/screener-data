'use strict';
// Daylauf 5 (22.10.2026): the source lamp opIncYahooAdjusted ("Betriebsergebnis aus Yahoo-Bereinigung") still burned
// on TWE.AX after the hand table P276 replaced every shown annualOpInc cell with the issuer value from the annual
// report. meta.opIncSource names the vendor stream of the packet; the lamp now also looks at what is shown.
// Real frozen packets: tests/fixtures/hand-table-p276.json (TWE.AX, TSRYF, Kinnevik) and
// tests/fixtures/financial-known-cases.json (HL). No file is written.
const test = require('node:test'), assert = require('node:assert/strict');
const { applyFinancialCases } = require('../lib/financial-known-cases.js');
const { evaluateLamps } = require('../src/scoring/lamps.js');
const p276 = require('./fixtures/hand-table-p276.json').snapshots;
const shared = require('./fixtures/financial-known-cases.json').snapshots;
const prepared = s => applyFinancialCases(s).snapshot;
const flags = s => evaluateLamps(s).flags;

test('every shown annualOpInc value is a hand-table issuer value: no Yahoo source lamp (TWE.AX, TSRYF, HL)', () => {
  for (const raw of [p276['TWE.AX'], p276.TSRYF, shared.HL]) {
    assert.equal(raw.meta.opIncSource, 'yahoo-adjusted', raw.meta.ticker + ': packet label unchanged');
    assert.equal(flags(raw).opIncYahooAdjusted, true, raw.meta.ticker + ': vendor packet before the hand table keeps the lamp');
    assert.equal(flags(prepared(raw)).opIncYahooAdjusted, false, raw.meta.ticker + ': issuer series must not be labelled Yahoo');
  }
});

test('one vendor cell left in the shown series keeps the lamp', () => {
  const s = structuredClone(prepared(p276['TWE.AX']));
  s.annual.annualOpInc[1] = s.annual.annualOpInc[1].financialCorrection.originalVendorRow;
  assert.equal(flags(s).opIncYahooAdjusted, true);
});

test('a correction marker that is not an annualOpInc hand-table case (e.g. a statement-scale rescale) keeps the lamp', () => {
  const s = structuredClone(prepared(p276['TWE.AX']));
  for (const r of s.annual.annualOpInc) r.financialCorrection = { ...r.financialCorrection, caseId: 'indomim-statement-scale-20261008' };
  assert.equal(flags(s).opIncYahooAdjusted, true);
});

test('a series with no shown value keeps its source lamp (Kinnevik: computed-margin, every cell withheld)', () => {
  const s = prepared(p276['KINV-A.ST']);
  assert.ok(s.annual.annualOpInc.every(r => r?.value == null));
  assert.equal(flags(s).opIncSynthetisch, true);
});

test('synthetic series fully replaced by issuer values loses opIncSynthetisch too', () => {
  const s = structuredClone(prepared(p276['TWE.AX']));
  s.meta.opIncSource = 'computed-margin';
  assert.equal(flags(s).opIncSynthetisch, false);
  assert.equal(flags(s).opIncYahooAdjusted, false);
});
