#!/usr/bin/env node
'use strict';
// Read-only fixed-day replay. Only --out is written; never run the production writer.
// Usage: node scripts/cycle-ramp-compare.js --data-root <snapshots-root>
//   --export-root <prepared-export-root> --r12-root <review-inputs> --out <scratch-dir>
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const BASE = '5d388afcbf0a658aacb6d6d9d1225ecb70be1bbc';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const displayed = raw => Math.min(100, Math.round(raw * 10) / 10);
const inTop100 = rank => Number.isInteger(rank) && rank >= 1 && rank <= 100;

function comparisonMarkdown(summary) {
  const lines = ['| Familie / Board | Zeilen | Faktor anders | Score höher | Score niedriger | Rang anders | Top-100 hinein | Top-100 heraus |',
    '|---|---:|---:|---:|---:|---:|---|---|'];
  const grouped = new Map();
  for (const row of summary.boards) {
    const key = row.family + ' / ' + row.board;
    const total = grouped.get(key) || { rows: 0, factorChanged: 0, scoreUp: 0, scoreDown: 0, ranksChanged: 0, entries: [], exits: [] };
    for (const field of ['rows', 'factorChanged', 'scoreUp', 'scoreDown', 'ranksChanged']) total[field] += row[field];
    for (const field of ['entries', 'exits']) total[field].push(...row[field].map(t => `${t} (${row.track})`));
    grouped.set(key, total);
  }
  for (const [key, r] of grouped) lines.push(`| ${key} | ${r.rows} | ${r.factorChanged} | ${r.scoreUp} | ${r.scoreDown} | ${r.ranksChanged} | ${r.entries.join(', ') || '0'} | ${r.exits.join(', ') || '0'} |`);
  lines.push('', 'Gezählt werden Tickerzeilen. Ränge und Top 100 gelten je Board und Track; die Tabelle summiert beide Tracks. Ranglose Zeilen behalten ihren Status. Rangänderungen außerhalb des Bandes entstehen durch die Umsortierung, ihr Score bleibt unverändert.',
    '', '| Familie | Bewertete Zeilen | Faktor anders | Sichtbarer Score anders | Höher | Niedriger |', '|---|---:|---:|---:|---:|---:|');
  for (const r of summary.families) lines.push(`| ${r.family} | ${r.scored} | ${r.factorChanged} | ${r.scoreChanged} | ${r.up} | ${r.down} |`);
  lines.push('', `Unterschiedliche Warnmeldungen: ${summary.checks.warningCount}. Wiederholungen derselben Meldung sind zusammengefasst.`, ...(summary.warnings || []).map(w => '- ' + w));
  return lines.join('\n') + '\n';
}

