// tests/e1-compression.test.js — Standalone-Runner (framework-los: assert + process.exit).
// Deckt lib/e1-compression.js ab (6.2-E-Ast, Event E1 "Kompression", Court 2026-07-17
// PASS_MIT_AUFLAGEN). Fixtures EINGEBETTET / Temp-Verzeichnis (L4 — keine Abhaengigkeit
// von echten board-history/-Daten). Run: node tests/e1-compression.test.js
//
// Test-Landkarte (Court testSpec 1..6 + Auflagen):
//   (1) Trigger        — unterstes Quartil + Wachstum intakt feuert; Quartil + schwaches Wachstum nicht.
//   (2) Mechaniker-Veto — Zeile mit revenueQEnds=null baut NIE eine datierte Historie; feuert regulaer.
//   (3) Freshness-Gate  — priceSalesAsOf 60 Tage alt (fetchedAt frisch) → Datenluecke, NICHT Alarm.
//   (4) Dedup/Cooldown  — gleicher Ticker Folgetag unterdrueckt; Austritt+Wiedereintritt feuert wieder.
//   (5) Cap             — 10 Namen kippen → hoechstens Cap Zeilen, Rest als "N weitere unterdrueckt".
//   (6) Skip            — coverageAxes < voll / fehlendes revGrowthLevel|revAcceleration → uebersprungen + gezaehlt.
//   (7) Anti-Flacker    — Mindest-Verweildauer: 1-Tages-Blip feuert nicht.
//   (8) Offene Punkte   — Report weist die 2 offenen Punkte (Q1-vs-20%, FDR) EXPLIZIT aus.
//   (9) Eigenhistorie-Uhr — Tag-n-Label + Reifegrad-Etikett im Meldesatz.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../lib/e1-compression.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

// ── Fixture-Helfer ───────────────────────────────────────────────────────────
function mkBase() { return fs.mkdtempSync(path.join(os.tmpdir(), 'e1-')); }

// Board-Zeile im board-history-Vintage-Format. evSales = Bewertungs-Floor-Metrik;
// glvl/accel = axisBreakdown-Perzentile; psAsOf = echte Bewertungs-asOf (Freshness-Anker).
function mkRow(ticker, opts) {
  opts = opts || {};
  const glvl = opts.glvl != null ? opts.glvl : 80;
  const accel = opts.accel != null ? opts.accel : 80;
  const axis = [];
  if (!opts.noGrowthLevel) axis.push({ key: 'revGrowthLevel', pct: glvl, weight: 1.7 });
  if (!opts.noAccel) axis.push({ key: 'revAcceleration', pct: accel, weight: 2.6 });
  axis.push({ key: 'gpGrowth', pct: 70, weight: 1.8 });
  const pit = {
    beta: 1.5, evSales: opts.evSales,
    priceGrossProfit: 20, fetchedAt: opts.fetchedAt || '2026-07-14T06:00:00.000Z',
    revenueQ: [1, 2, 3],
    revenueQEnds: opts.revenueQEnds !== undefined ? opts.revenueQEnds : null, // live-Realitaet: undatiert
    grossProfitQ: [1, 2, 3], grossProfitQEnds: null,
    priceSales: opts.priceSales != null ? opts.priceSales : 12.0,
    priceSalesAsOf: opts.priceSalesAsOf !== undefined ? opts.priceSalesAsOf : '2026-07-13T00:00:00.000Z',
  };
  if (opts.noPit) return { rank: 1, ticker, track: opts.track || 'profitable', score: 90, coverageAxes: opts.coverageAxes || '7/7', axisBreakdown: axis, pit: null };
  return {
    rank: 1, ticker, track: opts.track || 'profitable', score: 90,
    coverageAxes: opts.coverageAxes || '7/7', axisBreakdown: axis, pit,
  };
}

