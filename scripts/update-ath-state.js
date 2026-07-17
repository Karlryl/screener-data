'use strict';
/**
 * scripts/update-ath-state.js — täglicher, BILLIGER ATH-Fortschrieb (Masterplan 2.2c).
 *
 * Liest external-data/ath-state.json (committet, klein — der einzige ATH-Vertrag,
 * den die CI sieht; die Max-Historie prices-max/ lebt per GG7c AUSSERHALB des
 * CI-Checkouts und wird nur lokal vom Batch scripts/backfill-prices-max.js gepflegt)
 * und den 400-Tage-Preis-Store (prices/history/, 32 Shards). Je Ticker im State:
 *   - neue Tages-Schlusskurse > ath  -> ath/athDate anheben (ATH kann nur steigen)
 *   - lastClose/lastDate nachziehen  (Quelle der Abstands-Anzeige im Export)
 *   - SPLIT-WÄCHTER: adjclose ist RÜCK-adjustiert — nach einem Split re-basiert der
 *     Store historische Tage (fetched-wins-Merge, Ledger A7-b). Der beim Seeding
 *     eingefrorene Referenzpunkt (refDate/refClose) weicht dann ab -> needsReseed:true,
 *     Anzeige wird null (ehrlich), bis der lokale Max-Batch neu seedet. NIE stille
 *     falsche ATH-Anzeige nach Splits (NVDA-10:1-Falle).
 * Ticker OHNE State-Eintrag werden NIE hier ergänzt (kein Max-Wissen ohne Max-Pull) —
 * Neuzugänge holt der lokale Batch on-demand (2.2, Vorgehen 4).
 *
 * Anzeige-Semantik: Abstand = lastClose/ath − 1 (Verhältnis in Handelswährung —
 * währungsfrei wie Forward-Returns, L18). Reine ANZEIGE, nie Score-Input (Grundgesetz 1).
 *
 * Usage: node scripts/update-ath-state.js [--state <file>] [--prices-dir <dir>]
 * Exit 0 = ok (auch "kein State" = No-op) · 1 = harter I/O-Fehler.
 */
const fs = require('fs');
const path = require('path');
const store = require('../lib/price-history-store.js');
const { writeFileAtomic } = require('../lib/atomic-write.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_STATE = path.join(REPO_ROOT, 'external-data', 'ath-state.json');
// Vertrag: store.loadAll(dir) hängt 'history' SELBST an (price-history-store.js
// HISTORY_DIRNAME) — deshalb der ELTERN-Ordner prices/, identisch zu allen anderen
// loadAll-Aufrufern (pull-historical-prices.js './prices', rank-ic loadPriceIndexOrThrow
// prices/, Tag-321-Fix R2.3). Zeigte er auf prices/history, suchte der Store unter
// prices/history/history/ -> leer -> ATH-State bekam nie Schlusskurse/Split-Erkennung.
const DEFAULT_PRICES = path.join(REPO_ROOT, 'prices');
// Split-Wächter-Toleranz: adjclose driftet durch Dividenden-Re-Adjustierung leicht;
// echte Splits springen um Faktoren (2x/4x/10x). 5 % trennt beides sauber.
const REF_DRIFT_TOLERANCE = 0.05;

function monthsBetween(fromIso, toIso) {
  const a = new Date(fromIso + 'T00:00:00Z'), b = new Date(toIso + 'T00:00:00Z');
  return Math.max(0, Math.round((b - a) / 86400000 / 30.44));
}

// Pure Kernlogik (testbar): einen State-Eintrag gegen die Store-Serie fortschreiben.
// series = [{date, close}] beliebiger Ordnung. Mutiert nichts; liefert neuen Eintrag.
function advanceEntry(entry, series) {
  const out = Object.assign({}, entry);
  if (!Array.isArray(series) || series.length === 0) return out;
  const byDate = series.filter((b) => b && b.date && Number.isFinite(b.close) && b.close > 0)
    .slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!byDate.length) return out;
  // Split-Wächter: Referenzpunkt im Store nachschlagen (exakter Tag; fehlt er, kein Urteil).
  if (out.refDate && Number.isFinite(out.refClose)) {
    const ref = byDate.find((b) => b.date === out.refDate);
    if (ref && Math.abs(ref.close / out.refClose - 1) > REF_DRIFT_TOLERANCE) {
      out.needsReseed = true; // Re-Basierung erkannt (Split/Adjustierung) — Anzeige aus
    }
  }
  const newest = byDate[byDate.length - 1];
  out.lastClose = newest.close;
  out.lastDate = newest.date;
  if (!out.needsReseed) {
    for (const b of byDate) {
      if (b.close > out.ath) { out.ath = b.close; out.athDate = b.date; }
    }
  }
  return out;
}

