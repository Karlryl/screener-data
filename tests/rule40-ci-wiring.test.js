'use strict';
/** tests/rule40-ci-wiring.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG: das Brett ist verdrahtet — im Tageslauf UND im Test-Gate — und zwar so,
 * wie §14 es behauptet. Ein Schreiber, den kein Workflow aufruft, ist ein Skript im Ordner;
 * ein Test, den kein Glob einsammelt, ist eine Datei im Ordner.
 *
 * WARUM ES DIESEN TEST GIBT: die Verdrahtung liegt in .github/ (deny-gelistet, also von Hand
 * gelegt) und in scripts/test-gate.js — zwei Stellen, die niemand anfasst, wenn er am Brett
 * arbeitet. Faellt eine davon bei einem spaeteren Umbau weg, merkt es sonst niemand, bis
 * Karl morgens ein Brett von vorgestern sieht.
 *
 * Er liest die Dateien als TEXT. Ein YAML-Parser waere hier keine Verbesserung: geprueft wird
 * die Anwesenheit genau dieser Aufrufe, nicht die Struktur des Workflows.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const { laeufer } = require('./rule40-fixture.js');
const { test, bilanz } = laeufer();

const daily = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'daily-pull.yml'), 'utf8');
const gate = fs.readFileSync(path.join(REPO, 'scripts', 'test-gate.js'), 'utf8');

test('daily-pull ruft den Schreiber auf', () => {
  assert.match(daily, /node scripts\/write-rule40-export\.js \|\| true/,
    'der Bau-Schritt fehlt oder ist nicht mehr fail-soft');
});

test('daily-pull ruft das eigene Tor auf', () => {
  assert.match(daily, /node scripts\/write-rule40-export\.js --check \|\| true/,
    'der --check-Schritt fehlt oder ist nicht mehr fail-soft');
});

test('beide Schritte stehen NACH dem Vertragstor des Haupt-Exports', () => {
  const tor = daily.indexOf('node scripts/write-findash-export.js --check');
  const bau = daily.indexOf('node scripts/write-rule40-export.js || true');
  assert.ok(tor > -1 && bau > tor,
    'das Brett liest den fertigen Export — es darf erst laufen, wenn der sein Tor bestanden hat');
});

test('der Pages-Deploy kopiert den ganzen v1-Ordner (rule40/ faehrt mit)', () => {
  assert.match(daily, /cp -r \.\.\/outputs\/findash-export\/v1\/\. outputs\/findash-export\/v1\//,
    'ohne den Gesamt-Kopierschritt erreicht rule40/ gh-pages nie');
});

test('die Datei-Zaehler-Tore zaehlen nur v1/*.json und v1/full/*.json', () => {
  assert.match(daily, /ls outputs\/findash-export\/v1\/\*\.json/);
  assert.match(daily, /ls outputs\/findash-export\/v1\/full\/\*\.json/);
  assert.ok(!/ls outputs\/findash-export\/v1\/\*\*/.test(daily),
    'ein rekursives Zaehl-Tor wuerde am neuen Unterordner anschlagen');
});

test('die Tests dieses Bretts liegen im Pfad, den die blockierende Spur einsammelt', () => {
  // Der Test-Gate hat einen eigenen Waechter: JEDE von git gefuehrte *test.js, die in KEINER
  // Spur laeuft, bricht den Lauf ab ("Ungegatete Testdatei(en) gefunden"). Ein eigener
  // Unterordner tests/rule40/ waere also nur mit einem vierten Eintrag in BLOCKING_GLOBS
  // moeglich gewesen — und diese Liste nagelt tests/scoring/bh-b09-dailyyml.test.js (BH-035)
  // auf drei Globs fest, in einer Sperrzone. Deshalb liegen die Dateien flach in tests/ und
  // heissen rule40-*: 'tests/*test.js' sammelt sie ein, ohne dass ein Waechter angefasst wird.
  const dateien = fs.readdirSync(path.join(REPO, 'tests'))
    .filter((f) => f.startsWith('rule40-') && f.endsWith('test.js'));
  assert.ok(dateien.length >= 4, 'erwartet mindestens vier rule40-Testdateien, gefunden ' + dateien.length);
  assert.match(gate, /BLOCKING_GLOBS = \['tests\/\*test\.js'/,
    "die blockierende Spur muss 'tests/*test.js' fuehren, sonst laufen diese Dateien nirgends");
  const fixture = path.join(REPO, 'tests', 'rule40-fixture.js');
  assert.ok(fs.existsSync(fixture), 'die Hilfsdatei fehlt');
  assert.ok(!fixture.endsWith('test.js'), 'die Hilfsdatei darf nicht wie eine Testdatei heissen');
});

test('BLOCKING_GLOBS bleibt unberuehrt (tests/scoring ist Sperrzone, BH-035 nagelt die Liste fest)', () => {
  assert.match(gate, /BLOCKING_GLOBS = \['tests\/\*test\.js', 'tests\/scoring\/\*test\.js', 'lib\/\*test\.js'\];/,
    'ein vierter Glob braeche tests/scoring/bh-b09-dailyyml.test.js (BH-035)');
});

test('der Schreiber liest dieselbe Snapshot-Naht wie der Haupt-Export', () => {
  // write-findash-export.js:175 loest den Snapshot-Ordner ueber FINDASH_SNAPSHOTS_DIR auf.
  // Wuerde dieses Brett die Naht nicht kennen, rechnete es nach einer Verlegung gegen eine
  // ANDERE Population als der Export — und niemand saehe es.
  const schreiber = fs.readFileSync(path.join(REPO, 'scripts', 'write-rule40-export.js'), 'utf8');
  const haupt = fs.readFileSync(path.join(REPO, 'scripts', 'write-findash-export.js'), 'utf8');
  assert.match(haupt, /FINDASH_SNAPSHOTS_DIR/, 'der Haupt-Export kennt die Naht nicht mehr — dann stimmt dieser Test nicht mehr');
  assert.match(schreiber, /process\.env\.FINDASH_SNAPSHOTS_DIR/);
});

bilanz('tests/rule40-ci-wiring.test.js');
