// tests/e2-earnings-blowout.test.js — Standalone-Runner (framework-los: assert + process.exit).
// Deckt lib/e2-earnings-blowout.js ab (6.2-E-Ast, Event E2 "Earnings-Blowout, sektor-relativiert").
// Fixtures EINGEBETTET / Temp-Verzeichnis (L4 — keine Abhaengigkeit von echten board-history-Daten).
// Run: node tests/e2-earnings-blowout.test.js
//
// Test-Landkarte:
//   (1)  Trigger          — Blowout im Sektor-Spitzendezil + frischer Report feuert; Trend-Laeufer nicht.
//   (2)  SEKTOR-RELATIV   — DERSELBE absolute Sprung feuert in der schwachen Kohorte und NICHT in der starken.
//   (3)  Boden            — bester unter lauter Schrumpfern (ueber Dezil, unter Boden) feuert NICHT.
//   (4)  Zuordnungs-Gate  — Report 130 Tage nach Quartalsende → Datenluecke, NICHT Alarm.
//   (5)  Ereignis-Fenster — Report 60 Tage alt bzw. in der Zukunft → kein Alarm.
//   (6)  Quartalsreihe    — Halbjahres-/Lueckenmelder → uebersprungen, nie QoQ-verglichen.
//   (7)  Plausi-Deckel    — +500 % QoQ → gezaehlt + Datenluecke, NICHT Alarm.
//   (8)  Dedup            — selbes Quartal am Folgetag stumm; NEUES Quartal feuert; Ruecksprung nicht.
//   (9)  Cap              — mehr Kandidaten als Cap → hoechstens Cap Zeilen + "N weitere".
//   (10) Mindest-N        — Kohorte unter minCohortN → kein Dezil, kein Alarm, lowNGroups.
//   (11) PIT vor Live     — pit.earningsDate schlaegt earnings-calendar.json; Rueckfall wird AUSGEWIESEN.
//   (12) Sperrzone        — das Modul laedt keine Zeile aus src/scoring/ (GQS-00 / F-16).
//   (13) Meldesatz        — nennt den 4Q-Trend und dementiert die Analysten-Ueberraschung.
//   (14) Offene Punkte    — Report weist Saisonalitaet/Kalibrierung/Trefferquote EXPLIZIT aus.
//   (15) Messbarkeit      — fehlendes Verzeichnis → measurable:false + exitCode 1;
//                           Invariante boardFilesSeen === boardsRead + invalidBoards.length.
//   (16) Korrupter State  — vorhandene kaputte Zustandsdatei wirft, statt sie zu ueberschreiben.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../lib/e2-earnings-blowout.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

// ── Fixture-Helfer ───────────────────────────────────────────────────────────
function mkBase() { return fs.mkdtempSync(path.join(os.tmpdir(), 'e2-')); }

const DATE = '2026-08-19';
const Q_END = '2026-06-30';          // juengstes Quartalsende
const REPORT = '2026-08-05';         // 14 Tage vor DATE, 36 Tage nach Q_END → beide Gates gruen

function shiftDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }

// Baut eine Board-Zeile, deren Umsatzreihe GENAU die gewuenschte Trend-Abweichung erzeugt:
// die drei aelteren QoQ-Raten sind alle `trend`, die juengste ist `latest`
// → surprise = latest - median([trend,trend,trend]) = latest - trend.
function mkRow(ticker, opts) {
  opts = opts || {};
  const latest = opts.latest != null ? opts.latest : 0.50;
  const trend = opts.trend != null ? opts.trend : 0.05;
  const qEnd = opts.qEnd || Q_END;
  const gap = opts.gapDays != null ? opts.gapDays : 91;
  const rev = [100];                                   // aeltestes Quartal
  for (let i = 0; i < 3; i++) rev.unshift(rev[0] * (1 + trend));
  rev.unshift(rev[0] * (1 + latest));                  // rev ist jetzt neuestes-zuerst
  const ends = [qEnd];
  const gaps = opts.gaps || [gap, gap, gap, gap];
  for (let i = 0; i < 4; i++) ends.push(shiftDays(ends[ends.length - 1], -gaps[i]));
  const pit = {
    beta: 1.2, evSales: 8, fetchedAt: DATE + 'T06:00:00.000Z',
    revenueQ: opts.revenueQ !== undefined ? opts.revenueQ : rev,
    revenueQEnds: opts.revenueQEnds !== undefined ? opts.revenueQEnds : ends,
    grossProfitQ: null, grossProfitQEnds: null,
    priceSales: 7, priceSalesAsOf: DATE + 'T00:00:00.000Z', marketCap: 1e9,
  };
  if (opts.earningsDate !== undefined) pit.earningsDate = opts.earningsDate;
  if (opts.earningsDateAsOf !== undefined) pit.earningsDateAsOf = opts.earningsDateAsOf;
  if (opts.noPit) return { rank: 1, ticker, track: opts.track || 'profitable', score: 90, coverageAxes: '7/7', axisBreakdown: [], pit: null };
  return { rank: opts.rank || 1, ticker, track: opts.track || 'profitable', score: 90,
    coverageAxes: '7/7', axisBreakdown: [{ key: 'revGrowthLevel', pct: 80, weight: 1.7 }], pit };
}

