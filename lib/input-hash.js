'use strict';
/**
 * inputHash - Fingerabdruck der ZUSAMMENGEBAUTEN Scoring-Eingabe einer Zeile.
 *
 * Warum es das gibt (Rat 23.08., Weichen B1/B2): heute wirft der Tagesvergleich "der Provider
 * hat revidiert" und "die Kohorte hat sich verschoben" in einen Topf. Zwischen Datei und
 * scoreUniverse liegen loadUniverse() und mergeSecIntoUniverse; was am Ende wirklich in die
 * Achsen geht, steht nirgends als eine Zahl. Mit diesem Hash wird die Zerlegung zur Arithmetik:
 *
 *   serienHash geaendert                        -> Daten-/Zusammenbau-Drift
 *   serienHash gleich, kohorteHash geaendert    -> die Zeile hat die Kohorte gewechselt
 *   beide gleich, Score geaendert               -> Lineal-Drift (ANDERE Zeilen haben sich bewegt)
 *
 * Die Feldliste der Serien wird zur Laufzeit aus dem FIELD_REGISTRY abgeleitet und NICHT von
 * Hand gepflegt - wer dort ein Feld ergaenzt, bekommt es hier ohne Zutun mit. Genau das ist der
 * Punkt: eine handgepflegte Zweitliste waere die zweite Wahrheitsquelle, die der ersten
 * widersprechen kann.
 *
 * src/scoring/ wird nur GELESEN (FIELD_REGISTRY, norm) - dieses Modul liegt bewusst ausserhalb
 * des GQS-00-Siegels.
 */
const crypto = require('crypto');
const { FIELD_REGISTRY, norm } = require('../src/scoring/snapshot.js');

/**
 * Die kohorten-bestimmenden Felder. Bewusst KURZ und explizit, anders als die Serien: das hier
 * ist kein wachsendes Register, sondern die vier Groessen, an denen die Kohorten-Zuteilung in
 * src/scoring/score.js haengt. Wirkort je Feld:
 *   marketCap.value      -> mcapKlasseOf (:186) und mcapBandOf (:737)
 *   meta.sector          -> Board-/Formel-Routing
 *   meta.ipoYear         -> ipoYearOf (:747) -> ipoRecencyOf (:785)
 *   meta.firstTradeDate  -> Rueckfall von ipoYearOf, wenn ipoYear fehlt
 * Phase und Track kommen aus opIncQ und stecken damit bereits im serienHash.
 */
const KOHORTE_FELDER = [
  ['marketCap', 'value'],
  ['meta', 'sector'],
  ['meta', 'ipoYear'],
  ['meta', 'firstTradeDate'],
];

const sha = (x) => crypto.createHash('sha256').update(x).digest('hex').slice(0, 16);

/** Alle Serien-Felder, zur Laufzeit aus dem Register abgeleitet - nie eine Kopie. */
function serienFelder() {
  return Object.keys(FIELD_REGISTRY).sort();
}

/**
 * Kanonische Form einer Serie. Ueber norm(), damit Speicherformat-Wechsel ([{value:N}] <-> [N])
 * den Hash NICHT bewegen - gehasht wird die Zahlenreihe, die die Achse sieht, nicht ihre
 * Verpackung. Multi-Key-Felder (annualBalance) haben keine einzelne Reihe; dort wird der
 * Rohcontainer genommen, sonst braeuchte es eine handgepflegte Key-Liste.
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

/** Verschachtelten Wert lesen, ohne bei fehlendem Zwischenknoten zu werfen. */
function tief(o, pfad) {
  let cur = o;
  for (const k of pfad) { if (cur === null || cur === undefined) return null; cur = cur[k]; }
  return cur === undefined ? null : cur;
}

/**
 * inputHash(snapshot) -> { serienHash, kohorteHash, gesamt, felder }
 * `felder` nennt die tatsaechlich BESETZTEN Serien - damit ein Hash-Wechsel nicht nur sichtbar,
 * sondern auch eingrenzbar ist ("welche Reihe ist weggefallen").
 */
function inputHash(snapshot) {
  const felder = [];
  const serien = [];
  for (const f of serienFelder()) {
    const s = serie(snapshot, f);
    if (s !== null) felder.push(f);
    serien.push([f, s]);
  }
  // secAnnual haengt mergeSecIntoUniverse an; seine Keys werden zur Laufzeit gelesen statt
  // gelistet, sonst waere es wieder eine handgepflegte Zweitliste.
  const sec = snapshot && snapshot.secAnnual;
  const secTeil = sec ? Object.keys(sec).sort().map((k) => [k, sec[k]]) : null;

  const kohorte = KOHORTE_FELDER.map((p) => [p.join('.'), tief(snapshot, p)]);

  const serienHash = sha(JSON.stringify([serien, secTeil]));
  const kohorteHash = sha(JSON.stringify(kohorte));
  return { serienHash, kohorteHash, gesamt: sha(serienHash + kohorteHash), felder };
}

/** Ganzes Universum -> { ticker: {serienHash, kohorteHash, gesamt} }. */
function universumHashes(universum) {
  const out = {};
  for (const s of universum) {
    const t = s && s.meta && s.meta.ticker;
    if (!t) continue;
    const h = inputHash(s);
    out[t] = { serienHash: h.serienHash, kohorteHash: h.kohorteHash, gesamt: h.gesamt };
  }
  return out;
}

/**
 * Zerlegt zwei Hash-Staende plus die zugehoerigen Scores in die drei Ursachen.
 * scoresA/scoresB: { ticker: number|null }.
 */
function zerlege(hashA, hashB, scoresA, scoresB) {
  const k = { datenDrift: 0, kohortenWechsel: 0, linealDrift: 0, unveraendert: 0, nurA: 0, nurB: 0 };
  const beispiele = { datenDrift: [], kohortenWechsel: [], linealDrift: [] };
  for (const t of Object.keys(hashA)) {
    const a = hashA[t], b = hashB[t];
    if (!b) { k.nurA++; continue; }
    const sa = scoresA ? scoresA[t] : undefined, sb = scoresB ? scoresB[t] : undefined;
    if (a.serienHash !== b.serienHash) { k.datenDrift++; if (beispiele.datenDrift.length < 5) beispiele.datenDrift.push(t); continue; }
    if (a.kohorteHash !== b.kohorteHash) { k.kohortenWechsel++; if (beispiele.kohortenWechsel.length < 5) beispiele.kohortenWechsel.push(t); continue; }
    if (sa !== sb) { k.linealDrift++; if (beispiele.linealDrift.length < 5) beispiele.linealDrift.push(t); continue; }
    k.unveraendert++;
  }
  for (const t of Object.keys(hashB)) if (!hashA[t]) k.nurB++;
  return { klassen: k, beispiele };
}

module.exports = { inputHash, universumHashes, zerlege, serienFelder, KOHORTE_FELDER };
