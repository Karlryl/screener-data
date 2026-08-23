'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'studie-identifier-bridge.py');
const PREREG = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'd3-identifier-bridge-preregistration.json');

const REQUIRED = [
  'Drei gebundene Rechenmodule sind bytegleich zur Vorregistrierung',
  'Nur der reine Kennungsname wird zurueckgewonnen',
  'Waehrungseinheitswechsel bleibt ausdruecklich Verlust',
  'Verbleibender Schwund ist exakt a plus b2 plus c plus d',
  'Nach Bruecke gehen zehn Firmen als sieben plus drei auf',
  'Verbleibende Schwundquote ist von Hand 3/10',
  'Retention nach Bruecke ist von Hand 7/10',
  'Verbesserung ist von Hand zehn Prozentpunkte',
  'Ein zurueckgewonnener Fall kippt das Nullmodell',
  'Nur Waehrungswechsel kippt das Nullmodell nicht',
  'S-G-Negativkontrolle gewinnt null Kennungsfaelle zurueck',
  'Brueckenfunktion kennt keine Einzelwerte oder Wachstumsrechnung',
  'Brueckenfunktion schreibt nur aggregierte Zaehler',
  'Eine nicht aufgehende Klassenzerlegung bricht fail-closed ab',
];

test('D3: der Fixture-Selbsttest ist benannt, zaehlbar und gruen', () => {
  const run = spawnSync(process.env.PYTHON || 'python', [SCRIPT, '--self-test'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const green = new Set(run.stdout.split(/\r?\n/)
    .filter((line) => /^\s{2}ok\s{4}/.test(line))
    .map((line) => line.replace(/^\s{2}ok\s{4}/, '').trim()));
  assert.deepEqual(REQUIRED.filter((name) => !green.has(name)), []);
  assert.equal(green.size, 14);
  assert.match(run.stdout, /SELBSTTEST GRUEN - 14 benannte Pruefungen/);
});

test('D3: Vorregistrierung bindet reine Kennungsbruecke, Nullmodell und Schwelle', () => {
  const prereg = JSON.parse(fs.readFileSync(PREREG, 'utf8'));
  assert.equal(prereg.status, 'FROZEN_BEFORE_D3_FACT_ACCESS');
  assert.equal(prereg.bridgeRule.recoveredClass, 'klasse_b1_nur_kennungsname');
  assert.ok(prereg.bridgeRule.notRecovered.includes('klasse_b2_auch_waehrungseinheit'));
  assert.match(prereg.bridgeRule.seamRule, /never company values/);
  assert.match(prereg.nullModel, /zero companies/);
  assert.match(prereg.threshold, /At least one recovered company/);
});
