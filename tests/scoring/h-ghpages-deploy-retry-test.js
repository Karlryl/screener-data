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

function workflowRunSteps(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const steps = [];
  let inJobs = false;
  let job = null;
  let step = null;
  let runIndent = null;
  for (const raw of lines) {
    const indent = raw.match(/^ */)[0].length;
    const trimmed = raw.trim();
    if (runIndent !== null && step) {
      if (indent > runIndent) { step.run += raw.slice(runIndent + 2) + '\n'; continue; }
      runIndent = null;
    }
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (indent === 0) { inJobs = trimmed === 'jobs:'; job = null; }
    if (!inJobs) continue;
    const jobMatch = indent === 2 && trimmed.match(/^([A-Za-z0-9_-]+):$/);
    if (jobMatch) { job = jobMatch[1]; step = null; continue; }
    const start = indent === 6 && trimmed.match(/^-(?:\s+)(name|run):\s*(.*)$/);
    if (job && start) {
      step = { job, name: null, if: null, run: '' };
      steps.push(step);
      if (start[1] === 'name') step.name = start[2].trim();
      if (start[1] === 'run') step.run = start[2].trim() + '\n';
      continue;
    }
    if (!step || indent !== 8) continue;
    const field = trimmed.match(/^(name|if|run):\s*(.*)$/);
    if (!field) continue;
    if (field[1] === 'name') step.name = field[2].trim();
    if (field[1] === 'if') step.if = field[2].trim();
    if (field[1] === 'run') {
      if (['|', '|-', '|+', '>', '>-'].includes(field[2].trim())) runIndent = indent;
      else step.run = field[2].trim() + '\n';
    }
  }
  return steps;
}

// Literal tote Shell-Zweige sind kein Verhalten. Verschachtelte ifs innerhalb des
// toten Zweigs werden mitgezaehlt, damit ihre `fi`-Zeilen den Zweig nicht zu frueh oeffnen.
function reachableShell(text) {
  const out = [];
  let deadDepth = 0;
  for (const line of text.split('\n')) {
    const code = line.replace(/\s+#.*$/, '').trim();
    if (/^if\s+(?:false|\[\s+"?0"?\s+=\s+"?1"?\s+\])\s*;?\s*then\b/.test(code)) { deadDepth++; continue; }
    if (deadDepth) {
      const opens = (code.match(/\bif\b[^;]*;?\s*then\b/g) || []).length;
      const closes = (code.match(/\bfi\b/g) || []).length;
      deadDepth += opens - closes;
      continue;
    }
    if (!deadDepth) out.push(line);
  }
  return out.join('\n');
}

function deployStep(job, name) {
  const found = workflowRunSteps(yml).filter((s) => s.job === job && s.name === name);
  assert.equal(found.length, 1, `${job}/${name}: genau ein Workflow-Step erwartet`);
  assert.ok(!/^false$|^\$\{\{\s*false\s*\}\}$/i.test(found[0].if || ''), `${job}/${name}: Step deaktiviert`);
  return found[0];
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

test('aktive Deploy-Step-Objekte enthalten den kompletten erreichbaren Retry-Zyklus; if-false-Attrappen zaehlen nicht', () => {
  const cases = [
    [deployStep('merge', 'Deploy to GitHub Pages'), 'cp ../index.html', 'git commit -m "deploy: screener reports', 'git push --force origin gh-pages'],
    [deployStep('scoring', 'Deploy Scoring Output to GitHub Pages'), 'cp ../outputs/hypergrowth', 'git commit -m "deploy: hypergrowth scoring', 'git push --force origin gh-pages'],
  ];
  for (const [step, copy, commit, push] of cases) {
    const body = loopBody(reachableShell(step.run));
    const positions = [
      body.indexOf('git fetch origin gh-pages'),
      body.indexOf('git reset --hard origin/gh-pages'),
      body.indexOf(copy),
      body.indexOf(commit),
      body.indexOf(push),
    ];
    assert.ok(positions.every((n) => n >= 0), `${step.job}/${step.name}: erreichbarer Retry-Zyklus unvollstaendig: ${positions.join(',')}`);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, `${step.job}/${step.name}: erreichbare Retry-Reihenfolge verletzt`);
  }
});

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
    // T571-SIB (Sibling von T568-F3): ohne diesen Guard liefert indexOf() bei fehlendem
    // `git push` eine -1, und slice(i, -1) schneidet dann bis zum VORLETZTEN Zeichen der
    // Datei — das Fenster waere plötzlich der halbe Workflow und beide Zusicherungen unten
    // wuerden irgendwo anders fuendig. Derselbe -1-Slice-Defekt, dieselbe Bugklasse.
    const iEnd = body.indexOf('git push', i);
    assert.ok(iEnd > i,
      name + '-Deploy: kein `git push` hinter der Leer-Pruefung — das Entscheidungs-Fenster ist nicht abgrenzbar');
    const fenster = body.slice(i, iEnd);
    assert.ok(/exit 0/.test(fenster), name + '-Deploy: erwartete ein exit 0 am leeren Diff');
    assert.match(fenster, /\$i"?\s*-eq\s*1|"\$i"\s*=\s*"1"/,
      name + '-Deploy: das exit 0 am leeren Diff haengt an KEINER Versuchszaehler-Bedingung — '
      + 'ein fehlgeschlagener Push wuerde ab Versuch 2 gruen ausgehen, ohne zu deployen');
  }
});

console.log('\nh-ghpages-deploy-retry-test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
