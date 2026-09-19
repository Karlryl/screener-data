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
const { sectorClass, inNamedBasket, MIN_BARS, universeHash: hashOf } = require('./universe.js');

const SMA_LANG = 200;
const SMA_KURZ = 50;
const FENSTER_252 = 252;
const HORIZONT_63 = 63;
const BAND = 0.03;          // eingefroren (Rat D3)
const BAND_SENSITIV = [0.01, 0.05];
// L4b-Mindestkorb (Registrierungs-Datei A, Chunk 1). Er stand in der Spezifikation als
// Zahl ohne Durchsetzung — dieselbe Klasse wie der Review-Fund H1 aus Chunk 0 ("die
// U-Regel >= 250 Balken war nirgends erzwungen"). Ein Korb aus drei Titeln ist kein
// Branchen-Spread, sondern drei Aktien. Auf dem heutigen Bestand aendert die Schranke
// nichts (l4bN 45..51 ueber alle 87 Zeilen) — sie greift, wenn der Korb wegbricht.
const L4B_MIN_BASKET = 20;
const MIN_LIVE_TAGE_FUER_ZUSTAND = 250; // Rat D3: kein Zustand vor 250 geloggten Tagen
// Frische-Tor (Gericht Runde 1, 14.09.2026): unter diesem Anteil frischer Ticker ist die
// Tageszeile eine Aussage ueber den Runner und nicht ueber den Markt. Gemessen am
// Vortag: 98,7 % am modalen Balken-Tag — an normalen Tagen bleibt das Tor still.
const FRESH_MIN = 0.95;

/** Die eingefrorene Feldliste einer Ledger-Zeile (ohne prevHash, den setzt der Ledger). */
const LEDGER_ROW_FIELDS = [
  'schema', 'date', 'generatedAt', 'backfilled',
  'nCandidates', 'nSnapshotUnreadable', 'nNoSeries', 'nAtSession', 'excludedNoBar', 'excludedFewBars',
  'universeSize', 'universeHash', 'barDateMode', 'mixedBarDateShare', 'freshShare', 'nExcludedStale',
  'lowFreshness',
  'l1', 'l1Coverage', 'l2', 'l3', 'l3Band1', 'l3Band5', 'l3Coverage',
  'l4ew', 'l4cw', 'l4Unassigned', 'l4nCyclical', 'l4nDefensive',
  'l4b', 'l4bN', 'l4bSmall',
  'l5', 'l5Coverage', 'l6', 'l7', 'l7Persistence',
  'l8CapMinusEqual', 'l8TopDecileShare', 'l8Winners', 'rInt',
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
  if (korb.length < L4B_MIN_BASKET || !def.length) return { value: null, n: korb.length };
  return { value: mittel(korb.map((r) => r.ret63)) - mittel(def.map((r) => r.ret63)), n: korb.length };
}

/** L5: Anteil der abgedeckten Ticker mit positiven Netto-Revisionen (+1y, 30 Tage). */
function revisionBreadth(rows) {
  const mit = rows.filter((r) => Number.isFinite(r.netRevision30));
  if (!rows.length) return { value: null, coverage: null };
  if (!mit.length) return { value: null, coverage: 0 };
  return { value: mit.filter((r) => r.netRevision30 > 0).length / mit.length, coverage: mit.length / rows.length };
}

/**
 * L7: Median-63-Tage-Rendite je Sektor minus SPY, absteigend gerangt.
 *
 * REVIEW-FUND: hier stand als einzige Stelle des Moduls ein stilles `: 0`, wenn die
 * SPY-Rendite fehlt. Aus relativer Staerke wurde damit die absolute Sektor-Rendite —
 * unter demselben Feldnamen, ohne Marker. Fehlt SPY, gibt es kein L7 (null), nicht
 * eine Zahl, die spaeter niemand mehr von einer echten unterscheiden kann.
 * Zweiter Fund: bei Gleichstand entschied die Einlesereihenfolge der Shards ueber den
 * Rang. Der Sektorname als Stichentscheid macht den Rangvektor zu einer reinen
 * Funktion der Daten — l7Persistence haengt direkt daran.
 */
