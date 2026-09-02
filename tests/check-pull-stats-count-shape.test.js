'use strict';

/**
 * HARDENING-H23: Pull-stat telemetry must not persist malformed count shapes.
 *
 * The historical failure accepted a truthy object from the current manifest,
 * produced NaN drift, reported neither drift nor an unchecked metric, and then
 * persisted that object into both telemetry artifacts. This target stays fully
 * hermetic: main() receives an injected collector and writes only below TMP.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const pullStats = require('../scripts/check-pull-stats.js');

const COUNT_FIELDS = [
  'yahooOk',
  'yahooFailed',
  'yahooTotal',
  'fxRatesCount',
  'fxFailed',
  'earningsWithDate',
  'priceTickerCount',
  'universeSize',
  'snapshotsCount',
];
const WATCHED_FIELDS = ['yahooOk', 'fxRatesCount', 'earningsWithDate', 'priceTickerCount', 'snapshotsCount'];

const VALID_ROW = Object.freeze({
  asOf: '2026-09-01',
  yahooOk: 100,
  yahooFailed: 5,
  yahooTotal: 120,
  yahooSuccessRate: 0.833,
  fxRatesCount: 37,
  fxFailed: 0,
  earningsWithDate: 500,
  priceTickerCount: 700,
  universeSize: 800,
  snapshotsCount: 900,
});

const INVALID_COUNTS = [
  ['undefined', undefined],
  ['object', {}],
  ['array', []],
  ['numeric string', '100'],
  ['empty string', ''],
  ['true', true],
  ['false', false],
  ['negative', -1],
  ['fractional', 1.5],
  ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ['NaN', Number.NaN],
  ['positive infinity', Number.POSITIVE_INFINITY],
  ['negative infinity', Number.NEGATIVE_INFINITY],
];

function history4() {
  return Array.from({ length: 4 }, (_, index) => ({
    ...VALID_ROW,
    asOf: `2026-08-${String(index + 1).padStart(2, '0')}`,
  }));
}

test('count predicate accepts only the nonnegative safe-integer domain', () => {
  assert.equal(typeof pullStats.isValidCount, 'function');
  for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(pullStats.isValidCount(value), true, String(value));
  }
  for (const [label, value] of INVALID_COUNTS) {
    assert.equal(pullStats.isValidCount(value), false, label);
  }
  assert.equal(pullStats.isValidCount(null), false, 'null is an unavailable value, not a count');
});

test('current malformed values are unchecked and never enter drift arithmetic', () => {
  const history = history4();
  for (const metric of WATCHED_FIELDS) {
    for (const [label, value] of INVALID_COUNTS.concat([['explicit null', null]])) {
      const today = { ...VALID_ROW, [metric]: value };
      assert.deepEqual(pullStats.detectStatsDrift(today, history), [], metric + '/' + label + ': drift');
      assert.deepEqual(pullStats.uncheckedStats(today, history), [metric], metric + '/' + label + ': unchecked');
    }
  }
});

test('malformed historical counts cannot qualify as four reference runs', () => {
  for (const metric of WATCHED_FIELDS) {
    for (const [label, value] of INVALID_COUNTS) {
      const history = history4();
      history[3] = { ...history[3], [metric]: value };
      const today = { ...VALID_ROW, [metric]: 1 };
      assert.deepEqual(pullStats.detectStatsDrift(today, history), [], metric + '/' + label + ': drift');
      assert.deepEqual(pullStats.uncheckedStats(today, history), [metric], metric + '/' + label + ': unchecked');
    }
  }
  for (const roots of [
    [0, 0, 0, 0],
    [null, null, null, null],
    [undefined, undefined, undefined, undefined],
    [[], [], [], []],
    ['bad', 'bad', 'bad', 'bad'],
  ]) {
    assert.deepEqual(pullStats.detectStatsDrift(VALID_ROW, roots), []);
    assert.deepEqual(pullStats.uncheckedStats(VALID_ROW, roots), WATCHED_FIELDS);
  }
});

test('present manifest counters are exact while an unavailable manifest remains null', () => {
  assert.equal(typeof pullStats.yahooStatsFromManifest, 'function');
  assert.deepEqual(pullStats.yahooStatsFromManifest(null), {
    yahooOk: null,
    yahooFailed: null,
    yahooTotal: null,
    yahooSuccessRate: null,
  });
  assert.deepEqual(pullStats.yahooStatsFromManifest({ n_ok: 0, n_failed: 0, n_total: 0 }), {
    yahooOk: 0,
    yahooFailed: 0,
    yahooTotal: 0,
    yahooSuccessRate: null,
  });
  assert.deepEqual(pullStats.yahooStatsFromManifest({ n_ok: 15044, n_failed: 1582, n_total: 20762 }), {
    yahooOk: 15044,
    yahooFailed: 1582,
    yahooTotal: 20762,
    yahooSuccessRate: 0.725,
  });

  for (const root of [undefined, [], 'manifest', 7, true]) {
    assert.throws(() => pullStats.yahooStatsFromManifest(root), /manifest/i);
  }
  for (const field of ['n_ok', 'n_failed', 'n_total']) {
    for (const [label, value] of INVALID_COUNTS.concat([['explicit null', null]])) {
      const manifest = { n_ok: 10, n_failed: 1, n_total: 20, [field]: value };
      assert.throws(() => pullStats.yahooStatsFromManifest(manifest), new RegExp(field), field + ': ' + label);
    }
    const inherited = Object.create({ [field]: 10 });
    Object.assign(inherited, { n_ok: 10, n_failed: 1, n_total: 20 });
    delete inherited[field];
    assert.throws(() => pullStats.yahooStatsFromManifest(inherited), new RegExp(field), field + ': inherited');
  }
});

test('the real collector wires manifest validation before every later source', () => {
  function collect(manifest) {
    const jsonQueue = [
      manifest,
      { rates: { USD: 1, EUR: 0.85 }, failed: ['XYZ'] },
      { AAA: { date: '2026-09-01' }, BBB: { date: '2026-09-02' } },
    ];
    const calls = { json: 0, prices: 0, watchlist: 0, fs: 0 };
    const value = pullStats.collectStats({
      root: 'VIRTUAL_PULL_STATS_ROOT',
      now: () => new Date('2026-09-01T01:02:03Z'),
      loadJson: () => {
        calls.json++;
        return jsonQueue.shift();
      },
      loadPrices: () => {
        calls.prices++;
        return { AAA: [], BBB: [] };
      },
      loadWatchlist: () => {
        calls.watchlist++;
        return { shape: 'wrapped', size: 3 };
      },
      fs: {
        existsSync: () => {
          calls.fs++;
          return true;
        },
        readdirSync: () => ['AAA.json', 'BBB.json', '_manifest.json', 'notes.txt'],
      },
    });
    return { value, calls };
  }

  const valid = collect({ n_ok: 10, n_failed: 1, n_total: 20 });
  assert.deepEqual(valid.value, {
    asOf: '2026-09-01',
    yahooOk: 10,
    yahooFailed: 1,
    yahooTotal: 20,
    yahooSuccessRate: 0.5,
    fxRatesCount: 2,
    fxFailed: 1,
    earningsWithDate: 2,
    priceTickerCount: 2,
    universeSize: 3,
    snapshotsCount: 2,
  });
  assert.deepEqual(valid.calls, { json: 3, prices: 1, watchlist: 1, fs: 1 });

  const unavailable = collect(null);
  assert.equal(unavailable.value.yahooOk, null);
  assert.equal(unavailable.value.yahooFailed, null);
  assert.equal(unavailable.value.yahooTotal, null);
  assert.equal(unavailable.value.yahooSuccessRate, null);

  for (const manifest of [
    { n_ok: {}, n_failed: 1, n_total: 20 },
    { n_failed: 1, n_total: 20 },
  ]) {
    let laterSources = 0;
    assert.throws(() => pullStats.collectStats({
      root: 'VIRTUAL_PULL_STATS_ROOT',
      now: () => new Date('2026-09-01T01:02:03Z'),
      loadJson: () => {
        laterSources++;
        return manifest;
      },
      loadPrices: () => { throw new Error('later price source reached'); },
      loadWatchlist: () => { throw new Error('later watchlist source reached'); },
      fs: { existsSync: () => { throw new Error('later filesystem source reached'); } },
    }), /n_ok/);
    assert.equal(laterSources, 1, 'manifest schema failure did not stop later sources');
  }
});

test('complete telemetry row validates without adding arithmetic count relations', () => {
  assert.equal(typeof pullStats.validateStatsRow, 'function');
  assert.deepEqual(pullStats.validateStatsRow(VALID_ROW), VALID_ROW);

  const zeros = { ...VALID_ROW, yahooOk: 0, yahooFailed: 0, yahooTotal: 0, yahooSuccessRate: null };
  assert.deepEqual(pullStats.validateStatsRow(zeros), zeros);
  const maximums = { ...VALID_ROW, yahooOk: Number.MAX_SAFE_INTEGER, yahooFailed: Number.MAX_SAFE_INTEGER,
    yahooTotal: Number.MAX_SAFE_INTEGER, yahooSuccessRate: 1 };
  assert.deepEqual(pullStats.validateStatsRow(maximums), maximums);
  const unavailable = Object.fromEntries(Object.entries(VALID_ROW).map(([key, value]) =>
    [key, COUNT_FIELDS.includes(key) || key === 'yahooSuccessRate' ? null : value]));
  assert.deepEqual(pullStats.validateStatsRow(unavailable), unavailable);

  // Deliberately no n_ok+n_failed/addressable relation: Tag 1134 proved that invented
  // arithmetic relations do not describe the production manifest contract.
  const independentCounts = { ...VALID_ROW, yahooOk: 100, yahooFailed: 100, yahooTotal: 100,
    yahooSuccessRate: 1 };
  assert.deepEqual(pullStats.validateStatsRow(independentCounts), independentCounts);
});

test('validation projects one canonical plain row and reads stateful fields once', () => {
  const poisoned = { ...VALID_ROW, extra: 'drop me' };
  Object.defineProperty(poisoned, 'toJSON', {
    enumerable: false,
    value: () => ({ ...VALID_ROW, yahooOk: { poison: true } }),
  });
  const projected = pullStats.validateStatsRow(poisoned);
  assert.notEqual(projected, poisoned);
  assert.equal(Object.getPrototypeOf(projected), Object.prototype);
  assert.deepEqual(Object.keys(projected), Object.keys(VALID_ROW), 'canonical artifact key order changed');
  assert.equal(Object.prototype.hasOwnProperty.call(projected, 'toJSON'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(projected, 'extra'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(projected)), VALID_ROW);

  let reads = 0;
  const stateful = { ...VALID_ROW };
  Object.defineProperty(stateful, 'yahooOk', {
    enumerable: true,
    get() {
      reads++;
      return reads === 1 ? 100 : { poison: true };
    },
  });
  const stable = pullStats.validateStatsRow(stateful);
  assert.equal(reads, 1);
  assert.equal(stable.yahooOk, 100);
  assert.equal(JSON.parse(JSON.stringify(stable)).yahooOk, 100);
});

test('every malformed persisted field is rejected, including missing properties', () => {
  for (const root of [null, undefined, [], 'row', 5, true]) {
    assert.throws(() => pullStats.validateStatsRow(root), /telemetry|stats|row/i);
  }
  for (const field of COUNT_FIELDS) {
    for (const [label, value] of INVALID_COUNTS) {
      const row = { ...VALID_ROW, [field]: value };
      assert.throws(() => pullStats.validateStatsRow(row), new RegExp(field), field + ': ' + label);
    }
    const missing = { ...VALID_ROW };
    delete missing[field];
    assert.throws(() => pullStats.validateStatsRow(missing), new RegExp(field), field + ': missing');
    const inherited = { ...VALID_ROW };
    delete inherited[field];
    Object.setPrototypeOf(inherited, { [field]: VALID_ROW[field] });
    assert.throws(() => pullStats.validateStatsRow(inherited), new RegExp(field), field + ': inherited');
  }
  for (const [label, value] of [
    ['missing', undefined], ['object', {}], ['array', []], ['string', '1'], ['negative', -0.1],
    ['above one', 1.001], ['NaN', Number.NaN], ['infinity', Number.POSITIVE_INFINITY],
  ]) {
    const row = { ...VALID_ROW, yahooSuccessRate: value };
    if (label === 'missing') delete row.yahooSuccessRate;
    assert.throws(() => pullStats.validateStatsRow(row), /yahooSuccessRate/, label);
  }
  const inheritedRate = { ...VALID_ROW };
  delete inheritedRate.yahooSuccessRate;
  Object.setPrototypeOf(inheritedRate, { yahooSuccessRate: VALID_ROW.yahooSuccessRate });
  assert.throws(() => pullStats.validateStatsRow(inheritedRate), /yahooSuccessRate/);
});

test('asOf is an own canonical calendar date before it becomes a filename', () => {
  for (const value of [undefined, null, {}, [], 20260901, '2026-9-01', '2026-02-30', '../../escape',
    '2026-09-01/../escape', 'not-a-date']) {
    const row = { ...VALID_ROW, asOf: value };
    assert.throws(() => pullStats.validateStatsRow(row), /asOf/);
  }
  const missing = { ...VALID_ROW };
  delete missing.asOf;
  assert.throws(() => pullStats.validateStatsRow(missing), /asOf/);
  const inherited = { ...VALID_ROW };
  delete inherited.asOf;
  Object.setPrototypeOf(inherited, { asOf: VALID_ROW.asOf });
  assert.throws(() => pullStats.validateStatsRow(inherited), /asOf/);
  assert.equal(pullStats.validateStatsRow({ ...VALID_ROW, asOf: '2024-02-29' }).asOf, '2024-02-29');
});

test('main rejects malformed current telemetry before any directory or artifact write', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-stats-shape-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const histDir = path.join(temp, 'history');
  const outDir = path.join(temp, 'daily-must-not-exist');
  fs.mkdirSync(histDir, { recursive: true });
  const historyPath = path.join(histDir, 'history.json');
  const before = JSON.stringify(history4(), null, 2);
  fs.writeFileSync(historyPath, before);

  let error = null;
  try {
    await pullStats.main({ histDir, outDir, collectStats: () => ({ ...VALID_ROW, yahooOk: {} }) });
  } catch (caught) {
    error = caught;
  }

  assert.ok(error, 'malformed row reached a successful return');
  assert.match(error.message, /yahooOk/);
  assert.equal(fs.readFileSync(historyPath, 'utf8'), before, 'history bytes changed');
  assert.equal(fs.existsSync(outDir), false, 'output directory was created before validation');

  const absentHistDir = path.join(temp, 'history-must-not-exist');
  const absentOutDir = path.join(temp, 'daily-also-must-not-exist');
  await assert.rejects(
    () => pullStats.main({ histDir: absentHistDir, outDir: absentOutDir,
      collectStats: () => ({ ...VALID_ROW, yahooOk: {} }) }),
    /yahooOk/,
  );
  assert.equal(fs.existsSync(absentHistDir), false, 'history directory was created before validation');
  assert.equal(fs.existsSync(absentOutDir), false, 'daily directory was created before validation');
});

test('main validates every existing history row before filtering or writing', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-stats-history-shape-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const malformedHistories = [
    history4().slice(0, 3).concat([0]),
    [0, 0, 0, 0],
    history4().map((row, index) => index === 2 ? { ...row, yahooOk: undefined } : row),
    history4().map((row, index) => index === 1 ? { ...row, asOf: '../../escape' } : row),
  ];
  for (let index = 0; index < malformedHistories.length; index++) {
    const caseDir = path.join(temp, String(index));
    const histDir = path.join(caseDir, 'history');
    const outDir = path.join(caseDir, 'daily-must-not-exist');
    fs.mkdirSync(histDir, { recursive: true });
    const historyPath = path.join(histDir, 'history.json');
    const before = JSON.stringify(malformedHistories[index], null, 2);
    fs.writeFileSync(historyPath, before);
    let error = null;
    try {
      await pullStats.main({ histDir, outDir, collectStats: () => ({ ...VALID_ROW }) });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, 'malformed history case ' + index + ' reached a successful return');
    assert.match(error.message, /history\.json row/);
    assert.equal(fs.readFileSync(historyPath, 'utf8'), before, 'history case ' + index + ' changed');
    assert.equal(fs.existsSync(outDir), false, 'history case ' + index + ' created output directory');
  }
});

test('valid and explicitly unavailable controls still use the real atomic persistence path', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-stats-controls-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const validHist = path.join(temp, 'valid-history');
    const validOut = path.join(temp, 'valid-daily');
    fs.mkdirSync(validHist, { recursive: true });
    const historyWithExtras = history4().map((row) => ({ ...row, extra: 'must be projected away' }));
    fs.writeFileSync(path.join(validHist, 'history.json'), JSON.stringify(historyWithExtras));
    const maliciousCurrent = { ...VALID_ROW, extra: 'must not persist' };
    Object.defineProperty(maliciousCurrent, 'toJSON', {
      enumerable: false,
      value: () => ({ ...VALID_ROW, yahooOk: { poison: true }, extra: 'poison' }),
    });
    assert.equal(await pullStats.main({ histDir: validHist, outDir: validOut,
      collectStats: () => maliciousCurrent }), 0);
    const validHistory = JSON.parse(fs.readFileSync(path.join(validHist, 'history.json'), 'utf8'));
    assert.deepEqual(validHistory, history4().concat([VALID_ROW]));
    for (const row of validHistory) assert.deepEqual(Object.keys(row), Object.keys(VALID_ROW));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(validOut, VALID_ROW.asOf + '.json'), 'utf8')), VALID_ROW);

    const nullRow = { ...VALID_ROW, yahooOk: null, yahooSuccessRate: null };
    const nullHist = path.join(temp, 'null-history');
    const nullOut = path.join(temp, 'null-daily');
    fs.mkdirSync(nullHist, { recursive: true });
    fs.writeFileSync(path.join(nullHist, 'history.json'), JSON.stringify(history4()));
    assert.equal(await pullStats.main({ histDir: nullHist, outDir: nullOut,
      collectStats: () => nullRow }), 0);
    const persisted = JSON.parse(fs.readFileSync(path.join(nullHist, 'history.json'), 'utf8'));
    assert.equal(persisted[persisted.length - 1].yahooOk, null);
    assert.ok(logs.some((line) => line.includes('yahooOk') && line.includes('ohne belastbaren Vergleich')),
      'explicit null lost its existing unchecked warning');
  } finally {
    console.log = originalLog;
  }
});
