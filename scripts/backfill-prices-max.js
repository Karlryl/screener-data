'use strict';
/**
 * scripts/backfill-prices-max.js — LOKALER, gedrosselter, WIEDERAUFNEHMBARER
 * Max-History-Batch (Masterplan 2.2a/b — läuft NIE im Daily-Pull-Job).
 *
 * Zieht period=max-Tagesbars (adjclose, split-/dividenden-adjustiert) für die
 * Union der Top-50 je Board aus outputs/findash-export/v1/ (einige hundert Namen
 * statt ~20k — CI-Budget-Schutz), Ablage prices-max/<TICKER>.json (gitignored,
 * GG7c: außerhalb des CI-Checkouts) + Fortschritts-Manifest prices-max/_manifest.json
 * (Kill+Resume: fertige Ticker werden übersprungen). Seedet/erneuert danach den
 * kleinen COMMITTETEN ATH-Vertrag external-data/ath-state.json:
 *   { ath, athDate, refDate, refClose, lastClose, lastDate, needsReseed:false, seededAt }
 * refDate/refClose = Anker ~40 Handelstage vor dem jüngsten Bar (liegt sicher im
 * 400d-Store) — der tägliche Split-Wächter (update-ath-state.js) vergleicht dagegen.
 *
 * On-demand-Nachzug (2.2 Vorgehen 4): einfach erneut laufen lassen — neue
 * Board-Mitglieder fehlen im Manifest und werden gezogen; --only-stale zieht
 * zusätzlich alle needsReseed-Ticker (nach Splits) neu.
 *
 * CLI: node scripts/backfill-prices-max.js [--tickers A,B] [--limit N] [--force] [--only-stale] [--dry-run]
 * Exit 0 = ok (Teil-Fehler im Summary) · 1 = fatale I/O-/Input-Fehler.
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomic-write.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const V1_DIR = path.join(REPO_ROOT, 'outputs', 'findash-export', 'v1');
const MAX_DIR = path.join(REPO_ROOT, 'prices-max');
const MANIFEST = path.join(MAX_DIR, '_manifest.json');
const STATE_FILE = path.join(REPO_ROOT, 'external-data', 'ath-state.json');
const TOP_N = 50;           // "Union der Top-50 je Board" (2.2a)
const BATCH = 8;            // gedrosselt (Yahoo-schonend, Muster backfill-prices.js)
const SLEEP_MS = 1500;
const REF_LOOKBACK_BARS = 40; // Split-Wächter-Anker: ~40 Handelstage vor newest (sicher im 400d-Store)

let yf;
try {
  const YF = require('yahoo-finance2').default;
  yf = (typeof YF === 'function') ? new YF({ validation: { logErrors: false, logOptionsErrors: false } }) : YF;
} catch (e) { console.error('yahoo-finance2 not installed'); process.exit(1); }

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readJsonOrNull(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }

// Union der Top-50 je Board (profitable+unprofitable je 50; overview/survival zählen als Board).
// Liest die Top-Level-*.json unter v1/ UND den Unterordner v1/quality/ (QC-Boards, F12) —
// sonst blieben QC-Top-50-Namen ohne HG-Platzierung dauerhaft ath:null.
function boardUniverse(v1Dir = V1_DIR) {
  const tickers = new Set();
  const files = [];
  const collect = (dir) => {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.json') && f !== 'index.json') files.push(path.join(dir, f));
      }
    } catch (_) { /* Verzeichnis fehlt (z. B. keine QC-Boards) -> überspringen */ }
  };
  collect(v1Dir);
  collect(path.join(v1Dir, 'quality')); // QC-Boards liegen im Unterordner (write-findash-export QOUT_DIR)
  for (const f of files) {
    const j = readJsonOrNull(f);
    if (!j) continue;
    const lists = [];
    if (Array.isArray(j.profitable)) lists.push(j.profitable);
    if (Array.isArray(j.unprofitable)) lists.push(j.unprofitable);
    if (Array.isArray(j.rows)) lists.push(j.rows);           // overview-Form
    if (Array.isArray(j.entries)) lists.push(j.entries);
    for (const arr of lists) for (const r of arr.slice(0, TOP_N)) if (r && r.ticker) tickers.add(r.ticker);
  }
  return Array.from(tickers);
}

