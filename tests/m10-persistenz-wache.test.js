'use strict';
/** tests/m10-persistenz-wache.test.js — Standalone-Runner (node tests/m10-persistenz-wache.test.js).
 *
 * DIE ZUSICHERUNG, an der SACHE festgenagelt:
 *   Die beiden Dateien, die der Tageslauf fuer M1 und M9 schreibt, erreichen den
 *   VEROEFFENTLICHTEN Commit — und wenn sie es nicht tun, ist der Lauf ROT.
 *     data-health/namensherkunft-history.json  (M1, "Persistenzstelle")
 *     data-health/identitaets-tripwire.json    (M9, "Der Bericht wird COMMITTET")
 *   Urteil: _COURT-M10-2026-08-30, Auftrag ENTSCHIED 131.
 *
 * BEFUND, DER DIESEN WAECHTER AUSGELOEST HAT (30.08.2026, zwei widersprechende
 * Behauptungen, hier GEMESSEN statt entschieden):
 *   Beide Dateien werden von scripts/filter-snapshot-merge.js geschrieben — im MERGE-Job
 *   (daily-pull.yml, Schritt "F-12 Karteileichen-Filter"), nicht im scoring-Job. Der
 *   merge-Job meldet blank per `git add -A` an, kein Ignore-Muster fasst data-health/ an,
 *   also kommen beide an. Die zweite Behauptung ("nur p99-delta-history.json wird
 *   gestaged") las die GEZIELTE Anmeldung des scoring-Jobs — ein anderer Job auf einem
 *   anderen Runner, der die Schreibvorgaenge des merge-Jobs nie sieht.
 *   Es gab also keine Luecke. Ungeprueft blieb die Zusage trotzdem: sie haengt an einem
 *   blanken `git add -A`, und genau dessen Verengung waere lautlos.
 *
 * WARUM DIESER TEST DEN ECHTEN BLOCK FAEHRT statt Text zu pruefen: die Frage "kommt die
 * Datei im Commit an?" ist eine Frage an git, nicht an den Wortlaut der YAML. Der
 * "Commit Snapshots"-Block wird aus der Workflow-Datei herausgeloest und gegen ein
 * Fixture-Remote gefahren; danach wird der ebenfalls herausgeloeste Wache-Block gefahren.
 * ANWESENHEIT UND ABWESENHEIT: der gute Fall muss gruen sein, drei kaputte Faelle rot.
 *
 * ZWEI STAERKEN, NIE EIN STILLER SKIP (Muster: tests/alarm-tagesgrenze.test.js): ohne bash
 * im PATH (Karls Windows-Kiste) laufen nur die Struktur-Bloecke, und die Stufe wird
 * ausgedruckt. Im CI (ubuntu) laeuft alles.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const WF = path.join(REPO, '.github', 'workflows', 'daily-pull.yml');
const YML = fs.readFileSync(WF, 'utf8');

const COMMIT_SCHRITT = 'Commit Snapshots';
const WACHE_SCHRITT = 'M1/M9-Persistenz pruefen (nach dem Commit)';
const M1 = 'data-health/namensherkunft-history.json';
const M9 = 'data-health/identitaets-tripwire.json';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}

/** Index der Zeile `      - name: <schritt>` in der Workflow-Datei. */
function schrittZeile(schritt) {
  const z = YML.split('\n');
  const i = z.findIndex((l) => l.trim() === '- name: ' + schritt);
  assert.ok(i > 0, 'Schritt nicht gefunden (umbenannt?): ' + schritt);
  return i;
}

/** Den `run: |`-Block eines Schritts herausloesen und auf Spalte 0 ausruecken. */
function runBlock(schritt) {
  const z = YML.split('\n');
  let i = schrittZeile(schritt);
  while (i < z.length && !/^\s*run: \|\s*$/.test(z[i])) i++;
  assert.ok(i < z.length, 'kein `run: |`-Block in Schritt ' + schritt);
  const einr = z[i + 1].match(/^\s*/)[0].length;
  const out = [];
  for (let k = i + 1; k < z.length; k++) {
    if (z[k].trim() === '') { out.push(''); continue; }
    if (z[k].match(/^\s*/)[0].length < einr) break;
    out.push(z[k].slice(einr));
  }
  return out.join('\n');
}

