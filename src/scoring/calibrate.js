'use strict';
/**
 * Kalibrier-Harness fuer die per-Formel-Gewichts-Optimierung.
 *
 * Schluessel-Einsicht: die q()-Achsen-Perzentile einer Kohorte sind FIX (haengen
 * nur von den Roh-Achsenwerten der Kohorte ab, NICHT von den Gewichten). Also
 * EINMAL die Perzentil-Matrix bauen (teuer: Universum laden), dann ist jede
 * Gewichts-Bewertung ein sofortiges gewichtetes Mittel (renorm-on-drop). Damit
 * koennen Sub-Agenten hunderte Gewichts-Vektoren instant testen.
 *
 * Hinweis: ruleOfX-Rohwert haengt von formula.alpha ab -> Matrix gilt fuer FIXES
 * alpha. Gewichts-Kalibrierung ist instant; alpha-Aenderung braucht Rebuild.
 */
const { route } = require('./router.js');
const { q, signTrack } = require('./engine.js');
const { norm } = require('./snapshot.js');
const { evaluateLamps } = require('./lamps.js');
const { trackOf, rawAxisValue, learnWinsorBounds, winsorTailBounds, growthYoYComponents, isDataSuspect, issuerDedupComparator, issuerDedupGroups, scoreUniverse, rankBy, MIN_COHORT_N, EINMALERTRAG_BLIND } = require('./score.js');