function mkVintage(board, date, profitable, unprofitable) {
  return { date, board, boardStatus: 'core', cohort: { profitable: profitable || [], unprofitable: unprofitable || [] } };
}
function writeVintage(base, date, board, vintage) {
  const dir = path.join(base, 'board-history', date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, board + '.json'), JSON.stringify(vintage));
}
function writeCalendar(base, map) {
  fs.writeFileSync(path.join(base, 'earnings-calendar.json'), JSON.stringify(map));
}

// Kohorte aus 24 Trend-Laeufern (surprise 0) + benannte Sonderfaelle. 24 >= minCohortN 20,
// das Dezil liegt damit klar bei den Sonderfaellen.
function cohortWith(specials, opts) {
  opts = opts || {};
  const rows = [];
  for (let i = 0; i < (opts.fillers != null ? opts.fillers : 24); i++) {
    rows.push(mkRow('FILL' + i, {
      latest: opts.fillerLatest != null ? opts.fillerLatest : 0.05, trend: 0.05,
      qEnd: opts.qEnd || Q_END,                      // dieselbe Quartals-Kohorte wie der Sonderfall
      earningsDate: opts.earningsDate || REPORT,
    }));
  }
  return rows.concat(specials || []);
}

// Standard-Lauf gegen ein Temp-Repo.
function run(base, extra) {
  return E.runE2(Object.assign({ baseDir: base, date: DATE, noWrite: true,
    statePath: path.join(base, 'state', 'e2-alert-state.json') }, extra || {}));
}

// ── (1) Trigger ──────────────────────────────────────────────────────────────
check('(1) Blowout im Spitzendezil + frischer Report feuert; Trend-Laeufer feuert NICHT', () => {
  const base = mkBase();
  writeVintage(base, DATE, 'semiconductors', mkVintage('semiconductors', DATE,
    cohortWith([mkRow('BOOM', { latest: 0.60, trend: 0.05, earningsDate: REPORT })])));
  const r = run(base);
  const fired = r.alerts.map((a) => a.ticker);
  assert.ok(fired.includes('BOOM'), 'Blowout feuert');
  assert.ok(!fired.some((t) => t.startsWith('FILL')), 'Trend-Laeufer feuern nicht');
  const a = r.alerts.find((x) => x.ticker === 'BOOM');
  assert.strictEqual(a.surprise, 0.55, 'surprise = 60 % - Trend 5 % = 55 pp');
  assert.strictEqual(a.quarterEnd, Q_END, 'gemeldetes Quartal am Alarm');
});

