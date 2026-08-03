'use strict';
/**
 * tests/t564-datenkanal.test.js — Waechter fuer die Haertungen aus dem Tag-564-Review
 * des F-17a-Publish (oeffentlicher Datenkanal fuer Termin-Kalender + Bewegungs-Anzeige).
 *
 * Vier Befunde, alle mit Repro belegt, alle an einem gemeinsamen Fehlermuster:
 * der Kanal kann still das Falsche zeigen, ohne dass irgendwo etwas rot wird.
 *
 * T564-B2 (daily-pull.yml, Publish-Schritt): die Retry-Schleife holte den Remote-Stand
 *   erst ab Versuch 2 (`if [ "$i" -gt 1 ]`). Anders als bei den beiden Deploy-Schritten
 *   ist der _ghp-Klon hier NICHT frisch: zwischen Klonen und Publish liegen vier
 *   Schritte (Vintage schreiben, Wert-Gate, main-Commit, Publish). Ein parallel
 *   laufender Lauf (manuell + geplant, siehe R1-SK-003) haette schon im ERSTEN Versuch
 *   per Force-Push zurueckgerollt. -> Fetch+Reset muss unbedingt laufen, ohne Guard.
 *
 * T564-B1 (heartbeat.yml): die Frische-Sonde mass nur den v1-Export. Zwischen
 *   Board-Deploy und Vintage-Publish liegen vier Schritte; scheitert einer, bleibt der
 *   Export frisch, waehrend der Bewegungs-Kanal unbegrenzt lange alt steht — findash
 *   zeigt dann heutige Boards mit gestrigen Pfeilen. Zweite Sonde noetig.
 *
 * T564-B5 (mitgeloest in derselben Sonde): <2 Vintages im Kanal = die Bewegungs-Anzeige
 *   bleibt leer (findash vergleicht die zwei juengsten Staende). stage-public-data.js
 *   kann das nur als ::warning:: melden — kein Kanal, den Karl sieht.
 *
 * T564-B6 (daily-pull.yml, merge-Deploy): der Kalender-cp erbt ein `|| true`; faellt
 *   die frisch gestagete earnings-calendar.json aus, deployt der Schritt gruen ohne sie.
 *
 * T564-B4 (.gitignore): _public/ und _ghp/ sind Runner-Scratch und gehoeren nie ins Repo.
 *
 * Struktur-Test am OBJEKT (gleiche Bauart wie tests/scoring/h-ghpages-deploy-retry-test.js
 * und bh-b10-otheryml.test.js): geprueft wird der benannte Schritt, nicht die ganze Datei,
 * und Anwesenheit UND Abwesenheit. Jeder Check wurde durch Ausbau des Fixes rot gesehen.
 *
 * Run: node tests/t564-datenkanal.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const daily = lies(path.join('.github', 'workflows', 'daily-pull.yml'));
const heartbeat = lies(path.join('.github', 'workflows', 'heartbeat.yml'));
const gitignore = lies('.gitignore');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

/** Den Rumpf EINES benannten Workflow-Schritts schneiden (bis zum naechsten `- name:`). */
function schritt(text, startMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s >= 0, 'Schritt nicht gefunden: ' + startMarker);
  let e = text.indexOf('\n      - name:', s + startMarker.length);
  if (e < 0) e = text.length;
  return text.slice(s, e);
}

/** Der Koerper der `for i in 1 2 3; do ... done`-Schleife innerhalb eines Schritts. */
function schleifenKoerper(section) {
  const lines = section.split('\n');
  const body = [];
  let started = false;
  for (const line of lines) {
    if (!started) { if (line.includes('for i in 1 2 3; do')) started = true; continue; }
    if (line.trim() === 'done') break;
    body.push(line);
  }
  assert.ok(started, 'Retry-Schleife ("for i in 1 2 3; do") nicht gefunden');
  return body.join('\n');
}

// ── T564-B2: Publish-Schleife holt den Remote-Stand ab Versuch 1 ──────────────────
const publish = schritt(daily, 'name: Publish board-history vintages to public data channel (F-17a)');
const publishBody = schleifenKoerper(publish);

test('B2: der Publish-Schleifenkoerper holt und resettet gegen origin/gh-pages', () => {
  assert.match(publishBody, /git fetch origin gh-pages/,
    'kein "git fetch origin gh-pages" im Publish-Schleifenkoerper');
  assert.match(publishBody, /git reset --hard origin\/gh-pages/,
    'kein "git reset --hard origin/gh-pages" im Publish-Schleifenkoerper');
});

