'use strict';
/**
 * Profitabilitaets-Stufen-Klassifikator (Task 1.2, Karl-Direktive B3).
 *
 * Reine DESKRIPTIVE Filter-Dimension — KEIN Score-Einfluss. Wird (wie phase/mcapBand/
 * ipoRecency) NACH dem Scoring additiv an die Output-Zeile gehaengt, damit Karl im
 * Findash-Tab nach Turnaround-Reife filtern kann. Fixture-safe (kein Routing/Track/
 * Achsen/Score-Einfluss).
 *
 * Vier LUECKENLOS kachelnde Stufen auf dem Yahoo-JAHRES-Stream (annual OpInc, Fallback
 * NetIncome; ~4 Jahre) + der Quartals-Trajektorie (opIncQ; ~5 Quartale):
 *   'nicht-profitabel'        operativer Verlust, KEINE erkennbare Breakeven-Trajektorie.
 *   'kurz-vor-profitabel'     Verlust, aber juengstes Quartal schon positiv ODER Verluste
 *                             ueber >=2 Q rueckläufig UND Breakeven bei aktueller Rate
 *                             binnen <= BREAKEVEN_MAX_QUARTERS erreichbar. (B3-Turnaround-Kern)
 *   'seit-kurzem-profitabel'  aktuell profitabel, aber NICHT 'langfristig' (kurze Historie
 *                             ODER ein Verlustjahr im 4-Jahres-Fenster). (B3-Turnaround-Kern)
 *   'langfristig-profitabel'  profitabel in ALLEN vorhandenen >= LONGTERM_MIN_YEARS Jahresperioden.
 *   null                      zu wenig Daten (keine annual-Profit-Serie).
 *
 * Die beiden mittleren Stufen sind Karls B3-Turnaround-Kern und werden bewusst von
 * 'nicht-profitabel' getrennt. Ober-/Untergrenze von 'seit-kurzem' und 'langfristig' sind
 * gekoppelt (jede profitable Firma unter der Langfrist-Schwelle ist 'seit-kurzem') -> die
 * vier Stufen kacheln lueckenlos, jede gescorte Firma hat genau eine.
 *
 * Bewusst auf den JAEHRLICHEN Stream fuer 'langfristig' gestellt (NICHT ~5 Quartale):
 * Yahoo liefert quartalsweise unabhaengig vom Firmenalter nur ~5 Q -> "volles Fenster"
 * waere fuer jede Firma > 1,25 J trivial erfuellt, und eine seit >=4 J profitable Firma
 * nicht von einer seit 1,3 J profitablen unterscheidbar. Eine frische, seit Boersengang
 * durchgaengig profitable IPO erreicht daher MAX 'seit-kurzem', NIE 'langfristig'.
 *
 * CEILING (im Ledger dokumentiert): eine echte Dekaden-Aussage ist mit ~4 Jahren Yahoo-
 * Historie nicht belegbar. Die belastbare Langfrist-Verfeinerung haengt an der XBRL-
 * Langhistorie (Task 4.1) und laeuft als Folgetask 4.5. Bis dahin ist 'langfristig' =
 * "alle ~4 verfuegbaren Yahoo-Jahre positiv, mind. 4 vorhanden".
 *
 * Schwellen: Ausgangspunkt, im Ledger festgezurrt — als benannte Konstanten, keine Magic Numbers.
 */
const { norm, presentValues } = require('./snapshot.js');

const LONGTERM_MIN_YEARS = 4;      // 'langfristig' braucht >= so viele annual-Perioden, alle >= 0
const TRAJECTORY_MIN_QUARTERS = 2; // fuer eine Trajektorie-Aussage mindestens noetige Quartale
const BREAKEVEN_MAX_QUARTERS = 4;  // 'kurz vor': Breakeven bei aktueller Rate binnen <= so viel Q

// Annual-Operating-Ergebnis-Stream (Fallback NetIncome), newest-first, nur present values.
// Spiegelt profitSeries() aus score.js — hier standalone gehalten (kein score.js-Import ->
// kein Zyklus, eigenstaendig testbar).
function annualProfitSeries(s) {
  const op = presentValues(norm(s, 'annualOpInc'));
  return op.length ? op : presentValues(norm(s, 'annualNetIncome'));
}

function profitTierOf(s) {
  const annual = annualProfitSeries(s);
  if (annual.length < 1) return null;               // keine annual-Profit-Serie -> unbekannt
  const currentProfitable = annual[0] >= 0;         // annual[0] = juengstes Jahr

  if (currentProfitable) {
    if (annual.length >= LONGTERM_MIN_YEARS && annual.every((v) => v >= 0)) return 'langfristig-profitabel';
    return 'seit-kurzem-profitabel';                // profitabel jetzt, aber Fenster kurz/lueckig
  }

  // aktuell Verlust -> Breakeven-Trajektorie ueber die Quartale (opIncQ, newest-first)
  const q = presentValues(norm(s, 'opIncQ'));
  if (q.length >= TRAJECTORY_MIN_QUARTERS) {
    if (q[0] >= 0) return 'kurz-vor-profitabel';    // juengstes Quartal schon positiv -> annual folgt
    const rate = q[0] - q[1];                        // >0 = Verluste schrumpfen (weniger negativ)
    if (rate > 0 && q[0] + BREAKEVEN_MAX_QUARTERS * rate >= 0) return 'kurz-vor-profitabel';
  }
  return 'nicht-profitabel';
}

const TIERS = ['nicht-profitabel', 'kurz-vor-profitabel', 'seit-kurzem-profitabel', 'langfristig-profitabel'];

module.exports = { profitTierOf, annualProfitSeries, TIERS, LONGTERM_MIN_YEARS, TRAJECTORY_MIN_QUARTERS, BREAKEVEN_MAX_QUARTERS };
