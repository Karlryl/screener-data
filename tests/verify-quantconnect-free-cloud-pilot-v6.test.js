#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const VERIFIER = path.join(ROOT, 'scripts', 'verify-quantconnect-free-cloud-pilot-v6.py');
const CASES_PATH = path.join(ROOT, 'research', 'early-detection-v4', 'quantconnect-free-cloud-pilot-cases-v1.json');
const CONTRACT_PATH = path.join(ROOT, 'research', 'early-detection-v4', 'quantconnect-free-cloud-pilot-contract-v6.json');
const PREFIX = 'QC_METADATA_V6=';
const MAX_LOG_BYTES = 7000;
const DIGEST_BYTES = 24;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function b64(raw) {
  return Buffer.from(raw).toString('base64url');
}

function run(flags = [], args = []) {
  return spawnSync(process.env.PYTHON || 'python', [...flags, '-B', VERIFIER, ...args], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
  });
}

const casesDocument = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));

function sequenceDigest(records) {
  const hasher = crypto.createHash('sha256');
  for (const record of records) {
    const encoded = Buffer.from(canonical(record));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(encoded.length);
    hasher.update(length);
    hasher.update(encoded);
  }
  return hasher.digest().subarray(0, DIGEST_BYTES);
}

assert.notDeepEqual(
  sequenceDigest([['2010-01-01', 'A'], ['2010-01-02', 'B']]),
  sequenceDigest([['2010-01-02', 'B'], ['2010-01-01', 'A']]),
  'event sequence digest must be order-sensitive',
);

function payloadWithHashes(nonzeroBudget = 128) {
  let assigned = 0;
  const chunks = [];
  const caseRows = casesDocument.cases.map((item, caseIndex) => {
    const tickers = [item.querySymbol, ...item.alternateSymbols];
    const aliases = tickers.map((ticker, aliasIndex) => {
      const counts = [0, 0, 0, 0];
      for (let eventIndex = 0; eventIndex < 4 && assigned < nonzeroBudget; eventIndex += 1) {
        counts[eventIndex] = 1;
        chunks.push(sequenceDigest([[item.referenceStart, caseIndex, aliasIndex, eventIndex]]));
        assigned += 1;
      }
      return [true, `${ticker} R735QTJ8XC9X`, 2, item.referenceStart, item.referenceEnd, counts, []];
    });
    return [item.caseId, aliases];
  });
  return { payload: { caseRows }, chunks };
}

function repack(report, payload, chunks) {
  const payloadRaw = Buffer.from(canonical(payload));
  report.payloadRawSha256 = sha(payloadRaw);
  report.payload = b64(zlib.deflateSync(payloadRaw, { level: 9 }));
  report.eventSequenceHashCount = chunks.length;
  report.eventSequenceHashes = b64(Buffer.concat(chunks));
  return report;
}

function finish(report) {
  const copy = structuredClone(report);
  delete copy.reportSha256;
  report.reportSha256 = sha(Buffer.from(canonical(copy)));
  return report;
}

function output(runId, executedAt = '2026-08-12T17:00:00Z', nonzeroBudget = 128) {
  const { payload, chunks } = payloadWithHashes(nonzeroBudget);
  const report = {
    schema: 'early-detection-quantconnect-free-cloud-metadata-output/v6',
    pilotCoreSha256: contract.pilotCoreSha256,
    casesRawSha256: contract.boundFiles.casesRawSha256,
    providerRunId: runId,
    executedAt,
    leanVersion: '2.5.0.0.17996',
    dataset: {
      label: 'QUANTCONNECT_US_EQUITY_SECURITY_MASTER_PLUS_US_EQUITIES',
      versionStatus: 'PROVIDER_DATASET_UNVERSIONED',
      retrievedOn: executedAt.slice(0, 10),
    },
    payloadEncoding: 'ZLIB9_BASE64URL_CANONICAL_JSON',
    payloadRawSha256: '',
    payload: '',
    eventSequenceHashEncoding: 'SHA256_TRUNC192_RAW_CONCAT_BASE64URL_ORDERED_V1',
    eventSequenceHashCount: 0,
    eventSequenceHashes: '',
    claimLocks: {
      identityResolved: false,
      terminalWealthComplete: false,
      originalV4GateCredit: false,
      outcomesAccessed: false,
      priceValuesExported: false,
      returnsComputed: false,
      ordersSubmitted: false,
    },
  };
  return finish(repack(report, payload, chunks));
}

function unpack(report) {
  return JSON.parse(zlib.inflateSync(Buffer.from(report.payload, 'base64url')).toString('utf8'));
}

function write(file, report, doFinish = true) {
  if (doFinish) finish(report);
  fs.writeFileSync(file, `${canonical(report)}\n`);
}

