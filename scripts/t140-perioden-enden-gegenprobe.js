#!/usr/bin/env node
'use strict';
/**
 * t140-perioden-enden-gegenprobe.js — misst die Kipp-Bedingung von T140 ueber
 * benachbarte board-history-Vintages.
 *
 * T140 fragt: "729 Zeilen mit veraenderten Perioden-Enddaten, aber nur 493 mit
 * veraenderten Umsatzwerten — mindestens 236 Zeilen tragen dieselben Zahlen unter
 * einem anderen Datum. Entweder legitime Neu-Etikettierung durch den Provider oder
 * ein Ausrichtungsfehler."
 *
 * Die BEANTWORTUNG vom 28.08. hat eine Kipp-Bedingung hinterlassen:
 *   "ein `Array -> Array` mit geaendertem Datum und identischen Werten — aktuell 0 von 729."
 * Genau die zaehlt dieses Skript, Vintage-Paar fuer Vintage-Paar.
 *
 * MESSEBENE, und warum diese (der Punkt, an dem der Versuch vom 31.08. scheiterte):
 * gemessen wird auf `board-history/<datum>/<board>.json`, Block `cohort.*[].pit` —
 * dort liegen `revenueQ`/`revenueQEnds` und `grossProfitQ`/`grossProfitQEnds`
 * nebeneinander. `findash-export/v1` traegt die Perioden-Enden NICHT; wer dort misst,
 * misst die falsche Ebene und bekommt (korrekt) null Treffer auf einer Frage, die dort
 * gar nicht gestellt werden kann.
 *
 * KLASSEN je Zeile (Schluessel board|ticker, nur in BEIDEN Staenden vorhandene Zeilen):
 *   nullToArr  Enden gab es vorher gar nicht  -> Feldeinfuehrung/Nachzug, kein Befund
 *   arrToNull  Enden verschwinden             -> Gewinnerwechsel/Abdeckungsverlust
 *   arrArr     Enden geaendert, beide Arrays  -> der einzige Kandidatenraum fuer T140
 *     davon kipp      Werte BYTE-IDENTISCH und nicht durchgehend 0/null  <- DER BEFUND
 *     davon kippZero  Werte byte-identisch, aber die ganze Reihe ist 0/null
 *                     -> keine Neu-Etikettierung, sondern eine INHALTSLOSE Reihe, die
 *                        mit dem Quartalsfenster mitwandert (Klasse "Anwesenheit statt
 *                        Inhalt", dieselbe wie T134/T142). Getrennt gezaehlt, weil sie
 *                        sonst 723 falsche Treffer in die Kipp-Bedingung traegt.
 *     Rest            Werte aendern sich mit  -> normaler Quartals-Rollover
 *
 * Aufruf:
 *   node scripts/t140-perioden-enden-gegenprobe.js                 # alle Nachbarpaare
 *   node scripts/t140-perioden-enden-gegenprobe.js 2026-08-07 2026-08-09
 *   ... --track-gebunden --ohne-survival   # reproduziert T140s 8.313/729/493 exakt
 *   ... --json <datei>                                             # Rohbefund schreiben
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'board-history');
const REIHEN = [['revenueQEnds', 'revenueQ'], ['grossProfitQEnds', 'grossProfitQ']];

// BEWUSST KEINE Namensliste ausgelassener Dateien. Die erste Fassung fuehrte
// ['calibration.json','regime.json','survival.json'] mit dem Kommentar "tragen kein
// cohort" — fuer survival.json ist das FALSCH (board-history/2026-08-07/survival.json
// hat eine, Fund des Gegenmotors), und die Liste hat 24 Boards still aus der Messung
// genommen. Das einzige ehrliche Kriterium ist die Sache selbst: hat die Datei ein
// `cohort`, wird sie gemessen. Wer hier wieder einen Dateinamen eintraegt, baut den
// Fehler nach.

/** Eine Reihe ist inhaltslos, wenn kein einziger Wert von 0/null verschieden ist. */
function inhaltslos(reihe) {
  if (!Array.isArray(reihe) || reihe.length === 0) return true;
  return !reihe.some((x) => x !== 0 && x !== null && x !== undefined);
}

