'use strict';
// S43: JSON.parse auf Fremddaten (SEC-Ticker-Map per HTTP, Nutzer-Ticker-Datei,
// Studien-Regelwerk) muss fail-loud mit Herkunft (URL bzw. Pfad) werfen und den
// urspruenglichen SyntaxError als `cause` tragen. Gueltige Daten: Ergebnis unveraendert.
// Standalone-Runner: `node tests/json-fremddaten-kontext.test.js` -> Exit 0/1. Kein Netz.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const form4 = require('../scripts/pull-insider-form4.js');
const backfill = require('../scripts/backfill-prices.js');
const verfassung = require('../lib/studie-verfassung.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's43-json-kontext-'));
let anzahl = 0;
function ok(bedingung, text) { assert.ok(bedingung, text); anzahl++; }
function gleich(ist, soll, text) { assert.deepStrictEqual(ist, soll, text); anzahl++; }

try {
  // ── (a) scripts/pull-insider-form4.js: parseTickerCikBody(body, url) ──────
  const URL = 'https://www.sec.gov/files/company_tickers.json';
  const { parseTickerCikBody } = form4._internals;
  ok(typeof parseTickerCikBody === 'function', 'a: parseTickerCikBody unter _internals exportiert');
  ok(typeof form4.loadTickerCikMap === 'function' && typeof form4._internals.httpGet === 'function',
    'a: loadTickerCikMap und _internals.httpGet bleiben exportiert');

  gleich(
    parseTickerCikBody('{"0":{"cik_str":320193,"ticker":"aapl","title":"Apple"}}', URL),
    { AAPL: { cik: '0000320193', name: 'Apple' } },
    'a: gueltiger Body -> byTicker-Normalisierung (UPPER, 10-stellige CIK, name)');
  gleich(
    parseTickerCikBody('{"0":{"cik_str":0,"ticker":"x"},"1":{"cik_str":5,"ticker":""},"2":{"cik":7,"ticker":" msft "}}', URL),
    { MSFT: { cik: '0000000007', name: '' } },
    'a: Zeilen ohne Ticker / mit Null-CIK werden wie bisher verworfen, cik-Fallback greift');

  assert.throws(
    () => parseTickerCikBody('<html><body>SEC maintenance</body></html>', URL),
    e => {
      ok(e instanceof Error && !(e instanceof SyntaxError), 'a: Wurf ist ein Error mit Kontext, kein nackter SyntaxError');
      ok(e.message.includes(URL), 'a: Message nennt die URL: ' + e.message);
      ok(e.cause instanceof SyntaxError, 'a: cause ist der originale SyntaxError');
      return true;
    });

  // ── (b) scripts/backfill-prices.js: loadTickerFile(filePath) ─────────────
  const gut = path.join(tmp, 'tickers-gut.json');
  fs.writeFileSync(gut, '["AAPL"," msft "]');
  gleich(backfill.loadTickerFile(gut), ['AAPL', 'msft'], 'b: gueltiges JSON-Array -> getrimmt, unveraendert');

  const zeilen = path.join(tmp, 'tickers.txt');
  fs.writeFileSync(zeilen, 'AAPL\n msft \n\n');
  gleich(backfill.loadTickerFile(zeilen), ['AAPL', 'msft'], 'b: Newline-Zweig unveraendert');

  const kaputt = path.join(tmp, 'tickers-kaputt.json');
  fs.writeFileSync(kaputt, '["AAPL",');
  assert.throws(
    () => backfill.loadTickerFile(kaputt),
    e => {
      ok(e.message.includes(kaputt), 'b: Message nennt den Dateipfad: ' + e.message);
      ok(e.cause instanceof SyntaxError, 'b: cause ist der originale SyntaxError');
      return true;
    });

  // ── (c) lib/studie-verfassung.js: ladeRegelwerk(pfad) ────────────────────
  const regelwerkGut = path.join(tmp, 'rules.json');
  const regeln = { version: '2.0.0', regeln: [{ id: 'R1' }, { id: 'R2', fenster: 3 }] };
  fs.writeFileSync(regelwerkGut, JSON.stringify(regeln));
  gleich(verfassung.ladeRegelwerk(regelwerkGut), regeln, 'c: gueltiges Regelwerk -> deepEqual');

  const regelwerkKaputt = path.join(tmp, 'rules-kaputt.json');
  fs.writeFileSync(regelwerkKaputt, '{kaputt');
  assert.throws(
    () => verfassung.ladeRegelwerk(regelwerkKaputt),
    e => {
      ok(e.message.includes(regelwerkKaputt), 'c: Message nennt den Pfad: ' + e.message);
      ok(e.cause instanceof SyntaxError, 'c: cause ist der originale SyntaxError');
      ok(!(e instanceof verfassung.VerfassungsBruch), 'c: normaler Error, KEIN VerfassungsBruch (Fehlerklasse fuer Aufrufer bleibt)');
      return true;
    });

  // Echtes Regelwerk laedt weiterhin (Default-Pfad, kein Verhaltenswechsel).
  ok(verfassung.ladeRegelwerk() && typeof verfassung.ladeRegelwerk() === 'object', 'c: Default-Regelwerk laedt weiterhin');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`json-fremddaten-kontext: ${anzahl} Assertions gruen`);
