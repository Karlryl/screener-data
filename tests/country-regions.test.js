'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCountry, COUNTRY_TO_REGION } = require('../src/scoring/country.js');

// Distinct meta.country values missing from the region table on 23.10.2026 (guard-coverage audit).
const OBSERVED_FORMERLY_MISSING = {
  'Russia': 'Europe', 'Mongolia': 'Asia', 'Macau': 'Asia', 'Cambodia': 'Asia', 'Hungary': 'Europe',
  'Mauritius': 'Africa', 'Lithuania': 'Europe', 'Romania': 'Europe', 'Czech Republic': 'Europe',
  'Gabon': 'Africa', 'Bulgaria': 'Europe', 'Iceland': 'Europe', 'Slovenia': 'Europe',
  'Liechtenstein': 'Europe', 'Malta': 'Europe', 'Bahamas': 'North America', 'Barbados': 'North America',
  'British Virgin Islands': 'North America',
};

test('every formerly unmapped observed country maps to its region', () => {
  for (const [c, r] of Object.entries(OBSERVED_FORMERLY_MISSING)) {
    assert.equal(COUNTRY_TO_REGION[c], r, c);
    assert.equal(normalizeCountry({ country: c }).region, r, c);
  }
});

test('aliases still canonicalize and map', () => {
  assert.deepEqual(normalizeCountry({ country: 'USA' }), { country: 'United States', region: 'North America' });
  assert.equal(normalizeCountry({ country: 'uk' }).country, 'United Kingdom');
  assert.equal(normalizeCountry({ country: 'Korea' }).country, 'South Korea');
  assert.equal(normalizeCountry({ country: 'russia' }).region, 'Europe');
});
