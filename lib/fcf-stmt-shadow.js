'use strict';
/**
 * FCF-Schatten aus Yahoos Jahres-Kapitalflussrechnung (P87, Ratsentscheid 06.10.2026, Frage 1, Option C).
 *
 * Heute speisen Rule of 40 und die Rule-of-X-Achse aller 13 HyperGrowth-Formeln die Marge
 * metrics.fcfMarginTTM = financialData.freeCashflow / financialData.totalRevenue (pull-yahoo.js).
 * P60/P73 haben gezeigt, dass dieses Kennzahlfeld eine andere Groesse ist als die Kapitalfluss-
 * rechnung, die im selben Snapshot liegt und zu den Geschaeftsberichten passt.
 *
 * Diese Datei rechnet NUR einen SCHATTEN. Keine sichtbare Zahl aendert sich: Score, Rang, r40,
 * fcfMarginPct und die Achsen-Perzentile bleiben, wie sie sind. Die Umstellung auf live ist ein
 * eigenes Paket nach mindestens vier Wochen Parallelbetrieb.
 *
 * Regeln:
 *  - Die Schattenmarge ist ein GESCHAEFTSJAHRESWERT (FY), nie "TTM".
 *  - Wert nur, wenn annualFCF[0] und annualRev[0] dasselbe belegte Geschaeftsjahresende tragen
 *    (annual.<feld>Ends[0] oder meta.statementPeriods.<feld>[0].end). Sonst null mit Grund.
 *    Das Jahr wird nie aus der Array-Position geraten, es gibt keinen Rueckfall auf
 *    fcfMarginTTM und nie eine 0 als Ersatz (T2). Eine echte 0 bleibt 0.
 *  - Der Behoerden-Jahreswert (SEC bzw. KR/JP/TW-Store, external-data/*-secannual.json) ist nur
 *    eine Schutzspalte. Er ersetzt den Schatten nie. Diese Stores fuehren das Geschaeftsjahr als
 *    Zahl (nfy), kein Enddatum; verglichen wird deshalb das Kalenderjahr des Schatten-GJ-Endes.
 */
const fs = require('fs');
const path = require('path');
const { norm, metricVal } = require('../src/scoring/snapshot.js');
const { fcfMarginValid, fcfTrack } = require('../src/scoring/engine.js');
const { ruleOfX } = require('../src/scoring/axes.js');
const { annualCurrencyLeak } = require('../src/scoring/lamps.js');

/** Grundcodes fuer einen leeren Schatten. 'ok' heisst: Wert vorhanden. */
const SCHATTEN_GRUND = Object.freeze({
  OK: 'ok',
  FCF_FEHLT: 'fcf-missing',
  UMSATZ_FEHLT: 'revenue-missing',
  UMSATZ_NICHT_POSITIV: 'revenue-nonpositive',
  GJ_ENDE_FEHLT: 'fy-end-missing',
  GJ_ENDE_ABWEICHEND: 'fy-end-mismatch',
  WAEHRUNG_ABWEICHEND: 'currency-mismatch',
  WAEHRUNGS_LECK: 'currency-leak',
  KEIN_JAHRESZEITRAUM: 'period-not-12m',
});

const ROOT = path.join(__dirname, '..');
const BEHOERDEN_DATEIEN = Object.freeze(['sec-secannual.json', 'sec-secannual-smallcap.json',
  'kr-secannual.json', 'jp-secannual.json', 'tw-secannual.json']);

const istZahl = (v) => typeof v === 'number' && Number.isFinite(v);
const wertVon = (e) => (e && typeof e === 'object' ? e.value : e);
const isoTag = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/**
 * Belegtes Geschaeftsjahresende des juengsten Eintrags einer Jahresreihe.
 * @param {object} snapshot Snapshot im Pull-Format.
 * @param {string} feld Name der Jahresreihe, z. B. 'annualFCF' oder 'annualRev'.
 * @returns {string|null} ISO-Tag 'YYYY-MM-DD' oder null, wenn kein Datum belegt ist.
 */
function gjEnde(snapshot, feld) {
  const annual = (snapshot && snapshot.annual) || {};
  const enden = annual[`${feld}Ends`];
  if (Array.isArray(enden) && enden.length) {
    const t = isoTag(enden[0]);
    if (t) return t;
  }
  const perioden = snapshot && snapshot.meta && snapshot.meta.statementPeriods && snapshot.meta.statementPeriods[feld];
  if (Array.isArray(perioden) && perioden[0] && typeof perioden[0] === 'object') return isoTag(perioden[0].end);
  return null;
}