// Anzeige-Felder für den Export (null-sicher; needsReseed/lückenhaft -> null).
function displayFor(entry) {
  if (!entry || entry.needsReseed) return null;
  if (!Number.isFinite(entry.ath) || entry.ath <= 0 || !Number.isFinite(entry.lastClose) || !entry.athDate || !entry.lastDate) return null;
  return {
    distancePct: +((entry.lastClose / entry.ath - 1) * 100).toFixed(1), // <=0 unter ATH
    athDate: entry.athDate,
    monthsAgo: monthsBetween(entry.athDate, entry.lastDate),
  };
}

// Store->History laden, fail-loud statt still leer (Muster rank-ic loadPriceIndexOrThrow,
// Tag 321). Ein leerer Index ODER ein fehlender Frische-Stempel (_meta.json) bedeutet,
// dass dieser Lauf NICHTS fortschreibt — nach dem F3-Miss (falscher pricesDir -> {}) darf
// ein toter ATH-Lauf nie wieder still grün durchlaufen. Wirft -> Node beendet mit Exit != 0.
function loadHistoryOrDie(pricesDir) {
  const history = store.loadAll(pricesDir);
  if (Object.keys(history).length === 0 || store.loadMeta(pricesDir) == null) {
    throw new Error(
      '[ath] Preis-Store LEER/ungestempelt aus ' + pricesDir + ' — der ATH-Fortschrieb würde '
      + 'nichts tun (kein Schlusskurs-Nachzug, kein Split-Wächter). Erwartet wird das '
      + 'prices-Verzeichnis (der Store hängt "history" selbst an), nicht prices/history.',
    );
  }
  return history;
}

function main() {
  const args = process.argv.slice(2);
  const getArg = (k, dflt) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : dflt; };
  const stateFile = path.resolve(getArg('--state', DEFAULT_STATE));
  const pricesDir = path.resolve(getArg('--prices-dir', DEFAULT_PRICES));
  let state;
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch (_) { console.log('[ath] kein ath-state.json — No-op (Seeding via backfill-prices-max.js)'); return; }
  const entries = state.entries || {};
  const tickers = Object.keys(entries);
  if (!tickers.length) { console.log('[ath] ath-state leer — No-op'); return; }
  const history = loadHistoryOrDie(pricesDir);
  let bumped = 0, reseed = 0, touched = 0;
  for (const t of tickers) {
    const before = entries[t];
    const after = advanceEntry(before, history[t]);
    if (after.needsReseed && !before.needsReseed) reseed++;
    if (after.ath > before.ath) bumped++;
    if (JSON.stringify(after) !== JSON.stringify(before)) touched++;
    entries[t] = after;
  }
  state.asOf = new Date().toISOString().slice(0, 10);
  writeFileAtomic(stateFile, JSON.stringify(state, null, 1));
  console.log(`[ath] ${tickers.length} Ticker · ${touched} aktualisiert · ${bumped} neue ATHs · ${reseed} needsReseed (Split-Wächter)`);
}

module.exports = { advanceEntry, displayFor, monthsBetween, loadHistoryOrDie, REF_DRIFT_TOLERANCE };
if (require.main === module) main();
