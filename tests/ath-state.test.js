'use strict';
/** tests/ath-state.test.js — Standalone-Runner (node tests/ath-state.test.js, Exit 0/1).
 * Pinnt die 2.2-Kernlogik: ATH-Fortschrieb, Split-Wächter, Kill+Resume, Seed, Anzeige. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../lib/price-history-store.js');
const upd = require('../scripts/update-ath-state.js');
const bf = require('../scripts/backfill-prices-max.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

test('seedEntry: ATH + Referenzanker + lastClose aus Max-Serie', () => {
  const bars = [];
  for (let i = 0; i < 300; i++) bars.push({ date: '2020-' + String(1 + (i % 12)).padStart(2, '0') + '-01', close: 10 + i });
  // eindeutige, sortierbare Daten bauen (obiges hat Duplikate) — sauber neu:
  const clean = Array.from({ length: 300 }, (_, i) => ({ date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), close: i === 150 ? 500 : 10 + i }));
  const e = bf.seedEntry(clean, '2026-07-14');
  assert.equal(e.ath, 500);
  assert.equal(e.athDate, clean[150].date);
  assert.equal(e.lastClose, clean[299].close);
  assert.equal(e.refDate, clean[299 - bf.REF_LOOKBACK_BARS].date); // Anker ~40 Bars vor newest
  assert.equal(e.needsReseed, false);
});
test('advanceEntry: neues Hoch hebt ATH; Referenz stabil -> kein Reseed', () => {
  const entry = { ath: 100, athDate: '2025-01-02', refDate: '2026-06-01', refClose: 80, lastClose: 80, lastDate: '2026-06-01', needsReseed: false };
  const series = [{ date: '2026-06-01', close: 80 }, { date: '2026-07-10', close: 120 }];
  const out = upd.advanceEntry(entry, series);
  assert.equal(out.ath, 120); assert.equal(out.athDate, '2026-07-10');
  assert.equal(out.lastClose, 120); assert.equal(out.needsReseed, false);
});
test('advanceEntry SPLIT-WÄCHTER: re-basierter Referenzkurs -> needsReseed, ATH friert', () => {
  const entry = { ath: 950, athDate: '2024-06-18', refDate: '2026-06-01', refClose: 800, lastClose: 800, lastDate: '2026-06-01', needsReseed: false };
  // Store nach 10:1-Split re-basiert: refDate-Kurs jetzt 80 statt 800
  const series = [{ date: '2026-06-01', close: 80 }, { date: '2026-07-10', close: 95 }];
  const out = upd.advanceEntry(entry, series);
  assert.equal(out.needsReseed, true);
  assert.equal(out.ath, 950); // NICHT gegen falsche Skala fortgeschrieben
  assert.equal(upd.displayFor(out), null); // Anzeige ehrlich aus
});
test('displayFor: Abstand/Monate korrekt; unter ATH negativ', () => {
  const d = upd.displayFor({ ath: 200, athDate: '2025-07-14', lastClose: 150, lastDate: '2026-07-14', needsReseed: false });
  assert.equal(d.distancePct, -25);
  assert.ok(d.monthsAgo >= 11 && d.monthsAgo <= 13);
});
test('pendingTickers (Kill+Resume): done übersprungen, stale + neue gezogen, --force alles', () => {
  const universe = ['A', 'B', 'C', 'D'];
  const manifest = { done: { A: { at: 'x' }, B: { at: 'x' } } };
  const state = { entries: { B: { needsReseed: true } } };
  assert.deepEqual(bf.pendingTickers(universe, manifest, state, {}), ['B', 'C', 'D']); // B stale, C/D neu
  assert.deepEqual(bf.pendingTickers(universe, manifest, state, { onlyStale: true }), ['B']);
  assert.deepEqual(bf.pendingTickers(universe, manifest, state, { force: true }), universe);
});

// ── F3 Wiring: Store-Vertrag + Fail-loud (Muster rank-ic loadPriceIndexOrThrow, Tag 321) ──
// Der tägliche ATH-Lauf las prices/history, der Store hängt 'history' aber SELBST an ->
// Suche unter prices/history/history/ -> {} -> seit jeher kein Schlusskurs-Nachzug, kein
// Split-Wächter. Dieser Test pinnt den Vertrag gegen ein Temp-Repo und wäre vor dem Fix
// rot gewesen (loadHistoryOrDie existierte nicht / kein Fail-loud beim doppelten Pfad).
test('F3 Wiring: loadHistoryOrDie liest den Store aus prices/; doppelter prices/history-Pfad scheitert LAUT', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ath-wiring-'));
  const pricesDir = path.join(tmp, 'prices');
  // Fixture über den Store selbst: 32 Shards + _meta.json unter prices/history/ (Vertrag: loadAll hängt 'history' an).
  store.saveAll(pricesDir, {
    AAA: [{ date: '2026-01-02', close: 10 }, { date: '2026-01-03', close: 11 }],
    BBB: [{ date: '2026-01-02', close: 20 }],
  });
  const hist = upd.loadHistoryOrDie(pricesDir);
  assert.ok(Object.keys(hist).length >= 2, 'Store aus prices/ gelesen: ' + Object.keys(hist).length);
  // Der alte (kaputte) F3-Default prices/history -> Store sucht prices/history/history/ -> leer -> jetzt LAUT.
  assert.throws(() => upd.loadHistoryOrDie(path.join(pricesDir, 'history')),
    /LEER|ungestempelt/, 'doppelter history-Pfad -> fail-loud statt still leerer ATH-Lauf');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── F12: boardUniverse seedet auch die QC-Boards aus dem Unterordner v1/quality/ ──
// boardUniverse las nur die Top-Level-*.json unter v1/; QC-Boards liegen in v1/quality/
// und wurden nie eingelesen -> QC-Top-50-Namen ohne HG-Platzierung blieben dauerhaft ath:null.
test('F12 boardUniverse: QC-Namen aus v1/quality/ landen im Universum (Top-Level bleibt, index.json ignoriert)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ath-qc-'));
  const v1 = path.join(tmp, 'v1');
  const qdir = path.join(v1, 'quality');
  fs.mkdirSync(qdir, { recursive: true });
  fs.writeFileSync(path.join(v1, 'sector-x.json'), JSON.stringify({ profitable: [{ ticker: 'HGONLY' }], unprofitable: [] }));
  fs.writeFileSync(path.join(v1, 'index.json'), JSON.stringify({ boards: ['sector-x'] })); // muss ignoriert bleiben
  fs.writeFileSync(path.join(qdir, 'qc-top.json'), JSON.stringify({ profitable: [{ ticker: 'QCONLY' }], unprofitable: [] }));
  fs.writeFileSync(path.join(qdir, 'index.json'), JSON.stringify({ boards: ['qc-top'] })); // auch im Unterordner ignoriert
  const uni = bf.boardUniverse(v1);
  assert.ok(uni.includes('HGONLY'), 'Top-Level-HG-Ticker weiterhin enthalten');
  assert.ok(uni.includes('QCONLY'), 'QC-Ticker aus v1/quality/ wird geseedet (F12)');
  assert.ok(!uni.includes('sector-x') && !uni.includes('qc-top'), 'index.json-Inhalt wird nicht als Ticker geerntet');
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`\nath-state.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