/**
 * Vintage -> Map('board|ticker' -> pit). Kaputtes JSON wirft, statt still zu fehlen.
 *
 * `trackGebunden` nimmt den Track (profitable/unprofitable) in den Schluessel auf. Dann
 * faellt eine Zeile, die den Track gewechselt hat, aus dem Vergleich — und genau damit
 * reproduziert sich der Ursprungsbefund von T140 EXAKT (8.313 gemeinsame Zeilen,
 * 729 Enden, 493 Werte). Das ist der Beleg, dass diese Messebene die des Befunds ist.
 * Default ist ungebunden: ein Trackwechsel ist keine Aenderung der Perioden-Enden, und
 * die Zeile soll deshalb im Vergleich bleiben.
 */
function ladeVintage(dir, trackGebunden = false, ohneSurvival = false) {
  const m = new Map();
  for (const datei of fs.readdirSync(dir).sort()) {
    if (!datei.endsWith('.json')) continue;
    if (ohneSurvival && datei === 'survival.json') continue;
    const p = path.join(dir, datei);
    let j;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (err) { throw new Error('Board-Datei nicht lesbar: ' + p + ' — ' + err.message); }
    if (!j || !j.cohort) continue;
    const board = j.board || datei.replace(/\.json$/, '');
    for (const [trackName, track] of Object.entries(j.cohort)) {
      for (const r of Object.values(track)) {
        if (!r || !r.ticker) continue;
        m.set(board + '|' + (trackGebunden ? trackName + '|' : '') + r.ticker, r.pit || {});
      }
    }
  }
  return m;
}

/** Der Klassierer. Exportiert, damit der Waechter ihn ohne Vintages pruefen kann. */
function vergleiche(alt, neu) {
  const S = JSON.stringify;
  const rec = { gemeinsam: 0 };
  for (const [endenFeld, werteFeld] of REIHEN) {
    const z = { endenGeaendert: 0, werteGeaendert: 0, nullToArr: 0, arrToNull: 0, arrArr: 0, kipp: 0, kippZero: 0, kippZeilen: [] };
    for (const [k, a] of alt) {
      const b = neu.get(k);
      if (!b) continue;
      if (endenFeld === REIHEN[0][0]) rec.gemeinsam++;
      const ea = a[endenFeld], eb = b[endenFeld];
      const eDiff = S(ea === undefined ? null : ea) !== S(eb === undefined ? null : eb);
      const vDiff = S(a[werteFeld] === undefined ? null : a[werteFeld]) !== S(b[werteFeld] === undefined ? null : b[werteFeld]);
      if (eDiff) z.endenGeaendert++;
      if (vDiff) z.werteGeaendert++;
      if (!eDiff) continue;
      if (!Array.isArray(ea) && Array.isArray(eb)) { z.nullToArr++; continue; }
      if (Array.isArray(ea) && !Array.isArray(eb)) { z.arrToNull++; continue; }
      if (!Array.isArray(ea) || !Array.isArray(eb)) continue;
      z.arrArr++;
      if (vDiff) continue;
      if (inhaltslos(a[werteFeld])) { z.kippZero++; continue; }
      z.kipp++;
      if (z.kippZeilen.length < 25) z.kippZeilen.push({ zeile: k, von: ea, nach: eb, werte: a[werteFeld] });
    }
    rec[endenFeld] = z;
  }
  return rec;
}

/**
 * Paare, bei denen NICHTS verglichen wurde. Eigene Funktion, damit der Waechter die
 * Bedingung pruefen kann, ohne ein Vintage-Verzeichnis zu brauchen.
 */
