'use strict';
/**
 * lib/e1-compression.js — 6.2-E-Ast, Event E1 "Kompression" (Court 2026-07-17,
 * PASS_MIT_AUFLAGEN, Karl-Entscheid E-20260717-4).
 *
 * WAS: Reiner Lese-/Anzeige-Layer. Feuert, wenn eine Board-Aktie im untersten
 * Sektor-Quartil ihrer BEWERTUNG steht (Querschnitt gegen die Track-Peers von HEUTE)
 * UND ihr Wachstum intakt/beschleunigend ist (bestehende Achsen revGrowthLevel/
 * revAcceleration, read-only wiederverwendet). Zweck: Nachkauf-/Einstiegs-Timing bei
 * bereits bekannter Qualitaet.
 *
 * ⚠ EHRLICHKEITS-KERN (Court-Auflagen): die live in der committeten board-history
 * verfuegbare Bewertungs-Metrik ist EV/Sales (pit.evSales), NICHT echtes Price/Sales.
 * Der Meldesatz nennt daher IMMER "EV/Sales" (nie "P/S") und traegt das Pflicht-
 * Reifegrad-Label "Querschnitt, NICHT Eigenhistorie; 12M-Kompressionssignal reift,
 * Tag n". Das echte Price/Sales sammelt scripts/write-board-history.js ab 2026-07-17
 * additiv mit (Option B, pit.priceSales/priceSalesAsOf) — daraus waechst ueber 12
 * Monate die eigentliche Eigenhistorie-Spezifikation (CRDO/ALAB-Kompression).
 *
 * AUFLAGEN-MAP (Court):
 *   1 Metrik ehrlich (EV/Sales + Reifegrad-Label)      → formatAlertLine
 *   2 Freshness-Gate auf priceSalesAsOf, NIE fetchedAt → evaluateTrack (Datenluecke statt Alarm)
 *   3 Mechaniker-Veto hart                              → dieses Modul liest NIE revenueQ/revenueQEnds/annualRev
 *   4 Option B (Pflicht, additiv)                       → scripts/write-board-history.js buildPit
 *   5 Dedup/Cooldown + Alert-Cap                        → runE1 (state/e1-alert-state.json + cfg.alertCap)
 *   6 Mindest-N je Track + Anti-Flacker (Verweildauer)  → evaluateTrack (minCohortN) + runE1 (minDwellDays)
 *   7 Skip unvollstaendiger Zeilen + sichtbar loggen    → evaluateTrack skipped{} + runE1 stdout
 *   8 Reiner Lesepfad, kein Score, nur state schreiben  → keine Score-Ausgabe; Schreibziele: outputs/ (report) + state/
 *   9 Option C NICHT gebaut                             → kein SEC-XBRL-Pfad hier
 *  10 Zwei offene Punkte EXPLIZIT ausweisen             → report.openPoints (nicht still defaultet)
 *
 * KEIN Repo-Schreibzugriff ausser state/e1-alert-state.json (dedup) und dem
 * transienten outputs/e1-kompression.json (gitignored, von der Briefing-Kette konsumiert).
 *
 * Aufruf durch die tägliche Kette (screener-briefing), NACH write-board-history:
 *   node -e "require('./lib/e1-compression.js').runE1({})"
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./atomic-write.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const MS_PER_DAY = 86400000;

// ── Kalibrierbare Schwellen (Court: "grob setzen, aus wachsender board-history
// nachkalibrieren — nicht hartkodiert erfinden"). Alle per cfg-Override testbar. ──
const E1_CONST = {
  // OFFENER PUNKT 1 (Auflage 10, NICHT still defaulten): exakte Kompressions-Schwelle
  // Q1 (25%) vs. 20%. Grob Q1 gesetzt; aus board-history nachzukalibrieren (existiert
  // erst seit 2026-07-14). Im report.openPoints explizit ausgewiesen.
  QUARTILE_P: 0.25,
  // "Wachstum intakt/beschleunigend": axisBreakdown-Perzentile ueber Median. Der
  // Accel-Floor haelt zusaetzlich das bekannte revAcceleration-Abkuehlungs-Artefakt
  // fern (2.14-Saga) — E1 feuert nicht auf Namen, die die Formel wegen echter
  // Abkuehlung abstuft. Grob 50 (=Median); kalibrierbar.
  GROWTH_LEVEL_MIN_PCT: 50,
  GROWTH_ACCEL_MIN_PCT: 50,
  // Mindest-Kohorte je Track vor der Perzentil-Berechnung (Auflage 6). Grob 20:
  // ein Quartil aus <20 rankbaren Namen ist zu wenige Namen, um stabil zu sein.
  // Profitable-Track liegt real ~60, unprofitable niedriger → je Track separat geprueft.
  MIN_COHORT_N: 20,
  // Anti-Flacker (Auflage 6): Mindest-Verweildauer im untersten Quartil, bevor gefeuert
  // wird — verhindert Fehlalarm durch Schwellen-Jitter bei einem einzelnen Board-Wechsel.
  // Grob 1 (= an ≥2 aufeinanderfolgenden board-history-Tagen billig).
  MIN_DWELL_DAYS: 1,
  // Dedup/Cooldown (Auflage 5): gleicher Ticker feuert erst nach Mindestpause erneut —
  // ausser er verlaesst das Quartil und tritt neu ein. Grob 30 Tage; nach 4–6 Wochen
  // echter board-history aus realen Wiederholungsraten kalibrieren.
  COOLDOWN_DAYS: 30,
  // Alert-Cap je Briefing-Tag (Auflage 5): gegen Bulk-Alarm, wenn ein ganzer Sektor
  // gleichzeitig kippt. Grob 6 (Court-Fenster 5–8).
  ALERT_CAP: 6,
  // Freshness (Auflage 2 / KILL-4): maximale Alter der ECHTEN Bewertungs-asOf
  // (priceSalesAsOf), sonst Datenluecke statt Alarm. Grob 14 Tage; nachkalibrieren.
  FRESHNESS_MAX_DAYS: 14,
};

// ── kleine Helfer ────────────────────────────────────────────────────────────
function isoDay(d) { return new Date(d).toISOString().slice(0, 10); }
function round2(x) { return Math.round(x * 100) / 100; }

// Tage zwischen zwei ISO-Zeitpunkten (auf Tages-Ebene). Ungueltig → null.
function daysBetween(aIso, bIso) {
  const a = Date.parse(aIso), b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

// coverageAxes ist ein String "n/m" (z. B. "7/7"). Voll = n===m, m>0.
function isFullCoverage(cov) {
  if (typeof cov !== 'string') return false;
  const m = /^(\d+)\/(\d+)$/.exec(cov.trim());
  if (!m) return false;
  const have = +m[1], need = +m[2];
  return need > 0 && have === need;
}

// Perzentil-Wert (nearest-rank, konservativ) einer Zahlenliste — bewusst identisch
// zur quantile() in write-board-history.js, damit "unterstes Quartil" eine Bedeutung hat.
function quantile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const idx = Math.min(v.length - 1, Math.ceil(p * v.length) - 1);
  return v[Math.max(0, idx)];
}

// axisBreakdown-Perzentil zu einem Achsen-Key (read-only wiederverwendet, keine neue Formel).
function pickAxisPct(axisBreakdown, key) {
  if (!Array.isArray(axisBreakdown)) return null;
  const e = axisBreakdown.find((a) => a && a.key === key);
  return e && Number.isFinite(e.pct) ? e.pct : null;
}

function withDefaults(cfg) {
  cfg = cfg || {};
  const pick = (k, d) => (cfg[k] != null ? cfg[k] : d);
  return {
    quartileP: pick('quartileP', E1_CONST.QUARTILE_P),
    growthLevelMinPct: pick('growthLevelMinPct', E1_CONST.GROWTH_LEVEL_MIN_PCT),
    growthAccelMinPct: pick('growthAccelMinPct', E1_CONST.GROWTH_ACCEL_MIN_PCT),
    minCohortN: pick('minCohortN', E1_CONST.MIN_COHORT_N),
    minDwellDays: pick('minDwellDays', E1_CONST.MIN_DWELL_DAYS),
    cooldownDays: pick('cooldownDays', E1_CONST.COOLDOWN_DAYS),
    alertCap: pick('alertCap', E1_CONST.ALERT_CAP),
    freshnessMaxDays: pick('freshnessMaxDays', E1_CONST.FRESHNESS_MAX_DAYS),
  };
}

// ── Trigger-Kern (pure, keine I/O) ───────────────────────────────────────────
// Wertet EINEN Track eines Board-Vintages aus. Gates in Reihenfolge:
//   coverageAxes voll? → Wachstums-Achsen da? → evSales da? → Freshness (asOf frisch?)
// Erst danach: rankbarer Pool → Mindest-N → unterstes Quartil + Wachstum intakt.
function evaluateTrack(board, track, rows, now, cfg) {
  const skipped = { coverage: 0, growthAxes: 0, noEvSales: 0 };
  const dataGaps = [];
  const pool = [];
  for (const r of rows) {
    // Auflage 7: unvollstaendige coverageAxes NIE mit Teildaten alarmieren.
    if (!isFullCoverage(r.coverageAxes)) { skipped.coverage++; continue; }
    const glvl = pickAxisPct(r.axisBreakdown, 'revGrowthLevel');
    const accel = pickAxisPct(r.axisBreakdown, 'revAcceleration');
    if (glvl == null || accel == null) { skipped.growthAxes++; continue; }
    const evSales = r.pit && Number.isFinite(r.pit.evSales) ? r.pit.evSales : null;
    if (evSales == null) { skipped.noEvSales++; continue; }
    // Auflage 2 / KILL-4: Freshness-Gate MUSS auf die echte Bewertungs-asOf keyen
    // (priceSalesAsOf), NIE auf fetchedAt/Zeilendatum. Fehlt sie oder ist sie zu alt →
    // fail-loud als Datenluecke, NICHT alarmieren.
    const asOf = r.pit.priceSalesAsOf;
    if (!asOf) { dataGaps.push({ ticker: r.ticker, reason: 'no-priceSalesAsOf' }); continue; }
    const ageDays = daysBetween(asOf, now);
    if (ageDays == null) { dataGaps.push({ ticker: r.ticker, reason: 'bad-priceSalesAsOf', asOf }); continue; }
    if (ageDays > cfg.freshnessMaxDays) { dataGaps.push({ ticker: r.ticker, reason: 'stale-valuation', asOf, ageDays }); continue; }
    pool.push({
      ticker: r.ticker, board, track, evSales,
      revGrowthLevelPct: glvl, revAccelerationPct: accel,
      priceSalesAsOf: asOf, valuationAgeDays: ageDays,
    });
  }
  // Auflage 6: kein Perzentil auf einer zu kleinen Kohorte. lowN nur melden, wenn der
  // Track ueberhaupt Zeilen hatte — ein leerer Track (z. B. survival ist flat, kein
  // profitable/unprofitable) ist kein aussagekraeftiges "Perzentil ausgelassen".
  if (pool.length < cfg.minCohortN) {
    // X5-Fix: ohne Schwelle ist kein Bewertungs-Austritt BEOBACHTBAR (zu kleine Kohorte) ->
    // exited bleibt leer, statt einen Reset auf Verdacht auszuloesen.
    return { track, rankablePoolSize: pool.length, thresholdEvSales: null, triggered: [], exited: [], skipped, dataGaps, lowN: rows.length > 0 };
  }
  const thresholdEvSales = quantile(pool.map((p) => p.evSales), cfg.quartileP);
  const triggered = [];
  // X5-Fix (T2, Opus-Fund): "exited" = heute mit GUELTIGEM evSales gesehen, aber NICHT mehr im
  // untersten Quartil — der EINZIGE Fall, der den Dedup/Cooldown-Zustand eines Tickers in runE1
  // zuruecksetzen darf. Ein Ticker, der nur ABWESEND ist (nicht im Board), nicht auswertbar
  // (Datenluecke/fehlende Achsen/stale asOf) oder cheap-aber-Wachstum-verfehlt ist, taucht hier
  // NICHT auf -> sein Zustand haelt (Cooldown laeuft ohnehin kalendarisch ab).
  const exited = [];
  for (const p of pool) {
    const cheap = p.evSales <= thresholdEvSales;                        // unterstes Bewertungs-Quartil
    const growthIntact = p.revGrowthLevelPct >= cfg.growthLevelMinPct   // Wachstum intakt
      && p.revAccelerationPct >= cfg.growthAccelMinPct;                 // + nicht abkuehlend
    if (cheap && growthIntact) { p.evSalesThreshold = thresholdEvSales; triggered.push(p); }
    if (!cheap) { exited.push(p.ticker); }                              // echter Bewertungs-Austritt
  }
  return { track, rankablePoolSize: pool.length, thresholdEvSales, triggered, exited, skipped, dataGaps, lowN: false };
}

function evaluateBoard(vintage, ctx) {
  ctx = ctx || {};
  const cfg = withDefaults(ctx.cfg);
  const date = ctx.date || (vintage && vintage.date);
  const now = ctx.now || date;
  const board = vintage && vintage.board;
  const cohort = (vintage && vintage.cohort) || {};
  // Rows nach ECHTEM Track gruppieren; 'flat' (survival.json) faellt raus — kein Sektor-Board.
  const rowsAll = [].concat(cohort.profitable || [], cohort.unprofitable || []);
  const tracks = {};
  for (const trackName of ['profitable', 'unprofitable']) {
    const rows = rowsAll.filter((r) => r && r.track === trackName);
    tracks[trackName] = evaluateTrack(board, trackName, rows, now, cfg);
  }
  return { board, date, tracks };
}

// ── Meldesatz (Auflage 1: EV/Sales, nie P/S, + Pflicht-Reifegrad-Label) ──────
function formatAlertLine(a, eigenHistorieDay) {
  const growthLabel = a.revAccelerationPct >= 50 ? 'beschleunigend' : 'intakt';
  return a.ticker + ': EV/Sales ' + round2(a.evSales) +
    ' — unterstes Sektor-Quartil (' + a.board + '/' + a.track +
    '; Querschnitt, NICHT Eigenhistorie; 12M-Kompressionssignal reift, Tag ' + eigenHistorieDay + ')' +
    ', Wachstum ' + growthLabel +
    ' (revGrowthLevel ' + a.revGrowthLevelPct + ', revAcceleration ' + a.revAccelerationPct + ').';
}

// ── Die 2 offenen Punkte (Auflage 10) — EXPLIZIT, nie still defaultet ────────
function openPoints(cfg) {
  return [
    {
      id: 'perzentil-schwelle',
      frage: 'Exakte Kompressions-Perzentil-Schwelle: Q1 (25%) vs. 20%',
      status: 'OFFEN — kalibrierbar',
      aktuell: 'quartileP=' + cfg.quartileP + ' (grob Q1). Aus wachsender board-history nachkalibrieren — existiert erst seit 2026-07-14.',
    },
    {
      id: 'fdr-korrektur',
      frage: 'FDR-Korrektur ueber alle 12 Sektor-Boards fuer die spaetere Live-Trefferquote',
      status: 'OFFEN — Methodik-Folgeentscheid',
      aktuell: 'nicht angewandt. Die rollierende Live-Trefferquote wird noch nicht statistisch gegen Zufall getestet.',
    },
  ];
}

// ── State (dedup/cooldown/anti-flacker + Eigenhistorie-Uhr) ──────────────────
function readState(statePath) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (s && typeof s === 'object') { s.tickers = s.tickers || {}; return s; }
  } catch (_) { /* neu anlegen */ }
  return {
    _doc: 'E1-Kompressions-Alarm — Dedup/Cooldown/Anti-Flacker je Ticker + Eigenhistorie-Uhr. ' +
      'Von lib/e1-compression.js via atomic-write geschrieben. Einziges Repo-Schreibziel von E1 (Auflage 8).',
    eigenHistorieStartDate: null,
    tickers: {},
  };
}

