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
 * WAS DAS HIER IST (bis Tag 631: eine MESSUNG ohne Gate): seit Tag 632 traegt die
 * KERN-Gruppe eine Schwelle — siehe KERN_ALARM_ANTEIL. Der Auslandsteil bleibt reine
 * Messung und loest NIE Alarm aus.
 *
 * NEUZUGANGS-VENTIL: Ein Titel, der gestern ins Universum kam, KANN noch keine
 * Kurshistorie haben. Titel mit `added_at` juenger als NEU_TAGE bleiben deshalb aus
 * der Messung. Die Zahl der so ausgenommenen Titel wird IMMER mitgedruckt: am
 * 21.07.2026 kamen 9.736 Titel auf einen Schlag dazu (globaler Universums-Ausbau),
 * wer nur die Restquote liest, haelt sie sonst fuer die ganze Wahrheit.
 *
 * Run:  node scripts/heartbeat-preis-abdeckung.js
 *       Exit 1 NUR bei gelungener Messung mit Kern-Quote >= KERN_ALARM_ANTEIL.
 *       Jeder MESSAUSFALL bleibt Exit 0 mit ::warning:: (F-CGPT-045-Fix, Tag 620):
 *       ein unlesbarer Store saehe wie "alles leer" aus — daraus darf nie Alarm werden.
 */
const fs = require('fs');
const path = require('path');
const store = require(path.join(__dirname, '..', 'lib', 'price-history-store.js'));

// Zaehlgrenzen, keine Alarmschwellen: sie entscheiden, in welchen Eimer ein Titel
// faellt, nicht ob der Schritt rot wird.
const NEU_TAGE = Number(process.env.PREIS_NEU_TAGE || 14);
const ALT_TAGE = Number(process.env.PREIS_ALT_TAGE || 30);

// DIE Alarmschwelle. Karl-Entscheid F-29c 10.08.2026, Herleitung in der Rat-Vorlage
// (_RAT-VORLAGE-heartbeat-schwelle-2026-08-10.md, Abschnitt 3c). Bewusst eine feste
// Konstante: kein Config-Eintrag, kein Env-Ventil — eine Schwelle, die sich zur Laufzeit
// weichstellen laesst, ist im Ernstfall genau dann weich, wenn jemand sie weggedreht hat.
const KERN_ALARM_ANTEIL = 0.05;

/**
 * KERN = US-Boersen + Altbestand ohne Boersen-Hint (Definition der Rat-Vorlage, 2c).
 * Nur diese Gruppe alarmiert. Grund: die Gesamtquote wandert allein durch Zu- und
 * Abgaenge um Prozentpunkte (am 19.08. rechnerisch von ~11,7 % auf ~9,0 %, gleiche
 * Datenqualitaet), waehrend der Kern flach bei ~1 % liegt und jeden echten Ausfall
 * sofort zeigt. Der Auslandsteil steht bei 17,8 % — eine bekannte Beschaffungs-Luecke,
 * die jede Gesamtschwelle dominieren wuerde.
 *
 * EXAKTE Namen, KEIN Praefix-Vergleich: "Nasdaq Stockholm", "Nasdaq Copenhagen",
 * "Nasdaq Helsinki" und "Nasdaq Iceland" stehen in der Watchlist und sind KEINE
 * US-Boersen — ein startsWith('NASDAQ') zoege 132 nordische Titel in den Kern.
 *
 * Unbekannte Hints fallen bewusst ins Ausland: das kann eine neue US-Schreibweise
 * unbewacht lassen (sichtbar, weil die Gruppengroessen taeglich gedruckt werden),
 * erzeugt aber nie einen Fehlalarm aus einer Kohorte, die gar nicht gemeint war.
 */
const US_BOERSEN = new Set([
  'US', 'NYSE', 'NYSE AMERICAN', 'NYSE ARCA', 'NYSE MKT', 'NYSEARCA',
  'NASDAQ', 'NASDAQGS', 'NASDAQGM', 'NASDAQCM', 'AMEX', 'BATS', 'OTC',
]);

/** Fehlender/leerer Hint = Altbestand aus der Zeit vor dem Feld -> Kern. */
function istKern(r) {
  const h = r && r.exchange_hint;
  if (h == null) return true;                 // Feld fehlt = Altbestand
  // Kein String -> kein geratener Kern. Ohne diese Zeile macht String(['NYSE']) aus einem
  // kaputten Array-Feld ein glattes 'NYSE' und schiebt den Titel in die bewachte Gruppe;
  // ein Objekt wuerde dagegen als '[object Object]' im Ausland landen. Beim Raten waere die
  // Zuordnung also vom Datenfehler abhaengig — lieber unbewacht als falsch einsortiert.
  if (typeof h !== 'string') return false;
  const norm = h.trim().toUpperCase();
  return norm === '' || US_BOERSEN.has(norm);
}

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

