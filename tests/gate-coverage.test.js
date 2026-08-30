// R-Gate 2.R (Runde 3) — JEDE Testdatei im Repo muss im CI wirklich laufen.
//
// WARUM DIESER TEST VOR DEM FIX ROT WAR:
// Der pre-pull-Test-Gate in .github/workflows/daily-pull.yml zaehlte die Testordner
// NAMENTLICH auf ('tests/*.test.js tests/scoring/*.test.js'). Die 5 hermetischen Tests
// unter lib/ (forward-returns, annual-currency-guard, metrics, newest-qtr-guard,
// watchlist-fs) waren damit von KEINEM Job erfasst — darunter forward-returns.test.js,
// die classify()-Vertragspruefung, auf der der ganze §8-Austrittspfad der rankIC-
// Messreihe steht. Vor dem Fix haette die Assertion unten diese 5 Dateien als
// ungegatet gemeldet -> rot. (Der Tag-328-Fix hatte nur tests/ nachgetragen und die
// Wurzel — die Aufzaehlung selbst — offen gelassen: der naechste neue Testordner
// waere wieder still ungegatet.)
//
// Tag 653: Die Gate-Quelle ist von den env-Bloecken in daily-pull.yml nach
// scripts/test-gate.js gewandert (zwei Spuren, zwei Workflows, EINE Quelle). Dieser
// Test prueft weiter DIESELBE Sache, nur am neuen Ort: keine Testdatei darf still
// ungegatet bleiben, die Ausnahmeliste bleibt eng, und die Leakage-/Zeitpunkt-
// Waechter duerfen nicht in die bloss meldende Spur abrutschen.
//
// Run: node tests/gate-coverage.test.js   (Exit 0/1)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WF = path.join(ROOT, '.github', 'workflows', 'daily-pull.yml');
const PR_WF = path.join(ROOT, '.github', 'workflows', 'pr-check.yml');
const GATE_SRC = path.join(ROOT, 'scripts', 'test-gate.js');
const gate = require(GATE_SRC);

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const wf = fs.readFileSync(WF, 'utf8');
const prWf = fs.readFileSync(PR_WF, 'utf8');
const gateSrc = fs.readFileSync(GATE_SRC, 'utf8');

// glob -> regex; '*' matcht keinen '/' (Shell-Semantik der Gate-Schleife)
const toRe = (g) =>
  new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');

check('beide Workflows fahren dieselbe Gate-Quelle (keine zweite, driftende Liste)', () => {
  assert.match(wf, /node scripts\/test-gate\.js --mode=blocking/);
  assert.match(wf, /node scripts\/test-gate\.js --mode=report/);
  assert.match(wf, /node scripts\/test-gate\.js --selftest/);
  assert.match(prWf, /node scripts\/test-gate\.js --mode=all/);
  assert.ok(!/GATE_GLOB/.test(wf), 'alte Inline-Gate-Liste steht noch im Workflow');
});

check('Waechter-Schritt ist fail-loud (::error:: + exit 1)', () => {
  assert.match(gateSrc, /::error::Testdatei \$\{f\} laeuft in KEINEM Job/, 'Waechter-Fehlermeldung fehlt');
  assert.match(gateSrc, /::error::Waechter fand KEINE Testdatei im Repo/, 'Leer-Liste-Abbruch fehlt');
});

