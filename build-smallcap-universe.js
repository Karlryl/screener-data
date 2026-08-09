#!/usr/bin/env node
'use strict';
/**
 * 5.2 WEG 1b Discovery-Builder (Council + Codex-Duell §4d, 22.07.)
 * ===============================================================
 * Beschafft das US-Small-Cap-Universum ($300-800M) fuer das 5.2-Board aus der
 * VOLLSTAENDIGEN US-Listing-Basis (NASDAQ-Trader nasdaqlisted+otherlisted, ~7k
 * common stocks) — NICHT aus den vier thematischen Yahoo-Screener-Seiten der
 * Messprobe (Codex-Einwand 1: die sind verzerrt/gedeckelt). Batch-MCap-Vorfilter
 * (discovery/mcap-prefilter.js, wiederverwendet) grenzt auf das $300-800M-Band ein.
 *
 * BEWUSST KEINE R1-R6-Operating-Filterung hier: die macht smallcapRoute() zur
 * Score-Zeit (route()+isUS()+Band), plus die Achsen-Coverage. Der Builder liefert
 * nur die Membership-Kandidaten -> watchlist-smallcap.json (committbarer Kontrakt,
 * analog watchlist.json). Der gescopte $300M-Pull auf diese Datei (naechster
 * WEG-1b-Chunk) fuellt snapshots-smallcap/, das loadSmallcapUniverse() liest.
 *
 * Run:  node build-smallcap-universe.js [--limit N] [--out <pfad>]
 *       --limit N  = nur die ersten N Listing-Symbole pruefen (Beleg/Schnelltest)
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./lib/atomic-write.js');
const { fetchNasdaqAll, isJunkSecurity } = require('./discovery/nasdaq-all.js');
const { prefilterByMcap } = require('./discovery/mcap-prefilter.js');
const { readJsonExistingOrThrow, FEHLT } = require('./lib/read-json.js');

const MIN_USD = 300e6;
const MAX_USD = 800e6;
const DEFAULT_OUT = path.join(__dirname, 'watchlist-smallcap.json');

// R1-SK-005 (P0-Haertung 4, 09.08.2026): der Builder schrieb watchlist-smallcap.json
// BEDINGUNGSLOS. prefilterByMcap (Batch-Quotes) kann teilweise ausfallen — ein
// rate-limitierter Lauf liefert dann eine Handvoll Namen, ersetzt damit den committeten
// Kontrakt und meldet die kleine Zahl als Erfolg.
// Ist-Bestand am 09.08.2026: 540 Namen (Erstbau 22.07. fand 775, Karls Reconcile vom
// 08.08. bereinigte auf 540). Doppelschranke wie beim CI-Coverage-Gate (percent-only
// Gates verschaerfen sich mit wachsendem Universum, absolute allein werden mit ihm lasch):
//   - Anteil  50 % des Vorbestands -> traegt, solange ein grosser Vorbestand da ist (540 -> 270)
//   - Absolut 200 -> traegt bei Erstanlage und wenn der Vorbestand selbst klein ist
// Beide bewusst weit unter dem Ist: ein legitimer Bandwechsel/Reconcile (596 -> 540, -9 %)
// laeuft durch, ein Teilausfall (einstellig bis wenige Dutzend) nicht.
const MIN_SMALLCAP_ABSOLUT = 200;
const MIN_SMALLCAP_ANTEIL = 0.5;

// Wirft, wenn das neue Universum den Kontrakt nicht ersetzen darf. Ein unlesbarer
// Vorbestand ist KEINE Erstanlage (lib/read-json.js) -> Wurf statt stiller Neuanlage.
function pruefeMindestbestand(anzahlNeu, outPfad) {
  const alt = readJsonExistingOrThrow(outPfad);
  const vorher = alt === FEHLT ? 0 : (Array.isArray(alt.stocks) ? alt.stocks.length : 0);
  const noetig = Math.max(MIN_SMALLCAP_ABSOLUT, Math.round(MIN_SMALLCAP_ANTEIL * vorher));
  if (anzahlNeu < noetig) {
    throw new Error(`Mindestzahl verfehlt: ${anzahlNeu} Namen < ${noetig} noetig `
      + `(Vorbestand ${vorher}, Schranken: absolut ${MIN_SMALLCAP_ABSOLUT} / Anteil ${MIN_SMALLCAP_ANTEIL}). `
      + `${outPfad} bleibt unveraendert — vermutlich ein Teilausfall der MCap-Vorpruefung.`);
  }
  return { vorher, noetig };
}

function parseArgs(argv) {
  const args = { limit: null, out: DEFAULT_OUT };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--limit' && argv[i + 1]) args.limit = parseInt(argv[++i], 10);
    else if (argv[i] === '--out' && argv[i + 1]) args.out = argv[++i];
  }
  if (args.limit != null && (!Number.isInteger(args.limit) || args.limit < 1)) {
    throw new Error('--limit muss eine positive Ganzzahl sein');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  // Ein --limit-Probelauf prueft absichtlich nur die ersten N Listing-Symbole und liefert
  // deshalb legitim wenige Namen. Er darf dafuer aber nicht den committeten Kontrakt
  // treffen — sonst waere die Mindestzahl-Schranke unten sein einziger Schutz und muesste
  // gegen genau den Fall aufgeweicht werden, gegen den sie gebaut ist.
  if (args.limit != null && args.out === DEFAULT_OUT) {
    throw new Error('--limit ist ein Probelauf und schreibt nie in den Kontrakt: bitte --out <pfad> angeben');
  }
  console.log(`[smallcap-builder] Band $${MIN_USD / 1e6}M-$${MAX_USD / 1e6}M, out=${args.out}${args.limit ? `, limit=${args.limit}` : ''}`);

  const listing = await fetchNasdaqAll(); // Map<symbol, {name, ...}>
  let symbols = [...listing.keys()].filter((s) => {
    const info = listing.get(s) || {};
    return !isJunkSecurity(s, info.name || '');
  });
  console.log(`[smallcap-builder] ${symbols.length} US-Listing-Symbole nach Junk-Filter`);
  if (args.limit) symbols = symbols.slice(0, args.limit);

  // Batch-MCap-Vorfilter: >= $300M (minUsd). Das Obere Band ($800M) filtern wir aus
  // der zurueckgegebenen USD-Map (prefilterByMcap kennt nur eine Untergrenze).
  const { kept } = await prefilterByMcap(symbols, { minUsd: MIN_USD });
  const band = [...kept.entries()]
    .filter(([, usd]) => usd <= MAX_USD)
    .sort((a, b) => b[1] - a[1]);
  console.log(`[smallcap-builder] ${kept.size} >= $300M, davon ${band.length} im Band <= $800M`);

  const at = new Date().toISOString();
  const stocks = band.map(([sym, usd]) => ({
    ticker: sym,
    yahoo_symbol: sym,
    name: (listing.get(sym) || {}).name || '',
    marketCapUsd: Math.round(usd),
    added_via: 'smallcap-builder',
    added_at: at,
  }));

  const payload = {
    _meta: {
      builder: 'build-smallcap-universe.js (5.2 WEG 1b)',
      band: { minUsd: MIN_USD, maxUsd: MAX_USD },
      source: 'NASDAQ-Trader nasdaqlisted+otherlisted (full US listing) + Batch-MCap-Vorfilter',
      note: 'Operating-Filterung (R1-R6-artig) erfolgt zur Score-Zeit via smallcapRoute, nicht hier.',
      builtAt: at,
      count: stocks.length,
      partial: args.limit != null,
    },
    stocks,
  };
  const { vorher, noetig } = pruefeMindestbestand(stocks.length, args.out);
  writeFileAtomic(args.out, JSON.stringify(payload, null, 2));
  console.log(`[smallcap-builder] geschrieben: ${stocks.length} Small-Cap-Kandidaten -> ${args.out} `
    + `(Vorbestand ${vorher}, Mindestzahl ${noetig})`);
  if (stocks.length) {
    console.log('[smallcap-builder] Top-5 nach MCap: ' +
      stocks.slice(0, 5).map((s) => `${s.ticker}($${(s.marketCapUsd / 1e6).toFixed(0)}M)`).join(', '));
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('[smallcap-builder] FEHLER: ' + (e && e.message)); process.exit(1); });
}

module.exports = { main, parseArgs, pruefeMindestbestand, DEFAULT_OUT, MIN_SMALLCAP_ABSOLUT, MIN_SMALLCAP_ANTEIL };
