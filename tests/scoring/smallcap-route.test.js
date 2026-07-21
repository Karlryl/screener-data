'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { smallcapRoute, MIN_MCAP, MAX_MCAP } = require('../../src/scoring/smallcap-route.js');

function baseSnap({ marketCap = 500_000_000, meta = {} } = {}) {
  return {
    meta: { ticker: 'TEST', sector: 'Technology', industry: 'Software - Application', ...meta },
    marketCap: { value: marketCap },
    annual: { annualRev: [{ value: 100_000_000 }, { value: 90_000_000 }] },
  };
}

test('smallcapRoute: US-Name im $300-800M-Band routet auf smallcap-<sektor>', () => {
  const s = baseSnap({ marketCap: 500_000_000 });
  const r = smallcapRoute(s);
  assert.equal(r.action, 'route');
  assert.equal(r.formulaId, 'smallcap-software-comm-services');
});

test('smallcapRoute: marketCap unter Floor -> exclude smallcap-mcap-out-of-band', () => {
  const s = baseSnap({ marketCap: MIN_MCAP - 1 });
  assert.deepEqual(smallcapRoute(s), { action: 'exclude', reason: 'smallcap-mcap-out-of-band' });
});

test('smallcapRoute: marketCap ueber Cap -> exclude smallcap-mcap-out-of-band', () => {
  const s = baseSnap({ marketCap: MAX_MCAP + 1 });
  assert.deepEqual(smallcapRoute(s), { action: 'exclude', reason: 'smallcap-mcap-out-of-band' });
});

test('smallcapRoute: Grenzwerte (Floor/Cap selbst) sind inklusive', () => {
  assert.equal(smallcapRoute(baseSnap({ marketCap: MIN_MCAP })).action, 'route');
  assert.equal(smallcapRoute(baseSnap({ marketCap: MAX_MCAP })).action, 'route');
});

test('smallcapRoute: fehlende marketCap -> exclude smallcap-mcap-out-of-band (nicht crashen)', () => {
  const s = baseSnap({ marketCap: 500_000_000 });
  s.marketCap = undefined;
  assert.deepEqual(smallcapRoute(s), { action: 'exclude', reason: 'smallcap-mcap-out-of-band' });
});

test('smallcapRoute: foreign-listed (im Band, aber nicht US) -> exclude smallcap-non-us', () => {
  const s = baseSnap({ marketCap: 500_000_000, meta: { ticker: 'ASML.AS', sector: 'Technology', industry: 'Semiconductors', exchangeName: 'Amsterdam' } });
  assert.deepEqual(smallcapRoute(s), { action: 'exclude', reason: 'smallcap-non-us' });
});

test('smallcapRoute: route()-Struktur-Excludes werden geerbt (z.B. Bilanz-Bank)', () => {
  const s = baseSnap({ marketCap: 500_000_000, meta: { ticker: 'BANKX', sector: 'Financial Services', industry: 'Banks - Regional' } });
  assert.deepEqual(smallcapRoute(s), { action: 'exclude', reason: 'balance-sheet-bank' });
});
