'use strict';
/**
 * S24: Snapshot-Dateinamen — Leser muessen denselben Namen bauen wie der Schreiber.
 *
 * pull-yahoo.js schreibt fundamentals-cache/ ueber lib/snapshot-fs.js
 * (safeSnapshotFilename: Grossschreibung, Sanitizer, '_'-Praefix fuer Windows-reservierte
 * Staemme wie CON/PRN/AUX/NUL). Ein Leser, der den Namen naiv als `ticker + '.json'` baut,
 * sieht z. B. `_CON.DE.json` nicht und ueberspringt die Firma still (universe-list.txt fuehrt
 * CON.DE). lib/snapshot-fs.js:9-12 nennt genau dieses Muster als P1-Befund.
 *
 * (a) Funktional: probe-datenplausibilitaet.js gegen einen Ordner mit `_CON.DE.json` und
 *     `BRK.B.json` — beide Board-Zeilen muessen als "mit Rohdaten" gezaehlt werden (2, vorher 1).
 * (b) Quelltext-Waechter: das naive Muster darf in scripts/*.js (ohne *test*) nur noch in der
 *     festen Allowlist vorkommen (Schreiber synthetischer Fixtures, Freeze-Skript, LF-gepinnte
 *     early-detection-Zone, Vergleichs-Skript) — ausserhalb 0 Treffer.
 * (c) Beide umgestellten Leser requiren lib/snapshot-fs.js.
 *
 * Break-once manuell geprueft (S24, 2026-09-24): probe-datenplausibilitaet.js:53 (vor dem Fix :52) auf
 * `z.ticker + '.json'` zurueckgedreht -> (a) meldet "davon mit Rohdaten: 1 (erwartet 2)" und
 * (b) meldet den Treffer ausserhalb der Allowlist -> Exit 1. Zurueckgesetzt -> Exit 0.
 *
 * Standalone: node tests/snapshot-dateiname-leser-paritaet.test.js  (Exit 0/1)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const PROBE = path.join(SCRIPTS, 'probe-datenplausibilitaet.js');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// --- (a) funktional -----------------------------------------------------------------
test('(a) probe-datenplausibilitaet.js findet _CON.DE.json und BRK.B.json (2 von 2 Zeilen)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's24-leser-paritaet-'));
  try {
    const snapDir = path.join(dir, 'snapshots');
    fs.mkdirSync(snapDir);
    const minimal = JSON.stringify({ metrics: {}, timeseries: {}, annual: {} });
    // Dateinamen exakt so, wie safeSnapshotFilename sie schreibt (CON -> reserviert -> '_'-Praefix).
    fs.writeFileSync(path.join(snapDir, '_CON.DE.json'), minimal);
    fs.writeFileSync(path.join(snapDir, 'BRK.B.json'), minimal);
    const board = path.join(dir, 'board.json');
    fs.writeFileSync(board, JSON.stringify({
      rows: [
        { ticker: 'CON.DE', rank: 1, name: 'Continental' },
        { ticker: 'BRK.B', rank: 2, name: 'Berkshire Hathaway' },
      ],
    }));

    const r = spawnSync(process.execPath, [PROBE, snapDir, board], { encoding: 'utf8' });
    assert.equal(r.status, 0, 'probe Exit != 0\n' + (r.stderr || '') + (r.stdout || ''));
    const m = /^davon mit Rohdaten\s*:\s*(\d+)\s*$/m.exec(r.stdout || '');
    assert.ok(m, 'Zeile "davon mit Rohdaten  : N" fehlt in stdout:\n' + r.stdout);
    const n = Number(m[1]);
    assert.equal(n, 2, `davon mit Rohdaten: ${n} (erwartet 2) — ein Leser baut den Dateinamen naiv`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- (b) Quelltext-Waechter ---------------------------------------------------------
// Feste Allowlist (Datei -> erlaubte Trefferzahl). Alles andere: 0.
const ALLOWLIST = {
  'early-detection-audit.js': 1,       // LF-gepinnte early-detection-Zone, nicht anfassen
  'gqs00-freeze.js': 2,                // Freeze-Skript, nicht anfassen
  't-veraltung-zwei-definitionen.js': 1, // schreibt synthetische Fixtures
  't178-reihen-zwillinge.js': 1,       // Vergleich Datei <-> Ticker
};
const NAIV = /(ticker|symbol)\s*\+\s*'\.json'|\$\{(ticker|symbol)\}\.json/;

test('(b) naives `<ticker>.json`-Muster nur noch in der Allowlist', () => {
  const files = fs.readdirSync(SCRIPTS)
    .filter((f) => f.endsWith('.js') && !/test/i.test(f))
    .sort();
  assert.ok(files.length > 0, 'keine scripts/*.js gefunden');
  const hits = {};
  for (const f of files) {
    const lines = fs.readFileSync(path.join(SCRIPTS, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (NAIV.test(line)) (hits[f] = hits[f] || []).push(`${f}:${i + 1}`);
    });
  }
  const ausserhalb = Object.keys(hits).filter((f) => !(f in ALLOWLIST)).flatMap((f) => hits[f]);
  assert.deepEqual(ausserhalb, [], 'naive Dateinamen ausserhalb der Allowlist: ' + ausserhalb.join(', '));
  for (const [f, max] of Object.entries(ALLOWLIST)) {
    const n = (hits[f] || []).length;
    assert.ok(n <= max, `${f}: ${n} Treffer (Allowlist erlaubt ${max}): ${(hits[f] || []).join(', ')}`);
  }
});

// --- (c) beide Leser nutzen den gemeinsamen Helfer -----------------------------------
test('(c) enrich-q-revenue.js und probe-datenplausibilitaet.js requiren lib/snapshot-fs.js', () => {
  for (const f of ['enrich-q-revenue.js', 'probe-datenplausibilitaet.js']) {
    const src = fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
    assert.ok(/require\('\.\.\/lib\/snapshot-fs\.js'\)/.test(src), `${f}: require('../lib/snapshot-fs.js') fehlt`);
    assert.ok(/safeSnapshotFilename\(/.test(src), `${f}: safeSnapshotFilename(...) wird nicht benutzt`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
