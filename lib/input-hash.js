'use strict';
/**
 * inputHash - Fingerabdruck der ZUSAMMENGEBAUTEN Scoring-Eingabe einer Zeile.
 *
 * Warum es das gibt (Rat 23.08., Weichen B1/B2): heute wirft der Tagesvergleich "der Provider
 * hat revidiert" und "die Kohorte hat sich verschoben" in einen Topf. Zwischen Datei und
 * scoreUniverse liegen loadUniverse() und mergeSecIntoUniverse; was am Ende wirklich in die
 * Achsen geht, steht nirgends als eine Zahl.
 *
 * ---------------------------------------------------------------------------------------
 * FASSUNG 2 (Gerichtsauflage 23.08., Fall Fussabdruck-Vertrag DENIED, Lektion L37).
 *
 * Fassung 1 fuehrte die kohorten-bestimmenden Felder VON HAND und deckte drei von dreizehn.
 * Belegt am Artefakt: SOFI, `meta.industry` geaendert -> Ergebnis springt von `exclude/` auf
 * `route/financials/50`, waehrend alle Hashes byte-identisch blieben. Der eigene Waechter fand
 * es nicht, weil er nur pruefte, was auf der Liste stand.
 *
 * Die Heilung ist NICHT "mehr Felder eintragen", sondern: die VOLLSTAENDIGKEIT wird abgeleitet.
 * `lib/gelesene-felder.js` beobachtet mit einem Proxy, welche Felder das Scoring beim Laufen
 * tatsaechlich anfasst; `tests/input-hash.test.js` verlangt, dass JEDER beobachtete Pfad hier
 * einer Schicht zugeordnet ist. Ein neues Feld im Scoring, das hier fehlt, macht den Waechter
 * rot - er kann nicht mehr uebersehen, was er nicht kennt.
 *
 * Bewusst KEIN Grep ueber den Quelltext: das waere ein Schreibmuster, und `const m = s.meta;
 * m.industry` entkaeme ihm (L32, L-27.07-d).
 * ---------------------------------------------------------------------------------------
 *
 * DREI SCHICHTEN, und die Trennung ist der eigentliche Gewinn:
 *
 *   serienHash    - die Zahlenreihen. Feldliste aus FIELD_REGISTRY abgeleitet, plus die
 *                   beobachteten Reihen, die das Register nicht kennt.
 *   kohorteHash   - was Zuteilung und Routing bestimmt. Kurs-getriebene Eingaenge gehen als
 *                   ihre WIRKSAME KLASSE ein, nicht als Rohwert (s. u.).
 *   volatilHash   - kurs- und schaetzungsgetriebene Groessen, die sich taeglich bewegen, ohne
 *                   dass sich fundamental etwas geaendert haette. Getrennt ausgewiesen und
 *                   NICHT Teil von `stabil`.
 *
 * `stabil` = serienHash + kohorteHash. NUR diese Zahl traegt die Aussage "der fundamentale
 * Eingang dieser Zeile hat sich nicht bewegt". `gesamt` schliesst zusaetzlich volatilHash ein.
 *
 * Warum die Klassen-Statt-Rohwert-Regel: Runde 1 hat gemessen, dass 7.226 von 8.313 Zeilen sich
 * an einem einzigen Tag NUR in `marketCap` unterscheiden. Haette der Kohorte-Hash den Rohwert,
 * bewegte er sich fuer 87 % der Zeilen taeglich und die Aussage waere wertlos. Wirksam ist
 * nicht der Marktwert, sondern die Groessenklasse - also geht die Klasse ein.
 * Dasselbe gilt fuer `meta.tradingFxRateApplied`: `fxSuspect()` liest den Kurs nicht als Zahl,
 * sondern nur als Praedikat "fehlt / ist gesetzt" (`m.tradingFxRateApplied == null`). Der
 * Rohwert ist ein taeglich wechselnder Wechselkurs; roh gehasht wuerde er jedes dual-gelistete
 * Nicht-USD-Bein taeglich bewegen. Wirksam ist deshalb nur die Null-/Gesetzt-Klasse.
 *
 * src/scoring/ wird nur GELESEN. Dieses Modul liegt bewusst ausserhalb des GQS-00-Siegels.
 */
const crypto = require('crypto');
const { FIELD_REGISTRY, norm } = require('../src/scoring/snapshot.js');
const { mcapKlasseOf } = require('../src/scoring/score.js');

