'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const PYTHON = process.env.PYTHON || 'python';
const SCRIPT = path.join(REPO, 'scripts', 'studie-d-artifact-backcalc.py');
const REGISTRATION = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'r2-d-artifact-data-backcalculation-registration.json');
const ARTIFACT = path.join(REPO, 'reports', 'studie',
  'R2-D-artifact-data-backcalculation-2026-08-28.json');
const REPORT = path.join(REPO, 'reports', 'studie',
  'R2-D-artifact-data-backcalculation-2026-08-28.md');

function run(args) {
  return spawnSync(PYTHON, args, { cwd: REPO, encoding: 'utf8' });
}

test('D1-D6 Rueckrechnung: der Fixture-Selbsttest ist gruen und mutiert rot', () => {
  const result = run([SCRIPT, '--self-test']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Sechs Objektchecks bestehen in der unveraenderten Fixture/);
  assert.match(result.stdout, /Ein veraenderter D4-Wert wird rot/);
  assert.match(result.stdout, /Ein fehlender D3-Objektcheck wird rot/);
  assert.match(result.stdout, /Ein geoeffnet markierter Endtest wird rot/);
  assert.match(result.stdout, /SELBSTTEST GRUEN - 5 benannte Pruefungen/);
});

test('D1-D6 Rueckrechnung: die Registrierung benennt jeden Gegenstand genau einmal', () => {
  const registration = JSON.parse(fs.readFileSync(REGISTRATION, 'utf8'));
  assert.equal(registration.status, 'FROZEN_BEFORE_BACKCALCULATION_PANEL_ACCESS');
  assert.deepEqual(registration.checks.map((row) => row.id),
    ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
  assert.equal(new Set(registration.checks.map((row) => row.script)).size, 6);
  assert.ok(registration.forbiddenInputs.includes('panel/panel-endtest.sqlite.enc'));
  assert.equal(registration.checks.find((row) => row.id === 'D3').executionLimit,
    'E4a is not executed');
});

test('D1-D6 Rueckrechnung: sechs reale Objektwerte und alle Bindungen treffen exakt', () => {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  assert.deepEqual(artifact.checks.map((row) => row.id),
    ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
  assert.equal(artifact.integrityContract.observedMismatches, 0);
  assert.equal(artifact.integrityContract.passes, true);
  assert.deepEqual(artifact.integrityContract.mismatchedChecks, []);
  for (const row of artifact.checks) {
    assert.deepEqual(row.recomputed, row.published, row.id);
    assert.equal(row.matchesExactly, true, row.id);
    assert.match(row.script.sha256, /^[a-f0-9]{64}$/);
    assert.match(row.publishedArtifact.sha256, /^[a-f0-9]{64}$/);
    assert.ok(fs.existsSync(path.join(REPO, ...row.script.path.split('/'))));
    assert.ok(fs.existsSync(path.join(REPO, ...row.publishedArtifact.path.split('/'))));
  }
  assert.equal(artifact.scope.eStagesExecuted, 0);
  assert.equal(artifact.scope.endtestOpened, false);
  assert.equal(artifact.scope.outcomesUsed, 0);
  assert.equal(artifact.scope.companyIdentifiersWritten, 0);
});

test('D1-D6 Rueckrechnung: Wertmutation und fehlender Objektcheck feuern am Artefakt', () => {
  const original = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const directory = fs.mkdtempSync(path.join(REPO, '.tmp-d-backcalc-sabotage-'));
  try {
    const mutated = structuredClone(original);
    mutated.checks.find((row) => row.id === 'D4').recomputed += 1;
    const mutatedPath = path.join(directory, 'mutated.json');
    fs.writeFileSync(mutatedPath, `${JSON.stringify(mutated, null, 2)}\n`, 'utf8');
    const mutationRun = run([SCRIPT, '--validate-artifact', mutatedPath]);
    assert.notEqual(mutationRun.status, 0, 'D4-Wertmutation muss rot werden');
    assert.match(mutationRun.stderr, /Stored match flag disagrees|Published aggregate mismatch/);

    const missing = structuredClone(original);
    missing.checks = missing.checks.filter((row) => row.id !== 'D3');
    const missingPath = path.join(directory, 'missing.json');
    fs.writeFileSync(missingPath, `${JSON.stringify(missing, null, 2)}\n`, 'utf8');
    const absenceRun = run([SCRIPT, '--validate-artifact', missingPath]);
    assert.notEqual(absenceRun.status, 0, 'Fehlender D3-Check muss rot werden');
    assert.match(absenceRun.stderr, /check set is not exactly D1-D6/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('D1-D6 Rueckrechnung: der Bericht ist vollstaendig und urteilsfrei', () => {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const report = fs.readFileSync(REPORT, 'utf8');
  assert.match(report.split(/\r?\n/)[0], /Sechs von sechs/);
  for (const row of artifact.checks) {
    assert.ok(report.includes(`| ${row.id} | \`${row.statistic}\` | ${row.published} | ${row.recomputed} |`));
  }
  assert.match(report, /## Was ausdruecklich nicht gezeigt ist/);
  assert.match(report, /kein E-Stadium lief/);
  assert.doesNotMatch(report, /Empfehlung:/);
});
