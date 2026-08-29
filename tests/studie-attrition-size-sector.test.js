'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'studie-attrition-size-sector.py');
const PREREG = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'd2-attrition-size-sector-preregistration.json');
const ARTIFACT = path.join(REPO, 'reports', 'studie',
  'D2-attrition-size-sector-2026-08-23.json');
const REPORT = path.join(REPO, 'reports', 'studie',
  'D2-attrition-size-sector-2026-08-23.md');
const D1_ARTIFACT = path.join(REPO, 'reports', 'studie',
  'D1-panel-survival-2026-08-23.json');

const REQUIRED = [
  'Fixture bleibt bei sieben Firmen nach Zusammenfuehrung',
  'AFS wird am Einstieg fixiert und folgt keinem spaeteren Status',
  'Die drei kleineren AFS-Klassen landen gemeinsam in smaller',
  'Fehlender AFS bleibt sichtbar und aus dem Kontrast draussen',
  'Groessere Gruppe hat von Hand 1/3 terminale Ausstiege',
  'Kleinere Gruppe hat von Hand 3/3 terminale Ausstiege',
  'Risikodifferenz smaller minus larger ist von Hand 66,67 Punkte',
  'Vorregistrierte Fuenf-Punkte-Schwelle greift in der Fixture',
  'Sektorzaehler Services ist von Hand 3/3 Ausstiege',
  'Cramers V ist als 2xK-Effekt berechenbar und positiv',
  'Unklassifizierter SIC bleibt als eigene Luecke sichtbar',
  'Effektives N ist Firma, nie Bericht oder Tag',
  'Aggregat schreibt keine Firmenidentitaet',
];

test('D2: der Fixture-Selbsttest ist benannt, zaehlbar und gruen', () => {
  const run = spawnSync(process.env.PYTHON || 'python', [SCRIPT, '--self-test'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const green = new Set(run.stdout.split(/\r?\n/)
    .filter((line) => /^\s{2}ok\s{4}/.test(line))
    .map((line) => line.replace(/^\s{2}ok\s{4}/, '').trim()));
  assert.deepEqual(REQUIRED.filter((name) => !green.has(name)), []);
  assert.equal(green.size, 13);
  assert.match(run.stdout, /SELBSTTEST GRUEN - 13 benannte Pruefungen/);
});

test('D2: Vorregistrierung bindet AFS, SIC, Nullmodelle und Effektgrenzen', () => {
  const prereg = JSON.parse(fs.readFileSync(PREREG, 'utf8'));
  assert.equal(prereg.status, 'FROZEN_BEFORE_D2_PANEL_ACCESS');
  assert.deepEqual(prereg.sizeProxy.largerCodes, ['1-LAF', '2-ACC']);
  assert.deepEqual(prereg.sizeProxy.smallerCodes, ['3-SRA', '4-NON', '5-SML']);
  assert.match(prereg.sizeProxy.threshold, /5\.0 percentage points/);
  assert.match(prereg.sector.testStatistic, /Cramer's V/);
  assert.match(prereg.sector.threshold, /0\.10/);
  assert.match(prereg.sizeProxy.nullModel, /equal terminal-exit risk/);
  assert.match(prereg.sector.nullModel, /independent/);
});

test('D2: Population und Outcome treffen D1 exakt, alle Gruppen gehen auf', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const d1 = JSON.parse(fs.readFileSync(D1_ARTIFACT, 'utf8'));
  assert.deepEqual(result.counts, {
    companies: d1.counts.companies,
    rightCensored: d1.counts.rightCensored,
    terminalExits: d1.counts.terminalExits,
  });
  const d1Hash = crypto.createHash('sha256').update(fs.readFileSync(D1_ARTIFACT)).digest('hex');
  assert.equal(result.d1Anchor.sha256, d1Hash);
  const sizeTotal = Object.values(result.size.groups)
    .reduce((sum, group) => sum + group.companies, 0);
  assert.equal(sizeTotal, result.counts.companies);
  assert.equal(result.sector.groups.reduce((sum, group) => sum + group.companies, 0),
    result.counts.companies);
  for (const group of [...Object.values(result.size.groups), ...result.sector.groups]) {
    assert.equal(group.terminalExits + group.rightCensored, group.companies);
  }
  assert.equal(result.effectiveN.filingsAreIndependentObservations, false);
  assert.equal(result.effectiveN.dailyPoints, 0);
  assert.equal(result.scope.companyIdentifiersWritten, 0);
  assert.equal(result.scope.signalsUsed, 0);
});

test('D2: Effektgrößen werden aus den Gruppenzählern reproduziert', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const { larger, smaller } = result.size.groups;
  const difference = 100 * (smaller.terminalExits / smaller.companies
    - larger.terminalExits / larger.companies);
  const ratio = (smaller.terminalExits / smaller.companies)
    / (larger.terminalExits / larger.companies);
  assert.ok(Math.abs(difference
    - result.size.riskDifferencePercentagePointsSmallerMinusLarger) < 1e-11);
  assert.ok(Math.abs(ratio - result.size.riskRatioSmallerToLarger) < 1e-11);
  assert.equal(result.size.thresholdCrossed,
    Math.abs(difference) >= result.size.absoluteRiskDifferenceThresholdPercentagePoints);
  assert.equal(result.sector.thresholdCrossed,
    result.sector.cramersV >= result.sector.cramersVThreshold);
});

test('D2: jede AFS- und Sektorzahl im Bericht stammt aus dem JSON-Artefakt', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const report = fs.readFileSync(REPORT, 'utf8');
  assert.match(report.split(/\r?\n/)[0], /19,544694723695 Prozentpunkte/);
  assert.match(report.split(/\r?\n/)[0], /0,119840265081/);
  for (const row of result.size.afsCategories) {
    const pct = (100 * row.exitRate).toFixed(6);
    const line = `| ${row.code} | ${row.label} | ${row.companies} | `
      + `${row.terminalExits} | ${row.rightCensored} | ${pct} % |`;
    assert.ok(report.includes(line), `AFS-Zeile fehlt: ${line}`);
  }
  for (const row of result.sector.groups) {
    const pct = (100 * row.exitRate).toFixed(6);
    const line = `| ${row.sector} | ${row.companies} | ${row.terminalExits} | `
      + `${row.rightCensored} | ${pct} % |`;
    assert.ok(report.includes(line), `Sektorzeile fehlt: ${line}`);
  }
  const limitation = report.split('## Was ausdrücklich nicht gezeigt ist')[1];
  assert.ok(limitation && limitation.trim().length > 0,
    'Pflichtabschnitt "Was ausdrücklich nicht gezeigt ist" fehlt oder ist leer');
});
