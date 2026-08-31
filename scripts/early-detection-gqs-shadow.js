'use strict';

/**
 * Score a SEC-only point-in-time bundle through the unchanged GQS engine.
 *
 * This is deliberately labelled a shadow replay. Historical Yahoo routing,
 * prices, market caps and revisions are unavailable. A constant research-only
 * market-cap sentinel satisfies the production data-quality envelope while
 * making the cross-section size-neutral; it is never persisted into the input.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scoreUniverse, produceRankings } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');

const SCHEMA = 'early-detection-sec-gqs-shadow/v1';
const TOP_N = 100;
const NEUTRAL_MARKET_CAP = 1;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function canonicalSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

// T204 measurement seam: the synthetic fixture reaches the exact output-byte
// contract without invoking scoring or the producer-owned Python verifier.
function writeShadowReport(target, report) {
  fs.writeFileSync(target, JSON.stringify(report) + '\n', 'utf8');
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function filesRecursively(root) {
  const rows = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) rows.push(...filesRecursively(absolute));
    else if (entry.isFile()) rows.push(absolute);
  }
  return rows;
}

function scoringManifest() {
  const root = path.resolve(__dirname, '..', 'src', 'scoring');
  const files = filesRecursively(root).sort().map((file) => ({
    path: path.relative(path.resolve(__dirname, '..'), file).split(path.sep).join('/'),
    sha256: sha256File(file),
    bytes: fs.statSync(file).size,
  }));
  return { files, sha256: canonicalSha256(files) };
}

function verifyBundleShape(bundle) {
  if (!bundle || bundle.schema !== 'early-detection-sec-gqs-input-bundle/v1') {
    throw new Error('input is not a SEC GQS input bundle v1');
  }
  if (bundle.protocol !== 'GQS-00@1.0.0' || !Array.isArray(bundle.snapshots)) {
    throw new Error('input protocol or snapshot collection is invalid');
  }
}

function verifyBundleWithProducer(input) {
  const verifier = path.resolve(__dirname, 'early-detection-gqs-inputs.py');
  const attempts = process.platform === 'win32'
    ? [['python', [verifier, 'verify', '--input', input]], ['py', ['-3', verifier, 'verify', '--input', input]]]
    : [['python3', [verifier, 'verify', '--input', input]], ['python', [verifier, 'verify', '--input', input]]];
  const failures = [];
  for (const [command, args] of attempts) {
    const run = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
    if (run.status === 0) return JSON.parse(run.stdout);
    failures.push(`${command}: ${run.error && run.error.message || run.stderr || run.stdout || `exit ${run.status}`}`);
  }
  throw new Error(`producer-owned bundle verification failed: ${failures.join(' | ')}`);
}

function researchClassify(snapshot) {
  const meta = snapshot && snapshot.meta || {};
  if (meta.sicRoutingStatus === 'ROUTE' && typeof meta.sicFormulaId === 'string') {
    return { action: 'route', formulaId: meta.sicFormulaId };
  }
  return { action: 'exclude', reason: `sic-${String(meta.sicRoutingStatus || 'missing').toLowerCase()}` };
}

function neutralizedSnapshots(snapshots) {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    marketCap: { value: NEUTRAL_MARKET_CAP },
    researchNeutralization: {
      marketCap: 'constant_positive_sentinel_for_grade_envelope_and_size_neutrality',
      value: NEUTRAL_MARKET_CAP,
      persistedToInput: false,
    },
  }));
}

function rankMap(rankings) {
  const map = new Map();
  for (const [formulaId, tracks] of Object.entries(rankings.branches || {})) {
    for (const [track, rows] of Object.entries(tracks || {})) {
      if (!Array.isArray(rows)) continue;
      rows.forEach((row, index) => map.set(row.ticker, { formulaId, track, rank: index + 1 }));
    }
  }
  return map;
}

function scoreBundle(bundle, verification) {
  verifyBundleShape(bundle);
  if (!verification || verification.status !== 'PASS' || verification.bundleSha256 !== bundle.bundleSha256) {
    throw new Error('producer-owned bundle verification is missing or does not match the parsed input');
  }
  const scoring = scoringManifest();
  const snapshots = neutralizedSnapshots(bundle.snapshots);
  const results = scoreUniverse(snapshots, formulas, { classify: researchClassify });
  const rankings = produceRankings(results, { topN: TOP_N });
  const publishedRanks = rankMap(rankings);
  const counts = {};
  const rows = results.map((row) => {
    const key = [row.action, row.reason || '', row.formulaId || '', row.track || ''].join('|');
    counts[key] = (counts[key] || 0) + 1;
    const rank = publishedRanks.get(row.ticker) || null;
    return {
      entityId: row.ticker,
      name: row.name || row.snapshot && row.snapshot.meta && row.snapshot.meta.name || null,
      action: row.action,
      reason: row.reason || null,
      formulaId: row.formulaId || null,
      track: row.track || null,
      score: Number.isFinite(row.score) ? row.score : null,
      qualified: rank !== null,
      publishedBoardRank: rank && rank.rank || null,
      coverageAxes: row.coverageAxes || null,
      coverageWeight: Number.isFinite(row.coverageWeight) ? row.coverageWeight : null,
      cohortN: Number.isFinite(row.cohortN) ? row.cohortN : null,
      cohortFallback: typeof row.cohortFallback === 'boolean' ? row.cohortFallback : null,
      lamps: Array.isArray(row.lamps) ? row.lamps : [],
    };
  });
  const report = {
    schema: SCHEMA,
    evaluationAt: bundle.evaluationAt,
    protocol: bundle.protocol,
    mode: 'SEC_ONLY_SHADOW_NOT_PRODUCTION_RECONSTRUCTION',
    qualificationRule: {
      id: 'published_board_top100_by_formula_and_track/v1',
      topN: TOP_N,
      qualifiedWhen: 'entity appears in the top-100 published branch/track list produced by the unchanged GQS engine',
      frozenBeforeOutcomeAccess: false,
      confirmatoryEligible: false,
    },
    neutralization: {
      marketCapValue: NEUTRAL_MARKET_CAP,
      purpose: 'satisfy the production grade envelope without creating cross-sectional size information',
      scoreInterpretation: 'fundamental shadow ranking only',
    },
    input: {
      bundleSha256: verification.bundleSha256,
      fileSha256: verification.fileSha256,
      bytes: verification.bytes,
      verificationContract: 'python_json_sort_keys_separators_utf8/v1',
      verifier: 'scripts/early-detection-gqs-inputs.py verify',
      snapshots: bundle.snapshots.length,
      payloadManifestSha256: bundle.source && bundle.source.payloadManifestSha256,
      conceptMap: bundle.conceptMap || null,
    },
    engine: {
      scoringTreeSha256: scoring.sha256,
      files: scoring.files,
      productiveFilesModifiedByThisRun: false,
    },
    summary: {
      results: rows.length,
      scored: rows.filter((row) => row.action === 'route' && row.score !== null).length,
      qualified: rows.filter((row) => row.qualified).length,
      resultCounts: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1])),
    },
    results: rows,
    limitations: [
      'This is not a historical production-board reconstruction.',
      'SIC replaces Yahoo routing only for unambiguous cases; ambiguous routes fail closed.',
      'The constant market-cap sentinel neutralizes size and cannot reproduce price- or market-cap-dependent metadata.',
      'Historical analyst revisions are absent and drop under the production renormalization rule.',
      'Qualification is exploratory until its rule, universe and complete monthly calendar are sealed before outcome access.',
    ],
  };
  report.reportSha256 = canonicalSha256(report);
  return report;
}

function selfTest() {
  const value = { z: 1, a: [{ y: 2, x: 1 }] };
  const reordered = { a: [{ x: 1, y: 2 }], z: 1 };
  if (canonicalSha256(value) !== canonicalSha256(reordered)) throw new Error('canonical hash is order-sensitive');
  const ranks = rankMap({ branches: { energy: { profitable: [{ ticker: 'A' }, { ticker: 'B' }] } } });
  if (ranks.get('B').rank !== 2 || researchClassify({ meta: { sicRoutingStatus: 'AMBIGUOUS_ROUTE' } }).action !== 'exclude') {
    throw new Error('rank/fail-closed self-test failed');
  }
  return { status: 'PASS', canonicalSha256: canonicalSha256(value), scoringTreeSha256: scoringManifest().sha256 };
}

function parseArgs(argv) {
  if (argv.includes('--self-test')) return { selfTest: true };
  const value = (flag) => {
    const index = argv.indexOf(flag);
    if (index < 0 || !argv[index + 1]) throw new Error(`missing ${flag}`);
    return argv[index + 1];
  };
  return { input: value('--input'), output: value('--output') };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    process.stdout.write(JSON.stringify(selfTest(), null, 2) + '\n');
    return;
  }
  const bundle = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
  const verification = verifyBundleWithProducer(path.resolve(args.input));
  const report = scoreBundle(bundle, verification);
  const output = path.resolve(args.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  writeShadowReport(output, report);
  process.stdout.write(JSON.stringify({
    evaluationAt: report.evaluationAt,
    summary: report.summary,
    reportSha256: report.reportSha256,
    output,
  }, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = { canonicalSha256, researchClassify, rankMap, scoreBundle, verifyBundleWithProducer, writeShadowReport };
