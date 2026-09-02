'use strict';
/**
 * T204 Welle 5 - Waechter fuer die beiden in dieser Welle atomar gemachten Schreibstellen.
 *
 * Beide Stellen fuellen DENSELBEN Cache-Unterbau: den SEC-PIT-Cache, aus dem der EINE
 * konfirmatorische B1-Lauf sein Universum und seine Sektor-Zuordnung zieht.
 *
 *   scripts/sec-pit-check.js:downloadTickers  -> <cache>/company_tickers.json
 *       Der Ticker->CIK-Index. Er entscheidet, welche Firmen ueberhaupt in den B1-Pool
 *       kommen (b1-validate: `secPit.loadTickerMap()` -> tickerByCik -> needCiks).
 *   scripts/b1-validate.js:fetchSubmissions   -> <cache>/submissions/CIK<10>.json
 *       Die SIC-Zuordnung je Firma. Sie entscheidet, mit wem eine Event-Firma gematcht
 *       werden darf (sic2Of -> enrich -> Matching-Pool).
 *
 * WARUM DER BRUCH HIER DAUERHAFT IST - das ist der eigentliche Befund dieser Welle:
 * beide Schreiber stehen hinter einem `existsSync`-Nachlade-Filter. Ein Bruchstueck
 * EXISTIERT, also wird es nie nachgeladen. Der Cache bleibt vergiftet, bis jemand die
 * Datei von Hand loescht:
 *   sec-pit-check  main():            `if (!fs.existsSync(secPit.TICKER_INDEX_PATH))`
 *   b1-validate    ensureSubmissions: `ciks.filter((c) => !fs.existsSync(submissionsPath(c)))`
 *
 * Und beim submissions-Cache ist der Schaden zusaetzlich STILL: der Schreibfehler wird in
 * fetchSubmissions von `catch (_) { resolve(null); }` geschluckt, das spaetere Lesen in
 * `readSubmissionsCached` von `catch (_) { return null; }`. Eine Firma faellt lautlos aus
 * dem SIC2-Matching-Pool eines praeregistrierten Laufs - kein Fehler, kein Exit-Code,
 * keine Warnung. Genau deshalb wird hier nicht der Exit-Code geprueft, sondern die Platte
 * und die FOLGE-Wirkung (holt der naechste Lauf die Datei nach?).
 *
 * WARUM NICHT PER QUELLTEXT-REGEX: F-CGPT-060 hat das schon einmal widerlegt (siehe
 * tests/merge-shard-manifests-atomic.test.js) - ein toter writeFileAtomic-Aufruf in einem
 * if(false) haelt jede Textpruefung gruen, waehrend der echte Writer weiter zerreisst.
 * Deshalb laeuft hier der ECHTE Prozess, wird mitten im Ziel-Write abgebrochen, und
 * geprueft wird, was danach auf Platte liegt.
 *
 * MESSEBENE, ausdruecklich benannt: kein Netz. `https.get` wird per --require-Vorlader
 * durch eine Attrappe ersetzt, die eine echte SEC-Antwort nachstellt. Der Cache liegt via
 * SEC_XBRL_CACHE_DIR in einem Scratch-Verzeichnis, nie im Repo.
 *   - sec-pit-check laeuft dabei als das ECHTE Skript (node scripts/sec-pit-check.js);
 *     dass es danach mangels companyfacts.zip rot endet, ist erwartet und irrelevant -
 *     der Ticker-Download ist Schritt 1 und vorher.
 *   - b1-validate wird ueber seine EXPORTIERTE Tuer `ensureSubmissions` gefahren, weil
 *     main() den vollen SEC-PIT-Store plus prices-max braucht (in diesem Checkout nicht
 *     vorhanden). Das Modul exportiert diese Funktionen genau dafuer - vgl. den Kommentar
 *     ueber writeValidationReport. Es ist derselbe Prozess, dasselbe Modul, dieselbe
 *     Schreibstelle; nur der Einstieg ist ein anderer.
 *
 * Standalone-Runner, kein Netz. Run: node tests/t204-wave5-atomic-write.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const SEC_PIT_CHECK = path.join(REPO, 'scripts', 'sec-pit-check.js');
const B1_VALIDATE = path.join(REPO, 'scripts', 'b1-validate.js');

let pass = 0, fail = 0;
const tmpDirs = [];
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}
function scratch(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

// ---------------------------------------------------------------- Vorlader-Bausteine

// Netz-Attrappe: ersetzt https.get durch eine Antwort mit Status 200 und festem Koerper.
// Beide Skripte holen sich `https` beim Laden als MODULOBJEKT und rufen erst spaeter
// `https.get(...)` auf - ein Patch am Modulobjekt greift daher auch nach dem Laden.
function netzAttrappe(koerperJson) {
  return `
const https = require('https');
const { Readable } = require('stream');
https.get = function (url, opts, cb) {
  const res = new Readable({ read() {} });
  res.statusCode = 200;
  process.nextTick(() => { res.push(${JSON.stringify(koerperJson)}); res.push(null); });
  cb(res);
  return { on: () => {} };
};
`;
}

// Abbruch-Simulation (uebernommen aus Welle 4): jeder Write, der auf den Zielnamen zeigt
// - per fd ODER per Pfad -, schreibt ein Bruchstueck und wirft dann. Der Treffer-Text
// passt absichtlich AUCH auf `<ziel>.tmp.<pid>.<n>`: ein atomarer Writer zerreisst damit
// nur seine eigene Temp-Datei und laesst das Ziel unberuehrt, ein nacktes writeFileSync
// zerreisst das Ziel selbst.
function abbruchPatch(treffer) {
  return `
const fs = require('fs');
const zielFds = new Set();
const trifft = (p) => String(p).includes(${JSON.stringify(treffer)});
const echtOpen = fs.openSync, echtWrite = fs.writeSync, echtWriteFile = fs.writeFileSync;
fs.openSync = function (p, ...r) {
  const fd = echtOpen.call(fs, p, ...r);
  if (trifft(p)) zielFds.add(fd);
  return fd;
};
fs.writeSync = function (fd, buf, off, len, pos) {
  if (!zielFds.has(fd)) return echtWrite.call(fs, fd, buf, off, len, pos);
  echtWrite.call(fs, fd, buf, off || 0, Math.min(8, len == null ? 8 : len), pos);
  throw new Error('simulierter Abbruch mitten im Write');
};
fs.writeFileSync = function (p, data, o) {
  if (!trifft(p)) return echtWriteFile.call(fs, p, data, o);
  echtWriteFile.call(fs, p, (Buffer.isBuffer(data) ? data : Buffer.from(String(data))).slice(0, 8), o);
  throw new Error('simulierter Abbruch mitten im Write');
};
`;
}

function vorlader(dir, name, inhalt) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, inhalt, 'utf8');
  return p;
}

function lauf(skript, args, opts) {
  const o = opts || {};
  const argv = [];
  for (const v of (o.vorlade || [])) argv.push('--require', v);
  argv.push(skript, ...(args || []));
  return spawnSync(process.execPath, argv, {
    cwd: o.cwd || REPO, encoding: 'utf8', timeout: 120000,
    env: Object.assign({}, process.env, o.env || {}),
  });
}

function tmpLeichen(dir, basis) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.startsWith(basis + '.tmp'));
}

// ------------------------------------------------------- Stelle 1: sec-pit-check.js
// Realistischer Ausschnitt des echten company_tickers.json-Formats (Objekt mit
// Laufnummern als Schluessel) - genau das, was loadTickerMap() erwartet.
const TICKER_JSON = JSON.stringify({
  0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  1: { cik_str: 789019, ticker: 'MSFT', title: 'MICROSOFT CORP' },
  2: { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' },
});

function secPitFixture() {
  const cache = scratch('t204w5-secpit-');
  return {
    cache,
    index: path.join(cache, 'company_tickers.json'),
    env: { SEC_XBRL_CACHE_DIR: cache, SEC_CONTACT: 'probe@example.com' },
  };
}

// Der Lauf endet mangels companyfacts.zip immer rot (Schritt 2 des Skripts) - der
// Ticker-Download ist Schritt 1 und damit vorher abgeschlossen. Gemessen wird die Platte.
test('sec-pit-check: normaler Lauf legt den Ticker-Index vollstaendig ab', () => {
  const f = secPitFixture();
  const netz = vorlader(f.cache, 'netz.js', netzAttrappe(TICKER_JSON));
  const p = lauf(SEC_PIT_CHECK, [], { env: f.env, vorlade: [netz] });

  assert.match(p.stdout, /company_tickers\.json geladen/,
    'der Download-Zweig muss erreicht worden sein\n' + p.stdout + p.stderr);
  assert.equal(fs.readFileSync(f.index, 'utf8'), TICKER_JSON,
    'die abgelegten Bytes muessen exakt der Antwort entsprechen');
  const karte = require('../lib/sec-pit.js').loadTickerMap(f.index);
  assert.equal(karte.get('NVDA'), 1045810, 'loadTickerMap muss die Datei lesen koennen');
});

test('sec-pit-check: Abbruch im Index-Write laesst KEIN Bruchstueck zurueck', () => {
  const f = secPitFixture();
  const netz = vorlader(f.cache, 'netz.js', netzAttrappe(TICKER_JSON));
  const abbruch = vorlader(f.cache, 'abbruch.js', abbruchPatch('company_tickers.json'));
  lauf(SEC_PIT_CHECK, [], { env: f.env, vorlade: [netz, abbruch] });

  assert.equal(fs.existsSync(f.index), false,
    'ein halb geschriebener Ticker-Index waere hinter dem existsSync-Nachladefilter '
    + 'DAUERHAFT: nie nachgeladen, und jeder spaetere loadTickerMap faellt auf JSON.parse');
  assert.deepEqual(tmpLeichen(f.cache, 'company_tickers.json'), [],
    'die Temp-Datei des abgebrochenen Writes muss aufgeraeumt sein');
});

test('sec-pit-check: nach dem Abbruch holt der naechste Lauf den Index nach', () => {
  const f = secPitFixture();
  const netz = vorlader(f.cache, 'netz.js', netzAttrappe(TICKER_JSON));
  const abbruch = vorlader(f.cache, 'abbruch.js', abbruchPatch('company_tickers.json'));
  lauf(SEC_PIT_CHECK, [], { env: f.env, vorlade: [netz, abbruch] });

  // Zweiter Lauf, ohne Fehlerinjektion - genau das, was auf Karls Box am naechsten Tag
  // passiert. Mit einem Bruchstueck auf Platte greift der existsSync-Filter und meldet
  // "vorhanden", der Download bleibt aus, die kaputte Datei bleibt liegen.
  const p2 = lauf(SEC_PIT_CHECK, [], { env: f.env, vorlade: [netz] });
  assert.match(p2.stdout, /company_tickers\.json geladen/,
    'der zweite Lauf muss NACHLADEN, nicht "vorhanden" melden\n' + p2.stdout + p2.stderr);
  const karte = require('../lib/sec-pit.js').loadTickerMap(f.index);
  assert.equal(karte.size, 3, 'der nachgeladene Index muss vollstaendig sein');
});

// -------------------------------------------------------- Stelle 2: b1-validate.js
const CIK = 320193;
const SUBMISSIONS_JSON = JSON.stringify({
  cik: CIK, sic: '3571', sicDescription: 'Electronic Computers',
  tickers: ['AAPL'], name: 'Apple Inc.', filings: { recent: { form: ['10-K'] } },
});
// Was fetchSubmissions daraus baut und schreibt - die Byte-Erwartung des Happy Path.
const LEAN_ERWARTET = JSON.stringify({
  cik: CIK, sic: '3571', sicDescription: 'Electronic Computers', tickers: ['AAPL'],
});
const CIK_DATEI = 'CIK' + String(CIK).padStart(10, '0') + '.json';

// Treiber: faehrt die exportierte Tuer ensureSubmissions und meldet danach sic2Of.
const TREIBER = `
const b1 = require(${JSON.stringify(B1_VALIDATE)});
b1.ensureSubmissions([${CIK}], 'probe@example.com')
  .then(() => { console.log('SIC2=' + String(b1.sic2Of(${CIK}))); })
  .catch((e) => { console.error('TREIBER-FEHLER ' + e.message); process.exit(2); });
`;

function b1Fixture() {
  const cache = scratch('t204w5-b1-');
  return {
    cache,
    subDir: path.join(cache, 'submissions'),
    datei: path.join(cache, 'submissions', CIK_DATEI),
    env: { SEC_XBRL_CACHE_DIR: cache, SEC_CONTACT: 'probe@example.com' },
  };
}

test('b1-validate: normaler Lauf legt den submissions-Cache byte-genau ab', () => {
  const f = b1Fixture();
  const netz = vorlader(f.cache, 'netz.js', netzAttrappe(SUBMISSIONS_JSON));
  const treiber = vorlader(f.cache, 'treiber.js', TREIBER);
  const p = lauf(treiber, [], { env: f.env, vorlade: [netz] });

  assert.equal(p.status, 0, 'Treiber muss gruen sein\n' + p.stdout + p.stderr);
  assert.equal(fs.readFileSync(f.datei, 'utf8'), LEAN_ERWARTET,
    'die abgelegten Bytes muessen exakt JSON.stringify(lean) sein');
  assert.match(p.stdout, /SIC2=35/, 'die Sektor-Zuordnung muss aus dem Cache lesbar sein');
});

test('b1-validate: Abbruch im Cache-Write laesst KEIN Bruchstueck zurueck', () => {
  const f = b1Fixture();
  const netz = vorlader(f.cache, 'netz.js', netzAttrappe(SUBMISSIONS_JSON));
  const abbruch = vorlader(f.cache, 'abbruch.js', abbruchPatch(CIK_DATEI));
  const treiber = vorlader(f.cache, 'treiber.js', TREIBER);
  const p = lauf(treiber, [], { env: f.env, vorlade: [netz, abbruch] });

  // Der Schreibfehler wird in fetchSubmissions geschluckt (catch -> resolve(null)):
  // der Lauf endet GRUEN, obwohl der Cache-Eintrag zerrissen ist. Der Exit-Code taugt
  // hier also nicht als Signal - nur die Platte.
  assert.equal(p.status, 0, 'der geschluckte Schreibfehler bleibt gruen (unveraendert)');
  assert.equal(fs.existsSync(f.datei), false,
    'ein halb geschriebener submissions-Eintrag waere hinter dem existsSync-Nachladefilter '
    + 'DAUERHAFT - und still: readSubmissionsCached liefert null, sic2Of liefert null, '
    + 'die Firma faellt lautlos aus dem SIC2-Matching-Pool des konfirmatorischen Laufs');
  assert.deepEqual(tmpLeichen(f.subDir, CIK_DATEI), [],
    'die Temp-Datei des abgebrochenen Writes muss aufgeraeumt sein');
});

test('b1-validate: nach dem Abbruch holt der naechste Lauf den Cache-Eintrag nach', () => {
  const f = b1Fixture();
  const netz = vorlader(f.cache, 'netz.js', netzAttrappe(SUBMISSIONS_JSON));
  const abbruch = vorlader(f.cache, 'abbruch.js', abbruchPatch(CIK_DATEI));
  const treiber = vorlader(f.cache, 'treiber.js', TREIBER);
  lauf(treiber, [], { env: f.env, vorlade: [netz, abbruch] });

  // Zweiter Lauf ohne Fehlerinjektion. Mit einem Bruchstueck auf Platte greift der
  // Nachlade-Filter (!existsSync) und der Eintrag wird NIE repariert - sic2Of bleibt
  // dauerhaft null und die Firma dauerhaft aus dem Pool.
  const p2 = lauf(treiber, [], { env: f.env, vorlade: [netz] });
  assert.equal(p2.status, 0, 'zweiter Lauf muss gruen sein\n' + p2.stdout + p2.stderr);
  assert.match(p2.stdout, /SIC2=35/,
    'der zweite Lauf muss den Eintrag NACHLADEN; bleibt ein Bruchstueck liegen, '
    + 'meldet sic2Of dauerhaft null');
});

// ---------------------------------------------------------------------------- Ende
for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }
console.log('\nT204 Welle 5: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
