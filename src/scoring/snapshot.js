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
  // F-1 (Karl-Mandat 03.08.2026) — Ausschuettungen an Aktionaere, aus demselben FTS-Cash-Flow-
  // Modul wie annualSBC/annualCapex (pull-yahoo.js), deshalb dieselbe Skalar-Form.
  // Vorzeichen: Yahoo speichert Mittelabfluesse negativ (wie annualCapex) — Rueckkauf und
  // Dividende kommen als negative Betraege, netCommonStockIssuance ist positiv bei Emission
  // und negativ bei Netto-Rueckkauf. Heute reine DATENERFASSUNG: kein Scoring-Konsument.
  annualRepurchase:              ['annual', 'scalar'],
  annualDividendsPaid:           ['annual', 'scalar'],
  annualNetCommonStockIssuance:  ['annual', 'scalar'],
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

// Nur die present (finiten) Werte einer Serie. Number.isFinite faengt zusaetzlich
// NaN/Infinity ab (Defense gegen abgeleitete Serien mit Ueberlauf/Misalignment).
function presentValues(series) {
  return Array.isArray(series) ? series.filter((v) => Number.isFinite(v)) : [];
}

// Erste zwei present (finite) Werte [neu, alt] (fuer YoY). null, wenn < 2 vorhanden.
function firstTwoPresent(series) {
  const out = [];
  for (const v of (Array.isArray(series) ? series : [])) {
    if (Number.isFinite(v)) { out.push(v); if (out.length === 2) break; }
  }
  return out.length === 2 ? out : null;
}

// Element-weise num/den (newest-first); null wo ein Operand fehlt/kein Array ist,
// den==0, ODER der Quotient nicht-finit ist (IEEE-Ueberlauf). Laengen-mismatch-
// sicher (out-of-bounds -> undefined -> null). Geteilt von axes/lamps/overview.
function ratioSeries(numS, denS) {
  const a = Array.isArray(numS) ? numS : [];
  const b = Array.isArray(denS) ? denS : [];
  const n = Math.max(a.length, b.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    if (x === null || x === undefined || y === null || y === undefined || y === 0) { out.push(null); continue; }
    const r = x / y;
    out.push(Number.isFinite(r) ? r : null);
  }
  return out;
}

// Summe der ersten n present Werte (juengste zuerst); fewer wenn < n present.
// null, wenn kein present Wert existiert (vs. 0 = vorhanden aber netto null).
function recentSumPresent(series, n) {
  const vals = presentValues(series).slice(0, n);
  return vals.length ? vals.reduce((p, c) => p + c, 0) : null;
}

// --- Jahres-Vergleichsquartal, DATUMSBEWUSST (F-4, Karl-Mandat 03.08.2026) -----
// Bis heute suchte jede Quartals-YoY-Rechnung ihr Vorjahresquartal an der POSITION i+4.
// Das setzt voraus, dass die Reihe lueckenlos vier Quartale je Jahr traegt. Ausgezaehlt
// ueber die 12.543 Snapshots des CI-Laufs 30787450668: von 6.203 YoY-pruefbaren Reihen
// liegen 1.774 (28,6 %) NICHT bei ~365 Tagen - bei chinesischen A-Aktien (CN 51,9 %
// ausserhalb), Indien (60,2 %) und Schweden (77,6 %) fehlt regelmaessig ein Quartal, und
// Position 4 zeigt dann auf ein Quartal 455 Tage frueher. Handprobe 000962.SZ:
// revenueQEnds = [2026-03-31, 2025-12-31, 2025-06-30, 2025-03-31, 2024-12-31] - das
// richtige Vergleichsquartal (2025-03-31, exakt 365 Tage) steht an Position 3, verglichen
// wurde gegen Position 4 (2024-12-31, 455 Tage).
//
// TOLERANZ AUS DEN DATEN, nicht gesetzt. Gemessen wurde die Abweichung |Abstand - 365 Tage|
// zum jeweils BESTEN datierten Kandidaten ueber alle 30.004 auswertbaren Positionen
// (scripts/f4-quartalsvergleich.js --abstand):
//   0 Tage  9.608 · 1 Tag  23   -> echte Jahrespartner
//   [2 .. 29 Tage]  KEIN EINZIGER FALL
//   30 Tage 1 (AAP: 395 Tage = 13 Monate, in einer Reihe, deren zwei neueste "Quartale"
//            30 Tage auseinanderliegen - keine Jahresdifferenz)
//   [31 .. 88 Tage] KEIN EINZIGER FALL
//   89-93 Tage 5.985 -> ein Quartal daneben (das Jahresquartal fehlt in der Reihe)
// Die Schwelle liegt in der Mitte der leeren Bank 2..29. UNEMPFINDLICH, ausgezaehlt:
// JEDER Wert aus 2..29 laesst exakt dieselben 9.631 von 30.004 Positionen durch; selbst
// der Sprung in die benachbarte leere Bank 31..88 verschiebt genau EINE Position (0,003 %).
const JAHR_TAGE = 365;
const JAHRESVERGLEICH_TOLERANZ_TAGE = 15;
const MS_PRO_TAG = 86400000;

