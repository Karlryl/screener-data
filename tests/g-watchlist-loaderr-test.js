'use strict';
/**
 * g-watchlist-loaderr-test.js — S5-SC-001: lib/watchlist-fs.js loadWatchlist() liefert bei
 * einem Ladefehler (Datei fehlt/kaputt) stocks:[] + error:<msg>. src/scoring/run-screener.js
 * ignorierte wl.error bisher: filterToAuthorizedUniverse(u, []) faellt (dokumentiert gewollt
 * fuer eine ECHTE leere Watchlist) auf "kein Schnitt" zurueck -> bei einem Ladefehler wurden
 * lautlos ALLE on-disk-Snapshots gescort, auch laengst aus dem Universum geflogene.
 *
 * Fix: wl.error auswerten, bei echtem Ladefehler hart abbrechen (wie der Coverage-Floor in
 * derselben Datei). Eine echte leere, aber fehlerfrei geladene Watchlist bleibt Fail-open
 * (unveraendertes, gewolltes Verhalten) — das unterscheidet der Test explizit mit.
 *
 * Getestet ueber loadSmallcapUniverse() (identischer Bug-Ort laut Review, snapDir/watchlistPath
 * sind dort injizierbar -> hermetisch ohne die echte watchlist.json anzufassen). Die
 * loadUniverse()-Haelfte des Fixes nutzt denselben wl.error-Codepfad (siehe merge-sec-xbrl.js-
 * Nachbarschaft in run-screener.js) und wird hier NICHT separat exerziert, um die echte
 * Repo-Watchlist nicht zu beruehren.
 *
 * Usage: node tests/g-watchlist-loaderr-test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSmallcapUniverse } = require('../src/scoring/run-screener.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'g-wl-loaderr-')); }
function writeSnap(dir, ticker) {
  fs.writeFileSync(path.join(dir, ticker + '.json'), JSON.stringify({ meta: { ticker }, annual: {} }));
}

test('Watchlist-Datei fehlt (Ladefehler) -> loadSmallcapUniverse() wirft, statt ungefiltert alles zu scoren', () => {
  const snapDir = tmpDir();
  writeSnap(snapDir, 'AAPL');
  writeSnap(snapDir, 'DELISTED');
  const missingWatchlist = path.join(tmpDir(), 'nicht-vorhanden.json');
  assert.throws(
    () => loadSmallcapUniverse(snapDir, missingWatchlist),
    /nicht ladbar/,
    'ein echter Ladefehler muss hart abbrechen, nicht lautlos alles durchlassen'
  );
});

test('Watchlist-Datei kaputt (invalides JSON) -> wirft ebenfalls', () => {
  const snapDir = tmpDir();
  writeSnap(snapDir, 'AAPL');
  const wlDir = tmpDir();
  const brokenWatchlist = path.join(wlDir, 'watchlist-smallcap.json');
  fs.writeFileSync(brokenWatchlist, '{ kaputtes json');
  assert.throws(() => loadSmallcapUniverse(snapDir, brokenWatchlist), /nicht ladbar/);
});

test('Watchlist echt leer, aber fehlerfrei geladen (stocks:[]) -> bleibt Fail-open (gewolltes Verhalten unveraendert)', () => {
  const snapDir = tmpDir();
  writeSnap(snapDir, 'AAPL');
  writeSnap(snapDir, 'MSFT');
  const wlDir = tmpDir();
  const emptyWatchlist = path.join(wlDir, 'watchlist-smallcap.json');
  fs.writeFileSync(emptyWatchlist, JSON.stringify({ stocks: [] }));
  const u = loadSmallcapUniverse(snapDir, emptyWatchlist);
  assert.equal(u.length, 2, 'echte leere Watchlist (kein Fehler) darf weiterhin fail-open ungefiltert durchlassen');
});

test('Watchlist mit Eintraegen -> normale Autorisierungs-Filterung funktioniert unveraendert', () => {
  const snapDir = tmpDir();
  writeSnap(snapDir, 'AAPL');
  writeSnap(snapDir, 'DELISTED');
  const wlDir = tmpDir();
  const goodWatchlist = path.join(wlDir, 'watchlist-smallcap.json');
  fs.writeFileSync(goodWatchlist, JSON.stringify({ stocks: [{ ticker: 'AAPL' }] }));
  const u = loadSmallcapUniverse(snapDir, goodWatchlist);
  assert.equal(u.length, 1);
  assert.equal(u[0].meta.ticker, 'AAPL');
});

console.log(`\ng-watchlist-loaderr-test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
