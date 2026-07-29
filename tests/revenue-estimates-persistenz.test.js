// tests/revenue-estimates-persistenz.test.js — Standalone-Runner (framework-los).
// Run: node tests/revenue-estimates-persistenz.test.js
//
// WOFUER: Die Umsatz-Prognose (earningsTrend[].revenueEstimate) wird seit dem 29.07.
// mitgeschrieben. Das ist REINE DATENERFASSUNG - kein Konsument, keine Score-Wirkung.
// Der Grund fuer die Eile: die Prognose von heute ist nicht die von damals. Wird sie
// nicht ab sofort gespeichert, laesst sich spaeter NIE zeigen, ob eine darauf gebaute
// Regel getaugt haette - jeder Rueckblick waere Look-ahead. Zwei getrennte
// Gerichtsurteile haben genau das als einzige eilige Massnahme benannt.
//
// WAS HIER FESTGENAGELT WIRD sind die zwei Minen, an denen eine spaetere Regel
// stillschweigend das Gegenteil ihrer Absicht tun wuerde. Beide sind am Live-Bestand
// belegt, keine Theorie:
//
//   MINE 1 - avg = 0 ist keine Prognose, sondern eine Fehlstelle.
//   Yahoo liefert fuer nicht abgedeckte Titel NICHT null, sondern avg = 0 bei
//   numberOfAnalysts = 0 (belegt u. a. an 600038.SS, 000958.SZ, BURE.ST, 1785.TWO -
//   also fast genau der Menge, die als "Prognose-Luecke bei asiatischen Nebenwerten"
//   bekannt ist). Wer daraus eine Wachstumsrate herleitet, erzeugt -100 % und damit
//   die MAXIMALE Negativprognose ausgerechnet fuer die schlecht abgedeckten Titel.
//   Aus "fehlende Prognose = keine Wirkung" wuerde "fehlende Prognose = haerteste
//   Strafe" - eine versteckte geografische Schlagseite.
//
//   MINE 2 - growth = null heisst NICHT "keine Abdeckung".
//   LFTO traegt 14 Analysten und einen gefuellten avg, aber growth = null; ein
//   Rechenartefakt der Quelle. Solche Zeilen muessen mit growth: null ERHALTEN
//   bleiben (= "nicht anwendbar") und duerfen weder als fehlend noch als negativ
//   gelesen werden. Wer sie wegwirft, haelt ein Quellenartefakt fuer eine
//   Abdeckungsluecke und trifft daraufhin falsche Konstruktionsentscheidungen.
//
// GEGENPROBE (durchgefuehrt, und sie hat sich gelohnt): das numberOfAnalysts-Gate
// entfernt -> zunaechst ALLES GRUEN, weil beide Faelle zusaetzlich avg = 0 trugen. Der
// nachgetragene Fall 1c (avg > 0 ohne Analysten) macht ihn jetzt rot;
// das avg-Gate entfernt -> Test 3 rot; growth-Feld weggelassen -> Test 4 rot.
'use strict';
const assert = require('assert');
const { mapYahooToCanonical } = require('../pull-yahoo.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

// Minimal-Antwort: der Mapper braucht nur den Zweig, der hier geprueft wird.
function antwortMit(trend) {
  return {
    price: { symbol: 'TEST', regularMarketPrice: 10, currency: 'USD' },
    summaryProfile: { sector: 'Technology', industry: 'Software', country: 'United States' },
    earningsTrend: { trend },
  };
}
const est = (period, re) => ({ period, revenueEstimate: re });
// mapYahooToCanonical(yahoo, watchlistEntry, asOf) - Signatur an pull-yahoo.js:929
// nachgelesen. Der zweite Parameter wird dereferenziert (.isin) und darf nicht fehlen.
const mappe = (yahoo) => mapYahooToCanonical(yahoo, { symbol: "TEST" }, "2026-07-29");

console.log('revenueEstimates: Persistenz der Umsatz-Prognose');

check('eine echte Prognose wird mit allen drei Feldern gespeichert', () => {
  const s = mappe(antwortMit([
    est('0y', { avg: 1000, growth: -0.498, numberOfAnalysts: 7 }),
    est('+1y', { avg: 950, growth: -0.074, numberOfAnalysts: 6 }),
  ]));
  const re = s.external && s.external.revenueEstimates;
  assert.ok(re, 'revenueEstimates fehlt im Snapshot');
  assert.deepStrictEqual(re['0y'], { avg: 1000, growth: -0.498, numberOfAnalysts: 7 });
  assert.deepStrictEqual(re['+1y'], { avg: 950, growth: -0.074, numberOfAnalysts: 6 });
});

check('MINE 1a: numberOfAnalysts = 0 wird NICHT gespeichert (keine Fehlstelle als Prognose)', () => {
  const s = mappe(antwortMit([
    est('0y', { avg: 0, growth: null, numberOfAnalysts: 0 }),
  ]));
  const re = s.external && s.external.revenueEstimates;
  assert.strictEqual(re, null,
    'ein Titel ohne Analysten darf keine Prognose-Zeile bekommen - sonst liest ein '
    + 'spaeterer Konsument avg 0 als "Umsatz bricht auf null ein"');
});

check('MINE 1b: avg = 0 bei angeblich vorhandenen Analysten wird ebenfalls verworfen', () => {
  const s = mappe(antwortMit([
    est('0y', { avg: 0, growth: null, numberOfAnalysts: 3 }),
  ]));
  assert.strictEqual(s.external.revenueEstimates, null,
    'avg 0 ist keine Umsatzprognose, egal was die Analystenzahl behauptet');
});

check('MINE 1c: avg > 0 aber KEIN Analyst dahinter ist ebenfalls keine Prognose', () => {
  // NACHGETRAGEN nach der Bruchprobe: das Analysten-Gate auszubauen liess alle Tests
  // GRUEN, weil 1a und 1b beide zusaetzlich avg = 0 trugen und schon am avg-Gate
  // haengenblieben. Der Waechter prueft erst mit diesem Fall wirklich BEIDE Bedingungen
  // einzeln. Ohne die absichtliche Bruchprobe waere die Luecke nie aufgefallen.
  const s = mappe(antwortMit([
    est('0y', { avg: 500, growth: 0.1, numberOfAnalysts: 0 }),
  ]));
  assert.strictEqual(s.external.revenueEstimates, null,
    'eine Zahl ohne einen einzigen Analysten dahinter ist keine Prognose');
});

check('MINE 2: growth = null bleibt bei gefuelltem avg ERHALTEN, nicht verworfen', () => {
  const s = mappe(antwortMit([
    est('0y', { avg: 855563050, growth: null, numberOfAnalysts: 14 }),
  ]));
  const re = s.external.revenueEstimates;
  assert.ok(re && re['0y'], 'die Zeile darf nicht verschwinden - 14 Analysten sind eine Abdeckung');
  assert.strictEqual(re['0y'].growth, null, 'growth muss als null durchgereicht werden');
  assert.strictEqual(re['0y'].numberOfAnalysts, 14);
});

check('nur die Perioden mit echter Prognose ueberleben, die anderen fallen weg', () => {
  const s = mappe(antwortMit([
    est('0q', { avg: 0, growth: null, numberOfAnalysts: 0 }),
    est('0y', { avg: 500, growth: 0.12, numberOfAnalysts: 4 }),
    est('+1y', { avg: 0, growth: null, numberOfAnalysts: 0 }),
  ]));
  assert.deepStrictEqual(Object.keys(s.external.revenueEstimates), ['0y']);
});

check('fehlt earningsTrend ganz, ist das Feld null und kein Absturz', () => {
  const s = mappe({
    price: { symbol: 'TEST', regularMarketPrice: 10, currency: 'USD' },
    summaryProfile: { sector: 'Technology', industry: 'Software', country: 'United States' },
  });
  assert.strictEqual(s.external.revenueEstimates, null);
});

check('das value-Huellen-Format der Quelle wird ausgepackt', () => {
  const s = mappe(antwortMit([
    est('0y', { avg: { value: 1200 }, growth: { value: 0.34 }, numberOfAnalysts: { value: 9 } }),
  ]));
  assert.deepStrictEqual(s.external.revenueEstimates['0y'], { avg: 1200, growth: 0.34, numberOfAnalysts: 9 });
});

check('die bestehende epsRevisions-Persistenz bleibt unberuehrt', () => {
  const s = mappe(antwortMit([
    { period: '0y', epsRevisions: { upLast30days: 3, downLast30days: 1 },
      revenueEstimate: { avg: 500, growth: 0.1, numberOfAnalysts: 4 } },
  ]));
  assert.ok(s.external.estimateRevisions && s.external.estimateRevisions['0y'],
    'das additive Feld darf das bestehende nicht verdraengen');
  assert.strictEqual(s.external.estimateRevisions['0y'].upLast30Days, 3);
  assert.ok(s.external.revenueEstimates['0y'], 'und umgekehrt');
});

console.log(fail ? '\nFAILED: ' + fail : '\nalle gruen');
process.exit(fail ? 1 : 0);
