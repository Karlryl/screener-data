'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'studie-panel-survival.py');
const PREREG = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'd1-panel-survival-preregistration.json');
const ARTIFACT = path.join(REPO, 'reports', 'studie', 'D1-panel-survival-2026-08-23.json');
const REPORT = path.join(REPO, 'reports', 'studie', 'D1-panel-survival-2026-08-23.md');

const REQUIRED_SELF_TESTS = [
  'Fixture zaehlt genau drei periodische Firmen',
  'Nichtperiodische 8-K wird ausgeschlossen',
  'Korrekturfassung verlaengert die Firma nicht',
  'Quartalsmelder ohne Folgebericht scheidet im erwarteten Quartal aus',
  'Firmen am Panelrand werden rechtszensiert',
  'Reine 20-F-Firma erhaelt Jahreskadenz',
  'Kaplan-Meier bei Quartal drei ist von Hand 2/3',
  'Median wird bei Survival 2/3 nicht erreicht',
  'Effektives N ist Firma, nie Bericht oder Tag',
  'Nullmodell kippt bereits bei einem terminalen Ereignis',
  'Aggregat enthaelt keine Firmenidentitaet',
  'Nicht vorregistriertes drittes Panel wird vor Oeffnung abgewiesen',
  'Eine Zeile nach dem 2020-Cutoff bricht fail-closed ab',
];

test('D1: der Fixture-Selbsttest ist benannt, zaehlbar und gruen', () => {
  const run = spawnSync(process.env.PYTHON || 'python', [SCRIPT, '--self-test'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const green = new Set(run.stdout.split(/\r?\n/)
    .filter((line) => /^\s{2}ok\s{4}/.test(line))
    .map((line) => line.replace(/^\s{2}ok\s{4}/, '').trim()));
  assert.deepEqual(REQUIRED_SELF_TESTS.filter((name) => !green.has(name)), []);
  assert.equal(green.size, 13, `Erwartet 13 benannte Pruefungen, gesehen ${green.size}`);
  assert.match(run.stdout, /SELBSTTEST GRUEN - 13 benannte Pruefungen/);
});

test('D1: die Vorregistrierung friert Inputs, Statistik, Nullmodell und Schwelle ein', () => {
  const prereg = JSON.parse(fs.readFileSync(PREREG, 'utf8'));
  assert.equal(prereg.status, 'FROZEN_BEFORE_PANEL_ACCESS');
  assert.deepEqual(prereg.allowedInputs, [
    'panel/panel-entdeckung.sqlite',
    'panel/panel-validierung.sqlite',
  ]);
  assert.match(prereg.testStatistic.primary, /Kaplan-Meier/);
  assert.match(prereg.nullModel, /No terminal attrition/);
  assert.match(prereg.threshold, /At least one terminal event/);
  assert.match(prereg.timeDefinition.rightCensoring, /2020-12-31/);
  assert.equal(prereg.population.identityPolicy.includes('No company identifier'), true);
});

test('D1: das Ergebnisartefakt ist aggregiert und rechnerisch geschlossen', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  assert.equal(result.counts.terminalExits + result.counts.rightCensored,
    result.counts.companies);
  assert.equal(result.counts.quarterlyCadenceCompanies + result.counts.annualCadenceCompanies,
    result.counts.companies);
  assert.equal(result.exitByQuarter.reduce((sum, row) => sum + row.companies, 0),
    result.counts.terminalExits);
  assert.equal(result.effectiveN.companies, result.counts.companies);
  assert.equal(result.effectiveN.filingsAreIndependentObservations, false);
  assert.equal(result.effectiveN.dailyPoints, 0);
  assert.equal(result.scope.companyIdentifiersWritten, 0);
  assert.equal(result.scope.signalsUsed, 0);
  assert.equal(result.scope.lastAllowedDate, '2020-12-31');
  let previous = 1;
  for (const row of result.survivalCurve) {
    assert.ok(row.survival >= 0 && row.survival <= previous);
    previous = row.survival;
  }
  const keys = [];
  JSON.stringify(result, (key, value) => {
    keys.push(key.toLowerCase());
    return value;
  });
  for (const forbidden of ['cik', 'ticker', 'adsh', 'companyname', 'company_name']) {
    assert.ok(!keys.includes(forbidden), `Identitaetsschluessel ${forbidden} im Artefakt`);
  }
});

test('D1: jede Zahlenreihe im Bericht stammt aus dem JSON-Artefakt', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const report = fs.readFileSync(REPORT, 'utf8');
  assert.match(report.split(/\r?\n/)[0], /Medianverweildauer beträgt 27 Quartale/);
  for (const row of result.survivalCurve) {
    const survival = Number(row.survival).toFixed(12);
    const line = `| ${row.quartersSinceEntry} | ${row.atRisk} | ${row.exits} | `
      + `${row.censored} | ${survival} | ${row.cumulativeExits} |`;
    assert.ok(report.includes(line), `Kurvenzeile fehlt: ${line}`);
  }
  for (const row of result.exitByQuarter) {
    const line = `| ${row.quarter} | ${row.companies} |`;
    assert.ok(report.includes(line), `Ausscheidequartal fehlt: ${line}`);
  }
  const limitation = report.split('## Was ausdrücklich nicht gezeigt ist')[1];
  assert.ok(limitation && limitation.trim().length > 0,
    'Pflichtabschnitt "Was ausdrücklich nicht gezeigt ist" fehlt oder ist leer');
});
