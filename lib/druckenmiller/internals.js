'use strict';
/**
 * lib/druckenmiller/internals.js — die Achsen L1–L8 der Marktinnereien (Operationalisierung
 * Lane C §2, eingefroren durch Rat-Entscheid D3 vom 2026-09-14).
 *
 * WAS HIER NICHT PASSIERT: keine Schwelle wird hartkodiert (§0.1) ausser den ausdruecklich
 * eingefrorenen Parametern (3-%-Band mit 1-/5-%-Sensitivitaet, Sektor-Split, 63 Balken);
 * kein Signal, kein Ranking, keine Bewertung — dies ist ein LOGGER. Nichts hier beruehrt
 * den Qualitaets-Score (Import-Waechter: tests/druckenmiller/import-graph.test.js).
 *
 * ANKLAGE A3 (Gericht 2026-09-14) IST HIER EINGEBAUT: der Preis-Store wird per Design
 * teilweise aufgefrischt (pull-historical-prices.js:145/197, staleFirstComparator :207) —
 * ein Lauf mit knappem Zeitbudget bleibt gruen und laesst einen Teil von U auf altem Stand.
 * Eine Breite, die frische und tagealte Ticker mischt, misst Runner-Tempo. Deshalb:
 *   - jede Roh-Zeile traegt lastBarDate (die Frische des einzelnen Tickers),
 *   - jede Ledger-Zeile traegt barDateMode + mixedBarDateShare,
 *   - L1–L8 rechnen NUR auf der Teilmenge mit einem Balken AM Sitzungstag; der Rest wird
 *     als excludedNoBar gezaehlt, nie stillschweigend mitgemittelt.
 */
const { spearman } = require('../spearman.js');
const { sectorClass, inNamedBasket } = require('./universe.js');

const SMA_LANG = 200;
const SMA_KURZ = 50;
const FENSTER_252 = 252;
const HORIZONT_63 = 63;
const BAND = 0.03;          // eingefroren (Rat D3)
const BAND_SENSITIV = [0.01, 0.05];
const MIN_LIVE_TAGE_FUER_ZUSTAND = 250; // Rat D3: kein Zustand vor 250 geloggten Tagen

/** Die eingefrorene Feldliste einer Ledger-Zeile (ohne prevHash, den setzt der Ledger). */
const LEDGER_ROW_FIELDS = [
  'schema', 'date', 'generatedAt', 'backfilled',
  'universeSize', 'universeHash', 'barDateMode', 'mixedBarDateShare', 'nAtSession', 'excludedNoBar',
  'l1', 'l1Coverage', 'l2', 'l3', 'l3Band1', 'l3Band5', 'l3Coverage',
  'l4ew', 'l4cw', 'l4Unassigned', 'l4nCyclical', 'l4nDefensive',
  'l4b', 'l4bN', 'l4bSmall',
  'l5', 'l5Coverage', 'l6', 'l7', 'l7Persistence',
  'l8CapMinusEqual', 'l8TopDecileShare', 'rInt',
];
const SCHEMA = 'druckenmiller-internals/1';

const endlich = (x) => (Number.isFinite(x) ? x : null);
const mittel = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** Gewichtetes Mittel; ohne positive Gewichte gibt es keinen Wert (null, nicht 0). */
function gewichtetesMittel(werte, gewichte) {
  let sw = 0, s = 0;
  for (let i = 0; i < werte.length; i++) {
    const g = gewichte[i];
    if (!Number.isFinite(g) || g <= 0 || !Number.isFinite(werte[i])) continue;
    sw += g; s += werte[i] * g;
  }
  return sw > 0 ? s / sw : null;
}

/**
 * Kennzahlen eines Tickers ZUM Sitzungstag. null, wenn er an diesem Tag gar keinen Balken
 * hat — dann gehoert er nicht in den Nenner (A3). Die Serie darf unsortiert sein.
 */
