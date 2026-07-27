'use strict';
/**
 * Sucht Emittenten-Zwillinge ueber die UMSATZREIHE statt ueber den Namen.
 *
 * WOZU: Der Dedup und sein Waechter gruppieren ueber den normalisierten Firmennamen. Das
 * traegt weit, hat aber eine harte Grenze — und die ist im Code ausdruecklich belegt
 * (score.js, "kein Emittent steht zweimal im selben Board"): es gibt KEINE sichere
 * schaerfere Namensnormalisierung, weil jedes weitere Wort, das man entfernt, irgendwo zwei
 * echte Gesellschaften unterscheidet (Graham Corporation gegen Graham Holdings, Metro Inc.
 * gegen Metro AG, Heineken N.V. gegen Heineken Holding N.V.).
 *
 * DER ANLASS (Zweitpruefung 27.07.2026): Im ausgelieferten Board standen
 *
 *     Rang 84  0470.HK     "WUXI LEAD"                              6,34 Mrd.
 *     Rang 85  300450.SZ   "Wuxi Lead Intelligent Equipment CO.,LTD."  8,29 Mrd.
 *
 * als zwei Firmen — mit IDENTISCHER Umsatz-Jahresreihe und identischem Score (86,6). Es ist
 * dieselbe Gesellschaft, einmal in Hongkong und einmal in Shenzhen notiert. Ueber den Namen
 * ist dieser Fall nicht zu fangen; die Kurzform ist zu kurz.
 *
 * DER ANDERE WEG: vier freie Jahresumsaetze, die auf den Betrag genau uebereinstimmen, sind
 * praktisch sicher dieselbe Gesellschaft. Das braucht keinen Namensvergleich und keine
 * Handliste.
 *
 * WARUM NUR EIN PRUEFWERKZEUG UND KEIN TEST: ein Test waere heute rot — wegen eines Falls,
 * der bekannt und benannt ist. Ein rotes CI ohne neuen Defekt kostet mehr, als es bringt
 * (dieselbe Lehre wie beim widerlegten Normalisierungs-Test im Integrationslauf). Und ein
 * EINGRIFF in den Dedup waere eine Aenderung mit Datenwirkung: er gehoert durch Rat und
 * Gericht, nicht in einen Nachtlauf.
 *
 * ⚠ DIE EBENE ENTSCHEIDET, und beim ersten Anlauf war sie falsch gewaehlt. Ueber das GANZE
 * Universum gemessen meldet diese Suche 1.851 Gruppen — das ist Rauschen, keine Diagnose:
 * Alphabet steht mit ELF Notierungen darin, Berkshire mit acht, Maersk mit acht. Solche
 * Mehrfachnotierungen sind normal, und der Dedup loest sie korrekt auf, indem nur ein Bein
 * ueberlebt. Interessant ist ausschliesslich, welche Zwillinge den Dedup UEBERLEBEN und
 * gemeinsam im Board landen. Deshalb ist die Board-Datei ein Pflicht-Argument.
 *
 * Aufruf:
 *   node scripts/probe-emittenten-zwillinge.js <snapshot-ordner> <board-export.json> [--min-jahre 3]
 *
 * Der Snapshot-Ordner sollte der eines CI-Laufs sein (gh run download <RUN_ID> -n snapshots) —
 * der lokale snapshots/-Ordner ist seit dem 17.05.2026 eingefroren und beweist nichts.
 * Als Board-Export dient eine v1-Datei mit `rows` (overview.json) oder mit
 * `profitable`/`unprofitable` (Branchen-Board).
 */
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const frei = args.filter((a) => !a.startsWith('--'));
const ordner = frei[0];
const boardDatei = frei[1];
const minJahreArg = args.indexOf('--min-jahre');
const MIN_JAHRE = minJahreArg >= 0 ? Number(args[minJahreArg + 1]) : 3;

