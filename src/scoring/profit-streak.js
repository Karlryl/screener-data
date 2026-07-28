'use strict';
/**
 * Gewinn-Serie aus der SEC-Langhistorie (Task 4.5, Teil 1).
 *
 * Beantwortet EINE Frage je Firma: **seit wie vielen Geschaeftsjahren ununterbrochen
 * profitabel** — belegt an den bei der SEC eingereichten Zahlen, nicht an Yahoos
 * ~4-Jahres-Fenster.
 *
 * WARUM DAS NOETIG WAR (gemessen 28.07., 1.909 Firmen mit beiden Quellen):
 * **380 von 1.353 Firmen (28 %) tragen heute das Etikett 'langfristig-profitabel',
 * obwohl ihre Gewinnserie binnen acht Jahren abreisst.** Der Grund ist kein Fehler in
 * `profit-tier.js`, sondern sein Fenster: Yahoo liefert ~4 Jahre, und in vier sauberen
 * Jahren ist jede Firma langfristig profitabel.
 *   American Airlines: 2022-2025 sauber — 2021 aber -1,06 Mrd, 2020 -10,4 Mrd (COVID).
 *   Autodesk:          sieben Jahre sauber — dann ein Verlustjahr 2019.
 * Beide gelten heute als "langfristig profitabel".
 *
 * ⚠ BEWUSST NUR ADDITIV — `profitTierOf` bleibt UNVERAENDERT.
 * Das Etikett selbst wird hier NICHT umgestellt, obwohl es naheliegt. Grund: dieselbe
 * Messung hat einen zweiten, groesseren Befund ausgeloest — Yahoos `annualOpInc`
 * widerspricht der SEC bei 10,3 % der vergleichbaren Firmen im VORZEICHEN (Affirm:
 * Yahoo +274 Mio, SEC -87 Mio). Ob der Screener kuenftig die eingereichte statt der
 * (offenbar normalisierten) Zahl lesen soll, ist eine Methodik-Entscheidung der Klasse
 * GROSS und liegt bei Rat und Gericht. Bis dahin: die Zahl AUSWEISEN, nicht verrechnen.
 * Beleg: `_BEFUND-OPINC-QUELLENKONFLIKT-2026-07-28.md` im Vault.
 *
 * Die Fenster-Erweiterung und die Quellenfrage sind unabhaengig voneinander: AALs
 * Milliardenverluste 2020/21 liegen AUSSERHALB von Yahoos Fenster, dort gibt es keinen
 * Widerspruch, nur eine Luecke. Deshalb ist dieser Teil schon jetzt sauber baubar.
 */
const fs = require('fs');
const path = require('path');

const QUELLE = process.env.SEC_BULK_PATH
  || path.join(__dirname, '..', '..', 'external-data', 'sec-annual-bulk.jsonl');

// Ab so vielen ununterbrochenen Jahren gilt die Serie als lang genug, um mehr auszusagen
// als Yahoos Fenster. Nicht willkuerlich: Yahoo liefert ~4 Jahre, also ist alles darunter
// keine neue Information. Reine ANZEIGE-Schwelle, kein Score-Eingriff.
const AUSSAGEKRAEFTIG_AB = 5;

let karte = null; // lazy: erst beim ersten Zugriff lesen, dann gemerkt

function ladeKarte(quelle = QUELLE) {
  const m = new Map();
  let roh;
  try { roh = fs.readFileSync(quelle, 'utf8'); }
  catch (_) { return m; } // Datei fehlt (Fixtures, frischer Checkout) -> leer, alles null
  for (const zeile of roh.split('\n')) {
    if (!zeile.trim()) continue;
    let z;
    try { z = JSON.parse(zeile); } catch (_) { continue; } // eine kaputte Zeile kippt nicht den Lauf
    if (z && z.ticker && z.annual) m.set(z.ticker, z.annual);
  }
  return m;
}

const zahl = (x) => {
  const v = (x && typeof x === 'object') ? x.value : x;
  return Number.isFinite(v) ? v : null;
};

/**
 * Zaehlt ununterbrochene profitable Jahre ab dem juengsten.
 * Eine LUECKE beendet die Serie genauso wie ein Verlust — ein Jahr ohne Zahl ist kein
 * belegtes Gewinnjahr, und "belegt" ist hier der ganze Zweck.
 */
function serieAb(werte) {
  let n = 0;
  for (const w of werte) {
    if (w === null || w < 0) break;
    n += 1;
  }
  return n;
}

/**
 * @returns {{jahre:number, basis:'opInc'|'netIncome', tiefe:number, mindestens:boolean,
 *            letzterVerlust:number|null} | null}
 *   jahre          ununterbrochen profitable Geschaeftsjahre, ab dem juengsten
 *   basis          welche Groesse gezaehlt wurde (163 Firmen melden kein Betriebsergebnis)
 *   tiefe          wie viele Jahre die Reihe ueberhaupt hergibt
 *   mindestens     true, wenn die Serie bis zum Anfang der Reihe laeuft — dann ist die
 *                  echte Serie moeglicherweise laenger, die Daten enden nur hier
 *   letzterVerlust das Geschaeftsjahr, das die Serie beendet hat (null, falls keins in Sicht)
 */
function profitStreak(ticker, annual) {
  if (!annual) return null;
  const fys = Array.isArray(annual._fys) ? annual._fys : [];
  const op = (annual.annualOpInc || []).map(zahl);
  const ni = (annual.annualNetIncome || []).map(zahl);
  // Dieselbe Vorrangregel wie annualProfitSeries() in profit-tier.js: Betriebsergebnis
  // zuerst, Nettoergebnis nur, wenn das juengste Betriebsergebnis-Jahr fehlt. Sonst
  // vergliche man zwei verschiedene Groessen, ohne es zu merken.
  const nutzeOp = op.length > 0 && op[0] !== null;
  const werte = nutzeOp ? op : ni;
  if (!werte.length) return null;
  const jahre = serieAb(werte);
  const mindestens = jahre === werte.length;
  return {
    jahre,
    basis: nutzeOp ? 'opInc' : 'netIncome',
    tiefe: werte.length,
    mindestens,
    letzterVerlust: mindestens ? null : (fys[jahre] != null ? fys[jahre] : null),
  };
}

/** Nachschlag je Ticker gegen die (einmal gelesene) Langhistorie. */
function profitStreakOf(ticker) {
  if (!ticker) return null;
  if (karte === null) karte = ladeKarte();
  return profitStreak(ticker, karte.get(ticker));
}

/** Nur fuer Tests: Karte zuruecksetzen bzw. setzen. */
function _setKarte(m) { karte = m; }

module.exports = { profitStreakOf, profitStreak, serieAb, ladeKarte, AUSSAGEKRAEFTIG_AB, _setKarte, QUELLE };
