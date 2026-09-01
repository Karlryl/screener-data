'use strict';
/**
 * mcap-prefilter.js — Marktkap-Vorpruefung bei der Entdeckung (Karl-Sizing-Fix 2026-07-03).
 * ==========================================================================================
 * PROBLEM: Die neuen Auslands-Vollregister (JP/KR/TW/CN/HK/DE/Nordics/UK/CA/AU/IN, ~25k) kommen
 * mit marketCap:null. Sie ALLE in den teuren Fundamental-Pull zu schicken (Yahoo ~2s/Ticker =
 * viele Stunden) waere 10x Verschwendung — die allermeisten sind winzige Klitschen < $2B, die
 * der Screener gar nicht will. Statt den aufgeblaehten Pull zu STAFFELN (behandelt das Symptom),
 * hier der Root-Fix: EINE billige Batch-Groessenpruefung (Yahoo quote, ~200 Ticker/Aufruf, Minuten
 * statt Stunden) filtert VOR dem Pull auf >= $2B USD. Nur die Ueberlebenden (~einige tausend)
 * gehen in den teuren Fundamental-Pull -> Universum bleibt handhabbar, KEIN Sharding noetig.
 *
 * Fail-safe: pro Batch try/catch; wirft NIE. Bei Totalausfall -> leere Map -> der Aufrufer laesst
 * die Zeilen als null-mcap durch die bestehende Slot-Logik laufen (kein Regress).
 */
const fs = require('fs');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;

const MIN_USD = parseFloat(process.env.MCAP_PREFILTER_MIN_USD || '2e9'); // $2 Mrd Schwelle (Karl)
const BATCH = 200;

