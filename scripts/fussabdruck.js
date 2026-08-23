#!/usr/bin/env node
/**
 * Fussabdruck-Messung - PROTOTYP als Beweismittel fuer den Court-Fall B3.
 *
 * NICHT die Bless-Regel selbst. Dieses Skript beantwortet die eine Frage, die das Gericht
 * nach Rubrik K2/K3 gestellt bekommt: laesst sich der Fussabdruck einer Score-Aenderung
 * ueberhaupt messen, kann das Gate rot werden, und zwar IN BEIDE RICHTUNGEN?
 *
 * Wie der Vergleich sauber bleibt (K3):
 *   - Beide Laeufe scoren gegen DASSELBE eingefrorene Lineal (refCalibration).
 *   - Verglichen werden nur Zeilen, deren `inputHash` in beiden Laeufen identisch ist.
 *     Heute ist das trivial (ein Universum, zwei Formelstaende); die Maschinerie zaehlt,
 *     sobald die beiden Laeufe an verschiedenen Tagen stattfinden - dann trennt sie
 *     Code-Wirkung von Daten-Drift, statt beides in einer Zahl zu vermengen.
 *
 * Wie "alter vs. neuer Code" simuliert wird, OHNE das Siegel zu beruehren:
 *   scoreUniverse(universe, formulas, opts) nimmt die Formeln als ARGUMENT. Der
 *   Kandidaten-Lauf bekommt eine tiefe Kopie mit genau einer geaenderten Achsen-Gewichtung.
 *   Kein Byte unter src/scoring/ wird geschrieben - die Mutation lebt im Speicher.
 *
 * Aufruf:
 *   node scripts/fussabdruck.js --messen --achse gpGrowth --faktor 1.10
 *   node scripts/fussabdruck.js --pruefen <deklaration.json> --achse gpGrowth --faktor 1.10
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { scoreUniverse } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');
const { inputHash } = require('../lib/input-hash.js');

const REPO = path.resolve(__dirname, '..');
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex').slice(0, 16);
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };

function ladeUniversum() {
  const dir = process.env.SCREENER_SNAPSHOTS_DIR || path.join(REPO, 'snapshots');
  const u = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !isMetadataSnapshot(x))) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (s && s.meta && s.meta.ticker) u.push(s);
    } catch (_) { /* unlesbarer Snapshot zaehlt nicht zum Universum */ }
  }
  return u;
}

/** Tiefe Kopie der Formeln mit genau EINER geaenderten Achsen-Gewichtung. */
function mutiereFormeln(achse, faktor) {
  const kopie = JSON.parse(JSON.stringify(formulas));
  let getroffen = 0;
  for (const f of Object.values(kopie)) {
    if (!f || !Array.isArray(f.axes)) continue;
    for (const ax of f.axes) {
      if (ax.key !== achse || !ax.w) continue;
      for (const track of Object.keys(ax.w)) { ax.w[track] = ax.w[track] * faktor; getroffen++; }
    }
  }
  if (!getroffen) throw new Error(`Achse "${achse}" in keiner Formel gefunden - Mutation waere ein No-Op.`);
  return { kopie, getroffen };
}

function scoresVon(ergebnisse) {
  const m = {};
  for (const e of ergebnisse) if (e && e.ticker && e.action === 'route') m[e.ticker] = e.score;
  return m;
}

/**
 * Der Fussabdruck. Nur Zeilen mit identischem inputHash zaehlen - der Rest ist per
 * Konstruktion nicht dem Code zuzurechnen.
 */
function fussabdruck(basis, kandidat, hashes) {
  const bewegt = [];
  let maxAbs = 0, verglichen = 0, uebersprungen = 0;
  for (const t of Object.keys(basis)) {
    if (!(t in kandidat)) { uebersprungen++; continue; }
    if (!hashes[t]) { uebersprungen++; continue; }
    verglichen++;
    const a = basis[t], b = kandidat[t];
    if (a === b) continue;
    if (a === null || b === null) { bewegt.push(t); maxAbs = Infinity; continue; }
    bewegt.push(t);
    const d = Math.abs(b - a);
    if (d > maxAbs) maxAbs = d;
  }
  bewegt.sort();
  return {
    zeilenMitScoreAenderung: bewegt.length,
    maxAbsDelta: Number.isFinite(maxAbs) ? Math.round(maxAbs * 100) / 100 : null,
    tickerListHash: sha(bewegt.join(',')),
    verglichen, uebersprungen,
  };
}