function mkVintage(board, date, profitable, unprofitable) {
  return { date, board, boardStatus: 'core', cohort: { profitable: profitable || [], unprofitable: unprofitable || [] } };
}
function writeVintage(base, date, board, vintage) {
  const dir = path.join(base, 'board-history', date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, board + '.json'), JSON.stringify(vintage));
}

// evSales-Verteilung, deren unterstes Quartil bekannt ist: [5,6,10,20,30,40,50,60].
// quantile(p=0.25) nearest-rank → 2.-kleinster = 6. Zeilen mit evSales<=6 sind "billig".
function cohortEight(fresh) {
  const psAsOf = fresh ? '2026-07-13T00:00:00.000Z' : '2026-05-10T00:00:00.000Z';
  return [
    mkRow('CHEAP_HI', { evSales: 5, glvl: 85, accel: 85, priceSalesAsOf: psAsOf }),   // billig + Wachstum → feuert
    mkRow('CHEAP_LO', { evSales: 6, glvl: 30, accel: 30, priceSalesAsOf: psAsOf }),   // billig, aber Wachstum schwach → NICHT
    mkRow('MID1', { evSales: 10, priceSalesAsOf: psAsOf }),
    mkRow('MID2', { evSales: 20, priceSalesAsOf: psAsOf }),
    mkRow('MID3', { evSales: 30, priceSalesAsOf: psAsOf }),
    mkRow('HI1', { evSales: 40, priceSalesAsOf: psAsOf }),
    mkRow('HI2', { evSales: 50, priceSalesAsOf: psAsOf }),
    mkRow('HI3', { evSales: 60, priceSalesAsOf: psAsOf }),
  ];
}

const DATE = '2026-07-14';
// Test-cfg: kleine Kohorten → Mindest-N herabsetzen; Dwell 0, um die reine Trigger-Logik
// von der Anti-Flacker-Verweildauer zu trennen (die (7) separat prueft).
const cfgTrigger = { minCohortN: 4, minDwellDays: 0 };

// ── (1) Trigger ──────────────────────────────────────────────────────────────
check('(1) unterstes Quartil + Wachstum intakt feuert; schwaches Wachstum feuert NICHT', () => {
  const v = mkVintage('semiconductors', DATE, cohortEight(true));
  const r = E.evaluateBoard(v, { date: DATE, cfg: cfgTrigger });
  const t = r.tracks.profitable;
  const fired = t.triggered.map((c) => c.ticker);
  assert.ok(fired.includes('CHEAP_HI'), 'billig + starkes Wachstum feuert');
  assert.ok(!fired.includes('CHEAP_LO'), 'billig aber schwaches Wachstum feuert NICHT');
  assert.ok(!fired.includes('MID1'), 'mittlere Bewertung feuert nicht (nicht im untersten Quartil)');
  assert.strictEqual(t.thresholdEvSales, 6, 'Quartil-Schwelle = 2.-kleinster evSales (6)');
});

// ── (2) Mechaniker-Veto ──────────────────────────────────────────────────────
check('(2) Zeile mit revenueQEnds=null feuert regulaer, baut NIE datierte Historie', () => {
  const rows = cohortEight(true);
  // alle Zeilen tragen bereits revenueQEnds:null (live-Realitaet) — CHEAP_HI muss trotzdem feuern
  rows.forEach((row) => assert.strictEqual(row.pit.revenueQEnds, null, 'Fixture: Arrays undatiert wie live'));
  const r = E.evaluateBoard(mkVintage('semiconductors', DATE, rows), { date: DATE, cfg: cfgTrigger });
  const cand = r.tracks.profitable.triggered.find((c) => c.ticker === 'CHEAP_HI');
  assert.ok(cand, 'feuert trotz undatierter Quartals-Arrays (E1 nutzt sie nie)');
  // Kein rekonstruiertes Historien-/Datierungs-Feld im Kandidaten:
  const blob = JSON.stringify(cand);
  assert.ok(!/revenueQEnds|revenueQ|annualRev|reconstructedHistory|quarterEnds/i.test(blob),
    'Kandidat traegt kein aus undatierten Arrays konstruiertes Feld');
});

