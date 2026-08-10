'use strict';
/**
 * Tag 634 (P1-Welle 8, R1-SK-008): Waechter gegen den Blanket-Unterstrich-Filter.
 *
 * Befund: lib/snapshot-fs.js definiert seit Tag 356 `isMetadataSnapshot` (nur
 * `_manifest*` + `_last_good_disk.json`), aber ~14 produktive Snapshot-Verzeichnis-
 * Leser filterten stattdessen pauschal `!f.startsWith('_')`. Ein Ticker, dessen
 * Snapshot-Dateiname per safeSnapshotFilename ein `_`-Praefix bekommt (Windows-
 * Reserved: CON, PRN, AUX, NUL, COM1-9, LPT1-9, punkt-only-Stems), fiel damit aus
 * JEDER Zaehlung und JEDEM Gate — still, ohne Fehlermeldung.
 *
 * Zwei Ebenen:
 *   (i)  Verhalten: ein echter `_CON.json`-Snapshot wird von den umgestellten
 *        Lesern MITgezaehlt, `_manifest.json` NICHT.
 *   (ii) Quelltext am Objekt: kein Snapshot-Verzeichnis-Leser traegt mehr das
 *        Blanket-Muster. Ausnahmeliste sind die board-history-Leser (dort ist
 *        `_` ein Sidecar-Marker mit ANDERER Semantik, und Board-Dateinamen kommen
 *        nicht aus safeSnapshotFilename) — deren Anwesenheit wird MITgeprueft,
 *        damit eine stale Ausnahmeliste auffliegt statt zu decken.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const { safeSnapshotFilename, isMetadataSnapshot } = require(path.join(ROOT, 'lib', 'snapshot-fs.js'));

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
};

// --- Fixture: ein Snapshot-Verzeichnis mit normalem Ticker + Reserved-Name + Metadaten ---
function snapshot(ticker) {
  return {
    meta: { ticker, asof: '2026-08-10' },
    profile: { sector: 'Technology' },
    annual: { annualRevenue: [{ date: '2024-12-31', value: 1000 }, { date: '2025-12-31', value: 1100 }] },
  };
}

function baueFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'welle8-'));
  const snapDir = path.join(dir, 'snapshots');
  fs.mkdirSync(snapDir, { recursive: true });
  // Der Reserved-Name-Dateiname kommt aus dem Produktiv-Helfer, nicht aus einem Literal —
  // sonst prueft der Test seine eigene Annahme statt die des Systems.
  const conFile = safeSnapshotFilename('CON');
  assert.equal(conFile, '_CON.json', 'safeSnapshotFilename hat sein Reserved-Name-Praefix verloren');
  fs.writeFileSync(path.join(snapDir, 'AAPL.json'), JSON.stringify(snapshot('AAPL')));
  fs.writeFileSync(path.join(snapDir, conFile), JSON.stringify(snapshot('CON')));
  fs.writeFileSync(path.join(snapDir, '_manifest.json'), JSON.stringify({ n_ok: 2, n_eingang_snapshots: 2 }));
  return { dir, snapDir };
}

// --- (i-a) watch-annual-spikes.scanSnapshots: funktional treibbar --------------------
t('scanSnapshots zaehlt _CON.json mit und _manifest.json nicht', () => {
  const { snapDir } = baueFixture();
  const { scanSnapshots } = require(path.join(ROOT, 'scripts', 'watch-annual-spikes.js'));
  const scan = scanSnapshots(snapDir);
  assert.equal(scan.gescannt, 2, 'gescannt: erwartet AAPL + _CON (ohne _manifest), bekam ' + scan.gescannt);
  assert.equal(scan.parseFehler, 0);
});

// --- (i-b) merge-shard-manifests: die Coverage-Zaehlung ueber CLI --------------------
t('merge-shard-manifests zaehlt _CON.json in n_ok/on-disk mit', () => {
  const { dir, snapDir } = baueFixture();
  const smDir = path.join(dir, 'shard-manifests');
  fs.mkdirSync(smDir, { recursive: true });
  fs.writeFileSync(path.join(smDir, 'shard-0.json'), JSON.stringify({
    n_ok: 2, n_full: 2, n_priceonly: 0, n_skipped_mcap: 0, n_failed: 0, partial: false, watchlist_version: 'welle8',
  }));
  const wl = path.join(dir, 'watchlist.json');
  fs.writeFileSync(wl, JSON.stringify({ stocks: [{ ticker: 'AAPL' }, { ticker: 'CON' }] }));

  const out = execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'merge-shard-manifests.js'),
    '--snapshots', snapDir, '--shard-manifests', smDir, '--watchlist', wl, '--expected-shards', '1',
  ], { encoding: 'utf8' });

  const m = out.match(/on-disk snapshots=(\d+)/);
  assert.ok(m, 'stdout ohne on-disk-Zahl: ' + out);
  assert.equal(Number(m[1]), 2, 'on-disk: erwartet 2 (AAPL + _CON), bekam ' + m[1]);
  const geschrieben = JSON.parse(fs.readFileSync(path.join(snapDir, '_manifest.json'), 'utf8'));
  assert.equal(geschrieben.n_ok, 2, 'n_ok im gemergten Manifest: erwartet 2, bekam ' + geschrieben.n_ok);
});

// --- (i-c) das Praedikat selbst ------------------------------------------------------
t('isMetadataSnapshot: Metadaten raus, Reserved-Name-Snapshots rein', () => {
  for (const f of ['_manifest.json', '_manifest-full.json', '_manifest-research.json', '_last_good_disk.json']) {
    assert.equal(isMetadataSnapshot(f), true, f + ' muesste Metadaten sein');
  }
  for (const tick of ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9', '.DE']) {
    const f = safeSnapshotFilename(tick);
    assert.equal(f.startsWith('_'), true, tick + ' -> ' + f + ' (erwartet _-Praefix)');
    assert.equal(isMetadataSnapshot(f), false, tick + ' -> ' + f + ' darf NICHT als Metadaten gelten');
  }
});

// --- (ii) Quelltext-Waechter am Objekt ----------------------------------------------
// Board-history-Leser: dort ist `_` ein Sidecar-Marker (_excluded.json,
// _gate-calibration.json), die Dateinamen kommen NICHT aus safeSnapshotFilename —
// isMetadataSnapshot waere dort semantisch falsch. Bewusste Ausnahme.
const BOARD_HISTORY_LESER = [
  'lib/e1-compression.js',
  'scripts/formel-struktur-uebersicht.js',
  'scripts/rank-ic.js',
  'scripts/write-board-history.js',
];
// Mindestzahl der Dateien, die das zentrale Praedikat benutzen (21 Umstellungen aus
// Tag 634 + filter-snapshot-merge.js + verify-freshness.js). Faengt den Fall, in dem
// jemand isMetadataSnapshot durch eine neue lokale Sonderform ersetzt — die traegt
// kein Blanket-Muster und wuerde der Regel oben entgehen.
const KONSUMENTEN_MIN = 23;

function jsDateien() {
  const out = [];
  const scan = (rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.js')) out.push(rel ? rel + '/' + e.name : e.name);
    }
  };
  scan('scripts'); scan('lib'); scan('tests/scoring'); scan('');
  return out;
}

// Eine Zeile filtert ein Verzeichnis genau dann, wenn sie im selben Ausdruck auf
// `.json`-Endung UND auf `_`-Praefix prueft. Objektschluessel-Filter (`k.startsWith('_')`
// ueber Exchange-/Stock-Keys) und Kommentare tragen das nicht und bleiben unberuehrt.
const BLANKET = (zeile) => /\.startsWith\('_'\)/.test(zeile) && /endsWith\('\.json'\)/.test(zeile);

t('kein Snapshot-Leser traegt mehr das Blanket-Muster (Abwesenheit)', () => {
  const verstoesse = [];
  for (const rel of jsDateien()) {
    if (BOARD_HISTORY_LESER.includes(rel)) continue;
    const zeilen = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    zeilen.forEach((z, i) => { if (BLANKET(z)) verstoesse.push(rel + ':' + (i + 1) + ': ' + z.trim()); });
  }
  assert.deepEqual(verstoesse, [], 'Blanket-Filter statt isMetadataSnapshot:\n' + verstoesse.join('\n'));
});

t('Ausnahmeliste ist nicht stale — jeder board-history-Leser traegt das Muster noch (Anwesenheit)', () => {
  for (const rel of BOARD_HISTORY_LESER) {
    const zeilen = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    assert.ok(zeilen.some(BLANKET),
      rel + ' steht auf der Ausnahmeliste, traegt das Muster aber nicht mehr — Eintrag entfernen oder Datei pruefen');
  }
});

t('das zentrale Praedikat hat mindestens ' + KONSUMENTEN_MIN + ' Konsumenten (gueltige Form geht durch)', () => {
  const nutzer = jsDateien().filter((rel) => {
    if (rel === 'lib/snapshot-fs.js') return false;
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    return /require\([^)]*snapshot-fs\.js'\)/.test(src) && /isMetadataSnapshot\s*\(/.test(src);
  });
  assert.ok(nutzer.length >= KONSUMENTEN_MIN,
    'nur ' + nutzer.length + ' Konsumenten von isMetadataSnapshot (erwartet >= ' + KONSUMENTEN_MIN + '):\n' + nutzer.join('\n'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
