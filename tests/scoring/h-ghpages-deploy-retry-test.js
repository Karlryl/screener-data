'use strict';
/**
 * R1-SK-003 (Hard Review 2026-08-02, .github/workflows/daily-pull.yml).
 *
 * Befund: geplante Laeufe teilen sich die Concurrency-Gruppe 'main-push', manuelle
 * Laeufe bekommen aber eine eindeutige Gruppe pro Run (Zeile ~48-50) — ein manueller
 * und ein geplanter Lauf koennen also gleichzeitig laufen. Die beiden gh-pages-Deploy-
 * Schritte ("Deploy to GitHub Pages" im merge-Job, "Deploy Scoring Output to GitHub
 * Pages" im scoring-Job) bauten VOR der Retry-Schleife genau EINEN lokalen Commit und
 * versuchten dann bis zu dreimal denselben `git push --force` — ohne vor einem
 * Wiederholungsversuch neu vom Remote zu holen. Ein spaeter startender, aber frueher
 * fertiger Lauf konnte so den Stand des jeweils anderen Laufs mit einem veralteten
 * Commit ueberschreiben (Force-Push kennt keine Fast-Forward-Pruefung).
 *
 * Fix: in beiden Deploy-Schritten wird vor JEDEM Versuch ausser dem ersten neu vom
 * Remote geholt (git fetch + reset --hard origin/gh-pages) und erst DANACH werden die
 * eigenen Dateien erneut kopiert, committet und gepusht — der komplette
 * Kopieren-Committen-Pushen-Zyklus liegt jetzt INNERHALB der Retry-Schleife, nicht nur
 * der Push. Gleiches fetch-vor-jedem-Versuch-Prinzip wie der bereits bestehende
 * retry-rebase-Loop im "Commit Snapshots"-Schritt derselben Datei (main-Branch).
 *
 * Struktur-Test am OBJEKT: prueft je Deploy-Schritt, dass (a) der Commit NICHT mehr
 * vor der Schleife liegt, sondern innerhalb, (b) innerhalb der Schleife vor jedem
 * Wiederholungsversuch ein Fetch+Reset gegen origin/gh-pages steht, und (c) die
 * Reihenfolge innerhalb EINES Schleifendurchlaufs fetch/reset -> Datei-Kopie ->
 * commit -> push ist. Ein Zuruecknehmen des Fixes (Kopie/Commit wieder vor die
 * Schleife, kein Fetch/Reset) laesst diesen Test rot werden — verifiziert per
 * Revert+Re-Run (siehe Bericht).
 *
 * Standalone runner (node <datei>, exit 0/1) — keine Netz-Zugriffe, nur lokales
 * Dateisystem (die ausgecheckte Workflow-Datei).
 *
 * Run: node tests/scoring/h-ghpages-deploy-retry-test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const YML_PATH = path.join(ROOT, '.github', 'workflows', 'daily-pull.yml');
// CRLF (Windows-Checkout) auf \n normalisieren — sonst matchen \n-Marker nicht.
const yml = fs.readFileSync(YML_PATH, 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

function stepSection(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s >= 0, 'Schritt nicht gefunden: ' + startMarker);
  const from = s + startMarker.length;
  const e = endMarker ? text.indexOf(endMarker, from) : text.length;
  assert.ok(!endMarker || e > s, 'End-Marker nicht gefunden: ' + endMarker);
  return text.slice(s, e < 0 ? text.length : e);
}

// Extrahiert den Koerper der "for i in 1 2 3; do ... done"-Schleife (zeilenweise,
// unabhaengig von der genauen Einrueckung).
function loopBody(section) {
  const lines = section.split('\n');
  const body = [];
  let started = false;
  for (const line of lines) {
    if (!started) {
      if (line.includes('for i in 1 2 3; do')) started = true;
      continue;
    }
    if (line.trim() === 'done') break;
    body.push(line);
  }
  assert.ok(started, 'Retry-Schleife ("for i in 1 2 3; do") nicht gefunden');
  return body.join('\n');
}

function checkDeployStep(stepName, nextMarker, commitPrefix, pushLine) {
  const section = stepSection(yml, stepName, nextMarker);
  const loopStart = section.indexOf('for i in 1 2 3; do');
  assert.ok(loopStart >= 0, stepName + ': Retry-Schleife fehlt');

  // (a) Vor der Schleife darf kein Commit mehr stehen — sonst wird bei jedem Retry
  // derselbe alte lokale Commit wiederverwendet statt neu gebaut.
  const beforeLoop = section.slice(0, loopStart);
  assert.ok(!beforeLoop.includes('git commit -m "' + commitPrefix),
    stepName + ': "git commit" steht noch VOR der Retry-Schleife — Retries wuerden denselben veralteten Commit wiederverwenden (R1-SK-003-Defekt).');

  const body = loopBody(section);

  // (b) Fetch+Reset gegen origin/gh-pages muss im Schleifenkoerper stehen — sonst
  // baut ein Wiederholungsversuch auf einem veralteten lokalen Checkout auf und kann
  // einen zwischenzeitlich erfolgreichen Parallel-Lauf blind ueberschreiben.
  assert.match(body, /git fetch origin gh-pages/, stepName + ': kein "git fetch origin gh-pages" im Schleifenkoerper');
  assert.match(body, /git reset --hard origin\/gh-pages/, stepName + ': kein "git reset --hard origin/gh-pages" im Schleifenkoerper');

  // (c) Commit und Push muessen INNERHALB der Schleife liegen, in dieser Reihenfolge,
  // nach Fetch/Reset — sonst ist der Zyklus nicht wirklich pro Versuch neu gebaut.
  const iFetch = body.indexOf('git fetch origin gh-pages');
  const iReset = body.indexOf('git reset --hard origin/gh-pages');
  const iCommit = body.indexOf('git commit -m "' + commitPrefix);
  const iPush = body.indexOf(pushLine);
  assert.ok(iCommit >= 0, stepName + ': kein "git commit" im Schleifenkoerper');
  assert.ok(iPush >= 0, stepName + ': kein "' + pushLine + '" im Schleifenkoerper');
  assert.ok(iFetch < iReset && iReset < iCommit && iCommit < iPush,
    stepName + ': Reihenfolge im Schleifenkoerper verletzt (fetch=' + iFetch + ' reset=' + iReset + ' commit=' + iCommit + ' push=' + iPush + ')');

  // Fetch/Reset duerfen nicht bedingungslos vor Versuch 1 laufen (kein bestehender
  // Remote-Stand zum Zuruecksetzen bei einem frisch initialisierten Branch) — die
  // Absicherung ist der `$i" -gt 1`-Guard direkt vor dem Fetch.
  assert.match(body.slice(0, iFetch), /"\$i"\s*-gt\s*1/,
    stepName + ': Fetch/Reset ist nicht auf Versuch > 1 begrenzt');
}

test('Deploy to GitHub Pages (merge-Job): Fetch+Reset vor jedem Retry, Commit/Push im Schleifenkoerper', () => {
  checkDeployStep(
    'name: Deploy to GitHub Pages',
    '\n      - name:',
    'deploy: screener reports',
    'git push --force origin gh-pages'
  );
});

test('Deploy Scoring Output to GitHub Pages (scoring-Job): Fetch+Reset vor jedem Retry, Commit/Push im Schleifenkoerper', () => {
  checkDeployStep(
    'name: Deploy Scoring Output to GitHub Pages',
    '\n      - name:',
    'deploy: hypergrowth scoring',
    'git push --force origin gh-pages'
  );
});

test('Beide Deploy-Schritte kopieren ihre Dateien innerhalb der Schleife, vor dem Commit', () => {
  const merge = stepSection(yml, 'name: Deploy to GitHub Pages', '\n      - name:');
  const mergeBody = loopBody(merge);
  const iCp = mergeBody.indexOf('cp ../index.html');
  const iCommit = mergeBody.indexOf('git commit -m "deploy: screener reports');
  assert.ok(iCp >= 0 && iCp < iCommit, 'merge-Deploy: Datei-Kopie fehlt im Schleifenkoerper oder liegt nach dem Commit');

  const scoring = stepSection(yml, 'name: Deploy Scoring Output to GitHub Pages', '\n      - name:');
  const scoringBody = loopBody(scoring);
  const iCp2 = scoringBody.indexOf('cp ../outputs/hypergrowth');
  const iCommit2 = scoringBody.indexOf('git commit -m "deploy: hypergrowth scoring');
  assert.ok(iCp2 >= 0 && iCp2 < iCommit2, 'scoring-Deploy: Datei-Kopie fehlt im Schleifenkoerper oder liegt nach dem Commit');
});

test('kein gruener Deploy-Job ohne Deploy: die Leer-Pruefung steigt nur im ERSTEN Versuch aus', () => {
  // Nachgetragen 02.08. nach einem Review-Fund am eigenen Retry-Umbau. Mit dem
  // Leer-Check IN der Schleife entstand ein neuer stiller Ausfall: schlaegt Versuch 1 beim
  // Push fehl und Versuch 2 beim `git fetch` (dieselbe Netzstoerung), steht der eigene,
  // ungepushte Commit noch auf HEAD -> Neu-Kopieren erzeugt keinen Diff -> `exit 0`
  // -> Job GRUEN, gh-pages nie aktualisiert. Der schlimmste Ausgang, weil ihn niemand meldet.
  // Geprueft wird die Sache: JEDES `exit 0` am leeren Diff muss an einer Versuchszaehler-
  // Bedingung haengen, nicht nur an der Leere.
  const bodies = [
    ['merge', loopBody(stepSection(yml, 'name: Deploy to GitHub Pages', '\n      - name:'))],
    ['scoring', loopBody(stepSection(yml, 'name: Deploy Scoring Output to GitHub Pages', '\n      - name:'))],
  ];
  for (const [name, body] of bodies) {
    const i = body.indexOf('git diff --staged --quiet');
    assert.ok(i >= 0, name + '-Deploy: Leer-Pruefung nicht gefunden');
    // Das Fenster bis zum naechsten `git push` enthaelt die Entscheidung.
    const fenster = body.slice(i, body.indexOf('git push', i));
    assert.ok(/exit 0/.test(fenster), name + '-Deploy: erwartete ein exit 0 am leeren Diff');
    assert.match(fenster, /\$i"?\s*-eq\s*1|"\$i"\s*=\s*"1"/,
      name + '-Deploy: das exit 0 am leeren Diff haengt an KEINER Versuchszaehler-Bedingung — '
      + 'ein fehlgeschlagener Push wuerde ab Versuch 2 gruen ausgehen, ohne zu deployen');
  }
});

console.log('\nh-ghpages-deploy-retry-test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