// ── (3) Freshness-Gate (KILL-4) ──────────────────────────────────────────────
check('(3) priceSalesAsOf 60 Tage alt (fetchedAt frisch) → Datenluecke, NICHT Alarm', () => {
  // fetchedAt HEUTE, aber Bewertung 60 Tage alt — genau der interne Widerspruch aus KILL-4.
  const rows = cohortEight(false).map((row) => {
    row.pit.fetchedAt = DATE + 'T06:00:00.000Z';       // sieht frisch aus …
    return row;                                        // … priceSalesAsOf bleibt 2026-05-10 (stale)
  });
  const r = E.evaluateBoard(mkVintage('semiconductors', DATE, rows), { date: DATE, cfg: cfgTrigger });
  const t = r.tracks.profitable;
  assert.strictEqual(t.triggered.length, 0, 'kein Alarm auf 60-Tage-alter Bewertung');
  assert.ok(t.dataGaps.length >= 1, 'stale Zeilen als Datenluecke geloggt');
  assert.ok(t.dataGaps.every((g) => g.reason === 'stale-valuation'), 'Grund: stale-valuation (auf priceSalesAsOf gekeyt, nicht fetchedAt)');
});

check('(3b) fehlendes priceSalesAsOf → Datenluecke (kann Freshness nicht verifizieren)', () => {
  const rows = cohortEight(true).map((row) => { row.pit.priceSalesAsOf = null; return row; });
  const r = E.evaluateBoard(mkVintage('semiconductors', DATE, rows), { date: DATE, cfg: cfgTrigger });
  assert.strictEqual(r.tracks.profitable.triggered.length, 0, 'ohne asOf kein Alarm');
  assert.ok(r.tracks.profitable.dataGaps.some((g) => g.reason === 'no-priceSalesAsOf'), 'als Datenluecke ausgewiesen');
});

// ── (6) Skip ─────────────────────────────────────────────────────────────────
check('(6) coverageAxes<voll / fehlende Wachstums-Achsen → uebersprungen + gezaehlt', () => {
  const rows = cohortEight(true);
  rows.push(mkRow('PARTIAL', { evSales: 4, coverageAxes: '6/7', priceSalesAsOf: '2026-07-13T00:00:00.000Z' })); // billigster, aber coverage < voll
  rows.push(mkRow('NOGROW', { evSales: 4, noGrowthLevel: true, priceSalesAsOf: '2026-07-13T00:00:00.000Z' }));  // billigster, aber revGrowthLevel fehlt
  const r = E.evaluateBoard(mkVintage('semiconductors', DATE, rows), { date: DATE, cfg: cfgTrigger });
  const t = r.tracks.profitable;
  const fired = t.triggered.map((c) => c.ticker);
  assert.ok(!fired.includes('PARTIAL'), 'unvollstaendige coverageAxes nie mit Teildaten alarmiert');
  assert.ok(!fired.includes('NOGROW'), 'fehlende Wachstums-Achse nie alarmiert');
  assert.strictEqual(t.skipped.coverage, 1, 'coverage-Skip gezaehlt');
  assert.strictEqual(t.skipped.growthAxes, 1, 'growthAxes-Skip gezaehlt');
});

