'use strict';
/**
 * Tag 544 (Diagnose 03.08., .github/workflows/daily-pull.yml + monthly-sec-xbrl.yml).
 *
 * Befund: im Konflikt-Zweig der Commit-Retry-Schleifen stand ein cherry-pick-Fallback
 * ("Local commit lost or mutated during rebase"), der konstruktionsbedingt NIE feuern
 * konnte. Nach `git rebase --abort` steht HEAD wieder auf $COMMIT_SHA (also Ancestor
 * von sich selbst), und `git log -1 --format=%T "$COMMIT_SHA"` las den Baum EBEN DIESES
 * unveraenderlichen Commit-Objekts — nie den von HEAD. Beide Teile der Bedingung waren
 * damit immer falsch. Lokal reproduziert (echter Rebase-Konflikt: HEAD == COMMIT_SHA,
 * NEW_TREE == COMMIT_TREE, Zweig uebersprungen).
 *
 * Und selbst repariert haette der Zweig nichts gerettet: `git reset --hard origin/main`
 * + `git cherry-pick` wiederholt exakt den Drei-Wege-Merge, der gerade gescheitert ist —
 * gleicher Konflikt, exit 1, nur ohne den eigenen Commit im Workspace (ebenfalls
 * reproduziert). Der 43/43-Konflikt am 03.08. war also KEIN verpasster Rettungsfall:
 * Rotwerden ist die gewollte, datenerhaltende Reaktion, die Daten des ersten Schreibers
 * gewinnen (Tag 232c-7: bewusst kein `--strategy-option theirs`).
 *
 * Struktur-Test am OBJEKT: fuer JEDEN Konflikt-Zweig einer
 * `if ! git rebase --autostash origin/main; then`-Schleife in .github/workflows/ gilt
 * (a) `git rebase --abort` steht drin — das ist die datenerhaltende Handlung und darf
 *     nicht wegoptimiert werden, und
 * (b) weder `git cherry-pick` noch `git reset --hard origin/main` stehen drin — der tote
 *     Zweig bleibt weg und wird nicht "repariert" wieder eingebaut.
 * Anwesenheit UND Abwesenheit werden geprueft, und der Pruefer selbst wird an zwei
 * synthetischen Bloecken (gesunde Form muss durchgehen, wiederbelebter Fallback muss
 * auffliegen) gegengeprueft — sonst waere nicht gezeigt, dass er ueberhaupt rot werden
 * kann.
 *
 * Standalone runner (node <datei>, exit 0/1) — keine Netz-Zugriffe, nur die
 * ausgecheckten Workflow-Dateien.
 *
 * Run: node tests/scoring/h-commit-retry-abort-test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const WF_DIR = path.join(ROOT, '.github', 'workflows');
const START = 'if ! git rebase --autostash origin/main; then';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

/**
 * Schneidet die Konflikt-Zweige heraus: ab der `if ! git rebase …; then`-Zeile bis zum
 * `else`/`fi` auf DERSELBEN Einrueckung (der Zweig endet dort, verschachtelte else/fi
 * sind tiefer eingerueckt und beenden ihn nicht).
 */
function konfliktZweige(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const zweige = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(START)) continue;
    const einzug = lines[i].length - lines[i].trimStart().length;
    const body = [];
    let geschlossen = false;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      const e = lines[j].length - lines[j].trimStart().length;
      if ((t === 'else' || t === 'fi') && e === einzug) { geschlossen = true; break; }
      body.push(lines[j]);
    }
    assert.ok(geschlossen, 'Konflikt-Zweig ab Zeile ' + (i + 1) + ' wird nicht durch else/fi geschlossen');
    zweige.push({ zeile: i + 1, body: body.join('\n') });
  }
  return zweige;
}