/**
 * Reihen, die das Scoring beobachtbar liest, die aber NICHT im FIELD_REGISTRY stehen.
 * Diese Liste ist bewusst kurz und wird vom Waechter gegen die Beobachtung geprueft - sie darf
 * nicht wachsen, ohne dass jemand hinsieht.
 */
const SERIEN_EXTRA = ['timeseries.revenueQEnds'];

/**
 * Kohorten- und Routing-bestimmende Felder. Vollstaendigkeit wird NICHT hier behauptet,
 * sondern vom Waechter gegen die Proxy-Beobachtung erzwungen.
 * Wirkorte: meta.sector/industry -> router.js (:154, :190, :216, :265) · meta.country/region/
 * exchangeName -> Regionszuordnung · meta.ipoYear/firstTradeDate -> ipoYearOf (:747) ·
 * meta.*Currency* -> Waehrungspfad · meta.name/ticker -> Identitaet und Emittenten-Dedup.
 */
const KOHORTE_FELDER = [
  'meta.ticker', 'meta.name', 'meta.sector', 'meta.industry',
  'meta.country', 'meta.region', 'meta.exchangeName',
  'meta.ipoYear', 'meta.firstTradeDate',
  'meta.reportingCurrency', 'meta.reportingCurrencyOriginal', 'meta.tradingCurrency',
];

/**
 * Kurs-getriebene Eingaenge, die ueber eine Klassenfunktion wirken. Gehasht wird das
 * ERGEBNIS der Funktion, nie der Rohwert - sonst bewegt ein Kurstick den Hash.
 */
const KOHORTE_ABGELEITET = [
  ['marketCap.value', (v) => mcapKlasseOf(v)],
  ['meta.tradingFxRateApplied', (v) => v == null],
];

/**
 * Kurs- und schaetzungsgetrieben: bewegt sich taeglich ohne fundamentale Aenderung.
 * Getrennt gehasht, damit `stabil` seine Aussage behaelt - aber NICHT weggelassen, sonst
 * waere wieder etwas unsichtbar, das den Score bewegt.
 */
const VOLATIL_FELDER = [
  'metrics.beta', 'metrics.forwardPE', 'metrics.enterpriseValue',
  'metrics.revenueTTM', 'metrics.revenueGrowthYoY', 'metrics.grossMargin',
  'metrics.operatingMargin', 'metrics.fcfMarginTTM', 'metrics.ebitda',
  'external.earningsHistory', 'external.revenueEstimates',
];

const sha = (x) => crypto.createHash('sha256').update(x).digest('hex').slice(0, 16);

/** Alle Serien-Felder des Registers, zur Laufzeit abgeleitet - nie eine Kopie. */
function serienFelder() {
  return Object.keys(FIELD_REGISTRY).sort();
}

/** Jeder Pfad, den dieses Modul abdeckt - Grundlage der Waechter-Pruefung. */
function abgedecktePfade() {
  const serien = serienFelder().map((f) => `${FIELD_REGISTRY[f][0]}.${f}`);
  return {
    serien: [...serien, ...SERIEN_EXTRA].sort(),
    kohorte: [...KOHORTE_FELDER, ...KOHORTE_ABGELEITET.map((x) => x[0])].sort(),
    volatil: [...VOLATIL_FELDER].sort(),
    alle: new Set([...serien, ...SERIEN_EXTRA, ...KOHORTE_FELDER,
      ...KOHORTE_ABGELEITET.map((x) => x[0]), ...VOLATIL_FELDER]),
  };
}

/**
 * Kanonische Form einer Register-Serie. Ueber norm(), damit ein Speicherformat-Wechsel
 * ([{value:N}] <-> [N]) den Hash NICHT bewegt. Multi-Key-Felder haben keine einzelne Reihe;
 * dort wird der Rohcontainer genommen.
 */
function serie(snapshot, feld) {
  const [container, format] = FIELD_REGISTRY[feld];
  if (format === 'multikey') {
    const roh = (snapshot && snapshot[container]) ? snapshot[container][feld] : undefined;
    return Array.isArray(roh) ? roh : null;
  }
  const n = norm(snapshot, feld);
  return n.length ? n : null;
}