/**
 * Beleg des juengsten Eintrags einer Jahresreihe aus meta.statementPeriods (Waehrung, Dauer).
 * @param {object} snapshot Snapshot im Pull-Format.
 * @param {string} feld Name der Jahresreihe.
 * @returns {{currency: (string|null), duration: (string|null)}} null, wo nichts belegt ist.
 */
function periodenBeleg(snapshot, feld) {
  const perioden = snapshot && snapshot.meta && snapshot.meta.statementPeriods && snapshot.meta.statementPeriods[feld];
  const p = Array.isArray(perioden) && perioden[0] && typeof perioden[0] === 'object' ? perioden[0] : {};
  return {
    currency: typeof p.currency === 'string' && p.currency ? p.currency.toUpperCase() : null,
    duration: typeof p.duration === 'string' && p.duration ? p.duration : null,
  };
}

/**
 * FCF-Marge des juengsten Geschaeftsjahres aus der Kapitalflussrechnung, in Prozent.
 * @param {object} snapshot Snapshot im Pull-Format (annual.annualFCF, annual.annualRev, Enden).
 * @returns {{value: (number|null), grund: string, gjEnde: (string|null)}} value ist null genau dann,
 *   wenn grund nicht 'ok' ist; gjEnde ist das gemeinsame Geschaeftsjahresende oder null.
 *   T1: belegen die Berichtsperioden fuer FCF und Umsatz verschiedene Waehrungen, oder meldet
 *   lamps.annualCurrencyLeak eine Fremdwaehrungs-Jahresreihe, bleibt der Wert null. Eine belegte
 *   Dauer, die kein volles Jahr ist, ebenso.
 */
function fcfMarginStmtFY(snapshot) {
  const annual = (snapshot && snapshot.annual) || {};
  const fcfReihe = Array.isArray(annual.annualFCF) ? annual.annualFCF : [];
  const umsatzReihe = Array.isArray(annual.annualRev) ? annual.annualRev : [];
  const fcf = fcfReihe.length ? wertVon(fcfReihe[0]) : null;
  const umsatz = umsatzReihe.length ? wertVon(umsatzReihe[0]) : null;
  if (!istZahl(fcf)) return { value: null, grund: SCHATTEN_GRUND.FCF_FEHLT, gjEnde: null };
  if (!istZahl(umsatz)) return { value: null, grund: SCHATTEN_GRUND.UMSATZ_FEHLT, gjEnde: null };
  if (umsatz <= 0) return { value: null, grund: SCHATTEN_GRUND.UMSATZ_NICHT_POSITIV, gjEnde: null };
  const endeFcf = gjEnde(snapshot, 'annualFCF');
  const endeUmsatz = gjEnde(snapshot, 'annualRev');
  if (!endeFcf || !endeUmsatz) return { value: null, grund: SCHATTEN_GRUND.GJ_ENDE_FEHLT, gjEnde: null };
  if (endeFcf !== endeUmsatz) return { value: null, grund: SCHATTEN_GRUND.GJ_ENDE_ABWEICHEND, gjEnde: null };
  const belegFcf = periodenBeleg(snapshot, 'annualFCF'), belegUmsatz = periodenBeleg(snapshot, 'annualRev');
  if (belegFcf.currency && belegUmsatz.currency && belegFcf.currency !== belegUmsatz.currency) {
    return { value: null, grund: SCHATTEN_GRUND.WAEHRUNG_ABWEICHEND, gjEnde: null };
  }
  if ((belegFcf.duration && belegFcf.duration !== '12M') || (belegUmsatz.duration && belegUmsatz.duration !== '12M')) {
    return { value: null, grund: SCHATTEN_GRUND.KEIN_JAHRESZEITRAUM, gjEnde: null };
  }
  if (annualCurrencyLeak(snapshot) === true) return { value: null, grund: SCHATTEN_GRUND.WAEHRUNGS_LECK, gjEnde: null };
  return { value: (fcf / umsatz) * 100, grund: SCHATTEN_GRUND.OK, gjEnde: endeFcf };
}

/**
 * Kopie des Snapshots, in der NUR metrics.fcfMarginTTM durch den Schattenwert ersetzt ist
 * (null entfernt das Feld). Das Original bleibt unveraendert.
 * @param {object} snapshot Snapshot im Pull-Format.
 * @param {number|null} marge Schattenmarge in Prozent oder null.
 * @returns {object} flache Kopie mit eigener metrics-Huelle.
 */
