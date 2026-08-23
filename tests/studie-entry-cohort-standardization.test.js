'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'studie-entry-cohort-standardization.py');
const PREREG = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'd5-entry-cohort-standardization-preregistration.json');

const REQUIRED = [
  'Gebundene D1-D2-D4-Eingaenge sind bytegleich zur Vorregistrierung',
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