// Baut pro (formulaId|track) die Perzentil-Matrix: rows[{ticker, pct:{axis:0-100}, lamps}].
// audit/fix (BH-076): opts.classify erlaubt einen QC-Lauf (classify:qualityRoute) gegen dieselbe Matrix-
// Logik zu pinnen wie run-screener (opts-Seam spiegelt scoreUniverse, score.js:492). Ohne classify -> route()
// (byte-identisch zum bisherigen Verhalten). Default-Param statt Pflicht-Arg -> bestehende Aufrufer unveraendert.
function buildCalibMatrix(universe, formulas, opts = {}) {
  const classify = opts.classify || route;
  const routed = [];
  for (const s of (Array.isArray(universe) ? universe : [])) {
    const r = classify(s);
    if (r.action !== 'route') continue;
    const formula = formulas[r.formulaId];
    if (!formula) continue;
    const lamps = evaluateLamps(s).active;
    // audit/fix (Bug 9): dieselben zwei Gates wie score.js VOR der Kohortenbildung anwenden, sonst
    // enthalten die Kohorten Namen, die die Produktion vor der Perzentilierung excludiert (A4 data-
    // suspect, A3 Issuer-Dedup) -> Perzentil-Verschiebung + Geister-Zeilen. (1) data-suspect skip:
    if (isDataSuspect(s, lamps, 'route')) continue;
    const track = trackOf(s, formula); // liefert nie 'unknown' (Fallback intern -> profitable)
    // snapshot:s -> issuerDedupComparator (erwartet e.snapshot/e.ticker) kann direkt sortieren.
    routed.push({ s, snapshot: s, formulaId: r.formulaId, track, formula, ticker: (s.meta && s.meta.ticker) || '?', lamps });
  }
  // audit/fix (Bug 9): (2) Issuer-Dedup mit identischem Sortierschluessel wie score.js — pro Emittent
  // (normalisierter meta.name) nur das Gewinner-Bein behalten. Verlierer aus den Kohorten nehmen.
  // audit/fix (Kreuz-Review 27.07., Befund P1): frueher stand hier eine EIGENE Gruppierung mit
  // dem strengen issuerKey. Als die Produktion auf issuerKeyLoose + Fehlverschmelzungs-Schutz
  // umgestellt wurde, blieb diese Kopie stehen — die Matrix lernte damit auf Zeilen, die die
  // Produktion entfernt. Jetzt dieselbe Funktion wie score.js, damit das nicht wieder driften kann.
  const dedupLosers = new Set();
  for (const group of issuerDedupGroups(routed)) {
    if (group.length < 2) continue;
    group.sort(issuerDedupComparator);
    for (let i = 1; i < group.length; i++) dedupLosers.add(group[i]);
  }
  // audit/fix (R2.1+R2.8): die Dedup-Verlierer VOR dem Bounds-Lernen entfernen — die universe-weiten
  // Winsor-/Growth-Schranken auf der POST-Dedup-Population `kept` lernen, exakt wie score.js (dort setzt
  // der Dedup Z.512-520 die Verlierer auf exclude, DANN lernt Z.552/559 auf action==='route'). Vorher
  // lernten sie auf pre-dedup `routed` (die Doppel-Notierungs-Verlierer verschoben p1/p99) -> Matrix != Produktion.
  const kept = routed.filter((e) => !dedupLosers.has(e));
  // Winsor-Schranken (marginTrajectory/revAcceleration) als 5. Argument an rawAxisValue durchgereicht —
  // sonst UNwinsorisiert (Stub-Quartal-Phantom-Extreme pinnen die Perzentil-Enden).
  const winsorBounds = learnWinsorBounds(kept.map((e) => e.s));
  // growthBounds gleiche Basis wie winsorBounds, an rawAxisValue durchgereicht — revGrowthLevel/ruleOfX
  // rechnen reihen-basiert und klemmen Mini-Basis-Komponenten mit denselben data-learned Schranken.
  const growthSamples = [];
  for (const e of kept) for (const v of growthYoYComponents(e.s)) growthSamples.push(v);
  const growthBounds = winsorTailBounds(growthSamples);
  const cohorts = {};
  for (const e of kept) {
    (cohorts[e.formulaId + '|' + e.track] = cohorts[e.formulaId + '|' + e.track] || []).push(e);
  }

  // audit/fix (R2.2): PASS 1 — Roh-Achsen + profitSign je Kohorte EINMAL sammeln. Der Mindest-n-Fallback
  // (PASS 2) braucht die ELTERN-Kohorte (Branche ueber BEIDE Tracks), also ALLE Kohorten der Formel, nicht
  // nur die eigene -> zwei Paesse (spiegelt score.js:566-586). Rein strukturell: das Achsen-Lernen ist
  // unveraendert (rawByAxis pro Kohorte unter deren eigenem track wie zuvor).
  const cohortRaw = {};
  for (const [cohortKey, entries] of Object.entries(cohorts)) {
    const formula = entries[0].formula;
    const track = entries[0].track;
    const formulaId = entries[0].formulaId;
    // audit/fix (C1): score.js perzentiliert capitalEfficiency bei subCohortByProfit-Branchen
    // (real-estate/it-services) gegen die profit-Vorzeichen-Sub-Kohorte (Iron-Rule 2). Hier exakt
    // spiegeln (score.js:575-577), sonst weicht die Kalibrier-Matrix von der Produktion ab -> Weights
    // wuerden gegen ein Ranking getunt, das Produktion fuer diese 2 Branchen nie erzeugt (100% Mismatch).
    // norm(), nicht histOpInc(): Vorzeichen-Signal wie trackOf (K2-Auflage 1, Urteil T164) —
    // muss mit score.js:1030 und gqs00-freeze.js comparisonBasis() zeichengleich bleiben.
    const profitSign = formula.subCohortByProfit
      ? entries.map((e) => signTrack(norm(e.s, 'annualOpInc')))
      : null;
    const rawByAxis = {};
    for (const ax of formula.axes) {
      // Einmalertrag-Konsequenz (Urteil 16.08.): score.js droppt diese Achsen bei brennender
      // Lampe VOR der Perzentilierung — hier an DERSELBEN Stelle spiegeln, sonst lernt die
      // Matrix Vergleichsverteilungen, die die Produktion nicht mehr erzeugt (gemessen vor
      // dem Fix: 34 Lampen-Zeilen, 148 Achsen-Divergenzen). Die Liste kommt aus score.js,
      // sie wird NICHT kopiert.
      const blind = EINMALERTRAG_BLIND.includes(ax.key);
      rawByAxis[ax.key] = entries.map((e) => ((blind && Array.isArray(e.lamps) && e.lamps.includes('einmalertrag'))
        ? null
        : rawAxisValue(e.s, ax.key, formula, track, winsorBounds, growthBounds)));
    }
    cohortRaw[cohortKey] = { formula, track, formulaId, entries, rawByAxis, profitSign };
  }
  // audit/fix (R2.2): Eltern-Kohorten-Basis (Branche ueber beide Tracks) fuer eine Achse — KONKATENATION
  // der bereits pro-Kohorte-unter-eigenem-track berechneten rawByAxis-Arrays aller Geschwister-Kohorten
  // derselben formulaId (spiegelt score.js parentBasis 591-604; der refCal-Zweig entfaellt, calibrate kennt
  // keinen Ref-Modus). NICHT unter einem Einheits-track neu rechnen -> keine subtile Track-Divergenz.
  // profitSign-Parent parallel fuer die capitalEfficiency-Sub-Kohorte. Gibt {vals, signs} gleicher Laenge.
  function parentBasis(formulaId, axisKey) {
    const keys = Object.keys(cohortRaw).filter((k) => cohortRaw[k].formulaId === formulaId);
    let vals = [], signs = [];
    for (const key of keys) {
      const arr = cohortRaw[key].rawByAxis[axisKey];
      const sg = cohortRaw[key].profitSign;
      if (!Array.isArray(arr)) continue;
      vals = vals.concat(arr);
      signs = signs.concat((sg && sg.length === arr.length) ? sg : arr.map(() => null));
    }
    return { vals, signs };
  }

  const matrix = {};
  for (const [key, cr] of Object.entries(cohortRaw)) {
    const { formula, track, formulaId, entries, rawByAxis, profitSign } = cr;
    const axisKeys = formula.axes.map((a) => a.key);
    // audit/fix (R2.2): PASS 2 — Basis-Wahl je Kohorte. duenne Kohorte (n < MIN_COHORT_N) perzentiliert gegen
    // die ELTERN-Basis (beide Tracks), NICHT gegen die eigene duenne Stichprobe — spiegelt score.js:606-638
    // (isFallback 615). Der zu perzentilierende Wert bleibt rawByAxis[k][i] der EIGENEN Kohorte; nur die
    // q()-Basis wechselt. fette Kohorte: unveraendert eigene Kohorte (byte-identisch zum bisherigen Verhalten).
    const nCohort = entries.length;
    const isFallback = nCohort < MIN_COHORT_N;
    const parentCache = {};                             // Eltern-Basis je Achse nur bei Fallback + einmalig
    const rows = entries.map((e, i) => {
      const pct = {};
      for (const k of axisKeys) {
        let cohort, signBasis;
        if (isFallback) {
          const pb = parentCache[k] || (parentCache[k] = parentBasis(formulaId, k));
          cohort = pb.vals; signBasis = pb.signs;
        } else {
          cohort = rawByAxis[k];
          signBasis = profitSign;
        }
        if (k === 'capitalEfficiency' && profitSign) {
          // gegen die gleich-vorzeichige Sub-Kohorte perzentilieren; die (ggf. Eltern-)Basis nach dem
          // EIGENEN (snapshot-stabilen) Vorzeichen von Name i filtern -> A-Namen behalten ihren Rang.
          // 2.10-Court-Guard: dieser Fallback-Pfad ist NUR sicher, weil JEDE subCohortByProfit-Formel
          // splitMetric:'none' ist (Einzel-Kohorte -> Eltern-Basis == eigene Kohorte, signBasis voll
          // besetzt). Bekaeme je eine SPLIT-Branche subCohortByProfit UND fiele unter MIN_COHORT_N, mischte
          // die Eltern-Basis beide Tracks mit ggf. null-signBasis -> diesen Pfad dann neu pruefen.
          cohort = cohort.filter((_, j) => signBasis[j] === profitSign[i]);
        }
        pct[k] = q(rawByAxis[k][i], cohort);
      }
      return { ticker: e.ticker, pct, lamps: e.lamps };
    });
    matrix[key] = { formulaId, track, axisKeys, defaultWeights: weightsObj(formula, track), alpha: formula.alpha, rows };
  }
  // R-Gate R2.1+R2.8: die intern gelernten universe-weiten Schranken NICHT-ENUMERIERBAR ausweisen
  // (score.js:770-785-Muster), damit der Paritaets-Test sie lesen kann OHNE dass dumpMatrix() sie als
  // Pseudo-Kohorte iteriert (Object.entries -> key.split('|') -> Junk-Datei calibration.json).
  Object.defineProperty(matrix, 'calibration', { value: { winsorBounds, growthBounds }, enumerable: false });
  return matrix;
}

