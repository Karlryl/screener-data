// tests/board-history.test.js — Standalone-Runner (framework-los: assert + process.exit).
// Deckt scripts/write-board-history.js (Masterplan 2.3 Vintage-Writer) ab:
//   (a) Vintage-Schreibpfad + §7-PIT-Felder + pitCoverage (A9)
//   (b) Wert-Gate: künstlich wertfalsches Folge-Vintage → suspect:true + exit 2
//   (c) Backdate-Fixture: --compact greift, Archiv-Kopie existiert, Kern bleibt, PIT gestrippt (A12)
//   (d) _excluded-Gerüst wird angelegt (Writer schreibt nie Einträge)
//   (e) picks-history unberührt (Verzeichnis-Diff vor/nach) + assertNoPicksHistory-Guard
// Fixtures sind EINGEBETTET (L4 — keine Abhängigkeit von echten snapshots/outputs).
// Run: node tests/board-history.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../scripts/write-board-history.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

// ── Fixture-Helfer ───────────────────────────────────────────────────────────
function mkBase() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-'));
  fs.mkdirSync(path.join(base, 'outputs', 'hypergrowth', 'full'), { recursive: true });
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });
  return base;
}
function writeJson(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); }

// Snapshot mit voller Kontroll-Feld-Ausstattung (Beta/EV-Sales/priceSales/GM + Serien + Enden).
function snapFull(ticker, opts) {
  opts = opts || {};
  return {
    meta: { ticker, fetchedAt: '2026-07-10T12:00:00.000Z', asOf: '2026-07-13T06:00:00.000Z' },
    metrics: {
      beta: opts.noBeta ? null : { value: 1.5 },
      enterpriseToRevenue: { value: 8.2 },
      priceSales: { value: 10.0, asOf: '2026-07-09T00:00:00.000Z' },  // asOf = echter Bewertungs-Zeitstempel (E1 Option B)
      grossMargin: { value: 50.0 },   // → priceGrossProfit = 10/0.5 = 20
    },
    timeseries: {
      revenueQ: [{ value: 120 }, { value: 110 }, { value: 100 }],
      grossProfitQ: [{ value: 60 }, { value: 55 }, { value: 50 }],
      // revenueQEnds nur wenn opts.withEnds (A10: kommt parallel via pull-yahoo)
      ...(opts.withEnds ? { revenueQEnds: ['2026-04-30', '2026-01-31', '2025-10-31'], grossProfitQEnds: ['2026-04-30', '2026-01-31', '2025-10-31'] } : {}),
    },
  };
}
// Board-Zeile in Board-JSON-Form (wie outputs/hypergrowth/full/<board>.json).
function row(ticker, score) {
  return {
    ticker, score, track: 'profitable',
    scoreBase: score - 1, scoreShrunk: score - 0.5, coverageAxes: '7/7',
    lamps: ['x'], axisBreakdown: [{ key: 'revGrowthLevel', pct: 80, weight: 1.7 }],
  };
}
function writeBoard(base, board, rows) {
  writeJson(path.join(base, 'outputs', 'hypergrowth', 'full', board + '.json'), { profitable: rows, unprofitable: [] });
}
function readVintage(base, date, board) {
  return JSON.parse(fs.readFileSync(path.join(base, 'board-history', date, board + '.json'), 'utf8'));
}