// Kill+Resume-Kern (pur, testbar): welche Ticker sind noch zu ziehen?
function pendingTickers(universe, manifest, state, opts = {}) {
  const done = (manifest && manifest.done) || {};
  const entries = (state && state.entries) || {};
  return universe.filter((t) => {
    if (opts.force) return true;
    if (opts.onlyStale) return entries[t] && entries[t].needsReseed;
    if (entries[t] && entries[t].needsReseed) return true; // stale immer mitziehen
    // FIX 2 (Karl-Audit ath-resume): done-ohne-Entry (Abbruch zwischen MANIFEST- und
    // STATE-Write, Z.149/151) sonst dauerhaft uebersprungen -> ATH bleibt null. Selbstheilend:
    // fetchMax/seedEntry sind idempotent, ein Re-Pull kostet nur einen weiteren Batch-Slot.
    return !done[t] || !entries[t];
  });
}

// Aus einer Max-Serie den ATH-State-Eintrag bauen (pur, testbar).
function seedEntry(bars, seededAt) {
  const clean = bars.filter((b) => b && b.date && Number.isFinite(b.close) && b.close > 0)
    .slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (clean.length < 2) return null;
  let ath = -Infinity, athDate = null;
  for (const b of clean) if (b.close > ath) { ath = b.close; athDate = b.date; }
  const newest = clean[clean.length - 1];
  const ref = clean[Math.max(0, clean.length - 1 - REF_LOOKBACK_BARS)];
  return {
    ath, athDate,
    refDate: ref.date, refClose: ref.close,
    lastClose: newest.close, lastDate: newest.date,
    needsReseed: false, seededAt,
  };
}

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
  const universe = getArg('--tickers', null)
    ? getArg('--tickers', '').split(',').map((t) => t.trim()).filter(Boolean)
    : boardUniverse();
  if (!universe.length) { console.error('Kein Board-Universum (outputs/findash-export/v1/ fehlt?) und keine --tickers.'); process.exit(1); }
  fs.mkdirSync(MAX_DIR, { recursive: true });
  const manifest = readJsonOrNull(MANIFEST) || { done: {} };
  const state = readJsonOrNull(STATE_FILE) || { asOf: null, entries: {} };
  let todo = pendingTickers(universe, manifest, state, { force: has('--force'), onlyStale: has('--only-stale') });
  const limit = parseInt(getArg('--limit', '0'), 10);
  if (limit > 0) todo = todo.slice(0, limit);
  log(`Board-Universum ${universe.length} Ticker · zu ziehen: ${todo.length} (Resume via _manifest)`);
  if (has('--dry-run')) { console.log(todo.join(',')); return; }
  const seededAt = new Date().toISOString().slice(0, 10);
  let ok = 0; const failed = [];
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    await Promise.all(batch.map(async (t) => {
      try {
        const bars = await fetchMax(t);
        const entry = seedEntry(bars, seededAt);
        if (!entry) { failed.push(t); return; }
        writeFileAtomic(path.join(MAX_DIR, safeSnapshotFilename(t)), JSON.stringify(bars));
        state.entries[t] = entry;
        manifest.done[t] = { at: seededAt, bars: bars.length };
        ok++;
      } catch (e) { failed.push(t); }
    }));
    // Fortschritt nach JEDEM Batch persistieren (Kill+Resume — Muster A7-Checkpoint-Write).
    writeFileAtomic(MANIFEST, JSON.stringify(manifest, null, 1));
    state.asOf = seededAt;
    writeFileAtomic(STATE_FILE, JSON.stringify(state, null, 1));
    if (i + BATCH < todo.length) await sleep(SLEEP_MS);
  }
  log(`FERTIG: ${ok} ok, ${failed.length} failed${failed.length ? ' (' + failed.slice(0, 10).join(',') + (failed.length > 10 ? '…' : '') + ')' : ''}`);
}

module.exports = { pendingTickers, seedEntry, boardUniverse, TOP_N, REF_LOOKBACK_BARS };
if (require.main === module) main();
