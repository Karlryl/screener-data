'use strict';

// Waechter zur Herkunfts-Schliessung (R13) und zum Daten-Vertrag (R12b).
//
// Die SACHE: der 41-GB-SEC-Speicher darf nach der Stilllegung des Altapparats keine
// Blackbox werden. Nachweisbar bleiben muss (a) WOHER jeder der 127 Roh-Payloads kam
// (Inhalts-Hash + Abruf-URL), (b) WOMIT daraus die Datenbank wurde (Hashes der drei
// Bau-Skripte) und (c) DASS das Rezept wirklich funktioniert (Neubau-Probelauf eines
// Quartals gegen die versiegelten Zeilen-Digests).
//
// Der Pruefer selbst wird mitgeprueft: `self-test` baut eine Miniatur-Schliessung,
// bricht sie fuenffach absichtlich und verlangt, dass jeder Bruch auffliegt. Ein
// Vergleicher, der nie rot wird, ist kein Waechter, sondern Dekoration.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const DIR = path.join(REPO, 'protocol', 'early-detection', '2.0.0');
const CLOSURE = path.join(DIR, 'provenance-closure.json');
const CONTRACT = path.join(DIR, 'data-contract.json');
const SCRIPT = path.join(REPO, 'scripts', 'studie-herkunft.py');

function python(args) {
  return spawnSync(process.env.PYTHON || 'python', [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO });
}

test('Herkunfts-Pruefer faellt bei jedem absichtlichen Bruch um (self-test)', () => {
  const run = python(['self-test']);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.deterministic, true);
  for (const bruch of [
    'payload_still_gestrichen',
    'bau_skript_veraendert',
    'probelauf_nie_rot_gezeigt',
    'abruf_url_entfernt',
    'obermenge_verschwiegen',
  ]) {
    assert.ok(result.brokenVariantsDetected.includes(bruch), `Bruch nicht erkannt: ${bruch}`);
  }
});

test('Herkunfts-Schliessung und Daten-Vertrag verifizieren gegen das Repo', () => {
  const run = python(['verify', '--closure', CLOSURE, '--contract', CONTRACT]);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS', JSON.stringify(result.issues));
});

test('Jeder Roh-Payload hat Inhalts-Hash UND Fundort — sonst ist er kein Beweis', () => {
  const closure = JSON.parse(fs.readFileSync(CLOSURE, 'utf8'));
  assert.ok(closure.payloadCount >= 127, 'Die 127 versiegelten Payloads duerfen nie weniger werden');
  assert.equal(closure.payloads.length, closure.payloadCount);

  const gesehen = new Set();
  for (const payload of closure.payloads) {
    assert.match(payload.payloadSha256, /^[0-9a-f]{64}$/, `Payload ohne Inhalts-Hash: ${payload.quarter}`);
    assert.equal(payload.blobState, 'sha256_verified', `Payload nur nach Laenge geprueft: ${payload.quarter}`);
    assert.ok(
      payload.originalSourceUrl.startsWith('https://www.sec.gov/'),
      `Payload ohne amtlichen Fundort: ${payload.quarter}`,
    );
    assert.ok(payload.sourceUrl.startsWith('https://'), `Payload ohne Abruf-URL: ${payload.quarter}`);
    assert.ok(payload.observedAt.length > 0 && payload.vintage.length > 0, 'Stand-Kennung fehlt (R6)');
    assert.ok(!gesehen.has(payload.payloadSha256), `Payload doppelt gefuehrt: ${payload.payloadSha256}`);
    gesehen.add(payload.payloadSha256);
  }
});

test('Neubau-Probelauf war einmal gruen und einmal absichtlich rot', () => {
  const closure = JSON.parse(fs.readFileSync(CLOSURE, 'utf8'));
  const probe = closure.rebuildProbe;
  assert.equal(probe.status, 'PASS', 'Der echte Neubau eines Quartals muss die versiegelten Digests treffen');
  assert.ok(!probe.corrupted, 'Der gruene Probelauf darf nicht der manipulierte Lauf sein');
  assert.equal(probe.brokenProbeStatus, 'FAIL', 'Der gebrochene Probelauf muss rot gewesen sein');
  assert.ok(probe.quarter && probe.sealedPayloads > 0);
});

test('Die Obermenge im Speicher wird benannt, nicht verschwiegen', () => {
  const closure = JSON.parse(fs.readFileSync(CLOSURE, 'utf8'));
  const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  assert.ok(Array.isArray(closure.supersetObservations), 'Obermengen-Liste fehlt');
  assert.equal(closure.supersetObservations.length, closure.supersetObservationCount);
  assert.equal(contract.supersetObservationCount, closure.supersetObservationCount);
  if (closure.supersetObservationCount > 0) {
    assert.ok(
      String(contract.rebuildCaveat || '').length > 0,
      'Wenn der Speicher mehr enthaelt als die Datenbank, muss das Rezept den Vorbehalt tragen',
    );
  }
  assert.ok(closure.orphanRowsDisclosed >= 0 && String(closure.orphanRowsNote).length > 0, 'Waisen-Zeilen ungenannt');
});

test('Daten-Vertrag bleibt klein und nennt den Speicherort nur als Umgebungsvariable (R12)', () => {
  const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  assert.ok(fs.statSync(CONTRACT).size < 5 * 1024, 'Daten-Vertrag muss unter 5 KB bleiben');
  assert.equal(contract.dataRootEnv, 'EARLY_DETECTION_DATA_ROOT');
  assert.ok(contract.rebuildRecipe.length >= 4, 'Neubau-Rezept ist unvollstaendig');
  assert.ok(contract.rowCounts.submissions > 0 && contract.rowCounts.facts > 0);
});