// ── (a) Vintage-Schreibpfad + §7-PIT + pitCoverage ───────────────────────────
check('(a) schreibt Vintage mit §7-PIT-Feldern + pitCoverage + boardStatus', () => {
  const base = mkBase();
  // 3 Namen: ABC voll (mit Enden), DEF ohne Beta (Missing-Beta-Regel), GHI ohne Snapshot.
  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC', { withEnds: true }));
  writeJson(path.join(base, 'snapshots', 'DEF.json'), snapFull('DEF', { noBeta: true }));
  // GHI: kein Snapshot → pit null + pitGaps snapshot-missing
  writeBoard(base, 'semiconductors', [row('ABC', 90), row('DEF', 80), row('GHI', 70)]);
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: '2026-07-13T20:00:00Z' });

  const res = W.run({ baseDir: base, date: '2026-07-13' });
  assert.strictEqual(res.exitCode, 0, 'exit 0 ohne suspect');
  const v = readVintage(base, '2026-07-13', 'semiconductors');

  assert.strictEqual(v.date, '2026-07-13');
  assert.strictEqual(v.board, 'semiconductors');
  assert.strictEqual(v.boardStatus, 'core');          // semiconductors ist ein core-Board
  assert.strictEqual(v.formulaVersion, 'calibration/v4');
  assert.strictEqual(v.cohortCount.profitable, 3);

  const abc = v.cohort.profitable[0];
  assert.strictEqual(abc.ticker, 'ABC');
  assert.strictEqual(abc.rank, 1);
  // §7-Kontroll-Felder present:
  assert.strictEqual(abc.pit.beta, 1.5);
  assert.strictEqual(abc.pit.evSales, 8.2);
  assert.strictEqual(abc.pit.priceGrossProfit, 20);   // 10 / (50/100)
  assert.strictEqual(abc.pit.fetchedAt, '2026-07-10T12:00:00.000Z');
  assert.deepStrictEqual(abc.pit.revenueQ, [120, 110, 100]);
  assert.deepStrictEqual(abc.pit.revenueQEnds, ['2026-04-30', '2026-01-31', '2025-10-31']);

  const def = v.cohort.profitable[1];
  assert.strictEqual(def.pit.beta, null, 'Missing-Beta-Regel: fehlende Beta explizit null');
  assert.strictEqual(def.pit.evSales, 8.2);

  const ghi = v.cohort.profitable[2];
  assert.strictEqual(ghi.pit, null, 'kein Snapshot → pit null');
  assert.ok(v.pitGaps.includes('snapshot-missing'), 'pitGaps notiert fehlenden Snapshot');
  assert.ok(v.pitGaps.includes('grossProfitQEnds-missing'), 'pitGaps notiert fehlende Enden (DEF/GHI)');

  // pitCoverage: beta present bei 1/3 (nur ABC), evSales bei 2/3.
  assert.ok(Math.abs(v.pitCoverage.beta - 1 / 3) < 1e-9, 'beta-Coverage 1/3');
  assert.ok(Math.abs(v.pitCoverage.evSales - 2 / 3) < 1e-9, 'evSales-Coverage 2/3');
  assert.strictEqual(v.gate.calibrating, true, 'Vintage #1 ist Kalibrierphase');

  // Seiten-Artefakte:
  assert.ok(fs.existsSync(path.join(base, 'board-history', '2026-07-13', 'calibration.json')), 'calibration-Kopie');
  assert.ok(fs.existsSync(path.join(base, 'board-history', '2026-07-13', 'regime.json')), 'regime.json');
});

// ── (a2) E1 Option B: pit trägt priceSales + priceSalesAsOf ADDITIV ───────────
// Court 2026-07-17 (PASS_MIT_AUFLAGEN, Auflage 4): buildPit schreibt echtes P/S MIT
// asOf mit — rein additiv, evSales (und alle Bestandsfelder) bleiben byte-identisch.
check('(a2) E1 Option B: buildPit trägt priceSales/priceSalesAsOf additiv, evSales byte-identisch', () => {
  const base = mkBase();
  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC', { withEnds: true }));
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  writeBoard(base, 'semiconductors', [row('ABC', 90)]);
  W.run({ baseDir: base, date: '2026-07-13' });
  const abc = readVintage(base, '2026-07-13', 'semiconductors').cohort.profitable[0];

  // Neue Felder present:
  assert.strictEqual(abc.pit.priceSales, 10.0, 'priceSales aus metrics.priceSales.value');
  assert.strictEqual(abc.pit.priceSalesAsOf, '2026-07-09T00:00:00.000Z', 'priceSalesAsOf = echte Bewertungs-asOf');
  // Bestandsfeld unverändert (byte-identisch für Bestandsleser):
  assert.strictEqual(abc.pit.evSales, 8.2, 'evSales unverändert');
  // Additiv = neue Keys am ENDE (Bestands-Serialisierung bleibt bit-stabil bis grossProfitQEnds).
  // audit/fix (Hard-Review R4-SCR-02): marketCap ist seitdem additiv NACH priceSalesAsOf angehängt
  // (screener-formel-ledger.md §4a Size-Regressor) -- priceSales/priceSalesAsOf ruecken um 1 nach vorn,
  // bleiben aber selbst weiterhin ein zusammenhaengendes additives Paar, evSales unveraendert an Index 1.
  const keys = Object.keys(abc.pit);
  assert.strictEqual(keys[keys.length - 3], 'priceSales', 'priceSales angehängt');
  assert.strictEqual(keys[keys.length - 2], 'priceSalesAsOf', 'priceSalesAsOf danach');
  assert.strictEqual(keys[keys.length - 1], 'marketCap', 'marketCap zuletzt (R4-SCR-02)');
  assert.strictEqual(keys.indexOf('evSales'), 1, 'evSales behält seine Position (byte-additiv)');

  // Fehlendes priceSales → beide Felder null (kein Crash, LOSS-/GM0-robust):
  writeJson(path.join(base, 'snapshots', 'NOPS.json'),
    { meta: { fetchedAt: 't' }, metrics: { enterpriseToRevenue: { value: 3 } }, timeseries: {} });
  writeBoard(base, 'semiconductors', [row('NOPS', 70)]);
  W.run({ baseDir: base, date: '2026-07-14' });
  const nops = readVintage(base, '2026-07-14', 'semiconductors').cohort.profitable[0];
  assert.strictEqual(nops.pit.priceSales, null, 'kein priceSales → null');
  assert.strictEqual(nops.pit.priceSalesAsOf, null, 'kein asOf → null');
});

