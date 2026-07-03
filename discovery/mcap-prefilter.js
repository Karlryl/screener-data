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
function toUsd(mcap, cur, rates) {
  if (!Number.isFinite(mcap) || mcap <= 0 || !cur) return null;
  let c = cur, m = mcap;
  if (c === 'GBp' || c === 'GBX' || c === 'ZAc') { c = c === 'ZAc' ? 'ZAR' : 'GBP'; m = m / 100; }
  const r = rates[c];
  return Number.isFinite(r) ? m * r : null;
}

/**
 * prefilterByMcap(symbols) -> Map<yahooSymbol, marketCapUsd> nur fuer >= MIN_USD.
 * symbols: Array yahoo-suffigierter Ticker (die null-mcap-Auslandszeilen).
 */
async function prefilterByMcap(symbols, opts = {}) {
  const minUsd = opts.minUsd != null ? opts.minUsd : MIN_USD;
  const rates = loadRates();
  const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  const kept = new Map();
  let checked = 0, errors = 0;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    let quotes;
    try { quotes = await yf.quote(batch); }
    catch (_) { errors++; continue; } // fail-silent: dieser Batch bleibt null-mcap
    for (const q of (Array.isArray(quotes) ? quotes : [quotes])) {
      if (!q || !q.symbol) continue;
      // FIX-1 (Bau-Plan Welle 0): nur operative Aktien. yf.quote liefert quoteType gratis;
      // ETF/CEF/MUTUALFUND/Bond mit echter marketCap >= $2B wuerden sonst als "Firma" durchrutschen
      // und die CRDO/ALAB-Spitze mit $50B-Fonds verstopfen (Direktive-4-Bruch). Fail-open: fehlendes
      // quoteType filtert nicht (kein Regress), gesetztes != EQUITY fliegt raus.
      if (q.quoteType && q.quoteType !== 'EQUITY') continue;
      checked++;
      const usd = toUsd(q.marketCap, q.currency, rates);
      if (usd != null && usd >= minUsd) kept.set(q.symbol, usd);
    }
  }
  console.log(`[mcap-prefilter] ${symbols.length} geprueft (${checked} beantwortet, ${errors} Batch-Fehler) -> ${kept.size} >= $${(minUsd / 1e9).toFixed(1)}B`);
  return kept;
}

module.exports = { prefilterByMcap, toUsd };
