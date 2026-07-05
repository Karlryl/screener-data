'use strict';
/**
 * SEC XBRL -> Snapshot Merge (Folge-PR zu pull-sec-xbrl.js)
 * =========================================================
 * pull-sec-xbrl.js cached companyfacts/CIK<cik>.json fuer US-Filer. DIESES Modul
 * extrahiert daraus die TIEFEN ANNUAL-Serien (SEC liefert ~15 Jahre statt Yahoos
 * ~4) und merged sie in die Snapshots. REINE Funktionen, kein Netzwerk, kein I/O
 * (der Aufrufer liest die Cache-Datei).
 *
 * Ausgabe-Format IDENTISCH zu den Yahoo-Snapshot-Feldern (snapshot.js FIELD_REGISTRY):
 *   annual.*  -> [{value:N|null}] newest-first, INDEX-ALIGNED nach Fiskaljahr
 * -> norm() liest die tieferen Arrays transparent (gleiches {value}-Format).
 *
 * SCOPE (2026-07-02): NUR ANNUAL. Die Quartals-Extraktion (fuer den TTM-ueber-TTM-
 * Pfad overview.js:37 + die Quartals-Achsen) ist ein SEPARATER Folge-Schritt: die
 * juengsten 10-Q-Frames mischen 3-Monats- und YTD-Perioden (an der Datenfront teils
 * mit identischem end-Datum), was ein dediziertes Frame-Dedup braucht. Bis das
 * frame-sicher ist, wird es NICHT gemerged (kein halb-korrekter Fundamental-Pfad).
 *
 * WICHTIGER BEFUND (verifiziert am Code): das Vertiefen der STANDARD-Scoring-Felder
 * ist NICHT score-neutral. Drei Achsen sind tiefen-sensitiv (axes.js): cycleDiscount
 * mittelt ueber ALLE annualOpInc/annualRev-Margenjahre; revAcceleration/marginTrajectory
 * (Quartale). mergeSecIntoSnapshot bietet daher zwei Modi:
 *   - mode='namespace' (DEFAULT, additiv, 0 Score-Aenderung): tiefe Serie unter
 *     snapshot.secAnnual, Standard-Scoring-Felder unberuehrt.
 *   - mode='replace' (Handoff-literal, SCORE-AENDERND): ersetzt die annual-Standard-
 *     felder durch die tiefe SEC-Serie. NUR nach Court+Audit einsetzen.
 */

// --- SEC-Konzept-Namen (us-gaap) --------------------------------------------
// Umsatz wechselt das Konzept ueber die Jahre -> Prioritaets-Union (aktuelles zuerst).
const REV_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax', // ~2019+
  'Revenues',                                            // Fallback-Uebergangsjahre
  'SalesRevenueNet',                                     // ~2017-
];
const C_OPINC = 'OperatingIncomeLoss';
const C_NETINC = 'NetIncomeLoss';
const C_OCF = 'NetCashProvidedByUsedInOperatingActivities';
const C_CAPEX = 'PaymentsToAcquirePropertyPlantAndEquipment'; // positiver Cash-Abfluss
const C_GP = 'GrossProfit';

function usdUnits(gaap, concept) {
  const node = gaap && gaap[concept];
  return (node && node.units && Array.isArray(node.units.USD)) ? node.units.USD : [];
}

// Annual (Volljahr): form '10-K' & fp 'FY', dedupe je fy (neueste 'end' gewinnt).
// -> Map fy -> {val, end}
function annualConcept(gaap, concept) {
  const out = new Map();
  for (const x of usdUnits(gaap, concept)) {
    if (x.form === '10-K' && x.fp === 'FY' && x.fy != null && Number.isFinite(x.val)) {
      const prev = out.get(x.fy);
      if (!prev || x.end > prev.end) out.set(x.fy, { val: x.val, end: x.end });
    }
  }
  return out;
}

// Umsatz-Union: je fy den Wert des zum Datum gueltigen Konzepts (Prioritaets-Reihenfolge).
function annualRevUnion(gaap) {
  const maps = REV_CONCEPTS.map((c) => annualConcept(gaap, c));
  const out = new Map();
  for (const m of maps) {
    for (const [fy, v] of m) if (!out.has(fy)) out.set(fy, v); // erstes (hoechste Prioritaet) gewinnt
  }
  return out;
}

// Tiefe annual-Serien, alle auf EINER fy-Achse (Union der fy) index-aligned, newest-first.
function buildAnnual(gaap) {
  const rev = annualRevUnion(gaap);
  const opinc = annualConcept(gaap, C_OPINC);
  const ni = annualConcept(gaap, C_NETINC);
  const ocf = annualConcept(gaap, C_OCF);
  const capex = annualConcept(gaap, C_CAPEX);
  const gp = annualConcept(gaap, C_GP);

  // gemeinsame fy-Achse = Union ueber die Serien; numerisch absteigend (newest-first).
  const fySet = new Set();
  for (const m of [rev, opinc, ni, ocf, capex, gp]) for (const fy of m.keys()) fySet.add(fy);
  const fys = [...fySet].sort((a, b) => b - a);

  const cell = (m, fy) => (m.has(fy) ? { value: m.get(fy).val } : { value: null });
  const fcfCell = (fy) => (ocf.has(fy) && capex.has(fy))
    ? { value: ocf.get(fy).val - capex.get(fy).val }  // FCF = OCF - Capex(positiv)
    : { value: null };

  return {
    _fys: fys,
    annualRev: fys.map((fy) => cell(rev, fy)),
    annualOpInc: fys.map((fy) => cell(opinc, fy)),
    annualNetIncome: fys.map((fy) => cell(ni, fy)),
    annualOCF: fys.map((fy) => cell(ocf, fy)),
    annualFCF: fys.map((fy) => fcfCell(fy)),
    annualGP: fys.map((fy) => cell(gp, fy)),
  };
}