// ── (4) Dedup/Cooldown (runE1 mit State) ─────────────────────────────────────
check('(4) gleicher Ticker Folgetag unterdrueckt; Austritt + Wiedereintritt feuert wieder', () => {
  const base = mkBase();
  const cfg = { minCohortN: 4, minDwellDays: 0 };   // Dwell 0 → Tag1 feuert; Cooldown greift Tag2
  // Tag 1: CHEAP_HI im untersten Quartil → feuert.
  writeVintage(base, '2026-07-14', 'semiconductors', mkVintage('semiconductors', '2026-07-14', cohortEight(true)));
  const r1 = E.runE1({ baseDir: base, date: '2026-07-14', cfg });
  assert.ok(r1.alerts.some((a) => a.ticker === 'CHEAP_HI'), 'Tag 1 feuert');

  // Tag 2: derselbe Zustand → Cooldown unterdrueckt.
  writeVintage(base, '2026-07-15', 'semiconductors', mkVintage('semiconductors', '2026-07-15', cohortEight(true)));
  const r2 = E.runE1({ baseDir: base, date: '2026-07-15', cfg });
  assert.ok(!r2.alerts.some((a) => a.ticker === 'CHEAP_HI'), 'Tag 2 durch Cooldown unterdrueckt');

  // Tag 3: CHEAP_HI verlaesst das unterste Quartil (evSales hoch) → State-Reset.
  const exitRows = cohortEight(true).map((row) => { if (row.ticker === 'CHEAP_HI') row.pit.evSales = 999; return row; });
  writeVintage(base, '2026-07-16', 'semiconductors', mkVintage('semiconductors', '2026-07-16', exitRows));
  E.runE1({ baseDir: base, date: '2026-07-16', cfg });

  // Tag 4: Wiedereintritt → feuert erneut (Cooldown durch Austritt zurueckgesetzt).
  writeVintage(base, '2026-07-17', 'semiconductors', mkVintage('semiconductors', '2026-07-17', cohortEight(true)));
  const r4 = E.runE1({ baseDir: base, date: '2026-07-17', cfg });
  assert.ok(r4.alerts.some((a) => a.ticker === 'CHEAP_HI'), 'Tag 4 nach Wiedereintritt feuert erneut');
});

// ── (7) Anti-Flacker (Mindest-Verweildauer) ──────────────────────────────────
check('(7) 1-Tages-Blip feuert nicht (Mindest-Verweildauer nicht erfuellt)', () => {
  const base = mkBase();
  const cfg = { minCohortN: 4, minDwellDays: 1 };   // muss 2 aufeinanderfolgende Tage im Quartil sein
  writeVintage(base, '2026-07-14', 'semiconductors', mkVintage('semiconductors', '2026-07-14', cohortEight(true)));
  const r1 = E.runE1({ baseDir: base, date: '2026-07-14', cfg });
  assert.ok(!r1.alerts.some((a) => a.ticker === 'CHEAP_HI'), 'Tag 1 (Verweildauer 0) feuert NICHT');
  writeVintage(base, '2026-07-15', 'semiconductors', mkVintage('semiconductors', '2026-07-15', cohortEight(true)));
  const r2 = E.runE1({ baseDir: base, date: '2026-07-15', cfg });
  assert.ok(r2.alerts.some((a) => a.ticker === 'CHEAP_HI'), 'Tag 2 (Verweildauer erfuellt) feuert');
});

// ── (5) Cap ──────────────────────────────────────────────────────────────────
check('(5) 10 Namen kippen gleichzeitig → hoechstens Cap Zeilen, Rest ausgewiesen', () => {
  const base = mkBase();
  const cfg = { minCohortN: 4, minDwellDays: 0, alertCap: 6 };
  // 40 Namen: 10x evSales=1 (unterstes Quartil, alle Wachstum stark, frisch) + 30x evSales=100.
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(mkRow('LOW' + i, { evSales: 1, glvl: 85, accel: 85, priceSalesAsOf: '2026-07-13T00:00:00.000Z' }));
  for (let i = 0; i < 30; i++) rows.push(mkRow('HIGH' + i, { evSales: 100, priceSalesAsOf: '2026-07-13T00:00:00.000Z' }));
  writeVintage(base, DATE, 'semiconductors', mkVintage('semiconductors', DATE, rows));
  const r = E.runE1({ baseDir: base, date: DATE, cfg });
  assert.strictEqual(r.alerts.length, 6, 'hoechstens Cap (6) Alarm-Zeilen');
  assert.strictEqual(r.suppressedByCap, 4, '10 Kandidaten - 6 Cap = 4 unterdrueckt');
  assert.ok(r.lines.some((l) => /4 weitere.*unterdr/i.test(l)), 'stdout weist "4 weitere unterdrueckt" aus');
});

