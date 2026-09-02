'use strict';
/** tests/ath-state.test.js — Standalone-Runner (node tests/ath-state.test.js, Exit 0/1).
 * Pinnt die 2.2-Kernlogik: ATH-Fortschrieb, Split-Wächter, Kill+Resume, Seed, Anzeige. */
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
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

const UPDATE_ATH_CLI = path.join(__dirname, '..', 'scripts', 'update-ath-state.js');

function runStateFixture(stateValue, options = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ath-state-shape-'));
  const stateFile = path.join(tmp, 'ath-state.json');
  const pricesDir = path.join(tmp, 'missing-prices');
  const statePresent = options.statePresent !== false;
  if (statePresent) fs.writeFileSync(stateFile, JSON.stringify(stateValue));
  const before = statePresent ? fs.readFileSync(stateFile, 'utf8') : null;
  const result = childProcess.spawnSync(process.execPath, [
    UPDATE_ATH_CLI,
    '--state', stateFile,
    '--prices-dir', pricesDir,
  ], { encoding: 'utf8', env: process.env });
  const after = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : null;
  const pricesDirCreated = fs.existsSync(pricesDir);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (result.error) throw result.error;
  return {
    status: result.status,
    output: String(result.stdout || '') + String(result.stderr || ''),
    before,
    after,
    pricesDirCreated,
  };
}

function assertShapeFailure(stateValue, messagePattern) {
  const result = runStateFixture(stateValue);
  assert.notEqual(result.status, 0, 'parseable malformed state must fail');
  assert.match(result.output, messagePattern, 'failure must name the malformed state boundary');
  assert.doesNotMatch(result.output, /Preis-Store LEER|ungestempelt/, 'shape must fail before price-store access');
  assert.equal(result.after, result.before, 'shape failure must not rewrite the state file');
  assert.equal(result.pricesDirCreated, false, 'shape failure must not create the price-store path');
}

for (const [label, value] of [
  ['array', []],
  ['null', null],
  ['string', 'not-an-object'],
  ['number', 0],
  ['boolean', false],
]) {
  test(`CLI rejects a parseable ${label} ATH-state root before store access`, () => {
    assertShapeFailure(value, /ATH state root must be a non-null, non-array object/);
  });
}

for (const [label, value] of [
  ['empty root', {}],
  ['asOf-only root', { asOf: '2026-09-01' }],
  ['misspelled entries key', { entires: {} }],
]) {
  test(`CLI rejects ${label} without an own entries object`, () => {
    assertShapeFailure(value, /ATH state entries must be a non-null, non-array object/);
  });
}

for (const [label, value] of [
  ['null', null],
  ['empty array', []],
  ['populated array', [{}]],
  ['empty string', ''],
  ['non-empty string', 'ticker'],
  ['number', 0],
  ['boolean', false],
]) {
  test(`CLI rejects parseable ATH-state entries as ${label} before store access`, () => {
    assertShapeFailure({ entries: value }, /ATH state entries must be a non-null, non-array object/);
  });
}

for (const [label, value] of [
  ['null', null],
  ['empty array', []],
  ['populated array', [{}]],
  ['empty string', ''],
  ['non-empty string', 'ticker'],
  ['number', 0],
  ['boolean', false],
]) {
  test(`CLI rejects an ATH-state ticker entry as ${label} before store access`, () => {
    assertShapeFailure(
      { entries: { BROKEN: value } },
      /ATH state entry "BROKEN" must be a non-null, non-array object/,
    );
  });
}

test('CLI validates the complete entry map before store access', () => {
  assertShapeFailure(
    { entries: { GOOD: {}, BROKEN: [] } },
    /ATH state entry "BROKEN" must be a non-null, non-array object/,
  );
});

