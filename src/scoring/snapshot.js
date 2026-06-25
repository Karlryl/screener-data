'use strict';
/**
 * Hypergrowth Engine — Schicht 0: Normalisierung (typed-accessor)
 * ===============================================================
 * Court-v4-Kernfund: die Yahoo-Snapshots speichern Felder in DREI Formaten
 * (Objekt-Arrays [{value:N}], Skalar-Arrays [N], Multi-Key-Objekt-Arrays
 * [{totalAssets,...}]). Rechnet eine Achse direkt auf einem Rohfeld, ist
 * `annualGP[0]` ein OBJEKT, keine Zahl -> jede Arithmetik kollabiert zu NaN.
 *
 * `norm()` ist das EINZIGE Tor zu snapshot.annual.* / snapshot.timeseries.*.
 * Es liefert IMMER eine reine, vorzeichenbehaftete Zahlen-Serie (mit
 * null-Luecken fuer Fehlwerte). Keine Achse / kein Router / keine Lampe greift
 * je direkt auf ein Rohfeld zu — ausschliesslich auf norm()-Serien. Damit
 * existiert die {value}-vs-Skalar-Mehrdeutigkeit ab Schicht 0 nicht mehr und
 * die NaN-Klasse ist strukturell ausgeschlossen.
 *
 * Invarianten (fuer JEDEN Feldtyp identisch):
 *  (i)   Reihenfolge bleibt erhalten: Index 0 = juengstes GJ/Quartal.
 *  (ii)  Fehlender/nicht-numerischer Eintrag (null, undefined, {value:null},
 *        {} ohne value, NaN, +/-Infinity) -> null-LUECKE an dieser Position
 *        (NICHT 0, NICHT entfernt) — 'fehlt' bleibt von 'ist 0' unterscheidbar.
 *  (iii) Komplett fehlendes ODER leeres Rohfeld -> [] (NIE null, NIE [0]).
 *  (iv)  norm() ist rein/seiteneffektfrei und idempotent.
 *
 * Verifiziert gegen snapshots/CRDO.json (siehe tests/scoring/snapshot.test.js).
 */

// Feld-Format-Register (verifiziert an snapshots/CRDO.json, gilt universell).
// [container, format]; format: 'value' = [{value:N}], 'scalar' = [N],
// 'multikey' = [{k:N,...}] (braucht key-Argument).
const FIELD_REGISTRY = {
  // annual — {value}-Objekt-Arrays
  annualRev:          ['annual', 'value'],
  annualGP:           ['annual', 'value'],
  annualFCF:          ['annual', 'value'],
  annualOCF:          ['annual', 'value'],
  annualOpInc:        ['annual', 'value'],
  annualNetIncome:    ['annual', 'value'],
  // annual — Skalar-Arrays
  annualSBC:          ['annual', 'scalar'],
  annualRnD:          ['annual', 'scalar'],
  annualCapex:        ['annual', 'scalar'],
  annualSGA:          ['annual', 'scalar'],
  annualDepreciation: ['annual', 'scalar'],
  // annual — Multi-Key-Objekt-Array
  annualBalance:      ['annual', 'multikey'],
  // timeseries — {value}-Objekt-Arrays (juengstes Quartal zuerst)
  revenueQ:           ['timeseries', 'value'],
  opIncQ:             ['timeseries', 'value'],
  grossProfitQ:       ['timeseries', 'value'],
  netIncomeQ:         ['timeseries', 'value'],
};

// Eine Zahl, wenn finit; sonst null (faengt NaN, +/-Infinity, undefined, Strings).
function toFinite(x) {
  return (typeof x === 'number' && Number.isFinite(x)) ? x : null;
}

/**
 * norm(snapshot, field [, key]) -> Array<number|null>
 * Liefert die normalisierte Zahlen-Serie eines Snapshot-Feldes.
 * Wirft bei unbekanntem Feld (Tippfehler = lauter Programmierfehler, kein
 * stilles []) und bei Multi-Key-Feld ohne key-Argument.
 */
function norm(snapshot, field, key) {
  const spec = FIELD_REGISTRY[field];
  if (!spec) {
    throw new Error(`norm(): unbekanntes Feld "${field}" — nicht im FIELD_REGISTRY`);
  }
  const [container, format] = spec;
  if (format === 'multikey' && (key === undefined || key === null)) {
    throw new Error(`norm(): Feld "${field}" ist multi-key — key-Argument erforderlich`);
  }
  const raw = (snapshot && snapshot[container]) ? snapshot[container][field] : undefined;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  return raw.map((entry) => {
    if (entry === null || entry === undefined) return null;
    if (format === 'scalar') return toFinite(entry);
    if (format === 'value') {
      return (typeof entry === 'object') ? toFinite(entry.value) : toFinite(entry);
    }
    // multikey
    return (typeof entry === 'object') ? toFinite(entry[key]) : null;
  });
}

// --- abgeleitete Helfer auf normalisierten Serien -------------------------
// Ersetzen jede rohe Index-Arithmetik durch abstrakte, luecken-sichere Begriffe.

// true gdw. die Serie mindestens einen present (nicht-null) Wert hat.
// Schuetzt vor der JS-[].every()-true-Falle (leere/all-null-Serie -> false).
function hasPresent(series) {
  return Array.isArray(series) && series.some((v) => v !== null && v !== undefined);
}

// Erster present Wert (= juengstes vorhandenes GJ/Quartal, ueberspringt
// fuehrende null-Luecken). null, wenn kein present Wert existiert.
function firstPresent(series) {
  if (!Array.isArray(series)) return null;
  for (const v of series) {
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

// Summe nur ueber present Werte. Leere/all-null-Serie -> 0.
// (Fuer Exclude-/Konsens-Entscheidungen IMMER zusammen mit hasPresent pruefen,
//  damit 0 nicht mit 'kein Wert' verwechselt wird.)
function sumPresent(series) {
  if (!Array.isArray(series)) return 0;
  let s = 0;
  for (const v of series) {
    if (v !== null && v !== undefined) s += v;
  }
  return s;
}

// Vorzeichen (-1/0/+1) einer Zahl; nur auf einem present Wert auswerten.
function sign(x) {
  return Math.sign(x);
}

// Nur die present (nicht-null) Werte einer Serie.
function presentValues(series) {
  return Array.isArray(series) ? series.filter((v) => v !== null && v !== undefined) : [];
}

// Erste zwei present Werte [neu, alt] (fuer YoY). null, wenn < 2 vorhanden.
function firstTwoPresent(series) {
  const out = [];
  for (const v of (Array.isArray(series) ? series : [])) {
    if (v !== null && v !== undefined) { out.push(v); if (out.length === 2) break; }
  }
  return out.length === 2 ? out : null;
}

// Summe der ersten n present Werte (juengste zuerst); fewer wenn < n present.
// null, wenn kein present Wert existiert (vs. 0 = vorhanden aber netto null).
function recentSumPresent(series, n) {
  const vals = presentValues(series).slice(0, n);
  return vals.length ? vals.reduce((p, c) => p + c, 0) : null;
}

// Null-sicherer metrics-Skalar-Zugriff: snapshot.metrics[key].value oder null.
function metricVal(snapshot, key) {
  const v = (snapshot && snapshot.metrics && snapshot.metrics[key]) ? snapshot.metrics[key].value : undefined;
  return Number.isFinite(v) ? v : null;
}

module.exports = {
  norm, hasPresent, firstPresent, sumPresent, sign, FIELD_REGISTRY,
  presentValues, firstTwoPresent, recentSumPresent, metricVal,
};
