'use strict';
/**
 * lib/e2-earnings-blowout.js — 6.2-E-Ast, Event E2 "Earnings-Blowout, sektor-relativiert".
 * Spezifikation: Masterplan 6.2 + _BACKTEST-KATALOG-frueher-finden-2026-07-16 Stufe 1:
 * "Report deutlich ueber eigenem 4Q-Trend, sektor-relativiert" — das oeffentliche Signal,
 * das beim CRDO-Q3-Report drei Wochen lang ignoriert wurde.
 *
 * WAS: Reiner Lese-/Anzeige-Layer, GENAU wie E1. Feuert, wenn eine Board-Aktie gerade
 * gemeldet hat UND der gemeldete Umsatzsprung deutlich ueber ihrem eigenen 4-Quartals-Trend
 * liegt UND dieser Sprung im Spitzendezil ihrer Sektor-Kohorte steht. KEIN Score-Einfluss,
 * KEINE Formel: src/scoring/ wird weder gelesen noch angefasst (GQS-00 / F-16).
 *
 * EHRLICHKEITS-KERN (wie E1s EV/Sales-Caveat — dieselbe Klasse Selbsttaeuschung):
 *  (a) Die Kennzahl ist eine TREND-ABWEICHUNG, keine Analysten-Ueberraschung. Historische
 *      Analystenschaetzungen liegen im Repo nicht vor (Katalog B2 haelt das ausdruecklich
 *      fest). Der Meldesatz sagt darum IMMER "ueber eigenem 4Q-Trend" und NIE "Ueberraschung".
 *  (b) QoQ ist NICHT saisonbereinigt. Gegenmittel ist die Kohorte: verglichen wird nur gegen
 *      Peers DESSELBEN Sektors, DESSELBEN Tracks und DESSELBEN Quartalsendes — die stehen in
 *      derselben Saison. Rest-Saisonalitaet (Branchenmix innerhalb eines Boards) bleibt und
 *      steht als offener Punkt im Report.
 *  (c) Der Report-Zeitpunkt kommt aus dem Earnings-Kalender, das Zahlenbild aus pit.revenueQ.
 *      Beide muessen ZUSAMMENPASSEN, sonst misst man ein altes Quartal unter einem frischen
 *      Report-Datum — an den echten Daten vom 2026-08-19 betraf das 954 Zeilen (Report-Lag
 *      125-133 Tage = das gemeldete Quartal steht noch gar nicht im Abzug). Der Lag-Gate
 *      faengt das ab: Datenluecke statt Alarm.
 *
 * SPERRZONEN-GRENZE (wie E1): geladen werden nur fs, path und zwei lib-Helfer. Keine Zeile
 * aus src/scoring/. E2 ist ein Meldeweg, keine Formel.
 *
 * Datenquellen (alle bereits vorhanden, KEIN neuer Abruf):
 *   board-history/<datum>/<board>.json  -> pit.revenueQ + pit.revenueQEnds (datierte Quartale)
 *   pit.earningsDate/earningsDateAsOf   -> PIT-eingefrorenes Report-Datum, additiv von
 *                                          scripts/write-board-history.js (analog E1 Option B)
 *   earnings-calendar.json              -> Rueckfall, solange die Vintages das PIT-Feld noch
 *                                          nicht tragen. Der Rueckfall ist im Report als
 *                                          earningsDateSource sichtbar, nie still.
 *
 * Aufruf durch die taegliche Kette (screener-briefing), NACH write-board-history:
 *   node lib/e2-earnings-blowout.js [--date YYYY-MM-DD]
 * NUR dieser CLI-Einstieg setzt annotate:true. Als Bibliothek (runE2({...})) bleibt der Lauf
 * stumm — die Wahrheit steht in measurable/exitCode/invalidBoards.
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./atomic-write.js');
const { readJsonExistingOrThrow, FEHLT } = require('./read-json.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const MS_PER_DAY = 86400000;

// ── Kalibrierbare Schwellen ──────────────────────────────────────────────────
// Alle an den ECHTEN Daten vom 2026-08-19 gemessen (3 052 auswertbare Zeilen ueber 15
// Boards), nicht erfunden; alle per cfg-Override testbar; alle im Report unter
// calibratables ausgewiesen und nach 4-6 Wochen board-history nachzukalibrieren.
const E2_CONST = {
  // Sektor-relativ: Spitzendezil der Kohorte (board x track x Quartalsende). Ein Quartil
  // waere zu weit — p90 trifft zusammen mit dem Boden unten die Groessenordnung, die je
  // Tag auf eine Handvoll Namen fuehrt.
  QUANTILE_P: 0.90,
  // Absoluter Boden in Prozentpunkten (0.25 = 25 pp ueber eigenem 4Q-Trend). Ohne ihn feuert
  // in JEDEM Sektor das oberste Dezil — auch wenn dort alle schrumpfen ("Bester unter lauter
  // Schrumpfern"). 0.25 ist das gemessene p90 der marktweiten Surprise-Verteilung vom
  // 2026-08-19 (p50 -0.010 · p75 0.094 · p90 0.260 · p95 0.469).
  MIN_SURPRISE: 0.25,
  // Mindest-Kohorte vor der Perzentil-Berechnung (identisch zu E1: ein Dezil aus <20
  // rankbaren Namen ist keine Aussage). Am 2026-08-19: 32 von 89 Kohorten erreichen das.
  MIN_COHORT_N: 20,
  // EVENT-Fenster: nur ein FRISCHER Report ist ein Ereignis. 21 Tage = das Katalog-Motiv
  // ("beim CRDO-Q3-Report drei Wochen ignoriert") — genau die Spanne, in der Karl den Namen
  // ueberhaupt noch aufgreifen kann.
  REPORT_MAX_AGE_DAYS: 21,
  // Zuordnungs-Gate (Ehrlichkeits-Kern c): Report-Datum minus juengstes Quartalsende. Ein
  // echter Quartalsbericht kommt 1-90 Tage nach Periodenende; 125+ Tage heisst, dass das
  // gemeldete Quartal noch nicht im Abzug steht -> Datenluecke, NICHT Alarm.
  REPORT_LAG_MIN_DAYS: 1,
  REPORT_LAG_MAX_DAYS: 90,
  // Kontiguitaets-Fenster: nur echte Folge-Quartale duerfen QoQ verglichen werden.
  // Halbjahres-Melder und Luecken (z. B. 688256.SS: 03-31, 12-31, 06-30 …) fallen raus.
  QUARTER_MIN_GAP_DAYS: 80,
  QUARTER_MAX_GAP_DAYS: 100,
  // Plausibilitaets-Deckel: +300 % Umsatz zum Vorquartal ist praktisch immer Zukauf,
  // Restatement oder FX-Artefakt, kein operativer Blowout. Wird GEZAEHLT und geloggt,
  // nicht still verworfen.
  MAX_QOQ: 3.0,
  // Alert-Cap je Tag (Alert-Oekonomie des Katalogs: 3-5/Woche ueber ALLE Typen; die
  // Wochen-Deckelung ist Sache der Briefing-Kette, hier steht der Tages-Deckel).
  ALERT_CAP: 5,
};

// ── kleine Helfer (bewusst identisch zu lib/e1-compression.js) ───────────────
function isoDay(d) { return new Date(d).toISOString().slice(0, 10); }
function round2(x) { return Math.round(x * 100) / 100; }
function pct0(x) { return Math.round(x * 100); }

function daysBetween(aIso, bIso) {
  const a = Date.parse(aIso), b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

// Perzentil (nearest-rank, konservativ) — identisch zu E1/write-board-history.
function quantile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const idx = Math.min(v.length - 1, Math.ceil(p * v.length) - 1);
  return v[Math.max(0, idx)];
}

function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const n = v.length;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

/**
 * Kern-Kennzahl. Aus 5 datierten Quartalen (neuestes zuerst) entstehen 4 QoQ-Raten; die
 * Abweichung der juengsten vom MEDIAN der drei davor ist der "Blowout". Median statt
 * Mittelwert: ein einzelnes Ausreisser-Quartal im Trend darf die Messlatte nicht
 * verschieben (CRDO-Signatur 26 -> 31 -> 20 -> 52 % QoQ: Trend 26, Sprung +26 pp).
 * Rueckgabe null, wenn die Reihe die Datengates nicht besteht — nie geraten.
 */