function paareOhneVergleich(befund) {
  return befund.filter((r) => r.gemeinsam === 0).map((r) => r.paar);
}

function vintages() {
  return fs.readdirSync(ROOT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
}

function main(argv) {
  const jsonIdx = argv.indexOf('--json');
  const jsonZiel = jsonIdx >= 0 ? argv[jsonIdx + 1] : null;
  const daten = argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const alle = vintages();
  const paare = daten.length === 2 ? [[daten[0], daten[1]]] : alle.slice(0, -1).map((d, i) => [d, alle[i + 1]]);
  if (paare.length === 0) { console.error('::error::keine Vintage-Paare in ' + ROOT); return 1; }

  const trackGebunden = argv.includes('--track-gebunden');
  const ohneSurvival = argv.includes('--ohne-survival');
  const befund = [];
  let kippGesamt = 0, kippZeroGesamt = 0;
  for (const [a, b] of paare) {
    const rec = vergleiche(ladeVintage(path.join(ROOT, a), trackGebunden, ohneSurvival), ladeVintage(path.join(ROOT, b), trackGebunden, ohneSurvival));
    rec.paar = a + '->' + b;
    befund.push(rec);
    for (const [endenFeld] of REIHEN) { kippGesamt += rec[endenFeld].kipp; kippZeroGesamt += rec[endenFeld].kippZero; }
    const r = rec.revenueQEnds, g = rec.grossProfitQEnds;
    console.log(`${rec.paar}  gemeinsam ${rec.gemeinsam}`);
    console.log(`  revenueQ     Enden ${r.endenGeaendert}  Werte ${r.werteGeaendert}  | null->arr ${r.nullToArr}  arr->null ${r.arrToNull}  arr->arr ${r.arrArr}  KIPP ${r.kipp}  (inhaltslos ${r.kippZero})`);
    console.log(`  grossProfitQ Enden ${g.endenGeaendert}  Werte ${g.werteGeaendert}  | null->arr ${g.nullToArr}  arr->null ${g.arrToNull}  arr->arr ${g.arrArr}  KIPP ${g.kipp}  (inhaltslos ${g.kippZero})`);
  }
  // "0 Treffer auf 0 verglichenen Zeilen" sieht genauso gruen aus wie "0 Treffer auf
  // 208.983" — das ist die Skip-ist-nicht-Pass-Klasse (T147), und sie waere hier besonders
  // teuer, weil das Ergebnis dieses Skripts eine NEGATIVE Aussage ist. Ein Paar ohne
  // gemeinsame Zeilen (falscher Pfad, leeres Vintage, Schluessel-Schema geaendert) ist
  // deshalb ein harter Fehler, kein stilles 0.
  const ohneVergleich = paareOhneVergleich(befund);
  if (ohneVergleich.length) {
    console.error('::error::' + ohneVergleich.length + ' Paar(e) ohne eine einzige gemeinsame Zeile — '
      + 'die Messung hat dort NICHTS verglichen und ihr "0 Treffer" bedeutet nichts: ' + ohneVergleich.join(', '));
    return 1;
  }
  console.log(`\nKipp-Bedingung T140 ueber ${paare.length} Paar(e): ${kippGesamt} echte Treffer, ${kippZeroGesamt} inhaltslose Reihen (nicht gezaehlt).`);
  if (jsonZiel) { fs.writeFileSync(jsonZiel, JSON.stringify(befund, null, 1)); console.log('Rohbefund: ' + jsonZiel); }
  // Exit 0 auch bei KIPP-Treffern: das hier ist ein MESSWERKZEUG, kein Tor. Wer es zum
  // Tor machen will, prueft `kipp` im Rohbefund — dann steht die Schwelle dort, wo sie
  // begruendet wird, und nicht still in einem Messskript. Exit 1 gibt es nur, wenn die
  // MESSUNG selbst nicht stattgefunden hat (oben).
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { vergleiche, ladeVintage, inhaltslos, paareOhneVergleich };
