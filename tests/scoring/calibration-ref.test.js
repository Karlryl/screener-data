'use strict';
/**
 * 2.9 Slice 2 — Referenz-Scoring-Modus (der T1-Fix). scoreUniverse(u, f, {refCalibration}) scort
 * gegen ein EINGEFRORENES Lineal statt neu zu lernen. Drei Beweise:
 *  (1) REPLAY: gleiches Universum live -> calibration -> ref-Lauf gegen die -> identische Scores.
 *  (2) GROWN-UNIVERSE (der eigentliche Korrektheitsbeweis): Lineal auf Teil-Universum A einfrieren,
 *      dann A∪B im ref-Modus scoren -> jeder A-Name behaelt EXAKT seinen Score (Universe-Ausbau
 *      verschiebt bestehende Scores nicht mehr — genau der T1-Architektur-Befund). MUSS einen
 *      subCohortByProfit-Namen (it-services/real-estate) enthalten (capitalEfficiency-Fehlerquelle #1).
 *  (3) DRIFT: calibrationDrift(identisch) -> ok; synthetisch verschobene Basis -> feuert.
 *
 * Usage:  node tests/scoring/calibration-ref.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse, calibrationDrift } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

// SCREENER_SNAPSHOTS_DIR: nur Test-Seam (wie score.integration/anchors.rank) — laesst den
// Leer-Universum-Waechter in tests/skip-honesty.test.js ein leeres Verzeichnis injizieren;
// ohne die Variable unveraendert das echte snapshots/.
const SNAP_DIR = process.env.SCREENER_SNAPSHOTS_DIR || path.join(__dirname, '..', '..', 'snapshots');
const universe = [];
// snapFiles = Rohdatei-Zahl im Verzeichnis. universe zaehlt nur die JSON.parse+meta.ticker-Ueberlebenden;
// ohne die Rohzahl sehen "Verzeichnis leer" und "Tausende Dateien, aber Schema unlesbar" gleich aus.
let snapFiles = 0;
try {
  const files = fs.readdirSync(SNAP_DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'));
  snapFiles = files.length;
  for (const f of files) {
    try { const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); if (s && s.meta && s.meta.ticker) universe.push(s); } catch (_) { /* defekt -> skip */ }
  }
} catch (_) { /* snapshots/ fehlt (pre-pull-Gate) */ }

if (universe.length < 100) {
  // P1-Chunk 4 Stufe 1 (Tag 623): sichtbar statt still — console.log direkt auf stdout (F2964).
  console.log(`::warning::calibration-ref.test.js: ${snapFiles} Dateien im Snapshot-Verzeichnis, davon ${universe.length} lesbar (<100 noetig) — leeres Universum ODER Schema unlesbar. Alle Referenz-/Drift-/Merge-Tests wurden NICHT gemessen; diese Suite meldet gruen, ohne etwas geprueft zu haben.`);
  console.log('  (Universum < 100 -> Referenz-Anker uebersprungen, KEIN Fail)');
  console.log('calibration-ref.test.js: 0 ok, 0 fail (skipped: kein Universum)');
  process.exit(0);
}

console.log(`  (Universum: ${universe.length} Snapshots geladen)`);
const roundtrip = (o) => JSON.parse(JSON.stringify(o)); // simuliert den calibration.json-Datei-Weg
const routedScores = (results) => {
  const m = new Map();
  for (const e of results) if (e.action === 'route' && Number.isFinite(e.score)) m.set(e.ticker, e.score);
  return m;
};
const routedMeta = (results) => {
  const m = new Map();
  for (const e of results) if (e.action === 'route' && Number.isFinite(e.score)) m.set(e.ticker, e.formulaId);
  return m;
};