function surpriseVsOwnTrend(revenueQ, revenueQEnds, cfg) {
  if (!Array.isArray(revenueQ) || !Array.isArray(revenueQEnds)) return null;
  const rev = revenueQ.slice(0, 5), ends = revenueQEnds.slice(0, 5);
  if (rev.length < 5 || ends.length < 5) return null;
  if (!rev.every((x) => Number.isFinite(x) && x > 0)) return null;   // Nullen/Negative -> keine QoQ-Rate
  if (!ends.every((e) => typeof e === 'string')) return null;
  const ms = ends.map((e) => Date.parse(e + 'T00:00:00Z'));
  if (!ms.every((t) => Number.isFinite(t))) return null;
  for (let i = 0; i < 4; i++) {
    const gap = (ms[i] - ms[i + 1]) / MS_PER_DAY;                     // absteigend sortiert erwartet
    if (!(gap >= cfg.quarterMinGapDays && gap <= cfg.quarterMaxGapDays)) return null;
  }
  const qoq = [];
  for (let i = 0; i < 4; i++) qoq.push(rev[i] / rev[i + 1] - 1);
  const trend = median(qoq.slice(1));
  return { qoqLatest: qoq[0], trendQoq: trend, surprise: qoq[0] - trend, quarterEnd: ends[0] };
}

