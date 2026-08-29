'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const PYTHON = process.env.PYTHON || 'python';
const HELPER = path.join(REPO, 'scripts', 'studie-threshold-seal.py');
const SEAL = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'r2-d-threshold-seal.json');
const REPORT = path.join(REPO, 'reports', 'studie',
  'R2-D-threshold-sealing-2026-08-28.md');
const SCRIPTS = [
  ['D2', 'studie-attrition-size-sector.py'],
  ['D4', 'studie-censoring-aware-attrition.py'],
  ['D5', 'studie-entry-cohort-standardization.py'],
];

function run(args) {
  return spawnSync(PYTHON, args, { cwd: REPO, encoding: 'utf8' });
}

test('D2-D5: der Schwellen-Siegel-Selbsttest ist gruen und sabotagesensitiv', () => {
  const result = run([HELPER, '--self-test']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Alle D2-D5-Schwellen stammen aus ihren eingefrorenen Objekten/);
  assert.match(result.stdout, /Eine auf 8.0 gesenkte Sektorschwelle wird rot/);
  assert.match(result.stdout, /Eine fehlende Schwelle wird rot/);
  assert.match(result.stdout, /Eine nur im Siegel gesenkte Schwelle wird rot/);
  assert.match(result.stdout, /SELBSTTEST GRUEN - 4 benannte Pruefungen/);
});

test('D2-D5: jedes entscheidende Skript laedt den gemeinsamen Objektwaechter wirklich', () => {
  for (const [label, file] of SCRIPTS) {
    const script = path.join(REPO, 'scripts', file);
    const probe = [
      '-c',
      [
        'import importlib.util,json,sys',
        'p=sys.argv[1]',
        `s=importlib.util.spec_from_file_location('probe_${label.toLowerCase()}',p)`,
        'm=importlib.util.module_from_spec(s)',
        's.loader.exec_module(m)',
        "print(json.dumps({'values':m.THRESHOLDS,'seal':m.THRESHOLD_SEAL_META},sort_keys=True))",
      ].join(';'),
      script,
    ];
    const result = run(probe);
    assert.equal(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
    const loaded = JSON.parse(result.stdout.trim());
    assert.match(loaded.seal.path, /r2-d-threshold-seal\.json$/);
    assert.match(loaded.seal.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Object.keys(loaded.values).length >= 3, `${label}: Schwellen fehlen`);
  }
});

test('D2-D5: das Siegel pinnt Originalobjekte und aktuelle Skripte als Dateien', () => {
  const seal = JSON.parse(fs.readFileSync(SEAL, 'utf8'));
  assert.equal(seal.status, 'FROZEN_THRESHOLD_BINDING_CORRECTION');
  assert.deepEqual(Object.keys(seal.sourcePreregistrations).sort(), ['d2', 'd4', 'd5']);
  for (const descriptor of Object.values(seal.sourcePreregistrations)) {
    assert.ok(fs.existsSync(path.join(REPO, ...descriptor.path.split('/'))));
    assert.match(descriptor.sha256, /^[a-f0-9]{64}$/);
  }
  for (const [relative, hash] of Object.entries(seal.currentScripts)) {
    assert.ok(fs.existsSync(path.join(REPO, ...relative.split('/'))));
    assert.match(hash, /^[a-f0-9]{64}$/);
  }
});

test('D2-D5: veroeffentlichte Artefakte und Original-Praeregistrierungen bleiben unveraendert', () => {
  const seal = JSON.parse(fs.readFileSync(SEAL, 'utf8'));
  for (const component of ['d2', 'd4', 'd5']) {
    const prereg = JSON.parse(fs.readFileSync(path.join(
      REPO, ...seal.sourcePreregistrations[component].path.split('/')), 'utf8'));
    assert.match(prereg.status, /^FROZEN_BEFORE_D[245]_PANEL_ACCESS$/);
  }
  for (const name of [
    'D2-attrition-size-sector-2026-08-23.json',
    'D4-censoring-aware-attrition-2026-08-23.json',
    'D5-entry-cohort-standardization-2026-08-23.json',
  ]) {
    assert.ok(fs.existsSync(path.join(REPO, 'reports', 'studie', name)));
  }
});

test('D2-D5: der Bericht nennt jede versiegelte Grenze und die Nicht-Aussagen', () => {
  const seal = JSON.parse(fs.readFileSync(SEAL, 'utf8'));
  const report = fs.readFileSync(REPORT, 'utf8');
  assert.match(report.split(/\r?\n/)[0], /Alle sieben entscheidenden D2-D5-Schwellen/);
  for (const component of Object.values(seal.components)) {
    for (const definition of Object.values(component.thresholds)) {
      const rendered = String(definition.value).replace('.', ',');
      assert.ok(report.includes(rendered), `Versiegelter Wert fehlt im Bericht: ${rendered}`);
    }
  }
  assert.match(report, /## Was ausdruecklich nicht gezeigt ist/);
  assert.match(report, /kein Panel, Signal, Preis, Outcome oder Endtest geoeffnet/);
});
