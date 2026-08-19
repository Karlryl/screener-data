#!/usr/bin/env node
'use strict';
/**
 * messung-entdeckungsband.js — misst, wie viele AUSLANDS-Firmen der Screener zusaetzlich
 * sieht, wenn die Entdeckungs-Untergrenze von $2 Mrd auf $800 Mio faellt (Karl, 19.08.2026).
 *
 * MISST NUR, AENDERT NICHTS. Keine Schwelle wird gesenkt; die Ueberschreibung laeuft
 * ausschliesslich ueber die vorhandenen Umgebungsvariablen in EIGENEN Kindprozessen.
 *
 * WARUM VIER STUFEN STATT EINEM LAUF: die teuren Teile (fremde Register, ~35k Yahoo-Quotes)
 * duerfen nicht wiederholt werden muessen, wenn hinten etwas klemmt. Jede Stufe schreibt ihr
 * Zwischenergebnis nach reports/ und liest das der Vorstufe.
 *
 *   node scripts/messung-entdeckungsband.js tv        # Tor 1: TV-Scanner bei 1,5 Mrd und bei 800 Mio
 *   node scripts/messung-entdeckungsband.js register  # die uebrigen Auslands-Vollregister
 *   node scripts/messung-entdeckungsband.js preise    # EINE Yahoo-Bepreisung aller Kandidaten
 *   node scripts/messung-entdeckungsband.js rechnen   # (a)/(b)/(c) je Land + Score-Erwartung
 *
 * DIE ZWEI TORE (beide in der Entdeckungs-Schicht, VOR dem Scoring):
 *   Tor 1  discovery/tv-scanner.js      TV_PRECUT_USD          Vorgabe 1,5 Mrd, nur ~31 TV-Laender
 *   Tor 2  discovery/mcap-prefilter.js  MCAP_PREFILTER_MIN_USD Vorgabe 2 Mrd,   alle Auslandsquellen
 * Fuer die TV-Laender sind sie IN REIHE geschaltet: was Tor 1 haelt, sieht Tor 2 nie.
 *
 * DIE DREI SZENARIEN:
 *   (a) nur Tor 2 auf 800 Mio      (b) nur Tor 1 auf 800 Mio      (c) beide auf 800 Mio
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'reports');
const P = (n) => path.join(OUT, 'messung-entdeckungsband-' + n + '.json');

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
const { writeJsonAtomic, writeFileAtomic } = require(path.join(__dirname, '..', 'lib', 'atomic-write.js'));
function schreib(name, obj) {
  fs.mkdirSync(OUT, { recursive: true });
  // Atomar (tmp + rename) wie jeder andere Zustandsschreiber im Repo: ein Abbruch mitten im
  // Schreiben einer 600-KB-Zwischenstufe darf keine halbe Datei hinterlassen, die die
  // naechste Stufe klaglos einliest.
  writeJsonAtomic(P(name), obj, { indent: 1 });
  console.log('-> ' + P(name));
}
function lies(name) { return JSON.parse(fs.readFileSync(P(name), 'utf8')); }

// ── Stufe 1: Tor 1 (TradingView) bei beiden Schwellen ────────────────────────────
// TV_PRECUT_USD wird beim Laden von tv-scanner.js gelesen -> ein Kindprozess je Schwelle.
// Bewusst der PRODUKTIONSPFAD (scanMarket inkl. Server-Filter, Zeilendeckel TV_SCAN_RANGE,
// Dedup, Domizil-/Typfilter) — eine nachgebaute Zaehlung wuerde etwas anderes messen.
function tvLauf(schwelle) {
  const skript = `
    const { scanMarket, MARKETS } = require(process.argv[1]);
    const fs = require('fs'), path = require('path');
    const rates = JSON.parse(fs.readFileSync(path.join(process.argv[2], 'fx-rates.json'), 'utf8')).rates;
    (async () => {
      const out = {};
      for (const k of Object.keys(MARKETS)) {
        const m = await scanMarket(k, MARKETS[k], rates);
        out[k] = { land: MARKETS[k].country, tickers: [...m.keys()],
                   partial: m.partial === true, totalCount: m.totalCount || null,
                   schwelleLokal: m.tor ? m.tor.schwelleLokal : null,
                   geliefert: m.tor ? m.tor.geliefert : null };
        await new Promise((r) => setTimeout(r, 1200));   // schonende Abrufrate: 1 Markt / 1,2 s
      }
      process.stdout.write('###' + JSON.stringify(out));
    })();`;
  const r = spawnSync(process.execPath, ['-e', skript,
    path.join(ROOT, 'discovery', 'tv-scanner.js'), ROOT], {
    env: Object.assign({}, process.env, { TV_PRECUT_USD: schwelle, TV_SCAN_CONCURRENCY: '1' }),
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    timeout: 25 * 60 * 1000,   // harter Deckel: 31 Maerkte x 30s Socket-Timeout waeren sonst offen
  });
  if (r.status !== 0) throw new Error('TV-Lauf bei ' + schwelle + ' fehlgeschlagen: ' + (r.stderr || '').slice(0, 800));
  const s = String(r.stdout);
  const i = s.indexOf('###');
  if (i < 0) throw new Error('TV-Lauf bei ' + schwelle + ' lieferte keine Nutzlast');
  return JSON.parse(s.slice(i + 3));
}

// Review-Befund: die Messung darf die HEUTIGEN Schwellen nicht als Konstante annehmen —
// laeuft die Produktion je mit abweichenden Env-Werten, misst sie sonst etwas anderes als
// real passiert. Beide Werte kommen deshalb aus derselben Quelle wie im Produktionslauf.
const TOR1_HEUTE = process.env.TV_PRECUT_USD || '1.5e9';
const TOR2_HEUTE_USD = parseFloat(process.env.MCAP_PREFILTER_MIN_USD || '2e9');
const BODEN_USD = 800e6;   // Karls Untergrenze — diese Aufgabe geht bewusst NICHT darunter

async function stufeTv() {
  console.log('Tor 1 / TradingView — Lauf 1 von 2: heutige Schwelle ' + TOR1_HEUTE + ' USD ...');
  const heute = tvLauf(TOR1_HEUTE);
  console.log('Tor 1 / TradingView — Lauf 2 von 2: Schwelle 800 Mio USD ...');
  const tief = tvLauf(String(BODEN_USD));
  const je = {};
  for (const k of Object.keys(tief)) {
    const h = heute[k] || { tickers: [] };
    const a = new Set(h.tickers);
    je[k] = {
      land: tief[k].land,
      // heute = passiert Tor 1 schon; neu = kommt erst bei 800 Mio ueber die Leitung.
      heute: h.tickers,
      neu: tief[k].tickers.filter((t) => !a.has(t)),
      partialHeute: h.partial === true,
      partialTief: tief[k].partial === true,
      totalCountTief: tief[k].totalCount,
      schwelleLokalHeute: h.schwelleLokal || null,
      schwelleLokalTief: tief[k].schwelleLokal || null,
      // Review-Befund: scanMarket() liefert bei Timeout/Blockade eine LEERE Map ohne .tor —
      // ununterscheidbar von "der Markt hat wirklich niemanden". geliefert===null ist genau
      // dieses Signal und muss bis in den Bericht durchgereicht werden, sonst wandert ein
      // ausgefallener Markt als echte Null in Karls Entscheidungsvorlage.
      ausfallHeute: h.geliefert == null,
      ausfallTief: tief[k].geliefert == null,
      geliefertHeute: h.geliefert == null ? null : h.geliefert,
      geliefertTief: tief[k].geliefert == null ? null : tief[k].geliefert,
      tiefAnzahl: tief[k].tickers.length,
    };
  }
  schreib('tv', { erzeugtAm: new Date().toISOString(), je });
  for (const [k, v] of Object.entries(je)) {
    console.log('  ' + k.padEnd(15) + 'heute ' + String(v.heute.length).padStart(5) +
      '   +neu ' + String(v.neu.length).padStart(5) + (v.partialTief ? '  ABGESCHNITTEN' : '') +
      (v.ausfallHeute || v.ausfallTief ? '  MARKT AUSGEFALLEN' : ''));
  }
}

// ── Stufe 2: die uebrigen Auslands-Vollregister ─────────────────────────────────
// Diese Adapter kennen KEINE Groessenschwelle — sie liefern das ganze Register mit
// marketCap:null. Fuer sie entscheidet allein Tor 2.
const REGISTER = [
  ['edinet', './discovery/edinet-jp.js', 'fetchEdinetJapan', 'JP'],
  ['finmind', './discovery/finmind-tw.js', 'fetchTaiwanUniverse', 'TW'],
  ['opendart', './discovery/opendart-kr.js', 'fetchOpenDartKr', 'KR'],
  ['sse', './discovery/sse-cn.js', 'fetchSseUniverse', 'CN'],
  ['szse', './discovery/szse-cn.js', 'fetchSzseUniverse', 'CN'],
  ['hkex', './discovery/hkex-hk.js', 'fetchHkexUniverse', 'HK'],
  ['xetra', './discovery/xetra.js', 'fetchXetraUniverse', 'DE'],
  ['nordic', './discovery/nordic.js', 'fetchNordicUniverse', 'NORDIC'],
  ['oslo', './discovery/oslo.js', 'fetchOsloUniverse', 'NO'],
  ['nse', './discovery/nse-in.js', 'fetchNseIndia', 'IN'],
  ['lse', './discovery/lse-uk.js', 'fetchLseUniverse', 'GB'],
  ['tsx', './discovery/tsx-ca.js', 'fetchTsxCanada', 'CA'],
  ['asx', './discovery/asx-au.js', 'fetchAsxUniverse', 'AU'],
];

async function stufeRegister() {
  const je = {};
  for (const [name, modul, fn, land] of REGISTER) {
    try {
      const m = await require(path.join(ROOT, modul))[fn]();
      je[name] = { land, tickers: [...m.keys()], partial: m.partial === true };
      console.log('  ' + name.padEnd(9) + String(m.size).padStart(6) + ' Ticker' + (m.partial ? ' (TEILBESTAND)' : ''));
    } catch (e) {
      je[name] = { land, tickers: [], fehler: String((e && e.message) || e).slice(0, 200) };
      console.log('  ' + name.padEnd(9) + '  AUSFALL: ' + je[name].fehler);
    }
    await schlaf(1500);
  }
  schreib('register', { erzeugtAm: new Date().toISOString(), je });
}

// ── Stufe 3: EINE Bepreisung aller Kandidaten (minUsd 0 -> alles, nicht nur Ueberlebende) ──
async function stufePreise() {
  const { prefilterByMcap } = require(path.join(ROOT, 'discovery', 'mcap-prefilter.js'));
  const tv = lies('tv').je, reg = lies('register').je;
  const alle = new Set();
  for (const v of Object.values(tv)) { for (const t of v.heute) alle.add(t); for (const t of v.neu) alle.add(t); }
  for (const v of Object.values(reg)) for (const t of v.tickers) alle.add(t);
  // Nachlauf statt Neuabruf: was in einem frueheren Lauf schon bepreist wurde, bleibt stehen.
  // Sonst kostet jede Wiederholung der TV-Stufe erneut ~30k Yahoo-Quotes.
  let preise = {}, unbeantwortet = [];
  if (process.argv.includes('--nachlauf')) {
    try { const alt = lies('preise'); preise = alt.preise || {}; unbeantwortet = alt.unbeantwortet || []; }
    catch (_) { console.log('  (kein frueherer Preis-Stand gefunden — voller Abruf)'); }
  }
  const liste = [...alle].filter((t) => !(t in preise));
  console.log(liste.length + ' Kandidaten zu bepreisen (' + Math.ceil(liste.length / 200) +
    ' Yahoo-Stapel a 200; ' + Object.keys(preise).length + ' bereits bekannt).');
  const SCHEIBE = 1000;   // 5 Stapel je Runde, dann Pause — schonende Abrufrate
  for (let i = 0; i < liste.length; i += SCHEIBE) {
    const teil = liste.slice(i, i + SCHEIBE);
    const r = await prefilterByMcap(teil, { minUsd: 0 });
    for (const [t, usd] of r.kept) preise[t] = Math.round(usd);
    for (const t of teil) if (!r.answered.has(t)) unbeantwortet.push(t);
    console.log('  ' + Math.min(i + SCHEIBE, liste.length) + '/' + liste.length +
      ' bepreist (bisher ' + Object.keys(preise).length + ' mit Marktwert)');
    await schlaf(2000);
  }
  schreib('preise', { erzeugtAm: new Date().toISOString(),
    unbeantwortetAnzahl: unbeantwortet.length, unbeantwortet: unbeantwortet.slice(0, 500), preise });
}

// ── Ticker->Score-Quote je Quelle, aus dem juengsten board-history-Jahrgang gemessen ──
function scoreQuoten(preise) {
  const bh = path.join(ROOT, 'board-history');
  const tage = fs.readdirSync(bh).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const tag = tage[tage.length - 1];
  const bewertet = new Set();
  for (const f of fs.readdirSync(path.join(bh, tag))) {
    if (!f.endsWith('.json')) continue;
    let j; try { j = JSON.parse(fs.readFileSync(path.join(bh, tag, f), 'utf8')); } catch (_) { continue; }
    if (!j || !j.cohort) continue;
    for (const spur of Object.keys(j.cohort)) for (const r of j.cohort[spur]) bewertet.add(String(r.ticker).toUpperCase());
  }
  const wl = JSON.parse(fs.readFileSync(path.join(ROOT, 'watchlist.json'), 'utf8'));
  const agg = {};
  // Zweite, SCHAERFERE Messung: dieselbe Quote, aber nur ueber Bestandszeilen, deren
  // gemessener Marktwert im Band 800 Mio - 2 Mrd liegt. Das ist die passendere Referenz fuer
  // Neuzugaenge aus genau diesem Band — die Quelle-ueber-alle-Groessen-Quote ist durch
  // Zweitlistungen der GROSSEN Namen (Wien/Mailand/Zuerich) nach unten verzerrt.
  const bandAgg = {};
  let bandN = 0, bandK = 0;
  for (const s of wl.stocks) {
    const t = String(s.ticker).toUpperCase();
    const q = s.added_via || '(ohne)';
    const e = agg[q] || (agg[q] = { ticker: 0, mitScore: 0 });
    e.ticker++;
    const hatScore = bewertet.has(t);
    if (hatScore) e.mitScore++;
    const v = preise && preise[t];
    if (Number.isFinite(v) && v >= 800e6 && v < 2e9) {
      const b = bandAgg[q] || (bandAgg[q] = { ticker: 0, mitScore: 0 });
      b.ticker++; bandN++;
      if (hatScore) { b.mitScore++; bandK++; }
    }
  }
  for (const e of Object.values(agg)) e.quote = e.ticker ? e.mitScore / e.ticker : null;
  for (const e of Object.values(bandAgg)) e.quote = e.ticker ? e.mitScore / e.ticker : null;
  return { jahrgang: tag, bewerteteTicker: bewertet.size, watchlistTicker: wl.stocks.length,
    jeQuelle: agg, jeQuelleImBand: bandAgg,
    bandGesamt: { ticker: bandN, mitScore: bandK, quote: bandN ? bandK / bandN : null } };
}

// ── Stufe 4: die drei Szenarien ──────────────────────────────────────────────────
function rechnen() {
  const { TV_FOREIGN_CANON } = require(path.join(ROOT, 'discovery', 'tv-scanner.js'));
  const tv = lies('tv').je, reg = lies('register').je, pr = lies('preise');
  const preise = pr.preise;
  const BODEN = BODEN_USD, TOR2_HEUTE = TOR2_HEUTE_USD;
  // Wer heute schon in watchlist.json steht, ist KEIN Zugewinn — Bestandszeilen laufen gar
  // nicht mehr durch Tor 2 (der Prefilter fasst nur Kandidaten mit marketCap:null an, und
  // die Vereinigung mit dem Bestand passiert danach). Ohne diesen Abzug wuerde die Messung
  // vorhandene Namen als Neuzugang verkaufen.
  const bestand = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'watchlist.json'), 'utf8'))
    .stocks.map((s) => String(s.ticker).toUpperCase()));

  // Ein Kandidat traegt: Quelle (kanonisches Watchlist-Token), Land, ob Tor 1 ihn HEUTE haelt,
  // und seinen bei Yahoo gemessenen Marktwert in USD.
  const zeilen = [];
  const gesehen = new Set();
  for (const [k, v] of Object.entries(tv)) {
    const kanon = TV_FOREIGN_CANON[k] || k;
    for (const t of v.heute) if (!gesehen.has(t)) { gesehen.add(t); zeilen.push({ ticker: t, quelle: kanon, land: v.land, tor1HaeltIhn: false, usd: preise[t] }); }
    for (const t of v.neu) if (!gesehen.has(t)) { gesehen.add(t); zeilen.push({ ticker: t, quelle: kanon, land: v.land, tor1HaeltIhn: true, usd: preise[t] }); }
  }
  for (const [k, v] of Object.entries(reg)) {
    for (const t of v.tickers) if (!gesehen.has(t)) { gesehen.add(t); zeilen.push({ ticker: t, quelle: k, land: v.land, tor1HaeltIhn: false, usd: preise[t] }); }
  }

  const jeLand = {};
  const jeQuelle = {};
  for (const z of zeilen) {
    const l = z.land || '?';
    const eL = jeLand[l] || (jeLand[l] = { a: 0, b: 0, c: 0, kandidaten: 0, unbepreisbar: 0, imBestand: 0 });
    const eQ = jeQuelle[z.quelle] || (jeQuelle[z.quelle] = { land: l, a: 0, b: 0, c: 0, kandidaten: 0, unbepreisbar: 0, imBestand: 0 });
    eL.kandidaten++; eQ.kandidaten++;
    if (!Number.isFinite(z.usd)) { eL.unbepreisbar++; eQ.unbepreisbar++; continue; }
    if (z.usd < BODEN) continue;                    // unter Karls Boden — bleibt draussen
    if (bestand.has(String(z.ticker).toUpperCase())) { eL.imBestand++; eQ.imBestand++; continue; }
    let a = 0, b = 0, c = 0;
    if (z.tor1HaeltIhn) {
      // Heute unsichtbar, weil Tor 1 ihn haelt.
      // (a) senkt nur Tor 2 -> er kommt nicht an.
      // (b) senkt nur Tor 1 -> er kommt an, muss aber Tor 2 (2 Mrd) nehmen.
      if (z.usd >= TOR2_HEUTE) b = 1;
      c = 1;
    } else {
      // Passiert Tor 1 (oder hat keins). Heute drin, sobald usd >= 2 Mrd -> kein Zugewinn.
      if (z.usd < TOR2_HEUTE) { a = 1; c = 1; }
    }
    eL.a += a; eL.b += b; eL.c += c;
    eQ.a += a; eQ.b += b; eQ.c += c;
  }

  const quoten = scoreQuoten(preise);
  const summe = { a: 0, b: 0, c: 0 };
  for (const e of Object.values(jeLand)) { summe.a += e.a; summe.b += e.b; summe.c += e.c; }
  // Erwartete Firmen MIT Score = Zusatz-Ticker je Quelle * historische Ticker->Score-Quote
  // DERSELBEN Quelle. Quellen mit weniger als 20 Bestandszeilen liefern keine belastbare
  // Quote — sie laufen in 'ohneQuote' und werden ehrlich NICHT hochgerechnet.
  // DREI Schaetzungen, weil eine einzelne Zahl hier eine Genauigkeit vortaeuschen wuerde,
  // die die Datenlage nicht hergibt:
  //   konservativ = Quote der Quelle ueber ALLE Groessen (durch Zweitlistungen gedrueckt)
  //   beste       = Band-Quote wo die Quelle >= 20 Bestandszeilen IM BAND hat, sonst konservativ
  //   optimistisch= die gemessene Band-Quote aller Auslandsquellen, pauschal
  const erwartet = { a: 0, b: 0, c: 0 };            // konservativ
  const erwartetBeste = { a: 0, b: 0, c: 0 };
  const ohneQuote = { a: 0, b: 0, c: 0, quellen: [] };
  for (const [q, v] of Object.entries(jeQuelle)) {
    const hist = quoten.jeQuelle[q];
    const band = quoten.jeQuelleImBand[q];
    const rate = hist && hist.ticker >= 20 ? hist.quote : null;
    const rateBand = band && band.ticker >= 20 ? band.quote : null;
    if (rate == null && rateBand == null) {
      if (v.a || v.b || v.c) { ohneQuote.a += v.a; ohneQuote.b += v.b; ohneQuote.c += v.c; ohneQuote.quellen.push(q); }
      continue;
    }
    v.scoreQuote = rate;
    v.scoreQuoteImBand = rateBand;
    const rK = rate != null ? rate : rateBand;
    const rB = rateBand != null ? rateBand : rate;
    erwartet.a += v.a * rK; erwartet.b += v.b * rK; erwartet.c += v.c * rK;
    erwartetBeste.a += v.a * rB; erwartetBeste.b += v.b * rB; erwartetBeste.c += v.c * rB;
  }
  const bandQuote = quoten.bandGesamt.quote || 0;
  const erwartetOptimistisch = { a: summe.a * bandQuote, b: summe.b * bandQuote, c: summe.c * bandQuote };

  const ergebnis = {
    erzeugtAm: new Date().toISOString(),
    schwellen: { tor1Heute: parseFloat(TOR1_HEUTE), tor2Heute: TOR2_HEUTE, boden: BODEN },
    kandidatenGesamt: zeilen.length,
    unbepreisbarGesamt: zeilen.filter((z) => !Number.isFinite(z.usd)).length,
    zusatzTicker: summe,
    erwarteteFirmenMitScore: erwartet,                    // konservativ (Ruecken-Vertraeglich)
    erwarteteFirmenMitScoreBeste: erwartetBeste,
    erwarteteFirmenMitScoreOptimistisch: erwartetOptimistisch,
    nichtHochgerechnet: ohneQuote,
    jeLand, jeQuelle, scoreQuoten: quoten,
    truncierteMaerkteTief: Object.entries(tv).filter(([, v]) => v.partialTief).map(([k]) => k),
    tvAusfaelle: Object.entries(tv).filter(([, v]) => v.ausfallHeute || v.ausfallTief)
      .map(([k, v]) => k + (v.ausfallHeute ? ' (Lauf 1,5 Mrd)' : '') + (v.ausfallTief ? ' (Lauf 800 Mio)' : '')),
    tvSchrumpfung: Object.entries(tv).filter(([, v]) => v.tiefAnzahl != null && v.tiefAnzahl < v.heute.length)
      .map(([k, v]) => k + ': ' + v.heute.length + ' -> ' + v.tiefAnzahl),
    registerAusfaelle: Object.entries(reg)
      .filter(([, v]) => v.fehler || v.tickers.length === 0)
      .map(([k, v]) => k + ': ' + (v.fehler || 'lieferte 0 Ticker (kein Fehler gemeldet — z.B. fehlender API-Schluessel)')),
  };
  schreib('ergebnis', ergebnis);
  console.log('\nZusatz-Ticker  (a) nur Tor 2: ' + summe.a + '   (b) nur Tor 1: ' + summe.b + '   (c) beide: ' + summe.c);
  console.log('Erwartete Firmen mit Score (c): konservativ ' + erwartet.c.toFixed(0) +
    ' | beste ' + erwartetBeste.c.toFixed(0) + ' | optimistisch ' + erwartetOptimistisch.c.toFixed(0) +
    '  (ohne belastbare Quote: ' + ohneQuote.c + ' Ticker)');
}

// ── Stufe 5: der Bericht als Markdown, direkt aus dem Ergebnis-JSON gerendert ────
// Von Hand abgetippte Zahlen sind eine Fehlerquelle, die dieser Bericht sich nicht leisten
// kann — er ist eine Entscheidungsvorlage.
function bericht() {
  const e = lies('ergebnis');
  const tv = lies('tv').je, reg = lies('register').je;
  const mio = (n) => (n / 1e6).toFixed(0);
  const z = [];
  z.push('# Entdeckungsband 800 Mio - 2 Mrd USD: was der Screener zusaetzlich saehe');
  z.push('');
  z.push('Gemessen ' + e.erzeugtAm.slice(0, 10) + ' mit `node scripts/messung-entdeckungsband.js {tv,register,preise,rechnen,bericht}`.');
  z.push('Keine Schwelle wurde gesenkt; die Messung laeuft ueber die vorhandenen Umgebungsvariablen in eigenen Kindprozessen.');
  z.push('');
  z.push('## Die vier Schwellen des Repos');
  z.push('');
  z.push('| Tor | Ort | heute | wirkt auf |');
  z.push('|---|---|---|---|');
  z.push('| 1 | `discovery/tv-scanner.js` `TV_PRECUT_USD` | ' + mio(e.schwellen.tor1Heute) + ' Mio | ~31 TradingView-Laender, filtert bereits serverseitig |');
  z.push('| 2 | `discovery/mcap-prefilter.js` `MCAP_PREFILTER_MIN_USD` | ' + mio(e.schwellen.tor2Heute) + ' Mio | alle Auslandsquellen mit marketCap:null |');
  z.push('| 3 | `refresh-universe.js` `MIN_MCAP_DISCOVERY` | 800 Mio | US-Kanaele — liegt bereits richtig |');
  z.push('| 4 | `daily-pull.yml` `MIN_MCAP_USD` | 800 Mio | der Abruf selbst — nimmt ab 800 Mio |');
  z.push('');
  z.push('Tor 1 und Tor 2 sind fuer die TradingView-Laender **in Reihe** geschaltet.');
  z.push('');
  z.push('## Die drei Szenarien');
  z.push('');
  z.push('| Szenario | Zusatz-Ticker | Firmen mit Score: konservativ | beste Schaetzung | optimistisch |');
  z.push('|---|---:|---:|---:|---:|');
  for (const k of ['a', 'b', 'c']) {
    const name = k === 'a' ? '(a) nur Tor 2 auf 800 Mio' : k === 'b' ? '(b) nur Tor 1 auf 800 Mio' : '**(c) beide auf 800 Mio**';
    const f = k === 'c' ? ((x) => '**' + x + '**') : ((x) => String(x));
    z.push('| ' + name + ' | ' + f(e.zusatzTicker[k]) + ' | ' + f(Math.round(e.erwarteteFirmenMitScore[k])) +
      ' | ' + f(Math.round(e.erwarteteFirmenMitScoreBeste[k])) + ' | ' + f(Math.round(e.erwarteteFirmenMitScoreOptimistisch[k])) + ' |');
  }
  z.push('');
  z.push('**Die drei Annahmen im Klartext.** *Konservativ*: die neuen Namen erreichen genau die Quote, ' +
    'die ihre Quelle heute ueber ALLE Groessen erreicht — diese Quote ist durch Zweitlistungen der grossen ' +
    'Namen (Wien, Mailand, Zuerich) nach unten verzerrt. *Optimistisch*: sie erreichen die Quote, die ' +
    'Bestandszeilen IM SELBEN GROESSENBAND heute tatsaechlich erreichen (' +
    (100 * (e.scoreQuoten.bandGesamt.quote || 0)).toFixed(1) + ' %, gemessen an ' +
    e.scoreQuoten.bandGesamt.ticker + ' Zeilen) — diese Quote ist von CN/TW/IN dominiert, waehrend die ' +
    'Neuzugaenge aus HK/CA/AT/IT kommen. *Beste Schaetzung*: Band-Quote wo die Quelle mindestens 20 ' +
    'Bestandszeilen im Band hat, sonst die konservative.');
  z.push('');
  z.push('Bereits im Bestand (watchlist.json) und daher **kein** Zugewinn: ' +
    Object.values(e.jeLand).reduce((n, v) => n + v.imBestand, 0) + ' Kandidaten.');
  z.push('Von Yahoo nicht bepreisbar (kein Kurs/kein Marktwert): ' + e.unbepreisbarGesamt + ' von ' + e.kandidatenGesamt + '.');
  z.push('');
  z.push('## Je Land');
  z.push('');
  z.push('| Land | Kandidaten | im Bestand | unbepreisbar | (a) | (b) | (c) |');
  z.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const [l, v] of Object.entries(e.jeLand).sort((x, y) => y[1].c - x[1].c)) {
    z.push('| ' + l + ' | ' + v.kandidaten + ' | ' + v.imBestand + ' | ' + v.unbepreisbar + ' | ' + v.a + ' | ' + v.b + ' | ' + v.c + ' |');
  }
  z.push('');
  z.push('## Je Quelle, mit der historischen Ticker-zu-Score-Quote');
  z.push('');
  z.push('Quote = wie viele Watchlist-Zeilen dieser Quelle am ' + e.scoreQuoten.jahrgang +
    ' tatsaechlich in einem Board mit Score standen (' + e.scoreQuoten.bewerteteTicker +
    ' von ' + e.scoreQuoten.watchlistTicker + ' insgesamt).');
  z.push('');
  z.push('| Quelle | Land | Bestand | mit Score | Quote gesamt | Bestand im Band | Quote im Band | (a) | (b) | (c) |');
  z.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [q, v] of Object.entries(e.jeQuelle).sort((x, y) => y[1].c - x[1].c)) {
    const h = e.scoreQuoten.jeQuelle[q];
    const b = e.scoreQuoten.jeQuelleImBand[q];
    const quote = v.scoreQuote != null ? (100 * v.scoreQuote).toFixed(1) + ' %' : '-';
    const quoteB = (b && b.ticker >= 20) ? (100 * b.quote).toFixed(1) + ' %' : 'zu wenige';
    z.push('| ' + q + ' | ' + v.land + ' | ' + (h ? h.ticker : 0) + ' | ' + (h ? h.mitScore : 0) + ' | ' + quote +
      ' | ' + (b ? b.ticker : 0) + ' | ' + quoteB + ' | ' + v.a + ' | ' + v.b + ' | ' + v.c + ' |');
  }
  z.push('');
  z.push('## Was diese Messung NICHT abdeckt');
  z.push('');
  if (e.truncierteMaerkteTief.length) {
    z.push('- **Abgeschnittene Maerkte bei 800 Mio** (Zeilendeckel `TV_SCAN_RANGE`, Vorgabe 2500): ' +
      e.truncierteMaerkteTief.join(', ') + '. Deren (b)/(c)-Zahlen sind eine **Untergrenze**.');
  }
  for (const a of e.tvAusfaelle || []) z.push('- **TradingView-Markt ausgefallen** (leere Antwort, nicht "keine Firmen"): ' + a);
  for (const a of e.tvSchrumpfung || []) z.push('- **Markt lieferte bei der TIEFEREN Schwelle WENIGER als bei der hoeheren** — das ist unmoeglich und heisst Teilausfall: ' + a);
  for (const a of e.registerAusfaelle) z.push('- **Quelle ausgefallen:** ' + a);
  z.push('- Alle drei Schaetzungen unterstellen, dass die Datenverfuegbarkeit der neuen Namen der der ' +
    'heutigen Bestandszeilen entspricht. Fuer Firmen, die noch nie im Universum waren, ist das nicht bewiesen.');
  z.push('- Bereits im Bestand heisst NICHT "durch die Schwelle gekommen": Bestandszeilen laufen gar nicht ' +
    'mehr durch Tor 2. Die Schwelle wirkt nur auf NEUE Entdeckungen — sie ist eine Einbahnstrasse. Wer ' +
    'einmal drin ist, bleibt; wer herausfaellt, kommt unter 2 Mrd nicht zurueck.');
  z.push('- Nicht hochgerechnet, weil die Quelle keine belastbare Bestandsquote hat (< 20 Zeilen): ' +
    e.nichtHochgerechnet.c + ' Ticker aus ' + (e.nichtHochgerechnet.quellen.join(', ') || '-') + '.');
  z.push('');
  z.push('Rohdaten: `reports/messung-entdeckungsband-{tv,register,preise,ergebnis}.json` ' +
    '(TV-Maerkte ' + Object.keys(tv).length + ', Register-Quellen ' + Object.keys(reg).length + ').');
  const ziel = path.join(OUT, 'entdeckungsband-800mio-' + e.erzeugtAm.slice(0, 10) + '.md');
  writeFileAtomic(ziel, z.join(String.fromCharCode(10)) + String.fromCharCode(10));
  console.log('-> ' + ziel);
}

const stufe = process.argv[2];
(async () => {
  if (stufe === 'tv') await stufeTv();
  else if (stufe === 'register') await stufeRegister();
  else if (stufe === 'preise') await stufePreise();
  else if (stufe === 'rechnen') rechnen();
  else if (stufe === 'bericht') bericht();
  else { console.error('Stufe fehlt: tv | register | preise | rechnen | bericht'); process.exit(2); }
})().catch((e) => { console.error(e); process.exit(1); });
