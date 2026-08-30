'use strict';
/**
 * Wachposten: das FEM-SEC-US@1.2.0-Siegel wird ab jetzt bei JEDEM Lauf geprueft.
 * =============================================================================
 * Befund ENTSCHIED 60 (2026-08-30): verifyManifest() existierte seit dem
 * 08.08. und wurde von NICHTS aufgerufen. Das Siegel war seit dem 09.08.
 * (6c2ce83755) gebrochen und 21 Tage lang hat es niemand gemerkt -- nicht weil
 * die Pruefung fehlte, sondern weil sie nie lief. Ein Pruefer, den kein Job
 * startet, ist kein Pruefer.
 *
 * Diese Datei IST die Verdrahtung. Sie liegt unter tests/ und ist NICHT in
 * REPORT_FILES von scripts/test-gate.js eingetragen, faellt also unter den Glob
 * 'tests/*test.js' der BLOCKIERENDEN Spur -- in pr-check.yml (--mode=all) wie im
 * Tageslauf (--mode=blocking). Kein neuer Workflow-Schritt, keine zweite
 * Pruef-Implementierung: genau der Pruefer, den das Repo schon hat.
 *
 * Geprueft wird an EINEM Objekt, in beide Richtungen:
 *   (a) ANWESENHEIT -- mit dem Drift-Record ist das Siegel gruen
 *   (b) ABWESENHEIT -- ohne den Drift-Record wird es ROT, und zwar genau an den
 *       drei dort verzeichneten Dateien. Das ist die Bruch-Probe: sie beweist,
 *       dass der Pruefer wirklich Bytes vergleicht und das gruene Ergebnis aus
 *       dem Record kommt und nicht aus einem stillen Durchwinken.
 *   (c) der Ahnen-Pin auf das 1.0.0-Manifest haelt (Bindeglied der Siegelkette)
 *
 * Angefasst wird ausschliesslich der Drift-Record, nie eine versiegelte Datei,
 * und auch der nur per Umbenennung mit finally-Wiederherstellung.
 * Run: node tests/early-detection-siegel-wachposten.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { verifyManifest } = require('../scripts/early-detection-audit.js');

const ROOT = path.resolve(__dirname, '..');
const PROTOCOL_120 = path.join(ROOT, 'protocol', 'early-detection', '1.2.0');
const PARENT_MANIFEST = path.join(ROOT, 'protocol', 'early-detection', '1.0.0', 'hash-manifest.json');
const PARENT_MANIFEST_SHA256 = 'bccdb61fa9ba73ee578049e9a4069a9db106bf90270d2b0fc6f167227c7cec42';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack ? e.stack : e)); }
}

const driftRecords = () => fs.readdirSync(PROTOCOL_120).filter((n) => /^drift-record-.*\.json$/.test(n));

// ── (a) Anwesenheit: der Normalzustand ist gruen ──────────────────────────────
test('(a) das 1.2.0-Siegel verifiziert auf dem aktuellen Stand', () => {
  const manifest = verifyManifest();
  assert.equal(manifest.protocol, 'FEM-SEC-US@1.2.0');
  assert.equal(Object.keys(manifest.files).length, 14, 'das Siegel deckt 14 Dateien ab');
});

// ── (b) Bruch-Probe: ohne Record faellt genau der dokumentierte Drift auf ──────
test('(b) ohne den Drift-Record wird das Siegel ROT -- an genau den verzeichneten Dateien', () => {
  const namen = driftRecords();
  assert.equal(namen.length, 1, 'genau ein Drift-Record erwartet');
  const echt = path.join(PROTOCOL_120, namen[0]);
  const record = JSON.parse(fs.readFileSync(echt, 'utf8'));
  const erwartet = record.driftedFiles.map((e) => e.path).sort();
  assert(erwartet.length >= 1, 'ein Record ohne Eintraege kann nichts beweisen');

  const beiseite = echt + '.wachposten-bruchprobe';
  fs.renameSync(echt, beiseite);
  let meldung = null;
  try {
    verifyManifest();
  } catch (e) {
    meldung = e.message;
  } finally {
    fs.renameSync(beiseite, echt);
  }
  assert(meldung, 'ohne Drift-Record MUSS verifyManifest werfen -- sonst prueft es nichts');
  const genannt = erwartet.filter((p) => meldung.includes(p + ':hash_mismatch'));
  assert.deepEqual(genannt, erwartet, 'die Fehlermeldung muss jede verzeichnete Datei namentlich nennen: ' + meldung);
  // und der Pruefer ist danach wieder gruen -- die Probe hat nichts hinterlassen
  assert.equal(verifyManifest().protocol, 'FEM-SEC-US@1.2.0', 'Wiederherstellung fehlgeschlagen');
});

// ── (c) das Bindeglied der Siegelkette ────────────────────────────────────────
test('(c) der Ahnen-Pin auf das 1.0.0-Manifest ist byte-genau intakt', () => {
  const ist = crypto.createHash('sha256').update(fs.readFileSync(PARENT_MANIFEST)).digest('hex');
  assert.equal(ist, PARENT_MANIFEST_SHA256,
    'das 1.0.0-Manifest traegt den Ahnen-Pin jeder Nachfolgeversion -- es darf sich nie bewegen');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
