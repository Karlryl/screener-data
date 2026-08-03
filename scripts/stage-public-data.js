#!/usr/bin/env node
'use strict';
/**
 * scripts/stage-public-data.js - F-17a (Karl-Entscheid 04.08.2026, Option c).
 *
 * PROBLEM: findash zieht sich zwei Dateien per `git pull` aus einem lokalen Checkout
 * DIESES Repos - earnings-calendar.json (Termine im Kalender-Tab) und board-history/
 * (Bewegungs-Anzeige NEU/^v im Screener-Tab). Auf dem findash-Server gibt es diesen
 * Checkout nicht, der Pull wird abgeschaltet. Beides muss also durch denselben
 * oeffentlichen Kanal wie der findash-export/v1-Vertrag: den gh-pages-Branch.
 *
 * Dieses Skript BAUT nur das Publish-Verzeichnis; gepusht wird es von daily-pull.yml
 * (merge-Job fuer den Kalender, scoring-Job fuer die Vintages - je dort, wo die Quelle
 * im Lauf frisch ist).
 *
 * LAUT statt still: jede angeforderte Quelle, die fehlt oder unlesbar ist, beendet den
 * Lauf mit ::error:: und exit 1. Ein stilles Weglassen waere der schlimmste Ausgang -
 * findash zeigte danach wortlos keine Termine bzw. keine Bewegung, und niemand erfuehre
 * warum. Waechter: tests/stage-public-data.test.js.
 *
 * GROESSEN-ENTSCHEIDUNG board-history (sonst 95 MB im Datenkanal):
 *   1. Nur die N juengsten Vintages (Default 2). findashs computeMovement() nimmt
 *      `vintages.slice(-2)` - aeltere Staende liest es nie.
 *   2. Nur Dateien MIT `cohort` (findash erkennt Boards inhaltsbasiert genauso).
 *      Damit fallen die Sidecars calibration.json (1,5 MB/Vintage) und regime.json weg.
 *   3. Je Zeile nur rank/ticker/score. computeMovement baut daraus {rank, ticker} und
 *      verwirft alles andere; score bleibt drin, weil findashs Zeilen-Pruefung den
 *      ANWESENDEN score-Schluessel verlangt.
 *   Ergebnis: ~13,5 MB je Vintage -> ~0,15 MB. Die Form (Datei mit cohort.profitable/
 *   .unprofitable) bleibt unveraendert, findashs Leser braucht kein neues Format.
 *   ponytail: Deckel dieser Projektion - braucht die Bewegungs-Anzeige eines Tages ein
 *   weiteres Feld, gehoert es in SLIM_FELDER, nicht ein voller Vintage in den Kanal.
 */
const fs = require('fs');
const path = require('path');

const VINTAGE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;
// Die Felder, die findash/data-layer/screener.js (computeMovement -> shapeTrack) liest.
const SLIM_FELDER = ['rank', 'ticker', 'score'];

function schreibeJson(ziel, obj) {
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, JSON.stringify(obj));
}

/**
 * Termin-Kalender byte-genau uebernehmen (nur mit vorherigem Parse-Check - eine halb
 * geschriebene Quelle darf nie als gueltiger Kanal-Inhalt erscheinen).
 *
 * T564-B6: Plausibilitaet und Vollstaendigkeit entscheidet weiterhin der Collapse-Guard
 * in pull-earnings-dates.js eine Stufe frueher - hier steht KEINE zweite Meinung dazu.
 *
 * KV571-1 (Review Tag 571): die einzige Ausnahme ist eine strukturelle. Der Deploy-cmp
 * in daily-pull.yml deckt "Quelle fehlt/weicht ab", NICHT "Quelle alt": der Pull traegt
 * continue-on-error und earnings-calendar.json ist git-getrackt, also steht bei einem
 * Yahoo-Ausfall der gestrige Stand beidseitig identisch da und cmp wird gruen. Ein
 * Termin-Kalender ganz OHNE Zukunftstermin ist per Konstruktion kaputt oder steinalt -
 * das ist keine Plausibilitaets-Schwelle, sondern eine Form-Aussage, und sie darf nicht
 * still in den Datenkanal. Bewusst NUR diese eine Eigenschaft, keine weiteren Schwellen.
 * ponytail: Deckel dieser Stufe.
 * @returns {{datei: string, bytes: number}}
 */
