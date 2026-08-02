'use strict';
/**
 * NRL-SK-001 (Hard Review 2026-08-02, .github/workflows/smallcap-pull.yml).
 *
 * Befund: der Pull-Job (4-Shard-Matrix) restaurierte den zuletzt gemergten Small-Cap-
 * Store DIREKT in denselben Pfad, den pull-yahoo.js als --output bekam UND den
 * "Upload shard snapshots" komplett hochlud. pull-yahoo.js filtert per --shard nur
 * seine eigene Ticker-Scheibe (~194 von ~775) — die restaurierten Dateien der anderen
 * ~581 Ticker blieben unveraendert im selben Ordner liegen und wurden als Teil des
 * Artefakts mithochgeladen. Alle 4 Shards luden so denselben (bis zu 24h alten)
 * Altbestand komplett hoch; beim Merge (merge-multiple, "disjunkte Ticker-Scheiben")
 * ueberschrieb, wer zuletzt entpackt wurde, die frischen Pulls der anderen Shards mit
 * seiner Kopie des Altbestands.
 *
 * Fix: Cache-Restore in einen eigenen Baseline-Ordner (snapshots-smallcap-baseline),
 * Arbeitskopie fuer pull-yahoo.js in snapshots-smallcap, Artefakt-Upload NUR aus einem
 * dritten Ordner (snapshots-smallcap-fresh), der per Inhaltsvergleich gegen die
 * unveraenderte Baseline befuellt wird.
 *
 * Struktur-Test am OBJEKT (nicht am Schreibstil): prueft, dass Cache-Restore-Pfad,
 * --output-Pfad und Upload-Pfad drei VERSCHIEDENE Ordner sind, und dass die
 * Reihenfolge Restore -> Seed -> Pull -> Isolate -> Upload eingehalten wird. Ein
 * Zuruecknehmen des Fixes (Restore/Upload wieder auf denselben Pfad wie --output)
 * laesst diesen Test rot werden — verifiziert per Revert+Re-Run (siehe Bericht).
 *
 * Standalone runner (node <datei>, exit 0/1) — keine Netz-Zugriffe, nur lokales
 * Dateisystem (die ausgecheckte Workflow-Datei).
 *
 * Run: node tests/scoring/h-smallcap-shard-test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const YML_PATH = path.join(ROOT, '.github', 'workflows', 'smallcap-pull.yml');
// CRLF (Windows-Checkout) auf \n normalisieren — sonst matchen \n-Marker nicht.
const yml = fs.readFileSync(YML_PATH, 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// Grenzt den Pull-Job (Matrix, 4 Shards) vom Merge-Job ab — beide Jobs haben je einen
// eigenen "Restore merged small-cap store"-Schritt mit unterschiedlichem Namen.
function pullJobSection() {
  const s = yml.indexOf('\n  pull:\n');
  assert.ok(s >= 0, 'Job "pull:" nicht gefunden');
  const e = yml.indexOf('\n  merge:\n', s);
  assert.ok(e > s, 'Job "merge:" (Ende von pull:) nicht gefunden');
  return yml.slice(s, e);
}

function stepSection(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s >= 0, 'Schritt nicht gefunden: ' + startMarker);
  const from = s + startMarker.length;
  const e = endMarker ? text.indexOf(endMarker, from) : text.length;
  assert.ok(!endMarker || e > s, 'End-Marker nicht gefunden: ' + endMarker);
  return text.slice(s, e < 0 ? text.length : e);
}

function extractField(section, key) {
  const m = section.match(new RegExp('^\\s*' + key + ':\\s*(\\S.*)$', 'm'));
  return m ? m[1].trim() : null;
}

const pull = pullJobSection();

test('Pull-Job: alle drei Stationen (Restore/Seed, --output, Upload) existieren', () => {
  assert.ok(pull.includes('name: Restore merged small-cap store (diet baseline)'));
  assert.ok(pull.includes('name: Seed working dir from baseline'));
  assert.ok(pull.includes('name: Run Yahoo Pull (small-cap shard'));
  assert.ok(pull.includes('name: Isolate fresh shard output'));
  assert.ok(pull.includes('name: Upload shard snapshots'));
});

test('Reihenfolge im Pull-Job: Restore -> Seed -> Pull -> Isolate -> Upload', () => {
  const iRestore = pull.indexOf('name: Restore merged small-cap store (diet baseline)');
  const iSeed = pull.indexOf('name: Seed working dir from baseline');
  const iPull = pull.indexOf('name: Run Yahoo Pull (small-cap shard');
  const iIsolate = pull.indexOf('name: Isolate fresh shard output');
  const iUpload = pull.indexOf('name: Upload shard snapshots');
  assert.ok(
    iRestore < iSeed && iSeed < iPull && iPull < iIsolate && iIsolate < iUpload,
    'Reihenfolge verletzt: Restore=' + iRestore + ' Seed=' + iSeed + ' Pull=' + iPull +
    ' Isolate=' + iIsolate + ' Upload=' + iUpload
  );
});

test('NRL-SK-001: Cache-Restore-Pfad ist NICHT der --output-Pfad von pull-yahoo.js', () => {
  const restoreSection = stepSection(pull, 'name: Restore merged small-cap store (diet baseline)', 'name: Seed working dir from baseline');
  const restorePath = extractField(restoreSection, 'path');
  const pullStep = stepSection(pull, 'name: Run Yahoo Pull (small-cap shard', 'name: Isolate fresh shard output');
  const outputMatch = pullStep.match(/--output\s+(\S+)/);
  assert.ok(outputMatch, '--output nicht im Pull-Aufruf gefunden');
  const outputPath = outputMatch[1];
  assert.notEqual(restorePath, outputPath,
    'Cache-Restore-Pfad (' + restorePath + ') ist identisch mit --output (' + outputPath +
    ') — genau der NRL-SK-001-Defekt: der restaurierte Altbestand liegt im selben Ordner, den pull-yahoo.js beschreibt.');
});

test('NRL-SK-001: Artefakt-Upload zeigt auf einen DRITTEN, vom Cache-Restore UND von --output verschiedenen Ordner', () => {
  const restoreSection = stepSection(pull, 'name: Restore merged small-cap store (diet baseline)', 'name: Seed working dir from baseline');
  const restorePath = extractField(restoreSection, 'path');
  const pullStep = stepSection(pull, 'name: Run Yahoo Pull (small-cap shard', 'name: Isolate fresh shard output');
  const outputPath = pullStep.match(/--output\s+(\S+)/)[1];
  const uploadSection = stepSection(pull, 'name: Upload shard snapshots', null);
  const uploadPathRaw = extractField(uploadSection, 'path');
  assert.ok(uploadPathRaw, 'Upload-Schritt hat kein path:-Feld');
  const uploadDir = uploadPathRaw.split('/')[0];
  assert.notEqual(uploadDir, restorePath,
    'Upload-Pfad (' + uploadDir + ') ist identisch mit dem Cache-Restore-Pfad (' + restorePath +
    ') — der Altbestand wuerde wieder komplett mithochgeladen.');
  assert.notEqual(uploadDir, outputPath,
    'Upload-Pfad (' + uploadDir + ') ist identisch mit --output (' + outputPath +
    ') — genau der NRL-SK-001-Defekt (Upload zeigt nicht auf ein frisches, isoliertes Verzeichnis).');
});

test('NRL-SK-001: "Isolate fresh shard output" vergleicht gegen die Baseline UND schliesst _manifest.json aus', () => {
  const isolateSection = stepSection(pull, 'name: Isolate fresh shard output', 'name: Upload shard snapshots');
  assert.match(isolateSection, /cmp -s "\$f" "snapshots-smallcap-baseline\/\$base"/,
    'Kein Inhaltsvergleich gegen den Baseline-Ordner gefunden — ohne ihn landet wieder der komplette Altbestand im Fresh-Ordner.');
  assert.match(isolateSection, /_manifest\.json/, '_manifest.json-Ausschluss fehlt');
});

test('Merge-Job: eigener Restore-Pfad bleibt unveraendert snapshots-smallcap (keine Kollision mit der neuen Baseline)', () => {
  const mergeStart = yml.indexOf('\n  merge:\n');
  assert.ok(mergeStart >= 0);
  const mergeSection = yml.slice(mergeStart);
  const restoreSection = stepSection(mergeSection, 'name: Restore merged small-cap store (baseline for tickers no shard touched this run)', 'name: Download all shard snapshots');
  assert.match(restoreSection, /path: snapshots-smallcap\b/);
});

console.log('\nh-smallcap-shard-test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
