'use strict';
/**
 * Waechter der Ausschluss-Liste (scripts/write-excluded-list.js).
 *
 * DIE SACHE, DIE HIER FESTGENAGELT WIRD
 * -------------------------------------
 * Diese Liste existiert, WEIL Zeilen still verschwanden: produceRankings() erhoeht je
 * ausgeschlossener Zeile einen Zaehler und wirft die Zeile weg. Eine Liste, die dabei
 * SELBST Zeilen verliert, ist schlimmer als keine — sie sieht vollstaendig aus.
 * Der wichtigste Test unten ist deshalb die Summen-Gegenprobe: je Grund muss die Liste
 * exakt so viele Zeilen fuehren, wie der Zaehler in index.json.excluded behauptet.
 *
 * Und: die Gruende duerfen NICHT aus einer zweiten Quelle stammen. Darum laeuft hier der
 * ECHTE scoreUniverse()-Pass ueber gebaute Snapshots und die ECHTE produceRankings() als
 * Zaehler-Quelle — kein handgeschriebenes results-Array, in dem der reason schon drinsteht.
 * Waere die Ausschluss-Regel nachgebaut, koennte dieser Test das nicht sehen.
 *
 * GEGENPROBEN (durchgefuehrt, Protokoll im Bericht):
 *   - eine Ausschluss-Zeile im Sammler fallen lassen  -> Summen-Test rot
 *   - einen gerouteten Namen mit aufnehmen            -> Gegenprobe-Test rot
 *   - die Doppelgaenger-Gruppierung ausbauen          -> Mehrbein-Test rot
 *
 * Usage:  node tests/scoring/ausschlussliste.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse, produceRankings } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');
const { buildExcludedList, pruefeSummen, beineGesamt } = require('../../scripts/write-excluded-list.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack ? e.stack : e)); }
}

// --- Fixture-Universum -------------------------------------------------------------
// Basis ist ein ECHTER Snapshot (CRDO) — nur meta wird umgeschrieben. Ein handgebautes
// Minimal-Objekt wuerde an Achsen/Lampen vorbeilaufen und den Pass nicht wirklich fahren.
const basis = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'CRDO.json'), 'utf8'));
const klon = (meta, extra = {}) => {
  const s = JSON.parse(JSON.stringify(basis));
  s.meta = { ...s.meta, ...meta };
  if (s.identifier) s.identifier = { ...s.identifier, value: meta.ticker };
  return Object.assign(s, extra);
};
const US = { country: 'United States', exchangeName: 'NasdaqGS', region: 'US' };

const universe = [
  // geroutet — darf NIE in der Liste stehen
  klon({ ticker: 'CRDO', name: 'Credo Technology Group Holding Ltd', ...US }),
  // zwei Bilanz-Banken: der Grund traegt MEHR ALS EINE Zeile, sonst ist ein
  // Einzel-Verlust in der Summe nicht sichtbar (Sabotage 1 braucht das).
  klon({ ticker: 'TBANK1', name: 'Erste Testbank Inc.', sector: 'Financial Services', industry: 'Banks - Diversified', ...US }),
  klon({ ticker: 'TBANK2', name: 'Zweite Testbank Inc.', sector: 'Financial Services', industry: 'Banks - Regional', ...US }),
  // HSBC-Muster: EINE Firma, DREI Beine. Alle drei sind Banken -> alle drei fallen mit
  // demselben Grund, keiner davon darf in der Firmen-Zeile verschwinden.
  klon({ ticker: 'TDREI', name: 'Dreibein Bank plc', sector: 'Financial Services', industry: 'Banks - Diversified', ...US }),
  klon({ ticker: 'TDREI.L', name: 'Dreibein Bank plc', sector: 'Financial Services', industry: 'Banks - Diversified', country: 'United Kingdom', exchangeName: 'LSE', region: 'GB' }),
  klon({ ticker: 'TDREI.HK', name: 'Dreibein Bank plc', sector: 'Financial Services', industry: 'Banks - Diversified', country: 'Hong Kong', exchangeName: 'HKSE', region: 'HK' }),
  // Versicherer + Telekom: zwei weitere Gruende, damit die Summen-Probe mehr als einen Topf sieht
  klon({ ticker: 'TINS', name: 'Test Assekuranz AG', sector: 'Financial Services', industry: 'Insurance - Life', ...US }),
  klon({ ticker: 'TTEL', name: 'Test Telekom Inc.', sector: 'Communication Services', industry: 'Telecom Services', ...US }),
  // OHNE Firmennamen: issuerDedupGroups() laesst solche Eintraege ersatzlos fallen —
  // hier waere genau das der stille Verlust, gegen den die Liste gebaut ist.
  klon({ ticker: 'TNONAME', name: null, sector: 'Communication Services', industry: 'Telecom Services', ...US }),
  // Grey-Market-Schattenzeile: auslaendisches Domizil, keine Auslandsboerse -> non-us
  klon({ ticker: 'TOTC', name: 'Test Auslandswert SA', country: 'Germany', exchangeName: 'Other OTC', region: 'DE' }),
  // Doppelnotierung EINER routbaren Firma: ein Bein gewinnt den Dedup, das andere faellt
  // als dup-issuer — die Zeile muss auf das Bein zeigen, das es ins Board geschafft hat.
  klon({ ticker: 'TDUP', name: 'Test Doppelnotiz Inc.', ...US }),
  klon({ ticker: 'TDUP.L', name: 'Test Doppelnotiz Inc.', country: 'United Kingdom', exchangeName: 'LSE', region: 'GB' }),
];

const results = scoreUniverse(universe, formulas);
const zaehler = produceRankings(results, { topN: 50 }).excluded; // DIE Zaehler-Quelle der Produktion
const liste = buildExcludedList(results, universe);
const alleBeine = liste.rows.flatMap((r) => r.beine);
const tickerInListe = new Set(alleBeine.map((b) => b.ticker));

// --- Vorbedingung: das Fixture traegt den Unterschied ueberhaupt --------------------
// Am 19.08. blieben drei Sabotagen gruen, weil das Fixture den Unterschied gar nicht
// tragen konnte. Diese Zusicherungen sind darum selbst Tests.
test('Vorbedingung: mindestens ein Grund traegt mehr als eine Zeile', () => {
  const mehrfach = Object.entries(zaehler).filter(([, n]) => n > 1);
  assert.ok(mehrfach.length > 0, 'jeder Grund haette nur eine Zeile — ein Einzel-Verlust waere in keiner Summe sichtbar');
});
test('Vorbedingung: mindestens eine Firma hat mehr als ein Bein', () => {
  assert.ok(liste.rows.some((r) => r.beine.length > 1),
    'keine mehrbeinige Firma im Fixture — ein Ausbau der Gruppierung waere nicht messbar');
});
test('Vorbedingung: mindestens ein Name wurde geroutet (sonst prueft die Gegenprobe nichts)', () => {
  assert.ok(results.some((e) => e.action === 'route'), 'kein gerouteter Name im Fixture');
});

// --- Form ---------------------------------------------------------------------------
const FELDER = ['ticker', 'name', 'reason', 'sector', 'industry', 'marketCap', 'revGrowthYoYPct'];
test('Form: jede Firmen-Zeile traegt die Pflichtfelder, issuerKey, imBoardAls und ein nicht-leeres beine[]', () => {
  assert.ok(liste.rows.length > 0, 'leere Liste — der Waechter haette nichts zu pruefen');
  for (const r of liste.rows) {
    for (const f of FELDER) assert.ok(f in r, `${r.ticker}: Feld ${f} fehlt`);
    assert.equal(typeof r.ticker, 'string');
    assert.equal(typeof r.reason, 'string');
    assert.ok('issuerKey' in r && 'imBoardAls' in r, `${r.ticker}: issuerKey/imBoardAls fehlt`);
    assert.ok(Array.isArray(r.beine) && r.beine.length > 0, `${r.ticker}: beine[] leer`);
    for (const b of r.beine) {
      for (const f of FELDER) assert.ok(f in b, `${b.ticker}: Bein-Feld ${f} fehlt`);
      assert.ok(b.marketCap === null || Number.isFinite(b.marketCap), `${b.ticker}: marketCap weder null noch endlich`);
      assert.ok(b.revGrowthYoYPct === null || Number.isFinite(b.revGrowthYoYPct), `${b.ticker}: revGrowthYoYPct weder null noch endlich`);
    }
  }
});

// --- die vier Pflichtpruefungen -------------------------------------------------------
test('eine Bank steht mit dem Grund balance-sheet-bank in der Liste', () => {
  const bank = alleBeine.find((b) => b.ticker === 'TBANK1');
  assert.ok(bank, 'die Bilanz-Bank fehlt in der Ausschluss-Liste');
  assert.equal(bank.reason, 'balance-sheet-bank', 'die Bank traegt einen anderen Grund als route() vergibt');
  assert.equal(bank.industry, 'Banks - Diversified', 'die Branche kommt nicht am Snapshot an');
});

test('ein GEROUTETER Name steht NICHT in der Ausschluss-Liste', () => {
  const geroutet = results.filter((e) => e.action === 'route').map((e) => e.ticker);
  const faelschlich = geroutet.filter((t) => tickerInListe.has(t));
  assert.deepEqual(faelschlich, [],
    'bewertete Namen sind in die Ausschluss-Liste geraten: ' + faelschlich.join(', '));
});

test('WICHTIGSTE PRUEFUNG: je Grund deckt sich die Liste mit index.json.excluded', () => {
  assert.deepEqual(pruefeSummen(liste.byReason, zaehler), [],
    'die Liste enthaelt andere Zahlen als die Zaehler — genau der stille Verlust, den sie beheben soll');
});

test('kein Bein geht in der Firmen-Gruppierung verloren', () => {
  const ausgeschlossen = results.filter((e) => e.action === 'exclude' || e.action === 'unrouted').length;
  assert.equal(liste.legs, ausgeschlossen, 'der Sammler hat Zeilen verloren');
  assert.equal(beineGesamt(liste.rows), ausgeschlossen, 'die Gruppierung hat Zeilen verschluckt');
});

// --- Doppelgaenger: Firmen zeigen, ohne Beine zu verschlucken -------------------------
test('drei Beine derselben Firma stehen als EINE Firma mit drei Beinen', () => {
  const treffer = liste.rows.filter((r) => r.beine.some((b) => b.ticker.startsWith('TDREI')));
  assert.equal(treffer.length, 1,
    `die Firma steht ${treffer.length}-mal statt einmal — die Doppelgaenger-Gruppierung greift nicht`);
  assert.deepEqual(treffer[0].beine.map((b) => b.ticker).sort(), ['TDREI', 'TDREI.HK', 'TDREI.L'],
    'nicht alle drei Beine sind an der Firma erkennbar geblieben');
  assert.equal(treffer[0].ticker, 'TDREI', 'das US-primaere Bein muss die Firma anfuehren (issuerDedupComparator)');
});

test('eine Zeile OHNE Firmennamen verschwindet nicht', () => {
  const ohne = liste.rows.filter((r) => r.beine.some((b) => b.ticker === 'TNONAME'));
  assert.equal(ohne.length, 1, 'die namenlose Zeile ist aus der Liste gefallen');
  assert.equal(ohne[0].issuerKey, null, 'sie darf keinen erfundenen Emittenten-Schluessel bekommen');
  assert.equal(ohne[0].beine.length, 1, 'sie darf nicht mit einer fremden Firma verschmelzen');
});

test('eine dup-issuer-Zeile zeigt das Bein, das es ins Board geschafft hat', () => {
  const dup = alleBeine.find((b) => b.reason === 'dup-issuer');
  assert.ok(dup, 'Vorbedingung: das Fixture erzeugt keinen dup-issuer-Fall');
  const zeile = liste.rows.find((r) => r.beine.includes(dup));
  assert.ok(zeile.imBoardAls, 'die Firma sieht aus, als sei sie weg — dabei steht ihr anderes Bein im Board');
  assert.ok(results.some((e) => e.ticker === zeile.imBoardAls && e.action === 'route'),
    `imBoardAls zeigt auf ${zeile.imBoardAls}, das gar nicht geroutet ist`);
});

// --- Die Summen-Wache selbst: sie MUSS feuern koennen ---------------------------------
// Ein Pruefer, der nie rot wird, ist kein Pruefer. Beide Richtungen, plus der Fall
// "Grund kennt nur eine Seite" — der faellt durch einen reinen Wert-Vergleich durch.
test('pruefeSummen: gleiche Zahlen -> sauber (sonst faerbt die Wache gueltige Laeufe rot)', () => {
  assert.deepEqual(pruefeSummen({ insurer: 3, telecom: 2 }, { insurer: 3, telecom: 2 }), []);
});
test('pruefeSummen: eine Zeile zu wenig -> Bruch', () => {
  const f = pruefeSummen({ insurer: 2 }, { insurer: 3 });
  assert.equal(f.length, 1);
  assert.match(f[0], /insurer: Liste 2, index\.json\.excluded 3/);
});
test('pruefeSummen: eine Zeile zu viel -> Bruch', () => {
  assert.equal(pruefeSummen({ insurer: 4 }, { insurer: 3 }).length, 1);
});
test('pruefeSummen: ein Grund, den nur EINE Seite kennt -> Bruch', () => {
  assert.equal(pruefeSummen({ insurer: 3, telecom: 1 }, { insurer: 3 }).length, 1, 'Grund nur in der Liste');
  assert.equal(pruefeSummen({ insurer: 3 }, { insurer: 3, telecom: 1 }).length, 1, 'Grund nur im Zaehler');
});
test('pruefeSummen: fehlender Zaehler ist ein Bruch, kein stilles OK', () => {
  assert.ok(pruefeSummen({ insurer: 3 }, null).length > 0, 'ohne Zaehler darf nichts als sauber gelten');
});

console.log(`\nausschlussliste.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
