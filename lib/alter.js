'use strict';
/**
 * Alters-Rechnung fuer die Alarm-Schwellen der Frische-Waechter.
 * ==============================================================
 *
 * ANLASS (28.08.2026): Der Heartbeat meldete waehrend eines viertaegigen
 * Board-Einfrierens durchgehend GRUEN. Gemessen am Lauf 33122769695 (27.08.
 * 22:32 UTC) gegen einen Export vom 25.08. 04:25 UTC:
 *
 *     Export-Alter (...): 2 Tage (Schwelle: 2)
 *
 * Das echte Alter war 2,76 Tage. `Math.floor(2,76) = 2`, und `2 > 2` ist falsch
 * -> kein Alarm. Dieselbe Bauform stand an SECHS Stellen in zwei Workflows
 * (heartbeat.yml 4x, weekly-guard.yml 1x, plus die Vintage-Sonde). Der
 * Wochen-Guard belegt es unabhaengig: seine Meldung lautete woertlich
 * "Daten 4d alt (>3)" — er schlug also erst bei 4,0 Tagen an, nicht bei 3,0.
 *
 * WIRKUNG: jede dieser Schwellen verschenkte bis zu einen ganzen Tag. Eine
 * Schwelle von 2 Tagen war in Wahrheit eine Schwelle von fast 3. Ein Alarm, der
 * seine eigene deklarierte Grenze nicht einhaelt, ist schlimmer als keiner —
 * er erzeugt Vertrauen, das er nicht deckt.
 *
 * WAS SICH NICHT AENDERT: keine einzige Schwelle wird verschoben. MAX_AGE_DAYS
 * bleibt 2, der Wochen-Guard bleibt 3, SPY bleibt 6. Geaendert wird nur, dass
 * die Rechnung diese Zahlen auch WIRKLICH einhaelt.
 *
 * ABSICHTLICH KEINE RUNDUNG NACH UNTEN: die Entscheidung faellt auf dem
 * ungerundeten Wert. Angezeigt wird gerundet (eine Nachkommastelle), damit die
 * Protokollzeile lesbar bleibt — Anzeige und Entscheidung sind getrennt, genau
 * das war der Fehler.
 */

const MS_PRO_TAG = 86400000;
const MS_PRO_STUNDE = 3600000;

/**
 * Alter in TAGEN als Bruchzahl (nicht gerundet). `null`, wenn der Zeitstempel
 * unbrauchbar ist — der Aufrufer entscheidet dann bewusst (in der Regel:
 * behandeln wie maximal veraltet), statt hier still eine 0 zu bekommen.
 */
function alterTage(zeitstempelMs, jetztMs) {
  if (!Number.isFinite(zeitstempelMs) || !Number.isFinite(jetztMs)) return null;
  return (jetztMs - zeitstempelMs) / MS_PRO_TAG;
}

/**
 * Alter in ganzen STUNDEN, abgerundet. Nur fuer die zwei Shell-Aufrufer:
 * POSIX `[ a -gt b ]` kann keine Bruchzahlen. Restliche Unschaerfe damit
 * maximal EINE Stunde statt eines ganzen Tages.
 * ponytail: Stunden-Granularitaet reicht fuer Tages-Schwellen; feiner erst,
 * wenn eine Schwelle jemals unter einen Tag geht.
 */
function alterStunden(zeitstempelMs, jetztMs) {
  if (!Number.isFinite(zeitstempelMs) || !Number.isFinite(jetztMs)) return null;
  return Math.floor((jetztMs - zeitstempelMs) / MS_PRO_STUNDE);
}

/**
 * DIE ENTSCHEIDUNGSFUNKTION. Hier faellt rot/gruen — deshalb ist sie rein,
 * exportiert und einzeln festgenagelt (tests/alarm-tagesgrenze.test.js).
 *
 * Ein unbrauchbares Alter (`null`) gilt als VERALTET. Fail-loud: eine Sonde,
 * die ihren Messwert verloren hat, hat nichts gemessen und darf nicht
 * entwarnen.
 */
function istVeraltet(alterInTagen, maxTage) {
  if (alterInTagen === null || !Number.isFinite(alterInTagen)) return true;
  if (!Number.isFinite(maxTage)) return true;
  return alterInTagen > maxTage;
}

/** Anzeige-Form: eine Nachkommastelle. Nie fuer Vergleiche benutzen. */
function zeigeTage(alterInTagen) {
  return alterInTagen === null || !Number.isFinite(alterInTagen) ? '?' : alterInTagen.toFixed(1);
}

module.exports = { alterTage, alterStunden, istVeraltet, zeigeTage, MS_PRO_TAG, MS_PRO_STUNDE };
