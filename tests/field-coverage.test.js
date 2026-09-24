'use strict';
/**
 * S49: Charakterisierungs-Tests fuer field-coverage.js (Yahoo-Field-Drift-Detector).
 * Pinnt das beobachtete Verhalten von _internal.isPresent / _internal.getField,
 * computeCoverage, updateHistory, computeBaseline und den Vorrang der drei
 * detectDrift-Durchlaeufe (field-vanished > below-50pct-floor > baseline-drop).
 * Reine Funktionen, kein Netz, kein Dateisystem. Standalone-Runner:
 * node tests/field-coverage.test.js (Exit 0/1).
 *
 * Nur echte TRACKED_FIELDS-Namen verwenden — detectDrift/computeCoverage/
 * computeBaseline iterieren ausschliesslich TRACKED_FIELDS.
 */
const assert = require('node:assert/strict');

const fc = require('../field-coverage.js');
const {
  TRACKED_FIELDS, HISTORY_WINDOW, DROP_THRESHOLD, MIN_HISTORY_FOR_ALERT, ABSOLUTE_FLOOR,
  computeCoverage, updateHistory, computeBaseline, detectDrift,
} = fc;
const { getField, isPresent } = fc._internal;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e.message)); }
}

const F_REV = 'annual.annualRev';
const F_SECTOR = 'meta.sector';

// --- Vorbedingungen: die Konstanten, auf denen die Vorrang-Faelle unten beruhen ---
test('Konstanten: HISTORY_WINDOW=14, DROP_THRESHOLD=0.2, MIN_HISTORY_FOR_ALERT=2, ABSOLUTE_FLOOR=0.5', () => {
  assert.equal(HISTORY_WINDOW, 14);
  assert.equal(DROP_THRESHOLD, 0.20);
  assert.equal(MIN_HISTORY_FOR_ALERT, 2);
  assert.equal(ABSOLUTE_FLOOR, 0.50);
  assert.ok(TRACKED_FIELDS.includes(F_REV), F_REV + ' muss ein TRACKED_FIELD sein');
  assert.ok(TRACKED_FIELDS.includes(F_SECTOR), F_SECTOR + ' muss ein TRACKED_FIELD sein');
});

// --- isPresent-Matrix ---
test('isPresent: null, undefined, leerer String, NaN -> false', () => {
  assert.equal(isPresent(null), false);
  assert.equal(isPresent(undefined), false);
  assert.equal(isPresent(''), false);
  assert.equal(isPresent(NaN), false);
});
test('isPresent: 0, false, "x", {} -> true (falsy-aber-vorhanden zaehlt)', () => {
  assert.equal(isPresent(0), true);
  assert.equal(isPresent(false), true);
  assert.equal(isPresent('x'), true);
  assert.equal(isPresent({}), true);
});
test('isPresent: [], [null], [{value:null}], [{value:NaN}] -> false (Platzhalter-Arrays)', () => {
  assert.equal(isPresent([]), false);
  assert.equal(isPresent([null]), false);
  assert.equal(isPresent([{ value: null }]), false);
  assert.equal(isPresent([{ value: NaN }]), false);
});
test('isPresent: [{value:1}], [1], [{}] -> true (ein endlicher/objekt-Eintrag genuegt)', () => {
  assert.equal(isPresent([{ value: 1 }]), true);
  assert.equal(isPresent([1]), true);
  assert.equal(isPresent([{}]), true);
  assert.equal(isPresent([null, { value: 2 }]), true);
});

// --- getField ---
test('getField: verschachtelter Pfad liefert den Blattwert', () => {
  assert.equal(getField({ a: { b: { c: 5 } } }, 'a.b.c'), 5);
  assert.equal(getField({ meta: { sector: 'Tech' } }, F_SECTOR), 'Tech');
});
test('getField: fehlender Zwischenknoten -> undefined ohne Wurf', () => {
  let out;
  assert.doesNotThrow(() => { out = getField({ a: {} }, 'a.b.c'); });
  assert.equal(out, undefined);
  assert.equal(getField({ a: { b: null } }, 'a.b.c'), undefined);
});
test('getField: null-/undefined-Wurzel -> undefined', () => {
  assert.equal(getField(null, 'a.b'), undefined);
  assert.equal(getField(undefined, 'a.b'), undefined);
});

