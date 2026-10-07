'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'mcap-classes-shadow');
const SNAPSHOTS = path.join(FIXTURE, 'quotes'); // snapshots/ is globally gitignored, including fixtures.
const REGISTRY = path.join(FIXTURE, 'registry.json');
const MODULE = path.join(ROOT, 'lib', 'mcap-classes-shadow.js');
const REPORT = path.join(ROOT, 'scripts', 'mcap-classes-shadow-report.js');
process.env.FINDASH_SNAPSHOTS_DIR = SNAPSHOTS;
const { loadRegistry, computeClassesShadow, deviationPct } = require(MODULE);
const writer = require('../scripts/write-findash-export.js');
const { buildReport } = require(REPORT);
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const entry = loadRegistry(REGISTRY).synthetic;
const snapshots = Object.fromEntries(fs.readdirSync(SNAPSHOTS).map((file) => [file.slice(0, -5), read(path.join(SNAPSHOTS, file))]));
const board = read(path.join(FIXTURE, 'exports', 'health-care.json'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'p88-shadow-test-'));
function writeFixture(name, value) {
  const target = path.resolve(temp, name);
  assert.ok(target.startsWith(temp + path.sep), 'writes stay inside this test generation');
  assert.ok(!target.startsWith(ROOT + path.sep), 'test target must not be a live repository path');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value), { flag: 'wx' });
  return target;
}
function hashes() {
  const files = [MODULE, REPORT, path.join(ROOT, 'scripts', 'write-findash-export.js'),
    path.join(ROOT, 'configs', 'mcap-classes-registry.json'), REGISTRY,
    ...fs.readdirSync(SNAPSHOTS).map((file) => path.join(SNAPSHOTS, file))];
  return files.map((file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
}
const beforeHashes = hashes();
after(() => assert.deepEqual(hashes(), beforeHashes, 'tests and deliberate red probe never change live source or fixtures'));

test('(a) class shares and original quote FX produce 710 million USD, not the vendor total', () => {
  const before = JSON.stringify(snapshots);
  const result = computeClassesShadow(entry, snapshots);
  assert.equal(result.value, 710000000);
  assert.equal(result.status, 'ok');
  assert.equal(result.reason, null);
  assert.deepEqual(result.classes.map((leg) => [leg.price, leg.usdPerUnit, leg.valueUsd]), [[30, .15, 450000000], [10, .13, 260000000]]);
  assert.equal(9000000000 * .15, 1350000000);
  assert.notEqual(result.value, 1350000000);
  assert.equal(result.classes[0].sharesField, 'meta.sharesOutstanding');
  assert.equal(result.classes[0].sharesAsOf, snapshots['688428.SS'].meta.fetchedAt);
  assert.equal(result.classes[0].priceAsOf, snapshots['688428.SS'].meta.asOf);
  assert.equal(result.classes[0].fxSource, 'synthetic applied FX');
  assert.equal(JSON.stringify(snapshots), before, 'pure calculation does not mutate inputs');
});

test('(b) missing H snapshot or class input stays null and never falls back to vendor/implied shares', () => {
  const missing = computeClassesShadow(entry, { '688428.SS': snapshots['688428.SS'] });
  assert.equal(missing.value, null);
  assert.equal(missing.status, 'incomplete');
  assert.match(missing.reason, /9969\.HK.*Snapshot/);
  assert.equal(missing.classes[1].valueUsd, null);
  for (const field of ['sharesOutstanding', 'tradingFxRateApplied', 'fxRateSourceTrading', 'fetchedAt', 'asOf']) {
    const sample = structuredClone(snapshots);
    delete sample['9969.HK'].meta[field];
    const result = computeClassesShadow(entry, sample);
    assert.equal(result.value, null, field);
    assert.equal(result.status, 'incomplete', field);
    assert.match(result.reason, /9969\.HK/);
  }
  const priceMissing = structuredClone(snapshots);
  delete priceMissing['9969.HK'].price;
  assert.equal(computeClassesShadow(entry, priceMissing).value, null);
  const missingDir = path.dirname(writeFixture('missing/688428.SS.json', snapshots['688428.SS']));
  writer.ladeMcapClassesRegistry(REGISTRY, missingDir);
  const row = writer.mapBoardRow(board.profitable[0], 0);
  assert.equal(row.marketCap, 1350000000);
  assert.equal(row.marketCapClassesShadow.value, null);
  assert.equal(row.marketCapClassesDeviationPct, null);
});

test('(c) unregistered USD control has no shadow keys', () => {
  writer.ladeMcapClassesRegistry(REGISTRY, SNAPSHOTS);
  for (const mapper of ['mapBoardRow', 'mapOverviewRow', 'mapSurvivalRow']) {
    const row = writer[mapper](board.profitable[1], 1);
    assert.equal(row.marketCap, 120000000);
    assert.equal(Object.hasOwn(row, 'marketCapClassesShadow'), false);
    assert.equal(Object.hasOwn(row, 'marketCapClassesDeviationPct'), false);
  }
});

test('(d) a dearer H-line uses exactly the same issuer sum as the A-line', () => {
  const sample = structuredClone(snapshots);
  sample['9969.HK'].price.regularMarketPrice = 9;
  const dir = path.dirname(writeFixture('dearer-h/688428.SS.json', sample['688428.SS']));
  writeFixture('dearer-h/9969.HK.json', sample['9969.HK']);
  writer.ladeMcapClassesRegistry(REGISTRY, dir);
  const a = writer.mapBoardRow(board.profitable[0], 0);
  const h = writer.mapBoardRow({ ...board.profitable[2], marketCap: 2700000000 }, 2);
  assert.equal(h.marketCapClassesShadow.value, 2250000000);
  assert.deepEqual(h.marketCapClassesShadow, a.marketCapClassesShadow);
  assert.ok(Math.abs(h.marketCapClassesDeviationPct - 20) < 1e-10);
  assert.equal(h.marketCap, 2700000000);
});

test('(e) malformed registry identifies the entry, duplicate tickers fail, real registry excludes aliases', () => {
  for (const [key, value] of Object.entries({ pattern: 'ADR+ordinary', source: '', unlistedClasses: 'false', classes: [] })) {
    const file = writeFixture(`bad-${key}.json`, { brokenIssuer: { ...entry, [key]: value } });
    assert.throws(() => loadRegistry(file), /entry brokenIssuer/);
  }
  const duplicate = writeFixture('duplicate.json', { first: entry, second: entry });
  assert.throws(() => loadRegistry(duplicate), /entry second.*duplicate/);
  const numericTicker = writeFixture('numeric-ticker.json', { brokenIssuer: { ...entry, classes: [{ ticker: 123, class: 'A' }, entry.classes[1]] } });
  assert.throws(() => loadRegistry(numericTicker), /entry brokenIssuer/);
  assert.throws(() => loadRegistry(writeFixture('array.json', [])), /registry must be an object/);
  const actual = loadRegistry();
  assert.equal(Object.keys(actual).length, 220);
  assert.equal(Object.values(actual).reduce((sum, item) => sum + item.classes.length, 0), 443);
  assert.equal(Object.values(actual).filter((item) => item.listedClassesComplete === false).length, 8);
  for (const excluded of ['TSM', 'BABA', 'NIO', 'ASML', 'STLA']) {
    assert.ok(!Object.values(actual).some((item) => item.classes.some((leg) => leg.ticker === excluded)));
  }
  const alphabet = Object.values(actual).find((item) => item.classes.some((leg) => leg.ticker === 'GOOG'));
  assert.equal(alphabet.unlistedClasses, true);
  assert.deepEqual(alphabet.classes.map((leg) => leg.class), ['A', 'C']);
});

test('(f) every old key and its order are byte-identical to the pre-change export mapping', () => {
  writer.ladeMcapClassesRegistry(REGISTRY, SNAPSHOTS);
  const baseline = read(path.join(FIXTURE, 'mapped-before.json'));
  for (const mapper of Object.keys(baseline)) {
    const actual = board.profitable.map((row, i) => writer[mapper](row, i));
    const stripped = actual.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) =>
      !['marketCapClassesShadow', 'marketCapClassesDeviationPct'].includes(key))));
    assert.equal(JSON.stringify(stripped), JSON.stringify(baseline[mapper]), mapper);
    for (const row of actual.filter((r) => r.ticker !== 'P88-USD')) {
      assert.deepEqual(Object.keys(row).slice(-2), ['marketCapClassesShadow', 'marketCapClassesDeviationPct']);
      assert.equal(row.marketCapClassesShadow.value, 710000000);
    }
  }
  const full = writer.buildBoard('health-care', null, { srcDir: path.join(FIXTURE, 'exports'), deliveryMode: 'full',
    cohortCounts: { profitable: 3, unprofitable: 0 }, rangOpts: { warn: false } });
  assert.deepEqual(full.profitable.map((row) => row.ticker), board.profitable.map((row) => row.ticker));
  assert.deepEqual(full.profitable.filter((row) => row.ticker !== 'P88-USD').map((row) => row.marketCapClassesShadow.value), [710000000, 710000000]);
});

