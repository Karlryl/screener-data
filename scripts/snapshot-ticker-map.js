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

/**
 * Pruefsumme ueber eine Symbolmenge. BK-SK-001: es gibt genau EINE solche Stelle —
 * die schreibende (run) und die nachrechnende (zustandAus) Seite teilen sie sich.
 * Zwei getrennte Formeln driften auseinander, und dann warnt die Pruefung entweder
 * dauernd oder nie; beides ist schlimmer als gar keine Pruefung.
 */
const summeVon = (schluessel) => require('crypto').createHash('sha256')
  .update([...schluessel].sort().join(',')).digest('hex').slice(0, 16);

/**
 * Grundbild lesen. Zwei Formen sind gueltig:
 *   Rohform   { SYM: {...}, ... }                 — alles, was vor der Monats-Rotation entstand
 *   Wickelform{ ab, erzeugt, symbole: { SYM: … } } — seit BK-SK-001
 * `ab` = Datum, AB DEM die Tageszeilen auf DIESES Bild gehoeren. Aeltere Zeilen
 * gehoeren zum archivierten Vorgaenger unter archiv/.
 */
function alsGrundbild(j) {
  if (j && typeof j === 'object' && j.symbole && typeof j.symbole === 'object') {
    return { ab: j.ab || null, symbole: j.symbole };
  }
  return { ab: null, symbole: j || {} };   // Rohform gilt seit jeher, also ohne Grenze
}

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

/**
 * Spielt Grundbild + alle Tageszeilen bis einschliesslich `bis` ab.
 *
 * BK-SK-001: `pruefsumme` wurde seit jeher in jede Tageszeile GESCHRIEBEN und
 * nirgends GELESEN — ihr einziger Zweck ("ergibt mein Abspielen denselben Stand,
 * den der Schreiber sah?") war nie in Betrieb. Jetzt wird sie nach jeder Zeile
 * nachgerechnet. Abweichung = Warnung, kein Abbruch: der Stand ist dann zwar
 * verdaechtig, aber immer noch das Beste, was verfuegbar ist — und ein harter
 * Abbruch wuerde den Tageslauf an einem alten Datenfehler aufhaengen.
 */
function zustandAus(grundbild, zeilen, bis = null) {
  const g = alsGrundbild(grundbild);
  const k = new Map(Object.entries(g.symbole || {}));
  if (bis && g.ab && bis < g.ab) {
    console.log('::warning::Stichtag ' + bis + ' liegt VOR der Grundbild-Grenze ' + g.ab
      + ' — dieser Stand stammt aus dem Grundbild dieser Aera und bildet den ' + bis
      + ' NICHT ab. Fuer den aelteren Zeitraum das archivierte Vorgaenger-Bild aus '
      + 'external-data/ticker-map/archiv/ verwenden.');
  }
  const abweichend = [];
  for (const z of zeilen) {
    // Zeilen der Vorgaenger-Aera sind bereits im Grundbild verrechnet; sie ein
    // zweites Mal anzuwenden ergaebe einen Stand, den es nie gab.
    if (g.ab && z.datum < g.ab) continue;
    if (bis && z.datum > bis) break;
    for (const [sym, d] of Object.entries(z.hinzu || {})) k.set(sym, d);
    for (const [sym, d] of Object.entries(z.geaendert || {})) k.set(sym, d);
    for (const sym of z.weg || []) k.delete(sym);
    // ponytail: Summe je Zeile ueber alle Schluessel. Kosten sind durch die
    // Monats-Rotation auf ~31 Zeilen je Aera gedeckelt; ohne Rotation waere das
    // ueber ein Jahr spuerbar geworden.
    if (z.pruefsumme && summeVon(k.keys()) !== z.pruefsumme) abweichend.push(z.datum);
  }
  if (abweichend.length) {
    console.log('::warning::Abgespielter Stand weicht von der mitgeschriebenen pruefsumme ab, '
      + 'zuerst am ' + abweichend[0] + ' (' + abweichend.length + ' Tag(e) betroffen'
      + (abweichend.length > 1 ? ', zuletzt ' + abweichend[abweichend.length - 1] : '') + '). '
      + 'Ursache ist entweder ein verdorbenes Grundbild oder eine verlorene Tageszeile — '
      + 'die Rekonstruktion "welche Ticker gab es am X?" ist ab diesem Tag nicht mehr belastbar.');
  }
  return k;
}

