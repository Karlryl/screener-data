'use strict';
/**
 * scripts/backfill-prices-research.js — Forschungs-Backfill der Max-Preishistorie
 * (Vergangenheits-Backtests B1 ff., Karl-Entscheid 19.07.2026 „Vergangenheit zuerst").
 *
 * Wie backfill-prices-max.js (gleicher Store prices-max/, gleiches Bar-Format
 * {date, close=adjclose}), aber bewusst OHNE dessen Nebenwirkung: es schreibt
 * NIE in den committeten Live-ATH-Vertrag external-data/ath-state.json — der
 * bleibt board-only (Split-Wächter-Universum unverändert). Eigenes Manifest
 * prices-max/_manifest-research.json (Kill+Resume; das Board-Manifest
 * _manifest.json bleibt unberührt). prices-max/ ist damit ab jetzt
 * „Top-50-Union + Forschungs-Backfill" — wer was gezogen hat, sagen die
 * Manifeste. prices-max ist gitignored (GG7c), kein Repo-Wachstum.
 *
 * CLI: node scripts/backfill-prices-research.js --tickers-file <pfad>
 *      [--limit N] [--force] [--dry-run]
 * tickers-file: eine Zeile je Ticker (Kommentarzeilen mit # erlaubt).
 * Bereits in prices-max/ vorhandene Ticker (egal aus welchem Manifest) werden
 * übersprungen (Datei-Existenz zählt, nicht Manifest-Zugehörigkeit).
 * Exit 0 = ok (Teil-Fehler im Summary) · 1 = fatal ODER alle versucht + 0 ok.
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomic-write.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const MAX_DIR = path.join(REPO_ROOT, 'prices-max');
const MANIFEST = path.join(MAX_DIR, '_manifest-research.json');
const BATCH = 8;        // Drossel wie backfill-prices-max.js (Yahoo-schonend)
const SLEEP_MS = 1500;

let yf;
try {
  const YF = require('yahoo-finance2').default;
  yf = (typeof YF === 'function') ? new YF({ validation: { logErrors: false, logOptionsErrors: false } }) : YF;
} catch (e) { console.error('yahoo-finance2 not installed'); process.exit(1); }

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchMax(ticker) {
  const result = await yf.chart(ticker, { period1: new Date('1950-01-01'), period2: new Date(), interval: '1d' });
  const bars = [];
  for (const q of (result.quotes || [])) {
    const close = q.adjclose != null ? q.adjclose : q.close;
    if (close == null || !isFinite(close) || close <= 0) continue;
    const date = (q.date instanceof Date ? q.date : new Date(q.date)).toISOString().slice(0, 10);
    bars.push({ date, close });
  }
  return bars;
}

async function main() {
  const args = process.argv.slice(2);
  const has = (k) => args.includes(k);
  const getArg = (k, dflt) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : dflt; };
  const listFile = getArg('--tickers-file', null);
  if (!listFile || !fs.existsSync(listFile)) { console.error('--tickers-file <pfad> fehlt/nicht lesbar.'); process.exit(1); }
  const wanted = fs.readFileSync(listFile, 'utf8').split(/\r?\n/)
    .map((l) => l.trim().toUpperCase()).filter((l) => l && !l.startsWith('#'));
  fs.mkdirSync(MAX_DIR, { recursive: true });
  const manifest = JSON.parse(fs.existsSync(MANIFEST) ? fs.readFileSync(MANIFEST, 'utf8') : '{"done":{}}');
  let todo = wanted.filter((t) => has('--force')
    || !fs.existsSync(path.join(MAX_DIR, safeSnapshotFilename(t))));
  const limit = parseInt(getArg('--limit', '0'), 10);
  if (limit > 0) todo = todo.slice(0, limit);
  log(`Forschungs-Backfill: ${wanted.length} gewünscht · zu ziehen: ${todo.length}`);
  if (has('--dry-run')) { console.log(todo.join(',')); return; }
  const at = new Date().toISOString().slice(0, 10);
  let ok = 0; const failed = [];
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    await Promise.all(batch.map(async (t) => {
      try {
        const bars = await fetchMax(t);
        if (bars.length < 2) { failed.push(t); return; }
        writeFileAtomic(path.join(MAX_DIR, safeSnapshotFilename(t)), JSON.stringify(bars));
        manifest.done[t] = { at, bars: bars.length };
        ok++;
      } catch (e) { failed.push(t); }
    }));
    writeFileAtomic(MANIFEST, JSON.stringify(manifest, null, 1));
    if (i + BATCH < todo.length) await sleep(SLEEP_MS);
    if ((i / BATCH) % 25 === 0) log(`Fortschritt: ${Math.min(i + BATCH, todo.length)}/${todo.length} (ok=${ok}, fail=${failed.length})`);
  }
  log(`FERTIG: ${ok} ok, ${failed.length} failed${failed.length ? ' (' + failed.slice(0, 10).join(',') + (failed.length > 10 ? '…' : '') + ')' : ''}`);
  if (todo.length > 0 && ok === 0) { log('ALLE fehlgeschlagen — Exit 1.'); process.exitCode = 1; }
}

main().catch((e) => { console.error('[fatal] ' + (e && e.stack || e)); process.exit(1); });
