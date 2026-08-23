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