function weightsObj(formula, track) {
  const w = {};
  for (const ax of formula.axes) w[ax.key] = ax.w[track];
  return w;
}

// Gewichtetes Mittel der vorhandenen Achsen-Perzentile (renorm-on-drop).
function scoreWithWeights(pct, weights) {
  let w = 0, v = 0;
  for (const k of Object.keys(weights)) {
    const p = pct[k];
    if (p === null || p === undefined || !Number.isFinite(p)) continue;
    const wt = weights[k];
    if (!(wt > 0) || !Number.isFinite(wt)) continue;
    w += wt; v += wt * p;
  }
  return w > 0 ? v / w : null;
}

function rankCohort(cohort, weights) {
  return cohort.rows
    .map((r) => ({ ticker: r.ticker, score: scoreWithWeights(r.pct, weights), lamps: r.lamps }))
    .filter((r) => r.score !== null)
    .sort((a, b) => b.score - a.score);
}

// --- 2.11 Stufe A Teil 1: Parität zur PRODUKTION -----------------------------
// Court-Befund (Scoring-Court, Ankläger Architektur): scoreWithWeights/rankCohort sind ein COARSE-Vorfilter —
// sie mitteln NUR die gewichteten Achsen-Perzentile und spiegeln NICHT die Produktions-Pipeline nach der
// Perzentilierung: EB-Shrinkage (2.10, Richtung 50 per Kohorten-n), C4-Coverage-Shrinkage (Richtung Median)
// und die 3 multiplikativen Post-Faktoren (burnPress/growthBoost/cycleDamper). Die Kalibrier-Matrix ist damit
// schnell (jeder Gewichtsvektor = ein sofortiges gewichtetes Mittel), aber ihr Ranking ≠ Produktions-Ranking.
// KONSEQUENZ (Anti-Fudge): Gewichte NIE allein am Coarse-Ranking festmachen. Die Simplex-Suche darf coarse
// vor-filtern, aber der FINALE Kandidat MUSS durch die ECHTE Engine verifiziert werden — dafür diese zwei
// Primitive. So bleibt die Suche schnell UND das Urteil produktionstreu (Rang-Identität per Konstruktion,
// weil productionCohortRanking DIESELBE scoreUniverse-Engine ist, die run-screener nutzt).