test('runner stops malformed structure before injected store and writer I/O', () => {
  const trace = [];
  assert.throws(() => upd.runUpdateAthState('state.json', 'prices', {
    existsSync() { trace.push('exists'); return true; },
    readFileSync() {
      trace.push('read');
      return JSON.stringify({ entries: { GOOD: {}, BROKEN: [] } });
    },
    loadHistory() { trace.push('load'); return {}; },
    writeFileAtomic() { trace.push('write'); },
    today() { trace.push('today'); return '2026-09-01'; },
    log() { trace.push('log'); },
  }), /ATH state entry "BROKEN" must be a non-null, non-array object/);
  assert.deepEqual(trace, ['exists', 'read']);
});

test('runner calibration reaches loader, writer and log while preserving unknown fields', () => {
  const trace = [];
  let written = null;
  const state = {
    rootExtra: { retained: true },
    entries: {
      GOOD: {
        ath: 9,
        athDate: '2025-01-02',
        lastClose: 9,
        lastDate: '2025-01-02',
        needsReseed: false,
        entryExtra: 'retained',
      },
    },
  };
  upd.runUpdateAthState('state.json', 'prices', {
    existsSync() { trace.push('exists'); return true; },
    readFileSync() { trace.push('read'); return JSON.stringify(state); },
    loadHistory() {
      trace.push('load');
      return { GOOD: [{ date: '2026-09-01', close: 10 }] };
    },
    writeFileAtomic(file, content) {
      trace.push('write');
      written = { file, content };
    },
    today() { trace.push('today'); return '2026-09-01'; },
    log() { trace.push('log'); },
  });
  assert.deepEqual(trace, ['exists', 'read', 'load', 'today', 'write', 'log']);
  assert.equal(written.file, 'state.json');
  const next = JSON.parse(written.content);
  assert.deepEqual(next.rootExtra, { retained: true });
  assert.equal(next.asOf, '2026-09-01');
  assert.equal(next.entries.GOOD.entryExtra, 'retained');
  assert.equal(next.entries.GOOD.ath, 10);
  assert.equal(next.entries.GOOD.athDate, '2026-09-01');
  assert.equal(next.entries.GOOD.lastClose, 10);
  assert.equal(next.entries.GOOD.lastDate, '2026-09-01');
});

test('runner propagates an atomic-writer failure without a success log', () => {
  const trace = [];
  const sentinel = new Error('writer-sentinel');
  assert.throws(() => upd.runUpdateAthState('state.json', 'prices', {
    existsSync() { trace.push('exists'); return true; },
    readFileSync() {
      trace.push('read');
      return JSON.stringify({ entries: { GOOD: { ath: 9, needsReseed: false } } });
    },
    loadHistory() {
      trace.push('load');
      return { GOOD: [{ date: '2026-09-01', close: 10 }] };
    },
    writeFileAtomic() { trace.push('write'); throw sentinel; },
    today() { trace.push('today'); return '2026-09-01'; },
    log() { trace.push('log'); },
  }), (error) => error === sentinel);
  assert.deepEqual(trace, ['exists', 'read', 'load', 'today', 'write']);
});

test('CLI admits an object-valued entry and reaches the calibrated store boundary', () => {
  const result = runStateFixture({ entries: { GOOD: {} } });
  assert.notEqual(result.status, 0, 'the deliberately missing store must stop the control');
  assert.match(result.output, /Preis-Store LEER|ungestempelt/);
  assert.doesNotMatch(result.output, /ATH state (?:root|entries|entry).*must be/);
  assert.equal(result.after, result.before);
  assert.equal(result.pricesDirCreated, false);
});

