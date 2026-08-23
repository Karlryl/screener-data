'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'studie-censoring-aware-attrition.py');
const PREREG = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'd4-censoring-aware-attrition-preregistration.json');
const ARTIFACT = path.join(REPO, 'reports', 'studie',
  'D4-censoring-aware-attrition-2026-08-23.json');
const REPORT = path.join(REPO, 'reports', 'studie',
  'D4-censoring-aware-attrition-2026-08-23.md');
const D1_ARTIFACT = path.join(REPO, 'reports', 'studie',
  'D1-panel-survival-2026-08-23.json');
const D2_ARTIFACT = path.join(REPO, 'reports', 'studie',
  'D2-attrition-size-sector-2026-08-23.json');

const REQUIRED = [
  'Gebundene D1- und D2-Eingaenge sind bytegleich zur Vorregistrierung',
  'Fixture zaehlt genau neun Firmen',
  'Ereignisse plus Zensuren gehen in der Fixture auf',
  'Larger-Survival bei Quartal zwoelf ist von Hand 3/8',
  'Smaller-Survival bei Quartal zwoelf ist von Hand 1/4',
  'Zensierungsbewusste Differenz ist von Hand minus 12,5 Punkte',
  'Vorregistrierte Fuenf-Punkte-Schwelle greift in der Fixture',
  'Rohe D2-Richtung und Survival-Richtung sind gegensinnig konsistent',
  'Fehlende AFS-Gruppe bleibt sichtbar und ausserhalb des Kontrasts',
  'Ereignis wird bei gleicher Dauer vor der Zensur verrechnet',
  'Nicht beobachteter gemeinsamer Horizont wird nicht fortgeschrieben',
  'Sektorspannweite schliesst Gruppen unter zweihundert Firmen aus',
  'Alle Fixture-Kurven bleiben monoton',
  'Effektives N ist Firma und nie Bericht oder Tag',
  'Aggregat schreibt weder Firmenidentitaet noch Signal',
];

test('D4: der Fixture-Selbsttest ist benannt, zaehlbar und gruen', () => {
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

test('D4: Vorregistrierung bindet Horizont, Nullmodelle und Effektgrenzen', () => {
  const prereg = JSON.parse(fs.readFileSync(PREREG, 'utf8'));
  assert.equal(prereg.status, 'FROZEN_BEFORE_D4_PANEL_ACCESS');
  assert.equal(prereg.timeDefinition.commonHorizonQuarters, 12);
  assert.match(prereg.primaryTest.statistic, /smaller minus larger/);
  assert.match(prereg.primaryTest.nullModel, /equal 12-quarter/);
  assert.match(prereg.primaryTest.threshold, /5\.0 percentage points/);
  assert.match(prereg.sectorSensitivity.threshold, /10\.0 percentage points/);
  assert.equal(prereg.primaryTest.isSignificanceTest, false);
  assert.equal(prereg.sectorSensitivity.isSignificanceTest, false);
});

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('D4: gebundene Dateien und D1/D2-Anker reproduzieren exakt', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const d1 = JSON.parse(fs.readFileSync(D1_ARTIFACT, 'utf8'));
  const d2 = JSON.parse(fs.readFileSync(D2_ARTIFACT, 'utf8'));
  assert.equal(result.preregistration.sha256, sha256(PREREG));
  for (const [relative, expected] of Object.entries(result.boundInputs)) {
    assert.equal(sha256(path.join(REPO, relative)), expected, relative);
  }
  assert.deepEqual(result.counts, {
    companies: d1.counts.companies,
    rightCensored: d1.counts.rightCensored,
    terminalExits: d1.counts.terminalExits,
  });
  assert.equal(result.anchors.countsMatched, true);
  assert.equal(result.anchors.groupsMatched, true);
  for (const [name, sourceName] of [
    ['larger', 'larger'],
    ['smaller', 'smaller'],
    ['missingOrUnknown', 'missingOrUnknown'],
  ]) {
    const actual = result.size.groups[name];
    const expected = d2.size.groups[sourceName];
    assert.equal(actual.companies, expected.companies);
    assert.equal(actual.terminalExits, expected.terminalExits);
    assert.equal(actual.rightCensored, expected.rightCensored);
  }
});

test('D4: alle Gruppen und Kaplan-Meier-Kurven sind rechnerisch geschlossen', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const groups = [...Object.values(result.size.groups), ...result.sector.groups];
  for (const group of groups) {
    assert.equal(group.terminalExits + group.rightCensored, group.companies);
    let previous = 1;
    for (const row of group.survivalCurve) {
      assert.ok(row.survival >= 0 && row.survival <= previous);
      previous = row.survival;
    }
    const horizon = group.survivalCurve.find((row) =>
      row.quartersSinceEntry === result.horizonQuarters);
    const expected = horizon && horizon.atRisk > 0 ? horizon.survival : null;
    assert.equal(group.survivalAtHorizon, expected);
    assert.equal(group.atRiskAtHorizon, horizon ? horizon.atRisk : 0);
  }
  assert.equal(Object.values(result.size.groups)
    .reduce((sum, group) => sum + group.companies, 0), result.counts.companies);
  assert.equal(result.sector.groups
    .reduce((sum, group) => sum + group.companies, 0), result.counts.companies);
});