/** Der eigentliche Pruefer — gibt die Liste der Verstoesse zurueck (leer = sauber). */
function verstoesse(body) {
  const code = body.split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))   // Kommentare raus: sie DUERFEN den toten
    .join('\n');                               // Zweig beschreiben, nur Code nicht.
  const out = [];
  if (!/git rebase --abort/.test(code)) out.push('kein "git rebase --abort" im Konflikt-Zweig');
  if (/git cherry-pick/.test(code)) out.push('"git cherry-pick"-Fallback im Konflikt-Zweig');
  if (/git reset --hard origin\/main/.test(code)) out.push('"git reset --hard origin/main" im Konflikt-Zweig');
  return out;
}

const dateien = fs.readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f));
assert.ok(dateien.length > 0, 'keine Workflow-Dateien gefunden — Checkout unvollstaendig?');

let zweigZahl = 0;
for (const f of dateien) {
  const text = fs.readFileSync(path.join(WF_DIR, f), 'utf8');
  for (const z of konfliktZweige(text)) {
    zweigZahl++;
    test(f + ':' + z.zeile + ' — Konflikt-Zweig haelt den Commit (abort) ohne cherry-pick/reset', () => {
      const v = verstoesse(z.body);
      assert.equal(v.join(' | '), '', f + ':' + z.zeile + ' — ' + v.join(' | '));
    });
  }
}

test('die Praemisse stimmt noch: es GIBT Commit-Retry-Schleifen mit Rebase-Konflikt-Zweig', () => {
  // Ohne diese Zeile waere der Test gruen, wenn jemand die Schleifen umbenennt oder
  // entfernt — er wuerde dann nichts mehr pruefen und das nicht merken.
  assert.ok(zweigZahl >= 3, 'nur ' + zweigZahl + ' Konflikt-Zweig(e) gefunden, erwartet >= 3 '
    + '(daily-pull Commit Snapshots + Vintage, monthly-sec-xbrl, smallcap-pull)');
});

test('Gegenprobe: der Pruefer laesst die gesunde Form durch und faengt den wiederbelebten Fallback', () => {
  const gesund = [
    '              if ! git rebase --autostash origin/main; then',
    '                # bei Konflikt bewusst rot — cherry-pick wuerde denselben Konflikt wiederholen',
    '                echo "::warning::Rebase failed"',
    '                git rebase --abort || true',
    '              else',
    '                COMMIT_SHA=$(git rev-parse HEAD)',
    '              fi',
  ].join('\n');
  const kaputt = [
    '              if ! git rebase --autostash origin/main; then',
    '                git rebase --abort || true',
    '                if ! git merge-base --is-ancestor "$COMMIT_SHA" HEAD; then',
    '                  git reset --hard origin/main',
    '                  git cherry-pick "$COMMIT_SHA" || { echo "::error::cherry-pick failed"; exit 1; }',
    '                fi',
    '              else',
    '                COMMIT_SHA=$(git rev-parse HEAD)',
    '              fi',
  ].join('\n');
  const ohneAbort = [
    '              if ! git rebase --autostash origin/main; then',
    '                echo "::warning::Rebase failed"',
    '              else',
    '                COMMIT_SHA=$(git rev-parse HEAD)',
    '              fi',
  ].join('\n');

  const zg = konfliktZweige(gesund);
  assert.equal(zg.length, 1, 'gesunder Block: Zweig nicht erkannt');
  assert.deepEqual(verstoesse(zg[0].body), [], 'gesunde Form wird faelschlich beanstandet');

  const zk = konfliktZweige(kaputt);
  assert.equal(zk.length, 1, 'kaputter Block: Zweig nicht erkannt');
  const vk = verstoesse(zk[0].body);
  assert.ok(vk.some((s) => s.includes('cherry-pick')), 'cherry-pick-Rueckfall wird NICHT gefangen');
  assert.ok(vk.some((s) => s.includes('reset --hard')), 'reset --hard origin/main wird NICHT gefangen');

  const zo = konfliktZweige(ohneAbort);
  assert.ok(verstoesse(zo[0].body).some((s) => s.includes('abort')),
    'fehlendes "git rebase --abort" wird NICHT gefangen — der Commit-Erhalt waere ungeschuetzt');
});

console.log('\nh-commit-retry-abort-test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
