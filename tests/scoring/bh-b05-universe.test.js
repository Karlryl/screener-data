'use strict';
/**
 * b05-universe — Test-Gate fuer BH-038/BH-039/BH-040/BH-041/BH-100/BH-193
 * (refresh-universe.js, Batch b05-universe).
 * ============================================================================
 * Standalone-Runner, keine Frameworks, kein Netz (require() fuehrt nur die
 * Modul-Definitionen aus — main() ist auf require.main===module gegated).
 *
 * Usage:  node tests/scoring/bh-b05-universe.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const ru = require('../../refresh-universe.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// --- BH-038: der Fehler-Klassifizierer, der frueher process.exit(1) VOR den
// Laenderadaptern/dem Watchlist-Write ausgeloest hat, muss die permanente
// yahoo-finance2-v3.14-Schema-Inkompatibilitaet erkennen, aber transiente Fehler
// (429, Netzwerk-Timeout) NICHT als fatal einstufen (die bleiben per-exchange retry).
test('BH-038: EXCHANGE_SCREENER_SCHEMA_ERROR_RE erkennt die permanente Schema-Inkompatibilitaet', () => {
  assert.ok(ru.EXCHANGE_SCREENER_SCHEMA_ERROR_RE.test('yahoo-finance2 called with invalid options'));
  assert.ok(ru.EXCHANGE_SCREENER_SCHEMA_ERROR_RE.test('additionalProperties is not allowed, scrIds required'));
});
test('BH-038: EXCHANGE_SCREENER_SCHEMA_ERROR_RE matcht NICHT transiente Fehler (bleiben per-exchange retry-faehig)', () => {
  assert.ok(!ru.EXCHANGE_SCREENER_SCHEMA_ERROR_RE.test('429 Too Many Requests'));
  assert.ok(!ru.EXCHANGE_SCREENER_SCHEMA_ERROR_RE.test('ETIMEDOUT'));
  assert.ok(!ru.EXCHANGE_SCREENER_SCHEMA_ERROR_RE.test('socket hang up'));
});

// --- BH-039: EQUITY-only-Filter fuer beide Intake-Loops (Fonds-/Bond-Screener-Buckets
// sowie der Exchange-Screener liefern sonst ETF/MUTUALFUND/BOND-Zeilen mit).
test('BH-039: _isNonEquityQuote verwirft ETF/MUTUALFUND/BOND, laesst EQUITY durch', () => {
  assert.equal(ru._isNonEquityQuote({ quoteType: 'EQUITY' }), false);
  assert.equal(ru._isNonEquityQuote({ quoteType: 'ETF' }), true);
  assert.equal(ru._isNonEquityQuote({ quoteType: 'MUTUALFUND' }), true);
  assert.equal(ru._isNonEquityQuote({ quoteType: 'BOND' }), true);
});
test('BH-039: _isNonEquityQuote ist fail-open bei fehlendem/leerem quoteType (kein Datenverlust)', () => {
  assert.equal(ru._isNonEquityQuote({}), false);
  assert.equal(ru._isNonEquityQuote({ quoteType: null }), false);
  assert.equal(ru._isNonEquityQuote(null), false);
});

// --- BH-040: finaler Persistenz-Cap. Bestehende Watchlist-Zeilen werden NIE evictiert
// (keine marketCap-Daten fuer sie vorhanden -> Eviction waere eine Grundsatzentscheidung);
// stattdessen wird die ADMISSION neuer Ticker auf das verbleibende MAX_UNIVERSE-Budget
// gedeckelt, mit derselben mcap-Prioritaet wie der bestehende Kandidaten-Cap.
test('BH-040: capNewTickerAdmission ist ein No-Op, wenn newTickers ins Budget passen', () => {
  const newTickers = [
    { ticker: 'A', marketCap: 300e9, source: 'test' },
    { ticker: 'B', marketCap: 200e9, source: 'test' },
  ];
  const out = ru.capNewTickerAdmission(newTickers, 8, 10); // Budget = 2, genau passend
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(t => t.ticker).sort(), ['A', 'B']);
});
test('BH-040: capNewTickerAdmission deckelt auf das verbleibende Budget, hoechste mcap zuerst', () => {
  const newTickers = [
    { ticker: 'LOW',  marketCap: 100e9, source: 'test' },
    { ticker: 'HIGH', marketCap: 300e9, source: 'test' },
    { ticker: 'MID',  marketCap: 200e9, source: 'test' },
  ];
  // existingSize=8, MAX_UNIVERSE=10 -> Budget=2 -> nur 2 von 3 duerfen rein.
  const out = ru.capNewTickerAdmission(newTickers, 8, 10);
  assert.equal(out.length, 2, 'muss auf das verbleibende Budget (2) deckeln');
  const kept = new Set(out.map(t => t.ticker));
  assert.ok(kept.has('HIGH'), 'hoechste mcap muss admittiert werden');
  assert.ok(kept.has('MID'), 'zweithoechste mcap muss admittiert werden');
  assert.ok(!kept.has('LOW'), 'niedrigste mcap darf bei Budget-Ueberschuss NICHT admittiert werden');
});
test('BH-040: capNewTickerAdmission admittiert NICHTS Neues, wenn das Budget bereits erschoepft ist', () => {
  const newTickers = [{ ticker: 'X', marketCap: 500e9, source: 'test' }];
  const out = ru.capNewTickerAdmission(newTickers, 10, 10); // existingSize===MAX_UNIVERSE -> Budget=0
  assert.equal(out.length, 0);
});

// --- BH-041 / BH-193: numerische Env-Var-Validierung (numEnv). Ein Tippfehler/eine
// stille Truncation darf NIE zu einem NaN-deaktivierten Gate fuehren (frueher: jeder
// numerische Vergleich gegen NaN ist false -> Floor/Cap wirkungslos aus).
test('BH-193: numEnv liefert den Default bei fehlendem/leerem Env-Wert', () => {
  delete process.env.__BH193_TEST_VAR__;
  assert.equal(ru.numEnv('__BH193_TEST_VAR__', 42, { min: 0 }), 42);
});
test('BH-193: numEnv parst einen gueltigen Wert innerhalb des Bereichs', () => {
  process.env.__BH193_TEST_VAR__ = '25000';
  assert.equal(ru.numEnv('__BH193_TEST_VAR__', 30000, { min: 1 }), 25000);
  delete process.env.__BH193_TEST_VAR__;
});
test('BH-193: numEnv bricht fail-closed ab bei NaN (Tippfehler) statt NaN durchzureichen', () => {
  process.env.__BH193_TEST_VAR__ = 'foo';
  const origExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error('__EXIT__'); };
  try {
    assert.throws(() => ru.numEnv('__BH193_TEST_VAR__', 30000, { min: 1 }), /__EXIT__/);
    assert.equal(exitCode, 1);
  } finally {
    process.exit = origExit;
    delete process.env.__BH193_TEST_VAR__;
  }
});
test('BH-193: numEnv bricht fail-closed ab bei stiller Truncation (parseInt-Luecke, z.B. "25o00")', () => {
  // Number('25o00') = NaN (anders als parseInt('25o00',10) === 25, das den Tippfehler
  // stillschweigend verschluckt hätte).
  process.env.__BH193_TEST_VAR__ = '25o00';
  const origExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error('__EXIT__'); };
  try {
    assert.throws(() => ru.numEnv('__BH193_TEST_VAR__', 30000, { min: 1 }), /__EXIT__/);
    assert.equal(exitCode, 1);
  } finally {
    process.exit = origExit;
    delete process.env.__BH193_TEST_VAR__;
  }
});
test('BH-193: numEnv bricht fail-closed ab bei Wert ausserhalb des erlaubten Bereichs', () => {
  process.env.__BH193_TEST_VAR__ = '-5';
  const origExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error('__EXIT__'); };
  try {
    assert.throws(() => ru.numEnv('__BH193_TEST_VAR__', 30000, { min: 0 }), /__EXIT__/);
    assert.equal(exitCode, 1);
  } finally {
    process.exit = origExit;
    delete process.env.__BH193_TEST_VAR__;
  }
});

console.log(`\nbh-b05-universe.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