// Formel-Kopie mit ueberschriebenen Track-Gewichten (immutable; beruehrt die anderen Formeln/Tracks nicht).
function withWeights(formulas, formulaId, track, weightObj) {
  const f = formulas[formulaId];
  if (!f) throw new Error(`withWeights: unbekannte formulaId ${formulaId}`);
  const axes = f.axes.map((ax) => (weightObj[ax.key] === undefined
    ? ax
    : { ...ax, w: { ...ax.w, [track]: weightObj[ax.key] } }));
  return { ...formulas, [formulaId]: { ...f, axes } };
}

// Exaktes PRODUKTIONS-Ranking einer Kohorte (formulaId|track) — läuft die volle scoreUniverse-Engine (inkl.
// aller Shrinks + Post-Faktoren) und rankt via rankBy. weightObj optional: mit gesetzten Gewichten wird gegen
// die überschriebene Formel gescort (der Verify-Schritt für einen Kalibrier-Kandidaten). Das IST das
// run-screener-Ranking — daher Rang-identisch, kein separater Parität-Beweis nötig außer dem Test unten.
// audit/fix (BH-076): opts (classify, growthBoost, refCalibration, ...) an scoreUniverse durchreichen —
// vorher lief hier IMMER die HG-Default-Konfiguration (route()+growthBoost:true), ein QC-Kandidat
// (classify:qualityRoute, growthBoost:false) konnte nie produktionsgetreu verifiziert werden. Default {} ->
// byte-identisch zum bisherigen Verhalten.
function productionCohortRanking(universe, formulas, formulaId, track, weightObj, opts = {}) {
  const f = weightObj ? withWeights(formulas, formulaId, track, weightObj) : formulas;
  return rankBy(scoreUniverse(universe, f, opts), formulaId, track).map((e) => ({ ticker: e.ticker, score: e.score }));
}

