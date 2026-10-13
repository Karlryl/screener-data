'use strict';
/** tests/smallcap-store-artifact-wiring.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG (T135 Option B, 21.09.2026): das Artefakt `smallcap-store-merged` aus
 * smallcap-pull.yml ist DIESELBE Population, die der Scoring-Job von daily-pull.yml liest.
 * Drei Stellen muessen zusammenpassen: der Cache-Save (Pfad + Key), der Artefakt-Upload (Pfad)
 * und der Restore im Tageslauf (Pfad + restore-keys-Praefix). Wandert eine davon, misst die
 * Paritaetsluecke still eine andere Population als das Board.
 * Liest die Dateien als TEXT (wie rule40-ci-wiring.test.js); geprueft werden genau diese Schritte.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const wf = (n) => fs.readFileSync(path.join(REPO, '.github', 'workflows', n), 'utf8');

// Schritt-Block ab "- name: <titel>" bis zum naechsten "- name:" gleicher Einrueckung oder Dateiende.
function schritt(text, titel) {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => /^\s*- name: /.test(l) && l.includes(titel));
  if (i < 0) return null;
  const indent = lines[i].indexOf('- name:');
  let j = i + 1;
  while (j < lines.length && !(lines[j].indexOf('- name:') === indent && /^\s*- name: /.test(lines[j]))) j++;
  return lines.slice(i, j).join('\n');
}
const feld = (block, key) => { const m = block && block.match(new RegExp('^[ ]+' + key + ':[ ]*(.+?)[ ]*$', 'm')); return m ? m[1] : null; };

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

function pruefe(sp, daily) {
  const save = schritt(sp, 'Save merged small-cap store');
  const up = schritt(sp, 'Upload merged small-cap store');
  const restore = schritt(daily, 'Restore Small-Cap Store');
  assert.ok(save, 'Cache-Save-Schritt fehlt in smallcap-pull.yml');
  assert.ok(up, 'Artefakt-Upload-Schritt fehlt in smallcap-pull.yml');
  assert.ok(restore, 'Restore-Schritt fehlt in daily-pull.yml');
  assert.equal(feld(up, 'name'), 'smallcap-store-merged', 'Artefakt-Name weicht ab');
  assert.equal(feld(up, 'retention-days'), '3', 'Aufbewahrung weicht ab');
  assert.equal(feld(up, 'path'), feld(save, 'path'), 'Upload-Pfad ist nicht der gespeicherte Store');
  assert.equal(feld(up, 'path'), feld(restore, 'path'), 'Upload-Pfad ist nicht, was das Scoring liest');
  const prefix = (restore.match(/restore-keys:\s*\|\s*\n\s*(\S+)/) || [])[1];
  assert.ok(prefix, 'restore-keys-Praefix nicht gefunden');
  assert.ok(feld(save, 'key').startsWith(prefix), `Save-Key ${feld(save, 'key')} passt nicht zum Restore-Praefix ${prefix}`);
  // Reihenfolge: der Upload kommt NACH dem Save (derselbe gemergte Stand).
  assert.ok(sp.indexOf(up) > sp.indexOf(save), 'Upload steht vor dem Save');
}

const SP = wf('smallcap-pull.yml'), DAILY = wf('daily-pull.yml');
test('Artefakt = gespeicherter Store = gelesener Store (Pfad, Key-Praefix, Name, Aufbewahrung)', () => pruefe(SP, DAILY));
test('Gegenprobe: verschobener Upload-Pfad wird rot', () => {
  const kaputt = SP.replace(/(name: smallcap-store-merged\n\s+path: )snapshots-smallcap/, '$1snapshots');
  assert.notEqual(kaputt, SP, 'Mutation hat nichts veraendert');
  assert.throws(() => pruefe(kaputt, DAILY), /Upload-Pfad/);
});
test('Gegenprobe: anderer Restore-Praefix im Tageslauf wird rot', () => {
  const kaputt = DAILY.replace(/restore-keys: \|\n(\s+)snapshots-smallcap-store-/, 'restore-keys: |\n$1andere-population-');
  assert.notEqual(kaputt, DAILY, 'Mutation hat nichts veraendert');
  assert.throws(() => pruefe(SP, kaputt), /Restore-Praefix/);
});

console.log(`\nsmallcap-store-artifact-wiring.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