// ── Orchestrierung: liest committete board-history, feuert, schreibt Report+State ──
function runE1(opts) {
  opts = opts || {};
  const baseDir = opts.baseDir || REPO_ROOT;
  const date = opts.date || isoDay(Date.now());
  const now = opts.now || date;
  const cfg = withDefaults(opts.cfg);
  const statePath = opts.statePath || path.join(baseDir, 'state', 'e1-alert-state.json');
  const outPath = opts.outPath || path.join(baseDir, 'outputs', 'e1-kompression.json');

  // 1) Board-Dateien des Tages lesen (nur echte Board-Vintages: '_'-Sidecars +
  //    calibration/regime raus; alles mit .cohort rein).
  const dir = path.join(baseDir, 'board-history', date);
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_') && f !== 'calibration.json' && f !== 'regime.json')
    : [];
  const boards = [];
  for (const f of files) {
    let v = null;
    try { v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { v = null; }
    if (v && v.cohort) boards.push({ board: v.board || f.replace(/\.json$/, ''), vintage: v });
  }

  // 2) Auswerten + Aggregate.
  const candidates = [];
  const dataGaps = [];
  const lowNGroups = [];
  const exitedTickers = new Set(); // X5-Fix: nur BEOBACHTETE Bewertungs-Austritte (siehe evaluateTrack)
  const skipTotals = { coverage: 0, growthAxes: 0, noEvSales: 0 };
  let sawPriceSales = false;
  for (const { vintage } of boards) {
    // Eigenhistorie-Uhr: Option B ist live, sobald IRGENDEINE Zeile eine priceSalesAsOf traegt.
    for (const tn of ['profitable', 'unprofitable']) {
      for (const r of (vintage.cohort[tn] || [])) { if (r && r.pit && r.pit.priceSalesAsOf) { sawPriceSales = true; break; } }
      if (sawPriceSales) break;
    }
    const ev = evaluateBoard(vintage, { date, now, cfg });
    for (const tn of ['profitable', 'unprofitable']) {
      const t = ev.tracks[tn];
      skipTotals.coverage += t.skipped.coverage;
      skipTotals.growthAxes += t.skipped.growthAxes;
      skipTotals.noEvSales += t.skipped.noEvSales;
      for (const g of t.dataGaps) dataGaps.push(Object.assign({ board: ev.board, track: tn }, g));
      if (t.lowN) lowNGroups.push({ board: ev.board, track: tn, poolSize: t.rankablePoolSize });
      for (const c of t.triggered) candidates.push(c);
      for (const tk of t.exited) exitedTickers.add(tk);
    }
  }

  // 3) State-Gates: Eigenhistorie-Uhr, Anti-Flacker (Verweildauer), Dedup (Cooldown).
  const state = readState(statePath);
  if (sawPriceSales && !state.eigenHistorieStartDate) state.eigenHistorieStartDate = date;
  const eigenHistorieDay = state.eigenHistorieStartDate ? (daysBetween(state.eigenHistorieStartDate, date) + 1) : 0;

  const fired = [];
  for (const c of candidates) {
    const st = state.tickers[c.ticker] || (state.tickers[c.ticker] = {});
    if (!st.inBottomQuartileSince) st.inBottomQuartileSince = date;   // Eintritt markieren
    st.lastSeenDate = date;
    st.lastEvSales = c.evSales;
    const dwellDays = daysBetween(st.inBottomQuartileSince, date);
    const cooldownActive = st.lastAlertDate && daysBetween(st.lastAlertDate, date) < cfg.cooldownDays;
    if (dwellDays < cfg.minDwellDays) { st.lastSuppress = 'dwell'; continue; }   // Anti-Flacker
    if (cooldownActive) { st.lastSuppress = 'cooldown'; continue; }              // Dedup
    fired.push(c);
  }
  // X5-Fix (T2, Opus-Fund): Reset NUR bei einem BEOBACHTETEN Bewertungs-Austritt (exitedTickers,
  // aus evaluateTrack: heute mit gueltigem evSales gesehen, aber ueber der Quartil-Schwelle) —
  // damit ein Wiedereintritt frisch feuern darf (Court: "nach Austritt und Wiedereintritt").
  // VORHER wurde bei JEDER Abwesenheit von candSet (= cheap UND growthIntact) resettet: ein
  // Ticker, der cheap blieb aber nur transient das Wachstumsgate verfehlte (oder eine Datenluecke
  // hatte), verlor sofort seinen Cooldown und konnte Tage vor Ablauf der 30-Tage-Sperre erneut
  // feuern (Bruch von Auflage 5). Jetzt haelt ein nur-abwesender/nicht-auswertbarer/cheap-aber-
  // Wachstums-Miss-Ticker seinen Zustand (Cooldown laeuft ohnehin kalendarisch ab); nur ein
  // ECHTER Austritt (evSales > Schwelle) resettet.
  for (const tk of exitedTickers) {
    const st = state.tickers[tk];
    if (!st) continue; // nie gesehener/schon-resetteter Ticker -> nichts zu tun
    if (st.inBottomQuartileSince || st.lastAlertDate) st.exitedOn = date;
    st.inBottomQuartileSince = null;
    st.lastAlertDate = null;
  }

  // 4) Cap (Auflage 5): billigste zuerst (staerkste Kompression), Rest ausweisen.
  fired.sort((a, b) => a.evSales - b.evSales);
  const alerts = fired.slice(0, cfg.alertCap);
  const suppressedByCap = Math.max(0, fired.length - cfg.alertCap);
  for (const a of alerts) { state.tickers[a.ticker].lastAlertDate = date; }  // nur GEZEIGTE lösen Cooldown aus

  // 5) Report + menschenlesbare Zeilen.
  const alertObjs = alerts.map((a) => Object.assign({}, a, {
    evSales: round2(a.evSales), evSalesThreshold: round2(a.evSalesThreshold),
    line: formatAlertLine(a, eigenHistorieDay),
  }));
  const lines = [];
  lines.push('E1-Kompression ' + date + ' — ' + alerts.length + ' Alarm(e)' +
    (suppressedByCap ? (', ' + suppressedByCap + ' weitere durch Cap unterdrueckt') : '') +
    ' · Eigenhistorie Tag ' + eigenHistorieDay);
  for (const a of alerts) lines.push('  ' + formatAlertLine(a, eigenHistorieDay));
  if (suppressedByCap) lines.push('  … ' + suppressedByCap + ' weitere Kandidaten durch Cap (' + cfg.alertCap + ') unterdrueckt.');
  // Auflage 7: uebersprungene/luecken sichtbar loggen (fail-loud), nie still.
  const skipSum = skipTotals.coverage + skipTotals.growthAxes + skipTotals.noEvSales;
  if (skipSum) lines.push('  uebersprungen: ' + skipTotals.coverage + ' coverage, ' + skipTotals.growthAxes + ' Wachstums-Achse, ' + skipTotals.noEvSales + ' evSales fehlt.');
  if (dataGaps.length) lines.push('  Datenluecken (nicht alarmiert): ' + dataGaps.length + ' (Freshness/priceSalesAsOf).');
  if (lowNGroups.length) lines.push('  Perzentil ausgelassen (Mindest-N ' + cfg.minCohortN + ' nicht erreicht): ' + lowNGroups.map((g) => g.board + '/' + g.track).join(', ') + '.');

  const report = {
    _doc: 'E1-Kompressions-Alarm (6.2 E-Ast). Reiner Anzeige-Layer, KEIN Score-Einfluss. Court 2026-07-17 PASS_MIT_AUFLAGEN.',
    schema: 'e1-compression/v1',
    metric: 'EV/Sales (Enterprise-Value/Sales) aus committeter board-history — NICHT Price/Sales. Echtes P/S sammelt Option B ab 2026-07-17 fuer die spaetere Eigenhistorie.',
    date, generatedAt: new Date().toISOString(),
    eigenHistorieStartDate: state.eigenHistorieStartDate,
    eigenHistorieDay,
    alerts: alertObjs,
    suppressedByCap,
    skipped: skipTotals,
    dataGaps,
    lowNGroups,
    calibratables: {
      _doc: 'Grob gesetzte Schwellen — nach 4–6 Wochen echter board-history aus realen Raten nachkalibrieren (Court-Auflagen 5/6), NICHT hartkodiert erfunden.',
      quartileP: cfg.quartileP, growthLevelMinPct: cfg.growthLevelMinPct, growthAccelMinPct: cfg.growthAccelMinPct,
      minCohortN: cfg.minCohortN, minDwellDays: cfg.minDwellDays, cooldownDays: cfg.cooldownDays,
      alertCap: cfg.alertCap, freshnessMaxDays: cfg.freshnessMaxDays,
    },
    openPoints: openPoints(cfg),
  };

  // 6) Schreiben (Auflage 8: nur diese beiden Ziele; outputs/ ist gitignored/transient).
  if (!opts.noWrite) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    writeJsonAtomic(outPath, report);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    writeJsonAtomic(statePath, state);
  }

  return { date, eigenHistorieDay, alerts: alertObjs, suppressedByCap, skipped: skipTotals, dataGaps, lowNGroups, lines, report, statePath, outPath };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date') opts.date = args[++i];
    else if (args[i].startsWith('--date=')) opts.date = args[i].slice(7);
  }
  try {
    const res = runE1(opts);
    res.lines.forEach((l) => console.log(l));
    process.exit(0);
  } catch (e) {
    console.error('e1-compression FEHLER: ' + (e && e.stack || e));
    process.exit(1);
  }
}

module.exports = {
  runE1, evaluateBoard, evaluateTrack, formatAlertLine, openPoints,
  isFullCoverage, pickAxisPct, quantile, daysBetween, withDefaults,
  E1_CONST,
};
