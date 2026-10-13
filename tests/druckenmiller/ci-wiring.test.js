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

/** Kommentarzeilen raus — ein Kommentar, der eine Eigenschaft BESCHREIBT, ist kein Beleg. */
const ohneKommentarzeilen = (text) => text.split(String.fromCharCode(10))
  .filter((l) => !l.trim().startsWith(String.fromCharCode(35))).join(String.fromCharCode(10));

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
  // Kommentarzeilen raus: der Nachbarschritt BESCHREIBT in seinem Kommentar ein altes
  // continue-on-error-Muster. Ohne diesen Filter war die Zusicherung unten von genau
  // diesem Fremdtext erfuellt — aufgefallen beim absichtlichen Bruch von C10.
  const b = ohneKommentarzeilen(block(ARTEFAKT));
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
  // Zeilenweise filtern, nicht das '#' wegwerfen: der Nachbarschritt begruendet in
  // seinem Kommentar, warum ER weich ausfaellt — der Text allein wuerde hier treffen.
  const abruf = ohneKommentarzeilen(block('Download Druckenmiller-Ledger'));
  assert.ok(!/continue-on-error/.test(abruf),
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

test('C10 KEIN Druckenmiller-Schritt im merge-Job kann den Lauf dort rot machen', () => {
  // Der teuerste Fehler waere nicht ein stiller Waechter, sondern ein lauter an der
  // falschen Stelle: merge rot -> scoring faellt aus (needs: merge, ohne always()) ->
  // Karls Boards werden nicht deployed. Eine Messreihe darf die Auslieferung nie anhalten.
  // Deshalb traegt JEDER Schritt dieses Moduls im merge-Job continue-on-error; der harte
  // Ausfall gehoert ausschliesslich in den Job druckenmiller-guard hinter scoring.
  const anfang = ZEILEN.findIndex((l) => l.trim() === 'merge:');
  const ende = ZEILEN.findIndex((l, k) => k > anfang && /^  [a-z0-9-]+:$/.test(l));
  const schritte = [];
  for (let i = anfang; i < ende; i++) {
    const t = ZEILEN[i].trim();
    if (t.startsWith('- name:')) schritte.push({ name: t.slice('- name:'.length).trim(), i });
  }
  const meine = schritte.filter((x) => /druckenmiller/i.test(x.name));
  assert.ok(meine.length >= 2, 'der Waechter findet die Schritte des Moduls nicht mehr: '
    + meine.map((x) => x.name).join(', '));
  for (const x of meine) {
    const b = block(x.name).split(String.fromCharCode(10))
      .filter((l) => !l.trim().startsWith('#')).join(String.fromCharCode(10));
    assert.match(b, /continue-on-error:\s*true/,
      'Schritt "' + x.name + '" kann den merge-Job rot machen — und nimmt damit scoring und '
      + 'Karls Board-Deploy mit. Der harte Ausfall gehoert in den Job druckenmiller-guard.');
  }
});

test('C11 REVIEW-FUND: der Waechter prueft auch, ob die Zeile auf main angekommen ist', () => {
  // Ohne diese Wache prueft der Job nur sein eigenes Artefakt. Ein Lauf ohne
  // Veroeffentlichung meldet dann gruen, waehrend der Handelstag nur im 7-Tage-Artefakt
  // existiert — und der naechste Lauf traegt ihn als backfilled nach, womit er dauerhaft
  // aus jedem Quantil faellt. Muster und Begruendung wie bei der M1/M9-Persistenz-Wache.
  const b = ohneKommentarzeilen(block('Ledger-Persistenz auf main pruefen'));
  assert.match(b, /VEROEFFENTLICHEN/, 'ohne das Ventil waere jeder Trockenlauf rot');
  assert.match(b, /origin\/main:druckenmiller-history\/internals-ledger\.jsonl/);
  assert.match(b, /::error::/);
  assert.ok(!/continue-on-error/.test(b),
    'eine Persistenz-Wache unter continue-on-error meldet nichts');
  assert.ok(schrittZeile('Ledger-Persistenz auf main pruefen')
    > schrittZeile('Ledger pruefen (Kette, never-shrink, Luecken, Frische)'),
  'die Persistenz-Wache muss NACH der Integritaets-Pruefung stehen');
});

test('C12 Chunk 1: schreiben und pruefen stehen hinter dem Vertrags-Tor und VOR dem Deploy', () => {
  const gate = schrittZeile('Verify findash-export v1 schema (contract gate)');
  const schreiben = schrittZeile('Druckenmiller-Export schreiben (fail-soft)');
  const pruefen = schrittZeile('Druckenmiller-Export pruefen (fail-soft, schreibt _FAILED.json)');
  const upload = schrittZeile('Upload Druckenmiller-Export (Waechter-Eingang)');
  const deploy = schrittZeile('Deploy Scoring Output to GitHub Pages');
  assert.ok(gate < schreiben && schreiben < pruefen,
    'geprueft wird vor dem Schreiben — dann prueft der Schritt den Stand von gestern');
  assert.ok(pruefen < upload,
    'der Waechter-Eingang wird hochgeladen, BEVOR der Pruefschritt laeuft — der Waechter bekaeme '
    + 'dann die Datendateien statt des _FAILED.json, das der Deploy tatsaechlich veroeffentlicht');
  assert.ok(upload < deploy, 'der Deploy laeuft vor dem Upload');
});

test('C13 KERN: beide Export-Schritte sind fail-soft — Karls Boards haengen nie an der Messreihe', () => {
  // `if: success()` am Deploy: ein roter Schritt hier wuerde die Boards zurueckhalten.
  // Der Vertrag wird trotzdem gehalten, weil der Pruefschritt selbst den _FAILED.json
  // schreibt, bevor er (weich) faellt.
  for (const name of ['Druckenmiller-Export schreiben (fail-soft)',
    'Druckenmiller-Export pruefen (fail-soft, schreibt _FAILED.json)']) {
    const b = ohneKommentarzeilen(block(name));
    assert.match(b, /\|\| true/, name + ' kann den scoring-Job rot machen und damit den Board-Deploy '
      + 'ueberspringen (Deploy traegt if: success())');
  }
  assert.match(block('Deploy Scoring Output to GitHub Pages'), /if:\s*success\(\)/,
    'die Annahme hinter dem fail-soft ist weg — dann duerfen die Schritte scharf sein');
});

test('C14 der Schreiber bekommt die Zeile von HEUTE (sonst veroeffentlicht er ewig gestern)', () => {
  // Der scoring-Job checkt den Trigger-Commit aus; die heutige Ledger-Zeile entsteht
  // erst im merge-Job. Ohne diesen Abruf stuende asOf jeden Tag auf gestern — gruen.
  const abruf = ohneKommentarzeilen(block('Download Druckenmiller-Ledger (Schreiber-Eingang)'));
  assert.match(abruf, /name:\s*druckenmiller-ledger/);
  assert.match(abruf, /path:\s*druckenmiller-history/);
  assert.match(abruf, /continue-on-error:\s*true/,
    'ein fehlgeschlagener Abruf wuerde den scoring-Job rot machen und die Boards anhalten');
  assert.ok(schrittZeile('Download Druckenmiller-Ledger (Schreiber-Eingang)')
    < schrittZeile('Druckenmiller-Export schreiben (fail-soft)'), 'der Abruf steht hinter dem Schreiben');
  // Und die Roh-Zeilen reisen mit: ohne die Datei von heute ist das 5-%-Churn-Tor
  // fuer genau die Sitzung blind, fuer die es gilt.
  assert.match(ohneKommentarzeilen(block(ARTEFAKT)), /druckenmiller-history\/raw\//,
    'das Ledger-Artefakt traegt die Roh-Zeilen des Tages nicht');
  const paths = ohneKommentarzeilen(block(ARTEFAKT)).split('\n').map((l) => l.trim());
  for (const file of ['candidates-ledger.jsonl', 'candidates-ledger.jsonl.meta.json']) {
    assert.ok(paths.includes('druckenmiller-history/' + file), 'missing candidate handoff: ' + file);
  }
});

test('C15 der scharfe Export-Check im Waechter-Job traegt KEIN continue-on-error', () => {
  const b = ohneKommentarzeilen(block('Druckenmiller-Export pruefen (scharf)'));
  assert.match(b, /write-druckenmiller-export\.js --check/);
  assert.ok(!/continue-on-error/.test(b), 'der scharfe Check faellt weich aus — dann prueft er nichts');
  assert.ok(!/\|\| true/.test(b), 'der scharfe Check schluckt seinen eigenen Exit-Code');
  // Er steht im Waechter-Job, nicht irgendwo — sonst faerbt sein Befund den falschen Job.
  const jobStart = ZEILEN.findIndex((l) => l.trim() === 'druckenmiller-guard:');
  const jobEnde = ZEILEN.findIndex((l, i) => i > jobStart && /^  [a-z-]+:$/.test(l));
  const zeile = schrittZeile('Druckenmiller-Export pruefen (scharf)');
  assert.ok(zeile > jobStart && zeile < jobEnde,
    'der scharfe Check steht ausserhalb des Waechter-Jobs');
});

console.log('\nci-wiring.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