// --- computeCoverage ---
test('computeCoverage: leere Liste / null -> jedes TRACKED_FIELD 0', () => {
  const cov = computeCoverage([]);
  for (const f of TRACKED_FIELDS) assert.equal(cov[f], 0, f + ' muss 0 sein');
  assert.deepEqual(computeCoverage(null), cov);
});
test('computeCoverage: 2 von 4 Snapshots mit Wert -> 0.5', () => {
  const snaps = [
    { meta: { sector: 'Tech' }, annual: { annualRev: [{ value: 1 }] } },
    { meta: { sector: '' },     annual: { annualRev: [{ value: null }] } },
    { meta: { sector: 'Fin' },  annual: { annualRev: [{ value: 2 }] } },
    { meta: {},                 annual: {} },
  ];
  const cov = computeCoverage(snaps);
  assert.equal(cov[F_SECTOR], 0.5);
  assert.equal(cov[F_REV], 0.5);
  assert.equal(cov['meta.industry'], 0);
});
test('computeCoverage: Ergebnis hat genau die TRACKED_FIELDS-Schluessel', () => {
  const cov = computeCoverage([{ meta: { sector: 'Tech', fremd: 1 }, extra: 1 }]);
  assert.deepEqual(Object.keys(cov).sort(), [...TRACKED_FIELDS].sort());
  assert.equal(Object.keys(cov).length, TRACKED_FIELDS.length);
});

// --- updateHistory ---
function mitWarnStub(fn) {
  const calls = [];
  const orig = console.warn;
  console.warn = (...args) => { calls.push(args); };
  try { return fn(calls); } finally { console.warn = orig; }
}
test('updateHistory: Nicht-Array-History -> [entry], keine Warnung', () => {
  const entry = { ts: 1, coverage: {} };
  mitWarnStub((calls) => {
    assert.deepEqual(updateHistory(undefined, entry), [entry]);
    assert.deepEqual(updateHistory(null, entry), [entry]);
    assert.deepEqual(updateHistory('kaputt', entry), [entry]);
    assert.equal(calls.length, 0);
  });
});
test('updateHistory: 14 vorhandene + 1 neu -> 14, aeltester faellt, console.warn genau einmal', () => {
  const history = Array.from({ length: 14 }, (_, i) => ({ ts: i }));
  const neu = { ts: 99 };
  mitWarnStub((calls) => {
    const out = updateHistory(history, neu);
    assert.equal(out.length, HISTORY_WINDOW);
    assert.equal(out[0].ts, 1, 'aeltester Eintrag (ts=0) faellt weg');
    assert.equal(out[out.length - 1].ts, 99, 'neuer Eintrag ist der letzte');
    assert.equal(calls.length, 1, 'genau eine Warnung');
    assert.equal(calls[0][0], 'fieldCoverage: history truncated from');
    assert.equal(calls[0][1], 15);
    assert.equal(calls[0][3], 14);
  });
});
test('updateHistory: 13 vorhandene + 1 neu -> 14, keine Kuerzung, keine Warnung', () => {
  const history = Array.from({ length: 13 }, (_, i) => ({ ts: i }));
  mitWarnStub((calls) => {
    const out = updateHistory(history, { ts: 13 });
    assert.equal(out.length, 14);
    assert.equal(out[0].ts, 0);
    assert.equal(calls.length, 0);
  });
});

// --- computeBaseline ---
test('computeBaseline: 1 Eintrag / leer / Nicht-Array -> {}', () => {
  assert.deepEqual(computeBaseline([{ coverage: { [F_REV]: 0.9 } }]), {});
  assert.deepEqual(computeBaseline([]), {});
  assert.deepEqual(computeBaseline(null), {});
});
test('computeBaseline: letzter Eintrag (aktueller Run) ist ausgeschlossen', () => {
  const hist = [
    { coverage: { [F_REV]: 0.8 } },
    { coverage: { [F_REV]: 0.6 } },
    { coverage: { [F_REV]: 0.0 } }, // aktueller Run — darf das Mittel nicht ziehen
  ];
  assert.equal(computeBaseline(hist)[F_REV], 0.7);
});
test('computeBaseline: Eintrag ohne .coverage oder mit Nicht-Zahl wird ignoriert', () => {
  const hist = [
    { coverage: { [F_REV]: 0.4 } },
    null,
    { ts: 1 },
    { coverage: { [F_REV]: 'n/a' } },
    { coverage: { [F_REV]: null } },
    { coverage: { [F_REV]: 0.2 } },
    { coverage: { [F_REV]: 0.99 } }, // aktueller Run
  ];
  const base = computeBaseline(hist);
  assert.equal(Math.round(base[F_REV] * 1e9) / 1e9, 0.3);
});
test('computeBaseline: Feld ohne numerische Werte fehlt im Ergebnis', () => {
  const hist = [
    { coverage: { [F_REV]: 0.5 } },
    { coverage: { [F_REV]: 0.5, [F_SECTOR]: 0.9 } }, // aktueller Run — sector nur hier
  ];
  const base = computeBaseline(hist);
  assert.equal(base[F_REV], 0.5);
  assert.equal(Object.prototype.hasOwnProperty.call(base, F_SECTOR), false);
  assert.deepEqual(Object.keys(base), [F_REV]);
});
test('computeBaseline: Mittelwert numerisch korrekt ueber mehrere Eintraege', () => {
  const hist = [
    { coverage: { [F_SECTOR]: 1.0 } },
    { coverage: { [F_SECTOR]: 0.5 } },
    { coverage: { [F_SECTOR]: 0.25 } },
    { coverage: { [F_SECTOR]: 0.25 } },
    { coverage: { [F_SECTOR]: 0.0 } }, // aktueller Run
  ];
  assert.equal(computeBaseline(hist)[F_SECTOR], 0.5);
});

