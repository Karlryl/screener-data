'use strict';

// RR9-A1 (B1') + RR9-A3 (Jahrgangs-Tripwire) - _COURT-RR9-2026-08-30.
//
// Der Waechter dieses Tests ist nicht "der Selbsttest laeuft durch", sondern
// "jede einzelne Rot-Probe ist noch da UND war rot". A17 woertlich: ein
// Waechter, der sich nicht rot bekommen laesst, existiert nicht. Wer eine
// Rot-Probe entfernt, um einen Bau gruen zu bekommen, faellt hier auf.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const python = process.env.PYTHON || 'python';
const skripte = path.join(__dirname, '..', 'scripts');

function lauf(datei, args) {
  const r = spawnSync(python, [path.join(skripte, datei), ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${datei} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

// -- 1. Das Manifest-Modul selbst --------------------------------------------
const b1 = lauf('studie-rr9-b1-manifest.py', ['selbsttest']);
assert.match(b1, /selbsttest: \d+ ok, 0 FAIL/, 'B1-Selbsttest nicht sauber');
for (const probe of [
  'ROT-PROBE 1: nicht registriertes Payload -> STOPP',
  'ROT-PROBE 2: bit-gekipptes Payload -> BEERDIGEN',
  'ROT-PROBE 3: fehlendes Manifest -> STOPP',
  'unveraenderter Blob geht durch',
  'Name-gegen-Inhalt ist GEMESSEN, nicht angenommen',
  'Durchsatz ist berichtet (RR9-A4)',
  // Nach dem Review vom 30.08. dazugekommen - jede dieser Proben deckt einen
  // Weg ab, auf dem der Waechter frueher gruen geblieben waere.
  'ROT-PROBE 4: Treffer in einem FREMDEN Ort zaehlt nicht',
  'ROT-PROBE 5: fehlender benannter Ort -> STOPP',
  'ROT-PROBE 6: Kollision mit VERSCHIEDENEM Inhalt -> STOPP',
  'ROT-PROBE 7: gekippte Doppelablage -> BEERDIGEN',
  'Doppelablage gleichen Inhalts wird GEFUEHRT, nicht verschluckt',
  'ein .warc.gz-Blob wird ueber seinen echten Dateinamen gefunden',
]) {
  assert.ok(b1.includes(`ok   ${probe}`), `B1-Probe fehlt oder rot: ${probe}`);
}

// -- 2. Der Lesepfad im Panelbau ---------------------------------------------
const bau = lauf('studie-panel-bau.py', ['--selftest']);
assert.match(bau, /selftest: \d+ ok, 0 fail/, 'Panelbau-Selbsttest nicht sauber');
for (const probe of [
  // RR9-A3: Anwesenheit UND Abwesenheit des Jahrgangs-Kennzeichens.
  'ROT-PROBE A3: Payload ohne Jahrgang bricht den Bau ab',
  'A3-Gegenprobe: vollstaendig gekennzeichnete Liste geht durch',
  // RR9-A1: beide abgestuften Konsequenzen, jede mit ihrer Gegenprobe.
  'ROT-PROBE A1a: nicht registriertes Payload -> STOPP',
  'A1a-Gegenprobe: nach Neubau des Manifests geht dasselbe Payload durch',
  'ROT-PROBE A1b: bit-gekipptes Payload -> BEERDIGEN',
  'ROT-PROBE A1c: fehlendes Manifest -> STOPP',
]) {
  assert.ok(bau.includes(`ok   ${probe}`), `Lesepfad-Probe fehlt oder rot: ${probe}`);
}

// -- 2b. RR9-A6: die Paarungstabelle und ihre Rueckkehr-Klausel --------------
const paarung = lauf('studie-rr9-a6-paarung.py', ['--selbsttest']);
assert.match(paarung, /selbsttest: \d+ ok, 0 FAIL/, 'A6-Selbsttest nicht sauber');
for (const probe of [
  'Rueckkehrklausel schweigt, wenn das Prueffenster gedeckt ist',
  'ROT-PROBE A6: ungepaartes Prueffenster-Quartal loest die Rueckkehrklausel aus',
  'fehlendes datasetVariant zaehlt als OHNE_KENNZEICHEN',
]) {
  assert.ok(paarung.includes(`ok   ${probe}`), `A6-Probe fehlt oder rot: ${probe}`);
}

// Das gemessene Artefakt: die Klausel haengt am Prueffenster, nicht am Gefuehl.
const tabelle = path.join(__dirname, '..', 'reports', 'studie',
  'RR9-A6-paarungstabelle-2026-08-30.json');
if (require('node:fs').existsSync(tabelle)) {
  const t = JSON.parse(require('node:fs').readFileSync(tabelle, 'utf8'));
  assert.equal(t.jeFenster.pruefung.quartaleOhneBeide.length, 0);
  assert.equal(t.schnittmengeDecktPrueffenster, true);
  // Gemessene Korrektur zur Vorlagen-Zahl "50 von 183 ohne Kennzeichen":
  // die 50 sind die dritte, benannte Variante archived_digest_revision.
  assert.equal(t.ohneJahrgangsKennzeichen, 0);
  assert.equal(t.variantenGesamt.archived_digest_revision, 50);
}

// -- 3. Der Tripwire haengt am Lesepfad, nicht an einem Vorlauf ---------------
// bau() darf ohne Manifest nicht aufrufbar sein. Das ist die Eigenschaft, die
// verhindert, dass jemand den Waechter durch Weglassen eines Arguments umgeht.
const signatur = spawnSync(python, ['-c', [
  'import importlib.util, inspect, os, sys',
  `spec = importlib.util.spec_from_file_location('pb', os.path.join(${JSON.stringify(skripte)}, 'studie-panel-bau.py'))`,
  'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
  'p = inspect.signature(m.bau).parameters',
  "print(p['manifest_pfad'].default is inspect.Parameter.empty)",
].join('\n')], { encoding: 'utf8' });
assert.equal(signatur.status, 0, signatur.stderr);
assert.equal(signatur.stdout.trim(), 'True',
  'bau() hat einen Default fuer manifest_pfad - damit ist der Tripwire vergessbar');

// Und die CLI darf ebenfalls keinen Default tragen: ein datierter Standardpfad
// liesse den Tripwire jahrelang gegen ein immer aelteres Manifest laufen.
const cliDefault = spawnSync(python, ['-c', [
  'import importlib.util, os, sys',
  `spec = importlib.util.spec_from_file_location('pb', os.path.join(${JSON.stringify(skripte)}, 'studie-panel-bau.py'))`,
  'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
  'print(hasattr(m, "B1_MANIFEST_STANDARD"))',
].join('\n')], { encoding: 'utf8' });
assert.equal(cliDefault.stdout.trim(), 'False',
  'studie-panel-bau.py traegt wieder einen Standard-Manifestpfad');

console.log('studie-rr9-bremsen.test.js: PASS');