/**
 * Diagnose einer Gewichtung gegen Anker/Decliner/Peak-Falle.
 * anchorPos/declinerPos in [0,1] (0 = Spitze). peakTrap = Anteil Top-10 mit Peak-Lampe.
 */
function diagnostics(cohort, weights, opts = {}) {
  const anchors = opts.anchors || [];
  const decliners = opts.decliners || [];
  const peakLamps = opts.peakLamps || ['peakMargin', 'lowRoic'];
  const ranked = rankCohort(cohort, weights);
  const n = ranked.length || 1;
  const posOf = (t) => { const i = ranked.findIndex((r) => r.ticker === t); return i < 0 ? null : i / n; };
  const top10 = ranked.slice(0, 10);
  return {
    n: ranked.length,
    anchorPos: anchors.map((t) => ({ ticker: t, pct: posOf(t), rank: ranked.findIndex((r) => r.ticker === t) + 1 || null })),
    declinerPos: decliners.map((t) => ({ ticker: t, pct: posOf(t), rank: ranked.findIndex((r) => r.ticker === t) + 1 || null })),
    peakTrapTop10: top10.filter((r) => r.lamps.some((l) => peakLamps.includes(l))).length / Math.max(1, top10.length),
    top10: top10.map((r) => ({ ticker: r.ticker, score: Math.round(r.score * 10) / 10, lamps: r.lamps })),
  };
}

// Dump der Perzentil-Matrix pro Branche nach outputs/hypergrowth/calib/<id>.json
// (damit Sub-Agenten billig laden statt das Universum neu zu parsen).
function dumpMatrix() {
  const fs = require('fs');
  const path = require('path');
  const { writeJsonAtomic } = require('../../lib/atomic-write.js'); // audit/fix (C2): atomar dumpen
  const { loadUniverse } = require('./run-screener.js');
  const formulas = require('./formulas/index.js');
  const universe = loadUniverse();
  const matrix = buildCalibMatrix(universe, formulas);
  const outDir = path.join(__dirname, '..', '..', 'outputs', 'hypergrowth', 'calib');
  fs.mkdirSync(outDir, { recursive: true });
  const byBranch = {};
  for (const [key, cohort] of Object.entries(matrix)) {
    const [fid, track] = key.split('|');
    (byBranch[fid] = byBranch[fid] || {})[track] = cohort;
  }
  for (const [fid, tracks] of Object.entries(byBranch)) {
    // audit/fix (C2): atomar; indent 0 = kompakt, byte-identisch zum bisherigen JSON.stringify(tracks).
    writeJsonAtomic(path.join(outDir, fid + '.json'), tracks, { indent: 0 });
  }
  return { universe: universe.length, branches: Object.keys(byBranch), dir: outDir };
}

if (require.main === module) {
  const r = dumpMatrix();
  console.log(`Calib-Matrix gedumpt: ${r.branches.length} Branchen (Universum ${r.universe}) -> ${r.dir}`);
}

module.exports = { buildCalibMatrix, weightsObj, scoreWithWeights, rankCohort, diagnostics, dumpMatrix,
  // 2.11 Stufe A Teil 1: Produktions-Parität (Coarse-Matrix vor-filtert, Engine verifiziert den Kandidaten)
  withWeights, productionCohortRanking };
