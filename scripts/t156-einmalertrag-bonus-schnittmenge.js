#!/usr/bin/env node
/**
 * T156 - Zaehl-Lauf: Einmalertrags-Lampe x Wachstums-Bonus auf EINGEFRORENEM Boden.
 * ================================================================================
 * DIE FRAGE (Rat W1, _RAT-VIER-WEICHEN-2026-08-25.md): der Rat priorisiert nach
 * "20 Zeilen, in denen Lampe und Bonus sich gegenseitig aufheben, 19 davon wechseln
 * den Rang". T156 verlangt dreierlei, bevor die Score-Semantik festgezurrt wird:
 *   (1) die 20 Faelle sichten und die Falsch-Positiv-Rate beziffern,
 *   (2) die Provenienz der Zahl 20/19 pruefen (eingefrorenes Universum? sonst
 *       vermengt sie Code-, Daten- und Kohortenwirkung),
 *   (3) die NIE GEZAEHLTE Gegenrichtung: Zeilen, in denen der Bonus feuert und die
 *       Lampe haette feuern muessen - die 20 sind die Schnittmenge, nicht die Population.
 *
 * WAS DIESES SKRIPT TUT: einen Zaehl-Lauf, sonst nichts. Es faehrt die PRODUKTIONS-
 * Engine (scoreUniverse) EINMAL ueber EINEN Snapshot-Baum - ein CI-Artefakt eines
 * einzelnen Laufs, also ein Universum zu EINEM Zeitpunkt unter EINEM Codestand.
 * Genau das ist der eingefrorene Boden, den T156 Teil 2 verlangt: nicht ein ueber
 * Wochen gewachsener lokaler Bestand, dessen Zeilen aus verschiedenen Laeufen stammen.
 *
 * ES ENTSCHEIDET NICHTS. Keine Schwelle wird gesetzt, keine Semantik gewaehlt,
 * `src/scoring/` wird nur GELESEN. Die Zellen der Kreuztabelle stehen vorab fest
 * (keine nachtraegliche Zellensuche).
 *
 * Aufruf: node scripts/t156-einmalertrag-bonus-schnittmenge.js <snapdir> [--json <datei>]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { scoreUniverse } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');
const { einmalertragBewertbarkeit } = require('../src/scoring/lamps.js');
const { norm } = require('../src/scoring/snapshot.js');
const { loadWatchlist } = require('../lib/watchlist-fs.js');
const { filterToAuthorizedUniverse, mergeSecIntoUniverse } = require('../src/scoring/run-screener.js');

const ROOT = path.join(__dirname, '..');
// Dieselbe Konstante wie die Lampe (lamps.js:622). Bewusst als Zahl gespiegelt statt
// importiert: sie ist dort nicht exportiert, und ein Export haette eine Aenderung in
// der Sperrzone src/scoring/ verlangt. Der Waechter prueft die Spiegelung am Verhalten
// der echten Lampe, nicht am Zahlenwert (tests/t156-schnittmenge-*.test.js).
const ANTEIL = 0.50;

function alleJsonDateien(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) alleJsonDateien(p, out);
    else if (e.name.endsWith('.json') && !e.name.startsWith('_manifest') && e.name !== '_last_good_disk.json') out.push(p);
  }
  return out;
}

// Derselbe Ladeweg wie scripts/score-digest.js (und damit wie der Produktionslauf):
// Watchlist-Filter + SEC-Merge, sonst rechnet der Zyklus-Daempfer auf einer flacheren
// Reihe als im echten Lauf.
function ladeUniversum(dir) {
  const u = [];
  for (const f of alleJsonDateien(dir)) {
    let s;
    try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { continue; }
    if (s && s.meta && s.meta.ticker) u.push(s);
  }
  const wl = loadWatchlist(path.join(ROOT, 'watchlist.json'));
  if (wl.error) throw new Error('watchlist.json nicht ladbar: ' + wl.error);
  const { filtered } = filterToAuthorizedUniverse(u, wl.stocks);
  mergeSecIntoUniverse(filtered);
  return filtered;
}

// Rohe Spitzen-Konzentration der vier juengsten Quartale - der GEMEINSAME Rohbefund,
// auf dem die Lampe aufsetzt, BEVOR ihre drei Entlastungen (Kadenz, Anlauf, Saison)
// greifen. Ohne diese Groesse ist Teil 3 nicht zaehlbar: "haette feuern muessen"
// heisst "Spitze da, Lampe schweigt trotzdem".
function konzentration(s) {
  const letzte4 = norm(s, 'revenueQ').slice(0, 4);
  if (letzte4.length < 4 || !letzte4.every((v) => Number.isFinite(v) && v > 0)) return null;
  const summe = letzte4.reduce((a, b) => a + b, 0);
  if (!(summe > 0)) return null;
  return { anteil: Math.max(...letzte4) / summe, letzte4 };
}

// Warum schweigt die Lampe, obwohl die Spitze da ist? Die Reihenfolge spiegelt die
// Pruefreihenfolge in lamps.js:628 ff. - Bewertbarkeit zuerst, dann Anlauf, dann Saison
// als Rest. 'saisonOderRest' ist bewusst nicht feiner aufgeloest: eine feinere Zerlegung
// wuerde die Saison-Logik hier ein zweites Mal nachbauen (Drift-Risiko), und fuer die
// Zaehlung der Gegenrichtung traegt die Unterscheidung nichts.
function schweigegrund(s) {
  const b = einmalertragBewertbarkeit(s);
  if (b) return b;                                     // zuWenigQuartale | ungleicheKadenz
  const k = konzentration(s);
  if (!k) return 'keineReihe';
  const altZuNeu = [...k.letzte4].reverse();
  if (altZuNeu.every((v, i) => i === 0 || v >= altZuNeu[i - 1])) return 'anlaufSchutz';
  return 'saisonOderRest';
}

function messen(universum) {
  // scoreUniverse loescht e.snapshot am Ende jedes Laufs (score.js:1359) - ohne eigene
  // Karte lieferte jede Lampen-Abfrage danach STILL 'nicht bewertbar' fuer das gesamte
  // Universum (im ersten Lauf dieses Skripts genau so passiert: 9.520 von 9.520).
  // Deshalb die Snapshots VOR dem Scoren an den Ticker binden; die Lampen-Zustaende
  // selbst kommen aus dem Lauf (e.lamps / e.einmalertragBewertbarkeit), nicht aus einer
  // zweiten Auswertung.
  const snapVonTicker = new Map();
  for (const s of universum) if (s && s.meta && s.meta.ticker) snapVonTicker.set(s.meta.ticker, s);
  const results = scoreUniverse(universum, formulas, {});
  const zellen = { lampeAn_bonusAn: [], lampeAn_bonusAus: [], lampeNull_bonusAn: [], lampeAus_bonusAn: [] };
  const gegenrichtung = {};   // Schweigegrund -> Faelle (Bonus an, Spitze >= ANTEIL, Lampe nicht an)
  let gescort = 0, bonusAn = 0, lampeAn = 0, lampeNull = 0;

  for (const e of results) {
    if (e.action !== 'route' || !Number.isFinite(e.score)) continue;
    gescort++;
    const bonus = Number.isFinite(e._factorGrowth) ? e._factorGrowth : 1;
    const s = snapVonTicker.get(e.ticker) || null;
    // Drei-Wege-Zustand der Lampe AUS DEM LAUF: true = in e.lamps, null = Bewertbarkeits-
    // grund gesetzt, sonst false. Ein zweiter einmalertrag()-Aufruf waere eine zweite
    // Messung derselben Sache und koennte von der Board-Zeile abweichen.
    const l = (Array.isArray(e.lamps) && e.lamps.includes('einmalertrag')) ? true
      : (e.einmalertragBewertbarkeit ? null : false);
    if (bonus > 1) bonusAn++;
    if (l === true) lampeAn++;
    if (l === null) lampeNull++;
    const zeile = { ticker: e.ticker, kohorte: e.formulaId + '|' + e.track, score: e.score, bonus };
    if (l === true && bonus > 1) zellen.lampeAn_bonusAn.push(zeile);
    else if (l === true) zellen.lampeAn_bonusAus.push(zeile);
    else if (bonus > 1 && l === null) zellen.lampeNull_bonusAn.push(zeile);
    else if (bonus > 1 && l === false) zellen.lampeAus_bonusAn.push(zeile);

    if (bonus > 1 && l !== true) {
      const k = s ? konzentration(s) : null;
      const roh = k ? k.anteil : null;
      const fall = { ticker: e.ticker, kohorte: e.formulaId + '|' + e.track, anteil: roh === null ? null : Number(roh.toFixed(4)), bonus };
      // 'zuWenigQuartale' hat per Definition keine rechenbare Konzentration -> eigene Zeile,
      // aber NICHT als "haette feuern muessen" gezaehlt: dort ist nichts zu urteilen.
      if (roh !== null && roh >= ANTEIL) (gegenrichtung[s ? schweigegrund(s) : 'keinSnapshot'] ||= []).push(fall);
      else if (e.einmalertragBewertbarkeit === 'zuWenigQuartale') (gegenrichtung.zuWenigQuartale_ohneMessung ||= []).push(fall);
    }
  }

  const sortT = (a) => a.sort((x, y) => (x.ticker < y.ticker ? -1 : x.ticker > y.ticker ? 1 : 0));
  for (const k of Object.keys(zellen)) sortT(zellen[k]);
  for (const k of Object.keys(gegenrichtung)) sortT(gegenrichtung[k]);

  return {
    schema: 't156-zaehllauf/v1',
    gescorteZeilen: gescort,
    bonusAktiv: bonusAn,
    lampeAn,
    lampeNichtBewertbar: lampeNull,
    schnittmenge_lampeAn_bonusAn: zellen.lampeAn_bonusAn.length,
    zellen: {
      lampeAn_bonusAn: zellen.lampeAn_bonusAn,
      lampeAn_bonusAus: zellen.lampeAn_bonusAus.map((z) => z.ticker),
      lampeNull_bonusAn: zellen.lampeNull_bonusAn.length,
      lampeAus_bonusAn: zellen.lampeAus_bonusAn.length,
    },
    gegenrichtung_bonusAn_spitzeVorhanden_lampeSchweigt: Object.fromEntries(
      Object.entries(gegenrichtung).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => [k, { n: v.length, faelle: v }])),
  };
}

// Bindet die NICHT-Snapshot-Eingaben an eine nachpruefbare Version. Faellt git aus,
// wird nicht geraten: das Feld sagt dann 'unbekannt' statt eine Zahl zu erfinden.
function eingabenStand() {
  const g = (args) => {
    try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); }
    catch (_) { return null; }
  };
  const wl = path.join(ROOT, 'watchlist.json');
  return {
    repoCommit: g(['rev-parse', 'HEAD']) || 'unbekannt',
    arbeitsbaumSauber: g(['status', '--porcelain']) === '' ? true : (g(['status', '--porcelain']) === null ? 'unbekannt' : false),
    watchlistSha256: fs.existsSync(wl) ? crypto.createHash('sha256').update(fs.readFileSync(wl)).digest('hex').slice(0, 16) : null,
    hinweis: 'watchlist.json und external-data/** sind git-versioniert; repoCommit bindet sie.',
  };
}

function main() {
  const dir = process.argv[2];
  if (!dir) { console.error('Aufruf: node scripts/t156-einmalertrag-bonus-schnittmenge.js <snapdir> [--json <datei>]'); process.exit(2); }
  const jsonIdx = process.argv.indexOf('--json');
  const universum = ladeUniversum(dir);
  const bericht = messen(universum);
  bericht.snapdir = path.resolve(dir);
  bericht.snapshotDateien = alleJsonDateien(dir).length;
  bericht.universumNachWatchlist = universum.length;
  // Der Snapshot-Baum ist nicht die einzige Eingabe: watchlist.json (Universums-Filter) und
  // external-data/** (SEC-Merge) werden LIVE gelesen und veraendern Universum bzw. Scores,
  // ohne dass sich der Baum bewegt. Beide sind git-versioniert - der Commit bindet sie also,
  // solange er im Bericht steht. Zusaetzlich der Hash der Watchlist, damit ein Lauf aus einem
  // schmutzigen Arbeitsbaum auffaellt. (Codex-Kreuzreview 19.09., P2)
  bericht.codeStand = eingabenStand();
  if (jsonIdx > 0 && process.argv[jsonIdx + 1]) {
    fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(bericht, null, 2) + '\n');
  }
  const kurz = { ...bericht };
  kurz.gegenrichtung_bonusAn_spitzeVorhanden_lampeSchweigt = Object.fromEntries(
    Object.entries(bericht.gegenrichtung_bonusAn_spitzeVorhanden_lampeSchweigt).map(([k, v]) => [k, v.n]));
  kurz.zellen = { ...kurz.zellen, lampeAn_bonusAn: kurz.zellen.lampeAn_bonusAn.map((z) => z.ticker) };
  console.log(JSON.stringify(kurz, null, 2));
}

if (require.main === module) main();
module.exports = { konzentration, schweigegrund, messen, ANTEIL };