/** Alle Tageszeilen aus allen Monatsdateien, chronologisch. */
function alleZeilen(dir = DIR) {
  const raus = [];
  let dateien;
  try { dateien = fs.readdirSync(dir); } catch (_) { return raus; }
  for (const f of dateien.filter((x) => /^\d{4}-\d{2}\.jsonl$/.test(x)).sort()) {
    const zeilen = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    for (let i = 0; i < zeilen.length; i++) {
      const z = zeilen[i];
      if (!z.trim()) continue;
      try { raus.push(JSON.parse(z)); } catch (e) {
        // BK-SK-001: eine kaputte Zeile kippt weiterhin nicht den Lauf — aber sie
        // verschwand bisher voellig stumm. Ein verlorener Tag sah danach aus wie ein
        // Tag ohne Aenderungen, und die Ticker-Historie ist nicht nachholbar.
        console.log('::warning::Kaputte Zeile in der Ticker-Landkarte uebersprungen: '
          + f + ':' + (i + 1) + ' (' + e.message + ') — dieser Tag fehlt beim Abspielen '
          + 'und laesst sich nicht nachtraeglich holen.');
      }
    }
  }
  raus.sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
  return raus;
}

/**
 * Monats-Rotation des Grundbilds (BK-SK-001).
 *
 * Das Grundbild ist der Nullpunkt JEDER Rekonstruktion. Ist es einmal verdorben,
 * ist jeder spaetere Abruf verdorben — dauerhaft und unauffaellig. Ein frisches
 * Bild je Monat begrenzt den Schaden auf den laufenden Monat.
 *
 * Das alte Bild wird VORHER als NEUE Datei nach archiv/ kopiert. Es wird nichts
 * geloescht und nichts ueberschrieben: die alte Aera bleibt exakt so abspielbar,
 * wie sie geschrieben wurde (Rohform-Bild + die Tageszeilen davor).
 *
 * Rueckgabe: Beschreibung der Rotation, oder null wenn nichts zu tun war.
 */
