#!/usr/bin/env node
'use strict';

// Read-only replay: immutable raw files, exact overlay whitelist, real scorer.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert/strict');
const cp = require('child_process');
const { Module, createRequire } = require('module');
const { applyKnownCases } = require('../lib/yahoo-q4-known-cases.js');
const { applyFinancialCases, table } = require('../lib/financial-known-cases.js');
const { applyZeroGuard, modeForReplay } = require('../lib/zero-financials-guard.js');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { filterToAuthorizedUniverse, mergeSecIntoUniverse } = require('../src/scoring/run-screener.js');
const { scoreUniverse, produceRankings } = require('../src/scoring/score.js');
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const serial = JSON.stringify;
const clone = x => structuredClone(x);

function diffCells(before, after, events) {
  const restore = clone(after), changes = [];
  // Stale cells are withheld as missing, so they are cell changes too and must be listed.
  for (const e of events.filter(e => ['corrected', 'missing', 'stale'].includes(e.status) &&
    typeof e.container === 'string' && typeof e.field === 'string' && Number.isInteger(e.index))) {
    const original = before[e.container][e.field][e.index];
    const changed = after[e.container][e.field][e.index];
    if (serial(original) === serial(changed)) continue;
    changes.push({ ...e, oldRow: original, newRow: changed });
    restore[e.container][e.field][e.index] = clone(original);
  }
  if (events.some(e => e.status === 'quarantined' || e.reasonCode === 'quarantine-superseded')) {
    const { financialDataIssue: oldIssue, ...oldMeta } = before.meta;
    const { financialDataIssue: newIssue, ...newMeta } = restore.meta;
    assert.equal(serial(newMeta), serial(oldMeta), before.meta.ticker + ': all unrelated bytes must match');
    restore.meta = clone(before.meta);
  }
  assert.equal(serial(restore), serial(before), before.meta.ticker + ': all unrelated bytes must match');
  return changes;
}