// ── (8) Offene Punkte explizit (Auflage 10) ──────────────────────────────────
check('(8) Report weist die 2 offenen Punkte EXPLIZIT aus (nicht still defaultet)', () => {
  const base = mkBase();
  writeVintage(base, DATE, 'semiconductors', mkVintage('semiconductors', DATE, cohortEight(true)));
  const r = E.runE1({ baseDir: base, date: DATE, cfg: { minCohortN: 4, minDwellDays: 0 } });
  const ids = r.report.openPoints.map((p) => p.id);
  assert.ok(ids.includes('perzentil-schwelle'), 'offener Punkt: exakte Perzentil-Schwelle Q1-vs-20%');
  assert.ok(ids.includes('fdr-korrektur'), 'offener Punkt: FDR ueber alle 12 Boards');
  assert.ok(r.report.openPoints.every((p) => /offen/i.test(p.status)), 'beide als OFFEN markiert');
  // report wurde als Datei geschrieben (Briefing-Kette konsumiert sie)
  assert.ok(fs.existsSync(path.join(base, 'outputs', 'e1-kompression.json')), 'outputs/e1-kompression.json geschrieben');
});

// ── (9) Eigenhistorie-Uhr + Reifegrad-Etikett ────────────────────────────────
check('(9) Meldesatz nennt EV/Sales + Reifegrad-Label + Tag n, NIE "P/S"', () => {
  const base = mkBase();
  writeVintage(base, DATE, 'semiconductors', mkVintage('semiconductors', DATE, cohortEight(true)));
  const r = E.runE1({ baseDir: base, date: DATE, cfg: { minCohortN: 4, minDwellDays: 0 } });
  assert.strictEqual(r.eigenHistorieDay, 1, 'erste priceSales-Sichtung → Tag 1');
  const line = r.lines.find((l) => /CHEAP_HI/.test(l));
  assert.ok(line, 'Meldezeile vorhanden');
  assert.ok(/EV\/Sales/.test(line), 'nennt EV/Sales');
  assert.ok(!/\bP\/S\b/.test(line), 'nennt NIE P/S');
  assert.ok(/Querschnitt, NICHT Eigenhistorie/i.test(line), 'Pflicht-Reifegrad-Label');
  assert.ok(/Tag 1/.test(line), 'Tag-n-Label');
  assert.ok(/revGrowthLevel/.test(line) && /revAcceleration/.test(line), 'Wachstums-Perzentile ausgewiesen');
});

