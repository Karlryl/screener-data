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
 * KEIN SKIP-VENTIL: ohne bash bricht die Datei ab statt Teil-Gruen zu melden. Ein Teil-Lauf
 * ("2 ok, 0 fail") sieht fuer scripts/test-gate.js wie ein voller PASS aus — dann stuende
 * gruen in der Spalte, ohne dass eine einzige Bruchprobe gelaufen waere.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const WF = path.join(REPO, '.github', 'workflows', 'daily-pull.yml');
// CRLF wird weggenommen (Hausmuster: alarm-tagesgrenze.test.js, gate-coverage.test.js): die
// Datei ist in .gitattributes NICHT auf lf gepinnt, ein Windows-Checkout liefert sie also mit
// \r. Dass der hiesige bash-Build das heute schluckt, ist eine Eigenschaft dieses Builds,
// keine Zusage.
const YML = fs.readFileSync(WF, 'utf8').replace(/\r\n/g, '\n');

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

/** Den `run: |`-Block eines Schritts herausloesen und auf Spalte 0 ausruecken.
 *
 * REVIEW-FUND (beide Reviewer): die Vorwaerts-Suche lief bis zum naechsten `run: |` IRGENDWO
 * in der Datei. Verliert der gesuchte Schritt sein `run:` (Umbau auf `uses:`), lieferte sie
 * still den Block eines FREMDEN Schritts — nicht leer, nicht abgeschnitten, sondern plausibel
 * falsch, und jede Bruchprobe haette danach den falschen Code geprueft. Die Suche endet
 * deshalb an der naechsten Schritt-Grenze.
 *
 * Und die Einrueckung kommt aus der `run:`-Zeile selbst (+2), nicht aus der ersten Inhalts-
 * zeile: waere die je leer, waere das Mass 0 und der Block haette den Rest der Datei
 * verschluckt. (Muster: tests/gate-coverage.test.js.)
 */
function runBlock(schritt) {
  const z = YML.split('\n');
  const start = schrittZeile(schritt);
  let i = start;
  while (i < z.length && !/^\s*run: \|\s*$/.test(z[i])) {
    assert.ok(i === start || !/^ {6}- (name|uses):/.test(z[i]),
      'Schritt ' + schritt + ' hat keinen eigenen `run: |`-Block (die Suche waere in den '
      + 'naechsten Schritt gelaufen und haette dessen Shell geprueft).');
    i++;
  }
  assert.ok(i < z.length, 'kein `run: |`-Block in Schritt ' + schritt);
  const einr = z[i].match(/^\s*/)[0].length + 2;
  const out = [];
  for (let k = i + 1; k < z.length; k++) {
    if (z[k].trim() === '') { out.push(''); continue; }
    if (z[k].match(/^\s*/)[0].length < einr) break;
    out.push(z[k].slice(einr));
  }
  assert.ok(out.some((l) => l.trim() !== ''), 'der extrahierte Block von ' + schritt + ' ist leer');
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

// REVIEW-FUND (silent-failure-hunter): die erste Fassung sprang ohne bash still ueber die
// SECHS Verhaltens-Bloecke und meldete trotzdem "2 ok, 0 fail" — test-gate.js erkennt einen
// TEIL-Lauf nicht als SKIP (seine Heuristik verlangt "0 ok"), also stand PASS in der Spalte,
// ohne dass eine einzige Bruchprobe gelaufen waere. Ohne bash ist die Zusage UNGEPRUEFT, und
// ungeprueft ist kein Freispruch — dieselbe Regel wie im Wache-Block selbst. Der Waechter
// laeuft auf ubuntu (CI) und auf Karls Kiste (Git-bash), das Ventil war ohnehin totes Holz.
if (spawnSync('bash', ['--version'], { encoding: 'utf8' }).status !== 0) {
  console.error('FAIL   kein bash im PATH — dieser Waechter faehrt die ECHTEN Shell-Bloecke aus '
    + 'daily-pull.yml. Ohne bash ist die M1/M9-Persistenz-Zusage ungeprueft, nicht in Ordnung.');
  process.exit(1);
}

const sh = (cmd, cwd) => {
  const r = spawnSync('bash', ['-lc', cmd], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(cmd + '\n' + r.stdout + r.stderr);
  return r.stdout.trim();
};

// REVIEW-FUND (typescript-reviewer, nachgestellt): das Aufraeumen stand als LETZTE Zeile in
// jedem Block, also genau hinter den Zusicherungen — bei ROT wurde es nie erreicht. Ausgerechnet
// wenn dieser Waechter seine Arbeit tut, blieb je Bruchprobe ein Bare-Remote plus Klon liegen.
// Jetzt zentral beim Prozess-Ende, damit es keinen Weg mehr gibt, der daran vorbeifuehrt.
const muell = [];
process.on('exit', () => {
  for (const d of muell) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* Aufraeumen darf nie das Urteil kippen */ } }
});

