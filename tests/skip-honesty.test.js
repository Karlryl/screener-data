// R2.15 (Skip-Ehrlichkeit) — die testU-Dateien duerfen uebersprungene Tests NICHT verschweigen.
//
// WARUM DIESER TEST VOR DEM FIX ROT WAR:
// testU() gab bei leerem snapshots/ (= CI pre-pull-Gate) nur eine 'skip'-Zeile aus und zaehlte
// NICHTS. Die Summenzeile meldete deshalb z.B. "18 ok, 0 fail" — ohne jeden Hinweis, obwohl die
// beiden HG-byte-identisch-Beweise, die growthBoost-Gegenprobe und der volle QC-Pass gar nicht
// gelaufen waren. Ein Leser (und der CI-Gate-Detektor) hielt das fuer voll geprueft. Vor dem Fix
// enthielt die Summenzeile kein "skipped" -> die Assertion unten schlug fehl.
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

for (const rel of ['tests/scoring/quality-board.test.js', 'tests/scoring/score.integration.test.js']) {
  const { out, code } = runWithoutUniverse(rel);
  const summary = out.trim().split('\n').pop();
  const skipLines = (out.match(/^ {2}skip /gm) || []).length;

  check(rel + ': skippt ohne Universum ueberhaupt Tests (sonst prueft dieser Test nichts)', () => {
    assert.ok(skipLines > 0, 'keine skip-Zeile — Seam greift nicht:\n' + out.slice(-400));
  });
  check(rel + ': Summenzeile weist die Skip-Zahl aus (kein stiller Voll-Pass)', () => {
    assert.match(summary, /skipped \(kein Universum\)/, 'Summenzeile verschweigt Skips: ' + summary);
    const n = Number((summary.match(/(\d+) skipped/) || [])[1]);
    assert.equal(n, skipLines, `Summenzeile meldet ${n} skips, ausgegeben wurden ${skipLines}`);
  });
  check(rel + ': Exit-Code-Verhalten unveraendert (Skips sind kein Fail)', () => {
    assert.equal(code, 0, 'Skips duerfen das Gate nicht rot machen, Exit=' + code);
    assert.match(summary, /0 fail/, 'unerwartete Fails ohne Universum: ' + summary);
  });
}

fs.rmdirSync(EMPTY_DIR);
console.log(fail ? `\nskip-honesty: ${fail} FAILED` : '\nskip-honesty: all passed');
process.exit(fail ? 1 : 0);