function messen(achse, faktor) {
  const universum = ladeUniversum();
  if (universum.length < 100) throw new Error(`Universum zu klein (${universum.length}) - ohne Substrat keine Messung. Skip ist nicht Pass.`);
  const hashes = {};
  for (const s of universum) hashes[s.meta.ticker] = inputHash(s).gesamt;

  // ALLE Laeufe gegen dasselbe eingefrorene Lineal-ARTEFAKT. Bewusst nicht das live
  // gelernte `calibrationLive`: das ist ein Teil-Objekt ohne winsorBounds, und ein
  // live-lernender Basis-Lauf haette ohnehin sein eigenes Lineal - dann misst der
  // Vergleich Lineal- statt Code-Wirkung. Genommen wird die Datei, die im Betrieb
  // ueber SCORING_REF_CALIB eingehaengt wird.
  const linealPfad = process.env.SCORING_REF_CALIB
    || path.join(REPO, 'board-history', '2026-08-19', 'calibration.json');
  const lineal = JSON.parse(fs.readFileSync(linealPfad, 'utf8'));
  const basisLauf = scoreUniverse(universum, formulas, { refCalibration: lineal });
  const { kopie, getroffen } = mutiereFormeln(achse, faktor);
  const kandLauf = scoreUniverse(universum, kopie, { refCalibration: lineal });
  // Kontrolle: derselbe Formelstand gegen dasselbe eingefrorene Lineal muss den LEEREN
  // Fussabdruck liefern. Tut er das nicht, misst der Aufbau sich selbst.
  const kontrolle = scoreUniverse(universum, formulas, { refCalibration: lineal });

  return {
    universum: universum.length, achsenTreffer: getroffen, achse, faktor,
    linealHash: sha(JSON.stringify(lineal)), linealPfad: path.relative(REPO, linealPfad),
    leerprobe: fussabdruck(scoresVon(basisLauf), scoresVon(kontrolle), hashes),
    gemessen: fussabdruck(scoresVon(basisLauf), scoresVon(kandLauf), hashes),
  };
}

function pruefen(deklPfad, achse, faktor) {
  const d = JSON.parse(fs.readFileSync(deklPfad, 'utf8'));
  const m = messen(achse, faktor);
  const e = d.erwartet || {};
  const g = m.gemessen;
  const abweichungen = [];
  for (const k of ['zeilenMitScoreAenderung', 'maxAbsDelta', 'tickerListHash']) {
    if (!(k in e)) { abweichungen.push(`${k}: nicht deklariert`); continue; }
    if (e[k] !== g[k]) abweichungen.push(`${k}: deklariert ${e[k]}, gemessen ${g[k]}`);
  }
  return { ...m, deklariert: e, abweichungen };
}

if (require.main === module) {
  const achse = arg('--achse', 'gpGrowth');
  const faktor = Number(arg('--faktor', '1.10'));
  try {
    if (process.argv.includes('--pruefen')) {
      const r = pruefen(arg('--pruefen'), achse, faktor);
      console.log(JSON.stringify(r, null, 1));
      if (r.leerprobe.zeilenMitScoreAenderung !== 0) {
        console.error('::error::Leerprobe nicht leer - der Messaufbau selbst bewegt Scores. Ergebnis ungueltig.');
        process.exit(2);
      }
      if (r.abweichungen.length) {
        console.error('::error::Fussabdruck weicht von der Deklaration ab:\n  - ' + r.abweichungen.join('\n  - '));
        process.exit(1);
      }
      console.log('Fussabdruck entspricht der Deklaration.');
      process.exit(0);
    }
    console.log(JSON.stringify(messen(achse, faktor), null, 1));
  } catch (err) {
    console.error('::error::' + err.message);
    process.exit(2);
  }
}

module.exports = { messen, pruefen, fussabdruck };