/**
 * Baut den Tageslauf-Zustand nach: Fixture-Remote + Arbeitsbaum mit der ECHTEN .gitignore
 * des Repos (die Frage "greift ein Ignore-Muster?" wird gemessen, nicht geglaubt), darin
 * die drei data-health-Dateien, die der Lauf schreibt, und ein gitignoriertes snapshots/.
 * `zusatzIgnore` und `blockErsatz` sind die Sabotage-Schrauben.
 */
function sandkasten({ zusatzIgnore = '', schreibeM1M9 = true, gestern = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm10persist-'));
  muell.push(root);
  const remote = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  fs.mkdirSync(remote); fs.mkdirSync(work);
  sh('git init --bare -b main .', remote);
  // REVIEW-FUND (typescript-reviewer, nachgemessen): `git init` erbt auf dieser Kiste
  // core.autocrlf=true aus der System-Konfiguration, das echte Repo steht lokal auf false.
  // Der Sandkasten faehrt sonst unter einer ANDEREN Zeilenenden-Politik als der Lauf, den er
  // nachstellt — heute wirkungslos (alle Fixtures sind reines LF), aber die Datei behauptet,
  // git so zu fragen wie die Produktion. Also wird es gepinnt statt geerbt.
  sh('git init -b main . && git config user.email w@e.ch && git config user.name w'
    + ' && git config core.autocrlf false && git config core.eol lf', work);
  fs.writeFileSync(path.join(work, '.gitignore'),
    fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8') + '\n' + zusatzIgnore + '\n');
  fs.mkdirSync(path.join(work, 'data-health'));
  fs.writeFileSync(path.join(work, 'data-health', 'p99-delta-history.json'), '{"byDate":{}}\n');
  // `gestern`: beide Dateien liegen schon committet im Bestand — der Normalfall ab Tag 2,
  // weil der Checkout sie vor jeden Schritt legt.
  if (gestern) {
    fs.writeFileSync(path.join(work, 'data-health', 'namensherkunft-history.json'), '{"byDate":{"gestern":{}}}\n');
    fs.writeFileSync(path.join(work, 'data-health', 'identitaets-tripwire.json'), '{"zaehlung":{}}\n');
  }
  // Der Alt-Commit traegt ein COMMITTER-Datum in der Vergangenheit (nicht nur --date, das nur
  // den Autor setzt) — die Wache liest %cd, und nur so ist "aelter als der Lauftag" echt.
  sh('git add -A && '
    + (gestern ? 'GIT_COMMITTER_DATE="2020-01-02T10:00:00Z" GIT_AUTHOR_DATE="2020-01-02T10:00:00Z" ' : '')
    + 'git commit -q -m init && git remote add origin '
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

/** Einen Shell-Block im Sandkasten fahren — mit GENAU den Flags, die GitHub Actions fuer
 *  `run:`-Bloecke setzt (`bash --noprofile --norc -eo pipefail {0}`). Nachsichtiger zu fahren
 *  hiesse, den Block unter anderen Regeln zu pruefen als er laeuft: ein unkontrollierter
 *  Befehl, der in Produktion den Schritt abbricht, liefe hier einfach weiter. */
function fahre(work, text, veroeffentlichen = 'true', lauftag = '') {
  const f = path.join(work, '..', 'block-' + Math.random().toString(36).slice(2) + '.sh');
  fs.writeFileSync(f, text);
  return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', f.replace(/\\/g, '/')], {
    cwd: work, encoding: 'utf8',
    env: { ...process.env, VEROEFFENTLICHEN: veroeffentlichen, GITHUB_REF: 'refs/heads/main',
      NUR_RECHNEN: 'false', RUN_DATE_UTC: lauftag },
  });
}

const HEUTE = new Date().toISOString().slice(0, 10);

const remoteDateien = (remote) => sh('git ls-tree -r --name-only main', remote).split('\n');

test('B1 ANWESENHEIT: beide Dateien landen im veroeffentlichten Commit, Wache gruen', () => {
  const { remote, work } = sandkasten();
  const c = fahre(work, runBlock(COMMIT_SCHRITT));
  assert.equal(c.status, 0, 'Commit-Block fehlgeschlagen: ' + c.stdout + c.stderr);
  const dateien = remoteDateien(remote);
  assert.ok(dateien.includes(M1), 'M1-Reihe kam NICHT auf dem Remote an: ' + dateien.join(', '));
  assert.ok(dateien.includes(M9), 'M9-Bericht kam NICHT auf dem Remote an: ' + dateien.join(', '));
  const w = fahre(work, runBlock(WACHE_SCHRITT));
  assert.equal(w.status, 0, 'die Wache schlaegt im GUTEN Fall Alarm (Fehlalarm): ' + w.stdout + w.stderr);
});

test('B2 BRUCHPROBE: data-health/ gitignoriert -> Dateien kommen nicht an, Wache ROT', () => {
  const { remote, work } = sandkasten({ zusatzIgnore: 'data-health/' });
  fahre(work, runBlock(COMMIT_SCHRITT));
  const dateien = remoteDateien(remote);
  assert.ok(!dateien.includes(M1) && !dateien.includes(M9),
    'die Sabotage griff nicht — dann belegt diese Bruchprobe nichts');
  const w = fahre(work, runBlock(WACHE_SCHRITT));
  assert.notEqual(w.status, 0, 'die Wache bleibt gruen, obwohl beide Dateien mit dem Runner sterben');
  for (const f of [M1, M9]) {
    assert.ok(w.stdout.includes('::error::' + f), 'die Wache nennt ' + f + ' nicht als Fehler:\n' + w.stdout);
  }
});

test('B3 BRUCHPROBE: `git add -A` auf eine gezielte Liste verengt -> Wache ROT', () => {
  // Genau das Muster des scoring-Jobs ("gezieltes add auf die Datei, nie -A"). Wandert es
  // eines Tages hierher, faellt es auf, statt die beiden Reihen lautlos abzuschneiden.
  const { remote, work } = sandkasten();
  const verengt = runBlock(COMMIT_SCHRITT).replace('git add -A', 'git add data-health/p99-delta-history.json');
  assert.notEqual(verengt, runBlock(COMMIT_SCHRITT), 'die Mutation griff nicht (heisst der add-Befehl noch so?)');
  fahre(work, verengt);
  const dateien = remoteDateien(remote);
  assert.ok(!dateien.includes(M1) && !dateien.includes(M9), 'die Sabotage griff nicht');
  const w = fahre(work, runBlock(WACHE_SCHRITT));
  assert.notEqual(w.status, 0, 'ein verengtes add bleibt unbemerkt');
});

test('B4 BRUCHPROBE: angemeldet, aber der heutige Stand nicht committet -> Wache ROT', () => {
  // Der dritte Weg in die Luecke: die Datei IST getrackt (ls-files findet sie), nur der
  // Inhalt dieses Laufs ist nicht mit hineingekommen. Ein reiner "ist sie getrackt?"-Test
  // waere hier gruen und die Reihe stuende trotzdem auf gestern.
  const { work } = sandkasten();
  fahre(work, runBlock(COMMIT_SCHRITT));
  fs.writeFileSync(path.join(work, M1), '{"_doc":"M1","byDate":{"2026-09-02":{"gelesen":1}}}\n');
  const w = fahre(work, runBlock(WACHE_SCHRITT));
  assert.notEqual(w.status, 0, 'ein nicht committeter Tagesstand bleibt unbemerkt');
  assert.ok(w.stdout.includes('::error::' + M1), 'die Wache nennt die Datei nicht:\n' + w.stdout);
});

test('B5 GEGENRICHTUNG: Zweig-/Trockenlauf ist kein Alarm', () => {
  // Ohne Ventil waere jeder nicht veroeffentlichende Lauf dauerrot — die Wache wuerde
  // abgestellt, und dann schuetzt sie gar nichts mehr.
  const { work } = sandkasten();
  const c = fahre(work, runBlock(COMMIT_SCHRITT), 'false');
  assert.equal(c.status, 0);
  const w = fahre(work, runBlock(WACHE_SCHRITT), 'false');
  assert.equal(w.status, 0, 'die Wache wird auf einem Zweig-Lauf rot, obwohl dort bewusst nichts committet wird');
});

test('B6 GEGENRICHTUNG: gar nicht geschrieben ist eine WARNUNG, kein roter Lauf', () => {
  // Der Ausfall der Messung meldet filter-snapshot-merge.js selbst (fail-soft, reine
  // Messung). Diese Wache prueft die Persistenz — sonst wuerde sie denselben Vorfall ein
  // zweites Mal melden, und zwar mit der falschen Diagnose.
  const { work } = sandkasten({ schreibeM1M9: false });
  fahre(work, runBlock(COMMIT_SCHRITT));
  const w = fahre(work, runBlock(WACHE_SCHRITT));
  assert.equal(w.status, 0, 'eine ausgefallene MESSUNG wird als Persistenz-Bruch gemeldet');
  assert.ok(w.stdout.includes('::warning::' + M1), 'der Ausfall wird gar nicht erwaehnt:\n' + w.stdout);
});

test('B7 REVIEW-FUND: gestern committet, heute nicht angefasst -> sichtbare WARNUNG statt "ok"', () => {
  // REPRODUZIERT vor dem Fix (silent-failure-hunter, HIGH): ab Tag 2 liegt die Datei durch den
  // Checkout schon vor dem Lauf auf der Platte. Faellt die Messung dann fail-soft aus, ist sie
  // da, getrackt und sauber — die erste Fassung druckte "ok: ist committet" und ging gruen
  // durch, an einem Tag, an dem die Reihe ein Loch bekommt. Rot wird der Lauf davon bewusst
  // NICHT (M1 ist per Urteil fail-soft); sichtbar muss es trotzdem sein.
  const { work } = sandkasten({ gestern: true, schreibeM1M9: false });
  const c = fahre(work, runBlock(COMMIT_SCHRITT), 'true', HEUTE);
  assert.equal(c.status, 0, 'Commit-Block fehlgeschlagen: ' + c.stdout + c.stderr);
  const w = fahre(work, runBlock(WACHE_SCHRITT), 'true', HEUTE);
  assert.equal(w.status, 0, 'ein alter Commit-Tag ist eine Warnung, kein roter Lauf — sonst waere '
    + 'die per Urteil fail-soft gebaute Messung ueber die Hintertuer doch ein Gate');
  for (const f of [M1, M9]) {
    assert.ok(w.stdout.includes('::warning::' + f),
      'kein Hinweis auf den veralteten Commit-Tag von ' + f + ' — die Zeile "ok: ist committet" '
      + 'liest sich dann als Entwarnung fuer einen Tag ohne Messung:\n' + w.stdout);
  }
});

test('B8 GEGENPROBE zu B7: frisch geschriebene Dateien warnen NICHT', () => {
  // Ohne diese Gegenrichtung koennte die Frische-Pruefung an JEDEM Tag warnen und waere damit
  // wertlos — eine Warnung, die immer kommt, wird weggeschaut.
  const { work } = sandkasten({ gestern: true });
  fahre(work, runBlock(COMMIT_SCHRITT), 'true', HEUTE);
  const w = fahre(work, runBlock(WACHE_SCHRITT), 'true', HEUTE);
  assert.equal(w.status, 0);
  assert.ok(!w.stdout.includes('::warning::'),
    'die Frische-Pruefung warnt auch am Tag des eigenen Commits:\n' + w.stdout);
});

console.log('\nm10-persistenz-wache.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
