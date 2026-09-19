#!/usr/bin/env node
'use strict';
/**
 * t139-marketcap-herkunft.js - Messartefakt zu T139.
 * ==================================================
 * Die Auftragsfrage lautet: "7.226 von 8.313 Zeilen unterscheiden sich in marketCap und
 * in sonst gar nichts - Herkunft des Marktwerts gegen die Kursfelder pruefen."
 *
 * MESSEBENE, ausdruecklich: board-history/<vintage>/<sektor>.json, Block `pit` je Zeile.
 * Das ist die Ebene, auf der der Ursprungsbefund entstand. Der findash-Export
 * (`findash-export/v1`) traegt nur die veroeffentlichte Top-N-Auswahl und KEINE
 * Perioden-Enden - wer dort misst, misst die falsche Ebene (Fehlschlag 31.08.).
 * Die vollen CI-Artefakte der Tage werden NICHT gebraucht: die Vintages liegen im Repo.
 *
 * Gemessen wird je Zeilenpaar (gleicher Sektor + gleiche Kohorte + gleicher Ticker):
 *   - aendert sich pit.marketCap?
 *   - bleibt der Rest des pit-Blocks dabei byte-identisch? (= "in sonst gar nichts")
 *   - bleiben die KURSFELDER (priceSales, priceSalesAsOf, evSales, priceGrossProfit,
 *     beta) und der Abrufzeitpunkt fetchedAt byte-identisch?
 *   - kippt die absolute Groessenklasse mcapKlasse mit? (Kohorten-Risiko des Befunds)
 *   - wie weit laufen marketCap-Verhaeltnis und priceSales-Verhaeltnis auseinander?
 *     (Innen-Inkonsistenz der PIT-Zeile, T160)
 * Zusaetzlich: aendert sich sonst etwas an der ZEILE (score, rank, axisBreakdown)?
 *
 * ABWESENHEIT IST NIE STABILITAET (Hausregel dieses Repos, von der Codex-Gegenpruefung
 * zweimal eingefordert): eine Zeile ohne `pit`, ein `marketCap`, der fehlt oder nicht endlich
 * ist, eine Kohorten-Liste, die kein Array ist, ein doppelter Schluessel - all das wird
 * GEZAEHLT und macht `pruefeErgebnis()` laut, statt als "unveraendert" durchzugehen. In den
 * Vintages 07./09.08. ist jeder dieser Zaehler 0; die Wachen sind fuer den Tag, an dem er es
 * nicht ist.
 *
 * mcapKlasseOf wird aus src/scoring/score.js IMPORTIERT, nicht nachgebaut - ein Nachbau
 * wuerde stillschweigend von der Produktionsschwelle abdriften. src/scoring wird nur gelesen.
 *
 * Run: node scripts/t139-marketcap-herkunft.js [--a 2026-08-07] [--b 2026-08-09]
 *        [--mit-survival] [--out <datei.json>]
 *      T139_BOARD_ROOT=<dir> setzt das Wurzelverzeichnis der Vintages (fuer den Waechter).
 */
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const ROOT = path.join(__dirname, '..');
const { mcapKlasseOf } = require(path.join(ROOT, 'src', 'scoring', 'score.js'));

// calibration.json/regime.json tragen keinen `cohort`-Block und fielen ohnehin durch.
// survival.json DAGEGEN traegt echte Kohorten-Zeilen mit pit-Block (97 bzw. 103 am
// 07./09.08.): die Pre-Revenue-/Biotech-Spur, die nie auf Wachstum gescort wird. Sie ist
// per Default AUSGESCHLOSSEN, damit die Zahl mit dem Ursprungsbefund (8.313 gemeinsame
// Zeilen) vergleichbar bleibt - und nur deshalb. `--mit-survival` nimmt sie hinzu; die
// Ausgabe fuehrt die Weiche als `survivalEnthalten` mit, damit keine Quote ohne ihren
// Geltungsbereich weiterwandert. (Fund der read-only Codex-Gegenpruefung, 19.09.)
const NICHT_BOARD = new Set(['calibration.json', 'regime.json', 'survival.json']);
const KURSFELDER = ['priceSales', 'priceSalesAsOf', 'evSales', 'priceGrossProfit', 'beta'];

function argOf(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

/**
 * Alle Board-Zeilen eines Vintage, Schluessel sektor|kohorte|ticker.
 * Rueckgabe: { rows, kaputt } - `kaputt` zaehlt jede Kohorte, die kein Array ist, und jede
 * Zeile ohne Ticker. Ein doppelter Schluessel WIRFT: stilles Ueberschreiben machte das
 * Ergebnis von der Reihenfolge widerspruechlicher Duplikate abhaengig.
 */
function ladeVintage(dir, mitSurvival) {
  const rows = new Map();
  let kaputt = 0;
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.json')) continue;
    if (NICHT_BOARD.has(f) && !(mitSurvival && f === 'survival.json')) continue;
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!d || !d.cohort || typeof d.cohort !== 'object') continue;
    const sektor = f.replace(/\.json$/, '');
    for (const kohorte of Object.keys(d.cohort)) {
      const liste = d.cohort[kohorte];
      if (!Array.isArray(liste)) { kaputt++; continue; }
      for (const r of liste) {
        if (!r || !r.ticker) { kaputt++; continue; }
        const k = `${sektor}|${kohorte}|${r.ticker}`;
        if (rows.has(k)) {
          throw new Error(`Doppelter Schluessel ${k} in ${dir} - welche der beiden Zeilen `
            + 'gemessen wird, haenge sonst an der Dateireihenfolge.');
        }
        rows.set(k, r);
      }
    }
  }
  return { rows, kaputt };
}