function tickerMetrics(series, sessionDate) {
  if (!Array.isArray(series) || !series.length) return null;
  const bars = series
    .filter((b) => b && b.date && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!bars.length) return null;
  const idx = bars.findIndex((b) => b.date === sessionDate);
  if (idx < 0) return null;
  const bis = bars.slice(0, idx + 1);
  const closes = bis.map((b) => b.close);
  const n = closes.length;
  const fenster = (k) => (n >= k ? closes.slice(n - k) : null);
  const s50 = fenster(SMA_KURZ), s200 = fenster(SMA_LANG), f252 = fenster(FENSTER_252);
  return {
    bars: n,
    close: closes[n - 1],
    sma50: s50 ? mittel(s50) : null,
    sma200: s200 ? mittel(s200) : null,
    high252: f252 ? Math.max.apply(null, f252) : null,
    low252: f252 ? Math.min.apply(null, f252) : null,
    ret63: n > HORIZONT_63 ? closes[n - 1] / closes[n - 1 - HORIZONT_63] - 1 : null,
    // Frische-Beleg (A3): der LETZTE Balken des Tickers im Store, unabhaengig vom Sitzungstag.
    lastBarDate: bars[bars.length - 1].date,
  };
}

/** Anteil der Zeilen mit close > <feld>. Nenner = nur Zeilen, die das Feld haben. */
function shareAbove(rows, feld) {
  const mit = rows.filter((r) => Number.isFinite(r[feld]) && Number.isFinite(r.close));
  if (!mit.length) return null;
  return mit.filter((r) => r.close > r[feld]).length / mit.length;
}

/** L3: Anteil innerhalb <band> des 252-Tage-Hochs minus Anteil innerhalb <band> des Tiefs. */
function newHighsMinusLows(rows, band) {
  const mit = rows.filter((r) => Number.isFinite(r.high252) && Number.isFinite(r.low252)
    && Number.isFinite(r.close) && r.high252 > 0 && r.low252 > 0);
  if (!mit.length) return null;
  const hoch = mit.filter((r) => r.close >= r.high252 * (1 - band)).length;
  const tief = mit.filter((r) => r.close <= r.low252 * (1 + band)).length;
  return (hoch - tief) / mit.length;
}

/** L4: 63-Tage-Rendite-Spread zyklisch minus defensiv, gleich- und kapitalgewichtet. */
function cyclicalsMinusDefensives(rows) {
  const mit = rows.filter((r) => Number.isFinite(r.ret63));
  const zyk = mit.filter((r) => sectorClass(r.sector) === 'cyclical');
  const def = mit.filter((r) => sectorClass(r.sector) === 'defensive');
  const ew = (a, b) => (a.length && b.length ? mittel(a.map((r) => r.ret63)) - mittel(b.map((r) => r.ret63)) : null);
  const cwSeite = (g) => gewichtetesMittel(g.map((r) => r.ret63), g.map((r) => r.marketCap));
  const cwZ = cwSeite(zyk), cwD = cwSeite(def);
  return {
    ew: ew(zyk, def),
    cw: cwZ === null || cwD === null ? null : cwZ - cwD,
    nCyclical: zyk.length,
    nDefensive: def.length,
    // Rat D3 verlangt den Eimer SICHTBAR: er ist ein Drittel von U und waere sonst unsichtbar weg.
    unassigned: mit.filter((r) => sectorClass(r.sector) === 'unassigned').length,
  };
}

/** L4b: sein namentlicher Korb minus dem defensiven Korb, gleichgewichtet, mit n. */
function namedBasketSpread(rows) {
  const mit = rows.filter((r) => Number.isFinite(r.ret63));
  const korb = mit.filter((r) => inNamedBasket(r.industry));
  const def = mit.filter((r) => sectorClass(r.sector) === 'defensive');
  if (!korb.length || !def.length) return { value: null, n: korb.length };
  return { value: mittel(korb.map((r) => r.ret63)) - mittel(def.map((r) => r.ret63)), n: korb.length };
}

/** L5: Anteil der abgedeckten Ticker mit positiven Netto-Revisionen (+1y, 30 Tage). */
function revisionBreadth(rows) {
  const mit = rows.filter((r) => Number.isFinite(r.netRevision30));
  if (!rows.length) return { value: null, coverage: null };
  if (!mit.length) return { value: null, coverage: 0 };
  return { value: mit.filter((r) => r.netRevision30 > 0).length / mit.length, coverage: mit.length / rows.length };
}

