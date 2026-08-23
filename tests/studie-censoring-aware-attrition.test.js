'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'studie-censoring-aware-attrition.py');
const PREREG = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'd4-censoring-aware-attrition-preregistration.json');

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