// Vergleich ueber ANWESENHEIT + isDeepStrictEqual, NICHT ueber JSON.stringify: stringify
// macht `undefined`/fehlenden Schluessel zu `null`, `-0` zu `0` und `NaN` zu `null` - drei
// Wege, auf denen zwei ungleiche pit-Bloecke als gleich durchgehen - und erzeugt umgekehrt
// Scheindifferenzen bei geaenderter Schluesselreihenfolge. In den Vintages 07./09.08. macht
// es keinen Unterschied (nachgerechnet), aber eine Zaehlung, die auf Gleichheit BESTEHT,
// darf die Gleichheit nicht der Serialisierung ueberlassen.
// (Fund der read-only Codex-Gegenpruefung, 19.09.)
function feldDiff(a, b, ausser) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .filter((k) => k !== ausser)
    .filter((k) => Object.hasOwn(a, k) !== Object.hasOwn(b, k) || !isDeepStrictEqual(a[k], b[k]))
    .sort();
}

/** Menge der pit-Felder, die sich zwischen zwei Zeilen unterscheiden. */
function pitDiff(a, b) {
  return feldDiff(a.pit || {}, b.pit || {});
}

/** Menge der uebrigen Zeilenfelder (ohne pit), die sich unterscheiden. */
function zeilenDiff(a, b) {
  return feldDiff(a, b, 'pit');
}

/** Ein Feld, das auf BEIDEN Seiten fehlt, ist unmessbar - nicht "unveraendert". */
const inBeiden = (a, b, f) => Object.hasOwn(a.pit || {}, f) && Object.hasOwn(b.pit || {}, f);

const quote = (zaehler, nenner) => (nenner > 0 ? zaehler / nenner : null);