function stageEarnings(quelle, zielDir, heute) {
  let text;
  try {
    text = fs.readFileSync(quelle, 'utf8');
  } catch (e) {
    throw new Error('earnings-calendar.json nicht lesbar (' + quelle + '): ' + (e && e.message || e));
  }
  let daten;
  try {
    daten = JSON.parse(text);
  } catch (e) {
    throw new Error('earnings-calendar.json ist kein gueltiges JSON (' + quelle + '): ' + (e && e.message || e));
  }
  // ISO-Datumsstrings sind lexikografisch sortierbar - kein Date.parse noetig.
  // Stichtag ist das im prep-Job eingefrorene Lauf-Datum (Muster wie in
  // archive-old-snapshots.js / watch-fx-sanity.js), mit Wanduhr-Fallback: ein Lauf
  // ueber UTC-Mitternacht wuerde sonst gegen einen anderen Tag messen als jeder
  // andere Schritt desselben Laufs (Klasse F-219b-01).
  const stichtag = heute || process.env.RUN_DATE_UTC || new Date().toISOString().slice(0, 10);
  const termine = Object.values(daten || {})
    .map((e) => (e && typeof e === 'object' ? e.date : null))
    .filter((d) => typeof d === 'string' && d !== '');
  const kuenftig = termine.filter((d) => d >= stichtag).length;
  if (kuenftig === 0) {
    const juengster = termine.length ? termine.slice().sort().pop() : '(kein einziger Termin)';
    throw new Error('earnings-calendar.json enthaelt keinen einzigen Zukunftstermin (Lauftag ' + stichtag
      + ', juengster Termin ' + juengster + ', ' + termine.length + ' Termine gesamt) - ein Termin-Kalender '
      + 'ohne kuenftige Termine ist per Konstruktion kaputt oder steinalt. WAHRSCHEINLICHE URSACHE: '
      + 'pull-earnings-dates.js ist ausgefallen (continue-on-error) und der git-getrackte Stand von '
      + 'gestern wurde durchgereicht; der Deploy-cmp kann das nicht sehen, weil Quelle und Kopie dann '
      + 'byte-gleich sind. ODER: Feldname/Format in earnings-calendar.json hat sich geaendert — dann '
      + 'liest diese Pruefung die Termine nur nicht mehr, und der Pull ist voellig unschuldig (T573-R2: '
      + 'die Meldung nannte frueher in JEDEM Fall den Pull und schickte damit zum falschen Schritt). '
      + 'NAECHSTER SCHRITT: Schritt "Pull Earnings-Calendar" im prep-Job pruefen — und wenn der gruen '
      + 'war, den Aufbau von earnings-calendar.json gegen das erwartete {ticker:{date:"YYYY-MM-DD"}}.');
  }
  const ziel = path.join(zielDir, 'earnings-calendar.json');
  fs.mkdirSync(zielDir, { recursive: true });
  fs.writeFileSync(ziel, text);
  return { datei: ziel, bytes: Buffer.byteLength(text) };
}

/** Eine Kohorten-Spur auf die Felder projizieren, die die Bewegungs-Anzeige liest. */
function slimTrack(rows, wo) {
  if (!Array.isArray(rows)) throw new Error('ungueltige Kohorte in ' + wo + ' (profitable/unprofitable muessen Arrays sein)');
  return rows.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('ungueltige Zeile in ' + wo);
    const out = {};
    for (const f of SLIM_FELDER) {
      if (Object.prototype.hasOwnProperty.call(row, f)) out[f] = row[f];
    }
    return out;
  });
}

/** Eine Vintage-Board-Datei auf die Publish-Form bringen (gleiche Huelle, schlanke Zeilen). */
function slimVintage(v, wo) {
  if (!v || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, 'cohort')) return null; // Sidecar
  if (!v.cohort || typeof v.cohort !== 'object') throw new Error('ungueltige Kohorte in ' + wo);
  return {
    date: v.date,
    board: v.board,
    cohort: {
      profitable: slimTrack(v.cohort.profitable, wo),
      unprofitable: slimTrack(v.cohort.unprofitable, wo),
    },
  };
}