/** L7: Median-63-Tage-Rendite je Sektor minus SPY, absteigend gerangt. */
function sectorRs(rows, spyRet63) {
  const nachSektor = new Map();
  for (const r of rows) {
    if (!r.sector || !Number.isFinite(r.ret63)) continue;
    if (!nachSektor.has(r.sector)) nachSektor.set(r.sector, []);
    nachSektor.get(r.sector).push(r.ret63);
  }
  const tabelle = [...nachSektor.entries()]
    .map(([sector, rs]) => ({ sector, rs63: endlich(median(rs) - (Number.isFinite(spyRet63) ? spyRet63 : 0)) }))
    .filter((r) => r.rs63 !== null)
    .sort((a, b) => b.rs63 - a.rs63);
  tabelle.forEach((r, i) => { r.rank = i + 1; });
  return tabelle;
}

/** Spearman der Sektor-Raenge gegen die Vorzeile (nur gemeinsame Sektoren). */
function rankPersistence(jetzt, vorher) {
  if (!Array.isArray(vorher) || !vorher.length || !Array.isArray(jetzt) || !jetzt.length) return null;
  const alt = new Map(vorher.map((r) => [r.sector, r.rank]));
  const a = [], b = [];
  for (const r of jetzt) {
    if (!alt.has(r.sector)) continue;
    a.push(r.rank); b.push(alt.get(r.sector));
  }
  // Die Untergrenze setzt lib/spearman.js selbst (n < 3 -> null, Nullvarianz -> null).
  // Sie hier zu wiederholen waere eine zweite Regel, die von der ersten wegdriften kann.
  const r = spearman(a, b);
  return r === null ? null : endlich(r);
}

/** L8: kapitalgewichtet minus gleichgewichtet, plus Gewinnanteil des obersten Dezils. */
function leadershipNarrowing(rows) {
  const mit = rows.filter((r) => Number.isFinite(r.ret63));
  if (!mit.length) return { capMinusEqual: null, topDecileShare: null };
  const cw = gewichtetesMittel(mit.map((r) => r.ret63), mit.map((r) => r.marketCap));
  const ew = mittel(mit.map((r) => r.ret63));
  const gewinne = mit.map((r) => r.ret63).filter((x) => x > 0).sort((a, b) => b - a);
  const summe = gewinne.reduce((a, b) => a + b, 0);
  const k = Math.max(1, Math.ceil(mit.length / 10));
  return {
    capMinusEqual: cw === null || ew === null ? null : cw - ew,
    topDecileShare: summe > 0 ? gewinne.slice(0, k).reduce((a, b) => a + b, 0) / summe : null,
  };
}

/**
 * Roh-Zeilen je Ticker fuer einen Sitzungstag. JEDER Kandidat bekommt eine Zeile — auch
 * der, dessen letzter Balken alt ist (atSession: false). Die Frische ist ein Befund und
 * kein Grund, jemanden aus dem Protokoll zu nehmen; ausgeschlossen wird er erst in den
 * Aggregaten (A3).
 */
function perTickerRows(candidates, seriesByTicker, sessionDate) {
  const out = [];
  for (const [ticker, k] of candidates) {
    const s = seriesByTicker.get(ticker);
    if (!s || !s.length) continue;
    const m = tickerMetrics(s, sessionDate);
    const letzter = s.reduce((a, b) => (a && a.date > b.date ? a : b), null);
    out.push({
      ticker,
      sector: k.sector || null,
      industry: k.industry || null,
      marketCap: endlich(k.marketCap),
      netRevision30: endlich(k.netRevision30),
      atSession: m !== null,
      lastBarDate: m ? m.lastBarDate : (letzter ? letzter.date : null),
      bars: m ? m.bars : null,
      close: m ? endlich(m.close) : null,
      sma50: m ? endlich(m.sma50) : null,
      sma200: m ? endlich(m.sma200) : null,
      high252: m ? endlich(m.high252) : null,
      low252: m ? endlich(m.low252) : null,
      ret63: m ? endlich(m.ret63) : null,
    });
  }
  return out;
}