// ── (2) SEKTOR-RELATIVIERUNG — der Kern des Auftrags ─────────────────────────
// Zwei Boards, identischer absoluter Sprung (+40 pp ueber eigenem Trend). Im SCHWACHEN
// Sektor (Peers laufen auf Trend) ist das das Spitzendezil → Alarm. Im STARKEN Sektor
// (alle Peers springen genauso) ist es Mittelmass → kein Alarm. Ohne Sektor-Bezug
// muesste E2 in beiden Boards feuern.
check('(2) sektor-relativiert: derselbe Sprung feuert im schwachen Sektor, NICHT im starken', () => {
  const base = mkBase();
  writeVintage(base, DATE, 'utilities', mkVintage('utilities', DATE,
    cohortWith([mkRow('SAME_A', { latest: 0.45, trend: 0.05, earningsDate: REPORT })])));
  // Starker Sektor: die Peers springen STAERKER (+55 pp) als der Kandidat (+40 pp) — erst
  // damit ist derselbe Sprung dort echtes Mittelmass. (Eine Kohorte, in der ALLE identisch
  // sind, waere degeneriert: das nearest-rank-Perzentil trifft dann jeden.)
  writeVintage(base, DATE, 'semiconductors', mkVintage('semiconductors', DATE,
    cohortWith([mkRow('SAME_B', { latest: 0.45, trend: 0.05, earningsDate: REPORT })],
      { fillerLatest: 0.60 })));
  const r = run(base, { cfg: { alertCap: 50 } });
  const fired = r.alerts.map((a) => a.ticker);
  assert.ok(fired.includes('SAME_A'), 'im schwachen Sektor ist +40 pp das Spitzendezil');
  assert.ok(!fired.includes('SAME_B'), 'im starken Sektor ist derselbe Sprung Mittelmass');
});

// ── (3) Absoluter Boden ──────────────────────────────────────────────────────
check('(3) bester unter lauter Schrumpfern feuert NICHT (Dezil gerissen, Boden nicht)', () => {
  const base = mkBase();
  // Alle Peers schrumpfen (-30 % QoQ gegen Trend -30 %); der Kandidat liegt 10 pp darueber
  // — Spitzendezil ja, aber weit unter dem 25-pp-Boden.
  const rows = [];
  for (let i = 0; i < 24; i++) rows.push(mkRow('SHRINK' + i, { latest: -0.30, trend: -0.30, earningsDate: REPORT }));
  rows.push(mkRow('LESS_BAD', { latest: -0.20, trend: -0.30, earningsDate: REPORT }));
  writeVintage(base, DATE, 'energy', mkVintage('energy', DATE, rows));
  const r = run(base, { cfg: { alertCap: 50 } });
  assert.strictEqual(r.alerts.length, 0, 'kein Alarm ohne echten Sprung');
});

// ── (4) Zuordnungs-Gate Quartal ↔ Report ─────────────────────────────────────
check('(4) Report 130 Tage nach Quartalsende → Datenluecke, NICHT Alarm', () => {
  const base = mkBase();
  // Report frisch (14 Tage her), aber er gehoert zu einem Quartal, das noch gar nicht
  // im Abzug steht: das juengste Quartal endete 130 Tage vor dem Report.
  writeVintage(base, DATE, 'materials', mkVintage('materials', DATE,
    cohortWith([mkRow('STALE', { latest: 0.60, trend: 0.05, qEnd: shiftDays(REPORT, -130), earningsDate: REPORT })],
      { qEnd: shiftDays(REPORT, -130) })));   // Kohorte im SELBEN Quartal, sonst greift lowN statt des Gates
  const r = run(base);
  assert.strictEqual(r.alerts.length, 0, 'kein Alarm auf einem Quartal, das der Report nicht meint');
  const gap = r.dataGaps.find((g) => g.ticker === 'STALE');
  assert.ok(gap && gap.reason === 'quarter-report-mismatch', 'als Datenluecke ausgewiesen, nicht still verschluckt');
  assert.strictEqual(gap.reportLagDays, 130, 'Lag beziffert');
});

// ── (5) Ereignis-Fenster ─────────────────────────────────────────────────────
check('(5) Report 60 Tage alt bzw. in der Zukunft → kein Alarm', () => {
  const base = mkBase();
  writeVintage(base, DATE, 'health-care', mkVintage('health-care', DATE, cohortWith([
    mkRow('OLD', { latest: 0.60, trend: 0.05, qEnd: shiftDays(DATE, -90), earningsDate: shiftDays(DATE, -60) }),
  ], { qEnd: shiftDays(DATE, -90), earningsDate: shiftDays(DATE, -60) })));
  writeVintage(base, DATE, 'utilities', mkVintage('utilities', DATE, cohortWith([
    mkRow('FUTURE', { latest: 0.60, trend: 0.05, earningsDate: shiftDays(DATE, +5) }),
  ])));
  const r = run(base, { cfg: { alertCap: 50 } });
  const fired = r.alerts.map((a) => a.ticker);
  assert.ok(!fired.includes('OLD'), 'alter Report ist kein Ereignis mehr');
  assert.ok(!fired.includes('FUTURE'), 'angekuendigter Report ist noch kein Ereignis');
});

