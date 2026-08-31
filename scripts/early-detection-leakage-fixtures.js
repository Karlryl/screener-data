'use strict';

/** Deterministic 100-case availability/leakage fixture battery. */

const fs = require('node:fs');
const path = require('node:path');
const { writeFileAtomic } = require('../lib/atomic-write.js');
const { assertAvailabilityContract, assertKnownAt, canonicalSha256, knownAt } = require('../lib/early-detection.js');

const SCHEMA = 'early-detection-leakage-fixture-report/v1';
const CATEGORIES = [
  ['late_amendment', 'sec_filing', 'accepted_at'],
  ['after_close_filing', 'sec_filing', 'accepted_at'],
  ['late_issuer_release', 'issuer_release', 'source_published_at'],
  ['ticker_change', 'issuer_release', 'source_published_at'],
  ['future_split', 'issuer_release', 'source_published_at'],
  ['merger', 'sec_filing', 'accepted_at'],
  ['spin_off', 'sec_filing', 'accepted_at'],
  ['bankruptcy', 'sec_filing', 'accepted_at'],
  ['delisting', 'public_web', 'source_published_at'],
  ['future_market_bar', 'market_bar', 'bar_available_at'],
];

function iso(ms) { return new Date(ms).toISOString(); }

function fixture(category, sourceClass, primaryField, index) {
  const base = Date.UTC(2020 + (index % 5), index % 12, 2 + (index % 20), 20, 0, 0);
  const observed = base + (index % 3) * 60_000;
  const primary = base + (30 + index) * 60_000;
  const record = { sourceClass, observed_at: iso(observed), [primaryField]: iso(primary) };
  const expectedKnownAt = iso(Math.max(observed, primary));
  return {
    fixtureId: `${category}-${String(index + 1).padStart(2, '0')}`,
    category,
    record,
    expectedKnownAt,
    evaluationBefore: iso(Date.parse(expectedKnownAt) - 1),
    evaluationAtBoundary: expectedKnownAt,
  };
}

function buildFixtures() {
  return CATEGORIES.flatMap(([category, sourceClass, primaryField]) =>
    Array.from({ length: 10 }, (_, index) => fixture(category, sourceClass, primaryField, index)));
}

function runBattery() {
  const fixtures = buildFixtures();
  const categories = {};
  let leakageRejected = 0;
  let boundaryAccepted = 0;
  let missingTimestampRejected = 0;
  let futureMutationMovedKnownAt = 0;
  for (const item of fixtures) {
    assertAvailabilityContract(item.record);
    if (knownAt(item.record) !== item.expectedKnownAt) throw new Error(`known_at mismatch: ${item.fixtureId}`);
    try {
      assertKnownAt(item.record, item.evaluationBefore);
      throw new Error(`look-ahead accepted: ${item.fixtureId}`);
    } catch (error) {
      if (!/look-ahead/.test(String(error && error.message))) throw error;
      leakageRejected += 1;
    }
    if (assertKnownAt(item.record, item.evaluationAtBoundary) === item.expectedKnownAt) boundaryAccepted += 1;
    const missing = { ...item.record };
    const requiredField = Object.keys(missing).find((key) => key !== 'sourceClass' && key !== 'observed_at');
    delete missing[requiredField];
    try {
      assertAvailabilityContract(missing);
      throw new Error(`missing timestamp accepted: ${item.fixtureId}`);
    } catch (error) {
      if (!/required availability timestamp missing/.test(String(error && error.message))) throw error;
      missingTimestampRejected += 1;
    }
    const future = { ...item.record, [requiredField]: iso(Date.parse(item.expectedKnownAt) + 86_400_000) };
    if (Date.parse(knownAt(future)) > Date.parse(item.expectedKnownAt)) futureMutationMovedKnownAt += 1;
    categories[item.category] = (categories[item.category] || 0) + 1;
  }
  const report = {
    schema: SCHEMA,
    status: 'CONTRACT_LAYER_PASS_END_TO_END_SOURCE_INGEST_PENDING',
    fixtures: fixtures.length,
    categories,
    assertions: {
      lookAheadRejected: leakageRejected,
      exactBoundaryAccepted: boundaryAccepted,
      missingRequiredTimestampRejected: missingTimestampRejected,
      futureMutationMovedKnownAt: futureMutationMovedKnownAt,
    },
    coverage: [
      'late amendment', 'after-close filing', 'late issuer release', 'ticker change',
      'future split', 'merger', 'spin-off', 'bankruptcy', 'delisting', 'future market bar',
    ],
    decision: 'The shared availability contract passes 100 deterministic negative fixtures. The readiness gate stays red until these source classes pass through their real parsers and the complete GQS/FEM input path.',
  };
  report.reportSha256 = canonicalSha256(report);
  return report;
}

function parseArgs(argv) {
  if (argv.includes('--self-test')) return { selfTest: true };
  const index = argv.indexOf('--output');
  if (index < 0 || !argv[index + 1]) throw new Error('missing --output');
  return { output: argv[index + 1] };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = runBattery();
  if (!args.selfTest) {
    const output = path.resolve(args.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    // T204: atomar - Leckage-Fixtures sind Vertragsgrundlage, kein Zwischenstand.
    writeFileAtomic(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }
  process.stdout.write(JSON.stringify({
    status: report.status,
    fixtures: report.fixtures,
    assertions: report.assertions,
    reportSha256: report.reportSha256,
  }, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = { buildFixtures, runBattery };
