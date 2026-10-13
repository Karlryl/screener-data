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

function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

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
  // Split-Wächter: Referenzpunkt im Store nachschlagen (exakter Tag).
  if (out.refDate && Number.isFinite(out.refClose)) {
    const ref = byDate.find((b) => b.date === out.refDate);
    if (ref) {
      if (Math.abs(ref.close / out.refClose - 1) > REF_DRIFT_TOLERANCE) {
        out.needsReseed = true; // Re-Basierung erkannt (Split/Adjustierung) — Anzeige aus
      }
    } else if (byDate[0].date > out.refDate) {
      // refDate aus dem rollenden ~400-Tage-Fenster HERAUSGEALTERT (ältester Bar jünger als
      // refDate): byDate.find bliebe für immer undefined -> der Split-Wächter wäre dauerhaft
      // lautlos aus (echter Split nie erkannt, ath friert auf Vor-Split-Skala). Reseed
      // erzwingen -> backfill-prices-max verankert refDate/refClose neu, Anzeige aus bis dahin.
      // (Der Übergang wird in der [ath]-Summenzeile mitgezählt — kein neuer stiller Zustand.)
      out.needsReseed = true;
    }
    // sonst: refDate fehlt als Loch MITTEN im Fenster (Feiertag/Datenloch) -> kein Urteil.
  }
  const newest = byDate[byDate.length - 1];
  out.lastClose = newest.close;
  out.lastDate = newest.date;
  // BH-184: a corrupt/missing out.ath (e.g. null) must not silently become the
  // 400-day window's high via JS coercion (`b.close > null` -> `b.close > 0`,
  // true for every close since byDate is already filtered to close > 0) — that
  // would plant a fake, too-low ATH instead of the honest "no display until
  // reseed". Schema-guard before the bump loop: non-finite/<=0 ath -> reseed.
  if (!out.needsReseed && !(Number.isFinite(out.ath) && out.ath > 0)) {
    out.needsReseed = true;
  }
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
  // AT-SK-ATH-001 (P1-Welle 1): ath/athDate stammen aus dem lokalen Max-Batch (prices-max/),
  // lastClose/lastDate aus dem rollenden 400-Tage-Store. Bleibt ein Ticker im 400d-Store
  // stehen (Handelsaussetzung, Pull-Luecke), liegt athDate NACH dem letzten Schlusskurs.
  // monthsBetween klemmt die negative Differenz per Math.max(0,…) auf 0 — die Zeile behauptet
  // dann "ATH heute", und distancePct vergleicht zwei Staende, die nie gleichzeitig galten.
  // Live: 1 von 956 Eintraegen (CSH-UN.TO, athDate 2026-07-03 > lastDate 2026-06-15).
  // Kein Reseed-Flag (das gehoert dem Split-Waechter), sondern ehrliches "keine Anzeige",
  // bis der Schlusskurs-Store den ATH-Tag erreicht hat — dann kommt die Zeile von selbst
  // zurueck, ohne dass irgendwo ein Zustand nachgezogen werden muss.
  if (entry.athDate > entry.lastDate) return null;
  return {
    distancePct: +((entry.lastClose / entry.ath - 1) * 100).toFixed(1), // <=0 unter ATH
    athDate: entry.athDate,
    monthsAgo: monthsBetween(entry.athDate, entry.lastDate),
    // BH-129: lastDate roh durchreichen — der Export hatte bislang KEINERLEI
    // Zeilen-Datum im ath-Payload, nur den globalen state.asOf-Gesamtstempel.
    // Bei einem lueckenhaften Preis-Store (Ticker seit Wochen ohne neuen Bar)
    // sah eine 32-Tage-alte distancePct unter frischem asOf wie eine heutige
    // Zahl aus. displayFor kennt state.asOf selbst nicht (wird ihm nicht
    // durchgereicht) — lastDate roh exportieren laesst jeden Konsumenten (z.B.
    // Findash) selbst entscheiden, ab wann "zu alt" ist, statt hier eine
    // Schwelle zu erfinden.
    lastDate: entry.lastDate,
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

function runUpdateAthState(stateFile, pricesDir, deps = {}) {
  const existsSync = deps.existsSync || fs.existsSync;
  const readFileSync = deps.readFileSync || fs.readFileSync;
  const loadHistory = deps.loadHistory || loadHistoryOrDie;
  const writeState = deps.writeFileAtomic || writeFileAtomic;
  const today = deps.today || (() => new Date().toISOString().slice(0, 10));
  const log = deps.log || console.log;
  let state;
  if (!existsSync(stateFile)) {
    log('[ath] kein ath-state.json — No-op (Seeding via backfill-prices-max.js)');
    return;
  }
  // BH-137: ENOENT (Bootstrap, legitimes No-op) und ein EXISTIERENDER, aber
  // kaputter/truncierter committeter State duerfen nicht denselben stillen
  // No-op-Pfad nehmen — sonst friert ein korrupter Vertrag lautlos ein statt
  // aufzufallen. existsSync trennt beide Faelle; ein Parse-Fehler auf einer
  // vorhandenen Datei ist jetzt fail-loud (wie loadHistoryOrDie unten).
  try { state = JSON.parse(readFileSync(stateFile, 'utf8')); }
  catch (e) {
    throw new Error('[ath] ' + stateFile + ' existiert, ist aber nicht lesbar/parsebar (' + e.message + ') — fail-loud statt stillem No-op auf einem korrupten committeten Vertrag.');
  }
  // A parseable non-object must not collapse through `state.entries || {}` into
  // a healthy empty-state no-op. Every committed artifact revision and the
  // producer use an own JSON object at both the root and entries boundaries.
  if (!isJsonObject(state)) {
    throw new Error('[ath] ATH state root must be a non-null, non-array object: ' + stateFile);
  }
  if (!Object.prototype.hasOwnProperty.call(state, 'entries') || !isJsonObject(state.entries)) {
    throw new Error('[ath] ATH state entries must be a non-null, non-array object: ' + stateFile);
  }
  const entries = state.entries;
  for (const [ticker, entry] of Object.entries(entries)) {
    if (!isJsonObject(entry)) {
      throw new Error('[ath] ATH state entry ' + JSON.stringify(ticker)
        + ' must be a non-null, non-array object: ' + stateFile);
    }
  }
  const tickers = Object.keys(entries);
  if (!tickers.length) { log('[ath] ath-state leer — No-op'); return; }
  const history = loadHistory(pricesDir);
  let bumped = 0, reseed = 0, touched = 0;
  for (const t of tickers) {
    const before = entries[t];
    const after = advanceEntry(before, history[t]);
    if (after.needsReseed && !before.needsReseed) reseed++;
    if (after.ath > before.ath) bumped++;
    if (JSON.stringify(after) !== JSON.stringify(before)) touched++;
    entries[t] = after;
  }
  state.asOf = today();
  writeState(stateFile, JSON.stringify(state, null, 1));
  log(`[ath] ${tickers.length} Ticker · ${touched} aktualisiert · ${bumped} neue ATHs · ${reseed} needsReseed (Split-Wächter)`);
}

function main() {
  const args = process.argv.slice(2);
  const getArg = (k, dflt) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : dflt; };
  const stateFile = path.resolve(getArg('--state', DEFAULT_STATE));
  const pricesDir = path.resolve(getArg('--prices-dir', DEFAULT_PRICES));
  return runUpdateAthState(stateFile, pricesDir);
}

module.exports = { advanceEntry, displayFor, monthsBetween, loadHistoryOrDie, runUpdateAthState, REF_DRIFT_TOLERANCE };
if (require.main === module) main();