/**
 * Die N juengsten Vintages schlank nach <zielDir>/board-history/ legen + index.json.
 * Das index.json ist Pflicht, nicht Beiwerk: ueber HTTP gibt es kein readdir - ohne die
 * Liste kann der Konsument die Vintages gar nicht erst finden.
 */
function stageBoardHistory(quellDir, zielDir, anzahl) {
  let eintraege;
  try {
    eintraege = fs.readdirSync(quellDir, { withFileTypes: true });
  } catch (e) {
    throw new Error('board-history nicht lesbar (' + quellDir + '): ' + (e && e.message || e));
  }
  const alle = eintraege.filter((e) => e.isDirectory() && VINTAGE_DIR_RE.test(e.name)).map((e) => e.name).sort();
  if (alle.length === 0) throw new Error('kein Vintage in ' + quellDir + ' - die Bewegungs-Anzeige haette keine Quelle');
  if (alle.length < anzahl) {
    // T564-B5: hier bewusst nur ::warning:: - beim allerersten Vintage (Bootstrap) ist das
    // ein legitimer Zustand und darf den Lauf nicht kippen. Karl sieht ::warning:: aber nie.
    // Der Kanal, der ihn erreicht, ist die Frische-Sonde in heartbeat.yml
    // ("Check board-history channel freshness"): sie wird ROT, wenn im publizierten
    // index.json weniger als 2 Vintages stehen - also genau dann, wenn die
    // Bewegungs-Anzeige dauerhaft leer bliebe statt nur einmal beim Bootstrap.
    console.log('::warning::board-history hat nur ' + alle.length + ' Vintage(s), ' + anzahl
      + ' angefordert - die Bewegungs-Anzeige bleibt leer, bis zwei Staende vorliegen.');
  }
  const gewaehlt = alle.slice(-anzahl);
  const zielBH = path.join(zielDir, 'board-history');
  fs.rmSync(zielBH, { recursive: true, force: true }); // nie Reste eines frueheren Laufs mitpublizieren
  const vintages = [];
  // T568-F6: Zeilenzahl je Board, parallel zu `vintages` gehalten und NICHT ins index.json
  // geschrieben — der publizierte Vertrag (schema board-history-publish/v1) bleibt unveraendert.
  const zeilenJeVintage = [];
  for (const date of gewaehlt) {
    const dir = path.join(quellDir, date);
    const dateien = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
    const geschrieben = [];
    const zeilen = {};
    for (const name of dateien) {
      const wo = date + '/' + name;
      let roh;
      try {
        roh = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      } catch (e) {
        throw new Error('Vintage-Datei nicht lesbar: ' + wo + ' (' + (e && e.message || e) + ')');
      }
      const slim = slimVintage(roh, wo);
      if (!slim) continue; // Sidecar ohne cohort - gehoert nicht in den Kanal
      schreibeJson(path.join(zielBH, date, name), slim);
      geschrieben.push(name);
      zeilen[name] = slim.cohort.profitable.length + slim.cohort.unprofitable.length;
    }
    if (geschrieben.length === 0) throw new Error('kein Board im Vintage ' + date + ' - nur Sidecars, das ist ein Defekt');
    vintages.push({ date, files: geschrieben });
    zeilenJeVintage.push(zeilen);
  }
  // T564-B3: die Board-Familien der publizierten Staende muessen zusammenpassen. findash
  // vergleicht Board fuer Board; fehlt eines im JUENGEREN Stand, liest sich jede Zeile des
  // aelteren als Abgang. Repro aus dem Tag-564-Review: ein entferntes utilities.json ergab
  // 117 Phantom-Abgaenge, gemeldet als warning:null. Darum hart abbrechen statt publizieren.
  // ZUGEWINN ist der bewusste Gegenfall (eine neue Board-Familie kommt dazu) und geht
  // durch - nur laut protokolliert, damit ein unerwarteter Zugewinn nicht unsichtbar ist.
  for (let i = 1; i < vintages.length; i++) {
    const alt = vintages[i - 1], neu = vintages[i];
    const fehlend = alt.files.filter((f) => !neu.files.includes(f));
    const dazu = neu.files.filter((f) => !alt.files.includes(f));
    if (fehlend.length) {
      throw new Error('Board-Familie schrumpft zwischen ' + alt.date + ' und ' + neu.date + ': '
        + fehlend.join(', ') + ' fehlt im juengeren Vintage - jede Zeile dieser Boards erschiene '
        + 'in der Bewegungs-Anzeige als Abgang. Erst die Ursache klaeren (Board-Lauf gescheitert?), '
        + 'nicht publizieren.');
    }
    // T568-F6: dasselbe Phantom-Abgangs-Muster OHNE fehlende Datei. Ein Board kann auch
    // VORHANDEN und LEER sein (cohort-Arrays []) - die Familien-Pruefung darueber sieht die
    // Datei und ist zufrieden, findash liest ein leeres Board und meldet jede Zeile des
    // aelteren Stands als Abgang. Repro (Fall C, Review Tag 568): 3 Zeilen -> 0 Zeilen ging
    // still durch. Kollaps = im juengeren Stand 0 Zeilen UND im aelteren > 0; ein Board, das
    // in BEIDEN Staenden leer ist, ist kein Kollaps und geht bewusst durch.
    const kollaps = neu.files.filter((f) => zeilenJeVintage[i][f] === 0 && zeilenJeVintage[i - 1][f] > 0);
    if (kollaps.length) {
      throw new Error('Board(s) ohne eine einzige Zeile im juengeren Vintage ' + neu.date + ': '
        + kollaps.join(', ') + ' - im aelteren Stand ' + alt.date + ' waren sie gefuellt. Jede Zeile '
        + 'des aelteren Stands erschiene in der Bewegungs-Anzeige als Abgang. Erst die Ursache '
        + 'klaeren (Board-Lauf leer gelaufen?), nicht publizieren.');
    }
    if (dazu.length) {
      console.log('::warning::neue Board-Familie in ' + neu.date + ': ' + dazu.join(', ')
        + ' - kommt gegenueber ' + alt.date + ' dazu (kein Abgangs-Risiko, wird publiziert).');
    }
  }
  schreibeJson(path.join(zielBH, 'index.json'), {
    schema: 'board-history-publish/v1',
    generated_at: new Date().toISOString(),
    hinweis: 'Nur die juengsten Vintages, je Zeile nur ' + SLIM_FELDER.join('/') + ' - Quelle der Bewegungs-Anzeige (F-17a).',
    vintages,
  });
  return { vintages };
}