function sectorRs(rows, spyRet63) {
  if (!Number.isFinite(spyRet63)) return [];
  const nachSektor = new Map();
  for (const r of rows) {
    if (!r.sector || !Number.isFinite(r.ret63)) continue;
    if (!nachSektor.has(r.sector)) nachSektor.set(r.sector, []);
    nachSektor.get(r.sector).push(r.ret63);
  }
  const tabelle = [...nachSektor.entries()]
    .map(([sector, rs]) => ({ sector, rs63: endlich(median(rs) - spyRet63) }))
    .filter((r) => r.rs63 !== null)
    .sort((a, b) => (b.rs63 - a.rs63) || a.sector.localeCompare(b.sector));
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

/**
 * L8: kapitalgewichtet minus gleichgewichtet, plus Gewinnanteil des obersten Dezils.
 *
 * REVIEW-FUND: das Dezil ist ein Zehntel von U, der Anteil aber wird ueber die GEWINNER
 * gebildet. Sind weniger Titel im Plus als das Dezil gross ist, umfasst "das oberste
 * Dezil" alle Gewinner und der Anteil ist konstruktionsbedingt 1 — ausgerechnet an den
 * Tagen, an denen die Frage nach der Verengung interessant waere. Der Wert ist dann
 * null (nicht messbar), und die Zahl der Gewinner steht daneben, damit ein Leser
 * Saettigung von echter Konzentration unterscheiden kann.
 */
function leadershipNarrowing(rows) {
  const mit = rows.filter((r) => Number.isFinite(r.ret63));
  if (!mit.length) return { capMinusEqual: null, topDecileShare: null, nWinners: 0 };
  const cw = gewichtetesMittel(mit.map((r) => r.ret63), mit.map((r) => r.marketCap));
  const ew = mittel(mit.map((r) => r.ret63));
  const gewinne = mit.map((r) => r.ret63).filter((x) => x > 0).sort((a, b) => b - a);
  const summe = gewinne.reduce((a, b) => a + b, 0);
  const k = Math.max(1, Math.ceil(mit.length / 10));
  return {
    capMinusEqual: cw === null || ew === null ? null : cw - ew,
    topDecileShare: summe > 0 && gewinne.length > k
      ? gewinne.slice(0, k).reduce((a, b) => a + b, 0) / summe
      : null,
    nWinners: gewinne.length,
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
    // REVIEW-FUND (reproduziert): ein Kandidat ohne Preisserie bekam GAR KEINE Zeile —
    // er fiel aus universeSize, aus excludedNoBar und aus dem Frische-Anteil heraus. Ein
    // fehlender Shard schrumpfte U still, und die Zeile sah kerngesund aus (freshShare 1,0,
    // --check gruen). Das A3-Werk misst VERALTETE Balken und war fuer FEHLENDE Ticker
    // strukturell blind. Jetzt bekommt jeder Kandidat eine Zeile, und noSeries wird gezaehlt.
    if (!s || !s.length) {
      out.push({
        ticker, sector: k.sector || null, industry: k.industry || null,
        marketCap: endlich(k.marketCap), netRevision30: endlich(k.netRevision30),
        noSeries: true, atSession: false, inUniverse: false,
        lastBarDate: null, bars: null, close: null, sma50: null, sma200: null,
        high252: null, low252: null, ret63: null,
      });
      continue;
    }
    const m = tickerMetrics(s, sessionDate);
    // Der letzte Balken kommt aus derselben GEFILTERTEN Menge wie alles andere: ein
    // kaputter letzter Balken (ohne date) machte lastBarDate sonst undefined, und
    // JSON.stringify liess das Feld dann ganz weg (Review-Fund L-b).
    const letzter = m ? m.lastBarDate
      : s.filter((b) => b && b.date && Number.isFinite(b.close) && b.close > 0)
        .reduce((a, b) => (a && a.date > b.date ? a : b), null);
    out.push({
      ticker,
      sector: k.sector || null,
      industry: k.industry || null,
      marketCap: endlich(k.marketCap),
      netRevision30: endlich(k.netRevision30),
      noSeries: false,
      atSession: m !== null,
      // U nach Rat D4 ist erst hier vollstaendig: Balken AM Sitzungstag UND >= 250 Balken.
      // Die Balken-Bedingung war bisher nirgends erzwungen (Review-Fund, reproduziert:
      // 86 von 2.288 Tickern lagen darunter, 69 davon mit einer 63-Tage-Rendite).
      inUniverse: m !== null && m.bars >= MIN_BARS,
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

/**
 * Perzentil-Rang eines Wertes in einer Verteilung (Mittelrang bei Gleichstand), 0..1.
 */
function percentileRank(werte, wert) {
  const xs = werte.filter(Number.isFinite);
  if (!xs.length || !Number.isFinite(wert)) return null;
  const kleiner = xs.filter((x) => x < wert).length;
  const gleich = xs.filter((x) => x === wert).length;
  return (kleiner + 0.5 * gleich) / xs.length;
}

/**
 * R-INT = gleichgewichteter Rang-Mittelwert von L1–L4 im expandierenden Fenster
 * (Operationalisierung §2). Rat D3: berechnet und geloggt, aber NIE als Zustand
 * veroeffentlicht — und vor 250 geloggten LIVE-Tagen gibt es ihn gar nicht.
 *
 * REVIEW-FUND: hier stand `liveTage >= 250 ? 0 : null`. In rund 250 Handelstagen haette
 * die Reihe angefangen, eine hartkodierte, vollkommen plausible neutrale Null zu
 * schreiben, die spaeter niemand mehr von einer Messung haette unterscheiden koennen.
 * Der Test pinnte nur die null-Seite und konnte an dem Tag nicht feuern.
 */
function rIntRankMean(history, jetzt) {
  const geeignet = (history || []).filter((r) => r.backfilled !== true && r.lowFreshness !== true
    && r.highChurn !== true);
  if (geeignet.length < MIN_LIVE_TAGE_FUER_ZUSTAND) return null;
  const beine = ['l1', 'l2', 'l3', 'l4ew'];
  const raenge = [];
  for (const b of beine) {
    const r = percentileRank(geeignet.map((x) => x[b]).concat([jetzt[b]]), jetzt[b]);
    if (r !== null) raenge.push(r);
  }
  return raenge.length ? mittel(raenge) : null;
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
function buildRow({ date, rawRows, backfilled, spyState, spyRet63, iwmRet63, prevRow, history,
  snapshotUnreadable, now }) {
  const rows = rawRows || [];
  const mitSerie = rows.filter((r) => !r.noSeries);
  const imTag = rows.filter((r) => r.atSession);
  // U ist die Teilmenge, auf der ALLE Achsen rechnen: Balken am Sitzungstag UND >= 250
  // Balken (Rat D4). Alles andere wird gezaehlt, nicht stillschweigend mitgemittelt.
  const u = rows.filter((r) => r.inUniverse);
  const mode = modalBarDate(mitSerie);
  const abweichend = mitSerie.filter((r) => r.lastBarDate !== mode).length;
  const frisch = mitSerie.length ? 1 - abweichend / mitSerie.length : null;
  // Zweite Frische-Frage (Review-Fund L-c): der Anteil misst STREUUNG der Balken-Tage.
  // Ein gleichmaessig einen Tag alter Store gaebe freshShare 1,0 — sauber aussehend und
  // trotzdem nicht der Sitzungstag. Deshalb faellt das Tor auch, wenn der modale Tag
  // nicht der Tag ist, ueber den die Zeile spricht.
  const modePasst = mode === date;
  const l4 = cyclicalsMinusDefensives(u);
  const l4b = namedBasketSpread(u);
  const l5 = revisionBreadth(u);
  const l7 = sectorRs(u, spyRet63);
  const l8 = leadershipNarrowing(u);
  const mit252 = u.filter((r) => Number.isFinite(r.high252)).length;
  const mitSma200 = u.filter((r) => Number.isFinite(r.sma200)).length;

  const row = {
    schema: SCHEMA,
    date,
    generatedAt: (now || new Date()).toISOString(),
    backfilled: backfilled === true,
    nCandidates: rows.length,
    nSnapshotUnreadable: Number.isFinite(snapshotUnreadable) ? snapshotUnreadable : null,
    nNoSeries: rows.length - mitSerie.length,
    nAtSession: imTag.length,
    excludedNoBar: mitSerie.length - imTag.length,
    excludedFewBars: imTag.length - u.length,
    universeSize: u.length,
    universeHash: u.length ? hashOf(u.map((r) => r.ticker)) : null,
    barDateMode: backfilled === true ? null : mode,
    mixedBarDateShare: backfilled === true ? null : (mitSerie.length ? abweichend / mitSerie.length : null),
    freshShare: backfilled === true ? null : frisch,
    nExcludedStale: backfilled === true ? null : abweichend,
    lowFreshness: backfilled === true ? false : (frisch === null || frisch < FRESH_MIN || !modePasst),
    l1: shareAbove(u, 'sma200'),
    l1Coverage: u.length ? mitSma200 / u.length : null,
    l2: shareAbove(u, 'sma50'),
    l3: newHighsMinusLows(u, BAND),
    l3Band1: newHighsMinusLows(u, BAND_SENSITIV[0]),
    l3Band5: newHighsMinusLows(u, BAND_SENSITIV[1]),
    l3Coverage: u.length ? mit252 / u.length : null,
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
    l8Winners: l8.nWinners,
    rInt: null, // wird gleich gesetzt: rIntRankMean braucht die fertigen Beine dieser Zeile
  };
  row.rInt = rIntRankMean(history, row);
  // Die Feldliste ist eingefroren: gleiche Reihenfolge, gleicher Bestand (Waechter I13).
  const geordnet = {};
  for (const k of LEDGER_ROW_FIELDS) geordnet[k] = row[k] === undefined ? null : row[k];
  return geordnet;
}

module.exports = {
  LEDGER_ROW_FIELDS, SCHEMA, BAND, BAND_SENSITIV, HORIZONT_63, MIN_LIVE_TAGE_FUER_ZUSTAND, FRESH_MIN,
  L4B_MIN_BASKET, SMA_LANG, SMA_KURZ, FENSTER_252,
  tickerMetrics, shareAbove, newHighsMinusLows, cyclicalsMinusDefensives, namedBasketSpread,
  revisionBreadth, sectorRs, rankPersistence, leadershipNarrowing, perTickerRows, modalBarDate,
  percentileRank, rIntRankMean, buildRow,
};
