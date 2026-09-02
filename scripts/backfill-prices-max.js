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
 * Exit 0 = ok (Teil-Fehler im Summary) · 1 = fatale I/O-/Input-Fehler ODER
 * (BH-145) alle Ticker fehlgeschlagen (0 ok bei >0 versuchten).
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

let yf = null;
function yahooFinanceClient() {
  if (yf) return yf;
  try {
    const YF = require('yahoo-finance2').default;
    yf = (typeof YF === 'function') ? new YF({ validation: { logErrors: false, logOptionsErrors: false } }) : YF;
  } catch (_) {
    throw new Error('yahoo-finance2 not installed');
  }
  if (!yf || typeof yf.chart !== 'function') {
    throw new Error('yahoo-finance2 chart client unavailable');
  }
  return yf;
}

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readJsonOrNull(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// A parseable but structurally wrong manifest must not be checkpointed as if it
// were healthy. In particular, named properties assigned to [] disappear during
// JSON.stringify(), so an empty legacy array is canonicalized before mutation.
// A non-empty array is ambiguous and therefore fails closed instead of guessing
// which serialized values represent completed tickers.
function normalizeProgressManifest(manifest, sourceLabel = MANIFEST) {
  if (!isRecord(manifest)) {
    throw new Error(`progress manifest ${sourceLabel} must be an object`);
  }
  if (Array.isArray(manifest.done) && manifest.done.length === 0) {
    return { ...manifest, done: {} };
  }
  if (!isRecord(manifest.done)) {
    throw new Error(`progress manifest ${sourceLabel}.done must be an object`);
  }
  return manifest;
}

function parseProgressManifest(raw, sourceLabel = MANIFEST) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) {
    throw new Error(`Corrupt progress manifest ${sourceLabel}: ${e.message} — refusing to overwrite resume state`);
  }
  return normalizeProgressManifest(parsed, sourceLabel);
}

function readProgressManifestOrThrow(f) {
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return { done: {} }; throw e; }
  return parseProgressManifest(raw, f);
}

// BH-144: STATE_FILE is committed and covers the WHOLE history (all boards ever
// seeded), not just today's board universe. readJsonOrNull() would turn an
// existing-but-unparsable STATE_FILE into {entries:{}}, and the batch loop below
// then overwrites STATE_FILE after every batch with only today's (much smaller)
// board universe — permanently dropping every ATH entry outside it. ENOENT (no
// file yet) is a legit empty seed; any OTHER read/parse failure must stop hard.
function readStateFileOrThrow(f) {
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return { asOf: null, entries: {} }; throw e; }
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`Corrupt STATE_FILE ${f}: ${e.message} — refusing to reset to {} (would drop existing ATH entries)`); }
}

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

function rotateAfterTicker(tickers, lastAttemptedTicker) {
  const ordered = tickers.slice();
  if (typeof lastAttemptedTicker !== 'string' || ordered.length < 2) return ordered;
  const index = ordered.indexOf(lastAttemptedTicker);
  if (index < 0) return ordered;
  return ordered.slice(index + 1).concat(ordered.slice(0, index + 1));
}

// Capped local runs are fair across restarts: a persistent failure remains
// pending, but cannot occupy the first limited slot forever. Unlimited runs keep
// their historical deterministic order and ignore the capped-run cursor.
function selectPendingTickers(universe, manifest, state, opts = {}, limit = 0) {
  const capped = Number.isInteger(limit) && limit > 0;
  const ordered = capped
    ? rotateAfterTicker(Array.from(new Set(universe)), manifest && manifest.lastAttemptedTicker)
    : universe;
  const pending = pendingTickers(ordered, manifest, state, opts);
  return capped ? pending.slice(0, limit) : pending;
}

function recordAttemptCursor(manifest, attempted, limit) {
  if (limit > 0 && attempted.length > 0) {
    manifest.lastAttemptedTicker = attempted[attempted.length - 1];
  }
}

// BH-145: pure predicate (testbar ohne Netz) — 0 Erfolge bei >=1 versuchtem Ticker
// ist kein Teil-Fehler mehr, sondern ein Totalausfall.
function allFailed(todoLen, ok, failedLen) {
  return todoLen > 0 && ok === 0 && failedLen > 0;
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
  const result = await yahooFinanceClient().chart(ticker, { period1: new Date('1950-01-01'), period2: new Date(), interval: '1d' });
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
  const manifest = readProgressManifestOrThrow(MANIFEST);
  const state = readStateFileOrThrow(STATE_FILE);
  const limit = parseInt(getArg('--limit', '0'), 10);
  const todo = selectPendingTickers(
    universe,
    manifest,
    state,
    { force: has('--force'), onlyStale: has('--only-stale') },
    limit,
  );
  log(`Board-Universum ${universe.length} Ticker · zu ziehen: ${todo.length} (Resume via _manifest)`);
  if (has('--dry-run')) { console.log(todo.join(',')); return; }
  if (todo.length > 0) {
    try { yahooFinanceClient(); }
    catch (e) { console.error(e.message); process.exitCode = 1; return; }
  }
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
    recordAttemptCursor(manifest, batch, limit);
    writeFileAtomic(MANIFEST, JSON.stringify(manifest, null, 1));
    state.asOf = seededAt;
    writeFileAtomic(STATE_FILE, JSON.stringify(state, null, 1));
    if (i + BATCH < todo.length) await sleep(SLEEP_MS);
  }
  log(`FERTIG: ${ok} ok, ${failed.length} failed${failed.length ? ' (' + failed.slice(0, 10).join(',') + (failed.length > 10 ? '…' : '') + ')' : ''}`);
  // BH-145: a total fetch failure (e.g. Yahoo down, network gone) previously still
  // exited 0 — a partial-failure batch is legitimately fine (exit 0, see header),
  // but zero successes out of an attempted batch is not "partial", it's a run
  // that did nothing and must not look like a seed success.
  if (allFailed(todo.length, ok, failed.length)) {
    log('ALLE Ticker fehlgeschlagen — kein einziger Erfolg. Exit 1.');
    process.exitCode = 1;
  }
}

module.exports = {
  pendingTickers,
  selectPendingTickers,
  recordAttemptCursor,
  normalizeProgressManifest,
  parseProgressManifest,
  readProgressManifestOrThrow,
  seedEntry,
  boardUniverse,
  readStateFileOrThrow,
  allFailed,
  main,
  TOP_N,
  REF_LOOKBACK_BARS,
};
if (require.main === module) main();