/** `container.feld` lesen, ohne bei fehlendem Container zu werfen. */
function pfad(o, p) {
  const [c, f] = p.split('.');
  const cont = o ? o[c] : undefined;
  if (cont === null || cont === undefined) return null;
  const v = cont[f];
  return v === undefined ? null : v;
}

/**
 * inputHash(snapshot) -> { serienHash, kohorteHash, volatilHash, stabil, gesamt, felder }
 * `felder` nennt die tatsaechlich BESETZTEN Serien - damit ein Hash-Wechsel nicht nur sichtbar,
 * sondern auch eingrenzbar ist.
 */
function inputHash(snapshot) {
  const felder = [];
  const serien = [];
  for (const f of serienFelder()) {
    const s = serie(snapshot, f);
    if (s !== null) felder.push(f);
    serien.push([f, s]);
  }
  for (const p of SERIEN_EXTRA) serien.push([p, pfad(snapshot, p)]);
  // secAnnual haengt mergeSecIntoUniverse an; die Schluessel werden zur Laufzeit gelesen statt
  // gelistet, sonst waere es wieder eine handgepflegte Zweitliste.
  const sec = snapshot && snapshot.secAnnual;
  const secTeil = sec ? Object.keys(sec).sort().map((k) => [k, sec[k]]) : null;

  const kohorte = KOHORTE_FELDER.map((p) => [p, pfad(snapshot, p)])
    .concat(KOHORTE_ABGELEITET.map(([p, fn]) => [p + '#klasse', fn(pfad(snapshot, p))]));
  const volatil = VOLATIL_FELDER.map((p) => [p, pfad(snapshot, p)]);

  const serienHash = sha(JSON.stringify([serien, secTeil]));
  const kohorteHash = sha(JSON.stringify(kohorte));
  const volatilHash = sha(JSON.stringify(volatil));
  const stabil = sha(serienHash + kohorteHash);
  return { serienHash, kohorteHash, volatilHash, stabil, gesamt: sha(stabil + volatilHash), felder };
}

/** Ganzes Universum -> { ticker: {serienHash, kohorteHash, volatilHash, stabil, gesamt} }. */
function universumHashes(universum) {
  const out = {};
  for (const s of universum) {
    const t = s && s.meta && s.meta.ticker;
    if (!t) continue;
    const h = inputHash(s);
    out[t] = { serienHash: h.serienHash, kohorteHash: h.kohorteHash,
      volatilHash: h.volatilHash, stabil: h.stabil, gesamt: h.gesamt };
  }
  return out;
}

/**
 * Zerlegt zwei Hash-Staende plus die zugehoerigen Scores in die Ursachen.
 * Reihenfolge der Pruefung ist die Aussagekraft: Serien zuerst, dann Kohorte, dann volatil,
 * und erst was alles ueberlebt, ist Lineal-Drift.
 */
function zerlege(hashA, hashB, scoresA, scoresB) {
  const k = { datenDrift: 0, kohortenWechsel: 0, kursDrift: 0, linealDrift: 0, unveraendert: 0, nurA: 0, nurB: 0 };
  const beispiele = { datenDrift: [], kohortenWechsel: [], kursDrift: [], linealDrift: [] };
  const merke = (klasse, t) => { k[klasse]++; if (beispiele[klasse] && beispiele[klasse].length < 5) beispiele[klasse].push(t); };
  for (const t of Object.keys(hashA)) {
    const a = hashA[t], b = hashB[t];
    if (!b) { k.nurA++; continue; }
    const sa = scoresA ? scoresA[t] : undefined, sb = scoresB ? scoresB[t] : undefined;
    if (a.serienHash !== b.serienHash) { merke('datenDrift', t); continue; }
    if (a.kohorteHash !== b.kohorteHash) { merke('kohortenWechsel', t); continue; }
    if (a.volatilHash !== b.volatilHash && sa !== sb) { merke('kursDrift', t); continue; }
    if (sa !== sb) { merke('linealDrift', t); continue; }
    k.unveraendert++;
  }
  for (const t of Object.keys(hashB)) if (!hashA[t]) k.nurB++;
  return { klassen: k, beispiele };
}

module.exports = {
  inputHash, universumHashes, zerlege, serienFelder, abgedecktePfade,
  KOHORTE_FELDER, KOHORTE_ABGELEITET, VOLATIL_FELDER, SERIEN_EXTRA,
};
