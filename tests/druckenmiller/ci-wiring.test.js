'use strict';
/** tests/druckenmiller/ci-wiring.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG: die vier CI-Anker des Moduls sitzen dort, wo sie wirken — und der
 * scharfe Waechter kann einen Lauf wirklich rot machen.
 *
 * WARUM ALS TEST UND NICHT ALS KOMMENTAR (Anklage A1, Gericht 14.09.2026): die
 * Spezifikation hatte den Waechter unter `continue-on-error: true` gestellt. Ein solcher
 * Schritt schliesst mit "success" ab; jede Bruchprobe der Kette waere danach ein gruener
 * Haken gewesen. Diese Datei nagelt die Eigenschaft an der YAML fest, nicht an der Absicht.
 *
 * GEPRUEFT WIRD DIE STRUKTUR DER SCHRITTE, nicht ihr Wortlaut: aus der Workflow-Datei
 * werden die Schritt-Bloecke des merge-Jobs herausgeloest und einzeln befragt.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const YML = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'daily-pull.yml'), 'utf8').replace(/\r\n/g, '\n');
const ZEILEN = YML.split('\n');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}

/** Index der Zeile `      - name: <schritt>`. */
function schrittZeile(name) {
  const i = ZEILEN.findIndex((l) => l.trim() === '- name: ' + name);
  assert.ok(i >= 0, 'Schritt nicht gefunden: ' + name + ' — der Anker hat sich verschoben');
  return i;
}

/** Der Block eines Schritts: bis zur naechsten `- name:`-Zeile derselben Einrueckung. */
function block(name) {
  const start = schrittZeile(name);
  const einzug = ZEILEN[start].length - ZEILEN[start].trimStart().length;
  let ende = start + 1;
  while (ende < ZEILEN.length) {
    const l = ZEILEN[ende];
    const e = l.length - l.trimStart().length;
    if (l.trim().startsWith('- name:') && e <= einzug) break;
    if (l.trim() && e < einzug && !l.trim().startsWith('#')) break;
    ende++;
  }
  return ZEILEN.slice(start, ende).join('\n');
}

const LOGGER = 'Druckenmiller-Innereien mitschreiben (Chunk 0)';
const ARTEFAKT = 'Upload Druckenmiller-Ledger';

test('C1 der Logger sitzt direkt hinter update-ath-state.js (derselbe geladene Store)', () => {
  const ath = schrittZeile('Update ATH State (2.2)');
  const logger = schrittZeile(LOGGER);
  assert.ok(logger > ath, 'der Logger steht vor dem ATH-Schritt');
  const dazwischen = ZEILEN.slice(ath, logger).filter((l) => l.trim().startsWith('- name:'));
  assert.equal(dazwischen.length, 1, 'zwischen ATH-Fortschrieb und Logger steht ein weiterer Schritt');
  assert.match(block(LOGGER), /node scripts\/druckenmiller-log-internals\.js/);
});

test('C2 der Logger ist fail-soft — ein Mitschrieb haelt Karls Datenlauf nie an', () => {
  assert.match(block(LOGGER), /continue-on-error:\s*true/);
});

test('C3 KERN (A1): der PRUEFSCHRITT ist nicht fail-soft und kann den Lauf rot machen', () => {
  const i = ZEILEN.findIndex((l) => l.trim() === 'druckenmiller-guard:');
  assert.ok(i > 0, 'der Waechter-Job fehlt — dann kann keine Bruchprobe je einen Lauf rot faerben');
  const ende = ZEILEN.findIndex((l, k) => k > i && /^  [a-z0-9-]+:$/.test(l));
  const ohneKommentar = ZEILEN.slice(i, ende).filter((l) => !l.trim().startsWith('#'));
  const job = ohneKommentar.join(String.fromCharCode(10));
  assert.match(job, /needs:\s*scoring/);
  assert.match(job, /name:\s*druckenmiller-ledger/, 'der Job prueft nicht den transportierten Ledger');
  assert.match(job, /name:\s*druckenmiller-export/, 'der Job sieht die veroeffentlichte Seite nicht');
  // Der JOB darf kein continue-on-error tragen (das faengt jeden Schritt ab) …
  const jobKopf = ohneKommentar.slice(0, ohneKommentar.findIndex((l) => l.trim() === 'steps:'));
  assert.ok(!jobKopf.some((l) => l.includes('continue-on-error')),
    'continue-on-error am JOB macht jede Bruchprobe zu einem gruenen Haken');
  // … und der Pruefschritt selbst erst recht nicht. Der Artefakt-Abruf DARF es tragen:
  // fehlt das Export-Artefakt (Chunk 0 schreibt den Ordner noch nicht), ist das kein Befund.
  const pruef = block('Ledger pruefen (Kette, never-shrink, Luecken, Frische)');
  assert.match(pruef, /--check/);
  assert.ok(!/continue-on-error/.test(pruef),
    'der Pruefschritt steht unter continue-on-error — dann ist seine Schlussfolgerung IMMER '
    + 'success und keine Bruchprobe der Kette kann je einen Lauf rot faerben (Anklage A1).');
});
test('C4 der Waechter laeuft HINTER scoring — ein Alarm haelt Karls Boards nicht an', () => {
  const guard = ZEILEN.findIndex((l) => l.trim() === 'druckenmiller-guard:');
  const scoring = ZEILEN.findIndex((l) => l.trim() === 'scoring:');
  assert.ok(guard > scoring, 'der Waechter steht vor dem Scoring-Job');
  // Und im merge-Job steht KEIN scharfer --check: der wuerde ueber `needs: merge` den
  // ganzen Scoring-Job und damit den Board-Deploy mitnehmen.
  const mergeAnfang = ZEILEN.findIndex((l) => l.trim() === 'merge:');
  const mergeEnde = ZEILEN.findIndex((l, k) => k > mergeAnfang && /^  [a-z0-9-]+:$/.test(l));
  const mergeBlock = ZEILEN.slice(mergeAnfang, mergeEnde).join(String.fromCharCode(10));
  assert.ok(!/druckenmiller-log-internals\.js --check/.test(mergeBlock),
    'ein scharfer --check im merge-Job kostet bei jedem Befund den Board-Deploy');
});