// (1) REPLAY: gleiches Universum, live -> ref(calFull) -> identisch.
test('Replay-Determinismus: ref-Lauf gegen das eigene Lineal == live-Lauf (Score-exakt)', () => {
  const live = scoreUniverse(universe, formulas);
  const calFull = roundtrip(live.calibration);
  const replay = scoreUniverse(universe, formulas, { refCalibration: calFull });
  const a = routedScores(live), b = routedScores(replay);
  assert.equal(a.size, b.size, 'gleiche Menge gerouteter Namen');
  assert.ok(a.size > 100, 'nicht-triviale Menge');
  let mism = 0;
  for (const [t, s] of a) if (b.get(t) !== s) mism++;
  assert.equal(mism, 0, `${mism} Score-Abweichungen im Replay (muss 0 sein)`);
});

// (2) GROWN-UNIVERSE: Lineal auf A einfrieren, A∪B ref -> A-Namen exakt unveraendert.
// A = jeder 2. Name (interleaved) -> beide Haelften tragen alle Sektoren/Kohorten inkl. it-services/real-estate.
const A = universe.filter((_, i) => i % 2 === 0);
const runA = scoreUniverse(A, formulas);
const scoreA = routedScores(runA);
const metaA = routedMeta(runA);
const calA = roundtrip(runA.calibration);
const grown = scoreUniverse(universe, formulas, { refCalibration: calA });
const scoreGrown = routedScores(grown);

test('Grown-Universe: A-Namen behalten im ref(A)-Lauf ueber A∪B EXAKT ihren Score', () => {
  let compared = 0, mism = 0;
  for (const [t, s] of scoreA) {
    if (!scoreGrown.has(t)) continue; // Routing kann sich durch B aendern (dup-issuer) -> nur Schnittmenge
    compared++;
    if (scoreGrown.get(t) !== s) mism++;
  }
  assert.ok(compared > 200, `nicht-triviale Schnittmenge (${compared} Namen)`);
  assert.equal(mism, 0, `${mism}/${compared} A-Namen driften beim Universe-Ausbau (muss 0 sein — der T1-Fix)`);
});

test('Grown-Universe deckt die capitalEfficiency-Sub-Kohorte ab (it-services/real-estate)', () => {
  // subCohortByProfit-Boards aus der formulas-Map (Objekt, kein Array) ableiten.
  const subCohortIds = new Set(Object.entries(formulas).filter(([, f]) => f && f.subCohortByProfit).map(([id]) => id));
  assert.ok(subCohortIds.size > 0, 'es gibt subCohortByProfit-Formeln');
  let covered = 0;
  for (const [t] of scoreA) {
    if (scoreGrown.has(t) && subCohortIds.has(metaA.get(t))) covered++;
  }
  assert.ok(covered > 0, `mind. ein subCohortByProfit-Name (${[...subCohortIds].join('/')}) im Grown-Universe-Vergleich (capitalEfficiency-Pfad geprueft)`);
});

// (3) DRIFT-Waechter.
test('Drift: identisches Lineal -> maxKs 0, ok=true', () => {
  const d = calibrationDrift(calA, calA);
  assert.equal(d.ok, true);
  assert.ok(d.maxKs < 1e-9, `maxKs ~0 (war ${d.maxKs})`);
});

test('Drift: synthetisch verschobene Basis -> feuert (ok=false, drifted nicht leer)', () => {
  const shifted = roundtrip(calA);
  // eine beliebige Kohorten-Achse massiv verschieben
  const key = Object.keys(shifted.cohortBases)[0];
  const ax = Object.keys(shifted.cohortBases[key].axes)[0];
  shifted.cohortBases[key].axes[ax] = shifted.cohortBases[key].axes[ax].map((v) => (Number.isFinite(v) ? v + 1e6 : v));
  const d = calibrationDrift(shifted, calA);
  assert.equal(d.ok, false, 'verschobene Basis muss anschlagen');
  assert.ok(d.drifted.length > 0 && d.maxKs > 0.15, `drifted=${d.drifted.length} maxKs=${d.maxKs}`);
});