if (!ordner || !boardDatei) {
  console.error('Aufruf: node scripts/probe-emittenten-zwillinge.js <snapshot-ordner> <board-export.json> [--min-jahre 3]');
  console.error('Ohne Board-Datei waere das Ergebnis Rauschen — s. Kommentar im Kopf.');
  process.exit(2);
}
if (!fs.existsSync(boardDatei)) {
  console.error('Board-Datei nicht gefunden: ' + boardDatei);
  process.exit(2);
}
if (!fs.existsSync(ordner)) {
  console.error('Ordner nicht gefunden: ' + ordner);
  process.exit(2);
}
if (!Number.isFinite(MIN_JAHRE) || MIN_JAHRE < 2) {
  console.error('--min-jahre braucht eine Zahl >= 2 (zwei zufaellig gleiche Jahre sind kein Beleg)');
  process.exit(2);
}

const wert = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);
const ist = (x) => typeof x === 'number' && Number.isFinite(x);

// Die Ticker, die den Dedup ueberlebt haben und tatsaechlich im Board stehen.
function boardTicker(datei) {
  const j = JSON.parse(fs.readFileSync(datei, 'utf8'));
  const raus = new Map();
  const sammle = (liste) => {
    for (const r of (Array.isArray(liste) ? liste : [])) {
      if (r && typeof r.ticker === 'string') raus.set(r.ticker, r);
    }
  };
  sammle(j.rows);            // overview.json
  sammle(j.profitable);      // Branchen-Board
  sammle(j.unprofitable);
  return raus;
}
const imBoard = boardTicker(boardDatei);
if (imBoard.size === 0) {
  console.error('Die Board-Datei enthaelt keine Zeilen (weder rows noch profitable/unprofitable).');
  process.exit(2);
}

const dateien = fs.readdirSync(ordner).filter((f) => f.endsWith('.json'));
const nachReihe = new Map();
let gelesen = 0, ohneReihe = 0;

for (const f of dateien) {
  if (!imBoard.has(f.replace(/\.json$/, ''))) continue;   // nur Dedup-Ueberlebende
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(ordner, f), 'utf8')); } catch { continue; }
  gelesen += 1;
  const roh = s && s.annual && Array.isArray(s.annual.annualRev) ? s.annual.annualRev.map(wert) : [];
  const jahre = roh.filter(ist).filter((v) => v > 0);
  if (jahre.length < MIN_JAHRE) { ohneReihe += 1; continue; }
  // Auf den Betrag genau: eine Rundung wuerde verschiedene Firmen zusammenwerfen koennen.
  const schluessel = jahre.slice(0, MIN_JAHRE).map((v) => v.toFixed(2)).join('|');
  if (!nachReihe.has(schluessel)) nachReihe.set(schluessel, []);
  nachReihe.get(schluessel).push({
    ticker: f.replace(/\.json$/, ''),
    name: (s.meta && (s.meta.longName || s.meta.shortName || s.meta.name)) || '(ohne Namen)',
    mcap: s.marketCap && ist(s.marketCap.value) ? s.marketCap.value : null,
  });
}

const gruppen = [...nachReihe.values()].filter((g) => g.length > 1);
console.log('Board-Zeilen                 : ' + imBoard.size);
console.log('davon mit Snapshot gelesen   : ' + gelesen);
console.log('davon ohne verwertbare Reihe : ' + ohneReihe + ' (weniger als ' + MIN_JAHRE + ' positive Jahre)');
console.log('Zwillinge IM BOARD           : ' + gruppen.length);
console.log('');

if (!gruppen.length) {
  console.log('Keine Emittenten-Zwillinge im Board — der Dedup hat alle aufgeloest.');
  process.exit(0);
}

gruppen.sort((a, b) => b.length - a.length);
for (const g of gruppen) {
  const namen = [...new Set(g.map((x) => x.name))];
  console.log('Gruppe (' + g.length + ' Notierungen):');
  for (const x of g) {
    console.log('    ' + x.ticker.padEnd(14) + String(x.name).slice(0, 42).padEnd(43)
      + (x.mcap != null ? (x.mcap / 1e9).toFixed(2) + ' Mrd.' : 'ohne Marktwert'));
  }
  console.log('    -> ' + (namen.length === 1
    ? 'GLEICHER Name — der namensbasierte Dedup haette greifen muessen, hier liegt ein anderer Defekt'
    : 'verschiedene Namen — genau der Fall, den der Namensvergleich nicht fangen kann'));
  console.log('');
}
console.log('Hinweis: Dieses Werkzeug MELDET nur. Ein Eingriff in den Dedup hat Datenwirkung');
console.log('und gehoert durch Rat und Gericht.');
