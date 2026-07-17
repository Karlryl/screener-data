'use strict';
/**
 * scripts/write-board-history.js — Vintage-Writer der eigenen Messreihe (Masterplan 2.3).
 *
 * INERT gebaut: KEIN CI-Wiring, KEIN echtes Vintage #1. Grundgesetz 6 / Task 2.14
 * (revAcceleration-Fix) blockieren den scharfen Start — die Formel darf nicht auf
 * der P2-kaputten Accel-Achse eingefroren werden. Dieses Werkzeug steht bereit,
 * damit es beim 2.14-Landing sofort scharfgeschaltet werden kann.
 *
 * Setzt die 2.8-MESS-FUNDAMENT-Spezifikation um (Formel-Ledger §6/§7, A9/A10/A12):
 *   §6  Voll-Kohorten je Board einfrieren (nicht Top-N) — Substrat outputs/hypergrowth/full/.
 *   §7  PIT-Freeze der Kontroll-Felder je Zeile: Markt-Beta, EV/Sales, Preis/Bruttogewinn
 *       + Umsatz-/GP-Quartalsserien MIT Perioden-Ende + fetchedAt.
 *   A9  Kontroll-Felder aus snapshots/<TICKER>.json joinen (Board-Rows tragen sie nicht);
 *       Beta-Coverage real ~60 % → fehlend explizit null + pitCoverage-Block (Attenuations-Ausweis).
 *   A10 revenueQEnds/grossProfitQEnds kommen parallel via pull-yahoo; fehlt es → null + pitGaps.
 *   A12 Kompaktierung frühestens t0+2Q (≈180 Kalendertage); PIT-Voll-Snapshots vorher nach
 *       board-history-archive/ (GG7c, außerhalb CI-Checkout). NICHTS wird ohne Archiv-Kopie entfernt.
 *
 * Wert-Plausibilitäts-Gate VOR dem Schreiben (Ledger 2.3 „Wert-Plausibilitäts-Gate"):
 *   Vergleich gegen Vortags-Vintage; P99-Tages-Delta der Scores. Kalibrierphase (calibrating:true,
 *   Gate loggt nur) läuft, bis MINDESTENS CALIBRATION_SAMPLES messbare Deltas vorliegen UND
 *   davon eines > 0 war (ein bewegungsloses Fenster kalibriert nichts → weiter sammeln).
 *   Danach Schwelle = größtes Kalibrier-Delta × 2, mindestens MIN_GATE_THRESHOLD (Boden nur
 *   gegen absurd kleine, aber echte Schwellen) (im _gate-calibration.json eingefroren + im
 *   Vintage-Meta persistiert). Bruch / NaN-Einbruch /
 *   Coverage-Absturz → Vintage MIT suspect:true geschrieben (nie still) + exit 2 (0.7-Kanal).
 *   KEINE Löschung je.
 *
 * picks-history/ wird NIE berührt (Schutzliste, GG). Strukturell erzwungen: assertNoPicksHistory()
 * prüft jeden Ausgabepfad; dieses Skript baut nie einen Pfad mit picks-history-Bezug.
 *
 * Usage:
 *   node scripts/write-board-history.js [--date YYYY-MM-DD] [--dry-run] [--compact]
 * Exit: 0 = ok · 1 = harter Fehler (Inputs fehlen) · 2 = suspect-Vintage geschrieben.
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const { boardStatus } = require('../src/scoring/board-status.js');

// ── benannte Konstanten (keine Magic Numbers; Herkunft dokumentiert) ─────────
const REPO_ROOT = path.resolve(__dirname, '..');

// Pfade werden aus einem Base gebildet, damit Tests hermetisch gegen ein Temp-Verzeichnis
// laufen können (L4 — keine Abhängigkeit von echten snapshots/outputs). Default = REPO_ROOT.
function resolvePaths(base) {
  return {
    FULL_DIR: path.join(base, 'outputs', 'hypergrowth', 'full'),
    CALIBRATION_FILE: path.join(base, 'outputs', 'calibration.json'),
    MACRO_REGIME_FILE: path.join(base, 'outputs', 'macro-regime.json'),
    SNAP_DIR: path.join(base, 'snapshots'),
    HISTORY_DIR: path.join(base, 'board-history'),          // GG7b: committet, Messgrundlage
    ARCHIVE_DIR: path.join(base, 'board-history-archive'),  // GG7c: gitignored, außerhalb CI-Checkout
    get EXCLUDED_FILE() { return path.join(this.HISTORY_DIR, '_excluded.json'); },
    get GATE_CALIB_FILE() { return path.join(this.HISTORY_DIR, '_gate-calibration.json'); },
    base,
  };
}
let P = resolvePaths(REPO_ROOT);
function _setPaths(base) { P = resolvePaths(base || REPO_ROOT); return P; }

// 2.3-Gate-Kalibrierung: erste 3 messbare Tages-Deltas = Kalibrierphase (Ledger:
// „erste 3 Live-Vintages"). Ein Vintage ist erst messbar, wenn es einen Vorgänger
// hat (Vintage #1 hat keinen) → die 3 Samples stammen aus den Vintages #2/#3/#4.
// MINDEST-Anzahl, kein Ausreichen-Kriterium: siehe updateGateCalibration (Bewegung nötig).
const CALIBRATION_SAMPLES = 3;
// Schwelle = P99-Tagesdelta × 2 (Ledger-Anhalt „P99-Tagesdelta × 2").
const THRESHOLD_MULTIPLIER = 2;
// Boden unter einer eingefrorenen Wert-Gate-Schwelle. Er ist NICHT die Antwort auf
// bewegungslose Kalibrierfenster (die frieren gar nicht erst ein, s. updateGateCalibration),
// sondern nur der Schutz gegen eine echte, aber absurd kleine Schwelle: Scores laufen auf
// einer 0–100-Skala, 1.0 = 1 % der Skala.
// An den echten Messwerten aus board-history/_gate-calibration.json (Stand 2026-07-17) geprüft:
// die kleinste je aus Bewegung eingefrorene Schwelle ist 1.0 (health-care, software-comm-services),
// die nächstkleineren sind 1.2 (utilities) und 1.4 (materials) → der Boden hebt kein einziges
// bestehendes Board an, er ist reine Untergrenze für künftige Fenster mit Mini-Bewegung.
// Keine Aussage über „Rausch-Höhe": die gemessenen Tages-Deltas streuen real von 0.1 bis 19.1
// (semiconductors) — Schwellen deutlich über dem Boden sind der Normalfall, nicht die Ausnahme.
const MIN_GATE_THRESHOLD = 1.0;
const P99 = 0.99;
// Coverage-Absturz: fällt der present-Anteil eines Kontroll-Felds gegenüber dem
// Vortag um mehr als das → suspect. Heuristik-Decke (kein Ledger-Wert); 0.25 = ein
// Viertel der Kohorte verliert ein Kontroll-Feld über Nacht = unplausibel.
// ponytail: fixe Decke; datengetrieben nachziehen, falls Coverage real ruckelt.
const COVERAGE_COLLAPSE_DROP = 0.25;
// A12: Kompaktierung frühestens nach t0+2Q ≈ 180 Kalendertage (NICHT 84 — §4b/§7-Kopplung).
const RETENTION_DAYS = 180;
const MS_PER_DAY = 86400000;
// F7: Der Regime-Fallback (jüngster Key <= Datum) darf nicht unbegrenzt zurückgreifen —
// ein Wochen-altes Regime als „heute" auszugeben wäre eine stille Lüge. SPY handelt
// ~5 Tage/Woche; die größte normale Lücke (Fr→Mo, plus Feiertag, oder ein Lauf vor
// US-Handelsschluss über ein langes Wochenende) ist ~3–4 Kalendertage. 7 deckt Wochenende
// + Feiertagscluster ab und schlägt erst an, wenn der Macro-Feed wirklich steht — dann ist
// 'unknown' die ehrliche Antwort, kein geerbtes Alt-Label. Kalendertage (kein Ledger-Wert).
const REGIME_MAX_STALE_DAYS = 7;

// ── kleine Helfer ────────────────────────────────────────────────────────────
function isoDay(d) { return new Date(d).toISOString().slice(0, 10); }

function assertNoPicksHistory(p) {
  // audit/fix: GG-Schutzliste — kein Ausgabepfad darf je picks-history berühren.
  if (/(^|[\\/])picks-history([\\/]|$)/i.test(p)) {
    throw new Error('write-board-history: refusing to touch picks-history path: ' + p);
  }
  return p;
}

function readJsonOrNull(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

// Boden auf eine Gate-Schwelle anwenden (nur echte, aus Bewegung abgeleitete Schwellen
// erreichen diese Funktion — s. updateGateCalibration).
function flooredThreshold(t) {
  return Number.isFinite(t) ? Math.max(t, MIN_GATE_THRESHOLD) : null;
}

// Die EINE Wahrheit darüber, ob ein Board eine gültige, eingefrorene Gate-Schwelle hat.
// Beide Wege gehen hier durch (Auswerten in evaluateGate, Weiter-Sammeln in
// updateGateCalibration), damit „eingefroren" nie zwei Bedeutungen bekommt.
//
// DEGENERIERT = frozen:true mit threshold <= 0 (live: energy und it-services, je 3× Delta 0).
// Eine 0-Schwelle stammt aus keinem einzigen echten Messwert — das Board hat sich im ganzen
// Kalibrierfenster nicht bewegt. Solche Boards gelten hier als NICHT eingefroren und sammeln
// weiter, bis echte Bewegung da war. Bewusst als Laufzeit-Heilung statt Datei-Migration:
// board-history/_gate-calibration.json ist eine Datendatei mit echten Messwerten, die
// dailyP99Samples bleiben unangetastet roh; threshold/frozen sind daraus ABGELEITETE Felder
// und werden beim nächsten Schreiben ohnehin neu berechnet (dann auch in der Datei geheilt).
function frozenThresholdOf(gateState) {
  if (!gateState || !gateState.frozen) return null;
  const t = gateState.threshold;
  return Number.isFinite(t) && t > 0 ? flooredThreshold(t) : null;
}

// P-Quantil einer Zahlenliste (nearest-rank, konservativ aufgerundet).
function quantile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const idx = Math.min(v.length - 1, Math.ceil(p * v.length) - 1);
  return v[Math.max(0, idx)];
}

// ── §7 PIT-Extraktion aus einem Snapshot (A9-Join) ───────────────────────────
function readSnapshot(ticker) {
  const fp = path.join(P.SNAP_DIR, safeSnapshotFilename(ticker));
  return readJsonOrNull(fp);
}

// Preis/Bruttogewinn = MarketCap/GrossProfit = priceSales / grossMargin.
// (grossMargin ist in %.) Nenner ≤0/undefiniert → null (LOSS-/GM0-Firmen, §4a-NaN-Linie).
function priceGrossProfit(metrics) {
  const ps = metrics && metrics.priceSales && metrics.priceSales.value;
  const gm = metrics && metrics.grossMargin && metrics.grossMargin.value;
  if (!Number.isFinite(ps) || !Number.isFinite(gm) || gm <= 0) return null;
  return ps / (gm / 100);
}

function seriesValues(arr) {
  if (!Array.isArray(arr)) return null;
  // revenueQ/grossProfitQ sind [{value}] (pull-yahoo-Serialisierung).
  return arr.map((x) => (x && typeof x === 'object' && 'value' in x ? x.value : x));
}

// Baut den §7-PIT-Block je Board-Zeile. Fehlende Kontroll-Felder EXPLIZIT null
// (Missing-Beta-Regel), fehlende Perioden-Enden → null + pitGaps-Vermerk.
function buildPit(snap, pitGaps) {
  if (!snap) { pitGaps.add('snapshot-missing'); return null; }
  const m = snap.metrics || {};
  const ts = snap.timeseries || {};
  const meta = snap.meta || {};
  const val = (o) => (o && Number.isFinite(o.value) ? o.value : null);
  const revEnds = ts.revenueQEnds != null ? ts.revenueQEnds : null;
  const gpEnds = ts.grossProfitQEnds != null ? ts.grossProfitQEnds : null;
  if (revEnds == null) pitGaps.add('revenueQEnds-missing');   // A10: parallel in pull-yahoo
  if (gpEnds == null) pitGaps.add('grossProfitQEnds-missing');
  return {
    beta: val(m.beta),                       // Markt-Beta (Kontroll-Feld §7)
    evSales: val(m.enterpriseToRevenue),     // EV/Sales (§7)
    priceGrossProfit: priceGrossProfit(m),   // Preis/Bruttogewinn (§7)
    fetchedAt: meta.fetchedAt || meta.asOf || null,
    revenueQ: seriesValues(ts.revenueQ),
    revenueQEnds: revEnds,
    grossProfitQ: seriesValues(ts.grossProfitQ),
    grossProfitQEnds: gpEnds,
  };
}

// pitCoverage: Anteil present je Kontroll-Feld über die Kohorte (A9-Attenuations-Ausweis).
function pitCoverageBlock(rows) {
  const fields = ['beta', 'evSales', 'priceGrossProfit', 'revenueQEnds', 'grossProfitQEnds'];
  const cov = {};
  const n = rows.length || 1;
  for (const f of fields) {
    let present = 0;
    for (const r of rows) if (r.pit && r.pit[f] != null) present++;
    cov[f] = present / n;
  }
  return cov;
}

// ── Vintage-Aufbau für EIN Board ─────────────────────────────────────────────
function buildBoardVintage(board, boardData, date, calibMeta) {
  const pitGaps = new Set();
  const buildTrack = (arr, track) => (Array.isArray(arr) ? arr : []).map((row, i) => ({
    rank: i + 1,                    // Board-Rang (Zeilenreihenfolge = sortierte Kohorte)
    ticker: row.ticker,
    track,
    score: row.score != null ? row.score : null, // survival-Zeilen sind nie gescort → null statt key-drop
    runwayQuarters: row.runwayQuarters != null ? row.runwayQuarters : null, // survival-Sortier-Substanz
    scoreBase: row.scoreBase != null ? row.scoreBase : null,
    scoreShrunk: row.scoreShrunk != null ? row.scoreShrunk : null,
    coverageAxes: row.coverageAxes != null ? row.coverageAxes : null,
    axisBreakdown: Array.isArray(row.axisBreakdown) ? row.axisBreakdown : null,
    lamps: Array.isArray(row.lamps) ? row.lamps : null,
    pit: buildPit(readSnapshot(row.ticker), pitGaps),  // §7-PIT-Freeze (A9-Join)
  }));
  // audit/fix: survival.json ist eine FLACHE Liste (nie gescort, keine Tracks) — als
  // Single-Track 'flat' einfrieren statt still leere profitable/unprofitable zu schreiben.
  const isFlat = Array.isArray(boardData);
  const profitable = isFlat ? buildTrack(boardData, 'flat') : buildTrack(boardData.profitable, 'profitable');
  const unprofitable = isFlat ? [] : buildTrack(boardData.unprofitable, 'unprofitable');
  const allRows = profitable.concat(unprofitable);
  return {
    date,
    board,
    boardStatus: boardStatus(board),           // core|diagnostic (src/scoring/board-status.js)
    formulaVersion: calibMeta.formulaVersion,  // Proxy: calibration.schema (siehe Kopf-Doku)
    calibrationGeneratedAt: calibMeta.generatedAt,
    cohortCount: { profitable: profitable.length, unprofitable: unprofitable.length },
    pitCoverage: pitCoverageBlock(allRows),
    pitGaps: Array.from(pitGaps).sort(),
    // gate wird nach der Gate-Auswertung befüllt (calibrating/threshold/suspect/...)
    gate: null,
    cohort: { profitable, unprofitable },
  };
}

// ── Wert-Plausibilitäts-Gate ─────────────────────────────────────────────────
// Vergleicht das neue Board-Vintage gegen das Vortags-Vintage. Liefert
// { calibrating, p99Delta, threshold, suspect, reasons }.
function evaluateGate(vintage, priorVintage, gateState) {
  const reasons = [];
  const rowsByTicker = (v) => {
    const m = new Map();
    if (!v) return m;
    for (const t of ['profitable', 'unprofitable']) {
      for (const r of (v.cohort && v.cohort[t]) || []) m.set(r.ticker, r);
    }
    return m;
  };
  const nowMap = rowsByTicker(vintage);

  // Harter Integritäts-Check: NaN/null-Score wo vorher ein Wert stand (immer suspect,
  // auch in der Kalibrierphase — kein Threshold-Thema, sondern Datenbruch).
  const priorMap = rowsByTicker(priorVintage);
  let nanBreak = false;
  for (const [tk, r] of nowMap) {
    const p = priorMap.get(tk);
    if (p && Number.isFinite(p.score) && !Number.isFinite(r.score)) { nanBreak = true; break; }
  }
  if (nanBreak) reasons.push('nan-break');

  // Coverage-Absturz gegen Vortag (immer suspect).
  if (priorVintage && priorVintage.pitCoverage) {
    for (const f of Object.keys(vintage.pitCoverage)) {
      const drop = (priorVintage.pitCoverage[f] || 0) - vintage.pitCoverage[f];
      if (drop > COVERAGE_COLLAPSE_DROP) { reasons.push('coverage-collapse:' + f); }
    }
  }

  // Tages-Delta der Scores (nur wo Ticker in beiden Vintages vorhanden).
  const deltas = [];
  for (const [tk, r] of nowMap) {
    const p = priorMap.get(tk);
    if (p && Number.isFinite(p.score) && Number.isFinite(r.score)) deltas.push(Math.abs(r.score - p.score));
  }
  const p99Delta = deltas.length ? quantile(deltas, P99) : null;

  // Keine gültige eingefrorene Schwelle (nie kalibriert ODER degeneriert) → Kalibrierphase:
  // das Gate LOGGT (p99Delta steht im Vintage-Meta), straft aber nicht.
  const threshold = frozenThresholdOf(gateState);
  const calibrating = threshold == null;
  // Threshold-Bruch nur NACH der Kalibrierphase (Ledger: „Gate loggt nur" solange calibrating).
  if (!calibrating && p99Delta != null && p99Delta > threshold) {
    reasons.push('p99-delta-exceeds-threshold');
  }

  return { calibrating, p99Delta, threshold, suspect: reasons.length > 0, reasons };
}

// Aktualisiert den Gate-Kalibrierungs-Zustand je Board: sammelt messbare P99-Tagesdeltas
// und friert die Schwelle ein, sobald das Fenster AUSSAGEKRÄFTIG ist.
// Aussagekräftig = genug Samples DA (>= CALIBRATION_SAMPLES) UND mindestens eines > 0.
// Die zweite Bedingung ist der Kern: aus 3× Delta 0 lässt sich keine Schwelle ableiten —
// „das Board hat sich nie bewegt" heißt „noch nicht gemessen", nicht „Schwelle 0".
// Ein solches Fenster sammelt weiter (Gate bleibt im Log-Modus), bis echte Bewegung da war.
function updateGateCalibration(gateCalib, board, p99Delta, date) {
  const b = gateCalib.boards[board] || (gateCalib.boards[board] = { dailyP99Samples: [], sampleDates: [], threshold: null, frozen: false });
  if (frozenThresholdOf(b) != null) return b;   // echt eingefroren → Messreihe ist abgeschlossen
  if (p99Delta != null) {
    // F8: je Vintage-Datum genau EIN Sample. dailyP99Samples[i] gehört zu sampleDates[i]
    // (Map Datum→Sample als zwei index-gleiche Arrays — hält dailyP99Samples ein reines
    // number[], sodass Schwellen-Mathematik, .length und alle Leser unverändert bleiben).
    if (!Array.isArray(b.sampleDates)) b.sampleDates = [];
    // Migration bestehender Roh-Arrays (Live-Stand: energy/it-services tragen [0,0,0] OHNE
    // sampleDates): die N Alt-Samples stammen aus N distinkten VERGANGENEN Tagen, deren
    // Datum die Datei nie festhielt. Distinkte Platzhalter-Keys bewahren die Zählung, ohne
    // einen Kalendertag zu erfinden (kollidieren nie mit einem echten ISO-Datum). Roh-Werte
    // bleiben unangetastet — nichts wird umgeschrieben, nur die fehlenden Datums-Marker ergänzt.
    while (b.sampleDates.length < b.dailyP99Samples.length) b.sampleDates.push('legacy#' + b.sampleDates.length);
    const idx = date != null ? b.sampleDates.indexOf(date) : -1;
    if (idx >= 0) b.dailyP99Samples[idx] = p99Delta;   // Rerun DESSELBEN Vintage-Tags → ersetzen, nicht anhängen
    else { b.dailyP99Samples.push(p99Delta); b.sampleDates.push(date != null ? date : ('nodate#' + b.sampleDates.length)); }
  }
  // Repräsentatives P99-Tagesdelta = das größte der Kalibrier-Samples (konservativ), × 2.
  const peak = Math.max(0, ...b.dailyP99Samples);
  const ready = b.dailyP99Samples.length >= CALIBRATION_SAMPLES && peak > 0;
  b.threshold = ready ? flooredThreshold(peak * THRESHOLD_MULTIPLIER) : null;
  b.frozen = ready;
  return b;
}

// ── Exclusion-Gerüst (Writer schreibt nie Einträge, legt nur das Gerüst an) ───
function readOrScaffoldExcluded(dryRun) {
  const existing = readJsonOrNull(P.EXCLUDED_FILE);
  if (existing) return existing;
  const scaffold = {
    _doc: 'Vintage-Ausschlussliste. Von Hand/Audit gepflegt (Datum + Grund). ' +
      'scripts/rank-ic.js KONSUMIERT diese Liste und schließt gelistete Vintages aus der Auswertung aus. ' +
      'write-board-history.js schreibt hier NIE Einträge (legt nur dieses Gerüst an). Keine Löschung, nur ein Flag.',
    excluded: [],  // z. B. [{ "date": "2026-08-01", "board": "semiconductors", "reason": "..." }]
  };
  if (!dryRun) { fs.mkdirSync(P.HISTORY_DIR, { recursive: true }); writeJsonAtomic(assertNoPicksHistory(P.EXCLUDED_FILE), scaffold); }
  return scaffold;
}

// ── Vorheriges Vintage-Datum finden (jüngstes Datum < target) ────────────────
function priorVintageDate(date) {
  if (!fs.existsSync(P.HISTORY_DIR)) return null;
  const dates = fs.readdirSync(P.HISTORY_DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < date)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

// ── Retention/Kompaktierung (A12) ────────────────────────────────────────────
// Vintages älter als RETENTION_DAYS: PIT-Voll-Snapshot nach board-history-archive/
// kopieren (GG7c), dann im Vintage die per-Zeile-pit-Blöcke strippen (Kern bleibt:
// rank/score/scoreBase/scoreShrunk/flags/axisBreakdown). NICHTS ohne Archiv-Kopie.
function compact(date, dryRun) {
  if (!fs.existsSync(P.HISTORY_DIR)) return { compacted: [] };
  const cutoff = new Date(date + 'T00:00:00Z').getTime() - RETENTION_DAYS * MS_PER_DAY;
  const compacted = [];
  for (const d of fs.readdirSync(P.HISTORY_DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (new Date(d + 'T00:00:00Z').getTime() > cutoff) continue;  // jünger als t0+2Q → unberührt
    const dir = path.join(P.HISTORY_DIR, d);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('_')) continue;
      const fp = path.join(dir, f);
      const v = readJsonOrNull(fp);
      // F9: nur echte Board-Vintages kompaktieren. Sidecars (calibration.json/regime.json —
      // ohne '_'-Präfix und ohne cohort) bekämen sonst vom Lean-Write ein leeres cohort
      // injiziert; rank-ic.js:boardsOf erkennt Boards genau über !!(v && v.cohort) und
      // zählte sie danach als Phantom-Boards. Gleiche inhaltsbasierte Prüfung wie dort.
      if (!v || v.compacted || !v.cohort) continue;
      const archivePath = assertNoPicksHistory(path.join(P.ARCHIVE_DIR, d, f));
      if (!dryRun) {
        fs.mkdirSync(path.dirname(archivePath), { recursive: true });
        writeJsonAtomic(archivePath, v);           // 1) Archiv-Kopie ZUERST (Voll-Snapshot)
      }
      // 2) Kern-Version schreiben (pit gestrippt, Rest bleibt)
      const strip = (rows) => (rows || []).map((r) => { const { pit, ...core } = r; return core; });
      const lean = {
        ...v,
        compacted: true,
        compactedAt: isoDay(Date.now()),
        archivedTo: path.relative(REPO_ROOT, archivePath),
        cohort: { profitable: strip(v.cohort && v.cohort.profitable), unprofitable: strip(v.cohort && v.cohort.unprofitable) },
      };
      if (!dryRun) writeJsonAtomic(assertNoPicksHistory(fp), lean);
      compacted.push(path.relative(REPO_ROOT, fp));
    }
  }
  return { compacted };
}

// ── Regime-Ausweis (nur Ausweis, §5) ─────────────────────────────────────────
// macro.regimes ist nach SPY-Handelsdatum gekeyt (macro-regime.js). Ein exakter
// Key-Lookup verfehlt jeden Lauf, dessen Vintage-Datum (heute UTC) noch keinen
// SPY-Schluss trägt — Wochenenden, Feiertage, Läufe vor US-Handelsschluss (F7):
// er lieferte dann fälschlich 'unknown' statt des letzten gültigen Regimes. Fix:
// den jüngsten Key <= Ziel-Datum erben. Der Staleness-Wächter (REGIME_MAX_STALE_DAYS)
// verhindert, dass ein Wochen-altes Regime still als „heute" durchgeht; asOf weist
// immer aus, WELCHER Handelstag tatsächlich gilt.
function regimeForDate(date) {
  const macro = readJsonOrNull(P.MACRO_REGIME_FILE);
  const regimes = macro && macro.regimes;
  if (!regimes) return { date, label: 'unknown', source: 'macro-regime.json(absent)' };
  let keyDate = regimes[date] ? date : null;
  if (!keyDate) {
    const priorKeys = Object.keys(regimes).filter((k) => k < date).sort();
    keyDate = priorKeys.length ? priorKeys[priorKeys.length - 1] : null;
  }
  // §5: kein Key <= Datum (Macro beginnt erst später) → 'unknown', kein Datenfehler.
  if (!keyDate) return { date, label: 'unknown', source: 'macro-regime.json(date-missing)' };
  const ageDays = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(keyDate + 'T00:00:00Z')) / MS_PER_DAY);
  if (ageDays > REGIME_MAX_STALE_DAYS) {
    // Zu alt → ehrlich 'unknown' MIT Grund + Alter; kein geerbtes Alt-Label (keine stille Lüge).
    return { date, label: 'unknown', source: 'macro-regime.json(stale>' + REGIME_MAX_STALE_DAYS + 'd)', asOf: keyDate, staleDays: ageDays };
  }
  const entry = regimes[keyDate];
  return { date, label: entry.regime, price: entry.price, sma200: entry.sma200, source: 'macro-regime.json', asOf: keyDate };
}

// ── Hauptlauf ────────────────────────────────────────────────────────────────
function run(opts) {
  opts = opts || {};
  if (opts.baseDir) _setPaths(opts.baseDir);   // Test-Hermetik (L4); Default bleibt REPO_ROOT
  const date = opts.date || isoDay(Date.now());
  const dryRun = !!opts.dryRun;

  if (opts.compact) {
    const res = compact(date, dryRun);
    return { mode: 'compact', date, dryRun, ...res, exitCode: 0 };
  }

  if (!fs.existsSync(P.FULL_DIR)) throw new Error('missing full-cohort dir: ' + P.FULL_DIR);
  const calib = readJsonOrNull(P.CALIBRATION_FILE);
  const calibMeta = {
    formulaVersion: (calib && calib.schema) || null,     // Proxy für Formel-Lineage (§7)
    generatedAt: (calib && calib.generated_at) || null,
  };
  const boards = fs.readdirSync(P.FULL_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  if (boards.length === 0) throw new Error('no full-cohort board files in ' + P.FULL_DIR);

  readOrScaffoldExcluded(dryRun);
  const gateCalib = readJsonOrNull(P.GATE_CALIB_FILE) || { _doc: 'Gate-Kalibrierung je Board: erste 3 messbare P99-Tagesdeltas → Schwelle P99×2 eingefroren.', boards: {} };
  const priorDate = priorVintageDate(date);
  const dateDir = path.join(P.HISTORY_DIR, date);

  const results = [];
  let anySuspect = false;
  for (const board of boards) {
    const boardData = readJsonOrNull(path.join(P.FULL_DIR, board + '.json'));
    if (!boardData) { results.push({ board, error: 'unreadable' }); continue; }
    const vintage = buildBoardVintage(board, boardData, date, calibMeta);
    const priorVintage = priorDate ? readJsonOrNull(path.join(P.HISTORY_DIR, priorDate, board + '.json')) : null;
    const gate = evaluateGate(vintage, priorVintage, gateCalib.boards[board]);
    // Kalibrier-Sample nachziehen (frozen erst NACH Auswertung, damit die aktuelle
    // Auswertung noch in der Kalibrierphase mit calibrating:true läuft).
    const gs = updateGateCalibration(gateCalib, board, gate.p99Delta, date);
    vintage.gate = {
      calibrating: gate.calibrating,
      p99Delta: gate.p99Delta,
      threshold: gate.threshold,
      suspect: gate.suspect,
      reasons: gate.reasons,
      priorDate: priorDate,
      calibrationSamples: gs.dailyP99Samples.length,
    };
    if (gate.suspect) anySuspect = true;
    if (!dryRun) {
      fs.mkdirSync(dateDir, { recursive: true });
      writeJsonAtomic(assertNoPicksHistory(path.join(dateDir, board + '.json')), vintage);
    }
    results.push({ board, suspect: gate.suspect, calibrating: gate.calibrating, p99Delta: gate.p99Delta, threshold: gate.threshold, rows: vintage.cohort.profitable.length + vintage.cohort.unprofitable.length, pitCoverage: vintage.pitCoverage });
  }

  // Seiten-Artefakte je Datum: calibration.json-Kopie + regime.json.
  if (!dryRun) {
    fs.mkdirSync(dateDir, { recursive: true });
    if (calib) writeJsonAtomic(assertNoPicksHistory(path.join(dateDir, 'calibration.json')), calib);
    writeJsonAtomic(assertNoPicksHistory(path.join(dateDir, 'regime.json')), regimeForDate(date));
    writeJsonAtomic(assertNoPicksHistory(P.GATE_CALIB_FILE), gateCalib);
  }

  return { mode: 'write', date, dryRun, priorDate, boards: results, regime: regimeForDate(date), exitCode: anySuspect ? 2 : 0 };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { dryRun: false, compact: false, date: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--compact') o.compact = true;
    else if (a === '--date') o.date = argv[++i];
    else if (a.startsWith('--date=')) o.date = a.slice(7);
  }
  return o;
}

if (require.main === module) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const res = run(opts);
    const tag = res.dryRun ? '[dry-run] ' : '';
    if (res.mode === 'compact') {
      console.log(tag + 'compact ' + res.date + ': ' + res.compacted.length + ' Vintages kompaktiert');
      res.compacted.forEach((f) => console.log('  archiviert+gestrippt: ' + f));
    } else {
      console.log(tag + 'board-history ' + res.date + ' (prior=' + res.priorDate + ', regime=' + res.regime.label + ')');
      for (const b of res.boards) {
        if (b.error) { console.log('  ' + b.board + ': ' + b.error); continue; }
        const flag = b.suspect ? ' SUSPECT[' + '⚠' + ']' : (b.calibrating ? ' (calibrating)' : '');
        console.log('  ' + b.board + ': ' + b.rows + ' Zeilen, p99Δ=' + (b.p99Delta == null ? '—' : b.p99Delta.toFixed(2)) +
          ', thr=' + (b.threshold == null ? '—' : b.threshold.toFixed(2)) +
          ', beta-cov=' + (b.pitCoverage.beta * 100).toFixed(0) + '%' + flag);
      }
      if (res.exitCode === 2) console.log('EXIT 2: mindestens ein suspect-Vintage geschrieben (0.7-Kanal).');
    }
    process.exit(res.exitCode);
  } catch (e) {
    console.error('write-board-history FEHLER: ' + (e && e.stack || e));
    process.exit(1);
  }
}

module.exports = {
  run, parseArgs, buildBoardVintage, evaluateGate, updateGateCalibration,
  compact, readOrScaffoldExcluded, regimeForDate, priceGrossProfit, pitCoverageBlock,
  quantile, assertNoPicksHistory, buildPit,
  _setPaths, resolvePaths,
  flooredThreshold, frozenThresholdOf,
  _const: { CALIBRATION_SAMPLES, THRESHOLD_MULTIPLIER, MIN_GATE_THRESHOLD, COVERAGE_COLLAPSE_DROP, RETENTION_DAYS },
};
