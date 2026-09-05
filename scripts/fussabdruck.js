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
  const bewegt = [];                       // [ticker, delta] - delta VORZEICHENBEHAFTET
  let maxAbs = 0, verglichen = 0, uebersprungen = 0;
  for (const t of Object.keys(basis)) {
    if (!(t in kandidat)) { uebersprungen++; continue; }
    if (!hashes[t]) { uebersprungen++; continue; }
    verglichen++;
    const a = basis[t], b = kandidat[t];
    if (a === b) continue;
    if (a === null || b === null) { bewegt.push([t, null]); maxAbs = Infinity; continue; }
    // Auf 4 Stellen runden: die Scores selbst sind einstellig gerundet, aber die Subtraktion
    // erzeugt Fliesskomma-Rauschen (56.2 - 50 = 6.199999999999999). Ohne Rundung wuerde der
    // Vektor-Hash bei bit-gleicher Wirkung zappeln und das Gate falsch-rot melden.
    const d = Math.round((b - a) * 1e4) / 1e4;
    bewegt.push([t, d]);
    if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
  }
  bewegt.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const ticker = bewegt.map((x) => x[0]);
  return {
    zeilenMitScoreAenderung: bewegt.length,
    // Gerichtsauflage 3 (23.08., Kriterium K5): eine ABSOLUTE Zeilenzahl waechst mit dem
    // Universum - dieselbe anteilige Wirkung ergibt morgen eine andere Zahl, und eine
    // Deklaration von heute wuerde rot, ohne dass jemand etwas geaendert hat. Der Anteil an den
    // tatsaechlich verglichenen Zeilen ist die universums-invariante Groesse. Die absolute Zahl
    // bleibt als Berichtswert erhalten; die Gate-Entscheidung vergleicht den Anteil.
    anteilBewegt: verglichen > 0 ? Math.round((bewegt.length / verglichen) * 1e6) / 1e6 : null,
    maxAbsDelta: Number.isFinite(maxAbs) ? Math.round(maxAbs * 100) / 100 : null,
    tickerListHash: sha(ticker.join(',')),
    // Gerichtsauflage 1 (23.08.): Anzahl, Maximum und Ticker-Liste sind KEINE hinreichende
    // Statistik - eine vollstaendige Vorzeichen-Umkehr passiert sie identisch (am Artefakt
    // reproduziert). Der Vektor-Hash traegt Richtung UND Verteilung.
    deltaVektorHash: sha(JSON.stringify(bewegt)),
    // Und die Namen im Klartext, nicht nur ihr Hash: ein Reviewer soll sehen, WELCHE Firmen
    // sich bewegen. Ein Hash allein macht die Deklaration zur Selbstbestaetigung (Einwand E4).
    bewegteTicker: ticker,
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

function abweichungenFuer(e, g) {
  const abweichungen = [];
  // Der Anteil entscheidet statt der absoluten Zeilenzahl: 2/10 und 4/20 sind dieselbe
  // proportionale Wirkung. deltaVektorHash bleibt Pflicht, weil Anteil, Maximum und
  // Ticker-Liste allein blind fuer Richtung und Verteilung sind.
  for (const k of ['anteilBewegt', 'maxAbsDelta', 'tickerListHash', 'deltaVektorHash']) {
    if (!(k in e)) { abweichungen.push(`${k}: nicht deklariert`); continue; }
    if (e[k] !== g[k]) abweichungen.push(`${k}: deklariert ${e[k]}, gemessen ${g[k]}`);
  }
  // Die Namen im Klartext werden exakt verglichen - und die Abweichung nennt die Firmen,
  // nicht nur ihre Zahl, sonst ist die Fehlermeldung wieder nur ein Hash.
  if (!Array.isArray(e.bewegteTicker)) {
    abweichungen.push('bewegteTicker: nicht deklariert (die Namen gehoeren in die Deklaration, nicht nur ihr Hash)');
  } else {
    const dekl = new Set(e.bewegteTicker), gem = new Set(g.bewegteTicker);
    const zuviel = [...gem].filter((t) => !dekl.has(t)).sort();
    const zuwenig = [...dekl].filter((t) => !gem.has(t)).sort();
    const kurz = (a) => (a.length > 12 ? a.slice(0, 12).join(', ') + ` … (+${a.length - 12})` : a.join(', '));
    if (zuviel.length) abweichungen.push(`bewegteTicker: ${zuviel.length} nicht deklariert -> ${kurz(zuviel)}`);
    if (zuwenig.length) abweichungen.push(`bewegteTicker: ${zuwenig.length} deklariert, aber unbewegt -> ${kurz(zuwenig)}`);
  }
  return abweichungen;
}

function pruefen(deklPfad, achse, faktor) {
  const d = JSON.parse(fs.readFileSync(deklPfad, 'utf8'));
  const m = messen(achse, faktor);
  const e = d.erwartet || {};
  return { ...m, deklariert: e, abweichungen: abweichungenFuer(e, m.gemessen) };
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

module.exports = { messen, pruefen, fussabdruck, abweichungenFuer };