// ISO-Tagesdatum -> Tagesnummer (UTC), sonst null. Keine Zeitzonen-Arithmetik.
// ROUND-TRIP-PRUEFUNG (03.08.2026, reine Verteidigungslinie): das Muster ^\d{4}-\d{2}-\d{2}
// laesst kalendarisch unmoegliche Tage durch, und Date.parse ROLLT sie still weiter —
// "2025-02-30" wird zum 2. Maerz. Zwei Tage Versatz koennen bei einer Toleranz von 15 Tagen
// eine Kandidaten-Entscheidung kippen. Deshalb: das aus der Tagesnummer zurueckformatierte
// Datum muss dem Original entsprechen, sonst null (ehrlich kein Datum statt ein falsches).
// 0 Vorkommen im lokalen Bestand — die Pruefung kostet nichts und schliesst die Klasse.
function _tagesnummer(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const t = Date.parse(iso.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(t)) return null;
  return (new Date(t).toISOString().slice(0, 10) === iso.slice(0, 10)) ? t / MS_PRO_TAG : null;
}

/**
 * periodEnds(snapshot, field) -> Array<string|null> in der LAENGE der Wert-Serie.
 * Perioden-Enden (`<field>Ends`, A10/NRE-SC-001) als ISO-Tage. Fehlt die Enden-Reihe
 * (Snapshots vor A10, netIncomeQ) oder passt ihre Laenge nicht zur Wert-Serie, kommt
 * eine ehrliche null-Serie zurueck - Index-Integritaet vor Daten, wie _alignEnds.
 */
function periodEnds(snapshot, field) {
  const werte = norm(snapshot, field);
  const roh = (snapshot && snapshot.timeseries) ? snapshot.timeseries[field + 'Ends'] : undefined;
  if (!Array.isArray(roh) || roh.length !== werte.length) return werte.map(() => null);
  return roh.map((d) => (_tagesnummer(d) === null ? null : d));
}

/**
 * jahresVergleichIdx(snapshot, field, i) -> { idx, quelle } | null
 *   { idx, quelle:'datum' }    Enddatum vorhanden und ein Quartal liegt innerhalb der
 *                              Toleranz um (Ende_i - 365 Tage) - das ist der Jahrespartner.
 *   { idx, quelle:'position' } KEIN Enddatum an i ODER kein einziger datierter Kandidat:
 *                              es liegt nichts vor, worueber zu urteilen waere -> die
 *                              bestehende Positionsregel i+4 bleibt in Kraft (fehlendes
 *                              Datum ist KEIN Beweis fuer eine Luecke; 33 % der Reihen
 *                              tragen heute schlicht keine Enden).
 *   null                       datiert, aber kein Quartal im Fenster -> echtes Loch, der
 *                              Jahresvergleich ist fuer diese Position nicht bildbar.
 * idx kann ausserhalb der Serie liegen (Positionsregel) - der Aufrufer prueft das wie bisher.
 */
function jahresVergleichIdx(snapshot, field, i) {
  const enden = periodEnds(snapshot, field);
  const ti = _tagesnummer(enden[i]);
  if (ti === null) return { idx: i + 4, quelle: 'position' };
  let best = null, bestAbw = Infinity;
  for (let j = i + 1; j < enden.length; j++) {
    const tj = _tagesnummer(enden[j]);
    if (tj === null) continue;
    const abw = Math.abs((ti - tj) - JAHR_TAGE);
    // GLEICHSTAND: strikt `<`, also gewinnt der KLEINERE Index — das juengere Quartal.
    // Zwei Kandidaten mit exakt gleicher Abweichung liegen zwangslaeufig symmetrisch um die
    // 365-Tage-Marke (einer davor, einer danach); der juengere haelt den Vergleich naeher am
    // aktuellen Berichtsrhythmus, statt ihn weiter in die Vergangenheit zu ziehen. Die Regel
    // ist damit deterministisch und nicht von der Fundreihenfolge abhaengig. Ausgezaehlt
    // 03.08.2026: 0 Gleichstaende im Toleranzfenster ueber 886 datierte Positionen (4.768
    // lokale Snapshots, Felder revenueQ/grossProfitQ/opIncQ) — festgenagelt, nicht geloggt.
    if (abw < bestAbw) { bestAbw = abw; best = j; }
  }
  if (best === null) return { idx: i + 4, quelle: 'position' };
  return (bestAbw <= JAHRESVERGLEICH_TOLERANZ_TAGE) ? { idx: best, quelle: 'datum' } : null;
}

/**
 * jahresFensterAusgerichtet(snapshot, field, n) -> boolean
 * Fuer BLOCK-Vergleiche (TTM gegen TTM, 4 Quartale gegen 4 Quartale): liegt zu JEDER der
 * n juengsten Positionen der Jahrespartner genau n Plaetze weiter hinten? Nur dann ist ein
 * positionales Vorjahres-FENSTER (slice(n, 2n)) wirklich das Vorjahr. Ohne Enden ist die
 * Antwort immer true - byte-identisch zum bisherigen Verhalten.
 */
function jahresFensterAusgerichtet(snapshot, field, n) {
  for (let i = 0; i < n; i++) {
    const v = jahresVergleichIdx(snapshot, field, i);
    if (v === null || v.idx !== i + n) return false;
  }
  return true;
}

// Null-sicherer metrics-Skalar-Zugriff: snapshot.metrics[key].value oder null.
function metricVal(snapshot, key) {
  const v = (snapshot && snapshot.metrics && snapshot.metrics[key]) ? snapshot.metrics[key].value : undefined;
  return Number.isFinite(v) ? v : null;
}

module.exports = {
  norm, hasPresent, firstPresent, sumPresent, sign, FIELD_REGISTRY,
  presentValues, firstTwoPresent, recentSumPresent, metricVal, ratioSeries,
  // F-4: datumsbewusste Auswahl des Jahres-Vergleichsquartals
  periodEnds, jahresVergleichIdx, jahresFensterAusgerichtet,
  JAHR_TAGE, JAHRESVERGLEICH_TOLERANZ_TAGE,
};
