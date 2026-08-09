'use strict';
/**
 * Wachposten: das Siegel von GQS-00@1.0.0 haengt an BYTES, nicht an einem String.
 * =============================================================================
 * Review-Nachzug zu Tag 613 (F-25). sourceHashes() las die Datei als 'utf8'-String.
 * Diese Dekodierung ist VERLUSTBEHAFTET: jedes ungueltige UTF-8-Byte wird still zu
 * U+FFFD. Zwei verschiedene Dateien (61 FF 62 und 61 FE 62) ergaben denselben String
 * "a�b" und damit denselben Hash — die Zwei-Varianten-Akzeptanz in verify() war
 * damit nicht nur zeilenenden-neutral, sondern auch decode-neutral. Tamper-Evidence
 * war nicht mehr byte-genau.
 *
 * Geprueft wird sourceHashes() direkt:
 *   (a) die beiden PoC-Dateien liefern VERSCHIEDENE Hash-Paare   <- faellt gegen die alte Fassung
 *   (b) CRLF-Datei und ihr LF-Zwilling liefern dasselbe LF-Hash-Paar (Zweck von Tag 613 bleibt)
 *   (c) eine gueltige UTF-8-Datei liefert exakt den Hash ihrer ROH-Bytes (gegen crypto gerechnet)
 *
 * Kein Netz, keine Frameworks, nur Tmp-Dateien — kein Repo-Artefakt wird angefasst.
 * Run: node tests/gqs00-sourcehash-wachposten.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { sourceHashes } = require('../scripts/gqs00-freeze.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gqs00-srchash-'));
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack ? e.stack : e)); }
}
function schreibeBytes(name, bytes) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
}
const sha256Bytes = (bytes) => crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');

test('sourceHashes ist exportiert und liefert ein Hash-Paar', () => {
  assert.equal(typeof sourceHashes, 'function', 'sourceHashes muss fuer den Wachposten exportiert sein');
  const paar = sourceHashes(schreibeBytes('trivial.txt', [0x61, 0x0a]));
  assert.equal(paar.length, 2);
  for (const h of paar) assert.match(h, /^[0-9a-f]{64}$/);
});

// ── (a) Kern-Befund: zwei verschiedene Byte-Folgen duerfen NIE denselben Hash haben ──
// 0xFF und 0xFE sind beide als UTF-8 ungueltig und dekodieren zum selben U+FFFD.
test('(a) zwei Dateien mit 61 FF 62 und 61 FE 62 liefern verschiedene Hash-Paare', () => {
  const ff = sourceHashes(schreibeBytes('poc-ff.bin', [0x61, 0xff, 0x62]));
  const fe = sourceHashes(schreibeBytes('poc-fe.bin', [0x61, 0xfe, 0x62]));
  assert.notEqual(ff[0], fe[0],
    'utf8-Dekodierung faltet ungueltige Bytes zu U+FFFD zusammen — das Siegel ist nicht byte-genau');
  assert.notEqual(ff[1], fe[1], 'auch die CRLF-Variante darf die beiden Dateien nicht zusammenfalten');
});

// ── (b) der Zweck von Tag 613 bleibt: Zeilenenden sind neutral ───────────────────────
test('(b) CRLF-Datei und LF-Zwilling liefern dasselbe LF-Hash-Ergebnis', () => {
  const crlf = sourceHashes(schreibeBytes('zwilling-crlf.txt', [0x61, 0x0d, 0x0a, 0x62, 0x0d, 0x0a]));
  const lf = sourceHashes(schreibeBytes('zwilling-lf.txt', [0x61, 0x0a, 0x62, 0x0a]));
  assert.deepEqual(crlf, lf, 'ein Checkout mit CRLF muss dasselbe Siegel erfuellen wie einer mit LF');
  // und die zweite Variante ist wirklich die CRLF-Rueckverwandlung, nicht eine Kopie der ersten
  assert.notEqual(lf[0], lf[1], 'LF- und CRLF-Variante muessen sich unterscheiden');
  assert.equal(lf[1], sha256Bytes([0x61, 0x0d, 0x0a, 0x62, 0x0d, 0x0a]));
});

// ── (c) Anker gegen crypto: der LF-Hash IST der Hash der Roh-Bytes ───────────────────
test('(c) gueltige UTF-8-Datei (LF, mit Umlauten) hasht ihre Roh-Bytes', () => {
  const bytes = [...Buffer.from('const größe = 1; // ✓\n', 'utf8')];
  const p = schreibeBytes('gueltig-utf8.js', bytes);
  assert.equal(sourceHashes(p)[0], sha256Bytes(bytes),
    'ohne CRLF muss der LF-Hash exakt der Datei-Byte-Hash sein');
  assert.equal(sourceHashes(p)[0], crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
});

// ponytail: kein Cleanup-Hook — Tmp-Dateien sind winzig und das OS raeumt %TEMP% selbst.
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
