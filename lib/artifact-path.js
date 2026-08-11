'use strict';
/**
 * Separator-neutrale Pfad-Zerlegung fuer Studien-Artefakte (Quellen-Fix, 2026-08-11).
 *
 * WARUM: `path.basename` ist plattformabhaengig. Auf Windows zerlegt es sowohl `\` als
 * auch `/`, auf Linux (ubuntu-latest, `path.posix`) NUR `/`. Die Artefakte unter
 * `reports/early-detection/*.json` zeichnen aber absolute WINDOWS-Pfade auf, z. B.
 *   "path": "C:\\Users\\Anwender\\Documents\\Codex\\...\\build_x.py"
 * Auf dem CI-Runner bleibt so ein String damit UNZERLEGT: `path.basename` liefert den
 * kompletten Pfad zurueck, jeder Vergleich gegen einen Dateinamen schlaegt fehl, die
 * Suche findet nichts — genau so ist der Di-Cron am 11.08. gerissen (Run 31456765697).
 * Tag 650 hat das mit einem LOKALEN Helfer in EINER Testdatei geflickt; diese Datei
 * macht daraus die eine Quelle, damit die Fehlerklasse verschwindet statt pro Datei
 * neu aufzutreten.
 *
 * REGEL: Pfade aus Artefakten werden ausschliesslich ueber diesen Helfer angefasst.
 * `path.basename`/`path.dirname` niemals auf aufgezeichnete Artefakt-Pfade anwenden.
 *
 * Keine Dependency, CommonJS wie lib/read-json.js. Gate: lib/artifact-path.test.js
 */

/** Letzter Namensteil eines aufgezeichneten Pfads — egal ob `\`, `/` oder gemischt. */
function baseName(p) {
  return String(p).split(/[\\/]/).filter(Boolean).pop() ?? '';
}

/** Ganzen Pfad auf POSIX-Trenner bringen — fuer Vergleiche kompletter Pfade. */
function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

module.exports = { baseName, toPosix };
