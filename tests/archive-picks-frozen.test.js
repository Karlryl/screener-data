// tests/archive-picks-frozen.test.js — Standalone-Runner (framework-los: assert + process.exit).
// Waechter fuer den Karl-Entscheid 2026-08-16: picks-history/ ist DAUERHAFT eingefroren
// (siehe picks-history/_FROZEN.md). Deckt scripts/archive-old-snapshots.js ab:
//   (a) Hand-Aufruf OHNE Flag fasst picks-history NICHT an (Verzeichnis-Diff + Byte-Diff)
//   (b) Hand-Aufruf OHNE Flag fasst methods-history NICHT an (gleiche Erb-Logik, Schutzliste)
//   (c) prices/ wird OHNE Flag weiterhin normal archiviert (der Schutz darf die Rotation
//       nicht global abschalten — sonst ist der Test gruen, weil das Skript gar nichts tut)
//   (d) --picks-keep-days mit einem Wert, der Vintages entfernen WUERDE: laute Meldung,
//       Exit 1, und picks-history bleibt vollstaendig
//   (e) der echte CI-Aufruf (--picks-keep-days 100000 --methods-keep-days 100000) laeuft
//       weiter gruen durch und entfernt nichts
// Das Skript leitet ROOT aus __dirname/.. ab — deshalb wird es fuer den Test in ein
// temporaeres Mini-Repo kopiert und als echter Child-Process gestartet (End-to-End,
// kein Mock der Schutzlogik).
// Run: node tests/archive-picks-frozen.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

// ── Fixture: temporaeres Mini-Repo mit dem ECHTEN Skript ─────────────────────
// Alle Fixture-Daten sind alt (2026-01-*) — bei jedem realistischen keepDays-Wert
// faellt jede Datei hinter den Cutoff, der Test bleibt also datumsunabhaengig.
const OLD_DATES = ['2026-01-05', '2026-01-06', '2026-01-07'];

function mkRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'apf-'));
  fs.mkdirSync(path.join(base, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(base, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'scripts', 'archive-old-snapshots.js'),
                  path.join(base, 'scripts', 'archive-old-snapshots.js'));
  fs.copyFileSync(path.join(REPO, 'lib', 'atomic-write.js'),
                  path.join(base, 'lib', 'atomic-write.js'));
  for (const dir of ['picks-history', 'methods-history', 'prices']) {
    fs.mkdirSync(path.join(base, dir), { recursive: true });
    for (const d of OLD_DATES) {
      fs.writeFileSync(path.join(base, dir, d + '.json'), JSON.stringify({ dir, date: d }) + '\n');
    }
  }
  // Nicht-datierte Begleiter — duerfen ohnehin nie erfasst werden.
  fs.writeFileSync(path.join(base, 'picks-history', 'latest.json'), '{"latest":true}\n');
  return base;
}

function snapshot(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir).sort()) out[f] = fs.readFileSync(path.join(dir, f), 'utf8');
  return out;
}

