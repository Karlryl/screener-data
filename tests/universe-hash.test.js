'use strict';
/**
 * Waechter fuer den Universums-Hash (T155 / Weiche W3 des Rats vom 25.08.2026).
 *
 * WORUM ES GEHT: Das Produkt normiert kohorten-relativ und kalibriert taeglich neu.
 * Bewegt sich ein Score zwischen zwei Laeufen, war bisher NICHT maschinell
 * unterscheidbar, ob sich die Daten bewegt haben oder die Kohorte. Der Hash macht die
 * Herkunftsfrage zu einem Zeichenketten-Vergleich: gleicher Hash + andere Scores =
 * Datenaenderung; anderer Hash = Kohortenwechsel.
 *
 * DER WAECHTER HAENGT AN DER SACHE, NICHT AN EINEM TEXTMUSTER. Geprueft wird beides:
 *   ANWESENHEIT — der Hash steht im Vintage und traegt genau den Wert des Laufs;
 *   ABWESENHEIT — er BEWEGT sich, wenn sich die Menge bewegt (sonst waere er Deko),
 *                 und er bewegt sich NICHT bei blosser Reihenfolge/Dopplung (sonst
 *                 meldete er jeden Tag einen Kohortenwechsel, den es nicht gab).
 *
 * DIE DRITTE FALLE, die hier festgenagelt wird: ein KAPUTTER Traeger darf nicht wie ein
 * FEHLENDER aussehen. "Datei gibt es nicht" ist der legitime lokale Lauf; "Datei ist
 * kaputt" ist ein Defekt, der still eine Metadaten-Spalte der Messreihe leert. Ein
 * pauschales try/catch machte beide ununterscheidbar — genau die Klasse stillen
 * Fehlschlags, gegen die diese Zahl gebaut ist.
 *
 * Usage:  node tests/universe-hash.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { universumsHash, universumsHashVon, UNIVERSE_HASH_FILE } = require('../scripts/write-excluded-list.js');
const { buildBoardVintage, readUniverseHash, resolvePaths } = require('../scripts/write-board-history.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'universe-hash-'));
const calibMeta = { formulaVersion: 'calibration/v4', generatedAt: '2026-08-28T00:00:00.000Z' };
const leeresBoard = { profitable: [], unprofitable: [] };

// ── Die Menge, nicht die Liste ──────────────────────────────────────────────
check('Reihenfolge bewegt den Hash NICHT (Datei-Lesereihenfolge ist OS-abhaengig)', () => {
  assert.equal(universumsHash(['B', 'A', 'C']), universumsHash(['C', 'B', 'A']));
});

check('Dopplung bewegt den Hash NICHT (gehasht wird die Menge)', () => {
  assert.equal(universumsHash(['A', 'B']), universumsHash(['A', 'B', 'A', 'B']));
});

check('EIN zusaetzlicher Ticker bewegt den Hash', () => {
  assert.notEqual(universumsHash(['A', 'B']), universumsHash(['A', 'B', 'C']));
});

check('EIN fehlender Ticker bewegt den Hash', () => {
  assert.notEqual(universumsHash(['A', 'B', 'C']), universumsHash(['A', 'B']));
});

check('Form: 16 Hex-Zeichen, deterministisch ueber Laeufe hinweg', () => {
  const h = universumsHash(['AAPL', 'MSFT']);
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(h, universumsHash(['MSFT', 'AAPL']), 'derselbe Aufruf muss denselben Wert liefern');
});

// ── Die Abbildung Snapshot -> Ticker ist gepinnt, nicht nur ein Einzeiler ───
check('der Hash liest den Ticker aus meta.ticker (nicht aus s.ticker)', () => {
  const universum = [{ meta: { ticker: 'AAPL' } }, { meta: { ticker: 'MSFT' } }];
  assert.equal(universumsHashVon(universum), universumsHash(['AAPL', 'MSFT']));
});

check('ein Snapshot ohne meta.ticker WIRFT, statt den Hash still zu verschieben', () => {
  // sort() haengt undefined hinten an, join() macht ein leeres Feld daraus: der Hash
  // bewegte sich aus einem Grund, der nichts mit der Kohorte zu tun hat.
  assert.throws(() => universumsHashVon([{ meta: { ticker: 'AAPL' } }, { meta: {} }]), /universums-hash/);
  assert.throws(() => universumsHash(['AAPL', '']), /universums-hash/);
});

// ── Beide Seiten meinen dieselbe Datei ──────────────────────────────────────
check('Schreiber und Leser zeigen auf denselben Traeger-Pfad', () => {
  // Ohne diesen Pin waere ein spaeterer Umbau einer der beiden Konstanten ein
  // LAUTLOSER Ausfall: der Leser bekaeme ENOENT, das ist der legitime Lokal-Fall,
  // und jedes kuenftige Vintage truege dauerhaft null.
  const repoRoot = path.resolve(__dirname, '..');
  assert.equal(resolvePaths(repoRoot).UNIVERSE_HASH_FILE, UNIVERSE_HASH_FILE);
});

// ── Der Wert kommt im Vintage an ────────────────────────────────────────────
check('das Vintage traegt genau den Hash des Laufs', () => {
  const v = buildBoardVintage('financials', leeresBoard, '2026-08-28', calibMeta, 'abc0123456789def');
  assert.equal(v.universeHash, 'abc0123456789def');
});

check('ohne Hash steht ehrlich null im Vintage, nicht ein erfundener Wert', () => {
  const v = buildBoardVintage('financials', leeresBoard, '2026-08-28', calibMeta);
  assert.equal(v.universeHash, null);
  assert.ok('universeHash' in v, 'das Feld muss existieren, sonst faellt es fuer Leser still weg');
});

// ── Fehlend ist nicht kaputt ────────────────────────────────────────────────
// ::warning:: laeuft in dieser Datei ueber console.log (Haus-Konvention von
// write-board-history.js) — hier wird deshalb stdout mitgeschnitten, nicht stderr.
function mitWarnungen(fn, ci = false) {
  const echt = console.log;
  const altSha = process.env.GITHUB_SHA;
  const gesammelt = [];
  console.log = (...a) => gesammelt.push(a.join(' '));
  if (ci) process.env.GITHUB_SHA = 'a'.repeat(40); else delete process.env.GITHUB_SHA;
  try { return { wert: fn(), warnungen: gesammelt }; }
  finally {
    console.log = echt;
    if (altSha === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = altSha;
  }
}

check('gueltiger Traeger liefert den Hash, ohne zu warnen', () => {
  const f = path.join(TMP, 'gut.json');
  fs.writeFileSync(f, JSON.stringify({ schema: 'universe-hash/v1', universeHash: 'deadbeefdeadbeef', universeCount: 3 }));
  const r = mitWarnungen(() => readUniverseHash(f));
  assert.equal(r.wert, 'deadbeefdeadbeef');
  assert.equal(r.warnungen.length, 0);
});

check('FEHLENDE Datei LOKAL: null, KEINE Warnung', () => {
  const r = mitWarnungen(() => readUniverseHash(path.join(TMP, 'gibtesnicht.json')));
  assert.equal(r.wert, null);
  assert.equal(r.warnungen.length, 0, 'ein lokaler Lauf ohne Export-Schritt ist kein Defekt');
});

check('FEHLENDE Datei in der CI: null UND eine laute Warnung', () => {
  // In der CI laeuft write-excluded-list.js im selben Job davor. Fehlt der Traeger
  // trotzdem, ist die Uebergabe gebrochen — ohne diese Unterscheidung truege jedes
  // kuenftige Vintage still null und niemand saehe es.
  const r = mitWarnungen(() => readUniverseHash(path.join(TMP, 'gibtesnicht.json')), true);
  assert.equal(r.wert, null);
  assert.equal(r.warnungen.length, 1, 'in der CI ist ein fehlender Traeger ein Defekt, kein Normalfall');
  assert.match(r.warnungen[0], /::warning::/);
});

check('ein Wert in falscher FORM wird verworfen, nicht als Hash geglaubt', () => {
  // "irgendein nicht-leerer String" naehme auch einen abgeschnittenen oder aus einem
  // anderen Feld verrutschten Wert an — eine falsche Zahl, die richtig aussieht.
  for (const kaputt of ['nicht-hex-16chars', 'DEADBEEFDEADBEEF', 'deadbeef', 'deadbeefdeadbeef00']) {
    const f = path.join(TMP, 'form.json');
    fs.writeFileSync(f, JSON.stringify({ universeHash: kaputt }));
    const r = mitWarnungen(() => readUniverseHash(f));
    assert.equal(r.wert, null, kaputt + ' haette verworfen werden muessen');
    assert.equal(r.warnungen.length, 1, kaputt + ' haette laut gemeldet werden muessen');
  }
});

check('literales null in der Datei ist gueltiges JSON und wird sauber gemeldet', () => {
  const f = path.join(TMP, 'null.json');
  fs.writeFileSync(f, 'null');
  const r = mitWarnungen(() => readUniverseHash(f));
  assert.equal(r.wert, null);
  assert.equal(r.warnungen.length, 1);
  assert.doesNotMatch(r.warnungen[0], /kein gültiges JSON/, 'null IST gueltiges JSON — die Meldung darf nicht luegen');
});

check('KAPUTTE Datei ist ein Defekt: null UND eine laute Warnung', () => {
  const f = path.join(TMP, 'kaputt.json');
  fs.writeFileSync(f, '{ das ist kein json');
  const r = mitWarnungen(() => readUniverseHash(f));
  assert.equal(r.wert, null);
  assert.equal(r.warnungen.length, 1, 'ein kaputter Traeger darf nicht wie ein fehlender aussehen');
  assert.match(r.warnungen[0], /::warning::/);
});

check('Traeger ohne brauchbares Feld ist ebenfalls ein Defekt, kein stilles null', () => {
  const f = path.join(TMP, 'leer.json');
  fs.writeFileSync(f, JSON.stringify({ schema: 'universe-hash/v1', universeCount: 3 }));
  const r = mitWarnungen(() => readUniverseHash(f));
  assert.equal(r.wert, null);
  assert.equal(r.warnungen.length, 1);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nuniverse-hash: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