// ── (a2b) R4-SCR-02: marketCap wird als Size-Regressor ins PIT geschrieben ──
// screener-formel-ledger.md §4a fixiert die Regressor-Liste 'Size (log-MarketCap), Markt-Beta,
// 1-2 Bewertungs-Proxys' -- buildPit() lieferte bisher KEIN marketCap-Feld.
check('(a2b) R4-SCR-02: buildPit trägt marketCap additiv (Size-Regressor), fehlend → null', () => {
  const base = mkBase();
  const withMcap = snapFull('ABC', { withEnds: true });
  withMcap.marketCap = { value: 31756744704 };
  writeJson(path.join(base, 'snapshots', 'ABC.json'), withMcap);
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  writeBoard(base, 'semiconductors', [row('ABC', 90)]);
  W.run({ baseDir: base, date: '2026-07-13' });
  const abc = readVintage(base, '2026-07-13', 'semiconductors').cohort.profitable[0];
  assert.strictEqual(abc.pit.marketCap, 31756744704, 'marketCap aus snap.marketCap.value');

  // Fehlendes marketCap → null (kein Crash).
  writeJson(path.join(base, 'snapshots', 'NOMC.json'), snapFull('NOMC', {}));
  writeBoard(base, 'semiconductors', [row('NOMC', 70)]);
  W.run({ baseDir: base, date: '2026-07-14' });
  const nomc = readVintage(base, '2026-07-14', 'semiconductors').cohort.profitable[0];
  assert.strictEqual(nomc.pit.marketCap, null, 'kein snap.marketCap → null');
});
// ── (a3) bh-null-ends (T2): leere/all-null Perioden-Enden gelten als ABSENT ──
// Vorher: ts.revenueQEnds/grossProfitQEnds wurde nur gegen != null geprüft. Ein
// FTS-Cache-Treffer vor A10 liefert [] (leer) oder [null,null,null] (Serie ohne
// echtes Datum) — beides ist truthy != null und wurde fälschlich als "vorhanden"
// durchgewunken: kein pitGaps-Vermerk, pitCoverageBlock zählte es present.
// Karl-Semantik (freigegeben): present = mindestens EIN gültiges (nicht-null) Ende.
check('(a3) bh-null-ends: leeres/all-null revenueQEnds/grossProfitQEnds zaehlt als absent', () => {
  const base = mkBase();
  const snap = snapFull('XYZ', { withEnds: true });
  snap.timeseries.revenueQEnds = [];                 // leer (FTS-Cache-Treffer vor A10)
  snap.timeseries.grossProfitQEnds = [null, null, null]; // all-null (Serie ohne Datum)
  writeJson(path.join(base, 'snapshots', 'XYZ.json'), snap);
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  writeBoard(base, 'semiconductors', [row('XYZ', 90)]);
  W.run({ baseDir: base, date: '2026-07-13' });
  const v = readVintage(base, '2026-07-13', 'semiconductors');
  const xyz = v.cohort.profitable[0];

  assert.strictEqual(xyz.pit.revenueQEnds, null, '[] zaehlt als absent, nicht als vorhandene leere Serie');
  assert.strictEqual(xyz.pit.grossProfitQEnds, null, '[null,null,null] zaehlt als absent');
  assert.ok(v.pitGaps.includes('revenueQEnds-missing'), 'pitGaps notiert das leere revenueQEnds');
  assert.ok(v.pitGaps.includes('grossProfitQEnds-missing'), 'pitGaps notiert das all-null grossProfitQEnds');
  assert.strictEqual(v.pitCoverage.revenueQEnds, 0, 'Coverage zaehlt die leere Serie als absent (0/1)');
  assert.strictEqual(v.pitCoverage.grossProfitQEnds, 0, 'Coverage zaehlt die all-null Serie als absent (0/1)');
  // andere Achsen bleiben unberuehrt (kein Nebeneffekt der Normalisierung):
  assert.strictEqual(xyz.pit.beta, 1.5, 'beta unberuehrt');
  assert.strictEqual(xyz.pit.evSales, 8.2, 'evSales unberuehrt');
  assert.deepStrictEqual(xyz.pit.revenueQ, [120, 110, 100], 'revenueQ-Werte unberuehrt');
});

// ── (b) Wert-Gate: wertfalsches Folge-Vintage → suspect + exit 2 ──────────────
check('(b) wertfalsches Folge-Vintage → suspect:true + exit 2', () => {
  const base = mkBase();
  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC', { withEnds: true }));
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });

  // Tag 1: normales Vintage.
  writeBoard(base, 'semiconductors', [row('ABC', 90)]);
  const r1 = W.run({ baseDir: base, date: '2026-07-13' });
  assert.strictEqual(r1.exitCode, 0);

  // Schwelle künstlich einfrieren (simuliert abgeschlossene Kalibrierphase, Ledger P99×2).
  writeJson(path.join(base, 'board-history', '_gate-calibration.json'),
    { _doc: 'test', boards: { semiconductors: { dailyP99Samples: [0.5, 0.4, 0.5], threshold: 1.0, frozen: true } } });

  // Tag 2: Score springt um +40 (>> Schwelle 1.0) = wertfalsch.
  writeBoard(base, 'semiconductors', [row('ABC', 130)]);
  const r2 = W.run({ baseDir: base, date: '2026-07-14' });
  assert.strictEqual(r2.exitCode, 2, 'exit 2 bei suspect');
  const v2 = readVintage(base, '2026-07-14', 'semiconductors');
  assert.strictEqual(v2.gate.suspect, true, 'suspect-Flag gesetzt');
  assert.strictEqual(v2.gate.calibrating, false, 'nicht mehr in Kalibrierphase (Schwelle frozen)');
  assert.ok(v2.gate.reasons.includes('p99-delta-exceeds-threshold'), 'Grund: Schwellen-Bruch');
  // NIE still: das suspect-Vintage wird trotzdem GESCHRIEBEN (keine Löschung).
  assert.ok(fs.existsSync(path.join(base, 'board-history', '2026-07-14', 'semiconductors.json')));
});

