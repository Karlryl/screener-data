#!/usr/bin/env node
/**
 * Daten-Waechter: einzelne Jahres-Ausreisser in den gespeicherten Reihen.
 * ======================================================================
 *
 * ANLASS (Cigna, 29.07.2026): Im Store steht fuer Cignas Geschaeftsjahr 2022 ein
 * Betriebsergebnis von **-88.600 Mio**, waehrend die Nachbarjahre bei +7.295 und
 * +8.444 Mio liegen und Yahoo LIVE heute +7.370 (normalisiert) bzw. +8.536 (berichtet)
 * liefert. Der Wert ist also weder Yahoos aktuelle Zahl noch die der SEC — er stammt aus
 * einem einzelnen schlechten Abruf und ist seither eingefroren.
 *
 * DAS IST DIE EIGENTLICHE LUECKE: Der Store hat kein Gedaechtnis fuer Plausibilitaet.
 * Was einmal drinsteht, bleibt drin — auch wenn die Quelle es am naechsten Tag
 * widerruft. Ein Verhaeltnis-Gate (|OpInc| > Umsatz) faengt diesen Fall NICHT: -88,6 Mrd
 * gegen 194 Mrd Umsatz sind "nur" -46 % Marge, und die kann eine echte Abschreibung
 * erzeugen. Was ihn faengt, ist die FORM: ein Jahr, das von BEIDEN Nachbarn um
 * Groessenordnungen abweicht und danach zurueckspringt.
 *
 * WAS DIESER WAECHTER TUT: melden. Er repariert nichts und aendert keinen Score —
 * eine echte Sonderabschreibung sieht genauso aus, und die darf nicht wegretuschiert
 * werden. Er macht nur sichtbar, was sonst niemand sieht.
 *
 * ::error:: sobald mehr Ausreisser gefunden werden als die Schwelle erlaubt.
 *
 * Usage: node scripts/watch-annual-spikes.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
// Ein Ausreisser muss BEIDE Nachbarn um mindestens diesen Faktor uebertreffen. 8 ist
// bewusst grob: eine Verdopplung oder ein Verlustjahr sind normal, ein Achtfaches der
// beiden Nachbarn ist es nicht. Cigna 2022: |-88.600| / max(7.295, 8.444) = 10,5.
const FAKTOR = 8;
// Sehr kleine Zahlen schwanken relativ stark, ohne dass etwas kaputt ist.
const MIN_BETRAG = 50e6;
// Bei 4.700 Firmen sind einzelne echte Sonderjahre erwartbar — am 29.07. sind es 54.
// Eine feste Schwelle waere deshalb entweder von Tag eins an rot (nutzlos) oder so hoch,
// dass sie nichts faengt. Gemessen wird stattdessen das WACHSTUM gegen einen
// mitgefuehrten Bestand: bekannte Faelle schweigen, NEUE fallen auf. Das ist dasselbe
// Muster wie bei den anderen Daten-Waechtern (data-health/*-baseline.json).
const BASELINE_PATH = path.join(ROOT, 'data-health', 'annual-spikes-baseline.json');
// Wie viele NEUE Faelle in einem Lauf noch als Rauschen durchgehen. Ein einzelner
// Neuzugang kann ein echtes Sonderjahr sein; fuenf auf einmal sind ein Muster.
const MAX_NEU = Number(process.env.ANNUAL_SPIKE_MAX_NEU || 5);

const REIHEN = ['annualOpInc', 'annualRev', 'annualNetIncome'];

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}

/**
 * Findet Positionen, an denen ein Wert von BEIDEN Nachbarn um mindestens `faktor`
 * abweicht. Rein und ohne I/O — die Regel ist damit ohne Snapshots pruefbar.
 * Nur INNERE Positionen: der erste und letzte Wert haben keinen zweiten Nachbarn,
 * und ein Randwert ohne Gegenprobe waere geraten, nicht gemessen.
 */
function findeAusreisser(reihe, faktor = FAKTOR, minBetrag = MIN_BETRAG) {
  const werte = (Array.isArray(reihe) ? reihe : []).map((x) => (x && typeof x.value === 'number' && Number.isFinite(x.value) ? x.value : null));
  const treffer = [];
  for (let i = 1; i < werte.length - 1; i++) {
    const v = werte[i], l = werte[i - 1], r = werte[i + 1];
    if (v == null || l == null || r == null) continue;
    if (Math.abs(v) < minBetrag) continue;
    const nachbar = Math.max(Math.abs(l), Math.abs(r));
    if (nachbar === 0) continue;
    if (Math.abs(v) / nachbar >= faktor) treffer.push({ index: i, wert: v, links: l, rechts: r });
  }
  return treffer;
}

function main() {
  if (!fs.existsSync(SNAP_DIR)) {
    console.error('::error::watch-annual-spikes: snapshots/ fehlt — Snapshot-Restore kaputt?');
    return 1;
  }
  const dateien = fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  if (dateien.length === 0) {
    console.error('::error::watch-annual-spikes: leeres Snapshot-Verzeichnis — nichts geprueft');
    return 1;
  }
  const funde = [];
  for (const f of dateien) {
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch (_) { continue; }
    const annual = s && s.annual;
    if (!annual) continue;
    for (const name of REIHEN) {
      for (const t of findeAusreisser(annual[name])) {
        funde.push({ ticker: (s.meta && s.meta.ticker) || f.replace(/\.json$/, ''), reihe: name, ...t });
      }
    }
  }
  const schluessel = (x) => `${x.ticker}|${x.reihe}|${x.index}`;
  const bestand = new Set((loadJson(BASELINE_PATH, {}).faelle) || []);
  const neu = funde.filter((x) => !bestand.has(schluessel(x)));

  const mio = (v) => (v / 1e6).toFixed(0);
  console.log(`Jahres-Ausreisser: ${funde.length} in ${dateien.length} Snapshots · davon NEU: ${neu.length} (erlaubt ${MAX_NEU})`);
  // Immer die NEUEN vollstaendig zeigen — sie sind der Grund fuer diesen Lauf.
  for (const x of neu) console.log(`  NEU  ${x.ticker} · ${x.reihe}[${x.index}] = ${mio(x.wert)} Mio, Nachbarn ${mio(x.links)} / ${mio(x.rechts)}`);
  // Vom Bestand nur eine Kostprobe, aber die Zahl bleibt genannt — kein stilles Kappen.
  const bekannt = funde.filter((x) => bestand.has(schluessel(x)));
  for (const x of bekannt.slice(0, 15)) console.log(`  bek. ${x.ticker} · ${x.reihe}[${x.index}] = ${mio(x.wert)} Mio, Nachbarn ${mio(x.links)} / ${mio(x.rechts)}`);
  if (bekannt.length > 15) console.log(`  … und ${bekannt.length - 15} weitere bekannte`);

  if (neu.length > MAX_NEU) {
    console.error(`::error::${neu.length} NEUE Jahres-Ausreisser (erlaubt ${MAX_NEU}) — einzelne Jahre weichen um Faktor ${FAKTOR}+ von BEIDEN Nachbarn ab. Entweder echte Sonderjahre oder frisch eingefrorene Fehlabrufe; Liste oben.`);
    return 1;
  }
  return 0;
}

module.exports = { findeAusreisser, FAKTOR, MIN_BETRAG };

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    // Ein abgestuerzter Waechter darf NICHT Erfolg melden (siehe tests/waechter-absturz.test.js).
    console.error('::error::watch-annual-spikes abgestuerzt (hat NICHT geprueft): ' + e.message);
    process.exit(1);
  }
}