function snapshotMitMarge(snapshot, marge) {
  const metrics = Object.assign({}, (snapshot && snapshot.metrics) || {});
  if (istZahl(marge)) {
    const alt = metrics.fcfMarginTTM && typeof metrics.fcfMarginTTM === 'object' ? metrics.fcfMarginTTM : {};
    metrics.fcfMarginTTM = Object.assign({}, alt, { value: marge, source: 'yahoo-cashflow-statement-fy' });
  } else {
    delete metrics.fcfMarginTTM;
  }
  return Object.assign({}, snapshot, { metrics });
}

/**
 * Rule-of-X-Rohwert (score.js rawAxisValue-Weg) mit einer frei gewaehlten FCF-Marge.
 * @param {object} snapshot Snapshot im Pull-Format.
 * @param {number|null} marge FCF-Marge in Prozent, die an Stelle von fcfMarginTTM tritt.
 * @param {number} alpha Wachstumsgewicht der Formel (formula.alpha).
 * @param {Array<number>|null} growthBounds data-learned Wachstums-Schranken der Kalibrierung.
 * @returns {number|null} Rohwert der Achse oder null, wenn kein Wachstum berechenbar ist.
 */
function ruleOfXMitMarge(snapshot, marge, alpha, growthBounds) {
  const s = snapshotMitMarge(snapshot, marge);
  const includeFcf = fcfTrack(metricVal(s, 'fcfMarginTTM'), norm(s, 'annualFCF'), norm(s, 'annualOCF')) === 'profitable';
  return ruleOfX(s, alpha, includeFcf, growthBounds);
}

/**
 * Rule-of-X heute und im Schatten, beide aus demselben Snapshot und denselben Schranken gerechnet,
 * damit der Unterschied nur aus der FCF-Quelle kommt.
 * @param {object} snapshot Snapshot im Pull-Format.
 * @param {number} alpha Wachstumsgewicht der Formel.
 * @param {Array<number>|null} growthBounds Wachstums-Schranken der Kalibrierung.
 * @returns {{heute: (number|null), schatten: (number|null), schattenMitFcf: boolean}} schattenMitFcf
 *   sagt, ob der Schatten-FCF-Term die Datentore G0-G3 bestanden hat und addiert wurde.
 */
function ruleOfXSchatten(snapshot, alpha, growthBounds) {
  const sh = fcfMarginStmtFY(snapshot);
  const heute = ruleOfXMitMarge(snapshot, metricVal(snapshot, 'fcfMarginTTM'), alpha, growthBounds);
  const schatten = ruleOfXMitMarge(snapshot, sh.value, alpha, growthBounds);
  const schattenMitFcf = istZahl(sh.value)
    && fcfMarginValid(sh.value, norm(snapshot, 'annualFCF'), norm(snapshot, 'annualOCF'))
    && fcfTrack(sh.value, norm(snapshot, 'annualFCF'), norm(snapshot, 'annualOCF')) === 'profitable';
  return { heute, schatten, schattenMitFcf };
}

/**
 * Laedt die Behoerden-Jahresdaten (SEC und regionale Stores) als Ticker-Tabelle.
 * @param {Array<string>} [dateien] absolute Pfade; Default die committeten Stores in external-data/.
 * @returns {Map<string, {quelle: string, nfy: (number|null), annualFCF: Array, annualRev: Array}>}
 *   je Ticker der LETZTE Store, der ihn fuehrt (Reihenfolge und Vorrang wie in run-screener.js).
 */
function ladeBehoerdenJahre(dateien = BEHOERDEN_DATEIEN.map((f) => path.join(ROOT, 'external-data', f))) {
  const tabelle = new Map();
  for (const p of dateien) {
    let daten;
    try { daten = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
      // Fehlt die Datei, ist das ein erlaubter Zustand (wie in run-screener.js). Ist sie da, aber
      // unlesbar, wird die Schutzspalte sonst still leer: dann laut melden.
      if (!e || e.code !== 'ENOENT') console.warn(`::warning::[fcf-shadow] Behoerden-Store unlesbar: ${path.basename(p)} (${e && e.message})`);
      continue;
    }
    for (const [ticker, d] of Object.entries(daten || {})) {
      // Letzte Datei gewinnt, wie Object.assign in run-screener.js mergeSecIntoUniverse.
      if (!d || typeof d !== 'object') continue;
      tabelle.set(ticker, {
        quelle: path.basename(p),
        nfy: istZahl(d.nfy) ? d.nfy : null,
        annualFCF: Array.isArray(d.annualFCF) ? d.annualFCF : [],
        annualRev: Array.isArray(d.annualRev) ? d.annualRev : [],
      });
    }
  }
  return tabelle;
}