check('(b2) NaN-Einbruch → suspect auch in Kalibrierphase', () => {
  const base = mkBase();
  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC', { withEnds: true }));
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  writeBoard(base, 'semiconductors', [row('ABC', 90)]);
  W.run({ baseDir: base, date: '2026-07-13' });
  // Tag 2: Score wird NaN/null (Datenbruch).
  writeBoard(base, 'semiconductors', [{ ...row('ABC', 90), score: null }]);
  const r2 = W.run({ baseDir: base, date: '2026-07-14' });
  assert.strictEqual(r2.exitCode, 2, 'exit 2 bei NaN-Einbruch');
  const v2 = readVintage(base, '2026-07-14', 'semiconductors');
  assert.ok(v2.gate.reasons.includes('nan-break'), 'nan-break auch trotz calibrating');
});

// ── (c) Backdate → --compact greift, Archiv-Kopie, Kern bleibt, PIT gestrippt ─
check('(c) --compact archiviert + strippt Vintages älter als t0+2Q', () => {
  const base = mkBase();
  const RET = W._const.RETENTION_DAYS;
  // Backdate-Vintage: RET+10 Tage vor heute.
  const today = '2026-07-13';
  const oldMs = new Date(today + 'T00:00:00Z').getTime() - (RET + 10) * 86400000;
  const oldDate = new Date(oldMs).toISOString().slice(0, 10);
  const oldVintage = {
    date: oldDate, board: 'semiconductors', boardStatus: 'core', compacted: false,
    cohort: { profitable: [{ rank: 1, ticker: 'ABC', score: 90, scoreBase: 89, pit: { beta: 1.5, revenueQ: [120, 110] } }], unprofitable: [] },
  };
  writeJson(path.join(base, 'board-history', oldDate, 'semiconductors.json'), oldVintage);

  const res = W.run({ baseDir: base, compact: true, date: today });
  assert.strictEqual(res.exitCode, 0);
  assert.ok(res.compacted.length >= 1, 'mindestens 1 Vintage kompaktiert');

  // Archiv-Kopie existiert MIT vollem PIT (GG7c, außerhalb board-history/).
  const archived = JSON.parse(fs.readFileSync(path.join(base, 'board-history-archive', oldDate, 'semiconductors.json'), 'utf8'));
  assert.ok(archived.cohort.profitable[0].pit, 'Archiv trägt vollen PIT-Snapshot');
  assert.strictEqual(archived.cohort.profitable[0].pit.beta, 1.5);

  // Kern-Version: pit gestrippt, rank/score bleiben.
  const lean = readVintage(base, oldDate, 'semiconductors');
  assert.strictEqual(lean.compacted, true);
  assert.strictEqual(lean.cohort.profitable[0].pit, undefined, 'PIT aus Kern-Version entfernt');
  assert.strictEqual(lean.cohort.profitable[0].score, 90, 'Score bleibt');
  assert.strictEqual(lean.cohort.profitable[0].rank, 1, 'Rang bleibt');
  assert.ok(lean.archivedTo && lean.archivedTo.includes('board-history-archive'), 'Verweis auf Archiv');
});

check('(c2) frische Vintages (jünger als t0+2Q) bleiben von --compact unberührt', () => {
  const base = mkBase();
  const today = '2026-07-13';
  const recent = new Date(new Date(today + 'T00:00:00Z').getTime() - 30 * 86400000).toISOString().slice(0, 10);
  writeJson(path.join(base, 'board-history', recent, 'semiconductors.json'),
    { date: recent, board: 'semiconductors', compacted: false, cohort: { profitable: [{ rank: 1, ticker: 'ABC', score: 90, pit: { beta: 1.5 } }], unprofitable: [] } });
  const res = W.run({ baseDir: base, compact: true, date: today });
  assert.strictEqual(res.compacted.length, 0, 'nichts kompaktiert');
  const v = readVintage(base, recent, 'semiconductors');
  assert.ok(v.cohort.profitable[0].pit, 'PIT bleibt bei frischem Vintage');
});

