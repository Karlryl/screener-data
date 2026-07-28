#!/usr/bin/env node
'use strict';
/**
 * TAEGLICHER MITSCHNITT DER TICKER-LANDKARTE
 * =========================================
 * Haelt fest, WELCHE Wertpapiere an einem Tag ueberhaupt notiert waren.
 *
 * WARUM DAS EILT: NASDAQ und die SEC ueberschreiben ihre Symbolverzeichnisse taeglich.
 * Es gibt kein Archiv. Die Frage "welche Ticker gab es am 01.08.2025?" ist heute
 * unbeantwortbar — und jeder Tag ohne diesen Mitschnitt ist DAUERHAFT verloren.
 * Der "frueher finden"-Katalog und jeder Rueckrechnungs-Test brauchen genau das:
 * ohne die Landkarte von damals sieht man nur die Ueberlebenden und haelt sie fuer
 * das ganze Feld (Ueberlebenden-Verzerrung in Reinform).
 *
 * WARUM ROHE FELDER, NICHT DAS GEFILTERTE ERGEBNIS:
 * `discovery/nasdaq-all.js` wirft Junk-Papiere per `isJunkSecurity()` raus. Diese Regel
 * hat sich schon geaendert und wird es wieder. Wer das GEFILTERTE Ergebnis archiviert,
 * schreibt mit jeder Regel-Aenderung die Vergangenheit um. Hier landen deshalb die
 * Rohfelder samt ETF- und Test-Kennzeichen — jede spaetere Filterregel laesst sich
 * darauf nachtraeglich anwenden.
 *
 * WARUM AENDERUNGEN STATT VOLLBILDERN:
 * Ein taegliches Vollbild kostet gzippt 435 KB (live gemessen 28.07.) = 163 MB im Jahr,
 * fuer immer, in einem Repo das jeder klont. Die Liste aendert sich aber nur um eine
 * Handvoll Eintraege am Tag. Also: EIN Grundbild plus eine Zeile Aenderungen je Tag
 * — dieselbe Bauform wie das Newcomer-Log (Tag 478). Groessenordnung: ~1 MB im Jahr.
 *
 * Ablage:
 *   external-data/ticker-map/_grundbild.json      Vollstand zum Zeitpunkt der Anlage
 *   external-data/ticker-map/YYYY-MM.jsonl        eine Zeile je Tag mit den Aenderungen
 *
 * Run:  node scripts/snapshot-ticker-map.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'external-data', 'ticker-map');
const GRUNDBILD = path.join(DIR, '_grundbild.json');
const { writeFileAtomic } = require(path.join(ROOT, 'lib/atomic-write.js'));

const QUELLEN = {
  sec: 'https://www.sec.gov/files/company_tickers.json',
  nasdaq: 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt',
  other: 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt',
};

const UA = require(path.join(ROOT, 'lib/sec-user-agent.js')).secUserAgent();
const MAX_REDIRECTS = 5;

function hole(url, uebrig = MAX_REDIRECTS) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (r) => {
      if ([301, 302, 307, 308].includes(r.statusCode)) {
        r.resume();
        if (!r.headers.location || uebrig <= 0) return rej(new Error('Weiterleitung ins Leere: ' + url));
        return hole(new URL(r.headers.location, url).toString(), uebrig - 1).then(res).catch(rej);
      }
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('HTTP ' + r.statusCode + ' bei ' + url)); }
      const c = [];
      r.on('data', (d) => c.push(d));
      r.on('end', () => res(Buffer.concat(c).toString('utf8')));
      r.on('error', rej);
    });
    req.on('error', rej);
    req.setTimeout(60000, () => { req.destroy(); rej(new Error('Zeitueberschreitung bei ' + url)); });
  });
}

const feld = (a, i) => (a[i] || '').trim();

/**
 * Baut aus den drei Rohquellen EINE Karte symbol -> kompakter Datensatz.
 * Kurze Schluessel, weil jedes Zeichen 365-mal im Jahr anfaellt:
 *   n Name · b Boerse/Marktkategorie · e ETF-Kennzeichen · t Test-Kennzeichen · c CIK
 */
function baueKarte(roh) {
  const karte = new Map();
  // nasdaqlisted: Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot|ETF|NextShares
  for (const zeile of (roh.nasdaq || '').split('\n').slice(1)) {
    const z = zeile.trim();
    if (!z || z.startsWith('File Creation')) continue;
    const p = z.split('|');
    if (p.length < 7) continue;
    const sym = feld(p, 0).toUpperCase();
    if (!sym) continue;
    karte.set(sym, { n: feld(p, 1), b: 'NASDAQ:' + feld(p, 2), e: feld(p, 6), t: feld(p, 3) });
  }
  // otherlisted: ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot|Test Issue|NASDAQ Symbol
  for (const zeile of (roh.other || '').split('\n').slice(1)) {
    const z = zeile.trim();
    if (!z || z.startsWith('File Creation')) continue;
    const p = z.split('|');
    if (p.length < 7) continue;
    const sym = feld(p, 0).toUpperCase();
    if (!sym) continue;
    // Steht ein Symbol in BEIDEN Dateien, gewinnt der erste Eintrag nicht automatisch —
    // otherlisted traegt die echte Boerse (NYSE/AMEX/ARCA), die hier mehr wert ist.
    const alt = karte.get(sym) || {};
    karte.set(sym, { n: feld(p, 1) || alt.n, b: feld(p, 2), e: feld(p, 4), t: feld(p, 6) });
  }
  // SEC company_tickers.json -> CIK je Symbol (nur ergaenzend; die SEC kennt auch Namen
  // ohne NASDAQ-Eintrag, die bekommen einen eigenen Datensatz)
  try {
    const j = JSON.parse(roh.sec || '{}');
    for (const e of Object.values(j)) {
      const sym = String(e.ticker || '').trim().toUpperCase();
      if (!sym) continue;
      const cik = String(e.cik_str || '').replace(/\D/g, '').padStart(10, '0');
      const alt = karte.get(sym);
      if (alt) alt.c = cik;
      else karte.set(sym, { n: String(e.title || ''), b: 'SEC', e: '', t: '', c: cik });
    }
  } catch (_) { /* kaputtes SEC-JSON darf den Rest nicht kippen */ }
  return karte;
}