/** Der haeufigste letzte Balken-Tag ueber alle Kandidaten (A3). */
function modalBarDate(rawRows) {
  const zaehler = new Map();
  for (const r of rawRows) {
    if (!r.lastBarDate) continue;
    zaehler.set(r.lastBarDate, (zaehler.get(r.lastBarDate) || 0) + 1);
  }
  let best = null, bestN = -1;
  for (const [d, n] of zaehler) if (n > bestN || (n === bestN && d > best)) { best = d; bestN = n; }
  return best;
}

/**
 * Eine vollstaendige Ledger-Zeile. `history` = alle bisherigen Zeilen (fuer R-INT und die
 * Rang-Persistenz); `prevRow` = die letzte Zeile (fuer L7-Persistenz).
 */
function buildRow({ date, rawRows, backfilled, spyState, spyRet63, iwmRet63, prevRow, history, universeHash, now }) {
  const rows = rawRows || [];
  const imTag = rows.filter((r) => r.atSession);
  const mode = modalBarDate(rows);
  const abweichend = rows.filter((r) => r.lastBarDate !== mode).length;
  const l4 = cyclicalsMinusDefensives(imTag);
  const l4b = namedBasketSpread(imTag);
  const l5 = revisionBreadth(imTag);
  const l7 = sectorRs(imTag, spyRet63);
  const l8 = leadershipNarrowing(imTag);
  const mit252 = imTag.filter((r) => Number.isFinite(r.high252)).length;
  const mitSma200 = imTag.filter((r) => Number.isFinite(r.sma200)).length;

  // Rat D3: R-INT wird berechnet und geloggt, aber NIE als Zustand veroeffentlicht — und
  // vor 250 geloggten LIVE-Tagen (backfilled zaehlt nicht, Rat D2) gibt es ihn gar nicht.
  const liveTage = (history || []).filter((r) => r.backfilled !== true).length;
  const rInt = liveTage >= MIN_LIVE_TAGE_FUER_ZUSTAND ? 0 : null;

  const row = {
    schema: SCHEMA,
    date,
    generatedAt: (now || new Date()).toISOString(),
    backfilled: backfilled === true,
    universeSize: rows.length,
    universeHash: universeHash || null,
    barDateMode: mode,
    mixedBarDateShare: rows.length ? abweichend / rows.length : null,
    nAtSession: imTag.length,
    excludedNoBar: rows.length - imTag.length,
    l1: shareAbove(imTag, 'sma200'),
    l1Coverage: imTag.length ? mitSma200 / imTag.length : null,
    l2: shareAbove(imTag, 'sma50'),
    l3: newHighsMinusLows(imTag, BAND),
    l3Band1: newHighsMinusLows(imTag, BAND_SENSITIV[0]),
    l3Band5: newHighsMinusLows(imTag, BAND_SENSITIV[1]),
    l3Coverage: imTag.length ? mit252 / imTag.length : null,
    l4ew: l4.ew,
    l4cw: l4.cw,
    l4Unassigned: l4.unassigned,
    l4nCyclical: l4.nCyclical,
    l4nDefensive: l4.nDefensive,
    l4b: l4b.value,
    l4bN: l4b.n,
    l4bSmall: Number.isFinite(iwmRet63) && Number.isFinite(spyRet63) ? iwmRet63 - spyRet63 : null,
    l5: l5.value,
    l5Coverage: l5.coverage,
    l6: spyState || null,
    l7,
    l7Persistence: rankPersistence(l7, prevRow && prevRow.l7),
    l8CapMinusEqual: l8.capMinusEqual,
    l8TopDecileShare: l8.topDecileShare,
    rInt,
  };
  // Die Feldliste ist eingefroren: gleiche Reihenfolge, gleicher Bestand (Waechter I13).
  const geordnet = {};
  for (const k of LEDGER_ROW_FIELDS) geordnet[k] = row[k] === undefined ? null : row[k];
  return geordnet;
}

module.exports = {
  LEDGER_ROW_FIELDS, SCHEMA, BAND, BAND_SENSITIV, HORIZONT_63, MIN_LIVE_TAGE_FUER_ZUSTAND,
  tickerMetrics, shareAbove, newHighsMinusLows, cyclicalsMinusDefensives, namedBasketSpread,
  revisionBreadth, sectorRs, rankPersistence, leadershipNarrowing, perTickerRows, modalBarDate, buildRow,
};