// ── (d) _excluded-Gerüst ─────────────────────────────────────────────────────
// ── (d0) Ausgeschlossene Vintages sind KEINE Vergleichsbasis ─────────────────
// Realfall aus Lauf 30217057400 (26.07.2026): nach dem Massstab-Bruch (Tag 437/438) stehen
// die Vintages bis 18.07. in _excluded.json. Das Wert-Gate verglich das erste neue Vintage
// trotzdem gegen den 18.07., meldete das erwartete grosse Tagesdelta -> suspect -> rc=2 ->
// der Commit-Schritt nimmt genau dieses Vintage vom Commit aus. Damit landet es NIE in main,
// der 18.07. bleibt auch morgen der juengste Vorgaenger, und der Lauf waere ab dann JEDEN TAG
// rot, ohne dass sich etwas aendern koennte. Dieser Test haelt den Ausweg fest.
check('(d0) priorVintageDate ueberspringt global ausgeschlossene Vintages', () => {
  const base = mkBase();
  W._setPaths(base);
  try {
    const hist = path.join(base, 'board-history');
    for (const d of ['2026-07-17', '2026-07-18', '2026-07-20']) {
      fs.mkdirSync(path.join(hist, d), { recursive: true });
      writeJson(path.join(hist, d, 'semiconductors.json'), { date: d, board: 'semiconductors' });
    }
    // Ohne Ausschluesse: juengster Vorgaenger von 2026-07-21 ist der 20.07.
    writeJson(path.join(hist, '_excluded.json'), { _doc: 'test', excluded: [] });
    assert.strictEqual(W.priorVintageDate('2026-07-21'), '2026-07-20');

    // 20.07. global ausgeschlossen -> der 18.07. rueckt nach.
    writeJson(path.join(hist, '_excluded.json'), { _doc: 'test', excluded: [{ date: '2026-07-20', board: null, reason: 'Massstab' }] });
    assert.strictEqual(W.priorVintageDate('2026-07-21'), '2026-07-18');

    // ALLE ausgeschlossen -> kein vergleichbarer Vorgaenger. Genau das beendet das Dauer-Rot:
    // das Gate straft dann nicht, sondern sammelt (wie beim allerersten Vintage).
    writeJson(path.join(hist, '_excluded.json'), {
      _doc: 'test',
      excluded: ['2026-07-17', '2026-07-18', '2026-07-20'].map((date) => ({ date, board: null, reason: 'Massstab' })),
    });
    assert.strictEqual(W.priorVintageDate('2026-07-21'), null);

    // Ein BOARD-ENGER Ausschluss darf den Tag NICHT als Ganzes entwerten.
    writeJson(path.join(hist, '_excluded.json'), { _doc: 'test', excluded: [{ date: '2026-07-20', board: 'semiconductors', reason: 'nur dieses Board' }] });
    assert.strictEqual(W.priorVintageDate('2026-07-21'), '2026-07-20');

    // Fehlende Ausschlussdatei -> Verhalten wie bisher, kein Absturz.
    fs.rmSync(path.join(hist, '_excluded.json'));
    assert.strictEqual(W.priorVintageDate('2026-07-21'), '2026-07-20');
  } finally {
    W._setPaths(null);
  }
});

check('(d) legt _excluded.json-Gerüst an (leer), Writer schreibt nie Einträge', () => {
  const base = mkBase();
  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC', { withEnds: true }));
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  writeBoard(base, 'semiconductors', [row('ABC', 90)]);
  W.run({ baseDir: base, date: '2026-07-13' });
  const ex = JSON.parse(fs.readFileSync(path.join(base, 'board-history', '_excluded.json'), 'utf8'));
  assert.deepStrictEqual(ex.excluded, [], 'Gerüst ist leer');
  assert.ok(/rank-ic/i.test(ex._doc), 'Doku verweist auf rank-ic als Konsument');
});

// ── AX-SK-001 (Hard Review 2026-07-31): ein KAPUTTES _excluded.json/_gate-
//    calibration.json darf NICHT stillschweigend wie "fehlt" behandelt und durch
//    ein leeres Geruest ersetzt werden — das loescht eine von Hand gepflegte
//    Ausschlussliste bzw. setzt eingefrorene Gate-Schwellen zurueck, ohne dass es
//    im Lauf sichtbar wird. readJsonOrNull() kollabierte Datei-, Rechte- und
//    JSON-Parsefehler bisher alle zu null — genau wie eine echte Abwesenheit.
check('(d1) AX-SK-001: kaputtes _excluded.json wird NICHT still durch ein leeres Geruest ersetzt', () => {
  const base = mkBase();
  W._setPaths(base);
  try {
    const hist = path.join(base, 'board-history');
    fs.mkdirSync(hist, { recursive: true });
    fs.writeFileSync(path.join(hist, '_excluded.json'), '{ acht Eintraege kaputt am Ende...');
    assert.throws(() => W.readOrScaffoldExcluded(false), /unlesbar|invalid JSON|kaputt/i,
      'ein korruptes _excluded.json muss den Lauf hart stoppen, nicht scaffolden');
    const stillCorrupt = fs.readFileSync(path.join(hist, '_excluded.json'), 'utf8');
    assert.ok(stillCorrupt.includes('kaputt'), 'die kaputte Datei darf NICHT ueberschrieben worden sein');
  } finally {
    W._setPaths(null);
  }
});
check('(d2) AX-SK-001: eine wirklich fehlende _excluded.json scaffoldet weiterhin normal (Gegenprobe)', () => {
  const base = mkBase();
  W._setPaths(base);
  try {
    const excl = W.readOrScaffoldExcluded(false);
    assert.deepStrictEqual(excl.excluded, [], 'echte Abwesenheit bleibt ein harmloses leeres Geruest');
  } finally {
    W._setPaths(null);
  }
});