function pickAxisPct(axisBreakdown, key) {
  if (!Array.isArray(axisBreakdown)) return null;
  const e = axisBreakdown.find((a) => a && a.key === key);
  return e && Number.isFinite(e.pct) ? e.pct : null;
}

function withDefaults(cfg) {
  cfg = cfg || {};
  const pick = (k, d) => (cfg[k] != null ? cfg[k] : d);
  return {
    quantileP: pick('quantileP', E2_CONST.QUANTILE_P),
    minSurprise: pick('minSurprise', E2_CONST.MIN_SURPRISE),
    minCohortN: pick('minCohortN', E2_CONST.MIN_COHORT_N),
    reportMaxAgeDays: pick('reportMaxAgeDays', E2_CONST.REPORT_MAX_AGE_DAYS),
    reportLagMinDays: pick('reportLagMinDays', E2_CONST.REPORT_LAG_MIN_DAYS),
    reportLagMaxDays: pick('reportLagMaxDays', E2_CONST.REPORT_LAG_MAX_DAYS),
    quarterMinGapDays: pick('quarterMinGapDays', E2_CONST.QUARTER_MIN_GAP_DAYS),
    quarterMaxGapDays: pick('quarterMaxGapDays', E2_CONST.QUARTER_MAX_GAP_DAYS),
    maxQoq: pick('maxQoq', E2_CONST.MAX_QOQ),
    alertCap: pick('alertCap', E2_CONST.ALERT_CAP),
  };
}