function loadRates() {
  try { return (JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fx-rates.json'), 'utf8')).rates) || { USD: 1 }; }
  catch (_) { return { USD: 1 }; }
}
// Marktkap (Handelswaehrung) -> USD. GBp/GBX (Pence) -> /100. Unbekannte Waehrung -> null (fail-closed,
// wird nicht faelschlich aufgenommen; taucht bei naechster Runde ueber den normalen Pull wieder auf).
// Subunit-Waehrungen (Pence/Cents/Agorot) -> Basiswaehrung, /100. ILA = israelische Agorot (Yahoo
// liefert TASE-marketCap in Agorot, nicht Shekel) — sonst faellt jeder israelische Name fail-closed raus.
const SUBUNIT = { GBp: 'GBP', GBX: 'GBP', ZAc: 'ZAR', ILA: 'ILS' };
const isUsableFxRate = (rate) => Number.isFinite(rate) && rate > 0;
function toUsd(mcap, cur, rates) {
  if (!Number.isFinite(mcap) || mcap <= 0 || !cur) return null;
  let c = cur, m = mcap;
  if (SUBUNIT[c]) { c = SUBUNIT[c]; m = m / 100; }
  const r = rates[c];
  return isUsableFxRate(r) ? m * r : null;
}

// BH-041: reine Funktion (offline testbar) — unterscheidet, WARUM toUsd() null geliefert hat.
// true nur, wenn ein echtes, positives marketCap + eine bekannte Waehrung vorlagen, aber genau
// deren Rate fehlt oder keine positive endliche Zahl ist (FX-Artefakt-Luecke bzw. korrupter
// Eintrag). false bei echtem "kein/kein positives marketCap" (dann ist die Zeile schlicht nicht
// bewertbar, unabhaengig von FX - kein 'unpriceable' im BH-041-Sinn).
function isUnpriceable(mcap, cur, rates) {
  if (!Number.isFinite(mcap) || mcap <= 0 || !cur) return false;
  const c = SUBUNIT[cur] || cur;
  return !isUsableFxRate(rates[c]);
}

// Bug 5 (KOSDAQ-Suffix): Der KR-Adapter (opendart-kr.js) emittiert alle KR-Titel als
// <code>.KS (KOSPI-Default, suffixUnsure:true), weil corpCode.xml kein Marktsegment traegt.
// KOSDAQ-Titel (~1600) haben aber .KQ. Yahoo antwortet unter .KS zwar (mit ABWEICHENDER
// Kurslinie), meldet im Quote aber das echte Listing im exchange-Feld. Diese reine Funktion
// entscheidet aus einer Quote-Antwort, ob ein .KS-Symbol auf .KQ umgeschrieben werden muss.
// Rein (offline testbar); der Netzwerk-Requote sitzt in prefilterByMcap.
const _KOSDAQ_RE = /kosdaq|\bKOE\b/i; // Yahoo: exchange 'KOE'/fullExchangeName 'KOSDAQ'
function kosdaqTarget(symbol, quote) {
  if (typeof symbol !== 'string' || !symbol.endsWith('.KS')) return null;
  if (!quote) return null;
  const venue = String(quote.fullExchangeName || quote.exchange || '');
  if (!_KOSDAQ_RE.test(venue)) return null;
  return symbol.slice(0, -3) + '.KQ';
}

/**
 * prefilterByMcap(symbols) -> { kept: Map<yahooSymbol, marketCapUsd> nur fuer >= MIN_USD,
 *                               answered: Set<yahooSymbol> die Yahoo ueberhaupt beantwortet hat,
 *                               unpriceable: Set<yahooSymbol> beantwortet MIT positivem marketCap,
 *                                 aber ohne positive endliche Rate fuer die Handelswaehrung
 *                                 (Artefakt-Luecke/-Defekt, nicht "unter Schwelle"),
 *                               belowUsd: Map<yahooSymbol, marketCapUsd> sauber bepreist, aber
 *                                 UNTER der Schwelle — die Begruendung des Ausschlusses,
 *                               nichtAktie: Set<yahooSymbol> Yahoo meldet quoteType != EQUITY
 *                                 (Fonds/Vorzug/Warrant) — gar nicht bewertet, also weder
 *                                 "zu klein" noch "Marktwert unbekannt". }
 * symbols: Array yahoo-suffigierter Ticker (die null-mcap-Auslandszeilen).
 * opts.minUsd: Schwelle abweichend von MIN_USD (Messungen: minUsd 0 = alles bepreisen).
 * opts.quote:  Ersatz fuer yf.quote(batch) — nur fuer Tests, damit dieses Tor OHNE Netz
 *              pruefbar ist (es gab bis Tag 642 keine einzige Testdatei fuer diese Datei).
 */
async function prefilterByMcap(symbols, opts = {}) {
  const minUsd = opts.minUsd != null ? opts.minUsd : MIN_USD;
  const rates = opts.rates || loadRates();
  let yf = null; // erst bei Bedarf bauen — ein injizierter quote() darf ohne Yahoo-Client laufen
  const quoteFn = opts.quote ||
    ((batch) => (yf || (yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] }))).quote(batch));
  const kept = new Map();
  // Bug 16: der Caller muss 'geprueft und < $2B' von 'Batch gescheitert / keine Antwort'
  // unterscheiden koennen. Ohne das loescht ein einzelner 429/Netzfehler bis zu 200
  // Auslands-Kandidaten pro Batch, statt sie null-mcap in den Slot-Schutz fallen zu lassen.
  // -> answered = Menge der Symbole, fuer die Yahoo ueberhaupt eine Quote geliefert hat.
  const answered = new Set();
  // BH-041: answered heisst nur "Yahoo hat geantwortet", nicht "toUsd() konnte umrechnen".
  // Fehlt in einer sonst validen fx-rates.json nur EINE Waehrung oder ist ihre Rate unbrauchbar,
  // liefert toUsd() fuer genau diese Zeilen null, obwohl ein echtes, positives marketCap vorlag -
  // das ist "nicht bewertbar", nicht "geprueft und < Schwelle". unpriceable markiert genau diesen
  // Fall, damit der Caller ihn NICHT wie einen Unter-Cap-Befund loescht.
  const unpriceable = new Set();
  // Tag 642 (Ausschluss-Protokoll): bis hierher wusste NIEMAND, WER an dieser Schwelle
  // gestorben ist — kept enthielt nur die Ueberlebenden, der Aufrufer loeschte den Rest
  // ohne Begruendung je Ticker (refresh-universe.js applyForeignPrefilterOutcome), und die
  // einzige Spur war die Aggregat-Logzeile ganz unten. belowUsd traegt jetzt den gemessenen
  // Marktwert JEDER verworfenen Zeile, damit der Ausschluss belegbar statt still ist.
  const belowUsd = new Map();
  // Review-Befund zu Tag 642: es gibt einen DRITTEN Pfad, der bisher unbenannt blieb —
  // Yahoo antwortet mit quoteType != EQUITY (Fonds, Vorzugsaktie, Warrant). Die Zeile wird
  // dann gar nicht bewertet, faellt beim Aufrufer trotzdem aus dem Universum und stand im
  // Protokoll unter "Marktwert unbekannt". Das ist die falsche Begruendung: der Grund ist
  // "keine Aktie", nicht "zu klein oder unbekannt gross". nichtAktie trennt beides.
  const nichtAktie = new Set();
  // Bug 5: .KS-Symbole, fuer die Yahoo KOSDAQ meldet -> auf .KQ requoten. renamed traegt die
  // Zuordnung .KS -> .KQ zum Caller (er ersetzt die Watchlist-Zeile), requoteTargets sammelt
  // die neu zu quotenden .KQ-Symbole.
  const renamed = new Map();
  const requoteTargets = [];
  let checked = 0, errors = 0;
  const gradeQuote = (q) => {
    // gemeinsame Bewertung einer Quote-Antwort (Haupt- und Requote-Pass).
    if (q.quoteType && q.quoteType !== 'EQUITY') { nichtAktie.add(q.symbol); return; } // fail-open bei fehlendem quoteType
    checked++;
    const usd = toUsd(q.marketCap, q.currency, rates);
    if (usd != null) {
      if (usd >= minUsd) kept.set(q.symbol, usd);
      else belowUsd.set(q.symbol, usd);
      return;
    }
    if (isUnpriceable(q.marketCap, q.currency, rates)) unpriceable.add(q.symbol);
  };
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    let quotes;
    try { quotes = await quoteFn(batch); }
    catch (_) { errors++; continue; } // fail-silent: dieser Batch bleibt null-mcap (unanswered)
    for (const q of (Array.isArray(quotes) ? quotes : [quotes])) {
      if (!q || !q.symbol) continue;
      answered.add(q.symbol);
      const kq = kosdaqTarget(q.symbol, q);
      if (kq) {
        // Yahoo meldet KOSDAQ unter dem .KS-Symbol -> mcap/Kurs dieser Antwort gehoeren zum
        // falschen Listing. Nicht bewerten; unter .KQ neu quoten und den Ticker umschreiben.
        renamed.set(q.symbol, kq);
        requoteTargets.push(kq);
        continue;
      }
      gradeQuote(q);
    }
  }
  // Zweiter Pass: die auf .KQ umgeschriebenen KOSDAQ-Titel neu quoten.
  for (let i = 0; i < requoteTargets.length; i += BATCH) {
    const batch = requoteTargets.slice(i, i + BATCH);
    let quotes;
    try { quotes = await quoteFn(batch); }
    catch (_) { errors++; continue; }
    for (const q of (Array.isArray(quotes) ? quotes : [quotes])) {
      if (!q || !q.symbol) continue;
      answered.add(q.symbol);
      gradeQuote(q);
    }
  }
  console.log(`[mcap-prefilter] ${symbols.length} geprueft (${checked} beantwortet, ${errors} Batch-Fehler, ${renamed.size} KOSDAQ .KS->.KQ, ${unpriceable.size} unbewertbar/FX-Luecke) -> ${kept.size} >= $${(minUsd / 1e9).toFixed(1)}B`);
  return { kept, answered, renamed, unpriceable, belowUsd, nichtAktie };
}

module.exports = { prefilterByMcap, toUsd, kosdaqTarget, isUnpriceable };