// ── (e) picks-history unberührt ──────────────────────────────────────────────
check('(e) picks-history bleibt byte-identisch (Verzeichnis-Diff vor/nach)', () => {
  const base = mkBase();
  // picks-history mit einer Datei simulieren.
  const ph = path.join(base, 'picks-history');
  writeJson(path.join(ph, '2026-07-02.json'), { frozen: true, picks: [1, 2, 3] });
  const before = fs.readFileSync(path.join(ph, '2026-07-02.json'), 'utf8');
  const beforeList = fs.readdirSync(ph).sort();

  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC', { withEnds: true }));
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  writeBoard(base, 'semiconductors', [row('ABC', 90)]);
  W.run({ baseDir: base, date: '2026-07-13' });

  const afterList = fs.readdirSync(ph).sort();
  const after = fs.readFileSync(path.join(ph, '2026-07-02.json'), 'utf8');
  assert.deepStrictEqual(afterList, beforeList, 'picks-history-Verzeichnis unverändert');
  assert.strictEqual(after, before, 'picks-history-Datei byte-identisch');
});

check('(e2) assertNoPicksHistory blockt jeden picks-history-Pfad strukturell', () => {
  assert.throws(() => W.assertNoPicksHistory('/x/picks-history/2026.json'), /picks-history/);
  assert.throws(() => W.assertNoPicksHistory('picks-history\\a.json'), /picks-history/);
  // Nicht-picks-history-Pfad geht durch:
  assert.strictEqual(W.assertNoPicksHistory('/x/board-history/2026.json'), '/x/board-history/2026.json');
});

// ── Gate-Kalibrierungs-Mechanik (Unit) ───────────────────────────────────────
// UMGESTELLT mit der Gate-Neukalibrierung (03.08.2026): hiess vorher „nach 3 Samples =
// max×2". Beide Zahlen sind bewusst gefallen — 3 Stichproben haben nachweislich 8 von 13
// Schwellen falsch gesetzt, und das MAXIMUM liess einen einzelnen Bruchtag die Schwelle
// allein bestimmen (it-services 40,2 aus [0,0,0,0,0,20,1]). Die Zusicherung selbst ist
// unveraendert: N-1 friert nicht ein, N friert ein, danach aendert nichts mehr die Schwelle.
check('updateGateCalibration friert erst nach CALIBRATION_SAMPLES Stichproben ein', () => {
  const N = W._const.CALIBRATION_SAMPLES;
  const BODEN = W._const.MIN_GATE_THRESHOLD;
  const gc = { boards: {} };
  for (let i = 0; i < N - 1; i++) W.updateGateCalibration(gc, 'b', BODEN, '2026-01-' + String(i + 1).padStart(2, '0'));
  assert.strictEqual(gc.boards.b.frozen, false, 'nach N-1 Samples noch nicht frozen');
  W.updateGateCalibration(gc, 'b', BODEN, '2026-02-01');
  assert.strictEqual(gc.boards.b.frozen, true, 'nach N Samples frozen');
  assert.strictEqual(gc.boards.b.threshold, 2 * BODEN, 'Schwelle = Quantil der Messungen × 2 (ueber dem Boden, also aus Messwerten)');
  // Nach frozen keine weiteren Samples:
  W.updateGateCalibration(gc, 'b', 999, '2026-02-02');
  assert.strictEqual(gc.boards.b.threshold, 2 * BODEN, 'Schwelle bleibt eingefroren');
});

// ── R3 Fund #3: degeneriertes Kalibrierfenster friert NICHT ein ──────────────
// Ersetzt die R2.13-Tests (f1)/(f2)/(f3), die den Boden als Antwort auf bewegungslose
// Fenster festschrieben. Der Boden war Übertünchung: er erfand eine Schwelle für ein
// Board, das nie gemessen wurde. Neue Regel: ohne Bewegung keine Schwelle.