// (4) 2.11 Stufe B FAIL-LOUD (Verify-T2): ein pre-v4-Lineal (ohne gDistByCohort) darf NICHT still gegen die
// Live-Wachstums-Verteilung scoren (das de-friere ~600 Board-Scores beim Universe-Ausbau) -> harter Abbruch.
test('Fail-loud: refCalibration ohne gDistByCohort (pre-v4) -> scoreUniverse wirft', () => {
  const preV4 = roundtrip(runA.calibration);
  delete preV4.gDistByCohort; // simuliert ein altes Lineal von VOR 2.11 Stufe B
  assert.throws(() => scoreUniverse(universe, formulas, { refCalibration: preV4 }), /gDistByCohort|v4/,
    'ein pre-v4-Lineal muss hart abbrechen statt still gegen die Live-Verteilung zu scoren');
});

// (4b) R2.7 (Court E-20260717-5): FAIL-LOUD fuer ein UNVOLLSTAENDIGES (achsen-luecken-haftes) Lineal.
// Ein Lineal, dem eine Achse der aktuellen formulas-Version fehlt (Code neuer als das Lineal), darf NICHT
// still gegen die Live-Verteilung scoren (score.js:626 faellt auf rawByAxis, parentBasis droppt die Achse
// per `if(!Array.isArray) continue`) -> harter Abbruch VOR jeder Emission. RULER-ZENTRISCH geprueft: der
// Guard iteriert refCal.cohortBases direkt, faengt also auch eine NUR im Lineal vorhandene Kohorte (Test B),
// waehrend eine im Lineal KOMPLETT fehlende (=live-neue) Kohorte den gewollten Live-Fallback behaelt (Test C).
// Ticker -> cohortKey (formulaId|track) aus einem Live-Vollauf — fuer Test B (eine Kohorte live entfernen).
const keyByTicker = new Map();
for (const e of scoreUniverse(universe, formulas)) {
  if (e.action === 'route' && e.formulaId && e.track) keyByTicker.set(e.ticker, e.formulaId + '|' + e.track);
}

test('R2.7 Test A — Achsen-Key aus einer Lineal-Kohorte geloescht -> scoreUniverse wirft', () => {
  const shifted = roundtrip(calA);
  const key = Object.keys(shifted.cohortBases)[0];
  const ax = Object.keys(shifted.cohortBases[key].axes)[0];
  delete shifted.cohortBases[key].axes[ax];
  assert.throws(() => scoreUniverse(universe, formulas, { refCalibration: shifted }), /Achse|axes/,
    'ein Lineal ohne vollstaendige Achsen-Liste muss hart abbrechen statt still gegen die Live-Verteilung zu scoren');
});

test('R2.7 Test B — NUR-im-Lineal-Kohorte (live entfernt) mit Achsen-Luecke -> wirft (parentBasis-Haertung)', () => {
  const shifted = roundtrip(calA);
  const keys = Object.keys(shifted.cohortBases);
  // bevorzugt eine live-vorhandene Kohorte (dann koennen wir ihre Live-Namen entfernen); sonst die erste.
  const liveKeys = new Set(keyByTicker.values());
  const key = keys.find((k) => liveKeys.has(k)) || keys[0];
  const drop = new Set([...keyByTicker.entries()].filter(([, k]) => k === key).map(([t]) => t));
  const uni = universe.filter((s) => !drop.has(s.meta.ticker)); // Kohorte live entfernen -> nur noch im Lineal
  const ax = Object.keys(shifted.cohortBases[key].axes)[0];
  delete shifted.cohortBases[key].axes[ax];
  assert.throws(() => scoreUniverse(uni, formulas, { refCalibration: shifted }), /Achse|axes/,
    'der Guard prueft auch eine NUR im Lineal vorhandene (live entfernte) Kohorte — der live-zentrische Brief-Guard haette sie verpasst');
});

test('R2.7 Test C — komplett fehlende (=live-neue) Kohorte im Lineal wirft NICHT (Grown-Universe-Schutz)', () => {
  const shifted = roundtrip(calA);
  const key = Object.keys(shifted.cohortBases)[0];
  delete shifted.cohortBases[key]; // Kohorte GANZ aus dem Lineal -> im vollen Universum "neu" -> gewollter Live-Fallback
  assert.doesNotThrow(() => scoreUniverse(universe, formulas, { refCalibration: shifted }),
    'eine im Lineal komplett fehlende (=neue) Kohorte darf NICHT werfen — gewollter Live-Fallback');
});

