'use strict';
// Watcher of the undated exception of period gate round 2 (30.10.2026): acceleration and gross profit still count a pair with
// no end at all, so the export says so on the day a row does. Reads main and small-cap snapshots through the real mapper.
// Run: node tests/period-gate-undated-watcher.test.js
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'period-gate-undated-'));
process.env.FINDASH_SNAPSHOTS_DIR = path.join(tmp, 'snapshots');
process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = path.join(tmp, 'snapshots-smallcap');
fs.mkdirSync(process.env.FINDASH_SNAPSHOTS_DIR); fs.mkdirSync(process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR);

const file = require.resolve('../scripts/write-findash-export.js');
const W = require(file);
const { annualPairsShadow } = require('../lib/annual-pairs.js');
const { produceRankings } = require('../src/scoring/score.js');

const cells = values => values.map(value => ({ value }));
const snapshot = (ticker, annualRevEnds) => ({ meta: { ticker }, metrics: {}, timeseries: {},
  annual: { annualRev: cells([130, 100, 90]), annualGP: cells([65, 50, 45]), ...(annualRevEnds ? { annualRevEnds, annualGPEnds: annualRevEnds } : {}) } });
const DATED = ['2025-12-31', '2024-12-31', '2023-12-31'];
const write = (dir, s) => fs.writeFileSync(path.join(dir, s.meta.ticker + '.json'), JSON.stringify(s));
const row = ticker => produceRankings([{ ticker, action: 'route', formulaId: 'health-care', track: 'profitable', score: 70,
  revGrowthYoYPct: null, overview: { kind: 'gp', value: null, companion: null } }]).branches['health-care'].profitable[0];

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok ' + name); }
try {
  check('an undated pair on the axes is named, a dated pair is not', () => {
    assert.deepEqual(W.undatedAxes(annualPairsShadow(snapshot('A'))), ['acceleration', 'grossProfit']);
    assert.deepEqual(W.undatedAxes(annualPairsShadow(snapshot('B', DATED))), []);
    assert.deepEqual(W.undatedAxes(null), []);
    // Quarters by position carry the acceleration without any end as well.
    const quarters = { meta: { ticker: 'Q' }, annual: {}, metrics: {}, timeseries: { revenueQ: cells([120, 110, 105, 102, 100, 90]) } };
    assert.deepEqual(W.undatedAxes(annualPairsShadow(quarters)), ['acceleration']);
    // A later undated year behind a dated pair stays visible too.
    const mixed = snapshot('M', [DATED[0], DATED[1], null]);
    assert.deepEqual(W.undatedAxes(annualPairsShadow(mixed)), ['acceleration']);
  });

  check('the warning names the rows and is silent at zero', () => {
    assert.equal(W.undatedAxisWarning([]), null);
    assert.match(W.undatedAxisWarning(['ZZ', 'AA']), /^::warning::\[period-gate-undated\] 2 Zeilen: .*: AA, ZZ$/);
  });

  write(process.env.FINDASH_SNAPSHOTS_DIR, snapshot('UNDATEDMAIN'));
  write(process.env.FINDASH_SNAPSHOTS_DIR, snapshot('DATEDMAIN', DATED));
  write(process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR, snapshot('UNDATEDSC'));
  const boards = path.join(tmp, 'boards'); fs.mkdirSync(boards);
  const board = (name, tickers) => fs.writeFileSync(path.join(boards, name), JSON.stringify({ profitable: tickers.map(row), unprofitable: [] }));
  board('financials.json', ['UNDATEDMAIN', 'DATEDMAIN']);
  board('smallcap-financials.json', ['UNDATEDSC']);
  const run = api => {
    api.buildBoard('financials', null, { srcDir: boards, rangOpts: { warn: false } });
    api.buildSmallcapBoard('smallcap-financials.json', null, boards);
    return api.undatedAxisTickers().sort();
  };

  check('the real board builders count main and small-cap rows, dated rows not', () => {
    assert.deepEqual(run(W), ['UNDATEDMAIN', 'UNDATEDSC']);
  });

  for (const [anchor, expected] of [
    ['  if (undatedAxes(annualPairsShadow).length) _undatedAxisTickers.add(row.ticker);', ['UNDATEDMAIN', 'UNDATEDSC']],
    ['  if (undatedAxes(snapAbleitungenFuer(row.ticker, smallcapGrowthSource()).annualPairsShadow).length) _undatedAxisTickers.add(row.ticker);', ['UNDATEDMAIN', 'UNDATEDSC']],
  ]) {
    check('break-once: without "' + anchor.trim().slice(0, 34) + '" a row is not seen', () => {
      const digest = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      const before = digest(), source = fs.readFileSync(file, 'utf8');
      assert.equal(source.split(/\r?\n/).filter(line => line === anchor).length, 1, 'whole-line anchor occurs exactly once');
      const mutant = { exports: {} };
      vm.runInThisContext('(function(require,module,exports,__filename,__dirname){' + source.replace(/^#!.*/, '').replace(anchor, () => '') + '\n})',
        { filename: file + '.watcher-mutant' })(createRequire(file), mutant, mutant.exports, file, path.dirname(file));
      assert.throws(() => assert.deepEqual(run(mutant.exports), expected), error => {
        assert.equal(error.code, 'ERR_ASSERTION');
        console.log(`  BREAK-ONCE ERR_ASSERTION write-findash-export.js: actual ${JSON.stringify(error.actual)}, expected ${JSON.stringify(error.expected)}`);
        return true;
      });
      assert.equal(digest(), before, 'live source unchanged; only the in-memory mutant was discarded');
    });
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`period-gate-undated-watcher.test.js: ${passed} ok, 0 fail`);
