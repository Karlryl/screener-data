'use strict';
/**
 * b08-boardstatus — Test-Gate fuer BH-077/BH-159 (fail-closed CORE-Allowlist).
 * ==============================================================================
 * Pinnt: unbekannte/nicht-registrierte formulaId (Tippfehler, neue Formel ohne
 * Registry-Eintrag, Nicht-Formel-IDs wie 'survival') fallen auf 'diagnostic'
 * statt still auf 'core' (der urspruengliche fail-open-Default). Die 8 Court-
 * PASSED HG-Sektoren bleiben 'core', die 5 bekannten DIAGNOSTIC-Sektoren und
 * jede quality-* Formel bleiben 'diagnostic' (Regressionsschutz, unveraendert).
 *
 * Usage:  node tests/scoring/bh-b08-boardstatus.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { boardStatus, CORE, DIAGNOSTIC } = require('../../src/scoring/board-status.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// BH-077/BH-159: der eigentliche Bug — vorher fiel jede unbekannte formulaId fail-open
// auf 'core' zurueck. 'survival' ist die reale Instanz (write-board-history.js ruft
// boardStatus() fuer jede Datei in outputs/hypergrowth/full, inkl. survival.json, das
// nie Court-gescort wurde und in keiner Registry steht).
test("boardStatus('survival') faellt fail-closed auf 'diagnostic' (vorher faelschlich 'core')", () => {
  assert.equal(boardStatus('survival'), 'diagnostic');
});

test('unbekannte/verunfallte formulaId (Tippfehler, nie registriert) -> diagnostic', () => {
  assert.equal(boardStatus('semiconductorz'), 'diagnostic'); // Tippfehler
  assert.equal(boardStatus('brand-new-sector-not-yet-in-CORE'), 'diagnostic'); // neue Formel ohne Eintrag
  assert.equal(boardStatus(''), 'diagnostic');
  assert.equal(boardStatus(undefined), 'diagnostic');
  assert.equal(boardStatus(null), 'diagnostic');
});

test('die 8 Court-PASSED HG-Sektoren bleiben core (Regression)', () => {
  for (const id of CORE) assert.equal(boardStatus(id), 'core', id);
  assert.equal(CORE.size, 8);
});

test('die 5 bekannten DIAGNOSTIC-Sektoren bleiben diagnostic (Regression)', () => {
  for (const id of DIAGNOSTIC) assert.equal(boardStatus(id), 'diagnostic', id);
});

test('CORE und DIAGNOSTIC ueberschneiden sich nicht', () => {
  for (const id of CORE) assert.ok(!DIAGNOSTIC.has(id), id + ' in beiden Sets');
});

test("jede quality-* formulaId bleibt immer diagnostic, auch bei CORE-Namensaehnlichkeit", () => {
  assert.equal(boardStatus('quality-semiconductors'), 'diagnostic');
  assert.equal(boardStatus('quality-anything'), 'diagnostic');
});

console.log(`\nbh-b08-boardstatus.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