// ── Trigger-Kern (pure, keine I/O) ───────────────────────────────────────────
// Wertet EINEN Track eines Board-Vintages aus. Reihenfolge:
//   1) Datengates je Zeile (pit da? 5 kontinuierliche, positive Quartale?) -> Pool
//   2) Pool nach Quartalsende gruppieren — nur Peers DESSELBEN Quartals sind vergleichbar
//   3) je Gruppe: Mindest-N -> Dezil-Schwelle -> Kandidat = Schwelle UND Boden gerissen
//   4) Ereignis-Gates je Kandidat (Report frisch? Report gehoert zum Quartal?)
// Die Ereignis-Gates kommen ZULETZT: wer gerade gemeldet hat, darf die Vergleichsverteilung
// der Peers nicht veraendern.
function evaluateTrack(board, track, rows, now, cfg, earningsOf) {
  const skipped = { noPit: 0, badSeries: 0, implausible: 0 };
  const dataGaps = [];
  const pool = [];
  for (const r of rows) {
    if (!r || !r.pit) { skipped.noPit++; continue; }
    const s = surpriseVsOwnTrend(r.pit.revenueQ, r.pit.revenueQEnds, cfg);
    if (!s) { skipped.badSeries++; continue; }
    // Plausibilitaets-Deckel: sichtbar gezaehlt, nicht still verworfen (fail loud).
    if (s.qoqLatest > cfg.maxQoq) {
      skipped.implausible++;
      dataGaps.push({ ticker: r.ticker, reason: 'implausible-qoq', qoqLatest: round2(s.qoqLatest) });
      continue;
    }
    pool.push({
      ticker: r.ticker, board, track, rank: r.rank != null ? r.rank : null,
      qoqLatest: s.qoqLatest, trendQoq: s.trendQoq, surprise: s.surprise, quarterEnd: s.quarterEnd,
      revGrowthLevelPct: pickAxisPct(r.axisBreakdown, 'revGrowthLevel'),
    });
  }
  // Kohorten = board x track x Quartalsende (Ehrlichkeits-Kern b: Saison-Abgleich).
  const byQuarter = {};
  for (const p of pool) (byQuarter[p.quarterEnd] = byQuarter[p.quarterEnd] || []).push(p);

  const groups = [];
  const triggered = [];
  for (const quarterEnd of Object.keys(byQuarter).sort().reverse()) {
    const c = byQuarter[quarterEnd];
    if (c.length < cfg.minCohortN) { groups.push({ quarterEnd, cohortN: c.length, threshold: null, lowN: true }); continue; }
    const threshold = quantile(c.map((x) => x.surprise), cfg.quantileP);
    groups.push({ quarterEnd, cohortN: c.length, threshold: round2(threshold), lowN: false });
    for (const p of c) {
      if (p.surprise < threshold) continue;          // nicht im Sektor-Spitzendezil
      if (p.surprise < cfg.minSurprise) continue;    // Bester unter lauter Schrumpfern
      // Ereignis-Gates. earningsOf liefert {date, asOf, source} oder null.
      const e = earningsOf(p.ticker);
      if (!e || !e.date) { dataGaps.push({ ticker: p.ticker, reason: 'no-earnings-date' }); continue; }
      const reportAgeDays = daysBetween(e.date, now);
      if (reportAgeDays == null) { dataGaps.push({ ticker: p.ticker, reason: 'bad-earnings-date', earningsDate: e.date }); continue; }
      // Kein frisches Ereignis: der Normalfall fuer die grosse Mehrheit, keine Datenluecke.
      if (reportAgeDays < 0 || reportAgeDays > cfg.reportMaxAgeDays) continue;
      const reportLagDays = daysBetween(quarterEnd, e.date);
      if (reportLagDays == null || reportLagDays < cfg.reportLagMinDays || reportLagDays > cfg.reportLagMaxDays) {
        dataGaps.push({ ticker: p.ticker, reason: 'quarter-report-mismatch', quarterEnd, earningsDate: e.date, reportLagDays });
        continue;
      }
      triggered.push(Object.assign({}, p, {
        cohortN: c.length, surpriseThreshold: threshold,
        earningsDate: e.date, earningsDateAsOf: e.asOf || null, earningsDateSource: e.source,
        reportAgeDays, reportLagDays,
      }));
    }
  }
  return { track, poolSize: pool.length, groups, triggered, skipped, dataGaps };
}

function evaluateBoard(vintage, ctx) {
  ctx = ctx || {};
  const cfg = withDefaults(ctx.cfg);
  const date = ctx.date || (vintage && vintage.date);
  const now = ctx.now || date;
  const board = vintage && vintage.board;
  const cohort = (vintage && vintage.cohort) || {};
  const earningsOf = ctx.earningsOf || (() => null);
  const tracks = {};
  for (const trackName of ['profitable', 'unprofitable']) {
    // 'flat' (survival.json) bleibt aussen vor: keine Sektor-Kohorte, kein Querschnitt.
    const rows = (cohort[trackName] || []).filter((r) => r && r.track === trackName);
    tracks[trackName] = evaluateTrack(board, trackName, rows, now, cfg, earningsOf);
  }
  return { board, date, tracks };
}

