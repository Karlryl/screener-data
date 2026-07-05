'use strict';
// Regression tests for discovery/wikipedia-indices.js parser (Bugs 20, 29).
// Offline: exercise extractTickersFromWikitext directly, no network.
const { test } = require('node:test');
const assert = require('node:assert');
const { extractTickersFromWikitext } = require('../../discovery/wikipedia-indices.js');

// Bug 20: FTSE-style table whose header row uses '||' as the cell separator.
// Before the fix, split('!!') left one giant header cell, tickerColIdx stayed
// -1, the table was skipped and FTSE100 contributed 0 tickers.
test('Bug 20: header cells separated by || are recognized (FTSE .L suffix)', () => {
  const wikitext = [
    '{|class="wikitable sortable"',
    '|-',
    '! Company !! EPIC || Sector',
    '|-',
    '| BT Group || BT.A || Telecom',
    '|-',
    '| AstraZeneca || AZN || Pharma',
    '|}',
  ].join('\n');
  const out = extractTickersFromWikitext(wikitext, '.L');
  // Bug 29: BT.A must convert to BT-A.L (LSE rule), not stay dotted / lose .L.
  assert.ok(out.has('BT-A.L'), 'expected BT-A.L, got: ' + [...out].join(','));
  assert.ok(out.has('AZN.L'), 'expected AZN.L, got: ' + [...out].join(','));
});

// Bug 29: US class-share tickers with a dot (BRK.B, BF.B) must be converted to
// the Yahoo hyphen form (BRK-B, BF-B), not emitted literally.
test('Bug 29: US class shares BRK.B/BF.B convert to hyphen form', () => {
  const wikitext = [
    '{|class="wikitable sortable"',
    '|-',
    '! Symbol !! Security',
    '|-',
    '| BRK.B || Berkshire Hathaway',
    '|-',
    '| BF.B || Brown-Forman',
    '|-',
    '| AAPL || Apple',
    '|}',
  ].join('\n');
  const out = extractTickersFromWikitext(wikitext, '');
  assert.ok(out.has('BRK-B'), 'expected BRK-B, got: ' + [...out].join(','));
  assert.ok(out.has('BF-B'), 'expected BF-B, got: ' + [...out].join(','));
  assert.ok(out.has('AAPL'));
  assert.ok(!out.has('BRK.B'), 'BRK.B must not leak through unconverted');
});
