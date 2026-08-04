'use strict';
/**
 * Tag 575 / DT-1: Gesamt-Zeitbudget JE ADAPTER statt Retry-Leiter je Anfrage.
 * ===========================================================================
 * BEFUND (Lauf 30788278952, prep-Job 91606250192, 03.08.2026): der Schritt
 * "Refresh Universe" lief in sein 20-Minuten-Timeout. Nicht die Yahoo-Kanaele —
 * die beiden Discovery-Adapter mit seriellen Retry-Leitern:
 *
 *   otc-markets.js  10 Seiten x 3 Versuchen x 30s Socket-Timeout + [10s,30s] Backoff
 *                   = 130,5s je Seite = 1305s (21m45s) im Worst case
 *   nasdaq-api.js    3 Boersen x 3 Versuchen x 45s Socket-Timeout + [15s,45s] Backoff
 *                   = 195s je Boerse = 586,6s (9m47s) im Worst case
 *
 * Gemessen wurden 18m28s, dann starb der Schritt mitten in OTC-Seite 9 — 8 volle
 * Seiten (1044s) plus 64s in der neunten. Die Rechnung deckt sich mit dem Log.
 * Eine Leiter, deren Worst case ALLEIN ueber dem Schritt-Timeout liegt, kann den
 * Schritt nur toeten; jede Anfrage darf scheitern, aber nicht auf Kosten des Rests.
 *
 * HERLEITUNG DES BUDGETS (keine Magic Number):
 *   Schritt "Refresh Universe" in .github/workflows/daily-pull.yml traegt
 *   timeout-minutes: 20 -> 1200s fuer den GANZEN Schritt. Davon gehen ab (gemessen
 *   im selben Lauf): Predefined-Yahoo-Kanal 104s, Exchange-Kanal ~1s, dazu der Rest
 *   von refresh-universe.js (Mcap-Prefilter, Dedup, Cap, Schreiben).
 *   Reserve fuer alles ausser den budgetierten Adaptern: die HAELFTE des Schritts
 *   (600s) — das rund Sechsfache des gemessenen Nicht-Adapter-Anteils.
 *   Die uebrigen 600s werden auf die budgetierten Adapter aufgeteilt: 300s je Adapter.
 *   Damit bleibt selbst die SUMME aller Budgets plus Overhead sicher unter dem
 *   Schritt-Timeout — obwohl die Adapter tatsaechlich in Promise.allSettled parallel
 *   laufen und der Wanduhr-Fall damit das MAXIMUM ist, nicht die Summe.
 *   Zum Vergleich: ein GESUNDER Lauf braucht je Adapter unter einer Minute.
 *
 * R575-3 (Review ueber Tag 574/575) — DAS BUDGET IST EINE DECKE MIT UEBERSTAND:
 *   Hier stand "300s je Adapter" als harte Obergrenze. Das ist zu genau formuliert.
 *   `mitBudget` prueft VOR einem Versuch, ob das Budget noch traegt — es kann einen
 *   laufenden Versuch nicht abschneiden. Startet eine Anfrage bei 299,9s Verbrauch, laeuft
 *   sie noch in ihren vollen SOCKET-Timeout hinein. Der ist adapterspezifisch und steht im
 *   jeweiligen Adapter, nicht hier:
 *     otc-markets.js  req.setTimeout(30000)  ->  Decke  300s + 30s = ca. 330s
 *     nasdaq-api.js   req.setTimeout(45000)  ->  Decke  300s + 45s = ca. 345s
 *   Pessimistischste Summe beider Decken: 675s (statt der 600s, die hier standen). Auch
 *   die traegt: 1200s Schritt-Timeout - 675s = 525s bleiben fuer die Yahoo-Kanaele und
 *   den Rest von main(). Der Wanduhr-Fall ist ohnehin freundlicher — die Adapter laufen
 *   parallel, gemessen wird also max(330, 345) = 345s.
 *   Die Zahl wird hier genannt und nicht "wegdefiniert": wer den Socket-Timeout eines
 *   budgetierten Adapters erhoeht, hebt damit auch dessen Decke, und diese Rechnung ist
 *   die Stelle, an der das auffallen muss.
 *
 * Aendert jemand timeout-minutes im Workflow, wird SCHRITT_TIMEOUT_MIN hier rot:
 * tests/dt1-adapter-zeitbudget.test.js rechnet die Herleitung gegen die Workflow-Datei nach.
 */

// Schritt-Timeout aus .github/workflows/daily-pull.yml, Schritt "Refresh Universe".
const SCHRITT_TIMEOUT_MIN = 20;
// Anteil des Schritts, der NICHT den budgetierten Adaptern gehoert (Yahoo-Kanaele,
// Prefilter, Dedup, Schreiben) — gemessen ~105s, hier sechsfach reserviert.
const NICHT_ADAPTER_RESERVE_ANTEIL = 0.5;
// Adapter mit eigenem Gesamtbudget: otc-markets.js, nasdaq-api.js.
const BUDGETIERTE_ADAPTER = 2;
const ADAPTER_BUDGET_MS = Math.floor(
  (SCHRITT_TIMEOUT_MIN * 60 * 1000 * (1 - NICHT_ADAPTER_RESERVE_ANTEIL)) / BUDGETIERTE_ADAPTER);

