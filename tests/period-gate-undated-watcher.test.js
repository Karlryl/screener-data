'use strict';
// Watcher of the sealed-fixture exception of the period gate (30.10.2026): on the 25 sealed golden fixtures the score axes still
// count a pair with no end, so the export says so if such a snapshot ever stands on a board. Reads main and small-cap rows.
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
const { axisPairBlocked } = require('../lib/annual-pairs.js');
const { capitalEfficiency } = require('../src/scoring/axes.js');
const { produceRankings } = require('../src/scoring/score.js');

const cells = values => values.map(value => ({ value }));
// Two real fixture identities of protocol/gqs-00/1.1.0/golden-fixtures.json.
const MAIN = { ticker: 'ALNY', fetchedAt: '2026-08-02T15:08:52.192Z' }, SC = { ticker: 'BMI', fetchedAt: '2026-08-08T04:10:34.584Z' };
const snapshot = (meta, annualRevEnds) => ({ meta, metrics: {}, timeseries: {},
  annual: { annualRev: cells([130, 100, 90]), annualGP: cells([65, 50, 45]), ...(annualRevEnds ? { annualRevEnds, annualGPEnds: annualRevEnds } : {}) } });
const DATED = ['2025-12-31', '2024-12-31', '2023-12-31'];
const write = (dir, s) => fs.writeFileSync(path.join(dir, s.meta.ticker + '.json'), JSON.stringify(s));
const old = ticker => ({ ticker, fetchedAt: '2026-08-01T00:00:00.000Z' });
const row = ticker => produceRankings([{ ticker, action: 'route', formulaId: 'health-care', track: 'profitable', score: 70,
  revGrowthYoYPct: null, overview: { kind: 'gp', value: null, companion: null } }]).branches['health-care'].profitable[0];

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok ' + name); }
try {
  check('an old undated pair on a snapshot that is no fixture stays blocked, also on capital efficiency alone', () => {
    const capitalOnly = meta => ({ meta, timeseries: {}, annual: { annualRev: [100, 90], annualOpInc: [20, 18],
      annualBalance: [{ totalAssets: 300, totalCurrentLiabilities: 50, currentLiabilities: 50 }, { totalAssets: 100, totalCurrentLiabilities: 50, currentLiabilities: 50 }] } });
    assert.equal(axisPairBlocked(capitalOnly(old('NONFIXTURE')), 'annualRev', 0, 1), true);
    assert.equal(capitalEfficiency(capitalOnly(old('NONFIXTURE'))), null, 'no warning needed: the axis is empty');
    assert.notEqual(capitalEfficiency(capitalOnly(MAIN)), null, 'on a fixture the capital axis runs, and the board watcher below counts that row');
  });

  check('the warning names the rows and is silent at zero', () => {
    assert.equal(W.undatedAxisWarning([]), null);
    assert.match(W.undatedAxisWarning(['ZZ', 'AA']), /^::warning::\[period-gate-undated\] 2 Zeilen: .*: AA, ZZ$/);
  });

  write(process.env.FINDASH_SNAPSHOTS_DIR, snapshot(MAIN));
  write(process.env.FINDASH_SNAPSHOTS_DIR, snapshot(old('OLDMAIN')));
  write(process.env.FINDASH_SNAPSHOTS_DIR, snapshot({ ticker: 'DATEDMAIN', fetchedAt: '2026-10-30T00:00:00.000Z' }, DATED));
  write(process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR, snapshot(SC));
  const boards = path.join(tmp, 'boards'); fs.mkdirSync(boards);
  const board = (name, tickers) => fs.writeFileSync(path.join(boards, name), JSON.stringify({ profitable: tickers.map(row), unprofitable: [] }));
  board('financials.json', [MAIN.ticker, 'OLDMAIN', 'DATEDMAIN']);
  board('smallcap-financials.json', [SC.ticker]);
  const run = api => {
    api.buildBoard('financials', null, { srcDir: boards, rangOpts: { warn: false } });
    api.buildSmallcapBoard('smallcap-financials.json', null, boards);
    return api.undatedAxisTickers().sort();
  };

  check('the real board builders count a fixture on a main or small-cap board, other rows not', () => {
    assert.deepEqual(run(W), ['ALNY', 'BMI']);
  });

  for (const [anchor, expected] of [
    ['  if (sealedFixture) _undatedAxisTickers.add(row.ticker);', ['ALNY', 'BMI']],
    ['  if (snapAbleitungenFuer(row.ticker, smallcapGrowthSource()).sealedFixture) _undatedAxisTickers.add(row.ticker);', ['ALNY', 'BMI']],
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
