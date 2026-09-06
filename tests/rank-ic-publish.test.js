// tests/rank-ic-publish.test.js — Standalone-Runner (framework-los).
// Run: node tests/rank-ic-publish.test.js
//
// WOFUER (06.09.2026, Worker 3, Master-Entscheid): scripts/rank-ic.js hatte keinen automatisierten
// Erzeuger (nur Handlaeufe, letzter 27.07.; outputs/ gitignored, nichts auf gh-pages). daily-pull.yml
// erzeugt den Report jetzt im scoring-Job NACH dem Vintage-Commit und VOR dem F-17a-Publish, der ihn
// als outputs/rank-ic/rank-ic-report.json in den Datenkanal traegt. Gepinnt wird die SACHE: der
// Schritt und seine Lage (R1), seine zwei Ausgaenge am ausgefuehrten Shell-Block (R2: < 2 Vintages =
// ::error:: + Exit 1; R3: SUSPECT-Tag = ::warning:: + Exit 0 ohne Report), und die Kopie im
// Publish-Schleifenkoerper zwischen board-history-Kopie und git add (R4). rank-ic.js selbst bleibt
// unveraendert (tests/rank-ic.test.js).
// Sabotage-Nachweis (Anker 06.09. N21): Guard `-lt 2` auf `-lt 0` -> R2 rot; Kopie-Zeile entfernt -> R4 rot;
// continue-on-error entfernt -> R5 rot.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}
const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8');
const STEP = 'name: Rank-IC-Report erzeugen (2.8, Datenkanal)';
const COMMIT = 'name: Commit board-history vintage to main';
const F17A = 'name: Publish board-history vintages to public data channel (F-17a)';

function runBlock(stepName) {
  const i = yml.indexOf(stepName);
  assert.ok(i > 0, stepName + ' nicht gefunden');
  const r = yml.indexOf('run: |', i);
  const rest = yml.slice(r + 'run: |'.length + 1);
  const lines = [];
  for (const l of rest.split('\n')) { if (l.trim() === '' || l.startsWith('          ')) lines.push(l.slice(10)); else break; }
  return lines.join('\n');
}
function bashLauf(block, cwd, env) {
  const script = block.replace('${{ steps.vintage.outputs.rc }}', '$VINTAGE_RC_STUB');
  const r = spawnSync('bash', ['-c', script], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), error: r.error };
}

check('R1: der Erzeuger-Schritt liegt im scoring-Job NACH dem Vintage-Commit und VOR dem F-17a-Publish, genau einmal', () => {
  const s = yml.indexOf('\n  scoring:');
  const c = yml.indexOf(COMMIT, s), e = yml.indexOf(STEP, s), p = yml.indexOf(F17A, s);
  assert.ok(c > s && e > c && p > e, 'Reihenfolge Commit -> Rank-IC -> F-17a verletzt');
  assert.strictEqual(yml.split(STEP).length - 1, 1, 'Schritt nicht genau einmal');
  assert.ok(/node scripts\/rank-ic\.js --history-dir board-history --out _public\/rank-ic-report\.json/.test(runBlock(STEP)), 'rank-ic-Aufruf mit Ziel _public fehlt');
});
check('R2: < 2 Vintages -> ::error:: + Exit 1, kein Report (Shell-Block ausgefuehrt)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rankic-'));
  fs.mkdirSync(path.join(dir, 'board-history', '2026-09-01'), { recursive: true });
  const r = bashLauf(runBlock(STEP), dir, { VINTAGE_RC_STUB: '0' });
  assert.ok(!r.error, 'bash nicht ausfuehrbar: ' + (r.error && r.error.message));
  assert.strictEqual(r.code, 1, 'Exit ' + r.code + '\n' + r.out);
  assert.ok(/::error::rank-ic: nur 1 Vintage-Verzeichnis/.test(r.out), r.out);
  assert.ok(!fs.existsSync(path.join(dir, '_public', 'rank-ic-report.json')), 'Report trotz Fehler geschrieben');
});
check('R3: SUSPECT-Tag (rc != 0) -> ::warning:: + Exit 0, kein Report, rank-ic wird NICHT aufgerufen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rankic-'));
  for (const v of ['2026-09-01', '2026-09-05']) fs.mkdirSync(path.join(dir, 'board-history', v), { recursive: true });
  const r = bashLauf(runBlock(STEP), dir, { VINTAGE_RC_STUB: '2' });
  assert.strictEqual(r.code, 0, 'Exit ' + r.code + '\n' + r.out);
  assert.ok(/::warning::rank-ic uebersprungen: Vintage-rc=2/.test(r.out), r.out);
  assert.ok(!fs.existsSync(path.join(dir, '_public')), '_public angelegt, obwohl uebersprungen');
});
check('R4: der F-17a-Schleifenkoerper kopiert den Report NACH der board-history-Kopie und VOR git add -A, und meldet sein Fehlen sichtbar', () => {
  const b = runBlock(F17A);
  const iCp = b.indexOf('cp -r ../_public/board-history outputs/board-history');
  const iRic = b.indexOf('cp ../_public/rank-ic-report.json outputs/rank-ic/rank-ic-report.json');
  const iAdd = b.indexOf('git add -A');
  assert.ok(iCp > 0 && iRic > iCp && iAdd > iRic, 'Kopie-Reihenfolge board-history -> rank-ic -> git add verletzt');
  assert.ok(/nicht erzeugt .* Vortags-Report/.test(b), 'Fehlen des Reports wird nicht gemeldet');
});

check('R5: der Erzeuger traegt continue-on-error: true — ein rank-ic-Fehler darf den F-17a-Publish der board-history nicht blocken (Review 06.09.)', () => {
  const i = yml.indexOf(STEP);
  const kopf = yml.slice(i, yml.indexOf('run: |', i));
  assert.ok(/
s+continue-on-error: true
/.test(kopf), 'continue-on-error fehlt am Erzeuger-Schritt');
  const p = yml.indexOf(F17A);
  const kopfP = yml.slice(p, yml.indexOf('run: |', p));
  assert.ok(/if: success()/.test(kopfP), 'F-17a haengt nicht mehr an if: success() — dann waere diese Probe gegenstandslos');
});

if (fail) { console.log('FAIL: rank-ic-publish (' + fail + ')'); process.exit(1); }
console.log('OK: rank-ic-publish (06.09.2026)');
