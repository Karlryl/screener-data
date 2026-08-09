#!/usr/bin/env node
/**
 * Tag 133g: Pull-Success Monitoring
 * =================================
 * Sammelt nach jedem Run-Ende die Erfolgs-Kennzahlen aller best-effort Pulls
 * (Yahoo, FX, Earnings, Historical-Prices) und vergleicht mit der trailing
 * 4-Run-Median. Discord-Alert wenn irgendeine Metrik >25% schlechter wird.
 *
 * Statt jedes Pull-Skript zu modifizieren liest dieser Reporter die bereits
 * existierenden Artefakte direkt aus:
 *   - snapshots/_manifest.json
 *   - fx-rates.json (rates count + failed array)
 *   - earnings-calendar.json (stocks-with-date count)
 *   - prices/history.json (tickers count)
 *   - watchlist.json (universe size)
 *
 * Output:
 *   outputs/pull-stats/YYYY-MM-DD.json  — heutiger Snapshot (gh-pages-only, wie outputs/)
 *   pull-stats/history.json             — kumulativ, GETRACKT (Tag 356 / BH-120)
 *   Discord-Alert bei Drift (außer ALLOW_PULL_DRIFT=1)
 *
 * BH-120: history.json lag vorher unter outputs/, das per Repo-Konvention
 * .gitignored ist ("committed via gh-pages only") und dessen gh-pages-Deploy
 * bei jedem Lauf per `git init -b gh-pages` + force-push NEU aufgebaut wird
 * (kein Restore vom Vorlauf). history.json startete daher jeden Lauf leer,
 * MIN_HISTORY_RUNS=4 wurde nie erreicht, der Drift-Waechter konnte nie feuern.
 * Fix: history.json liegt jetzt unter dem GETRACKTEN Top-Level-Verzeichnis
 * pull-stats/ (analog score-history/, external-data/ath-state.json) — der
 * ohnehin vorhandene "Commit Snapshots"-Schritt (git add -A) in
 * daily-pull.yml committet sie automatisch, keine Workflow-Aenderung noetig.
 */
'use strict';
const fs = require('fs');
const path = require('path');
// Tag 218: atomic output writes (audit F-218b-03)
const { writeFileAtomic } = require('../lib/atomic-write.js');
// Tag 220c (audit F-219b-03 LOW): shared schema-aware watchlist loader.
// Without it, a rollback to a bare-array watchlist would silently set
// universeSize=null, disabling the drift detector forever.
const { loadWatchlist } = require('../lib/watchlist-fs.js');
// Tag 294: price history is sharded — count tickers across shards (Legacy-Fallback
// inside loadAll covers the pre-migration window).
const priceStore = require('../lib/price-history-store.js');

const DRIFT_THRESHOLD = 0.25;
const MIN_HISTORY_RUNS = 4;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'outputs', 'pull-stats');
// BH-120: history.json getrennt vom gh-pages-only outputs/ — dieses Verzeichnis
// ist NICHT gitignored (siehe .gitignore-Kommentar Tag 203 zum Schwester-Pattern
// score-history/), damit die Historie ueber CI-Laeufe hinweg akkumuliert.
const HIST_DIR = path.join(ROOT, 'pull-stats');

