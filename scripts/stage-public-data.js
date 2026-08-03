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
 * @returns {{datei: string, bytes: number}}
 */
function stageEarnings(quelle, zielDir) {
  let text;
  try {
    text = fs.readFileSync(quelle, 'utf8');
  } catch (e) {
    throw new Error('earnings-calendar.json nicht lesbar (' + quelle + '): ' + (e && e.message || e));
  }
  try {
    JSON.parse(text);
  } catch (e) {
    throw new Error('earnings-calendar.json ist kein gueltiges JSON (' + quelle + '): ' + (e && e.message || e));
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
    console.log('::warning::board-history hat nur ' + alle.length + ' Vintage(s), ' + anzahl
      + ' angefordert - die Bewegungs-Anzeige bleibt leer, bis zwei Staende vorliegen.');
  }
  const gewaehlt = alle.slice(-anzahl);
  const zielBH = path.join(zielDir, 'board-history');
  fs.rmSync(zielBH, { recursive: true, force: true }); // nie Reste eines frueheren Laufs mitpublizieren
  const vintages = [];
  for (const date of gewaehlt) {
    const dir = path.join(quellDir, date);
    const dateien = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
    const geschrieben = [];
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
    }
    if (geschrieben.length === 0) throw new Error('kein Board im Vintage ' + date + ' - nur Sidecars, das ist ein Defekt');
    vintages.push({ date, files: geschrieben });
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
