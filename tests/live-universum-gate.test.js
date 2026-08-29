'use strict';
/**
 * Waechter des Live-Universum-Gates (T147, 29.08.2026).
 *
 * DIE SACHE: erkennt das Gate einen Lauf, der NICHTS gemessen hat — unabhaengig davon, wie
 * der Test seine Skip-Meldung formuliert? Die alte Absicherung war ein Grep auf das Wort
 * `pre-pull-Gate`; ein umformulierter Skip lief still als PASS durch (L32 in neuer Gestalt).
 *
 * Geprueft wird in BEIDE Richtungen: der Positiv-Beleg muss halten (echter Lauf = ok) UND
 * jede Gestalt von "nichts gemessen" muss auffliegen (0 ok · keine Abschlusszeile · Skip
 * ohne das Sentinel-Wort · Exit != 0 · rote Pruefungen).
 *
 * Hermetisch: keine Testlaeufe, kein Netz, keine Snapshots — nur die reinen Funktionen.
 *
 * Usage: node tests/live-universum-gate.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { leseAbschluss, beurteile, TESTS, SENTINEL } = require('../scripts/live-universum-gate.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// Echte Ausgaben vom 29.08.2026, Universum 15.044 Snapshots.
const A = 'tests/scoring/anchors.rank.test.js';
const S = 'tests/scoring/score.integration.test.js';
const ECHT_OK = 'anchors.rank.test.js: 5 ok, 0 fail';
const ECHT_MIT_SKIP = 'score.integration.test.js: 33 ok, 0 fail, 1 skipped (kein Universum)';

check('Abschlusszeile wird gelesen — mit und ohne skipped-Teil', () => {
  assert.deepEqual(leseAbschluss(ECHT_OK, A), { ok: 5, fail: 0, skipped: 0 });
  assert.deepEqual(leseAbschluss(ECHT_MIT_SKIP, S), { ok: 33, fail: 0, skipped: 1 });
  assert.deepEqual(leseAbschluss('x.test.js: 0 ok, 2 fail', 'x.test.js'), { ok: 0, fail: 2, skipped: 0 });
});

check('ohne Abschlusszeile gibt es KEINE erfundene Auskunft', () => {
  assert.equal(leseAbschluss('', A), null);
  assert.equal(leseAbschluss('irgendein Text ohne Bilanz', A), null);
  assert.equal(leseAbschluss(null, A), null);
});

check('die LETZTE Bilanzzeile gewinnt, nicht eine zufaellige aus der Mitte', () => {
  const out = 'zwischendrin: 99 ok, 0 fail\nmehr Text\nanchors.rank.test.js: 4 ok, 0 fail';
  assert.deepEqual(leseAbschluss(out, A), { ok: 4, fail: 0, skipped: 0 });
});

// Review-Befund 29.08.: rueckwaerts zu suchen schuetzt vor Rauschen VOR der Bilanzzeile,
// nicht danach. Der Dateiname als Anker schliesst die Luecke — eine spaetere Fremdzeile
// kann den echten Abschluss nicht mehr ueberstimmen.
check('eine Fremdzeile NACH dem Abschluss ueberstimmt ihn nicht', () => {
  const out = 'anchors.rank.test.js: 5 ok, 0 fail\nnachklapp: 0 ok, 0 fail';
  assert.deepEqual(leseAbschluss(out, A), { ok: 5, fail: 0, skipped: 0 },
    'ohne Datei-Anker haette die Nachklapp-Zeile gewonnen und 0 gemessene Pruefungen vorgetaeuscht');
  // Gegenrichtung: die Bilanz eines FREMDEN Tests zaehlt nicht als eigene.
  assert.equal(leseAbschluss('quality-board.test.js: 27 ok, 0 fail', A), null);
});

check('ein echter Lauf ist ok — auch mit legitimem datenbedingtem Skip', () => {
  assert.equal(beurteile(A, 0, ECHT_OK).status, 'ok');
  const r = beurteile(S, 0, ECHT_MIT_SKIP);
  assert.equal(r.status, 'ok', 'ein dauerhafter datenbedingter Skip darf nicht taeglich falsch-rot machen');
  assert.equal(r.skipped, 1, 'die Zahl wird trotzdem berichtet, nicht verschluckt');
});

// DER KERN VON T147: "nichts gemessen" fliegt auf, egal wie der Skip HEISST.
check('0 bestandene Pruefungen fliegen auf — ohne jedes Sentinel-Wort', () => {
  const r = beurteile('c.test.js', 0, 'c.test.js: 0 ok, 0 fail');
  assert.equal(r.status, 'nichts-gemessen');
  assert.match(r.grund, /nichts belegt/);
});

check('eine UMFORMULIERTE Skip-Meldung wird trotzdem gefangen', () => {
  // Genau der Fall, an dem die alte Grep-Absicherung vorbeilief:
  const out = 'skip: Universum zu klein, Anker uebersprungen\nd.test.js: 0 ok, 0 fail';
  assert.doesNotMatch(out, new RegExp(SENTINEL), 'Vorbedingung: das alte Sentinel-Wort kommt NICHT vor');
  assert.equal(beurteile('d.test.js', 0, out).status, 'nichts-gemessen');
});

check('fehlender Bericht ist ein Befund, kein Durchwinken', () => {
  assert.equal(beurteile('e.test.js', 0, 'Test lief, sagt aber nichts').status, 'kein-bericht');
});

check('echte Fehler bleiben echte Fehler (Exitcode und rote Pruefungen)', () => {
  assert.equal(beurteile('f.test.js', 1, 'f.test.js: 10 ok, 0 fail').status, 'fail');
  assert.equal(beurteile('g.test.js', 0, 'g.test.js: 9 ok, 1 fail').status, 'fail');
});

check('das alte Sentinel bleibt als Zusatz wirksam (Guertel und Hosentraeger)', () => {
  const out = `warnung ${SENTINEL}: Anker uebersprungen\nh.test.js: 3 ok, 0 fail`;
  assert.equal(beurteile('h.test.js', 0, out).status, 'geskippt');
});

check('die Testliste deckt sich mit dem, was der Workflow fuehrt', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8');
  assert.match(yml, /node scripts\/live-universum-gate\.js/, 'der Job muss das Gate aufrufen');
  // Anwesenheit: das maschinenlesbare Ergebnis wird geprueft — fehlende Datei = rot (T147).
  assert.match(yml, /outputs\/live-universum-gate\.json/, 'die Ergebnisdatei muss im Workflow geprueft werden');
  for (const t of TESTS) assert.ok(fs.existsSync(path.join(__dirname, '..', t)), `${t} fehlt`);
});

console.log('\nlive-universum-gate: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
