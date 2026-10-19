'use strict';

// Run normally for regressions; --break-once restores the old lookup only in a module copy.
// Writing tests are never mutation targets; only the production module is copied.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const live = path.resolve(__dirname, '../scripts/write-findash-export.js');
const original = fs.readFileSync(live, 'utf8');
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(live)).digest('hex');

function mapperModule(source, samples) {
  const names = ['snapAbleitungenFuer', 'waehrungsbelegFuer', 'isUsableFxRate',
    'verwerfeMarketCap', 'beurteileWaehrungsbeleg', 'belegPunkte', 'ergaenzeBelegpunkte', 'ergaenzeWaehrungsbeleg',
    'normalizeName', 'gedeckelt', 'mapBoardRow', 'mapOverviewRow', 'mapSurvivalRow'];
  // Extract complete, unmodified declarations; unrelated growth/shadow I/O stays inert.
  const lines = source.split(/\r?\n/);
  const declarations = names.map(name => {
    const starts = lines.flatMap((line, i) => line.startsWith(`function ${name}(`) ? [i] : []);
    assert.equal(starts.length, 1, `Unique declaration: ${name}`);
    let code = '';
    for (let i = starts[0]; i < lines.length; i++) {
      code += lines[i] + '\n';
      try { new vm.Script(code); return code; }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    assert.fail(`Incomplete declaration: ${name}`);
  });
  const context = {
    require: require('node:module').createRequire(live),
    marketCapGuard: require('../lib/market-cap-guard.js'),
    path, SNAP_DIR: 'main', SMALLCAP_SNAP_DIR: 'smallcap', _snapCache: new Map(),
    fs: { readFileSync(file) {
      const key = file.split(path.sep).join('/');
      if (!Object.hasOwn(samples, key)) throw Object.assign(new Error('Missing fixture'), { code: 'ENOENT' });
      return JSON.stringify(samples[key]);
    } },
    safeSnapshotFilename: ticker => ticker + '.json', prepareYahooQ4Snapshot: snap => snap,
    financialReasons: snap => snap?.meta?.reasons || [], captureSnapshot: snap => snap,
    revGrowthLeg: () => null, fcfSchattenJeAlpha: () => null, annualPairsShadowForSnapshot: () => null,
    withG31Variant: () => null, overviewMetric: () => ({ value: null }), // G31 comparison fields stay inert here too.
    g31Variant: () => 'v1', // P267-r3: the derivation cache key names the active arm.
    _dupIssuerShadow: new Map(), _valueFlags: new Map(), applyDupIssuerShadow: () => {},
    rankGrundShadowFor: () => null, athFor: () => null,
    overviewGrowthHold: () => null, applyOverviewHold: row => row, // P186 hold stays inert here, like the other shadows.
    ergaenzeWachstumsBasis: row => row, ergaenzeMarketCapClassesShadow: row => row,
    ROW_FIELDS: ['name', 'marketCap', 'revGrowthYoYPct'], SCORE_MAX: 100,
    _mcapGeprueft: 0, _mcapGenullt: 0,
  };
  vm.runInNewContext(declarations.join('\n'), context, { filename: live });
  return context;
}

function regression(source) {
  const sample = (quarters, meta = {}) => ({
    meta: { tradingCurrency: 'USD', ...meta },
    timeseries: { revenueQ: quarters, revenueQEnds: ['2025-12-31', '2025-09-30'] },
  });
  const samples = {
    'main/BOTH.json': sample([7, 8], { reasons: ['main-proof'], tradingFxRateApplied: 1 }),
    'smallcap/BOTH.json': sample([1, 2, 3, 4], { reasons: ['smallcap-proof'], tradingFxRateApplied: 2 }),
    'smallcap/ONLY.json': sample([0, { value: 3 }, null]),
    'main/MAINONLY.json': sample([1, 2]),
    'smallcap/INVALID.json': sample([], { tradingCurrencyAssumed: true }),
  };
  for (const name of ['mapBoardRow', 'mapOverviewRow']) {
    for (const order of [['main', 'smallcap'], ['smallcap', 'main']]) {
      const mod = mapperModule(source, samples);
      for (const store of order) {
        const row = mod[name]({ ticker: 'BOTH', marketCap: 2000, score: 75 }, 0, store);
        assert.equal(row.marketCap, 2000, `${name}/${store}: proven cap`);
        assert.equal(row.qPunkte, store === 'main' ? 2 : 4, `${name}/${store}: own quarter evidence`);
        assert.equal(row.qSpanTage, 92);
        assert.equal(row.tradingFxRateApplied, store === 'main' ? 1 : 2);
        assert.equal(row.financialDataReasons[0], store + '-proof');
        assert.equal(row.score, 75);
        assert.equal(row.rank, 1);
        assert.equal(mod.snapAbleitungenFuer('BOTH', store).provenanceInputs.meta.reasons[0], store + '-proof');
      }
      const only = mod[name]({ ticker: 'ONLY', marketCap: 3000 }, 0, 'smallcap');
      assert.equal(only.marketCap, 3000, `${name}: smallcap-only cap`);
      assert.equal(only.qPunkte, 2, 'Reported zero counts; null does not');
      for (const ticker of ['MISSING', 'MAINONLY']) {
        const missing = mod[name]({ ticker, marketCap: 3000 }, 0, 'smallcap');
        assert.equal(missing.marketCap, null, 'No per-ticker fallback to main evidence');
        assert.equal(missing.qPunkte, null);
      }
      const invalid = mod[name]({ ticker: 'INVALID', marketCap: 3000 }, 0, 'smallcap');
      assert.equal(invalid.marketCap, null, 'Unproven currency stays empty');
      assert.equal(invalid.qPunkte, 0, 'An observed empty series is not missing');
      for (const store of [undefined, 'main', []]) {
        const main = mod[name]({ ticker: 'MAINONLY', marketCap: 4000 }, 0, store);
        assert.equal(main.marketCap, 4000, 'Main default, whole-store fallback and Array.map callback');
        assert.equal(main.qPunkte, 2);
      }
      const survival = mod.mapSurvivalRow({ ticker: 'BOTH', marketCap: 2000 }, 0);
      assert.equal(survival.tradingFxRateApplied, 1, 'Survival remains on main');
      assert.equal(Object.hasOwn(survival, 'qPunkte'), false);
    }
  }
}

regression(original);
console.log('PASS P159 smallcap: both mappers, both cache orders, evidence gaps and main controls');
if (process.argv.includes('--break-once')) {
  const before = hash();
  const base = fs.realpathSync(process.env.P159_TEMP_DIR || os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(base, 'p159-store-'));
  const target = path.resolve(scratch, 'write-findash-export.js');
  try {
    assert.notEqual(target, live);
    assert.notEqual(target, path.resolve(__filename));
    assert.equal(path.dirname(target), fs.realpathSync(scratch));
    const anchor = "      snap = prepareYahooQ4Snapshot(JSON.parse(fs.readFileSync(path.join(SMALLCAP_SNAP_DIR, safeSnapshotFilename(ticker)), 'utf8')));";
    const oldLine = "      snap = prepareYahooQ4Snapshot(JSON.parse(fs.readFileSync(path.join(SNAP_DIR, safeSnapshotFilename(ticker)), 'utf8')));";
    const lines = original.split(/\r?\n/);
    assert.equal(lines.filter(line => line === anchor).length, 1, 'Complete-line mutation anchor');
    fs.writeFileSync(target, lines.map(line => line === anchor ? oldLine : line).join('\n'));
    assert.throws(() => regression(fs.readFileSync(target, 'utf8')), error => {
      assert.equal(error.code, 'ERR_ASSERTION');
      assert.match(error.message, /own quarter evidence/);
      console.log('BREAK-ONCE RED F-01: ' + error.message);
      return true;
    });
  } finally {
    assert.equal(hash(), before, 'Live source must remain byte-identical');
    assert.equal(path.dirname(fs.realpathSync(scratch)), base);
    fs.rmSync(scratch, { recursive: true });
  }
}
