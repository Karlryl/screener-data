'use strict';
/** tests/refresh-universe-reine-helfer.test.js — Standalone-Runner (node <datei>, Exit 0/1).
 * S35: refresh-universe.js exportiert sechs reine Helfer, die bisher kein Test aufrief:
 *   numEnv, _looksUS, _isNonEquityQuote, toYahooClassShare, dedupKey, capNewTickerAdmission.
 * Diese Datei pinnt ihr heutiges Verhalten. require('../refresh-universe.js') fuehrt nur die
 * Definitionen aus (main() haengt an require.main === module), kein Netz, keine Dateien.
 * numEnv bricht bei ungueltigem Wert per process.exit(1) ab — dafuer wird process.exit waehrend
 * des Falls durch eine werfende Attrappe ersetzt und im finally restauriert; console.error wird
 * dabei aufgefangen. capNewTickerAdmission loggt eine 'Universe-Cap'-Zeile auf stdout —
 * console.log wird dafuer aufgefangen und ebenfalls restauriert. Der letzte Test prueft, dass
 * alle Attrappen weg sind und die Test-Env-Variable geloescht ist. */
const assert = require('node:assert/strict');

// Originale VOR dem ersten Test sichern — der Schlusstest vergleicht dagegen.
const originalExit = process.exit;
const originalConsoleError = console.error;
const originalConsoleLog = console.log;
const ENV_NAME = 'S35_REINE_HELFER_TESTWERT';
assert.equal(process.env[ENV_NAME], undefined, 'Vorbedingung: Test-Env-Variable darf nicht vorbelegt sein');

