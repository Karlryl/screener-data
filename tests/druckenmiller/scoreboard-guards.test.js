'use strict';
/** tests/druckenmiller/scoreboard-guards.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG: die drei Waechter, die Rat 9 Teil 2a (2026-09-19) zur Bedingung der
 * horizont-skalierten Barriere gemacht hat, sind da UND sie feuern. Jeder wird hier einmal
 * absichtlich gebrochen:
 *   G-S1  die in Datei B genannte Skalierung ist der Zweig, der laeuft — kein Default
 *   G-S2  der Arm-Kollaps-Waechter auf der FESTEN Stichprobe (KS + Median)
 *   G-S3  die Zahl formal getrennter Arme IST das N der alpha*-Korrektur
 * Dazu G-S4: das Amendment liegt im Repo, sein Sidecar stimmt, und Datei B nennt genau
 * diesen Hash — eine Regel, die auf ein Dokument zeigt, das man nicht nachrechnen kann, ist
 * keine Regel.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const S = require('../../lib/druckenmiller/scoreboard.js');

const REPO = path.resolve(__dirname, '..', '..');
const PROTO = path.join(REPO, 'protocol');
const STICHPROBE = require('./fixtures/arm-collapse-sample.json');
const KONSTANTEN = require('./fixtures/spec-constants.json');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}

/** Datei B, solange sie Entwurf ist, danach die gehashte Datei. Der Test laeuft auf beiden. */
function dateiB() {
  const treffer = fs.readdirSync(PROTO)
    .filter((f) => /^druckenmiller_scoreboard_registered_\d{8}\.json(\.DRAFT)?$/.test(f)).sort();
  assert.equal(treffer.length, 1, 'genau eine Datei B erwartet, gefunden: ' + treffer.join(', '));
  const datei = path.join(PROTO, treffer[0]);
  return { name: treffer[0], json: JSON.parse(fs.readFileSync(datei, 'utf8')), istEntwurf: treffer[0].endsWith('.DRAFT') };
}

test('G-S1 die registrierte Skalierung ist ein implementierter Zweig, und Unsinn wirft', () => {
  const b = dateiB();
  assert.equal(b.json.barrier.sigmaScaling, 'horizon', 'Rat 9 Teil 2a: H ist ratifiziert');
  const zweig = S.assertScalingBranch(b.json.barrier.sigmaScaling);
  assert.equal(zweig.scaling, 'horizon');
  assert.ok(Math.abs(zweig.factorAt63 - Math.sqrt(63)) < 1e-12, 'der Faktor bei 63 ist sqrt(63)');
  assert.ok(Math.abs(zweig.factorAt126 - Math.sqrt(126)) < 1e-12);
  // BRUCHPROBE: ein nicht implementierter Name darf nicht still auf einen Default fallen.
  assert.throws(() => S.assertScalingBranch('annualized'), /Barrieren-Skalierung/);
  assert.throws(() => S.assertScalingBranch(undefined), /Barrieren-Skalierung/);
});

