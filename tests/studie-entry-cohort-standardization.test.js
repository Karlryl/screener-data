'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'studie-entry-cohort-standardization.py');
const PREREG = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'd5-entry-cohort-standardization-preregistration.json');
const ARTIFACT = path.join(REPO, 'reports', 'studie',
  'D5-entry-cohort-standardization-2026-08-23.json');
const REPORT = path.join(REPO, 'reports', 'studie',
  'D5-entry-cohort-standardization-2026-08-23.md');
const D1_ARTIFACT = path.join(REPO, 'reports', 'studie',
  'D1-panel-survival-2026-08-23.json');
const D4_ARTIFACT = path.join(REPO, 'reports', 'studie',
  'D4-censoring-aware-attrition-2026-08-23.json');
const THRESHOLD_SEAL = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'r2-d-threshold-seal.json');

const REQUIRED = [
  'Historische D5-Bindung und aktuelle Schwellen-Skripte sind beide exakt',
  'Fixture zaehlt genau dreizehn Firmen',
  'Primaere Standardisierung verwendet genau zwoelf Firmen',
  'Beide Eintrittsjahre erhalten von Hand Gewicht ein halb',
  'Standardisierte Larger-Survival ist von Hand fuenf Sechstel',
  'Standardisierte Smaller-Survival ist von Hand ein halb',
  'Standardisierte Differenz ist von Hand minus ein Drittel',
  'Fuenf-Punkte-Schwelle greift in der Fixture',
  'Standardisierte Richtung stimmt mit unstandardisierter Richtung ueberein',
  'Spaete Eintrittskohorte bleibt sichtbar aber am Horizont ungeschaetzt',
  'Quartals- und Jahreskadenz gehen gemeinsam auf dreizehn auf',
  'Eintrittskohorten gehen gemeinsam auf dreizehn auf',
  'Gemeinsame Gewichte summieren sich exakt zu eins',
  'Effektives N addiert die drei Tabellen nie',
  'Aggregat schreibt weder Firmenidentitaet noch Signal',
];