// Tag 554: Datei-fehlt (ENOENT) ist der Normalfall — der erste Lauf hat keine
// history.json — und bleibt still. Jeder ANDERE Fehler (abgeschnittenes JSON,
// halber Write, Rechteproblem) lieferte bis hierher dieselbe wortlose null: die
// Metrik fiel auf null, detectStatsDrift ueberspringt null-Metriken, der
// Drift-Waechter meldete dann nicht einen Einbruch, sondern gar nichts.
// Rueckgabe bleibt null (kein throw) — nur die Sichtspur kommt dazu.
function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') console.warn('::warning::' + path.basename(p) + ' nicht lesbar, Metrik faellt auf null: ' + e.message);
    return null;
  }
}
// F-CGPT-033 (P0-Haertung 09.08.2026): die HISTORIE ist etwas anderes als eine Metrik-Quelle.
// Fuer die Metriken oben ist loadJson()s null richtig (Tag 554/603: unbekannt statt geraten,
// mit ::warning::). Fuer history.json war es toedlich: `loadJson(histPath) || []` machte aus
// der unlesbaren Datei eine LEERE Historie, der heutige Punkt kam dazu, und die Datei wurde
// mit genau einem Eintrag ueberschrieben. Damit sind alle Vorlaeufe weg und der Waechter
// braucht wieder MIN_HISTORY_RUNS=4 Laeufe, bis er ueberhaupt urteilen kann — waehrend er
// gruen meldet. Live nachgestellt: loadJson(korrupt) -> null, Historie faellt auf Laenge 1.
//
// Erstanlage = Datei fehlt (erster Lauf) -> []. Vorhanden, aber unlesbar oder kein Array =
// Bestand -> Wurf; runCli faengt ihn ab (::error:: + Exit 1) und NICHTS wird ueberschrieben.
// Bewusst nicht lib/read-json.js: das verlangt ein Objekt, die Historie ist ein Array.
function ladeHistorie(p) {
  let roh;
  try { roh = fs.readFileSync(p, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return [];
    e.message = p + ' ist vorhanden, aber nicht lesbar (' + e.message + ') — kein Erstanlage-Fall';
    throw e;
  }
  let wert;
  try { wert = JSON.parse(roh); }
  catch (e) {
    throw new Error(p + ' ist vorhanden, aber unlesbar (' + e.message + ') — kein Erstanlage-Fall, '
      + 'die Historie wird NICHT durch den heutigen Einzelpunkt ersetzt');
  }
  if (!Array.isArray(wert)) {
    throw new Error(p + ' enthaelt kein Array, sondern ' + (wert === null ? 'null' : typeof wert)
      + ' — kein Erstanlage-Fall, refusing to overwrite');
  }
  return wert;
}

function median(values) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function collectStats() {
  const today = new Date().toISOString().slice(0, 10);
  const stats = { asOf: today };

  // Yahoo pull
  const manifest = loadJson(path.join(ROOT, 'snapshots', '_manifest.json'));
  stats.yahooOk = manifest ? (manifest.n_ok || 0) : null;
  stats.yahooFailed = manifest ? (manifest.n_failed || 0) : null;
  stats.yahooTotal = manifest ? (manifest.n_total || 0) : null;
  stats.yahooSuccessRate = (stats.yahooTotal && stats.yahooOk != null)
    ? Math.round(stats.yahooOk / stats.yahooTotal * 1000) / 1000 : null;

  // FX
  const fx = loadJson(path.join(ROOT, 'fx-rates.json'));
  stats.fxRatesCount = fx && fx.rates ? Object.keys(fx.rates).length : null;
  stats.fxFailed = fx && fx.failed ? fx.failed.length : null;

  // Earnings
  const earnings = loadJson(path.join(ROOT, 'earnings-calendar.json'));
  stats.earningsWithDate = earnings ? Object.keys(earnings).length : null;

  // Historical prices (Tag 294: sharded → count across shards; null on load error)
  let priceTickerCount = null;
  // P0-Haertung 2026-08-09 (Review-Fund): der Catch war stumm. Seit loadAll auch bei
  // korrupter _meta.json und bei fehlenden Shards wirft, faengt er GENAU die Faelle, gegen
  // die die Haertung gebaut wurde — und detectStatsDrift ueberspringt null-Metriken (s. u.),
  // der Drift-Waechter waere fuer die eigene Bugklasse blind geworden. Der Wert bleibt null
  // (unbekannt ist ehrlicher als 0), aber der Grund steht jetzt im Lauf.
  try { priceTickerCount = Object.keys(priceStore.loadAll(path.join(ROOT, 'prices'))).length; }
  catch (e) { console.log('::warning::priceTickerCount nicht messbar: Preis-Store nicht ladbar (' + e.message + ')'); }
  stats.priceTickerCount = priceTickerCount;

  // Universe
  // Tag 220c (audit F-219b-03): use shared schema-aware loader so all three
  // historical shapes (array / wrapped / bare-object) are recognised.
  const wl = loadWatchlist(path.join(ROOT, 'watchlist.json'));
  stats.universeSize = wl.shape === 'invalid' ? null : wl.size;

  // Snapshots dir count
  const snapDir = path.join(ROOT, 'snapshots');
  if (fs.existsSync(snapDir)) {
    stats.snapshotsCount = fs.readdirSync(snapDir).filter(f => f.endsWith('.json') && f !== '_manifest.json').length;
  } else {
    stats.snapshotsCount = null;
  }

  return stats;
}

function detectStatsDrift(today, history, threshold) {
  threshold = threshold == null ? DRIFT_THRESHOLD : threshold;
  if (!Array.isArray(history) || history.length < MIN_HISTORY_RUNS) return [];
  const alerts = [];
  const recent = history.slice(-MIN_HISTORY_RUNS);
  // Watch these metrics for downward drift only (loss of coverage)
  const watched = ['yahooOk', 'fxRatesCount', 'earningsWithDate', 'priceTickerCount', 'snapshotsCount'];
  for (const metric of watched) {
    const todayVal = today[metric];
    if (todayVal == null) continue;
    const priorVals = recent.map(r => r[metric]).filter(v => v != null && Number.isFinite(v));
    if (priorVals.length < MIN_HISTORY_RUNS) continue;
    const med = median(priorVals);
    if (med == null || med <= 0) continue;
    const drift = (todayVal - med) / med;
    if (drift < -threshold) {
      alerts.push({ metric, today: todayVal, median: med, drift: Math.round(drift * 1000) / 1000 });
    }
  }
  return alerts;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(HIST_DIR)) fs.mkdirSync(HIST_DIR, { recursive: true });
  const today = collectStats();

  const histPath = path.join(HIST_DIR, 'history.json');
  let history = ladeHistorie(histPath);
  // Avoid duplicate entries for same date
  history = history.filter(h => h && h.asOf !== today.asOf);
  history.push(today);
  // Keep last 26 weeks
  history = history.slice(-26);
  writeFileAtomic(histPath, JSON.stringify(history, null, 2));

  writeFileAtomic(path.join(OUT_DIR, today.asOf + '.json'), JSON.stringify(today, null, 2));

  console.log('Pull-Stats ' + today.asOf + ':');
  for (const [k, v] of Object.entries(today)) {
    if (k !== 'asOf') console.log('  ' + k.padEnd(20) + ' = ' + v);
  }

  const alerts = detectStatsDrift(today, history.slice(0, -1), DRIFT_THRESHOLD);
  if (alerts.length === 0) {
    console.log('  no drift detected.');
    return 0;
  }
  console.log('  DRIFT DETECTED:');
  for (const a of alerts) {
    console.log(`    ${a.metric}: today=${a.today} vs median=${a.median} (${(a.drift*100).toFixed(0)}%)`);
  }
  if (process.env.ALLOW_PULL_DRIFT === '1') {
    console.log('  ALLOW_PULL_DRIFT=1 — not alerting.');
    return 0;
  }
  const msg = '⚠ Pull-Stats Drift (' + today.asOf + '): ' +
    alerts.map(a => `${a.metric} ${(a.drift*100).toFixed(0)}% (today=${a.today}, median=${a.median})`).join(', ');
  // 29.07.: Der Discord-Versand ist raus (Karl-Freigabe) — der Webhook existierte nie,
  // und Karl liest ohnehin nur das rote X.
  // 28.07.: frueher stand hier `return 0; // never fail workflow; alert is enough`.
  // Der Alarm war aber KEINER: DISCORD_WEBHOOK ist nicht gesetzt (der Workflow sagt es
  // selbst — "Discord alerts disabled"), und Karl liest ohnehin kein Discord, sondern
  // ausschliesslich das rote X auf GitHub. Ein halbierter Pull lief damit still durch.
  // Jetzt Exit 1; der Schritt traegt weiterhin continue-on-error, sein Ergebnis wird
  // aber am Ende des Jobs eingesammelt und faerbt den Lauf rot. Ventil bleibt:
  // ALLOW_PULL_DRIFT=1 (oben) fuer bekannte, gewollte Einbrueche.
  console.error('::error::Pull-Stats-Drift — ' + msg);
  return 1;
}