// ── Report-Datum: PIT zuerst, Live-Kalender nur als SICHTBARER Rueckfall ─────
// pit.earningsDate friert scripts/write-board-history.js additiv mit ein (analog E1 Option B).
// Solange ein Vintage das Feld nicht traegt, liest E2 den Live-Kalender — der ist fuer HEUTE
// richtig, fuer einen Backfill aber ein Anachronismus. Genau deshalb steht die Quelle je Alarm
// im Report (earningsDateSource) und aggregiert in report.earningsDateSources, statt still zu
// verschwinden.
function makeEarningsLookup(boards, baseDir) {
  const pitMap = new Map();
  for (const { vintage } of boards) {
    for (const tn of ['profitable', 'unprofitable']) {
      for (const r of (((vintage && vintage.cohort) || {})[tn] || [])) {
        if (r && r.pit && r.pit.earningsDate && !pitMap.has(r.ticker)) {
          pitMap.set(r.ticker, { date: r.pit.earningsDate, asOf: r.pit.earningsDateAsOf || null, source: 'pit' });
        }
      }
    }
  }
  let live = null;
  const liveRaw = readJsonExistingOrThrow(path.join(baseDir, 'earnings-calendar.json')); // kaputt -> wirft
  if (liveRaw !== FEHLT && liveRaw && typeof liveRaw === 'object') live = liveRaw;
  const lookup = (ticker) => {
    if (pitMap.has(ticker)) return pitMap.get(ticker);
    const e = live && live[ticker];
    if (e && e.date) return { date: e.date, asOf: e.pulledAt || null, source: 'calendar-live' };
    return null;
  };
  lookup.pitCount = pitMap.size;
  lookup.liveAvailable = Boolean(live);
  return lookup;
}

// ── Meldesatz ("Warum jetzt" in EINEM Satz, Ehrlichkeits-Kern a) ─────────────
function formatAlertLine(a) {
  return a.ticker + ': Umsatz ' + (a.qoqLatest >= 0 ? '+' : '') + pct0(a.qoqLatest) +
    ' % zum Vorquartal — ' + pct0(a.surprise) + ' pp ueber eigenem 4Q-Trend (' + pct0(a.trendQoq) +
    ' %), Sektor-Spitzendezil ' + a.board + '/' + a.track + ' Quartal ' + a.quarterEnd +
    ' (Schwelle ' + pct0(a.surpriseThreshold) + ' pp, n=' + a.cohortN + ')' +
    '; Report vor ' + a.reportAgeDays + ' Tagen' +
    (a.earningsDateSource === 'pit' ? '' : ' [Report-Datum aus Live-Kalender, nicht PIT]') +
    '. Trend-Abweichung, KEINE Analysten-Ueberraschung.';
}

// ── Offene Punkte — EXPLIZIT, nie still defaultet (wie E1) ───────────────────
function openPoints(cfg) {
  return [
    {
      id: 'saisonalitaet',
      frage: 'QoQ ist nicht saisonbereinigt — die Kohorte gleicht nur die Saison des KALENDERQUARTALS ab, nicht den Branchenmix innerhalb eines Boards',
      status: 'OFFEN — Methodik-Rest',
      aktuell: 'Kohorte = board x track x Quartalsende. Ein Kinobetreiber (Q2 saisonstark) steht damit gegen alle software-comm-services-Peers desselben Quartals, nicht gegen Kinobetreiber. Sauber erst mit YoY, das 8 Quartale braucht; pit.revenueQ liefert 5.',
    },
    {
      id: 'schwellen-kalibrierung',
      frage: 'Dezil (p90) + Boden (25 pp) sind am Querschnitt EINES Tages gemessen, nicht an Trefferquoten',
      status: 'OFFEN — kalibrierbar',
      aktuell: 'quantileP=' + cfg.quantileP + ', minSurprise=' + cfg.minSurprise +
        '. Gemessen am 2026-08-19 (marktweites p90 der Surprise = 0.260). Nach 4-6 Wochen aus der rollierenden Trefferquote nachkalibrieren.',
    },
    {
      id: 'trefferquote',
      frage: 'Rollierende Trefferquote je Signaltyp (Alert-Oekonomie des Katalogs) ist noch nicht angeschlossen',
      status: 'OFFEN — Folgeschritt',
      aktuell: 'E2 schreibt je Alarm Ticker/Datum/Quartal in den State; die Auswertung gegen Forward-Returns ist nicht Teil dieses Meldewegs.',
    },
  ];
}