function rotiereGrundbild(karte, datum, dir = DIR, trocken = false) {
  const gb = path.join(dir, '_grundbild.json');
  let ab;
  try { ab = alsGrundbild(JSON.parse(fs.readFileSync(gb, 'utf8'))).ab; }
  catch (_) { return null; }   // kein/unlesbares Grundbild -> das ist Sache der Erstanlage in run()
  if (ab && ab.slice(0, 7) === datum.slice(0, 7)) return null;   // in diesem Monat schon rotiert
  const archiv = path.join(dir, 'archiv', '_grundbild-bis-' + datum + '.json');
  if (fs.existsSync(archiv)) return null;   // eine Archiv-Kopie wird NIE ueberschrieben
  if (!trocken) {
    fs.mkdirSync(path.dirname(archiv), { recursive: true });
    fs.copyFileSync(gb, archiv);
    writeFileAtomic(gb, JSON.stringify({
      ab: datum,
      erzeugt: new Date().toISOString(),
      hinweis: 'Tageszeilen VOR ' + datum + ' gehoeren zum Vorgaenger in archiv/; dieses Bild gilt ab ' + datum + '.',
      symbole: Object.fromEntries([...karte.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    }, null, 0));
  }
  return { ab: datum, vorher: ab, symbole: karte.size, archiv: path.relative(dir, archiv) };
}

const heute = () => new Date().toISOString().slice(0, 10);

async function run(argv = process.argv.slice(2)) {
  const trocken = argv.includes('--dry');
  // Quellen EINZELN holen (Fund 29.07.2026): faellt eine aus, darf sie nicht den ganzen
  // Tag mitreissen. Am 29.07. lieferte www.sec.gov den GitHub-Laeufern zweimal HTTP 403,
  // waehrend derselbe Aufruf mit demselben User-Agent von aussen 200 gab — die Sperre gilt
  // den Rechenzentrums-IPs, nicht uns. Folge damals: dieser Schritt kippte den ganzen
  // scoring-Job, also Score, Vintage UND Export. Der Kommentar unten in baueKarte sagt seit
  // jeher "kaputtes SEC-JSON darf den Rest nicht kippen" — fuer den ABRUF galt das nie.
  const roh = {};
  const fehlend = [];
  for (const [k, u] of Object.entries(QUELLEN)) {
    try {
      roh[k] = await hole(u);
    } catch (e) {
      roh[k] = '';
      fehlend.push(k);
      console.log(`::warning::Ticker-Quelle "${k}" nicht erreichbar (${e.message}) — der Tag wird aus den `
        + 'uebrigen Quellen gebaut. Fehlende Felder werden aus dem Vortagesstand uebernommen, '
        + 'und die Luecke steht als quellenFehlend in der Tageszeile.');
    }
  }
  if (fehlend.length === Object.keys(QUELLEN).length) {
    throw new Error('ALLE Ticker-Quellen nicht erreichbar (' + fehlend.join(', ') + ') — nichts zu bauen');
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
    // Seit BK-SK-001 in der Wickelform mit `ab` — sonst wuesste ein spaeterer Leser
    // nach der ersten Monats-Rotation nicht, welche Tageszeilen zu welchem Bild gehoeren.
    if (!trocken) writeFileAtomic(GRUNDBILD, JSON.stringify({
      ab: heute(),
      erzeugt: new Date().toISOString(),
      hinweis: 'Erstanlage. Tageszeilen ab ' + heute() + ' gehoeren auf dieses Bild.',
      symbole: obj,
    }, null, 0));
    return { erstanlage: true, symbole: neu.size };
  }

  const datum = heute();
  const zeilen = alleZeilen();
  // Ein zweiter Lauf am selben Tag ersetzt seine Zeile, statt eine zweite anzuhaengen —
  // sonst haengt der Zustand davon ab, wie oft der Job lief.
  const vorher = zustandAus(grundbild, zeilen.filter((z) => z.datum < datum));

  // Fehlt die SEC, fehlt die CIK — und sie steckt in alsText(), geht also in den
  // Aenderungsvergleich ein. Ohne Uebernahme meldete der Tag tausende Symbole als
  // "geaendert", nur weil eine Quelle schwieg: die Historie waere verdorben, und
  // zwar unauffaellig. Deshalb Vortageswert uebernehmen statt leer schreiben.
  if (fehlend.includes('sec')) {
    let uebernommen = 0;
    for (const [sym, d] of neu) {
      const alt = vorher.get(sym);   // zustandAus liefert eine Map, keinen Objekt-Index
      if (!d.c && alt && alt.c) { d.c = alt.c; uebernommen++; }
    }
    console.log(`  CIK aus dem Vortagesstand uebernommen: ${uebernommen} Symbole `
      + '(die SEC-Quelle schwieg — ohne das waere jedes davon faelschlich als geaendert gezaehlt worden)');

    // R1-SK-002 (Hard Review 2026-07-31): Symbole, die NUR ueber die SEC bekannt sind
    // (b:'SEC' — kein NASDAQ-/otherlisted-Eintrag, z.B. manche OTC-/Foreign-Private-
    // Issuer), verschwinden bei einem SEC-Ausfall komplett aus `neu`, weil baueKarte()
    // sie ausschliesslich aus roh.sec erzeugt. diff() liest das dann als "weg" —
    // Delisting statt Quellenausfall. Am 29.07. waren das 3.356 Symbole an einem
    // einzigen Tag. Fix: bei fehlender SEC-Quelle jeden reinen SEC-Datensatz aus dem
    // Vortagesstand unveraendert in `neu` uebernehmen, bevor diff() laeuft — echte
    // Delistings (aus nasdaq/otherlisted) bleiben davon unberuehrt.
    let secOnlyUebernommen = 0;
    for (const [sym, alt] of vorher) {
      if (alt.b === 'SEC' && !neu.has(sym)) { neu.set(sym, alt); secOnlyUebernommen++; }
    }
    if (secOnlyUebernommen > 0) {
      console.log(`  Reine SEC-Symbole aus dem Vortagesstand uebernommen: ${secOnlyUebernommen} `
        + '(sonst faelschlich als "weg"/delisted gezaehlt, weil die SEC-Quelle schwieg)');
    }
  }

  const { hinzu, weg, geaendert } = diff(vorher, neu);

  const zeile = {
    datum,
    summe: neu.size,
    // Leere Liste heisst ausdruecklich "alle Quellen waren da" — das Feld fehlt nie,
    // damit ein spaeterer Leser nicht raten muss, ob es nur nicht geschrieben wurde.
    quellenFehlend: fehlend,
    hinzu, weg, geaendert,
    // Damit ein spaeterer Leser pruefen kann, ob sein Abspielen denselben Stand ergibt.
    // Seit BK-SK-001 rechnet zustandAus() sie beim Abspielen tatsaechlich nach.
    pruefsumme: summeVon(neu.keys()),
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

  // NACH der Tageszeile rotieren: die Zeile bleibt damit ein echter Diff gegen gestern,
  // und der neue Nullpunkt ist genau der Stand, den sie erzeugt. Ein Abspielen ab dem
  // neuen Bild ueberspringt sie korrekt (sie ist bereits darin verrechnet).
  const rot = rotiereGrundbild(neu, datum, DIR, trocken);
  if (rot) {
    console.log('Grundbild rotiert (Monatswechsel): neuer Nullpunkt ab ' + rot.ab
      + ' mit ' + rot.symbole + ' Symbolen; das bisherige Bild'
      + (rot.vorher ? ' (ab ' + rot.vorher + ')' : ' (Rohform)') + ' liegt unveraendert als '
      + rot.archiv + ' — kopiert, nicht verschoben.');
  }
  return zeile;
}

module.exports = {
  baueKarte, diff, zustandAus, alleZeilen, alsText, summeVon, alsGrundbild, rotiereGrundbild,
  QUELLEN, DIR, GRUNDBILD,
};

if (require.main === module) run().catch((e) => { console.error('::error::' + e.message); process.exit(1); });
