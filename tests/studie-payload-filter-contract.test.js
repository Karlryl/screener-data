'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const FILTER_REL = 'protocol/early-detection/2.0.0/payload-filter-2.0.0.json';
const PROVENANCE_REL = 'protocol/early-detection/2.0.0/provenance-closure.json';
const DATA_CONTRACT_REL = 'protocol/early-detection/2.0.0/data-contract.json';

const FILTER_PATH = path.join(ROOT, ...FILTER_REL.split('/'));
const PROVENANCE_PATH = path.join(ROOT, ...PROVENANCE_REL.split('/'));
const DATA_CONTRACT_PATH = path.join(ROOT, ...DATA_CONTRACT_REL.split('/'));

const EXPECTED_PROVENANCE_SHA256 = 'f316859edb10a478c44effb8d0a86dddf3b5142596ef4d504f2637749ef96761';
const EXPECTED_DATA_CONTRACT_SHA256 = '285572040a21e53a79abd1ec0d4f42183f37f07a6665c12cf7a0cd9f5eafd26d';
const EXPECTED_LIST_DIGEST = 'c99db8adecd69f1ddd01f237ae19ba3f1b0fe8b995c12ebfaf8a7cb9cf2380db';
const EXPECTED_PAYLOAD_SET_SHA256 = 'c861d25548a5e8b30e7b03ff17474c2618387f4c445e571056dcf7655401e889';
const EXPECTED_TOP_LEVEL_KEYS = [
  'allowedPayloadSha256',
  'datenbankAbgleich',
  'erzeugtAm',
  'filterSha256',
  'hinweis',
  'payloadCount',
  'protocol',
  'purpose',
  'quelle',
  'schema',
];

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function pythonJsonString(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (character) => (
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  ));
}

function pythonJsonDumpsSorted(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((entry) => pythonJsonDumpsSorted(entry)).join(', ')}]`;
  }
  if (typeof value === 'string') return pythonJsonString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    assert.ok(Number.isSafeInteger(value), 'filter self-hash only permits safe integer numbers');
    return String(value);
  }
  if (typeof value === 'object') {
    const fields = Object.keys(value).sort().map((key) => (
      `${pythonJsonString(key)}: ${pythonJsonDumpsSorted(value[key])}`
    ));
    return `{${fields.join(', ')}}`;
  }
  assert.fail(`unsupported JSON value type: ${typeof value}`);
}

function filterSelfDigest(filter) {
  const withoutSelfDigest = Object.fromEntries(
    Object.entries(filter).filter(([key]) => key !== 'filterSha256'),
  );
  return sha256Bytes(Buffer.from(pythonJsonDumpsSorted(withoutSelfDigest), 'utf8'));
}

function validateFilter(filter) {
  assert.equal(filter.schema, 'early-detection-payload-filter/v1');
  assert.equal(filter.protocol, 'FEM-SEC-US@2.0.0');
  assert.equal(filter.quelle, PROVENANCE_REL);
  assert.equal(
    filter.purpose,
    'R12b/R13: positive Erlaubnisliste. Ein Neubau ohne diesen Filter erzeugt eine Obermenge.',
  );

  const actualKeys = Object.keys(filter).filter((key) => key !== 'status').sort();
  assert.deepEqual(actualKeys, EXPECTED_TOP_LEVEL_KEYS);
  if (Object.hasOwn(filter, 'status')) assert.equal(filter.status, 'PASS');

  assert.equal(filter.payloadCount, 127);
  assert.equal(filter.allowedPayloadSha256.length, 127);
  assert.equal(new Set(filter.allowedPayloadSha256).size, 127);
  assert.ok(filter.allowedPayloadSha256.every((value) => /^[0-9a-f]{64}$/.test(value)));
  assert.deepEqual(
    filter.allowedPayloadSha256,
    [...filter.allowedPayloadSha256].sort(),
    'positive list must remain lexically sorted',
  );
  assert.equal(
    sha256Bytes(Buffer.from(filter.allowedPayloadSha256.join('\n'), 'utf8')),
    EXPECTED_LIST_DIGEST,
    'concrete positive-list digest must remain frozen',
  );
  assert.equal(filter.filterSha256, filterSelfDigest(filter));
  assert.deepEqual(filter.datenbankAbgleich, {
    inDatenbank: 127,
    imFilterAberNichtInDB: [],
    inDBAberNichtImFilter: [],
    status: 'PASS',
  });
}

test('payload filter: the concrete positive list and self-digest remain valid', () => {
  validateFilter(loadJson(FILTER_PATH));
});

test('payload filter: provenance closure and data contract bind the same 127 payloads', () => {
  assert.equal(sha256File(PROVENANCE_PATH), EXPECTED_PROVENANCE_SHA256);
  assert.equal(sha256File(DATA_CONTRACT_PATH), EXPECTED_DATA_CONTRACT_SHA256);

  const filter = loadJson(FILTER_PATH);
  const provenance = loadJson(PROVENANCE_PATH);
  const dataContract = loadJson(DATA_CONTRACT_PATH);
  const provenancePayloads = provenance.payloads
    .map((payload) => payload.payloadSha256)
    .sort();

  assert.equal(provenance.schema, 'early-detection-provenance-closure/v1');
  assert.equal(provenance.protocol, 'FEM-SEC-US@2.0.0');
  assert.equal(provenance.payloadCount, 127);
  assert.equal(new Set(provenancePayloads).size, 127);
  assert.deepEqual(provenancePayloads, filter.allowedPayloadSha256);
  assert.equal(provenance.payloadSetSha256, EXPECTED_PAYLOAD_SET_SHA256);

  assert.equal(dataContract.schema, 'early-detection-data-contract/v1');
  assert.equal(dataContract.protocol, 'FEM-SEC-US@2.0.0');
  assert.equal(dataContract.payloadCount, 127);
  assert.equal(dataContract.rowCounts.source_payloads, 127);
  assert.equal(dataContract.payloadSetSha256, EXPECTED_PAYLOAD_SET_SHA256);
});

test('payload filter: a shape-stable list mutation fails even with a renewed self-digest', () => {
  const mutated = structuredClone(loadJson(FILTER_PATH));
  mutated.allowedPayloadSha256[0] = '0'.repeat(64);
  mutated.allowedPayloadSha256.sort();
  mutated.filterSha256 = filterSelfDigest(mutated);
  assert.throws(
    () => validateFilter(mutated),
    (error) => error instanceof assert.AssertionError
      && /concrete positive-list digest/.test(error.message),
  );
});
