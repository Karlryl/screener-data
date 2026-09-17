'use strict';
/** tests/rule40/ci-wiring.test.js — Standalone-Runner.
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

const REPO = path.resolve(__dirname, '..', '..');
const { laeufer } = require('./fixture.js');
const { test, bilanz } = laeufer();

const daily = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'daily-pull.yml'), 'utf8');
const prCheck = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'pr-check.yml'), 'utf8');
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

test('der PR-Check faehrt die Tests dieses Bretts SCHARF (kein || true)', () => {
  assert.match(prCheck, /name: rule40-Tests/, 'ohne den Schritt laeuft hier nichts');
  const block = prCheck.slice(prCheck.indexOf('name: rule40-Tests'));
  const ende = block.indexOf('\n      - name:', 1);
  const schritt = ende > -1 ? block.slice(0, ende) : block;
  assert.match(schritt, /tests\/rule40\/\*test\.js/);
  assert.match(schritt, /node "\$f"/);
  assert.ok(!/\|\| true/.test(schritt), 'der Testschritt darf NICHT fail-soft sein');
  assert.match(schritt, /::error::keine tests\/rule40/, 'ein leerer Treffer muss laut sein, nicht still gruen');
});

test('BLOCKING_GLOBS bleibt unberuehrt (tests/scoring ist Sperrzone, BH-035 nagelt die Liste fest)', () => {
  assert.match(gate, /BLOCKING_GLOBS = \['tests\/\*test\.js', 'tests\/scoring\/\*test\.js', 'lib\/\*test\.js'\];/,
    'ein vierter Glob braeche tests/scoring/bh-b09-dailyyml.test.js (BH-035) — ein gesperrter Waechter');
});

bilanz('tests/rule40/ci-wiring.test.js');
