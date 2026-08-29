'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const RECORD_REL = 'protocol/early-detection/2.0.0/r2-a1-t173-form-type-counter-addendum.json';
const RECORD_PATH = path.join(ROOT, ...RECORD_REL.split('/'));

const EXPECTED_RECORD_SHA256 = 'a7002de9b01c83bb025471ce1fc2c32faf3d947ca0f76e99eb4e6b5eb931dcc7';
const EXPECTED_SOURCES = [
  ['protocol/early-detection/2.0.0/r2-a1-identity-bridge-artifact-preregistration.json',
    '0f1f14243826410b91a6868b7d108a75c4af92fb1bee198de27cce7639146cb4'],
  ['protocol/early-detection/2.0.0/r2-a1-v120-method-corrections-record.json',
    '1239a61cc37d8ae3d49f3f3d05397534bf06d1f8054ea7885334cb0edc15a2f3'],
  ['protocol/early-detection/2.0.0/r2-a1-v120-comparator-defect-addendum.json',
    '6cc114424344023f7873703b7444572cf465625f270c6b42ae5d4a94d08fd10e'],
  ['protocol/early-detection/2.0.0/r2-a1-v120-closure-record.json',
    '53d77849b3a00115edf949d8fda3f4aabdfc9b4aee2f13f80600c1e14e6332db'],
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function loadRecord() {
  return JSON.parse(fs.readFileSync(RECORD_PATH, 'utf8'));
}

function validateContract(record) {
  assert.equal(record.schema, 'early-detection-disclosure-addendum/v1');
  assert.equal(record.recordId, 'r2-a1-t173-form-type-counter-2026-08-29');
  assert.equal(record.status, 'FROZEN_T173_FORM_TYPE_COUNTER_ADDENDUM');

  assert.deepEqual(
    record.scope.readColumns,
    ['bericht.form'],
    'readColumns must remain exactly bericht.form',
  );
  assert.deepEqual(record.scope.windowLabels, ['entdeckung', 'pruefung']);
  assert.ok(!record.scope.windowLabels.includes('endtest'), 'endtest must remain absent');
  assert.ok(
    record.scope.readColumns.every((column) => !column.startsWith('fakt.')),
    'fakt columns must remain absent',
  );

  assert.equal(record.normalization.function, 'form_stem');
  assert.equal(record.normalization.definition, "str(value or '').upper().strip().split('/', 1)[0]");
  assert.deepEqual(record.normalization.periodicSet, ['10-K', '10-Q', '20-F', '40-F']);

  assert.equal(record.output.field, 'nonperiodicReportsExcludedByForm');
  assert.equal(record.reconciliation.againstCounter, 'nonperiodicReportsExcluded');
  assert.match(record.reconciliation.sameRunOnly, /DIESES Laufs/);
  assert.equal(record.ledgerRelation.accessLedgerEntryRequired, false);
  assert.deepEqual(
    record.requiredProofs.map((proof) => proof.id),
    ['zwei-fenster-waechter', 'sabotage-leck', 'sabotage-fehlklassifikation'],
  );

  assert.deepEqual(
    record.referencedSealedSources.map((source) => [source.path, source.sha256AtFreezeTime]),
    EXPECTED_SOURCES,
  );
  assert.ok(record.referencedSealedSources.every((source) => source.changed === false));
}

test('T173: der eingefrorene Addendum-Vertrag bleibt byte- und objektgebunden', () => {
  assert.equal(sha256(RECORD_PATH), EXPECTED_RECORD_SHA256);
  validateContract(loadRecord());
});

test('T173: alle vier referenzierten frozen Records tragen ihre gepinnten Bytes', () => {
  for (const [relativePath, expectedHash] of EXPECTED_SOURCES) {
    assert.equal(sha256(path.join(ROOT, ...relativePath.split('/'))), expectedHash, relativePath);
  }
});

test('T173: eine zusaetzliche Faktwert-Lesespalte bricht den Vertrag', () => {
  const mutated = structuredClone(loadRecord());
  mutated.scope.readColumns.push('fakt.value');
  assert.throws(
    () => validateContract(mutated),
    (error) => error instanceof assert.AssertionError && /readColumns must remain/.test(error.message),
  );
});