/** Stabile Textform eines Datensatzes — nur dafuer da, Gleichheit zu pruefen. */
const alsText = (d) => JSON.stringify([d.n || '', d.b || '', d.e || '', d.t || '', d.c || '']);

/** Was hat sich geaendert? Reine Funktion, damit sie einzeln testbar ist. */
function diff(alt, neu) {
  const hinzu = {}, weg = [], geaendert = {};
  for (const [sym, d] of neu) {
    const a = alt.get(sym);
    if (!a) hinzu[sym] = d;
    else if (alsText(a) !== alsText(d)) geaendert[sym] = d;
  }
  for (const sym of alt.keys()) if (!neu.has(sym)) weg.push(sym);
  weg.sort();
  return { hinzu, weg, geaendert };
}

/** Spielt Grundbild + alle Tageszeilen bis einschliesslich `bis` ab. */
function zustandAus(grundbild, zeilen, bis = null) {
  const k = new Map(Object.entries(grundbild || {}));
  for (const z of zeilen) {
    if (bis && z.datum > bis) break;
    for (const [sym, d] of Object.entries(z.hinzu || {})) k.set(sym, d);
    for (const [sym, d] of Object.entries(z.geaendert || {})) k.set(sym, d);
    for (const sym of z.weg || []) k.delete(sym);
  }
  return k;
}

/** Alle Tageszeilen aus allen Monatsdateien, chronologisch. */
function alleZeilen(dir = DIR) {
  const raus = [];
  let dateien;
  try { dateien = fs.readdirSync(dir); } catch (_) { return raus; }
  for (const f of dateien.filter((x) => /^\d{4}-\d{2}\.jsonl$/.test(x)).sort()) {
    for (const z of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!z.trim()) continue;
      try { raus.push(JSON.parse(z)); } catch (_) { /* eine kaputte Zeile kippt nicht den Lauf */ }
    }
  }
  raus.sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
  return raus;
}

const heute = () => new Date().toISOString().slice(0, 10);

async function run(argv = process.argv.slice(2)) {
  const trocken = argv.includes('--dry');
  const roh = {};
  for (const [k, u] of Object.entries(QUELLEN)) {
    roh[k] = await hole(u);
  }
  const neu = baueKarte(roh);
  // Fail-loud: eine der drei Quellen liefert manchmal eine Wartungsseite mit HTTP 200.
  // Eine plausible Untergrenze ist billiger als ein stiller Verlust eines Tages.
  if (neu.size < 5000) throw new Error('nur ' + neu.size + ' Symbole erkannt — Quelle vermutlich kaputt, Tag NICHT geschrieben');

  fs.mkdirSync(DIR, { recursive: true });
  let grundbild = null;
  try { grundbild = JSON.parse(fs.readFileSync(GRUNDBILD, 'utf8')); } catch (_) { /* noch keins */ }

  if (!grundbild) {
    const obj = Object.fromEntries([...neu.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    console.log('Grundbild wird angelegt: ' + neu.size + ' Symbole');
    if (!trocken) writeFileAtomic(GRUNDBILD, JSON.stringify(obj, null, 0));
    return { erstanlage: true, symbole: neu.size };
  }

  const datum = heute();
  const zeilen = alleZeilen();
  // Ein zweiter Lauf am selben Tag ersetzt seine Zeile, statt eine zweite anzuhaengen —
  // sonst haengt der Zustand davon ab, wie oft der Job lief.
  const vorher = zustandAus(grundbild, zeilen.filter((z) => z.datum < datum));
  const { hinzu, weg, geaendert } = diff(vorher, neu);

  const zeile = {
    datum,
    summe: neu.size,
    hinzu, weg, geaendert,
    // Damit ein spaeterer Leser pruefen kann, ob sein Abspielen denselben Stand ergibt.
    pruefsumme: require('crypto').createHash('sha256')
      .update([...neu.keys()].sort().join(',')).digest('hex').slice(0, 16),
  };

  const datei = path.join(DIR, datum.slice(0, 7) + '.jsonl');
  const bestand = fs.existsSync(datei)
    ? fs.readFileSync(datei, 'utf8').split('\n').filter((z) => z.trim() && !z.includes('"datum":"' + datum + '"'))
    : [];
  const inhalt = bestand.concat(JSON.stringify(zeile)).join('\n') + '\n';

  console.log('Ticker-Landkarte ' + datum + ': ' + neu.size + ' Symbole'
    + ' | neu ' + Object.keys(hinzu).length
    + ' · weg ' + weg.length
    + ' · geaendert ' + Object.keys(geaendert).length
    + ' | Zeile ' + (Buffer.byteLength(JSON.stringify(zeile)) / 1024).toFixed(1) + ' KB');
  if (weg.length) console.log('  verschwunden: ' + weg.slice(0, 15).join(' ') + (weg.length > 15 ? ' …' : ''));

  if (!trocken) writeFileAtomic(datei, inhalt);
  return zeile;
}

module.exports = { baueKarte, diff, zustandAus, alleZeilen, alsText, QUELLEN, DIR, GRUNDBILD };

if (require.main === module) run().catch((e) => { console.error('::error::' + e.message); process.exit(1); });