function publishedRows(ref) {
  const root = path.resolve(__dirname, '..');
  const git = args => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  const paths = git(['ls-tree', '-r', '--name-only', ref, 'outputs/findash-export/v1']).trim().split('\n')
    .filter(p => p.endsWith('.json') && !/druckenmiller|excluded|\/rule40\//.test(p));
  const rows = [];
  for (const file of paths) {
    const family = file.includes('/quality/') ? 'quality' : file.includes('/smallcap/') ? 'smallcap' : 'growth';
    const doc = JSON.parse(git(['show', `${ref}:${file}`]));
    const walk = x => {
      if (!x || typeof x !== 'object') return;
      if (typeof x.ticker === 'string' && Object.hasOwn(x, 'score')) rows.push({ family, file, ticker: x.ticker, score: x.score, growth: x.revGrowthYoYPct });
      for (const child of Object.values(x)) if (child && typeof child === 'object') walk(child);
    };
    walk(doc);
  }
  return rows;
}

const families = [
  ['growth', require('../src/scoring/formulas/index.js'), {}],
  ['quality', require('../src/scoring/formulas/quality/index.js'), { classify: require('../src/scoring/quality-route.js').qualityRoute, growthBoost: false }],
  ['smallcap', require('../src/scoring/formulas/smallcap/index.js'), { classify: require('../src/scoring/smallcap-route.js').smallcapRoute, growthBoost: false }],
];
function scoredMap(results) {
  const ranked = produceRankings(results, { topN: 100 });
  const rows = new Map();
  for (const [board, b] of Object.entries(ranked.full)) for (const track of ['profitable','unprofitable']) {
    for (const row of b[track] || []) rows.set(row.ticker, { ticker: row.ticker, board, track,
      score: Number.isFinite(row.score) ? Math.min(100, row.score) : null, growth: row.revGrowthYoYPct });
  }
  return rows;
}
function compareVisible(before, after, visible, family) {
  const output = [];
  const tickers = new Set(visible.filter(r => r.family === family).map(r => r.ticker));
  for (const ticker of after.keys()) if (!before.has(ticker)) tickers.add(ticker);
  for (const ticker of tickers) {
    const a = before.get(ticker), b = after.get(ticker);
    if (a?.score !== b?.score || a?.board !== b?.board) output.push({ family, ticker, board: a?.board ?? b?.board,
      oldScore: a?.score ?? null, newScore: b?.score ?? null, oldGrowth: a?.growth ?? null, newGrowth: b?.growth ?? null });
  }
  return output;
}

// Run the actual Rule40 producer with an in-memory, read-only view. Prepared arms
// must not pass through today's overlay again (that would contaminate baseline).
function rule40Replay(snapshots, scored, ref, names) {
  const root = path.resolve(__dirname, '..'), v1 = path.join(root, '_virtual-f2', 'v1');
  const dir = path.join(root, '_virtual-f2', 'snapshots'), files = new Map();
  const published = relative => JSON.parse(cp.execFileSync('git', ['show', `${ref}:outputs/findash-export/v1/${relative}`],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  const index = published('index.json'); files.set(path.join(v1, 'index.json'), serial(index));
  const full = produceRankings(scored, { topN: 100 }).full;
  const { rangGrund, beurteileWaehrungsbeleg } = require('./write-findash-export.js');
  const snapshotMap = new Map(snapshots.map(s => [s.meta.ticker,s]));
  for (const branch of index.branches) {
    const original = published(`full/${branch}.json`), board = { ...original };
    for (const track of ['profitable','unprofitable']) {
      const old = new Map((original[track] || []).map(r => [r.ticker, r]));
      board[track] = (full[branch]?.[track] || []).map(r => ({ ...old.get(r.ticker), ...r,
        marketCap: old.has(r.ticker) ? old.get(r.ticker).marketCap :
          (beurteileWaehrungsbeleg(snapshotMap.get(r.ticker)?.meta || {}).ok ? r.marketCap : null),
        score: Number.isFinite(r.score) ? Math.min(100, r.score) : null, rankGrund: rangGrund(r) }));
    }
    files.set(path.join(v1, 'full', branch + '.json'), serial(board));
  }
  assert.equal(names.length, snapshots.length);
  snapshots.forEach((s,i) => files.set(path.join(dir,names[i]), serial(s)));
  const readonlyFs = { readFileSync: p => {
    const result = files.get(path.resolve(p));
    if (result === undefined) throw new Error('Unexpected virtual read: ' + p);
    return result;
  }, readdirSync: p => { assert.equal(path.resolve(p), dir); return names; } };
  const file = path.join(__dirname, 'write-rule40-export.js'), m = new Module(file, module);
  const realRequire = createRequire(file); m.filename = file; m.paths = module.paths;
  m.require = id => id === 'node:fs' ? readonlyFs :
    id === '../lib/yahoo-q4-known-cases.js' ? { prepareSnapshot: s => s } :
    id === '../lib/atomic-write.js' ? { writeJsonAtomic: () => { throw new Error('Replay must never write'); } } : realRequire(id);
  m._compile(fs.readFileSync(file, 'utf8'), file);
  const collected = m.exports.sammleKandidaten({ v1Dir: v1, snapshotsDir: dir });
  return { ...m.exports.baueZeilen(collected.kandidaten), candidates: collected.kandidaten.length,
    read: collected.gelesen, rejected: collected.abgewiesen };
}

function rule40Diff(before, after) {
  const a = new Map(before.rows.map(r => [r.ticker,r])), b = new Map(after.rows.map(r => [r.ticker,r]));
  const fields = ['score','r40','r40Ebitda','rank','revGrowthYoYPct'];
  return [...new Set([...a.keys(),...b.keys()])].flatMap(ticker => {
    const changes = fields.filter(f => a.get(ticker)?.[f] !== b.get(ticker)?.[f]);
    return changes.length ? [{ ticker, board: 'rule40', changes,
      before: Object.fromEntries(fields.map(f=>[f,a.get(ticker)?.[f]??null])),
      after: Object.fromEntries(fields.map(f=>[f,b.get(ticker)?.[f]??null])) }] : [];
  });
}

// live: Growth recalibrates on the replayed universe as the production run does (no stored calibration).
function replay(dir, { ref = 'origin/gh-pages', date = '2026-09-29',
  watchlistRef = '256d26910e637142ceddedf51cf39b394be9287f', live = false } = {}) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !isMetadataSnapshot(f)).sort();
  const hashes = [], snapshotNames = [], baseline = [], known = [], shadow = [], changes = [], zeroChanges = [], quarantines = [];
  let unchanged = 0, nonzeroChangesByZeroRule = 0;
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(dir, file)), raw = JSON.parse(bytes);
    hashes.push([file, hash(bytes)]);
    if (!raw?.meta?.ticker) continue;
    snapshotNames.push(file);
    const before = applyKnownCases(raw).snapshot;
    const f = applyFinancialCases(before), z = applyZeroGuard(f.snapshot, { mode: 'active' });
    changes.push(...diffCells(before, f.snapshot, f.events));
    const zChanges = diffCells(f.snapshot, z.snapshot, z.events);
    zeroChanges.push(...zChanges);
    for (const e of zChanges) if ((typeof e.oldRow === 'number' ? e.oldRow : e.oldRow?.value) !== 0) nonzeroChangesByZeroRule++;
    quarantines.push(...f.events.filter(e => e.status === 'quarantined'));
    if (serial(before) === serial(f.snapshot)) unchanged++;
    baseline.push(before); known.push(f.snapshot); shadow.push(z.snapshot);
  }
  assert.equal(nonzeroChangesByZeroRule, 0);
  // The scoring job used this earlier watchlist, before the day's later refresh.
  // Using today's HEAD introduces 127 unrelated companies and moves calibration.
  const wl = JSON.parse(cp.execFileSync('git', ['show', `${watchlistRef}:watchlist.json`],
    { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })).stocks;
  const select = rows => {
    const u = filterToAuthorizedUniverse(clone(rows), wl).filtered;
    mergeSecIntoUniverse(u);
    return u;
  };
  const beforeU = select(baseline), knownU = select(known), shadowU = select(shadow);
  const visible = publishedRows(ref);
  const boardChanges = [], zeroBoardChanges = [], publicationDiscrepancies = [], directChanges = [], directZeroChanges = [];
  const requested = [];
  let rule40;
  for (const [family, formulas, opts] of families) {
    const fixed = family === 'growth' && !live ? { refCalibration: require(`../board-history/${date}/calibration.json`) } : {};
    const b = scoreUniverse(beforeU, formulas, { ...opts, ...fixed });
    // Quality/Smallcap lack a stored dated calibration: freeze their baseline for direct effects,
    // then separately include ordinary live-calibration spillovers. Growth uses published calibration unless live.
    const refCalibration = fixed.refCalibration || b.calibration;
    const k = scoreUniverse(knownU, formulas, { ...opts, ...fixed });
    const z = scoreUniverse(shadowU, formulas, { ...opts, ...fixed });
    if (family === 'growth') {
      const rb = rule40Replay(baseline, b, ref, snapshotNames), rk = rule40Replay(known, k, ref, snapshotNames),
        rz = rule40Replay(shadow, z, ref, snapshotNames);
      const publishedRule40 = JSON.parse(cp.execFileSync('git',
        ['show', `${ref}:outputs/findash-export/v1/rule40/overview.json`],
        { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
      rule40 = { baselineRows: rb.rows.length, knownRows: rk.rows.length, shadowRows: rz.rows.length,
        read: rb.read, baselineCandidates: rb.candidates, baselineDiscrepancies: rule40Diff(publishedRule40,rb),
        activeChanges: rule40Diff(rb,rk), shadowChanges: rule40Diff(rk,rz) };
    }
    const bm = scoredMap(b), km = scoredMap(k), zm = scoredMap(z);
    boardChanges.push(...compareVisible(bm, km, visible, family));
    zeroBoardChanges.push(...compareVisible(km, zm, visible, family));
    const kd = scoreUniverse(knownU, formulas, { ...opts, refCalibration });
    const zd = scoreUniverse(shadowU, formulas, { ...opts, refCalibration });
    directChanges.push(...compareVisible(bm, scoredMap(kd), visible, family));
    directZeroChanges.push(...compareVisible(scoredMap(kd), scoredMap(zd), visible, family));
    for (const p of visible.filter(r => r.family === family)) {
      const a = bm.get(p.ticker);
      if (a?.score !== p.score) publicationDiscrepancies.push({ ...p, replayScore: a?.score ?? null });
    }
    for (const ticker of new Set([...table.cases, ...table.quarantines].map(x => x.ticker))) {
      requested.push({ family, ticker, before: bm.get(ticker) ?? null, after: km.get(ticker) ?? null,
        afterReason: k.find(r => r.ticker === ticker)?.reason ?? null });
    }
  }
  for (const [file, before] of hashes) assert.equal(hash(fs.readFileSync(path.join(dir, file))), before, 'Disk changed: ' + file);
  return { snapshots: baseline.length, authorizedSnapshots: beforeU.length, watchlistRef, publicationRef: ref, growthCalibration: live ? 'live' : date,
    unchangedSnapshots: unchanged,
    changedCells: changes.length, staleCells: changes.filter(c => c.status === 'stale').length, quarantines, changes, allOtherRowsByteIdentical: true,
    diskHashesUnchanged: hashes.length, aggregateSha256: hash(serial(hashes)),
    zeroRule: { candidateCells: zeroChanges.length, nonzeroChanges: nonzeroChangesByZeroRule,
      mode: modeForReplay(zeroBoardChanges.length), visibleScoreChanges: zeroBoardChanges.length, changes: zeroChanges },
    boardChanges, zeroBoardChanges, directChanges, directZeroChanges, requested, rule40,
    publishedFeedRows: visible.length, publicationDiscrepancies,
    limits: ['Smallcap uses supplied main-store fallback, not a separate Smallcap artifact.',
      'Quality baseline matches the published feed using the historical production watchlist; Smallcap historical input is unavailable.',
      'No historical evidence files are rewritten. Scores shown are capped as in the real export.'] };
}
if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) throw new Error('Supply read-only snapshot directory');
  const log = console.log, warn = console.warn; console.log = console.warn = () => {};
  let result;
  // Optional publication ref: origin/gh-pages moves daily; pin it to reproduce a dated replay. --live: live Growth calibration.
  const [ref] = process.argv.slice(3).filter(a => a !== '--live'), live = process.argv.includes('--live');
  try { result = replay(dir, { ...(ref ? { ref } : {}), live }); } finally { console.log = log; console.warn = warn; }
  process.stdout.write(serial(result) + '\n');
}
module.exports = { replay, diffCells, compareVisible };