// (4c) Hard-Review U-SC-002: ein FINITES, aber unplausibles n (n:0.5 bzw. n<0 aus einem beschaedigten
// Lineal-Artefakt) bestand bisher nur den Number.isFinite-Guard bei der Shrinkage-Berechnung (score.js
// ~957) und verschob still den Fallback-Entscheid/die EB-Shrinkage. n ist strukturell ein nicht-negativer
// Integer -- der Guard-Block prueft das jetzt VOR jeder Emission, analog zum Achsen-Luecken-Guard oben.
test('U-SC-002 Test A — Lineal-Kohorte mit n=0.5 (nicht-Integer) -> scoreUniverse wirft', () => {
  const shifted = roundtrip(calA);
  const key = Object.keys(shifted.cohortBases)[0];
  shifted.cohortBases[key].n = 0.5;
  assert.throws(() => scoreUniverse(universe, formulas, { refCalibration: shifted }), /unplausibles n/,
    'ein nicht-integer n ist ein defektes Lineal-Artefakt, kein gueltiger gefrorener Zustand');
});
test('U-SC-002 Test B — Lineal-Kohorte mit n=-3 (negativ) -> scoreUniverse wirft', () => {
  const shifted = roundtrip(calA);
  const key = Object.keys(shifted.cohortBases)[0];
  shifted.cohortBases[key].n = -3;
  assert.throws(() => scoreUniverse(universe, formulas, { refCalibration: shifted }), /unplausibles n/,
    'eine negative Kohortengroesse ist strukturell unmoeglich');
});
test('U-SC-002 Test C — Lineal-Kohorte OHNE n-Feld wirft NICHT (Schema-Evolution, entries.length-Fallback)', () => {
  const shifted = roundtrip(calA);
  const key = Object.keys(shifted.cohortBases)[0];
  delete shifted.cohortBases[key].n;
  assert.doesNotThrow(() => scoreUniverse(universe, formulas, { refCalibration: shifted }),
    'fehlendes n ist ein toleriertes aelteres Schema (score.js faellt auf entries.length zurueck), kein Fehler');
});

// (5) 2.11 Stufe B: Drift-Waechter faengt gDistByCohort-Drift (nicht nur cohortBases-Achsen).
test('Drift: verschobene gDistByCohort -> feuert (Verify-T2-Haertung)', () => {
  const shifted = roundtrip(calA);
  const key = Object.keys(shifted.gDistByCohort)[0];
  shifted.gDistByCohort[key] = shifted.gDistByCohort[key].map((v) => (Number.isFinite(v) ? v + 1e6 : v));
  const d = calibrationDrift(shifted, calA);
  assert.equal(d.ok, false, 'verschobene gDistByCohort muss den Waechter ausloesen');
  assert.ok(d.drifted.some((x) => x.axis === 'gDist'), 'ein gDist-Drift-Eintrag muss auftauchen');
});

// ============================================================================
// R2.9 (Court E-20260717-5): VERKETTUNGS-DRIFT. Der Emissionsblock in score.js
// (~Z.778-780) reichte cohortBases/gDist/gDistByCohort im Ref-Modus LIVE durch
// statt sie per-Kohorte-Key gegen das Lineal zu mergen -> das gefrorene Lineal
// de-friert am ZWEITEN Kettenglied. Zwei Beweise, die zusammen NUR der korrekte
// Per-Key-Merge gruen faerbt:
//   Test A — 2-Hop-Kette: A-Namen halten ueber zwei Ref-Laeufe EXAKT ihren Score.
//            (rot auf dem Ist-Stand: Live-Emission driftet; das eigentliche R2.9)
//   Test B — neue Kohorte: ein im Lineal fehlender, im gewachsenen Universum
//            praesenter Kohorten-Key MUSS mit LIVE-Basis im Artefakt bleiben.
//            (rot gegen einen falsch gebauten Ganzobjekt-Ternary, der ihn verliert)
// ============================================================================

