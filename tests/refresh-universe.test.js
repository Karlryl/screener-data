'use strict';
/** tests/refresh-universe.test.js — Standalone-Runner (node tests/refresh-universe.test.js, Exit 0/1).
 * Pinnt FIX 1 (Karl-Audit univ-cap, 2026-07-18): Dead-Registry-Austrag muss VOR dem
 * MAX_UNIVERSE-Cap laufen, sonst kann ein toter Ticker einen Cap-Slot belegen und das
 * Universum endet unter dem Cap, obwohl lebende Kandidaten verfuegbar waeren. */
const assert = require('node:assert/strict');
const ru = require('../refresh-universe.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

test('FIX 1 univ-cap: toter Ticker verdraengt keinen lebenden Cap-Slot (Dead-Austrag VOR dem Cap)', () => {
  // DEAD hat die hoechste marketCap und wuerde bei ungepatchter Reihenfolge (Cap zuerst)
  // einen der beiden Cap-Slots belegen, obwohl er tot registriert ist -> erst danach
  // geloescht -> Universum endet mit nur 1 statt 2 lebenden Tickern (unter dem Cap).
  const allTickers = new Map([
    ['DEAD',  { ticker: 'DEAD',  marketCap: 500e9, source: 'test' }],
    ['LIVE1', { ticker: 'LIVE1', marketCap: 400e9, source: 'test' }],
    ['LIVE2', { ticker: 'LIVE2', marketCap: 300e9, source: 'test' }],
  ]);
  const deadRegistry = { DEAD: { class: 'delisted' } };
  ru.applyDeadRegistryAndCap(allTickers, deadRegistry, 2); // Cap=2, 2 lebende Kandidaten verfuegbar

  assert.ok(!allTickers.has('DEAD'), 'toter Ticker darf nie im finalen Universum landen');
  assert.ok(allTickers.has('LIVE1'), 'LIVE1 darf nicht durch den toten Ticker verdraengt werden');
  assert.ok(allTickers.has('LIVE2'), 'LIVE2 darf nicht durch den toten Ticker verdraengt werden');
  assert.equal(allTickers.size, 2, 'Universum muss den vollen Cap ausschoepfen (beide Lebenden), nicht darunter enden');
});

// ── Tag 510: Doppelausfall-Waechter der beiden Yahoo-Entdeckungskanaele ──────────
// WARUM ES DEN GIBT: BH-100 (Predefined-Kanal) begruendete seinen Nicht-Abbruch mit
// "redundant coverage (EXCHANGE_CODES ...)", BH-038 (Exchange-Kanal) begruendete seinen
// mit "see BH-100 above". Jede Begruendung nannte die andere als Auffangnetz. Am
// 2026-07-30 (Lauf 30516194703) lieferten BEIDE 0 — Predefined 0/325 Buckets, Exchange
// fatal am v3.14-Schema (bekannt seit Tag 248, 05.07.). Keiner der beiden Kanaele kann
// das fuer sich sehen, weil jeder nur sich selbst prueft.
//
// Die vier Faelle sind so gewaehlt, dass JEDE Bedingung EINZELN rot wird, wenn man sie
// ausbaut (die Falle aus dem Persistenz-Waechter: dort verletzten beide Testfaelle beide
// Bedingungen gleichzeitig, also blieb alles gruen, wenn man eine entfernte):
//   - "predefined leer + Exchange still 0" faellt, wenn der customAdded===0-Zweig weg ist
//   - "predefined leer + Exchange liefert"  faellt, wenn die Exchange-Bedingung ganz weg ist
//   - "predefined liefert + Exchange fatal" faellt, wenn die predefined-Bedingung weg ist
// GEGENPROBE durchgefuehrt: jede der drei Bedingungen einzeln entfernt -> jeweils genau
// der zugehoerige Fall rot, die anderen gruen.

test('Tag 510: beide Kanaele leer (Exchange FATAL) -> Waechter feuert', () => {
  assert.equal(ru.beideYahooKanaeleLeer(0, true, 0), true);
});

test('Tag 510: beide Kanaele leer (Exchange STILL 0, kein Fehler) -> Waechter feuert', () => {
  // Der stille Fall: kein Schema-Fehler, aber auch kein einziger neuer Ticker.
  // Wer nur auf exchangeScreenerFatal prueft, uebersieht genau das.
  assert.equal(ru.beideYahooKanaeleLeer(0, false, 0), true);
});

test('Tag 510: predefined leer, Exchange LIEFERT -> Waechter schweigt', () => {
  // Ein Einzelausfall ist durch MIN_DISCOVERY_CANDIDATES gedeckt und keine Doppellage.
  assert.equal(ru.beideYahooKanaeleLeer(0, false, 500), false);
});

test('Tag 510: predefined LIEFERT, Exchange fatal -> Waechter schweigt', () => {
  assert.equal(ru.beideYahooKanaeleLeer(12, true, 0), false);
});

test('Tag 510: beide gesund -> Waechter schweigt', () => {
  assert.equal(ru.beideYahooKanaeleLeer(12, false, 500), false);
});

// ── F-11 (Karl-Entscheid 2026-08-04): Discovery-Untergrenze $1 Mrd -> $800 Mio ──
// WARUM ES DEN GIBT: pull-yahoo.js laeuft in daily-pull.yml seit 2026-06 mit
// MIN_MCAP_USD=800000000, die beiden Yahoo-Entdeckungskanaele in refresh-universe.js
// schnitten aber bei $1 Mrd ab. Das Band $800M-$1B war damit fuer diese Kanaele tot:
// der Pull haette solche Firmen akzeptiert, die Entdeckung schlug sie nie vor.
// Karl hat GENAU diese Luecke geschlossen — und den $500-Mrd-Deckel ausdruecklich NICHT
// angefasst. Der Test nagelt beides fest: die neue Untergrenze UND den unveraenderten
// Deckel. Waere nur der Boden geprueft, koennte ein spaeterer "Aufraeum"-Commit den
// Deckel mitnehmen, ohne dass etwas rot wird.
test('F-11: $850M passiert die Discovery-Schwelle (das vorher tote Band)', () => {
  assert.equal(ru.inDiscoveryMcapBand(850e6), true);
});

test('F-11: $799M passiert NICHT (neue Untergrenze $800M haelt nach unten dicht)', () => {
  assert.equal(ru.inDiscoveryMcapBand(799e6), false);
  assert.equal(ru.inDiscoveryMcapBand(800e6), true, 'die Grenze selbst gehoert ins Band');
});

test('F-11: $501 Mrd passiert weiterhin NICHT (Deckel unveraendert)', () => {
  assert.equal(ru.inDiscoveryMcapBand(501e9), false);
  assert.equal(ru.inDiscoveryMcapBand(500e9), true, 'der Deckel selbst gehoert ins Band');
});

test('F-11: unbrauchbare Werte fallen wie vorher raus (null/0/NaN/negativ)', () => {
  // Der alte Gate war `!mcap || mcap < 1e9 || mcap > 500e9`. `!mcap` fing null/0/NaN.
  // Das muss die Extraktion in eine Funktion mitnehmen, sonst laesst der neue Boden
  // plötzlich null-mcap-Zeilen durch, die vorher sauber ausgefiltert wurden.
  for (const v of [null, undefined, 0, NaN, Infinity, -1e9, '850000000']) {
    assert.equal(ru.inDiscoveryMcapBand(v), false, `${String(v)} darf nie ins Band`);
  }
});

test('F-11: BEIDE Yahoo-Kanaele gehen durch die Schwellen-Funktion (Verdrahtung)', () => {
  // Verhaltens-Beleg allein reicht hier nicht: die exportierte Funktion koennte korrekt
  // sein, waehrend die beiden Ingest-Schleifen weiter ihr eigenes `mcap < 1e9` fahren —
  // dann waere der Waechter gruen und die Luecke offen. Diese Stellen sind ohne Netz
  // nicht erreichbar, also am OBJEKT pruefen: Anwesenheit des Aufrufs an beiden Gates
  // UND Abwesenheit jedes nackten Zahlen-Bodens in den Ingest-Schleifen.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'refresh-universe.js'), 'utf8');
  const aufrufe = (src.match(/if \(!inDiscoveryMcapBand\(mcap\)\) continue;/g) || []).length;
  assert.equal(aufrufe, 2, 'Predefined-Bucket- UND Custom-Exchange-Schleife muessen den Gate rufen');
  assert.ok(!/mcap\s*<\s*(1e9|1000000000|MIN_MCAP_CUSTOM)/.test(src),
    'kein Ingest-Gate darf am Zahlen-/Alt-Boden vorbei vergleichen');
});

test('F-11: Discovery-Boden liegt nie UEBER dem Pull-Boden aus daily-pull.yml', () => {
  // DAS WAR DER BEFUND, nicht nur seine Folge: der Pull-Boden wurde 2026-06 auf $800M
  // gesenkt, der Entdeckungs-Boden blieb bei $1 Mrd — zwei Zahlen an zwei Orten, und
  // niemand hielt sie zusammen. Genau diese Richtung wird hier gepinnt.
  // Umgekehrt (Discovery UNTER Pull) ist erlaubt: dann schlaegt die Entdeckung Firmen
  // vor, die der Pull verwirft — Verschwendung, aber keine Luecke. Nur Discovery > Pull
  // erzeugt das tote Band, in dem eine Firma von KEINEM Kanal vorgeschlagen werden kann.
  const yml = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8');
  // Am OBJEKT suchen, nicht dateiweit: nur der Block des "Run Yahoo Pull"-Schritts.
  // Dateiweites Greifen faende auch fremde MIN_MCAP_USD-Vorkommen und wuerde gruen
  // bleiben, wenn sich ausgerechnet der hier gemeinte Wert aendert.
  const block = yml.split(/^ {6}- name: /m).find(b => b.startsWith('Run Yahoo Pull'));
  assert.ok(block, 'Schritt "Run Yahoo Pull" nicht mehr in daily-pull.yml gefunden — Test zeigt ins Leere');
  const m = block.match(/^\s*MIN_MCAP_USD:\s*'?(\d+)'?\s*$/m);
  assert.ok(m, 'MIN_MCAP_USD fehlt im "Run Yahoo Pull"-Block — Pull-Boden nicht mehr ablesbar');
  const pullBoden = Number(m[1]);
  assert.ok(ru.MIN_MCAP_DISCOVERY <= pullBoden,
    `Discovery-Boden $${ru.MIN_MCAP_DISCOVERY / 1e6}M liegt UEBER dem Pull-Boden $${pullBoden / 1e6}M — ` +
    'das Band dazwischen ist tot: der Pull wuerde diese Firmen nehmen, die Entdeckung schlaegt sie nie vor.');
});

// ── BH-100/F-11-FOLGE (04.08.2026): die Bibliotheks-Untergrenze IST der Kanal ──────
// Der Predefined-Kanal war seit dem 11.05.2026 tot: 325 von 325 Aufrufen warfen
// FailedYahooValidationError, weil yahoo-finance2 unter 3.15.0 ein Ergebnis komplett
// verwirft, sobald Yahoo EIN unbekanntes Feld mitschickt (impliedSharesOutstanding, seit
// Mai 2026, von unserem Code nirgends benutzt). Keine Zeile eigener Code war schuld, und
// keine Zeile eigener Code heilt es — nur die Version. Eigene Messung 04.08. an derselben
// 5er-Stichprobe: 3.14.0 = 5/5 Aufrufe tot, 0 Quotes; 3.15.4 = 1/5 tot, 971 Quotes.
// Ein Rueckfall unter 3.15.0 toetet den Kanal wieder, und der einzige Alarm dagegen waere
// eine Zeile im CI-Log, die drei Monate lang niemand gelesen hat. Deshalb hier, statisch.
// Geprueft wird der LOCK (das ist, was `npm ci` installiert) UND die Range in package.json.
test('BH-100/F-11-FOLGE: yahoo-finance2 >= 3.15.0 — darunter ist der Predefined-Kanal tot', () => {
  const fs = require('node:fs'), path = require('node:path');
  const ROOT = path.join(__dirname, '..');
  const MINDEST = [3, 15, 0];
  const mindestens = (v, min) => {
    const t = String(v).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (!Number.isFinite(t[i])) return false;
      if (t[i] !== min[i]) return t[i] > min[i];
    }
    return true;
  };
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const eintrag = lock.packages && lock.packages['node_modules/yahoo-finance2'];
  assert.ok(eintrag && eintrag.version, 'yahoo-finance2 fehlt im package-lock.json');
  assert.ok(mindestens(eintrag.version, MINDEST),
    `package-lock.json haelt yahoo-finance2 ${eintrag.version} — unter 3.15.0 wirft der ` +
    'Predefined-Screener bei JEDEM Aufruf FailedYahooValidationError (gemessen: 3.14.0 = 5/5 tot).');
  const range = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies['yahoo-finance2'];
  assert.ok(mindestens(String(range).replace(/^[^0-9]*/, ''), MINDEST),
    `package.json erlaubt "${range}" — die Untergrenze muss die geheilte Version dokumentieren, ` +
    'sonst loest ein Lock-Neubau wieder auf eine tote Version auf.');
});

console.log(`\nrefresh-universe.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
