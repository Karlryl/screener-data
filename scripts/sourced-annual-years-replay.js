'use strict';

// Offline two-arm measurement using the production preparation, scoring and board writer.
// Usage: node scripts/sourced-annual-years-replay.js <before|after|compare> <data-tree> <output-dir>
// data-tree contains the frozen 31 October snapshots and reference stores. No input is written.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const [arm, dataArg, outArg] = process.argv.slice(2);
assert.ok(['before', 'after', 'compare'].includes(arm) && dataArg && outArg, 'Specify arm, data tree and output directory');
const data = path.resolve(dataArg), out = path.resolve(outArg);
const inside = (a, b) => a === b || a.startsWith(b + path.sep);
assert.ok(!inside(out, root) && !inside(root, out) && !inside(out, data) && !inside(data, out), 'Separate output directory required');
assert.ok(!/(?:lockbox|Market Structure research)/i.test(data + out), 'Forbidden path');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
fs.mkdirSync(out, { recursive: true });
const baselineHead = '42ba5140c676e8cc5131bd350673e3e7f5c16258';

if (arm === 'compare') {
  const a = read(path.join(out, 'before.json')), b = read(path.join(out, 'after.json'));
  assert.equal(a.inputDigest, b.inputDigest, 'Inputs differ');
  assert.equal(a.calibrationDigest, b.calibrationDigest, 'Calibration differs');
  assert.deepEqual(a.universe, b.universe, 'Universe differs');
  const changes = [], counts = { rowsBefore: 0, rowsAfter: 0, commonRows: 0, entries: 0, exits: 0,
    scores: 0, ranks: 0, top100In: 0, top100Out: 0 };
  for (const [board, before] of Object.entries(a.boards)) {
    const previous = new Map(before.map(r => [r.ticker, r]));
    const after = new Map(b.boards[board].map(r => [r.ticker, r]));
    counts.rowsBefore += previous.size; counts.rowsAfter += after.size;
    for (const ticker of new Set([...previous.keys(), ...after.keys()])) {
      const x = previous.get(ticker) || null, y = after.get(ticker) || null;
      if (x && y) counts.commonRows++;
      if (!x) counts.entries++; if (!y) counts.exits++;
      if (x && y && x.score !== y.score) counts.scores++;
      if (x && y && x.rank !== y.rank) counts.ranks++;
      const was = x?.rank != null && x.rank <= 100, now = y?.rank != null && y.rank <= 100;
      if (!was && now) counts.top100In++; if (was && !now) counts.top100Out++;
      if (!x || !y || x.score !== y.score || x.rank !== y.rank) changes.push({ board, ticker, before: x, after: y });
    }
  }
  const axisChanges = [];
  for (const ticker of a.universe) {
    const x = a.axes[ticker], y = b.axes[ticker];
    for (const k of Object.keys(x)) {
      if (!['gpGrowth', 'revAcceleration'].includes(k)) assert.equal(y[k], x[k], 'Out-of-scope axis changed: ' + ticker + '/' + k);
    }
    if (JSON.stringify(x) !== JSON.stringify(y)) axisChanges.push({ ticker, before: x, after: y });
  }
  const result = { baselineHead, day: a.day, counts, axisChanges, changes, inputDigest: a.inputDigest, calibrationDigest: a.calibrationDigest };
  fs.writeFileSync(path.join(out, 'comparison.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ counts, axisChanges }, null, 2));
} else {
  execFileSync('git', ['-c', 'safe.directory=*', 'merge-base', '--is-ancestor', baselineHead, 'HEAD'], { cwd: root });
  const day = '2026-10-31', clock = day + 'T09:38:23.183Z';
  process.env.RUN_DATE_UTC = day;
  const NativeDate = Date;
  global.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return NativeDate.parse(clock); }
  };
  const changed = ['src/scoring/axes.js', 'lib/yahoo-q4-known-cases.js', 'lib/annual-pairs.js'];
  const sourceManifest = arm === 'after' ? Object.fromEntries(['lib/sourced-annual-years.js', 'configs/sourced-annual-years.json']
    .map(f => [f, hash(fs.readFileSync(path.join(root, f)))])) : {};
  const compile = Module._extensions['.js'];
  Module._extensions['.js'] = (mod, file) => {
    const rel = path.relative(root, file).replaceAll('\\', '/');
    if (changed.includes(rel)) {
      const bytes = arm === 'before' ? execFileSync('git', ['-c', 'safe.directory=*', 'show', baselineHead + ':' + rel], { cwd: root }) : fs.readFileSync(file);
      sourceManifest[rel] = hash(bytes); mod._compile(bytes.toString('utf8'), file);
    } else compile(mod, file);
  };
  const originalRead = fs.readFileSync, originalDir = fs.readdirSync, originalExists = fs.existsSync, originalStat = fs.statSync;
  const inputs = new Map();
  const remap = f => {
    const full = path.resolve(String(f)), rel = path.relative(root, full);
    // Code/configs belong to the fixed head; all changing inputs, including discovery, belong to the frozen data tree.
    return /^(external-data|discovery|board-history|snapshots|outputs|state)([\\/]|$)/.test(rel)
      || /^(watchlist(?:-smallcap)?|fx-rates)\.json$/.test(rel) ? path.join(data, rel) : full;
  };
  fs.readFileSync = (file, options) => {
    const full = remap(file), bytes = originalRead(full);
    assert.ok(!/(?:lockbox|Market Structure research)/i.test(full));
    if (full.endsWith('.json') && !inside(full, out) && !full.endsWith('sourced-annual-years.json')) inputs.set(full, hash(bytes));
    const encoding = typeof options === 'string' ? options : options?.encoding;
    return encoding ? bytes.toString(encoding) : bytes;
  };
  fs.readdirSync = (f, ...args) => originalDir(remap(f), ...args);
  fs.existsSync = f => originalExists(remap(f));
  fs.statSync = (f, ...args) => originalStat(remap(f), ...args);
  // Production functions must not persist input overlays or overwrite an export during this measurement.
  fs.writeFileSync = () => { throw new Error('Unexpected production write during replay'); };
  const run = require('../src/scoring/run-screener.js');
  const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
  const snapDir = path.join(data, 'snapshots');
  process.env.FINDASH_SNAPSHOTS_DIR = snapDir;
  const raw = fs.readdirSync(snapDir).filter(f => f.endsWith('.json') && !isMetadataSnapshot(f)).sort()
    .map(f => run.readScoringSnapshot(path.join(snapDir, f))).filter(s => s?.meta?.ticker);
  const wl = require('../lib/watchlist-fs.js').loadWatchlist(path.join(root, 'watchlist.json'));
  assert.equal(wl.error, null);
  const universe = run.mergeSecIntoUniverse(run.filterToAuthorizedUniverse(raw, wl.stocks).filtered);
  const S = require('../src/scoring/score.js'), writer = require('./write-findash-export.js');
  const A = require('../src/scoring/axes.js'), annual = require('../lib/annual-pairs.js'), { norm } = require('../src/scoring/snapshot.js');
  const prior = arm === 'after' ? read(path.join(out, 'before.json')) : null;
  const calibrations = {}, boards = {}, axes = {}, scan = [];
  for (const [family, formulas, options] of [['hg', require('../src/scoring/formulas/index.js'), {}],
    ['quality', require('../src/scoring/formulas/quality/index.js'), { classify: require('../src/scoring/quality-route.js').qualityRoute, growthBoost: false }]]) {
    const results = S.scoreUniverse(universe, formulas, { ...options, ...(prior ? { refCalibration: prior.calibrations[family] } : {}) });
    calibrations[family] = prior?.calibrations[family] || results.calibration;
    const ranked = S.produceRankings(results, { topN: 100 });
    for (const [branch, tracks] of Object.entries(ranked.full)) for (const [track, rows] of Object.entries(tracks)) {
      const board = `${family}/${branch}/${track}`;
      boards[board] = writer.vergebeRaenge(rows.map((r, i) => writer.mapBoardRow(r, i, 'main')).filter(Boolean), board, { warn: false })
        .map(r => ({ ticker: r.ticker, rank: r.rank, score: r.score, revGrowthYoYPct: r.revGrowthYoYPct, coverageAxes: r.coverageAxes }));
    }
  }
  const onBoard = new Set(Object.values(boards).flat().map(r => r.ticker));
  for (const s of universe) {
    axes[s.meta.ticker] = Object.fromEntries(['revGrowthLevel', 'revAcceleration', 'gpGrowth', 'ruleOfX', 'marginTrajectory',
      'capitalEfficiency', 'revisionsMomentum', 'dilution', 'marginLevel', 'roicStability'].map(k => [k, A[k](s)]));
    if (!onBoard.has(s.meta.ticker)) continue;
    const anchors = {};
    for (const f of ['annualRev', 'annualGP']) {
      const i = norm(s, f).findIndex(v => Number.isFinite(v) && v > 0), end = annual.annualPeriodEnds(s, f)[i];
      const age = (NativeDate.parse(day) - NativeDate.parse(end)) / 864e5;
      if (age >= 551 && age <= 730) anchors[f] = { end, age, index: i };
    }
    if (Object.keys(anchors).length) scan.push({ ticker: s.meta.ticker, name: s.meta.name, anchors });
  }
  for (const [file, digest] of inputs) assert.equal(hash(originalRead(file)), digest, 'Input changed during replay: ' + file);
  const result = { baselineHead, arm, day, sourceManifest, snapshotCount: raw.length, universe: universe.map(s => s.meta.ticker),
    inputDigest: hash(JSON.stringify([...inputs].sort())), calibrationDigest: hash(JSON.stringify(calibrations)), calibrations, boards, axes, scan };
  // Restore filesystem before writing this script's own evidence only.
  // writeFileSync was intentionally blocked above; use an explicit descriptor to the validated output directory.
  const fd = fs.openSync(path.join(out, arm + '.json'), 'wx');
  fs.writeSync(fd, JSON.stringify(result)); fs.closeSync(fd);
  const manifest = fs.openSync(path.join(out, arm + '-inputs.json'), 'wx');
  fs.writeSync(manifest, JSON.stringify([...inputs].sort(), null, 2)); fs.closeSync(manifest);
  console.log(JSON.stringify({ arm, snapshotCount: raw.length, universe: universe.length, scan: scan.length, inputDigest: result.inputDigest }));
}
