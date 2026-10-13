'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { main } = require('../scripts/fetch-exchange-quarters');
test('missing and null MOPS tables are failures, while genuine no-line tables remain valid', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p51-408a-'));
  for (const kind of ['missing', 'null', 'object', 'empty', 'other', 'revenue']) {
    let calls = 0;
    const result = await main({ markets: ['tw'], dryRun: true, dir, tickers: ['9001.TW', '9002.TW', '9003.TW'],
      priority: new Map(), twCap: 12, now: () => new Date('2026-10-06T12:00:00Z'), log: () => {},
      fetchJson: async (_url, options) => {
        calls++; const request = JSON.parse(options.body);
        const r = { year: request.year, season: request.season, reportType: '合併' };
        if (kind === 'null') r.reportList = null;
        if (kind === 'object') r.reportList = {};
        if (kind === 'empty') r.reportList = [];
        if (kind === 'other') r.reportList = [['other line', '1234', '100']];
        if (kind === 'revenue') { r.titles = [{ main: '項目' }, { main: 'amount' }]; r.reportList = [['營業收入合計', '1,234', '100']]; }
        return { code: 200, result: r };
      } });
    if (['missing', 'null', 'object'].includes(kind)) {
      assert.equal(result.exitCode, 1, kind); assert.equal(calls, 10);
      assert.match(result.results[0].aborted, /10 failures in a row/);
    } else {
      assert.equal(result.exitCode, 0, kind); assert.equal(calls, 12);
      assert.equal(result.results[0].failed, 0);
      assert.equal(result.results[0][kind === 'revenue' ? 'ok' : 'noLine'], 12);
    }
    assert.equal(fs.existsSync(path.join(dir, 'tw.json')), false, 'dry-run never writes the store');
  }
});
