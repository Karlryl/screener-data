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
// Dieser Test ist das lokale Gegenstueck zum Waechter-Schritt im Workflow: er faellt
// beim naechsten neuen Testordner, BEVOR jemand ihn im CI vermisst.
//
// Run: node tests/gate-coverage.test.js   (Exit 0/1)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WF = path.join(ROOT, '.github', 'workflows', 'daily-pull.yml');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const wf = fs.readFileSync(WF, 'utf8');

function envValue(key) {
  const m = wf.match(new RegExp(`^\\s*${key}:\\s*'([^']*)'`, 'm'));
  assert.ok(m, `${key} fehlt in daily-pull.yml — Gate-Quelle nicht auffindbar`);
  return m[1].split(/\s+/).filter(Boolean);
}

// glob -> regex; '*' matcht keinen '/' (Shell-Semantik der Gate-Schleife)
const toRe = (g) =>
  new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');

check('Gate-Schleife nutzt $GATE_GLOB (keine zweite, driftende Liste)', () => {
  assert.match(wf, /for t in \$GATE_GLOB;/, 'Gate-Schleife globbt nicht ueber $GATE_GLOB');
});

check('Waechter-Schritt ist fail-loud (::error:: + exit 1)', () => {
  assert.match(wf, /::error::Testdatei \$f laeuft in KEINEM Job/, 'Waechter-Fehlermeldung fehlt');
});

check('jede getrackte *.test.js ist gegatet oder begruendet ausgenommen', () => {
  const globs = envValue('GATE_GLOB').map(toRe);
  const exempt = envValue('GATE_EXEMPT');
  const all = execFileSync('git', ['ls-files', '*.test.js'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter((s) => s && !s.includes('/fixtures/'));

  assert.ok(all.length > 0, 'git ls-files fand keine Testdatei — Checkout/git kaputt');

  const ungated = all.filter(
    (f) => !globs.some((re) => re.test(f)) && !exempt.some((ex) => f.startsWith(ex))
  );
  assert.deepEqual(
    ungated, [],
    'Diese Testdateien laufen in KEINEM Job:\n         ' + ungated.join('\n         ') +
    '\n       GATE_GLOB erweitern ODER mit Begruendung in GATE_EXEMPT eintragen.'
  );
});

check('Ausnahmeliste bleibt eng (nur begruendete Live-Netz-Tests)', () => {
  // Ein aufgeblaehtes GATE_EXEMPT waere die bequeme Art, den Waechter zu entwerten.
  assert.deepEqual(envValue('GATE_EXEMPT'), ['tests/discovery/']);
});

console.log(fail ? `\n${fail} FAIL` : '\nAlle Gate-Coverage-Checks ok');
process.exit(fail ? 1 : 0);
