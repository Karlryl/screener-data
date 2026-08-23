'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'studie-identifier-bridge.py');
const PREREG = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'd3-identifier-bridge-preregistration.json');
const ARTIFACT = path.join(REPO, 'reports', 'studie',
  'D3-identifier-bridge-2026-08-23.json');
const REPORT = path.join(REPO, 'reports', 'studie',
  'D3-identifier-bridge-2026-08-23.md');

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

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('D3: Reproduktion trifft Vorregistrierung, Module und beide E4a-Anker exakt', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  assert.equal(result.sourceReproduction.anchorsMatched, true);
  assert.equal(result.preregistration.sha256, sha256(PREREG));
  for (const [relative, expected] of Object.entries(result.boundImplementation)) {
    assert.equal(sha256(path.join(REPO, relative)), expected, relative);
  }
  for (const anchor of result.sourceReproduction.anchors) {
    const file = path.join(REPO, 'reports', 'studie', anchor.file);
    assert.equal(sha256(file), anchor.sha256, anchor.file);
  }
});

test('D3: jede Brueckenzeile geht auf und alle Quoten sind nachrechenbar', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  for (const row of [...result.results, ...result.negativeControlSG]) {
    assert.equal(row.retainedBeforeBridge + row.attritionBeforeBridge,
      row.firstEventCompanies);
    assert.equal(row.identityOnlyRecovered + row.remainingAttrition,
      row.attritionBeforeBridge);
    assert.equal(row.retainedAfterBridge + row.remainingAttrition,
      row.firstEventCompanies);
    assert.ok(Math.abs(row.remainingAttrition / row.firstEventCompanies
      - row.remainingAttritionRate) < 1e-15);
    assert.ok(Math.abs(row.retainedAfterBridge / row.firstEventCompanies
      - row.retentionRateAfterBridge) < 1e-15);
    assert.ok(Math.abs(100 * row.identityOnlyRecovered / row.firstEventCompanies
      - row.retentionImprovementPercentagePoints) < 1e-12);
    assert.equal(row.zeroRecoveryNullRejectedDescriptively,
      row.identityOnlyRecovered >= 1);
  }
});

test('D3: S-G bleibt echte Negativkontrolle und der Lauf schreibt nur Aggregate', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  assert.ok(result.results.every((row) => row.identityOnlyRecovered >= 1));
  assert.ok(result.negativeControlSG.every((row) => row.identityOnlyRecovered === 0));
  assert.ok(result.negativeControlSG.every((row) =>
    row.retentionImprovementPercentagePoints === 0));
  assert.deepEqual(result.scope, {
    companyIdentifiersWritten: 0,
    crossSeamValueComputations: 0,
    dailyObservationsUsed: 0,
    lastAllowedDate: '2020-12-31',
    signalsChanged: 0,
    variant: 'S-U',
  });
});

test('D3: jede S-U- und S-G-Zeile im Bericht stammt aus dem JSON-Artefakt', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const report = fs.readFileSync(REPORT, 'utf8');
  const firstLine = report.split(/\r?\n/)[0];
  const target = result.results.find((row) => row.window === 'pruefung'
    && row.arm === 'signal');
  assert.ok(firstLine.includes(`${target.remainingAttrition} von ${target.firstEventCompanies}`));
  assert.ok(firstLine.includes(`${target.identityOnlyRecovered} der zuvor `
    + `${target.attritionBeforeBridge}`));
  assert.ok(firstLine.includes(
    target.retentionImprovementPercentagePoints.toFixed(12).replace('.', ',')));

  for (const row of result.results) {
    const line = `| ${row.window} | ${row.band} | ${row.arm} | `
      + `${row.firstEventCompanies} | ${row.retainedBeforeBridge} | `
      + `${row.attritionBeforeBridge} | ${row.identityOnlyRecovered} | `
      + `${row.retainedAfterBridge} | ${row.remainingAttrition} | `
      + `${(100 * row.remainingAttritionRate).toFixed(6)} % | `
      + `${row.retentionImprovementPercentagePoints.toFixed(12)} Prozentpunkte |`;
    assert.ok(report.includes(line), `S-U-Zeile fehlt: ${line}`);
  }
  for (const row of result.negativeControlSG) {
    const line = `| ${row.window} | ${row.band} | ${row.arm} | `
      + `${row.firstEventCompanies} | ${row.attritionBeforeBridge} | `
      + `${row.identityOnlyRecovered} | ${row.currencyChangeNotRecovered} | `
      + `${row.remainingAttrition} | `
      + `${(100 * row.remainingAttritionRate).toFixed(6)} % | `
      + `${(100 * row.retentionRateAfterBridge).toFixed(6)} % |`;
    assert.ok(report.includes(line), `S-G-Zeile fehlt: ${line}`);
  }
  const limitation = report.split('## Was ausdrücklich nicht gezeigt ist')[1];
  assert.ok(limitation && limitation.trim().length > 0,
    'Pflichtabschnitt "Was ausdrücklich nicht gezeigt ist" fehlt oder ist leer');
});