// VORHER ROT: updateGateCalibration fror nach 3 Samples IMMER ein — bei 3× 0 mit
// threshold 0 (vor Tag 325) bzw. mit dem Boden 1.0 (nach Tag 325). Beides ist eine
// Schwelle aus null echten Messwerten. Erwartet ist jetzt: gar nicht einfrieren.
check('(f1) bewegungsloses Kalibrierfenster → NICHT frozen, sammelt weiter', () => {
  const gc = { boards: {} };
  W.updateGateCalibration(gc, 'energy', 0);
  W.updateGateCalibration(gc, 'energy', 0);
  W.updateGateCalibration(gc, 'energy', 0);
  assert.strictEqual(gc.boards.energy.frozen, false, '3× Delta 0 kalibriert nichts → nicht frozen');
  assert.strictEqual(gc.boards.energy.threshold, null, 'keine erfundene Schwelle (weder 0 noch Boden)');
  // Messwerte bleiben roh — es wird nichts gefälscht, nur nichts abgeleitet.
  assert.deepStrictEqual(gc.boards.energy.dailyP99Samples, [0, 0, 0], 'Messreihe unverändert');
  // Ein degenerierter Zustand ist auch für den Lese-Weg keine Schwelle:
  assert.strictEqual(W.frozenThresholdOf({ dailyP99Samples: [0, 0, 0], threshold: 0, frozen: true }), null,
    'Laufzeit-Heilung: frozen:true mit threshold 0 gilt als nicht eingefroren');
});

// VORHER ROT: das Board war nach dem 3. Null-Sample frozen, das 4. Sample (die erste echte
// Bewegung) wurde verworfen → threshold blieb der Boden 1.0 statt der gemessenen 2*2=4.
check('(f2) EINE Bewegung im Null-Fenster friert nichts ein — erst eine bewegte Messreihe tut es', () => {
  const N = W._const.CALIBRATION_SAMPLES;
  const BODEN = W._const.MIN_GATE_THRESHOLD;
  // VERSCHAERFT gegenueber der Fassung vor dem 03.08.2026: dort fror ein einzelner
  // Messwert unter lauter Nullen die Schwelle ein (max×2). Genau so sind die vier zu
  // lockeren Live-Schwellen entstanden. Jetzt entscheidet ein Quantil, also die Messreihe.
  const gc = { boards: {} };
  for (let i = 0; i < N - 1; i++) W.updateGateCalibration(gc, 'energy', 0, '2026-01-' + String(i + 1).padStart(2, '0'));
  W.updateGateCalibration(gc, 'energy', 2, '2026-02-01');   // die einzige Bewegung
  assert.strictEqual(gc.boards.energy.frozen, false, 'ein Ausreisser unter Nullen kalibriert nichts');
  assert.strictEqual(gc.boards.energy.threshold, null, 'keine Schwelle aus einer einzigen Messung');
  assert.strictEqual(gc.boards.energy.dailyP99Samples.length, N, 'die Rohmessungen bleiben trotzdem alle stehen');
  assert.ok(gc.boards.energy.dailyP99Samples.includes(2), 'auch die Bewegung ist gespeichert, nur nicht wirksam');

  // Eine durchgehend bewegte Messreihe leitet die Schwelle sehr wohl aus den Messwerten ab
  // — und zwar UEBER dem Boden, sonst wuerde der Boden die Aussage tragen statt der Messung.
  const gc2 = { boards: {} };
  for (let i = 0; i < N; i++) W.updateGateCalibration(gc2, 'energy', BODEN, '2026-03-' + String(i + 1).padStart(2, '0'));
  assert.strictEqual(gc2.boards.energy.frozen, true, 'bewegte Messreihe + genug Samples → frozen');
  assert.strictEqual(gc2.boards.energy.threshold, 2 * BODEN, 'Schwelle aus Messwerten, nicht vom Boden');

  // Boden bleibt als Untergrenze gegen zu kleine, aber ECHTE Schwellen wirksam:
  const gc3 = { boards: {} };
  for (let i = 0; i < N; i++) W.updateGateCalibration(gc3, 'x', 0.1, '2026-04-' + String(i + 1).padStart(2, '0'));
  assert.strictEqual(gc3.boards.x.threshold, BODEN, '0.1×2=0.2 → auf den gemessenen Boden angehoben');
});

