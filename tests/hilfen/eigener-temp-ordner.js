'use strict';
// Owned temp directories for the board-history tests (P94/P97, 06.10.2026).
//
// THE PROBLEM: the board-history tests created their fixture roots with
// fs.mkdtempSync(os.tmpdir() + prefix) and never removed them; one full gate left
// thousands of bh* directories in %TEMP% (P94: ~49,800 test dirs on one day, and
// tests/in-nse-adapter.test.js then failed with EBUSY in the overfull folder).
//
// THE RULE: a test gets its temp root ONLY from here. The directory is created
// and its removal registered in the same call, so no test can forget it. Removal
// runs on process 'exit', which also fires after process.exit(), an assertion that
// ends a check()-style runner, and an uncaught exception. Only directories created
// by this module are removed; the real %TEMP% is never swept.
// Guard: tests/eigener-temp-ordner.test.js (break-once: drop the registration).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const eigene = new Set();
let angemeldet = false;

/**
 * Removes every directory this module created; failures are reported, never thrown.
 * @returns {void}
 */
function raeumeAuf() {
  for (const dir of eigene) {
    try { fs.rmSync(dir, { recursive: true, force: true }); }
    catch (e) { process.stderr.write('eigener-temp-ordner: konnte ' + dir + ' nicht entfernen: ' + e.message + '\n'); }
  }
  eigene.clear();
}

/**
 * Creates a fresh directory under os.tmpdir() and registers its removal at process exit.
 * @param {string} prefix Name prefix, e.g. 'bh-lauf-' (as for fs.mkdtempSync).
 * @returns {string} Absolute path of the new directory.
 */
function eigenerTempOrdner(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  eigene.add(dir);
  if (!angemeldet) { angemeldet = true; process.once('exit', raeumeAuf); }
  return dir;
}

module.exports = { eigenerTempOrdner, raeumeAuf };