for (const flags of [[], ['-O']]) {
  const call = run(flags);
  assert.equal(call.status, 0, call.stderr || call.stdout);
  const result = JSON.parse(call.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.staticContractVerified, true);
  assert.equal(result.executionBlocked, true);
  assert.equal(result.providerRunEnvelopesRequired, true);
  assert.equal(result.outcomesAccessed, false);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-v6-'));
const aPath = path.join(temp, 'a.json');
const bPath = path.join(temp, 'b.json');

function validPair() {
  const left = output('PROVIDER-RUN-A', '2026-08-12T17:00:00Z');
  const right = output('PROVIDER-RUN-B', '2026-08-12T17:01:00Z');
  // Equal provider identifiers across primary/alternate are evidence only, never identity resolution.
  for (const report of [left, right]) {
    const payload = unpack(report);
    payload.caseRows[8][1][1][1] = payload.caseRows[8][1][0][1];
    const chunks = [];
    const rawHashes = Buffer.from(report.eventSequenceHashes, 'base64url');
    for (let offset = 0; offset < rawHashes.length; offset += DIGEST_BYTES) {
      chunks.push(rawHashes.subarray(offset, offset + DIGEST_BYTES));
    }
    finish(repack(report, payload, chunks));
  }
  return [left, right];
}

let [left, right] = validPair();
const estimatedLogBytes = Buffer.byteLength(PREFIX + canonical(left));
assert.ok(estimatedLogBytes < MAX_LOG_BYTES, `conservative compact estimate ${estimatedLogBytes} must be below ceiling`);
write(aPath, left);
write(bPath, right);
for (const flags of [[], ['-O']]) {
  const call = run(flags, ['--run-a', aPath, '--run-b', bPath]);
  assert.equal(call.status, 0, call.stderr || call.stdout);
  const result = JSON.parse(call.stdout);
  assert.equal(result.localTwoFileParityVerified, true);
  assert.equal(result.runALogBytes, estimatedLogBytes);
  assert.equal(result.outcomesAccessed, false);
}

function rejected(mutator, mutatorRight = mutator, finishAfter = true) {
  const pair = validPair();
  mutator(pair[0]);
  mutatorRight(pair[1]);
  write(aPath, pair[0], finishAfter);
  write(bPath, pair[1], finishAfter);
  const call = run(['-O'], ['--run-a', aPath, '--run-b', bPath]);
  assert.notEqual(call.status, 0, call.stdout);
}

function mutatePayload(report, mutator) {
  const payload = unpack(report);
  mutator(payload);
  const hashes = Buffer.from(report.eventSequenceHashes, 'base64url');
  const chunks = [];
  for (let offset = 0; offset < hashes.length; offset += DIGEST_BYTES) {
    chunks.push(hashes.subarray(offset, offset + DIGEST_BYTES));
  }
  repack(report, payload, chunks);
}

rejected(report => mutatePayload(report, payload => { payload.pricePoint = 123; }));
rejected(report => mutatePayload(report, payload => { payload.caseRows.pop(); }));
rejected(report => mutatePayload(report, payload => { payload.caseRows.reverse(); }));
rejected(report => mutatePayload(report, payload => { payload.caseRows[8][1].pop(); }));
rejected(report => mutatePayload(report, payload => { payload.caseRows[0][1][0][2] = 1.5; }));
rejected(report => mutatePayload(report, payload => { payload.caseRows[0][1][0][3] = '2008-12-31'; }));
rejected(report => mutatePayload(report, payload => { payload.caseRows[0][1][0].push(['2010-01-01']); }));
rejected(report => mutatePayload(report, payload => { payload.caseRows[0][1][0][5][0] = -1; }));
rejected(report => { report.eventSequenceHashCount += 1; });
rejected(report => { report.leanVersion = '2.5.0.0.fake'; });
rejected(report => { report.dataset.versionStatus = 'OFFICIAL_VERSION_2026'; });
rejected(report => { report.dataset.retrievedOn = '2026-08-11'; });
rejected(report => { report.claimLocks.outcomesAccessed = true; });
rejected(report => mutatePayload(report, payload => { payload.caseRows[0][1][0][1] = null; }));
rejected(report => mutatePayload(report, payload => {
  payload.caseRows[0][1][0] = [false, null, 0, null, null, [0, 0, 0, 0], ['OutcomeLeak']];
}));
rejected(report => { report.payloadRawSha256 = '0'.repeat(64); });
rejected(report => { report.reportSha256 = '0'.repeat(64); }, report => { report.reportSha256 = '0'.repeat(64); }, false);
rejected(report => { report.providerRunId = 'SAME-RUN-ID'; }, report => { report.providerRunId = 'SAME-RUN-ID'; });
rejected(
  report => {
    const bytes = Buffer.from(report.eventSequenceHashes, 'base64url');
    const first = Buffer.from(bytes.subarray(0, DIGEST_BYTES));
    bytes.subarray(DIGEST_BYTES, DIGEST_BYTES * 2).copy(bytes, 0);
    first.copy(bytes, DIGEST_BYTES);
    report.eventSequenceHashes = b64(bytes);
  },
  () => {},
);

const oversizedLeft = output('PROVIDER-RUN-A', '2026-08-12T17:00:00Z', 324);
const oversizedRight = output('PROVIDER-RUN-B', '2026-08-12T17:01:00Z', 324);
assert.ok(Buffer.byteLength(PREFIX + canonical(oversizedLeft)) >= MAX_LOG_BYTES, 'oversize fixture must cross ceiling');
write(aPath, oversizedLeft);
write(bPath, oversizedRight);
assert.notEqual(run(['-O'], ['--run-a', aPath, '--run-b', bPath]).status, 0, 'oversize report must fail');

fs.rmSync(temp, { recursive: true, force: true });
console.log(`verify-quantconnect-free-cloud-pilot-v6.test.js: PASS estimatedLogBytes=${estimatedLogBytes}`);
