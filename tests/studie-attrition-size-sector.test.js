'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'studie-attrition-size-sector.py');
const PREREG = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'd2-attrition-size-sector-preregistration.json');

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
