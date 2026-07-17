'use strict';
/**
 * tests/rank-ic.test.js — Standalone-Runner (node tests/rank-ic.test.js, Exit 0/1).
 * Prüft die 2.8-Spec-Mechanik von scripts/rank-ic.js gegen SYNTHETISCHE Fixtures
 * (die Live-Reihe existiert noch nicht — L4: gegen Fixtures bauen, hermetisch in
 * einem Temp-Verzeichnis, kein Zugriff auf echte snapshots/prices).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ric = require('../scripts/rank-ic.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// deterministischer LCG (kein Math.random — Reproduzierbarkeit)
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ── Statistik-Primitives ─────────────────────────────────────────────────────
test('spearman: perfekte Monotonie = 1, Antitonie = -1, Ties korrekt', () => {
  assert.equal(ric.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(ric.spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
  const r = ric.ranks([5, 5, 1]);
  assert.deepEqual(r, [2.5, 2.5, 1]); // Durchschnittsränge
});
test('disjointDecisionDates: 84d-Abstand erzwungen', () => {
  const dates = []; for (let i = 0; i < 200; i += 7) dates.push(addDays('2026-01-01', i));
  const dec = ric.disjointDecisionDates(dates, 84);
  assert.ok(dec.length >= 2);
  for (let i = 1; i < dec.length; i++) {
    const gap = (new Date(dec[i]) - new Date(dec[i - 1])) / 86400000;
    assert.ok(gap >= 84, `Fenster ${i} nur ${gap}d`);
  }
});
test('benjaminiYekutieli: kleiner p signifikant, grosser nicht', () => {
  const sig = ric.benjaminiYekutieli([0.0005, 0.9, 0.8, 0.7], 0.10);
  assert.equal(sig[0], true); assert.equal(sig[1], false);
});
test('residualize: Kontroll-Signal wird herausgenommen', () => {
  const rnd = lcg(7);
  const ctl = Array.from({ length: 200 }, () => rnd());
  const skill = Array.from({ length: 200 }, () => rnd());
  const y = ctl.map((c, i) => 5 * c + skill[i]); // y stark kontroll-getrieben
  const resid = ric.residualize(y, [ctl]);
  const icCtlBefore = Math.abs(ric.spearman(ctl, y));
  const icCtlAfter = Math.abs(ric.spearman(ctl, resid));
  assert.ok(icCtlBefore > 0.9, 'Vorbedingung: Kontrolle dominiert y');
  assert.ok(icCtlAfter < 0.15, 'Residuen dürfen die Kontrolle nicht mehr tragen: ' + icCtlAfter);
  assert.ok(ric.spearman(skill, resid) > 0.3, 'Skill-Signal überlebt die Residualisierung');
});
test('nEff: unkorrelierte Punkte ~n, stark autokorreliert deutlich kleiner', () => {
  const rnd = lcg(42);
  const iid = Array.from({ length: 24 }, () => rnd());
  assert.ok(ric.nEff(iid) > 12);
  const ar = [0.5]; for (let i = 1; i < 24; i++) ar.push(0.98 * ar[i - 1] + 0.02 * rnd());
  assert.ok(ric.nEff(ar) < 12, 'autokorreliert: ' + ric.nEff(ar));
});
test('bootstrapCI: positives Signal -> lo>0; deterministisch (Seed)', () => {
  const pts = [0.06, 0.09, 0.05, 0.11, 0.07, 0.08, 0.06, 0.1];
  const a = ric.bootstrapCI(pts, 0.9, 500, 1), b = ric.bootstrapCI(pts, 0.9, 500, 1);
  assert.ok(a.lo > 0); assert.equal(a.lo, b.lo); assert.equal(a.p, b.p);
});

// ── §8 Austritts-Semantik (windowReturns gegen synthetischen priceIndex) ─────
function mkSeries(t0, days, start, drift) {
  const m = new Map();
  for (let i = 0; i <= days; i++) m.set(addDays(t0, i), start * (1 + drift * i));
  return m;
}
test('windowReturns §8: ok / delisted=-100% / M&A-shortened / no-entry-Ausschluss', () => {
  const t0 = '2026-01-05';
  const priceIndex = {
    SPY: mkSeries(t0, 120, 500, 0.0002),
    OK1: mkSeries(t0, 120, 100, 0.001),
    DEAD: (() => { const m = mkSeries(t0, 20, 50, 0); m.set(addDays(t0, 89), 0); return m; })(), // Loch im Exit-Fenster, aber Coverage danach -> delisted
    MNA: mkSeries(t0, 30, 10, 0.01),   // Serie endet 30d nach t0 (Übernahme) -> verkürzt, Gewinn gebucht
    NOENT: (() => { const m = new Map(); m.set(addDays(t0, 60), 5); return m; })(), // kein Entry-Kurs
  };
  const rows = ['OK1', 'DEAD', 'MNA', 'NOENT'].map((t, i) => ({ ticker: t, score: 90 - i, pit: null }));
  const w = ric.windowReturns(priceIndex, rows, t0, 84);
  const byT = new Map(w.used.map((u) => [u.row.ticker, u]));
  assert.ok(byT.has('OK1') && Math.abs(byT.get('OK1').ret - 0.084) < 0.02);
  assert.equal(byT.get('DEAD').ret, -1.0);                       // §8: Totalverlust, nicht gedroppt
  assert.ok(byT.has('MNA') && byT.get('MNA').shortened === true);
  assert.ok(byT.get('MNA').ret > 0.25, 'M&A-Gewinn gebucht: ' + byT.get('MNA').ret);
  assert.ok(!byT.has('NOENT'));
  assert.equal(w.quota.excluded_no_entry, 1);
  assert.ok(w.exitRate > 0);
});

// ── End-to-End: synthetische Vintage-Reihe mit bekanntem Signal ─────────────
test('evaluate: bekanntes Signal wird wiedergefunden, Exclude greift, Null-Board bleibt ohne Urteil', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rankic-'));
  const hist = path.join(tmp, 'board-history');
  const N = 120, V = 10, SPACING = 28, t0 = '2026-01-02';
  const rnd = lcg(2026);
  // Preis-Serien: Forward-Return korreliert mit dem (konstanten) wahren Skill je Name.
  const skill = Array.from({ length: N }, () => rnd() - 0.5);
  const priceIndex = { SPY: mkSeries(t0, V * SPACING + 100, 500, 0.0001) };
  for (let i = 0; i < N; i++) {
    const daily = 0.002 * skill[i]; // Drift je Name
    priceIndex['T' + i] = mkSeries(t0, V * SPACING + 100, 100, daily);
  }
  // Vintages: Score = Skill-Rang + Rauschen (SIG-Board) bzw. pures Rauschen (NULL-Board).
  for (let v = 0; v < V; v++) {
    const d = addDays(t0, v * SPACING);
    fs.mkdirSync(path.join(hist, d), { recursive: true });
    const mkRows = (noisy) => Array.from({ length: N }, (_, i) => ({
      rank: i + 1, ticker: 'T' + i, track: 'profitable',
      score: noisy ? rnd() * 100 : 50 + 40 * skill[i] + 8 * (rnd() - 0.5),
      pit: { beta: 1 + (rnd() - 0.5), evSales: 5 * rnd(), priceGrossProfit: 10 * rnd(), revenueQ: null, revenueQEnds: null },
    }));
    for (const [board, noisy] of [['sig-board', false], ['null-board', true]]) {
      fs.writeFileSync(path.join(hist, d, board + '.json'), JSON.stringify({
        date: d, board, cohort: { profitable: mkRows(noisy), unprofitable: [] },
      }));
    }
  }
  // Sidecars wie im echten Vintage-Ordner (write-board-history legt calibration.json
  // + regime.json neben die Boards) — der Auswerter darf daran nie crashen und sie
  // nie als Pseudo-Boards zählen (Live-Crash 16.07., rank-ic.js:300).
  const d0 = addDays(t0, 0);
  fs.writeFileSync(path.join(hist, d0, 'calibration.json'), JSON.stringify({ generated_at: d0, schema: 'v4', winsorBounds: {} }));
  fs.writeFileSync(path.join(hist, d0, 'regime.json'), JSON.stringify({ date: d0, label: 'neutral', source: 'test' }));

  // Exclude: ein zusätzliches, absichtlich kaputtes Vintage wird exkludiert.
  const badDate = addDays(t0, V * SPACING);
  fs.mkdirSync(path.join(hist, badDate), { recursive: true });
  fs.writeFileSync(path.join(hist, badDate, 'sig-board.json'), JSON.stringify({ date: badDate, board: 'sig-board', cohort: { profitable: [], unprofitable: [] } }));
  fs.writeFileSync(path.join(hist, '_excluded.json'), JSON.stringify({ [badDate]: 'synthetisch korrupt (Test)' }));

  const rep = ric.evaluate(hist, priceIndex, { B: 300 });
  assert.deepEqual(rep.vintagesExcluded, [badDate], 'Exclude ausgewiesen');
  assert.deepEqual(Object.keys(rep.boards).sort(), ['null-board', 'sig-board'],
    'Sidecars (calibration/regime) sind keine Boards');
  const sig84 = rep.boards['sig-board'].horizons[84];
  const nul84 = rep.boards['null-board'].horizons[84];
  // 10 Vintages à 28d -> disjunkte 84d-Punkte = ceil(10/3) = 4 -> N_eff<8 -> KEIN Urteil (§3d) …
  assert.ok(String(sig84.verdict).includes('kein Urteil'), '§3d greift bei 4 Punkten: ' + sig84.verdict);
  // … aber der gemessene IC trägt das Signal, das Null-Board nicht.
  assert.ok(sig84.meanICRaw > 0.3, 'Signal-Board IC: ' + sig84.meanICRaw);
  assert.ok(Math.abs(nul84.meanICRaw) < 0.2, 'Null-Board IC ~0: ' + nul84.meanICRaw);
  // exkludiertes Vintage taucht in KEINER Entscheidungsliste auf
  for (const h of Object.values(rep.boards['sig-board'].horizons)) {
    assert.ok(!h.decisions.some((x) => x.date === badDate));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── §4b Delivery-IC an synthetischen PIT-Serien ──────────────────────────────
test('deliveryIC: Score korreliert mit realisiertem Umsatz-Delta (Perioden-Ende-gematcht)', () => {
  const N = 40; const rnd = lcg(9);
  const mk = (later) => ({
    cohort: {
      profitable: Array.from({ length: N }, (_, i) => ({
        ticker: 'T' + i, score: i, // Score = Index
        pit: later
          ? { revenueQ: [100 + i * 2 + rnd(), 100], revenueQEnds: ['2026-09-30', '2026-03-31'] }
          : { revenueQ: [100], revenueQEnds: ['2026-03-31'] },
      })), unprofitable: [],
    },
  });
  const r = ric.deliveryIC(mk(false), mk(true));
  assert.equal(r.n, N);
  assert.ok(r.ic > 0.9, 'Delivery-IC: ' + r.ic); // Umsatz-Delta steigt monoton im Score
});

// ── Verdrahtung Store->Preis-Index (R-Gate 2.R, Fund F5-1) ───────────────────
// Die Einzelfunktionen waren immer grün — kaputt war NUR die Verdrahtung in main():
// loadAll bekam prices/history statt prices, der Store hängt 'history' selbst an,
// der Index blieb leer und JEDES Board meldete "unterpowert" auf n=0. Dieser Test
// pinnt den Store-Vertrag gegen ein Temp-Repo und wäre vor dem Fix rot gewesen.
test('loadPriceIndexOrThrow: liest den Store aus dem prices-Verzeichnis (Vertrag: Store hängt "history" selbst an)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-ic-wiring-'));
  const shardDir = path.join(tmp, 'prices', 'history');
  fs.mkdirSync(shardDir, { recursive: true });
  // Layout exakt wie price-history-store.loadAll es erwartet: <pricesDir>/history/history-NN.json
  fs.writeFileSync(path.join(shardDir, 'history-00.json'), JSON.stringify({
    AAA: [{ date: '2026-01-02', close: 10 }, { date: '2026-01-03', close: 11 }],
    BBB: [{ date: '2026-01-02', close: 20 }],
  }));
  const idx = ric.loadPriceIndexOrThrow(path.join(tmp, 'prices'));
  assert.ok(Object.keys(idx).length >= 2, 'Index findet die Ticker aus dem Store: ' + Object.keys(idx).length);
  // Der alte (kaputte) Pfad muss jetzt LAUT scheitern statt still 0 Ticker zu liefern.
  assert.throws(() => ric.loadPriceIndexOrThrow(path.join(tmp, 'prices', 'history')),
    /Preis-Index LEER/, 'falscher Pfad -> fail-loud statt stiller Leer-Index');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── §1-Haltedauer: unfertige Fenster (R-Gate 2.R, Fund F5-2) ─────────────────
// Live-Fall vom 17.07.: alle Vintages waren 0-3 Tage alt, ein 84d-Fenster KANN
// nicht abgelaufen sein. Trotzdem lieferte jedes Board nPoints=1 — der
// §8-Verkuerzungspfad (fuer echte M&A-Austritte gedacht) sah "series_ended" fuer
// die ganze Kohorte (niemand hat Kurse aus der Zukunft) und buchte die
// 3-Tage-Rendite als vollwertigen 84d-Punkt. Dieser Test waere vorher rot gewesen.
test('evaluate §1: Fenster, das noch nicht abgelaufen ist, wird NICHT als voller Horizont gebucht (pendingWindows)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-ic-pending-'));
  const t0 = '2026-07-14';
  const newest = '2026-07-17'; // letzter Kurstag: 3 Tage nach dem Vintage
  // Vintage mit 12 Zeilen (ueber windowIC-Mindestgroesse 10)
  const rows = Array.from({ length: 12 }, (_, i) => ({ ticker: 'T' + i, score: i, pit: {} }));
  const dir = path.join(tmp, t0);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'b1.json'), JSON.stringify({ date: t0, board: 'b1', cohort: { profitable: rows, unprofitable: [] } }));
  // Preis-Index endet am 17.07. — genau wie die echte Welt am Tag des Laufs.
  const priceIndex = {};
  for (const r of rows) {
    const m = new Map();
    m.set(t0, 100);
    m.set(newest, 100 + r.score); // Score-korrelierte Kurzfrist-Rendite: waere ein verlockender Fake-IC
    priceIndex[r.ticker] = m;
  }
  const rep = ric.evaluate(tmp, priceIndex, { B: 50 });
  assert.equal(rep.newestPriceDate, newest, 'globaler letzter Kurstag wird ausgewiesen');
  for (const horizon of [28, 84]) {
    const h = rep.boards.b1.horizons[horizon];
    assert.equal(h.nPoints, 0, horizon + 'd: kein Punkt aus unfertigem Fenster (war: ' + h.nPoints + ')');
    assert.ok(h.pendingWindows >= 1, horizon + 'd: unfertiges Fenster wird transparent als pending ausgewiesen');
    assert.equal(h.meanICRaw, null, horizon + 'd: kein IC aus einer 3-Tage-Rendite');
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('newestPriceDate: Maximum ueber den gesamten Index, unabhaengig von der Ticker-Reihenfolge', () => {
  const idx = {
    A: new Map([['2026-01-02', 1], ['2026-03-05', 2]]),
    B: new Map([['2026-05-09', 3]]), // spaeter, aber nicht zuerst einsortiert
    C: new Map([['2026-02-01', 4]]),
  };
  assert.equal(ric.newestPriceDate(idx), '2026-05-09');
  assert.equal(ric.newestPriceDate({}), null);
});

console.log(`\nrank-ic.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