/**
 * Schutzspalte: FCF-Marge des juengsten Behoerden-Geschaeftsjahres und ihr Abstand zum Schatten.
 * @param {{quelle: string, nfy: (number|null), annualFCF: Array, annualRev: Array}|undefined} eintrag
 *   Eintrag aus ladeBehoerdenJahre() oder undefined.
 * @param {{value: (number|null), gjEnde: (string|null)}} schatten Ergebnis von fcfMarginStmtFY().
 * @returns {{marge: (number|null), geschaeftsjahr: (number|null), quelle: (string|null),
 *   gleichesJahr: (boolean|null), abstandPp: (number|null)}} abstandPp nur bei gleichem Jahr.
 */
function behoerdenSchutz(eintrag, schatten) {
  const leer = { marge: null, geschaeftsjahr: null, quelle: null, gleichesJahr: null, abstandPp: null };
  if (!eintrag) return leer;
  const fcf = eintrag.annualFCF.length ? wertVon(eintrag.annualFCF[0]) : null;
  const umsatz = eintrag.annualRev.length ? wertVon(eintrag.annualRev[0]) : null;
  const marge = istZahl(fcf) && istZahl(umsatz) && umsatz > 0 ? (fcf / umsatz) * 100 : null;
  const jahrSchatten = schatten && schatten.gjEnde ? Number(schatten.gjEnde.slice(0, 4)) : null;
  const gleichesJahr = eintrag.nfy !== null && jahrSchatten !== null ? eintrag.nfy === jahrSchatten : null;
  const abstandPp = gleichesJahr === true && istZahl(marge) && istZahl(schatten.value) ? schatten.value - marge : null;
  return { marge, geschaeftsjahr: eintrag.nfy, quelle: eintrag.quelle, gleichesJahr, abstandPp };
}

const round1 = (x) => (istZahl(x) ? Math.round(x * 10) / 10 : null);

/**
 * Export-Objekt fcfShadow fuer eine Board-Zeile (HyperGrowth): Schattenmarge, Grund, GJ-Ende,
 * Rule-of-X heute und im Schatten, Schutzspalte. Alle Prozentwerte auf eine Nachkommastelle.
 * @param {object} snapshot Snapshot im Pull-Format.
 * @param {number|null} alpha Wachstumsgewicht der Formel oder null, wenn die Formel unbekannt ist.
 * @param {Array<number>|null} growthBounds Wachstums-Schranken der Kalibrierung.
 * @param {object|undefined} behoerde Eintrag aus ladeBehoerdenJahre().
 * @returns {object} { fcfMarginStmtFY, grund, gjEnde, ruleOfXHeute, ruleOfXShadow (null ohne FY-Marge), schattenFcfAktiv,
 *   behoerdeFcfMarginFY, behoerdeGeschaeftsjahr, behoerdeQuelle, behoerdeAbstandPp }
 */
function boardSchatten(snapshot, alpha, growthBounds, behoerde) {
  const sh = fcfMarginStmtFY(snapshot);
  const rx = istZahl(alpha) ? ruleOfXSchatten(snapshot, alpha, growthBounds) : { heute: null, schatten: null, schattenMitFcf: false };
  const schutz = behoerdenSchutz(behoerde, sh);
  return {
    fcfMarginStmtFY: round1(sh.value),
    grund: sh.grund,
    gjEnde: sh.gjEnde,
    ruleOfXHeute: round1(rx.heute),
    // Ohne FY-Marge ist der Schatten leer, nicht 'Achse ohne FCF-Term' (sonst mischt ein spaeterer
    // Vergleich fehlende Daten mit einer Formelaenderung).
    ruleOfXShadow: istZahl(sh.value) ? round1(rx.schatten) : null,
    schattenFcfAktiv: rx.schattenMitFcf,
    behoerdeFcfMarginFY: round1(schutz.marge),
    behoerdeGeschaeftsjahr: schutz.geschaeftsjahr,
    behoerdeQuelle: schutz.quelle,
    behoerdeAbstandPp: round1(schutz.abstandPp),
  };
}

module.exports = {
  SCHATTEN_GRUND, BEHOERDEN_DATEIEN,
  gjEnde, periodenBeleg, fcfMarginStmtFY, snapshotMitMarge, ruleOfXMitMarge, ruleOfXSchatten,
  ladeBehoerdenJahre, behoerdenSchutz, boardSchatten,
};