test('D5: der Fixture-Selbsttest ist benannt, zaehlbar und gruen', () => {
  const run = spawnSync(process.env.PYTHON || 'python', [SCRIPT, '--self-test'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const green = new Set(run.stdout.split(/\r?\n/)
    .filter((line) => /^\s{2}ok\s{4}/.test(line))
    .map((line) => line.replace(/^\s{2}ok\s{4}/, '').trim()));
  assert.deepEqual(REQUIRED.filter((name) => !green.has(name)), []);
  assert.equal(green.size, 15);
  assert.match(run.stdout, /SELBSTTEST GRUEN - 15 benannte Pruefungen/);
});

test('D5: Vorregistrierung bindet Standardisierung, Kadenz und Kohortengrenzen', () => {
  const prereg = JSON.parse(fs.readFileSync(PREREG, 'utf8'));
  assert.equal(prereg.status, 'FROZEN_BEFORE_D5_PANEL_ACCESS');
  assert.equal(prereg.commonHorizon.quarters, 12);
  assert.deepEqual(prereg.primaryStandardization.eligibleGroups, ['larger', 'smaller']);
  assert.match(prereg.primaryStandardization.commonWeights, /pooled larger-plus-smaller/);
  assert.match(prereg.primaryStandardization.threshold, /5\.0 percentage points/);
  assert.match(prereg.cadenceSensitivity.threshold, /5\.0 percentage points/);
  assert.match(prereg.entryCohortSensitivity.threshold, /10\.0 percentage points/);
  assert.equal(prereg.primaryStandardization.isSignificanceTest, false);
});

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('D5: gebundene Dateien und D1/D2/D4-Anker reproduzieren exakt', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const d1 = JSON.parse(fs.readFileSync(D1_ARTIFACT, 'utf8'));
  const d4 = JSON.parse(fs.readFileSync(D4_ARTIFACT, 'utf8'));
  const prereg = JSON.parse(fs.readFileSync(PREREG, 'utf8'));
  const thresholdSeal = JSON.parse(fs.readFileSync(THRESHOLD_SEAL, 'utf8'));
  assert.equal(result.preregistration.sha256, sha256(PREREG));
  assert.deepEqual(result.boundInputs, prereg.boundInputs,
    'Historische D5-Bindung im Artefakt muss unveraendert bleiben');
  for (const [relative, expected] of Object.entries(result.boundInputs)) {
    const currentExpected = thresholdSeal.currentScripts[relative] || expected;
    assert.equal(sha256(path.join(REPO, relative)), currentExpected, relative);
  }
  assert.deepEqual(result.counts, {
    companies: d1.counts.companies,
    rightCensored: d1.counts.rightCensored,
    terminalExits: d1.counts.terminalExits,
  });
  assert.deepEqual(result.anchors, {
    d1CountsMatched: true,
    d2SizeGroupsMatched: true,
    d4UnstandardizedSizeMatched: true,
  });
  assert.equal(result.standardizedSize.unstandardizedD4DifferencePercentagePoints,
    d4.size.survivalDifferencePercentagePointsSmallerMinusLarger);
});

test('D5: gemeinsame Gewichte und standardisierte Größenwerte sind nachrechenbar', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const rows = result.standardizedSize.entryYearRows;
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.commonWeight, 0) - 1) < 1e-12);
  assert.equal(rows.reduce((sum, row) => sum + row.pooledCompanies, 0),
    result.effectiveN.primaryEligibleCompanies);
  assert.ok(rows.every((row) => row.largerCompanies > 0 && row.smallerCompanies > 0));
  const larger = rows.reduce((sum, row) =>
    sum + row.commonWeight * row.largerSurvivalAtHorizon, 0);
  const smaller = rows.reduce((sum, row) =>
    sum + row.commonWeight * row.smallerSurvivalAtHorizon, 0);
  const difference = 100 * (smaller - larger);
  assert.ok(Math.abs(larger - result.standardizedSize.largerSurvivalAtHorizon) < 1e-11);
  assert.ok(Math.abs(smaller - result.standardizedSize.smallerSurvivalAtHorizon) < 1e-11);
  assert.ok(Math.abs(difference
    - result.standardizedSize.survivalDifferencePercentagePointsSmallerMinusLarger) < 1e-10);
  assert.equal(result.standardizedSize.thresholdCrossed,
    Math.abs(difference)
      >= result.standardizedSize.absoluteDifferenceThresholdPercentagePoints);
  assert.equal(result.standardizedSize.directionConsistentWithD4,
    difference * result.standardizedSize.unstandardizedD4DifferencePercentagePoints > 0);
});

test('D5: Kadenz- und Kohortenreihen gehen auf und treffen ihre Effektmarken', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const cadenceGroups = Object.values(result.cadence.groups);
  assert.equal(cadenceGroups.reduce((sum, group) => sum + group.companies, 0),
    result.counts.companies);
  const cadenceDifference = 100 * (
    result.cadence.groups.annual.survivalAtHorizon
    - result.cadence.groups.quarterly.survivalAtHorizon);
  assert.ok(Math.abs(cadenceDifference
    - result.cadence.survivalDifferencePercentagePointsAnnualMinusQuarterly) < 1e-10);
  assert.equal(result.cadence.thresholdCrossed,
    Math.abs(cadenceDifference)
      >= result.cadence.absoluteDifferenceThresholdPercentagePoints);

  const cohorts = result.entryCohorts.groups;
  assert.equal(cohorts.reduce((sum, group) => sum + group.companies, 0),
    result.counts.companies);
  const eligible = cohorts.filter((group) => group.eligibleForCommonHorizon
    && group.companies >= result.entryCohorts.minimumCompaniesForRange);
  assert.deepEqual(result.entryCohorts.eligibleYears,
    eligible.map((group) => group.entryYear));
  const values = eligible.map((group) => group.survivalAtHorizon);
  const range = 100 * (Math.max(...values) - Math.min(...values));
  assert.ok(Math.abs(range - result.entryCohorts.maxMinusMinSurvivalPercentagePoints) < 1e-10);
  assert.equal(result.entryCohorts.thresholdCrossed,
    range >= result.entryCohorts.rangeThresholdPercentagePoints);
  assert.ok(cohorts.filter((group) => !group.eligibleForCommonHorizon)
    .every((group) => group.survivalAtHorizon === null && group.atRiskAtHorizon === 0));
});

