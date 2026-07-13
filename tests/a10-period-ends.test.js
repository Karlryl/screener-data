// A10 (Masterplan 2.3-Vorbedingung, §4b Fundamental-Delivery-IC) — Perioden-Ende-Substrat.
// Beweist am Mapping-Level: timeseries.revenueQEnds ist index-aligned & laengengleich
// zur value-Serie revenueQ, ehrlich null wo kein Datum, FX-invariant, und ein
// price-only-Update loescht die Enden nicht. Framework-los: assert + process.exit.
// Run: node tests/a10-period-ends.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  mapFTSToQuarterly, _isoDay, _alignEnds, _convertSnapshotToUSD,
} = require('../pull-yahoo.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}

// ── _isoDay: akzeptiert alle realen Yahoo-Datumsformen, null bei Unbekanntem ──
check('_isoDay: "YYYY-MM-DD"-String', () => {
  assert.strictEqual(_isoDay('2026-04-30'), '2026-04-30');
  assert.strictEqual(_isoDay('2026-04-30T00:00:00.000Z'), '2026-04-30');
});
check('_isoDay: Date-Objekt', () => {
  assert.strictEqual(_isoDay(new Date('2026-01-31T00:00:00Z')), '2026-01-31');
});
check('_isoDay: epoch-Sekunden (Yahoo endDate.raw)', () => {
  // 2026-04-30 UTC = 1777507200 s
  assert.strictEqual(_isoDay(1777507200), '2026-04-30');
});
check('_isoDay: {raw:epoch}-Wrapper', () => {
  assert.strictEqual(_isoDay({ raw: 1777507200 }), '2026-04-30');
});
check('_isoDay: null/garbage -> null (nie fabrizieren)', () => {
  assert.strictEqual(_isoDay(null), null);
  assert.strictEqual(_isoDay(undefined), null);
  assert.strictEqual(_isoDay('nope'), null);
  assert.strictEqual(_isoDay(NaN), null);
  assert.strictEqual(_isoDay({}), null);
});

// ── mapFTSToQuarterly: Enden index-aligned & laengengleich zu revenueQ ──
// Yahoo liefert FTS-Rows oldest-first; mapFTSToQuarterly reversed → newest-first.
check('FTS: values und Enden gleiche Laenge + index-aligned (newest zuerst)', () => {
  const rows = [
    { date: '2025-07-31', totalRevenue: 100, operatingIncome: 10, grossProfit: 40 },
    { date: '2025-10-31', totalRevenue: 110, operatingIncome: 11, grossProfit: 44 },
    { date: '2026-01-31', totalRevenue: 120, operatingIncome: 12, grossProfit: 48 },
  ];
  const t = mapFTSToQuarterly(rows);
  assert.strictEqual(t.revenueQ.length, t.revenueQEnds.length, 'gleiche Laenge');
  // newest-first: index 0 = 2026-01-31 / rev 120
  assert.strictEqual(t.revenueQ[0].value, 120);
  assert.strictEqual(t.revenueQEnds[0], '2026-01-31');
  assert.strictEqual(t.revenueQ[2].value, 100);
  assert.strictEqual(t.revenueQEnds[2], '2025-07-31');
});

check('FTS: fehlendes Datum -> null-Ende, Index bleibt aligned', () => {
  const rows = [
    { totalRevenue: 100, operatingIncome: 10, grossProfit: 40 }, // kein date
    { date: '2026-01-31', totalRevenue: 120, operatingIncome: 12, grossProfit: 48 },
  ];
  const t = mapFTSToQuarterly(rows);
  assert.strictEqual(t.revenueQ.length, t.revenueQEnds.length);
  assert.strictEqual(t.revenueQEnds[0], '2026-01-31'); // newest hat Datum
  assert.strictEqual(t.revenueQ[1].value, 100);
  assert.strictEqual(t.revenueQEnds[1], null);          // aeltestes ohne Datum -> null
});

check('FTS: trailing-all-null-Trim haelt Enden in Lockstep', () => {
  const rows = [
    { date: '2025-04-30' }, // all-null income (aeltestes nach reverse -> trailing)
    { date: '2025-07-31', totalRevenue: 100, operatingIncome: 10, grossProfit: 40 },
    { date: '2026-01-31', totalRevenue: 120, operatingIncome: 12, grossProfit: 48 },
  ];
  const t = mapFTSToQuarterly(rows);
  // Die trailing all-null Zeile (2025-04-30) wird samt Ende gepoppt.
  assert.strictEqual(t.revenueQ.length, 2);
  assert.strictEqual(t.revenueQEnds.length, 2);
  assert.ok(!t.revenueQEnds.includes('2025-04-30'), 'trailing-Ende mitgetrimmt');
  assert.strictEqual(t.revenueQEnds[0], '2026-01-31');
});

// ── _alignEnds: Cache-Treffer VOR A10 (keine Enden) -> ehrliche null-Serie ──
check('_alignEnds: fehlende Enden -> null-Serie in value-Laenge', () => {
  const values = [{ value: 1 }, { value: 2 }, null];
  assert.deepStrictEqual(_alignEnds(undefined, values), [null, null, null]);
  assert.deepStrictEqual(_alignEnds([], values), [null, null, null]);
});
check('_alignEnds: laengengleiche Enden werden durchgereicht', () => {
  const values = [{ value: 1 }, { value: 2 }];
  const ends = ['2026-01-31', '2025-10-31'];
  assert.strictEqual(_alignEnds(ends, values), ends);
});
check('_alignEnds: laengen-mismatch -> null-Serie (Index-Integritaet vor Daten)', () => {
  const values = [{ value: 1 }, { value: 2 }];
  assert.deepStrictEqual(_alignEnds(['2026-01-31'], values), [null, null]);
});

// ── FX-Konversion laesst Enden unangetastet (ISO bleibt ISO, nie NaN) ──
check('FX: _convertSnapshotToUSD scaled values, aber NICHT die Enden', () => {
  const snap = {
    meta: { reportingCurrency: 'EUR' },
    timeseries: {
      revenueQ: [{ value: 100 }, { value: 90 }],
      revenueQEnds: ['2026-01-31', '2025-10-31'],
    },
  };
  const out = _convertSnapshotToUSD(snap);
  // Enden immer ISO-Strings, keine Zahl, kein NaN — unabhaengig vom FX-Ausgang.
  assert.deepStrictEqual(out.timeseries.revenueQEnds, ['2026-01-31', '2025-10-31']);
  out.timeseries.revenueQEnds.forEach(d => assert.strictEqual(typeof d, 'string'));
  if (out.meta.fxConverted === true) {
    // Loop lief -> values skaliert (Beweis, dass der Ends-Skip wirklich greift).
    assert.notStrictEqual(out.timeseries.revenueQ[0].value, 100);
  }
});

// ── price-only-Update erhaelt die Enden: _priceOnlyUpdate schreibt timeseries nie ──
check('price-only: _priceOnlyUpdate fasst timeseries nicht an', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
  const start = src.indexOf('async function _priceOnlyUpdate(');
  assert.ok(start > -1, '_priceOnlyUpdate gefunden');
  // Funktionskoerper bis zur naechsten top-level "async function " / "function " danach.
  const after = src.slice(start + 30);
  const nextFn = after.search(/\n(?:  )?async function |\n(?:  )?function [A-Za-z_]/);
  const body = nextFn > -1 ? after.slice(0, nextFn) : after;
  assert.ok(!/\btimeseries\b/.test(body),
    'price-only darf timeseries nicht schreiben (Enden bleiben erhalten)');
});

console.log(fail === 0 ? '\nA10 period-ends: ALL PASS' : `\nA10 period-ends: ${fail} FAIL`);
process.exit(fail ? 1 : 0);