// VORHER ROT: Tag 2 (Delta 2) hätte mit der übertünchten Boden-Schwelle 1.0 bereits
// suspect + exit 2 ausgelöst (2 > 1.0) — ein Fehlalarm auf einem nie kalibrierten Board.
// Jetzt: Tag 2 kalibriert (loggt, straft nicht), Tag 3 straft am gemessenen Maß.
check('(f3) geheiltes 0-Schwellen-Board: echter Wertfehler → suspect + exit 2', () => {
  const base = mkBase();
  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC', { withEnds: true }));
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  writeBoard(base, 'energy', [row('ABC', 90)]);
  W.run({ baseDir: base, date: '2026-07-13' });

  // Live-Zustand nachstellen: energy hat threshold 0 eingefroren (echte Messwerte, nicht gefälscht).
  writeJson(path.join(base, 'board-history', '_gate-calibration.json'),
    { _doc: 'test', boards: { energy: { dailyP99Samples: [0, 0, 0], threshold: 0, frozen: true } } });

  // Tag 2: erste echte Bewegung (+2). Degeneriertes Board → Kalibrier-Modus: LOGGT, straft nicht.
  writeBoard(base, 'energy', [row('ABC', 92)]);
  const r2 = W.run({ baseDir: base, date: '2026-07-14' });
  assert.strictEqual(r2.exitCode, 0, 'exit 0: nie kalibriertes Board straft nicht');
  const v2 = readVintage(base, '2026-07-14', 'energy');
  assert.strictEqual(v2.gate.calibrating, true, 'degeneriert → weiterhin Kalibrierphase');
  assert.strictEqual(v2.gate.suspect, false, 'kein Fehlalarm');
  assert.ok(Math.abs(v2.gate.p99Delta - 2) < 1e-9, 'Gate LOGGT das Delta trotzdem');

  // Messdaten-Ehrlichkeit: die 0-Samples wurden nicht umgeschrieben, nur ergänzt.
  const gc = JSON.parse(fs.readFileSync(path.join(base, 'board-history', '_gate-calibration.json'), 'utf8'));
  assert.deepStrictEqual(gc.boards.energy.dailyP99Samples, [0, 0, 0, 2], 'Samples roh ergänzt, nichts gefälscht');
  // UMGESTELLT 03.08.2026: hier stand `threshold === 4, frozen === true` — drei Stichproben
  // plus eine Bewegung froren die Schwelle ein. Genau diese Eile war der Defekt.
  assert.strictEqual(gc.boards.energy.threshold, null, 'vier Stichproben frieren nichts mehr ein');
  assert.strictEqual(gc.boards.energy.frozen, false, 'abgeleitete Felder in der Datei mitgeheilt');

  // Tag 3: Score springt um +40 — echter Wertbruch, weit über der wirksamen Grenze.
  // Der Fund kommt jetzt vom gemessenen Boden statt von einer board-eigenen Schwelle;
  // gefangen wird er unverändert, und das ist die Zusicherung dieses Tests.
  writeBoard(base, 'energy', [row('ABC', 132)]);
  const r3 = W.run({ baseDir: base, date: '2026-07-15' });
  assert.strictEqual(r3.exitCode, 2, 'exit 2: Board ist jetzt scharf und bissig');
  const v3 = readVintage(base, '2026-07-15', 'energy');
  assert.strictEqual(v3.gate.suspect, true, 'suspect-Flag gesetzt');
  assert.strictEqual(v3.gate.calibrating, true, 'noch keine board-eigene Schwelle — geprüft wird trotzdem');
  assert.strictEqual(v3.gate.threshold, null, 'board-eigene Schwelle gibt es (noch) keine');
  assert.strictEqual(v3.gate.wirksameSchwelle, W._const.MIN_GATE_THRESHOLD, 'gestraft wird am gemessenen Boden × 1 Tag');
  assert.ok(v3.gate.reasons.includes('p99-delta-exceeds-threshold'), 'Grund: Schwellen-Bruch');
});

// Der NaN-Einbruch bleibt schwellen-unabhängig: ein degeneriertes Board ist zwar im
// Log-Modus, aber gegen Datenbrüche NIE ungeschützt (sonst wäre die Heilung ein Loch).
check('(f4) degeneriertes Board: NaN-Einbruch schlägt trotz Kalibrier-Modus an', () => {
  const base = mkBase();
  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC', { withEnds: true }));
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  writeBoard(base, 'energy', [row('ABC', 90)]);
  W.run({ baseDir: base, date: '2026-07-13' });
  writeJson(path.join(base, 'board-history', '_gate-calibration.json'),
    { _doc: 'test', boards: { energy: { dailyP99Samples: [0, 0, 0], threshold: 0, frozen: true } } });
  writeBoard(base, 'energy', [{ ...row('ABC', 90), score: null }]);
  const r2 = W.run({ baseDir: base, date: '2026-07-14' });
  assert.strictEqual(r2.exitCode, 2, 'exit 2 trotz Kalibrier-Modus');
  assert.ok(readVintage(base, '2026-07-14', 'energy').gate.reasons.includes('nan-break'));
});

// X2 (Tag 348): eine unlesbare/korrupte Board-Datei in FULL_DIR darf den Lauf NIE mit
// exit 0 durchwinken. Vorher: results.push({board,error:'unreadable'}) + continue liess
// anySuspect unberührt -> exit 0 trotz fehlendem Board im Vintage — Widerspruch zum
// Kopf-Vertrag ("1 = harter Fehler (Inputs fehlen)") und den FULL_DIR-Guards, die für
// genau diese Fehlerklasse bereits werfen.
check('(g) unlesbare Board-Datei in FULL_DIR wirft (kein stiller exit 0)', () => {
  const base = mkBase();
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  writeBoard(base, 'energy', [row('ABC', 90)]);
  // korrupte Datei statt validem JSON — simuliert einen kaputten Board-Schreiber.
  fs.writeFileSync(path.join(base, 'outputs', 'hypergrowth', 'full', 'semiconductors.json'), '{not valid json');
  assert.throws(() => W.run({ baseDir: base, date: '2026-07-13' }), /unreadable full-cohort board file/,
    'muss werfen statt still zu überspringen');
});

console.log(fail ? ('\nFAIL: ' + fail + ' Test(s)') : '\nAlle board-history-Tests grün');
process.exit(fail ? 1 : 0);