check('jede getrackte *test.js ist gegatet oder begruendet ausgenommen', () => {
  const globs = gate.BLOCKING_GLOBS.map(toRe);
  const exempt = gate.EXEMPT_PREFIXES;
  const report = gate.REPORT_FILES;
  const all = execFileSync('git', ['ls-files', '*test.js'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter((s) => s && !s.includes('/fixtures/'));

  assert.ok(all.length > 0, 'git ls-files fand keine Testdatei — Checkout/git kaputt');

  const ungated = all.filter(
    (f) => !globs.some((re) => re.test(f)) && !report.includes(f) && !exempt.some((ex) => f.startsWith(ex))
  );
  assert.deepEqual(
    ungated, [],
    'Diese Testdateien laufen in KEINEM Job:\n         ' + ungated.join('\n         ') +
    '\n       BLOCKING_GLOBS erweitern ODER mit Begruendung in scripts/test-gate.js eintragen.'
  );
});

check('Ausnahmeliste bleibt eng (nur begruendete Live-Netz-Tests)', () => {
  // Ein aufgeblaehtes EXEMPT_PREFIXES waere die bequeme Art, den Waechter zu entwerten.
  assert.deepEqual(gate.EXEMPT_PREFIXES, ['tests/discovery/']);
});

check('Leakage-/Zeitpunkt-Waechter bleiben blockierend (nicht in der Melde-Spur)', () => {
  // Auflage der Rat-Vorlage: diese sieben duerfen nie in REPORT_FILES landen.
  for (const f of gate.BLOCKING_ALWAYS) {
    assert.ok(!gate.REPORT_FILES.includes(f), f + ' ist in die bloss meldende Spur abgerutscht');
    assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' existiert nicht mehr — Liste veraltet');
  }
  assert.ok(gate.BLOCKING_ALWAYS.length === 7, 'BLOCKING_ALWAYS zaehlt nicht mehr sieben Waechter');
});

// Namentlich zugelassen, obwohl ausserhalb des early-detection-Praefixes.
// Orchestrator-Ruling 2026-08-29 14:10: tests/studie-c0.test.js (Strang C,
// Themenauswahl) gehoert in die Melde-Spur — ein rotes C0 ist kein Auslieferungs-
// Befund und darf den Preis-Abruf nicht anhalten.
// BEWUSST eine Namensliste und KEINE aufgeweichte Praefix-Regel ('tests/studie-*'):
// die tragende Eigenschaft dieses Checks ist, dass jede WEITERE fremde Datei in der
// Forschungs-Spur auffliegt und auf der sicheren Seite blockierend landet.
const NAMENTLICH_IN_DER_MELDE_SPUR = ['tests/studie-c0.test.js'];

check('Forschungs-Spur ist eine Namensliste (neue Studien-Tests landen blockierend)', () => {
  for (const f of gate.REPORT_FILES) {
    assert.ok(
      f.startsWith('tests/early-detection-') || NAMENTLICH_IN_DER_MELDE_SPUR.includes(f),
      'Fremde Datei in der Forschungs-Spur: ' + f,
    );
    assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' existiert nicht mehr — Liste veraltet');
  }
  // Gegenprobe am Waechter selbst: eine NICHT namentlich zugelassene fremde Datei
  // muss weiterhin auffliegen, sonst prueft die Regel nach der Lockerung nichts mehr.
  const fremd = 'tests/irgendein-fremder.test.js';
  assert.ok(
    !fremd.startsWith('tests/early-detection-') && !NAMENTLICH_IN_DER_MELDE_SPUR.includes(fremd),
    'Die Lockerung laesst beliebige fremde Dateien durch',
  );
});

// Beweislauf 33289964981 (ENTSCHIED 106): der Selftest simuliert rote Gate-Laeufe.
// Seine '::error::'-Zeilen ueber tests/{green,red,orphan}.test.js gingen roh nach
// stdout, GitHub machte daraus sechs echte Annotationen — an einem prep-Job, der
// GRUEN durchlief, ueber Dateien, die im Repo gar nicht existieren. Die Triage hat
// eine Stunde lang einen Fehler gesucht, den es nie gab.
// Diese Wache haengt an den AUSGEGEBENEN BYTES, nicht an einem Textmuster in der
// Quelle: sie faehrt den Selftest wirklich und liest, was herauskommt.
check('Selftest erzeugt KEINE Lauf-Annotation, behaelt den Text aber (33289964981)', () => {
  const out = execFileSync(process.execPath, [GATE_SRC, '--selftest'], { cwd: ROOT, encoding: 'utf8' });
  const kommandos = out.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.startsWith('::'));
  assert.deepEqual(
    kommandos, [],
    'Der Selftest schickt Workflow-Kommandos nach stdout — GitHub macht daraus erfundene\n' +
    '       Fehler an einem gruenen Lauf:\n         ' + kommandos.join('\n         '),
  );
  // ABWESENHEIT allein waere auch erfuellt, wenn jemand die Ausgabe einfach loescht.
  // Also die ANWESENHEIT gleich mit: der Beweis der Negativ-Probe steht noch da, zitiert.
  assert.match(
    out, /^ {2}::error::Testdatei tests\/orphan\.test\.js laeuft in KEINEM Job/m,
    'Der Beleg der Waechter-Erhalt-Probe fehlt in der Ausgabe — entschaerft heisst zitiert, nicht geloescht.',
  );
});

// GEGENPROBE am selben Objekt: ein ECHTER Fehlschlag im echten Lauf MUSS weiter
// annotieren. Ohne sie waere die Wache oben auch dann gruen, wenn die Entschaerfung
// zu breit greift und das Gate seine roten X gar nicht mehr melden kann.
check('ECHTER Gate-Befund annotiert weiterhin (Entschaerfung greift nicht zu breit)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-annot-gegenprobe-'));
  const gesagt = [];
  const echtesLog = console.log;
  try {
    fs.mkdirSync(path.join(tmp, 'tests'));
    fs.writeFileSync(path.join(tmp, 'tests', 'rot.test.js'), 'process.exit(1);\n');
    console.log = (s) => { gesagt.push(String(s)); };
    gate.runGate({
      mode: 'blocking', cwd: tmp, blockingGlobs: ['tests/rot*test.js'],
      reportFiles: [], exemptPrefixes: [], blockingAlways: [], repoFiles: ['tests/rot.test.js'],
    });
  } finally {
    console.log = echtesLog;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.ok(
    gesagt.some((l) => l.startsWith('::error::') && l.includes('tests/rot.test.js')),
    'Ein echter Fehlschlag erzeugt keine Annotation mehr — das Gate ist stumm geworden.',
  );
});

console.log(fail ? `\n${fail} FAIL` : '\nAlle Gate-Coverage-Checks ok');
process.exit(fail ? 1 : 0);
