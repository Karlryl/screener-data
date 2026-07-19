'use strict';
/**
 * tests/scoring/bh-b02-rankic.test.js — Standalone-Runner (node ..., Exit 0/1).
 * Hermetischer Regressions-Check für Batch b02-rankic (Audit-Findings BH-103, BH-104,
 * BH-107, BH-110, BH-148, BH-149, BH-150, BH-151, BH-158 in scripts/rank-ic.js).
 * Reines node-Skript, keine Frameworks, keine Netz-Zugriffe, Fixtures inline (Muster:
 * tests/rank-ic.test.js).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ric = require('../../scripts/rank-ic.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function mkSeries(t0, days, start, drift) {
  const m = new Map();
  for (let i = 0; i <= days; i++) m.set(addDays(t0, i), start * (1 + drift * i));
  return m;
}
function writeBoard(hist, date, board, rows) {
  fs.mkdirSync(path.join(hist, date), { recursive: true });
  fs.writeFileSync(path.join(hist, date, board + '.json'), JSON.stringify({ date, board, cohort: { profitable: rows, unprofitable: [] } }));
}
// Tag 396 (FDR-Familien-Freeze): evaluate() bekommt die konfirmatorische Familie seit dem
// Manifest-Freeze INJIZIERT (opts.families) und laedt protocol/ nie selbst — sonst haenge
// die Familiengroesse m wieder am gefundenen Board-Roster (Invariante 7). Diese hermetische
// Fixture haelt die Tests hier von der Produktionsfamilie fern (kein Test darf sie laden).
function fixtureFamily(boards) {
  return {
    schemaVersion: 1,
    familyId: 'bh-b02-test-g1',
    generation: 1,
    hypothesisId: 'bh-b02-test-hypothesis-g1',
    artifactCreatedAt: '2026-01-01',
    provenance: {
      registration: { specifiedAt: '2025-12-01', confirmedAt: '2025-12-02', source: 'test fixture' },
      thresholdFreeze: { frozenAt: '2025-12-03', source: 'test fixture' },
    },
    firstEligibleVintage: '2026-01-01',
    methodContract: {
      protocolVersion: 'rank-ic-confirmatory-v1', horizonsDays: [28, 84], decisionHorizonDays: 84,
      testDefinition: '28d=max(raw,residual)-IUT; 84d=max(raw,residual)-IUT; underpowered=1',
      correction: { method: 'benjamini-yekutieli', q: 0.10 }, minimumNeff: 8, ciLevel: 0.90,
      bootstrapIterations: 10000, bootstrapBlockLength: 2, threshold28: 0.03, threshold84: 0.05,
    },
    boards: boards.slice().sort(),
    payloadHash: 'sha256:bh-b02-test-fixture-g1',
  };
}

// ── BH-148: Block-Bootstrap + BCa ────────────────────────────────────────────
test('invNormalCdf (BH-148): bekannte Standardnormal-Quantile', () => {
  assert.ok(Math.abs(ric.invNormalCdf(0.975) - 1.959964) < 1e-3, 'z(0.975): ' + ric.invNormalCdf(0.975));
  assert.ok(Math.abs(ric.invNormalCdf(0.5) - 0) < 1e-6, 'z(0.5): ' + ric.invNormalCdf(0.5));
  assert.ok(Math.abs(ric.invNormalCdf(0.05) + 1.644854) < 1e-3, 'z(0.05): ' + ric.invNormalCdf(0.05));
});

test('bootstrapCI (BH-148): Block-Bootstrap+BCa bleibt bei klar positivem Signal lo>0 und deterministisch (Seed)', () => {
  const pts = [0.06, 0.09, 0.05, 0.11, 0.07, 0.08, 0.06, 0.1];
  const a = ric.bootstrapCI(pts, 0.9, 2000, 1), b = ric.bootstrapCI(pts, 0.9, 2000, 1);
  assert.ok(a.lo > 0, 'lo: ' + a.lo);
  assert.equal(a.lo, b.lo, 'deterministisch bei gleichem Seed');
  assert.equal(a.p, b.p);
});

test('bootstrapCI (BH-148): Block-Resampling (Blocklaenge>1) zieht zusammenhaengende Bloecke statt Einzelpunkte', () => {
  // Streng alternierende Punkte: jeder zusammenhaengende 2er-Block hat IMMER dieselbe Summe
  // (0.2 + -0.1), das Bootstrap-Mittel ist bei Blocklaenge 2 quasi konstant (CI-Breite ~0).
  // IID-Resampling einzelner Punkte (blockLen=1) hat dagegen echte Streuung. Ein Unterschied
  // in der CI-Breite belegt, dass tatsaechlich Bloecke statt Einzelpunkte gezogen werden.
  const pts = [0.2, -0.1, 0.2, -0.1, 0.2, -0.1, 0.2, -0.1];
  const withBlock = ric.bootstrapCI(pts, 0.9, 4000, 3, 2);
  const withoutBlock = ric.bootstrapCI(pts, 0.9, 4000, 3, 1);
  const widthBlock = withBlock.hi - withBlock.lo, widthIid = withoutBlock.hi - withoutBlock.lo;
  assert.ok(widthBlock < widthIid, 'Block-CI (' + widthBlock + ') sollte enger sein als IID-CI (' + widthIid + ') bei periodischen Punkten');
});

// ── BH-149: Reife-Anker an kanonischem Benchmark statt globalem Max ─────────
test('newestPriceDate (BH-149): bindet an SPY, ignoriert einen einzelnen zukunftsdatierten Ausreisser-Ticker', () => {
  const idx = {
    SPY: new Map([['2026-01-02', 500], ['2026-03-05', 510]]),
    WILD: new Map([['2099-01-01', 1]]), // kaputter/zukunftsdatierter Bar eines Kleinst-Tickers
  };
  assert.equal(ric.newestPriceDate(idx), '2026-03-05', 'SPY-Anker, nicht vom WILD-Ausreisser dominiert');
});
test('newestPriceDate (BH-149): faellt ohne jeden Benchmark-Kandidaten auf den alten globalen Max zurueck', () => {
  const idx = { A: new Map([['2026-01-02', 1]]), B: new Map([['2026-05-09', 2]]) };
  assert.equal(ric.newestPriceDate(idx), '2026-05-09');
  assert.equal(ric.newestPriceDate({}), null);
});

// ── BH-103: kompaktierte Vintages werden transparent aus dem Archiv gelesen ──
test('loadVintage (BH-103): kompaktiertes Vintage wird durch die Archiv-Kopie (voller pit-Block) ersetzt', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-b02-archive-'));
  const hist = path.join(tmp, 'board-history');
  const d = '2026-01-02', board = 'b1';
  const archivePath = path.join(tmp, 'board-history-archive', d, board + '.json');
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  const fullRow = { ticker: 'T0', score: 5, pit: { beta: 1, evSales: 2, priceGrossProfit: 3 } };
  fs.writeFileSync(archivePath, JSON.stringify({ date: d, board, cohort: { profitable: [fullRow], unprofitable: [] } }));
  // archivedTo ist repo-root-relativ (write-board-history.js compact(): path.relative(REPO_ROOT, archivePath)).
  const archivedTo = path.relative(REPO_ROOT, archivePath);
  fs.mkdirSync(path.join(hist, d), { recursive: true });
  fs.writeFileSync(path.join(hist, d, board + '.json'), JSON.stringify({
    date: d, board, compacted: true, archivedTo, cohort: { profitable: [{ ticker: 'T0', score: 5 }], unprofitable: [] },
  }));
  const v = ric.loadVintage(hist, d, board);
  assert.ok(v.cohort.profitable[0].pit, 'pit kommt aus der Archiv-Kopie zurueck, nicht aus der gestrippten Kernversion');
  assert.deepEqual(v.cohort.profitable[0].pit, fullRow.pit);
  fs.rmSync(tmp, { recursive: true, force: true });
});
test('loadVintage (BH-103): fehlt die Archiv-Kopie, bleibt die gestrippte Kernversion (kein Crash)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-b02-archive-missing-'));
  const hist = path.join(tmp, 'board-history');
  const d = '2026-01-02', board = 'b1';
  fs.mkdirSync(path.join(hist, d), { recursive: true });
  fs.writeFileSync(path.join(hist, d, board + '.json'), JSON.stringify({
    date: d, board, compacted: true, archivedTo: 'board-history-archive/nicht-da/b1.json',
    cohort: { profitable: [{ ticker: 'T0', score: 5 }], unprofitable: [] },
  }));
  const v = ric.loadVintage(hist, d, board);
  assert.equal(v.cohort.profitable[0].pit, undefined, 'Fallback auf gestrippte Version, kein Absturz');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── BH-104: loadExcluded — fehlend vs. kaputt ────────────────────────────────
test('loadExcluded (BH-104): fehlende Datei bleibt leise leer, kaputte VORHANDENE Datei wirft fail-loud', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-b02-excl-'));
  assert.equal(ric.loadExcluded(path.join(tmp, 'nicht-da')).size, 0, 'fehlende Datei: leise leere Map');
  fs.writeFileSync(path.join(tmp, '_excluded.json'), '{kaputt');
  assert.throws(() => ric.loadExcluded(tmp), /JSON kaputt/, 'kaputte, VORHANDENE Datei: fail-loud statt stiller leerer Map');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── BH-110: loadVintage/boardsOf fail-loud + Board-Union über alle Vintages ──
test('loadVintage (BH-110): fehlendes Board bleibt still null, kaputtes JSON wirft fail-loud', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-b02-vintage-'));
  const d = '2026-01-02';
  fs.mkdirSync(path.join(tmp, d), { recursive: true });
  assert.equal(ric.loadVintage(tmp, d, 'nope'), null, 'Board existiert an diesem Tag nicht: still null');
  fs.writeFileSync(path.join(tmp, d, 'broken.json'), '{kaputt');
  assert.throws(() => ric.loadVintage(tmp, d, 'broken'), /JSON kaputt/, 'kaputte Datei: fail-loud statt stillem null');
  fs.rmSync(tmp, { recursive: true, force: true });
});
test('evaluate (BH-110): Board-Liste ist die Union ueber ALLE Vintages, nicht nur das erste', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-b02-union-'));
  const hist = path.join(tmp, 'board-history');
  const d0 = '2026-01-02', d1 = '2026-02-02';
  writeBoard(hist, d0, 'old-board', [{ ticker: 'T0', score: 1, pit: {} }]);
  writeBoard(hist, d1, 'old-board', [{ ticker: 'T0', score: 1, pit: {} }]);
  writeBoard(hist, d1, 'new-board', [{ ticker: 'T0', score: 1, pit: {} }]); // fehlt im ERSTEN Vintage
  const rep = ric.evaluate(hist, {}, { B: 20, families: [fixtureFamily(['old-board', 'new-board'])] });
  assert.deepEqual(Object.keys(rep.boards).sort(), ['new-board', 'old-board'],
    'new-board (erst ab d1) darf nicht unsichtbar bleiben, nur weil dates[0]=d0 es noch nicht hatte');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── BH-107: BY-Familie deckt jedes Board×Horizont ab, Konjunktion braucht eigene Residual-Power ──
test('evaluate (BH-107): Familie voll (jeder Horizont vertreten) und 84d-Konjunktion bleibt p=1, solange nur die Rohseite gepowert ist', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-b02-family-'));
  const hist = path.join(tmp, 'board-history');
  const N = 60, V = 30, SPACING = 28, t0 = '2026-01-02';
  const rnd = lcg(4242);
  const skill = Array.from({ length: N }, () => rnd() - 0.5);
  const priceIndex = { SPY: mkSeries(t0, V * SPACING + 100, 500, 0.0001) };
  for (let i = 0; i < N; i++) priceIndex['T' + i] = mkSeries(t0, V * SPACING + 100, 100, 0.002 * skill[i]);
  for (let v = 0; v < V; v++) {
    const d = addDays(t0, v * SPACING);
    const rows = Array.from({ length: N }, (_, i) => ({
      ticker: 'T' + i, score: 50 + 40 * skill[i] + 4 * (rnd() - 0.5), // klares Rohsignal
      pit: null, // keine Kontrollen -> icResid bleibt fuer jedes Fenster null (Residualseite unterpowert)
    }));
    writeBoard(hist, d, 'sig-board', rows);
  }
  const rep = ric.evaluate(hist, priceIndex, { B: 300, families: [fixtureFamily(['sig-board'])] });
  assert.equal(rep.family.length, 2, 'Familie deckt beide Horizonte des einen Boards ab, auch ohne Residual-Power');
  const fam84 = rep.family.find((f) => f.horizon === 84);
  assert.equal(fam84.p, 1, 'Konjunktions-p bleibt 1 (unbewiesen), solange die Residualseite unterpowert ist: ' + fam84.p);
  assert.equal(fam84.bySignificant, false);
  const h84 = rep.boards['sig-board'].horizons[84];
  assert.ok(h84.nEff >= 8, 'Vorbedingung: Rohseite gepowert, N_eff=' + h84.nEff);
  assert.ok(h84.meanICRaw > 0.3, 'Vorbedingung: klares Rohsignal, meanICRaw=' + h84.meanICRaw);
  assert.notEqual(h84.verdict, 'LIVE-Kriterium erfüllt (vorbehaltlich BY-FDR)', 'Konjunktion darf ohne Residual-Power nicht LIVE sein');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── BH-150: Delivery-IC-Attrition ausgewiesen statt still gedroppt ───────────
test('deliveryIC (BH-150): t0-Ticker ohne jede Zeile im spaeteren Vintage zaehlt als Attrition, nicht als stiller Drop', () => {
  const N = 12;
  const mkRow = (i, later) => ({
    ticker: 'T' + i, score: i,
    pit: later ? { revenueQ: [100 + i * 3], revenueQEnds: ['2026-09-30'] } : { revenueQ: [100], revenueQEnds: ['2026-03-31'] },
  });
  const v0 = { cohort: { profitable: Array.from({ length: N }, (_, i) => mkRow(i, false)), unprofitable: [] } };
  // T10/T11 fehlen im spaeteren Vintage komplett (vom Board gefallen/delistet) -> Attrition.
  const v1 = { cohort: { profitable: Array.from({ length: N - 2 }, (_, i) => mkRow(i, true)), unprofitable: [] } };
  const r = ric.deliveryIC(v0, v1);
  assert.equal(r.attrition, 2, 'zwei t0-Ticker fehlen im spaeteren Vintage: ' + r.attrition);
  assert.ok(r.attritionRate > 0, 'Attritionsquote ausgewiesen: ' + r.attritionRate);
  assert.equal(r.n, N - 2, 'nur die ueberlebenden Ticker tragen den IC');
});

// ── BH-151 (Label) + BH-158 (MDE-Ausweis) — Report-Felder ────────────────────
test('evaluate (BH-151/BH-158): jedes Horizont-Objekt traegt icResidLabel (semi-partial) und mde', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-b02-label-'));
  const t0 = '2026-07-14';
  const rows = Array.from({ length: 12 }, (_, i) => ({ ticker: 'T' + i, score: i, pit: {} }));
  writeBoard(tmp, t0, 'b1', rows);
  const rep = ric.evaluate(tmp, {}, { B: 20, families: [fixtureFamily(['b1'])] });
  for (const horizon of [28, 84]) {
    const h = rep.boards.b1.horizons[horizon];
    assert.equal(h.icResidLabel, 'semi-partial (nur Return residualisiert)', horizon + 'd');
    assert.ok('mde' in h, horizon + 'd: mde-Feld fehlt');
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── BH-158: log(marketCap) als vierte Kontrolle, sobald vorhanden ────────────
test('windowIC (BH-158): log(marketCap) wird aufgenommen, sobald sie in der Kohorte auftaucht — ohne sie bleibt Status quo (3 Kontrollen)', () => {
  const N = 40; const rnd = lcg(55);
  const used = Array.from({ length: N }, (_, i) => {
    const mcap = 1e8 * (1 + rnd());
    return {
      row: { score: i, pit: { beta: rnd(), evSales: 1, priceGrossProfit: 1, marketCap: mcap } },
      ret: 0.02 * Math.log(mcap) + 0.01 * (rnd() - 0.5),
    };
  });
  const withMcap = ric.windowIC(used);
  assert.deepEqual(withMcap.residControls, ['beta', 'evSales', 'priceGrossProfit', 'marketCap']);
  assert.ok(withMcap.nResid >= 10, 'marketCap-present -> volle Kohorte kontrollierbar: ' + withMcap.nResid);

  const usedNoMcap = used.map((u) => ({ ...u, row: { ...u.row, pit: { beta: u.row.pit.beta, evSales: 1, priceGrossProfit: 1 } } }));
  const withoutMcap = ric.windowIC(usedNoMcap);
  assert.deepEqual(withoutMcap.residControls, ['beta', 'evSales', 'priceGrossProfit'], 'ohne marketCap in der Kohorte: Status quo (3 Basiskontrollen), kein Absturz');
  assert.ok(withoutMcap.nResid > 0, 'Basiskontrollen bleiben funktionsfaehig ohne marketCap: ' + withoutMcap.nResid);
});

console.log(`\nbh-b02-rankic.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
