// tests/wertgate-wb4strich.test.js — Standalone-Runner (framework-los).
// Run: node tests/wertgate-wb4strich.test.js
//
// WOFUER: Waechter zu WB-4' — dem am 2026-09-05 vom Master (Delegation 29.08.) als AMENDMENT
// zu WB-4 (Court 02.09.2026) ratifizierten Integritaets-Vorrang in
// scripts/write-board-history.js integritaetsVerfall(). Anlass, gemessen: am ersten Live-Tag
// der Regel (Vintage 2026-09-04 gegen 2026-09-01) waren 14 von 15 Verfallszeilen Fehlalarme
// (Anker agent-reports/orchestrator-2026-09-05-tag.md N3/N6). Council 05.09. (4 Stimmen).
//
// DIE VIER ARME, jeder hier gepinnt UND je einmal absichtlich gebrochen (Anker N9):
//   (a) coverageAxes-Rueckgang = Verfall, AUSSER vollstaendig durch einen fuehrenden Null-Slot
//       erklaert (nur KOPF_ACHSE verloren, Kopf der Eingangsreihe rueckt vor, Null in Slot [0],
//       kein historischer Wert verloren). Ohne axisBreakdown: Verfall (fail-closed).
//   (b) PIT-Reihe gefuellt -> leer/null = Verfall, unveraendert.
//   (c) Lampen-Verlust zaehlt nur fuer Quell-Lampen; freigegeben, wenn der Ticker in den SEC-
//       Jahresreihen steht (Beweis des Upgrades). Die Freigabe ueberstimmt NIE (a)/(b).
//   (d) jeder andere Lampen-Uebergang: Beobachtung ohne Veto, gezaehlt und namentlich (Kanal B).
// Dazu die Betreiber-Auflage: Kopplungs-Zeile (eigener SUSPECT vs. Geschwister-Kopplung) und
// Serien-Alarm nach GATE_SERIE_ALARM_TAGE Tagen ohne Vintage — unabhaengig vom Register.
'use strict';
const assert = require('assert');
const W = require('../scripts/write-board-history.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

const GATE_BODEN = { dailyP99Samples: [], sampleDates: [], threshold: null, frozen: false };
const BOARD = 'energy';
const EINTRAG = { tag: 'Tag X', typ: 'daten-schub', letztesAltesVintage: '2026-09-01', boards: new Set([BOARD]), erklaerendeLampe: null };
const ENDS = ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'];
// Neuer Kopf-Slot: die Reihe wird um EINEN leeren Slot laenger (6 Perioden), kein alter Wert faellt weg.
const ENDS_NEU = ['2026-06-30'].concat(ENDS);
const ACHSEN = ['revGrowthLevel', 'revAcceleration', 'gpGrowth', 'ruleOfX', 'marginTrajectory', 'capitalEfficiency', 'dilution'];
const achsen = (nullKeys) => ACHSEN.map((k) => ({ key: k, pct: (nullKeys || []).includes(k) ? null : 50, weight: 1 }));

function zeile(ticker, score, ueberschreib) {
  return Object.assign({
    ticker, score, coverageAxes: '7/7', lamps: ['lowRoic', 'opIncYahooAdjusted'], axisBreakdown: achsen(),
    pit: { revenueQ: [120, 110, 100, 95, 90], revenueQEnds: ENDS.slice(), grossProfitQ: [60, 55, 50, 48, 45], grossProfitQEnds: ENDS.slice() },
  }, ueberschreib || {});
}
function lage(vorherFelder, nachherFelder) {
  const vorher = [], nachher = [];
  for (let i = 0; i < 300; i++) { vorher.push(zeile('T' + i, 50)); nachher.push(zeile('T' + i, 50.3)); }
  Object.assign(vorher[0], vorherFelder || {});
  Object.assign(nachher[0], nachherFelder || {});
  const v = (rows) => ({ date: null, pitCoverage: { beta: 1 }, cohort: { profitable: rows, unprofitable: [] } });
  return { vorher: v(vorher), nachher: v(nachher) };
}
const gate = (l, opts) => W.evaluateGate(l.nachher, l.vorher, GATE_BODEN, EINTRAG, BOARD, opts);
const verfallVon = (g) => (g.verfallsZeilen.find((z) => z.ticker === 'T0') || {}).feld || null;
const SLOT = { coverageAxes: '6/7', axisBreakdown: achsen(['marginTrajectory']),
  pit: { revenueQ: [null, 120, 110, 100, 95, 90], revenueQEnds: ENDS_NEU.slice(), grossProfitQ: [null, 60, 55, 50, 48, 45], grossProfitQEnds: ENDS_NEU.slice() } };

// ── (a) coverageAxes ────────────────────────────────────────────────────────
check('A1 (Klasse 4): fuehrender Null-Slot, nur marginTrajectory verloren, Kopf rueckt vor -> KEIN Verfall', () => {
  const g = gate(lage({}, SLOT));
  assert.strictEqual(verfallVon(g), null, 'Slot als Verfall gezaehlt');
  assert.ok(!g.suspect, g.reasons.join(','));
});
check('A2: derselbe Slot, aber ZWEI Achsen verloren -> Verfall (benannt)', () => {
  const g = gate(lage({}, Object.assign({}, SLOT, { coverageAxes: '5/7', axisBreakdown: achsen(['marginTrajectory', 'capitalEfficiency']) })));
  assert.ok(/^coverageAxes 7\/7 -> 5\/7 \[marginTrajectory,capitalEfficiency\]/.test(verfallVon(g) || ''), 'Feld: ' + verfallVon(g));
  assert.ok(g.reasons.includes('integritaets-verfall:1'));
});
check('A3: Kopf rueckt NICHT vor (Null im alten Kopf-Slot) -> Verfall', () => {
  const g = gate(lage({}, Object.assign({}, SLOT, { pit: { revenueQ: [null, 110, 100, 95, 90], revenueQEnds: ENDS.slice(), grossProfitQ: [60, 55, 50, 48, 45], grossProfitQEnds: ENDS.slice() } })));
  assert.ok(/^coverageAxes 7\/7 -> 6\/7/.test(verfallVon(g) || ''), 'Feld: ' + verfallVon(g));
});
check('A4: ohne axisBreakdown bleibt der Zaehler-Vergleich fail-closed -> Verfall', () => {
  const g = gate(lage({ axisBreakdown: undefined }, { coverageAxes: '6/7', axisBreakdown: undefined }));
  assert.ok(/^coverageAxes 7\/7 -> 6\/7$/.test(verfallVon(g) || ''), 'Feld: ' + verfallVon(g));
});
check('A5: opIncQ-only-Slot (revenueQ gefuellt, opIncQ[0] null, per opts.quartale) -> KEIN Verfall', () => {
  const felder = { coverageAxes: '6/7', axisBreakdown: achsen(['marginTrajectory']),
    pit: { revenueQ: [125, 120, 110, 100, 95, 90], revenueQEnds: ENDS_NEU.slice(), grossProfitQ: [62, 60, 55, 50, 48, 45], grossProfitQEnds: ENDS_NEU.slice() } };
  const quartale = (t) => (t === 'T0' ? { opIncQ: [null, 30, 28, 25, 24, 22], opIncQEnds: ENDS_NEU.slice() } : null);
  assert.strictEqual(verfallVon(gate(lage({}, felder), { quartale })), null, 'opIncQ-Slot als Verfall gezaehlt');
  assert.ok(/^coverageAxes/.test(verfallVon(gate(lage({}, felder))) || ''), 'ohne quartale-Lookup muss der Fall fail-closed Verfall bleiben');
});
check('A6: Slot, aber ein historischer Wert ging verloren -> Verfall', () => {
  const g = gate(lage({}, Object.assign({}, SLOT, { pit: { revenueQ: [null, 120, 110, null, 95, 90], revenueQEnds: ENDS_NEU.slice(), grossProfitQ: [null, 60, 55, 50, 48, 45], grossProfitQEnds: ENDS_NEU.slice() } })));
  assert.ok(/^coverageAxes/.test(verfallVon(g) || ''), 'Feld: ' + verfallVon(g));
});

// ── (b) Reihen ──────────────────────────────────────────────────────────────
check('B1: PIT-Reihe gefuellt -> leer bleibt Verfall (unveraendert)', () => {
  const g = gate(lage({}, { pit: { revenueQ: [120, 110, 100, 95, 90], revenueQEnds: ENDS.slice(), grossProfitQ: [], grossProfitQEnds: [] } }));
  assert.strictEqual(verfallVon(g), 'grossProfitQ gefuellt -> leer/null');
  assert.ok(g.suspect);
});

// ── (c) Quell-Lampen ────────────────────────────────────────────────────────
check('C1 (Klasse 3): Quell-Lampe verloren, Ticker in SEC -> freigegeben, als Quell-Upgrade protokolliert', () => {
  const g = gate(lage({}, { lamps: ['lowRoic'] }), { secTicker: new Set(['T0']) });
  assert.strictEqual(verfallVon(g), null, 'Upgrade als Verfall gezaehlt');
  assert.deepStrictEqual(g.quellUpgrades, [{ ticker: 'T0', lampen: ['opIncYahooAdjusted'] }]);
  assert.ok(!g.suspect, g.reasons.join(','));
});
check('C2: Quell-Lampe verloren OHNE SEC-Beweis -> Verfall', () => {
  const g = gate(lage({}, { lamps: ['lowRoic'] }));
  assert.strictEqual(verfallVon(g), 'Lampe opIncYahooAdjusted verloren');
  assert.deepStrictEqual(g.quellUpgrades, []);
  assert.ok(g.suspect);
});
check('C3 (Kipp-Arm): Ticker in SEC, aber Reihe geleert -> die Freigabe ueberstimmt (b) NIE', () => {
  const g = gate(lage({}, { lamps: ['lowRoic'], pit: { revenueQ: [], revenueQEnds: [], grossProfitQ: [60, 55, 50, 48, 45], grossProfitQEnds: ENDS.slice() } }), { secTicker: new Set(['T0']) });
  assert.strictEqual(verfallVon(g), 'revenueQ gefuellt -> leer/null');
  assert.ok(g.suspect);
});
check('C4: opIncSynthetisch ist ebenfalls Quell-Lampe (Verlust ohne SEC = Verfall)', () => {
  const g = gate(lage({ lamps: ['opIncSynthetisch'] }, { lamps: [] }));
  assert.strictEqual(verfallVon(g), 'Lampe opIncSynthetisch verloren');
});

// ── (d) Diagnose-Lampen ─────────────────────────────────────────────────────
check('D1 (Klasse 2): Diagnose-Lampe verloren -> kein Verfall, aber gezaehlt und namentlich (Kanal B)', () => {
  const g = gate(lage({ lamps: ['lowRoic', 'fcfArtefact', 'opIncYahooAdjusted'] }, { lamps: ['lowRoic', 'opIncYahooAdjusted'] }));
  assert.strictEqual(verfallVon(g), null, 'Diagnose-Lampe als Verfall gezaehlt');
  assert.deepStrictEqual(g.beobachteteLampen, [{ ticker: 'T0', lampen: ['fcfArtefact'] }]);
  assert.ok(!g.suspect, g.reasons.join(','));
  const res = { date: '2026-09-05', priorDate: '2026-09-01', bruch: { tag: 'Tag X', boards: [BOARD] }, boards: [Object.assign({ board: BOARD }, g)] };
  const z = W.bruchProtokollZeilen(res).find((s) => /DATENSCHUB-ZUSCHLAG/.test(s)) || '';
  assert.ok(/beobachtete Lampen ohne Veto: 1 — T0 \(fcfArtefact\)/.test(z), 'Kanal-B-Zeile: ' + z);
  assert.ok(/Quell-Upgrades \(SEC\): keine/.test(z), 'Kanal-B-Zeile: ' + z);
});

// ── Klasse (1) FTI: unter WB-4' weiterhin SUSPECT — ueber (a) UND (b) ───────
check('FTI-Klasse: Reihe geleert, zwei Jahres-Achsen weg, beide Lampen weg -> Verfall (a UND b), SUSPECT', () => {
  const vorher = { coverageAxes: '6/7', lamps: ['peakMargin', 'opIncYahooAdjusted'], axisBreakdown: achsen(['dilution']) };
  const nachher = { coverageAxes: '4/7', lamps: [], axisBreakdown: achsen(['dilution', 'gpGrowth', 'capitalEfficiency']),
    pit: { revenueQ: [120, 110, 100, 95, 90], revenueQEnds: ENDS.slice(), grossProfitQ: [], grossProfitQEnds: [] } };
  const g = gate(lage(vorher, nachher), { secTicker: new Set(['T0']) });   // selbst MIT SEC-Beweis
  assert.strictEqual(verfallVon(g), 'grossProfitQ gefuellt -> leer/null');
  const nurAchsen = gate(lage(vorher, Object.assign({}, nachher, { pit: zeile('x', 0).pit })), { secTicker: new Set(['T0']) });   // Reihen intakt -> nur Arm (a)
  assert.ok(/^coverageAxes 6\/7 -> 4\/7 \[gpGrowth,capitalEfficiency\]/.test(verfallVon(nurAchsen) || ''), 'Achsen-Arm: ' + verfallVon(nurAchsen));
  assert.ok(g.suspect && nurAchsen.suspect);
});

// ── Betreiber-Auflage: Kopplung sichtbar, Serien-Alarm ──────────────────────
check('K1: Kopplungs-Zeile nennt eigene SUSPECT-Boards und mitgesperrte Geschwister; Serien-Alarm ab > GATE_SERIE_ALARM_TAGE', () => {
  const res = { date: '2026-09-05', priorDate: '2026-09-01', bruch: null, boards: [
    { board: 'energy', suspect: true, gapDays: 5 }, { board: 'utilities', suspect: false, gapDays: 5 }, { board: 'materials', suspect: false, gapDays: 5 }] };
  const z = W.kopplungProtokollZeilen(res);
  assert.strictEqual(z.length, 2, z.join(' | '));
  assert.ok(/GATE KOPPLUNG fuer 2026-09-05: gesperrt durch eigenen SUSPECT: energy; mitgesperrt durch Geschwister-Kopplung .*: 2 Board\(s\) — utilities, materials/.test(z[0]), z[0]);
  assert.ok(/GATE SERIE: 5 Tage ohne gelandetes Vintage \(Vorgaenger 2026-09-01, Schwelle 3 Tage/.test(z[1]), z[1]);
});
check('K2: ohne SUSPECT und innerhalb der Schwelle keine Zeilen; Serien-Alarm auch ohne SUSPECT', () => {
  assert.deepStrictEqual(W.kopplungProtokollZeilen({ date: 'd', priorDate: 'p', bruch: null, boards: [{ board: 'energy', suspect: false, gapDays: 2 }] }), []);
  const z = W.kopplungProtokollZeilen({ date: 'd', priorDate: 'p', bruch: null, boards: [{ board: 'energy', suspect: false, gapDays: 4 }] });
  assert.strictEqual(z.length, 1); assert.ok(/GATE SERIE: 4 Tage/.test(z[0]), z[0]);
});
check('K3: secTickerLesen liest die fuenf SEC-Dateien des Repos und kennt FET/WKC (Upgrade vom 01.09.)', () => {
  const s = W.secTickerLesen(require('path').join(__dirname, '..', 'external-data'));
  assert.ok(s.size > 200, 'nur ' + s.size + ' SEC-Ticker');
  assert.ok(s.has('FET') && s.has('WKC'), 'FET/WKC fehlen — Klasse 3 waere Verfall');
  assert.strictEqual(W.secTickerLesen('/pfad/den/es/nicht/gibt').size, 0, 'fehlende Dateien = kein Beweis');
});

if (fail) { console.log('\nFAIL: wertgate-wb4strich (' + fail + ')'); process.exit(1); }
console.log('\nOK: wertgate-wb4strich (WB-4\' Amendment, Master-Ratifikation 05.09.2026)');