test('(g) frozen tiny generation CLI reports counts, fixed ranks and imported size classes', () => {
  const out = path.join(temp, 'report.json');
  const result = spawnSync(process.execPath, [REPORT, '--snapshots', SNAPSHOTS, '--exports', path.join(FIXTURE, 'exports'), '--out', out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = read(out);
  assert.deepEqual(report.totals, { registryIssuers: 220, issuersOnBoards: 1, populationRows: 3,
    registeredRows: 2, completeRows: 2, incompleteRows: 0, over5Rows: 2, top20Over5Rows: 1, sizeChangeRows: 1, maxAbsRankShift: 0 });
  const profitable = report.boards.find((item) => item.track === 'profitable');
  assert.equal(profitable.populationScoreOrderHeld, true);
  assert.equal(profitable.sizeChanges[0].sizeClass.mcapBand.before, 'large');
  assert.equal(profitable.sizeChanges[0].sizeClass.mcapBand.after, 'mid');
  assert.equal(profitable.sizeChanges[0].sizeClass.mcapKlasse.changed, false);
  assert.match(fs.readFileSync(out.replace(/\.json$/, '.md'), 'utf8'), /Rangverschiebung/);
  assert.equal(fs.existsSync(path.join(ROOT, 'report.json')), false);
  const existing = spawnSync(process.execPath, [REPORT, '--snapshots', SNAPSHOTS, '--exports', path.join(FIXTURE, 'exports'), '--out', out], { encoding: 'utf8' });
  assert.equal(existing.status, 1, 'report must not overwrite an existing file');
  const protectedOut = path.join(SNAPSHOTS, 'must-not-exist.json');
  const protectedResult = spawnSync(process.execPath, [REPORT, '--snapshots', SNAPSHOTS, '--exports', path.join(FIXTURE, 'exports'), '--out', protectedOut], { encoding: 'utf8' });
  assert.equal(protectedResult.status, 1);
  assert.equal(fs.existsSync(protectedOut), false);
});

test('USD proof, minor units, stale quote FX and unavailable timestamps fail closed', () => {
  const pence = structuredClone(snapshots);
  Object.assign(pence['688428.SS'].meta, { tradingCurrencyOriginal: 'GBp', tradingCurrency: 'GBp', tradingFxRateApplied: .0125 });
  pence['688428.SS'].price.regularMarketPrice = 1.25;
  const result = computeClassesShadow(entry, pence);
  assert.equal(result.classes[0].price, 100);
  assert.equal(result.classes[0].valueUsd, 125000000);
  for (const change of [
    (snap) => { snap.price.currencyUnit = 'CNY'; },
    (snap) => { delete snap.price.currencyUnit; delete snap.meta.priceCurrency; },
    (snap) => { snap._pullModeAt = '2026-01-04T12:00:00.000Z'; },
    (snap) => { delete snap._pullModeAt; },
    (snap) => { snap.meta.tradingCurrencyAssumed = true; },
    (snap) => { snap.meta.tradingFxRateApplied = 0; },
    (snap) => { snap.meta.sharesOutstanding = Infinity; },
  ]) {
    const sample = structuredClone(snapshots);
    change(sample['688428.SS']);
    assert.equal(computeClassesShadow(entry, sample).value, null);
  }
  assert.equal(computeClassesShadow({ ...entry, unlistedClasses: true }, snapshots).status, 'listed-classes-only');
  assert.equal(computeClassesShadow({ ...entry, unlistedClasses: true }, snapshots).value, 710000000);
  const unknownClasses = computeClassesShadow({ ...entry, listedClassesComplete: false }, snapshots);
  assert.equal(unknownClasses.status, 'incomplete');
  assert.equal(unknownClasses.value, null);
  assert.match(unknownClasses.reason, /Vollstaendigkeit/);
  assert.equal(deviationPct(null, 710000000), null);
  assert.equal(deviationPct(1350000000, null), null);
  assert.equal(deviationPct(1350000000, 0), null);
  assert.equal(deviationPct(0, 710000000), -100);
});

test('report keeps overview tracks separate and marks missing frozen band bounds', () => {
  const dir = path.dirname(writeFixture('overview/overview.json', { rows: [
    { ...board.profitable[0], track: 'profitable' }, { ...board.profitable[2], track: 'unprofitable' },
  ] }));
  const report = buildReport(SNAPSHOTS, dir, loadRegistry(REGISTRY));
  assert.deepEqual(report.boards.map((item) => item.track), ['profitable', 'unprofitable']);
  assert.equal(report.issuers[0].rows[0].sizeClass.mcapBand.changed, null);
  assert.match(report.issuers[0].rows[0].sizeClass.mcapBand.reason, /eingefrorenen mcapBounds/);
});

test('missing prior size labels remain unknown and never count as class changes', () => {
  for (const [name, prior] of [['null', null], ['absent', undefined]]) {
    const dir = path.dirname(writeFixture(`prior-${name}/board.json`, {
      mcapBounds: board.mcapBounds,
      profitable: [{ ...board.profitable[0], mcapBand: prior, mcapKlasse: prior }],
    }));
    const report = buildReport(SNAPSHOTS, dir, loadRegistry(REGISTRY));
    const size = report.issuers[0].rows[0].sizeClass;
    assert.equal(size.mcapBand.after, 'mid');
    assert.equal(size.mcapKlasse.after, 'small');
    for (const field of ['mcapBand', 'mcapKlasse']) {
      assert.equal(size[field].changed, null);
      assert.match(size[field].reason, /Klassenwechsel nicht messbar/);
    }
    assert.equal(report.totals.sizeChangeRows, 0);
    assert.deepEqual(report.boards[0].sizeChanges, []);
  }
});

test('deliberate red probe catches using implied total shares without changing live code', () => {
  const source = fs.readFileSync(MODULE, 'utf8');
  const anchor = '    const shares = positive(meta.sharesOutstanding) ? meta.sharesOutstanding : null;';
  assert.equal(source.split(anchor).length, 2, 'mutation anchors the whole assignment exactly once');
  const mutantSource = source.replace(anchor, '    const shares = positive(meta.impliedSharesOutstanding) ? meta.impliedSharesOutstanding : null;');
  const context = { module: { exports: {} }, require: createRequire(MODULE), __dirname: path.dirname(MODULE) };
  vm.runInNewContext(mutantSource, context, { filename: MODULE + '.synthetic-mutant' });
  const mutant = context.module.exports.computeClassesShadow(entry, snapshots);
  assert.throws(() => assert.equal(mutant.value, 710000000), { code: 'ERR_ASSERTION' });
  assert.equal(computeClassesShadow(entry, snapshots).value, 710000000);
});

test('Rule of 40: old keys byte-identical to origin/main, shadow passed through on-board and computed off-board', () => {
  const rule40 = require('../scripts/write-rule40-export.js');
  const fixture = read(path.join(FIXTURE, 'rule40-before.json'));
  assert.equal(fixture.source.ref, 'origin/main', 'baseline must come from the unchanged main code');
  writer.ladeMcapClassesRegistry(REGISTRY, SNAPSHOTS);
  const candidates = structuredClone(fixture.candidates);
  const shadow = computeClassesShadow(entry, snapshots);
  candidates[0].row.marketCapClassesShadow = shadow;          // as the main export writes it
  candidates[0].row.marketCapClassesDeviationPct = deviationPct(candidates[0].row.marketCap, shadow.value);
  const rows = rule40.baueZeilen(candidates).rows;
  const stripped = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) =>
    !['marketCapClassesShadow', 'marketCapClassesDeviationPct'].includes(key))));
  assert.equal(JSON.stringify(stripped), JSON.stringify(fixture.before.rows));
  const byTicker = Object.fromEntries(rows.map((row) => [row.ticker, row]));
  assert.deepEqual(byTicker['688428.SS'].marketCapClassesShadow, shadow, 'on-board: same issuer value as the sector board');
  assert.ok(Math.abs(byTicker['688428.SS'].marketCapClassesDeviationPct - (1350 / 710 - 1) * 100) < 1e-9);
  assert.equal(byTicker['9969.HK'].marketCapClassesShadow.value, 710000000, 'off-board: computed by the same function');
  assert.ok(Math.abs(byTicker['9969.HK'].marketCapClassesDeviationPct - (900 / 710 - 1) * 100) < 1e-9);
  assert.equal(Object.hasOwn(byTicker['P88-USD'], 'marketCapClassesShadow'), false, 'unregistered: no new key');
  for (const row of rows.filter((r) => r.ticker !== 'P88-USD')) {
    assert.deepEqual(Object.keys(row).slice(-2), ['marketCapClassesShadow', 'marketCapClassesDeviationPct']);
  }
});

test('small-cap rows get no shadow key; listed-classes-only rows keep the shadow but no deviation', () => {
  writer.ladeMcapClassesRegistry(REGISTRY, SNAPSHOTS);
  const small = writer.ergaenzeMarketCapClassesShadow({ ticker: '688428.SS', marketCap: 1350000000 }, 'smallcap');
  assert.equal(Object.hasOwn(small, 'marketCapClassesShadow'), false);
  assert.equal(Object.hasOwn(small, 'marketCapClassesDeviationPct'), false);
  const listedOnly = writeFixture('listed-only.json', { synthetic: { ...entry, unlistedClasses: true } });
  writer.ladeMcapClassesRegistry(listedOnly, SNAPSHOTS);
  const row = writer.ergaenzeMarketCapClassesShadow({ ticker: '688428.SS', marketCap: 1350000000 });
  assert.equal(row.marketCapClassesShadow.status, 'listed-classes-only');
  assert.equal(row.marketCapClassesShadow.value, 710000000);
  assert.equal(row.marketCapClassesDeviationPct, null);
});