// ── STRUKTUR (laeuft immer) ───────────────────────────────────────────────────

test('S1: die Wache steht im SELBEN Job und NACH dem Commit-Schritt', () => {
  // Eine Wache in einem anderen Job saehe einen anderen Arbeitsbaum (frischer Checkout,
  // ohne die data-health/-Schreibvorgaenge dieses Laufs) und waere damit blind — genau
  // die Verwechslung, aus der der widersprechende Befund entstand. Eine Wache VOR dem
  // Commit prueft einen Zustand, den der Commit erst noch herstellt.
  const c = schrittZeile(COMMIT_SCHRITT);
  const w = schrittZeile(WACHE_SCHRITT);
  assert.ok(w > c, 'die Wache steht VOR dem Commit-Schritt — sie prueft dann nichts.');
  const dazwischen = YML.split('\n').slice(c, w).filter((l) => /^ {2}[a-z][a-z0-9_-]*:$/.test(l));
  assert.deepEqual(dazwischen, [],
    'zwischen Commit und Wache beginnt ein neuer Job (' + dazwischen.join(', ') + ') — ' +
    'die Wache liefe auf einem fremden Arbeitsbaum.');
});

test('S2: die Wache ist nicht entschaerft (kein continue-on-error, beide Dateien genannt)', () => {
  const z = YML.split('\n');
  const w = schrittZeile(WACHE_SCHRITT);
  const kopf = z.slice(w, w + 4).join('\n');
  assert.doesNotMatch(kopf, /continue-on-error/,
    'continue-on-error macht aus dem roten X eine Notiz in einem gruenen Job — Karls ' +
    'Alarmkanal ist das rote X, sonst nichts.');
  const block = runBlock(WACHE_SCHRITT);
  for (const f of [M1, M9]) {
    assert.ok(block.includes(f), 'die Wache nennt ' + f + ' nicht — sie prueft sie dann auch nicht.');
  }
});

// ── VERHALTEN: der ECHTE Block gegen ein Fixture-Remote ───────────────────────

const hatBash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;
console.log('       Stufe: ' + (hatBash ? 'voll (echter Block gegen Fixture-Remote)' : 'nur Struktur (kein bash im PATH)'));