test('G-S1b der Tageslauf gibt die REGISTRIERTE Skalierung weiter, nicht eine eigene', () => {
  const quelle = fs.readFileSync(path.join(REPO, 'scripts', 'druckenmiller-log-internals.js'), 'utf8');
  assert.match(quelle, /chunk2 && chunk2\.barrier && chunk2\.barrier\.sigmaScaling/,
    'der Logger liest die Skalierung aus Datei B');
  assert.match(quelle, /scoreboard\.resolveEntry\(e, vorwaerts, skalierung\)/,
    'und gibt genau sie an die Aufloesung weiter');
  assert.ok(!/resolveEntry\([^)]*['"](daily|horizon)['"]\s*\)/.test(quelle),
    'kein hartkodierter Skalierungs-Name im Tagespfad');
});

test('G-S2 Arm-Kollaps-Waechter auf der festen Stichprobe: die Arme unterscheiden sich', () => {
  const t = KONSTANTEN.scoreboardB.armCollapseGuard;
  const r = S.armCollapseCheck(STICHPROBE.resolvedBars['63'], STICHPROBE.resolvedBars['126'], t);
  assert.equal(STICHPROBE.scaling, 'horizon', 'die Stichprobe ist unter H gerechnet');
  assert.equal(r.differ, true, 'unter H muessen sich die Aufloesungszeiten unterscheiden');
  assert.equal(r.blocksScoring, false);
  assert.ok(r.ks.Dscaled >= t.ksScaledMin, `KS D*sqrt(ne) = ${r.ks.Dscaled} < ${t.ksScaledMin}`);
  assert.ok(r.medianRatio >= t.medianRatioMin, `Median-Verhaeltnis = ${r.medianRatio}`);
  // Die gemessenen Zahlen aus dem Amendment, gegen die Stichprobe nachgerechnet.
  assert.equal(r.median63, 31); assert.equal(r.median126, 58);
  assert.ok(Math.abs(r.ks.D - 0.45) < 0.005, 'KS D: ' + r.ks.D);
});

test('G-S2b BRUCHPROBE: kollabieren die Arme, wird NICHT gewertet', () => {
  const t = KONSTANTEN.scoreboardB.armCollapseGuard;
  const gleich = S.armCollapseCheck(STICHPROBE.resolvedBars['63'], STICHPROBE.resolvedBars['63'], t);
  assert.equal(gleich.differ, false, 'zwei identische Verteilungen unterscheiden sich nicht');
  assert.equal(gleich.blocksScoring, true, 'und dann darf nicht gewertet werden');
  assert.match(gleich.reason, /arm-collapse/);
  // Und die woertliche Lesung L ist genau der Fall, gegen den der Waechter steht: unter L
  // liegen beide Median-Aufloesungszeiten bei ~3 Balken.
  const unterL = S.armCollapseCheck([3, 2, 4, 3, 1, 5, 3, 2], [3, 2, 4, 3, 1, 5, 3, 2], t);
  assert.equal(unterL.blocksScoring, true);
});

test('G-S3 die Zahl der Arme IST das N der alpha*-Korrektur', () => {
  const zwei = S.armsMatchAlphaStar([63, 126]);
  assert.equal(zwei.arms, 2);
  assert.equal(zwei.alphaStar, KONSTANTEN.scoreboardB.alphaStar.twoArm);
  assert.equal(zwei.ok, true);
  // BRUCHPROBE: ein gestrichener Arm aendert alpha* — und faellt auf.
  const einer = S.armsMatchAlphaStar([63]);
  assert.equal(einer.alphaStar, KONSTANTEN.scoreboardB.alphaStar.singleArm);
  assert.equal(einer.ok, false, 'ein Arm weniger darf nicht als "in Ordnung" durchgehen');
  const drei = S.armsMatchAlphaStar([63, 126, 252]);
  assert.equal(drei.ok, false, 'ein Arm mehr auch nicht');
});

test('G-S4 das Amendment liegt nachrechenbar im Repo und Datei B nennt seinen Hash', () => {
  const datei = path.join(PROTO, 'BUILD-SPEC-v1-AMENDMENT-01-barrier-scaling.md');
  assert.ok(fs.existsSync(datei), 'das Amendment fehlt im Repo — dann zeigt Datei B auf ein Gespenst');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(datei, 'utf8'), 'utf8').digest('hex');
  const sidecar = fs.readFileSync(datei + '.sha256', 'utf8').trim().split(/\s+/)[0];
  assert.equal(hash, sidecar, 'Sidecar und Datei stimmen nicht ueberein');
  const b = dateiB();
  assert.equal(b.json._amendment01.sha256, hash, 'Datei B nennt einen anderen Amendment-Hash');
  assert.equal(KONSTANTEN.scoreboardB._amendment01Sha256, hash, 'spec-constants nennt einen anderen');
  const text = fs.readFileSync(datei, 'utf8');
  assert.match(text, /σ_h = σ_daily · √h/, 'der ratifizierte Wortlaut steht drin');
  assert.match(text, /never a scored forward entry/, 'die Offenlegung des Zugriffs steht drin');
});

test('G-S5 Datei B traegt die Offenlegung und den Geltungssatz, nicht nur die Zahl', () => {
  const b = dateiB();
  assert.ok(b.json.priorAccess && b.json.priorAccess.date === '2026-09-19', 'priorAccess fehlt');
  assert.ok(Array.isArray(b.json.priorAccess.evaluationsSeen) && b.json.priorAccess.evaluationsSeen.length >= 4);
  assert.match(b.json.priorAccess.claim, /KEINE Behauptung zugriffsfreier Methodenwahl/);
  assert.match(b.json.scopeSentence, /Breite und Beobachtungs-DAUER gemeinsam|BREITE und Beobachtungs-DAUER/,
    'der Geltungssatz aus Bedingung 5 fehlt');
  assert.equal(b.json.barrier.scalingCheck.tippingConditionMet, false);
  assert.ok(b.json.barrier.scalingCheck.h126.ratio < 1.3,
    'die Kipp-Bedingung (> ~30 % Abweichung bei 126) waere gerissen: ' + b.json.barrier.scalingCheck.h126.ratio);
  assert.equal(b.json.horizons.length, 2, 'der 126-Arm bleibt (Bedingung 4)');
});

console.log('\nscoreboard-guards.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
