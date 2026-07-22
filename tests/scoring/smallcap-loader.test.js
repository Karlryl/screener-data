'use strict';
/**
 * 5.2 WEG 1b (Council+Codex-Duell 22.07.): loadSmallcapUniverse — isolierter Loader fuer den
 * getrennten Small-Cap-Datenpfad. Beweist die drei Vertrags-Faelle (Codex-Einwand 2, Isolation):
 *   1. Verzeichnis fehlt  -> null (fail-soft Fallback-Signal, Aufrufer nimmt Hauptkorpus)
 *   2. Verzeichnis leer   -> null (dito)
 *   3. Verzeichnis befuellt -> laedt NUR die watchlist-smallcap.json-autorisierten Snapshots
 * Hermetisch (Temp-Fixtures, kein Netz, kein echtes snapshots-smallcap/).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSmallcapUniverse } = require('../../src/scoring/run-screener.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-loader-'));
}
function writeSnap(dir, ticker, mcap) {
  fs.writeFileSync(path.join(dir, ticker + '.json'), JSON.stringify({
    meta: { ticker }, marketCap: { value: mcap }, annual: { annualRev: [{ value: 5e8 }] },
  }));
}

test('loadSmallcapUniverse: fehlendes Verzeichnis -> null (Fallback-Signal)', () => {
  const missing = path.join(os.tmpdir(), 'sc-loader-does-not-exist-' + process.pid);
  assert.equal(loadSmallcapUniverse(missing, missing + '.json'), null);
});

test('loadSmallcapUniverse: leeres Verzeichnis -> null (Fallback-Signal)', () => {
  const d = tmpDir();
  const wl = path.join(d, 'wl.json');
  fs.writeFileSync(wl, JSON.stringify({ stocks: [] }));
  assert.equal(loadSmallcapUniverse(d, wl), null);
  fs.rmSync(d, { recursive: true, force: true });
});

test('loadSmallcapUniverse: befuellt -> nur watchlist-smallcap-autorisierte Snapshots', () => {
  const d = tmpDir();
  writeSnap(d, 'AAA', 4e8);
  writeSnap(d, 'BBB', 6e8);
  writeSnap(d, 'ZZZ', 5e8); // NICHT in der Watchlist -> muss rausfallen
  const wl = path.join(d, 'wl.json');
  fs.writeFileSync(wl, JSON.stringify({ stocks: [{ ticker: 'AAA' }, { ticker: 'BBB' }] }));
  const u = loadSmallcapUniverse(d, wl);
  assert.ok(Array.isArray(u));
  const tickers = u.map((s) => s.meta.ticker).sort();
  assert.deepEqual(tickers, ['AAA', 'BBB']); // ZZZ ausgeschnitten
  fs.rmSync(d, { recursive: true, force: true });
});

test('loadSmallcapUniverse: fehlende Watchlist -> fail-open (kein Schnitt)', () => {
  const d = tmpDir();
  writeSnap(d, 'AAA', 4e8);
  const noWl = path.join(d, 'nonexistent-wl.json');
  const u = loadSmallcapUniverse(d, noWl);
  assert.ok(Array.isArray(u));
  assert.equal(u.length, 1); // ohne Watchlist kein Autorisierungs-Schnitt
  fs.rmSync(d, { recursive: true, force: true });
});

if (require.main === module) {
  // node runner reports via process exit code
}