for (const control of [
  { label: 'missing state file', statePresent: false, value: null, output: /kein ath-state\.json/ },
  { label: 'empty entries object', value: { entries: {} }, output: /ath-state leer/ },
]) {
  test(`CLI preserves ${control.label} as a no-op`, () => {
    const result = runStateFixture(control.value, { statePresent: control.statePresent });
    assert.equal(result.status, 0);
    assert.match(result.output, control.output);
    assert.equal(result.after, result.before);
    assert.equal(result.pricesDirCreated, false);
  });
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
test('advanceEntry AGED-OUT (J-A): refDate aelter als aeltester Store-Bar -> needsReseed, Waechter nie lautlos aus', () => {
  // Rollendes ~400-Tage-Fenster: refDate 2025-01-02 ist aus dem Store herausgealtert
  // (aeltester Bar 2026-06-01 > refDate). byDate.find liefert undefined -> der Split-
  // Waechter waere fuer den Ticker DAUERHAFT lautlos aus (echter Split nie erkannt).
  const entry = { ath: 950, athDate: '2024-06-18', refDate: '2025-01-02', refClose: 800, lastClose: 800, lastDate: '2025-01-02', needsReseed: false };
  const series = [{ date: '2026-06-01', close: 1000 }, { date: '2026-07-10', close: 1200 }];
  const out = upd.advanceEntry(entry, series);
  assert.equal(out.needsReseed, true); // herausgealtert -> Reseed erzwingen (re-verankert refDate)
  assert.equal(out.ath, 950); // eingefroren: nicht gegen ungepruefte Skala fortgeschrieben
  assert.equal(upd.displayFor(out), null); // Anzeige ehrlich aus bis Reseed
});
test('advanceEntry GEGEN-TEST: refDate-Loch MITTEN im Fenster (Feiertag/Datenloch) -> KEIN Reseed', () => {
  // Fenster (2026-06-01 .. 2026-07-10) UMSCHLIESST refDate 2026-06-15, aber der 06-15-Bar
  // fehlt (Lücke, kein Split). "Kein Urteil" bleibt korrekt: NICHT reseeden, ATH laeuft normal.
  const entry = { ath: 100, athDate: '2025-01-02', refDate: '2026-06-15', refClose: 110, lastClose: 110, lastDate: '2026-06-14', needsReseed: false };
  const series = [{ date: '2026-06-01', close: 105 }, { date: '2026-07-10', close: 130 }];
  const out = upd.advanceEntry(entry, series);
  assert.equal(out.needsReseed, false); // Lücke != Split -> kein Reseed
  assert.equal(out.ath, 130); // ATH laeuft normal weiter
});
test('displayFor: Abstand/Monate korrekt; unter ATH negativ', () => {
  const d = upd.displayFor({ ath: 200, athDate: '2025-07-14', lastClose: 150, lastDate: '2026-07-14', needsReseed: false });
  assert.equal(d.distancePct, -25);
  assert.ok(d.monthsAgo >= 11 && d.monthsAgo <= 13);
});
test('pendingTickers (Kill+Resume): done übersprungen, stale + neue gezogen, --force alles', () => {
  const universe = ['A', 'B', 'C', 'D'];
  const manifest = { done: { A: { at: 'x' }, B: { at: 'x' } } };
  // A braucht einen VORHANDENEN, nicht-stale Entry, sonst waere sie selbst ein Fall des
  // FIX-2-Bugs (done-ohne-Entry) statt des hier gemeinten "sauber done -> skip".
  const state = { entries: { A: { needsReseed: false }, B: { needsReseed: true } } };
  assert.deepEqual(bf.pendingTickers(universe, manifest, state, {}), ['B', 'C', 'D']); // B stale, C/D neu
  assert.deepEqual(bf.pendingTickers(universe, manifest, state, { onlyStale: true }), ['B']);
  assert.deepEqual(bf.pendingTickers(universe, manifest, state, { force: true }), universe);
});
// FIX 2 (Karl-Audit ath-resume, 2026-07-18): wird der Batch zwischen MANIFEST-Write (Z.149)
// und STATE_FILE-Write (Z.151) abgebrochen, ist der Ticker in manifest.done, aber sein
// ath-state-Entry fehlt auf Platte. Ohne den Guard ueberspringt pendingTickers ihn dauerhaft
// (!done[t] ist false) -> ATH bleibt fuer immer null trotz vorhandener Max-Historie.
test('pendingTickers SELF-HEAL: done-aber-ohne-State-Entry wird erneut gezogen (Abbruch zwischen MANIFEST- und STATE-Write)', () => {
  assert.deepEqual(bf.pendingTickers(['C'], { done: { C: { at: 'x' } } }, { entries: {} }, {}), ['C']);
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