test('D4: Größenkontrast und Sektorspannweite werden aus Gruppenwerten reproduziert', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const difference = 100 * (result.size.groups.smaller.survivalAtHorizon
    - result.size.groups.larger.survivalAtHorizon);
  assert.ok(Math.abs(difference
    - result.size.survivalDifferencePercentagePointsSmallerMinusLarger) < 1e-10);
  assert.equal(result.size.thresholdCrossed,
    Math.abs(difference) >= result.size.absoluteDifferenceThresholdPercentagePoints);
  assert.equal(result.size.directionConsistentWithD2,
    result.size.rawD2AttritionDifferencePercentagePointsSmallerMinusLarger * difference < 0);

  const eligible = result.sector.groups.filter((group) =>
    group.companies >= result.sector.minimumCompaniesForRange
    && group.horizonEstimable);
  assert.deepEqual(result.sector.eligibleSectors, eligible.map((group) => group.sector));
  const values = eligible.map((group) => group.survivalAtHorizon);
  const range = 100 * (Math.max(...values) - Math.min(...values));
  assert.ok(Math.abs(range - result.sector.maxMinusMinSurvivalPercentagePoints) < 1e-10);
  assert.equal(result.sector.thresholdCrossed,
    range >= result.sector.rangeThresholdPercentagePoints);
});

test('D4: Scope bleibt aggregiert, signal-frei und auf Firma als effektivem N', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  assert.deepEqual(result.scope, {
    companyIdentifiersWritten: 0,
    dailyObservationsUsed: 0,
    lastAllowedDate: '2020-12-31',
    signalsUsed: 0,
  });
  assert.equal(result.effectiveN.companies, result.counts.companies);
  assert.equal(result.effectiveN.filingsAreIndependentObservations, false);
  assert.equal(result.effectiveN.repeatedCompaniesAcrossStrata, 0);
});

test('D4: jede Größen- und Sektorzeile im Bericht stammt aus dem JSON-Artefakt', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const report = fs.readFileSync(REPORT, 'utf8');
  const firstLine = report.split(/\r?\n/)[0];
  assert.ok(firstLine.includes((100 * result.size.groups.smaller.survivalAtHorizon)
    .toFixed(6).replace('.', ',')));
  assert.ok(firstLine.includes(Math.abs(
    result.size.survivalDifferencePercentagePointsSmallerMinusLarger)
    .toFixed(12).replace('.', ',')));
  assert.ok(firstLine.includes(result.sector.maxMinusMinSurvivalPercentagePoints
    .toFixed(12).replace('.', ',')));

  const sizeLabels = {
    larger: 'larger',
    smaller: 'smaller',
    missingOrUnknown: 'fehlend/unbekannt',
  };
  for (const [name, group] of Object.entries(result.size.groups)) {
    const median = group.medianStayQuarters === null
      ? 'nicht erreicht' : String(group.medianStayQuarters);
    const line = `| ${sizeLabels[name]} | ${group.companies} | ${group.terminalExits} | `
      + `${group.rightCensored} | ${group.atRiskAtHorizon} | `
      + `${(100 * group.survivalAtHorizon).toFixed(6)} % | ${median} |`;
    assert.ok(report.includes(line), `Größenzeile fehlt: ${line}`);
  }
  for (const group of result.sector.groups) {
    const median = group.medianStayQuarters === null
      ? 'nicht erreicht' : String(group.medianStayQuarters);
    const line = `| ${group.sector} | ${group.companies} | ${group.terminalExits} | `
      + `${group.rightCensored} | ${group.atRiskAtHorizon} | `
      + `${(100 * group.survivalAtHorizon).toFixed(6)} % | ${median} |`;
    assert.ok(report.includes(line), `Sektorzeile fehlt: ${line}`);
  }
  const limitation = report.split('## Was ausdrücklich nicht gezeigt ist')[1];
  assert.ok(limitation && limitation.trim().length > 0,
    'Pflichtabschnitt "Was ausdrücklich nicht gezeigt ist" fehlt oder ist leer');
});