async function runCli(mainImpl = main, io = {}) {
  const exit = io.exit || process.exit;
  const error = io.error || console.error;
  try {
    exit((await mainImpl()) || 0);
  } catch (e) {
    // 29.07.: Hier stand `process.exit(0)` mit einem Discord-Ping als Sichtbarmachung.
    // Der Ping geht ins Leere (DISCORD_WEBHOOK ist nicht gesetzt), und damit war ein
    // ABGESTUERZTER Waechter fuer immer gruen — genau die Klasse Fehler, gegen die er
    // gebaut wurde, nur eine Ebene hoeher. Ein Waechter, der beim eigenen Absturz
    // Erfolg meldet, ist keiner.
    // Jetzt derselbe Weg wie beim erkannten Drift zwei Zeilen weiter oben: ::error::
    // plus Exit 1. Der Schritt traegt continue-on-error, sein Ergebnis wird am Ende
    // des Jobs eingesammelt und faerbt den Lauf rot — Karls einziger Alarmkanal.
    error('::error::check-pull-stats abgestuerzt (Waechter hat NICHT geprueft): ' + e.message);
    exit(1);
  }
}

module.exports = { collectStats, detectStatsDrift, loadJson, ladeHistorie, median, HIST_DIR, OUT_DIR, runCli };

if (require.main === module) {
  runCli();
}