test('B2: Fetch+Reset haengen an KEINER Versuchszaehler-Bedingung (auch Versuch 1)', () => {
  const iFetch = publishBody.indexOf('git fetch origin gh-pages');
  const davor = publishBody.slice(0, iFetch);
  assert.ok(!/\$i"?\s*-gt\s*1/.test(davor),
    'Fetch/Reset stehen wieder hinter einem "$i -gt 1"-Guard — der minutenalte _ghp-Klon '
    + 'wuerde einen parallelen Lauf schon im ersten Versuch per Force-Push zurueckrollen.');
});

test('B2: Reihenfolge bleibt fetch/reset -> Kopie -> commit -> push', () => {
  const iReset = publishBody.indexOf('git reset --hard origin/gh-pages');
  const iCp = publishBody.indexOf('cp -r ../_public/board-history');
  const iCommit = publishBody.indexOf('git commit -m "deploy: board-history vintages');
  const iPush = publishBody.indexOf('git push --force origin gh-pages');
  assert.ok(iReset >= 0 && iCp > iReset && iCommit > iCp && iPush > iCommit,
    'Reihenfolge verletzt (reset=' + iReset + ' cp=' + iCp + ' commit=' + iCommit + ' push=' + iPush + ')');
});

// ── T564-B1/B5: zweite Frische-Sonde auf den Bewegungs-Kanal ──────────────────────
// Lazy geschnitten: fehlt der Schritt ganz, soll JEDER Check einzeln rot melden statt
// das Testmodul beim Laden abzubrechen (dann sieht man nur den ersten Befund).
const sonde = () => schritt(heartbeat, 'name: Check board-history channel freshness');

test('B1: die Sonde misst gh-pages outputs/board-history/index.json an dessen generated_at', () => {
  assert.match(sonde(), /gh-pages\/outputs\/board-history\/index\.json/,
    'die Sonde curlt nicht den publizierten board-history-Index');
  assert.match(sonde(), /generated_at/, 'die Sonde liest kein generated_at');
});

test('B1: veralteter Bewegungs-Kanal wird ROT (::error:: + exit 1), nicht nur ::warning::', () => {
  assert.match(sonde(), /::error::/, 'kein ::error:: — Karls einziger Kanal ist das rote X');
  assert.match(sonde(), /process\.exit\(1\)|exit 1/, 'die Sonde kann den Workflow nicht rot machen');
});

test('B1: KEIN Skew-Vergleich gegen den v1-Export (der Publish liegt konstruktionsbedingt dahinter)', () => {
  assert.ok(!/findash-export/.test(sonde()),
    'die Sonde vergleicht gegen den v1-Export — der Vintage-Publish liegt Minuten dahinter, '
    + 'das waere ein Dauer-Falschalarm.');
});

test('B5: weniger als 2 Vintages im Kanal wird ebenfalls rot (leere Bewegungs-Anzeige)', () => {
  assert.match(sonde(), /vintages/, 'die Sonde zaehlt die Vintages nicht');
  assert.match(sonde(), /<\s*2/, 'kein Mindest-Vintage-Check (<2) — eine leere Bewegungs-Anzeige bliebe still');
});

// ── T564-B6: der Kalender ueberlebt das `|| true` des merge-Deploy nicht still ────
const mergeDeploy = schleifenKoerper(schritt(daily, 'name: Deploy to GitHub Pages'));

test('B6: der merge-Deploy prueft das benannte Kalender-Artefakt nach der Kopie', () => {
  const iCp = mergeDeploy.indexOf('cp -r ../outputs/.');
  const iCheck = mergeDeploy.indexOf('outputs/earnings-calendar.json');
  assert.ok(iCp >= 0, 'die outputs-Kopie fehlt im Schleifenkoerper');
  assert.ok(iCheck > iCp,
    'nach dem `cp ... || true` steht keine Pruefung auf outputs/earnings-calendar.json — '
    + 'ein ausgefallener Kalender ginge gruen durch und findash zeigte still keine Termine.');
  const fenster = mergeDeploy.slice(iCheck, mergeDeploy.indexOf('git add -A', iCheck));
  assert.match(fenster, /exit 1/, 'die Kalender-Pruefung macht den Schritt nicht rot');
  assert.match(fenster, /::error::/, 'die Kalender-Pruefung meldet sich nicht in Karls Kanal');
});

// ── T564-B4: Runner-Scratch gehoert nicht ins Repo ────────────────────────────────
test('B4: .gitignore deckt _public/ und _ghp/ ab', () => {
  const zeilen = gitignore.split('\n').map((z) => z.trim());
  for (const eintrag of ['_public/', '_ghp/']) {
    assert.ok(zeilen.includes(eintrag), eintrag + ' fehlt in .gitignore (Runner-Scratch des F-17a-Publish)');
  }
});

console.log('\nt564-datenkanal.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