/**
 * extractSecSeries(companyfacts) -> { annual:{...} }
 * Reine Funktion. companyfacts = geparste CIK<cik>.json.
 */
function extractSecSeries(companyfacts) {
  const gaap = (companyfacts && companyfacts.facts && companyfacts.facts['us-gaap']) || {};
  return { annual: buildAnnual(gaap) };
}

// --- Overlap-Validierung (SEC vs Yahoo fuer die gemeinsamen Fuehrungsjahre) ---
const cleanVals = (arr) => (Array.isArray(arr) ? arr.map((x) => (x && typeof x === 'object' ? x.value : x)) : []);

function overlapDivergence(yahooArr, secArr) {
  const y = cleanVals(yahooArr), s = cleanVals(secArr);
  const n = Math.min(y.length, s.length);
  let maxRel = 0, compared = 0;
  for (let i = 0; i < n; i++) {
    const a = y[i], b = s[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const denom = Math.max(Math.abs(a), Math.abs(b));
    if (denom === 0) continue;
    maxRel = Math.max(maxRel, Math.abs(a - b) / denom);
    compared++;
  }
  return { maxRel, compared };
}

/**
 * mergeSecIntoSnapshot(snapshot, sec, opts) -> report
 *   opts.mode = 'namespace' (default, additiv) | 'replace' (score-aendernd)
 *   opts.overlapTolerance = 0.12 (12% — SEC audited vs Yahoo weichen leicht ab)
 * Mutiert snapshot in place. Bei grober Overlap-Divergenz (>Toleranz) im replace-Modus
 * das betroffene Feld NICHT ersetzen (Konzept-Mismatch/Restatement) und flaggen.
 */
// Felder, die im replace-Modus ersetzt UND auf Overlap-Divergenz geprueft werden.
// Bug 15: Gate-Loop und Replace-Loop MUESSEN dieselbe Liste nutzen, sonst laufen
// annualFCF/annualOCF ungeprueft durch.
const ANNUAL_FIELDS = ['annualRev', 'annualOpInc', 'annualNetIncome', 'annualFCF', 'annualOCF'];

// Feld hat mindestens eine finite Zelle? (Bug 14: Null-Serie soll echte Yahoo-Werte nicht ueberschreiben.)
function hasFiniteCell(arr) {
  return Array.isArray(arr) && arr.some((c) => Number.isFinite(c && c.value));
}

function mergeSecIntoSnapshot(snapshot, sec, opts = {}) {
  const mode = opts.mode || 'namespace';
  const tol = opts.overlapTolerance != null ? opts.overlapTolerance : 0.12;
  if (!snapshot || typeof snapshot !== 'object') return { merged: false, reason: 'no-snapshot' };
  snapshot.annual = snapshot.annual || {};

  const divergences = {};
  const compared = {};
  for (const f of ANNUAL_FIELDS) {
    const d = overlapDivergence(snapshot.annual[f], sec.annual[f]);
    compared[f] = d.compared;
    if (d.compared > 0 && d.maxRel > tol) divergences[f] = Number(d.maxRel.toFixed(3));
  }

  if (mode === 'replace') {
    for (const f of ANNUAL_FIELDS) {
      if (divergences[f]) continue;                          // grobe Divergenz -> Yahoo behalten + flaggen
      if (!hasFiniteCell(sec.annual[f])) continue;           // Bug 14: reine Null-Serie darf echte Yahoo-Werte nicht ueberschreiben
      // Bug 14: hat Yahoo echte Werte, war aber kein Overlap-Vergleich moeglich (disjunkte fy) -> konservativ Yahoo behalten.
      // Fehlt Yahoo das Feld ganz, darf SEC weiterhin vertiefen (compared===0 ist dann kein Konflikt).
      if (!compared[f] && hasFiniteCell(snapshot.annual[f])) continue;
      if (sec.annual[f] && sec.annual[f].length) snapshot.annual[f] = sec.annual[f];
    }
  } else {
    // additiv: tiefe Serie separat ablegen, Scoring-Felder unberuehrt.
    snapshot.secAnnual = sec.annual;
  }
  return { merged: true, mode, divergences, years: sec.annual._fys.length };
}

module.exports = {
  extractSecSeries, mergeSecIntoSnapshot,
  // fuer Tests / gezielte Wiederverwendung
  buildAnnual, annualConcept, annualRevUnion, overlapDivergence,
};