// ── (6) Quartalsreihe muss kontinuierlich sein ───────────────────────────────
check('(6) Halbjahres-/Lueckenmelder wird uebersprungen, nie QoQ-verglichen', () => {
  const base = mkBase();
  // Luecke: 2026-06-30, 2025-12-31, 2025-09-30 … — der erste Abstand ist ein halbes Jahr.
  writeVintage(base, DATE, 'industrials', mkVintage('industrials', DATE,
    cohortWith([mkRow('HALFYEAR', { latest: 0.60, trend: 0.05, gaps: [181, 91, 91, 91], earningsDate: REPORT })])));
  const r = run(base);
  assert.strictEqual(r.alerts.length, 0, 'kein QoQ-Vergleich auf Nicht-Folgequartalen');
  assert.ok(r.skipped.badSeries >= 1, 'als unbrauchbare Quartalsreihe gezaehlt');
  assert.strictEqual(E.surpriseVsOwnTrend([5, 4, 3, 2, 1], ['2026-06-30', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'],
    E.withDefaults({})), null, 'surpriseVsOwnTrend verweigert die Luecken-Reihe direkt');
});

// ── (7) Plausibilitaets-Deckel ───────────────────────────────────────────────
check('(7) +500 % QoQ → gezaehlt + Datenluecke, NICHT Alarm', () => {
  const base = mkBase();
  writeVintage(base, DATE, 'it-services', mkVintage('it-services', DATE,
    cohortWith([mkRow('MERGER', { latest: 5.0, trend: 0.05, earningsDate: REPORT })])));
  const r = run(base);
  assert.strictEqual(r.alerts.length, 0, 'Zukauf/Restatement ist kein operativer Blowout');
  assert.strictEqual(r.skipped.implausible, 1, 'sichtbar gezaehlt');
  assert.ok(r.dataGaps.some((g) => g.ticker === 'MERGER' && g.reason === 'implausible-qoq'), 'als Luecke ausgewiesen');
});

// ── (8) Dedup je Ticker und Quartal ──────────────────────────────────────────
check('(8) selbes Quartal am Folgetag stumm; NEUES Quartal feuert; Ruecksprung feuert nicht', () => {
  const base = mkBase();
  const statePath = path.join(base, 'state', 'e2-alert-state.json');
  // Kohorte UND Sonderfall im selben Quartal — sonst greift lowN statt des Dedups.
  const rows = (qEnd, rep) => cohortWith([mkRow('REPEAT', { latest: 0.60, trend: 0.05, qEnd, earningsDate: rep })],
    { qEnd, earningsDate: rep });
  writeVintage(base, DATE, 'software-comm-services', mkVintage('software-comm-services', DATE, rows(Q_END, REPORT)));
  const r1 = E.runE2({ baseDir: base, date: DATE, statePath });
  assert.ok(r1.alerts.some((a) => a.ticker === 'REPEAT'), 'Tag 1: feuert');

  const d2 = shiftDays(DATE, 1);
  writeVintage(base, d2, 'software-comm-services', mkVintage('software-comm-services', d2, rows(Q_END, REPORT)));
  const r2 = E.runE2({ baseDir: base, date: d2, statePath });
  assert.ok(!r2.alerts.some((a) => a.ticker === 'REPEAT'), 'Tag 2, selbes Quartal: stumm');

  // Neues Quartal gemeldet → darf wieder feuern.
  const d3 = shiftDays(DATE, 95);
  const q3 = shiftDays(Q_END, 92), rep3 = shiftDays(d3, -10);
  writeVintage(base, d3, 'software-comm-services', mkVintage('software-comm-services', d3, rows(q3, rep3)));
  const r3 = E.runE2({ baseDir: base, date: d3, statePath });
  assert.ok(r3.alerts.some((a) => a.ticker === 'REPEAT'), 'neues Quartal feuert wieder');

  // Ruecksprung auf das ALTE Quartal (Datenflackern) darf NICHT feuern.
  const d4 = shiftDays(DATE, 96);
  writeVintage(base, d4, 'software-comm-services', mkVintage('software-comm-services', d4,
    cohortWith([mkRow('REPEAT', { latest: 0.60, trend: 0.05, qEnd: Q_END, earningsDate: shiftDays(d4, -14) })])));
  const r4 = E.runE2({ baseDir: base, date: d4, statePath });
  assert.ok(!r4.alerts.some((a) => a.ticker === 'REPEAT'), 'Ruecksprung auf ein aelteres Quartal feuert nicht');
});

// ── (9) Cap ──────────────────────────────────────────────────────────────────
check('(9) mehr Kandidaten als Cap → hoechstens Cap Alarme, Rest ausgewiesen', () => {
  const base = mkBase();
  const specials = [];
  for (let i = 0; i < 8; i++) specials.push(mkRow('BOOM' + i, { latest: 0.60 + i * 0.05, trend: 0.05, earningsDate: REPORT }));
  // 72 Fueller + 8 Sprunger: nearest-rank p90 aus 80 Namen faellt auf den 72. — damit liegen
  // ALLE acht im Spitzendezil und der Cap hat wirklich etwas zu deckeln.
  writeVintage(base, DATE, 'tech-hardware', mkVintage('tech-hardware', DATE, cohortWith(specials, { fillers: 72 })));
  const r = run(base, { cfg: { alertCap: 3 } });
  assert.strictEqual(r.alerts.length, 3, 'Cap haelt');
  assert.strictEqual(r.suppressedByCap, 5, '5 weitere ausgewiesen');
  assert.ok(r.lines.some((l) => /5 weitere Kandidaten durch Cap/.test(l)), 'Unterdrueckung steht in den Zeilen');
  assert.strictEqual(r.alerts[0].ticker, 'BOOM7', 'staerkster Blowout zuerst');
});

// ── (10) Mindest-N ───────────────────────────────────────────────────────────
check('(10) Kohorte unter minCohortN → kein Dezil, kein Alarm, lowNGroups gesetzt', () => {
  const base = mkBase();
  writeVintage(base, DATE, 'real-estate', mkVintage('real-estate', DATE,
    cohortWith([mkRow('BOOM', { latest: 0.60, trend: 0.05, earningsDate: REPORT })], { fillers: 5 })));
  const r = run(base);
  assert.strictEqual(r.alerts.length, 0, 'kein Perzentil aus 6 Namen');
  assert.ok(r.lowNGroups.length >= 1, 'ausgelassene Kohorte wird ausgewiesen');
});

// ── (11) PIT-Datum vor Live-Kalender, Rueckfall sichtbar ─────────────────────
check('(11) pit.earningsDate schlaegt den Live-Kalender; Rueckfall wird AUSGEWIESEN', () => {
  const base = mkBase();
  writeCalendar(base, { PITWINS: { date: shiftDays(DATE, -300), pulledAt: DATE }, FALLBACK: { date: REPORT, pulledAt: DATE } });
  writeVintage(base, DATE, 'financials', mkVintage('financials', DATE, cohortWith([
    // PITWINS traegt ein frisches PIT-Datum; der Kalender kennt nur ein 300 Tage altes.
    mkRow('PITWINS', { latest: 0.60, trend: 0.05, earningsDate: REPORT, earningsDateAsOf: DATE }),
    // FALLBACK hat KEIN PIT-Datum → Live-Kalender, aber sichtbar etikettiert.
    mkRow('FALLBACK', { latest: 0.60, trend: 0.05 }),
  ])));
  const r = run(base, { cfg: { alertCap: 50 } });
  const pw = r.alerts.find((a) => a.ticker === 'PITWINS');
  const fb = r.alerts.find((a) => a.ticker === 'FALLBACK');
  assert.ok(pw && pw.earningsDateSource === 'pit', 'PIT-Datum gewinnt gegen den Live-Kalender');
  assert.ok(fb && fb.earningsDateSource === 'calendar-live', 'ohne PIT-Feld greift der Kalender');
  assert.ok(/Live-Kalender, nicht PIT/.test(fb.line), 'der Rueckfall steht IM Meldesatz');
  assert.strictEqual(r.report.earningsDateSources['calendar-live'], 1, 'und aggregiert im Report');
});

// ── (12) Sperrzone src/scoring/ ──────────────────────────────────────────────
check('(12) das Modul laedt keine Zeile aus src/scoring/ (GQS-00 / F-16)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'e2-earnings-blowout.js'), 'utf8');
  const requires = (src.match(/require\((['"])([^'"]+)\1\)/g) || []).map((m) => m.replace(/require\(['"]|['"]\)/g, ''));
  assert.deepStrictEqual(requires.sort(), ['./atomic-write.js', './read-json.js', 'fs', 'path'],
    'E2 haengt an genau denselben vier Abhaengigkeiten wie E1 — nichts aus src/scoring/');
  // Der Waechter zielt auf die SACHE, nicht auf ein Schreibmuster: verboten ist der ZUGRIFF
  // im Code, nicht das Wort in der Doku (der Kopf-Kommentar nennt die Sperrzone bewusst).
  // Darum erst Kommentare entfernen, dann pruefen.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/scoring/.test(code), 'kein Code-Verweis auf src/scoring/ ausserhalb der Doku');
});

// ── (13) Meldesatz ───────────────────────────────────────────────────────────
check('(13) Meldesatz nennt den 4Q-Trend und dementiert die Analysten-Ueberraschung', () => {
  const line = E.formatAlertLine({
    ticker: 'ABC', qoqLatest: 0.60, trendQoq: 0.05, surprise: 0.55, surpriseThreshold: 0.25,
    board: 'semiconductors', track: 'profitable', quarterEnd: Q_END, cohortN: 25,
    reportAgeDays: 14, earningsDateSource: 'pit',
  });
  assert.ok(/4Q-Trend/.test(line), 'die Bezugsgroesse steht drin');
  assert.ok(/KEINE Analysten-Ueberraschung/.test(line), 'die Kennzahl wird nicht als Analysten-Surprise verkauft');
  assert.ok(/Sektor-Spitzendezil semiconductors\/profitable Quartal 2026-06-30/.test(line), 'Sektor-Bezug + Quartal genannt');
  assert.ok(/Report vor 14 Tagen/.test(line), '"Warum jetzt" steht im selben Satz');
});

// ── (14) Offene Punkte ───────────────────────────────────────────────────────
check('(14) Report weist die offenen Punkte EXPLIZIT aus', () => {
  const ids = E.openPoints(E.withDefaults({})).map((o) => o.id).sort();
  assert.deepStrictEqual(ids, ['saisonalitaet', 'schwellen-kalibrierung', 'trefferquote'],
    'Saisonalitaet, Schwellen-Kalibrierung und Trefferquote stehen offen im Report');
});

// ── (15) Messbarkeit ─────────────────────────────────────────────────────────
check('(15) fehlendes Verzeichnis → measurable:false + exitCode 1; Datei-Invariante haelt', () => {
  const base = mkBase();
  const leer = run(base);
  assert.strictEqual(leer.measurable, false, 'ohne Boards ist nichts messbar');
  assert.strictEqual(leer.exitCode, 1, 'und der Lauf ist rot, nicht still gruen');

  const dir = path.join(base, 'board-history', DATE);
  fs.mkdirSync(dir, { recursive: true });
  writeVintage(base, DATE, 'utilities', mkVintage('utilities', DATE, cohortWith([])));
  fs.writeFileSync(path.join(dir, 'kaputt.json'), '{nicht json');
  fs.writeFileSync(path.join(dir, 'leer.json'), 'null');
  const r = run(base);
  assert.strictEqual(r.report.boardFilesSeen, r.report.boardsRead + r.invalidBoards.length,
    'jede gesehene Datei landet in genau EINEM Topf');
  assert.strictEqual(r.invalidBoards.length, 2, 'kaputte und leere Datei beide als unbrauchbar gemeldet');
});

// ── (16) Korrupter State ─────────────────────────────────────────────────────
check('(16) vorhandene kaputte Zustandsdatei wirft, statt sie zu ueberschreiben', () => {
  const base = mkBase();
  writeVintage(base, DATE, 'utilities', mkVintage('utilities', DATE, cohortWith([])));
  const statePath = path.join(base, 'state', 'e2-alert-state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, '{kaputt');
  assert.throws(() => E.runE2({ baseDir: base, date: DATE, statePath }), /unlesbar|vorhanden/i,
    'ein kaputter Bestand ist KEINE Erstanlage');
  assert.strictEqual(fs.readFileSync(statePath, 'utf8'), '{kaputt', 'und wird nicht ueberschrieben');
});

console.log(fail === 0 ? 'e2-earnings-blowout: alle Pruefungen gruen' : 'e2-earnings-blowout: ' + fail + ' FEHLER');
process.exit(fail ? 1 : 0);
