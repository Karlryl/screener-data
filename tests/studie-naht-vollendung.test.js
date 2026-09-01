'use strict';

// NAHT-VOLLENDUNGEN G7 UND G12 — mit der Probe, die das Gericht verlangt.
//
// LR-K5: eine Vollendung ist nur dann eine, wenn sich ein Fall zeigen laesst,
// der VOR der Aenderung gruen und NACH ihr rot ist. Beide Proben hier fahren
// deshalb ZUERST den un-vollendeten Code (aus git) und zeigen ihn dort gruen —
// erst dann den vollendeten und zeigen ihn rot. Eine Bruchprobe, die nur
// hinterher rot ist, beweist nichts ueber die Aenderung.
//
// Usage: node --test tests/studie-naht-vollendung.test.js

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { execFileSync, spawnSync } = require('node:child_process');

const WURZEL = path.join(__dirname, '..');
// Der Stand VOR dieser Vollendung. Von ihm kommen die un-vollendeten Fassungen.
//
// EIN COMMIT, KEIN ZWEIGNAME. Diese Konstante stand bis zum Merge von PR #230
// auf `origin/main` und war damit ein WANDERNDER Anker: sie zeigte genau so
// lange auf den un-vollendeten Stand, wie die Vollendung noch offen war. In der
// Sekunde, in der PR #230 auf main landete, luden beide Proben den VOLLENDETEN
// Code als "vorher" — und die Zusicherung "hier ist es noch gruen" wurde rot,
// obwohl an G7 und G12 nichts falsch ist. Eine Bruchprobe, die ihr eigenes
// Merge nicht ueberlebt, beweist nach dem Merge nichts mehr.
//
// f949cbc5f9 ist der Elternteil des PR-#230-Merges: dort fuehrt
// lib/ledger-single-appender.js noch KEIN LEDGER_RELS und
// lib/studie-verfassung.js noch KEIN vorgaengerDatei. Der Stand ist damit
// unveraenderlich derselbe, gegen den die Proben geschrieben wurden.
const VOR_DER_VOLLENDUNG = 'f949cbc5f9cd8e01fb781a5f3cb951036c69b35f';

function tempdir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

// Laedt die Fassung einer Bibliothek, wie sie VOR der Vollendung auf main lag.
//
// `verbotenerMarker` ist der Riegel gegen genau den Fehler, an dem diese Datei
// nach dem Merge von PR #230 zerbrochen ist: der Anker zeigt auf einen Stand,
// der die Vollendung SCHON traegt. Dann waere die "vorher gruen"-Zusicherung
// eine Aussage ueber den vollendeten Code — und ihre Roetung saehe aus wie ein
// Defekt an G7/G12, obwohl nur der Anker verrutscht ist. Geprueft wird die
// Eigenschaft (der Marker fehlt), nicht die Kennung des Commits.
function unvollendet(rel, dir, verbotenerMarker) {
  const git = spawnSync('git', ['show', `${VOR_DER_VOLLENDUNG}:${rel}`],
    { cwd: WURZEL, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(git.status, 0,
    `git show ${VOR_DER_VOLLENDUNG}:${rel} ist rot (status ${git.status}): `
    + `${String(git.stderr || '').trim() || '<kein stderr>'}`);
  assert.ok(!git.stdout.toString('utf8').includes(verbotenerMarker),
    `${VOR_DER_VOLLENDUNG}:${rel} traegt bereits "${verbotenerMarker}" — der Anker `
    + 'zeigt NICHT auf den un-vollendeten Stand. Die Probe wuerde den vollendeten '
    + 'Code gegen sich selbst halten und nichts mehr beweisen.');
  fs.mkdirSync(dir, { recursive: true });
  const ziel = path.join(dir, path.basename(rel));
  fs.writeFileSync(ziel, git.stdout);
  return require(ziel);
}

// ── G7 ──────────────────────────────────────────────────────────────────────

const TEIL1 = 'protocol/early-detection/2.0.0/outcome-access-ledger.json';
const TEIL2 = 'protocol/early-detection/2.0.0/outcome-access-ledger-teil2.json';

// Ein winziges echtes git-Repo: der Waechter liest git-Topologie, also bekommt
// er welche. Kein Fixture-Nachbau der Kommandos.
function fixtureRepo(dir, dateien) {
  fs.mkdirSync(dir, { recursive: true });
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'probe@example.invalid');
  g('config', 'user.name', 'Probe');
  fs.mkdirSync(path.join(dir, 'protocol', 'early-detection', '2.0.0'), { recursive: true });
  fs.writeFileSync(path.join(dir, ...TEIL1.split('/')), '{"events":[]}\n');
  g('add', '-A'); g('commit', '-qm', 'basis');
  g('checkout', '-q', '-b', 'zweig');
  for (const [rel, inhalt] of Object.entries(dateien)) {
    const p = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, inhalt);
  }
  g('add', '-A'); g('commit', '-qm', 'zweig');
  return dir;
}

test('G7 VOLLENDUNG: Fortsetzung neben fremdem Code — vorher gruen, nachher rot', () => {
  const d = tempdir('naht-g7-');
  const repo = fixtureRepo(path.join(d, 'repo'), {
    [TEIL2]: '{"events":[1]}\n',
    'scripts/studie.js': '// fremder Code\n',
  });

  // (1) ZUERST der un-vollendete Code. Er kennt nur Teil 1, sieht die
  //     Fortsetzung nicht als Register und meldet FALSCH-GRUEN.
  const alt = unvollendet('lib/ledger-single-appender.js', path.join(d, 'alt'), 'LEDGER_RELS');
  const vorher = alt.checkSingleAppender({ repoDir: repo, baseRef: 'main', headRef: 'zweig' });
  assert.equal(vorher.verdict, 'NO_LEDGER_APPEND',
    'der un-vollendete Waechter MUSS hier falsch-gruen sein - sonst ist die '
    + 'Vollendung keine (LR-K5)');

  // (2) DANN der vollendete. Mitgliedschaft statt Gleichheit -> Verstoss.
  const neu = require(path.join(WURZEL, 'lib', 'ledger-single-appender.js'));
  assert.throws(
    () => neu.checkSingleAppender({ repoDir: repo, baseRef: 'main', headRef: 'zweig' }),
    /branch-side ledger append/,
    'der vollendete Waechter muss die Fortsetzung neben fremdem Code fangen');
});

