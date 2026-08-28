'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const INDEX = path.join(REPO, 'reports', 'studie',
  'E6b-mechanical-evidence-index-2026-08-28.md');

const REQUIRED_STAGES = [
  'E0', 'E1', 'E1b', 'E2', 'E3', 'E4d/E4e', 'E4f',
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'Bridge', 'C0', 'C1',
];

const REQUIRED_PATHS = [
  'reports/studie/E0-ratifizierung-2026-08-16.md',
  'reports/studie/E1b-abnahme-2026-08-16.md',
  'reports/studie/E2-basisraten-2026-08-19.json',
  'reports/studie/E3-praeregistrierung-2026-08-19.md',
  'reports/studie/E4d-E4e-kadenz-2026-08-19.md',
  'reports/studie/E4f-nachrechnung-2026-08-23.md',
  'reports/studie/D1-panel-survival-2026-08-23.json',
  'reports/studie/D2-attrition-size-sector-2026-08-23.json',
  'reports/studie/D3-identifier-bridge-2026-08-23.json',
  'reports/studie/D4-censoring-aware-attrition-2026-08-23.json',
  'reports/studie/D5-entry-cohort-standardization-2026-08-23.json',
  'reports/studie/D6-descriptive-closure-audit-2026-08-23.json',
  'reports/studie/R2-A1-identity-bridge-artifact-2026-08-25.json',
  'studie/c0-themenliste:reports/studie/C0-themenliste-2026-08-19.md',
  'studie/c1-zeitleisten:reports/studie/C1-zeitleisten-2026-08-20.md',
];

function validateIndex(source) {
  const rows = source.split(/\r?\n/).filter((line) => /^\| E6-\d{3} \|/.test(line));
  assert.equal(rows.length, 68, 'the mechanical index must contain exactly 68 entries');
  for (const stage of REQUIRED_STAGES) {
    assert.ok(rows.some((row) => row.split('|')[2].trim() === stage), `missing stage ${stage}`);
  }
  for (const required of REQUIRED_PATHS) {
    assert.ok(source.includes(`\`${required}\``), `missing path ${required}`);
  }
  for (const row of rows) {
    const columns = row.split('|').slice(1, -1).map((value) => value.trim());
    assert.equal(columns.length, 5, row);
    assert.match(columns[2], /^2026-08-\d{2}$/);
    assert.match(columns[3], /^`[^`]+`$/);
    assert.ok(columns[4].endsWith('.'), row);
  }
  assert.doesNotMatch(source,
    /\b(?:recommendation|interpretation|should|buy|sell|PASS|HOLD|GREEN|RED)\b/i);
}

test('E6b mechanical evidence index contains every required stage and path', () => {
  validateIndex(fs.readFileSync(INDEX, 'utf8'));
});

test('E6b mechanical evidence index local paths exist', () => {
  const source = fs.readFileSync(INDEX, 'utf8');
  const rows = source.split(/\r?\n/).filter((line) => /^\| E6-\d{3} \|/.test(line));
  for (const row of rows) {
    const value = row.split('|')[4].trim().slice(1, -1);
    if (value.includes(':') && value.startsWith('studie/')) continue;
    assert.ok(fs.existsSync(path.join(REPO, ...value.split('/'))), value);
  }
});

test('E6b mechanical evidence index validator fails when one stage path is removed', () => {
  const source = fs.readFileSync(INDEX, 'utf8');
  const sabotage = source.replace(
    '`reports/studie/D6-descriptive-closure-audit-2026-08-23.json`',
    '`reports/studie/D6-missing.json`',
  );
  assert.throws(() => validateIndex(sabotage), assert.AssertionError);
});