test('D5: Scope und effektives N bleiben aggregiert und ohne Doppelzählungs-Urteil', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  assert.deepEqual(result.scope, {
    companyIdentifiersWritten: 0,
    dailyObservationsUsed: 0,
    lastAllowedDate: '2020-12-31',
    signalsUsed: 0,
  });
  assert.equal(result.effectiveN.companies, result.counts.companies);
  assert.equal(result.effectiveN.filingsAreIndependentObservations, false);
  assert.equal(result.effectiveN.tableTotalsMayBeAdded, false);
});

test('D5: jede Standardisierungs-, Kadenz- und Kohortenzeile stammt aus dem Artefakt', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const report = fs.readFileSync(REPORT, 'utf8');
  const firstLine = report.split(/\r?\n/)[0];
  assert.ok(firstLine.includes(Math.abs(
    result.standardizedSize.survivalDifferencePercentagePointsSmallerMinusLarger)
    .toFixed(12).replace('.', ',')));
  assert.ok(firstLine.includes(result.standardizedSize.absoluteShiftFromD4PercentagePoints
    .toFixed(12).replace('.', ',')));

  for (const row of result.standardizedSize.entryYearRows) {
    const line = `| ${row.entryYear} | ${row.pooledCompanies} | `
      + `${(100 * row.commonWeight).toFixed(6)} % | ${row.largerCompanies} | `
      + `${(100 * row.largerSurvivalAtHorizon).toFixed(6)} % | `
      + `${row.smallerCompanies} | `
      + `${(100 * row.smallerSurvivalAtHorizon).toFixed(6)} % |`;
    assert.ok(report.includes(line), `Standardisierungszeile fehlt: ${line}`);
  }
  for (const [name, group] of Object.entries(result.cadence.groups)) {
    const median = group.medianStayQuarters === null
      ? 'nicht erreicht' : String(group.medianStayQuarters);
    const line = `| ${name} | ${group.companies} | ${group.terminalExits} | `
      + `${group.rightCensored} | ${group.atRiskAtHorizon} | `
      + `${(100 * group.survivalAtHorizon).toFixed(6)} % | ${median} |`;
    assert.ok(report.includes(line), `Kadenzzeile fehlt: ${line}`);
  }
  for (const group of result.entryCohorts.groups) {
    const eligible = group.eligibleForCommonHorizon ? 'ja' : 'nein';
    const survival = group.survivalAtHorizon === null
      ? 'nicht geschätzt' : `${(100 * group.survivalAtHorizon).toFixed(6)} %`;
    const median = group.medianStayQuarters === null
      ? 'nicht erreicht' : String(group.medianStayQuarters);
    const line = `| ${group.entryYear} | ${eligible} | ${group.companies} | `
      + `${group.terminalExits} | ${group.rightCensored} | ${group.atRiskAtHorizon} | `
      + `${survival} | ${median} |`;
    assert.ok(report.includes(line), `Kohortenzeile fehlt: ${line}`);
  }
  const limitation = report.split('## Was ausdrücklich nicht gezeigt ist')[1];
  assert.ok(limitation && limitation.trim().length > 0,
    'Pflichtabschnitt "Was ausdrücklich nicht gezeigt ist" fehlt oder ist leer');
});
