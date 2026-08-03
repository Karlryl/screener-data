#!/usr/bin/env node
'use strict';
/**
 * S4-PRICE-001 (Block-5-Verifikation 2026-08-03) — Preis-Abdeckung auf WATCHLIST-Ebene.
 *
 * WOZU: Der Heartbeat prueft das Preis-Substrat bisher an zwei Stellen — dem
 * Store-Stempel (prices/history/_meta.json) und der SPY-Serie. Beide sagen nur, dass
 * der Pull ueberhaupt noch schreibt. Sie sagen NICHTS darueber, fuer wie viele Titel
 * der Watchlist tatsaechlich Kurse dastehen. Gemessen am 03.08.2026: 1.801 von 15.337
 * Watchlist-Titeln (11,7 %) haben keine einzige Kurszeile, 38 Serien sind aelter als
 * 30 Tage. Beides war bisher unsichtbar, weil _meta und SPY frisch aussahen.
 *
 * WAS DAS HIER IST: eine MESSUNG, kein Gate. Der Schritt wird NIE rot. Ab welchem
 * Anteil das ein Alarm sein soll, ist eine Schwellen-Frage und gehoert vor den Rat —
 * eine ausgedachte Schwelle waere entweder Dauer-Alarm oder Deko.
 *
 * NEUZUGANGS-VENTIL: Ein Titel, der gestern ins Universum kam, KANN noch keine
 * Kurshistorie haben. Titel mit `added_at` juenger als NEU_TAGE bleiben deshalb aus
 * der Messung. Die Zahl der so ausgenommenen Titel wird IMMER mitgedruckt: am
 * 21.07.2026 kamen 9.736 Titel auf einen Schlag dazu (globaler Universums-Ausbau),
 * wer nur die Restquote liest, haelt sie sonst fuer die ganze Wahrheit.
 *
 * Run:  node scripts/heartbeat-preis-abdeckung.js     (Exit IMMER 0)
 */
const fs = require('fs');
const path = require('path');
const store = require(path.join(__dirname, '..', 'lib', 'price-history-store.js'));

// Zaehlgrenzen, keine Alarmschwellen: sie entscheiden, in welchen Eimer ein Titel
// faellt, nicht ob der Schritt rot wird.
const NEU_TAGE = Number(process.env.PREIS_NEU_TAGE || 14);
const ALT_TAGE = Number(process.env.PREIS_ALT_TAGE || 30);

/** Watchlist-Zeilen aus allen drei bekannten Schreibweisen. */
function watchlistZeilen(w) {
  if (Array.isArray(w)) return w;
  if (w && Array.isArray(w.stocks)) return w.stocks;
  return Object.values(w || {});
}

const tage = (von, bis) => (bis - von) / 86400000;

/**
 * Reine Messung — kein Dateisystem, damit sie einzeln pruefbar ist.
 * `alle` ist die Store-Karte ticker -> [{date, close}, ...].
 */
function messePreisAbdeckung(zeilen, alle, opts = {}) {
  const jetzt = opts.jetzt != null ? opts.jetzt : Date.now();
  const neuTage = opts.neuTage != null ? opts.neuTage : NEU_TAGE;
  const altTage = opts.altTage != null ? opts.altTage : ALT_TAGE;

  let ventil = 0, leer = 0, alt = 0;
  let basis = 0;
  let aeltester = null;   // { ticker, datum, tage } — der schlimmste Fall, zum Anfassen
  const leerBeispiele = [];

  for (const r of zeilen) {
    const t = r && (r.ticker || r.yahoo_symbol);
    if (!t) continue;
    // Kein added_at = Altbestand aus der Zeit vor dem Feld, also NICHT neu.
    if (r.added_at) {
      const d = Date.parse(r.added_at);
      if (Number.isFinite(d) && tage(d, jetzt) < neuTage) { ventil++; continue; }
    }
    basis++;
    const serie = alle[t] || alle[r.yahoo_symbol];
    if (!serie || !serie.length) {
      leer++;
      if (leerBeispiele.length < 8) leerBeispiele.push(t);
      continue;
    }
    const letzte = serie[serie.length - 1];
    const d = Date.parse(letzte && letzte.date);
    if (!Number.isFinite(d)) continue;   // unlesbares Datum: nicht als "alt" zaehlen
    const alterTage = Math.floor(tage(d, jetzt));
    if (alterTage > altTage) {
      alt++;
      if (!aeltester || alterTage > aeltester.tage) aeltester = { ticker: t, datum: letzte.date, tage: alterTage };
    }
  }

  return {
    gesamt: zeilen.length,
    ventil, basis, leer, alt, aeltester, leerBeispiele,
    leerAnteil: basis > 0 ? leer / basis : null,
    neuTage, altTage,
  };
}

function main() {
  const wurzel = path.join(__dirname, '..');
  let zeilen;
  try {
    zeilen = watchlistZeilen(JSON.parse(fs.readFileSync(path.join(wurzel, 'watchlist.json'), 'utf8')));
  } catch (e) {
    // Auch der Messausfall wird ausgesprochen. Stumm exit 0 waere genau der Fehler,
    // den diese Messung aufdecken soll.
    console.log('::warning::Preis-Abdeckung nicht messbar: watchlist.json nicht lesbar (' + e.message + ').');
    return 0;
  }
  let alle;
  try { alle = store.loadAll('prices'); }
  catch (e) {
    console.log('::warning::Preis-Abdeckung nicht messbar: Preis-Store nicht lesbar (' + e.message + ').');
    return 0;
  }

  const m = messePreisAbdeckung(zeilen, alle);
  const anteil = m.leerAnteil == null ? 'n/a' : (m.leerAnteil * 100).toFixed(1) + ' %';

  // Tag-520-Lehre: beide Kennzahlen IMMER drucken, auch wenn sie unauffaellig sind.
  // Eine Zahl, die nur im Alarmfall erscheint, ist keine Messreihe.
  console.log('Preis-Abdeckung (Watchlist-Ebene, MESSUNG — dieser Schritt wird nie rot):');
  console.log('  Watchlist gesamt:      ' + m.gesamt);
  console.log('  Neuzugangs-Ventil:     ' + m.ventil + ' Titel juenger als ' + m.neuTage
    + ' Tage, aus der Messung genommen (sie KOENNEN noch keine Historie haben)');
  console.log('  gemessene Grundmenge:  ' + m.basis);
  console.log('  KENNZAHL 1 — ohne jede Kurszeile: ' + m.leer + ' von ' + m.basis + ' (' + anteil + ')'
    + (m.leerBeispiele.length ? '   z. B. ' + m.leerBeispiele.join(' ') : ''));
  console.log('  KENNZAHL 2 — letzte Kurszeile aelter als ' + m.altTage + ' Tage: ' + m.alt
    + (m.aeltester ? '   aeltester: ' + m.aeltester.ticker + ' steht auf ' + m.aeltester.datum
      + ' (' + m.aeltester.tage + ' Tage)' : ''));
  if (m.ventil > m.basis) {
    console.log('  HINWEIS: das Ventil nimmt gerade MEHR Titel heraus als es misst — die Quote oben '
      + 'beschreibt dann nur den Altbestand, nicht das Universum. Ursache sind Massen-Zugaenge '
      + '(z. B. 9.736 Titel am 21.07.2026); das laeuft sich nach ' + m.neuTage + ' Tagen von selbst aus.');
  }
  return 0;
}

module.exports = { messePreisAbdeckung, watchlistZeilen };

if (require.main === module) process.exit(main());