// This stored-calibration cross-check sorts all numeric arrays (including bounds),
// preserves null counts and normalizes -0 to 0. It does not validate tuple order.
// The two live replay arms still require exact equality, including array order.
function calibrationMultisets(value) {
  if (Array.isArray(value)) return value.map(calibrationMultisets).sort((a, b) =>
    a === null ? (b === null ? 0 : -1) : b === null ? 1 : a - b);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, calibrationMultisets(v)]));
  return value === 0 ? 0 : value;
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    assert.ok(['--data-root', '--export-root', '--r12-root', '--out'].includes(argv[i]) && argv[i + 1], 'Invalid arguments');
    args[argv[i]] = path.resolve(argv[i + 1]);
  }
  for (const key of ['--data-root', '--export-root', '--r12-root', '--out']) assert.ok(args[key], key + ' required');
  const data = args['--data-root'], exportsRoot = args['--export-root'], r12 = args['--r12-root'], out = args['--out'];
  for (const input of [ROOT, data, exportsRoot, r12]) {
    const relative = path.relative(input, out);
    assert.ok(relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Output must be outside every input tree');
  }
  assert.ok(require('node:os').freemem() > 4 * 2 ** 30, 'Need over 4 GiB free before replay to preserve 3 GiB headroom');
  const manifest = new Map();
  const record = file => {
    const bytes = fs.readFileSync(file);
    manifest.set(file, { bytes: bytes.length, sha256: sha(bytes) });
    return bytes;
  };
  const read = file => JSON.parse(record(file).toString('utf8').replace(/^\uFEFF/, ''));
  const git = (...a) => execFileSync('git', ['-c', 'safe.directory=*', ...a], { cwd: ROOT, encoding: 'utf8' });
  const oldCode = git('show', BASE + ':src/scoring/score.js');
  const sourcePath = path.join(ROOT, 'src/scoring/score.js');
  const baseline = new Module(sourcePath, module);
  baseline.filename = sourcePath;
  baseline.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  baseline._compile(oldCode, sourcePath); // exact base source, same unchanged dependencies
  const old = baseline.exports;
  const S = require('../src/scoring/score.js');
  const RS = require('../src/scoring/run-screener.js');
  const W = require('./write-findash-export.js');
  const exchange = require('../lib/exchange-quarter-check.js');
  const log = console.log;
  const warnings = new Set();
  const oldWarn = console.warn, oldError = console.error;
  console.log = () => {};
  console.warn = console.error = (...a) => warnings.add(a.join(' '));
  try {
    const context = exchange.defaultContext();
    context.stores = exchange.loadStores(path.join(data, 'external-data/exchange-quarters'));
    context.baseline = exchange.loadBaseline(path.join(data, 'board-history'));
    context.warnings = [...context.stores.warnings, ...context.baseline.warnings];
    assert.deepEqual(context.warnings, []);
    const snapshots = [];
    for (const name of fs.readdirSync(path.join(data, 'snapshots')).sort()) {
      if (!name.endsWith('.json') || name.startsWith('_manifest') || name === '_last_good_disk.json') continue;
      const file = path.join(data, 'snapshots', name);
      record(file);
      const s = RS.readScoringSnapshot(file);
      if (s?.meta?.ticker) snapshots.push(s);
    }
    const { filtered: universe } = RS.filterToAuthorizedUniverse(snapshots, read(path.join(data, 'watchlist.json')).stocks);
    const secFiles = ['sec-secannual.json', 'sec-secannual-smallcap.json', 'kr-secannual.json', 'jp-secannual.json', 'tw-secannual.json']
      .map(f => path.join(data, 'external-data', f));
    secFiles.forEach(record);
    for (const file of ['cn.json', 'tw.json']) record(path.join(data, 'external-data/exchange-quarters', file));
    RS.mergeSecIntoUniverse(universe, secFiles);
    const byTicker = new Map(universe.map(s => [S.tickerOf(s), s]));
    const cached = read(path.join(r12, 'scored-cycle-inputs.json'));
    const measurement = read(path.join(r12, 'measurement.json'));
    const families = [
      { id: 'HyperGrowth', formulas: require('../src/scoring/formulas'), options: {}, calibration: 'calibration.json', exported: 'full' },
      { id: 'Quality', formulas: require('../src/scoring/formulas/quality'), options: { classify: require('../src/scoring/quality-route').qualityRoute, growthBoost: false }, calibration: 'quality/calibration.json', exported: 'quality' },
      { id: 'Smallcap', formulas: require('../src/scoring/formulas/smallcap'), options: { classify: require('../src/scoring/smallcap-route').smallcapRoute, growthBoost: false }, calibration: 'smallcap/calibration.json', exported: 'smallcap' },
    ];
    const summary = { base: BASE, head: git('rev-parse', 'HEAD').trim(), dataDay: measurement.dataDay,
      sourceSha256: sha(record(sourcePath)), oldSourceSha256: sha(oldCode), snapshots: snapshots.length,
      authorized: universe.length, families: [], boards: [], changes: [], rankChanges: [], checks: {} };
    for (const family of families) {
      log('Replay ' + family.id);
      assert.ok(require('node:os').freemem() > 3 * 2 ** 30, 'RAM headroom below 3 GiB');
      // Learn on identical inputs in both arms; compare the WHOLE calibration, not just t.
      const before = old.scoreUniverse(universe, family.formulas, family.options);
      const after = S.scoreUniverse(universe, family.formulas, family.options);
      assert.deepEqual(after.calibration, before.calibration, family.id + ' calibration changed');
      const reference = read(path.join(exportsRoot, 'outputs', family.calibration));
      const { generated_at, ...expectedCalibration } = reference;
      assert.ok(isDeepStrictEqual(calibrationMultisets(before.calibration), calibrationMultisets(expectedCalibration)),
        family.id + ' differs from fixed-day calibration distributions');
      const t = before.calibration.cycleDDThreshold;
      const oldMap = new Map(before.map(e => [e.ticker, e]));
      const newMap = new Map(after.map(e => [e.ticker, e]));
      assert.equal(oldMap.size, newMap.size);
      let scored = 0, factors = 0, changed = 0, up = 0, down = 0;
      for (const e of after) {
        const b = oldMap.get(e.ticker);
        const { score: bScore, _factorCycle: bCycle, ...bOther } = b;
        const { score: aScore, _factorCycle: aCycle, scoreCycleLegacy, _factorCycleLegacy, ...aOther } = e;
        assert.deepEqual(aOther, bOther, family.id + ':' + e.ticker + ' changed another axis/metadata');
        if (!Number.isFinite(bScore)) { assert.equal(aScore, bScore); continue; }
        scored++;
        assert.equal(scoreCycleLegacy, bScore, 'legacy score must be bit identical');
        assert.equal(_factorCycleLegacy, bCycle, 'legacy factor must be bit identical');
        const pair = S.cycleSeriesPair(byTicker.get(e.ticker)), dd = S.revMaxDrawdown(pair.rev);
        const eligible = pair.op.length >= 3 && S.oscExcess(pair.op) >= 1 && !pair.rev.some(v => v <= 0);
        const inBand = eligible && t > 0 && dd > 0.8 * t && dd < 1.2 * t;
        if (!inBand) {
          assert.ok(Object.is(aCycle, bCycle), e.ticker + ' factor changed outside band');
          assert.ok(Object.is(aScore, bScore), e.ticker + ' score changed outside band');
        }
        if (!Object.is(aCycle, bCycle)) {
          factors++;
          const delta = displayed(aScore) - displayed(bScore);
          changed += delta !== 0; up += delta > 0; down += delta < 0;
          summary.changes.push({ family: family.id, board: e.formulaId, track: e.track, ticker: e.ticker,
            threshold: t, drawdown: dd, factorBefore: bCycle, factorAfter: aCycle,
            rawScoreBefore: bScore, rawScoreAfter: aScore, scoreBefore: displayed(bScore), scoreAfter: displayed(aScore) });
        }
      }
      if (family.id === 'HyperGrowth') {
        assert.equal(scored, cached.length);
        for (const row of cached) {
          const e = oldMap.get(row.ticker);
          assert.equal(e.score, row.rawScore, row.ticker + ' R12 raw-score mismatch');
          assert.equal(e._factorCycle, row.factor, row.ticker + ' R12 factor mismatch');
        }
        assert.equal(t, measurement.threshold);
        summary.checks.r12ExactRawScoresAndFactors = cached.length;
      }
      // Full raw-score ordering from the real production function, then the unchanged rank gate.
      const rankedBefore = old.produceRankings(before, { topN: 100 });
      const rankedAfter = S.produceRankings(after, { topN: 100 });
      for (const board of Object.keys(rankedBefore.full).sort()) {
        const exportedFile = path.join(exportsRoot, 'outputs/findash-export/v1', family.exported, board.replace(/^quality-/, '') + '.json');
        const published = read(exportedFile);
        for (const track of ['profitable', 'unprofitable']) {
          const bRows = rankedBefore.full[board][track] || [], aRows = rankedAfter.full[board][track] || [];
          W.vergebeRaenge(bRows, board, { warn: false });
          W.vergebeRaenge(aRows, board, { warn: false });
          const bBy = new Map(bRows.map(r => [r.ticker, r]));
          const aBy = new Map(aRows.map(r => [r.ticker, r]));
          for (const row of published[track] || []) {
            const replay = bBy.get(row.ticker);
            assert.ok(replay, row.ticker + ' absent in baseline replay');
            assert.equal(displayed(replay.score), row.score, row.ticker + ' published score mismatch');
            assert.equal(replay.rank, row.rank, row.ticker + ' published rank mismatch');
          }
          if (family.id === 'HyperGrowth') assert.equal(bRows.length, (published[track] || []).length);
          let ranksChanged = 0;
          for (const row of aRows) {
            const prior = bBy.get(row.ticker);
            assert.equal(row.rank === null, prior.rank === null, 'rank eligibility changed');
            if (row.rank !== prior.rank) {
              ranksChanged++;
              summary.rankChanges.push({ family: family.id, board, track, ticker: row.ticker, before: prior.rank, after: row.rank });
            }
          }
          const changes = summary.changes.filter(r => r.family === family.id && r.board === board && r.track === track);
          for (const r of changes) { r.rankBefore = bBy.get(r.ticker).rank; r.rankAfter = aBy.get(r.ticker).rank; }
          summary.boards.push({ family: family.id, board, track, rows: bRows.length, factorChanged: changes.length,
            scoreUp: changes.filter(r => r.scoreAfter > r.scoreBefore).length,
            scoreDown: changes.filter(r => r.scoreAfter < r.scoreBefore).length, ranksChanged,
            entries: aRows.filter(r => inTop100(r.rank) && !inTop100(bBy.get(r.ticker).rank)).map(r => r.ticker),
            exits: bRows.filter(r => inTop100(r.rank) && !inTop100(aBy.get(r.ticker).rank)).map(r => r.ticker) });
        }
      }
      summary.families.push({ family: family.id, scored, threshold: t, factorChanged: factors, scoreChanged: changed, up, down });
    }
    // All files explicitly read by this replay stay unchanged, including every snapshot.
    for (const [file, info] of manifest) assert.equal(sha(fs.readFileSync(file)), info.sha256, file + ' mutated');
    summary.checks.inputFilesUnchanged = manifest.size;
    summary.checks.calibrationsIdentical = true;
    summary.checks.otherAxesAndFactorsIdentical = true;
    summary.checks.outsideBandScoresBitIdentical = true;
    summary.checks.legacyScoresBitIdentical = true;
    summary.sihuan = summary.changes.find(r => r.family === 'HyperGrowth' && r.ticker === '0460.HK');
    summary.warnings = [...warnings];
    summary.checks.warningCount = warnings.size;
    for (const warning of warnings) oldWarn(warning);
    summary.limitations = ['Keine Renditepruefung, keine optimal bewiesene Rampenbreite, keine historische PIT-Reihe.',
      'Smallcap verwendet denselben vorbereiteten Fallback-Bestand wie R12; dort keine gerouteten Firmen. Kein separater Smallcap-Store geprueft.',
      'Quality-Raenge ueber die vollstaendige Replay-Kohorte; gegen die vorhandenen publizierten Toplisten abgeglichen.',
      'Kein Netzwerk, kein CI-Lauf auf Linux, kein Frontend-Sichttest, keine blinde Claude-Freigabe.'];
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'comparison.json'), JSON.stringify(summary, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'comparison.md'), comparisonMarkdown(summary));
    fs.writeFileSync(path.join(out, 'input-hashes.json'), JSON.stringify([...manifest].map(([file, info]) => ({ file, ...info })), null, 2) + '\n');
    log(JSON.stringify({ families: summary.families, sihuan: summary.sihuan, checks: summary.checks }, null, 2));
    return summary;
  } finally { console.log = log; console.warn = oldWarn; console.error = oldError; }
}
if (require.main === module) main(process.argv.slice(2));
module.exports = { main, comparisonMarkdown };