const ru = require('../refresh-universe.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// ── toYahooClassShare ───────────────────────────────────────────────────────────
test('toYahooClassShare: US-Klassenaktie Punkt -> Strich (BRK.B -> BRK-B, BF.A -> BF-A)', () => {
  assert.equal(ru.toYahooClassShare('BRK.B', true), 'BRK-B');
  assert.equal(ru.toYahooClassShare('BF.A', true), 'BF-A');
  assert.equal(ru.toYahooClassShare('CIG.C', true), 'CIG-C');
});

test('toYahooClassShare: nur bei isUS=true, sonst unveraendert (Auslands-Ticker nie anfassen)', () => {
  assert.equal(ru.toYahooClassShare('BRK.B', false), 'BRK.B');
  assert.equal(ru.toYahooClassShare('BRK.B', undefined), 'BRK.B');
});

test('toYahooClassShare: Form-Grenzen sind case-sensitiv und max. 5 Buchstaben, .V ausgeschlossen', () => {
  assert.equal(ru.toYahooClassShare('brk.b', true), 'brk.b', 'Kleinbuchstaben matchen die Klassen-RE nicht');
  assert.equal(ru.toYahooClassShare('ABCDEF.A', true), 'ABCDEF.A', '6 Buchstaben liegen ausserhalb [A-Z]{1,5}');
  assert.equal(ru.toYahooClassShare('FDX.V', true), 'FDX.V', '.V ist When-Issued-Artefakt, keine Klasse');
  assert.equal(ru.toYahooClassShare('BRK-B', true), 'BRK-B', 'Strichform bleibt Strichform');
});

test('toYahooClassShare: Nicht-Strings und leere Werte kommen unveraendert zurueck', () => {
  assert.equal(ru.toYahooClassShare(42, true), 42);
  assert.equal(ru.toYahooClassShare(null, true), null);
  assert.equal(ru.toYahooClassShare('', true), '');
});

// ── _looksUS ────────────────────────────────────────────────────────────────────
test('_looksUS: Yahoo-Boersencodes und ausgeschriebene US-Venues -> true', () => {
  assert.equal(ru._looksUS('NMS'), true);
  assert.equal(ru._looksUS('NYQ'), true);
  assert.equal(ru._looksUS('NYSE American'), true);
  assert.equal(ru._looksUS('NASDAQ'), true, 'bares NASDAQ (nasdaq-all/nasdaq-api) ist US');
});

test('_looksUS: camelCase-Formen von q.fullExchangeName (NasdaqGS, NYSEArca) -> true', () => {
  assert.equal(ru._looksUS('NasdaqGS'), true);
  assert.equal(ru._looksUS('NYSEArca'), true);
});

test('_looksUS: Nordic-Nasdaq und andere Auslands-Venues -> false (Lookahead greift)', () => {
  assert.equal(ru._looksUS('NASDAQ Stockholm'), false);
  assert.equal(ru._looksUS('Nasdaq Helsinki'), false);
  assert.equal(ru._looksUS('LSE'), false);
  assert.equal(ru._looksUS('OSL'), false);
});

test('_looksUS: ohne Exchange entscheidet die Quelle (sec-edgar ja, lse nein, case-insensitiv)', () => {
  assert.equal(ru._looksUS('', 'sec-edgar'), true);
  assert.equal(ru._looksUS('', 'SEC-EDGAR'), true, 'Quelle wird kleingeschrieben verglichen');
  assert.equal(ru._looksUS('', 'nasdaq-trader'), true);
  assert.equal(ru._looksUS('', 'lse'), false);
  assert.equal(ru._looksUS(undefined, undefined), false);
});

// ── _isNonEquityQuote ───────────────────────────────────────────────────────────
test('_isNonEquityQuote: expliziter Nicht-EQUITY-Typ -> true', () => {
  assert.equal(ru._isNonEquityQuote({ quoteType: 'ETF' }), true);
  assert.equal(ru._isNonEquityQuote({ quoteType: 'MUTUALFUND' }), true);
});

test('_isNonEquityQuote: EQUITY oder fehlendes Feld -> false (fail-open), null/undefined -> false', () => {
  assert.equal(ru._isNonEquityQuote({ quoteType: 'EQUITY' }), false);
  assert.equal(ru._isNonEquityQuote({}), false, 'fehlendes Feld: Bulk-Antworten tragen es nicht garantiert');
  assert.equal(ru._isNonEquityQuote({ quoteType: '' }), false);
  assert.equal(ru._isNonEquityQuote(null), false);
  assert.equal(ru._isNonEquityQuote(undefined), false);
});

// ── dedupKey ────────────────────────────────────────────────────────────────────
test('dedupKey: US-Zeile kollabiert BRK.B auf BRK-B, Auslands-Zeile bleibt BRK.B', () => {
  assert.equal(ru.dedupKey('BRK.B', 'NMS'), 'BRK-B');
  assert.equal(ru.dedupKey('BRK.B', 'NasdaqGS'), 'BRK-B');
  assert.equal(ru.dedupKey('BRK.B', '', 'sec-edgar'), 'BRK-B', 'US-ness auch allein ueber die Quelle');
  assert.equal(ru.dedupKey('BRK.B', 'LSE', 'lse'), 'BRK.B');
  assert.equal(ru.dedupKey('ABC', 'NMS'), 'ABC', 'ohne Klassen-Suffix keine Umschreibung');
});

// ── numEnv ──────────────────────────────────────────────────────────────────────
/** Fuehrt fn mit gesetzter Env-Variable aus; process.exit wirft statt zu beenden, console.error
 *  wird aufgefangen. Alles im finally restauriert, Env-Variable geloescht. */
function mitEnv(wert, fn) {
  const errors = [];
  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error('__exit__'); };
  console.error = (...args) => { errors.push(args.join(' ')); };
  if (wert === undefined) delete process.env[ENV_NAME]; else process.env[ENV_NAME] = wert;
  try {
    let result, threw = false;
    try { result = fn(); } catch (e) { if (e.message !== '__exit__') throw e; threw = true; }
    return { result, threw, exitCode, errors };
  } finally {
    process.exit = originalExit;
    console.error = originalConsoleError;
    delete process.env[ENV_NAME];
  }
}

test('numEnv: fehlende oder leere Env-Variable -> Default, keine Fehlermeldung', () => {
  const a = mitEnv(undefined, () => ru.numEnv(ENV_NAME, 7));
  assert.equal(a.result, 7);
  assert.equal(a.threw, false);
  const b = mitEnv('', () => ru.numEnv(ENV_NAME, 7));
  assert.equal(b.result, 7);
  assert.equal(b.errors.length, 0);
});

