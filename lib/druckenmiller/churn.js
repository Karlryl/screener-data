'use strict';
/**
 * lib/druckenmiller/churn.js — die REGEL des Churn-Tors, an genau einer Stelle.
 *
 * WARUM DIESE DATEI EXISTIERT: das Tor (Gericht 2026-09-14, [REV6-4]/[REV10-4]) entscheidet
 * ab Chunk 2 zwei Dinge gleichzeitig — ob eine Sitzung in die Quantil-Fenster darf UND ob
 * sie Scoreboard-Eintraege schreiben darf. Es wird deshalb an zwei Orten gebraucht: im
 * Export-Schreiber (scoring-Job, ueber die ganze Reihe) und im Logger (merge-Job, nur fuer
 * die Sitzung von heute). Zwei Implementierungen derselben registrierten Schwelle waeren
 * genau die Klasse Fehler, gegen die Datei A steht — also liegt die Regel hier, und beide
 * Aufrufer holen sie sich.
 *
 * Die Schwelle selbst wird NICHT hier hartkodiert: sie kommt aus der Registrierung
 * (courtGates.churnMaxShare) und muss uebergeben werden.
 */

/** Ein- und Austritte zwischen zwei Mitglieder-Mengen (Set von Tickern). */
function membershipDelta(vorher, jetzt) {
  let rein = 0, raus = 0;
  for (const t of jetzt) if (!vorher.has(t)) rein++;
  for (const t of vorher) if (!jetzt.has(t)) raus++;
  return { nEntered: rein, nLeft: raus };
}

/**
 * Die registrierte Entscheidung: (nEntered + nLeft) / nUniverse > churnMaxShare.
 * `null` (nicht `false`), wenn es keinen Nenner gibt — "nicht gemessen" ist eine andere
 * Aussage als "ruhig", und beide fuehren zu verschiedenen Konsequenzen.
 */
function highChurnFlag(nUniverse, nEntered, nLeft, churnMax) {
  if (!(Number.isFinite(churnMax) && churnMax > 0 && churnMax < 1)) {
    throw new Error('[druckenmiller] churnMaxShare aus der Registrierung ist ' + churnMax
      + ' — ohne die registrierte Schwelle wird kein Churn-Tor gerechnet.');
  }
  if (!(Number.isFinite(nUniverse) && nUniverse > 0)) return null;
  if (!Number.isFinite(nEntered) || !Number.isFinite(nLeft)) return null;
  return (nEntered + nLeft) / nUniverse > churnMax;
}

module.exports = { membershipDelta, highChurnFlag };
