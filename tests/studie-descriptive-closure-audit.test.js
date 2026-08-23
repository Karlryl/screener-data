'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'studie-descriptive-closure-audit.py');
const REGISTRATION = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'd6-descriptive-closure-audit-registration.json');

const REQUIRED = [
  'Einundzwanzig Quellen sind bytegleich an den Auditvertrag gebunden',
  'Fixture-D1 geht als vier plus sechs gleich zehn auf',
  'Fixture-Groessenrichtung bleibt ueber drei Deskriptoren konsistent',
  'Fixture-Sektorflag widerspricht sich sichtbar zwischen D2 und D4',
  'Fixture-Kennungsbruecke geht als zwei plus zwei gleich vier auf',
  'Fixture-Kadenz und Kohorte bleiben gemeinsam als offene Flags sichtbar',
  'Null Fehler laesst den Auditvertrag bestehen',
  'Ein absichtlicher Fehler kippt den Auditvertrag rot',
  'Ein anderes empirisches Flag ist kein Integritaetsfehler',
  'Vier Urteilsfragen bleiben ausschliesslich bei Claude',
  'D6 oeffnet null Panels und erzeugt null neue Beobachtungen',
  'Alle fuenf Quellberichte tragen Ergebniszeile und Pflichtgrenze',
  'D6 schreibt keine Firmenidentitaet',
];

test('D6: der Fixture-Selbsttest ist benannt, zaehlbar und gruen', () => {
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

test('D6: Auditvertrag ist ehrlich nach D1-D5-Publikation eingefroren', () => {
  const registration = JSON.parse(fs.readFileSync(REGISTRATION, 'utf8'));
  assert.equal(registration.status,
    'FROZEN_BEFORE_D6_ASSEMBLY_AFTER_D1_D5_PUBLICATION');
  assert.equal(Object.keys(registration.sourceFiles).length, 21);
  assert.match(registration.auditStatistic, /number of .* failures/);
  assert.match(registration.nullModel, /zero integrity failures/);
  assert.match(registration.threshold, /one or more failures/);
  assert.match(registration.interpretationPolicy, /may not choose a study verdict/);
});
