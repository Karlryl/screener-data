'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { taiwanQueue } = require('../scripts/fetch-exchange-quarters');
test('stored-quarter refresh honors the same retry deadlines as first acquisition', () => {
  const now = Date.parse('2026-10-06T12:00:00Z'), day = 86400000;
  const season = { key: '115Q2', rocYear: 115, season: 2, periodEnd: '2026-06-30' };
  const queue = (code, stored, age, readAge = 20) => taiwanQueue({
    sources: { last: { fetchedAt: new Date(now - readAge * day).toISOString(), read: ['9001.TW 115Q2'] } },
    companies: { '9001.TW': { seasons: stored ? { '115Q2': [{}] } : {},
      noData: { '115Q2': { code, at: new Date(now - age).toISOString() } } } },
  }, ['9001.TW'], [season], new Map(), now);
  for (const [code, days] of [[406, 3], ['no-line', 30], ['bad-id', 30], ['ceased', 30], ['failed', 1]]) {
    for (const stored of [true, false]) {
      assert.equal(queue(code, stored, days * day - 1).length, 0, String(code) + ' before deadline, stored=' + stored);
      assert.equal(queue(code, stored, days * day).length, 1, String(code) + ' at deadline, stored=' + stored);
    }
  }
  assert.equal(queue('failed', true, 2 * day, 1).length, 0, 'a recent successful read still suppresses refresh');
});
