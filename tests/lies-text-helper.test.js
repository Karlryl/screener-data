'use strict';
/**
 * tests/lies-text-helper.test.js — Standalone-Runner (node tests/lies-text-helper.test.js, Exit 0/1).
 *
 * Pinnt den CRLF-toleranten Leser tests/helpers/lies-text.js (S22): dieselbe Datei mit
 * CRLF, LF und nacktem CR muss denselben String ohne '\r' liefern; ein aus einem
 * CRLF-Workflow-Ausschnitt per runBlock-Logik (wie tests/rank-ic-publish.test.js) gezogener
 * run:-Block muss ohne '\r' sein und in bash mit Status 0 laufen; `/^x$/m` muss auf dem
 * normalisierten Inhalt matchen. Die Gegenprobe (roher CRLF-Text) zeigt die Fehlerklasse,
 * gegen die der Helfer gebaut ist — laut, nie still.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { liesText, zeilen } = require('./helpers/lies-text.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

// runBlock-Logik wie tests/rank-ic-publish.test.js:31-38, nur mit uebergebenem Text.
function runBlock(yml, stepName) {
  const i = yml.indexOf(stepName);
  assert.ok(i > 0, stepName + ' nicht gefunden');
  const r = yml.indexOf('run: |', i);
  const rest = yml.slice(r + 'run: |'.length + 1);
  const lines = [];
  for (const l of rest.split('\n')) { if (l.trim() === '' || l.startsWith('          ')) lines.push(l.slice(10)); else break; }
  return lines.join('\n');
}

const STEP = 'name: Probe-Schritt (S22)';
const WF_LF = [
  'jobs:',
  '  probe:',
  '    steps:',
  '      - ' + STEP,
  '        run: |',
  '          set -e',
  '          echo "S22 Probe"',
  '          true',
  '      - name: Naechster Schritt',
  '        run: echo nein',
  '',
].join('\n');
const GI_LF = ['node_modules/', 'snapshots-eingang/', 'data/cache/', ''].join('\n');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lies-text-'));
try {
  const schreibe = (name, text, eol) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, text.replace(/\n/g, eol));
    return p;
  };
  const wfCrlf = schreibe('wf-crlf.yml', WF_LF, '\r\n');
  const wfLf = schreibe('wf-lf.yml', WF_LF, '\n');
  const wfCr = schreibe('wf-cr.yml', WF_LF, '\r');
  const giCrlf = schreibe('gitignore-crlf', GI_LF, '\r\n');

  check('H1 liesText: CRLF, LF und nacktes CR liefern denselben String ohne \\r', () => {
    assert.ok(/\r/.test(fs.readFileSync(wfCrlf, 'utf8')), 'Fixture CRLF traegt kein \\r — Probe wertlos');
    assert.ok(/\r/.test(fs.readFileSync(wfCr, 'utf8')), 'Fixture CR traegt kein \\r — Probe wertlos');
    const a = liesText(wfCrlf), b = liesText(wfLf), c = liesText(wfCr);
    assert.strictEqual(a, WF_LF);
    assert.strictEqual(b, WF_LF);
    assert.strictEqual(c, WF_LF);
    assert.ok(!/\r/.test(a) && !/\r/.test(b) && !/\r/.test(c), 'liesText darf kein \\r durchreichen');
  });

  check('H2 runBlock aus CRLF-Workflow via liesText: kein \\r, bash Status 0', () => {
    const block = runBlock(liesText(wfCrlf), STEP);
    assert.ok(!/\r/.test(block), 'run:-Block traegt noch \\r');
    assert.ok(block.includes('echo "S22 Probe"'), 'run:-Block unvollstaendig: ' + JSON.stringify(block));
    const r = spawnSync('bash', ['-c', block], { cwd: dir, encoding: 'utf8' });
    assert.ok(!r.error, 'bash nicht ausfuehrbar: ' + (r.error && r.error.message));   // laut, nie still
    assert.strictEqual(r.status, 0, 'bash-Status ' + r.status + ': ' + (r.stdout || '') + (r.stderr || ''));
  });

  check('H3 Gegenprobe: roher CRLF-Text reicht \\r in den run:-Block und bash bricht ab', () => {
    const roh = runBlock(fs.readFileSync(wfCrlf, 'utf8'), STEP);
    assert.ok(/\r/.test(roh), 'ohne Normalisierung muesste \\r im Block stehen — Fixture wertlos');
    const r = spawnSync('bash', ['-c', roh], { cwd: dir, encoding: 'utf8' });
    assert.ok(!r.error, 'bash nicht ausfuehrbar: ' + (r.error && r.error.message));
    assert.notStrictEqual(r.status, 0, 'bash haette am \\r scheitern muessen');
  });

  check('H4 /^snapshots-eingang\\/$/m matcht auf normalisiertem CRLF-Inhalt', () => {
    // Hinweis: JS zaehlt \r als Zeilenende, `$` im m-Modus matcht auch roh — der Helfer
    // macht den Match hier nur unabhaengig vom Zeilenende-Idiom, er repariert ihn nicht.
    assert.ok(/\r/.test(fs.readFileSync(giCrlf, 'utf8')), 'Fixture CRLF traegt kein \\r — Probe wertlos');
    assert.match(liesText(giCrlf), /^snapshots-eingang\/$/m);
    assert.ok(!/\r/.test(liesText(giCrlf)));
  });

  check('H5 zeilen(): CRLF und LF gemischt', () => {
    assert.deepStrictEqual(zeilen('a\r\nb\nc'), ['a', 'b', 'c']);
    assert.deepStrictEqual(zeilen(''), ['']);
    assert.deepStrictEqual(zeilen('x\r\n'), ['x', '']);
  });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(fail ? `\n${fail} FAIL` : '\nlies-text-helper: alle Pruefungen ok');
process.exit(fail ? 1 : 0);
