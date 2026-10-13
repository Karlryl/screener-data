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

test('loadSmallcapUniverse: nicht ladbare Watchlist -> Abbruch statt ungefiltertem Scoring', () => {
  // ⚠ UMGEDREHT 02.08. (Hard Review S5-SC-001). Hier stand vorher die Erwartung
  // "fehlende Watchlist -> fail-open (kein Schnitt)", also: alle vorhandenen Snapshots werden
  // ungefiltert gescort. Genau das ist der gemeldete Defekt — der Test nagelte ihn fest.
  //
  // WARUM DAS NACHZIEHEN UND KEIN ABSCHWAECHEN IST: es gibt zwei verschiedene Zustaende, und
  // nur einer ist harmlos. (a) Verzeichnis fehlt oder ist leer = "noch kein getrennter
  // Small-Cap-Pull gelaufen" -> legitimer Fallback, gibt weiterhin null (eigener Test unten).
  // (b) Verzeichnis VOLL, aber die Watchlist dazu nicht ladbar = widerspruechlicher Zustand,
  // denn der Small-Cap-Pull schreibt beides. Frueher fuehrte (b) dazu, dass der komplette
  // on-disk-Bestand ohne Autorisierungs-Schnitt in die Kohorten-Perzentile ging — lautlos.
  // Der Abbruch ist fail-soft aufgefangen: run-screener.js:395 umschliesst den Aufruf mit
  // try/catch (nachgesehen, nicht angenommen), der Small-Cap-Pass entfaellt diesen Lauf mit
  // sichtbarem Fehl-Marker, HG und QC bleiben unberuehrt.
  const d = tmpDir();
  writeSnap(d, 'AAA', 4e8);
  const noWl = path.join(d, 'nonexistent-wl.json');
  assert.throws(() => loadSmallcapUniverse(d, noWl), /Watchlist nicht ladbar/,
    'eine nicht ladbare Watchlist darf nicht wie "keine Einschraenkung" wirken');
  fs.rmSync(d, { recursive: true, force: true });
});

test('loadSmallcapUniverse: fehlendes Verzeichnis bleibt der legitime Fallback (null, kein Wurf)', () => {
  // Die Gegenprobe zum Test darueber: der harmlose Zustand darf NICHT mitgerissen werden.
  // Sonst waere aus dem Fix ein zweiter Defekt geworden (jeder Lauf ohne getrennten
  // Small-Cap-Pull haette den Small-Cap-Pass mit Fehl-Marker abgebrochen).
  const d = tmpDir();
  const fehlt = path.join(d, 'gibt-es-nicht');
  assert.equal(loadSmallcapUniverse(fehlt, path.join(d, 'auch-nicht.json')), null);
  // Und: Verzeichnis da, aber leer -> ebenfalls null, ohne die Watchlist ueberhaupt anzufassen.
  assert.equal(loadSmallcapUniverse(d, path.join(d, 'auch-nicht.json')), null);
  fs.rmSync(d, { recursive: true, force: true });
});

if (require.main === module) {
  // node runner reports via process exit code
}
