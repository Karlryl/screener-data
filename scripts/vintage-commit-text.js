'use strict';
/**
 * Tag 512: die Commit-Betreffzeile und die Erfolgsmeldung des Vintage-Commits.
 *
 * DER FEHLER, DEN ES GAB (Lauf 30516194703, 2026-07-30): der Commit-Schritt meldete
 * korrekt "::warning:: ... wird NICHT committet", nahm das Tagesverzeichnis per
 * :(exclude)-Pathspec auch wirklich aus — und schrieb dann trotzdem
 *     git commit -m "chore: board-history vintage 2026-07-30"
 *     echo "✓ board-history vintage committed to main"
 * Beides gelogen: committet wurden nur die Sidecars (newcomer-log, ticker-map), das
 * Vintage selbst blieb draussen. In `git log` sah der blockierte Tag damit aus wie ein
 * gelandeter, und die Erfolgszeile stand direkt unter der Warnung.
 *
 * Das ist die UMKEHRUNG der Fehlerklasse, die Tag 502 fuer GATE BLIND behoben hat.
 * Dort war "gruen" nicht von "Gate uebergangen" zu unterscheiden; hier ist "blockiert"
 * nicht von "gelandet" zu unterscheiden. Beides derselbe Schaden: Karls einziger
 * Alarmkanal ist das Lauf-Protokoll plus die Historie.
 *
 * ZWEITER FEHLER, derselbe Codepfad: die Betreffzeile nahm `$(date -u +%F)` statt
 * $VINTAGE_DATE. Bei einem Backfill (--date) oder einem Lauf ueber Mitternacht nennt
 * der Commit dann ein anderes Datum als das Vintage, das er traegt.
 *
 * WARUM ALS EIGENES SKRIPT und nicht als Shell-Bedingung in der YAML: ein Waechter
 * gegen den alten Fehler muss die SACHE festnageln (welcher Text kommt bei welchem
 * Rueckgabewert heraus), nicht ein Schreibmuster in der Workflow-Datei. Ein Grep auf
 * daily-pull.yml pruefte nur seine eigene Abschrift der Wahrheit. So ist das Verhalten
 * direkt testbar - siehe tests/vintage-commit-text.test.js.
 *
 * Usage:  node scripts/vintage-commit-text.js <rc> <vintage-date> --subject|--done
 *         rc: der Rueckgabewert von write-board-history.js (2 = suspect)
 */

// rc=2 heisst: mindestens ein Board wurde als suspect geflaggt, das Tagesverzeichnis
// ist vom Commit ausgenommen. Jeder andere rc heisst: das Vintage ist dabei.
// Bewusst gegen den STRING '2' verglichen, weil der Wert aus einem Workflow-Output
// kommt (immer String) - und Number('') waere 0, also faelschlich "committet".
function vintageBlockiert(rc) {
  return String(rc).trim() === '2';
}

function subject(rc, datum) {
  return vintageBlockiert(rc)
    ? `chore: nur Sidecars — vintage ${datum} SUSPECT, NICHT committet`
    : `chore: board-history vintage ${datum}`;
}

function done(rc, datum) {
  return vintageBlockiert(rc)
    ? `✓ Sidecars committet — vintage ${datum} blieb wegen SUSPECT ausgeschlossen`
    : `✓ board-history vintage ${datum} committet`;
}

module.exports = { vintageBlockiert, subject, done };

if (require.main === module) {
  const [rc, datum, was] = process.argv.slice(2);
  if (!rc || !datum || !was) {
    console.error('usage: node scripts/vintage-commit-text.js <rc> <vintage-date> --subject|--done');
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    console.error(`vintage-commit-text: "${datum}" ist kein ISO-Datum (yyyy-mm-dd)`);
    process.exit(1);
  }
  if (was === '--subject') process.stdout.write(subject(rc, datum));
  else if (was === '--done') process.stdout.write(done(rc, datum));
  else { console.error(`vintage-commit-text: unbekannter Modus "${was}"`); process.exit(1); }
}
