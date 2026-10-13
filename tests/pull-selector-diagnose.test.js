/**
 * tests/pull-selector-diagnose.test.js — Wächter der Durchsatz-Diagnose (19.09.2026).
 *
 * Hintergrund (agent-reports/daylauf-2026-09-19/throughput.md): der Tageslauf zieht ~274
 * Voll-Abrufe, davon 135 zeit-basiert, bei einem Budget von 3000 — und gleichzeitig tragen
 * 8.750 von 15.040 Snapshots eine `fundamentalsAsOf`-Uhr älter als die eigene 30-Tage-Schwelle.
 * Weder der Zeit-Deckel (9 % ausgelastet) noch das Budget (4,5 %) bremst. Diese Zähler messen,
 * welche Ticker der Auswahl-Schritt überhaupt ANBIETET; sie ändern das Verhalten nicht.
 *
 * Geprüft wird das, was in die Messreihe geht: die Eimer-Zuordnung, das Kopf-Lesen der Uhr an
 * echten Dateien (Fixture mit allen drei Fällen), die Summierung über die 17 Shards und die
 * Weigerung, ein Unbekanntes als „nicht fällig" zu verbuchen.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = require('../pull-yahoo.js');
const { mergeManifests } = require('../scripts/merge-shard-manifests.js');

let ok = 0, fail = 0;
function check(name, fn) {
  try { fn(); ok++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

const TAG = 24 * 60 * 60 * 1000;
const MAX_AGE = 7 * TAG;          // FUNDAMENTALS_MAX_AGE_DAYS
const REFRESH = 30 * TAG;         // FUNDAMENTALS_REFRESH_DAYS

// ---------------------------------------------------------------- Fixture: drei echte Dateien
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seldiag-'));
  const iso = (days) => new Date(Date.now() - days * TAG).toISOString();
  const snap = (asOfDays, fundDays) => {
    const meta = { ticker: 'X', name: 'X', asOf: iso(asOfDays) };
    if (fundDays != null) meta.fundamentalsAsOf = iso(fundDays);
    // Füllmaterial VOR dem Stempel, damit das Kopf-Lesen realistisch weit greifen muss
    return JSON.stringify({ identifier: { primary: 'ISIN', value: 'TICKER:X' }, meta,
      padding: 'x'.repeat(600) });
  };
  fs.writeFileSync(path.join(dir, 'YOUNG.json'), snap(1, 40));          // durch das Tor
  fs.writeFileSync(path.join(dir, 'OVERDUE.json'), snap(20, 40));       // jenseits, überfällig
  fs.writeFileSync(path.join(dir, 'FRESHCLOCK.json'), snap(20, 5));     // jenseits, Uhr frisch
  fs.writeFileSync(path.join(dir, 'NOCLOCK.json'), snap(20, null));     // jenseits, keine Uhr
  fs.writeFileSync(path.join(dir, 'BROKEN.json'), '{"meta":{"fundamentalsAsOf":"nicht-ein-datum"}}');
  return dir;
}

check('(a) die Uhr wird aus dem Dateikopf gelesen, auch hinter 600 Byte Füllmaterial', () => {
  const dir = fixture();
  const age = P.fundamentalsAsOfAgeFromFile(path.join(dir, 'OVERDUE.json'));
  assert.ok(age != null, 'die Uhr wurde nicht gefunden');
  assert.ok(Math.abs(age - 40 * TAG) < 60 * 1000, 'Alter falsch: ' + age);
  assert.ok(age > REFRESH, '40 Tage müssen über der 30-Tage-Schwelle liegen');
});

check('(b) fehlende, unparsbare und nicht existierende Uhr liefern ALLE null — nie 0', () => {
  const dir = fixture();
  for (const f of ['NOCLOCK.json', 'BROKEN.json', 'GIBTESNICHT.json']) {
    const v = P.fundamentalsAsOfAgeFromFile(path.join(dir, f));
    assert.strictEqual(v, null, f + ' lieferte ' + v + ' statt null');
  }
  // Gegenprobe zum Rückfallwert-Muster: 0 wäre "heute frisch" und damit eine Falschaussage
  assert.notStrictEqual(P.fundamentalsAsOfAgeFromFile(path.join(dir, 'NOCLOCK.json')), 0);
});

check('(c) die drei Eimer treffen genau die drei Populationen', () => {
  const dir = fixture();
  const b = (asOfDays, file) => P.selectorBucket(
    asOfDays * TAG,
    P.fundamentalsAsOfAgeFromFile(path.join(dir, file)),
    MAX_AGE, REFRESH);
  assert.strictEqual(b(1, 'YOUNG.json'), 'young', 'durch das Tor');
  assert.strictEqual(b(20, 'OVERDUE.json'), 'overdue', 'jenseits des Tors und überfällig');
  assert.strictEqual(b(20, 'NOCLOCK.json'), 'unknown', 'Uhr nicht lesbar');
  assert.strictEqual(b(20, 'FRESHCLOCK.json'), 'young-enough-clock', 'jenseits, aber nicht fällig');
  assert.strictEqual(P.selectorBucket(null, null, MAX_AGE, REFRESH), 'none', 'kein Snapshot');
});

check('(d) die Tor-Grenze selbst: 7 Tage minus eine Sekunde ist jung, 7 Tage sind es nicht', () => {
  assert.strictEqual(P.selectorBucket(MAX_AGE - 1000, 40 * TAG, MAX_AGE, REFRESH), 'young');
  assert.strictEqual(P.selectorBucket(MAX_AGE, 40 * TAG, MAX_AGE, REFRESH), 'overdue');
  // und die Fälligkeits-Grenze: genau 30 Tage ist NICHT überfällig (strikt >, wie
  // fundamentalsStaleness es rechnet)
  assert.strictEqual(P.selectorBucket(20 * TAG, REFRESH, MAX_AGE, REFRESH), 'young-enough-clock');
  assert.strictEqual(P.selectorBucket(20 * TAG, REFRESH + 1, MAX_AGE, REFRESH), 'overdue');
});

// ---------------------------------------------------------------- Merge über die 17 Shards
const shard = (extra) => Object.assign(
  { n_ok: 10, n_full: 2, n_priceonly: 8, n_failed: 0, partial: false, watchlist_version: 'v1' },
  extra);

check('(e) die vier Zähler werden über die Shards summiert und stehen im Manifest', () => {
  const m = mergeManifests([
    shard({ n_sel_young_enough: 900, n_sel_young_and_stale: 500, n_sel_not_young_but_stale: 7, n_sel_not_young_unknown: 1 }),
    shard({ n_sel_young_enough: 100, n_sel_young_and_stale: 40, n_sel_not_young_but_stale: 3, n_sel_not_young_unknown: 0 }),
  ], 20, 2);
  assert.strictEqual(m.n_sel_young_enough, 1000);
  assert.strictEqual(m.n_sel_young_and_stale, 540);
  assert.strictEqual(m.n_sel_not_young_but_stale, 10);
  assert.strictEqual(m.n_sel_not_young_unknown, 1);
});

check('(f) ein Shard-Manifest OHNE die Zähler bleibt gültig (älterer Commit) und zählt als 0', () => {
  const m = mergeManifests([shard({ n_sel_young_enough: 900 }), shard({})], 20, 2);
  assert.strictEqual(m.n_ok, 20, 'der alte Shard wurde quarantänisiert, obwohl nur ein Diagnose-Feld fehlt');
  assert.strictEqual(m.n_sel_young_enough, 900);
  assert.strictEqual(m.n_sel_young_and_stale, 0);
});

check('(g) ein KAPUTTER Zähler quarantänisiert den Shard, statt still gewaschen zu werden', () => {
  const m = mergeManifests([shard({ n_sel_young_enough: -1 }), shard({ n_sel_young_enough: 100 })], 20, 2);
  assert.strictEqual(m.n_ok, 10, 'der Shard mit -1 wurde akzeptiert');
  assert.strictEqual(m.n_sel_young_enough, 100);
  assert.strictEqual(m.n_shards_invalid, 1);
});

// ---------------------------------------------------------------- Verdrahtung, nicht nur Logik
check('(h) BEIDE Manifest-Schreiber nehmen die Zähler aus EINER Feldliste', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
  const calls = (src.match(/_selectorCounters\(\)/g) || []).length;
  assert.ok(calls >= 3, 'erwartet: Definition + zwei Schreiber, gefunden ' + calls);
  assert.ok(/function _selectorCounters/.test(src), '_selectorCounters fehlt');
  // Chunk-2-Lehre: zwei getrennte Feldlisten driften auseinander. Es darf also KEIN
  // n_sel_-Feld direkt in einem Manifest-Literal stehen.
  // die Definition selbst ist der EINE erlaubte Ort - sie wird vor dem Scan herausgeschnitten
  const defStart = src.indexOf('function _selectorCounters');
  const defEnd = src.indexOf('\n}', defStart);
  assert.ok(defStart > 0 && defEnd > defStart, 'Definition nicht gefunden');
  const ohneDef = src.slice(0, defStart) + src.slice(defEnd);
  const direkt = ohneDef.match(/\n\s*n_sel_[a-z_]+\s*:/g) || [];
  assert.deepStrictEqual(direkt.map(x => x.trim()), [],
    'ein n_sel_-Feld steht direkt in einem Literal statt in _selectorCounters(): ' + direkt);
});

check('(i) die Diagnose steht NICHT im Entscheidungspfad (kein Voll-Abruf hängt an ihr)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
  // needsFullPull / die Staleness-Entscheidung dürfen die Diagnose-Zähler nicht lesen
  for (const name of ['_selYoungEnough', '_selNotYoungButStale', '_selNotYoungUnknown']) {
    const reads = src.split(name).length - 1;
    const writes = (src.match(new RegExp(name + '(\\\\+\\\\+| = 0)', 'g')) || []).length;
    // jedes Vorkommen ist entweder Deklaration, Reset, Inkrement, _selectorCounters oder Log
    assert.ok(reads >= writes, name + ': unerwartete Lesestelle');
  }
  assert.ok(!/if\s*\([^)]*_sel(Young|Not)/.test(src),
    'ein Zweig entscheidet anhand eines Diagnose-Zaehlers');
});

// ---------------------------------------------------------------- T325: der Datei-Handle
// Merge-Desk-Fund an PR #323: openSync -> readSync -> closeSync INNERHALB eines try/catch leckt
// den Handle, sobald readSync wirft. Auf OneDrive ist das der Normalfall, nicht die Ausnahme:
// eine Cloud-Platzhalter-Datei scheitert genau beim Lesen. In der Ticker-Schleife ist das ein
// Handle pro Ticker, bis EMFILE den Lauf killt - eine Diagnose darf den Lauf nie umbringen.

check('(j) T325: wirft readSync, wird der Handle trotzdem geschlossen und null geliefert', () => {
  const dir = fixture();
  const fp = path.join(dir, 'OVERDUE.json');
  const echtRead = fs.readSync, echtClose = fs.closeSync;
  const geschlossen = [];
  try {
    fs.readSync = () => { throw new Error('EIO: simulierter OneDrive-Platzhalter'); };
    fs.closeSync = (fd) => { geschlossen.push(fd); return echtClose.call(fs, fd); };
    assert.strictEqual(P.readFileHead(fp, 4096), null, 'ein Lesefehler muss null liefern');
    assert.strictEqual(geschlossen.length, 1,
      'der Handle wurde NICHT geschlossen (Leck): closeSync-Aufrufe = ' + geschlossen.length);
    geschlossen.length = 0;
    assert.strictEqual(P.fundamentalsAsOfAgeFromFile(fp), null, 'der Aufrufer muss null liefern');
    assert.strictEqual(geschlossen.length, 1, 'auch ueber den Aufrufer leckt der Handle');
  } finally {
    fs.readSync = echtRead; fs.closeSync = echtClose;
  }
});

check('(k) T325 Gegenprobe: im Normalfall genau ein close, ohne open kein close', () => {
  const dir = fixture();
  const echtClose = fs.closeSync;
  const geschlossen = [];
  try {
    fs.closeSync = (fd) => { geschlossen.push(fd); return echtClose.call(fs, fd); };
    const head = P.readFileHead(path.join(dir, 'OVERDUE.json'), 4096);
    assert.ok(head && head.includes('fundamentalsAsOf'), 'der Kopf wurde nicht gelesen');
    assert.strictEqual(geschlossen.length, 1, 'closeSync-Aufrufe = ' + geschlossen.length);
    geschlossen.length = 0;
    assert.strictEqual(P.readFileHead(path.join(dir, 'gibtesnicht.json'), 100), null);
    assert.strictEqual(geschlossen.length, 0, 'ohne open darf kein close stehen');
  } finally {
    fs.closeSync = echtClose;
  }
});

check('(l) T325 Wurzel: beide Kopf-Leser gehen durch readFileHead, keiner liest selbst', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
  const defStart = src.indexOf('function readFileHead');
  const defEnd = src.indexOf('\n}', defStart);
  assert.ok(defStart > 0 && defEnd > defStart, 'readFileHead fehlt');
  const def = src.slice(defStart, defEnd + 2);
  assert.ok(/finally/.test(def), 'readFileHead schliesst nicht in einem finally');
  // ausserhalb dieser einen Funktion darf es kein fs.readSync mehr geben, sonst kommt das
  // Leck durch die naechste Kopf-Lese-Stelle zurueck
  const ohneDef = src.slice(0, defStart) + src.slice(defEnd);
  assert.ok(!/fs\.readSync\(/.test(ohneDef),
    'ausserhalb von readFileHead steht wieder ein fs.readSync - das Leck kann zurueckkommen');
});

console.log('pull-selector-diagnose.test.js: ' + ok + ' ok, ' + fail + ' fail');
if (fail) process.exit(1);