function mess(dirA, dirB, opts) {
  const mitSurvival = !!(opts && opts.mitSurvival);
  const A = ladeVintage(dirA, mitSurvival);
  const B = ladeVintage(dirB, mitSurvival);
  const gemeinsam = [...A.rows.keys()].filter((k) => B.rows.has(k));

  const out = {
    vintageA: path.basename(dirA),
    vintageB: path.basename(dirB),
    survivalEnthalten: mitSurvival,
    zeilenA: A.rows.size,
    zeilenB: B.rows.size,
    gemeinsam: gemeinsam.length,
    // Wachen gegen "Abwesenheit sieht aus wie Stabilitaet". Alle vier sind am 07./09.08. 0.
    kaputteEintraege: A.kaputt + B.kaputt,
    paareOhnePit: 0,
    mcapUnbrauchbar: 0,
    paareOhneKursfeld: 0,
    mcapGeaendert: 0,
    nurMcapImPit: 0,
    nurMcapUndZeileSonstIdentisch: 0,
    mcapGeaendertKursfelderIdentisch: 0,
    mcapGeaendertFetchedAtIdentisch: 0,
    mcapUnveraendert: 0,
    zeilePitUndRestIdentisch: 0,
    klasseGekippt: 0,
    klasseGekipptNurMcap: 0,
    klasseKippBeispiele: [],
    verhaeltnis: { n: 0, min: null, max: null },
    // T160-Kern: marketCap bewegt sich, priceSales steht - die Zeile ist innen inkonsistent.
    mcapOhnePriceSales: 0,
    andereFelderImPit: {},
  };

  for (const k of gemeinsam) {
    const a = A.rows.get(k);
    const b = B.rows.get(k);
    if (!a.pit || !b.pit) { out.paareOhnePit++; continue; }
    const dPit = pitDiff(a, b);
    const dRest = zeilenDiff(a, b);
    if (dPit.length === 0 && dRest.length === 0) out.zeilePitUndRestIdentisch++;
    for (const f of dPit) {
      if (f !== 'marketCap') out.andereFelderImPit[f] = (out.andereFelderImPit[f] || 0) + 1;
    }
    // Brauchbarkeit VOR jeder Zaehlung: ein fehlender, nicht endlicher oder nicht positiver
    // Marktwert ist weder "unveraendert" noch "geaendert" — er ist nicht gemessen.
    // mcapKlasseOf(null) waere `null` und `Number(null)` waere 0; beides saehe wie eine
    // Messung aus. (Fund der Codex-Code-Review, 19.09.)
    const ma = a.pit.marketCap;
    const mb = b.pit.marketCap;
    const brauchbar = inBeiden(a, b, 'marketCap')
      && Number.isFinite(ma) && Number.isFinite(mb) && ma > 0 && mb > 0;
    if (!brauchbar) { out.mcapUnbrauchbar++; continue; }
    if (!dPit.includes('marketCap')) { out.mcapUnveraendert++; continue; }
    out.mcapGeaendert++;
    const nurMcap = dPit.length === 1;
    if (nurMcap) {
      out.nurMcapImPit++;
      if (dRest.length === 0) out.nurMcapUndZeileSonstIdentisch++;
    }
    // "Kursfeld/fetchedAt identisch" darf nur zaehlen, was ueberhaupt da ist.
    const kursfelderDa = KURSFELDER.some((f) => inBeiden(a, b, f));
    const stempelDa = inBeiden(a, b, 'fetchedAt');
    if (!kursfelderDa || !stempelDa) out.paareOhneKursfeld++;
    if (kursfelderDa && !dPit.some((f) => KURSFELDER.includes(f))) out.mcapGeaendertKursfelderIdentisch++;
    if (stempelDa && !dPit.includes('fetchedAt')) out.mcapGeaendertFetchedAtIdentisch++;
    if (inBeiden(a, b, 'priceSales') && !dPit.includes('priceSales')) out.mcapOhnePriceSales++;

    const ka = mcapKlasseOf(ma);
    const kb = mcapKlasseOf(mb);
    if (ka !== kb) {
      out.klasseGekippt++;
      if (nurMcap) out.klasseGekipptNurMcap++;
      if (out.klasseKippBeispiele.length < 10) out.klasseKippBeispiele.push({ zeile: k, von: ka, nach: kb });
    }
    const q = mb / ma;
    if (Number.isFinite(q)) {   // 1e-308 -> 1e308 sind beide endlich, der Quotient nicht
      out.verhaeltnis.n++;
      if (out.verhaeltnis.min === null || q < out.verhaeltnis.min) out.verhaeltnis.min = q;
      if (out.verhaeltnis.max === null || q > out.verhaeltnis.max) out.verhaeltnis.max = q;
    } else {
      out.mcapUnbrauchbar++;
    }
  }
  // Nenner 0 heisst "nicht bestimmbar", nicht "0 %".
  out.anteilMcapGeaendert = quote(out.mcapGeaendert, out.gemeinsam);
  out.anteilKlasseGekippt = quote(out.klasseGekippt, out.mcapGeaendert);
  return out;
}

/**
 * "0 von 0" ist in diesem Repo die Hausform der stillen Panne: ein leeres Ergebnis liest sich
 * wie ein sauberes. Kein gemeinsames Zeilenpaar, eine kaputte Kohorten-Liste oder ein Paar
 * ohne pit-Block heisst Messausfall, nicht Befund - und das muss laut sein. Eigene Funktion,
 * damit der Waechter GENAU diese Regel prueft statt eines Textmusters.
 */
function pruefeErgebnis(r) {
  if (r.gemeinsam === 0) {
    throw new Error(`Messausfall: 0 gemeinsame Zeilen zwischen ${r.vintageA} (${r.zeilenA} Zeilen) `
      + `und ${r.vintageB} (${r.zeilenB} Zeilen) - ohne Paare ist jede Quote bedeutungslos.`);
  }
  if (r.kaputteEintraege > 0) {
    throw new Error(`Messausfall: ${r.kaputteEintraege} Kohorten-Eintraege sind keine Zeilenliste `
      + '- stillschweigend uebersprungen waeren sie eine zu kleine Grundgesamtheit.');
  }
  if (r.paareOhnePit > 0) {
    throw new Error(`Messausfall: ${r.paareOhnePit} Paare ohne pit-Block - ohne den Block ist `
      + 'weder "nur marketCap" noch "sonst nichts" messbar.');
  }
  return r;
}

function main() {
  const a = argOf('--a', '2026-08-07');
  const b = argOf('--b', '2026-08-09');
  const wurzel = process.env.T139_BOARD_ROOT || path.join(ROOT, 'board-history');
  const dirA = path.join(wurzel, a);
  const dirB = path.join(wurzel, b);
  for (const d of [dirA, dirB]) {
    if (!fs.existsSync(d)) { console.error(`[t139] Vintage fehlt: ${d}`); process.exit(2); }
  }
  const r = mess(dirA, dirB, { mitSurvival: process.argv.includes('--mit-survival') });
  try { pruefeErgebnis(r); } catch (e) { console.error('[t139] ' + e.message); process.exit(1); }
  const out = argOf('--out', null);
  if (out) fs.writeFileSync(out, JSON.stringify(r, null, 2) + '\n');
  console.log(JSON.stringify(r, null, 2));
}

if (require.main === module) main();
module.exports = { ladeVintage, pitDiff, zeilenDiff, mess, pruefeErgebnis };
