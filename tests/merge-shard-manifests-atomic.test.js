'use strict';
/**
 * NRE-SK-001 (Hard Review 2026-07-31, section screener-daten, HOCH): der
 * einzige Coverage-Alarm (coverage-gate.js) faellt auf eine deutlich
 * schwaechere Datei-Fallback-Klassifikation zurueck, wenn snapshots/_manifest.json
 * fehlt oder kaputt ist. merge-shard-manifests.js schrieb diese Datei bisher mit
 * plain fs.writeFileSync — ein abgebrochener/gekillter Schritt (Timeout, OOM,
 * Runner-Eviction) kann eine halbgeschriebene Datei hinterlassen, die
 * JSON.parse in coverage-gate.js zum Scheitern bringt. Fix: atomarer Write
 * (tmp + rename) ueber lib/atomic-write.js, wie im Rest des Repos ueblich.
 *
 * Standalone-Runner, keine Frameworks, kein Netz.
 * Run: node tests/merge-shard-manifests-atomic.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'merge-shard-manifests.js'), 'utf8');

test('_manifest.json wird atomar geschrieben (writeFileAtomic), nicht mehr per plain writeFileSync', () => {
  assert.match(SRC, /writeFileAtomic\(path\.join\(snapDir, '_manifest\.json'\), JSON\.stringify\(merged\)\)/,
    'der finale Manifest-Write muss ueber writeFileAtomic laufen');
  assert.doesNotMatch(SRC, /fs\.writeFileSync\(path\.join\(snapDir, '_manifest\.json'\)/,
    'der alte plain writeFileSync fuer _manifest.json darf nicht wieder auftauchen');
});
test('lib/atomic-write.js wird importiert', () => {
  assert.match(SRC, /require\(path\.join\(__dirname, '\.\.', 'lib', 'atomic-write\.js'\)\)/);
});

console.log(`\nmerge-shard-manifests-atomic.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
