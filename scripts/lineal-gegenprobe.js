#!/usr/bin/env node
/**
 * Lineal-Gegenprobe - trennt Lineal-Bewegung von Eingangs-Bewegung zwischen zwei Board-Vintages.
 *
 * Warum es das gibt (Rat 23.08., Kipp-Bedingung der Weichen B1/B2): zwischen zwei Tagesstaenden
 * bewegen sich fast alle Raenge, ohne dass sich eine Firma geaendert haette. Zwei Erklaerungen
 * konkurrierten - (a) das Lineal lernt taeglich neu (Feldbewegung, entworfene Eigenschaft) oder
 * (b) ein Determinismus-Defekt. Die Diskussion konnte das nicht entscheiden, eine Messung schon.
 *
 * Wie es misst - ohne Neu-Lauf, allein am eingecheckten Artefakt:
 *   1. Zeilen waehlen, deren FUNDAMENTALE PIT-Felder byte-identisch sind (Kurs/Marktwert bleiben
 *      aussen vor: axes.js liest kein einziges Kursfeld - nachgeprueft, kein marketCap/evSales/
 *      priceSales/beta im Modul).
 *   2. Den Rohwert je Achse aus dem SPAETEREN Lineal zurueckgewinnen (Perzentil-Inversion). Die
 *      Basis enthaelt den eigenen Rohwert der Zeile, deshalb ist die Inversion exakt und nicht
 *      genaehert; mehrdeutige Faelle werden verworfen statt geraten.
 *   3. Denselben Rohwert gegen das FRUEHERE (eingefrorene) Lineal perzentilieren.
 *   4. Mit dem tatsaechlich beobachteten frueheren Perzentil vergleichen.
 *
 * Deckt sich beides, war der Eingang unveraendert und die gesamte Bewegung stammt vom Lineal.
 * Weicht es ab, hat sich etwas bewegt, das im Vintage NICHT aufgezeichnet ist.
 *
 * Schranken-freie vs. schranken-behaftete Achsen: vier Achsen bekommen die Winsor-/Wachstums-
 * schranken des Tages als Argument (revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory)
 * - bei ihnen aendert das Lineal den ROHWERT selbst, was diese Inversion nicht modelliert. Nur
 * die schranken-freien Achsen (gpGrowth, dilution, marginLevel) tragen deshalb die exakte
 * Aussage; die uebrigen werden getrennt ausgewiesen, nie vermischt.
 *
 * Aufruf:  node scripts/lineal-gegenprobe.js <datumA> <datumB> [--json]
 *          (A = frueher / eingefrorenes Lineal, B = spaeter)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { q } = require('../src/scoring/engine.js');

const REPO = path.resolve(__dirname, '..');
// Achsen ohne Schranken-Argument in axes.js -> ihr Rohwert haengt nicht am Lineal des Tages.
const OHNE_SCHRANKEN = ['gpGrowth', 'dilution', 'marginLevel'];
// capitalEfficiency wird gegen eine vorzeichen-gefilterte Sub-Kohorte perzentiliert (score.js),
// die Basis im Lineal ist die UNgefilterte -> eine Inversion waere schlicht falsch.
const NICHT_INVERTIERBAR = ['capitalEfficiency'];
// PIT-Felder, die in die Achsen einfliessen. Kurs-/Zeitfelder bewusst NICHT: axes.js liest sie nie.
const FUNDAMENTAL = ['revenueQ', 'revenueQEnds', 'grossProfitQ', 'grossProfitQEnds',
  'fxRateApplied', 'reportingCurrencyOriginal'];

const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function ladeVintage(root, datum, datei) {
  const p = path.join(root, 'board-history', datum, datei);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Perzentil -> Rohwert-Kandidaten. Cache je (Kohorte, Achse), sonst O(n^2) je Zeile. */
function inversionsKarte(basis) {
  const m = new Map(), gesehen = new Set();
  for (const v of basis) {
    if (!Number.isFinite(v) || gesehen.has(v)) continue;
    gesehen.add(v);
    const p = r1(q(v, basis));
    if (!m.has(p)) m.set(p, []);
    m.get(p).push(v);
  }
  return m;
}

/**
 * gegenprobe(root, datumA, datumB, opts) -> Messergebnis.
 * opts.refBasisFilter: optionaler Haken, der die REFERENZ-Basis (Datum A) vor dem Perzentilieren
 * umformt. Ausschliesslich fuer die Positiv-Kontrolle im Test - ein verbogenes Referenz-Lineal
 * MUSS die Trefferquote einbrechen lassen, sonst misst die Gegenprobe nichts.
 */