// Test A — 2-Hop-Kette. chimera1 = das calibration.json, das run-screener.js:214 nach
// dem ERSTEN Ref-Lauf (grown, oben) schreiben wuerde; grown2 = der zweite Ref-Lauf dagegen.
const chimera1 = roundtrip(grown.calibration);
const grown2 = scoreUniverse(universe, formulas, { refCalibration: chimera1 });
const scoreGrown2 = routedScores(grown2);
test('R2.9 Test A — 2-Hop-Kette: A-Namen halten ueber zwei Ref-Kettenglieder EXAKT ihren Score', () => {
  let compared = 0, mism = 0, maxAbs = 0;
  for (const [t, s] of scoreA) {
    if (!scoreGrown2.has(t)) continue; // nur Schnittmenge (Routing kann sich durch B verschieben)
    compared++;
    const g2 = scoreGrown2.get(t);
    if (g2 !== s) { mism++; const d = Math.abs(g2 - s); if (d > maxAbs) maxAbs = d; }
  }
  console.log(`       [R2.9-A] compared=${compared} drift=${mism} maxAbs=${maxAbs.toFixed(2)}`);
  assert.ok(compared > 0, `nicht-triviale Schnittmenge (${compared})`);
  assert.equal(mism, 0, `${mism}/${compared} A-Namen driften am 2. Kettenglied (maxAbs ${maxAbs.toFixed(2)}) — muss 0 sein`);
});

// Test B — neue Kohorte darf NICHT aus dem Artefakt fallen. Ziel-Kohorte K aus dem
// vollen Universum (via `grown`) waehlen und aus A entfernen -> K fehlt im Lineal
// calA_edge, taucht im gewachsenen (vollen) Universum wieder auf.
const keyOf = (e) => e.formulaId + '|' + e.track;
const fullKeyTickers = new Map(); // K -> Set(ticker), aus dem vollen Ref-Lauf `grown`
for (const e of grown) {
  if (e.action === 'route' && Number.isFinite(e.score) && e.formulaId && e.track) {
    const k = keyOf(e);
    if (!fullKeyTickers.has(k)) fullKeyTickers.set(k, new Set());
    fullKeyTickers.get(k).add(e.ticker);
  }
}
// kleinste normale Kohorte (in beiden Artefakt-Maps von chimera1) waehlen -> minimale Entfernung.
const cb1 = chimera1.cohortBases || {}, gd1 = chimera1.gDistByCohort || {};
let edgeKey = null, edgeTix = null;
for (const [k, tix] of [...fullKeyTickers.entries()].sort((a, b) => a[1].size - b[1].size)) {
  if (cb1[k] && gd1[k]) { edgeKey = k; edgeTix = tix; break; }
}
const Aedge = edgeTix ? universe.filter((s) => !edgeTix.has(s.meta.ticker)) : universe;
const calAedge = roundtrip(scoreUniverse(Aedge, formulas).calibration);
const chimeraEdge = roundtrip(scoreUniverse(universe, formulas, { refCalibration: calAedge }).calibration);
test('R2.9 Test B — neue Kohorte behaelt LIVE-Basis im Artefakt (Ganzobjekt-Ternary-Falle)', () => {
  assert.ok(edgeKey, 'eine Ziel-Kohorte K gefunden');
  // Vorbedingung: K fehlt im Lineal (kein stiller Skip — der Fail nennt die Ursache).
  assert.ok(!(calAedge.cohortBases && calAedge.cohortBases[edgeKey]),
    `Vorbedingung: Kohorte ${edgeKey} fehlt in calA_edge.cohortBases`);
  assert.ok(!(calAedge.gDistByCohort && calAedge.gDistByCohort[edgeKey]),
    `Vorbedingung: Kohorte ${edgeKey} fehlt in calA_edge.gDistByCohort`);
  // Kern: die im Lineal fehlende, im vollen Universum praesente Kohorte MUSS live im Artefakt stehen.
  const cb = chimeraEdge.cohortBases && chimeraEdge.cohortBases[edgeKey];
  assert.ok(cb, `chimeraEdge.cohortBases[${edgeKey}] existiert (nicht aus dem Artefakt verloren)`);
  assert.ok(cb.axes && Object.keys(cb.axes).length > 0, `${edgeKey}: axes nicht-leer (live-Basis)`);
  assert.ok(Number.isFinite(cb.n), `${edgeKey}: n finite`);
  const gd = chimeraEdge.gDistByCohort && chimeraEdge.gDistByCohort[edgeKey];
  assert.ok(Array.isArray(gd) && gd.length > 0, `chimeraEdge.gDistByCohort[${edgeKey}] existiert (live)`);
});

