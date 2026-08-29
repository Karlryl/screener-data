'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'studie-cadence-edge-bias.py');
const PREREG = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'r2-d1-cadence-edge-bias-preregistration.json');
const ARTIFACT = path.join(REPO, 'reports', 'studie',
  'R2-D1-cadence-edge-bias-2026-08-28.json');
const REPORT = path.join(REPO, 'reports', 'studie',
  'R2-D1-cadence-edge-bias-2026-08-28.md');
const PUBLISHED = path.join(REPO, 'reports', 'studie', 'D1-panel-survival-2026-08-23.json');
const PYTHON = process.env.PYTHON || 'python';

const REQUIRED_SELF_TESTS = [
  'Jahresmelder und Quartalsmelder mit langer Luecke kippen gemeinsam',
  'Reiner 10-K-Melder ist eigener Meldertyp',
  'Reiner 20-F-Melder bleibt auslaendischer Jahresmelder',
  'Einzelbericht bleibt ehrlich fallback-imputiert',
  'Median mit halbem Tag wird konservativ aufgerundet',
  'Beide Lesarten rechnen auf dasselbe effektive N',
  'Panelkanten-Band 91-120 ist erreichbar',
  'Die Gegenlesart kann 2020Q4-Ausstiege entfernen',
  'Aggregat verwirft jede Firmenidentitaet',
  'Klassifikationen partitionieren das Fixture',
];

function runScript(script = SCRIPT) {
  return spawnSync(PYTHON, [script, '--self-test'], {
    cwd: REPO,
    encoding: 'utf8',
  });
}

test('R2-D1: der Fixture-Selbsttest ist benannt, zaehlbar und gruen', () => {
  const run = runScript();
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const green = new Set(run.stdout.split(/\r?\n/)
    .filter((line) => /^\s{2}ok\s{4}/.test(line))
    .map((line) => line.replace(/^\s{2}ok\s{4}/, '').trim()));
  assert.deepEqual(REQUIRED_SELF_TESTS.filter((name) => !green.has(name)), []);
  assert.equal(green.size, 10);
  assert.match(run.stdout, /SELBSTTEST GRUEN - 10 benannte Pruefungen/);
});

test('R2-D1: die Aufrundungs-Sabotage trifft den Gegenstand und wird rot', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const mutated = source.replace(
    'else math.ceil(statistics.median(intervals))',
    'else math.floor(statistics.median(intervals))',
  );
  assert.notEqual(mutated, source, 'Sabotage ist nicht im Skript angekommen');
  const sabotage = path.join(path.dirname(SCRIPT),
    `.studie-cadence-edge-bias-sabotage-${process.pid}.py`);
  try {
    fs.writeFileSync(sabotage, mutated, 'utf8');
    const run = runScript(sabotage);
    assert.notEqual(run.status, 0, 'Sabotage muss den Selbsttest rot machen');
    assert.match(run.stdout, /Median mit halbem Tag wird konservativ aufgerundet/);
    assert.match(run.stdout, /SELBSTTEST ROT/);
  } finally {
    fs.rmSync(sabotage, { force: true });
  }
});

test('R2-D1: die Vorregistrierung friert Messung und Endtest-Sperre ein', () => {
  const prereg = JSON.parse(fs.readFileSync(PREREG, 'utf8'));
  assert.equal(prereg.status, 'FROZEN_BEFORE_CORRECTION_PANEL_ACCESS');
  assert.deepEqual(prereg.allowedInputs, [
    'panel/panel-entdeckung.sqlite',
    'panel/panel-validierung.sqlite',
  ]);
  assert.match(prereg.learnedReading.companyCadenceDays, /ceiling of the median/);
  assert.equal(prereg.frozenReading.quarterlyDays, 91);
  assert.deepEqual(prereg.panelEdgeDistance.bandsDaysInclusive,
    ['0-90', '91-120', '121-180', '181-270', '271-365', '366+']);
  assert.ok(prereg.forbiddenInputs.includes('panel/panel-endtest.sqlite.enc'));
  assert.match(prereg.correctionRule, /D1, D2, D4, and D5/);
});

test('R2-D1: das reale Artefakt reproduziert D1 und partitioniert den Kadenz-Effekt', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const published = JSON.parse(fs.readFileSync(PUBLISHED, 'utf8'));
  const frozen = result.readings.frozenFormImputed;
  const learned = result.readings.companyLearned;
  assert.equal(result.publishedD1.reproducedExactly, true);
  assert.deepEqual(frozen, {
    terminalExits: published.counts.terminalExits,
    rightCensored: published.counts.rightCensored,
    medianStayQuarters: published.medianStayQuarters,
    survivalCurve: published.survivalCurve,
    exitByQuarter: published.exitByQuarter,
  });
  assert.equal(frozen.terminalExits + frozen.rightCensored, result.counts.companies);
  assert.equal(learned.terminalExits + learned.rightCensored, result.counts.companies);
  assert.equal(result.frozenOnlyByReporterType.reduce((sum, row) => sum + row.companies, 0),
    result.counts.frozenOnlyExits);
  assert.equal(result.frozenOnlyByPanelEdgeDays.reduce((sum, row) => sum + row.companies, 0),
    result.counts.frozenOnlyExits);
  assert.equal(result.frozenOnlyByReporterTypeAndPanelEdgeDays
    .reduce((sum, row) => sum + row.companies, 0), result.counts.frozenOnlyExits);
  assert.equal(result.scope.endtestOpened, false);
  assert.equal(result.scope.outcomesUsed, 0);
  assert.equal(result.scope.companyIdentifiersWritten, 0);
});

test('R2-D1: der Bericht stellt beide Lesarten dar und bleibt append-only', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const report = fs.readFileSync(REPORT, 'utf8');
  assert.match(report.split(/\r?\n/)[0], /allein auf die eingefrorene Form-Kadenz/);
  assert.match(report, /## Beide Lesarten/);
  assert.match(report, /## Ueberlebenskurven nebeneinander/);
  assert.match(report, /## Was ausdruecklich nicht gezeigt ist/);
  assert.match(report, /Endtest-Fenster 2021-2023 wurde weder geoeffnet/);
  for (const row of result.frozenOnlyByReporterType) {
    assert.ok(report.includes(`| ${row.reporterType} | ${row.companies} |`));
  }
  for (const row of result.frozenOnlyByPanelEdgeDays) {
    assert.ok(report.includes(`| ${row.panelEdgeDays} | ${row.companies} |`));
  }
});