function schlafe(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Ein laufendes Zeitbudget. `jetzt` ist injizierbar, damit Waechter das Verhalten
 * ohne echte Wartezeit messen koennen (ein Test, der 5 Minuten schlaeft, laeuft nie).
 */
function zeitbudget(name, budgetMs, jetzt) {
  const uhr = jetzt || Date.now;
  const start = uhr();
  const b = budgetMs == null ? ADAPTER_BUDGET_MS : budgetMs;
  return {
    name,
    budgetMs: b,
    verbrauchtMs() { return uhr() - start; },
    restMs() { return b - (uhr() - start); },
    erschoepft() { return b - (uhr() - start) <= 0; },
  };
}

/** Ein Abbruch WEGEN des Budgets — am Fehler erkennbar, nicht am Meldungstext. */
function budgetFehler(budget, wo) {
  const e = new Error('Zeitbudget erschoepft (' + Math.round(budget.budgetMs / 1000) + 's) bei: ' + wo);
  e.budgetRiss = true;
  return e;
}

/**
 * Der Budget-Riss laut und ZAEHLBAR: eine Zeile im Log (Karls Kanal) und ein Stempel
 * auf der zurueckgegebenen Map. refresh-universe.js liest `partial` bereits und listet
 * die Quelle unter "Discovery Teilausfaelle" — ohne den Stempel waere eine halbierte
 * Quelle von einer gesunden nicht zu unterscheiden.
 * KEIN process.exit / kein exitCode: der Sinn des Budgets ist, dass die ANDEREN Adapter
 * weiterlaufen. Ein Riss ist ein Teilausfall, kein Grund, den Tag zu verlieren.
 */
function budgetRissMelden(map, budget, wo) {
  console.error('::error::[' + budget.name + '] ZEITBUDGET GERISSEN: ' +
    Math.round(budget.budgetMs / 1000) + 's aufgebraucht (' + Math.round(budget.verbrauchtMs() / 1000) +
    's verbraucht) bei ' + wo + '. Der Adapter gibt auf und liefert einen TEILBESTAND; die uebrigen ' +
    'Discovery-Adapter laufen weiter. Ohne dieses Budget hat genau diese Retry-Leiter am 03.08. den ' +
    'ganzen Schritt "Refresh Universe" in sein 20-Minuten-Timeout gefahren (DT-1).');
  if (map) { map.partial = true; map.budgetRiss = true; }
}

/**
 * Eine Anfrage mit Backoff-Leiter versuchen — aber nur so lange, wie das Budget traegt.
 * Wirft `budgetFehler` (erkennbar an `.budgetRiss`), sobald ein weiterer Versuch oder
 * ein weiterer Backoff nicht mehr hineinpasst. Alles andere verhaelt sich wie vorher:
 * nicht-wiederholbare Fehler fliegen sofort, die Leiter bleibt dieselbe.
 */
async function mitBudget(budget, wo, delays, istWiederholbar, anfrage, schlafen) {
  const warten = schlafen || schlafe;
  let letzterFehler = null;
  for (let versuch = 0; versuch <= delays.length; versuch++) {
    if (budget.erschoepft()) throw budgetFehler(budget, wo + ' (vor Versuch ' + (versuch + 1) + ')');
    try {
      return await anfrage(versuch);
    } catch (e) {
      if (e && e.budgetRiss) throw e;
      letzterFehler = e;
      if (!istWiederholbar(e) || versuch >= delays.length) throw e;
      const pause = delays[versuch];
      // Ein Backoff, nach dem kein Versuch mehr ins Budget passt, ist verbrannte Zeit —
      // genau die 40s je Seite, die am 03.08. neben den Timeouts mitliefen.
      if (budget.restMs() <= pause) {
        throw budgetFehler(budget, wo + ' (Backoff ' + Math.round(pause / 1000) + 's passt nicht mehr, Rest ' +
          Math.max(0, Math.round(budget.restMs() / 1000)) + 's)');
      }
      console.warn('  [' + budget.name + '] ' + wo + ' Timeout (Versuch ' + (versuch + 1) + '/' +
        (delays.length + 1) + ') — neuer Versuch in ' + Math.round(pause / 1000) + 's (Budget-Rest ' +
        Math.round(budget.restMs() / 1000) + 's)');
      await warten(pause);
    }
  }
  // Unerreichbar (jeder Pfad oben endet in return oder throw) — aber `throw null` waere
  // der schlechteste denkbare Ausgang: ein Fehler ohne Meldung, der die Adapter-Schleife
  // als "kein budgetRiss" durchlaeuft und still als Seitenfehler gezaehlt wird.
  throw letzterFehler || new Error('[' + budget.name + '] ' + wo + ': Retry-Schleife ohne Ergebnis verlassen');
}

module.exports = {
  SCHRITT_TIMEOUT_MIN, NICHT_ADAPTER_RESERVE_ANTEIL, BUDGETIERTE_ADAPTER, ADAPTER_BUDGET_MS,
  zeitbudget, budgetFehler, budgetRissMelden, mitBudget,
};
