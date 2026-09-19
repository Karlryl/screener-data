'use strict';
/** tests/druckenmiller/scoreboard-read.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG: die Lesung rechnet genau das, was Datei B registriert — Differenz der
 * Trefferquoten (CONFIRMS minus WEAK) in Prozentpunkten, zensierte Eintraege als
 * Nicht-Ereignis, wild-cluster-Bootstrap mit Webb-Gewichten unter 30 Bloecken, L einseitig
 * unten, MDE = (z + z_beta) * SD_boot. Und sie ist reproduzierbar: derselbe Seed gibt
 * dieselbe Zahl, sonst waere eine Lesung kein Ereignis, sondern eine Stimmung.
 */
const assert = require('node:assert/strict');
const R = require('../../lib/druckenmiller/scoreboard-read.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}

/** <nC>/<nW> Eintraege mit vorgegebenen Trefferzahlen, gleichmaessig auf <blocks> Bloecke. */
function fixture(nC, upC, nW, upW, blocks, arm) {
  const out = [];
  const mach = (state, n, up) => {
    for (let i = 0; i < n; i++) {
      out.push({
        ticker: state[0] + i, arm: arm || 63, state,
        outcome: i < up ? 'UP' : (i % 3 === 0 ? 'CENSORED' : 'DOWN'),
        block: i % (blocks || 1),
      });
    }
  };
  mach('CONFIRMS', nC, upC); mach('WEAK', nW, upW);
  return out;
}

test('B1 Punktschaetzung in Prozentpunkten, und ohne Kontrast gibt es keine', () => {
  const e = fixture(100, 60, 100, 40, 10);
  const pe = R.pointEstimate(e);
  assert.ok(Math.abs(pe.theta - 20) < 1e-9, 'theta: ' + pe.theta);
  assert.equal(pe.nC, 100); assert.equal(pe.nW, 100);
  assert.equal(R.pointEstimate(fixture(10, 5, 0, 0, 2)).theta, null, 'eine leere Seite = keine Differenz');
});

test('B2 zensiert zaehlt als NICHT-Ereignis (nur UP ist ein Treffer)', () => {
  const e = [
    { ticker: 'A', arm: 63, state: 'CONFIRMS', outcome: 'UP', block: 0 },
    { ticker: 'B', arm: 63, state: 'CONFIRMS', outcome: 'CENSORED', block: 1 },
    { ticker: 'C', arm: 63, state: 'WEAK', outcome: 'DOWN', block: 0 },
    { ticker: 'D', arm: 63, state: 'WEAK', outcome: 'CENSORED', block: 1 },
  ];
  const pe = R.pointEstimate(e);
  assert.equal(pe.pC, 0.5, 'ein UP von zwei');
  assert.equal(pe.pW, 0, 'DOWN und CENSORED sind beide kein Treffer');
  assert.ok(Math.abs(pe.theta - 50) < 1e-9);
});

test('B3 die Einfluss-Beitraege summieren auf 0, die Blocksummen zaehlen die Cluster', () => {
  const e = fixture(60, 30, 60, 20, 6);
  const pe = R.pointEstimate(e);
  const infl = R.influences(e, pe);
  assert.ok(Math.abs(infl.reduce((a, b) => a + b, 0)) < 1e-9, 'Summe: ' + infl.reduce((a, b) => a + b, 0));
  assert.equal(R.blockSums(e, infl).length, 6);
});

test('B4 das Schema haengt an der Blockzahl (wild unter 30, sonst Cluster)', () => {
  const wenig = R.readArm({ entries: fixture(60, 40, 60, 20, 8), alphaStar: 0.0083, beta: 0.2, B: 200 });
  assert.equal(wenig.scheme, 'wild-cluster-webb');
  assert.equal(wenig.blocks, 8);
  const viel = R.readArm({ entries: fixture(120, 80, 120, 40, 40), alphaStar: 0.0083, beta: 0.2, B: 200 });
  assert.equal(viel.scheme, 'cluster-bootstrap');
  assert.equal(R.WILD_MAX_BLOCKS, 30);
});

test('B5 dieselbe Lesung mit demselben Seed gibt dieselbe Zahl', () => {
  const e = fixture(80, 50, 80, 30, 9);
  const a = R.readArm({ entries: e, alphaStar: 0.0083, beta: 0.2, B: 500, seed: 20260919 });
  const b = R.readArm({ entries: e, alphaStar: 0.0083, beta: 0.2, B: 500, seed: 20260919 });
  const c = R.readArm({ entries: e, alphaStar: 0.0083, beta: 0.2, B: 500, seed: 1 });
  assert.equal(a.L, b.L); assert.equal(a.MDE, b.MDE);
  assert.notEqual(a.L, c.L, 'ein anderer Seed muss eine andere Ziehung geben');
  assert.equal(a.pFloor, 1 / 500);
});

test('B6 probit und die MDE-Formel aus [REV9-2]', () => {
  assert.ok(Math.abs(R.probit(0.975) - 1.959963985) < 1e-6, 'z_0,975: ' + R.probit(0.975));
  assert.ok(Math.abs(R.probit(0.8) - 0.841621234) < 1e-6);
  // Kein geratenes Literal fuer alpha* = 0,0083: geprueft wird die Umkehrung selbst, gegen
  // eine numerisch integrierte Normalverteilung (Simpson, 20.000 Schritte).
  const Phi = (z) => {
    const n = 20000, a = -12, h = (z - a) / n;
    let s = 0;
    for (let i = 0; i <= n; i++) {
      const x = a + i * h;
      const w = i === 0 || i === n ? 1 : (i % 2 ? 4 : 2);
      s += w * Math.exp(-0.5 * x * x);
    }
    return (h / 3) * s / Math.sqrt(2 * Math.PI);
  };
  const zStar = R.probit(1 - 0.0083);
  assert.ok(Math.abs(Phi(zStar) - (1 - 0.0083)) < 1e-7, `Phi(z*) = ${Phi(zStar)}, erwartet ${1 - 0.0083}`);
  assert.ok(zStar > 2.39 && zStar < 2.40, 'z_(1-alpha*) liegt bei 2,395: ' + zStar);
  const e = fixture(80, 50, 80, 30, 9);
  const l = R.readArm({ entries: e, alphaStar: 0.0083, beta: 0.2, B: 400, seed: 7 });
  const erwartet = (R.probit(1 - 0.0083) + R.probit(1 - 0.2)) * l.sdBoot;
  assert.ok(Math.abs(l.MDE - erwartet) < 1e-9, 'MDE weicht von der Formel ab');
  assert.ok(Math.abs(l.L - (l.theta - R.probit(1 - 0.0083) * l.sdBoot)) < 1e-9, 'L ist die einseitige Untergrenze');
  assert.ok(l.L < l.theta, 'die Untergrenze liegt unter der Punktschaetzung');
});

test('B7 Firmen-Verschachtelung wird geprueft, nicht behauptet', () => {
  const sauber = fixture(30, 15, 30, 10, 6);
  assert.equal(R.assertFirmNesting(sauber).ok, true);
  const doppelt = sauber.concat([{ ticker: sauber[0].ticker, arm: 63, state: 'CONFIRMS', outcome: 'UP', block: sauber[0].block }]);
  const v = R.assertFirmNesting(doppelt);
  assert.equal(v.ok, false, 'zwei Eintraege derselben Firma im selben Block und Arm muessen auffallen');
  assert.equal(v.violations[0].n, 2);
  // Und der Befund reist in der Lesung mit, statt still zu bleiben.
  assert.equal(R.readArm({ entries: doppelt, alphaStar: 0.0083, beta: 0.2, B: 100 }).firmNesting.ok, false);
});

test('B8 ohne Kontrast ist die Lesung nicht lesbar — L ist null, nicht 0', () => {
  const l = R.readArm({ entries: fixture(10, 5, 0, 0, 2), alphaStar: 0.0083, beta: 0.2, B: 100 });
  assert.equal(l.readable, false);
  assert.equal(l.L, null); assert.equal(l.MDE, null); assert.equal(l.sdBoot, null);
  assert.equal(l.reason, 'no-contrast');
});

test('B9 mehr Bloecke, engere Streuung (die Blockzahl ist die Waehrung, nicht n)', () => {
  // Dieselbe Trefferstruktur, einmal in 4 Bloecken, einmal in 20 — die Streuung der
  // Schaetzgroesse muss mit der Blockzahl fallen, sonst zaehlt der Bootstrap Eintraege
  // statt Cluster.
  const eng = R.readArm({ entries: fixture(100, 60, 100, 40, 4), alphaStar: 0.0083, beta: 0.2, B: 800, seed: 3 });
  const weit = R.readArm({ entries: fixture(100, 60, 100, 40, 20), alphaStar: 0.0083, beta: 0.2, B: 800, seed: 3 });
  assert.ok(weit.sdBoot < eng.sdBoot, `SD sollte mit mehr Bloecken fallen: ${weit.sdBoot} vs ${eng.sdBoot}`);
  assert.ok(weit.MDE < eng.MDE);
});

console.log('\nscoreboard-read.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
