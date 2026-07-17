// R2.15 / R2.R (Skip-Ehrlichkeit) — die Test-Suiten duerfen uebersprungene Tests NICHT verschweigen.
//
// WARUM DIESER TEST VOR DEM FIX ROT WAR:
// (Stufe 1, R2.15) testU() gab bei leerem snapshots/ (= CI pre-pull-Gate) nur eine 'skip'-Zeile aus
// und zaehlte NICHTS. Die Summenzeile meldete deshalb z.B. "18 ok, 0 fail" — ohne jeden Hinweis,
// obwohl die HG-byte-identisch-Beweise gar nicht gelaufen waren. Vor dem Fix enthielt die
// Summenzeile kein "skipped" -> die Assertion unten schlug fehl.
//
// (Stufe 2, R2.R) Stufe 1 war UNVOLLSTAENDIG und dieser Test war fuer die Luecke konstruktionsblind:
// er zaehlte nur '  skip '-Zeilen und glaubte der Summenzeile. Tests, die mit test() (statt testU())
// registriert sind und ERST IM RUMPF per return/continue aussteigen, wenn ihr Anker-Ticker fehlt,
// wurden weiterhin als pass++ gezaehlt — auf dem nackten CI-Checkout meldete
// score.integration.test.js "18 ok", von denen 8 keine einzige Assertion ausfuehrten (ALAB,
// NVTS/AEHR, PLTR, WOLF, ffo-badge, Issuer-Dedup real, non-operating-rev, BLK/BX/KKR); phase.test.js
// meldete "12 ok, 0 fail" ganz ohne das Wort "skipped". Die NEEDS_UNIVERSE-Pruefung unten faengt
// genau das: sie nennt diese Tests beim Namen und verlangt, dass sie OHNE Universum als 'skip'
// erscheinen — vor dem Fix standen sie dort als 'ok' -> rot. Zusaetzlich muss die Summenzeile jetzt
// exakt zu den ausgegebenen Statuszeilen passen (ok/fail/skip), damit die Zahlen nicht driften.
//
// Run: node tests/skip-honesty.test.js   (Exit 0/1)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// leeres Universum simulieren (echtes snapshots/ bleibt unangetastet)
const EMPTY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-empty-'));
const ROOT = path.join(__dirname, '..');

function runWithoutUniverse(rel) {
  const r = spawnSync(process.execPath, [path.join(ROOT, rel)], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, SCREENER_SNAPSHOTS_DIR: EMPTY_DIR },
  });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}

// Tests, die ohne Live-Universum NICHTS pruefen koennen (Anker-Ticker aus snapshots/). Sie MUESSEN
// ohne Universum als 'skip' erscheinen. Der Name ist das Praefix der Testregistrierung — steht er
// gar nicht mehr im Output, ist er umbenannt/entfernt worden und dieser Waechter faellt laut auf
// (statt still durchzuwinken).
const NEEDS_UNIVERSE = {
  'tests/scoring/score.integration.test.js': [
    'ALAB (falls vorhanden)',
    'Decliner NVTS/AEHR',
    'PLTR -> software-comm-services',
    'WOLF (falls vorhanden)',
    'Real-Estate Overview ist ffo-badge',
    'Issuer-Dedup real:',
    'non-operating-rev:',
    'echter Fee-Asset-Manager',
  ],
  'tests/scoring/phase.test.js': [
    'Output-Zeilen tragen phase/mcapBand/ipoRecency',
  ],
  'tests/scoring/quality-board.test.js': [
    'HG byte-identisch: scoreUniverse(u,formulas) == mit leerem opts {}',
    'growthBoost-Gate ist LIVE',
    'QC-Pass laeuft ueber das reale Universum',
  ],
};

for (const rel of Object.keys(NEEDS_UNIVERSE)) {
  const { out, code } = runWithoutUniverse(rel);
  const lines = out.split('\n');
  const summary = out.trim().split('\n').pop();
  const okLines = lines.filter((l) => l.startsWith('  ok   ')).length;
  const skipLines = lines.filter((l) => l.startsWith('  skip ')).length;
  const failLines = lines.filter((l) => l.startsWith('FAIL   ')).length;
  const num = (re) => Number((summary.match(re) || [])[1]);

  check(rel + ': skippt ohne Universum ueberhaupt Tests (sonst prueft dieser Test nichts)', () => {
    assert.ok(skipLines > 0, 'keine skip-Zeile — Seam greift nicht:\n' + out.slice(-400));
  });
  check(rel + ': Summenzeile weist die Skip-Zahl aus (kein stiller Voll-Pass)', () => {
    assert.match(summary, /skipped \(kein Universum\)/, 'Summenzeile verschweigt Skips: ' + summary);
  });
  // Summenzeile == tatsaechlich ausgegebene Statuszeilen. Faengt driftende/erfundene Zahlen.
  check(rel + ': Summenzeile deckt sich mit den ausgegebenen Statuszeilen (ok/fail/skip)', () => {
    assert.equal(num(/(\d+) ok/), okLines, `Summenzeile meldet ${num(/(\d+) ok/)} ok, ausgegeben wurden ${okLines}`);
    assert.equal(num(/(\d+) fail/), failLines, `Summenzeile meldet ${num(/(\d+) fail/)} fail, ausgegeben wurden ${failLines}`);
    assert.equal(num(/(\d+) skipped/), skipLines, `Summenzeile meldet ${num(/(\d+) skipped/)} skips, ausgegeben wurden ${skipLines}`);
  });
  // DER KERN (R2.R): kein Universums-Test darf ohne Universum als 'ok' durchgehen.
  for (const name of NEEDS_UNIVERSE[rel]) {
    check(`${rel}: "${name}…" ist ohne Universum skip, nicht ok`, () => {
      const status = lines.filter((l) => l.startsWith('  ok   ' + name) || l.startsWith('  skip ' + name));
      assert.equal(status.length, 1, `Test "${name}…" nicht (eindeutig) im Output — umbenannt/entfernt? Treffer: ${status.length}`);
      assert.ok(status[0].startsWith('  skip '), `zaehlt ohne Universum als ok, prueft aber nichts: ${status[0].trim()}`);
    });
  }
  check(rel + ': Exit-Code-Verhalten unveraendert (Skips sind kein Fail)', () => {
    assert.equal(code, 0, 'Skips duerfen das Gate nicht rot machen, Exit=' + code);
    assert.match(summary, /0 fail/, 'unerwartete Fails ohne Universum: ' + summary);
  });
}

fs.rmdirSync(EMPTY_DIR);
console.log(fail ? `\nskip-honesty: ${fail} FAILED` : '\nskip-honesty: all passed');
process.exit(fail ? 1 : 0);