// ── X5 (T2, Opus-Fund): Reset nur bei ECHTEM Bewertungs-Austritt, nicht bei blosser
// Abwesenheit aus candSet (= cheap UND growthIntact). Vorher resettete JEDE Abwesenheit
// (auch cheap-aber-Wachstum-verfehlt) sofort den Cooldown -> Premature-Refire vor Ablauf
// der 30-Tage-Sperre (Bruch Auflage 5). ──────────────────────────────────────────────────
check('X5: cheap bleibt, Wachstum verfehlt transient -> KEIN Reset, Cooldown haelt (kein Premature-Refire)', () => {
  const base = mkBase();
  const cfg = { minCohortN: 4, minDwellDays: 0, cooldownDays: 30 };
  // Tag 1: CHEAP_HI billig + Wachstum intakt -> feuert, setzt lastAlertDate=Tag1.
  writeVintage(base, '2026-07-14', 'semiconductors', mkVintage('semiconductors', '2026-07-14', cohortEight(true)));
  const r1 = E.runE1({ baseDir: base, date: '2026-07-14', cfg });
  assert.ok(r1.alerts.some((a) => a.ticker === 'CHEAP_HI'), 'Tag 1 feuert');

  // Tag 2: CHEAP_HI bleibt UNVERAENDERT billig (evSales=5, weiterhin unterstes Quartil),
  // verfehlt aber TRANSIENT das Wachstumsgate (glvl/accel unter dem Mindest-Perzentil) ->
  // faellt aus candSet (nicht getriggert), ist aber KEIN Bewertungs-Austritt.
  const missRows = cohortEight(true).map((row) => {
    if (row.ticker === 'CHEAP_HI') { row.axisBreakdown[0].pct = 10; row.axisBreakdown[1].pct = 10; }
    return row;
  });
  writeVintage(base, '2026-07-15', 'semiconductors', mkVintage('semiconductors', '2026-07-15', missRows));
  const r2 = E.runE1({ baseDir: base, date: '2026-07-15', cfg });
  assert.ok(!r2.alerts.some((a) => a.ticker === 'CHEAP_HI'), 'Tag 2: Wachstums-Miss verhindert das Feuern (erwartet)');

  // Tag 3: Wachstum erholt sich, CHEAP_HI weiterhin unveraendert billig -> waere ohne den
  // X5-Fix ein frischer Eintritt (State auf Tag 2 faelschlich resettet) und wuerde SOFORT
  // erneut feuern, nur 2 Tage nach dem Original-Alarm (Tag 1), weit vor den 30 Cooldown-Tagen.
  writeVintage(base, '2026-07-16', 'semiconductors', mkVintage('semiconductors', '2026-07-16', cohortEight(true)));
  const r3 = E.runE1({ baseDir: base, date: '2026-07-16', cfg });
  assert.ok(!r3.alerts.some((a) => a.ticker === 'CHEAP_HI'),
    'Tag 3: Cooldown seit Tag 1 (2 Tage < 30) haelt weiterhin -> KEIN Premature-Refire (X5-Fix)');
});

// Gegen-Test: ein ECHTER Bewertungs-Austritt (evSales steigt ueber die Schwelle) muss den
// Zustand weiterhin zuruecksetzen, damit ein Wiedereintritt frisch feuern darf.
check('X5 Gegen-Test: echter evSales-Austritt resettet weiterhin -> Wiedereintritt feuert wieder', () => {
  const base = mkBase();
  const cfg = { minCohortN: 4, minDwellDays: 0, cooldownDays: 30 };
  writeVintage(base, '2026-07-14', 'semiconductors', mkVintage('semiconductors', '2026-07-14', cohortEight(true)));
  const r1 = E.runE1({ baseDir: base, date: '2026-07-14', cfg });
  assert.ok(r1.alerts.some((a) => a.ticker === 'CHEAP_HI'), 'Tag 1 feuert');

  // Tag 2: CHEAP_HI verlaesst das unterste Quartil ECHT (evSales weit ueber der Schwelle).
  const exitRows = cohortEight(true).map((row) => { if (row.ticker === 'CHEAP_HI') row.pit.evSales = 999; return row; });
  writeVintage(base, '2026-07-15', 'semiconductors', mkVintage('semiconductors', '2026-07-15', exitRows));
  E.runE1({ baseDir: base, date: '2026-07-15', cfg });

  // Tag 3: Wiedereintritt (wieder billig + Wachstum intakt) -> muss trotz 30-Tage-Cooldown
  // seit Tag 1 SOFORT feuern duerfen, weil der echte Austritt den Zustand resettet hat.
  writeVintage(base, '2026-07-16', 'semiconductors', mkVintage('semiconductors', '2026-07-16', cohortEight(true)));
  const r3 = E.runE1({ baseDir: base, date: '2026-07-16', cfg });
  assert.ok(r3.alerts.some((a) => a.ticker === 'CHEAP_HI'), 'Tag 3: echter Austritt resettet -> Wiedereintritt feuert erneut');
});

console.log(fail ? ('\nFAIL: ' + fail + ' Test(s)') : '\nAlle E1-Kompressions-Tests gruen');
process.exit(fail ? 1 : 0);