test('numEnv: gueltige Zahl -> Number, auch innerhalb min/max', () => {
  assert.equal(mitEnv('12', () => ru.numEnv(ENV_NAME, 7)).result, 12);
  assert.equal(mitEnv('12', () => ru.numEnv(ENV_NAME, 7, { min: 10, max: 20 })).result, 12);
  assert.equal(mitEnv('0.5', () => ru.numEnv(ENV_NAME, 7)).result, 0.5);
});

test('numEnv: nicht-endlicher Wert -> ::error:: + process.exit(1) (kein stilles NaN)', () => {
  const r = mitEnv('abc', () => ru.numEnv(ENV_NAME, 7));
  assert.equal(r.threw, true, 'process.exit muss aufgerufen worden sein');
  assert.equal(r.exitCode, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^::error::Ungueltiger Wert fuer S35_REINE_HELFER_TESTWERT="abc"/);
  const t = mitEnv('25o00', () => ru.numEnv(ENV_NAME, 7));
  assert.equal(t.exitCode, 1, 'Number() lehnt auch das Trunkierungs-Muster ab (parseInt wuerde 25 liefern)');
});

test('numEnv: unter opts.min oder ueber opts.max -> process.exit(1), Meldung nennt die Grenze', () => {
  const lo = mitEnv('5', () => ru.numEnv(ENV_NAME, 7, { min: 10 }));
  assert.equal(lo.exitCode, 1);
  assert.match(lo.errors[0], />= 10/);
  const hi = mitEnv('50', () => ru.numEnv(ENV_NAME, 7, { max: 20 }));
  assert.equal(hi.exitCode, 1);
  assert.match(hi.errors[0], /<= 20/);
});

// ── capNewTickerAdmission ───────────────────────────────────────────────────────
/** Faengt console.log waehrend fn auf und restauriert es im finally. */
function mitLog(fn) {
  const zeilen = [];
  console.log = (...args) => { zeilen.push(args.join(' ')); };
  try { return { result: fn(), zeilen }; }
  finally { console.log = originalConsoleLog; }
}
const kandidaten = () => [{ ticker: 'A', marketCap: 1 }, { ticker: 'B', marketCap: 9 }, { ticker: 'C', marketCap: 5 }];

test('capNewTickerAdmission: ueber Budget -> hoechste marketCap ueberleben, Eingabereihenfolge bleibt', () => {
  const liste = kandidaten();
  const { result, zeilen } = mitLog(() => ru.capNewTickerAdmission(liste, 0, 2));
  assert.deepEqual(result.map(x => x.ticker), ['B', 'C'], 'B(9) und C(5) bleiben, A(1) faellt; Reihenfolge wie Eingabe');
  assert.ok(zeilen.some(z => /Universe-Cap/.test(z)), 'eine Universe-Cap-Zeile muss auf stdout erscheinen');
  assert.deepEqual(liste.map(x => x.ticker), ['A', 'B', 'C'], 'Eingabeliste wird nicht mutiert');
});

test('capNewTickerAdmission: Liste <= Restbudget -> dieselbe Referenz zurueck, kein Log', () => {
  const liste = kandidaten();
  const { result, zeilen } = mitLog(() => ru.capNewTickerAdmission(liste, 0, 3));
  assert.equal(result, liste, 'exakt dieselbe Referenz (kein Kopieren)');
  assert.equal(zeilen.length, 0);
  assert.equal(mitLog(() => ru.capNewTickerAdmission(liste, 7, 10)).result, liste);
});

test('capNewTickerAdmission: Bestand groesser als MAX_UNIVERSE -> leere Liste (kein negativer Cap)', () => {
  const { result } = mitLog(() => ru.capNewTickerAdmission(kandidaten(), 5, 3));
  assert.deepEqual(result, []);
});

// ── Restaurierung ───────────────────────────────────────────────────────────────
test('Restaurierung: process.exit, console.error, console.log und process.env sind wieder original', () => {
  assert.equal(process.exit, originalExit);
  assert.equal(console.error, originalConsoleError);
  assert.equal(console.log, originalConsoleLog);
  assert.equal(process.env[ENV_NAME], undefined);
});

console.log(`\nrefresh-universe-reine-helfer.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