function gegenprobe(root, datumA, datumB, opts = {}) {
  const refFilter = opts.refBasisFilter || null;
  const calA = ladeVintage(root, datumA, 'calibration.json');
  const calB = ladeVintage(root, datumB, 'calibration.json');
  if (!calA || !calB) throw new Error(`Lineal fehlt: ${datumA} und/oder ${datumB} hat keine calibration.json`);
  const dirA = path.join(root, 'board-history', datumA);
  const boards = fs.readdirSync(dirA)
    .filter((f) => f.endsWith('.json') && !['calibration.json', 'regime.json', 'survival.json'].includes(f));

  const proAchse = {};
  const ergebnis = {
    datumA, datumB, boards: 0, zeilen: 0,
    ohneSchranken: { n: 0, ok: 0 }, mitSchranken: { n: 0, ok: 0 }, proAchse,
  };
  for (const f of boards) {
    const ja = ladeVintage(root, datumA, f), jb = ladeVintage(root, datumB, f);
    if (!ja || !jb) continue;
    ergebnis.boards++;
    const board = f.replace(/\.json$/, '');
    for (const track of ['profitable', 'unprofitable']) {
      const key = `${board}|${track}`;
      const basA = calA.cohortBases[key] && calA.cohortBases[key].axes;
      const basB = calB.cohortBases[key] && calB.cohortBases[key].axes;
      if (!basA || !basB) continue;
      const karten = new Map();
      const spaeter = new Map((((jb.cohort || {})[track]) || []).map((r) => [r.ticker, r]));
      for (const zA of ((ja.cohort || {})[track]) || []) {
        const zB = spaeter.get(zA.ticker);
        if (!zB) continue;
        if (!FUNDAMENTAL.every((k) => gleich((zA.pit || {})[k], (zB.pit || {})[k]))) continue;
        ergebnis.zeilen++;
        for (const axB of zB.axisBreakdown || []) {
          if (NICHT_INVERTIERBAR.includes(axB.key)) continue;
          const axA = (zA.axisBreakdown || []).find((x) => x.key === axB.key);
          if (!axA || axA.pct === null || axB.pct === null || !(axB.weight > 0)) continue;
          const bB = basB[axB.key], bA = basA[axB.key];
          if (!bB || !bA) continue;
          if (!karten.has(axB.key)) karten.set(axB.key, inversionsKarte(bB));
          const kandidaten = karten.get(axB.key).get(axB.pct);
          if (!kandidaten || !kandidaten.length) continue;
          const referenz = refFilter ? bA.map(refFilter) : bA;
          const rekonstruiert = [...new Set(kandidaten.map((v) => r1(q(v, referenz))))];
          if (rekonstruiert.length > 1) continue;   // mehrdeutig -> verwerfen, nicht raten
          const topf = OHNE_SCHRANKEN.includes(axB.key) ? ergebnis.ohneSchranken : ergebnis.mitSchranken;
          topf.n++;
          proAchse[axB.key] = proAchse[axB.key] || { n: 0, ok: 0 };
          proAchse[axB.key].n++;
          if (rekonstruiert[0] === axA.pct) { topf.ok++; proAchse[axB.key].ok++; }
        }
      }
    }
  }
  return ergebnis;
}

module.exports = { gegenprobe, OHNE_SCHRANKEN, NICHT_INVERTIERBAR, FUNDAMENTAL };

if (require.main === module) {
  const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  if (!a || !b) {
    console.error('Aufruf: node scripts/lineal-gegenprobe.js <datumA-frueher> <datumB-spaeter> [--json]');
    process.exit(2);
  }
  const r = gegenprobe(REPO, a, b);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
  const pct = (x, n) => (n ? `${(100 * x / n).toFixed(2)} %` : '-');
  console.log(`Lineal-Gegenprobe: eingefrorenes Lineal ${a}, Zeilen aus ${b}`);
  console.log(`  ${r.boards} Boards, ${r.zeilen} Zeilen mit byte-identischem Fundamental-Eingang`);
  console.log(`  schranken-frei      ${r.ohneSchranken.ok}/${r.ohneSchranken.n}  ${pct(r.ohneSchranken.ok, r.ohneSchranken.n)}   <- die exakte Aussage`);
  console.log(`  schranken-behaftet  ${r.mitSchranken.ok}/${r.mitSchranken.n}  ${pct(r.mitSchranken.ok, r.mitSchranken.n)}   (Lineal aendert hier den Rohwert selbst)`);
  for (const [k, v] of Object.entries(r.proAchse).sort()) console.log(`     ${k.padEnd(18)} ${v.ok}/${v.n}  ${pct(v.ok, v.n)}`);
}