// ── State (Dedup: EIN Alarm je Ticker und gemeldetem Quartal) ────────────────
// Bewusst KEIN Tages-Cooldown wie bei E1: E2s Ereignis ist der Report, und ein Report gehoert
// zu genau einem Quartal. Der Quartals-Schluessel ist der praezisere Dedup — und er ist gegen
// Daten-Flackern gesperrt, weil nur ein NEUERES Quartalsende feuern darf.
function readState(statePath) {
  const s = readJsonExistingOrThrow(statePath);   // fehlt -> FEHLT, kaputt/kein Objekt -> wirft
  if (s !== FEHLT) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      throw new Error(statePath + ' ist vorhanden, aber kein Zustands-Objekt');
    }
    s.tickers = s.tickers || {};
    return s;
  }
  return {
    _doc: 'E2-Earnings-Blowout — Dedup je Ticker: ein Alarm je gemeldetem Quartal. ' +
      'Von lib/e2-earnings-blowout.js via atomic-write geschrieben. Einziges Repo-Schreibziel von E2.',
    tickers: {},
  };
}

// ── Orchestrierung ───────────────────────────────────────────────────────────
function runE2(opts) {
  opts = opts || {};
  const baseDir = opts.baseDir || REPO_ROOT;
  const date = opts.date || isoDay(Date.now());
  const now = opts.now || date;
  const cfg = withDefaults(opts.cfg);
  const statePath = opts.statePath || path.join(baseDir, 'state', 'e2-alert-state.json');
  const outPath = opts.outPath || path.join(baseDir, 'outputs', 'e2-earnings-blowout.json');
  const annotate = Boolean(opts.annotate);
  const annot = (level, msg) => {
    if (!annotate) return;
    (level === 'error' ? console.error : console.log)('::' + level + '::' + msg);
  };
  // Ein korrupter vorhandener State ist ein eigener harter Fehler — auch wenn zugleich Boards
  // fehlen (F-CGPT-007-Klasse, aus E1 uebernommen).
  const stateExistedAtStart = fs.existsSync(statePath);
  if (stateExistedAtStart) readState(statePath);

  // 1) Board-Dateien des Tages lesen (nur echte Board-Vintages).
  const dir = path.join(baseDir, 'board-history', date);
  const directoryExists = fs.existsSync(dir);
  const files = directoryExists
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_') && f !== 'calibration.json' && f !== 'regime.json')
    : [];
  const boards = [];
  const invalidBoards = [];
  // Invariante (im Test verankert): boardFilesSeen === boardsRead + invalidBoards.length.
  for (const f of files) {
    let v = null, leseFehler = null;
    try { v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
    catch (e) { leseFehler = 'unlesbar: ' + e.message; }
    if (leseFehler) invalidBoards.push({ file: f, reason: leseFehler });
    else if (v && v.cohort) boards.push({ board: v.board || f.replace(/\.json$/, ''), vintage: v });
    else if (v) invalidBoards.push({ file: f, reason: 'cohort fehlt' });
    else invalidBoards.push({ file: f, reason: 'JSON leer/null statt Board-Objekt' });
  }
  const invalidLine = invalidBoards.length
    ? '  Board-Dateien unbrauchbar: ' + invalidBoards.length + ' von ' + files.length + ' — '
      + invalidBoards.map((b) => b.file + ' (' + b.reason + ')').join('; ')
    : null;

  if (!directoryExists || boards.length === 0) {
    const reason = !directoryExists ? 'board-history-Verzeichnis fehlt' : 'kein lesbares Board mit cohort';
    const report = {
      _doc: 'E2-Earnings-Blowout: Eingangsdaten nicht messbar.',
      schema: 'e2-earnings-blowout/v1', date, generatedAt: new Date().toISOString(),
      measurable: false, boardsRead: boards.length, boardFilesSeen: files.length,
      invalidBoards, reason, alerts: [], dataGaps: [],
    };
    annot('error', 'e2-earnings-blowout nicht messbar: ' + reason + ' (' + dir + ')');
    if (invalidLine) annot('warning', 'e2-earnings-blowout: ' + invalidBoards.length + ' unbrauchbare Board-Datei(en) im Tagesverzeichnis.');
    if (!opts.noWrite) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      writeJsonAtomic(outPath, report);
      // Echte Erstanlage darf den leeren State anlegen; ein vorhandener State wird beim
      // nicht messbaren Lauf byte-identisch in Ruhe gelassen.
      if (!stateExistedAtStart) {
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        writeJsonAtomic(statePath, readState(statePath));
      }
    }
    return { date, measurable: false, boardsRead: boards.length, invalidBoards, candidates: 0,
      alerts: [], dataGaps: [], lines: invalidLine ? [invalidLine] : [], report, statePath, outPath, exitCode: 1 };
  }

  // 2) Auswerten.
  const earningsOf = makeEarningsLookup(boards, baseDir);
  const candidates = [];
  const dataGaps = [];
  const lowNGroups = [];
  const skipTotals = { noPit: 0, badSeries: 0, implausible: 0 };
  for (const { vintage } of boards) {
    const ev = evaluateBoard(vintage, { date, now, cfg, earningsOf });
    for (const tn of ['profitable', 'unprofitable']) {
      const t = ev.tracks[tn];
      skipTotals.noPit += t.skipped.noPit;
      skipTotals.badSeries += t.skipped.badSeries;
      skipTotals.implausible += t.skipped.implausible;
      for (const g of t.dataGaps) dataGaps.push(Object.assign({ board: ev.board, track: tn }, g));
      for (const g of t.groups) if (g.lowN) lowNGroups.push({ board: ev.board, track: tn, quarterEnd: g.quarterEnd, cohortN: g.cohortN });
      for (const c of t.triggered) candidates.push(c);
    }
  }

  // 3) Dedup: ein Alarm je Ticker und gemeldetem Quartal. Nur ein NEUERES Quartalsende darf
  //    feuern — ein Ruecksprung auf ein aelteres Quartal (Datenflackern) nicht.
  const state = readState(statePath);
  const fired = [];
  for (const c of candidates) {
    const st = state.tickers[c.ticker] || (state.tickers[c.ticker] = {});
    st.lastSeenDate = date;
    if (st.lastAlertQuarterEnd && c.quarterEnd <= st.lastAlertQuarterEnd) { st.lastSuppress = 'quartal-schon-gemeldet'; continue; }
    fired.push(c);
  }

  // 4) Cap: staerkster Blowout zuerst, Rest ausweisen.
  fired.sort((a, b) => b.surprise - a.surprise);
  const alerts = fired.slice(0, cfg.alertCap);
  const suppressedByCap = Math.max(0, fired.length - cfg.alertCap);
  for (const a of alerts) {                       // nur GEZEIGTE setzen den Dedup-Schluessel
    state.tickers[a.ticker].lastAlertQuarterEnd = a.quarterEnd;
    state.tickers[a.ticker].lastAlertDate = date;
  }

  // 5) Report + menschenlesbare Zeilen.
  const alertObjs = alerts.map((a) => Object.assign({}, a, {
    qoqLatest: round2(a.qoqLatest), trendQoq: round2(a.trendQoq),
    surprise: round2(a.surprise), surpriseThreshold: round2(a.surpriseThreshold),
    line: formatAlertLine(a),
  }));
  const sources = { pit: 0, 'calendar-live': 0 };
  for (const a of alerts) sources[a.earningsDateSource] = (sources[a.earningsDateSource] || 0) + 1;

  const lines = [];
  lines.push('E2-Earnings-Blowout ' + date + ' — ' + alerts.length + ' Alarm(e)' +
    (suppressedByCap ? (', ' + suppressedByCap + ' weitere durch Cap unterdrueckt') : '') +
    ' · ' + candidates.length + ' Kandidat(en) vor Dedup');
  for (const a of alerts) lines.push('  ' + formatAlertLine(a));
  if (suppressedByCap) lines.push('  … ' + suppressedByCap + ' weitere Kandidaten durch Cap (' + cfg.alertCap + ') unterdrueckt.');
  const skipSum = skipTotals.noPit + skipTotals.badSeries + skipTotals.implausible;
  if (skipSum) lines.push('  uebersprungen: ' + skipTotals.noPit + ' ohne pit, ' + skipTotals.badSeries + ' Quartalsreihe unbrauchbar, ' + skipTotals.implausible + ' QoQ unplausibel (>' + cfg.maxQoq + ').');
  if (dataGaps.length) lines.push('  Datenluecken (nicht alarmiert): ' + dataGaps.length + ' (Report-Datum fehlt / Quartal-Report-Zuordnung).');
  if (lowNGroups.length) lines.push('  Dezil ausgelassen (Mindest-N ' + cfg.minCohortN + ' nicht erreicht): ' + lowNGroups.length + ' Kohorte(n).');
  if (sources['calendar-live']) lines.push('  ' + sources['calendar-live'] + ' Alarm(e) mit Report-Datum aus dem LIVE-Kalender statt aus dem PIT-Vintage — fuer heute richtig, fuer einen Backfill ein Anachronismus.');
  if (invalidLine) {
    lines.push(invalidLine);
    annot('warning', 'e2-earnings-blowout: ' + invalidBoards.length + ' von ' + files.length
      + ' Board-Datei(en) unbrauchbar — der Alarm dieses Tages ist nur ein Teil-Querschnitt.');
  }

  const report = {
    _doc: 'E2-Earnings-Blowout (6.2 E-Ast). Reiner Anzeige-Layer, KEIN Score-Einfluss, keine Formel.',
    schema: 'e2-earnings-blowout/v1',
    metric: 'Abweichung der juengsten QoQ-Umsatzrate vom Median der drei vorangegangenen QoQ-Raten ' +
      '(pit.revenueQ/revenueQEnds). TREND-Abweichung, KEINE Analysten-Ueberraschung (historische ' +
      'Schaetzungen liegen im Repo nicht vor). Nicht saisonbereinigt — Gegenmittel ist die Kohorte ' +
      'board x track x Quartalsende.',
    date, generatedAt: new Date().toISOString(), measurable: true,
    boardsRead: boards.length, boardFilesSeen: files.length, invalidBoards,
    candidates: candidates.length,
    alerts: alertObjs,
    suppressedByCap,
    skipped: skipTotals,
    dataGaps,
    lowNGroups,
    earningsDateSources: sources,
    earningsDatePitCoverage: earningsOf.pitCount,
    earningsCalendarLiveAvailable: earningsOf.liveAvailable,
    calibratables: {
      _doc: 'Am Querschnitt vom 2026-08-19 gemessen, nicht erfunden — nach 4-6 Wochen aus realen Trefferquoten nachkalibrieren.',
      quantileP: cfg.quantileP, minSurprise: cfg.minSurprise, minCohortN: cfg.minCohortN,
      reportMaxAgeDays: cfg.reportMaxAgeDays, reportLagMinDays: cfg.reportLagMinDays,
      reportLagMaxDays: cfg.reportLagMaxDays, quarterMinGapDays: cfg.quarterMinGapDays,
      quarterMaxGapDays: cfg.quarterMaxGapDays, maxQoq: cfg.maxQoq, alertCap: cfg.alertCap,
    },
    openPoints: openPoints(cfg),
  };

  if (!opts.noWrite) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    writeJsonAtomic(outPath, report);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    writeJsonAtomic(statePath, state);
  }

  return { date, measurable: true, boardsRead: boards.length, invalidBoards, candidates: candidates.length,
    alerts: alertObjs, suppressedByCap, skipped: skipTotals, dataGaps, lowNGroups, lines, report, statePath, outPath, exitCode: 0 };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date') opts.date = args[++i];
    else if (args[i].startsWith('--date=')) opts.date = args[i].slice(7);
    else if (args[i] === '--base-dir') opts.baseDir = args[++i];
    else if (args[i] === '--dry-run') opts.noWrite = true;
  }
  opts.annotate = true;   // nur der CLI-Einstieg annotiert (siehe runE2)
  try {
    const res = runE2(opts);
    res.lines.forEach((l) => console.log(l));
    process.exit(res.exitCode);
  } catch (e) {
    console.error('::error::e2-earnings-blowout FEHLER: ' + (e && e.stack || e));
    process.exit(1);
  }
}

module.exports = {
  runE2, evaluateBoard, evaluateTrack, formatAlertLine, openPoints,
  surpriseVsOwnTrend, makeEarningsLookup, quantile, median, daysBetween, withDefaults,
  E2_CONST,
};