// --- detectDrift: Vorrang der drei Durchlaeufe ---
test('detectDrift: base 0.9 / cur 0.4 -> genau EIN Eintrag below-50pct-floor (HIGH), kein Doppel als baseline-drop', () => {
  const drifts = detectDrift({ [F_REV]: 0.4 }, { [F_REV]: 0.9 });
  assert.equal(drifts.length, 1);
  assert.deepEqual(drifts[0], {
    field: F_REV, current: 0.4, baseline: 0.9, drop: 0.5, severity: 'HIGH', reason: 'below-50pct-floor',
  });
});
test('detectDrift: base 0.4 / cur 0.1 -> nur baseline-drop (MEDIUM); Floor unterdrueckt, da base < 0.5', () => {
  const drifts = detectDrift({ [F_REV]: 0.1 }, { [F_REV]: 0.4 });
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].reason, 'baseline-drop');
  assert.equal(drifts[0].severity, 'MEDIUM');
  assert.equal(drifts[0].drop, 0.3);
});
test('detectDrift: base 0.9 / cur 0.75 -> leer (drop 0.15 < DROP_THRESHOLD, cur ueber Floor)', () => {
  assert.deepEqual(detectDrift({ [F_REV]: 0.75 }, { [F_REV]: 0.9 }), []);
});
test('detectDrift: base 0.1 / cur 0 -> field-vanished (HIGH) mit drop 0.1', () => {
  const drifts = detectDrift({ [F_REV]: 0 }, { [F_REV]: 0.1 });
  assert.equal(drifts.length, 1);
  assert.deepEqual(drifts[0], {
    field: F_REV, current: 0, baseline: 0.1, drop: 0.1, severity: 'HIGH', reason: 'field-vanished',
  });
});
test('detectDrift: fehlende Baseline (Kaltstart) -> leer, auch bei cur 0 oder cur unter Floor', () => {
  assert.deepEqual(detectDrift({ [F_REV]: 0 }, {}), []);
  assert.deepEqual(detectDrift({ [F_REV]: 0.1 }, {}), []);
  assert.deepEqual(detectDrift({ [F_REV]: 0.1 }, { [F_REV]: 'n/a' }), []);
});
test('detectDrift: Rundung auf 2 Nachkommastellen (base 0.123456 -> 0.12; cur 0.456789 -> 0.46)', () => {
  const vanished = detectDrift({ [F_REV]: 0 }, { [F_REV]: 0.123456 });
  assert.equal(vanished[0].baseline, 0.12);
  assert.equal(vanished[0].drop, 0.12);
  const floor = detectDrift({ [F_SECTOR]: 0.456789 }, { [F_SECTOR]: 0.9 });
  assert.equal(floor[0].reason, 'below-50pct-floor');
  assert.equal(floor[0].current, 0.46);
  assert.equal(floor[0].drop, 0.44);
});
test('detectDrift: nur TRACKED_FIELDS werden betrachtet; mehrere Felder liefern je einen Eintrag', () => {
  const drifts = detectDrift(
    { [F_REV]: 0, [F_SECTOR]: 0.4, 'nicht.getrackt': 0 },
    { [F_REV]: 0.8, [F_SECTOR]: 0.9, 'nicht.getrackt': 0.9 },
  );
  assert.equal(drifts.length, 2);
  assert.deepEqual(drifts.map(d => [d.field, d.reason]), [
    [F_REV, 'field-vanished'],
    [F_SECTOR, 'below-50pct-floor'],
  ]);
});

console.log(`\nfield-coverage: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