// ============================================================================
// COURT-NACHTRAG zu Tag 336 (E-20260717-5): zwei am Substrat belegte Funde am
// mergeFrozenByKey-Emissionsblock. Beide pinnen das ECHTE run-screener-Wiring,
// nicht nur die Funktion.
//   F-A [T1-Regression] — der Drift-Waechter (run-screener.js:165) fuetterte das
//        frozen-gemergte Emit (results.calibration) statt der roh-live erfassten
//        Vor-Merge-Verteilungen. Jede geteilte Kohorte wird so VERBATIM gegen sich
//        selbst verglichen -> ksDistance(ref,ref)=0 -> maxKs strukturell 0 -> der
//        einzige Alarm gegen ein veraltetes Lineal ist tot. Fix: results.calibrationLive
//        (non-enumerable) mit { cohortBases: capturedCohortBases, gDistByCohort } roh-live.
//   F-B [T3] — mergeFrozenByKey iterierte nur Object.keys(live); eine im Lineal
//        praesente, im (transient) Live-Universum leere Kohorte fiel still aus dem
//        Artefakt = De-Freeze am naechsten Kettenglied. Fix: UNION(frozen,live),
//        Frozen gewinnt. Spiegelbild zu R2.9 Test B.
// ============================================================================

// F-A — pinnt die ARGUMENT-QUELLE des Drift-Waechters, nicht nur calibrationDrift.
// verschoben-aber-vollstaendiges Lineal: calA klonen, EINE Achse EINER auch live
// besetzten Kohorte um +1e6 auf ALLEN Werten verschieben; alle Achsen-Keys UND
// gDistByCohort intakt lassen (sonst wirft der R2.7- bzw. R2.11-Guard vor der Emission).
test('F-A — Drift-Waechter liest roh-live (calibrationLive), nicht das frozen-gemergte Emit', () => {
  const shiftedRuler = roundtrip(calA);
  const liveKeys = new Set(keyByTicker.values());
  const rulerKeys = Object.keys(shiftedRuler.cohortBases);
  const key = rulerKeys.find((k) => liveKeys.has(k)) || rulerKeys[0]; // Kohorte, die auch live besetzt ist
  const ax = Object.keys(shiftedRuler.cohortBases[key].axes)[0];
  shiftedRuler.cohortBases[key].axes[ax] = shiftedRuler.cohortBases[key].axes[ax].map((v) => (Number.isFinite(v) ? v + 1e6 : v));
  const r = scoreUniverse(universe, formulas, { refCalibration: shiftedRuler });
  // (a) der HEUTE verdrahtete Pfad ist per Konstruktion blind: das frozen-gemergte Emit traegt die
  //     Kohorte VERBATIM aus dem Lineal -> Vergleich gegen sich selbst -> KS 0 -> ok=true. Dokumentiert
  //     den Regressions-Pfad (gilt vor UND nach dem Fix -> keine Rot-Quelle, nur Beleg).
  const blind = calibrationDrift(r.calibration, shiftedRuler);
  assert.equal(blind.ok, true, 'frozen-gemergtes Emit ist gegen sein eigenes Lineal driftfrei — der blinde Pfad');
  // (b) der KORREKTE Pfad: roh-live gegen das verschobene Lineal MUSS feuern.
  //     ROT-VORHER (Tag 337): r.calibrationLive existiert nicht -> calibrationDrift(undefined,..) liefert
  //     maxKs 0/ok=true -> diese Assertion faellt. GRUEN-NACHHER: KS ~1 auf der verschobenen Achse.
  const live = calibrationDrift(r.calibrationLive, shiftedRuler);
  assert.equal(live.ok, false, 'roh-live (calibrationLive) gegen das +1e6-verschobene Lineal muss den Waechter ausloesen');
  assert.ok(live.drifted.some((x) => x.cohort === key && x.axis === ax),
    `ein Drift-Eintrag auf genau der verschobenen Kohorte/Achse (${key}/${ax})`);
});

