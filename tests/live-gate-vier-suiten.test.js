// tests/live-gate-vier-suiten.test.js — Standalone-Runner (framework-los).
// Run: node tests/live-gate-vier-suiten.test.js
//
// WOFUER (06.09.2026, Worker 3, Master-Entscheid): vier Suiten unter tests/scoring liefen seit
// Tag 948 (11.08.) in KEINEM Job mit echtem Universum — pre-pull-Gate und PR-Check skippen sie
// bewusst (scripts/test-gate.js:205-219), und der scoring-Job fuhr im Live-Universum-Gate nur
// sechs andere. Gemessen mit 15.044 und 16.092 Snapshots: calib-parity 4 ok, calibration 4 ok,
// fairness-guards 5 ok, rev-growth-anzeige 4 ok. Dieser Waechter pinnt, dass die vier im
// Live-Universum-Gate-Step von daily-pull.yml aufgerufen werden — faellt eine heraus, ist sie
// wieder nirgends belegt. calibration-ref ist ABSICHTLICH nicht dabei (R2.9 Test B faellt am
// heutigen Universum an seiner Vorbedingung; Ratspunkt) — hier NICHT gepinnt, damit ein
// spaeterer Rats-Entscheid den Step ohne diesen Waechter aendern kann.
// Der versiegelte bh-b09-dailyyml.test.js pinnt weiterhin die sechs urspruenglichen Suiten.
// Sabotage-Nachweis (Anker 06.09. N13): calibration.test.js aus dem Step entfernt -> L1 rot.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8');
function section(startMarker, endMarker) {
  const a = yml.indexOf(startMarker);
  assert.ok(a >= 0, startMarker + ' nicht gefunden');
  const b = yml.indexOf(endMarker, a);
  assert.ok(b > a, endMarker + ' nicht nach dem Start gefunden');
  return yml.slice(a, b);
}
const VIER = ['calib-parity.test.js', 'calibration.test.js', 'fairness-guards.test.js', 'rev-growth-anzeige.test.js'];

check('L1: die vier Suiten stehen im Aufruf des Live-Universum-Gate-Steps (scoring-Job)', () => {
  const s = section('name: Live-Universum-Gate', 'name: Gate-Ergebnis belegen');
  const aufruf = s.slice(s.indexOf('live-universum-gate.js'), s.indexOf('2>&1)'));
  assert.ok(aufruf.length > 0, 'Aufruf von live-universum-gate.js nicht gefunden');
  for (const t of VIER) assert.ok(aufruf.includes('tests/scoring/' + t), t + ' fehlt im Live-Universum-Gate-Aufruf');
});
check('L2: die vier Dateien existieren und tragen den Universums-Seam (SCREENER_SNAPSHOTS_DIR), sonst kann das Gate sie nicht gegen echte Snapshots fahren', () => {
  for (const t of VIER) {
    const p = path.join(__dirname, 'scoring', t);
    assert.ok(fs.existsSync(p), p + ' fehlt');
    assert.ok(fs.readFileSync(p, 'utf8').includes('SCREENER_SNAPSHOTS_DIR'), t + ' ohne SCREENER_SNAPSHOTS_DIR-Seam');
  }
});
check('L3: genau EIN Live-Universum-Gate-Step (der versiegelte bh-b09-Waechter verlangt das; ein zweiter zaehlte doppelt)', () => {
  const n = yml.split('name: Live-Universum-Gate').length - 1;
  assert.strictEqual(n, 1, n + ' Steps mit diesem Namen');
});

if (fail) { console.log('FAIL: live-gate-vier-suiten (' + fail + ')'); process.exit(1); }
console.log('OK: live-gate-vier-suiten (06.09.2026)');