test('G7 GEGENRICHTUNG: der Naht-PR ueber BEIDE Registerdateien bleibt gruen', () => {
  const d = tempdir('naht-g7b-');
  const repo = fixtureRepo(path.join(d, 'repo'), {
    [TEIL1]: '{"events":[0,1]}\n',
    [TEIL2]: '{"events":[]}\n',
  });
  const neu = require(path.join(WURZEL, 'lib', 'ledger-single-appender.js'));
  const r = neu.checkSingleAppender({ repoDir: repo, baseRef: 'main', headRef: 'zweig' });
  assert.equal(r.verdict, 'LEDGER_ONLY_MINI_PR',
    'der Schnitt selbst darf nicht an seinem eigenen Waechter scheitern');
  assert.deepEqual(r.foreignPaths, []);
});

// ── G12 ─────────────────────────────────────────────────────────────────────

// Ein kettengueltiges Fortsetzungs-Register mit EINEM Eintrag, dessen
// Anmeldezeit VOR der vorgesetzten Zeit liegt. Genau der Fall, den die
// dateiinterne Monotonie nicht sehen kann.
function fortsetzungMitRueckdatiertemErsten(lib) {
  const genesis = crypto.createHash('sha256').update('naht-probe').digest('hex');
  const echt = JSON.parse(fs.readFileSync(
    path.join(WURZEL, ...TEIL1.split('/')), 'utf8'));
  const reg = { ...echt, events: [], genesisSha256: genesis };
  delete reg.vorgaengerDatei;
  delete reg.vorgaengerLetzteAnmeldung;
  const mit = lib.haengeEintragAn(reg, {
    runId: 'naht-probe-erster',
    typ: lib.ART_C0_REGELFREEZE,
    registeredAt: '2026-09-01T10:00:00.000Z',
    accessedAt: '2026-09-01T12:00:00.000Z',
    fenster: ['kein Studienfenster - Probe'],
    allowedOutputs: [],
    erlaubt: 'Nichts.',
    verboten: 'Nichts.',
    begruendung: 'Fixture der Naht-Monotonie-Probe.',
    endtestSiegel: 'unberuehrt',
  });
  // Die geschlossene Datei endete SPAETER als dieser erste Eintrag.
  mit.vorgaengerDatei = TEIL1;
  mit.vorgaengerLetzteAnmeldung = '2026-09-01T20:00:00.000Z';
  return mit;
}

test('G12 VOLLENDUNG: rueckdatierter erster Fortsetzungseintrag — vorher gruen, nachher rot', () => {
  const d = tempdir('naht-g12-');
  const alt = unvollendet('lib/studie-verfassung.js', path.join(d, 'alt'), 'vorgaengerDatei');
  const reg = fortsetzungMitRueckdatiertemErsten(alt);

  // (1) ZUERST un-vollendet: die Monotonie startet bei null, der erste Eintrag
  //     hat in SEINER Datei keinen Vorgaenger - er kommt durch.
  assert.doesNotThrow(() => alt.pruefeZugriffsRegister(reg),
    'der un-vollendete Code MUSS den rueckdatierten Ersten durchlassen - '
    + 'sonst ist die Vollendung keine (LR-K5)');

  // (2) DANN vollendet: die vorgesetzte Zeit faengt ihn.
  const neu = require(path.join(WURZEL, 'lib', 'studie-verfassung.js'));
  assert.throws(() => neu.pruefeZugriffsRegister(reg), /rueckdatiert/,
    'der vollendete Code muss den rueckdatierten Ersten fangen');
});

test('G12 FAIL-CLOSED: vorgaengerDatei ohne vorgesetzte Zeit ist ein Bruch', () => {
  const neu = require(path.join(WURZEL, 'lib', 'studie-verfassung.js'));
  const reg = fortsetzungMitRueckdatiertemErsten(neu);
  delete reg.vorgaengerLetzteAnmeldung;
  assert.throws(() => neu.pruefeZugriffsRegister(reg),
    /kein vorgaengerLetzteAnmeldung/,
    'ein stiller Rueckfall auf null waere genau das Loch');
});

test('G12 UNVERAENDERT: ohne vorgaengerDatei bit-fuer-bit wie zuvor', () => {
  const d = tempdir('naht-g12c-');
  const alt = unvollendet('lib/studie-verfassung.js', path.join(d, 'alt'), 'vorgaengerDatei');
  const neu = require(path.join(WURZEL, 'lib', 'studie-verfassung.js'));
  // Das ECHTE Register - der Normalfall, der sich nicht bewegen darf.
  const echt = JSON.parse(fs.readFileSync(
    path.join(WURZEL, ...TEIL1.split('/')), 'utf8'));
  assert.ok(!echt.vorgaengerDatei, 'das heutige Register traegt keine vorgaengerDatei');
  assert.deepEqual(neu.pruefeZugriffsRegister(echt), alt.pruefeZugriffsRegister(echt),
    'ohne vorgaengerDatei muss das Ergebnis identisch bleiben');
});