test('C5 der Waechter-Job steht im laufstatus-Marker (sonst ist sein Ausfall unsichtbar)', () => {
  const i = ZEILEN.findIndex((l) => l.trim() === 'laufstatus:');
  assert.match(ZEILEN[i + 1], /druckenmiller-guard/, 'laufstatus haengt nicht am Waechter');
  const ps = fs.readFileSync(path.join(REPO, 'scripts', 'pipeline-status.js'), 'utf8');
  assert.match(ps, /'druckenmiller-guard'/,
    'pipeline-status.js kennt den Job nicht — er wirft dann bei jedem Lauf wegen Drift');
  assert.match(block('Deploy Scoring Output to GitHub Pages'), /if:\s*success\(\)/);
});

test('C6 eigenes Artefakt mit if-no-files-found: error, ohne den fail-soft-Handoff anzufassen', () => {
  const b = block(ARTEFAKT);
  assert.match(b, /if-no-files-found:\s*error/);
  assert.match(b, /druckenmiller-history\/internals-ledger\.jsonl/);
  const handoff = block('Upload merge→scoring handoff (ath-state + macro-regime + coverage-status)');
  assert.match(handoff, /if-no-files-found:\s*warn/,
    'die fail-soft-Semantik der drei fremden Dateien wurde mitverschaerft — das waere eine '
    + 'Aenderung ausserhalb dieses Moduls (Anklage A1, Punkt 4)');
  assert.ok(!/druckenmiller/.test(handoff), 'der Ledger haengt im gemeinsamen, stummen Artefakt');
  // Der Upload darf den merge-Job NICHT rot machen (er naehme ueber needs: merge den
  // Board-Deploy mit). Laut wird ein fehlender Ledger im Waechter-Job, dessen Abruf
  // nicht fail-soft ist — dort gehoert der Alarm hin.
  assert.match(b, /continue-on-error:\s*true/,
    'ein fehlender Ledger wuerde den merge-Job und damit Karls Board-Deploy anhalten');
  const abruf = block('Download Druckenmiller-Ledger');
  assert.ok(!/continue-on-error/.test(abruf.split('#').join('')),
    'faellt auch der Abruf im Waechter-Job weich aus, meldet ein fehlender Ledger nirgends mehr');
});

test('C7 der Vintage-Commit meldet druckenmiller-history/ mit an', () => {
  assert.match(block('Commit board-history vintage to main'),
    /if \[ -d druckenmiller-history \]; then git add druckenmiller-history\/; fi/);
});

test('C8 tests/druckenmiller/ laeuft in der BLOCKIERENDEN Spur des Test-Gates', () => {
  const gate = fs.readFileSync(path.join(REPO, 'scripts', 'test-gate.js'), 'utf8');
  const zeile = gate.split('\n').find((l) => l.includes('const BLOCKING_GLOBS'));
  assert.ok(zeile, 'BLOCKING_GLOBS nicht gefunden');
  assert.ok(zeile.includes("'tests/druckenmiller/*test.js'"),
    'die Testdateien des Moduls laufen in keinem Job — genau die Klasse, gegen die der '
    + 'Waechter in test-gate.js gebaut ist');
});

test('C9 kein Ignore-Muster verschluckt druckenmiller-history/', () => {
  const ig = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
  const treffer = ig.split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && /druckenmiller/.test(l));
  assert.deepEqual(treffer, [], 'die Reihe waere gitignored und stuerbe mit dem Runner');
});

console.log('\nci-wiring.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
