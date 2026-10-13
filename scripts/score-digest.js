#!/usr/bin/env node
/**
 * Score-Digest — der BELEG fuer "diese Aenderung ruehrt den Score nicht an".
 * ==========================================================================
 * Faehrt die PRODUKTIONS-Engine (scoreUniverse + produceRankings) gegen einen
 * Snapshot-Baum und verdichtet das Ergebnis zu drei SHA-256-Fingerabdruecken:
 *
 *   Score-Digest  je gescorte Zeile  ticker|formulaId|track|score (volle Praezision)
 *   Rang-Digest   je Board (volle Kohorten + Uebersicht) die Ticker in Rangfolge
 *   Gesamt-Digest ueber beide
 *
 * Aufruf:
 *   node scripts/score-digest.js <snapdir>
 *   node scripts/score-digest.js <snapdir> --selbsttest
 *
 * WARUM DER SELBSTTEST PFLICHT IST: ein Digest, der nie rot wird, beweist nichts.
 * --selbsttest fuehrt zwei Kontrollen aus, BEVOR eine Gleichheit als Beleg zaehlt:
 *   (1) Determinismus — zwei Laeufe ueber dieselben Snapshots muessen gleich sein
 *       (sonst misst der Digest Laufzeit-Rauschen statt Scoring).
 *   (2) Empfindlichkeit — EIN um 1 % veraenderter Umsatz eines einzigen Namens muss
 *       den Digest kippen (sonst wuerde er eine echte Score-Aenderung verschlucken).
 * Exit 1, wenn eine der beiden Kontrollen faellt.
 *
 * VERWENDUNG als Neutralitaets-Beleg: Digest auf dem Stand VOR der Aenderung nehmen,
 * Aenderung bauen, Digest erneut nehmen — gleicher Gesamt-Digest = Raenge UND Scores
 * byte-identisch. Der Snapshot-Baum muss dabei derselbe sein (er ist der Messstand).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scoreUniverse, produceRankings } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');
const { loadWatchlist } = require('../lib/watchlist-fs.js');
const { filterToAuthorizedUniverse, mergeSecIntoUniverse } = require('../src/scoring/run-screener.js');

const ROOT = path.join(__dirname, '..');

function alleJsonDateien(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) alleJsonDateien(p, out);
    else if (e.name.endsWith('.json') && !e.name.startsWith('_manifest') && e.name !== '_last_good_disk.json') out.push(p);
  }
  return out;
}

// Laedt den Baum EINMAL. mergeSecIntoUniverse haengt die tiefe SEC-Serie an — derselbe
// Weg wie run-screener.js, damit der Digest den Produktionslauf spiegelt (und nicht die
// flachere Yahoo-4J-Variante, auf der der Zyklus-Daempfer anders rechnet).
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

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// scoreUniverse haengt Felder an die Ergebniszeilen, nicht an die Snapshots — der
// Aufruf ist deshalb wiederholbar. Genau das prueft die Determinismus-Kontrolle.
function digest(universum) {
  const results = scoreUniverse(universum, formulas, {});
  const zeilen = [];
  for (const e of results) {
    if (e.action !== 'route' || !Number.isFinite(e.score)) continue;
    // String(score) ist der kuerzeste rundreise-treue Dezimalwert — keine Rundung,
    // die eine echte Score-Verschiebung wegglaetten koennte.
    zeilen.push(`${e.ticker}|${e.formulaId}|${e.track}|${String(e.score)}`);
  }
  zeilen.sort();
  const rank = produceRankings(results, { topN: 100 });
  const boards = [];
  for (const id of Object.keys(rank.full).sort()) {
    for (const track of Object.keys(rank.full[id]).sort()) {
      boards.push(`${id}|${track}\t` + rank.full[id][track].map((r) => r.ticker).join(','));
    }
  }
  boards.push('UEBERSICHT\t' + rank.overview.map((r) => r.ticker).join(','));
  const scoreDigest = sha(zeilen.join('\n'));
  const rangDigest = sha(boards.join('\n'));
  return {
    zeilen: zeilen.length,
    boards: boards.length,
    // Die tatsaechlich gescorten Ticker — die Empfindlichkeits-Probe MUSS einen davon
    // treffen. Ein beliebiger Snapshot aus dem Baum taugt nicht: der erste Name im
    // Baum (000001.SZ) ist eine Bank, wird ausgeschlossen und faerbt keinen Digest.
    geroutet: new Set(zeilen.map((z) => z.slice(0, z.indexOf('|')))),
    scoreDigest,
    rangDigest,
    gesamt: sha(scoreDigest + '\n' + rangDigest),
  };
}

function drucke(d, universum, dir) {
  console.log(`Snapshot-Baum : ${dir}`);
  console.log(`Universum     : ${universum.length} Snapshots, ${d.zeilen} gescorte Zeilen, ${d.boards} Boards`);
  console.log(`Score-Digest  : ${d.scoreDigest}`);
  console.log(`Rang-Digest   : ${d.rangDigest}`);
  console.log(`GESAMT-DIGEST : ${d.gesamt}`);
}

// Empfindlichkeits-Probe: EIN gescorter Name bekommt einen anderen Umsatz im juengsten Jahr.
//
// WARUM DER FAKTOR GROSS SEIN MUSS (nachgemessen 03.08.2026, nicht geschaetzt): der Score
// haengt nicht am Umsatz-NIVEAU, sondern am PERZENTILRANG innerhalb der Kohorte. Eine
// Stoerung, die keinen einzigen Nachbarn ueberholt, laesst den Perzentilrang — und damit
// den Score — EXAKT unveraendert. Mit +1 % blieb 000002.SZ auf Score 27.79523056853611,
// mit x1.5 sprang er auf 41.049183890117746. Ein 1 %-Probe haette den Digest also faelschlich
// als "unempfindlich" gemeldet. Deshalb: aufsteigende Faktoren, die Probe gilt, sobald der
// Digest kippt.
const STOER_FAKTOREN = [1.5, 3, 10];
function findeStoerbaren(universum, geroutet) {
  for (const s of universum) {
    if (!geroutet.has(s.meta.ticker)) continue;
    const a = s.annual && s.annual.annualRev;
    if (!Array.isArray(a)) continue;
    const erst = a.find((x) => x && typeof x === 'object' && Number.isFinite(x.value) && x.value > 0);
    if (!erst) continue;
    const alt = erst.value;
    return {
      ticker: s.meta.ticker,
      setze: (faktor) => { erst.value = alt * faktor; },
      zuruecksetzen: () => { erst.value = alt; },
    };
  }
  return null;
}

function main() {
  const dir = process.argv[2];
  const selbsttest = process.argv.includes('--selbsttest');
  if (!dir || !fs.existsSync(dir)) {
    console.error('Aufruf: node scripts/score-digest.js <snapdir> [--selbsttest]');
    process.exit(2);
  }
  const universum = ladeUniversum(dir);
  const a = digest(universum);
  drucke(a, universum, dir);
  if (!selbsttest) return;

  console.log('\n--- Selbsttest ---');
  const b = digest(universum);
  const deterministisch = b.gesamt === a.gesamt;
  console.log(`(1) Determinismus  : ${deterministisch ? 'OK' : 'FEHLER'} (zweiter Lauf ${b.gesamt})`);

  const stoerung = findeStoerbaren(universum, a.geroutet);
  if (!stoerung) {
    console.error('(2) Empfindlichkeit: FEHLER — kein stoerbarer Umsatz im Baum gefunden');
    process.exit(1);
  }
  let empfindlich = false, benutzterFaktor = null, gestoerterDigest = null;
  for (const faktor of STOER_FAKTOREN) {
    stoerung.setze(faktor);
    const c = digest(universum);
    benutzterFaktor = faktor;
    gestoerterDigest = c.gesamt;
    if (c.gesamt !== a.gesamt) { empfindlich = true; break; }
  }
  stoerung.zuruecksetzen();
  console.log(`(2) Empfindlichkeit: ${empfindlich ? 'OK' : 'FEHLER'} — ${stoerung.ticker} Umsatz x${benutzterFaktor} -> ${gestoerterDigest}`);

  const d = digest(universum);
  const reversibel = d.gesamt === a.gesamt;
  console.log(`(3) Ruecknahme     : ${reversibel ? 'OK' : 'FEHLER'} (nach Zuruecksetzen ${d.gesamt})`);

  if (!deterministisch || !empfindlich || !reversibel) {
    console.error('SELBSTTEST FEHLGESCHLAGEN — dieser Digest taugt nicht als Beleg.');
    process.exit(1);
  }
  console.log('Selbsttest bestanden: der Digest ist reproduzierbar UND wird bei einer echten Score-Aenderung rot.');
}

if (require.main === module) main();
module.exports = { ladeUniversum, digest };