const sh = (cmd, cwd) => {
  const r = spawnSync('bash', ['-lc', cmd], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(cmd + '\n' + r.stdout + r.stderr);
  return r.stdout.trim();
};

/**
 * Baut den Tageslauf-Zustand nach: Fixture-Remote + Arbeitsbaum mit der ECHTEN .gitignore
 * des Repos (die Frage "greift ein Ignore-Muster?" wird gemessen, nicht geglaubt), darin
 * die drei data-health-Dateien, die der Lauf schreibt, und ein gitignoriertes snapshots/.
 * `zusatzIgnore` und `blockErsatz` sind die Sabotage-Schrauben.
 */
function sandkasten({ zusatzIgnore = '', schreibeM1M9 = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm10persist-'));
  const remote = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  fs.mkdirSync(remote); fs.mkdirSync(work);
  sh('git init --bare -b main .', remote);
  sh('git init -b main . && git config user.email w@e.ch && git config user.name w', work);
  fs.writeFileSync(path.join(work, '.gitignore'),
    fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8') + '\n' + zusatzIgnore + '\n');
  fs.mkdirSync(path.join(work, 'data-health'));
  fs.writeFileSync(path.join(work, 'data-health', 'p99-delta-history.json'), '{"byDate":{}}\n');
  sh('git add -A && git commit -q -m init && git remote add origin '
    + JSON.stringify(remote.replace(/\\/g, '/')) + ' && git push -q -u origin main', work);

  // Das, was der Lauf danach schreibt.
  if (schreibeM1M9) {
    fs.writeFileSync(path.join(work, 'data-health', 'namensherkunft-history.json'),
      '{"_doc":"M1","byDate":{"2026-09-01":{"gelesen":15044}}}\n');
    fs.writeFileSync(path.join(work, 'data-health', 'identitaets-tripwire.json'),
      '{"_doku":["M9"],"zaehlung":{"ankerA":1404}}\n');
  }
  fs.writeFileSync(path.join(work, 'data-health', 'p99-delta-history.json'), '{"byDate":{"2026-09-01":1}}\n');
  fs.mkdirSync(path.join(work, 'snapshots'));
  fs.writeFileSync(path.join(work, 'snapshots', 'AAPL.json'), '{}\n');
  return { root, remote, work };
}

/** Einen Shell-Block im Sandkasten fahren — mit `-e`, weil GitHub Actions `run:`-Bloecke
 *  auf ubuntu genau so faehrt (`bash -e {0}`). Ohne das Flag liefe der Block hier
 *  nachsichtiger als in Produktion, und ein durch errexit abgebrochener Schritt bliebe im
 *  Test unsichtbar. */
function fahre(work, text, veroeffentlichen = 'true') {
  const f = path.join(work, '..', 'block-' + Math.random().toString(36).slice(2) + '.sh');
  fs.writeFileSync(f, text);
  return spawnSync('bash', ['-e', f.replace(/\\/g, '/')], {
    cwd: work, encoding: 'utf8',
    env: { ...process.env, VEROEFFENTLICHEN: veroeffentlichen, GITHUB_REF: 'refs/heads/main', NUR_RECHNEN: 'false' },
  });
}

const remoteDateien = (remote) => sh('git ls-tree -r --name-only main', remote).split('\n');

function btest(name, fn) {
  if (!hatBash) { console.log('  --   ' + name + ' (uebersprungen: kein bash — Struktur-Bloecke oben decken die Verdrahtung ab)'); return; }
  test(name, fn);
}

btest('B1 ANWESENHEIT: beide Dateien landen im veroeffentlichten Commit, Wache gruen', () => {
  const { root, remote, work } = sandkasten();
  const c = fahre(work, runBlock(COMMIT_SCHRITT));
  assert.equal(c.status, 0, 'Commit-Block fehlgeschlagen: ' + c.stdout + c.stderr);
  const dateien = remoteDateien(remote);
  assert.ok(dateien.includes(M1), 'M1-Reihe kam NICHT auf dem Remote an: ' + dateien.join(', '));
  assert.ok(dateien.includes(M9), 'M9-Bericht kam NICHT auf dem Remote an: ' + dateien.join(', '));
  const w = fahre(work, runBlock(WACHE_SCHRITT));
  assert.equal(w.status, 0, 'die Wache schlaegt im GUTEN Fall Alarm (Fehlalarm): ' + w.stdout + w.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

btest('B2 BRUCHPROBE: data-health/ gitignoriert -> Dateien kommen nicht an, Wache ROT', () => {
  const { root, remote, work } = sandkasten({ zusatzIgnore: 'data-health/' });
  fahre(work, runBlock(COMMIT_SCHRITT));
  const dateien = remoteDateien(remote);
  assert.ok(!dateien.includes(M1) && !dateien.includes(M9),
    'die Sabotage griff nicht — dann belegt diese Bruchprobe nichts');
  const w = fahre(work, runBlock(WACHE_SCHRITT));
  assert.notEqual(w.status, 0, 'die Wache bleibt gruen, obwohl beide Dateien mit dem Runner sterben');
  for (const f of [M1, M9]) {
    assert.ok(w.stdout.includes('::error::' + f), 'die Wache nennt ' + f + ' nicht als Fehler:\n' + w.stdout);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

btest('B3 BRUCHPROBE: `git add -A` auf eine gezielte Liste verengt -> Wache ROT', () => {
  // Genau das Muster des scoring-Jobs ("gezieltes add auf die Datei, nie -A"). Wandert es
  // eines Tages hierher, faellt es auf, statt die beiden Reihen lautlos abzuschneiden.
  const { root, remote, work } = sandkasten();
  const verengt = runBlock(COMMIT_SCHRITT).replace('git add -A', 'git add data-health/p99-delta-history.json');
  assert.notEqual(verengt, runBlock(COMMIT_SCHRITT), 'die Mutation griff nicht (heisst der add-Befehl noch so?)');
  fahre(work, verengt);
  const dateien = remoteDateien(remote);
  assert.ok(!dateien.includes(M1) && !dateien.includes(M9), 'die Sabotage griff nicht');
  const w = fahre(work, runBlock(WACHE_SCHRITT));
  assert.notEqual(w.status, 0, 'ein verengtes add bleibt unbemerkt');
  fs.rmSync(root, { recursive: true, force: true });
});

btest('B4 BRUCHPROBE: angemeldet, aber der heutige Stand nicht committet -> Wache ROT', () => {
  // Der dritte Weg in die Luecke: die Datei IST getrackt (ls-files findet sie), nur der
  // Inhalt dieses Laufs ist nicht mit hineingekommen. Ein reiner "ist sie getrackt?"-Test
  // waere hier gruen und die Reihe stuende trotzdem auf gestern.
  const { root, work } = sandkasten();
  fahre(work, runBlock(COMMIT_SCHRITT));
  fs.writeFileSync(path.join(work, M1), '{"_doc":"M1","byDate":{"2026-09-02":{"gelesen":1}}}\n');
  const w = fahre(work, runBlock(WACHE_SCHRITT));
  assert.notEqual(w.status, 0, 'ein nicht committeter Tagesstand bleibt unbemerkt');
  assert.ok(w.stdout.includes('::error::' + M1), 'die Wache nennt die Datei nicht:\n' + w.stdout);
  fs.rmSync(root, { recursive: true, force: true });
});

btest('B5 GEGENRICHTUNG: Zweig-/Trockenlauf ist kein Alarm', () => {
  // Ohne Ventil waere jeder nicht veroeffentlichende Lauf dauerrot — die Wache wuerde
  // abgestellt, und dann schuetzt sie gar nichts mehr.
  const { root, work } = sandkasten();
  const c = fahre(work, runBlock(COMMIT_SCHRITT), 'false');
  assert.equal(c.status, 0);
  const w = fahre(work, runBlock(WACHE_SCHRITT), 'false');
  assert.equal(w.status, 0, 'die Wache wird auf einem Zweig-Lauf rot, obwohl dort bewusst nichts committet wird');
  fs.rmSync(root, { recursive: true, force: true });
});

btest('B6 GEGENRICHTUNG: gar nicht geschrieben ist eine WARNUNG, kein roter Lauf', () => {
  // Der Ausfall der Messung meldet filter-snapshot-merge.js selbst (fail-soft, reine
  // Messung). Diese Wache prueft die Persistenz — sonst wuerde sie denselben Vorfall ein
  // zweites Mal melden, und zwar mit der falschen Diagnose.
  const { root, work } = sandkasten({ schreibeM1M9: false });
  fahre(work, runBlock(COMMIT_SCHRITT));
  const w = fahre(work, runBlock(WACHE_SCHRITT));
  assert.equal(w.status, 0, 'eine ausgefallene MESSUNG wird als Persistenz-Bruch gemeldet');
  assert.ok(w.stdout.includes('::warning::' + M1), 'der Ausfall wird gar nicht erwaehnt:\n' + w.stdout);
  fs.rmSync(root, { recursive: true, force: true });
});

console.log('\nm10-persistenz-wache.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