function main(opts = {}) {
  const fsApi = opts.fs || fs;
  const storeApi = opts.store || store;
  const log = opts.log || console.log;
  const wurzel = path.join(__dirname, '..');
  let zeilen;
  try {
    zeilen = watchlistZeilen(JSON.parse(fsApi.readFileSync(path.join(wurzel, 'watchlist.json'), 'utf8')));
  } catch (e) {
    // Auch der Messausfall wird ausgesprochen. Stumm exit 0 waere genau der Fehler,
    // den diese Messung aufdecken soll.
    log('::warning::MESSAUSFALL: watchlist.json nicht lesbar (' + e.message + ') — keine Aussage ueber Abdeckung.');
    return 0;
  }
  let alle;
  try { alle = storeApi.loadAll('prices'); }
  catch (e) {
    log('::warning::MESSAUSFALL: Preis-Store nicht lesbar (' + e.message + ') — keine Aussage ueber Abdeckung.');
    return 0;
  }

  let m, kern, ausland;
  try {
    m = messePreisAbdeckung(zeilen, alle);
    // Dieselbe Messfunktion auf beiden Haelften — die Ventil- und Leer-Regeln sind
    // damit garantiert identisch zur Gesamtzahl, statt zweimal formuliert zu sein.
    kern = messePreisAbdeckung(zeilen.filter(istKern), alle);
    ausland = messePreisAbdeckung(zeilen.filter((r) => !istKern(r)), alle);
  }
  catch (e) {
    // Ohne diesen Fang haengt die Garantie "wird nie rot" daran, dass die Messung NIE
    // wirft — ein Argument, keine Sicherung. Belegter Weg dorthin: ein Store, der statt
    // einer Karte null liefert (JSON.parse('null')), laesst die Messung mit TypeError
    // abbrechen, node endet auf 1, der Schritt faerbt rot — und ausgerechnet dann fehlen
    // die Kennzahlen, die erklaeren wuerden, wie schlimm es steht.
    log('::warning::MESSAUSFALL: Messung fehlgeschlagen (' + e.message + ') — keine Aussage ueber Abdeckung.');
    return 0;
  }
  const quote = (x) => (x.leerAnteil == null ? 'n/a' : (x.leerAnteil * 100).toFixed(1) + ' %');
  const anteil = quote(m);
  const schwelleText = (KERN_ALARM_ANTEIL * 100).toFixed(0) + ' %';

  // Tag-520-Lehre: beide Kennzahlen IMMER drucken, auch wenn sie unauffaellig sind.
  // Eine Zahl, die nur im Alarmfall erscheint, ist keine Messreihe.
  console.log('Preis-Abdeckung (Watchlist-Ebene — Kern ist ein Gate, Ausland reine Messung):');
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

  // Karl-Entscheid F-29c: die Aufteilung erscheint TAEGLICH, nicht nur im Alarmfall —
  // sonst merkt niemand, wenn die Kern-Gruppe schrumpft und der Waechter leer laeuft.
  // Der Status steht AUSGESCHRIEBEN daneben, weil die Prozentzahl gerundet ist, die
  // Entscheidung aber am ungerundeten Wert faellt: 5 von 101 Kern-Titeln sind 4,95 % und
  // werden als "5.0 %" gedruckt — ohne dieses Wort saehe der gruene Lauf aus wie ein
  // verschluckter Alarm. Massgeblich ist der Status, nicht die gerundete Zahl.
  const kernAlarm = kern.leerAnteil != null && kern.leerAnteil >= KERN_ALARM_ANTEIL;
  console.log('  AUFTEILUNG nach Herkunft (Karl-Entscheid F-29c 10.08.2026):');
  console.log('    Kern    (US-Boersen + Altbestand ohne Boersen-Hint): ' + kern.leer + ' von ' + kern.basis
    + ' leer (' + quote(kern) + ')   GATE, Schwelle ' + schwelleText
    + ' — Status: ' + (kernAlarm ? 'ALARM' : 'OK'));
  console.log('    Ausland (uebrige Boersen):                           ' + ausland.leer + ' von ' + ausland.basis
    + ' leer (' + quote(ausland) + ')   reine MESSUNG, loest nie Alarm aus');

  if (kernAlarm) {
    // Spalte 0 und console.error: ein Workflow-Command wirkt nur am Zeilenanfang,
    // eingerueckt waere er blosser Text und der Lauf bliebe optisch stumm.
    console.error('::error::PREIS-ABDECKUNG KERN: ' + kern.leer + ' von ' + kern.basis
      + ' Kern-Titeln (' + quote(kern) + ') haben keine einzige Kurszeile — Schwelle ' + schwelleText
      + ' (Karl-Entscheid F-29c). Kern = US-Boersen + Altbestand ohne Boersen-Hint; der Auslandsteil'
      + ' (' + quote(ausland) + ') ist hier NICHT eingerechnet. NAECHSTER SCHRITT: daily-pull Step'
      + ' "Pull Historical Prices" und den Preis-Store (prices/history/) pruefen.');
    return 1;
  }
  return 0;
}

module.exports = { messePreisAbdeckung, watchlistZeilen, istKern, main, KERN_ALARM_ANTEIL };

// exitCode statt process.exit(): node stdout/stderr sind auf eine PIPE (CI) asynchron —
// process.exit() kann die eben geschriebene ::error::-Zeile abschneiden, und dann faerbt
// der Schritt rot, ohne zu sagen warum. Mit exitCode laeuft node normal aus und flusht.
if (require.main === module) process.exitCode = main();
