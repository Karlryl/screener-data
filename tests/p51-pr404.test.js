'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
test('Smallcap tracks and overview retain their own growth provenance despite numeric collisions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p51-404-'));
  const main = path.join(dir, 'main'), small = path.join(dir, 'small'), boards = path.join(dir, 'boards');
  for (const p of [main, small, boards]) fs.mkdirSync(p);
  const previous = [process.env.FINDASH_SNAPSHOTS_DIR, process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR];
  process.env.FINDASH_SNAPSHOTS_DIR = main; process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = small;
  const filename = require.resolve('../scripts/write-findash-export');
  try {
    const cells = a => a.map(value => ({ value }));
    for (const ticker of ['COLLISION', 'MAINONLY']) fs.writeFileSync(path.join(main, ticker + '.json'), JSON.stringify({
      meta: { ticker, tradingCurrency: 'USD' }, timeseries: {}, annual: { annualRev: cells([200, 100]), annualRevEnds: ['2025-12-31', '2024-12-31'] } }));
    fs.writeFileSync(path.join(small, 'COLLISION.json'), JSON.stringify({ meta: { ticker: 'COLLISION', tradingCurrency: 'USD' }, annual: {},
      timeseries: { revenueQ: cells([200, 180, 160, 150, 100]), revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'] } }));
    const row = { ticker: 'COLLISION', score: 50, track: 'profitable', revGrowthYoYPct: 100 };
    fs.writeFileSync(path.join(boards, 'smallcap-test.json'), JSON.stringify({ profitable: [row], unprofitable: [row] }));
    fs.writeFileSync(path.join(boards, 'overview.json'), JSON.stringify([row, { ...row, ticker: 'MAINONLY' }]));
    fs.writeFileSync(path.join(boards, 'index.json'), JSON.stringify({ boards: ['smallcap-test'], generatedFromSnapshots: 1 }));
    const exported = (writer, name) => {
      const scoutDir = path.join(dir, name);
      writer.buildSmallcap({}, { smallcapDir: boards, scoutDir });
      return { b: JSON.parse(fs.readFileSync(path.join(scoutDir, 'test.json'))),
        o: JSON.parse(fs.readFileSync(path.join(scoutDir, 'overview.json'))) };
    };
    delete require.cache[filename]; const w = require(filename);
    const { b, o } = exported(w, 'export-small');
    for (const got of [b.profitable[0], b.unprofitable[0], o.rows[0]]) {
      assert.equal(got.revGrowthBasis, 'quarter'); assert.equal(got.revGrowthPeriodEnd, '2026-06-30');
      assert.equal(got.revGrowthYoYPct, 100); assert.equal(got.score, 50);
    }
    assert.equal(o.rows[1].revGrowthBasis, null, 'missing Smallcap ticker must not borrow main provenance');
    const mainRow = [row].map(w.mapBoardRow)[0], smallRow = w.mapBoardRow(row, 0, 'smallcap');
    assert.equal(mainRow.revGrowthBasis, 'year'); assert.equal(mainRow.revGrowthPeriodEnd, '2025-12-31');
    // Tag 1419 (#425): the computational source ends belong to the same store as the label.
    assert.deepEqual([smallRow.revGrowthSourcePeriodEnd, smallRow.revGrowthSourcePriorPeriodEnd], ['2026-06-30', '2025-06-30']);
    assert.deepEqual([mainRow.revGrowthSourcePeriodEnd, mainRow.revGrowthSourcePriorPeriodEnd], ['2025-12-31', '2024-12-31']);
    for (const key of ['revGrowthBasis', 'revGrowthPeriodEnd', 'revGrowthPriorPeriodEnd',
      'revGrowthSourcePeriodEnd', 'revGrowthSourcePriorPeriodEnd']) { delete mainRow[key]; delete smallRow[key]; }
    assert.deepEqual(mainRow, smallRow, 'only provenance labels may differ');
    process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = path.join(dir, 'absent');
    delete require.cache[filename]; const fallback = require(filename);
    assert.equal(exported(fallback, 'export-main').o.rows[0].revGrowthBasis, 'year', 'whole-corpus fallback follows the producer');
  } finally {
    delete require.cache[filename];
    for (const [i, key] of ['FINDASH_SNAPSHOTS_DIR', 'FINDASH_SMALLCAP_SNAPSHOTS_DIR'].entries()) {
      if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
    }
  }
});