/**
 * @param {{ziel:string, earnings?:string, boardHistory?:string, vintages?:number}} opts
 */
function run(opts) {
  const o = opts || {};
  if (!o.ziel) throw new Error('--ziel fehlt');
  if (!o.earnings && !o.boardHistory) throw new Error('weder --earnings noch --board-history angegeben - nichts zu publizieren');
  const ergebnis = {};
  if (o.earnings) ergebnis.earnings = stageEarnings(o.earnings, o.ziel);
  if (o.boardHistory) ergebnis.boardHistory = stageBoardHistory(o.boardHistory, o.ziel, o.vintages || 2);
  return ergebnis;
}

function parseArgs(argv) {
  const o = { vintages: 2 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ziel') o.ziel = argv[++i];
    else if (argv[i] === '--earnings') o.earnings = argv[++i];
    else if (argv[i] === '--board-history') o.boardHistory = argv[++i];
    else if (argv[i] === '--vintages') o.vintages = Number(argv[++i]);
    else throw new Error('unbekanntes Argument: ' + argv[i]);
  }
  if (!Number.isInteger(o.vintages) || o.vintages < 1) throw new Error('--vintages muss eine ganze Zahl >= 1 sein');
  return o;
}

if (require.main === module) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const r = run(opts);
    if (r.earnings) console.log('earnings-calendar.json publiziert (' + r.earnings.bytes + ' Bytes)');
    if (r.boardHistory) console.log('board-history publiziert: ' + r.boardHistory.vintages.map((v) => v.date + ' (' + v.files.length + ' Boards)').join(', '));
  } catch (e) {
    console.log('::error::Datenkanal-Publish (F-17a) fehlgeschlagen: ' + (e && e.message || e)
      + ' - findash zeigt sonst nach der Pull-Abschaltung still nichts an.');
    process.exit(1);
  }
}

module.exports = { run, parseArgs, slimVintage, stageEarnings, stageBoardHistory };