// F-B — Frozen-only-Kohorte ueberlebt das Artefakt (Union). Spiegelbild zu R2.9 Test B:
// dort ist die Kohorte live-NEU (nur live) -> live gewinnt; hier ist sie frozen-ONLY
// (nur im Lineal, live leer) -> Frozen wird weitergetragen statt still gedroppt.
const calAcb = calA.cohortBases || {}, calAgd = calA.gDistByCohort || {};
const liveKeyTix = new Map(); // cohortKey -> Set(ticker), aus dem Voll-Live-Lauf (keyByTicker Z.129-132)
for (const [t, k] of keyByTicker) { if (!liveKeyTix.has(k)) liveKeyTix.set(k, new Set()); liveKeyTix.get(k).add(t); }
let Kkey = null, Ktix = null; // kleinste Kohorte, die im Lineal VOLL (cohortBases+gDistByCohort) UND live praesent ist
for (const [k, tix] of [...liveKeyTix.entries()].sort((a, b) => a[1].size - b[1].size)) {
  if (calAcb[k] && calAgd[k]) { Kkey = k; Ktix = tix; break; }
}
const universeOhneK = Ktix ? universe.filter((s) => !Ktix.has(s.meta.ticker)) : universe; // K live LEER
const rFB = Kkey ? scoreUniverse(universeOhneK, formulas, { refCalibration: calA }) : null;
test('F-B — Frozen-only-Kohorte (live leer) ueberlebt das Emissions-Artefakt (Union, kein stilles De-Freeze)', () => {
  assert.ok(Kkey, 'eine im Lineal + live praesente Kohorte K gefunden');
  assert.ok(calAcb[Kkey] && calAgd[Kkey], `Vorbedingung: K=${Kkey} im Lineal calA praesent (cohortBases+gDistByCohort)`);
  // Kern: ROT-VORHER iteriert mergeFrozenByKey nur Object.keys(live) -> K faellt raus -> undefined.
  //       GRUEN-NACHHER traegt die Union die frozene Basis weiter.
  const cb = rFB.calibration.cohortBases && rFB.calibration.cohortBases[Kkey];
  assert.ok(cb, `rFB.calibration.cohortBases[${Kkey}] existiert (Frozen-only-Kohorte ueberlebt)`);
  assert.ok(cb.axes && Object.keys(cb.axes).length > 0 && Number.isFinite(cb.n), `${Kkey}: frozene axes/n intakt`);
  assert.ok(rFB.calibration.gDistByCohort && rFB.calibration.gDistByCohort[Kkey], `rFB.calibration.gDistByCohort[${Kkey}] existiert`);
  // De-Freeze-Nachweis: rFB.calibration als Lineal ueber das VOLLE Universum -> K's Namen halten den
  // gegen calA gefrorenen Score EXAKT (grown = Full∪calA). Ohne die Union waere K hier live-neu -> live
  // gelernt -> Drift. Frozen K == calA K (verbatim) -> dieselbe Basis -> identische Scores.
  const third = scoreUniverse(universe, formulas, { refCalibration: roundtrip(rFB.calibration) });
  const sThird = routedScores(third);
  let compared = 0, mism = 0;
  for (const t of Ktix) {
    if (scoreGrown.has(t) && sThird.has(t)) { compared++; if (sThird.get(t) !== scoreGrown.get(t)) mism++; }
  }
  assert.ok(compared > 0, `nicht-triviale K-Namen-Schnittmenge (${compared})`);
  assert.equal(mism, 0, `${mism}/${compared} K-Namen driften am naechsten Kettenglied (muss 0 sein — Frozen-Basis getreu weitergetragen)`);
});

console.log(`calibration-ref.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