function run(base, args) {
  const r = spawnSync(process.execPath, [path.join(base, 'scripts', 'archive-old-snapshots.js')].concat(args || []), {
    encoding: 'utf8',
    // RUN_DATE_UTC fest verdrahten: der Cutoff darf nicht vom Kalender des Laufs abhaengen.
    env: Object.assign({}, process.env, { RUN_DATE_UTC: '2026-06-01' }),
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// ── (a) + (b) + (c): Hand-Aufruf ohne jedes Flag ─────────────────────────────
check('(a) ohne Flag: picks-history bleibt byte-identisch', () => {
  const base = mkRepo();
  const before = snapshot(path.join(base, 'picks-history'));
  const r = run(base, []);
  assert.strictEqual(r.code, 0, 'Skript soll normal durchlaufen, Ausgabe:\n' + r.out);
  assert.deepStrictEqual(snapshot(path.join(base, 'picks-history')), before,
    'picks-history ist EINGEFROREN — ein Aufruf ohne --picks-keep-days darf nichts entfernen');
  assert.ok(!fs.existsSync(path.join(base, 'external-data', 'picks-history-archive')),
    'es darf nicht einmal ein picks-history-Archiv angelegt werden');
});

check('(b) ohne Flag: methods-history bleibt byte-identisch (gleiche Erb-Logik)', () => {
  const base = mkRepo();
  const before = snapshot(path.join(base, 'methods-history'));
  const r = run(base, []);
  assert.strictEqual(r.code, 0, 'Ausgabe:\n' + r.out);
  assert.deepStrictEqual(snapshot(path.join(base, 'methods-history')), before,
    'methods-history steht auf der Schutzliste — ohne --methods-keep-days nichts entfernen');
});

check('(c) ohne Flag: prices/ wird weiterhin normal archiviert (Schutz != Totalabschaltung)', () => {
  const base = mkRepo();
  const r = run(base, []);
  assert.strictEqual(r.code, 0, 'Ausgabe:\n' + r.out);
  assert.deepStrictEqual(fs.readdirSync(path.join(base, 'prices')).sort(), [],
    'prices/ ist NICHT geschuetzt und muss weiterhin rotiert werden');
  assert.ok(fs.existsSync(path.join(base, 'external-data', 'prices-archive', '2026-01.ndjson')),
    'prices-Archiv muss geschrieben worden sein');
});

// ── (d) explizites, gefaehrliches Flag ───────────────────────────────────────
check('(d) --picks-keep-days 14 (wuerde Vintages entfernen): laut + Exit 1 + Daten bleiben', () => {
  const base = mkRepo();
  const before = snapshot(path.join(base, 'picks-history'));
  const r = run(base, ['--picks-keep-days', '14']);
  assert.strictEqual(r.code, 1, 'muss abbrechen statt eingefrorene Vintages zu entfernen. Ausgabe:\n' + r.out);
  assert.ok(/::error::/.test(r.out), 'Meldung muss laut sein (::error::). Ausgabe:\n' + r.out);
  assert.ok(/eingefroren|_FROZEN\.md/i.test(r.out), 'Meldung muss auf den Einfrier-Entscheid verweisen. Ausgabe:\n' + r.out);
  assert.deepStrictEqual(snapshot(path.join(base, 'picks-history')), before,
    'nach dem Abbruch muss picks-history vollstaendig sein');
});

// ── (e) der echte CI-Aufruf bleibt gruen ─────────────────────────────────────
check('(e) CI-Aufruf (--keep-days 14 --methods-keep-days 100000 --picks-keep-days 100000) bleibt gruen', () => {
  const base = mkRepo();
  const before = snapshot(path.join(base, 'picks-history'));
  const r = run(base, ['--keep-days', '14', '--methods-keep-days', '100000', '--picks-keep-days', '100000']);
  assert.strictEqual(r.code, 0, 'CI-Aufruf muss gruen bleiben. Ausgabe:\n' + r.out);
  assert.deepStrictEqual(snapshot(path.join(base, 'picks-history')), before, 'CI entfernt nichts aus picks-history');
  assert.deepStrictEqual(fs.readdirSync(path.join(base, 'prices')).sort(), [], 'CI rotiert prices/ weiterhin');
});

// ── Der Entscheid ist auch als Datei im Verzeichnis dokumentiert ─────────────
check('(f) picks-history/_FROZEN.md existiert und nennt Stichtag + Karl-Entscheid', () => {
  const p = path.join(REPO, 'picks-history', '_FROZEN.md');
  assert.ok(fs.existsSync(p), '_FROZEN.md fehlt im picks-history-Verzeichnis');
  const t = fs.readFileSync(p, 'utf8');
  assert.ok(/2026-07-02|02\.07\.2026/.test(t), 'Stichtag 02.07.2026 muss drinstehen');
  assert.ok(/2026-08-16|16\.08\.2026/.test(t), 'Karl-Bestaetigung 16.08.2026 muss drinstehen');
  assert.ok(/board-history/.test(t), 'Nachfolger board-history muss benannt sein');
});

console.log(fail === 0 ? 'archive-picks-frozen: alle Checks ok' : 'archive-picks-frozen: ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
